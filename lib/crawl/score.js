// Public scoring formulas (also shown on the formulas page): status class,
// internal vs outbound, inlink count on the scanned site, and page depth are
// the only inputs. No backlink or traffic data is used.

// Base impact by issue type. Reviewers attacked the weights; they are
// starting values for triage, not science.
export function baseForFinding({ kind, internal, reason }) {
  if (reason === 'unverifiable') return 5;
  if (reason === 'redirect_chain') return 10;
  if (reason === 'dead_embed') return 30;
  if (kind === 'image' || kind === 'iframe' || kind === 'embed') return 35;
  if (kind === 'link' && internal) return 40;
  if (kind === 'page' && internal) return 40;
  return 20; // broken outbound link
}

export function impactScore({ base, sourceCount, depth }) {
  const mult = Math.min(3, 1 + 0.5 * (Math.max(1, sourceCount) - 1));
  const depthFactor = depth <= 1 ? 1 : depth === 2 ? 0.8 : 0.6;
  return Math.min(100, Math.round(base * mult * depthFactor));
}

// Unverifiable findings are always blue notice, regardless of the multiplier,
// and are excluded from the health score: a blocked bot must not tank it.
export function severityOf(score, reason) {
  if (reason === 'unverifiable') return 'notice';
  if (score >= 40) return 'error';
  if (score >= 15) return 'warning';
  return 'notice';
}

export function healthScore(findings) {
  const cost = findings
    .filter((f) => f.reason !== 'unverifiable')
    .reduce((sum, f) => sum + f.impact_score / 10, 0);
  return Math.max(0, Math.round(100 - cost));
}

// Cross-scan identity: site, normalized URL, kind, reason. Re-scans seed
// triage state from the previous scan's fingerprints (ignored stays ignored;
// a fixed finding that reappears regresses to open).
export function fingerprint({ siteId, normalizedUrl, kind, reason }) {
  return [siteId || 'anon', normalizedUrl, kind, reason].join('|');
}
