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

import { createElement } from "../lib/dom.js";   // 画面の部品の道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { fmt, snap, range } from "../lib/time.js";   // 時間の道具を読む
import { clampBreak } from "../lib/breaks.js";   // 休憩の道具を読む
import { roleMarks } from "../lib/roles.js";   // 立・締の印の道具を読む

// 表の左端と右端（timeline() を呼ぶたびに決め直す）
// 店長が営業時間の外に勤務を入れても見えるように、その日に合わせて広げる
let START = CONFIG.DAY_START;   // 表の始まりの時間
let END = CONFIG.DAY_END;   // 表の右端（分）
let SPAN = END - START;   // 表のはば（分）

/** 時刻 → 左からの位置（％） */
const pct = (minute) => ((minute - START) / SPAN) * 100;   // 時間を表の左からの％にする

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
export function timeline(props) {   // 1日のタイムライン（横の棒の表）を作る関数
  START = props.start ?? CONFIG.DAY_START;   // 始まりの時間
  END = props.end ?? CONFIG.DAY_END;   // 終わりの時間
  SPAN = END - START;   // はば
  const hours = [];   // 目盛りの時刻（1時間ごと）
  for (let minutes = START; minutes < END; minutes += 60) hours.push(minutes);   // 1時間ごとの目盛り

  // 並び：この店舗がメインの社員 → バイト → 応援（ほかの店舗がメインの人）
  const main = (member) => (member.rankHere ?? 1) === 1;   // 所属店の人か
  const shain = props.members.filter((member) => main(member) && member.kind === "shain");   // メインの社員
  const others = props.members.filter((member) => main(member) && member.kind !== "shain");   // メインのバイト・フル
  // 応援の人は、その日に勤務・希望がある人と、選んだ人だけ出す（ふだんは表を長くしない）
  const helpers = props.members.filter((member) => !main(member) && (   // 応援の人（入っている・希望がある・選んでいる）
    props.assignments.some((shift) => shift.memberId === member.id)   // 勤務がある
    || (props.availabilities || []).some((hope) => hope.memberId === member.id && ["time", "any"].includes(hope.kind))   // 入れる希望がある
    || props.selectedId === member.id));   // 選んでいる

  return createElement("div", { class: "tl", style: { "--hours": String(hours.length) } },   // 表の入れ物
    createElement("div", { class: "tl__inner" },   // 中身（横にスクロールできる）
      // ---- 時刻の目盛り（1時間ごと） ----
      createElement("div", { class: "tl__row tl__row--head" },   // 時間の見出しの行
        createElement("div", { class: "tl__name" }),   // 名前の所（空）
        createElement("div", { class: "tl__track" },   // 目盛りの所
          hours.map((minutes) => createElement("span", { class: "tl__hour num", style: { left: `${pct(minutes)}%` } }, hourLabel(minutes))),   // 1時間ごとの数字
        ),
      ),
      // ---- 必要人数と不足（店長の画面だけ） ----
      (props.needs || []).map((row) =>   // 必要人数の行
        createElement("div", { class: "tl__row tl__row--need" },   // 1行
          createElement("div", { class: "tl__name", style: { color: row.color } }, row.label),   // 場所の名前
          createElement("div", { class: "tl__needs" },   // 人数の所
            row.slots.map((slot) => {   // 15分ごとに
              const short = slot.need - slot.have;   // 足りない人数
              return createElement("span", { class: `tl__need num ${short > 0 ? "is-short" : ""}`, title: `必要${slot.need}人・入っている${slot.have}人` },   // 足りなければ赤
                short > 0 ? `−${short}` : `${slot.have}/${slot.need}`);   // 「−1」か「1/1」
            }),
          ),
        )),
      // ---- 店員の行 ----
      groupLabel("社員"),   // 社員の見出し
      shain.map((member) => memberRow(props, member)),   // 社員の行
      others.length ? groupLabel("バイト", true) : null,   // バイトの見出し
      others.map((member) => memberRow(props, member)),   // バイトの行
      helpers.length ? groupLabel("応援（ほかの店舗から）", true) : null,   // 応援の見出し
      helpers.map((helper) => memberRow(props, helper)),   // 応援の行
    ),
  );
}

/** 目盛りの文字：「7」「8」…（24時をこえたら「翌1」） */
function hourLabel(minutes) {   // 目盛りの数字を作る関数
  const hr = minutes / 60;   // 時（目盛りの文字用）
  return hr >= 24 ? `翌${hr - 24}` : String(hr);   // 24時をこえたら「翌」
}

/** 「社員」「バイト」の見出し（バイトの上は太い線＝紙と同じ） */
function groupLabel(text, thickLine = false) {   // 人の区切りの見出しを作る関数
  return createElement("div", { class: `tl__group ${thickLine ? "tl__group--line" : ""}` }, text);   // 見出し（線つき）
}

/** 1人分の行 */
function memberRow(props, member) {   // 1人の行を作る関数
  const work = props.assignments.filter((shift) => shift.memberId === member.id);   // この人の勤務（この店舗）
  const away = (props.elsewhere || []).filter((shift) => shift.memberId === member.id);   // この人のほかの店舗の勤務（灰色）
  const hope = (props.availabilities || []).find((hope) => hope.memberId === member.id);   // この人のその日の希望
  const selected = props.selectedId === member.id;   // 選ばれている人か
  const offWord = hope && ["no", "off", "offx"].includes(hope.kind) && work.length === 0   // 休みの印の文字（休み希望で勤務がない時）
    ? (hope.kind === "offx" ? "休（許可待ち）" : "休") : null;   // 休み希望なら「休」

  return createElement("div", { class: `tl__row ${selected ? "is-selected" : ""}` },   // 行（選んでいれば色を変える）
    createElement("button", { class: "tl__name tl__name--btn", onclick: () => props.onSelect?.(member.id) },   // 名前のボタン（押すと右の欄に出す）
      createElement("span", { class: "tl__person" }, member.name),   // 名前
    ),
    createElement("div", { class: "tl__track tl__track--grid" },   // 棒の所（うしろにマス目）
      // 希望（薄い緑の帯）
      hope && hope.kind === "time"   // 時間の希望なら
        ? createElement("div", { class: "tl__hope", style: { left: `${pct(hope.from)}%`, width: `${pct(hope.to) - pct(hope.from)}%` } })   // うすい色で希望の時間を出す
        : null,   // なければ何も出さない
      hope && hope.kind === "any"   // いつでもOKなら
        ? createElement("div", { class: "tl__hope tl__hope--any", style: { left: "0%", width: "100%" } })   // 全部うすい色
        : null,   // なければ何も出さない
      offWord ? createElement("span", { class: "tl__off" }, offWord) : null,   // 休みの文字
      // ほかの店舗に入っている時間（灰色・見るだけ）
      away.map((shift) => createElement("div", {   // ほかの店舗の勤務（灰色）
        class: "tl__bar tl__bar--away",   // 見た目
        style: { left: `${pct(shift.from)}%`, width: `${pct(shift.to) - pct(shift.from)}%` },   // 位置と長さ
        title: `${shift.storeShort} ${range(shift.from, shift.to)}`,   // 説明
      }, createElement("span", { class: "tl__label num" }, `${shift.storeShort} ${range(shift.from, shift.to)}`))),   // 店舗と時間
      // 勤務の線
      work.map((shift) => bar(props, shift)),   // この店舗の勤務の棒
    ),
  );
}

/**
 * 「立」「締」の印
 * 開店30分前から入る1人＝立ち上げ、閉店まで入る人＝締め（lib/roles.js）
 */
function roleTag(props, shift) {   // 立・締の印を作る関数
  const tags = roleMarks(shift, props.assignments, props.hours);   // 「立」「締」の印
  return tags.length ? createElement("span", { class: "tl__role" }, tags.join("・")) : null;   // 印があれば出す
}

/** 勤務の線（ドラッグで動かせる） */
function bar(props, barShift) {   // 勤務の棒を作る関数
  const el = createElement("div", {   // 勤務の線
    class: `tl__bar tl__bar--${barShift.area} ${barShift.fixed ? "is-fixed" : ""} ${props.editable ? "is-editable" : ""}`,   // 場所の色・固定・動かせるか
    style: { left: `${pct(barShift.from)}%`, width: `${pct(barShift.to) - pct(barShift.from)}%` },   // 位置と長さ
    role: "button",   // ボタンとして読む
    tabindex: "0",   // キーボードで選べる
    "aria-label": `${range(barShift.from, barShift.to)}`,   // 読み上げの説明
  },
    props.editable ? createElement("span", { class: "tl__handle tl__handle--l" }) : null,   // 左はしのつまみ
    roleTag(props, barShift),   // 立・締の印
    createElement("span", { class: "tl__label num" }, range(barShift.from, barShift.to)),   // 時間の文字
    props.editable ? createElement("span", { class: "tl__handle tl__handle--r" }) : null,   // 右はしのつまみ
  );

  el.addEventListener("keydown", (event) => { if (event.key === "Enter") props.onSelect?.(barShift.memberId); });   // Enter で選ぶ

  // 休憩の目安（○）
  if (barShift.breakAt != null) el.appendChild(breakDot(props, barShift, el));   // 休憩の丸

  if (!props.editable) {   // 動かせないなら
    el.addEventListener("click", () => props.onSelect?.(barShift.memberId));   // 押したら選ぶ
    return el;   // できた棒を返す
  }

  // ---------- 線のドラッグ ----------
  // pointer（指でもマウスでも同じ）のイベントで動かす
  el.addEventListener("pointerdown", (event) => {   // 指・マウスを置いた時
    const track = el.parentElement;   // 線が乗っている帯
    const trackWidth = track.getBoundingClientRect().width;   // 帯のはば（ピクセル）
    const box = el.getBoundingClientRect();   // 線の位置と大きさ
    const pointerX = event.clientX - box.left;   // 線の中で押した位置
    // 押した場所で、何を動かすか決める
    const mode = pointerX < 12 ? "start" : pointerX > box.width - 12 ? "end" : "move";   // 左はし→始まり、右はし→終わり、まん中→全体を動かす
    const startX = event.clientX;   // 押し始めた位置
    let from = barShift.from, to = barShift.to, moved = false;   // 動かしたあとの時刻と、動かしたかどうか

    el.setPointerCapture(event.pointerId);   // 指をはなすまで追いかける
    el.classList.add("is-dragging");   // 動かしている見た目

    /** 指・マウスを動かしている間 */
    const onMove = (moveEvent) => {   // 動かしている時
      const movedPx = moveEvent.clientX - startX;   // 動いたはば（ピクセル）
      if (Math.abs(movedPx) > 3) moved = true;   // 少しでも動いたら覚える
      const movedMinutes = snap((movedPx / trackWidth) * SPAN);       // 動いた分を分に直して15分刻みに
      if (mode === "move") {   // 全体を動かすなら
        const moveMinutes = Math.max(START - barShift.from, Math.min(END - barShift.to, movedMinutes));   // 表からはみ出さない動かし量
        from = barShift.from + moveMinutes; to = barShift.to + moveMinutes;   // 始まりと終わりを動かす
      } else if (mode === "start") {   // 始まりを動かすなら
        from = Math.max(START, Math.min(barShift.to - 60, barShift.from + movedMinutes));   // 最低1時間は残す
      } else {   // 終わりを動かすなら
        to = Math.min(END, Math.max(barShift.from + 60, barShift.to + movedMinutes));   // 最低1時間は残す
      }
      // 見た目だけすぐ動かす（保存はドラッグが終わってから）
      el.style.left = `${pct(from)}%`;   // 棒の位置
      el.style.width = `${pct(to) - pct(from)}%`;   // 棒の長さ
      el.querySelector(".tl__label").textContent = range(from, to);   // 時間の文字
    };

    /** 指・マウスをはなした時（変えた時間を知らせる） */
    const onUp = () => {   // 指をはなした時
      el.removeEventListener("pointermove", onMove);   // 追いかけをやめる
      el.removeEventListener("pointerup", onUp);   // 追いかけをやめる
      el.removeEventListener("pointercancel", onUp);   // 追いかけをやめる
      el.classList.remove("is-dragging");   // 見た目をもどす
      if (!moved) { props.onSelect?.(barShift.memberId); return; }  // 動かさなければ「選んだ」だけ
      // 休憩の目安：まるごと動かした時は一緒に動かす。長さを変えた時は中に収める（11:00より前には置かない）
      let breakAt = barShift.breakAt;   // 休憩
      if (breakAt != null) {   // 休憩があれば
        breakAt = clampBreak(from, to, mode === "move" ? breakAt + (from - barShift.from) : breakAt);   // 一緒に動かして、置ける場所に入れる
      }
      if (from !== barShift.from || to !== barShift.to) props.onChange?.(barShift, { from, to, breakAt });   // 変わっていれば知らせる
    };

    el.addEventListener("pointermove", onMove);   // 動かしている時を見る
    el.addEventListener("pointerup", onUp);   // はなした時を見る
    el.addEventListener("pointercancel", onUp);   // 取り消された時も同じ
  });

  return el;   // できた棒を返す
}

/** 休憩の目安（○）。編集できる時はドラッグで動かせる */
function breakDot(props, shift, barEl) {   // 休憩の丸を作る関数
  /** 時刻 → 線の中の位置（％） */
  const pos = (minutes) => `${((minutes - shift.from) / (shift.to - shift.from)) * 100}%`;   // 棒の中の位置（％）
  const dot = createElement("span", {   // 休憩の○
    class: `tl__break ${props.editable ? "is-editable" : ""}`,   // 見た目
    style: { left: pos(shift.breakAt) },   // 位置
    title: `休憩の目安 ${fmt(shift.breakAt)}`,   // 説明
  });
  if (!props.editable) return dot;   // 動かせないならそのまま返す

  dot.addEventListener("pointerdown", (event) => {   // 指を置いた時
    event.stopPropagation();                         // 線のドラッグと区別する
    const barWidth = barEl.getBoundingClientRect().width;   // 線のはば（ピクセル）
    const startX = event.clientX;   // 押し始めた位置
    let at = shift.breakAt;   // 休憩の時刻（動かしている間）
    dot.setPointerCapture(event.pointerId);   // 指をはなすまで追いかける
    /** ○を動かしている間 */
    const onMove = (moveEvent) => {   // 動かしている時
      const movedMinutes = ((moveEvent.clientX - startX) / barWidth) * (shift.to - shift.from);   // 動いた分（分）
      at = clampBreak(shift.from, shift.to, shift.breakAt + movedMinutes) ?? shift.breakAt;   // 置ける場所に入れる
      dot.style.left = pos(at);   // 位置
      dot.title = `休憩の目安 ${fmt(at)}`;   // 説明
    };
    /** ○をはなした時（休憩の時刻を知らせる） */
    const onUp = () => {   // 指をはなした時
      dot.removeEventListener("pointermove", onMove);   // 追いかけをやめる
      dot.removeEventListener("pointerup", onUp);   // 追いかけをやめる
      dot.removeEventListener("pointercancel", onUp);   // 追いかけをやめる
      if (at !== shift.breakAt) props.onChange?.(shift, { breakAt: at });   // 変わっていれば知らせる
      else props.onSelect?.(shift.memberId);   // 動かしていなければ選ぶ
    };
    dot.addEventListener("pointermove", onMove);   // 動かしている時を見る
    dot.addEventListener("pointerup", onUp);   // はなした時を見る
    dot.addEventListener("pointercancel", onUp);   // 取り消された時も同じ
  });
  return dot;   // できた丸を返す
}
