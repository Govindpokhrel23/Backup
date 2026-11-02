// ============================================================
// components/timeline.js — シフト表（時間の目盛り＋線）
// ------------------------------------------------------------
// 紙のシフト表と同じ形で、1日分を表示する。
//   ・社員が上、太い線をはさんでバイトが下（紙と同じ並び）
//   ・青＝ホール、オレンジ＝キッチン、○＝休憩の目安、点線＝固定
//   ・希望（薄い緑）は、店長の画面にだけ出す（店員には渡さない）
//
// 編集できるとき（editable: true）：
//   ・線の真ん中をドラッグ → 時間ごと動かす
//   ・線の左右の端をドラッグ → 始まり／終わりを変える
//   ・15分刻みにそろう
// ============================================================

import { h } from "../lib/dom.js";
import { CONFIG } from "../config.js";
import { fmt, snap, range } from "../lib/time.js";

const START = CONFIG.DAY_START;
const END = CONFIG.DAY_END;
const SPAN = END - START;

/** 時刻 → 左からの位置（％） */
const pct = (minute) => ((minute - START) / SPAN) * 100;

/**
 * @param {object} p
 * @param {object[]} p.members         並べる店員
 * @param {object[]} p.assignments     その日の勤務
 * @param {object[]} [p.availabilities] その日の希望（店長だけ渡す）
 * @param {object[]} [p.needs]         上に出す人数の行 [{label, color, slots:[{need,have}]}]（1時間ごと）
 * @param {string}   [p.selectedId]    選んでいる店員
 * @param {boolean}  [p.editable]      ドラッグで直せるか
 * @param {(memberId:string)=>void} [p.onSelect]   名前や線を押した時
 * @param {(assignment:object, change:{from:number,to:number,breakAt:number|null})=>void} [p.onChange] ドラッグが終わった時
 */
export function timeline(p) {
  const hours = [];
  for (let m = START; m < END; m += 60) hours.push(m);

  // 社員（店長も含む）を上に、それ以外を下に
  const shain = p.members.filter((m) => m.kind === "shain");
  const others = p.members.filter((m) => m.kind !== "shain");

  return h("div", { class: "tl" },
    h("div", { class: "tl__inner" },
      // ---- 時刻の目盛り ----
      h("div", { class: "tl__row tl__row--head" },
        h("div", { class: "tl__name" }),
        h("div", { class: "tl__track" },
          hours.map((m) => h("span", { class: "tl__hour num", style: { left: `${pct(m)}%` } }, fmt(m))),
        ),
      ),
      // ---- 必要人数と不足（店長の画面だけ） ----
      (p.needs || []).map((row) =>
        h("div", { class: "tl__row tl__row--need" },
          h("div", { class: "tl__name", style: { color: row.color } }, row.label),
          h("div", { class: "tl__needs" },
            row.slots.map((s) => {
              const short = s.need - s.have;
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
    ),
  );
}

/** 「社員」「バイト」の見出し（バイトの上は太い線＝紙と同じ） */
function groupLabel(text, thickLine = false) {
  return h("div", { class: `tl__group ${thickLine ? "tl__group--line" : ""}` }, text);
}

/** 1人分の行 */
function memberRow(p, member) {
  const work = p.assignments.filter((a) => a.memberId === member.id);
  const hope = (p.availabilities || []).find((a) => a.memberId === member.id);
  const selected = p.selectedId === member.id;
  const offWord = hope && ["no", "off", "offx"].includes(hope.kind) && work.length === 0
    ? (hope.kind === "offx" ? "休（許可待ち）" : "休") : null;

  const badges = [member.skills?.open === 100 ? "立" : null, member.skills?.close === 100 ? "締" : null].filter(Boolean).join("・");

  return h("div", { class: `tl__row ${selected ? "is-selected" : ""}` },
    h("button", { class: "tl__name tl__name--btn", onclick: () => p.onSelect?.(member.id) },
      h("span", { class: "tl__person" }, member.name),
      h("span", { class: "tl__kind" }, `${CONFIG.KIND_LABEL[member.kind]}${badges ? `　${badges}` : ""}`),
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
      // 勤務の線
      work.map((a) => bar(p, a)),
    ),
  );
}

/** 勤務の線（ドラッグで動かせる） */
function bar(p, a) {
  const el = h("div", {
    class: `tl__bar tl__bar--${a.area} ${a.fixed ? "is-fixed" : ""} ${p.editable ? "is-editable" : ""}`,
    style: { left: `${pct(a.from)}%`, width: `${pct(a.to) - pct(a.from)}%` },
    role: "button",
    tabindex: "0",
    "aria-label": `${range(a.from, a.to)}`,
  },
    p.editable ? h("span", { class: "tl__handle tl__handle--l" }) : null,
    h("span", { class: "tl__label num" }, range(a.from, a.to)),
    p.editable ? h("span", { class: "tl__handle tl__handle--r" }) : null,
  );

  // 休憩の目安（○）
  const breakDot = a.breakAt != null
    ? h("span", { class: "tl__break", style: { left: `${((a.breakAt - a.from) / (a.to - a.from)) * 100}%` } })
    : null;
  if (breakDot) el.appendChild(breakDot);

  el.addEventListener("keydown", (e) => { if (e.key === "Enter") p.onSelect?.(a.memberId); });

  if (!p.editable) {
    el.addEventListener("click", () => p.onSelect?.(a.memberId));
    return el;
  }

  // ---------- ドラッグ ----------
  // pointer（指でもマウスでも同じ）のイベントで動かす
  el.addEventListener("pointerdown", (e) => {
    const track = el.parentElement;
    const trackWidth = track.getBoundingClientRect().width;
    const box = el.getBoundingClientRect();
    const x = e.clientX - box.left;
    // 押した場所で、何を動かすか決める
    const mode = x < 12 ? "start" : x > box.width - 12 ? "end" : "move";
    const startX = e.clientX;
    let from = a.from, to = a.to, moved = false;

    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      const dm = snap((dx / trackWidth) * SPAN);       // 動いた分を分に直して15分刻みに
      if (mode === "move") {
        const shift = Math.max(START - a.from, Math.min(END - a.to, dm));
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

    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-dragging");
      if (!moved) { p.onSelect?.(a.memberId); return; }  // 動かさなければ「選んだ」だけ
      // 休憩の目安：まるごと動かした時は一緒に動かす。長さを変えた時は中に収める
      let breakAt = a.breakAt;
      if (breakAt != null) {
        breakAt = mode === "move" ? breakAt + (from - a.from) : Math.max(from + 15, Math.min(to - 15, breakAt));
      }
      if (from !== a.from || to !== a.to) p.onChange?.(a, { from, to, breakAt });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });

  return el;
}
