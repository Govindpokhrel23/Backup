// ============================================================
// tests/reminder.test.mjs — 「明日のシフト」の通知のテスト（2026年11月22日）
// ------------------------------------------------------------
// このファイルは、毎日18時の「明日のシフト」の通知が、
// 明日に公開した勤務がある人にだけ、正しい文で届くかを確かめるテストのファイルです。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import { tomorrowInJapan, reminderText, sendTomorrowReminders } from "../workers/api/lib/reminder.js";   // テストする関数を読む

test("明日の日付：日本の18時（UTC 9時）に動くと、日本の明日になる", () => {   // テスト：明日の日付
  assert.equal(tomorrowInJapan(new Date("2026-11-22T09:00:00Z")), "2026-11-23");   // 11/22 18:00 → 11/23
  assert.equal(tomorrowInJapan(new Date("2026-11-30T09:00:00Z")), "2026-12-01");   // 月をまたぐ
});

test("通知の文：店舗・時間・休憩が入る", () => {   // テスト：文
  const text = reminderText("2026-11-23", [{ store_id: "s1", from_min: 420, to_min: 960, break_at: 660 }], new Map([["s1", "安城福釜店"]]));   // 文を作る
  assert.equal(text, "明日 11/23（月）のシフト：安城福釜店 7:00〜16:00（休憩 11:00）");   // 正しい文
});

test("送る人：明日の勤務がある人だけ。やめた人には送らず、使えない宛先は消す", async () => {   // テスト：送る人
  const asked = [];   // 読んだ表の記録
  const deleted = [];   // 消した宛先
  const db = {   // にせものの Supabase
    get: async (path) => {   // 読む
      asked.push(path);   // 記録
      if (path.startsWith("assignments?")) return [   // 明日の勤務（公開した週だけを読んでいるか、下で確かめる）
        { member_id: "a", store_id: "s1", from_min: 420, to_min: 960, break_at: 660 },   // A
        { member_id: "b", store_id: "s2", from_min: 960, to_min: 1320, break_at: null },   // B
        { member_id: "c", store_id: "s1", from_min: 540, to_min: 1080, break_at: 780 },   // C（やめた人）
      ];
      if (path.startsWith("members?")) return [{ id: "a" }, { id: "b" }];   // やめていない人（C はいない）
      if (path.startsWith("stores?")) return [{ id: "s1", name: "安城福釜店" }, { id: "s2", name: "安城店" }];   // 店舗
      if (path.startsWith("push_subs?")) return [{ member_id: "a", endpoint: "https://push/a" }, { member_id: "b", endpoint: "https://push/b" }, { member_id: "c", endpoint: "https://push/c" }];   // 宛先
      return [];   // それ以外
    },
    del: async (path) => { deleted.push(path); },   // 消す
  };
  const sentTo = [];   // 送った宛先と中身
  const send = async (sub, payload) => { sentTo.push({ to: sub.member_id, body: JSON.parse(payload).body }); return new Response(null, { status: sub.member_id === "b" ? 410 : 201 }); };   // B の宛先はもう使えない
  const result = await sendTomorrowReminders(db, send, new Date("2026-11-22T09:00:00Z"));   // 送る
  assert.match(asked[0], /date=eq\.2026-11-23/);   // 明日の勤務を読んだ
  assert.match(asked[0], /periods\.status=eq\.published/);   // 公開した週だけ
  assert.deepEqual(sentTo.map((each) => each.to), ["a", "b"]);   // A と B に送った（C はやめた人なので送らない）
  assert.equal(sentTo[0].body, "明日 11/23（月）のシフト：安城福釜店 7:00〜16:00（休憩 11:00）");   // A の文
  assert.equal(result.sent, 1);   // 届いたのは A
  assert.equal(result.removed, 1);   // B の使えない宛先は消した
  assert.match(deleted[0], /push%2Fb/);   // B の宛先を消した
});

test("明日だれも入っていなければ、何も送らない", async () => {   // テスト：だれもいない
  const db = { get: async () => [], del: async () => {} };   // 空の Supabase
  let count = 0;   // 送った数
  const result = await sendTomorrowReminders(db, async () => { count++; return new Response(null, { status: 201 }); }, new Date("2026-11-22T09:00:00Z"));   // 送る
  assert.equal(count, 0);   // 送っていない
  assert.equal(result.people, 0);   // 0人
});
