import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Topbar from "@/app/Topbar";
import { dbFromEnv, getScanWithSite, listFindings, getPreviousScan } from "@/lib/db.js";
import {
  groupFindings,
  paginate,
  beforeAfter,
  ownsScan,
  claimCookieName,
  GROUP_DEFS,
} from "@/lib/scan.js";
import { healthScore } from "@/lib/crawl/score.js";
import { ScanLive, StatusPill, TriageButtons, GroupBulkActions, RescanButton } from "./controls";

export const dynamic = "force-dynamic";

function hostOf(seedUrl) {
  try {
    return new URL(seedUrl).hostname;
  } catch {
    return null;
  }
}

export default async function ScanPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
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
  const seedHost = scan.site ? hostOf(scan.site.seed_url) : null;
  const findings = await listFindings(db, id);
  const groups = groupFindings(findings, seedHost);

  let before = null;
  const prev = await getPreviousScan(db, scan.site_id, id);
  if (prev) {
    const prevFindings = await listFindings(db, prev.id);
    const { newSince, fixedSince } = beforeAfter(prevFindings, findings);
    before = { newSince: newSince.length, fixedSince: fixedSince.length };
  }

  const groupKey = typeof sp.group === "string" ? sp.group : null;
  const group = groupKey ? groups.find((g) => g.key === groupKey) : null;
  if (groupKey && !group) notFound();
  const drilled = group ? paginate(group.findings, parseInt(sp.page || "1", 10)) : null;

  const stats = scan.stats || {};
  const done = scan.status === "done";
  const score = done ? healthScore(findings) : scan.health_score;
  const siteName = scan.site ? scan.site.name : "Scan";

  return (
    <>
      <Topbar />
      <div className="wrap">
        <div className="scanhead">
          <h1>{siteName}</h1>
          {scan.site && <div className="seed">{scan.site.seed_url}</div>}
        </div>

        <ScanLive scanId={id} initial={{ status: scan.status, stats, notices: stats.notices }} />

        {done && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="health">
              <span className="score">{score}</span>
              <span className="label">health score. <a href="/formulas">How it&apos;s computed</a></span>
            </div>
          </div>
        )}

        {done && (stats.broken_found || 0) === 0 && (
          <div className="zerostate">
            <h2>No broken links found.</h2>
            {(stats.unverifiable_found || 0) > 0 && (
              <p>{stats.unverifiable_found} target{(stats.unverifiable_found === 1 ? "" : "s")} couldn&apos;t be checked because those sites block automated checks.</p>
            )}
          </div>
        )}

        {before && (before.newSince > 0 || before.fixedSince > 0) && (
          <div className="beforeafter">
            <div className="card ba">
              <span className="pill error">{before.newSince} new</span>
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)" }}>since the last scan</p>
            </div>
            <div className="card ba">
              <span className="pill ok">{before.fixedSince} fixed</span>
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)" }}>since the last scan</p>
            </div>
          </div>
        )}

        {owner && done && (
          <div className="ownerbar">
            <a className="btn ghost small" href={"/api/scans/" + id + "/csv"}>Download CSV</a>
            <RescanButton scanId={id} />
          </div>
        )}

        {!group && groups.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 18 }}>Findings by issue type</h2>
            {groups.map((g) => (
              <a className="group" key={g.key} href={"/s/" + id + "?group=" + g.key}>
                <div className="grow">
                  <span className={"pill " + g.worst}>{g.worst}</span>
                  <span className="glabel">{g.label}</span>
                  <span className="gcount">{g.count}</span>
                </div>
                <p className="remedy">{GROUP_DEFS[g.key].remediation}</p>
                {g.recoverable > 0 && (
                  <div className="recover">Fixing these would raise the score by about {g.recoverable} points.</div>
                )}
              </a>
            ))}
          </div>
        )}

        {group && (
          <div style={{ marginTop: 24 }}>
            <p><a href={"/s/" + id}>&larr; All issue types</a></p>
            <h2 style={{ fontSize: 20 }}>{group.label} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({group.count})</span></h2>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>{GROUP_DEFS[group.key].remediation}</p>
            {owner && <GroupBulkActions scanId={id} groupKey={group.key} groupLabel={group.label} />}
            <div className="tblscroll">
              <table className="findings">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Severity</th>
                    <th>Impact</th>
                    <th>State</th>
                    {owner && <th>Triage</th>}
                  </tr>
                </thead>
                <tbody>
                  {drilled.items.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <div className="url">{f.target_url}</div>
                        <div style={{ color: "var(--faint)", fontSize: 12.5, marginTop: 4 }}>
                          {f.kind} &middot; {reasonLabel(f.reason)}
                        </div>
                        {Array.isArray(f.sources) && f.sources.length > 0 && (
                          <details className="inlinks">
                            <summary>Found on {f.sources.length} page{f.sources.length === 1 ? "" : "s"}</summary>
                            <ul>
                              {f.sources.slice(0, 20).map((s, i) => (
                                <li key={i}>
                                  <span className="url">{s.url}</span>
                                  {s.context && <div className="ctx">{s.context}</div>}
                                </li>
                              ))}
                              {f.sources.length > 20 && <li>...and {f.sources.length - 20} more</li>}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td><span className={"pill " + f.severity}>{f.severity}</span></td>
                      <td className="num">{f.impact_score}</td>
                      <td><span className={"pill " + (f.state === "open" ? "neutral" : f.state === "fixed" ? "ok" : "notice")}>{f.state}</span></td>
                      {owner && (
                        <td><TriageButtons scanId={id} findingId={f.id} state={f.state} /></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              {drilled.page > 1 && <a href={pageHref(id, group.key, drilled.page - 1)}>&larr; Previous</a>}
              <span>Page {drilled.page} of {drilled.totalPages} ({drilled.total} findings)</span>
              {drilled.page < drilled.totalPages && <a href={pageHref(id, group.key, drilled.page + 1)}>Next &rarr;</a>}
            </div>
          </div>
        )}

        {!owner && (
          <div className="noticebox" style={{ marginTop: 32 }}>
            This is the read-only client view. The scan owner sees triage controls here.
          </div>
        )}
      </div>
      <footer className="foot">
        <div className="wrap">Scan {id.slice(0, 8)}. Scores use <a href="/formulas">public formulas</a>.</div>
      </footer>
    </>
  );
}

function pageHref(id, groupKey, page) {
  return "/s/" + id + "?group=" + groupKey + "&page=" + page;
}

function reasonLabel(reason) {
  return {
    http_4xx: "HTTP 4xx",
    http_5xx: "HTTP 5xx",
    unreachable: "unreachable",
    dead_embed: "dead video",
    unverifiable: "could not verify",
    redirect_chain: "redirect chain",
  }[reason] || reason;
}
