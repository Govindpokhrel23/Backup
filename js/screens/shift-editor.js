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

import { createElement, mount, toast, confirmDialog, busy } from "../lib/dom.js";
import { api } from "../api/index.js";
import { CONFIG } from "../config.js";
import { screenHeader } from "../components/header.js";
import { timeline } from "../components/timeline.js";
import { checkDay, checkWeek, onlyProblems, requiredAt, assignedAt, findShortages } from "../rules/shift-rules.js";
import { runAiDraft, fixWithAi } from "../ai/draft-service.js";
import { aiReady } from "../ai/ai-settings.js";
import { aiResultCard } from "../components/ai-result.js";
import { openAddPerson } from "../components/add-person.js";
import { mergeNeeds } from "../rules/candidates.js";
import { go } from "../router.js";
import { STATUS_LABEL, weekLabel, datesOf, workingPeriod } from "../lib/period.js";
import { label, dayType, addDays, mondayOf, toIso, monthStart, monthEnd } from "../lib/date.js";
import { checkLabor, usageOf } from "../rules/labor-rules.js";
import { state } from "../store.js";
import { range, EDIT_MIN, EDIT_MAX } from "../lib/time.js";
import { createHistory } from "../lib/history.js";
import { assignmentPanel } from "../components/assignment-panel.js";
import { dayList } from "../components/day-list.js";
import { printWeek } from "../components/print-week.js";
import { laborCost, minutesByMember, hoursText, yen } from "../lib/labor.js";

/** シフト作成の画面を描く（店長） */
export async function renderShiftEditor(app) {
  // ---------- 最初に全部読む ----------
  // periods＝週の一覧 / baseMembers＝この店舗で働ける人 / positions・requirements＝マップと必要人数 /
  // holidays＝祝日 / rules＝人ごとのルール / storeHours＝営業時間 / wages＝時給 / learnings＝店長の直し方
  const [periods, baseMembers, positions, requirements, holidays, rules, storeHours, wages, learnings] = await Promise.all([
    api.listPeriods(), api.listMembers(), api.listPositions(), api.listRequirements(),
    api.listHolidays(), api.listMemberRules(), api.getStoreHours(), api.listWages(), api.listLearnings(),
  ]);
  let company = null;           // 会社の店員みんな（「人を追加」と応援の人の情報。はじめて使う時に読む）
  let members = baseMembers;    // 表に出す人＝この店舗の人＋この週だけの応援（loadPeriod で作り直す）
  let active = members.filter((member) => member.active);   // 表に出す人のうち、休止していない人
  /** 人ごとのルール */
  const ruleOf = (id) => rules.find((rule) => rule.memberId === id)?.text || "なし";
  /** 平日／土曜／日曜祝日 */
  const dayTypeOf = (date) => dayType(date, holidays);
  const hoursOf = (date) => storeHours[dayTypeOf(date)];          // その日の営業時間（マップ画面で店長が決める）

  // ---------- 画面の中で持つ状態 ----------
  let period = workingPeriod(periods);
  let work = [];           // この週の勤務（下書き・公開済み）
  let hopes = [];          // この週の希望
  let date = null;         // 表示している日
  let selectedId = null;   // 右の欄で見ている店員
  let elsewhere = [];      // この週にほかの店舗に入っている勤務（重ねないため・見るだけ）
  let others = [];         // この週以外の勤務（全部の店舗）＋この週のほかの店舗の勤務。月・年の上限と連勤を数える（2026年11月6日）
  let unlocked = false;    // 公開済みの週で「編集する」を押したか
  let aiResult = null;     // 一番上に出す「AIの結果」{result, kind, before}（閉じたら null）
  const history = createHistory();   // 「元に戻す」用

  /** 公開済みで、まだ「編集する」を押していない＝直せない */
  const locked = () => period.status === "published" && !unlocked;

  /** 何週先までシフトを作れるか（希望と同じ2か月先まで） */
  const lastWeek = (() => {
    const limit = new Date(); limit.setMonth(limit.getMonth() + CONFIG.MONTHS_AHEAD);   // 今日から2か月先
    return mondayOf(toIso(limit));
  })();

  // まだ週が1つもない店舗（増やしたばかりの店舗など）は、来週の受付を作って始める
  if (!period) {
    period = await api.ensurePeriod(addDays(mondayOf(toIso(new Date())), 7));
    periods.push(period);
  }
  await loadPeriod();
  draw();

  /**
   * AIに渡す店員に、働き方のルールをつける（2026年11月6日）
   *   minor … 18歳未満（22時〜朝5時は入れない）
   *   leftMinutes … この週に入れてよい残りの時間（月の上限・年の上限から計算。なければ null）
   */
  function withLimits(member) {
    const lim = limitsMap().get(member.id) || {};                                      // その人のルール
    const use = usageOf(member.id, period.weekStart, others, lim);                     // この週より前の今月・今年
    const lefts = [];                                                             // 残りの時間の候補
    if (lim.monthHoursMax) lefts.push(lim.monthHoursMax * 60 - use.monthMinutes);
    if (lim.yearYenMax && lim.hourly) lefts.push(((lim.yearYenMax - use.yearYen) / lim.hourly) * 60);
    return { ...member, minor: !!lim.minor, leftMinutes: lefts.length ? Math.max(0, Math.floor(Math.min(...lefts))) : null };
  }

  // ============================================================
  // データの読み込みと保存
  // ============================================================

  async function loadPeriod() {
    const end = addDays(period.weekStart, 6);   // その週の日曜
    let all;
    [work, hopes, all] = await Promise.all([
      api.listAssignments(period.id),
      api.listAvailabilities(period.id),
      api.listAssignmentsByDates(period.weekStart, end),
    ]);
    // ほかの店舗の勤務に、店舗の短い名前（福釜・安城・今村）をつける
    const shortOf = (id) => state.stores.find((store) => store.id === id)?.short || "";
    elsewhere = all.filter((shift) => shift.storeId !== period.storeId).map((shift) => ({ ...shift, storeShort: shortOf(shift.storeId) }));
    await loadHistory(end);
    await loadGuests();
    if (!date || !datesOf(period).includes(date)) date = period.weekStart;
  }

  /**
   * 働き方のルール（月・年の上限・連勤）を数えるための、ほかの週の勤務を読む
   *   ・全員：その月の1日（か、6日前のおそい方）〜 その月の最後の日
   *   ・年の上限がある人だけ：1月1日〜 その月の前の日
   * @param {string} end その週の日曜
   */
  async function loadHistory(end) {
    const from = [monthStart(period.weekStart), addDays(period.weekStart, -CONFIG.MAX_STREAK_DAYS)].sort()[0];   // 読み始める日
    const to = monthEnd(end);                                                                                    // 読み終わる日
    const yearIds = wages.filter((wage) => wage.yearYenMax).map((wage) => wage.memberId);                                     // 年の上限がある人
    const yearStart = `${period.weekStart.slice(0, 4)}-01-01`;                                                    // その年の1月1日
    const [near, year] = await Promise.all([   // 近くの日の勤務（全員）と、年の上限がある人の今年の勤務
      api.listAssignmentsByDates(from, to),
      yearIds.length && yearStart < from ? api.listAssignmentsByDates(yearStart, addDays(from, -1), yearIds) : [],
    ]);
    others = [...near, ...year].filter((shift) => shift.periodId !== period.id);
  }

  /** 店員ID → 働き方のルール（18歳未満・月の上限時間・年の上限金額・時給） */
  function limitsMap() {
    return new Map(wages.map((wage) => [wage.memberId, wage]));
  }

  /**
   * この週だけの応援の人（period.guests）を表に足す
   * 応援の人は「応援（ほかの店舗から）」の所に出る（rankHere を 9 にする）
   */
  async function loadGuests() {
    const ids = (period.guests || []).filter((id) => !baseMembers.some((baseMember) => baseMember.id === id));   // まだ表にいない応援の人
    if (ids.length && !company) company = await api.listCompanyMembers();
    const guests = ids.map((id) => company.find((member) => member.id === id)).filter(Boolean).map((id) => ({ ...id, rankHere: 9, guest: true }));   // 応援の人（rankHere 9）
    members = [...baseMembers, ...guests];
    active = members.filter((member) => member.active);
  }

  /** 今の勤務を下書きとして保存して、描き直す */
  async function persist() {
    await api.saveAssignments(period.id, work);
    draw();
  }

  /**
   * 勤務を変える時は必ずこれを通す
   * 変える前の状態を覚えておくので「元に戻す」ができる
   */
  function edit(fn) {
    if (locked()) { toast("公開済みです。直す時は「編集する」を押してください"); return; }
    history.push(work);
    fn();
    persist();
  }

  /** 元に戻す／やり直す */
  function undo() { const snapshot = history.undo(work); if (snapshot) { work = snapshot; persist(); } }
  /** やり直す */
  function redo() { const snapshot = history.redo(work); if (snapshot) { work = snapshot; persist(); } }

  /**
   * その日の表の左端と右端
   * 営業時間をもとに、それより外の勤務があれば広げる（1時間単位）
   */
  function dayRange(date) {
    const hrs = hoursOf(date);   // その日の営業時間
    const day = work.filter((shift) => shift.date === date);   // その日の勤務
    const start = Math.min(hrs.open, ...day.map((shift) => shift.from));   // 左端（分）
    const end = Math.max(hrs.close, ...day.map((shift) => shift.to));   // 右端（分）
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }

  // ============================================================
  // チェック
  // ============================================================

  /**
   * ある日のチェック結果
   * @param {string} date       日付
   * @param {object[]} rows  調べる勤務の一覧（ふつうは今の勤務 work。AIの案を比べる時はその案）
   */
  function dayChecks(date, rows = work) {
    return checkDay({
      date: date,
      dayType: dayTypeOf(date),
      hours: hoursOf(date),
      assignments: rows.filter((row) => row.date === date),
      // ほかの店舗の勤務も入れて、同じ時間に2つ入っていないか確かめる
      allStoreAssignments: [...rows.filter((row) => row.date === date), ...elsewhere.filter((shift) => shift.date === date)],
      members, requirements, positions,
      availabilities: hopes.filter((hope) => hope.date === date),
    });
  }

  /** 週全体のチェック結果（rows：調べる勤務の一覧） */
  function weekChecks(rows = work) {
    // 週1休み・社員の休みは、ほかの店舗に入った日も「入った日」として数える
    // （応援で来ている人は、その人のメインの店舗の画面で数える）
    const mains = active.filter((member) => (member.rankHere ?? 1) === 1);
    return [
      ...checkWeek({ dates: datesOf(period), assignments: [...rows, ...elsewhere], members: mains, availabilities: hopes }),
      // 働き方のルール（18歳未満・連勤・月と年の上限）。応援の人も、この店舗の勤務の分は数える
      ...checkLabor({ dates: datesOf(period), week: rows, others, members: active, limits: limitsMap() }),
    ];
  }

  /** 守れていないもの全部（公開の確認・AIの結果で使う。rows：調べる勤務の一覧） */
  function allProblems(rows = work) {
    const list = [];                                     // {day, text}
    for (const date of datesOf(period)) onlyProblems(dayChecks(date, rows)).forEach((onlyProblem) => list.push({ day: label(date), text: onlyProblem.text }));
    onlyProblems(weekChecks(rows)).forEach((onlyProblem) => list.push({ day: "週全体", text: onlyProblem.text }));
    return list;
  }

  /** この週の人が足りない時間（自動連絡に使う）{date, area, from, to, short} */
  function weekShortages(rows = work) {
    return datesOf(period).flatMap((date) =>
      findShortages(rows.filter((row) => row.date === date), requirements, positions, dayTypeOf(date), hoursOf(date)).map((need) => ({ ...need, date: date })));
  }

  /** AIに渡す情報（ai/draft-service.js の ctx） */
  function aiContext(past = []) {
    return {
      dates: datesOf(period), members: active.map(withLimits), availabilities: hopes, requirements, positions,
      fixed: work.filter((shift) => shift.fixed), past, dayTypeOf, hoursOf, elsewhere, rules, learnings,
      problemsOf: (rows) => allProblems(rows),
    };
  }

  // ============================================================
  // 描く
  // ============================================================

  function draw() {
    const today = work.filter((shift) => shift.date === date);   // 今見ている日の勤務
    const checks = [...dayChecks(date), ...weekChecks()];   // その日と週のチェック

    mount(app,
      screenHeader({
        title: "シフト作成",
        sub: `${STATUS_LABEL[period.status]} ・ この日の営業 ${range(hoursOf(date).open, hoursOf(date).close)}`,
        extra: [
        // 週の移動：前の週／次の週（2か月先まで作れる）
        createElement("div", { class: "week-nav" },
          createElement("button", { class: "btn btn--small", onclick: () => moveWeek(-1), "aria-label": "前の週" }, "‹ 前の週"),
          createElement("strong", { class: "week-nav__label" }, weekLabel(period)),
          createElement("button", { class: "btn btn--small", onclick: () => moveWeek(1), disabled: period.weekStart >= lastWeek, "aria-label": "次の週" }, "次の週 ›"),
          // 紙に印刷（お店に貼る用。PDFにも保存できる）
          createElement("button", { class: "btn btn--small", onclick: () => printWeek({
            title: `${state.stores.find((store) => store.id === period.storeId)?.name || ""} ${weekLabel(period)}${period.status === "published" ? "" : "（下書き）"}`,
            dates: datesOf(period), members: active, assignments: work, note: period.note,
          }) }, "印刷"),
        ),
        locked()
          // 公開済み：「編集する」を押すまで直せない
          ? createElement("div", { class: "chip-row" },
              createElement("span", { class: "badge badge--hall", style: { alignSelf: "center" } }, "公開済み（見るだけ）"),
              createElement("button", { class: "btn btn--small btn--primary", onclick: () => { unlocked = true; toast("編集できます。直したら「変更を公開」を押してください"); draw(); } }, "✏️ 編集する"),
            )
          : createElement("div", { class: "chip-row" },
          // 受付の切り替え：まちがえて締め切っても、もう一度押せば受付中に戻る
          period.status !== "published"
            ? createElement("button", { class: "btn btn--small", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")
            : null,
          createElement("button", { class: "btn btn--small", onclick: undo, disabled: !history.canUndo(), "aria-label": "元に戻す" }, "↶ 元に戻す"),
          createElement("button", { class: "btn btn--small", onclick: redo, disabled: !history.canRedo(), "aria-label": "やり直す" }, "↷ やり直す"),
          createElement("button", { class: "btn btn--small btn--blue", onclick: runDraft }, "✨ AIで作成"),
          createElement("button", { class: "btn btn--small", onclick: addPerson }, "＋ 人を追加"),
          createElement("button", { class: "btn btn--small", onclick: copyLastWeek }, "前週コピー"),
          createElement("button", { class: "btn btn--small btn--primary", onclick: publish }, period.status === "published" ? "変更を公開" : "公開する"),
        ),
        ],
      }),
      createElement("div", { class: "screen-body" },
        aiResult ? resultCard() : null,
        dayTabs(),
        createElement("div", { class: "editor" },
          createElement("section", { class: "card editor__table" },
            timeline({
              ...dayRange(date),
              hours: hoursOf(date),
              members: active,
              assignments: today,
              elsewhere: elsewhere.filter((shift) => shift.date === date),
              availabilities: hopes.filter((hope) => hope.date === date),   // 希望は店長だけに見せる
              needs: needRows(today),
              selectedId,
              editable: !locked(),
              onSelect: (id) => { selectedId = id; draw(); },
              onChange: (shift, change) => { selectedId = shift.memberId; edit(() => Object.assign(shift, change)); },
            }),
            legend(),
          ),
          createElement("div", { class: "editor__table" }, dayList({ assignments: today, members, hours: hoursOf(date) })),
          createElement("div", { class: "editor__side" },
            selectedId ? memberPanel(selectedId) : createElement("section", { class: "card home-muted" }, "名前か線を押すと、ここで細かく直せます"),
            locked() ? null : dayTools(),
            createElement("section", { class: "card" },
              createElement("h2", { class: "card__title" }, `ルールのチェック（${label(date)}）`),
              createElement("ul", { class: "check-list" },
                checks.map((check) => createElement("li", { class: check.ok ? "is-ok" : "is-ng" }, createElement("strong", null, check.ok ? "✓" : "!"), check.text))),
              // 守れていないルールがあれば、AIに直してもらえる（週全体を見て直す）
              !locked() && onlyProblems(checks).length
                ? createElement("button", { class: "btn btn--small btn--blue", onclick: fixByAi }, "✨ AIに直してもらう（この週）")
                : null,
            ),
            shortageCard(),
            laborCard(),
            noteCard(),
          ),
        ),
      ),
    );
  }

  /** 日のタブ（守れていない日は赤い点） */
  function dayTabs() {
    return createElement("div", { class: "day-tabs" },
      datesOf(period).map((eachDate) => {
        const bad = onlyProblems(dayChecks(eachDate)).length > 0;   // 守れていないルールがある日か
        return createElement("button", { class: "chip day-tab", "aria-pressed": String(eachDate === date), onclick: () => { date = eachDate; draw(); } },
          label(eachDate), bad ? createElement("span", { class: "day-tab__dot", "aria-label": "守れていないルールあり" }) : null);
      }));
  }

  /** 1時間ごとの「必要／入っている」 */
  function needRows(dayAssignments) {
    const type = dayTypeOf(date);   // 平日／土曜／日曜祝日
    /** 1つの場所の1時間ごとの「必要／入っている」 */
    const make = (area, labelText, color) => {
      const slots = [];   // 1時間ごとの数
      const { start, end } = dayRange(date);   // 表の左端と右端
      for (let minutes = start; minutes < end; minutes += 60) {
        // その1時間でいちばん足りない時を出す（15分ごとに見る）
        let need = 0, have = 0, worst = -Infinity;
        for (let slot = minutes; slot < minutes + 60; slot += 15) {
          const count = requiredAt(requirements, positions, type, area, slot);   // 必要な人数
          const hv = assignedAt(dayAssignments, area, slot);   // 入っている人数
          if (count - hv > worst) { worst = count - hv; need = count; have = hv; }
        }
        slots.push({ need, have });
      }
      return { label: labelText, color, slots };
    };
    return [make("hall", "ホール 人数", "var(--hall)"), make("kitchen", "キッチン 人数", "var(--kitchen)")];
  }

  /** 色の見方 */
  function legend() {
    return createElement("div", { class: "legend" },
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--hall" }), "ホール"),
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--kitchen" }), "キッチン"),
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--hope" }), "希望"),
      createElement("span", null, createElement("i", { class: "legend__circle" }), "休憩の目安"),
      createElement("span", null, createElement("i", { class: "legend__bar legend__bar--fixed" }), "固定"),
      createElement("span", { class: "home-muted" }, "線をドラッグで移動、端をドラッグで時間を変える"),
    );
  }

  /** 右の欄：選んだ店員のくわしい内容と直す道具（components/assignment-panel.js） */
  function memberPanel(id) {
    const member = members.find((member) => member.id === id);   // 選んだ店員
    const hope = hopes.find((hope) => hope.memberId === id && hope.date === date);   // その日の希望
    return assignmentPanel({
      member: member,
      date,
      assignments: work.filter((shift) => shift.memberId === id && shift.date === date).sort((shiftA, shiftB) => shiftA.from - shiftB.from),
      hope,
      rule: ruleOf(id),
      others: active.filter((member) => member.id !== id),
      locked: locked(),
      // この週の働く時間（ほかの店舗の分も入れる。週の上限を超えないように見るため）
      weekText: (() => {
        const mine = [...work, ...elsewhere].filter((shift) => shift.memberId === id);   // その人のこの週の勤務（ほかの店舗も）
        const days = new Set(mine.map((shift) => shift.date)).size;   // 入っている日数
        const lim = limitsMap().get(id) || {};                                     // 働き方のルール
        const use = usageOf(id, date, [...work, ...others], lim);                 // 今月・今年
        return [
          `この週：${hoursText(minutesByMember(mine).get(id) || 0)}（${days}日）`,
          `今月：${hoursText(use.monthMinutes)}${lim.monthHoursMax ? ` / 上限 ${lim.monthHoursMax}時間` : ""}`,
          lim.yearYenMax ? `今年：約${yen(use.yearYen)} / 上限 ${yen(lim.yearYenMax)}` : "",
          lim.minor ? "18歳未満（22時〜朝5時は入れない）" : "",
        ].filter(Boolean).join("　");
      })(),
      elsewhere: elsewhere.filter((shift) => shift.memberId === id && shift.date === date),
      onEdit: (fn) => edit(fn),
      onRemove: (shift) => edit(() => { work = work.filter((other) => other !== shift); }),
      onAdd: () => edit(() => {
        // 希望があればその時間、もう勤務があればその後ろ、なければ 9:00〜15:00
        const mine = work.filter((shift) => shift.memberId === id && shift.date === date);
        let from = 9 * 60, to = 15 * 60;   // 足す勤務の時間（最初は 9:00〜15:00）
        if (mine.length) {
          // 今の勤務の1時間後から3時間。翌2:00をこえるなら、今の勤務の前に入れる
          from = Math.max(...mine.map((shift) => shift.to)) + 60; to = from + 3 * 60;
          if (to > EDIT_MAX) { to = Math.min(...mine.map((shift) => shift.from)) - 60; from = Math.max(EDIT_MIN, to - 3 * 60); }
          if (to <= from) { toast("この日はもう勤務を足す時間がありません"); return; }
        }
        else if (hope?.kind === "time") { from = hope.from; to = hope.to; }
        work.push({ memberId: id, date, from, to, area: member.skills.kitchen > member.skills.hall ? "kitchen" : "hall", breakAt: null, fixed: false, createdBy: "manager", requested: false });
      }),
      onApproveSpecial: async () => {
        await api.approveSpecialOff(period.id, id, date);
        hopes = await api.listAvailabilities(period.id);
        toast("特別許可を出しました");
        draw();
      },
    });
  }

  /** この日の道具：ほかの日にコピー・全部消す */
  function dayTools() {
    const target = createElement("select", { class: "select", "aria-label": "コピー先の日" },   // コピー先の日を選ぶ欄
      datesOf(period).filter((eachDate) => eachDate !== date).map((date) => createElement("option", { value: date }, label(date))));
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, `${label(date)} の道具`),
      createElement("div", { class: "time-range" },
        target,
        createElement("button", { class: "btn btn--small", onclick: () => copyDay(target.value) }, "へコピー"),
      ),
      createElement("button", { class: "btn btn--small btn--danger", onclick: clearDay }, "この日の勤務を全部消す（固定は残す）"),
    );
  }

  /**
   * 人件費の目安（Airシフト・7shifts の「人件費」を参考に）
   * 時給×働いた時間（休憩を引く）、深夜は1.25倍、交通費。社員は入れない（lib/labor.js）
   */
  function laborCard() {
    const day = laborCost(work.filter((shift) => shift.date === date), wages);   // その日の人件費
    const week = laborCost(work, wages);   // この週の人件費
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, "人件費の目安（バイト・フル）"),
      createElement("div", { class: "labor" },
        createElement("div", null, createElement("span", { class: "home-muted" }, label(date)), createElement("strong", { class: "num" }, yen(day))),
        createElement("div", null, createElement("span", { class: "home-muted" }, "この週"), createElement("strong", { class: "num" }, yen(week))),
      ),
      createElement("div", { class: "home-muted" }, "時給と交通費は「店員管理」で入れます。休憩（6時間をこえたら45分・8時間をこえたら60分）を引いて計算"),
    );
  }

  /** 連絡事項（紙の右下の欄と同じ。公開シフトでみんなが見られる） */
  function noteCard() {
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, "連絡事項（この週）"),
      createElement("textarea", {
        class: "textarea",
        disabled: locked(),
        placeholder: "例：11/12 研修あり、11/14 お祭りで混みます",
        onchange: async (event) => { period.note = event.target.value; await api.savePeriodNote(period.id, period.note); toast("連絡事項を保存しました"); },
      }, period.note || ""),
    );
  }

  /** この日をほかの日にコピー（コピー先の固定した勤務は残す） */
  function copyDay(to) {
    edit(() => {
      const keep = work.filter((shift) => shift.date !== to || shift.fixed);   // 残す勤務（コピー先の固定と、ほかの日）
      const fixedThere = new Set(keep.filter((shift) => shift.date === to).map((shift) => shift.memberId));   // コピー先で固定されている人
      const copied = work   // コピーした勤務
        .filter((shift) => shift.date === date && !fixedThere.has(shift.memberId))
        .map((shift) => ({ ...shift, id: undefined, date: to, fixed: false, createdBy: "copy" }));
      work = [...keep, ...copied];
    });
    toast(`${label(to)} にコピーしました`);
  }

  /** この日の勤務を全部消す（固定は残す） */
  async function clearDay() {
    const ok = await confirmDialog({ title: `${label(date)} の勤務を全部消しますか？`, body: createElement("p", { style: { margin: 0 } }, "固定した勤務は残ります。「元に戻す」で戻せます。"), yes: "消す", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;
    edit(() => { work = work.filter((shift) => shift.date !== date || shift.fixed); });
  }

  // ============================================================
  // ボタンの動き
  // ============================================================

  /** 前の週／次の週へ（その週がまだなければ作る） */
  async function moveWeek(step) {
    const weekStart = addDays(period.weekStart, 7 * step);   // 行く週の月曜
    if (weekStart > lastWeek) return;
    let next = periods.find((period) => period.weekStart === weekStart);   // その週の受付
    if (!next) {
      next = await api.ensurePeriod(weekStart);
      periods.push(next);
      periods.sort((periodA, periodB) => periodA.weekStart.localeCompare(periodB.weekStart));
    }
    period = next;
    date = null;
    selectedId = null;
    unlocked = false;
    aiResult = null;                               // ほかの週の「AIの結果」は出さない
    history.clear();
    await loadPeriod();
    draw();
  }

  /** 受付中 ⇔ 締切 を切り替える */
  async function toggleIntake() {
    const next = period.status === "open" ? "closed" : "open";   // 次の状態
    await api.setPeriodStatus(period.id, next);
    period.status = next;
    toast(next === "closed" ? "受付を締め切りました（もう一度押すと戻せます）" : "受付を再開しました");
    draw();
  }

  /**
   * 「AIで作成」：Gemini が下書きを作る（固定した勤務は残す）
   * AIがつながらない時は簡易版で作る。結果は一番上の「AIの結果」に出る
   */
  async function runDraft() {
    const hasWork = work.some((shift) => !shift.fixed);                        // もう勤務が入っているか
    if (hasWork) {
      const ok = await confirmDialog({   // 作り直すか聞く
        title: "下書きを作り直しますか？",
        body: createElement("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、新しい下書きになります。「AIの前に戻す」で戻せます。"),
        yes: "作り直す", no: "やめる",
      });
      if (!ok) return;
    }
    const wait = busy("準備しています");                                // 待っている間の画面
    try {
      // 過去の勤務：前の週の分を「よく入っている人」の参考にする
      const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((shift) => ({ ...shift }));                       // AIの前（「変わった所」を出すため）
      const result = await runAiDraft(aiContext(past), { onStep: wait.update });   // AIの結果
      history.push(work);
      work = result.rows;
      await api.saveAiDraft(period.id, work);                           // 公開の時に「店長がどう直したか」を比べるため
      aiResult = { result, kind: "draft", before };
      await persist();
      window.scrollTo(0, 0);
      toast(result.source === "gemini" ? "AIが下書きを作りました" : "簡易版で下書きを作りました");
    } finally {
      wait.done();
    }
  }

  /** 「AIに直してもらう」：守れていないルールだけ AI が直す（週全体） */
  async function fixByAi() {
    const problems = allProblems();                                   // 今の守れていないルール
    if (!problems.length) { toast("守れていないルールはありません"); return; }
    if (!aiReady().ok) {
      const ok = await confirmDialog({ title: "AIの設定がまだです", body: createElement("p", { style: { margin: 0 } }, `${aiReady().why}。AIの設定を開きますか？`), yes: "開く", no: "やめる" });   // 設定を開くか聞く
      if (ok) go("/ai");
      return;
    }
    const wait = busy("AIが直しています（30秒〜1分くらい）");   // 待っている間の画面
    try {
      const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));   // 前の週
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((shift) => ({ ...shift }));   // AIの前の勤務
      const result = await fixWithAi(aiContext(past), work, problems, { onStep: wait.update });   // AIが直した結果
      if (!result.applied) {
        toast(result.error ? `AIで直せませんでした：${result.error}` : `AIの案は問題が減らなかったので使いませんでした（${result.before}件 → ${result.after}件）`);
        return;
      }
      history.push(work);
      work = result.rows;
      await api.saveAiDraft(period.id, work);
      aiResult = {
        kind: "fix", before,
        result: { rows: work, source: "gemini", model: result.model, summary: result.summary, concerns: result.concerns, dropped: result.dropped, learnedCount: 0 },
      };
      await persist();
      window.scrollTo(0, 0);
      toast(`AIが直しました（守れていないルール ${result.before}件 → ${result.after}件）`);
    } finally {
      wait.done();
    }
  }

  /** 一番上の「AIの結果」カード（components/ai-result.js） */
  function resultCard() {
    return aiResultCard({
      ...aiResult,
      members,
      problems: allProblems(),
      costText: yen(laborCost(work, wages)),
      aiOn: aiReady().ok && !locked(),
      onFix: fixByAi,
      onUndo: () => { undo(); aiResult = null; draw(); toast("AIの前に戻しました"); },
      onClose: () => { aiResult = null; draw(); },
      onSettings: () => go("/ai"),
      onJump: (eachDate, id) => { date = eachDate; selectedId = id; draw(); document.querySelector(".editor")?.scrollIntoView({ behavior: "smooth" }); },
    });
  }

  /**
   * 人が足りない時間と「入れそうな人に連絡する」（2026年11月5日）
   * 公開した時は自動で連絡する。公開の前でも、このボタンで先に連絡できる
   */
  function shortageCard() {
    const list = mergeNeeds(weekShortages());                          // この週の足りない時間（近いものはまとめる）
    if (!list.length || locked()) return null;
    /** 場所の名前 */
    const area = (need) => (need.area === "hall" ? "ホール" : "キッチン");
    return createElement("section", { class: "card" },
      createElement("h2", { class: "card__title" }, `人が足りない時間（この週 ${list.length}件）`),
      createElement("ul", { class: "check-list" }, list.slice(0, 8).map((need) => createElement("li", { class: "is-ng" }, createElement("strong", null, label(need.date)), `${area(need)} ${range(need.from, need.to)} ${need.short}人`))),
      list.length > 8 ? createElement("div", { class: "home-muted" }, `ほか ${list.length - 8}件`) : null,
      createElement("button", { class: "btn btn--small", onclick: async () => {
        const result = await api.sendCalls(period.id, list);   // 連絡した結果
        toast(result.sent ? `${result.people}人に連絡しました（${result.sent}件）${result.none ? `。入れそうな人がいない所 ${result.none}件` : ""}` : result.none ? "入れそうな人がいませんでした" : "もう連絡してあります");
      } }, "入れそうな人に連絡する"),
      createElement("div", { class: "home-muted" }, "公開した時に足りない時間が残っていれば、自動で連絡します。返事はホームに出ます"),
    );
  }

  /** 「＋ 人を追加」：ほかの店舗の人・まだアカウントがない人（components/add-person.js） */
  async function addPerson() {
    if (locked()) { toast("公開済みです。直す時は「編集する」を押してください"); return; }
    company = await api.listCompanyMembers();
    await openAddPerson({
      company,
      shown: new Set(members.map((member) => member.id)),
      // ほかの店舗の人：この週だけ応援 or この店舗にも行けるようにする
      onPickOther: async (memberId, how) => {
        if (how === "week") {
          period.guests = await api.addGuest(period.id, memberId);
        } else {
          await api.addMembersToStore(period.storeId, [memberId]);
          baseMembers.splice(0, baseMembers.length, ...(await api.listMembers()));
        }
        await loadGuests();
        selectedId = memberId;
        draw();
        toast(how === "week" ? "この週だけ応援で足しました。表の下の「応援」に出ます" : "この店舗にも行けるようにしました");
      },
      // まだアカウントがない人：登録だけする（ログインはまだできない）
      onCreate: async (form) => {
        const { member } = await api.createMember({ ...form, account: false, stores: [{ storeId: period.storeId, rank: 1 }] });   // 登録した人
        baseMembers.push({ ...member, rankHere: 1 });
        await loadGuests();
        selectedId = member.id;
        draw();
        toast(`${member.name} を登録しました。名前を押して勤務を足せます（アカウントはあとで店員管理から）`);
      },
    });
  }

  /** 前週コピー */
  async function copyLastWeek() {
    const prev = periods.find((eachPeriod) => eachPeriod.weekStart === addDays(period.weekStart, -7));   // 前の週
    if (!prev) { toast("前の週がありません"); return; }
    const ok = await confirmDialog({   // コピーするか聞く
      title: "先週と同じにしますか？",
      body: createElement("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、先週と同じ形になります。"),
      yes: "コピーする", no: "やめる",
    });
    if (!ok) return;
    const last = await api.listAssignments(prev.id);   // 先週の勤務
    const activeIds = new Set(active.map((member) => member.id));   // 働いている人のID
    const fixed = work.filter((shift) => shift.fixed);   // 固定した勤務
    const fixedKey = new Set(fixed.map((shift) => `${shift.memberId}|${shift.date}`));   // 固定がある人と日
    const copied = last   // 1週間後にずらした勤務
      .filter((shift) => activeIds.has(shift.memberId) && shift.storeId === period.storeId)
      .map((shift) => ({ ...shift, id: undefined, date: addDays(shift.date, 7), fixed: false, createdBy: "copy" }))
      .filter((shift) => !fixedKey.has(`${shift.memberId}|${shift.date}`));
    history.push(work);
    work = [...fixed, ...copied];
    await persist();
    toast("先週のシフトをコピーしました");
  }

  /** 公開（守れていなければ⚠️警告 →「はい」でそのまま公開） */
  async function publish() {
    const problems = allProblems();   // 守れていないルール
    if (problems.length) {
      const yes = await confirmDialog({   // そのまま公開するか聞く
        title: "守れていないルールがあります",
        warn: true,
        body: createElement("div", { class: "publish-problems" },
          createElement("ul", { class: "check-list" }, problems.map((problem) => createElement("li", { class: "is-ng" }, createElement("strong", null, problem.day), problem.text))),
          createElement("p", { style: { margin: "8px 0 0", fontWeight: 700 } }, "このまま公開しますか？"),
        ),
        yes: "はい（公開する）",
        no: "いいえ（直す）",
      });
      if (!yes) return;
    }
    await api.saveAssignments(period.id, work);
    await api.setPeriodStatus(period.id, "published");
    await api.notifyPublished(period.id, weekLabel(period));
    // 店長の直し方を覚える（AIの下書きと、公開したシフトを比べる）
    const learnedNow = await api.learnFromPublish(period.id);              // 新しく覚えた数
    // 足りない時間が残っていれば、入れそうな人に自動で連絡する
    const short = weekShortages();
    const called = short.length ? await api.sendCalls(period.id, short, { auto: true }) : null;   // 自動連絡の結果
    period.status = "published";
    unlocked = false;                              // 公開したら、また「編集する」を押すまで直せない
    aiResult = null;
    toast([
      problems.length ? "警告があるまま公開しました。全員に知らせます" : "公開しました。全員に知らせます",
      learnedNow ? `AIが店長の直し方を ${learnedNow}件 覚えました` : "",
      called?.sent ? `足りない時間を ${called.people}人に自動で連絡しました` : "",
    ].filter(Boolean).join("。"));
    draw();
  }
}
