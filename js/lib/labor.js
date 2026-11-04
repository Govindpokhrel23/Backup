// ============================================================
// lib/labor.js — 働いた時間と人件費の目安
// ------------------------------------------------------------
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
  const len = to - from;
  if (len > 8 * 60) return 60;
  if (len > 6 * 60) return 45;
  return 0;
}

/** 働いた時間（分）＝勤務の長さ − 休憩 */
export function workedMinutes(a) {
  return Math.max(0, a.to - a.from - breakMinutes(a.from, a.to));
}

/** 深夜（22:00〜翌5:00）に入っている分 */
export function nightMinutes(a) {
  return Math.max(0, Math.min(a.to, NIGHT_TO) - Math.max(a.from, NIGHT_FROM));
}

/**
 * 人件費の目安（円）
 * @param {object[]} assignments  勤務
 * @param {object[]} wages        [{memberId, hourly, transport}]
 * @returns {number}
 */
export function laborCost(assignments, wages) {
  const wageOf = new Map(wages.map((w) => [w.memberId, w]));
  let yen = 0;
  const days = new Set();                 // 交通費を数えた「人×日」
  for (const a of assignments) {
    const w = wageOf.get(a.memberId);
    if (!w || !w.hourly) continue;
    const night = nightMinutes(a);
    const normal = workedMinutes(a) - night;
    yen += (Math.max(0, normal) / 60) * w.hourly + (night / 60) * w.hourly * 1.25;
    const key = `${a.memberId}|${a.date}`;
    if (!days.has(key)) { days.add(key); yen += w.transport || 0; }
  }
  return Math.round(yen);
}

/** 人ごとの、その週の働いた時間（分） */
export function minutesByMember(assignments) {
  const map = new Map();
  for (const a of assignments) map.set(a.memberId, (map.get(a.memberId) || 0) + workedMinutes(a));
  return map;
}

/** "32時間30分" の形 */
export function hoursText(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

/** "12,345円" の形 */
export function yen(n) {
  return `${n.toLocaleString("ja-JP")}円`;
}
