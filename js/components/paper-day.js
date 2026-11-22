// ============================================================
// components/paper-day.js — 1日のシフトを「紙の週間勤務予定表」と同じ形でかく
// ------------------------------------------------------------
// このファイルは、紙のシフト表の「1日の枠」と同じ見た目の絵（SVG）を作るファイルです（2026年11月22日）。
//   ・左に氏名、上に時刻（6 7 8 … 12 1 2 … 11）、右に「トータル時間」
//   ・社員が上、太い線のあとにバイト
//   ・勤務は横の線（両はしに < >）、休憩は ○
// 使う所：
//   ・components/print-week.js … 印刷（白黒・mm の大きさ）
//   ・screens/published.js     … 公開シフトの「日」（色つき・スマホの幅いっぱい）
// 文字は textContent で入れるので、名前にプログラムを入れられても動かない。
// ============================================================

import { toDate } from "../lib/date.js";   // 日付の道具を読む
import { workedMinutes } from "../lib/labor.js";   // 働いた時間（休憩を引く）の道具を読む

/** SVG の決まりの名前 */
const SVG_NS = "http://www.w3.org/2000/svg";   // SVG の部品を作る時に使う

/** 何時から何時までの目もりにするか（立ち上げの 6:30 が入るように 6 時から） */
export const HOUR_FROM = 6;   // 6:00 から
export const HOUR_TO = 24;    // 24:00 まで

/** 曜日の名前（0＝日曜） */
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];   // 曜日の文字

/** 色（場所ごと。白黒の時は黒） */
const COLORS = { hall: "#3F7DCB", kitchen: "#D9782D" };   // ホール＝青・キッチン＝オレンジ

/**
 * SVG の部品を作る（null の決まりは入れない）
 * @param {string} tag 部品の名前
 * @param {object} attrs 形の決まり
 * @param {string} [text] 中の文字
 */
export function svg(tag, attrs, text) {   // SVG の部品を作る関数
  const node = document.createElementNS(SVG_NS, tag);   // 部品を作る
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));   // 形の決まりを入れる
  if (text != null) node.textContent = text;   // 文字（プログラムとしては動かない）
  return node;   // 部品を返す
}

/** 目もりの数字（12時間の書き方：13 → 1） */
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
 * 1日の枠をかく
 * @param {object} props
 * @param {string}   props.date        その日
 * @param {object[]} props.rows        並べる人（社員が上）
 * @param {number}   props.split       何人目までが社員か（そこに太い線）
 * @param {object[]} props.work        勤務（ほかの日がまざっていてもよい）
 * @param {boolean}  [props.color]     色をつけるか（ホール＝青・キッチン＝オレンジ）
 * @param {string}   [props.selectedId] 色をつける人（自分）
 * @param {number}   [props.width]     枠の横（単位。印刷では mm）
 * @param {number}   [props.height]    枠の縦（決めれば行の高さを合わせる）
 * @param {number}   [props.rowH]      1行の高さ（height を決めない時）
 * @param {number}   [props.font]      名前の文字の大きさ
 * @param {boolean}  [props.mm]        印刷用（大きさを mm で決める）
 * @returns {SVGSVGElement} 枠の絵
 */
export function paperDay(props) {   // 1日の枠を作る関数
  const W = props.width ?? 67;   // 枠の横
  const NAME_W = W * 0.19;   // 氏名の列
  const TOTAL_W = W * 0.09;   // トータル時間の列
  const HEAD_H = 9;   // 上の見出し（日付・曜日＋時刻）
  const minRows = props.height ? 18 : props.rows.length;   // 印刷では人が少なくても18行分の高さ
  const rowH = props.height ? (props.height - HEAD_H) / Math.max(props.rows.length, minRows) : (props.rowH ?? 4.6);   // 1行の高さ
  const H = props.height ?? HEAD_H + rowH * props.rows.length;   // 枠の縦
  const font = props.font ?? Math.min(2.2, rowH * 0.62);   // 名前の文字
  const hourW = (W - NAME_W - TOTAL_W) / (HOUR_TO - HOUR_FROM);   // 1時間のはば
  const xOf = (minutes) => NAME_W + (Math.min(Math.max(minutes, HOUR_FROM * 60), HOUR_TO * 60) - HOUR_FROM * 60) / 60 * hourW;   // 時刻 → 横の位置
  const ink = (shift) => (props.color ? COLORS[shift.area] || "#000" : "#000");   // 線の色
  const day = toDate(props.date);   // Date にしたもの
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: props.mm ? `${W}mm` : "100%", height: props.mm ? `${H}mm` : null, class: "paper-box", role: "img", "aria-label": `${day.getMonth() + 1}月${day.getDate()}日のシフト` });   // 枠の絵

  // ---- 見出し：「11月16日 月曜日」 ----
  root.append(svg("rect", { x: 0.2, y: 0.2, width: W - 0.4, height: H - 0.4, fill: "#fff", stroke: "#000", "stroke-width": 0.4 }));   // 外の枠
  root.append(svg("text", { x: 1.5, y: 3.6, "font-size": 3, "font-weight": 700 }, `${day.getMonth() + 1}月${day.getDate()}日`));   // 月日
  root.append(svg("text", { x: W / 2, y: 3.6, "font-size": 3, "font-weight": 700, "text-anchor": "middle" }, `${WEEKDAY[day.getDay()]}曜日`));   // 曜日
  root.append(svg("line", { x1: 0, y1: 4.8, x2: W, y2: 4.8, stroke: "#000", "stroke-width": 0.3 }));   // 見出しの下の線

  // ---- 自分の行の色（画面の時） ----
  const mine = props.rows.findIndex((member) => member.id === props.selectedId);   // 自分の行
  if (mine >= 0) root.append(svg("rect", { x: 0, y: HEAD_H + mine * rowH, width: W, height: rowH, fill: "#FBEFD9" }));   // うすい黄色

  // ---- 時刻の目もりと縦の線 ----
  root.append(svg("text", { x: NAME_W / 2, y: 7.8, "font-size": 2.2, "text-anchor": "middle" }, "氏名"));   // 「氏名」
  root.append(svg("text", { x: W - TOTAL_W / 2, y: 6.9, "font-size": Math.min(1.6, TOTAL_W * 0.25), "text-anchor": "middle" }, "トータル"));   // 「トータル」
  root.append(svg("text", { x: W - TOTAL_W / 2, y: 8.6, "font-size": 1.6, "text-anchor": "middle" }, "時間"));   // 「時間」
  for (let hour = HOUR_FROM; hour <= HOUR_TO; hour++) {   // 1時間ごとに
    const x = NAME_W + (hour - HOUR_FROM) * hourW;   // 横の位置
    if (hour < HOUR_TO) root.append(svg("text", { x: x + hourW / 2, y: 7.9, "font-size": Math.min(2, hourW * 0.8), "text-anchor": "middle" }, hourLabel(hour)));   // 時刻の数字
    root.append(svg("line", { x1: x, y1: 4.8, x2: x, y2: H, stroke: "#000", "stroke-width": 0.18 }));   // 1時間の線
    if (hour < HOUR_TO) root.append(svg("line", { x1: x + hourW / 2, y1: HEAD_H, x2: x + hourW / 2, y2: H, stroke: "#999", "stroke-width": 0.1, "stroke-dasharray": "0.6 0.6" }));   // 30分の点線
  }
  root.append(svg("line", { x1: NAME_W, y1: 4.8, x2: NAME_W, y2: H, stroke: "#000", "stroke-width": 0.3 }));   // 氏名の右の線
  root.append(svg("line", { x1: W - TOTAL_W, y1: 4.8, x2: W - TOTAL_W, y2: H, stroke: "#000", "stroke-width": 0.3 }));   // トータルの左の線
  root.append(svg("line", { x1: 0, y1: HEAD_H, x2: W, y2: HEAD_H, stroke: "#000", "stroke-width": 0.3 }));   // 時刻の下の線

  // ---- 1人1行 ----
  props.rows.forEach((member, index) => {   // 人ごとに
    const top = HEAD_H + index * rowH;   // 行の上
    const mid = top + rowH / 2;   // 行の真ん中
    root.append(svg("line", { x1: 0, y1: top + rowH, x2: W, y2: top + rowH, stroke: "#000", "stroke-width": 0.12 }));   // 行の下の線
    root.append(svg("text", { x: 0.8, y: mid + font * 0.35, "font-size": font, "font-weight": index === mine ? 700 : null, textLength: [...member.name].length * font > NAME_W - 1.4 ? NAME_W - 1.4 : null, lengthAdjust: "spacingAndGlyphs" }, member.name));   // 名前（長い名前は枠に入るよう縮める）
    const shifts = props.work.filter((shift) => shift.memberId === member.id && shift.date === props.date).sort((first, second) => first.from - second.from);   // その人のその日の勤務
    let total = 0;   // その日の時間
    for (const shift of shifts) {   // 勤務ごとに
      const x1 = xOf(shift.from), x2 = xOf(shift.to);   // 始まりと終わりの位置
      const tick = Math.min(1, rowH * 0.32);   // はしの印の大きさ
      const color = ink(shift);   // 線の色
      const width = props.color ? 0.55 : 0.35;   // 線の太さ（色つきは少し太く）
      root.append(svg("line", { x1, y1: mid, x2, y2: mid, stroke: color, "stroke-width": width }));   // 勤務の線
      root.append(svg("polyline", { points: `${x1 + tick},${mid - tick} ${x1},${mid} ${x1 + tick},${mid + tick}`, fill: "none", stroke: color, "stroke-width": width * 0.85 }));   // 始まりの印「<」
      root.append(svg("polyline", { points: `${x2 - tick},${mid - tick} ${x2},${mid} ${x2 - tick},${mid + tick}`, fill: "none", stroke: color, "stroke-width": width * 0.85 }));   // 終わりの印「>」
      if (shift.breakAt != null) root.append(svg("circle", { cx: xOf(shift.breakAt), cy: mid, r: Math.min(0.95, rowH * 0.33), fill: "#fff", stroke: color, "stroke-width": width * 0.85 }));   // 休憩の ○
      total += workedMinutes(shift);   // 時間を足す
    }
    if (total) root.append(svg("text", { x: W - TOTAL_W / 2, y: mid + font * 0.35, "font-size": font, "text-anchor": "middle" }, totalText(total)));   // トータル時間
  });
  // 人が少ない時も、紙と同じように下まで行の線を引く（印刷）
  for (let index = props.rows.length; index < Math.floor((H - HEAD_H) / rowH + 0.001); index++) root.append(svg("line", { x1: 0, y1: HEAD_H + (index + 1) * rowH, x2: W, y2: HEAD_H + (index + 1) * rowH, stroke: "#000", "stroke-width": 0.12 }));   // 空の行の線
  if (props.split > 0 && props.split < props.rows.length) root.append(svg("line", { x1: 0, y1: HEAD_H + props.split * rowH, x2: W, y2: HEAD_H + props.split * rowH, stroke: "#000", "stroke-width": 0.6 }));   // 社員とバイトの境目（太い線）
  return root;   // 枠を返す
}

/**
 * 並べる順（社員が上、そのあとバイト）と、社員の人数
 * @param {object[]} members 店員
 * @returns {{rows:object[], split:number}}
 */
export function paperRows(members) {   // 並べる順を決める関数
  const shain = members.filter((member) => member.kind === "shain");   // 社員
  return { rows: [...shain, ...members.filter((member) => member.kind !== "shain")], split: shain.length };   // 社員が上
}
