// ============================================================
// api/supabase/stores.js — 店舗・営業時間・マップ・必要人数・祝日（本物）
// ------------------------------------------------------------
// このファイルは、店舗を増やす・名前を変える・休止する・切り替える、
// 営業時間・マップの人のマーク・必要人数を読み書きするファイルです（2026年11月6日）。
// mock-api.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import {
  sb, must, newId, requireMe, requireManager, currentStore, rememberStore,
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
    if (stores.some((s) => s.name === name.trim())) throw new Error("同じ名前の店舗があります");
    if (stores.some((s) => s.short === short.trim())) throw new Error("同じ短い名前の店舗があります");
    const c = await sb();   // Supabase の道具
    const from = stores.find((s) => s.id === copyFrom);                // 写す元の店舗
    const hours = from ? must(await c.from("stores").select("hours").eq("id", from.id).single()).hours : DEFAULT_HOURS;   // 営業時間（写す元があればその時間）
    const row = must(await c.from("stores").insert({   // 足した店舗
      id: newId(), company_id: boss.companyId, name: name.trim(), short: short.trim(), active: true, hours,
    }).select().single());                                             // 足した店舗
    // 店長は会社の全部の店舗を見られるので、行ける店舗にも足す
    for (const m of (await companyMembers()).filter((x) => x.role === "manager")) {
      const list = m.stores?.length ? m.stores : [{ storeId: m.storeId, rank: 1 }];   // 今の行ける店舗
      list.push({ storeId: row.id, rank: Math.max(...list.map((x) => x.rank)) + 1 });
      must(await c.from("members").update({ stores: list }).eq("id", m.id));
    }
    if (from) await copyMap(from.id, row.id);
    return storeMap.from(row);
  },

  /** 何人かまとめて「この店舗にも行ける」にする（店長） */
  async addMembersToStore(storeId, memberIds) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const members = await companyMembers();                            // 会社の店員
    let n = 0;                                                         // 足した人数
    for (const id of memberIds) {
      const m = members.find((x) => x.id === id);                      // その店員
      if (!m) continue;
      const list = m.stores?.length ? m.stores : [{ storeId: m.storeId, rank: 1 }];   // 行ける店舗
      if (list.some((x) => x.storeId === storeId)) continue;
      list.push({ storeId, rank: Math.max(...list.map((x) => x.rank)) + 1 });
      must(await c.from("members").update(memberTo({ stores: list })).eq("id", id));
      n++;
    }
    return n;
  },

  /** 店舗の名前を変える（店長） */
  async updateStore(storeId, { name, short }) {
    await requireManager();
    if (!name?.trim() || !short?.trim()) throw new Error("店舗名と短い名前を入れてください");
    const stores = await companyStores();                              // 今の店舗
    if (stores.some((s) => s.id !== storeId && s.name === name.trim())) throw new Error("同じ名前の店舗があります");
    const c = await sb();   // Supabase の道具
    return storeMap.from(must(await c.from("stores").update({ name: name.trim(), short: short.trim() }).eq("id", storeId).select().single()));
  },

  /** 店舗を休止する／再開する（店長）。データは消さない */
  async setStoreActive(storeId, active) {
    await requireManager();
    const stores = await companyStores();                              // 今の店舗
    if (!active && stores.filter((s) => s.active !== false).length <= 1) throw new Error("最後の1店舗は休止できません");
    const c = await sb();   // Supabase の道具
    const row = must(await c.from("stores").update({ active: !!active }).eq("id", storeId).select().single());   // 直した店舗
    // 休止した店舗を見ていたら、ほかの店舗に切り替える
    if (!active && (await currentStore()) === storeId) await rememberStore(stores.find((s) => s.id !== storeId && s.active !== false).id);
    return storeMap.from(row);
  },

  /** 今見ている店舗のID */
  async currentStoreId() {
    return currentStore();
  },

  /** 店舗を切り替える（店長） */
  async setCurrentStore(storeId) {
    await requireManager();
    if (!(await companyStores()).some((s) => s.id === storeId)) throw new Error("店舗が見つかりません");
    await rememberStore(storeId);
    return storeId;
  },

  // ---------- 営業時間 ----------

  /** その店舗（なければ今の店舗）の営業時間 */
  async getStoreHours(storeId) {
    const c = await sb();   // Supabase の道具
    const id = storeId || (await currentStore());                      // 見る店舗
    const row = must(await c.from("stores").select("hours").eq("id", id).maybeSingle());   // その店舗の営業時間
    if (!row) throw new Error("この店舗は見られません");
    return row.hours || DEFAULT_HOURS;
  },

  /** 営業時間を保存（店長） */
  async saveStoreHours(hours) {
    await requireManager();
    for (const key of ["weekday", "sat", "sun"]) {
      if (hours[key].close <= hours[key].open) throw new Error("閉店は開店より後にしてください");
    }
    const c = await sb();   // Supabase の道具
    must(await c.from("stores").update({ hours }).eq("id", await currentStore()));
    return true;
  },

  // ---------- マップ・必要人数 ----------

  /** 今の店舗のマップの人のマーク */
  async listPositions() {
    const c = await sb();   // Supabase の道具
    return must(await c.from("positions").select("*").eq("store_id", await currentStore())).map(positionMap.from);
  },

  /** マップの人のマークを保存する（店長）。消したマークの必要人数も消える */
  async savePositions(positions) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    const keep = new Set(positions.map((p) => p.id));                  // 残すマーク
    const before = must(await c.from("positions").select("id").eq("store_id", store));   // 今あるマーク
    const drop = before.map((p) => p.id).filter((id) => !keep.has(id));                   // 消すマーク
    if (drop.length) must(await c.from("positions").delete().in("id", drop));
    if (positions.length) {
      must(await c.from("positions").upsert(positions.map((p) => positionMap.to({ ...p, storeId: store })), { onConflict: "id" }));
    }
    return true;
  },

  /** 今の店舗の必要人数 */
  async listRequirements() {
    const c = await sb();   // Supabase の道具
    return must(await c.from("requirements").select("*").eq("store_id", await currentStore())).map(reqMap.from);
  },

  /** ある担当場所・日の種類の必要人数を入れ替える（店長） */
  async saveRequirements(positionId, dayType, rows) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const store = await currentStore();                                // 今の店舗
    must(await c.from("requirements").delete().eq("position_id", positionId).eq("day_type", dayType));
    if (rows.length) {
      must(await c.from("requirements").insert(rows.map((r) => reqMap.to({ id: newId(), positionId, storeId: store, dayType, from: r.from, to: r.to, count: r.count }))));
    }
    return true;
  },

  /** 祝日の一覧（日付の文字の配列） */
  async listHolidays() {
    const c = await sb();   // Supabase の道具
    return must(await c.from("holidays").select("date")).map((h) => h.date);
  },
};

/**
 * マップの人のマークと必要人数を、ほかの店舗に写す（店舗を増やす時）
 * @param {string} fromId 写す元
 * @param {string} toId   写す先
 */
async function copyMap(fromId, toId) {
  const c = await sb();   // Supabase の道具
  const positions = must(await c.from("positions").select("*").eq("store_id", fromId));   // 元のマーク
  if (!positions.length) return;
  const idMap = new Map(positions.map((p) => [p.id, newId()]));                            // 元のID → 新しいID
  must(await c.from("positions").insert(positions.map((p) => ({ ...p, id: idMap.get(p.id), store_id: toId }))));
  const reqs = must(await c.from("requirements").select("*").eq("store_id", fromId));     // 元の必要人数
  if (reqs.length) {
    must(await c.from("requirements").insert(reqs.map((r) => ({ ...r, id: newId(), position_id: idMap.get(r.position_id), store_id: toId }))));
  }
}
