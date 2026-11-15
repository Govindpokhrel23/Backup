// ============================================================
// tests/store-hours.test.mjs — 営業時間と「休み・時間の変更」のテスト（2026年11月15日）
// ------------------------------------------------------------
// このファイルは、lib/store-hours.js（その日の営業時間を決める道具）を確かめるテストのファイルです。
// 動かし方：node --test tests/*.test.mjs
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { hoursOn, specialOn, specialText, checkStoreHours } from "../js/lib/store-hours.js";   // 確かめる道具
import { findShortages } from "../js/rules/shift-rules.js";   // 足りない時間を出す道具（お休みの日は 0 になるか）

/** テストで使う営業時間（いつもは 7:00〜22:00） */
const base = {   // 営業時間
  weekday: { open: 420, close: 1320 },   // 平日
  sat: { open: 480, close: 1320 },   // 土曜
  sun: { open: 480, close: 1260 },   // 日祝
  special: [   // 休み・時間の変更
    { id: "a", from: "2026-12-31", to: "2027-01-02", closed: true, note: "年末年始" },   // 3日間お休み
    { id: "b", from: "2026-12-24", to: "2026-12-24", closed: false, open: 540, close: 1080, note: "" },   // 1日だけ時間を変える
    { id: "c", from: "2027-01-02", to: "2027-01-02", closed: false, open: 600, close: 960, note: "初売り" },   // あとから足した方を使う
  ],
};

test("変更がない日は、いつもの営業時間", () => {   // テスト1
  assert.deepEqual(hoursOn(base, "2026-12-01", "weekday"), { open: 420, close: 1320, closed: false, note: "", changed: false });   // 平日の時間
  assert.equal(hoursOn(base, "2026-12-05", "sat").open, 480);   // 土曜の時間
});

test("お休みの日は closed、開店と閉店が同じ（営業する時間なし）", () => {   // テスト2
  const day = hoursOn(base, "2026-12-31", "weekday");   // お休みの日
  assert.equal(day.closed, true);   // お休み
  assert.equal(day.open, day.close);   // 営業する時間なし
  assert.equal(day.note, "年末年始");   // メモ
});

test("時間を変えた日は、その時間", () => {   // テスト3
  assert.deepEqual(hoursOn(base, "2026-12-24", "weekday"), { open: 540, close: 1080, closed: false, note: "", changed: true });   // 9:00〜18:00
});

test("同じ日に2つあれば、あとから足した方", () => {   // テスト4
  assert.equal(specialOn(base, "2027-01-02").id, "c");   // あとの方
  assert.equal(hoursOn(base, "2027-01-02", "sat").open, 600);   // 10:00 から
});

test("文にする", () => {   // テスト5
  assert.equal(specialText(base.special[0]), "12/31〜1/2 休み（年末年始）");   // 期間・休み・メモ
  assert.equal(specialText(base.special[1]), "12/24 9:00〜18:00");   // 1日だけ・時間
});

test("保存の前のチェック", () => {   // テスト6
  assert.equal(checkStoreHours(base), null);   // 正しい
  assert.match(checkStoreHours({ ...base, special: [{ from: "2026-12-05", to: "2026-12-01", closed: true }] }), /終わり/);   // 終わりが前
  assert.match(checkStoreHours({ ...base, special: [{ from: "2026-12-05", to: "2026-12-05", closed: false, open: 900, close: 600 }] }), /閉店/);   // 時間がおかしい
  assert.match(checkStoreHours({ ...base, sat: { open: 600, close: 600 } }), /土曜/);   // いつもの時間がおかしい
});

test("お休みの日は、人が足りない時間が出ない", () => {   // テスト7
  const positions = [{ id: "p1", area: "hall" }];   // ホールの場所
  const requirements = [{ positionId: "p1", dayType: "weekday", from: 420, to: 1320, count: 2 }];   // 一日中2人
  assert.ok(findShortages([], requirements, positions, "weekday", hoursOn(base, "2026-12-01", "weekday")).length > 0);   // ふつうの日は足りない
  assert.equal(findShortages([], requirements, positions, "weekday", hoursOn(base, "2026-12-31", "weekday")).length, 0);   // お休みの日は 0
});
