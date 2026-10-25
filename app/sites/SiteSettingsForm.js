'use client';

// Per-site settings on the dashboard: schedule plus the PDF cover
// fields (client name, prepared by). Saves with PATCH /api/sites/[id].
import { useState } from 'react';

export default function SiteSettingsForm({ site }) {
  const [schedule, setSchedule] = useState(site.schedule || 'none');
  const [clientName, setClientName] = useState(site.client_name || '');
  const [preparedBy, setPreparedBy] = useState(site.prepared_by || '');
  const [msg, setMsg] = useState('');

  async function save(e) {
    e.preventDefault();
    setMsg('Saving...');
    const res = await fetch('/api/sites/' + site.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule, client_name: clientName, prepared_by: preparedBy }),
    });
    setMsg(res.ok ? 'Saved.' : 'Could not save: ' + ((await res.json().catch(() => ({}))).error || res.status));
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
      <label style={{ fontSize: 13 }}>
        Re-scan{' '}
        <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          <option value="none">Never</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name (PDF cover)" maxLength={80} style={{ fontSize: 13 }} />
      <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Prepared by" maxLength={80} style={{ fontSize: 13 }} />
      <button className="btn ghost small" type="submit">Save</button>
      {msg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</span>}
    </form>
  );
}
