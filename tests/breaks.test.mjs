// ============================================================
// tests/breaks.test.mjs — 休憩の目安の決まりのテスト
// このファイルは、休憩の目安の決まりのテストのファイルです。
// ============================================================

import { test } from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えが合っているか確かめる道具
import { defaultBreak, clampBreak } from "../js/lib/breaks.js";   // テストする休憩の関数を読む

/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする（7 → 420分）

test("7:00〜13:00 の真ん中は10:00だが、11:00より前なので11:00になる", () => {   // テスト1
  assert.equal(defaultBreak(hoursToMin(7), hoursToMin(13)), hoursToMin(11));   // 休憩は11:00になるはず
});

test("13:00〜22:00 は真ん中（17:30）", () => {   // テスト2
  assert.equal(defaultBreak(hoursToMin(13), hoursToMin(22)), hoursToMin(17.5));   // 休憩は17:30になるはず
});

test("7:00〜11:00 の勤務には休憩を置けない", () => {   // テスト3
  assert.equal(defaultBreak(hoursToMin(7), hoursToMin(11)), null);   // 短すぎるので休憩なし（null）
});

test("ドラッグで9:00に動かしても、11:00に戻る", () => {   // テスト4
  assert.equal(clampBreak(hoursToMin(7), hoursToMin(16), hoursToMin(9)), hoursToMin(11));   // 早すぎる休憩は11:00にもどるはず
});
