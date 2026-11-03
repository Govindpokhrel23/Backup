// ============================================================
// api/mock-api.js — 見本データで動く「にせもののサーバー」
// ------------------------------------------------------------
// ・本物（Supabase）と同じ名前・同じ形の関数を用意している
//   → api/index.js で切り替えるだけで本物になる
// ・データはこのブラウザの中（localStorage）に保存する
//   ※見本なので、ブラウザのデータを消すと元に戻る
// ・「店員はほかの人の希望を見られない」などの制限もここで再現する
//   （本物では Supabase の RLS＝データベース側の制限で守る。設計書7章）
// ============================================================

import { createMockData } from "./mock-data.js";
import { today, addDays, weekDates } from "../lib/date.js";

// 形を変えたら番号を上げる（古い見本データは自動で作り直される）
const STORAGE_KEY = "shiftapp-mock-v3";

// ------------------------------------------------------------
// 保存と読み込み
// ------------------------------------------------------------

/** 保存してあるデータを読む。なければ見本データを作る */
function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn("見本データを読めなかったので作り直します", e);
  }
  const fresh = createMockData();
  save(fresh);
  return fresh;
}

/** データを保存する */
function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("保存できませんでした（プライベートブラウズなど）", e);
  }
}

/** 中身のコピーを返す（画面側でいじっても元のデータが変わらないように） */
const copy = (x) => JSON.parse(JSON.stringify(x));

/** 本物の通信のように「少し待ってから」答える */
const reply = (value) => new Promise((ok) => setTimeout(() => ok(copy(value)), 80));

/** エラーを返す */
const fail = (message) => Promise.reject(new Error(message));

// ------------------------------------------------------------
// ログイン中の人
// ------------------------------------------------------------

/** ログイン中の店員（いなければ null） */
function me(data) {
  if (!data.session) return null;
  return data.members.find((x) => x.id === data.session.memberId) || null;
}

/**
 * 今見ている店舗
 * ・店長 → ホームで切り替えた店舗（3店舗を管理できる）
 * ・店員 → メインの店舗
 */
function storeOf(data) {
  return data.session?.storeId || me(data)?.storeId;
}

/** その人がその店舗に行けるか（店長が決めた「行ける店舗」） */
function canWorkAt(member, storeId) {
  return member.storeId === storeId || (member.stores || []).some((s) => s.storeId === storeId);
}

/** その店舗での順番（1＝メイン、2＝2nd、3＝3rd。行けなければ null） */
function rankAt(member, storeId) {
  if (member.stores?.length) return member.stores.find((s) => s.storeId === storeId)?.rank ?? null;
  return member.storeId === storeId ? 1 : null;
}

/** 店長でなければエラー */
function requireManager(data) {
  const user = me(data);
  if (!user || user.role !== "manager") throw new Error("店長だけができる操作です");
  return user;
}

// ============================================================
// ここから下が「画面から呼ぶ関数」
// ============================================================

export const mockApi = {
  // ---------- ログイン ----------

  /** ID とパスワードでログイン */
  async login(loginId, password) {
    const data = load();
    const user = data.members.find((x) => x.loginId === loginId && x.active);
    if (!user || data.passwords[loginId] !== password) {
      return fail("IDかパスワードが違います");
    }
    data.session = { memberId: user.id, storeId: user.storeId };
    save(data);
    return reply(user);
  },

  /** ログアウト */
  async logout() {
    const data = load();
    data.session = null;
    save(data);
    return reply(true);
  },

  /** 今ログインしている人（ログインを保持しているので、開き直しても残る） */
  async currentUser() {
    return reply(me(load()));
  },

  /**
   * はじめての人：店長からもらった ID と初回コードで、パスワードを決める
   * （本物では Cloudflare Workers が確認する。設計書5章）
   */
  async activate(loginId, code, password) {
    const data = load();
    const user = data.members.find((x) => x.loginId === loginId);
    const codes = data.loginCodes || [];
    const hit = codes.find((c) => c.loginId === loginId && c.code === code && !c.used);
    if (!user || !hit) return fail("IDか初回コードが違います");
    if (!password || password.length < 4) return fail("パスワードは4文字以上にしてください");
    hit.used = true;
    data.passwords[loginId] = password;
    data.session = { memberId: user.id, storeId: user.storeId };
    save(data);
    return reply(user);
  },

  // ---------- 店舗・店員 ----------

  async listStores() {
    return reply(load().stores);
  },

  /** 今見ている店舗のID */
  async currentStoreId() {
    return reply(storeOf(load()));
  },

  /** 店舗を切り替える（店長だけ。ホームから） */
  async setCurrentStore(storeId) {
    const data = load();
    requireManager(data);
    if (!data.stores.some((s) => s.id === storeId)) return fail("店舗が見つかりません");
    data.session.storeId = storeId;
    save(data);
    return reply(storeId);
  },

  /**
   * 今の店舗で働ける店員の一覧
   * メイン（rank 1）の人に加えて、2nd・3rd でこの店舗に行ける人も入る
   * 返す時に「この店舗での順番」を rankHere につける
   */
  async listMembers() {
    const data = load();
    const user = me(data);
    if (!user) return fail("ログインしてください");
    const store = storeOf(data);
    return reply(data.members
      .filter((x) => canWorkAt(x, store))
      .map((x) => ({ ...x, rankHere: rankAt(x, store) })));
  },

  /**
   * 店員を作る（店長）
   * 立場（社員／バイト／フル）とできること％は、ここで店長が決める
   * @returns {{member, code}} code＝本人に渡す初回コード（6桁）
   */
  async createMember({ name, kind, skills, everyday, stores }) {
    const data = load();
    requireManager(data);
    // ID は会社の中で一番大きい番号＋1
    const maxId = Math.max(...data.members.map((x) => Number(x.loginId)));
    // 行ける店舗：決めていなければ、今の店舗だけ（メイン）
    const list = stores?.length ? stores : [{ storeId: storeOf(data), rank: 1 }];
    const member = {
      id: `m${Date.now()}`,
      storeId: list.find((s) => s.rank === 1)?.storeId || list[0].storeId,
      stores: list,
      loginId: String(maxId + 1),
      name, role: "staff", kind, skills, everyday: !!everyday, active: true,
    };
    data.members.push(member);
    const code = issueCode(data, member.loginId);
    save(data);
    return reply({ member, code });
  },

  /** 店員の情報を変える（店長） */
  async saveMember(member) {
    const data = load();
    requireManager(data);
    const i = data.members.findIndex((x) => x.id === member.id);
    if (i < 0) return fail("店員が見つかりません");
    const { rankHere, ...clean } = member;          // 画面用の rankHere は保存しない
    data.members[i] = { ...data.members[i], ...clean };
    // メインの店舗（rank 1）を storeId にもそろえる
    const main = data.members[i].stores?.find((s) => s.rank === 1);
    if (main) data.members[i].storeId = main.storeId;
    save(data);
    return reply(data.members[i]);
  },

  /** パスワードを忘れた時：新しい初回コードを出す（店長） */
  async resetPassword(memberId) {
    const data = load();
    requireManager(data);
    const user = data.members.find((x) => x.id === memberId);
    const code = issueCode(data, user.loginId);
    save(data);
    return reply({ loginId: user.loginId, code });
  },

  // ---------- 人ごとのルール（店長だけ） ----------

  async getMemberRule(memberId) {
    const data = load();
    requireManager(data);
    const rule = data.memberRules.find((x) => x.memberId === memberId);
    return reply(rule ? rule.text : "");
  },

  async listMemberRules() {
    const data = load();
    requireManager(data);
    return reply(data.memberRules);
  },

  async saveMemberRule(memberId, text) {
    const data = load();
    requireManager(data);
    data.memberRules = data.memberRules.filter((x) => x.memberId !== memberId);
    if (text.trim()) data.memberRules.push({ memberId, text: text.trim() });
    save(data);
    return reply(true);
  },

  // ---------- マップ・必要人数 ----------

  async listPositions() {
    const data = load();
    return reply(data.positions.filter((x) => x.storeId === storeOf(data)));
  },

  async savePositions(positions) {
    const data = load();
    requireManager(data);
    const store = storeOf(data);
    const ids = new Set(positions.map((p) => p.id));
    // 消したマークの必要人数も一緒に消す
    const mineBefore = new Set(data.positions.filter((p) => p.storeId === store).map((p) => p.id));
    data.requirements = data.requirements.filter((r) => !mineBefore.has(r.positionId) || ids.has(r.positionId));
    data.positions = data.positions.filter((p) => p.storeId !== store).concat(positions.map((p) => ({ ...p, storeId: store })));
    save(data);
    return reply(true);
  },

  async listRequirements() {
    const data = load();
    const mine = new Set(data.positions.filter((p) => p.storeId === storeOf(data)).map((p) => p.id));
    return reply(data.requirements.filter((r) => mine.has(r.positionId)));
  },

  /** ある担当場所・日の種類の必要人数をまとめて入れ替える */
  async saveRequirements(positionId, dayType, rows) {
    const data = load();
    requireManager(data);
    data.requirements = data.requirements.filter((r) => !(r.positionId === positionId && r.dayType === dayType));
    rows.forEach((r, i) => data.requirements.push({ id: `r${Date.now()}-${i}`, positionId, dayType, from: r.from, to: r.to, count: r.count }));
    save(data);
    return reply(true);
  },

  async listHolidays() {
    return reply(load().holidays || []);
  },

  // ---------- 営業時間（store_hours） ----------

  /**
   * 自分の店舗の営業時間
   * @returns {{weekday:{open,close}, sat:{open,close}, sun:{open,close}}}
   */
  async getStoreHours() {
    const data = load();
    return reply((data.storeHours || {})[storeOf(data)] || defaultHours());
  },

  /** 営業時間を保存（店長） */
  async saveStoreHours(hours) {
    const data = load();
    requireManager(data);
    for (const key of ["weekday", "sat", "sun"]) {
      if (hours[key].close <= hours[key].open) return fail("閉店は開店より後にしてください");
    }
    data.storeHours = data.storeHours || {};
    data.storeHours[storeOf(data)] = hours;
    save(data);
    return reply(true);
  },

  // ---------- 受付（週） ----------

  async listPeriods() {
    const data = load();
    return reply(data.periods.filter((p) => p.storeId === storeOf(data)).sort((a, b) => a.weekStart.localeCompare(b.weekStart)));
  },

  /**
   * その週の受付がなければ作る（店長が先の週のシフトを作る時）
   * シフト作成の「次の週へ」で使う
   */
  async ensurePeriod(weekStart) {
    const data = load();
    requireManager(data);
    const store = storeOf(data);
    let p = data.periods.find((x) => x.storeId === store && x.weekStart === weekStart);
    if (!p) {
      p = { id: `w-${store}-${weekStart}`, storeId: store, weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status: "open", note: "" };
      data.periods.push(p);
      save(data);
    }
    return reply(p);
  },

  /** 受付の状態を変える（open=受付中 / closed=締切 / published=公開） */
  async setPeriodStatus(periodId, status) {
    const data = load();
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);
    p.status = status;
    if (status === "published") p.publishedAt = new Date().toISOString();
    save(data);
    return reply(p);
  },

  /** 連絡事項（その週）を保存する（店長） */
  async savePeriodNote(periodId, note) {
    const data = load();
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);
    p.note = note;
    save(data);
    return reply(true);
  },

  // ---------- 希望 ----------
  // 希望は「日付」ごとに持つ（週の受付がまだ始まっていない先の週でも入れられる）
  // 2026年11月3日：希望は2か月先まで入れられるようにした
  // 入れられない週（ロック）：
  //   ・その週の締切（前の週の日曜24:00）をすぎた
  //   ・店長がその週の受付を締め切った／公開した

  /**
   * ある週の希望を読む（店長のシフト作成・ホームで使う）
   * ・店長 → 同じ店舗の全員分
   * ・店員 → 自分の分だけ（ほかの人の希望は見られない。要件で決定）
   */
  async listAvailabilities(periodId) {
    const data = load();
    const user = me(data);
    const period = data.periods.find((p) => p.id === periodId);
    if (!period) return reply([]);
    const dates = new Set(weekDates(period.weekStart));
    const storeMembers = new Set(data.members.filter((m) => canWorkAt(m, period.storeId)).map((m) => m.id));
    let list = data.availabilities.filter((a) => dates.has(a.date) && storeMembers.has(a.memberId));
    if (user.role !== "manager") list = list.filter((a) => a.memberId === user.id);
    return reply(list);
  },

  /** 自分の希望（from〜to の日付）。希望入力の画面で使う */
  async listMyAvailabilities(from, to) {
    const data = load();
    const user = me(data);
    return reply(data.availabilities.filter((a) => a.memberId === user.id && a.date >= from && a.date <= to));
  },

  /** その週に希望を入れられるか（入れられなければ理由の文字、入れられれば null） */
  async weekLock(weekStart) {
    return reply(lockReason(load(), weekStart));
  },

  /** 自分の希望を1週間分保存する（ロックされた週は保存できない） */
  async saveMyAvailabilities(weekStart, rows) {
    const data = load();
    const user = me(data);
    const reason = lockReason(data, weekStart);
    if (reason) return fail(reason);
    const dates = new Set(weekDates(weekStart));
    data.availabilities = data.availabilities.filter((a) => !(a.memberId === user.id && dates.has(a.date)));
    rows.forEach((r) => data.availabilities.push({ ...r, memberId: user.id }));
    save(data);
    return reply(true);
  },

  /** 店長が「特別許可」を出す（社員の3日目以降の休み） */
  async approveSpecialOff(periodId, memberId, date) {
    const data = load();
    requireManager(data);
    const a = data.availabilities.find((x) => x.memberId === memberId && x.date === date);
    if (a) a.kind = "off";
    save(data);
    return reply(true);
  },

  // ---------- 勤務（シフト） ----------

  /**
   * 勤務を読む
   * ・店長 → 自分の店舗の全部（下書きも）
   * ・店員 → 公開済みの週だけ
   */
  async listAssignments(periodId) {
    const data = load();
    const user = me(data);
    const period = data.periods.find((p) => p.id === periodId);
    if (user.role !== "manager" && period.status !== "published") return reply([]);
    return reply(data.assignments.filter((a) => a.periodId === periodId));
  },

  /**
   * 全店舗の勤務（日付の範囲）。店長だけ
   * 他の店舗に入っている時間と重ならないか確かめるのに使う
   */
  async listAssignmentsByDates(from, to) {
    const data = load();
    requireManager(data);
    return reply(data.assignments.filter((a) => a.date >= from && a.date <= to));
  },

  /** 自分の勤務（個人カレンダー用。応援先の店舗も含む） */
  async listMyAssignments() {
    const data = load();
    const user = me(data);
    const published = new Set(data.periods.filter((p) => p.status === "published").map((p) => p.id));
    return reply(data.assignments.filter((a) => a.memberId === user.id && published.has(a.periodId)));
  },

  /** 1週間分の勤務をまとめて保存（下書き） */
  async saveAssignments(periodId, rows) {
    const data = load();
    requireManager(data);
    const period = data.periods.find((p) => p.id === periodId);
    const before = data.assignments.filter((a) => a.periodId === periodId);
    data.assignments = data.assignments.filter((a) => a.periodId !== periodId);
    rows.forEach((r, i) => data.assignments.push({ ...r, id: r.id || `a${Date.now()}-${i}`, periodId, storeId: period.storeId }));
    // 公開したあとに変えた場合は、本人に知らせる（要件で決定）
    if (period.status === "published") notifyChanges(data, before, rows);
    save(data);
    return reply(true);
  },

  // ---------- お知らせ ----------

  async listNotifications() {
    const data = load();
    const user = me(data);
    return reply((data.notifications || []).filter((n) => n.memberId === user.id).reverse());
  },

  /** 公開した時：全員にお知らせ（本物ではプッシュ通知も送る） */
  async notifyPublished(periodId, weekLabel) {
    const data = load();
    requireManager(data);
    data.notifications = data.notifications || [];
    // その店舗で働ける人（2nd・3rd の人も）全員に知らせる
    data.members.filter((x) => canWorkAt(x, storeOf(data)) && x.active).forEach((x) => {
      data.notifications.push({ memberId: x.id, at: new Date().toISOString(), text: `${weekLabel}のシフトが公開されました` });
    });
    save(data);
    return reply(true);
  },

  // ---------- 開発用 ----------

  /** 見本データを最初の状態に戻す */
  async resetMock() {
    localStorage.removeItem(STORAGE_KEY);
    load();
    return reply(true);
  },
};

// ------------------------------------------------------------
// 内部で使う小さな関数
// ------------------------------------------------------------

/**
 * その週に希望を入れられない理由（入れられれば null）
 * 締切は「その週の前の日曜24:00」＝月曜になったら入れられない
 */
function lockReason(data, weekStart) {
  const user = me(data);
  const period = data.periods.find((p) => p.storeId === user.storeId && p.weekStart === weekStart);
  if (period && period.status !== "open") return "この週は受付が終わっています";
  if (today() > addDays(weekStart, -1)) return "この週は締切をすぎています";
  return null;
}

/** 営業時間がまだ決まっていない時の初期値（7:00〜22:00） */
function defaultHours() {
  const d = { open: 7 * 60, close: 22 * 60 };
  return { weekday: { ...d }, sat: { ...d }, sun: { ...d } };
}

/** 6桁の初回コードを作って保存する */
function issueCode(data, loginId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  data.loginCodes = (data.loginCodes || []).filter((c) => c.loginId !== loginId);
  data.loginCodes.push({ loginId, code, used: false });
  return code;
}

/** 公開後に変わった勤務を本人に知らせる */
function notifyChanges(data, before, after) {
  data.notifications = data.notifications || [];
  const key = (a) => `${a.memberId}|${a.date}`;
  const old = new Map(before.map((a) => [key(a), a]));
  const now = new Map(after.map((a) => [key(a), a]));
  const changed = new Set();
  for (const [k, a] of now) {
    const b = old.get(k);
    if (!b || b.from !== a.from || b.to !== a.to) changed.add(k);
  }
  for (const k of old.keys()) if (!now.has(k)) changed.add(k);
  for (const k of changed) {
    const [memberId, date] = k.split("|");
    data.notifications.push({ memberId, at: new Date().toISOString(), text: `${date} のシフトが変わりました` });
  }
}
