import test from 'node:test';
import assert from 'node:assert/strict';
import { isDue, cronAuthorized } from '../lib/schedule.js';
import { loginRedirectTarget, attachClaimedScans } from '../lib/auth.js';

const now = new Date('2026-10-25T12:00:00.000Z');

test('isDue: daily due after 24h, weekly after 7d, none never, no last scan due now', () => {
  assert.equal(isDue({ schedule: 'daily', lastStartedAt: '2026-10-24T12:00:00.000Z', now }), true);
  assert.equal(isDue({ schedule: 'daily', lastStartedAt: '2026-10-24T12:00:01.000Z', now }), false);
  assert.equal(isDue({ schedule: 'weekly', lastStartedAt: '2026-10-19T12:00:00.000Z', now }), false);
  assert.equal(isDue({ schedule: 'weekly', lastStartedAt: '2026-10-18T12:00:00.000Z', now }), true);
  assert.equal(isDue({ schedule: 'none', lastStartedAt: null, now }), false);
  assert.equal(isDue({ schedule: 'daily', lastStartedAt: null, now }), true);
  assert.equal(isDue({ schedule: 'bogus', lastStartedAt: null, now }), false);
});

test('cronAuthorized fails closed without a secret and rejects a wrong bearer', () => {
  const req = (auth) => ({ headers: { get: (n) => (n === 'authorization' ? auth : null) } });
  assert.equal(cronAuthorized(req('Bearer s3cr3t'), 's3cr3t'), true);
  assert.equal(cronAuthorized(req('Bearer wrong'), 's3cr3t'), false);
  assert.equal(cronAuthorized(req(null), 's3cr3t'), false);
  assert.equal(cronAuthorized(req('Bearer s3cr3t'), ''), false);
  assert.equal(cronAuthorized(req('Bearer s3cr3t'), null), false);
});

test('loginRedirectTarget allows only same-origin paths', () => {
  assert.equal(loginRedirectTarget('/sites'), '/sites');
  assert.equal(loginRedirectTarget('/s/abc'), '/s/abc');
  assert.equal(loginRedirectTarget('https://evil.example/'), '/');
  assert.equal(loginRedirectTarget('//evil.example/'), '/');
  assert.equal(loginRedirectTarget(''), '/');
  assert.equal(loginRedirectTarget(null), '/');
});

test('attachClaimedScans attaches only scans whose cookie matches the stored token', async () => {
  const db = {};
  const store = {
    getScanClaim: async (d, id) => ({ scan1: { site_id: 'site1', claim_token: 'tok1' }, scan2: { site_id: 'site2', claim_token: 'tok2' } })[id] || null,
    setSiteOwner: async () => {},
  };
  const seen = [];
  store.setSiteOwner = async (d, siteId, userId) => seen.push([siteId, userId]);
  const attached = await attachClaimedScans(db, 'user1', [['lkr_claim_scan1', 'tok1'], ['lkr_claim_scan2', 'WRONG'], ['other_cookie', 'x']], store);
  assert.deepEqual(attached, ['scan1']);
  assert.deepEqual(seen, [['site1', 'user1']]);
});
