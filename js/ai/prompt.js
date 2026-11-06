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

import { fmt } from "../lib/time.js";
import { requiredAt } from "../rules/shift-rules.js";
import { openStart } from "../lib/roles.js";
import { CONFIG } from "../config.js";
import { WEEKDAY_LABEL, weekdayOf } from "./learning.js";

/** 答えの形（Gemini の responseSchema）：勤務の一覧＋全体のひとこと */
export const SHIFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    shifts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          staff: { type: "STRING", description: "S1 などの番号" },
          date: { type: "STRING", description: "YYYY-MM-DD" },
          start: { type: "STRING", description: "HH:MM（24時をこえる時は 25:00 のように）" },
          end: { type: "STRING", description: "HH:MM" },
          area: { type: "STRING", enum: ["hall", "kitchen"] },
          break: { type: "STRING", description: "休憩の時刻 HH:MM。なければ空" },
          reason: { type: "STRING", description: "この勤務にした理由（日本語・30文字まで）" },
        },
        required: ["staff", "date", "start", "end", "area"],
      },
    },
    summary: { type: "STRING", description: "店長への全体のひとこと（日本語・100文字まで）" },
    concerns: { type: "ARRAY", items: { type: "STRING" }, description: "どうしても守れなかったこと（日本語）" },
  },
  required: ["shifts", "summary"],
};

/** 分 → "06:30"（AIに渡す形。24時をこえても 25:00 のまま） */
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** 立場の英語の名前 → AIに渡す日本語 */
const KIND_TEXT = { shain: "社員", baito: "バイト", full: "フルで入るバイト" };

/**
 * 名前 ⇔ 番号（S1…）の表を作る
 * @param {object[]} members 店員
 * @returns {{toAlias:Map<string,string>, toId:Map<string,string>}} id→番号 と 番号→id
 */
export function makeAliases(members) {
  const toAlias = new Map();                            // 店員のID → S1
  const toId = new Map();                               // S1 → 店員のID
  members.forEach((m, i) => { toAlias.set(m.id, `S${i + 1}`); toId.set(`S${i + 1}`, m.id); });
  return { toAlias, toId };
}

/** 文の中の名前を番号に置きかえる（人ごとのルールの文など） */
function hideNames(text, members, toAlias) {
  let out = text || "";                                 // 置きかえた文
  // 長い名前から置きかえる（「スタッフAA」より先に「スタッフA」を置きかえないように）
  [...members].sort((a, b) => b.name.length - a.name.length)
    .forEach((m) => { out = out.split(m.name).join(toAlias.get(m.id)); });
  return out;
}

/**
 * 必要人数を「時間帯ごとの人数」にまとめる（例 07:00-11:00 1人, 11:00-14:00 2人）
 * @returns {string} 1行の文
 */
function needLine(ctx, date, area) {
  const type = ctx.dayTypeOf(date);                     // 平日／土曜／日曜祝日
  const hrs = ctx.hoursOf(date);                        // 営業時間
  const parts = [];                                     // 時間帯ごとの文
  let start = hrs.open;                                 // 今まとめている時間帯の始まり
  let count = requiredAt(ctx.requirements, ctx.positions, type, area, hrs.open);   // その人数
  for (let m = hrs.open + 15; m <= hrs.close; m += 15) {
    const n = m < hrs.close ? requiredAt(ctx.requirements, ctx.positions, type, area, m) : -1;   // この15分の必要人数（閉店の時は -1 で最後をしめる）
    if (n !== count) {
      if (count > 0) parts.push(`${hhmm(start)}-${hhmm(m)} ${count}人`);
      start = m; count = n;
    }
  }
  return parts.join(", ") || "なし";
}

/** 1人分の希望を文にする */
function hopeText(h) {
  if (!h) return "希望なし";
  return { no: "入れない", off: "休み希望", offx: "休み希望（2日目。店長の特別許可待ち。休みにしておく）", any: "いつでもOK" }[h.kind]
    || `${hhmm(h.from)}-${hhmm(h.to)} なら入れる`;
}

/** 勤務の一覧を、AIに渡す行の形にする */
function shiftLines(rows, toAlias) {
  return rows
    .filter((a) => toAlias.has(a.memberId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
    .map((a) => `${toAlias.get(a.memberId)} ${a.date} ${hhmm(a.from)}-${hhmm(a.to)} ${a.area}${a.breakAt != null ? ` 休憩${hhmm(a.breakAt)}` : ""}${a.fixed ? " 【固定・変えない】" : ""}`)
    .join("\n");
}

/**
 * どちらの使い方でも同じ「お店の情報」の部分
 * @param {object} ctx  シフト作成の画面から渡す情報（draft-service.js の説明を見る）
 * @param {Map} toAlias 店員のID → S1
 */
function storeFacts(ctx, toAlias) {
  const lines = [];                                     // 送る文の行
  // ---- 店員 ----
  lines.push("## 店員（名前は番号にしています）");
  for (const m of ctx.members) {
    const s = m.skills || {};   // できること％
    const helper = (m.rankHere ?? 1) > 1 ? `・この店舗は${m.rankHere >= 9 ? "この週だけ応援" : `${m.rankHere}番目の店舗（応援）`}` : "・この店舗がメイン";   // この店舗がメインか応援か
    const rule = ctx.rules?.find((r) => r.memberId === m.id)?.text;                       // 人ごとのルール
    lines.push(`${toAlias.get(m.id)}: ${KIND_TEXT[m.kind] || m.kind}${m.everyday ? "・毎日入る人" : ""}${helper} / できること ホール${s.hall ?? 0}% キッチン${s.kitchen ?? 0}% 立ち上げ${s.open ?? 0}% 締め${s.close ?? 0}%`
      + (m.minor ? " / 18歳未満（22:00〜05:00は入れない）" : "")                                             // 法律の決まり
      + (m.leftMinutes != null ? ` / この週はあと${Math.floor(m.leftMinutes / 60)}時間まで（月・年の上限）` : "")   // 扶養などの上限
      + (rule ? ` / 店長のメモ: ${hideNames(rule, ctx.members, toAlias)}` : ""));
  }
  // ---- 日ごと：営業時間・必要人数・希望 ----
  lines.push("\n## 日ごとの営業時間・必要人数・希望");
  for (const d of ctx.dates) {
    const hrs = ctx.hoursOf(d);   // その日の営業時間
    lines.push(`### ${d}（${WEEKDAY_LABEL[weekdayOf(d)]}） 営業 ${hhmm(hrs.open)}-${hhmm(hrs.close)}（立ち上げの人は ${hhmm(openStart(hrs))} から）`);
    lines.push(`必要人数 ホール: ${needLine(ctx, d, "hall")}`);
    lines.push(`必要人数 キッチン: ${needLine(ctx, d, "kitchen")}`);
    const hopes = ctx.members.map((m) => `${toAlias.get(m.id)}=${hopeText(ctx.availabilities.find((x) => x.memberId === m.id && x.date === d))}`);   // 全員のその日の希望
    lines.push(`希望: ${hopes.join(" / ")}`);
    const busy = (ctx.elsewhere || []).filter((a) => a.date === d && toAlias.has(a.memberId));   // その日ほかの店舗に入っている勤務
    if (busy.length) lines.push(`ほかの店舗に入っている（この時間は入れない）: ${busy.map((a) => `${toAlias.get(a.memberId)} ${hhmm(a.from)}-${hhmm(a.to)}`).join(" / ")}`);
  }
  // ---- 店長の直し方メモ（学び） ----
  const notes = (ctx.learned?.notes || []).slice(0, 40);                                   // 多すぎないように
  if (notes.length) {
    lines.push("\n## 店長のいつもの直し方（前に店長がAIの下書きを直した記録。回数が多いものほど大事）");
    notes.forEach((n) => lines.push(`- ${hideNames(n.text, ctx.members, toAlias)}（${n.count}回）`));
  }
  return lines.join("\n");
}

/** ルール（全部の店舗で同じ。店長と決めたもの） */
function rulesText() {
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
9. 時刻は15分きざみ。1回の勤務は3時間以上がよい
10. 【固定・変えない】の勤務はそのまま残す

## 人を選ぶ順番（希望がかぶった時）
1. 毎日入る人・フルで入るバイト
2. できる％が高い人
3. いつもその時間に入っている人（店長のいつもの直し方も見る）
人が足りない時は、社員を足してよい。それでも足りなければ、この店舗が2番目・3番目の店舗の人（応援）を希望の中で入れる。
必要人数より多く入れすぎない（人件費のため）。`;
}

/**
 * 新しく下書きを作る文
 * @param {object} ctx  draft-service.js の ctx
 * @param {object[]} baseline 簡易版の下書き（たたき台）
 * @returns {{prompt:string, schema:object, toId:Map}}
 */
export function buildDraftPrompt(ctx, baseline) {
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
- summary に店長へのひとことを書く。concerns に、どうしても守れなかったことを書く`;
  return { prompt, schema: SHIFT_SCHEMA, toId };
}

/**
 * 今のシフトの問題だけ直してもらう文
 * @param {object} ctx       draft-service.js の ctx
 * @param {object[]} current 今のシフト
 * @param {{day:string,text:string}[]} problems 守れていないルール
 */
export function buildFixPrompt(ctx, current, problems) {
  const { toAlias, toId } = makeAliases(ctx.members);   // ID ⇔ 番号の表
  const probText = problems.map((p) => `- ${p.day}: ${hideNames(p.text, ctx.members, toAlias)}`).join("\n");   // 守れていないルールの一覧（名前は番号に）
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
- summary に何をどう直したかを書く。直せなかったことは concerns に書く`;
  return { prompt, schema: SHIFT_SCHEMA, toId };
}
