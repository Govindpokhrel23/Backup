// ============================================================
// screens/home.js — ホーム（今やること）
// ------------------------------------------------------------
// 店員：①いちばん上に「希望を入れる」ボタン
//       ②その下に自分のシフト（今日 → 明日 → 明後日 の順。昨日のものは消える）
//       ③お知らせ
//       ほかの人の「交代のお願い」に「代わります」
// 店長：店舗の切り替え（3店舗）、受付の状態（締め切る／再開する・未提出の人に催促）、
//       交代の承認、公開シフトを確認していない人、
//       人が足りない日と時間、自分のシフト（店長も仕事に入る）、店舗の設定
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, isManager, switchStore, activeStores } from "../store.js";
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
  const swaps = await api.listSwaps();
  // 公開済みでいちばん新しい週の「確認しました」
  const published = periods.filter((p) => p.status === "published").pop();
  const confirms = published ? await api.listConfirms(published.id) : [];

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
    // 希望をまだ出していない人に、まとめて催促を送る
    notYet.length && period.status === "open"
      ? h("button", { class: "btn btn--small", onclick: async () => {
          const n = await api.remindHopes(notYet.map((m) => m.id), `${weekLabel(period)} の希望がまだです。締切は ${deadlineLabel(period)} です`);
          toast(`${n}人に催促を送りました`);
        } }, `まだの人に催促を送る（${notYet.length}人）`)
      : null,
    specialWaiting.length ? h("div", { class: "notice notice--warn" }, `特別許可を待っている休みが ${specialWaiting.length}件 あります（シフト作成で確認）`) : null,
    h("div", { class: "chip-row" },
      period.status !== "published"
        ? h("button", { class: "btn", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")
        : null,
      h("button", { class: "btn btn--primary", onclick: () => go("/shift") }, "シフト作成へ"),
    ),
  ) : h("section", { class: "card" }, "まだ週がありません。「シフト作成」を開くと、来週の受付が始まります");

  mount(app,
    screenHeader({ title: "ホーム", sub: `${state.user.name}（店長）`, right: settingsButton() }),
    h("div", { class: "screen-body" },
      storeSwitcher(app),
      statusCard,
      swapApprovalCard(app, swaps),
      shortCard,
      published ? confirmCard(published, members, confirms) : null,
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
    h("div", { class: "screen-header__row" },
      h("h2", { class: "card__title" }, "見ている店舗"),
      h("button", { class: "btn btn--small", onclick: () => go("/stores") }, "店舗の追加・名前変更")),
    h("div", { class: "store-switch" },
      activeStores().map((st) => h("button", {
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
 * 交代の承認（7shifts の「シフトプール」の承認と同じ考え方）
 * 代わる人が決まったものを、店長が「承認／見送り」する
 */
function swapApprovalCard(app, swaps) {
  const waiting = swaps.filter((x) => x.status === "taken");
  const open = swaps.filter((x) => x.status === "open");
  if (!waiting.length && !open.length) return null;
  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, "シフト交代"),
    waiting.map((x) => h("div", { class: "swap-row" },
      h("div", null,
        h("strong", null, `${label(x.date)} ${range(x.from, x.to)}`),
        h("div", { class: "home-muted" }, `${x.fromName} → ${x.takerName}（承認待ち）${x.note ? `　理由：${x.note}` : ""}`)),
      h("div", { class: "chip-row" },
        h("button", { class: "btn btn--small btn--primary", onclick: async () => { await api.decideSwap(x.id, true); toast("承認しました。シフトを入れ替えました"); renderHome(app); } }, "承認"),
        h("button", { class: "btn btn--small", onclick: async () => { await api.decideSwap(x.id, false); toast("見送りました"); renderHome(app); } }, "見送り"),
      ))),
    open.length ? h("div", { class: "home-muted" }, `代わる人をさがし中：${open.map((x) => `${label(x.date)} ${x.fromName}`).join("、")}`) : null,
  );
}

/** 公開したシフトを「確認しました」と押していない人 */
function confirmCard(period, members, confirms) {
  const seen = new Set(confirms.map((c) => c.memberId));
  const people = members.filter((m) => m.active && (m.rankHere ?? 1) === 1 && m.role !== "manager");
  const notSeen = people.filter((m) => !seen.has(m.id));
  return h("section", { class: "card" },
    h("h2", { class: "card__title" }, `公開シフトの確認（${weekLabel(period)}）`),
    h("div", null, `確認した人：${people.length - notSeen.length} / ${people.length}人`),
    notSeen.length
      ? h("div", { class: "home-muted" }, `まだ見ていない人：${notSeen.map((m) => m.name).join("、")}`)
      : h("div", { class: "notice notice--ok" }, "全員が確認しました"),
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
  const [periods, mine, notes, stores, swaps] = await Promise.all([
    api.listPeriods(), api.listMyAssignments(), api.listNotifications(), api.listStores(), api.listSwaps(),
  ]);
  const open = openPeriod(periods);
  const mySwaps = swaps.filter((x) => x.fromMemberId === state.user.id);
  const othersOpen = swaps.filter((x) => x.status === "open" && x.fromMemberId !== state.user.id);

  /** 「交代をお願いする」：理由を聞いてからお願いを出す */
  const askSwap = async (a) => {
    const note = h("textarea", { class: "textarea", placeholder: "理由（なくてもOK）例：学校の用事" });
    const ok = await confirmDialog({
      title: `${label(a.date)} ${range(a.from, a.to)} の交代をお願いしますか？`,
      body: h("div", null, h("p", { style: { margin: "0 0 8px" } }, "行ける人に知らせます。代わる人が決まったら、店長が承認して入れ替わります。"), note),
      yes: "お願いする", no: "やめる",
    });
    if (!ok) return;
    try { await api.offerShift(a.id, note.value.trim()); toast("交代のお願いを出しました"); }
    catch (e) { toast(e.message); }
    renderHome(app);
  };

  mount(app,
    screenHeader({ title: "ホーム", sub: state.user.name, right: settingsButton() }),
    h("div", { class: "screen-body" },
      // ① いちばん上：希望を入れるボタン（2か月先まで入れられる）
      h("button", { class: "btn btn--primary btn--block home-kibou", onclick: () => go("/kibou") },
        h("span", null, "希望を入れる"),
        h("span", { class: "home-kibou__sub" },
          open ? `${weekLabel(open)} の締切 ${deadlineLabel(open)} ・ 2か月先まで入れられます` : "2か月先まで入れられます")),
      // ② 自分のシフト（今日 → 明日 → 明後日）
      myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, swaps: mySwaps, onSwap: askSwap }),
      // ほかの人の「交代のお願い」（自分が行ける店舗の分）
      othersOpen.length
        ? h("section", { class: "card" },
            h("h2", { class: "card__title" }, "交代のお願い（代われる人をさがしています）"),
            othersOpen.map((x) => h("div", { class: "swap-row" },
              h("div", null,
                h("strong", null, `${label(x.date)} ${range(x.from, x.to)}`),
                h("div", { class: "home-muted" }, `${x.storeShort} ・ ${x.area === "hall" ? "ホール" : "キッチン"} ・ ${x.fromName}さん${x.note ? `　理由：${x.note}` : ""}`)),
              h("button", { class: "btn btn--small btn--primary", onclick: async () => {
                try { await api.takeSwap(x.id); toast("「代わります」を送りました。店長の承認を待ってください"); }
                catch (e) { toast(e.message); }
                renderHome(app);
              } }, "代わります"))))
        : null,
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
