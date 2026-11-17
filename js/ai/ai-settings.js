// ============================================================
// ai/ai-settings.js — AI（Gemini）のつなぎ方の設定
// ------------------------------------------------------------
// このファイルは、AIをどうやって使うか（つなぎ方・鍵・モデル）を
// この機械（店長のスマホ・パソコン）に保存して読むためのファイルです（2026年11月5日）。
//
// つなぎ方（mode）は3つ：
//   "worker" … Cloudflare Worker（workers/api の /ai）を通す。鍵はサーバーにだけ置く ← 本番はこれ
//              本物（Supabase）につないでいて、config.js に API_WORKER_URL がある時だけ使える
//   "gemini" … この機械から直接 Gemini を呼ぶ。鍵はこの機械にだけ保存する ← 今日すぐ試す用
//   "local"  … AIを使わない（簡易版の下書きだけ）
// ※鍵はプログラム（GitHub など）には絶対に書かない。この設定画面から入れる。
// ============================================================

import { CONFIG } from "../config.js";   // 設定を読む

/** この機械に保存する時の名前 */
const KEY = "shiftapp-ai-settings";   // スマホに保存する時の名前

/** 最初の設定（何も入れていない時） */
const DEFAULTS = {   // はじめの設定
  mode: CONFIG.API_MODE === "supabase" ? "worker" : CONFIG.AI_MODE,   // つなぎ方（本番はいつも Worker。2026年11月17日）
  apiKey: "",                    // Gemini の鍵（mode "gemini" の時だけ使う）
  model: CONFIG.AI_MODEL,        // 使うモデルの名前
};

/** 設定を読む（保存がなければ最初の設定） */
export function getAiSettings() {   // AIの設定を読む関数
  try {   // 読めない時に止まらないように
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");    // 保存してある設定
    const merged = { ...DEFAULTS, ...saved };   // はじめの設定に、保存したものを上書き
    // 本番（Supabase）では、スマホに Gemini の鍵を置く「直接」を使わせない（2026年11月16日・セキュリティ）
    // 2026年11月17日：Worker の住所の有無ではなく「本番かどうか」で決める。前に保存した鍵も、この機械から消す
    if (isProduction()) {   // 本番なら
      if (merged.mode === "gemini") merged.mode = "worker";   // 直接はやめて Worker にする
      merged.apiKey = "";   // 鍵は使わない
      if ("apiKey" in saved || saved.mode === "gemini") localStorage.setItem(KEY, JSON.stringify({ ...saved, mode: merged.mode, apiKey: undefined }));   // 前に保存した鍵をこの機械から消す
    }
    return merged;   // 返す
  } catch {   // 読めなかった時
    return { ...DEFAULTS };   // はじめの設定を返す
  }
}

/** 設定を保存する（変えたところだけ渡せばよい） */
export function saveAiSettings(patch) {   // AIの設定を保存する関数
  const next = { ...getAiSettings(), ...patch };                     // 新しい設定
  if (isProduction()) { if (next.mode === "gemini") next.mode = "worker"; next.apiKey = ""; }   // 本番では「直接」にしない（鍵をスマホに残さない）
  const stored = isProduction() ? { ...next, apiKey: undefined } : next;   // 本番では鍵を保存しない（JSON にすると消える）
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* 保存できない機械（プライベートブラウズ）でも止めない */ }
  return next;   // 保存した設定を返す
}

/**
 * 今、本物のAIを使える設定になっているか
 * @returns {{ok:boolean, why?:string}} 使えなければ why に理由
 */
export function aiReady(settings = getAiSettings()) {   // AIを使えるか調べる関数
  if (settings.mode === "local") return { ok: false, why: "AIを使わない設定です" };   // 「使わない」設定
  if (settings.mode === "gemini" && !settings.apiKey) return { ok: false, why: "Gemini の鍵が入っていません" };   // Gemini の鍵がない
  if (settings.mode === "worker" && !workerReady()) return { ok: false, why: "サーバー（Supabase と Worker）がまだつながっていません" };   // サーバーがつながっていない
  if (!settings.model) return { ok: false, why: "モデルの名前が入っていません" };   // モデルの名前がない
  return { ok: true };   // 使える
}

/** 本番（本物の Supabase につないでいる）か。本番では「スマホから直接 Gemini」を使わせない（2026年11月17日） */
export function isProduction() {   // 本番か調べる関数
  return CONFIG.API_MODE === "supabase";   // Supabase につないでいれば本番
}

/** サーバー経由（Worker）を使える準備ができているか（本物につないでいて、Worker のURLがある） */
export function workerReady() {   // サーバー経由のAIを使えるか調べる関数
  return CONFIG.API_MODE === "supabase" && !!CONFIG.API_WORKER_URL;   // 本物版で Worker の住所があればOK
}

/** Worker の /ai の住所 */
export function workerAiUrl() {   // AIのお願いを送る住所を作る関数
  return `${CONFIG.API_WORKER_URL.replace(/\/$/, "")}/ai`;   // 最後の / を消して /ai を付ける
}

/**
 * ログインの印（Worker に「ログインした店長です」と伝えるため）
 * 本物（Supabase）の時だけある
 */
export async function authToken() {   // ログインの証明（トークン）を出す関数
  if (CONFIG.API_MODE !== "supabase") return "";   // テスト版では空
  const { supabaseClient } = await import("../api/supabase/core.js");          // Supabase の道具
  const { data } = await (await supabaseClient()).auth.getSession();            // ログインの情報
  return data?.session?.access_token || "";   // トークンを返す（なければ空）
}
