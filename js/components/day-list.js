// ============================================================
// components/day-list.js — その日の勤務の一覧（名前と時間を文字で）
// ------------------------------------------------------------
// このファイルは、その日の勤務の一覧（名前と時間を文字で）のファイルです。
// シフト表（線）だけだと時間が読みにくいので、表の下に
//   「スタッフA　7:00〜16:00　ホール　休憩11:30　立」
// のように1人1行で出す。開始が早い順。
// ============================================================

import { h } from "../lib/dom.js";
import { fmt, range } from "../lib/time.js";
import { roleMarks } from "../lib/roles.js";

/**
 * @param {object} p
 * @param {object[]} p.assignments  その日の勤務
 * @param {object[]} p.members      店員（名前を出すため）
 * @param {{open:number,close:number}} [p.hours] 営業時間（「立」「締」の印）
 */
export function dayList(p) {
  /** IDから名前 */
  const nameOf = (id) => p.members.find((m) => m.id === id)?.name || "？";
  const rows = [...p.assignments].sort((a, b) => a.from - b.from || a.to - b.to);   // 始まりが早い順の勤務
  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, "この日の一覧（何時から何時まで）"),
    rows.length
      ? h("table", { class: "day-list" },
          h("tbody", null, rows.map((a) => h("tr", null,
            h("th", null, nameOf(a.memberId)),
            h("td", { class: "num day-list__time" }, range(a.from, a.to)),
            h("td", null, h("span", { class: `badge badge--${a.area}` }, a.area === "hall" ? "ホール" : "キッチン")),
            h("td", { class: "num home-muted" }, a.breakAt != null ? `休憩 ${fmt(a.breakAt)}` : ""),
            h("td", { class: "home-muted" }, roleMarks(a, p.assignments, p.hours).join("・")),
          ))))
      : h("div", { class: "home-muted" }, "この日の勤務はありません"),
  );
}
