// ============================================================
// screens/home.js — ホーム（今やること）
// ------------------------------------------------------------
// このファイルは、ホーム（今やること）のファイルです。
// 店員：①いちばん上に「希望を入れる」ボタン
//       ②その下に自分のシフト（今日 → 明日 → 明後日 の順。昨日のものは消える）
//       ③お知らせ
// 店長：店舗の切り替え（3店舗）、受付の状態（締め切る／再開する・未提出の人に催促）、
//       公開シフトを確認していない人、
//       人が足りない日と時間、自分のシフト（店長も仕事に入る）
//       （店舗の設定は「店舗」タブにまとめた。2026年11月15日）
// 2026年11月17日：見やすく（店長）いちばん上に「今日のまとめ」（今日の人数・未提出・未公開・足りない時間・お知らせ）
//                       店舗の切りかえは細い1行に。お知らせのカードを足した
//                 （店員）自分のシフトは3件まで。残りは「カレンダーで見る」
// 2026年11月15日：シフト交代の機能はなくした（店長と本人で直接話して、店長がシフト作成で直す）
// 2026年11月5日：人が足りない時の自動連絡
//   店長 → 「入れます」と返事した人を見て「この人に入ってもらう」
//   店員 → 届いた募集に「入れます」
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, isManager, switchStore, activeStores } from "../store.js";   // アプリの状態・店舗の道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { myShifts } from "../components/my-shifts.js";   // 自分のシフトの部品を読む
import { STATUS_LABEL, weekLabel, deadlineLabel, openPeriod, pendingPeriod, datesOf } from "../lib/period.js";   // 週の表示の道具を読む
import { findShortages } from "../rules/shift-rules.js";   // 足りない時間を出す道具を読む
import { label, dayType, today } from "../lib/date.js";   // 日付の道具を読む
import { range } from "../lib/time.js";   // 時間の表示の道具を読む
import { hoursOn } from "../lib/store-hours.js";   // その日の営業時間（休み・時間の変更も入れる）の道具を読む

/** ホームの画面を描く（店長と店員で中身が変わる） */
export async function renderHome(app) {   // ホームを描く関数
  if (isManager()) return renderManagerHome(app);   // 店長なら店長のホーム
  return renderStaffHome(app);   // 店員なら店員のホーム
}

/** 右上の「設定」ボタン（ログアウトなど） */
function settingsButton() {   // 設定ボタンを作る関数
  return createElement("button", { class: "btn btn--small", onclick: () => go("/settings") }, "設定");   // 押すと設定へ
}

// ------------------------------------------------------------
// 店長のホーム
// ------------------------------------------------------------
async function renderManagerHome(app) {   // 店長のホームを描く関数
  const [periods, members, mine, stores] = await Promise.all([   // 週の一覧・店員・自分の勤務・店舗
    api.listPeriods(), api.listMembers(), api.listMyAssignments(), api.listStores(),   // 週・店員・自分の勤務・店舗を同時に読む
  ]);
  const period = pendingPeriod(periods);   // まだシフトができていない週（過ぎた週は出さない。2026年11月17日）
  const hopes = period ? await api.listAvailabilities(period.id) : [];   // その週の希望
  const short = period ? await shortageCard(period) : null;   // 人が足りない時間のカードと件数
  const shortCard = short?.card || null;   // 人が足りない時間のカード
  const calls = await api.listCalls();                     // 人が足りない時の募集（さがし中）
  const notes = await api.listNotifications().catch(() => []);   // 店長あてのお知らせ（2026年11月17日）
  // 今日の勤務の人数（今日が入っている週の、この店舗の勤務）
  const todayPeriod = periods.find((eachPeriod) => datesOf(eachPeriod).includes(today()));   // 今日が入っている週
  const todayWork = todayPeriod ? (await api.listAssignments(todayPeriod.id)).filter((shift) => shift.date === today()) : [];   // 今日の勤務
  const todayCount = new Set(todayWork.map((shift) => shift.memberId)).size;   // 今日入る人の数
  // 公開済みでいちばん新しい週の「確認しました」
  const published = periods.filter((period) => period.status === "published").pop();   // 一番新しい公開した週
  const confirms = published ? await api.listConfirms(published.id) : [];   // 「確認しました」の一覧

  // 希望を出した人（社員は出さなくても休み週1日の扱いなので数えない）
  const needSubmit = members.filter((member) => member.active && member.kind !== "shain");   // 希望を出す人（バイト）
  const submitted = new Set(hopes.map((hope) => hope.memberId));   // 希望を出した人のID
  const notYet = needSubmit.filter((member) => !submitted.has(member.id));   // まだ希望を出していない人
  const specialWaiting = hopes.filter((hope) => hope.kind === "offx");   // 特別許可を待っている休み希望

  /** 受付中 ⇔ 締切 を切り替える（まちがえて押しても、もう一度押せば戻る） */
  const toggleIntake = async () => {   // 受付を締め切る・再開する関数
    const next = period.status === "open" ? "closed" : "open";   // 次の状態
    await api.setPeriodStatus(period.id, next);   // 状態を変える
    toast(next === "closed" ? "受付を締め切りました（もう一度押すと戻せます）" : "受付を再開しました");   // お知らせ
    renderHome(app);   // 描きなおす
  };

  const statusCard = period ? createElement("section", { class: "card", id: "home-status" },   // 受付の状態のカード（まとめから飛べるように id）
    createElement("h2", { class: "card__title" }, weekLabel(period)),   // 週の日付
    createElement("div", { class: "home-status" },   // 状態の行
      createElement("span", { class: `badge ${period.status === "open" ? "badge--hall" : period.status === "closed" ? "badge--warn" : ""}` }, STATUS_LABEL[period.status]),   // 受付中・作成中・公開済みの印
      createElement("span", null, `締切：${deadlineLabel(period)}`),   // 締切
    ),
    createElement("div", null, `希望の提出：${needSubmit.length - notYet.length} / ${needSubmit.length}人`),   // 希望を出した人数
    // 「まだの人」の名前の一覧は出さない（人数だけ。2026年11月17日）
    // 希望をまだ出していない人に、まとめて催促を送る
    notYet.length && period.status === "open"   // まだの人がいて受付中なら
      ? createElement("button", { class: "btn btn--small", onclick: async () => {   // 催促ボタン
          const count = await api.remindHopes(notYet.map((member) => member.id), `${weekLabel(period)} の希望がまだです。締切は ${deadlineLabel(period)} です`);   // 催促を送った人数
          toast(`${count}人に催促を送りました`);   // お知らせ
        } }, `まだの人に催促を送る（${notYet.length}人）`)   // ボタンの文字
      : null,   // なければ出さない
    specialWaiting.length ? createElement("div", { class: "notice notice--warn" }, `特別許可を待っている休みが ${specialWaiting.length}件 あります（シフト作成で確認）`) : null,   // 特別許可待ちの知らせ
    createElement("div", { class: "chip-row" },   // ボタンの行
      period.status !== "published"   // 公開前なら
        ? createElement("button", { class: "btn", onclick: toggleIntake }, period.status === "open" ? "受付を締め切る" : "受付を再開する")   // 受付を締め切る・再開
        : null,   // 公開後は出さない
      createElement("button", { class: "btn btn--primary", onclick: () => go("/shift") }, "シフト作成へ"),   // シフト作成へ
    ),
  ) : createElement("section", { class: "card", id: "home-status" },   // できていない週がない時
    createElement("div", { class: "notice notice--ok" }, "これからの週は、全部公開しました"),   // 全部できている
    createElement("button", { class: "btn btn--primary", onclick: () => go("/shift") }, "シフト作成へ（次の週を始める）"));   // 次の週へ

  mount(app,   // 画面に入れる
    screenHeader({ title: "ホーム", sub: `${state.user.name}（店長）`, right: settingsButton() }),   // 見出し
    createElement("div", { class: "screen-body" },   // 本文
      storeSwitcher(app),   // 店舗の切りかえ（細い1行）
      summaryCard({   // 今日のまとめ（大事なものをいちばん上に。2026年11月17日）
        todayCount: todayPeriod?.status === "published" ? todayCount : null,   // 今日の人数（公開した週だけ）
        notYet: period ? notYet.length : 0,   // 希望の未提出
        need: period ? needSubmit.length : 0,   // 希望を出す人の数
        unsettled: period && period.status !== "published" ? STATUS_LABEL[period.status] : null,   // 未公開の週の状態
        short: short?.count ?? 0,   // 足りない時間の件数
        shortNotMade: !short || short.notMade,   // まだシフトを作っていない（件数を出さない）
        notes: notes.length,   // お知らせの件数
      }),
      statusCard,   // 今の週の状態（やること）
      callsManagerCard(app, calls),   // 人が足りない時の募集
      shortCard,   // 足りない時間
      notesCard(notes),   // お知らせ
      published ? confirmCard(published, members, confirms) : null,   // 公開シフトの確認
      // 店長も仕事に入るので、自分のシフトも出す
      myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, limit: 3, onMore: () => go("/calendar") }),   // 自分のシフト（3件まで。残りはカレンダー）
      // 店舗の設定（店員管理・マップなど）は「店舗」タブにまとめた（2026年11月15日）
    ),
  );
}

/**
 * 今日のまとめ（店長のホームのいちばん上。2026年11月17日）
 * 4つの数字を並べる。押すと、その中身の所へ移る。色だけでなく「OK」「要確認」の文字でも出す
 */
function summaryCard(info) {   // まとめのカードを作る関数
  /** 1つのマス */
  const tile = (title, value, state, onclick) => createElement("button", { class: `sum-tile is-${state}`, onclick },   // 押せるマス
    createElement("span", { class: "sum-tile__title" }, title),   // 名前
    createElement("span", { class: "sum-tile__value num" }, value),   // 数字
    createElement("span", { class: "sum-tile__state" }, state === "ok" ? "OK" : state === "ng" ? "要確認" : "")); // 状態の文字
  const jump = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });   // その所へスクロール
  return createElement("section", { class: "card sum-card", "aria-label": "今日のまとめ" },   // カード
    createElement("h2", { class: "card__title" }, `今日のまとめ（${label(today())}）`),   // 見出し
    createElement("div", { class: "sum-grid" },   // 4つ並べる
      tile("今日の勤務", info.todayCount == null ? "－" : `${info.todayCount}人`, info.todayCount == null ? "none" : "ok", () => go("/shift")),   // 今日の人数
      tile("希望の提出", `${info.need - info.notYet}/${info.need}人`, info.notYet ? "ng" : "ok", jump("home-status")),   // 出した人／全員（例「1/13人」）
      tile("未公開の週", info.unsettled || "なし", info.unsettled ? "ng" : "ok", () => go("/shift")),   // 未公開（受付中・作成中）
      info.shortNotMade   // まだシフトを作っていなければ
        ? tile("人が足りない", "－", "none", jump("home-short"))   // 数えられない
        : tile("人が足りない", `${info.short}件`, info.short ? "ng" : "ok", jump("home-short")),   // 足りない時間
    ),
    info.notes ? createElement("button", { class: "sum-notes", onclick: jump("home-notes") }, `お知らせ ${info.notes}件 ›`) : null,   // お知らせがあれば
  );
}

/** お知らせ（店長。新しい5件。2026年11月17日） */
function notesCard(notes) {   // お知らせのカードを作る関数
  return createElement("section", { class: "card", id: "home-notes" },   // カード
    createElement("h2", { class: "card__title" }, `お知らせ${notes.length ? `（${notes.length}件）` : ""}`),   // 見出し
    notes.length   // あれば
      ? createElement("ul", { class: "check-list" }, notes.slice(0, 5).map((note) => createElement("li", { class: "is-info" }, note.text)))   // 新しい5件
      : createElement("div", { class: "home-muted" }, "お知らせはありません"),   // なければ
  );
}

/**
 * 店舗の切り替え（3店舗）
 * 押すと、シフト作成・マップ・店員管理など全部の画面がその店舗になる
 */
function storeSwitcher(app) {   // 店舗の切りかえのカードを作る関数
  return createElement("section", { class: "store-bar", "aria-label": "見ている店舗" },   // 細い1行（2026年11月17日：カードから1行にした）
    createElement("div", { class: "store-switch" },   // 店舗のボタン
      activeStores().map((eachStore) => createElement("button", {   // 店舗ごとに
        class: "chip store-switch__btn",   // 見た目
        "aria-pressed": String(eachStore.id === state.storeId),   // 今の店舗に印
        onclick: async () => {   // 押した時
          if (eachStore.id === state.storeId) return;   // 同じなら何もしない
          await switchStore(eachStore.id);   // 切りかえる
          toast(`${eachStore.name} に切り替えました`);   // お知らせ
          renderHome(app);   // 描きなおす
        },
      }, eachStore.name))),   // 店舗の名前
  );
}

/**
 * 人が足りない時の募集（店長）
 * 「入れます」と返事した人がいれば「この人に入ってもらう」で勤務に入る
 */
function callsManagerCard(app, calls) {   // 募集のカードを作る関数
  if (!calls.length) return null;   // なければ出さない
  const area = (call) => (call.area === "hall" ? "ホール" : "キッチン");      // 場所の名前
  return createElement("section", { class: "card" },   // カード
    createElement("h2", { class: "card__title" }, `人が足りない時の募集（${calls.length}件）`),   // 見出し
    // 返事がある募集を上に。多い時は5件まで出して、残りは数だけ
    [...calls].sort((callA, callB) => callB.answers.length - callA.answers.length || callA.date.localeCompare(callB.date)).slice(0, 5).map((call) => createElement("div", { class: "swap-row" },   // 返事が多い順に5件
      createElement("div", null,   // 左側
        createElement("strong", null, `${label(call.date)} ${area(call)} ${range(call.from, call.to)}`),   // 日付・場所・時間
        createElement("div", { class: "home-muted" }, `${call.auto ? "自動で" : ""}${call.candidateCount}人に連絡済み・返事 ${call.answers.length}人`),   // 連絡した人数・返事の数
        call.answers.length   // 返事があれば
          ? createElement("div", { class: "chip-row" }, call.answers.map((answer) => createElement("button", { class: "btn btn--small btn--primary", onclick: async () => {   // 返事した人ごとのボタン
              await api.fillCall(call.id, answer.memberId);   // その人に決める
              toast(`${answer.name}さんに入ってもらいます。本人に知らせました`);   // お知らせ
              renderHome(app);   // 描きなおす
            } }, `${answer.name}さんに入ってもらう`)))   // ボタンの文字
          : null),   // なければ出さない
      createElement("button", { class: "btn btn--small", onclick: async () => { await api.closeCall(call.id); toast("募集をやめました"); renderHome(app); } }, "やめる"))),   // 募集をやめる
    calls.length > 5 ? createElement("div", { class: "home-muted" }, `ほか ${calls.length - 5}件（返事が来たら上に出ます）`) : null,   // ほかの件数
  );
}

/** 公開したシフトを「確認しました」と押していない人 */
function confirmCard(period, members, confirms) {   // 公開シフトの確認のカードを作る関数
  const seen = new Set(confirms.map((confirm) => confirm.memberId));   // 確認した人のID
  const people = members.filter((member) => member.active && (member.rankHere ?? 1) === 1 && member.role !== "manager");   // 確認してほしい人（メインの店員）
  const notSeen = people.filter((member) => !seen.has(member.id));   // まだ見ていない人
  return createElement("section", { class: "card" },   // カード
    createElement("h2", { class: "card__title" }, `公開シフトの確認（${weekLabel(period)}）`),   // 見出し
    createElement("div", null, `確認した人：${people.length - notSeen.length} / ${people.length}人`),   // 見た人数
    // 「まだ見ていない人」の名前の一覧は出さない（人数だけ。2026年11月17日）
    notSeen.length ? null : createElement("div", { class: "notice notice--ok" }, "全員が確認しました"),   // 全員見た
  );
}

/**
 * 人が足りない日と時間（作っている週）
 * 例：「11/9（月） ホール 16:00〜17:00 1人足りない」
 * @returns {Promise<{card:HTMLElement, count:number}>} カードと件数
 */
async function shortageCard(period) {   // 足りない時間のカードを作る関数
  const [work, positions, requirements, storeHours, holidays] = await Promise.all([   // 勤務・マップ・必要人数・営業時間・祝日
    api.listAssignments(period.id), api.listPositions(), api.listRequirements(), api.getStoreHours(), api.listHolidays(),   // 勤務・場所・必要人数・営業時間・祝日を同時に読む
  ]);
  const title = createElement("h2", { class: "card__title" }, `人が足りない時間（${weekLabel(period)}）`);   // カードの見出し
  if (!work.length) {   // 勤務がなければ
    return { count: 0, notMade: true, card: createElement("section", { class: "card", id: "home-short" }, title, createElement("div", { class: "home-muted" }, "まだこの週のシフトを作っていません")) };   // まだ作っていない
  }
  const rows = [];   // 足りない時間の行
  for (const date of datesOf(period)) {   // 7日ごとに
    const type = dayType(date, holidays);   // 平日／土曜／日曜祝日
    const list = findShortages(work.filter((shift) => shift.date === date), requirements, positions, type, hoursOn(storeHours, date, type));   // その日の足りない時間
    for (const shortage of list) {   // 足りない時間ごとに
      rows.push(createElement("li", { class: "is-ng" },   // 1行
        createElement("strong", null, label(date)),   // 日付
        `${shortage.area === "hall" ? "ホール" : "キッチン"} ${range(shortage.from, shortage.to)} ${shortage.short}人足りない`));   // 場所・時間・人数
    }
  }
  return { count: rows.length, card: createElement("section", { class: "card", id: "home-short" }, title,   // 件数とカード（まとめで件数を使う）
    rows.length   // あれば
      ? createElement("ul", { class: "check-list" }, rows)   // 一覧
      : createElement("div", { class: "notice notice--ok" }, "足りない時間はありません")) };   // なければOK
}

// ------------------------------------------------------------
// 店員のホーム
// ------------------------------------------------------------
async function renderStaffHome(app) {   // 店員のホームを描く関数
  const [periods, mine, notes, stores, calls] = await Promise.all([   // 週・自分の勤務・お知らせ・店舗・募集
    api.listPeriods(), api.listMyAssignments(), api.listNotifications(), api.listStores(), api.listCalls(),   // 週・自分の勤務・お知らせ・店舗・募集を同時に読む
  ]);
  const open = openPeriod(periods);   // 受付中の週

  mount(app,   // 画面に入れる
    screenHeader({ title: "ホーム", sub: state.user.name, right: settingsButton() }),   // 見出し
    createElement("div", { class: "screen-body" },   // 本文
      // ① いちばん上：希望を入れるボタン（2か月先まで入れられる）
      createElement("button", { class: "btn btn--primary btn--block home-kibou", onclick: () => go("/kibou") },   // 希望を入れるボタン
        createElement("span", null, "希望を入れる"),   // 文字
        createElement("span", { class: "home-kibou__sub" },   // 小さい説明
          open ? `${weekLabel(open)} の締切 ${deadlineLabel(open)} ・ 2か月先まで入れられます` : "2か月先まで入れられます")),   // 締切
      // ② 自分のシフト（今日 → 明日 → 明後日）
      myShifts({ assignments: mine, stores, myStoreId: state.user.storeId, limit: 3, onMore: () => go("/calendar") }),   // 自分のシフト（3件まで。残りはカレンダー）
      // 人が足りない時の募集（自分に届いた分）：「入れます」を押す
      calls.length   // 募集が来ていれば
        ? createElement("section", { class: "card call-card" },   // カード
            createElement("h2", { class: "card__title" }, "人が足りません。入れますか？"),   // 見出し
            calls.map((call) => createElement("div", { class: "swap-row" },   // 募集ごとに
              createElement("div", null,   // 左側
                createElement("strong", null, `${label(call.date)} ${range(call.from, call.to)}`),   // 日付と時間
                createElement("div", { class: "home-muted" }, `${call.storeShort} ・ ${call.area === "hall" ? "ホール" : "キッチン"}`)),   // 店舗と場所
              call.answered   // もう返事していれば
                ? createElement("div", { class: "chip-row" },   // ボタンの行
                    createElement("span", { class: "badge badge--hall", style: { alignSelf: "center" } }, "返事しました"),   // 返事しましたの印
                    createElement("button", { class: "btn btn--small", onclick: async () => { await api.answerCall(call.id, false); toast("取り消しました"); renderHome(app); } }, "取り消す"))   // 取り消す
                : createElement("button", { class: "btn btn--small btn--primary", onclick: async () => {   // まだなら
                    try { await api.answerCall(call.id, true); toast("「入れます」を送りました。店長が決めたらお知らせが届きます"); }   // 入れますを送る
                    catch (error) { toast(error.message); }   // 失敗したら理由を出す
                    renderHome(app);   // 描きなおす
                  } }, "入れます"))))   // ボタンの文字
        : null,   // なければ出さない
      // ③ お知らせ
      createElement("section", { class: "card" },   // お知らせのカード
        createElement("h2", { class: "card__title" }, "お知らせ"),   // 見出し
        notes.length   // あれば
          ? createElement("ul", { class: "check-list" }, notes.slice(0, 10).map((note) => createElement("li", { class: "is-info" }, note.text)))   // 新しい10件
          : createElement("div", { class: "home-muted" }, "お知らせはありません"),   // なければ
      ),
    ),
  );
}
