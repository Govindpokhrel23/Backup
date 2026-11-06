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

import { load, save, reply, fail, me, storeOf, requireManager } from "./mock-store.js";   // 見本データの道具を読む
import { findCandidates, mergeNeeds } from "../rules/candidates.js";   // 入れそうな人を探す道具を読む
import { label } from "../lib/date.js";   // 日付の表示の道具を読む
import { range } from "../lib/time.js";   // 時間の表示の道具を読む
import { defaultBreak } from "../lib/breaks.js";   // 休憩の道具を読む
import { CONFIG } from "../config.js";   // 設定を読む

/** 場所の名前（画面とお知らせに出す文字） */
const AREA_LABEL = { hall: "ホール", kitchen: "キッチン" };   // 場所の名前

/** 連絡の中身を文にする（例：11/9（月）ホール 16:00〜19:00） */
function callText(call) {   // 募集を1行の文にする関数
  return `${label(call.date)} ${AREA_LABEL[call.area]} ${range(call.from, call.to)}`;   // 「11/9（月） ホール 9:00〜12:00」
}

/** お知らせを1つ足す */
function notify(data, memberId, text, extra = {}) {   // お知らせを足す関数
  data.notifications = data.notifications || [];   // 入れ物がなければ作る
  data.notifications.push({ memberId, at: new Date().toISOString(), text, ...extra });   // 人・時間・文を足す
}

/** 画面の関数（mock-api.js の mockApi に合体する） */
export const callsApi = {   // 人が足りない時の連絡の窓口（テスト版）
  /**
   * 足りない時間を、入れそうな人に連絡する（店長）
   * 同じ日・場所・時間で、まだ受付中の連絡があれば、もう一度は送らない
   * @param {string} periodId  その週
   * @param {{date,area,from,to,short}[]} needs  足りない時間（findShortages の結果）
   * @param {{auto?:boolean}} [opt]  auto＝公開した時に自動で送った
   * @returns {{sent:number, people:number, none:number}} 送った連絡の数・知らせた人の数・入れそうな人がいなかった数
   */
  async sendCalls(periodId, needs, opt = {}) {   // 入れそうな人に連絡する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = storeOf(data);                                       // 今見ている店舗
    const storeName = data.stores.find((eachStore) => eachStore.id === store)?.name || "";   // 店舗の名前（お知らせに出す）
    data.calls = data.calls || [];   // 入れ物がなければ作る
    let sent = 0;                                                      // 新しく送った連絡の数
    let none = 0;                                                      // 入れそうな人がいなかった数
    const perPerson = new Map();                                       // 人 → その人に届く募集（お知らせは1人1回にまとめる）
    // 自動の時は多くなりすぎないように、まとめてから上限まで（CONFIG.CALL_AUTO_MAX）
    // 自動の時は、短すぎる不足（CONFIG.CALL_MIN_MIN より短い）は送らない（店長が直す方が早い）
    const list = mergeNeeds(needs)   // 近くの不足をまとめて
      .filter((need) => !opt.auto || need.to - need.from >= CONFIG.CALL_MIN_MIN)   // 自動の時は短い不足は連絡しない
      .slice(0, opt.auto ? CONFIG.CALL_AUTO_MAX : undefined);   // 自動の時は10件まで
    for (const need of list) {   // 足りない時間ごとに
      // もう同じ連絡を出している → 飛ばす
      const dup = data.calls.some((call) => call.storeId === store && call.status === "open"   // 同じ募集がもうあるか
        && call.date === need.date && call.area === need.area && call.from === need.from && call.to === need.to);   // 日・場所・時間が同じ
      if (dup) continue;   // あれば飛ばす
      const candidates = findCandidates({   // 入れそうな人（上から何人まで）
        need, storeId: store,   // 足りない時間・店舗
        members: data.members,   // 店員
        dayAssignments: data.assignments.filter((shift) => shift.date === need.date),   // その日の勤務
        availabilities: data.availabilities.filter((hope) => hope.date === need.date),   // その日の希望
      }).slice(0, CONFIG.CALL_MAX_PEOPLE);                             // 多すぎないように上から何人まで
      if (!candidates.length) { none++; continue; }   // 候補がいなければ数えて次へ
      const call = {   // 新しい募集
        id: `c${Date.now()}-${sent}`,   // ID
        storeId: store, periodId,   // 店舗・週
        date: need.date, area: need.area, from: need.from, to: need.to, short: need.short || 1,   // 日・場所・時間・人数
        status: "open",                                                // open＝さがし中 / filled＝決まった / closed＝やめた
        auto: !!opt.auto,   // 自動か
        candidateIds: candidates.map((candidate) => candidate.member.id),   // 候補の人
        answers: [],                                                   // 「入れます」を押した人 {memberId, at}
        createdAt: new Date().toISOString(),   // 作った時間
      };
      data.calls.push(call);   // 募集を足す
      candidates.forEach((candidate) => perPerson.set(candidate.member.id, [...(perPerson.get(candidate.member.id) || []), call]));   // 人ごとの募集に足す
      sent++;   // 送った数を足す
    }
    // お知らせ：1人に1つだけ（募集がいくつあっても）
    for (const [memberId, calls] of perPerson) {   // 人ごとに
      const head = calls.slice(0, 2).map(callText).join("、");         // 最初の2つ
      const more = calls.length > 2 ? ` ほか${calls.length - 2}件` : "";   // 3つ目からは「ほか〇件」
      notify(data, memberId, `【人が足りません】${storeName} ${head}${more}。入れる時はホームの「入れます」を押してください`);   // 1回のお知らせにまとめる
    }
    save(data);   // 保存
    return reply({ sent, people: perPerson.size, none });   // 送った数・人数・候補なしの数を返す
  },

  /**
   * 連絡の一覧
   * ・店長 → 今の店舗の、さがし中の連絡（返事した人の名前つき）
   * ・店員 → 自分に届いた、さがし中の連絡（自分が「入れます」を押したか つき）
   */
  async listCalls() {   // 募集中の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    if (!user) return fail("ログインしてください");   // ログインしていなければ止める
    const calls = (data.calls || []).filter((call) => call.status === "open");   // さがし中の募集
    /** IDから名前 */
    const nameOf = (id) => data.members.find((member) => member.id === id)?.name || "？";   // 店員IDから名前
    /** 店舗のIDから短い名前 */
    const storeShort = (id) => data.stores.find((store) => store.id === id)?.short || "";   // 店舗IDから短い名前
    if (user.role === "manager") {   // 店長なら
      return reply(calls.filter((call) => call.storeId === storeOf(data)).map((call) => ({   // 今の店舗の分
        ...call,   // もとの情報
        answers: call.answers.map((answer) => ({ ...answer, name: nameOf(answer.memberId) })),   // 返事に名前を付ける
        candidateCount: call.candidateIds.length,   // 候補の人数
      })));
    }
    return reply(calls.filter((call) => call.candidateIds.includes(user.id)).map((call) => ({   // 店員なら自分に来たもの
      id: call.id, date: call.date, area: call.area, from: call.from, to: call.to, storeShort: storeShort(call.storeId),   // ID・日・場所・時間・店舗
      answered: call.answers.some((answer) => answer.memberId === user.id),   // もう返事したか
    })));
  },

  /** 「入れます」を押す／取り消す（店員） */
  async answerCall(callId, yes) {   // 返事する関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const call = (data.calls || []).find((call) => call.id === callId);   // その募集
    if (!call || call.status !== "open") return fail("この募集はもう終わりました");   // 終わった募集なら止める
    if (!call.candidateIds.includes(user.id)) return fail("この募集には返事できません");   // 候補でなければ止める
    call.answers = call.answers.filter((answer) => answer.memberId !== user.id);   // 前の返事を消して
    if (yes) call.answers.push({ memberId: user.id, at: new Date().toISOString() });   // 「入れます」なら足す
    save(data);   // 保存
    return reply(true);   // できた
  },

  /**
   * この人に入ってもらう（店長）
   * 勤務に足して、本人に知らせる。ほかに返事した人には「決まりました」と知らせる
   */
  async fillCall(callId, memberId) {   // その人に決める関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const call = (data.calls || []).find((call) => call.id === callId);   // その募集
    if (!call || call.status !== "open") return fail("この募集はもう終わりました");   // 終わった募集なら止める
    const period = data.periods.find((period) => period.id === call.periodId);   // その週
    // その人がその日、募集の時間とつながる勤務をもう持っていれば、のばす（勤務を2つに分けない）
    const next = data.assignments.find((shift) => shift.memberId === memberId && shift.date === call.date && shift.storeId === call.storeId   // 前か後ろにつながる勤務があるか
      && shift.area === call.area && (shift.to === call.from || shift.from === call.to));   // 同じ場所で時間がつながる
    if (next) {   // あれば
      next.from = Math.min(next.from, call.from);   // 始まりをのばす
      next.to = Math.max(next.to, call.to);   // 終わりをのばす
      if (next.to - next.from >= CONFIG.BREAK_NEEDED_MIN && next.breakAt == null) next.breakAt = defaultBreak(next.from, next.to);   // 長くなって休憩がいれば足す
    } else {   // なければ
      const long = call.to - call.from >= CONFIG.BREAK_NEEDED_MIN;        // 休憩が必要な長さか
      data.assignments.push({   // 新しい勤務を作る
        id: `a${Date.now()}`, periodId: call.periodId, storeId: call.storeId,   // ID・週・店舗
        memberId, date: call.date, from: call.from, to: call.to, area: call.area,   // 人・日・時間・場所
        breakAt: long ? defaultBreak(call.from, call.to) : null,   // 休憩
        fixed: false, createdBy: "call", requested: true,   // 固定しない・連絡で決まった・希望あり
      });
    }
    call.status = "filled";   // 決まった状態にする
    call.filledBy = memberId;   // 決まった人
    notify(data, memberId, `${callText(call)} に入ることになりました。ありがとうございます${period?.status === "published" ? "" : "（シフトの公開で確定します）"}`);   // 決まった人に知らせる
    call.answers.filter((answer) => answer.memberId !== memberId)   // ほかに返事した人
      .forEach((answer) => notify(data, answer.memberId, `${callText(call)} はほかの人に決まりました。返事ありがとうございました`));   // 知らせる
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 募集をやめる（店長。人が見つかった・いらなくなった） */
  async closeCall(callId) {   // 募集をやめる関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const call = (data.calls || []).find((call) => call.id === callId);   // その募集
    if (call) call.status = "closed";   // やめた状態にする
    save(data);   // 保存
    return reply(true);   // できた
  },
};
