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

import { load, save, reply, fail, storeOf, requireManager, canWorkAt } from "./mock-store.js";   // 見本データの道具を読む
import { diffDraft } from "../ai/learning.js";   // ちがいを出す道具を読む

/** 学びを何個まで残すか（古いものから消す。1店舗あたり） */
const LEARN_KEEP = 300;   // 覚えたことは300件まで

/** 画面の関数（mock-api.js の mockApi に合体する） */
export const aiApi = {   // AIの窓口（テスト版）
  // ---------- ① AIの下書き ----------

  /** AIが作った下書きを覚えておく（店長。「AIで作成」のたび） */
  async saveAiDraft(periodId, rows) {   // AIの下書きを保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.aiDrafts = data.aiDrafts || {};   // 入れ物がなければ作る
    data.aiDrafts[periodId] = rows.map((row) => ({ memberId: row.memberId, date: row.date, from: row.from, to: row.to, area: row.area, fixed: !!row.fixed }));   // 必要なものだけ保存
    save(data);   // 保存
    return reply(true);   // できた
  },

  /**
   * 公開した時：AIの下書きと公開したシフトを比べて、学びを保存する（店長）
   * 学んだら下書きは消す（同じ直しを2回数えないため）
   * @returns {number} 新しく覚えた数
   */
  async learnFromPublish(periodId) {   // 公開したシフトから覚える関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const draft = data.aiDrafts?.[periodId];                         // AIの下書き
    if (!draft) return reply(0);   // 下書きがなければ0
    const store = data.periods.find((period) => period.id === periodId)?.storeId;   // その週の店舗
    const final = data.assignments.filter((shift) => shift.periodId === periodId);   // 公開したもの
    const rows = diffDraft(draft, final).map((learning, index) => ({ ...learning, id: `l${Date.now()}-${index}`, storeId: store, at: new Date().toISOString() }));   // 新しい学び（IDと店舗と時刻をつける）
    data.learnings = [...(data.learnings || []), ...rows];   // 覚えたことに足す
    // 古いものから消す（店舗ごとに LEARN_KEEP 個まで）
    const mine = data.learnings.filter((learning) => learning.storeId === store);   // この店舗の分
    if (mine.length > LEARN_KEEP) {   // 300件をこえたら
      const drop = new Set(mine.slice(0, mine.length - LEARN_KEEP).map((learning) => learning.id));   // 消す古い学びのID
      data.learnings = data.learnings.filter((learning) => !drop.has(learning.id));   // 古いものを消す
    }
    delete data.aiDrafts[periodId];   // 使い終わった下書きを消す
    save(data);   // 保存
    return reply(rows.length);   // 覚えた数を返す
  },

  // ---------- ② 学び ----------

  /** 今の店舗の学びの一覧（店長） */
  async listLearnings() {   // 覚えたことの一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    return reply((data.learnings || []).filter((learning) => learning.storeId === storeOf(data)));   // 今の店舗の分を返す
  },

  /** 学びを消す（店長。「これは覚えなくていい」） */
  async deleteLearnings(ids) {   // 覚えたことを消す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const drop = new Set(ids);                                       // 消す学びのID
    data.learnings = (data.learnings || []).filter((learning) => !drop.has(learning.id));   // 選んだものを消す
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- ③ シフト作成で人を足す ----------

  /**
   * 会社の店員みんな（店長。ほかの店舗の人を足す時に選ぶ）
   * mainShort＝その人のメインの店舗の短い名前、canHere＝今の店舗に行ける登録があるか
   */
  async listCompanyMembers() {   // 会社の店員を全部出す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = storeOf(data);   // 今見ている店舗
    const company = data.stores.find((eachStore) => eachStore.id === store)?.companyId;   // その店舗の会社
    const inCompany = new Set(data.stores.filter((store) => store.companyId === company).map((store) => store.id));   // 同じ会社の店舗
    return reply(data.members   // 返す
      .filter((member) => member.active && inCompany.has(member.storeId))   // 同じ会社で休止していない人
      .map((member) => ({   // 1人ずつ
        ...member,   // もとの情報
        mainShort: data.stores.find((store) => store.id === member.storeId)?.short || "",   // 所属店の短い名前
        canHere: canWorkAt(member, store),   // この店舗で働けるか
      })));
  },

  /** その週だけ、ほかの店舗の人を応援として足す（店長） */
  async addGuest(periodId, memberId) {   // この週だけほかの店舗の人を足す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const period = data.periods.find((period) => period.id === periodId);   // その週
    if (!period) return fail("週が見つかりません");   // 週がなければエラー
    period.guests = [...new Set([...(period.guests || []), memberId])];   // 足す（同じ人は1回だけ）
    save(data);   // 保存
    return reply(period.guests);   // 足した人の一覧を返す
  },

  /** 応援の人を外す（店長。その週に勤務が入っていなければ） */
  async removeGuest(periodId, memberId) {   // 足した人を外す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const period = data.periods.find((period) => period.id === periodId);   // その週
    if (data.assignments.some((shift) => shift.periodId === periodId && shift.memberId === memberId)) return fail("勤務が入っているので外せません。先に勤務を消してください");   // 勤務が入っていたら外せない
    period.guests = (period.guests || []).filter((id) => id !== memberId);   // 外す
    save(data);   // 保存
    return reply(period.guests);   // 足した人の一覧を返す
  },
};
