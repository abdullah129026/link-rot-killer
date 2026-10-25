// Client PDF report: data shaping plus pdf-lib rendering.
// Client-facing surfaces never show the raw impact number: rows carry a
// severity badge and a "fix first" rank. The owner's scan page keeps the
// number. One dependency, pdf-lib: hand-rolling PDF tables is not a
// few-lines job (PLAN 3.6).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { beforeAfter } from './scan.js';

// pdf-lib's standard fonts speak WinAnsi: strip control characters and
// replace anything outside the encodable range so a weird URL or client
// name can never break generation.
export function sanitizePdfText(value, max = 500) {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    out += code >= 0x20 && code <= 0xff ? ch : '?';
  }
  return out.slice(0, max);
}

export function pdfFileName(siteName, when = new Date()) {
  const slug = String(siteName || 'scan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return 'linkrot-report-' + (slug || 'scan') + '-' + when.toISOString().slice(0, 10) + '.pdf';
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// One plain-language sentence per fix, for the executive summary.
export function plainFix(finding, groupLabel) {
  const sources = Array.isArray(finding.sources) ? finding.sources.length : 0;
  const where = sources > 1 ? ' on ' + sources + ' pages' : sources === 1 ? ' on one page' : '';
  return groupLabel + ': ' + hostOf(finding.target_url) + where + '.';
}

// Shape everything the PDF and the HTML report page share, so the two
// surfaces cannot drift apart.
export function buildReport({ scan, findings, groups, prevFindings, trend }) {
  const stats = (scan && scan.stats) || {};
  const site = (scan && scan.site) || {};
  const open = findings.filter((f) => f.state === 'open' && f.reason !== 'unverifiable');
  const top = [...open].sort((a, b) => b.impact_score - a.impact_score).slice(0, 3);
  const groupLabel = new Map(groups.map((g) => [g.key, g.label]));
  // Match by URL + reason, not object identity: callers may pass copies.
  const groupKeyOf = (f) =>
    groups.find((g) => g.findings.some((x) => x.target_url === f.target_url && x.reason === f.reason))?.key;
  const distribution = { error: 0, warning: 0, notice: 0 };
  for (const f of findings) distribution[f.severity] = (distribution[f.severity] || 0) + 1;
  const before = prevFindings ? beforeAfter(prevFindings, findings) : null;
  return {
    siteName: site.name || 'Scan',
    seedUrl: site.seed_url || '',
    clientName: site.client_name || '',
    preparedBy: site.prepared_by || '',
    date: (scan.finished_at || scan.started_at || new Date().toISOString()).slice(0, 10),
    health: scan.health_score,
    pagesChecked: stats.pages_crawled || 0,
    targetsChecked: stats.targets_checked || 0,
    brokenCount: findings.filter((f) => f.reason !== 'unverifiable').length,
    unverifiableCount: findings.filter((f) => f.reason === 'unverifiable').length,
    distribution,
    trend: (trend || []).filter((t) => t != null),
    topFixes: top.map((f) => plainFix(f, groupLabel.get(groupKeyOf(f)) || 'Fix')),
    before: before ? { newCount: before.newSince.length, fixedCount: before.fixedSince.length } : null,
    // Client rows: rank and badge only, never the impact number.
    groups: groups.map((g) => ({
      label: g.label,
      remediation: g.remediation || '',
      count: g.findings.length,
      recoverable: g.recoverable || 0,
      rows: g.findings.map((f, i) => ({
        rank: i + 1,
        severity: f.severity,
        targetUrl: f.target_url,
        kind: f.kind,
        reason: f.reason,
        sourceCount: Array.isArray(f.sources) ? f.sources.length : 0,
        sources: (f.sources || []).map((s) => ({ url: s.url, context: s.context || '' })),
      })),
    })),
  };
}

const SEVERITY_COLOR = {
  error: rgb(0.75, 0.15, 0.15),
  warning: rgb(0.65, 0.5, 0),
  notice: rgb(0.2, 0.4, 0.65),
};

function wrap(text, font, size, maxWidth) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function generatePdf(report) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const M = 48;
  const maxW = W - M * 2;
  let page = doc.addPage([W, 842]);
  let y = 842 - M;

  function need(room) {
    if (y - room < M) {
      page = doc.addPage([W, 842]);
      y = 842 - M;
    }
  }
  function text(str, { size = 11, font = regular, gap = 15, color = rgb(0.1, 0.1, 0.1) } = {}) {
    for (const line of wrap(str, font, size, maxW)) {
      need(size + 4);
      page.drawText(line, { x: M, y, size, font, color });
      y -= gap;
    }
  }
  function heading(str, size = 16) {
    y -= 6;
    need(size + 10);
    page.drawText(sanitizePdfText(str), { x: M, y, size, font: bold });
    y -= size + 10;
  }
  function rule() {
    need(14);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 14;
  }

  // Cover.
  page.drawText('Link Rot Report', { x: M, y, size: 26, font: bold });
  y -= 40;
  text(report.clientName ? 'Prepared for ' + report.clientName : report.siteName, { size: 14, font: bold });
  if (report.preparedBy) text('Prepared by ' + report.preparedBy, { size: 11 });
  text(report.seedUrl, { size: 11 });
  text('Report date: ' + report.date, { size: 11 });
  y -= 8;
  page.drawText(String(report.health ?? '?'), { x: M, y: y - 30, size: 44, font: bold });
  page.drawText('health score', { x: M + 90, y: y - 14, size: 12, font: regular });
  y -= 64;
  text('The score starts at 100. Each issue subtracts points based on how much it hurts: a broken link on your homepage costs more than one on a deep page.', { size: 11 });
  rule();

  // Executive summary.
  heading('Executive summary', 16);
  text(
    'Checked ' + report.pagesChecked + ' pages and ' + report.targetsChecked + ' links, images, and embeds. ' +
      (report.brokenCount === 0
        ? 'No broken items were found.'
        : 'Found ' + report.brokenCount + ' broken item' + (report.brokenCount === 1 ? '' : 's') + '.') +
      (report.unverifiableCount > 0 ? ' Another ' + report.unverifiableCount + ' could not be checked because those sites block automated checks.' : ''),
    { size: 11 }
  );
  if (report.health != null) {
    text(
      report.health >= 90
        ? 'The site is in good shape: only a few issues stand between it and a perfect score.'
        : report.health >= 70
          ? 'The site has real rot to fix, but nothing catastrophic: the fixes below recover most of the lost points.'
          : 'The site has substantial rot: fixing the top issues below is the fastest way to recover.',
      { size: 11 }
    );
  }
  if (report.topFixes.length) {
    text('Top fixes:', { size: 11, font: bold });
    report.topFixes.forEach((fix, i) => text(i + 1 + '. ' + fix, { size: 11 }));
  }
  if (report.before) {
    text(report.before.fixedCount + ' fixed since the last scan, ' + report.before.newCount + ' new.', { size: 11 });
  }
  rule();

  // Severity distribution bar, drawn rects.
  heading('Findings by severity', 14);
  const total = report.distribution.error + report.distribution.warning + report.distribution.notice;
  if (total > 0) {
    need(30);
    let x = M;
    for (const key of ['error', 'warning', 'notice']) {
      const w = Math.max(4, (report.distribution[key] / total) * maxW);
      page.drawRectangle({ x, y: y - 12, width: w, height: 12, color: SEVERITY_COLOR[key] });
      x += w;
    }
    y -= 26;
    text('Errors: ' + report.distribution.error + '. Warnings: ' + report.distribution.warning + '. Notices: ' + report.distribution.notice + '.', { size: 11 });
  } else {
    text('No findings.', { size: 11 });
  }
  // Health trend sparkline, drawn line segments.
  if (report.trend.length >= 2) {
    heading('Health trend', 14);
    need(50);
    const bw = maxW / (report.trend.length - 1);
    let prev = null;
    report.trend.forEach((score, i) => {
      const px = M + i * bw;
      const py = y - 30 + (score / 100) * 30;
      if (prev) page.drawLine({ start: prev, end: { x: px, y: py }, thickness: 1.5, color: rgb(0.2, 0.4, 0.65) });
      prev = { x: px, y: py };
    });
    y -= 48;
    text('Health across the last ' + report.trend.length + ' scans: ' + report.trend.join(', ') + '.', { size: 11 });
  }
  rule();

  // Grouped findings with remediation lines, rank + badge, no raw score.
  for (const g of report.groups) {
    heading(g.label + ' (' + g.count + ')', 14);
    text(g.remediation, { size: 11 });
    if (g.recoverable > 0) text('Fixing these would raise the score by about ' + g.recoverable + ' points.', { size: 11 });
    for (const row of g.rows) {
      need(30);
      page.drawRectangle({ x: M, y: y - 10, width: 52, height: 13, color: SEVERITY_COLOR[row.severity] });
      page.drawText(row.severity, { x: M + 4, y: y - 9, size: 8, font: bold, color: rgb(1, 1, 1) });
      page.drawText('#' + row.rank, { x: M + 58, y: y - 9, size: 9, font: bold });
      const urlLines = wrap(row.targetUrl, regular, 10, maxW - 120);
      page.drawText(urlLines[0], { x: M + 120, y: y - 9, size: 10, font: regular });
      y -= 15;
      for (const extra of urlLines.slice(1)) {
        need(14);
        page.drawText(extra, { x: M + 120, y, size: 10, font: regular });
        y -= 14;
      }
      text(row.kind + ', ' + row.reason + ', found on ' + row.sourceCount + ' page' + (row.sourceCount === 1 ? '' : 's') + '.', { size: 10 });
      y -= 4;
    }
    y -= 8;
  }
  rule();

  // Before/after.
  if (report.before) {
    heading('Before and after', 14);
    text(report.before.fixedCount + ' fixed since the last scan, ' + report.before.newCount + ' new.', { size: 11 });
    rule();
  }

  // Appendix: full URL table with inlink detail.
  heading('Appendix: all findings with source pages', 14);
  text('Methodology: only server-rendered HTML was checked. Content injected by JavaScript was not checked.', { size: 11 });
  for (const g of report.groups) {
    for (const row of g.rows) {
      need(28);
      text(row.targetUrl + ' (' + row.kind + ', ' + row.reason + ')', { size: 10, font: bold });
      if (row.sources.length) {
        for (const s of row.sources) {
          text('Found on: ' + s.url + (s.context ? ' ("' + s.context + '")' : ''), { size: 10 });
        }
      } else {
        text('Found on: (no source page recorded)', { size: 10 });
      }
      y -= 4;
    }
  }

  return doc.save();
}
