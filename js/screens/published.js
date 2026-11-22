// ============================================================
// screens/published.js — 公開シフト（見るだけ）
// ------------------------------------------------------------
// このファイルは、公開シフト（見るだけ）のファイルです。
// ・今の紙と同じく、店全体のシフトをみんなが見られる
// ・3店舗（安城福釜店・安城店・安城今村店）の公開シフトを、
//   上のボタンで切り替えて見られる（2026年11月4日）。最初は自分のメインの店舗
// ・希望は出さない（希望は店長だけが見られる）
// ・「シフトを見ました」は、自分のメインの店舗の週で押す
// ============================================================

import { createElement, mount, toast } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, activeStores } from "../store.js";   // アプリの状態・店舗の一覧を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { paperDay, paperRows } from "../components/paper-day.js";   // 紙のシフト表と同じ1日の枠を読む（2026年11月22日）
import { dayList } from "../components/day-list.js";   // 1日の一覧の部品を読む
import { weekLabel, datesOf } from "../lib/period.js";   // 週の表示の道具を読む
import { label, today, dayType } from "../lib/date.js";   // 日付の道具を読む
import { weekGrid, weekLegend } from "../components/week-grid.js";   // 1週間の表の部品を読む（2026年11月15日：店員も週で見られるように）
import { hoursOn } from "../lib/store-hours.js";   // その日の営業時間（休み・時間の変更も入れる）の道具を読む

/** 公開シフトの画面を描く */
export async function renderPublished(app) {   // 公開シフトの画面を描く関数
  const holidays = await api.listHolidays();   // 祝日

  // ---------- 画面の中の状態 ----------
  let storeId = state.user.storeId;   // 見ている店舗（最初は自分のメインの店舗）
  let published = [];                 // その店舗の公開済みの週
  let members = [];                   // その店舗で働ける人
  let storeHours = null;              // その店舗の営業時間
  let period = null;                  // 見ている週
  let assignments = [];               // その週の勤務
  let confirmed = false;              // 自分が「確認しました」を押したか
  let date = today();                 // 見ている日
  let view = readView();              // 見方（"week"＝1週間の表／"day"＝1日の線）。はじめは1週間

  await loadStore(storeId);   // はじめの店舗を読む
  draw();   // 描く

  // ============================================================
  // 読み込み
  // ============================================================

  /** 店舗を切り替える：その店舗の公開済みの週を読む（同じ日付の週があればそこを開く） */
  async function loadStore(id) {   // 店舗の情報を読む関数
    storeId = id;   // 見ている店舗を変える
    const [periods, mem, hours] = await Promise.all([api.listPeriods(id), api.listMembers(id), api.getStoreHours(id)]);   // 週・店員・営業時間
    published = periods.filter((period) => period.status === "published");   // 公開した週だけ
    members = mem;   // 店員
    storeHours = hours;   // 営業時間
    const sameWeek = published.find((period) => datesOf(period).includes(date));   // 同じ日付が入る週
    await loadWeek(sameWeek || published[published.length - 1] || null);   // 同じ週か、一番新しい週を読む
  }

  /** 週を読む */
  async function loadWeek(target) {   // 週の勤務を読む関数
    period = target;   // 見ている週を変える
    if (!target) { assignments = []; return; }   // 週がなければ空
    assignments = await api.listAssignments(target.id);   // 勤務を読む
    confirmed = (await api.listConfirms(target.id)).length > 0;   // もう確認したか
    if (!datesOf(target).includes(date)) date = datesOf(target).includes(today()) ? today() : target.weekStart;   // 見ている日がこの週になければ、今日か週の始まり
  }

  // ============================================================
  // 描く
  // ============================================================
  function draw() {   // 画面を描く関数
    const isMain = storeId === state.user.storeId;   // 自分のメインの店舗か
    mount(app,   // 画面に入れる
      screenHeader({   // 見出し
        title: "公開シフト",   // タイトル
        sub: period ? weekLabel(period) : "",   // 週の日付
        right: published.length > 1   // 週が2つ以上あれば
          ? createElement("select", { class: "select", style: { width: "auto" }, "aria-label": "週を選ぶ", onchange: changeWeek },   // 週を選ぶ欄
              published.map((eachPeriod) => createElement("option", { value: eachPeriod.id, selected: eachPeriod.id === period?.id }, weekLabel(eachPeriod))))   // 公開した週
          : null,   // 1つなら出さない
        // 3店舗の切り替え
        extra: createElement("div", { class: "store-switch" },   // 店舗を切りかえるボタン
          activeStores().map((eachStore) => createElement("button", {   // 店舗ごと
            class: "chip store-switch__btn",   // 見た目
            "aria-pressed": String(eachStore.id === storeId),   // 見ている店舗に印
            onclick: async () => { if (eachStore.id !== storeId) { await loadStore(eachStore.id); draw(); } },   // 押したらその店舗を読んで描く
          }, eachStore.short, eachStore.id === state.user.storeId ? createElement("span", { class: "store-switch__mine" }, "メイン") : null))),   // 名前と「メイン」の印
      }),
      period   // 週があれば
        ? createElement("div", { class: "screen-body" },   // 本文
            // 「確認しました」：自分のメインの店舗の週だけ（店長が、まだ見ていない人を分かるように）
            isMain   // 自分の店舗なら
              ? (confirmed   // 確認済みなら
                  ? createElement("div", { class: "notice notice--ok" }, "この週のシフトは確認済みです")   // 確認済みの文
                  : createElement("button", { class: "btn btn--primary btn--block", onclick: async () => {   // まだならボタン
                      await api.confirmPeriod(period.id); confirmed = true; toast("確認しました。店長に伝わります"); draw();   // 確認を保存して知らせる
                    } }, "シフトを見ました（確認する）"))   // ボタンの文字
              : null,   // ほかの店舗では出さない
            period.note ? createElement("div", { class: "notice notice--warn", style: { fontWeight: 400, whiteSpace: "pre-line" } }, `連絡事項：${period.note}`) : null,   // 連絡事項
            viewSwitch(),   // 週／日の切りかえ
            view === "week" ? weekCard() : null,   // 1週間の表（紙のシフト表と同じ形）
            view === "day" ? dayTabs() : null,   // 日のタブ
            view === "day" ? paperDayCard() : null,   // 1日（紙のシフト表と同じ形。2026年11月22日）
            view === "day" ? dayList({ assignments: assignments.filter((shift) => shift.date === date), members, hours: hoursOn(storeHours, date, dayType(date, holidays)) }) : null,   // 1日の一覧
          )
        : createElement("div", { class: "screen-body" }, createElement("div", { class: "card" }, "この店舗には、まだ公開されたシフトはありません")),   // 週がない時の文
    );
  }

  /** 週／日の切りかえ（選んだ見方はこのスマホに覚える） */
  function viewSwitch() {   // 見方の切りかえを作る関数
    const pick = (next) => { view = next; saveView(next); draw(); };   // 見方を変える
    return createElement("div", { class: "seg published-seg", role: "group", "aria-label": "見方" },   // 切りかえの枠
      createElement("button", { class: "seg__btn", "aria-pressed": String(view === "week"), onclick: () => pick("week") }, "週"),   // 1週間の表
      createElement("button", { class: "seg__btn", "aria-pressed": String(view === "day"), onclick: () => pick("day") }, "日"));   // 1日の線
  }

  /** 1週間の表（たて＝人・よこ＝7日。マスを押すとその日の線の見方へ） */
  function weekCard() {   // 1週間の表のカードを作る関数
    const dates = datesOf(period);   // 7日
    return createElement("section", { class: "card card--tight" },   // カード
      weekGrid({   // 1週間の表（シフト作成と同じ部品）
        dates,   // 7日
        members: members.filter((member) => member.active && assignments.some((shift) => shift.memberId === member.id)),   // この週に入っている人だけ
        assignments,   // この週の勤務
        elsewhere: [],   // ほかの店舗の勤務は出さない
        availabilities: [],   // 希望は出さない（店長だけが見る）
        problemDays: new Set(),   // 問題の印は出さない
        closedDays: new Set(dates.filter((eachDate) => hoursOn(storeHours, eachDate, dayType(eachDate, holidays)).closed)),   // お休みの日
        selectedId: state.user.id,   // 自分の行に色をつける
        onPick: (pickedDate) => { date = pickedDate; view = "day"; saveView("day"); draw(); window.scrollTo(0, 0); },   // マスを押したらその日へ
      }),
      weekLegend(),   // 色と記号の説明（2026年11月17日）
      createElement("div", { class: "home-muted wk__help" }, "マスを押すと、その日を時間の線で見られます。色の行が自分です"),   // 使い方
    );
  }

  /**
   * 1日のカード：紙のシフト表の「1日の枠」と同じ形（色つき）
   * 氏名・時刻・トータル時間。勤務は線（< >）、休憩は ○。自分の行はうすい黄色
   */
  function paperDayCard() {   // 1日のカードを作る関数
    const shown = members.filter((member) => member.active && ((member.rankHere ?? 1) === 1 || assignments.some((shift) => shift.memberId === member.id)));   // この店の人と、この週に入っている応援の人
    const { rows, split } = paperRows(shown);   // 社員が上
    return createElement("section", { class: "card card--tight paper-day" },   // カード
      paperDay({ date, rows, split, work: assignments, color: true, selectedId: state.user.id, width: 64, rowH: 4.6, font: 2.5 }),   // 1日の枠
      createElement("div", { class: "wk-legend" },   // 色の説明
        createElement("span", { class: "wk-legend__item" }, createElement("span", { class: "paper-key paper-key--hall" }), "ホール"),   // 青
        createElement("span", { class: "wk-legend__item" }, createElement("span", { class: "paper-key paper-key--kitchen" }), "キッチン"),   // オレンジ
        createElement("span", { class: "wk-legend__item" }, "○ 休憩"),   // 休憩
        createElement("span", { class: "wk-legend__item" }, createElement("span", { class: "paper-key paper-key--mine" }), "自分")),   // 自分の行
    );
  }

  /** 日のタブ */
  function dayTabs() {   // 日のタブを作る関数
    return createElement("div", { class: "day-tabs" },   // タブの入れ物
      datesOf(period).map((eachDate) => createElement("button", { class: "chip", "aria-pressed": String(eachDate === date), onclick: () => { date = eachDate; draw(); } }, label(eachDate))));   // 7日分のボタン
  }

  /** 週を変えた時 */
  async function changeWeek(event) {   // 週を変えた時
    await loadWeek(published.find((period) => period.id === event.target.value));   // 選んだ週を読む
    draw();   // 描く
  }
}

/** 公開シフトの見方を覚える名前 */
const VIEW_KEY = "shiftapp-published-view";   // このスマホに覚える名前

/** 前に選んだ見方を読む（はじめは1週間） */
function readView() {   // 見方を読む関数
  try { return localStorage.getItem(VIEW_KEY) === "day" ? "day" : "week"; } catch { return "week"; }   // 読めない時は1週間
}

/** 見方を覚える（覚えられなくても止めない） */
function saveView(view) {   // 見方を覚える関数
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* 覚えられなくても使える */ }   // 覚える
}
