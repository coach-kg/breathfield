// Offline support: serve the app from cache when there is no network,
// and refresh the cache whenever the network answers.
const CACHE = 'breathfield-v3';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon.svg',
  'src/main.js', 'src/store.js', 'src/audio.js',
  'src/engine/breath.js', 'src/engine/coherence.js', 'src/engine/levels.js', 'src/engine/progress.js', 'src/engine/achievements.js', 'src/engine/glow.js',
  'src/visuals/scenes.js', 'src/visuals/badges.js',
  'src/games/index.js', 'src/games/common.js', 'src/games/stillfall.js', 'src/games/snake.js', 'src/games/bow.js', 'src/games/cairn.js', 'src/games/lantern.js',
  'src/devices/device.js', 'src/devices/simulated.js', 'src/devices/ble-hr.js', 'src/devices/emwave-hid.js', 'src/devices/camera-ppg.js', 'src/devices/ppg.js',
  'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
