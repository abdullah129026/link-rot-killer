import { createFetcher } from './fetch.js';

// Sitemaps are machine-written XML, so a <loc> regex beats a full parser
// here. Follows sitemapindex recursion (max 5 index files) and accepts
// plain-text sitemaps (one URL per line). Hard caps keep a hostile or
// sloppy sitemap from blowing the scan budget.
export const MAX_INDEX_FILES = 5;
export const MAX_LOCS = 10000;
export const SEED_BODY_CAP = 2 * 1024 * 1024;
export const SEED_TIMEOUT_MS = 10000;

export function parseSitemapBody(text) {
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  if (/<sitemapindex[\s>]/i.test(text)) return { kind: 'index', locs };
  if (/<urlset[\s>]/i.test(text)) return { kind: 'urlset', locs };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/i.test(l));
  if (lines.length) return { kind: 'txt', locs: lines };
  return { kind: 'unknown', locs: [] };
}

// Returns { urls, kind, notices }. kind is 'sitemap' when the seed parsed as
// one, 'fallback' when the caller should discover from the homepage instead.
export async function fetchSitemapSeed(seedUrl, { fetchPage } = {}) {
  const fetch = fetchPage || createFetcher({ timeoutMs: SEED_TIMEOUT_MS, maxBodyBytes: SEED_BODY_CAP }).fetchUrl;
  const notices = [];
  let res;
  try {
    res = await fetch(seedUrl, { method: 'GET', wantBody: true });
  } catch {
    return { urls: [], kind: 'fallback', notices };
  }
  if (res.error || res.status !== 200 || !res.body) {
    return { urls: [], kind: 'fallback', notices };
  }
  const first = parseSitemapBody(res.body);
  if (first.kind === 'unknown' || !first.locs.length) {
    return { urls: [], kind: 'fallback', notices };
  }
  if (first.kind !== 'index') {
    return { urls: first.locs.slice(0, MAX_LOCS), kind: 'sitemap', notices };
  }
  const urls = [];
  for (const indexUrl of first.locs.slice(0, MAX_INDEX_FILES)) {
    let r;
    try {
      r = await fetch(indexUrl, { method: 'GET', wantBody: true });
    } catch {
      continue;
    }
    if (r.error || r.status !== 200 || !r.body) continue;
    const part = parseSitemapBody(r.body);
    if (part.kind === 'index') continue; // no nested indexes, one level is enough
    urls.push(...part.locs);
    if (urls.length >= MAX_LOCS) {
      notices.push('cap_reached');
      break;
    }
  }
  if (first.locs.length > MAX_INDEX_FILES) notices.push('index_cap_reached');
  return { urls: urls.slice(0, MAX_LOCS), kind: 'sitemap', notices };
}
