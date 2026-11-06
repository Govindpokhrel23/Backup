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

import { range } from "../lib/time.js";   // 時間の表示の道具を読む

/** 曜日の名前（0＝日曜…6＝土曜。Date の getDay と同じ順） */
export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];   // 曜日の文字

/** 何回同じ直しがあったら「覚えた」とするか（1回だけはたまたまかもしれない） */
export const LEARN_MIN_COUNT = 2;   // 2回同じ直しがあれば「覚えた」

/** 何分以上ちがったら「時間を直した」とするか（15分の少しのずれは数えない） */
const TIME_DIFF_MIN = 15;   // 15分以上ずれたら時間を直したとみなす

/** 日付（"2026-11-09"）から曜日の番号（0＝日曜） */
export function weekdayOf(date) {   // 日付から曜日の番号を出す関数
  return new Date(`${date}T00:00:00`).getDay();   // 0＝日曜
}

/**
 * AIの下書きと、公開したシフトを比べて「学び」を作る
 * @param {object[]} aiRows     AIが作った下書き（勤務の一覧）
 * @param {object[]} finalRows  店長が直して公開した勤務の一覧
 * @returns {object[]} 学びの一覧 {memberId, weekday, kind, from, to, aiFrom, aiTo, area, aiArea, date}
 */
export function diffDraft(aiRows, finalRows) {   // AIの下書きと公開したシフトのちがいを出す関数
  const out = [];                                             // 見つけた学び
  const key = (shift) => `${shift.memberId}|${shift.date}`;                 // 人と日で1つにまとめる
  const group = (rows) => {                                     // 人と日ごとの勤務（固定したものは比べない）
    const map = new Map();   // 人と日 → 勤務の一覧
    for (const shift of rows) {   // 勤務を1つずつ
      if (shift.fixed) continue;   // 店長が固定したものは数えない
      if (!map.has(key(shift))) map.set(key(shift), []);   // なければ入れ物を作る
      map.get(key(shift)).push(shift);   // 人と日ごとに入れる
    }
    return map;   // できた表を返す
  };
  const ai = group(aiRows);                                     // AIの下書き
  const fin = group(finalRows);                                 // 公開したもの
  const allKeys = new Set([...ai.keys(), ...fin.keys()]);       // どちらかにある人と日

  for (const key of allKeys) {   // 人と日ごとに
    const [memberId, date] = key.split("|");   // 人のIDと日付
    const before = (ai.get(key) || []).sort((shiftA, shiftB) => shiftA.from - shiftB.from)[0];   // AIの1つ目の勤務
    const after = (fin.get(key) || []).sort((shiftA, shiftB) => shiftA.from - shiftB.from)[0];   // 公開の1つ目の勤務
    const base = { memberId, date, weekday: weekdayOf(date) };              // どの学びにも入る情報
    if (before && !after) {   // AIにあって公開にない → 外した
      out.push({ ...base, kind: "remove", aiFrom: before.from, aiTo: before.to });   // 「外した」を記録
    } else if (!before && after) {   // AIになくて公開にある → 足した
      out.push({ ...base, kind: "add", from: after.from, to: after.to, area: after.area });   // 「足した」を記録
    } else if (before && after) {   // 両方にある
      const moved = Math.abs(before.from - after.from) >= TIME_DIFF_MIN || Math.abs(before.to - after.to) >= TIME_DIFF_MIN;   // 始まりか終わりが15分以上ちがうか
      if (moved) out.push({ ...base, kind: "time", from: after.from, to: after.to, aiFrom: before.from, aiTo: before.to });   // 時間が変わっていたら記録
      if (before.area !== after.area) out.push({ ...base, kind: "area", area: after.area, aiArea: before.area });   // 場所が変わっていたら記録
    }
  }
  return out;   // ちがいの一覧を返す
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
export function summarize(learnings, members) {   // 覚えたことをまとめる関数
  const nameOf = (id) => members.find((member) => member.id === id)?.name || "？";   // 人の名前
  const groups = new Map();                                                 // まとめた学び
  const add = (key, row, make) => {                                           // 同じ種類の学びを数える
    if (!groups.has(key)) groups.set(key, { ...make(), count: 0, ids: [], rows: [] });   // なければ入れ物を作る
    const group = groups.get(key);   // 今数えている学びのまとまり
    group.count++;   // 回数を1つ足す
    group.ids.push(row.id);   // IDを足す
    group.rows.push(row);   // 中身を足す
  };

  for (const learning of learnings) {   // 覚えたことを1つずつ
    const who = `${learning.memberId}|${learning.weekday}`;                               // 人と曜日
    if (learning.kind === "time" || learning.kind === "add") {   // 時間を直した・足した
      add(`t|${who}|${learning.from}|${learning.to}`, learning, () => ({ type: "time", memberId: learning.memberId, weekday: learning.weekday, from: learning.from, to: learning.to, area: learning.area }));   // 同じ人・曜日・時間でまとめる
    } else if (learning.kind === "remove") {   // 外した
      add(`r|${who}`, learning, () => ({ type: "remove", memberId: learning.memberId, weekday: learning.weekday }));   // 同じ人・曜日でまとめる
    } else if (learning.kind === "area") {   // 場所を変えた
      add(`a|${learning.memberId}|${learning.area}`, learning, () => ({ type: "area", memberId: learning.memberId, area: learning.area }));   // 同じ人・場所でまとめる
    }
  }

  const notes = [];                                       // 画面・AI向けの文
  const prefer = new Map();                               // よく入れる時間
  const avoid = new Map();                                // よく外す
  const areaPref = new Map();                             // よく変える場所
  for (const [key, group] of groups) {   // まとまりごとに
    const strong = group.count >= LEARN_MIN_COUNT;            // 2回以上＝覚えた
    const day = `${WEEKDAY_LABEL[group.weekday]}曜`;          // 曜日の文字
    let text = "";                                        // 1行の説明
    if (group.type === "time") {   // 時間なら
      text = `${nameOf(group.memberId)}：${day}は ${range(group.from, group.to)} にする`;   // 説明の文
      const pk = `${group.memberId}|${group.weekday}`;   // 「人|曜日」のキー
      if (strong && (!prefer.has(pk) || prefer.get(pk).count < group.count)) prefer.set(pk, { from: group.from, to: group.to, count: group.count, area: group.area });   // 覚えたなら、一番多い時間を残す
    } else if (group.type === "remove") {   // 外したなら
      text = `${nameOf(group.memberId)}：${day}は入れないことが多い`;   // 説明の文
      if (strong) avoid.set(`${group.memberId}|${group.weekday}`, group.count);   // 覚えたなら「入れない」に足す
    } else if (group.type === "area") {   // 場所なら
      text = `${nameOf(group.memberId)}：${group.area === "hall" ? "ホール" : "キッチン"}に入れる`;   // 説明の文
      if (strong) areaPref.set(group.memberId, group.area);   // 覚えたなら場所を残す
    }
    notes.push({ key, text, count: group.count, strong, ids: group.ids });   // 説明に足す
  }
  notes.sort((noteA, noteB) => noteB.count - noteA.count);   // 回数が多い順
  return { notes, prefer, avoid, areaPref };   // 説明・時間・入れない・場所を返す
}
