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
//   POST /push     … プッシュ通知を送る（2026年11月6日）。ログインした人が、同じ会社の人に送れる
//
// Cloudflare に入れる値（Settings → Variables and Secrets）：
//   SUPABASE_URL          … Supabase の Project URL
//   SUPABASE_SERVICE_KEY  … Supabase の Secret key（sb_secret_…。古い画面では service_role key）。秘密！アプリには絶対に入れない
//   GEMINI_API_KEY        … Google AI Studio の鍵（秘密）
//   ALLOWED_ORIGIN        … アプリのURL（wrangler.toml に書いてある）
//   LOGIN_EMAIL_DOMAIN    … アプリの config.js と同じ（login.shiftapp.example.com）
//   VAPID_PUBLIC_KEY      … 通知の鍵（公開してよい方）。はじめての公開の時に GitHub が自動で作って入れる（/vapid で読める）
//   VAPID_PRIVATE_JWK     … 通知の鍵（秘密の方）。GitHub が自動で作って、Worker にだけ入れる（だれも見ない）
//   VAPID_SUBJECT         … 通知を送る人の連絡先（mailto:お店のメール）。GitHub が自動で入れる
// ============================================================

import { sendWebPush } from "./lib/webpush.js";   // 通知を1つ送る道具を読む（暗号の計算は lib/webpush.js）

/** 初回コードを何日使えるか */
const CODE_DAYS = 7;   // 初回コードは7日まで
/** 初回コードを何回まちがえたら使えなくするか（総当たりを防ぐ） */
const CODE_TRIES = 5;   // まちがいは5回まで
/** パスワードの一番短い長さ（アプリと同じ） */
const PASSWORD_MIN = 8;   // パスワードの最低の文字数（2026年11月16日：6 → 8）
/** 使ってよい Gemini のモデル（ほかの高いモデルを使われないように） */
const ALLOWED_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];   // 使ってよいモデル
/** Google の Gemini API の住所 */
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";   // Google の Gemini の住所

export default {   // Worker の本体
  /**
   * アプリから届いたお願いを受ける
   * @param {Request} request アプリからのお願い
   * @param {object} env      Cloudflare に入れた値
   * @param {object} [deps]   テストの時に、にせものの fetch を入れる
   */
  async fetch(request, env, deps = {}) {   // お願いが来た時に動く関数
    const http = deps.fetch || fetch;                                 // 外へのお願いに使う fetch
    const origin = request.headers.get("Origin") || "";               // どのサイトから来たか
    const cors = corsHeaders(origin, env);                            // ブラウザに返す許可の印
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });   // 確認のお願い（OPTIONS）にはすぐ返す
    // /vapid：通知の鍵の「公開してよい方」だけを返す（公開の時に GitHub が読んで、アプリの config.js に入れる。2026年11月15日）
    if (request.method === "GET" && new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/vapid")) return json({ publicKey: env.VAPID_PUBLIC_KEY || "" }, 200, cors);   // 秘密の方は返さない
    if (request.method !== "POST") return json({ error: "POST だけ受け付けます" }, 405, cors);   // POST 以外はことわる
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return json({ error: "このサイトからは使えません" }, 403, cors);   // ほかのサイトからはことわる

    const path = new URL(request.url).pathname.replace(/\/+$/, "");  // 入口（/activate・/ai）
    let body;                                                         // 送られてきた中身
    try { body = await request.json(); } catch { return json({ error: "中身の形がちがいます" }, 400, cors); }   // 中身を読む（JSON でなければことわる）

    try {   // エラーでも止まらないように
      if (path.endsWith("/activate")) return json(await activate(body, env, http), 200, cors);   // /activate：初回コードでパスワードを決める
      if (path.endsWith("/ai")) return await ai(body, request, env, http, cors);   // /ai：Gemini に送る
      if (path.endsWith("/push")) return json(await push(body, request, env, http), 200, cors);   // /push：スマホに通知を送る
      return json({ error: "この住所はありません" }, 404, cors);   // それ以外は「ない」
    } catch (error) {   // エラーの時
      return json({ error: error.message }, error.status || 500, cors);   // エラーの文を返す
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
async function activate({ loginId, code, password }, env, http) {   // 初回コードでパスワードを決める関数
  const id = String(loginId || "").trim();                            // ログインID
  if (!/^\d{3,8}$/.test(id) || !/^\d{6}$/.test(String(code || ""))) throw fail("IDか初回コードが違います", 400);   // ID とコードの形を調べる
  if (!password || password.length < PASSWORD_MIN) throw fail(`パスワードは${PASSWORD_MIN}文字以上にしてください`, 400);   // パスワードが短ければことわる
  const db = rest(env, http);                                         // Supabase の表を使う道具

  // ① 初回コード
  const [row] = await db.get(`login_codes?login_id=eq.${id}&select=*`);   // その人の初回コード
  if (!row || row.used) throw fail("IDか初回コードが違います", 400);   // コードがない・使用済みならことわる
  if (row.attempts >= CODE_TRIES) throw fail("まちがいが多すぎます。店長に新しい初回コードをもらってください", 429);   // まちがいが多すぎればことわる
  if (Date.now() - new Date(row.created_at).getTime() > CODE_DAYS * 86400000) throw fail("初回コードの期限が切れています。店長に新しいコードをもらってください", 400);   // 期限切れならことわる
  if (!sameText(row.code, String(code))) {   // コードがちがえば（時間で見分けられない比べ方。2026年11月16日）
    await db.patch(`login_codes?login_id=eq.${id}`, { attempts: row.attempts + 1 });   // まちがえた回数を足す
    throw fail("IDか初回コードが違います", 400);   // ことわる
  }

  // ② 店員
  const [member] = await db.get(`members?login_id=eq.${id}&select=id,auth_id,active`);   // その店員
  if (!member || !member.active) throw fail("このIDは今は使えません（店長に聞いてください）", 400);   // 店員がいない・休止中ならことわる

  // ③ ログインの人を作る（もういればパスワードを変える）
  const email = `${id}@${env.LOGIN_EMAIL_DOMAIN || "login.shiftapp.example.com"}`;      // ログイン用のメールの形
  if (member.auth_id) {   // もうログインの人がいれば
    await db.auth(`admin/users/${member.auth_id}`, "PUT", { password });   // パスワードを変える
  } else {   // いなければ
    const user = await db.auth("admin/users", "POST", { email, password, email_confirm: true });   // 作ったログインの人
    await db.patch(`members?id=eq.${member.id}`, { auth_id: user.id });   // 店員とつなぐ
  }
  await db.patch(`members?id=eq.${member.id}`, { account: "active" });   // アカウントを使える状態にする
  await db.patch(`login_codes?login_id=eq.${id}`, { used: true });   // コードを使用済みにする
  return { ok: true };   // 成功
}

// ------------------------------------------------------------
// AI（/ai）
// ------------------------------------------------------------

/**
 * Gemini を呼ぶ。ログイン中の店長だけ
 * @param {{model:string, body:object}} payload  アプリが作った Gemini への中身
 */
async function ai(payload, request, env, http, cors) {   // Gemini に送る関数
  // ①② ログインの印から、だれかを調べて、店長か確かめる
  const member = await caller(request, env, http);                   // お願いしてきた人
  if (member.role !== "manager") throw fail("店長だけが使えます", 403);   // 店長でなければことわる
  // ③ 中身を確かめる
  if (!ALLOWED_MODELS.includes(payload.model)) throw fail("このモデルは使えません", 404);   // 使ってよいモデルでなければことわる
  if (JSON.stringify(payload.body || {}).length > 400_000) throw fail("中身が大きすぎます", 413);   // 大きすぎればことわる
  // ④ Gemini に送って、答えをそのまま返す（鍵はここで足す）
  const res = await http(`${GOOGLE_URL}/${payload.model}:generateContent`, {   // Gemini に送る
    method: "POST",   // 送る方法
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },   // Gemini の鍵は Worker が足す
    body: JSON.stringify(payload.body),   // 中身
  });
  return new Response(res.body, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });   // Gemini の返事をそのまま返す
}

/**
 * お願いしてきた人（ログイン中の店員）を調べる
 * アプリが送ってきた「ログインの印」（Supabase のトークン）を Supabase に見せて確かめる
 * @returns {Promise<{id:string, role:string, active:boolean, company_id:string}>}
 */
async function caller(request, env, http) {   // お願いした人を調べる関数
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");   // アプリのログインの印
  if (!token) throw fail("ログインしてください", 401);   // トークンがなければことわる
  const userRes = await http(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });   // Supabase に「この印はだれ？」と聞いた返事
  if (!userRes.ok) throw fail("ログインが切れました。もう一度ログインしてください", 401);   // ログインが切れていればことわる
  const user = await userRes.json();                                 // ログインの人
  const [member] = await rest(env, http).get(`members?auth_id=eq.${user.id}&select=id,role,active,company_id`);   // その店員
  if (!member || !member.active) throw fail("このIDは今は使えません", 403);   // 店員がいない・休止中ならことわる
  return member;   // 店員を返す
}

// ------------------------------------------------------------
// プッシュ通知（/push）2026年11月6日
// ------------------------------------------------------------
// 流れ：アプリがお知らせを保存した時 → ここに「だれに・何を」を送る
//       → その人たちのスマホの宛先（push_subs）を読む → 1台ずつ暗号にして送る
// 暗号のしかたは Web Push の決まり（RFC 8291・RFC 8292）。Cloudflare の中の Web Crypto だけで作る。

/**
 * 通知を送る
 * @param {{memberIds:string[], text:string}} body  だれに・何を
 * @returns {{sent:number, removed:number}} 送った数・使えなくなって消した宛先の数
 */
async function push({ memberIds, text }, request, env, http) {   // スマホに通知を送る関数
  const from = await caller(request, env, http);                     // 送る人
  if (!Array.isArray(memberIds) || !memberIds.length || !text) return { sent: 0, removed: 0 };   // 送る人・文がなければ何もしない
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) throw fail("通知の鍵が Worker に入っていません", 500);   // 通知の鍵がなければエラー
  const db = rest(env, http);                                        // Supabase の表を使う道具
  // 宛先のIDは英数字と - _ だけ（変な文字で検索をこわされないように。2026年11月16日）
  const ids = memberIds.slice(0, 200).map(String).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)).map((id) => `"${id}"`).join(",");   // 宛先の人（200人まで）
  if (!ids) return { sent: 0, removed: 0 };   // 正しい宛先がなければ何もしない
  // 同じ会社の人だけに送る（ほかの会社の人には送れない）
  // 店員が送れるのは店長あてだけ（店員がほかの店員に、にせのお知らせを送れないように。2026年11月16日）
  const onlyBoss = from.role === "manager" ? "" : "&role=eq.manager";   // 店員なら店長だけ
  const people = await db.get(`members?id=in.(${encodeURIComponent(ids)})&company_id=eq.${from.company_id}${onlyBoss}&select=id`);   // 送ってよい人だけ
  if (!people.length) return { sent: 0, removed: 0 };   // いなければ何もしない
  const subs = await db.get(`push_subs?member_id=in.(${encodeURIComponent(people.map((member) => `"${member.id}"`).join(","))})&select=*`);   // スマホの宛先
  const payload = JSON.stringify({ title: "シフト", body: String(text).slice(0, 200), url: "./#/home" });   // 通知の中身
  let sent = 0;                                                      // 送れた数
  let removed = 0;                                                   // 消した宛先の数
  for (const sub of subs) {   // 宛先ごとに
    const res = await sendWebPush(sub, payload, env, http);   // 通知のサーバーの返事
    if (res.status === 404 || res.status === 410) {                  // もう使われていない宛先（アプリを消した など）
      await db.del(`push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`);   // 使えない宛先は消す
      removed++;   // 消した数を足す
    } else if (res.ok) {   // 送れたら
      sent++;   // 送った数を足す
    }
  }
  return { sent, removed };   // 送った数・消した数を返す
}

// ------------------------------------------------------------
// 小さな道具
// ------------------------------------------------------------

/**
 * Supabase を管理用の鍵で使う道具（決まり RLS を通らない。Worker の中だけ）
 * get … 表を読む ／ patch … 表を直す ／ auth … ログインの人を作る・直す
 */
function rest(env, http) {   // Supabase を管理者として使う道具を作る関数
  const headers = {                                                   // 管理用の鍵
    apikey: env.SUPABASE_SERVICE_KEY,   // 管理者の鍵（Worker の Secret）
    "Content-Type": "application/json",   // 中身は JSON
  };
  // 古い形の鍵（service_role。JWT）の時だけ Authorization にも入れる
  // 新しい形の鍵（sb_secret_…）は JWT ではないので apikey だけで送る（Supabase の決まり）
  if (!String(env.SUPABASE_SERVICE_KEY || "").startsWith("sb_")) headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_KEY}`;   // 古い形の鍵なら Authorization にも入れる
  /** 返事を確かめて中身を返す */
  const read = async (res, what) => {   // 返事を読む
    if (!res.ok) throw fail(`${what}でエラーがありました（${res.status}）`, 500);   // エラーなら止める
    return res.status === 204 ? null : res.json();   // 中身がなければ null
  };
  return {   // 使える操作を返す
    get: async (path) => read(await http(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers }), "読み込み"),   // 読む
    patch: async (path, data) => read(await http(`${env.SUPABASE_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(data) }), "保存"),   // 変える
    auth: async (path, method, data) => read(await http(`${env.SUPABASE_URL}/auth/v1/${path}`, { method, headers, body: JSON.stringify(data) }), "アカウント作成"),   // ログインの人の管理
    del: async (path) => read(await http(`${env.SUPABASE_URL}/rest/v1/${path}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }), "削除"),   // 消す
  };
}

/** 2つの文字が同じか（どこでちがったかを、かかった時間で見分けられない比べ方） */
function sameText(a, b) {   // 同じか調べる関数
  const left = String(a ?? ""), right = String(b ?? "");   // 文字にする
  let diff = left.length ^ right.length;   // 長さがちがえば、ちがう
  for (let index = 0; index < Math.max(left.length, right.length); index++) diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);   // 1文字ずつ全部比べる
  return diff === 0;   // 全部同じなら true
}

/** 番号つきのエラーを作る */
function fail(message, status) {   // 番号つきのエラーを作る関数
  const error = new Error(message);   // エラー
  error.status = status;   // 番号
  return error;   // 返す
}

/** ブラウザに「このサイトから使ってよい」と知らせる印 */
function corsHeaders(origin, env) {   // ほかのサイトから使うためのヘッダーを作る関数
  return {   // 返す
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || origin || "*",   // 使ってよいサイト
    "Access-Control-Allow-Methods": "POST, OPTIONS",   // 使ってよい方法
    "Access-Control-Allow-Headers": "Content-Type, Authorization",   // 使ってよいヘッダー
    "Vary": "Origin",   // サイトごとにちがう返事
  };
}

/** JSON の返事を作る */
function json(obj, status, headers) {   // JSON で返す関数
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });   // 文字にして返す
}
