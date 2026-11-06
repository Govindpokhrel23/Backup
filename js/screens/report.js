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

import { createElement, mount, toast } from "../lib/dom.js";
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
      ...activeStores().map((store) => api.listPeriods(store.id)),
    ]);
    const published = new Set(periodLists.flat().filter((period) => period.status === "published").map((period) => period.id));   // 公開した週
    rows = all.filter((shift) => published.has(shift.periodId));
  }

  /** 今の選び方（この店舗／全部）で数える勤務 */
  function shown() {
    return scope === "store" ? rows.filter((row) => row.storeId === state.storeId) : rows;
  }

  /**
   * 人ごとにまとめる
   * @returns {{member, days, minutes, night, transport, cost}[]} 働いた時間が長い順
   */
  function summary() {
    const byMember = new Map();                                      // 店員ID → その人の勤務
    for (const shift of shown()) byMember.set(shift.memberId, [...(byMember.get(shift.memberId) || []), shift]);
    return [...byMember].map(([id, list]) => {
      const wage = wages.find((wage) => wage.memberId === id) || {};          // その人の時給・交通費
      const days = new Set(list.map((shift) => shift.date)).size;             // 入った日数
      return {
        member: members.find((member) => member.id === id) || { name: "？", kind: "" },
        days,
        minutes: list.reduce((sum, shift) => sum + workedMinutes(shift), 0),
        night: list.reduce((sum, shift) => sum + nightMinutes(shift), 0),
        transport: days * (wage.transport || 0),
        cost: laborCost(list, [{ memberId: id, hourly: wage.hourly || 0, transport: wage.transport || 0 }]),
      };
    }).sort((personA, personB) => personB.minutes - personA.minutes);
  }

  /** 画面を描く */
  function draw() {
    const list = summary();                                          // 人ごとのまとめ
    const total = list.reduce((sum, person) => ({ minutes: sum.minutes + person.minutes, cost: sum.cost + person.cost }), { minutes: 0, cost: 0 });   // 合計
    const [year, member] = month.split("-").map(Number);                     // 年と月
    mount(app,
      screenHeader({ title: "勤務時間の集計", sub: "公開したシフトだけを数えます（給与計算の元に）" }),
      createElement("div", { class: "screen-body" },
        // ---- 月と店舗を選ぶ ----
        createElement("section", { class: "card" },
          createElement("div", { class: "week-nav" },
            createElement("button", { class: "btn btn--small", onclick: () => moveMonth(-1), "aria-label": "前の月" }, "‹ 前の月"),
            createElement("strong", { class: "week-nav__label" }, `${year}年${member}月`),
            createElement("button", { class: "btn btn--small", onclick: () => moveMonth(1), "aria-label": "次の月" }, "次の月 ›")),
          createElement("div", { class: "chip-row" },
            [["store", `この店舗（${activeStores().find((store) => store.id === state.storeId)?.short || ""}）`], ["all", "全部の店舗"]].map(([key, text]) =>
              createElement("button", { class: "chip", "aria-pressed": String(scope === key), onclick: () => { scope = key; draw(); } }, text))),
          createElement("div", { class: "ai-result__stats" },
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "働いた時間の合計"), createElement("strong", { class: "num" }, hoursText(total.minutes))),
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "人件費の目安"), createElement("strong", { class: "num" }, yen(total.cost))),
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "人数"), createElement("strong", { class: "num" }, `${list.length}人`))),
        ),
        // ---- 人ごとの表 ----
        createElement("section", { class: "card" },
          list.length
            ? createElement("div", { class: "table-wrap" },
                createElement("table", { class: "report-table" },
                  createElement("thead", null, createElement("tr", null, ["名前", "立場", "日数", "時間", "うち深夜", "交通費", "人件費の目安"].map((title) => createElement("th", null, title)))),
                  createElement("tbody", null, list.map((wage) => createElement("tr", null,
                    createElement("td", null, wage.member.name),
                    createElement("td", null, CONFIG.KIND_LABEL[wage.member.kind] || ""),
                    createElement("td", { class: "num" }, `${wage.days}日`),
                    createElement("td", { class: "num" }, hoursText(wage.minutes)),
                    createElement("td", { class: "num" }, wage.night ? hoursText(wage.night) : "—"),
                    createElement("td", { class: "num" }, yen(wage.transport)),
                    createElement("td", { class: "num" }, wage.member.kind === "shain" ? "（月給）" : yen(wage.cost)))))))
            : createElement("div", { class: "home-muted" }, "この月に公開したシフトはありません"),
        ),
        // ---- 書き出し ----
        createElement("section", { class: "card" },
          createElement("h2", { class: "card__title" }, "CSV に書き出す（Excel・スプレッドシートで開けます）"),
          createElement("div", { class: "chip-row" },
            createElement("button", { class: "btn btn--primary", onclick: () => exportSummary(list) }, "人ごとの合計"),
            createElement("button", { class: "btn", onclick: exportDetail }, "毎日の勤務（明細）")),
          createElement("div", { class: "home-muted" }, "時間は「休憩を引いた時間」です。休憩は6時間をこえる勤務で45分、8時間をこえる勤務で60分として数えています"),
        ),
      ),
    );
  }

  /** 前の月・次の月へ */
  async function moveMonth(step) {
    const date = step < 0 ? addDays(month, -1) : addDays(monthEnd(month), 1);   // 前の月の最後の日／次の月の1日
    month = monthStart(date);
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
    for (const wage of list) {
      table.push([wage.member.loginId || "", wage.member.name, CONFIG.KIND_LABEL[wage.member.kind] || "", wage.days,
        (wage.minutes / 60).toFixed(2), (wage.night / 60).toFixed(2), wage.transport, wage.member.kind === "shain" ? "" : wage.cost]);
    }
    saveFile(`shift-summary_${fileTag()}.csv`, toCsv(table), "text/csv");
    toast("CSV を保存しました");
  }

  /** 「毎日の勤務（明細）」の CSV */
  function exportDetail() {
    const shortOf = (id) => activeStores().find((store) => store.id === id)?.short || "";   // 店舗の短い名前
    const table = [["日付", "店舗", "ログインID", "名前", "時間", "場所", "働いた時間（時間）", "うち深夜（時間）"]];   // 見出し
    for (const shift of [...shown()].sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date) || shiftA.from - shiftB.from)) {
      const member = members.find((member) => member.id === shift.memberId) || {};       // その店員
      table.push([shift.date, shortOf(shift.storeId), member.loginId || "", member.name || "？", range(shift.from, shift.to), shift.area === "hall" ? "ホール" : "キッチン",
        (workedMinutes(shift) / 60).toFixed(2), (nightMinutes(shift) / 60).toFixed(2)]);
    }
    saveFile(`shift-detail_${fileTag()}.csv`, toCsv(table), "text/csv");
    toast("CSV を保存しました");
  }
}

