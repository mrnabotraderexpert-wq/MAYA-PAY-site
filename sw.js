// MAYA-PAY : service worker minimal. Réseau d'abord (le site est toujours à jour), cache en secours hors ligne.
// Ne met jamais en cache le serveur (Supabase), l'APK ni le fichier de version de l'application.
const CACHE = 'maya-pay-v1-28';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'api.js', 'link.js', 'qr.js', 'ussd.js', 'config.js', 'support.js', 'assistant.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png', 'banner.jpg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // serveur, polices : jamais interceptés
  if (/\.apk$/i.test(url.pathname) || url.pathname.endsWith('android-version.json') || url.pathname.endsWith('admin.html')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
