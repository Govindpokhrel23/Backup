// ============================================================
// tests/shift-time.test.mjs — 勤務の時刻は1時間ごと（2026年11月17日）
// ------------------------------------------------------------
// このファイルは、勤務の時刻が「ちょうどの時刻」になり、
// 立ち上げの人だけ開店30分前（6:30）から入れるかを確かめるテストのファイルです。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { startTime, endTime, hourlyRows } from "../js/lib/shift-time.js";   // テストする関数を読む
import { clampBreak } from "../js/lib/breaks.js";   // 休憩の道具を読む

const hours = { open: 7 * 60, close: 22 * 60 };   // 7:00〜22:00 のお店
const at = (text) => { const [h, m] = text.split(":").map(Number); return h * 60 + m; };   // 「9:30」→ 分

test("始まり：分があれば後ろのちょうどの時刻に。立ち上げ（6:30）だけそのまま", () => {   // テスト：始まり
  assert.equal(startTime(at("9:30"), hours), at("10:00"));   // 9:30 → 10:00
  assert.equal(startTime(at("9:00"), hours), at("9:00"));   // 9:00 はそのまま
  assert.equal(startTime(at("6:30"), hours), at("6:30"));   // 立ち上げはそのまま
  assert.equal(startTime(at("6:15"), hours), at("7:00"));   // 立ち上げでない分 → 7:00
});

test("終わり：分があれば前のちょうどの時刻に。立ち上げの人は始まりから○時間", () => {   // テスト：終わり
  assert.equal(endTime(at("15:30"), at("9:00")), at("15:00"));   // 15:30 → 15:00
  assert.equal(endTime(at("15:30"), at("6:30")), at("15:30"));   // 立ち上げ 6:30〜15:30 はそのまま（9時間）
  assert.equal(endTime(at("15:45"), at("6:30")), at("15:30"));   // 立ち上げは始まりから9時間に
});

test("一覧：立ち上げ以外に分のある勤務はなくなる。固定はそのまま・短すぎは外す", () => {   // テスト：一覧
  const rows = hourlyRows([   // そろえる前
    { memberId: "a", date: "2026-11-23", from: at("6:30"), to: at("15:30"), breakAt: at("11:00"), fixed: false },   // 立ち上げ
    { memberId: "b", date: "2026-11-23", from: at("9:30"), to: at("17:45"), breakAt: at("13:00"), fixed: false },   // 分がある
    { memberId: "c", date: "2026-11-23", from: at("10:15"), to: at("10:45"), breakAt: null, fixed: false },   // 短すぎ
    { memberId: "d", date: "2026-11-23", from: at("9:30"), to: at("12:30"), breakAt: null, fixed: true },   // 固定
  ], () => hours, clampBreak);   // そろえる
  assert.deepEqual(rows.map((row) => [row.memberId, row.from, row.to]), [["a", at("6:30"), at("15:30")], ["b", at("10:00"), at("17:00")], ["d", at("9:30"), at("12:30")]]);   // 結果
});
