import Topbar from "@/app/Topbar";

// The public scoring formulas. The numbers here are the same ones the
// code computes (test/scan.test.js pins the worked example); the scores
// are only trustworthy if the reader can redo the math.
export default function Formulas() {
  return (
    <>
      <Topbar />
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="scanhead">
          <h1>How scoring works</h1>
          <p style={{ color: "var(--muted)" }}>
            The health score and every impact score use the formulas below. They are a triage
            aid, not a grade: they rank which fixes matter most, they do not measure traffic lost.
          </p>
        </div>

        <h2 style={{ fontSize: 20, marginTop: 32 }}>Per-finding impact score (0-100)</h2>
        <div className="formula">
          score = min(100, round(base x inlink_multiplier x depth_factor))
        </div>
        <ul>
          <li><strong>base</strong>, by issue type: broken internal link 40; broken image, iframe, or non-YouTube embed 35; dead YouTube embed 30; broken outbound link 20; redirect chain 10; could not verify 5.</li>
          <li><strong>inlink_multiplier</strong> = min(3, 1 + 0.5 x (source pages - 1)). A dead link on five of your pages costs more than one on a single page.</li>
          <li><strong>depth_factor</strong>: 1.0 at depth 0-1, 0.8 at depth 2, 0.6 at depth 3 and deeper, using the shallowest source page&apos;s depth. A broken link on the homepage costs more than one four clicks deep.</li>
        </ul>

        <h3 style={{ fontSize: 16 }}>Worked example</h3>
        <p>
          A broken internal link (base 40) appears on 3 pages, the shallowest at depth 2.
          Multiplier: 1 + 0.5 x (3 - 1) = 2. Depth factor: 0.8.
          Score: round(40 x 2 x 0.8) = <strong>64</strong>.
        </p>

        <h2 style={{ fontSize: 20, marginTop: 32 }}>Severity</h2>
        <ul>
          <li><span className="pill error">error</span> score 40 and up</li>
          <li><span className="pill warning">warning</span> score 15 to 39</li>
          <li><span className="pill notice">notice</span> score below 15</li>
        </ul>
        <p>
          Findings the checker could not verify are always <span className="pill notice">notice</span>,
          whatever the multiplier says. A site that blocks automated checks must not look broken.
        </p>

        <h2 style={{ fontSize: 20, marginTop: 32 }}>Health score (0-100)</h2>
        <div className="formula">
          health = max(0, round(100 - sum(impact_score / 10))) over open findings, excluding unverifiable
        </div>
        <p>
          One broken internal link with impact 64 costs 6.4 points; fixing it recovers those
          points. The scan page shows the recoverable points per issue type.
        </p>
        <h3 style={{ fontSize: 16 }}>Worked example</h3>
        <p>
          Open findings with impact 64 and 20, plus one unverifiable finding with impact 5.
          Cost: 6.4 + 2.0 = 8.4 (the unverifiable one counts 0). Health: round(100 - 8.4) = <strong>92</strong>.
        </p>

        <h2 style={{ fontSize: 20, marginTop: 32 }}>What the scores do not measure</h2>
        <ul>
          <li>No backlink or traffic data is used. The formulas only see status, internal vs outbound, inlink count on the scanned site, and page depth.</li>
          <li>The weights are starting values for triage, chosen by judgment, not science. They rank fixes; they do not price them.</li>
          <li>Only server-rendered HTML is checked. Content injected by JavaScript is out of scope.</li>
        </ul>
      </div>
      <footer className="foot">
        <div className="wrap">Link Rot Killer. Polite by design: 750ms per host, robots.txt honored, private IPs never touched.</div>
      </footer>
    </>
  );
}
