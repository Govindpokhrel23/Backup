// ============================================================
// screens/store-menu.js — 店舗メニュー（店長）
// ------------------------------------------------------------
// このファイルは、店舗メニュー（店長）のファイルです。
// 店舗の設定画面への入口をまとめた画面
// ============================================================

import { createElement, mount } from "../lib/dom.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";

/** 店舗メニューの画面を描く（店長） */
export async function renderStoreMenu(app) {
  /** メニューの1つ（押すとその画面へ） */
  const item = (title, text, path) =>
    createElement("button", { class: "card menu-item", onclick: () => go(path) },
      createElement("strong", null, title),
      createElement("span", { class: "home-muted" }, text));

  mount(app,
    screenHeader({ title: "店舗" }),
    createElement("div", { class: "screen-body" },
      item("店員管理", "アカウント作成・立場（社員／バイト）・できること％・人ごとのルール", "/staff"),
      item("マップ・必要人数", "人のマークを置いて、場所ごとに何時〜何時・何人必要か決める", "/map"),
      item("店舗の管理", "店舗を増やす・名前を変える・休止する", "/stores"),
      item("勤務時間の集計", "月ごとの時間・人件費の目安。CSV（給与計算用）に書き出す", "/report"),
      item("AIの設定", "Gemini のつなぎ方・AIが覚えた店長の直し方", "/ai"),
      item("設定", "名前・ログアウト", "/settings"),
    ),
  );
}
