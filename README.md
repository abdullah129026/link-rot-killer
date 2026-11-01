![Link Rot Killer logo](app/icon.svg)

# Link Rot Killer

Paste a sitemap.xml URL, get every dead link, broken image, and dead
YouTube embed on the site, scored by SEO impact. Findings come with the
pages that contain them, a health score with a public formula, a
client-ready PDF, CSV export, and one-click GitHub issue filing.
Anonymous scans work with no account; signing in saves scans and
schedules weekly re-scans.

Live: https://link-rot-killer.vercel.app

## What it does

Links rot. Pages get deleted, sites get restructured, YouTube videos go
private, and nobody notices until a visitor or a search crawler hits a
dead end. Existing checkers either scan one page at a time, miss embeds
and lazy-loaded images, or give you a raw list of 404s with no sense of
what matters.

Link Rot Killer takes a whole site as input and returns a prioritized
fix list:

1. **Paste a sitemap.** A sitemap.xml works best. A plain homepage works
   too; the scanner discovers pages from there and says so.
2. **Watch it crawl.** The scan page streams findings live as pages are
   crawled and every outbound link, image, YouTube embed, and iframe is
   checked. Dead YouTube embeds are caught through the oEmbed API, which
   tells live videos apart from dead ones even though both return
   HTTP 200. Lazy-loaded `data-src` images are checked, not just `src`.
3. **Fix what matters.** Every finding carries an impact score and a
   severity, so the three fixes that move the needle come first. Each
   finding lists the exact pages that link to it.
4. **Hand it to a client.** One click produces a client-ready PDF report
   (cover, executive summary, severity breakdown, ranked findings with
   remediation lines, before/after) or a CSV for your own tooling. A
   GitHub issue can be filed straight from a scan with the findings
   attached.

## Features

- **Whole-site crawling** from a sitemap or homepage, with politeness
  delays, redirect-chain following, and an SSRF guard that refuses
  private/internal targets.
- **Embed-aware checking**: dead YouTube embeds via oEmbed status,
  broken images including lazy-loaded `data-src`, dead iframes.
- **SEO impact scoring**: every finding scored from issue type,
  internal vs outbound, inlink count, and page depth. The formula is
  public and linked from the site; no black box.
- **Site health score 0-100** with the same open formula.
- **Triage**: mark findings fixed or ignored; ignored findings stay
  ignored across re-scans, fixed ones that reappear regress to open.
- **Before/after**: re-scan and see exactly what changed.
- **Scheduled re-scans**: daily or weekly per site, for signed-in users.
- **Client PDF + CSV**: print-ready report and raw export.
- **GitHub issue filing**: one click, findings attached, token stored
  encrypted (pgcrypto) and never logged.
- **Anonymous scans**: no account needed for the first scans; a claim
  cookie makes you the owner. Sign in to save scans and schedule
  re-scans.

## Scoring

The health score and every impact score use public formulas with named
inputs: issue type, internal vs outbound, how many of your pages link to
it, and page depth. No backlink or traffic data is used, and the site
says so. Read the formulas at `/formulas` on the live site.

## Stack

Next.js 16 (App Router, plain JS) + Supabase (Postgres, Auth, pgcrypto)
on the free tier. Deployed on Vercel. The crawler is a Node module
inside the Next.js app; one codebase, one deploy.

## Run locally

```sh
npm install
cp .env.example .env.local   # fill in values, see below
npm run dev
```

Tests: `npm test` (node test runner over `test/`).

## Deploy

Full click-by-click deploy + verification checklist: `DEPLOY.md`.
Summary: create a Supabase project, run the two migrations, set the six
env vars on Vercel (two of them are secrets you generate), import the
repo on Vercel, audit the Supabase site URL before the first sign-in,
then run the verification sweep. Nothing code-side remains.

## Migrations

Run in the Supabase SQL editor, in order:

1. `supabase/migrations/0001_schema.sql` — the seven tables, indexes,
   RLS (enabled, no policies: default deny), and explicit grants to
   `service_role` only. Pins pgcrypto to the `public` schema, since new
   Supabase projects install extensions into `extensions` by default.
2. `supabase/migrations/0002_github_token_rpc.sql` — the encrypted GitHub
   token RPCs (pgp_sym_encrypt/decrypt, execute to `service_role` only).

Later migrations keep the same order prefix (`0003_`, ...).

## Env vars

- `SUPABASE_URL` — Supabase project settings, API section.
- `NEXT_PUBLIC_SUPABASE_URL` — the same URL, exposed to the browser for
  magic-link sign-in.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same place, the anon public key.
- `SUPABASE_SERVICE_ROLE_KEY` — same place, the service role key. Keep it secret.
- `CRON_SECRET` — a random string you generate. Gates the cron route.
- `GITHUB_TOKEN_ENCRYPTION_KEY` — a random string you generate. Encrypts stored GitHub tokens.

## Scheduling notes

The cron route `GET /api/cron/tick` (bearer `CRON_SECRET`) runs daily at
03:00 UTC on the Vercel Hobby plan, which fires cron at most once a day
and hard-caps functions at 10 seconds. Each tick advances active scans
oldest first inside a 7 second budget and starts due scheduled scans
(daily/weekly per site). A big site therefore takes days unattended; the
scan page states that honestly, and a watched scan finishes in real time.
An external free scheduler (e.g. cron-job.org) can call the same route
more often with the same bearer <redacted>
