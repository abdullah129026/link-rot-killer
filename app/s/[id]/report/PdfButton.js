'use client';

// The button disables with "Preparing PDF..." while the browser fetches
// the generated file, so a slow PDF never looks like a dead click.
import { useState } from 'react';

export default function PdfButton({ scanId }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch('/api/scans/' + scanId + '/pdf');
      if (!res.ok) throw new Error('pdf failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'linkrot-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn small" onClick={download} disabled={busy}>
      {busy ? 'Preparing PDF...' : 'Download PDF'}
    </button>
  );
}
