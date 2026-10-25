import { dbFromEnv, listSitesByOwner, listScansForSites } from '@/lib/db.js';
import { json, noDb, sessionUserId } from '../scans/_shared.js';

// Sites dashboard data: each site with its last scan (status + health)
// and its recent history. Signed in only; anonymous visitors get the
// sign-in CTA on the /sites page instead.
export async function GET() {
  const db = dbFromEnv();
  if (!db) return noDb();
  const userId = await sessionUserId();
  if (!userId) return json({ error: 'Sign in first' }, 401);
  const sites = await listSitesByOwner(db, userId);
  const scans = await listScansForSites(db, sites.map((s) => s.id));
  const bySite = new Map();
  for (const s of scans) {
    if (!bySite.has(s.site_id)) bySite.set(s.site_id, []);
    bySite.get(s.site_id).push(s);
  }
  return json({
    sites: sites.map((s) => {
      const history = bySite.get(s.id) || [];
      return {
        ...s,
        lastScan: history[0] || null,
        history: history.slice(0, 10),
        trend: history.filter((h) => h.status === 'done' && h.health_score != null).map((h) => h.health_score).reverse(),
      };
    }),
  });
}
