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
//   4. 社員は、まだ立ち上げ／締めがいない日に入れる。まだ足りなければ社員で埋める
//   5. 長い勤務には休憩の目安を真ん中に入れる
//   6. 7日全部入った人は、1日休みにする（週1休み）
// ============================================================

import { CONFIG } from "../config.js";
import { requiredAt, assignedAt } from "../rules/shift-rules.js";
import { STEP, snap } from "../lib/time.js";

/**
 * @param {object} p
 * @param {string[]} p.dates
 * @param {object[]} p.members
 * @param {object[]} p.availabilities
 * @param {object[]} p.requirements
 * @param {object[]} p.positions
 * @param {object[]} p.fixed          店長が固定した勤務（変えない）
 * @param {object[]} p.past           過去の勤務（よく入っている人を知るため）
 * @param {(date:string)=>string} p.dayTypeOf
 * @returns {object[]} 下書きの勤務
 */
export function makeDraft(p) {
  const result = p.fixed.map((a) => ({ ...a }));

  // 過去に何回入ったか（多い人を優先）
  const pastCount = new Map();
  for (const a of p.past) pastCount.set(a.memberId, (pastCount.get(a.memberId) || 0) + 1);

  // 優先順に並べる
  const score = (m) =>
    (m.everyday || m.kind === "full" ? 1000 : 0)
    + Math.max(m.skills.hall, m.skills.kitchen)
    + (pastCount.get(m.id) || 0);
  const members = p.members.filter((m) => m.active).sort((a, b) => score(b) - score(a));

  for (const date of p.dates) {
    const dayType = p.dayTypeOf(date);
    const today = () => result.filter((a) => a.date === date);
    const fixedToday = new Set(today().map((a) => a.memberId));

    // ---- バイト・フル：希望の中で、足りない時間にだけ入れる ----
    for (const m of members) {
      if (m.kind === "shain" || fixedToday.has(m.id)) continue;
      const hope = p.availabilities.find((a) => a.memberId === m.id && a.date === date);
      if (!hope || !["time", "any"].includes(hope.kind)) continue;
      const from = hope.kind === "time" ? hope.from : CONFIG.DAY_START;
      const to = hope.kind === "time" ? hope.to : CONFIG.DAY_END;
      const area = m.skills.kitchen > m.skills.hall ? "kitchen" : "hall";
      const span = neededSpan(today(), p, dayType, area, from, to);
      if (span) result.push(work(m, date, span.from, span.to, area));
    }

    // ---- 社員：立ち上げ・締めがいなければ入れる ----
    const shain = members.filter((m) => m.kind === "shain" && !fixedToday.has(m.id));
    const free = (m) => {
      const hope = p.availabilities.find((a) => a.memberId === m.id && a.date === date);
      return !hope || hope.kind === "any" || hope.kind === "time";      // 休み希望の日は入れない
    };
    const has = (skill, check) => today().some((a) => check(a) && p.members.find((m) => m.id === a.memberId)?.skills[skill] === 100);
    if (!has("open", (a) => a.from <= CONFIG.DAY_START)) {
      const m = shain.find((x) => x.skills.open === 100 && free(x) && !today().some((a) => a.memberId === x.id));
      if (m) result.push(work(m, date, CONFIG.DAY_START, CONFIG.DAY_START + 9 * 60, m.skills.hall >= m.skills.kitchen ? "hall" : "kitchen"));
    }
    if (!has("close", (a) => a.to >= CONFIG.DAY_END)) {
      const m = shain.find((x) => x.skills.close === 100 && free(x) && !today().some((a) => a.memberId === x.id));
      if (m) result.push(work(m, date, CONFIG.DAY_END - 9 * 60, CONFIG.DAY_END, m.skills.kitchen >= m.skills.hall ? "kitchen" : "hall"));
    }

    // ---- まだ足りなければ、空いている社員で埋める（要件：足りない時は社員を入れる） ----
    // 社員の勤務の形は「朝（7:00〜16:00）」か「夜（13:00〜22:00）」の、足りない所が多い方
    const shapes = [[CONFIG.DAY_START, CONFIG.DAY_START + 9 * 60], [CONFIG.DAY_END - 9 * 60, CONFIG.DAY_END]];
    for (const m of shain) {
      if (!free(m) || today().some((a) => a.memberId === m.id)) continue;
      let best = null;
      for (const area of ["hall", "kitchen"]) {
        if (m.skills[area] < 50) continue;                          // あまりできない場所には入れない
        for (const [from, to] of shapes) {
          const gain = shortSlots(today(), p, dayType, area, from, to);
          if (gain > 0 && (!best || gain > best.gain)) best = { area, from, to, gain };
        }
      }
      if (best) {
        const a = work(m, date, best.from, best.to, best.area);
        a.requested = true;                                        // 「すみませんが入ってください」のお知らせ用
        result.push(a);
      }
    }
  }

  // ---- 週1休み：7日全部入った人は、いちばん短い日を休みにする（固定は消さない） ----
  for (const m of p.members) {
    const mine = result.filter((a) => a.memberId === m.id);
    const days = new Set(mine.map((a) => a.date));
    if (p.dates.every((d) => days.has(d))) {
      const removable = mine.filter((a) => !a.fixed).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
      if (removable) result.splice(result.indexOf(removable), 1);
    }
  }

  return result;
}

/** 1人分の勤務を作る（長ければ休憩の目安を真ん中に） */
function work(member, date, from, to, area) {
  const long = to - from >= CONFIG.BREAK_NEEDED_MIN;
  return {
    memberId: member.id, date, from, to, area,
    breakAt: long ? snap((from + to) / 2) : null,
    fixed: false, createdBy: "ai", requested: false,
  };
}

/** from〜to の中で、人が足りない15分の数（社員をどこに入れるか比べるのに使う） */
function shortSlots(dayAssignments, p, dayType, area, from, to) {
  let n = 0;
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
  let first = null, last = null;
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
