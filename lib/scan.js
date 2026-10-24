import crypto from 'node:crypto';
import { normalizeUrl } from './crawl/normalize.js';
import { assertPublicUrl, SsrfError } from './crawl/ssrf.js';
import { sameSite } from './crawl/fetch.js';
import { impactScore } from './crawl/score.js';

// Scan lifecycle, ownership, quota, triage, grouping, CSV, before/after.
// Pure helpers live here so the route handlers stay thin and the math is
// unit-testable without Postgres.

export const ANON_DAILY_LIMIT = 3;
export const SIGNED_DAILY_LIMIT = 20;
export const FINDINGS_PER_PAGE = 50;

export class SeedUrlError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Validate the pasted URL before any row is written: it must be a public
// http(s) address. The fetcher's SSRF guard would refuse it later, but a
// fast, clear 400 here beats a scan that dies on its first tick.
export async function validateSeedUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new SeedUrlError('empty', 'Paste a sitemap or homepage URL.');
  if (input.length > 2048) throw new SeedUrlError('too_long', 'That URL is too long.');
  const normalized = normalizeUrl(input);
  if (!normalized) throw new SeedUrlError('bad_url', 'That is not a valid http(s) URL.');
  try {
    await assertPublicUrl(normalized);
  } catch (e) {
    if (e instanceof SsrfError) throw new SeedUrlError('private', 'That host does not resolve to a public address.');
    throw new SeedUrlError('dns', 'Could not resolve that host.');
  }
  return normalized;
}

export function randomClaimToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Vercel puts the client address first in x-forwarded-for. It is
// client-spoofable in theory; IPv6 /64 sharing and NAT imprecision are
// accepted and documented, because this only gates the free quota.
export function clientIp(headers) {
  const xff = headers.get('x-forwarded-for');
  const first = xff ? xff.split(',')[0].trim() : '';
  return first || 'unknown';
}

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function overQuota(count, limit) {
  return count >= limit;
}

// Owner mode: the signed-in site owner, or the anonymous claim token from
// the cookie. Everyone else gets the read-only client view.
export function ownsScan(scan, { cookieToken, userId } = {}) {
  if (!scan) return false;
  const ownerId = scan.site ? scan.site.owner_user_id : scan.owner_user_id;
  if (userId && ownerId && userId === ownerId) return true;
  if (cookieToken && scan.claim_token && cookieToken === scan.claim_token) return true;
  return false;
}

// Cookie-authed mutations check Origin against Host so a foreign page
// cannot drive someone else's browser into triaging their scan.
export function originOk(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function claimCookieName(scanId) {
  return 'lkr_claim_' + scanId;
}

// Sentry-style triage: a decision can only be undone back to open, never
// flipped straight from fixed to ignored.
const TRANSITIONS = {
  open: new Set(['fixed', 'ignored']),
  fixed: new Set(['open']),
  ignored: new Set(['open']),
};

export function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].has(to));
}

// A re-scan seeds triage state from the previous scan: ignored stays
// ignored; anything that reappears after being marked fixed regresses to
// open (the default), because the fix did not hold.
export function carriedState(carryover, fingerprintValue) {
  if (carryover && carryover.get(fingerprintValue) === 'ignored') return 'ignored';
  return 'open';
}

// Issue types: findings are grouped by these on the scan page and the PDF.
export function issueType(finding, seedHost) {
  const { kind, reason, target_url } = finding;
  if (reason === 'unverifiable') return 'unverifiable';
  if (reason === 'redirect_chain') return 'redirect_chain';
  if (reason === 'dead_embed') return 'dead_embed';
  if (kind === 'image') return 'broken_image';
  if (kind === 'iframe') return 'broken_iframe';
  if (kind === 'embed') return 'broken_embed';
  let host = null;
  try {
    host = new URL(target_url).hostname;
  } catch {
    host = null;
  }
  return host && seedHost && sameSite(host, seedHost) ? 'broken_internal' : 'broken_outbound';
}

export const GROUP_DEFS = {
  broken_internal: {
    label: 'Broken internal links',
    remediation: 'Fix or redirect these first: they waste crawl budget and break navigation on your own site.',
  },
  broken_outbound: {
    label: 'Broken outbound links',
    remediation: 'Replace with a live URL or remove the link; dead outbound links erode reader trust.',
  },
  broken_image: {
    label: 'Broken images',
    remediation: 'Re-upload the image or fix the src; broken images hurt the page visually and in image search.',
  },
  broken_iframe: {
    label: 'Broken iframes',
    remediation: 'Check the embedded page URL; an iframe that fails to load leaves a blank hole in the page.',
  },
  broken_embed: {
    label: 'Broken embeds',
    remediation: 'Check the embed source URL and replace it if the content moved or was removed.',
  },
  dead_embed: {
    label: 'Dead video embeds',
    remediation: 'The video was deleted or made private; swap in a live video or remove the embed.',
  },
  redirect_chain: {
    label: 'Redirect chains',
    remediation: 'Point the link at the final URL to cut the extra hops and keep link equity.',
  },
  unverifiable: {
    label: "Couldn't verify",
    remediation: 'These sites block automated checks. They are listed for completeness and never count as broken.',
  },
};

export const GROUP_ORDER = [
  'broken_internal',
  'broken_outbound',
  'broken_image',
  'dead_embed',
  'broken_iframe',
  'broken_embed',
  'redirect_chain',
  'unverifiable',
];

export function groupFindings(findings, seedHost) {
  const groups = new Map();
  for (const f of findings) {
    const key = issueType(f, seedHost);
    if (!groups.has(key)) groups.set(key, { key, label: GROUP_DEFS[key].label, findings: [] });
    groups.get(key).findings.push(f);
  }
  return [...groups.values()]
    .map((g) => {
      g.findings.sort((a, b) => b.impact_score - a.impact_score);
      g.count = g.findings.length;
      g.worst = g.findings[0] ? g.findings[0].severity : 'notice';
      // Points the health score would recover if every open finding in
      // this group were fixed.
      g.recoverable = Math.round(
        g.findings
          .filter((f) => f.state === 'open' && f.reason !== 'unverifiable')
          .reduce((s, f) => s + f.impact_score / 10, 0)
      );
      return g;
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key));
}

export function paginate(items, page, perPage = FINDINGS_PER_PAGE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safe = Math.min(Math.max(1, page || 1), totalPages);
  return {
    items: items.slice((safe - 1) * perPage, safe * perPage),
    page: safe,
    totalPages,
    total,
  };
}

// Before/after across scans is presence/absence of fingerprints,
// independent of manual triage.
export function beforeAfter(prevFindings, curFindings) {
  const prev = new Set(prevFindings.map((f) => f.fingerprint));
  const cur = new Set(curFindings.map((f) => f.fingerprint));
  return {
    newSince: curFindings.filter((f) => !prev.has(f.fingerprint)),
    fixedSince: prevFindings.filter((f) => !cur.has(f.fingerprint)),
  };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// One row per finding with full context: the shape the PDF appendix uses.
export function findingsToCsv(findings) {
  const header = ['target_url', 'kind', 'reason', 'severity', 'impact_score', 'state', 'source_pages', 'context'];
  const lines = [header.join(',')];
  for (const f of findings) {
    const sources = Array.isArray(f.sources) ? f.sources : [];
    lines.push(
      [
        f.target_url,
        f.kind,
        f.reason,
        f.severity,
        f.impact_score,
        f.state,
        sources.map((s) => s.url).join('; '),
        sources
          .map((s) => s.context)
          .filter(Boolean)
          .join(' | '),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function csvFileName(siteName, when = new Date()) {
  const slug = String(siteName || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return 'linkrot-' + (slug || 'scan') + '-' + when.toISOString().slice(0, 10) + '.csv';
}

// The formulas page and this test share the same worked example.
export function workedExample() {
  // Broken internal link (base 40), linked from 3 pages, the shallowest
  // at depth 2: multiplier 1 + 0.5 x (3 - 1) = 2, depth factor 0.8.
  return {
    base: 40,
    sourceCount: 3,
    depth: 2,
    score: impactScore({ base: 40, sourceCount: 3, depth: 2 }),
  };
}
