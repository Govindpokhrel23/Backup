// ============================================================
// workers/api/lib/webpush.js — プッシュ通知の暗号と送り方
// ------------------------------------------------------------
// このファイルは、スマホに通知を送る時の「暗号（RFC 8291）」と「このアプリからの印（VAPID）」の
// 計算をまとめたファイルです（2026年11月12日に worker.js から分けた）。
// worker.js が使う。テスト（tests/webpush.test.mjs）もここを直接読む。
// ============================================================

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
export async function sendWebPush(sub, payload, env, http) {   // 通知を1つ送る関数
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
