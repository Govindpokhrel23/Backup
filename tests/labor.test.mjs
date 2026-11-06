// ============================================================
// tests/labor.test.mjs — 働いた時間・人件費の目安のテスト
// このファイルは、働いた時間・人件費の目安のテストのファイルです。
// ============================================================

import { test } from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { breakMinutes, workedMinutes, nightMinutes, laborCost } from "../js/lib/labor.js";   // テストする計算の関数を読む

/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする
/** テスト用の勤務を1つ作る */
const shift = (memberId, from, to, date = "2026-11-09") => ({ memberId, date, from: hoursToMin(from), to: hoursToMin(to) });   // テスト用の勤務を作る

test("6時間ちょうどは休憩なし、6時間をこえたら45分、8時間をこえたら60分", () => {   // テスト：休憩の長さ
  assert.equal(breakMinutes(hoursToMin(9), hoursToMin(15)), 0);   // 6時間 → 休憩0分
  assert.equal(breakMinutes(hoursToMin(9), hoursToMin(16)), 45);   // 7時間 → 休憩45分
  assert.equal(breakMinutes(hoursToMin(7), hoursToMin(16)), 60);   // 9時間 → 休憩60分
});

test("7:00〜16:00 は働いた時間8時間（9時間−休憩60分）", () => {   // テスト：働いた時間
  assert.equal(workedMinutes(shift("x", 7, 16)), hoursToMin(8));   // 8時間になるはず
});

test("16:00〜23:00 の深夜は1時間", () => {   // テスト：深夜の時間
  assert.equal(nightMinutes(shift("x", 16, 23)), 60);   // 22時〜23時の60分
});

test("時給1000円・交通費300円で 9:00〜15:00 → 6000＋300＝6300円", () => {   // テスト：人件費
  assert.equal(laborCost([shift("x", 9, 15)], [{ memberId: "x", hourly: 1000, transport: 300 }]), 6300);   // 6300円になるはず
});

test("深夜は1.25倍：21:00〜23:00 → 1000＋1250＝2250円（交通費0）", () => {   // テスト：深夜は1.25倍
  assert.equal(laborCost([shift("x", 21, 23)], [{ memberId: "x", hourly: 1000, transport: 0 }]), 2250);   // 2250円になるはず
});

test("同じ日に2回入っても交通費は1日分", () => {   // テスト：交通費は1日1回
  const list = [shift("x", 9, 12), shift("x", 17, 20)];   // 1日に2つの勤務
  assert.equal(laborCost(list, [{ memberId: "x", hourly: 1000, transport: 300 }]), 6300);   // 6300円（交通費は300円だけ）
});

test("社員（時給0）は入れない", () => {   // テスト：社員
  assert.equal(laborCost([shift("s", 7, 16)], [{ memberId: "s", hourly: 0, transport: 0 }]), 0);   // 時給0なので0円
});
