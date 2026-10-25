// Scheduling rules: a site is due when its last scan started longer ago
// than its interval. No last scan means due now. 'none' is never due.
// The cron bearer check fails closed when CRON_SECRET is unset.
export const SCHEDULE_INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function isDue({ schedule, lastStartedAt, now = new Date() }) {
  const interval = SCHEDULE_INTERVAL_MS[schedule];
  if (!interval) return false;
  if (!lastStartedAt) return true;
  return now.getTime() - new Date(lastStartedAt).getTime() >= interval;
}

export function cronAuthorized(req, secret) {
  if (!secret) return false;
  return req.headers.get('authorization') === 'Bearer ' + secret;
}
