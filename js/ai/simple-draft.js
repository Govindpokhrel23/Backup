// ============================================================
// ai/simple-draft.js — シフトの下書きを作る（AIの代わりの簡易版）
// ------------------------------------------------------------
// 本番では Gemini（AI）が下書きを作る（ロードマップ段階4）。
// それまでの間、同じ「入口と出口の形」で動く簡易版をここに置く。
//   入口：店員・希望・必要人数・固定した勤務・過去の勤務
//   出口：勤務の一覧（下書き）
// → あとで中身を Gemini 呼び出しに入れ替えても、画面は変えなくてよい。
//
// 簡易版の考え方（要件定義書の優先順に合わせている）：
//   1. 店長が固定した勤務は、そのまま残す
//   2. 優先順に並べる：毎日入る人・フルのバイト → できる％が高い人 → 過去によく入っている人
//   3. 足りない時間に重なる希望だけ入れる（希望より短く入れるのもOK）
//   4. 社員は休みの日以外、毎日入れる（希望なし＝休み週1日／休み希望あり＝その日・週2日まで）
//   5. まだ足りなければ、2nd・3rd でこの店舗に行ける人（応援）を、希望の中で入れる
//      ほかの店舗に入っている時間とは重ねない
//   6. 長い勤務には休憩の目安を入れる（真ん中。朝11:00より前には入れない）
//   7. 7日全部入った人は、1日休みにする（週1休み）
//   8. 店長の直し方（ai/learning.js の学び）を使う（2026年11月5日）：
//        ・2回以上同じ時間に直された人と曜日 → 最初からその時間にする（希望の中で）
//        ・2回以上外された人と曜日 → 入れない
//        ・2回以上場所を変えられた人 → 最初からその場所にする
//   9. 働き方のルール：18歳未満は5:00〜22:00に縮める、月・年の上限をこえる勤務は外す（2026年11月6日）
// このファイルは、AIがつながっていない時と、Gemini に渡す「たたき台」を作る時に使う。
// ============================================================

import { CONFIG } from "../config.js";
import { requiredAt, assignedAt } from "../rules/shift-rules.js";
import { STEP, overlaps } from "../lib/time.js";
import { defaultBreak } from "../lib/breaks.js";
import { openerOf, openStart } from "../lib/roles.js";
import { weekdayOf } from "./learning.js";
import { clipForMinor } from "../rules/labor-rules.js";

/**
 * @param {object} p
 * @param {string[]} p.dates
 * @param {object[]} p.members        この店舗で働ける人（rankHere：1＝メイン、2以上＝応援）
 * @param {object[]} [p.elsewhere]    同じ週にほかの店舗に入っている勤務（重ねないため）
 * @param {object[]} p.availabilities
 * @param {object[]} p.requirements
 * @param {object[]} p.positions
 * @param {object[]} p.fixed          店長が固定した勤務（変えない）
 * @param {object[]} p.past           過去の勤務（よく入っている人を知るため）
 * @param {(date:string)=>string} p.dayTypeOf
 * @param {(date:string)=>{open:number,close:number}} p.hoursOf その日の営業時間
 * @param {object} [p.learned]        店長の直し方（ai/learning.js の summarize の結果）
 * @returns {object[]} 下書きの勤務
 */
export function makeDraft(p) {
  const result = p.fixed.map((a) => ({ ...a }));          // 下書き（固定した勤務から始める）

  // ---------- 店長の直し方（学び） ----------
  const learned = p.learned || { prefer: new Map(), avoid: new Map(), areaPref: new Map() };
  /** 店長がその人・その曜日によく入れる時間（なければ null） */
  const preferOf = (m, date) => learned.prefer.get(`${m.id}|${weekdayOf(date)}`) || null;
  /** 店長がその人・その曜日をよく外すか */
  const avoided = (m, date) => learned.avoid.has(`${m.id}|${weekdayOf(date)}`) && !preferOf(m, date);
  /** その人の場所（店長がよく変える先があればそこ） */
  const areaFor = (m, fallback) => learned.areaPref.get(m.id) || fallback;

  // 過去に何回入ったか（多い人を優先）
  const pastCount = new Map();
  for (const a of p.past) pastCount.set(a.memberId, (pastCount.get(a.memberId) || 0) + 1);

  // 優先順に並べる
  const score = (m) =>
    (m.everyday || m.kind === "full" ? 1000 : 0)
    + Math.max(m.skills.hall, m.skills.kitchen)
    + (pastCount.get(m.id) || 0);
  const members = p.members.filter((m) => m.active).sort((a, b) => score(b) - score(a));   // 働いている人を、優先の高い順に
  /** この店舗がメインの人か */
  const isMain = (m) => (m.rankHere ?? 1) === 1;
  const shain = members.filter((m) => m.kind === "shain" && isMain(m));   // メインの社員
  const helpers = members.filter((m) => !isMain(m)).sort((a, b) => a.rankHere - b.rankHere || score(b) - score(a));   // 応援の人（2nd → 3rd の順）
  const elsewhere = p.elsewhere || [];   // ほかの店舗の勤務

  /** その日の下書き */
  const dayOf = (date) => result.filter((a) => a.date === date);
  /** その人のその日の希望 */
  const hopeOf = (m, date) => p.availabilities.find((a) => a.memberId === m.id && a.date === date);
  /** その人がその日もう入っているか */
  const working = (m, date) => result.some((a) => a.memberId === m.id && a.date === date);
  /** その時間、ほかの店舗に入っているか */
  const busyElsewhere = (m, date, from, to) =>
    elsewhere.some((a) => a.memberId === m.id && a.date === date && overlaps(a.from, a.to, from, to));

  // ============================================================
  // ① バイト・フル：希望の中で、足りない時間にだけ入れる（全部の日）
  // ============================================================
  for (const date of p.dates) {
    const dayType = p.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const m of members) {
      if (m.kind === "shain" || !isMain(m) || working(m, date) || avoided(m, date)) continue;
      const hope = hopeOf(m, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;
      const hrs = p.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり（いつでもOKなら開店）
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり（いつでもOKなら閉店）
      const area = areaFor(m, m.skills.kitchen > m.skills.hall ? "kitchen" : "hall");   // 入れる場所（できる方。店長がよく変える先があればそこ）
      // 店長がいつも入れる時間があれば、それを使う（希望の中に収まる時だけ）
      const pref = preferOf(m, date);
      if (pref && pref.from >= from && pref.to <= to && !busyElsewhere(m, date, pref.from, pref.to)) {
        result.push(work(m, date, pref.from, pref.to, pref.area || area));
        continue;
      }
      const span = neededSpan(dayOf(date), p, dayType, area, from, to);   // 希望の中で、足りない所だけ
      if (span && !busyElsewhere(m, date, span.from, span.to)) result.push(work(m, date, span.from, span.to, area));
    }
  }

  // ============================================================
  // ② 社員の休みの日を決める（要件 F-48・F-49）
  //    ・休み希望を出した → その日（週2日まで）
  //    ・希望を出していない → 休みは週1日だけ。いちばん人が足りている日にする
  // ============================================================
  const offDays = new Map();
  for (const m of shain) {
    const asked = p.dates.filter((d) => ["off", "offx", "no"].includes(hopeOf(m, d)?.kind));   // 休み希望を出した日
    if (asked.length) { offDays.set(m.id, new Set(asked)); continue; }
    // 固定した勤務がない日の中から、不足がいちばん少ない日
    const candidates = p.dates.filter((d) => !working(m, d));
    /** その日の足りない15分の数（ホール＋キッチン） */
    const shortTotal = (d) => ["hall", "kitchen"].reduce((s, area) => s + shortSlots(dayOf(d), p, p.dayTypeOf(d), area, p.hoursOf(d).open, p.hoursOf(d).close), 0);
    // ほかの社員と休みが重ならないように、同じ日に休む社員が少ない日を先にする
    const restCount = (d) => [...offDays.values()].filter((set) => set.has(d)).length;
    candidates.sort((a, b) => restCount(a) - restCount(b) || shortTotal(a) - shortTotal(b));
    offDays.set(m.id, new Set(candidates.slice(0, 1)));
  }

  // ============================================================
  // ③ 社員は休みの日以外、毎日入れる
  //    勤務の形は「朝（開店から9時間）」か「夜（閉店までの9時間）」
  //    立ち上げ・締めがいない日は、それができる社員を先に入れる
  // ============================================================
  const bestArea = (m) => (m.skills.hall >= m.skills.kitchen ? "hall" : "kitchen");

  for (const date of p.dates) {
    const dayType = p.dayTypeOf(date);   // 平日／土曜／日曜祝日
    const hrs = p.hoursOf(date);   // その日の営業時間
    const MORNING = [hrs.open, Math.min(hrs.close, hrs.open + 9 * 60)];     // 朝：開店から9時間
    const EVENING = [Math.max(hrs.open, hrs.close - 9 * 60), hrs.close];    // 夜：閉店までの9時間
    const OPENER = [openStart(hrs), openStart(hrs) + 9 * 60];               // 立ち上げ：開店30分前から9時間（7:00開店→6:30〜15:30）
    // 休みの日・もう入っている日・ほかの店舗に入っている日は入れない
    const todo = shain.filter((m) => !offDays.get(m.id)?.has(date) && !working(m, date)
      && !elsewhere.some((a) => a.memberId === m.id && a.date === date));
    /** その日、そのことが100%できる人がもう入っているか */
    const has = (skill, check) => dayOf(date).some((a) => check(a) && p.members.find((m) => m.id === a.memberId)?.skills[skill] === 100);
    /** 社員を1人入れる（入れたら todo から外す） */
    const place = (m, [from, to], area) => {
      const hope = hopeOf(m, date);   // その日の希望
      const pref = preferOf(m, date);   // 店長がいつも入れる時間
      // 時間指定の希望があれば、その時間で入れる。なければ、店長がいつも入れる時間
      if (hope?.kind === "time") { from = hope.from; to = hope.to; }
      else if (pref) { from = pref.from; to = pref.to; area = pref.area || area; }
      area = areaFor(m, area);
      result.push(work(m, date, from, to, area));
      todo.splice(todo.indexOf(m), 1);
    };

    if (!has("open", (a) => a === openerOf(dayOf(date), hrs))) {
      const m = todo.find((x) => x.skills.open === 100);   // 立ち上げ100%の社員
      if (m) place(m, OPENER, bestArea(m));
    }
    if (!has("close", (a) => a.to >= hrs.close)) {
      const m = todo.find((x) => x.skills.close === 100);   // 締め100%の社員
      if (m) place(m, EVENING, closeArea(m));
    }
    // 残りの社員：足りない所がいちばん多い形と場所に入れる
    for (const m of [...todo]) {
      let best = { area: bestArea(m), shape: MORNING, gain: -1 };   // いちばんよい場所と形
      for (const area of ["hall", "kitchen"]) {
        if (m.skills[area] < 50) continue;                // あまりできない場所には入れない
        for (const shape of [MORNING, EVENING]) {
          const gain = shortSlots(dayOf(date), p, dayType, area, shape[0], shape[1]);   // その形・場所で埋まる足りない15分の数
          if (gain > best.gain) best = { area, shape, gain };
        }
      }
      place(m, best.shape, best.area);
    }
  }

  // ============================================================
  // ④ まだ足りなければ、応援（2nd・3rd でこの店舗に行ける人）を入れる
  //    順番の早い人（2nd → 3rd）から。希望の中で、足りない時間だけ
  // ============================================================
  for (const date of p.dates) {
    const dayType = p.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const m of helpers) {
      if (working(m, date)) continue;
      const hope = hopeOf(m, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;
      const hrs = p.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり
      for (const area of ["hall", "kitchen"]) {
        if (m.skills[area] < 50) continue;
        const span = neededSpan(dayOf(date), p, dayType, area, from, to);   // 希望の中で、足りない所だけ
        if (span && !busyElsewhere(m, date, span.from, span.to)) {
          const a = work(m, date, span.from, span.to, area);   // 応援の勤務
          a.helper = true;                         // 応援として入れた印
          result.push(a);
          break;
        }
      }
    }
  }

  // ============================================================
  // ⑤ 働き方のルール（2026年11月6日）
  //    ・18歳未満の人は 5:00〜22:00 に縮める（1時間より短くなったら外す）
  //    ・月・年の上限がある人は、残りの時間をこえる勤務を外す（短い日から残す）
  // ============================================================
  for (const m of p.members) {
    if (m.minor) {
      for (const a of result.filter((x) => x.memberId === m.id && !x.fixed)) {
        Object.assign(a, clipForMinor(a.from, a.to));
        if (a.breakAt != null && (a.breakAt < a.from || a.breakAt >= a.to)) a.breakAt = null;
        if (a.to - a.from < 60) result.splice(result.indexOf(a), 1);
      }
    }
    if (m.leftMinutes != null) {
      let used = 0;                                                       // 入れた分
      for (const a of result.filter((x) => x.memberId === m.id).sort((x, y) => x.date.localeCompare(y.date))) {
        used += a.to - a.from;
        if (used > m.leftMinutes && !a.fixed) { result.splice(result.indexOf(a), 1); used -= a.to - a.from; }
      }
    }
  }

  // ============================================================
  // ⑥ 週1休み：7日全部入った人は、いちばん短い日を休みにする（固定は消さない）
  // ============================================================
  for (const m of p.members) {
    const mine = result.filter((a) => a.memberId === m.id);   // その人の勤務
    const days = new Set(mine.map((a) => a.date));   // その人が入っている日
    if (p.dates.every((d) => days.has(d))) {
      const removable = mine.filter((a) => !a.fixed).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];   // 消せる勤務のうち、いちばん短いもの
      if (removable) result.splice(result.indexOf(removable), 1);
    }
  }

  return result;
}

/** 締めの人は、キッチンができればキッチン（閉店作業が多いため） */
function closeArea(m) {
  return m.skills.kitchen >= m.skills.hall ? "kitchen" : "hall";
}

/** 1人分の勤務を作る（長ければ休憩の目安を真ん中に） */
function work(member, date, from, to, area) {
  const long = to - from >= CONFIG.BREAK_NEEDED_MIN;   // 休憩が必要な長さか
  return {
    memberId: member.id, date, from, to, area,
    breakAt: long ? defaultBreak(from, to) : null,          // 朝11:00より前には入れない
    fixed: false, createdBy: "ai", requested: false,
  };
}

/** from〜to の中で、人が足りない15分の数（社員をどこに入れるか比べるのに使う） */
function shortSlots(dayAssignments, p, dayType, area, from, to) {
  let n = 0;   // 足りない15分の数
  for (let m = from; m < to; m += STEP) {
    if (assignedAt(dayAssignments, area, m) < requiredAt(p.requirements, p.positions, dayType, area, m)) n++;
  }
  return n;
}

/**
 * 希望の時間（from〜to）の中で、人が足りない所だけを切り出す
 * 例：希望 9:00〜15:00 で、足りないのが 11:00〜14:00 なら 11:00〜14:00
 * 足りない所がなければ null（入れない）
 */
function neededSpan(dayAssignments, p, dayType, area, from, to) {
  let first = null, last = null;   // 足りない所の最初と最後
  for (let m = from; m < to; m += STEP) {
    if (assignedAt(dayAssignments, area, m) < requiredAt(p.requirements, p.positions, dayType, area, m)) {
      if (first === null) first = m;
      last = m + STEP;
    }
  }
  if (first === null) return null;
  // 短すぎる勤務は作らない（最低3時間。希望の中に収める）
  if (last - first < 180) {
    last = Math.min(to, first + 180);
    first = Math.max(from, last - 180);
  }
  return { from: first, to: last };
}
