// ============================================================
// workers/api/lib/reminder.js — 「明日はシフトです」の通知（毎日18時）
// ------------------------------------------------------------
// このファイルは、毎日18時（日本の時間）に、次の日に勤務がある人のスマホへ
// 「明日のシフト」を知らせる通知を送るためのファイルです（2026年11月22日）。
//
// 動く時：Cloudflare の決まった時間の仕事（Cron Trigger。wrangler.toml の [triggers]）
//         毎日 09:00 UTC ＝ 日本の 18:00 に worker.js の scheduled() から呼ばれる
// 送る人：次の日に「公開した」週の勤務がある人（下書きの週は送らない）。やめた人（停止）には送らない
// 送る文：「明日 11/23（月）のシフト：安城福釜店 7:00〜16:00（休憩 11:00）」
// お金：Cloudflare の無料のプランで使える（決まった時間の仕事は無料で使える）
// ============================================================

/** 曜日の文字（0＝日曜） */
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];   // 曜日

/** 分 → 「7:00」 */
function clock(minutes) {   // 時刻の文字にする関数
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;   // 時:分
}

/**
 * 日本の時間で「明日」の日付（YYYY-MM-DD）
 * @param {Date} now 今
 */
export function tomorrowInJapan(now) {   // 明日の日付を出す関数
  const japan = new Date(now.getTime() + 9 * 3600 * 1000);   // 日本の時間（UTC＋9時間）
  japan.setUTCDate(japan.getUTCDate() + 1);   // 1日あと
  return japan.toISOString().slice(0, 10);   // 「2026-11-23」
}

/**
 * 1人分の通知の文を作る
 * @param {string} date 明日の日付
 * @param {object[]} shifts その人の明日の勤務（assignments の行）
 * @param {Map<string,string>} storeNames 店舗ID → 名前
 */
export function reminderText(date, shifts, storeNames) {   // 通知の文を作る関数
  const day = new Date(`${date}T12:00:00Z`);   // 曜日を出すための日付
  const head = `明日 ${day.getUTCMonth() + 1}/${day.getUTCDate()}（${WEEKDAY[day.getUTCDay()]}）のシフト`;   // 「明日 11/23（月）のシフト」
  const parts = [...shifts]   // 勤務を
    .sort((first, second) => first.from_min - second.from_min)   // 早い順に
    .map((shift) => `${storeNames.get(shift.store_id) || ""} ${clock(shift.from_min)}〜${clock(shift.to_min)}${shift.break_at != null ? `（休憩 ${clock(shift.break_at)}）` : ""}`.trim());   // 「安城福釜店 7:00〜16:00（休憩 11:00）」
  return `${head}：${parts.join(" ／ ")}`;   // つなげる
}

/**
 * 明日の勤務がある人に通知を送る
 * @param {object} db   Supabase を管理者として使う道具（worker.js の rest()）
 * @param {(sub:object, payload:string)=>Promise<Response>} send 通知を1つ送る関数
 * @param {Date} now 今
 * @returns {Promise<{date:string, people:number, sent:number, removed:number}>} 送った結果
 */
export async function sendTomorrowReminders(db, send, now) {   // 明日の通知を送る関数
  const date = tomorrowInJapan(now);   // 明日
  // 明日の勤務（公開した週だけ。periods とつないで status を見る）
  const rows = await db.get(`assignments?date=eq.${date}&select=member_id,store_id,from_min,to_min,break_at,periods!inner(status)&periods.status=eq.published`);   // 明日の勤務
  if (!rows.length) return { date, people: 0, sent: 0, removed: 0 };   // だれもいなければ終わり
  const ids = [...new Set(rows.map((row) => row.member_id))].filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));   // 明日入る人（IDの形を確かめる）
  const list = ids.map((id) => `"${id}"`).join(",");   // 検索の形
  const [members, stores, subs] = await Promise.all([   // 同時に読む
    db.get(`members?id=in.(${encodeURIComponent(list)})&active=eq.true&select=id`),   // やめていない人
    db.get("stores?select=id,name"),   // 店舗の名前
    db.get(`push_subs?member_id=in.(${encodeURIComponent(list)})&select=*`),   // スマホの宛先
  ]);
  const activeIds = new Set(members.map((member) => member.id));   // 送ってよい人
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));   // 店舗ID → 名前
  let sent = 0, removed = 0;   // 送った数・消した宛先の数
  for (const sub of subs) {   // 宛先ごとに
    if (!activeIds.has(sub.member_id)) continue;   // やめた人には送らない
    const text = reminderText(date, rows.filter((row) => row.member_id === sub.member_id), storeNames);   // その人の文
    const payload = JSON.stringify({ title: "明日のシフト", body: text.slice(0, 200), url: "./#/calendar" });   // 通知の中身（押すとカレンダー）
    const res = await send(sub, payload);   // 送る
    if (res.status === 404 || res.status === 410) {   // もう使われていない宛先（アプリを消した など）
      await db.del(`push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`);   // 消す
      removed++;   // 数える
    } else if (res.ok) {   // 送れたら
      sent++;   // 数える
    }
  }
  return { date, people: activeIds.size, sent, removed };   // 結果
}
