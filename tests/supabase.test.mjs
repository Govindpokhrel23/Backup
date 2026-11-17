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

test("セキュリティ：店員はほかの店員にお知らせを送れない（店長には送れる）。締め切った週の希望は変えられない（2026年11月16日）", { skip }, async () => {   // テスト：セキュリティ
  const { notify } = await import("../js/api/supabase/core.js");   // お知らせを送る道具
  await assert.rejects(() => notify([ctx.b.id], "にせのお知らせ"), "店員が店員に送れてしまう");   // A（店員）→ B（店員）はだめ
  const { companyMembers } = await import("../js/api/supabase/core.js");   // 会社の店員を読む道具
  const boss = (await companyMembers()).find((member) => member.role === "manager");   // 店長
  await notify([boss.id], "店長へのれんらく");   // 店長あてはOK
  const weekStart = ctx.p.weekStart;   // 公開した週（受付が終わっている）
  await assert.rejects(() => api.saveMyAvailabilities(weekStart, [{ date: weekStart, kind: "any" }]), "公開した週の希望を変えられてしまう");   // 変えられない
  // アプリを通さず、データベースに直接書いても止まる（見張りの関数）
  const { supabaseClient } = await import("../js/api/supabase/core.js");   // Supabase の道具
  const client = await supabaseClient();   // 道具
  const direct = await client.from("availabilities").insert({ member_id: ctx.a.id, date: weekStart, kind: "any" });   // 直接書く
  assert.ok(direct.error && /受付が終わっています|締切/.test(direct.error.message), `直接書けてしまう：${JSON.stringify(direct.error)}`);   // 止まった
});

test("出られない時：店長がシフトを直して、A の勤務を B に入れかえる", { skip }, async () => {   // テスト：店長が直す（交代の機能のかわり）
  await api.logout();   // ログアウト
  await api.login("1000", "boss-pass");   // 店長でログイン
  const work = await api.listAssignments(ctx.p.id);   // その週の勤務
  const next = work.map((shift) => (shift.memberId === ctx.a.id ? { ...shift, memberId: ctx.b.id } : shift));   // A の分を B に
  await api.saveAssignments(ctx.p.id, next);   // 保存
  const after = await api.listAssignments(ctx.p.id);   // 直したあと
  assert.equal(after.filter((shift) => shift.memberId === ctx.b.id).length, 2);   // Bの勤務が2つになった
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

test("セキュリティ：ログインしていない人は、表も関数も使えない（2026年11月17日）", { skip }, async () => {   // テスト：ログイン前
  await api.logout().catch(() => {});   // ログアウトした状態にする
  for (const table of ["members", "assignments", "availabilities", "wages", "member_rules", "notifications", "login_codes", "stores"]) {   // 大事な表
    const res = await fake.client.from(table).select("*");   // 読んでみる
    assert.ok(res.error && /permission denied/.test(res.error.message), `${table} が読めてしまう：${JSON.stringify(res)}`);   // ことわられる
  }
  const ins = await fake.client.from("members").insert({ id: "x", name: "x" });   // 書いてみる
  assert.ok(ins.error, "ログイン前に書けてしまう");   // ことわられる
  for (const [fn, args] of [["issue_login_code", { p_member_id: "m1" }], ["answer_call", { p_call_id: "c", p_yes: true }], ["i_am_manager", {}], ["my_company", {}]]) {   // 関数
    const res = await fake.client.rpc(fn, args);   // 呼んでみる
    assert.ok(res.error && /permission denied/.test(res.error.message), `${fn} を呼べてしまう：${JSON.stringify(res)}`);   // ことわられる
  }
});

test("セキュリティ：店員は、店長の操作（初回コード・時給）を関数や表から直接できない", { skip }, async () => {   // テスト：店長の権限はサーバーで決まる
  await api.login(ctx.a.loginId, "pass-a");   // 店員Aでログイン
  const code = await fake.client.rpc("issue_login_code", { p_member_id: ctx.b.id });   // ほかの人の初回コードを出そうとする
  assert.ok(code.error && /店長だけ/.test(code.error.message), "店員が初回コードを出せてしまう");   // ことわられる
  const wage = await fake.client.from("wages").upsert({ company_id: ctx.a.companyId || "c1", member_id: ctx.a.id, hourly: 9999 }, { onConflict: "member_id" });   // 自分の時給を書こうとする
  assert.ok(wage.error && /row-level security|permission/.test(wage.error.message), `店員が時給を書けてしまう：${JSON.stringify(wage.error)}`);   // ことわられる（決まり RLS で）
  const promote = await fake.client.from("members").update({ role: "manager" }).eq("id", ctx.a.id).select();   // 自分を店長にしようとする
  assert.ok(promote.error || (promote.data || []).length === 0, "店員が自分を店長にできてしまう");   // 変わらない
  const me = (await fake.admin.sql("select role from members where id = $1", [ctx.a.id])).rows[0];   // データベースの中身
  assert.notEqual(me.role, "manager");   // 店長になっていない
  await api.logout();   // ログアウト
});
