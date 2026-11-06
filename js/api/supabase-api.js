// ============================================================
// api/supabase-api.js — 本物（Supabase）につなぐ api
// ------------------------------------------------------------
// このファイルは、js/api/supabase/ の中の関数を1つにまとめて、
// mock-api.js（見本データ）と同じ名前・同じ形で使えるようにするファイルです（2026年11月6日）。
// どちらを使うかは api/index.js が config.js の SUPABASE_URL で決める。
// ============================================================

import { authApi } from "./supabase/auth.js";         // ログイン
import { storesApi } from "./supabase/stores.js";     // 店舗・営業時間・マップ・必要人数
import { membersApi } from "./supabase/members.js";   // 店員・ルール・時給
import { periodsApi } from "./supabase/periods.js";   // 週・希望・勤務
import { noticesApi } from "./supabase/notices.js";   // お知らせ・確認・交代
import { callsApi } from "./supabase/calls.js";       // 人が足りない時の自動連絡
import { aiApi } from "./supabase/ai.js";             // AIの下書き・学び
import { backupApi } from "./supabase/backup.js";     // データの書き出し

/** 画面が使う関数（mock-api.js と同じ名前） */
export const supabaseApi = {   // 本物（Supabase）版の窓口。下の部品を1つにまとめる
  ...authApi,   // ログイン・パスワード
  ...storesApi,   // 店舗
  ...membersApi,   // 店員
  ...periodsApi,   // シフト（週・希望・勤務）
  ...noticesApi,   // お知らせ・確認・交代
  ...callsApi,   // 人が足りない時の連絡
  ...aiApi,   // AIの下書きと覚えたこと
  ...backupApi,   // バックアップ
  /** 見本データを戻す（本物では使えない） */
  async resetMock() {   // テスト版にだけある「最初にもどす」
    throw new Error("本物のデータは戻せません");   // 本物ではできないのでエラーにする
  },
};
