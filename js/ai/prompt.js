// ============================================================
// ai/prompt.js — Gemini に送る文（プロンプト）を作る
// ------------------------------------------------------------
// このファイルは、シフトを作るのに必要なこと（人・希望・必要人数・ルール・
// 店長の直し方メモ）をまとめて、Gemini に送る文と答えの形を作るファイルです（2026年11月5日）。
//
// 個人情報を守るために：
//   ・名前は送らない。「S1」「S2」のような番号に置きかえる
//   ・人ごとのルールの文の中に名前があれば、それも番号に置きかえる
//   ・時給・交通費は送らない
//   （Gemini の無料枠では、送った内容が Google のサービス改善に使われることがあるため）
//
// 2つの使い方：
//   buildDraftPrompt … 新しく下書きを作る（簡易版の下書きを「たたき台」として渡し、よくしてもらう）
//   buildFixPrompt   … 今のシフトの「守れていないルール」だけ直してもらう
// ============================================================

import { fmt } from "../lib/time.js";   // 時間の表示の道具を読む
import { requiredAt } from "../rules/shift-rules.js";   // その時間の必要人数を出す道具を読む
import { openStart } from "../lib/roles.js";   // 立ち上げの時間を出す道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { WEEKDAY_LABEL, weekdayOf } from "./learning.js";   // 曜日の道具を読む

/** 答えの形（Gemini の responseSchema）：勤務の一覧＋全体のひとこと */
export const SHIFT_SCHEMA = {   // AIの答えの形の決まり
  type: "OBJECT",   // 中身はオブジェクト
  properties: {   // 入るもの
    shifts: {   // 勤務の一覧
      type: "ARRAY",   // 配列
      items: {   // 1つずつの形
        type: "OBJECT",   // オブジェクト
        properties: {   // 入るもの
          staff: { type: "STRING", description: "S1 などの番号" },   // 人の番号
          date: { type: "STRING", description: "YYYY-MM-DD" },   // 日付
          start: { type: "STRING", description: "HH:MM（24時をこえる時は 25:00 のように）" },   // 始まり
          end: { type: "STRING", description: "HH:MM" },   // 終わり
          area: { type: "STRING", enum: ["hall", "kitchen"] },   // 場所
          break: { type: "STRING", description: "休憩の時刻 HH:MM。なければ空" },   // 休憩
          reason: { type: "STRING", description: "この勤務にした理由（日本語・30文字まで）" },   // 理由
        },
        required: ["staff", "date", "start", "end", "area"],   // 必ず入れるもの
      },
    },
    summary: { type: "STRING", description: "店長への全体のひとこと（日本語・100文字まで）" },   // 店長へのひとこと
    concerns: { type: "ARRAY", items: { type: "STRING" }, description: "どうしても守れなかったこと（日本語）" },   // 守れなかったこと
  },
  required: ["shifts", "summary"],   // 必ず入れるもの
};

/** 分 → "06:30"（AIに渡す形。24時をこえても 25:00 のまま） */
export const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;   // 分を「09:30」の形にする

/** 立場の英語の名前 → AIに渡す日本語 */
const KIND_TEXT = { shain: "社員", baito: "バイト", full: "フルで入るバイト" };   // 立場の文字

/**
 * 名前 ⇔ 番号（S1…）の表を作る
 * @param {object[]} members 店員
 * @returns {{toAlias:Map<string,string>, toId:Map<string,string>}} id→番号 と 番号→id
 */
export function makeAliases(members) {   // 名前を S1, S2… にかえる表を作る関数
  const toAlias = new Map();                            // 店員のID → S1
  const toId = new Map();                               // S1 → 店員のID
  members.forEach((member, index) => { toAlias.set(member.id, `S${index + 1}`); toId.set(`S${index + 1}`, member.id); });   // 番号を付ける
  return { toAlias, toId };   // 名前→番号と番号→ID の表を返す
}

/** 文の中の名前を番号に置きかえる（人ごとのルールの文など） */
function hideNames(text, members, toAlias) {   // 文の中の名前を番号にかえる関数
  let out = text || "";                                 // 置きかえた文
  // 長い名前から置きかえる（「スタッフAA」より先に「スタッフA」を置きかえないように）
  [...members].sort((memberA, memberB) => memberB.name.length - memberA.name.length)   // 長い名前から先にかえる
    .forEach((member) => { out = out.split(member.name).join(toAlias.get(member.id)); });   // 名前を番号にする
  return out;   // かえた文を返す
}

/**
 * 必要人数を「時間帯ごとの人数」にまとめる（例 07:00-11:00 1人, 11:00-14:00 2人）
 * @returns {string} 1行の文
 */
function needLine(ctx, date, area) {   // 必要人数の1行を作る関数
  const type = ctx.dayTypeOf(date);                     // 平日／土曜／日曜祝日
  const hrs = ctx.hoursOf(date);                        // 営業時間
  const parts = [];                                     // 時間帯ごとの文
  let start = hrs.open;                                 // 今まとめている時間帯の始まり
  let count = requiredAt(ctx.requirements, ctx.positions, type, area, hrs.open);   // その人数
  for (let minutes = hrs.open + 15; minutes <= hrs.close; minutes += 15) {   // 15分ごとに
    const need = minutes < hrs.close ? requiredAt(ctx.requirements, ctx.positions, type, area, minutes) : -1;   // この15分の必要人数（閉店の時は -1 で最後をしめる）
    if (need !== count) {   // 人数が変わったら
      if (count > 0) parts.push(`${hhmm(start)}-${hhmm(minutes)} ${count}人`);   // 前の区切りを書く
      start = minutes; count = need;   // 新しい区切りを始める
    }
  }
  return parts.join(", ") || "なし";   // つないで返す
}

/** 1人分の希望を文にする */
function hopeText(hope) {   // 希望を文にする関数
  if (!hope) return "希望なし";   // 希望がない
  return { no: "入れない", off: "休み希望", offx: "休み希望（2日目。店長の特別許可待ち。休みにしておく）", any: "いつでもOK" }[hope.kind]   // 種類ごとの文
    || `${hhmm(hope.from)}-${hhmm(hope.to)} なら入れる`;   // 時間の希望
}

/** 勤務の一覧を、AIに渡す行の形にする */
function shiftLines(rows, toAlias) {   // 今の勤務を1行ずつの文にする関数
  return rows   // 返す
    .filter((row) => toAlias.has(row.memberId))   // 番号がある人だけ
    .sort((rowA, rowB) => rowA.date.localeCompare(rowB.date) || rowA.from - rowB.from)   // 日と時間の順
    .map((row) => `${toAlias.get(row.memberId)} ${row.date} ${hhmm(row.from)}-${hhmm(row.to)} ${row.area}${row.breakAt != null ? ` 休憩${hhmm(row.breakAt)}` : ""}${row.fixed ? " 【固定・変えない】" : ""}`)   // 「S1 日付 時間 場所 休憩」
    .join("\n");   // 改行でつなぐ
}

/**
 * どちらの使い方でも同じ「お店の情報」の部分
 * @param {object} ctx  シフト作成の画面から渡す情報（draft-service.js の説明を見る）
 * @param {Map} toAlias 店員のID → S1
 */
function storeFacts(ctx, toAlias) {   // お店の情報の文を作る関数
  const lines = [];                                     // 送る文の行
  // ---- 店員 ----
  lines.push("## 店員（名前は番号にしています）");   // 店員の見出し
  for (const member of ctx.members) {   // 店員ごとに
    const hours = member.skills || {};   // できること％
    const helper = (member.rankHere ?? 1) > 1 ? `・この店舗は${member.rankHere >= 9 ? "この週だけ応援" : `${member.rankHere}番目の店舗（応援）`}` : "・この店舗がメイン";   // この店舗がメインか応援か
    const rule = ctx.rules?.find((row) => row.memberId === member.id)?.text;                       // 人ごとのルール
    lines.push(`${toAlias.get(member.id)}: ${KIND_TEXT[member.kind] || member.kind}${member.everyday ? "・毎日入る人" : ""}${helper} / できること ホール${hours.hall ?? 0}% キッチン${hours.kitchen ?? 0}% 立ち上げ${hours.open ?? 0}% 締め${hours.close ?? 0}%`   // 番号・立場・できること
      + (member.minor ? " / 18歳未満（22:00〜05:00は入れない）" : "")                                             // 法律の決まり
      + (member.leftMinutes != null ? ` / この週はあと${Math.floor(member.leftMinutes / 60)}時間まで（月・年の上限）` : "")   // 扶養などの上限
      + (rule ? ` / 店長のメモ: ${hideNames(rule, ctx.members, toAlias)}` : ""));   // 店長のメモ
  }
  // ---- 日ごと：営業時間・必要人数・希望 ----
  lines.push("\n## 日ごとの営業時間・必要人数・希望");   // 日ごとの見出し
  for (const date of ctx.dates) {   // 日ごとに
    const hrs = ctx.hoursOf(date);   // その日の営業時間
    lines.push(`### ${date}（${WEEKDAY_LABEL[weekdayOf(date)]}） 営業 ${hhmm(hrs.open)}-${hhmm(hrs.close)}（立ち上げの人は ${hhmm(openStart(hrs))} から）`);   // 営業時間と立ち上げの時間
    lines.push(`必要人数 ホール: ${needLine(ctx, date, "hall")}`);   // ホールの必要人数
    lines.push(`必要人数 キッチン: ${needLine(ctx, date, "kitchen")}`);   // キッチンの必要人数
    const hopes = ctx.members.map((member) => `${toAlias.get(member.id)}=${hopeText(ctx.availabilities.find((hope) => hope.memberId === member.id && hope.date === date))}`);   // 全員のその日の希望
    lines.push(`希望: ${hopes.join(" / ")}`);   // 希望
    const busy = (ctx.elsewhere || []).filter((shift) => shift.date === date && toAlias.has(shift.memberId));   // その日ほかの店舗に入っている勤務
    if (busy.length) lines.push(`ほかの店舗に入っている（この時間は入れない）: ${busy.map((shift) => `${toAlias.get(shift.memberId)} ${hhmm(shift.from)}-${hhmm(shift.to)}`).join(" / ")}`);   // ほかの店舗に入っている人
  }
  // ---- 店長の直し方メモ（学び） ----
  const notes = (ctx.learned?.notes || []).slice(0, 40);                                   // 多すぎないように
  if (notes.length) {   // 覚えたことがあれば
    lines.push("\n## 店長のいつもの直し方（前に店長がAIの下書きを直した記録。回数が多いものほど大事）");   // 見出し
    notes.forEach((note) => lines.push(`- ${hideNames(note.text, ctx.members, toAlias)}（${note.count}回）`));   // 1つずつ書く
  }
  // ---- 過去のシフトのいつもの形（2026年11月22日） ----
  const patterns = (ctx.learned?.patternNotes || []).slice(0, 60);   // 多すぎないように
  if (patterns.length) {   // あれば
    lines.push("\n## 過去のシフトのいつもの形（前の数週間に公開したシフト。希望とルールに合えば、この形を優先する）");   // 見出し
    patterns.forEach((note) => lines.push(`- ${hideNames(note.text, ctx.members, toAlias)}（${note.weeks}週中${note.count}週）`));   // 1つずつ書く
  }
  return lines.join("\n");   // 改行でつないで返す
}

/** ルール（全部の店舗で同じ。店長と決めたもの） */
function rulesText() {   // 守るルールの文を作る関数
  return `## 必ず守るルール
1. 希望が「入れない」「休み希望」の日には入れない。時間の希望がある人は、その時間の中だけ（短くするのはよい）
2. バイト・フルで入るバイトは、希望を出した日だけ入れる。社員は希望がなくても入れてよい
3. 全員、週に1日は必ず休み
4. 社員：休み希望がない人は、休みは週1日だけ。休み希望がある人は、その日を休みにする
5. 立ち上げは1日1人。開店の${CONFIG.OPEN_PREP_MIN}分前から入る人が立ち上げ。立ち上げ100%の人がよい
6. 締めは閉店まで入る人。締め100%の人がよい
7. ${CONFIG.BREAK_NEEDED_MIN / 60}時間以上の勤務には休憩を入れる。休憩は${fmt(CONFIG.BREAK_EARLIEST)}より前には入れない。勤務の始まりと終わりの15分以内にも入れない
8. 同じ人を同じ時間に2つ入れない。ほかの店舗に入っている時間には入れない
8-2. 「18歳未満」の人は 22:00〜05:00 に入れない。「この週はあと〇時間まで」の人は、その時間をこえない
8-3. ${CONFIG.MAX_STREAK_DAYS}日より多く続けて入れない
9. 時刻は1時間ごと（9:00・10:00 のように、分は入れない）。立ち上げの人だけ開店の${CONFIG.OPEN_PREP_MIN}分前から（例 6:30〜15:30）。1回の勤務は3時間以上・${CONFIG.MAX_SHIFT_MINUTES / 60}時間まで（休憩こみ）
10. 【固定・変えない】の勤務はそのまま残す

## 人を選ぶ順番（希望がかぶった時）
1. 毎日入る人・フルで入るバイト
2. できる％が高い人
3. いつもその時間に入っている人（店長のいつもの直し方も見る）
人が足りない時は、社員を足してよい。それでも足りなければ、この店舗が2番目・3番目の店舗の人（応援）を希望の中で入れる。
必要人数より多く入れすぎない（人件費のため）。`;   // ルールの最後
}

/**
 * 新しく下書きを作る文
 * @param {object} ctx  draft-service.js の ctx
 * @param {object[]} baseline 簡易版の下書き（たたき台）
 * @returns {{prompt:string, schema:object, toId:Map}}
 */
export function buildDraftPrompt(ctx, baseline) {   // 下書きを頼む文を作る関数
  const { toAlias, toId } = makeAliases(ctx.members);   // ID ⇔ 番号の表
  // Gemini に送る文（下書きを作る）
  const prompt = `あなたは飲食店（喫茶店）のシフトを作る係です。下の情報から、${ctx.dates[0]} から ${ctx.dates[ctx.dates.length - 1]} の1週間のシフトを作ってください。

${rulesText()}

${storeFacts(ctx, toAlias)}

## たたき台（簡単な計算で作った下書き。ルールを守りながら、もっとよくしてください）
${shiftLines(baseline, toAlias) || "なし"}

## 答え方
- shifts に1週間分の勤務を全部入れる（たたき台から変えない勤務も全部入れる）
- 足りない時間をなくすこと、ルールを守ること、店長のいつもの直し方に合わせることを大事にする
- reason には、その人・その時間にした理由を短く書く（例「立ち上げ100%」「希望どおり」「夕方が足りない」）
- summary に店長へのひとことを書く。concerns に、どうしても守れなかったことを書く`;   // 答え方の最後
  return { prompt, schema: SHIFT_SCHEMA, toId };   // 文・答えの形・番号の表を返す
}

/**
 * 今のシフトの問題だけ直してもらう文
 * @param {object} ctx       draft-service.js の ctx
 * @param {object[]} current 今のシフト
 * @param {{day:string,text:string}[]} problems 守れていないルール
 */
export function buildFixPrompt(ctx, current, problems) {   // 直すのを頼む文を作る関数
  const { toAlias, toId } = makeAliases(ctx.members);   // ID ⇔ 番号の表
  const probText = problems.map((problem) => `- ${problem.day}: ${hideNames(problem.text, ctx.members, toAlias)}`).join("\n");   // 守れていないルールの一覧（名前は番号に）
  // Gemini に送る文（問題だけ直す）
  const prompt = `あなたは飲食店（喫茶店）のシフトを直す係です。今のシフトには、下の「守れていないルール」があります。
これを直してください。直す必要のない勤務は、なるべく変えないでください（店長が手で直した所かもしれないため）。

## 守れていないルール
${probText}

${rulesText()}

${storeFacts(ctx, toAlias)}

## 今のシフト
${shiftLines(current, toAlias) || "なし"}

## 答え方
- shifts に、直したあとの1週間分の勤務を全部入れる（変えない勤務も全部入れる）
- reason には、変えた勤務だけ、変えた理由を短く書く（変えない勤務は空でよい）
- summary に何をどう直したかを書く。直せなかったことは concerns に書く`;   // 答え方の最後
  return { prompt, schema: SHIFT_SCHEMA, toId };   // 文・答えの形・番号の表を返す
}
