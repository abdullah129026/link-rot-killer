"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Live progress block: while the scan is queued or crawling, POST one tick
// every few seconds (a watched scan finishes in real time), then refresh
// the page data when something changed or the scan finished.
export function ScanLive({ scanId, initial }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const timer = useRef(null);

  useEffect(() => {
    if (snap.status !== "queued" && snap.status !== "crawling") return;
    timer.current = setInterval(async () => {
      try {
        const tick = await fetch("/api/scans/" + scanId + "/tick", { method: "POST" });
        const ticked = await tick.json().catch(() => ({}));
        const res = await fetch("/api/scans/" + scanId);
        if (!res.ok) return;
        const data = await res.json();
        setSnap({ status: data.status, stats: data.stats, notices: data.stats.notices });
        if (ticked.done || data.status === "done" || data.status === "failed" || ticked.processed > 0) {
          router.refresh();
        }
      } catch {
        // a failed poll is retried on the next interval; the page stays readable
      }
    }, 3000);
    return () => clearInterval(timer.current);
  }, [scanId, snap.status, router]);

  const s = snap.stats || {};
  const active = snap.status === "queued" || snap.status === "crawling";
  return (
    <div>
      <div className="scanmeta">
        <StatusPill status={snap.status} />
        {active && <span style={{ color: "var(--muted)", fontSize: 14 }}>Crawling now. Findings stream in below; keep this tab open.</span>}
      </div>
      <div className="counters">
        <div>
          <div className="num" style={{ color: "var(--error)" }}>{s.broken_found || 0}</div>
          <div className="cap">broken</div>
        </div>
        <div>
          <div className="num" style={{ color: "var(--notice)" }}>{s.unverifiable_found || 0}</div>
          <div className="cap">couldn&apos;t verify</div>
        </div>
        <div>
          <div className="num">{s.targets_checked || 0}</div>
          <div className="cap">targets checked</div>
        </div>
      </div>
      {(snap.notices || []).includes("sitemap_fallback") && (
        <div className="noticebox">The sitemap wasn&apos;t usable, so pages are being discovered from the homepage instead.</div>
      )}
      {(snap.notices || []).includes("cap_reached") && (
        <div className="noticebox">Stopped at the scan cap (200 pages, 3000 targets). The rest went unchecked.</div>
      )}
      <div className="noticebox">Only server-rendered HTML is checked. Content injected by JavaScript is out of scope for this scan.</div>
      {snap.status === "failed" && (
        <div className="noticebox" style={{ borderColor: "var(--error)", color: "var(--error)" }}>
          This scan failed{s.error ? ": " + s.error : "."} <RescanButton scanId={scanId} label="Start a new scan" />
        </div>
      )}
    </div>
  );
}

export function StatusPill({ status }) {
  const map = {
    queued: ["neutral", "Queued"],
    crawling: ["notice", "Crawling"],
    done: ["ok", "Done"],
    failed: ["error", "Failed"],
  };
  const [cls, label] = map[status] || ["neutral", status];
  return <span className={"pill " + cls}>{label}</span>;
}

async function postTriage(scanId, payload) {
  const res = await fetch("/api/scans/" + scanId + "/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Triage failed");
  return data;
}

// Per-row triage: the legal next actions for the row's current state.
export function TriageButtons({ scanId, findingId, state }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action) {
    setBusy(true);
    try {
      await postTriage(scanId, { finding_ids: [findingId], action });
      router.refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  const actions =
    state === "open"
      ? [["fixed", "Fixed"], ["ignored", "Ignore"]]
      : [["reopen", "Reopen"]];
  return (
    <div className="triagebtns">
      {actions.map(([a, label]) => (
        <button key={a} className="btn ghost small" disabled={busy} onClick={() => act(a)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Bulk triage for a whole issue group, with a confirm because it touches
// many rows at once. Rows already in an illegal state for the transition
// are rejected by the API and reported.
export function GroupBulkActions({ scanId, groupKey, groupLabel }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action, label) {
    if (!window.confirm("Mark every finding in \u201c" + groupLabel + "\u201d as " + label.toLowerCase() + "?")) return;
    setBusy(true);
    try {
      const data = await postTriage(scanId, { group: groupKey, action });
      router.refresh();
      if (data.updated === 0) alert("Nothing changed: those findings are already in that state.");
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bulkbar">
      <span style={{ color: "var(--muted)", fontSize: 14 }}>Bulk triage:</span>
      <button className="btn ghost small" disabled={busy} onClick={() => act("fixed", "Fixed")}>Mark all fixed</button>
      <button className="btn ghost small" disabled={busy} onClick={() => act("ignored", "Ignored")}>Mark all ignored</button>
    </div>
  );
}

export function RescanButton({ scanId, label }) {
  const [busy, setBusy] = useState(false);
  async function rescan() {
    setBusy(true);
    try {
      const res = await fetch("/api/scans/" + scanId + "/rescan", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Re-scan failed");
      window.location.href = "/s/" + data.id;
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  }
  return (
    <button className="btn ghost small" disabled={busy} onClick={rescan}>
      {busy ? "Starting..." : label || "Re-scan"}
    </button>
  );
}
