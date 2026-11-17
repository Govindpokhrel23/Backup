// ============================================================
// screens/settings.js — 設定（全員）
// ------------------------------------------------------------
// このファイルは、設定（全員）のファイルです。
// ・ログアウト
// ・使い方（ヘルプ）の入口（ホーム画面への追加・電波がない時の説明はヘルプへ移した。2026年11月15日）
// ・見本データの時だけ「最初に戻す」ボタン
// ============================================================

import { createElement, mount, toast, confirmDialog } from "../lib/dom.js";   // 画面の部品の道具を読む
import { api } from "../api/index.js";   // データの窓口を読む
import { state, isManager, isRealManager, isDeveloper, setViewAsStaff } from "../store.js";   // アプリの状態・店長か・開発者か・見る画面の切りかえを読む
import { saveFile } from "../lib/download.js";   // ファイルを保存する道具を読む
import { today } from "../lib/date.js";   // 今日の日付の道具を読む
import { go } from "../router.js";   // 画面を移動する道具を読む
import { CONFIG } from "../config.js";   // 設定を読む
import { screenHeader } from "../components/header.js";   // 見出しの部品を読む
import { pushStatus, isPushOn, turnOnPush } from "../lib/push.js";   // 通知の道具を読む
import { clearLocalData } from "../lib/local-data.js";   // ログアウトの時にスマホの中のデータを消す道具を読む（2026年11月16日）

/**
 * プッシュ通知のカード：このスマホで通知を受け取る（一度オンにしたらずっとオン。2026年11月17日）
 * 使えない時（見本データ・鍵がない・iPhone でホーム画面に追加していない）は理由を出す
 */
function pushCard() {   // 通知のカードを作る関数
  const box = createElement("section", { class: "card" }, createElement("h2", { class: "card__title" }, "スマホへの通知"));   // カード
  const status = pushStatus();                                                                         // 使えるか
  if (!status.ok) {   // 使えなければ
    box.append(createElement("div", { class: "home-muted" }, status.why));   // 理由を出す
    return box;   // カードを返す
  }
  /** 今の状態で描き直す（2026年11月17日：オンにしたら「受け取らない」ボタンは出さない＝ずっとオン） */
  const paint = async () => {   // カードの中身を描く
    const on = await isPushOn();                                                                   // 今オンか
    box.replaceChildren(   // 中身を入れかえる
      createElement("h2", { class: "card__title" }, "スマホへの通知"),   // 見出し
      on   // オンなら
        ? createElement("div", { class: "notice notice--ok" }, "このスマホで通知を受け取っています（シフトの公開・変更・人が足りない時）")   // 受け取っている（ボタンなし）
        : createElement("div", { class: "home-muted" }, "シフトが公開された時・変わった時・人が足りない時に、このスマホに通知が届きます。一度オンにすると、ずっと届きます"),   // 説明
      on ? null : createElement("button", { class: "btn btn--primary", onclick: async () => {   // オンにするボタン
        try {   // 失敗しても止まらないように
          await turnOnPush((sub) => api.savePushSubscription(sub));   // オンにする
          toast("通知をオンにしました");   // お知らせ
        } catch (error) { toast(error.message); }   // 失敗したら理由を出す
        paint();   // 描きなおす
      } }, "通知を受け取る"),   // ボタンの文字
    );
  };
  paint();   // はじめに描く
  return box;   // カードを返す
}

/** 設定の画面を描く */
/**
 * 見る画面のカード（店長・開発者）
 * 店員の画面にすると、下のタブとホームが店員と同じになる（店員にどう見えるか確かめる用）
 */
function viewCard() {   // 見る画面のカードを作る関数
  return createElement("section", { class: "card" },   // カード
    createElement("h2", { class: "card__title" }, isDeveloper() ? "見る画面（開発者）" : "見る画面"),   // 見出し
    createElement("div", { class: "home-muted" }, "店員にどう見えるかを確かめられます。もどす時は、上の帯かここで「店長の画面」を押します。"),   // 説明
    createElement("div", { class: "chip-row" },   // ボタンの行
      createElement("button", { class: "chip", "aria-pressed": String(!state.viewAsStaff), onclick: () => { setViewAsStaff(false); go("/home"); } }, "店長の画面"),   // 店長の画面
      createElement("button", { class: "chip", "aria-pressed": String(state.viewAsStaff), onclick: () => { setViewAsStaff(true); go("/home"); } }, "店員の画面"),   // 店員の画面
    ),
  );
}

/** 設定の区切りの見出し（種類ごとにまとめる。2026年11月17日） */
function group(title) {   // 区切りの見出しを作る関数
  return createElement("h2", { class: "settings-group" }, title);   // 小さい見出し
}

export async function renderSettings(app) {   // 設定の画面を描く関数
  mount(app,   // 画面に入れる
    screenHeader({ title: "設定", sub: `${state.user.name}（ID ${state.user.loginId}）` }),   // 見出し（名前とID）
    createElement("div", { class: "screen-body" },   // 本文
      // 使い方（ヘルプ）の入口（2026年11月15日。店員は「店舗」タブがないので、ここから開く）
      createElement("button", { class: "btn btn--block", onclick: () => go("/help") }, "📖 使い方（ヘルプ）"),   // ヘルプへ
      group("このスマホ"),   // 区切り：通知・見る画面
      // 「ホーム画面に追加」のやり方は、ヘルプの「はじめに」に移した（2026年11月15日）
      // 店長の画面／店員の画面の切りかえ（店長・開発者だけ。2026年11月12日）
      isRealManager() ? viewCard() : null,   // 見る画面のカード
      // プッシュ通知（2026年11月6日。lib/push.js）
      pushCard(),   // 通知のカード
      // 「スマホに保存している自分のシフト」の説明は、ヘルプの「困った時」に移した（2026年11月15日）
      // バックアップ（店長だけ。2026年11月6日）
      isManager() ? group("データ（店長）") : null,   // 区切り：バックアップ
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
      group("アカウント"),   // 区切り：ログアウト
      createElement("button", {   // ログアウトのボタン
        class: "btn btn--block",   // 見た目
        onclick: async () => { await api.logout(); clearLocalData(); state.user = null; go("/login"); },   // ログアウトして、このスマホに残したシフトなどを消して、ログイン画面へ
      }, "ログアウト"),   // ボタンの文字
      CONFIG.API_MODE === "mock" ? group("開発用") : null,   // 区切り：見本データ
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
