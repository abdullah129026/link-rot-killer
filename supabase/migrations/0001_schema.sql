-- Link Rot Killer schema, v1.
-- RLS is enabled on every table with no policies (default deny).
-- All access goes through service_role; every new table carries an
-- explicit minimal grant. Never grant to anon or authenticated.

create extension if not exists pgcrypto;

-- Sites being scanned. owner_user_id is null for anonymous scans.
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  name text not null,
  seed_url text not null,
  client_name text,
  prepared_by text,
  schedule text not null default 'none'
    check (schedule in ('none', 'daily', 'weekly')),
  max_pages integer not null default 200,
  created_at timestamptz not null default now()
);
alter table public.sites enable row level security;
grant select, insert, update, delete on public.sites to service_role;

-- One scan of a site. site_id is null for anonymous scans until claimed.
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.sites(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'crawling', 'done', 'failed')),
  claim_token text not null,
  ip text,
  stats jsonb not null default '{}',
  health_score integer check (health_score >= 0 and health_score <= 100),
  last_tick_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index scans_ip_started_at on public.scans (ip, started_at);
alter table public.scans enable row level security;
grant select, insert, update, delete on public.scans to service_role;

-- Work queue: pages to crawl and targets to check for one scan.
-- normalized_url is the dedupe key within a scan.
create table public.scan_targets (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  url text not null,
  normalized_url text not null,
  kind text not null
    check (kind in ('page', 'link', 'image', 'embed', 'iframe')),
  depth integer not null default 0,
  host text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done')),
  claimed_at timestamptz,
  not_before timestamptz,
  status_code integer,
  final_url text,
  error text, -- fetch.js vocabulary: timeout, dns, unreachable, robots,
              -- ssrf_refused, too_many_redirects
  checked_at timestamptz
);
create index scan_targets_scan_status on public.scan_targets (scan_id, status);
create unique index scan_targets_scan_url_unique
  on public.scan_targets (scan_id, normalized_url);
alter table public.scan_targets enable row level security;
grant select, insert, update, delete on public.scan_targets to service_role;

-- Edge table: which source page contains which target, with the anchor
-- text or image alt captured at extraction time.
create table public.scan_target_sources (
  target_id uuid not null references public.scan_targets(id) on delete cascade,
  source_target_id uuid not null references public.scan_targets(id) on delete cascade,
  context text,
  constraint scan_target_sources_pkey primary key (target_id, source_target_id)
);
create index scan_target_sources_target on public.scan_target_sources (target_id);
alter table public.scan_target_sources enable row level security;
grant select, insert, update, delete on public.scan_target_sources to service_role;

-- Findings written as checks complete. fingerprint is stable across
-- scans so triage state carries over on re-scan.
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  fingerprint text not null,
  target_url text not null,
  kind text not null
    check (kind in ('page', 'link', 'image', 'embed', 'iframe')),
  reason text not null
    check (reason in ('http_4xx', 'http_5xx', 'unreachable', 'dead_embed',
                      'unverifiable', 'redirect_chain')),
  severity text not null
    check (severity in ('error', 'warning', 'notice')),
  impact_score integer not null
    check (impact_score >= 0 and impact_score <= 100),
  state text not null default 'open'
    check (state in ('open', 'fixed', 'ignored')),
  sources jsonb not null default '[]',
  checked_at timestamptz not null default now()
);
create unique index findings_scan_fingerprint
  on public.findings (scan_id, fingerprint);
alter table public.findings enable row level security;
grant select, insert, update, delete on public.findings to service_role;

-- One encrypted GitHub token per user (pgp_sym_encrypt, key from env).
create table public.github_tokens (
  user_id uuid primary key,
  token bytea not null,
  token_last4 text,
  created_at timestamptz not null default now()
);
alter table public.github_tokens enable row level security;
grant select, insert, update, delete on public.github_tokens to service_role;

-- Politeness ledger shared across ticks: last request time per host.
create table public.host_throttle (
  host text primary key,
  last_hit_at timestamptz not null default now()
);
alter table public.host_throttle enable row level security;
grant select, insert, update, delete on public.host_throttle to service_role;

-- Claim up to p_limit pending targets for one scan, skipping rows locked by
-- overlapping ticks. Claimed rows carry the 10-minute lease (claimed_at);
-- the cron sweep reclaims expired ones. not_before holds 429-requeued
-- targets until their Retry-After elapses.
create or replace function public.claim_scan_targets(p_scan_id uuid, p_limit int)
returns setof public.scan_targets
language sql security definer set search_path = public as $$
  update public.scan_targets t
  set status = 'in_progress', claimed_at = now()
  from (
    select id from public.scan_targets
    where scan_id = p_scan_id
      and status = 'pending'
      and (not_before is null or not_before <= now())
    order by depth, id
    for update skip locked
    limit p_limit
  ) c
  where t.id = c.id
  returning t.*;
$$;
grant execute on function public.claim_scan_targets(uuid, int) to service_role;

-- Atomic scan stat bumps: one statement, no read-modify-write, so
-- overlapping ticks cannot lose increments. Also stamps last_tick_at, which
-- the stalled-scan sweep reads.
create or replace function public.bump_scan_stats(
  p_scan_id uuid, p_pages int, p_targets int, p_broken int, p_unverifiable int)
returns void
language sql security definer set search_path = public as $$
  update public.scans
  set stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        coalesce(stats, '{}'::jsonb),
        '{pages_crawled}', to_jsonb(coalesce((stats->>'pages_crawled')::int, 0) + p_pages)),
        '{targets_checked}', to_jsonb(coalesce((stats->>'targets_checked')::int, 0) + p_targets)),
        '{broken_found}', to_jsonb(coalesce((stats->>'broken_found')::int, 0) + p_broken)),
        '{unverifiable_found}', to_jsonb(coalesce((stats->>'unverifiable_found')::int, 0) + p_unverifiable)),
      last_tick_at = now()
  where id = p_scan_id;
$$;
grant execute on function public.bump_scan_stats(uuid, int, int, int, int) to service_role;
