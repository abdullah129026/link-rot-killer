import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl, SsrfError } from '../lib/crawl/ssrf.js';

test('refuses private ipv4 ranges', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.1.1', '0.0.0.0']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test('allows public ipv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('refuses ipv6 loopback, unique-local, link-local and mapped ipv4', () => {
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('fc00::1'), true);
  assert.equal(isPrivateIp('fd12:3456::1'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
});

test('refuses unparseable addresses', () => {
  assert.equal(isPrivateIp('999.1.1.1'), true);
  assert.equal(isPrivateIp('nope'), true);
});

test('assertPublicUrl refuses localhost without hitting the network', async () => {
  await assert.rejects(() => assertPublicUrl('http://localhost:3000/x'), SsrfError);
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/x'), SsrfError);
});
