// ============================================================
// api/index.js — 「データのやりとり」の入口
// ------------------------------------------------------------
// このファイルは、「データのやりとり」の入口のファイルです。
// 画面のファイルは、必ずここから api を読み込む：
//   import { api } from "../api/index.js";
//   const members = await api.listMembers();
//
// config.js の API_MODE で、見本データ と 本物（Supabase）を切り替える。
//   SUPABASE_URL が空 → mock-api.js（見本データ）
//   SUPABASE_URL あり → supabase-api.js（本物。2026年11月6日）
// 画面側は「どちらにつながっているか」を気にしなくてよい。
// ============================================================

import { CONFIG } from "../config.js";
import { mockApi } from "./mock-api.js";
import { readCache, writeCache } from "../lib/offline-cache.js";

/**
 * 見本か本物（Supabase）かを選ぶ
 * 本物の時だけ supabase-api.js を読む（見本の時は読まないので軽い）
 */
async function pickApi() {
  if (CONFIG.API_MODE === "supabase") return (await import("./supabase-api.js")).supabaseApi;
  return mockApi;
}

const base = await pickApi();   // 選んだ方のAPI

/**
 * 画面が使う api
 * 「自分の勤務」だけは、読めたらスマホにも保存し、
 * サーバーにつながらない時はスマホに保存した分を返す（lib/offline-cache.js）
 */
export const api = {
  ...base,
  /** 自分の勤務（読めたらスマホに保存、読めなければスマホの分） */
  async listMyAssignments() {
    const user = await base.currentUser().catch(() => null);   // ログイン中の人
    const id = user?.id;   // その人のID
    try {
      const fresh = await base.listMyAssignments();   // サーバーから読んだ自分の勤務
      return id ? writeCache(id, fresh) : fresh;
    } catch (error) {
      console.warn("サーバーにつながらないので、スマホに保存した自分のシフトを出します", error);
      return id ? readCache(id) : [];
    }
  },
};
