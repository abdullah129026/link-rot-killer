'use client';

// GitHub token settings form: the token is stored encrypted (pgcrypto)
// and the page only ever shows the last 4 chars. The token is decrypted
// only inside the issue-creation route.
import { useEffect, useState } from 'react';

export default function GithubSettingsForm() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/settings/github').then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg('Saving...');
    const res = await fetch('/api/settings/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus(data);
      setToken('');
      setMsg('Saved. Only the last 4 chars are ever shown back.');
    } else {
      setMsg('Could not save: ' + (data.error || res.status));
    }
  }

  return (
    <div>
      {status && status.configured && <p style={{ color: 'var(--muted)' }}>Token saved (ending {status.last4}). Saving a new one replaces it.</p>}
      {status && !status.configured && <p style={{ color: 'var(--muted)' }}>No token saved yet.</p>}
      <form className="scanform" onSubmit={save}>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="GitHub fine-grained token" aria-label="GitHub token" autoComplete="off" />
        <button className="btn" type="submit">Save token</button>
      </form>
      {msg && <div className="noticebox" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
