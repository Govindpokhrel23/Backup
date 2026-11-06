// ============================================================
// tests/labor-rules.test.mjs — 働き方のルール（rules/labor-rules.js）のテスト
// ------------------------------------------------------------
// このファイルは、18歳未満の深夜・連勤・月の上限時間・年の上限金額のチェックが
// 正しく動くかを確かめるテストのファイルです（2026年11月6日）。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { checkLabor, longestStreak, clipForMinor, usageOf } from "../js/rules/labor-rules.js";   // テストする働き方のルールの関数を読む
import { weekDates, addDays } from "../js/lib/date.js";   // 日付の道具

/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする
/** テスト用の週（2026-11-09 月曜〜） */
const dates = weekDates("2026-11-09");   // テストの週の7日
/** テスト用の店員 */
const members = [{ id: "a", name: "スタッフA", active: true }];   // テスト用の店員
/** テスト用の勤務を1つ作る */
const work = (date, from, to) => ({ memberId: "a", date, from: hoursToMin(from), to: hoursToMin(to) });   // テスト用の勤務を作る
/** 結果のコードの一覧 */
const codes = (results) => results.filter((result) => !result.ok).map((check) => check.code);   // だめだったものの名前だけ出す

test("18歳未満：22時をこえる勤務はだめ。21:30までならOK", () => {   // テスト：18歳未満
  const limits = new Map([["a", { minor: true }]]);   // A は18歳未満
  assert.deepEqual(codes(checkLabor({ dates, week: [work(dates[0], 17, 22.5)], others: [], members, limits })), ["minor-night"]);   // 22:30まで → だめ
  assert.deepEqual(codes(checkLabor({ dates, week: [work(dates[0], 17, 21.5)], others: [], members, limits })), []);   // 21:30まで → OK
  assert.deepEqual(clipForMinor(hoursToMin(17), hoursToMin(23)), { from: hoursToMin(17), to: hoursToMin(22) });   // 23時までの勤務は22時までに縮む
});

test("連勤：前の週から続けて7日入るとだめ（6日までOK）", () => {   // テスト：連勤
  const before = [1, 2, 3].map((daysBack) => work(addDays(dates[0], -daysBack), 9, 13));   // 前の週の金・土・日
  const four = dates.slice(0, 4).map((date) => work(date, 9, 13));                   // この週の月〜木 → 7連勤
  const three = dates.slice(0, 3).map((date) => work(date, 9, 13));                  // この週の月〜水 → 6連勤
  const limits = new Map();   // ルールなし（連勤だけ見る）
  assert.deepEqual(codes(checkLabor({ dates, week: four, others: before, members, limits })), ["streak"]);   // 7連勤 → だめ
  assert.deepEqual(codes(checkLabor({ dates, week: three, others: before, members, limits })), []);   // 6連勤 → OK
  assert.equal(longestStreak(new Set(["2026-11-01", "2026-11-02", "2026-11-04"]), "2026-11-01", "2026-11-05"), 2);   // 一番長い連続は2日
});

test("月の上限時間：ほかの週の分も足して数える", () => {   // テスト：月の上限時間
  const limits = new Map([["a", { monthHoursMax: 20 }]]);   // A は月20時間まで
  const earlier = [work("2026-11-02", 9, 15), work("2026-11-03", 9, 15)];     // 前の週に 5時間15分×2（休憩45分を引く）
  const week = [work(dates[0], 9, 15), work(dates[1], 9, 15)];                // この週も同じ → 合計21時間
  assert.deepEqual(codes(checkLabor({ dates, week, others: earlier, members, limits })), ["month-hours"]);   // こえる → だめ
  assert.deepEqual(codes(checkLabor({ dates, week: week.slice(0, 1), others: earlier, members, limits })), []);   // こえない → OK
});

test("年の上限金額：時給×時間＋交通費の目安でこえたらだめ", () => {   // テスト：年の上限金額
  const limits = new Map([["a", { hourly: 1000, transport: 0, yearYenMax: 10000 }]]);   // A は時給1000円・年1万円まで
  const week = [work(dates[0], 9, 14), work(dates[1], 9, 14), work(dates[2], 9, 11)];   // 5+5+2＝12時間 → 12,000円
  assert.deepEqual(codes(checkLabor({ dates, week, others: [], members, limits })), ["year-yen"]);   // こえる → だめ
  assert.equal(usageOf("a", dates[0], week, limits.get("a")).yearYen, 12000);   // 今年の金額は12000円
});
