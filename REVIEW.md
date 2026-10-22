# REVIEW.md — plan review, 2026-10-22

Two reviewer subagents critiqued the draft PLAN.md against RESEARCH.md:
one architecture reviewer, one UI/UX reviewer. Every blocker was fixed
in the plan before build. The should-fix items below were folded in
unless noted.

## Blockers (all fixed)

1. UI/UX: no owner-vs-viewer mode on shared scan/report pages. Fixed:
   the scan page and report page now specify an owner view (triage, bulk
   actions, GitHub issue button, tick state, sign-in CTA) gated by claim
   token or owner session, and a read-only client view (findings, scores,
   before/after, PDF download).
2. UI/UX: triage state machine across re-scans unspecified. Fixed:
   findings carry a fingerprint (site, normalized URL, kind, reason);
   re-scans seed triage state from the previous fingerprint (ignored
   stays ignored, reappearing fixed regresses to open); before/after is
   computed from fingerprint presence/absence, independent of manual
   triage.
3. UI/UX: unverifiable findings subtracted from the health score,
   contradicting the plan's own honesty rule. Fixed: unverifiable
   findings are excluded from the health score (weight 0) and capped at
   blue notice regardless of the inlink multiplier.
4. Architecture: no lease on claimed targets; a dead tick stalls the scan
   forever. Fixed: scan_targets.claimed_at, cron reclamation after 10
   minutes, done-transition requires no pending AND no unexpired
   in_progress, stalled scans fail after 24h without tick progress.
5. Architecture: the inlinks edge had nowhere to be captured (singular
   source_target_id vs many source pages). Fixed: new
   scan_target_sources join table (target, source, anchor/alt context),
   populated at extraction with on-conflict do-nothing.
6. Architecture: no SSRF guard. Fixed: DNS-resolution guard refusing
   private ranges on every fetch and every redirect hop, specified as
   non-negotiable.

## Should-fix items folded in

- URL normalization on insert (lowercase host, strip ports/fragments,
  drop tracking params, trailing-slash policy); named indexes in the
  migration; depth for scoring = shallowest source depth.
- Tick mechanics: maxDuration=60 explicit, 30s processing budget, claim
  50 per tick, atomic single-statement stats updates, per-host serial
  processing within a tick with in-process 750ms spacing.
- Checker: one retry with backoff on transient network failures; redirect
  precedence (terminal 4xx/5xx wins, else 3+ hops or cross-host =
  redirect_chain) with loop safety via a visited set; page targets that
  4xx/5xx/DNS-fail write broken-internal findings; 429 requeues with
  not_before (Retry-After, cap 15 min).
- Sitemap: 2MB body cap, 10k loc cap, .txt sitemap support.
- GitHub token encrypted with pgcrypto (key from env), decrypted only in
  the issue route; masked display and the OAuth upgrade note stay.
- Rate limiting on the platform-provided client IP, not raw
  X-Forwarded-For; blocked state specifies message, reset time, and the
  sign-in upsell; signed-in quota 20/day.
- PDF sanitization specifics: strip control chars, cap field lengths,
  WinAnsi-safe text, URLs as literal text.
- CSRF: Origin/Host checks on mutating routes, SameSite=Strict claim
  cookie; /tick and /triage require claim token or owner session.
- Per-site client_name and prepared_by (not global settings) on the PDF
  cover; demo-scan banner; localStorage recent scans on the landing.
- Anchor text / img alt captured per source and shown in row expansions.
- Group-level bulk triage; groups paginated at 50, sorted by impact
  descending.
- Sign-in CTA on anonymous scan pages; on sign-in, all claim-cookie
  scans attach to the user with redirect back.
- PDF: executive summary rewritten for the non-technical reader (what
  was checked, one health sentence, top 3 fixes in plain words,
  what changed); severity-distribution bar and health-trend sparkline;
  one static remediation line per reason; body rows without inlink
  detail (appendix only); "fix first" rank instead of raw impact on
  client surfaces; one-line plain-language score explanation on the
  cover.
- Live counters split ("X broken, Y couldn't verify"); zero-broken
  state names the unverifiable count; four named scan-page notices
  (sitemap fallback, cap reached, scan failed + retry, JS-content
  methodology); dashboard shows failed-scan badges; PDF button loading
  state; mobile triage as full-width tap rows.
- CSV export committed to the MVP (was "fast follow"); formulas page
  carries the "triage aid, not a grade" caveat.
- Flex order changed per the architecture reviewer: if time slips, cut
  (1) GitHub issue creation, (2) scheduled re-scans + dashboard, (3)
  automatic before/after. The PDF stays protected.
- Scheduled scans sized and messaged around the verified cron interval
  (verified in the first build slice, not assumed).

## Deliberately not taken

- Nothing. Every blocker and every should-fix was either folded into
  the plan or, in the case of the flex order, adopted as the new
  descope sequence. The reviewers' "what's solid" notes (IA order,
  grouped-findings-first, settled severity colors, stable shareable URL,
  live counters, before/after as a first-class block, public formulas)
  needed no changes.
