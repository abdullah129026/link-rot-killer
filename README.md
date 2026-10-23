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

Later migrations keep the same order prefix (`0002_`, `0003_`, ...).

## Env vars

- `SUPABASE_URL` — Supabase project settings, API section.
- `SUPABASE_ANON_KEY` — same place, the anon public key.
- `SUPABASE_SERVICE_ROLE_KEY` — same place, the service role key. Keep it secret.
- `CRON_SECRET` — a random string you generate. Gates the cron route.
- `GITHUB_TOKEN_ENCRYPTION_KEY` — a random string you generate. Encrypts stored GitHub tokens.

## Milestones

- Oct 23-24: scaffold, schema, crawl engine (normalization, fetcher with
  politeness and SSRF guard, cheerio extraction, sitemap parsing,
  checker, chunked tick runner). 14-18 tests.
- Oct 24-25: scan API and results UI (claim tokens, live progress,
  grouped findings, triage, scoring, before/after, CSV). 10-12 tests.
- Oct 25-26: PDF report, GitHub issue filing, scheduled re-scans and
  the sites dashboard. 6-8 tests.
- Oct 26-27: deploy and verify. Deadline Oct 27.
