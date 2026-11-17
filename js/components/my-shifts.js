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

import { createElement } from "../lib/dom.js";   // 画面の部品の道具を読む
import { today, addDays, label } from "../lib/date.js";   // 日付の道具を読む
import { range, fmt } from "../lib/time.js";   // 時間の表示の道具を読む

/**
 * @param {object} props
 * @param {object[]} props.assignments  自分の勤務（公開済み）
 * @param {object[]} props.stores       店舗の一覧（店名を出すため）
 * @param {string}   props.myStoreId    自分のいつもの店舗（応援を見分けるため）
 * @param {number}   [props.limit]      いくつまで出すか
 * @param {()=>void} [props.onMore]     もっと見る（押すとカレンダーへ。2026年11月17日）
 */
export function myShifts(props) {   // 自分のシフトのカードを作る関数
  const now = today();   // 今日の日付
  const all = props.assignments   // これからの勤務（今日から、早い順）
    .filter((shift) => shift.date >= now)                                   // 昨日より前は出さない
    .sort((shiftA, shiftB) => shiftA.date.localeCompare(shiftB.date) || shiftA.from - shiftB.from);   // 日付と時間の順に並べる
  const upcoming = all.slice(0, props.limit ?? 10);   // はじめの10件まで
  const rest = all.length - upcoming.length;   // 出しきれなかった数

  // 「今日」「明日」「明後日」の呼び方
  const dayWord = (date) => (date === now ? "今日" : date === addDays(now, 1) ? "明日" : date === addDays(now, 2) ? "明後日" : null);   // 今日・明日・明後日の言葉を出す
  /** 店舗のIDから店名 */
  const storeName = (id) => props.stores.find((store) => store.id === id)?.name || "";   // 店舗IDから店舗の名前を出す

  return createElement("section", { class: "card" },   // カード
    createElement("h2", { class: "card__title" }, "自分のシフト"),   // カードの見出し
    upcoming.length   // 予定があれば一覧、なければ文
      ? createElement("ul", { class: "my-shifts" },   // 一覧
          upcoming.map((shift) => {   // 勤務ごとに
            const word = dayWord(shift.date);   // 「今日」「明日」「明後日」（それ以外は null）
            const help = shift.storeId !== props.myStoreId;   // ほかの店舗への応援か
            return createElement("li", { class: `my-shifts__item ${word === "今日" ? "is-today" : ""}` },   // 1件（今日なら色を変える）
              // 1行目：「明後日11/6（金）」
              createElement("div", { class: "my-shifts__day" }, `${word || ""}${label(shift.date)}`),   // 1行目：「明後日11/6（金）」
              // 2行目：「コメダ 安城福釜店」
              createElement("div", { class: "my-shifts__store" }, `コメダ ${storeName(shift.storeId)}`),   // 2行目：「コメダ 安城福釜店」
              // 3行目：「9:00〜15:00」（大きく）
              createElement("div", { class: "my-shifts__time num" }, range(shift.from, shift.to)),   // 3行目：「9:00〜15:00」
              // 4行目（小さく）：場所と休憩
              createElement("div", { class: "home-muted" },   // 小さい説明
                `${shift.area === "hall" ? "ホール" : "キッチン"}${shift.breakAt != null ? ` ・ 休憩 ${fmt(shift.breakAt)}` : ""}`),   // 場所と休憩の時間
              help ? createElement("span", { class: "badge badge--warn" }, "応援") : null,   // ほかの店舗なら「応援」の印
            );
          }))
      : createElement("div", { class: "home-muted" }, "これからの予定はまだありません（公開されると出ます）"),   // 予定がない時の文
    rest > 0 && props.onMore   // まだ先の勤務があれば
      ? createElement("button", { class: "btn btn--small btn--block", onclick: props.onMore }, `ほか ${rest}件をカレンダーで見る`)   // もっと見るボタン
      : null,   // なければ出さない
  );
}
