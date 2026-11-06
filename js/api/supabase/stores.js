// ============================================================
// api/supabase/stores.js — 店舗・営業時間・マップ・必要人数・祝日（本物）
// ------------------------------------------------------------
// このファイルは、店舗を増やす・名前を変える・休止する・切り替える、
// 営業時間・マップの人のマーク・必要人数を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import {
  supabaseClient, must, newId, requireMe, requireManager, currentStore, rememberStore,
  storeMap, positionMap, reqMap, companyStores, companyMembers, memberTo,
} from "./core.js";

/** 営業時間がまだない時の初期値（7:00〜22:00） */
const DEFAULT_HOURS = { weekday: { open: 420, close: 1320 }, sat: { open: 420, close: 1320 }, sun: { open: 420, close: 1320 } };

/** 画面の関数（supabase-api.js で合体する） */
export const storesApi = {
  /** 会社の店舗の一覧（休止中も） */
  async listStores() {
    await requireMe();
    return companyStores();
  },

  /**
   * 店舗を増やす（店長）。copyFrom の店舗の営業時間・マップ・必要人数を写せる
   * @param {{name:string, short:string, copyFrom?:string}} p
   */
  async createStore({ name, short, copyFrom }) {
    const boss = await requireManager();                               // 店長
    if (!name?.trim() || !short?.trim()) throw new Error("店舗名と短い名前を入れてください");
    const stores = await companyStores();                              // 今の店舗
    if (stores.some((store) => store.name === name.trim())) throw new Error("同じ名前の店舗があります");
    if (stores.some((store) => store.short === short.trim())) throw new Error("同じ短い名前の店舗があります");
    const client = await supabaseClient();   // Supabase の道具
    const from = stores.find((store) => store.id === copyFrom);                // 写す元の店舗
    const hours = from ? must(await client.from("stores").select("hours").eq("id", from.id).single()).hours : DEFAULT_HOURS;   // 営業時間（写す元があればその時間）
    const row = must(await client.from("stores").insert({   // 足した店舗
      id: newId(), company_id: boss.companyId, name: name.trim(), short: short.trim(), active: true, hours,
    }).select().single());                                             // 足した店舗
    // 店長は会社の全部の店舗を見られるので、行ける店舗にも足す
    for (const member of (await companyMembers()).filter((member) => member.role === "manager")) {
      const list = member.stores?.length ? member.stores : [{ storeId: member.storeId, rank: 1 }];   // 今の行ける店舗
      list.push({ storeId: row.id, rank: Math.max(...list.map((storeRank) => storeRank.rank)) + 1 });
      must(await client.from("members").update({ stores: list }).eq("id", member.id));
    }
    if (from) await copyMap(from.id, row.id);
    return storeMap.from(row);
  },

  /** 何人かまとめて「この店舗にも行ける」にする（店長） */
  async addMembersToStore(storeId, memberIds) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const members = await companyMembers();                            // 会社の店員
    let count = 0;                                                         // 足した人数
    for (const id of memberIds) {
      const member = members.find((member) => member.id === id);                      // その店員
      if (!member) continue;
      const list = member.stores?.length ? member.stores : [{ storeId: member.storeId, rank: 1 }];   // 行ける店舗
      if (list.some((storeRank) => storeRank.storeId === storeId)) continue;
      list.push({ storeId, rank: Math.max(...list.map((storeRank) => storeRank.rank)) + 1 });
      must(await client.from("members").update(memberTo({ stores: list })).eq("id", id));
      count++;
    }
    return count;
  },

  /** 店舗の名前を変える（店長） */
  async updateStore(storeId, { name, short }) {
    await requireManager();
    if (!name?.trim() || !short?.trim()) throw new Error("店舗名と短い名前を入れてください");
    const stores = await companyStores();                              // 今の店舗
    if (stores.some((store) => store.id !== storeId && store.name === name.trim())) throw new Error("同じ名前の店舗があります");
    const client = await supabaseClient();   // Supabase の道具
    return storeMap.from(must(await client.from("stores").update({ name: name.trim(), short: short.trim() }).eq("id", storeId).select().single()));
  },

  /** 店舗を休止する／再開する（店長）。データは消さない */
  async setStoreActive(storeId, active) {
    await requireManager();
    const stores = await companyStores();                              // 今の店舗
    if (!active && stores.filter((store) => store.active !== false).length <= 1) throw new Error("最後の1店舗は休止できません");
    const client = await supabaseClient();   // Supabase の道具
    const row = must(await client.from("stores").update({ active: !!active }).eq("id", storeId).select().single());   // 直した店舗
    // 休止した店舗を見ていたら、ほかの店舗に切り替える
    if (!active && (await currentStore()) === storeId) await rememberStore(stores.find((store) => store.id !== storeId && store.active !== false).id);
    return storeMap.from(row);
  },

  /** 今見ている店舗のID */
  async currentStoreId() {
    return currentStore();
  },

  /** 店舗を切り替える（店長） */
  async setCurrentStore(storeId) {
    await requireManager();
    if (!(await companyStores()).some((store) => store.id === storeId)) throw new Error("店舗が見つかりません");
    await rememberStore(storeId);
    return storeId;
  },

  // ---------- 営業時間 ----------

  /** その店舗（なければ今の店舗）の営業時間 */
  async getStoreHours(storeId) {
    const client = await supabaseClient();   // Supabase の道具
    const id = storeId || (await currentStore());                      // 見る店舗
    const row = must(await client.from("stores").select("hours").eq("id", id).maybeSingle());   // その店舗の営業時間
    if (!row) throw new Error("この店舗は見られません");
    return row.hours || DEFAULT_HOURS;
  },

  /** 営業時間を保存（店長） */
  async saveStoreHours(hours) {
    await requireManager();
    for (const key of ["weekday", "sat", "sun"]) {
      if (hours[key].close <= hours[key].open) throw new Error("閉店は開店より後にしてください");
    }
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("stores").update({ hours }).eq("id", await currentStore()));
    return true;
  },

  // ---------- マップ・必要人数 ----------

  /** 今の店舗のマップの人のマーク */
  async listPositions() {
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("positions").select("*").eq("store_id", await currentStore())).map(positionMap.from);
  },

  /** マップの人のマークを保存する（店長）。消したマークの必要人数も消える */
  async savePositions(positions) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    const keep = new Set(positions.map((position) => position.id));                  // 残すマーク
    const before = must(await client.from("positions").select("id").eq("store_id", store));   // 今あるマーク
    const drop = before.map((shift) => shift.id).filter((id) => !keep.has(id));                   // 消すマーク
    if (drop.length) must(await client.from("positions").delete().in("id", drop));
    if (positions.length) {
      must(await client.from("positions").upsert(positions.map((position) => positionMap.to({ ...position, storeId: store })), { onConflict: "id" }));
    }
    return true;
  },

  /** 今の店舗の必要人数 */
  async listRequirements() {
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("requirements").select("*").eq("store_id", await currentStore())).map(reqMap.from);
  },

  /** ある担当場所・日の種類の必要人数を入れ替える（店長） */
  async saveRequirements(positionId, dayType, rows) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    must(await client.from("requirements").delete().eq("position_id", positionId).eq("day_type", dayType));
    if (rows.length) {
      must(await client.from("requirements").insert(rows.map((row) => reqMap.to({ id: newId(), positionId, storeId: store, dayType, from: row.from, to: row.to, count: row.count }))));
    }
    return true;
  },

  /** 祝日の一覧（日付の文字の配列） */
  async listHolidays() {
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("holidays").select("date")).map((holiday) => holiday.date);
  },
};

/**
 * マップの人のマークと必要人数を、ほかの店舗に写す（店舗を増やす時）
 * @param {string} fromId 写す元
 * @param {string} toId   写す先
 */
async function copyMap(fromId, toId) {
  const client = await supabaseClient();   // Supabase の道具
  const positions = must(await client.from("positions").select("*").eq("store_id", fromId));   // 元のマーク
  if (!positions.length) return;
  const idMap = new Map(positions.map((position) => [position.id, newId()]));                            // 元のID → 新しいID
  must(await client.from("positions").insert(positions.map((position) => ({ ...position, id: idMap.get(position.id), store_id: toId }))));
  const reqs = must(await client.from("requirements").select("*").eq("store_id", fromId));     // 元の必要人数
  if (reqs.length) {
    must(await client.from("requirements").insert(reqs.map((req) => ({ ...req, id: newId(), position_id: idMap.get(req.position_id), store_id: toId }))));
  }
}
