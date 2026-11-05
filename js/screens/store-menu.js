// ============================================================
// screens/store-menu.js — 店舗メニュー（店長）
// ------------------------------------------------------------
// このファイルは、店舗メニュー（店長）のファイルです。
// 店舗の設定画面への入口をまとめた画面
// ============================================================

import { h, mount } from "../lib/dom.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";

/** 店舗メニューの画面を描く（店長） */
export async function renderStoreMenu(app) {
  /** メニューの1つ（押すとその画面へ） */
  const item = (title, text, path) =>
    h("button", { class: "card menu-item", onclick: () => go(path) },
      h("strong", null, title),
      h("span", { class: "home-muted" }, text));

  mount(app,
    screenHeader({ title: "店舗" }),
    h("div", { class: "screen-body" },
      item("店員管理", "アカウント作成・立場（社員／バイト）・できること％・人ごとのルール", "/staff"),
      item("マップ・必要人数", "人のマークを置いて、場所ごとに何時〜何時・何人必要か決める", "/map"),
      item("店舗の管理", "店舗を増やす・名前を変える・休止する", "/stores"),
      item("AIの設定", "Gemini のつなぎ方・AIが覚えた店長の直し方", "/ai"),
      item("設定", "名前・ログアウト", "/settings"),
    ),
  );
}
