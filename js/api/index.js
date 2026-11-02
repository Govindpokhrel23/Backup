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

function pickApi() {
  if (CONFIG.API_MODE === "mock") return mockApi;
  // "supabase" は段階1で supabase-api.js を作ってからつなぐ
  throw new Error(`API_MODE "${CONFIG.API_MODE}" はまだ作っていません`);
}

export const api = pickApi();
