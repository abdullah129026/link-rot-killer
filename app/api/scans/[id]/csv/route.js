import { listFindings as dbListFindings } from '@/lib/db.js';
import { findingsToCsv, csvFileName } from '@/lib/scan.js';
import { loadScan } from '../../_shared.js';

// CSV export of every finding with full context: target, kind, reason,
// severity, impact, state, source pages, anchor/alt context. Public by
// unguessable id, same visibility as the scan page.
export async function GET(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const findings = await dbListFindings(db, id);
  const csv = findingsToCsv(findings);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="' + csvFileName(scan.site && scan.site.name) + '"',
    },
  });
}
