// ============================================================
// api/mock-data.js — 見本データ（Supabaseをつなぐまでの仮のデータ）
// ------------------------------------------------------------
// ・中身はデータベースの表（テーブル）と同じ形にしてある（基本設計書6章）
//   → あとでSupabaseに切り替えても、画面側のコードはほぼ変えなくてよい
// ・名前は見本用（スタッフA など）。本物の名前は入れない
// ・日付は「今日」から計算するので、いつ開いても動く
// ・3店舗（安城福釜店・安城店・安城今村店）の見本が入っている
//
// ログインの見本（パスワードは全部 1234）：
//   店長（3店舗を管理）       ID 1000
//   福釜の社員               ID 2001
//   福釜のバイト（2nd：安城）  ID 2004
//   安城のバイト             ID 3004
// ============================================================

import { today, mondayOf, addDays, weekDates } from "../lib/date.js";

const H = (h) => h * 60;

/** 見本データを最初から作る */
export function createMockData() {
  const thisMonday = mondayOf(today());       // 今週の月曜（公開済みの週）
  const nextMonday = addDays(thisMonday, 7);  // 来週の月曜（希望を受付中の週）

  // ---------- 会社・店舗 ----------
  const companies = [{ id: "c1", name: "株式会社21 CAFE" }];
  const stores = [
    // active: false にすると「休止」（店舗は消さない。過去のシフトに店名が残るため）
    { id: "s-fukugama", companyId: "c1", name: "安城福釜店", short: "福釜", active: true },
    { id: "s-anjo", companyId: "c1", name: "安城店", short: "安城", active: true },
    { id: "s-imamura", companyId: "c1", name: "安城今村店", short: "今村", active: true },
  ];
  const F = "s-fukugama", A = "s-anjo", I = "s-imamura";

  // ---------- 店員 ----------
  // kind: shain=社員 / baito=バイト / full=フルで入るバイト
  // skills: できること（0・25・50・75・100％）
  // stores: 行ける店舗と順番（rank 1＝メイン、2＝2nd、3＝3rd）。店長が決める
  //         storeId はメインの店舗（rank 1）と同じ
  const m = (id, loginId, name, role, kind, skills, stores, everyday = false) => ({
    id, storeId: stores[0], loginId, name, role, kind, everyday, skills, active: true,
    stores: stores.map((storeId, i) => ({ storeId, rank: i + 1 })),
  });
  const S = (hall, kitchen, open, close) => ({ hall, kitchen, open, close });
  const members = [
    // --- 安城福釜店 ---
    m("m0", "1000", "店長", "manager", "shain", S(100, 100, 100, 100), [F, A, I], true),
    m("m1", "2001", "スタッフA", "staff", "shain", S(100, 75, 100, 75), [F], true),
    m("m2", "2002", "スタッフB", "staff", "shain", S(75, 100, 75, 100), [F, A], true),
    m("m3", "2003", "スタッフC", "staff", "full", S(50, 100, 100, 0), [F], true),
    m("m4", "2004", "スタッフD", "staff", "baito", S(100, 25, 0, 0), [F, A]),
    m("m5", "2005", "スタッフE", "staff", "baito", S(75, 0, 0, 0), [F]),
    m("m6", "2006", "スタッフF", "staff", "full", S(75, 100, 50, 50), [F], true),
    m("m7", "2007", "スタッフG", "staff", "baito", S(100, 50, 0, 100), [F, I]),
    m("m8", "2008", "スタッフH", "staff", "baito", S(50, 50, 0, 0), [F]),
    // --- 安城店 ---
    m("a1", "3001", "スタッフI", "staff", "shain", S(100, 100, 100, 75), [A], true),
    m("a2", "3002", "スタッフJ", "staff", "shain", S(75, 100, 75, 100), [A, F], true),
    m("a3", "3003", "スタッフK", "staff", "full", S(50, 100, 100, 0), [A], true),
    m("a4", "3004", "スタッフL", "staff", "baito", S(100, 50, 0, 0), [A, F]),
    m("a5", "3005", "スタッフM", "staff", "baito", S(100, 0, 0, 100), [A]),
    // --- 安城今村店 ---
    m("i1", "4001", "スタッフO", "staff", "shain", S(100, 100, 100, 100), [I], true),
    m("i2", "4002", "スタッフP", "staff", "full", S(75, 100, 100, 50), [I, A], true),
    m("i3", "4003", "スタッフQ", "staff", "baito", S(100, 50, 0, 100), [I]),
    m("i4", "4004", "スタッフR", "staff", "baito", S(100, 25, 0, 0), [I, A, F]),
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

  // ---------- 担当場所（マップの人のマーク）と必要人数：店舗ごと ----------
  const positions = [];
  const reqs = [];
  for (const store of stores) {
    const id = (name) => `p-${store.short}-${name}`;
    positions.push(
      { id: id("snack"), storeId: store.id, name: "スナック", area: "kitchen", x: 560, y: 110 },
      { id: id("drink"), storeId: store.id, name: "ドリンク", area: "kitchen", x: 665, y: 110 },
      { id: id("arai"), storeId: store.id, name: "洗い場", area: "kitchen", x: 770, y: 110 },
      { id: id("reji"), storeId: store.id, name: "レジ", area: "hall", x: 640, y: 270 },
      { id: id("chumon"), storeId: store.id, name: "注文", area: "hall", x: 300, y: 300 },
      { id: id("set"), storeId: store.id, name: "セット", area: "hall", x: 470, y: 250 },
    );
    // dayType: weekday=平日 / sat=土曜 / sun=日曜・祝日
    const req = (pos, type, from, to, count) =>
      reqs.push({ id: `r${reqs.length}`, positionId: id(pos), dayType: type, from: H(from), to: H(to), count });
    for (const type of ["weekday", "sat", "sun"]) {
      const we = type !== "weekday";
      req("snack", type, 7, 22, 1);
      if (we) req("drink", type, 9, 17, 1); else req("drink", type, 11, 14, 1);
      req("reji", type, 7, 22, 1);
      req("chumon", type, 9, we ? 17 : 14, 1);
      if (we) req("set", type, 11, 14, 1);
    }
  }

  // ---------- 受付（週）：店舗ごとに 先週・今週＝公開済み、来週＝受付中 ----------
  const periods = [];
  for (const store of stores) {
    const p = (key, weekStart, status) =>
      periods.push({ id: `w-${store.short}-${key}`, storeId: store.id, weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status, note: "" });
    p("prev", addDays(thisMonday, -7), "published");
    p("this", thisMonday, "published");
    p("next", nextMonday, "open");
  }

  // ---------- 勤務（先週・今週＝公開済み） ----------
  // いつもの形（紙のシフト表から読んだ傾向）を曜日ごとに入れる
  const assignments = [];
  const add = (storeId, periodKey, date, memberId, from, to, area, breakAt = null) => {
    const short = stores.find((s) => s.id === storeId).short;
    assignments.push({
      id: `a${assignments.length}`, periodId: `w-${short}-${periodKey}`, storeId, memberId, date,
      from: H(from), to: H(to), area, breakAt: breakAt === null ? null : H(breakAt),
      fixed: false, createdBy: "manager", requested: false,
    });
  };
  // i は曜日の番号（0=月 … 6=日）。誰でも週1日以上は休みになるようにしてある
  const fillWeek = (key, monday) => weekDates(monday).forEach((date, i) => {
    // 立ち上げ（m1・a1・i1）は開店7:00の30分前、6:30から
    // 安城福釜店
    if ([1, 3].includes(i)) add(F, key, date, "m0", 9, 18, "hall", 13);   // 店長も仕事に入る
    if (i === 5) add(A, key, date, "m0", 9, 18, "hall", 13);              // 店長が安城店に入る日
    if (i !== 2) add(F, key, date, "m1", 6.5, 16, "hall", 11.5);
    if (i !== 4) add(F, key, date, "m2", 13, 22, "kitchen", 17);
    if (i !== 6) add(F, key, date, "m3", 7, 13, "kitchen");
    if ([0, 2, 4, 5].includes(i)) add(F, key, date, "m4", 9, 15, "hall");
    if (i === 1) add(A, key, date, "m4", 10, 15, "hall");                 // スタッフDが安城店へ応援
    if ([1, 3, 6].includes(i)) add(F, key, date, "m5", 11, 14, "hall");
    if (i !== 3) add(F, key, date, "m6", 10, 19, "kitchen", 14);
    if ([0, 1, 4, 5, 6].includes(i)) add(F, key, date, "m7", 16, 22, "hall");
    // 安城店
    if (i !== 3) add(A, key, date, "a1", 6.5, 16, "hall", 11.5);
    if (i !== 0) add(A, key, date, "a2", 13, 22, "kitchen", 17);
    if (i !== 6) add(A, key, date, "a3", 7, 13, "kitchen");
    if ([0, 2, 3, 6].includes(i)) add(A, key, date, "a4", 9, 15, "hall");
    if ([0, 1, 4, 5].includes(i)) add(A, key, date, "a5", 16, 22, "hall");
    // 安城今村店
    if (i !== 5) add(I, key, date, "i1", 6.5, 16, "hall", 11.5);
    if (i !== 2) add(I, key, date, "i2", 13, 22, "kitchen", 17);
    if ([0, 1, 3, 4].includes(i)) add(I, key, date, "i3", 16, 22, "hall");
    if ([2, 5, 6].includes(i)) add(I, key, date, "i4", 9, 15, "hall");
  });
  fillWeek("prev", addDays(thisMonday, -7));
  fillWeek("this", thisMonday);

  // ---------- 希望（来週。希望は日付ごとに持つ。店舗は関係ない） ----------
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
  hope("a1", 3, "off");
  // フルで入るバイト・バイト
  for (let i = 0; i < 7; i++) {
    hope("m3", i, i === 6 ? "no" : "time", 7, 13);
    hope("m4", i, [0, 1, 2, 4, 5].includes(i) ? "time" : "no", 9, 15);
    hope("m5", i, i === 5 ? "no" : [1, 3, 6].includes(i) ? "time" : "no", 11, 14);
    hope("m6", i, i === 3 ? "no" : "time", 10, 19);
    hope("m7", i, [0, 1, 4, 5, 6].includes(i) ? "time" : "no", 16, 22);
    hope("a3", i, i === 6 ? "no" : "time", 7, 13);
    hope("a4", i, [0, 2, 3, 6].includes(i) ? "time" : "no", 9, 15);
    hope("a5", i, [0, 1, 4, 5].includes(i) ? "time" : "no", 16, 22);
    hope("i2", i, i === 2 ? "no" : "time", 13, 22);
    hope("i3", i, [0, 1, 3, 4].includes(i) ? "time" : "no", 16, 22);
    hope("i4", i, "time", 9, 15);
  }
  // スタッフH はまだ出していない（未提出の見本）

  // ---------- 時給・交通費（店長だけが見られる。見本の数字） ----------
  const wages = members.map((x) => ({
    memberId: x.id,
    hourly: x.kind === "shain" ? 0 : 1100,         // 社員は月給なので、時給の計算には入れない（0）
    transport: x.kind === "shain" ? 0 : 300,
  }));

  // ---------- 祝日（必要になったら足す） ----------
  const holidays = [];

  return {
    version: 2,
    companies, stores, members, passwords, memberRules,
    positions, requirements: reqs, periods, availabilities, assignments, holidays, wages,
    swaps: [], confirms: [], notifications: [],
    session: null,
  };
}
