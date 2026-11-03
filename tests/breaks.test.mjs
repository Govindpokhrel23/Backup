// ============================================================
// tests/breaks.test.mjs — 休憩の目安の決まりのテスト
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultBreak, clampBreak } from "../js/lib/breaks.js";

const H = (h) => h * 60;

test("7:00〜13:00 の真ん中は10:00だが、11:00より前なので11:00になる", () => {
  assert.equal(defaultBreak(H(7), H(13)), H(11));
});

test("13:00〜22:00 は真ん中（17:30）", () => {
  assert.equal(defaultBreak(H(13), H(22)), H(17.5));
});

test("7:00〜11:00 の勤務には休憩を置けない", () => {
  assert.equal(defaultBreak(H(7), H(11)), null);
});

test("ドラッグで9:00に動かしても、11:00に戻る", () => {
  assert.equal(clampBreak(H(7), H(16), H(9)), H(11));
});
