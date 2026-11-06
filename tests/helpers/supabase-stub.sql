-- ============================================================
-- tests/helpers/supabase-stub.sql — テストの時だけ使う「Supabase のかわり」
-- このファイルは、本物の Supabase にある auth（ログイン）と、
-- authenticated・anon という役割を、テスト用の Postgres（PGlite）に作るファイルです。
-- 本物の Supabase には流さない（もともとある）。
-- ============================================================
create schema if not exists auth;   -- ログインの仕組みの入れ物（auth）を作る
-- ログインの人の表（本物は Supabase が持つ）
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, password text);   -- にせもののユーザー表（ID・メール・パスワード）
-- ログイン中の人のID（本物と同じく、リクエストの JWT の sub を読む）
create or replace function auth.uid() returns uuid language sql stable as $$   -- 「今ログインしている人のID」を返す関数
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid   -- テストで入れた JWT の sub（ユーザーID）を取り出す
$$;   -- 関数の終わり
do $$ begin   -- 役割を作る処理の始まり
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;   -- ログインした人の役割がなければ作る
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;   -- ログイン前の人の役割がなければ作る
end $$;   -- 処理の終わり
grant usage on schema auth to authenticated, anon;   -- 両方の役割に auth を使わせる
grant execute on function auth.uid() to authenticated, anon;   -- 両方の役割に auth.uid() を使わせる
