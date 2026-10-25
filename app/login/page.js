import Topbar from '@/app/Topbar';
import LoginForm from './LoginForm';
import { loginRedirectTarget } from '@/lib/auth.js';

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const next = loginRedirectTarget(typeof sp.next === 'string' ? sp.next : '/sites');
  return (
    <>
      <Topbar />
      <div className="wrap">
        <h1>Sign in</h1>
        <p style={{ color: 'var(--muted)' }}>A magic link arrives by email. Signing in saves your scans and unlocks scheduled re-scans.</p>
        <LoginForm next={next} />
      </div>
    </>
  );
}
