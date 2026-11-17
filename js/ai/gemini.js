// ============================================================
// ai/gemini.js — Gemini（Google のAI）を呼ぶ
// ------------------------------------------------------------
// このファイルは、Gemini に質問（プロンプト）を送って、
// 答え（JSON）を受け取るためのファイルです（2026年11月5日）。
//
// ・つなぎ方は ai-settings.js の mode で決まる
//     "gemini" → この機械から直接 Google へ送る
//     "worker" → Cloudflare Worker（workers/api/worker.js の /ai）へ送る。鍵は Worker の中。ログインの印をつける
// ・答えの形（JSONの形）を schema で決めて送るので、決まった形で返ってくる
// ・うまくいかない時は、日本語の分かりやすいエラーにして返す
// ============================================================

import { CONFIG } from "../config.js";   // 設定を読む
import { authToken, workerAiUrl, isProduction } from "./ai-settings.js";   // ログインの証明・Worker の住所・本番か調べる関数を読む

/** Google の Gemini API の住所（モデル名の所はあとで入れる） */
const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";   // Google の Gemini の住所

/**
 * Gemini に送って、JSON の答えをもらう
 * @param {object} options
 * @param {object} options.settings      ai-settings.js の設定
 * @param {string} options.prompt        送る文
 * @param {object} options.schema        答えの形（Gemini の responseSchema）
 * @param {typeof fetch} [options.fetchImpl] テストの時に、にせものの fetch を入れる
 * @returns {Promise<object>} 答え（JSON をオブジェクトにしたもの）
 */
export async function askGemini({ settings, prompt, schema, fetchImpl = fetch }) {   // Gemini にお願いして答え（JSON）をもらう関数
  // Gemini に送る中身（Google の決まった形）
  const body = {   // 送る中身
    contents: [{ role: "user", parts: [{ text: prompt }] }],   // お願いの文
    generationConfig: {   // 答えの形の決まり
      responseMimeType: "application/json",   // JSON で答えてもらう
      responseSchema: schema,                 // 答えの形
      temperature: 0.2,                       // 低いほど毎回同じような答え（シフトはぶれない方がよい）
    },
  };

  // 時間がかかりすぎたら止める（CONFIG.AI_TIMEOUT_MS）
  const stop = new AbortController();                                 // 止めるためのスイッチ
  const timer = setTimeout(() => stop.abort(), CONFIG.AI_TIMEOUT_MS); // 時間切れのタイマー

  let res;                                                            // サーバーからの返事
  try {   // 通信が失敗しても止まらないように
    if (settings.mode === "worker") {   // Worker 経由なら
      // Worker へ：鍵は送らない（Worker の中にある）。ログインの印だけ送る（店長か Worker が確かめる）
      const token = settings.token ?? (await authToken());          // ログインの印
      res = await fetchImpl(settings.workerUrl || workerAiUrl(), {   // Worker の /ai に送る
        method: "POST",   // 送る方法
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },   // 中身は JSON・ログインの証明つき
        body: JSON.stringify({ model: settings.model, body }),   // モデルと中身
        signal: stop.signal,   // 時間切れで止められるように
      });
    } else {   // 直接 Gemini に送るなら
      // 本番（Supabase）では直接送らない。鍵をスマホに置かないため（2026年11月17日・セキュリティ）
      if (isProduction()) throw new Error("PRODUCTION_DIRECT");   // 本番では止める（下で分かる文にする）
      // Google へ直接：鍵はヘッダーで送る（URL に鍵を入れない＝履歴に残らない）
      res = await fetchImpl(`${GOOGLE_URL}/${encodeURIComponent(settings.model)}:generateContent`, {   // Google に直接送る
        method: "POST",   // 送る方法
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },   // 中身は JSON・Gemini の鍵つき
        body: JSON.stringify(body),   // 中身
        signal: stop.signal,   // 時間切れで止められるように
      });
    }
  } catch (error) {   // 通信が失敗した時
    if (error.message === "PRODUCTION_DIRECT") throw new Error("本番では、スマホから直接 Gemini は使えません（サーバー経由にしてください）");   // 本番で直接を使おうとした時
    throw new Error(error.name === "AbortError" ? "AIの返事が遅すぎたので止めました（もう一度押してください）" : "AIにつながりません（電波・URLを確認してください）");   // 時間切れか、つながらないかで文を変える
  } finally {   // 成功でも失敗でも
    clearTimeout(timer);   // 時間切れのタイマーを止める
  }

  if (!res.ok) throw new Error(errorText(res.status, await res.text().catch(() => "")));   // エラーの返事なら、わかりやすい文にする

  const json = await res.json();                                      // Gemini の答え全体
  const text = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";   // 答えの文
  if (!text) {   // 答えの文がなければ
    const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || "空";   // 答えがなかった理由（安全のため止められた など）
    throw new Error(`AIから答えが返ってきませんでした（${why}）`);   // エラー
  }
  try {   // 答えの形がこわれている時に止まらないように
    return JSON.parse(text);   // 答えを読んで返す
  } catch {   // 読めなかった時
    throw new Error("AIの答えの形がおかしかったので使えませんでした（もう一度押してください）");   // エラー
  }
}

/** エラーの番号を、分かりやすい日本語にする */
function errorText(status, detail) {   // エラーの番号をわかりやすい文にする関数
  if (status === 400 && /API key/i.test(detail)) return "Gemini の鍵がまちがっています（AIの設定で入れ直してください）";   // 鍵がまちがい
  if (status === 400) return "AIへの送り方がまちがっています（モデルの名前を確認してください）";   // 送り方がまちがい
  if (status === 401 || status === 403) return "AIに入れませんでした（鍵・合言葉を確認してください）";   // 入れない
  if (status === 404) return "このモデルは使えません（AIの設定でモデルの名前を変えてください）";   // モデルがない
  if (status === 429) return "無料で使える回数をこえました。少し待ってから、もう一度押してください";   // 使える回数をこえた
  if (status >= 500) return "AIのサーバーが混んでいます。少し待ってから、もう一度押してください";   // サーバーが混んでいる
  return `AIでエラーがありました（${status}）`;   // それ以外
}

/** つながるか試す（AIの設定画面の「試す」ボタン） */
export async function testGemini(settings, fetchImpl = fetch) {   // つながるか試す関数
  const schema = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" }, message: { type: "STRING" } }, required: ["ok", "message"] };   // 答えの形：ok と message だけ
  return askGemini({ settings, prompt: "接続テストです。ok を true、message を「つながりました」にして返してください。", schema, fetchImpl });   // 短いお願いを送る
}
