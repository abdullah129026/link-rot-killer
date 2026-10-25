// Auth helpers: redirect guard plus claim attach on sign-in.
// Only same-origin paths are allowed as login targets; anything else
// falls back to "/". Open redirects are a trust-boundary issue.
export function loginRedirectTarget(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  return next;
}

// On sign-in, every scan whose claim cookie the browser still holds
// attaches to the user: the site's owner becomes the signed-in user, so
// the dashboard picks the scan up. A cookie that does not match the
// scan's stored token attaches nothing.
export async function attachClaimedScans(db, userId, cookiePairs, store) {
  const attached = [];
  for (const [name, value] of cookiePairs) {
    if (!name.startsWith('lkr_claim_')) continue;
    const scanId = name.slice('lkr_claim_'.length);
    const claim = await store.getScanClaim(db, scanId);
    if (claim && claim.claim_token === value && claim.site_id) {
      await store.setSiteOwner(db, claim.site_id, userId);
      attached.push(scanId);
    }
  }
  return attached;
}
