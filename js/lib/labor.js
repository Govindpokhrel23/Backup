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
export function breakMinutes(from, to) {   // 休憩の分数を出す関数（勤務の長さで決まる）
  const len = to - from;   // 勤務の長さ（分）
  if (len > 8 * 60) return 60;   // 8時間をこえたら60分
  if (len > 6 * 60) return 45;   // 6時間をこえたら45分
  return 0;   // 6時間までは休憩なし
}

/** 働いた時間（分）＝勤務の長さ − 休憩 */
export function workedMinutes(shift) {   // 働いた時間（休憩を引いた分）を出す関数
  return Math.max(0, shift.to - shift.from - breakMinutes(shift.from, shift.to));   // 長さ−休憩。マイナスにはしない
}

/** 深夜（22:00〜翌5:00）に入っている分 */
export function nightMinutes(shift) {   // 深夜（22時〜翌5時）に入っている分を出す関数
  return Math.max(0, Math.min(shift.to, NIGHT_TO) - Math.max(shift.from, NIGHT_FROM));   // 勤務と深夜の重なった分
}

/**
 * 人件費の目安（円）
 * @param {object[]} assignments  勤務
 * @param {object[]} wages        [{memberId, hourly, transport}]
 * @returns {number}
 */
export function laborCost(assignments, wages) {   // 人件費の目安を出す関数
  const wageOf = new Map(wages.map((wage) => [wage.memberId, wage]));   // ID → 時給・交通費
  let yen = 0;   // 合計（円）
  const days = new Set();                 // 交通費を数えた「人×日」
  for (const shift of assignments) {   // 勤務を1つずつ
    const wage = wageOf.get(shift.memberId);   // その人の時給・交通費
    if (!wage || !wage.hourly) continue;   // 時給がない人（社員など）は数えない
    const night = nightMinutes(shift);   // 深夜の分
    const normal = workedMinutes(shift) - night;   // ふつうの分
    yen += (Math.max(0, normal) / 60) * wage.hourly + (night / 60) * wage.hourly * 1.25;   // ふつうの時間×時給＋深夜×時給×1.25
    const key = `${shift.memberId}|${shift.date}`;   // 人と日（交通費を1日1回にするため）
    if (!days.has(key)) { days.add(key); yen += wage.transport || 0; }   // その日の交通費をまだ足していなければ1回だけ足す
  }
  return Math.round(yen);   // 1円単位に丸めて返す
}

/** 人ごとの、その週の働いた時間（分） */
export function minutesByMember(assignments) {   // 人ごとの働いた時間をまとめる関数
  const map = new Map();   // ID → 働いた分
  for (const shift of assignments) map.set(shift.memberId, (map.get(shift.memberId) || 0) + workedMinutes(shift));   // その人の分に足していく
  return map;   // 店員ID → 分 の表を返す
}

/** "32時間30分" の形 */
export function hoursText(minutes) {   // 分を「32時間30分」の形にする関数
  const hours = Math.floor(minutes / 60), restMinutes = minutes % 60;   // 時間と分
  return restMinutes ? `${hours}時間${restMinutes}分` : `${hours}時間`;   // 分があれば「〇時間〇分」、なければ「〇時間」
}

/** "12,345円" の形 */
export function yen(count) {   // 数字を「183,300円」の形にする関数
  return `${count.toLocaleString("ja-JP")}円`;   // 3けたごとにカンマを入れて「円」を付ける
}
