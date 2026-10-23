import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitemapBody, fetchSitemapSeed, MAX_LOCS } from '../lib/crawl/sitemap.js';

test('parses a urlset with the loc regex', () => {
  const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
  const p = parseSitemapBody(xml);
  assert.equal(p.kind, 'urlset');
  assert.deepEqual(p.locs, ['https://example.com/a', 'https://example.com/b']);
});

test('parses a sitemapindex and follows each index file once', async () => {
  const index = `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap>
    <sitemap><loc>https://example.com/s2.xml</loc></sitemap></sitemapindex>`;
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    if (url.endsWith('sitemap.xml')) return { status: 200, body: index };
    return { status: 200, body: `<urlset><url><loc>${url.replace('.xml', '')}/p</loc></url></urlset>` };
  };
  const r = await fetchSitemapSeed('https://example.com/sitemap.xml', { fetchPage });
  assert.equal(r.kind, 'sitemap');
  assert.deepEqual(r.urls, ['https://example.com/s1/p', 'https://example.com/s2/p']);
  assert.deepEqual(r.notices, []);
});

test('caps index files at 5 and ignores nested indexes', async () => {
  const locs = Array.from({ length: 7 }, (_, i) => `<sitemap><loc>https://example.com/s${i}.xml</loc></sitemap>`).join('');
  const fetchPage = async (url) => {
    if (url.endsWith('sitemap.xml')) return { status: 200, body: `<sitemapindex>${locs}</sitemapindex>` };
    if (url.endsWith('s0.xml')) return { status: 200, body: `<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>` };
    return { status: 200, body: `<urlset><url><loc>${url}x</loc></url></urlset>` };
  };
  const r = await fetchSitemapSeed('https://example.com/sitemap.xml', { fetchPage });
  assert.ok(r.notices.includes('index_cap_reached'));
  assert.ok(r.urls.length <= 5);
  assert.ok(!r.urls.some((u) => u.includes('nested')));
});

test('accepts plain-text sitemaps', async () => {
  const fetchPage = async () => ({ status: 200, body: 'https://example.com/a\nhttps://example.com/b\nnot a url\n' });
  const r = await fetchSitemapSeed('https://example.com/sitemap.txt', { fetchPage });
  assert.equal(r.kind, 'sitemap');
  assert.deepEqual(r.urls, ['https://example.com/a', 'https://example.com/b']);
});

test('falls back when the seed is not a sitemap', async () => {
  const fetchPage = async () => ({ status: 200, body: '<html><body>hello</body></html>' });
  const r = await fetchSitemapSeed('https://example.com/', { fetchPage });
  assert.equal(r.kind, 'fallback');
  assert.deepEqual(r.urls, []);
});

test('caps total locs at 10000', async () => {
  const locs = Array.from({ length: MAX_LOCS + 50 }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join('');
  const fetchPage = async () => ({ status: 200, body: `<urlset>${locs}</urlset>` });
  const r = await fetchSitemapSeed('https://example.com/sitemap.xml', { fetchPage });
  assert.equal(r.urls.length, MAX_LOCS);
});
