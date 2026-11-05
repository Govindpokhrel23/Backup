// ============================================================
// ai/ai-settings.js — AI（Gemini）のつなぎ方の設定
// ------------------------------------------------------------
// このファイルは、AIをどうやって使うか（つなぎ方・鍵・モデル）を
// この機械（店長のスマホ・パソコン）に保存して読むためのファイルです（2026年11月5日）。
//
// つなぎ方（mode）は3つ：
//   "worker" … Cloudflare Worker（workers/ai-proxy）を通す。鍵はサーバーにだけ置く ← 本番はこれ
//   "gemini" … この機械から直接 Gemini を呼ぶ。鍵はこの機械にだけ保存する ← 今日すぐ試す用
//   "local"  … AIを使わない（簡易版の下書きだけ）
// ※鍵はプログラム（GitHub など）には絶対に書かない。この設定画面から入れる。
// ============================================================

import { CONFIG } from "../config.js";

/** この機械に保存する時の名前 */
const KEY = "shiftapp-ai-settings";

/** 最初の設定（何も入れていない時） */
const DEFAULTS = {
  mode: CONFIG.AI_MODE,          // つなぎ方
  apiKey: "",                    // Gemini の鍵（mode "gemini" の時だけ使う）
  model: CONFIG.AI_MODEL,        // 使うモデルの名前
  workerUrl: CONFIG.AI_WORKER_URL, // Cloudflare Worker のURL（mode "worker" の時）
  appToken: "",                  // Worker に入るための合言葉（Worker 側の APP_TOKEN と同じもの）
};

/** 設定を読む（保存がなければ最初の設定） */
export function getAiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");    // 保存してある設定
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 設定を保存する（変えたところだけ渡せばよい） */
export function saveAiSettings(patch) {
  const next = { ...getAiSettings(), ...patch };                     // 新しい設定
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 保存できない機械（プライベートブラウズ）でも止めない */ }
  return next;
}

/**
 * 今、本物のAIを使える設定になっているか
 * @returns {{ok:boolean, why?:string}} 使えなければ why に理由
 */
export function aiReady(s = getAiSettings()) {
  if (s.mode === "local") return { ok: false, why: "AIを使わない設定です" };
  if (s.mode === "gemini" && !s.apiKey) return { ok: false, why: "Gemini の鍵が入っていません" };
  if (s.mode === "worker" && !s.workerUrl) return { ok: false, why: "Worker のURLが入っていません" };
  if (!s.model) return { ok: false, why: "モデルの名前が入っていません" };
  return { ok: true };
}
