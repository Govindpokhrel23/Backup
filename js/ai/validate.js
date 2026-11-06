// ============================================================
// ai/validate.js — AIの答えを「そのまま使ってよい形」に直す
// ------------------------------------------------------------
// このファイルは、Gemini から返ってきた勤務の一覧をひとつずつ確かめて、
// おかしいものを外したり、直したりするファイルです（2026年11月5日）。
// AIはときどきまちがえるので、ここで必ず確かめてから画面に出す。
//
// 確かめること：
//   ・知らない人（S99 など）・その週ではない日 → 外す
//   ・時刻の形がおかしい、終わりが始まりより前、1時間より短い → 外す
//   ・時刻は15分きざみ・5:00〜翌2:00 にそろえる
//   ・休み希望の日 → 外す。時間の希望がある人は、その中に縮める
//   ・バイトで希望を出していない日 → 外す
//   ・同じ人の時間が重なる、ほかの店舗の勤務と重なる → 外す
//   ・固定した勤務は、AIが何を言っても元のまま
//   ・休憩：長い勤務は、休憩の決まり（11:00より前はだめ など）に合わせる
// ============================================================

import { snap, overlaps, EDIT_MIN, EDIT_MAX, range } from "../lib/time.js";
import { clampBreak, defaultBreak } from "../lib/breaks.js";
import { CONFIG } from "../config.js";
import { label } from "../lib/date.js";
import { clipForMinor } from "../rules/labor-rules.js";

/** "06:30" → 390（分）。形がおかしければ null */
export function toMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());    // 時と分に分ける
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);   // 時×60＋分
  return Number.isFinite(minutes) ? minutes : null;
}

/** 休みとみなす希望 */
const OFF_KINDS = ["no", "off", "offx"];

/**
 * AIの勤務の一覧を確かめる
 * @param {object[]} raw  AIの答えの shifts
 * @param {object} ctx    draft-service.js の ctx（members・dates・availabilities・elsewhere・fixed）
 * @param {Map<string,string>} toId  S1 → 店員のID
 * @returns {{rows:object[], dropped:string[]}} 使える勤務 と 外した理由
 */
export function cleanShifts(raw, ctx, toId) {
  const rows = ctx.fixed.map((shift) => ({ ...shift }));                       // 固定した勤務は最初から入れる
  const dropped = [];                                                  // 外した理由（画面に出す）
  /** IDから名前 */
  const nameOf = (id) => ctx.members.find((member) => member.id === id)?.name || "？";
  const dates = new Set(ctx.dates);                                    // その週の日付

  for (const aiShift of Array.isArray(raw) ? raw : []) {
    const memberId = toId.get(String(aiShift.staff || "").trim());           // S1 → ID
    const member = ctx.members.find((member) => member.id === memberId);         // その人
    if (!member) { dropped.push(`知らない人（${aiShift.staff}）の勤務を外しました`); continue; }
    if (!dates.has(aiShift.date)) { dropped.push(`${member.name}：この週ではない日（${aiShift.date}）を外しました`); continue; }
    const where = `${member.name} ${label(aiShift.date)}`;                   // 理由の文の頭

    // ---- 時刻 ----
    let from = toMinutes(aiShift.start);                                     // 始まり（分）
    let to = toMinutes(aiShift.end);                                         // 終わり（分）
    if (from == null || to == null) { dropped.push(`${where}：時刻の形がおかしいので外しました`); continue; }
    from = Math.max(EDIT_MIN, snap(from));
    to = Math.min(EDIT_MAX, snap(to));

    // ---- 固定した勤務がある人と日は、AIの勤務を使わない（固定のまま） ----
    if (rows.some((row) => row.fixed && row.memberId === memberId && row.date === aiShift.date)) continue;

    // ---- 希望 ----
    const hope = ctx.availabilities.find((hope) => hope.memberId === memberId && hope.date === aiShift.date);   // その日の希望
    if (hope && OFF_KINDS.includes(hope.kind)) { dropped.push(`${where}：休み希望の日なので外しました`); continue; }
    if (!hope && member.kind !== "shain") { dropped.push(`${where}：希望を出していない日なので外しました`); continue; }
    if (hope?.kind === "time") {
      // 希望の時間の中に縮める（短く入れるのはよい）
      from = Math.max(from, hope.from);
      to = Math.min(to, hope.to);
    }
    // 18歳未満の人は 5:00〜22:00 に縮める（法律の決まり。rules/labor-rules.js）
    if (member.minor) ({ from, to } = clipForMinor(from, to));
    if (to - from < 60) { dropped.push(`${where}：短すぎる（または希望・18歳未満の時間の外）ので外しました`); continue; }
    // 月・年の上限：この週に入れてよい残りの時間をこえたら外す
    if (member.leftMinutes != null) {
      const used = rows.filter((row) => row.memberId === memberId).reduce((sum, row) => sum + (row.to - row.from), 0);   // もう入れた分
      if (used + (to - from) > member.leftMinutes) { dropped.push(`${where}：月・年の上限をこえるので外しました`); continue; }
    }

    // ---- 重なり ----
    if (rows.some((row) => row.memberId === memberId && row.date === aiShift.date && overlaps(row.from, row.to, from, to))) {
      dropped.push(`${where}：同じ人の時間が重なるので外しました`); continue;
    }
    if ((ctx.elsewhere || []).some((shift) => shift.memberId === memberId && shift.date === aiShift.date && overlaps(shift.from, shift.to, from, to))) {
      dropped.push(`${where}：ほかの店舗の勤務と重なるので外しました`); continue;
    }

    // ---- 場所と休憩 ----
    const area = aiShift.area === "kitchen" || aiShift.area === "hall"
      ? aiShift.area : (member.skills?.kitchen > member.skills?.hall ? "kitchen" : "hall");
    let breakAt = null;                                                // 休憩の時刻
    if (to - from >= CONFIG.BREAK_NEEDED_MIN) {
      const asked = toMinutes(aiShift.break);                                // AIが決めた休憩
      breakAt = asked != null ? clampBreak(from, to, asked) : defaultBreak(from, to);
    }

    rows.push({
      memberId, date: aiShift.date, from, to, area, breakAt,
      fixed: false, createdBy: "ai", requested: false,
      helper: (member.rankHere ?? 1) > 1,
      reason: String(aiShift.reason || "").slice(0, 60),                     // 理由（画面の「なぜ？」に出す）
    });
  }
  return { rows, dropped };
}

/** 外した理由を短くまとめる（同じ文は1つにする） */
export function droppedSummary(dropped) {
  return [...new Set(dropped)];
}

/** 勤務の1行の説明（例「スタッフA 11/9（月） 6:30〜15:30」） */
export function rowText(shift, members) {
  return `${members.find((member) => member.id === shift.memberId)?.name || "？"} ${label(shift.date)} ${range(shift.from, shift.to)}`;
}
