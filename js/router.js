// ============================================================
// router.js — 画面の切り替え
// ------------------------------------------------------------
// このファイルは、画面の切り替えのファイルです。
// ・URL の # のあとで画面を決める（例：index.html#/kibou）
//   → ブラウザの「戻る」も効く。ページの読み直しは起きない
// ・役割（店長／店員）で、使えるタブと画面が変わる（設計書3章）
// ============================================================

import { state, isManager } from "./store.js";
import { createElement, mount, icon } from "./lib/dom.js";

// 画面のファイル（1画面＝1ファイル）
import { renderLogin } from "./screens/login.js";
import { renderHome } from "./screens/home.js";
import { renderKibou } from "./screens/kibou.js";
import { renderCalendar } from "./screens/calendar.js";
import { renderPublished } from "./screens/published.js";
import { renderShiftEditor } from "./screens/shift-editor.js";
import { renderStoreMenu } from "./screens/store-menu.js";
import { renderStaff } from "./screens/staff.js";
import { renderMap } from "./screens/map.js";
import { renderSettings } from "./screens/settings.js";
import { renderStores } from "./screens/stores.js";
import { renderAi } from "./screens/ai.js";
import { renderReport } from "./screens/report.js";

/**
 * 画面の一覧
 *   path   … URL の # のあと
 *   render … 画面を作る関数
 *   who    … "all"=全員 / "manager"=店長だけ / "guest"=ログイン前
 */
const ROUTES = [
  { path: "/login", render: renderLogin, who: "guest" },   // ログイン画面（ログイン前の人だけ）
  { path: "/home", render: renderHome, who: "all" },   // ホーム（店長と店員で中身が変わる）
  { path: "/kibou", render: renderKibou, who: "all" },   // 希望入力（入れる日・休み希望）
  { path: "/calendar", render: renderCalendar, who: "all" },   // 自分の勤務のカレンダー
  { path: "/published", render: renderPublished, who: "all" },   // 公開したシフト（お店全員の分）
  { path: "/shift", render: renderShiftEditor, who: "manager" },   // シフト作成（店長だけ）
  { path: "/store", render: renderStoreMenu, who: "manager" },   // 店舗メニュー（店長だけ）
  { path: "/staff", render: renderStaff, who: "manager" },   // 店員管理（追加・時給・働き方のルール）
  { path: "/map", render: renderMap, who: "manager" },   // お店の地図（人の配置）
  { path: "/settings", render: renderSettings, who: "all" },   // 設定（通知・パスワード・バックアップ）
  { path: "/stores", render: renderStores, who: "manager" },   // 店舗の追加・編集（4店舗目から）
  { path: "/ai", render: renderAi, who: "manager" },   // AIの設定と覚えたこと（2026年11月5日）
  { path: "/report", render: renderReport, who: "manager" },   // 勤務時間の集計（月ごと・CSV）（2026年11月6日）
];

/** 下のタブバー（役割で中身が変わる） */
const TABS = {
  manager: [                                                          // 店長のタブ（4つ）
    { path: "/home", label: "ホーム", icon: "home" },                  // 今日の様子・お知らせ・やること
    { path: "/shift", label: "シフト作成", icon: "edit" },             // 週のシフトを作る・AIに下書きを頼む・公開する
    { path: "/calendar", label: "自分の勤務", icon: "calendar" },      // 店長も仕事に入るので、自分の勤務を見るタブ
    { path: "/store", label: "店舗", icon: "store" },                  // 店員管理・地図・集計・店舗の追加などのメニュー
  ],
  staff: [                                                            // 店員のタブ（4つ）
    { path: "/home", label: "ホーム", icon: "home" },                  // 次のシフト・お知らせ・交代のお願い
    { path: "/kibou", label: "希望入力", icon: "edit" },               // 入れる日・時間と休み希望を出す
    { path: "/calendar", label: "カレンダー", icon: "calendar" },      // 自分の勤務を月のカレンダーで見る
    { path: "/published", label: "公開シフト", icon: "list" },         // お店全員の決まったシフトを見る
  ],
};

/** 別の画面へ移動する */
export function go(path) {
  if (location.hash === `#${path}`) render();   // 同じ画面でも描き直す
  else location.hash = path;
}

/** 今の URL に合わせて画面を描く */
export async function render() {
  const app = document.getElementById("app");   // 画面を入れる場所
  const path = location.hash.replace(/^#/, "") || "/home";   // 今の画面の住所（#のあと）

  // ログインしていなければ、必ずログイン画面へ
  if (!state.user && path !== "/login") return go("/login");
  if (state.user && path === "/login") return go("/home");

  const route = ROUTES.find((route) => route.path === path);   // その住所の画面
  if (!route) return go("/home");
  if (route.who === "manager" && !isManager()) return go("/home");

  renderTabbar(path);
  window.scrollTo(0, 0);

  // 画面ごとに新しい入れ物（view）を作って、その中に描く（2026年11月5日）
  // → 前の画面の読み込みがおそく終わっても、もう外した入れ物に描くだけなので、
  //   新しい画面が古い画面で上書きされない
  const view = createElement("div", { class: "view" });   // この画面の入れ物
  app.replaceChildren(view);

  try {
    await route.render(view);
  } catch (error) {
    console.error(error);
    mount(view, createElement("div", { class: "screen-body" },
      createElement("div", { class: "notice notice--danger" }, `画面を開けませんでした：${error.message}`)));
  }
}

/** 下のタブバーを描く */
function renderTabbar(path) {
  const bar = document.getElementById("tabbar");   // 下のタブバー
  if (!state.user) { bar.hidden = true; return; }
  const tabs = TABS[isManager() ? "manager" : "staff"];   // 店長か店員かで変わるタブ
  // 店舗メニューの中の画面（店員管理・マップ）も「店舗」タブを光らせる
  const current = ["/staff", "/map", "/stores", "/ai", "/report"].includes(path) ? "/store" : path;
  mount(bar, tabs.map((tab) =>
    createElement("button", {
      class: "tabbar__btn",
      "aria-current": tab.path === current ? "page" : null,
      onclick: () => go(tab.path),
    }, icon(tab.icon), tab.label)));
  bar.hidden = false;
}

/** URL の # が変わったら描き直す */
export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}
