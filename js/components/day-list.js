// ============================================================
// components/day-list.js — その日の勤務の一覧（名前と時間を文字で）
// ------------------------------------------------------------
// このファイルは、その日の勤務の一覧（名前と時間を文字で）のファイルです。
// シフト表（線）だけだと時間が読みにくいので、表の下に
//   「スタッフA　7:00〜16:00　ホール　休憩11:30　立」
// のように1人1行で出す。開始が早い順。
// ============================================================

import { createElement } from "../lib/dom.js";
import { fmt, range } from "../lib/time.js";
import { roleMarks } from "../lib/roles.js";

/**
 * @param {object} props
 * @param {object[]} props.assignments  その日の勤務
 * @param {object[]} props.members      店員（名前を出すため）
 * @param {{open:number,close:number}} [props.hours] 営業時間（「立」「締」の印）
 */
export function dayList(props) {
  /** IDから名前 */
  const nameOf = (id) => props.members.find((member) => member.id === id)?.name || "？";
  const rows = [...props.assignments].sort((shiftA, shiftB) => shiftA.from - shiftB.from || shiftA.to - shiftB.to);   // 始まりが早い順の勤務
  return createElement("section", { class: "card" },
    createElement("h2", { class: "card__title" }, "この日の一覧（何時から何時まで）"),
    rows.length
      ? createElement("table", { class: "day-list" },
          createElement("tbody", null, rows.map((row) => createElement("tr", null,
            createElement("th", null, nameOf(row.memberId)),
            createElement("td", { class: "num day-list__time" }, range(row.from, row.to)),
            createElement("td", null, createElement("span", { class: `badge badge--${row.area}` }, row.area === "hall" ? "ホール" : "キッチン")),
            createElement("td", { class: "num home-muted" }, row.breakAt != null ? `休憩 ${fmt(row.breakAt)}` : ""),
            createElement("td", { class: "home-muted" }, roleMarks(row, props.assignments, props.hours).join("・")),
          ))))
      : createElement("div", { class: "home-muted" }, "この日の勤務はありません"),
  );
}
