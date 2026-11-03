// ============================================================
// screens/settings.js — 設定（全員）
// ------------------------------------------------------------
// ・ログアウト
// ・ホーム画面への追加のしかた（通知に必要）
// ・見本データの時だけ「最初に戻す」ボタン
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state } from "../store.js";
import { go } from "../router.js";
import { CONFIG } from "../config.js";
import { screenHeader } from "../components/header.js";
import { cacheInfo } from "../lib/offline-cache.js";

export async function renderSettings(app) {
  mount(app,
    screenHeader({ title: "設定", sub: `${state.user.name}（ID ${state.user.loginId}）` }),
    h("div", { class: "screen-body" },
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "ホーム画面に追加"),
        h("div", { class: "home-muted" }, "iPhoneのSafariで開いて、共有ボタン（□↑）→「ホーム画面に追加」。追加すると、シフトの通知を受け取れます（通知は後の段階で作ります）。"),
      ),
      // スマホに保存している自分のシフト（サーバーにつながらない時用）
      (() => {
        const info = cacheInfo();
        return h("section", { class: "card" },
          h("h2", { class: "card__title" }, "スマホに保存している自分のシフト"),
          h("div", { class: "home-muted" },
            `${info.count}件・約${info.kb}KB（2年分まで。それより前は自動で消えます）。サーバーにつながらない時も、ホームとカレンダーで見られます。`),
        );
      })(),
      h("button", {
        class: "btn btn--block",
        onclick: async () => { await api.logout(); state.user = null; go("/login"); },
      }, "ログアウト"),
      CONFIG.API_MODE === "mock"
        ? h("button", {
            class: "btn btn--danger btn--block",
            onclick: async () => {
              const ok = await confirmDialog({ title: "見本データを最初に戻しますか？", body: h("p", { style: { margin: 0 } }, "入れた希望やシフトは消えます。"), yes: "戻す", no: "やめる" });
              if (!ok) return;
              await api.resetMock();
              state.user = null;
              toast("最初に戻しました");
              go("/login");
            },
          }, "見本データを最初に戻す（開発用）")
        : null,
    ),
  );
}
