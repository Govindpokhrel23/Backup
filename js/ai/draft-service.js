// ============================================================
// ai/draft-service.js — 「AIで作成」「AIに直してもらう」の流れ
// ------------------------------------------------------------
// このファイルは、シフト作成の画面から呼ばれて、AIで下書きを作る流れを
// 最初から最後まで受け持つファイルです（2026年11月5日）。
//
// 「AIで作成」の流れ：
//   ① 店長の直し方（学び）をまとめる                    … learning.js
//   ② 簡易版で「たたき台」を作る（学びも使う）           … simple-draft.js
//   ③ Gemini に、たたき台をもっとよくしてもらう           … prompt.js → gemini.js
//   ④ AIの答えを確かめる（おかしいものは外す）           … validate.js
//   ⑤ AI と たたき台 の「守れていないルールの数」を比べて、よい方を使う
//   ⑥ 結果のまとめ（AIのひとこと・理由・外したもの）を返す → 画面の「AIの結果」に出る
// AIがつながっていない・エラーの時は、たたき台をそのまま使う（止まらない）。
//
// ctx（画面から渡す情報）：
//   dates, members, availabilities, requirements, positions, fixed, past,
//   dayTypeOf, hoursOf, elsewhere, rules, learnings,
//   problemsOf(rows) … その勤務の一覧で守れていないルールの一覧を返す関数
// ============================================================

import { CONFIG } from "../config.js";
import { makeDraft } from "./simple-draft.js";
import { summarize } from "./learning.js";
import { buildDraftPrompt, buildFixPrompt } from "./prompt.js";
import { askGemini } from "./gemini.js";
import { cleanShifts } from "./validate.js";
import { getAiSettings, aiReady } from "./ai-settings.js";

/** AIの案が たたき台 より何個まで多く問題があっても AI を使うか（AIは理由もつくので少しは許す） */
const AI_TOLERANCE = 1;

/**
 * Gemini に聞く。モデルが使えない時は、次のモデル（CONFIG.AI_MODEL_FALLBACK）で聞き直す
 * @returns {Promise<{answer:object, model:string}>}
 */
async function askWithFallback(settings, prompt, schema, fetchImpl) {
  try {
    return { answer: await askGemini({ settings, prompt, schema, fetchImpl }), model: settings.model };
  } catch (e) {
    const canRetry = /このモデルは使えません|混んでいます/.test(e.message) && CONFIG.AI_MODEL_FALLBACK && settings.model !== CONFIG.AI_MODEL_FALLBACK;   // モデルが使えない・混んでいる時だけ、次のモデルで聞き直す
    if (!canRetry) throw e;
    const next = { ...settings, model: CONFIG.AI_MODEL_FALLBACK };      // 次のモデル
    return { answer: await askGemini({ settings: next, prompt, schema, fetchImpl }), model: next.model };
  }
}

/**
 * 「AIで作成」
 * @param {object} ctx  上の説明の ctx
 * @param {object} [opt]
 * @param {(text:string)=>void} [opt.onStep]  いま何をしているか（画面に出す）
 * @param {typeof fetch} [opt.fetchImpl]       テスト用
 * @returns {Promise<{
 *   rows:object[], source:"gemini"|"local", model?:string, summary:string, concerns:string[],
 *   dropped:string[], problems:object[], compare?:{ai:number, local:number}, error?:string, why?:string, learnedCount:number
 * }>}
 */
export async function runAiDraft(ctx, opt = {}) {
  const step = opt.onStep || (() => {});                                // 進み具合を知らせる
  // ① 学びをまとめる
  step("店長の直し方を読んでいます");
  const learned = summarize(ctx.learnings || [], ctx.members);          // 学びのまとめ
  const learnedCount = learned.notes.filter((n) => n.strong).length;    // 覚えている数（2回以上）

  // ② たたき台
  step("たたき台を作っています");
  const baseline = makeDraft({ ...ctx, learned });                      // 簡易版の下書き
  const baseProblems = ctx.problemsOf(baseline);                        // その問題

  // AIが使えない設定 → たたき台だけ
  const settings = getAiSettings();                                     // AIの設定
  const ready = aiReady(settings);   // 使えるかどうかと、使えない理由
  if (!ready.ok) {
    return { rows: baseline, source: "local", summary: "", concerns: [], dropped: [], problems: baseProblems, why: ready.why, learnedCount };
  }

  try {
    // ③ Gemini に聞く
    step("AI（Gemini）が考えています（30秒〜1分くらい）");
    const { prompt, schema, toId } = buildDraftPrompt({ ...ctx, learned }, baseline);   // 送る文・答えの形・番号→IDの表
    const { answer, model } = await askWithFallback(settings, prompt, schema, opt.fetchImpl);   // AIの答えと、実際に使ったモデル

    // ④ 確かめる
    step("AIの答えを確かめています");
    const { rows, dropped } = cleanShifts(answer.shifts, ctx, toId);   // 使える勤務と、外した理由
    const aiProblems = ctx.problemsOf(rows);                            // AIの案の問題

    // ⑤ よい方を使う
    const compare = { ai: aiProblems.length, local: baseProblems.length };
    const aiUsable = rows.some((a) => !a.fixed) && aiProblems.length <= baseProblems.length + AI_TOLERANCE;   // AIの案を使ってよいか（勤務があり、問題がたたき台＋1件以内）
    if (!aiUsable) {
      return {
        rows: baseline, source: "local", model, summary: answer.summary || "", concerns: answer.concerns || [], dropped,
        problems: baseProblems, compare, learnedCount,
        why: `AIの案は守れていないルールが ${aiProblems.length}件 で、たたき台（${baseProblems.length}件）より多かったので、たたき台を使いました`,
      };
    }
    // ⑥ 結果
    return { rows, source: "gemini", model, summary: answer.summary || "", concerns: answer.concerns || [], dropped, problems: aiProblems, compare, learnedCount };
  } catch (e) {
    // エラー → たたき台を使う（止まらない）
    return { rows: baseline, source: "local", summary: "", concerns: [], dropped: [], problems: baseProblems, error: e.message, learnedCount };
  }
}

/**
 * 「AIに直してもらう」：今のシフトの守れていないルールだけ直してもらう
 * 直したあとの方が問題が多ければ、使わない（applied:false）
 * @param {object} ctx       上の説明の ctx
 * @param {object[]} current 今の勤務
 * @param {{day:string,text:string}[]} problems 守れていないルール
 * @returns {Promise<{applied:boolean, rows:object[], summary:string, concerns:string[], dropped:string[], before:number, after:number, model?:string, error?:string}>}
 */
export async function fixWithAi(ctx, current, problems, opt = {}) {
  const settings = getAiSettings();   // AIの設定
  const ready = aiReady(settings);   // 使えるかどうか
  if (!ready.ok) return { applied: false, rows: current, summary: "", concerns: [], dropped: [], before: problems.length, after: problems.length, error: ready.why };
  try {
    opt.onStep?.("AIが直しています");
    const learned = summarize(ctx.learnings || [], ctx.members);   // 店長の直し方のまとめ
    const { prompt, schema, toId } = buildFixPrompt({ ...ctx, learned }, current, problems);   // 送る文・答えの形・番号→IDの表
    const { answer, model } = await askWithFallback(settings, prompt, schema, opt.fetchImpl);   // AIの答えと、使ったモデル
    const { rows, dropped } = cleanShifts(answer.shifts, { ...ctx, fixed: current.filter((a) => a.fixed) }, toId);   // 使える勤務と外した理由（固定は今のまま）
    const after = ctx.problemsOf(rows).length;                          // 直したあとの問題の数
    return { applied: after < problems.length, rows, summary: answer.summary || "", concerns: answer.concerns || [], dropped, before: problems.length, after, model };
  } catch (e) {
    return { applied: false, rows: current, summary: "", concerns: [], dropped: [], before: problems.length, after: problems.length, error: e.message };
  }
}
