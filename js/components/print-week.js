// ============================================================
// components/print-week.js — 1週間のシフトを紙に印刷する
// ------------------------------------------------------------
// お店に貼る紙のシフト表のかわり。印刷ボタンを押すと、
//   ・横：月〜日、縦：名前（社員が上、バイトが下）
//   ・マスに「7-16」のように時間、休憩は「○12」
// の表を作って、ブラウザの印刷を開く（PDFにも保存できる）。
// 画面には出さず、印刷の時だけ出る（css の @media print）。
// ============================================================

import { h, mount } from "../lib/dom.js";
import { fmt } from "../lib/time.js";
import { label } from "../lib/date.js";

/**
 * @param {object} p
 * @param {string}   p.title        例：「安城福釜店 11/9（月）〜 11/15（日）」
 * @param {string[]} p.dates        7日分
 * @param {object[]} p.members      並べる店員
 * @param {object[]} p.assignments  その週の勤務（この店舗）
 * @param {string}   [p.note]       連絡事項
 */
export function printWeek(p) {
  let area = document.getElementById("print-area");
  if (!area) {
    area = h("div", { id: "print-area" });
    document.body.appendChild(area);
  }
  // 「7-16」の短い形（ちょうどの時刻は分を省く）
  const t = (m) => (m % 60 ? fmt(m) : String(m / 60 >= 24 ? `翌${m / 60 - 24}` : m / 60));
  const cell = (memberId, date) => p.assignments
    .filter((a) => a.memberId === memberId && a.date === date)
    .sort((a, b) => a.from - b.from)
    .map((a) => `${t(a.from)}-${t(a.to)}${a.breakAt != null ? ` ○${t(a.breakAt)}` : ""}`)
    .join(" / ");
  // 社員を上、バイトを下。その週に1回も入っていない応援の人は出さない
  const shown = p.members.filter((m) => (m.rankHere ?? 1) === 1 || p.assignments.some((a) => a.memberId === m.id));
  const order = [...shown.filter((m) => m.kind === "shain"), ...shown.filter((m) => m.kind !== "shain")];

  mount(area,
    h("h1", null, p.title),
    h("table", null,
      h("thead", null, h("tr", null, h("th", null, "氏名"), p.dates.map((d) => h("th", null, label(d))))),
      h("tbody", null, order.map((m) => h("tr", { class: m.kind === "shain" ? "" : "is-baito" },
        h("th", null, m.name),
        p.dates.map((d) => h("td", null, cell(m.id, d))),
      ))),
    ),
    p.note ? h("p", null, `連絡事項：${p.note}`) : null,
  );
  window.print();
}
