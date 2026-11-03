// ============================================================
// screens/shift-editor.js — シフト作成（店長）
// ------------------------------------------------------------
// この画面でできること：
//   ・週と日を選んで、紙と同じ形のシフト表を見る（希望は薄い緑）
//   ・線をドラッグして時間を変える／右の欄で細かく直す
//   ・「AIで作成」で下書き、「前週コピー」で先週と同じにする
//   ・ルールのチェックを常に表示（赤＝守れていない）
//   ・「公開する」：守れていなければ⚠️警告 →「はい」でそのまま公開
//   ・店長は何でも自由に直せる（2026年11月3日）：
//       時間は 5:00〜翌2:00、1日に2つの勤務（中抜け）、別の人に移す、
//       日のコピー・全部消す、連絡事項、「元に戻す」「やり直す」
// 変えた内容はすぐ下書きとして保存する（閉じても消えない）。
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { CONFIG } from "../config.js";
import { screenHeader } from "../components/header.js";
import { timeline } from "../components/timeline.js";
import { checkDay, checkWeek, onlyProblems, requiredAt, assignedAt } from "../rules/shift-rules.js";
import { makeDraft } from "../ai/simple-draft.js";
import { STATUS_LABEL, weekLabel, datesOf, workingPeriod } from "../lib/period.js";
import { label, dayType, addDays } from "../lib/date.js";
import { range, EDIT_MIN, EDIT_MAX } from "../lib/time.js";
import { createHistory } from "../lib/history.js";
import { assignmentPanel } from "../components/assignment-panel.js";

export async function renderShiftEditor(app) {
  // ---------- 最初に全部読む ----------
  const [periods, members, positions, requirements, holidays, rules, storeHours] = await Promise.all([
    api.listPeriods(), api.listMembers(), api.listPositions(), api.listRequirements(),
    api.listHolidays(), api.listMemberRules(), api.getStoreHours(),
  ]);
  const active = members.filter((m) => m.active);
  const ruleOf = (id) => rules.find((r) => r.memberId === id)?.text || "なし";
  const dayTypeOf = (d) => dayType(d, holidays);
  const hoursOf = (d) => storeHours[dayTypeOf(d)];          // その日の営業時間（マップ画面で店長が決める）

  // ---------- 画面の中で持つ状態 ----------
  let period = workingPeriod(periods);
  let work = [];           // この週の勤務（下書き・公開済み）
  let hopes = [];          // この週の希望
  let date = null;         // 表示している日
  let selectedId = null;   // 右の欄で見ている店員
  const history = createHistory();   // 「元に戻す」用

  if (!period) {
    mount(app, screenHeader({ title: "シフト作成" }), h("div", { class: "screen-body" }, h("div", { class: "card" }, "週がありません")));
    return;
  }
  await loadPeriod();
  draw();

  // ============================================================
  // データの読み込みと保存
  // ============================================================

  async function loadPeriod() {
    [work, hopes] = await Promise.all([api.listAssignments(period.id), api.listAvailabilities(period.id)]);
    if (!date || !datesOf(period).includes(date)) date = period.weekStart;
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
    history.push(work);
    fn();
    persist();
  }

  /** 元に戻す／やり直す */
  function undo() { const w = history.undo(work); if (w) { work = w; persist(); } }
  function redo() { const w = history.redo(work); if (w) { work = w; persist(); } }

  /**
   * その日の表の左端と右端
   * 営業時間をもとに、それより外の勤務があれば広げる（1時間単位）
   */
  function dayRange(d) {
    const hrs = hoursOf(d);
    const day = work.filter((a) => a.date === d);
    const start = Math.min(hrs.open, ...day.map((a) => a.from));
    const end = Math.max(hrs.close, ...day.map((a) => a.to));
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }

  // ============================================================
  // チェック
  // ============================================================

  /** ある日のチェック結果 */
  function dayChecks(d) {
    return checkDay({
      date: d,
      dayType: dayTypeOf(d),
      hours: hoursOf(d),
      assignments: work.filter((a) => a.date === d),
      members, requirements, positions,
      availabilities: hopes.filter((x) => x.date === d),
    });
  }

  /** 週全体のチェック結果 */
  function weekChecks() {
    return checkWeek({ dates: datesOf(period), assignments: work, members: active, availabilities: hopes });
  }

  /** 守れていないもの全部（公開の確認で使う） */
  function allProblems() {
    const list = [];
    for (const d of datesOf(period)) onlyProblems(dayChecks(d)).forEach((x) => list.push({ day: label(d), text: x.text }));
    onlyProblems(weekChecks()).forEach((x) => list.push({ day: "週全体", text: x.text }));
    return list;
  }

  // ============================================================
  // 描く
  // ============================================================

  function draw() {
    const today = work.filter((a) => a.date === date);
    const checks = [...dayChecks(date), ...weekChecks()];

    mount(app,
      screenHeader({
        title: "シフト作成",
        sub: `${weekLabel(period)} ・ ${STATUS_LABEL[period.status]} ・ この日の営業 ${range(hoursOf(date).open, hoursOf(date).close)}`,
        right: h("select", { class: "select", style: { width: "auto" }, "aria-label": "週を選ぶ", onchange: changeWeek },
          periods.map((p) => h("option", { value: p.id, selected: p.id === period.id }, `${weekLabel(p)}（${STATUS_LABEL[p.status]}）`))),
        extra: h("div", { class: "chip-row" },
          // 受付の切り替え：まちがえて締め切っても、もう一度押せば受付中に戻る
          period.status !== "published"
            ? h("button", { class: "btn btn--small", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")
            : null,
          h("button", { class: "btn btn--small", onclick: undo, disabled: !history.canUndo(), "aria-label": "元に戻す" }, "↶ 元に戻す"),
          h("button", { class: "btn btn--small", onclick: redo, disabled: !history.canRedo(), "aria-label": "やり直す" }, "↷ やり直す"),
          h("button", { class: "btn btn--small btn--blue", onclick: runDraft }, "AIで作成"),
          h("button", { class: "btn btn--small", onclick: copyLastWeek }, "前週コピー"),
          h("button", { class: "btn btn--small btn--primary", onclick: publish }, period.status === "published" ? "変更を公開" : "公開する"),
        ),
      }),
      h("div", { class: "screen-body" },
        dayTabs(),
        h("div", { class: "editor" },
          h("section", { class: "card editor__table" },
            timeline({
              ...dayRange(date),
              hours: hoursOf(date),
              members: active,
              assignments: today,
              availabilities: hopes.filter((x) => x.date === date),   // 希望は店長だけに見せる
              needs: needRows(today),
              selectedId,
              editable: true,
              onSelect: (id) => { selectedId = id; draw(); },
              onChange: (a, change) => { selectedId = a.memberId; edit(() => Object.assign(a, change)); },
            }),
            legend(),
          ),
          h("div", { class: "editor__side" },
            selectedId ? memberPanel(selectedId) : h("section", { class: "card home-muted" }, "名前か線を押すと、ここで細かく直せます"),
            dayTools(),
            h("section", { class: "card" },
              h("h2", { class: "card__title" }, `ルールのチェック（${label(date)}）`),
              h("ul", { class: "check-list" },
                checks.map((c) => h("li", { class: c.ok ? "is-ok" : "is-ng" }, h("strong", null, c.ok ? "✓" : "!"), c.text))),
            ),
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
        const bad = onlyProblems(dayChecks(d)).length > 0;
        return h("button", { class: "chip day-tab", "aria-pressed": String(d === date), onclick: () => { date = d; draw(); } },
          label(d), bad ? h("span", { class: "day-tab__dot", "aria-label": "守れていないルールあり" }) : null);
      }));
  }

  /** 1時間ごとの「必要／入っている」 */
  function needRows(dayAssignments) {
    const type = dayTypeOf(date);
    const make = (area, labelText, color) => {
      const slots = [];
      const { start, end } = dayRange(date);
      for (let m = start; m < end; m += 60) {
        // その1時間でいちばん足りない時を出す（15分ごとに見る）
        let need = 0, have = 0, worst = -Infinity;
        for (let q = m; q < m + 60; q += 15) {
          const n = requiredAt(requirements, positions, type, area, q);
          const hv = assignedAt(dayAssignments, area, q);
          if (n - hv > worst) { worst = n - hv; need = n; have = hv; }
        }
        slots.push({ need, have });
      }
      return { label: labelText, color, slots };
    };
    return [make("hall", "ホール 人数", "var(--hall)"), make("kitchen", "キッチン 人数", "var(--kitchen)")];
  }

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
    const m = members.find((x) => x.id === id);
    const hope = hopes.find((x) => x.memberId === id && x.date === date);
    return assignmentPanel({
      member: m,
      date,
      assignments: work.filter((x) => x.memberId === id && x.date === date).sort((a, b) => a.from - b.from),
      hope,
      rule: ruleOf(id),
      others: active.filter((x) => x.id !== id),
      onEdit: (fn) => edit(fn),
      onRemove: (a) => edit(() => { work = work.filter((x) => x !== a); }),
      onAdd: () => edit(() => {
        // 希望があればその時間、もう勤務があればその後ろ、なければ 9:00〜15:00
        const mine = work.filter((x) => x.memberId === id && x.date === date);
        let from = 9 * 60, to = 15 * 60;
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
    const target = h("select", { class: "select", "aria-label": "コピー先の日" },
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

  /** 連絡事項（紙の右下の欄と同じ。公開シフトでみんなが見られる） */
  function noteCard() {
    return h("section", { class: "card" },
      h("h2", { class: "card__title" }, "連絡事項（この週）"),
      h("textarea", {
        class: "textarea",
        placeholder: "例：11/12 研修あり、11/14 お祭りで混みます",
        onchange: async (e) => { period.note = e.target.value; await api.savePeriodNote(period.id, period.note); toast("連絡事項を保存しました"); },
      }, period.note || ""),
    );
  }

  /** この日をほかの日にコピー（コピー先の固定した勤務は残す） */
  function copyDay(to) {
    edit(() => {
      const keep = work.filter((a) => a.date !== to || a.fixed);
      const fixedThere = new Set(keep.filter((a) => a.date === to).map((a) => a.memberId));
      const copied = work
        .filter((a) => a.date === date && !fixedThere.has(a.memberId))
        .map((a) => ({ ...a, id: undefined, date: to, fixed: false, createdBy: "copy" }));
      work = [...keep, ...copied];
    });
    toast(`${label(to)} にコピーしました`);
  }

  /** この日の勤務を全部消す（固定は残す） */
  async function clearDay() {
    const ok = await confirmDialog({ title: `${label(date)} の勤務を全部消しますか？`, body: h("p", { style: { margin: 0 } }, "固定した勤務は残ります。「元に戻す」で戻せます。"), yes: "消す", no: "やめる" });
    if (!ok) return;
    edit(() => { work = work.filter((a) => a.date !== date || a.fixed); });
  }

  // ============================================================
  // ボタンの動き
  // ============================================================

  async function changeWeek(e) {
    period = periods.find((p) => p.id === e.target.value);
    date = null;
    selectedId = null;
    history.clear();
    await loadPeriod();
    draw();
  }

  /** 受付中 ⇔ 締切 を切り替える */
  async function toggleIntake() {
    const next = period.status === "open" ? "closed" : "open";
    await api.setPeriodStatus(period.id, next);
    period.status = next;
    toast(next === "closed" ? "受付を締め切りました（もう一度押すと戻せます）" : "受付を再開しました");
    draw();
  }

  /** AIで作成（今は簡易版。固定した勤務は残す） */
  async function runDraft() {
    const hasWork = work.some((a) => !a.fixed);
    if (hasWork) {
      const ok = await confirmDialog({
        title: "下書きを作り直しますか？",
        body: h("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、新しい下書きになります。"),
        yes: "作り直す", no: "やめる",
      });
      if (!ok) return;
    }
    // 過去の勤務：前の週の分を「よく入っている人」の参考にする
    const prev = periods.find((p) => p.weekStart === addDays(period.weekStart, -7));
    const past = prev ? await api.listAssignments(prev.id) : [];
    history.push(work);
    work = makeDraft({
      dates: datesOf(period), members, availabilities: hopes, requirements, positions,
      fixed: work.filter((a) => a.fixed), past, dayTypeOf, hoursOf,
    });
    await persist();
    toast("下書きを作りました（簡易版）。赤い所を直してください");
  }

  /** 前週コピー */
  async function copyLastWeek() {
    const prev = periods.find((p) => p.weekStart === addDays(period.weekStart, -7));
    if (!prev) { toast("前の週がありません"); return; }
    const ok = await confirmDialog({
      title: "先週と同じにしますか？",
      body: h("p", { style: { margin: 0 } }, "今の勤務（固定したもの以外）は消えて、先週と同じ形になります。"),
      yes: "コピーする", no: "やめる",
    });
    if (!ok) return;
    const last = await api.listAssignments(prev.id);
    const activeIds = new Set(active.map((m) => m.id));
    const fixed = work.filter((a) => a.fixed);
    const fixedKey = new Set(fixed.map((a) => `${a.memberId}|${a.date}`));
    const copied = last
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
    const problems = allProblems();
    if (problems.length) {
      const yes = await confirmDialog({
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
    period.status = "published";
    toast(problems.length ? "警告があるまま公開しました。全員に知らせます" : "公開しました。全員に知らせます");
    draw();
  }
}
