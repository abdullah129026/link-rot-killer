import { dbFromEnv, reclaimStaleTargets, failStalledScans, listActiveScans, listScheduledSites, listScansForSites, insertScan } from '@/lib/db.js';
import { runTick } from '@/lib/crawl/tick.js';
import { randomClaimToken } from '@/lib/scan.js';
import { isDue, cronAuthorized } from '@/lib/schedule.js';
import { json, noDb } from '../../scans/_shared.js';

// Vercel cron route (bearer-gated on CRON_SECRET, the project-2 pattern):
// reclaim expired tick leases, fail stalled scans, advance active scans
// oldest first inside the 7s tick budget, then start due scheduled scans.
// Verified 2026-10-23: Hobby cron fires at most once a day and functions
// hard-cap at 10s, so unattended scans advance one chunk per daily tick
// and the UI states that honestly instead of implying instant results.
export async function GET(req) {
  const db = dbFromEnv();
  if (!db) return noDb();
  if (!cronAuthorized(req, process.env.CRON_SECRET)) return json({ error: 'Unauthorized' }, 401);

  await reclaimStaleTargets(db);
  await failStalledScans(db);

  const started = Date.now();
  const ticked = [];
  const active = await listActiveScans(db, 20);
  for (const scan of active) {
    if (Date.now() - started > 7000) break;
    try {
      const result = await runTick({ db, budgetMs: Math.max(1000, 7000 - (Date.now() - started)) }, scan.id);
      ticked.push({ id: scan.id, ...result });
    } catch {
      ticked.push({ id: scan.id, ticked: false, error: true });
    }
  }

  const startedScans = [];
  const sites = await listScheduledSites(db);
  if (sites.length) {
    const scans = await listScansForSites(db, sites.map((s) => s.id));
    const latest = new Map();
    for (const s of scans) {
      if (!latest.has(s.site_id)) latest.set(s.site_id, s);
    }
    for (const site of sites) {
      const last = latest.get(site.id);
      // Only start a new scan when no active scan is already running for
      // the site; the next cron tick advances it.
      const hasActive = last && (last.status === 'queued' || last.status === 'crawling');
      if (!hasActive && isDue({ schedule: site.schedule, lastStartedAt: last ? last.started_at : null })) {
        const created = await insertScan(db, { site_id: site.id, claim_token: randomClaimToken(), ip: null });
        startedScans.push({ site_id: site.id, scan_id: created.id });
      }
    }
  }

  return json({ ticked, started: startedScans });
}
