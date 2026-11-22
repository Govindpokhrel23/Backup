// ============================================================
// tests/past-patterns.test.mjs — 過去のシフトから学ぶテスト（2026年11月22日）
// ------------------------------------------------------------
// このファイルは、過去4週の公開したシフトから「いつもの形」を見つけて、
// 新しい下書きに使えるかを確かめるテストのファイルです。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { findPatterns, withPatterns } from "../js/ai/past-patterns.js";   // テストする関数を読む

const at = (hours) => hours * 60;   // 時 → 分
const members = [{ id: "a", name: "スタッフA" }, { id: "b", name: "スタッフB" }];   // 店員
/** 月曜の勤務（週の月曜日・時間） */
const monday = (date, memberId, from, to, area = "hall") => ({ memberId, date, from: at(from), to: at(to), area });   // 勤務を作る

test("過去4週のうち3週同じ時間なら「いつもの形」になる", () => {   // テスト：3週
  const past = [   // 過去4週の月曜
    monday("2026-10-26", "a", 7, 16), monday("2026-11-02", "a", 7, 16), monday("2026-11-09", "a", 7, 16, "kitchen"), monday("2026-11-16", "a", 7, 16),   // Aは4週とも 7〜16
    monday("2026-11-02", "b", 13, 22), monday("2026-11-16", "b", 13, 22), monday("2026-11-09", "b", 9, 18),   // Bは 13〜22 が2週だけ
  ];
  const { prefer, notes } = findPatterns(past, members);   // いつもの形を見つける
  assert.deepEqual(prefer.get("a|1"), { from: at(7), to: at(16), area: "hall", count: 4, weeks: 4, memberId: "a", weekday: 1 });   // Aの月曜（場所は多いホール）
  assert.equal(prefer.has("b|1"), false);   // Bは2週だけなので、まだ「いつもの形」ではない
  assert.match(notes[0].text, /スタッフA：月曜はいつも 7:00〜16:00（ホール）/);   // 説明の文
});

test("店長の直し方の方が強い・よく外す日には使わない", () => {   // テスト：直し方が先
  const patterns = { prefer: new Map([["a|1", { from: at(7), to: at(16), area: "hall", count: 4 }], ["b|1", { from: at(9), to: at(18), area: "hall", count: 3 }], ["c|2", { from: at(10), to: at(15), area: "kitchen", count: 3 }]]), notes: [] };   // いつもの形
  const learned = { notes: [], prefer: new Map([["a|1", { from: at(8), to: at(14), count: 2 }]]), avoid: new Map([["b|1", 2]]), areaPref: new Map() };   // 直し方：Aの月曜は 8〜14・Bの月曜は外す
  const merged = withPatterns(learned, patterns);   // 合わせる
  assert.deepEqual([merged.prefer.get("a|1").from, merged.prefer.get("a|1").to], [at(8), at(14)]);   // Aは直し方
  assert.equal(merged.prefer.has("b|1"), false);   // Bは外すことが多い日なので使わない
  assert.equal(merged.prefer.get("c|2").from, at(10));   // Cはいつもの形
  assert.equal(merged.patternCount, 1);   // 使ったいつもの形は1つ
});
