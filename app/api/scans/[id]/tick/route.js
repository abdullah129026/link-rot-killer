import { setScanFailed } from '@/lib/db.js';
import { runTick } from '@/lib/crawl/tick.js';
import { json, loadScan, forbidIfNotOwner } from '../../_shared.js';

// One crawl chunk: the progress page POSTs here every few seconds while a
// scan is active (a watched scan finishes in real time), and the cron route
// drives unattended scans. Owner only: the claim token cookie or the site
// owner. The tick budget is 7s inside the Hobby 10s function ceiling.
export async function POST(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const forbidden = forbidIfNotOwner(req, scan);
  if (forbidden) return forbidden;
  if (scan.status === 'done' || scan.status === 'failed') {
    return json({ ticked: false, status: scan.status });
  }

  try {
    const result = await runTick({ db }, id);
    return json({ ...result, status: result.done ? 'done' : scan.status === 'queued' ? 'crawling' : scan.status });
  } catch (e) {
    await setScanFailed(db, id, e && e.message ? e.message : 'tick failed');
    return json({ error: 'The scan failed. The error is logged on the scan page.', ticked: false }, 500);
  }
}
