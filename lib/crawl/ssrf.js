import dns from 'node:dns/promises';

// SSRF guard (non-negotiable): after DNS resolution, refuse every private,
// loopback, and link-local range. Runs before every fetch and is re-run on
// every redirect hop, because a redirect can bounce to a private address.
export function isPrivateIp(ip) {
  if (ip.includes(':')) return isPrivateIp6(ip.toLowerCase());
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return (
    o[0] === 10 ||
    o[0] === 127 ||
    o[0] === 0 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 169 && o[1] === 254)
  );
}

function isPrivateIp6(ip) {
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7)); // ipv4-mapped
  const first = ip.split(':')[0];
  const n = parseInt(first, 16);
  if (Number.isNaN(n)) return true;
  return (n & 0xfe00) === 0xfc00 || (n & 0xffc0) === 0xfe80; // fc00::/7, fe80::/10
}

export class SsrfError extends Error {}

export async function assertPublicUrl(url) {
  const u = new URL(url);
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new SsrfError('dns failed for ' + u.hostname);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new SsrfError('private address ' + a.address);
  }
}
