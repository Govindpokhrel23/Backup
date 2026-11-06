// ============================================================
// tests/webpush.test.mjs — プッシュ通知の暗号と送り方（workers/api/worker.js）のテスト
// ------------------------------------------------------------
// このファイルは、Worker が作る通知の暗号を「スマホ側の計算」で元にもどせるか、
// 「このアプリから」の印（VAPID）が正しく署名されているか、
// /push が同じ会社の人だけに送り、使えなくなった宛先を消すかを確かめるテストのファイルです（2026年11月6日）。
// ============================================================

import test from "node:test";   // テストを書く道具
import assert from "node:assert/strict";   // 答えを確かめる道具
import worker, { encryptPayload, vapidHeader, fromB64url, toB64url } from "../workers/api/worker.js";   // テストする Worker の関数を読む

/** 文字 ⇔ バイト */
const enc = new TextEncoder();   // 文字 → バイト
const dec = new TextDecoder();   // バイト → 文字

/** HKDF（スマホ側と同じ計算） */
async function hkdf(salt, ikm, info, len) {   // HKDF の計算をする関数
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);   // もとの鍵
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));   // 計算した鍵を返す
}

/** スマホ（ブラウザ）の鍵を作る：p256dh と auth と、元にもどすための秘密の鍵 */
async function makePhone() {   // テスト用のスマホの鍵を作る関数
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);   // スマホの鍵
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));                           // 公開する方
  const auth = crypto.getRandomValues(new Uint8Array(16));                                                     // 合言葉
  return { keys, pub, auth, p256dh: toB64url(pub), authB64: toB64url(auth) };   // 鍵と合言葉を返す
}

/** スマホ側で暗号を元にもどす（RFC 8291 の逆の計算） */
async function decrypt(body, phone) {   // 暗号を元にもどす関数
  const salt = body.slice(0, 16);                                    // 塩
  const idlen = body[20];                                            // 送った側の鍵の長さ
  const asPublic = body.slice(21, 21 + idlen);                       // 送った側の鍵
  const cipher = body.slice(21 + idlen);                             // 暗号
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);   // 送った側の鍵（計算に使える形）
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, phone.keys.privateKey, 256));   // 共通の秘密
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...phone.pub, ...asPublic]);   // 鍵を作る時に混ぜる文字
  const ikm = await hkdf(phone.auth, shared, info, 32);   // 中間の鍵
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);   // 暗号の鍵
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);   // 暗号の番号
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);   // 元にもどす鍵
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));   // 元にもどした中身
  assert.equal(plain[plain.length - 1], 2);                          // 最後は「ここで終わり」の印
  return dec.decode(plain.slice(0, -1));   // 最後の印を取って文字にもどす
}

/** 通知の鍵（VAPID）を作る（tools/make-vapid.html と同じ作り方） */
async function makeVapid() {   // テスト用の通知の鍵を作る関数
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);   // 通知の鍵のペア
  return {   // 返す
    keys,   // 鍵のペア
    VAPID_PUBLIC_KEY: toB64url(await crypto.subtle.exportKey("raw", keys.publicKey)),   // 公開してよい方
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)),   // 秘密の方
  };
}

test("通知の暗号：スマホ側の計算で元の文にもどせる", async () => {   // テスト：暗号
  const phone = await makePhone();   // テスト用のスマホ
  const body = await encryptPayload('{"title":"シフト","body":"11/9 のシフトが変わりました"}', phone.p256dh, phone.authB64);   // 暗号にした通知
  assert.equal(await decrypt(body, phone), '{"title":"シフト","body":"11/9 のシフトが変わりました"}');   // 元の文にもどった
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);       // 決まりの大きさ
});

test("VAPID の印：公開鍵で署名を確かめられる", async () => {   // テスト：VAPID の印
  const vapid = await makeVapid();   // 通知の鍵
  const header = await vapidHeader("https://web.push.apple.com/abc", { ...vapid, VAPID_SUBJECT: "mailto:test@example.com" });   // 印を作る
  const [, token, match] = /^vapid t=([^,]+), k=(.+)$/.exec(header);   // 印の中身と公開鍵
  assert.equal(match, vapid.VAPID_PUBLIC_KEY);   // 公開鍵が合っている
  const [headerPart, claimsPart, signaturePart] = token.split(".");   // 印の3つの部分
  const claims = JSON.parse(dec.decode(fromB64url(claimsPart)));   // 印の中身
  assert.equal(claims.aud, "https://web.push.apple.com");   // 送り先が合っている
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.keys.publicKey, fromB64url(signaturePart), enc.encode(`${headerPart}.${claimsPart}`));   // 署名が正しいか
  assert.ok(ok);   // 署名が正しい
});

test("/push：同じ会社の人だけに送り、使えなくなった宛先は消す", async () => {   // テスト：/push
  const vapid = await makeVapid();   // 通知の鍵
  const p1 = await makePhone();   // 宛先が使えるスマホ
  const p2 = await makePhone();   // 宛先が使えなくなったスマホ
  const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "sb_secret_x", ALLOWED_ORIGIN: "", ...vapid };   // テスト用の設定
  const calls = [];                                                  // 送られたお願い
  /** にせものの Supabase と通知サーバー */
  const fake = async (url, init = {}) => {   // にせものの通信
    calls.push({ url, method: init.method || "GET" });   // 送られたお願いを記録
    /** にせものの返事を作る */
    const ok = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });   // にせものの返事を作る
    if (url.endsWith("/auth/v1/user")) return ok({ id: "u1" });   // ログイン中
    if (url.includes("members?auth_id")) return ok([{ id: "boss", role: "manager", active: true, company_id: "c1" }]);   // 店長
    if (url.includes("members?id=in.")) { assert.match(decodeURIComponent(url), /company_id=eq\.c1/); return ok([{ id: "a" }]); }   // 同じ会社の人だけをさがしている
    if (url.includes("push_subs?member_id")) return ok([   // 宛先が2つ
      { endpoint: "https://push.example/ok", member_id: "a", p256dh: p1.p256dh, auth: p1.authB64 },   // 使える宛先
      { endpoint: "https://push.example/gone", member_id: "a", p256dh: p2.p256dh, auth: p2.authB64 },   // 使えなくなった宛先
    ]);
    if (url === "https://push.example/ok") return new Response(null, { status: 201 });   // 使える宛先は成功
    if (url === "https://push.example/gone") return new Response(null, { status: 410 });   // 使えなくなった宛先は 410
    if (init.method === "DELETE") return new Response(null, { status: 204 });   // 消すのは成功
    return ok({}, 404);   // それ以外は「ない」
  };
  const req = new Request("https://api.example/push", {   // Worker へのお願い
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" },   // 送る方法・ヘッダー
    body: JSON.stringify({ memberIds: ["a", "b"], text: "シフトが公開されました" }),   // 送る人と文
  });
  const res = await worker.fetch(req, env, { fetch: fake });   // Worker の返事
  assert.deepEqual(await res.json(), { sent: 1, removed: 1 });   // 1件送れて1件消した
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.includes("push_subs")));   // 使えない宛先を消した
});
