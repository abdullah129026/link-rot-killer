import { dbFromEnv, getGithubTokenLast4, storeGithubToken } from '@/lib/db.js';
import { tokenLast4 } from '@/lib/github.js';
import { json, noDb, sessionUserId } from '../../scans/_shared.js';

// GitHub token settings: the token is stored encrypted (pgcrypto, 0002
// RPCs) and the read path returns only the last 4 chars. Signed in only.
export async function GET() {
  const db = dbFromEnv();
  if (!db) return noDb();
  const userId = await sessionUserId();
  if (!userId) return json({ error: 'Sign in first' }, 401);
  const last4 = await getGithubTokenLast4(db, userId);
  return json(last4 ? { configured: true, last4 } : { configured: false });
}

export async function POST(req) {
  const db = dbFromEnv();
  if (!db) return noDb();
  const userId = await sessionUserId();
  if (!userId) return json({ error: 'Sign in first' }, 401);
  const key = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!key) return json({ error: 'Token encryption is not configured' }, 503);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const token = String((body && body.token) || '').trim();
  if (!token || token.length > 255) return json({ error: 'Paste a GitHub fine-grained token (issues:write on the target repo)' }, 400);
  await storeGithubToken(db, userId, token, key, tokenLast4(token));
  return json({ configured: true, last4: tokenLast4(token) });
}
