-- ============================================================
-- supabase/developer.sql — 開発者アカウントを作る（2026年11月12日）
-- ------------------------------------------------------------
-- このファイルは、アプリを直す人（開発者）のアカウントを作るSQLのファイルです。
-- Supabase の SQL Editor に貼って「Run」すると、下に ID と初回コードが出ます。
--
-- 開発者ができること：
--   ・店長と同じこと全部（シフト作成・店員管理・設定など）
--   ・店長のパスワードのリセット（店長が忘れた時）
--   ・「設定」→「見る画面」で、店員の画面にも切りかえられる
-- 開発者に起きないこと：
--   ・シフト・店員の一覧・AIの下書きには出ない
-- 店長は「店員管理」のいちばん下で、開発者を止められる
-- ============================================================

-- 前からある表に「開発者か」の列を足す（もうあれば何もしない）
alter table members add column if not exists developer boolean not null default false;   -- 開発者なら true

do $$   -- ここから処理（変数を使うため）
declare   -- 使う変数の宣言
  c_id text;   -- 会社のID
  s_id text;   -- いちばん古い店舗のID（ログインした時に最初に見る店舗）
begin   -- 処理の始まり
  select id into c_id from companies limit 1;   -- 会社（1つめ）
  select id into s_id from stores where company_id = c_id order by created_at limit 1;   -- いちばん古い店舗

  -- 開発者のアカウント（ID 9000）。もうあれば作らない
  insert into members(company_id, login_id, name, role, kind, skills, everyday, account, main_store_id, stores, developer)   -- 店員の表に足す
  values (c_id, '9000', '開発者', 'manager', 'shain', '{"hall":0,"kitchen":0,"open":0,"close":0}', false, 'invited', s_id, '[]', true)   -- 店長と同じ役割・どの店舗のシフトにも出ない
  on conflict (login_id) do update set developer = true, role = 'manager';   -- もうあれば開発者にする

  -- 初回コード（7日で使えなくなる）
  insert into login_codes(login_id, code) values ('9000', lpad((floor(random() * 900000) + 100000)::int::text, 6, '0'))   -- 6けたのでたらめな数
    on conflict (login_id) do update set code = excluded.code, used = false, attempts = 0, created_at = now();   -- もうあれば作り直す
end $$;   -- 処理の終わり

-- ID と初回コードを画面に出す
select login_id as "ログインID", code as "初回コード（7日以内に使う）" from login_codes where login_id = '9000';   -- 開発者の初回コード
