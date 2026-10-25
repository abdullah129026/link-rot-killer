import { notFound } from 'next/navigation';
import Topbar from '@/app/Topbar';
import { dbFromEnv, getScanWithSite, listFindings, getPreviousScan, listScanHistory } from '@/lib/db.js';
import { groupFindings, ownsScan, claimCookieName } from '@/lib/scan.js';
import { buildReport } from '@/lib/report.js';
import { cookies } from 'next/headers';
import PdfButton from './PdfButton';

export const dynamic = 'force-dynamic';

// The HTML report page: the same content as the PDF, as a page with print
// CSS. This is the mobile-primary surface for shared links; the PDF
// download sits on both this page and the scan page.
export default async function ReportPage({ params }) {
  const { id } = await params;
  const db = dbFromEnv();
  if (!db) {
    return (
      <>
        <Topbar />
        <div className="wrap"><div className="noticebox">Database not configured.</div></div>
      </>
    );
  }
  let scan;
  try {
    scan = await getScanWithSite(db, id);
  } catch {
    notFound();
  }
  if (!scan) notFound();

  const jar = await cookies();
  const owner = ownsScan(scan, { cookieToken: jar.get(claimCookieName(id))?.value });
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
  const trend = history.filter((s) => s.status === 'done' && s.health_score != null).map((s) => s.health_score);
  const report = buildReport({ scan, findings, groups, prevFindings, trend });

  return (
    <>
      <Topbar />
      <div className="wrap report">
        <div className="noprint" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <a className="btn ghost small" href={'/s/' + id}>Back to scan</a>
          <PdfButton scanId={id} />
        </div>
        <h1>Link Rot Report</h1>
        <p className="seed">{report.clientName ? 'Prepared for ' + report.clientName : report.siteName}</p>
        {report.preparedBy && <p>Prepared by {report.preparedBy}</p>}
        <p>{report.seedUrl} · Report date: {report.date}</p>
        <div className="health">
          <span className="score">{report.health ?? '?'}</span>
          <span className="label">health score</span>
        </div>
        <p>The score starts at 100. Each issue subtracts points based on how much it hurts: a broken link on your homepage costs more than one on a deep page.</p>

        <h2>Executive summary</h2>
        <p>
          Checked {report.pagesChecked} pages and {report.targetsChecked} links, images, and embeds.{' '}
          {report.brokenCount === 0 ? 'No broken items were found.' : 'Found ' + report.brokenCount + ' broken items.'}{' '}
          {report.unverifiableCount > 0 && report.unverifiableCount + ' more could not be checked because those sites block automated checks.'}
        </p>
        {report.topFixes.length > 0 && (
          <>
            <p>Top fixes:</p>
            <ol>
              {report.topFixes.map((fix, i) => <li key={i}>{fix}</li>)}
            </ol>
          </>
        )}
        {report.before && <p>{report.before.fixedCount} fixed since the last scan, {report.before.newCount} new.</p>}

        <h2>Findings by severity</h2>
        <p>Errors: {report.distribution.error}. Warnings: {report.distribution.warning}. Notices: {report.distribution.notice}.</p>
        {report.trend.length >= 2 && <p>Health across the last {report.trend.length} scans: {report.trend.join(', ')}.</p>}

        {report.groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label} ({g.count})</h2>
            <p>{g.remediation}</p>
            {g.recoverable > 0 && <p>Fixing these would raise the score by about {g.recoverable} points.</p>}
            <ol>
              {g.rows.map((row) => (
                <li key={row.rank}>
                  <span className={'pill ' + row.severity}>{row.severity}</span>{' '}
                  <span className="url">{row.targetUrl}</span>{' '}
                  <span style={{ color: 'var(--muted)' }}>({row.kind}, {row.reason}, found on {row.sourceCount} pages)</span>
                </li>
              ))}
            </ol>
          </section>
        ))}

        {report.before && (
          <>
            <h2>Before and after</h2>
            <p>{report.before.fixedCount} fixed since the last scan, {report.before.newCount} new.</p>
          </>
        )}

        <h2>Appendix: all findings with source pages</h2>
        <p>Methodology: only server-rendered HTML was checked. Content injected by JavaScript was not checked.</p>
        {report.groups.map((g) => (
          <section key={'app-' + g.label}>
            {g.rows.map((row) => (
              <div key={row.rank} style={{ marginBottom: 12 }}>
                <div className="url">{row.targetUrl} ({row.kind}, {row.reason})</div>
                {row.sources.length > 0 ? (
                  <ul>
                    {row.sources.map((s, i) => (
                      <li key={i}><span className="url">{s.url}</span>{s.context && <div className="ctx">{s.context}</div>}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No source page recorded.</p>
                )}
              </div>
            ))}
          </section>
        ))}

        {!owner && <div className="noticebox noprint" style={{ marginTop: 32 }}>This is the read-only client view.</div>}
      </div>
    </>
  );
}
