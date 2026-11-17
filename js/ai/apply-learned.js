// ============================================================
// ai/apply-learned.js — 「覚えた直し方」をAIの答えにも必ず入れる（2026年11月17日）
// ------------------------------------------------------------
// このファイルは、店長が2回以上同じように直したこと（覚えたこと）を、
// Gemini の答えにも必ず反映させるためのファイルです。
//
// なぜ必要か：Gemini には「店長の直し方メモ」を渡しているが、守らないことがある。
//   簡易版の下書き（simple-draft.js）は最初から覚えたことを使うので、AIの答えだけずれないようにする。
// やること（固定した勤務はさわらない）：
//   ・時間：その人・その曜日に「いつもこの時間」と覚えていれば、その時間にする
//           ただし、希望の時間の外・ほかの勤務やほかの店舗と重なる時は変えない（希望とルールが先）
//   ・場所：その人を「いつもこの場所」と覚えていれば、その場所にする（その場所が50%以上できる時だけ）
// ============================================================

import { weekdayOf } from "./learning.js";   // 日付から曜日の番号を出す道具を読む
import { overlaps } from "../lib/time.js";   // 時間が重なるか調べる道具を読む
import { defaultBreak } from "../lib/breaks.js";   // 休憩の目安の位置を決める道具を読む
import { CONFIG } from "../config.js";   // 設定（休憩が必要な長さ）を読む

/**
 * 覚えたことを勤務の一覧に入れる
 * @param {object[]} rows    勤務の一覧（AIの答えを確かめたもの）
 * @param {object}   learned summarize() の結果 { prefer, areaPref }
 * @param {object}   ctx     画面から渡す情報（members, availabilities, elsewhere）
 * @returns {{rows:object[], changed:number}} 直した一覧と、直した数
 */
export function applyLearned(rows, learned, ctx) {   // 覚えたことを入れる関数
  let changed = 0;   // 直した数
  const next = rows.map((row) => ({ ...row }));   // 元の一覧は変えない（写して使う）
  for (const row of next) {   // 1つずつ
    if (row.fixed) continue;   // 固定した勤務はさわらない
    const member = ctx.members.find((each) => each.id === row.memberId);   // その人
    if (!member) continue;   // いなければ何もしない

    // ---- 時間 ----
    const pref = learned.prefer?.get(`${row.memberId}|${weekdayOf(row.date)}`);   // その人・曜日の覚えた時間
    if (pref && (pref.from !== row.from || pref.to !== row.to)) {   // 覚えた時間とちがえば
      const hope = ctx.availabilities.find((each) => each.memberId === row.memberId && each.date === row.date);   // その日の希望
      const inHope = hope?.kind !== "time" || (pref.from >= hope.from && pref.to <= hope.to);   // 希望の時間の中か
      const clash = next.some((other) => other !== row && other.memberId === row.memberId && other.date === row.date && overlaps(other.from, other.to, pref.from, pref.to))   // 同じ人のほかの勤務と重なるか
        || (ctx.elsewhere || []).some((shift) => shift.memberId === row.memberId && shift.date === row.date && overlaps(shift.from, shift.to, pref.from, pref.to));   // ほかの店舗と重なるか
      if (inHope && !clash && pref.to > pref.from) {   // 入れてよければ
        row.from = pref.from; row.to = pref.to;   // 覚えた時間にする
        row.breakAt = pref.to - pref.from >= CONFIG.BREAK_NEEDED_MIN ? defaultBreak(pref.from, pref.to) : null;   // 休憩も入れ直す
        changed++;   // 数える
      }
    }

    // ---- 場所 ----
    const area = learned.areaPref?.get(row.memberId);   // いつもの場所
    if (area && area !== row.area && (member.skills?.[area] ?? 0) >= 50) { row.area = area; changed++; }   // できる場所なら変える
  }
  return { rows: next, changed };   // 直した一覧と数を返す
}
