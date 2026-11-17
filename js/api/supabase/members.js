// ============================================================
// api/supabase/members.js — 店員・人ごとのルール・時給（本物）
// ------------------------------------------------------------
// このファイルは、店員の一覧・作る・直す・初回コードを出す、
// 人ごとのルールと時給（店長だけ）を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import {   // Supabase の道具を読む
  supabaseClient, must, newId, requireMe, requireManager, currentStore,   // 通信・ID・ログインのチェック・今の店舗
  memberFrom, memberTo, companyMembers, companyStores, canWorkAt, rankAt,   // 店員の形の変換・会社の店員と店舗・働ける店と順位
} from "./core.js";   // 読む元

/** 画面の関数（supabase-api.js で合体する） */
export const membersApi = {   // 店員の窓口
  /**
   * その店舗（なければ今の店舗）で働ける店員。rankHere＝その店舗での順番
   * 店員も同じ会社の店舗なら見られる（公開シフト用）
   */
  async listMembers(storeId) {   // その店舗で働ける店員を出す関数
    await requireMe();   // ログインしていなければ止める
    const store = storeId || (await currentStore());                   // 見る店舗
    return (await companyMembers())   // 会社の店員から
      .filter((member) => canWorkAt(member, store))   // その店舗で働ける人だけ
      .map((member) => ({ ...member, rankHere: rankAt(member, store) }));   // その店での順位も付ける
  },

  /** 会社の店員みんな（店長。「人を追加」で使う）。mainShort・canHere つき */
  /** 開発者アカウントの一覧（店長。スタッフの登録・設定で止めたり再開したりする。2026年11月12日） */
  async listDevelopers() {   // 開発者の一覧を出す関数
    await requireManager();   // 店長でなければ止める
    return (await companyMembers()).filter((member) => member.developer);   // 開発者だけ
  },

  async listCompanyMembers() {   // 会社の店員を全部出す関数（人を追加する時）
    await requireManager();   // 店長でなければ止める
    const [members, stores, store] = await Promise.all([companyMembers(), companyStores(), currentStore()]);   // 店員・店舗・今の店舗
    return members.filter((member) => member.active && !member.developer).map((member) => ({   // 休止していない人を（開発者は出さない）
      ...member,   // もとの情報
      mainShort: stores.find((store) => store.id === member.storeId)?.short || "",   // 所属店の短い名前
      canHere: canWorkAt(member, store),   // この店舗で働けるか
    }));
  },

  /**
   * 店員を作る（店長）。account:false ならアカウントはまだ作らない
   * @returns {{member, code}} code＝初回コード（アカウントなしの時は null）
   */
  async createMember({ name, kind, skills, everyday, stores, account = true }) {   // 店員を作る関数
    const boss = await requireManager();                               // 店長
    if (!name?.trim()) throw new Error("名前を入れてください");   // 名前がなければ止める
    const list = stores?.length ? stores : [{ storeId: await currentStore(), rank: 1 }];   // 行ける店舗
    const client = await supabaseClient();   // Supabase の道具
    const row = must(await client.from("members").insert(memberTo({   // 作った店員
      id: newId(), companyId: boss.companyId, name: name.trim(), role: "staff", kind, skills,   // ID・会社・名前・役割・立場・できること
      everyday: !!everyday, active: true, account: "none",   // 毎日入るか・休止していない・まだアカウントなし
      storeId: list.find((storeRank) => storeRank.rank === 1)?.storeId || list[0].storeId, stores: list,   // 所属店（順位1の店）と働ける店舗
    })).select().single());                                            // 作った店員
    let code = null;                                                   // 初回コード
    if (account) code = must(await client.rpc("issue_login_code", { p_member_id: row.id })).code;   // アカウントを作るなら初回コードを出す
    const member = memberFrom(must(await client.from("members").select("*").eq("id", row.id).single()));   // 読み直す（account が変わるため）
    return { member, code };   // 店員と初回コードを返す
  },

  /** 店員の情報を変える（店長） */
  async saveMember(member) {   // 店員を保存する関数
    await requireManager();   // 店長でなければ止める
    const { rankHere, loginId, companyId, account, ...clean } = member;   // 画面用・変えないものは外す
    const main = clean.stores?.find((storeRank) => storeRank.rank === 1);                 // メインの店舗
    if (main) clean.storeId = main.storeId;   // 順位1の店を所属店にする
    const client = await supabaseClient();   // Supabase の道具
    return memberFrom(must(await client.from("members").update(memberTo(clean)).eq("id", member.id).select().single()));   // 保存して、保存したものを返す
  },

  /** 初回コードを出す（店長）。アカウント作成・パスワードを忘れた時 */
  async resetPassword(memberId) {   // パスワードを作り直す（新しい初回コード）関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.rpc("issue_login_code", { p_member_id: memberId }));   // 新しい初回コードを返す
  },

  // ---------- 人ごとのルール（店長だけ） ----------

  /** その人のルール */
  async getMemberRule(memberId) {   // その人のルールのメモを読む関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("member_rules").select("text").eq("member_id", memberId).maybeSingle())?.text || "";   // メモを返す（なければ空）
  },

  /** ルールの一覧 */
  async listMemberRules() {   // 全員のルールのメモを読む関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("member_rules").select("*")).map((rule) => ({ memberId: rule.member_id, text: rule.text }));   // 人とメモの一覧
  },

  /** ルールを保存（空なら消す） */
  async saveMemberRule(memberId, text) {   // ルールのメモを保存する関数
    const boss = await requireManager();                               // 店長
    const client = await supabaseClient();   // Supabase の道具
    if (!text.trim()) must(await client.from("member_rules").delete().eq("member_id", memberId));   // 空なら消す
    else must(await client.from("member_rules").upsert({ member_id: memberId, company_id: boss.companyId, text: text.trim() }, { onConflict: "member_id" }));   // あれば保存（同じ人なら上書き）
    return true;   // できた
  },

  // ---------- 時給・交通費（店長だけ） ----------

  /** 時給の一覧 */
  async listWages() {   // 時給・交通費の一覧を出す関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("wages").select("*")).map((wage) => ({   // 1人ずつ
      memberId: wage.member_id, hourly: wage.hourly, transport: wage.transport,   // 人・時給・交通費
      minor: wage.minor, monthHoursMax: wage.month_hours_max, yearYenMax: wage.year_yen_max,   // 働き方のルール
    }));
  },

  /** 時給・交通費と、働き方のルール（18歳未満・月の上限時間・年の上限金額）を保存 */
  async saveWage(memberId, hourly, transport, extra = {}) {   // 時給・交通費・働き方のルールを保存する関数
    const boss = await requireManager();                               // 店長
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("wages").upsert({   // 保存（同じ人なら上書き）
      member_id: memberId, company_id: boss.companyId, hourly: Number(hourly) || 0, transport: Number(transport) || 0,   // 人・会社・時給・交通費
      minor: !!extra.minor, month_hours_max: Number(extra.monthHoursMax) || null, year_yen_max: Number(extra.yearYenMax) || null,   // 18歳未満・月の上限時間・年の上限金額
    }, { onConflict: "member_id" }));   // 同じ人なら上書き
    return true;   // できた
  },
};
