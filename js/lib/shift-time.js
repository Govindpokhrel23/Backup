// ============================================================
// lib/shift-time.js — 勤務の時刻は「1時間ごと」（2026年11月17日）
// ------------------------------------------------------------
// このファイルは、勤務の始まり・終わりを「ちょうどの時刻（9:00・10:00…）」にそろえるファイルです。
// ・始まりも終わりも、分は入れない（6:30・9:15 などにしない）
// ・ただし立ち上げの人だけは、開店の30分前から入る（7:00開店なら 6:30〜）
//   立ち上げの人の終わりは、始まりから「ちょうど○時間」（6:30〜15:30 など）
// ・そろえる時は「短くなる方」に動かす（始まりは後ろへ、終わりは前へ）
//   → 希望の時間・ほかの店舗の勤務からはみ出さない
// AIの下書き（ai/validate.js）・簡易版の下書き（ai/simple-draft.js）・線のドラッグ（components/timeline.js）で使う
// ============================================================

import { openStart } from "./roles.js";   // 立ち上げの人が入る時刻（開店−30分）を読む

/** 1時間（分） */
const HOUR = 60;   // 60分

/**
 * 始まりの時刻をそろえる
 * @param {number} from 始まり（分）
 * @param {{open:number}|null} hours その日の営業時間（立ち上げの時刻を知るため）
 * @param {"up"|"near"} [how] up＝後ろへ（短くなる方）／near＝いちばん近い方
 */
export function startTime(from, hours, how = "up") {   // 始まりをそろえる関数
  const opener = hours ? openStart(hours) : null;   // 立ち上げの時刻（例 6:30）
  if (opener != null && opener % HOUR !== 0) {   // 立ち上げが「分」のある時刻なら
    if (from === opener) return opener;   // ちょうど立ち上げの時刻はそのまま
    if (how === "near" && Math.abs(from - opener) < HOUR / 2) return opener;   // ドラッグで近くなら立ち上げの時刻に
  }
  return how === "near" ? Math.round(from / HOUR) * HOUR : Math.ceil(from / HOUR) * HOUR;   // ちょうどの時刻に
}

/**
 * 終わりの時刻をそろえる
 * @param {number} to   終わり（分）
 * @param {number} from そろえた始まり（分）
 * @param {"down"|"near"} [how] down＝前へ（短くなる方）／near＝いちばん近い方
 */
export function endTime(to, from, how = "down") {   // 終わりをそろえる関数
  const base = from % HOUR;   // 始まりの「分」（立ち上げの人だけ 30 など。ほかは 0）
  const steps = (to - from) / HOUR;   // 始まりから何時間か
  if (base && how === "near") return from + Math.max(1, Math.round(steps)) * HOUR;   // 立ち上げの人は始まりから「ちょうど○時間」
  if (base) return from + Math.floor(steps) * HOUR;   // 立ち上げの人（短くなる方）
  return how === "near" ? Math.round(to / HOUR) * HOUR : Math.floor(to / HOUR) * HOUR;   // ほかの人はちょうどの時刻
}

/**
 * 勤務の一覧の時刻をそろえる（固定した勤務はそのまま。短くなりすぎた勤務は外す）
 * @param {object[]} rows 勤務の一覧
 * @param {(date:string)=>{open:number,close:number}} hoursOf その日の営業時間
 * @param {(from:number,to:number,breakAt:number|null)=>number|null} fixBreak 休憩を中に入れ直す関数
 * @returns {object[]} そろえた勤務
 */
export function hourlyRows(rows, hoursOf, fixBreak) {   // 一覧をそろえる関数
  return rows.flatMap((row) => {   // 1つずつ
    if (row.fixed) return [row];   // 固定はそのまま
    const from = startTime(row.from, hoursOf(row.date));   // 始まり
    const to = endTime(row.to, from);   // 終わり
    if (to - from < HOUR) return [];   // 1時間より短くなったら外す
    if (from === row.from && to === row.to) return [row];   // 変わらなければそのまま
    return [{ ...row, from, to, breakAt: row.breakAt == null ? null : fixBreak(from, to, row.breakAt) }];   // そろえた勤務（休憩も中に入れ直す）
  });
}
