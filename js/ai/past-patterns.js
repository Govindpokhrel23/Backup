// ============================================================
// ai/past-patterns.js — 過去のシフトから「いつもの形」を学ぶ（2026年11月22日）
// ------------------------------------------------------------
// このファイルは、前の週・前々週…と、過去に公開したシフトを見て、
// 「この人はこの曜日、いつもこの時間・この場所で入っている」を見つけるファイルです。
//
// しくみ：
//   ・過去 PAST_WEEKS 週（4週）の公開したシフトを、人と曜日ごとに分ける
//   ・同じ時間（始まり〜終わり）が PATTERN_MIN_WEEKS 週（3週）以上あれば「いつもの形」
//   ・場所は、その形でいちばん多かった場所
// 使い方（draft-service.js）：
//   ・店長の直し方（learning.js）と合わせて、下書き（simple-draft.js）とAI（prompt.js・apply-learned.js）に使う
//   ・店長の直し方の方が強い（同じ人・同じ曜日に両方あれば、直し方を使う）
//   ・希望・ルールの方が先（希望の時間の外には入れない。バイトは希望がない日には入れない）
// ============================================================

import { weekdayOf, WEEKDAY_LABEL } from "./learning.js";   // 曜日の道具を読む
import { range } from "../lib/time.js";   // 「9:00〜17:00」にする道具を読む
import { mondayOf } from "../lib/date.js";   // その週の月曜日を出す道具を読む

/** 何週前まで見るか */
export const PAST_WEEKS = 4;   // 4週（約1か月）

/** 何週同じなら「いつもの形」にするか */
export const PATTERN_MIN_WEEKS = 3;   // 4週のうち3週

/**
 * 過去のシフトから「いつもの形」を見つける
 * @param {object[]} pastShifts 過去に公開したシフト（何週分でもよい）
 * @param {object[]} members    店員（名前を出すため）
 * @returns {{prefer: Map<string,{from:number,to:number,area:string,count:number,weeks:number}>, notes: {text:string,count:number,weeks:number}[]}}
 *   prefer … 「人|曜日」→ いつもの時間と場所 ／ notes … AI に渡す説明の文
 */
export function findPatterns(pastShifts, members) {   // いつもの形を見つける関数
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "？";   // 人の名前
  const weeksAll = new Set(pastShifts.map((shift) => mondayOf(shift.date)));   // 見た週の数（月曜日でまとめる）
  // 人|曜日|始まり|終わり ごとに、何週あったか数える
  const groups = new Map();   // まとめた入れ物
  for (const shift of pastShifts) {   // 1つずつ
    const key = `${shift.memberId}|${weekdayOf(shift.date)}|${shift.from}|${shift.to}`;   // 人・曜日・時間
    if (!groups.has(key)) groups.set(key, { memberId: shift.memberId, weekday: weekdayOf(shift.date), from: shift.from, to: shift.to, weeks: new Set(), areas: {} });   // なければ作る
    const group = groups.get(key);   // 今のまとまり
    group.weeks.add(mondayOf(shift.date));   // その週を数える（同じ週に2回あっても1回）
    group.areas[shift.area] = (group.areas[shift.area] || 0) + 1;   // 場所を数える
  }
  const prefer = new Map();   // いつもの形
  for (const group of groups.values()) {   // まとまりごとに
    const count = group.weeks.size;   // 何週あったか
    if (count < PATTERN_MIN_WEEKS) continue;   // 少なければ「いつもの形」ではない
    const key = `${group.memberId}|${group.weekday}`;   // 人|曜日
    if (prefer.has(key) && prefer.get(key).count >= count) continue;   // もっと多い形があればそちら
    const area = Object.entries(group.areas).sort((first, second) => second[1] - first[1])[0][0];   // いちばん多い場所
    prefer.set(key, { from: group.from, to: group.to, area, count, weeks: weeksAll.size, memberId: group.memberId, weekday: group.weekday });   // いつもの形
  }
  const notes = [...prefer.values()]   // 説明の文
    .sort((first, second) => second.count - first.count)   // 多い順
    .map((pattern) => ({   // 1つずつ
      text: `${nameOf(pattern.memberId)}：${WEEKDAY_LABEL[pattern.weekday]}曜はいつも ${range(pattern.from, pattern.to)}（${pattern.area === "hall" ? "ホール" : "キッチン"}）`,   // 例「スタッフA：月曜はいつも 7:00〜16:00（ホール）」
      count: pattern.count, weeks: pattern.weeks,   // 何週中何週
    }));
  return { prefer, notes };   // いつもの形と説明を返す
}

/**
 * 店長の直し方（learning.js の summarize の結果）に「いつもの形」を足す
 * 直し方の方が強い：同じ人・同じ曜日に直し方があれば、いつもの形は使わない。よく外す日にも使わない
 * @param {object} learned  summarize() の結果
 * @param {object|null} patterns findPatterns() の結果
 * @returns {object} 合わせたもの（patternNotes：AIに渡す「いつもの形」の説明、patternCount：使った数）
 */
export function withPatterns(learned, patterns) {   // 直し方といつもの形を合わせる関数
  const prefer = new Map(learned.prefer);   // 直し方の時間（元は変えない）
  let patternCount = 0;   // 使ったいつもの形の数
  for (const [key, pattern] of patterns?.prefer || []) {   // いつもの形ごとに
    if (prefer.has(key) || learned.avoid.has(key)) continue;   // 直し方がある・よく外す日なら使わない
    prefer.set(key, { from: pattern.from, to: pattern.to, area: pattern.area, count: pattern.count, past: true });   // いつもの形を足す
    patternCount++;   // 数える
  }
  return { ...learned, prefer, patternNotes: patterns?.notes || [], patternCount };   // 合わせたものを返す
}
