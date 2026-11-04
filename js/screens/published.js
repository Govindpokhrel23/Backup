// ============================================================
// screens/published.js — 公開シフト（店全体・見るだけ）
// ------------------------------------------------------------
// ・今の紙と同じく、店全体のシフトをみんなが見られる
// ・希望は出さない（希望は店長だけが見られる）
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { screenHeader } from "../components/header.js";
import { timeline } from "../components/timeline.js";
import { dayList } from "../components/day-list.js";
import { weekLabel, datesOf } from "../lib/period.js";
import { label, today, dayType } from "../lib/date.js";
import { CONFIG } from "../config.js";

export async function renderPublished(app) {
  const [periods, members, storeHours, holidays] = await Promise.all([api.listPeriods(), api.listMembers(), api.getStoreHours(), api.listHolidays()]);
  const published = periods.filter((p) => p.status === "published");

  if (!published.length) {
    mount(app, screenHeader({ title: "公開シフト" }),
      h("div", { class: "screen-body" }, h("div", { class: "card" }, "まだ公開されたシフトはありません")));
    return;
  }

  let period = published[published.length - 1];       // いちばん新しい週
  let assignments = await api.listAssignments(period.id);
  let confirmed = (await api.listConfirms(period.id)).length > 0;   // 自分が「確認しました」を押したか
  let date = datesOf(period).includes(today()) ? today() : period.weekStart;

  draw();

  function draw() {
    mount(app,
      screenHeader({
        title: "公開シフト",
        sub: weekLabel(period),
        right: published.length > 1
          ? h("select", { class: "select", style: { width: "auto" }, "aria-label": "週を選ぶ", onchange: changeWeek },
              published.map((p) => h("option", { value: p.id, selected: p.id === period.id }, weekLabel(p))))
          : null,
      }),
      h("div", { class: "screen-body" },
        // 「確認しました」：店長が、まだ見ていない人を分かるようにする（7shifts の既読と同じ）
        confirmed
          ? h("div", { class: "notice notice--ok" }, "この週のシフトは確認済みです")
          : h("button", { class: "btn btn--primary btn--block", onclick: async () => {
              await api.confirmPeriod(period.id); confirmed = true; toast("確認しました。店長に伝わります"); draw();
            } }, "シフトを見ました（確認する）"),
        period.note ? h("div", { class: "notice notice--warn", style: { fontWeight: 400, whiteSpace: "pre-line" } }, `連絡事項：${period.note}`) : null,
        dayTabs(),
        h("div", { class: "card" },
          timeline({
            ...dayRange(),
            hours: storeHours[dayType(date, holidays)],     // 「立」「締」の印に使う
            members: members.filter((m) => m.active),
            assignments: assignments.filter((a) => a.date === date),
            editable: false,
          }),
        ),
        dayList({ assignments: assignments.filter((a) => a.date === date), members, hours: storeHours[dayType(date, holidays)] }),
      ),
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
    period = published.find((p) => p.id === e.target.value);
    assignments = await api.listAssignments(period.id);
    confirmed = (await api.listConfirms(period.id)).length > 0;
    date = period.weekStart;
    draw();
  }
}
