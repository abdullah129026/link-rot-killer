# Link Rot Killer

Paste a sitemap.xml URL, get every dead link, broken image, and dead
YouTube embed on the site, scored by SEO impact. Findings come with the
pages that contain them, a health score with a public formula, a
client-ready PDF, CSV export, and one-click GitHub issue filing.
Anonymous scans work with no account; signing in saves scans and
schedules weekly re-scans.

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

## Migrations

Run in the Supabase SQL editor, in order:

1. `supabase/migrations/0001_schema.sql` — the seven tables, indexes,
   RLS (enabled, no policies: default deny), and explicit grants to
   `service_role` only.
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
more often with the same bearer secret.

## Milestones

- Oct 23-24: scaffold, schema, crawl engine (normalization, fetcher with
  politeness and SSRF guard, cheerio extraction, sitemap parsing,
  checker, chunked tick runner). 14-18 tests.
- Oct 24-25: scan API and results UI (claim tokens, live progress,
  grouped findings, triage, scoring, before/after, CSV). 10-12 tests.
- Oct 25-26: PDF report, GitHub issue filing, scheduled re-scans and
  the sites dashboard. 6-8 tests.
- Oct 26-27: deploy and verify. Deadline Oct 27.
