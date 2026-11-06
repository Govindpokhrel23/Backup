// ============================================================
// components/day-list.js — その日の勤務の一覧（名前と時間を文字で）
// ------------------------------------------------------------
// このファイルは、その日の勤務の一覧（名前と時間を文字で）のファイルです。
// シフト表（線）だけだと時間が読みにくいので、表の下に
//   「スタッフA　7:00〜16:00　ホール　休憩11:30　立」
// のように1人1行で出す。開始が早い順。
// ============================================================

import { createElement } from "../lib/dom.js";   // 画面の部品を作る道具を読む
import { fmt, range } from "../lib/time.js";   // 時間の表示の道具を読む
import { roleMarks } from "../lib/roles.js";   // 立・締の印の道具を読む

/**
 * @param {object} props
 * @param {object[]} props.assignments  その日の勤務
 * @param {object[]} props.members      店員（名前を出すため）
 * @param {{open:number,close:number}} [props.hours] 営業時間（「立」「締」の印）
 */
export function dayList(props) {   // 1日の勤務の一覧を作る関数
  /** IDから名前 */
  const nameOf = (id) => props.members.find((member) => member.id === id)?.name || "？";   // 店員IDから名前を出す
  const rows = [...props.assignments].sort((shiftA, shiftB) => shiftA.from - shiftB.from || shiftA.to - shiftB.to);   // 始まりが早い順の勤務
  return createElement("section", { class: "card" },   // 一覧のカード
    createElement("h2", { class: "card__title" }, "この日の一覧（何時から何時まで）"),   // カードの見出し
    rows.length   // 勤務があれば表、なければ「ありません」
      ? createElement("table", { class: "day-list" },   // 表
          createElement("tbody", null, rows.map((row) => createElement("tr", null,   // 勤務ごとに1行
            createElement("th", null, nameOf(row.memberId)),   // 名前
            createElement("td", { class: "num day-list__time" }, range(row.from, row.to)),   // 何時〜何時
            createElement("td", null, createElement("span", { class: `badge badge--${row.area}` }, row.area === "hall" ? "ホール" : "キッチン")),   // 場所（ホール／キッチン）の色付きの印
            createElement("td", { class: "num home-muted" }, row.breakAt != null ? `休憩 ${fmt(row.breakAt)}` : ""),   // 休憩の時間
            createElement("td", { class: "home-muted" }, roleMarks(row, props.assignments, props.hours).join("・")),   // 立・締の印
          ))))
      : createElement("div", { class: "home-muted" }, "この日の勤務はありません"),   // 勤務がない時の文
  );
}
