import { dbFromEnv, getScanWithSite } from '@/lib/db.js';
import { ownsScan, claimCookieName } from '@/lib/scan.js';

// Shared route plumbing: every scan route needs the DB, the scan with its
// site, and (for mutations) the owner check. Reads stay public by
// unguessable id, stated explicitly.

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function noDb() {
  return json({ error: 'Database not configured' }, 503);
}

// Auth arrives with the scheduling slice; until then every scan is
// anonymous and ownership comes from the claim cookie alone.
export function sessionUserId() {
  return null;
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

export function isOwner(req, scan) {
  const cookieToken = req.cookies.get(claimCookieName(scan.id))?.value;
  return ownsScan(scan, { cookieToken, userId: sessionUserId() });
}

export function forbidIfNotOwner(req, scan) {
  if (!isOwner(req, scan)) return json({ error: 'Not the scan owner' }, 403);
  return null;
}
