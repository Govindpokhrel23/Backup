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

import { createElement, toast } from "../lib/dom.js";   // 画面の部品・お知らせの道具を読む
import { CONFIG } from "../config.js";   // 設定を読む

/**
 * ダイアログを開く
 * @param {object} props
 * @param {object[]} props.company   会社の店員みんな（api.listCompanyMembers）
 * @param {Set<string>} props.shown  もう表に出ている人のID
 * @param {(memberId:string, how:"week"|"store")=>Promise<void>} props.onPickOther  ほかの店舗の人を足した時
 * @param {(form:object)=>Promise<void>} props.onCreate  新しい人を登録した時 {name, kind, skills}
 * @returns {Promise<void>} 閉じたら終わる
 */
export function openAddPerson(props) {   // 「人を追加」の小さい画面を開く関数
  return new Promise((resolve) => {   // 閉じるまで待てるようにする
    let tab = "other";                                                // 今のタブ：other＝ほかの店舗の人 / new＝新しい人
    const close = () => { backdrop.remove(); resolve(); };            // 閉じる
    const body = createElement("div", { class: "add-person__body" });             // タブの中身を入れる所
    const tabs = createElement("div", { class: "chip-row" });                     // タブのボタン

    /** タブと中身を描き直す */
    const draw = () => {   // 中身を描きなおす
      tabs.replaceChildren(   // 上のタブ
        createElement("button", { class: "chip", "aria-pressed": String(tab === "other"), onclick: () => { tab = "other"; draw(); } }, "ほかの店舗の人"),   // ほかの店舗の人のタブ
        createElement("button", { class: "chip", "aria-pressed": String(tab === "new"), onclick: () => { tab = "new"; draw(); } }, "まだアカウントがない人"),   // まだアカウントがない人のタブ
      );
      body.replaceChildren(tab === "other" ? otherTab() : newTab());   // 選んだタブの中身
    };

    /** ① ほかの店舗の人 */
    const otherTab = () => {   // ほかの店舗の人のタブの中身
      const list = props.company.filter((member) => !props.shown.has(member.id) && member.role !== "manager");   // まだ表にいない人
      if (!list.length) return createElement("div", { class: "home-muted" }, "足せる人はいません（会社の人は全員、表に出ています）");   // 足せる人がいない時の文
      const search = createElement("input", { class: "input", placeholder: "名前でさがす", "aria-label": "名前でさがす" });   // さがす欄
      const rows = createElement("div", { class: "add-person__list" });                             // 人の一覧
      /** さがす欄に合う人だけ出す */
      const fill = () => rows.replaceChildren(...list   // 一覧を描く
        .filter((member) => !search.value || member.name.includes(search.value.trim()))   // 名前で探す
        .map((member) => createElement("div", { class: "add-person__row" },   // 1人1行
          createElement("div", null,   // 左側
            createElement("strong", null, member.name),   // 名前
            createElement("div", { class: "home-muted" }, `${member.mainShort}・${CONFIG.KIND_LABEL[member.kind]}・ホール${member.skills.hall} キッチン${member.skills.kitchen}`)),   // 所属店・立場・できること％
          createElement("div", { class: "chip-row" },   // 右側のボタン
            createElement("button", { class: "btn btn--small btn--primary", onclick: async () => { await props.onPickOther(member.id, "week"); close(); } }, "この週だけ応援"),   // この週だけ足す
            createElement("button", { class: "btn btn--small", onclick: async () => { await props.onPickOther(member.id, "store"); close(); } }, "この店舗にも行ける"),   // この店舗にもずっと行けるようにする
          ))));
      search.addEventListener("input", fill);   // 文字を入れたら一覧を描きなおす
      fill();   // はじめに一覧を描く
      return createElement("div", null, search, rows);   // 探す欄と一覧を返す
    };

    /** ② まだアカウントがない人 */
    const newTab = () => {   // まだアカウントがない人のタブの中身
      const name = createElement("input", { class: "input", placeholder: "例：スタッフJ", "aria-label": "名前" });     // 名前
      const kind = createElement("select", { class: "select", "aria-label": "立場" },                                // 立場
        Object.entries(CONFIG.KIND_LABEL).map(([kind, label]) => createElement("option", { value: kind, selected: kind === "baito" }, label)));   // 立場の選び方（はじめはバイト）
      // できること（4項目。最初は全部 0%。分かる所だけ入れればよい）
      const skillSel = {};                                                                               // 項目 → セレクト
      const skillRow = CONFIG.SKILLS.map((skill) => {   // できること4項目の入力欄
        skillSel[skill.key] = createElement("select", { class: "select", "aria-label": skill.label },   // できること％を選ぶ欄
          CONFIG.SKILL_LEVELS.map((level) => createElement("option", { value: level, selected: level === (skill.key === "hall" ? 50 : 0) }, `${level}%`)));   // 0〜100%（はじめはホール50%）
        return createElement("label", { class: "field" }, skill.label, skillSel[skill.key]);   // 名前と欄
      });
      return createElement("div", null,   // 中身を返す
        createElement("label", { class: "field" }, "名前", name),   // 名前の欄
        createElement("label", { class: "field" }, "立場", kind),   // 立場の欄
        createElement("div", { class: "add-person__skills" }, skillRow),   // できること％の欄
        createElement("div", { class: "home-muted" }, "アカウント（ログイン）はまだ作りません。あとで「店員管理」の「アカウントを作る」で初回コードを出します。"),   // 説明
        createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {   // 登録ボタン
          if (!name.value.trim()) { toast("名前を入れてください"); return; }   // 名前がなければ止める
          const skills = Object.fromEntries(CONFIG.SKILLS.map((skill) => [skill.key, Number(skillSel[skill.key].value)]));   // 入れたできること％（数字にする）
          await props.onCreate({ name: name.value.trim(), kind: kind.value, skills });   // 店員を作る
          close();   // 閉じる
        } }, "登録して表に出す"),   // ボタンの文字
      );
    };

    const backdrop = createElement("div", { class: "dialog-backdrop" },   // うしろを暗くする幕（中にダイアログ）
      createElement("div", { class: "dialog add-person", role: "dialog", "aria-modal": "true", "aria-label": "人を追加" },   // 小さい画面の本体
        createElement("h2", { class: "dialog__title" }, "人を追加"),   // タイトル
        tabs,   // タブ
        body,   // 中身
        createElement("div", { class: "dialog__actions" }, createElement("button", { class: "btn", onclick: close }, "閉じる")),   // 閉じるボタン
      ));
    draw();   // はじめに描く
    document.body.appendChild(backdrop);   // 画面に出す
  });
}
