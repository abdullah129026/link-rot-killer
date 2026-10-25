import Topbar from '@/app/Topbar';
import { dbFromEnv, listSitesByOwner, listScansForSites } from '@/lib/db.js';
import { sessionUser } from '@/lib/supabase-server.js';
import SiteSettingsForm from './SiteSettingsForm';

export const dynamic = 'force-dynamic';

// Sites dashboard (signed in): sites with schedules, last-scan status
// with a visible failed badge, scan history, health trend per site.
// Anonymous visitors get the sign-in CTA; their scans live on the scan
// pages themselves until they sign in and the claim cookies attach.
export default async function SitesPage() {
  const user = await sessionUser();
  if (!user) {
    return (
      <>
        <Topbar />
        <div className="wrap">
          <h1>Your sites</h1>
          <p style={{ color: 'var(--muted)' }}>Sign in to save scans, schedule re-scans, and see every site in one place.</p>
          <a className="btn" href="/login?next=/sites">Sign in</a>
        </div>
      </>
    );
  }
  const db = dbFromEnv();
  if (!db) {
    return (
      <>
        <Topbar />
        <div className="wrap"><div className="noticebox">Database not configured.</div></div>
      </>
    );
  }
  const sites = await listSitesByOwner(db, user.id);
  const scans = await listScansForSites(db, sites.map((s) => s.id));
  const bySite = new Map();
  for (const s of scans) {
    if (!bySite.has(s.site_id)) bySite.set(s.site_id, []);
    bySite.get(s.site_id).push(s);
  }

  return (
    <>
      <Topbar />
      <div className="wrap">
        <h1>Your sites</h1>
        {sites.length === 0 && (
          <div className="noticebox">
            No sites yet. Paste a sitemap on the <a href="/">home page</a> while signed in, and it shows up here.
          </div>
        )}
        {sites.map((site) => {
          const history = bySite.get(site.id) || [];
          const last = history[0] || null;
          const trend = history.filter((h) => h.status === 'done' && h.health_score != null).map((h) => h.health_score).reverse();
          return (
            <div className="card" key={site.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{site.name}</strong>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{site.seed_url}</span>
                {last && <span className={'pill ' + (last.status === 'failed' ? 'error' : last.status === 'done' ? 'ok' : 'neutral')}>{last.status}</span>}
                {last && last.status === 'failed' && <span className="pill error">Scan failed</span>}
                {last && last.health_score != null && <span>Health {last.health_score}</span>}
              </div>
              {last && <div style={{ marginTop: 6, fontSize: 13 }}><a href={'/s/' + last.id}>Last scan</a> · {last.started_at.slice(0, 10)}</div>}
              {history.length > 1 && (
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>
                  History: {history.slice(0, 5).map((h) => <a key={h.id} href={'/s/' + h.id} style={{ marginRight: 8 }}>{h.started_at.slice(0, 10)} ({h.status})</a>)}
                </div>
              )}
              {trend.length >= 2 && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>Health trend: {trend.join(', ')}</div>}
              <SiteSettingsForm site={site} />
            </div>
          );
        })}
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Scheduled scans advance one chunk per daily cron tick on the free tier, so a big site takes days unattended. A watched scan finishes in real time on its scan page.
        </p>
      </div>
    </>
  );
}
