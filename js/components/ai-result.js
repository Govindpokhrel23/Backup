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

import { h } from "../lib/dom.js";
import { label } from "../lib/date.js";
import { range } from "../lib/time.js";

/**
 * @param {object} p
 * @param {object}   p.result      draft-service.js の結果（rows・source・summary…）
 * @param {"draft"|"fix"} p.kind   「AIで作成」か「AIに直してもらう」か
 * @param {object[]} p.members     店員（名前を出すため）
 * @param {object[]} p.problems    今の守れていないルール（{day,text}）
 * @param {object[]} p.before      AIの前の勤務（変わった所を出すため）
 * @param {string}   p.costText    人件費の目安（この週）
 * @param {boolean}  p.aiOn        本物のAIを使える設定か（「直してもらう」ボタンを出すか）
 * @param {()=>void} p.onFix       「残りをAIに直してもらう」
 * @param {()=>void} p.onUndo      「元に戻す」
 * @param {()=>void} p.onClose     「閉じる」
 * @param {()=>void} p.onSettings  「AIの設定へ」
 * @param {(date:string, memberId:string)=>void} p.onJump  理由を押した時、その日・その人を開く
 */
export function aiResultCard(p) {
  const r = p.result;                                                  // AIの結果
  /** IDから名前 */
  const nameOf = (id) => p.members.find((m) => m.id === id)?.name || "？";
  const ok = p.problems.length === 0;                                  // ルールを全部守れているか
  const work = r.rows.filter((a) => !a.fixed);                         // AIが入れた勤務
  const people = new Set(r.rows.map((a) => a.memberId)).size;          // 入った人数
  const shortages = p.problems.filter((x) => /足りない/.test(x.text)).length;   // 人が足りない所の数
  const usedAi = r.source === "gemini";                                // 本物のAIの案を使ったか
  const changes = diffText(p.before, r.rows, nameOf);                  // 前と変わった所

  return h("section", { class: `card ai-result ${ok ? "is-ok" : "is-ng"}` },
    // ---- 見出し ----
    h("div", { class: "ai-result__head" },
      h("h2", { class: "card__title" }, p.kind === "fix" ? "AIが直した結果" : "AIの結果"),
      h("span", { class: `badge ${usedAi ? "badge--hall" : ""}` }, usedAi ? `Gemini（${r.model}）` : "簡易版"),
      h("button", { class: "btn btn--small ai-result__close", onclick: p.onClose, "aria-label": "閉じる" }, "×"),
    ),

    // ---- ① 大きな印 ----
    h("div", { class: "ai-result__big" },
      h("span", { class: "ai-result__mark", "aria-hidden": "true" }, ok ? "✓" : "!"),
      h("div", null,
        h("strong", null, ok ? "ルールは全部守れています" : `守れていないルール ${p.problems.length}件`),
        h("div", { class: "home-muted" }, ok ? "このまま公開できます。気になる所だけ直してください" : "赤い点の日を開いて直すか、下のボタンでAIに直してもらえます"))),

    // ---- ② 数字 ----
    h("div", { class: "ai-result__stats" },
      stat("足りない時間", `${shortages}件`, shortages ? "ng" : "ok"),
      stat("入った人", `${people}人`),
      stat("勤務の数", `${work.length}`),
      stat("人件費（週）", p.costText),
      stat("店長の直し方", `${r.learnedCount}件 使用`),
    ),

    // ---- ③ AIのひとこと ----
    r.summary ? h("div", { class: "ai-result__say" }, h("strong", null, "AIのひとこと"), r.summary) : null,
    r.concerns?.length
      ? h("div", { class: "notice notice--warn", style: { fontWeight: 400 } },
          h("strong", null, "どうしても守れなかったこと"), h("ul", null, r.concerns.map((c) => h("li", null, c))))
      : null,

    // ---- ④ AIを使えなかった理由 ----
    r.error || r.why
      ? h("div", { class: "notice notice--info", style: { fontWeight: 400 } },
          r.error ? `AIでエラー：${r.error}。かわりに簡易版で作りました。` : r.why,
          !usedAi && (r.error || /設定|鍵|URL/.test(r.why || "")) ? h("button", { class: "btn btn--small", onclick: p.onSettings, style: { marginLeft: "8px" } }, "AIの設定へ") : null)
      : null,

    // ---- ⑤ くわしく ----
    reasonsBlock(r.rows, nameOf, p.onJump),
    changes.length ? details(`前と変わった所（${changes.length}）`, h("ul", { class: "ai-result__list" }, changes.map((t) => h("li", null, t)))) : null,
    r.dropped?.length ? details(`AIが入れたが、ルールに合わず外した勤務（${r.dropped.length}）`, h("ul", { class: "ai-result__list" }, r.dropped.map((t) => h("li", null, t)))) : null,

    // ---- ⑥ ボタン ----
    h("div", { class: "chip-row ai-result__actions" },
      !ok && p.aiOn ? h("button", { class: "btn btn--blue", onclick: p.onFix }, `残り${p.problems.length}件をAIに直してもらう`) : null,
      h("button", { class: "btn", onclick: p.onUndo }, "↶ AIの前に戻す"),
      h("button", { class: "btn btn--primary", onclick: p.onClose }, "OK（この案で進める）"),
    ),
  );
}

/** 数字の小さな箱 */
function stat(name, value, tone = "") {
  return h("div", { class: `ai-stat ${tone ? `ai-stat--${tone}` : ""}` }, h("span", { class: "home-muted" }, name), h("strong", { class: "num" }, value));
}

/** 開くと見られる所（<details>） */
function details(title, body) {
  return h("details", { class: "ai-result__more" }, h("summary", null, title), body);
}

/** 人ごとの理由（日ごとにまとめる）。押すとその日・その人を開く */
function reasonsBlock(rows, nameOf, onJump) {
  const withReason = rows.filter((a) => a.reason).sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from);   // 理由がある勤務（日と時刻の順）
  if (!withReason.length) return null;
  const byDate = new Map();                                            // 日付 → その日の勤務
  withReason.forEach((a) => { if (!byDate.has(a.date)) byDate.set(a.date, []); byDate.get(a.date).push(a); });
  return details(`なぜこの人・この時間？（AIの理由 ${withReason.length}件）`,
    [...byDate].map(([date, list]) => h("div", { class: "ai-result__day" },
      h("strong", null, label(date)),
      h("ul", { class: "ai-result__list" }, list.map((a) => h("li", null,
        h("button", { class: "link-btn", onclick: () => onJump(a.date, a.memberId) }, `${nameOf(a.memberId)} ${range(a.from, a.to)}`),
        `：${a.reason}`))))));
}

/**
 * 前と変わった所を文にする
 * 例「スタッフA 11/9（月）：7:00〜16:00 → 6:30〜15:30」「スタッフE 11/10（火）：足した」
 */
export function diffText(before, after, nameOf) {
  const key = (a) => `${a.memberId}|${a.date}`;                        // 人と日
  const pack = (rows) => {                                             // 人と日 → 時間の文
    const map = new Map();   // 人と日 → 時間の文の一覧
    rows.forEach((a) => map.set(key(a), [...(map.get(key(a)) || []), range(a.from, a.to)]));
    return map;
  };
  const b = pack(before || []);   // 前の勤務
  const a = pack(after || []);   // 後の勤務
  const out = [];   // 変わった所の文
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const [id, date] = k.split("|");   // 人のIDと日付
    const was = (b.get(k) || []).join("・");                           // 前
    const now = (a.get(k) || []).join("・");                           // 後
    if (was === now) continue;
    const who = `${nameOf(id)} ${label(date)}`;   // 「名前 日付」
    out.push(!was ? `${who}：${now} を足した` : !now ? `${who}：${was} を外した` : `${who}：${was} → ${now}`);
  }
  return out.sort();
}
