// ============================================================
// api/supabase/members.js — 店員・人ごとのルール・時給（本物）
// ------------------------------------------------------------
// このファイルは、店員の一覧・作る・直す・初回コードを出す、
// 人ごとのルールと時給（店長だけ）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import {
  sb, must, newId, requireMe, requireManager, currentStore,
  memberFrom, memberTo, companyMembers, companyStores, canWorkAt, rankAt,
} from "./core.js";

/** 画面の関数（supabase-api.js で合体する） */
export const membersApi = {
  /**
   * その店舗（なければ今の店舗）で働ける店員。rankHere＝その店舗での順番
   * 店員も同じ会社の店舗なら見られる（公開シフト用）
   */
  async listMembers(storeId) {
    await requireMe();
    const store = storeId || (await currentStore());                   // 見る店舗
    return (await companyMembers())
      .filter((m) => canWorkAt(m, store))
      .map((m) => ({ ...m, rankHere: rankAt(m, store) }));
  },

  /** 会社の店員みんな（店長。「人を追加」で使う）。mainShort・canHere つき */
  async listCompanyMembers() {
    await requireManager();
    const [members, stores, store] = await Promise.all([companyMembers(), companyStores(), currentStore()]);   // 店員・店舗・今の店舗
    return members.filter((m) => m.active).map((m) => ({
      ...m,
      mainShort: stores.find((s) => s.id === m.storeId)?.short || "",
      canHere: canWorkAt(m, store),
    }));
  },

  /**
   * 店員を作る（店長）。account:false ならアカウントはまだ作らない
   * @returns {{member, code}} code＝初回コード（アカウントなしの時は null）
   */
  async createMember({ name, kind, skills, everyday, stores, account = true }) {
    const boss = await requireManager();                               // 店長
    if (!name?.trim()) throw new Error("名前を入れてください");
    const list = stores?.length ? stores : [{ storeId: await currentStore(), rank: 1 }];   // 行ける店舗
    const c = await sb();   // Supabase の道具
    const row = must(await c.from("members").insert(memberTo({   // 作った店員
      id: newId(), companyId: boss.companyId, name: name.trim(), role: "staff", kind, skills,
      everyday: !!everyday, active: true, account: "none",
      storeId: list.find((s) => s.rank === 1)?.storeId || list[0].storeId, stores: list,
    })).select().single());                                            // 作った店員
    let code = null;                                                   // 初回コード
    if (account) code = must(await c.rpc("issue_login_code", { p_member_id: row.id })).code;
    const member = memberFrom(must(await c.from("members").select("*").eq("id", row.id).single()));   // 読み直す（account が変わるため）
    return { member, code };
  },

  /** 店員の情報を変える（店長） */
  async saveMember(member) {
    await requireManager();
    const { rankHere, loginId, companyId, account, ...clean } = member;   // 画面用・変えないものは外す
    const main = clean.stores?.find((s) => s.rank === 1);                 // メインの店舗
    if (main) clean.storeId = main.storeId;
    const c = await sb();   // Supabase の道具
    return memberFrom(must(await c.from("members").update(memberTo(clean)).eq("id", member.id).select().single()));
  },

  /** 初回コードを出す（店長）。アカウント作成・パスワードを忘れた時 */
  async resetPassword(memberId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return must(await c.rpc("issue_login_code", { p_member_id: memberId }));
  },

  // ---------- 人ごとのルール（店長だけ） ----------

  /** その人のルール */
  async getMemberRule(memberId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return must(await c.from("member_rules").select("text").eq("member_id", memberId).maybeSingle())?.text || "";
  },

  /** ルールの一覧 */
  async listMemberRules() {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return must(await c.from("member_rules").select("*")).map((r) => ({ memberId: r.member_id, text: r.text }));
  },

  /** ルールを保存（空なら消す） */
  async saveMemberRule(memberId, text) {
    const boss = await requireManager();                               // 店長
    const c = await sb();   // Supabase の道具
    if (!text.trim()) must(await c.from("member_rules").delete().eq("member_id", memberId));
    else must(await c.from("member_rules").upsert({ member_id: memberId, company_id: boss.companyId, text: text.trim() }, { onConflict: "member_id" }));
    return true;
  },

  // ---------- 時給・交通費（店長だけ） ----------

  /** 時給の一覧 */
  async listWages() {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return must(await c.from("wages").select("*")).map((w) => ({
      memberId: w.member_id, hourly: w.hourly, transport: w.transport,
      minor: w.minor, monthHoursMax: w.month_hours_max, yearYenMax: w.year_yen_max,   // 働き方のルール
    }));
  },

  /** 時給・交通費と、働き方のルール（18歳未満・月の上限時間・年の上限金額）を保存 */
  async saveWage(memberId, hourly, transport, extra = {}) {
    const boss = await requireManager();                               // 店長
    const c = await sb();   // Supabase の道具
    must(await c.from("wages").upsert({
      member_id: memberId, company_id: boss.companyId, hourly: Number(hourly) || 0, transport: Number(transport) || 0,
      minor: !!extra.minor, month_hours_max: Number(extra.monthHoursMax) || null, year_yen_max: Number(extra.yearYenMax) || null,
    }, { onConflict: "member_id" }));
    return true;
  },
};
