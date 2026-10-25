import { dbFromEnv, getSiteById, updateSite } from '@/lib/db.js';
import { json, noDb, sessionUserId } from '../../scans/_shared.js';

// Per-site settings: schedule (none/daily/weekly), client name and
// prepared-by for the PDF cover. Signed-in owner only; both text fields
// are capped at 80 chars, matching the PDF trust boundary.
export async function PATCH(req, { params }) {
  const { id } = await params;
  const db = dbFromEnv();
  if (!db) return noDb();
  const userId = await sessionUserId();
  if (!userId) return json({ error: 'Sign in first' }, 401);
  let site;
  try {
    site = await getSiteById(db, id);
  } catch {
    return json({ error: 'Site not found' }, 404);
  }
  if (site.owner_user_id !== userId) return json({ error: 'Not the site owner' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const patch = {};
  if (body.schedule !== undefined) {
    if (!['none', 'daily', 'weekly'].includes(body.schedule)) return json({ error: 'schedule must be none, daily, or weekly' }, 400);
    patch.schedule = body.schedule;
  }
  for (const field of ['client_name', 'prepared_by']) {
    if (body[field] !== undefined) {
      const value = String(body[field]).trim();
      if (value.length > 80) return json({ error: field + ' is too long (max 80 chars)' }, 400);
      patch[field] = value || null;
    }
  }
  if (!Object.keys(patch).length) return json({ error: 'Nothing to update' }, 400);
  await updateSite(db, id, patch);
  return json({ ok: true });
}
