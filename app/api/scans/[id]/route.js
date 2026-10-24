import { listFindings as dbListFindings, getPreviousScan as dbGetPreviousScan } from '@/lib/db.js';
import { groupFindings, paginate, beforeAfter, GROUP_DEFS } from '@/lib/scan.js';
import { json, loadScan, isOwner } from '../_shared.js';

// Public by unguessable id: status, split counters, grouped findings,
// before/after vs the previous finished scan of the same site. The page
// polls this while the scan is active.
export async function GET(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const url = new URL(req.url);
  const groupKey = url.searchParams.get('group');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  if (groupKey && !GROUP_DEFS[groupKey]) return json({ error: 'Unknown issue group' }, 400);

  const seedHost = scan.site ? hostOf(scan.site.seed_url) : null;
  const findings = await dbListFindings(db, id);
  const groups = groupFindings(findings, seedHost);

  let before = null;
  const prev = await dbGetPreviousScan(db, scan.site_id, id);
  if (prev) {
    const prevFindings = await dbListFindings(db, prev.id);
    const { newSince, fixedSince } = beforeAfter(prevFindings, findings);
    const slim = (f) => ({
      id: f.id,
      target_url: f.target_url,
      kind: f.kind,
      reason: f.reason,
      severity: f.severity,
      impact_score: f.impact_score,
    });
    before = {
      new_count: newSince.length,
      fixed_count: fixedSince.length,
      new: newSince.slice(0, 10).map(slim),
      fixed: fixedSince.slice(0, 10).map(slim),
    };
  }

  let drilled = null;
  if (groupKey) {
    const group = groups.find((g) => g.key === groupKey);
    drilled = group ? paginate(group.findings, page) : paginate([], 1);
  }

  const stats = scan.stats || {};
  return json({
    id: scan.id,
    status: scan.status,
    site_name: scan.site ? scan.site.name : 'scan',
    seed_url: scan.site ? scan.site.seed_url : null,
    health_score: scan.health_score,
    stats: {
      pages_crawled: stats.pages_crawled || 0,
      targets_checked: stats.targets_checked || 0,
      broken_found: stats.broken_found || 0,
      unverifiable_found: stats.unverifiable_found || 0,
      notices: stats.notices || [],
    },
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      count: g.count,
      worst: g.worst,
      recoverable: g.recoverable,
      remediation: GROUP_DEFS[g.key].remediation,
    })),
    findings: drilled,
    before,
    is_owner: isOwner(req, scan),
    started_at: scan.started_at,
    finished_at: scan.finished_at,
  });
}

function hostOf(seedUrl) {
  try {
    return new URL(seedUrl).hostname;
  } catch {
    return null;
  }
}
