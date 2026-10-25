import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, tokenLast4, buildIssueBody, createGithubIssue } from '../lib/github.js';

test('parseRepo accepts owner/repo and rejects anything else', () => {
  assert.deepEqual(parseRepo('octo/repo.js'), { owner: 'octo', repo: 'repo.js' });
  assert.equal(parseRepo('just-a-name'), null);
  assert.equal(parseRepo('a/b/c'), null);
  assert.equal(parseRepo(''), null);
});

test('tokenLast4 shows only the tail', () => {
  assert.equal(tokenLast4('github_pat_abc1234'), '1234');
});

const groups = [
  {
    label: 'Broken internal links',
    findings: [
      { target_url: 'https://example.com/gone', kind: 'link', reason: 'http_4xx', sources: [{ url: 'https://example.com/' }] },
      { target_url: 'https://example.com/old', kind: 'link', reason: 'http_4xx', sources: [] },
    ],
  },
  { label: "Couldn't verify", findings: [] },
];

test('buildIssueBody carries summary, top findings, and report link, never the token', () => {
  const body = buildIssueBody({
    siteName: 'Example',
    seedUrl: 'https://example.com/sitemap.xml',
    health: 92,
    groups,
    scanUrl: 'https://app.example/s/abc',
    reportUrl: 'https://app.example/s/abc/report',
  });
  assert.match(body, /Health score: 92/);
  assert.match(body, /Broken internal links \(2\)/);
  assert.match(body, /https:\/\/example\.com\/gone/);
  assert.match(body, /Full report: https:\/\/app\.example\/s\/abc\/report/);
  assert.doesNotMatch(body, /Couldn't verify/);
  assert.doesNotMatch(body, /github_pat/);
});

test('buildIssueBody caps each group at 10 findings with a remainder line', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ target_url: 'https://example.com/' + i, kind: 'link', reason: 'http_4xx', sources: [] }));
  const body = buildIssueBody({ siteName: 'X', seedUrl: 'https://x.example', health: 50, groups: [{ label: 'G', findings: many }], scanUrl: 's', reportUrl: 'r' });
  assert.match(body, /\.\.\.and 2 more in the full report\./);
});

test('createGithubIssue posts to the named repo with a bearer token and returns number + url', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ number: 7, html_url: 'https://github.com/octo/repo/issues/7' }) };
  };
  const created = await createGithubIssue({ fetchFn: fakeFetch, token: 't0k', owner: 'octo', repo: 'repo', title: 'T', body: 'B' });
  assert.deepEqual(created, { number: 7, url: 'https://github.com/octo/repo/issues/7' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/octo/repo/issues');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer t0k');
  assert.equal(JSON.parse(calls[0].opts.body).title, 'T');
});

test('createGithubIssue throws on a non-2xx response without leaking the token', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(
    () => createGithubIssue({ fetchFn: fakeFetch, token: 't0k', owner: 'o', repo: 'r', title: 'T', body: 'B' }),
    (e) => e.message.includes('404') && !e.message.includes('t0k')
  );
});
