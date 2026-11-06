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

import { createElement, mount, toast } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, activeStores } from "../store.js";   // アプリの状態・店舗の一覧を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { workedMinutes, nightMinutes, laborCost, hoursText, yen } from "../lib/labor.js";   // 時間とお金の計算の道具を読む
import { monthStart, monthEnd, today, addDays } from "../lib/date.js";   // 日付の道具を読む
import { range } from "../lib/time.js";   // 時間の表示の道具を読む
import { saveFile, toCsv } from "../lib/download.js";   // ファイル保存と CSV の道具を読む
import { CONFIG } from "../config.js";   // 設定を読む

/** 勤務時間の集計の画面を描く（店長） */
export async function renderReport(app) {   // 勤務時間の集計の画面を描く関数
  let month = monthStart(today());                                   // 見ている月の1日
  let scope = "store";                                               // "store"＝この店舗 / "all"＝全部の店舗
  let rows = [];                                                     // その月の公開した勤務
  const [members, wages] = await Promise.all([api.listCompanyMembers(), api.listWages()]);   // 店員と時給
  await load();   // はじめに読む
  draw();   // 描く

  /** その月の、公開した勤務を読む（全部の店舗） */
  async function load() {   // その月の公開した勤務を読む関数
    const [all, ...periodLists] = await Promise.all([   // 同時に読む
      api.listAssignmentsByDates(month, monthEnd(month)),   // その月の勤務
      ...activeStores().map((store) => api.listPeriods(store.id)),   // 店舗ごとの週
    ]);
    const published = new Set(periodLists.flat().filter((period) => period.status === "published").map((period) => period.id));   // 公開した週
    rows = all.filter((shift) => published.has(shift.periodId));   // 公開した週の勤務だけ
  }

  /** 今の選び方（この店舗／全部）で数える勤務 */
  function shown() {   // 今の選び方で数える勤務を出す関数
    return scope === "store" ? rows.filter((row) => row.storeId === state.storeId) : rows;   // この店舗だけか全部
  }

  /**
   * 人ごとにまとめる
   * @returns {{member, days, minutes, night, transport, cost}[]} 働いた時間が長い順
   */
  function summary() {   // 人ごとにまとめる関数
    const byMember = new Map();                                      // 店員ID → その人の勤務
    for (const shift of shown()) byMember.set(shift.memberId, [...(byMember.get(shift.memberId) || []), shift]);   // 人ごとに勤務を集める
    return [...byMember].map(([id, list]) => {   // 人ごとに
      const wage = wages.find((wage) => wage.memberId === id) || {};          // その人の時給・交通費
      const days = new Set(list.map((shift) => shift.date)).size;             // 入った日数
      return {   // 返す
        member: members.find((member) => member.id === id) || { name: "？", kind: "" },   // 店員
        days,   // 日数
        minutes: list.reduce((sum, shift) => sum + workedMinutes(shift), 0),   // 働いた時間
        night: list.reduce((sum, shift) => sum + nightMinutes(shift), 0),   // 深夜の時間
        transport: days * (wage.transport || 0),   // 交通費
        cost: laborCost(list, [{ memberId: id, hourly: wage.hourly || 0, transport: wage.transport || 0 }]),   // 人件費
      };
    }).sort((personA, personB) => personB.minutes - personA.minutes);   // 働いた時間が長い順
  }

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    const list = summary();                                          // 人ごとのまとめ
    const total = list.reduce((sum, person) => ({ minutes: sum.minutes + person.minutes, cost: sum.cost + person.cost }), { minutes: 0, cost: 0 });   // 合計
    const [year, monthNumber] = month.split("-").map(Number);                     // 年と月
    mount(app,   // 画面に入れる
      screenHeader({ title: "勤務時間の集計", sub: "公開したシフトだけを数えます（給与計算の元に）" }),   // 見出し
      createElement("div", { class: "screen-body" },   // 本文
        // ---- 月と店舗を選ぶ ----
        createElement("section", { class: "card" },   // 月と店舗を選ぶカード
          createElement("div", { class: "week-nav" },   // 月を変える行
            createElement("button", { class: "btn btn--small", onclick: () => moveMonth(-1), "aria-label": "前の月" }, "‹ 前の月"),   // 前の月
            createElement("strong", { class: "week-nav__label" }, `${year}年${monthNumber}月`),   // 今の月
            createElement("button", { class: "btn btn--small", onclick: () => moveMonth(1), "aria-label": "次の月" }, "次の月 ›")),   // 次の月
          createElement("div", { class: "chip-row" },   // 店舗の選び方
            [["store", `この店舗（${activeStores().find((store) => store.id === state.storeId)?.short || ""}）`], ["all", "全部の店舗"]].map(([key, text]) =>   // この店舗・全部の店舗
              createElement("button", { class: "chip", "aria-pressed": String(scope === key), onclick: () => { scope = key; draw(); } }, text))),   // ボタン
          createElement("div", { class: "ai-result__stats" },   // 合計の数字
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "働いた時間の合計"), createElement("strong", { class: "num" }, hoursText(total.minutes))),   // 時間の合計
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "人件費の目安"), createElement("strong", { class: "num" }, yen(total.cost))),   // 人件費の合計
            createElement("div", { class: "ai-stat" }, createElement("span", { class: "home-muted" }, "人数"), createElement("strong", { class: "num" }, `${list.length}人`))),   // 人数
        ),
        // ---- 人ごとの表 ----
        createElement("section", { class: "card" },   // 人ごとの表のカード
          list.length   // あれば表
            ? createElement("div", { class: "table-wrap" },   // 横にスクロールできる入れ物
                createElement("table", { class: "report-table" },   // 表
                  createElement("thead", null, createElement("tr", null, ["名前", "立場", "日数", "時間", "うち深夜", "交通費", "人件費の目安"].map((title) => createElement("th", null, title)))),   // 見出しの行
                  createElement("tbody", null, list.map((person) => createElement("tr", null,   // 1人1行
                    createElement("td", null, person.member.name),   // 名前
                    createElement("td", null, CONFIG.KIND_LABEL[person.member.kind] || ""),   // 立場
                    createElement("td", { class: "num" }, `${person.days}日`),   // 日数
                    createElement("td", { class: "num" }, hoursText(person.minutes)),   // 時間
                    createElement("td", { class: "num" }, person.night ? hoursText(person.night) : "—"),   // 深夜
                    createElement("td", { class: "num" }, yen(person.transport)),   // 交通費
                    createElement("td", { class: "num" }, person.member.kind === "shain" ? "（月給）" : yen(person.cost)))))))   // 人件費（社員は月給）
            : createElement("div", { class: "home-muted" }, "この月に公開したシフトはありません"),   // ない時の文
        ),
        // ---- 書き出し ----
        createElement("section", { class: "card" },   // 書き出しのカード
          createElement("h2", { class: "card__title" }, "CSV に書き出す（Excel・スプレッドシートで開けます）"),   // 見出し
          createElement("div", { class: "chip-row" },   // ボタンの行
            createElement("button", { class: "btn btn--primary", onclick: () => exportSummary(list) }, "人ごとの合計"),   // 人ごとの合計
            createElement("button", { class: "btn", onclick: exportDetail }, "毎日の勤務（明細）")),   // 毎日の明細
          createElement("div", { class: "home-muted" }, "時間は「休憩を引いた時間」です。休憩は6時間をこえる勤務で45分、8時間をこえる勤務で60分として数えています"),   // 説明
        ),
      ),
    );
  }

  /** 前の月・次の月へ */
  async function moveMonth(step) {   // 月を変える関数
    const date = step < 0 ? addDays(month, -1) : addDays(monthEnd(month), 1);   // 前の月の最後の日／次の月の1日
    month = monthStart(date);   // その月の1日
    await load();   // 読みなおす
    draw();   // 描く
  }

  /** ファイルの名前に使う文字（例 2026-11_store。日本語の名前は保存できない機械があるので英数字だけ） */
  function fileTag() {   // ファイル名に使う文字を作る関数
    return `${month.slice(0, 7)}_${scope === "all" ? "all" : "store"}`;   // 「2026-11_store」
  }

  /** 「人ごとの合計」の CSV */
  function exportSummary(list) {   // 人ごとの合計の CSV を作る関数
    const table = [["ログインID", "名前", "立場", "日数", "時間（時間）", "うち深夜（時間）", "交通費（円）", "人件費の目安（円）"]];   // 見出し
    for (const person of list) {   // 1人ずつ
      table.push([person.member.loginId || "", person.member.name, CONFIG.KIND_LABEL[person.member.kind] || "", person.days,   // ID・名前・立場・日数
        (person.minutes / 60).toFixed(2), (person.night / 60).toFixed(2), person.transport, person.member.kind === "shain" ? "" : person.cost]);   // 時間・深夜・交通費・人件費
    }
    saveFile(`shift-summary_${fileTag()}.csv`, toCsv(table), "text/csv");   // 保存
    toast("CSV を保存しました");   // お知らせ
  }

  /** 「毎日の勤務（明細）」の CSV */
  function exportDetail() {   // 毎日の明細の CSV を作る関数
    const shortOf = (id) => activeStores().find((store) => store.id === id)?.short || "";   // 店舗の短い名前
    const table = [["日付", "店舗", "ログインID", "名前", "時間", "場所", "働いた時間（時間）", "うち深夜（時間）"]];   // 見出し
    for (const shift of [...shown()].sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date) || shiftA.from - shiftB.from)) {   // 日付と時間の順に
      const member = members.find((member) => member.id === shift.memberId) || {};       // その店員
      table.push([shift.date, shortOf(shift.storeId), member.loginId || "", member.name || "？", range(shift.from, shift.to), shift.area === "hall" ? "ホール" : "キッチン",   // 日付・店舗・ID・名前・時間・場所
        (workedMinutes(shift) / 60).toFixed(2), (nightMinutes(shift) / 60).toFixed(2)]);   // 働いた時間・深夜
    }
    saveFile(`shift-detail_${fileTag()}.csv`, toCsv(table), "text/csv");   // 保存
    toast("CSV を保存しました");   // お知らせ
  }
}

