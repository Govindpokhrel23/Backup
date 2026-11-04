// ============================================================
// components/assignment-panel.js — シフト作成の右の欄（1人分）
// ------------------------------------------------------------
// 店長が、選んだ人のその日の勤務を自由に直すための道具：
//   ・公開したあとは「編集する」を押すまで直せない（locked）
//   ・時間（5:00〜翌2:00、15分刻み）
//   ・ホール／キッチン、休憩の目安（あり・なし・時刻）、固定
//   ・別の人に移す
//   ・1日に2つ以上の勤務（中抜け）も足せる
//   ・消す
// 変える時は必ず onEdit(関数) を通す → 「元に戻す」ができる
// ============================================================

import { h } from "../lib/dom.js";
import { CONFIG } from "../config.js";
import { fmt, range, timeOptions, EDIT_MIN, EDIT_MAX } from "../lib/time.js";
import { defaultBreak, breakWindow } from "../lib/breaks.js";

/**
 * @param {object} p
 * @param {object}   p.member        選んだ店員
 * @param {string}   p.date          日付
 * @param {object[]} p.assignments   この人のその日の勤務（0個以上）
 * @param {object}   [p.hope]        この人のその日の希望
 * @param {string}   p.rule          人ごとのルール（店長メモ）
 * @param {object[]} p.others        移す先にできる店員
 * @param {(fn:()=>void)=>void} p.onEdit       変える時に呼ぶ
 * @param {()=>void} p.onAdd         勤務を足す
 * @param {(a:object)=>void} p.onRemove     勤務を消す
 * @param {()=>void} [p.onApproveSpecial]   特別許可を出す
 * @param {boolean}  [p.locked]      公開済みで直せない時は見るだけ
 * @param {string}   [p.weekText]    この週の働く時間（例：「この週 32時間（5日）」）
 * @param {object[]} [p.elsewhere]   その日ほかの店舗に入っている勤務（storeShort つき）
 */
export function assignmentPanel(p) {
  const m = p.member;
  const hope = p.hope;
  const hopeText = !hope
    ? (m.kind === "shain" ? "出していない（休みは週1日）" : "出していない")
    : { no: "入れない", any: "いつでもOK", off: "休み希望", offx: "休み希望（特別許可の申請中）", time: range(hope.from ?? 0, hope.to ?? 0) }[hope.kind];

  return h("section", { class: "card" },
    h("div", { class: "screen-header__row" },
      h("h2", { class: "card__title", style: { fontSize: "19px" } }, m.name),
      h("span", { class: "badge" }, CONFIG.KIND_LABEL[m.kind]),
    ),
    h("div", { class: "home-muted" }, `できること：${CONFIG.SKILLS.map((s) => `${s.label}${m.skills[s.key]}`).join("・")}`),
    h("div", { class: "rule-memo" }, `店長メモ：${p.rule}`),
    h("div", null, `希望：${hopeText}`),
    p.weekText ? h("div", { class: "home-muted" }, p.weekText) : null,
    hope?.kind === "offx" && p.onApproveSpecial
      ? h("button", { class: "btn btn--small", onclick: p.onApproveSpecial }, "特別許可を出す（休みにする）")
      : null,

    // ほかの店舗に入っている時間（重ねないように見せる）
    (p.elsewhere || []).map((a) => h("div", { class: "notice notice--info", style: { fontWeight: 400 } }, `この日は ${a.storeShort} に ${range(a.from, a.to)} 入っています`)),

    // 公開済みで「編集する」を押していない時は、見るだけ
    p.locked
      ? p.assignments.map((a) => h("div", { class: "work-edit" },
          h("strong", { class: "num" }, range(a.from, a.to)),
          h("span", { class: "home-muted" }, `${a.area === "hall" ? "ホール" : "キッチン"}${a.breakAt != null ? ` ・ 休憩 ${fmt(a.breakAt)}` : ""}`)))
      : p.assignments.map((a, i) => workEditor(p, a, i, p.assignments.length)),

    p.locked ? null : h("button", { class: "btn btn--dashed", onclick: p.onAdd },
      p.assignments.length
        ? "＋ もう1つ勤務を足す（中抜けなど）"
        : hope?.kind === "time" ? `＋ 希望の時間（${range(hope.from, hope.to)}）で入れる` : "＋ 勤務を追加"),
  );
}

/** 勤務1つ分の編集 */
function workEditor(p, a, index, count) {
  const sel = (value, onPick, aria, from = EDIT_MIN, to = EDIT_MAX) =>
    h("select", { class: "select num", "aria-label": aria, onchange: (e) => p.onEdit(() => onPick(Number(e.target.value))) },
      timeOptions(from, to).map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));

  return h("div", { class: "work-edit" },
    count > 1 ? h("div", { class: "home-muted" }, `勤務 ${index + 1}`) : null,
    h("div", { class: "time-range" },
      sel(a.from, (v) => { a.from = v; if (a.to <= v) a.to = v + 60; }, "開始"),
      "〜",
      sel(a.to, (v) => { a.to = v; if (a.from >= v) a.from = v - 60; }, "終了"),
    ),
    h("div", { class: "chip-row" },
      h("button", { class: "chip chip--hall", "aria-pressed": String(a.area === "hall"), onclick: () => p.onEdit(() => { a.area = "hall"; }) }, "ホール"),
      h("button", { class: "chip chip--kitchen", "aria-pressed": String(a.area === "kitchen"), onclick: () => p.onEdit(() => { a.area = "kitchen"; }) }, "キッチン"),
      // 休憩○：押すと真ん中に入る（朝11:00より前には入れない。置けない短い勤務なら入らない）
      h("button", { class: "chip", "aria-pressed": String(a.breakAt != null), onclick: () => p.onEdit(() => { a.breakAt = a.breakAt != null ? null : defaultBreak(a.from, a.to); }) }, "休憩 ○"),
      h("button", { class: "chip", "aria-pressed": String(!!a.fixed), onclick: () => p.onEdit(() => { a.fixed = !a.fixed; }) }, "固定"),
    ),
    a.breakAt != null && breakWindow(a.from, a.to)
      ? h("label", { class: "field" }, "休憩の目安（11:00より後。表の○もドラッグで動かせます）",
          sel(a.breakAt, (v) => { a.breakAt = v; }, "休憩", breakWindow(a.from, a.to).earliest, breakWindow(a.from, a.to).latest))
      : null,
    h("label", { class: "field" }, "別の人に移す",
      h("select", { class: "select", onchange: (e) => { if (e.target.value) p.onEdit(() => { a.memberId = e.target.value; }); } },
        h("option", { value: "" }, "選ぶ…"),
        p.others.map((o) => h("option", { value: o.id }, o.name)))),
    h("button", { class: "btn btn--small btn--danger", onclick: () => p.onRemove(a) }, "この勤務を消す"),
  );
}
