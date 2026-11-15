// ============================================================
// api/supabase/periods.js — 受付（週）・希望・勤務（本物）
// ------------------------------------------------------------
// このファイルは、週の受付・希望・勤務（シフト）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
//
// 勤務の保存は「全部消して入れ直す」ではなく、IDごとに 足す・直す・消す。
// （交代のお願いが勤務のIDを持っているので、消すとお願いも消えてしまうため）
// ============================================================

import {   // Supabase の道具を読む
  supabaseClient, must, newId, requireMe, requireManager, currentStore,   // 通信・ID・ログインのチェック・今の店舗
  periodMap, hopeMap, workMap, companyMembers, canWorkAt, notify, readAll,   // 形の変換・会社の店員・お知らせ・全部読む
} from "./core.js";   // 読む元
import { today, addDays, weekDates, label } from "../../lib/date.js";   // 日付の道具を読む

/** 画面の関数（supabase-api.js で合体する） */
export const periodsApi = {   // シフト（週・希望・勤務）の窓口
  // ---------- 受付（週） ----------

  /** その店舗（なければ今の店舗）の週の一覧（古い順） */
  async listPeriods(storeId) {   // 週の一覧を出す関数
    await requireMe();   // ログインしていなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("periods").select("*").eq("store_id", storeId || (await currentStore())).order("week_start")).map(periodMap.from);   // その店舗の週を古い順に
  },

  /** その週の受付がなければ作る（店長） */
  async ensurePeriod(weekStart) {   // 週を用意する関数（なければ作る）
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    const found = must(await client.from("periods").select("*").eq("store_id", store).eq("week_start", weekStart).maybeSingle());   // もうある週
    if (found) return periodMap.from(found);   // あればそれを返す
    return periodMap.from(must(await client.from("periods").insert({   // なければ作って返す
      id: newId(), store_id: store, week_start: weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status: "open", note: "",   // ID・店舗・週の始まり・締切（前の日の24時）・受付中・連絡事項
    }).select().single()));   // 作ったものを返す
  },

  /** 受付の状態を変える（open／closed／published） */
  async setPeriodStatus(periodId, status) {   // 週の状態を変える関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const patch = { status, ...(status === "published" ? { published_at: new Date().toISOString() } : {}) };   // 直す中身
    return periodMap.from(must(await client.from("periods").update(patch).eq("id", periodId).select().single()));   // 保存して返す
  },

  /** 連絡事項を保存（店長） */
  async savePeriodNote(periodId, note) {   // 連絡事項を保存する関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("periods").update({ note }).eq("id", periodId));   // 保存
    return true;   // できた
  },

  /** その週だけ、ほかの店舗の人を応援として足す（店長） */
  async addGuest(periodId, memberId) {   // この週だけほかの店舗の人を足す関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("guests").eq("id", periodId).single());   // その週
    const guests = [...new Set([...(period.guests || []), memberId])];                           // 新しい応援の一覧
    must(await client.from("periods").update({ guests }).eq("id", periodId));   // 保存
    return guests;   // 足した人の一覧を返す
  },

  /** 応援の人を外す（店長。勤務が入っていなければ） */
  async removeGuest(periodId, memberId) {   // 足した人を外す関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const used = must(await client.from("assignments").select("id").eq("period_id", periodId).eq("member_id", memberId));   // その人の勤務
    if (used.length) throw new Error("勤務が入っているので外せません。先に勤務を消してください");   // 勤務があれば外せない
    const period = must(await client.from("periods").select("guests").eq("id", periodId).single());   // その週
    const guests = (period.guests || []).filter((id) => id !== memberId);   // 新しい応援の一覧
    must(await client.from("periods").update({ guests }).eq("id", periodId));   // 保存
    return guests;   // 足した人の一覧を返す
  },

  // ---------- 希望 ----------

  /** ある週の希望（店長＝その店舗の人と応援の人全員分、店員＝自分の分） */
  async listAvailabilities(periodId) {   // 週の希望の一覧を出す関数
    const user = await requireMe();                                    // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("*").eq("id", periodId).maybeSingle());   // その週
    if (!period) return [];   // 週がなければ空
    const dates = weekDates(period.week_start);                             // その週の日付
    const rows = must(await client.from("availabilities").select("*").gte("date", dates[0]).lte("date", dates[6])).map(hopeMap.from);   // その週の希望（決まりで見えるものだけ）
    if (user.role !== "manager") return rows.filter((row) => row.memberId === user.id);   // 店員なら自分の分だけ
    const members = await companyMembers();   // 会社の店員
    const here = new Set([...members.filter((member) => canWorkAt(member, period.store_id)).map((member) => member.id), ...(period.guests || [])]);   // その店舗の人
    return rows.filter((row) => here.has(row.memberId));   // 店長ならこの店舗で働ける人の分
  },

  /** 自分の希望（from〜to） */
  async listMyAvailabilities(from, to) {   // 自分の希望を出す関数（日付のはば）
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("availabilities").select("*").eq("member_id", user.id).gte("date", from).lte("date", to)).map(hopeMap.from);   // 自分の分を返す
  },

  /** その週に希望を入れられるか（入れられなければ理由、入れられれば null） */
  async weekLock(weekStart) {   // 希望を出せない理由を出す関数
    return lockReason(weekStart);   // 理由（出せるなら null）
  },

  /** 自分の希望を1週間分保存する */
  async saveMyAvailabilities(weekStart, rows) {   // 自分の希望を保存する関数
    const user = await requireMe();   // ログイン中の人
    const reason = await lockReason(weekStart);                        // 入れられない理由
    if (reason) throw new Error(reason);   // 出せなければ止める
    const dates = weekDates(weekStart);   // その週の日付
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("availabilities").delete().eq("member_id", user.id).gte("date", dates[0]).lte("date", dates[6]));   // その週の自分の希望を消して
    if (rows.length) must(await client.from("availabilities").insert(rows.map((row) => hopeMap.to({ ...row, memberId: user.id, note: row.note || "" }))));   // 新しく入れる
    return true;   // できた
  },

  /** 店長が「特別許可」を出す（社員の2日目の休み希望） */
  async approveSpecialOff(periodId, memberId, date) {   // 特別許可を出す関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("availabilities").update({ kind: "off" }).eq("member_id", memberId).eq("date", date));   // 休み希望にする
    return true;   // できた
  },

  // ---------- 勤務 ----------

  /** その週の勤務（店員は公開済みの週だけ見える。データベースの決まりで） */
  async listAssignments(periodId) {   // 週の勤務を出す関数
    await requireMe();   // ログインしていなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);   // 勤務を返す
  },

  /**
   * 会社の全部の店舗の勤務（日付の範囲。店長）
   * memberIds を渡すと、その人たちの分だけ（年の上限を数える時）
   * 多い時は1000行ずつに分けて読む（Supabase は1回に1000行までしか返さないため）
   */
  async listAssignmentsByDates(from, to, memberIds = null) {   // 日付のはばで勤務を出す関数（月・年の集計用）
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return (await readAll(() => {   // 1000行ずつ全部読む
      let query = client.from("assignments").select("*").gte("date", from).lte("date", to);   // 問い合わせ
      if (memberIds) query = query.in("member_id", memberIds);   // 人の指定があればしぼる
      return query.order("id");   // ID の順
    })).map(workMap.from);   // アプリの形にする
  },

  /** 自分の勤務（公開済みの週だけ。応援先も） */
  async listMyAssignments() {   // 自分の勤務を出す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const rows = must(await client.from("assignments").select("*").eq("member_id", user.id)).map(workMap.from);   // 自分の勤務
    const ids = [...new Set(rows.map((row) => row.periodId))];                                                  // その週のID
    if (!ids.length) return [];   // なければ空
    const published = new Set(must(await client.from("periods").select("id").in("id", ids).eq("status", "published")).map((period) => period.id));   // 公開済みの週のID
    return rows.filter((row) => published.has(row.periodId));   // 公開した週の分だけ返す
  },

  /** 1週間分の勤務を保存（店長）。知らせは送らない（「変更を公開」を押した時だけ notifyShiftChanges で送る。2026年11月15日） */
  async saveAssignments(periodId, rows) {   // 週の勤務を保存する関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("*").eq("id", periodId).single());          // その週
    const before = must(await client.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);   // 前の勤務
    const next = rows.map((row) => ({ ...row, id: row.id || newId(), periodId, storeId: period.store_id }));               // 保存する勤務
    const keep = new Set(next.map((row) => row.id));   // 残す勤務のID
    const drop = before.filter((shift) => !keep.has(shift.id)).map((shift) => shift.id);                     // 消す勤務
    if (drop.length) must(await client.from("assignments").delete().in("id", drop));   // 消えたものを消す
    if (next.length) {   // あれば
      must(await client.from("assignments").upsert(next.map((row) => workMap.to({   // 保存（同じIDなら上書き）
        ...row, breakAt: row.breakAt ?? null, fixed: !!row.fixed, createdBy: row.createdBy || "manager",   // 休憩・固定・作った人
        requested: !!row.requested, helper: !!row.helper, reason: row.reason || "",   // 希望あり・応援・理由
      })), { onConflict: "id" }));   // 同じIDなら上書き
    }
    return true;   // できた
  },

  /** 公開したシフトを直して「変更を公開」した時、変わった人だけに知らせる（before：直す前の公開済みの勤務） */
  async notifyShiftChanges(before, after) {   // 変わった人に知らせる関数
    await requireManager();   // 店長でなければ止める
    return notifyChanges(before, after);   // 人と日ごとに知らせる（変わった数を返す）
  },
};

/**
 * その週に希望を入れられない理由（入れられれば null）
 * 締切は「その週の前の日曜24:00」。店長が締め切った・公開した週もだめ
 */
async function lockReason(weekStart) {   // 希望を出せない理由を出す関数
  const user = await requireMe();   // ログイン中の人
  const client = await supabaseClient();   // Supabase の道具
  const period = must(await client.from("periods").select("status").eq("store_id", user.storeId).eq("week_start", weekStart).maybeSingle());   // その週の受付
  if (period && period.status !== "open") return "この週は受付が終わっています";   // 受付が終わった
  if (today() > addDays(weekStart, -1)) return "この週は締切をすぎています";   // 締切をすぎた
  return null;   // 出せる
}

/** 公開後に変わった勤務を本人に知らせる（人と日ごとに1回） */
async function notifyChanges(before, after) {   // 変わった人に知らせる関数
  const key = (shift) => `${shift.memberId}|${shift.date}`;                        // 人と日
  const old = new Map(before.map((shift) => [key(shift), shift]));                 // 前
  const now = new Map(after.map((shift) => [key(shift), shift]));                  // 後
  const changed = new Set();                                           // 変わった人と日
  for (const [key, newShift] of now) { const oldShift = old.get(key); if (!oldShift || oldShift.from !== newShift.from || oldShift.to !== newShift.to) changed.add(key); }   // 時間が変わったものを集める
  for (const key of old.keys()) if (!now.has(key)) changed.add(key);   // 消えたものも集める
  // 人ごとにまとめて送る
  for (const key of changed) {   // 変わったものごとに
    const [memberId, date] = key.split("|");                             // 人と日
    await notify([memberId], `${label(date)} のシフトが変わりました`);   // 知らせる
  }
  return changed.size;   // 変わった数
}
