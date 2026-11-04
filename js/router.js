// ============================================================
// router.js — 画面の切り替え
// ------------------------------------------------------------
// ・URL の # のあとで画面を決める（例：index.html#/kibou）
//   → ブラウザの「戻る」も効く。ページの読み直しは起きない
// ・役割（店長／店員）で、使えるタブと画面が変わる（設計書3章）
// ============================================================

import { state, isManager } from "./store.js";
import { h, mount, icon } from "./lib/dom.js";

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

/**
 * 画面の一覧
 *   path   … URL の # のあと
 *   render … 画面を作る関数
 *   who    … "all"=全員 / "manager"=店長だけ / "guest"=ログイン前
 */
const ROUTES = [
  { path: "/login", render: renderLogin, who: "guest" },
  { path: "/home", render: renderHome, who: "all" },
  { path: "/kibou", render: renderKibou, who: "all" },
  { path: "/calendar", render: renderCalendar, who: "all" },
  { path: "/published", render: renderPublished, who: "all" },
  { path: "/shift", render: renderShiftEditor, who: "manager" },
  { path: "/store", render: renderStoreMenu, who: "manager" },
  { path: "/staff", render: renderStaff, who: "manager" },
  { path: "/map", render: renderMap, who: "manager" },
  { path: "/settings", render: renderSettings, who: "all" },
  { path: "/stores", render: renderStores, who: "manager" },
];

/** 下のタブバー（役割で中身が変わる） */
const TABS = {
  manager: [
    { path: "/home", label: "ホーム", icon: "home" },
    { path: "/shift", label: "シフト作成", icon: "edit" },
    { path: "/calendar", label: "自分の勤務", icon: "calendar" },   // 店長も仕事に入るので、自分の勤務を見るタブ
    { path: "/store", label: "店舗", icon: "store" },
  ],
  staff: [
    { path: "/home", label: "ホーム", icon: "home" },
    { path: "/kibou", label: "希望入力", icon: "edit" },
    { path: "/calendar", label: "カレンダー", icon: "calendar" },
    { path: "/published", label: "公開シフト", icon: "list" },
  ],
};

/** 別の画面へ移動する */
export function go(path) {
  if (location.hash === `#${path}`) render();   // 同じ画面でも描き直す
  else location.hash = path;
}

/** 今の URL に合わせて画面を描く */
export async function render() {
  const app = document.getElementById("app");
  const path = location.hash.replace(/^#/, "") || "/home";

  // ログインしていなければ、必ずログイン画面へ
  if (!state.user && path !== "/login") return go("/login");
  if (state.user && path === "/login") return go("/home");

  const route = ROUTES.find((r) => r.path === path);
  if (!route) return go("/home");
  if (route.who === "manager" && !isManager()) return go("/home");

  renderTabbar(path);
  window.scrollTo(0, 0);

  try {
    await route.render(app);
  } catch (e) {
    console.error(e);
    mount(app, h("div", { class: "screen-body" },
      h("div", { class: "notice notice--danger" }, `画面を開けませんでした：${e.message}`)));
  }
}

/** 下のタブバーを描く */
function renderTabbar(path) {
  const bar = document.getElementById("tabbar");
  if (!state.user) { bar.hidden = true; return; }
  const tabs = TABS[isManager() ? "manager" : "staff"];
  // 店舗メニューの中の画面（店員管理・マップ）も「店舗」タブを光らせる
  const current = ["/staff", "/map", "/stores"].includes(path) ? "/store" : path;
  mount(bar, tabs.map((t) =>
    h("button", {
      class: "tabbar__btn",
      "aria-current": t.path === current ? "page" : null,
      onclick: () => go(t.path),
    }, icon(t.icon), t.label)));
  bar.hidden = false;
}

/** URL の # が変わったら描き直す */
export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}
