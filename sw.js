// ============================================================
// sw.js — サービスワーカー（電波がない時もアプリを開けるようにする）
// ------------------------------------------------------------
// ・アプリのファイル（HTML・CSS・JS）を、開いた時にスマホに保存しておく
// ・ふだんは「ネットを先に見る」。つながらない時だけ保存した分を使う
//   → 新しい版を出したら、次に開いた時にすぐ新しくなる（家計簿アプリと同じ考え方）
// ・シフトのデータ自体は lib/offline-cache.js がスマホに保存する
// ============================================================

const CACHE = "shiftapp-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // 古い版の保存を消す
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // ほかのサイト（サーバー）は触らない

  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
  );
});
