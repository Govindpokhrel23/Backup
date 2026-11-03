// ============================================================
// api/mock-data.js — 見本データ（Supabaseをつなぐまでの仮のデータ）
// ------------------------------------------------------------
// ・中身はデータベースの表（テーブル）と同じ形にしてある（基本設計書6章）
//   → あとでSupabaseに切り替えても、画面側のコードはほぼ変えなくてよい
// ・名前は見本用（スタッフA など）。本物の名前は入れない
// ・日付は「今日」から計算するので、いつ開いても動く
//
// ログインの見本：
//   店長     ID 1000 / パスワード 1234
//   社員     ID 2001 / パスワード 1234
//   バイト   ID 2004 / パスワード 1234
// ============================================================

import { today, mondayOf, addDays, weekDates } from "../lib/date.js";

/** 見本データを最初から作る */
export function createMockData() {
  const thisMonday = mondayOf(today());       // 今週の月曜（公開済みの週）
  const nextMonday = addDays(thisMonday, 7);  // 来週の月曜（希望を受付中の週）

  // ---------- 会社・店舗 ----------
  const companies = [{ id: "c1", name: "株式会社21 CAFE" }];
  const stores = [
    { id: "s-fukugama", companyId: "c1", name: "安城福釜店", short: "福釜" },
    { id: "s-anjo", companyId: "c1", name: "安城店", short: "安城" },
    { id: "s-imamura", companyId: "c1", name: "安城今村店", short: "今村" },
  ];

  // ---------- 店員 ----------
  // kind: shain=社員 / baito=バイト / full=フルで入るバイト
  // skills: できること（0・25・50・75・100％）
  const m = (id, loginId, name, role, kind, skills, everyday = false) => ({
    id, storeId: "s-fukugama", loginId, name, role, kind, everyday,
    skills, active: true,
  });
  const members = [
    m("m0", "1000", "店長", "manager", "shain", { hall: 100, kitchen: 100, open: 100, close: 100 }, true),
    m("m1", "2001", "スタッフA", "staff", "shain", { hall: 100, kitchen: 75, open: 100, close: 75 }, true),
    m("m2", "2002", "スタッフB", "staff", "shain", { hall: 75, kitchen: 100, open: 75, close: 100 }, true),
    m("m3", "2003", "スタッフC", "staff", "full", { hall: 50, kitchen: 100, open: 100, close: 0 }, true),
    m("m4", "2004", "スタッフD", "staff", "baito", { hall: 100, kitchen: 25, open: 0, close: 0 }),
    m("m5", "2005", "スタッフE", "staff", "baito", { hall: 75, kitchen: 0, open: 0, close: 0 }),
    m("m6", "2006", "スタッフF", "staff", "full", { hall: 75, kitchen: 100, open: 50, close: 50 }, true),
    m("m7", "2007", "スタッフG", "staff", "baito", { hall: 100, kitchen: 50, open: 0, close: 100 }),
    m("m8", "2008", "スタッフH", "staff", "baito", { hall: 50, kitchen: 50, open: 0, close: 0 }),
  ];

  // パスワード（見本なので全員 1234。本番はSupabaseが暗号化して持つ）
  const passwords = Object.fromEntries(members.map((x) => [x.loginId, "1234"]));

  // ---------- 人ごとのルール（店長だけが見られる） ----------
  const memberRules = [
    { memberId: "m1", text: "火曜は本部会議があるので13:00から" },
    { memberId: "m4", text: "週20時間まで" },
    { memberId: "m5", text: "土曜はNG" },
    { memberId: "m7", text: "学生。テスト期間は事前に連絡あり" },
    { memberId: "m8", text: "研修中。一人にしない" },
  ];

  // ---------- 担当場所（マップの人のマーク） ----------
  const positions = [
    { id: "p-snack", storeId: "s-fukugama", name: "スナック", area: "kitchen", x: 560, y: 110 },
    { id: "p-drink", storeId: "s-fukugama", name: "ドリンク", area: "kitchen", x: 665, y: 110 },
    { id: "p-arai", storeId: "s-fukugama", name: "洗い場", area: "kitchen", x: 770, y: 110 },
    { id: "p-reji", storeId: "s-fukugama", name: "レジ", area: "hall", x: 640, y: 270 },
    { id: "p-chumon", storeId: "s-fukugama", name: "注文", area: "hall", x: 300, y: 300 },
    { id: "p-set", storeId: "s-fukugama", name: "セット", area: "hall", x: 470, y: 250 },
  ];

  // ---------- 場所ごとの必要人数 ----------
  // dayType: weekday=平日 / sat=土曜 / sun=日曜・祝日
  const H = (h) => h * 60;
  const reqs = [];
  const req = (positionId, type, from, to, count) =>
    reqs.push({ id: `r${reqs.length}`, positionId, dayType: type, from: H(from), to: H(to), count });
  for (const type of ["weekday", "sat", "sun"]) {
    const we = type !== "weekday";
    req("p-snack", type, 7, 22, 1);
    if (we) req("p-drink", type, 9, 17, 1); else req("p-drink", type, 11, 14, 1);
    req("p-reji", type, 7, 22, 1);
    req("p-chumon", type, 9, we ? 17 : 14, 1);
    if (we) req("p-set", type, 11, 14, 1);
  }

  // ---------- 受付（週） ----------
  const periods = [
    { id: "w-prev", storeId: "s-fukugama", weekStart: addDays(thisMonday, -7), deadline: `${addDays(thisMonday, -8)}T24:00`, status: "published", note: "" },
    { id: "w-this", storeId: "s-fukugama", weekStart: thisMonday, deadline: `${addDays(thisMonday, -1)}T24:00`, status: "published", note: "" },
    { id: "w-next", storeId: "s-fukugama", weekStart: nextMonday, deadline: `${addDays(nextMonday, -1)}T24:00`, status: "open", note: "" },
  ];

  // ---------- 勤務（今週＝公開済み） ----------
  // いつもの形（紙のシフト表から読んだ傾向）を曜日ごとに入れる
  const assignments = [];
  const add = (periodId, date, memberId, from, to, area, breakAt = null) =>
    assignments.push({
      id: `a${assignments.length}`, periodId, storeId: "s-fukugama", memberId, date,
      from: H(from), to: H(to), area, breakAt: breakAt === null ? null : H(breakAt),
      fixed: false, createdBy: "manager", requested: false,
    });
  // i は曜日の番号（0=月 … 6=日）。誰でも週1日以上は休みになるようにしてある
  // 先週と今週は同じ形（先週の分は、ホームからは消えてカレンダーにだけ残る見本）
  const fillWeek = (periodId, monday) => weekDates(monday).forEach((date, i) => {
    if ([1, 3, 5].includes(i)) add(periodId, date, "m0", 9, 18, "hall", 13);   // 店長も仕事に入る
    if (i !== 2) add(periodId, date, "m1", 7, 16, "hall", 11.5);        // A 水曜休み
    if (i !== 4) add(periodId, date, "m2", 13, 22, "kitchen", 17);      // B 金曜休み
    if (i !== 6) add(periodId, date, "m3", 7, 13, "kitchen");           // C 日曜休み
    if ([0, 2, 4, 5].includes(i)) add(periodId, date, "m4", 9, 15, "hall");
    if ([1, 3, 6].includes(i)) add(periodId, date, "m5", 11, 14, "hall");
    if (i !== 3) add(periodId, date, "m6", 10, 19, "kitchen", 14);      // F 木曜休み
    if ([0, 1, 4, 5, 6].includes(i)) add(periodId, date, "m7", 16, 22, "hall");
  });
  fillWeek("w-prev", addDays(thisMonday, -7));
  fillWeek("w-this", thisMonday);

  // ---------- 希望（来週＝受付中。希望は日付ごとに持つ） ----------
  // kind: no=入れない / any=いつでもOK / time=時間指定 / off=休み希望 / offx=特別許可の申請
  const availabilities = [];
  const hope = (memberId, i, kind, from = null, to = null) =>
    availabilities.push({
      memberId, date: addDays(nextMonday, i), kind,
      from: from === null ? null : H(from), to: to === null ? null : H(to),
    });
  // 社員：休み希望だけ（ほかは全部「入れる」）
  hope("m1", 2, "off");
  hope("m2", 4, "off");
  // フルで入るバイト・バイト
  for (let i = 0; i < 7; i++) {
    hope("m3", i, i === 6 ? "no" : "time", 7, 13);
    hope("m4", i, [0, 2, 4, 5].includes(i) ? "time" : "no", 9, 15);
    hope("m5", i, i === 5 ? "no" : [1, 3, 6].includes(i) ? "time" : "no", 11, 14);
    hope("m6", i, i === 3 ? "no" : "time", 10, 19);
    hope("m7", i, [0, 1, 4, 5, 6].includes(i) ? "time" : "no", 16, 22);
  }
  // スタッフH はまだ出していない（未提出の見本）

  // ---------- 祝日（必要になったら足す） ----------
  const holidays = [];

  return {
    version: 1,
    companies, stores, members, passwords, memberRules,
    positions, requirements: reqs, periods, availabilities, assignments, holidays,
    session: null,
  };
}
