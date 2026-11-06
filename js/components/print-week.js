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

import { createElement, mount } from "../lib/dom.js";   // 画面の部品の道具を読む
import { fmt } from "../lib/time.js";   // 時間の表示の道具を読む
import { label } from "../lib/date.js";   // 日付の表示の道具を読む

/**
 * @param {object} props
 * @param {string}   props.title        例：「安城福釜店 11/9（月）〜 11/15（日）」
 * @param {string[]} props.dates        7日分
 * @param {object[]} props.members      並べる店員
 * @param {object[]} props.assignments  その週の勤務（この店舗）
 * @param {string}   [props.note]       連絡事項
 */
export function printWeek(props) {   // 週のシフト表を印刷する関数
  let area = document.getElementById("print-area");   // 印刷用の入れ物（なければ作る）
  if (!area) {   // 印刷用の場所がまだなければ
    area = createElement("div", { id: "print-area" });   // 印刷用の場所を作る
    document.body.appendChild(area);   // ページに置く
  }
  // 「7-16」の短い形（ちょうどの時刻は分を省く）
  const shortTime = (minutes) => (minutes % 60 ? fmt(minutes) : String(minutes / 60 >= 24 ? `翌${minutes / 60 - 24}` : minutes / 60));   // 時間を短く書く（9:00 → 9）
  /** その人のその日の勤務の文（例「9-15」） */
  const cell = (memberId, date) => props.assignments   // その人のその日のマスの中身を作る
    .filter((shift) => shift.memberId === memberId && shift.date === date)   // その人のその日の勤務だけ
    .sort((shiftA, shiftB) => shiftA.from - shiftB.from)   // 早い順
    .map((shift) => `${shortTime(shift.from)}-${shortTime(shift.to)}${shift.breakAt != null ? ` ○${shortTime(shift.breakAt)}` : ""}`)   // 「9-15 ○12」の形（○は休憩）
    .join(" / ");   // 2つ以上なら / でつなぐ
  // 社員を上、バイトを下。その週に1回も入っていない応援の人は出さない
  const shown = props.members.filter((member) => (member.rankHere ?? 1) === 1 || props.assignments.some((shift) => shift.memberId === member.id));   // 表に出す人（その店の人か、入っている人）
  const order = [...shown.filter((shift) => shift.kind === "shain"), ...shown.filter((shift) => shift.kind !== "shain")];   // 社員を上に並べた順

  mount(area,   // 印刷用の場所に入れる
    createElement("h1", null, props.title),   // 表のタイトル
    createElement("table", null,   // 表
      createElement("thead", null, createElement("tr", null, createElement("th", null, "氏名"), props.dates.map((date) => createElement("th", null, label(date))))),   // 見出しの行（氏名と7日）
      createElement("tbody", null, order.map((member) => createElement("tr", { class: member.kind === "shain" ? "" : "is-baito" },   // 1人1行（バイトは色を変える）
        createElement("th", null, member.name),   // 名前
        props.dates.map((date) => createElement("td", null, cell(member.id, date))),   // 7日分のマス
      ))),
    ),
    props.note ? createElement("p", null, `連絡事項：${props.note}`) : null,   // 連絡事項があれば下に出す
  );
  window.print();   // 印刷の画面を開く
}
