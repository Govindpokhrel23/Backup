// ============================================================
// tests/rules.test.mjs — ルールチェックの自動テスト
// ------------------------------------------------------------
// このファイルは、ルールチェックの自動テストのファイルです。
// 動かし方（ターミナルで）：
//   node --test tests/*.test.mjs
// 全部「ok」なら、ルールチェックは正しく動いている。
// ルールを直した時は、必ずこれを動かして確かめる。
// ============================================================

import { test } from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { findShortages, checkDay, checkWeek, onlyProblems } from "../js/rules/shift-rules.js";   // テストするシフトのルールの関数を読む

// ---------- テスト用の小さなデータ ----------
const hoursToMin = (hours) => hours * 60;   // 時間を分にする
const positions = [   // テスト用のマップの場所
  { id: "reji", area: "hall" },   // レジ（ホール）
  { id: "snack", area: "kitchen" },   // スナック（キッチン）
];
const requirements = [   // テスト用の必要人数
  { positionId: "reji", dayType: "weekday", from: hoursToMin(7), to: hoursToMin(22), count: 1 },   // 平日はレジに7〜22時で1人
  { positionId: "snack", dayType: "weekday", from: hoursToMin(7), to: hoursToMin(22), count: 1 },   // 平日はスナックに7〜22時で1人
];
const members = [   // テスト用の店員
  { id: "a", name: "A", kind: "shain", active: true, skills: { hall: 100, kitchen: 100, open: 100, close: 0 } },   // 社員A（立ち上げできる）
  { id: "b", name: "B", kind: "shain", active: true, skills: { hall: 100, kitchen: 100, open: 0, close: 100 } },   // 社員B（締めできる）
  { id: "c", name: "C", kind: "baito", active: true, skills: { hall: 100, kitchen: 0, open: 0, close: 0 } },   // バイトC（ホールだけ）
];
/** テスト用の勤務を1つ作る */
const work = (memberId, from, to, area, breakAt = null) => ({ memberId, from: hoursToMin(from), to: hoursToMin(to), area, breakAt: breakAt && hoursToMin(breakAt), date: "2026-11-09" });   // テスト用の勤務を作る

// ---------- 必要人数 ----------
test("全部の時間に人がいれば、不足なし", () => {   // テスト：不足なし
  const day = [work("a", 7, 22, "hall", 12), work("b", 7, 22, "kitchen", 12)];   // その日の勤務
  assert.deepEqual(findShortages(day, requirements, positions, "weekday"), []);   // 不足は0
});

test("16時〜22時にホールがいなければ、その時間が不足になる", () => {   // テスト：16時からホールがいない
  const day = [work("a", 7, 16, "hall", 11), work("b", 7, 22, "kitchen", 12)];   // その日の勤務
  const shortages = findShortages(day, requirements, positions, "weekday");   // 足りない時間
  assert.equal(shortages.length, 1);   // 不足は1つ
  assert.equal(shortages[0].area, "hall");   // ホール
  assert.equal(shortages[0].from, hoursToMin(16));   // 16時から
  assert.equal(shortages[0].to, hoursToMin(22));   // 22時まで
  assert.equal(shortages[0].short, 1);   // 1人足りない
});

// ---------- 1日のチェック ----------
const base = { date: "2026-11-09", dayType: "weekday", members, requirements, positions, availabilities: [] };   // 日のチェックのテストで使う共通の中身

test("立ち上げ・締めができる人がいれば OK", () => {   // テスト：立ち上げ・締め
  const result = checkDay({ ...base, assignments: [work("a", 6.5, 16, "hall", 11), work("b", 13, 22, "kitchen", 17)] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "open").ok, true);   // 立ち上げOK
  assert.equal(result.find((check) => check.code === "close").ok, true);   // 締めOK
});

test("立ち上げは開店30分前（6:30）から入る1人だけ", () => {   // テスト：立ち上げは6:30
  // 7:00から入っても立ち上げにならない（開店7:00の30分前＝6:30から）
  const late = checkDay({ ...base, hours: { open: hoursToMin(7), close: hoursToMin(22) }, assignments: [work("a", 7, 16, "hall", 11), work("b", 13, 22, "kitchen", 17)] });   // 7時から来る人だけ
  assert.equal(late.find((check) => check.code === "open").ok, false);   // 立ち上げNG
  const ok = checkDay({ ...base, hours: { open: hoursToMin(7), close: hoursToMin(22) }, assignments: [work("a", 6.5, 16, "hall", 11), work("c", 7, 13, "hall"), work("b", 13, 22, "kitchen", 17)] });   // チェックの結果
  const check = ok.find((check) => check.code === "open");   // 立ち上げのチェック
  assert.equal(check.ok, true);   // 6:30から来ればOK
  assert.match(check.text, /6:30/);   // 文に6:30が入っている
  assert.doesNotMatch(check.text, /C/);   // 7:00の人は立ち上げに数えない
});

test("締めができる人がいなければ NG", () => {   // テスト：締めできる人なし
  const result = checkDay({ ...base, assignments: [work("a", 7, 22, "hall", 12)] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "close").ok, false);   // 締めNG
});

test("6時間以上で休憩がなければ NG", () => {   // テスト：休憩なし
  const result = checkDay({ ...base, assignments: [work("a", 7, 16, "hall")] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "break").ok, false);   // 休憩NG
});

test("希望より短く入れるのは OK（6時間の希望で3時間）", () => {   // テスト：希望より短い
  const availabilities = [{ memberId: "c", kind: "time", from: hoursToMin(9), to: hoursToMin(15) }];   // テスト用の希望
  const result = checkDay({ ...base, availabilities, assignments: [work("c", 9, 12, "hall")] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "hope").ok, true);   // 希望OK
});

test("希望の外の時間に入れたら NG", () => {   // テスト：希望の外
  const availabilities = [{ memberId: "c", kind: "time", from: hoursToMin(9), to: hoursToMin(15) }];   // テスト用の希望
  const result = checkDay({ ...base, availabilities, assignments: [work("c", 8, 12, "hall")] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "hope").ok, false);   // 希望NG
});

test("社員は希望を出していなくても OK（全部入れる扱い）", () => {   // テスト：社員の希望なし
  const result = checkDay({ ...base, assignments: [work("a", 7, 12, "hall")] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "hope").ok, true);   // 希望OK
});

test("バイトが希望を出していないのに入っていたら NG", () => {   // テスト：バイトの希望なし
  const result = checkDay({ ...base, assignments: [work("c", 9, 12, "hall")] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "hope").ok, false);   // 希望NG
});

test("同じ人が別の店舗と時間が重なったら NG", () => {   // テスト：別の店舗と重なる
  const here = [work("a", 7, 12, "hall")];   // この店舗の勤務
  const all = [...here, { ...work("a", 11, 15, "hall"), storeId: "other" }];   // ほかの店舗も入れた勤務
  const result = checkDay({ ...base, assignments: here, allStoreAssignments: all });   // チェックの結果
  assert.ok(result.some((check) => check.code === "double" && !check.ok));   // 重なりNG
});

// ---------- 週のチェック ----------
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];   // テストの週の7日

test("7日全部入っている人がいたら、週1休みが NG", () => {   // テスト：7日全部
  const assignments = dates.map((date) => ({ memberId: "a", date: date, from: hoursToMin(7), to: hoursToMin(12) }));   // テスト用の勤務
  const result = checkWeek({ dates, assignments, members, availabilities: [] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "rest").ok, false);   // 週1休みNG
});

test("1日でも休みがあれば、週1休みは OK", () => {   // テスト：休みがある
  const assignments = dates.slice(0, 6).map((date) => ({ memberId: "a", date: date, from: hoursToMin(7), to: hoursToMin(12) }));   // テスト用の勤務
  const result = checkWeek({ dates, assignments, members, availabilities: [] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "rest").ok, true);   // 週1休みOK
});

test("特別許可を待っている休みがあれば、知らせる", () => {   // テスト：特別許可待ち
  const result = checkWeek({ dates, assignments: [], members, availabilities: [{ memberId: "a", date: "2026-11-12", kind: "offx" }] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "special").ok, false);   // 知らせが出る
});

// ---------- 社員の休みの日数 ----------
const onlyA = [members[0]];   // 社員Aだけ
/** 最初の n 日だけ入る勤務を作る */
const workDays = (count) => dates.slice(0, count).map((date) => ({ memberId: "a", date: date, from: hoursToMin(7), to: hoursToMin(16) }));   // はじめの〇日に入れる

test("社員が希望なしで休み1日なら OK", () => {   // テスト：社員の休み1日
  const result = checkWeek({ dates, assignments: workDays(6), members: onlyA, availabilities: [] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "shain-off").ok, true);   // OK
});

test("社員が希望なしで休み2日なら NG（希望なしは週1日）", () => {   // テスト：社員の休み2日
  const result = checkWeek({ dates, assignments: workDays(5), members: onlyA, availabilities: [] });   // チェックの結果
  assert.equal(result.find((check) => check.code === "shain-off").ok, false);   // NG
});

test("社員が休み希望を2日出していれば、休み2日は OK", () => {   // テスト：休み希望2日
  const availabilities = [{ memberId: "a", date: dates[5], kind: "off" }, { memberId: "a", date: dates[6], kind: "off" }];   // テスト用の希望
  const result = checkWeek({ dates, assignments: workDays(5), members: onlyA, availabilities });   // チェックの結果
  assert.equal(result.find((check) => check.code === "shain-off").ok, true);   // OK
});

// ---------- 休憩は朝11:00より前に入れない ----------
test("休憩が11:00より前なら NG", () => {   // テスト：休憩が早すぎる
  const result = checkDay({ ...base, assignments: [work("a", 7, 16, "hall", 10)] });   // チェックの結果
  assert.ok(result.some((check) => check.code === "break-early" && !check.ok));   // NG
});

test("休憩が11:00以降なら OK", () => {   // テスト：休憩11時以降
  const result = checkDay({ ...base, assignments: [work("a", 7, 16, "hall", 11.5)] });   // チェックの結果
  assert.ok(!result.some((check) => check.code === "break-early"));   // 問題なし
});
