// ============================================================
// api/index.js — 「データのやりとり」の入口
// ------------------------------------------------------------
// 画面のファイルは、必ずここから api を読み込む：
//   import { api } from "../api/index.js";
//   const members = await api.listMembers();
//
// config.js の API_MODE で、見本データ と 本物（Supabase）を切り替える。
// 画面側は「どちらにつながっているか」を気にしなくてよい。
// ============================================================

import { CONFIG } from "../config.js";
import { mockApi } from "./mock-api.js";
import { readCache, writeCache } from "../lib/offline-cache.js";

function pickApi() {
  if (CONFIG.API_MODE === "mock") return mockApi;
  // "supabase" は段階1で supabase-api.js を作ってからつなぐ
  throw new Error(`API_MODE "${CONFIG.API_MODE}" はまだ作っていません`);
}

const base = pickApi();

/**
 * 画面が使う api
 * 「自分の勤務」だけは、読めたらスマホにも保存し、
 * サーバーにつながらない時はスマホに保存した分を返す（lib/offline-cache.js）
 */
export const api = {
  ...base,
  async listMyAssignments() {
    const user = await base.currentUser().catch(() => null);
    const id = user?.id;
    try {
      const fresh = await base.listMyAssignments();
      return id ? writeCache(id, fresh) : fresh;
    } catch (e) {
      console.warn("サーバーにつながらないので、スマホに保存した自分のシフトを出します", e);
      return id ? readCache(id) : [];
    }
  },
};
