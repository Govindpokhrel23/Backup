// ============================================================
// api/supabase/calls.js — 人が足りない時の自動連絡（本物）
// ------------------------------------------------------------
// このファイルは、人が足りない時間を「入れそうな人」に知らせて、
// 「入れます」の返事を集め、店長が決めたら勤務に入れるファイルです（2026年11月6日）。
// mock-calls.js と同じ動き・同じ形で返す。
// 「入れます」はデータベースの関数 answer_call（schema.sql）で行う（店員は募集の行を直せないため）。
// ============================================================

import {
  sb, must, newId, requireMe, requireManager, currentStore,
  callMap, workMap, hopeMap, companyMembers, companyStores, notify,
} from "./core.js";
import { findCandidates, mergeNeeds } from "../../rules/candidates.js";
import { defaultBreak } from "../../lib/breaks.js";
import { label } from "../../lib/date.js";
import { range } from "../../lib/time.js";
import { CONFIG } from "../../config.js";

/** 場所の名前 */
const AREA_LABEL = { hall: "ホール", kitchen: "キッチン" };

/** 募集の中身を文にする（例：11/9（月）ホール 16:00〜19:00） */
const callText = (x) => `${label(x.date)} ${AREA_LABEL[x.area]} ${range(x.from, x.to)}`;

/** 画面の関数（supabase-api.js で合体する） */
export const callsApi = {
  /**
   * 足りない時間を、入れそうな人に連絡する（店長）
   * @returns {{sent:number, people:number, none:number}}
   */
  async sendCalls(periodId, needs, opt = {}) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const store = await currentStore();                                 // 今の店舗
    const [members, stores] = await Promise.all([companyMembers(), companyStores()]);   // 会社の店員と店舗
    const storeName = stores.find((s) => s.id === store)?.name || "";  // 店舗名（お知らせに出す）
    const list = mergeNeeds(needs)   // 送る不足（まとめて、自動なら短いものは外す）
      .filter((n) => !opt.auto || n.to - n.from >= CONFIG.CALL_MIN_MIN)
      .slice(0, opt.auto ? CONFIG.CALL_AUTO_MAX : undefined);           // 送る不足
    if (!list.length) return { sent: 0, people: 0, none: 0 };
    const dates = [...new Set(list.map((n) => n.date))];                // 関係する日
    const [work, hopes, open] = await Promise.all([   // その日の勤務・希望・出している募集
      c.from("assignments").select("*").in("date", dates).then(must),   // その日の勤務（全部の店舗）
      c.from("availabilities").select("*").in("date", dates).then(must),   // その日の希望
      c.from("calls").select("*").eq("store_id", store).eq("status", "open").then(must),   // もう出している募集
    ]);
    const dayWork = work.map(workMap.from);   // その日の勤務（アプリの形）
    const dayHopes = hopes.map(hopeMap.from);   // その日の希望（アプリの形）
    const openCalls = open.map(callMap.from);   // 出している募集（アプリの形）
    let sent = 0;                                                       // 送った募集の数
    let none = 0;                                                       // 入れそうな人がいなかった数
    const perPerson = new Map();                                        // 人 → その人に届く募集
    const rows = [];                                                    // 新しい募集
    for (const need of list) {
      if (openCalls.some((x) => x.date === need.date && x.area === need.area && x.from === need.from && x.to === need.to)) continue;
      const candidates = findCandidates({   // 入れそうな人（上から何人まで）
        need, storeId: store, members,
        dayAssignments: dayWork.filter((a) => a.date === need.date),
        availabilities: dayHopes.filter((a) => a.date === need.date),
      }).slice(0, CONFIG.CALL_MAX_PEOPLE);
      if (!candidates.length) { none++; continue; }
      const call = { id: newId(), storeId: store, periodId, date: need.date, area: need.area, from: need.from, to: need.to,   // 新しい募集
        short: need.short || 1, status: "open", auto: !!opt.auto, candidateIds: candidates.map((x) => x.member.id), answers: [] };
      rows.push(callMap.to(call));
      candidates.forEach((x) => perPerson.set(x.member.id, [...(perPerson.get(x.member.id) || []), call]));
      sent++;
    }
    if (rows.length) must(await c.from("calls").insert(rows));
    // お知らせは1人に1つ
    for (const [memberId, calls] of perPerson) {
      const head = calls.slice(0, 2).map(callText).join("、");   // 最初の2つの募集の文
      const more = calls.length > 2 ? ` ほか${calls.length - 2}件` : "";   // 3つ目からは「ほか〇件」
      await notify([memberId], `【人が足りません】${storeName} ${head}${more}。入れる時はホームの「入れます」を押してください`);
    }
    return { sent, people: perPerson.size, none };
  },

  /** 募集の一覧（店長＝今の店舗のさがし中、店員＝自分に届いたさがし中） */
  async listCalls() {
    const user = await requireMe();   // ログイン中の人
    const c = await sb();   // Supabase の道具
    const [rows, members, stores] = await Promise.all([   // さがし中の募集・店員・店舗
      c.from("calls").select("*").eq("status", "open").order("date").then(must), companyMembers(), companyStores(),
    ]);
    const calls = rows.map(callMap.from);   // 募集（アプリの形）
    /** IDから名前 */
    const nameOf = (id) => members.find((m) => m.id === id)?.name || "？";
    if (user.role === "manager") {
      const store = await currentStore();   // 今見ている店舗
      return calls.filter((x) => x.storeId === store).map((x) => ({
        ...x, answers: x.answers.map((a) => ({ ...a, name: nameOf(a.memberId) })), candidateCount: x.candidateIds.length,
      }));
    }
    return calls.filter((x) => x.candidateIds.includes(user.id)).map((x) => ({
      id: x.id, date: x.date, area: x.area, from: x.from, to: x.to,
      storeShort: stores.find((s) => s.id === x.storeId)?.short || "",
      answered: x.answers.some((a) => a.memberId === user.id),
    }));
  },

  /** 「入れます」／取り消し（店員）→ データベースの関数 answer_call */
  async answerCall(callId, yes) {
    await requireMe();
    const c = await sb();   // Supabase の道具
    return must(await c.rpc("answer_call", { p_call_id: callId, p_yes: !!yes }));
  },

  /** この人に入ってもらう（店長）。つながる勤務があればのばす */
  async fillCall(callId, memberId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    const x = callMap.from(must(await c.from("calls").select("*").eq("id", callId).maybeSingle()));   // その募集
    if (!x || x.status !== "open") throw new Error("この募集はもう終わりました");
    const p = must(await c.from("periods").select("status").eq("id", x.periodId).single());          // その週
    const mine = must(await c.from("assignments").select("*").eq("member_id", memberId).eq("date", x.date).eq("store_id", x.storeId)).map(workMap.from);   // その人のその日の勤務
    const next = mine.find((a) => a.area === x.area && (a.to === x.from || a.from === x.to));         // つながる勤務
    if (next) {
      const from = Math.min(next.from, x.from), to = Math.max(next.to, x.to);                       // のばした時間
      const breakAt = to - from >= CONFIG.BREAK_NEEDED_MIN && next.breakAt == null ? defaultBreak(from, to) : next.breakAt;   // のばしたあとの休憩
      must(await c.from("assignments").update({ from_min: from, to_min: to, break_at: breakAt }).eq("id", next.id));
    } else {
      const long = x.to - x.from >= CONFIG.BREAK_NEEDED_MIN;   // 休憩が必要な長さか
      must(await c.from("assignments").insert(workMap.to({
        id: newId(), periodId: x.periodId, storeId: x.storeId, memberId, date: x.date, from: x.from, to: x.to, area: x.area,
        breakAt: long ? defaultBreak(x.from, x.to) : null, fixed: false, createdBy: "call", requested: true, helper: false, reason: "",
      })));
    }
    must(await c.from("calls").update({ status: "filled", filled_by: memberId }).eq("id", callId));
    await notify([memberId], `${callText(x)} に入ることになりました。ありがとうございます${p.status === "published" ? "" : "（シフトの公開で確定します）"}`);
    await notify(x.answers.map((a) => a.memberId).filter((id) => id !== memberId), `${callText(x)} はほかの人に決まりました。返事ありがとうございました`);
    return true;
  },

  /** 募集をやめる（店長） */
  async closeCall(callId) {
    await requireManager();
    const c = await sb();   // Supabase の道具
    must(await c.from("calls").update({ status: "closed" }).eq("id", callId));
    return true;
  },
};
