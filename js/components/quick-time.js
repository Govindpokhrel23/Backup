// ============================================================
// components/quick-time.js — 時間をすぐ直す小さい画面
// ------------------------------------------------------------
// このファイルは、シフト作成の「日」の見方で、人の行を2回タップした時に出る
// 小さい画面（ダイアログ）を作るファイルです（2026年11月15日）。
//
// ・いちばん上にその人の希望（例「希望：7:00〜17:00」）
// ・その下で、始まり・終わりを選んで時間を変える（1時間ごと。分はなし）
// ・勤務がない日は、ここで勤務を足せる
// ・「この日は入れない（消す）」にチェックすると、その日の勤務を消す
// 保存すると onSave({from, to}) か onSave({remove:true}) を呼ぶ。やめたら何もしない
// ============================================================

import { createElement, confirmDialog, toast } from "../lib/dom.js";   // 画面の部品・小さい画面・お知らせの道具を読む
import { fmt, EDIT_MIN, EDIT_MAX } from "../lib/time.js";   // 時刻を文字にする道具・選べる時間のはばを読む
import { label } from "../lib/date.js";   // 日付を「11/16（月）」にする道具を読む
import { openStart } from "../lib/roles.js";   // 立ち上げの人が入る時刻を読む（2026年11月17日）

/** 1時間ごとの時刻の一覧（5:00〜翌2:00） */
const HOURS = Array.from({ length: (EDIT_MAX - EDIT_MIN) / 60 + 1 }, (_, index) => EDIT_MIN + index * 60);   // 300, 360, … 1560

/** 希望を文にする（例「希望：7:00〜17:00」） */
function hopeText(hope, member) {   // 希望の文を作る関数
  if (!hope) return member.kind === "shain" ? "希望：なし（社員なので入れる）" : "希望：まだ出していません";   // 希望なし
  if (hope.kind === "time") return `希望：${fmt(hope.from)}〜${fmt(hope.to)}`;   // 時間指定
  if (hope.kind === "any") return "希望：いつでもOK";   // いつでも
  if (hope.kind === "no") return "希望：入れない";   // 入れない
  if (hope.kind === "off") return "希望：休み";   // 休み希望
  if (hope.kind === "offx") return "希望：休み（特別許可待ち）";   // 特別許可待ち
  return "希望：なし";   // それ以外
}

/** 一番近い「ちょうどの時刻」にする（9:30 → 10:00 ではなく 9:00。はばの中に入れる） */
function toHour(minutes) {   // 1時間ごとに丸める関数
  return Math.min(EDIT_MAX, Math.max(EDIT_MIN, Math.floor(minutes / 60) * 60));   // 下の時刻にそろえる
}

/** 時刻を選ぶ欄（1時間ごと。extra があれば、その時刻も足す＝立ち上げの 6:30 など） */
function hourSelect(value, aria, extra = []) {   // 時刻を選ぶ欄を作る関数
  const list = [...new Set([...HOURS, ...extra])].sort((first, second) => first - second);   // 選べる時刻
  return createElement("select", { class: "select num quick-time__select", "aria-label": aria },   // 選ぶ欄
    list.map((minutes) => createElement("option", { value: minutes, selected: minutes === value }, fmt(minutes))));   // 1時間ごと
}

/**
 * 時間をすぐ直す小さい画面を出す
 * @param {object} props
 * @param {object} props.member 人
 * @param {string} props.date   日付
 * @param {object|null} props.shift 今の勤務（なければ null＝足す）
 * @param {object|null} props.hope  その日の希望
 * @param {{open:number,close:number}} [props.hours] その日の営業時間（立ち上げの 6:30 を選べるように）
 * @param {({from:number,to:number}|{remove:true}) => void} props.onSave 保存した時
 */
export async function openQuickTime({ member, date, shift, hope, hours, onSave }) {   // 小さい画面を出す関数
  const opener = hours ? openStart(hours) : null;   // 立ち上げの時刻（例 6:30）。始まりだけ選べる
  const isOpener = (minutes) => opener != null && minutes === opener;   // 立ち上げの時刻か
  // はじめの時間：勤務があればその時間、なければ希望の時間、なければ 9:00〜17:00
  const start = shift ? shift.from : hope?.kind === "time" ? hope.from : 9 * 60;   // 始まり
  const end = shift ? shift.to : hope?.kind === "time" ? hope.to : 17 * 60;   // 終わり
  const fromValue = isOpener(start) ? start : toHour(start);   // 始まり（立ち上げの時刻はそのまま）
  const fromBox = hourSelect(fromValue, "始まり", opener != null ? [opener] : []);   // 始まりを選ぶ欄（立ち上げの時刻も選べる）
  const endExtra = isOpener(start) && end % 60 ? [end] : [];   // 立ち上げの人の今の終わり（15:30 など）は残す
  const toBox = hourSelect(endExtra.length ? end : Math.max(toHour(end), toHour(start) + 60), "終わり", endExtra);   // 終わりを選ぶ欄
  const removeBox = createElement("input", { type: "checkbox" });   // 消すチェック
  const ok = await confirmDialog({   // 小さい画面
    title: `${member.name}　${label(date)}`,   // タイトル（名前と日付）
    body: createElement("div", { class: "quick-time" },   // 中身
      createElement("div", { class: `quick-time__hope ${hope && ["no", "off", "offx"].includes(hope.kind) ? "is-off" : ""}` }, hopeText(hope, member)),   // 希望
      createElement("div", { class: "quick-time__row" }, fromBox, "〜", toBox),   // 始まり〜終わり
      createElement("div", { class: "home-muted" }, shift ? `今：${fmt(shift.from)}〜${fmt(shift.to)}（1時間ごとに選べます）` : "この日はまだ勤務がありません。保存すると足します"),   // 今の時間
      shift ? createElement("label", { class: "quick-time__remove" }, removeBox, "この日は入れない（勤務を消す）") : null,   // 消すチェック
    ),
    yes: "保存",   // 保存ボタン
    no: "やめる",   // やめるボタン
  });
  if (!ok) return;   // やめたら何もしない
  if (removeBox.checked) { onSave({ remove: true }); return; }   // 消す
  const from = Number(fromBox.value), to = Number(toBox.value);   // 選んだ時間
  if (to <= from) { toast("終わりは始まりより後にしてください"); return; }   // おかしければ止める
  onSave({ from, to });   // 保存
}
