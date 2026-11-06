// ============================================================
// lib/roles.js — 「立ち上げ」「締め」の決まり（2026年11月4日）
// ------------------------------------------------------------
// このファイルは、「立ち上げ」「締め」の決まり（2026年11月4日）のファイルです。
// ・立ち上げは1人。開店の30分前から入る（7:00開店なら6:30から）
//   → 開店30分前（またはそれより前）から入っている人のうち、いちばん早い1人＝立ち上げ
// ・締め：閉店の時刻（またはそれより後）まで入っている人
// ・シフト表の「立」「締」、その日の一覧、ルールチェック、AI下書きが全部ここを使う
// ============================================================

import { CONFIG } from "../config.js";   // 設定（開店前の準備の分数）を読む

/** 立ち上げの人が入る時刻（開店 − 30分） */
export function openStart(hours) {   // 立ち上げの人が来る時間を出す関数
  return hours.open - CONFIG.OPEN_PREP_MIN;   // 開店の時間から30分前
}

/**
 * その日の立ち上げの勤務（1人だけ）。いなければ null
 * @param {object[]} dayAssignments その日の勤務（この店舗）
 * @param {{open:number,close:number}} hours その日の営業時間
 */
export function openerOf(dayAssignments, hours) {   // その日の立ち上げの人を探す関数
  const start = openStart(hours);   // 立ち上げの人が入る時刻
  return [...dayAssignments]   // その日の勤務を写して
    .filter((dayAssignment) => dayAssignment.from <= start)   // 立ち上げの時間までに来る人だけ
    .sort((shiftA, shiftB) => shiftA.from - shiftB.from)[0] || null;   // 一番早く来る人。いなければ null
}

/** 締めの人か */
export function isCloser(shift, hours) {   // 締め（閉店まで）の人か調べる関数
  return shift.to >= hours.close;   // 閉店の時間までいれば締め
}

/** 「立」「締」の印（例 ["立"]） */
export function roleMarks(shift, dayAssignments, hours) {   // 勤務に付ける印（立・締）を出す関数
  if (!hours) return [];   // 営業時間がなければ印なし
  return [openerOf(dayAssignments, hours) === shift ? "立" : null, isCloser(shift, hours) ? "締" : null].filter(Boolean);   // 立ち上げなら「立」、締めなら「締」。ないものは消す
}
