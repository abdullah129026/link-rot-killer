import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedScan, runTick } from '../lib/crawl/tick.js';

// In-memory fake of the db.js store interface: exercises the runner's
// orchestration (claim, dedupe, edges, findings, stats, done transition)
// without Postgres. The SQL itself is verified against live Supabase at
// deploy time.
function fakeStore() {
  const db = {
    scans: new Map(),
    targets: [],
    findings: [],
    edges: [],
    stats: {},
    nextId: 1,
  };
  const store = {
    async getScan(d, id) {
      return d.scans.get(id);
    },
    async insertTargets(d, rows) {
      for (const r of rows) {
        if (d.targets.some((t) => t.scan_id === r.scan_id && t.normalized_url === r.normalized_url)) continue;
        d.targets.push({ id: 't' + d.nextId++, checked_at: null, claimed_at: null, not_before: null, ...r });
      }
    },
    async patchScan(d, id, patch) {
      Object.assign(d.scans.get(id), patch);
    },
    async claimTargets(d, scanId, limit) {
      const now = new Date();
      const found = d.targets
        .filter(
          (t) =>
            t.scan_id === scanId &&
            t.status === 'pending' &&
            (!t.not_before || new Date(t.not_before) <= now)
        )
        .sort((a, b) => a.depth - b.depth)
        .slice(0, limit);
      for (const t of found) {
        t.status = 'in_progress';
        t.claimed_at = now.toISOString();
      }
      return found;
    },
    async countTargets(d, scanId) {
      const rows = d.targets.filter((t) => t.scan_id === scanId);
      return { total: rows.length, pages: rows.filter((r) => r.kind === 'page').length };
    },
    async getTargetIds(d, scanId, urls) {
      const m = new Map();
      for (const t of d.targets) {
        if (t.scan_id === scanId && urls.includes(t.normalized_url)) m.set(t.normalized_url, t.id);
      }
      return m;
    },
    async insertEdges(d, rows) {
      for (const r of rows) {
        if (d.edges.some((e) => e.target_id === r.target_id && e.source_target_id === r.source_target_id)) continue;
        d.edges.push(r);
      }
    },
    async getSources(d, targetId) {
      return d.edges
        .filter((e) => e.target_id === targetId)
        .map((e) => {
          const s = d.targets.find((t) => t.id === e.source_target_id);
          return { url: s.url, depth: s.depth, context: e.context };
        });
    },
    async insertFinding(d, row) {
      d.findings.push(row);
    },
    async markTargetDone(d, id, patch) {
      Object.assign(d.targets.find((t) => t.id === id), { status: 'done' }, patch);
    },
    async requeueTarget(d, id, notBefore) {
      Object.assign(d.targets.find((t) => t.id === id), {
        status: 'pending',
        claimed_at: null,
        not_before: new Date(notBefore).toISOString(),
      });
    },
    async bumpStats(d, scanId, deltas) {
      const s = (d.stats[scanId] = d.stats[scanId] || { pages: 0, targets: 0, broken: 0, unverifiable: 0 });
      for (const k of Object.keys(deltas)) s[k] += deltas[k];
    },
    async addNotice(d, scanId, notice) {
      const s = d.scans.get(scanId);
      s.stats.notices = [...(s.stats.notices || [])];
      if (!s.stats.notices.includes(notice)) s.stats.notices.push(notice);
    },
    async countOpen(d, scanId) {
      const lease = Date.now() - 10 * 60 * 1000;
      return d.targets.filter(
        (t) =>
          t.scan_id === scanId &&
          (t.status === 'pending' || (t.status === 'in_progress' && new Date(t.claimed_at).getTime() > lease))
      ).length;
    },
    async listFindingsForScore(d, scanId) {
      return d.findings.filter((f) => f.scan_id === scanId);
    },
    async setScanDone(d, scanId, health) {
      Object.assign(d.scans.get(scanId), { status: 'done', health_score: health });
    },
    async touchThrottle() {},
  };
  return { db, store };
}

function seedDb(db, overrides = {}) {
  db.scans.set('s1', {
    id: 's1',
    site_id: null,
    status: 'queued',
    seed_url: 'https://example.com/sitemap.xml',
    stats: {},
    max_pages: 200,
    ...overrides,
  });
}

const htmlHeaders = () => new Headers({ 'content-type': 'text/html' });

test('seedScan inserts sitemap pages without the fallback notice', async () => {
  const { db, store } = fakeStore();
  seedDb(db);
  const fetchPage = async () => ({ status: 200, body: '<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>' });
  const r = await seedScan({ db, store, fetchPage }, 's1');
  assert.equal(r.seeded, 2);
  assert.deepEqual(r.notices, []);
  assert.equal(db.scans.get('s1').status, 'crawling');
  assert.ok(db.targets.every((t) => t.kind === 'page' && t.depth === 0));
});

test('seedScan falls back to homepage discovery with the notice', async () => {
  const { db, store } = fakeStore();
  seedDb(db);
  const fetchPage = async () => ({ status: 200, body: '<html>not a sitemap</html>' });
  const r = await seedScan({ db, store, fetchPage }, 's1');
  assert.equal(r.seeded, 1);
  assert.deepEqual(r.notices, ['sitemap_fallback']);
  assert.equal(db.targets[0].url, 'https://example.com/sitemap.xml');
});

test('runTick crawls a page, queues discoveries, writes findings with edges', async () => {
  const { db, store } = fakeStore();
  seedDb(db, { status: 'crawling', seed_url: 'https://example.com/' });
  db.targets.push({
    id: 't0', scan_id: 's1', url: 'https://example.com/', normalized_url: 'https://example.com/',
    kind: 'page', depth: 0, host: 'example.com', status: 'pending', claimed_at: null, not_before: null,
  });
  const fetchPage = async () => ({
    status: 200,
    headers: htmlHeaders(),
    body: '<a href="/dead">dead page</a><a href="https://other.com/x">out</a><img data-src="/i.png" alt="pic">',
    finalUrl: 'https://example.com/',
    error: null,
  });
  const check = async ({ url }) =>
    url.includes('other.com')
      ? { verdict: 'broken', reason: 'http_4xx', statusCode: 404 }
      : url.endsWith('/i.png')
        ? { verdict: 'ok', statusCode: 200 }
        : { verdict: 'broken', reason: 'http_4xx', statusCode: 404 };
  // the dead internal page itself 404s when crawled
  const pageFetch = async (url) => {
    if (url === 'https://example.com/dead') return { status: 404, headers: htmlHeaders(), error: null };
    return fetchPage(url);
  };
  let r = await runTick({ db, store, fetchPage: pageFetch, check, budgetMs: 60000 }, 's1');
  assert.equal(r.ticked, true);
  assert.equal(r.done, false); // the /dead page target is still pending
  // discoveries: /dead (page), other.com/x (link), /i.png (image)
  const kinds = db.targets.map((t) => t.kind).sort();
  assert.deepEqual(kinds, ['image', 'link', 'page', 'page']);

  r = await runTick({ db, store, fetchPage: pageFetch, check, budgetMs: 60000 }, 's1');
  assert.equal(r.done, true);
  // the external broken link got a finding with the anchor as context
  const ext = db.findings.find((f) => f.target_url === 'https://other.com/x');
  assert.ok(ext);
  assert.equal(ext.reason, 'http_4xx');
  assert.equal(ext.severity, 'warning'); // outbound base 20, one inlink
  assert.deepEqual(ext.sources, [{ url: 'https://example.com/', context: 'out' }]);
  const deadFinding = db.findings.find((f) => f.target_url === 'https://example.com/dead');
  assert.ok(deadFinding);
  assert.equal(deadFinding.severity, 'error'); // broken internal base 40
  assert.equal(db.scans.get('s1').status, 'done');
  assert.ok(db.scans.get('s1').health_score < 100);
  assert.equal(db.stats.s1.pages, 2);
  assert.equal(db.stats.s1.targets, 2);
  assert.equal(db.stats.s1.broken, 2);
});

test('dedupe: the same url from two pages becomes one target with two edges', async () => {
  const { db, store } = fakeStore();
  seedDb(db, { status: 'crawling', seed_url: 'https://example.com/' });
  for (const p of ['/a', '/b']) {
    db.targets.push({
      id: 't' + p, scan_id: 's1', url: 'https://example.com' + p, normalized_url: 'https://example.com' + p,
      kind: 'page', depth: 0, host: 'example.com', status: 'pending', claimed_at: null, not_before: null,
    });
  }
  const fetchPage = async () => ({
    status: 200, headers: htmlHeaders(), body: '<a href="https://other.com/x">x</a>', finalUrl: 'https://example.com/', error: null,
  });
  const check = async () => ({ verdict: 'ok', statusCode: 200 });
  await runTick({ db, store, fetchPage, check, budgetMs: 60000, claimLimit: 10 }, 's1');
  const ext = db.targets.filter((t) => t.normalized_url === 'https://other.com/x');
  assert.equal(ext.length, 1);
  assert.equal(db.edges.filter((e) => e.target_id === ext[0].id).length, 2);
});

test('429 requeues the target instead of counting it', async () => {
  const { db, store } = fakeStore();
  seedDb(db, { status: 'crawling', seed_url: 'https://example.com/' });
  db.targets.push({
    id: 't0', scan_id: 's1', url: 'https://other.com/x', normalized_url: 'https://other.com/x',
    kind: 'link', depth: 1, host: 'other.com', status: 'pending', claimed_at: null, not_before: null,
  });
  const check = async () => ({ verdict: 'requeue', notBefore: Date.now() + 60000 });
  const r = await runTick({ db, store, check, budgetMs: 60000 }, 's1');
  assert.equal(r.done, false);
  const t = db.targets[0];
  assert.equal(t.status, 'pending');
  assert.ok(t.not_before);
  assert.equal(db.findings.length, 0);
  assert.equal(db.stats.s1.targets, 0);
});

test('max_pages trims page discovery', async () => {
  const { db, store } = fakeStore();
  seedDb(db, { status: 'crawling', seed_url: 'https://example.com/', max_pages: 1 });
  db.targets.push({
    id: 't0', scan_id: 's1', url: 'https://example.com/', normalized_url: 'https://example.com/',
    kind: 'page', depth: 0, host: 'example.com', status: 'pending', claimed_at: null, not_before: null,
  });
  const fetchPage = async () => ({
    status: 200, headers: htmlHeaders(),
    body: '<a href="/a">a</a><a href="/b">b</a>', finalUrl: 'https://example.com/', error: null,
  });
  const check = async () => ({ verdict: 'ok', statusCode: 200 });
  await runTick({ db, store, fetchPage, check, budgetMs: 60000 }, 's1');
  assert.equal(db.targets.filter((t) => t.kind === 'page').length, 1);
  assert.ok(db.scans.get('s1').stats.notices.includes('cap_reached'));
});
