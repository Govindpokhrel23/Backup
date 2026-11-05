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

import { h, mount, toast, confirmDialog, busy } from "../lib/dom.js";
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
import { label, dayType, addDays, mondayOf, toIso } from "../lib/date.js";
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
  let active = members.filter((m) => m.active);   // 表に出す人のうち、休止していない人
  /** 人ごとのルール */
  const ruleOf = (id) => rules.find((r) => r.memberId === id)?.text || "なし";
  /** 平日／土曜／日曜祝日 */
  const dayTypeOf = (d) => dayType(d, holidays);
  const hoursOf = (d) => storeHours[dayTypeOf(d)];          // その日の営業時間（マップ画面で店長が決める）

  // ---------- 画面の中で持つ状態 ----------
  let period = workingPeriod(periods);
  let work = [];           // この週の勤務（下書き・公開済み）
  let hopes = [];          // この週の希望
  let date = null;         // 表示している日
  let selectedId = null;   // 右の欄で見ている店員
  let elsewhere = [];      // この週にほかの店舗に入っている勤務（重ねないため・見るだけ）
  let unlocked = false;    // 公開済みの週で「編集する」を押したか
  let aiResult = null;     // 一番上に出す「AIの結果」{result, kind, before}（閉じたら null）
  const history = createHistory();   // 「元に戻す」用

  /** 公開済みで、まだ「編集する」を押していない＝直せない */
  const locked = () => period.status === "published" && !unlocked;

  /** 何週先までシフトを作れるか（希望と同じ2か月先まで） */
  const lastWeek = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + CONFIG.MONTHS_AHEAD);   // 今日から2か月先
    return mondayOf(toIso(d));
  })();

  // まだ週が1つもない店舗（増やしたばかりの店舗など）は、来週の受付を作って始める
  if (!period) {
    period = await api.ensurePeriod(addDays(mondayOf(toIso(new Date())), 7));
    periods.push(period);
  }
  await loadPeriod();
  draw();

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
    const shortOf = (id) => state.stores.find((s) => s.id === id)?.short || "";
    elsewhere = all.filter((a) => a.storeId !== period.storeId).map((a) => ({ ...a, storeShort: shortOf(a.storeId) }));
    await loadGuests();
    if (!date || !datesOf(period).includes(date)) date = period.weekStart;
  }

  /**
   * この週だけの応援の人（period.guests）を表に足す
   * 応援の人は「応援（ほかの店舗から）」の所に出る（rankHere を 9 にする）
   */
  async function loadGuests() {
    const ids = (period.guests || []).filter((id) => !baseMembers.some((m) => m.id === id));   // まだ表にいない応援の人
    if (ids.length && !company) company = await api.listCompanyMembers();
    const guests = ids.map((id) => company.find((m) => m.id === id)).filter(Boolean).map((m) => ({ ...m, rankHere: 9, guest: true }));   // 応援の人（rankHere 9）
    members = [...baseMembers, ...guests];
    active = members.filter((m) => m.active);
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
  function undo() { const w = history.undo(work); if (w) { work = w; persist(); } }
  /** やり直す */
  function redo() { const w = history.redo(work); if (w) { work = w; persist(); } }

  /**
   * その日の表の左端と右端
   * 営業時間をもとに、それより外の勤務があれば広げる（1時間単位）
   */
  function dayRange(d) {
    const hrs = hoursOf(d);   // その日の営業時間
    const day = work.filter((a) => a.date === d);   // その日の勤務
    const start = Math.min(hrs.open, ...day.map((a) => a.from));   // 左端（分）
    const end = Math.max(hrs.close, ...day.map((a) => a.to));   // 右端（分）
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }

  // ============================================================
  // チェック
  // ============================================================

  /**
   * ある日のチェック結果
   * @param {string} d       日付
   * @param {object[]} rows  調べる勤務の一覧（ふつうは今の勤務 work。AIの案を比べる時はその案）
   */
  function dayChecks(d, rows = work) {
    return checkDay({
      date: d,
      dayType: dayTypeOf(d),
      hours: hoursOf(d),
      assignments: rows.filter((a) => a.date === d),
      // ほかの店舗の勤務も入れて、同じ時間に2つ入っていないか確かめる
      allStoreAssignments: [...rows.filter((a) => a.date === d), ...elsewhere.filter((a) => a.date === d)],
      members, requirements, positions,
      availabilities: hopes.filter((x) => x.date === d),
    });
  }

  /** 週全体のチェック結果（rows：調べる勤務の一覧） */
  function weekChecks(rows = work) {
    // 週1休み・社員の休みは、ほかの店舗に入った日も「入った日」として数える
    // （応援で来ている人は、その人のメインの店舗の画面で数える）
    const mains = active.filter((m) => (m.rankHere ?? 1) === 1);
    return checkWeek({ dates: datesOf(period), assignments: [...rows, ...elsewhere], members: mains, availabilities: hopes });
  }

  /** 守れていないもの全部（公開の確認・AIの結果で使う。rows：調べる勤務の一覧） */
  function allProblems(rows = work) {
    const list = [];                                     // {day, text}
    for (const d of datesOf(period)) onlyProblems(dayChecks(d, rows)).forEach((x) => list.push({ day: label(d), text: x.text }));
    onlyProblems(weekChecks(rows)).forEach((x) => list.push({ day: "週全体", text: x.text }));
    return list;
  }

  /** この週の人が足りない時間（自動連絡に使う）{date, area, from, to, short} */
  function weekShortages(rows = work) {
    return datesOf(period).flatMap((d) =>
      findShortages(rows.filter((a) => a.date === d), requirements, positions, dayTypeOf(d), hoursOf(d)).map((x) => ({ ...x, date: d })));
  }

  /** AIに渡す情報（ai/draft-service.js の ctx） */
  function aiContext(past = []) {
    return {
      dates: datesOf(period), members: active, availabilities: hopes, requirements, positions,
      fixed: work.filter((a) => a.fixed), past, dayTypeOf, hoursOf, elsewhere, rules, learnings,
      problemsOf: (rows) => allProblems(rows),
    };
  }

  // ============================================================
  // 描く
  // ============================================================

  function draw() {
    const today = work.filter((a) => a.date === date);   // 今見ている日の勤務
    const checks = [...dayChecks(date), ...weekChecks()];   // その日と週のチェック

    mount(app,
      screenHeader({
        title: "シフト作成",
        sub: `${STATUS_LABEL[period.status]} ・ この日の営業 ${range(hoursOf(date).open, hoursOf(date).close)}`,
        extra: [
        // 週の移動：前の週／次の週（2か月先まで作れる）
        h("div", { class: "week-nav" },
          h("button", { class: "btn btn--small", onclick: () => moveWeek(-1), "aria-label": "前の週" }, "‹ 前の週"),
          h("strong", { class: "week-nav__label" }, weekLabel(period)),
          h("button", { class: "btn btn--small", onclick: () => moveWeek(1), disabled: period.weekStart >= lastWeek, "aria-label": "次の週" }, "次の週 ›"),
          // 紙に印刷（お店に貼る用。PDFにも保存できる）
          h("button", { class: "btn btn--small", onclick: () => printWeek({
            title: `${state.stores.find((s) => s.id === period.storeId)?.name || ""} ${weekLabel(period)}${period.status === "published" ? "" : "（下書き）"}`,
            dates: datesOf(period), members: active, assignments: work, note: period.note,
          }) }, "印刷"),
        ),
        locked()
          // 公開済み：「編集する」を押すまで直せない
          ? h("div", { class: "chip-row" },
              h("span", { class: "badge badge--hall", style: { alignSelf: "center" } }, "公開済み（見るだけ）"),
              h("button", { class: "btn btn--small btn--primary", onclick: () => { unlocked = true; toast("編集できます。直したら「変更を公開」を押してください"); draw(); } }, "✏️ 編集する"),
            )
          : h("div", { class: "chip-row" },
          // 受付の切り替え：まちがえて締め切っても、もう一度押せば受付中に戻る
          period.status !== "published"
            ? h("button", { class: "btn btn--small", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")
            : null,
          h("button", { class: "btn btn--small", onclick: undo, disabled: !history.canUndo(), "aria-label": "元に戻す" }, "↶ 元に戻す"),
          h("button", { class: "btn btn--small", onclick: redo, disabled: !history.canRedo(), "aria-label": "やり直す" }, "↷ やり直す"),
          h("button", { class: "btn btn--small btn--blue", onclick: runDraft }, "✨ AIで作成"),
          h("button", { class: "btn btn--small", onclick: addPerson }, "＋ 人を追加"),
          h("button", { class: "btn btn--small", onclick: copyLastWeek }, "前週コピー"),
          h("button", { class: "btn btn--small btn--primary", onclick: publish }, period.status === "published" ? "変更を公開" : "公開する"),
        ),
        ],
      }),
      h("div", { class: "screen-body" },
        aiResult ? resultCard() : null,
        dayTabs(),
        h("div", { class: "editor" },
          h("section", { class: "card editor__table" },
            timeline({
              ...dayRange(date),
              hours: hoursOf(date),
              members: active,
              assignments: today,
              elsewhere: elsewhere.filter((a) => a.date === date),
              availabilities: hopes.filter((x) => x.date === date),   // 希望は店長だけに見せる
              needs: needRows(today),
              selectedId,
              editable: !locked(),
              onSelect: (id) => { selectedId = id; draw(); },
              onChange: (a, change) => { selectedId = a.memberId; edit(() => Object.assign(a, change)); },
            }),
            legend(),
          ),
          h("div", { class: "editor__table" }, dayList({ assignments: today, members, hours: hoursOf(date) })),
          h("div", { class: "editor__side" },
            selectedId ? memberPanel(selectedId) : h("section", { class: "card home-muted" }, "名前か線を押すと、ここで細かく直せます"),
            locked() ? null : dayTools(),
            h("section", { class: "card" },
              h("h2", { class: "card__title" }, `ルールのチェック（${label(date)}）`),
              h("ul", { class: "check-list" },
                checks.map((c) => h("li", { class: c.ok ? "is-ok" : "is-ng" }, h("strong", null, c.ok ? "✓" : "!"), c.text))),
              // 守れていないルールがあれば、AIに直してもらえる（週全体を見て直す）
              !locked() && onlyProblems(checks).length
                ? h("button", { class: "btn btn--small btn--blue", onclick: fixByAi }, "✨ AIに直してもらう（この週）")
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
    return h("div", { class: "day-tabs" },
      datesOf(period).map((d) => {
        const bad = onlyProblems(dayChecks(d)).length > 0;   // 守れていないルールがある日か
        return h("button", { class: "chip day-tab", "aria-pressed": String(d === date), onclick: () => { date = d; draw(); } },
          label(d), bad ? h("span", { class: "day-tab__dot", "aria-label": "守れていないルールあり" }) : null);
      }));
  }

  /** 1時間ごとの「必要／入っている」 */
  function needRows(dayAssignments) {
    const type = dayTypeOf(date);   // 平日／土曜／日曜祝日
    /** 1つの場所の1時間ごとの「必要／入っている」 */
    const make = (area, labelText, color) => {
      const slots = [];   // 1時間ごとの数
      const { start, end } = dayRange(date);   // 表の左端と右端
      for (let m = start; m < end; m += 60) {
        // その1時間でいちばん足りない時を出す（15分ごとに見る）
        let need = 0, have = 0, worst = -Infinity;
        for (let q = m; q < m + 60; q += 15) {
          const n = requiredAt(requirements, positions, type, area, q);   // 必要な人数
          const hv = assignedAt(dayAssignments, area, q);   // 入っている人数
          if (n - hv > worst) { worst = n - hv; need = n; have = hv; }
        }
        slots.push({ need, have });
      }
      return { label: labelText, color, slots };
    };
    return [make("hall", "ホール 人数", "var(--hall)"), make("kitchen", "キッチン 人数", "var(--kitchen)")];
  }

  /** 色の見方 */
  function legend() {
    return h("div", { class: "legend" },
      h("span", null, h("i", { class: "legend__bar legend__bar--hall" }), "ホール"),
      h("span", null, h("i", { class: "legend__bar legend__bar--kitchen" }), "キッチン"),
      h("span", null, h("i", { class: "legend__bar legend__bar--hope" }), "希望"),
      h("span", null, h("i", { class: "legend__circle" }), "休憩の目安"),
      h("span", null, h("i", { class: "legend__bar legend__bar--fixed" }), "固定"),
      h("span", { class: "home-muted" }, "線をドラッグで移動、端をドラッグで時間を変える"),
    );
  }

  /** 右の欄：選んだ店員のくわしい内容と直す道具（components/assignment-panel.js） */
  function memberPanel(id) {
    const m = members.find((x) => x.id === id);   // 選んだ店員
    const hope = hopes.find((x) => x.memberId === id && x.date === date);   // その日の希望
    return assignmentPanel({
      member: m,
      date,
      assignments: work.filter((x) => x.memberId === id && x.date === date).sort((a, b) => a.from - b.from),
      hope,
      rule: ruleOf(id),
      others: active.filter((x) => x.id !== id),
      locked: locked(),
      // この週の働く時間（ほかの店舗の分も入れる。週の上限を超えないように見るため）
      weekText: (() => {
        const mine = [...work, ...elsewhere].filter((a) => a.memberId === id);   // その人のこの週の勤務（ほかの店舗も）
        const days = new Set(mine.map((a) => a.date)).size;   // 入っている日数
        return `この週：${hoursText(minutesByMember(mine).get(id) || 0)}（${days}日）`;
      })(),
      elsewhere: elsewhere.filter((a) => a.memberId === id && a.date === date),
      onEdit: (fn) => edit(fn),
      onRemove: (a) => edit(() => { work = work.filter((x) => x !== a); }),
      onAdd: () => edit(() => {
        // 希望があればその時間、もう勤務があればその後ろ、なければ 9:00〜15:00
        const mine = work.filter((x) => x.memberId === id && x.date === date);
        let from = 9 * 60, to = 15 * 60;   // 足す勤務の時間（最初は 9:00〜15:00）
        if (mine.length) {
          // 今の勤務の1時間後から3時間。翌2:00をこえるなら、今の勤務の前に入れる
          from = Math.max(...mine.map((x) => x.to)) + 60; to = from + 3 * 60;
          if (to > EDIT_MAX) { to = Math.min(...mine.map((x) => x.from)) - 60; from = Math.max(EDIT_MIN, to - 3 * 60); }
          if (to <= from) { toast("この日はもう勤務を足す時間がありません"); return; }
        }
        else if (hope?.kind === "time") { from = hope.from; to = hope.to; }
        work.push({ memberId: id, date, from, to, area: m.skills.kitchen > m.skills.hall ? "kitchen" : "hall", breakAt: null, fixed: false, createdBy: "manager", requested: false });
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
    const target = h("select", { class: "select", "aria-label": "コピー先の日" },   // コピー先の日を選ぶ欄
      datesOf(period).filter((d) => d !== date).map((d) => h("option", { value: d }, label(d))));
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, `${label(date)} の道具`),
      h("div", { class: "time-range" },
        target,
        h("button", { class: "btn btn--small", onclick: () => copyDay(target.value) }, "へコピー"),
      ),
      h("button", { class: "btn btn--small btn--danger", onclick: clearDay }, "この日の勤務を全部消す（固定は残す）"),
    );
  }

  /**
   * 人件費の目安（Airシフト・7shifts の「人件費」を参考に）
   * 時給×働いた時間（休憩を引く）、深夜は1.25倍、交通費。社員は入れない（lib/labor.js）
   */
  function laborCard() {
    const day = laborCost(work.filter((a) => a.date === date), wages);   // その日の人件費
    const week = laborCost(work, wages);   // この週の人件費
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "人件費の目安（バイト・フル）"),
      h("div", { class: "labor" },
        h("div", null, h("span", { class: "home-muted" }, label(date)), h("strong", { class: "num" }, yen(day))),
        h("div", null, h("span", { class: "home-muted" }, "この週"), h("strong", { class: "num" }, yen(week))),
      ),
      h("div", { class: "home-muted" }, "時給と交通費は「店員管理」で入れます。休憩（6時間をこえたら45分・8時間をこえたら60分）を引いて計算"),
    );
  }

  /** 連絡事項（紙の右下の欄と同じ。公開シフトでみんなが見られる） */
  function noteCard() {
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "連絡事項（この週）"),
      h("textarea", {
        class: "textarea",
        disabled: locked(),
        placeholder: "例：11/12 研修あり、11/14 お祭りで混みます",
        onchange: async (e) => { period.note = e.target.value; await api.savePeriodNote(period.id, period.note); toast("連絡事項を保存しました"); },
      }, period.note || ""),
    );
  }

  /** この日をほかの日にコピー（コピー先の固定した勤務は残す） */
  function copyDay(to) {
    edit(() => {
      const keep = work.filter((a) => a.date !== to || a.fixed);   // 残す勤務（コピー先の固定と、ほかの日）
      const fixedThere = new Set(keep.filter((a) => a.date === to).map((a) => a.memberId));   // コピー先で固定されている人
      const copied = work   // コピーした勤務
        .filter((a) => a.date === date && !fixedThere.has(a.memberId))
        .map((a) => ({ ...a, id: undefined, date: to, fixed: false, createdBy: "copy" }));
      work = [...keep, ...copied];
    });
    toast(`${label(to)} にコピーしました`);
  }

  /** この日の勤務を全部消す（固定は残す） */
  async function clearDay() {
    const ok = await confirmDialog({ title: `${label(date)} の勤務を全部消しますか？`, body: h("p", { style: { margin: 0 } }, "固定した勤務は残ります。「元に戻す」で戻せます。"), yes: "消す", no: "やめる" });   // 本当に消すか聞く
    if (!ok) return;
    edit(() => { work = work.filter((a) => a.date !== date || a.fixed); });
  }

  // ============================================================
  // ボタンの動き
  // ============================================================

  /** 前の週／次の週へ（その週がまだなければ作る） */
  async function moveWeek(n) {
    const weekStart = addDays(period.weekStart, 7 * n);   // 行く週の月曜
    if (weekStart > lastWeek) return;
    let next = periods.find((p) => p.weekStart === weekStart);   // その週の受付
    if (!next) {
      next = await api.ensurePeriod(weekStart);
      periods.push(next);
      periods.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
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
    const hasWork = work.some((a) => !a.fixed);                        // もう勤務が入っているか
    if (hasWork) {
      const ok = await confirmDialog({   // 作り直すか聞く
        title: "下書きを作り直しますか？",
        body: h("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、新しい下書きになります。「AIの前に戻す」で戻せます。"),
        yes: "作り直す", no: "やめる",
      });
      if (!ok) return;
    }
    const wait = busy("準備しています");                                // 待っている間の画面
    try {
      // 過去の勤務：前の週の分を「よく入っている人」の参考にする
      const prev = periods.find((p) => p.weekStart === addDays(period.weekStart, -7));
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((a) => ({ ...a }));                       // AIの前（「変わった所」を出すため）
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
      const ok = await confirmDialog({ title: "AIの設定がまだです", body: h("p", { style: { margin: 0 } }, `${aiReady().why}。AIの設定を開きますか？`), yes: "開く", no: "やめる" });   // 設定を開くか聞く
      if (ok) go("/ai");
      return;
    }
    const wait = busy("AIが直しています（30秒〜1分くらい）");   // 待っている間の画面
    try {
      const prev = periods.find((p) => p.weekStart === addDays(period.weekStart, -7));   // 前の週
      const past = prev ? await api.listAssignments(prev.id) : [];   // 前の週の勤務
      const before = work.map((a) => ({ ...a }));   // AIの前の勤務
      const r = await fixWithAi(aiContext(past), work, problems, { onStep: wait.update });   // AIが直した結果
      if (!r.applied) {
        toast(r.error ? `AIで直せませんでした：${r.error}` : `AIの案は問題が減らなかったので使いませんでした（${r.before}件 → ${r.after}件）`);
        return;
      }
      history.push(work);
      work = r.rows;
      await api.saveAiDraft(period.id, work);
      aiResult = {
        kind: "fix", before,
        result: { rows: work, source: "gemini", model: r.model, summary: r.summary, concerns: r.concerns, dropped: r.dropped, learnedCount: 0 },
      };
      await persist();
      window.scrollTo(0, 0);
      toast(`AIが直しました（守れていないルール ${r.before}件 → ${r.after}件）`);
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
      onJump: (d, id) => { date = d; selectedId = id; draw(); document.querySelector(".editor")?.scrollIntoView({ behavior: "smooth" }); },
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
    const area = (x) => (x.area === "hall" ? "ホール" : "キッチン");
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, `人が足りない時間（この週 ${list.length}件）`),
      h("ul", { class: "check-list" }, list.slice(0, 8).map((x) => h("li", { class: "is-ng" }, h("strong", null, label(x.date)), `${area(x)} ${range(x.from, x.to)} ${x.short}人`))),
      list.length > 8 ? h("div", { class: "home-muted" }, `ほか ${list.length - 8}件`) : null,
      h("button", { class: "btn btn--small", onclick: async () => {
        const r = await api.sendCalls(period.id, list);   // 連絡した結果
        toast(r.sent ? `${r.people}人に連絡しました（${r.sent}件）${r.none ? `。入れそうな人がいない所 ${r.none}件` : ""}` : r.none ? "入れそうな人がいませんでした" : "もう連絡してあります");
      } }, "入れそうな人に連絡する"),
      h("div", { class: "home-muted" }, "公開した時に足りない時間が残っていれば、自動で連絡します。返事はホームに出ます"),
    );
  }

  /** 「＋ 人を追加」：ほかの店舗の人・まだアカウントがない人（components/add-person.js） */
  async function addPerson() {
    if (locked()) { toast("公開済みです。直す時は「編集する」を押してください"); return; }
    company = await api.listCompanyMembers();
    await openAddPerson({
      company,
      shown: new Set(members.map((m) => m.id)),
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
    const prev = periods.find((p) => p.weekStart === addDays(period.weekStart, -7));   // 前の週
    if (!prev) { toast("前の週がありません"); return; }
    const ok = await confirmDialog({   // コピーするか聞く
      title: "先週と同じにしますか？",
      body: h("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、先週と同じ形になります。"),
      yes: "コピーする", no: "やめる",
    });
    if (!ok) return;
    const last = await api.listAssignments(prev.id);   // 先週の勤務
    const activeIds = new Set(active.map((m) => m.id));   // 働いている人のID
    const fixed = work.filter((a) => a.fixed);   // 固定した勤務
    const fixedKey = new Set(fixed.map((a) => `${a.memberId}|${a.date}`));   // 固定がある人と日
    const copied = last   // 1週間後にずらした勤務
      .filter((a) => activeIds.has(a.memberId) && a.storeId === period.storeId)
      .map((a) => ({ ...a, id: undefined, date: addDays(a.date, 7), fixed: false, createdBy: "copy" }))
      .filter((a) => !fixedKey.has(`${a.memberId}|${a.date}`));
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
        body: h("div", { class: "publish-problems" },
          h("ul", { class: "check-list" }, problems.map((p) => h("li", { class: "is-ng" }, h("strong", null, p.day), p.text))),
          h("p", { style: { margin: "8px 0 0", fontWeight: 700 } }, "このまま公開しますか？"),
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
