// ============================================================
// api/test-data.js — テストモードのデータ（開発者が動きを確かめる用）
// ------------------------------------------------------------
// このファイルは、テストモードの時に使う「テスト用の店員とお店」を作るファイルです（2026年11月15日）。
// テストモードは、このスマホの中だけで動く（本物の Supabase のデータは変わらない）。
//
// 人数：
//   ・社員 5人 … どの店舗のメインにもなる（3店舗とも「メイン」。店長があとで決める）
//   ・バイト 30人 … 店舗ごとに 10人（うち 2人は「フルで入るバイト」）
//   → 1店舗あたり 社員5人＋バイト10人＝15人
//   ・店長（ID 1000）・開発者（ID 9000）も入っている
// パスワードは全員 1234。
// ログインID：社員 5001〜5005 ／ 福釜 2001〜2010 ／ 安城 3001〜3010 ／ 今村 4001〜4010
// 希望はまだ空。開発者の「設定」→「テストモード」から、まとめて入れたり、その人として入れたりできる。
// ============================================================

import { createMockData } from "./mock-data.js";   // ふつうの見本データ（店舗・マップ・必要人数・週を使う）

/** テストモードのデータを最初から作る */
export function createTestData() {   // テスト用のデータを作る関数
  const base = createMockData();   // 店舗・マップ・必要人数・週は見本と同じ形を使う
  const stores = base.stores;   // 3店舗
  const allStores = stores.map((store) => store.id);   // 全部の店舗のID

  /** 店員を作る（storeIds：行ける店舗。rank はみんな 1＝メイン） */
  const person = (id, loginId, name, role, kind, skills, storeIds, everyday = false, extra = {}) => ({   // 店員を作る関数
    id, storeId: storeIds[0], loginId, name, role, kind, everyday, skills, active: true,   // ID・所属店・ログインID・名前・役割・立場・毎日・できること・使う
    stores: storeIds.map((storeId) => ({ storeId, rank: 1 })),   // 行ける店舗（全部メイン）
    ...extra,   // 開発者の印など
  });
  /** できること％ */
  const skillsOf = (hall, kitchen, open, close) => ({ hall, kitchen, open, close });   // できること％をまとめる

  const members = [   // 店員
    person("m0", "1000", "店長", "manager", "shain", skillsOf(100, 100, 100, 100), allStores, true),   // 店長（3店舗とも）
    { ...person("d1", "9000", "開発者", "manager", "shain", skillsOf(0, 0, 0, 0), [allStores[0]]), stores: [], developer: true },   // 開発者（シフトには出ない）
  ];

  // ---------- 社員 5人（どの店舗にも行ける） ----------
  const SHAIN_SKILLS = [   // 社員のできること（いろいろな人がいるように）
    skillsOf(100, 100, 100, 100),   // 何でもできる
    skillsOf(100, 75, 100, 50),   // ホールが得意・立ち上げ
    skillsOf(75, 100, 50, 100),   // キッチンが得意・締め
    skillsOf(100, 50, 100, 100),   // ホール・立ち上げ・締め
    skillsOf(50, 100, 75, 75),   // キッチン
  ];
  SHAIN_SKILLS.forEach((skills, index) => {   // 5人分
    members.push(person(`ts${index + 1}`, `500${index + 1}`, `社員${index + 1}`, "staff", "shain", skills, allStores, true));   // 社員（3店舗とも）
  });

  // ---------- バイト 店舗ごとに 10人 ----------
  const BAITO_SKILLS = [   // バイトのできること（10人分。くり返して使う）
    skillsOf(100, 50, 0, 0), skillsOf(75, 25, 0, 0), skillsOf(50, 100, 0, 0), skillsOf(100, 0, 0, 100), skillsOf(25, 75, 0, 0),   // 1〜5人め
    skillsOf(100, 100, 0, 50), skillsOf(50, 50, 0, 0), skillsOf(75, 75, 0, 0), skillsOf(100, 25, 50, 0), skillsOf(25, 100, 0, 0),   // 6〜10人め
  ];
  const LOGIN_HEAD = { "s-fukugama": "2", "s-anjo": "3", "s-imamura": "4" };   // 店舗ごとのログインIDの頭の数字
  for (const store of stores) {   // 店舗ごとに
    for (let index = 0; index < 10; index++) {   // 10人
      const no = String(index + 1).padStart(3, "0");   // 001〜010
      const kind = index < 2 ? "full" : "baito";   // 2人はフルで入るバイト
      members.push(person(`t-${store.short}-${index + 1}`, `${LOGIN_HEAD[store.id]}${no}`, `${store.short}バイト${index + 1}`,   // ID・ログインID・名前（例「福釜バイト1」）
        "staff", kind, BAITO_SKILLS[index], [store.id], kind === "full"));   // バイト（その店舗だけ）
    }
  }

  // ---------- 時給・交通費（テスト用の数字） ----------
  const wages = members.map((member) => ({   // 人ごとに
    memberId: member.id,   // 人
    hourly: member.kind === "shain" ? 0 : 1100,   // 社員は月給なので 0
    transport: member.kind === "shain" ? 0 : 300,   // 交通費
    minor: false, monthHoursMax: null, yearYenMax: null,   // 働き方の上限はなし
  }));

  return {   // 全部まとめて返す
    ...base,   // 店舗・マップ・必要人数・週・祝日
    members,   // 店員（テスト用）
    passwords: Object.fromEntries(members.map((member) => [member.loginId, "1234"])),   // パスワードは全員 1234
    memberRules: [],   // 人ごとのルールはなし
    availabilities: [],   // 希望はまだ空
    assignments: [],   // 勤務はまだ空
    wages,   // 時給
    storeHours: {},   // 営業時間はいつもの時間（7:00〜22:00）
    session: null,   // ログインしていない
    test: true,   // テストモードのデータの印
  };
}

/**
 * テスト用の希望を、受付中の週の全部の日にまとめて作る
 * ・社員：休み希望を週1日（日はばらばら）
 * ・バイト：日ごとに「入れない／いつでもOK／時間指定（朝・昼・夜）」をばらばらに
 * 同じ人・同じ日の希望があれば入れかえる
 * @param {object} data   テストのデータ
 * @param {string[]} dates 希望を入れる日
 * @returns {number} 入れた希望の数
 */
export function fillTestHopes(data, dates) {   // テストの希望をまとめて作る関数
  let seed = 7;   // ばらばらの数の元（毎回同じ結果になるように固定）
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };   // 0〜1 のばらばらの数
  const SHAPES = [[7 * 60, 13 * 60], [9 * 60, 15 * 60], [11 * 60, 17 * 60], [16 * 60, 22 * 60], [10 * 60, 19 * 60]];   // 時間指定の形（朝・昼・昼〜夕・夜・長め）
  const people = data.members.filter((member) => member.active && member.role !== "manager" && !member.developer);   // 希望を出す人
  const keep = data.availabilities.filter((hope) => !dates.includes(hope.date));   // ほかの日の希望はそのまま
  const made = [];   // 作った希望
  for (const member of people) {   // 人ごとに
    if (member.kind === "shain") {   // 社員は
      for (const [, list] of chunk(dates, 7)) {   // 7日ずつ（1週間ごと）に1日休み
        const off = list[Math.floor(rand() * list.length)];   // 休む日
        made.push({ memberId: member.id, date: off, kind: "off", from: null, to: null });   // 休み希望
      }
      continue;   // 次の人へ
    }
    for (const date of dates) {   // バイトは日ごとに
      const roll = rand();   // ばらばらの数
      if (roll < 0.3) { made.push({ memberId: member.id, date, kind: "no", from: null, to: null }); continue; }   // 3割は入れない
      if (roll < 0.45) { made.push({ memberId: member.id, date, kind: "any", from: null, to: null }); continue; }   // いつでもOK
      const [from, to] = SHAPES[Math.floor(rand() * SHAPES.length)];   // 時間指定の形
      made.push({ memberId: member.id, date, kind: "time", from, to });   // 時間指定
    }
  }
  data.availabilities = [...keep, ...made];   // 入れかえる
  return made.length;   // 入れた数
}

/** 配列を n 個ずつに分ける（[番号, 中身] の形で返す） */
function chunk(list, size) {   // 分ける関数
  const out = [];   // 結果
  for (let index = 0; index < list.length; index += size) out.push([index, list.slice(index, index + size)]);   // n 個ずつ
  return out;   // 返す
}
