// ============================================================
// config.js — アプリの設定（ここだけ見れば動き方が分かる）
// ------------------------------------------------------------
// このファイルは、アプリの設定（ここだけ見れば動き方が分かる）のファイルです。
// ・API_MODE
//     "mock"     … 見本データで動く（今はこれ。Supabaseなしで動く）
//     "supabase" … 本物のデータベースにつなぐ（段階1で作る）
// ・SUPABASE_URL / SUPABASE_ANON_KEY
//     Supabaseのアカウントを作ったら入れる。
//     ANON_KEY は「画面に置いてよい鍵」。管理用の鍵は絶対にここに書かない。
// ============================================================

export const CONFIG = {
  API_MODE: "mock",

  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

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
  // Cloudflare Worker のURL（workers/ai-proxy を公開したら入れる）
  AI_WORKER_URL: "",
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
