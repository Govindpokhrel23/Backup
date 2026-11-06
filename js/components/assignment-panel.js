// ============================================================
// components/assignment-panel.js — シフト作成の右の欄（1人分）
// ------------------------------------------------------------
// このファイルは、シフト作成の右の欄（1人分）のファイルです。
// 店長が、選んだ人のその日の勤務を自由に直すための道具：
//   ・公開したあとは「編集する」を押すまで直せない（locked）
//   ・時間（5:00〜翌2:00、15分刻み）
//   ・ホール／キッチン、休憩の目安（あり・なし・時刻）、固定
//   ・別の人に移す
//   ・1日に2つ以上の勤務（中抜け）も足せる
//   ・消す
// 変える時は必ず onEdit(関数) を通す → 「元に戻す」ができる
// ============================================================

import { createElement } from "../lib/dom.js";
import { CONFIG } from "../config.js";
import { fmt, range, timeOptions, EDIT_MIN, EDIT_MAX } from "../lib/time.js";
import { defaultBreak, breakWindow } from "../lib/breaks.js";

/**
 * @param {object} props
 * @param {object}   props.member        選んだ店員
 * @param {string}   props.date          日付
 * @param {object[]} props.assignments   この人のその日の勤務（0個以上）
 * @param {object}   [props.hope]        この人のその日の希望
 * @param {string}   props.rule          人ごとのルール（店長メモ）
 * @param {object[]} props.others        移す先にできる店員
 * @param {(fn:()=>void)=>void} props.onEdit       変える時に呼ぶ
 * @param {()=>void} props.onAdd         勤務を足す
 * @param {(a:object)=>void} props.onRemove     勤務を消す
 * @param {()=>void} [props.onApproveSpecial]   特別許可を出す
 * @param {boolean}  [props.locked]      公開済みで直せない時は見るだけ
 * @param {string}   [props.weekText]    この週の働く時間（例：「この週 32時間（5日）」）
 * @param {object[]} [props.elsewhere]   その日ほかの店舗に入っている勤務（storeShort つき）
 */
export function assignmentPanel(props) {
  const member = props.member;   // 選んだ店員
  const hope = props.hope;   // その日の希望
  const hopeText = !hope   // 希望を文にしたもの
    ? (member.kind === "shain" ? "出していない（休みは週1日）" : "出していない")
    : { no: "入れない", any: "いつでもOK", off: "休み希望", offx: "休み希望（特別許可の申請中）", time: range(hope.from ?? 0, hope.to ?? 0) }[hope.kind];

  return createElement("section", { class: "card" },
    createElement("div", { class: "screen-header__row" },
      createElement("h2", { class: "card__title", style: { fontSize: "19px" } }, member.name),
      createElement("span", { class: "badge" }, CONFIG.KIND_LABEL[member.kind]),
    ),
    createElement("div", { class: "home-muted" }, `できること：${CONFIG.SKILLS.map((skill) => `${skill.label}${member.skills[skill.key]}`).join("・")}`),
    createElement("div", { class: "rule-memo" }, `店長メモ：${props.rule}`),
    createElement("div", null, `希望：${hopeText}`),
    props.weekText ? createElement("div", { class: "home-muted" }, props.weekText) : null,
    // AIがこの人をこの時間にした理由（AIで作成した勤務だけ。2026年11月5日）
    props.assignments.filter((shift) => shift.reason).map((shift) => createElement("div", { class: "ai-reason" }, createElement("strong", null, "AIの理由"), `${range(shift.from, shift.to)}：${shift.reason}`)),
    hope?.kind === "offx" && props.onApproveSpecial
      ? createElement("button", { class: "btn btn--small", onclick: props.onApproveSpecial }, "特別許可を出す（休みにする）")
      : null,

    // ほかの店舗に入っている時間（重ねないように見せる）
    (props.elsewhere || []).map((shift) => createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } }, `この日は ${shift.storeShort} に ${range(shift.from, shift.to)} 入っています`)),

    // 公開済みで「編集する」を押していない時は、見るだけ
    props.locked
      ? props.assignments.map((shift) => createElement("div", { class: "work-edit" },
          createElement("strong", { class: "num" }, range(shift.from, shift.to)),
          createElement("span", { class: "home-muted" }, `${shift.area === "hall" ? "ホール" : "キッチン"}${shift.breakAt != null ? ` ・ 休憩 ${fmt(shift.breakAt)}` : ""}`)))
      : props.assignments.map((shift, index) => workEditor(props, shift, index, props.assignments.length)),

    props.locked ? null : createElement("button", { class: "btn btn--dashed", onclick: props.onAdd },
      props.assignments.length
        ? "＋ もう1つ勤務を足す（中抜けなど）"
        : hope?.kind === "time" ? `＋ 希望の時間（${range(hope.from, hope.to)}）で入れる` : "＋ 勤務を追加"),
  );
}

/** 勤務1つ分の編集 */
function workEditor(props, shift, index, count) {
  /** 時刻を選ぶセレクト（value＝今の時刻、onPick＝選んだ時） */
  const sel = (value, onPick, aria, from = EDIT_MIN, to = EDIT_MAX) =>
    createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => props.onEdit(() => onPick(Number(event.target.value))) },
      timeOptions(from, to).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));

  return createElement("div", { class: "work-edit" },
    count > 1 ? createElement("div", { class: "home-muted" }, `勤務 ${index + 1}`) : null,
    createElement("div", { class: "time-range" },
      sel(shift.from, (value) => { shift.from = value; if (shift.to <= value) shift.to = value + 60; }, "開始"),
      "〜",
      sel(shift.to, (value) => { shift.to = value; if (shift.from >= value) shift.from = value - 60; }, "終了"),
    ),
    createElement("div", { class: "chip-row" },
      createElement("button", { class: "chip chip--hall", "aria-pressed": String(shift.area === "hall"), onclick: () => props.onEdit(() => { shift.area = "hall"; }) }, "ホール"),
      createElement("button", { class: "chip chip--kitchen", "aria-pressed": String(shift.area === "kitchen"), onclick: () => props.onEdit(() => { shift.area = "kitchen"; }) }, "キッチン"),
      // 休憩○：押すと真ん中に入る（朝11:00より前には入れない。置けない短い勤務なら入らない）
      createElement("button", { class: "chip", "aria-pressed": String(shift.breakAt != null), onclick: () => props.onEdit(() => { shift.breakAt = shift.breakAt != null ? null : defaultBreak(shift.from, shift.to); }) }, "休憩 ○"),
      createElement("button", { class: "chip", "aria-pressed": String(!!shift.fixed), onclick: () => props.onEdit(() => { shift.fixed = !shift.fixed; }) }, "固定"),
    ),
    shift.breakAt != null && breakWindow(shift.from, shift.to)
      ? createElement("label", { class: "field" }, "休憩の目安（11:00より後。表の○もドラッグで動かせます）",
          sel(shift.breakAt, (value) => { shift.breakAt = value; }, "休憩", breakWindow(shift.from, shift.to).earliest, breakWindow(shift.from, shift.to).latest))
      : null,
    createElement("label", { class: "field" }, "別の人に移す",
      createElement("select", { class: "select", onchange: (event) => { if (event.target.value) props.onEdit(() => { shift.memberId = event.target.value; }); } },
        createElement("option", { value: "" }, "選ぶ…"),
        props.others.map((shift) => createElement("option", { value: shift.id }, shift.name)))),
    createElement("button", { class: "btn btn--small btn--danger", onclick: () => props.onRemove(shift) }, "この勤務を消す"),
  );
}
