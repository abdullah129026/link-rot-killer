import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFetcher, sameSite, DEFAULT_POLITENESS_MS } from '../lib/crawl/fetch.js';

// The SSRF guard does real DNS, so tests inject a no-op guard and stub
// globalThis.fetch. Each test restores the real fetch afterwards.
const noGuard = async () => {};

function stubFetch(impl) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = real;
  };
}
test('default politeness is 750ms', () => {
  assert.equal(DEFAULT_POLITENESS_MS, 750);
});

test('sameSite treats www/apex and subdomains as one site', () => {
  assert.equal(sameSite('www.example.com', 'example.com'), true);
  assert.equal(sameSite('blog.example.com', 'example.com'), true);
  assert.equal(sameSite('example.com', 'other.com'), false);
  assert.equal(sameSite('example.com', 'notexample.com'), false);
});

test('enforces spacing between requests to the same host', async () => {
  const hits = [];
  const restore = stubFetch(async () => {
    hits.push(Date.now());
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
  });
  try {
    const { fetchUrl } = createFetcher({ politenessMs: 60, assertPublic: noGuard });
    const t0 = Date.now();
    await fetchUrl('https://example.com/a', { method: 'GET' });
    await fetchUrl('https://example.com/b', { method: 'GET' });
    await fetchUrl('https://other.com/c', { method: 'GET' });
    const gap = hits[1] - hits[0];
    assert.ok(gap >= 50, 'same host waited, gap was ' + gap);
    assert.ok(Date.now() - t0 < 500, 'different host was not delayed');
  } finally {
    restore();
  }
});

test('truncates bodies over the cap', async () => {
  const restore = stubFetch(async () => new Response('x'.repeat(3000), { status: 200, headers: { 'content-type': 'text/html' } }));
  try {
    const { fetchUrl } = createFetcher({ maxBodyBytes: 1000, politenessMs: 0, assertPublic: noGuard });
    const r = await fetchUrl('https://example.com/big', { method: 'GET' });
    assert.equal(r.truncated, true);
    assert.ok(r.body.length <= 1000);
  } finally {
    restore();
  }
});

test('aborts slow responses at the timeout', async () => {
  const restore = stubFetch(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })
  );
  try {
    const { fetchUrl } = createFetcher({ timeoutMs: 100, politenessMs: 0, assertPublic: noGuard });
    const r = await fetchUrl('https://example.com/slow', { method: 'GET' });
    assert.equal(r.error, 'timeout');
  } finally {
    restore();
  }
});

test('honors robots.txt disallow for page crawls', async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow: /private\n', { status: 200 });
    }
    return new Response('page', { status: 200, headers: { 'content-type': 'text/html' } });
  });
  try {
    const { fetchUrl } = createFetcher({ politenessMs: 0, assertPublic: noGuard });
    const blocked = await fetchUrl('https://example.com/private/x', { method: 'GET', checkRobots: true });
    assert.equal(blocked.error, 'robots');
    const allowed = await fetchUrl('https://example.com/public/x', { method: 'GET', checkRobots: true });
    assert.equal(allowed.status, 200);
  } finally {
    restore();
  }
});
