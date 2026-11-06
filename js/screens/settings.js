// ============================================================
// screens/settings.js — 設定（全員）
// ------------------------------------------------------------
// このファイルは、設定（全員）のファイルです。
// ・ログアウト
// ・ホーム画面への追加のしかた（通知に必要）
// ・見本データの時だけ「最初に戻す」ボタン
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, isManager } from "../store.js";   // アプリの状態・店長か調べる道具を読む
import { saveFile } from "../lib/download.js";   // ファイルを保存する道具を読む
import { today } from "../lib/date.js";   // 今日の日付の道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { cacheInfo } from "../lib/offline-cache.js";   // スマホに保存したシフトの量を調べる道具を読む
import { pushStatus, isPushOn, turnOnPush, turnOffPush } from "../lib/push.js";   // 通知の道具を読む

/**
 * プッシュ通知のカード：このスマホで通知を受け取る／受け取らない
 * 使えない時（見本データ・鍵がない・iPhone でホーム画面に追加していない）は理由を出す
 */
function pushCard() {   // 通知のカードを作る関数
  const box = createElement("section", { class: "card" }, createElement("h2", { class: "card__title" }, "スマホへの通知"));   // カード
  const status = pushStatus();                                                                         // 使えるか
  if (!status.ok) {   // 使えなければ
    box.append(createElement("div", { class: "home-muted" }, status.why));   // 理由を出す
    return box;   // カードを返す
  }
  /** 今の状態でボタンを描き直す */
  const paint = async () => {   // カードの中身を描く
    const on = await isPushOn();                                                                   // 今オンか
    box.replaceChildren(   // 中身を入れかえる
      createElement("h2", { class: "card__title" }, "スマホへの通知"),   // 見出し
      createElement("div", { class: "home-muted" }, on ? "このスマホで通知を受け取っています（シフトの公開・変更・交代・人が足りない時）" : "シフトが公開された時・変わった時などに、スマホに通知が来ます"),   // 今の状態の説明
      createElement("button", { class: `btn ${on ? "" : "btn--primary"}`, onclick: async () => {   // オン・オフのボタン
        try {   // 失敗しても止まらないように
          if (on) await turnOffPush((endpoint) => api.deletePushSubscription(endpoint));   // オンならオフにする
          else await turnOnPush((sub) => api.savePushSubscription(sub));   // オフならオンにする
          toast(on ? "通知をオフにしました" : "通知をオンにしました");   // お知らせ
        } catch (error) { toast(error.message); }   // 失敗したら理由を出す
        paint();   // 描きなおす
      } }, on ? "通知を受け取らない" : "通知を受け取る"),   // ボタンの文字
    );
  };
  paint();   // はじめに描く
  return box;   // カードを返す
}

/** 設定の画面を描く */
export async function renderSettings(app) {   // 設定の画面を描く関数
  mount(app,   // 画面に入れる
    screenHeader({ title: "設定", sub: `${state.user.name}（ID ${state.user.loginId}）` }),   // 見出し（名前とID）
    createElement("div", { class: "screen-body" },   // 本文
      createElement("section", { class: "card" },   // ホーム画面に追加のカード
        createElement("h2", { class: "card__title" }, "ホーム画面に追加"),   // 見出し
        createElement("div", { class: "home-muted" }, "iPhoneのSafariで開いて、共有ボタン（□↑）→「ホーム画面に追加」。追加したアプリから開くと、通知を受け取れます。"),   // やり方
      ),
      // プッシュ通知（2026年11月6日。lib/push.js）
      pushCard(),   // 通知のカード
      // スマホに保存している自分のシフト（サーバーにつながらない時用）
      (() => {   // スマホに保存したシフトのカード
        const info = cacheInfo();   // スマホに保存した自分のシフトの件数と大きさ
        return createElement("section", { class: "card" },   // カード
          createElement("h2", { class: "card__title" }, "スマホに保存している自分のシフト"),   // 見出し
          createElement("div", { class: "home-muted" },   // 説明
            `${info.count}件・約${info.kb}KB（2年分まで。それより前は自動で消えます）。サーバーにつながらない時も、ホームとカレンダーで見られます。`),   // 件数・大きさ
        );
      })(),   // すぐ作って入れる
      // バックアップ（店長だけ。2026年11月6日）
      isManager()   // 店長なら
        ? createElement("section", { class: "card" },   // バックアップのカード
            createElement("h2", { class: "card__title" }, "データのバックアップ"),   // 見出し
            createElement("div", { class: "home-muted" }, "全部のデータ（店舗・店員・希望・シフト・お知らせ…）を1つのファイルに保存します。月に1回くらい保存して、パソコンやGoogleドライブにも置いておくと安心です。パスワードは入りません。"),   // 説明
            createElement("button", { class: "btn btn--primary", onclick: async () => {   // 保存ボタン
              try {   // 失敗しても止まらないように
                const data = await api.exportAll();                                  // 全部のデータ
                saveFile(`shiftapp-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");   // 日付つきのファイルで保存
                toast("バックアップを保存しました");   // お知らせ
              } catch (error) { toast(error.message); }   // 失敗したら理由を出す
            } }, "バックアップを保存する"))   // ボタンの文字
        : null,   // 店員には出さない
      createElement("button", {   // ログアウトのボタン
        class: "btn btn--block",   // 見た目
        onclick: async () => { await api.logout(); state.user = null; go("/login"); },   // ログアウトしてログイン画面へ
      }, "ログアウト"),   // ボタンの文字
      CONFIG.API_MODE === "mock"   // テスト版なら
        ? createElement("button", {   // 見本データをもどすボタン
            class: "btn btn--danger btn--block",   // 赤いボタン
            onclick: async () => {   // 押した時
              const ok = await confirmDialog({ title: "見本データを最初に戻しますか？", body: createElement("p", { style: { margin: 0 } }, "入れた希望やシフトは消えます。"), yes: "戻す", no: "やめる" });   // 本当に戻すか聞く
              if (!ok) return;   // 「いいえ」なら止める
              await api.resetMock();   // 見本データをもどす
              state.user = null;   // ログアウト
              toast("最初に戻しました");   // お知らせ
              go("/login");   // ログイン画面へ
            },
          }, "見本データを最初に戻す（開発用）")   // ボタンの文字
        : null,   // 本物版では出さない
    ),
  );
}
