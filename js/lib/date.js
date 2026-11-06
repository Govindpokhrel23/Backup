// ============================================================
// lib/date.js — 日付の計算
// ------------------------------------------------------------
// このファイルは、日付の計算のファイルです。
// 日付は "2026-11-09" の文字で持つ（データベースと同じ形）。
// Date の時差のズレを避けるため、計算はすべて「日本時間の正午」で行う。
// ============================================================

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];   // 曜日の文字（0＝日曜）

/** "2026-11-09" → Date（日本の正午） */
export function toDate(iso) {   // 「2026-11-09」を日付にする関数
  const [year, month, day] = iso.split("-").map(Number);   // 年・月・日
  return new Date(year, month - 1, day, 12);   // 昼の12時にする（時差で日がずれないように）
}

/** Date → "2026-11-09" */
export function toIso(date) {   // 日付を「2026-11-09」にする関数
  const year = date.getFullYear();   // 年
  const month = String(date.getMonth() + 1).padStart(2, "0");   // 月（2けた）
  const day = String(date.getDate()).padStart(2, "0");   // 日（2けた）
  return `${year}-${month}-${day}`;   // つないで返す
}

/** 日付に n 日足す */
export function addDays(iso, count) {   // 〇日後の日付を出す関数
  const date = toDate(iso);   // Date にしたもの
  date.setDate(date.getDate() + count);   // 日を足す
  return toIso(date);   // 文字にもどす
}

/** 今日（日本時間） */
export function today() {   // 今日の日付を出す関数
  return toIso(new Date());   // 今を文字にする
}

/** その日を含む週の月曜日 */
export function mondayOf(iso) {   // その週の月曜日を出す関数
  const date = toDate(iso);   // Date にしたもの
  const diff = (date.getDay() + 6) % 7;     // 月曜=0, 日曜=6
  return addDays(iso, -diff);   // 月曜日までもどる
}

/** 月曜日から7日分の日付 */
export function weekDates(monday) {   // 月曜日から7日を出す関数
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));   // 0〜6日後
}

/** 曜日の漢字1文字（"月" など） */
export function weekdayName(iso) {   // 曜日の文字を出す関数
  return WEEKDAYS[toDate(iso).getDay()];   // 「月」など
}

/** 曜日の番号（日=0 … 土=6） */
export function weekdayNum(iso) {   // 曜日の番号を出す関数
  return toDate(iso).getDay();   // 0＝日曜
}

/**
 * 日の種類（必要人数を決めるのに使う）
 *   平日 → "weekday"、土曜 → "sat"、日曜 → "sun"
 * 祝日は日曜と同じ扱い（要件定義書で決定）。祝日の一覧は後で足す。
 */
export function dayType(iso, holidays = []) {   // 日の種類を出す関数（平日・土曜・日祝）
  if (holidays.includes(iso)) return "sun";   // 祝日は日曜と同じ
  const weekday = weekdayNum(iso);   // 曜日の番号
  if (weekday === 6) return "sat";   // 土曜
  if (weekday === 0) return "sun";   // 日曜
  return "weekday";   // それ以外は平日
}

/** "11/9（月）" の形 */
export function label(iso) {   // 「11/9（月）」の形にする関数
  const date = toDate(iso);   // Date にしたもの
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdayName(iso)}）`;   // 月/日（曜日）
}

/** "11/9" の形 */
export function shortLabel(iso) {   // 「11/9」の形にする関数
  const date = toDate(iso);   // Date にしたもの
  return `${date.getMonth() + 1}/${date.getDate()}`;   // 月/日
}

/** その月の1日（"2026-11-09" → "2026-11-01"） */
export function monthStart(iso) {   // その月の1日を出す関数
  return `${iso.slice(0, 7)}-01`;   // 「2026-11-01」
}

/** その月の最後の日（"2026-11-09" → "2026-11-30"） */
export function monthEnd(iso) {   // その月の最後の日を出す関数
  const [year, month] = iso.split("-").map(Number);   // 年と月
  return toIso(new Date(year, month, 0, 12));          // 次の月の0日＝その月の最後の日
}
