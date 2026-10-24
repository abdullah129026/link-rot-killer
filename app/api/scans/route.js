import { dbFromEnv, countAnonScansSince, countSignedScansSince, insertSite, insertScan } from '@/lib/db.js';
import {
  validateSeedUrl,
  SeedUrlError,
  clientIp,
  startOfUtcDay,
  overQuota,
  createScanRecord,
  claimCookieName,
  ANON_DAILY_LIMIT,
  SIGNED_DAILY_LIMIT,
} from '@/lib/scan.js';
import { json, noDb, sessionUserId } from './_shared.js';

// Start a scan: paste a sitemap or homepage URL, no account needed.
// Anonymous quota is 3 scans per IP per UTC day; the blocked state names
// the limit and when it resets instead of a bare 429.
export async function POST(req) {
  const db = dbFromEnv();
  if (!db) return noDb();
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  let seedUrl;
  try {
    seedUrl = await validateSeedUrl(body && body.seed_url);
  } catch (e) {
    if (e instanceof SeedUrlError) return json({ error: e.message, code: e.code }, 400);
    throw e;
  }

  const userId = sessionUserId();
  const since = startOfUtcDay();
  if (userId) {
    const n = await countSignedScansSince(db, userId, since);
    if (overQuota(n, SIGNED_DAILY_LIMIT)) {
      return json({ error: 'Daily scan limit reached', limit: SIGNED_DAILY_LIMIT, resets_at: nextMidnightUtc() }, 429);
    }
  } else {
    const ip = clientIp(req.headers);
    const n = await countAnonScansSince(db, ip, since);
    if (overQuota(n, ANON_DAILY_LIMIT)) {
      return json(
        {
          error: 'You have used today\u2019s 3 free scans. Sign in for 20 a day.',
          limit: ANON_DAILY_LIMIT,
          resets_at: nextMidnightUtc(),
        },
        429
      );
    }
  }

  const { scanId, claimToken } = await createScanRecord(
    db,
    { seedUrl, ip: userId ? null : clientIp(req.headers), userId },
    { insertSite, insertScan }
  );
  const res = json({ id: scanId }, 201);
  res.cookies.set(claimCookieName(scanId), claimToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

function nextMidnightUtc() {
  const d = startOfUtcDay();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
