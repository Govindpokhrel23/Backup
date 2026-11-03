// ============================================================
// screens/home.js — ホーム（今やること）
// ------------------------------------------------------------
// 店員：①いちばん上に「希望を入れる」ボタン
//       ②その下に自分のシフト（今日 → 明日 → 明後日 の順。昨日のものは消える）
//       ③お知らせ
// 店長：店舗の切り替え（3店舗）、受付の状態（締め切る／再開する）、
//       人が足りない日と時間、自分のシフト（店長も仕事に入る）、店舗の設定
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, isManager, switchStore } from "../store.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";
import { myShifts } from "../components/my-shifts.js";
import { STATUS_LABEL, weekLabel, deadlineLabel, openPeriod, workingPeriod, datesOf } from "../lib/period.js";
import { findShortages } from "../rules/shift-rules.js";
import { label, dayType } from "../lib/date.js";
import { range } from "../lib/time.js";

export async function renderHome(app) {
  if (isManager()) return renderManagerHome(app);
  return renderStaffHome(app);
}

/** 右上の「設定」ボタン（ログアウトなど） */
function settingsButton() {
  return h("button", { class: "btn btn--small", onclick: () => go("/settings") }, "設定");
}

// ------------------------------------------------------------
// 店長のホーム
// ------------------------------------------------------------
async function renderManagerHome(app) {
  const [periods, members, mine, stores] = await Promise.all([
    api.listPeriods(), api.listMembers(), api.listMyAssignments(), api.listStores(),
  ]);
  const period = workingPeriod(periods);
  const hopes = period ? await api.listAvailabilities(period.id) : [];
  const shortCard = period ? await shortageCard(period) : null;

  // 希望を出した人（社員は出さなくても休み週1日の扱いなので数えない）
  const needSubmit = members.filter((m) => m.active && m.kind !== "shain");
  const submitted = new Set(hopes.map((x) => x.memberId));
  const notYet = needSubmit.filter((m) => !submitted.has(m.id));
  const specialWaiting = hopes.filter((x) => x.kind === "offx");

  /** 受付中 ⇔ 締切 を切り替える（まちがえて押しても、もう一度押せば戻る） */
  const toggleIntake = async () => {
    const next = period.status === "open" ? "closed" : "open";
    await api.setPeriodStatus(period.id, next);
    toast(next === "closed" ? "受付を締め切りました（もう一度押すと戻せます）" : "受付を再開しました");
    renderHome(app);
  };

  const statusCard = period ? h("section", { class: "card" },
    h("h2", { class: "card__title" }, weekLabel(period)),
    h("div", { class: "home-status" },
      h("span", { class: `badge ${period.status === "open" ? "badge--hall" : period.status === "closed" ? "badge--warn" : ""}` }, STATUS_LABEL[period.status]),
      h("span", null, `締切：${deadlineLabel(period)}`),
    ),
    h("div", null, `希望の提出：${needSubmit.length - notYet.length} / ${needSubmit.length}人`),
    notYet.length ? h("div", { class: "home-muted" }, `まだの人：${notYet.map((m) => m.name).join("、")}`) : null,
    specialWaiting.length ? h("div", { class: "notice notice--warn" }, `特別許可を待っている休みが ${specialWaiting.length}件 あります（シフト作成で確認）`) : null,
    h("div", { class: "chip-row" },
      period.status !== "published"
        ? h("button", { class: "btn", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")
        : null,
      h("button", { class: "btn btn--primary", onclick: () => go("/shift") }, "シフト作成へ"),
    ),
  ) : h("section", { class: "card" }, "受付中の週はありません");

  mount(app,
    screenHeader({ title: "ホーム", sub: `${state.user.name}（店長）`, right: settingsButton() }),
    h("div", { class: "screen-body" },
      storeSwitcher(app),
      statusCard,
      shortCard,
      // 店長も仕事に入るので、自分のシフトも出す
      myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, limit: 5 }),
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "店舗の設定"),
        h("div", { class: "chip-row" },
          h("button", { class: "btn", onclick: () => go("/staff") }, "店員管理"),
          h("button", { class: "btn", onclick: () => go("/map") }, "マップ・必要人数・営業時間"),
        ),
      ),
    ),
  );
}

/**
 * 店舗の切り替え（3店舗）
 * 押すと、シフト作成・マップ・店員管理など全部の画面がその店舗になる
 */
function storeSwitcher(app) {
  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, "見ている店舗"),
    h("div", { class: "store-switch" },
      state.stores.map((st) => h("button", {
        class: "chip store-switch__btn",
        "aria-pressed": String(st.id === state.storeId),
        onclick: async () => {
          if (st.id === state.storeId) return;
          await switchStore(st.id);
          toast(`${st.name} に切り替えました`);
          renderHome(app);
        },
      }, st.name))),
  );
}

/**
 * 人が足りない日と時間（作っている週）
 * 例：「11/9（月） ホール 16:00〜17:00 1人足りない」
 */
async function shortageCard(period) {
  const [work, positions, requirements, storeHours, holidays] = await Promise.all([
    api.listAssignments(period.id), api.listPositions(), api.listRequirements(), api.getStoreHours(), api.listHolidays(),
  ]);
  const title = h("h2", { class: "card__title" }, `人が足りない時間（${weekLabel(period)}）`);
  if (!work.length) {
    return h("section", { class: "card" }, title, h("div", { class: "home-muted" }, "まだこの週のシフトを作っていません"));
  }
  const rows = [];
  for (const d of datesOf(period)) {
    const type = dayType(d, holidays);
    const list = findShortages(work.filter((a) => a.date === d), requirements, positions, type, storeHours[type]);
    for (const s of list) {
      rows.push(h("li", { class: "is-ng" },
        h("strong", null, label(d)),
        `${s.area === "hall" ? "ホール" : "キッチン"} ${range(s.from, s.to)} ${s.short}人足りない`));
    }
  }
  return h("section", { class: "card" }, title,
    rows.length
      ? h("ul", { class: "check-list" }, rows)
      : h("div", { class: "notice notice--ok" }, "足りない時間はありません"));
}

// ------------------------------------------------------------
// 店員のホーム
// ------------------------------------------------------------
async function renderStaffHome(app) {
  const [periods, mine, notes, stores] = await Promise.all([
    api.listPeriods(), api.listMyAssignments(), api.listNotifications(), api.listStores(),
  ]);
  const open = openPeriod(periods);

  mount(app,
    screenHeader({ title: "ホーム", sub: state.user.name, right: settingsButton() }),
    h("div", { class: "screen-body" },
      // ① いちばん上：希望を入れるボタン（2か月先まで入れられる）
      h("button", { class: "btn btn--primary btn--block home-kibou", onclick: () => go("/kibou") },
        h("span", null, "希望を入れる"),
        h("span", { class: "home-kibou__sub" },
          open ? `${weekLabel(open)} の締切 ${deadlineLabel(open)} ・ 2か月先まで入れられます` : "2か月先まで入れられます")),
      // ② 自分のシフト（今日 → 明日 → 明後日）
      myShifts({ assignments: mine, stores, myStoreId: state.user.storeId }),
      // ③ お知らせ
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "お知らせ"),
        notes.length
          ? h("ul", { class: "check-list" }, notes.slice(0, 10).map((n) => h("li", { class: "is-ok" }, n.text)))
          : h("div", { class: "home-muted" }, "お知らせはありません"),
      ),
    ),
  );
}
