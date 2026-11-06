// ============================================================
// workers/api/worker.js — アプリのサーバー（Cloudflare Worker）
// ------------------------------------------------------------
// このファイルは、アプリ（スマホ）ではできない「管理用の鍵が必要なこと」をする
// 小さなサーバーのファイルです（2026年11月6日）。Cloudflare Workers で動かす。
//
// 2つの入口：
//   POST /activate … はじめての方：ID と初回コードを確かめて、Supabase にログインの人を作る
//                    （パスワードを忘れた人も同じ。店長が新しい初回コードを出す）
//   POST /ai       … Gemini を呼ぶ（Gemini の鍵はここにだけ置く）。店長だけ使える
//
// Cloudflare に入れる値（Settings → Variables and Secrets）：
//   SUPABASE_URL          … Supabase の Project URL
//   SUPABASE_SERVICE_KEY  … Supabase の Secret key（sb_secret_…。古い画面では service_role key）。秘密！アプリには絶対に入れない
//   GEMINI_API_KEY        … Google AI Studio の鍵（秘密）
//   ALLOWED_ORIGIN        … アプリのURL（例 https://shiftapp.pages.dev）
//   LOGIN_EMAIL_DOMAIN    … アプリの config.js と同じ（login.shiftapp.example.com）
// ============================================================

/** 初回コードを何日使えるか */
const CODE_DAYS = 7;
/** 初回コードを何回まちがえたら使えなくするか（総当たりを防ぐ） */
const CODE_TRIES = 5;
/** パスワードの一番短い長さ（アプリと同じ） */
const PASSWORD_MIN = 6;
/** 使ってよい Gemini のモデル（ほかの高いモデルを使われないように） */
const ALLOWED_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
/** Google の Gemini API の住所 */
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  /**
   * アプリから届いたお願いを受ける
   * @param {Request} request アプリからのお願い
   * @param {object} env      Cloudflare に入れた値
   * @param {object} [deps]   テストの時に、にせものの fetch を入れる
   */
  async fetch(request, env, deps = {}) {
    const http = deps.fetch || fetch;                                 // 外へのお願いに使う fetch
    const origin = request.headers.get("Origin") || "";               // どのサイトから来たか
    const cors = corsHeaders(origin, env);                            // ブラウザに返す許可の印
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST だけ受け付けます" }, 405, cors);
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return json({ error: "このサイトからは使えません" }, 403, cors);

    const path = new URL(request.url).pathname.replace(/\/+$/, "");  // 入口（/activate・/ai）
    let body;                                                         // 送られてきた中身
    try { body = await request.json(); } catch { return json({ error: "中身の形がちがいます" }, 400, cors); }

    try {
      if (path.endsWith("/activate")) return json(await activate(body, env, http), 200, cors);
      if (path.endsWith("/ai")) return await ai(body, request, env, http, cors);
      return json({ error: "この住所はありません" }, 404, cors);
    } catch (e) {
      return json({ error: e.message }, e.status || 500, cors);
    }
  },
};

// ------------------------------------------------------------
// はじめての方（/activate）
// ------------------------------------------------------------

/**
 * ID と初回コードを確かめて、パスワードを決める
 * @param {{loginId:string, code:string, password:string}} body
 */
async function activate({ loginId, code, password }, env, http) {
  const id = String(loginId || "").trim();                            // ログインID
  if (!/^\d{3,8}$/.test(id) || !/^\d{6}$/.test(String(code || ""))) throw fail("IDか初回コードが違います", 400);
  if (!password || password.length < PASSWORD_MIN) throw fail(`パスワードは${PASSWORD_MIN}文字以上にしてください`, 400);
  const db = rest(env, http);                                         // Supabase の表を使う道具

  // ① 初回コード
  const [row] = await db.get(`login_codes?login_id=eq.${id}&select=*`);   // その人の初回コード
  if (!row || row.used) throw fail("IDか初回コードが違います", 400);
  if (row.attempts >= CODE_TRIES) throw fail("まちがいが多すぎます。店長に新しい初回コードをもらってください", 429);
  if (Date.now() - new Date(row.created_at).getTime() > CODE_DAYS * 86400000) throw fail("初回コードの期限が切れています。店長に新しいコードをもらってください", 400);
  if (row.code !== String(code)) {
    await db.patch(`login_codes?login_id=eq.${id}`, { attempts: row.attempts + 1 });
    throw fail("IDか初回コードが違います", 400);
  }

  // ② 店員
  const [member] = await db.get(`members?login_id=eq.${id}&select=id,auth_id,active`);   // その店員
  if (!member || !member.active) throw fail("このIDは今は使えません（店長に聞いてください）", 400);

  // ③ ログインの人を作る（もういればパスワードを変える）
  const email = `${id}@${env.LOGIN_EMAIL_DOMAIN || "login.shiftapp.example.com"}`;      // ログイン用のメールの形
  if (member.auth_id) {
    await db.auth(`admin/users/${member.auth_id}`, "PUT", { password });
  } else {
    const user = await db.auth("admin/users", "POST", { email, password, email_confirm: true });   // 作ったログインの人
    await db.patch(`members?id=eq.${member.id}`, { auth_id: user.id });
  }
  await db.patch(`members?id=eq.${member.id}`, { account: "active" });
  await db.patch(`login_codes?login_id=eq.${id}`, { used: true });
  return { ok: true };
}

// ------------------------------------------------------------
// AI（/ai）
// ------------------------------------------------------------

/**
 * Gemini を呼ぶ。ログイン中の店長だけ
 * @param {{model:string, body:object}} payload  アプリが作った Gemini への中身
 */
async function ai(payload, request, env, http, cors) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");   // アプリのログインの印
  if (!token) throw fail("ログインしてください", 401);
  // ① ログインの印から、だれかを調べる
  const userRes = await http(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw fail("ログインが切れました。もう一度ログインしてください", 401);
  const user = await userRes.json();                                 // ログインの人
  // ② 店長か確かめる
  const [member] = await rest(env, http).get(`members?auth_id=eq.${user.id}&select=role,active`);
  if (!member || !member.active || member.role !== "manager") throw fail("店長だけが使えます", 403);
  // ③ 中身を確かめる
  if (!ALLOWED_MODELS.includes(payload.model)) throw fail("このモデルは使えません", 404);
  if (JSON.stringify(payload.body || {}).length > 400_000) throw fail("中身が大きすぎます", 413);
  // ④ Gemini に送って、答えをそのまま返す（鍵はここで足す）
  const res = await http(`${GOOGLE_URL}/${payload.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(payload.body),
  });
  return new Response(res.body, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ------------------------------------------------------------
// 小さな道具
// ------------------------------------------------------------

/**
 * Supabase を管理用の鍵で使う道具（決まり RLS を通らない。Worker の中だけ）
 * get … 表を読む ／ patch … 表を直す ／ auth … ログインの人を作る・直す
 */
function rest(env, http) {
  const headers = {                                                   // 管理用の鍵
    apikey: env.SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };
  // 古い形の鍵（service_role。JWT）の時だけ Authorization にも入れる
  // 新しい形の鍵（sb_secret_…）は JWT ではないので apikey だけで送る（Supabase の決まり）
  if (!String(env.SUPABASE_SERVICE_KEY || "").startsWith("sb_")) headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_KEY}`;
  /** 返事を確かめて中身を返す */
  const read = async (res, what) => {
    if (!res.ok) throw fail(`${what}でエラーがありました（${res.status}）`, 500);
    return res.status === 204 ? null : res.json();
  };
  return {
    get: async (q) => read(await http(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers }), "読み込み"),
    patch: async (q, data) => read(await http(`${env.SUPABASE_URL}/rest/v1/${q}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(data) }), "保存"),
    auth: async (q, method, data) => read(await http(`${env.SUPABASE_URL}/auth/v1/${q}`, { method, headers, body: JSON.stringify(data) }), "アカウント作成"),
  };
}

/** 番号つきのエラーを作る */
function fail(message, status) {
  const e = new Error(message);   // エラー
  e.status = status;
  return e;
}

/** ブラウザに「このサイトから使ってよい」と知らせる印 */
function corsHeaders(origin, env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

/** JSON の返事を作る */
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
