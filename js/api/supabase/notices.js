// ============================================================
// api/supabase/notices.js — お知らせ・「見ました」・シフト交代（本物）
// ------------------------------------------------------------
// このファイルは、お知らせ、公開シフトの「確認しました」、
// シフト交代のお願い（お願い → 代わります → 店長が承認）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// 「代わります」はデータベースの関数 take_swap（schema.sql）で行う（ほかの人の行を直すため）。
// ============================================================

import {   // Supabase の道具を読む
  supabaseClient, must, newId, requireMe, requireManager, currentStore,   // 通信・ID・ログインのチェック・今の店舗
  swapMap, workMap, companyMembers, companyStores, canWorkAt, notify, sendPush,   // 形の変換・会社の店員と店舗・お知らせ・通知
} from "./core.js";   // 読む元
import { today, label } from "../../lib/date.js";   // 日付の道具を読む
import { range } from "../../lib/time.js";   // 時間の表示の道具を読む

/** 画面の関数（supabase-api.js で合体する） */
export const noticesApi = {   // お知らせの窓口
  // ---------- お知らせ ----------

  /** 自分へのお知らせ（新しい順） */
  async listNotifications() {   // 自分のお知らせを出す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("notifications").select("*").eq("member_id", user.id).order("at", { ascending: false }).limit(100))   // 新しい順に100件
      .map((note) => ({ memberId: note.member_id, at: note.at, text: note.text }));   // 人・時間・文の形にする
  },

  /** 公開した時：その店舗の人＋応援の人全員に知らせる（店長） */
  async notifyPublished(periodId, weekLabel) {   // 公開したことを知らせる関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("store_id, guests").eq("id", periodId).single());   // その週
    const guests = new Set(period.guests || []);                                                             // 応援の人
    const people = (await companyMembers()).filter((member) => member.active && (canWorkAt(member, period.store_id) || guests.has(member.id)));   // 知らせる人（その店舗の人と応援の人）
    await notify(people.map((member) => member.id), `${weekLabel}のシフトが公開されました`);   // 入っている人に知らせる
    return true;   // できた
  },

  /** 希望をまだ出していない人に催促（店長） */
  async remindHopes(memberIds, text) {   // 希望を出してと知らせる関数
    await requireManager();   // 店長でなければ止める
    await notify(memberIds, text);   // 知らせる
    return memberIds.length;   // 知らせた人数を返す
  },

  // ---------- プッシュ通知の宛先（2026年11月6日） ----------

  /** このスマホの宛先を保存する（lib/push.js から） */
  async savePushSubscription(sub) {   // 通知の宛先を保存する関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();             // Supabase の道具
    must(await client.from("push_subs").upsert({   // 保存（同じ宛先なら上書き）
      endpoint: sub.endpoint, member_id: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth,   // 宛先・自分・鍵
    }, { onConflict: "endpoint" }));   // 同じ宛先なら上書き
    return true;   // できた
  },

  /** このスマホの宛先を消す */
  async deletePushSubscription(endpoint) {   // 通知の宛先を消す関数
    await requireMe();   // ログインしていなければ止める
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("push_subs").delete().eq("endpoint", endpoint));   // 消す
    return true;   // できた
  },

  // ---------- 「確認しました」 ----------

  /** 自分がその週を確認した */
  async confirmPeriod(periodId) {   // 「シフトを見ました」を記録する関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("confirms").upsert({ period_id: periodId, member_id: user.id, at: new Date().toISOString() }, { onConflict: "period_id,member_id" }));   // 保存（同じなら上書き）
    return true;   // できた
  },

  /** その週を確認した人（店長＝全員分、店員＝自分の分。データベースの決まりで） */
  async listConfirms(periodId) {   // 「見ました」の一覧を出す関数
    await requireMe();   // ログインしていなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("confirms").select("*").eq("period_id", periodId)).map((row) => ({ periodId: row.period_id, memberId: row.member_id, at: row.at }));   // 週・人・時間の形で返す
  },

  // ---------- シフト交代 ----------

  /**
   * 交代を頼める人（その店舗で働けて、同じ時間に勤務がない人。2026年11月15日）
   * @returns {Promise<{id:string,name:string,kind:string}[]>}
   */
  async listSwapCandidates(assignmentId) {   // 頼める人を出す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const shift = workMap.from(must(await client.from("assignments").select("*").eq("id", assignmentId).single()));   // その勤務
    const busy = new Set(must(await client.from("assignments").select("member_id, from_min, to_min").eq("date", shift.date))   // その日の勤務
      .filter((row) => row.from_min < shift.to && shift.from < row.to_min).map((row) => row.member_id));   // 同じ時間に入っている人
    return (await companyMembers())   // 会社の店員
      .filter((member) => member.id !== user.id && member.active && !member.developer && canWorkAt(member, shift.storeId) && !busy.has(member.id))   // 頼める人
      .map((member) => ({ id: member.id, name: member.name, kind: member.kind }));   // 名前と立場
  },

  /** 自分の勤務の交代をお願いする（targets：頼む人のID。空なら行ける人みんな） */
  async offerShift(assignmentId, note, targets = []) {   // 交代をお願いする関数
    const user = await requireMe();   // ログイン中の人
    targets = await cleanTargets(targets, user);   // 頼む人は、会社の休止していない人だけ
    const client = await supabaseClient();   // Supabase の道具
    const row = must(await client.from("assignments").select("*").eq("id", assignmentId).maybeSingle());   // その勤務
    const shift = row && workMap.from(row);   // その勤務（アプリの形）
    if (!shift || shift.memberId !== user.id) throw new Error("自分の勤務だけお願いできます");   // 自分の勤務でなければ止める
    if (shift.date < today()) throw new Error("終わった勤務はお願いできません");   // 終わった勤務なら止める
    const open = must(await client.from("swaps").select("id").eq("assignment_id", assignmentId).in("status", ["open", "taken"]));   // 出しているお願い
    if (open.length) throw new Error("もうお願いしています");   // もうお願いしていれば止める
    const swap = swapMap.from(must(await client.from("swaps").insert(swapMap.to({   // 出したお願い
      id: newId(), assignmentId, storeId: shift.storeId, date: shift.date, from: shift.from, to: shift.to, area: shift.area,   // ID・勤務・店舗・日・時間・場所
      fromMemberId: user.id, takerId: null, note: note || "", status: "open", targets,   // お願いした人・まだ誰も代わっていない・メモ・さがし中・頼む人
    })).select().single()));                                           // 出したお願い
    await notify(await swapRecipients(swap, user), swapText(swap, user));   // 頼む人（なければ行ける人みんな）に知らせる
    return swap;   // お願いを返す
  },

  /** 出したお願いを直す（メッセージ・頼む人）。新しく頼んだ人にだけ知らせる（2026年11月15日） */
  async updateSwap(swapId, { note, targets }) {   // お願いを直す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const before = swapMap.from(must(await client.from("swaps").select("*").eq("id", swapId).eq("from_member_id", user.id).maybeSingle()) || {});   // 前のお願い
    if (!before?.id || before.status !== "open") throw new Error("さがし中のお願いだけ直せます");   // さがし中でなければ止める
    targets = await cleanTargets(targets, user);   // 頼む人は、会社の休止していない人だけ
    const rows = must(await client.from("swaps").update({ note: note || "", targets }).eq("id", swapId).eq("status", "open").select());   // 直す
    if (!rows.length) throw new Error("直せませんでした（もう誰かが代わると言ったかもしれません）");   // 直せなければ止める
    const after = swapMap.from(rows[0]);   // 直したお願い
    const old = new Set(await swapRecipients(before, user));   // 前に知らせた人
    const fresh = (await swapRecipients(after, user)).filter((id) => !old.has(id));   // 新しく知らせる人
    if (fresh.length) await notify(fresh, swapText(after, user));   // 新しく頼んだ人に知らせる
    return after;   // 直したお願いを返す
  },

  /** 交代の一覧（店員＝行ける店舗の募集中と自分の分、店長＝今の店舗の全部） */
  async listSwaps() {   // 交代の一覧を出す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const [rows, members, stores] = await Promise.all([   // 今日から先のお願い・店員・店舗
      client.from("swaps").select("*").gte("date", today()).order("date").then(must),   // 今日から先の交代
      companyMembers(), companyStores(),   // 会社の店員と店舗
    ]);
    const nameOf = (id) => members.find((member) => member.id === id)?.name || "";             // IDから名前
    const shortOf = (id) => stores.find((store) => store.id === id)?.short || "";            // 店舗の短い名前
    const list = rows.map(swapMap.from).map((swap) => ({ ...swap, fromName: nameOf(swap.fromMemberId), takerName: nameOf(swap.takerId), storeShort: shortOf(swap.storeId) }));   // 名前と店舗の短い名前をつけたお願い
    if (user.role === "manager") {   // 店長なら
      const store = await currentStore();   // 今見ている店舗
      return list.filter((swap) => swap.storeId === store);   // 今の店舗の分
    }
    return list.filter((swap) => swap.fromMemberId === user.id || swap.takerId === user.id || (swap.status === "open" && canWorkAt(user, swap.storeId) && forMe(swap, user)));   // 店員なら、自分の分と、代われるもの（頼まれた分だけ）
  },

  /** 「代わります」（店員）→ データベースの関数 take_swap */
  async takeSwap(swapId) {   // 交代を引き受ける関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();             // Supabase の道具
    const result = must(await client.rpc("take_swap", { p_swap_id: swapId }));   // データベースの関数の結果（お知らせもここで入る）
    // 店長のスマホにも通知を送る（お知らせはデータベースの関数が入れたので、通知だけ）
    const shift = swapMap.from(must(await client.from("swaps").select("*").eq("id", swapId).maybeSingle()));   // そのお願い
    const bosses = (await companyMembers()).filter((member) => member.role === "manager" && member.active).map((member) => member.id);   // 店長
    if (shift) sendPush(bosses, `${label(shift.date)} ${range(shift.from, shift.to)} の交代：${user.name}さんが代わると言っています（承認待ち）`);   // 店長に通知
    return result;   // 結果を返す
  },

  /** お願いを取り下げる（本人） */
  async cancelSwap(swapId) {   // 交代のお願いを取り下げる関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const rows = must(await client.from("swaps").update({ status: "canceled" }).eq("id", swapId).eq("from_member_id", user.id).in("status", ["open", "taken"]).select());   // 取り下げたお願い（自分のものだけ）
    if (!rows.length) throw new Error("取り下げられません");   // 取り下げられなければエラー
    return swapMap.from(rows[0]);   // 取り下げたものを返す
  },

  /** 店長が承認／却下。承認したら勤務の人を入れ替える */
  async decideSwap(swapId, approve) {   // 交代を承認・却下する関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const swap = swapMap.from(must(await client.from("swaps").select("*").eq("id", swapId).maybeSingle()));   // そのお願い
    if (!swap || swap.status !== "taken") throw new Error("承認待ちではありません");   // 承認待ちでなければ止める
    must(await client.from("swaps").update({ status: approve ? "approved" : "rejected" }).eq("id", swapId));   // 状態を変える
    if (approve) must(await client.from("assignments").update({ member_id: swap.takerId }).eq("id", swap.assignmentId));   // 承認なら勤務の人を変える
    const text = approve ? `${label(swap.date)} ${range(swap.from, swap.to)} の交代が決まりました` : `${label(swap.date)} ${range(swap.from, swap.to)} の交代は店長が見送りました`;   // 本人へのお知らせの文
    await notify([swap.fromMemberId, swap.takerId], text);   // 2人に知らせる
    return { ...swap, status: approve ? "approved" : "rejected" };   // 変えたものを返す
  },
};

/** 交代のお願いを知らせる人：頼む人を決めてあればその人、なければその店舗で働ける人みんな（2026年11月15日） */
async function swapRecipients(swap, user) {   // 知らせる人を出す関数
  if (swap.targets?.length) return swap.targets;   // 頼む人を決めてあればその人
  return (await companyMembers()).filter((member) => member.id !== user.id && member.active && canWorkAt(member, swap.storeId)).map((member) => member.id);   // 行ける人みんな
}

/** 交代のお願いの知らせの文（メッセージがあれば付ける） */
function swapText(swap, user) {   // 知らせの文を作る関数
  return `${user.name}さんから：${label(swap.date)} ${range(swap.from, swap.to)} の交代をさがしています${swap.note ? `「${swap.note}」` : ""}（ホームから「代わります」）`;   // 文
}

/** この交代が自分に向けたものか（頼む人を決めていなければ、みんなに向けたもの） */
function forMe(swap, user) {   // 自分に向けたものか調べる関数
  return !swap.targets?.length || swap.targets.includes(user.id);   // 決めていない・自分が入っている
}

/** 頼む人を、会社の休止していない人だけにする（自分はのぞく） */
async function cleanTargets(targets, user) {   // 頼む人を確かめる関数
  const ok = new Set((await companyMembers()).filter((member) => member.active && member.id !== user.id).map((member) => member.id));   // 頼んでよい人
  return [...new Set(targets || [])].filter((id) => ok.has(id));   // 頼んでよい人だけ（同じ人は1回）
}
