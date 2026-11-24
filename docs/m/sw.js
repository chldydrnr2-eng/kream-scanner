/* 킥스캔 휴대폰 보기 — 서비스 워커: 앱 껍데기(화면 파일)만 저장해 두고, 장사 데이터(Supabase)는 건드리지 않아요.
   화면 파일도 인터넷이 되면 항상 새로 받고(네트워크 먼저), 안 될 때만 저장해 둔 것을 써요. 판을 바꾸면 SHELL 이름의 숫자를 올려요. */
var SHELL = 'ksm-shell-6';
var FILES = ['./', 'index.html', 'm.css', 'm.js', 'm2.js', 'receipt.js', 'drop.js', 'buy.js', 'manifest.webmanifest', 'icons/48.png', 'icons/128.png', 'icons/180.png', 'icons/192.png', 'icons/512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('ksm-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin) return;          // 서버(Supabase) 요청은 그대로 통과
  var scope = new URL('./', self.location.href).pathname;
  if (u.pathname.indexOf(scope) !== 0) return;                                     // m/ 밖(shop.json 등)은 저장하지 않아요
  e.respondWith(fetch(req).then(function (r) {
    if (r && r.ok && r.type === 'basic') { var cp = r.clone(); caches.open(SHELL).then(function (c) { c.put(req, cp); }); }
    return r;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true })
      .then(function (m) { return m || (req.mode === 'navigate' ? caches.match('index.html') : null); })
      .then(function (m) { return m || Response.error(); });
  }));
});

// 11/25: 폰 알림(웹 푸시) — PC 킥스캔이 보낸 새 발매 · 관심 브랜드 행사. 누르면 그 탭으로 열어요
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '킥스캔', { body: d.body || '', icon: 'icons/192.png', badge: 'icons/48.png', tag: d.tag || undefined, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (L) {
    for (var i = 0; i < L.length; i++) if (L[i].url.indexOf(self.registration.scope) === 0 && 'focus' in L[i]) { var c = L[i]; return (c.navigate ? c.navigate(url).catch(function () { return c; }) : Promise.resolve(c)).then(function (w) { return (w || c).focus(); }); }
    return self.clients.openWindow(url);
  }));
});
