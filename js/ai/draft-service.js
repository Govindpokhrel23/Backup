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
//      覚えた直し方（2回以上同じ直し）は、AIの答えにも必ず入れる … apply-learned.js（2026年11月17日）
//   ⑤ AI と たたき台 の「守れていないルールの数」を比べて、よい方を使う
//   ⑥ 結果のまとめ（AIのひとこと・理由・外したもの）を返す → 画面の「AIの結果」に出る
// AIがつながっていない・エラーの時は、たたき台をそのまま使う（止まらない）。
//
// ctx（画面から渡す情報）：
//   dates, members, availabilities, requirements, positions, fixed, past,
//   dayTypeOf, hoursOf, elsewhere, rules, learnings, patterns（過去のシフトのいつもの形。past-patterns.js）,
//   problemsOf(rows) … その勤務の一覧で守れていないルールの一覧を返す関数
// ============================================================

import { CONFIG } from "../config.js";   // 設定を読む
import { makeDraft } from "./simple-draft.js";   // AIなしで作るたたき台の関数を読む
import { summarize } from "./learning.js";   // 覚えたことをまとめる関数を読む
import { withPatterns } from "./past-patterns.js";   // 過去のシフトの「いつもの形」を足す関数を読む（2026年11月22日）
import { buildDraftPrompt, buildFixPrompt } from "./prompt.js";   // AIに送る文を作る関数を読む
import { askGemini } from "./gemini.js";   // Gemini に送る関数を読む
import { cleanShifts } from "./validate.js";   // AIの答えを確かめて直す関数を読む
import { applyLearned } from "./apply-learned.js";   // 覚えた直し方をAIの答えにも入れる関数を読む（2026年11月17日）
import { getAiSettings, aiReady } from "./ai-settings.js";   // AIの設定を読む関数

/** AIの案が たたき台 より何個まで多く問題があっても AI を使うか（AIは理由もつくので少しは許す） */
const AI_TOLERANCE = 1;   // AIの案はたたき台より問題が1件多いまでなら使う

/**
 * Gemini に聞く。モデルが使えない時は、次のモデル（CONFIG.AI_MODEL_FALLBACK）で聞き直す
 * @returns {Promise<{answer:object, model:string}>}
 */
async function askWithFallback(settings, prompt, schema, fetchImpl) {   // だめなら軽いモデルでもう一度聞く関数
  try {   // まずふつうのモデルで
    return { answer: await askGemini({ settings, prompt, schema, fetchImpl }), model: settings.model };   // 答えと使ったモデルを返す
  } catch (error) {   // 失敗した時
    const canRetry = /このモデルは使えません|混んでいます/.test(error.message) && CONFIG.AI_MODEL_FALLBACK && settings.model !== CONFIG.AI_MODEL_FALLBACK;   // モデルが使えない・混んでいる時だけ、次のモデルで聞き直す
    if (!canRetry) throw error;   // やり直せない失敗ならそのままエラー
    const next = { ...settings, model: CONFIG.AI_MODEL_FALLBACK };      // 次のモデル
    return { answer: await askGemini({ settings: next, prompt, schema, fetchImpl }), model: next.model };   // 軽いモデルで聞いて返す
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
export async function runAiDraft(ctx, opt = {}) {   // AIで1週間の下書きを作る関数
  const step = opt.onStep || (() => {});                                // 進み具合を知らせる
  // ① 学びをまとめる
  step("店長の直し方・過去のシフトを読んでいます");   // 進み具合を画面に出す
  const learned = withPatterns(summarize(ctx.learnings || [], ctx.members), ctx.patterns);   // 学びのまとめ＋過去のシフトのいつもの形
  const learnedCount = learned.notes.filter((note) => note.strong).length;    // 覚えている数（2回以上）
  const patternCount = learned.patternCount;   // 使った「いつもの形」の数（2026年11月22日）

  // ② たたき台
  step("たたき台を作っています");   // 進み具合を画面に出す
  const baseline = makeDraft({ ...ctx, learned });                      // 簡易版の下書き
  const baseProblems = ctx.problemsOf(baseline);                        // その問題

  // AIが使えない設定 → たたき台だけ
  const settings = getAiSettings();                                     // AIの設定
  const ready = aiReady(settings);   // 使えるかどうかと、使えない理由
  if (!ready.ok) {   // AIを使えない時は
    return { rows: baseline, source: "local", summary: "", concerns: [], dropped: [], problems: baseProblems, why: ready.why, learnedCount, patternCount };   // たたき台をそのまま返す（理由つき）
  }

  try {   // AIが失敗しても止まらないように
    // ③ Gemini に聞く
    step("AI（Gemini）が考えています（30秒〜1分くらい）");   // 進み具合を画面に出す
    const { prompt, schema, toId } = buildDraftPrompt({ ...ctx, learned }, baseline);   // 送る文・答えの形・番号→IDの表
    const { answer, model } = await askWithFallback(settings, prompt, schema, opt.fetchImpl);   // AIの答えと、実際に使ったモデル

    // ④ 確かめる
    step("AIの答えを確かめています");   // 進み具合を画面に出す
    const cleaned = cleanShifts(answer.shifts, ctx, toId);   // 使える勤務と、外した理由
    const dropped = cleaned.dropped;   // 外した理由
    const rows = applyLearned(cleaned.rows, learned, ctx).rows;   // 覚えた直し方を必ず入れる（AIが守らなかった時も。2026年11月17日）
    const aiProblems = ctx.problemsOf(rows);                            // AIの案の問題

    // ⑤ よい方を使う
    const compare = { ai: aiProblems.length, local: baseProblems.length };   // AIとたたき台の問題の数
    const aiUsable = rows.some((row) => !row.fixed) && aiProblems.length <= baseProblems.length + AI_TOLERANCE;   // AIの案を使ってよいか（勤務があり、問題がたたき台＋1件以内）
    if (!aiUsable) {   // AIの案の方が悪ければ
      return {   // たたき台を返す
        rows: baseline, source: "local", model, summary: answer.summary || "", concerns: answer.concerns || [], dropped,   // たたき台・AIのまとめ・気になる点・外したもの
        problems: baseProblems, compare, learnedCount, patternCount,   // 問題の一覧・くらべた数・覚えた数
        why: `AIの案は守れていないルールが ${aiProblems.length}件 で、たたき台（${baseProblems.length}件）より多かったので、たたき台を使いました`,   // たたき台を使った理由
      };
    }
    // ⑥ 結果
    return { rows, source: "gemini", model, summary: answer.summary || "", concerns: answer.concerns || [], dropped, problems: aiProblems, compare, learnedCount, patternCount };   // AIの案を返す
  } catch (error) {   // AIが失敗した時
    // エラー → たたき台を使う（止まらない）
    return { rows: baseline, source: "local", summary: "", concerns: [], dropped: [], problems: baseProblems, error: error.message, learnedCount, patternCount };   // たたき台を返す（エラーの文つき）
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
export async function fixWithAi(ctx, current, problems, opt = {}) {   // 今のシフトの問題をAIに直してもらう関数
  const settings = getAiSettings();   // AIの設定
  const ready = aiReady(settings);   // 使えるかどうか
  if (!ready.ok) return { applied: false, rows: current, summary: "", concerns: [], dropped: [], before: problems.length, after: problems.length, error: ready.why };   // AIを使えなければ、そのまま返す
  try {   // AIが失敗しても止まらないように
    opt.onStep?.("AIが直しています");   // 進み具合を画面に出す
    const learned = withPatterns(summarize(ctx.learnings || [], ctx.members), ctx.patterns);   // 店長の直し方＋過去のシフトのいつもの形
    const { prompt, schema, toId } = buildFixPrompt({ ...ctx, learned }, current, problems);   // 送る文・答えの形・番号→IDの表
    const { answer, model } = await askWithFallback(settings, prompt, schema, opt.fetchImpl);   // AIの答えと、使ったモデル
    const { rows, dropped } = cleanShifts(answer.shifts, { ...ctx, fixed: current.filter((shift) => shift.fixed) }, toId);   // 使える勤務と外した理由（固定は今のまま）
    const after = ctx.problemsOf(rows).length;                          // 直したあとの問題の数
    return { applied: after < problems.length, rows, summary: answer.summary || "", concerns: answer.concerns || [], dropped, before: problems.length, after, model };   // 問題が減ったら使う
  } catch (error) {   // AIが失敗した時
    return { applied: false, rows: current, summary: "", concerns: [], dropped: [], before: problems.length, after: problems.length, error: error.message };   // そのまま返す（エラーの文つき）
  }
}
