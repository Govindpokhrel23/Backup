// ============================================================
// screens/store-menu.js — 店舗メニュー（店長）
// ------------------------------------------------------------
// このファイルは、店舗メニュー（店長）のファイルです。
// 店舗の設定画面への入口をまとめた画面
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品を作る・画面に入れる道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { isTestMode } from "../lib/test-mode.js";   // テストモードか調べる道具を読む

/** 店舗メニューの画面を描く（店長） */
export async function renderStoreMenu(app) {   // 店舗メニューの画面を描く関数
  /** メニューの1つ（押すとその画面へ） */
  const item = (title, text, path) =>   // メニューの1つ（ボタン）を作る
    createElement("button", { class: "card menu-item", onclick: () => go(path) },   // 押すとその画面へ移動
      createElement("strong", null, title),   // 大きい文字の名前
      createElement("span", { class: "home-muted" }, text));   // 小さい説明

  mount(app,   // 画面に入れる
    screenHeader({ title: "店舗" }),   // 見出し
    createElement("div", { class: "screen-body" },   // 本文
      isTestMode() ? item("🧪 希望を代わりに入れる（テストモード）", "テストの人をえらんで、その人の希望を入れる。保存すると次の人へ進む", "/kibou") : null,   // テストモードの時だけ（2026年11月15日）
      item("店員管理", "アカウント作成・立場（社員／バイト）・できること％・人ごとのルール", "/staff"),   // 店員管理へ
      item("マップ・必要人数", "人のマークを置いて、場所ごとに何時〜何時・何人必要か決める", "/map"),   // マップへ
      item("店舗の設定", "営業時間・お休みの日・時間の変更・店舗の名前・店舗を増やす", "/stores"),   // 店舗の設定へ（2026年11月15日：名前を変えた）
      item("勤務時間の集計", "月ごとの時間・人件費の目安。CSV（給与計算用）に書き出す", "/report"),   // 集計へ
      item("AIの設定", "Gemini のつなぎ方・AIが覚えた店長の直し方", "/ai"),   // AIの設定へ
      item("設定", "名前・ログアウト", "/settings"),   // 設定へ
      item("ヘルプ（使い方）", "アプリの使い方を、タブごとにまとめて見る", "/help"),   // ヘルプへ（2026年11月15日）
    ),
  );
}
