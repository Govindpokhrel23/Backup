// ============================================================
// lib/offline-cache.js — 自分のシフトをスマホにも保存する
// ------------------------------------------------------------
// サーバーにつながらない時（電波がない・サーバーが止まっている）でも、
// 自分のシフトだけはホームとカレンダーで見られるようにする。
//
// ・保存するのは「自分の勤務」だけ（ほかの人の情報は保存しない）
// ・2年より前のものは自動で消す
// ・大きさの目安：1回の勤務は約0.2KB → 2年（約500回）でも約100KB。
//   スマホの容量はほとんど使わない
// ============================================================

const KEY = "shiftapp-my-shifts";
const KEEP_DAYS = 365 * 2;          // 2年

/** 保存してある自分の勤務を読む（なければ空） */
export function readCache(memberId) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    // 別の人のデータは使わない（memberId が分からない時＝サーバーにつながらない時は、この端末の分を使う）
    if (saved && (!memberId || saved.memberId === memberId)) return saved.items;
  } catch (e) {
    console.warn("スマホの保存を読めませんでした", e);
  }
  return [];
}

/**
 * サーバーから読めた勤務をスマホに保存する
 * ・同じ勤務は新しい方で上書き、2年より前は消す
 * @returns {object[]} 保存した後の一覧
 */
export function writeCache(memberId, fresh) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const byKey = new Map();
  const key = (a) => a.id || `${a.date}|${a.storeId}|${a.from}`;
  for (const a of readCache(memberId)) byKey.set(key(a), a);
  // サーバーにある日付の分は、サーバーの内容に入れ替える（消えた勤務も消す）
  const freshDates = new Set(fresh.map((a) => a.date));
  for (const [k, a] of byKey) if (freshDates.has(a.date)) byKey.delete(k);
  for (const a of fresh) byKey.set(key(a), a);
  const items = [...byKey.values()].filter((a) => a.date >= cutoff);
  try {
    localStorage.setItem(KEY, JSON.stringify({ memberId, savedAt: new Date().toISOString(), items }));
  } catch (e) {
    console.warn("スマホに保存できませんでした", e);
  }
  return items;
}

/** 保存している量（設定画面で見せる） */
export function cacheInfo() {
  const raw = localStorage.getItem(KEY) || "";
  let count = 0, savedAt = null;
  try { const x = JSON.parse(raw || "null"); count = x?.items?.length || 0; savedAt = x?.savedAt || null; } catch (e) { /* 読めなければ 0 */ }
  return { count, kb: Math.ceil(new Blob([raw]).size / 1024), savedAt };
}
