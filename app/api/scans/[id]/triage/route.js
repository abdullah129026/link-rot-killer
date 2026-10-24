import { listFindings as dbListFindings, getFindingStates, setFindingStates } from '@/lib/db.js';
import { canTransition, issueType, GROUP_DEFS } from '@/lib/scan.js';
import { json, loadScan, forbidIfNotOwner } from '../../_shared.js';
import { originOk } from '@/lib/scan.js';

const ACTIONS = new Set(['fixed', 'ignored', 'reopen']);

// Triage: per-row (finding_ids) or per-group bulk (group). A decision can
// only be undone back to open, never flipped fixed<->ignored; illegal
// transitions are a 400 naming the offending rows.
export async function POST(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const forbidden = forbidIfNotOwner(req, scan);
  if (forbidden) return forbidden;
  if (!originOk(req)) return json({ error: 'Bad origin' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const action = body && body.action;
  if (!ACTIONS.has(action)) return json({ error: 'action must be fixed, ignored, or reopen' }, 400);
  const to = action === 'reopen' ? 'open' : action;

  let ids;
  if (body.group) {
    if (!GROUP_DEFS[body.group]) return json({ error: 'Unknown issue group' }, 400);
    ids = await idsForGroup(db, scan, id, body.group);
  } else if (Array.isArray(body.finding_ids) && body.finding_ids.length) {
    ids = [...new Set(body.finding_ids)].slice(0, 500);
  } else {
    return json({ error: 'Provide finding_ids or group' }, 400);
  }

  const rows = await getFindingStates(db, id, ids);
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((x) => !found.has(x));
  if (missing.length) return json({ error: 'Unknown finding ids', ids: missing }, 400);
  const illegal = rows.filter((r) => !canTransition(r.state, to));
  if (illegal.length) {
    return json({ error: 'Illegal transition', ids: illegal.map((r) => r.id) }, 400);
  }

  const updated = await setFindingStates(db, id, ids, to);
  return json({ updated, state: to });
}

async function idsForGroup(db, scan, scanId, groupKey) {
  const seedHost = hostOf(scan.site && scan.site.seed_url);
  const findings = await dbListFindings(db, scanId);
  return findings.filter((f) => issueType(f, seedHost) === groupKey).map((f) => f.id);
}

function hostOf(seedUrl) {
  try {
    return new URL(seedUrl).hostname;
  } catch {
    return null;
  }
}
