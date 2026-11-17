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

import { CONFIG } from "../config.js";   // 設定（どちらの版を使うか）を読む
import { readCache, writeCache } from "../lib/offline-cache.js";   // 自分のシフトをスマホにしまう道具を読む

/**
 * 見本か本物（Supabase）かを選ぶ
 * 本物の時だけ supabase-api.js を読む（見本の時は読まないので軽い）
 * 見本の時だけ mock-api.js を読む（本番では読まない＝見本のパスワード 1234 は本番に入らない。2026年11月17日）
 */
async function pickApi() {   // 使う窓口を選ぶ関数
  if (CONFIG.API_MODE === "supabase") return (await import("./supabase-api.js")).supabaseApi;   // Supabase の設定があれば本物版を読んで使う
  return (await import("./mock-api.js")).mockApi;   // なければテスト版を読んで使う
}

const base = await pickApi();   // 選んだ方のAPI

/**
 * 画面が使う api
 * 「自分の勤務」だけは、読めたらスマホにも保存し、
 * サーバーにつながらない時はスマホに保存した分を返す（lib/offline-cache.js）
 */
export const api = {   // 画面が使う窓口（選んだ版＋少し足したもの）
  ...base,   // 選んだ版の関数を全部そのまま使う
  /** 自分の勤務（読めたらスマホに保存、読めなければスマホの分） */
  async listMyAssignments() {   // 自分のシフト（電波がない時はしまったものを出す）
    const user = await base.currentUser().catch(() => null);   // ログイン中の人
    const id = user?.id;   // その人のID
    try {   // まずサーバーから読んでみる
      const fresh = await base.listMyAssignments();   // サーバーから読んだ自分の勤務
      return id ? writeCache(id, fresh) : fresh;   // 読めたらスマホにもしまって返す
    } catch (error) {   // 読めなかった時
      console.warn("サーバーにつながらないので、スマホに保存した自分のシフトを出します", error);   // 理由を開発者用に残す
      return id ? readCache(id) : [];   // しまっておいたシフトを返す
    }
  },
};
