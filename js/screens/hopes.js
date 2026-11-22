// ============================================================
// screens/hopes.js — 「希望」の画面（店長。下のメニューの「希望」）
// ------------------------------------------------------------
// このファイルは、店員が出したシフトの希望を、店長が週ごとに見る画面のファイルです（2026年11月22日）。
// 前はシフト作成の画面のいちばん上にあったものを、別のタブにした。
//
// ・上：店舗の切りかえ（3店舗）
// ・「‹ 週 ›」で週を動かす（前の週・次の週の希望も見られる）
// ・見方は2つ
//     一覧     … 1人1行・月〜日（components/hope-list.js）
//     日ごと   … 紙のシフト表と同じ「1日の枠」を7つ（components/paper-day.js）。出していない人は空欄
// ・「印刷」で、紙の形（A4横・1枚）に印刷できる（components/print-week.js の printHopes）
// ・名前の並びはシフトの表と同じ（いつも同じ順番）
// ============================================================

import { createElement, mount, toast } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, activeStores, switchStore } from "../store.js";   // アプリの状態・店舗の道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { hopeList } from "../components/hope-list.js";   // 希望の一覧（1人1行）を読む
import { paperDay, paperRows } from "../components/paper-day.js";   // 紙のシフト表と同じ1日の枠を読む
import { printHopes } from "../components/print-week.js";   // 希望を印刷する道具を読む
import { STATUS_LABEL, weekShort, datesOf, deadlineLabel, pendingPeriod } from "../lib/period.js";   // 週の道具を読む
import { today, dayType } from "../lib/date.js";   // 日付の道具を読む
import { hoursOn } from "../lib/store-hours.js";   // その日の営業時間の道具を読む

/** 見方を覚える名前（このスマホに） */
const VIEW_KEY = "shiftapp-hopes-view";   // 「一覧」か「日ごと」か

/**
 * 希望の画面を描く
 * @param {HTMLElement} app 画面を入れる場所
 */
export async function renderHopes(app) {   // 希望の画面を描く関数
  const holidays = await api.listHolidays();   // 祝日
  let periods = [];      // この店舗の週
  let members = [];      // この店舗で働ける人
  let storeHours = null; // この店舗の営業時間
  let period = null;     // 見ている週
  let hopes = [];        // その週の希望
  let view = readView(); // 見方（"list"＝一覧／"paper"＝日ごと）

  await loadStore();   // 今の店舗を読む
  draw();   // 描く

  /** 今の店舗の週・店員・営業時間を読む（はじめは、まだシフトができていない週） */
  async function loadStore() {   // 店舗の情報を読む関数
    const [allPeriods, allMembers, hours] = await Promise.all([api.listPeriods(state.storeId), api.listMembers(state.storeId), api.getStoreHours(state.storeId)]);   // 週・店員・営業時間
    periods = [...allPeriods].sort((first, second) => first.weekStart.localeCompare(second.weekStart));   // 古い順
    members = allMembers.filter((member) => member.active && !member.developer);   // 休止中・開発者はのぞく
    storeHours = hours;   // 営業時間
    await loadWeek(pendingPeriod(periods) || periods[periods.length - 1] || null);   // まだできていない週か、いちばん新しい週
  }

  /** 週の希望を読む */
  async function loadWeek(target) {   // 週を読む関数
    period = target;   // 見ている週
    hopes = target ? await api.listAvailabilities(target.id) : [];   // その週の希望
  }

  /** その日の営業時間（「いつでもOK」の線のはば） */
  function hoursOf(date) {   // 営業時間を出す関数
    return hoursOn(storeHours, date, dayType(date, holidays));   // その日の営業時間
  }

  /** 描く */
  function draw() {   // 画面を描く関数
    mount(app,   // 画面に入れる
      screenHeader({   // 見出し
        title: "希望",   // タイトル
        extra: createElement("div", { class: "store-switch" },   // 店舗の切りかえ
          activeStores().map((eachStore) => createElement("button", {   // 店舗ごと
            class: "chip store-switch__btn",   // 見た目
            "aria-pressed": String(eachStore.id === state.storeId),   // 今の店舗に印
            onclick: async () => { if (eachStore.id === state.storeId) return; await switchStore(eachStore.id); await loadStore(); draw(); toast(`${eachStore.name} に切り替えました`); },   // 切りかえて読みなおす
          }, eachStore.short))),   // 短い名前
      }),
      createElement("div", { class: "screen-body" },   // 本文
        period ? weekNav() : createElement("div", { class: "card home-muted" }, "まだ週がありません。シフト作成を開くと、受付が始まります"),   // 週がなければ案内
        period ? statusLine() : null,   // 受付の状態・出した人の数
        period ? (view === "paper" ? paperBody() : hopeList({ dates: datesOf(period), members, availabilities: hopes, stores: state.stores, storeId: state.storeId })) : null,   // 一覧か、日ごと
      ),
    );
  }

  /** ‹ 週 › と、見方の切りかえ・印刷 */
  function weekNav() {   // 週を動かすボタンを作る関数
    const index = periods.findIndex((eachPeriod) => eachPeriod.id === period.id);   // 今の週の位置
    const move = async (step) => { await loadWeek(periods[index + step]); draw(); };   // 週を動かす
    const pick = (next) => { view = next; saveView(next); draw(); };   // 見方を変える
    return createElement("div", { class: "week-nav" },   // 1行
      createElement("button", { class: "btn btn--icon", "aria-label": "前の週", disabled: index <= 0, onclick: () => move(-1) }, "‹"),   // 前の週
      createElement("strong", { class: "week-nav__label" }, weekShort(period)),   // 今の週
      createElement("button", { class: "btn btn--icon", "aria-label": "次の週", disabled: index >= periods.length - 1, onclick: () => move(1) }, "›"),   // 次の週
      createElement("div", { class: "seg published-seg", role: "group", "aria-label": "見方" },   // 見方の切りかえ
        createElement("button", { class: "seg__btn", "aria-pressed": String(view === "list"), onclick: () => pick("list") }, "一覧"),   // 1人1行
        createElement("button", { class: "seg__btn", "aria-pressed": String(view === "paper"), onclick: () => pick("paper") }, "日ごと")));   // 紙の形
  }

  /** 受付の状態・締切・印刷（出した人の数は、下の一覧の見出しに出る） */
  function statusLine() {   // 状態の行を作る関数
    return createElement("div", { class: "hope-status" },   // 1行
      createElement("span", { class: `badge ${period.status === "open" ? "badge--hall" : period.status === "closed" ? "badge--warn" : ""}` }, STATUS_LABEL[period.status]),   // 受付中・締切など（ホームと同じ色）
      createElement("span", { class: "home-muted" }, `締切 ${deadlineLabel(period)}`),   // 締切
      createElement("button", { class: "btn btn--small", onclick: () => printHopes({   // 印刷
        storeName: state.stores.find((store) => store.id === state.storeId)?.name || "",   // 店舗の名前
        dates: datesOf(period), members: members.filter((member) => (member.rankHere ?? 1) === 1), availabilities: hopes, hoursOf,   // 7日・この店の人・希望・営業時間
      }) }, "印刷"));   // ボタンの文字
  }

  /** 日ごと：紙のシフト表と同じ1日の枠を7つ（出していない人は空欄） */
  function paperBody() {   // 日ごとの見方を作る関数
    const { rows, split } = paperRows(members.filter((member) => (member.rankHere ?? 1) === 1));   // この店の人（いつも同じ順番）
    return createElement("div", { class: "paper-week" },   // 入れ物
      createElement("div", { class: "wk-legend" },   // 記号の説明
        createElement("span", { class: "wk-legend__item" }, createElement("span", { class: "paper-key paper-key--hope" }), "時間指定"),   // 緑の線
        createElement("span", { class: "wk-legend__item" }, "- - いつでもOK"),   // 点線
        createElement("span", { class: "wk-legend__item" }, "× 入れない・休み希望（赤）"),   // 赤い文字
        createElement("span", { class: "wk-legend__item" }, "空欄＝まだ出していない")),   // 空欄
      datesOf(period).map((date) => createElement("section", { class: `card card--tight paper-day${date === today() ? " is-today" : ""}` },   // 1日（今日は緑の枠）
        paperDay({ date, rows, split, work: [], hopes, color: true, width: 64, rowH: 4.2, font: 2.4, total: false, hoursOf }))),   // 1日の枠（希望）
    );
  }
}

/** 見方を読む（はじめは一覧） */
function readView() {   // 見方を読む関数
  try { return localStorage.getItem(VIEW_KEY) === "paper" ? "paper" : "list"; } catch { return "list"; }   // 読めない時は一覧
}

/** 見方を覚える */
function saveView(view) {   // 見方を覚える関数
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* 覚えられなくても動く */ }   // このスマホに覚える
}
