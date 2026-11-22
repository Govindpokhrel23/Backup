-- ============================================================
-- supabase/maintenance/clear-staff.sql — 店長以外のスタッフと、シフト・希望を全部消す（2026年11月22日）
-- ------------------------------------------------------------
-- このファイルは、本番を使い始める前に、テストで作ったスタッフとシフトを全部消すためのSQLのファイルです。
-- Supabase → SQL Editor に貼って「Run」を1回押す。消すと元に戻せない。
--
-- 消すもの：店長・開発者以外のスタッフ（ログインのアカウントも）、その人の時給・ルール・AIの学び・初回コード・通知の宛先
--           週・勤務・希望・募集・「見ました」・交代・お知らせ・AIの下書き（全店舗）
-- 残すもの：店長・開発者、店舗・営業時間・必要人数、店長・開発者の時給とAIの学び
-- ============================================================

begin;   -- まとめて1回で消す（途中で失敗したら何も消さない）

-- 消す人（店長でも開発者でもない人）を、先にメモしておく
create temporary table gone on commit drop as   -- この中だけで使う表
  select id, auth_id, login_id from members where role <> 'manager' and developer = false;   -- 消す人

-- ① シフトと希望（全店舗）
delete from swaps;            -- 交代
delete from calls;            -- 人が足りない時の募集
delete from confirms;         -- 「見ました」
delete from ai_drafts;        -- AIの下書き
delete from assignments;      -- 勤務（シフト）
delete from periods;          -- 週
delete from availabilities;   -- 希望
delete from notifications;    -- お知らせ

-- ② 消す人のほかのデータ
delete from learnings   where member_id in (select id from gone);         -- AIの学び
delete from login_codes where login_id  in (select login_id from gone);   -- 初回コード
-- 時給・ルール・通知の宛先は、スタッフを消すと一緒に消える（on delete cascade）

-- ③ スタッフと、ログインのアカウント
delete from members where id in (select id from gone);   -- スタッフ
delete from auth.users where id in (select auth_id from gone where auth_id is not null);   -- ログインのアカウント

commit;   -- 消すのを決める

-- 残ったか確かめる（「スタッフ」に店長・開発者だけ、ほかは 0 ならOK）
select
  (select string_agg(name || '（' || login_id || '）', '、' order by login_id) from members) as "残ったスタッフ",
  (select count(*) from periods)        as "週",
  (select count(*) from assignments)    as "勤務",
  (select count(*) from availabilities) as "希望";
