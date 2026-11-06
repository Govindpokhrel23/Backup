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

import { createElement } from "../lib/dom.js";   // 画面の部品の道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { fmt, range, timeOptions, EDIT_MIN, EDIT_MAX } from "../lib/time.js";   // 時間の道具を読む
import { defaultBreak, breakWindow } from "../lib/breaks.js";   // 休憩の道具を読む

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
export function assignmentPanel(props) {   // 右の欄（選んだ人のその日）を作る関数
  const member = props.member;   // 選んだ店員
  const hope = props.hope;   // その日の希望
  const hopeText = !hope   // 希望を文にしたもの
    ? (member.kind === "shain" ? "出していない（休みは週1日）" : "出していない")   // 希望を出していない時の文（社員とバイトでちがう）
    : { no: "入れない", any: "いつでもOK", off: "休み希望", offx: "休み希望（特別許可の申請中）", time: range(hope.from ?? 0, hope.to ?? 0) }[hope.kind];   // 希望の種類ごとの文

  return createElement("section", { class: "card" },   // カード
    createElement("div", { class: "screen-header__row" },   // 上の行
      createElement("h2", { class: "card__title", style: { fontSize: "19px" } }, member.name),   // 名前
      createElement("span", { class: "badge" }, CONFIG.KIND_LABEL[member.kind]),   // 立場
    ),
    createElement("div", { class: "home-muted" }, `できること：${CONFIG.SKILLS.map((skill) => `${skill.label}${member.skills[skill.key]}`).join("・")}`),   // できること％
    createElement("div", { class: "rule-memo" }, `店長メモ：${props.rule}`),   // 店長のメモ
    createElement("div", null, `希望：${hopeText}`),   // 希望
    props.weekText ? createElement("div", { class: "home-muted" }, props.weekText) : null,   // 今週の時間などの説明
    // AIがこの人をこの時間にした理由（AIで作成した勤務だけ。2026年11月5日）
    props.assignments.filter((shift) => shift.reason).map((shift) => createElement("div", { class: "ai-reason" }, createElement("strong", null, "AIの理由"), `${range(shift.from, shift.to)}：${shift.reason}`)),   // AIの理由
    hope?.kind === "offx" && props.onApproveSpecial   // 特別許可の申請中なら
      ? createElement("button", { class: "btn btn--small", onclick: props.onApproveSpecial }, "特別許可を出す（休みにする）")   // 特別許可のボタン
      : null,   // それ以外は何も出さない

    // ほかの店舗に入っている時間（重ねないように見せる）
    (props.elsewhere || []).map((shift) => createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } }, `この日は ${shift.storeShort} に ${range(shift.from, shift.to)} 入っています`)),   // ほかの店舗の勤務があれば知らせる

    // 公開済みで「編集する」を押していない時は、見るだけ
    props.locked   // 公開済みで変えられないなら
      ? props.assignments.map((shift) => createElement("div", { class: "work-edit" },   // 勤務を見るだけ
          createElement("strong", { class: "num" }, range(shift.from, shift.to)),   // 時間
          createElement("span", { class: "home-muted" }, `${shift.area === "hall" ? "ホール" : "キッチン"}${shift.breakAt != null ? ` ・ 休憩 ${fmt(shift.breakAt)}` : ""}`)))   // 場所と休憩
      : props.assignments.map((shift, index) => workEditor(props, shift, index, props.assignments.length)),   // 変えられるなら、編集の部品

    props.locked ? null : createElement("button", { class: "btn btn--dashed", onclick: props.onAdd },   // 勤務を足すボタン
      props.assignments.length   // もう勤務があれば
        ? "＋ もう1つ勤務を足す（中抜けなど）"   // 中抜けなどで2つ目
        : hope?.kind === "time" ? `＋ 希望の時間（${range(hope.from, hope.to)}）で入れる` : "＋ 勤務を追加"),   // 時間の希望なら、その時間で入れる
  );
}

/** 勤務1つ分の編集 */
function workEditor(props, shift, index, count) {   // 勤務1つの編集の部品を作る関数
  /** 時刻を選ぶセレクト（value＝今の時刻、onPick＝選んだ時） */
  const sel = (value, onPick, aria, from = EDIT_MIN, to = EDIT_MAX) =>   // 時間を選ぶ欄を作る
    createElement("select", { class: "select num", "aria-label": aria, onchange: (event) => props.onEdit(() => onPick(Number(event.target.value))) },   // 選んだら変える（元に戻せるように onEdit を通す）
      timeOptions(from, to).map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));   // 15分ごとの時間

  return createElement("div", { class: "work-edit" },   // 入れ物
    count > 1 ? createElement("div", { class: "home-muted" }, `勤務 ${index + 1}`) : null,   // 2つ以上あれば番号
    createElement("div", { class: "time-range" },   // 時間の行
      sel(shift.from, (value) => { shift.from = value; if (shift.to <= value) shift.to = value + 60; }, "開始"),   // 開始（終わりより後なら終わりも動かす）
      "〜",   // から
      sel(shift.to, (value) => { shift.to = value; if (shift.from >= value) shift.from = value - 60; }, "終了"),   // 終了（始まりより前なら始まりも動かす）
    ),
    createElement("div", { class: "chip-row" },   // ボタンの行
      createElement("button", { class: "chip chip--hall", "aria-pressed": String(shift.area === "hall"), onclick: () => props.onEdit(() => { shift.area = "hall"; }) }, "ホール"),   // ホール
      createElement("button", { class: "chip chip--kitchen", "aria-pressed": String(shift.area === "kitchen"), onclick: () => props.onEdit(() => { shift.area = "kitchen"; }) }, "キッチン"),   // キッチン
      // 休憩○：押すと真ん中に入る（朝11:00より前には入れない。置けない短い勤務なら入らない）
      createElement("button", { class: "chip", "aria-pressed": String(shift.breakAt != null), onclick: () => props.onEdit(() => { shift.breakAt = shift.breakAt != null ? null : defaultBreak(shift.from, shift.to); }) }, "休憩 ○"),   // 休憩あり・なし
      createElement("button", { class: "chip", "aria-pressed": String(!!shift.fixed), onclick: () => props.onEdit(() => { shift.fixed = !shift.fixed; }) }, "固定"),   // 固定（AIが変えない）
    ),
    shift.breakAt != null && breakWindow(shift.from, shift.to)   // 休憩があって置ける時間なら
      ? createElement("label", { class: "field" }, "休憩の目安（11:00より後。表の○もドラッグで動かせます）",   // 休憩の時間の欄
          sel(shift.breakAt, (value) => { shift.breakAt = value; }, "休憩", breakWindow(shift.from, shift.to).earliest, breakWindow(shift.from, shift.to).latest))   // 置いてよい時間だけ選べる
      : null,   // なければ何も出さない
    createElement("label", { class: "field" }, "別の人に移す",   // 別の人に移す欄
      createElement("select", { class: "select", onchange: (event) => { if (event.target.value) props.onEdit(() => { shift.memberId = event.target.value; }); } },   // 選んだらその人の勤務にする
        createElement("option", { value: "" }, "選ぶ…"),   // はじめの選び肢
        props.others.map((other) => createElement("option", { value: other.id }, other.name)))),   // ほかの人
    createElement("button", { class: "btn btn--small btn--danger", onclick: () => props.onRemove(shift) }, "この勤務を消す"),   // 勤務を消すボタン
  );
}
