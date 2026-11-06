// ============================================================
// main.js — アプリが最初に動かすファイル
// ------------------------------------------------------------
// このファイルは、アプリを開いた時にいちばん最初に動くファイルです。
// やること：
//   1. ログインが残っているか確かめる（ログインを保持する仕様）
//   2. 画面の切り替え（router）を動かし始める
// ============================================================

import { api } from "./api/index.js";
import { state, loadStoreInfo } from "./store.js";
import { startRouter } from "./router.js";

/** アプリを始める（ログインが残っているか確かめて、最初の画面を出す） */
async function start() {
  // 前にログインしていれば、その人の情報を読む
  state.user = await api.currentUser();
  await loadStoreInfo();
  startRouter();
}

start();

// 電波がない時もアプリを開けるように、サービスワーカーを登録する（sw.js）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((event) => console.warn("サービスワーカーを登録できませんでした", event));
}
