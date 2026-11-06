-- ============================================================
-- tests/helpers/supabase-stub.sql — テストの時だけ使う「Supabase のかわり」
-- このファイルは、本物の Supabase にある auth（ログイン）と、
-- authenticated・anon という役割を、テスト用の Postgres（PGlite）に作るファイルです。
-- 本物の Supabase には流さない（もともとある）。
-- ============================================================
create schema if not exists auth;
-- ログインの人の表（本物は Supabase が持つ）
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, password text);
-- ログイン中の人のID（本物と同じく、リクエストの JWT の sub を読む）
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
