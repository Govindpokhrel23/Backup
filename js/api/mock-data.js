// ============================================================
// api/mock-data.js — 見本データ（Supabaseをつなぐまでの仮のデータ）
// ------------------------------------------------------------
// このファイルは、見本データ（Supabaseをつなぐまでの仮のデータ）のファイルです。
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

import { today, mondayOf, addDays, weekDates } from "../lib/date.js";   // 日付の道具を読む

/** 時 → 分（9 → 540、6.5 → 390） */
const hoursToMin = (hours) => hours * 60;   // 時間を分にする

/** 見本データを最初から作る */
export function createMockData() {   // 見本データを作る関数
  const thisMonday = mondayOf(today());       // 今週の月曜（公開済みの週）
  const nextMonday = addDays(thisMonday, 7);  // 来週の月曜（希望を受付中の週）

  // ---------- 会社・店舗 ----------
  const companies = [{ id: "c1", name: "株式会社21 CAFE" }];   // 会社
  const stores = [   // 店舗（3店舗）
    // active: false にすると「休止」（店舗は消さない。過去のシフトに店名が残るため）
    { id: "s-fukugama", companyId: "c1", name: "安城福釜店", short: "福釜", active: true },   // 福釜店
    { id: "s-anjo", companyId: "c1", name: "安城店", short: "安城", active: true },   // 安城店
    { id: "s-imamura", companyId: "c1", name: "安城今村店", short: "今村", active: true },   // 今村店
  ];
  const FUKUGAMA = "s-fukugama", ANJO = "s-anjo", IMAMURA = "s-imamura";   // 店舗のIDの短い書き方

  // ---------- 店員 ----------
  // kind: shain=社員 / baito=バイト / full=フルで入るバイト
  // skills: できること（0・25・50・75・100％）
  // stores: 行ける店舗と順番（rank 1＝メイン、2＝2nd、3＝3rd）。店長が決める
  //         storeId はメインの店舗（rank 1）と同じ
  const makeMember = (id, loginId, name, role, kind, skills, stores, everyday = false) => ({   // 店員を作る関数
    id, storeId: stores[0], loginId, name, role, kind, everyday, skills, active: true,   // ID・所属店・ログインID・名前・役割・立場・毎日・できること・使う
    stores: stores.map((storeId, index) => ({ storeId, rank: index + 1 })),   // 働ける店舗（順番が順位）
  });
  /** できること％を作る（ホール・キッチン・立ち上げ・締め） */
  const skillsOf = (hall, kitchen, open, close) => ({ hall, kitchen, open, close });   // できること％をまとめる
  const members = [   // 店員（名前は見本。本物の名前は入れない）
    // --- 安城福釜店 ---
    makeMember("m0", "1000", "店長", "manager", "shain", skillsOf(100, 100, 100, 100), [FUKUGAMA, ANJO, IMAMURA], true),   // 店長（3店舗とも）
    makeMember("m1", "2001", "スタッフA", "staff", "shain", skillsOf(100, 75, 100, 75), [FUKUGAMA], true),   // 社員（福釜）
    makeMember("m2", "2002", "スタッフB", "staff", "shain", skillsOf(75, 100, 75, 100), [FUKUGAMA, ANJO], true),   // 社員（福釜・安城）
    makeMember("m3", "2003", "スタッフC", "staff", "full", skillsOf(50, 100, 100, 0), [FUKUGAMA], true),   // フルで入るバイト（福釜）
    makeMember("m4", "2004", "スタッフD", "staff", "baito", skillsOf(100, 25, 0, 0), [FUKUGAMA, ANJO]),   // バイト（福釜・安城）
    makeMember("m5", "2005", "スタッフE", "staff", "baito", skillsOf(75, 0, 0, 0), [FUKUGAMA]),   // バイト（福釜）
    makeMember("m6", "2006", "スタッフF", "staff", "full", skillsOf(75, 100, 50, 50), [FUKUGAMA], true),   // フルで入るバイト（福釜）
    makeMember("m7", "2007", "スタッフG", "staff", "baito", skillsOf(100, 50, 0, 100), [FUKUGAMA, IMAMURA]),   // バイト（福釜・今村）
    makeMember("m8", "2008", "スタッフH", "staff", "baito", skillsOf(50, 50, 0, 0), [FUKUGAMA]),   // バイト（研修中・18歳未満の見本）
    // --- 安城店 ---
    makeMember("a1", "3001", "スタッフI", "staff", "shain", skillsOf(100, 100, 100, 75), [ANJO], true),   // 社員（安城）
    makeMember("a2", "3002", "スタッフJ", "staff", "shain", skillsOf(75, 100, 75, 100), [ANJO, FUKUGAMA], true),   // 社員（安城・福釜）
    makeMember("a3", "3003", "スタッフK", "staff", "full", skillsOf(50, 100, 100, 0), [ANJO], true),   // フルで入るバイト（安城）
    makeMember("a4", "3004", "スタッフL", "staff", "baito", skillsOf(100, 50, 0, 0), [ANJO, FUKUGAMA]),   // バイト（安城・福釜）
    makeMember("a5", "3005", "スタッフM", "staff", "baito", skillsOf(100, 0, 0, 100), [ANJO]),   // バイト（安城）
    // --- 安城今村店 ---
    makeMember("i1", "4001", "スタッフO", "staff", "shain", skillsOf(100, 100, 100, 100), [IMAMURA], true),   // 社員（今村）
    makeMember("i2", "4002", "スタッフP", "staff", "full", skillsOf(75, 100, 100, 50), [IMAMURA, ANJO], true),   // フルで入るバイト（今村・安城）
    makeMember("i3", "4003", "スタッフQ", "staff", "baito", skillsOf(100, 50, 0, 100), [IMAMURA]),   // バイト（今村）
    makeMember("i4", "4004", "スタッフR", "staff", "baito", skillsOf(100, 25, 0, 0), [IMAMURA, ANJO, FUKUGAMA]),   // バイト（今村・安城・福釜）
  ];

  // パスワード（見本なので全員 1234。本番はSupabaseが暗号化して持つ）
  const passwords = Object.fromEntries(members.map((member) => [member.loginId, "1234"]));   // パスワードは全員 1234

  // ---------- 人ごとのルール（店長だけが見られる） ----------
  const memberRules = [   // 店長のメモ
    { memberId: "m1", text: "火曜は本部会議があるので13:00から" },   // 見本のメモ
    { memberId: "m4", text: "週20時間まで" },   // 見本のメモ
    { memberId: "m5", text: "土曜はNG" },   // 見本のメモ
    { memberId: "m7", text: "学生。テスト期間は事前に連絡あり" },   // 見本のメモ
    { memberId: "m8", text: "研修中。一人にしない" },   // 見本のメモ
  ];

  // ---------- 担当場所（マップの人のマーク）と必要人数：店舗ごと ----------
  const positions = [];   // 場所（マップ）
  const reqs = [];   // 必要人数
  for (const store of stores) {   // 店舗ごとに
    /** 担当場所のID */
    const id = (name) => `p-${store.short}-${name}`;   // 場所のIDを作る
    positions.push(   // 場所を足す
      { id: id("snack"), storeId: store.id, name: "スナック", area: "kitchen", x: 560, y: 110 },   // スナック（キッチン）
      { id: id("drink"), storeId: store.id, name: "ドリンク", area: "kitchen", x: 665, y: 110 },   // ドリンク（キッチン）
      { id: id("arai"), storeId: store.id, name: "洗い場", area: "kitchen", x: 770, y: 110 },   // 洗い場（キッチン）
      { id: id("reji"), storeId: store.id, name: "レジ", area: "hall", x: 640, y: 270 },   // レジ（ホール）
      { id: id("chumon"), storeId: store.id, name: "注文", area: "hall", x: 300, y: 300 },   // 注文（ホール）
      { id: id("set"), storeId: store.id, name: "セット", area: "hall", x: 470, y: 250 },   // セット（ホール）
    );
    // dayType: weekday=平日 / sat=土曜 / sun=日曜・祝日
    const req = (pos, type, from, to, count) =>   // 必要人数を足す関数
      reqs.push({ id: `r${reqs.length}`, positionId: id(pos), dayType: type, from: hoursToMin(from), to: hoursToMin(to), count });   // 場所・日の種類・時間・人数
    for (const type of ["weekday", "sat", "sun"]) {   // 平日・土曜・日祝ごとに
      const we = type !== "weekday";   // 土日か
      req("snack", type, 7, 22, 1);   // スナックは1日中1人
      if (we) req("drink", type, 9, 17, 1); else req("drink", type, 11, 14, 1);   // ドリンク（土日は長め）
      req("reji", type, 7, 22, 1);   // レジは1日中1人
      req("chumon", type, 9, we ? 17 : 14, 1);   // 注文
      if (we) req("set", type, 11, 14, 1);   // セット（土日だけ）
    }
  }

  // ---------- 受付（週）：店舗ごとに 先週・今週＝公開済み、来週＝受付中 ----------
  const periods = [];   // 週
  for (const store of stores) {   // 店舗ごとに
    /** 受付（週）を1つ作る */
    const makePeriod = (key, weekStart, status) =>   // 週を作る関数
      periods.push({ id: `w-${store.short}-${key}`, storeId: store.id, weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status, note: "" });   // ID・店舗・始まり・締切・状態
    makePeriod("prev", addDays(thisMonday, -7), "published");   // 先週（公開済み）
    makePeriod("this", thisMonday, "published");   // 今週（公開済み）
    makePeriod("next", nextMonday, "open");   // 来週（受付中）
  }

  // ---------- 勤務（先週・今週＝公開済み） ----------
  // いつもの形（紙のシフト表から読んだ傾向）を曜日ごとに入れる
  const assignments = [];   // 勤務
  /** 勤務を1つ足す */
  const add = (storeId, periodKey, date, memberId, from, to, area, breakAt = null) => {   // 勤務を足す関数
    const short = stores.find((store) => store.id === storeId).short;   // 店舗の短い名前
    assignments.push({   // 足す
      id: `a${assignments.length}`, periodId: `w-${short}-${periodKey}`, storeId, memberId, date,   // ID・週・店舗・人・日
      from: hoursToMin(from), to: hoursToMin(to), area, breakAt: breakAt === null ? null : hoursToMin(breakAt),   // 時間・場所・休憩
      fixed: false, createdBy: "manager", requested: false,   // 固定しない・店長が作った・希望なし
    });
  };
  // i は曜日の番号（0=月 … 6=日）。誰でも週1日以上は休みになるようにしてある
  const fillWeek = (key, monday) => weekDates(monday).forEach((date, index) => {   // 1週間分の勤務を入れる関数
    // 立ち上げ（m1・a1・i1）は開店7:00の30分前、6:30から
    // 安城福釜店
    if ([1, 3].includes(index)) add(FUKUGAMA, key, date, "m0", 9, 18, "hall", 13);   // 店長も仕事に入る
    if (index === 5) add(ANJO, key, date, "m0", 9, 18, "hall", 13);              // 店長が安城店に入る日
    if (index !== 2) add(FUKUGAMA, key, date, "m1", 6.5, 16, "hall", 11.5);   // 福釜：社員（立ち上げ）
    if (index !== 4) add(FUKUGAMA, key, date, "m2", 13, 22, "kitchen", 17);   // 福釜：社員（締め）
    if (index !== 6) add(FUKUGAMA, key, date, "m3", 7, 13, "kitchen");   // 福釜：フル（朝）
    if ([0, 2, 4, 5].includes(index)) add(FUKUGAMA, key, date, "m4", 9, 15, "hall");   // 福釜：バイト
    if (index === 1) add(ANJO, key, date, "m4", 10, 15, "hall");                 // スタッフDが安城店へ応援
    if ([1, 3, 6].includes(index)) add(FUKUGAMA, key, date, "m5", 11, 14, "hall");   // 福釜：バイト
    if (index !== 3) add(FUKUGAMA, key, date, "m6", 10, 19, "kitchen", 14);   // 福釜：フル
    if ([0, 1, 4, 5, 6].includes(index)) add(FUKUGAMA, key, date, "m7", 16, 22, "hall");   // 福釜：バイト（夜）
    // 安城店
    if (index !== 3) add(ANJO, key, date, "a1", 6.5, 16, "hall", 11.5);   // 安城：社員（立ち上げ）
    if (index !== 0) add(ANJO, key, date, "a2", 13, 22, "kitchen", 17);   // 安城：社員（締め）
    if (index !== 6) add(ANJO, key, date, "a3", 7, 13, "kitchen");   // 安城：フル（朝）
    if ([0, 2, 3, 6].includes(index)) add(ANJO, key, date, "a4", 9, 15, "hall");   // 安城：バイト
    if ([0, 1, 4, 5].includes(index)) add(ANJO, key, date, "a5", 16, 22, "hall");   // 安城：バイト（夜）
    // 安城今村店
    if (index !== 5) add(IMAMURA, key, date, "i1", 6.5, 16, "hall", 11.5);   // 今村：社員（立ち上げ）
    if (index !== 2) add(IMAMURA, key, date, "i2", 13, 22, "kitchen", 17);   // 今村：フル（締め）
    if ([0, 1, 3, 4].includes(index)) add(IMAMURA, key, date, "i3", 16, 22, "hall");   // 今村：バイト（夜）
    if ([2, 5, 6].includes(index)) add(IMAMURA, key, date, "i4", 9, 15, "hall");   // 今村：バイト
  });
  fillWeek("prev", addDays(thisMonday, -7));   // 先週の勤務
  fillWeek("this", thisMonday);   // 今週の勤務

  // ---------- 希望（来週。希望は日付ごとに持つ。店舗は関係ない） ----------
  // kind: no=入れない / any=いつでもOK / time=時間指定 / off=休み希望 / offx=特別許可の申請
  const availabilities = [];   // 来週の希望
  /** 希望を1つ足す */
  const hope = (memberId, dayIndex, kind, from = null, to = null) =>   // 希望を足す関数
    availabilities.push({   // 足す
      memberId, date: addDays(nextMonday, dayIndex), kind,   // 人・日・種類
      from: from === null ? null : hoursToMin(from), to: to === null ? null : hoursToMin(to),   // 時間
    });
  // 社員：休み希望だけ（ほかは全部「入れる」）
  hope("m1", 2, "off");   // 社員の休み希望
  hope("m2", 4, "off");   // 社員の休み希望
  hope("m2", 5, "offx");                 // 2日目の休み希望＝特別許可の申請中（見本）
  hope("a1", 3, "off");   // 社員の休み希望
  // フルで入るバイト・バイト
  for (let index = 0; index < 7; index++) {   // 7日ごとに
    hope("m3", index, index === 6 ? "no" : "time", 7, 13);   // フル：朝
    hope("m4", index, [0, 1, 2, 4, 5].includes(index) ? "time" : "no", 9, 15);   // バイト：平日の昼
    hope("m5", index, index === 5 ? "no" : [1, 3, 6].includes(index) ? "time" : "no", 11, 14);   // バイト：昼（土曜NG）
    hope("m6", index, index === 3 ? "no" : "time", 10, 19);   // フル：昼〜夜
    hope("m7", index, [0, 1, 4, 5, 6].includes(index) ? "time" : "no", 16, 22);   // バイト：夜
    hope("a3", index, index === 6 ? "no" : "time", 7, 13);   // 安城フル：朝
    hope("a4", index, [0, 2, 3, 6].includes(index) ? "time" : "no", 9, 15);   // 安城バイト：昼
    hope("a5", index, [0, 1, 4, 5].includes(index) ? "time" : "no", 16, 22);   // 安城バイト：夜
    hope("i2", index, index === 2 ? "no" : "time", 13, 22);   // 今村フル：昼〜夜
    hope("i3", index, [0, 1, 3, 4].includes(index) ? "time" : "no", 16, 22);   // 今村バイト：夜
    hope("i4", index, "time", 9, 15);   // 今村バイト：昼
  }
  // スタッフH はまだ出していない（未提出の見本）

  // ---------- 時給・交通費（店長だけが見られる。見本の数字） ----------
  const wages = members.map((member) => ({   // 時給・交通費
    memberId: member.id,   // 人
    hourly: member.kind === "shain" ? 0 : 1100,         // 社員は月給なので、時給の計算には入れない（0）
    transport: member.kind === "shain" ? 0 : 300,   // 交通費（バイトは300円）
    // 働き方のルールの見本（2026年11月6日）：m8＝18歳未満、m5＝扶養の範囲で働く人
    minor: member.id === "m8",   // 18歳未満の見本
    monthHoursMax: member.id === "m5" ? 60 : null,   // 月の上限時間の見本
    yearYenMax: member.id === "m5" ? 1030000 : null,   // 年の上限金額の見本
  }));

  // ---------- 祝日（必要になったら足す） ----------
  const holidays = [];   // 祝日（見本では空）

  return {   // 全部まとめて返す
    version: 2,   // データの形の番号
    companies, stores, members, passwords, memberRules,   // 会社・店舗・店員・パスワード・メモ
    positions, requirements: reqs, periods, availabilities, assignments, holidays, wages,   // 場所・必要人数・週・希望・勤務・祝日・時給
    swaps: [], confirms: [], notifications: [],   // 交代・確認・お知らせ（はじめは空）
    session: null,   // ログインしていない
  };
}
