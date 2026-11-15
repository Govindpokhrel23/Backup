// ============================================================
// components/swap-dialog.js — 交代のお願いを書く小さい画面
// ------------------------------------------------------------
// このファイルは、「交代をお願いする」「お願いを直す」の時に出る小さい画面のファイルです（2026年11月15日）。
//
// ・だれに頼む？ → 「行ける人みんな」か「人をえらぶ」（チェックで何人でも）
//   えらべるのは、その店舗で働けて、同じ時間に勤務がない人だけ
// ・メッセージ（なくてもOK）例「学校の用事です。よろしくお願いします」
// ・⚠️ 注意：代わりが見つかるまでは自分のシフトのまま。見つからない時は自分で出勤するか、店長に直接連絡
// 保存すると { note, targets } を返す。やめたら null
// ============================================================

import { createElement, confirmDialog, toast } from "../lib/dom.js";   // 画面の部品・小さい画面・お知らせの道具を読む
import { label } from "../lib/date.js";   // 日付を「11/16（月）」にする道具を読む
import { range } from "../lib/time.js";   // 時間を「9:00〜15:00」にする道具を読む

/**
 * 交代のお願いを書く小さい画面を出す
 * @param {object} props
 * @param {object} props.shift          交代したい勤務
 * @param {{id:string,name:string}[]} props.people 頼める人
 * @param {object|null} [props.swap]    直す時は、出したお願い（メッセージと頼む人が入る）
 * @returns {Promise<{note:string, targets:string[]}|null>}
 */
export async function openSwapDialog({ shift, people, swap = null }) {   // 小さい画面を出す関数
  const chosen = new Set(swap?.targets || []);   // えらんだ人
  let pickMode = chosen.size > 0;   // 人をえらぶか（false＝行ける人みんな）

  // ---------- だれに頼む？ ----------
  const list = createElement("div", { class: "swap-dialog__people" });   // 人のチェックの入れ物
  const drawPeople = () => {   // 人のチェックを描く
    list.replaceChildren(...(pickMode   // 人をえらぶなら
      ? (people.length   // 頼める人がいれば
          ? people.map((person) => {   // 1人ずつ
              const box = createElement("input", { type: "checkbox", checked: chosen.has(person.id) || null });   // チェック
              box.addEventListener("change", () => { if (box.checked) chosen.add(person.id); else chosen.delete(person.id); });   // えらぶ・外す
              return createElement("label", { class: "swap-dialog__person" }, box, person.name);   // 名前
            })
          : [createElement("div", { class: "home-muted" }, "この時間に頼める人がいません")])   // いない時
      : []));   // みんなの時は出さない
  };
  const modeButton = (value, text) => createElement("button", {   // 「みんな／えらぶ」のボタン
    class: "chip", "aria-pressed": String(pickMode === value),   // えらんでいるかの印
    onclick: (event) => { pickMode = value; event.currentTarget.parentElement.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip === event.currentTarget))); drawPeople(); },   // 切りかえる
  }, text);
  drawPeople();   // はじめに描く

  // ---------- メッセージ ----------
  const note = createElement("textarea", { class: "textarea", rows: "2", maxlength: "100", placeholder: "例：学校の用事です。よろしくお願いします（なくてもOK）" });   // メッセージの欄
  note.value = swap?.note || "";   // 直す時は前のメッセージ

  const ok = await confirmDialog({   // 小さい画面
    title: `${label(shift.date)} ${range(shift.from, shift.to)} の交代`,   // タイトル
    body: createElement("div", { class: "swap-dialog" },   // 中身
      createElement("div", { class: "swap-dialog__label" }, "だれに頼む？"),   // 見出し
      createElement("div", { class: "chip-row" }, modeButton(false, `行ける人みんな（${people.length}人）`), modeButton(true, "人をえらぶ")),   // みんな／えらぶ
      list,   // 人のチェック
      createElement("div", { class: "swap-dialog__label" }, "メッセージ"),   // 見出し
      note,   // メッセージの欄
      // 注意（2026年11月15日）
      createElement("div", { class: "swap-dialog__warn" },   // 注意の箱
        createElement("strong", null, "⚠️ 注意"),   // 見出し
        createElement("div", null, "代わりの人が決まるまでは、あなたのシフトのままです。"),   // 1行目
        createElement("div", null, "見つからない時は自分で出勤するか、店長に直接連絡してください。")),   // 2行目
    ),
    yes: swap ? "保存する" : "お願いを送る",   // 送るボタン
    no: "やめる",   // やめるボタン
  });
  if (!ok) return null;   // やめたら何もしない
  if (pickMode && !chosen.size) { toast("頼む人を1人以上えらんでください"); return null; }   // えらんでいなければ止める
  return { note: note.value.trim(), targets: pickMode ? [...chosen] : [] };   // メッセージと頼む人
}
