// ============================================================
// api/mock-api.js — 見本データで動く「にせもののサーバー」
// ------------------------------------------------------------
// このファイルは、見本データで動く「にせもののサーバー」のファイルです。
// ・本物（Supabase）と同じ名前・同じ形の関数を用意している
//   → api/index.js で切り替えるだけで本物になる
// ・データはこのブラウザの中（localStorage）に保存する
//   ※見本なので、ブラウザのデータを消すと元に戻る
// ・「店員はほかの人の希望を見られない」などの制限もここで再現する
//   （本物では Supabase の RLS＝データベース側の制限で守る。設計書7章）
// ============================================================

import {
  STORAGE_KEY, load, save, reply, fail, me, storeOf, companyStore, canWorkAt, rankAt, requireManager,
} from "./mock-store.js";
import { today, addDays, weekDates, label } from "../lib/date.js";
import { range } from "../lib/time.js";
import { CONFIG } from "../config.js";
import { callsApi } from "./mock-calls.js";   // 人が足りない時の自動連絡
import { aiApi } from "./mock-ai.js";         // AIの下書き・学び・人の追加

// ============================================================
// ここから下が「画面から呼ぶ関数」
// ============================================================

export const mockApi = {
  ...callsApi,
  ...aiApi,

  // ---------- ログイン ----------

  /** ID とパスワードでログイン */
  async login(loginId, password) {
    const data = load();   // 保存してあるデータを読む
    const user = data.members.find((x) => x.loginId === loginId && x.active);   // そのIDの人（働いている人だけ）
    if (!user || data.passwords[loginId] !== password) {
      return fail("IDかパスワードが違います");
    }
    data.session = { memberId: user.id, storeId: user.storeId };
    save(data);
    return reply(user);
  },

  /** ログアウト */
  async logout() {
    const data = load();   // 保存してあるデータを読む
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
    const data = load();   // 保存してあるデータを読む
    const user = data.members.find((x) => x.loginId === loginId);   // そのIDの人
    const codes = data.loginCodes || [];   // 出した初回コードの一覧
    const hit = codes.find((c) => c.loginId === loginId && c.code === code && !c.used);   // 合っていて、まだ使っていないコード
    if (!user || !hit) return fail("IDか初回コードが違います");
    if (!password || password.length < CONFIG.PASSWORD_MIN) return fail(`パスワードは${CONFIG.PASSWORD_MIN}文字以上にしてください`);
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

  // ---------- 店舗の管理（増やす・名前を変える・閉める）2026年11月4日 ----------
  // ・店舗は消さない（過去のシフトやカレンダーに店名が残るため）。閉めた店舗は「休止」にする
  // ・休止した店舗は、切り替えのボタン・行ける店舗の選択に出ない

  /**
   * 店舗を増やす（店長）
   * copyFrom に店舗のIDを入れると、その店舗の「営業時間・マップの人のマーク・必要人数」をそのまま写す
   * （2026年11月5日：4店舗め・5店舗めを足す時、最初から全部作らなくていいように）
   * copyFrom がなければ、マップは空、営業時間は 7:00〜22:00 で始まる
   * @param {{name:string, short:string, copyFrom?:string}} p
   */
  async createStore({ name, short, copyFrom }) {
    const data = load();   // 保存してあるデータを読む
    const boss = requireManager(data);   // 店長か確かめる（店長でなければ止まる）
    if (!name?.trim() || !short?.trim()) return fail("店舗名と短い名前を入れてください");
    if (data.stores.some((s) => s.name === name.trim())) return fail("同じ名前の店舗があります");
    if (data.stores.some((s) => s.short === short.trim())) return fail("同じ短い名前の店舗があります");
    const companyId = data.stores.find((s) => s.id === boss.storeId)?.companyId;   // 会社のID
    const store = { id: `s-${Date.now()}`, companyId, name: name.trim(), short: short.trim(), active: true };   // 新しい店舗
    data.stores.push(store);
    // 店長は会社の全部の店舗を見られるので、行ける店舗にも足す
    data.members.filter((m) => m.role === "manager").forEach((m) => {
      m.stores = m.stores || [{ storeId: m.storeId, rank: 1 }];
      m.stores.push({ storeId: store.id, rank: Math.max(...m.stores.map((x) => x.rank)) + 1 });
    });
    // ほかの店舗の設定を写す
    if (copyFrom && data.stores.some((s) => s.id === copyFrom)) copyStoreSettings(data, copyFrom, store.id);
    save(data);
    return reply(store);
  },

  /**
   * 何人かまとめて「この店舗にも行ける」にする（店長。店舗を増やした時に使う）
   * その人の行ける店舗の、いちばん後ろの順番（2nd・3rd…）に足す。メインは変えない
   * @param {string}   storeId   足す店舗
   * @param {string[]} memberIds 足す人
   */
  async addMembersToStore(storeId, memberIds) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    if (!data.stores.some((s) => s.id === storeId)) return fail("店舗が見つかりません");
    let n = 0;                                                    // 足した人数
    for (const id of memberIds) {
      const m = data.members.find((x) => x.id === id);   // その店員
      if (!m) continue;
      m.stores = m.stores?.length ? m.stores : [{ storeId: m.storeId, rank: 1 }];
      if (m.stores.some((x) => x.storeId === storeId)) continue;   // もう行ける
      m.stores.push({ storeId, rank: Math.max(...m.stores.map((x) => x.rank)) + 1 });
      n++;
    }
    save(data);
    return reply(n);
  },

  /** 店舗の名前を変える（店長）。過去のシフトにも新しい名前が出る */
  async updateStore(storeId, { name, short }) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = data.stores.find((s) => s.id === storeId);   // その店舗
    if (!store) return fail("店舗が見つかりません");
    if (!name?.trim() || !short?.trim()) return fail("店舗名と短い名前を入れてください");
    if (data.stores.some((s) => s.id !== storeId && s.name === name.trim())) return fail("同じ名前の店舗があります");
    store.name = name.trim();
    store.short = short.trim();
    save(data);
    return reply(store);
  },

  /** 店舗を休止する／再開する（店長）。データは消さない */
  async setStoreActive(storeId, active) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = data.stores.find((s) => s.id === storeId);   // その店舗
    if (!store) return fail("店舗が見つかりません");
    if (!active && data.stores.filter((s) => s.active !== false).length <= 1) return fail("最後の1店舗は休止できません");
    store.active = !!active;
    // 休止した店舗を見ていたら、ほかの店舗に切り替える
    if (!active && data.session.storeId === storeId) {
      data.session.storeId = data.stores.find((s) => s.active !== false).id;
    }
    save(data);
    return reply(store);
  },

  /** 今見ている店舗のID */
  async currentStoreId() {
    return reply(storeOf(load()));
  },

  /** 店舗を切り替える（店長だけ。ホームから） */
  async setCurrentStore(storeId) {
    const data = load();   // 保存してあるデータを読む
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
  async listMembers(storeId) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    if (!user) return fail("ログインしてください");
    // storeId を渡すと、その店舗（同じ会社の3店舗なら店員も見られる。公開シフト用）
    const store = companyStore(data, storeId);
    return reply(data.members
      .filter((x) => canWorkAt(x, store))
      .map((x) => ({ ...x, rankHere: rankAt(x, store) })));
  },

  /**
   * 店員を作る（店長）
   * 立場（社員／バイト／フル）とできること％は、ここで店長が決める
   * account:false の時は、アカウント（ログイン）はまだ作らない（シフト作成の「人を追加」から。2026年11月5日）
   *   → あとで店員管理の「アカウントを作る」で初回コードを出す
   * @returns {{member, code}} code＝本人に渡す初回コード（6桁。アカウントなしの時は null）
   */
  async createMember({ name, kind, skills, everyday, stores, account = true }) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    // ID は会社の中で一番大きい番号＋1
    const maxId = Math.max(...data.members.map((x) => Number(x.loginId)));
    // 行ける店舗：決めていなければ、今の店舗だけ（メイン）
    const list = stores?.length ? stores : [{ storeId: storeOf(data), rank: 1 }];
    const member = {   // 新しい店員
      id: `m${Date.now()}`,
      storeId: list.find((s) => s.rank === 1)?.storeId || list[0].storeId,
      stores: list,
      loginId: String(maxId + 1),
      name, role: "staff", kind, skills, everyday: !!everyday, active: true,
      account: account ? "invited" : "none",        // none＝まだアカウントなし / invited＝初回コードを出した
    };
    if (!name?.trim()) return fail("名前を入れてください");
    data.members.push(member);
    const code = account ? issueCode(data, member.loginId) : null;   // 初回コード（アカウントなしの時は null）
    save(data);
    return reply({ member, code });
  },

  /** 店員の情報を変える（店長） */
  async saveMember(member) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const i = data.members.findIndex((x) => x.id === member.id);   // その店員の場所（何番目か）
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
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const user = data.members.find((x) => x.id === memberId);   // その店員
    const code = issueCode(data, user.loginId);   // 新しい初回コード
    if (user.account === "none") user.account = "invited";      // アカウントなしの人に、はじめてコードを出した
    save(data);
    return reply({ loginId: user.loginId, code });
  },

  // ---------- 人ごとのルール（店長だけ） ----------

  async getMemberRule(memberId) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const rule = data.memberRules.find((x) => x.memberId === memberId);   // その人のルール
    return reply(rule ? rule.text : "");
  },

  /** 人ごとのルールの一覧（店長だけ） */
  async listMemberRules() {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    return reply(data.memberRules);
  },

  /** 人ごとのルールを保存する（店長だけ） */
  async saveMemberRule(memberId, text) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.memberRules = data.memberRules.filter((x) => x.memberId !== memberId);
    if (text.trim()) data.memberRules.push({ memberId, text: text.trim() });
    save(data);
    return reply(true);
  },

  // ---------- マップ・必要人数 ----------

  async listPositions() {
    const data = load();   // 保存してあるデータを読む
    return reply(data.positions.filter((x) => x.storeId === storeOf(data)));
  },

  /** マップの人のマークを保存する（店長） */
  async savePositions(positions) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = storeOf(data);   // 今見ている店舗
    const ids = new Set(positions.map((p) => p.id));   // 残すマークのID
    // 消したマークの必要人数も一緒に消す
    const mineBefore = new Set(data.positions.filter((p) => p.storeId === store).map((p) => p.id));
    data.requirements = data.requirements.filter((r) => !mineBefore.has(r.positionId) || ids.has(r.positionId));
    data.positions = data.positions.filter((p) => p.storeId !== store).concat(positions.map((p) => ({ ...p, storeId: store })));
    save(data);
    return reply(true);
  },

  /** 今の店舗の必要人数 */
  async listRequirements() {
    const data = load();   // 保存してあるデータを読む
    const mine = new Set(data.positions.filter((p) => p.storeId === storeOf(data)).map((p) => p.id));   // 今の店舗のマークのID
    return reply(data.requirements.filter((r) => mine.has(r.positionId)));
  },

  /** ある担当場所・日の種類の必要人数をまとめて入れ替える */
  async saveRequirements(positionId, dayType, rows) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.requirements = data.requirements.filter((r) => !(r.positionId === positionId && r.dayType === dayType));
    rows.forEach((r, i) => data.requirements.push({ id: `r${Date.now()}-${i}`, positionId, dayType, from: r.from, to: r.to, count: r.count }));
    save(data);
    return reply(true);
  },

  /** 祝日の一覧 */
  async listHolidays() {
    return reply(load().holidays || []);
  },

  // ---------- 営業時間（store_hours） ----------

  /**
   * 自分の店舗の営業時間
   * @returns {{weekday:{open,close}, sat:{open,close}, sun:{open,close}}}
   */
  async getStoreHours(storeId) {
    const data = load();   // 保存してあるデータを読む
    return reply((data.storeHours || {})[companyStore(data, storeId)] || defaultHours());
  },

  /** 営業時間を保存（店長） */
  async saveStoreHours(hours) {
    const data = load();   // 保存してあるデータを読む
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

  async listPeriods(storeId) {
    const data = load();   // 保存してあるデータを読む
    const store = companyStore(data, storeId);   // 見てよい店舗
    return reply(data.periods.filter((p) => p.storeId === store).sort((a, b) => a.weekStart.localeCompare(b.weekStart)));
  },

  /**
   * その週の受付がなければ作る（店長が先の週のシフトを作る時）
   * シフト作成の「次の週へ」で使う
   */
  async ensurePeriod(weekStart) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const store = storeOf(data);   // 今見ている店舗
    let p = data.periods.find((x) => x.storeId === store && x.weekStart === weekStart);   // その週の受付
    if (!p) {
      p = { id: `w-${store}-${weekStart}`, storeId: store, weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status: "open", note: "" };
      data.periods.push(p);
      save(data);
    }
    return reply(p);
  },

  /** 受付の状態を変える（open=受付中 / closed=締切 / published=公開） */
  async setPeriodStatus(periodId, status) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);   // その週
    p.status = status;
    if (status === "published") p.publishedAt = new Date().toISOString();
    save(data);
    return reply(p);
  },

  /** 連絡事項（その週）を保存する（店長） */
  async savePeriodNote(periodId, note) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const p = data.periods.find((x) => x.id === periodId);   // その週
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
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const period = data.periods.find((p) => p.id === periodId);   // その週
    if (!period) return reply([]);
    const dates = new Set(weekDates(period.weekStart));   // その週の日付
    // その店舗で働ける人＋この週だけ足した応援の人（guests）
    const storeMembers = new Set([...data.members.filter((m) => canWorkAt(m, period.storeId)).map((m) => m.id), ...(period.guests || [])]);
    let list = data.availabilities.filter((a) => dates.has(a.date) && storeMembers.has(a.memberId));   // その週の、その店舗の人の希望
    if (user.role !== "manager") list = list.filter((a) => a.memberId === user.id);
    return reply(list);
  },

  /** 自分の希望（from〜to の日付）。希望入力の画面で使う */
  async listMyAvailabilities(from, to) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    return reply(data.availabilities.filter((a) => a.memberId === user.id && a.date >= from && a.date <= to));
  },

  /** その週に希望を入れられるか（入れられなければ理由の文字、入れられれば null） */
  async weekLock(weekStart) {
    return reply(lockReason(load(), weekStart));
  },

  /** 自分の希望を1週間分保存する（ロックされた週は保存できない） */
  async saveMyAvailabilities(weekStart, rows) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const reason = lockReason(data, weekStart);   // 入れられない理由（入れられれば null）
    if (reason) return fail(reason);
    const dates = new Set(weekDates(weekStart));   // その週の日付
    data.availabilities = data.availabilities.filter((a) => !(a.memberId === user.id && dates.has(a.date)));
    rows.forEach((r) => data.availabilities.push({ ...r, memberId: user.id }));
    save(data);
    return reply(true);
  },

  /** 店長が「特別許可」を出す（社員の2日目の休み希望） */
  async approveSpecialOff(periodId, memberId, date) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const a = data.availabilities.find((x) => x.memberId === memberId && x.date === date);   // その人のその日の希望
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
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const period = data.periods.find((p) => p.id === periodId);   // その週
    if (user.role !== "manager" && period.status !== "published") return reply([]);
    return reply(data.assignments.filter((a) => a.periodId === periodId));
  },

  /**
   * 全店舗の勤務（日付の範囲）。店長だけ
   * 他の店舗に入っている時間と重ならないか確かめるのに使う
   */
  async listAssignmentsByDates(from, to, memberIds = null) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    // memberIds を渡すと、その人たちの分だけ（年の上限を数える時。2026年11月6日）
    return reply(data.assignments.filter((a) => a.date >= from && a.date <= to && (!memberIds || memberIds.includes(a.memberId))));
  },

  /** 自分の勤務（個人カレンダー用。応援先の店舗も含む） */
  async listMyAssignments() {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const published = new Set(data.periods.filter((p) => p.status === "published").map((p) => p.id));   // 公開済みの週のID
    return reply(data.assignments.filter((a) => a.memberId === user.id && published.has(a.periodId)));
  },

  /** 1週間分の勤務をまとめて保存（下書き） */
  async saveAssignments(periodId, rows) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const period = data.periods.find((p) => p.id === periodId);   // その週
    const before = data.assignments.filter((a) => a.periodId === periodId);   // 保存する前の勤務（公開後の変更を知らせるため）
    data.assignments = data.assignments.filter((a) => a.periodId !== periodId);
    rows.forEach((r, i) => data.assignments.push({ ...r, id: r.id || `a${Date.now()}-${i}`, periodId, storeId: period.storeId }));
    // 公開したあとに変えた場合は、本人に知らせる（要件で決定）
    if (period.status === "published") notifyChanges(data, before, rows);
    save(data);
    return reply(true);
  },

  // ---------- お知らせ ----------

  async listNotifications() {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    return reply((data.notifications || []).filter((n) => n.memberId === user.id).reverse());
  },

  /** 公開した時：全員にお知らせ（本物ではプッシュ通知も送る） */
  async notifyPublished(periodId, weekLabel) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.notifications = data.notifications || [];
    // その店舗で働ける人（2nd・3rd の人も）＋この週だけの応援の人、全員に知らせる
    const guests = new Set(data.periods.find((p) => p.id === periodId)?.guests || []);   // この週だけの応援
    data.members.filter((x) => (canWorkAt(x, storeOf(data)) || guests.has(x.id)) && x.active).forEach((x) => {
      data.notifications.push({ memberId: x.id, at: new Date().toISOString(), text: `${weekLabel}のシフトが公開されました` });
    });
    save(data);
    return reply(true);
  },

  /**
   * 希望をまだ出していない人に催促する（店長）
   * 「〇〇の週の希望をまだ出していません。締切は〜です」
   */
  async remindHopes(memberIds, text) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.notifications = data.notifications || [];
    memberIds.forEach((id) => data.notifications.push({ memberId: id, at: new Date().toISOString(), text }));
    save(data);
    return reply(memberIds.length);
  },

  // ---------- 公開シフトの「確認しました」（既読） ----------
  // 7shifts などにある「見たかどうか分かる」仕組み。店長は、まだ見ていない人が分かる

  /** 自分がその週のシフトを確認した（店員） */
  async confirmPeriod(periodId) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    data.confirms = (data.confirms || []).filter((c) => !(c.periodId === periodId && c.memberId === user.id));
    data.confirms.push({ periodId, memberId: user.id, at: new Date().toISOString() });
    save(data);
    return reply(true);
  },

  /** その週を確認した人の一覧（店長は全員分、店員は自分の分） */
  async listConfirms(periodId) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    let list = (data.confirms || []).filter((c) => c.periodId === periodId);   // その週の「確認しました」
    if (user.role !== "manager") list = list.filter((c) => c.memberId === user.id);
    return reply(list);
  },

  // ---------- シフト交代（Airシフト・7shifts の「シフト交代／シフトプール」） ----------
  // 流れ：本人が「交代をお願いする」→ 行ける人が「代わります」→ 店長が承認 → シフトが入れ替わる
  // status：open＝募集中 / taken＝代わる人がいて店長の承認待ち / approved＝承認 / rejected＝却下 / canceled＝取り下げ

  /** 自分の勤務の交代をお願いする（公開済みの、これからの勤務だけ） */
  async offerShift(assignmentId, note) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const a = data.assignments.find((x) => x.id === assignmentId);   // 交代したい勤務
    if (!a || a.memberId !== user.id) return fail("自分の勤務だけお願いできます");
    if (a.date < today()) return fail("終わった勤務はお願いできません");
    data.swaps = data.swaps || [];
    if (data.swaps.some((x) => x.assignmentId === assignmentId && ["open", "taken"].includes(x.status))) return fail("もうお願いしています");
    const swap = {   // 新しい交代のお願い
      id: `sw${Date.now()}`, assignmentId, storeId: a.storeId, date: a.date, from: a.from, to: a.to, area: a.area,
      fromMemberId: user.id, takerId: null, note: note || "", status: "open", createdAt: new Date().toISOString(),
    };
    data.swaps.push(swap);
    // その店舗で働ける人に知らせる
    data.notifications = data.notifications || [];
    data.members.filter((m) => m.id !== user.id && m.active && canWorkAt(m, a.storeId)).forEach((m) =>
      data.notifications.push({ memberId: m.id, at: new Date().toISOString(), text: `${label(a.date)} ${range(a.from, a.to)} の交代をさがしています（ホームから「代わります」）` }));
    save(data);
    return reply(swap);
  },

  /**
   * 交代の一覧
   * ・店員 → 自分が行ける店舗の「募集中」と、自分が出した・代わると言ったもの
   * ・店長 → 今の店舗の全部
   */
  async listSwaps() {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const list = (data.swaps || []).filter((x) => x.date >= today());   // 今日から先の交代のお願い
    /** IDから名前 */
    const nameOf = (id) => data.members.find((m) => m.id === id)?.name || "";
    /** 店舗のIDから短い名前 */
    const shortOf = (id) => data.stores.find((s) => s.id === id)?.short || "";
    /** 名前と店舗の短い名前をつける */
    const withNames = (x) => ({ ...x, fromName: nameOf(x.fromMemberId), takerName: nameOf(x.takerId), storeShort: shortOf(x.storeId) });
    if (user.role === "manager") return reply(list.filter((x) => x.storeId === storeOf(data)).map(withNames));
    return reply(list
      .filter((x) => x.fromMemberId === user.id || x.takerId === user.id || (x.status === "open" && canWorkAt(user, x.storeId)))
      .map(withNames));
  },

  /** 「代わります」（店員）。同じ時間にほかの勤務があれば代われない */
  async takeSwap(swapId) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const x = (data.swaps || []).find((s) => s.id === swapId);   // その交代のお願い
    if (!x || x.status !== "open") return fail("この交代はもう受け付けていません");
    if (x.fromMemberId === user.id) return fail("自分の勤務には代われません");
    const clash = data.assignments.some((a) => a.memberId === user.id && a.date === x.date && a.from < x.to && x.from < a.to);   // その時間に自分がもう入っているか
    if (clash) return fail("同じ時間にほかの勤務が入っています");
    x.status = "taken";
    x.takerId = user.id;
    data.notifications = data.notifications || [];
    data.members.filter((m) => m.role === "manager").forEach((m) =>
      data.notifications.push({ memberId: m.id, at: new Date().toISOString(), text: `${label(x.date)} ${range(x.from, x.to)} の交代：${user.name}さんが代わると言っています（承認待ち）` }));
    save(data);
    return reply(x);
  },

  /** お願いを取り下げる（本人） */
  async cancelSwap(swapId) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const x = (data.swaps || []).find((s) => s.id === swapId);   // その交代のお願い
    if (!x || x.fromMemberId !== user.id || !["open", "taken"].includes(x.status)) return fail("取り下げられません");
    x.status = "canceled";
    save(data);
    return reply(x);
  },

  /** 店長が承認／却下する。承認したら、その勤務の人を入れ替える */
  async decideSwap(swapId, approve) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const x = (data.swaps || []).find((s) => s.id === swapId);   // その交代のお願い
    if (!x || x.status !== "taken") return fail("承認待ちではありません");
    x.status = approve ? "approved" : "rejected";
    if (approve) {
      const a = data.assignments.find((y) => y.id === x.assignmentId);   // 入れ替える勤務
      if (a) a.memberId = x.takerId;
    }
    data.notifications = data.notifications || [];
    const text = approve ? `${label(x.date)} ${range(x.from, x.to)} の交代が決まりました` : `${label(x.date)} ${range(x.from, x.to)} の交代は店長が見送りました`;   // 本人へのお知らせの文
    [x.fromMemberId, x.takerId].forEach((id) => data.notifications.push({ memberId: id, at: new Date().toISOString(), text }));
    save(data);
    return reply(x);
  },

  // ---------- 時給・交通費（店長だけ。人件費の目安に使う。member_private） ----------

  async listWages() {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    return reply(data.wages || []);
  },

  /**
   * 時給・交通費と、働き方のルールを保存する（店長だけ）
   * @param {object} [extra] 働き方のルール {minor:18歳未満か, monthHoursMax:月の上限時間, yearYenMax:年の上限金額}
   */
  async saveWage(memberId, hourly, transport, extra = {}) {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    data.wages = (data.wages || []).filter((w) => w.memberId !== memberId);
    data.wages.push({
      memberId, hourly: Number(hourly) || 0, transport: Number(transport) || 0,
      minor: !!extra.minor,                                         // 18歳未満か
      monthHoursMax: Number(extra.monthHoursMax) || null,           // 月の上限時間（0や空＝決めない）
      yearYenMax: Number(extra.yearYenMax) || null,                 // 年の上限金額（0や空＝決めない）
    });
    save(data);
    return reply(true);
  },

  // ---------- プッシュ通知の宛先（2026年11月6日） ----------
  // 見本データでは通知は送らない。形だけ本物とそろえる

  /** このスマホの宛先を保存する */
  async savePushSubscription(sub) {
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    data.pushSubs = (data.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint);
    data.pushSubs.push({ endpoint: sub.endpoint, memberId: user.id });
    save(data);
    return reply(true);
  },

  /** このスマホの宛先を消す */
  async deletePushSubscription(endpoint) {
    const data = load();   // 保存してあるデータを読む
    data.pushSubs = (data.pushSubs || []).filter((x) => x.endpoint !== endpoint);
    save(data);
    return reply(true);
  },

  // ---------- バックアップ（2026年11月6日） ----------

  /** 全部のデータを1つにまとめる（店長）。パスワード・初回コード・ログインの情報は入れない */
  async exportAll() {
    const data = load();   // 保存してあるデータを読む
    requireManager(data);
    const { passwords, loginCodes, session, ...tables } = data;   // 書き出さないもの を外す
    return reply({ app: "shiftapp", kind: "mock", exportedAt: new Date().toISOString(), tables });
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
  const user = me(data);   // ログイン中の人
  const period = data.periods.find((p) => p.storeId === user.storeId && p.weekStart === weekStart);   // その週の受付
  if (period && period.status !== "open") return "この週は受付が終わっています";
  if (today() > addDays(weekStart, -1)) return "この週は締切をすぎています";
  return null;
}

/**
 * 店舗の設定を写す（店舗を増やす時）
 * 営業時間・マップの人のマーク・必要人数を、新しいIDにしてコピーする
 */
function copyStoreSettings(data, fromId, toId) {
  const stamp = Date.now();                                  // 新しいIDに使う数字
  const idMap = new Map();                                   // 元のマークのID → 新しいマークのID
  data.positions.filter((p) => p.storeId === fromId).forEach((p, i) => {
    const id = `p-${toId}-${stamp}-${i}`;   // 新しいマークのID
    idMap.set(p.id, id);
    data.positions.push({ ...p, id, storeId: toId });
  });
  data.requirements.filter((r) => idMap.has(r.positionId)).forEach((r, i) => {
    data.requirements.push({ ...r, id: `r-${stamp}-${i}`, positionId: idMap.get(r.positionId) });
  });
  data.storeHours = data.storeHours || {};
  data.storeHours[toId] = JSON.parse(JSON.stringify(data.storeHours[fromId] || defaultHours()));
}

/** 営業時間がまだ決まっていない時の初期値（7:00〜22:00） */
function defaultHours() {
  const d = { open: 7 * 60, close: 22 * 60 };   // 7:00〜22:00
  return { weekday: { ...d }, sat: { ...d }, sun: { ...d } };
}

/** 6桁の初回コードを作って保存する */
function issueCode(data, loginId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));   // 6桁の数字
  data.loginCodes = (data.loginCodes || []).filter((c) => c.loginId !== loginId);
  data.loginCodes.push({ loginId, code, used: false });
  return code;
}

/** 公開後に変わった勤務を本人に知らせる */
function notifyChanges(data, before, after) {
  data.notifications = data.notifications || [];
  /** 人と日のキー */
  const key = (a) => `${a.memberId}|${a.date}`;
  const old = new Map(before.map((a) => [key(a), a]));   // 前：人と日 → 勤務
  const now = new Map(after.map((a) => [key(a), a]));   // 後：人と日 → 勤務
  const changed = new Set();   // 変わった人と日
  for (const [k, a] of now) {
    const b = old.get(k);   // 前の勤務
    if (!b || b.from !== a.from || b.to !== a.to) changed.add(k);
  }
  for (const k of old.keys()) if (!now.has(k)) changed.add(k);
  for (const k of changed) {
    const [memberId, date] = k.split("|");   // 人のIDと日付
    data.notifications.push({ memberId, at: new Date().toISOString(), text: `${label(date)} のシフトが変わりました` });
  }
}
