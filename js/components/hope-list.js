// ============================================================
// components/hope-list.js — 希望の一覧（店舗ごと）
// ------------------------------------------------------------
// このファイルは、シフト作成の画面のいちばん上に出す「希望の一覧」を作るファイルです（2026年11月15日）。
//
// ・店舗の名前（例「福釜」）の見出し → その下に、その店舗がメインの人の一覧
//   今見ている店舗をいちばん上に、ほかの店舗（応援に来られる人）はその下
// ・1人1行：名前 ／ 月〜日の希望 ／ 提出したか
//     × ＝入れない　○ ＝いつでもOK　9-15 ＝時間指定　休 ＝休み希望　休? ＝特別許可待ち
//     社員は、休み希望がない日は「出」（入れる）
// ・「▼」で閉じられる（閉じたかどうかは、このスマホに覚える）
// ============================================================

import { createElement } from "../lib/dom.js";   // 画面の部品を作る道具を読む
import { label } from "../lib/date.js";   // 日付を「11/16（月）」にする道具を読む

/** 閉じたかどうかを覚える名前 */
const OPEN_KEY = "shiftapp-hope-list-open";   // このスマホに覚える名前

/** 時刻を短く（540 → "9"、570 → "9:30"） */
function shortTime(minutes) {   // 時刻を短い文字にする関数
  const hours = Math.floor(minutes / 60);   // 時
  const rest = minutes % 60;   // 分
  return rest ? `${hours}:${String(rest).padStart(2, "0")}` : String(hours);   // 分があれば「9:30」
}

/**
 * 1つのマスの文字と色
 * @returns {{text:string, cls:string}}
 */
function cellOf(member, hope) {   // マスの中身を決める関数
  if (!hope) return member.kind === "shain" ? { text: "出", cls: "is-any is-soft" } : { text: "", cls: "" };   // 希望なし（社員は入れる）
  if (hope.kind === "no") return { text: "×", cls: "is-no" };   // 入れない
  if (hope.kind === "off") return { text: "休", cls: "is-off" };   // 休み希望
  if (hope.kind === "offx") return { text: "休?", cls: "is-off" };   // 特別許可待ち
  if (hope.kind === "any") return { text: "○", cls: "is-any" };   // いつでもOK
  if (hope.kind === "time") return { text: `${shortTime(hope.from)}-${shortTime(hope.to)}`, cls: "is-time" };   // 時間指定
  return { text: "", cls: "" };   // それ以外
}

/** 開いているか（覚えていなければ開く） */
function readOpen() {   // 開いているか読む関数
  try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }   // 読めない時は開く
}

/**
 * 希望の一覧を作る
 * @param {object} props
 * @param {string[]} props.dates          その週の7日
 * @param {object[]} props.members        この店舗で働ける人（応援も）
 * @param {object[]} props.availabilities この週の希望
 * @param {object[]} props.stores         会社の店舗（名前を出す）
 * @param {string}   props.storeId        今見ている店舗
 * @param {(date:string, memberId:string)=>void} [props.onPick] 名前やマスを押した時（その日を開く）
 */
export function hopeList(props) {   // 希望の一覧を作る関数
  const people = props.members.filter((member) => member.active !== false && member.role !== "manager" && !member.developer);   // 希望を出す人（店長・開発者はのぞく）
  const sent = (member) => props.availabilities.some((hope) => hope.memberId === member.id);   // 希望を出したか
  const sentCount = people.filter((member) => member.kind === "shain" || sent(member)).length;   // 出した人の数（社員は出さなくても入れる）

  // 店舗ごとに分ける（今の店舗がいちばん上）
  const order = [props.storeId, ...props.stores.map((store) => store.id).filter((id) => id !== props.storeId)];   // 店舗の順番
  const groups = order   // 店舗ごとに
    .map((storeId) => ({ store: props.stores.find((store) => store.id === storeId), list: people.filter((member) => member.storeId === storeId) }))   // その店舗がメインの人
    .filter((group) => group.store && group.list.length)   // いない店舗は出さない
    .map((group) => ({ ...group, list: group.list.sort((memberA, memberB) => kindRank(memberA) - kindRank(memberB)) }));   // 社員 → フル → バイト の順

  const box = createElement("details", { class: "card hope-list", open: readOpen() || null },   // 開け閉めできるカード
    createElement("summary", { class: "hope-list__summary" },   // 見出し（押すと開け閉め）
      createElement("strong", null, "希望の一覧"),   // タイトル
      createElement("span", { class: "home-muted" }, `出した人 ${sentCount}/${people.length}人`)),   // 出した人の数
    createElement("div", { class: "hope-list__scroll" },   // 横にスクロールできる入れ物
      createElement("table", { class: "hope-list__table" },   // 表
        createElement("thead", null, createElement("tr", null,   // 見出しの行
          createElement("th", { class: "hope-list__name" }, "名前"),   // 名前
          props.dates.map((date) => createElement("th", { class: dayClass(date) },   // 日付のマス（土曜は青・日曜は赤）
            createElement("span", { class: "hope-list__date" }, String(Number(date.slice(8)))),   // 日にち（例「16」）
            createElement("span", { class: "hope-list__dow" }, label(date).match(/（(.)）/)?.[1] || ""))),   // 曜日（例「月」）
        )),
        groups.map((group) => createElement("tbody", null,   // 店舗ごとのまとまり
          createElement("tr", { class: "hope-list__store" }, createElement("th", { colspan: props.dates.length + 1 }, `${group.store.short}（${group.list.length}人）`)),   // 店舗の見出し（例「福釜（15人）」）
          group.list.map((member) => createElement("tr", null,   // 1人1行
            createElement("th", { class: "hope-list__name" },   // 名前
              member.name,   // 名前
              member.kind !== "shain" && !sent(member) ? createElement("span", { class: "hope-list__miss" }, "未提出") : null),   // 出していない印
            props.dates.map((date) => {   // 7日
              const cell = cellOf(member, props.availabilities.find((hope) => hope.memberId === member.id && hope.date === date));   // マスの中身
              return createElement("td", { class: `hope-list__cell ${cell.cls}`, onclick: props.onPick ? () => props.onPick(date, member.id) : null }, cell.text);   // マス
            }),
          )),
        )),
      ),
    ),
    createElement("div", { class: "home-muted hope-list__help" }, "×＝入れない　○＝いつでもOK　9-15＝時間指定　休＝休み希望　休?＝特別許可待ち　出＝社員（休み希望なし）"),   // 記号の説明
  );
  box.addEventListener("toggle", () => { try { localStorage.setItem(OPEN_KEY, box.open ? "1" : "0"); } catch { /* 覚えられなくても使える */ } });   // 開け閉めを覚える
  return box;   // カードを返す
}

/** 土曜は青、日曜は赤の class */
function dayClass(date) {   // 曜日の色の class を出す関数
  const weekday = new Date(`${date}T12:00:00`).getDay();   // 曜日の番号（0＝日曜）
  return weekday === 0 ? "is-sun" : weekday === 6 ? "is-sat" : "";   // 日曜・土曜・平日
}

/** 並べる順番（社員 → フル → バイト） */
function kindRank(member) {   // 立場の順番を出す関数
  return { shain: 0, full: 1, baito: 2 }[member.kind] ?? 3;   // 社員が先
}
