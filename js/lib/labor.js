// ============================================================
// lib/labor.js — 働いた時間と人件費の目安
// ------------------------------------------------------------
// このファイルは、働いた時間と人件費の目安のファイルです。
// 要件定義書で決めた計算（時給×時間、深夜割増、交通費）をここにまとめる。
//   ・休憩の時間：労働基準法の最低に合わせて引く
//       6時間をこえる勤務 → 45分、8時間をこえる勤務 → 60分
//     （○は「この辺りで休憩」の目安なので、長さはここで決める）
//   ・深夜割増：22:00〜翌5:00 は時給の1.25倍
//   ・交通費：その日に1回でも入っていれば1日分
//   ・社員（時給0）は人件費の計算に入れない
// ※あくまで「目安」。本当の給料計算ではない
// ============================================================

const NIGHT_FROM = 22 * 60;   // 22:00
const NIGHT_TO = 29 * 60;     // 翌5:00

/** その勤務の休憩の長さ（分） */
export function breakMinutes(from, to) {
  const len = to - from;   // 勤務の長さ（分）
  if (len > 8 * 60) return 60;
  if (len > 6 * 60) return 45;
  return 0;
}

/** 働いた時間（分）＝勤務の長さ − 休憩 */
export function workedMinutes(shift) {
  return Math.max(0, shift.to - shift.from - breakMinutes(shift.from, shift.to));
}

/** 深夜（22:00〜翌5:00）に入っている分 */
export function nightMinutes(shift) {
  return Math.max(0, Math.min(shift.to, NIGHT_TO) - Math.max(shift.from, NIGHT_FROM));
}

/**
 * 人件費の目安（円）
 * @param {object[]} assignments  勤務
 * @param {object[]} wages        [{memberId, hourly, transport}]
 * @returns {number}
 */
export function laborCost(assignments, wages) {
  const wageOf = new Map(wages.map((wage) => [wage.memberId, wage]));   // ID → 時給・交通費
  let yen = 0;   // 合計（円）
  const days = new Set();                 // 交通費を数えた「人×日」
  for (const shift of assignments) {
    const wage = wageOf.get(shift.memberId);   // その人の時給・交通費
    if (!wage || !wage.hourly) continue;
    const night = nightMinutes(shift);   // 深夜の分
    const normal = workedMinutes(shift) - night;   // ふつうの分
    yen += (Math.max(0, normal) / 60) * wage.hourly + (night / 60) * wage.hourly * 1.25;
    const key = `${shift.memberId}|${shift.date}`;   // 人と日（交通費を1日1回にするため）
    if (!days.has(key)) { days.add(key); yen += wage.transport || 0; }
  }
  return Math.round(yen);
}

/** 人ごとの、その週の働いた時間（分） */
export function minutesByMember(assignments) {
  const map = new Map();   // ID → 働いた分
  for (const shift of assignments) map.set(shift.memberId, (map.get(shift.memberId) || 0) + workedMinutes(shift));
  return map;
}

/** "32時間30分" の形 */
export function hoursText(minutes) {
  const hours = Math.floor(minutes / 60), member = minutes % 60;   // 時間と分
  return member ? `${hours}時間${member}分` : `${hours}時間`;
}

/** "12,345円" の形 */
export function yen(count) {
  return `${count.toLocaleString("ja-JP")}円`;
}
