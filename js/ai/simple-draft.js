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
 * @param {object} props
 * @param {string[]} props.dates
 * @param {object[]} props.members        この店舗で働ける人（rankHere：1＝メイン、2以上＝応援）
 * @param {object[]} [props.elsewhere]    同じ週にほかの店舗に入っている勤務（重ねないため）
 * @param {object[]} props.availabilities
 * @param {object[]} props.requirements
 * @param {object[]} props.positions
 * @param {object[]} props.fixed          店長が固定した勤務（変えない）
 * @param {object[]} props.past           過去の勤務（よく入っている人を知るため）
 * @param {(date:string)=>string} props.dayTypeOf
 * @param {(date:string)=>{open:number,close:number}} props.hoursOf その日の営業時間
 * @param {object} [props.learned]        店長の直し方（ai/learning.js の summarize の結果）
 * @returns {object[]} 下書きの勤務
 */
export function makeDraft(props) {
  const result = props.fixed.map((shift) => ({ ...shift }));          // 下書き（固定した勤務から始める）

  // ---------- 店長の直し方（学び） ----------
  const learned = props.learned || { prefer: new Map(), avoid: new Map(), areaPref: new Map() };
  /** 店長がその人・その曜日によく入れる時間（なければ null） */
  const preferOf = (member, date) => learned.prefer.get(`${member.id}|${weekdayOf(date)}`) || null;
  /** 店長がその人・その曜日をよく外すか */
  const avoided = (member, date) => learned.avoid.has(`${member.id}|${weekdayOf(date)}`) && !preferOf(member, date);
  /** その人の場所（店長がよく変える先があればそこ） */
  const areaFor = (member, fallback) => learned.areaPref.get(member.id) || fallback;

  // 過去に何回入ったか（多い人を優先）
  const pastCount = new Map();
  for (const shift of props.past) pastCount.set(shift.memberId, (pastCount.get(shift.memberId) || 0) + 1);

  // 優先順に並べる
  const score = (member) =>
    (member.everyday || member.kind === "full" ? 1000 : 0)
    + Math.max(member.skills.hall, member.skills.kitchen)
    + (pastCount.get(member.id) || 0);
  const members = props.members.filter((member) => member.active).sort((memberA, memberB) => score(memberB) - score(memberA));   // 働いている人を、優先の高い順に
  /** この店舗がメインの人か */
  const isMain = (member) => (member.rankHere ?? 1) === 1;
  const shain = members.filter((member) => member.kind === "shain" && isMain(member));   // メインの社員
  const helpers = members.filter((member) => !isMain(member)).sort((memberA, memberB) => memberA.rankHere - memberB.rankHere || score(memberB) - score(memberA));   // 応援の人（2nd → 3rd の順）
  const elsewhere = props.elsewhere || [];   // ほかの店舗の勤務

  /** その日の下書き */
  const dayOf = (date) => result.filter((shift) => shift.date === date);
  /** その人のその日の希望 */
  const hopeOf = (member, date) => props.availabilities.find((hope) => hope.memberId === member.id && hope.date === date);
  /** その人がその日もう入っているか */
  const working = (member, date) => result.some((shift) => shift.memberId === member.id && shift.date === date);
  /** その時間、ほかの店舗に入っているか */
  const busyElsewhere = (member, date, from, to) =>
    elsewhere.some((shift) => shift.memberId === member.id && shift.date === date && overlaps(shift.from, shift.to, from, to));

  // ============================================================
  // ① バイト・フル：希望の中で、足りない時間にだけ入れる（全部の日）
  // ============================================================
  for (const date of props.dates) {
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const member of members) {
      if (member.kind === "shain" || !isMain(member) || working(member, date) || avoided(member, date)) continue;
      const hope = hopeOf(member, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;
      const hrs = props.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり（いつでもOKなら開店）
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり（いつでもOKなら閉店）
      const area = areaFor(member, member.skills.kitchen > member.skills.hall ? "kitchen" : "hall");   // 入れる場所（できる方。店長がよく変える先があればそこ）
      // 店長がいつも入れる時間があれば、それを使う（希望の中に収まる時だけ）
      const pref = preferOf(member, date);
      if (pref && pref.from >= from && pref.to <= to && !busyElsewhere(member, date, pref.from, pref.to)) {
        result.push(work(member, date, pref.from, pref.to, pref.area || area));
        continue;
      }
      const span = neededSpan(dayOf(date), props, dayType, area, from, to);   // 希望の中で、足りない所だけ
      if (span && !busyElsewhere(member, date, span.from, span.to)) result.push(work(member, date, span.from, span.to, area));
    }
  }

  // ============================================================
  // ② 社員の休みの日を決める（要件 F-48・F-49）
  //    ・休み希望を出した → その日（週2日まで）
  //    ・希望を出していない → 休みは週1日だけ。いちばん人が足りている日にする
  // ============================================================
  const offDays = new Map();
  for (const member of shain) {
    const asked = props.dates.filter((date) => ["off", "offx", "no"].includes(hopeOf(member, date)?.kind));   // 休み希望を出した日
    if (asked.length) { offDays.set(member.id, new Set(asked)); continue; }
    // 固定した勤務がない日の中から、不足がいちばん少ない日
    const candidates = props.dates.filter((date) => !working(member, date));
    /** その日の足りない15分の数（ホール＋キッチン） */
    const shortTotal = (date) => ["hall", "kitchen"].reduce((sum, area) => sum + shortSlots(dayOf(date), props, props.dayTypeOf(date), area, props.hoursOf(date).open, props.hoursOf(date).close), 0);
    // ほかの社員と休みが重ならないように、同じ日に休む社員が少ない日を先にする
    const restCount = (date) => [...offDays.values()].filter((set) => set.has(date)).length;
    candidates.sort((candidateA, candidateB) => restCount(candidateA) - restCount(candidateB) || shortTotal(candidateA) - shortTotal(candidateB));
    offDays.set(member.id, new Set(candidates.slice(0, 1)));
  }

  // ============================================================
  // ③ 社員は休みの日以外、毎日入れる
  //    勤務の形は「朝（開店から9時間）」か「夜（閉店までの9時間）」
  //    立ち上げ・締めがいない日は、それができる社員を先に入れる
  // ============================================================
  const bestArea = (member) => (member.skills.hall >= member.skills.kitchen ? "hall" : "kitchen");

  for (const date of props.dates) {
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    const hrs = props.hoursOf(date);   // その日の営業時間
    const MORNING = [hrs.open, Math.min(hrs.close, hrs.open + 9 * 60)];     // 朝：開店から9時間
    const EVENING = [Math.max(hrs.open, hrs.close - 9 * 60), hrs.close];    // 夜：閉店までの9時間
    const OPENER = [openStart(hrs), openStart(hrs) + 9 * 60];               // 立ち上げ：開店30分前から9時間（7:00開店→6:30〜15:30）
    // 休みの日・もう入っている日・ほかの店舗に入っている日は入れない
    const todo = shain.filter((member) => !offDays.get(member.id)?.has(date) && !working(member, date)
      && !elsewhere.some((shift) => shift.memberId === member.id && shift.date === date));
    /** その日、そのことが100%できる人がもう入っているか */
    const has = (skill, check) => dayOf(date).some((shift) => check(shift) && props.members.find((member) => member.id === shift.memberId)?.skills[skill] === 100);
    /** 社員を1人入れる（入れたら todo から外す） */
    const place = (member, [from, to], area) => {
      const hope = hopeOf(member, date);   // その日の希望
      const pref = preferOf(member, date);   // 店長がいつも入れる時間
      // 時間指定の希望があれば、その時間で入れる。なければ、店長がいつも入れる時間
      if (hope?.kind === "time") { from = hope.from; to = hope.to; }
      else if (pref) { from = pref.from; to = pref.to; area = pref.area || area; }
      area = areaFor(member, area);
      result.push(work(member, date, from, to, area));
      todo.splice(todo.indexOf(member), 1);
    };

    if (!has("open", (shift) => shift === openerOf(dayOf(date), hrs))) {
      const member = todo.find((member) => member.skills.open === 100);   // 立ち上げ100%の社員
      if (member) place(member, OPENER, bestArea(member));
    }
    if (!has("close", (shift) => shift.to >= hrs.close)) {
      const member = todo.find((member) => member.skills.close === 100);   // 締め100%の社員
      if (member) place(member, EVENING, closeArea(member));
    }
    // 残りの社員：足りない所がいちばん多い形と場所に入れる
    for (const member of [...todo]) {
      let best = { area: bestArea(member), shape: MORNING, gain: -1 };   // いちばんよい場所と形
      for (const area of ["hall", "kitchen"]) {
        if (member.skills[area] < 50) continue;                // あまりできない場所には入れない
        for (const shape of [MORNING, EVENING]) {
          const gain = shortSlots(dayOf(date), props, dayType, area, shape[0], shape[1]);   // その形・場所で埋まる足りない15分の数
          if (gain > best.gain) best = { area, shape, gain };
        }
      }
      place(member, best.shape, best.area);
    }
  }

  // ============================================================
  // ④ まだ足りなければ、応援（2nd・3rd でこの店舗に行ける人）を入れる
  //    順番の早い人（2nd → 3rd）から。希望の中で、足りない時間だけ
  // ============================================================
  for (const date of props.dates) {
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const member of helpers) {
      if (working(member, date)) continue;
      const hope = hopeOf(member, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;
      const hrs = props.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり
      for (const area of ["hall", "kitchen"]) {
        if (member.skills[area] < 50) continue;
        const span = neededSpan(dayOf(date), props, dayType, area, from, to);   // 希望の中で、足りない所だけ
        if (span && !busyElsewhere(member, date, span.from, span.to)) {
          const shift = work(member, date, span.from, span.to, area);   // 応援の勤務
          shift.helper = true;                         // 応援として入れた印
          result.push(shift);
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
  for (const member of props.members) {
    if (member.minor) {
      for (const shift of result.filter((shift) => shift.memberId === member.id && !shift.fixed)) {
        Object.assign(shift, clipForMinor(shift.from, shift.to));
        if (shift.breakAt != null && (shift.breakAt < shift.from || shift.breakAt >= shift.to)) shift.breakAt = null;
        if (shift.to - shift.from < 60) result.splice(result.indexOf(shift), 1);
      }
    }
    if (member.leftMinutes != null) {
      let used = 0;                                                       // 入れた分
      for (const shift of result.filter((shift) => shift.memberId === member.id).sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date))) {
        used += shift.to - shift.from;
        if (used > member.leftMinutes && !shift.fixed) { result.splice(result.indexOf(shift), 1); used -= shift.to - shift.from; }
      }
    }
  }

  // ============================================================
  // ⑥ 週1休み：7日全部入った人は、いちばん短い日を休みにする（固定は消さない）
  // ============================================================
  for (const member of props.members) {
    const mine = result.filter((shift) => shift.memberId === member.id);   // その人の勤務
    const days = new Set(mine.map((shift) => shift.date));   // その人が入っている日
    if (props.dates.every((date) => days.has(date))) {
      const removable = mine.filter((shift) => !shift.fixed).sort((shiftA, shiftB) => (shiftA.to - shiftA.from) - (shiftB.to - shiftB.from))[0];   // 消せる勤務のうち、いちばん短いもの
      if (removable) result.splice(result.indexOf(removable), 1);
    }
  }

  return result;
}

/** 締めの人は、キッチンができればキッチン（閉店作業が多いため） */
function closeArea(member) {
  return member.skills.kitchen >= member.skills.hall ? "kitchen" : "hall";
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
function shortSlots(dayAssignments, props, dayType, area, from, to) {
  let count = 0;   // 足りない15分の数
  for (let minutes = from; minutes < to; minutes += STEP) {
    if (assignedAt(dayAssignments, area, minutes) < requiredAt(props.requirements, props.positions, dayType, area, minutes)) count++;
  }
  return count;
}

/**
 * 希望の時間（from〜to）の中で、人が足りない所だけを切り出す
 * 例：希望 9:00〜15:00 で、足りないのが 11:00〜14:00 なら 11:00〜14:00
 * 足りない所がなければ null（入れない）
 */
function neededSpan(dayAssignments, props, dayType, area, from, to) {
  let first = null, last = null;   // 足りない所の最初と最後
  for (let minutes = from; minutes < to; minutes += STEP) {
    if (assignedAt(dayAssignments, area, minutes) < requiredAt(props.requirements, props.positions, dayType, area, minutes)) {
      if (first === null) first = minutes;
      last = minutes + STEP;
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
