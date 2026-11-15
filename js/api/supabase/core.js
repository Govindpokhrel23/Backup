// ============================================================
// api/supabase/core.js — 本物（Supabase）につなぐ時の共通の道具
// ------------------------------------------------------------
// このファイルは、Supabase とつなぐ道具（client）・ログイン中の人・今見ている店舗・
// データベースの形（snake_case）とアプリの形（camelCase）の入れかえをまとめたファイルです（2026年11月6日）。
// js/api/supabase/ の中のほかのファイルは、全部ここを使う。
//
// mock-store.js（見本データ）と同じ役目を、本物のデータベースでするもの。
// ============================================================

import { CONFIG } from "../../config.js";   // 設定を読む

// ------------------------------------------------------------
// Supabase とつなぐ道具（client）
// ------------------------------------------------------------

/** つないだ道具（はじめて使う時に作る） */
let client = null;   // Supabase の道具（1つだけ作って使い回す）

/**
 * Supabase の道具を返す（はじめての時は CDN から読み込んで作る）
 * @returns {Promise<object>} supabase-js の client
 */
export async function supabaseClient() {   // Supabase の道具を出す関数
  if (client) return client;   // もうあればそれを返す
  const { createClient } = await import(CONFIG.SUPABASE_JS_URL);   // supabase-js を読む
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {   // 作る（URLと公開してよい鍵）
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "shiftapp-auth" },   // ログインを残す
  });
  return client;   // 返す
}

/** テストの時に、にせものの道具を入れる（tests/helpers/fake-supabase.mjs） */
export function useClient(fake) {   // テストの時ににせものを入れる関数
  client = fake;   // にせものにする
  cachedMe = null;   // 「自分」を忘れる
}

/**
 * Supabase の答え {data, error} から data を取り出す。エラーなら日本語にして止める
 * @param {{data:any, error:any}} res
 */
export function must(res) {   // エラーなら止め、なければ中身を返す関数
  if (res.error) throw new Error(japanese(res.error.message || String(res.error)));   // エラーを日本語にして止める
  return res.data;   // 中身を返す
}

/** データベースのエラーを、分かりやすい日本語にする */
function japanese(message) {   // 英語のエラーを日本語にする関数
  if (/row-level security|permission denied/i.test(message)) return "この操作はできません（権限がありません）";   // 権限がない
  if (/duplicate key/i.test(message)) return "同じものがもうあります";   // 同じものがある
  if (/JWT|token/i.test(message)) return "ログインが切れました。もう一度ログインしてください";   // ログインが切れた
  if (/fetch|network/i.test(message)) return "サーバーにつながりません（電波を確認してください）";   // つながらない
  return message;   // それ以外はそのまま
}

/** 新しいIDを作る（ブラウザの機能） */
export const newId = () => crypto.randomUUID();   // 新しいIDを作る

// ------------------------------------------------------------
// ログイン中の人
// ------------------------------------------------------------

/** ログイン中の店員（読んだら覚えておく） */
let cachedMe = null;   // 「自分」の情報をとっておく所

/** ログインIDを、Supabase のログイン用のメールの形にする（メールは送らない） */
export const emailOf = (loginId) => `${String(loginId).trim()}@${CONFIG.LOGIN_EMAIL_DOMAIN}`;   // ログインIDをメールの形にする

/**
 * ログイン中の店員（いなければ null）
 * @param {boolean} [fresh] true ならデータベースから読み直す
 */
export async function me(fresh = false) {   // 自分の店員の情報を出す関数
  if (cachedMe && !fresh) return cachedMe;   // とってあればそれを返す
  const client = await supabaseClient();   // Supabase の道具
  const { data } = await client.auth.getSession();                      // ログインの情報
  const authId = data?.session?.user?.id;                           // Supabase のログインの人のID
  if (!authId) { cachedMe = null; return null; }   // ログインしていなければ null
  const row = must(await client.from("members").select("*").eq("auth_id", authId).maybeSingle());   // その店員
  cachedMe = row && row.active ? memberFrom(row) : null;   // 休止中なら null
  return cachedMe;   // 返す
}

/** ログアウトした時など、覚えている人を消す */
export function forgetMe() {   // 「自分」を忘れる関数
  cachedMe = null;   // 消す
}

/** ログインしていなければ止める */
export async function requireMe() {   // ログインしていなければ止める関数
  const user = await me();                                          // ログイン中の人
  if (!user) throw new Error("ログインしてください");   // いなければエラー
  return user;   // 自分を返す
}

/** 店長でなければ止める */
export async function requireManager() {   // 店長でなければ止める関数
  const user = await requireMe();                                   // ログイン中の人
  if (user.role !== "manager") throw new Error("店長だけができる操作です");   // 店長でなければエラー
  return user;   // 自分を返す
}

// ------------------------------------------------------------
// 今見ている店舗（店長は切り替えられる。この機械に覚えておく）
// ------------------------------------------------------------

/** 今見ている店舗を覚えておく名前（人ごと） */
const storeKey = (memberId) => `shiftapp-store-${memberId}`;   // 今の店舗を保存する名前

/** 今見ている店舗のID（店長＝切り替えた店舗、店員＝メインの店舗） */
export async function currentStore() {   // 今の店舗を出す関数
  const user = await requireMe();                                   // ログイン中の人
  if (user.role !== "manager") return user.storeId;   // 店員は所属店
  try { return localStorage.getItem(storeKey(user.id)) || user.storeId; } catch { return user.storeId; }   // 店長は保存した店舗（なければ所属店）
}

/** 今見ている店舗を変える（店長） */
export async function rememberStore(storeId) {   // 今の店舗を保存する関数
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
function mapper(pairs) {   // アプリの名前と表の列の名前を変換する道具を作る関数
  return {   // 返す
    from: (row) => (row ? Object.fromEntries(pairs.map(([js, db]) => [js, row[db]])) : row),   // 表 → アプリ
    to: (obj) => Object.fromEntries(pairs.filter(([js]) => obj[js] !== undefined).map(([js, db]) => [db, obj[js]])),   // アプリ → 表
  };
}

/** 店員 */
const memberMap = mapper([   // 店員の変換
  ["id", "id"], ["companyId", "company_id"], ["loginId", "login_id"], ["name", "name"], ["role", "role"], ["kind", "kind"],   // ID・会社・ログインID・名前・役割・立場
  ["skills", "skills"], ["everyday", "everyday"], ["active", "active"], ["account", "account"],   // できること・毎日・休止・アカウント
  ["storeId", "main_store_id"], ["stores", "stores"],   // 所属店・働ける店舗
  ["developer", "developer"],   // 開発者か（2026年11月12日）
]);
export const memberFrom = memberMap.from;   // 店員：データベース → アプリ
export const memberTo = memberMap.to;   // 店員：アプリ → データベース

/** 店舗 */
export const storeMap = mapper([["id", "id"], ["companyId", "company_id"], ["name", "name"], ["short", "short"], ["active", "active"]]);   // 店舗の変換

/** 受付（週） */
export const periodMap = mapper([   // 週の変換
  ["id", "id"], ["storeId", "store_id"], ["weekStart", "week_start"], ["deadline", "deadline"], ["status", "status"],   // ID・店舗・始まり・締切・状態
  ["note", "note"], ["guests", "guests"], ["publishedAt", "published_at"],   // 連絡事項・足した人・公開した時間
]);

/** 希望 */
export const hopeMap = mapper([["memberId", "member_id"], ["date", "date"], ["kind", "kind"], ["from", "from_min"], ["to", "to_min"], ["note", "note"]]);   // 希望の変換

/** 勤務 */
export const workMap = mapper([   // 勤務の変換
  ["id", "id"], ["periodId", "period_id"], ["storeId", "store_id"], ["memberId", "member_id"], ["date", "date"],   // ID・週・店舗・人・日付
  ["from", "from_min"], ["to", "to_min"], ["area", "area"], ["breakAt", "break_at"], ["fixed", "fixed"],   // 時間・場所・休憩・固定
  ["createdBy", "created_by"], ["requested", "requested"], ["helper", "helper"], ["reason", "reason"],   // 作った人・希望あり・応援・理由
]);

/** マップの人のマーク */
export const positionMap = mapper([["id", "id"], ["storeId", "store_id"], ["name", "name"], ["area", "area"], ["x", "x"], ["y", "y"]]);   // 場所の変換

/** 必要人数 */
export const reqMap = mapper([["id", "id"], ["positionId", "position_id"], ["storeId", "store_id"], ["dayType", "day_type"], ["from", "from_min"], ["to", "to_min"], ["count", "count"]]);   // 必要人数の変換

/** 交代のお願い */
export const swapMap = mapper([   // 交代の変換
  ["id", "id"], ["assignmentId", "assignment_id"], ["storeId", "store_id"], ["date", "date"], ["from", "from_min"], ["to", "to_min"],   // ID・勤務・店舗・日・時間
  ["area", "area"], ["fromMemberId", "from_member_id"], ["takerId", "taker_id"], ["note", "note"], ["status", "status"], ["createdAt", "created_at"],   // 場所・お願いした人・代わる人・メモ・状態・時間
  ["targets", "targets"],   // 頼む人（空なら行ける人みんな。2026年11月15日）
]);

/** 人が足りない時の募集 */
export const callMap = mapper([   // 募集の変換
  ["id", "id"], ["storeId", "store_id"], ["periodId", "period_id"], ["date", "date"], ["area", "area"], ["from", "from_min"], ["to", "to_min"],   // ID・店舗・週・日・場所・時間
  ["short", "short"], ["status", "status"], ["auto", "auto"], ["candidateIds", "candidate_ids"], ["answers", "answers"],   // 人数・状態・自動・候補・返事
  ["filledBy", "filled_by"], ["createdAt", "created_at"],   // 決まった人・作った時間
]);

/** AIの学び */
export const learnMap = mapper([   // 覚えたことの変換
  ["id", "id"], ["storeId", "store_id"], ["memberId", "member_id"], ["date", "date"], ["weekday", "weekday"], ["kind", "kind"],   // ID・店舗・人・日・曜日・種類
  ["from", "from_min"], ["to", "to_min"], ["aiFrom", "ai_from"], ["aiTo", "ai_to"], ["area", "area"], ["aiArea", "ai_area"], ["at", "at"],   // 時間・AIの時間・場所・AIの場所・時間
]);

// ------------------------------------------------------------
// よく使う読み込み
// ------------------------------------------------------------

/** 会社の店員みんな（休止中も） */
export async function companyMembers() {   // 会社の店員を全部出す関数
  const client = await supabaseClient();   // Supabase の道具
  return must(await client.from("members").select("*").order("login_id")).map(memberFrom);   // ログインIDの順
}

/** 会社の店舗みんな */
export async function companyStores() {   // 会社の店舗を全部出す関数
  const client = await supabaseClient();   // Supabase の道具
  return must(await client.from("stores").select("*").order("created_at")).map(storeMap.from);   // 作った順
}

/** その人がその店舗に行けるか */
export function canWorkAt(member, storeId) {   // その店舗で働けるか調べる関数
  if (member.developer) return false;   // 開発者はどの店舗のシフトにも出ない（2026年11月12日）
  return member.storeId === storeId || (member.stores || []).some((store) => store.storeId === storeId);   // 所属店か働ける店舗に入っていればOK
}

/** その店舗での順番（1＝メイン。行けなければ null） */
export function rankAt(member, storeId) {   // その店舗での順位を出す関数
  if (member.stores?.length) return member.stores.find((store) => store.storeId === storeId)?.rank ?? null;   // 何店舗も持つ人はその店の順位
  return member.storeId === storeId ? 1 : null;   // 1店舗だけの人は所属店なら1
}

/** お知らせをまとめて送る（memberIds の人に同じ文） */
export async function notify(memberIds, text) {   // お知らせを保存する関数
  const ids = [...new Set(memberIds.filter(Boolean))];             // 同じ人には1回
  if (!ids.length) return;   // だれもいなければ終わり
  const client = await supabaseClient();   // Supabase の道具
  must(await client.from("notifications").insert(ids.map((id) => ({ member_id: id, text }))));   // 1人1件保存
  sendPush(ids, text);   // スマホにも通知を送る（待たない）
}

/**
 * プッシュ通知を送る（Worker の /push にたのむ）。2026年11月6日
 * 通知が送れなくても、アプリのお知らせは残っているので、エラーでも止めない（待たない）
 */
export function sendPush(memberIds, text) {   // スマホに通知を送る関数（待たない）
  if (!CONFIG.API_WORKER_URL || !CONFIG.VAPID_PUBLIC_KEY) return;   // 設定がなければ送らない
  (async () => {   // 裏で送る
    const client = await supabaseClient();   // Supabase の道具
    const token = (await client.auth.getSession()).data?.session?.access_token;   // ログインの印
    if (!token) return;   // ログインしていなければ送らない
    await fetch(`${CONFIG.API_WORKER_URL.replace(/\/$/, "")}/push`, {   // Worker の /push に送る
      method: "POST",   // 送る方法
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },   // 中身は JSON・ログインの証明つき
      body: JSON.stringify({ memberIds, text }),   // 送る人と文
    });
  })().catch((error) => console.warn("通知を送れませんでした（お知らせは残っています）", error));   // 失敗しても止めない
}

/** 1回に読める行の数（Supabase の決まり） */
const PAGE = 1000;   // 1回に読む行数

/**
 * 多い時も全部読む（1000行ずつに分けて読む）
 * @param {() => object} make 問い合わせを作る関数（毎回新しく作る。order をつけておく）
 * @returns {Promise<object[]>} 全部の行
 */
export async function readAll(make) {   // 1000行ずつ全部読む関数
  const rows = [];                                                   // 読んだ行
  for (let index = 0; ; index += PAGE) {   // 1000行ずつ
    const part = must(await make().range(index, index + PAGE - 1));           // 1000行ぶん
    rows.push(...part);   // 足す
    if (part.length < PAGE) return rows;   // 足りなければ最後なので返す
  }
}
