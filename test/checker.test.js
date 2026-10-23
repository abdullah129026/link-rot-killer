import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkTarget } from '../lib/crawl/checker.js';

let server;
let base;
let flakyHits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/ok') return void res.writeHead(200).end('ok');
    if (u.pathname === '/gone') return void res.writeHead(404).end('gone');
    if (u.pathname === '/broken') return void res.writeHead(500).end('broken');
    if (u.pathname === '/walled') return void res.writeHead(403).end('no bots');
    if (u.pathname === '/headless') {
      if (req.method === 'HEAD') return void res.writeHead(405).end();
      return void res.writeHead(200).end('ok');
    }
    if (u.pathname === '/flaky') {
      flakyHits += 1;
      if (flakyHits === 1) return; // hang: client times out, then retries
      return void res.writeHead(200).end('ok');
    }
    if (u.pathname === '/limited') {
      res.writeHead(429, { 'retry-after': '120' }).end('slow down');
      return;
    }
    if (u.pathname === '/loop') {
      res.writeHead(302, { location: '/loop' }).end();
      return;
    }
    if (u.pathname.startsWith('/hop')) {
      const n = parseInt(u.pathname.slice(4), 10);
      if (n < 4) {
        res.writeHead(302, { location: `/hop${n + 1}` }).end();
        return;
      }
      return void res.writeHead(200).end('end');
    }
    if (u.pathname === '/term404') {
      res.writeHead(302, { location: '/gone' }).end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

function realBehavior(url, method) {
  return new Promise((resolve) => {
    const req = http.request(url, { method }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, hops: [], finalUrl: url, crossHost: false, error: null })
      );
    });
    req.on('error', () => resolve({ error: 'unreachable' }));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });
    req.end();
  });
}

test('200 is ok', async () => {
  const r = await checkTarget({ url: base + '/ok' }, { fetchPage: (u, o) => realBehavior(u, o.method) });
  assert.equal(r.verdict, 'ok');
});

test('404 and 500 are broken with the right reason', async () => {
  const f = (u, o) => realBehavior(u, o.method);
  assert.equal((await checkTarget({ url: base + '/gone' }, { fetchPage: f })).reason, 'http_4xx');
  assert.equal((await checkTarget({ url: base + '/broken' }, { fetchPage: f })).reason, 'http_5xx');
});

test('403 is unverifiable, never broken', async () => {
  const r = await checkTarget({ url: base + '/walled' }, { fetchPage: (u, o) => realBehavior(u, o.method) });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.reason, 'unverifiable');
});

test('405 on HEAD retries once with GET', async () => {
  const r = await checkTarget({ url: base + '/headless' }, { fetchPage: (u, o) => realBehavior(u, o.method) });
  assert.equal(r.verdict, 'ok');
});

test('one transient timeout is retried, not cried wolf over', async () => {
  flakyHits = 0;
  const r = await checkTarget({ url: base + '/flaky' }, { fetchPage: (u, o) => realBehavior(u, o.method) });
  assert.equal(r.verdict, 'ok');
  assert.equal(flakyHits, 2);
});

test('429 with retry-after requeues instead of failing', async () => {
  const before = Date.now();
  const r = await checkTarget({ url: base + '/limited' }, { fetchPage: (u, o) => realBehavior(u, o.method) });
  assert.equal(r.verdict, 'requeue');
  assert.ok(r.notBefore - before >= 119000 && r.notBefore - before <= 121000);
});

test('redirect loop does not hang the checker', async () => {
  const fetchPage = async (url) => {
    const hops = [];
    let cur = url;
    for (let i = 0; i < 5; i++) {
      const next = base + '/loop';
      if (hops.some((h) => h.url === next)) {
        hops.push({ url: next, status: 'loop' });
        break;
      }
      hops.push({ url: cur, status: 302 });
      cur = next;
    }
    return { status: null, hops, finalUrl: cur, crossHost: false, error: 'too_many_redirects' };
  };
  const r = await checkTarget({ url: base + '/loop' }, { fetchPage });
  assert.equal(r.verdict, 'notice');
  assert.equal(r.reason, 'redirect_chain');
});

test('three hops become a redirect_chain notice, not a break', async () => {
  const fetchPage = async (url) => ({
    status: 200,
    headers: new Headers(),
    hops: [{ url, status: 302 }, { url: url + '2', status: 302 }, { url: url + '3', status: 302 }],
    finalUrl: url + '4',
    crossHost: false,
    error: null,
  });
  const r = await checkTarget({ url: base + '/hop1' }, { fetchPage });
  assert.equal(r.verdict, 'notice');
  assert.equal(r.reason, 'redirect_chain');
});

test('terminal 404 after redirects is still broken', async () => {
  const fetchPage = async (url) => ({
    status: 404,
    headers: new Headers(),
    hops: [{ url, status: 302 }],
    finalUrl: base + '/gone',
    crossHost: false,
    error: null,
  });
  const r = await checkTarget({ url: base + '/term404' }, { fetchPage });
  assert.equal(r.verdict, 'broken');
  assert.equal(r.reason, 'http_4xx');
});

test('youtube: oembed 200 is live, 400 is dead_embed, 500 is unverifiable', async () => {
  const live = await checkTarget({ url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }, { oembedFetch: async () => ({ status: 200 }) });
  assert.equal(live.verdict, 'ok');
  const dead = await checkTarget({ url: 'https://www.youtube.com/embed/xxxxxxxxxxx' }, { oembedFetch: async () => ({ status: 400 }) });
  assert.equal(dead.verdict, 'broken');
  assert.equal(dead.reason, 'dead_embed');
  const err = await checkTarget({ url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }, { oembedFetch: async () => ({ status: 500 }) });
  assert.equal(err.verdict, 'unverifiable');
});
