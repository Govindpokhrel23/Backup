// ============================================================
// api/mock-ai.js — AIの下書き・学び・人の追加（にせものサーバー）
// ------------------------------------------------------------
// このファイルは、次の3つを保存するファイルです（2026年11月5日）。
//   ① AIが作った下書き（公開の時に、店長がどう直したかを比べるため）
//   ② 学び（店長の直し方。ai/learning.js で作る）
//   ③ シフト作成で足した人
//        ・ほかの店舗の人を「この週だけ応援」で足す（guests）
//        ・まだアカウントがない人を登録する（createMember の account:false）
// ============================================================

import { load, save, reply, fail, storeOf, requireManager, canWorkAt } from "./mock-store.js";
import { diffDraft } from "../ai/learning.js";

/** 学びを何個まで残すか（古いものから消す。1店舗あたり） */
const LEARN_KEEP = 300;

/** 画面の関数（mock-api.js の mockApi に合体する） */
export const aiApi = {
  // ---------- ① AIの下書き ----------

  /** AIが作った下書きを覚えておく（店長。「AIで作成」のたび） */
  async saveAiDraft(periodId, rows) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.aiDrafts = data.aiDrafts || {};
    data.aiDrafts[periodId] = rows.map((a) => ({ memberId: a.memberId, date: a.date, from: a.from, to: a.to, area: a.area, fixed: !!a.fixed }));
    save(data);
    return reply(true);
  },

  /**
   * 公開した時：AIの下書きと公開したシフトを比べて、学びを保存する（店長）
   * 学んだら下書きは消す（同じ直しを2回数えないため）
   * @returns {number} 新しく覚えた数
   */
  async learnFromPublish(periodId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const draft = data.aiDrafts?.[periodId];                         // AIの下書き
    if (!draft) return reply(0);
    const store = data.periods.find((p) => p.id === periodId)?.storeId;   // その週の店舗
    const final = data.assignments.filter((a) => a.periodId === periodId);   // 公開したもの
    const rows = diffDraft(draft, final).map((r, i) => ({ ...r, id: `l${Date.now()}-${i}`, storeId: store, at: new Date().toISOString() }));   // 新しい学び（IDと店舗と時刻をつける）
    data.learnings = [...(data.learnings || []), ...rows];
    // 古いものから消す（店舗ごとに LEARN_KEEP 個まで）
    const mine = data.learnings.filter((l) => l.storeId === store);
    if (mine.length > LEARN_KEEP) {
      const drop = new Set(mine.slice(0, mine.length - LEARN_KEEP).map((l) => l.id));   // 消す古い学びのID
      data.learnings = data.learnings.filter((l) => !drop.has(l.id));
    }
    delete data.aiDrafts[periodId];
    save(data);
    return reply(rows.length);
  },

  // ---------- ② 学び ----------

  /** 今の店舗の学びの一覧（店長） */
  async listLearnings() {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    return reply((data.learnings || []).filter((l) => l.storeId === storeOf(data)));
  },

  /** 学びを消す（店長。「これは覚えなくていい」） */
  async deleteLearnings(ids) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const drop = new Set(ids);                                       // 消す学びのID
    data.learnings = (data.learnings || []).filter((l) => !drop.has(l.id));
    save(data);
    return reply(true);
  },

  // ---------- ③ シフト作成で人を足す ----------

  /**
   * 会社の店員みんな（店長。ほかの店舗の人を足す時に選ぶ）
   * mainShort＝その人のメインの店舗の短い名前、canHere＝今の店舗に行ける登録があるか
   */
  async listCompanyMembers() {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = storeOf(data);   // 今見ている店舗
    const company = data.stores.find((s) => s.id === store)?.companyId;   // その店舗の会社
    const inCompany = new Set(data.stores.filter((s) => s.companyId === company).map((s) => s.id));   // 同じ会社の店舗
    return reply(data.members
      .filter((m) => m.active && inCompany.has(m.storeId))
      .map((m) => ({
        ...m,
        mainShort: data.stores.find((s) => s.id === m.storeId)?.short || "",
        canHere: canWorkAt(m, store),
      })));
  },

  /** その週だけ、ほかの店舗の人を応援として足す（店長） */
  async addGuest(periodId, memberId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);   // その週
    if (!p) return fail("週が見つかりません");
    p.guests = [...new Set([...(p.guests || []), memberId])];
    save(data);
    return reply(p.guests);
  },

  /** 応援の人を外す（店長。その週に勤務が入っていなければ） */
  async removeGuest(periodId, memberId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);   // その週
    if (data.assignments.some((a) => a.periodId === periodId && a.memberId === memberId)) return fail("勤務が入っているので外せません。先に勤務を消してください");
    p.guests = (p.guests || []).filter((id) => id !== memberId);
    save(data);
    return reply(p.guests);
  },
};
