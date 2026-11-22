// ============================================================
// components/header.js — 画面の上の見出し（どの画面でも同じ形）
// このファイルは、画面の上の見出し（どの画面でも同じ形）のファイルです。
// ============================================================

import { createElement } from "../lib/dom.js";   // 画面の部品を作る道具を読む
import { isManager, currentStore } from "../store.js";   // 店長かどうか・今の店舗を調べる道具を読む

/**
 * @param {object} options
 * @param {string} options.title      大きい見出し
 * @param {string} [options.sub]      その下の小さい説明
 * @param {Node}   [options.right]    右上に置くもの（ボタンなど）
 * @param {Node}   [options.extra]    見出しの下に足すもの（お知らせなど）
 * @param {boolean} [options.slim]    小さい見出し（場所をとらない。2026年11月22日）
 */
export function screenHeader({ title, sub, right, extra, slim }) {   // 画面の上の見出しを作る関数
  // 店長は3店舗を切り替えるので、どの店舗を見ているか、いつも見出しに出す
  const store = isManager() ? currentStore() : null;   // 店長なら今の店舗を出す（店員は出さない）
  return createElement("header", { class: `screen-header${slim ? " screen-header--slim" : ""}` },   // 見出しの入れ物（slim なら小さく）
    createElement("div", { class: "screen-header__row" },   // 1行目（タイトルと右のボタン）
      createElement("h1", { class: "screen-header__title" }, title,   // 大きいタイトル
        store ? createElement("span", { class: "store-badge" }, store.name) : null),   // 店舗の名前のバッジ（店長だけ）
      right || null,   // 右上に置くもの（なければ何も置かない）
    ),
    sub ? createElement("div", { class: "screen-header__sub" }, sub) : null,   // タイトルの下の小さい説明
    extra || null,   // 見出しの下に足すもの（お知らせなど）
  );
}
