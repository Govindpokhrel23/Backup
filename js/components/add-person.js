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

import { createElement, toast } from "../lib/dom.js";
import { CONFIG } from "../config.js";

/**
 * ダイアログを開く
 * @param {object} props
 * @param {object[]} props.company   会社の店員みんな（api.listCompanyMembers）
 * @param {Set<string>} props.shown  もう表に出ている人のID
 * @param {(memberId:string, how:"week"|"store")=>Promise<void>} props.onPickOther  ほかの店舗の人を足した時
 * @param {(form:object)=>Promise<void>} props.onCreate  新しい人を登録した時 {name, kind, skills}
 * @returns {Promise<void>} 閉じたら終わる
 */
export function openAddPerson(props) {
  return new Promise((resolve) => {
    let tab = "other";                                                // 今のタブ：other＝ほかの店舗の人 / new＝新しい人
    const close = () => { backdrop.remove(); resolve(); };            // 閉じる
    const body = createElement("div", { class: "add-person__body" });             // タブの中身を入れる所
    const tabs = createElement("div", { class: "chip-row" });                     // タブのボタン

    /** タブと中身を描き直す */
    const draw = () => {
      tabs.replaceChildren(
        createElement("button", { class: "chip", "aria-pressed": String(tab === "other"), onclick: () => { tab = "other"; draw(); } }, "ほかの店舗の人"),
        createElement("button", { class: "chip", "aria-pressed": String(tab === "new"), onclick: () => { tab = "new"; draw(); } }, "まだアカウントがない人"),
      );
      body.replaceChildren(tab === "other" ? otherTab() : newTab());
    };

    /** ① ほかの店舗の人 */
    const otherTab = () => {
      const list = props.company.filter((member) => !props.shown.has(member.id) && member.role !== "manager");   // まだ表にいない人
      if (!list.length) return createElement("div", { class: "home-muted" }, "足せる人はいません（会社の人は全員、表に出ています）");
      const search = createElement("input", { class: "input", placeholder: "名前でさがす", "aria-label": "名前でさがす" });   // さがす欄
      const rows = createElement("div", { class: "add-person__list" });                             // 人の一覧
      /** さがす欄に合う人だけ出す */
      const fill = () => rows.replaceChildren(...list
        .filter((member) => !search.value || member.name.includes(search.value.trim()))
        .map((member) => createElement("div", { class: "add-person__row" },
          createElement("div", null,
            createElement("strong", null, member.name),
            createElement("div", { class: "home-muted" }, `${member.mainShort}・${CONFIG.KIND_LABEL[member.kind]}・ホール${member.skills.hall} キッチン${member.skills.kitchen}`)),
          createElement("div", { class: "chip-row" },
            createElement("button", { class: "btn btn--small btn--primary", onclick: async () => { await props.onPickOther(member.id, "week"); close(); } }, "この週だけ応援"),
            createElement("button", { class: "btn btn--small", onclick: async () => { await props.onPickOther(member.id, "store"); close(); } }, "この店舗にも行ける"),
          ))));
      search.addEventListener("input", fill);
      fill();
      return createElement("div", null, search, rows);
    };

    /** ② まだアカウントがない人 */
    const newTab = () => {
      const name = createElement("input", { class: "input", placeholder: "例：スタッフJ", "aria-label": "名前" });     // 名前
      const kind = createElement("select", { class: "select", "aria-label": "立場" },                                // 立場
        Object.entries(CONFIG.KIND_LABEL).map(([kind, label]) => createElement("option", { value: kind, selected: kind === "baito" }, label)));
      // できること（4項目。最初は全部 0%。分かる所だけ入れればよい）
      const skillSel = {};                                                                               // 項目 → セレクト
      const skillRow = CONFIG.SKILLS.map((skill) => {   // できること4項目の入力欄
        skillSel[skill.key] = createElement("select", { class: "select", "aria-label": skill.label },
          CONFIG.SKILL_LEVELS.map((level) => createElement("option", { value: level, selected: level === (skill.key === "hall" ? 50 : 0) }, `${level}%`)));
        return createElement("label", { class: "field" }, skill.label, skillSel[skill.key]);
      });
      return createElement("div", null,
        createElement("label", { class: "field" }, "名前", name),
        createElement("label", { class: "field" }, "立場", kind),
        createElement("div", { class: "add-person__skills" }, skillRow),
        createElement("div", { class: "home-muted" }, "アカウント（ログイン）はまだ作りません。あとで「店員管理」の「アカウントを作る」で初回コードを出します。"),
        createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {
          if (!name.value.trim()) { toast("名前を入れてください"); return; }
          const skills = Object.fromEntries(CONFIG.SKILLS.map((skill) => [skill.key, Number(skillSel[skill.key].value)]));   // 入れたできること％（数字にする）
          await props.onCreate({ name: name.value.trim(), kind: kind.value, skills });
          close();
        } }, "登録して表に出す"),
      );
    };

    const backdrop = createElement("div", { class: "dialog-backdrop" },   // うしろを暗くする幕（中にダイアログ）
      createElement("div", { class: "dialog add-person", role: "dialog", "aria-modal": "true", "aria-label": "人を追加" },
        createElement("h2", { class: "dialog__title" }, "人を追加"),
        tabs,
        body,
        createElement("div", { class: "dialog__actions" }, createElement("button", { class: "btn", onclick: close }, "閉じる")),
      ));
    draw();
    document.body.appendChild(backdrop);
  });
}
