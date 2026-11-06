// ============================================================
// api/supabase/calls.js — 人が足りない時の自動連絡（本物）
// ------------------------------------------------------------
// このファイルは、人が足りない時間を「入れそうな人」に知らせて、
// 「入れます」の返事を集め、店長が決めたら勤務に入れるファイルです（2026年11月6日）。
// mock-calls.js と同じ動き・同じ形で返す。
// 「入れます」はデータベースの関数 answer_call（schema.sql）で行う（店員は募集の行を直せないため）。
// ============================================================

import {
  supabaseClient, must, newId, requireMe, requireManager, currentStore,
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
const callText = (shift) => `${label(shift.date)} ${AREA_LABEL[shift.area]} ${range(shift.from, shift.to)}`;

/** 画面の関数（supabase-api.js で合体する） */
export const callsApi = {
  /**
   * 足りない時間を、入れそうな人に連絡する（店長）
   * @returns {{sent:number, people:number, none:number}}
   */
  async sendCalls(periodId, needs, opt = {}) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const store = await currentStore();                                 // 今の店舗
    const [members, stores] = await Promise.all([companyMembers(), companyStores()]);   // 会社の店員と店舗
    const storeName = stores.find((eachStore) => eachStore.id === store)?.name || "";  // 店舗名（お知らせに出す）
    const list = mergeNeeds(needs)   // 送る不足（まとめて、自動なら短いものは外す）
      .filter((need) => !opt.auto || need.to - need.from >= CONFIG.CALL_MIN_MIN)
      .slice(0, opt.auto ? CONFIG.CALL_AUTO_MAX : undefined);           // 送る不足
    if (!list.length) return { sent: 0, people: 0, none: 0 };
    const dates = [...new Set(list.map((need) => need.date))];                // 関係する日
    const [work, hopes, open] = await Promise.all([   // その日の勤務・希望・出している募集
      client.from("assignments").select("*").in("date", dates).then(must),   // その日の勤務（全部の店舗）
      client.from("availabilities").select("*").in("date", dates).then(must),   // その日の希望
      client.from("calls").select("*").eq("store_id", store).eq("status", "open").then(must),   // もう出している募集
    ]);
    const dayWork = work.map(workMap.from);   // その日の勤務（アプリの形）
    const dayHopes = hopes.map(hopeMap.from);   // その日の希望（アプリの形）
    const openCalls = open.map(callMap.from);   // 出している募集（アプリの形）
    let sent = 0;                                                       // 送った募集の数
    let none = 0;                                                       // 入れそうな人がいなかった数
    const perPerson = new Map();                                        // 人 → その人に届く募集
    const rows = [];                                                    // 新しい募集
    for (const need of list) {
      if (openCalls.some((shift) => shift.date === need.date && shift.area === need.area && shift.from === need.from && shift.to === need.to)) continue;
      const candidates = findCandidates({   // 入れそうな人（上から何人まで）
        need, storeId: store, members,
        dayAssignments: dayWork.filter((shift) => shift.date === need.date),
        availabilities: dayHopes.filter((dayHope) => dayHope.date === need.date),
      }).slice(0, CONFIG.CALL_MAX_PEOPLE);
      if (!candidates.length) { none++; continue; }
      const call = { id: newId(), storeId: store, periodId, date: need.date, area: need.area, from: need.from, to: need.to,   // 新しい募集
        short: need.short || 1, status: "open", auto: !!opt.auto, candidateIds: candidates.map((candidate) => candidate.member.id), answers: [] };
      rows.push(callMap.to(call));
      candidates.forEach((candidate) => perPerson.set(candidate.member.id, [...(perPerson.get(candidate.member.id) || []), call]));
      sent++;
    }
    if (rows.length) must(await client.from("calls").insert(rows));
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
    const client = await supabaseClient();   // Supabase の道具
    const [rows, members, stores] = await Promise.all([   // さがし中の募集・店員・店舗
      client.from("calls").select("*").eq("status", "open").order("date").then(must), companyMembers(), companyStores(),
    ]);
    const calls = rows.map(callMap.from);   // 募集（アプリの形）
    /** IDから名前 */
    const nameOf = (id) => members.find((member) => member.id === id)?.name || "？";
    if (user.role === "manager") {
      const store = await currentStore();   // 今見ている店舗
      return calls.filter((call) => call.storeId === store).map((call) => ({
        ...call, answers: call.answers.map((answer) => ({ ...answer, name: nameOf(answer.memberId) })), candidateCount: call.candidateIds.length,
      }));
    }
    return calls.filter((call) => call.candidateIds.includes(user.id)).map((call) => ({
      id: call.id, date: call.date, area: call.area, from: call.from, to: call.to,
      storeShort: stores.find((store) => store.id === call.storeId)?.short || "",
      answered: call.answers.some((answer) => answer.memberId === user.id),
    }));
  },

  /** 「入れます」／取り消し（店員）→ データベースの関数 answer_call */
  async answerCall(callId, yes) {
    await requireMe();
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.rpc("answer_call", { p_call_id: callId, p_yes: !!yes }));
  },

  /** この人に入ってもらう（店長）。つながる勤務があればのばす */
  async fillCall(callId, memberId) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    const call = callMap.from(must(await client.from("calls").select("*").eq("id", callId).maybeSingle()));   // その募集
    if (!call || call.status !== "open") throw new Error("この募集はもう終わりました");
    const period = must(await client.from("periods").select("status").eq("id", call.periodId).single());          // その週
    const mine = must(await client.from("assignments").select("*").eq("member_id", memberId).eq("date", call.date).eq("store_id", call.storeId)).map(workMap.from);   // その人のその日の勤務
    const next = mine.find((shift) => shift.area === call.area && (shift.to === call.from || shift.from === call.to));         // つながる勤務
    if (next) {
      const from = Math.min(next.from, call.from), to = Math.max(next.to, call.to);                       // のばした時間
      const breakAt = to - from >= CONFIG.BREAK_NEEDED_MIN && next.breakAt == null ? defaultBreak(from, to) : next.breakAt;   // のばしたあとの休憩
      must(await client.from("assignments").update({ from_min: from, to_min: to, break_at: breakAt }).eq("id", next.id));
    } else {
      const long = call.to - call.from >= CONFIG.BREAK_NEEDED_MIN;   // 休憩が必要な長さか
      must(await client.from("assignments").insert(workMap.to({
        id: newId(), periodId: call.periodId, storeId: call.storeId, memberId, date: call.date, from: call.from, to: call.to, area: call.area,
        breakAt: long ? defaultBreak(call.from, call.to) : null, fixed: false, createdBy: "call", requested: true, helper: false, reason: "",
      })));
    }
    must(await client.from("calls").update({ status: "filled", filled_by: memberId }).eq("id", callId));
    await notify([memberId], `${callText(call)} に入ることになりました。ありがとうございます${period.status === "published" ? "" : "（シフトの公開で確定します）"}`);
    await notify(call.answers.map((answer) => answer.memberId).filter((id) => id !== memberId), `${callText(call)} はほかの人に決まりました。返事ありがとうございました`);
    return true;
  },

  /** 募集をやめる（店長） */
  async closeCall(callId) {
    await requireManager();
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("calls").update({ status: "closed" }).eq("id", callId));
    return true;
  },
};
