// ============================================================
// lib/roles.js — 「立ち上げ」「締め」の決まり（2026年11月4日）
// ------------------------------------------------------------
// ・立ち上げは1人。開店の30分前から入る（7:00開店なら6:30から）
//   → 開店30分前（またはそれより前）から入っている人のうち、いちばん早い1人＝立ち上げ
// ・締め：閉店の時刻（またはそれより後）まで入っている人
// ・シフト表の「立」「締」、その日の一覧、ルールチェック、AI下書きが全部ここを使う
// ============================================================

import { CONFIG } from "../config.js";

/** 立ち上げの人が入る時刻（開店 − 30分） */
export function openStart(hours) {
  return hours.open - CONFIG.OPEN_PREP_MIN;
}

/**
 * その日の立ち上げの勤務（1人だけ）。いなければ null
 * @param {object[]} dayAssignments その日の勤務（この店舗）
 * @param {{open:number,close:number}} hours その日の営業時間
 */
export function openerOf(dayAssignments, hours) {
  const start = openStart(hours);
  return [...dayAssignments]
    .filter((a) => a.from <= start)
    .sort((a, b) => a.from - b.from)[0] || null;
}

/** 締めの人か */
export function isCloser(a, hours) {
  return a.to >= hours.close;
}

/** 「立」「締」の印（例 ["立"]） */
export function roleMarks(a, dayAssignments, hours) {
  if (!hours) return [];
  return [openerOf(dayAssignments, hours) === a ? "立" : null, isCloser(a, hours) ? "締" : null].filter(Boolean);
}
