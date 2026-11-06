// ============================================================
// tests/worker.test.mjs — Cloudflare Worker（workers/api/worker.js）のテスト
// ------------------------------------------------------------
// このファイルは、はじめての方（/activate）と AI（/ai）が、
// 正しい時だけ通り、まちがった時は止まるかを、にせものの Supabase・Gemini で確かめるテストのファイルです（2026年11月6日）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/api/worker.js";

/** Cloudflare に入れる値（テスト用） */
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "service", GEMINI_API_KEY: "gem", ALLOWED_ORIGIN: "https://app.example", LOGIN_EMAIL_DOMAIN: "login.test" };

/**
 * にせものの Supabase・Gemini
 * @param {object} state 表の中身 {code, member, role}
 * @returns {{fetch:Function, calls:object[]}} calls＝送られたお願いの記録
 */
function fakeServer(state) {
  const calls = [];                                                   // 送られたお願い
  /** にせものの返事を作る */
  const ok = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
      if (url.includes("/rest/v1/login_codes") && (init.method || "GET") === "GET") return ok(state.code ? [state.code] : []);
      if (url.includes("/rest/v1/members?login_id")) return ok(state.member ? [state.member] : []);
      if (url.includes("/rest/v1/members?auth_id")) return ok([{ role: state.role, active: true }]);
      if (url.includes("/rest/v1/")) return ok(null, 204);
      if (url.endsWith("/auth/v1/admin/users")) return ok({ id: "new-auth-id" });
      if (url.includes("/auth/v1/admin/users/")) return ok({ id: "old" });
      if (url.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer good" ? ok({ id: "u1" }) : ok({}, 401);
      if (url.includes("generativelanguage")) return ok({ candidates: [] });
      return ok({}, 404);
    },
  };
}

/** アプリからのお願いを作る */
const req = (path, body, headers = {}) => new Request(`https://api.example${path}`, {
  method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

/** 今の日時（初回コードを出した時） */
const now = new Date().toISOString();

test("はじめての方：コードが合えばログインの人を作り、コードを使用済みにする", async () => {
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 0, created_at: now }, member: { id: "m1", auth_id: null, active: true } });   // にせものの Supabase・Gemini
  const res = await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdef" }), env, { fetch: server.fetch });   // Worker の返事
  assert.equal(res.status, 200);
  const created = server.calls.find((call) => call.url.endsWith("/auth/v1/admin/users"));   // ログインの人を作ったお願い
  assert.equal(created.body.email, "2004@login.test");
  assert.ok(server.calls.some((call) => call.method === "PATCH" && call.body.used === true));
});

test("はじめての方：コードがちがうと止まり、まちがえた回数が増える。5回で使えなくなる", async () => {
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 2, created_at: now }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  const res = await worker.fetch(req("/activate", { loginId: "2004", code: "000000", password: "abcdef" }), env, { fetch: server.fetch });   // Worker の返事
  assert.equal(res.status, 400);
  assert.ok(server.calls.some((call) => call.method === "PATCH" && call.body.attempts === 3));
  const locked = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 5, created_at: now }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  const res2 = await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdef" }), env, { fetch: locked.fetch });   // Worker の返事
  assert.equal(res2.status, 429);
});

test("はじめての方：期限切れのコード・ほかのサイトからのお願いは止まる", async () => {
  const old = new Date(Date.now() - 8 * 86400000).toISOString();   // 8日前（期限切れ）
  const server = fakeServer({ code: { login_id: "2004", code: "123456", used: false, attempts: 0, created_at: old }, member: { id: "m1", active: true } });   // にせものの Supabase・Gemini
  assert.equal((await worker.fetch(req("/activate", { loginId: "2004", code: "123456", password: "abcdef" }), env, { fetch: server.fetch })).status, 400);
  const evil = req("/activate", { loginId: "2004", code: "123456", password: "abcdef" }, { Origin: "https://evil.example" });
  assert.equal((await worker.fetch(evil, env, { fetch: server.fetch })).status, 403);
});

test("AI：ログインした店長だけ Gemini に送れる（鍵は Worker が足す）", async () => {
  const boss = fakeServer({ role: "manager" });   // にせものの Supabase・Gemini
  const ok = await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: { contents: [] } }, { Authorization: "Bearer good" }), env, { fetch: boss.fetch });   // Worker の返事
  assert.equal(ok.status, 200);
  assert.ok(boss.calls.some((call) => call.url.includes("generativelanguage")));
  const staff = fakeServer({ role: "staff" });   // にせものの Supabase・Gemini
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: {} }, { Authorization: "Bearer good" }), env, { fetch: staff.fetch })).status, 403);
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-3-flash-preview", body: {} }, { Authorization: "Bearer bad" }), env, { fetch: boss.fetch })).status, 401);
  assert.equal((await worker.fetch(req("/ai", { model: "gemini-ultra", body: {} }, { Authorization: "Bearer good" }), env, { fetch: boss.fetch })).status, 404);
});
