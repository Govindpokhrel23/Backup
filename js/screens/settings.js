// ============================================================
// screens/settings.js — 設定（全員）
// ------------------------------------------------------------
// このファイルは、設定（全員）のファイルです。
// ・ログアウト
// ・ホーム画面への追加のしかた（通知に必要）
// ・見本データの時だけ「最初に戻す」ボタン
// ============================================================

import { h, mount, toast, confirmDialog } from "../lib/dom.js";
import { api } from "../api/index.js";
import { state, isManager } from "../store.js";
import { saveFile } from "../lib/download.js";
import { today } from "../lib/date.js";
import { go } from "../router.js";
import { CONFIG } from "../config.js";
import { screenHeader } from "../components/header.js";
import { cacheInfo } from "../lib/offline-cache.js";
import { pushStatus, isPushOn, turnOnPush, turnOffPush } from "../lib/push.js";

/**
 * プッシュ通知のカード：このスマホで通知を受け取る／受け取らない
 * 使えない時（見本データ・鍵がない・iPhone でホーム画面に追加していない）は理由を出す
 */
function pushCard() {
  const box = h("section", { class: "card" }, h("h2", { class: "card__title" }, "スマホへの通知"));   // カード
  const st = pushStatus();                                                                         // 使えるか
  if (!st.ok) {
    box.append(h("div", { class: "home-muted" }, st.why));
    return box;
  }
  /** 今の状態でボタンを描き直す */
  const paint = async () => {
    const on = await isPushOn();                                                                   // 今オンか
    box.replaceChildren(
      h("h2", { class: "card__title" }, "スマホへの通知"),
      h("div", { class: "home-muted" }, on ? "このスマホで通知を受け取っています（シフトの公開・変更・交代・人が足りない時）" : "シフトが公開された時・変わった時などに、スマホに通知が来ます"),
      h("button", { class: `btn ${on ? "" : "btn--primary"}`, onclick: async () => {
        try {
          if (on) await turnOffPush((endpoint) => api.deletePushSubscription(endpoint));
          else await turnOnPush((sub) => api.savePushSubscription(sub));
          toast(on ? "通知をオフにしました" : "通知をオンにしました");
        } catch (e) { toast(e.message); }
        paint();
      } }, on ? "通知を受け取らない" : "通知を受け取る"),
    );
  };
  paint();
  return box;
}

/** 設定の画面を描く */
export async function renderSettings(app) {
  mount(app,
    screenHeader({ title: "設定", sub: `${state.user.name}（ID ${state.user.loginId}）` }),
    h("div", { class: "screen-body" },
      h("section", { class: "card" },
        h("h2", { class: "card__title" }, "ホーム画面に追加"),
        h("div", { class: "home-muted" }, "iPhoneのSafariで開いて、共有ボタン（□↑）→「ホーム画面に追加」。追加したアプリから開くと、通知を受け取れます。"),
      ),
      // プッシュ通知（2026年11月6日。lib/push.js）
      pushCard(),
      // スマホに保存している自分のシフト（サーバーにつながらない時用）
      (() => {
        const info = cacheInfo();   // スマホに保存した自分のシフトの件数と大きさ
        return h("section", { class: "card" },
          h("h2", { class: "card__title" }, "スマホに保存している自分のシフト"),
          h("div", { class: "home-muted" },
            `${info.count}件・約${info.kb}KB（2年分まで。それより前は自動で消えます）。サーバーにつながらない時も、ホームとカレンダーで見られます。`),
        );
      })(),
      // バックアップ（店長だけ。2026年11月6日）
      isManager()
        ? h("section", { class: "card" },
            h("h2", { class: "card__title" }, "データのバックアップ"),
            h("div", { class: "home-muted" }, "全部のデータ（店舗・店員・希望・シフト・お知らせ…）を1つのファイルに保存します。月に1回くらい保存して、パソコンやGoogleドライブにも置いておくと安心です。パスワードは入りません。"),
            h("button", { class: "btn btn--primary", onclick: async () => {
              try {
                const data = await api.exportAll();                                  // 全部のデータ
                saveFile(`shiftapp-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
                toast("バックアップを保存しました");
              } catch (e) { toast(e.message); }
            } }, "バックアップを保存する"))
        : null,
      h("button", {
        class: "btn btn--block",
        onclick: async () => { await api.logout(); state.user = null; go("/login"); },
      }, "ログアウト"),
      CONFIG.API_MODE === "mock"
        ? h("button", {
            class: "btn btn--danger btn--block",
            onclick: async () => {
              const ok = await confirmDialog({ title: "見本データを最初に戻しますか？", body: h("p", { style: { margin: 0 } }, "入れた希望やシフトは消えます。"), yes: "戻す", no: "やめる" });   // 本当に戻すか聞く
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
