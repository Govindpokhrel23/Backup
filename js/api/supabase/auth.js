// ============================================================
// api/supabase/auth.js — ログイン・ログアウト・はじめての方（本物）
// ------------------------------------------------------------
// このファイルは、Supabase のログインを使って、
// ID とパスワードでログインする・はじめての人がパスワードを決めるためのファイルです（2026年11月6日）。
//
// ・ID は Supabase の「メール」の形にして使う（例 2004 → 2004@login.shiftapp.example.com）。メールは送らない
// ・はじめての方：Cloudflare Worker（workers/api の /activate）が初回コードを確かめて、
//   Supabase にログインの人を作る（管理用の鍵が必要なので、アプリではできない）
// ============================================================

import { CONFIG } from "../../config.js";
import { sb, me, forgetMe, emailOf } from "./core.js";

/** 画面の関数（supabase-api.js で合体する） */
export const authApi = {
  /** ID とパスワードでログイン */
  async login(loginId, password) {
    const c = await sb();   // Supabase の道具
    const res = await c.auth.signInWithPassword({ email: emailOf(loginId), password });   // ログインの結果
    if (res.error) throw new Error("IDかパスワードが違います");
    const user = await me(true);                                         // その店員
    if (!user) {
      await c.auth.signOut();
      throw new Error("このIDは今は使えません（店長に聞いてください）");
    }
    return user;
  },

  /** ログアウト */
  async logout() {
    const c = await sb();   // Supabase の道具
    await c.auth.signOut();
    forgetMe();
    return true;
  },

  /** 今ログインしている人（いなければ null） */
  async currentUser() {
    return me();
  },

  /**
   * はじめての人：店長からもらった ID と初回コードで、パスワードを決める
   * Worker の /activate が確かめて、ログインの人を作る → そのままログイン
   */
  async activate(loginId, code, password) {
    if (!password || password.length < CONFIG.PASSWORD_MIN) throw new Error(`パスワードは${CONFIG.PASSWORD_MIN}文字以上にしてください`);
    if (!CONFIG.API_WORKER_URL) throw new Error("サーバー（Worker）のURLが設定されていません（config.js の API_WORKER_URL）");
    let res;                                                              // Worker の返事
    try {
      res = await fetch(`${CONFIG.API_WORKER_URL.replace(/\/$/, "")}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: String(loginId).trim(), code: String(code).trim(), password }),
      });
    } catch {
      throw new Error("サーバーにつながりません（電波を確認してください）");
    }
    const body = await res.json().catch(() => ({}));                      // 返事の中身
    if (!res.ok) throw new Error(body.error || "IDか初回コードが違います");
    return authApi.login(loginId, password);
  },
};
