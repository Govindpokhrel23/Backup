// ============================================================
// screens/report.js — 勤務時間の集計（月ごと・給与計算用）（店長）
// ------------------------------------------------------------
// このファイルは、1か月の勤務を人ごとにまとめて表にし、
// CSV（Excel で開ける表）に書き出す画面のファイルです（2026年11月6日）。
//
// 数えるもの（公開したシフトだけ。下書きは数えない）：
//   日数 ／ 働いた時間（休憩を引く）／ そのうち深夜（22時〜朝5時）／ 交通費 ／ 人件費の目安
// 店舗：「この店舗」か「全部の店舗」を選べる（応援で行った分も、全部の店舗なら1人にまとまる）
// 計算は lib/labor.js と同じ。※給料の計算そのものではなく「目安」。給与ソフトに入れる時の元になる。
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, activeStores } from "../store.js";
import { screenHeader } from "../components/header.js";
import { workedMinutes, nightMinutes, laborCost, hoursText, yen } from "../lib/labor.js";
import { monthStart, monthEnd, today, addDays } from "../lib/date.js";
import { range } from "../lib/time.js";
import { saveFile, toCsv } from "../lib/download.js";
import { CONFIG } from "../config.js";

/** 勤務時間の集計の画面を描く（店長） */
export async function renderReport(app) {
  let month = monthStart(today());                                   // 見ている月の1日
  let scope = "store";                                               // "store"＝この店舗 / "all"＝全部の店舗
  let rows = [];                                                     // その月の公開した勤務
  const [members, wages] = await Promise.all([api.listCompanyMembers(), api.listWages()]);   // 店員と時給
  await load();
  draw();

  /** その月の、公開した勤務を読む（全部の店舗） */
  async function load() {
    const [all, ...periodLists] = await Promise.all([
      api.listAssignmentsByDates(month, monthEnd(month)),
      ...activeStores().map((s) => api.listPeriods(s.id)),
    ]);
    const published = new Set(periodLists.flat().filter((p) => p.status === "published").map((p) => p.id));   // 公開した週
    rows = all.filter((a) => published.has(a.periodId));
  }

  /** 今の選び方（この店舗／全部）で数える勤務 */
  function shown() {
    return scope === "store" ? rows.filter((a) => a.storeId === state.storeId) : rows;
  }

  /**
   * 人ごとにまとめる
   * @returns {{member, days, minutes, night, transport, cost}[]} 働いた時間が長い順
   */
  function summary() {
    const byMember = new Map();                                      // 店員ID → その人の勤務
    for (const a of shown()) byMember.set(a.memberId, [...(byMember.get(a.memberId) || []), a]);
    return [...byMember].map(([id, list]) => {
      const w = wages.find((x) => x.memberId === id) || {};          // その人の時給・交通費
      const days = new Set(list.map((a) => a.date)).size;             // 入った日数
      return {
        member: members.find((m) => m.id === id) || { name: "？", kind: "" },
        days,
        minutes: list.reduce((s, a) => s + workedMinutes(a), 0),
        night: list.reduce((s, a) => s + nightMinutes(a), 0),
        transport: days * (w.transport || 0),
        cost: laborCost(list, [{ memberId: id, hourly: w.hourly || 0, transport: w.transport || 0 }]),
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }

  /** 画面を描く */
  function draw() {
    const list = summary();                                          // 人ごとのまとめ
    const total = list.reduce((t, x) => ({ minutes: t.minutes + x.minutes, cost: t.cost + x.cost }), { minutes: 0, cost: 0 });   // 合計
    const [y, m] = month.split("-").map(Number);                     // 年と月
    mount(app,
      screenHeader({ title: "勤務時間の集計", sub: "公開したシフトだけを数えます（給与計算の元に）" }),
      h("div", { class: "screen-body" },
        // ---- 月と店舗を選ぶ ----
        h("section", { class: "card" },
          h("div", { class: "week-nav" },
            h("button", { class: "btn btn--small", onclick: () => moveMonth(-1), "aria-label": "前の月" }, "‹ 前の月"),
            h("strong", { class: "week-nav__label" }, `${y}年${m}月`),
            h("button", { class: "btn btn--small", onclick: () => moveMonth(1), "aria-label": "次の月" }, "次の月 ›")),
          h("div", { class: "chip-row" },
            [["store", `この店舗（${activeStores().find((s) => s.id === state.storeId)?.short || ""}）`], ["all", "全部の店舗"]].map(([key, text]) =>
              h("button", { class: "chip", "aria-pressed": String(scope === key), onclick: () => { scope = key; draw(); } }, text))),
          h("div", { class: "ai-result__stats" },
            h("div", { class: "ai-stat" }, h("span", { class: "home-muted" }, "働いた時間の合計"), h("strong", { class: "num" }, hoursText(total.minutes))),
            h("div", { class: "ai-stat" }, h("span", { class: "home-muted" }, "人件費の目安"), h("strong", { class: "num" }, yen(total.cost))),
            h("div", { class: "ai-stat" }, h("span", { class: "home-muted" }, "人数"), h("strong", { class: "num" }, `${list.length}人`))),
        ),
        // ---- 人ごとの表 ----
        h("section", { class: "card" },
          list.length
            ? h("div", { class: "table-wrap" },
                h("table", { class: "report-table" },
                  h("thead", null, h("tr", null, ["名前", "立場", "日数", "時間", "うち深夜", "交通費", "人件費の目安"].map((t) => h("th", null, t)))),
                  h("tbody", null, list.map((x) => h("tr", null,
                    h("td", null, x.member.name),
                    h("td", null, CONFIG.KIND_LABEL[x.member.kind] || ""),
                    h("td", { class: "num" }, `${x.days}日`),
                    h("td", { class: "num" }, hoursText(x.minutes)),
                    h("td", { class: "num" }, x.night ? hoursText(x.night) : "—"),
                    h("td", { class: "num" }, yen(x.transport)),
                    h("td", { class: "num" }, x.member.kind === "shain" ? "（月給）" : yen(x.cost)))))))
            : h("div", { class: "home-muted" }, "この月に公開したシフトはありません"),
        ),
        // ---- 書き出し ----
        h("section", { class: "card" },
          h("h2", { class: "card__title" }, "CSV に書き出す（Excel・スプレッドシートで開けます）"),
          h("div", { class: "chip-row" },
            h("button", { class: "btn btn--primary", onclick: () => exportSummary(list) }, "人ごとの合計"),
            h("button", { class: "btn", onclick: exportDetail }, "毎日の勤務（明細）")),
          h("div", { class: "home-muted" }, "時間は「休憩を引いた時間」です。休憩は6時間をこえる勤務で45分、8時間をこえる勤務で60分として数えています"),
        ),
      ),
    );
  }

  /** 前の月・次の月へ */
  async function moveMonth(n) {
    const d = n < 0 ? addDays(month, -1) : addDays(monthEnd(month), 1);   // 前の月の最後の日／次の月の1日
    month = monthStart(d);
    await load();
    draw();
  }

  /** ファイルの名前に使う文字（例 2026-11_store。日本語の名前は保存できない機械があるので英数字だけ） */
  function fileTag() {
    return `${month.slice(0, 7)}_${scope === "all" ? "all" : "store"}`;
  }

  /** 「人ごとの合計」の CSV */
  function exportSummary(list) {
    const table = [["ログインID", "名前", "立場", "日数", "時間（時間）", "うち深夜（時間）", "交通費（円）", "人件費の目安（円）"]];   // 見出し
    for (const x of list) {
      table.push([x.member.loginId || "", x.member.name, CONFIG.KIND_LABEL[x.member.kind] || "", x.days,
        (x.minutes / 60).toFixed(2), (x.night / 60).toFixed(2), x.transport, x.member.kind === "shain" ? "" : x.cost]);
    }
    saveFile(`shift-summary_${fileTag()}.csv`, toCsv(table), "text/csv");
    toast("CSV を保存しました");
  }

  /** 「毎日の勤務（明細）」の CSV */
  function exportDetail() {
    const shortOf = (id) => activeStores().find((s) => s.id === id)?.short || "";   // 店舗の短い名前
    const table = [["日付", "店舗", "ログインID", "名前", "時間", "場所", "働いた時間（時間）", "うち深夜（時間）"]];   // 見出し
    for (const a of [...shown()].sort((x, y) => x.date.localeCompare(y.date) || x.from - y.from)) {
      const m = members.find((x) => x.id === a.memberId) || {};       // その店員
      table.push([a.date, shortOf(a.storeId), m.loginId || "", m.name || "？", range(a.from, a.to), a.area === "hall" ? "ホール" : "キッチン",
        (workedMinutes(a) / 60).toFixed(2), (nightMinutes(a) / 60).toFixed(2)]);
    }
    saveFile(`shift-detail_${fileTag()}.csv`, toCsv(table), "text/csv");
    toast("CSV を保存しました");
  }
}

