// ============================================================
// api/supabase/backup.js — データの書き出し（バックアップ）（本物）
// ------------------------------------------------------------
// このファイルは、店長が見られる全部のデータを1つの JSON（文字のファイル）にまとめるファイルです（2026年11月6日）。
// Supabase の無料プランは自動のバックアップがないので、月に1回くらい店長が保存しておく。
// ※初回コード・パスワードは入らない（アプリからは見えない決まり）
// ============================================================

import { supabaseClient, requireManager, readAll } from "./core.js";   // Supabase の道具・店長チェック・全部読む関数を読む

/**
 * 書き出す表と、並べる列（1000行ずつ読む時に、順番がずれないように並べる）
 * [表の名前, 並べる列]
 */
const TABLES = [   // バックアップする表（表の名前, 並べる列）
  ["companies", "id"], ["stores", "id"], ["members", "id"], ["member_rules", "member_id"], ["wages", "member_id"],   // 会社・店舗・店員・店員のルール・時給
  ["positions", "id"], ["requirements", "id"], ["periods", "id"], ["availabilities", "member_id"], ["assignments", "id"],   // 場所・必要な人数・週・希望・勤務
  ["notifications", "id"], ["confirms", "period_id"], ["swaps", "id"], ["calls", "id"], ["ai_drafts", "period_id"],   // お知らせ・確認・交代・連絡・AIの下書き
  ["learnings", "id"], ["holidays", "date"],   // 覚えたこと・祝日
];

/** 画面の関数（supabase-api.js で合体する） */
export const backupApi = {   // バックアップの窓口
  /** 全部のデータ（店長が見られる分）を1つにまとめる */
  async exportAll() {   // 全部の表を読んで1つにまとめる関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const tables = {};      // 表の名前 → 行の一覧
    for (const [name, key] of TABLES) {   // 表を1つずつ
      tables[name] = await readAll(() => client.from(name).select("*").order(key));   // その表を全部読む（1000行ずつ）
    }
    return { app: "shiftapp", kind: "supabase", exportedAt: new Date().toISOString(), tables };   // アプリ名・種類・作った時間・中身を返す
  },
};
