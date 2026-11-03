// ============================================================
// components/my-shifts.js — 自分のシフトの一覧（ホームで使う）
// ------------------------------------------------------------
// ・今日 → 明日 → 明後日 → その先 の順に並べる
// ・昨日より前のものは出さない（自動で消える）
//   ※カレンダーにはずっと残る（ここは「これからの予定」だけ）
// ・店長も仕事に入るので、店長のホームでも同じものを使う
// ============================================================

import { h } from "../lib/dom.js";
import { today, addDays, label } from "../lib/date.js";
import { range, fmt } from "../lib/time.js";

/**
 * @param {object} p
 * @param {object[]} p.assignments  自分の勤務（公開済み）
 * @param {object[]} p.stores       店舗の一覧（店名を出すため）
 * @param {string}   p.myStoreId    自分のいつもの店舗（応援を見分けるため）
 * @param {number}   [p.limit]      いくつまで出すか
 */
export function myShifts(p) {
  const now = today();
  const upcoming = p.assignments
    .filter((a) => a.date >= now)                                   // 昨日より前は出さない
    .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
    .slice(0, p.limit ?? 10);

  // 「今日」「明日」「明後日」の呼び方
  const dayWord = (d) => (d === now ? "今日" : d === addDays(now, 1) ? "明日" : d === addDays(now, 2) ? "明後日" : null);
  const storeName = (id) => p.stores.find((s) => s.id === id)?.name || "";

  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, "自分のシフト"),
    upcoming.length
      ? h("ul", { class: "my-shifts" },
          upcoming.map((a) => {
            const word = dayWord(a.date);
            const help = a.storeId !== p.myStoreId;
            return h("li", { class: `my-shifts__item ${word === "今日" ? "is-today" : ""}` },
              h("div", { class: "my-shifts__day" },
                word ? h("strong", null, word) : null,
                h("span", null, label(a.date)),
              ),
              h("div", { class: "my-shifts__time num" }, `コメダ ${range(a.from, a.to)}`),
              h("div", { class: "home-muted" },
                `${storeName(a.storeId)} ・ ${a.area === "hall" ? "ホール" : "キッチン"}${a.breakAt != null ? ` ・ 休憩 ${fmt(a.breakAt)}` : ""}`),
              help ? h("span", { class: "badge badge--warn" }, "応援") : null,
            );
          }))
      : h("div", { class: "home-muted" }, "これからの予定はまだありません（公開されると出ます）"),
  );
}
