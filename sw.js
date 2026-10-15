// Service Worker: App-Gerüst sofort aus dem Cache (im Hintergrund aktualisiert); Supabase-Daten immer live.
// Pfade relativ, damit die App unter …github.io/Horizon-Cockpit/ läuft. Neue Version = SHELL-Nummer erhöhen.
const SHELL = 'shell-v17';
const BASE = new URL('./', self.location).pathname;
const SHELL_FILES = ['./', 'index.html', 'app.js', 'kompendium.js', 'cloud.js', 'config.js', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'data/horizon-data.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Push (B6): Edge Function „push“ schickt {title, body, url, tag}; Tippen öffnet bzw. holt das Cockpit an die Stelle url
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Horizon', {
    body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || '#/lage' },
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(BASE, self.location.origin).href + (e.notification.data?.url || '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(new URL(BASE, self.location.origin).href));
    if (w) { w.navigate(target).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;  // Supabase: nicht abfangen
  const fresh = e.request.mode === 'navigate'
    ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(e.request, { cache: 'no-cache' });
  const net = fetch(fresh).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(caches.match(e.request).then(hit => hit || net.catch(() => caches.match(BASE))));
});
