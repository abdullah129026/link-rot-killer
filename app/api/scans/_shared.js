import { dbFromEnv, getScanWithSite } from '@/lib/db.js';
import { ownsScan, claimCookieName } from '@/lib/scan.js';
import { sessionUser } from '@/lib/supabase-server.js';

// Shared route plumbing: every scan route needs the DB, the scan with its
// site, and (for mutations) the owner check. Reads stay public by
// unguessable id, stated explicitly.

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function noDb() {
  return json({ error: 'Database not configured' }, 503);
}

// Signed-in user id from the Supabase session cookie, or null. Reads the
// session through @supabase/ssr; a missing config means anonymous only.
export async function sessionUserId() {
  const user = await sessionUser();
  return user ? user.id : null;
}

export async function loadScan(scanId) {
  const db = dbFromEnv();
  if (!db) return { response: noDb() };
  let scan;
  try {
    scan = await getScanWithSite(db, scanId);
  } catch {
    return { response: json({ error: 'Scan not found' }, 404) };
  }
  if (!scan) return { response: json({ error: 'Scan not found' }, 404) };
  return { db, scan };
}

export async function isOwner(req, scan) {
  const cookieToken = req.cookies.get(claimCookieName(scan.id))?.value;
  return ownsScan(scan, { cookieToken, userId: await sessionUserId() });
}

export async function forbidIfNotOwner(req, scan) {
  if (!(await isOwner(req, scan))) return json({ error: 'Not the scan owner' }, 403);
  return null;
}
