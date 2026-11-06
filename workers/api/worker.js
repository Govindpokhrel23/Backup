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
//   ALLOWED_ORIGIN        … アプリのURL（例 https://shiftapp.pages.dev）
//   LOGIN_EMAIL_DOMAIN    … アプリの config.js と同じ（login.shiftapp.example.com）
//   VAPID_PUBLIC_KEY      … 通知の鍵（公開してよい方）。tools/make-vapid.html で作る。アプリの config.js にも同じものを入れる
//   VAPID_PRIVATE_JWK     … 通知の鍵（秘密の方。JSON の文字のまま貼る）
//   VAPID_SUBJECT         … 通知を送る人の連絡先（例 mailto:あなたのメール）
// ============================================================

/** 初回コードを何日使えるか */
const CODE_DAYS = 7;   // 初回コードは7日まで
/** 初回コードを何回まちがえたら使えなくするか（総当たりを防ぐ） */
const CODE_TRIES = 5;   // まちがいは5回まで
/** パスワードの一番短い長さ（アプリと同じ） */
const PASSWORD_MIN = 6;   // パスワードの最低の文字数
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
  if (row.code !== String(code)) {   // コードがちがえば
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
  const ids = memberIds.slice(0, 200).map((id) => `"${String(id).replace(/"/g, "")}"`).join(",");   // 宛先の人（多すぎないように200人まで）
  // 同じ会社の人だけに送る（ほかの会社の人には送れない）
  const people = await db.get(`members?id=in.(${encodeURIComponent(ids)})&company_id=eq.${from.company_id}&select=id`);   // 同じ会社の人だけ
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

/** 文字 → バイト */
const enc = new TextEncoder();   // 文字 → バイト

/** base64url の文字 → バイト */
export function fromB64url(base64url) {   // base64url → バイトにする関数
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);   // ふつうの base64 にもどす
  return Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));   // 1文字ずつ数字にする
}

/** バイト → base64url の文字 */
export function toB64url(bytes) {   // バイト → base64url にする関数
  let text = "";                                                        // 1バイトずつの文字
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);   // 1バイトずつ文字にする
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");   // URL で使える形にする
}

/** バイトの列をつなげる */
function concat(...parts) {   // バイトの列をつなぐ関数
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));   // つなげた結果
  let offset = 0;                                                         // 書く場所
  for (const part of parts) { out.set(part, offset); offset += part.length; }   // 順番に入れる
  return out;   // つないだものを返す
}

/** HKDF（鍵を作る決まった計算）で len バイトを作る */
async function hkdf(salt, ikm, info, len) {   // HKDF の計算をする関数
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);   // もとの鍵
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));   // 計算した鍵を返す
}

/**
 * 通知の中身を、そのスマホだけが読める暗号にする（RFC 8291 aes128gcm）
 * @param {string} text   中身（JSON の文字）
 * @param {string} p256dh スマホの鍵（base64url）
 * @param {string} auth   スマホの合言葉（base64url）
 * @returns {Promise<Uint8Array>} 送る中身
 */
export async function encryptPayload(text, p256dh, auth) {   // 通知の中身を暗号にする関数（RFC 8291）
  const uaPublic = fromB64url(p256dh);                               // スマホの鍵
  const authSecret = fromB64url(auth);                               // スマホの合言葉
  // ① こちらの使い捨ての鍵を作って、スマホの鍵と合わせた「共通の秘密」を作る
  const mine = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);   // 使い捨ての鍵
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", mine.publicKey));                       // その公開する方
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);   // スマホの鍵（計算に使える形）
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, mine.privateKey, 256));   // 共通の秘密
  // ② 決まった計算で、暗号の鍵（CEK）と番号（NONCE）を作る
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);   // 中間の鍵
  const salt = crypto.getRandomValues(new Uint8Array(16));           // 毎回ちがう塩
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);   // 暗号の鍵（16バイト）
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);   // 暗号の番号（12バイト）
  // ③ 中身のうしろに「ここで終わり」の印（2）をつけて、AES-GCM で暗号にする
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);   // 暗号の鍵
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));   // 暗号にした中身
  // ④ 頭に「塩・大きさ・こちらの鍵」をつける
  const head = new Uint8Array(16 + 4 + 1 + asPublic.length);         // 頭の部分
  head.set(salt, 0);   // 塩
  new DataView(head.buffer).setUint32(16, 4096);   // 決まりの大きさ（4096）
  head[20] = asPublic.length;   // 送る側の鍵の長さ
  head.set(asPublic, 21);   // 送る側の鍵
  return concat(head, cipher);   // 頭と暗号をつないで返す
}

/**
 * 「この通知はこのアプリから」という印（VAPID・RFC 8292）を作る
 * @returns {Promise<string>} Authorization ヘッダーの中身
 */
export async function vapidHeader(endpoint, env) {   // 「このアプリから」の印（VAPID）を作る関数
  const head = toB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));             // 印の種類
  const claims = toB64url(enc.encode(JSON.stringify({   // 印の中身（だれに・いつまで・だれから）
    aud: new URL(endpoint).origin,                                   // 通知のサーバー（Apple・Google など）
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,                  // 12時間で使えなくなる
    sub: env.VAPID_SUBJECT || "mailto:admin@example.com",            // 送る人の連絡先
  })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);   // 秘密の鍵
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));   // 署名
  return `vapid t=${head}.${claims}.${toB64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;   // 印と公開鍵を返す
}

/** 1台のスマホに通知を送る */
async function sendWebPush(sub, payload, env, http) {   // 通知を1つ送る関数
  return http(sub.endpoint, {   // 宛先に送る
    method: "POST",   // 送る方法
    headers: {   // ヘッダー
      "Content-Encoding": "aes128gcm",   // 暗号の種類
      "Content-Type": "application/octet-stream",   // 中身はバイト
      TTL: "86400",                                                  // 1日のあいだに届けばよい
      Urgency: "normal",   // 急ぎ度
      Authorization: await vapidHeader(sub.endpoint, env),   // このアプリからの印
    },
    body: await encryptPayload(payload, sub.p256dh, sub.auth),   // 暗号にした中身
  });
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
