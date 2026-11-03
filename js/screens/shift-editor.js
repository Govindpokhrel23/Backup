// ============================================================
// screens/shift-editor.js — シフト作成（店長）
// ------------------------------------------------------------
// この画面でできること：
//   ・週と日を選んで、紙と同じ形のシフト表を見る（希望は薄い緑）
//   ・線をドラッグして時間を変える／右の欄で細かく直す
//   ・「AIで作成」で下書き、「前週コピー」で先週と同じにする
//   ・ルールのチェックを常に表示（赤＝守れていない）
//   ・「公開する」：守れていなければ⚠️警告 →「はい」でそのまま公開
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
import { range, snap, timeOptions } from "../lib/time.js";

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
          period.status === "open"
            ? h("button", { class: "btn btn--small", onclick: closeIntake }, "受付を締め切る")
            : null,
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
              members: active,
              assignments: today,
              availabilities: hopes.filter((x) => x.date === date),   // 希望は店長だけに見せる
              needs: needRows(today),
              selectedId,
              editable: true,
              onSelect: (id) => { selectedId = id; draw(); },
              onChange: (a, change) => { Object.assign(a, change); selectedId = a.memberId; persist(); },
            }),
            legend(),
          ),
          h("div", { class: "editor__side" },
            selectedId ? memberPanel(selectedId) : h("section", { class: "card home-muted" }, "名前か線を押すと、ここで細かく直せます"),
            h("section", { class: "card" },
              h("h2", { class: "card__title" }, `ルールのチェック（${label(date)}）`),
              h("ul", { class: "check-list" },
                checks.map((c) => h("li", { class: c.ok ? "is-ok" : "is-ng" }, h("strong", null, c.ok ? "✓" : "!"), c.text))),
            ),
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
      for (let m = CONFIG.DAY_START; m < CONFIG.DAY_END; m += 60) {
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

  /** 右の欄：選んだ店員のくわしい内容と直す道具 */
  function memberPanel(id) {
    const m = members.find((x) => x.id === id);
    const a = work.find((x) => x.memberId === id && x.date === date);
    const hope = hopes.find((x) => x.memberId === id && x.date === date);
    const hopeText = !hope
      ? (m.kind === "shain" ? "出していない（全部入れる）" : "出していない")
      : { no: "入れない", any: "いつでもOK", off: "休み希望", offx: "休み希望（特別許可の申請中）", time: range(hope.from ?? 0, hope.to ?? 0) }[hope.kind];

    const skills = CONFIG.SKILLS.map((s) => `${s.label}${m.skills[s.key]}`).join("・");

    const timeSelect = (value, onPick, aria) => h("select", { class: "select num", "aria-label": aria, onchange: (e) => onPick(Number(e.target.value)) },
      timeOptions(CONFIG.DAY_START, CONFIG.DAY_END).map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));

    return h("section", { class: "card" },
      h("div", { class: "screen-header__row" },
        h("h2", { class: "card__title", style: { fontSize: "19px" } }, m.name),
        h("span", { class: "badge" }, CONFIG.KIND_LABEL[m.kind]),
      ),
      h("div", { class: "home-muted" }, `できること：${skills}`),
      h("div", { class: "rule-memo" }, `店長メモ：${ruleOf(id)}`),
      h("div", null, `希望：${hopeText}`),
      hope?.kind === "offx"
        ? h("button", { class: "btn btn--small", onclick: async () => { await api.approveSpecialOff(period.id, id, date); hopes = await api.listAvailabilities(period.id); toast("特別許可を出しました"); draw(); } }, "特別許可を出す（休みにする）")
        : null,

      a
        ? [
            h("div", { class: "time-range" },
              timeSelect(a.from, (v) => { a.from = v; persist(); }, "開始"),
              "〜",
              timeSelect(a.to, (v) => { a.to = v; persist(); }, "終了"),
            ),
            h("div", { class: "chip-row" },
              h("button", { class: "chip chip--hall", "aria-pressed": String(a.area === "hall"), onclick: () => { a.area = "hall"; persist(); } }, "ホール"),
              h("button", { class: "chip chip--kitchen", "aria-pressed": String(a.area === "kitchen"), onclick: () => { a.area = "kitchen"; persist(); } }, "キッチン"),
              h("button", { class: "chip", "aria-pressed": String(a.breakAt != null), onclick: () => { a.breakAt = a.breakAt != null ? null : snap((a.from + a.to) / 2); persist(); } }, "休憩 ○"),
              h("button", { class: "chip", "aria-pressed": String(!!a.fixed), onclick: () => { a.fixed = !a.fixed; persist(); } }, "固定"),
            ),
            a.breakAt != null ? h("label", { class: "field" }, "休憩の目安", timeSelect(a.breakAt, (v) => { a.breakAt = v; persist(); }, "休憩")) : null,
            h("button", { class: "btn btn--small btn--danger", onclick: () => { work = work.filter((x) => x !== a); persist(); } }, "この日の勤務を消す"),
          ]
        : h("button", {
            class: "btn btn--dashed",
            onclick: () => {
              // 希望があればその時間で、なければ 9:00〜15:00 で入れる
              const from = hope?.kind === "time" ? hope.from : 9 * 60;
              const to = hope?.kind === "time" ? hope.to : 15 * 60;
              work.push({ memberId: id, date, from, to, area: m.skills.kitchen > m.skills.hall ? "kitchen" : "hall", breakAt: null, fixed: false, createdBy: "manager", requested: false });
              persist();
            },
          }, hope?.kind === "time" ? `＋ 希望の時間（${range(hope.from, hope.to)}）で入れる` : "＋ 勤務を追加"),
    );
  }

  // ============================================================
  // ボタンの動き
  // ============================================================

  async function changeWeek(e) {
    period = periods.find((p) => p.id === e.target.value);
    date = null;
    selectedId = null;
    await loadPeriod();
    draw();
  }

  async function closeIntake() {
    await api.setPeriodStatus(period.id, "closed");
    period.status = "closed";
    toast("受付を締め切りました");
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
