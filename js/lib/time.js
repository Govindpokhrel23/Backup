// ============================================================
// lib/time.js — 時刻の計算
// ------------------------------------------------------------
// このアプリでは時刻を「その日の0:00から何分か」で持つ（設計書6章）
//   7:00  → 420
//   22:00 → 1320
//   翌1:00 → 1500（日付をまたぐ勤務もこのまま扱える）
// 数字なので、足し算・引き算・比べるのがかんたん。
// ============================================================

/** 時間の細かさ（15分刻み） */
export const STEP = 15;

/** 分 → "9:00" の文字 */
export function fmt(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "9:00" の文字 → 分 */
export function parse(text) {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
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
  const list = [];
  for (let m = from; m <= to; m += STEP) list.push({ value: m, label: fmt(m) });
  return list;
}
