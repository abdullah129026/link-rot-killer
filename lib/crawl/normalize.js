// Canonical URL form: one URL is one target. Called before every insert so
// https://x.com/p, https://x.com/p/ and https://x.com/p?utm_source=a do not
// become three targets that triple-count one finding.
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'yclid', '_ga', 'vero_conv', 'vero_id',
]);
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.port === DEFAULT_PORTS[u.protocol]) u.port = '';
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}
