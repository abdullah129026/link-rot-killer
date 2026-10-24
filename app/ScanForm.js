"use client";

import { useEffect, useState } from "react";

// The scan form: posts to /api/scans, saves the scan to the recent list in
// localStorage, and routes to the scan page. The blocked state names the
// quota and when it resets.
export default function ScanForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem("lkr_recent") || "[]"));
    } catch {
      setRecent([]);
    }
  }, []);

  async function submit(seed) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed_url: seed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const when = data.resets_at ? new Date(data.resets_at).toLocaleString() : "soon";
        setError((data.error || "Daily scan limit reached.") + " Resets " + when + ".");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong starting the scan.");
        return;
      }
      try {
        const list = JSON.parse(localStorage.getItem("lkr_recent") || "[]");
        list.unshift({ id: data.id, seed: seed, at: new Date().toISOString() });
        localStorage.setItem("lkr_recent", JSON.stringify(list.slice(0, 10)));
      } catch {
        // localStorage is a convenience, never load-bearing
      }
      window.location.href = "/s/" + data.id;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        className="scanform"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) submit(url.trim());
        }}
      >
        <input
          type="url"
          required
          placeholder="https://example.com/sitemap.xml"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Sitemap or homepage URL"
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Starting..." : "Scan my site"}
        </button>
      </form>
      {error && <p className="formerror">{error}</p>}
      <p className="formhint">
        No account needed. Or <a href="#" onClick={(e) => { e.preventDefault(); submit("https://example.com"); }}>run an example scan</a> to see what a report looks like.
      </p>
      {recent.length > 0 && (
        <ul className="recentlist">
          {recent.map((r) => (
            <li key={r.id}>
              <a href={"/s/" + r.id}>{r.seed}</a>
              <span className="date">{new Date(r.at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
