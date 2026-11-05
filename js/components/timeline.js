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

import { h } from "../lib/dom.js";
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
 * @param {object} p
 * @param {object[]} p.members         並べる店員（rankHere があれば 2以上を「応援」に）
 * @param {object[]} p.assignments     その日の勤務（この店舗）
 * @param {object[]} [p.elsewhere]     その日ほかの店舗に入っている勤務（storeShort つき・見るだけ）
 * @param {object[]} [p.availabilities] その日の希望（店長だけ渡す）
 * @param {object[]} [p.needs]         上に出す人数の行 [{label, color, slots:[{need,have}]}]（1時間ごと）
 * @param {number}   [p.start]         表の左端（分）。なければ 7:00
 * @param {number}   [p.end]           表の右端（分）。なければ 22:00
 * @param {{open:number,close:number}} [p.hours] その日の営業時間（「立」「締」の印に使う）
 * @param {string}   [p.selectedId]    選んでいる店員
 * @param {boolean}  [p.editable]      ドラッグで直せるか
 * @param {(memberId:string)=>void} [p.onSelect]   名前や線を押した時
 * @param {(assignment:object, change:object)=>void} [p.onChange] ドラッグが終わった時
 */
export function timeline(p) {
  START = p.start ?? CONFIG.DAY_START;
  END = p.end ?? CONFIG.DAY_END;
  SPAN = END - START;
  const hours = [];   // 目盛りの時刻（1時間ごと）
  for (let m = START; m < END; m += 60) hours.push(m);

  // 並び：この店舗がメインの社員 → バイト → 応援（ほかの店舗がメインの人）
  const main = (m) => (m.rankHere ?? 1) === 1;
  const shain = p.members.filter((m) => main(m) && m.kind === "shain");   // メインの社員
  const others = p.members.filter((m) => main(m) && m.kind !== "shain");   // メインのバイト・フル
  // 応援の人は、その日に勤務・希望がある人と、選んだ人だけ出す（ふだんは表を長くしない）
  const helpers = p.members.filter((m) => !main(m) && (
    p.assignments.some((a) => a.memberId === m.id)
    || (p.availabilities || []).some((a) => a.memberId === m.id && ["time", "any"].includes(a.kind))
    || p.selectedId === m.id));

  return h("div", { class: "tl", style: { "--hours": String(hours.length) } },
    h("div", { class: "tl__inner" },
      // ---- 時刻の目盛り（1時間ごと） ----
      h("div", { class: "tl__row tl__row--head" },
        h("div", { class: "tl__name" }),
        h("div", { class: "tl__track" },
          hours.map((m) => h("span", { class: "tl__hour num", style: { left: `${pct(m)}%` } }, hourLabel(m))),
        ),
      ),
      // ---- 必要人数と不足（店長の画面だけ） ----
      (p.needs || []).map((row) =>
        h("div", { class: "tl__row tl__row--need" },
          h("div", { class: "tl__name", style: { color: row.color } }, row.label),
          h("div", { class: "tl__needs" },
            row.slots.map((s) => {
              const short = s.need - s.have;   // 足りない人数
              return h("span", { class: `tl__need num ${short > 0 ? "is-short" : ""}`, title: `必要${s.need}人・入っている${s.have}人` },
                short > 0 ? `−${short}` : `${s.have}/${s.need}`);
            }),
          ),
        )),
      // ---- 店員の行 ----
      groupLabel("社員"),
      shain.map((m) => memberRow(p, m)),
      others.length ? groupLabel("バイト", true) : null,
      others.map((m) => memberRow(p, m)),
      helpers.length ? groupLabel("応援（ほかの店舗から）", true) : null,
      helpers.map((m) => memberRow(p, m)),
    ),
  );
}

/** 目盛りの文字：「7」「8」…（24時をこえたら「翌1」） */
function hourLabel(m) {
  const hr = m / 60;   // 時（目盛りの文字用）
  return hr >= 24 ? `翌${hr - 24}` : String(hr);
}

/** 「社員」「バイト」の見出し（バイトの上は太い線＝紙と同じ） */
function groupLabel(text, thickLine = false) {
  return h("div", { class: `tl__group ${thickLine ? "tl__group--line" : ""}` }, text);
}

/** 1人分の行 */
function memberRow(p, member) {
  const work = p.assignments.filter((a) => a.memberId === member.id);   // この人の勤務（この店舗）
  const away = (p.elsewhere || []).filter((a) => a.memberId === member.id);   // この人のほかの店舗の勤務（灰色）
  const hope = (p.availabilities || []).find((a) => a.memberId === member.id);   // この人のその日の希望
  const selected = p.selectedId === member.id;   // 選ばれている人か
  const offWord = hope && ["no", "off", "offx"].includes(hope.kind) && work.length === 0   // 休みの印の文字（休み希望で勤務がない時）
    ? (hope.kind === "offx" ? "休（許可待ち）" : "休") : null;

  return h("div", { class: `tl__row ${selected ? "is-selected" : ""}` },
    h("button", { class: "tl__name tl__name--btn", onclick: () => p.onSelect?.(member.id) },
      h("span", { class: "tl__person" }, member.name),
    ),
    h("div", { class: "tl__track tl__track--grid" },
      // 希望（薄い緑の帯）
      hope && hope.kind === "time"
        ? h("div", { class: "tl__hope", style: { left: `${pct(hope.from)}%`, width: `${pct(hope.to) - pct(hope.from)}%` } })
        : null,
      hope && hope.kind === "any"
        ? h("div", { class: "tl__hope tl__hope--any", style: { left: "0%", width: "100%" } })
        : null,
      offWord ? h("span", { class: "tl__off" }, offWord) : null,
      // ほかの店舗に入っている時間（灰色・見るだけ）
      away.map((a) => h("div", {
        class: "tl__bar tl__bar--away",
        style: { left: `${pct(a.from)}%`, width: `${pct(a.to) - pct(a.from)}%` },
        title: `${a.storeShort} ${range(a.from, a.to)}`,
      }, h("span", { class: "tl__label num" }, `${a.storeShort} ${range(a.from, a.to)}`))),
      // 勤務の線
      work.map((a) => bar(p, a)),
    ),
  );
}

/**
 * 「立」「締」の印
 * 開店30分前から入る1人＝立ち上げ、閉店まで入る人＝締め（lib/roles.js）
 */
function roleTag(p, a) {
  const tags = roleMarks(a, p.assignments, p.hours);   // 「立」「締」の印
  return tags.length ? h("span", { class: "tl__role" }, tags.join("・")) : null;
}

/** 勤務の線（ドラッグで動かせる） */
function bar(p, a) {
  const el = h("div", {   // 勤務の線
    class: `tl__bar tl__bar--${a.area} ${a.fixed ? "is-fixed" : ""} ${p.editable ? "is-editable" : ""}`,
    style: { left: `${pct(a.from)}%`, width: `${pct(a.to) - pct(a.from)}%` },
    role: "button",
    tabindex: "0",
    "aria-label": `${range(a.from, a.to)}`,
  },
    p.editable ? h("span", { class: "tl__handle tl__handle--l" }) : null,
    roleTag(p, a),
    h("span", { class: "tl__label num" }, range(a.from, a.to)),
    p.editable ? h("span", { class: "tl__handle tl__handle--r" }) : null,
  );

  el.addEventListener("keydown", (e) => { if (e.key === "Enter") p.onSelect?.(a.memberId); });

  // 休憩の目安（○）
  if (a.breakAt != null) el.appendChild(breakDot(p, a, el));

  if (!p.editable) {
    el.addEventListener("click", () => p.onSelect?.(a.memberId));
    return el;
  }

  // ---------- 線のドラッグ ----------
  // pointer（指でもマウスでも同じ）のイベントで動かす
  el.addEventListener("pointerdown", (e) => {
    const track = el.parentElement;   // 線が乗っている帯
    const trackWidth = track.getBoundingClientRect().width;   // 帯のはば（ピクセル）
    const box = el.getBoundingClientRect();   // 線の位置と大きさ
    const x = e.clientX - box.left;   // 線の中で押した位置
    // 押した場所で、何を動かすか決める
    const mode = x < 12 ? "start" : x > box.width - 12 ? "end" : "move";
    const startX = e.clientX;   // 押し始めた位置
    let from = a.from, to = a.to, moved = false;   // 動かしたあとの時刻と、動かしたかどうか

    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");

    /** 指・マウスを動かしている間 */
    const onMove = (ev) => {
      const dx = ev.clientX - startX;   // 動いたはば（ピクセル）
      if (Math.abs(dx) > 3) moved = true;
      const dm = snap((dx / trackWidth) * SPAN);       // 動いた分を分に直して15分刻みに
      if (mode === "move") {
        const shift = Math.max(START - a.from, Math.min(END - a.to, dm));   // 表からはみ出さない動かし量
        from = a.from + shift; to = a.to + shift;
      } else if (mode === "start") {
        from = Math.max(START, Math.min(a.to - 60, a.from + dm));   // 最低1時間は残す
      } else {
        to = Math.min(END, Math.max(a.from + 60, a.to + dm));
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
      if (!moved) { p.onSelect?.(a.memberId); return; }  // 動かさなければ「選んだ」だけ
      // 休憩の目安：まるごと動かした時は一緒に動かす。長さを変えた時は中に収める（11:00より前には置かない）
      let breakAt = a.breakAt;
      if (breakAt != null) {
        breakAt = clampBreak(from, to, mode === "move" ? breakAt + (from - a.from) : breakAt);
      }
      if (from !== a.from || to !== a.to) p.onChange?.(a, { from, to, breakAt });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });

  return el;
}

/** 休憩の目安（○）。編集できる時はドラッグで動かせる */
function breakDot(p, a, barEl) {
  /** 時刻 → 線の中の位置（％） */
  const pos = (m) => `${((m - a.from) / (a.to - a.from)) * 100}%`;
  const dot = h("span", {   // 休憩の○
    class: `tl__break ${p.editable ? "is-editable" : ""}`,
    style: { left: pos(a.breakAt) },
    title: `休憩の目安 ${fmt(a.breakAt)}`,
  });
  if (!p.editable) return dot;

  dot.addEventListener("pointerdown", (e) => {
    e.stopPropagation();                         // 線のドラッグと区別する
    const barWidth = barEl.getBoundingClientRect().width;   // 線のはば（ピクセル）
    const startX = e.clientX;   // 押し始めた位置
    let at = a.breakAt;   // 休憩の時刻（動かしている間）
    dot.setPointerCapture(e.pointerId);
    /** ○を動かしている間 */
    const onMove = (ev) => {
      const dm = ((ev.clientX - startX) / barWidth) * (a.to - a.from);   // 動いた分（分）
      at = clampBreak(a.from, a.to, a.breakAt + dm) ?? a.breakAt;
      dot.style.left = pos(at);
      dot.title = `休憩の目安 ${fmt(at)}`;
    };
    /** ○をはなした時（休憩の時刻を知らせる） */
    const onUp = () => {
      dot.removeEventListener("pointermove", onMove);
      dot.removeEventListener("pointerup", onUp);
      dot.removeEventListener("pointercancel", onUp);
      if (at !== a.breakAt) p.onChange?.(a, { breakAt: at });
      else p.onSelect?.(a.memberId);
    };
    dot.addEventListener("pointermove", onMove);
    dot.addEventListener("pointerup", onUp);
    dot.addEventListener("pointercancel", onUp);
  });
  return dot;
}
