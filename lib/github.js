// GitHub issue filing: body shape plus the API call, both injectable
// for tests. Scan data never leaves the app except into the repo the
// user names, and the token is never logged.
export function parseRepo(input) {
  const s = String(input || '').trim();
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(s);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function tokenLast4(token) {
  return String(token).slice(-4);
}

export function buildIssueBody({ siteName, seedUrl, health, groups, scanUrl, reportUrl }) {
  const lines = [
    'Link rot report for ' + siteName + ' (' + seedUrl + ')',
    '',
    'Health score: ' + (health ?? '?') + '. Full report: ' + reportUrl,
    '',
  ];
  for (const g of groups) {
    if (!g.findings.length) continue;
    lines.push('## ' + g.label + ' (' + g.findings.length + ')');
    lines.push('');
    for (const f of g.findings.slice(0, 10)) {
      lines.push('- ' + f.target_url + ' (' + f.kind + ', ' + f.reason + ', found on ' + (Array.isArray(f.sources) ? f.sources.length : 0) + ' pages)');
    }
    if (g.findings.length > 10) lines.push('- ...and ' + (g.findings.length - 10) + ' more in the full report.');
    lines.push('');
  }
  lines.push('Scan page: ' + scanUrl);
  return lines.join('\n');
}

export async function createGithubIssue({ fetchFn, token, owner, repo, title, body }) {
  const res = await fetchFn('https://api.github.com/repos/' + owner + '/' + repo + '/issues', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error('GitHub issue failed with status ' + res.status);
  const data = await res.json();
  return { number: data.number, url: data.html_url };
}
