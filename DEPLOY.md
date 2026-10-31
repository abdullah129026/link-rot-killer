# Deploy checklist — link-rot-killer

Target: Vercel (app + crawler, one deploy) + Supabase (Postgres + Auth),
both free tier. Deploy URL ends up at
`https://link-rot-killer.vercel.app`.

His clicks are needed; the code side is done. Do the steps in order.

## 1. Create the Supabase project

New project, separate from the project 1 and project 2 projects.
Region closest to you, free plan. Wait for it to finish provisioning,
then open Project Settings -> API and copy the project URL and the
anon public key, plus the service role key (keep the service role key
secret).

## 2. Run the migrations

Supabase dashboard -> SQL editor, paste and run each file in order:

1. `supabase/migrations/0001_schema.sql` — creates the tables, indexes,
   RPCs, enables pgcrypto, RLS on with no policies (default deny),
   explicit minimal grants to `service_role` only.
2. `supabase/migrations/0002_github_token_rpc.sql` — the encrypted
   GitHub token RPCs (pgp_sym_encrypt/decrypt, execute to
   `service_role` only).

Each run should end with "Success. No rows returned". If a grant line
fails with a permission error, stop: the table creation above it did
not run cleanly.

## 3. Generate two secrets

You need two random strings (any length, any generator works; on
Windows, Git Bash `openssl rand -hex 32` if you have it, or any password
generator):

- `CRON_SECRET` — bearer for the cron route. Keep it; you only need it
  once, when setting env vars.
- `GITHUB_TOKEN_ENCRYPTION_KEY` — encrypts stored GitHub tokens in the
  DB. Keep it with the other secrets.

The agent must never see these values. They go straight into the Vercel
env vars below.

## 4. Set env vars on Vercel

Vercel project -> Settings -> Environment Variables, Production scope:

- `SUPABASE_URL` — the project URL from step 1.
- `NEXT_PUBLIC_SUPABASE_URL` — the same URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the anon key from step 1.
- `SUPABASE_SERVICE_ROLE_KEY` — the service role key from step 1.
- `CRON_SECRET` — your string from step 3.
- `GITHUB_TOKEN_ENCRYPTION_KEY` — your string from step 3.

Redeploy after adding or changing env vars. Existing deployments do
not pick up new values.

## 5. Deploy on Vercel

Import `abdullah129026/link-rot-killer` from GitHub, Next.js preset,
deploy. The daily cron (`GET /api/cron/tick` at 03:00 UTC) is declared
in `vercel.json` and deploys with the app. Vercel Hobby fires cron at
most once a day and hard-caps functions at 10 seconds; the app is sized
for that (7 second tick budget, oldest scan first). An external free
scheduler (e.g. cron-job.org) can call the same route more often with
the same bearer secret if you want scheduled scans to advance faster.

## 6. Supabase auth audit (before the first sign-in)

Supabase dashboard -> Authentication -> URL Configuration:

- Site URL must be `https://link-rot-killer.vercel.app` (the default is
  localhost; it stays localhost until you change it by hand).
- Redirect URLs must include `https://link-rot-killer.vercel.app/**`.

If sign-in emails were already sent before this fix, they are dead.
Request a fresh magic link after the change. This audit is the
difference between working sign-in and emails pointing at localhost.

## 7. Verification sweep

Run against the production domain after the deploy finishes:

- `/`, `/login`, `/formulas` — 200.
- `/sites`, `/settings` while signed out — redirect to `/login` (307).
- `/sites`, `/settings` while signed in — 200, no 500. Signed-out
  checks prove nothing about the signed-in render path.
- `GET /api/cron/tick` with no secret — 401.
- A real anonymous scan: paste a sitemap URL, watch the live counters,
  grouped findings with anchor context and impact scores, health score.
- Download the PDF for a finished scan; check the cover fields.
- If you want the GitHub demo: create a fine-grained PAT with
  issues:write on one test repo, paste it in `/settings`, file an issue
  from a finished scan. The issue should land on the repo you named.

If anything 500s, the Vercel runtime logs name the actual error line;
read them before changing code.

## 8. Post-deploy notes

- Anonymous scans work with no account (3 per IP per UTC day).
  Signed-in scans save to `/sites` and support daily/weekly scheduled
  re-scans.
- A watched scan finishes in real time on the scan page. An unwatched
  scheduled scan advances one 7 second chunk per cron tick, so a big
  site takes days unattended. The scan page states this honestly.
- The impact and health formulas are public at `/formulas`.
