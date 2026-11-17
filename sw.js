// ============================================================
// sw.js — サービスワーカー（電波がない時もアプリを開けるようにする）
// ------------------------------------------------------------
// このファイルは、サービスワーカー（電波がない時もアプリを開けるようにする）のファイルです。
// ・アプリのファイル（HTML・CSS・JS）を、開いた時にスマホに保存しておく
// ・ふだんは「ネットを先に見る」。つながらない時だけ保存した分を使う
//   → 新しい版を出したら、次に開いた時にすぐ新しくなる（家計簿アプリと同じ考え方）
// ・シフトのデータ自体は lib/offline-cache.js がスマホに保存する
// ============================================================

const CACHE = "shiftapp-v5";   // 中身を大きく変えたら番号を上げる（古い保存を消すため）

self.addEventListener("install", (event) => {   // インストールの時
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./", "./index.html"])).then(() => self.skipWaiting()));   // 最初のページをしまって、すぐ新しい版にする
});

self.addEventListener("activate", (event) => {   // 新しい版が動き出した時
  // 古い版の保存を消す
  event.waitUntil(   // 終わるまで待ってもらう
    caches.keys()   // しまっているものの名前を全部
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))   // 古い版のものを消す
      .then(() => self.clients.claim()),   // 開いている画面をすぐこの版で動かす
  );
});

// ------------------------------------------------------------
// プッシュ通知（2026年11月6日）
// Worker（workers/api の /push）が送った通知を受けて、スマホに出す
// ------------------------------------------------------------
self.addEventListener("push", (event) => {   // 通知が届いた時
  let data = { title: "シフト", body: "お知らせがあります", url: "./#/home" };   // 通知の中身（読めなかった時の文）
  try { data = { ...data, ...event.data.json() }; } catch { /* 文だけの時はそのまま */ }
  event.waitUntil(self.registration.showNotification(data.title, {   // 通知を出す
    body: data.body,   // 本文
    icon: "./icons/icon-192.png",   // アイコン
    badge: "./icons/icon-192.png",   // 小さいアイコン（Android）
    data: { url: data.url },                                 // 押した時に開く画面
  }));
});

// 通知を押した時：アプリが開いていればそこへ、なければ開く
self.addEventListener("notificationclick", (event) => {   // 通知を押した時
  event.notification.close();   // 通知を閉じる
  const url = new URL(event.notification.data?.url || "./#/home", self.location.href).href;   // 開く住所
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {   // 開いているアプリの画面を探す
    const open = list.find((windowClient) => windowClient.url.startsWith(self.location.origin));   // 開いているアプリ
    if (open) { open.navigate(url); return open.focus(); }   // あればその画面で開く
    return self.clients.openWindow(url);   // なければ新しく開く
  }));
});

self.addEventListener("fetch", (event) => {   // ファイルを取りに行く時
  const req = event.request;   // ブラウザのお願い
  if (req.method !== "GET") return;   // 読む以外（保存など）はさわらない
  const url = new URL(req.url);   // お願いの住所

  // Supabase の道具（CDN・バージョン決め打ち）は、一度読んだら保存したものを使う（電波がなくてもアプリが開くように）
  if (url.href.startsWith("https://cdn.jsdelivr.net/npm/@supabase/")) {   // Supabase のプログラムなら
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {   // しまってあればそれを使う。なければ取りに行く
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }   // 取れたらしまう
      return res;   // 返す
    })));
    return;   // ここで終わり
  }
  if (url.origin !== self.location.origin) return;     // ほかのサイト（サーバー）は触らない

  event.respondWith(   // それ以外のファイル
    fetch(req, { cache: "no-cache" })   // まず新しいものを取りに行く
      .then((res) => {   // 取れたら
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }   // しまっておく
        return res;   // 返す
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),   // 電波がない時はしまったものを出す
  );
});
