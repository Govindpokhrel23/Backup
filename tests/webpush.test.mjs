// ============================================================
// tests/webpush.test.mjs — プッシュ通知の暗号と送り方（workers/api/worker.js）のテスト
// ------------------------------------------------------------
// このファイルは、Worker が作る通知の暗号を「スマホ側の計算」で元にもどせるか、
// 「このアプリから」の印（VAPID）が正しく署名されているか、
// /push が同じ会社の人だけに送り、使えなくなった宛先を消すかを確かめるテストのファイルです（2026年11月6日）。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import worker, { encryptPayload, vapidHeader, fromB64url, toB64url } from "../workers/api/worker.js";

/** 文字 ⇔ バイト */
const enc = new TextEncoder();
const dec = new TextDecoder();   // バイト → 文字

/** HKDF（スマホ側と同じ計算） */
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);   // もとの鍵
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

/** スマホ（ブラウザ）の鍵を作る：p256dh と auth と、元にもどすための秘密の鍵 */
async function makePhone() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);   // スマホの鍵
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));                           // 公開する方
  const auth = crypto.getRandomValues(new Uint8Array(16));                                                     // 合言葉
  return { keys, pub, auth, p256dh: toB64url(pub), authB64: toB64url(auth) };
}

/** スマホ側で暗号を元にもどす（RFC 8291 の逆の計算） */
async function decrypt(body, phone) {
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
  return dec.decode(plain.slice(0, -1));
}

/** 通知の鍵（VAPID）を作る（tools/make-vapid.html と同じ作り方） */
async function makeVapid() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);   // 通知の鍵のペア
  return {
    keys,
    VAPID_PUBLIC_KEY: toB64url(await crypto.subtle.exportKey("raw", keys.publicKey)),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)),
  };
}

test("通知の暗号：スマホ側の計算で元の文にもどせる", async () => {
  const phone = await makePhone();   // テスト用のスマホ
  const body = await encryptPayload('{"title":"シフト","body":"11/9 のシフトが変わりました"}', phone.p256dh, phone.authB64);   // 暗号にした通知
  assert.equal(await decrypt(body, phone), '{"title":"シフト","body":"11/9 のシフトが変わりました"}');
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);       // 決まりの大きさ
});

test("VAPID の印：公開鍵で署名を確かめられる", async () => {
  const v = await makeVapid();   // 通知の鍵
  const header = await vapidHeader("https://web.push.apple.com/abc", { ...v, VAPID_SUBJECT: "mailto:test@example.com" });
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);   // 印の中身と公開鍵
  assert.equal(k, v.VAPID_PUBLIC_KEY);
  const [h, c, s] = token.split(".");   // 印の3つの部分
  const claims = JSON.parse(dec.decode(fromB64url(c)));   // 印の中身
  assert.equal(claims.aud, "https://web.push.apple.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.keys.publicKey, fromB64url(s), enc.encode(`${h}.${c}`));   // 署名が正しいか
  assert.ok(ok);
});

test("/push：同じ会社の人だけに送り、使えなくなった宛先は消す", async () => {
  const v = await makeVapid();   // 通知の鍵
  const p1 = await makePhone();   // 宛先が使えるスマホ
  const p2 = await makePhone();   // 宛先が使えなくなったスマホ
  const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "sb_secret_x", ALLOWED_ORIGIN: "", ...v };
  const calls = [];                                                  // 送られたお願い
  /** にせものの Supabase と通知サーバー */
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    /** にせものの返事を作る */
    const ok = (b, status = 200) => new Response(b == null ? null : JSON.stringify(b), { status });
    if (url.endsWith("/auth/v1/user")) return ok({ id: "u1" });
    if (url.includes("members?auth_id")) return ok([{ id: "boss", role: "manager", active: true, company_id: "c1" }]);
    if (url.includes("members?id=in.")) { assert.match(decodeURIComponent(url), /company_id=eq\.c1/); return ok([{ id: "a" }]); }
    if (url.includes("push_subs?member_id")) return ok([
      { endpoint: "https://push.example/ok", member_id: "a", p256dh: p1.p256dh, auth: p1.authB64 },
      { endpoint: "https://push.example/gone", member_id: "a", p256dh: p2.p256dh, auth: p2.authB64 },
    ]);
    if (url === "https://push.example/ok") return new Response(null, { status: 201 });
    if (url === "https://push.example/gone") return new Response(null, { status: 410 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return ok({}, 404);
  };
  const req = new Request("https://api.example/push", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds: ["a", "b"], text: "シフトが公開されました" }),
  });
  const res = await worker.fetch(req, env, { fetch: fake });   // Worker の返事
  assert.deepEqual(await res.json(), { sent: 1, removed: 1 });
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.includes("push_subs")));
});
