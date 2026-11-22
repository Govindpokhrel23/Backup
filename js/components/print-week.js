// ============================================================
// components/print-week.js — 1週間のシフトを紙に印刷する（紙の「週間勤務予定表」と同じ形）
// ------------------------------------------------------------
// このファイルは、1週間のシフトを、今まで手で書いていた紙の
// 「コメダ珈琲 ○○店 週間勤務予定表」と同じ形で印刷するためのファイルです（2026年11月22日）。
//
// 紙の形：
//   ・A4横。月〜日の7日と「連絡事項」の8つの枠（横に4つ × 2段）
//   ・1つの枠：左に氏名、上に時刻（6〜12・1〜12）、右に「トータル時間」
//     社員が上、太い線のあとにバイト（毎日同じ並び）
//   ・勤務は、始まりから終わりまでの横の線（両はしに印）、休憩は ○
// 1日の枠は components/paper-day.js（公開シフトの画面と同じ部品）でかく。画面には出さず、印刷の時だけ出る（css の @media print）。
// iPhone で縦向きに印刷された時も、紙を横にして見られるように css で回す。
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品の道具を読む
import { toDate } from "../lib/date.js";   // 日付の道具を読む
import { paperDay, paperRows, svg } from "./paper-day.js";   // 紙と同じ1日の枠をかく道具を読む（2026年11月22日：画面と共通にした）

/** 1つの枠の大きさ（mm。A4横の 277×190mm に 4×2 で入る大きさ） */
const BOX_W = 67;       // 枠の横
const BOX_H = 86;       // 枠の縦

/** 連絡事項の枠（8つ目） */
function noteBox(note) {   // 連絡事項の枠を作る関数
  const root = svg("svg", { viewBox: `0 0 ${BOX_W} ${BOX_H}`, width: `${BOX_W}mm`, height: `${BOX_H}mm`, class: "paper-box" });   // 枠の絵
  root.append(svg("text", { x: BOX_W / 2, y: 4, "font-size": 2.8, "font-weight": 700, "text-anchor": "middle" }, "連 絡 事 項"));   // 見出し
  for (let y = 12; y < BOX_H; y += 7) root.append(svg("line", { x1: 2, y1: y, x2: BOX_W - 2, y2: y, stroke: "#000", "stroke-width": 0.15 }));   // 書く線
  // 連絡事項の文（あれば、線の上に1行ずつ。長い行は分ける）
  const lines = String(note || "").split(/\n/).flatMap((line) => line.match(/.{1,26}/g) || [""]).slice(0, 10);   // 26文字ずつ
  lines.forEach((line, index) => root.append(svg("text", { x: 3, y: 11 + index * 7, "font-size": 2.6 }, line)));   // 1行ずつ
  return root;   // 枠を返す
}

/**
 * 週のシフト表を印刷する
 * @param {object} props
 * @param {string}   props.storeName    店舗の名前（例「安城福釜店」）
 * @param {string}   props.title        画面用のタイトル（例「安城福釜店 11/9（月）〜 11/15（日）」）
 * @param {string[]} props.dates        7日分
 * @param {object[]} props.members      並べる店員
 * @param {object[]} props.assignments  その週の勤務（この店舗）
 * @param {string}   [props.note]       連絡事項
 * @param {boolean}  [props.draft]      下書き（公開前）か
 */
export function printWeek(props) {   // 週のシフト表を印刷する関数
  let area = document.getElementById("print-area");   // 印刷用の入れ物（なければ作る）
  if (!area) {   // 印刷用の場所がまだなければ
    area = createElement("div", { id: "print-area" });   // 印刷用の場所を作る
    document.body.appendChild(area);   // ページに置く
  }
  // 社員を上、バイトを下。その週に1回も入っていない応援の人は出さない
  const shown = props.members.filter((member) => (member.rankHere ?? 1) === 1 || props.assignments.some((shift) => shift.memberId === member.id));   // 表に出す人（その店の人か、入っている人）
  const { rows, split } = paperRows(shown);   // 社員を上に並べた順と、社員の人数
  const year = toDate(props.dates[0]).getFullYear();   // 年

  mount(area,   // 印刷用の場所に入れる
    createElement("div", { class: "paper" },   // 紙1枚
      createElement("div", { class: "paper__head" },   // 上の見出し
        createElement("span", { class: "paper__title" }, `コメダ珈琲　${props.storeName || ""}　週間勤務予定表　-${year}年-${props.draft ? "（下書き）" : ""}`),   // タイトル
        createElement("span", { class: "paper__company" }, "株式会社 21 CAFE")),   // 会社の名前
      createElement("div", { class: "paper__grid" },   // 8つの枠（4×2）
        props.dates.map((date) => paperDay({ date, rows, split, work: props.assignments, width: BOX_W, height: BOX_H, mm: true })),   // 7日（白黒）
        noteBox(props.note)),   // 連絡事項
    ),
  );
  window.print();   // 印刷の画面を開く
}
