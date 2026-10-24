import { createClient } from '@supabase/supabase-js';

// Server-side only: the service_role key bypasses RLS. Every route checks
// ownership or the claim token before calling these. Null-safe so a missing
// DB config renders an empty state instead of a 500.
export function dbFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function must(rows, error, what) {
  if (error) throw new Error(what + ': ' + error.message);
  return rows;
}

export async function getScan(db, scanId) {
  const { data, error } = await db
    .from('scans')
    .select('id, site_id, status, stats, sites!left(seed_url, max_pages)')
    .eq('id', scanId)
    .single();
  const scan = must(data, error, 'getScan');
  // The seed URL lives on the site row; flatten it so the crawl loop
  // reads scan.seed_url whatever the caller is.
  scan.seed_url = (scan.sites && scan.sites.seed_url) || null;
  scan.max_pages = (scan.sites && scan.sites.max_pages) || 200;
  return scan;
}

// The scan page and the JSON API need the site's display fields and the
// owner for the owner/client mode split, in one query.
export async function getScanWithSite(db, scanId) {
  const { data, error } = await db
    .from('scans')
    .select(
      'id, site_id, status, claim_token, ip, stats, health_score, started_at, finished_at,' +
        ' sites!left(name, seed_url, owner_user_id, client_name, prepared_by)'
    )
    .eq('id', scanId)
    .single();
  const scan = must(data, error, 'getScanWithSite');
  scan.site = scan.sites || null;
  delete scan.sites;
  return scan;
}

export async function insertSite(db, row) {
  const { data, error } = await db.from('sites').insert(row).select('id').single();
  return must(data, error, 'insertSite');
}

export async function insertScan(db, row) {
  const { data, error } = await db.from('scans').insert(row).select('id, claim_token').single();
  return must(data, error, 'insertScan');
}

// Anonymous scans created from one IP since `since` (start of the UTC
// day). The signed-in quota counts the user's own sites instead.
export async function countAnonScansSince(db, ip, since) {
  const { count, error } = await db
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('started_at', since.toISOString());
  return must(count, error, 'countAnonScansSince');
}

export async function countSignedScansSince(db, userId, since) {
  const { count, error } = await db
    .from('scans')
    .select('id, sites!inner(owner_user_id)', { count: 'exact', head: true })
    .eq('sites.owner_user_id', userId)
    .gte('started_at', since.toISOString());
  return must(count, error, 'countSignedScansSince');
}

export async function listFindings(db, scanId) {
  const { data, error } = await db
    .from('findings')
    .select('id, fingerprint, target_url, kind, reason, severity, impact_score, state, sources, checked_at')
    .eq('scan_id', scanId)
    .order('impact_score', { ascending: false });
  return must(data, error, 'listFindings') || [];
}

export async function getFindingStates(db, scanId, ids) {
  const { data, error } = await db.from('findings').select('id, state').eq('scan_id', scanId).in('id', ids);
  return must(data, error, 'getFindingStates') || [];
}

export async function setFindingStates(db, scanId, ids, to) {
  const { data, error } = await db
    .from('findings')
    .update({ state: to })
    .eq('scan_id', scanId)
    .in('id', ids)
    .select('id');
  return (must(data, error, 'setFindingStates') || []).length;
}

// The latest finished scan of the same site, for before/after and the
// triage carryover. The current scan is excluded.
export async function getPreviousScan(db, siteId, scanId) {
  if (!siteId) return null;
  const { data, error } = await db
    .from('scans')
    .select('id')
    .eq('site_id', siteId)
    .eq('status', 'done')
    .neq('id', scanId)
    .order('started_at', { ascending: false })
    .limit(1);
  const rows = must(data, error, 'getPreviousScan') || [];
  return rows[0] || null;
}

// fingerprint -> triage state on the previous scan. The crawl loop seeds
// 'ignored' from this; 'fixed' regresses to 'open' by default.
export async function getTriageCarryover(db, scanId) {
  const { data: scan, error: scanError } = await db
    .from('scans')
    .select('site_id')
    .eq('id', scanId)
    .single();
  must(scan, scanError, 'getTriageCarryover');
  const prev = await getPreviousScan(db, scan.site_id, scanId);
  if (!prev) return new Map();
  const { data, error } = await db.from('findings').select('fingerprint, state').eq('scan_id', prev.id);
  const rows = must(data, error, 'getTriageCarryover findings') || [];
  return new Map(rows.map((r) => [r.fingerprint, r.state]));
}

export async function claimTargets(db, scanId, limit) {
  const { data, error } = await db.rpc('claim_scan_targets', { p_scan_id: scanId, p_limit: limit });
  return must(data, error, 'claimTargets') || [];
}

export async function insertTargets(db, rows) {
  if (!rows.length) return;
  const { error } = await db
    .from('scan_targets')
    .upsert(rows, { onConflict: 'scan_id,normalized_url', ignoreDuplicates: true });
  must(null, error, 'insertTargets');
}

export async function insertEdges(db, rows) {
  if (!rows.length) return;
  const { error } = await db
    .from('scan_target_sources')
    .upsert(rows, { onConflict: 'target_id,source_target_id', ignoreDuplicates: true });
  must(null, error, 'insertEdges');
}

export async function insertFinding(db, row) {
  const { error } = await db.from('findings').insert(row);
  must(null, error, 'insertFinding');
}

// Every source page on the scanned site that contains this target, with the
// anchor text or alt captured at extraction time.
export async function getSources(db, targetId) {
  const { data, error } = await db
    .from('scan_target_sources')
    .select('context, source:scan_targets!scan_target_sources_source_target_id_fkey(url, depth)')
    .eq('target_id', targetId);
  const rows = must(data, error, 'getSources') || [];
  return rows.map((r) => ({ url: r.source.url, depth: r.source.depth, context: r.context }));
}

export async function bumpStats(db, scanId, { pages = 0, targets = 0, broken = 0, unverifiable = 0 } = {}) {
  const { error } = await db.rpc('bump_scan_stats', {
    p_scan_id: scanId,
    p_pages: pages,
    p_targets: targets,
    p_broken: broken,
    p_unverifiable: unverifiable,
  });
  must(null, error, 'bumpStats');
}

export async function setScanDone(db, scanId, healthScore) {
  const { error } = await db
    .from('scans')
    .update({ status: 'done', health_score: healthScore, finished_at: new Date().toISOString() })
    .eq('id', scanId);
  must(null, error, 'setScanDone');
}

export async function setScanFailed(db, scanId, errorMsg) {
  const { error } = await db
    .from('scans')
    .update({ status: 'failed', finished_at: new Date().toISOString(), stats: { error: String(errorMsg).slice(0, 500) } })
    .eq('id', scanId);
  must(null, error, 'setScanFailed');
}

export async function requeueTarget(db, targetId, notBefore) {
  const { error } = await db
    .from('scan_targets')
    .update({ status: 'pending', claimed_at: null, not_before: new Date(notBefore).toISOString() })
    .eq('id', targetId);
  must(null, error, 'requeueTarget');
}

export async function markTargetDone(db, targetId, patch) {
  const { error } = await db
    .from('scan_targets')
    .update({ status: 'done', checked_at: new Date().toISOString(), ...patch })
    .eq('id', targetId);
  must(null, error, 'markTargetDone');
}

// Pending targets plus in_progress ones whose lease has not expired. The
// scan flips to done only when this is zero.
export async function countOpen(db, scanId) {
  const { count, error } = await db
    .from('scan_targets')
    .select('id', { count: 'exact', head: true })
    .eq('scan_id', scanId)
    .or('status.eq.pending,and(status.eq.in_progress,claimed_at.gt.' + new Date(Date.now() - 10 * 60 * 1000).toISOString() + ')');
  return must(count, error, 'countOpen');
}

export async function listFindingsForScore(db, scanId) {
  const { data, error } = await db.from('findings').select('impact_score, reason').eq('scan_id', scanId);
  return must(data, error, 'listFindingsForScore') || [];
}

// Cron sweep: reclaim targets whose tick died holding them (10 min lease),
// and fail scans with no tick progress for 24h.
export async function reclaimStaleTargets(db) {
  const { error } = await db
    .from('scan_targets')
    .update({ status: 'pending', claimed_at: null })
    .eq('status', 'in_progress')
    .lt('claimed_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  must(null, error, 'reclaimStaleTargets');
}

export async function failStalledScans(db) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db
    .from('scans')
    .update({ status: 'failed', finished_at: new Date().toISOString() })
    .in('status', ['queued', 'crawling'])
    .lt('started_at', cutoff)
    .or('last_tick_at.is.null,last_tick_at.lt.' + cutoff);
  must(null, error, 'failStalledScans');
}

export async function getThrottleLedger(db, hosts) {
  if (!hosts.length) return new Map();
  const { data, error } = await db.from('host_throttle').select('host, last_hit_at').in('host', hosts);
  const rows = must(data, error, 'getThrottleLedger') || [];
  return new Map(rows.map((r) => [r.host, new Date(r.last_hit_at).getTime()]));
}

export async function touchThrottle(db, host) {
  const { error } = await db
    .from('host_throttle')
    .upsert({ host, last_hit_at: new Date().toISOString() }, { onConflict: 'host' });
  must(null, error, 'touchThrottle');
}

export async function patchScan(db, scanId, patch) {
  const { error } = await db.from('scans').update(patch).eq('id', scanId);
  must(null, error, 'patchScan');
}

// Append a product notice (sitemap_fallback, cap_reached) to the scan's
// stats, for the scan page to render.
export async function addNotice(db, scanId, notice) {
  const { data, error } = await db.from('scans').select('stats').eq('id', scanId).single();
  const scan = must(data, error, 'addNotice');
  const notices = [...((scan.stats && scan.stats.notices) || [])];
  if (!notices.includes(notice)) notices.push(notice);
  await patchScan(db, scanId, { stats: { ...(scan.stats || {}), notices } });
}

export async function countTargets(db, scanId) {
  const { data, error } = await db.from('scan_targets').select('kind').eq('scan_id', scanId);
  const rows = must(data, error, 'countTargets') || [];
  return { total: rows.length, pages: rows.filter((r) => r.kind === 'page').length };
}

export async function getTargetIds(db, scanId, normalizedUrls) {
  if (!normalizedUrls.length) return new Map();
  const { data, error } = await db
    .from('scan_targets')
    .select('id, normalized_url')
    .eq('scan_id', scanId)
    .in('normalized_url', normalizedUrls);
  const rows = must(data, error, 'getTargetIds') || [];
  return new Map(rows.map((r) => [r.normalized_url, r.id]));
}
