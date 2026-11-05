// ============================================================
// store.js — アプリ全体で共有する「今の状態」
// ------------------------------------------------------------
// このファイルは、アプリ全体で共有する「今の状態」のファイルです。
// ・ログイン中の人（user）など、どの画面からも使う情報をここに置く
// ・画面ごとの細かい状態は、それぞれの画面ファイルの中に持つ
// ============================================================

import { api } from "./api/index.js";

export const state = {   // アプリ全体で使う「今の状態」
  /** ログイン中の店員（店長も含む）。ログインしていなければ null */
  user: null,
  /** 会社の店舗の一覧 */
  stores: [],
  /** 今見ている店舗のID（店長はホームで切り替えられる。店員はメインの店舗） */
  storeId: null,
};

/** 店長かどうか */
export function isManager() {
  return state.user?.role === "manager";
}

/** 営業している店舗（休止した店舗は、切り替えのボタンなどに出さない） */
export function activeStores() {
  return state.stores.filter((s) => s.active !== false);
}

/** 今見ている店舗 */
export function currentStore() {
  return state.stores.find((s) => s.id === state.storeId) || null;
}

/** ログインした時・開き直した時に、店舗の情報を読み直す */
export async function loadStoreInfo() {
  if (!state.user) { state.stores = []; state.storeId = null; return; }
  [state.stores, state.storeId] = await Promise.all([api.listStores(), api.currentStoreId()]);
}

/** 店舗を切り替える（店長） */
export async function switchStore(storeId) {
  await api.setCurrentStore(storeId);
  state.storeId = storeId;
}
