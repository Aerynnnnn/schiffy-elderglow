// ElderApp (Round 2 step 5): the installable island app + gentle, optional notifications. Loaded in <head> (before the game) so the
// browser's install offer (beforeinstallprompt) is never missed; the game calls ElderApp.ui(G) once it has booted.
//  - Service worker sw.js: registered after the game has loaded its map (so its precache comes from the HTTP cache, not a second
//    20 MB download). On localhost it is OPT-IN (?sw=1; ?sw=0 removes it + its caches) so development never runs on stale files.
//  - Install: Android / desktop Chrome = the browser's own prompt behind our button; iPhone / iPad = "Share -> Add to Home Screen" steps.
//  - Notifications: OFF by default, asked for only when the player turns the switch on. Per-kind switches (boat home, a friend watered
//    your tree, a lantern drifted in) + quiet hours (default 22:00-08:00), kept on this device (localStorage, not the save).
//    Push when closed (Web Push, VAPID public key in src/net_config.js, server/patch_4.sql + the send-push Edge Function): the device
//    subscribes through net.pushSubscribe; when the app goes to the background the game plans "boat home" pushes for trips in the air
//    (net.pushPlan, landing time from the island's own sim) and unplans them when the player is back. Without push (no server, no
//    support, iOS not installed): LOCAL notifications for boats while the app is open in the background (timers / TimestampTrigger).
// Console: __app (P = prefs, status(), enable(), disable(), trips(), onHidden(), onVisible(), showLocal(), sw(), clearLocal()).
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SWK = 'schiffy-elderglow.sw', PK = 'schiffy-elderglow.notify', AK = 'schiffy-elderglow.appask';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const hasSW = 'serviceWorker' in navigator && window.isSecureContext;
  if (Q.get('sw') === '1') ls.set(SWK, '1');
  if (Q.get('sw') === '0') {
    ls.del(SWK);
    if (hasSW) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => { if (r.scope === new URL('./', location.href).href) r.unregister(); })).catch(() => {});
    if (window.caches) caches.keys().then(ks => ks.forEach(k => { if (k.startsWith('eg-')) caches.delete(k); })).catch(() => {});
  }
  const swWanted = () => hasSW && Q.get('sw') !== '0' && (!LOCAL || ls.get(SWK) === '1');
  const iOS = Q.get('ios') === '1' || /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const canNotify = () => 'Notification' in window && hasSW;

  let reg = null, deferred = null, G = null, render = () => {};
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; render(); });
  window.addEventListener('appinstalled', () => { deferred = null; render(); if (G && G.toast) G.toast('The island app is on your home screen. See you there!', 4000); });

  async function ensureReg(force) {
    if (reg) return reg;
    if (!hasSW || (!swWanted() && !force)) return null;
    if (LOCAL && force) ls.set(SWK, '1');   // turning notifications on in local testing = opting in to the worker
    try { reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; reg = await navigator.serviceWorker.getRegistration() || reg; } catch (e) { console.warn('service worker not registered:', e && e.message); reg = null; }
    return reg;
  }

  // ---- prefs (this device only)
  const DEF = { on: false, boat: true, water: true, lantern: true, quiet: true, qf: 22 * 60, qt: 8 * 60, push: false, setup: false, why: '', sig: '', at: 0 };
  let P = Object.assign({}, DEF); try { Object.assign(P, JSON.parse(ls.get(PK) || '{}')); } catch (e) {}
  const saveP = () => ls.set(PK, JSON.stringify(P));
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
  const quietAt = ms => { if (!P.quiet || P.qf === P.qt) return false; const d = new Date(ms), m = d.getHours() * 60 + d.getMinutes(); return P.qf < P.qt ? m >= P.qf && m < P.qt : m >= P.qf || m < P.qt; };
  const ub64 = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), r = atob(t), o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
  const b64u = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const VAPID = () => (window.NET_CONFIG && window.NET_CONFIG.vapidPublic) || '';
  const net = () => G && G.net;

  // ---- Web Push subscription (this device) -> the server
  async function syncPush(force) {
    const n = net();
    if (!P.on || !n || !n.pushSubscribe || !VAPID()) { P.push = false; saveP(); return { ok: false, why: 'no server' }; }
    const r0 = await ensureReg(true); if (!r0 || !r0.pushManager) { P.push = false; P.why = 'push not supported here'; saveP(); return { ok: false, why: P.why }; }
    let sub = null;
    try {
      sub = await r0.pushManager.getSubscription();
      if (sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== VAPID()) { await sub.unsubscribe(); sub = null; }   // the key changed
      if (!sub) sub = await r0.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ub64(VAPID()) });
    } catch (e) { P.push = false; P.why = 'push not available in this browser (' + ((e && e.message) || 'error').slice(0, 80) + ')'; saveP(); return { ok: false, why: P.why }; }
    const j = sub.toJSON(), prefs = { boat: !!P.boat, water: !!P.water, lantern: !!P.lantern };
    const sig = [j.endpoint, n.uid, JSON.stringify(prefs), P.quiet ? P.qf + '-' + P.qt : 'none', tz()].join('|');
    if (!force && P.push && sig === P.sig && Date.now() - P.at < 7 * 86400000) return { ok: true, cached: true };
    const r = await n.pushSubscribe({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, prefs, qf: P.quiet ? P.qf : null, qt: P.quiet ? P.qt : null, tz: tz() });
    P.push = !!r.ok; P.setup = !!r.setup; P.why = r.ok ? '' : (r.why || 'server'); if (r.ok) { P.sig = sig; P.at = Date.now(); } saveP();
    return r;
  }

  async function enable() {
    if (!canNotify()) { P.why = 'this browser cannot show notifications'; render(); return false; }
    if (iOS && !standalone()) { P.why = 'ios'; render(); return false; }
    let perm = Notification.permission;
    if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
    if (perm !== 'granted') { P.on = false; P.why = perm === 'denied' ? 'blocked' : 'not now'; saveP(); render(); return false; }
    P.on = true; P.why = ''; saveP(); render();
    await ensureReg(true);
    await syncPush(true); render();
    return true;
  }
  async function disable() {
    P.on = false; P.push = false; P.sig = ''; P.why = ''; saveP(); clearLocal();
    try { const r0 = reg || (hasSW && await navigator.serviceWorker.getRegistration()); const sub = r0 && r0.pushManager && await r0.pushManager.getSubscription(); if (sub) { const n = net(); if (n && n.pushUnsubscribe) await n.pushUnsubscribe(sub.endpoint); await sub.unsubscribe(); } } catch (e) {}
    render();
  }

  // ---- boats in the air (the island's own sim knows exactly when they land)
  function trips() {
    const S = G && G.S; if (!S || !S.exp || !Array.isArray(S.exp.trips)) return [];
    const sp = Math.max(0.01, +Q.get('speed') || 1), out = [];
    for (const t of S.exp.trips) if (t.dep >= 0) { const left = t.dep + t.dur - S.time; if (left > 30) out.push({ key: t.id + '.' + Math.round(t.t0), due: Date.now() + left * 1000 / sp, dest: t.dest }); }
    return out;
  }
  let timers = [];
  function clearLocal() {
    timers.forEach(clearTimeout); timers = [];
    if (reg && reg.getNotifications) reg.getNotifications({ includeTriggered: true }).then(ns => ns.forEach(x => { if (x.tag && x.tag.startsWith('eg-local-') && x.showTrigger) x.close(); })).catch(() => {});
  }
  const ICON = () => new URL('icons/icon-192.png', location.href).href, BADGE = () => new URL('icons/badge-96.png', location.href).href;
  function showLocal(title, body, tag, at, silent) {
    const o = { body, tag: 'eg-local-' + tag, icon: ICON(), badge: BADGE(), data: { url: './' }, silent: !!silent };
    if (reg && reg.showNotification) {
      if (at && typeof window.TimestampTrigger === 'function' && 'showTrigger' in Notification.prototype) { o.showTrigger = new window.TimestampTrigger(at); return reg.showNotification(title, o); }
      return reg.showNotification(title, o);
    }
    try { new Notification(title, o); } catch (e) {}
    return Promise.resolve();
  }
  function scheduleLocal(list) {
    clearLocal();
    for (const x of list) {
      const ms = x.due - Date.now(); if (ms > 6 * 3600000 || quietAt(x.due)) continue;
      if (reg && typeof window.TimestampTrigger === 'function' && 'showTrigger' in Notification.prototype) { showLocal('Your skyboat is home', 'The crew is back with a sack of treasures.', 'boat-' + x.key, x.due); continue; }
      timers.push(setTimeout(() => { if (document.hidden && P.on && P.boat && Notification.permission === 'granted') showLocal('Your skyboat is home', 'The crew is back with a sack of treasures.', 'boat-' + x.key); }, ms));
    }
  }
  let planned = [];
  async function onHidden() {
    if (!P.on || !P.boat || !G || G.mode !== 'home' || Notification.permission !== 'granted') return;
    const list = trips(); if (!list.length) return;
    const n = net();
    if (P.push && n && n.pushPlan) {
      planned = list.map(x => x.key);
      const rs = await Promise.all(list.map(x => n.pushPlan(x.key, x.due, 1)));
      if (rs.every(r => r.ok)) { clearLocal(); return; }
    }
    scheduleLocal(list);   // no push (or the server said no): local timers while the app lives in the background
  }
  function onVisible() {
    clearLocal();
    const n = net(); if (P.on && P.push && n && n.pushUnplan) { planned = []; n.pushUnplan(null); }   // back: no boat push for what the player can watch
    if (P.on && Notification.permission !== 'granted' && canNotify()) { P.on = false; P.push = false; saveP(); render(); }   // revoked in the browser's settings
    else if (P.on) syncPush(false).then(render);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else onVisible(); });

  // ---- UI: the bell button, the Island app card, the install chip
  const SV = b => `<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${b}</svg>`;
  const IX = {
    bell: SV('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" fill="#ffd36a"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none"/><path d="M12 3.5V5" fill="none"/>'),
    bellOff: SV('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" fill="#e6e0f0"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none"/><path d="M4 4l16 16" fill="none"/>'),
    phone: SV('<rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="#bfe6ff"/><path d="M11 18.5h2" fill="none"/><path d="M12 7v6M9.5 10.5L12 13l2.5-2.5" fill="none"/>'),
    share: SV('<path d="M8 9.5H6.5v11h11v-11H16" fill="#e8f4ff"/><path d="M12 14V3M8.5 6.5L12 3l3.5 3.5" fill="none"/>'),
    plus: SV('<rect x="4" y="4" width="16" height="16" rx="4" fill="#e8f4ff"/><path d="M12 8v8M8 12h8" fill="none"/>'),
    ok: SV('<circle cx="12" cy="12" r="9" fill="#9be283"/><path d="M8 12.5l2.8 2.8L16.5 9" fill="none"/>'),
    boat: SV('<path d="M3 13h18l-3 5H6z" fill="#c98a4b"/><path d="M12 13V4l6 7h-6" fill="#fff6d6"/>'),
    water: SV('<path d="M12 2.5C9 7 5.5 10.5 5.5 15a6.5 6.5 0 0 0 13 0c0-4.5-3.5-8-6.5-12.5z" fill="#4fc3ff"/>'),
    lantern: SV('<path d="M9 4h6M12 4v2" fill="none"/><path d="M7 8c0-1.5 2-2 5-2s5 .5 5 2v8c0 1.5-2 2.5-5 2.5S7 17.5 7 16z" fill="#ffb36a"/><path d="M10 21h4" fill="none"/>'),
    moon: SV('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" fill="#b9a7ff"/>'),
  };
  const hh = m => String(Math.floor(m / 60)).padStart(2, '0') + ':00';
  const hourOpts = sel => Array.from({ length: 24 }, (_, h) => `<option value="${h * 60}"${h * 60 === sel ? ' selected' : ''}>${hh(h * 60)}</option>`).join('');

  function status() {
    if (!canNotify()) return { k: 'none', t: 'This browser can\'t show notifications.' };
    if (iOS && !standalone()) return { k: 'ios', t: 'On iPhone and iPad, notifications only work in the installed island app (iOS 16.4 or newer): add it to your Home Screen first (above), open it from there, then turn this on.' };
    if (P.why === 'blocked' || Notification.permission === 'denied') return { k: 'blocked', t: 'Notifications are blocked for this site. You can allow them in the browser\'s site settings (the icon next to the address), then try again.' };
    if (!P.on) return { k: 'off', t: 'Off. Your browser will ask once when you turn this on.' };
    if (P.push) return { k: 'push', t: 'On. Notes find you even when the app is closed.' };
    if (P.setup) return { k: 'local', t: 'On, while the app is open in the background. (Notes while it is closed begin once the island server is ready.)' };
    return { k: 'local', t: 'On, while the app is open in the background' + (P.why && P.why !== 'no server' ? ` (${P.why})` : '') + '.' };
  }

  function ui(g) {
    G = g || {};
    const $ = id => document.getElementById(id), app = $('app') || document.body, esc = G.esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]));
    // the worker comes after the map is loaded (it can then copy everything from the HTTP cache)
    setTimeout(() => ensureReg(false), 1500);
    if (G.mode !== 'home') return { render() {} };
    const btn = document.createElement('button'); btn.id = 'appBtn'; btn.className = 'card'; btn.title = 'The island app: install + gentle notes'; app.appendChild(btn);
    const card = document.createElement('div'); card.id = 'appCard'; card.className = 'card'; card.dataset.card = 'side'; card.hidden = true; app.appendChild(card);
    card.innerHTML = `<div class="pch"><span class="disp appt">${IX.phone}The island app</span><button id="appClose" title="Close">&#10005;</button></div><div id="appBody"></div>`;
    const open = () => { if (G.closeOthers) G.closeOthers(); const s = $('sndCard'); if (s) s.hidden = true; card.hidden = false; render(); if (ask) { ask.remove(); ask = null; ls.set(AK, String(Date.now())); } };
    btn.onclick = () => { if (card.hidden) open(); else card.hidden = true; };
    $('appClose').onclick = () => { card.hidden = true; };
    render = () => {
      btn.innerHTML = P.on ? IX.bell : IX.bellOff; btn.classList.toggle('on', !!P.on);
      if (card.hidden) return;
      let inst;
      if (standalone()) inst = `<p class="ok">${IX.ok}<span>You're playing in the island app. Welcome home!</span></p>`;
      else if (deferred) inst = `<p>Put Elderglow on your home screen: it opens full screen like an app, works offline for your own island, and can send gentle notes.</p><button class="big" id="appInstall">${IX.plus} Install the island app</button>`;
      else if (iOS) inst = `<p>Put Elderglow on your Home Screen (Safari):</p><ol class="steps"><li>${IX.share}<span>Tap <b>Share</b> in Safari's toolbar</span></li><li>${IX.plus}<span>Choose <b>Add to Home Screen</b>, then <b>Add</b></span></li><li>${IX.phone}<span>Open <b>Elderglow</b> from your Home Screen</span></li></ol>`;
      else inst = `<p>Your browser can install it from its menu: <b>Install app</b> or <b>Add to Home screen</b> (Chrome / Edge / Samsung Internet). It then opens full screen and works offline for your own island.</p>`;
      const st = status(), dis = st.k === 'none' || st.k === 'ios';
      const sw = (k, ic, label) => `<label class="tog sm">${ic}<input type="checkbox" data-p="${k}"${P[k] ? ' checked' : ''}><i></i><span>${label}</span></label>`;
      card.querySelector('#appBody').innerHTML = `<h4>Install</h4>${inst}
        <h4>Gentle notifications</h4>
        <label class="tog"><input type="checkbox" id="appNtf"${P.on ? ' checked' : ''}${dis ? ' disabled' : ''}><i></i><b>Send me gentle notes</b></label>
        <p class="sub st-${st.k}">${esc(st.t)}</p>
        <div class="kinds"${P.on ? '' : ' hidden'}>${sw('boat', IX.boat, 'A skyboat is home')}${sw('water', IX.water, 'A friend watered your tree')}${sw('lantern', IX.lantern, 'A lantern drifted in')}
          <div class="qh">${sw('quiet', IX.moon, 'Quiet hours')}<span${P.quiet ? '' : ' hidden'}><select data-q="qf">${hourOpts(P.qf)}</select> to <select data-q="qt">${hourOpts(P.qt)}</select></span></div></div>
        <p class="sub">Only these three, never to hurry you: at most a few a day, nothing in quiet hours (it waits until morning), and one note when several things happened.${iOS ? '' : ' On iPhone / iPad they need the installed app (iOS 16.4+).'}</p>`;
      const ib = $('appInstall'); if (ib) ib.onclick = async () => { const d = deferred; deferred = null; try { d.prompt(); await d.userChoice; } catch (e) {} render(); };
    };
    card.addEventListener('change', async e => {
      const t = e.target;
      if (t.id === 'appNtf') { if (t.checked) await enable(); else await disable(); return; }
      if (t.dataset.p) { P[t.dataset.p] = t.checked; saveP(); render(); syncPush(true).then(render); return; }
      if (t.dataset.q) { P[t.dataset.q] = +t.value; saveP(); syncPush(true).then(render); }
    });
    // the install chip: once, after a few minutes of play, only where installing makes sense
    let ask = null;
    const askLater = () => {
      if (standalone() || ls.get(AK) || !(deferred || iOS || G.phone)) return;
      if (!card.hidden || document.querySelector('#sndAsk.in') || (G.busy && G.busy())) { setTimeout(askLater, 30000); return; }
      ask = document.createElement('div'); ask.id = 'appAsk'; ask.className = 'card';
      ask.innerHTML = `${IX.phone}<span>Take your island along? <small>put it on your home screen</small></span><button class="big" data-a="1">Show me</button><button class="ghost" data-a="0" title="Not now">Not now</button>`;
      app.appendChild(ask); setTimeout(() => ask && ask.classList.add('in'), 50);
      ask.onclick = e => { const b = e.target.closest('button'); if (!b) return; ls.set(AK, String(Date.now())); ask.remove(); ask = null; if (b.dataset.a === '1') open(); };
    };
    setTimeout(askLater, +Q.get('appask') >= 0 && Q.get('appask') !== null ? +Q.get('appask') * 1000 : 180000);
    // notifications were on last time: check the browser still allows them, then refresh this device's subscription quietly
    if (P.on) setTimeout(() => onVisible(), 8000);
    render();
    return { render, open, btn, card, get ask() { return ask; } };
  }

  window.ElderApp = { ui, ensureReg, standalone, get P() { return P; } };
  window.__app = { get P() { return P; }, status, enable, disable, trips, clearLocal, syncPush, showLocal, scheduleLocal, onHidden, onVisible, sw: () => reg, get deferred() { return deferred; } };
})();
