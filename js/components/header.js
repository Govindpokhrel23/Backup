// ============================================================
// components/header.js — 画面の上の見出し（どの画面でも同じ形）
// ============================================================

import { h } from "../lib/dom.js";
import { isManager, currentStore } from "../store.js";

/**
 * @param {object} p
 * @param {string} p.title      大きい見出し
 * @param {string} [p.sub]      その下の小さい説明
 * @param {Node}   [p.right]    右上に置くもの（ボタンなど）
 * @param {Node}   [p.extra]    見出しの下に足すもの（お知らせなど）
 */
export function screenHeader({ title, sub, right, extra }) {
  // 店長は3店舗を切り替えるので、どの店舗を見ているか、いつも見出しに出す
  const store = isManager() ? currentStore() : null;
  return h("header", { class: "screen-header" },
    h("div", { class: "screen-header__row" },
      h("h1", { class: "screen-header__title" }, title,
        store ? h("span", { class: "store-badge" }, store.name) : null),
      right || null,
    ),
    sub ? h("div", { class: "screen-header__sub" }, sub) : null,
    extra || null,
  );
}
