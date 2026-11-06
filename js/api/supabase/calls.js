// ============================================================
// api/supabase/calls.js — 人が足りない時の自動連絡（本物）
// ------------------------------------------------------------
// このファイルは、人が足りない時間を「入れそうな人」に知らせて、
// 「入れます」の返事を集め、店長が決めたら勤務に入れるファイルです（2026年11月6日）。
// mock-calls.js と同じ動き・同じ形で返す。
// 「入れます」はデータベースの関数 answer_call（schema.sql）で行う（店員は募集の行を直せないため）。
// ============================================================

import {   // Supabase の道具を読む
  supabaseClient, must, newId, requireMe, requireManager, currentStore,   // 通信・ID・ログインのチェック・今の店舗
  callMap, workMap, hopeMap, companyMembers, companyStores, notify,   // 形の変換・会社の店員と店舗・お知らせ
} from "./core.js";   // 読む元
import { findCandidates, mergeNeeds } from "../../rules/candidates.js";   // 入れそうな人を探す道具を読む
import { defaultBreak } from "../../lib/breaks.js";   // 休憩の道具を読む
import { label } from "../../lib/date.js";   // 日付の表示の道具を読む
import { range } from "../../lib/time.js";   // 時間の表示の道具を読む
import { CONFIG } from "../../config.js";   // 設定を読む

/** 場所の名前 */
const AREA_LABEL = { hall: "ホール", kitchen: "キッチン" };   // 場所の名前

/** 募集の中身を文にする（例：11/9（月）ホール 16:00〜19:00） */
const callText = (call) => `${label(call.date)} ${AREA_LABEL[call.area]} ${range(call.from, call.to)}`;   // 募集を「11/9（月） ホール 9:00〜12:00」の文にする

/** 画面の関数（supabase-api.js で合体する） */
export const callsApi = {   // 人が足りない時の連絡の窓口
  /**
   * 足りない時間を、入れそうな人に連絡する（店長）
   * @returns {{sent:number, people:number, none:number}}
   */
  async sendCalls(periodId, needs, opt = {}) {   // 入れそうな人に連絡する関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const store = await currentStore();                                 // 今の店舗
    const [members, stores] = await Promise.all([companyMembers(), companyStores()]);   // 会社の店員と店舗
    const storeName = stores.find((eachStore) => eachStore.id === store)?.name || "";  // 店舗名（お知らせに出す）
    const list = mergeNeeds(needs)   // 送る不足（まとめて、自動なら短いものは外す）
      .filter((need) => !opt.auto || need.to - need.from >= CONFIG.CALL_MIN_MIN)   // 自動の時は短い不足は連絡しない
      .slice(0, opt.auto ? CONFIG.CALL_AUTO_MAX : undefined);           // 送る不足
    if (!list.length) return { sent: 0, people: 0, none: 0 };   // 連絡するものがなければ0
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
    for (const need of list) {   // 足りない時間ごとに
      if (openCalls.some((openCall) => openCall.date === need.date && openCall.area === need.area && openCall.from === need.from && openCall.to === need.to)) continue;   // もう同じ募集があれば飛ばす
      const candidates = findCandidates({   // 入れそうな人（上から何人まで）
        need, storeId: store, members,   // 足りない時間・店舗・店員
        dayAssignments: dayWork.filter((shift) => shift.date === need.date),   // その日の勤務
        availabilities: dayHopes.filter((dayHope) => dayHope.date === need.date),   // その日の希望
      }).slice(0, CONFIG.CALL_MAX_PEOPLE);   // 8人まで
      if (!candidates.length) { none++; continue; }   // 入れそうな人がいなければ数えて次へ
      const call = { id: newId(), storeId: store, periodId, date: need.date, area: need.area, from: need.from, to: need.to,   // 新しい募集
        short: need.short || 1, status: "open", auto: !!opt.auto, candidateIds: candidates.map((candidate) => candidate.member.id), answers: [] };   // 足りない人数・募集中・自動か・候補・返事
      rows.push(callMap.to(call));   // 保存する形にする
      candidates.forEach((candidate) => perPerson.set(candidate.member.id, [...(perPerson.get(candidate.member.id) || []), call]));   // 人ごとの募集に足す
      sent++;   // 送った数を足す
    }
    if (rows.length) must(await client.from("calls").insert(rows));   // まとめて保存
    // お知らせは1人に1つ
    for (const [memberId, calls] of perPerson) {   // 人ごとに
      const head = calls.slice(0, 2).map(callText).join("、");   // 最初の2つの募集の文
      const more = calls.length > 2 ? ` ほか${calls.length - 2}件` : "";   // 3つ目からは「ほか〇件」
      await notify([memberId], `【人が足りません】${storeName} ${head}${more}。入れる時はホームの「入れます」を押してください`);   // 1回の通知にまとめて知らせる
    }
    return { sent, people: perPerson.size, none };   // 送った数・人数・候補なしの数を返す
  },

  /** 募集の一覧（店長＝今の店舗のさがし中、店員＝自分に届いたさがし中） */
  async listCalls() {   // 募集中の一覧を出す関数
    const user = await requireMe();   // ログイン中の人
    const client = await supabaseClient();   // Supabase の道具
    const [rows, members, stores] = await Promise.all([   // さがし中の募集・店員・店舗
      client.from("calls").select("*").eq("status", "open").order("date").then(must), companyMembers(), companyStores(),   // 募集中・会社の店員・店舗を同時に読む
    ]);
    const calls = rows.map(callMap.from);   // 募集（アプリの形）
    /** IDから名前 */
    const nameOf = (id) => members.find((member) => member.id === id)?.name || "？";   // 店員IDから名前
    if (user.role === "manager") {   // 店長なら
      const store = await currentStore();   // 今見ている店舗
      return calls.filter((call) => call.storeId === store).map((call) => ({   // 今の店舗の分
        ...call, answers: call.answers.map((answer) => ({ ...answer, name: nameOf(answer.memberId) })), candidateCount: call.candidateIds.length,   // 返事に名前を付ける・候補の人数
      }));
    }
    return calls.filter((call) => call.candidateIds.includes(user.id)).map((call) => ({   // 店員なら自分に来たもの
      id: call.id, date: call.date, area: call.area, from: call.from, to: call.to,   // ID・日・場所・時間
      storeShort: stores.find((store) => store.id === call.storeId)?.short || "",   // 店舗の短い名前
      answered: call.answers.some((answer) => answer.memberId === user.id),   // もう返事したか
    }));
  },

  /** 「入れます」／取り消し（店員）→ データベースの関数 answer_call */
  async answerCall(callId, yes) {   // 「入れます」と返事する関数
    await requireMe();   // ログインしていなければ止める
    const client = await supabaseClient();   // Supabase の道具
    return must(await client.rpc("answer_call", { p_call_id: callId, p_yes: !!yes }));   // 返事を保存する
  },

  /** この人に入ってもらう（店長）。つながる勤務があればのばす */
  async fillCall(callId, memberId) {   // その人に決める関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    const call = callMap.from(must(await client.from("calls").select("*").eq("id", callId).maybeSingle()));   // その募集
    if (!call || call.status !== "open") throw new Error("この募集はもう終わりました");   // もう終わった募集なら止める
    const period = must(await client.from("periods").select("status").eq("id", call.periodId).single());          // その週
    const mine = must(await client.from("assignments").select("*").eq("member_id", memberId).eq("date", call.date).eq("store_id", call.storeId)).map(workMap.from);   // その人のその日の勤務
    const next = mine.find((shift) => shift.area === call.area && (shift.to === call.from || shift.from === call.to));         // つながる勤務
    if (next) {   // 同じ日に勤務があれば
      const from = Math.min(next.from, call.from), to = Math.max(next.to, call.to);                       // のばした時間
      const breakAt = to - from >= CONFIG.BREAK_NEEDED_MIN && next.breakAt == null ? defaultBreak(from, to) : next.breakAt;   // のばしたあとの休憩
      must(await client.from("assignments").update({ from_min: from, to_min: to, break_at: breakAt }).eq("id", next.id));   // 時間をのばす
    } else {   // なければ
      const long = call.to - call.from >= CONFIG.BREAK_NEEDED_MIN;   // 休憩が必要な長さか
      must(await client.from("assignments").insert(workMap.to({   // 新しい勤務を作る
        id: newId(), periodId: call.periodId, storeId: call.storeId, memberId, date: call.date, from: call.from, to: call.to, area: call.area,   // ID・週・店舗・人・日・時間・場所
        breakAt: long ? defaultBreak(call.from, call.to) : null, fixed: false, createdBy: "call", requested: true, helper: false, reason: "",   // 休憩・固定しない・連絡で決まった・希望あり
      })));
    }
    must(await client.from("calls").update({ status: "filled", filled_by: memberId }).eq("id", callId));   // 募集を「決まった」にする
    await notify([memberId], `${callText(call)} に入ることになりました。ありがとうございます${period.status === "published" ? "" : "（シフトの公開で確定します）"}`);   // 決まった人に知らせる
    await notify(call.answers.map((answer) => answer.memberId).filter((id) => id !== memberId), `${callText(call)} はほかの人に決まりました。返事ありがとうございました`);   // ほかに返事した人に知らせる
    return true;   // できた
  },

  /** 募集をやめる（店長） */
  async closeCall(callId) {   // 募集をやめる関数
    await requireManager();   // 店長でなければ止める
    const client = await supabaseClient();   // Supabase の道具
    must(await client.from("calls").update({ status: "closed" }).eq("id", callId));   // やめた状態にする
    return true;   // できた
  },
};
