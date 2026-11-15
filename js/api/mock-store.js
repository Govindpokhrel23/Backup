// ============================================================
// api/mock-store.js — 見本データの「保存場所」と、にせものサーバーの共通の道具
// ------------------------------------------------------------
// このファイルは、見本データ（localStorage）の読み書きと、
// 「ログイン中の人は誰か」「どの店舗を見ているか」などを調べる道具のファイルです。
// mock-api.js・mock-calls.js・mock-ai.js がここを使う。
// 本物（Supabase）をつなぐと、このファイルは使わなくなる。
// ============================================================

import { createMockData } from "./mock-data.js";   // 見本データを作る関数を読む
import { createTestData } from "./test-data.js";   // テストモードのデータを作る関数を読む（2026年11月15日）
import { CONFIG } from "../config.js";   // 設定（テストモードか）を読む

// 形を変えたら番号を上げる（古い見本データは自動で作り直される）
// テストモードの時は、別の名前で保存する（ふつうの見本データとまざらないように）
export const STORAGE_KEY = CONFIG.TEST_MODE ? "shiftapp-test-v1" : "shiftapp-mock-v8";   // スマホに保存する時の名前（形を変えたら数字を上げる）

// ------------------------------------------------------------
// 保存と読み込み
// ------------------------------------------------------------

/** 保存してあるデータを読む。なければ見本データを作る */
export function load() {   // 見本データを読む関数
  try {   // 読めない時に止まらないように
    const saved = localStorage.getItem(STORAGE_KEY);   // 保存してある文字
    if (saved) return JSON.parse(saved);   // 保存があればそれを返す
  } catch (error) {   // 読めなかった時
    console.warn("見本データを読めなかったので作り直します", error);   // 理由を開発者用に残す
  }
  const fresh = CONFIG.TEST_MODE ? createTestData() : createMockData();   // 新しいデータ（テストモードならテスト用）
  save(fresh);   // 新しい見本データを保存
  return fresh;   // それを返す
}

/** データを保存する */
export function save(data) {   // 見本データを保存する関数
  try {   // 保存できない時に止まらないように
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));   // 文字にして保存
  } catch (error) {   // 保存できなかった時
    console.warn("保存できませんでした（プライベートブラウズなど）", error);   // 理由を開発者用に残す
  }
}

/** 中身のコピーを返す（画面側でいじっても元のデータが変わらないように） */
export const copy = (value) => JSON.parse(JSON.stringify(value));   // データを丸ごと写す（元を変えないため）

/** 本物の通信のように「少し待ってから」答える */
export const reply = (value) => new Promise((ok) => setTimeout(() => ok(copy(value)), 80));   // 少し待ってから返す（本物の通信のまね）

/** エラーを返す */
export const fail = (message) => Promise.reject(new Error(message));   // エラーで返す

// ------------------------------------------------------------
// ログイン中の人
// ------------------------------------------------------------

/** ログイン中の店員（いなければ null） */
export function me(data) {   // ログイン中の人を出す関数
  if (!data.session) return null;   // ログインしていなければ null
  return data.members.find((member) => member.id === data.session.memberId) || null;   // その人の店員の情報
}

/**
 * 今見ている店舗
 * ・店長 → ホームで切り替えた店舗（3店舗を管理できる）
 * ・店員 → メインの店舗
 */
export function storeOf(data) {   // 今の店舗を出す関数
  return data.session?.storeId || me(data)?.storeId;   // 選んだ店舗。なければ所属店
}

/**
 * 見てよい店舗を決める
 * storeId を渡さなければ「今見ている店舗」。渡したら、同じ会社の店舗かを確かめる
 * （2026年11月4日：店員も3店舗の公開シフトを見られるようにした）
 */
export function companyStore(data, storeId) {   // 同じ会社の店舗か確かめる関数
  if (!storeId) return storeOf(data);   // 指定がなければ今の店舗
  const mine = data.stores.find((store) => store.id === storeOf(data));   // 自分の店舗
  const target = data.stores.find((store) => store.id === storeId);   // 見たい店舗
  if (!target || target.companyId !== mine?.companyId) throw new Error("この店舗は見られません");   // ほかの会社の店舗ならエラー
  return storeId;   // その店舗IDを返す
}

/** その人がその店舗に行けるか（店長が決めた「行ける店舗」） */
export function canWorkAt(member, storeId) {   // その店舗で働けるか調べる関数
  if (member.developer) return false;   // 開発者はどの店舗のシフトにも出ない（2026年11月12日）
  return member.storeId === storeId || (member.stores || []).some((store) => store.storeId === storeId);   // 所属店か、働ける店舗に入っていればOK
}

/** その店舗での順番（1＝メイン、2＝2nd、3＝3rd。行けなければ null） */
export function rankAt(member, storeId) {   // その店舗での順位を出す関数
  if (member.stores?.length) return member.stores.find((store) => store.storeId === storeId)?.rank ?? null;   // 何店舗も持つ人は、その店の順位
  return member.storeId === storeId ? 1 : null;   // 1店舗だけの人は所属店なら1
}

/** 店長でなければエラー */
export function requireManager(data) {   // 店長か確かめる関数
  const user = me(data);   // ログイン中の人
  if (!user || user.role !== "manager") throw new Error("店長だけができる操作です");   // 店長でなければエラー
  return user;   // 店長を返す
}
