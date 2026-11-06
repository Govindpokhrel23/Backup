// ============================================================
// api/supabase/ai.js — AIの下書き・店長の直し方の学び（本物）
// ------------------------------------------------------------
// このファイルは、AIが作った下書きを覚えておき、公開した時に店長の直し方と比べて
// 「学び」として保存するファイルです（2026年11月6日）。店長だけが使える。
// mock-ai.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import { sb, must, newId, requireManager, currentStore, learnMap, workMap } from "./core.js";
import { diffDraft } from "../../ai/learning.js";

/** 学びを何個まで残すか（1店舗あたり。古いものから消す） */
const LEARN_KEEP = 300;

/** 画面の関数（supabase-api.js で合体する） */
export const aiApi = {
  /** AIが作った下書きを覚えておく */
  async saveAiDraft(periodId, rows) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const p = must(await c.from("periods").select("store_id").eq("id", periodId).single());   // その週
    const slim = rows.map((a) => ({ memberId: a.memberId, date: a.date, from: a.from, to: a.to, area: a.area, fixed: !!a.fixed }));   // AIの下書き（比べるのに要る所だけ）
    must(await c.from("ai_drafts").upsert({ period_id: periodId, store_id: p.store_id, rows: slim }, { onConflict: "period_id" }));
    return true;
  },

  /** 公開した時：AIの下書きと公開したシフトを比べて学ぶ。学んだら下書きは消す */
  async learnFromPublish(periodId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const draft = must(await c.from("ai_drafts").select("*").eq("period_id", periodId).maybeSingle());   // AIの下書き
    if (!draft) return 0;
    const final = must(await c.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);   // 公開したもの
    const rows = diffDraft(draft.rows, final).map((r) => learnMap.to({ ...r, id: newId(), storeId: draft.store_id }));   // 新しい学び（データベースの形）
    if (rows.length) must(await c.from("learnings").insert(rows));
    // 古いものから消す（LEARN_KEEP 個まで）
    const all = must(await c.from("learnings").select("id").eq("store_id", draft.store_id).order("at", { ascending: false }));
    const drop = all.slice(LEARN_KEEP).map((l) => l.id);   // 多すぎる古い学びのID
    if (drop.length) must(await c.from("learnings").delete().in("id", drop));
    must(await c.from("ai_drafts").delete().eq("period_id", periodId));
    return rows.length;
  },

  /** 今の店舗の学び */
  async listLearnings() {
    await requireManager();
    const c = await sb();   // Supabase の道具
    return must(await c.from("learnings").select("*").eq("store_id", await currentStore()).order("at")).map(learnMap.from);
  },

  /** 学びを消す */
  async deleteLearnings(ids) {
    await requireManager();
    if (!ids.length) return true;
    const c = await sb();   // Supabase の道具
    must(await c.from("learnings").delete().in("id", ids));
    return true;
  },
};
