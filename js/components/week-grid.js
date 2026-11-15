// ============================================================
// components/week-grid.js — 1週間のシフト表（店員 × 7日）
// ------------------------------------------------------------
// このファイルは、シフト作成の画面で「1週間を1枚で見る表」を作るファイルです（2026年11月10日）。
//
// ・たて：店員（社員 → バイト → 応援）／よこ：月〜日の7日
// ・マスには勤務の時間（例「9-15」）。左の色はホール（青）・キッチン（オレンジ）
// ・勤務がないマスには希望を小さく出す（休＝休み希望、○＝入れる、時間＝この時間なら入れる）
// ・ほかの店舗に入っている日は灰色で「安城」のように出す
// ・右はしはその人の週の時間、いちばん下はその日の人数
// ・マスを押すと、その日・その人の「1日」の画面に移って細かく直せる
// ============================================================

import { createElement } from "../lib/dom.js";                 // 画面の部品を作る道具を読む
import { label, today } from "../lib/date.js";                         // 日付を「11/16（月）」にする道具を読む
import { workedMinutes, hoursText } from "../lib/labor.js";     // 働いた時間の計算と表示の道具を読む

/** 休み希望の種類（入れない日） */
const OFF_KINDS = ["no", "off", "offx"];   // ×・休み希望・特別許可待ち

/**
 * 時間を短く書く（9:00 → 9、9:30 → 9:30）
 * @param {number} minutes 0時からの分
 */
function shortTime(minutes) {   // 時間を短い文字にする関数
  const hours = Math.floor(minutes / 60);   // 時
  const rest = minutes % 60;                 // 分
  return rest ? `${hours}:${String(rest).padStart(2, "0")}` : String(hours);   // 分があれば「9:30」、なければ「9」
}

/**
 * 1週間のシフト表を作る
 * @param {object} props
 * @param {string[]} props.dates          その週の7日
 * @param {object[]} props.members        表に出す店員
 * @param {object[]} props.assignments    この店舗の、この週の勤務
 * @param {object[]} props.elsewhere      ほかの店舗の、この週の勤務（storeShort つき）
 * @param {object[]} props.availabilities この週の希望
 * @param {Set<string>} props.problemDays 守れていないルールがある日
 * @param {Set<string>} [props.closedDays] お休みの日（店舗の設定で決めた日。2026年11月15日）
 * @param {string|null} props.selectedId  選んでいる店員
 * @param {(date:string, memberId:string|null) => void} props.onPick マスや日付を押した時
 */
export function weekGrid(props) {   // 1週間のシフト表を作る関数
  const main = (member) => (member.rankHere ?? 1) === 1;   // この店舗がメインの人か
  const helpsThisWeek = (member) => props.assignments.some((shift) => shift.memberId === member.id)   // 応援の人：この週に勤務がある
    || props.availabilities.some((hope) => hope.memberId === member.id && ["time", "any"].includes(hope.kind));   // か、入れる希望がある
  const groups = [   // 人のまとまり（見出しと人）
    ["社員", props.members.filter((member) => main(member) && member.kind === "shain")],   // メインの社員
    ["バイト", props.members.filter((member) => main(member) && member.kind !== "shain")],   // メインのバイト・フル
    ["応援", props.members.filter((member) => !main(member) && helpsThisWeek(member))],   // ほかの店舗からの応援
  ].filter(([, list]) => list.length);   // いない区切りは出さない

  return createElement("div", { class: "wk" },   // 横にスクロールできる入れ物
    createElement("table", { class: "wk__table" },   // 表
      createElement("thead", null,   // 見出し
        createElement("tr", null,   // 1行
          createElement("th", { class: "wk__corner" }, "名前"),   // 左上
          props.dates.map((date) => createElement("th", { class: `wk__day${date === today() ? " is-today" : ""}` },   // 今日は塗りつぶす（2026年11月15日）
              // 日付のマス
            createElement("button", { class: "wk__dayBtn", onclick: () => props.onPick(date, null), "aria-label": `${label(date)} を1日の画面で開く` },   // 押すとその日を開く
              createElement("span", { class: `wk__date${dayClass(date)}` }, String(Number(date.slice(8)))),   // 日にち（例「16」。紙のシフト表と同じく月は出さない。2026年11月15日）
              createElement("span", { class: `wk__dow${dayClass(date)}` }, label(date).match(/（(.)）/)?.[1] || ""),   // 「月」
              props.problemDays.has(date) ? createElement("span", { class: "wk__dot", "aria-label": "守れていないルールあり" }) : null,   // 問題がある日の赤い点
              props.closedDays?.has(date) ? createElement("span", { class: "wk__closed" }, "休業") : null))),   // お休みの日の印
          createElement("th", { class: "wk__sum" }, "週"),   // 右はし：週の時間
        ),
      ),
      createElement("tbody", null,   // 本体
        groups.map(([title, list]) => [   // まとまりごとに
          createElement("tr", { class: "wk__group" }, createElement("td", { colspan: props.dates.length + 2 }, title)),   // まとまりの見出し
          list.map((member) => memberRow(props, member)),   // 1人1行
        ]),
      ),
      createElement("tfoot", null,   // いちばん下
        createElement("tr", null,   // 人数の行
          createElement("th", { class: "wk__name" }, "人数"),   // 左
          props.dates.map((date) => createElement("td", { class: "wk__count" }, `${new Set(props.assignments.filter((shift) => shift.date === date).map((shift) => shift.memberId)).size}人`)),   // その日に入る人の数
          createElement("td", { class: "wk__sum" }, ""),   // 右はしは空
        ),
      ),
    ),
  );
}

/** 土曜は青、日曜は赤の文字にするための class */
function dayClass(date) {   // 曜日の色の class を出す関数
  const weekday = new Date(`${date}T12:00:00`).getDay();   // 曜日の番号（0＝日曜）
  return weekday === 0 ? " is-sun" : weekday === 6 ? " is-sat" : "";   // 日曜・土曜・平日
}

/** 1人の行（名前・7日のマス・週の時間） */
function memberRow(props, member) {   // 1人の行を作る関数
  const mine = props.assignments.filter((shift) => shift.memberId === member.id);   // その人のこの週の勤務
  const minutes = mine.reduce((sum, shift) => sum + workedMinutes(shift), 0);      // その人の週の働く時間（休憩を引く）
  return createElement("tr", { class: props.selectedId === member.id ? "is-selected" : "" },   // 行（選んでいれば色を変える）
    createElement("th", { class: "wk__name", scope: "row" }, member.name),   // 名前
    props.dates.map((date) => dayCell(props, member, date)),   // 7日のマス
    createElement("td", { class: "wk__sum" }, minutes ? hoursText(minutes).replace("時間", "h").replace("分", "") : ""),   // 週の時間（例「32h30」）
  );
}

/** 1つのマス（その人のその日） */
function dayCell(props, member, date) {   // 1つのマスを作る関数
  const shifts = props.assignments.filter((shift) => shift.memberId === member.id && shift.date === date).sort((first, second) => first.from - second.from);   // この店舗の勤務（早い順）
  const away = props.elsewhere.filter((shift) => shift.memberId === member.id && shift.date === date);   // ほかの店舗の勤務
  const hope = props.availabilities.find((item) => item.memberId === member.id && item.date === date);   // その日の希望
  const open = () => props.onPick(date, member.id);   // 押したら、その日・その人を開く

  let inside;   // マスの中身
  const closed = props.closedDays?.has(date) && !shifts.length;   // お休みの日で、勤務が入っていない
  if (closed) {   // お休みの日なら
    inside = createElement("span", { class: "wk__away" }, "－");   // 灰色の線（お店がお休み）
  } else if (shifts.length) {   // 勤務があれば
    inside = shifts.map((shift) => createElement("span", { class: `wk__shift wk__shift--${shift.area}${shift.fixed ? " is-fixed" : ""}` },   // 勤務（色は場所）
      createElement("span", null, shortTime(shift.from)), createElement("span", null, shortTime(shift.to))));   // 上に始まり、下に終わり（7日が1画面に入るように2行にする）
  } else if (away.length) {   // ほかの店舗に入っていれば
    inside = away.map((shift) => createElement("span", { class: "wk__away" }, shift.storeShort || "他店"));   // 灰色で店舗の名前
  } else if (hope && OFF_KINDS.includes(hope.kind)) {   // 休み希望なら
    inside = createElement("span", { class: "wk__off" }, hope.kind === "offx" ? "休?" : "休");   // 赤い「休」（特別許可待ちは「休?」）
  } else if (hope?.kind === "time") {   // 時間の希望なら
    inside = createElement("span", { class: "wk__hope" }, createElement("span", null, shortTime(hope.from)), createElement("span", null, shortTime(hope.to)));   // うすい色で希望の時間（2行）
  } else if (hope?.kind === "any") {   // いつでもOKなら
    inside = createElement("span", { class: "wk__hope" }, "○");   // うすい色の○
  } else {   // 何もなければ
    inside = null;   // 空のマス
  }
  return createElement("td", { class: `wk__cell${closed ? " is-closed" : ""}${date === today() ? " is-today" : ""}` },   // 今日の列は塗りつぶす   // マス
    createElement("button", { class: "wk__cellBtn", onclick: open, "aria-label": `${member.name} ${label(date)}` }, inside));   // 押せるマス
}
