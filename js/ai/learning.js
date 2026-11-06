// ============================================================
// ai/learning.js — 店長の直し方を「覚える」
// ------------------------------------------------------------
// このファイルは、AIが作った下書きと、店長が直して公開したシフトを比べて、
// 「店長はこう直す」を覚えるためのファイルです（2026年11月5日）。
//
// 覚えること（1つずつ「学び」として保存する）：
//   time   … 時間を直した（例：AIは 6:30〜15:30 → 店長が 7:00〜16:00 に）
//   remove … AIが入れた人を、店長が外した
//   add    … AIが入れなかった人を、店長が足した
//   area   … 場所を変えた（ホール ⇔ キッチン）
// 曜日ごとに覚える（「月曜のスタッフAはいつも 7:00〜16:00」のように）。
//
// 使う所：
//   ・simple-draft.js … 2回以上同じ直しがあれば、次の下書きから最初からそうする
//   ・prompt.js       … Gemini に「店長の直し方メモ」として渡す
//   ・screens/ai.js   … 「AIが覚えたこと」の一覧（店長が消せる）
// ============================================================

import { range } from "../lib/time.js";

/** 曜日の名前（0＝日曜…6＝土曜。Date の getDay と同じ順） */
export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

/** 何回同じ直しがあったら「覚えた」とするか（1回だけはたまたまかもしれない） */
export const LEARN_MIN_COUNT = 2;

/** 何分以上ちがったら「時間を直した」とするか（15分の少しのずれは数えない） */
const TIME_DIFF_MIN = 15;

/** 日付（"2026-11-09"）から曜日の番号（0＝日曜） */
export function weekdayOf(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

/**
 * AIの下書きと、公開したシフトを比べて「学び」を作る
 * @param {object[]} aiRows     AIが作った下書き（勤務の一覧）
 * @param {object[]} finalRows  店長が直して公開した勤務の一覧
 * @returns {object[]} 学びの一覧 {memberId, weekday, kind, from, to, aiFrom, aiTo, area, aiArea, date}
 */
export function diffDraft(aiRows, finalRows) {
  const out = [];                                             // 見つけた学び
  const key = (shift) => `${shift.memberId}|${shift.date}`;                 // 人と日で1つにまとめる
  const group = (rows) => {                                     // 人と日ごとの勤務（固定したものは比べない）
    const map = new Map();   // 人と日 → 勤務の一覧
    for (const shift of rows) {
      if (shift.fixed) continue;
      if (!map.has(key(shift))) map.set(key(shift), []);
      map.get(key(shift)).push(shift);
    }
    return map;
  };
  const ai = group(aiRows);                                     // AIの下書き
  const fin = group(finalRows);                                 // 公開したもの
  const allKeys = new Set([...ai.keys(), ...fin.keys()]);       // どちらかにある人と日

  for (const key of allKeys) {
    const [memberId, date] = key.split("|");   // 人のIDと日付
    const before = (ai.get(key) || []).sort((shiftA, shiftB) => shiftA.from - shiftB.from)[0];   // AIの1つ目の勤務
    const after = (fin.get(key) || []).sort((shiftA, shiftB) => shiftA.from - shiftB.from)[0];   // 公開の1つ目の勤務
    const base = { memberId, date, weekday: weekdayOf(date) };              // どの学びにも入る情報
    if (before && !after) {
      out.push({ ...base, kind: "remove", aiFrom: before.from, aiTo: before.to });
    } else if (!before && after) {
      out.push({ ...base, kind: "add", from: after.from, to: after.to, area: after.area });
    } else if (before && after) {
      const moved = Math.abs(before.from - after.from) >= TIME_DIFF_MIN || Math.abs(before.to - after.to) >= TIME_DIFF_MIN;   // 始まりか終わりが15分以上ちがうか
      if (moved) out.push({ ...base, kind: "time", from: after.from, to: after.to, aiFrom: before.from, aiTo: before.to });
      if (before.area !== after.area) out.push({ ...base, kind: "area", area: after.area, aiArea: before.area });
    }
  }
  return out;
}

/**
 * たまった学びをまとめる（同じ人・同じ曜日・同じ直し方を数える）
 * @param {object[]} learnings  保存してある学び
 * @param {object[]} members    店員（名前を出すため）
 * @returns {{
 *   notes: {key:string, text:string, count:number, strong:boolean, ids:string[]}[],
 *   prefer: Map<string,{from:number,to:number,count:number,area?:string}>,
 *   avoid: Map<string,number>,
 *   areaPref: Map<string,string>
 * }}
 *   notes    … 画面とAIに見せる文（強い＝2回以上）
 *   prefer   … 「人|曜日」→ 店長がよく入れる時間（下書きで使う）
 *   avoid    … 「人|曜日」→ 店長が外した回数
 *   areaPref … 人 → 店長がよく変える先の場所
 */
export function summarize(learnings, members) {
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "？";   // 人の名前
  const groups = new Map();                                                 // まとめた学び
  const add = (key, row, make) => {                                           // 同じ種類の学びを数える
    if (!groups.has(key)) groups.set(key, { ...make(), count: 0, ids: [], rows: [] });
    const group = groups.get(key);   // 今数えている学びのまとまり
    group.count++;
    group.ids.push(row.id);
    group.rows.push(row);
  };

  for (const hope of learnings) {
    const who = `${hope.memberId}|${hope.weekday}`;                               // 人と曜日
    if (hope.kind === "time" || hope.kind === "add") {
      add(`t|${who}|${hope.from}|${hope.to}`, hope, () => ({ type: "time", memberId: hope.memberId, weekday: hope.weekday, from: hope.from, to: hope.to, area: hope.area }));
    } else if (hope.kind === "remove") {
      add(`r|${who}`, hope, () => ({ type: "remove", memberId: hope.memberId, weekday: hope.weekday }));
    } else if (hope.kind === "area") {
      add(`a|${hope.memberId}|${hope.area}`, hope, () => ({ type: "area", memberId: hope.memberId, area: hope.area }));
    }
  }

  const notes = [];                                       // 画面・AI向けの文
  const prefer = new Map();                               // よく入れる時間
  const avoid = new Map();                                // よく外す
  const areaPref = new Map();                             // よく変える場所
  for (const [key, shift] of groups) {
    const strong = shift.count >= LEARN_MIN_COUNT;            // 2回以上＝覚えた
    const day = `${WEEKDAY_LABEL[shift.weekday]}曜`;          // 曜日の文字
    let text = "";                                        // 1行の説明
    if (shift.type === "time") {
      text = `${nameOf(shift.memberId)}：${day}は ${range(shift.from, shift.to)} にする`;
      const pk = `${shift.memberId}|${shift.weekday}`;   // 「人|曜日」のキー
      if (strong && (!prefer.has(pk) || prefer.get(pk).count < shift.count)) prefer.set(pk, { from: shift.from, to: shift.to, count: shift.count, area: shift.area });
    } else if (shift.type === "remove") {
      text = `${nameOf(shift.memberId)}：${day}は入れないことが多い`;
      if (strong) avoid.set(`${shift.memberId}|${shift.weekday}`, shift.count);
    } else if (shift.type === "area") {
      text = `${nameOf(shift.memberId)}：${shift.area === "hall" ? "ホール" : "キッチン"}に入れる`;
      if (strong) areaPref.set(shift.memberId, shift.area);
    }
    notes.push({ key: key, text, count: shift.count, strong, ids: shift.ids });
  }
  notes.sort((noteA, noteB) => noteB.count - noteA.count);
  return { notes, prefer, avoid, areaPref };
}
