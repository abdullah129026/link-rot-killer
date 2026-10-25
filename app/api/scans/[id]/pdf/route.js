import { listFindings, getPreviousScan, listScanHistory } from '@/lib/db.js';
import { groupFindings } from '@/lib/scan.js';
import { buildReport, generatePdf, pdfFileName } from '@/lib/report.js';
import { loadScan } from '../../_shared.js';

// Client PDF: cover, executive summary, severity bar, health trend,
// grouped findings with remediation lines, before/after, appendix.
// Public by unguessable id, same visibility as the scan page.
export async function GET(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const findings = await listFindings(db, id);
  let seedHost = null;
  try {
    seedHost = scan.site ? new URL(scan.site.seed_url).hostname : null;
  } catch {
    seedHost = null;
  }
  const groups = groupFindings(findings, seedHost);
  let prevFindings = null;
  const prev = await getPreviousScan(db, scan.site_id, id);
  if (prev) prevFindings = await listFindings(db, prev.id);
  const history = await listScanHistory(db, scan.site_id);
  const trend = history
    .filter((s) => s.status === 'done' && s.health_score != null)
    .map((s) => s.health_score);

  const report = buildReport({ scan, findings, groups, prevFindings, trend });
  const pdf = await generatePdf(report);
  return new Response(Buffer.from(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="' + pdfFileName(scan.site && scan.site.name) + '"',
    },
  });
}
