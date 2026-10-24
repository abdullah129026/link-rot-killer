import { insertScan } from '@/lib/db.js';
import { randomClaimToken, claimCookieName, originOk } from '@/lib/scan.js';
import { json, loadScan, forbidIfNotOwner } from '../../_shared.js';

// Re-scan: a new scan row on the same site, so fingerprints match the
// previous scan (triage carryover) and before/after has something to
// compare against. The new scan gets its own claim cookie.
export async function POST(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const forbidden = forbidIfNotOwner(req, scan);
  if (forbidden) return forbidden;
  if (!originOk(req)) return json({ error: 'Bad origin' }, 403);
  if (!scan.site_id) return json({ error: 'This scan has no site to re-scan' }, 400);

  const claimToken = randomClaimToken();
  const created = await insertScan(db, { site_id: scan.site_id, claim_token: claimToken, ip: null });
  const res = json({ id: created.id }, 201);
  res.cookies.set(claimCookieName(created.id), claimToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
