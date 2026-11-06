// ============================================================
// api/mock-store.js — 見本データの「保存場所」と、にせものサーバーの共通の道具
// ------------------------------------------------------------
// このファイルは、見本データ（localStorage）の読み書きと、
// 「ログイン中の人は誰か」「どの店舗を見ているか」などを調べる道具のファイルです。
// mock-api.js・mock-calls.js・mock-ai.js がここを使う。
// 本物（Supabase）をつなぐと、このファイルは使わなくなる。
// ============================================================

import { createMockData } from "./mock-data.js";

// 形を変えたら番号を上げる（古い見本データは自動で作り直される）
export const STORAGE_KEY = "shiftapp-mock-v7";

// ------------------------------------------------------------
// 保存と読み込み
// ------------------------------------------------------------

/** 保存してあるデータを読む。なければ見本データを作る */
export function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);   // 保存してある文字
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.warn("見本データを読めなかったので作り直します", error);
  }
  const fresh = createMockData();   // 新しい見本データ
  save(fresh);
  return fresh;
}

/** データを保存する */
export function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("保存できませんでした（プライベートブラウズなど）", error);
  }
}

/** 中身のコピーを返す（画面側でいじっても元のデータが変わらないように） */
export const copy = (value) => JSON.parse(JSON.stringify(value));

/** 本物の通信のように「少し待ってから」答える */
export const reply = (value) => new Promise((ok) => setTimeout(() => ok(copy(value)), 80));

/** エラーを返す */
export const fail = (message) => Promise.reject(new Error(message));

// ------------------------------------------------------------
// ログイン中の人
// ------------------------------------------------------------

/** ログイン中の店員（いなければ null） */
export function me(data) {
  if (!data.session) return null;
  return data.members.find((member) => member.id === data.session.memberId) || null;
}

/**
 * 今見ている店舗
 * ・店長 → ホームで切り替えた店舗（3店舗を管理できる）
 * ・店員 → メインの店舗
 */
export function storeOf(data) {
  return data.session?.storeId || me(data)?.storeId;
}

/**
 * 見てよい店舗を決める
 * storeId を渡さなければ「今見ている店舗」。渡したら、同じ会社の店舗かを確かめる
 * （2026年11月4日：店員も3店舗の公開シフトを見られるようにした）
 */
export function companyStore(data, storeId) {
  if (!storeId) return storeOf(data);
  const mine = data.stores.find((store) => store.id === storeOf(data));   // 自分の店舗
  const target = data.stores.find((store) => store.id === storeId);   // 見たい店舗
  if (!target || target.companyId !== mine?.companyId) throw new Error("この店舗は見られません");
  return storeId;
}

/** その人がその店舗に行けるか（店長が決めた「行ける店舗」） */
export function canWorkAt(member, storeId) {
  return member.storeId === storeId || (member.stores || []).some((store) => store.storeId === storeId);
}

/** その店舗での順番（1＝メイン、2＝2nd、3＝3rd。行けなければ null） */
export function rankAt(member, storeId) {
  if (member.stores?.length) return member.stores.find((store) => store.storeId === storeId)?.rank ?? null;
  return member.storeId === storeId ? 1 : null;
}

/** 店長でなければエラー */
export function requireManager(data) {
  const user = me(data);   // ログイン中の人
  if (!user || user.role !== "manager") throw new Error("店長だけができる操作です");
  return user;
}
