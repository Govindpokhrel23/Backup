// ============================================================
// api/supabase/notices.js — お知らせ・「見ました」・シフト交代（本物）
// ------------------------------------------------------------
// このファイルは、お知らせ、公開シフトの「確認しました」、
// シフト交代のお願い（お願い → 代わります → 店長が承認）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// 「代わります」はデータベースの関数 take_swap（schema.sql）で行う（ほかの人の行を直すため）。
// ============================================================

import {
  supabaseClient, must, newId, requireMe, requireManager, currentStore,
  swapMap, workMap, companyMembers, companyStores, canWorkAt, notify, sendPush,
} from "./core.js";
import { today, label } from "../../lib/date.js";
import { range } from "../../lib/time.js";

/** 画面の関数（supabase-api.js で合体する） */
export const noticesApi = {
  // ---------- お知らせ ----------

  /** 自分へのお知らせ（新しい順） */
  async listNotifications() {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("notifications").select("*").eq("member_id", user.id).order("at", { ascending: false }).limit(100))
      .map((note) => ({ memberId: note.member_id, at: note.at, text: note.text }));
  },

  /** 公開した時：その店舗の人＋応援の人全員に知らせる（店長） */
  async notifyPublished(periodId, weekLabel) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("store_id, guests").eq("id", periodId).single());   // その週
    const guests = new Set(period.guests || []);                                                             // 応援の人
    const people = (await companyMembers()).filter((member) => member.active && (canWorkAt(member, period.store_id) || guests.has(member.id)));   // 知らせる人（その店舗の人と応援の人）
    await notify(people.map((member) => member.id), `${weekLabel}のシフトが公開されました`);
    return true;
  },

  /** 希望をまだ出していない人に催促（店長） */
  async remindHopes(memberIds, text) {
    await requireManager();
    await notify(memberIds, text);
    return memberIds.length;
  },

  // ---------- プッシュ通知の宛先（2026年11月6日） ----------

  /** このスマホの宛先を保存する（lib/push.js から） */
  async savePushSubscription(sub) {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();             // Supabase の道具
    must(await client.from("push_subs").upsert({
      endpoint: sub.endpoint, member_id: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    }, { onConflict: "endpoint" }));
    return true;
  },

  /** このスマホの宛先を消す */
  async deletePushSubscription(endpoint) {
    await requireMe();
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("push_subs").delete().eq("endpoint", endpoint));
    return true;
  },

  // ---------- 「確認しました」 ----------

  /** 自分がその週を確認した */
  async confirmPeriod(periodId) {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("confirms").upsert({ period_id: periodId, member_id: user.id, at: new Date().toISOString() }, { onConflict: "period_id,member_id" }));
    return true;
  },

  /** その週を確認した人（店長＝全員分、店員＝自分の分。データベースの決まりで） */
  async listConfirms(periodId) {
    await requireMe();
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("confirms").select("*").eq("period_id", periodId)).map((row) => ({ periodId: row.period_id, memberId: row.member_id, at: row.at }));
  },

  // ---------- シフト交代 ----------

  /** 自分の勤務の交代をお願いする */
  async offerShift(assignmentId, note) {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const row = must(await client.from("assignments").select("*").eq("id", assignmentId).maybeSingle());   // その勤務
    const shift = row && workMap.from(row);   // その勤務（アプリの形）
    if (!shift || shift.memberId !== user.id) throw new Error("自分の勤務だけお願いできます");
    if (shift.date < today()) throw new Error("終わった勤務はお願いできません");
    const open = must(await client.from("swaps").select("id").eq("assignment_id", assignmentId).in("status", ["open", "taken"]));   // 出しているお願い
    if (open.length) throw new Error("もうお願いしています");
    const swap = swapMap.from(must(await client.from("swaps").insert(swapMap.to({   // 出したお願い
      id: newId(), assignmentId, storeId: shift.storeId, date: shift.date, from: shift.from, to: shift.to, area: shift.area,
      fromMemberId: user.id, takerId: null, note: note || "", status: "open",
    })).select().single()));                                           // 出したお願い
    // その店舗で働ける人に知らせる
    const people = (await companyMembers()).filter((member) => member.id !== user.id && member.active && canWorkAt(member, shift.storeId));
    await notify(people.map((member) => member.id), `${label(shift.date)} ${range(shift.from, shift.to)} の交代をさがしています（ホームから「代わります」）`);
    return swap;
  },

  /** 交代の一覧（店員＝行ける店舗の募集中と自分の分、店長＝今の店舗の全部） */
  async listSwaps() {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const [rows, members, stores] = await Promise.all([   // 今日から先のお願い・店員・店舗
      client.from("swaps").select("*").gte("date", today()).order("date").then(must),
      companyMembers(), companyStores(),
    ]);
    const nameOf = (id) => members.find((member) => member.id === id)?.name || "";             // IDから名前
    const shortOf = (id) => stores.find((store) => store.id === id)?.short || "";            // 店舗の短い名前
    const list = rows.map(swapMap.from).map((swap) => ({ ...swap, fromName: nameOf(swap.fromMemberId), takerName: nameOf(swap.takerId), storeShort: shortOf(swap.storeId) }));   // 名前と店舗の短い名前をつけたお願い
    if (user.role === "manager") {
      const store = await currentStore();   // 今見ている店舗
      return list.filter((swap) => swap.storeId === store);
    }
    return list.filter((swap) => swap.fromMemberId === user.id || swap.takerId === user.id || (swap.status === "open" && canWorkAt(user, swap.storeId)));
  },

  /** 「代わります」（店員）→ データベースの関数 take_swap */
  async takeSwap(swapId) {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();             // Supabase の道具
    const result = must(await client.rpc("take_swap", { p_swap_id: swapId }));   // データベースの関数の結果（お知らせもここで入る）
    // 店長のスマホにも通知を送る（お知らせはデータベースの関数が入れたので、通知だけ）
    const shift = swapMap.from(must(await client.from("swaps").select("*").eq("id", swapId).maybeSingle()));   // そのお願い
    const bosses = (await companyMembers()).filter((member) => member.role === "manager" && member.active).map((member) => member.id);   // 店長
    if (shift) sendPush(bosses, `${label(shift.date)} ${range(shift.from, shift.to)} の交代：${user.name}さんが代わると言っています（承認待ち）`);
    return result;
  },

  /** お願いを取り下げる（本人） */
  async cancelSwap(swapId) {
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const rows = must(await client.from("swaps").update({ status: "canceled" }).eq("id", swapId).eq("from_member_id", user.id).in("status", ["open", "taken"]).select());   // 取り下げたお願い（自分のものだけ）
    if (!rows.length) throw new Error("取り下げられません");
    return swapMap.from(rows[0]);
  },

  /** 店長が承認／却下。承認したら勤務の人を入れ替える */
  async decideSwap(swapId, approve) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const swap = swapMap.from(must(await client.from("swaps").select("*").eq("id", swapId).maybeSingle()));   // そのお願い
    if (!swap || swap.status !== "taken") throw new Error("承認待ちではありません");
    must(await client.from("swaps").update({ status: approve ? "approved" : "rejected" }).eq("id", swapId));
    if (approve) must(await client.from("assignments").update({ member_id: swap.takerId }).eq("id", swap.assignmentId));
    const text = approve ? `${label(swap.date)} ${range(swap.from, swap.to)} の交代が決まりました` : `${label(swap.date)} ${range(swap.from, swap.to)} の交代は店長が見送りました`;   // 本人へのお知らせの文
    await notify([swap.fromMemberId, swap.takerId], text);
    return { ...swap, status: approve ? "approved" : "rejected" };
  },
};
