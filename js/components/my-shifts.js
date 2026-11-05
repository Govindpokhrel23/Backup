// ============================================================
// components/my-shifts.js — 自分のシフトの一覧（ホームで使う）
// ------------------------------------------------------------
// このファイルは、自分のシフトの一覧（ホームで使う）のファイルです。
// ・今日 → 明日 → 明後日 → その先 の順に並べる
// ・見た目（2026年11月4日）：明後日11/6（金）／コメダ 安城福釜店／9:00〜15:00
// ・昨日より前のものは出さない（自動で消える）
//   ※カレンダーにはずっと残る（ここは「これからの予定」だけ）
// ・店長も仕事に入るので、店長のホームでも同じものを使う
// ============================================================

import { h } from "../lib/dom.js";
import { today, addDays, label } from "../lib/date.js";
import { range, fmt } from "../lib/time.js";

/** 交代：お願い中なら状態、まだならボタン */
function swapPart(p, a) {
  const sw = (p.swaps || []).find((x) => x.assignmentId === a.id && ["open", "taken"].includes(x.status));   // この勤務の交代のお願い（募集中・承認待ち）
  if (sw) return h("span", { class: "badge badge--warn" }, sw.status === "open" ? "交代をさがし中" : `${sw.takerName}さんが代わる予定（店長の承認待ち）`);
  if (!p.onSwap || !a.id) return null;
  return h("button", { class: "btn btn--small my-shifts__swap", onclick: () => p.onSwap(a) }, "交代をお願いする");
}

/**
 * @param {object} p
 * @param {object[]} p.assignments  自分の勤務（公開済み）
 * @param {object[]} p.stores       店舗の一覧（店名を出すため）
 * @param {string}   p.myStoreId    自分のいつもの店舗（応援を見分けるため）
 * @param {number}   [p.limit]      いくつまで出すか
 * @param {object[]} [p.swaps]      自分が出した交代のお願い（募集中・承認待ちを出す）
 * @param {(a:object)=>void} [p.onSwap]  「交代をお願いする」を押した時（ないとボタンを出さない）
 */
export function myShifts(p) {
  const now = today();   // 今日の日付
  const upcoming = p.assignments   // これからの勤務（今日から、早い順）
    .filter((a) => a.date >= now)                                   // 昨日より前は出さない
    .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
    .slice(0, p.limit ?? 10);

  // 「今日」「明日」「明後日」の呼び方
  const dayWord = (d) => (d === now ? "今日" : d === addDays(now, 1) ? "明日" : d === addDays(now, 2) ? "明後日" : null);
  /** 店舗のIDから店名 */
  const storeName = (id) => p.stores.find((s) => s.id === id)?.name || "";

  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, "自分のシフト"),
    upcoming.length
      ? h("ul", { class: "my-shifts" },
          upcoming.map((a) => {
            const word = dayWord(a.date);   // 「今日」「明日」「明後日」（それ以外は null）
            const help = a.storeId !== p.myStoreId;   // ほかの店舗への応援か
            return h("li", { class: `my-shifts__item ${word === "今日" ? "is-today" : ""}` },
              // 1行目：「明後日11/6（金）」
              h("div", { class: "my-shifts__day" }, `${word || ""}${label(a.date)}`),
              // 2行目：「コメダ 安城福釜店」
              h("div", { class: "my-shifts__store" }, `コメダ ${storeName(a.storeId)}`),
              // 3行目：「9:00〜15:00」（大きく）
              h("div", { class: "my-shifts__time num" }, range(a.from, a.to)),
              // 4行目（小さく）：場所と休憩
              h("div", { class: "home-muted" },
                `${a.area === "hall" ? "ホール" : "キッチン"}${a.breakAt != null ? ` ・ 休憩 ${fmt(a.breakAt)}` : ""}`),
              help ? h("span", { class: "badge badge--warn" }, "応援") : null,
              swapPart(p, a),
            );
          }))
      : h("div", { class: "home-muted" }, "これからの予定はまだありません（公開されると出ます）"),
  );
}
