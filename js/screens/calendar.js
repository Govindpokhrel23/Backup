// ============================================================
// screens/calendar.js — 個人カレンダー（自分だけのカレンダー）
// ------------------------------------------------------------
// このファイルは、個人カレンダー（自分だけのカレンダー）のファイルです。
// ・入っている日に「9:00」のように始まりの時刻を出す
// ・日を押すと「コメダ 9:00〜15:00」と、店舗・場所・休憩の目安
// ・応援（いつもと違う店舗）の日は色を変えて店名つき
// ・公開前の週は出さない（公開されてから見える）
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state } from "../store.js";   // アプリの状態を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { myShifts } from "../components/my-shifts.js";   // 自分のシフトの部品を読む
import { workedMinutes, hoursText } from "../lib/labor.js";   // 時間の計算の道具を読む
import { isManager } from "../store.js";   // 店長か調べる道具を読む
import { toIso, today, label } from "../lib/date.js";   // 日付の道具を読む
import { fmt, range } from "../lib/time.js";   // 時間の表示の道具を読む

/** 個人カレンダーの画面を描く */
export async function renderCalendar(app) {   // カレンダーの画面を描く関数
  const [mine, stores] = await Promise.all([api.listMyAssignments(), api.listStores()]);   // 自分の勤務 と 店舗の一覧
  /** 店舗のIDから店舗 */
  const storeOf = (id) => stores.find((store) => store.id === id);   // 店舗IDから店舗

  // 今の月から始める
  const now = new Date();   // 今の日時
  let year = now.getFullYear();   // 見ている年
  let month = now.getMonth();          // 0=1月
  let selected = today();   // 選んだ日

  draw();   // 描く

  /**
   * この月の働いた時間の合計（休憩を引いた目安。2026年11月6日）
   * 扶養の範囲で働く人が、自分で時間を見られるように
   */
  function monthTotal() {   // 月の合計を作る関数
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;               // 見ている月（例 2026-11）
    const list = mine.filter((shift) => shift.date.startsWith(key));                   // その月の勤務
    const days = new Set(list.map((shift) => shift.date)).size;                         // 入る日数
    const minutes = list.reduce((sum, shift) => sum + workedMinutes(shift), 0);             // 働く時間（分）
    return createElement("div", { class: "month-total" },   // 合計の行
      createElement("span", { class: "home-muted" }, `${month + 1}月の合計（${days}日・休憩を引いた目安）`),   // 日数の説明
      createElement("strong", { class: "num" }, hoursText(minutes)));   // 時間
  }

  /** 画面を描く */
  function draw() {   // 画面を描く関数
    const byDate = new Map();   // 日付 → その日の自分の勤務
    for (const shift of mine) {   // 勤務を1つずつ
      if (!byDate.has(shift.date)) byDate.set(shift.date, []);   // その日の入れ物がなければ作る
      byDate.get(shift.date).push(shift);   // 日ごとに入れる
    }

    mount(app,   // 画面に入れる
      screenHeader({ title: isManager() ? "自分の勤務" : "マイカレンダー", sub: state.user.name }),   // 見出し
      createElement("div", { class: "screen-body" },   // 本文
        createElement("section", { class: "card" },   // カレンダーのカード
          createElement("div", { class: "cal__nav" },   // 月を変える行
            createElement("button", { class: "btn btn--small", "aria-label": "前の月", onclick: () => moveMonth(-1) }, "‹"),   // 前の月
            createElement("strong", null, `${year}年 ${month + 1}月`),   // 今の月
            createElement("button", { class: "btn btn--small", "aria-label": "次の月", onclick: () => moveMonth(1) }, "›"),   // 次の月
          ),
          monthGrid(byDate),   // 月のマス
          monthTotal(),   // 月の合計
          createElement("div", { class: "cal__legend" },   // 色の説明
            createElement("span", null, createElement("i", { class: "cal__dot" }), "いつものお店"),   // いつものお店
            createElement("span", null, createElement("i", { class: "cal__dot cal__dot--help" }), "応援"),   // 応援
          ),
        ),
        dayDetail(byDate.get(selected) || []),   // 選んだ日のくわしい中身
        // これからの勤務（どの店舗に何時から何時まで）
        myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, limit: 14 }),   // 自分のシフトの一覧
      ),
    );
  }

  /** 月のマス目（月曜はじまり） */
  function monthGrid(byDate) {   // 月のマスを作る関数
    const first = new Date(year, month, 1, 12);   // その月の1日
    const blanks = (first.getDay() + 6) % 7;           // 月曜=0 にそろえる
    const daysInMonth = new Date(year, month + 1, 0).getDate();   // その月の日数
    const cells = [];   // カレンダーのマス
    for (let index = 0; index < blanks; index++) cells.push(createElement("div"));   // 1日の前の空いたマス
    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {   // 1日から最後の日まで
      const iso = toIso(new Date(year, month, dayNumber, 12));   // そのマスの日付
      const work = byDate.get(iso) || [];   // その日の勤務
      const wd = (blanks + dayNumber - 1) % 7;                 // 0=月 … 6=日
      cells.push(createElement("button", {   // 日のマス
        class: `cal__cell ${iso === selected ? "is-selected" : ""} ${iso === today() ? "is-today" : ""}`,   // 選んだ日・今日なら色を変える
        "aria-label": `${month + 1}月${dayNumber}日${work.length ? ` 勤務 ${work.map((shift) => range(shift.from, shift.to)).join("、")}` : ""}`,   // 読み上げ用の説明
        onclick: () => { selected = iso; draw(); },   // 押したらその日を選ぶ
      },
        createElement("span", { class: `cal__num ${wd === 6 ? "is-sun" : wd === 5 ? "is-sat" : ""}` }, dayNumber),   // 日の数字（土日は色を変える）
        // 入っている日は「7〜17」のように始まりと終わりを出す
        work.map((shift) => createElement("span", { class: `cal__chip num ${shift.storeId !== state.user.storeId ? "is-help" : ""}` }, shortRange(shift.from, shift.to))),   // 勤務の時間
      ));
    }
    return createElement("div", { class: "cal" },   // カレンダーの入れ物
      ["月", "火", "水", "木", "金", "土", "日"].map((weekdayName, index) => createElement("div", { class: `cal__wd ${index === 6 ? "is-sun" : index === 5 ? "is-sat" : ""}` }, weekdayName)),   // 曜日の見出し
      cells,   // マス
    );
  }

  /** 選んだ日のくわしい内容 */
  function dayDetail(work) {   // 選んだ日のくわしい中身を作る関数
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, label(selected)),   // 日付
      work.length   // 勤務があれば
        ? work.map((shift) => {   // 勤務ごとに
            const store = storeOf(shift.storeId);   // 勤務の店舗
            const help = shift.storeId !== state.user.storeId;   // ほかの店舗への応援か
            return createElement("div", { class: "cal-detail" },   // 1件
              createElement("div", { class: "cal-detail__time num" }, `コメダ ${range(shift.from, shift.to)}`),   // 時間
              createElement("div", null, `${store?.name || ""} ・ ${shift.area === "hall" ? "ホール" : "キッチン"}`),   // 店舗と場所
              createElement("div", null, `休憩の目安：${shift.breakAt != null ? fmt(shift.breakAt) : "なし"}`),   // 休憩
              help ? createElement("span", { class: "badge badge--warn" }, "応援（いつもと違うお店です）") : null,   // 応援なら印
            );
          })
        : createElement("div", { class: "home-muted" }, "この日の勤務はありません（公開前の週はまだ出ません）"),   // ない時の文
    );
  }

  /** "7〜17" の短い形（ちょうどの時刻は分を省く。例 7:30〜17 ） */
  function shortRange(from, to) {   // 短い時間の文を作る関数
    /** マスに出す短い時刻（9:00 → 9、9:30 → 9:30） */
    const shortTime = (minutes) => (minutes % 60 === 0 ? String(minutes / 60 > 24 ? `翌${minutes / 60 - 24}` : minutes / 60) : fmt(minutes));   // ちょうどの時間なら「9」
    return `${shortTime(from)}〜${shortTime(to)}`;   // 「9〜15」
  }

  /** 前の月・次の月へ */
  function moveMonth(step) {   // 月を変える関数
    month += step;   // 月を動かす
    if (month < 0) { month = 11; year--; }   // 1月より前なら去年の12月
    if (month > 11) { month = 0; year++; }   // 12月より後なら来年の1月
    draw();   // 描く
  }
}
