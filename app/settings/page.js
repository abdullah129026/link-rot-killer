import Topbar from '@/app/Topbar';
import { sessionUser } from '@/lib/supabase-server.js';
import GithubSettingsForm from './GithubSettingsForm';

export const dynamic = 'force-dynamic';

// Settings: GitHub token with the honest-limits note. Client name and
// prepared-by live on each site, not in global settings.
export default async function SettingsPage() {
  const user = await sessionUser();
  if (!user) {
    return (
      <>
        <Topbar />
        <div className="wrap">
          <h1>Settings</h1>
          <p style={{ color: 'var(--muted)' }}>Sign in to save a GitHub token for one-click issue filing.</p>
          <a className="btn" href="/login?next=/settings">Sign in</a>
        </div>
      </>
    );
  }
  return (
    <>
      <Topbar />
      <div className="wrap">
        <h1>Settings</h1>
        <h2 style={{ fontSize: 16 }}>GitHub issue filing</h2>
        <p style={{ color: 'var(--muted)' }}>
          Paste a fine-grained token with issues:write on the repos you file into. It is stored encrypted
          (pgcrypto) and decrypted only when filing an issue, which goes only to the repo you name.
          The upgrade path is GitHub App OAuth; a stored personal token is the v1 trade.
        </p>
        <GithubSettingsForm />
      </div>
    </>
  );
}
