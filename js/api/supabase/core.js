// ============================================================
// api/supabase/core.js — 本物（Supabase）につなぐ時の共通の道具
// ------------------------------------------------------------
// このファイルは、Supabase とつなぐ道具（client）・ログイン中の人・今見ている店舗・
// データベースの形（snake_case）とアプリの形（camelCase）の入れかえをまとめたファイルです（2026年11月6日）。
// js/api/supabase/ の中のほかのファイルは、全部ここを使う。
//
// mock-store.js（見本データ）と同じ役目を、本物のデータベースでするもの。
// ============================================================

import { CONFIG } from "../../config.js";

// ------------------------------------------------------------
// Supabase とつなぐ道具（client）
// ------------------------------------------------------------

/** つないだ道具（はじめて使う時に作る） */
let client = null;

/**
 * Supabase の道具を返す（はじめての時は CDN から読み込んで作る）
 * @returns {Promise<object>} supabase-js の client
 */
export async function sb() {
  if (client) return client;
  const { createClient } = await import(CONFIG.SUPABASE_JS_URL);   // supabase-js を読む
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "shiftapp-auth" },   // ログインを残す
  });
  return client;
}

/** テストの時に、にせものの道具を入れる（tests/helpers/fake-supabase.mjs） */
export function useClient(fake) {
  client = fake;
  cachedMe = null;
}

/**
 * Supabase の答え {data, error} から data を取り出す。エラーなら日本語にして止める
 * @param {{data:any, error:any}} res
 */
export function must(res) {
  if (res.error) throw new Error(japanese(res.error.message || String(res.error)));
  return res.data;
}

/** データベースのエラーを、分かりやすい日本語にする */
function japanese(message) {
  if (/row-level security|permission denied/i.test(message)) return "この操作はできません（権限がありません）";
  if (/duplicate key/i.test(message)) return "同じものがもうあります";
  if (/JWT|token/i.test(message)) return "ログインが切れました。もう一度ログインしてください";
  if (/fetch|network/i.test(message)) return "サーバーにつながりません（電波を確認してください）";
  return message;
}

/** 新しいIDを作る（ブラウザの機能） */
export const newId = () => crypto.randomUUID();

// ------------------------------------------------------------
// ログイン中の人
// ------------------------------------------------------------

/** ログイン中の店員（読んだら覚えておく） */
let cachedMe = null;

/** ログインIDを、Supabase のログイン用のメールの形にする（メールは送らない） */
export const emailOf = (loginId) => `${String(loginId).trim()}@${CONFIG.LOGIN_EMAIL_DOMAIN}`;

/**
 * ログイン中の店員（いなければ null）
 * @param {boolean} [fresh] true ならデータベースから読み直す
 */
export async function me(fresh = false) {
  if (cachedMe && !fresh) return cachedMe;
  const c = await sb();   // Supabase の道具
  const { data } = await c.auth.getSession();                      // ログインの情報
  const authId = data?.session?.user?.id;                           // Supabase のログインの人のID
  if (!authId) { cachedMe = null; return null; }
  const row = must(await c.from("members").select("*").eq("auth_id", authId).maybeSingle());   // その店員
  cachedMe = row && row.active ? memberFrom(row) : null;
  return cachedMe;
}

/** ログアウトした時など、覚えている人を消す */
export function forgetMe() {
  cachedMe = null;
}

/** ログインしていなければ止める */
export async function requireMe() {
  const user = await me();                                          // ログイン中の人
  if (!user) throw new Error("ログインしてください");
  return user;
}

/** 店長でなければ止める */
export async function requireManager() {
  const user = await requireMe();                                   // ログイン中の人
  if (user.role !== "manager") throw new Error("店長だけができる操作です");
  return user;
}

// ------------------------------------------------------------
// 今見ている店舗（店長は切り替えられる。この機械に覚えておく）
// ------------------------------------------------------------

/** 今見ている店舗を覚えておく名前（人ごと） */
const storeKey = (memberId) => `shiftapp-store-${memberId}`;

/** 今見ている店舗のID（店長＝切り替えた店舗、店員＝メインの店舗） */
export async function currentStore() {
  const user = await requireMe();                                   // ログイン中の人
  if (user.role !== "manager") return user.storeId;
  try { return localStorage.getItem(storeKey(user.id)) || user.storeId; } catch { return user.storeId; }
}

/** 今見ている店舗を変える（店長） */
export async function rememberStore(storeId) {
  const user = await requireMe();                                   // ログイン中の人
  try { localStorage.setItem(storeKey(user.id), storeId); } catch { /* 保存できなくても止めない */ }
}

// ------------------------------------------------------------
// データベースの形 ⇔ アプリの形
// ------------------------------------------------------------

/**
 * 入れかえの表を作る（[アプリの名前, データベースの名前] の一覧）
 * @returns {{from:(row)=>object, to:(obj)=>object}} from＝データベース→アプリ、to＝アプリ→データベース
 */
function mapper(pairs) {
  return {
    from: (row) => (row ? Object.fromEntries(pairs.map(([js, db]) => [js, row[db]])) : row),
    to: (obj) => Object.fromEntries(pairs.filter(([js]) => obj[js] !== undefined).map(([js, db]) => [db, obj[js]])),
  };
}

/** 店員 */
const memberMap = mapper([
  ["id", "id"], ["companyId", "company_id"], ["loginId", "login_id"], ["name", "name"], ["role", "role"], ["kind", "kind"],
  ["skills", "skills"], ["everyday", "everyday"], ["active", "active"], ["account", "account"],
  ["storeId", "main_store_id"], ["stores", "stores"],
]);
export const memberFrom = memberMap.from;   // 店員：データベース → アプリ
export const memberTo = memberMap.to;   // 店員：アプリ → データベース

/** 店舗 */
export const storeMap = mapper([["id", "id"], ["companyId", "company_id"], ["name", "name"], ["short", "short"], ["active", "active"]]);

/** 受付（週） */
export const periodMap = mapper([
  ["id", "id"], ["storeId", "store_id"], ["weekStart", "week_start"], ["deadline", "deadline"], ["status", "status"],
  ["note", "note"], ["guests", "guests"], ["publishedAt", "published_at"],
]);

/** 希望 */
export const hopeMap = mapper([["memberId", "member_id"], ["date", "date"], ["kind", "kind"], ["from", "from_min"], ["to", "to_min"], ["note", "note"]]);

/** 勤務 */
export const workMap = mapper([
  ["id", "id"], ["periodId", "period_id"], ["storeId", "store_id"], ["memberId", "member_id"], ["date", "date"],
  ["from", "from_min"], ["to", "to_min"], ["area", "area"], ["breakAt", "break_at"], ["fixed", "fixed"],
  ["createdBy", "created_by"], ["requested", "requested"], ["helper", "helper"], ["reason", "reason"],
]);

/** マップの人のマーク */
export const positionMap = mapper([["id", "id"], ["storeId", "store_id"], ["name", "name"], ["area", "area"], ["x", "x"], ["y", "y"]]);

/** 必要人数 */
export const reqMap = mapper([["id", "id"], ["positionId", "position_id"], ["storeId", "store_id"], ["dayType", "day_type"], ["from", "from_min"], ["to", "to_min"], ["count", "count"]]);

/** 交代のお願い */
export const swapMap = mapper([
  ["id", "id"], ["assignmentId", "assignment_id"], ["storeId", "store_id"], ["date", "date"], ["from", "from_min"], ["to", "to_min"],
  ["area", "area"], ["fromMemberId", "from_member_id"], ["takerId", "taker_id"], ["note", "note"], ["status", "status"], ["createdAt", "created_at"],
]);

/** 人が足りない時の募集 */
export const callMap = mapper([
  ["id", "id"], ["storeId", "store_id"], ["periodId", "period_id"], ["date", "date"], ["area", "area"], ["from", "from_min"], ["to", "to_min"],
  ["short", "short"], ["status", "status"], ["auto", "auto"], ["candidateIds", "candidate_ids"], ["answers", "answers"],
  ["filledBy", "filled_by"], ["createdAt", "created_at"],
]);

/** AIの学び */
export const learnMap = mapper([
  ["id", "id"], ["storeId", "store_id"], ["memberId", "member_id"], ["date", "date"], ["weekday", "weekday"], ["kind", "kind"],
  ["from", "from_min"], ["to", "to_min"], ["aiFrom", "ai_from"], ["aiTo", "ai_to"], ["area", "area"], ["aiArea", "ai_area"], ["at", "at"],
]);

// ------------------------------------------------------------
// よく使う読み込み
// ------------------------------------------------------------

/** 会社の店員みんな（休止中も） */
export async function companyMembers() {
  const c = await sb();   // Supabase の道具
  return must(await c.from("members").select("*").order("login_id")).map(memberFrom);
}

/** 会社の店舗みんな */
export async function companyStores() {
  const c = await sb();   // Supabase の道具
  return must(await c.from("stores").select("*").order("created_at")).map(storeMap.from);
}

/** その人がその店舗に行けるか */
export function canWorkAt(member, storeId) {
  return member.storeId === storeId || (member.stores || []).some((s) => s.storeId === storeId);
}

/** その店舗での順番（1＝メイン。行けなければ null） */
export function rankAt(member, storeId) {
  if (member.stores?.length) return member.stores.find((s) => s.storeId === storeId)?.rank ?? null;
  return member.storeId === storeId ? 1 : null;
}

/** お知らせをまとめて送る（memberIds の人に同じ文） */
export async function notify(memberIds, text) {
  const ids = [...new Set(memberIds.filter(Boolean))];             // 同じ人には1回
  if (!ids.length) return;
  const c = await sb();   // Supabase の道具
  must(await c.from("notifications").insert(ids.map((id) => ({ member_id: id, text }))));
}
