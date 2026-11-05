// ============================================================
// lib/history.js — 「元に戻す」「やり直す」
// ------------------------------------------------------------
// このファイルは、「元に戻す」「やり直す」のファイルです。
// 変える前の状態を写真のように保存しておき、
// 「元に戻す」で1つ前の写真に戻す。
//
// 使い方：
//   const history = createHistory();
//   history.push(work);            // 変える前に呼ぶ
//   work = history.undo(work);     // 元に戻す（戻せなければ null）
//   work = history.redo(work);     // やり直す（できなければ null）
// ============================================================

/** @param {number} limit いくつ前まで戻れるか */
export function createHistory(limit = 50) {
  const past = [];     // 前の状態（新しいものが最後）
  const future = [];   // 「元に戻す」で取り消した状態

  const snap = (x) => JSON.stringify(x);   // 文字にして保存（あとで変えられても影響しない）

  return {
    /** 変える前の状態を覚える */
    push(state) {
      past.push(snap(state));
      if (past.length > limit) past.shift();
      future.length = 0;                   // 新しく変えたら「やり直す」はできなくなる
    },
    /** 1つ前に戻す */
    undo(current) {
      if (!past.length) return null;
      future.push(snap(current));
      return JSON.parse(past.pop());
    },
    /** 戻したのをやり直す */
    redo(current) {
      if (!future.length) return null;
      past.push(snap(current));
      return JSON.parse(future.pop());
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    /** 週を変えた時などに全部忘れる */
    clear() { past.length = 0; future.length = 0; },
  };
}
