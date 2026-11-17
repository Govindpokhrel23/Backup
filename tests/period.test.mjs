// ============================================================
// tests/period.test.mjs — 週を選ぶ道具のテスト（2026年11月17日）
// ------------------------------------------------------------
// このファイルは、ホームに出す「まだシフトができていない週」が、
// 過ぎた週ではなく、これからの週になるかを確かめるテストのファイルです。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { pendingPeriod, openPeriod, isPast } from "../js/lib/period.js";   // テストする関数を読む
import { today, addDays, mondayOf } from "../js/lib/date.js";   // 日付の道具を読む

const thisMonday = mondayOf(today());   // 今週の月曜
const week = (offset, status) => ({ id: `w${offset}`, weekStart: addDays(thisMonday, offset * 7), status });   // テスト用の週を作る

test("過ぎた週（公開していない）はホームに出さず、これからの週を出す", () => {   // テスト：過ぎた週を出さない
  const periods = [week(2, "open"), week(-3, "open"), week(1, "closed"), week(0, "published")];   // 3週前の受付中が残っている
  assert.equal(isPast(week(-3, "open")), true);   // 3週前は終わった週
  assert.equal(pendingPeriod(periods).id, "w1");   // 来週（締め切り・まだ公開していない）
  assert.equal(openPeriod(periods).id, "w2");   // 受付中は再来週（3週前のものは出さない）
});

test("今週がまだ公開されていなければ、今週を出す", () => {   // テスト：今週
  assert.equal(pendingPeriod([week(1, "open"), week(0, "draft")]).id, "w0");   // 今週が先
});

test("これからの週が全部公開済みなら、何も出さない", () => {   // テスト：全部できている
  assert.equal(pendingPeriod([week(-1, "open"), week(0, "published"), week(1, "published")]), null);   // なし
});
