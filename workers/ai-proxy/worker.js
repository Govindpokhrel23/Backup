// ============================================================
// workers/ai-proxy/worker.js — Gemini の鍵をかくして AI を呼ぶ「中つぎ」（Cloudflare Worker）
// ------------------------------------------------------------
// このファイルは、Cloudflare Workers で動かす小さなサーバーのファイルです（2026年11月5日）。
// アプリ → この Worker → Gemini の順につなぐ。
// こうすると、Gemini の鍵はアプリ（スマホ）に置かなくてよい（鍵が盗まれない）。
//
// Cloudflare に入れる「秘密の値」（Settings → Variables and Secrets）：
//   GEMINI_API_KEY … Google AI Studio で作った鍵
//   APP_TOKEN      … アプリと決めた合言葉（アプリの「AIの設定」にも同じものを入れる）
//   ALLOWED_ORIGIN … アプリのURL（例 https://shift.example.pages.dev）。ほかのサイトからは使わせない
// 入れ方は README.md の「AI（Gemini）をつなぐ」を見る。
// ============================================================

/** 使ってよいモデル（ほかの高いモデルを勝手に使われないように） */
const ALLOWED_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

/** Google の Gemini API の住所 */
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  /**
   * アプリから届いたお願いを受ける
   * @param {Request} request アプリからのお願い
   * @param {object} env      Cloudflare に入れた秘密の値
   */
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";                 // どのサイトから来たか
    const cors = corsHeaders(origin, env);                             // ブラウザに返す許可の印

    // ブラウザの「送ってもいい？」の確認（OPTIONS）にはすぐ答える
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST だけ受け付けます" }, 405, cors);

    // ① 合言葉を確かめる
    if (!env.APP_TOKEN || request.headers.get("X-App-Token") !== env.APP_TOKEN) {
      return json({ error: "合言葉がちがいます" }, 401, cors);
    }
    // ② 決めたサイトから来たか確かめる
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "このサイトからは使えません" }, 403, cors);
    }

    // ③ 中身を読む
    let payload;                                                       // アプリが送ってきたもの {model, body}
    try { payload = await request.json(); } catch { return json({ error: "中身の形がちがいます" }, 400, cors); }
    if (!ALLOWED_MODELS.includes(payload.model)) return json({ error: "このモデルは使えません" }, 404, cors);
    if (JSON.stringify(payload.body || {}).length > 400_000) return json({ error: "中身が大きすぎます" }, 413, cors);

    // ④ Gemini に送る（鍵はここで足す）
    const res = await fetch(`${GOOGLE_URL}/${payload.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(payload.body),
    });
    // ⑤ Gemini の答えをそのまま返す
    return new Response(res.body, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};

/** ブラウザに「このサイトから使ってよい」と知らせる印 */
function corsHeaders(origin, env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
    "Vary": "Origin",
  };
}

/** JSON の返事を作る */
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
