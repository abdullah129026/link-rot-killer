# RESEARCH.md — Link Rot Killer

**Product:** Paste a sitemap.xml URL and get every broken outbound link, image,
YouTube embed, and iframe found; each broken item scored by SEO impact; one-click
client PDF report; auto-create a GitHub issue or PR to fix it.
**Audience:** content sites and blogs, freelance web devs doing client SEO work,
small agencies with mixed-stack clients.
**Researched:** 2026-10-21. All facts below are from the cited sources; anything
not verifiable is marked uncertain. Pricing figures come from secondary sources
(review sites, vendor blogs); re-verify on the vendors' own pages before quoting
them.

---

## 1. Problem space & demand

**Link rot is large and measurable, and every site with a few hundred outbound
links has dead ones right now.**

- Pew Research Center sampled about 1M pages from Common Crawl: 38% of pages
  that existed in 2013 were inaccessible by 2023, and at least one broken link
  appeared on 54% of Wikipedia reference sections, 23% of news pages, and 21%
  of US government pages.
  (https://www.fastcompany.com/91130447/w_750)
- Ahrefs studied link rot at scale and found at least 66.5% of links pointing
  to sampled websites had rotted since January 2013.
  (https://bitly.com/blog/what-is-link-rot/)
- A June 2026 re-scan of the top 10M domains found 14.2% genuinely dead (no
  DNS, no connection), after correcting for bots blocked by Cloudflare-style
  anti-bot walls.
  (https://dev.to/tonywangca/14-of-the-web-is-actually-dead-but-not-how-you-think-we-scanned-10m-domains-35g9)
- A 2023 study of the Million Dollar Homepage's external links: 27% loaded
  cleanly, 45% redirected, 28% returned errors.
  (https://en.wikipedia.org/wiki/Link_rot)

**How dead links hurt SEO:** Google says 404s are not a direct ranking signal
(John Mueller: "404s/410s are not a negative quality signal"). The damage is
indirect and real: wasted crawl budget (Googlebot spends fetches on dead ends
instead of discovering new content), lost link equity (backlinks to 404s pass
no authority), and bad UX signals (visitors bounce from 404s).
(https://www.eesel.ai/blog/broken-links-affect-seo, https://thatware.co/404-errors-crawl-budget-fix-steps/)
Internal broken links hurt more than outbound ones (they waste your crawl
budget and break your own link-equity flow, and you can fix them directly);
outbound broken links mainly erode trust and signal an unmaintained site.
(https://kalenux.com.tr/seo-guide/links/why-broken-links-hurt-seo)
Google Search Console only shows what Googlebot has already crawled and never
checks outbound links, so a dedicated crawler is the only way to find them
all before Google and users do.
(https://kalenux.com.tr/seo-guide/links/why-broken-links-hurt-seo)

**Broken YouTube embeds are a special blind spot.** The owner deletes or
privates the video (or disables embedding) and the page keeps rendering a
player frame that says "Video unavailable". Verified on 2026-10-21:
`https://www.youtube.com/embed/aaaaaaaaaaa` (an ID that cannot exist) returns
HTTP 200, exactly like a valid video, so any status-code-only checker marks
a dead embed as fine. The no-auth oEmbed endpoint
(`https://www.youtube.com/oembed?url=...`) returns 200 for a live video and
400 for a bogus ID, which is a usable validity signal without a YouTube API
key. Niche one-off tools exist (embedvid.io's free checker, old WordPress
plugins like "Youtube Not Found"); none of the mainstream crawlers advertise
embed-validity checking.
(https://www.embedvid.io/tools/youtube-embed-checker)

**Broken and lazy-loaded images:** a src that 404s or a CDN path move leaves
empty frames. Lazy-loaded images are a second blind spot: the URL often lives
in `data-src`, not `src`. Integrity (Mac) only added explicit lazy-image
detection in version 12.12.0 (April 2026), which implies the mainstream tools
were missing them before that.
(https://peacockmedia.software/mac/integrity/version_history.html)

**Demand read:** the failure mode is universal and growing, and the workaround
stack is either a CLI the client never sees, a desktop crawl that goes stale
the next day, or a $129+/mo suite bought for 110 other checks. Nothing in the
workarounds answers "which of these actually cost me traffic" with a
prioritized fix list a client can read. That is the wedge.

---

## 2. Competitive landscape (2024-2026)

### CLI / open source checkers

- **lychee (Rust, MIT/Apache, free).** Fast async CLI plus a GitHub Action,
  checks Markdown/HTML, handles redirects, per-host rate limits, CI workflows
  with cached results. Used by OpenTelemetry and other large docs sites in
  CI. (https://docs.rs/crate/lychee/latest,
  http://opentelemetry.io/site/build/link-checking/)
  Strengths: speed, free, first-class CI/GitHub integration. Weaknesses: it
  is a CLI, not a service; no scheduling on its own, no hosted dashboard, no
  client-facing reports, no SEO scoring or prioritization; status-code-based,
  so it misses dead YouTube embeds.
- **broken-link-checker (npm, free).** Node library and `blc` CLI, scans HTML
  for broken links and missing images, streams results. Maintenance looks
  stalled; users report the latest version silently failing mid-run. No
  scheduling, no reports, no UI.
  (https://lightrun.com/answers/stevenvachon-broken-link-checker-latest-blc-does-not-finish-properly)
- **W3C Link Checker (free).** The classic online checker, one document at a
  time with optional recursion, dated UI, no scheduling, no reports, no embed
  intelligence. Good for spot checks, not monitoring.
  (https://api.github.com/repos/w3c/link-checker)

### Cloud monitoring

- **Dr. Link Check.** Cloud broken-link checker with scheduled scans and email
  reports, soft-error detection, parked-domain checks, CSV/PDF export on paid
  tiers. Pricing (re-verify): free tier covers 1,500 links one-time only;
  paid roughly $10-13/mo (5 sites, biweekly+monthly), $39-49/mo (10 sites,
  weekly), $129-159/mo (15 sites, daily), figures differing across review
  sources. Weaknesses: reports are raw link tables with no SEO scoring, no
  client PDF narrative, no GitHub integration.
  (https://www.drlinkcheck.com/pricing)
- **SecurityBot ($5/mo, per its own blog).** Bundles broken-link monitoring
  with SSL/uptime/security-header checks: weekly + on-demand scans, 2,000
  pages, email alerts. Closest to a cheap monitoring product, but link
  checking is one feature among many, no SEO scoring, no client reports, no
  GitHub workflow. (https://securitybot.dev/blog/best-automated-link-checker-tools)
- **Smaller free web checkers** (Dead Link Checker, toolsvale, etc.): one-shot
  scans of 500-10,000 pages, no signup, no scheduling, no alerts.
  (https://www.onlinedecoded.com/top-free-broken-link-checker-sites/)

### SEO suites (broken links as one row among hundreds)

- **Ahrefs Site Audit.** 110+ technical issues, scheduled crawls, alerts,
  historical data. Pricing (re-verify): Starter $29/mo, Lite $129/mo, Standard
  $249/mo, Advanced $449/mo; free Webmaster Tools tier gives limited audit
  for verified sites. Weaknesses: broken links are one issue among 110+
  inside a suite priced for full SEO workflows; no per-broken-link SEO impact
  score, no embed-validity checking, no GitHub fix workflow, no one-click
  client PDF. (https://growhackscale.com/categories/seo-audit-tools)
- **Semrush Site Audit.** 140+ checks, health score, prioritized fix list,
  scheduled crawls, push-to-Trello/Zapier. Pricing (re-verify, May 2026
  restructure): SEO $139/mo, Starter $199/mo, Pro+ $299/mo, Advanced $549/mo;
  free account runs a 100-page audit. Weaknesses: suite pricing, no embed
  checks, no GitHub fix workflow, white-label client PDFs only via paid
  report add-ons. (https://onelittleweb.com/top-tools/semrush-review/)
- **Ubersuggest.** Budget suite, ~20 audit checks, ~$29/mo or lifetime plans.
  Shallow audit, no scheduling emphasis, no client-report or fix workflow.
  Beginner-grade. (https://entri.app/blog/ubersuggest-vs-semrush/)

### Desktop crawlers

- **Screaming Frog SEO Spider.** The technical SEO standard: 300+ checks,
  broken links, redirect chains, JS rendering, bulk CSV exports. Free to 500
  URLs; paid licence GBP 199/year per user. Weaknesses: desktop point-in-time
  tool; nothing is watched between crawls unless your machine stays on; no
  shared workspace, no prioritization, no client-facing artefact ("cleanest
  data here, least actionable artefact", 2026 review).
  (https://dailyemerald.com/191431/promotedposts/8-best-seo-analysis-tools-for-the-3-ways-audits-fail-2026/)
- **Sitebulb.** Closest competitor on explanation and reporting: 300+
  severity-scored "Hints" with written remediation rationales, crawl-map
  visualizations, audit-to-audit comparisons (before/after built in),
  white-label PDF reports. Pricing (re-verify): Desktop Lite ~$13.50-18/mo
  (no scheduling), Desktop Pro ~$35-45/mo (scheduling, custom PDFs), Cloud
  from ~$125-245/mo. Weaknesses: broken links are one category among
  hundreds, not the product; desktop scheduling needs your machine on; no
  embed-validity checking, no per-link impact score, no GitHub issue/PR
  creation; cloud pricing jumps hard.
  (https://www.maxiorel.com/sitebulb-review-seo-audit-tool-perspective-web-developer)
- **integrity / Integrity Plus / Scrutiny (Mac, PeacockMedia).** Free native
  Mac checker, actively maintained (v12.13.1, Oct 2026), finds lazy-loaded
  images via data-src, Plus ($20 one-time) generates XML sitemaps, Scrutiny
  adds scheduling and multi-site. Weaknesses: macOS-only, local-only, no team
  workspace, no client reports, no GitHub integration.
  (http://peacockmedia.software/mac/integrity/free.html)

### Platform-native / plugin

- **Google Search Console (free).** Authoritative for 404s Google found, but
  never checks outbound links, embeds, or images; no scheduling control, no
  reports, no fix workflow.
- **WordPress plugins.** The original Broken Link Checker is effectively dead
  (unmaintained, notorious for slowing shared hosting). AIOSEO rebuilt it as
  a free + paid cloud service with 300k+ installs: rescans every 3 days,
  email reports, in-dashboard fixes, and since 1.3.1 scans page builders,
  images, frames, and embedded players. Linkilo (paid) goes further with
  AI-suggested replacement URLs from your own published pages. Weaknesses:
  WordPress-only; the AIOSEO free plan does not cover external links; nothing
  here serves non-WP sites or GitHub-based fix workflows.
  (https://aioseo.com/newsroom/broken-link-checker-1-3-1/)

---

## 3. 2026 UX/UI practice for this category

### How audit tools present results

- The atomic unit everywhere is the same: broken thing + where it was found +
  status code + anchor/context + severity + how to fix. Screaming Frog's
  killer interaction is broken URL one click away from the Inlinks list of
  every page containing it; Ahrefs pairs each issue with affected URLs plus a
  "Why and how to fix" popup; Sitebulb's "Hint" is issue + explanation +
  affected pages.
  (https://www.mediasearchgroup.com/blog/how-to-find-fix-broken-links-on-your-website/,
  https://ahrefs.com/blog/seo-score/)
- Severity color convention is settled: red errors, yellow/orange warnings,
  blue notices. Do not invent a new scheme.
  (https://ahrefs.com/blog/seo-score/,
  https://es.Semrush.com/kb/1007-how-to-audit-a-website-and-find-quick-areas-for-improvement)
- Group findings by issue type with counts before showing any URL list. Ahrefs,
  Semrush, and Sitebulb all do this; nobody paginates 10,000 raw rows as the
  primary view. Bulk CSV export with full context (source page per finding)
  is expected, not a bonus.
- Health scores are 0-100 everywhere (Ahrefs, Semrush, PageSpeed). Ahrefs'
  formula is public and simple: error-free internal URLs over total crawled.
  Simplicity is a feature: users can reason about what moves the number. The
  score is a temperature check, never the product; practitioners warn against
  chasing 100.
  (https://help.ahrefs.com/en/articles/1424673-what-is-health-score-and-how-is-it-calculated-in-ahrefs-site-audit)
- SE Ranking labels each issue "+X pts" showing what the Health Score recovers
  when fixed, which turns triage into a ranked fix list; that is the closest
  existing analog of our per-link SEO impact score.
  (https://dailyemerald.com/192957/promotedposts/8-best-seo-analysis-tools-for-the-three-ways-audits-fail-2026/)

### The paste-URL-and-scan onboarding pattern

- One URL input, one button, no account required for the first scan, results
  on a shareable URL. securityheaders.com (grade in seconds, instantly
  shareable), pagespeed.web.dev (paste, analyze, four 0-100 scores with
  per-issue impact estimates), webpagetest.org (status page with queue
  position, expectations set before the scan).
- Scan-progress conventions that work: name the state plainly (queued,
  crawling, analyzing); live counters beat spinners (pages crawled, links
  checked, issues found so far); stream partial results into the issue list
  while the crawl continues; keep the result on a stable shareable URL from
  the moment the scan starts, so the progress page becomes the results page.

### Client-facing report design

- 2026 consensus structure (agency-community polling): cover page with client
  branding, one-page executive summary written for a non-technical reader
  (3-4 lines: wins, issues, next focus), body with charts/sparklines and
  severity badges, full URL table in an appendix. Treat it as a decision
  memo with evidence, not a dashboard export wearing agency colors.
  (https://designloud.com/white-label-seo-reporting-guide/,
  https://seojuice.com/blog/white-label-seo-reports/)
- Before/after framing is a named feature in the category: SE Ranking's
  New/Fixed audit comparison, Sitebulb's Audit Comparisons, Semrush's
  per-check trend. A client PDF that shows "12 fixed since last scan, 3 new"
  is the standard proof-of-work. (https://dailyemerald.com/192957/promotedposts/8-best-seo-analysis-tools-for-the-three-ways-audits-fail-2026/)
- Delivery conventions: scheduled PDF reports and guest links (SE Ranking),
  automated email reports and white-label PDFs (Semrush), PDF summary
  reports (Sitebulb).

### High-end visual references

- **Cloudflare dashboard:** light theme, one sparing orange accent, grouped
  sidebar, slim topbar with search, dense tables with small status pills,
  severity through pills and small dots rather than colored panels. The
  verified reference for the project 1 dashboard.
- **Sentry:** the Issues stream is the model for triaging many findings:
  similar events fingerprinted and merged, explicit issue states (unresolved,
  resolved, ignored), important facts pinned above the fold, structured
  query search for power users. Take from it: group-then-drill triage,
  explicit states, important facts first.
  (https://develop.sentry.dev/backend/issue-platform/)
- **Linear:** dark-first, one muted accent, compact 32-36px rows, Inter at
  13-14px, keyboard-first with a Cmd+K palette, opinionated triage workflow
  rather than configurable. Take from it: accent discipline, compact
  density, the triage queue as the default workflow, keyboard paths for
  repeated actions (approve fix, ignore, open in GitHub).
  (https://saas.wbakt.com/linear-project-management-issue-tracking-for-software-teams/)

---

## 4. Differentiators (the wedge)

No tool today does the full chain: paste a sitemap.xml URL, get scheduled
re-checks of every outbound link, image, YouTube embed, and iframe, get each
broken item scored by SEO impact, get a one-click client PDF, and get a GitHub
issue or PR that fixes it.

Where each incumbent stops: lychee is closest on the GitHub side (Action, can
file issues) but is a CLI with no scheduling, no dashboard, no SEO scoring,
no client PDF, and it is blind to dead YouTube embeds. Screaming Frog has the
deepest crawl data and no per-crawl cost, but it is a desktop point-in-time
tool with no monitoring between runs, no prioritization, and no client
artefact. Sitebulb is closest on prioritization and white-label PDFs, but
scheduling lives on desktop or Cloud at $125+/mo, and it stops at the report:
no fix workflow, no embed checks, no per-link impact score. Dr. Link Check
has scheduling and email reports at $10-15/mo but reports raw link tables with
no SEO scoring, no client PDF narrative, and no GitHub integration. Ahrefs and
Semrush score site health and schedule crawls, but broken links are one row
among 100-140 issues inside $129-139/mo suites; no embed checks, no
per-broken-link impact score, no fix PRs. WordPress plugins fix inside WP
only; every non-WP site, static site, and headless build is unserved. Google
Search Console never checks outbound links at all.

Two verified technical gaps to build on:

1. **YouTube embed validity.** Status-code checkers report dead embeds as
   healthy (verified: bogus embed IDs return HTTP 200). The no-auth oEmbed
   endpoint distinguishes live from dead (200 vs 400, verified 2026-10-21).
   None of the mainstream crawlers use it.
2. **Lazy-loaded images.** URLs in `data-src` are missed by naive `src`
   scraping; Integrity only added this in April 2026, so it is a genuinely
   uncommon feature.

---

## 5. Risks

- **Crawler politeness and blocking.** A cloud checker that hits thousands of
  targets will get rate-limited or blocked (Cloudflare anti-bot walls were
  explicitly corrected for in the June 2026 10M-domain study). The June 2026
  study also found the bots that get blocked inflate apparent death rates, so
  false positives are a design risk from day one: naive HEAD/GET checks will
  report "dead" for sites that merely block bots. Mitigation: retry policy,
  user-agent transparency, per-host rate limits (lychee already does this),
  and a "could not verify" state distinct from "broken".
- **False 404s from JS-rendered pages.** Many embeds and images are injected
  by client-side JS; an HTML-only crawler misses them entirely (false
  negatives). Headless rendering is the fix but costs far more compute, so the
  MVP should scope to server-rendered HTML and say so plainly.
- **SEO impact scoring is a judgment call, not a measurement.** Ahrefs and
  Semrush derive scores from proprietary backlink/traffic data we will not
  have. Our per-link impact score must be honest about its inputs (status
  code, internal vs outbound, page depth, inlink count on the scanned site)
  rather than claiming to measure traffic loss.
- **Sitemap entry point assumes the sitemap is complete.** Many sites have
  partial or missing sitemaps; crawl-from-homepage discovery must be the
  fallback so "paste sitemap" is not a dead end.
- **PDF generation and GitHub write paths are trust boundaries.** The PDF
  carries the client's brand (white-label inputs must be sanitized into the
  generated file); the GitHub issue/PR path needs a scoped token and must
  never exfiltrate scan data beyond the repo the user connected.
- **Pricing uncertainty.** Every price above comes from secondary sources.
  Re-verify from vendor pages before any competitive claim in marketing or
  the demo script.

### Uncertain claims (verify during build, do not state as fact)

- Whether Screaming Frog or Sitebulb flag dead YouTube embeds in any way.
  Their docs do not advertise it; assume they do not, but confirm with a
  test page during build.
- Whether Dr. Link Check's crawler follows sitemap.xml as seed input. Its
  docs describe URL/paste input; sitemap-seeded crawling is our stated entry
  point either way.
- The Ahrefs "66.5% of links rotted" figure is widely cited via secondary
  sources; the original study page was not opened in this research. Treat
  the number as directionally right, precisely uncertain.
- Exact competitor pricing above. Re-verify from vendor pages before quoting.
