// ============================================================
// tests/supabase.test.mjs — 本物（Supabase）用の api を、本物の Postgres で通して確かめる
// ------------------------------------------------------------
// このファイルは、supabase/schema.sql を流した Postgres（PGlite）の上で、
// 店長と店員の流れ（ログイン → 店舗 → 店員 → 希望 → シフト → 公開 → 交代 → 募集 → AIの学び）と、
// 「見てはいけないものが見えない」決まり（RLS）を確かめるテストのファイルです（2026年11月6日）。
// 動かし方：npm install（はじめの1回）→ npm test
// PGlite が入っていない時は、このテストだけ飛ばす。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// ブラウザの localStorage のかわり
const memory = new Map();                                             // 保存の入れ物
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };

/** PGlite があるか（なければテストを飛ばす） */
let fake = null;
try {
  const { createFakeSupabase } = await import("./helpers/fake-supabase.mjs");   // にせもの Supabase を作る関数
  fake = await createFakeSupabase();
} catch (e) {
  console.warn("PGlite がないので Supabase のテストを飛ばします（npm install で入ります）", e.message);
}
const skip = !fake;                                                    // 飛ばすか

const { useClient, emailOf } = await import("../js/api/supabase/core.js");   // テストする関数を読み込む
const { supabaseApi: api } = await import("../js/api/supabase-api.js");
const { weekDates, addDays, today } = await import("../js/lib/date.js");   // テストする関数を読み込む

/** 今日から見た次の月曜（希望の締切より前の週） */
const nextMonday = (() => { let d = addDays(today(), 7); while (new Date(`${d}T00:00`).getDay() !== 1) d = addDays(d, 1); return d; })();
/** 時 → 分 */
const H = (h) => h * 60;

/**
 * Worker の /activate と同じことをする（テスト用）
 * 初回コードを確かめて、ログインの人を作り、店員につなぐ
 */
async function activate(loginId, code, password) {
  const r = await fake.admin.sql("select * from login_codes where login_id = $1 and code = $2 and not used", [loginId, code]);   // 合っている初回コード
  assert.equal(r.rows.length, 1, "初回コードが合っていない");
  const authId = await fake.admin.createUser(emailOf(loginId), password);   // 作ったログインの人のID
  await fake.admin.sql("update members set auth_id = $1, account = 'active' where login_id = $2", [authId, loginId]);
  await fake.admin.sql("update login_codes set used = true where login_id = $1", [loginId]);
}

/** テストの中で使う値（順に作っていく） */
const ctx = {};

test("準備：表を作り、最初のデータ（会社・3店舗・店長）を入れる", { skip }, async () => {
  useClient(fake.client);
  const out = await fake.admin.exec(fs.readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8"));   // seed.sql を流した結果
  ctx.bossCode = out[out.length - 1].rows[0]["初回コード（7日以内に使う）"];
  assert.match(ctx.bossCode, /^\d{6}$/);
  await activate("1000", ctx.bossCode, "boss-pass");
});

test("店長：ログインすると3店舗が見え、店舗を増やして設定を写せる", { skip }, async () => {
  const boss = await api.login("1000", "boss-pass");   // ログインした店長
  assert.equal(boss.role, "manager");
  const stores = await api.listStores();   // 店舗の一覧
  assert.deepEqual(stores.map((s) => s.short), ["福釜", "安城", "今村"]);
  ctx.F = stores[0].id; ctx.A = stores[1].id;
  // マップと必要人数を作る
  await api.savePositions([{ id: crypto.randomUUID(), name: "ホール1", area: "hall", x: 100, y: 100 }]);
  const [pos] = await api.listPositions();   // 作ったマーク
  await api.saveRequirements(pos.id, "weekday", [{ from: H(7), to: H(22), count: 1 }]);
  assert.equal((await api.listRequirements()).length, 1);
  // 4店舗めを、設定を写して足す
  const st = await api.createStore({ name: "刈谷店", short: "刈谷", copyFrom: ctx.F });
  await api.setCurrentStore(st.id);
  assert.equal((await api.listPositions()).length, 1);
  assert.equal((await api.listRequirements()).length, 1);
  await api.setCurrentStore(ctx.F);
  await assert.rejects(() => api.createStore({ name: "刈谷店", short: "刈2" }), /同じ名前/);
});

test("店長：店員を作ると初回コードが出て、はじめての方でログインできる", { skip }, async () => {
  const a = await api.createMember({ name: "スタッフA", kind: "baito", skills: { hall: 100, kitchen: 50, open: 0, close: 0 }, stores: [{ storeId: ctx.F, rank: 1 }] });   // 作った店員
  const b = await api.createMember({ name: "スタッフB", kind: "baito", skills: { hall: 75, kitchen: 0, open: 0, close: 0 }, stores: [{ storeId: ctx.F, rank: 1 }] });   // 作った店員
  const n = await api.createMember({ name: "スタッフN", kind: "baito", skills: { hall: 50, kitchen: 0, open: 0, close: 0 }, account: false });   // 作った店員
  assert.match(a.code, /^\d{6}$/);
  assert.equal(n.code, null);
  assert.equal(n.member.account, "none");
  ctx.a = a.member; ctx.b = b.member;
  await api.saveWage(a.member.id, 1100, 300);
  await api.saveMemberRule(a.member.id, "月曜は17時まで");
  await activate(a.member.loginId, a.code, "pass-a");
  await activate(b.member.loginId, b.code, "pass-b");
  const members = await api.listMembers();   // この店舗の店員
  assert.ok(members.some((m) => m.name === "スタッフA" && m.rankHere === 1));
});

test("店員：自分の希望を出せる。ほかの人の希望・時給・ルールは見えない", { skip }, async () => {
  await api.logout();
  await api.login(ctx.a.loginId, "pass-a");
  const dates = weekDates(nextMonday);   // 来週の日付
  await api.saveMyAvailabilities(nextMonday, [{ date: dates[0], kind: "time", from: H(9), to: H(15) }, { date: dates[1], kind: "off" }]);
  assert.equal((await api.listMyAvailabilities(dates[0], dates[6])).length, 2);
  await api.logout();
  await api.login(ctx.b.loginId, "pass-b");
  await api.saveMyAvailabilities(nextMonday, [{ date: dates[0], kind: "any" }]);
  // B から A の希望・時給・ルール・初回コードは見えない
  const { data: hopes } = await fake.client.from("availabilities").select("*");
  assert.ok(hopes.every((h) => h.member_id === ctx.b.id));
  assert.deepEqual((await fake.client.from("wages").select("*")).data, []);
  assert.deepEqual((await fake.client.from("member_rules").select("*")).data, []);
  assert.ok((await fake.client.from("login_codes").select("*")).error);
  // 店員は店舗を直せない・勤務を入れられない
  await assert.rejects(() => api.updateStore(ctx.F, { name: "x", short: "x" }), /店長/);
  const { error } = await fake.client.from("stores").update({ name: "x" }).eq("id", ctx.F).select();   // 直そうとした結果
  assert.ok(!error);   // 決まりで「直せる行がない」ので0行になる
  assert.equal((await fake.admin.sql("select name from stores where id = $1", [ctx.F])).rows[0].name, "安城福釜店");
});

test("店長：週を作って勤務を保存。公開するまで店員には見えない", { skip }, async () => {
  await api.logout();
  await api.login("1000", "boss-pass");
  const p = await api.ensurePeriod(nextMonday);   // 来週の受付
  ctx.p = p;
  const hopes = await api.listAvailabilities(p.id);   // その週の希望
  assert.equal(hopes.length, 3);                                     // A の2つ + B の1つ（店長は全員分）
  const d0 = weekDates(nextMonday)[0];   // 来週の月曜
  await api.saveAssignments(p.id, [
    { memberId: ctx.a.id, date: d0, from: H(9), to: H(15), area: "hall", breakAt: null, fixed: false },
    { memberId: ctx.b.id, date: d0, from: H(15), to: H(22), area: "hall", breakAt: H(18), fixed: false },
  ]);
  ctx.work = await api.listAssignments(p.id);
  assert.equal(ctx.work.length, 2);
  await api.saveAiDraft(p.id, ctx.work);
  // 店員からは見えない
  await api.logout();
  await api.login(ctx.a.loginId, "pass-a");
  assert.equal((await api.listAssignments(p.id)).length, 0);
  assert.equal((await api.listMyAssignments()).length, 0);
});

test("店長：時間を直して公開 → 店員に見え、お知らせが届き、AIが直し方を覚える", { skip }, async () => {
  await api.logout();
  await api.login("1000", "boss-pass");
  const changed = ctx.work.map((a) => (a.memberId === ctx.a.id ? { ...a, from: H(10) } : a));   // A を 10:00 からに直す
  await api.saveAssignments(ctx.p.id, changed);
  await api.setPeriodStatus(ctx.p.id, "published");
  await api.notifyPublished(ctx.p.id, "来週");
  assert.equal(await api.learnFromPublish(ctx.p.id), 1);
  assert.equal((await api.listLearnings())[0].kind, "time");
  // 店員から見える
  await api.logout();
  await api.login(ctx.a.loginId, "pass-a");
  const mine = await api.listMyAssignments();   // 自分の勤務
  assert.equal(mine.length, 1);
  assert.equal(mine[0].from, H(10));
  assert.ok((await api.listNotifications()).some((n) => /公開されました/.test(n.text)));
  await api.confirmPeriod(ctx.p.id);
  assert.equal((await api.listConfirms(ctx.p.id)).length, 1);
});

test("シフト交代：A が自分の勤務の交代をお願いできる（ほかの人の勤務はできない）", { skip }, async () => {
  const mine = await api.listMyAssignments();   // 自分の勤務
  await api.offerShift(mine[0].id, "用事");
  await assert.rejects(() => api.offerShift(mine[0].id, "もう一回"), /もうお願いしています/);
  const all = await api.listAssignments(ctx.p.id);   // その週の勤務全部
  const others = all.find((a) => a.memberId !== ctx.a.id);           // B の勤務
  await assert.rejects(() => api.offerShift(others.id, ""), /自分の勤務だけ/);
});

test("シフト交代：重ならない人なら代われて、店長が承認すると入れ替わる", { skip }, async () => {
  // A の勤務（10:00〜15:00）と B の勤務（15:00〜22:00）は重ならないので、B は代われる
  await api.logout();
  await api.login(ctx.b.loginId, "pass-b");
  const swaps = await api.listSwaps();   // 交代の一覧
  const open = swaps.find((x) => x.status === "open");   // 募集中の交代
  assert.ok(open, "募集中の交代が見えない");
  await api.takeSwap(open.id);
  await api.logout();
  await api.login("1000", "boss-pass");
  const waiting = (await api.listSwaps()).find((x) => x.status === "taken");   // 承認待ちの交代
  assert.equal(waiting.takerName, "スタッフB");
  await api.decideSwap(waiting.id, true);
  const work = await api.listAssignments(ctx.p.id);   // その週の勤務
  assert.equal(work.filter((a) => a.memberId === ctx.b.id).length, 2);
});

test("人が足りない時：入れそうな人に連絡 → 入れます → 店長が決めると勤務に入る", { skip }, async () => {
  const d2 = weekDates(nextMonday)[0];   // 来週の月曜
  // A は d0 の勤務を B に渡したので空いている。ホール 10:00〜14:00 が足りないことにする
  const r = await api.sendCalls(ctx.p.id, [{ date: d2, area: "hall", from: H(10), to: H(14), short: 1 }]);
  assert.equal(r.sent, 1);
  await api.logout();
  await api.login(ctx.a.loginId, "pass-a");
  const calls = await api.listCalls();   // 届いた募集
  assert.equal(calls.length, 1);
  await api.answerCall(calls[0].id, true);
  await api.logout();
  await api.login("1000", "boss-pass");
  const [call] = await api.listCalls();   // 返事が来た募集
  assert.equal(call.answers[0].name, "スタッフA");
  await api.fillCall(call.id, ctx.a.id);
  const work = await api.listAssignments(ctx.p.id);   // その週の勤務
  assert.ok(work.some((a) => a.memberId === ctx.a.id && a.createdBy === "call"));
  assert.equal((await api.listCalls()).length, 0);
});

test("バックアップ：店長は全部の表を書き出せる。初回コードは入らない", { skip }, async () => {
  const data = await api.exportAll();                                 // 書き出したもの
  assert.equal(data.kind, "supabase");
  assert.ok(data.tables.members.length >= 4);
  assert.ok(data.tables.assignments.length >= 2);
  assert.equal(data.tables.login_codes, undefined);
});

test("働き方のルール：時給と一緒に、18歳未満・月の上限・年の上限を保存できる", { skip }, async () => {
  await api.saveWage(ctx.a.id, 1100, 300, { minor: true, monthHoursMax: 60, yearYenMax: 1030000 });
  const w = (await api.listWages()).find((x) => x.memberId === ctx.a.id);   // A の時給とルール
  assert.deepEqual([w.minor, w.monthHoursMax, w.yearYenMax], [true, 60, 1030000]);
  const d0 = weekDates(nextMonday)[0];                                 // 来週の月曜
  assert.ok((await api.listAssignmentsByDates(d0, d0, [ctx.a.id])).every((a) => a.memberId === ctx.a.id));
});

test("プッシュ通知の宛先：自分のスマホの分だけ登録でき、ほかの人からは見えない", { skip }, async () => {
  await api.logout();
  await api.login(ctx.a.loginId, "pass-a");
  await api.savePushSubscription({ endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "q" } });
  assert.equal((await fake.client.from("push_subs").select("*")).data.length, 1);
  await api.logout();
  await api.login(ctx.b.loginId, "pass-b");
  assert.equal((await fake.client.from("push_subs").select("*")).data.length, 0);   // B から A の宛先は見えない
});
