// ============================================================
// screens/published.js — 公開シフト（見るだけ）
// ------------------------------------------------------------
// ・今の紙と同じく、店全体のシフトをみんなが見られる
// ・3店舗（安城福釜店・安城店・安城今村店）の公開シフトを、
//   上のボタンで切り替えて見られる（2026年11月4日）。最初は自分のメインの店舗
// ・希望は出さない（希望は店長だけが見られる）
// ・「シフトを見ました」は、自分のメインの店舗の週で押す
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { screenHeader } from "../components/header.js";
import { timeline } from "../components/timeline.js";
import { dayList } from "../components/day-list.js";
import { weekLabel, datesOf } from "../lib/period.js";
import { label, today, dayType } from "../lib/date.js";
import { CONFIG } from "../config.js";

export async function renderPublished(app) {
  const holidays = await api.listHolidays();

  // ---------- 画面の中の状態 ----------
  let storeId = state.user.storeId;   // 見ている店舗（最初は自分のメインの店舗）
  let published = [];                 // その店舗の公開済みの週
  let members = [];                   // その店舗で働ける人
  let storeHours = null;              // その店舗の営業時間
  let period = null;                  // 見ている週
  let assignments = [];               // その週の勤務
  let confirmed = false;              // 自分が「確認しました」を押したか
  let date = today();                 // 見ている日

  await loadStore(storeId);
  draw();

  // ============================================================
  // 読み込み
  // ============================================================

  /** 店舗を切り替える：その店舗の公開済みの週を読む（同じ日付の週があればそこを開く） */
  async function loadStore(id) {
    storeId = id;
    const [periods, mem, hours] = await Promise.all([api.listPeriods(id), api.listMembers(id), api.getStoreHours(id)]);
    published = periods.filter((p) => p.status === "published");
    members = mem;
    storeHours = hours;
    const sameWeek = published.find((p) => datesOf(p).includes(date));
    await loadWeek(sameWeek || published[published.length - 1] || null);
  }

  /** 週を読む */
  async function loadWeek(p) {
    period = p;
    if (!p) { assignments = []; return; }
    assignments = await api.listAssignments(p.id);
    confirmed = (await api.listConfirms(p.id)).length > 0;
    if (!datesOf(p).includes(date)) date = datesOf(p).includes(today()) ? today() : p.weekStart;
  }

  // ============================================================
  // 描く
  // ============================================================
  function draw() {
    const isMain = storeId === state.user.storeId;
    mount(app,
      screenHeader({
        title: "公開シフト",
        sub: period ? weekLabel(period) : "",
        right: published.length > 1
          ? h("select", { class: "select", style: { width: "auto" }, "aria-label": "週を選ぶ", onchange: changeWeek },
              published.map((p) => h("option", { value: p.id, selected: p.id === period?.id }, weekLabel(p))))
          : null,
        // 3店舗の切り替え
        extra: h("div", { class: "store-switch" },
          state.stores.map((st) => h("button", {
            class: "chip store-switch__btn",
            "aria-pressed": String(st.id === storeId),
            onclick: async () => { if (st.id !== storeId) { await loadStore(st.id); draw(); } },
          }, st.short, st.id === state.user.storeId ? h("span", { class: "store-switch__mine" }, "メイン") : null))),
      }),
      period
        ? h("div", { class: "screen-body" },
            // 「確認しました」：自分のメインの店舗の週だけ（店長が、まだ見ていない人を分かるように）
            isMain
              ? (confirmed
                  ? h("div", { class: "notice notice--ok" }, "この週のシフトは確認済みです")
                  : h("button", { class: "btn btn--primary btn--block", onclick: async () => {
                      await api.confirmPeriod(period.id); confirmed = true; toast("確認しました。店長に伝わります"); draw();
                    } }, "シフトを見ました（確認する）"))
              : null,
            period.note ? h("div", { class: "notice notice--warn", style: { fontWeight: 400, whiteSpace: "pre-line" } }, `連絡事項：${period.note}`) : null,
            dayTabs(),
            h("div", { class: "card" },
              timeline({
                ...dayRange(),
                hours: storeHours[dayType(date, holidays)],     // 「立」「締」の印に使う
                members: members.filter((m) => m.active),
                assignments: assignments.filter((a) => a.date === date),
                selectedId: state.user.id,                      // 自分の行に色をつける
                editable: false,
              }),
            ),
            dayList({ assignments: assignments.filter((a) => a.date === date), members, hours: storeHours[dayType(date, holidays)] }),
          )
        : h("div", { class: "screen-body" }, h("div", { class: "card" }, "この店舗には、まだ公開されたシフトはありません")),
    );
  }

  /** 表の左端と右端（7:00〜22:00 より外の勤務があれば広げる） */
  function dayRange() {
    const day = assignments.filter((a) => a.date === date);
    const start = Math.min(CONFIG.DAY_START, ...day.map((a) => a.from));
    const end = Math.max(CONFIG.DAY_END, ...day.map((a) => a.to));
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }

  function dayTabs() {
    return h("div", { class: "day-tabs" },
      datesOf(period).map((d) => h("button", { class: "chip", "aria-pressed": String(d === date), onclick: () => { date = d; draw(); } }, label(d))));
  }

  async function changeWeek(e) {
    await loadWeek(published.find((p) => p.id === e.target.value));
    draw();
  }
}
