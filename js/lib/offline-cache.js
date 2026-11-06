// ============================================================
// lib/offline-cache.js — 自分のシフトをスマホにも保存する
// ------------------------------------------------------------
// このファイルは、自分のシフトをスマホにも保存するためのファイルです。
// サーバーにつながらない時（電波がない・サーバーが止まっている）でも、
// 自分のシフトだけはホームとカレンダーで見られるようにする。
//
// ・保存するのは「自分の勤務」だけ（ほかの人の情報は保存しない）
// ・2年より前のものは自動で消す
// ・大きさの目安：1回の勤務は約0.2KB → 2年（約500回）でも約100KB。
//   スマホの容量はほとんど使わない
// ============================================================

const KEY = "shiftapp-my-shifts";   // スマホに保存する時の名前
const KEEP_DAYS = 365 * 2;          // 2年

/** 保存してある自分の勤務を読む（なければ空） */
export function readCache(memberId) {   // しまった自分のシフトを読む関数
  try {   // 読めない時に止まらないように
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");   // 保存してある中身
    // 別の人のデータは使わない（memberId が分からない時＝サーバーにつながらない時は、この端末の分を使う）
    if (saved && (!memberId || saved.memberId === memberId)) return saved.items;   // 同じ人のものなら中身を返す
  } catch (error) {   // 読めなかった時
    console.warn("スマホの保存を読めませんでした", error);   // 理由を開発者用に残す
  }
  return [];   // 何もなければ空
}

/**
 * サーバーから読めた勤務をスマホに保存する
 * ・同じ勤務は新しい方で上書き、2年より前は消す
 * @returns {object[]} 保存した後の一覧
 */
export function writeCache(memberId, fresh) {   // 新しいシフトをしまう関数
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);   // これより古い日は消す（2年前）
  const byKey = new Map();   // 勤務を1つずつ入れる入れ物（同じ勤務は上書き）
  /** 勤務を見分けるキー */
  const key = (shift) => shift.id || `${shift.date}|${shift.storeId}|${shift.from}`;   // 勤務を見分けるための名前
  for (const shift of readCache(memberId)) byKey.set(key(shift), shift);   // 前にしまったものを並べる
  // サーバーにある日付の分は、サーバーの内容に入れ替える（消えた勤務も消す）
  const freshDates = new Set(fresh.map((shift) => shift.date));   // 新しく読めた日付
  for (const [key, shift] of byKey) if (freshDates.has(shift.date)) byKey.delete(key);   // その日付の古いものは消す（取り消された勤務を残さない）
  for (const shift of fresh) byKey.set(key(shift), shift);   // 新しいものを入れる
  const items = [...byKey.values()].filter((shift) => shift.date >= cutoff);   // 2年以内の勤務
  try {   // 保存できない時に止まらないように
    localStorage.setItem(KEY, JSON.stringify({ memberId, savedAt: new Date().toISOString(), items }));   // 誰の・いつ保存したか・中身をしまう
  } catch (error) {   // 保存できなかった時
    console.warn("スマホに保存できませんでした", error);   // 理由を開発者用に残す
  }
  return items;   // まとめたシフトを返す
}

/** 保存している量（設定画面で見せる） */
export function cacheInfo() {   // しまっている量を調べる関数（設定画面用）
  const raw = localStorage.getItem(KEY) || "";   // 保存してある文字
  let count = 0, savedAt = null;   // 件数と保存した時刻
  try { const saved = JSON.parse(raw || "null"); count = saved?.items?.length || 0; savedAt = saved?.savedAt || null; } catch (error) { /* 読めなければ 0 */ }
  return { count, kb: Math.ceil(new Blob([raw]).size / 1024), savedAt };   // 件数・大きさ（KB）・保存した時間
}
