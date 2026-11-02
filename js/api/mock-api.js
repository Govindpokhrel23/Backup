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

const STORAGE_KEY = "shiftapp-mock-v1";

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
    data.session = { memberId: user.id };
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
    data.session = { memberId: user.id };
    save(data);
    return reply(user);
  },

  // ---------- 店舗・店員 ----------

  async listStores() {
    return reply(load().stores);
  },

  /** 同じ店舗の店員の一覧 */
  async listMembers() {
    const data = load();
    const user = me(data);
    if (!user) return fail("ログインしてください");
    return reply(data.members.filter((x) => x.storeId === user.storeId));
  },

  /**
   * 店員を作る（店長）
   * 立場（社員／バイト／フル）とできること％は、ここで店長が決める
   * @returns {{member, code}} code＝本人に渡す初回コード（6桁）
   */
  async createMember({ name, kind, skills, everyday }) {
    const data = load();
    const boss = requireManager(data);
    // ID は店舗の中で一番大きい番号＋1
    const maxId = Math.max(...data.members.map((x) => Number(x.loginId)));
    const member = {
      id: `m${Date.now()}`,
      storeId: boss.storeId,
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
    data.members[i] = { ...data.members[i], ...member };
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
    const user = me(data);
    return reply(data.positions.filter((x) => x.storeId === user.storeId));
  },

  async savePositions(positions) {
    const data = load();
    const boss = requireManager(data);
    const ids = new Set(positions.map((p) => p.id));
    // 消したマークの必要人数も一緒に消す
    const mineBefore = new Set(data.positions.filter((p) => p.storeId === boss.storeId).map((p) => p.id));
    data.requirements = data.requirements.filter((r) => !mineBefore.has(r.positionId) || ids.has(r.positionId));
    data.positions = data.positions.filter((p) => p.storeId !== boss.storeId).concat(positions.map((p) => ({ ...p, storeId: boss.storeId })));
    save(data);
    return reply(true);
  },

  async listRequirements() {
    const data = load();
    const user = me(data);
    const mine = new Set(data.positions.filter((p) => p.storeId === user.storeId).map((p) => p.id));
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

  // ---------- 受付（週） ----------

  async listPeriods() {
    const data = load();
    const user = me(data);
    return reply(data.periods.filter((p) => p.storeId === user.storeId).sort((a, b) => a.weekStart.localeCompare(b.weekStart)));
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

  // ---------- 希望 ----------

  /**
   * 希望を読む
   * ・店長 → 同じ店舗の全員分
   * ・店員 → 自分の分だけ（ほかの人の希望は見られない。要件で決定）
   */
  async listAvailabilities(periodId) {
    const data = load();
    const user = me(data);
    let list = data.availabilities.filter((a) => a.periodId === periodId);
    if (user.role !== "manager") list = list.filter((a) => a.memberId === user.id);
    return reply(list);
  },

  /** 自分の希望を保存（受付中だけ） */
  async saveMyAvailabilities(periodId, rows) {
    const data = load();
    const user = me(data);
    const period = data.periods.find((p) => p.id === periodId);
    if (!period || period.status !== "open") return fail("受付は終わっています");
    data.availabilities = data.availabilities.filter((a) => !(a.periodId === periodId && a.memberId === user.id));
    rows.forEach((r) => data.availabilities.push({ ...r, periodId, memberId: user.id }));
    save(data);
    return reply(true);
  },

  /** 店長が「特別許可」を出す（社員の3日目以降の休み） */
  async approveSpecialOff(periodId, memberId, date) {
    const data = load();
    requireManager(data);
    const a = data.availabilities.find((x) => x.periodId === periodId && x.memberId === memberId && x.date === date);
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
    const boss = requireManager(data);
    data.notifications = data.notifications || [];
    data.members.filter((x) => x.storeId === boss.storeId && x.active).forEach((x) => {
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
