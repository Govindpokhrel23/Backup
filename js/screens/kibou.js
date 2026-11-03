// ============================================================
// screens/kibou.js — 希望入力（店員）
// ------------------------------------------------------------
// ・2か月先まで、週ごとに希望を入れられる（2026年11月3日）
//   上の週のボタンで週を切り替える。「前の週と同じにする」もできる
//   締切はそれぞれの週の「前の日曜24:00」。すぎた週・店長が締め切った週は直せない
// ・立場（店長がアカウントを作る時に決めたもの）で中身が変わる：
//   バイト・フルで入るバイト：
//     1日ずつ「入れない／いつでもOK／時間指定」を選ぶ
//   社員：
//     最初から全部「入れる」。
//     希望を出さない → 休みは週1日（AIが決める）
//     休み希望を出す → 週2日まで。
//     3日目からは「特別許可の申請」になり、店長が決める（F-48）
// ・ほかの人の希望は見られない
// ・保存できたら前の画面に戻る
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { CONFIG } from "../config.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";
import { label, shortLabel, weekdayNum, weekDates, mondayOf, addDays, today, toDate, toIso } from "../lib/date.js";
import { range, timeOptions } from "../lib/time.js";

/** 何か月先まで入れられるか */
const MONTHS_AHEAD = CONFIG.MONTHS_AHEAD;

export async function renderKibou(app) {
  const isShain = state.user.kind === "shain";

  // ---------- 入れられる週を並べる（来週〜2か月先） ----------
  const limit = (() => { const d = toDate(today()); d.setMonth(d.getMonth() + MONTHS_AHEAD); return toIso(d); })();
  const starts = [];
  for (let w = addDays(mondayOf(today()), 7); w <= limit; w = addDays(w, 7)) starts.push(w);

  // 週ごとに「入れられるか」と「保存してある希望」を読む
  const locks = await Promise.all(starts.map((w) => api.weekLock(w)));
  const saved = await api.listMyAvailabilities(starts[0], addDays(starts[starts.length - 1], 6));

  // ---------- 画面の中で持つ「今の入力」 ----------
  // 週1つ：{ weekStart, lock, days:[{date, kind, from, to}], touched, savedBefore }
  const weeks = starts
    .map((weekStart, i) => ({ weekStart, lock: locks[i] }))
    .filter((w) => !w.lock)                         // 締め切った週は出さない
    .map((w) => {
      const days = weekDates(w.weekStart).map((date) => {
        const s = saved.find((x) => x.date === date);
        if (s) return { date, kind: s.kind, from: s.from ?? 9 * 60, to: s.to ?? 15 * 60 };
        // まだ入れていない日：社員は「入れる」、バイトは「未入力」
        return { date, kind: isShain ? "any" : "none", from: 9 * 60, to: 15 * 60 };
      });
      const savedBefore = weekDates(w.weekStart).some((d) => saved.some((x) => x.date === d));
      return { ...w, days, touched: false, savedBefore };
    });

  if (!weeks.length) {
    mount(app,
      screenHeader({ title: "希望入力" }),
      h("div", { class: "screen-body" }, h("div", { class: "card" }, "いまは希望を入れられる週がありません。")));
    return;
  }

  let current = 0;      // 表示している週（weeks の何番目か）
  let message = "";
  draw();

  // ============================================================
  // 描く
  // ============================================================
  function draw() {
    const week = weeks[current];
    const offCount = week.days.filter((d) => d.kind === "off").length;
    const notYet = week.days.filter((d) => d.kind === "none").length;

    mount(app,
      screenHeader({
        title: "希望入力",
        right: h("span", { class: "badge" }, `${CONFIG.KIND_LABEL[state.user.kind]}（店長が設定）`),
        sub: `2か月先（${label(limit)}）まで入れられます`,
        extra: [
          weekTabs(),
          h("div", { class: "kibou-deadline" }, `${label(week.weekStart)}〜${label(addDays(week.weekStart, 6))} ／ 締切 ${label(addDays(week.weekStart, -1))} 24:00`),
          isShain
            ? h("div", { class: "notice notice--warn", style: { fontWeight: 400 } },
                `休み希望を出さないときは、休みは週1日（AIが決めます）。休み希望を出すときは週${CONFIG.SHAIN_OFF_LIMIT}日まで（この週 ${offCount}/${CONFIG.SHAIN_OFF_LIMIT}）。それより多いときは店長の特別許可が必要です。`)
            : null,
        ],
      }),
      h("div", { class: "screen-body kibou-body" },
        current > 0
          ? h("button", { class: "btn btn--small btn--dashed", onclick: copyPrevWeek }, "前の週と同じにする")
          : null,
        week.days.map((d, i) => dayCard(d, i)),
        message ? h("div", { class: "notice notice--danger" }, message) : null,
      ),
      h("div", { class: "kibou-footer" },
        h("button", { class: "btn btn--primary btn--block", onclick: save },
          notYet ? `保存する（この週の未入力 ${notYet}日）` : "保存する"),
        h("div", { class: "home-muted", style: { textAlign: "center" } }, "入れた週はまとめて保存されます。締切までは何度でも直せます"),
      ),
    );
    // 選んでいる週のボタンが見えるように、横にスクロールする
    app.querySelector('.week-tab[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  /** 週を切り替えるボタン（横にスクロール） */
  function weekTabs() {
    return h("div", { class: "week-tabs" },
      weeks.map((w, i) => {
        const done = (w.savedBefore || w.touched) && !w.days.some((d) => d.kind === "none");
        return h("button", {
          class: "chip week-tab",
          "aria-pressed": String(i === current),
          onclick: () => { current = i; message = ""; draw(); },
        },
          h("span", { class: "num" }, `${shortLabel(w.weekStart)}〜`),
          h("span", { class: `week-tab__state ${done ? "is-done" : ""}` }, w.touched ? "未保存" : done ? "入力済み" : "未入力"),
        );
      }));
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
    const sel = (value, onChange, aria) => h("select", {
      class: "select num", "aria-label": aria,
      onchange: (e) => { onChange(Number(e.target.value)); weeks[current].touched = true; draw(); },
    }, timeOptions().map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
    return h("div", { class: "time-range" },
      sel(d.from, (v) => { d.from = v; }, "から"),
      "〜",
      sel(d.to, (v) => { d.to = v; }, "まで"),
    );
  }

  // ============================================================
  // 操作
  // ============================================================

  /** 選んだ時 */
  function pick(i, kind) {
    message = "";
    const week = weeks[current];
    const d = week.days[i];
    week.touched = true;
    // 社員の3日目の休み → 特別許可の申請にする（週ごとに数える）
    if (isShain && kind === "off" && d.kind !== "off" && d.kind !== "offx") {
      const offCount = week.days.filter((x) => x.kind === "off").length;
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

  /** 前の週と同じ選び方にする（2か月分を入れるのを楽にする） */
  function copyPrevWeek() {
    const prev = weeks[current - 1];
    const week = weeks[current];
    week.days.forEach((d, i) => {
      const p = prev.days[i];
      Object.assign(d, { kind: p.kind === "offx" ? "off" : p.kind, from: p.from, to: p.to });
    });
    week.touched = true;
    message = "";
    toast("前の週と同じにしました");
    draw();
  }

  /** 保存（さわった週をまとめて保存） */
  async function save() {
    const targets = weeks.filter((w) => w.touched);
    if (!targets.length) {
      toast("変えたところはありません");
      return;
    }
    // まちがいがあれば、その週を開いて知らせる
    for (const w of targets) {
      const idx = weeks.indexOf(w);
      if (w.days.some((d) => d.kind === "time" && d.to <= d.from)) {
        current = idx; message = "時間指定の「まで」は「から」より後にしてください"; return draw();
      }
      const notYet = w.days.filter((d) => d.kind === "none").length;
      if (notYet) {
        current = idx; message = `この週にまだ選んでいない日があります（${notYet}日）`; return draw();
      }
    }
    try {
      for (const w of targets) {
        // 保存する形にそろえる（時間指定以外は時刻を持たない）
        const rows = w.days.map((d) => ({
          date: d.date, kind: d.kind,
          from: d.kind === "time" ? d.from : null,
          to: d.kind === "time" ? d.to : null,
        }));
        await api.saveMyAvailabilities(w.weekStart, rows);
        w.touched = false;
        w.savedBefore = true;
      }
      toast(`希望を保存しました（${targets.length}週分）`);
      // 保存できたら前の画面に戻る（前がなければホームへ）
      if (history.length > 1) history.back();
      else go("/home");
    } catch (e) {
      message = e.message;
      draw();
    }
  }
}
