import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl } from '../lib/crawl/normalize.js';

test('lowercases host and strips default ports', () => {
  assert.equal(normalizeUrl('HTTPS://Example.COM:443/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('http://example.com:80/a'), 'http://example.com/a');
  assert.equal(normalizeUrl('http://example.com:8080/a'), 'http://example.com:8080/a');
});

test('strips fragments and tracking params, keeps real ones', () => {
  assert.equal(
    normalizeUrl('https://example.com/p?utm_source=x&fbclid=1&q=2#frag'),
    'https://example.com/p?q=2'
  );
});

test('collapses trailing slash except root', () => {
  assert.equal(normalizeUrl('https://example.com/a/'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('dedupes the three spellings of one URL', () => {
  const a = normalizeUrl('https://x.com/p');
  assert.equal(normalizeUrl('https://x.com/p/'), a);
  assert.equal(normalizeUrl('https://x.com/p?utm_source=a'), a);
});

test('rejects non-http and invalid input', () => {
  assert.equal(normalizeUrl('mailto:a@b.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('not a url'), null);
});
