// ============================================================
// lib/period.js — 「受付（週）」の小さな道具
// ------------------------------------------------------------
// このファイルは、「受付（週）」の小さな道具のファイルです。
// 受付（period）＝1週間分のシフトのまとまり。状態は3つ：
//   open      … 受付中（店員が希望を出せる）
//   closed    … 締切（店長がシフトを作っている）
//   published … 公開（みんなが見られる）
// ============================================================

import { addDays, label, shortLabel, weekDates, today } from "./date.js";   // 日付の道具を読む

export const STATUS_LABEL = {   // 受付の状態 → 画面に出す名前
  open: "受付中",   // 希望を受け付けている
  closed: "締切（作成中）",   // 締め切って店長が作っている
  published: "公開済み",   // みんなに公開した
};

/** "11/9（月）〜 11/15（日）" の形 */
export function weekLabel(period) {   // 「11/9（月）〜11/15（日）」を作る関数
  return `${label(period.weekStart)} 〜 ${label(addDays(period.weekStart, 6))}`;   // 週の始まりと6日後をつなぐ
}

/** "11/9〜11/15" の短い形 */
export function weekShort(period) {   // 短い形「11/9〜11/15」を作る関数
  return `${shortLabel(period.weekStart)}〜${shortLabel(addDays(period.weekStart, 6))}`;   // 週の始まりと6日後をつなぐ
}

/** その週の7日分 */
export function datesOf(period) {   // その週の7日を出す関数
  return weekDates(period.weekStart);   // 週の始まりから7日
}

/** 締切 "2026-11-08T24:00" → "11/8（日）24:00" */
export function deadlineLabel(period) {   // 締め切りの日時の文字を作る関数
  const [date, time] = period.deadline.split("T");   // 締切の日付と時刻
  return `${label(date)} ${time}`;   // 日付と時間をつなぐ
}

/** その週がもう終わったか（日曜日が今日より前） */
export function isPast(period) {   // 終わった週か調べる関数
  return addDays(period.weekStart, 6) < today();   // 日曜日が昨日以前なら終わった週
}

/** 受付中の週（終わった週はのぞく。なければ null。2026年11月17日：過ぎた週を出さない） */
export function openPeriod(periods) {   // 受付中の週を探す関数
  return byStart(periods).find((period) => period.status === "open" && !isPast(period)) || null;   // なければ null
}

/**
 * まだシフトができていない週（ホームに出す。2026年11月17日）
 * 公開していない週のうち、終わっていない、いちばん近い週。なければ null
 */
export function pendingPeriod(periods) {   // できていない週を探す関数
  return byStart(periods).find((period) => period.status !== "published" && !isPast(period)) || null;   // なければ null
}

/** 週を始まりの早い順に並べる（元の並びは変えない） */
function byStart(periods) {   // 早い順に並べる関数
  return [...periods].sort((first, second) => first.weekStart.localeCompare(second.weekStart));   // 週の始まりで比べる
}

/** 店長が次に作る週（締切 → 受付中 → いちばん新しい の順で探す） */
export function workingPeriod(periods) {   // 店長が作る週を選ぶ関数
  return periods.find((period) => period.status === "closed")   // まず締め切った週
    || periods.find((period) => period.status === "open")   // なければ受付中の週
    || periods[periods.length - 1]   // なければ一番新しい週
    || null;   // 何もなければ null
}
