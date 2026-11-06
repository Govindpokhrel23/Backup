// ============================================================
// tests/supabase.test.mjs — 本物（Supabase）用の api を、本物の Postgres で通して確かめる
// ------------------------------------------------------------
// このファイルは、supabase/schema.sql を流した Postgres（PGlite）の上で、
// 店長と店員の流れ（ログイン → 店舗 → 店員 → 希望 → シフト → 公開 → 交代 → 募集 → AIの学び）と、
// 「見てはいけないものが見えない」決まり（RLS）を確かめるテストのファイルです（2026年11月6日）。
// 動かし方：npm install（はじめの1回）→ npm test
// PGlite が入っていない時は、このテストだけ飛ばす。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import fs from "node:fs";   // ファイルを読む道具

// ブラウザの localStorage のかわり
const memory = new Map();                                             // 保存の入れ物
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };   // スマホの保存のまね

/** PGlite があるか（なければテストを飛ばす） */
let fake = null;   // にせものの Supabase
try {   // PGlite がない時に止まらないように
  const { createFakeSupabase } = await import("./helpers/fake-supabase.mjs");   // にせもの Supabase を作る関数
  fake = await createFakeSupabase();   // 作る
} catch (error) {   // 作れなかった時
  console.warn("PGlite がないので Supabase のテストを飛ばします（npm install で入ります）", error.message);   // 知らせて飛ばす
}
const skip = !fake;                                                    // 飛ばすか

const { useClient, emailOf } = await import("../js/api/supabase/core.js");   // テストする関数を読み込む
const { supabaseApi: api } = await import("../js/api/supabase-api.js");   // 本物版の窓口を読む
const { weekDates, addDays, today } = await import("../js/lib/date.js");   // テストする関数を読み込む

/** 今日から見た次の月曜（希望の締切より前の週） */
const nextMonday = (() => { let day = addDays(today(), 7); while (new Date(`${day}T00:00`).getDay() !== 1) day = addDays(day, 1); return day; })();   // 来週の月曜日
/** 時 → 分 */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする

/**
 * Worker の /activate と同じことをする（テスト用）
 * 初回コードを確かめて、ログインの人を作り、店員につなぐ
 */
async function activate(loginId, code, password) {   // 初回コードでログインできるようにする関数（Worker のかわり）
  const codeRows = await fake.admin.sql("select * from login_codes where login_id = $1 and code = $2 and not used", [loginId, code]);   // 合っている初回コード
  assert.equal(codeRows.rows.length, 1, "初回コードが合っていない");   // コードが合っているか
  const authId = await fake.admin.createUser(emailOf(loginId), password);   // 作ったログインの人のID
  await fake.admin.sql("update members set auth_id = $1, account = 'active' where login_id = $2", [authId, loginId]);   // 店員とつなぐ
  await fake.admin.sql("update login_codes set used = true where login_id = $1", [loginId]);   // コードを使用済みにする
}

/** テストの中で使う値（順に作っていく） */
const ctx = {};   // テストの間で使い回すもの

test("準備：表を作り、最初のデータ（会社・3店舗・店長）を入れる", { skip }, async () => {   // テスト：準備
  useClient(fake.client);   // にせものを使う
  const out = await fake.admin.exec(fs.readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8"));   // seed.sql を流した結果
  ctx.bossCode = out[out.length - 1].rows[0]["初回コード（7日以内に使う）"];   // 店長の初回コード
  assert.match(ctx.bossCode, /^\d{6}$/);   // 6けた
  await activate("1000", ctx.bossCode, "boss-pass");   // 店長がパスワードを決める
});

test("店長：ログインすると3店舗が見え、店舗を増やして設定を写せる", { skip }, async () => {   // テスト：店舗
  const boss = await api.login("1000", "boss-pass");   // ログインした店長
  assert.equal(boss.role, "manager");   // 店長
  const stores = await api.listStores();   // 店舗の一覧
  assert.deepEqual(stores.map((store) => store.short), ["福釜", "安城", "今村"]);   // 3店舗
  ctx.F = stores[0].id; ctx.A = stores[1].id;   // 福釜と安城のID
  // マップと必要人数を作る
  await api.savePositions([{ id: crypto.randomUUID(), name: "ホール1", area: "hall", x: 100, y: 100 }]);   // 場所を保存
  const [pos] = await api.listPositions();   // 作ったマーク
  await api.saveRequirements(pos.id, "weekday", [{ from: hoursToMin(7), to: hoursToMin(22), count: 1 }]);   // 必要人数を保存
  assert.equal((await api.listRequirements()).length, 1);   // 1つある
  // 4店舗めを、設定を写して足す
  const newStore = await api.createStore({ name: "刈谷店", short: "刈谷", copyFrom: ctx.F });   // 刈谷店を増やして写す
  await api.setCurrentStore(newStore.id);   // 刈谷店にする
  assert.equal((await api.listPositions()).length, 1);   // 場所が写っている
  assert.equal((await api.listRequirements()).length, 1);   // 必要人数が写っている
  await api.setCurrentStore(ctx.F);   // 福釜にもどす
  await assert.rejects(() => api.createStore({ name: "刈谷店", short: "刈2" }), /同じ名前/);   // 同じ名前はだめ
});

test("店長：店員を作ると初回コードが出て、はじめての方でログインできる", { skip }, async () => {   // テスト：店員
  const createdA = await api.createMember({ name: "スタッフA", kind: "baito", skills: { hall: 100, kitchen: 50, open: 0, close: 0 }, stores: [{ storeId: ctx.F, rank: 1 }] });   // 作った店員
  const createdB = await api.createMember({ name: "スタッフB", kind: "baito", skills: { hall: 75, kitchen: 0, open: 0, close: 0 }, stores: [{ storeId: ctx.F, rank: 1 }] });   // 作った店員
  const createdN = await api.createMember({ name: "スタッフN", kind: "baito", skills: { hall: 50, kitchen: 0, open: 0, close: 0 }, account: false });   // 作った店員
  assert.match(createdA.code, /^\d{6}$/);   // 初回コードが出る
  assert.equal(createdN.code, null);   // アカウントなしは出ない
  assert.equal(createdN.member.account, "none");   // まだアカウントなし
  ctx.a = createdA.member; ctx.b = createdB.member;   // AとB
  await api.saveWage(createdA.member.id, 1100, 300);   // Aの時給
  await api.saveMemberRule(createdA.member.id, "月曜は17時まで");   // Aのメモ
  await activate(createdA.member.loginId, createdA.code, "pass-a");   // Aがパスワードを決める
  await activate(createdB.member.loginId, createdB.code, "pass-b");   // Bがパスワードを決める
  const members = await api.listMembers();   // この店舗の店員
  assert.ok(members.some((member) => member.name === "スタッフA" && member.rankHere === 1));   // Aは福釜の所属
});

test("店員：自分の希望を出せる。ほかの人の希望・時給・ルールは見えない", { skip }, async () => {   // テスト：店員にできること
  await api.logout();   // ログアウト
  await api.login(ctx.a.loginId, "pass-a");   // Aでログイン
  const dates = weekDates(nextMonday);   // 来週の日付
  await api.saveMyAvailabilities(nextMonday, [{ date: dates[0], kind: "time", from: hoursToMin(9), to: hoursToMin(15) }, { date: dates[1], kind: "off" }]);   // 希望を出す
  assert.equal((await api.listMyAvailabilities(dates[0], dates[6])).length, 2);   // 2つ保存された
  await api.logout();   // ログアウト
  await api.login(ctx.b.loginId, "pass-b");   // Bでログイン
  await api.saveMyAvailabilities(nextMonday, [{ date: dates[0], kind: "any" }]);   // 希望を出す
  // B から A の希望・時給・ルール・初回コードは見えない
  const { data: hopes } = await fake.client.from("availabilities").select("*");   // 直接読むと
  assert.ok(hopes.every((hope) => hope.member_id === ctx.b.id));   // 自分の分だけ見える
  assert.deepEqual((await fake.client.from("wages").select("*")).data, []);   // 時給は見えない
  assert.deepEqual((await fake.client.from("member_rules").select("*")).data, []);   // メモは見えない
  assert.ok((await fake.client.from("login_codes").select("*")).error);   // 初回コードは読めない
  // 店員は店舗を直せない・勤務を入れられない
  await assert.rejects(() => api.updateStore(ctx.F, { name: "x", short: "x" }), /店長/);   // 店舗の名前は変えられない
  const { error } = await fake.client.from("stores").update({ name: "x" }).eq("id", ctx.F).select();   // 直そうとした結果
  assert.ok(!error);   // 決まりで「直せる行がない」ので0行になる
  assert.equal((await fake.admin.sql("select name from stores where id = $1", [ctx.F])).rows[0].name, "安城福釜店");   // 名前は変わっていない
});

test("店長：週を作って勤務を保存。公開するまで店員には見えない", { skip }, async () => {   // テスト：公開前
  await api.logout();   // ログアウト
  await api.login("1000", "boss-pass");   // 店長でログイン
  const period = await api.ensurePeriod(nextMonday);   // 来週の受付
  ctx.p = period;   // 週
  const hopes = await api.listAvailabilities(period.id);   // その週の希望
  assert.equal(hopes.length, 3);                                     // A の2つ + B の1つ（店長は全員分）
  const d0 = weekDates(nextMonday)[0];   // 来週の月曜
  await api.saveAssignments(period.id, [   // 勤務を保存
    { memberId: ctx.a.id, date: d0, from: hoursToMin(9), to: hoursToMin(15), area: "hall", breakAt: null, fixed: false },   // A
    { memberId: ctx.b.id, date: d0, from: hoursToMin(15), to: hoursToMin(22), area: "hall", breakAt: hoursToMin(18), fixed: false },   // B
  ]);
  ctx.work = await api.listAssignments(period.id);   // 読む
  assert.equal(ctx.work.length, 2);   // 2つ
  await api.saveAiDraft(period.id, ctx.work);   // AIの下書きとして保存
  // 店員からは見えない
  await api.logout();   // ログアウト
  await api.login(ctx.a.loginId, "pass-a");   // Aでログイン
  assert.equal((await api.listAssignments(period.id)).length, 0);   // 公開前なので見えない
  assert.equal((await api.listMyAssignments()).length, 0);   // 自分の分も見えない
});

test("店長：時間を直して公開 → 店員に見え、お知らせが届き、AIが直し方を覚える", { skip }, async () => {   // テスト：公開
  await api.logout();   // ログアウト
  await api.login("1000", "boss-pass");   // 店長でログイン
  const changed = ctx.work.map((shift) => (shift.memberId === ctx.a.id ? { ...shift, from: hoursToMin(10) } : shift));   // A を 10:00 からに直す
  await api.saveAssignments(ctx.p.id, changed);   // 時間を直して保存
  await api.setPeriodStatus(ctx.p.id, "published");   // 公開
  await api.notifyPublished(ctx.p.id, "来週");   // 知らせる
  assert.equal(await api.learnFromPublish(ctx.p.id), 1);   // 1つ覚えた
  assert.equal((await api.listLearnings())[0].kind, "time");   // 時間の直し
  // 店員から見える
  await api.logout();   // ログアウト
  await api.login(ctx.a.loginId, "pass-a");   // Aでログイン
  const mine = await api.listMyAssignments();   // 自分の勤務
  assert.equal(mine.length, 1);   // 1つ見える
  assert.equal(mine[0].from, hoursToMin(10));   // 直した10時
  assert.ok((await api.listNotifications()).some((note) => /公開されました/.test(note.text)));   // お知らせが届いた
  await api.confirmPeriod(ctx.p.id);   // 見ました
  assert.equal((await api.listConfirms(ctx.p.id)).length, 1);   // 記録された
});

test("シフト交代：A が自分の勤務の交代をお願いできる（ほかの人の勤務はできない）", { skip }, async () => {   // テスト：交代のお願い
  const mine = await api.listMyAssignments();   // 自分の勤務
  await api.offerShift(mine[0].id, "用事");   // お願いする
  await assert.rejects(() => api.offerShift(mine[0].id, "もう一回"), /もうお願いしています/);   // 2回目はだめ
  const all = await api.listAssignments(ctx.p.id);   // その週の勤務全部
  const others = all.find((shift) => shift.memberId !== ctx.a.id);           // B の勤務
  await assert.rejects(() => api.offerShift(others.id, ""), /自分の勤務だけ/);   // ほかの人の勤務はだめ
});

test("シフト交代：重ならない人なら代われて、店長が承認すると入れ替わる", { skip }, async () => {   // テスト：交代
  // A の勤務（10:00〜15:00）と B の勤務（15:00〜22:00）は重ならないので、B は代われる
  await api.logout();   // ログアウト
  await api.login(ctx.b.loginId, "pass-b");   // Bでログイン
  const swaps = await api.listSwaps();   // 交代の一覧
  const open = swaps.find((swap) => swap.status === "open");   // 募集中の交代
  assert.ok(open, "募集中の交代が見えない");   // 見える
  await api.takeSwap(open.id);   // 引き受ける
  await api.logout();   // ログアウト
  await api.login("1000", "boss-pass");   // 店長でログイン
  const waiting = (await api.listSwaps()).find((swap) => swap.status === "taken");   // 承認待ちの交代
  assert.equal(waiting.takerName, "スタッフB");   // Bが代わる
  await api.decideSwap(waiting.id, true);   // 承認
  const work = await api.listAssignments(ctx.p.id);   // その週の勤務
  assert.equal(work.filter((shift) => shift.memberId === ctx.b.id).length, 2);   // Bの勤務が2つになった
});

test("人が足りない時：入れそうな人に連絡 → 入れます → 店長が決めると勤務に入る", { skip }, async () => {   // テスト：人が足りない時
  const d2 = weekDates(nextMonday)[0];   // 来週の月曜
  // A は d0 の勤務を B に渡したので空いている。ホール 10:00〜14:00 が足りないことにする
  const result = await api.sendCalls(ctx.p.id, [{ date: d2, area: "hall", from: hoursToMin(10), to: hoursToMin(14), short: 1 }]);   // 連絡
  assert.equal(result.sent, 1);   // 1つ送った
  await api.logout();   // ログアウト
  await api.login(ctx.a.loginId, "pass-a");   // Aでログイン
  const calls = await api.listCalls();   // 届いた募集
  assert.equal(calls.length, 1);   // 1つ来ている
  await api.answerCall(calls[0].id, true);   // 入れます
  await api.logout();   // ログアウト
  await api.login("1000", "boss-pass");   // 店長でログイン
  const [call] = await api.listCalls();   // 返事が来た募集
  assert.equal(call.answers[0].name, "スタッフA");   // Aの返事
  await api.fillCall(call.id, ctx.a.id);   // Aに決める
  const work = await api.listAssignments(ctx.p.id);   // その週の勤務
  assert.ok(work.some((shift) => shift.memberId === ctx.a.id && shift.createdBy === "call"));   // 勤務に入った
  assert.equal((await api.listCalls()).length, 0);   // 募集は終わった
});

test("バックアップ：店長は全部の表を書き出せる。初回コードは入らない", { skip }, async () => {   // テスト：バックアップ
  const data = await api.exportAll();                                 // 書き出したもの
  assert.equal(data.kind, "supabase");   // 本物版
  assert.ok(data.tables.members.length >= 4);   // 店員がある
  assert.ok(data.tables.assignments.length >= 2);   // 勤務がある
  assert.equal(data.tables.login_codes, undefined);   // 初回コードは入らない
});

test("働き方のルール：時給と一緒に、18歳未満・月の上限・年の上限を保存できる", { skip }, async () => {   // テスト：働き方のルール
  await api.saveWage(ctx.a.id, 1100, 300, { minor: true, monthHoursMax: 60, yearYenMax: 1030000 });   // 保存
  const wage = (await api.listWages()).find((eachWage) => eachWage.memberId === ctx.a.id);   // A の時給とルール
  assert.deepEqual([wage.minor, wage.monthHoursMax, wage.yearYenMax], [true, 60, 1030000]);   // 保存した値
  const d0 = weekDates(nextMonday)[0];                                 // 来週の月曜
  assert.ok((await api.listAssignmentsByDates(d0, d0, [ctx.a.id])).every((shift) => shift.memberId === ctx.a.id));   // 日付と人でしぼって読める
});

test("プッシュ通知の宛先：自分のスマホの分だけ登録でき、ほかの人からは見えない", { skip }, async () => {   // テスト：通知の宛先
  await api.logout();   // ログアウト
  await api.login(ctx.a.loginId, "pass-a");   // Aでログイン
  await api.savePushSubscription({ endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "q" } });   // 宛先を保存
  assert.equal((await fake.client.from("push_subs").select("*")).data.length, 1);   // 1つ見える
  await api.logout();   // ログアウト
  await api.login(ctx.b.loginId, "pass-b");   // Bでログイン
  assert.equal((await fake.client.from("push_subs").select("*")).data.length, 0);   // B から A の宛先は見えない
});
