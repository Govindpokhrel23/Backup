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

import { createElement } from "../lib/dom.js";
import { today, addDays, label } from "../lib/date.js";
import { range, fmt } from "../lib/time.js";

/** 交代：お願い中なら状態、まだならボタン */
function swapPart(props, shift) {
  const sw = (props.swaps || []).find((swap) => swap.assignmentId === shift.id && ["open", "taken"].includes(swap.status));   // この勤務の交代のお願い（募集中・承認待ち）
  if (sw) return createElement("span", { class: "badge badge--warn" }, sw.status === "open" ? "交代をさがし中" : `${sw.takerName}さんが代わる予定（店長の承認待ち）`);
  if (!props.onSwap || !shift.id) return null;
  return createElement("button", { class: "btn btn--small my-shifts__swap", onclick: () => props.onSwap(shift) }, "交代をお願いする");
}

/**
 * @param {object} props
 * @param {object[]} props.assignments  自分の勤務（公開済み）
 * @param {object[]} props.stores       店舗の一覧（店名を出すため）
 * @param {string}   props.myStoreId    自分のいつもの店舗（応援を見分けるため）
 * @param {number}   [props.limit]      いくつまで出すか
 * @param {object[]} [props.swaps]      自分が出した交代のお願い（募集中・承認待ちを出す）
 * @param {(a:object)=>void} [props.onSwap]  「交代をお願いする」を押した時（ないとボタンを出さない）
 */
export function myShifts(props) {
  const now = today();   // 今日の日付
  const upcoming = props.assignments   // これからの勤務（今日から、早い順）
    .filter((shift) => shift.date >= now)                                   // 昨日より前は出さない
    .sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date) || shiftA.from - shiftB.from)
    .slice(0, props.limit ?? 10);

  // 「今日」「明日」「明後日」の呼び方
  const dayWord = (date) => (date === now ? "今日" : date === addDays(now, 1) ? "明日" : date === addDays(now, 2) ? "明後日" : null);
  /** 店舗のIDから店名 */
  const storeName = (id) => props.stores.find((store) => store.id === id)?.name || "";

  return createElement("section", { class: "card" },
    createElement("h2", { class: "card__title" }, "自分のシフト"),
    upcoming.length
      ? createElement("ul", { class: "my-shifts" },
          upcoming.map((shift) => {
            const word = dayWord(shift.date);   // 「今日」「明日」「明後日」（それ以外は null）
            const help = shift.storeId !== props.myStoreId;   // ほかの店舗への応援か
            return createElement("li", { class: `my-shifts__item ${word === "今日" ? "is-today" : ""}` },
              // 1行目：「明後日11/6（金）」
              createElement("div", { class: "my-shifts__day" }, `${word || ""}${label(shift.date)}`),
              // 2行目：「コメダ 安城福釜店」
              createElement("div", { class: "my-shifts__store" }, `コメダ ${storeName(shift.storeId)}`),
              // 3行目：「9:00〜15:00」（大きく）
              createElement("div", { class: "my-shifts__time num" }, range(shift.from, shift.to)),
              // 4行目（小さく）：場所と休憩
              createElement("div", { class: "home-muted" },
                `${shift.area === "hall" ? "ホール" : "キッチン"}${shift.breakAt != null ? ` ・ 休憩 ${fmt(shift.breakAt)}` : ""}`),
              help ? createElement("span", { class: "badge badge--warn" }, "応援") : null,
              swapPart(props, shift),
            );
          }))
      : createElement("div", { class: "home-muted" }, "これからの予定はまだありません（公開されると出ます）"),
  );
}
