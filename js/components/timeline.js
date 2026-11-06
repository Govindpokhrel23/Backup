// ============================================================
// components/timeline.js — シフト表（時間の目盛り＋線）
// ------------------------------------------------------------
// このファイルは、シフト表（時間の目盛り＋線）のファイルです。
// 紙のシフト表と同じ形で、1日分を表示する。
//   ・社員が上、太い線をはさんでバイトが下（紙と同じ並び）
//   ・ほかの店舗から来る人（2nd・3rd）は「応援」としていちばん下
//   ・青＝ホール、オレンジ＝キッチン、○＝休憩の目安、点線＝固定
//   ・灰色の線＝その日ほかの店舗に入っている時間（見るだけ）
//   ・希望（薄い緑）は、店長の画面にだけ出す（店員には渡さない）
//   ・線の上に「立」「締」と時間（9:00〜15:00）を出す
//
// 編集できるとき（editable: true）：
//   ・線の真ん中をドラッグ → 時間ごと動かす
//   ・線の左右の端をドラッグ → 始まり／終わりを変える
//   ・○をドラッグ → 休憩の目安を動かす（11:00より前には置けない）
//   ・15分刻みにそろう
// ============================================================

import { createElement } from "../lib/dom.js";
import { CONFIG } from "../config.js";
import { fmt, snap, range } from "../lib/time.js";
import { clampBreak } from "../lib/breaks.js";
import { roleMarks } from "../lib/roles.js";

// 表の左端と右端（timeline() を呼ぶたびに決め直す）
// 店長が営業時間の外に勤務を入れても見えるように、その日に合わせて広げる
let START = CONFIG.DAY_START;
let END = CONFIG.DAY_END;   // 表の右端（分）
let SPAN = END - START;   // 表のはば（分）

/** 時刻 → 左からの位置（％） */
const pct = (minute) => ((minute - START) / SPAN) * 100;

/**
 * @param {object} props
 * @param {object[]} props.members         並べる店員（rankHere があれば 2以上を「応援」に）
 * @param {object[]} props.assignments     その日の勤務（この店舗）
 * @param {object[]} [props.elsewhere]     その日ほかの店舗に入っている勤務（storeShort つき・見るだけ）
 * @param {object[]} [props.availabilities] その日の希望（店長だけ渡す）
 * @param {object[]} [props.needs]         上に出す人数の行 [{label, color, slots:[{need,have}]}]（1時間ごと）
 * @param {number}   [props.start]         表の左端（分）。なければ 7:00
 * @param {number}   [props.end]           表の右端（分）。なければ 22:00
 * @param {{open:number,close:number}} [props.hours] その日の営業時間（「立」「締」の印に使う）
 * @param {string}   [props.selectedId]    選んでいる店員
 * @param {boolean}  [props.editable]      ドラッグで直せるか
 * @param {(memberId:string)=>void} [props.onSelect]   名前や線を押した時
 * @param {(assignment:object, change:object)=>void} [props.onChange] ドラッグが終わった時
 */
export function timeline(props) {
  START = props.start ?? CONFIG.DAY_START;
  END = props.end ?? CONFIG.DAY_END;
  SPAN = END - START;
  const hours = [];   // 目盛りの時刻（1時間ごと）
  for (let minutes = START; minutes < END; minutes += 60) hours.push(minutes);

  // 並び：この店舗がメインの社員 → バイト → 応援（ほかの店舗がメインの人）
  const main = (member) => (member.rankHere ?? 1) === 1;
  const shain = props.members.filter((member) => main(member) && member.kind === "shain");   // メインの社員
  const others = props.members.filter((member) => main(member) && member.kind !== "shain");   // メインのバイト・フル
  // 応援の人は、その日に勤務・希望がある人と、選んだ人だけ出す（ふだんは表を長くしない）
  const helpers = props.members.filter((member) => !main(member) && (
    props.assignments.some((shift) => shift.memberId === member.id)
    || (props.availabilities || []).some((hope) => hope.memberId === member.id && ["time", "any"].includes(hope.kind))
    || props.selectedId === member.id));

  return createElement("div", { class: "tl", style: { "--hours": String(hours.length) } },
    createElement("div", { class: "tl__inner" },
      // ---- 時刻の目盛り（1時間ごと） ----
      createElement("div", { class: "tl__row tl__row--head" },
        createElement("div", { class: "tl__name" }),
        createElement("div", { class: "tl__track" },
          hours.map((minutes) => createElement("span", { class: "tl__hour num", style: { left: `${pct(minutes)}%` } }, hourLabel(minutes))),
        ),
      ),
      // ---- 必要人数と不足（店長の画面だけ） ----
      (props.needs || []).map((row) =>
        createElement("div", { class: "tl__row tl__row--need" },
          createElement("div", { class: "tl__name", style: { color: row.color } }, row.label),
          createElement("div", { class: "tl__needs" },
            row.slots.map((slot) => {
              const short = slot.need - slot.have;   // 足りない人数
              return createElement("span", { class: `tl__need num ${short > 0 ? "is-short" : ""}`, title: `必要${slot.need}人・入っている${slot.have}人` },
                short > 0 ? `−${short}` : `${slot.have}/${slot.need}`);
            }),
          ),
        )),
      // ---- 店員の行 ----
      groupLabel("社員"),
      shain.map((member) => memberRow(props, member)),
      others.length ? groupLabel("バイト", true) : null,
      others.map((shift) => memberRow(props, shift)),
      helpers.length ? groupLabel("応援（ほかの店舗から）", true) : null,
      helpers.map((helper) => memberRow(props, helper)),
    ),
  );
}

/** 目盛りの文字：「7」「8」…（24時をこえたら「翌1」） */
function hourLabel(minutes) {
  const hr = minutes / 60;   // 時（目盛りの文字用）
  return hr >= 24 ? `翌${hr - 24}` : String(hr);
}

/** 「社員」「バイト」の見出し（バイトの上は太い線＝紙と同じ） */
function groupLabel(text, thickLine = false) {
  return createElement("div", { class: `tl__group ${thickLine ? "tl__group--line" : ""}` }, text);
}

/** 1人分の行 */
function memberRow(props, member) {
  const work = props.assignments.filter((shift) => shift.memberId === member.id);   // この人の勤務（この店舗）
  const away = (props.elsewhere || []).filter((shift) => shift.memberId === member.id);   // この人のほかの店舗の勤務（灰色）
  const hope = (props.availabilities || []).find((hope) => hope.memberId === member.id);   // この人のその日の希望
  const selected = props.selectedId === member.id;   // 選ばれている人か
  const offWord = hope && ["no", "off", "offx"].includes(hope.kind) && work.length === 0   // 休みの印の文字（休み希望で勤務がない時）
    ? (hope.kind === "offx" ? "休（許可待ち）" : "休") : null;

  return createElement("div", { class: `tl__row ${selected ? "is-selected" : ""}` },
    createElement("button", { class: "tl__name tl__name--btn", onclick: () => props.onSelect?.(member.id) },
      createElement("span", { class: "tl__person" }, member.name),
    ),
    createElement("div", { class: "tl__track tl__track--grid" },
      // 希望（薄い緑の帯）
      hope && hope.kind === "time"
        ? createElement("div", { class: "tl__hope", style: { left: `${pct(hope.from)}%`, width: `${pct(hope.to) - pct(hope.from)}%` } })
        : null,
      hope && hope.kind === "any"
        ? createElement("div", { class: "tl__hope tl__hope--any", style: { left: "0%", width: "100%" } })
        : null,
      offWord ? createElement("span", { class: "tl__off" }, offWord) : null,
      // ほかの店舗に入っている時間（灰色・見るだけ）
      away.map((shift) => createElement("div", {
        class: "tl__bar tl__bar--away",
        style: { left: `${pct(shift.from)}%`, width: `${pct(shift.to) - pct(shift.from)}%` },
        title: `${shift.storeShort} ${range(shift.from, shift.to)}`,
      }, createElement("span", { class: "tl__label num" }, `${shift.storeShort} ${range(shift.from, shift.to)}`))),
      // 勤務の線
      work.map((shift) => bar(props, shift)),
    ),
  );
}

/**
 * 「立」「締」の印
 * 開店30分前から入る1人＝立ち上げ、閉店まで入る人＝締め（lib/roles.js）
 */
function roleTag(props, shift) {
  const tags = roleMarks(shift, props.assignments, props.hours);   // 「立」「締」の印
  return tags.length ? createElement("span", { class: "tl__role" }, tags.join("・")) : null;
}

/** 勤務の線（ドラッグで動かせる） */
function bar(props, barShift) {
  const el = createElement("div", {   // 勤務の線
    class: `tl__bar tl__bar--${barShift.area} ${barShift.fixed ? "is-fixed" : ""} ${props.editable ? "is-editable" : ""}`,
    style: { left: `${pct(barShift.from)}%`, width: `${pct(barShift.to) - pct(barShift.from)}%` },
    role: "button",
    tabindex: "0",
    "aria-label": `${range(barShift.from, barShift.to)}`,
  },
    props.editable ? createElement("span", { class: "tl__handle tl__handle--l" }) : null,
    roleTag(props, barShift),
    createElement("span", { class: "tl__label num" }, range(barShift.from, barShift.to)),
    props.editable ? createElement("span", { class: "tl__handle tl__handle--r" }) : null,
  );

  el.addEventListener("keydown", (event) => { if (event.key === "Enter") props.onSelect?.(barShift.memberId); });

  // 休憩の目安（○）
  if (barShift.breakAt != null) el.appendChild(breakDot(props, barShift, el));

  if (!props.editable) {
    el.addEventListener("click", () => props.onSelect?.(barShift.memberId));
    return el;
  }

  // ---------- 線のドラッグ ----------
  // pointer（指でもマウスでも同じ）のイベントで動かす
  el.addEventListener("pointerdown", (event) => {
    const track = el.parentElement;   // 線が乗っている帯
    const trackWidth = track.getBoundingClientRect().width;   // 帯のはば（ピクセル）
    const box = el.getBoundingClientRect();   // 線の位置と大きさ
    const pointerX = event.clientX - box.left;   // 線の中で押した位置
    // 押した場所で、何を動かすか決める
    const mode = pointerX < 12 ? "start" : pointerX > box.width - 12 ? "end" : "move";
    const startX = event.clientX;   // 押し始めた位置
    let from = barShift.from, to = barShift.to, moved = false;   // 動かしたあとの時刻と、動かしたかどうか

    el.setPointerCapture(event.pointerId);
    el.classList.add("is-dragging");

    /** 指・マウスを動かしている間 */
    const onMove = (ev) => {
      const dx = ev.clientX - startX;   // 動いたはば（ピクセル）
      if (Math.abs(dx) > 3) moved = true;
      const dm = snap((dx / trackWidth) * SPAN);       // 動いた分を分に直して15分刻みに
      if (mode === "move") {
        const shift = Math.max(START - barShift.from, Math.min(END - barShift.to, dm));   // 表からはみ出さない動かし量
        from = barShift.from + shift; to = barShift.to + shift;
      } else if (mode === "start") {
        from = Math.max(START, Math.min(barShift.to - 60, barShift.from + dm));   // 最低1時間は残す
      } else {
        to = Math.min(END, Math.max(barShift.from + 60, barShift.to + dm));
      }
      // 見た目だけすぐ動かす（保存はドラッグが終わってから）
      el.style.left = `${pct(from)}%`;
      el.style.width = `${pct(to) - pct(from)}%`;
      el.querySelector(".tl__label").textContent = range(from, to);
    };

    /** 指・マウスをはなした時（変えた時間を知らせる） */
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-dragging");
      if (!moved) { props.onSelect?.(barShift.memberId); return; }  // 動かさなければ「選んだ」だけ
      // 休憩の目安：まるごと動かした時は一緒に動かす。長さを変えた時は中に収める（11:00より前には置かない）
      let breakAt = barShift.breakAt;
      if (breakAt != null) {
        breakAt = clampBreak(from, to, mode === "move" ? breakAt + (from - barShift.from) : breakAt);
      }
      if (from !== barShift.from || to !== barShift.to) props.onChange?.(barShift, { from, to, breakAt });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });

  return el;
}

/** 休憩の目安（○）。編集できる時はドラッグで動かせる */
function breakDot(props, shift, barEl) {
  /** 時刻 → 線の中の位置（％） */
  const pos = (minutes) => `${((minutes - shift.from) / (shift.to - shift.from)) * 100}%`;
  const dot = createElement("span", {   // 休憩の○
    class: `tl__break ${props.editable ? "is-editable" : ""}`,
    style: { left: pos(shift.breakAt) },
    title: `休憩の目安 ${fmt(shift.breakAt)}`,
  });
  if (!props.editable) return dot;

  dot.addEventListener("pointerdown", (event) => {
    event.stopPropagation();                         // 線のドラッグと区別する
    const barWidth = barEl.getBoundingClientRect().width;   // 線のはば（ピクセル）
    const startX = event.clientX;   // 押し始めた位置
    let at = shift.breakAt;   // 休憩の時刻（動かしている間）
    dot.setPointerCapture(event.pointerId);
    /** ○を動かしている間 */
    const onMove = (ev) => {
      const dm = ((ev.clientX - startX) / barWidth) * (shift.to - shift.from);   // 動いた分（分）
      at = clampBreak(shift.from, shift.to, shift.breakAt + dm) ?? shift.breakAt;
      dot.style.left = pos(at);
      dot.title = `休憩の目安 ${fmt(at)}`;
    };
    /** ○をはなした時（休憩の時刻を知らせる） */
    const onUp = () => {
      dot.removeEventListener("pointermove", onMove);
      dot.removeEventListener("pointerup", onUp);
      dot.removeEventListener("pointercancel", onUp);
      if (at !== shift.breakAt) props.onChange?.(shift, { breakAt: at });
      else props.onSelect?.(shift.memberId);
    };
    dot.addEventListener("pointermove", onMove);
    dot.addEventListener("pointerup", onUp);
    dot.addEventListener("pointercancel", onUp);
  });
  return dot;
}
