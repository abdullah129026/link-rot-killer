import { createFetcher } from './fetch.js';

// Checks one non-page target. HEAD first (cheap), one GET retry on 405/501.
// Never marks 401/403/429 as broken: those become unverifiable, so anti-bot
// walls do not inflate the broken count. One retry with backoff on transient
// network failures: one timeout must not cry wolf.
export const CHECK_TIMEOUT_MS = 8000;
export const MAX_RETRY_AFTER_S = 15 * 60;

// Checks one target. YouTube embeds are detected from the URL itself: dead
// embeds return HTTP 200, so the oEmbed endpoint decides (200 live,
// 400/404 dead).
const YOUTUBE_URL = /(?:www\.youtube\.com|youtube-nocookie\.com)\/embed\/([\w-]{11})|youtu\.be\/([\w-]{11})/i;

export async function checkTarget({ url }, { fetchPage, oembedFetch } = {}) {
  const m = url.match(YOUTUBE_URL);
  if (m) return checkYouTube(m[1] || m[2], { oembedFetch });
  return checkHttp(url, { fetchPage });
}

function defaultOembed(id) {
  const watch = 'https://www.youtube.com/watch?v=' + id;
  return fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(watch) + '&format=json', {
    headers: { 'user-agent': 'LinkRotKiller/1.0' },
    redirect: 'manual',
  }).then((r) => ({ status: r.status }));
}

// Dead YouTube embeds return HTTP 200, so status-code checkers mark them
// healthy. The no-auth oEmbed endpoint tells live (200) from dead (400/404).
async function checkYouTube(id, { oembedFetch = defaultOembed } = {}) {
  let status;
  try {
    ({ status } = await oembedFetch(id));
  } catch {
    return { verdict: 'unverifiable', reason: 'unverifiable' };
  }
  if (status === 200) return { verdict: 'ok' };
  if (status === 400 || status === 404) return { verdict: 'broken', reason: 'dead_embed' };
  return { verdict: 'unverifiable', reason: 'unverifiable' };
}

async function checkHttp(url, { fetchPage } = {}) {
  const fetch = fetchPage || createFetcher({ timeoutMs: CHECK_TIMEOUT_MS }).fetchUrl;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await fetch(url, { method: 'HEAD', wantBody: false });
    } catch {
      r = { error: 'unreachable' };
    }
    if (r.error === 'ssrf_refused') return { verdict: 'unverifiable', reason: 'unverifiable' };
    if (r.error === 'too_many_redirects') {
      return { verdict: 'notice', reason: 'redirect_chain', finalUrl: r.finalUrl };
    }
    if (r.error && r.error !== 'too_many_redirects') {
      if (attempt === 0 && isTransient(r.error)) {
        await sleep(1000);
        continue;
      }
      return { verdict: 'broken', reason: 'unreachable', error: r.error };
    }
    if (r.status === 405 || r.status === 501) {
      try {
        r = await fetch(url, { method: 'GET', wantBody: false });
      } catch {
        return { verdict: 'broken', reason: 'unreachable', error: 'unreachable' };
      }
    }
    const s = r.status;
    if (s === 401 || s === 403) return { verdict: 'unverifiable', reason: 'unverifiable' };
    if (s === 429) {
      const wait = retryAfterSeconds(r.headers);
      if (wait !== null) {
        return { verdict: 'requeue', notBefore: Date.now() + Math.min(wait, MAX_RETRY_AFTER_S) * 1000 };
      }
      return { verdict: 'unverifiable', reason: 'unverifiable' };
    }
    if (s >= 400) {
      return {
        verdict: 'broken',
        reason: s < 500 ? 'http_4xx' : 'http_5xx',
        statusCode: s,
        finalUrl: r.finalUrl,
      };
    }
    if (s >= 200 && s < 400) {
      if (r.error === 'too_many_redirects' || r.hops.length >= 3 || r.crossHost) {
        return { verdict: 'notice', reason: 'redirect_chain', statusCode: s, finalUrl: r.finalUrl };
      }
      return { verdict: 'ok', statusCode: s, finalUrl: r.finalUrl };
    }
    if (attempt === 0) {
      await sleep(1000);
      continue;
    }
    return { verdict: 'unverifiable', reason: 'unverifiable' };
  }
  return { verdict: 'unverifiable', reason: 'unverifiable' };
}

function isTransient(error) {
  return error === 'timeout' || error === 'dns' || error === 'unreachable';
}

function retryAfterSeconds(headers) {
  if (!headers) return null;
  // fetch gives a Headers instance, node:http gives a plain object
  const v = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (!v) return null;
  const n = parseInt(v, 10);
  if (!Number.isNaN(n) && n >= 0) return n;
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
