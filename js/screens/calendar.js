// ============================================================
// screens/calendar.js — 個人カレンダー（自分だけのカレンダー）
// ------------------------------------------------------------
// このファイルは、個人カレンダー（自分だけのカレンダー）のファイルです。
// ・入っている日に「9:00」のように始まりの時刻を出す
// ・日を押すと「コメダ 9:00〜15:00」と、店舗・場所・休憩の目安
// ・応援（いつもと違う店舗）の日は色を変えて店名つき
// ・公開前の週は出さない（公開されてから見える）
// ============================================================

import { createElement, mount } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { screenHeader } from "../components/header.js";
import { myShifts } from "../components/my-shifts.js";
import { workedMinutes, hoursText } from "../lib/labor.js";
import { isManager } from "../store.js";
import { toIso, today, label } from "../lib/date.js";
import { fmt, range } from "../lib/time.js";

/** 個人カレンダーの画面を描く */
export async function renderCalendar(app) {
  const [mine, stores] = await Promise.all([api.listMyAssignments(), api.listStores()]);   // 自分の勤務 と 店舗の一覧
  /** 店舗のIDから店舗 */
  const storeOf = (id) => stores.find((store) => store.id === id);

  // 今の月から始める
  const now = new Date();
  let year = now.getFullYear();   // 見ている年
  let month = now.getMonth();          // 0=1月
  let selected = today();   // 選んだ日

  draw();

  /**
   * この月の働いた時間の合計（休憩を引いた目安。2026年11月6日）
   * 扶養の範囲で働く人が、自分で時間を見られるように
   */
  function monthTotal() {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;               // 見ている月（例 2026-11）
    const list = mine.filter((shift) => shift.date.startsWith(key));                   // その月の勤務
    const days = new Set(list.map((shift) => shift.date)).size;                         // 入る日数
    const minutes = list.reduce((sum, shift) => sum + workedMinutes(shift), 0);             // 働く時間（分）
    return createElement("div", { class: "month-total" },
      createElement("span", { class: "home-muted" }, `${month + 1}月の合計（${days}日・休憩を引いた目安）`),
      createElement("strong", { class: "num" }, hoursText(minutes)));
  }

  /** 画面を描く */
  function draw() {
    const byDate = new Map();   // 日付 → その日の自分の勤務
    for (const shift of mine) {
      if (!byDate.has(shift.date)) byDate.set(shift.date, []);
      byDate.get(shift.date).push(shift);
    }

    mount(app,
      screenHeader({ title: isManager() ? "自分の勤務" : "マイカレンダー", sub: state.user.name }),
      createElement("div", { class: "screen-body" },
        createElement("section", { class: "card" },
          createElement("div", { class: "cal__nav" },
            createElement("button", { class: "btn btn--small", "aria-label": "前の月", onclick: () => moveMonth(-1) }, "‹"),
            createElement("strong", null, `${year}年 ${month + 1}月`),
            createElement("button", { class: "btn btn--small", "aria-label": "次の月", onclick: () => moveMonth(1) }, "›"),
          ),
          monthGrid(byDate),
          monthTotal(),
          createElement("div", { class: "cal__legend" },
            createElement("span", null, createElement("i", { class: "cal__dot" }), "いつものお店"),
            createElement("span", null, createElement("i", { class: "cal__dot cal__dot--help" }), "応援"),
          ),
        ),
        dayDetail(byDate.get(selected) || []),
        // これからの勤務（どの店舗に何時から何時まで）
        myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, limit: 14 }),
      ),
    );
  }

  /** 月のマス目（月曜はじまり） */
  function monthGrid(byDate) {
    const first = new Date(year, month, 1, 12);   // その月の1日
    const blanks = (first.getDay() + 6) % 7;           // 月曜=0 にそろえる
    const daysInMonth = new Date(year, month + 1, 0).getDate();   // その月の日数
    const cells = [];   // カレンダーのマス
    for (let index = 0; index < blanks; index++) cells.push(createElement("div"));
    for (let days = 1; days <= daysInMonth; days++) {
      const iso = toIso(new Date(year, month, days, 12));   // そのマスの日付
      const work = byDate.get(iso) || [];   // その日の勤務
      const wd = (blanks + days - 1) % 7;                 // 0=月 … 6=日
      cells.push(createElement("button", {
        class: `cal__cell ${iso === selected ? "is-selected" : ""} ${iso === today() ? "is-today" : ""}`,
        "aria-label": `${month + 1}月${days}日${work.length ? ` 勤務 ${work.map((shift) => range(shift.from, shift.to)).join("、")}` : ""}`,
        onclick: () => { selected = iso; draw(); },
      },
        createElement("span", { class: `cal__num ${wd === 6 ? "is-sun" : wd === 5 ? "is-sat" : ""}` }, days),
        // 入っている日は「7〜17」のように始まりと終わりを出す
        work.map((shift) => createElement("span", { class: `cal__chip num ${shift.storeId !== state.user.storeId ? "is-help" : ""}` }, shortRange(shift.from, shift.to))),
      ));
    }
    return createElement("div", { class: "cal" },
      ["月", "火", "水", "木", "金", "土", "日"].map((weekdayName, index) => createElement("div", { class: `cal__wd ${index === 6 ? "is-sun" : index === 5 ? "is-sat" : ""}` }, weekdayName)),
      cells,
    );
  }

  /** 選んだ日のくわしい内容 */
  function dayDetail(work) {
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, label(selected)),
      work.length
        ? work.map((shift) => {
            const store = storeOf(shift.storeId);   // 勤務の店舗
            const help = shift.storeId !== state.user.storeId;   // ほかの店舗への応援か
            return createElement("div", { class: "cal-detail" },
              createElement("div", { class: "cal-detail__time num" }, `コメダ ${range(shift.from, shift.to)}`),
              createElement("div", null, `${store?.name || ""} ・ ${shift.area === "hall" ? "ホール" : "キッチン"}`),
              createElement("div", null, `休憩の目安：${shift.breakAt != null ? fmt(shift.breakAt) : "なし"}`),
              help ? createElement("span", { class: "badge badge--warn" }, "応援（いつもと違うお店です）") : null,
            );
          })
        : createElement("div", { class: "home-muted" }, "この日の勤務はありません（公開前の週はまだ出ません）"),
    );
  }

  /** "7〜17" の短い形（ちょうどの時刻は分を省く。例 7:30〜17 ） */
  function shortRange(from, to) {
    /** マスに出す短い時刻（9:00 → 9、9:30 → 9:30） */
    const shortTime = (minutes) => (minutes % 60 === 0 ? String(minutes / 60 > 24 ? `翌${minutes / 60 - 24}` : minutes / 60) : fmt(minutes));
    return `${shortTime(from)}〜${shortTime(to)}`;
  }

  /** 前の月・次の月へ */
  function moveMonth(step) {
    month += step;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    draw();
  }
}
