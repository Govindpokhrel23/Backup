// ============================================================
// lib/breaks.js — 休憩の目安（○）の決まり
// ------------------------------------------------------------
// ・朝11:00より前には休憩を入れない（CONFIG.BREAK_EARLIEST）
// ・勤務の始まりと終わりの15分の中には入れない
// ・AIの下書き、右の欄の「休憩○」ボタン、○のドラッグで同じ決まりを使う
// ============================================================

import { CONFIG } from "../config.js";
import { snap } from "./time.js";

/** 休憩を置ける一番早い時刻と一番おそい時刻（置けなければ null） */
export function breakWindow(from, to) {
  const earliest = Math.max(from + 15, CONFIG.BREAK_EARLIEST);
  const latest = to - 15;
  return earliest <= latest ? { earliest, latest } : null;
}

/** 時刻を、休憩を置ける範囲に収める（置けなければ null） */
export function clampBreak(from, to, minute) {
  const w = breakWindow(from, to);
  if (!w) return null;
  return Math.max(w.earliest, Math.min(w.latest, snap(minute)));
}

/** ふつうの休憩の位置：勤務の真ん中（11:00より前なら11:00） */
export function defaultBreak(from, to) {
  return clampBreak(from, to, (from + to) / 2);
}
