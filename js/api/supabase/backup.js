// ============================================================
// api/supabase/backup.js — データの書き出し（バックアップ）（本物）
// ------------------------------------------------------------
// このファイルは、店長が見られる全部のデータを1つの JSON（文字のファイル）にまとめるファイルです（2026年11月6日）。
// Supabase の無料プランは自動のバックアップがないので、月に1回くらい店長が保存しておく。
// ※初回コード・パスワードは入らない（アプリからは見えない決まり）
// ============================================================

import { supabaseClient, requireManager, readAll } from "./core.js";

/**
 * 書き出す表と、並べる列（1000行ずつ読む時に、順番がずれないように並べる）
 * [表の名前, 並べる列]
 */
const TABLES = [
  ["companies", "id"], ["stores", "id"], ["members", "id"], ["member_rules", "member_id"], ["wages", "member_id"],
  ["positions", "id"], ["requirements", "id"], ["periods", "id"], ["availabilities", "member_id"], ["assignments", "id"],
  ["notifications", "id"], ["confirms", "period_id"], ["swaps", "id"], ["calls", "id"], ["ai_drafts", "period_id"],
  ["learnings", "id"], ["holidays", "date"],
];

/** 画面の関数（supabase-api.js で合体する） */
export const backupApi = {
  /** 全部のデータ（店長が見られる分）を1つにまとめる */
  async exportAll() {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const tables = {};      // 表の名前 → 行の一覧
    for (const [name, key] of TABLES) {
      tables[name] = await readAll(() => client.from(name).select("*").order(key));
    }
    return { app: "shiftapp", kind: "supabase", exportedAt: new Date().toISOString(), tables };
  },
};
