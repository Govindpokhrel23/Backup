// ============================================================
// screens/login.js — ログイン画面
// ------------------------------------------------------------
// このファイルは、ログイン画面のファイルです。
// ・ふつう：ID とパスワードでログイン
// ・はじめての人：店長からもらった「ID」と「初回コード」で
//   自分のパスワードを決める（設計書5章）
// ・一度ログインしたら、ログアウトするまで残る
// ============================================================

import { createElement, mount } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, loadStoreInfo } from "../store.js";   // アプリの状態・店舗を読む関数
import { go } from "../router.js";   // 画面を移動する道具を読む
import { CONFIG } from "../config.js";   // 設定を読む

/** ログインの画面を描く */
export async function renderLogin(app) {   // ログイン画面を描く関数
  let mode = "login";          // "login"＝ふつう / "first"＝はじめて
  draw();   // はじめに描く

  /** ログインのフォームを描く */
  function draw() {   // 画面を描く関数
    const error = createElement("div", { class: "notice notice--danger", hidden: true });   // エラーを出す所

    // ---------- ふつうのログイン ----------
    const loginForm = () => {   // ログインの入力を作る
      const id = createElement("input", { class: "input num", inputmode: "numeric", autocomplete: "username", placeholder: "例：2004" });   // IDの欄
      const pw = createElement("input", { class: "input", type: "password", autocomplete: "current-password" });   // パスワードの欄
      /** 「ログイン」を押した時 */
      const submit = async (event) => {   // ログインボタンを押した時
        event.preventDefault();   // ページが読みなおされないように
        error.hidden = true;   // エラーの文を隠す
        try {   // 失敗しても止まらないように
          state.user = await api.login(id.value.trim(), pw.value);   // ログインする
          await loadStoreInfo();   // 店舗を読む
          go("/home");   // ホームへ
        } catch (err) {   // 失敗した時
          error.textContent = err.message;   // エラーの文を入れる
          error.hidden = false;   // エラーの文を出す
        }
      };
      return createElement("form", { class: "card", onsubmit: submit },   // 入力の入れ物
        createElement("label", { class: "field" }, "ID", id),   // ID の欄
        createElement("label", { class: "field" }, "パスワード", pw),   // パスワードの欄
        error,   // エラーの文
        createElement("button", { class: "btn btn--primary btn--block", type: "submit" }, "ログイン"),   // ログインボタン
        createElement("button", { class: "btn btn--block", type: "button", onclick: () => { mode = "first"; draw(); } }, "はじめての方（初回コードをお持ちの方）"),   // 初回コードの画面へ
      );
    };

    // ---------- はじめての人 ----------
    const firstForm = () => {   // 初回コードの入力を作る
      const id = createElement("input", { class: "input num", inputmode: "numeric", placeholder: "店長からもらったID" });   // IDの欄
      const code = createElement("input", { class: "input num", inputmode: "numeric", maxlength: "6", placeholder: "6桁の初回コード" });   // 初回コードの欄
      const pw1 = createElement("input", { class: "input", type: "password", autocomplete: "new-password" });   // 新しいパスワードの欄
      const pw2 = createElement("input", { class: "input", type: "password", autocomplete: "new-password" });   // もう一度入れる欄
      /** 「はじめての方」で決めた時 */
      const submit = async (event) => {   // ボタンを押した時
        event.preventDefault();   // ページが読みなおされないように
        error.hidden = true;   // エラーの文を隠す
        if (pw1.value !== pw2.value) {   // 2回のパスワードがちがえば
          error.textContent = "パスワードが2回とも同じになっていません";   // エラーの文
          error.hidden = false;   // エラーの文を出す
          return;   // 止める
        }
        try {   // 失敗しても止まらないように
          state.user = await api.activate(id.value.trim(), code.value.trim(), pw1.value);   // パスワードを決めてログイン
          await loadStoreInfo();   // 店舗を読む
          go("/home");   // ホームへ
        } catch (err) {   // 失敗した時
          error.textContent = err.message;   // エラーの文を入れる
          error.hidden = false;   // エラーの文を出す
        }
      };
      return createElement("form", { class: "card", onsubmit: submit },   // 入力の入れ物
        createElement("p", { style: { margin: 0, fontSize: "14px" } }, "店長からもらった ID と初回コードを入れて、自分のパスワードを決めてください。"),   // 説明
        createElement("label", { class: "field" }, "ID", id),   // ID の欄
        createElement("label", { class: "field" }, "初回コード", code),   // 初回コードの欄
        createElement("label", { class: "field" }, "新しいパスワード", pw1),   // 新しいパスワードの欄
        createElement("label", { class: "field" }, "もう一度", pw2),   // 確認の欄
        error,   // エラーの文
        createElement("button", { class: "btn btn--primary btn--block", type: "submit" }, "パスワードを決めてはじめる"),   // 決めるボタン
        createElement("button", { class: "btn btn--block", type: "button", onclick: () => { mode = "login"; draw(); } }, "ログインにもどる"),   // ログインにもどる
      );
    };

    mount(app,   // 画面に入れる
      createElement("div", { class: "login" },   // ログイン画面の入れ物
        createElement("div", { class: "login__logo" }, "AIシフト"),   // アプリの名前
        createElement("div", { class: "login__sub" }, "コメダ珈琲 シフト管理"),   // 小さい説明
        mode === "login" ? loginForm() : firstForm(),   // ログインか初回コードか
        // 見本データの時だけ、試せるIDを出す
        CONFIG.API_MODE === "mock"   // テスト版なら
          ? createElement("div", { class: "notice notice--info", style: { fontWeight: 400 } },   // 見本のIDを出す
              "見本で試せるID（パスワードは全部 1234）", createElement("br"),   // 説明
              "店長 1000 ／ 社員 2001 ／ バイト 2004")   // 見本のID
          : null,   // 本物版では出さない
      ),
    );
  }
}
