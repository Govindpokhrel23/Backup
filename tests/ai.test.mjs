// ============================================================
// tests/ai.test.mjs — AIまわりの自動テスト（2026年11月5日）
// ------------------------------------------------------------
// このファイルは、AIの答えの確かめ（validate）・店長の直し方を覚える（learning）・
// Gemini に送る文（prompt）・「AIで作成」の流れ（draft-service）・
// 入れそうな人さがし（candidates）を、本物の Gemini を使わずに確かめるテストのファイルです。
// 動かし方：node --test tests/*.test.mjs
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具

// ブラウザの localStorage のかわり（テストの中だけ）
const memory = new Map();                                             // 保存の入れ物
globalThis.localStorage = {   // スマホの保存のまね（Node には localStorage がない）
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),   // 読む
  setItem: (key, value) => memory.set(key, String(value)),   // 保存
  removeItem: (key) => memory.delete(key),   // 消す
};

const { cleanShifts, toMinutes } = await import("../js/ai/validate.js");   // テストする関数を validate.js から読み込む
const { diffDraft, summarize } = await import("../js/ai/learning.js");   // テストする関数を learning.js から読み込む
const { buildDraftPrompt } = await import("../js/ai/prompt.js");   // テストする関数を prompt.js から読み込む
const { runAiDraft } = await import("../js/ai/draft-service.js");   // テストする関数を draft-service.js から読み込む
const { saveAiSettings, getAiSettings } = await import("../js/ai/ai-settings.js");   // テストする関数を ai-settings.js から読み込む
const { askGemini } = await import("../js/ai/gemini.js");   // テストする関数を gemini.js から読み込む
const { CONFIG } = await import("../js/config.js");   // 設定を読む
CONFIG.API_MODE = "mock";   // 下の Gemini のテストは見本版として動かす（本番では「直接」は止まる。下のセキュリティのテストで確かめる）
CONFIG.API_WORKER_URL = "";   // テストでは Worker なし（「直接 Gemini」の動きを確かめるため。本番では「直接」は使えない）
const { findCandidates } = await import("../js/rules/candidates.js");   // テストする関数を candidates.js から読み込む
const { makeDraft } = await import("../js/ai/simple-draft.js");   // テストする関数を simple-draft.js から読み込む

/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする
/** テスト用の週（2026-11-09 月曜〜） */
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];   // テストの週の7日
/** テスト用の店員 */
const members = [   // テスト用の店員
  { id: "a", name: "スタッフA", kind: "shain", active: true, rankHere: 1, skills: { hall: 100, kitchen: 100, open: 100, close: 100 } },   // 社員A
  { id: "b", name: "スタッフB", kind: "baito", active: true, rankHere: 1, skills: { hall: 100, kitchen: 0, open: 0, close: 0 } },   // バイトB
  { id: "c", name: "スタッフC", kind: "baito", active: true, rankHere: 2, skills: { hall: 75, kitchen: 50, open: 0, close: 0 } },   // ほかの店舗のバイトC
];
/** AIに渡す情報（ctx）の見本 */
const ctx = {   // AIに渡す中身
  dates, members,   // 7日と店員
  availabilities: [   // 希望
    { memberId: "b", date: "2026-11-09", kind: "time", from: hoursToMin(9), to: hoursToMin(15) },   // Bは月曜9〜15時
    { memberId: "b", date: "2026-11-10", kind: "off" },   // Bは火曜休み
    { memberId: "a", date: "2026-11-15", kind: "off" },   // Aは日曜休み
  ],
  requirements: [{ id: "r1", positionId: "p1", dayType: "weekday", from: hoursToMin(7), to: hoursToMin(22), count: 1 }],   // 必要人数
  positions: [{ id: "p1", area: "hall" }],   // 場所
  fixed: [], past: [], elsewhere: [{ memberId: "a", date: "2026-11-11", from: hoursToMin(9), to: hoursToMin(18) }],   // 固定・前の週・ほかの店舗の勤務
  rules: [{ memberId: "b", text: "スタッフBは土曜NG" }], learnings: [],   // 店長のメモ・覚えたこと
  dayTypeOf: () => "weekday",   // 日の種類
  hoursOf: () => ({ open: hoursToMin(7), close: hoursToMin(22) }),   // 営業時間
  problemsOf: () => [],   // 問題（なし）
};
/** S1→a, S2→b, S3→c */
const toId = new Map([["S1", "a"], ["S2", "b"], ["S3", "c"]]);   // 番号 → ID の表

// ---------- validate ----------

test("時刻の文字を分にする（25:00＝翌1:00 も読める）", () => {   // テスト：時刻の文字
  assert.equal(toMinutes("06:30"), 390);   // 6:30 → 390分
  assert.equal(toMinutes("25:00"), 1500);   // 25:00 → 1500分
  assert.equal(toMinutes("6時"), null);   // 形がちがう → null
});

test("AIの答え：知らない人・休み希望・希望なしのバイト・ほかの店舗と重なる勤務は外す", () => {   // テスト：外すもの
  const { rows, dropped } = cleanShifts([   // 確かめたあとの勤務
    { staff: "S9", date: "2026-11-09", start: "07:00", end: "16:00", area: "hall" },   // 知らない人
    { staff: "S2", date: "2026-11-10", start: "09:00", end: "15:00", area: "hall" },   // 休み希望
    { staff: "S2", date: "2026-11-11", start: "09:00", end: "15:00", area: "hall" },   // 希望なしのバイト
    { staff: "S1", date: "2026-11-11", start: "10:00", end: "19:00", area: "hall" },   // ほかの店舗と重なる
  ], ctx, toId);   // 答えを確かめる
  assert.equal(rows.length, 0);   // 使える勤務は0
  assert.equal(dropped.length, 4);   // 外したのは4つ
});

test("AIの答え：希望の時間の中に縮める・休憩を決まりに合わせる・理由を残す", () => {   // テスト：縮める・休憩・理由
  const { rows } = cleanShifts([   // 確かめたあとの勤務
    { staff: "S2", date: "2026-11-09", start: "07:00", end: "16:00", area: "hall", break: "10:00", reason: "朝が足りない" },   // 7〜16時・休憩10時
  ], ctx, toId);   // 答えを確かめる
  assert.equal(rows.length, 1);   // 1つ
  assert.equal(rows[0].from, hoursToMin(9));       // 希望 9:00〜15:00 に縮めた
  assert.equal(rows[0].to, hoursToMin(15));   // 希望の15時までに縮む
  assert.ok(rows[0].breakAt >= hoursToMin(11));    // 休憩は11:00より前にしない
  assert.equal(rows[0].reason, "朝が足りない");   // 理由が残る
});

test("AIの答え：固定した勤務は、AIが何を言っても元のまま", () => {   // テスト：固定
  const fixed = [{ memberId: "a", date: "2026-11-09", from: hoursToMin(8), to: hoursToMin(17), area: "hall", fixed: true }];   // 固定した勤務
  const { rows } = cleanShifts([{ staff: "S1", date: "2026-11-09", start: "12:00", end: "22:00", area: "kitchen" }], { ...ctx, fixed }, toId);   // 確かめたあとの勤務
  assert.equal(rows.length, 1);   // 1つ
  assert.equal(rows[0].from, hoursToMin(8));   // 元の8時のまま
});

// ---------- learning ----------

test("店長の直し方：時間を直した・外した・足した・場所を変えた を見つける", () => {   // テスト：店長の直し方
  const ai = [   // AIの下書き
    { memberId: "a", date: "2026-11-09", from: hoursToMin(6.5), to: hoursToMin(15.5), area: "hall" },   // 時間を直した
    { memberId: "b", date: "2026-11-09", from: hoursToMin(9), to: hoursToMin(15), area: "hall" },   // 足した
    { memberId: "c", date: "2026-11-10", from: hoursToMin(9), to: hoursToMin(15), area: "hall" },   // 場所を変えた
  ];
  const fin = [   // 店長が直して公開したもの
    { memberId: "a", date: "2026-11-09", from: hoursToMin(7), to: hoursToMin(16), area: "hall" },     // 時間
    { memberId: "c", date: "2026-11-10", from: hoursToMin(9), to: hoursToMin(15), area: "kitchen" },  // 場所
    { memberId: "c", date: "2026-11-12", from: hoursToMin(16), to: hoursToMin(22), area: "hall" },    // 足した
  ];                                                                                // b は外した
  const kinds = diffDraft(ai, fin).map((change) => change.kind).sort();   // 見つけた直しの種類
  assert.deepEqual(kinds, ["add", "area", "remove", "time"]);   // 4種類見つかる
});

test("店長の直し方：2回同じなら「覚えた」になり、下書きで最初からその時間にする", () => {   // テスト：覚える
  const rows = [1, 2].map((number) => ({ id: `l${number}`, memberId: "a", weekday: 1, kind: "time", from: hoursToMin(7), to: hoursToMin(16) }));   // 同じ直しを2回
  const learned = summarize(rows, members);   // まとめた学び
  assert.equal(learned.notes[0].strong, true);   // 覚えた
  assert.deepEqual(learned.prefer.get("a|1"), { from: hoursToMin(7), to: hoursToMin(16), count: 2, area: undefined });   // 月曜は7〜16時
  const draft = makeDraft({ ...ctx, learned });   // 学びを使った下書き
  const monday = draft.find((shift) => shift.memberId === "a" && shift.date === "2026-11-09");   // 月曜のスタッフAの勤務
  assert.equal(monday.from, hoursToMin(7));   // 下書きも7時から
  assert.equal(monday.to, hoursToMin(16));   // 16時まで
});

// ---------- prompt ----------

test("Gemini に送る文には名前を入れない（S1 などの番号にする）", () => {   // テスト：名前を送らない
  const { prompt } = buildDraftPrompt(ctx, []);   // Gemini に送る文
  assert.doesNotMatch(prompt, /スタッフ[ABC]/);   // 名前が入っていない
  assert.match(prompt, /S2は土曜NG/);         // 人ごとのルールの中の名前も番号に
  assert.match(prompt, /06:30/);              // 立ち上げは開店30分前
});

// ---------- draft-service（にせものの Gemini） ----------

test("AIで作成：Gemini の答えを確かめて使う", async () => {   // テスト：Gemini
  saveAiSettings({ mode: "gemini", apiKey: "test-key", model: "gemini-3-flash-preview" });   // AIの設定
  /** にせものの Gemini：決まった答えを返す */
  const fakeFetch = async (url, init) => {   // にせものの Gemini
    assert.match(url, /gemini-3-flash-preview:generateContent$/);   // 送り先が合っている
    assert.equal(init.headers["x-goog-api-key"], "test-key");   // 鍵が付いている
    const answer = { shifts: [{ staff: "S2", date: "2026-11-09", start: "09:00", end: "15:00", area: "hall", reason: "希望どおり" }], summary: "作りました" };   // にせものの Gemini の答え
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };   // 答えを返す
  };
  const result = await runAiDraft(ctx, { fetchImpl: fakeFetch });   // 「AIで作成」の結果
  assert.equal(result.source, "gemini");   // Gemini の案を使った
  assert.equal(result.summary, "作りました");   // ひとことが入っている
  assert.equal(result.rows[0].reason, "希望どおり");   // 理由が入っている
});

test("AIで作成：Gemini がエラーでも止まらず、簡易版で作る", async () => {   // テスト：Gemini のエラー
  saveAiSettings({ mode: "gemini", apiKey: "bad", model: "gemini-3-flash-preview" });   // AIの設定
  /** にせものの Gemini（429＝回数オーバーを返す） */
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => "quota" });   // にせもの（回数をこえたエラー）
  const result = await runAiDraft(ctx, { fetchImpl: fakeFetch });   // 「AIで作成」の結果
  assert.equal(result.source, "local");   // たたき台を使った
  assert.match(result.error, /回数をこえました/);   // エラーの文
  assert.ok(result.rows.length > 0);   // 勤務はある
});

// ---------- 覚えた直し方（2026年11月17日） ----------

test("覚えた直し方：AI（Gemini）が守らなくても、2回覚えた時間は必ず入る", async () => {   // テスト：学びを必ず使う
  CONFIG.API_MODE = "mock";   // 見本版として動かす
  saveAiSettings({ mode: "gemini", apiKey: "test-key", model: "gemini-3-flash-preview" });   // AIの設定
  // 店長が2回「Bの月曜は 10:00〜14:00」に直した（希望 9〜15 の中）
  const learnings = [1, 2].map((index) => ({ id: `l${index}`, kind: "time", memberId: "b", date: "2026-11-02", weekday: 1, from: hoursToMin(10), to: hoursToMin(14), at: `2026-11-0${index}` }));   // 覚えたこと
  /** にせものの Gemini：覚えたことを守らず 9:00〜15:00 を返す */
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ shifts: [{ staff: "S2", date: "2026-11-09", start: "09:00", end: "15:00", area: "hall", reason: "希望どおり" }], summary: "" }) }] } }] }) });   // AIの答え
  const result = await runAiDraft({ ...ctx, learnings }, { fetchImpl: fakeFetch });   // 「AIで作成」
  const monday = result.rows.find((row) => row.memberId === "b" && row.date === "2026-11-09");   // Bの月曜
  assert.equal(result.source, "gemini");   // AIの案を使った
  assert.deepEqual([monday.from, monday.to], [hoursToMin(10), hoursToMin(14)]);   // 覚えた時間になっている
});

test("過去のシフト：4週続けて同じ時間なら、AIの答えもその時間になる（2026年11月22日）", async () => {   // テスト：過去から学ぶ
  saveAiSettings({ mode: "gemini", apiKey: "test-key", model: "gemini-3-flash-preview" });   // AIの設定
  const { findPatterns } = await import("../js/ai/past-patterns.js");   // いつもの形を見つける道具
  const past = ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"].map((date) => ({ memberId: "b", date, from: hoursToMin(10), to: hoursToMin(15), area: "hall" }));   // Bは4週とも月曜 10〜15
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ shifts: [{ staff: "S2", date: "2026-11-09", start: "09:00", end: "13:00", area: "hall", reason: "" }], summary: "" }) }] } }] }) });   // AIは 9〜13 と答える
  const result = await runAiDraft({ ...ctx, patterns: findPatterns(past, members) }, { fetchImpl: fakeFetch });   // 「AIで作成」
  const monday = result.rows.find((row) => row.memberId === "b" && row.date === "2026-11-09");   // Bの月曜
  assert.deepEqual([monday.from, monday.to], [hoursToMin(10), hoursToMin(15)]);   // いつもの形（希望 9〜15 の中）
  assert.equal(result.patternCount, 1);   // 使ったいつもの形は1つ
});

test("覚えた直し方：1回だけの直しは、まだ使わない（たまたまかもしれない）", async () => {   // テスト：1回はまだ
  const learnings = [{ id: "l1", kind: "time", memberId: "b", date: "2026-11-02", weekday: 1, from: hoursToMin(10), to: hoursToMin(14), at: "2026-11-01" }];   // 1回だけ
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ shifts: [{ staff: "S2", date: "2026-11-09", start: "09:00", end: "15:00", area: "hall", reason: "" }], summary: "" }) }] } }] }) });   // AIの答え
  const result = await runAiDraft({ ...ctx, learnings }, { fetchImpl: fakeFetch });   // 「AIで作成」
  const monday = result.rows.find((row) => row.memberId === "b" && row.date === "2026-11-09");   // Bの月曜
  assert.deepEqual([monday.from, monday.to], [hoursToMin(9), hoursToMin(15)]);   // AIの時間のまま
});

// ---------- セキュリティ（2026年11月17日） ----------

test("セキュリティ：本番では、前に保存した Gemini の鍵をこの機械から消し、直接 Gemini にしない", () => {   // テスト：鍵を残さない
  CONFIG.API_MODE = "mock";   // まず見本版で
  saveAiSettings({ mode: "gemini", apiKey: "AIza-old-key", model: "gemini-3-flash-preview" });   // 鍵を保存した状態にする
  assert.match(localStorage.getItem("shiftapp-ai-settings"), /AIza-old-key/);   // 見本版では保存されている
  CONFIG.API_MODE = "supabase"; CONFIG.API_WORKER_URL = "";   // 本番にする（Worker の住所が入らなかった時も）
  const settings = getAiSettings();   // 設定を読む
  assert.equal(settings.mode, "worker");   // 直接ではなく Worker
  assert.equal(settings.apiKey, "");   // 鍵は使わない
  assert.doesNotMatch(localStorage.getItem("shiftapp-ai-settings"), /AIza/);   // 保存からも消えた
  saveAiSettings({ mode: "gemini", apiKey: "AIza-new-key" });   // 本番で鍵を保存しようとしても
  assert.doesNotMatch(localStorage.getItem("shiftapp-ai-settings"), /AIza/);   // 保存されない
  assert.equal(getAiSettings().mode, "worker");   // 直接にならない
  CONFIG.API_MODE = "mock";   // もどす
});

test("セキュリティ：本番では、直接 Gemini（Google）に送ろうとしても止まり、通信もしない", async () => {   // テスト：直接送らない
  CONFIG.API_MODE = "supabase";   // 本番にする
  let called = false;   // 通信したか
  const fakeFetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };   // にせものの通信
  await assert.rejects(askGemini({ settings: { mode: "gemini", apiKey: "AIza-x", model: "m" }, prompt: "p", schema: {}, fetchImpl: fakeFetch }), /本番では、スマホから直接 Gemini は使えません/);   // 止まる
  assert.equal(called, false);   // Google に送っていない
  CONFIG.API_MODE = "mock";   // もどす
});

// ---------- candidates ----------

test("入れそうな人：休み希望・時間がかぶる人は外し、希望が合う人を先にする", () => {   // テスト：入れそうな人
  const need = { date: "2026-11-09", area: "hall", from: hoursToMin(10), to: hoursToMin(14) };   // 足りない時間
  const list = findCandidates({   // 入れそうな人
    need, storeId: "s1",   // 足りない時間・店舗
    members: [   // 店員
      { id: "x", name: "X", active: true, storeId: "s1", skills: { hall: 100 } },   // X
      { id: "y", name: "Y", active: true, storeId: "s1", skills: { hall: 100 } },   // Y（休み希望）
      { id: "z", name: "Z", active: true, storeId: "s2", stores: [{ storeId: "s2", rank: 1 }, { storeId: "s1", rank: 2 }], skills: { hall: 75 } },   // Z（ほかの店舗・時間の希望が合う）
      { id: "w", name: "W", active: true, storeId: "s1", skills: { hall: 100 } },   // W（時間がかぶる）
    ],
    dayAssignments: [{ memberId: "w", from: hoursToMin(9), to: hoursToMin(12) }],                       // W はもう入っている
    availabilities: [   // 希望
      { memberId: "y", date: "2026-11-09", kind: "off" },                              // Y は休み希望
      { memberId: "z", date: "2026-11-09", kind: "time", from: hoursToMin(10), to: hoursToMin(15) },     // Z は希望が合う
    ],
  });
  assert.deepEqual(list.map((candidate) => candidate.member.id), ["z", "x"]);   // Z が先、次に X
});
