import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSeedUrl,
  SeedUrlError,
  clientIp,
  startOfUtcDay,
  overQuota,
  ownsScan,
  originOk,
  claimCookieName,
  canTransition,
  carriedState,
  issueType,
  GROUP_DEFS,
  GROUP_ORDER,
  groupFindings,
  paginate,
  beforeAfter,
  findingsToCsv,
  csvFileName,
  workedExample,
} from '../lib/scan.js';
import { impactScore, healthScore, severityOf } from '../lib/crawl/score.js';

test('validateSeedUrl rejects before any DNS lookup', async () => {
  await assert.rejects(() => validateSeedUrl(''), (e) => e instanceof SeedUrlError && e.code === 'empty');
  await assert.rejects(() => validateSeedUrl('not a url'), (e) => e.code === 'bad_url');
  await assert.rejects(() => validateSeedUrl('ftp://example.com/x'), (e) => e.code === 'bad_url');
  await assert.rejects(() => validateSeedUrl('https://x.com/' + 'a'.repeat(2048)), (e) => e.code === 'too_long');
});

test('clientIp takes the first forwarded-for entry', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });
  assert.equal(clientIp(h), '203.0.113.7');
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('startOfUtcDay truncates to the UTC midnight', () => {
  const d = new Date('2026-10-24T09:52:00+05:00');
  assert.equal(startOfUtcDay(d).toISOString(), '2026-10-24T00:00:00.000Z');
});

test('overQuota enforces the daily cap', () => {
  assert.equal(overQuota(2, 3), false);
  assert.equal(overQuota(3, 3), true);
  assert.equal(overQuota(19, 20), false);
});

test('ownsScan: claim token cookie or owner user, never neither', () => {
  const scan = { claim_token: 'tok123', site: { owner_user_id: 'u1' } };
  assert.equal(ownsScan(scan, { cookieToken: 'tok123' }), true);
  assert.equal(ownsScan(scan, { cookieToken: 'wrong' }), false);
  assert.equal(ownsScan(scan, { userId: 'u1' }), true);
  assert.equal(ownsScan(scan, { userId: 'u2' }), false);
  assert.equal(ownsScan(scan, {}), false);
  assert.equal(ownsScan(null, {}), false);
});

test('originOk allows missing origin, matches same-origin posts', () => {
  assert.equal(originOk({ headers: new Headers(), url: 'https://app.com/x' }), true);
  assert.equal(
    originOk({ headers: new Headers({ origin: 'https://app.com' }), url: 'https://app.com/x' }),
    true
  );
  assert.equal(
    originOk({ headers: new Headers({ origin: 'https://evil.com' }), url: 'https://app.com/x' }),
    false
  );
});

test('claimCookieName is stable per scan', () => {
  assert.equal(claimCookieName('abc-123'), 'lkr_claim_abc-123');
});

test('triage transitions: decisions undo only to open', () => {
  assert.equal(canTransition('open', 'fixed'), true);
  assert.equal(canTransition('open', 'ignored'), true);
  assert.equal(canTransition('fixed', 'open'), true);
  assert.equal(canTransition('ignored', 'open'), true);
  assert.equal(canTransition('fixed', 'ignored'), false);
  assert.equal(canTransition('ignored', 'fixed'), false);
  assert.equal(canTransition('open', 'open'), true);
});

test('carriedState: ignored stays ignored, everything else opens', () => {
  const carry = new Map([['fp1', 'ignored'], ['fp2', 'fixed'], ['fp3', 'open']]);
  assert.equal(carriedState(carry, 'fp1'), 'ignored');
  assert.equal(carriedState(carry, 'fp2'), 'open');
  assert.equal(carriedState(carry, 'fp3'), 'open');
  assert.equal(carriedState(carry, 'fp9'), 'open');
  assert.equal(carriedState(null, 'fp1'), 'open');
  assert.equal(carriedState(new Map(), 'fp1'), 'open');
});

test('issueType classifies findings for grouping', () => {
  const seed = 'example.com';
  assert.equal(issueType({ kind: 'embed', reason: 'dead_embed', target_url: 'https://x.com/a' }, seed), 'dead_embed');
  assert.equal(issueType({ kind: 'link', reason: 'unverifiable', target_url: 'https://x.com/a' }, seed), 'unverifiable');
  assert.equal(
    issueType({ kind: 'link', reason: 'http_4xx', target_url: 'https://example.com/a' }, seed),
    'broken_internal'
  );
  assert.equal(
    issueType({ kind: 'page', reason: 'http_5xx', target_url: 'https://example.com/a' }, seed),
    'broken_internal'
  );
  assert.equal(
    issueType({ kind: 'link', reason: 'http_4xx', target_url: 'https://other.com/a' }, seed),
    'broken_outbound'
  );
  assert.equal(issueType({ kind: 'image', reason: 'http_4xx', target_url: 'https://cdn.com/i.png' }, seed), 'broken_image');
  assert.equal(issueType({ kind: 'iframe', reason: 'http_4xx', target_url: 'https://x.com/e' }, seed), 'broken_iframe');
  assert.equal(issueType({ kind: 'link', reason: 'redirect_chain', target_url: 'https://example.com/a' }, seed), 'redirect_chain');
});

test('every issue type has a label and a remediation line', () => {
  for (const key of GROUP_ORDER) {
    assert.ok(GROUP_DEFS[key], 'missing def for ' + key);
    assert.ok(GROUP_DEFS[key].label, 'missing label for ' + key);
    assert.ok(GROUP_DEFS[key].remediation, 'missing remediation for ' + key);
  }
});

test('the worked example matches the formulas page', () => {
  const ex = workedExample();
  assert.equal(ex.score, impactScore({ base: 40, sourceCount: 3, depth: 2 }));
  assert.equal(ex.score, 64); // mult 2 x depth 0.8 x base 40
  assert.equal(severityOf(64, 'http_4xx'), 'error'); // >= 40 is red
});

test('healthScore excludes unverifiable findings entirely', () => {
  const findings = [
    { impact_score: 64, reason: 'http_4xx' },
    { impact_score: 20, reason: 'http_4xx' },
    { impact_score: 5, reason: 'unverifiable' },
  ];
  assert.equal(healthScore(findings), 92); // 100 - 6.4 - 2.0, rounded
});

test('severityOf caps unverifiable at blue notice whatever the score', () => {
  assert.equal(severityOf(95, 'unverifiable'), 'notice');
  assert.equal(severityOf(64, 'http_4xx'), 'error');
  assert.equal(severityOf(39, 'http_4xx'), 'warning');
  assert.equal(severityOf(10, 'redirect_chain'), 'notice');
});

function finding(over) {
  return {
    id: 'f' + Math.random().toString(36).slice(2),
    fingerprint: 'fp',
    target_url: 'https://example.com/a',
    kind: 'link',
    reason: 'http_4xx',
    severity: 'error',
    impact_score: 40,
    state: 'open',
    sources: [{ url: 'https://example.com/', context: 'read more' }],
    ...over,
  };
}

test('groupFindings sorts groups, sorts rows by impact, counts recoverable points', () => {
  const rows = [
    finding({ kind: 'link', reason: 'http_4xx', target_url: 'https://example.com/a', impact_score: 40, state: 'open' }),
    finding({ kind: 'link', reason: 'http_4xx', target_url: 'https://example.com/b', impact_score: 64, state: 'open' }),
    finding({ kind: 'link', reason: 'unverifiable', target_url: 'https://walled.com/x', impact_score: 5, state: 'open' }),
    finding({ kind: 'image', reason: 'http_4xx', target_url: 'https://example.com/i.png', impact_score: 35, state: 'ignored' }),
  ];
  const groups = groupFindings(rows, 'example.com');
  assert.deepEqual(
    groups.map((g) => g.key),
    ['broken_internal', 'broken_image', 'unverifiable']
  );
  const internal = groups[0];
  assert.equal(internal.count, 2);
  assert.deepEqual(
    internal.findings.map((f) => f.impact_score),
    [64, 40]
  );
  assert.equal(internal.worst, 'error');
  assert.equal(internal.recoverable, 10); // (64 + 40) / 10, rounded
  const uv = groups[2];
  assert.equal(uv.recoverable, 0); // unverifiable never costs health points
  const img = groups[1];
  assert.equal(img.recoverable, 0); // ignored findings cost nothing
});

test('paginate clamps the page and slices 50 per page', () => {
  const items = Array.from({ length: 125 }, (_, i) => i);
  const p3 = paginate(items, 3);
  assert.equal(p3.items.length, 25);
  assert.equal(p3.page, 3);
  assert.equal(p3.totalPages, 3);
  assert.equal(p3.total, 125);
  assert.equal(paginate(items, 99).page, 3);
  assert.equal(paginate(items, 0).page, 1);
  assert.equal(paginate([], 1).totalPages, 1);
});

test('beforeAfter uses fingerprint presence, not triage state', () => {
  const prev = [finding({ fingerprint: 'a' }), finding({ fingerprint: 'b' })];
  const cur = [finding({ fingerprint: 'b', state: 'ignored' }), finding({ fingerprint: 'c' })];
  const { newSince, fixedSince } = beforeAfter(prev, cur);
  assert.deepEqual(newSince.map((f) => f.fingerprint), ['c']);
  assert.deepEqual(fixedSince.map((f) => f.fingerprint), ['a']);
});

test('findingsToCsv writes the header, escapes, and lists sources', () => {
  const rows = [
    finding({
      target_url: 'https://example.com/a,"b"',
      kind: 'link',
      reason: 'http_4xx',
      severity: 'error',
      impact_score: 64,
      state: 'open',
      sources: [
        { url: 'https://example.com/', context: 'read "more", now' },
        { url: 'https://example.com/about', context: null },
      ],
    }),
  ];
  const csv = findingsToCsv(rows);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'target_url,kind,reason,severity,impact_score,state,source_pages,context');
  assert.ok(lines[1].startsWith('"https://example.com/a,""b"""'), lines[1]);
  assert.ok(lines[1].includes('https://example.com/; https://example.com/about'));
  assert.ok(lines[1].includes('"read ""more"", now"'));
  assert.ok(csv.endsWith('\n'));
});

test('csvFileName slugs the site name', () => {
  assert.equal(csvFileName('Example.com Blog!', new Date('2026-10-24T00:00:00Z')), 'linkrot-example-com-blog-2026-10-24.csv');
});
