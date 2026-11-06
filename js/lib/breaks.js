// ============================================================
// lib/breaks.js — 休憩の目安（○）の決まり
// ------------------------------------------------------------
// このファイルは、休憩の目安（○）の決まりのファイルです。
// ・朝11:00より前には休憩を入れない（CONFIG.BREAK_EARLIEST）
// ・勤務の始まりと終わりの15分の中には入れない
// ・AIの下書き、右の欄の「休憩○」ボタン、○のドラッグで同じ決まりを使う
// ============================================================

import { CONFIG } from "../config.js";   // 設定（休憩の決まりの数字）を読む
import { snap } from "./time.js";   // 時間を15分きざみにそろえる道具を読む

/** 休憩を置ける一番早い時刻と一番おそい時刻（置けなければ null） */
export function breakWindow(from, to) {   // 休憩を置いてよい時間のはばを出す関数
  const earliest = Math.max(from + 15, CONFIG.BREAK_EARLIEST);   // 一番早い時刻（勤務の15分後か11:00のおそい方）
  const latest = to - 15;   // 一番おそい時刻（終わりの15分前）
  return earliest <= latest ? { earliest, latest } : null;   // はばがあれば返す。なければ null（休憩なし）
}

/** 時刻を、休憩を置ける範囲に収める（置けなければ null） */
export function clampBreak(from, to, minute) {   // 休憩の時間を、置いてよいはばの中に入れる関数
  const range = breakWindow(from, to);   // 置ける範囲
  if (!range) return null;   // 休憩を置けない勤務なら null
  return Math.max(range.earliest, Math.min(range.latest, snap(minute)));   // はばの中に入るように、早すぎ・遅すぎを直す
}

/** ふつうの休憩の位置：勤務の真ん中（11:00より前なら11:00） */
export function defaultBreak(from, to) {   // 休憩のはじめの位置（真ん中）を決める関数
  return clampBreak(from, to, (from + to) / 2);   // 勤務の真ん中をはばの中に入れて返す
}
