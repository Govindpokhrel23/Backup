// ============================================================
// sw.js — サービスワーカー（電波がない時もアプリを開けるようにする）
// ------------------------------------------------------------
// このファイルは、サービスワーカー（電波がない時もアプリを開けるようにする）のファイルです。
// ・アプリのファイル（HTML・CSS・JS）を、開いた時にスマホに保存しておく
// ・ふだんは「ネットを先に見る」。つながらない時だけ保存した分を使う
//   → 新しい版を出したら、次に開いた時にすぐ新しくなる（家計簿アプリと同じ考え方）
// ・シフトのデータ自体は lib/offline-cache.js がスマホに保存する
// ============================================================

const CACHE = "shiftapp-v4";   // 中身を大きく変えたら番号を上げる（古い保存を消すため）

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./", "./index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // 古い版の保存を消す
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// ------------------------------------------------------------
// プッシュ通知（2026年11月6日）
// Worker（workers/api の /push）が送った通知を受けて、スマホに出す
// ------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = { title: "シフト", body: "お知らせがあります", url: "./#/home" };   // 通知の中身（読めなかった時の文）
  try { data = { ...data, ...event.data.json() }; } catch { /* 文だけの時はそのまま */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: data.url },                                 // 押した時に開く画面
  }));
});

// 通知を押した時：アプリが開いていればそこへ、なければ開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./#/home", self.location.href).href;   // 開く住所
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((windowClient) => windowClient.url.startsWith(self.location.origin));   // 開いているアプリ
    if (open) { open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;   // ブラウザのお願い
  if (req.method !== "GET") return;
  const url = new URL(req.url);   // お願いの住所

  // Supabase の道具（CDN・バージョン決め打ち）は、一度読んだら保存したものを使う（電波がなくてもアプリが開くように）
  if (url.href.startsWith("https://cdn.jsdelivr.net/npm/@supabase/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;     // ほかのサイト（サーバー）は触らない

  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
  );
});
