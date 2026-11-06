// ============================================================
// api/supabase/periods.js — 受付（週）・希望・勤務（本物）
// ------------------------------------------------------------
// このファイルは、週の受付・希望・勤務（シフト）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
//
// 勤務の保存は「全部消して入れ直す」ではなく、IDごとに 足す・直す・消す。
// （交代のお願いが勤務のIDを持っているので、消すとお願いも消えてしまうため）
// ============================================================

import {
  sb, must, newId, requireMe, requireManager, currentStore,
  periodMap, hopeMap, workMap, companyMembers, canWorkAt, notify, readAll,
} from "./core.js";
import { today, addDays, weekDates, label } from "../../lib/date.js";

/** 画面の関数（supabase-api.js で合体する） */
export const periodsApi = {
  // ---------- 受付（週） ----------

  /** その店舗（なければ今の店舗）の週の一覧（古い順） */
  async listPeriods(storeId) {
    await requireMe();
    const c = await sb();   // Supabase の道具
    return must(await c.from("periods").select("*").eq("store_id", storeId || (await currentStore())).order("week_start")).map(periodMap.from);
  },

  /** その週の受付がなければ作る（店長） */
  async ensurePeriod(weekStart) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    const found = must(await c.from("periods").select("*").eq("store_id", store).eq("week_start", weekStart).maybeSingle());   // もうある週
    if (found) return periodMap.from(found);
    return periodMap.from(must(await c.from("periods").insert({
      id: newId(), store_id: store, week_start: weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status: "open", note: "",
    }).select().single()));
  },

  /** 受付の状態を変える（open／closed／published） */
  async setPeriodStatus(periodId, status) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const patch = { status, ...(status === "published" ? { published_at: new Date().toISOString() } : {}) };   // 直す中身
    return periodMap.from(must(await c.from("periods").update(patch).eq("id", periodId).select().single()));
  },

  /** 連絡事項を保存（店長） */
  async savePeriodNote(periodId, note) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    must(await c.from("periods").update({ note }).eq("id", periodId));
    return true;
  },

  /** その週だけ、ほかの店舗の人を応援として足す（店長） */
  async addGuest(periodId, memberId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const p = must(await c.from("periods").select("guests").eq("id", periodId).single());   // その週
    const guests = [...new Set([...(p.guests || []), memberId])];                           // 新しい応援の一覧
    must(await c.from("periods").update({ guests }).eq("id", periodId));
    return guests;
  },

  /** 応援の人を外す（店長。勤務が入っていなければ） */
  async removeGuest(periodId, memberId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const used = must(await c.from("assignments").select("id").eq("period_id", periodId).eq("member_id", memberId));   // その人の勤務
    if (used.length) throw new Error("勤務が入っているので外せません。先に勤務を消してください");
    const p = must(await c.from("periods").select("guests").eq("id", periodId).single());   // その週
    const guests = (p.guests || []).filter((id) => id !== memberId);   // 新しい応援の一覧
    must(await c.from("periods").update({ guests }).eq("id", periodId));
    return guests;
  },

  // ---------- 希望 ----------

  /** ある週の希望（店長＝その店舗の人と応援の人全員分、店員＝自分の分） */
  async listAvailabilities(periodId) {
    const user = await requireMe();                                    // ログイン中の人
    const c = await sb();   // Supabase の道具
    const p = must(await c.from("periods").select("*").eq("id", periodId).maybeSingle());   // その週
    if (!p) return [];
    const dates = weekDates(p.week_start);                             // その週の日付
    const rows = must(await c.from("availabilities").select("*").gte("date", dates[0]).lte("date", dates[6])).map(hopeMap.from);   // その週の希望（決まりで見えるものだけ）
    if (user.role !== "manager") return rows.filter((a) => a.memberId === user.id);
    const members = await companyMembers();   // 会社の店員
    const here = new Set([...members.filter((m) => canWorkAt(m, p.store_id)).map((m) => m.id), ...(p.guests || [])]);   // その店舗の人
    return rows.filter((a) => here.has(a.memberId));
  },

  /** 自分の希望（from〜to） */
  async listMyAvailabilities(from, to) {
    const user = await requireMe();   // ログイン中の人
    const c = await sb();   // Supabase の道具
    return must(await c.from("availabilities").select("*").eq("member_id", user.id).gte("date", from).lte("date", to)).map(hopeMap.from);
  },

  /** その週に希望を入れられるか（入れられなければ理由、入れられれば null） */
  async weekLock(weekStart) {
    return lockReason(weekStart);
  },

  /** 自分の希望を1週間分保存する */
  async saveMyAvailabilities(weekStart, rows) {
    const user = await requireMe();   // ログイン中の人
    const reason = await lockReason(weekStart);                        // 入れられない理由
    if (reason) throw new Error(reason);
    const dates = weekDates(weekStart);   // その週の日付
    const c = await sb();   // Supabase の道具
    must(await c.from("availabilities").delete().eq("member_id", user.id).gte("date", dates[0]).lte("date", dates[6]));
    if (rows.length) must(await c.from("availabilities").insert(rows.map((r) => hopeMap.to({ ...r, memberId: user.id, note: r.note || "" }))));
    return true;
  },

  /** 店長が「特別許可」を出す（社員の2日目の休み希望） */
  async approveSpecialOff(periodId, memberId, date) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    must(await c.from("availabilities").update({ kind: "off" }).eq("member_id", memberId).eq("date", date));
    return true;
  },

  // ---------- 勤務 ----------

  /** その週の勤務（店員は公開済みの週だけ見える。データベースの決まりで） */
  async listAssignments(periodId) {
    await requireMe();
    const c = await sb();   // Supabase の道具
    return must(await c.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);
  },

  /**
   * 会社の全部の店舗の勤務（日付の範囲。店長）
   * memberIds を渡すと、その人たちの分だけ（年の上限を数える時）
   * 多い時は1000行ずつに分けて読む（Supabase は1回に1000行までしか返さないため）
   */
  async listAssignmentsByDates(from, to, memberIds = null) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return (await readAll(() => {
      let q = c.from("assignments").select("*").gte("date", from).lte("date", to);   // 問い合わせ
      if (memberIds) q = q.in("member_id", memberIds);
      return q.order("id");
    })).map(workMap.from);
  },

  /** 自分の勤務（公開済みの週だけ。応援先も） */
  async listMyAssignments() {
    const user = await requireMe();   // ログイン中の人
    const c = await sb();   // Supabase の道具
    const rows = must(await c.from("assignments").select("*").eq("member_id", user.id)).map(workMap.from);   // 自分の勤務
    const ids = [...new Set(rows.map((a) => a.periodId))];                                                  // その週のID
    if (!ids.length) return [];
    const published = new Set(must(await c.from("periods").select("id").in("id", ids).eq("status", "published")).map((p) => p.id));   // 公開済みの週のID
    return rows.filter((a) => published.has(a.periodId));
  },

  /** 1週間分の勤務を保存（店長）。公開後なら、変わった人に知らせる */
  async saveAssignments(periodId, rows) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const p = must(await c.from("periods").select("*").eq("id", periodId).single());          // その週
    const before = must(await c.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);   // 前の勤務
    const next = rows.map((r) => ({ ...r, id: r.id || newId(), periodId, storeId: p.store_id }));               // 保存する勤務
    const keep = new Set(next.map((r) => r.id));   // 残す勤務のID
    const drop = before.filter((a) => !keep.has(a.id)).map((a) => a.id);                     // 消す勤務
    if (drop.length) must(await c.from("assignments").delete().in("id", drop));
    if (next.length) {
      must(await c.from("assignments").upsert(next.map((r) => workMap.to({
        ...r, breakAt: r.breakAt ?? null, fixed: !!r.fixed, createdBy: r.createdBy || "manager",
        requested: !!r.requested, helper: !!r.helper, reason: r.reason || "",
      })), { onConflict: "id" }));
    }
    if (p.status === "published") await notifyChanges(before, next);
    return true;
  },
};

/**
 * その週に希望を入れられない理由（入れられれば null）
 * 締切は「その週の前の日曜24:00」。店長が締め切った・公開した週もだめ
 */
async function lockReason(weekStart) {
  const user = await requireMe();   // ログイン中の人
  const c = await sb();   // Supabase の道具
  const p = must(await c.from("periods").select("status").eq("store_id", user.storeId).eq("week_start", weekStart).maybeSingle());   // その週の受付
  if (p && p.status !== "open") return "この週は受付が終わっています";
  if (today() > addDays(weekStart, -1)) return "この週は締切をすぎています";
  return null;
}

/** 公開後に変わった勤務を本人に知らせる（人と日ごとに1回） */
async function notifyChanges(before, after) {
  const key = (a) => `${a.memberId}|${a.date}`;                        // 人と日
  const old = new Map(before.map((a) => [key(a), a]));                 // 前
  const now = new Map(after.map((a) => [key(a), a]));                  // 後
  const changed = new Set();                                           // 変わった人と日
  for (const [k, a] of now) { const b = old.get(k); if (!b || b.from !== a.from || b.to !== a.to) changed.add(k); }
  for (const k of old.keys()) if (!now.has(k)) changed.add(k);
  // 人ごとにまとめて送る
  for (const k of changed) {
    const [memberId, date] = k.split("|");                             // 人と日
    await notify([memberId], `${label(date)} のシフトが変わりました`);
  }
}
