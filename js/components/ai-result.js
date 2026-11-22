// ============================================================
// components/ai-result.js — 「AIの結果」のカード（シフト作成の一番上）
// ------------------------------------------------------------
// このファイルは、「AIで作成」「AIに直してもらう」のあとに、結果をひと目で分かるように
// 見せるカードのファイルです（2026年11月5日）。
//
// 見せるもの（上から大事な順）：
//   ① 大きな印：✓ ルールは全部守れています ／ ! 守れていないルール 〇件
//   ② 数字：足りない時間・入った人数・人件費の目安・使った店長の直し方
//   ③ AIのひとこと、どうしても守れなかったこと
//   ④ AIを使えなかった時は、その理由と「AIの設定へ」
//   ⑤ 開くと見られる：人ごとの理由、AIが外した勤務、前と変わった所
//   ⑥ ボタン：「残りをAIに直してもらう」「元に戻す」「閉じる」
// ============================================================

import { createElement } from "../lib/dom.js";   // 画面の部品の道具を読む
import { label } from "../lib/date.js";   // 日付の表示の道具を読む
import { range } from "../lib/time.js";   // 時間の表示の道具を読む

/**
 * @param {object} props
 * @param {object}   props.result      draft-service.js の結果（rows・source・summary…）
 * @param {"draft"|"fix"} props.kind   「AIで作成」か「AIに直してもらう」か
 * @param {object[]} props.members     店員（名前を出すため）
 * @param {object[]} props.problems    今の守れていないルール（{day,text}）
 * @param {object[]} props.before      AIの前の勤務（変わった所を出すため）
 * @param {string}   props.costText    人件費の目安（この週）
 * @param {boolean}  props.aiOn        本物のAIを使える設定か（「直してもらう」ボタンを出すか）
 * @param {()=>void} props.onFix       「残りをAIに直してもらう」
 * @param {()=>void} props.onUndo      「元に戻す」
 * @param {()=>void} props.onClose     「閉じる」
 * @param {()=>void} props.onSettings  「AIの設定へ」
 * @param {(date:string, memberId:string)=>void} props.onJump  理由を押した時、その日・その人を開く
 */
export function aiResultCard(props) {   // AIの結果のカードを作る関数
  const result = props.result;                                                  // AIの結果
  /** IDから名前 */
  const nameOf = (id) => props.members.find((member) => member.id === id)?.name || "？";   // 店員IDから名前
  const ok = props.problems.length === 0;                                  // ルールを全部守れているか
  const work = result.rows.filter((row) => !row.fixed);                         // AIが入れた勤務
  const people = new Set(result.rows.map((row) => row.memberId)).size;          // 入った人数
  const shortages = props.problems.filter((problem) => /足りない/.test(problem.text)).length;   // 人が足りない所の数
  const usedAi = result.source === "gemini";                                // 本物のAIの案を使ったか
  const changes = diffText(props.before, result.rows, nameOf);                  // 前と変わった所

  return createElement("section", { class: `card ai-result ${ok ? "is-ok" : "is-ng"}` },   // カード（OKなら緑、問題ありなら赤）
    // ---- 見出し ----
    createElement("div", { class: "ai-result__head" },   // 上の行
      createElement("h2", { class: "card__title" }, props.kind === "fix" ? "AIが直した結果" : "AIの結果"),   // 見出し
      createElement("span", { class: `badge ${usedAi ? "badge--hall" : ""}` }, usedAi ? `Gemini（${result.model}）` : "簡易版"),   // 使ったもの（Gemini か簡易版）
      createElement("button", { class: "btn btn--small ai-result__close", onclick: props.onClose, "aria-label": "閉じる" }, "×"),   // 閉じるボタン
    ),

    // ---- ① 大きな印 ----
    createElement("div", { class: "ai-result__big" },   // 大きい結果
      createElement("span", { class: "ai-result__mark", "aria-hidden": "true" }, ok ? "✓" : "!"),   // ✓ か !
      createElement("div", null,   // 文の部分
        createElement("strong", null, ok ? "ルールは全部守れています" : `守れていないルール ${props.problems.length}件`),   // 結果
        createElement("div", { class: "home-muted" }, ok ? "このまま公開できます。気になる所だけ直してください" : "赤い点の日を開いて直すか、下のボタンでAIに直してもらえます"))),   // 次にすること

    // ---- ② 数字 ----
    createElement("div", { class: "ai-result__stats" },   // 数字の箱
      stat("足りない時間", `${shortages}件`, shortages ? "ng" : "ok"),   // 足りない時間
      stat("入った人", `${people}人`),   // 入った人
      stat("勤務の数", `${work.length}`),   // 勤務の数
      stat("人件費（週）", props.costText),   // 人件費
      stat("店長の直し方", `${result.learnedCount}件 使用`),   // 使った店長の直し方
      stat("過去のいつもの形", `${result.patternCount || 0}件 使用`),   // 過去のシフトから学んだ形（2026年11月22日）
    ),

    // ---- ③ AIのひとこと ----
    result.summary ? createElement("div", { class: "ai-result__say" }, createElement("strong", null, "AIのひとこと"), result.summary) : null,   // AIのひとこと
    result.concerns?.length   // 守れなかったことがあれば
      ? createElement("div", { class: "notice notice--warn", style: { fontWeight: 400 } },   // 黄色のお知らせ
          createElement("strong", null, "どうしても守れなかったこと"), createElement("ul", null, result.concerns.map((concern) => createElement("li", null, concern))))   // 見出しと一覧
      : null,   // なければ何も出さない

    // ---- ④ AIを使えなかった理由 ----
    result.error || result.why   // エラーか理由があれば
      ? createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } },   // 青のお知らせ
          result.error ? `AIでエラー：${result.error}。かわりに簡易版で作りました。` : result.why,   // エラーの文か理由
          !usedAi && (result.error || /設定|鍵|URL/.test(result.why || "")) ? createElement("button", { class: "btn btn--small", onclick: props.onSettings, style: { marginLeft: "8px" } }, "AIの設定へ") : null)   // 設定の問題なら設定へのボタン
      : null,   // なければ何も出さない

    // ---- ⑤ くわしく ----
    reasonsBlock(result.rows, nameOf, props.onJump),   // AIの理由
    changes.length ? details(`前と変わった所（${changes.length}）`, createElement("ul", { class: "ai-result__list" }, changes.map((change) => createElement("li", null, change)))) : null,   // 前と変わった所
    result.dropped?.length ? details(`AIが入れたが、ルールに合わず外した勤務（${result.dropped.length}）`, createElement("ul", { class: "ai-result__list" }, result.dropped.map((reason) => createElement("li", null, reason)))) : null,   // 外した勤務

    // ---- ⑥ ボタン ----
    createElement("div", { class: "chip-row ai-result__actions" },   // ボタンの行
      !ok && props.aiOn ? createElement("button", { class: "btn btn--blue", onclick: props.onFix }, `残り${props.problems.length}件をAIに直してもらう`) : null,   // 問題があればAIに直してもらう
      createElement("button", { class: "btn", onclick: props.onUndo }, "↶ AIの前に戻す"),   // AIの前に戻す
      createElement("button", { class: "btn btn--primary", onclick: props.onClose }, "OK（この案で進める）"),   // この案で進める
    ),
  );
}

/** 数字の小さな箱 */
function stat(name, value, tone = "") {   // 数字の箱を作る関数
  return createElement("div", { class: `ai-stat ${tone ? `ai-stat--${tone}` : ""}` }, createElement("span", { class: "home-muted" }, name), createElement("strong", { class: "num" }, value));   // 名前と数字
}

/** 開くと見られる所（<details>） */
function details(title, body) {   // 開け閉めできる部分を作る関数
  return createElement("details", { class: "ai-result__more" }, createElement("summary", null, title), body);   // 見出しと中身
}

/** 人ごとの理由（日ごとにまとめる）。押すとその日・その人を開く */
function reasonsBlock(rows, nameOf, onJump) {   // AIの理由のまとまりを作る関数
  const withReason = rows.filter((row) => row.reason).sort((rowA, rowB) => rowA.date.localeCompare(rowB.date) || rowA.from - rowB.from);   // 理由がある勤務（日と時刻の順）
  if (!withReason.length) return null;   // 理由がなければ何も出さない
  const byDate = new Map();                                            // 日付 → その日の勤務
  withReason.forEach((shift) => { if (!byDate.has(shift.date)) byDate.set(shift.date, []); byDate.get(shift.date).push(shift); });   // 日ごとにまとめる
  return details(`なぜこの人・この時間？（AIの理由 ${withReason.length}件）`,   // 開け閉めできる部分
    [...byDate].map(([date, list]) => createElement("div", { class: "ai-result__day" },   // 日ごとに
      createElement("strong", null, label(date)),   // 日付
      createElement("ul", { class: "ai-result__list" }, list.map((shift) => createElement("li", null,   // 勤務ごとに
        createElement("button", { class: "link-btn", onclick: () => onJump(shift.date, shift.memberId) }, `${nameOf(shift.memberId)} ${range(shift.from, shift.to)}`),   // 押すとその日・その人へ移動
        `：${shift.reason}`))))));   // 理由
}

/**
 * 前と変わった所を文にする
 * 例「スタッフA 11/9（月）：7:00〜16:00 → 6:30〜15:30」「スタッフE 11/10（火）：足した」
 */
export function diffText(before, after, nameOf) {   // 前と後のちがいを文にする関数
  const key = (shift) => `${shift.memberId}|${shift.date}`;                        // 人と日
  const pack = (rows) => {                                             // 人と日 → 時間の文
    const map = new Map();   // 人と日 → 時間の文の一覧
    rows.forEach((row) => map.set(key(row), [...(map.get(key(row)) || []), range(row.from, row.to)]));   // 人と日ごとに時間をまとめる
    return map;   // 表を返す
  };
  const beforeMap = pack(before || []);   // 前の勤務
  const afterMap = pack(after || []);   // 後の勤務
  const out = [];   // 変わった所の文
  for (const key of new Set([...beforeMap.keys(), ...afterMap.keys()])) {   // 人と日ごとに
    const [id, date] = key.split("|");   // 人のIDと日付
    const was = (beforeMap.get(key) || []).join("・");                           // 前
    const now = (afterMap.get(key) || []).join("・");                           // 後
    if (was === now) continue;   // 同じなら飛ばす
    const who = `${nameOf(id)} ${label(date)}`;   // 「名前 日付」
    out.push(!was ? `${who}：${now} を足した` : !now ? `${who}：${was} を外した` : `${who}：${was} → ${now}`);   // 足した・外した・変えた
  }
  return out.sort();   // 並べて返す
}
