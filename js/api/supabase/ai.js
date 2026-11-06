// ============================================================
// api/supabase/ai.js — AIの下書き・店長の直し方の学び（本物）
// ------------------------------------------------------------
// このファイルは、AIが作った下書きを覚えておき、公開した時に店長の直し方と比べて
// 「学び」として保存するファイルです（2026年11月6日）。店長だけが使える。
// mock-ai.js の同じ名前の関数と、同じ動き・同じ形で返す。
// ============================================================

import { supabaseClient, must, newId, requireManager, currentStore, learnMap, workMap } from "./core.js";   // Supabase の道具を読む
import { diffDraft } from "../../ai/learning.js";   // 下書きと公開のちがいを出す道具を読む

/** 学びを何個まで残すか（1店舗あたり。古いものから消す） */
const LEARN_KEEP = 300;   // 覚えたことは店舗ごとに300件まで

/** 画面の関数（supabase-api.js で合体する） */
export const aiApi = {   // AIの窓口
  /** AIが作った下書きを覚えておく */
  async saveAiDraft(periodId, rows) {   // AIの下書きを保存する関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const period = must(await client.from("periods").select("store_id").eq("id", periodId).single());   // その週
    const slim = rows.map((row) => ({ memberId: row.memberId, date: row.date, from: row.from, to: row.to, area: row.area, fixed: !!row.fixed }));   // AIの下書き（比べるのに要る所だけ）
    must(await client.from("ai_drafts").upsert({ period_id: periodId, store_id: period.store_id, rows: slim }, { onConflict: "period_id" }));   // 週ごとに1つ保存（あれば上書き）
    return true;   // できた
  },

  /** 公開した時：AIの下書きと公開したシフトを比べて学ぶ。学んだら下書きは消す */
  async learnFromPublish(periodId) {   // 公開したシフトから覚える関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const draft = must(await client.from("ai_drafts").select("*").eq("period_id", periodId).maybeSingle());   // AIの下書き
    if (!draft) return 0;   // 下書きがなければ覚えることなし
    const final = must(await client.from("assignments").select("*").eq("period_id", periodId)).map(workMap.from);   // 公開したもの
    const rows = diffDraft(draft.rows, final).map((learning) => learnMap.to({ ...learning, id: newId(), storeId: draft.store_id }));   // 新しい学び（データベースの形）
    if (rows.length) must(await client.from("learnings").insert(rows));   // ちがいがあれば保存
    // 古いものから消す（LEARN_KEEP 個まで）
    const all = must(await client.from("learnings").select("id").eq("store_id", draft.store_id).order("at", { ascending: false }));   // その店舗の覚えたことを新しい順に読む
    const drop = all.slice(LEARN_KEEP).map((learning) => learning.id);   // 多すぎる古い学びのID
    if (drop.length) must(await client.from("learnings").delete().in("id", drop));   // 300件をこえた古いものを消す
    must(await client.from("ai_drafts").delete().eq("period_id", periodId));   // 使い終わった下書きを消す
    return rows.length;   // 覚えた数を返す
  },

  /** 今の店舗の学び */
  async listLearnings() {   // 覚えたことの一覧を出す関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.from("learnings").select("*").eq("store_id", await currentStore()).order("at")).map(learnMap.from);   // 今の店舗の分を古い順に
  },

  /** 学びを消す */
  async deleteLearnings(ids) {   // 覚えたことを消す関数
    await requireManager();   // 店長でなければ止める
    if (!ids.length) return true;   // 消すものがなければ終わり
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("learnings").delete().in("id", ids));   // 選んだものを消す
    return true;   // できた
  },
};
