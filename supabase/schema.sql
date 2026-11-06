-- ============================================================
-- supabase/schema.sql — データベースの形（テーブル）と、見てよい人の決まり（RLS）
-- ------------------------------------------------------------
-- このファイルは、Supabase のデータベースに「表（テーブル）」と
-- 「だれが、どの行を見る・書くことができるか（RLS）」を作るファイルです（2026年11月6日）。
--
-- 使い方：Supabase の画面 → SQL Editor → このファイルの中身を全部貼って「Run」
--         （何回流しても大丈夫なように、ある物は作り直さない形で書いてある）
-- そのあと seed.sql を流すと、会社・3店舗・店長（ID 1000）ができる。
--
-- 決まり（RLS）の考え方：
--   ・同じ会社の人だけが、その会社のデータを見られる
--   ・店長だけが、店舗・店員・マップ・シフトを書ける
--   ・店員は「自分の希望」「自分の確認」「自分の交代のお願い」だけ書ける
--   ・希望・時給・人ごとのルール・AIの学びは、店長だけが見られる（希望は本人も）
--   ・公開前のシフトは店長だけ。公開したら同じ会社の全員が見られる
--   ・初回コード（login_codes）は、だれもアプリから直接見られない（サーバーの関数だけ）
-- 時刻は「0:00から何分か」（from_min / to_min）。アプリの from / to と同じ。
-- ============================================================

-- gen_random_uuid() は Postgres に最初から入っている（拡張はいらない）

-- ------------------------------------------------------------
-- 1. テーブル
-- ------------------------------------------------------------

-- 会社（例：株式会社21 CAFE）
create table if not exists companies (   -- 会社の表
  id   text primary key default gen_random_uuid()::text,   -- 会社のID
  name text not null                                        -- 会社名
);

-- 店舗（消さない。閉めたら active=false）
create table if not exists stores (   -- 店舗の表
  id         text primary key default gen_random_uuid()::text,   -- 店舗のID
  company_id text not null references companies(id),             -- どの会社の店舗か
  name       text not null,                                       -- 店舗名（例：安城福釜店）
  short      text not null,                                       -- 短い名前（例：福釜）
  active     boolean not null default true,                       -- 営業中か（false＝休止）
  created_at timestamptz not null default clock_timestamp(),      -- 作った日時（ボタンの並び順）
  -- 営業時間（平日・土曜・日曜祝日）。分で持つ
  hours      jsonb not null default '{"weekday":{"open":420,"close":1320},"sat":{"open":420,"close":1320},"sun":{"open":420,"close":1320}}'   -- 営業時間（はじめは7:00〜22:00）
);

-- ログインID の番号（新しい店員は 5001 から）
create sequence if not exists login_id_seq start 5001;   -- ログインIDの番号（5001から）

-- 店員（店長も入る）
create table if not exists members (   -- 店員の表
  id            text primary key default gen_random_uuid()::text,   -- 店員のID
  company_id    text not null references companies(id),             -- どの会社の人か
  auth_id       uuid unique,                                         -- Supabase のログインの人（アカウントを作ると入る）
  login_id      text not null unique default nextval('login_id_seq')::text,   -- ログインに使う番号
  name          text not null,                                       -- 名前
  role          text not null default 'staff' check (role in ('manager','staff')),   -- 店長か店員か
  kind          text not null default 'baito' check (kind in ('shain','baito','full')), -- 社員／バイト／フル
  skills        jsonb not null default '{"hall":0,"kitchen":0,"open":0,"close":0}',   -- できること％
  everyday      boolean not null default false,                      -- 毎日入る人か
  active        boolean not null default true,                       -- 働いているか（false＝停止）
  account       text not null default 'none' check (account in ('none','invited','active')),   -- アカウントの状態
  main_store_id text references stores(id),                          -- メインの店舗
  stores        jsonb not null default '[]',                         -- 行ける店舗と順番 [{storeId, rank}]
  created_at    timestamptz not null default now()                   -- 作った日時
);

-- 人ごとのルール（店長だけ）
create table if not exists member_rules (   -- 人ごとのルールのメモの表（店長だけ）
  member_id  text primary key references members(id) on delete cascade,   -- だれのルールか
  company_id text not null references companies(id),                     -- 会社
  text       text not null default ''                                     -- ルールの文
);

-- 時給・交通費（店長だけ）
create table if not exists wages (   -- 時給・交通費・働き方のルールの表（店長だけ）
  member_id  text primary key references members(id) on delete cascade,   -- だれの時給か
  company_id text not null references companies(id),                     -- 会社
  hourly     integer not null default 0,                                  -- 時給（円）
  transport  integer not null default 0,                                  -- 交通費（1日・円）
  minor      boolean not null default false,                              -- 18歳未満か（22時〜朝5時は入れない）
  month_hours_max integer,                                                -- 月の上限時間（なければ決めない）
  year_yen_max    integer                                                 -- 年の上限金額（扶養など。なければ決めない）
);

-- マップの人のマーク（担当場所）
create table if not exists positions (   -- 場所（レジなど）の表
  id       text primary key default gen_random_uuid()::text,   -- マークのID
  store_id text not null references stores(id),                -- どの店舗か
  name     text not null,                                       -- 名前（例：スナック）
  area     text not null check (area in ('hall','kitchen')),    -- ホールかキッチンか
  x        real not null default 420,                           -- マップの横の位置
  y        real not null default 290                            -- マップの縦の位置
);

-- 必要人数（マークごと・日の種類ごと・時間帯ごと）
create table if not exists requirements (   -- 必要人数の表
  id          text primary key default gen_random_uuid()::text,   -- ID
  position_id text not null references positions(id) on delete cascade,   -- どのマークか
  store_id    text not null references stores(id),                -- どの店舗か（決まりを早く調べるため）
  day_type    text not null check (day_type in ('weekday','sat','sun')),   -- 平日／土曜／日曜祝日
  from_min    integer not null,                                    -- 始まり（分）
  to_min      integer not null,                                    -- 終わり（分）
  count       integer not null default 1                           -- 人数
);

-- 受付（週）。1店舗1週に1つ
create table if not exists periods (   -- 週の表
  id           text primary key default gen_random_uuid()::text,   -- ID
  store_id     text not null references stores(id),                -- どの店舗か
  week_start   date not null,                                       -- その週の月曜
  deadline     text not null,                                       -- 締切（例 2026-11-08T24:00）
  status       text not null default 'open' check (status in ('open','closed','published')),   -- 受付中／締切／公開
  note         text not null default '',                            -- 連絡事項
  guests       jsonb not null default '[]',                         -- この週だけの応援の人のID
  published_at timestamptz,                                         -- 公開した日時
  unique (store_id, week_start)   -- 1つの店舗に同じ週は1つだけ
);

-- 希望（人と日で1つ）
create table if not exists availabilities (   -- 希望の表
  member_id text not null references members(id) on delete cascade,   -- だれの希望か
  date      date not null,                                              -- 日付
  kind      text not null check (kind in ('time','any','no','off','offx')),   -- 時間指定／いつでも／入れない／休み希望／特別許可の申請
  from_min  integer,                                                    -- 時間指定の始まり
  to_min    integer,                                                    -- 時間指定の終わり
  note      text not null default '',                                   -- メモ
  primary key (member_id, date)   -- 1人1日1つ
);

-- 勤務（シフト）
create table if not exists assignments (   -- 勤務の表
  id         text primary key default gen_random_uuid()::text,   -- ID
  period_id  text not null references periods(id) on delete cascade,   -- どの週か
  store_id   text not null references stores(id),                -- どの店舗か
  member_id  text not null references members(id),               -- だれか
  date       date not null,                                       -- 日付
  from_min   integer not null,                                    -- 始まり（分）
  to_min     integer not null,                                    -- 終わり（分）
  area       text not null default 'hall' check (area in ('hall','kitchen')),   -- 場所
  break_at   integer,                                             -- 休憩の時刻（分）
  fixed      boolean not null default false,                      -- 固定（AIが変えない）
  created_by text not null default 'manager',                     -- だれが入れたか（manager／ai／call）
  requested  boolean not null default false,                      -- 希望の中か
  helper     boolean not null default false,                      -- 応援か
  reason     text not null default ''                             -- AIの理由
);
create index if not exists assignments_period_idx on assignments(period_id);   -- 週で探しやすくする
create index if not exists assignments_member_date_idx on assignments(member_id, date);   -- 人と日で探しやすくする

-- お知らせ
create table if not exists notifications (   -- お知らせの表
  id        bigint generated always as identity primary key,   -- ID
  member_id text not null references members(id) on delete cascade,   -- だれへのお知らせか
  at        timestamptz not null default now(),                -- 日時
  text      text not null                                       -- 文
);
create index if not exists notifications_member_idx on notifications(member_id, at desc);   -- 人ごとに新しい順で探しやすくする

-- 「シフトを見ました」
create table if not exists confirms (   -- 「見ました」の表
  period_id text not null references periods(id) on delete cascade,   -- どの週か
  member_id text not null references members(id) on delete cascade,   -- だれが
  at        timestamptz not null default now(),                       -- いつ
  primary key (period_id, member_id)   -- 1人1週1つ
);

-- シフト交代のお願い
create table if not exists swaps (   -- 交代の表
  id             text primary key default gen_random_uuid()::text,   -- ID
  assignment_id  text not null references assignments(id) on delete cascade,   -- 交代したい勤務
  store_id       text not null references stores(id),                -- 店舗
  date           date not null,                                       -- 日付
  from_min       integer not null,                                    -- 始まり
  to_min         integer not null,                                    -- 終わり
  area           text not null,                                       -- 場所
  from_member_id text not null references members(id),               -- お願いした人
  taker_id       text references members(id),                         -- 代わる人
  note           text not null default '',                            -- 理由
  status         text not null default 'open' check (status in ('open','taken','approved','rejected','canceled')),   -- 状態
  created_at     timestamptz not null default now()                   -- 日時
);

-- 人が足りない時の募集（自動連絡）
create table if not exists calls (   -- 人が足りない時の募集の表
  id            text primary key default gen_random_uuid()::text,   -- ID
  store_id      text not null references stores(id),                -- 店舗
  period_id     text not null references periods(id) on delete cascade,   -- 週
  date          date not null,                                       -- 日付
  area          text not null,                                       -- 場所
  from_min      integer not null,                                    -- 始まり
  to_min        integer not null,                                    -- 終わり
  short         integer not null default 1,                          -- 足りない人数
  status        text not null default 'open' check (status in ('open','filled','closed')),   -- さがし中／決まった／やめた
  auto          boolean not null default false,                      -- 自動で送ったか
  candidate_ids jsonb not null default '[]',                         -- 知らせた人のID
  answers       jsonb not null default '[]',                         -- 「入れます」の人 [{memberId, at}]
  filled_by     text references members(id),                         -- 決まった人
  created_at    timestamptz not null default now()                   -- 日時
);

-- AIの下書き（公開の時に店長の直しと比べる。店長だけ）
create table if not exists ai_drafts (   -- AIの下書きの表
  period_id text primary key references periods(id) on delete cascade,   -- 週
  store_id  text not null references stores(id),                         -- 店舗
  rows      jsonb not null default '[]'                                   -- AIが作った勤務
);

-- AIの学び（店長の直し方。店長だけ）
create table if not exists learnings (   -- 覚えたことの表
  id        text primary key default gen_random_uuid()::text,   -- ID
  store_id  text not null references stores(id),                -- 店舗
  member_id text not null,                                       -- だれの直しか
  date      date,                                                -- どの日の直しか
  weekday   integer not null,                                    -- 曜日（0＝日曜）
  kind      text not null,                                       -- time／remove／add／area
  from_min  integer, to_min integer,                             -- 店長が決めた時間
  ai_from   integer, ai_to integer,                              -- AIが決めた時間
  area      text, ai_area text,                                  -- 店長の場所・AIの場所
  at        timestamptz not null default now()                   -- 覚えた日時
);

-- 初回コード（アプリからは直接見られない）
create table if not exists login_codes (   -- 初回コードの表（アプリからは読めない）
  login_id   text primary key,                       -- ログインID
  code       text not null,                          -- 6桁のコード
  used       boolean not null default false,         -- 使ったか
  attempts   integer not null default 0,             -- まちがえた回数（5回で使えなくなる。総当たりを防ぐ）
  created_at timestamptz not null default now()      -- 出した日時（7日で使えなくなる）
);

-- プッシュ通知の宛先（スマホごと。2026年11月6日）
create table if not exists push_subs (   -- 通知の宛先の表
  endpoint   text primary key,                                        -- 通知を送る住所（スマホのブラウザが決める）
  member_id  text not null references members(id) on delete cascade, -- だれのスマホか
  p256dh     text not null,                                           -- 暗号の鍵（スマホが決める）
  auth       text not null,                                           -- 暗号の合言葉（スマホが決める）
  created_at timestamptz not null default now()                       -- 登録した日時
);

-- 祝日（みんな見られる）
create table if not exists holidays (   -- 祝日の表
  date date primary key,   -- 日付
  name text not null       -- 祝日の名前
);

-- ------------------------------------------------------------
-- 2. 決まりで使う小さな関数（security definer＝決まりを通らずに自分の情報だけ調べる）
-- ------------------------------------------------------------

-- ログイン中の店員のID（いなければ null）
create or replace function my_member_id() returns text   -- 自分の店員IDを返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select id from members where auth_id = auth.uid() and active limit 1   -- ログイン中の人の店員ID
$$;   -- 関数の終わり

-- ログイン中の人の会社
create or replace function my_company() returns text   -- 自分の会社IDを返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select company_id from members where auth_id = auth.uid() and active limit 1   -- ログイン中の人の会社ID
$$;   -- 関数の終わり

-- ログイン中の人が店長か
create or replace function i_am_manager() returns boolean   -- 自分が店長か返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select exists(select 1 from members where auth_id = auth.uid() and active and role = 'manager')   -- 店長ならtrue
$$;   -- 関数の終わり

-- その店舗が自分の会社の店舗か
create or replace function store_in_my_company(sid text) returns boolean   -- 自分の会社の店舗か返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select exists(select 1 from stores where id = sid and company_id = my_company())   -- 同じ会社ならtrue
$$;   -- 関数の終わり

-- その店員が自分の会社の人か
create or replace function member_in_my_company(mid text) returns boolean   -- 自分の会社の店員か返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select exists(select 1 from members where id = mid and company_id = my_company())   -- 同じ会社ならtrue
$$;   -- 関数の終わり

-- その週が公開済みか
create or replace function period_published(pid text) returns boolean   -- 公開した週か返す関数
language sql stable security definer set search_path = public as $$   -- 表のルールをこえて読める関数
  select exists(select 1 from periods where id = pid and status = 'published')   -- 公開ならtrue
$$;   -- 関数の終わり

-- ------------------------------------------------------------
-- 3. 決まり（RLS）
-- ------------------------------------------------------------

alter table companies      enable row level security;   -- 会社：ルールを使う
alter table stores         enable row level security;   -- 店舗：ルールを使う
alter table members        enable row level security;   -- 店員：ルールを使う
alter table member_rules   enable row level security;   -- メモ：ルールを使う
alter table wages          enable row level security;   -- 時給：ルールを使う
alter table positions      enable row level security;   -- 場所：ルールを使う
alter table requirements   enable row level security;   -- 必要人数：ルールを使う
alter table periods        enable row level security;   -- 週：ルールを使う
alter table availabilities enable row level security;   -- 希望：ルールを使う
alter table assignments    enable row level security;   -- 勤務：ルールを使う
alter table notifications  enable row level security;   -- お知らせ：ルールを使う
alter table confirms       enable row level security;   -- 見ました：ルールを使う
alter table swaps          enable row level security;   -- 交代：ルールを使う
alter table calls          enable row level security;   -- 募集：ルールを使う
alter table ai_drafts      enable row level security;   -- AIの下書き：ルールを使う
alter table learnings      enable row level security;   -- 覚えたこと：ルールを使う
alter table login_codes    enable row level security;   -- 決まりを作らない＝アプリからはだれも見られない
alter table holidays       enable row level security;   -- 祝日：ルールを使う
alter table push_subs      enable row level security;   -- 通知の宛先：ルールを使う

-- 決まりを作り直せるように、前の決まりを消してから作る
do $$   -- 前のルールを全部消す処理
declare r record;   -- 使う変数
begin   -- 始まり
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop   -- 今あるルールごとに
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);   -- 消す
  end loop;   -- くり返しの終わり
end $$;   -- 処理の終わり

-- 会社：自分の会社だけ見られる
create policy companies_read on companies for select using (id = my_company());   -- 会社：自分の会社だけ読める

-- 店舗：同じ会社は見られる。店長が足す・直す
create policy stores_read  on stores for select using (company_id = my_company());   -- 店舗：自分の会社だけ読める
create policy stores_write on stores for insert with check (i_am_manager() and company_id = my_company());   -- 店舗：店長だけ作れる
create policy stores_edit  on stores for update using (i_am_manager() and company_id = my_company());   -- 店舗：店長だけ変えられる

-- 店員：同じ会社は見られる（名前を出すため）。店長が足す・直す
create policy members_read  on members for select using (company_id = my_company());   -- 店員：自分の会社だけ読める
create policy members_write on members for insert with check (i_am_manager() and company_id = my_company());   -- 店員：店長だけ作れる
create policy members_edit  on members for update using (i_am_manager() and company_id = my_company());   -- 店員：店長だけ変えられる

-- 人ごとのルール・時給：店長だけ
create policy rules_all on member_rules for all using (i_am_manager() and company_id = my_company()) with check (i_am_manager() and company_id = my_company());   -- メモ：店長だけ
create policy wages_all on wages        for all using (i_am_manager() and company_id = my_company()) with check (i_am_manager() and company_id = my_company());   -- 時給：店長だけ

-- マップ・必要人数：同じ会社は見られる。店長が書く
create policy positions_read on positions for select using (store_in_my_company(store_id));   -- 場所：会社の人は読める
create policy positions_all  on positions for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 場所：店長だけ変えられる
create policy reqs_read on requirements for select using (store_in_my_company(store_id));   -- 必要人数：会社の人は読める
create policy reqs_all  on requirements for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 必要人数：店長だけ変えられる

-- 受付（週）：同じ会社は見られる。店長が書く
create policy periods_read on periods for select using (store_in_my_company(store_id));   -- 週：会社の人は読める
create policy periods_all  on periods for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 週：店長だけ変えられる

-- 希望：本人と店長だけ見られる。本人が書く。店長は特別許可で直せる
create policy hopes_read on availabilities for select using (member_id = my_member_id() or (i_am_manager() and member_in_my_company(member_id)));   -- 希望：自分の分と、店長は会社の分
create policy hopes_own  on availabilities for all using (member_id = my_member_id()) with check (member_id = my_member_id());   -- 希望：自分の分は変えられる
create policy hopes_boss on availabilities for update using (i_am_manager() and member_in_my_company(member_id));   -- 希望：店長は変えられる（特別許可）

-- 勤務：店長は全部。店員は公開した週だけ見られる。店長が書く
create policy work_read on assignments for select using (   -- 勤務：店長は全部、店員は公開した週だけ
  (i_am_manager() and store_in_my_company(store_id)) or (store_in_my_company(store_id) and period_published(period_id)));   -- 条件のつづき
create policy work_all on assignments for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 勤務：店長だけ変えられる

-- お知らせ：自分あてだけ見られる。同じ会社の人あてなら送れる
create policy notes_read  on notifications for select using (member_id = my_member_id());   -- お知らせ：自分の分だけ読める
create policy notes_write on notifications for insert with check (member_in_my_company(member_id) and my_member_id() is not null);   -- お知らせ：会社の人に送れる

-- 「見ました」：本人と店長が見られる。本人が書く
create policy confirms_read on confirms for select using (member_id = my_member_id() or (i_am_manager() and member_in_my_company(member_id)));   -- 見ました：自分の分と、店長は会社の分
create policy confirms_own  on confirms for all using (member_id = my_member_id()) with check (member_id = my_member_id());   -- 見ました：自分の分は変えられる

-- 交代：同じ会社は見られる。本人がお願い・取り下げ。店長が決める（「代わります」は take_swap 関数）
create policy swaps_read  on swaps for select using (store_in_my_company(store_id));   -- 交代：会社の人は読める
create policy swaps_write on swaps for insert with check (from_member_id = my_member_id() and store_in_my_company(store_id));   -- 交代：自分の勤務だけお願いできる
create policy swaps_edit  on swaps for update using (from_member_id = my_member_id() or (i_am_manager() and store_in_my_company(store_id)));   -- 交代：お願いした人と店長が変えられる

-- 募集：店長と、知らせた人が見られる。店長が書く（「入れます」は answer_call 関数）
create policy calls_read on calls for select using (   -- 募集：店長と候補の人が読める
  (i_am_manager() and store_in_my_company(store_id)) or candidate_ids ? my_member_id());   -- 条件のつづき
create policy calls_all on calls for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 募集：店長だけ変えられる

-- AIの下書き・学び：店長だけ
create policy drafts_all on ai_drafts for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- AIの下書き：店長だけ
create policy learn_all  on learnings for all using (i_am_manager() and store_in_my_company(store_id)) with check (i_am_manager() and store_in_my_company(store_id));   -- 覚えたこと：店長だけ

-- プッシュ通知の宛先：自分のスマホの分だけ登録・解除できる（送るのは Worker が管理用の鍵で読む）
create policy push_own on push_subs for all using (member_id = my_member_id()) with check (member_id = my_member_id());   -- 通知の宛先：自分の分だけ

-- 祝日：ログインした人はみんな見られる
create policy holidays_read on holidays for select using (auth.uid() is not null);   -- 祝日：ログインした人は読める

-- アプリ（ログインした人）に表を使ってよいと伝える。どの行かは上の決まりで決まる
grant usage on schema public to authenticated;   -- ログインした人が使えるように
grant select, insert, update, delete on all tables in schema public to authenticated;   -- 表の操作を許す（中身はルールでしぼる）
grant usage, select on all sequences in schema public to authenticated;   -- 番号を使えるように
revoke all on login_codes from authenticated;   -- 初回コードは関数だけが使う

-- ------------------------------------------------------------
-- 4. アプリから呼ぶ関数（決まりだけではできないこと）
-- ------------------------------------------------------------

-- 初回コードを出す（店長）。アカウント作成・パスワードを忘れた時
create or replace function issue_login_code(p_member_id text) returns json   -- 初回コードを作る関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて動く
declare   -- 使う変数
  m members;      -- コードを出す店員
  c text;         -- 6桁のコード
begin   -- 始まり
  if not i_am_manager() then raise exception '店長だけができる操作です'; end if;   -- 店長でなければ止める
  select * into m from members where id = p_member_id and company_id = my_company();   -- 店員を探す
  if m.id is null then raise exception '店員が見つかりません'; end if;   -- いなければ止める
  c := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');   -- 6けたのでたらめな数
  insert into login_codes(login_id, code, used, created_at) values (m.login_id, c, false, now())   -- 保存
    on conflict (login_id) do update set code = excluded.code, used = false, attempts = 0, created_at = now();   -- あれば作り直す
  if m.account = 'none' then update members set account = 'invited' where id = m.id; end if;   -- アカウントなしなら招待中にする
  return json_build_object('loginId', m.login_id, 'code', c);   -- IDとコードを返す
end $$;   -- 終わり

-- 「代わります」（店員）。同じ時間にほかの勤務があれば代われない
create or replace function take_swap(p_swap_id text) returns json   -- 交代を引き受ける関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて動く
declare   -- 使う変数
  me_id text := my_member_id();   -- ログイン中の人
  me_name text;                   -- その人の名前
  x swaps;                        -- その交代のお願い
begin   -- 始まり
  select * into x from swaps where id = p_swap_id and store_in_my_company(store_id);   -- 交代を探す
  if x.id is null or x.status <> 'open' then raise exception 'この交代はもう受け付けていません'; end if;   -- 募集中でなければ止める
  if x.from_member_id = me_id then raise exception '自分の勤務には代われません'; end if;   -- 自分の勤務なら止める
  if exists(select 1 from assignments a where a.member_id = me_id and a.date = x.date and a.from_min < x.to_min and x.from_min < a.to_min) then   -- 同じ時間に勤務があれば
    raise exception '同じ時間にほかの勤務が入っています';   -- 止める
  end if;   -- ここまで
  update swaps set status = 'taken', taker_id = me_id where id = x.id;   -- 引き受けた状態にする
  select name into me_name from members where id = me_id;   -- 自分の名前
  insert into notifications(member_id, text)   -- お知らせを足す
    select id, to_char(x.date, 'FMMM/FMDD') || ' の交代：' || me_name || 'さんが代わると言っています（承認待ち）'   -- 「11/9 の交代：〇〇さんが代わると言っています」
    from members where company_id = my_company() and role = 'manager' and active;   -- 会社の店長たちに
  return json_build_object('id', x.id, 'status', 'taken');   -- 結果を返す
end $$;   -- 終わり

-- 募集に「入れます」／取り消し（店員）
create or replace function answer_call(p_call_id text, p_yes boolean) returns boolean   -- 募集に返事する関数
language plpgsql security definer set search_path = public as $$   -- 表のルールをこえて動く
declare   -- 使う変数
  me_id text := my_member_id();   -- ログイン中の人
  c calls;                        -- その募集
  next_answers jsonb;             -- 新しい返事の一覧
begin   -- 始まり
  select * into c from calls where id = p_call_id;   -- 募集を探す
  if c.id is null or c.status <> 'open' then raise exception 'この募集はもう終わりました'; end if;   -- 終わっていれば止める
  if not (c.candidate_ids ? me_id) then raise exception 'この募集には返事できません'; end if;   -- 候補でなければ止める
  select coalesce(jsonb_agg(a), '[]'::jsonb) into next_answers   -- 前の自分の返事を外す
    from jsonb_array_elements(c.answers) a where a->>'memberId' <> me_id;   -- 返事の一覧から
  if p_yes then next_answers := next_answers || jsonb_build_array(jsonb_build_object('memberId', me_id, 'at', now())); end if;   -- 入れますなら足す
  update calls set answers = next_answers where id = c.id;   -- 保存
  return true;   -- できた
end $$;   -- 終わり

grant execute on function issue_login_code(text), take_swap(text), answer_call(text, boolean),   -- ログインした人が関数を使えるように
  my_member_id(), my_company(), i_am_manager(), store_in_my_company(text), member_in_my_company(text), period_published(text)   -- 使える関数
  to authenticated;   -- ログインした人に
