// ============================================================
// rules/labor-rules.js — 働き方のルール（法律・扶養など）のチェック
// ------------------------------------------------------------
// このファイルは、1週間のシフトが「働き方のルール」を守れているかを調べるファイルです（2026年11月6日）。
// シフト作成の画面（右の欄・チェック）と、AIの下書き（ai/validate.js）が使う。
//
// 調べること（どれも店長が「店員管理」で人ごとに決める。決めていない人は調べない）：
//   ① 18歳未満の人は、22:00〜翌5:00 に入れない（労働基準法の深夜業の決まり）
//   ② 続けて働く日数（連勤）は CONFIG.MAX_STREAK_DAYS 日まで（前の週から続けて数える）
//   ③ 月の上限時間（例：月80時間まで）… その月の、ほかの週・ほかの店舗の分も足して数える
//   ④ 年の上限金額（例：扶養の範囲で年103万円まで）… 1月〜12月の、時給×時間＋交通費の目安で数える
// ※③④の「上限の数字」は人によってちがい、法律や会社の決まりも変わるので、アプリでは決めない。店長が入れる。
// ※金額は lib/labor.js と同じ「目安」の計算。本当の給料とは少しちがうことがある。
// ============================================================

import { CONFIG } from "../config.js";   // 設定（連勤の上限）を読む
import { workedMinutes, laborCost, hoursText, yen } from "../lib/labor.js";   // 時間とお金の計算の道具を読む
import { addDays, label } from "../lib/date.js";   // 日付の道具を読む

/** 18歳未満が入れない時間の始まり（22:00） */
export const MINOR_NIGHT_FROM = 22 * 60;   // 22時（分）
/** 18歳未満が入れない時間の終わり（翌5:00 ＝ 朝5:00） */
export const MINOR_MORNING_TO = 5 * 60;   // 朝5時（分）

/** "2026-11-09" → "2026-11"（月） */
export const monthOf = (date) => date.slice(0, 7);   // 日付から月を出す
/** "2026-11-09" → "2026"（年） */
export const yearOf = (date) => date.slice(0, 4);   // 日付から年を出す

/**
 * その勤務が18歳未満の人にだめな時間にかかっているか
 * @param {{from:number,to:number}} a 勤務（分）
 */
export function minorNightNG(shift) {   // 18歳未満にだめな時間か調べる関数
  return shift.to > MINOR_NIGHT_FROM || shift.from < MINOR_MORNING_TO;   // 22時より後まで、か、5時より前から
}

/**
 * 18歳未満の人の勤務を、入ってよい時間（5:00〜22:00）に縮める（AIの下書きで使う）
 * @returns {{from:number,to:number}} 縮めた時間
 */
export function clipForMinor(from, to) {   // 18歳未満の勤務を縮める関数
  return { from: Math.max(from, MINOR_MORNING_TO), to: Math.min(to, MINOR_NIGHT_FROM) };   // 5時〜22時の中に入れる
}

/**
 * 働き方のルールを調べる
 * @param {object} props
 * @param {string[]} props.dates      その週の7日
 * @param {object[]} props.week       その週の勤務（この店舗の、今作っているもの）
 * @param {object[]} props.others     その週以外の勤務＋その週のほかの店舗の勤務（月・年・連勤を数えるため）
 * @param {object[]} props.members    店員
 * @param {Map<string,object>} props.limits  店員ID → {minor, monthHoursMax, yearYenMax, hourly, transport}
 * @returns {{ok:boolean, code:string, text:string}[]} 守れていないものだけ（全部守れていれば「OK」が1つ）
 */
export function checkLabor(props) {   // 働き方のルールを調べる関数
  const out = [];                                                     // 見つかった問題
  const all = [...props.week, ...props.others];                               // 数えるための勤務全部
  const nameOf = (id) => props.members.find((member) => member.id === id)?.name || "？";   // IDから名前
  const people = new Set(props.week.map((shift) => shift.memberId));             // この週に入っている人

  for (const id of people) {   // この週に入っている人ごとに
    const lim = props.limits.get(id) || {};                               // その人のルール
    const mine = all.filter((shift) => shift.memberId === id);                // その人の勤務（全部）
    const myWeek = props.week.filter((shift) => shift.memberId === id);           // その人のこの週の勤務

    // ① 18歳未満の深夜
    if (lim.minor) {   // 18歳未満の人なら
      const bad = myWeek.filter(minorNightNG);                        // だめな時間の勤務
      if (bad.length) out.push({ ok: false, code: "minor-night", text: `18歳未満は22時〜朝5時に入れない：${nameOf(id)}（${bad.map((shift) => label(shift.date)).join("、")}）` });   // だめな勤務があれば問題に足す
    }

    // ② 連勤（この週の最後の日から、さかのぼって数える。この週の中の一番長い連続も見る）
    const workDays = new Set(mine.map((shift) => shift.date));                // 入っている日
    const streak = longestStreak(workDays, addDays(props.dates[0], -CONFIG.MAX_STREAK_DAYS), props.dates[props.dates.length - 1]);   // この週の前の6日から、この週の最後の日までの一番長い連続
    if (streak > CONFIG.MAX_STREAK_DAYS) out.push({ ok: false, code: "streak", text: `${CONFIG.MAX_STREAK_DAYS + 1}日以上続けて入っている：${nameOf(id)}（${streak}連勤）` });   // 6日をこえる連勤なら問題に足す

    // ③ 月の上限時間（この週にかかる月ごと）
    if (lim.monthHoursMax) {   // 月の上限が決まっている人なら
      for (const month of new Set(props.dates.map(monthOf))) {   // この週にかかる月ごと
        const minutes = mine.filter((shift) => monthOf(shift.date) === month).reduce((sum, shift) => sum + workedMinutes(shift), 0);   // その月の働いた分
        if (minutes > lim.monthHoursMax * 60) out.push({ ok: false, code: "month-hours", text: `月の上限時間をこえる：${nameOf(id)}（${Number(month.slice(5))}月 ${hoursText(minutes)} / 上限 ${lim.monthHoursMax}時間）` });   // こえていれば問題に足す
      }
    }

    // ④ 年の上限金額（1月〜12月）
    if (lim.yearYenMax && lim.hourly) {   // 年の上限と時給が決まっている人なら
      for (const year of new Set(props.dates.map(yearOf))) {   // この週にかかる年ごと
        const yenNow = yearYen(mine, year, lim);                      // その年の目安の金額
        if (yenNow > lim.yearYenMax) out.push({ ok: false, code: "year-yen", text: `年の上限金額をこえる見込み：${nameOf(id)}（${year}年 約${yen(yenNow)} / 上限 ${yen(lim.yearYenMax)}）` });   // こえていれば問題に足す
      }
    }
  }
  if (!out.length) out.push({ ok: true, code: "labor", text: "働き方のルール（18歳未満・連勤・上限）" });   // 問題がなければ「OK」を1つ
  return out;   // 結果を返す
}

/**
 * その人の「今月・今年」の数字（右の欄に出す）
 * @returns {{monthMinutes:number, yearYen:number}}
 */
export function usageOf(memberId, date, all, lim = {}) {   // 今月の時間・今年の金額を出す関数
  const mine = all.filter((shift) => shift.memberId === memberId);           // その人の勤務
  return {   // まとめて返す
    monthMinutes: mine.filter((shift) => monthOf(shift.date) === monthOf(date)).reduce((sum, shift) => sum + workedMinutes(shift), 0),   // 今月の働いた分
    yearYen: lim.hourly ? yearYen(mine, yearOf(date), lim) : 0,   // 今年の金額（時給がなければ0）
  };
}

/** その年の目安の金額（時給×時間＋交通費） */
function yearYen(rows, year, lim) {   // その年の金額を出す関数
  return laborCost(rows.filter((row) => yearOf(row.date) === year), [{ memberId: rows[0]?.memberId, hourly: lim.hourly, transport: lim.transport || 0 }]);   // その年の勤務の人件費
}

/**
 * from〜to の間で、続けて入っている日数の一番長いもの
 * @param {Set<string>} days 入っている日
 */
export function longestStreak(days, from, to) {   // 一番長い連勤を出す関数
  let best = 0;                                                       // 一番長い連続
  let run = 0;                                                        // 今の連続
  for (let day = from; day <= to; day = addDays(day, 1)) {   // 1日ずつ
    run = days.has(day) ? run + 1 : 0;   // 入っていれば続きを足す、休みなら0から
    best = Math.max(best, run);   // 一番長いものを残す
  }
  return best;   // 一番長い連続を返す
}
