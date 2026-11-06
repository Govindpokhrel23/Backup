// ============================================================
// components/print-week.js — 1週間のシフトを紙に印刷する
// ------------------------------------------------------------
// このファイルは、1週間のシフトを紙に印刷するためのファイルです。
// お店に貼る紙のシフト表のかわり。印刷ボタンを押すと、
//   ・横：月〜日、縦：名前（社員が上、バイトが下）
//   ・マスに「7-16」のように時間、休憩は「○12」
// の表を作って、ブラウザの印刷を開く（PDFにも保存できる）。
// 画面には出さず、印刷の時だけ出る（css の @media print）。
// ============================================================

import { createElement, mount } from "../lib/dom.js";
import { fmt } from "../lib/time.js";
import { label } from "../lib/date.js";

/**
 * @param {object} props
 * @param {string}   props.title        例：「安城福釜店 11/9（月）〜 11/15（日）」
 * @param {string[]} props.dates        7日分
 * @param {object[]} props.members      並べる店員
 * @param {object[]} props.assignments  その週の勤務（この店舗）
 * @param {string}   [props.note]       連絡事項
 */
export function printWeek(props) {
  let area = document.getElementById("print-area");   // 印刷用の入れ物（なければ作る）
  if (!area) {
    area = createElement("div", { id: "print-area" });
    document.body.appendChild(area);
  }
  // 「7-16」の短い形（ちょうどの時刻は分を省く）
  const shortTime = (minutes) => (minutes % 60 ? fmt(minutes) : String(minutes / 60 >= 24 ? `翌${minutes / 60 - 24}` : minutes / 60));
  /** その人のその日の勤務の文（例「9-15」） */
  const cell = (memberId, date) => props.assignments
    .filter((shift) => shift.memberId === memberId && shift.date === date)
    .sort((shiftA, shiftB) => shiftA.from - shiftB.from)
    .map((shift) => `${shortTime(shift.from)}-${shortTime(shift.to)}${shift.breakAt != null ? ` ○${shortTime(shift.breakAt)}` : ""}`)
    .join(" / ");
  // 社員を上、バイトを下。その週に1回も入っていない応援の人は出さない
  const shown = props.members.filter((member) => (member.rankHere ?? 1) === 1 || props.assignments.some((shift) => shift.memberId === member.id));
  const order = [...shown.filter((shift) => shift.kind === "shain"), ...shown.filter((shift) => shift.kind !== "shain")];   // 社員を上に並べた順

  mount(area,
    createElement("h1", null, props.title),
    createElement("table", null,
      createElement("thead", null, createElement("tr", null, createElement("th", null, "氏名"), props.dates.map((date) => createElement("th", null, label(date))))),
      createElement("tbody", null, order.map((member) => createElement("tr", { class: member.kind === "shain" ? "" : "is-baito" },
        createElement("th", null, member.name),
        props.dates.map((date) => createElement("td", null, cell(member.id, date))),
      ))),
    ),
    props.note ? createElement("p", null, `連絡事項：${props.note}`) : null,
  );
  window.print();
}
