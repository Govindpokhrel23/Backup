// ============================================================
// tests/rules.test.mjs — ルールチェックの自動テスト
// ------------------------------------------------------------
// 動かし方（ターミナルで）：
//   node --test tests/*.test.mjs
// 全部「ok」なら、ルールチェックは正しく動いている。
// ルールを直した時は、必ずこれを動かして確かめる。
// ============================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { findShortages, checkDay, checkWeek, onlyProblems } from "../js/rules/shift-rules.js";

// ---------- テスト用の小さなデータ ----------
const H = (h) => h * 60;
const positions = [
  { id: "reji", area: "hall" },
  { id: "snack", area: "kitchen" },
];
const requirements = [
  { positionId: "reji", dayType: "weekday", from: H(7), to: H(22), count: 1 },
  { positionId: "snack", dayType: "weekday", from: H(7), to: H(22), count: 1 },
];
const members = [
  { id: "a", name: "A", kind: "shain", active: true, skills: { hall: 100, kitchen: 100, open: 100, close: 0 } },
  { id: "b", name: "B", kind: "shain", active: true, skills: { hall: 100, kitchen: 100, open: 0, close: 100 } },
  { id: "c", name: "C", kind: "baito", active: true, skills: { hall: 100, kitchen: 0, open: 0, close: 0 } },
];
const work = (memberId, from, to, area, breakAt = null) => ({ memberId, from: H(from), to: H(to), area, breakAt: breakAt && H(breakAt), date: "2026-11-09" });

// ---------- 必要人数 ----------
test("全部の時間に人がいれば、不足なし", () => {
  const day = [work("a", 7, 22, "hall", 12), work("b", 7, 22, "kitchen", 12)];
  assert.deepEqual(findShortages(day, requirements, positions, "weekday"), []);
});

test("16時〜22時にホールがいなければ、その時間が不足になる", () => {
  const day = [work("a", 7, 16, "hall", 11), work("b", 7, 22, "kitchen", 12)];
  const s = findShortages(day, requirements, positions, "weekday");
  assert.equal(s.length, 1);
  assert.equal(s[0].area, "hall");
  assert.equal(s[0].from, H(16));
  assert.equal(s[0].to, H(22));
  assert.equal(s[0].short, 1);
});

// ---------- 1日のチェック ----------
const base = { date: "2026-11-09", dayType: "weekday", members, requirements, positions, availabilities: [] };

test("立ち上げ・締めができる人がいれば OK", () => {
  const r = checkDay({ ...base, assignments: [work("a", 6.5, 16, "hall", 11), work("b", 13, 22, "kitchen", 17)] });
  assert.equal(r.find((x) => x.code === "open").ok, true);
  assert.equal(r.find((x) => x.code === "close").ok, true);
});

test("立ち上げは開店30分前（6:30）から入る1人だけ", () => {
  // 7:00から入っても立ち上げにならない（開店7:00の30分前＝6:30から）
  const late = checkDay({ ...base, hours: { open: H(7), close: H(22) }, assignments: [work("a", 7, 16, "hall", 11), work("b", 13, 22, "kitchen", 17)] });
  assert.equal(late.find((x) => x.code === "open").ok, false);
  const ok = checkDay({ ...base, hours: { open: H(7), close: H(22) }, assignments: [work("a", 6.5, 16, "hall", 11), work("c", 7, 13, "hall"), work("b", 13, 22, "kitchen", 17)] });
  const r = ok.find((x) => x.code === "open");
  assert.equal(r.ok, true);
  assert.match(r.text, /6:30/);
  assert.doesNotMatch(r.text, /C/);   // 7:00の人は立ち上げに数えない
});

test("締めができる人がいなければ NG", () => {
  const r = checkDay({ ...base, assignments: [work("a", 7, 22, "hall", 12)] });
  assert.equal(r.find((x) => x.code === "close").ok, false);
});

test("6時間以上で休憩がなければ NG", () => {
  const r = checkDay({ ...base, assignments: [work("a", 7, 16, "hall")] });
  assert.equal(r.find((x) => x.code === "break").ok, false);
});

test("希望より短く入れるのは OK（6時間の希望で3時間）", () => {
  const availabilities = [{ memberId: "c", kind: "time", from: H(9), to: H(15) }];
  const r = checkDay({ ...base, availabilities, assignments: [work("c", 9, 12, "hall")] });
  assert.equal(r.find((x) => x.code === "hope").ok, true);
});

test("希望の外の時間に入れたら NG", () => {
  const availabilities = [{ memberId: "c", kind: "time", from: H(9), to: H(15) }];
  const r = checkDay({ ...base, availabilities, assignments: [work("c", 8, 12, "hall")] });
  assert.equal(r.find((x) => x.code === "hope").ok, false);
});

test("社員は希望を出していなくても OK（全部入れる扱い）", () => {
  const r = checkDay({ ...base, assignments: [work("a", 7, 12, "hall")] });
  assert.equal(r.find((x) => x.code === "hope").ok, true);
});

test("バイトが希望を出していないのに入っていたら NG", () => {
  const r = checkDay({ ...base, assignments: [work("c", 9, 12, "hall")] });
  assert.equal(r.find((x) => x.code === "hope").ok, false);
});

test("同じ人が別の店舗と時間が重なったら NG", () => {
  const here = [work("a", 7, 12, "hall")];
  const all = [...here, { ...work("a", 11, 15, "hall"), storeId: "other" }];
  const r = checkDay({ ...base, assignments: here, allStoreAssignments: all });
  assert.ok(r.some((x) => x.code === "double" && !x.ok));
});

// ---------- 週のチェック ----------
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

test("7日全部入っている人がいたら、週1休みが NG", () => {
  const assignments = dates.map((d) => ({ memberId: "a", date: d, from: H(7), to: H(12) }));
  const r = checkWeek({ dates, assignments, members, availabilities: [] });
  assert.equal(r.find((x) => x.code === "rest").ok, false);
});

test("1日でも休みがあれば、週1休みは OK", () => {
  const assignments = dates.slice(0, 6).map((d) => ({ memberId: "a", date: d, from: H(7), to: H(12) }));
  const r = checkWeek({ dates, assignments, members, availabilities: [] });
  assert.equal(r.find((x) => x.code === "rest").ok, true);
});

test("特別許可を待っている休みがあれば、知らせる", () => {
  const r = checkWeek({ dates, assignments: [], members, availabilities: [{ memberId: "a", date: "2026-11-12", kind: "offx" }] });
  assert.equal(r.find((x) => x.code === "special").ok, false);
});

// ---------- 社員の休みの日数 ----------
const onlyA = [members[0]];
const workDays = (n) => dates.slice(0, n).map((d) => ({ memberId: "a", date: d, from: H(7), to: H(16) }));

test("社員が希望なしで休み1日なら OK", () => {
  const r = checkWeek({ dates, assignments: workDays(6), members: onlyA, availabilities: [] });
  assert.equal(r.find((x) => x.code === "shain-off").ok, true);
});

test("社員が希望なしで休み2日なら NG（希望なしは週1日）", () => {
  const r = checkWeek({ dates, assignments: workDays(5), members: onlyA, availabilities: [] });
  assert.equal(r.find((x) => x.code === "shain-off").ok, false);
});

test("社員が休み希望を2日出していれば、休み2日は OK", () => {
  const availabilities = [{ memberId: "a", date: dates[5], kind: "off" }, { memberId: "a", date: dates[6], kind: "off" }];
  const r = checkWeek({ dates, assignments: workDays(5), members: onlyA, availabilities });
  assert.equal(r.find((x) => x.code === "shain-off").ok, true);
});

// ---------- 休憩は朝11:00より前に入れない ----------
test("休憩が11:00より前なら NG", () => {
  const r = checkDay({ ...base, assignments: [work("a", 7, 16, "hall", 10)] });
  assert.ok(r.some((x) => x.code === "break-early" && !x.ok));
});

test("休憩が11:00以降なら OK", () => {
  const r = checkDay({ ...base, assignments: [work("a", 7, 16, "hall", 11.5)] });
  assert.ok(!r.some((x) => x.code === "break-early"));
});
