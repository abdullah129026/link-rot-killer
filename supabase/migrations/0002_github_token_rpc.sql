-- GitHub token RPCs: pgp_sym_encrypt on write, pgp_sym_decrypt only in
-- the issue-creation route. The token never travels through PostgREST as
-- plaintext, and the settings read returns only the last 4 chars.
-- pgcrypto is enabled in 0001_schema.sql.
create or replace function public.store_github_token(
  p_user_id uuid, p_token text, p_key text, p_last4 text)
returns void
language sql security definer set search_path = public as $$
  insert into public.github_tokens (user_id, token, token_last4)
  values (p_user_id, pgp_sym_encrypt(p_token, p_key), p_last4)
  on conflict (user_id) do update set
    token = excluded.token,
    token_last4 = excluded.token_last4,
    created_at = now();
$$;
grant execute on function public.store_github_token(uuid, text, text, text) to service_role;

create or replace function public.read_github_token(p_user_id uuid, p_key text)
returns text
language sql security definer set search_path = public as $$
  select pgp_sym_decrypt(token, p_key) from public.github_tokens where user_id = p_user_id;
$$;
grant execute on function public.read_github_token(uuid, text) to service_role;
