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

import {   // 見本データの道具を読む
  STORAGE_KEY, load, save, reply, fail, me, storeOf, companyStore, canWorkAt, rankAt, requireManager,   // 保存・返事・ログイン・店舗・店長チェックなど
} from "./mock-store.js";   // 読む元
import { today, addDays, weekDates, label } from "../lib/date.js";   // 日付の道具を読む
import { range } from "../lib/time.js";   // 時間の表示の道具を読む
import { checkStoreHours } from "../lib/store-hours.js";   // 営業時間が正しいか確かめる道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { callsApi } from "./mock-calls.js";   // 人が足りない時の自動連絡
import { aiApi } from "./mock-ai.js";         // AIの下書き・学び・人の追加

// ============================================================
// ここから下が「画面から呼ぶ関数」
// ============================================================

export const mockApi = {   // テスト版の窓口（Supabase 版と同じ関数がある）
  ...callsApi,   // 人が足りない時の連絡
  ...aiApi,   // AI

  // ---------- ログイン ----------

  /** ID とパスワードでログイン */
  async login(loginId, password) {   // ログインする関数
    const data = load();   // 保存してあるデータを読む
    const user = data.members.find((member) => member.loginId === loginId && member.active);   // そのIDの人（働いている人だけ）
    if (!user || data.passwords[loginId] !== password) {   // いない・パスワードがちがえば
      return fail("IDかパスワードが違います");   // エラー
    }
    data.session = { memberId: user.id, storeId: user.storeId };   // ログインした状態にする
    save(data);   // 保存
    return reply(user);   // ログインした人を返す
  },

  /** ログアウト */
  async logout() {   // ログアウトする関数
    const data = load();   // 保存してあるデータを読む
    data.session = null;   // ログインをやめる
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 今ログインしている人（ログインを保持しているので、開き直しても残る） */
  async currentUser() {   // ログイン中の人を出す関数
    return reply(me(load()));   // 自分を返す
  },

  /**
   * はじめての人：店長からもらった ID と初回コードで、パスワードを決める
   * （本物では Cloudflare Workers が確認する。設計書5章）
   */
  async activate(loginId, code, password) {   // 初回コードでパスワードを決める関数
    const data = load();   // 保存してあるデータを読む
    const user = data.members.find((member) => member.loginId === loginId);   // そのIDの人
    const codes = data.loginCodes || [];   // 出した初回コードの一覧
    const hit = codes.find((member) => member.loginId === loginId && member.code === code && !member.used);   // 合っていて、まだ使っていないコード
    if (!user || !hit) return fail("IDか初回コードが違います");   // いない・コードがちがえば
    if (!password || password.length < CONFIG.PASSWORD_MIN) return fail(`パスワードは${CONFIG.PASSWORD_MIN}文字以上にしてください`);   // 短すぎれば
    hit.used = true;   // 使用済みにする
    data.passwords[loginId] = password;   // パスワードを保存
    data.session = { memberId: user.id, storeId: user.storeId };   // ログインした状態にする
    save(data);   // 保存
    return reply(user);   // ログインした人を返す
  },

  // ---------- 店舗・店員 ----------

  async listStores() {   // 店舗の一覧を出す関数
    return reply(load().stores);   // 返す
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
  async createStore({ name, short, copyFrom }) {   // 店舗を作る関数
    const data = load();   // 保存してあるデータを読む
    const boss = requireManager(data);   // 店長か確かめる（店長でなければ止まる）
    if (!name?.trim() || !short?.trim()) return fail("店舗名と短い名前を入れてください");   // 名前がなければ止める
    if (data.stores.some((store) => store.name === name.trim())) return fail("同じ名前の店舗があります");   // 同じ名前なら止める
    if (data.stores.some((store) => store.short === short.trim())) return fail("同じ短い名前の店舗があります");   // 同じ短い名前なら止める
    const companyId = data.stores.find((store) => store.id === boss.storeId)?.companyId;   // 会社のID
    const store = { id: `s-${Date.now()}`, companyId, name: name.trim(), short: short.trim(), active: true };   // 新しい店舗
    data.stores.push(store);   // 足す
    // 店長は会社の全部の店舗を見られるので、行ける店舗にも足す
    data.members.filter((member) => member.role === "manager").forEach((member) => {   // 店長たちに
      member.stores = member.stores || [{ storeId: member.storeId, rank: 1 }];   // 働ける店舗の一覧がなければ作る
      member.stores.push({ storeId: store.id, rank: Math.max(...member.stores.map((storeRank) => storeRank.rank)) + 1 });   // 一番下の順位で足す
    });
    // ほかの店舗の設定を写す
    if (copyFrom && data.stores.some((store) => store.id === copyFrom)) copyStoreSettings(data, copyFrom, store.id);   // コピー元があれば設定を写す
    save(data);   // 保存
    return reply(store);   // 作った店舗を返す
  },

  /**
   * 何人かまとめて「この店舗にも行ける」にする（店長。店舗を増やした時に使う）
   * その人の行ける店舗の、いちばん後ろの順番（2nd・3rd…）に足す。メインは変えない
   * @param {string}   storeId   足す店舗
   * @param {string[]} memberIds 足す人
   */
  async addMembersToStore(storeId, memberIds) {   // 店員をその店舗で働けるようにする関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    if (!data.stores.some((store) => store.id === storeId)) return fail("店舗が見つかりません");   // 店舗がなければ止める
    let count = 0;                                                    // 足した人数
    for (const id of memberIds) {   // 選んだ人ごとに
      const member = data.members.find((member) => member.id === id);   // その店員
      if (!member) continue;   // いなければ飛ばす
      member.stores = member.stores?.length ? member.stores : [{ storeId: member.storeId, rank: 1 }];   // 働ける店舗の一覧がなければ作る
      if (member.stores.some((store) => store.storeId === storeId)) continue;   // もう行ける
      member.stores.push({ storeId, rank: Math.max(...member.stores.map((storeRank) => storeRank.rank)) + 1 });   // 一番下の順位で足す
      count++;   // 数える
    }
    save(data);   // 保存
    return reply(count);   // 足した人数を返す
  },

  /** 店舗の名前を変える（店長）。過去のシフトにも新しい名前が出る */
  async updateStore(storeId, { name, short }) {   // 店舗の名前を変える関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = data.stores.find((store) => store.id === storeId);   // その店舗
    if (!store) return fail("店舗が見つかりません");   // なければ止める
    if (!name?.trim() || !short?.trim()) return fail("店舗名と短い名前を入れてください");   // 名前がなければ止める
    if (data.stores.some((store) => store.id !== storeId && store.name === name.trim())) return fail("同じ名前の店舗があります");   // 同じ名前なら止める
    store.name = name.trim();   // 名前
    store.short = short.trim();   // 短い名前
    save(data);   // 保存
    return reply(store);   // 変えた店舗を返す
  },

  /** 店舗を休止する／再開する（店長）。データは消さない */
  async setStoreActive(storeId, active) {   // 店舗を休止・再開する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = data.stores.find((store) => store.id === storeId);   // その店舗
    if (!store) return fail("店舗が見つかりません");   // なければ止める
    if (!active && data.stores.filter((store) => store.active !== false).length <= 1) return fail("最後の1店舗は休止できません");   // 最後の1店舗は休止できない
    store.active = !!active;   // 変える
    // 休止した店舗を見ていたら、ほかの店舗に切り替える
    if (!active && data.session.storeId === storeId) {   // 今の店舗を休止したら
      data.session.storeId = data.stores.find((store) => store.active !== false).id;   // ほかの店舗に切りかえる
    }
    save(data);   // 保存
    return reply(store);   // 変えた店舗を返す
  },

  /** 今見ている店舗のID */
  async currentStoreId() {   // 今の店舗を出す関数
    return reply(storeOf(load()));   // 返す
  },

  /** 店舗を切り替える（店長だけ。ホームから） */
  async setCurrentStore(storeId) {   // 店舗を切りかえる関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    if (!data.stores.some((store) => store.id === storeId)) return fail("店舗が見つかりません");   // なければ止める
    data.session.storeId = storeId;   // 切りかえる
    save(data);   // 保存
    return reply(storeId);   // 店舗IDを返す
  },

  /**
   * 今の店舗で働ける店員の一覧
   * メイン（rank 1）の人に加えて、2nd・3rd でこの店舗に行ける人も入る
   * 返す時に「この店舗での順番」を rankHere につける
   */
  async listMembers(storeId) {   // その店舗で働ける店員を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    if (!user) return fail("ログインしてください");   // ログインしていなければ止める
    // storeId を渡すと、その店舗（同じ会社の3店舗なら店員も見られる。公開シフト用）
    const store = companyStore(data, storeId);   // 同じ会社の店舗か確かめる
    return reply(data.members   // 返す
      .filter((member) => canWorkAt(member, store))   // 働ける人だけ
      .map((member) => ({ ...member, rankHere: rankAt(member, store) })));   // その店での順位も付ける
  },

  /**
   * 店員を作る（店長）
   * 立場（社員／バイト／フル）とできること％は、ここで店長が決める
   * account:false の時は、アカウント（ログイン）はまだ作らない（シフト作成の「人を追加」から。2026年11月5日）
   *   → あとで店員管理の「アカウントを作る」で初回コードを出す
   * @returns {{member, code}} code＝本人に渡す初回コード（6桁。アカウントなしの時は null）
   */
  async createMember({ name, kind, skills, everyday, stores, account = true }) {   // 店員を作る関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    // ID は会社の中で一番大きい番号＋1
    const maxId = Math.max(...data.members.map((member) => Number(member.loginId)));   // 一番大きいログインID
    // 行ける店舗：決めていなければ、今の店舗だけ（メイン）
    const list = stores?.length ? stores : [{ storeId: storeOf(data), rank: 1 }];   // 働ける店舗（なければ今の店舗）
    const member = {   // 新しい店員
      id: `m${Date.now()}`,   // ID
      storeId: list.find((storeRank) => storeRank.rank === 1)?.storeId || list[0].storeId,   // 所属店（順位1の店）
      stores: list,   // 働ける店舗
      loginId: String(maxId + 1),   // 次のログインID
      name, role: "staff", kind, skills, everyday: !!everyday, active: true,   // 名前・役割・立場・できること・毎日・使う
      account: account ? "invited" : "none",        // none＝まだアカウントなし / invited＝初回コードを出した
    };
    if (!name?.trim()) return fail("名前を入れてください");   // 名前がなければ止める
    data.members.push(member);   // 足す
    const code = account ? issueCode(data, member.loginId) : null;   // 初回コード（アカウントなしの時は null）
    save(data);   // 保存
    return reply({ member, code });   // 店員と初回コードを返す
  },

  /** 店員の情報を変える（店長） */
  async saveMember(member) {   // 店員を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const index = data.members.findIndex((eachMember) => eachMember.id === member.id);   // その店員の場所（何番目か）
    if (index < 0) return fail("店員が見つかりません");   // いなければ止める
    const { rankHere, ...clean } = member;          // 画面用の rankHere は保存しない
    data.members[index] = { ...data.members[index], ...clean };   // 上書き
    // メインの店舗（rank 1）を storeId にもそろえる
    const main = data.members[index].stores?.find((storeRank) => storeRank.rank === 1);   // 順位1の店
    if (main) data.members[index].storeId = main.storeId;   // 所属店にする
    save(data);   // 保存
    return reply(data.members[index]);   // 返す
  },

  /** パスワードを忘れた時：新しい初回コードを出す（店長） */
  async resetPassword(memberId) {   // パスワードを作り直す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const user = data.members.find((member) => member.id === memberId);   // その店員
    const code = issueCode(data, user.loginId);   // 新しい初回コード
    if (user.account === "none") user.account = "invited";      // アカウントなしの人に、はじめてコードを出した
    save(data);   // 保存
    return reply({ loginId: user.loginId, code });   // IDとコードを返す
  },

  // ---------- 人ごとのルール（店長だけ） ----------

  async getMemberRule(memberId) {   // その人のメモを読む関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const rule = data.memberRules.find((memberRule) => memberRule.memberId === memberId);   // その人のルール
    return reply(rule ? rule.text : "");   // メモを返す（なければ空）
  },

  /** 人ごとのルールの一覧（店長だけ） */
  async listMemberRules() {   // 全員のメモを読む関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    return reply(data.memberRules);   // 返す
  },

  /** 人ごとのルールを保存する（店長だけ） */
  async saveMemberRule(memberId, text) {   // メモを保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.memberRules = data.memberRules.filter((memberRule) => memberRule.memberId !== memberId);   // 前のメモを消す
    if (text.trim()) data.memberRules.push({ memberId, text: text.trim() });   // あれば足す
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- マップ・必要人数 ----------

  async listPositions() {   // 場所の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    return reply(data.positions.filter((position) => position.storeId === storeOf(data)));   // 今の店舗の分
  },

  /** マップの人のマークを保存する（店長） */
  async savePositions(positions) {   // 場所の一覧を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = storeOf(data);   // 今見ている店舗
    const ids = new Set(positions.map((position) => position.id));   // 残すマークのID
    // 消したマークの必要人数も一緒に消す
    const mineBefore = new Set(data.positions.filter((position) => position.storeId === store).map((position) => position.id));   // 前の場所のID
    data.requirements = data.requirements.filter((req) => !mineBefore.has(req.positionId) || ids.has(req.positionId));   // 消えた場所の必要人数を消す
    data.positions = data.positions.filter((position) => position.storeId !== store).concat(positions.map((position) => ({ ...position, storeId: store })));   // 今の店舗の分を入れかえる
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 今の店舗の必要人数 */
  async listRequirements() {   // 必要人数の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    const mine = new Set(data.positions.filter((position) => position.storeId === storeOf(data)).map((position) => position.id));   // 今の店舗のマークのID
    return reply(data.requirements.filter((req) => mine.has(req.positionId)));   // 今の店舗の場所の分
  },

  /** ある担当場所・日の種類の必要人数をまとめて入れ替える */
  async saveRequirements(positionId, dayType, rows) {   // 必要人数を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.requirements = data.requirements.filter((req) => !(req.positionId === positionId && req.dayType === dayType));   // その場所・その日の種類の分を消す
    rows.forEach((row, index) => data.requirements.push({ id: `r${Date.now()}-${index}`, positionId, dayType, from: row.from, to: row.to, count: row.count }));   // 新しく入れる
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 祝日の一覧 */
  async listHolidays() {   // 祝日の一覧を出す関数
    return reply(load().holidays || []);   // 返す
  },

  // ---------- 営業時間（store_hours） ----------

  /**
   * 自分の店舗の営業時間
   * @returns {{weekday:{open,close}, sat:{open,close}, sun:{open,close}}}
   */
  async getStoreHours(storeId) {   // 営業時間を出す関数
    const data = load();   // 保存してあるデータを読む
    return reply((data.storeHours || {})[companyStore(data, storeId)] || defaultHours());   // 保存があればそれ、なければはじめの時間
  },

  /** 営業時間を保存（店長）。休み・時間の変更（special）もいっしょに。storeId がなければ今の店舗 */
  async saveStoreHours(hours, storeId) {   // 営業時間を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const why = checkStoreHours(hours);   // 正しいか確かめる
    if (why) return fail(why);   // おかしければ止める
    data.storeHours = data.storeHours || {};   // 入れ物がなければ作る
    data.storeHours[companyStore(data, storeId)] = hours;   // その店舗の分を変える（同じ会社の店舗か確かめる）
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- 受付（週） ----------

  async listPeriods(storeId) {   // 週の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    const store = companyStore(data, storeId);   // 見てよい店舗
    return reply(data.periods.filter((period) => period.storeId === store).sort((periodA, periodB) => periodA.weekStart.localeCompare(periodB.weekStart)));   // その店舗の週を古い順に
  },

  /**
   * その週の受付がなければ作る（店長が先の週のシフトを作る時）
   * シフト作成の「次の週へ」で使う
   */
  async ensurePeriod(weekStart) {   // 週を用意する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const store = storeOf(data);   // 今見ている店舗
    let period = data.periods.find((period) => period.storeId === store && period.weekStart === weekStart);   // その週の受付
    if (!period) {   // なければ
      period = { id: `w-${store}-${weekStart}`, storeId: store, weekStart, deadline: `${addDays(weekStart, -1)}T24:00`, status: "open", note: "" };   // 作る（締切は前の日の24時）
      data.periods.push(period);   // 足す
      save(data);   // 保存
    }
    return reply(period);   // 週を返す
  },

  /** 受付の状態を変える（open=受付中 / closed=締切 / published=公開） */
  async setPeriodStatus(periodId, status) {   // 週の状態を変える関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const period = data.periods.find((period) => period.id === periodId);   // その週
    period.status = status;   // 状態
    if (status === "published") period.publishedAt = new Date().toISOString();   // 公開なら時間を覚える
    save(data);   // 保存
    return reply(period);   // 週を返す
  },

  /** 連絡事項（その週）を保存する（店長） */
  async savePeriodNote(periodId, note) {   // 連絡事項を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const period = data.periods.find((period) => period.id === periodId);   // その週
    period.note = note;   // 連絡事項
    save(data);   // 保存
    return reply(true);   // できた
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
  async listAvailabilities(periodId) {   // 週の希望の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const period = data.periods.find((period) => period.id === periodId);   // その週
    if (!period) return reply([]);   // 週がなければ空
    const dates = new Set(weekDates(period.weekStart));   // その週の日付
    // その店舗で働ける人＋この週だけ足した応援の人（guests）
    const storeMembers = new Set([...data.members.filter((member) => canWorkAt(member, period.storeId)).map((member) => member.id), ...(period.guests || [])]);   // この店舗で働ける人と、この週だけ足した人
    let list = data.availabilities.filter((hope) => dates.has(hope.date) && storeMembers.has(hope.memberId));   // その週の、その店舗の人の希望
    if (user.role !== "manager") list = list.filter((hope) => hope.memberId === user.id);   // 店員なら自分の分だけ
    return reply(list);   // 返す
  },

  /** 自分の希望（from〜to の日付）。希望入力の画面で使う */
  async listMyAvailabilities(from, to) {   // 自分の希望を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    return reply(data.availabilities.filter((hope) => hope.memberId === user.id && hope.date >= from && hope.date <= to));   // 自分の分で日付のはばの中
  },

  /** その週に希望を入れられるか（入れられなければ理由の文字、入れられれば null） */
  async weekLock(weekStart) {   // 希望を出せない理由を出す関数
    return reply(lockReason(load(), weekStart));   // 理由（出せるなら null）
  },

  /** 自分の希望を1週間分保存する（ロックされた週は保存できない） */
  async saveMyAvailabilities(weekStart, rows) {   // 自分の希望を保存する関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const reason = lockReason(data, weekStart);   // 入れられない理由（入れられれば null）
    if (reason) return fail(reason);   // 出せなければ止める
    const dates = new Set(weekDates(weekStart));   // その週の日付
    data.availabilities = data.availabilities.filter((hope) => !(hope.memberId === user.id && dates.has(hope.date)));   // その週の自分の希望を消す
    rows.forEach((row) => data.availabilities.push({ ...row, memberId: user.id }));   // 新しく入れる
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 店長が「特別許可」を出す（社員の2日目の休み希望） */
  async approveSpecialOff(periodId, memberId, date) {   // 特別許可を出す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const hope = data.availabilities.find((hope) => hope.memberId === memberId && hope.date === date);   // その人のその日の希望
    if (hope) hope.kind = "off";   // 休み希望にする
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- 勤務（シフト） ----------

  /**
   * 勤務を読む
   * ・店長 → 自分の店舗の全部（下書きも）
   * ・店員 → 公開済みの週だけ
   */
  async listAssignments(periodId) {   // 週の勤務を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const period = data.periods.find((period) => period.id === periodId);   // その週
    if (user.role !== "manager" && period.status !== "published") return reply([]);   // 店員は公開前なら見えない
    return reply(data.assignments.filter((shift) => shift.periodId === periodId));   // その週の勤務
  },

  /**
   * 全店舗の勤務（日付の範囲）。店長だけ
   * 他の店舗に入っている時間と重ならないか確かめるのに使う
   */
  async listAssignmentsByDates(from, to, memberIds = null) {   // 日付のはばで勤務を出す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    // memberIds を渡すと、その人たちの分だけ（年の上限を数える時。2026年11月6日）
    return reply(data.assignments.filter((shift) => shift.date >= from && shift.date <= to && (!memberIds || memberIds.includes(shift.memberId))));   // 日付と人でしぼる
  },

  /** 自分の勤務（個人カレンダー用。応援先の店舗も含む） */
  async listMyAssignments() {   // 自分の勤務を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    const published = new Set(data.periods.filter((period) => period.status === "published").map((period) => period.id));   // 公開済みの週のID
    return reply(data.assignments.filter((shift) => shift.memberId === user.id && published.has(shift.periodId)));   // 自分の、公開した週の分
  },

  /** 1週間分の勤務をまとめて保存（下書き） */
  async saveAssignments(periodId, rows) {   // 週の勤務を保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const period = data.periods.find((period) => period.id === periodId);   // その週
    const before = data.assignments.filter((shift) => shift.periodId === periodId);   // 保存する前の勤務（公開後の変更を知らせるため）
    data.assignments = data.assignments.filter((shift) => shift.periodId !== periodId);   // その週の勤務を消して
    rows.forEach((row, index) => data.assignments.push({ ...row, id: row.id || `a${Date.now()}-${index}`, periodId, storeId: period.storeId }));   // 新しく入れる（IDがなければ作る）
    // 知らせは送らない（「変更を公開」を押した時だけ notifyShiftChanges で送る。2026年11月15日）
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** 公開したシフトを直して「変更を公開」した時、変わった人だけに知らせる */
  async notifyShiftChanges(before, after) {   // 変わった人に知らせる関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const count = notifyChanges(data, before, after);   // 知らせる
    save(data);   // 保存
    return reply(count);   // 変わった数
  },

  // ---------- お知らせ ----------

  async listNotifications() {   // 自分のお知らせを出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    return reply((data.notifications || []).filter((note) => note.memberId === user.id).reverse());   // 新しい順
  },

  /** 公開した時：全員にお知らせ（本物ではプッシュ通知も送る） */
  async notifyPublished(periodId, weekLabel) {   // 公開したことを知らせる関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.notifications = data.notifications || [];   // 入れ物がなければ作る
    // その店舗で働ける人（2nd・3rd の人も）＋この週だけの応援の人、全員に知らせる
    const guests = new Set(data.periods.find((period) => period.id === periodId)?.guests || []);   // この週だけの応援
    data.members.filter((member) => (canWorkAt(member, storeOf(data)) || guests.has(member.id)) && member.active).forEach((member) => {   // この店舗で働ける人と足した人で、休止していない人
      data.notifications.push({ memberId: member.id, at: new Date().toISOString(), text: `${weekLabel}のシフトが公開されました` });   // お知らせを足す
    });
    save(data);   // 保存
    return reply(true);   // できた
  },

  /**
   * 希望をまだ出していない人に催促する（店長）
   * 「〇〇の週の希望をまだ出していません。締切は〜です」
   */
  async remindHopes(memberIds, text) {   // 希望を出してと知らせる関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.notifications = data.notifications || [];   // 入れ物がなければ作る
    memberIds.forEach((id) => data.notifications.push({ memberId: id, at: new Date().toISOString(), text }));   // 1人ずつ足す
    save(data);   // 保存
    return reply(memberIds.length);   // 知らせた人数を返す
  },

  // ---------- 公開シフトの「確認しました」（既読） ----------
  // 7shifts などにある「見たかどうか分かる」仕組み。店長は、まだ見ていない人が分かる

  /** 自分がその週のシフトを確認した（店員） */
  async confirmPeriod(periodId) {   // 「見ました」を記録する関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    data.confirms = (data.confirms || []).filter((confirm) => !(confirm.periodId === periodId && confirm.memberId === user.id));   // 前の記録を消す
    data.confirms.push({ periodId, memberId: user.id, at: new Date().toISOString() });   // 足す
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** その週を確認した人の一覧（店長は全員分、店員は自分の分） */
  async listConfirms(periodId) {   // 「見ました」の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    let list = (data.confirms || []).filter((confirm) => confirm.periodId === periodId);   // その週の「確認しました」
    if (user.role !== "manager") list = list.filter((confirm) => confirm.memberId === user.id);   // 店員なら自分の分だけ
    return reply(list);   // 返す
  },

  // シフト交代の機能はなくした（2026年11月15日）。出られない時は店長に直接連絡し、店長がシフトを直す

  // ---------- 時給・交通費（店長だけ。人件費の目安に使う。member_private） ----------

  async listWages() {   // 時給の一覧を出す関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    return reply(data.wages || []);   // 返す
  },

  /**
   * 時給・交通費と、働き方のルールを保存する（店長だけ）
   * @param {object} [extra] 働き方のルール {minor:18歳未満か, monthHoursMax:月の上限時間, yearYenMax:年の上限金額}
   */
  async saveWage(memberId, hourly, transport, extra = {}) {   // 時給・交通費・働き方のルールを保存する関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    data.wages = (data.wages || []).filter((wage) => wage.memberId !== memberId);   // 前の分を消す
    data.wages.push({   // 足す
      memberId, hourly: Number(hourly) || 0, transport: Number(transport) || 0,   // 人・時給・交通費
      minor: !!extra.minor,                                         // 18歳未満か
      monthHoursMax: Number(extra.monthHoursMax) || null,           // 月の上限時間（0や空＝決めない）
      yearYenMax: Number(extra.yearYenMax) || null,                 // 年の上限金額（0や空＝決めない）
    });
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- プッシュ通知の宛先（2026年11月6日） ----------
  // 見本データでは通知は送らない。形だけ本物とそろえる

  /** このスマホの宛先を保存する */
  async savePushSubscription(sub) {   // 通知の宛先を保存する関数
    const data = load();   // 保存してあるデータを読む
    const user = me(data);   // ログイン中の人
    data.pushSubs = (data.pushSubs || []).filter((eachSub) => eachSub.endpoint !== sub.endpoint);   // 同じ宛先を消す
    data.pushSubs.push({ endpoint: sub.endpoint, memberId: user.id });   // 足す
    save(data);   // 保存
    return reply(true);   // できた
  },

  /** このスマホの宛先を消す */
  async deletePushSubscription(endpoint) {   // 通知の宛先を消す関数
    const data = load();   // 保存してあるデータを読む
    data.pushSubs = (data.pushSubs || []).filter((sub) => sub.endpoint !== endpoint);   // 消す
    save(data);   // 保存
    return reply(true);   // できた
  },

  // ---------- バックアップ（2026年11月6日） ----------

  /** 全部のデータを1つにまとめる（店長）。パスワード・初回コード・ログインの情報は入れない */
  async exportAll() {   // バックアップを作る関数
    const data = load();   // 保存してあるデータを読む
    requireManager(data);   // 店長でなければ止める
    const { passwords, loginCodes, session, ...tables } = data;   // 書き出さないもの を外す
    return reply({ app: "shiftapp", kind: "mock", exportedAt: new Date().toISOString(), tables });   // アプリ名・種類・時間・中身を返す
  },

  // ---------- 開発用 ----------

  /** 見本データを最初の状態に戻す */
  async resetMock() {   // 見本データを最初にもどす関数
    localStorage.removeItem(STORAGE_KEY);   // 保存を消す
    load();   // 作りなおす
    return reply(true);   // できた
  },
};

// ------------------------------------------------------------
// 内部で使う小さな関数
// ------------------------------------------------------------

/**
 * その週に希望を入れられない理由（入れられれば null）
 * 締切は「その週の前の日曜24:00」＝月曜になったら入れられない
 */
function lockReason(data, weekStart) {   // 希望を出せない理由を出す関数
  const user = me(data);   // ログイン中の人
  const period = data.periods.find((period) => period.storeId === user.storeId && period.weekStart === weekStart);   // その週の受付
  if (period && period.status !== "open") return "この週は受付が終わっています";   // 受付が終わった
  if (today() > addDays(weekStart, -1)) return "この週は締切をすぎています";   // 締切をすぎた
  return null;   // 出せる
}

/**
 * 店舗の設定を写す（店舗を増やす時）
 * 営業時間・マップの人のマーク・必要人数を、新しいIDにしてコピーする
 */
function copyStoreSettings(data, fromId, toId) {   // 店舗の設定を写す関数
  const stamp = Date.now();                                  // 新しいIDに使う数字
  const idMap = new Map();                                   // 元のマークのID → 新しいマークのID
  data.positions.filter((position) => position.storeId === fromId).forEach((position, index) => {   // 場所を1つずつ
    const id = `p-${toId}-${stamp}-${index}`;   // 新しいマークのID
    idMap.set(position.id, id);   // 古いID→新しいID
    data.positions.push({ ...position, id, storeId: toId });   // 写す
  });
  data.requirements.filter((req) => idMap.has(req.positionId)).forEach((req, index) => {   // 必要人数を1つずつ
    data.requirements.push({ ...req, id: `r-${stamp}-${index}`, positionId: idMap.get(req.positionId) });   // 写す（新しい場所のIDで）
  });
  data.storeHours = data.storeHours || {};   // 入れ物がなければ作る
  data.storeHours[toId] = { ...JSON.parse(JSON.stringify(data.storeHours[fromId] || defaultHours())), special: [] };   // 営業時間を写す（休み・時間の変更は店舗ごとにちがうので写さない）
}

/** 営業時間がまだ決まっていない時の初期値（7:00〜22:00） */
function defaultHours() {   // はじめの営業時間を作る関数
  const hours = { open: 7 * 60, close: 22 * 60 };   // 7:00〜22:00
  return { weekday: { ...hours }, sat: { ...hours }, sun: { ...hours } };   // 平日・土曜・日祝
}

/** 6桁の初回コードを作って保存する */
function issueCode(data, loginId) {   // 初回コードを作る関数
  const code = String(Math.floor(100000 + Math.random() * 900000));   // 6桁の数字
  data.loginCodes = (data.loginCodes || []).filter((loginCode) => loginCode.loginId !== loginId);   // 前のコードを消す
  data.loginCodes.push({ loginId, code, used: false });   // 足す
  return code;   // コードを返す
}

/** 公開後に変わった勤務を本人に知らせる */
function notifyChanges(data, before, after) {   // 変わった人に知らせる関数
  data.notifications = data.notifications || [];   // 入れ物がなければ作る
  /** 人と日のキー */
  const key = (shift) => `${shift.memberId}|${shift.date}`;   // 人と日の名前
  const old = new Map(before.map((shift) => [key(shift), shift]));   // 前：人と日 → 勤務
  const now = new Map(after.map((shift) => [key(shift), shift]));   // 後：人と日 → 勤務
  const changed = new Set();   // 変わった人と日
  for (const [key, newShift] of now) {   // 新しい勤務ごとに
    const oldShift = old.get(key);   // 前の勤務
    if (!oldShift || oldShift.from !== newShift.from || oldShift.to !== newShift.to) changed.add(key);   // 時間が変わっていれば記録
  }
  for (const key of old.keys()) if (!now.has(key)) changed.add(key);   // 消えたものも記録
  for (const key of changed) {   // 変わったものごとに
    const [memberId, date] = key.split("|");   // 人のIDと日付
    data.notifications.push({ memberId, at: new Date().toISOString(), text: `${label(date)} のシフトが変わりました` });   // お知らせを足す
  }
  return changed.size;   // 変わった数
}
