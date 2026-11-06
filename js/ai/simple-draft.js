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

import { CONFIG } from "../config.js";   // 設定を読む
import { requiredAt, assignedAt } from "../rules/shift-rules.js";   // 必要人数・入っている人数を出す道具を読む
import { STEP, overlaps } from "../lib/time.js";   // 時間の道具を読む
import { defaultBreak } from "../lib/breaks.js";   // 休憩の道具を読む
import { openerOf, openStart } from "../lib/roles.js";   // 立ち上げの道具を読む
import { weekdayOf } from "./learning.js";   // 曜日の道具を読む
import { clipForMinor } from "../rules/labor-rules.js";   // 18歳未満の時間を縮める道具を読む

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
export function makeDraft(props) {   // AIなしで1週間のたたき台を作る関数
  const result = props.fixed.map((shift) => ({ ...shift }));          // 下書き（固定した勤務から始める）

  // ---------- 店長の直し方（学び） ----------
  const learned = props.learned || { prefer: new Map(), avoid: new Map(), areaPref: new Map() };   // 覚えたこと（なければ空）
  /** 店長がその人・その曜日によく入れる時間（なければ null） */
  const preferOf = (member, date) => learned.prefer.get(`${member.id}|${weekdayOf(date)}`) || null;   // その人・その曜日のいつもの時間
  /** 店長がその人・その曜日をよく外すか */
  const avoided = (member, date) => learned.avoid.has(`${member.id}|${weekdayOf(date)}`) && !preferOf(member, date);   // その曜日によく外す人か
  /** その人の場所（店長がよく変える先があればそこ） */
  const areaFor = (member, fallback) => learned.areaPref.get(member.id) || fallback;   // その人のいつもの場所

  // 過去に何回入ったか（多い人を優先）
  const pastCount = new Map();   // 前の週に入った回数
  for (const shift of props.past) pastCount.set(shift.memberId, (pastCount.get(shift.memberId) || 0) + 1);   // 人ごとに数える

  // 優先順に並べる
  const score = (member) =>   // 入れる順番の点数
    (member.everyday || member.kind === "full" ? 1000 : 0)   // 毎日入る人・フルの人を先に
    + Math.max(member.skills.hall, member.skills.kitchen)   // できること％
    + (pastCount.get(member.id) || 0);   // 前に多く入った人
  const members = props.members.filter((member) => member.active).sort((memberA, memberB) => score(memberB) - score(memberA));   // 働いている人を、優先の高い順に
  /** この店舗がメインの人か */
  const isMain = (member) => (member.rankHere ?? 1) === 1;   // 所属店の人か
  const shain = members.filter((member) => member.kind === "shain" && isMain(member));   // メインの社員
  const helpers = members.filter((member) => !isMain(member)).sort((memberA, memberB) => memberA.rankHere - memberB.rankHere || score(memberB) - score(memberA));   // 応援の人（2nd → 3rd の順）
  const elsewhere = props.elsewhere || [];   // ほかの店舗の勤務

  /** その日の下書き */
  const dayOf = (date) => result.filter((shift) => shift.date === date);   // その日の勤務
  /** その人のその日の希望 */
  const hopeOf = (member, date) => props.availabilities.find((hope) => hope.memberId === member.id && hope.date === date);   // その人のその日の希望
  /** その人がその日もう入っているか */
  const working = (member, date) => result.some((shift) => shift.memberId === member.id && shift.date === date);   // その日にもう入っているか
  /** その時間、ほかの店舗に入っているか */
  const busyElsewhere = (member, date, from, to) =>   // ほかの店舗に入っているか
    elsewhere.some((shift) => shift.memberId === member.id && shift.date === date && overlaps(shift.from, shift.to, from, to));   // 日と時間が重なる勤務がある

  // ============================================================
  // ① バイト・フル：希望の中で、足りない時間にだけ入れる（全部の日）
  // ============================================================
  for (const date of props.dates) {   // ① バイト：日ごとに
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const member of members) {   // 人ごとに
      if (member.kind === "shain" || !isMain(member) || working(member, date) || avoided(member, date)) continue;   // 社員・応援・もう入っている・よく外す人は飛ばす
      const hope = hopeOf(member, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;   // 入れる希望でなければ飛ばす
      const hrs = props.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり（いつでもOKなら開店）
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり（いつでもOKなら閉店）
      const area = areaFor(member, member.skills.kitchen > member.skills.hall ? "kitchen" : "hall");   // 入れる場所（できる方。店長がよく変える先があればそこ）
      // 店長がいつも入れる時間があれば、それを使う（希望の中に収まる時だけ）
      const pref = preferOf(member, date);   // いつもの時間
      if (pref && pref.from >= from && pref.to <= to && !busyElsewhere(member, date, pref.from, pref.to)) {   // 希望の中に入るなら
        result.push(work(member, date, pref.from, pref.to, pref.area || area));   // いつもの時間で入れる
        continue;   // 次の人へ
      }
      const span = neededSpan(dayOf(date), props, dayType, area, from, to);   // 希望の中で、足りない所だけ
      if (span && !busyElsewhere(member, date, span.from, span.to)) result.push(work(member, date, span.from, span.to, area));   // 足りない時間に入れる
    }
  }

  // ============================================================
  // ② 社員の休みの日を決める（要件 F-48・F-49）
  //    ・休み希望を出した → その日（週2日まで）
  //    ・希望を出していない → 休みは週1日だけ。いちばん人が足りている日にする
  // ============================================================
  const offDays = new Map();   // ② 社員の休みの日
  for (const member of shain) {   // 社員ごとに
    const asked = props.dates.filter((date) => ["off", "offx", "no"].includes(hopeOf(member, date)?.kind));   // 休み希望を出した日
    if (asked.length) { offDays.set(member.id, new Set(asked)); continue; }   // 休み希望があればその日
    // 固定した勤務がない日の中から、不足がいちばん少ない日
    const candidates = props.dates.filter((date) => !working(member, date));   // 休みにできる日
    /** その日の足りない15分の数（ホール＋キッチン） */
    const shortTotal = (date) => ["hall", "kitchen"].reduce((sum, area) => sum + shortSlots(dayOf(date), props, props.dayTypeOf(date), area, props.hoursOf(date).open, props.hoursOf(date).close), 0);   // その日の足りない時間の合計
    // ほかの社員と休みが重ならないように、同じ日に休む社員が少ない日を先にする
    const restCount = (date) => [...offDays.values()].filter((set) => set.has(date)).length;   // その日に休む社員の数
    candidates.sort((candidateA, candidateB) => restCount(candidateA) - restCount(candidateB) || shortTotal(candidateA) - shortTotal(candidateB));   // 休む人が少なく、足りない時間が少ない日を選ぶ
    offDays.set(member.id, new Set(candidates.slice(0, 1)));   // 1日休み
  }

  // ============================================================
  // ③ 社員は休みの日以外、毎日入れる
  //    勤務の形は「朝（開店から9時間）」か「夜（閉店までの9時間）」
  //    立ち上げ・締めがいない日は、それができる社員を先に入れる
  // ============================================================
  const bestArea = (member) => (member.skills.hall >= member.skills.kitchen ? "hall" : "kitchen");   // 得意な場所

  for (const date of props.dates) {   // ③ 社員：日ごとに
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    const hrs = props.hoursOf(date);   // その日の営業時間
    const MORNING = [hrs.open, Math.min(hrs.close, hrs.open + 9 * 60)];     // 朝：開店から9時間
    const EVENING = [Math.max(hrs.open, hrs.close - 9 * 60), hrs.close];    // 夜：閉店までの9時間
    const OPENER = [openStart(hrs), openStart(hrs) + 9 * 60];               // 立ち上げ：開店30分前から9時間（7:00開店→6:30〜15:30）
    // 休みの日・もう入っている日・ほかの店舗に入っている日は入れない
    const todo = shain.filter((member) => !offDays.get(member.id)?.has(date) && !working(member, date)   // まだ入っていない社員
      && !elsewhere.some((shift) => shift.memberId === member.id && shift.date === date));   // ほかの店舗に入っていない
    /** その日、そのことが100%できる人がもう入っているか */
    const has = (skill, check) => dayOf(date).some((shift) => check(shift) && props.members.find((member) => member.id === shift.memberId)?.skills[skill] === 100);   // その役割の人がいるか
    /** 社員を1人入れる（入れたら todo から外す） */
    const place = (member, [from, to], area) => {   // 社員を入れる関数
      const hope = hopeOf(member, date);   // その日の希望
      const pref = preferOf(member, date);   // 店長がいつも入れる時間
      // 時間指定の希望があれば、その時間で入れる。なければ、店長がいつも入れる時間
      if (hope?.kind === "time") { from = hope.from; to = hope.to; }   // 時間の希望があればその時間
      else if (pref) { from = pref.from; to = pref.to; area = pref.area || area; }   // いつもの時間があればその時間
      area = areaFor(member, area);   // いつもの場所
      result.push(work(member, date, from, to, area));   // 入れる
      todo.splice(todo.indexOf(member), 1);   // まだの人から外す
    };

    if (!has("open", (shift) => shift === openerOf(dayOf(date), hrs))) {   // 立ち上げがいなければ
      const member = todo.find((member) => member.skills.open === 100);   // 立ち上げ100%の社員
      if (member) place(member, OPENER, bestArea(member));   // 朝の形で入れる
    }
    if (!has("close", (shift) => shift.to >= hrs.close)) {   // 締めがいなければ
      const member = todo.find((member) => member.skills.close === 100);   // 締め100%の社員
      if (member) place(member, EVENING, closeArea(member));   // 夜の形で入れる
    }
    // 残りの社員：足りない所がいちばん多い形と場所に入れる
    for (const member of [...todo]) {   // 残りの社員ごとに
      let best = { area: bestArea(member), shape: MORNING, gain: -1 };   // いちばんよい場所と形
      for (const area of ["hall", "kitchen"]) {   // 場所ごとに
        if (member.skills[area] < 50) continue;                // あまりできない場所には入れない
        for (const shape of [MORNING, EVENING]) {   // 朝と夜の形で
          const gain = shortSlots(dayOf(date), props, dayType, area, shape[0], shape[1]);   // その形・場所で埋まる足りない15分の数
          if (gain > best.gain) best = { area, shape, gain };   // 一番足りない所を覚える
        }
      }
      place(member, best.shape, best.area);   // そこに入れる
    }
  }

  // ============================================================
  // ④ まだ足りなければ、応援（2nd・3rd でこの店舗に行ける人）を入れる
  //    順番の早い人（2nd → 3rd）から。希望の中で、足りない時間だけ
  // ============================================================
  for (const date of props.dates) {   // ④ 応援の人：日ごとに
    const dayType = props.dayTypeOf(date);   // 平日／土曜／日曜祝日
    for (const member of helpers) {   // 人ごとに
      if (working(member, date)) continue;   // もう入っていれば飛ばす
      const hope = hopeOf(member, date);   // その日の希望
      if (!hope || !["time", "any"].includes(hope.kind)) continue;   // 入れる希望でなければ飛ばす
      const hrs = props.hoursOf(date);   // その日の営業時間
      const from = hope.kind === "time" ? hope.from : hrs.open;   // 入れる時間の始まり
      const to = hope.kind === "time" ? hope.to : hrs.close;   // 入れる時間の終わり
      for (const area of ["hall", "kitchen"]) {   // 場所ごとに
        if (member.skills[area] < 50) continue;   // できなければ飛ばす
        const span = neededSpan(dayOf(date), props, dayType, area, from, to);   // 希望の中で、足りない所だけ
        if (span && !busyElsewhere(member, date, span.from, span.to)) {   // 足りない時間があれば
          const shift = work(member, date, span.from, span.to, area);   // 応援の勤務
          shift.helper = true;                         // 応援として入れた印
          result.push(shift);   // 入れる
          break;   // 1つで終わり
        }
      }
    }
  }

  // ============================================================
  // ⑤ 働き方のルール（2026年11月6日）
  //    ・18歳未満の人は 5:00〜22:00 に縮める（1時間より短くなったら外す）
  //    ・月・年の上限がある人は、残りの時間をこえる勤務を外す（短い日から残す）
  // ============================================================
  for (const member of props.members) {   // ⑤ 働き方のルール：人ごとに
    if (member.minor) {   // 18歳未満なら
      for (const shift of result.filter((shift) => shift.memberId === member.id && !shift.fixed)) {   // 固定していない勤務を
        Object.assign(shift, clipForMinor(shift.from, shift.to));   // 5時〜22時に縮める
        if (shift.breakAt != null && (shift.breakAt < shift.from || shift.breakAt >= shift.to)) shift.breakAt = null;   // 休憩が外に出たら消す
        if (shift.to - shift.from < 60) result.splice(result.indexOf(shift), 1);   // 短すぎたら消す
      }
    }
    if (member.leftMinutes != null) {   // 月・年の上限があれば
      let used = 0;                                                       // 入れた分
      for (const shift of result.filter((shift) => shift.memberId === member.id).sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date))) {   // 日付順に
        used += shift.to - shift.from;   // 足していく
        if (used > member.leftMinutes && !shift.fixed) { result.splice(result.indexOf(shift), 1); used -= shift.to - shift.from; }   // こえたら消す
      }
    }
  }

  // ============================================================
  // ⑥ 週1休み：7日全部入った人は、いちばん短い日を休みにする（固定は消さない）
  // ============================================================
  for (const member of props.members) {   // ⑥ 7日全部入っている人は
    const mine = result.filter((shift) => shift.memberId === member.id);   // その人の勤務
    const days = new Set(mine.map((shift) => shift.date));   // その人が入っている日
    if (props.dates.every((date) => days.has(date))) {   // 全部入っていれば
      const removable = mine.filter((shift) => !shift.fixed).sort((shiftA, shiftB) => (shiftA.to - shiftA.from) - (shiftB.to - shiftB.from))[0];   // 消せる勤務のうち、いちばん短いもの
      if (removable) result.splice(result.indexOf(removable), 1);   // 1つ消す
    }
  }

  return result;   // たたき台を返す
}

/** 締めの人は、キッチンができればキッチン（閉店作業が多いため） */
function closeArea(member) {   // 夜に入る場所を決める関数
  return member.skills.kitchen >= member.skills.hall ? "kitchen" : "hall";   // キッチンが得意ならキッチン
}

/** 1人分の勤務を作る（長ければ休憩の目安を真ん中に） */
function work(member, date, from, to, area) {   // 勤務を1つ作る関数
  const long = to - from >= CONFIG.BREAK_NEEDED_MIN;   // 休憩が必要な長さか
  return {   // 返す
    memberId: member.id, date, from, to, area,   // 人・日・時間・場所
    breakAt: long ? defaultBreak(from, to) : null,          // 朝11:00より前には入れない
    fixed: false, createdBy: "ai", requested: false,   // 固定しない・AIが作った・希望なし
  };
}

/** from〜to の中で、人が足りない15分の数（社員をどこに入れるか比べるのに使う） */
function shortSlots(dayAssignments, props, dayType, area, from, to) {   // 足りない時間の数を出す関数
  let count = 0;   // 足りない15分の数
  for (let minutes = from; minutes < to; minutes += STEP) {   // 15分ごとに
    if (assignedAt(dayAssignments, area, minutes) < requiredAt(props.requirements, props.positions, dayType, area, minutes)) count++;   // 足りなければ数える
  }
  return count;   // 数を返す
}

/**
 * 希望の時間（from〜to）の中で、人が足りない所だけを切り出す
 * 例：希望 9:00〜15:00 で、足りないのが 11:00〜14:00 なら 11:00〜14:00
 * 足りない所がなければ null（入れない）
 */
function neededSpan(dayAssignments, props, dayType, area, from, to) {   // 足りない時間のはばを出す関数
  let first = null, last = null;   // 足りない所の最初と最後
  for (let minutes = from; minutes < to; minutes += STEP) {   // 15分ごとに
    if (assignedAt(dayAssignments, area, minutes) < requiredAt(props.requirements, props.positions, dayType, area, minutes)) {   // 足りなければ
      if (first === null) first = minutes;   // 最初の時間
      last = minutes + STEP;   // 最後の時間
    }
  }
  if (first === null) return null;   // なければ null
  // 短すぎる勤務は作らない（最低3時間。希望の中に収める）
  if (last - first < 180) {   // 3時間より短ければ
    last = Math.min(to, first + 180);   // 3時間にのばす
    first = Math.max(from, last - 180);   // はみ出したら前にずらす
  }
  return { from: first, to: last };   // はばを返す
}
