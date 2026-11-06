// ============================================================
// lib/push.js — プッシュ通知を受け取る準備（スマホ側）
// ------------------------------------------------------------
// このファイルは、このスマホで「通知を受け取る」をオン・オフするためのファイルです（2026年11月6日）。
//
// 流れ：
//   ① 本人が設定で「通知を受け取る」を押す
//   ② ブラウザが「通知を許可しますか？」と聞く → 許可
//   ③ ブラウザが「このスマホの宛先（endpoint）と鍵」をくれる
//   ④ それを Supabase の push_subs に保存する（api.savePushSubscription）
//   ⑤ お知らせが出た時、Worker（workers/api の /push）がその宛先に送る → sw.js が通知を出す
// iPhone は「ホーム画面に追加」したアプリからだけ通知を受け取れる（iOS 16.4 から）。
// 本物（Supabase）につないで、config.js に VAPID_PUBLIC_KEY を入れた時だけ使える。
// ============================================================

import { CONFIG } from "../config.js";

/**
 * このスマホ・この設定で通知を使えるか
 * @returns {{ok:boolean, why?:string}} 使えなければ why に理由
 */
export function pushStatus() {
  if (CONFIG.API_MODE !== "supabase") return { ok: false, why: "本物（Supabase）につないだ時に使えます（今は見本データ）" };
  if (!CONFIG.VAPID_PUBLIC_KEY) return { ok: false, why: "通知の鍵（config.js の VAPID_PUBLIC_KEY）が入っていません" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, why: isIphone() && !isInstalled() ? "iPhone は「ホーム画面に追加」したアプリから開くと使えます" : "このブラウザは通知に対応していません" };
  }
  return { ok: true };
}

/** iPhone・iPad か */
export const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/** ホーム画面に追加したアプリとして開いているか */
export const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

/** 今このスマホで通知を受け取っているか */
export async function isPushOn() {
  if (!pushStatus().ok) return false;
  const reg = await navigator.serviceWorker.getRegistration();       // サービスワーカー
  return !!(await reg?.pushManager.getSubscription());
}

/**
 * 通知を受け取る（オン）
 * @param {(sub:object)=>Promise<void>} save 宛先を保存する関数（api.savePushSubscription）
 */
export async function turnOnPush(save) {
  const st = pushStatus();   // 使えるか
  if (!st.ok) throw new Error(st.why);
  const permission = await Notification.requestPermission();         // 「通知を許可しますか？」
  if (permission !== "granted") throw new Error("通知が許可されませんでした（スマホの設定 → 通知 から許可できます）");
  const reg = await navigator.serviceWorker.ready;                   // サービスワーカー
  const sub = await reg.pushManager.subscribe({   // このスマホの宛先と鍵
    userVisibleOnly: true,                                           // 通知は必ず見える形で出す（決まり）
    applicationServerKey: keyBytes(CONFIG.VAPID_PUBLIC_KEY),         // このアプリの通知の鍵
  });
  await save(sub.toJSON());
}

/**
 * 通知を受け取らない（オフ）
 * @param {(endpoint:string)=>Promise<void>} remove 宛先を消す関数（api.deletePushSubscription）
 */
export async function turnOffPush(remove) {
  const reg = await navigator.serviceWorker.getRegistration();   // サービスワーカー
  const sub = await reg?.pushManager.getSubscription();              // 今の宛先
  if (!sub) return;
  await remove(sub.endpoint);
  await sub.unsubscribe();
}

/** base64url の鍵 → バイト（ブラウザに渡す形） */
function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);   // ふつうの base64 にもどした文字
  return Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
}
