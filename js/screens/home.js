// ============================================================
// screens/home.js — ホーム（今やること）
// ------------------------------------------------------------
// 店長：受付の状態・未提出の人数・すぐ行きたい画面
// 店員：次の勤務・希望の締切・お知らせ
// ============================================================

import { h, mount, toast } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, isManager } from "../store.js";
import { go } from "../router.js";
import { screenHeader } from "../components/header.js";
import { STATUS_LABEL, weekLabel, deadlineLabel, openPeriod, workingPeriod } from "../lib/period.js";
import { label, today } from "../lib/date.js";
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
  const [periods, members] = await Promise.all([api.listPeriods(), api.listMembers()]);
  const period = workingPeriod(periods);
  const hopes = period ? await api.listAvailabilities(period.id) : [];

  // 希望を出した人（社員は出さなくても「全部入れる」なので数えない）
  const needSubmit = members.filter((m) => m.active && m.kind !== "shain");
  const submitted = new Set(hopes.map((x) => x.memberId));
  const notYet = needSubmit.filter((m) => !submitted.has(m.id));
  const specialWaiting = hopes.filter((x) => x.kind === "offx");

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
      period.status === "open"
        ? h("button", { class: "btn", onclick: async () => { await api.setPeriodStatus(period.id, "closed"); toast("受付を締め切りました"); renderHome(app); } }, "受付を締め切る")
        : null,
      period.status === "closed"
        ? h("button", { class: "btn", onclick: async () => { await api.setPeriodStatus(period.id, "open"); toast("受付を再開しました"); renderHome(app); } }, "受付を再開する")
        : null,
      h("button", { class: "btn btn--primary", onclick: () => go("/shift") }, "シフト作成へ"),
    ),
  ) : h("section", { class: "card" }, "受付中の週はありません");

  mount(app,
    screenHeader({ title: "ホーム", sub: `${state.user.name}（店長）`, right: settingsButton() }),
    h("div", { class: "screen-body" },
      statusCard,
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "店舗の設定"),
        h("div", { class: "chip-row" },
          h("button", { class: "btn", onclick: () => go("/staff") }, "店員管理"),
          h("button", { class: "btn", onclick: () => go("/map") }, "マップ・必要人数"),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------
// 店員のホーム
// ------------------------------------------------------------
async function renderStaffHome(app) {
  const [periods, mine, notes, stores] = await Promise.all([
    api.listPeriods(), api.listMyAssignments(), api.listNotifications(), api.listStores(),
  ]);
  const now = today();
  // 今日以降でいちばん早い勤務（日付 → 開始時刻 の順に並べる）
  const next = mine
    .filter((a) => a.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)[0];
  const open = openPeriod(periods);
  const storeName = (id) => stores.find((s) => s.id === id)?.name || "";

  mount(app,
    screenHeader({ title: "ホーム", sub: state.user.name, right: settingsButton() }),
    h("div", { class: "screen-body" },
      // 次の勤務
      h("section", { class: "next-shift" },
        h("div", { class: "next-shift__label" }, "次の勤務"),
        next
          ? [
              h("div", { class: "next-shift__time num" }, `${label(next.date)} コメダ ${range(next.from, next.to)}`),
              h("div", { class: "next-shift__place" }, `${storeName(next.storeId)} ・ ${next.area === "hall" ? "ホール" : "キッチン"}`),
            ]
          : h("div", { class: "next-shift__time" }, "まだ予定はありません"),
      ),
      // 希望の締切
      open
        ? h("section", { class: "card" },
            h("h2", { class: "card__title" }, `${weekLabel(open)} の希望`),
            h("div", { class: "home-muted" }, `締切：${deadlineLabel(open)}`),
            h("button", { class: "btn btn--primary", onclick: () => go("/kibou") }, "希望を入れる"),
          )
        : null,
      // お知らせ
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "お知らせ"),
        notes.length
          ? h("ul", { class: "check-list" }, notes.slice(0, 10).map((n) => h("li", { class: "is-ok" }, n.text)))
          : h("div", { class: "home-muted" }, "お知らせはありません"),
      ),
    ),
  );
}
