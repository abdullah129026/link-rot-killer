import { assertPublicUrl, SsrfError } from './ssrf.js';

// One transparent user agent for every request the crawler makes.
export const USER_AGENT = 'LinkRotKiller/1.0 (+https://link-rot-killer.vercel.app/bot)';

export const DEFAULT_POLITENESS_MS = 750;
const ROBOTS_TIMEOUT_MS = 5000;
const ROBOTS_MAX_BYTES = 64 * 1024;

// Two hosts count as the same site when one is the other or a subdomain of
// it. This is an approximation, not a public-suffix list: www.example.com
// redirecting to example.com is not a cross-host hop. The ceiling is exotic
// suffixes (co.uk); a wrong call there only changes a notice, never a break.
export function sameSite(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith('.' + y) || y.endsWith('.' + x);
}

// Politeness lives here: minimum spacing between requests to the same host,
// enforced in-process, plus a robots.txt check for page crawls. The
// host_throttle table mirrors the spacing across ticks (best effort); the
// tick runner seeds lastHit from it and writes it back.
export function createFetcher({
  politenessMs = DEFAULT_POLITENESS_MS,
  lastHit = new Map(),
  robots = new Map(),
  timeoutMs = 10000,
  maxBodyBytes = 2 * 1024 * 1024,
  assertPublic = assertPublicUrl, // injectable so tests skip real DNS
} = {}) {
  async function waitForTurn(host) {
    const wait = politenessMs - (Date.now() - (lastHit.get(host) || 0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async function robotsAllows(host, path) {
    if (!robots.has(host)) {
      const disallows = [];
      try {
        await assertPublic('https://' + host + '/');
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), ROBOTS_TIMEOUT_MS);
        const res = await fetch('https://' + host + '/robots.txt', {
          headers: { 'user-agent': USER_AGENT },
          redirect: 'follow',
          signal: ctl.signal,
        }).finally(() => clearTimeout(t));
        if (res.ok) {
          const text = await readCapped(res, ROBOTS_MAX_BYTES).then((r) => r.text);
          for (const line of text.split('\n')) {
            const m = line.match(/^\s*disallow\s*:\s*(\S+)/i);
            if (m) disallows.push(m[1]);
          }
        }
      } catch {
        // robots.txt unreadable: crawl anyway, the page fetch has its own guards
      }
      robots.set(host, disallows);
    }
    const list = robots.get(host);
    return !list.some((d) => d && path.startsWith(d));
  }

  // GET or HEAD a URL, following redirects manually so the checker can see
  // every hop (status, loops, cross-host). SSRF guard re-runs per hop.
  async function fetchUrl(url, { method = 'GET', checkRobots = false, wantBody = true } = {}) {
    const start = new URL(url);
    if (checkRobots && !(await robotsAllows(start.hostname, start.pathname))) {
      return { error: 'robots', status: null };
    }
    await waitForTurn(start.hostname);
    const hops = [];
    const visited = new Set([start.href]);
    let current = start.href;
    let crossHost = false;
    try {
      for (let i = 0; i < 5; i++) {
        await assertPublic(current);
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(current, {
            method,
            headers: { 'user-agent': USER_AGENT },
            redirect: 'manual',
            signal: ctl.signal,
          });
        } finally {
          clearTimeout(t);
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get('location');
          if (!loc) break;
          const next = new URL(loc, current);
          if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
          hops.push({ url: current, status: res.status });
          if (!sameSite(next.hostname, start.hostname)) crossHost = true;
          if (visited.has(next.href)) {
            hops.push({ url: next.href, status: 'loop' });
            break;
          }
          visited.add(next.href);
          current = next.href;
          continue;
        }
        const out = {
          status: res.status,
          headers: res.headers,
          hops,
          finalUrl: current,
          crossHost: crossHost || hops.length > 0 && !sameSite(new URL(current).hostname, start.hostname),
          error: null,
        };
        if (method === 'GET' && wantBody) {
          const { text, truncated } = await readCapped(res, maxBodyBytes);
          out.body = text;
          out.truncated = truncated;
        }
        return out;
      }
      return { status: null, hops, finalUrl: current, crossHost, error: 'too_many_redirects' };
    } catch (e) {
      if (e instanceof SsrfError) return { status: null, hops, finalUrl: current, crossHost, error: 'ssrf_refused' };
      return { status: null, hops, finalUrl: current, crossHost, error: classifyNetError(e) };
    } finally {
      lastHit.set(start.hostname, Date.now());
    }
  }

  return { fetchUrl, robotsAllows, USER_AGENT };
}

function classifyNetError(e) {
  const code = e && e.code;
  if (e && e.name === 'AbortError') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  return 'unreachable';
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      truncated = true;
      break;
    }
    chunks.push(value);
  }
  try {
    await reader.cancel();
  } catch {
    // already closed, fine
  }
  const buf = Buffer.concat(chunks);
  return { text: buf.toString('utf8'), truncated };
}
