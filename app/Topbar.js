export default function Topbar() {
  return (
    <div className="topbar">
      <div className="wrap">
        <a className="brand" href="/">Link Rot Killer</a>
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
