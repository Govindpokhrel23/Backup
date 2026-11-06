// ============================================================
// lib/time.js — 時刻の計算
// ------------------------------------------------------------
// このファイルは、時刻の計算のファイルです。
// このアプリでは時刻を「その日の0:00から何分か」で持つ（設計書6章）
//   7:00  → 420
//   22:00 → 1320
//   翌1:00 → 1500（日付をまたぐ勤務もこのまま扱える）
// 数字なので、足し算・引き算・比べるのがかんたん。
// ============================================================

/** 時間の細かさ（15分刻み） */
export const STEP = 15;   // 時間のきざみ（15分）

/** 店長が選べる時刻のはば（5:00 〜 翌2:00。紙のシフト表も翌2時まである） */
export const EDIT_MIN = 5 * 60;   // 編集できる時間の始まり（朝5時）
export const EDIT_MAX = 26 * 60;   // 一番おそい時刻（翌2:00）

/** 分 → "9:00" の文字（24時をこえたら "翌1:00"） */
export function fmt(minutes) {   // 分を「9:00」の形にする関数
  const hours = Math.floor(minutes / 60);   // 時
  const restMinutes = minutes % 60;   // 分
  const mm = String(restMinutes).padStart(2, "0");   // 分（2けた）
  return hours > 24 || (hours === 24 && restMinutes > 0) ? `翌${hours - 24}:${mm}` : `${hours}:${mm}`;   // 24時をこえたら「翌1:00」の形にする
}

/** "9:00" の文字 → 分 */
export function parse(text) {   // 「9:30」を分（570）にする関数
  const [hours, minutes] = text.split(":").map(Number);   // 時と分
  return hours * 60 + minutes;   // 時間×60＋分
}

/** 15分刻みにそろえる（ドラッグした時などに使う） */
export function snap(minutes) {   // 15分きざみにそろえる関数
  return Math.round(minutes / STEP) * STEP;   // 一番近い15分に丸める
}

/** "9:00〜15:00" の形 */
export function range(from, to) {   // 「9:00〜15:00」の形にする関数
  return `${fmt(from)}〜${fmt(to)}`;   // 始まりと終わりをつなぐ
}

/** 勤務の長さ（分） */
export function length(from, to) {   // 長さ（分）を出す関数
  return to - from;   // 終わり−始まり
}

/** 2つの時間帯が重なっているか */
export function overlaps(aFrom, aTo, bFrom, bTo) {   // 2つの時間が重なっているか調べる関数
  return aFrom < bTo && bFrom < aTo;   // お互いに相手の終わりより前に始まっていれば重なり
}

/**
 * セレクトボックス用の時刻の一覧を作る
 * @returns {{value:number,label:string}[]}
 */
export function timeOptions(from = 420, to = 1320) {   // 時間を選ぶリストを作る関数（7:00〜22:00）
  const list = [];   // 時刻の一覧
  for (let minutes = from; minutes <= to; minutes += STEP) list.push({ value: minutes, label: fmt(minutes) });   // 15分ごとに1つ足す
  return list;   // できたリストを返す
}
