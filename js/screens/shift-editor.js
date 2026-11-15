// ============================================================
// screens/shift-editor.js — シフト作成（店長）
// ------------------------------------------------------------
// このファイルは、シフト作成（店長）のファイルです。
// この画面でできること：
//   ・週と日を選んで、紙と同じ形のシフト表を見る（希望は薄い緑）
//   ・線をドラッグして時間を変える／右の欄で細かく直す
//   ・「AIで作成」で下書き、「前週コピー」で先週と同じにする
//   ・ルールのチェックを常に表示（赤＝守れていない）
//   ・「公開する」：守れていなければ⚠️警告 →「はい」でそのまま公開
//   ・公開したあとは見るだけ。「編集する」を押すと直せる（2026年11月3日）
//   ・「前の週／次の週」で2か月先まで作れる。ほかの店舗に入っている時間は灰色で出る
//   ・店長は何でも自由に直せる（2026年11月3日）：
//       時間は 5:00〜翌2:00、1日に2つの勤務（中抜け）、別の人に移す、
//       日のコピー・全部消す、連絡事項、「元に戻す」「やり直す」
//   ・2026年11月5日に足したこと：
//       「AIで作成」→ Gemini が作る（ai/draft-service.js）。結果は一番上の「AIの結果」に出る
//       「AIに直してもらう」→ 守れていないルールだけ AI が直す
//       公開した時、AIの下書きから店長が直した所を覚える（ai/learning.js）
//       公開した時、人が足りない時間があれば、入れそうな人に自動で連絡する（api/mock-calls.js）
//       「＋ 人を追加」→ ほかの店舗の人・まだアカウントがない人を足す（components/add-person.js）
// 変えた内容はすぐ下書きとして保存する（閉じても消えない）。
// ============================================================

import { createElement, mount, toast, confirmDialog, busy } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { timeline } from "../components/timeline.js";   // タイムラインの部品を読む
import { checkDay, checkWeek, onlyProblems, requiredAt, assignedAt, findShortages } from "../rules/shift-rules.js";   // シフトのルールの道具を読む
import { runAiDraft, fixWithAi } from "../ai/draft-service.js";   // AIで下書き・直す道具を読む
import { aiReady } from "../ai/ai-settings.js";   // AIを使えるか調べる道具を読む
import { aiResultCard } from "../components/ai-result.js";   // AIの結果のカードを読む
import { openAddPerson } from "../components/add-person.js";   // 人を追加の小さい画面を読む
import { mergeNeeds } from "../rules/candidates.js";   // 足りない時間をまとめる道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { STATUS_LABEL, weekLabel, weekShort, datesOf, workingPeriod } from "../lib/period.js";   // 週の表示の道具を読む
import { label, dayType, addDays, mondayOf, toIso, monthStart, monthEnd } from "../lib/date.js";   // 日付の道具を読む
import { checkLabor, usageOf } from "../rules/labor-rules.js";   // 働き方のルールの道具を読む
import { state, switchStore, activeStores } from "../store.js";   // アプリの状態・店舗を切りかえる道具を読む
import { range, EDIT_MIN, EDIT_MAX } from "../lib/time.js";   // 時間の道具を読む
import { createHistory } from "../lib/history.js";   // 元に戻す・やり直しの道具を読む
import { assignmentPanel } from "../components/assignment-panel.js";   // 右の欄の部品を読む
import { dayList } from "../components/day-list.js";   // 1日の一覧の部品を読む
import { printWeek } from "../components/print-week.js";   // 印刷の道具を読む
import { laborCost, minutesByMember, hoursText, yen } from "../lib/labor.js";
import { hoursOn } from "../lib/store-hours.js";   // その日の営業時間（休み・時間の変更も入れる）の道具を読む（2026年11月15日）
import { hopeList } from "../components/hope-list.js";   // 希望の一覧の部品を読む（2026年11月15日）
import { weekGrid } from "../components/week-grid.js";   // 1週間の表の部品を読む（2026年11月10日）   // 時間とお金の計算の道具を読む

/** シフト作成の画面を描く（店長） */
export async function renderShiftEditor(app) {   // シフト作成の画面を描く関数
  // ---------- 最初に全部読む ----------
  // periods＝週の一覧 / baseMembers＝この店舗で働ける人 / positions・requirements＝マップと必要人数 /
  // holidays＝祝日 / rules＝人ごとのルール / storeHours＝営業時間 / wages＝時給 / learnings＝店長の直し方
  const [periods, baseMembers, positions, requirements, holidays, rules, storeHours, wages, learnings] = await Promise.all([   // はじめに同時に読むもの
    api.listPeriods(), api.listMembers(), api.listPositions(), api.listRequirements(),   // 週・店員・場所・必要人数
    api.listHolidays(), api.listMemberRules(), api.getStoreHours(), api.listWages(), api.listLearnings(),   // 祝日・メモ・営業時間・時給・覚えたこと
  ]);
  let company = null;           // 会社の店員みんな（「人を追加」と応援の人の情報。はじめて使う時に読む）
  let members = baseMembers;    // 表に出す人＝この店舗の人＋この週だけの応援（loadPeriod で作り直す）
  let active = members.filter((member) => member.active);   // 表に出す人のうち、休止していない人
  /** 人ごとのルール */
  const ruleOf = (id) => rules.find((rule) => rule.memberId === id)?.text || "なし";   // その人のメモ（なければ「なし」）
  /** 平日／土曜／日曜祝日 */
  const dayTypeOf = (date) => dayType(date, holidays);   // 日の種類（平日・土曜・日祝）
  const hoursOf = (date) => hoursOn(storeHours, date, dayTypeOf(date));   // その日の営業時間（店舗の設定の「休み・時間の変更」も入れる）
  /** お休みの日か（店舗の設定で「休み」にした日） */
  const isClosed = (date) => hoursOf(date).closed;   // お休みなら true

  // ---------- 画面の中で持つ状態 ----------
  let period = workingPeriod(periods);   // 作る週
  let work = [];           // この週の勤務（下書き・公開済み）
  let hopes = [];          // この週の希望
  let date = null;         // 表示している日
  let selectedId = null;   // 右の欄で見ている店員
  let elsewhere = [];      // この週にほかの店舗に入っている勤務（重ねないため・見るだけ）
  let others = [];         // この週以外の勤務（全部の店舗）＋この週のほかの店舗の勤務。月・年の上限と連勤を数える（2026年11月6日）
  let unlocked = false;    // 公開済みの週で「編集する」を押したか
  let aiResult = null;     // 一番上に出す「AIの結果」{result, kind, before}（閉じたら null）
  const history = createHistory();   // 「元に戻す」用
  let view = loadView();   // 見方："week"＝1週間の表 ／ "day"＝1日のタイムライン（前に選んだ方を覚えておく）

  /** 公開済みで、まだ「編集する」を押していない＝直せない */
  const locked = () => period.status === "published" && !unlocked;   // 変えられないか（公開済みで「編集する」を押していない）

  /** 何週先までシフトを作れるか（希望と同じ2か月先まで） */
  const lastWeek = (() => {   // 選べる一番先の週
    const limit = new Date(); limit.setMonth(limit.getMonth() + CONFIG.MONTHS_AHEAD);   // 今日から2か月先
    return mondayOf(toIso(limit));   // その週の月曜日
  })();   // すぐ計算

  // まだ週が1つもない店舗（増やしたばかりの店舗など）は、来週の受付を作って始める
  if (!period) {   // 週がなければ
    period = await api.ensurePeriod(addDays(mondayOf(toIso(new Date())), 7));   // 来週を作る
    periods.push(period);   // 一覧に足す
  }
  await loadPeriod();   // 週の中身を読む
  draw();   // 描く

  /**
   * AIに渡す店員に、働き方のルールをつける（2026年11月6日）
   *   minor … 18歳未満（22時〜朝5時は入れない）
   *   leftMinutes … この週に入れてよい残りの時間（月の上限・年の上限から計算。なければ null）
   */
  function withLimits(member) {   // AIに渡す店員に、18歳未満と残りの時間を付ける関数
    const personLimit = limitsMap().get(member.id) || {};                                      // その人のルール
    const use = usageOf(member.id, period.weekStart, others, personLimit);                     // この週より前の今月・今年
    const lefts = [];                                                             // 残りの時間の候補
    if (personLimit.monthHoursMax) lefts.push(personLimit.monthHoursMax * 60 - use.monthMinutes);   // 月の上限の残り
    if (personLimit.yearYenMax && personLimit.hourly) lefts.push(((personLimit.yearYenMax - use.yearYen) / personLimit.hourly) * 60);   // 年の上限の残り（時間に直す）
    return { ...member, minor: !!personLimit.minor, leftMinutes: lefts.length ? Math.max(0, Math.floor(Math.min(...lefts))) : null };   // 一番少ない残りを付ける
  }

  // ============================================================
  // データの読み込みと保存
  // ============================================================

  async function loadPeriod() {   // 週の中身を読む関数
    const end = addDays(period.weekStart, 6);   // その週の日曜
    let all;   // 全部の店舗の勤務
    [work, hopes, all] = await Promise.all([   // 同時に読む
      api.listAssignments(period.id),   // この週の勤務
      api.listAvailabilities(period.id),   // この週の希望
      api.listAssignmentsByDates(period.weekStart, end),   // この週の全部の店舗の勤務
    ]);
    // ほかの店舗の勤務に、店舗の短い名前（福釜・安城・今村）をつける
    const shortOf = (id) => state.stores.find((store) => store.id === id)?.short || "";   // 店舗IDから短い名前
    elsewhere = all.filter((shift) => shift.storeId !== period.storeId).map((shift) => ({ ...shift, storeShort: shortOf(shift.storeId) }));   // ほかの店舗の勤務
    await loadHistory(end);   // 月・年・連勤のための勤務を読む
    await loadGuests();   // この週だけ足した人を読む
    if (!date || !datesOf(period).includes(date)) date = period.weekStart;   // 見ている日がこの週になければ週の始まり
  }

  /**
   * 働き方のルール（月・年の上限・連勤）を数えるための、ほかの週の勤務を読む
   *   ・全員：その月の1日（か、6日前のおそい方）〜 その月の最後の日
   *   ・年の上限がある人だけ：1月1日〜 その月の前の日
   * @param {string} end その週の日曜
   */
  async function loadHistory(end) {   // 月・年・連勤のための勤務を読む関数
    const from = [monthStart(period.weekStart), addDays(period.weekStart, -CONFIG.MAX_STREAK_DAYS)].sort()[0];   // 読み始める日
    const to = monthEnd(end);                                                                                    // 読み終わる日
    const yearIds = wages.filter((wage) => wage.yearYenMax).map((wage) => wage.memberId);                                     // 年の上限がある人
    const yearStart = `${period.weekStart.slice(0, 4)}-01-01`;                                                    // その年の1月1日
    const [near, year] = await Promise.all([   // 近くの日の勤務（全員）と、年の上限がある人の今年の勤務
      api.listAssignmentsByDates(from, to),   // 前後の勤務
      yearIds.length && yearStart < from ? api.listAssignmentsByDates(yearStart, addDays(from, -1), yearIds) : [],   // 上限がある人の今年の分
    ]);
    others = [...near, ...year].filter((shift) => shift.periodId !== period.id);   // この週以外の分
  }

  /** 店員ID → 働き方のルール（18歳未満・月の上限時間・年の上限金額・時給） */
  function limitsMap() {   // 店員ID → 時給とルール の表を作る関数
    return new Map(wages.map((wage) => [wage.memberId, wage]));   // 作って返す
  }

  /**
   * この週だけの応援の人（period.guests）を表に足す
   * 応援の人は「応援（ほかの店舗から）」の所に出る（rankHere を 9 にする）
   */
  async function loadGuests() {   // この週だけ足した人を読む関数
    const ids = (period.guests || []).filter((id) => !baseMembers.some((baseMember) => baseMember.id === id));   // まだ表にいない応援の人
    if (ids.length && !company) company = await api.listCompanyMembers();   // 会社の店員を読む（まだなら）
    const guests = ids.map((id) => company.find((member) => member.id === id)).filter(Boolean).map((id) => ({ ...id, rankHere: 9, guest: true }));   // 応援の人（rankHere 9）
    members = [...baseMembers, ...guests];   // 店員の一覧
    active = members.filter((member) => member.active);   // 休止していない人
  }

  /** 今の勤務を下書きとして保存して、描き直す */
  async function persist() {   // 保存して描きなおす関数
    await api.saveAssignments(period.id, work);   // 保存
    draw();   // 描く
  }

  /**
   * 勤務を変える時は必ずこれを通す
   * 変える前の状態を覚えておくので「元に戻す」ができる
   */
  function edit(change) {   // 勤務を変える関数（元に戻せるようにする）
    if (locked()) { toast("公開済みです。直す時は「編集する」を押してください"); return; }   // 変えられなければ止める
    history.push(work);   // 今の状態を記録
    change();   // 変える
    persist();   // 保存して描く
  }

  /** 元に戻す／やり直す */
  function undo() { const snapshot = history.undo(work); if (snapshot) { work = snapshot; persist(); } }   // 元に戻す関数
  /** やり直す */
  function redo() { const snapshot = history.redo(work); if (snapshot) { work = snapshot; persist(); } }   // やり直す関数

  /**
   * その日の表の左端と右端
   * 営業時間をもとに、それより外の勤務があれば広げる（1時間単位）
   */
  function dayRange(date) {   // 表示する時間のはばを出す関数
    const hrs = hoursOf(date);   // その日の営業時間
    const day = work.filter((shift) => shift.date === date);   // その日の勤務
    const start = Math.min(hrs.open, ...day.map((shift) => shift.from));   // 左端（分）
    const end = Math.max(hrs.close, ...day.map((shift) => shift.to));   // 右端（分）
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };   // 1時間きざみ
  }

  // ============================================================
  // チェック
  // ============================================================

  /**
   * ある日のチェック結果
   * @param {string} date       日付
   * @param {object[]} rows  調べる勤務の一覧（ふつうは今の勤務 work。AIの案を比べる時はその案）
   */
  function dayChecks(date, rows = work) {   // 1日のルールを調べる関数
    if (isClosed(date)) {   // お休みの日は、ふつうのチェックをしない
      const count = rows.filter((row) => row.date === date).length;   // その日に入っている勤務の数
      return [{ ok: count === 0, code: "closed", date, text: count ? `お休みの日に勤務が${count}件入っています` : "お休みの日" }];   // 勤務があればだめ
    }
    return checkDay({   // 調べる
      date: date,   // 日付
      dayType: dayTypeOf(date),   // 日の種類
      hours: hoursOf(date),   // 営業時間
      assignments: rows.filter((row) => row.date === date),   // この店舗のその日の勤務
      // ほかの店舗の勤務も入れて、同じ時間に2つ入っていないか確かめる
      allStoreAssignments: [...rows.filter((row) => row.date === date), ...elsewhere.filter((shift) => shift.date === date)],   // 全部の店舗のその日の勤務（重なりを調べる）
      members, requirements, positions,   // 店員・必要人数・場所
      availabilities: hopes.filter((hope) => hope.date === date),   // その日の希望
    });
  }

  /** 週全体のチェック結果（rows：調べる勤務の一覧） */
  function weekChecks(rows = work) {   // 1週間のルールを調べる関数
    // 週1休み・社員の休みは、ほかの店舗に入った日も「入った日」として数える
    // （応援で来ている人は、その人のメインの店舗の画面で数える）
    const mains = active.filter((member) => (member.rankHere ?? 1) === 1);   // 所属店の人
    return [   // 返す
      ...checkWeek({ dates: datesOf(period), assignments: [...rows, ...elsewhere], members: mains, availabilities: hopes }),   // 週1休み・社員の休み・特別許可
      // 働き方のルール（18歳未満・連勤・月と年の上限）。応援の人も、この店舗の勤務の分は数える
      ...checkLabor({ dates: datesOf(period), week: rows, others, members: active, limits: limitsMap() }),   // 働き方のルール
    ];
  }

  /** 守れていないもの全部（公開の確認・AIの結果で使う。rows：調べる勤務の一覧） */
  function allProblems(rows = work) {   // 全部の問題を出す関数
    const list = [];                                     // {day, text}
    for (const date of datesOf(period)) onlyProblems(dayChecks(date, rows)).forEach((problem) => list.push({ day: label(date), text: problem.text }));   // 日ごとの問題
    onlyProblems(weekChecks(rows)).forEach((problem) => list.push({ day: "週全体", text: problem.text }));   // 週の問題
    return list;   // 返す
  }

  /** この週の人が足りない時間（自動連絡に使う）{date, area, from, to, short} */
  function weekShortages(rows = work) {   // 1週間の足りない時間を出す関数
    return datesOf(period).flatMap((date) =>   // 7日ごとに
      findShortages(rows.filter((row) => row.date === date), requirements, positions, dayTypeOf(date), hoursOf(date)).map((need) => ({ ...need, date: date })));   // 足りない時間
  }

  /** AIに渡す情報（ai/draft-service.js の ctx） */
  function aiContext(past = []) {   // AIに渡す中身を作る関数
    return {   // 返す
      dates: datesOf(period).filter((date) => !isClosed(date)), members: active.map(withLimits),   // お休みの日はAIに作らせない
      availabilities: hopes, requirements, positions,   // 7日・店員・希望・必要人数など
      fixed: work.filter((shift) => shift.fixed), past, dayTypeOf, hoursOf, elsewhere, rules, learnings,   // 固定した勤務・前の週など
      problemsOf: (rows) => allProblems(rows),   // 問題を調べる関数
    };
  }

  // ============================================================
  // 見方（1週間／1日）を覚える（2026年11月10日）
  // ============================================================

  /** 前に選んだ見方を読む（はじめは1週間） */
  function loadView() {   // 見方を読む関数
    try { return localStorage.getItem("shiftapp-editor-view") === "day" ? "day" : "week"; }   // 保存があればそれ
    catch (error) { return "week"; }   // 読めない時は1週間
  }

  /** 見方を変えて、覚えておく */
  function setView(next) {   // 見方を変える関数
    view = next;   // 変える
    try { localStorage.setItem("shiftapp-editor-view", next); } catch (error) { /* 保存できなくても動く */ }   // 覚える
    draw();   // 描きなおす
  }

  /** 週の表のマスを押した時：その日・その人の「1日」の画面にする */
  function pickFromWeek(pickedDate, memberId) {   // 週の表から1日へ移る関数
    date = pickedDate;   // その日にする
    if (memberId) selectedId = memberId;   // 人を押したなら、その人を選ぶ
    setView("day");   // 1日の見方にする
  }

  // ============================================================
  // 描く
  // ============================================================

  function draw() {   // 画面を描く関数
    const today = work.filter((shift) => shift.date === date);   // 今見ている日の勤務
    const checks = [...dayChecks(date), ...weekChecks()];   // その日と週のチェック

    mount(app,   // 画面に入れる
      // 見出し（2026年11月15日：「シフト作成」の文字はなくして、いちばん上で店舗を切りかえる）
      createElement("header", { class: "screen-header screen-header--compact" },   // 見出しの入れ物
        storeTabs(),   // 店舗の切りかえ（押すとその店舗のシフトになる）
        createElement("div", { class: "editor-status" },   // 状態の小さい行
          view === "week" ? STATUS_LABEL[period.status] : `${STATUS_LABEL[period.status]} ・ ${label(date)} ${isClosed(date) ? "はお休み" : `の営業 ${range(hoursOf(date).open, hoursOf(date).close)}`}`),   // 状態（日の見方なら営業時間も）
        // 週の移動（‹ ›）・見方の切りかえ（週／日）・印刷を1行に（2026年11月10日：小さくまとめた）
        createElement("div", { class: "week-nav week-nav--compact" },   // 週を変える行
          createElement("button", { class: "btn btn--icon", onclick: () => moveWeek(-1), "aria-label": "前の週" }, "‹"),   // 前の週
          createElement("strong", { class: "week-nav__label" }, weekShort(period)),   // 週の日付（短い形「11/16〜11/22」で1行に）
          createElement("button", { class: "btn btn--icon", onclick: () => moveWeek(1), disabled: period.weekStart >= lastWeek, "aria-label": "次の週" }, "›"),   // 次の週
          createElement("div", { class: "seg", role: "group", "aria-label": "見方" },   // 見方の切りかえ
            createElement("button", { class: "seg__btn", "aria-pressed": String(view === "week"), onclick: () => setView("week") }, "週"),   // 1週間の表
            createElement("button", { class: "seg__btn", "aria-pressed": String(view === "day"), onclick: () => setView("day") }, "日"),   // 1日のタイムライン
          ),
        ),
        locked()   // 公開済みなら
          // 公開済み：「編集する」を押すまで直せない
          ? createElement("div", { class: "editor-actions" },   // ボタンの行
              createElement("span", { class: "badge badge--hall", style: { alignSelf: "center" } }, "公開済み（見るだけ）"),   // 公開済みの印
              createElement("button", { class: "btn btn--tiny btn--primary", onclick: () => { unlocked = true; toast("編集できます。直したら「変更を公開」を押してください"); draw(); } }, "✏️ 編集する"),   // 編集するボタン
              printButton(),   // 印刷
            )
          // 作っている時：横にスクロールできる1行（よく使う順）
          : createElement("div", { class: "editor-actions" },   // 作っている時のボタンの行
          createElement("button", { class: "btn btn--tiny btn--blue", onclick: runDraft }, "✨ AIで作成"),   // AIで作る
          createElement("button", { class: "btn btn--tiny btn--primary", onclick: publish }, period.status === "published" ? "変更を公開" : "公開する"),   // 公開
          createElement("button", { class: "btn btn--tiny", onclick: undo, disabled: !history.canUndo(), "aria-label": "元に戻す" }, "↶"),   // 元に戻す
          createElement("button", { class: "btn btn--tiny", onclick: redo, disabled: !history.canRedo(), "aria-label": "やり直す" }, "↷"),   // やり直し
          createElement("button", { class: "btn btn--tiny", onclick: addPerson }, "＋人"),   // 人を追加
          createElement("button", { class: "btn btn--tiny", onclick: copyLastWeek }, "前週コピー"),   // 前週コピー
          // 受付の切り替え：まちがえて締め切っても、もう一度押せば受付中に戻る
          period.status !== "published"   // 公開前なら
            ? createElement("button", { class: "btn btn--tiny", onclick: toggleIntake }, period.status === "open" ? "受付を締切" : "受付を再開")   // 受付を締め切る・再開
            : null,   // 公開後は出さない
          printButton(),   // 印刷
        ),
      ),
      createElement("div", { class: "screen-body" },   // 本文
        // いちばん上に「希望の一覧」（店舗ごと。2026年11月15日）
        hopeList({ dates: datesOf(period), members: active, availabilities: hopes, stores: state.stores, storeId: state.storeId, onPick: pickFromWeek }),   // 希望の一覧
        aiResult ? resultCard() : null,   // AIの結果があれば出す
        view === "week" ? weekBody() : dayBody(today, checks),   // 1週間の表か、1日のタイムライン
      ),
    );
  }

  /** いちばん上の店舗の切りかえ（2026年11月15日） */
  function storeTabs() {   // 店舗の切りかえを作る関数
    return createElement("div", { class: "store-tabs", role: "group", "aria-label": "店舗" },   // 店舗のボタンの行
      activeStores().map((eachStore) => createElement("button", {   // 店舗ごとに
        class: "store-tabs__btn",   // 見た目
        "aria-pressed": String(eachStore.id === state.storeId),   // 今の店舗に印
        onclick: async () => {   // 押した時
          if (eachStore.id === state.storeId) return;   // 同じなら何もしない
          await switchStore(eachStore.id);   // 切りかえる（ほかの画面もこの店舗になる）
          await renderShiftEditor(app);   // この店舗のシフトで描きなおす
        },
      }, eachStore.short || eachStore.name)));   // 短い名前（例「福釜」）
  }

  /** 印刷ボタン（お店に貼る用。PDFにも保存できる） */
  function printButton() {   // 印刷ボタンを作る関数
    return createElement("button", { class: "btn btn--tiny", onclick: () => printWeek({   // 印刷ボタン
      title: `${state.stores.find((store) => store.id === period.storeId)?.name || ""} ${weekLabel(period)}${period.status === "published" ? "" : "（下書き）"}`,   // タイトル（店舗と週）
      dates: datesOf(period), members: active, assignments: work, note: period.note,   // 7日・店員・勤務・連絡事項
    }) }, "印刷");   // ボタンの文字
  }

  /** 「週」の見方：1週間の表＋週のチェック（2026年11月10日） */
  function weekBody() {   // 週の見方の中身を作る関数
    const problemDays = new Set(datesOf(period).filter((eachDate) => onlyProblems(dayChecks(eachDate)).length));   // 問題がある日
    return createElement("div", { class: "editor-week" },   // 縦に並べる入れ物
      createElement("section", { class: "card card--tight" },   // 表のカード
        weekGrid({   // 1週間の表
          dates: datesOf(period),   // 7日
          members: active,   // 店員
          assignments: work,   // この週の勤務
          elsewhere,   // ほかの店舗の勤務
          availabilities: hopes,   // 希望
          problemDays,   // 問題がある日
          closedDays: new Set(datesOf(period).filter(isClosed)),   // お休みの日（店舗の設定で決めた日）
          selectedId,   // 選んでいる人
          onPick: pickFromWeek,   // マスを押した時
        }),
        createElement("div", { class: "home-muted wk__help" }, "マスを押すと、その日を細かく直せます。○・時間＝入れる希望、休＝休み希望"),   // 使い方
      ),
      // 「守れていないルール」のカードは外した（表の日付の赤い点で分かる。2026年11月15日）
      shortageCard(),   // 足りない時間のカード
      noteCard(),   // 連絡事項のカード
    );
  }

  /** 「日」の見方：1日のタイムライン＋右の欄（今までの画面） */
  function dayBody(today, checks) {   // 日の見方の中身を作る関数
    const hrs = hoursOf(date);   // その日の営業時間
    return [   // 日のタブと、左右の入れ物
        dayTabs(),   // 日のタブ
        // いつもとちがう日（お休み・時間の変更）は、上に知らせる（2026年11月15日）
        hrs.changed ? createElement("div", { class: `notice ${hrs.closed ? "notice--danger" : "notice--warn"}` },   // 知らせ
          hrs.closed ? `この日はお休みです${hrs.note ? `（${hrs.note}）` : ""}。店舗の設定で決めた日なので、シフトは作りません` : `この日は営業時間が ${range(hrs.open, hrs.close)} です${hrs.note ? `（${hrs.note}）` : ""}`) : null,   // 文
        createElement("div", { class: "editor" },   // 左右の入れ物
          createElement("section", { class: "card editor__table" },   // 左：タイムライン
            timeline({   // タイムライン
              ...dayRange(date),   // 表示する時間のはば
              hours: hoursOf(date),   // 営業時間
              members: active,   // 店員
              assignments: today,   // その日の勤務
              elsewhere: elsewhere.filter((shift) => shift.date === date),   // ほかの店舗の勤務
              availabilities: hopes.filter((hope) => hope.date === date),   // 希望は店長だけに見せる
              needs: needRows(today),   // 必要人数の行
              selectedId,   // 選んでいる人
              editable: !locked(),   // 動かせるか
              onSelect: (id) => { selectedId = id; draw(); },   // 人を選んだ時
              onChange: (shift, change) => { selectedId = shift.memberId; edit(() => Object.assign(shift, change)); },   // 棒を動かした時
            }),
            legend(),   // 色の説明
          ),
          createElement("div", { class: "editor__table" }, dayList({ assignments: today, members, hours: hoursOf(date) })),   // 1日の一覧
          createElement("div", { class: "editor__side" },   // 右の欄
            selectedId ? memberPanel(selectedId) : createElement("section", { class: "card home-muted" }, "名前か線を押すと、ここで細かく直せます"),   // 選んだ人、なければ説明
            locked() ? null : dayTools(),   // その日の道具
            createElement("section", { class: "card" },   // ルールのチェック
              createElement("h2", { class: "card__title" }, `ルールのチェック（${label(date)}）`),   // 見出し
              createElement("ul", { class: "check-list" },   // 一覧
                checks.map((check) => createElement("li", { class: check.ok ? "is-ok" : "is-ng" }, createElement("strong", null, check.ok ? "✓" : "!"), check.text))),   // OKは緑、だめは赤
              // 守れていないルールがあれば、AIに直してもらえる（週全体を見て直す）
              !locked() && onlyProblems(checks).length   // 問題があれば
                ? createElement("button", { class: "btn btn--small btn--blue", onclick: fixByAi }, "✨ AIに直してもらう（この週）")   // AIに直してもらうボタン
                : null,   // なければ出さない
            ),
            shortageCard(),   // 足りない時間のカード
            laborCard(),   // 人件費のカード
            noteCard(),   // 連絡事項のカード
          ),
        ),
    ];
  }

  /** 日のタブ（守れていない日は赤い点） */
  function dayTabs() {   // 日のタブを作る関数
    return createElement("div", { class: "day-tabs" },   // タブの入れ物
      datesOf(period).map((eachDate) => {   // 7日ごとに
        const bad = onlyProblems(dayChecks(eachDate)).length > 0;   // 守れていないルールがある日か
        return createElement("button", { class: "chip day-tab", "aria-pressed": String(eachDate === date), onclick: () => { date = eachDate; draw(); } },   // タブのボタン
          label(eachDate), bad ? createElement("span", { class: "day-tab__dot", "aria-label": "守れていないルールあり" }) : null);   // 日付と問題の赤い点
      }));
  }

  /** 1時間ごとの「必要／入っている」 */
  function needRows(dayAssignments) {   // 必要人数の行を作る関数
    const type = dayTypeOf(date);   // 平日／土曜／日曜祝日
    /** 1つの場所の1時間ごとの「必要／入っている」 */
    const make = (area, labelText, color) => {   // 場所ごとの行を作る
      const slots = [];   // 1時間ごとの数
      const { start, end } = dayRange(date);   // 表の左端と右端
      for (let minutes = start; minutes < end; minutes += 60) {   // 1時間ごとに
        // その1時間でいちばん足りない時を出す（15分ごとに見る）
        let need = 0, have = 0, worst = -Infinity;   // 一番足りない15分を見る
        for (let slot = minutes; slot < minutes + 60; slot += 15) {   // 15分ごとに
          const count = requiredAt(requirements, positions, type, area, slot);   // 必要な人数
          const haveCount = assignedAt(dayAssignments, area, slot);   // 入っている人数
          if (count - haveCount > worst) { worst = count - haveCount; need = count; have = haveCount; }   // 一番足りないものを残す
        }
        slots.push({ need, have });   // 足す
      }
      return { label: labelText, color, slots };   // 返す
    };
    return [make("hall", "ホール 人数", "var(--hall)"), make("kitchen", "キッチン 人数", "var(--kitchen)")];   // ホールとキッチン
  }

  /** 色の見方 */
  function legend() {   // 色の説明を作る関数
    return createElement("div", { class: "legend" },   // 入れ物
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--hall" }), "ホール"),   // ホール
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--kitchen" }), "キッチン"),   // キッチン
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--hope" }), "希望"),   // 希望
      createElement("span", null, createElement("i", { class: "legend__circle" }), "休憩の目安"),   // 休憩
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--fixed" }), "固定"),   // 固定
      createElement("span", { class: "home-muted" }, "線をドラッグで移動、端をドラッグで時間を変える"),   // 使い方
    );
  }

  /** 右の欄：選んだ店員のくわしい内容と直す道具（components/assignment-panel.js） */
  function memberPanel(id) {   // 右の欄を作る関数
    const member = members.find((member) => member.id === id);   // 選んだ店員
    const hope = hopes.find((hope) => hope.memberId === id && hope.date === date);   // その日の希望
    return assignmentPanel({   // 右の欄の部品
      member: member,   // 店員
      date,   // 日付
      assignments: work.filter((shift) => shift.memberId === id && shift.date === date).sort((shiftA, shiftB) => shiftA.from - shiftB.from),   // その日のその人の勤務（早い順）
      hope,   // 希望
      rule: ruleOf(id),   // メモ
      others: active.filter((member) => member.id !== id),   // 移せるほかの人
      locked: locked(),   // 変えられないか
      // この週の働く時間（ほかの店舗の分も入れる。週の上限を超えないように見るため）
      weekText: (() => {   // 今週・今月・今年の数字
        const mine = [...work, ...elsewhere].filter((shift) => shift.memberId === id);   // その人のこの週の勤務（ほかの店舗も）
        const days = new Set(mine.map((shift) => shift.date)).size;   // 入っている日数
        const personLimit = limitsMap().get(id) || {};                                     // 働き方のルール
        const use = usageOf(id, date, [...work, ...others], personLimit);                 // 今月・今年
        return [   // 返す
          `この週：${hoursText(minutesByMember(mine).get(id) || 0)}（${days}日）`,   // 今週の時間と日数
          `今月：${hoursText(use.monthMinutes)}${personLimit.monthHoursMax ? ` / 上限 ${personLimit.monthHoursMax}時間` : ""}`,   // 今月の時間と上限
          personLimit.yearYenMax ? `今年：約${yen(use.yearYen)} / 上限 ${yen(personLimit.yearYenMax)}` : "",   // 今年の金額と上限
          personLimit.minor ? "18歳未満（22時〜朝5時は入れない）" : "",   // 18歳未満
        ].filter(Boolean).join("　");   // 空のものを消してつなぐ
      })(),   // すぐ計算
      elsewhere: elsewhere.filter((shift) => shift.memberId === id && shift.date === date),   // ほかの店舗のその日の勤務
      onEdit: (change) => edit(change),   // 勤務を変えた時
      onRemove: (shift) => edit(() => { work = work.filter((other) => other !== shift); }),   // 勤務を消した時
      onAdd: () => edit(() => {   // 勤務を足した時
        // 希望があればその時間、もう勤務があればその後ろ、なければ 9:00〜15:00
        const mine = work.filter((shift) => shift.memberId === id && shift.date === date);   // その日のその人の勤務
        let from = 9 * 60, to = 15 * 60;   // 足す勤務の時間（最初は 9:00〜15:00）
        if (mine.length) {   // もう勤務があれば
          // 今の勤務の1時間後から3時間。翌2:00をこえるなら、今の勤務の前に入れる
          from = Math.max(...mine.map((shift) => shift.to)) + 60; to = from + 3 * 60;   // 後ろに3時間足す
          if (to > EDIT_MAX) { to = Math.min(...mine.map((shift) => shift.from)) - 60; from = Math.max(EDIT_MIN, to - 3 * 60); }   // 入らなければ前に足す
          if (to <= from) { toast("この日はもう勤務を足す時間がありません"); return; }   // どちらも入らなければ止める
        }
        else if (hope?.kind === "time") { from = hope.from; to = hope.to; }   // なければ時間の希望の時間
        work.push({ memberId: id, date, from, to, area: member.skills.kitchen > member.skills.hall ? "kitchen" : "hall", breakAt: null, fixed: false, createdBy: "manager", requested: false });   // 足す（得意な場所で）
      }),
      onApproveSpecial: async () => {   // 特別許可を出した時
        await api.approveSpecialOff(period.id, id, date);   // 許可を出す
        hopes = await api.listAvailabilities(period.id);   // 希望を読みなおす
        toast("特別許可を出しました");   // お知らせ
        draw();   // 描く
      },
    });
  }

  /** この日の道具：ほかの日にコピー・全部消す */
  function dayTools() {   // その日の道具のカードを作る関数
    const target = createElement("select", { class: "select", "aria-label": "コピー先の日" },   // コピー先の日を選ぶ欄
      datesOf(period).filter((eachDate) => eachDate !== date).map((otherDate) => createElement("option", { value: otherDate }, label(otherDate))));   // ほかの日
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, `${label(date)} の道具`),   // 見出し
      createElement("div", { class: "time-range" },   // 行
        target,   // コピー先
        createElement("button", { class: "btn btn--small", onclick: () => copyDay(target.value) }, "へコピー"),   // コピーボタン
      ),
      createElement("button", { class: "btn btn--small btn--danger", onclick: clearDay }, "この日の勤務を全部消す（固定は残す）"),   // この日を空にするボタン
    );
  }

  /**
   * 人件費の目安（Airシフト・7shifts の「人件費」を参考に）
   * 時給×働いた時間（休憩を引く）、深夜は1.25倍、交通費。社員は入れない（lib/labor.js）
   */
  function laborCard() {   // 人件費のカードを作る関数
    const day = laborCost(work.filter((shift) => shift.date === date), wages);   // その日の人件費
    const week = laborCost(work, wages);   // この週の人件費
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "人件費の目安（バイト・フル）"),   // 見出し
      createElement("div", { class: "labor" },   // 数字の箱
        createElement("div", null, createElement("span", { class: "home-muted" }, label(date)), createElement("strong", { class: "num" }, yen(day))),   // その日
        createElement("div", null, createElement("span", { class: "home-muted" }, "この週"), createElement("strong", { class: "num" }, yen(week))),   // この週
      ),
      createElement("div", { class: "home-muted" }, "時給と交通費は「店員管理」で入れます。休憩（6時間をこえたら45分・8時間をこえたら60分）を引いて計算"),   // 説明
    );
  }

  /** 連絡事項（紙の右下の欄と同じ。公開シフトでみんなが見られる） */
  function noteCard() {   // 連絡事項のカードを作る関数
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, "連絡事項（この週）"),   // 見出し
      createElement("textarea", {   // 文の欄
        class: "textarea",   // 見た目
        disabled: locked(),   // 公開済みなら変えられない
        placeholder: "例：11/12 研修あり、11/14 お祭りで混みます",   // 例
        onchange: async (event) => { period.note = event.target.value; await api.savePeriodNote(period.id, period.note); toast("連絡事項を保存しました"); },   // 変えたら保存
      }, period.note || ""),   // 今の連絡事項
    );
  }

  /** この日をほかの日にコピー（コピー先の固定した勤務は残す） */
  function copyDay(to) {   // ほかの日にコピーする関数
    edit(() => {   // 元に戻せるように変える
      const keep = work.filter((shift) => shift.date !== to || shift.fixed);   // 残す勤務（コピー先の固定と、ほかの日）
      const fixedThere = new Set(keep.filter((shift) => shift.date === to).map((shift) => shift.memberId));   // コピー先で固定されている人
      const copied = work   // コピーした勤務
        .filter((shift) => shift.date === date && !fixedThere.has(shift.memberId))   // その日の勤務で、コピー先で固定していない人
        .map((shift) => ({ ...shift, id: undefined, date: to, fixed: false, createdBy: "copy" }));   // 日付を変えた写し
      work = [...keep, ...copied];   // 入れかえる
    });
    toast(`${label(to)} にコピーしました`);   // お知らせ
  }

  /** この日の勤務を全部消す（固定は残す） */
  async function clearDay() {   // この日を空にする関数
    const ok = await confirmDialog({ title: `${label(date)} の勤務を全部消しますか？`, body: createElement("p", { style: { margin: 0 } }, "固定した勤務は残ります。「元に戻す」で戻せます。"), yes: "消す", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;   // 「いいえ」なら止める
    edit(() => { work = work.filter((shift) => shift.date !== date || shift.fixed); });   // 固定したもの以外を消す
  }

  // ============================================================
  // ボタンの動き
  // ============================================================

  /** 前の週／次の週へ（その週がまだなければ作る） */
  async function moveWeek(step) {   // 週を変える関数
    const weekStart = addDays(period.weekStart, 7 * step);   // 行く週の月曜
    if (weekStart > lastWeek) return;   // 先すぎれば止める
    let next = periods.find((period) => period.weekStart === weekStart);   // その週の受付
    if (!next) {   // なければ
      next = await api.ensurePeriod(weekStart);   // 作る
      periods.push(next);   // 足す
      periods.sort((periodA, periodB) => periodA.weekStart.localeCompare(periodB.weekStart));   // 日付順
    }
    period = next;   // その週にする
    date = null;   // 日を選びなおす
    selectedId = null;   // 選んでいる人を消す
    unlocked = false;   // 編集のロックをもどす
    aiResult = null;                               // ほかの週の「AIの結果」は出さない
    history.clear();   // 元に戻すの記録を消す
    await loadPeriod();   // 読む
    draw();   // 描く
  }

  /** 受付中 ⇔ 締切 を切り替える */
  async function toggleIntake() {   // 受付を締め切る・再開する関数
    const next = period.status === "open" ? "closed" : "open";   // 次の状態
    await api.setPeriodStatus(period.id, next);   // 保存
    period.status = next;   // 変える
    toast(next === "closed" ? "受付を締め切りました（もう一度押すと戻せます）" : "受付を再開しました");   // お知らせ
    draw();   // 描く
  }

  /**
   * 「AIで作成」：Gemini が下書きを作る（固定した勤務は残す）
   * AIがつながらない時は簡易版で作る。結果は一番上の「AIの結果」に出る
   */
  async function runDraft() {   // AIで下書きを作る関数
    const hasWork = work.some((shift) => !shift.fixed);                        // もう勤務が入っているか
    if (hasWork) {   // もう勤務があれば
      const ok = await confirmDialog({   // 作り直すか聞く
        title: "下書きを作り直しますか？",   // タイトル
        body: createElement("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、新しい下書きになります。「AIの前に戻す」で戻せます。"),   // 説明
        yes: "作り直す", no: "やめる",   // ボタンの文字
      });
      if (!ok) return;   // 「やめる」なら止める
    }
    const wait = busy("準備しています");                                // 待っている間の画面
    try {   // 成功でも失敗でも「考えています」を消す
      // 過去の勤務：前の週の分を「よく入っている人」の参考にする
      const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));   // 前の週
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((shift) => ({ ...shift }));                       // AIの前（「変わった所」を出すため）
      const result = await runAiDraft(aiContext(past), { onStep: wait.update });   // AIの結果
      history.push(work);   // 今の状態を記録
      work = result.rows;   // 下書きにする
      await api.saveAiDraft(period.id, work);                           // 公開の時に「店長がどう直したか」を比べるため
      aiResult = { result, kind: "draft", before };   // 結果のカード用に覚える
      await persist();   // 保存して描く
      window.scrollTo(0, 0);   // 一番上へ
      toast(result.source === "gemini" ? "AIが下書きを作りました" : "簡易版で下書きを作りました");   // お知らせ
    } finally {   // 最後に
      wait.done();   // 「考えています」を消す
    }
  }

  /** 「AIに直してもらう」：守れていないルールだけ AI が直す（週全体） */
  async function fixByAi() {   // AIに直してもらう関数
    const problems = allProblems();                                   // 今の守れていないルール
    if (!problems.length) { toast("守れていないルールはありません"); return; }   // 問題がなければ止める
    if (!aiReady().ok) {   // AIを使えなければ
      const ok = await confirmDialog({ title: "AIの設定がまだです", body: createElement("p", { style: { margin: 0 } }, `${aiReady().why}。AIの設定を開きますか？`), yes: "開く", no: "やめる" });   // 設定を開くか聞く
      if (ok) go("/ai");   // 設定へ
      return;   // 止める
    }
    const wait = busy("AIが直しています（30秒〜1分くらい）");   // 待っている間の画面
    try {   // 成功でも失敗でも「考えています」を消す
      const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));   // 前の週
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((shift) => ({ ...shift }));   // AIの前の勤務
      const result = await fixWithAi(aiContext(past), work, problems, { onStep: wait.update });   // AIが直した結果
      if (!result.applied) {   // 直せなかったら
        toast(result.error ? `AIで直せませんでした：${result.error}` : `AIの案は問題が減らなかったので使いませんでした（${result.before}件 → ${result.after}件）`);   // お知らせ
        return;   // 止める
      }
      history.push(work);   // 今の状態を記録
      work = result.rows;   // 直した案にする
      await api.saveAiDraft(period.id, work);   // 下書きとして保存（学ぶため）
      aiResult = {   // 結果のカード用に覚える
        kind: "fix", before,   // 直した・前の状態
        result: { rows: work, source: "gemini", model: result.model, summary: result.summary, concerns: result.concerns, dropped: result.dropped, learnedCount: 0 },   // 結果
      };
      await persist();   // 保存して描く
      window.scrollTo(0, 0);   // 一番上へ
      toast(`AIが直しました（守れていないルール ${result.before}件 → ${result.after}件）`);   // お知らせ
    } finally {   // 最後に
      wait.done();   // 「考えています」を消す
    }
  }

  /** 一番上の「AIの結果」カード（components/ai-result.js） */
  function resultCard() {   // AIの結果のカードを作る関数
    return aiResultCard({   // カード
      ...aiResult,   // 結果と前の状態
      members,   // 店員
      problems: allProblems(),   // 問題
      costText: yen(laborCost(work, wages)),   // 人件費
      aiOn: aiReady().ok && !locked(),   // AIを使えるか
      onFix: fixByAi,   // AIに直してもらう
      onUndo: () => { undo(); aiResult = null; draw(); toast("AIの前に戻しました"); },   // AIの前に戻す
      onClose: () => { aiResult = null; draw(); },   // 閉じる
      onSettings: () => go("/ai"),   // AIの設定へ
      onJump: (eachDate, id) => { date = eachDate; selectedId = id; draw(); document.querySelector(".editor")?.scrollIntoView({ behavior: "smooth" }); },   // 理由を押したらその日・その人へ
    });
  }

  /**
   * 人が足りない時間と「入れそうな人に連絡する」（2026年11月5日）
   * 公開した時は自動で連絡する。公開の前でも、このボタンで先に連絡できる
   */
  function shortageCard() {   // 足りない時間のカードを作る関数
    const list = mergeNeeds(weekShortages());                          // この週の足りない時間（近いものはまとめる）
    if (!list.length || locked()) return null;   // なければ・公開済みなら出さない
    /** 場所の名前 */
    const area = (need) => (need.area === "hall" ? "ホール" : "キッチン");   // 場所の名前
    return createElement("section", { class: "card" },   // カード
      createElement("h2", { class: "card__title" }, `足りない時間（この週 ${list.length}件）`),   // 見出し
      // 日ごとに：日付の下に「キッチン 8:00〜22:00 2人」（2026年11月15日）
      [...new Set(list.map((need) => need.date))].sort().map((eachDate) => createElement("div", { class: "need-day" },   // 1日分
        createElement("div", { class: "need-day__date" }, label(eachDate)),   // 「11/16（月）」
        list.filter((need) => need.date === eachDate).map((need) => createElement("div", { class: "need-day__row" }, `${area(need)} ${range(need.from, need.to)} ${need.short}人`)))),   // 場所・時間・人数
      createElement("button", { class: "btn btn--small", onclick: async () => {   // 連絡ボタン
        const result = await api.sendCalls(period.id, list);   // 連絡した結果
        toast(result.sent ? `${result.people}人に連絡しました（${result.sent}件）${result.none ? `。入れそうな人がいない所 ${result.none}件` : ""}` : result.none ? "入れそうな人がいませんでした" : "もう連絡してあります");   // お知らせ
      } }, "入れそうな人に連絡する"),   // ボタンの文字
      createElement("div", { class: "home-muted" }, "公開した時に足りない時間が残っていれば、自動で連絡します。返事はホームに出ます"),   // 説明
    );
  }

  /** 「＋ 人を追加」：ほかの店舗の人・まだアカウントがない人（components/add-person.js） */
  async function addPerson() {   // 人を追加する関数
    if (locked()) { toast("公開済みです。直す時は「編集する」を押してください"); return; }   // 公開済みなら止める
    company = await api.listCompanyMembers();   // 会社の店員を読む
    await openAddPerson({   // 小さい画面を開く
      company,   // 会社の店員
      shown: new Set(members.map((member) => member.id)),   // もう表に出ている人
      // ほかの店舗の人：この週だけ応援 or この店舗にも行けるようにする
      onPickOther: async (memberId, how) => {   // ほかの店舗の人を選んだ時
        if (how === "week") {   // この週だけなら
          period.guests = await api.addGuest(period.id, memberId);   // 足す
        } else {   // ずっとなら
          await api.addMembersToStore(period.storeId, [memberId]);   // この店舗でも働けるようにする
          baseMembers.splice(0, baseMembers.length, ...(await api.listMembers()));   // 店員を読みなおす
        }
        await loadGuests();   // 足した人を読む
        selectedId = memberId;   // 選ぶ
        draw();   // 描く
        toast(how === "week" ? "この週だけ応援で足しました。表の下の「応援」に出ます" : "この店舗にも行けるようにしました");   // お知らせ
      },
      // まだアカウントがない人：登録だけする（ログインはまだできない）
      onCreate: async (form) => {   // 新しい人を作った時
        const { member } = await api.createMember({ ...form, account: false, stores: [{ storeId: period.storeId, rank: 1 }] });   // 登録した人
        baseMembers.push({ ...member, rankHere: 1 });   // 店員に足す
        await loadGuests();   // 足した人を読む
        selectedId = member.id;   // 選ぶ
        draw();   // 描く
        toast(`${member.name} を登録しました。名前を押して勤務を足せます（アカウントはあとで店員管理から）`);   // お知らせ
      },
    });
  }

  /** 前週コピー */
  async function copyLastWeek() {   // 前週コピーの関数
    const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));   // 前の週
    if (!prev) { toast("前の週がありません"); return; }   // 前の週がなければ止める
    const ok = await confirmDialog({   // コピーするか聞く
      title: "先週と同じにしますか？",   // タイトル
      body: createElement("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、先週と同じ形になります。"),   // 説明
      yes: "コピーする", no: "やめる",   // ボタンの文字
    });
    if (!ok) return;   // 「やめる」なら止める
    const last = await api.listAssignments(prev.id);   // 先週の勤務
    const activeIds = new Set(active.map((member) => member.id));   // 働いている人のID
    const fixed = work.filter((shift) => shift.fixed);   // 固定した勤務
    const fixedKey = new Set(fixed.map((shift) => `${shift.memberId}|${shift.date}`));   // 固定がある人と日
    const copied = last   // 1週間後にずらした勤務
      .filter((shift) => activeIds.has(shift.memberId) && shift.storeId === period.storeId)   // 今いる人のこの店舗の分
      .map((shift) => ({ ...shift, id: undefined, date: addDays(shift.date, 7), fixed: false, createdBy: "copy" }))   // 日付を7日ずらす
      .filter((shift) => !fixedKey.has(`${shift.memberId}|${shift.date}`));   // 固定した日は外す
    history.push(work);   // 今の状態を記録
    work = [...fixed, ...copied];   // 入れかえる
    await persist();   // 保存して描く
    toast("先週のシフトをコピーしました");   // お知らせ
  }

  /** 公開（守れていなければ⚠️警告 →「はい」でそのまま公開） */
  async function publish() {   // 公開する関数
    const problems = allProblems();   // 守れていないルール
    if (problems.length) {   // 問題があれば
      const yes = await confirmDialog({   // そのまま公開するか聞く
        title: "守れていないルールがあります",   // タイトル
        warn: true,   // 注意の絵
        body: createElement("div", { class: "publish-problems" },   // 中身
          createElement("ul", { class: "check-list" }, problems.map((problem) => createElement("li", { class: "is-ng" }, createElement("strong", null, problem.day), problem.text))),   // 問題の一覧
          createElement("p", { style: { margin: "8px 0 0", fontWeight: 700 } }, "このまま公開しますか？"),   // 聞く
        ),
        yes: "はい（公開する）",   // はい
        no: "いいえ（直す）",   // いいえ
      });
      if (!yes) return;   // 「いいえ」なら止める
    }
    await api.saveAssignments(period.id, work);   // 保存
    await api.setPeriodStatus(period.id, "published");   // 公開
    await api.notifyPublished(period.id, weekLabel(period));   // みんなに知らせる
    // 店長の直し方を覚える（AIの下書きと、公開したシフトを比べる）
    const learnedNow = await api.learnFromPublish(period.id);              // 新しく覚えた数
    // 足りない時間が残っていれば、入れそうな人に自動で連絡する
    const short = weekShortages();   // 足りない時間
    const called = short.length ? await api.sendCalls(period.id, short, { auto: true }) : null;   // 自動連絡の結果
    period.status = "published";   // 公開済み
    unlocked = false;                              // 公開したら、また「編集する」を押すまで直せない
    aiResult = null;   // AIの結果を閉じる
    toast([   // お知らせ
      problems.length ? "警告があるまま公開しました。全員に知らせます" : "公開しました。全員に知らせます",   // 公開した
      learnedNow ? `AIが店長の直し方を ${learnedNow}件 覚えました` : "",   // 覚えた数
      called?.sent ? `足りない時間を ${called.people}人に自動で連絡しました` : "",   // 自動で連絡した
    ].filter(Boolean).join("。"));   // つなぐ
    draw();   // 描く
  }
}
