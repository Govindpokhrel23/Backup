// ============================================================
// store.js — アプリ全体で共有する「今の状態」
// ------------------------------------------------------------
// このファイルは、アプリ全体で共有する「今の状態」のファイルです。
// ・ログイン中の人（user）など、どの画面からも使う情報をここに置く
// ・画面ごとの細かい状態は、それぞれの画面ファイルの中に持つ
// ============================================================

import { api } from "./api/index.js";   // データのやりとりの窓口を読む

export const state = {   // アプリ全体で使う「今の状態」
  /** ログイン中の店員（店長も含む）。ログインしていなければ null */
  user: null,   // ログイン中の人（いなければ null）
  /** 会社の店舗の一覧 */
  stores: [],   // 店舗の一覧
  /** 今見ている店舗のID（店長はホームで切り替えられる。店員はメインの店舗） */
  storeId: null,   // 今選んでいる店舗のID
  /** 店長・開発者が「店員の画面」で見ている時 true（2026年11月12日） */
  viewAsStaff: readViewAsStaff(),   // 店員の画面で見ているか
};

/** 「店員の画面で見る」を覚えておく名前 */
const VIEW_KEY = "shiftapp-view-as-staff";   // スマホに保存する時の名前

/** 前に「店員の画面で見る」にしていたか読む */
function readViewAsStaff() {   // 保存を読む関数
  try { return localStorage.getItem(VIEW_KEY) === "1"; } catch (error) { return false; }   // 読めない時は店長の画面
}

/** 本当に店長（または開発者）か。「店員の画面で見る」の時も true */
export function isRealManager() {   // 本当の役割が店長か調べる関数
  return state.user?.role === "manager";   // 役割が manager なら true
}

/** 開発者か（アプリを直す人。2026年11月12日） */
export function isDeveloper() {   // 開発者か調べる関数
  return state.user?.developer === true;   // developer が true なら開発者
}

/** 店長の画面／店員の画面を切りかえる（店長・開発者だけ） */
export function setViewAsStaff(on) {   // 見る画面を切りかえる関数
  state.viewAsStaff = Boolean(on) && isRealManager();   // 店長でなければ切りかえない
  try { localStorage.setItem(VIEW_KEY, state.viewAsStaff ? "1" : "0"); } catch (error) { /* 保存できなくても動く */ }   // 覚える
}

/** 店長かどうか */
export function isManager() {   // 店長か調べる関数
  return isRealManager() && !state.viewAsStaff;   // 店長で、「店員の画面で見る」にしていなければ店長の画面
}

/** 営業している店舗（休止した店舗は、切り替えのボタンなどに出さない） */
export function activeStores() {   // 休止していない店舗だけを出す関数
  return state.stores.filter((store) => store.active !== false);   // active が false のものを外す
}

/** 今見ている店舗 */
export function currentStore() {   // 今の店舗を出す関数
  return state.stores.find((store) => store.id === state.storeId) || null;   // IDが合う店舗。なければ null
}

/** ログインした時・開き直した時に、店舗の情報を読み直す */
export async function loadStoreInfo() {   // 店舗の情報を読む関数
  if (!state.user) { state.stores = []; state.storeId = null; return; }   // ログインしていなければ空にして終わり
  [state.stores, state.storeId] = await Promise.all([api.listStores(), api.currentStoreId()]);   // 店舗の一覧と今の店舗を同時に読む
}

/** 店舗を切り替える（店長） */
export async function switchStore(storeId) {   // 店舗を切りかえる関数
  await api.setCurrentStore(storeId);   // サーバー（またはスマホ）に今の店舗を保存
  state.storeId = storeId;   // アプリの中の今の店舗も変える
}
