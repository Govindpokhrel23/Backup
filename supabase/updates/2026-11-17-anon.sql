-- ============================================================
-- supabase/updates/2026-11-17-anon.sql — ログインしていない人に何も使わせない
-- ------------------------------------------------------------
-- このファイルは、もう動いているデータベースで、ログインしていない人（anon）が
-- 表や関数を使えないようにするSQLのファイルです（2026年11月17日・セキュリティ）。
-- Supabase の SQL Editor に貼って「Run」を1回押す。何回押しても大丈夫
-- ※ 2026-11-16-security.sql を先に Run してから、これを Run する
-- ============================================================

revoke all on all tables in schema public from anon;   -- ログイン前の人は表を読めない・書けない
revoke all on all sequences in schema public from anon;   -- ログイン前の人は番号も使えない
revoke execute on all functions in schema public from public, anon;   -- 関数は「だれでも使える」をやめる
grant execute on all functions in schema public to authenticated, service_role;   -- ログインした人と Worker だけ関数を使える
alter default privileges in schema public revoke all on tables from anon;   -- これから作る表も、ログイン前の人には使わせない
alter default privileges in schema public revoke all on sequences from anon;   -- これから作る番号も同じ
alter default privileges in schema public revoke execute on functions from public, anon;   -- これから作る関数も同じ
