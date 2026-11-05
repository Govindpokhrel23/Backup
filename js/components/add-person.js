// ============================================================
// components/add-person.js — シフト作成の「＋ 人を追加」
// ------------------------------------------------------------
// このファイルは、シフト作成の画面から、表にいない人を足すためのダイアログのファイルです（2026年11月5日）。
//
// 2つの足し方：
//   ① ほかの店舗の人 … 会社のほかの店舗の人を選ぶ
//        ・「この週だけ応援」→ この週の表にだけ出る（行ける店舗の登録は変えない）
//        ・「この店舗にも行けるようにする」→ その人の行ける店舗のいちばん後ろに足す（次の週からも出る）
//   ② まだアカウントがない人 … 名前・立場・できることを入れて登録する
//        → アカウント（ログイン）はまだ作らない。あとで店員管理の「アカウントを作る」で初回コードを出す
// ============================================================

import { h, toast } from "../lib/dom.js";
import { CONFIG } from "../config.js";

/**
 * ダイアログを開く
 * @param {object} p
 * @param {object[]} p.company   会社の店員みんな（api.listCompanyMembers）
 * @param {Set<string>} p.shown  もう表に出ている人のID
 * @param {(memberId:string, how:"week"|"store")=>Promise<void>} p.onPickOther  ほかの店舗の人を足した時
 * @param {(form:object)=>Promise<void>} p.onCreate  新しい人を登録した時 {name, kind, skills}
 * @returns {Promise<void>} 閉じたら終わる
 */
export function openAddPerson(p) {
  return new Promise((resolve) => {
    let tab = "other";                                                // 今のタブ：other＝ほかの店舗の人 / new＝新しい人
    const close = () => { backdrop.remove(); resolve(); };            // 閉じる
    const body = h("div", { class: "add-person__body" });             // タブの中身を入れる所
    const tabs = h("div", { class: "chip-row" });                     // タブのボタン

    /** タブと中身を描き直す */
    const draw = () => {
      tabs.replaceChildren(
        h("button", { class: "chip", "aria-pressed": String(tab === "other"), onclick: () => { tab = "other"; draw(); } }, "ほかの店舗の人"),
        h("button", { class: "chip", "aria-pressed": String(tab === "new"), onclick: () => { tab = "new"; draw(); } }, "まだアカウントがない人"),
      );
      body.replaceChildren(tab === "other" ? otherTab() : newTab());
    };

    /** ① ほかの店舗の人 */
    const otherTab = () => {
      const list = p.company.filter((m) => !p.shown.has(m.id) && m.role !== "manager");   // まだ表にいない人
      if (!list.length) return h("div", { class: "home-muted" }, "足せる人はいません（会社の人は全員、表に出ています）");
      const search = h("input", { class: "input", placeholder: "名前でさがす", "aria-label": "名前でさがす" });   // さがす欄
      const rows = h("div", { class: "add-person__list" });                             // 人の一覧
      /** さがす欄に合う人だけ出す */
      const fill = () => rows.replaceChildren(...list
        .filter((m) => !search.value || m.name.includes(search.value.trim()))
        .map((m) => h("div", { class: "add-person__row" },
          h("div", null,
            h("strong", null, m.name),
            h("div", { class: "home-muted" }, `${m.mainShort}・${CONFIG.KIND_LABEL[m.kind]}・ホール${m.skills.hall} キッチン${m.skills.kitchen}`)),
          h("div", { class: "chip-row" },
            h("button", { class: "btn btn--small btn--primary", onclick: async () => { await p.onPickOther(m.id, "week"); close(); } }, "この週だけ応援"),
            h("button", { class: "btn btn--small", onclick: async () => { await p.onPickOther(m.id, "store"); close(); } }, "この店舗にも行ける"),
          ))));
      search.addEventListener("input", fill);
      fill();
      return h("div", null, search, rows);
    };

    /** ② まだアカウントがない人 */
    const newTab = () => {
      const name = h("input", { class: "input", placeholder: "例：スタッフJ", "aria-label": "名前" });     // 名前
      const kind = h("select", { class: "select", "aria-label": "立場" },                                // 立場
        Object.entries(CONFIG.KIND_LABEL).map(([k, v]) => h("option", { value: k, selected: k === "baito" }, v)));
      // できること（4項目。最初は全部 0%。分かる所だけ入れればよい）
      const skillSel = {};                                                                               // 項目 → セレクト
      const skillRow = CONFIG.SKILLS.map((s) => {   // できること4項目の入力欄
        skillSel[s.key] = h("select", { class: "select", "aria-label": s.label },
          CONFIG.SKILL_LEVELS.map((v) => h("option", { value: v, selected: v === (s.key === "hall" ? 50 : 0) }, `${v}%`)));
        return h("label", { class: "field" }, s.label, skillSel[s.key]);
      });
      return h("div", null,
        h("label", { class: "field" }, "名前", name),
        h("label", { class: "field" }, "立場", kind),
        h("div", { class: "add-person__skills" }, skillRow),
        h("div", { class: "home-muted" }, "アカウント（ログイン）はまだ作りません。あとで「店員管理」の「アカウントを作る」で初回コードを出します。"),
        h("button", { class: "btn btn--primary btn--block", onclick: async () => {
          if (!name.value.trim()) { toast("名前を入れてください"); return; }
          const skills = Object.fromEntries(CONFIG.SKILLS.map((s) => [s.key, Number(skillSel[s.key].value)]));   // 入れたできること％（数字にする）
          await p.onCreate({ name: name.value.trim(), kind: kind.value, skills });
          close();
        } }, "登録して表に出す"),
      );
    };

    const backdrop = h("div", { class: "dialog-backdrop" },   // うしろを暗くする幕（中にダイアログ）
      h("div", { class: "dialog add-person", role: "dialog", "aria-modal": "true", "aria-label": "人を追加" },
        h("h2", { class: "dialog__title" }, "人を追加"),
        tabs,
        body,
        h("div", { class: "dialog__actions" }, h("button", { class: "btn", onclick: close }, "閉じる")),
      ));
    draw();
    document.body.appendChild(backdrop);
  });
}
