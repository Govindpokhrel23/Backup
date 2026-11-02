// ============================================================
// main.js — アプリが最初に動かすファイル
// ------------------------------------------------------------
// やること：
//   1. ログインが残っているか確かめる（ログインを保持する仕様）
//   2. 画面の切り替え（router）を動かし始める
// ============================================================

import { api } from "./api/index.js";
import { state } from "./store.js";
import { startRouter } from "./router.js";

async function start() {
  // 前にログインしていれば、その人の情報を読む
  state.user = await api.currentUser();
  startRouter();
}

start();
