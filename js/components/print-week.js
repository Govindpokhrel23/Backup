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
// 線や ○ は SVG（形を正確にかける絵）でかく。画面には出さず、印刷の時だけ出る（css の @media print）。
// iPhone で縦向きに印刷された時も、紙を横にして見られるように css で回す。
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品の道具を読む
import { toDate } from "../lib/date.js";   // 日付の道具を読む
import { workedMinutes } from "../lib/labor.js";   // 働いた時間（休憩を引く）の道具を読む

/** SVG の名前の場所（SVG の部品を作る時に使う） */
const SVG_NS = "http://www.w3.org/2000/svg";   // SVG の決まりの名前

/** 何時から何時までの目もりにするか（立ち上げの 6:30 が入るように 6 時から） */
const HOUR_FROM = 6;   // 6:00 から
const HOUR_TO = 24;    // 24:00 まで

/** 1つの枠の大きさ（mm。A4横の 277×190mm に 4×2 で入る大きさ） */
const BOX_W = 67;       // 枠の横
const BOX_H = 86;       // 枠の縦
const NAME_W = 12;      // 氏名の列
const TOTAL_W = 6;      // トータル時間の列
const HEAD_H = 9;       // 上の見出し（日付・曜日＋時刻）

/** 曜日の名前 */
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];   // 0＝日曜

/**
 * SVG の部品を作る
 * @param {string} tag  部品の名前（line・text など）
 * @param {object} attrs 形の決まり
 * @param {string} [text] 中の文字
 */
function svg(tag, attrs, text) {   // SVG の部品を作る関数
  const node = document.createElementNS(SVG_NS, tag);   // 部品を作る
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));   // 形の決まりを入れる（null は入れない）
  if (text != null) node.textContent = text;   // 文字があれば入れる（textContent なのでプログラムは動かない）
  return node;   // 部品を返す
}

/** 時刻の目もりの数字（12時間の書き方：13 → 1） */
function hourLabel(hour) {   // 目もりの数字を出す関数
  const h = hour % 12;   // 12で割ったあまり
  return String(h === 0 ? 12 : h);   // 0 は 12
}

/** 「8」「7.5」のような時間（トータル時間の列） */
function totalText(minutes) {   // 時間を短い文字にする関数
  if (!minutes) return "";   // なければ空
  const hours = minutes / 60;   // 時間
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, "");   // 8 / 7.5
}

/**
 * 1日分の枠をかく
 * @param {string} date        その日
 * @param {object[]} rows      並べる人（社員が上）
 * @param {number} split       社員とバイトの境目（何行目まで社員か）
 * @param {object[]} work      その週の勤務
 */
function dayBox(date, rows, split, work) {   // 1日の枠を作る関数
  const day = toDate(date);   // Date にしたもの
  const rowH = (BOX_H - HEAD_H) / Math.max(rows.length, 18);   // 1行の高さ（人が少なくても紙と同じくらいの高さ）
  const gridW = BOX_W - NAME_W - TOTAL_W;   // 時刻の部分の横はば
  const hourW = gridW / (HOUR_TO - HOUR_FROM);   // 1時間のはば
  const xOf = (minutes) => NAME_W + (Math.min(Math.max(minutes, HOUR_FROM * 60), HOUR_TO * 60) - HOUR_FROM * 60) / 60 * hourW;   // 時刻 → 横の位置
  const root = svg("svg", { viewBox: `0 0 ${BOX_W} ${BOX_H}`, width: `${BOX_W}mm`, height: `${BOX_H}mm`, class: "paper-box" });   // 枠の絵

  // ---- 見出し：「11月16日 月曜日」 ----
  root.append(svg("rect", { x: 0, y: 0, width: BOX_W, height: BOX_H, fill: "none", stroke: "#000", "stroke-width": 0.4 }));   // 外の枠
  root.append(svg("text", { x: 1.5, y: 3.6, "font-size": 3, "font-weight": 700 }, `${day.getMonth() + 1}月${day.getDate()}日`));   // 月日
  root.append(svg("text", { x: BOX_W / 2, y: 3.6, "font-size": 3, "font-weight": 700, "text-anchor": "middle" }, `${WEEKDAY[day.getDay()]}曜日`));   // 曜日
  root.append(svg("line", { x1: 0, y1: 4.8, x2: BOX_W, y2: 4.8, stroke: "#000", "stroke-width": 0.3 }));   // 見出しの下の線

  // ---- 時刻の目もり（6 7 8 … 12 1 2 …）と縦の線 ----
  root.append(svg("text", { x: NAME_W / 2, y: 7.8, "font-size": 2.2, "text-anchor": "middle" }, "氏名"));   // 「氏名」
  root.append(svg("text", { x: BOX_W - TOTAL_W / 2, y: 6.9, "font-size": 1.6, "text-anchor": "middle" }, "トータル"));   // 「トータル」
  root.append(svg("text", { x: BOX_W - TOTAL_W / 2, y: 8.6, "font-size": 1.6, "text-anchor": "middle" }, "時間"));   // 「時間」
  for (let hour = HOUR_FROM; hour <= HOUR_TO; hour++) {   // 1時間ごとに
    const x = NAME_W + (hour - HOUR_FROM) * hourW;   // 横の位置
    if (hour < HOUR_TO) root.append(svg("text", { x: x + hourW / 2, y: 7.9, "font-size": 2, "text-anchor": "middle" }, hourLabel(hour)));   // 時刻の数字
    root.append(svg("line", { x1: x, y1: 4.8, x2: x, y2: BOX_H, stroke: "#000", "stroke-width": 0.18 }));   // 1時間の線
    if (hour < HOUR_TO) root.append(svg("line", { x1: x + hourW / 2, y1: HEAD_H, x2: x + hourW / 2, y2: BOX_H, stroke: "#999", "stroke-width": 0.1, "stroke-dasharray": "0.6 0.6" }));   // 30分の点線
  }
  root.append(svg("line", { x1: NAME_W, y1: 4.8, x2: NAME_W, y2: BOX_H, stroke: "#000", "stroke-width": 0.3 }));   // 氏名の右の線
  root.append(svg("line", { x1: BOX_W - TOTAL_W, y1: 4.8, x2: BOX_W - TOTAL_W, y2: BOX_H, stroke: "#000", "stroke-width": 0.3 }));   // トータルの左の線
  root.append(svg("line", { x1: 0, y1: HEAD_H, x2: BOX_W, y2: HEAD_H, stroke: "#000", "stroke-width": 0.3 }));   // 時刻の下の線

  // ---- 1人1行 ----
  rows.forEach((member, index) => {   // 人ごとに
    const top = HEAD_H + index * rowH;   // 行の上
    const mid = top + rowH / 2;   // 行の真ん中
    root.append(svg("line", { x1: 0, y1: top + rowH, x2: BOX_W, y2: top + rowH, stroke: "#000", "stroke-width": index + 1 === split ? 0.6 : 0.12 }));   // 行の下の線（社員とバイトの境目は太く）
    root.append(svg("text", { x: 0.8, y: mid + 0.75, "font-size": Math.min(2.2, rowH * 0.62), textLength: [...member.name].length > 4 ? NAME_W - 1.4 : null, lengthAdjust: "spacingAndGlyphs" }, member.name));   // 名前
    const shifts = work.filter((shift) => shift.memberId === member.id && shift.date === date).sort((first, second) => first.from - second.from);   // その人のその日の勤務
    let total = 0;   // その日の時間
    for (const shift of shifts) {   // 勤務ごとに
      const x1 = xOf(shift.from), x2 = xOf(shift.to);   // 始まりと終わりの位置
      const tick = Math.min(1, rowH * 0.32);   // はしの印の高さ
      root.append(svg("line", { x1, y1: mid, x2, y2: mid, stroke: "#000", "stroke-width": 0.35 }));   // 勤務の線
      root.append(svg("polyline", { points: `${x1 + tick},${mid - tick} ${x1},${mid} ${x1 + tick},${mid + tick}`, fill: "none", stroke: "#000", "stroke-width": 0.3 }));   // 始まりの印「<」
      root.append(svg("polyline", { points: `${x2 - tick},${mid - tick} ${x2},${mid} ${x2 - tick},${mid + tick}`, fill: "none", stroke: "#000", "stroke-width": 0.3 }));   // 終わりの印「>」
      if (shift.breakAt != null) root.append(svg("circle", { cx: xOf(shift.breakAt), cy: mid, r: Math.min(0.95, rowH * 0.33), fill: "#fff", stroke: "#000", "stroke-width": 0.3 }));   // 休憩の ○
      total += workedMinutes(shift);   // 時間を足す
    }
    if (total) root.append(svg("text", { x: BOX_W - TOTAL_W / 2, y: mid + 0.75, "font-size": Math.min(2.2, rowH * 0.62), "text-anchor": "middle" }, totalText(total)));   // トータル時間
  });
  // 人が少ない時も、紙と同じように下まで行の線を引く
  for (let index = rows.length; index < Math.floor((BOX_H - HEAD_H) / rowH); index++) root.append(svg("line", { x1: 0, y1: HEAD_H + (index + 1) * rowH, x2: BOX_W, y2: HEAD_H + (index + 1) * rowH, stroke: "#000", "stroke-width": 0.12 }));   // 空の行の線
  if (split > 0 && split < rows.length) root.append(svg("line", { x1: 0, y1: HEAD_H + split * rowH, x2: BOX_W, y2: HEAD_H + split * rowH, stroke: "#000", "stroke-width": 0.6 }));   // 社員とバイトの境目
  return root;   // 枠を返す
}

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
  const shain = shown.filter((member) => member.kind === "shain");   // 社員
  const rows = [...shain, ...shown.filter((member) => member.kind !== "shain")];   // 社員を上に並べた順
  const year = toDate(props.dates[0]).getFullYear();   // 年

  mount(area,   // 印刷用の場所に入れる
    createElement("div", { class: "paper" },   // 紙1枚
      createElement("div", { class: "paper__head" },   // 上の見出し
        createElement("span", { class: "paper__title" }, `コメダ珈琲　${props.storeName || ""}　週間勤務予定表　-${year}年-${props.draft ? "（下書き）" : ""}`),   // タイトル
        createElement("span", { class: "paper__company" }, "株式会社 21 CAFE")),   // 会社の名前
      createElement("div", { class: "paper__grid" },   // 8つの枠（4×2）
        props.dates.map((date) => dayBox(date, rows, shain.length, props.assignments)),   // 7日
        noteBox(props.note)),   // 連絡事項
    ),
  );
  window.print();   // 印刷の画面を開く
}
