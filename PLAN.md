# PLAN.md — Link Rot Killer

**Tagline:** Paste a sitemap, get every dead link, image, and embed scored by
SEO impact, with a client-ready PDF and a GitHub issue to fix them.
**Researched:** 2026-10-21 (RESEARCH.md). **Planned:** 2026-10-22.
**Reviewed:** 2026-10-22 (architecture + UI/UX reviewers; see REVIEW.md).
**Deadline:** 2026-10-27. **Repo:** abdullah129026/link-rot-killer.

## 1. Problem

Content sites accumulate dead outbound links, broken images, and dead YouTube
embeds that hurt SEO indirectly (wasted crawl budget, lost link equity, bad UX
signals) and erode reader trust. The existing options are a CLI the client
never sees (lychee), a desktop crawl that goes stale the next day (Screaming
Frog), or a $129+/mo suite bought for 110 other checks (Ahrefs, Semrush).
Google Search Console never checks outbound links at all. Nothing answers
"which of these dead links actually cost me traffic" with a prioritized fix
list a client can read, plus the report and the fix workflow.

Two verified technical gaps to build on (RESEARCH.md section 4): dead
YouTube embeds return HTTP 200, so status-code checkers mark them healthy;
the no-auth oEmbed endpoint distinguishes live from dead (200 vs 400,
verified 2026-10-21). Lazy-loaded images hide their URLs in `data-src`,
which most checkers never read.

## 2. MVP scope (what ships Oct 27)

**Core: sitemap in, scored findings out, client PDF, GitHub issue.**

In scope:
1. Paste a sitemap.xml URL (or a homepage URL as fallback) and start a scan.
   No account needed for the first scan. The scan lives on a stable,
   shareable URL from the moment it starts; the progress page becomes the
   results page. Live counters read "X broken, Y couldn't verify" as
   separate numbers, never a bare spinner. Findings stream in as the crawl
   continues. Demo scans from the landing carry a persistent "demo scan"
   banner so a shared demo URL is never mistaken for a real client report.
   The landing keeps a localStorage list of the visitor's recent scans
   (ids, site names, dates) so closing the tab does not lose them.
2. Crawler checks every link, image (src and data-src/data-srcset),
   YouTube embed (via the oEmbed validity check), and iframe found on
   crawled pages. Sitemap index files followed (max 5); plain-text
   sitemaps (one URL per line) accepted. Homepage fallback: breadth-first
   link discovery from the homepage when no sitemap exists, stated on the
   scan page when it happens. Server-rendered HTML only; JS-injected
   content is out of scope and the UI says so, including a methodology
   line in the PDF.
3. Findings grouped by issue type with counts before any URL list. Each
   finding: target URL, kind, status code or failure reason, anchor text
   or image alt captured at extraction time, every source page on the
   scanned site that contains it (the inlinks list), severity pill, SEO
   impact score. Within a group: paginated at 50 per page, sorted by
   impact score descending. Severity colors: red error, yellow warning,
   blue notice (the settled convention, RESEARCH.md section 3).
   Unverifiable findings are capped at blue notice regardless of score
   and sit in their own collapsible group, so bot-walled targets never
   drown real findings.
4. Health score 0-100 with a public formula, shown on the scan page and the
   PDF. Per-finding SEO impact score 0-100 with a public formula,
   documented in the app (see 3.5). Both formulas state their inputs
   honestly: status, internal vs outbound, inlink count on the scanned
   site, page depth. Unverifiable findings are excluded from the health
   score entirely (weight 0): a blocked bot must not tank the score.
   No claim to measure traffic loss.
5. Explicit finding states: open, fixed, ignored (Sentry-style triage),
   per row and per group (bulk "mark all in this group ignored/fixed").
   Findings carry a cross-scan fingerprint (site, normalized URL, kind,
   reason). A re-scan seeds triage state from the previous scan's
   fingerprint, so ignored stays ignored; a finding that reappears after
   being marked fixed regresses to open. Before/after ("new since last
   scan", "fixed since last scan") is computed from presence/absence of
   fingerprints, independent of manual triage.
6. One-click client PDF per scan: cover (client name and "prepared by"
   from the site record, site, date, health score, one plain-language
   sentence explaining the score), one-page executive summary written for
   a non-technical reader (what was checked: N pages, M targets; one
   health sentence; the top 3 fixes in plain words; what changed since
   the last scan), severity-distribution bar and health-trend sparkline,
   findings grouped by issue type with severity badges and a
   plain-language "what to do" line per issue type, before/after vs the
   previous scan ("12 fixed since last scan, 3 new"), full URL table with
   inlink detail in the appendix only. On client-facing surfaces the raw
   impact number is replaced by the severity badge plus a "fix first"
   priority rank; the numeric score stays on the owner's scan page.
7. GitHub issue creation: the user pastes a fine-grained PAT (issues:write
   on the target repo) once in settings, stored encrypted (pgcrypto, key
   from env, decrypted only in the issue route). Each scan gets a "Create
   GitHub issue" button that files a markdown issue with the summary, top
   findings by impact, and a link to the full report. Scan data never
   leaves the app except into the repo the user names.
8. Scheduled re-scans (daily or weekly per site) for signed-in users. The
   cron tick spends its full budget across due scans, oldest first; the
   dashboard shows last-scan status per site with a visible failed badge.
   Unattended completion time depends on the verified cron interval (see
   3.3); the UI states it honestly rather than implying instant results.
9. Signed-in users get a sites dashboard: sites, schedules, scan history,
   health trend per site. Auth is Supabase magic link, the same pattern
   as project 2. Anonymous scan pages show "Sign in to save this scan and
   schedule re-scans"; on sign-in, every scan whose claim token matches
   the cookie attaches to the user, redirecting back to the scan.
10. CSV export of findings (one row per finding with full context:
    target URL, kind, reason, severity, impact, source pages). RESEARCH
    calls this expected, not a bonus; it is one route over data already
    shaped for the PDF appendix.
11. Docs: the public scoring formulas page (with a worked example and the
    "triage aid, not a grade" caveat), 5-minute quickstart README.

Out of scope (named, not forgotten):
- Headless-browser rendering for JS-injected embeds and images. The upgrade
  path is a render step for pages whose HTML yields suspiciously few
  targets.
- GitHub PR creation. Filing an issue is the v1 fix workflow; opening a PR
  that edits the site's source only makes sense for GitHub-hosted sites
  (docs repos, GitHub Pages) and is the first post-MVP milestone.
- Email alerts and white-label PDF themes (logo upload, custom colors). The
  v1 PDF carries the client name and prepared-by as text; full white-label
  is post-MVP.
- Per-issue "why and how to fix" popups beyond the one static remediation
  line per issue type.

## 3. Architecture

### 3.1 Stack

Next.js 16 (Active LTS) + Supabase (Postgres, Auth, hosted, pgcrypto) on
the free tier. Deploy: Vercel only. The crawler is a Node module inside
the Next.js app, not a separate service.

Why no Python worker and no Render (the PROGRAM.md brief suggested both):
a Render free web service sleeps after idle, so an on-demand scan would
open with a 50-second cold start, and scheduled scans would need a second
deploy target to babysit. The crawl is chunked instead: a Postgres work
queue holds every target, and each runner tick processes one chunk inside
the serverless time budget. One codebase, one deploy, no cold starts.
(ponytail: the ceiling is throughput. Chunked serverless crawling tops out
around a few thousand targets per scan at the MVP caps. The upgrade path
is a dedicated always-on worker when scans need to be 10x bigger. Abdullah
owns Next.js and Node best; a second Python service he cannot demo as
fluently is the wrong trade for week one.)

### 3.2 Data model

- `sites`: id (uuid), owner_user_id (uuid, nullable for anonymous),
  name, seed_url, client_name (text, for the PDF cover),
  prepared_by (text, agency/freelancer name for the PDF cover),
  schedule (none/daily/weekly, default none),
  max_pages (default 200), created_at.
- `scans`: id (uuid), site_id (nullable; anonymous scans attach on
  sign-in), status (queued/crawling/done/failed), claim_token (random,
  for anonymous ownership), ip (for rate limiting, anonymous only),
  stats (jsonb: pages_crawled, targets_checked, broken_found,
  unverifiable_found), health_score (nullable until done),
  last_tick_at (timestamptz, for stalled detection),
  started_at, finished_at.
- `scan_targets`: id, scan_id, url (as found, for display),
  normalized_url (unique per scan; see normalization below),
  kind (page/link/image/embed/iframe), depth, host,
  status (pending/in_progress/done), claimed_at (timestamptz, the lease),
  not_before (timestamptz, for 429 requeue), status_code (nullable),
  final_url (nullable), error (nullable:
  timeout/dns/blocked/unverifiable), checked_at.
- `scan_target_sources`: target_id, source_target_id, context (text:
  anchor text or img alt, nullable). Unique (target_id,
  source_target_id). Populated at extraction time with on-conflict
  do-nothing, so the second page containing the same URL records itself.
- `findings`: id, scan_id, fingerprint (text: site_id + normalized_url +
  kind + reason; unique per scan), target_url, kind, reason (enum:
  http_4xx, http_5xx, unreachable, dead_embed, unverifiable,
  redirect_chain), severity (error/warning/notice), impact_score
  (0-100), state (open/fixed/ignored, default open), sources (jsonb
  array of {url, context}), checked_at. Written as checks complete so
  results stream; sources built from the edge table at check time.
- `github_tokens`: user_id (unique), token (bytea, pgp_sym_encrypt with
  a key from env), created_at. One token per user in v1. Display masked
  (last 4 chars only, stored alongside or recomputed at write time).
- `host_throttle`: host (pk), last_hit_at. Politeness ledger shared
  across ticks.

URL normalization (one small function, tested): lowercase host, strip
default ports and fragments, drop known tracking params (utm_*,
fbclid, gclid, ...), collapse trailing slash except root. Without this,
`https://x.com/p`, `https://x.com/p/`, and `https://x.com/p?utm_source=a`
become three targets and triple-count one finding.

Required indexes (named in the migration): scan_targets(scan_id,
status), unique(scan_id, normalized_url), scans(ip, started_at),
findings(scan_id, fingerprint), scan_target_sources(target_id).

Migrations carry explicit minimal GRANTs to service_role only (the
standing Supabase rule); RLS enabled, no policies (default deny); every
API route checks ownership or the claim token before touching a row.

### 3.3 The crawl loop

A scan is a breadth-first walk over `scan_targets`:

1. Seed: fetch the seed URL (2MB body cap, 10s timeout). If it parses as
   a sitemap, extract `<loc>` entries with a regex (sitemaps are
   machine-written XML; a full parser is overkill), follow sitemapindex
   recursion (max 5 index files, cap 10k locs total). Accept `.txt`
   sitemaps (one URL per line). If the seed is not a sitemap, or the
   sitemap yields nothing, fall back to homepage link discovery; the scan
   page shows notice (a) "sitemap not usable, discovering from homepage".
   Caps: 200 pages, 3000 targets per scan (named ceilings); hitting one
   shows notice (b) "stopped at the N cap, rest unchecked".
2. Page targets (same registrable domain, depth < 6): GET with a 10s
   timeout and a 2MB body cap. Extract links with cheerio: `a[href]`,
   `img[src]`, `img[data-src]`, `img[data-srcset]`, `iframe[src]`,
   `embed[src]`, `video source[src]`; capture anchor text or img alt as
   context. YouTube IDs pulled from youtube.com/embed/ID,
   youtube-nocookie.com/embed/ID, and youtu.be/ID. Skip mailto:, tel:,
   javascript:, fragments, data: URLs. Relative URLs resolved against the
   page URL, then normalized. Same-domain links become page targets;
   everything else becomes a check target; every (target, source page)
   pair is recorded in the edge table. A page target that itself 404s,
   5xxs, or DNS-fails writes a broken-internal-link finding (base 40,
   the highest) with sources from the edge table.
   (ponytail: one HTML-parsing dependency, cheerio, because extraction
   quality is the product and regexes miss real-world markup. The ceiling
   is JS-rendered content, which stays out of scope per section 2.)
3. Check targets: HEAD with an 8s timeout; on 405/501 retry once with
   GET. Transient network failures (timeout, DNS, connection refused)
   get one retry with backoff before an `unreachable` finding is
   written; one timeout must not cry wolf. Follow redirects up to 5 hops
   with a visited-URL set (loops break the walk); precedence: a terminal
   4xx/5xx writes an http_4xx/http_5xx finding, otherwise 3+ hops or a
   cross-host hop writes a redirect_chain notice. 401/403/429 without a
   usable retry become `unverifiable` (blue notice, never red). On 429
   with a Retry-After header, requeue with not_before instead (cap 15
   min); only mark unverifiable when the retry also fails or no header
   is given.
4. YouTube embeds skip HTTP status entirely (bogus IDs return 200):
   `https://www.youtube.com/oembed?url=<watch-url>` returning 200 means
   live, 400/404 means dead_embed, anything else means unverifiable.
5. Politeness: minimum 750ms between requests to the same host. Within a
   tick, claimed targets are grouped by host and each host's targets run
   serially with the spacing enforced in-process; the host_throttle table
   makes cross-tick spacing best-effort. One transparent user agent
   (`LinkRotKiller/1.0 (+https://<app>/bot)`); robots.txt fetched once
   per host and honored for page crawling (prefix match on Disallow, a
   few lines, worth doing).
6. SSRF guard (non-negotiable): after DNS resolution, refuse 10/8,
   172.16/12, 192.168/16, 127/8, 169.254/16, and ::1; re-resolve on
   every redirect hop before fetching. A few lines, handwritten, no new
   dependency.

Tick mechanics: each tick claims up to 50 pending targets with SELECT ...
FOR UPDATE SKIP LOCKED (safe under overlapping ticks), processes them
until 30 seconds have elapsed, then writes back scan stats with atomic
single-statement counter updates (no read-modify-write). Claimed targets
carry claimed_at; the cron sweep reclaims `in_progress` rows with
claimed_at older than 10 minutes back to pending. A scan flips to done
only when there are no pending targets AND no unexpired in_progress
targets; the health score is computed then. A scan with no tick progress
for 24h flips to failed. Routes set `export const maxDuration = 60`
explicitly; the 30s processing budget leaves headroom for cold starts.

A tick is driven two ways: the progress page POSTs /api/scans/[id]/tick
every few seconds while the scan is active (a watched scan finishes in
real time), and a Vercel cron route /api/cron/tick (bearer-gated on
CRON_SECRET, the project-2 pattern) sweeps active scans and starts due
scheduled scans, oldest first. The build slice verifies the tightest
free-tier cron interval and `maxDuration` behavior; unattended scheduled
scans are sized and messaged around what is verified, not assumed.

### 3.4 API routes (Next.js)

- `POST /api/scans` (seed_url; anonymous allowed, 3 scans per IP per day
  from the platform-provided client IP, 20/day signed in; sets the
  claim_token cookie, SameSite=Strict)
- `GET /api/scans/[id]` (public by unguessable id: status, stats,
  findings grouped by issue type, before/after vs previous scan)
- `POST /api/scans/[id]/tick` (claim token or owner only; one chunk)
- `POST /api/scans/[id]/triage` (claim token or owner only; per-row and
  per-group bulk actions; Origin/Host checked)
- `GET /api/scans/[id]/findings.csv` (public by unguessable id, same
  visibility as the scan page)
- `GET /api/scans/[id]/report.pdf` (public by unguessable id)
- `POST /api/sites` `GET /api/sites` (signed in; create/list, set
  schedule, client_name, prepared_by)
- `GET /api/cron/tick` (Vercel cron; bearer CRON_SECRET)
- `GET/POST /api/settings/github` (store token encrypted, masked read)
- `POST /api/scans/[id]/github-issue` (claim token or owner; owner/repo
  input; files the issue)

### 3.5 Scoring formulas (public, shown in the app)

Per-finding impact score (0-100):
- base by issue type: broken internal link 40; dead image, iframe, or
  non-YouTube embed on a crawled page 35; dead YouTube embed 30; broken
  outbound link 20; redirect chain 10; could not verify 5.
- inlink multiplier: 1 + 0.5 x (source pages - 1), capped at 3. A dead
  link on five of your pages costs more than on one.
- depth factor: 1.0 at depth 0-1, 0.8 at depth 2, 0.6 at depth 3+, where
  depth is the shallowest source page's depth.
- score = min(100, round(base x inlink_mult x depth_factor)).
- severity from score: >= 40 error (red), 15-39 warning (yellow),
  < 15 notice (blue). Unverifiable findings are always blue notice,
  regardless of the multiplier.

Health score (0-100): 100 - sum(impact_score / 10) over open findings
excluding unverifiable ones, floored at 0, rounded. One broken internal
link (impact 40) costs 4 points; fixing it recovers those points, and the
scan page shows the recoverable points per issue type ("fixing these
would raise the score from 72 to 84"). The formulas page states the
inputs plainly: status class, internal vs outbound, inlink count, page
depth. No backlink or traffic data is used, and the page says so. One
line on the page: the score is a triage aid, not a grade to maximize.

### 3.6 PDF report

Server-generated with pdf-lib (one dependency; hand-rolling PDF tables is
not a few-lines job): cover (client name, prepared by, site, date,
health score, one plain-language sentence: "The score starts at 100.
Each issue subtracts points based on how much it hurts: a broken link
on your homepage costs more than one on a deep page."), executive
summary (what was checked: N pages, M targets; one health sentence; the
top 3 fixes in plain words; what changed since the last scan),
severity-distribution bar and health-trend sparkline (drawn rects),
findings grouped by issue type with severity badges and one static
"what to do" remediation line per reason, before/after vs the previous
scan ("12 fixed since last scan, 3 new"), appendix with the full URL
table including inlink detail. Body rows carry the severity badge and
"fix first" rank, not the raw impact number.

Trust boundary specifics: strip control characters from every
white-label field, cap field lengths (client name 80 chars), sanitize
text to WinAnsi-safe (pdf-lib's standard fonts; replace the rest),
render URLs as literal text, never interpreted markup.

### 3.7 Security and honesty notes

- The SSRF guard (3.3.6) runs before every fetch, including redirect
  hops. The crawler only ever touches public IP space.
- The GitHub token is encrypted with pgcrypto (pgp_sym_encrypt, key from
  env) and decrypted only inside the issue-creation route; the settings
  page shows the last 4 chars. A security note in the app states this
  plainly and names the upgrade path (GitHub App OAuth). The
  issue-creation route sends findings only to the owner/repo the user
  types, never anywhere else.
- Anonymous rate limiting uses the platform-provided client IP
  (Vercel's forwarded-for), not raw X-Forwarded-For, which is
  client-spoofable. IPv6 /64 sharing and NAT imprecision are accepted
  and documented.
- Cookie-authed mutations (tick, triage) check Origin/Host; the claim
  cookie is SameSite=Strict. /tick and /triage require the claim token
  or an owner session; reads stay public by unguessable id, stated
  explicitly.
- Anonymous scans are rate-limited (3 per IP per day) and capped (200
  pages, 3000 targets) so the free tier cannot be burned by drive-bys.
  The blocked state tells the user what happened, when the quota
  resets, and that signing in raises it.
- Crawler politeness (750ms per host, robots.txt, transparent UA) is a
  launch requirement, not polish: an impolite checker gets the user's
  site blocked and poisons its own results.
- The unverifiable state exists so anti-bot walls never inflate the
  broken count, and unverifiable findings are excluded from the health
  score. The formulas page states what the scores do not measure.

## 4. UX/UI direction (from research; visuals start from zero in build)

Design work starts from zero in the build phase using the current design
skills (the Oct 20 reset). This section locks behavior and information
architecture only, not the visual system.

- Landing: one URL input, one button, no account for the first scan. An
  example link runs a demo scan, badged as such. The pattern is
  securityheaders.com and pagespeed.web.dev: grade in seconds, shareable
  result. Recent scans (localStorage) listed under the form.
- Scan page /s/[id]: the URL is stable from scan start. Two modes: the
  owner view (claim token cookie or owner session) shows triage actions,
  bulk actions, the GitHub issue button, the sign-in-to-save CTA, and
  live tick state; the client view (everyone else) is read-only:
  findings, scores, before/after, download PDF, no workbench controls.
  Progress names itself plainly (queued, crawling, done) with the split
  counters. Findings stream into issue-type groups with counts; clicking
  a group drills to the paginated URL list sorted by impact; each row
  expands to anchor text/alt, the inlinks list, status, severity,
  impact. Triage actions are full-width tap rows on small screens.
  Four named notices: (a) sitemap fallback, (b) cap reached, (c) scan
  failed with error and a retry button, (d) persistent dismissible note
  that JS-rendered content is not checked.
- Zero-broken state: "No broken links found." followed by the
  unverifiable count when nonzero ("400 targets couldn't be checked
  because those sites block automated checks."), never a bare 100.
- Before/after is a first-class block on the scan page when a previous
  scan exists: new since last scan, fixed since last scan, with the
  recoverable-points framing.
- Sites dashboard (signed in): sites with schedules, last-scan status
  per site with a visible failed badge, scan history per site, health
  trend sparkline per site.
- Report: /s/[id]/report renders the same content as the PDF as a page
  with print CSS (the mobile-primary surface for shared links); the
  Download PDF button sits on both the scan page and the report page,
  disabling with "Preparing PDF..." while generating. The report page
  follows the same owner/client mode split as the scan page.
- Settings: GitHub token field with the honest-limits note. Client name
  and prepared-by live on each site, not in global settings.
- Formulas page: the exact impact and health formulas with a worked
  example, because the scores are only trustworthy if the user can redo
  the math.
- Empty states: a site with no scans offers the paste box inline; a scan
  with zero issues states it plainly per the zero-broken rule above.
- Responsive floor: the findings tables scroll horizontally under 768px;
  desktop is the primary surface, the report page is the mobile-primary
  one.

## 5. Milestones & dates

Oct 20-21: research. Done 2026-10-21 (commit 5a0fca2).
Oct 22: plan + review. This run (see REVIEW.md).

Oct 23-24: scaffold + schema + crawl engine. Next.js 16 scaffold, Supabase
migrations (sites, scans, scan_targets, scan_target_sources, findings,
github_tokens, host_throttle) with explicit grants and the named
indexes, URL normalization, the fetcher with politeness (throttle
table, robots.txt, UA, timeouts, body caps) and the SSRF guard, cheerio
extraction (links, images incl. data-src/srcset, iframes, embeds,
YouTube IDs, anchor text/alt context), sitemap parsing (index
recursion, .txt, caps) with homepage fallback, the status checker
(HEAD then GET, transient retry with backoff, redirect precedence and
loop safety, YouTube oEmbed, 429 requeue), the chunked tick runner
(SKIP LOCKED claiming, claimed_at leases with cron reclamation,
atomic stats, 30s budget, maxDuration=60). Verify during this slice:
the tightest free-tier cron interval and maxDuration behavior on the
target plan. 14-18 tests (extraction fixtures incl. data-src and
YouTube embeds, anchor/alt capture, normalization cases, oEmbed
live/dead against the real endpoint, redirect-chain precedence and
loops, 403 -> unverifiable not broken, transient retry, throttle
spacing, SSRF refusals incl. redirect-hop re-resolution, queue
claim/dedupe/lease-reclamation).

Oct 24-25: scan API + results UI. Scan creation (anonymous with claim
token + IP rate limit and its blocked-state UX, signed-in attach), the
tick endpoint (claim/owner gated), owner vs client page modes, the live
progress page with split counters and streamed findings, grouped
findings with inlink drill-down, per-row and bulk triage with the
fingerprint state machine, health and impact scoring with the public
formulas page, before/after vs previous scan, CSV export. 10-12 tests
(scoring math incl. the worked example and the unverifiable exclusion,
severity capping, grouping/pagination/sort, triage transitions incl.
reappear-regresses-to-open and ignored-carryover, anonymous rate
limit, claim-token ownership, owner/client mode gating).

Oct 25-26: PDF + GitHub + scheduling. pdf-lib report generation (cover,
exec summary, distribution bar, trend sparkline, grouped findings with
remediation lines, before/after, appendix), the HTML report page with
print CSS, GitHub token settings (encrypted storage, masked display)
and issue creation, Vercel cron route (CRON_SECRET bearer) for chunk
sweeping and scheduled scans sized to the verified interval, sites
dashboard with schedules and failed-scan badges, README quickstart.
6-8 tests (PDF generates with the expected sections, issue body
markdown shape with a mocked fetch, token encrypt/decrypt round-trip,
scheduled scan creation, cron bearer gate).

Oct 26-27: deploy + verify. Vercel deploy, Supabase project + migrations,
the standing deploy checklist from the nextjs-deploy-verification skill:
Supabase site URL and redirect URLs audited before the first sign-in,
signed-in route sweep after deploy (the build alone misses dynamic-page
bugs; project 2 proved this), server logs read before any third theory.
Demo: a real scan of a sitemap, PDF download, GitHub issue filed on a
demo repo. Deploy URL verified live.

If a milestone finishes early, pull the next one forward (the standing
rule). Flex order if time slips: (1) GitHub issue creation, (2)
scheduled re-scans plus the sites dashboard (a manual re-scan button
keeps before/after alive), (3) automatic before/after. The PDF stays
protected: it is half the wedge.

## 6. Deploy targets (free tiers)

- App + crawler: Vercel (Next.js 16, one deploy).
- Database + Auth: Supabase free tier, one new project separate from
  projects 1 and 2. pgcrypto enabled for the token column.
- Cron: Vercel cron hitting /api/cron/tick; the interval actually
  available on the free tier is verified during the Oct 23-24 slice and
  scheduled scans are sized around it.
- Needs from Abdullah: the Supabase project creation clicks, running the
  migrations in the SQL editor, the env vars on Vercel (including
  CRON_SECRET and the token-encryption key), the Supabase site URL +
  redirect URL audit, exactly as the last three projects. Plus a
  fine-grained GitHub PAT (issues:write) for the demo issue, or the demo
  files the issue with a test repo and a throwaway token.

## 7. Risks & mitigations

- False positives from anti-bot walls. Mitigation: the unverifiable
  state, the HEAD-then-GET retry, the transient-failure retry with
  backoff, 429 requeue, never marking 401/403/429 as broken, and
  excluding unverifiable from the health score. A scan that cries wolf
  on Cloudflare-fronted sites is worse than no scan.
- SSRF via malicious seed URLs. Mitigation: the DNS-resolution guard on
  every fetch and every redirect hop (3.3.6). Non-negotiable for the
  portfolio security story.
- Crawl cost abuse on the free tier. Mitigation: anonymous rate limits
  on the platform IP, per-scan caps, per-tick time budgets, named in the
  UI as product limits.
- Unattended scheduled scans vs the cron interval. Mitigation: the
  interval is verified in the first build slice and scheduled scans are
  sized and messaged around it; the flex order protects the demoable
  core first.
- Impact scoring is judgment, not measurement. Mitigation: the formulas
  are public, the inputs are named, what is not measured is stated, and
  the score is framed as a triage aid. Reviewers attacked the weights;
  they remain starting values, not science.
- Sitemap incompleteness. Mitigation: the homepage-discovery fallback is
  a specified second seed path with its own on-page notice, tested.
- Cheerio and pdf-lib are the only two new dependencies. Both are
  justified in 3.3/3.6; everything else is stdlib or already installed.
  pgcrypto is a Postgres extension, not an npm dependency.
- Schedule risk: four build slices in five days is tight. Mitigation:
  the slices are ordered so Oct 23-25 delivers a demoable scanner even
  if the later pieces slip; the flex order in section 5 names what gives
  first.

## 8. Definition of done (Oct 27)

Vercel deploy URL responds with a working product: paste a sitemap URL
with no account, watch the live counters, get grouped findings with
anchor context, inlink lists, and impact scores, see the health score
and the public formulas, download the client PDF, export the CSV, sign
in and schedule a weekly re-scan, file a GitHub issue on a demo repo,
and see before/after on the second run. A client opening the shared
report link sees a read-only view with no owner controls. Tests green,
`next build` clean, migrations carry explicit grants, no secrets in any
log, the crawler identifies itself, honors robots.txt, and refuses
private IP space. Demo scan runs against a real sitemap, not fixtures.
