// ============================================================
// tests/labor.test.mjs — 働いた時間・人件費の目安のテスト
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { breakMinutes, workedMinutes, nightMinutes, laborCost } from "../js/lib/labor.js";

const H = (h) => h * 60;
const a = (memberId, from, to, date = "2026-11-09") => ({ memberId, date, from: H(from), to: H(to) });

test("6時間ちょうどは休憩なし、6時間をこえたら45分、8時間をこえたら60分", () => {
  assert.equal(breakMinutes(H(9), H(15)), 0);
  assert.equal(breakMinutes(H(9), H(16)), 45);
  assert.equal(breakMinutes(H(7), H(16)), 60);
});

test("7:00〜16:00 は働いた時間8時間（9時間−休憩60分）", () => {
  assert.equal(workedMinutes(a("x", 7, 16)), H(8));
});

test("16:00〜23:00 の深夜は1時間", () => {
  assert.equal(nightMinutes(a("x", 16, 23)), 60);
});

test("時給1000円・交通費300円で 9:00〜15:00 → 6000＋300＝6300円", () => {
  assert.equal(laborCost([a("x", 9, 15)], [{ memberId: "x", hourly: 1000, transport: 300 }]), 6300);
});

test("深夜は1.25倍：21:00〜23:00 → 1000＋1250＝2250円（交通費0）", () => {
  assert.equal(laborCost([a("x", 21, 23)], [{ memberId: "x", hourly: 1000, transport: 0 }]), 2250);
});

test("同じ日に2回入っても交通費は1日分", () => {
  const list = [a("x", 9, 12), a("x", 17, 20)];
  assert.equal(laborCost(list, [{ memberId: "x", hourly: 1000, transport: 300 }]), 6300);
});

test("社員（時給0）は入れない", () => {
  assert.equal(laborCost([a("s", 7, 16)], [{ memberId: "s", hourly: 0, transport: 0 }]), 0);
});
