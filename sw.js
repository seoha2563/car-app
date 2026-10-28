// 서비스 워커: 한 번 접속하면 파일을 기기에 저장해서, 인터넷이 없어도 앱이 열리게 해줍니다.
const CACHE = "car-app-v2";
const FILES = [
  "./", "index.html", "style.css", "app.js", "config.js", "vendor/supabase.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

// 설치될 때: 필요한 파일을 미리 저장
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

// 활성화될 때: 옛날 버전 캐시 삭제
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 요청이 올 때: 인터넷 먼저 시도 → 성공하면 저장, 실패(오프라인)하면 저장해 둔 것 사용
// (이렇게 하면 새 버전을 배포했을 때 접속만 해도 최신 파일을 받아요)
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
