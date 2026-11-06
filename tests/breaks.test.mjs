// ============================================================
// tests/breaks.test.mjs — 休憩の目安の決まりのテスト
// このファイルは、休憩の目安の決まりのテストのファイルです。
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultBreak, clampBreak } from "../js/lib/breaks.js";

/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;

test("7:00〜13:00 の真ん中は10:00だが、11:00より前なので11:00になる", () => {
  assert.equal(defaultBreak(hoursToMin(7), hoursToMin(13)), hoursToMin(11));
});

test("13:00〜22:00 は真ん中（17:30）", () => {
  assert.equal(defaultBreak(hoursToMin(13), hoursToMin(22)), hoursToMin(17.5));
});

test("7:00〜11:00 の勤務には休憩を置けない", () => {
  assert.equal(defaultBreak(hoursToMin(7), hoursToMin(11)), null);
});

test("ドラッグで9:00に動かしても、11:00に戻る", () => {
  assert.equal(clampBreak(hoursToMin(7), hoursToMin(16), hoursToMin(9)), hoursToMin(11));
});
