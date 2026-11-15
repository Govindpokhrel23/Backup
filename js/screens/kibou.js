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
import { state, isRealManager } from "../store.js";   // アプリの状態・本当に店長か調べる道具を読む
import { isTestMode } from "../lib/test-mode.js";   // テストモードか調べる道具を読む（2026年11月15日）
import { CONFIG } from "../config.js";   // 設定を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { label, shortLabel, weekdayNum, weekDates, mondayOf, addDays, today, toDate, toIso } from "../lib/date.js";   // 日付の道具を読む
import { range, timeOptions } from "../lib/time.js";   // 時間の道具を読む

/** 何か月先まで入れられるか */
const MONTHS_AHEAD = CONFIG.MONTHS_AHEAD;   // 何か月先まで出せるか

/** 希望入力の画面を描く */
export async function renderKibou(app) {   // 希望入力の画面を描く関数
  // ---------- テストモード：店長・開発者が、ほかの人の希望を代わりに入れる（2026年11月15日） ----------
  const proxyMode = isTestMode() && isRealManager();   // 代わりに入れるか
  const people = proxyMode ? (await api.testListPeople()).filter((person) => person.role !== "manager") : [];   // 代わりに入れられる人（店長・開発者はのぞく）
  if (proxyMode && !people.some((person) => person.id === state.proxyMemberId)) state.proxyMemberId = people[0]?.id || null;   // まだ選んでいなければ最初の人
  const target = proxyMode ? people.find((person) => person.id === state.proxyMemberId) : state.user;   // 希望を入れる人
  const asId = proxyMode ? target.id : undefined;   // API に渡す「代わりの人」（ふつうは渡さない）
  const isShain = target.kind === "shain";   // 社員か（社員は休み希望だけ出す）

  // ---------- 入れられる週を並べる（来週〜2か月先） ----------
  const limit = (() => { const date = toDate(today()); date.setMonth(date.getMonth() + MONTHS_AHEAD); return toIso(date); })();   // 出せる最後の日（2か月先）
  const starts = [];   // 入れられる週の月曜日（2か月先まで）
  for (let monday = addDays(mondayOf(today()), 7); monday <= limit; monday = addDays(monday, 7)) starts.push(monday);   // 来週から毎週の月曜日

  // 週ごとに「入れられるか」と「保存してある希望」を読む
  const locks = await Promise.all(starts.map((start) => api.weekLock(start)));   // 週ごとに出せるか調べる
  const saved = await api.listMyAvailabilities(starts[0], addDays(starts[starts.length - 1], 6), asId);   // 保存してある自分の希望（代わりの時はその人の希望）

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
  /** テストモード：だれの希望を入れるか選ぶ欄（変えると、その人の希望を読みなおす） */
  function proxyPicker() {   // 人を選ぶ欄を作る関数
    const groups = [["社員", (person) => person.kind === "shain"], ["バイト・フル", (person) => person.kind !== "shain"]];   // 分け方
    return createElement("label", { class: "field kibou-proxy" }, "🧪 だれの希望を入れる？（テストモード）",   // 見出し
      createElement("select", { class: "select", "aria-label": "希望を入れる人", onchange: async (event) => { state.proxyMemberId = event.target.value; await renderKibou(app); } },   // 選ぶ欄（変えたら描きなおす）
        groups.map(([title, test]) => createElement("optgroup", { label: title },   // まとまりごとに
          people.filter(test).map((person) => createElement("option", { value: person.id, selected: person.id === target.id }, `${person.name}（ID ${person.loginId}）`))))));   // 1人ずつ
  }

  function draw() {   // 画面を描く関数
    const week = weeks[current];   // 今見ている週
    const offCount = week.days.filter((day) => day.kind === "off" || day.kind === "offx").length;   // この週の休み希望の数（許可待ちも入れる）
    const notYet = week.days.filter((day) => day.kind === "none").length;   // まだ選んでいない日の数

    mount(app,   // 画面に入れる
      screenHeader({   // 見出し
        title: proxyMode ? "希望入力（代わりに入れる）" : "希望入力",   // タイトル
        right: createElement("span", { class: "badge" }, `${CONFIG.KIND_LABEL[target.kind]}（店長が設定）`),   // 立場の印
        sub: `2か月先（${label(limit)}）まで入れられます`,   // いつまで出せるか
        extra: [   // 見出しの下
          proxyMode ? proxyPicker() : null,   // テストモード：だれの希望か選ぶ
          weekTabs(),   // 週のタブ
          createElement("div", { class: "kibou-deadline" }, `${label(week.weekStart)}〜${label(addDays(week.weekStart, 6))} ／ 締切 ${label(addDays(week.weekStart, -1))} 24:00`),   // 週の日付と締切
          isShain   // 社員なら
            ? createElement("div", { class: "notice notice--warn", style: { fontWeight: 400 } },   // 休み希望の決まり
                `休み希望を出さないときは、休みは週1日（店長が決めます）。休み希望は週${CONFIG.SHAIN_OFF_MAX}日まで。${CONFIG.SHAIN_OFF_FREE + 1}日目の休みは店長の特別許可が必要です（この週 ${offCount}/${CONFIG.SHAIN_OFF_MAX}）。`)   // 説明
            : null,   // バイトには出さない
        ],
      }),
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
        createElement("div", { class: "home-muted", style: { textAlign: "center" } }, "入れた週はまとめて保存されます。締切までは何度でも直せます"),   // 説明
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
          createElement("span", { class: `week-tab__state ${done ? "is-done" : ""}` }, period.touched ? "未保存" : done ? "入力済み" : "未入力"),   // 未保存・入力済み
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

    return createElement("section", { class: "card kibou-day" },   // カード
      createElement("div", { class: "kibou-day__head" },   // 上の行
        createElement("span", { class: `kibou-day__date ${wd === 0 ? "is-sun" : wd === 6 ? "is-sat" : ""}` }, label(day.date)),   // 日付（土日は色を変える）
        createElement("span", { class: `kibou-day__state ${day.kind === "none" ? "is-none" : ""}` }, stateText),   // 今の状態
      ),
      createElement("div", { class: "chip-grid" },   // 選ぶボタン
        choices.map(([kind, text, color]) =>   // 選べるものごとに
          createElement("button", {   // ボタン
            class: `chip chip--${color}`,   // 色
            "aria-pressed": String(day.kind === kind || (kind === "off" && day.kind === "offx")),   // 選んでいるものに印
            onclick: () => pick(dayIndex, kind),   // 押したら選ぶ
          }, text)),   // 文字
      ),
      day.kind === "time" ? timeRange(day) : null,   // 時間指定なら時間の欄
    );
  }

  /** 時間指定の「から〜まで」 */
  function timeRange(day) {   // 時間の欄を作る関数
    /** 時刻を選ぶセレクト */
    const sel = (value, onChange, aria) => createElement("select", {   // 時間を選ぶ欄を作る
      class: "select num", "aria-label": aria,   // 見た目
      onchange: (event) => { onChange(Number(event.target.value)); weeks[current].touched = true; draw(); },   // 選んだら変えて描きなおす
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
    message = "";   // エラーの文を消す
    toast("前の週と同じにしました");   // お知らせ
    draw();   // 描く
  }

  /** 保存（さわった週をまとめて保存） */
  async function save() {   // 保存する関数
    const targets = weeks.filter((week) => week.touched);   // 保存する週（さわった週だけ）
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
        await api.saveMyAvailabilities(period.weekStart, rows, asId);   // 保存（代わりの時はその人の分）
        period.touched = false;   // 変えた印を消す
        period.savedBefore = true;   // 保存した印
      }
      toast(`${proxyMode ? `${target.name}の` : ""}希望を保存しました（${targets.length}週分）`);   // お知らせ
      if (proxyMode) {   // 代わりに入れている時は、次の人へ進む（続けて入れられるように）
        const next = people[people.findIndex((person) => person.id === target.id) + 1];   // 次の人
        if (next) { state.proxyMemberId = next.id; await renderKibou(app); window.scrollTo(0, 0); }   // 次の人の画面にする
        return;   // 前の画面にはもどらない
      }
      // 保存できたら前の画面に戻る（前がなければホームへ）
      if (history.length > 1) history.back();   // 前の画面にもどる
      else go("/home");   // なければホームへ
    } catch (error) {   // 失敗した時
      message = error.message;   // エラーの文
      draw();   // 描く
    }
  }
}
