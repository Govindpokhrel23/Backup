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
export function createHistory(limit = 50) {   // 「元に戻す・やり直し」の記録を作る関数（最大50回）
  const past = [];     // 前の状態（新しいものが最後）
  const future = [];   // 「元に戻す」で取り消した状態

  const snap = (value) => JSON.stringify(value);   // 文字にして保存（あとで変えられても影響しない）

  return {   // 使える操作をまとめて返す
    /** 変える前の状態を覚える */
    push(state) {   // 今の状態を記録する
      past.push(snap(state));   // 前の状態の列に足す
      if (past.length > limit) past.shift();   // 多すぎたら一番古いものを捨てる
      future.length = 0;                   // 新しく変えたら「やり直す」はできなくなる
    },
    /** 1つ前に戻す */
    undo(current) {   // 1つ前に戻す
      if (!past.length) return null;   // 戻せるものがなければ null
      future.push(snap(current));   // 今の状態を「やり直し」用にとっておく
      return JSON.parse(past.pop());   // 1つ前の状態を取り出して返す
    },
    /** 戻したのをやり直す */
    redo(current) {   // 戻したものをやり直す
      if (!future.length) return null;   // やり直せるものがなければ null
      past.push(snap(current));   // 今の状態を「戻す」用にとっておく
      return JSON.parse(future.pop());   // やり直しの状態を取り出して返す
    },
    canUndo: () => past.length > 0,   // 戻せるか（ボタンを押せるか）
    canRedo: () => future.length > 0,   // やり直せるか
    /** 週を変えた時などに全部忘れる */
    clear() { past.length = 0; future.length = 0; },   // 記録を全部消す
  };
}
