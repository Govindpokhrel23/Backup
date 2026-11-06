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

import { CONFIG } from "../../config.js";   // 設定を読む
import { supabaseClient, me, forgetMe, emailOf } from "./core.js";   // Supabase の道具を読む

/** 画面の関数（supabase-api.js で合体する） */
export const authApi = {   // ログインの窓口
  /** ID とパスワードでログイン */
  async login(loginId, password) {   // ログインする関数
    const client = await supabaseClient();   // Supabase の道具
    const res = await client.auth.signInWithPassword({ email: emailOf(loginId), password });   // ログインの結果
    if (res.error) throw new Error("IDかパスワードが違います");   // 失敗したらエラー
    const user = await me(true);                                         // その店員
    if (!user) {   // 店員として登録されていなければ
      await client.auth.signOut();   // ログインを取り消す
      throw new Error("このIDは今は使えません（店長に聞いてください）");   // エラー
    }
    return user;   // ログインした人を返す
  },

  /** ログアウト */
  async logout() {   // ログアウトする関数
    const client = await supabaseClient();   // Supabase の道具
    await client.auth.signOut();   // Supabase からログアウト
    forgetMe();   // アプリの中の「自分」を忘れる
    return true;   // できた
  },

  /** 今ログインしている人（いなければ null） */
  async currentUser() {   // ログイン中の人を出す関数
    return me();   // 自分の店員の情報を返す
  },

  /**
   * はじめての人：店長からもらった ID と初回コードで、パスワードを決める
   * Worker の /activate が確かめて、ログインの人を作る → そのままログイン
   */
  async activate(loginId, code, password) {   // 初回コードでパスワードを決める関数
    if (!password || password.length < CONFIG.PASSWORD_MIN) throw new Error(`パスワードは${CONFIG.PASSWORD_MIN}文字以上にしてください`);   // パスワードが短すぎたら止める
    if (!CONFIG.API_WORKER_URL) throw new Error("サーバー（Worker）のURLが設定されていません（config.js の API_WORKER_URL）");   // Worker の住所がなければ止める
    let res;                                                              // Worker の返事
    try {   // 通信が失敗しても止まらないように
      res = await fetch(`${CONFIG.API_WORKER_URL.replace(/\/$/, "")}/activate`, {   // Worker の /activate に送る
        method: "POST",   // 送る方法
        headers: { "Content-Type": "application/json" },   // 中身は JSON
        body: JSON.stringify({ loginId: String(loginId).trim(), code: String(code).trim(), password }),   // ID・初回コード・パスワード
      });
    } catch {   // 通信できなかった時
      throw new Error("サーバーにつながりません（電波を確認してください）");   // 電波のエラー
    }
    const body = await res.json().catch(() => ({}));                      // 返事の中身
    if (!res.ok) throw new Error(body.error || "IDか初回コードが違います");   // だめならエラー
    return authApi.login(loginId, password);   // そのままログインする
  },
};
