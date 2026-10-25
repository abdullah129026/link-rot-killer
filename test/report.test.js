import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { sanitizePdfText, pdfFileName, plainFix, buildReport, generatePdf } from '../lib/report.js';

const groups = [
  {
    key: 'broken_internal',
    label: 'Broken internal links',
    remediation: 'Fix or redirect these first.',
    recoverable: 8,
    findings: [
      { target_url: 'https://example.com/gone', kind: 'link', reason: 'http_4xx', severity: 'error', impact_score: 40, state: 'open', sources: [{ url: 'https://example.com/', context: 'gone' }, { url: 'https://example.com/about', context: '' }] },
      { target_url: 'https://example.com/old', kind: 'link', reason: 'http_4xx', severity: 'warning', impact_score: 20, state: 'open', sources: [{ url: 'https://example.com/', context: '' }] },
    ],
  },
  {
    key: 'unverifiable',
    label: "Couldn't verify",
    remediation: 'These sites block automated checks.',
    recoverable: 0,
    findings: [
      { target_url: 'https://blocked.example/x', kind: 'link', reason: 'unverifiable', severity: 'notice', impact_score: 5, state: 'open', sources: [] },
    ],
  },
];

const scan = {
  stats: { pages_crawled: 12, targets_checked: 40 },
  health_score: 92,
  site: { name: 'Example', seed_url: 'https://example.com/sitemap.xml', client_name: 'Acme Co', prepared_by: 'Alex' },
  finished_at: '2026-10-25T10:00:00.000Z',
  started_at: '2026-10-25T09:00:00.000Z',
};
const findings = groups.flatMap((g) => g.findings);

test('sanitizePdfText strips control chars, replaces unencodable chars, caps length', () => {
  assert.equal(sanitizePdfText('a\x00b\x1fc'), 'abc');
  assert.equal(sanitizePdfText('café → x'), 'café ? x');
  assert.equal(sanitizePdfText('x'.repeat(600), 10), 'x'.repeat(10));
});

test('buildReport shapes client rows without the impact number, with rank and inlinks', () => {
  const prev = [{ fingerprint: 'p1' }, { fingerprint: 'p2' }];
  const cur = findings.map((f, i) => ({ ...f, fingerprint: i === 0 ? 'p1' : 'c' + i }));
  const report = buildReport({ scan, findings: cur, groups, prevFindings: prev, trend: [88, 92] });
  assert.equal(report.clientName, 'Acme Co');
  assert.equal(report.health, 92);
  assert.equal(report.brokenCount, 2);
  assert.equal(report.unverifiableCount, 1);
  assert.deepEqual(report.distribution, { error: 1, warning: 1, notice: 1 });
  assert.equal(report.before.fixedCount, 1);
  assert.equal(report.before.newCount, 2);
  assert.equal(report.topFixes.length, 2);
  assert.match(report.topFixes[0], /Broken internal links/);
  const row = report.groups[0].rows[0];
  assert.equal(row.rank, 1);
  assert.equal('impact_score' in row, false);
  assert.equal(row.sources.length, 2);
  assert.deepEqual(report.trend, [88, 92]);
});

test('buildReport without a previous scan has no before/after block', () => {
  const report = buildReport({ scan, findings, groups, prevFindings: null, trend: [92] });
  assert.equal(report.before, null);
});

test('generatePdf returns a real multi-section PDF', async () => {
  const report = buildReport({ scan, findings, groups, prevFindings: null, trend: [88, 92] });
  const bytes = await generatePdf(report);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), '%PDF');
  assert.ok(bytes.length > 2000);
  const loaded = await PDFDocument.load(bytes);
  assert.ok(loaded.getPageCount() >= 1);
});

test('pdfFileName slugs the site and dates the file', () => {
  assert.equal(pdfFileName('Example Site!', new Date('2026-10-25T00:00:00.000Z')), 'linkrot-report-example-site-2026-10-25.pdf');
  assert.equal(plainFix(findings[0], 'Broken internal links'), 'Broken internal links: example.com on 2 pages.');
});
