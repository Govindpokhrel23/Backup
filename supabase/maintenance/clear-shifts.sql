-- ============================================================
-- supabase/maintenance/clear-shifts.sql — シフトと希望を全部消す（2026年11月22日）
-- ------------------------------------------------------------
-- このファイルは、本番を使い始める前などに、前のシフト・希望を全部消すためのSQLのファイルです。
-- Supabase → SQL Editor に貼って「Run」を1回押す。消すと元に戻せない。
--
-- 消すもの：週・勤務・希望・人が足りない時の募集・「見ました」・交代・お知らせ・AIの下書き（全店舗）
-- 残すもの：スタッフ・アカウント・店舗・営業時間・必要人数・時給・ルール・AIの学び・通知の宛先
-- ============================================================

begin;   -- まとめて1回で消す（途中で失敗したら何も消さない）

delete from swaps;            -- 交代
delete from calls;            -- 人が足りない時の募集
delete from confirms;         -- 「見ました」
delete from ai_drafts;        -- AIの下書き
delete from assignments;      -- 勤務（シフト）
delete from periods;          -- 週
delete from availabilities;   -- 希望
delete from notifications;    -- お知らせ

commit;   -- 消すのを決める

-- 消えたか確かめる（全部 0 ならOK）
select
  (select count(*) from periods)        as "週",
  (select count(*) from assignments)    as "勤務",
  (select count(*) from availabilities) as "希望",
  (select count(*) from calls)          as "募集",
  (select count(*) from notifications)  as "お知らせ",
  (select count(*) from members)        as "スタッフ（残す）";
