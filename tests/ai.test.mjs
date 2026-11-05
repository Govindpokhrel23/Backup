// ============================================================
// tests/ai.test.mjs — AIまわりの自動テスト（2026年11月5日）
// ------------------------------------------------------------
// このファイルは、AIの答えの確かめ（validate）・店長の直し方を覚える（learning）・
// Gemini に送る文（prompt）・「AIで作成」の流れ（draft-service）・
// 入れそうな人さがし（candidates）を、本物の Gemini を使わずに確かめるテストのファイルです。
// 動かし方：node --test tests/*.test.mjs
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

// ブラウザの localStorage のかわり（テストの中だけ）
const memory = new Map();                                             // 保存の入れ物
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const { cleanShifts, toMinutes } = await import("../js/ai/validate.js");   // テストする関数を validate.js から読み込む
const { diffDraft, summarize } = await import("../js/ai/learning.js");   // テストする関数を learning.js から読み込む
const { buildDraftPrompt } = await import("../js/ai/prompt.js");   // テストする関数を prompt.js から読み込む
const { runAiDraft } = await import("../js/ai/draft-service.js");   // テストする関数を draft-service.js から読み込む
const { saveAiSettings } = await import("../js/ai/ai-settings.js");   // テストする関数を ai-settings.js から読み込む
const { findCandidates } = await import("../js/rules/candidates.js");   // テストする関数を candidates.js から読み込む
const { makeDraft } = await import("../js/ai/simple-draft.js");   // テストする関数を simple-draft.js から読み込む

/** 時 → 分 */
const H = (h) => h * 60;
/** テスト用の週（2026-11-09 月曜〜） */
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
/** テスト用の店員 */
const members = [
  { id: "a", name: "スタッフA", kind: "shain", active: true, rankHere: 1, skills: { hall: 100, kitchen: 100, open: 100, close: 100 } },
  { id: "b", name: "スタッフB", kind: "baito", active: true, rankHere: 1, skills: { hall: 100, kitchen: 0, open: 0, close: 0 } },
  { id: "c", name: "スタッフC", kind: "baito", active: true, rankHere: 2, skills: { hall: 75, kitchen: 50, open: 0, close: 0 } },
];
/** AIに渡す情報（ctx）の見本 */
const ctx = {
  dates, members,
  availabilities: [
    { memberId: "b", date: "2026-11-09", kind: "time", from: H(9), to: H(15) },
    { memberId: "b", date: "2026-11-10", kind: "off" },
    { memberId: "a", date: "2026-11-15", kind: "off" },
  ],
  requirements: [{ id: "r1", positionId: "p1", dayType: "weekday", from: H(7), to: H(22), count: 1 }],
  positions: [{ id: "p1", area: "hall" }],
  fixed: [], past: [], elsewhere: [{ memberId: "a", date: "2026-11-11", from: H(9), to: H(18) }],
  rules: [{ memberId: "b", text: "スタッフBは土曜NG" }], learnings: [],
  dayTypeOf: () => "weekday",
  hoursOf: () => ({ open: H(7), close: H(22) }),
  problemsOf: () => [],
};
/** S1→a, S2→b, S3→c */
const toId = new Map([["S1", "a"], ["S2", "b"], ["S3", "c"]]);

// ---------- validate ----------

test("時刻の文字を分にする（25:00＝翌1:00 も読める）", () => {
  assert.equal(toMinutes("06:30"), 390);
  assert.equal(toMinutes("25:00"), 1500);
  assert.equal(toMinutes("6時"), null);
});

test("AIの答え：知らない人・休み希望・希望なしのバイト・ほかの店舗と重なる勤務は外す", () => {
  const { rows, dropped } = cleanShifts([   // 確かめたあとの勤務
    { staff: "S9", date: "2026-11-09", start: "07:00", end: "16:00", area: "hall" },   // 知らない人
    { staff: "S2", date: "2026-11-10", start: "09:00", end: "15:00", area: "hall" },   // 休み希望
    { staff: "S2", date: "2026-11-11", start: "09:00", end: "15:00", area: "hall" },   // 希望なしのバイト
    { staff: "S1", date: "2026-11-11", start: "10:00", end: "19:00", area: "hall" },   // ほかの店舗と重なる
  ], ctx, toId);
  assert.equal(rows.length, 0);
  assert.equal(dropped.length, 4);
});

test("AIの答え：希望の時間の中に縮める・休憩を決まりに合わせる・理由を残す", () => {
  const { rows } = cleanShifts([   // 確かめたあとの勤務
    { staff: "S2", date: "2026-11-09", start: "07:00", end: "16:00", area: "hall", break: "10:00", reason: "朝が足りない" },
  ], ctx, toId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, H(9));       // 希望 9:00〜15:00 に縮めた
  assert.equal(rows[0].to, H(15));
  assert.ok(rows[0].breakAt >= H(11));    // 休憩は11:00より前にしない
  assert.equal(rows[0].reason, "朝が足りない");
});

test("AIの答え：固定した勤務は、AIが何を言っても元のまま", () => {
  const fixed = [{ memberId: "a", date: "2026-11-09", from: H(8), to: H(17), area: "hall", fixed: true }];   // 固定した勤務
  const { rows } = cleanShifts([{ staff: "S1", date: "2026-11-09", start: "12:00", end: "22:00", area: "kitchen" }], { ...ctx, fixed }, toId);   // 確かめたあとの勤務
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, H(8));
});

// ---------- learning ----------

test("店長の直し方：時間を直した・外した・足した・場所を変えた を見つける", () => {
  const ai = [   // AIの下書き
    { memberId: "a", date: "2026-11-09", from: H(6.5), to: H(15.5), area: "hall" },
    { memberId: "b", date: "2026-11-09", from: H(9), to: H(15), area: "hall" },
    { memberId: "c", date: "2026-11-10", from: H(9), to: H(15), area: "hall" },
  ];
  const fin = [   // 店長が直して公開したもの
    { memberId: "a", date: "2026-11-09", from: H(7), to: H(16), area: "hall" },     // 時間
    { memberId: "c", date: "2026-11-10", from: H(9), to: H(15), area: "kitchen" },  // 場所
    { memberId: "c", date: "2026-11-12", from: H(16), to: H(22), area: "hall" },    // 足した
  ];                                                                                // b は外した
  const kinds = diffDraft(ai, fin).map((x) => x.kind).sort();   // 見つけた直しの種類
  assert.deepEqual(kinds, ["add", "area", "remove", "time"]);
});

test("店長の直し方：2回同じなら「覚えた」になり、下書きで最初からその時間にする", () => {
  const rows = [1, 2].map((i) => ({ id: `l${i}`, memberId: "a", weekday: 1, kind: "time", from: H(7), to: H(16) }));   // 同じ直しを2回
  const learned = summarize(rows, members);   // まとめた学び
  assert.equal(learned.notes[0].strong, true);
  assert.deepEqual(learned.prefer.get("a|1"), { from: H(7), to: H(16), count: 2, area: undefined });
  const draft = makeDraft({ ...ctx, learned });   // 学びを使った下書き
  const monday = draft.find((x) => x.memberId === "a" && x.date === "2026-11-09");   // 月曜のスタッフAの勤務
  assert.equal(monday.from, H(7));
  assert.equal(monday.to, H(16));
});

// ---------- prompt ----------

test("Gemini に送る文には名前を入れない（S1 などの番号にする）", () => {
  const { prompt } = buildDraftPrompt(ctx, []);   // Gemini に送る文
  assert.doesNotMatch(prompt, /スタッフ[ABC]/);
  assert.match(prompt, /S2は土曜NG/);         // 人ごとのルールの中の名前も番号に
  assert.match(prompt, /06:30/);              // 立ち上げは開店30分前
});

// ---------- draft-service（にせものの Gemini） ----------

test("AIで作成：Gemini の答えを確かめて使う", async () => {
  saveAiSettings({ mode: "gemini", apiKey: "test-key", model: "gemini-3-flash-preview" });
  /** にせものの Gemini：決まった答えを返す */
  const fakeFetch = async (url, init) => {
    assert.match(url, /gemini-3-flash-preview:generateContent$/);
    assert.equal(init.headers["x-goog-api-key"], "test-key");
    const answer = { shifts: [{ staff: "S2", date: "2026-11-09", start: "09:00", end: "15:00", area: "hall", reason: "希望どおり" }], summary: "作りました" };   // にせものの Gemini の答え
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
  };
  const r = await runAiDraft(ctx, { fetchImpl: fakeFetch });   // 「AIで作成」の結果
  assert.equal(r.source, "gemini");
  assert.equal(r.summary, "作りました");
  assert.equal(r.rows[0].reason, "希望どおり");
});

test("AIで作成：Gemini がエラーでも止まらず、簡易版で作る", async () => {
  saveAiSettings({ mode: "gemini", apiKey: "bad", model: "gemini-3-flash-preview" });
  /** にせものの Gemini（429＝回数オーバーを返す） */
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => "quota" });
  const r = await runAiDraft(ctx, { fetchImpl: fakeFetch });   // 「AIで作成」の結果
  assert.equal(r.source, "local");
  assert.match(r.error, /回数をこえました/);
  assert.ok(r.rows.length > 0);
});

// ---------- candidates ----------

test("入れそうな人：休み希望・時間がかぶる人は外し、希望が合う人を先にする", () => {
  const need = { date: "2026-11-09", area: "hall", from: H(10), to: H(14) };   // 足りない時間
  const list = findCandidates({   // 入れそうな人
    need, storeId: "s1",
    members: [
      { id: "x", name: "X", active: true, storeId: "s1", skills: { hall: 100 } },
      { id: "y", name: "Y", active: true, storeId: "s1", skills: { hall: 100 } },
      { id: "z", name: "Z", active: true, storeId: "s2", stores: [{ storeId: "s2", rank: 1 }, { storeId: "s1", rank: 2 }], skills: { hall: 75 } },
      { id: "w", name: "W", active: true, storeId: "s1", skills: { hall: 100 } },
    ],
    dayAssignments: [{ memberId: "w", from: H(9), to: H(12) }],                       // W はもう入っている
    availabilities: [
      { memberId: "y", date: "2026-11-09", kind: "off" },                              // Y は休み希望
      { memberId: "z", date: "2026-11-09", kind: "time", from: H(10), to: H(15) },     // Z は希望が合う
    ],
  });
  assert.deepEqual(list.map((x) => x.member.id), ["z", "x"]);
});
