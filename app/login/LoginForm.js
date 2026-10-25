'use client';

// Magic-link sign-in form: no password to store, the same pattern as
// project 2. The link returns to /auth/callback, which attaches any
// claim-cookie scans to the new session before redirecting on.
import { useState } from 'react';
import { browserClient, authConfigured } from '@/lib/supabase-browser.js';

export default function LoginForm({ next }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const client = browserClient();
    if (!client) {
      setError('Sign-in is not configured yet.');
      return;
    }
    setState('sending');
    setError('');
    const { error: err } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/auth/callback?next=' + encodeURIComponent(next || '/sites') },
    });
    if (err) {
      setError(err.message);
      setState('idle');
    } else {
      setState('sent');
    }
  }

  if (!authConfigured()) {
    return <div className="noticebox">Sign-in is not configured yet: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then come back.</div>;
  }
  if (state === 'sent') {
    return <div className="noticebox">Check your inbox: the sign-in link is on its way. It brings you back here.</div>;
  }
  return (
    <form className="scanform" onSubmit={submit}>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address" />
      <button className="btn" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending...' : 'Send sign-in link'}</button>
      {error && <div className="noticebox">{error}</div>}
    </form>
  );
}
