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
export const STEP = 15;

/** 店長が選べる時刻のはば（5:00 〜 翌2:00。紙のシフト表も翌2時まである） */
export const EDIT_MIN = 5 * 60;
export const EDIT_MAX = 26 * 60;   // 一番おそい時刻（翌2:00）

/** 分 → "9:00" の文字（24時をこえたら "翌1:00"） */
export function fmt(minutes) {
  const hours = Math.floor(minutes / 60);   // 時
  const restMinutes = minutes % 60;   // 分
  const mm = String(restMinutes).padStart(2, "0");   // 分（2けた）
  return hours > 24 || (hours === 24 && restMinutes > 0) ? `翌${hours - 24}:${mm}` : `${hours}:${mm}`;
}

/** "9:00" の文字 → 分 */
export function parse(text) {
  const [hours, minutes] = text.split(":").map(Number);   // 時と分
  return hours * 60 + minutes;
}

/** 15分刻みにそろえる（ドラッグした時などに使う） */
export function snap(minutes) {
  return Math.round(minutes / STEP) * STEP;
}

/** "9:00〜15:00" の形 */
export function range(from, to) {
  return `${fmt(from)}〜${fmt(to)}`;
}

/** 勤務の長さ（分） */
export function length(from, to) {
  return to - from;
}

/** 2つの時間帯が重なっているか */
export function overlaps(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * セレクトボックス用の時刻の一覧を作る
 * @returns {{value:number,label:string}[]}
 */
export function timeOptions(from = 420, to = 1320) {
  const list = [];   // 時刻の一覧
  for (let minutes = from; minutes <= to; minutes += STEP) list.push({ value: minutes, label: fmt(minutes) });
  return list;
}
