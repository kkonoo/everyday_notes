// 오프라인에서도 열리게 하는 서비스 워커.
// 온라인이면 항상 새 파일을 받고(업데이트 바로 반영), 오프라인이면 저장해 둔 파일을 씀.
// 같은 주소의 캘린더x플래너와 캐시 저장소를 같이 쓰므로 이름을 다르게, 남의 캐시는 지우지 않기
const CACHE = 'everyday-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/holidays.js', 'js/app.js', 'js/notes.js', 'js/menu-presets.js', 'js/meals.js', 'js/planner.js', 'js/menu-groups.js', 'js/fridge.js', 'js/budget.js', 'js/sync.js', 'js/firebase-config.js',
  'js/play-core.js', 'js/play.js', 'js/recap-core.js', 'js/recap.js',
  'icons/app-192.png', 'icons/app-512.png', 'icons/app-maskable-192.png', 'icons/app-maskable-512.png',
];

self.addEventListener('install', e => {
  self.skipWaiting(); // 새 서비스 워커를 앱을 껐다 켜지 않아도 바로 사용
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Firebase 등 외부 요청은 건드리지 않음
  e.respondWith(
    // no-cache: 브라우저 캐시(GitHub Pages는 10분)를 쓰기 전에 서버에 바뀌었는지 확인
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { cacheName: CACHE }))
  );
});
