// ============================================================
// lib/period.js — 「受付（週）」の小さな道具
// ------------------------------------------------------------
// このファイルは、「受付（週）」の小さな道具のファイルです。
// 受付（period）＝1週間分のシフトのまとまり。状態は3つ：
//   open      … 受付中（店員が希望を出せる）
//   closed    … 締切（店長がシフトを作っている）
//   published … 公開（みんなが見られる）
// ============================================================

import { addDays, label, shortLabel, weekDates } from "./date.js";

export const STATUS_LABEL = {   // 受付の状態 → 画面に出す名前
  open: "受付中",
  closed: "締切（作成中）",
  published: "公開済み",
};

/** "11/9（月）〜 11/15（日）" の形 */
export function weekLabel(period) {
  return `${label(period.weekStart)} 〜 ${label(addDays(period.weekStart, 6))}`;
}

/** "11/9〜11/15" の短い形 */
export function weekShort(period) {
  return `${shortLabel(period.weekStart)}〜${shortLabel(addDays(period.weekStart, 6))}`;
}

/** その週の7日分 */
export function datesOf(period) {
  return weekDates(period.weekStart);
}

/** 締切 "2026-11-08T24:00" → "11/8（日）24:00" */
export function deadlineLabel(period) {
  const [date, time] = period.deadline.split("T");   // 締切の日付と時刻
  return `${label(date)} ${time}`;
}

/** 受付中の週（なければ null） */
export function openPeriod(periods) {
  return periods.find((period) => period.status === "open") || null;
}

/** 店長が次に作る週（締切 → 受付中 → いちばん新しい の順で探す） */
export function workingPeriod(periods) {
  return periods.find((period) => period.status === "closed")
    || periods.find((period) => period.status === "open")
    || periods[periods.length - 1]
    || null;
}
