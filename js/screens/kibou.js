// ============================================================
// screens/kibou.js — 希望入力（店員）
// ------------------------------------------------------------
// 立場（店長がアカウントを作る時に決めたもの）で中身が変わる：
//   バイト・フルで入るバイト：
//     1日ずつ「入れない／いつでもOK／時間指定」を選ぶ
//   社員：
//     最初から全部「入れる」。
//     希望を出さない → 休みは週1日（AIが決める）
//     休み希望を出す → 週2日まで。
//     3日目からは「特別許可の申請」になり、店長が決める（F-48）
// ・締切までは何度でも直せる
// ・ほかの人の希望は見られない
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { CONFIG } from "../config.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";
import { openPeriod, weekLabel, deadlineLabel, datesOf } from "../lib/period.js";
import { label, weekdayNum } from "../lib/date.js";
import { range, timeOptions } from "../lib/time.js";

export async function renderKibou(app) {
  const periods = await api.listPeriods();
  const period = openPeriod(periods);

  if (!period) {
    mount(app,
      screenHeader({ title: "希望入力" }),
      h("div", { class: "screen-body" }, h("div", { class: "card" }, "いまは受付中の週がありません。店長が受付を始めると、ここで入力できます。")));
    return;
  }

  const isShain = state.user.kind === "shain";
  const saved = await api.listAvailabilities(period.id);

  // ---------- 画面の中で持つ「今の入力」 ----------
  // 1日1つ：{ date, kind, from, to }
  const days = datesOf(period).map((date) => {
    const s = saved.find((x) => x.date === date);
    if (s) return { ...s };
    // まだ入れていない日：社員は「入れる」、バイトは「未入力」
    return { date, kind: isShain ? "any" : "none", from: 9 * 60, to: 15 * 60 };
  });
  let message = "";

  draw();

  function draw() {
    const offCount = days.filter((d) => d.kind === "off").length;
    const notYet = days.filter((d) => d.kind === "none").length;

    mount(app,
      screenHeader({
        title: "希望入力",
        right: h("span", { class: "badge" }, `${CONFIG.KIND_LABEL[state.user.kind]}（店長が設定）`),
        sub: weekLabel(period),
        extra: [
          h("div", { class: "kibou-deadline" }, `締切：${deadlineLabel(period)} まで`),
          isShain
            ? h("div", { class: "notice notice--warn", style: { fontWeight: 400 } },
                `休み希望を出さないときは、休みは週1日（AIが決めます）。休み希望を出すときは週${CONFIG.SHAIN_OFF_LIMIT}日まで（今 ${offCount}/${CONFIG.SHAIN_OFF_LIMIT}）。それより多いときは店長の特別許可が必要です。`)
            : null,
        ],
      }),
      h("div", { class: "screen-body kibou-body" },
        days.map((d, i) => dayCard(d, i)),
        message ? h("div", { class: "notice notice--danger" }, message) : null,
      ),
      h("div", { class: "kibou-footer" },
        h("button", { class: "btn btn--primary btn--block", onclick: save }, notYet ? `保存する（未入力 ${notYet}日）` : "保存する"),
        h("div", { class: "home-muted", style: { textAlign: "center" } }, "締切までは何度でも直せます"),
      ),
    );
  }

  /** 1日分のカード */
  function dayCard(d, i) {
    // 立場で選べるものが違う
    const choices = isShain
      ? [["any", "入れる", "ok"], ["off", "休み希望", "danger"], ["time", "時間指定", "hall"]]
      : [["no", "入れない", "danger"], ["any", "いつでもOK", "ok"], ["time", "時間指定", "hall"]];

    const wd = weekdayNum(d.date);
    const stateText = {
      none: "未入力", no: "入れない", any: isShain ? "入れる" : "いつでもOK",
      off: "休み希望", offx: "特別許可を申請中", time: range(d.from, d.to),
    }[d.kind];

    return h("section", { class: "card kibou-day" },
      h("div", { class: "kibou-day__head" },
        h("span", { class: `kibou-day__date ${wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : ""}` }, label(d.date)),
        h("span", { class: `kibou-day__state ${d.kind === "none" ? "is-none" : ""}` }, stateText),
      ),
      h("div", { class: "chip-grid" },
        choices.map(([kind, text, color]) =>
          h("button", {
            class: `chip chip--${color}`,
            "aria-pressed": String(d.kind === kind || (kind === "off" && d.kind === "offx")),
            onclick: () => pick(i, kind),
          }, text)),
      ),
      d.kind === "time" ? timeRange(d) : null,
    );
  }

  /** 時間指定の「から〜まで」 */
  function timeRange(d) {
    const sel = (value, onChange, aria) => h("select", { class: "select num", "aria-label": aria, onchange: (e) => { onChange(Number(e.target.value)); draw(); } },
      timeOptions().map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
    return h("div", { class: "time-range" },
      sel(d.from, (v) => { d.from = v; }, "から"),
      "〜",
      sel(d.to, (v) => { d.to = v; }, "まで"),
    );
  }

  /** 選んだ時 */
  function pick(i, kind) {
    message = "";
    const d = days[i];
    // 社員の3日目の休み → 特別許可の申請にする
    if (isShain && kind === "off" && d.kind !== "off" && d.kind !== "offx") {
      const offCount = days.filter((x) => x.kind === "off").length;
      if (offCount >= CONFIG.SHAIN_OFF_LIMIT) {
        d.kind = "offx";
        message = `${label(d.date)}は${CONFIG.SHAIN_OFF_LIMIT + 1}日目の休み希望です。店長の特別許可を申請します。`;
        draw();
        return;
      }
    }
    d.kind = kind;
    draw();
  }

  /** 保存 */
  async function save() {
    if (days.some((d) => d.kind === "time" && d.to <= d.from)) {
      message = "時間指定の「まで」は「から」より後にしてください";
      return draw();
    }
    const notYet = days.filter((d) => d.kind === "none").length;
    if (notYet) {
      message = `まだ選んでいない日があります（${notYet}日）`;
      return draw();
    }
    // 保存する形にそろえる（時間指定以外は時刻を持たない）
    const rows = days.map((d) => ({
      date: d.date, kind: d.kind,
      from: d.kind === "time" ? d.from : null,
      to: d.kind === "time" ? d.to : null,
    }));
    try {
      await api.saveMyAvailabilities(period.id, rows);
      toast("希望を保存しました");
      // 保存できたら前の画面に戻る（前がなければホームへ）
      if (history.length > 1) history.back();
      else go("/home");
    } catch (e) {
      message = e.message;
      draw();
    }
  }
}
