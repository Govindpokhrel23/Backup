-- ============================================================
-- supabase/seed.sql — 最初のデータ（会社・3店舗・店長・祝日）
-- ------------------------------------------------------------
-- このファイルは、schema.sql のあとに1回だけ流して、
-- 会社・3店舗・店長（ログインID 1000）・祝日を入れるファイルです（2026年11月6日）。
--
-- 使い方：SQL Editor に貼って「Run」→ 一番下に出る「初回コード」をメモする
--        → アプリの「はじめての方」で ID 1000 と初回コードを入れて、パスワードを決める
-- 2回流すと店舗が2つずつになるので、1回だけ流す。
-- 店員はアプリの「店員管理」から足す（ここには本物の名前を書かない）。
-- ============================================================

do $$
declare
  c_id text;   -- 会社のID
  f_id text;   -- 安城福釜店のID
  a_id text;   -- 安城店のID
  i_id text;   -- 安城今村店のID
begin
  insert into companies(name) values ('株式会社21 CAFE') returning id into c_id;
  insert into stores(company_id, name, short) values (c_id, '安城福釜店', '福釜') returning id into f_id;
  insert into stores(company_id, name, short) values (c_id, '安城店', '安城') returning id into a_id;
  insert into stores(company_id, name, short) values (c_id, '安城今村店', '今村') returning id into i_id;

  -- 店長（3店舗を管理する）。名前はあとでアプリの店員管理で直せる
  insert into members(company_id, login_id, name, role, kind, skills, everyday, account, main_store_id, stores)
  values (c_id, '1000', '店長', 'manager', 'shain', '{"hall":100,"kitchen":100,"open":100,"close":100}', true, 'invited', f_id,
          jsonb_build_array(jsonb_build_object('storeId', f_id, 'rank', 1),
                            jsonb_build_object('storeId', a_id, 'rank', 2),
                            jsonb_build_object('storeId', i_id, 'rank', 3)));

  -- 店長の初回コード（7日で使えなくなる）
  insert into login_codes(login_id, code) values ('1000', lpad((floor(random() * 900000) + 100000)::int::text, 6, '0'))
    on conflict (login_id) do update set code = excluded.code, used = false, attempts = 0, created_at = now();
end $$;

-- 祝日（2026年・2027年）。毎年、内閣府の「国民の祝日」を見て足す
insert into holidays(date, name) values
  ('2026-01-01','元日'), ('2026-01-12','成人の日'), ('2026-02-11','建国記念の日'), ('2026-02-23','天皇誕生日'),
  ('2026-03-20','春分の日'), ('2026-04-29','昭和の日'), ('2026-05-03','憲法記念日'), ('2026-05-04','みどりの日'),
  ('2026-05-05','こどもの日'), ('2026-05-06','振替休日'), ('2026-07-20','海の日'), ('2026-08-11','山の日'),
  ('2026-09-21','敬老の日'), ('2026-09-22','国民の休日'), ('2026-09-23','秋分の日'), ('2026-10-12','スポーツの日'),
  ('2026-11-03','文化の日'), ('2026-11-23','勤労感謝の日'),
  ('2027-01-01','元日'), ('2027-01-11','成人の日'), ('2027-02-11','建国記念の日'), ('2027-02-23','天皇誕生日'),
  ('2027-03-21','春分の日'), ('2027-03-22','振替休日'), ('2027-04-29','昭和の日'), ('2027-05-03','憲法記念日'),
  ('2027-05-04','みどりの日'), ('2027-05-05','こどもの日'), ('2027-07-19','海の日'), ('2027-08-11','山の日'),
  ('2027-09-20','敬老の日'), ('2027-09-23','秋分の日'), ('2027-10-11','スポーツの日'), ('2027-11-03','文化の日'),
  ('2027-11-23','勤労感謝の日')
on conflict (date) do nothing;

-- 店長の初回コードを出す（これをメモする）
select login_id as "ログインID", code as "初回コード（7日以内に使う）" from login_codes where login_id = '1000';
