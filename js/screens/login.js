// ============================================================
// screens/login.js — ログイン画面
// ------------------------------------------------------------
// ・ふつう：ID とパスワードでログイン
// ・はじめての人：店長からもらった「ID」と「初回コード」で
//   自分のパスワードを決める（設計書5章）
// ・一度ログインしたら、ログアウトするまで残る
// ============================================================

import { h, mount } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, loadStoreInfo } from "../store.js";
import { go } from "../router.js";
import { CONFIG } from "../config.js";

export async function renderLogin(app) {
  let mode = "login";          // "login"＝ふつう / "first"＝はじめて
  draw();

  function draw() {
    const error = h("div", { class: "notice notice--danger", hidden: true });

    // ---------- ふつうのログイン ----------
    const loginForm = () => {
      const id = h("input", { class: "input num", inputmode: "numeric", autocomplete: "username", placeholder: "例：2004" });
      const pw = h("input", { class: "input", type: "password", autocomplete: "current-password" });
      const submit = async (e) => {
        e.preventDefault();
        error.hidden = true;
        try {
          state.user = await api.login(id.value.trim(), pw.value);
          await loadStoreInfo();
          go("/home");
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      };
      return h("form", { class: "card", onsubmit: submit },
        h("label", { class: "field" }, "ID", id),
        h("label", { class: "field" }, "パスワード", pw),
        error,
        h("button", { class: "btn btn--primary btn--block", type: "submit" }, "ログイン"),
        h("button", { class: "btn btn--block", type: "button", onclick: () => { mode = "first"; draw(); } }, "はじめての方（初回コードをお持ちの方）"),
      );
    };

    // ---------- はじめての人 ----------
    const firstForm = () => {
      const id = h("input", { class: "input num", inputmode: "numeric", placeholder: "店長からもらったID" });
      const code = h("input", { class: "input num", inputmode: "numeric", maxlength: "6", placeholder: "6桁の初回コード" });
      const pw1 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
      const pw2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
      const submit = async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (pw1.value !== pw2.value) {
          error.textContent = "パスワードが2回とも同じになっていません";
          error.hidden = false;
          return;
        }
        try {
          state.user = await api.activate(id.value.trim(), code.value.trim(), pw1.value);
          await loadStoreInfo();
          go("/home");
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      };
      return h("form", { class: "card", onsubmit: submit },
        h("p", { style: { margin: 0, fontSize: "14px" } }, "店長からもらった ID と初回コードを入れて、自分のパスワードを決めてください。"),
        h("label", { class: "field" }, "ID", id),
        h("label", { class: "field" }, "初回コード", code),
        h("label", { class: "field" }, "新しいパスワード", pw1),
        h("label", { class: "field" }, "もう一度", pw2),
        error,
        h("button", { class: "btn btn--primary btn--block", type: "submit" }, "パスワードを決めてはじめる"),
        h("button", { class: "btn btn--block", type: "button", onclick: () => { mode = "login"; draw(); } }, "ログインにもどる"),
      );
    };

    mount(app,
      h("div", { class: "login" },
        h("div", { class: "login__logo" }, "AIシフト"),
        h("div", { class: "login__sub" }, "コメダ珈琲 シフト管理"),
        mode === "login" ? loginForm() : firstForm(),
        // 見本データの時だけ、試せるIDを出す
        CONFIG.API_MODE === "mock"
          ? h("div", { class: "notice notice--info", style: { fontWeight: 400 } },
              "見本で試せるID（パスワードは全部 1234）", h("br"),
              "店長 1000 ／ 社員 2001 ／ バイト 2004")
          : null,
      ),
    );
  }
}
