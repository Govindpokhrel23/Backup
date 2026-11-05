// ============================================================
// api/mock-calls.js — 人が足りない時の「自動連絡」（にせものサーバー）
// ------------------------------------------------------------
// このファイルは、人が足りない時間を「入れそうな人」に知らせて、
// 「入れます」の返事を集め、店長が決めたら勤務に入れるファイルです（2026年11月5日）。
//
// 流れ：
//   ① 店長がシフトを公開した時、足りない時間があれば自動で連絡する（手で押すこともできる）
//   ② 入れそうな人（rules/candidates.js）にお知らせが届く
//   ③ 店員がホームで「入れます」を押す
//   ④ 店長がホームで「この人に入ってもらう」を押す → 勤務に入り、本人に知らせる
// 本物では、②でプッシュ通知も送る（ロードマップ：通知）。
// ============================================================

import { load, save, reply, fail, me, storeOf, requireManager } from "./mock-store.js";
import { findCandidates, mergeNeeds } from "../rules/candidates.js";
import { label } from "../lib/date.js";
import { range } from "../lib/time.js";
import { defaultBreak } from "../lib/breaks.js";
import { CONFIG } from "../config.js";

/** 場所の名前（画面とお知らせに出す文字） */
const AREA_LABEL = { hall: "ホール", kitchen: "キッチン" };

/** 連絡の中身を文にする（例：11/9（月）ホール 16:00〜19:00） */
function callText(c) {
  return `${label(c.date)} ${AREA_LABEL[c.area]} ${range(c.from, c.to)}`;
}

/** お知らせを1つ足す */
function notify(data, memberId, text, extra = {}) {
  data.notifications = data.notifications || [];
  data.notifications.push({ memberId, at: new Date().toISOString(), text, ...extra });
}

/** 画面の関数（mock-api.js の mockApi に合体する） */
export const callsApi = {
  /**
   * 足りない時間を、入れそうな人に連絡する（店長）
   * 同じ日・場所・時間で、まだ受付中の連絡があれば、もう一度は送らない
   * @param {string} periodId  その週
   * @param {{date,area,from,to,short}[]} needs  足りない時間（findShortages の結果）
   * @param {{auto?:boolean}} [opt]  auto＝公開した時に自動で送った
   * @returns {{sent:number, people:number, none:number}} 送った連絡の数・知らせた人の数・入れそうな人がいなかった数
   */
  async sendCalls(periodId, needs, opt = {}) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = storeOf(data);                                       // 今見ている店舗
    const storeName = data.stores.find((s) => s.id === store)?.name || "";   // 店舗の名前（お知らせに出す）
    data.calls = data.calls || [];
    let sent = 0;                                                      // 新しく送った連絡の数
    let none = 0;                                                      // 入れそうな人がいなかった数
    const perPerson = new Map();                                       // 人 → その人に届く募集（お知らせは1人1回にまとめる）
    // 自動の時は多くなりすぎないように、まとめてから上限まで（CONFIG.CALL_AUTO_MAX）
    // 自動の時は、短すぎる不足（CONFIG.CALL_MIN_MIN より短い）は送らない（店長が直す方が早い）
    const list = mergeNeeds(needs)
      .filter((n) => !opt.auto || n.to - n.from >= CONFIG.CALL_MIN_MIN)
      .slice(0, opt.auto ? CONFIG.CALL_AUTO_MAX : undefined);
    for (const need of list) {
      // もう同じ連絡を出している → 飛ばす
      const dup = data.calls.some((c) => c.storeId === store && c.status === "open"
        && c.date === need.date && c.area === need.area && c.from === need.from && c.to === need.to);
      if (dup) continue;
      const candidates = findCandidates({   // 入れそうな人（上から何人まで）
        need, storeId: store,
        members: data.members,
        dayAssignments: data.assignments.filter((a) => a.date === need.date),
        availabilities: data.availabilities.filter((a) => a.date === need.date),
      }).slice(0, CONFIG.CALL_MAX_PEOPLE);                             // 多すぎないように上から何人まで
      if (!candidates.length) { none++; continue; }
      const call = {   // 新しい募集
        id: `c${Date.now()}-${sent}`,
        storeId: store, periodId,
        date: need.date, area: need.area, from: need.from, to: need.to, short: need.short || 1,
        status: "open",                                                // open＝さがし中 / filled＝決まった / closed＝やめた
        auto: !!opt.auto,
        candidateIds: candidates.map((c) => c.member.id),
        answers: [],                                                   // 「入れます」を押した人 {memberId, at}
        createdAt: new Date().toISOString(),
      };
      data.calls.push(call);
      candidates.forEach((c) => perPerson.set(c.member.id, [...(perPerson.get(c.member.id) || []), call]));
      sent++;
    }
    // お知らせ：1人に1つだけ（募集がいくつあっても）
    for (const [memberId, calls] of perPerson) {
      const head = calls.slice(0, 2).map(callText).join("、");         // 最初の2つ
      const more = calls.length > 2 ? ` ほか${calls.length - 2}件` : "";   // 3つ目からは「ほか〇件」
      notify(data, memberId, `【人が足りません】${storeName} ${head}${more}。入れる時はホームの「入れます」を押してください`);
    }
    save(data);
    return reply({ sent, people: perPerson.size, none });
  },

  /**
   * 連絡の一覧
   * ・店長 → 今の店舗の、さがし中の連絡（返事した人の名前つき）
   * ・店員 → 自分に届いた、さがし中の連絡（自分が「入れます」を押したか つき）
   */
  async listCalls() {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    if (!user) return fail("ログインしてください");
    const calls = (data.calls || []).filter((c) => c.status === "open");   // さがし中の募集
    /** IDから名前 */
    const nameOf = (id) => data.members.find((m) => m.id === id)?.name || "？";
    /** 店舗のIDから短い名前 */
    const storeShort = (id) => data.stores.find((s) => s.id === id)?.short || "";
    if (user.role === "manager") {
      return reply(calls.filter((c) => c.storeId === storeOf(data)).map((c) => ({
        ...c,
        answers: c.answers.map((a) => ({ ...a, name: nameOf(a.memberId) })),
        candidateCount: c.candidateIds.length,
      })));
    }
    return reply(calls.filter((c) => c.candidateIds.includes(user.id)).map((c) => ({
      id: c.id, date: c.date, area: c.area, from: c.from, to: c.to, storeShort: storeShort(c.storeId),
      answered: c.answers.some((a) => a.memberId === user.id),
    })));
  },

  /** 「入れます」を押す／取り消す（店員） */
  async answerCall(callId, yes) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const call = (data.calls || []).find((c) => c.id === callId);   // その募集
    if (!call || call.status !== "open") return fail("この募集はもう終わりました");
    if (!call.candidateIds.includes(user.id)) return fail("この募集には返事できません");
    call.answers = call.answers.filter((a) => a.memberId !== user.id);
    if (yes) call.answers.push({ memberId: user.id, at: new Date().toISOString() });
    save(data);
    return reply(true);
  },

  /**
   * この人に入ってもらう（店長）
   * 勤務に足して、本人に知らせる。ほかに返事した人には「決まりました」と知らせる
   */
  async fillCall(callId, memberId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const call = (data.calls || []).find((c) => c.id === callId);   // その募集
    if (!call || call.status !== "open") return fail("この募集はもう終わりました");
    const period = data.periods.find((p) => p.id === call.periodId);   // その週
    // その人がその日、募集の時間とつながる勤務をもう持っていれば、のばす（勤務を2つに分けない）
    const next = data.assignments.find((a) => a.memberId === memberId && a.date === call.date && a.storeId === call.storeId
      && a.area === call.area && (a.to === call.from || a.from === call.to));
    if (next) {
      next.from = Math.min(next.from, call.from);
      next.to = Math.max(next.to, call.to);
      if (next.to - next.from >= CONFIG.BREAK_NEEDED_MIN && next.breakAt == null) next.breakAt = defaultBreak(next.from, next.to);
    } else {
      const long = call.to - call.from >= CONFIG.BREAK_NEEDED_MIN;        // 休憩が必要な長さか
      data.assignments.push({
        id: `a${Date.now()}`, periodId: call.periodId, storeId: call.storeId,
        memberId, date: call.date, from: call.from, to: call.to, area: call.area,
        breakAt: long ? defaultBreak(call.from, call.to) : null,
        fixed: false, createdBy: "call", requested: true,
      });
    }
    call.status = "filled";
    call.filledBy = memberId;
    notify(data, memberId, `${callText(call)} に入ることになりました。ありがとうございます${period?.status === "published" ? "" : "（シフトの公開で確定します）"}`);
    call.answers.filter((a) => a.memberId !== memberId)
      .forEach((a) => notify(data, a.memberId, `${callText(call)} はほかの人に決まりました。返事ありがとうございました`));
    save(data);
    return reply(true);
  },

  /** 募集をやめる（店長。人が見つかった・いらなくなった） */
  async closeCall(callId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const call = (data.calls || []).find((c) => c.id === callId);   // その募集
    if (call) call.status = "closed";
    save(data);
    return reply(true);
  },
};
