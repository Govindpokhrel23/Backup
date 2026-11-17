// ============================================================
// tests/worker.test.mjs — Cloudflare Worker（workers/api/worker.js）のテスト
// ------------------------------------------------------------
// このファイルは、はじめての方（/activate）と AI（/ai）が、
// 正しい時だけ通り、まちがった時は止まるかを、にせものの Supabase・Gemini で確かめるテストのファイルです（2026年11月6日）。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import worker from "../workers/api/worker.js";   // テストする Worker を読む

/** Cloudflare に入れる値（テスト用） */
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "service", GEMINI_API_KEY: "gem", ALLOWED_ORIGIN: "https://app.example", LOGIN_EMAIL_DOMAIN: "login.test" };   // テスト用の設定（にせものの鍵）

/**
 * にせものの Supabase・Gemini
 * @param {object} state 表の中身 {code, member, role}
 * @returns {{fetch:Function, calls:object[]}} calls＝送られたお願いの記録
 */
function fakeServer(state) {   // にせもののサーバーを作る関数
  const calls = [];                                                   // 送られたお願い
  /** にせものの返事を作る */
  const ok = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });   // にせものの返事を作る
  return {   // 使うものを返す
    calls,   // 送られたお願いの記録
    fetch: async (url, init = {}) => {   // にせものの通信
      calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });   // 送られたお願いを記録する
      if (url.includes("/rest/v1/login_codes") && (init.method || "GET") === "GET") return ok(state.code ? [state.code] : []);   // 初回コードを読む時
      if (url.includes("/rest/v1/login_codes") && init.method === "PATCH" && state.code) {   // 初回コードを変える時（本物の Supabase のように、条件に合う時だけ変える）
        const query = new URL(url).searchParams;   // 条件
        const fits = [...query.entries()].every(([key, value]) => key === "login_id" || String(state.code[key]) === value.replace(/^eq\./, ""));   // 条件に合うか
        if (!fits) return ok([]);   // 合わなければ何も変えない
        Object.assign(state.code, JSON.parse(init.body));   // 変える
        return ok([{ ...state.code }]);   // 変えた行
      }
      if (url.includes("/rest/v1/members?login_id")) return ok(state.member ? [state.member] : []);   // ログインIDで店員を読む時
      if (url.includes("/rest/v1/members?auth_id")) return ok([{ role: state.role, active: true }]);   // ログインした人で店員を読む時
      if (url.includes("/rest/v1/")) return ok(null, 204);   // それ以外の表の操作はOK
      if (url.endsWith("/auth/v1/admin/users")) return ok({ id: "new-auth-id" });   // ログインの人を作る時
      if (url.includes("/auth/v1/admin/users/")) return ok({ id: "old" });   // パスワードを変える時
      if (url.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer good" ? ok({ id: "u1" }) : ok({}, 401);   // トークンが good ならログイン中
      if (url.includes("generativelanguage")) return ok({ candidates: [] });   // Gemini への送信
      return ok({}, 404);   // それ以外は「ない」
    },
  };
}

/** アプリからのお願いを作る */
const req = (path, body, headers = {}) => new Request(`https://api.example${path}`, {   // Worker へのお願いを作る
  method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),   // 送る方法・ヘッダー・中身
});

/** 今の日時（初回コードを出した時） */
const now = new Date().toISOString();   // 今の時間

test("はじめての方：コードが合えばログインの人を作り、コードを使用済みにする", async () => {   // テスト：正しいコード
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 0, created_at: now }, member: { id: "m1", auth_id: null, active: true } });   // にせものの Supabase・Gemini
  const res = await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdefgh" }), env, { fetch: server.fetch });   // Worker の返事
  assert.equal(res.status, 200);   // 成功
  const created = server.calls.find((call) => call.url.endsWith("/auth/v1/admin/users"));   // ログインの人を作ったお願い
  assert.equal(created.body.email, "2004@login.test");   // ID がメールの形になっている
  assert.ok(server.calls.some((call) => call.method === "PATCH" && call.body.used === true));   // コードが使用済みになった
});

test("はじめての方：コードがちがうと止まり、まちがえた回数が増える。5回で使えなくなる", async () => {   // テスト：まちがったコード
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 2, created_at: now }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  const res = await worker.fetch(req("/activate", { loginId: "2004", code: "000000", password: "abcdefgh" }), env, { fetch: server.fetch });   // Worker の返事
  assert.equal(res.status, 400);   // 失敗
  assert.ok(server.calls.some((call) => call.method === "PATCH" && call.body.attempts === 3));   // まちがえた回数が増えた
  const locked = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 5, created_at: now }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  const res2 = await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdefgh" }), env, { fetch: locked.fetch });   // Worker の返事
  assert.equal(res2.status, 429);   // 5回で使えない
});

test("はじめての方：期限切れのコード・ほかのサイトからのお願いは止まる", async () => {   // テスト：期限切れ・ほかのサイト
  const old = new Date(Date.now() - 8 * 86400000).toISOString();   // 8日前（期限切れ）
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 0, created_at: old }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  assert.equal((await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdefgh" }), env, { fetch: server.fetch })).status, 400);   // 期限切れは失敗
  const evil = req("/activate", { loginId: "2004", code: "123456", password: "abcdefgh" }, { Origin: "https://evil.example" });   // ほかのサイトからのお願い
  assert.equal((await worker.fetch(evil, env, { fetch: server.fetch })).status, 403);   // ことわる
});

test("AI：ログインした店長だけ Gemini に送れる（鍵は Worker が足す）", async () => {   // テスト：AI
  const boss = fakeServer({ role: "manager" });   // にせものの Supabase・Gemini
  const ok = await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: { contents: [] } }, { Authorization: "Bearer good" }), env, { fetch: boss.fetch });   // Worker の返事
  assert.equal(ok.status, 200);   // 店長は成功
  assert.ok(boss.calls.some((call) => call.url.includes("generativelanguage")));   // Gemini に送られた
  const staff = fakeServer({ role: "staff" });   // にせものの Supabase・Gemini
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: {} }, { Authorization: "Bearer good" }), env, { fetch: staff.fetch })).status, 403);   // 店員はことわる
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: {} }, { Authorization: "Bearer bad" }), env, { fetch: boss.fetch })).status, 401);   // ログインしていない人はことわる
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-ultra", body: {} }, { Authorization: "Bearer good" }), env, { fetch: boss.fetch })).status, 404);   // 許していないモデルはことわる
});

test("/vapid：通知の鍵の公開してよい方だけを返す（秘密の方は返さない）", async () => {   // テスト：通知の鍵（2026年11月15日）
  const env2 = { VAPID_PUBLIC_KEY: "PUBKEY", VAPID_PRIVATE_JWK: "{\"d\":\"SECRET\"}" };   // 鍵が入っている Worker
  const res = await worker.fetch(new Request("https://api.example/vapid"), env2);   // GET で聞く
  assert.equal(res.status, 200);   // 成功
  const text = await res.text();   // 返事の文字
  assert.deepEqual(JSON.parse(text), { publicKey: "PUBKEY" });   // 公開してよい方だけ
  assert.ok(!text.includes("SECRET"));   // 秘密の方は入っていない
  const empty = await worker.fetch(new Request("https://api.example/vapid"), {});   // 鍵がない Worker
  assert.deepEqual(await empty.json(), { publicKey: "" });   // 空で返す
});

test("/push：店員は店長あてにしか送れない・変なIDは捨てる（2026年11月16日）", async () => {   // テスト：通知の宛先をしぼる
  const asked = [];   // Worker が Supabase に聞いた住所
  const fakeFetch = async (url) => {   // にせものの Supabase
    asked.push(String(url));   // 記録
    if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });   // ログインの人
    if (String(url).includes("members?auth_id")) return new Response(JSON.stringify([{ id: "m1", role: "staff", active: true, company_id: "c1" }]), { status: 200 });   // 店員
    return new Response("[]", { status: 200 });   // ほかは空
  };
  const env2 = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "sb_secret_x", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_JWK: "{}" };   // Worker の値
  const request = new Request("https://api.example/push", { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify({ memberIds: ["m2", "bad\"),id.neq.(x"], text: "にせのお知らせ" }) });   // 店員から
  await worker.fetch(request, env2, { fetch: fakeFetch });   // 送る
  const query = decodeURIComponent(asked.find((url) => url.includes("members?id=in.")) || "");   // 宛先をしぼる問い合わせ
  assert.ok(query.includes("role=eq.manager"), "店員なのに店長以外にも送れる");   // 店長だけ
  assert.ok(!query.includes("bad"), "変なIDが入っている");   // 変なIDは捨てた
});

test("はじめての方：同じ正しいコードを同時に2回送っても、通るのは1回だけ（2026年11月17日）", async () => {   // テスト：同時に使う
  const state = { code: { login_id: "2004", code: "123456", used: false, attempts: 0, created_at: now }, member: { id: "m1", active: true } };   // 1つのデータベース
  const server = fakeServer(state);   // にせものの Supabase
  const send = () => worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdefgh" }, { "CF-Connecting-IP": "10.0.0.9" }), env, { fetch: server.fetch });   // 送る
  const results = await Promise.all([send(), send()]);   // 同時に2回
  assert.equal(results.filter((res) => res.status === 200).length, 1, "2回とも通ってしまった");   // 通るのは1回だけ
  assert.equal(state.code.used, true);   // 使用済み
});

test("はじめての方：同じ場所から1分に10回をこえると止まる・予想外のエラーは中身を見せない（2026年11月17日）", async () => {   // テスト：回数の制限・エラー
  const server = fakeServer({ code: null, member: null });   // コードがない
  let last;   // 最後の返事
  for (let index = 0; index < 11; index++) last = await worker.fetch(req("/activate", { loginId: "2004", code: "000000", password: "abcdefgh" }, { "CF-Connecting-IP": "10.0.0.77" }), env, { fetch: server.fetch });   // 11回送る
  assert.equal(last.status, 429);   // 11回目は止まる
  const broken = async () => { throw new TypeError("secret internal detail"); };   // こわれた通信
  const res = await worker.fetch(req("/activate", { loginId: "2004", code: "000000", password: "abcdefgh" }, { "CF-Connecting-IP": "10.0.0.78" }), env, { fetch: broken });   // 送る
  assert.equal(res.status, 500);   // エラー
  assert.ok(!(await res.text()).includes("secret internal detail"), "中の文が見えている");   // 中身は見せない
});
