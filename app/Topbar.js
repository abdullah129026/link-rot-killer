export default function Topbar() {
  return (
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
          <a href="/sites">Sites</a>
          <a href="/formulas">How scoring works</a>
          <a href="/settings">Settings</a>
          <a href="/login">Sign in</a>
        </nav>
      </div>
    </div>
  );
}
