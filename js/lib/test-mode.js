// ============================================================
// lib/test-mode.js — テストモードの切りかえ
// ------------------------------------------------------------
// このファイルは、開発者が「テストモード」に入る・出るためのファイルです（2026年11月15日）。
// テストモード：このスマホの中だけで、テスト用のデータ（api/test-data.js）を使って動く。
//   本物（Supabase）のデータは読まない・書かない。お店のみんなにも影響しない。
// 切りかえたら、ページを読みなおす（config.js が最初に「テストモードか」を決めるため）。
// ============================================================

import { CONFIG, TEST_MODE_KEY } from "../config.js";   // 設定とテストモードの印の名前を読む

/** 今テストモードか */
export function isTestMode() {   // テストモードか調べる関数
  return CONFIG.TEST_MODE === true;   // 設定を見る
}

/** テストモードに入る（このスマホだけ）→ ログイン画面から始まる */
export function startTestMode() {   // テストモードに入る関数
  try { localStorage.setItem(TEST_MODE_KEY, "1"); } catch { /* 覚えられない時は入れない */ }   // 印をつける
  reloadAt("/login");   // 読みなおす
}

/** テストモードを出て、本番にもどる → ログイン画面から始まる（本番のログインは残っていれば続く） */
export function endTestMode() {   // テストモードを出る関数
  try { localStorage.removeItem(TEST_MODE_KEY); } catch { /* 消せない時もそのまま */ }   // 印を消す
  reloadAt("/home");   // 読みなおす
}

/** 画面の住所を変えて、ページを読みなおす */
function reloadAt(path) {   // 読みなおす関数
  location.hash = path;   // 住所を変える
  location.reload();   // 読みなおす
}
