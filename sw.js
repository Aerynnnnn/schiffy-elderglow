// Schiffy Elderglow service worker (Round 2 step 5): installable app, offline single-player, gentle push notifications.
// Scope = this folder (GitHub Pages: /schiffy-elderglow/; local: /Schiffy%20Elderglow/, opt-in with ?sw=1).
// Caches (old ones are deleted on activate):
//   shell-<VERSION>: index.html, src/*.js, data/, manifest, icons - NETWORK FIRST (4 s), the cache only when offline, so an
//                    update is always picked up online and index.html is never stale for long.
//   lib-<LIBV>:      lib/ (map GLBs + layout) and art/ (pups, Schiffy, fonts) - CACHE FIRST; publish_pages.ps1 stamps LIBV with a
//                    hash of those files, so a new map makes a new cache (and the old 20 MB goes).
//   cdn-1:           three.js / loaders / meshopt / supabase-js from cdnjs + jsDelivr (pinned versions = immutable) - CACHE FIRST.
// Never cached: Supabase API calls, anything not GET, other paths of the same origin (e.g. ?lib=../Schiffy Asset Library/).
const VERSION = '20261102-002218';   // publish_pages.ps1 writes the publish time here
const LIBV = '8cc67a140eb9';      // publish_pages.ps1 writes a hash of lib/ + art/ here
const SHELL = 'eg-shell-' + VERSION, LIB = 'eg-lib-' + LIBV, CDN = 'eg-cdn-1';
const BASE = new URL('./', self.registration.scope).href;
const LIB_FILES = ['lib/elderglow_layout.json', 'lib/elderglow_terrain.glb', 'lib/elderglow_tree.glb', 'lib/elderglow_village.glb', 'lib/elderglow_land.glb',
  'lib/elderglow_faction.glb', 'lib/elderglow_critters.glb', 'art/pups.glb', 'art/schiffy.glb'];
const SHELL_FIXED = ['./', 'manifest.json', 'data/water_cells.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png'];
const SB_UMD = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

const inScope = u => u.href.startsWith(BASE);
const rel = u => u.href.slice(BASE.length).split('?')[0].split('#')[0];
const isLib = r => /^(lib|art)\//.test(r);
const isCdn = u => u.hostname === 'cdnjs.cloudflare.com' || u.hostname === 'cdn.jsdelivr.net';

// install: the shell + whatever index.html loads (its script list, fonts, CDN scripts) + the map, best effort for the big files
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL), lib = await caches.open(LIB), cdn = await caches.open(CDN);
    let html = '';
    try { const r = await fetch(BASE, { cache: 'no-cache' }); if (r.ok) { html = await r.clone().text(); await shell.put(BASE, r); } } catch (err) {}
    const src = [...new Set((html.match(/'src\/[a-z_]+\.js'/g) || []).map(s => s.slice(1, -1)).concat(['src/elder_map.js', 'src/app.js']))];
    const fonts = (html.match(/url\((art\/fonts\/[^)]+)\)/g) || []).map(s => s.slice(4, -1));
    const cdnUrls = (html.match(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[^"']+\.js/g) || []).concat([SB_UMD]);
    const put = async (cache, url, opt) => { try { if (await cache.match(url)) return; const r = await fetch(url, opt); if (r.ok || r.type === 'opaque') await cache.put(url, r); } catch (err) {} };
    await Promise.all(SHELL_FIXED.slice(1).concat(src).map(f => put(shell, BASE + f)));
    await Promise.all(cdnUrls.map(u => put(cdn, u, { mode: 'cors', credentials: 'omit' })));   // CORS copies: fine for plain <script> tags AND for supabase-js (crossorigin)
    await Promise.all(fonts.concat(LIB_FILES).map(f => put(lib, BASE + f)));   // usually from the browser's HTTP cache (the page just loaded them)
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('eg-') && k !== SHELL && k !== LIB && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

// online: the network (and refresh the cache); offline or slower than 4 s: the cached copy if there is one, else keep waiting
async function networkFirst(req, key) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(r => { if (r && r.ok) cache.put(key, r.clone()).catch(() => {}); return r; });
  net.catch(() => {});   // handled below; only silences "unhandled rejection" when the timer already answered
  const cached = () => cache.match(key, { ignoreSearch: true });
  try {
    return await Promise.race([net, new Promise((res, rej) => setTimeout(() => cached().then(h => h ? res(h) : net.then(res, rej)), 4000))]);
  } catch (err) {
    const hit = await cached(); if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req, name, key, opt) {
  const cache = await caches.open(name), hit = await cache.match(key || req.url, { ignoreSearch: name !== CDN });
  if (hit) return hit;
  const r = await fetch(opt ? req.url : req, opt);
  if (r && r.ok) cache.put(key || req.url, r.clone()).catch(() => {});
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isCdn(u)) { e.respondWith(cacheFirst(req, CDN, null, { mode: 'cors', credentials: 'omit' })); return; }
  if (!inScope(u)) return;                                   // Supabase, the asset library, other games on this origin: untouched
  const r = rel(u);
  if (req.mode === 'navigate' || r === '' || r === 'index.html') { e.respondWith(networkFirst(req, BASE)); return; }
  if (isLib(r)) { e.respondWith(cacheFirst(req, LIB, BASE + r)); return; }
  if (/^(src\/|data\/|icons\/|manifest\.json$)/.test(r)) { e.respondWith(networkFirst(req, BASE + r)); return; }
});

// ---- gentle push notifications (sent by server/functions/send-push; the words are made there)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Schiffy Elderglow', {
      body: d.body || '', tag: 'eg-' + (d.tag || 'island'), icon: BASE + 'icons/icon-192.png', badge: BASE + 'icons/badge-96.png',
      data: { url: d.url || './' }, silent: !!d.silent, renotify: false,
    });
    // an open page hears about it too (tools/push_e2e.html checks delivery this way; the game ignores it)
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ push: { title: d.title || '', tag: d.tag || '' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', BASE).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find(c => c.url.startsWith(BASE));
    if (mine) { try { await mine.focus(); return; } catch (err) {} }
    await self.clients.openWindow(url);
  })());
});
// the push service rotated the subscription: the game re-sends it to the server on its next open (it compares endpoints)
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try { const o = e.oldSubscription && e.oldSubscription.options; if (o) await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: o.applicationServerKey }); } catch (err) {}
  })());
});
self.addEventListener('message', e => { if (e.data === 'version') e.source && e.source.postMessage({ version: VERSION, libv: LIBV }); });
