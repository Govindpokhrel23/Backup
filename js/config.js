// ============================================================
// config.js — アプリの設定（ここだけ見れば動き方が分かる）
// ------------------------------------------------------------
// このファイルは、アプリの設定（ここだけ見れば動き方が分かる）のファイルです。
// ・本物（Supabase）につなぐ時に入れるのは、下の3つだけ（2026年11月6日）
//     SUPABASE_URL      … Supabase の Project URL（例 https://abcd.supabase.co）
//     SUPABASE_ANON_KEY … Supabase の Publishable key（sb_publishable_…。古い画面では anon key）＝「画面に置いてよい鍵」
//     API_WORKER_URL    … Cloudflare Worker のURL（アカウント作成・AI。workers/api）
//   SUPABASE_URL が空なら、見本データ（mock）で動く。入れると本物につながる。
//   ※ Secret key（sb_secret_…／古い service_role）・Gemini の鍵は、絶対にここに書かない（Worker の中にだけ置く）
// ============================================================

export const CONFIG = {   // アプリの設定をまとめたもの
  // ---------- 本物につなぐ設定 ----------
  SUPABASE_URL: "https://stvaodfduawfbiuvgrji.supabase.co",   // Supabase の住所（空ならテスト版）
  SUPABASE_ANON_KEY: "sb_publishable_dC5LVe6V8gcrHLeoG1OHOg_ye-ZvHrV",   // Supabase の Publishable key（公開してよい鍵だけ）
  API_WORKER_URL: "https://shiftapp-api.govindpokhrel23.workers.dev",   // Worker の住所
  // プッシュ通知の鍵（公開してよい方）。tools/make-vapid.html で作る。空なら通知は使わない（2026年11月6日）
  VAPID_PUBLIC_KEY: "",   // 通知の公開してよい鍵

  // 見本か本物か（SUPABASE_URL があれば本物。下の一番最後で決める）
  API_MODE: "mock",   // 使う版（下で自動で決まる）

  // Supabase をブラウザで使う道具（バージョンを決めて読む。勝手に新しくならないように）
  SUPABASE_JS_URL: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm",   // Supabase のプログラムの場所

  // ログインIDを Supabase のメールの形にする時の後ろ（メールは送らない。example.com は使われない決まりの名前）
  LOGIN_EMAIL_DOMAIN: "login.shiftapp.example.com",   // ログインIDをメールの形にする時の後ろ

  // パスワードの一番短い長さ（Supabase の決まりに合わせる）
  PASSWORD_MIN: 6,   // パスワードの最低の文字数

  // 営業時間の表示範囲（シフト表の左端と右端）
  DAY_START: 7 * 60,    // 7:00
  DAY_END: 22 * 60,     // 22:00

  // 立ち上げの人は開店の何分前から入るか（7:00開店なら6:30から。立ち上げは1人）
  OPEN_PREP_MIN: 30,   // 立ち上げは開店の30分前

  // 長い勤務とみなす長さ（これ以上なら休憩が必要）
  BREAK_NEEDED_MIN: 6 * 60,   // 6時間をこえたら休憩

  // 休憩を入れてよい一番早い時刻（朝11:00より前は休憩を入れない）
  BREAK_EARLIEST: 11 * 60,   // 休憩は11時より前に置かない

  // 希望とシフトを作れる先の長さ（か月）
  MONTHS_AHEAD: 2,   // 2か月先まで希望を出せる

  // 社員の休み希望（週）2026年11月5日に変更
  //   1日目はふつうに出せる。2日目は店長の「特別許可」がいる。3日目からは出せない
  SHAIN_OFF_FREE: 1,    // 許可なしで出せる休み希望の日数
  SHAIN_OFF_MAX: 2,     // 休み希望を出せる一番多い日数（特別許可を入れて）

  // 続けて働いてよい日数（連勤の上限）。これより多いとチェックで注意が出る（rules/labor-rules.js）
  MAX_STREAK_DAYS: 6,   // 連勤は6日まで
  MAX_SHIFT_MINUTES: 9 * 60,   // AIの下書きで、1回の勤務は9時間まで（休憩こみ。社員の朝・夜の形と同じ。2026年11月15日）

  // ---------- AI（Gemini）2026年11月5日 ----------
  // つなぎ方の最初の設定（店長が「AIの設定」画面で変えられる。ai/ai-settings.js）
  //   "gemini" … この機械から直接（鍵はこの機械だけに保存）／ "worker" … Cloudflare Worker を通す ／ "local" … AIなし
  AI_MODE: "gemini",   // AIの使い方（はじめは Gemini）
  // 使うモデル（Google AI Studio の無料枠で使えるもの。変わったら「AIの設定」で変える）
  AI_MODEL: "gemini-3-flash-preview",   // 使うAIのモデル
  // うまく動かない時に、次に試すモデル
  AI_MODEL_FALLBACK: "gemini-3.1-flash-lite",   // 混んでいる時に使う軽いモデル
  // AIの返事を待つ一番長い時間（ミリ秒）。90秒
  AI_TIMEOUT_MS: 90000,   // AIの返事を待つ最大の時間（90秒）

  // 人が足りない時の自動連絡：1つの募集で何人まで知らせるか（入れそうな順に上から）
  CALL_MAX_PEOPLE: 8,   // 1回に連絡する人数の上限
  // 公開の時に自動で送る募集の一番多い数（足りない時間が多すぎる時に、連絡だらけにしないため）
  CALL_AUTO_MAX: 10,   // 自動で連絡する人数の上限
  // 自動で送る募集の一番短い長さ（分）。これより短い不足は送らない
  CALL_MIN_MIN: 60,   // 60分より短い不足は連絡しない

  // 立場の名前（画面に出す文字）
  KIND_LABEL: {   // 立場の名前
    shain: "社員",   // 社員
    baito: "バイト",   // バイト
    full: "フルで入るバイト",   // フルで入るバイト
  },

  // できること（4項目）
  SKILLS: [   // できることの種類
    { key: "hall", label: "ホール" },   // ホール
    { key: "kitchen", label: "キッチン" },   // キッチン
    { key: "open", label: "立ち上げ" },   // 立ち上げ
    { key: "close", label: "締め" },   // 締め
  ],
  SKILL_LEVELS: [0, 25, 50, 75, 100],   // できること％の選べる数字
};

// SUPABASE_URL が入っていれば本物（Supabase）につなぐ
CONFIG.API_MODE = CONFIG.SUPABASE_URL ? "supabase" : "mock";   // Supabase の住所があれば本物版、なければテスト版
