// ============================================================
// lib/date.js — 日付の計算
// ------------------------------------------------------------
// このファイルは、日付の計算のファイルです。
// 日付は "2026-11-09" の文字で持つ（データベースと同じ形）。
// Date の時差のズレを避けるため、計算はすべて「日本時間の正午」で行う。
// ============================================================

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-11-09" → Date（日本の正午） */
export function toDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);   // 年・月・日
  return new Date(y, m - 1, d, 12);
}

/** Date → "2026-11-09" */
export function toIso(date) {
  const y = date.getFullYear();   // 年
  const m = String(date.getMonth() + 1).padStart(2, "0");   // 月（2けた）
  const d = String(date.getDate()).padStart(2, "0");   // 日（2けた）
  return `${y}-${m}-${d}`;
}

/** 日付に n 日足す */
export function addDays(iso, n) {
  const d = toDate(iso);   // Date にしたもの
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** 今日（日本時間） */
export function today() {
  return toIso(new Date());
}

/** その日を含む週の月曜日 */
export function mondayOf(iso) {
  const d = toDate(iso);   // Date にしたもの
  const diff = (d.getDay() + 6) % 7;     // 月曜=0, 日曜=6
  return addDays(iso, -diff);
}

/** 月曜日から7日分の日付 */
export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 曜日の漢字1文字（"月" など） */
export function weekdayName(iso) {
  return WEEKDAYS[toDate(iso).getDay()];
}

/** 曜日の番号（日=0 … 土=6） */
export function weekdayNum(iso) {
  return toDate(iso).getDay();
}

/**
 * 日の種類（必要人数を決めるのに使う）
 *   平日 → "weekday"、土曜 → "sat"、日曜 → "sun"
 * 祝日は日曜と同じ扱い（要件定義書で決定）。祝日の一覧は後で足す。
 */
export function dayType(iso, holidays = []) {
  if (holidays.includes(iso)) return "sun";
  const n = weekdayNum(iso);   // 曜日の番号
  if (n === 6) return "sat";
  if (n === 0) return "sun";
  return "weekday";
}

/** "11/9（月）" の形 */
export function label(iso) {
  const d = toDate(iso);   // Date にしたもの
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdayName(iso)}）`;
}

/** "11/9" の形 */
export function shortLabel(iso) {
  const d = toDate(iso);   // Date にしたもの
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
