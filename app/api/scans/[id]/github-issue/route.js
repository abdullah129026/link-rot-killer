import { listFindings, readGithubToken } from '@/lib/db.js';
import { groupFindings } from '@/lib/scan.js';
import { parseRepo, buildIssueBody, createGithubIssue } from '@/lib/github.js';
import { originOk } from '@/lib/scan.js';
import { json, loadScan, forbidIfNotOwner, sessionUserId } from '../../_shared.js';

// File a GitHub issue for a scan: summary, top findings by impact, and a
// link to the full report. The stored token is decrypted only here, and
// the issue goes only to the owner/repo the user types. Owner only, and
// only with a saved token, so a claim-cookie owner must sign in first.
export async function POST(req, { params }) {
  const { id } = await params;
  const loaded = await loadScan(id);
  if (loaded.response) return loaded.response;
  const { db, scan } = loaded;

  const forbidden = await forbidIfNotOwner(req, scan);
  if (forbidden) return forbidden;
  if (!originOk(req)) return json({ error: 'Bad origin' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const repo = parseRepo(body && body.repo);
  if (!repo) return json({ error: 'repo must look like owner/repo' }, 400);

  const userId = await sessionUserId();
  if (!userId) return json({ error: 'Sign in and save a GitHub token first' }, 400);
  const key = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!key) return json({ error: 'Token encryption is not configured' }, 503);
  const token = await readGithubToken(db, userId, key);
  if (!token) return json({ error: 'No GitHub token saved. Add one in Settings first.' }, 400);

  const findings = await listFindings(db, id);
  let seedHost = null;
  try {
    seedHost = scan.site ? new URL(scan.site.seed_url).hostname : null;
  } catch {
    seedHost = null;
  }
  const groups = groupFindings(findings, seedHost);
  const origin = new URL(req.url).origin;
  const issueBody = buildIssueBody({
    siteName: scan.site ? scan.site.name : 'Scan',
    seedUrl: scan.site ? scan.site.seed_url : '',
    health: scan.health_score,
    groups,
    scanUrl: origin + '/s/' + id,
    reportUrl: origin + '/s/' + id + '/report',
  });
  try {
    const created = await createGithubIssue({
      fetchFn: fetch,
      token,
      owner: repo.owner,
      repo: repo.repo,
      title: 'Link rot report: ' + (scan.site ? scan.site.name : 'scan'),
      body: issueBody,
    });
    return json(created, 201);
  } catch (e) {
    return json({ error: 'GitHub refused the issue. Check the repo name and that the token has issues:write on it.' }, 502);
  }
}
