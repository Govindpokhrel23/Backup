// ============================================================
// screens/published.js — 公開シフト（店全体・見るだけ）
// ------------------------------------------------------------
// ・今の紙と同じく、店全体のシフトをみんなが見られる
// ・希望は出さない（希望は店長だけが見られる）
// ============================================================

import { h, mount } from "../lib/dom.js";
import { api } from "../api/index.js";
import { screenHeader } from "../components/header.js";
import { timeline } from "../components/timeline.js";
import { weekLabel, datesOf } from "../lib/period.js";
import { label, today } from "../lib/date.js";

export async function renderPublished(app) {
  const [periods, members] = await Promise.all([api.listPeriods(), api.listMembers()]);
  const published = periods.filter((p) => p.status === "published");

  if (!published.length) {
    mount(app, screenHeader({ title: "公開シフト" }),
      h("div", { class: "screen-body" }, h("div", { class: "card" }, "まだ公開されたシフトはありません")));
    return;
  }

  let period = published[published.length - 1];       // いちばん新しい週
  let assignments = await api.listAssignments(period.id);
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
        dayTabs(),
        h("div", { class: "card" },
          timeline({
            members: members.filter((m) => m.active),
            assignments: assignments.filter((a) => a.date === date),
            editable: false,
          }),
        ),
      ),
    );
  }

  function dayTabs() {
    return h("div", { class: "day-tabs" },
      datesOf(period).map((d) => h("button", { class: "chip", "aria-pressed": String(d === date), onclick: () => { date = d; draw(); } }, label(d))));
  }

  async function changeWeek(e) {
    period = published.find((p) => p.id === e.target.value);
    assignments = await api.listAssignments(period.id);
    date = period.weekStart;
    draw();
  }
}
