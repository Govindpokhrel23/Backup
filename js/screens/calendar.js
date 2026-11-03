// ============================================================
// screens/calendar.js — 個人カレンダー（自分だけのカレンダー）
// ------------------------------------------------------------
// ・入っている日に「9:00」のように始まりの時刻を出す
// ・日を押すと「コメダ 9:00〜15:00」と、店舗・場所・休憩の目安
// ・応援（いつもと違う店舗）の日は色を変えて店名つき
// ・公開前の週は出さない（公開されてから見える）
// ============================================================

import { h, mount } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { screenHeader } from "../components/header.js";
import { toIso, today, label } from "../lib/date.js";
import { fmt, range } from "../lib/time.js";

export async function renderCalendar(app) {
  const [mine, stores] = await Promise.all([api.listMyAssignments(), api.listStores()]);
  const storeOf = (id) => stores.find((s) => s.id === id);

  // 今の月から始める
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();          // 0=1月
  let selected = today();

  draw();

  function draw() {
    const byDate = new Map();
    for (const a of mine) {
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date).push(a);
    }

    mount(app,
      screenHeader({ title: "マイカレンダー", sub: state.user.name }),
      h("div", { class: "screen-body" },
        h("section", { class: "card" },
          h("div", { class: "cal__nav" },
            h("button", { class: "btn btn--small", "aria-label": "前の月", onclick: () => moveMonth(-1) }, "‹"),
            h("strong", null, `${year}年 ${month + 1}月`),
            h("button", { class: "btn btn--small", "aria-label": "次の月", onclick: () => moveMonth(1) }, "›"),
          ),
          monthGrid(byDate),
          h("div", { class: "cal__legend" },
            h("span", null, h("i", { class: "cal__dot" }), "いつものお店"),
            h("span", null, h("i", { class: "cal__dot cal__dot--help" }), "応援"),
          ),
        ),
        dayDetail(byDate.get(selected) || []),
      ),
    );
  }

  /** 月のマス目（月曜はじまり） */
  function monthGrid(byDate) {
    const first = new Date(year, month, 1, 12);
    const blanks = (first.getDay() + 6) % 7;           // 月曜=0 にそろえる
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < blanks; i++) cells.push(h("div"));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIso(new Date(year, month, d, 12));
      const work = byDate.get(iso) || [];
      const wd = (blanks + d - 1) % 7;                 // 0=月 … 6=日
      cells.push(h("button", {
        class: `cal__cell ${iso === selected ? "is-selected" : ""} ${iso === today() ? "is-today" : ""}`,
        "aria-label": `${month + 1}月${d}日${work.length ? ` 勤務 ${work.map((a) => range(a.from, a.to)).join("、")}` : ""}`,
        onclick: () => { selected = iso; draw(); },
      },
        h("span", { class: `cal__num ${wd === 6 ? "is-sun" : wd === 5 ? "is-sat" : ""}` }, d),
        // 入っている日は「7〜17」のように始まりと終わりを出す
        work.map((a) => h("span", { class: `cal__chip num ${a.storeId !== state.user.storeId ? "is-help" : ""}` }, shortRange(a.from, a.to))),
      ));
    }
    return h("div", { class: "cal" },
      ["月", "火", "水", "木", "金", "土", "日"].map((w, i) => h("div", { class: `cal__wd ${i === 6 ? "is-sun" : i === 5 ? "is-sat" : ""}` }, w)),
      cells,
    );
  }

  /** 選んだ日のくわしい内容 */
  function dayDetail(work) {
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, label(selected)),
      work.length
        ? work.map((a) => {
            const store = storeOf(a.storeId);
            const help = a.storeId !== state.user.storeId;
            return h("div", { class: "cal-detail" },
              h("div", { class: "cal-detail__time num" }, `コメダ ${range(a.from, a.to)}`),
              h("div", null, `${store?.name || ""} ・ ${a.area === "hall" ? "ホール" : "キッチン"}`),
              h("div", null, `休憩の目安：${a.breakAt != null ? fmt(a.breakAt) : "なし"}`),
              help ? h("span", { class: "badge badge--warn" }, "応援（いつもと違うお店です）") : null,
            );
          })
        : h("div", { class: "home-muted" }, "この日の勤務はありません（公開前の週はまだ出ません）"),
    );
  }

  /** "7〜17" の短い形（ちょうどの時刻は分を省く。例 7:30〜17 ） */
  function shortRange(from, to) {
    const t = (m) => (m % 60 === 0 ? String(m / 60 > 24 ? `翌${m / 60 - 24}` : m / 60) : fmt(m));
    return `${t(from)}〜${t(to)}`;
  }

  function moveMonth(n) {
    month += n;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    draw();
  }
}
