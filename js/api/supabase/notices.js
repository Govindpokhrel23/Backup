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
  companyMembers, canWorkAt, notify,   // 形の変換・会社の店員と店舗・お知らせ・通知
} from "./core.js";   // 読む元

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
  // シフト交代の機能はなくした（2026年11月15日）。出られない時は店長に直接連絡し、店長がシフトを直す

};
