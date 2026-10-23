import { createFetcher, sameSite } from './fetch.js';
import { extractTargets } from './extract.js';
import { fetchSitemapSeed } from './sitemap.js';
import { checkTarget } from './checker.js';
import { normalizeUrl } from './normalize.js';
import { baseForFinding, impactScore, severityOf, healthScore, fingerprint } from './score.js';
import * as realStore from '../db.js';

// Chunked serverless crawl: one tick claims up to 50 pending targets with
// SELECT ... FOR UPDATE SKIP LOCKED (safe under overlapping ticks) and
// processes them inside a time budget, then writes stats back with one
// atomic statement. A scan finishes across many ticks; a watched scan is
// driven by the progress page polling /tick, unattended scans by cron.
//
// Verified 2026-10-23: Vercel Hobby hard-caps functions at 10s (maxDuration
// is not honored) and cron at once per day. The 7s budget leaves headroom
// for cold starts and the final DB writes. (ponytail: the ceiling is
// throughput, a few dozen targets per tick. The upgrade path is a longer
// budget on a paid plan or a dedicated worker.)
export const TICK_BUDGET_MS = 7000;
export const CLAIM_LIMIT = 50;
export const MAX_TARGETS = 3000;
export const PAGE_DEPTH_LIMIT = 6;

async function eachLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

// Seed: fetch the seed URL as a sitemap; fall back to homepage discovery
// when it is not one. The scan page shows which path was taken.
export async function seedScan(deps, scanId) {
  const { db, store = realStore, fetchPage } = deps;
  const scan = await store.getScan(db, scanId);
  const notices = [];
  const seed = await fetchSitemapSeed(scan.seed_url, { fetchPage });
  let pageUrls;
  if (seed.kind === 'sitemap') {
    pageUrls = seed.urls;
    notices.push(...seed.notices);
  } else {
    pageUrls = [scan.seed_url];
    notices.push('sitemap_fallback');
  }
  const rows = [];
  const seen = new Set();
  for (const raw of pageUrls) {
    const normalized = normalizeUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (rows.length >= Math.min(scan.max_pages, MAX_TARGETS)) {
      notices.push('cap_reached');
      break;
    }
    rows.push({
      scan_id: scanId,
      url: raw,
      normalized_url: normalized,
      kind: 'page',
      depth: 0,
      host: new URL(normalized).hostname,
      status: 'pending',
    });
  }
  await store.insertTargets(db, rows);
  await store.patchScan(db, scanId, { status: 'crawling', stats: { ...(scan.stats || {}), notices } });
  return { seeded: rows.length, notices };
}

export async function runTick(deps, scanId) {
  const {
    db,
    store = realStore,
    fetchPage,
    check = checkTarget,
    now = Date.now,
    budgetMs = TICK_BUDGET_MS,
    claimLimit = CLAIM_LIMIT,
    concurrency = 6,
  } = deps;

  const scan = await store.getScan(db, scanId);
  if (!scan || (scan.status !== 'queued' && scan.status !== 'crawling')) return { ticked: false };
  if (scan.status === 'queued') await seedScan(deps, scanId);

  const fetcher = createFetcher();
  const page = fetchPage || ((url, opts) => fetcher.fetchUrl(url, opts));
  const seedHost = new URL(scan.seed_url).hostname;
  const counts = await store.countTargets(db, scanId);
  const ctx = { scan, seedHost, page, check, stats: { pages: 0, targets: 0, broken: 0, unverifiable: 0 }, counts };

  const targets = await store.claimTargets(db, scanId, claimLimit);
  const deadline = now() + budgetMs;
  const touchedHosts = new Set();
  let capped = false;

  const byHost = new Map();
  for (const t of targets) {
    const h = t.host || 'unknown';
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(t);
  }

  // Hosts run in parallel; each host's targets run serially with the 750ms
  // spacing enforced inside the fetcher, so one host is never hammered.
  await eachLimit([...byHost.values()], concurrency, async (group) => {
    for (const t of group) {
      if (now() > deadline) break;
      touchedHosts.add(t.host);
      if (t.kind === 'page') await processPage(deps, ctx, t);
      else await processCheck(deps, ctx, t);
      if (ctx.counts.pages >= scan.max_pages || ctx.counts.total >= MAX_TARGETS) capped = true;
    }
  });

  for (const host of touchedHosts) {
    try {
      await store.touchThrottle(db, host);
    } catch {
      // best-effort ledger, never fails the tick
    }
  }
  await store.bumpStats(db, scanId, ctx.stats);

  if (capped) await store.addNotice(db, scanId, 'cap_reached');
  if ((await store.countOpen(db, scanId)) === 0) {
    const findings = await store.listFindingsForScore(db, scanId);
    await store.setScanDone(db, scanId, healthScore(findings));
    return { ticked: true, processed: targets.length, done: true };
  }
  return { ticked: true, processed: targets.length, done: false };
}

async function processPage(deps, ctx, t) {
  const { db, store = realStore } = deps;
  const { scan, seedHost, page, stats, counts } = ctx;
  let r;
  try {
    r = await page(t.url, { method: 'GET', wantBody: true, checkRobots: true });
  } catch {
    r = { error: 'unreachable' };
  }
  const internal = sameSite(t.host || '', seedHost);
  if (r.error === 'robots' || r.error === 'ssrf_refused') {
    await store.markTargetDone(db, t.id, {});
    return;
  }
  if (r.error || r.status >= 400) {
    // A page that 4xx/5xxs or DNS-fails is a broken internal link for every
    // page that points at it.
    const reason = r.status >= 500 ? 'http_5xx' : r.status >= 400 ? 'http_4xx' : 'unreachable';
    await writeFinding(deps, ctx, t, { kind: 'link', internal, reason, statusCode: r.status || null });
    await store.markTargetDone(db, t.id, { status_code: r.status || null });
    stats.pages += 1;
    stats.broken += 1;
    return;
  }
  const contentType = String((r.headers && r.headers.get('content-type')) || '');
  if (r.status === 200 && r.body && contentType.includes('html')) {
    await extractAndQueue(deps, ctx, t, r.body);
  }
  await store.markTargetDone(db, t.id, { status_code: r.status, final_url: r.finalUrl || null });
  stats.pages += 1;
}

async function extractAndQueue(deps, ctx, pageTarget, html) {
  const { db, store = realStore } = deps;
  const { scan, seedHost, counts } = ctx;
  const { links, images, iframes, embeds } = extractTargets(html, pageTarget.url);

  const cand = [];
  for (const l of links) {
    const host = hostOf(l.url);
    const internal = host !== null && sameSite(host, seedHost);
    cand.push({
      url: l.url,
      kind: internal ? 'page' : 'link',
      internal,
      context: l.anchor,
      depth: pageTarget.depth + 1,
    });
  }
  for (const i of images) cand.push({ url: i.url, kind: 'image', internal: false, context: i.alt, depth: pageTarget.depth });
  for (const f of iframes) cand.push({ url: f.url, kind: 'iframe', internal: false, context: null, depth: pageTarget.depth });
  for (const e of embeds) cand.push({ url: e.url, kind: 'embed', internal: false, context: null, depth: pageTarget.depth });

  const rows = [];
  const ctxByNorm = new Map();
  const seen = new Set();
  for (const c of cand) {
    if (c.kind === 'page' && (c.depth > PAGE_DEPTH_LIMIT || counts.pages >= scan.max_pages)) continue;
    if (counts.total + rows.length >= MAX_TARGETS) break;
    const normalized = normalizeUrl(c.url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ctxByNorm.set(normalized, c.context);
    rows.push({
      scan_id: scan.id,
      url: c.url,
      normalized_url: normalized,
      kind: c.kind,
      depth: c.depth,
      host: hostOf(normalized),
      status: 'pending',
    });
  }
  if (!rows.length) return;
  // Insert only genuinely new targets (the upsert would swallow dupes and
  // throw the cap accounting off); edges are recorded for all of them.
  const existing = await store.getTargetIds(db, scan.id, rows.map((r) => r.normalized_url));
  const fresh = rows.filter((r) => !existing.has(r.normalized_url));
  await store.insertTargets(db, fresh);
  const ids = await store.getTargetIds(db, scan.id, rows.map((r) => r.normalized_url));
  const edges = [];
  for (const [normalized, id] of ids) {
    edges.push({ target_id: id, source_target_id: pageTarget.id, context: ctxByNorm.get(normalized) });
  }
  await store.insertEdges(db, edges);
  counts.total += fresh.length;
  counts.pages += fresh.filter((r) => r.kind === 'page').length;
}

async function processCheck(deps, ctx, t) {
  const { db, store = realStore } = deps;
  const { check, stats } = ctx;
  let c;
  try {
    c = await check({ url: t.url });
  } catch {
    c = { verdict: 'unverifiable', reason: 'unverifiable' };
  }
  if (c.verdict === 'ok') {
    await store.markTargetDone(db, t.id, { status_code: c.statusCode || null, final_url: c.finalUrl || null });
    stats.targets += 1;
  } else if (c.verdict === 'requeue') {
    await store.requeueTarget(db, t.id, c.notBefore);
  } else if (c.verdict === 'broken' || c.verdict === 'unverifiable' || c.verdict === 'notice') {
    const internal = t.kind !== 'link' || sameSite(t.host || '', ctx.seedHost);
    await writeFinding(deps, ctx, t, { kind: t.kind, internal, reason: c.reason, statusCode: c.statusCode || null });
    await store.markTargetDone(db, t.id, { status_code: c.statusCode || null, final_url: c.finalUrl || null });
    stats.targets += 1;
    if (c.verdict === 'broken') stats.broken += 1;
    else if (c.verdict === 'unverifiable') stats.unverifiable += 1;
  }
  // 'requeue' verdicts do not count as checked; the target goes back to pending
}

async function writeFinding(deps, ctx, t, { kind, internal, reason, statusCode }) {
  const { db, store = realStore } = deps;
  const { scan } = ctx;
  const sources = await store.getSources(db, t.id);
  const sourceCount = Math.max(1, sources.length);
  const depth = sources.length ? Math.min(...sources.map((s) => s.depth)) : t.depth;
  const base = baseForFinding({ kind, internal, reason });
  const score = impactScore({ base, sourceCount, depth });
  await store.insertFinding(db, {
    scan_id: scan.id,
    fingerprint: fingerprint({ siteId: scan.site_id, normalizedUrl: t.normalized_url, kind, reason }),
    target_url: t.url,
    kind,
    reason,
    severity: severityOf(score, reason),
    impact_score: score,
    sources: sources.map((s) => ({ url: s.url, context: s.context })),
    checked_at: new Date().toISOString(),
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
