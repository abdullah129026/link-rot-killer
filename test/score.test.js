import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseForFinding, impactScore, severityOf, healthScore, fingerprint } from '../lib/crawl/score.js';

test('base weights follow the plan', () => {
  assert.equal(baseForFinding({ kind: 'link', internal: true, reason: 'http_4xx' }), 40);
  assert.equal(baseForFinding({ kind: 'image', internal: false, reason: 'http_4xx' }), 35);
  assert.equal(baseForFinding({ kind: 'embed', internal: false, reason: 'dead_embed' }), 30);
  assert.equal(baseForFinding({ kind: 'link', internal: false, reason: 'http_4xx' }), 20);
  assert.equal(baseForFinding({ kind: 'link', internal: false, reason: 'redirect_chain' }), 10);
  assert.equal(baseForFinding({ kind: 'link', internal: false, reason: 'unverifiable' }), 5);
});

test('inlink multiplier and depth factor, capped at 100', () => {
  assert.equal(impactScore({ base: 40, sourceCount: 1, depth: 0 }), 40);
  assert.equal(impactScore({ base: 40, sourceCount: 5, depth: 0 }), 100); // 40*3 capped
  assert.equal(impactScore({ base: 40, sourceCount: 2, depth: 2 }), 48); // 40*1.5*0.8
  assert.equal(impactScore({ base: 20, sourceCount: 1, depth: 5 }), 12); // 20*0.6
});

test('severity thresholds, unverifiable always notice', () => {
  assert.equal(severityOf(40, 'http_4xx'), 'error');
  assert.equal(severityOf(39, 'http_4xx'), 'warning');
  assert.equal(severityOf(15, 'http_4xx'), 'warning');
  assert.equal(severityOf(14, 'http_4xx'), 'notice');
  assert.equal(severityOf(90, 'unverifiable'), 'notice');
});

test('health score: one broken internal link costs 4 points, floor 0, unverifiable excluded', () => {
  assert.equal(healthScore([{ impact_score: 40, reason: 'http_4xx' }]), 96);
  assert.equal(healthScore([]), 100);
  assert.equal(
    healthScore([{ impact_score: 90, reason: 'unverifiable' }]),
    100
  );
  const many = Array.from({ length: 30 }, () => ({ impact_score: 40, reason: 'http_4xx' }));
  assert.equal(healthScore(many), 0);
});

test('fingerprint is site + normalized url + kind + reason', () => {
  const f = fingerprint({ siteId: 's1', normalizedUrl: 'https://x.com/a', kind: 'link', reason: 'http_4xx' });
  assert.equal(f, 's1|https://x.com/a|link|http_4xx');
  assert.equal(fingerprint({ siteId: null, normalizedUrl: 'https://x.com/a', kind: 'link', reason: 'http_4xx' }).split('|')[0], 'anon');
});
