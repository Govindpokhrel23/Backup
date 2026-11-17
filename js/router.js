// ============================================================
// router.js — 画面の切り替え
// ------------------------------------------------------------
// このファイルは、画面の切り替えのファイルです。
// ・URL の # のあとで画面を決める（例：index.html#/kibou）
//   → ブラウザの「戻る」も効く。ページの読み直しは起きない
// ・役割（店長／店員）で、使えるタブと画面が変わる（設計書3章）
// ============================================================

import { state, isManager, setViewAsStaff } from "./store.js";   // ログイン中の人・店長か調べる道具・見る画面の切りかえを読む
import { createElement, mount, icon } from "./lib/dom.js";   // 画面の部品の道具を読む

// 画面のファイル（1画面＝1ファイル）
import { renderLogin } from "./screens/login.js";   // ログイン画面
import { renderHome } from "./screens/home.js";   // ホーム
import { renderKibou } from "./screens/kibou.js";   // 希望入力
import { renderCalendar } from "./screens/calendar.js";   // カレンダー
import { renderPublished } from "./screens/published.js";   // 公開シフト
import { renderShiftEditor } from "./screens/shift-editor.js";   // シフト作成
import { renderStoreMenu } from "./screens/store-menu.js";   // 店舗メニュー
import { renderStaff } from "./screens/staff.js";   // スタッフの登録・設定
import { renderMap } from "./screens/map.js";   // マップ
import { renderSettings } from "./screens/settings.js";   // 設定
import { renderStores } from "./screens/stores.js";   // 店舗の管理
import { renderAi } from "./screens/ai.js";   // AIの設定
import { renderReport } from "./screens/report.js";   // 勤務時間の集計
import { renderHelp } from "./screens/help.js";   // ヘルプ（使い方）（2026年11月15日）

/**
 * 画面の一覧
 *   path   … URL の # のあと
 *   render … 画面を作る関数
 *   who    … "all"=全員 / "manager"=店長だけ / "guest"=ログイン前
 */
const ROUTES = [   // 画面の表
  { path: "/login", render: renderLogin, who: "guest" },   // ログイン画面（ログイン前の人だけ）
  { path: "/home", render: renderHome, who: "all" },   // ホーム（店長と店員で中身が変わる）
  { path: "/kibou", render: renderKibou, who: "all" },   // 希望入力（入れる日・休み希望）
  { path: "/calendar", render: renderCalendar, who: "all" },   // 自分の勤務のカレンダー
  { path: "/published", render: renderPublished, who: "all" },   // 公開したシフト（お店全員の分）
  { path: "/shift", render: renderShiftEditor, who: "manager" },   // シフト作成（店長だけ）
  { path: "/store", render: renderStoreMenu, who: "manager" },   // 店舗メニュー（店長だけ）
  { path: "/staff", render: renderStaff, who: "manager" },   // スタッフの登録・設定（追加・時給・働き方のルール）
  { path: "/map", render: renderMap, who: "manager" },   // お店の地図（人の配置）
  { path: "/settings", render: renderSettings, who: "all" },   // 設定（通知・パスワード・バックアップ）
  { path: "/stores", render: renderStores, who: "manager" },   // 店舗の追加・編集（4店舗目から）
  { path: "/ai", render: renderAi, who: "manager" },   // AIの設定と覚えたこと（2026年11月5日）
  { path: "/report", render: renderReport, who: "manager" },   // 勤務時間の集計（月ごと・CSV）（2026年11月6日）
  { path: "/help", render: renderHelp, who: "all" },   // ヘルプ（使い方）。店長は「店舗」タブから、店員は設定から（2026年11月15日）
];

/** 下のタブバー（役割で中身が変わる） */
const TABS = {   // 下のタブ
  manager: [                                                          // 店長のタブ（4つ）
    { path: "/home", label: "ホーム", icon: "home" },                  // 今日の様子・お知らせ・やること
    { path: "/shift", label: "シフト作成", icon: "edit" },             // 週のシフトを作る・AIに下書きを頼む・公開する
    { path: "/calendar", label: "自分の勤務", icon: "calendar" },      // 店長も仕事に入るので、自分の勤務を見るタブ
    { path: "/store", label: "店舗", icon: "store" },                  // スタッフの登録・設定・地図・集計・店舗の追加などのメニュー
  ],
  staff: [                                                            // 店員のタブ（4つ）
    { path: "/home", label: "ホーム", icon: "home" },                  // 次のシフト・お知らせ
    { path: "/kibou", label: "希望入力", icon: "edit" },               // 入れる日・時間と休み希望を出す
    { path: "/calendar", label: "カレンダー", icon: "calendar" },      // 自分の勤務を月のカレンダーで見る
    { path: "/published", label: "公開シフト", icon: "list" },         // お店全員の決まったシフトを見る
  ],
};

/** 別の画面へ移動する */
export function go(path) {   // 別の画面へ移動する関数
  if (location.hash === `#${path}`) render();   // 同じ画面でも描き直す
  else location.hash = path;   // URL の # を変える（hashchange で描きなおす）
}

/** 今の URL に合わせて画面を描く */
export async function render() {   // 今の URL の画面を描く関数
  const app = document.getElementById("app");   // 画面を入れる場所
  const path = location.hash.replace(/^#/, "") || "/home";   // 今の画面の住所（#のあと）

  // ログインしていなければ、必ずログイン画面へ
  if (!state.user && path !== "/login") return go("/login");   // ログインしていなければログイン画面へ
  if (state.user && path === "/login") return go("/home");   // ログイン済みならホームへ

  const route = ROUTES.find((route) => route.path === path);   // その住所の画面
  if (!route) return go("/home");   // 表にない住所ならホームへ
  if (route.who === "manager" && !isManager()) return go("/home");   // 店長だけの画面に店員が来たらホームへ

  renderTabbar(path);   // 下のタブを描く
  window.scrollTo(0, 0);   // 一番上までスクロール

  // 画面ごとに新しい入れ物（view）を作って、その中に描く（2026年11月5日）
  // → 前の画面の読み込みがおそく終わっても、もう外した入れ物に描くだけなので、
  //   新しい画面が古い画面で上書きされない
  const view = createElement("div", { class: "view" });   // この画面の入れ物
  app.replaceChildren(...viewBanner(), view);   // 前の画面を外して、（店員の画面で見ている時は帯と）入れ物を置く

  try {   // 画面でエラーが出ても止まらないように
    await route.render(view);   // 画面を描く
  } catch (error) {   // エラーの時
    console.error(error);   // 開発者用に残す
    mount(view, createElement("div", { class: "screen-body" },   // エラーの文を画面に出す
      createElement("div", { class: "notice notice--danger" }, `画面を開けませんでした：${error.message}`)));   // 赤いお知らせ
  }
}

/**
 * 「店員の画面で見ています」の帯（店長・開発者が店員の画面を見ている時だけ。2026年11月12日）
 * @returns {HTMLElement[]} 帯（いらない時は空）
 */
function viewBanner() {   // 店員の画面の帯を作る関数
  if (!state.viewAsStaff) return [];   // ふだんは出さない
  return [createElement("div", { class: "view-banner" },   // 帯
    createElement("span", null, "👀 店員の画面で見ています"),   // 説明
    createElement("button", { class: "btn btn--tiny", onclick: () => { setViewAsStaff(false); go("/home"); } }, "店長の画面にもどる"))];   // もどるボタン
}

/** 下のタブバーを描く */
function renderTabbar(path) {   // 下のタブを描く関数
  const bar = document.getElementById("tabbar");   // 下のタブバー
  if (!state.user) { bar.hidden = true; return; }   // ログインしていなければ隠す
  const tabs = TABS[isManager() ? "manager" : "staff"];   // 店長か店員かで変わるタブ
  // 店舗メニューの中の画面（スタッフの登録・設定・マップ）も「店舗」タブを光らせる
  const current = ["/staff", "/map", "/stores", "/ai", "/report"].includes(path) || (path === "/help" && isManager()) ? "/store" : path;   // 店舗メニューの中の画面なら「店舗」タブを光らせる
  mount(bar, tabs.map((tab) =>   // タブを入れる
    createElement("button", {   // タブのボタン
      class: "tabbar__btn",   // 見た目
      "aria-current": tab.path === current ? "page" : null,   // 今の画面のタブに印
      onclick: () => go(tab.path),   // 押したらその画面へ
    }, icon(tab.icon), tab.label)));   // 絵と文字
  bar.hidden = false;   // タブを出す
}

/** URL の # が変わったら描き直す */
export function startRouter() {   // 画面の切り替えを始める関数
  window.addEventListener("hashchange", render);   // URL の # が変わったら描きなおす
  render();   // はじめの画面を描く
}
