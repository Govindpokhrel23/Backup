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

import { createElement, mount, toast } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state } from "../store.js";   // アプリの状態を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { label, shortLabel, weekdayNum, weekDates, mondayOf, addDays, today, toDate, toIso } from "../lib/date.js";   // 日付の道具を読む
import { range, timeOptions } from "../lib/time.js";   // 時間の道具を読む

/** 何か月先まで入れられるか */
const MONTHS_AHEAD = CONFIG.MONTHS_AHEAD;   // 何か月先まで出せるか

/** 希望入力の画面を描く */
export async function renderKibou(app) {   // 希望入力の画面を描く関数
  const isShain = state.user.kind === "shain";   // 社員か（社員は休み希望だけ出す）

  // ---------- 入れられる週を並べる（来週〜2か月先） ----------
  const limit = (() => { const date = toDate(today()); date.setMonth(date.getMonth() + MONTHS_AHEAD); return toIso(date); })();   // 出せる最後の日（2か月先）
  const starts = [];   // 入れられる週の月曜日（2か月先まで）
  for (let monday = addDays(mondayOf(today()), 7); monday <= limit; monday = addDays(monday, 7)) starts.push(monday);   // 来週から毎週の月曜日

  // 週ごとに「入れられるか」と「保存してある希望」を読む
  const locks = await Promise.all(starts.map((start) => api.weekLock(start)));   // 週ごとに出せるか調べる
  const saved = await api.listMyAvailabilities(addDays(starts[0], -7), addDays(starts[starts.length - 1], 6));   // 保存してある自分の希望（今週の分も読む＝来週の参考にするため）

  // ---------- 画面の中で持つ「今の入力」 ----------
  // 週1つ：{ weekStart, lock, days:[{date, kind, from, to}], touched, savedBefore }
  const weeks = starts   // 週の一覧
    .map((weekStart, index) => ({ weekStart, lock: locks[index] }))   // 週の始まりと出せない理由
    .filter((start) => !start.lock)                         // 締め切った週は出さない
    .map((period) => {   // 週ごとに
      const days = weekDates(period.weekStart).map((date) => {   // その週の7日分
        const savedHope = saved.find((hope) => hope.date === date);   // その日の保存してある希望
        if (savedHope) return { date, kind: savedHope.kind, from: savedHope.from ?? 9 * 60, to: savedHope.to ?? 15 * 60 };   // 保存してある希望があれば、それを入れる
        // まだ入れていない日：社員は「入れる」、バイトは「未入力」
        return { date, kind: isShain ? "any" : "none", from: 9 * 60, to: 15 * 60 };   // なければ、社員は「入れる」、バイトは「未入力」
      });
      const savedBefore = weekDates(period.weekStart).some((date) => saved.some((hope) => hope.date === date));   // 前に保存したことがある週か
      return { ...period, days, touched: false, savedBefore };   // 週・7日・変えたか・前に保存したか
    });

  // ---------- まだ出していない週は、前の週の希望を参考に入れておく（2026年11月16日） ----------
  // 変えなければ、そのまま「保存する」で保存できる（前の週と同じ希望になる）
  let prevDays = weekDates(addDays(starts[0], -7)).map((date) => saved.find((hope) => hope.date === date) || null);   // 今週の希望（来週の参考）
  for (const week of weeks) {   // 週ごとに（早い順）
    if (!week.savedBefore && prevDays.some(Boolean)) {   // まだ出していなくて、前の週に希望があれば
      week.days.forEach((day, index) => {   // 7日ごとに
        const prevDay = prevDays[index];   // 前の週の同じ曜日
        if (prevDay) Object.assign(day, { kind: prevDay.kind === "offx" ? "off" : prevDay.kind, from: prevDay.from ?? 9 * 60, to: prevDay.to ?? 15 * 60 });   // 同じにする（特別許可は休み希望にもどす）
      });
      if (isShain) {   // 社員は、休み希望が決まりより多ければ、多い分を「特別許可の申請」にもどす
        let offs = 0;   // 休み希望の数
        week.days.forEach((day) => { if (day.kind === "off" && ++offs > CONFIG.SHAIN_OFF_FREE) day.kind = "offx"; });   // 2日目からは特別許可
      }
      week.prefilled = true;   // 前の週から入れた印
      week.touched = true;   // 保存する週に入れる（変えなくても「保存する」で保存される）
    }
    prevDays = week.days.map((day) => (day.kind === "none" ? null : day));   // 次の週の参考
  }

  if (!weeks.length) {   // 出せる週がなければ
    mount(app,   // 画面に入れる
      screenHeader({ title: "希望入力" }),   // 見出し
      createElement("div", { class: "screen-body" }, createElement("div", { class: "card" }, "いまは希望を入れられる週がありません。")));   // 説明
    return;   // 終わり
  }

  let current = 0;      // 表示している週（weeks の何番目か）
  let message = "";   // 画面に出すお知らせの文
  draw();   // はじめに描く

  // ============================================================
  // 描く
  // ============================================================
  function draw() {   // 画面を描く関数
    const week = weeks[current];   // 今見ている週
    const offCount = week.days.filter((day) => day.kind === "off" || day.kind === "offx").length;   // この週の休み希望の数（許可待ちも入れる）
    const notYet = week.days.filter((day) => day.kind === "none").length;   // まだ選んでいない日の数

    mount(app,   // 画面に入れる
      // 見出し（2026年11月16日：小さくした。社員の休みの決まりの注意は外した＝ヘルプにある）
      createElement("header", { class: "screen-header screen-header--compact kibou-head" },   // 見出しの入れ物
        createElement("div", { class: "kibou-head__row" },   // 1行目
          createElement("strong", { class: "kibou-head__title" }, "希望入力"),   // タイトル
          createElement("span", { class: "badge" }, CONFIG.KIND_LABEL[state.user.kind])),   // 立場の印
        weekTabs(),   // 週のタブ
        week.prefilled ? createElement("div", { class: "kibou-prefill" }, "前の週と同じ希望を入れました。変えなければ、そのまま保存できます") : null,   // 前の週から入れた時の説明
        createElement("div", { class: "kibou-deadline" }, `${shortLabel(week.weekStart)}〜${shortLabel(addDays(week.weekStart, 6))}　締切 ${shortLabel(addDays(week.weekStart, -1))} 24時${isShain ? `　休み ${offCount}/${CONFIG.SHAIN_OFF_MAX}` : ""}`),   // 週の日付と締切（社員は休みの数も）
      ),
      createElement("div", { class: "screen-body kibou-body" },   // 本文
        current > 0   // 2週目からは
          ? createElement("button", { class: "btn btn--small btn--dashed", onclick: copyPrevWeek }, "前の週と同じにする")   // 前の週と同じにするボタン
          : null,   // 1週目は出さない
        week.days.map((day, index) => dayCard(day, index)),   // 7日分のカード
        message ? createElement("div", { class: "notice notice--danger" }, message) : null,   // エラーの文
      ),
      createElement("div", { class: "kibou-footer" },   // 下の保存の所
        createElement("button", { class: "btn btn--primary btn--block", onclick: save },   // 保存ボタン
          notYet ? `保存する（この週の未入力 ${notYet}日）` : "保存する"),   // 未入力の日数を出す
      ),
    );
    // 選んでいる週のボタンが見えるように、横にスクロールする
    app.querySelector('.week-tab[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });   // 選んでいる週のタブを真ん中に見せる
  }

  /** 週を切り替えるボタン（横にスクロール） */
  function weekTabs() {   // 週のタブを作る関数
    return createElement("div", { class: "week-tabs" },   // タブの入れ物
      weeks.map((period, index) => {   // 週ごとに
        const done = (period.savedBefore || period.touched) && !period.days.some((day) => day.kind === "none");   // 全部の日を選び終わった週か
        return createElement("button", {   // タブのボタン
          class: "chip week-tab",   // 見た目
          "aria-pressed": String(index === current),   // 選んでいる週に印
          onclick: () => { current = index; message = ""; draw(); },   // 押したらその週へ
        },
          createElement("span", { class: "num" }, `${shortLabel(period.weekStart)}〜`),   // 週の始まり
          createElement("span", { class: `week-tab__state ${done ? "is-done" : ""}` }, period.prefilled ? "前の週から" : period.touched ? "未保存" : done ? "入力済み" : "未入力"),   // 前の週から・未保存・入力済み
        );
      }));
  }

  /** 1日分のカード */
  function dayCard(day, dayIndex) {   // 1日のカードを作る関数
    // 立場で選べるものが違う
    const choices = isShain   // 選べるもの
      ? [["any", "入れる", "ok"], ["off", "休み希望", "danger"], ["time", "時間指定", "hall"]]   // 社員：入れる・休み希望・時間指定
      : [["no", "入れない", "danger"], ["any", "いつでもOK", "ok"], ["time", "時間指定", "hall"]];   // バイト：入れない・いつでもOK・時間指定

    const wd = weekdayNum(day.date);   // 曜日の番号
    const stateText = {   // 今の選び方を文にしたもの
      none: "未入力", no: "入れない", any: isShain ? "入れる" : "いつでもOK",   // 今の状態の文
      off: "休み希望", offx: "特別許可を申請中", time: range(day.from, day.to),   // 今の状態の文
    }[day.kind];   // その日の種類の文

    // 1日1行（左に日付・右に3つのボタン）。1週間が1画面に入るように（2026年11月16日）
    return createElement("section", { class: `kibou-day ${day.kind === "none" ? "is-none" : ""} ${day.kind === "time" ? "is-time" : ""}` },   // 1日の行
      createElement("div", { class: `kibou-day__date ${wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : ""}` },   // 日付（土日は色を変える）
        createElement("span", { class: "kibou-day__num" }, String(Number(day.date.slice(8)))),   // 日にち「23」
        createElement("span", { class: "kibou-day__dow" }, label(day.date).match(/（(.)）/)?.[1] || "")),   // 曜日「月」
      createElement("div", { class: "kibou-day__chips", title: stateText },   // 選ぶボタン
        choices.map(([kind, text, color]) =>   // 選べるものごとに
          kind === "time" && day.kind === "time"   // 時間指定を選んでいれば
            ? timeRange(day)   // ボタンの所に時間の欄を出す（1行のまま）
            : createElement("button", {   // ボタン
                class: `chip chip--${color}`,   // 色
                "aria-pressed": String(day.kind === kind || (kind === "off" && day.kind === "offx")),   // 選んでいるものに印
                onclick: () => pick(dayIndex, kind),   // 押したら選ぶ
              }, day.kind === "time" ? shortText(text) : text)),   // 文字（時間の欄がある時は短く）
      ),
    );
  }

  /** 時間の欄を出している時の、ボタンの短い文字 */
  function shortText(text) {   // 短い文字にする関数
    return { "いつでもOK": "OK", "休み希望": "休み" }[text] || text;   // 長いものだけ短く
  }

  /** 時間指定の「から〜まで」 */
  function timeRange(day) {   // 時間の欄を作る関数
    /** 時刻を選ぶセレクト */
    const sel = (value, onChange, aria) => createElement("select", {   // 時間を選ぶ欄を作る
      class: "select num", "aria-label": aria,   // 見た目
      onchange: (event) => { onChange(Number(event.target.value)); weeks[current].touched = true; weeks[current].prefilled = false; draw(); },   // 選んだら変えて描きなおす
    }, timeOptions().map((timeOption) => createElement("option", { value: timeOption.value, selected: timeOption.value === value }, timeOption.label)));   // 15分ごとの時間
    return createElement("div", { class: "time-range" },   // 時間の行
      sel(day.from, (value) => { day.from = value; }, "から"),   // から
      "〜",   // 〜
      sel(day.to, (value) => { day.to = value; }, "まで"),   // まで
    );
  }

  // ============================================================
  // 操作
  // ============================================================

  /** 選んだ時 */
  function pick(dayIndex, kind) {   // 選んだ時の関数
    message = "";   // エラーの文を消す
    const week = weeks[current];   // 今見ている週
    const day = week.days[dayIndex];   // 選んだ日
    week.touched = true;   // 変えた印
    week.prefilled = false;   // 自分で変えたので「前の週から」の印は消す
    // 社員の休み希望（週ごとに数える。2026年11月5日）
    //   1日目 → ふつうの休み希望 ／ 2日目 → 特別許可の申請（offx）／ 3日目 → 出せない
    if (isShain && kind === "off" && day.kind !== "off" && day.kind !== "offx") {   // 社員が休み希望を選んだら
      const offCount = week.days.filter((day) => day.kind === "off" || day.kind === "offx").length;   // 今の休み希望の数
      if (offCount >= CONFIG.SHAIN_OFF_MAX) {   // 上限をこえるなら
        message = `休み希望は週${CONFIG.SHAIN_OFF_MAX}日までです。ほかの日を外してから選んでください。`;   // エラーの文
        draw();   // 描く
        return;   // 止める
      }
      if (offCount >= CONFIG.SHAIN_OFF_FREE) {   // 2日目なら
        day.kind = "offx";   // 特別許可の申請にする
        message = `${label(day.date)}は${offCount + 1}日目の休み希望です。店長の特別許可を申請します。`;   // 説明
        draw();   // 描く
        return;   // 止める
      }
    }
    day.kind = kind;   // 選んだものにする
    draw();   // 描く
  }

  /** 前の週と同じ選び方にする（2か月分を入れるのを楽にする） */
  function copyPrevWeek() {   // 前の週と同じにする関数
    const prev = weeks[current - 1];   // 前の週
    const week = weeks[current];   // 今見ている週
    week.days.forEach((day, index) => {   // 7日ごとに
      const prevDay = prev.days[index];   // 前の週の同じ曜日
      Object.assign(day, { kind: prevDay.kind === "offx" ? "off" : prevDay.kind, from: prevDay.from, to: prevDay.to });   // 同じにする（特別許可は休み希望にもどす）
    });
    week.touched = true;   // 変えた印
    week.prefilled = false;   // 自分で写したので「前の週から」の印は消す
    message = "";   // エラーの文を消す
    toast("前の週と同じにしました");   // お知らせ
    draw();   // 描く
  }

  /** 保存（さわった週をまとめて保存） */
  async function save() {   // 保存する関数
    // 保存する週：さわった週と、前の週から入れた週（前の週から入れた週に未入力の日が残っていれば、その週はまだ保存しない）
    const targets = weeks.filter((week) => week.touched && !(week.prefilled && week.days.some((day) => day.kind === "none")));   // 保存する週
    if (!targets.length) {   // 変えた週がなければ
      toast("変えたところはありません");   // お知らせ
      return;   // 止める
    }
    // まちがいがあれば、その週を開いて知らせる
    for (const week of targets) {   // 変えた週ごとに
      const idx = weeks.indexOf(week);   // その週の番号
      if (week.days.some((day) => day.kind === "time" && day.to <= day.from)) {   // 時間がおかしければ
        current = idx; message = "時間指定の「まで」は「から」より後にしてください"; return draw();   // その週を出して止める
      }
      const notYet = week.days.filter((day) => day.kind === "none").length;   // まだ選んでいない日の数
      if (notYet) {   // 未入力があれば
        current = idx; message = `この週にまだ選んでいない日があります（${notYet}日）`; return draw();   // その週を出して止める
      }
    }
    try {   // 失敗しても止まらないように
      for (const period of targets) {   // 週ごとに
        // 保存する形にそろえる（時間指定以外は時刻を持たない）
        const rows = period.days.map((day) => ({   // 保存する形
          date: day.date, kind: day.kind,   // 日付・種類
          from: day.kind === "time" ? day.from : null,   // 始まり
          to: day.kind === "time" ? day.to : null,   // 終わり
        }));
        await api.saveMyAvailabilities(period.weekStart, rows);   // 保存
        period.touched = false;   // 変えた印を消す
        period.prefilled = false;   // 「前の週から」の印も消す
        period.savedBefore = true;   // 保存した印
      }
      toast(`希望を保存しました（${targets.length}週分）`);   // お知らせ
      // 保存できたら前の画面に戻る（前がなければホームへ）
      if (history.length > 1) history.back();   // 前の画面にもどる
      else go("/home");   // なければホームへ
    } catch (error) {   // 失敗した時
      message = error.message;   // エラーの文
      draw();   // 描く
    }
  }
}
