// ============================================================
// lib/store-hours.js — 営業時間と「休み・時間の変更」の計算
// ------------------------------------------------------------
// このファイルは、店舗の営業時間を日付ごとに決めるファイルです（2026年11月15日）。
//
// 営業時間のデータの形（stores.hours に入っている）：
//   weekday … 平日の 開店・閉店（分）        例 { open: 420, close: 1320 } ＝ 7:00〜22:00
//   sat     … 土曜の 開店・閉店
//   sun     … 日曜・祝日の 開店・閉店
//   special … 期間を決めた「休み」や「時間の変更」（なければ空）
//             例 { id, from: "2026-12-31", to: "2027-01-02", closed: true,  note: "年末年始" }
//                { id, from: "2026-12-24", to: "2026-12-25", closed: false, open: 540, close: 1080, note: "" }
// 同じ日に2つ以上ある時は、あとから足した方を使う
// ============================================================

import { shortLabel } from "./date.js";   // 日付を「11/9」にする道具を読む
import { range } from "./time.js";   // 「9:00〜15:00」の形にする道具を読む

/** 平日・土曜・日祝の名前 */
export const DAY_TYPE_NAMES = [["weekday", "平日"], ["sat", "土曜"], ["sun", "日曜・祝日"]];   // 日の種類と名前

/**
 * その日に使う「休み・時間の変更」を探す
 * @param {object} storeHours 店舗の営業時間（上の形）
 * @param {string} date       日付 "2026-11-09"
 * @returns {object|null}     見つかった変更（なければ null）
 */
export function specialOn(storeHours, date) {   // その日の変更を探す関数
  const list = storeHours?.special || [];   // 変更の一覧（なければ空）
  for (let index = list.length - 1; index >= 0; index--) {   // あとから足したものを先に見る
    const item = list[index];   // 1つの変更
    if (item.from <= date && date <= item.to) return item;   // 期間の中ならそれを使う
  }
  return null;   // なければ null
}

/**
 * その日の営業時間を出す（「休み・時間の変更」も入れて決める）
 * @param {object} storeHours 店舗の営業時間
 * @param {string} date       日付
 * @param {string} type       日の種類（"weekday" / "sat" / "sun"）
 * @returns {{open:number, close:number, closed:boolean, note:string, changed:boolean}}
 *   closed  … お休みの日なら true（open と close は同じ時刻にする＝必要人数も 0 になる）
 *   changed … いつもとちがう日なら true（休み・時間の変更）
 */
export function hoursOn(storeHours, date, type) {   // その日の営業時間を出す関数
  const base = storeHours?.[type] || { open: 420, close: 1320 };   // いつもの営業時間（なければ 7:00〜22:00）
  const item = specialOn(storeHours, date);   // その日の変更
  if (!item) return { open: base.open, close: base.close, closed: false, note: "", changed: false };   // 変更がなければいつもの時間
  if (item.closed) return { open: base.open, close: base.open, closed: true, note: item.note || "", changed: true };   // お休みの日（開店＝閉店で、営業する時間なし）
  return { open: item.open, close: item.close, closed: false, note: item.note || "", changed: true };   // 時間を変えた日
}

/**
 * 「休み・時間の変更」を1行の文にする
 * 例：「12/31〜1/2 休み（年末年始）」「12/24 9:00〜18:00」
 */
export function specialText(item) {   // 変更を文にする関数
  const days = item.from === item.to ? shortLabel(item.from) : `${shortLabel(item.from)}〜${shortLabel(item.to)}`;   // 1日だけなら日付1つ
  const what = item.closed ? "休み" : range(item.open, item.close);   // 休みか、時間
  return `${days} ${what}${item.note ? `（${item.note}）` : ""}`;   // つないで返す
}

/**
 * 営業時間のデータが正しいか確かめる（保存の前に使う）
 * @returns {string|null} だめな理由（よければ null）
 */
export function checkStoreHours(hours) {   // 営業時間を確かめる関数
  for (const [key, name] of DAY_TYPE_NAMES) {   // 平日・土曜・日祝ごとに
    const day = hours?.[key];   // その日の種類の時間
    if (!day || !(day.close > day.open)) return `${name}：閉店は開店より後にしてください`;   // 閉店が開店より前ならだめ
  }
  for (const item of hours.special || []) {   // 変更ごとに
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(item.to || "")) return "期間の日付を入れてください";   // 日付がなければだめ
    if (item.to < item.from) return "期間の終わりは、始まりと同じか後にしてください";   // 終わりが始まりより前ならだめ
    if (!item.closed && !(item.close > item.open)) return "時間の変更：閉店は開店より後にしてください";   // 時間がおかしければだめ
    if ((item.note || "").length > 30) return "メモは30文字までにしてください";   // メモが長すぎればだめ
  }
  return null;   // 問題なし
}
