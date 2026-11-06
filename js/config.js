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

export const CONFIG = {
  // ---------- 本物につなぐ設定 ----------
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  API_WORKER_URL: "",

  // 見本か本物か（SUPABASE_URL があれば本物。下の一番最後で決める）
  API_MODE: "mock",

  // Supabase をブラウザで使う道具（バージョンを決めて読む。勝手に新しくならないように）
  SUPABASE_JS_URL: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm",

  // ログインIDを Supabase のメールの形にする時の後ろ（メールは送らない。example.com は使われない決まりの名前）
  LOGIN_EMAIL_DOMAIN: "login.shiftapp.example.com",

  // パスワードの一番短い長さ（Supabase の決まりに合わせる）
  PASSWORD_MIN: 6,

  // 営業時間の表示範囲（シフト表の左端と右端）
  DAY_START: 7 * 60,    // 7:00
  DAY_END: 22 * 60,     // 22:00

  // 立ち上げの人は開店の何分前から入るか（7:00開店なら6:30から。立ち上げは1人）
  OPEN_PREP_MIN: 30,

  // 長い勤務とみなす長さ（これ以上なら休憩が必要）
  BREAK_NEEDED_MIN: 6 * 60,

  // 休憩を入れてよい一番早い時刻（朝11:00より前は休憩を入れない）
  BREAK_EARLIEST: 11 * 60,

  // 希望とシフトを作れる先の長さ（か月）
  MONTHS_AHEAD: 2,

  // 社員の休み希望（週）2026年11月5日に変更
  //   1日目はふつうに出せる。2日目は店長の「特別許可」がいる。3日目からは出せない
  SHAIN_OFF_FREE: 1,    // 許可なしで出せる休み希望の日数
  SHAIN_OFF_MAX: 2,     // 休み希望を出せる一番多い日数（特別許可を入れて）

  // ---------- AI（Gemini）2026年11月5日 ----------
  // つなぎ方の最初の設定（店長が「AIの設定」画面で変えられる。ai/ai-settings.js）
  //   "gemini" … この機械から直接（鍵はこの機械だけに保存）／ "worker" … Cloudflare Worker を通す ／ "local" … AIなし
  AI_MODE: "gemini",
  // 使うモデル（Google AI Studio の無料枠で使えるもの。変わったら「AIの設定」で変える）
  AI_MODEL: "gemini-3-flash-preview",
  // うまく動かない時に、次に試すモデル
  AI_MODEL_FALLBACK: "gemini-3.1-flash-lite",
  // AIの返事を待つ一番長い時間（ミリ秒）。90秒
  AI_TIMEOUT_MS: 90000,

  // 人が足りない時の自動連絡：1つの募集で何人まで知らせるか（入れそうな順に上から）
  CALL_MAX_PEOPLE: 8,
  // 公開の時に自動で送る募集の一番多い数（足りない時間が多すぎる時に、連絡だらけにしないため）
  CALL_AUTO_MAX: 10,
  // 自動で送る募集の一番短い長さ（分）。これより短い不足は送らない
  CALL_MIN_MIN: 60,

  // 立場の名前（画面に出す文字）
  KIND_LABEL: {
    shain: "社員",
    baito: "バイト",
    full: "フルで入るバイト",
  },

  // できること（4項目）
  SKILLS: [
    { key: "hall", label: "ホール" },
    { key: "kitchen", label: "キッチン" },
    { key: "open", label: "立ち上げ" },
    { key: "close", label: "締め" },
  ],
  SKILL_LEVELS: [0, 25, 50, 75, 100],
};

// SUPABASE_URL が入っていれば本物（Supabase）につなぐ
CONFIG.API_MODE = CONFIG.SUPABASE_URL ? "supabase" : "mock";
