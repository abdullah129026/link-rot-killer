import ScanForm from "./ScanForm";

export default function Home() {
  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <a className="brand" href="/">
            <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="4" y="4" width="56" height="56" rx="14" fill="#16161a" />
              <g stroke="#ffffff" strokeWidth="6.5" fill="none" strokeLinecap="round">
                <path d="M 27 24 H 18 A 8 8 0 0 0 18 40 H 27" />
                <path d="M 37 24 H 46 A 8 8 0 0 1 46 40 H 37" />
              </g>
            </svg>
            <span>Link Rot Killer</span>
          </a>
          <nav>
            <a href="/formulas">How scoring works</a>
          </nav>
        </div>
      </div>
      <div className="wrap">
        <section className="hero">
          <h1>Paste a sitemap. Get every dead link, image, and embed, scored by SEO impact.</h1>
          <p className="lede">
            No account needed for the first scan. You get a shareable report link, findings grouped
            by issue type with the exact pages that link to them, and a client-ready PDF.
          </p>
          <ScanForm />
        </section>
        <section className="steps">
          <div className="card">
            <h3>1. Paste a URL</h3>
            <p>A sitemap.xml works best. A plain homepage works too; the scanner discovers pages from there and says so.</p>
          </div>
          <div className="card">
            <h3>2. Watch it crawl</h3>
            <p>The scan page streams findings live: broken links, dead images, dead YouTube embeds, redirect chains.</p>
          </div>
          <div className="card">
            <h3>3. Fix what matters</h3>
            <p>Every finding carries an impact score and severity, so the three fixes that move the needle come first.</p>
          </div>
        </section>
        <section>
          <h2 style={{ fontSize: 20 }}>Scoring, in the open</h2>
          <p style={{ color: "var(--muted)", maxWidth: 640 }}>
            The health score and every impact score use public formulas with named inputs: issue
            type, internal vs outbound, how many of your pages link to it, and page depth.
            No backlink or traffic data, and the page says so.{" "}
            <a href="/formulas">Read the formulas</a>.
          </p>
        </section>
      </div>
      <footer className="foot">
        <div className="wrap">
          Polite by design: one transparent user agent, 750ms between hits to the same host,
          robots.txt honored, private IP ranges never touched.
        </div>
      </footer>
    </>
  );
}
