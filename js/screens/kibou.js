// ============================================================
// screens/kibou.js — 希望入力（店員）
// ------------------------------------------------------------
// このファイルは、希望入力（店員）のファイルです。
// ・2か月先まで、週ごとに希望を入れられる（2026年11月3日）
//   上の週のボタンで週を切り替える。「前の週と同じにする」もできる
//   締切はそれぞれの週の「前の日曜24:00」。すぎた週・店長が締め切った週は直せない
// ・立場（店長がアカウントを作る時に決めたもの）で中身が変わる：
//   バイト・フルで入るバイト：
//     1日ずつ「入れない／いつでもOK／時間指定」を選ぶ
//   社員：
//     最初から全部「入れる」。
//     希望を出さない → 休みは週1日（店長が決める。下書きではAIが案を出す）
//     休み希望を出す → 週2日まで。
//     2日目は「特別許可の申請」になり店長が決める。3日目は出せない（2026年11月5日）
// ・ほかの人の希望は見られない
// ・保存できたら前の画面に戻る
// ============================================================

import { createElement, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { CONFIG } from "../config.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";
import { label, shortLabel, weekdayNum, weekDates, mondayOf, addDays, today, toDate, toIso } from "../lib/date.js";
import { range, timeOptions } from "../lib/time.js";

/** 何か月先まで入れられるか */
const MONTHS_AHEAD = CONFIG.MONTHS_AHEAD;

/** 希望入力の画面を描く */
export async function renderKibou(app) {
  const isShain = state.user.kind === "shain";   // 社員か（社員は休み希望だけ出す）

  // ---------- 入れられる週を並べる（来週〜2か月先） ----------
  const limit = (() => { const date = toDate(today()); date.setMonth(date.getMonth() + MONTHS_AHEAD); return toIso(date); })();
  const starts = [];   // 入れられる週の月曜日（2か月先まで）
  for (let monday = addDays(mondayOf(today()), 7); monday <= limit; monday = addDays(monday, 7)) starts.push(monday);

  // 週ごとに「入れられるか」と「保存してある希望」を読む
  const locks = await Promise.all(starts.map((start) => api.weekLock(start)));
  const saved = await api.listMyAvailabilities(starts[0], addDays(starts[starts.length - 1], 6));   // 保存してある自分の希望

  // ---------- 画面の中で持つ「今の入力」 ----------
  // 週1つ：{ weekStart, lock, days:[{date, kind, from, to}], touched, savedBefore }
  const weeks = starts
    .map((weekStart, index) => ({ weekStart, lock: locks[index] }))
    .filter((start) => !start.lock)                         // 締め切った週は出さない
    .map((period) => {
      const days = weekDates(period.weekStart).map((date) => {   // その週の7日分
        const shift = saved.find((hope) => hope.date === date);   // その日の保存してある希望
        if (shift) return { date, kind: shift.kind, from: shift.from ?? 9 * 60, to: shift.to ?? 15 * 60 };
        // まだ入れていない日：社員は「入れる」、バイトは「未入力」
        return { date, kind: isShain ? "any" : "none", from: 9 * 60, to: 15 * 60 };
      });
      const savedBefore = weekDates(period.weekStart).some((date) => saved.some((hope) => hope.date === date));   // 前に保存したことがある週か
      return { ...period, days, touched: false, savedBefore };
    });

  if (!weeks.length) {
    mount(app,
      screenHeader({ title: "希望入力" }),
      createElement("div", { class: "screen-body" }, createElement("div", { class: "card" }, "いまは希望を入れられる週がありません。")));
    return;
  }

  let current = 0;      // 表示している週（weeks の何番目か）
  let message = "";   // 画面に出すお知らせの文
  draw();

  // ============================================================
  // 描く
  // ============================================================
  function draw() {
    const week = weeks[current];   // 今見ている週
    const offCount = week.days.filter((day) => day.kind === "off" || day.kind === "offx").length;   // この週の休み希望の数（許可待ちも入れる）
    const notYet = week.days.filter((day) => day.kind === "none").length;   // まだ選んでいない日の数

    mount(app,
      screenHeader({
        title: "希望入力",
        right: createElement("span", { class: "badge" }, `${CONFIG.KIND_LABEL[state.user.kind]}（店長が設定）`),
        sub: `2か月先（${label(limit)}）まで入れられます`,
        extra: [
          weekTabs(),
          createElement("div", { class: "kibou-deadline" }, `${label(week.weekStart)}〜${label(addDays(week.weekStart, 6))} ／ 締切 ${label(addDays(week.weekStart, -1))} 24:00`),
          isShain
            ? createElement("div", { class: "notice notice--warn", style: { fontWeight: 400 } },
                `休み希望を出さないときは、休みは週1日（店長が決めます）。休み希望は週${CONFIG.SHAIN_OFF_MAX}日まで。${CONFIG.SHAIN_OFF_FREE + 1}日目の休みは店長の特別許可が必要です（この週 ${offCount}/${CONFIG.SHAIN_OFF_MAX}）。`)
            : null,
        ],
      }),
      createElement("div", { class: "screen-body kibou-body" },
        current > 0
          ? createElement("button", { class: "btn btn--small btn--dashed", onclick: copyPrevWeek }, "前の週と同じにする")
          : null,
        week.days.map((day, index) => dayCard(day, index)),
        message ? createElement("div", { class: "notice notice--danger" }, message) : null,
      ),
      createElement("div", { class: "kibou-footer" },
        createElement("button", { class: "btn btn--primary btn--block", onclick: save },
          notYet ? `保存する（この週の未入力 ${notYet}日）` : "保存する"),
        createElement("div", { class: "home-muted", style: { textAlign: "center" } }, "入れた週はまとめて保存されます。締切までは何度でも直せます"),
      ),
    );
    // 選んでいる週のボタンが見えるように、横にスクロールする
    app.querySelector('.week-tab[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  /** 週を切り替えるボタン（横にスクロール） */
  function weekTabs() {
    return createElement("div", { class: "week-tabs" },
      weeks.map((period, index) => {
        const done = (period.savedBefore || period.touched) && !period.days.some((day) => day.kind === "none");   // 全部の日を選び終わった週か
        return createElement("button", {
          class: "chip week-tab",
          "aria-pressed": String(index === current),
          onclick: () => { current = index; message = ""; draw(); },
        },
          createElement("span", { class: "num" }, `${shortLabel(period.weekStart)}〜`),
          createElement("span", { class: `week-tab__state ${done ? "is-done" : ""}` }, period.touched ? "未保存" : done ? "入力済み" : "未入力"),
        );
      }));
  }

  /** 1日分のカード */
  function dayCard(shift, dayIndex) {
    // 立場で選べるものが違う
    const choices = isShain
      ? [["any", "入れる", "ok"], ["off", "休み希望", "danger"], ["time", "時間指定", "hall"]]
      : [["no", "入れない", "danger"], ["any", "いつでもOK", "ok"], ["time", "時間指定", "hall"]];

    const wd = weekdayNum(shift.date);   // 曜日の番号
    const stateText = {   // 今の選び方を文にしたもの
      none: "未入力", no: "入れない", any: isShain ? "入れる" : "いつでもOK",
      off: "休み希望", offx: "特別許可を申請中", time: range(shift.from, shift.to),
    }[shift.kind];

    return createElement("section", { class: "card kibou-day" },
      createElement("div", { class: "kibou-day__head" },
        createElement("span", { class: `kibou-day__date ${wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : ""}` }, label(shift.date)),
        createElement("span", { class: `kibou-day__state ${shift.kind === "none" ? "is-none" : ""}` }, stateText),
      ),
      createElement("div", { class: "chip-grid" },
        choices.map(([kind, text, color]) =>
          createElement("button", {
            class: `chip chip--${color}`,
            "aria-pressed": String(shift.kind === kind || (kind === "off" && shift.kind === "offx")),
            onclick: () => pick(dayIndex, kind),
          }, text)),
      ),
      shift.kind === "time" ? timeRange(shift) : null,
    );
  }

  /** 時間指定の「から〜まで」 */
  function timeRange(shift) {
    /** 時刻を選ぶセレクト */
    const sel = (value, onChange, aria) => createElement("select", {
      class: "select num", "aria-label": aria,
      onchange: (event) => { onChange(Number(event.target.value)); weeks[current].touched = true; draw(); },
    }, timeOptions().map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));
    return createElement("div", { class: "time-range" },
      sel(shift.from, (value) => { shift.from = value; }, "から"),
      "〜",
      sel(shift.to, (value) => { shift.to = value; }, "まで"),
    );
  }

  // ============================================================
  // 操作
  // ============================================================

  /** 選んだ時 */
  function pick(dayIndex, kind) {
    message = "";
    const week = weeks[current];   // 今見ている週
    const day = week.days[dayIndex];   // 選んだ日
    week.touched = true;
    // 社員の休み希望（週ごとに数える。2026年11月5日）
    //   1日目 → ふつうの休み希望 ／ 2日目 → 特別許可の申請（offx）／ 3日目 → 出せない
    if (isShain && kind === "off" && day.kind !== "off" && day.kind !== "offx") {
      const offCount = week.days.filter((day) => day.kind === "off" || day.kind === "offx").length;   // 今の休み希望の数
      if (offCount >= CONFIG.SHAIN_OFF_MAX) {
        message = `休み希望は週${CONFIG.SHAIN_OFF_MAX}日までです。ほかの日を外してから選んでください。`;
        draw();
        return;
      }
      if (offCount >= CONFIG.SHAIN_OFF_FREE) {
        day.kind = "offx";
        message = `${label(day.date)}は${offCount + 1}日目の休み希望です。店長の特別許可を申請します。`;
        draw();
        return;
      }
    }
    day.kind = kind;
    draw();
  }

  /** 前の週と同じ選び方にする（2か月分を入れるのを楽にする） */
  function copyPrevWeek() {
    const prev = weeks[current - 1];   // 前の週
    const week = weeks[current];   // 今見ている週
    week.days.forEach((day, index) => {
      const shift = prev.days[index];   // 前の週の同じ曜日
      Object.assign(day, { kind: shift.kind === "offx" ? "off" : shift.kind, from: shift.from, to: shift.to });
    });
    week.touched = true;
    message = "";
    toast("前の週と同じにしました");
    draw();
  }

  /** 保存（さわった週をまとめて保存） */
  async function save() {
    const targets = weeks.filter((week) => week.touched);   // 保存する週（さわった週だけ）
    if (!targets.length) {
      toast("変えたところはありません");
      return;
    }
    // まちがいがあれば、その週を開いて知らせる
    for (const week of targets) {
      const idx = weeks.indexOf(week);   // その週の番号
      if (week.days.some((day) => day.kind === "time" && day.to <= day.from)) {
        current = idx; message = "時間指定の「まで」は「から」より後にしてください"; return draw();
      }
      const notYet = week.days.filter((day) => day.kind === "none").length;   // まだ選んでいない日の数
      if (notYet) {
        current = idx; message = `この週にまだ選んでいない日があります（${notYet}日）`; return draw();
      }
    }
    try {
      for (const period of targets) {
        // 保存する形にそろえる（時間指定以外は時刻を持たない）
        const rows = period.days.map((day) => ({
          date: day.date, kind: day.kind,
          from: day.kind === "time" ? day.from : null,
          to: day.kind === "time" ? day.to : null,
        }));
        await api.saveMyAvailabilities(period.weekStart, rows);
        period.touched = false;
        period.savedBefore = true;
      }
      toast(`希望を保存しました（${targets.length}週分）`);
      // 保存できたら前の画面に戻る（前がなければホームへ）
      if (history.length > 1) history.back();
      else go("/home");
    } catch (error) {
      message = error.message;
      draw();
    }
  }
}
