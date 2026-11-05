// ============================================================
// ai/gemini.js — Gemini（Google のAI）を呼ぶ
// ------------------------------------------------------------
// このファイルは、Gemini に質問（プロンプト）を送って、
// 答え（JSON）を受け取るためのファイルです（2026年11月5日）。
//
// ・つなぎ方は ai-settings.js の mode で決まる
//     "gemini" → この機械から直接 Google へ送る
//     "worker" → Cloudflare Worker（workers/ai-proxy/worker.js）へ送る。鍵は Worker の中
// ・答えの形（JSONの形）を schema で決めて送るので、決まった形で返ってくる
// ・うまくいかない時は、日本語の分かりやすいエラーにして返す
// ============================================================

import { CONFIG } from "../config.js";

/** Google の Gemini API の住所（モデル名の所はあとで入れる） */
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini に送って、JSON の答えをもらう
 * @param {object} p
 * @param {object} p.settings      ai-settings.js の設定
 * @param {string} p.prompt        送る文
 * @param {object} p.schema        答えの形（Gemini の responseSchema）
 * @param {typeof fetch} [p.fetchImpl] テストの時に、にせものの fetch を入れる
 * @returns {Promise<object>} 答え（JSON をオブジェクトにしたもの）
 */
export async function askGemini({ settings, prompt, schema, fetchImpl = fetch }) {
  // Gemini に送る中身（Google の決まった形）
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",   // JSON で答えてもらう
      responseSchema: schema,                 // 答えの形
      temperature: 0.2,                       // 低いほど毎回同じような答え（シフトはぶれない方がよい）
    },
  };

  // 時間がかかりすぎたら止める（CONFIG.AI_TIMEOUT_MS）
  const stop = new AbortController();                                 // 止めるためのスイッチ
  const timer = setTimeout(() => stop.abort(), CONFIG.AI_TIMEOUT_MS); // 時間切れのタイマー

  let res;                                                            // サーバーからの返事
  try {
    if (settings.mode === "worker") {
      // Worker へ：鍵は送らない（Worker の中にある）。合言葉だけ送る
      res = await fetchImpl(settings.workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Token": settings.appToken || "" },
        body: JSON.stringify({ model: settings.model, body }),
        signal: stop.signal,
      });
    } else {
      // Google へ直接：鍵はヘッダーで送る（URL に鍵を入れない＝履歴に残らない）
      res = await fetchImpl(`${GOOGLE_URL}/${encodeURIComponent(settings.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
        body: JSON.stringify(body),
        signal: stop.signal,
      });
    }
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "AIの返事が遅すぎたので止めました（もう一度押してください）" : "AIにつながりません（電波・URLを確認してください）");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(errorText(res.status, await res.text().catch(() => "")));

  const json = await res.json();                                      // Gemini の答え全体
  const text = json?.candidates?.[0]?.content?.parts?.map((x) => x.text || "").join("") || "";   // 答えの文
  if (!text) {
    const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || "空";   // 答えがなかった理由（安全のため止められた など）
    throw new Error(`AIから答えが返ってきませんでした（${why}）`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AIの答えの形がおかしかったので使えませんでした（もう一度押してください）");
  }
}

/** エラーの番号を、分かりやすい日本語にする */
function errorText(status, detail) {
  if (status === 400 && /API key/i.test(detail)) return "Gemini の鍵がまちがっています（AIの設定で入れ直してください）";
  if (status === 400) return "AIへの送り方がまちがっています（モデルの名前を確認してください）";
  if (status === 401 || status === 403) return "AIに入れませんでした（鍵・合言葉を確認してください）";
  if (status === 404) return "このモデルは使えません（AIの設定でモデルの名前を変えてください）";
  if (status === 429) return "無料で使える回数をこえました。少し待ってから、もう一度押してください";
  if (status >= 500) return "AIのサーバーが混んでいます。少し待ってから、もう一度押してください";
  return `AIでエラーがありました（${status}）`;
}

/** つながるか試す（AIの設定画面の「試す」ボタン） */
export async function testGemini(settings, fetchImpl = fetch) {
  const schema = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" }, message: { type: "STRING" } }, required: ["ok", "message"] };   // 答えの形：ok と message だけ
  return askGemini({ settings, prompt: "接続テストです。ok を true、message を「つながりました」にして返してください。", schema, fetchImpl });
}
