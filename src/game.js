// Schiffy Elderglow - the game. Boot: map (ElderMap) -> start-state roles -> nav + height grid -> save/offline
// -> pups + plots -> loop. The sim (src/sim.js) runs in fixed STEP ticks from real time; the renderer only reads it.
// URL: ?debug=1 map debug view (index.html)  ?phone=1 phone preset (375x812, ratio 1.5, no ink)  ?speed=N sim speed
//      ?away=SEC pretend the save is SEC older (offline test)  ?reset=1 fresh island  ?nosave=1 never write the save
//      ?lib=<url of the library's glb/>  ?cam=pup0..N  ?slot=NAME separate save slot (tests)
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const FIX = Q.get('phone') === '1';
  const PHONE = FIX || matchMedia('(pointer: coarse)').matches;
  const LIB = Q.get('lib') || window.ELDER_LIB || 'lib/';   // lib/ = the map files, refreshed by sync_lib.ps1
  const SPEED = Math.max(0, Math.min(3600, +Q.get('speed') || 1));
  // v1 is read once + migrated, then left as a backup. ?slot=NAME = a separate save (tests never touch the real island)
  // lower-cased: ?slot=liveA used to fail the test silently and run on the REAL save (2026-10-31 live test)
  const SLOT0 = (Q.get('slot') || '').toLowerCase(), SLOT = /^[a-z0-9]{1,12}$/.test(SLOT0) ? '.' + SLOT0 : '';
  if (Q.get('slot') && !SLOT) console.warn('?slot= must be 1-12 letters / digits: using the REAL save');
  const SAVE_KEY = 'schiffy-elderglow.save.v2' + SLOT, OLD_KEY = 'schiffy-elderglow.save.v1' + SLOT;
  // step 6: ?visit=<island id> = someone else's island, read-only (src/social_ui.js): never saved, the visitor walks as Schiffy
  const VISIT = /^[A-Za-z0-9_-]{1,64}$/.test(Q.get('visit') || '') ? Q.get('visit') : null;
  let soc = null, walker = null, bootSum = null, cloudUI = null, noSaves = false, lan = null, lfx = null;   // Round 2 step 4: lantern notes + World Bloom
  let calm = null;   // vibe pass 1: the calm view (src/calm.js), home only
  // vibe pass 2 lane C: day light pass (src/light_fx.js), idle camera drift (cam_drift.js, home), night whispers (tree_voice.js, home), foley (foley.js)
  let ringFx = null;   // update 3: Elder rings round the trunk (src/ring_fx.js)
  let lightFx = null, drift = null, voice = null, foley = null, wxFx = null, wxUI = null;   // wxFx = seasons + weather pass (src/weather_fx.js)
  // ---- step 7: ONE backend (src/net.js) for the social side and the cloud save; the cloud check starts NOW (sign-in +
  // fetch run while the map loads) so a newer cloud copy is in place before load() reads the save. Off for visits (never
  // saved), ?nosave=1, ?reset=1 (test sessions) and ?cloud=0. ?mockdb=NAME = a separate pretend server.
  const MOCKDB = /^[a-z0-9]{1,12}$/.test(Q.get('mockdb') || '') ? Q.get('mockdb') : '';
  const NET = Net.make({ slot: SLOT.replace(/^\./, ''), mockdb: MOCKDB, samples: () => Social.samples(nav), offline: () => window.__netOffline === true,
    p5: Q.get('p5') === '0' ? false : undefined });   // piece 5 tests: ?p5=0 = the pretend server acts as if server/patch_5.sql was never run
  const CLOUD_ON = !VISIT && Q.get('nosave') !== '1' && Q.get('reset') !== '1' && Q.get('cloud') !== '0';
  const cloud = VISIT ? null : Cloud.Sync({ net: NET, key: SAVE_KEY, storage: localStorage, save: () => save(), device: Cloud.device(navigator.userAgent, PHONE),
    on: { conflict: i => { if (cloudUI) cloudUI.showPick(i); else pendingPick = i; }, status: () => { if (cloudUI) cloudUI.status(); } } });
  let pendingPick = null;
  const cloudBoot = cloud && CLOUD_ON ? cloud.boot() : Promise.resolve(null);
  { // an email link that failed (expired / used) comes back as #error=...: say so kindly, then tidy the address bar
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('error')) { window.__linkError = h.get('error_code') || h.get('error'); history.replaceState(null, '', location.pathname + location.search); }
  }
  // ---- the clock: the island's hours follow the player's local time (Sim.tod(S) = (S.clock0 + S.time) mod 24 h).
  // ?time=HH:MM (tests only) starts the island at that hour and lets it run (x ?speed); __game.setTime('21:30') scrubs;
  // __game.setTime(null) goes back to the real clock. No toggle in the UI by design.
  const parseT = v => { if (v === null || v === undefined || v === '') return null; if (typeof v === 'number') return ((v % 24) + 24) % 24 * 3600;
    const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(v)); return m ? ((+m[1] % 24) * 3600 + (+(m[2] || 0)) * 60) : null; };
  let TIME_FIX = parseT(Q.get('time'));
  const realSec = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; };
  function anchorClock(ahead, want) {   // so that the island's clock reads `want` (default: now) once `ahead` more sim seconds have run
    const w = want !== undefined ? want : TIME_FIX !== null ? TIME_FIX : realSec();
    S.clock0 = Math.round((((w - (S.time + (ahead || 0))) % 86400) + 86400) % 86400 * 1000) / 1000;
    // step 5: the same anchor for the local timestamp (seasons): today's local date at hour w
    const ln = Seasons.localNow(), day0 = Math.floor(ln / 86400) * 86400;
    S.ep0 = Math.round((day0 + w - (S.time + (ahead || 0))) * 1000) / 1000;
  }
  // ?season=spring|summer|autumn|winter (tests / screenshots only, never saved): force the season everywhere
  { const sq = Seasons.NAMES.indexOf(Q.get('season') || ''); if (sq >= 0) Seasons.fix = sq; }
  // ---- Round 2 step 1: sound (src/audio.js). Off until the player says yes (prefs in localStorage, not the save); ?mute=1 =
  // silent test mode (output gain 0, own prefs key). Never touches the sim: the game only calls snd.sfx* + snd.update (4x/s).
  const snd = ElderSound.make({ silent: Q.get('mute') === '1' || window.__ELDER_SILENT === true });
  let sndUI = null, sndWater = null, appUI = null;
  const $ = id => document.getElementById(id);
  const app = $('app');
  if (FIX) document.body.classList.add('fix');
  const W = () => app.clientWidth, H = () => app.clientHeight;
  const setLayout = () => document.body.classList.toggle('phone', FIX || W() < 700);
  setLayout();
  const err = msg => { const e = $('err'); e.style.display = 'block'; e.textContent = msg; };
  addEventListener('error', e => { window.__errors = (window.__errors || []).concat(String(e.message)); });

  // ---- renderer / scene (same look as the map debug view)
  const renderer = new THREE.WebGLRenderer({ antialias: !PHONE });
  renderer.setPixelRatio(FIX ? 1.5 : Math.min(devicePixelRatio, PHONE ? 1.5 : 2)); renderer.setSize(W(), H());
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.insertBefore(renderer.domElement, app.firstChild);
  const SKY = new THREE.Color(0xc3dcf7), SKY_SICK = new THREE.Color(0xb8b8c4);
  const scene = new THREE.Scene(); scene.background = SKY.clone(); scene.fog = new THREE.Fog(0xc3dcf7, 600, 1800);
  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.5, 4000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, minDistance: 12, maxDistance: 700, maxPolarAngle: 1.45, screenSpacePanning: false });
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x8a7aa8, 0.75); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.95); sun.castShadow = true;
  sun.shadow.mapSize.set(PHONE ? 2048 : 4096, PHONE ? 2048 : 4096); sun.shadow.bias = -0.0006; scene.add(sun);

  // ---- icons (inline SVG, ink outlined)
  const SV = (body, vb) => `<svg class="ic" viewBox="${vb || '0 0 24 24'}" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  const IC = {
    water: SV('<path d="M12 2.5C9 7 5.5 10.5 5.5 15a6.5 6.5 0 0 0 13 0c0-4.5-3.5-8-6.5-12.5z" fill="#4fc3ff"/>'),
    light: SV('<path d="M9 4h6M10 4v2M14 4v2" fill="none"/><path d="M7.5 7h9l-1 11h-7z" fill="#ffd36a"/><path d="M8 20h8" fill="none"/>'),
    rest: SV('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" fill="#b9a7ff"/>'),
    wood: SV('<rect x="3" y="8" width="16" height="8" rx="4" fill="#b07a45"/><ellipse cx="19" cy="12" rx="2.6" ry="4" fill="#f0cf94"/><path d="M8 11h5" fill="none"/>'),
    stone: SV('<path d="M4 18l2.5-7 5-4 6 2 2.5 9z" fill="#aab3c2"/><path d="M11.5 7l1 5 7 6M6.5 11l6 1" fill="none"/>'),
    food: SV('<circle cx="8.5" cy="14" r="4" fill="#e0457b"/><circle cx="15.5" cy="14" r="4" fill="#e0457b"/><circle cx="12" cy="9" r="3.6" fill="#ff6f9a"/><path d="M12 5.5c1-2 3-2.5 4.5-2" fill="none"/>'),
    build: SV('<path d="M4 20l9-9" fill="none" stroke-width="3.4"/><path d="M4 20l9-9" fill="none" stroke="#c98a4b" stroke-width="1.6"/><path d="M10.5 6.5l4-3 6 6-3 4z" fill="#8f97a6"/>'),
    bed: SV('<path d="M3 18V7M3 13h18v5M21 18v-5" fill="none"/><rect x="3" y="10" width="7" height="3" rx="1.5" fill="#fff"/><path d="M10 13v-2.5h8a3 3 0 0 1 3 3V13z" fill="#ff9fc0"/>'),
    home: SV('<path d="M3.5 11.5L12 4l8.5 7.5" fill="none"/><path d="M6 10v10h12V10" fill="#ffd9a8"/><rect x="10" y="14" width="4" height="6" fill="#b07a45"/>'),
    garden: SV('<rect x="3" y="14" width="18" height="6" rx="1" fill="#b07a45"/><circle cx="8" cy="11" r="3" fill="#7fd36a"/><circle cx="16" cy="11" r="3" fill="#7fd36a"/><circle cx="8" cy="11" r="1" fill="#e0457b"/><circle cx="16" cy="11" r="1" fill="#e0457b"/>'),
    woodshed: SV('<path d="M3 10l9-5 9 5" fill="#c4553e"/><path d="M5 10v10h14V10" fill="#ffe7c2"/><rect x="7" y="14" width="10" height="2.6" rx="1.3" fill="#b07a45"/><rect x="7" y="16.6" width="10" height="2.6" rx="1.3" fill="#b07a45"/>'),
    quarry: SV('<path d="M2.5 20l4-9 4 3 3-7 8 13z" fill="#aab3c2"/><path d="M13.5 7l2 6" fill="none"/>'),
    lantern: SV('<path d="M6 21V9M18 21V9" fill="none"/><path d="M4 9h4l-1-3H5zM16 9h4l-1-3h-2z" fill="#ffd36a"/><path d="M8 21c1.5-4 6.5-4 8 0" fill="none" stroke-dasharray="2 2"/>'),
    lock: SV('<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none"/><rect x="5.5" y="11" width="13" height="9" rx="2" fill="#b9a7ff"/>'),
    nourish: SV('<path d="M5 19C5 10 11 4.5 19.5 4.5 19.5 13 14 19 5 19z" fill="#7fd36a"/><path d="M5 19l8-8" fill="none"/>'),
    protect: SV('<path d="M12 2.5l7.5 3v5.5c0 5-3.3 8.7-7.5 10.5C7.8 19.7 4.5 16 4.5 11V5.5z" fill="#a9c0d6"/>'),
    spirit: SV('<path d="M9 17.5a2.8 2.8 0 1 1-1.8-2.6V5.5l10-2v11a2.8 2.8 0 1 1-1.8-2.6V7l-6.4 1.3z" fill="#ff9fd0"/>'),
    sap: SV('<path d="M8 3h8v3l2 3v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9l2-3z" fill="#ffb84a"/><path d="M6 12h12" fill="none"/>'),
    orb: SV('<path d="M12 2.5l2.6 6.4 6.9.5-5.3 4.5 1.7 6.7L12 17l-5.9 3.6 1.7-6.7-5.3-4.5 6.9-.5z" fill="#ffe066"/>'),
    heart: SV('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="#ff7aa8"/>'),
    star: SV('<path d="M12 2.5l2.6 6.4 6.9.5-5.3 4.5 1.7 6.7L12 17l-5.9 3.6 1.7-6.7-5.3-4.5 6.9-.5z" fill="#c69bff"/>'),
    clock: SV('<circle cx="12" cy="12" r="9" fill="#fff"/><path d="M12 7v5l3 2" fill="none"/>'),
    sun: SV('<circle cx="12" cy="12" r="4.6" fill="#ffd23f"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" fill="none"/>'),
    moon: SV('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" fill="#ffe9a8"/><circle cx="18.5" cy="5" r="1" fill="#fff"/>'),
    dusk: SV('<path d="M4 16a8 8 0 0 1 16 0z" fill="#ff9c6a"/><path d="M2.5 16h19M5 19.5h14M12 4v3M5.5 7.5l1.6 1.6M18.5 7.5l-1.6 1.6" fill="none"/>'),
    seed: SV('<path d="M12 21c-4.2 0-6.5-3.2-6.5-7.2C5.5 9 9 5 12 3c3 2 6.5 6 6.5 10.8 0 4-2.3 7.2-6.5 7.2z" fill="#c9a26a"/><path d="M12 8v9" fill="none"/>'),
    gift: SV('<rect x="3.5" y="9" width="17" height="11.5" rx="1.5" fill="#ff8fc8"/><rect x="2.5" y="6.5" width="19" height="4" rx="1.2" fill="#ffb3dc"/><path d="M12 6.5v14" fill="none"/><path d="M12 6.5C10 2.5 6.5 3 7 5.2c.4 1.6 3.4 1.3 5 1.3 1.6 0 4.6.3 5-1.3.5-2.2-3-2.7-5 1.3z" fill="#ffd23f"/>'),
    photo: SV('<rect x="3" y="7" width="18" height="13" rx="2.5" fill="#9fd8ff"/><path d="M8.5 7l1.6-2.6h3.8L15.5 7" fill="#cfe9ff"/><circle cx="12" cy="13.5" r="3.6" fill="#fff6dc"/><circle cx="17.6" cy="10" r="0.9" fill="#ffd23f" stroke="none"/>'),
    scarf: SV('<path d="M4 8c5 3 11 3 16 0l-1 4c-4 2.5-10 2.5-14 0z" fill="#9b7bff"/><path d="M14 12.5l1.5 8 3-1-1.5-7.8" fill="#c69bff"/>'),
    jar: SV('<rect x="6" y="7" width="12" height="13.5" rx="3" fill="#cfe9ff"/><rect x="7.5" y="3.5" width="9" height="3.5" rx="1" fill="#b07a45"/><circle cx="10" cy="12" r="1.3" fill="#ffe066" stroke="none"/><circle cx="14" cy="15.5" r="1.3" fill="#ffe066" stroke="none"/><circle cx="11" cy="17.5" r="1" fill="#c8ff7a" stroke="none"/>'),
    board: SV('<path d="M3 13.5h18c-1 4-4.5 6.5-9 6.5s-8-2.5-9-6.5z" fill="#c98a4b"/><path d="M12 13.5V8" fill="none"/><path d="M4 8.5C7 3.5 17 3.5 20 8.5c-4-1.5-12-1.5-16 0z" fill="#7fd36a"/>'),
    crystal: SV('<path d="M12 2.5l5.5 6-5.5 13-5.5-13z" fill="#9fe8ff"/><path d="M6.5 8.5h11M12 2.5l-2 6 2 13 2-13z" fill="none"/>'),
    decor: SV('<path d="M5 13a7 7 0 0 1 14 0z" fill="#ff8fc8"/><circle cx="9" cy="10.5" r="1.2" fill="#fff" stroke="none"/><circle cx="14.5" cy="9.5" r="1" fill="#fff" stroke="none"/><path d="M10 13v6.5h4V13" fill="#fff6dc"/>'),
    isle: SV('<path d="M3 11h18l-4 4-2 5-3-3-3 4-2-6z" fill="#aab3c2"/><path d="M3 11c1-3 4-4 9-4s8 1 9 4z" fill="#7fd36a"/><circle cx="16" cy="5.5" r="2" fill="#ffd36a"/>'),
    paw: SV('<ellipse cx="12" cy="16" rx="5" ry="4" fill="#ffb27a"/><circle cx="6" cy="10" r="2.2" fill="#ffb27a"/><circle cx="10" cy="6.5" r="2.2" fill="#ffb27a"/><circle cx="14" cy="6.5" r="2.2" fill="#ffb27a"/><circle cx="18" cy="10" r="2.2" fill="#ffb27a"/>'),
    // step 4
    bell: SV('<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" fill="#ffd23f"/><path d="M10 21h4" fill="none"/>'),
    blight: SV('<path d="M5 15c-1-4 2-7 5-6 1-3 6-3 7 0 3 0 4 4 2 6 1 3-2 5-4 4-2 2-6 2-7 0-3 0-4-2-3-4z" fill="#6a3a8c"/><circle cx="10" cy="13" r="1.2" fill="#d9a8ff" stroke="none"/><circle cx="14.5" cy="11.5" r="1" fill="#d9a8ff" stroke="none"/>'),
    ward: SV('<path d="M12 2.5l4 5-1.5 11h-5L8 7.5z" fill="#9fe8ff"/><path d="M5 21h14" fill="none"/><path d="M12 2.5v16" fill="none"/>'),
    fruit: SV('<circle cx="12" cy="14" r="6.5" fill="#ffd45e"/><path d="M12 7.5c0-2 1-3.5 3-4" fill="none"/><path d="M12.5 6.5c2.5-2.5 6-1.5 6.5 0-2 1.5-4.5 1.5-6.5 0z" fill="#7fd36a"/>'),
    rain: SV('<path d="M6 13a4 4 0 0 1 1-7.8A5 5 0 0 1 17 6a3.5 3.5 0 0 1 1 7z" fill="#cfe4f7"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" fill="none"/>'),
    cart: SV('<path d="M3 9h18l-2 7H5z" fill="#ffb347"/><path d="M3 9l2-4h14l2 4" fill="#ff8fc8"/><circle cx="8" cy="19" r="2" fill="#fff"/><circle cx="16" cy="19" r="2" fill="#fff"/>'),
    wish: SV('<path d="M4 5h16v10H10l-4 4v-4H4z" fill="#fff"/><path d="M12 7.2l1.2 2.4 2.6.3-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.3z" fill="#ffd23f"/>'),
    friends: SV('<path d="M8.5 18s-5-3-5-6.6A2.9 2.9 0 0 1 8.5 9.6a2.9 2.9 0 0 1 5 1.8c0 3.6-5 6.6-5 6.6z" fill="#ff9fc0"/><path d="M15.5 14.5s-5-3-5-6.6a2.9 2.9 0 0 1 5-1.8 2.9 2.9 0 0 1 5 1.8c0 3.6-5 6.6-5 6.6z" fill="#ff7aa8"/>'),
    stage: SV('<path d="M3 20h18v-3H3z" fill="#c98a4b"/><path d="M4 17V8l8-4 8 4v9" fill="#ff9fd0"/><path d="M10 13.5a1.6 1.6 0 1 1-1-1.5V8l5-1v5.5a1.6 1.6 0 1 1-1-1.5V9l-3 .6z" fill="#fff"/>'),
    conserv: SV('<path d="M4 20V11a8 8 0 0 1 16 0v9z" fill="#cdf3e6"/><path d="M12 3v17M4 13h16" fill="none"/><circle cx="8" cy="17" r="2" fill="#7fd36a"/><circle cx="16" cy="17" r="2" fill="#7fd36a"/>'),
    sprout: SV('<path d="M12 21v-9" fill="none"/><path d="M12 13c-5 0-7-3-7-6 4 0 7 2 7 6zM12 11c0-4 3-6 7-6 0 3-2 6-7 6z" fill="#7fd36a"/><circle cx="12" cy="5" r="2" fill="#ffd45e"/>'),
    // step 5
    hall: SV('<path d="M3 10l9-6 9 6" fill="#8ea9c4"/><path d="M5 10v10h14V10" fill="#dfe8f2"/><path d="M12 11.5l3 1.2v2.4c0 2-1.4 3.4-3 4-1.6-.6-3-2-3-4v-2.4z" fill="#a9c0d6"/>'),
    school: SV('<path d="M3 11l9-6 9 6" fill="#ffb3a0"/><path d="M5 11v9h14v-9" fill="#fff1d6"/><path d="M12 19v-4" fill="none"/><path d="M12 15.5c-2.6 0-3.6-1.6-3.6-3.2 2 0 3.6 1 3.6 3.2zM12 14.5c0-2.2 1.6-3.2 3.6-3.2 0 1.6-1 3.2-3.6 3.2z" fill="#7fd36a"/>'),
    circus: SV('<path d="M3 19l3-10h12l3 10z" fill="#ff8fc8"/><path d="M6 9l6-6 6 6z" fill="#ffd23f"/><path d="M9 19l1.5-10M15 19l-1.5-10" fill="none"/><path d="M12 3V1.5l3 1-3 1" fill="#ff5f8f"/>'),
    anvil: SV('<path d="M4 8h13c0 2.5 2 3 3.5 3-1 2-3 2.5-5 2.5H11c-1 0-2-1-2-2.5H6C4.5 11 4 9.5 4 8z" fill="#8f97a6"/><path d="M9 13.5h6l1 4H8z" fill="#6a7180"/><path d="M6 20h12" fill="none"/>'),
    fest: SV('<path d="M4 6c5 3 11 3 16 0" fill="none"/><path d="M6 7l-1 5 3-1zM12 9l-1 5 3-1zM18 7l-1 5 3-1z" fill="#ff8fc8"/><circle cx="8.5" cy="18" r="2.5" fill="#ffd23f"/><circle cx="15.5" cy="18" r="2.5" fill="#7fd6ff"/>'),
    book: SV('<path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1z" fill="#c69bff"/><path d="M20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z" fill="#ffd9a8"/>'),
    spring: SV('<circle cx="12" cy="7" r="3" fill="#ffb3d0"/><circle cx="7.5" cy="11" r="3" fill="#ffb3d0"/><circle cx="16.5" cy="11" r="3" fill="#ffb3d0"/><circle cx="9.5" cy="15.5" r="3" fill="#ffb3d0"/><circle cx="14.5" cy="15.5" r="3" fill="#ffb3d0"/><circle cx="12" cy="12" r="2" fill="#ffd23f"/>'),
    summer: SV('<circle cx="12" cy="12" r="4.6" fill="#ffb02e"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" fill="none"/>'),
    autumn: SV('<path d="M12 21v-5M12 3l2 4 4-1-1 4 3 2-4 1 1 3-5-2-5 2 1-3-4-1 3-2-1-4 4 1z" fill="#f2832d"/>'),
    winter: SV('<path d="M12 2.5v19M4 7l16 10M20 7L4 17M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" fill="none" stroke="#5aa8e0"/><circle cx="12" cy="12" r="2" fill="#dff1ff"/>'),
    // Round 2 step 2
    tree: SV('<path d="M10.5 21l.6-6h1.8l.6 6z" fill="#b07a45"/><path d="M12 3.5c-3.6 0-6.5 2.6-6.5 5.8 0 1 .3 1.9.8 2.7-.6.6-.9 1.3-.9 2.1 0 2 1.9 3.4 4.1 3.4h5c2.2 0 4.1-1.5 4.1-3.4 0-.8-.3-1.5-.9-2.1.5-.8.8-1.7.8-2.7 0-3.2-2.9-5.8-6.5-5.8z" fill="#7fd36a"/><circle cx="9.5" cy="9" r="1" fill="#ffe066" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="#ffe066" stroke="none"/>'),
    diary: SV('<rect x="5" y="3" width="14" height="18" rx="2" fill="#ffd9a8"/><path d="M5 3h3v18H5z" fill="#c98a4b"/><path d="M11 8h5M11 11.5h5M11 15h3" fill="none"/>'),
    critter: SV('<ellipse cx="12" cy="14" rx="6.5" ry="7" fill="#a99ad0"/><path d="M6.5 9.5L7 4.5l3.5 3M17.5 9.5L17 4.5l-3.5 3" fill="#7e6cae"/><circle cx="9.5" cy="12" r="2.4" fill="#9ff0ff"/><circle cx="14.5" cy="12" r="2.4" fill="#9ff0ff"/><circle cx="9.5" cy="12" r="1" fill="#2a2442" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="#2a2442" stroke="none"/><path d="M11 15l1 1.6 1-1.6z" fill="#f0a63c"/>'),
    memory: SV('<path d="M12 2.5c4 3 6.5 6.3 6.5 10a6.5 6.5 0 0 1-13 0c0-3.7 2.5-7 6.5-10z" fill="#9fe8ff"/><path d="M12 8.5v8M9 12.5l3 3 3-3" fill="none"/>'),
  };
  // vibe pass 2 lane B: one icon per pup personality (src/traits.js)
  const TRAIT_IC = {
    sleepy: SV('<path d="M16 15.5A6.5 6.5 0 1 1 9.5 7a5 5 0 0 0 6.5 8.5z" fill="#b9a7ff"/><path d="M15 3.5h4l-4 4h4" fill="none" stroke-width="1.7"/>'),
    brave: SV('<path d="M12 21c-4 0-6-2.6-6-5.6 0-3.6 3-5.2 3.6-9.4 2.4 1.6 3.4 3.6 3.2 5.6 1-.6 1.6-1.8 1.8-3 2 1.6 3.4 3.8 3.4 6.6 0 3.2-2.4 5.8-6 5.8z" fill="#ff9a4a"/>'),
    foodie: SV('<circle cx="12" cy="12" r="8" fill="#e8b46a"/><circle cx="9" cy="10" r="1.3" fill="#6b4a2e" stroke="none"/><circle cx="14.5" cy="9" r="1.2" fill="#6b4a2e" stroke="none"/><circle cx="13.2" cy="14.6" r="1.4" fill="#6b4a2e" stroke="none"/><circle cx="8.6" cy="14.6" r="1" fill="#6b4a2e" stroke="none"/>'),
    poet: SV('<path d="M19.5 3.5c1 6.5-3 11.3-10 12.3l-2.2 1c1-7.2 5-12.3 12.2-13.3z" fill="#9fd8ff"/><path d="M19.5 3.5C13 5 9 10 7.3 16.8L5 20.5M12.5 11l-3-1" fill="none"/>'),
    curious: SV('<circle cx="10" cy="10" r="6" fill="#d8f3ff"/><path d="M14.5 14.5L20 20" fill="none" stroke-width="3.2"/><path d="M7.5 8.5a3 3 0 0 1 2.5-1.5" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    cuddly: SV('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="#ffb3cf"/><path d="M8.3 10.6c.6-1.3 1.8-1.9 3-1.6" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    bouncy: SV('<circle cx="14.5" cy="9.5" r="5.5" fill="#7ee08a"/><path d="M3.5 19c2-1.2 3.6-1.2 5.2 0M4.5 14.6c1.4-.8 2.5-.8 3.6 0" fill="none" stroke-width="1.7"/>'),
    tidy: SV('<path d="M12 3l2 6.5L20.5 12 14 14l-2 7-2-7-6.5-2L10 9.5z" fill="#8fe8e0"/>'),
  };
  const traitOf = i => window.Traits && S && S.pups[i] ? Traits.of(S, i) : null;
  // a small chip: icon (+ the name unless short); the tooltip says what the trait means
  function traitChip(i, short) { const t = traitOf(i); if (!t) return ''; const I = Traits.INFO[t]; return `<span class="trt t-${t}" title="${I.name}: ${I.what}">${TRAIT_IC[t] || ''}${short ? '' : I.name}</span>`; }
  // UI voice pass: display names only (keys = the sim's ids, never change them). One name = one thing everywhere.
  const NEED_NAMES = { water: 'Water', light: 'Light', nourish: 'Roots', protect: 'Ward', spirit: 'Song' };
  const NEED_TIP = { water: 'Water: fed by spring carriers (and rain)', light: 'Light: fed by lamplighters and lantern walks', nourish: 'Roots: fed by root gardeners and berry patches',
    protect: 'Ward: kept by wardens and crystal wards', spirit: 'Song: fed by minstrels' };
  const JOB_NAMES = { water: 'Spring carrier', light: 'Lamplighter', wood: 'Woodcutter', stone: 'Stonemason', food: 'Berry picker', build: 'Builder', rest: 'Napping', nourish: 'Root gardener', protect: 'Warden', spirit: 'Minstrel' };
  const JOB_WHO = { nourish: 'Root gardeners', protect: 'Wardens', spirit: 'Minstrels' };
  // the assign toast: "Pudding heads for the spring"
  const JOB_GO = { water: 'heads for the spring', light: 'goes to light the lamps', wood: 'heads into the woods', stone: 'heads for the rocks', food: 'goes berry picking',
    build: 'picks up a hammer', rest: 'curls up for a nap', nourish: 'goes to tend the roots', protect: 'stands watch', spirit: 'tunes up for a song' };
  const B_ICON = { home: 'home', garden: 'garden', woodshed: 'woodshed', quarry: 'quarry', lantern: 'lantern', board: 'board', stage: 'stage', conserv: 'conserv',
    hush: 'hall', sprout: 'school', market: 'cart', greenhold: 'conserv', circus: 'circus', forge: 'anvil', nook: 'decor' };
  const STATUS = {
    water: { idle: 'stretching', go: 'off to the spring', fill: 'filling a bucket', carry: 'carrying a full bucket', pour: 'giving the tree a drink' },
    light: { idle: 'stretching', go: 'off to the lamp shrine', light: 'lighting a lantern', carry: 'carrying light to an orb', tend: 'tending a glow orb' },
    rest: { idle: 'yawning', go: 'off to find a cozy spot', rest: 'napping' },
    wood: { idle: 'stretching', go: 'off to the woods', work: 'chopping wood', carry: 'carrying logs', drop: 'stacking logs' },
    stone: { idle: 'stretching', go: 'off to the rocks', work: 'chipping stone', carry: 'hauling stone', drop: 'piling stone' },
    food: { idle: 'stretching', go: 'off berry picking', work: 'picking berries', carry: 'bringing berries', drop: 'filling the pantry' },
  };
  function statusOf(p) {
    if (p.exp) {
      const tr = S.exp.trips.find(x => x.id === p.exp), d = tr && Exped.DEST[tr.dest]; if (!tr) return 'away on a skyboat';
      if (p.phase === 'go') return 'off to the skyboat dock';
      if (p.phase === 'board') return 'aboard, waiting for the crew';
      return `exploring ${d.name}, home in ${fmtT(Math.max(0, tr.dep + tr.dur - S.time))}`;
    }
    if (p.phase === 'arrive') return p.parents ? 'a brand-new puppy!' : 'crossing the bridge to a new home';
    if (p.task === 'garden') return { go: p.tgt >= 0 ? 'off to the garden' : 'off to the root beds', plant: S.inv.seeds > 0 ? 'planting a seed' : 'tending the beds', carry: S.garden.sprouts.length ? 'bringing glow fruit' : 'bringing compost', feed: 'feeding the roots' }[p.phase] || 'tending the roots';
    if (p.task === 'blight') return p.phase === 'clear' ? 'sweeping away blight' : 'off to a blight patch';
    if (p.task === 'patrol') return p.phase === 'watch' ? 'keeping watch' : 'walking the rounds';
    if (p.task === 'stage' || p.task === 'busk') return p.phase === 'play' ? (p.task === 'stage' ? 'playing on the moonlit stage' : 'busking on the plaza') : p.task === 'stage' ? 'off to the stage' : 'off to play music';
    if (p.phase === 'nap') return 'a sleepy night nap';
    if (p.job === 'rest' && p.task === null && Needs.firstBuilt(S, 'stage') !== null && S.pups.some(q => q.job === 'spirit' && !q.exp)) return p.phase === 'rest' ? (S.pups.some(q => q.phase === 'play' && q.task === 'stage') ? 'dancing at the show' : 'waiting for the music') : 'off to the show';
    if (p.task === 'nap') return 'yawning, off for a nap';
    if (p.job === 'build') {
      if (p.task === 'site') return p.phase === 'build' ? 'building' : 'off to the building site';
      if (p.task === 'wood' || p.task === 'stone') return (STATUS[p.task][p.phase] || 'fetching ' + p.task) + ' for a build';
      if (p.task === 'wait') { const pl = S.queue.length ? planNow() : null, m = pl ? pl.miss.filter(x => !FETCH[x.k]) : []; return m.length ? 'waiting for ' + m.map(x => RES_N[x.k]).join(' + ') : pl ? 'about to start building' : 'waiting for plans'; }
      return 'getting ready';
    }
    return (STATUS[p.job] || {})[p.phase] || '';
  }

  let map, nav, S, pups, fx, plots, ground, dn, expFx, nfx, seaFx, crFx = null, wfx = null, landFx = null, life = null, steer = null, booted = false, bootAt = 0;   // wfx = vibe pass 2 living world (src/world_fx.js)
  const newSeed = () => (+Q.get('seed') >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;   // ?seed=N (tests)   // a fresh island's event seed (the sim itself never uses Math.random)
  const ev = [];

  // ---- height grid from the ground + path stones meshes (max height per 2 m cell), so pups stand on the terrain
  function buildGround(m) {
    const parts = m.batches.filter(b => b.terrain && (b.key === 'terrain:EG_Map_Ground' || b.key === 'terrain:EG_Map_PathStones'));
    const box = new THREE.Box3(); parts.forEach(b => box.union(b.geo.boundingBox));
    const C = 2, x0 = box.min.x, z0 = box.min.z, nx = Math.ceil((box.max.x - x0) / C) + 1, nz = Math.ceil((box.max.z - z0) / C) + 1;
    const g = new Float32Array(nx * nz).fill(-1e9);
    for (const b of parts) {
      const P = b.geo.attributes.position.array, I = b.geo.index.array;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3;
        const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[bb], by = P[bb + 1], bz = P[bb + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / C)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / C));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / C)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / C));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = x0 + i * C, pz = z0 + j * C;
          const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w3 = 1 - w1 - w2;
          if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
          const y = w1 * ay + w2 * by + w3 * cy, k = j * nx + i; if (y > g[k]) g[k] = y;
        }
        for (const [vx, vy, vz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {   // tiny triangles: splat the vertices too
          const i = Math.round((vx - x0) / C), j = Math.round((vz - z0) / C); if (i >= 0 && j >= 0 && i < nx && j < nz && vy > g[j * nx + i]) g[j * nx + i] = vy;
        }
      }
    }
    const cell = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? -1e9 : g[j * nx + i];
    // step 6 (walker): the plain terrain height, or null off the map (no fallback / bridge rules)
    const raw = (x, z) => {
      const fx = (x - x0) / C, fz = (z - z0) / C, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = cell(i, j), b = cell(i + 1, j), c = cell(i, j + 1), d = cell(i + 1, j + 1);
      if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) { const mx = Math.max(a, b, c, d); return mx > -1e8 ? mx : null; }
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
    return Object.assign((x, z, fallback, bridge) => {
      const fx = (x - x0) / C, fz = (z - z0) / C, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = cell(i, j), b = cell(i + 1, j), c = cell(i, j + 1), d = cell(i + 1, j + 1);
      if (a < -1e8 || b < -1e8 || c < -1e8 || d < -1e8) { const mx = Math.max(a, b, c, d); return mx > -1e8 ? (bridge ? Math.max(mx, fallback) : mx) : fallback; }
      const y = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      return bridge ? Math.max(y, fallback) : (Math.abs(y - fallback) > 12 ? fallback : y);
    }, { raw });
  }

  // ---- where the water is (rivers, lake, waterfalls): 3 m cells under any water triangle's box; ok(x, z) = no water
  // within ~8 m (decor spots never land in or on the edge of a river). Since step 4 the game uses the same cells from
  // data/water_cells.json (nav.js); this mesh version only re-makes / checks that file (__game.waterRuns / spotCheck).
  function waterRuns(m) {
    const cells = waterFree(m).cells, pairs = [];
    for (const k of cells) { let i = Math.round(k / 100003), j = k - i * 100003; if (j > 50000) { j -= 100003; i += 1; } else if (j < -50000) { j += 100003; i -= 1; } pairs.push([i, j]); }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const runs = []; for (const [i, j] of pairs) { const r = runs[runs.length - 1]; if (r && r[0] === i && r[2] === j - 1) r[2] = j; else runs.push([i, j, j]); }
    return runs;
  }
  // pathing pass: data/water_cells.json `fine` = 1 m cells whose centre is inside a water triangle AND whose water is >= 0.4 m
  // deep over the ground grid (the river sheets run on under the banks; the shallow rim is shore). __game.waterFine() re-makes them.
  function waterFine(m) {
    const cells = new Map();
    for (const geo of m.batches.filter(b => b.terrain && b.inst[0] && b.inst[0].role === 'water').flatMap(b => [b.geo].concat(b.see.map(s => s.geo))).filter(x => x && x.index)) {
      const A = geo.attributes.position, I = geo.index.array;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], c = I[t + 1], d = I[t + 2], ax = A.getX(a), ay = A.getY(a), az = A.getZ(a), bx = A.getX(c), by = A.getY(c), bz = A.getZ(c), cx = A.getX(d), cy = A.getY(d), cz = A.getZ(d);
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
        for (let i = Math.floor(Math.min(ax, bx, cx)); i <= Math.floor(Math.max(ax, bx, cx)); i++) for (let j = Math.floor(Math.min(az, bz, cz)); j <= Math.floor(Math.max(az, bz, cz)); j++) {
          const px = i + 0.5, pz = j + 0.5, w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w3 = 1 - w1 - w2;
          if (w1 < 0 || w2 < 0 || w3 < 0) continue;
          const k = i + ',' + j, wy = w1 * ay + w2 * by + w3 * cy; if (!cells.has(k) || cells.get(k) < wy) cells.set(k, wy);
        }
      }
    }
    const keep = []; for (const [k, wy] of cells) { const [i, j] = k.split(',').map(Number), g = ground.raw(i + 0.5, j + 0.5); if (g === null || g < wy - 0.4) keep.push([i, j]); }
    keep.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const runs = []; for (const [i, j] of keep) { const r = runs[runs.length - 1]; if (r && r[0] === i && r[2] === j - 1) r[2] = j; else runs.push([i, j, j]); }
    return runs;
  }
  function waterFree(m) {
    const parts = m.batches.filter(b => b.terrain && b.inst[0] && b.inst[0].role === 'water'), C = 3, cells = new Set();
    for (const geo of parts.flatMap(b => [b.geo].concat(b.see.map(s => s.geo))).filter(x => x && x.index)) {   // water is mostly see-through parts
      const P = geo.attributes.position.array, I = geo.index.array;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3;
        const ax = P[a], az = P[a + 2], bx = P[c], bz = P[c + 2], cx = P[d], cz = P[d + 2];
        for (const [vx, vz] of [[ax, az], [bx, bz], [cx, cz]]) cells.add(Math.floor(vx / C) * 100003 + Math.floor(vz / C));
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
        const i0 = Math.floor(Math.min(ax, bx, cx) / C), i1 = Math.floor(Math.max(ax, bx, cx) / C), j0 = Math.floor(Math.min(az, bz, cz) / C), j1 = Math.floor(Math.max(az, bz, cz) / C);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {   // cell centres inside the triangle (a little slack)
          const px = (i + 0.5) * C, pz = (j + 0.5) * C, w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
          if (w1 > -0.1 && w2 > -0.1 && 1 - w1 - w2 > -0.1) cells.add(i * 100003 + j);
        }
      }
    }
    const ok = (x, z) => { const i = Math.floor(x / C), j = Math.floor(z / C); for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (cells.has((i + di) * 100003 + j + dj)) return false; return true; };
    ok.cells = cells; return ok;
  }

  // ---- where the trunk + roots are: low vertices (piece space y < 14) of the tree batch on a 1 m grid; a nap spot is
  // clear if no such cell lies within 3.5 m (world) of it at that tree scale
  function treeClear(m, nav) {
    const b = m.batches.find(x => x.key === 'EG_ElderTree'); if (!b || !b.geo) return null;
    const P = b.geo.attributes.position.array, cells = new Set();
    for (let i = 0; i < P.length; i += 3) if (P[i + 1] < 14) cells.add(Math.round(P[i]) + ',' + Math.round(P[i + 2]));
    const TP = nav.TP, ry = nav.tree.ry || 0, cs = Math.cos(-ry), sn = Math.sin(-ry);
    return (x, z, s) => {
      const wx = (x - TP[0]) / s, wz = (z - TP[2]) / s, lx = wx * cs + wz * sn, lz = -wx * sn + wz * cs, R = 3.5 / s;
      for (let i = Math.floor(lx - R); i <= Math.ceil(lx + R); i++) for (let j = Math.floor(lz - R); j <= Math.ceil(lz + R); j++)
        if ((i - lx) * (i - lx) + (j - lz) * (j - lz) <= R * R && cells.has(i + ',' + j)) return false;
      return true;
    };
  }

  // ---- start state of the island: no houses / factions / market / floating isles yet, a thinner forest, no garden plots
  function startIsland(m) {
    const L = m.layout;
    for (const r of ['house', 'faction', 'market', 'isle']) m.setRole(r, false);
    for (const b of m.batches) for (const i of b.inst) {
      if (i.pid < 0) continue; const p = L.placements[i.pid]; if (!p) continue;
      if (i.role === 'forest' && !Nav.keepForest(i.pid)) { i.role = 'later'; i.thin = true; }   // thin: grows back with the tree (growLand)
      else if (p.piece === 'EG_GardenBox' || p.piece === 'EG_Brazier') i.role = 'plot';
    }
    m.invalidate();
  }

  // ---- save / load
  let lastSave = 0;
  function save() {
    if (!S || Q.get('nosave') === '1' || VISIT || noSaves) return;   // a visit never writes anything to the visitor's own save
    // step 7: sync = the cloud bookkeeping (src/cloud.js: save counter, last matched cloud copy); state is unchanged (v7)
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ savedAt: Date.now(), state: S, sync: cloud ? cloud.stamp() : undefined })); lastSave = performance.now(); } catch (e) { /* storage full / private mode: keep playing */ }
  }
  function load() {
    if (cloud) cloud.setMeta(null);
    if (Q.get('reset') === '1') { try { if (Q.get('nosave') !== '1') { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_KEY); } } catch (e) {} return { state: Sim.create(nav, newSeed()), away: 0, fresh: true }; }
    let raw = null, migrated = false; try { raw = localStorage.getItem(SAVE_KEY); if (!raw) { raw = localStorage.getItem(OLD_KEY); migrated = !!raw; } } catch (e) {}
    if (!raw) return { state: Sim.create(nav, newSeed()), away: 0, fresh: true };
    let obj = null; try { obj = JSON.parse(raw); } catch (e) {}
    if (cloud && obj && !migrated) cloud.setMeta(obj.sync);
    const st = obj && Sim.sanitize(obj.state, nav);
    if (!st) { try { if (Q.get('nosave') !== '1') localStorage.setItem(SAVE_KEY + '.corrupt', raw); } catch (e) {} return { state: Sim.create(nav, newSeed()), away: 0, fresh: true, corrupt: true }; }
    let away = (Date.now() - (+obj.savedAt || Date.now())) / 1000 + (+Q.get('away') || 0);
    if (!isFinite(away) || away < 0) away = 0;   // clock went backwards: no catch-up, nothing lost
    return { state: st, away, migrated, fromV: obj.state.v };
  }

  // ---- step 7: account changes + reloads that must not re-save the island being replaced
  function reloadClean(text, after) {
    noSaves = true; if (text) toast(text, 3000);
    try { if (after) sessionStorage.setItem('schiffy-elderglow.after' + SLOT, after); } catch (e) {}   // a toast for the next start
    setTimeout(() => location.replace(location.pathname + location.search), 300);
  }
  async function onAccount(id) {
    if (!id) return;
    if (soc && soc.accountChanged) soc.accountChanged();
    if (!cloud || !CLOUD_ON) return;
    const r = await cloud.accountChanged(id);
    if (r && r.d === 'upload') toast(`${cloudUI.IX.cloud} Signed in! This island now lives safely in your account.`, 4200);
    else if (r && r.d === 'same') toast(`${cloudUI.IX.cloud} Signed in!`, 2400);
  }
  async function cloudSignOut() {
    if (!cloud || !CLOUD_ON) { await NET.signOut(); toast('Signed out (test window: the island stays)', 3000); if (cloudUI) cloudUI.closeSafe(); return; }
    save(); if (cloud.dirty) await cloud.flush('sign-out');
    noSaves = true; await cloud.signOut();
    reloadClean('Signed out. A fresh little island stirs here...', 'Signed out. Your island sleeps safe in the cloud: Visit > I already have an island brings it back.');
  }

  // ---- UI helpers
  const fmtT =s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h${m ? ' ' + m + ' min' : ''}` : m ? `${m} min` : `${s} s`; };
  const fmtN = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : Math.floor(v).toLocaleString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ---- vibe pass 1: ONE message at a time. Every toast (the game's + social / lanterns / cloud / app, which all get this
  // function) goes through one queue: at most 2 on screen (phone 1), never the same text twice, held while a big card or
  // the return tour is up (they would sit under it), placed below the tree's words bubble; a plain note that waited over a
  // minute is dropped (one with a tap action waits).
  const TQ = { q: [], live: [] };
  const toastKey = html => String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  function toast(html, ms, onClick) {
    const key = toastKey(html), now = performance.now(), L = TQ.live.find(t => t.key === key);
    if (L) { L.until = Math.max(L.until, now + (ms || 3200)); return; }
    if (TQ.q.some(t => t.key === key)) return;
    TQ.q.push({ html, ms: ms || 3200, onClick, key, at: now, user: now - lastInput < 1200 });   // (user = the player just did something: it answers them)
    if (TQ.q.length > 8) { const k = TQ.q.findIndex(t => !t.onClick); TQ.q.splice(k >= 0 ? k : 0, 1); }
    pumpToasts();
  }
  // playtest fixes: held while a big card / the tour is up, and never shown over ANY open card (a side card at 1280 px or a
  // phone sheet: placed, measured, and put back if it would sit on one); a toast a card opens over goes back to the queue
  const toastHeld = () => noSaves ? false : (bigOpen() || !!tour);
  // PC: with a side card open the toasts move to the middle of the free space between the side panel and the card (a narrow
  // window would otherwise hold every note, even the answer to what the player just did in that card)
  function placeToasts() {
    const tb = $('toasts'); if (!tb || document.body.classList.contains('phone')) return;
    const cards = openCards(['side', 'menu']), a = app.getBoundingClientRect();
    if (!cards.length) { tb.style.left = ''; tb.style.maxWidth = ''; return; }
    const sd = $('side'), L = sd && cardVis(sd) ? sd.getBoundingClientRect().right - a.left + 10 : 12;
    const R = Math.min(...cards.map(c => c.getBoundingClientRect().left)) - a.left - 10;
    if (R - L >= 240) { tb.style.left = Math.round((L + R) / 2) + 'px'; tb.style.maxWidth = Math.round(R - L) + 'px'; } else { tb.style.left = ''; tb.style.maxWidth = ''; }
  }
  function dropToast(t) { TQ.live = TQ.live.filter(x => x !== t); t.el.classList.add('out'); setTimeout(() => t.el.remove(), 320); }
  function pumpToasts() {
    const now = performance.now();
    for (const t of TQ.live.slice()) if (now >= t.until) dropToast(t);
    if (TQ.live.length || sayOpen) lastBusy = now;
    placeToasts();
    if (!noSaves) for (const t of TQ.live.slice()) if (underCard(t.el)) { dropToast(t); if (t.onClick || t.until - now > 800) TQ.q.unshift({ html: t.html, ms: Math.max(1600, t.until - now), onClick: t.onClick, key: t.key, at: t.at, user: t.user }); }
    if (toastHeld()) return;
    TQ.q = TQ.q.filter(t => t.onClick || now - t.at < 60000);
    const nb = newbie(), max = document.body.classList.contains('phone') || nb ? 1 : 2;
    while (TQ.live.length < max && TQ.q.length) {
      const t = TQ.q[0];
      if (nb && !t.user && !beatOk()) break;   // first launch: one thing at a time, with a breath between (a toast the player caused shows at once)
      const d = document.createElement('div'); d.className = 'toast card' + (t.onClick ? ' click' : ''); d.innerHTML = t.html; d.style.visibility = 'hidden'; $('toasts').appendChild(d);
      if (!noSaves && underCard(d)) { d.remove(); break; }
      TQ.q.shift(); d.style.visibility = '';
      t.el = d; t.until = now + t.ms; TQ.live.push(t); beat();
      if (t.onClick) d.onclick = () => { t.onClick(); dropToast(t); };
    }
    // never over the tree's words: on a PC the bubble sits where the toasts do, so they move just below it
    const ts = $('treeSay'), tb = $('toasts');
    if (ts && !ts.hidden && !document.body.classList.contains('phone')) { const r = ts.getBoundingClientRect(), a = app.getBoundingClientRect(); tb.style.top = Math.round(r.bottom - a.top + 10) + 'px'; }
    else tb.style.top = '';
  }
  setInterval(pumpToasts, 250);
  const healthWord = h => (h = Math.round(h)) >= 80 ? 'Glowing' : h >= 60 ? 'Thriving' : h >= 40 ? 'Drooping' : h >= 20 ? 'Wilting' : 'Fading';   // (playtest fixes c5: from the same rounded value the bar shows)
  const healthCol = h => h >= 80 ? 'linear-gradient(90deg,#5fe0c8,#ffd36a)' : h >= 60 ? 'linear-gradient(90deg,#7fd36a,#b8e86a)' : h >= 40 ? 'linear-gradient(90deg,#ffc53d,#ffa04a)' : 'linear-gradient(90deg,#ff7a59,#c9605a)';
  const bName = (type, q) => type === 'home' ? (Sim.bedsFor(q) >= 4 ? 'Treehouse' : Sim.bedsFor(q) >= 3 ? 'Big pup cottage' : 'Pup cottage') : Sim.C.B[type].name;
  function gives(type, q) {
    const b = Sim.C.B[type];
    if (type === 'home') return `${IC.bed} +${Sim.bedsFor(q)} beds`;
    if (type === 'garden') return `${IC.food} +${b.food} berries an hour`;
    if (type === 'woodshed') return `${IC.wood} +${b.wood} wood an hour, woodcutters +${b.boost * 100}%`;
    if (type === 'quarry') return `${IC.stone} +${b.stone} stone an hour, stonemasons +${b.boost * 100}%`;
    if (type === 'lantern') return `${IC.light} the tree's light +${b.light} an hour`;
    if (type === 'board') return `${IC.isle} skyboat trips to the floating isles`;
    if (type === 'stage') return `${IC.spirit} minstrels play their very best, and a light show at night`;
    if (type === 'conserv') return `${IC.nourish} root gardeners +30 %, +2 sprout beds, +3 roots an hour`;
    // step 5: faction halls + the market
    if (type === 'hush') return `${IC.protect} wardens +40 % and 30 % quicker, blight creeps in 30 % less`;
    if (type === 'sprout') return `${IC.sprout} a little school: friendships + explorer xp x1.5, puppies grow up in 3 h, newcomers arrive happy`;
    if (type === 'market') return `${IC.cart} the wandering trader visits twice as often`;
    if (type === 'greenhold') return `${IC.nourish} root gardeners +30 % more, +2 sprout beds, +3 roots an hour`;
    if (type === 'circus') return `${IC.spirit} minstrels +30 %, music lifts happiness more, +3 song an hour`;
    if (type === 'forge') return `${IC.build} better tools: gathering + building +25 %`;
    if (type === 'nook') return `${IC.decor} a cozy corner: log benches, planters, a little lantern (just for joy)`;
    return '';
  }
  const have = k => k === 'sap' ? S.sap : k === 'seed' ? S.inv.seeds : (S.res[k] || 0);
  // playtest fixes (m3): what a plan is still short of, by its real name, and where it comes from (sim.js shortOf only looks at
  // wood / stone / sap, the things a builder can fetch or wait for; crystals and berries never come from a builder)
  const RES_N = { wood: 'wood', stone: 'stone', sap: 'glow sap', food: 'berries', crystal: 'crystals', seed: 'seeds' };
  const RES_FROM = { wood: 'woodcutters bring it, builders fetch it too', stone: 'stonemasons bring it, builders fetch it too', sap: 'a happy tree makes it',
    food: 'from berry pickers and berry patches', crystal: 'from skyboat trips and happenings', seed: 'from skyboat trips and the gift basket' };
  const FETCH = { wood: 1, stone: 1 };   // the builders fetch these themselves
  const missing = cost => Object.keys(cost).filter(k => have(k) + 1e-9 < cost[k]).map(k => ({ k, n: Math.ceil(cost[k] - have(k)) }));
  const missTxt = (m, from) => m.map(x => `${IC[x.k] || ''}${x.n} ${RES_N[x.k] || x.k}${from ? ` <small>(${RES_FROM[x.k] || ''})</small>` : ''}`).join(from ? '<br>' : ' + ');
  // the plan the builders are working toward (sim.js pickBuild: a paid one, else the first in the queue) and what it lacks
  function planNow() {
    for (const pid of S.queue) { const e = S.plots[pid]; if (e && !e.done && e.paid) return { pid, e, miss: [] }; }
    for (const pid of S.queue) { const e = S.plots[pid], q = nav.plotBy[pid]; if (e && !e.done && q) return { pid, e, q, miss: missing(Sim.costOf(e.type, q)) }; }
    return null;
  }
  const costHtml = cost => Object.keys(cost).map(k => `<span class="cost${have(k) + 1e-9 < cost[k] ? ' short' : ''}">${IC[k]}${cost[k]}</span>`).join('');
  const plotName = q => q.faction ? q.faction.name : q.free ? 'A spot of your own' : `Plot ${q.i + 1}`;

  // ---- UI build
  function buildUI() {
    const nd = $('needs');
    for (const k of Object.keys(Sim.C.NEEDS)) {
      nd.insertAdjacentHTML('beforeend', `<div class="need" data-k="${k}" title="${NEED_TIP[k]} · tap for more">${IC[k]}<span>${NEED_NAMES[k]}</span><div class="bar"><i style="background:var(--${k})"></i></div><span class="tr"></span></div>`);
    }
    nd.addEventListener('click', e => { const r = e.target.closest('.need'); if (r) openNeed(r.dataset.k); });
    $('resbar').innerHTML = [['rB', 'water', 'Buckets poured for the Elder Tree'], ['rS', 'sap', 'Glow sap: a happy tree makes it'], ['rW', 'wood', 'Wood, from the woodcutters'], ['rT', 'stone', 'Stone, from the stonemasons'],
      ['rF', 'food', 'Berries (each pup eats ' + Sim.C.EAT + ' an hour)'], ['rCr', 'crystal', 'Crystals (from skyboat trips; set them as wards against blight)'], ['rSd', 'seed', 'Seeds (root gardeners plant them as glow sprouts)'], ['rBd', 'bed', 'Beds: pups / beds']].map(([id, ic, t]) => `<div title="${t}">${IC[ic]}<span id="${id}">0</span></div>`).join('') +
      `<div id="clockChip" title="Island time follows your own clock. At night the pups nap more and the tree drinks less."><span id="rCi">${IC.sun}</span><span id="rC">--:--</span></div>` +
      `<div id="seaChip"><span id="rSeaI"></span><span id="rSea"></span></div>`;
    $('giftBtn').onclick = () => openGift();
    $('seaChip').onclick = () => openBook('mem');
    $('gClose').onclick = closeGift;
    $('gClaim').onclick = claimGift;
    $('decide').onchange = e => { S.decide = e.target.checked; toast(S.decide ? `${IC.paw} The pups will plan the village themselves` : 'You plan the village again', 2200); save(); refreshBuild(true); };
    $('queue').addEventListener('click', e => { const r = e.target.closest('[data-pid]'); if (r) openPlot(+r.dataset.pid, true); });
    // roster
    $('side').addEventListener('touchstart', () => { sideTouch = performance.now(); }, { passive: true });
    $('filter').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; rosterFilter = b.dataset.f; refreshRoster(true); });
    // playtest fixes: roster search + sort (shows from 8 pups; the sort is a UI pref in its own key, never the save)
    $('filter').insertAdjacentHTML('beforebegin', `<div id="rosterTools" class="full" hidden><input id="rosterQ" type="search" maxlength="14" placeholder="Find a pup" aria-label="Find a pup by name"><select id="rosterSort" aria-label="Sort the pups" title="Sort the pups">${Object.entries(ROSTER_SORTS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>`);
    $('rosterSort').value = rosterSort; $('rosterSort').onchange = e => { rosterSort = e.target.value; try { localStorage.setItem(ROSTER_KEY, JSON.stringify({ sort: rosterSort })); } catch (er) {} refreshRoster(true); };
    $('rosterQ').oninput = e => { rosterQ = e.target.value.trim().toLowerCase(); refreshRoster(true); };
    const ro = $('roster');
    ro.addEventListener('click', e => {
      const row = e.target.closest('.pup'); if (!row) return; const i = +row.dataset.i;
      if (e.target.closest('[data-diary]')) { openDiary(i); return; }
      if (e.target.closest('[data-ward]')) { openWard(i); return; }
      const b = e.target.closest('button[data-job]');
      if (b) { setJob(i, b.dataset.job); return; }
      focusPup(i);
      if (S.pups[i] && S.pups[i].isNew) showAway(null);   // a newcomer not greeted yet: name + first job
    });
    $('sheetBtn').onclick = () => { const o = $('side').classList.toggle('open'); $('sheetBtn').innerHTML = o ? 'Close &#9660;' : 'Pups &#9650;'; if (calm) calm.setPin(o); };   // vibe pass 1: remembered (UI pref)
    $('camTree').onclick = () => { closePlot(); focusPup(-1); flyHome(); };
    // step 5: the Book (tree memories, pups met, decorations, outfits) + the tree memory card
    $('bookBtn').onclick = () => { if ($('book').hidden) openBook(S.book.read < S.level ? 'mem' : Story.unread(S) ? 'words' : bookTab); else closeBook(); };
    // Round 2 step 2: the tree's voice bubble + pup diaries
    $('tsIc').innerHTML = IC.tree; $('tsOk').onclick = $('tsClose').onclick = closeSay; $('tsLog').onclick = () => { closeSay(); openBook('words'); };
    // Round 3 update 1: the wardrobe card
    $('wdClose').onclick = closeWard; $('wdOff').onclick = wardOff; $('wdPrev').onclick = () => wardStep(-1); $('wdNext').onclick = () => wardStep(1); $('wdIc').innerHTML = IC.scarf;
    $('wdGrid').addEventListener('click', e => { const b = e.target.closest('button[data-fit]'); if (b) wardPick(b.dataset.fit); });
    $('gGot').addEventListener('click', e => { if (e.target.closest('[data-dress]')) { closeGift(); openWard(wardWho()); } });
    $('dyClose').onclick = closeDiary; $('diary').addEventListener('click', e => { if (e.target.id === 'diary') closeDiary(); });
    $('bkClose').onclick = closeBook; $('bkIc').innerHTML = IC.book;
    if (document.body.classList.contains('phone')) $('camTree').textContent = 'Home';   // room for the Book button on a phone
    // UI voice pass: the Book's tab names come from here (one name everywhere)
    for (const [t, ic, nm] of [['mem', 'memory', 'Tree memories'], ['pups', 'paw', 'Our pups'], ['decor', 'decor', 'Treasures'], ['outfits', 'scarf', 'Wardrobe'], ['crit', 'critter', 'Sky critters'], ['lan', 'lantern', 'Lanterns'], ['words', 'tree', 'Whispers']]) { const b = $('bookTabs').querySelector(`[data-t="${t}"]`); b.innerHTML = IC[ic] + nm; }
    $('bookTabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) { bookTab = b.dataset.t; renderBook(); } });
    $('bookBody').addEventListener('click', e => { const b = e.target.closest('[data-mem]'); if (b) showMemory(+b.dataset.mem);
      const rg = e.target.closest('[data-ring]'); if (rg) { showRing([+rg.dataset.ring]); return; }   // update 3: an Elder ring's card
      const wf = e.target.closest('[data-bfit]'); if (wf) { const w = Wardrobe.wearer(S, wf.dataset.bfit); openWard(w >= 0 ? w : wardWho()); return; }
      const ch = e.target.closest('[data-crit]'); if (ch) { closeBook(); meetCritter(+ch.dataset.crit, true); }   // a visitor here now: fly there + its card
      const ct = e.target.closest('[data-csp]'); if (ct && Critters.status(S, ct.dataset.csp) === 'seen') openCritCard(ct.dataset.csp, null, false); });
    $('ccClose').onclick = closeCritCard;
    $('memOk').onclick = () => { closeMemory(); if (!$('book').hidden) renderBook(); };
    $('xbar').addEventListener('click', () => { if (S.level >= Rings.C.LV && !VISIT) { openBook('mem'); setTimeout(() => { const r = document.querySelector('#bookBody .ringh'); if (r) r.scrollIntoView({ block: 'start' }); }, 30); } });   // update 3: the rings
    $('book').addEventListener('click', e => { if (e.target.id === 'book') closeBook(); });
    $('buildBtn').onclick = () => { if (!$('plotCard').hidden) { closePlot(); return; } const x = plots.info.find(x => x.st === 'open' && x.show) || plots.info[0]; openPlot(x.q.pid, true); };
    $('pcClose').onclick = closePlot;
    $('pcPrev').onclick = () => cyclePlot(-1); $('pcNext').onclick = () => cyclePlot(1);
    $('pcBody').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]'); if (!b || curPlot === null) return;
      const q = nav.plotBy[curPlot];
      if (b.dataset.act === 'order') {
        if (Sim.order(S, curPlot, b.dataset.type, nav)) {
          const builders = S.pups.filter(p => p.job === 'build').length;
          toast(`${IC[B_ICON[b.dataset.type]]} Plans drawn: ${bName(b.dataset.type, q)}${builders ? '' : ' &middot; a pup needs the Builder job'}`, 3000); save();
        }
      } else if (b.dataset.act === 'exp') { closePlot(); openExp(); return; }
      else if (b.dataset.act === 'cancel') { const fr = q && q.free; if (Sim.cancel(S, curPlot, nav)) { toast('Plans rolled up, materials back in the pile', 2400); save(); if (fr) { closePlot(); refreshBuild(true); return; } } }
      else if (['col', 'roof', 'turn', 'hmove', 'hdown'].includes(b.dataset.act)) { homeAct(b.dataset.act, b); if (curPlot === null) { refreshBuild(true); return; } }
      renderPlot(true); refreshBuild(true);
    });
    // vibe pass 1: closing the away card plays the short tour of what changed (skippable), then the queued cards follow
    const awayClose = goTour => { $('away').hidden = true; if (soc) soc.awayDone(); if (lan) lan.awayDone(); for (const p of S.pups) delete p.isNew; save(); refreshRoster(true); const st = awayStops; awayStops = null; if (st && st.length) { if (goTour === 'later') queueCard('tour', () => runTour(st), true); else if (goTour) runTour(st); } };
    $('awayOk').onclick = () => awayClose(true);
    $('awayList').addEventListener('click', e => {
      const db = e.target.closest('button[data-awdet]'); if (db) { const u = $('awayList').querySelector('.awdet'); if (u) { u.hidden = !u.hidden; db.classList.toggle('on', !u.hidden); db.innerHTML = (u.hidden ? 'The numbers &#9662;' : 'Hide the numbers &#9652;'); } return; }
      const hb = e.target.closest('button[data-haul]'); if (hb) { awayClose(false); openHaul(+hb.dataset.haul); return; }
      const rb = e.target.closest('button[data-ringaway]'); if (rb) { const L = rb.dataset.ringaway.split(',').map(Number); awayClose('later'); queueCard('ring' + L[L.length - 1], () => showRing(L), true); return; }
      const mb = e.target.closest('button[data-memaway]'); if (mb) { awayClose('later'); queueCard('mem' + mb.dataset.memaway, () => showMemory(+mb.dataset.memaway), true); return; }
      const cb = e.target.closest('button[data-crit]'); if (cb) { awayClose(false); meetCritter(+cb.dataset.crit, true); return; }
      const b = e.target.closest('button[data-job]'); if (!b) return; const i = +b.closest('[data-i]').dataset.i; setJob(i, b.dataset.job, true);
      b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('awayList').addEventListener('change', e => { const inp = e.target.closest('input[data-i]'); if (!inp) return; if (Sim.rename(S, +inp.dataset.i, inp.value)) { save(); refreshRoster(true); } else inp.value = S.pups[+inp.dataset.i].name; });
    $('side').hidden = false; $('topBtns').hidden = false; $('resbar').hidden = false;
    $('app').insertAdjacentHTML('beforeend', '<div id="goal" class="card" hidden role="status"></div>'); $('goal').onclick = goalClick;   // playtest fixes: "What next?"
  }
  function setJob(i, job, quiet) {
    if (Sim.assign(S, i, job, nav)) { jobTouched = true; idleT[i] = 0; snd.sfx('assign'); if (!quiet) toast(`${esc(S.pups[i].name)} ${JOB_GO[job] || JOB_NAMES[job]} ${IC[job]}`, 1600); save(); hintDone();
      if (life && traitOf(i)) life.say(i, Traits.chat(traitOf(i), 'job', (S.time | 0) + i * 7, { j: Traits.JOBW[job] }), 4);   // vibe pass 2 lane B: the pup answers in its own voice
    }
    refreshRoster(true);
  }
  const jobOpen = j => Needs.jobOpen(S, j);
  const lockTip = j => `${JOB_NAMES[j]}: wakes ${S.wake.t === null ? 'when your first skyboat comes home' : 'soon (' + fmtT(Math.max(0, Needs.wakeAt(S, j) - S.time)) + ')'}`;   // ('wakes' is looked for in refreshRoster)
  const jobBtns = p => Sim.JOBS.map(j => `<button data-job="${j}" class="${p.job === j ? 'on' : ''}${p.like === j ? ' lk' : ''}${p.dislike === j ? ' dk' : ''}${jobOpen(j) ? '' : ' lockj'}" title="${jobOpen(j) ? JOB_NAMES[j] + (p.like === j ? ' (loves it)' : p.dislike === j ? ' (would rather not)' : '') : lockTip(j)}"${jobOpen(j) ? '' : ' disabled'}>${IC[j]}</button>`).join('');
  // friendship line for a pup: best friends first; puppies name their parents
  function friendLine(i, long) {
    const p = S.pups[i], f = Needs.friendsOf(S, i);
    let h = '';
    if (p.parents) h += `${IC.paw}puppy of ${p.parents.map(k => esc(S.pups[k] ? S.pups[k].name : '?')).join(' &amp; ')}${f.length ? ' &middot; ' : ''}`;
    if (!f.length) return h || (long ? `${IC.friends}<i>no friends yet: pups who share a job grow close</i>` : '');
    const by = [3, 2, 1].map(l => f.filter(x => x.lv === l)).filter(a => a.length);
    h += IC.friends + by.map(a => `${Needs.FR_NAMES[a[0].lv]} with ${a.slice(0, long ? 9 : 2).map(x => esc(S.pups[x.i].name)).join(', ')}${!long && a.length > 2 ? ' +' + (a.length - 2) : ''}`).join(' &middot; ');
    return h;
  }
  // labels over pups (one per pup, made as pups appear)
  function syncPups() {
    pups.sync(S.pups);
    const lb = $('labels');
    while (lb.children.length > S.pups.length) lb.lastChild.remove();
    while (lb.children.length < S.pups.length) {
      const i = lb.children.length, l = document.createElement('div'); l.className = 'lbl'; l.dataset.i = i;
      l.innerHTML = `<span class="ji"></span><span class="nmx"></span><span class="mre" hidden></span>`; l.onclick = () => focusPup(i); lb.appendChild(l);
    }
  }
  let rosterSig = '', rosterFilter = 'all', rowsSig = '', rosterQ = '';
  // playtest fixes: roster sort (UI pref `schiffy-elderglow.ui.roster`, its own key: calm.js rewrites `...ui` whole) + search
  const ROSTER_KEY = 'schiffy-elderglow.ui.roster';
  const byName = (a, b) => S.pups[a].name.localeCompare(S.pups[b].name);
  const ROSTER_SORTS = { arr: ['As they came', null], name: ['Name', byName], job: ['Job', (a, b) => Sim.JOBS.indexOf(S.pups[a].job) - Sim.JOBS.indexOf(S.pups[b].job) || byName(a, b)],
    lv: ['Explorer level', (a, b) => (S.pups[b].xpE || 0) - (S.pups[a].xpE || 0) || byName(a, b)], mood: ['Happiest first', (a, b) => S.pups[b].morale - S.pups[a].morale || byName(a, b)] };
  let rosterSort = (() => { try { const v = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}').sort; return ROSTER_SORTS[v] ? v : 'arr'; } catch (e) { return 'arr'; } })();
  function refreshRoster(force) {
    const sig = S.pups.map(p => p.job + p.phase + p.task + Math.round(p.morale) + p.name + (p.isNew ? 'n' : '') + (p.xpE || 0) + (p.exp ? Math.floor(S.time / 60) : '')).join('|') + pups.selected + rosterFilter + rosterSort + rosterQ + Needs.NEW.map(jobOpen).join() + Math.floor(S.time / 120);
    if (!force && sig === rosterSig) return; rosterSig = sig;
    // filter chips with counts
    const cnt = { all: S.pups.length }; for (const j of Sim.JOBS) cnt[j] = 0; for (const p of S.pups) cnt[p.job]++;
    $('filter').innerHTML = ['all'].concat(Sim.JOBS.filter(jobOpen)).map(f => `<button data-f="${f}" class="${rosterFilter === f ? 'on' : ''}" title="${f === 'all' ? 'Every pup' : JOB_NAMES[f]}">${f === 'all' ? 'All' : IC[f]}<b>${cnt[f]}</b></button>`).join('');
    $('pupCount').textContent = S.pups.length;
    // rows: rebuilt when the pup list / names change, otherwise patched
    const rs = S.pups.map(p => p.id + p.name + p.like + p.dislike).join('|');
    const ro = $('roster');
    if (rs !== rowsSig) {
      rowsSig = rs;
      ro.innerHTML = S.pups.map((p, i) => `<div class="pup" data-i="${i}"><div class="nm"><span class="dot" style="background:${p.collar}"></span><span class="pn">${esc(p.name)}</span>${traitChip(i, true)}<span class="new">new</span><span class="xpc" title="Explorer level (skyboat trips)"></span><span class="mor" title="happiness">${IC.heart}<b>70</b></span><span class="frc" title=""></span><span class="st">-</span></div><div class="jobs">${jobBtns(p)}</div><div class="frl"></div></div>`).join('');
    }
    { const tools = $('rosterTools'); if (tools) tools.hidden = S.pups.length < 8 && !rosterQ && rosterSort === 'arr'; }
    const cmp = ROSTER_SORTS[rosterSort] && ROSTER_SORTS[rosterSort][1], ord = new Map();
    if (cmp) S.pups.map((p, i) => i).sort(cmp).forEach((i, k) => ord.set(i, k));
    ro.querySelectorAll('.pup').forEach(row => {
      const i = +row.dataset.i, p = S.pups[i]; if (!p) return;
      row.hidden = (rosterFilter !== 'all' && p.job !== rosterFilter) || (!!rosterQ && p.name.toLowerCase().indexOf(rosterQ) < 0);
      row.style.order = cmp ? ord.get(i) : '';
      row.classList.toggle('sel', pups.selected === i); row.classList.toggle('isnew', !!p.isNew);
      row.querySelectorAll('button[data-job]').forEach(b => { const j = b.dataset.job, o = jobOpen(j); b.classList.toggle('on', j === p.job); b.classList.toggle('lockj', !o); b.disabled = !o; if (!o) b.title = lockTip(j); else if (b.title.indexOf('wakes') >= 0) b.title = JOB_NAMES[j]; });
      // friendship hint: hearts = friends; the selected pup shows who (and a puppy its parents)
      const fl = Needs.friendsOf(S, i), fc = row.querySelector('.frc'), best = fl.length ? fl[0].lv : 0;
      fc.innerHTML = fl.length ? `${IC.friends}<b>${fl.length}</b>` : ''; fc.className = 'frc' + (best >= 3 ? ' close' : ''); fc.title = fl.length ? friendLine(i, true).replace(/<[^>]+>/g, '') : '';
      const fv = row.querySelector('.frl'); if (pups.selected === i) { const tr = traitOf(i), h = (tr ? `<span class="trtl">${traitChip(i)} <i>${esc(Traits.INFO[tr].what)}</i></span>` : '') + friendLine(i, true) + (fl.length ? ` <small>(friends on the same job work up to +${Math.round(Needs.C.FR_K * 3 * 100)} % better)</small>` : '') + (VISIT ? '' : `<button class="dybtn" data-diary="${i}" title="${esc(p.name)}'s diary">${IC.diary}Diary</button><button class="dybtn wdbtn" data-ward="${i}" title="Dress ${esc(p.name)} up">${IC.scarf}Wardrobe</button>`); if (fv.dataset.h !== h) { fv.innerHTML = h; fv.dataset.h = h; } fv.hidden = false; } else fv.hidden = true;
      row.querySelector('.mor b').textContent = Math.round(p.morale);
      row.querySelector('.st').textContent = statusOf(p);
      const xc = row.querySelector('.xpc'), xl = expLv(p); xc.textContent = p.xpE > 0 ? 'Explorer ' + xl : ''; xc.hidden = !(p.xpE > 0);
      row.classList.toggle('trip', !!p.exp);
    });
    document.querySelectorAll('#labels .lbl').forEach(l => { const i = +l.dataset.i, p = S.pups[i]; if (!p) return; l.classList.toggle('sel', pups.selected === i); l.style.borderColor = p.collar; l.querySelector('.ji').innerHTML = p.exp ? IC.board : IC[p.job]; l.querySelector('.nmx').textContent = p.name; });
  }
  function needRate(k) {   // net points per hour with the current crew (what the trend shows); null = asleep
    const n = Sim.C.NEEDS[k], aw = n.floor ? Needs.awakeK(S, k) : 1; if (aw < 0) return null;
    let sup = 0; S.pups.forEach(p => {
      if (p.job !== k || p.exp) return; let x = Sim.C.SUPPLY[k] * Sim.mult(p.morale);
      if (k === 'spirit' && p.task === 'busk') x *= Needs.C.BUSK_K;
      if (k === 'nourish') x *= (1 + Needs.C.GARDEN.SPROUT_K * S.garden.sprouts.length) * (1 + Needs.C.GARDEN.CONS_K * Math.min(1, Needs.built(S, 'conserv')));
      sup += x * Pacing.upK(S, k === 'water' ? 'well' : k === 'light' ? 'lamp' : k === 'nourish' ? 'roots' : '');   // (island upgrades: pacing.js)
    });
    if (k === 'light') sup += Sim.counts(S).lantern * Sim.C.B.lantern.light * Pacing.upK(S, 'lamp');
    if (k === 'nourish' && Needs.built(S, 'conserv')) sup += Needs.C.GARDEN.CONS_N;
    const decay = n.floor ? (n.decay + (k === 'protect' ? Needs.C.BLIGHT.LOAD * Needs.load(S) : 0)) * (0.25 + 0.75 * aw) : n.decay;
    return sup - decay;
  }
  // pacing pass: the tree card's growth pace line ("Growing 1.2x · needs met, pups busy"); tap = upgrades + the offering
  function refreshPace(full) {
    const el = $('pace'); if (!el) return; el.hidden = !!full || !!VISIT; if (el.hidden) return;
    const w = Pacing.words(S), up = w.k > 1.001, dn = w.k < 0.999;
    const why = w.why.concat(w.low).join(', ') || 'fill every job and build homes to speed it up';
    const h = `${IC[dn ? 'heart' : 'sprout'] || ''}<b>${up || dn ? `Growing ${w.x}&times;` : 'Usual pace'}</b><small>${esc(why)}</small>`;
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; el.classList.toggle('up', up); el.classList.toggle('dn', dn);
      el.title = `How fast the Elder Tree grows: ${w.x}x. Needs met, every job filled and homes built speed it up (up to 1.3x); a thirsty tree slows down but never stops. Tap for upgrades + the tree offering.`; }
  }
  function refreshTree() {
    const h = S.health; $('lv').textContent = S.level;
    $('hfill').style.width = h.toFixed(1) + '%'; $('hfill').style.background = healthCol(h);
    { const hm = $('hmini'); hm.style.setProperty('--h', h.toFixed(0) + '%'); hm.style.setProperty('--hc', healthCol(h)); hm.querySelector('b').textContent = Math.round(h) + '%'; hm.title = `The Elder Tree: ${healthWord(h)}`;
      const pm = `${IC.paw}${S.pups.length}`; if ($('pmini').dataset.h !== pm) { $('pmini').innerHTML = pm; $('pmini').dataset.h = pm; } }   // vibe pass 1: the folded pill
    $('hlabel').textContent = `${healthWord(h)} ${Math.round(h)}%`;
    const lo = Sim.C.LV_XP[S.level - 1] || 0, hi = Sim.C.LV_XP[S.level];
    $('stg').textContent = Growth.stageName(S.level);
    if (hi === undefined) {   // update 3: past Elder the bar fills toward the next Elder ring (src/rings.js)
      const R = Rings.progress(S), rate = Pacing.xpRate(S), n = VISIT ? Rings.got(S) : R.n;
      $('xfill').style.width = (VISIT ? 100 : R.f * 100).toFixed(1) + '%'; $('xbar').classList.add('rings');
      $('xlabel').textContent = VISIT ? `The great Elder Tree · ${n ? 'Ring ' + n : 'fully grown'}` : `Ring ${n} · ${Math.floor(R.f * 100)}% to ring ${n + 1} · +${Math.round(rate)} an hour`;
      $('xbar').title = VISIT ? '' : `Past Elder the tree grows rings. Ring ${n + 1} in about ${fmtDays(R.left / rate * 3600)} at this pace (${esc(Rings.perkText(Rings.perkOf(n + 1)))}). Tap for the rings.`;
    }
    else { $('xfill').style.width = ((S.xp - lo) / (hi - lo) * 100).toFixed(1) + '%'; $('xlabel').textContent = `Growing ${Math.floor(S.xp).toLocaleString()} / ${hi.toLocaleString()} · +${Math.round(Pacing.xpRate(S))} an hour`; }
    refreshPace(false);   // (update 3: past Elder the pace still matters: it grows the rings)
    document.querySelectorAll('#needs .need').forEach(r => {
      const k = r.dataset.k, v = S.needs[k]; r.querySelector('i').style.width = v.toFixed(1) + '%';
      const rate = needRate(k), tr = r.querySelector('.tr');
      r.classList.toggle('soon', rate === null);
      if (rate === null) { tr.textContent = 'asleep'; tr.style.color = ''; r.title = `${NEED_NAMES[k]} is still asleep: the island keeps it near ${Sim.C.NEEDS[k].floor}. It wakes ${S.wake.t === null ? 'when your first skyboat comes home' : 'in ' + fmtT(Math.max(0, Needs.wakeAt(S, k) - S.time))}.`; return; }
      r.title = `${NEED_TIP[k]} · tap for more`;
      tr.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(0) + '/h'; tr.style.color = rate >= 0 ? '#2c8a4a' : '#c0392b';
      if (k === 'protect') r.classList.toggle('alert', S.blight.list.length > 0 && !S.pups.some(p => p.job === 'protect'));
    });
    $('rSd').textContent = fmtN(S.inv.seeds); $('rSd').parentNode.hidden = !(S.inv.seeds > 0) && Needs.awakeK(S, 'nourish') < 0;
    $('rB').textContent = fmtN(S.stats.buckets); $('rS').textContent = fmtN(S.sap); $('rW').textContent = fmtN(S.res.wood); $('rT').textContent = fmtN(S.res.stone);
    const fn = Sim.foodNet(S); $('rF').innerHTML = `${fmtN(S.res.food)}<small class="${fn >= 0 ? 'up' : 'down'}">${fn >= 0 ? '+' : ''}${Math.round(fn)}/h</small>`;
    $('rF').parentNode.classList.toggle('warn', S.res.food < Sim.C.ARRIVE_FOOD);
    $('rCr').textContent = fmtN(S.res.crystal || 0); $('rCr').parentNode.hidden = !(S.res.crystal > 0) && S.level < Exped.C.BOARD_LV;
    const beds = Sim.bedsOf(S, nav); $('rBd').textContent = `${S.pups.length}/${beds}`; $('rBd').parentNode.classList.toggle('warn', S.pups.length >= beds);
    // island clock chip: sun / dusk / moon + HH:MM
    const hh = Sim.tod(S), dc = Sim.dayCurve(hh), ic = dc.night > 0.5 ? 'moon' : dc.dusk > 0.4 || dc.dawn > 0.4 ? 'dusk' : 'sun';
    if ($('rCi').dataset.ic !== ic) { $('rCi').innerHTML = IC[ic]; $('rCi').dataset.ic = ic; }
    $('rC').textContent = String(Math.floor(hh)).padStart(2, '0') + ':' + String(Math.floor(hh % 1 * 60)).padStart(2, '0');
    $('clockChip').classList.toggle('nite', dc.night > 0.5);
    // season chip (step 5)
    const sk = Seasons.of(S);
    if (sk !== null) {
      const nm = Seasons.NAMES[sk], a = Seasons.at(S.ep0 + S.time);
      if ($('seaChip').dataset.k !== nm) { $('seaChip').dataset.k = nm; $('rSeaI').innerHTML = IC[nm]; $('rSea').textContent = Seasons.TITLE[nm]; $('seaChip').className = 'sea-' + nm; }
      $('seaChip').title = `${Seasons.TITLE[nm]} on the island: ${SEA_TXT[nm]}. ${Seasons.fix !== null ? '(fixed for testing)' : `${Seasons.TITLE[Seasons.NAMES[(sk + 1) % 4]]} arrives in ${fmtDays(a.left)}.`} Each season lasts a week.`;
    }
    $('bookBtn').classList.toggle('ready', S.book.read < S.level || (!VISIT && Story.unread(S) > 0));
  }
  // ---- Round 2 step 2: the tree's voice (ONE unprompted message per session open, the rest wait in the Book), pup diaries
  const session = Story.Session();
  let sayOpen = false, sayT = 0, sayTimer = null;
  // ---- playtest fixes (2026-11-02): ONE card registry. Every card / panel says what it is in its own markup (index.html, or the
  // module that makes it): data-card = "big" (centre card with a veil) | "side" (right column / phone sheet) | "menu" (a small
  // pop-up) | "mode" (a tool bar: place / land / tour / photo). data-over = it opens ON TOP of the card it came from (a memory over
  // the Book, the haul over the skyboat dock, a lantern note over the lantern card); data-keep = never closed for you (the cloud
  // choice card). A card closes through [data-close] or its ✕ (button[title=Close]) so its own close code runs; CardFn = the few
  // without one. Anything new with data-card is known to the toasts, the tree's words, chatter, the card queue, Esc, one card at
  // a time and the calm view at once.
  const CardFn = {};
  let cardsMemo = null, cardsAt = -1;
  const cardVis = el => !el.hidden && el.getClientRects().length > 0;
  function openCards(kinds) {
    const now = performance.now();
    if (!cardsMemo || now - cardsAt > 40) { cardsMemo = [...document.querySelectorAll('[data-card]')].filter(cardVis); cardsAt = now; }
    return kinds ? cardsMemo.filter(el => kinds.includes(el.dataset.card)) : cardsMemo;
  }
  function closeCard(el) {
    if (!el || el.dataset.keep !== undefined) return false;
    if (CardFn[el.id]) CardFn[el.id]();
    else { const x = el.querySelector('[data-close]') || el.querySelector('button[title="Close"]') || el.querySelector('.pch button[data-x="1"]'); if (x) x.click(); else el.hidden = true; }
    cardsMemo = null; return true;
  }
  const overlayOpen = () => openCards().length > 0;   // ANY card, menu or tool bar
  const bigOpen = () => openCards(['big']).length > 0;
  // the topmost closable card: a big one first, then the most recently opened
  const topCard = () => openCards(['big', 'side', 'menu']).filter(c => c.dataset.keep === undefined).sort((a, b) => (b.dataset.card === 'big') - (a.dataset.card === 'big') || (b._openAt || 0) - (a._openAt || 0))[0] || null;
  const rectsHit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  // is this element (a toast) under a card? a big card's veil covers the whole screen
  function underCard(el) { const r = el.getBoundingClientRect(); return openCards(['big', 'side', 'menu']).some(c => c.dataset.card === 'big' || rectsHit(r, c.getBoundingClientRect())); }
  // one card at a time: a card that opens closes the others (unless it opens on top of them, data-over), and the tree's words
  // step aside (they wait in the Book)
  function cardOpened(el) {
    if (el.dataset.card === 'mode') return;
    if (sayOpen) closeSay();
    if (el.dataset.over !== undefined) return;
    for (const c of openCards(['big', 'side', 'menu'])) if (c !== el && !c.contains(el) && !el.contains(c)) closeCard(c);
  }
  new MutationObserver(recs => {
    cardsMemo = null;
    for (const r of recs) { const el = r.target; if (!el.dataset || el.dataset.card === undefined || r.oldValue === null || el.hidden) continue; el._openAt = performance.now(); if (booted) cardOpened(el); }
    document.body.classList.toggle('cardup', overlayOpen());   // pup chatter + whispers hide under a card (CSS)
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  // first launch (playtest fixes): a brand-new island's first ~5 min (sim time) until the first job change: one message at a
  // time with room to breathe (gift -> the tree's words -> the season note -> the sound chip ...), no pup chatter, no panel folding
  let jobTouched = false, lastAppear = -1e9, lastInput = -1e9;
  const NEWBIE = { T: 375, GAP: 6000, BREATH: 3000 };
  const newbie = () => !VISIT && !!S && !jobTouched && S.time < NEWBIE.T;
  const beat = () => { lastAppear = performance.now(); };
  let lastBusy = -1e9;   // last moment a toast / the tree's words were still up (a breath of BREATH ms after one goes)
  const beatOk = () => { const now = performance.now(); if (TQ.live.length || sayOpen || bigOpen()) { lastBusy = now; return !newbie(); } return !newbie() || (now - lastAppear > NEWBIE.GAP && now - lastBusy > NEWBIE.BREATH); };
  addEventListener('pointerdown', () => { lastInput = performance.now(); }, true);
  addEventListener('keydown', () => { lastInput = performance.now(); }, true);
  function trySpeak(force) {
    if (VISIT || sayOpen || !booted || (!force && (performance.now() - bootAt < 5000 || overlayOpen() || !beatOk() || wardI >= 0 || boatCam || tour || CQ.length || RST.wave || PM || LM))) return null;   // (not while placing a decoration / shaping the land)
    const r = session.speak(S); if (!r) return null;
    showSay(r.w, r.e); beat(); save(); return r;
  }
  function showSay(w, e) {
    sayOpen = true; const el = $('treeSay');
    $('tsKind').textContent = w.kind === 'chapter' ? `· Chapter ${w.n} · ${w.t}` : `· ${w.t}`;
    // the words fade in a few at a time
    $('tsText').innerHTML = w.x.split(/(\s+)/).map(x => /^\s+$/.test(x) ? x : `<span>${esc(x)}</span>`).join('');
    const sp = [...$('tsText').querySelectorAll('span')]; let k = 0; clearInterval(sayTimer);
    sayTimer = setInterval(() => { for (let n = 0; n < 2 && k < sp.length; n++) sp[k++].classList.add('on'); if (k >= sp.length) clearInterval(sayTimer); }, 120);
    // the pups react: the two nearest the view look up at the tree (a heart / note floats over them)
    const tg = controls.target, near = S.pups.map((p, i) => [i, pups.list[i] ? pups.list[i].holder.position.distanceTo(tg) : 1e9]).filter(x => x[1] < 220 && !S.pups[x[0]].exp).sort((a, b) => a[1] - b[1]).slice(0, 2).map(x => x[0]);
    near.forEach((i, k) => setTimeout(() => { const P = pups.list[i]; if (P) floater([P.holder.position.x, P.holder.position.y + 9, P.holder.position.z], k ? IC.spirit : IC.heart); }, 900 + k * 500));
    const nm = near.map(i => `<b>${esc(S.pups[i].name)}</b>`);
    $('tsPups').innerHTML = nm.length ? `${IC.paw}${nm.join(' and ')} ${nm.length > 1 ? 'look' : 'looks'} up at the tree.` : '';
    el.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    snd.sfx('voice'); sayT = performance.now();
    // vibe 2 lane C: the tree's body language: canopy glow + sway + a warm rim, leaves spiral down (tree_fx speak), the pups
    // round the plaza turn and look up at its crown (pup_life attend), a low warm swell under the voice (music ducks while open)
    fx.speak = true; snd.sfx('swell', { gain: 0.8, delay: 0.15 });
    if (life) { const cp = fx.canopy(), TP = nav.TP; life.attend(S, poses, [TP[0], (cp.y0 + cp.y1) / 2, TP[2]], nav.door(fx.scale).p, 150, 9); }
    if (voice && voice.live) voice.el.classList.remove('in');
  }
  function closeSay() { const el = $('treeSay'); el.classList.remove('in'); sayOpen = false; if (fx) fx.speak = false; clearInterval(sayTimer); setTimeout(() => { if (!sayOpen) el.hidden = true; }, 900); }
  function renderWords() {
    const L = S.story.log; let h = `<p class="bsub">Everything the tree has said: a chapter of its story on each day you visit, a few words when something lovely happens, and its dreams while you are away. <b>${S.story.ch} / ${Story.CH.length}</b> chapters so far.</p><div class="wlist">`;
    if (!L.length) h += `<div class="wtile"><p>The tree is still finding its first words.</p></div>`;
    for (let i = L.length - 1; i >= 0; i--) {
      const e = L[i], w = Story.words(e); if (!w) continue;
      const lab = w.kind === 'chapter' ? `${IC.tree}Chapter ${w.n}` : w.kind === 'dream' ? `${IC.moon}A dream` : `${IC.star}A moment`;
      h += `<div class="wtile ${w.kind}${e.u ? ' new' : ''}"><div class="wl">${lab} &middot; island day ${e.d}${e.u ? '<em>new</em>' : ''}</div>${w.kind === 'dream' ? '' : `<b class="disp">${esc(w.t)}</b>`}<p>${esc(w.x)}</p></div>`;
    }
    return h + '</div>';
  }
  function openDiary(i) {
    const p = S.pups[i]; if (!p) return; closeSay();
    $('dyDot').style.background = p.collar; $('dyTitle').textContent = `${p.name}'s diary`;
    const L = Story.diary(S, i);
    const tr = traitOf(i);
    $('dyBody').innerHTML = (tr ? `<p class="dsub">${traitChip(i)} <i>${esc(p.name)} ${esc(Traits.INFO[tr].what)}.</i></p>` : '') + `<p class="dsub">${esc(p.name)} writes a line on the days something happens. Today is island day ${S.story.dn}.</p>` +
      (L.length ? L.map(x => `<div class="dyl${x.today ? ' today' : ''}"><b>${x.today ? 'Today' : 'Day ' + x.dn}</b><span>${esc(x.text)}</span></div>`).join('') : `<div class="dyl"><span>The pages are still blank. Tomorrow, maybe!</span></div>`);
    $('diary').hidden = false; snd.sfx('open');
  }
  function closeDiary() { $('diary').hidden = true; snd.sfx('close'); }
  // ---- Round 3 update 1: the wardrobe (src/wardrobe.js). A card at the bottom (no backdrop): the camera comes close to the pup,
  // so the pup on the island IS the preview. Tap an outfit = put it on (whoever wore it takes it off), Take off, < > = next pup.
  let wardI = -1; const WARD_D = PHONE ? 38 : 26;   // camera distance while the wardrobe is open (a portrait phone sees less across)
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  function openWard(i) {
    if (VISIT || !S.pups.length) return; i = S.pups[i] ? i : 0;
    closeDiary(); closeSay(); if (!$('book').hidden) closeBook(); wardI = i;
    focusPup(i, WARD_D); renderWard(); $('wardCard').hidden = false; snd.sfx('open');
  }
  function closeWard() { if ($('wardCard').hidden) return; $('wardCard').hidden = true; wardI = -1; snd.sfx('close'); }
  function renderWard() {
    const p = S.pups[wardI]; if (!p) { closeWard(); return; }
    $('wdDot').style.background = p.collar; $('wdName').textContent = p.name;
    const own = new Set(S.inv.outfits);
    $('wdNow').innerHTML = p.fit ? `${esc(p.name)} wears the <b>${esc(Wardrobe.name(p.fit))}</b>.` : own.size ? `${esc(p.name)} isn't dressed up yet: tap an outfit.` : 'The wardrobe is empty for now: outfits come in the gift basket (day 7) and as rare skyboat finds.';
    $('wdGrid').innerHTML = Wardrobe.IDS.map(id => {
      const D = Wardrobe.DEFS[id], w = Wardrobe.wearer(S, id);
      if (!own.has(id)) return `<div class="wt lock"><i class="wsw">${IC.lock}</i><b>???</b><small>${Wardrobe.where(id)}</small></div>`;
      return `<button class="wt${p.fit === id ? ' on' : ''}" data-fit="${id}"><i class="wsw" style="--c:${hex(D.look.col)};--c2:${hex(D.look.col2)}">${IC.scarf}</i><b>${esc(D.name)}</b><small>${w === wardI ? 'wearing it' : w >= 0 ? 'on ' + esc(S.pups[w].name) : 'on the hook'}</small></button>`;
    }).join('');
    $('wdOff').disabled = !p.fit;
  }
  function wardPick(id) {
    const p = S.pups[wardI]; if (!p) return;
    if (p.fit === id) { wardOff(); return; }
    const r = Wardrobe.wear(S, wardI, id); if (!r.ok) return;
    save(); renderWard(); snd.sfx('like');
    const P = pups.list[wardI]; if (P) floater([P.holder.position.x, P.holder.position.y + 9, P.holder.position.z], IC.heart);
    toast(`${IC.scarf}<b>${esc(p.name)}</b> puts on the ${esc(Wardrobe.name(id))}${r.from >= 0 ? ` (${esc(S.pups[r.from].name)} takes it off)` : ''}`, 2600);
  }
  function wardOff() { const p = S.pups[wardI]; if (p && Wardrobe.off(S, wardI)) { save(); renderWard(); snd.sfx('assign'); toast(`${IC.scarf}${esc(p.name)} hangs the outfit back up`, 1800); } }
  function wardStep(d) { const n = S.pups.length; if (!n) return; wardI = ((wardI + d) % n + n) % n; focusPup(wardI, WARD_D); renderWard(); }
  // "Dress a pup" from a gift / haul: the selected pup, else the first one not wearing anything, else the first
  const wardWho = () => pups.selected >= 0 && S.pups[pups.selected] ? pups.selected : Math.max(0, S.pups.findIndex(p => !p.fit));

  // ---- update 3: Elder rings (src/rings.js) + far-sky voyages (src/voyages.js). A ring reached while playing: its band of light
  // draws itself round the trunk (src/ring_fx.js), a toast, then ONE card (rings that come together = one card); rings grown while
  // away are on the away card. The Book's memories page lists them; the tree card's bar fills toward the next one.
  let ringQ = [], ringT = null;
  function ringReached(n) {
    if (VISIT) return; ringQ.push(n); if (ringT) return;
    ringT = setTimeout(() => { ringT = null; const L = ringQ.splice(0); if (!L.length) return; const k = L[L.length - 1];
      if (ringFx) ringFx.celebrate(k); snd.sfx('theme_wave'); refreshTree();
      toast(`${IC.tree} The Elder Tree grew ${L.length > 1 ? L.length + ' new rings' : 'a new ring'}: <b>Ring ${k}</b> &middot; ${esc(Rings.perkText(Rings.perkOf(k)))} <u>See it</u>`, 9000, () => queueCard('ring' + k, () => showRing(L), true));
      queueCard('ring' + k, () => showRing(L)); save(); }, 1500);
  }
  const ringPup = () => (S.pups[0] && S.pups[0].name) || 'Pudding';
  const giftWords = g => [g.sap ? `${IC.sap}${fmtN(g.sap)} sap` : '', g.crystal ? `${IC.crystal}${g.crystal} crystals` : '', g.seeds ? `${IC.seed}${g.seeds} seeds` : '', g.outfit ? `${IC.scarf}${esc(outfitName(g.outfit))}` : '', g.decor ? `${IC.decor}${esc(decorName(g.decor))}` : ''].filter(Boolean).join(' &middot; ');
  // the ring card (in the memory card): one ring = its memory + perk + gift; several = the newest in full, the others in a list
  function showRing(L) {
    L = (Array.isArray(L) ? L : [L]).filter(n => n >= 1 && n <= Rings.got(S)); if (!L.length) return;
    const n = L[L.length - 1], sk = Seasons.of(S), m = Rings.memOf(n, sk === null ? -1 : sk, ringPup()), p = Rings.perkOf(n), g = Rings.giftOf(n);
    let h = `<div class="mstage disp">${IC.memory} Elder ring ${n}</div><h2 class="disp">${esc(m.title)}</h2><p class="mtext">${esc(m.text)}</p>`;
    h += `<h4>${IC.star} The new ring brought</h4><ul class="munl ringul"><li>${IC[p.k === 'voy' ? 'isle' : p.k === 'seat' ? 'board' : (Pacing.UP[p.id] || {}).ic] || IC.star}<span>${esc(Rings.perkText(p))}</span></li><li>${IC.gift}<span>${giftWords(g)}</span></li><li>${IC.tree}<span>One more band of light round the trunk</span></li></ul>`;
    if (L.length > 1) h += `<h4>${IC.tree} Also grown</h4><ul class="munl ringul">` + L.slice(0, -1).reverse().slice(0, 4).map(k => `<li>${IC.memory}<span><b>Ring ${k}:</b> ${esc(Rings.memOf(k, -1, ringPup()).title)} &middot; ${esc(Rings.perkText(Rings.perkOf(k)))}</span></li>`).join('') + (L.length > 5 ? `<li>${IC.book}<span>... and ${L.length - 5} more: the Book keeps every ring</span></li>` : '') + '</ul>';
    $('memBody').innerHTML = h; memOpen = 0; $('mem').hidden = false; snd.sfx('sting_gift', { gain: 0.7 });
  }
  // the Book's memories page: the rings (newest first), what the next one brings, the ring bar
  function ringsBookHtml() {
    if (S.level < Rings.C.LV) return `<p class="bsub ringsoon">${IC.lock} Past the Elder Tree, the tree keeps growing: one ring at a time, each a little gift for the island.</p>`;
    const r = Rings.got(S), P = Rings.progress(S), nx = Rings.perkOf(r + 1), rate = Pacing.xpRate(S), nb = Rings.nextBig(S);
    let h = `<h4 class="ringh">${IC.tree} Elder rings <span class="cnt">${r}</span></h4>`;
    if (!VISIT) h += `<div class="ringnext"><div class="bar"><i style="width:${(P.f * 100).toFixed(1)}%"></i></div><small>Ring ${r + 1}: ${Math.round(P.f * 100)}% &middot; about ${fmtDays(P.left / rate * 3600)} at this pace &middot; brings: ${esc(Rings.perkText(nx))}${nb.n !== r + 1 ? ` &middot; ring ${nb.n}: ${esc(Rings.perkText(nb.p))}` : ''}</small></div>`;
    h += '<div class="mgrid">';
    for (let n = r; n >= Math.max(1, r - 29); n--) { const m = Rings.memOf(n, -1, ringPup()); h += `<button class="mtile ringt" data-ring="${n}"><span class="ml disp">Ring ${n}</span><b class="disp">${esc(m.title)}</b><small>${esc(Rings.perkText(Rings.perkOf(n)))}</small></button>`; }
    if (!r) h += `<div class="mtile lock"><span class="ml disp">Ring 1</span><b>${IC.lock} Still growing under the bark</b><small>${esc(Rings.perkText(Rings.perkOf(1)))}</small></div>`;
    return h + '</div>';
  }
  // the skyboat card's far-sky voyages: open isles (Plan), the rest with the ring that opens them
  function voyListHtml(bd) {
    if (S.level < Rings.C.LV) return `<h4>${IC.star} Far-sky voyages</h4><p class="lockd">${IC.lock} Beyond the floating isles lie places no skyboat has reached yet. They open with the <b>Elder Tree's rings</b>, once it is fully grown.</p>`;
    const out = Voyages.out(S);
    let h = `<h4>${IC.star} Far-sky voyages <span class="cnt">ring ${Rings.got(S)}</span></h4><p class="sub small">Long voyages past the clouds: they need supplies from your stores and bring back starlight (Elder ring growth), crystals and rare finds. One voyage at a time.</p>`;
    for (const v of Voyages.LIST) {
      const d = Voyages.BY[v.id], ok = Exped.unlocked(S, d), n = Rings.voyRing(v.id), sailed = S.elder && S.elder.vy[v.id];
      h += `<div class="bo dest voy${ok ? '' : ' off'}" data-x="${ok ? 'plan' : 'peek'}" data-d="${d.i}">${IC.star}<div class="bi"><b>${d.name}</b> <small class="inl">${v.h} h${sailed ? ' &middot; sailed ' + sailed + 'x' : ok ? ' &middot; not yet sailed' : ''}</small><small>${esc(v.blurb)}</small></div>${ok ? `<button class="go"${bd === null || out ? ' disabled' : ''}>${out ? 'Out' : 'Plan'}</button>` : `<span class="why">${IC.lock}Ring ${n}</span>`}</div>`;
    }
    return h;
  }
  // a voyage's plan: the crew (2-4, 5 from ring 4), the supplies (short = red), what it brings, Set sail
  function renderVoyPlan(body, pv, d) {
    const v = d.voy, max = Exped.maxTeam(S);
    $('ecTitle').innerHTML = `${IC.star} ${d.name}`;
    let h = `<p class="sub">${esc(v.blurb)} A crew of ${Voyages.C.MIN_TEAM}-${max} pups, ${v.h} hours out and home again (even while you're away).</p><div class="team">`;
    S.pups.forEach((p, i) => {
      const on = pv.team.includes(i), bz = Exped.busy(p);
      h += `<button class="tp${on ? ' on' : ''}${bz ? ' busy' : ''}" data-x="pick" data-i="${i}"${bz ? ' disabled' : ''}><span class="dot" style="background:${p.collar}"></span><b>${esc(p.name)}</b><span class="xl">Explorer ${expLv(p)}</span><small>${bz ? (p.exp ? 'away on a skyboat' : 'just arriving') : `loves ${IC[p.like] || ''}`}</small>${on ? `<em>${pv.team.indexOf(i) + 1}</em>` : ''}</button>`;
    });
    h += '</div>';
    const c = Exped.canSend(S, nav, pv.dest, pv.tier, pv.team), n = Math.max(pv.team.length, Voyages.C.MIN_TEAM), cost = Voyages.supplies(d, n), est = Exped.estimate(S, pv.dest, pv.tier, pv.team.length ? pv.team : []);
    const have = k => k === 'sap' ? S.sap : (S.res[k] || 0);
    h += `<div class="est voyest"><b>Supplies${pv.team.length ? '' : ' (for ' + n + ')'}</b> ${Object.keys(cost).map(k => `<span class="cost${have(k) < cost[k] + (k === 'food' ? Voyages.C.KEEP : 0) ? ' short' : ''}">${IC[COST_IC[k]] || ''}${fmtN(cost[k])}</span>`).join(' ')}`;
    if (est) h += `<br><b>Likely treasures</b> <span class="gl">${IC.star}~${fmtN(est.star)} starlight (${Math.round(est.starF * 100)}% of a ring)</span> <span class="gl">${IC.crystal}~${est.crystal}</span> <span class="gl">${IC.seed}~${est.seeds}</span>${est.first ? ` <span class="gl">${IC.gift}the isle's own find</span>` : ` <span class="gl">${IC.decor}a chance of rare finds</span>`}<br><small>Home in ${v.h} h &middot; +${Voyages.C.XP_H * v.h} explorer xp each &middot; called off before lift-off = every bit back</small>`;
    h += `</div><div class="pf"><button class="ghost" data-x="back">&#9664; Isles</button><button class="big${c.ok ? ' pulse' : ''}" data-x="send"${c.ok ? '' : ' disabled'}>${IC.board} Set sail!</button></div>${c.ok ? '' : `<p class="why2">${esc(c.why)}</p>`}`;
    body.innerHTML = h;
  }
  // a dream for the away card (only after a night away); it is this session's one unprompted message
  function awayDream(sum, away) {
    if (!sum || away < 60) return;
    const dr = Story.dream(S, sum); if (!dr) return;
    sum.dream = dr.text; const e = Story.say(S, 'dream', dr.text); e.u = 0; session.used();
  }

  // ---- Round 2 step 2: colour restoring. Story.radius(S) = what the island has earned (pure, from the sim); the view eases
  // toward it, and a jump (a new ring, online or after being away) plays a slow colour WAVE with a sound sting + a toast.
  const RST = { R: -1, wave: null, held: false };
  function restoreTick(dt, t) {
    const tgt = Story.radius(S), U = ElderMap.uRest.value;
    if (RST.R < 0) RST.R = tgt.R;
    if (RST.lock !== null && RST.lock !== undefined && !RST.wave) { U.set(RST.lock, Story.C.EDGE, Story.C.NOISE, 1); dn.mist = Math.max(0, 1 - Math.max(0, RST.lock - 22) / 560); return; }   // tests: a fixed radius
    const canWave = !VISIT && !overlayOpen() && !boatCam && !tour;
    if (RST.wave) {
      const w = RST.wave; w.t += dt; const k = Math.min(1, w.t / w.dur), e = k * k * (3 - 2 * k);
      RST.R = w.from + (w.to - w.from) * e; ElderMap.uRestWave.value = Math.sin(Math.PI * Math.min(1, k * 1.05)) * 0.9;
      if (k >= 1) { RST.wave = null; ElderMap.uRestWave.value = 0; if (w.lockEnd !== undefined) RST.lock = w.lockEnd; if (w.back) w.back(); }
    } else if (tgt.R - RST.R > 12) { if (canWave) startWave(RST.R, tgt.R); }   // waits while a card is open (the away card first)
    else RST.R += (tgt.R - RST.R) * Math.min(1, dt * 0.4);   // the slow creep inside a ring (or back after a test)
    const full = tgt.full && !RST.wave && RST.R >= Story.C.RINGS[Story.C.RINGS.length - 1].r - 1;
    U.set(RST.R, Story.C.EDGE, Story.C.NOISE, full ? 0 : 1);
    dn.mist = full ? 0 : Math.max(0, 1 - Math.max(0, RST.R - 22) / 560);
  }
  function startWave(from, to) {
    const rFrom = Story.C.RINGS.reduce((k, x, i) => from >= x.r - 1 ? i : k, 0), rTo = Story.radius(S).ring;
    const big = rTo > rFrom, dur = Math.max(5, Math.min(13, 4 + (to - from) / 45));
    RST.wave = { from, to, t: 0, dur, back: null };
    if (!big || VISIT) return;
    // a new ring: the tree glows, a sting, a toast; the camera rises to watch if it is free (not following a pup / a boat)
    snd.sfx('theme_wave'); fx.burst();   // vibe 2 lane C: the Elderglow theme plays at each colour wave (was sting_bloom)
    const ring = Story.C.RINGS[rTo];
    toast(`${IC.tree} Colour flows back into <b>${ring.name}</b>${rTo === Story.C.RINGS.length - 1 ? ': the whole island is awake!' : ''}`, 6500, () => openBook('words'));
    if (follow < 0 && !tween) {
      const back = { e: camera.position.clone(), t: controls.target.clone() }, TP = nav.TP, see = Math.min(640, to);
      const tg = new THREE.Vector3(TP[0], TP[1] + 20, TP[2]), eye = tg.clone().add(camera.position.clone().sub(controls.target).setY(0).setLength(see * 1.15 + 120)).setY(TP[1] + see * 0.7 + 90);
      flyTo(eye, tg, 2.2, () => {}); RST.wave.back = () => { if (!tween && follow < 0) flyTo(back.e, back.t, 2.0, () => {}); };
    }
  }
  // ---- vibe pass 2: the living world (src/world_fx.js). Curiosities the colour wakes: a soft shimmer each, then ONE gentle
  // note for the wave (names gathered for a few seconds); never on load (already-coloured ones are simply awake)
  let wokeList = [], wokeT = null;
  function curioWoke(c) {
    if (snd && snd.sfx3) snd.sfx3('shimmer', c.x, c.y + 2, c.z);
    wokeList.push(wfx.NAMES[c.kind]); if (wokeT) return;
    wokeT = setTimeout(() => { const L = [...new Set(wokeList)]; wokeList = []; wokeT = null; if (!L.length || VISIT) return;
      const S3 = L.length > 3 ? [...L.slice(0, 2), `${L.length - 2} more sleepers`] : L;
      toast(`${IC.sparkle || IC.tree} The colour reached ${S3.length > 1 ? S3.slice(0, -1).join(', ') + ' and ' + S3[S3.length - 1] : S3[0]}. ${L.length > 1 ? "They're" : "It's"} waking up!`, 6000); }, 4500);
  }
  // puddles: up while a shower falls, drying over ~40 min of island time after it
  // the ground's wetness for the view: a sudden shower (events) or a weather rain (src/weather.js, smoothed by weather_fx)
  function wetness() { return Math.max(showerWet(), wxFx ? wxFx.wx.wet : 0); }
  function showerWet() {
    const E = S.events, sh = E.active.find(e => e.type === 'shower');
    if (sh) return Math.min(1, (S.time - sh.t0) / 120);
    const last = E.last && E.last.shower; if (last === undefined) return 0;
    const since = S.time - (last + Events.C.DUR.shower); return since < 0 ? 0 : Math.max(0, 1 - since / 2400);
  }
  // ---- step 5: seasons, growth stages, tree memories, the Book
  const SEA_TXT = { spring: 'blossoms everywhere, root gardeners +20 %', summer: 'long sunny days, a thirstier tree, +10 % glow sap', autumn: 'harvest time: gathering + gardens +25 %, lanterns round the plaza', winter: 'snow and short days: light matters most (lantern walks +50 %), the tree drinks less' };
  const fmtDays = sec => { const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600); return d ? `${d} day${d > 1 ? 's' : ''}${h ? ' ' + h + ' h' : ''}` : fmtT(sec); };
  const SEA_HELLO = { spring: 'Spring drifts in: blossoms and petals everywhere!', summer: 'Summer is here! Long sunny days (the tree gets a little thirstier)', autumn: 'Autumn arrives: harvest time, and lanterns round the plaza', winter: 'Winter tiptoes in: snow on the roofs. Light matters most now!' };
  function seasonCheck() {
    const k = Seasons.of(S); if (k === null || k === S.book.sea || VISIT) return;
    const first = S.book.sea === -1;
    // vibe pass 1: on a fresh island the tree speaks first; the season note waits for its words (or ~25 s if it has none)
    if (first && (!booted || (sayOpen && performance.now() - sayT < 20000) || (session.n === 0 && performance.now() - bootAt < 25000))) return;
    if (first && newbie() && (sayOpen || !beatOk() || overlayOpen())) return;   // playtest fixes: first launch = after the words, one at a time
    S.book.sea = k; const nm = Seasons.NAMES[k];
    toast(`${IC[nm]} ${first ? `<b>${Seasons.TITLE[nm]}</b> on the island: ${SEA_TXT[nm]}` : SEA_HELLO[nm]}`, 6500, () => openBook('mem'));
  }
  // built cottages: a lantern by each door in autumn
  let doorSig = '', doors = [];
  function homeDoors() {
    const sig = Object.keys(S.plots).filter(k => S.plots[k].done && S.plots[k].type === 'home').join(',');
    if (sig !== doorSig) { doorSig = sig; doors = sig ? sig.split(',').map(k => { const q = nav.plotBy[+k], o = q.out; return [q.door[0] + o[0] * 5 - o[1] * 3, q.door[2] + o[1] * 5 + o[0] * 3, Math.atan2(o[0], o[1])]; }) : []; }
    return doors;
  }
  // the island opens as the tree grows: thinned-out woods grow back (L4: past 300 m, L6: past 210 m; visual only - the
  // nearer thinned spots are the decor spots)
  let landLv = -1;
  function growLand(lv) {
    const k = lv >= 6 ? 2 : lv >= 4 ? 1 : 0; if (k === landLv) return; landLv = k;
    const R = [1e9, 300, 210][k], TP = nav.TP;
    for (const b of map.batches) for (const i of b.inst) if (i.thin) i.role = Math.hypot(i.c.x - TP[0], i.c.z - TP[2]) >= R ? 'forest' : 'later';
    map.invalidate();
  }
  // tree memory card (level-up, the Book, the away card)
  let memOpen = 0;
  function showMemory(lv) {
    const m = Growth.MEMORIES[lv]; if (!m) return; memOpen = lv;
    const un = (Growth.UNLOCKS[lv] || []).map(([ic, t]) => `<li>${IC[ic] || IC.star}<span>${t}</span></li>`).join('');
    $('memBody').innerHTML = `<div class="mstage disp">${IC.memory} Level ${lv} &middot; ${Growth.stageName(lv)}</div><h2 class="disp">${m.title}</h2><p class="mtext">${m.text}</p>${lv > 1 ? `<h4>${IC.star} Growing taller opened</h4><ul class="munl">${un}</ul>` : `<ul class="munl">${un}</ul>`}`;
    $('mem').hidden = false; if (S.book.read < lv) { S.book.read = lv; save(); }
  }
  function closeMemory() { $('mem').hidden = true; memOpen = 0; }
  let bookTab = 'mem';
  // playtest fixes (c3): breeds by what they are (the models, Pawty's build_pups.py), never the raw id (which is also a pup's name)
  const BREED_N = { noodle: 'Chihuahua', bean: 'Terrier', biscuit: 'Corgi', mochi: 'Samoyed', pepper: 'Schnauzer', pudding: 'Shiba', waffles: 'Dachshund' };
  const breedName = b => BREED_N[b] || String(b).replace(/^./, c => c.toUpperCase());
  function openBook(tab) { closePlot(); closeExp(); closeEvents(); closeNeed(); bookTab = tab || bookTab; $('book').hidden = false; renderBook(); }
  function closeBook() { $('book').hidden = true; }
  function renderBook() {
    document.querySelectorAll('#bookTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === bookTab));
    const unread = S.book.read < S.level; $('bookTabs').querySelector('[data-t="mem"]').classList.toggle('new', unread);
    $('bookTabs').querySelector('[data-t="words"]').classList.toggle('new', bookTab !== 'words' && Story.unread(S) > 0);
    let h = '';
    if (bookTab === 'mem') {
      const sk = Seasons.of(S);
      if (sk !== null) { const nm = Seasons.NAMES[sk], a = Seasons.at(S.ep0 + S.time); h += `<div class="bseason sea-${nm}">${IC[nm]}<div><b>${Seasons.TITLE[nm]}</b><small>${SEA_TXT[nm]} &middot; ${Seasons.TITLE[Seasons.NAMES[(sk + 1) % 4]].toLowerCase()} arrives in ${fmtDays(a.left)}</small></div></div>`; }
      h += `<p class="bsub">Each time the Elder Tree grows, it keeps a memory. <b>${Growth.stageName(S.level)}</b> stage, level ${S.level} of 8.</p><div class="mgrid">`;
      for (let lv = 1; lv <= 8; lv++) {
        const m = Growth.MEMORIES[lv], got = lv <= S.level, nw = got && lv > S.book.read;
        h += got ? `<button class="mtile${nw ? ' new' : ''}" data-mem="${lv}"><span class="ml disp">Lv ${lv} &middot; ${Growth.stageName(lv)}</span><b class="disp">${m.title}</b><small>${m.text.slice(0, 64)}...</small>${nw ? '<em>new</em>' : ''}</button>`
          : `<div class="mtile lock"><span class="ml disp">Lv ${lv} &middot; ${Growth.stageName(lv)}</span><b>${IC.lock} A memory still sleeping in the bark</b><small>${Growth.UNLOCKS[lv].map(u => u[1]).slice(0, 2).join(', ')}...</small></div>`;
      }
      h += '</div>' + ringsBookHtml();
    } else if (bookTab === 'pups') {
      const by = {}; S.pups.forEach(p => { (by[p.breed] = by[p.breed] || []).push(p); });
      const met = Sim.BREEDS.filter(b => by[b]).length;
      h += `<p class="bsub">Breeds met: <b>${met} / ${Sim.BREEDS.length}</b> &middot; ${S.pups.length} pups call the island home.</p><div class="pgrid">`;
      for (const b of Sim.BREEDS) {
        const L = by[b] || [], c = L[0] ? L[0].collar : '#bbb';
        h += `<div class="ptile${L.length ? '' : ' lock'}"><i class="pface" style="--c:${c}">${IC.paw}</i><b class="disp">${BREED_N[b] || b}</b><small>${L.length ? `${L.length} on the island: ${L.slice(0, 4).map(p => esc(p.name)).join(', ')}${L.length > 4 ? ' +' + (L.length - 4) : ''}` : b === 'noodle' ? 'not met yet: they live out on the floating isles' : 'not met yet'}</small></div>`;
      }
      const sp = [['Lumen', S.inv.lumen || S.pups.some(p => p.special), 'the glowing pup in the gift basket (day 14)']].concat(Exped.ISLE_PUPS.map(p => [p.name, S.pups.some(q => q.id === p.id), 'a rare find on a skyboat trip']));
      h += `</div><h4>${IC.star} Rare pups</h4><div class="pgrid sm">` + sp.map(([n, got, w]) => `<div class="ptile${got ? '' : ' lock'}"><i class="pface" style="--c:${got ? '#9fe8ff' : '#bbb'}">${IC.paw}</i><b class="disp">${got ? n : '???'}</b><small>${got ? 'lives here now!' : w}</small></div>`).join('') + '</div>';
    } else if (bookTab === 'decor') {
      const have = {}; for (const d of S.inv.decor) have[d] = (have[d] || 0) + 1; for (const x of S.placed) have[x.id] = (have[x.id] || 0) + 1;
      const ids = Object.keys(Exped.DECOR), n = ids.filter(d => have[d]).length;
      h += `<p class="bsub">Treasures found: <b>${n} / ${ids.length}</b> (skyboat trips, the trader, the gift basket, the crafting nook).</p><div class="pgrid">`;
      for (const d of ids) h += `<div class="ptile${have[d] ? '' : ' lock'}"><i class="dface">${have[d] ? IC.decor : IC.lock}</i><b class="disp">${have[d] ? decorName(d) : '???'}</b><small>${have[d] ? `${have[d]} found &middot; ${S.placed.filter(x => x.id === d).length} placed` : findWhere(d)}</small></div>`;
      h += '</div>';
    } else if (bookTab === 'words') {
      h += renderWords(); if (Story.unread(S)) { Story.readAll(S); save(); }
    } else if (bookTab === 'crit') {
      h += renderCritters();
    } else if (bookTab === 'lan') {   // Round 2 step 4: lanterns received + sent
      h += lan ? lan.bookHtml() : '<p class="bsub">Lanterns only float over your own island.</p>';
    } else {
      const all = [...new Set(Object.keys(Daily.OUTFITS).concat(Exped.OUTFITS, Voyages.OUTFITS, Rings.OUTFITS))], own = new Set(S.inv.outfits);   // (update 3: + voyage + ring outfits)
      h += `<p class="bsub">Outfits: <b>${all.filter(o => own.has(o)).length} / ${all.length}</b>.${VISIT ? '' : ' Tap one to dress a pup up.'}</p><div class="pgrid">`;
      for (const o of all) { const w = Wardrobe.wearer(S, o), tag = own.has(o) && !VISIT ? 'button' : 'div';
        h += `<${tag} class="ptile${own.has(o) ? ' fitt' : ' lock'}"${tag === 'button' ? ` data-bfit="${o}"` : ''}><i class="dface">${own.has(o) ? IC.scarf : IC.lock}</i><b class="disp">${own.has(o) ? outfitName(o) : '???'}</b><small>${own.has(o) ? (w >= 0 ? 'worn by ' + esc(S.pups[w].name) : 'on its hook') : Wardrobe.where(o)}</small></${tag}>`; }
      h += '</div>';
    }
    $('bookBody').innerHTML = h;
  }
  // ---- Round 2 step 3: sky critters (src/critters.js = who visits, src/critter_fx.js = how they look). Tap a visitor = its
  // card + it goes in the album (first sighting: sparkle + sting). The album is the Book's Critters tab.
  const RAR_T = Critters.RAR;
  // a portrait of the real model (critter_fx thumbs, made once with the game's renderer); unknown = its silhouette
  const cthumb = () => { try { return crFx && crFx.ready ? crFx.thumbs(renderer) : null; } catch (e) { console.warn('critter thumbs', e); return null; } };
  const cface = (sp, st) => { const T = cthumb(), u = T && T[sp.id]; return u ? `<img class="cpic${st === 'unknown' ? ' sil' : st === 'glimpsed' ? ' glim' : ''}" src="${u}" alt="">` : `<i class="cface${st === 'unknown' ? ' sil' : st === 'glimpsed' ? ' glim' : ''}" style="--c:${sp.col}"></i>`; };
  function renderCritters() {
    const ring = Story.ringOf(Story.bloom(S)), here = S.crit.vis.filter(v => Critters.BY[v.c]);
    let h = `<p class="bsub">Sky critters met: <b>${Critters.seenN(S)} / ${Critters.SP.length}</b>. Wild sky creatures drop by when the island has what they love: place treasures, build, and keep an eye out. Tap a visitor to say hello.</p>`;
    if (here.length) h += `<div class="chere"><span style="font:600 13px Fredoka,sans-serif;align-self:center">Visiting now:</span>${here.map(v => { const sp = Critters.BY[v.c], st = Critters.status(S, v.c); return `<button data-crit="${v.id}"><i class="cdot" style="--c:${sp.col}"></i>${st === 'unknown' ? 'Someone new!' : esc(sp.name)}</button>`; }).join('')}</div>`;
    h += '<div class="pgrid">';
    for (const sp of Critters.SP) {
      const st = Critters.status(S, sp.id), e = S.crit.al[sp.id] || { v: 0, s: 0, g: 0 }, hn = Critters.hint(S, sp.id, ring);
      if (st === 'seen') h += `<div class="ptile ctile" data-csp="${sp.id}" style="cursor:pointer">${cface(sp, st)}<b class="disp">${esc(sp.name)}</b><span class="rar ${sp.rar}">${RAR_T[sp.rar]}</span><small class="cwhen">${sp.whenT}</small><small>seen ${e.s}&times; &middot; ${e.v} visit${e.v === 1 ? '' : 's'}${e.g ? ` &middot; ${e.g} gift${e.g === 1 ? '' : 's'}` : ''}</small></div>`;
      else if (st === 'glimpsed') h += `<div class="ptile ctile glim">${cface(sp, st)}<b class="disp">${esc(sp.name)}</b><span class="rar ${sp.rar}">${RAR_T[sp.rar]}</span><small class="ch">It has come by ${e.v}&times;, but you haven't met yet. Tap it next time!</small><small class="cwhen">${esc(hn.text)}</small></div>`;
      else h += `<div class="ptile ctile lock">${cface(sp, st)}<b class="disp">???</b>${sp.rar === 'legendary' ? `<span class="rar legendary">${RAR_T.legendary}</span>` : ''}<small class="ch">${esc(hn.text)}</small></div>`;
    }
    return h + '</div>';
  }
  let critOpen = null;
  function openCritCard(cid, v, first) {
    const sp = Critters.BY[cid]; if (!sp) return; const e = S.crit.al[cid] || { v: 0, s: 0, g: 0 };
    critOpen = v ? v.id : null;
    $('ccBody').innerHTML = `<div class="cch">${cface(sp, 'seen')}<div><h3>${esc(sp.name)}<span class="rar ${sp.rar}">${RAR_T[sp.rar]}</span></h3>${first ? `<span class="cnew">${IC.star} A new friend for the album!</span>` : ''}</div></div>
      <p>${esc(sp.note)}</p><div class="cmeta"><span>${IC.clock} ${sp.whenT}</span>${v ? `<span>${IC.critter} ${esc(Critters.where(S, v, nav))}</span>` : ''}<span>${IC.heart} loves ${esc(sp.fav)}</span><span>seen ${e.s}&times; &middot; ${e.v} visit${e.v === 1 ? '' : 's'}${e.g ? ` &middot; ${e.g} gift${e.g === 1 ? '' : 's'}` : ''}</span>${sp.gift ? `<span>${IC.gift} sometimes leaves ${esc(sp.gift.name)}</span>` : ''}</div>`;
    $('critCard').hidden = false;
  }
  function closeCritCard() { $('critCard').hidden = true; critOpen = null; }
  function sparkleAt(p3) {
    const v = new THREE.Vector3().fromArray(p3).project(camera); if (v.z > 1) return;
    const d = document.createElement('div'); d.className = 'cspark'; d.style.left = ((v.x + 1) / 2 * W()) + 'px'; d.style.top = ((1 - v.y) / 2 * H()) + 'px';
    d.innerHTML = [...Array(18)].map((_, k) => { const a = k / 18 * Math.PI * 2, r = 50 + (k % 3) * 30; return `<i style="--dx:${(Math.cos(a) * r).toFixed(0)}px;--dy:${(Math.sin(a) * r - 20).toFixed(0)}px;animation-delay:${(k % 4) * 0.06}s"></i>`; }).join('');
    app.appendChild(d); setTimeout(() => d.remove(), 1800);
  }
  // tap a visitor (or a "Go see" button): the card; first sighting = sparkle + sting. fly = move the camera there first.
  function meetCritter(id, fly) {
    const v = S.crit.vis.find(x => x.id === id); if (!v) { toast(`${IC.critter} It has already wandered off. It'll be back!`, 2600); return; }
    if (fly) critCam(id);
    if (VISIT) { openCritCard(v.c, v, false); return; }   // someone else's island: look, never write their album
    const r = Critters.tap(S, id); if (!r) return;
    openCritCard(v.c, v, r.first);
    const p = crFx && crFx.posOf(id);
    if (r.first) { snd.sfx('sting_gift', { gain: 0.8 }); if (p) setTimeout(() => sparkleAt(crFx.posOf(id) || p), fly ? 1300 : 0); }
    else snd.sfx('like', { gain: 0.6 });
    save(); if (!$('book').hidden) renderBook();
  }
  // Round 2 step 4: watch a released lantern rise from the plaza (then home); look at a sky lantern
  function releaseCam(p) {
    const TP = nav.TP, ux = p[0] - TP[0], uz = p[2] - TP[2], ul = Math.hypot(ux, uz) || 1, k = W() < H() ? 1.35 : 1;
    follow = -1; pups.select(-1);
    flyTo(new THREE.Vector3(p[0] + ux / ul * 75 * k, p[1] + 12, p[2] + uz / ul * 75 * k), new THREE.Vector3(p[0], p[1] + 25, p[2]), 1.4, () => {
      tween = { e0: camera.position.clone(), t0: controls.target.clone(), e1: camera.position.clone(), t1: new THREE.Vector3(p[0], p[1] + 160, p[2]), t: 0, dur: 10, then: () => setTimeout(() => { if (!tween && follow < 0) flyHome(); }, 1200) };
    });
  }
  function bloomCam() {   // the World Bloom on the horizon: from the island's edge on its side, looking out (the orbit target stays within reach)
    if (!lfx) return; const b = lfx.bloomPos(), TP = nav.TP, d = new THREE.Vector3(b[0] - TP[0], 0, b[2] - TP[2]).normalize();
    const eye = new THREE.Vector3(TP[0], TP[1], TP[2]).addScaledVector(d, 170); eye.y = ground(eye.x, eye.z, TP[1]) + 30; const dir = new THREE.Vector3(b[0], b[1] - 25, b[2]).sub(eye).normalize();
    follow = -1; pups.select(-1); flyTo(eye, eye.clone().addScaledVector(dir, 320), 1.8);
  }
  function lookAt(p) { const tgt = new THREE.Vector3(p[0], p[1], p[2]), dir = camera.position.clone().sub(tgt).setY(0).normalize(); follow = -1; flyTo(tgt.clone().add(dir.multiplyScalar(55)).add(new THREE.Vector3(0, -10, 0)), tgt, 1.2); }
  function critCam(id) {
    const p = crFx && crFx.posOf(id); if (!p) return;
    const v = S.crit.vis.find(x => x.id === id), big = crFx.sizeOf(id), tgt = new THREE.Vector3(p[0], p[1], p[2]);
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize(), d = v && v.c === 'whale' ? 260 : Math.max(22, big * 6);
    const up = new THREE.Vector3(0, v && v.c === 'whale' ? -40 : d * 0.45, 0);
    // vibe pass 1: turn round the critter until no pup stands between it and the lens (or right at the lens)
    if (!(v && v.c === 'whale')) {
      const seg = new THREE.Line3(), q = new THREE.Vector3(), hp = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      const clear = e => { seg.set(e, tgt); let m = 1e9; for (const P of pups.list) { hp.copy(P.holder.position).setY(P.holder.position.y + 2.5); if (hp.distanceTo(tgt) < 4) continue; seg.closestPointToPoint(hp, true, q); m = Math.min(m, q.distanceTo(hp)); } return m; };
      let best = null, bm = -1;
      // first look from higher up (over the pups' heads), then turn a little either way
      for (const [a, hk] of [[0, 1], [0, 1.8], [0.5, 1], [-0.5, 1], [0.5, 1.8], [-0.5, 1.8], [1.1, 1.8], [-1.1, 1.8], [Math.PI, 1.8]]) {
        const e = tgt.clone().add(dir.clone().applyAxisAngle(Y, a).multiplyScalar(d)).addScaledVector(up, hk), m = clear(e);
        if (m > 6) { best = e; break; } if (m > bm) { bm = m; best = e; }
      }
      follow = -1; pups.select(-1); flyTo(best, tgt, 1.3); return;
    }
    follow = -1; pups.select(-1); flyTo(tgt.clone().add(dir.multiplyScalar(d)).add(up), tgt, 1.3);
  }
  const findWhere = d => { if (Catalog.BY[d] && Catalog.BY[d].from === 'craft') return 'made in the crafting nook'; if (Catalog.BY[d] && Catalog.BY[d].from === 'ring') return 'an Elder ring gift'; const ds = Exped.DEST.filter(x => (x.decor || []).includes(d)).map(x => x.name); return ds.length ? 'found on ' + ds.slice(0, 2).join(' / ') : Events.OFFERS.some(o => o.get.decor === d) ? 'from the wandering trader' : 'tucked in a gift basket'; };

  // ---- daily gift (src/daily.js): calendar popup, opened by itself on the first open of a local day
  let giftPending = false, giftJust = null;
  const giftItems = g => {
    const a = [];
    for (const k in g.res) a.push(`<span class="gl">${IC[k]}+${g.res[k]}</span>`);
    if (g.sap) a.push(`<span class="gl">${IC.sap}+${g.sap}</span>`);
    if (g.seeds) a.push(`<span class="gl">${IC.seed}+${g.seeds} seeds</span>`);
    if (g.decor) a.push(`<span class="gl">${IC.jar}${Daily.DECOR[g.decor]}</span>`);
    if (g.outfit) a.push(`<span class="gl">${IC.scarf}${Daily.OUTFITS[g.outfit]}</span>`);
    if (g.pup) a.push(`<span class="gl">${IC.paw}${esc(g.pup.name)}, a glowing pup</span>`);
    return a;
  };
  function renderGift() {
    const st = Daily.status(S, new Date());
    $('gTiles').innerHTML = st.tiles.map(x => {
      const g = x.gift, items = giftItems(g);
      const ic = g.pup ? IC.paw : g.outfit ? IC.scarf : g.decor ? IC.jar : g.seeds ? IC.seed : Object.keys(g.res).length === 1 ? IC[Object.keys(g.res)[0]] : g.sap && !Object.keys(g.res).length ? IC.sap : IC.gift;
      return `<div class="gt${x.done ? ' done' : ''}${x.today ? ' today' : ''}${x.k === 6 ? ' rare' : ''}${giftJust !== null && x.today && x.done ? ' pop' : ''}"><b>Day ${x.k + 1}</b><div class="gi">${ic}</div><small>${items.join(' ')}</small>${x.done ? `<i class="stamp">${IC.paw}</i>` : ''}${x.k === 6 ? '<em>rare</em>' : ''}</div>`;
    }).join('');
    let msg = '';
    if (st.back) msg = `Your clock seems to have slipped back in time. The next basket waits for your next new day.`;
    else if (st.can && st.missed) msg = `Welcome back! Missed a day? The calendar simply waits for you. Nothing is lost.`;
    else if (st.can) msg = `The Elder Tree packed a basket for you, just for coming by today.`;
    else msg = `Tucked into the pantry. Tomorrow's basket holds Day ${(S.daily.claims % 7) + 1}.`;
    $('gMsg').innerHTML = msg;
    $('gStreak').innerHTML = `${IC.star}<b>${st.streak}</b> day${st.streak === 1 ? '' : 's'} in a row${st.bonusPct ? ` &middot; baskets +${st.bonusPct}%` : ''}`;
    $('gMonth').innerHTML = `<span>${IC.moon} Moon bonus</span><div class="bar"><i style="width:${Math.min(100, st.month.n / st.month.goal * 100).toFixed(0)}%"></i><span>${Math.min(st.month.n, st.month.goal)} / ${st.month.goal} days${st.month.done ? ' &middot; yours!' : ''}</span></div>`;
    if (giftJust) {
      const g = giftJust, items = giftItems(g);
      if (g.month) { if (g.month.sap) items.push(`<span class="gl">${IC.sap}+${g.month.sap}</span>`); if (g.month.decor) items.push(`<span class="gl">${IC.jar}${Daily.DECOR[g.month.decor]}</span>`); if (g.month.seeds) items.push(`<span class="gl">${IC.seed}+${g.month.seeds} seeds</span>`); }
      $('gGot').innerHTML = `<b>In the basket:</b> ${items.join(' ')}${g.month ? ' <b class="mb">+ the moon bonus!</b>' : ''}${g.pup ? `<br><small>${esc(g.pup.name)} moves in as soon as a bed is free.</small>` : g.outfit ? '<br><small>It hangs in the wardrobe: tap a pup, then Wardrobe.</small> <button class="ghost sm" data-dress="1">Dress a pup</button>' : g.decor ? '<br><small>Place it on the island: Skyboats, then Place.</small>' : g.seeds ? '<br><small>Seeds grow glow sprouts by the roots (root gardeners work better).</small>' : ''}`;
      $('gGot').hidden = false;
    } else $('gGot').hidden = true;
    $('gClaim').textContent = st.can ? 'Open the basket' : 'Lovely!';
    $('gClaim').classList.toggle('pulse', st.can);
    $('giftBtn').classList.toggle('ready', st.can);
  }
  function openGift() { giftJust = null; renderGift(); $('gift').hidden = false; }
  function closeGift() { $('gift').hidden = true; giftJust = null; }
  function claimGift() {
    if (!Daily.status(S, new Date()).can) { closeGift(); return; }
    const g = Daily.claim(S, new Date()); if (!g) { closeGift(); return; }
    giftJust = g; save(); renderGift(); refreshTree(); snd.sfx('sting_gift');
    toast(`${IC.gift} Today's basket: ${giftItems(g).join(' ')}`, 3200);
  }
  function giftCheck(auto) {
    if (VISIT) return;
    const st = Daily.status(S, new Date()); $('giftBtn').classList.toggle('ready', st.can);
    if (auto && st.can && Q.get('nogift') !== '1' && $('gift').hidden) queueCard('gift', openGift);   // vibe pass 1: after the away card + tour
  }
  // ---- vibe pass 1: cards on return come ONE after another (away -> tour of what changed -> daily gift -> memory card),
  // each waits until no other big card / the tour / a boat cam is up
  const CQ = [];
  function queueCard(k, open, first) { if (CQ.some(c => c.k === k)) return; if (first) CQ.unshift({ k, open }); else CQ.push({ k, open }); pumpCards(); }
  function pumpCards() { if (!booted || !CQ.length || overlayOpen() || tour || boatCam) return; const c = CQ.shift(); c.open(); }
  setInterval(pumpCards, 300);
  // build section: decide toggle + queue + what the island is waiting for
  let buildSig = '';
  function refreshBuild(force) {
    // playtest fixes (m5): the first-home hint goes once a home is planned by ANY route (plot card, Build, the pups' own plans)
    if (hintShown && !$('hint').hidden && Object.keys(S.plots).some(k => S.plots[k].type === 'home')) hintDone();
    const sig = S.queue.map(pid => { const e = S.plots[pid]; return pid + e.type + Math.floor(e.prog / 30) + e.paid; }).join('|') + S.decide + Math.floor(S.res.wood) + Math.floor(S.res.stone) + '|' + Math.floor(S.res.crystal || 0) + '|' + S.pups.filter(p => p.task === 'site' && p.phase === 'build').length + S.pups.filter(p => p.job === 'build').length + S.pups.length + Math.floor(S.arrive / 60);
    if (!force && sig === buildSig) return; buildSig = sig;
    $('decide').checked = !!S.decide;
    const builders = S.pups.filter(p => p.job === 'build').length;
    let html = '';
    for (const pid of S.queue) {
      const e = S.plots[pid], q = nav.plotBy[pid]; if (!e || !q) continue;
      const work = Sim.workOf(e.type, q), f = e.prog / work, cost = Sim.costOf(e.type, q);
      const on = S.pups.filter(p => p.tgt === pid && p.phase === 'build').length;
      let st;
      if (!builders) st = 'needs a builder';
      else if (!e.paid) { const miss = missing(cost), w = miss.find(x => !FETCH[x.k]); st = miss.length ? 'a little more needed: ' + missTxt(miss, false) + (w ? ` (${RES_N[w.k]}: ${RES_FROM[w.k]})` : '') : 'starting soon'; }
      else st = on ? `${on} pup${on > 1 ? 's' : ''} building &middot; ~${fmtT((work - e.prog) / Math.max(1, on))} to go` : 'builders on the way';
      html += `<div class="qi" data-pid="${pid}">${IC[B_ICON[e.type]]}<div><b>${bName(e.type, q)}</b>${e.auto ? '<span class="auto">pups\' idea</span>' : ''}<div class="bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div><small>${st}</small></div></div>`;
    }
    if (!html) html = `<div class="qe">${S.decide ? 'Nothing needed right now; the pups will start something when the island needs it.' : 'No plans on the table yet. Tap <b>Build</b> or a plot sign to sketch one.'}</div>`;
    // arrivals hint
    const beds = Sim.bedsOf(S, nav), n = S.pups.length;
    let why = '';
    if (n >= beds) why = 'Every bed is taken: build a home and a wanderer may move in.';
    else if (S.res.food < Sim.C.ARRIVE_FOOD) why = 'The pantry needs a few more berries before newcomers come.';
    else if (Sim.avgMorale(S) < Sim.C.ARRIVE_MORALE) why = 'The pups are a bit glum; newcomers wait for happier days.';
    else if (S.time - S.lastArrive < Sim.C.ARRIVE_GAP) why = `A bed is free. The next wanderer may come in ~${fmtT(Math.max(Sim.C.ARRIVE_GAP - (S.time - S.lastArrive), Sim.C.ARRIVE_WAIT - S.arrive))}.`;
    else why = `A bed is free, and a wanderer has noticed. Arrives in ~${fmtT(Sim.C.ARRIVE_WAIT - S.arrive)}.`;
    // vibe pass 1: a blueprint card appearing / leaving used to push the roster under the pointer (clicks landed on a
    // filter chip instead of a pup): while the pointer is on the panel, a change that would move the rows waits
    const qe = $('queue'), h0 = qe.offsetHeight, old = qe.innerHTML;
    qe.innerHTML = html + `<div class="qe arr">${IC.paw} ${why}</div>`;
    if (!force && sideHot() && qe.offsetHeight !== h0) { qe.innerHTML = old; buildSig = ''; }
  }
  // ---- playtest fixes: the "What next?" chip + the idle-pup notice. ONE small chip (where the first hint sits: bottom centre on
  // a PC, under the top buttons on a phone) suggesting the single most useful next step, derived from S only (no save field).
  // A goal shows only after it held for GOAL.HOLD s, never over a card / a tool mode / the first hint, fades with the calm view;
  // tap = do it (or open the right card); ✕ = not now (that goal rests GOAL.REST, a UI pref in its own key).
  const GOAL = { HOLD: 8000, REST: 6 * 3600e3, AFTER: 45000, KEY: 'schiffy-elderglow.ui.goal', IDLE: 45 };
  const idleT = [];   // seconds each pup has had nothing to do (UI only)
  let goalCur = null, goalCand = null, goalSince = 0, goalAfter = 0, goalAcc = 0;
  const goalRest = (() => { try { return JSON.parse(localStorage.getItem(GOAL.KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const freePlot = type => nav.plots.find(q => q.lv <= S.level && !S.plots[q.pid] && Sim.fits(q, type) && Sim.canBuild(S, q, type));
  function goBuild(type) { const q = type && freePlot(type), x = q ? null : plots.info.find(x => x.st === 'open' && x.show) || plots.info[0]; openPlot(q ? q.pid : x.q.pid, true); }
  function nextGoal() {
    const now = performance.now(), N = S.pups.length, P = k => S.plots[k];
    const anyHome = Object.keys(S.plots).some(k => P(k).type === 'home');
    // 1. a need running low with too few pups on it
    for (const k of Object.keys(Sim.C.NEEDS)) {
      const r = needRate(k); if (r === null || S.needs[k] >= 45 || r >= 0) continue;
      return { k: 'need-' + k, ic: k, t: `${NEED_NAMES[k]} ${k === 'nourish' ? 'are' : 'is'} running low: give ${k === 'nourish' ? 'them' : 'it'} another pup`, a: [['Who can help?', () => openNeed(k)]] };
    }
    // 2. idle pups (the idle-pup notice): a builder with nothing planned, or one waiting on something no builder can fetch
    const idle = S.pups.findIndex((p, i) => (idleT[i] || 0) > GOAL.IDLE && !p.exp);
    if (idle >= 0) {
      const p = S.pups[idle], nm = esc(p.name), pl = S.queue.length ? planNow() : null, w = pl ? pl.miss.find(x => !FETCH[x.k]) : null;
      if (!pl) return { k: 'idle-plan', ic: 'build', t: `${nm} has nothing to build`, a: [['Plan a home', () => goBuild('home')], S.decide ? null : ['Let the pups plan', () => { $('decide').checked = true; $('decide').onchange({ target: $('decide') }); }], ['New job', () => focusPup(idle)]].filter(Boolean) };
      if (w) return { k: 'idle-' + w.k, ic: w.k, t: `${nm} waits for ${w.n} ${RES_N[w.k]} (${RES_FROM[w.k]})`, a: [w.k === 'crystal' && Needs.firstBuilt(S, 'board') !== null ? ['Skyboats', () => openExp()] : ['See the plan', () => openPlot(pl.pid, true)], ['New job', () => focusPup(idle)]] };
    }
    // 3. the first home (when the first hint has gone)
    if (!anyHome && N) return { k: 'home1', ic: 'home', t: 'Plan your first home: a free bed brings a new pup', a: [['Plan it', () => goBuild('home')]] };
    // 4. a haul waiting at the dock
    if (S.exp.hauls.length) return { k: 'haul', ic: 'board', t: 'A sack of treasures is waiting at the dock', a: [['Open it', () => openHaul(0)]] };
    // 5. the skyboat dock once the tree is tall enough
    if (S.level >= (Sim.C.B.board.lv || 2) && !Object.keys(S.plots).some(k => P(k).type === 'board') && freePlot('board')) return { k: 'dock', ic: 'board', t: 'The isles drift close: build the skyboat dock', a: [['Pick a plot', () => goBuild('board')]] };
    // 6. a first decoration to craft
    if (window.Catalog && !Object.keys(S.inv.craft || {}).length && Catalog.LIST.some(e => e.from === 'craft' && Catalog.canCraft(S, e.id).ok)) return { k: 'craft', ic: 'decor', t: 'You have enough to craft a decoration', a: [['Craft', () => openCraft()]] };
    return null;
  }
  function goalTick(dt) {
    for (let i = 0; i < S.pups.length; i++) { const p = S.pups[i]; idleT[i] = p.job === 'build' && p.task === 'wait' && !p.exp && (!S.queue.length || (planNow() || { miss: [] }).miss.some(x => !FETCH[x.k])) ? (idleT[i] || 0) + dt : 0; }
    if ((goalAcc += dt) < 1) return; goalAcc = 0;
    const el = $('goal'), now = performance.now(), wall = Date.now();
    document.body.classList.toggle('askup', [...document.querySelectorAll('#sndAsk.in, #appAsk.in')].some(e => !e.hidden && e.getClientRects().length > 0));   // (a narrow PC: the chip makes room for the sound / app question)
    const blocked = VISIT || !booted || overlayOpen() || sayOpen || PM || LM || TPM || PHOTO || tour || newbie() || (!$('hint').hidden) || now < goalAfter ||
      (document.body.classList.contains('phone') && (TQ.live.length || sayOpen || $('side').classList.contains('open')));
    let g = blocked ? null : nextGoal();
    if (g && goalRest[g.k] && wall - goalRest[g.k] < GOAL.REST) g = null;
    if (!g || !goalCand || g.k !== goalCand.k) { goalCand = g; goalSince = now; }
    else goalCand = g;   // (same goal: its words may have changed)
    const show = g && now - goalSince >= GOAL.HOLD ? g : null;
    if (!show) { if (goalCur) { goalCur = null; el.classList.remove('in'); setTimeout(() => { if (!goalCur) el.hidden = true; }, 400); } return; }
    const sig = show.k + show.t + show.a.map(a => a[0]).join();
    if (!goalCur || goalCur.sig !== sig) {
      el.innerHTML = `<span class="goal-ic">${IC[show.ic] || IC.star}</span><span class="goal-t">${show.t}</span>${show.a.map((a, n) => `<button class="${n ? 'ghost' : 'go'} sm" data-g="${n}">${a[0]}</button>`).join('')}<button class="goal-x" title="Not now" aria-label="Not now">&#10005;</button>`;
      if (el.hidden) { el.hidden = false; requestAnimationFrame(() => el.classList.add('in')); }
    }
    goalCur = Object.assign({ sig }, show);
  }
  function goalClick(e) {
    const g = goalCur; if (!g) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('goal-x')) { goalRest[g.k] = Date.now(); try { localStorage.setItem(GOAL.KEY, JSON.stringify(goalRest)); } catch (er) {} snd.sfx('close'); }
    else { const a = g.a[+b.dataset.g]; if (a) a[1](); }
    goalAfter = performance.now() + GOAL.AFTER; goalCur = null; goalCand = null; const el = $('goal'); el.classList.remove('in'); setTimeout(() => { if (!goalCur) el.hidden = true; }, 400);
  }
  let sideTouch = -1e9;
  const sideHot = () => $('side').matches(':hover') || performance.now() - sideTouch < 2000;

  // ---- plot card (build menu): open plot -> 5 building types; locked -> what unlocks it; blueprint -> progress + cancel
  let curPlot = null, plotSig = '';
  function openPlot(pid, fly) {
    if (expView) closeExp(); closeEvents(); closeNeed();
    curPlot = pid; plots.sel = pid; plots.build = true; $('plotCard').hidden = false; renderPlot(true);   // vibe pass 1: build look (outlines + signs) while the menu is open
    const x = plots.byPid[pid]; if (!x) return;
    if (fly) {
      const tgt = new THREE.Vector3(x.c[0], x.gy + 3, x.c[1]);
      const out = new THREE.Vector3(x.c[0] - nav.TP[0], 0, x.c[1] - nav.TP[2]).normalize();
      const ph = document.body.classList.contains('phone');
      const dist = Math.max(75, Math.max(x.w, x.d) * 4.5) * (W() < H() ? 1.3 : 1);
      const eye = tgt.clone().add(out.multiplyScalar(dist * 0.88)).add(new THREE.Vector3(0, dist * 0.45, 0));
      if (ph) tgt.y -= dist * 0.22;   // phone: the card covers the bottom, aim lower so the plot sits higher on screen
      follow = -1; pups.select(-1); flyTo(eye, tgt, 1.1);
    }
  }
  function closePlot() { curPlot = null; if (plots) { plots.sel = null; plots.build = false; } $('plotCard').hidden = true; }
  function cyclePlot(d) {
    const list = plots.info.filter(x => x.show && (x.marker || x.st === 'build' || x.st === 'done'));
    if (!list.length) return; let k = list.findIndex(x => x.q.pid === curPlot); k = (k + d + list.length) % list.length; openPlot(list[k].q.pid, true);
  }
  function renderPlot(force) {
    if (curPlot === null) return;
    const q = nav.plotBy[curPlot], e = S.plots[curPlot]; if (!q) return;
    const sig = curPlot + (e ? e.type + Math.floor(e.prog / 20) + e.done + e.paid + (e.rot || 0) + (e.col || 0) + (e.piece || '') + q.piece + q.ry : '-') + S.level + Math.floor(S.res.wood) + Math.floor(S.res.stone) + Math.floor(S.sap) + '|' + Math.floor(S.res.crystal || 0) + '|' + Math.floor(S.res.food) + S.pups.filter(p => p.job === 'build').length;
    if (!force && sig === plotSig) return; plotSig = sig;
    const builders = Math.max(1, S.pups.filter(p => p.job === 'build').length), nb = S.pups.filter(p => p.job === 'build').length;
    const fType = q.faction ? Object.keys(Sim.C.B).find(t => Sim.C.B[t].piece === q.piece) : null;   // step 5: the hall this plot holds
    $('pcTitle').innerHTML = `${q.faction ? (fType ? IC[B_ICON[fType]] : IC.lock) : e ? IC[B_ICON[e.type]] : IC.home} ${plotName(q)} ${q.free ? '<small>on open land</small>' : `<small>${Math.round(q.d)} m stroll</small>`}`;
    let h = '';
    if (q.faction && !e && q.lv > S.level) h = `<p class="lockd">${IC.lock} <b>${q.faction.name}</b> &middot; ${q.faction.what}.<br>The old hall wakes when the Elder Tree reaches <b>level ${q.faction.lv}</b> (${Growth.stageName(q.faction.lv)} stage; now ${S.level}).</p>${fType ? `<p class="sub">${gives(fType, q)}</p>` : ''}`;
    else if (!e && q.lv > S.level) h = `<p class="lockd">${IC.lock} This land opens when the Elder Tree grows to <b>level ${q.lv}</b> (now ${S.level}).</p>`;
    else if (!e) {
      h = `<p class="sub">${q.faction ? `The old <b>${q.faction.name}</b> can rise again: ${q.faction.what}.` : 'Pick what the pups should build here.'}${nb ? '' : ' <b>No pup is a builder yet.</b>'}</p>`;
      for (const type of Object.keys(Sim.C.B)) {
        if (!Sim.fits(q, type)) continue;   // a faction plot lists only its own hall; house plots never list halls
        const cost = Sim.costOf(type, q), work = Sim.workOf(type, q), B = Sim.C.B[type];
        const why = B.need && Needs.awakeK(S, B.need) < 0 ? `With ${NEED_NAMES[B.need]}` : B.lv && S.level < B.lv ? `Tree level ${B.lv}` : B.one && Object.values(S.plots).some(e => e.type === type) ? 'Built' : '';
        const ms = why ? [] : missing(cost).filter(x => !FETCH[x.k]);   // playtest fixes: only what is still missing (wood + stone the builders fetch), and from where
        h += `<div class="bo${why ? ' off' : ''}">${IC[B_ICON[type]]}<div class="bi"><b>${bName(type, q)}</b><small>${gives(type, q)}</small><div class="cs">${costHtml(cost)}<span class="tm">${IC.clock}${fmtT(work / builders)}${nb > 1 ? ` with ${nb}` : ''}</span></div>${ms.length ? `<small class="miss">Still needed: ${missTxt(ms, true)}</small>` : ''}</div>${why ? `<span class="why">${IC.lock}${why}</span>` : `<button class="go" data-act="order" data-type="${type}">Build</button>`}</div>`;
      }
      h += `<p class="sub small">Builders pay when they start and fetch any missing wood or stone themselves. Glow sap comes from a happy tree${Object.keys(Sim.C.B).some(t => Sim.fits(q, t) && Sim.costOf(t, q).crystal) ? '; crystals from skyboat trips and happenings' : ''}.</p>`;
    } else if (e.done) h = `<p>${IC[B_ICON[e.type]]} <b>${bName(e.type, q)}</b> &middot; ${gives(e.type, q)}</p><p class="sub">Built by the pups${e.auto ? ' (their own idea)' : ''}${q.free ? ' on a spot you picked' : ''}.</p>${e.type === 'board' ? `<button class="go" data-act="exp">${IC.board} Open the skyboat dock</button>` : ''}` + homeTools(q, e);
    else {
      const work = Sim.workOf(e.type, q), f = e.prog / work, on = S.pups.filter(p => p.tgt === curPlot && p.phase === 'build').length;
      // playtest fixes (m3 + plot card): the stage names the REAL hold-up, and the card lists only what is still missing + where it comes from
      const ms = e.paid ? [] : missing(Sim.costOf(e.type, q)), wait = ms.filter(x => !FETCH[x.k]);
      const stage = !e.paid ? (wait.length ? `Plans · waiting for ${wait.map(x => RES_N[x.k]).join(' + ')}` : ms.length ? (nb ? `Plans · builders fetching ${ms.map(x => RES_N[x.k]).join(' + ')}` : 'Plans · waiting for a builder') : nb ? 'Plans · starting soon' : 'Plans · waiting for a builder') : f < plots.SCAF ? 'Scaffolding' : f < 0.98 ? 'Framing' : 'Finishing touches';
      h = `<p>${IC[B_ICON[e.type]]} <b>${bName(e.type, q)}</b> &middot; ${gives(e.type, q)}</p><div class="bar big"><i style="width:${(f * 100).toFixed(1)}%"></i><span>${stage}${e.paid ? ' ' + Math.floor(f * 100) + '%' : ''}</span></div>
        <p class="sub">${e.paid ? `${on} builder${on === 1 ? '' : 's'} at work &middot; ~${fmtT((work - e.prog) / Math.max(1, on || builders))} to go` : ms.length ? `Still needed:<br>${missTxt(ms, true)}` : nb ? 'Everything is here: the builders start soon.' : 'Everything is here. <b>No pup is a builder yet.</b>'}</p>` + homeTools(q, e) + `<button class="ghost" data-act="cancel">Roll up the plans${e.paid ? ' (refund)' : ''}</button>`;
    }
    $('pcBody').innerHTML = h;
  }
  // creative build part 2, buildings (src/homes.js): a home's colours (6 palettes + the kit's own), another roof (the next house
  // piece of its class), a quarter turn; a free home also moves + comes down (a built one only when nobody needs its beds)
  const HOME_WHY = { far: 'Not yet: more land opens as the tree grows', tree: 'A little too close to the Elder Tree', plaza: 'The plaza in front of the tree stays open', door: 'The door would face a wall, water or a bridge',
    road: 'The door wants a path within 25 m', blocked: 'The pups couldn\'t reach its door (or a job nearby)', bridge: 'Not on a bridge', path: 'It would sit on a path', water: 'Not in the water',
    building: 'Another building is in the way', nature: 'A tree or rock is in the way', decor: 'A treasure is in the way', job: 'The pups work right there', full: `The island already has ${Homes.C.MAX} homes of your own`,
    level: `Treehouses come at tree level ${Homes.C.TREE_LV}`, beds: 'Pups sleep here: build another home first', none: 'Not here', land: 'Only on open ground' };
  function homeTools(q, e) {
    if (!q || !e || VISIT) return '';
    const home = e.type === 'home', turnable = q.free || Homes.canTurn(q), roofs = home ? Homes.choices(S, nav, curPlot) : [];
    if (!home && !turnable) return '';
    let h = '<div class="hmt">';
    if (home) h += `<div class="hmsw"><span>Colours</span>${['', ...Homes.PAL].map((p, i) => `<button class="hsw${(e.col || 0) === i ? ' on' : ''}" data-act="col" data-col="${i}" title="${i ? p.name : 'Its own colours'}" style="${i ? `background:linear-gradient(135deg,${p.roof} 0 48%,${p.wall} 48% 78%,${p.trim} 78%)` : ''}">${i ? '' : '&#8634;'}</button>`).join('')}</div>`;
    h += '<div class="hmb">';
    if (roofs.length > 1) h += `<button class="ghost sm" data-act="roof">${IC.home} Change roof</button>`;
    if (turnable) h += `<button class="ghost sm" data-act="turn">&#8635; Turn</button>`;
    if (q.free) h += `<button class="ghost sm" data-act="hmove">Move</button>` + (e.done ? `<button class="ghost sm" data-act="hdown">Take down</button>` : '');
    return h + '</div></div>';
  }
  function homeAct(a, el) {
    const pid = curPlot, q = nav.plotBy[pid], e = S.plots[pid]; if (!q || !e) return;
    const r = {};
    if (a === 'col') { if (Homes.paint(S, pid, +el.dataset.col)) { save(); snd.sfx('pop'); } }
    else if (a === 'roof') { const p = Homes.swap(S, nav, pid, r); if (p) { save(); syncPups(); snd.sfx('built'); toast(`${IC.home} A fresh new roof!`, 1600); } else toast(`${IC.home} No other roof fits here: ${HOME_WHY[r.why] || 'not here'}`, 2600); }
    else if (a === 'turn') {
      if (Homes.turn(S, nav, pid, r)) { save(); syncPups(); snd.sfx('pop'); if (r.k > 1) toast(`${IC.home} Turned ${r.k * 90}&deg; (a quarter turn would not fit: ${HOME_WHY[r.why] || 'not here'})`, 3200); }
      else toast(`${IC.home} It can't turn here: ${HOME_WHY[r.why] || 'not here'}`, 2800);
    } else if (a === 'hmove') { const f = Homes.freeOf(S, pid); closePlot(); startHome(f.piece, pid); return; }
    else if (a === 'hdown') { if (Homes.takeDown(S, nav, pid, r)) { save(); syncPups(); closePlot(); snd.sfx('close'); toast(`${IC.home} Taken down gently: half the materials are back in the pile`, 2600); return; } toast(`${IC.home} ${HOME_WHY[r.why] || 'Not now'}`, 2600); }
    plotSig = ''; renderPlot(true);
  }

  // ---- expeditions (src/expedition.js): trip board card (destinations, trips, hauls, decor), team picker, haul reveal
  let expView = null, expSig = '';   // null = closed, {v: 'home'} or {v: 'plan', dest, tier, team: []}
  const decorName = id => (Exped.DECOR[id] || {}).name || Daily.DECOR[id] || id;
  const outfitName = id => Daily.OUTFITS[id] || (Wardrobe.DEFS[id] && Wardrobe.DEFS[id].name) || id;
  const expLv = p => Exped.lvOf(p.xpE);
  function haulItems(h) {   // [{ic, txt, rare}] in reveal order: resources, crystals, seeds, decor, rare
    const a = [];
    for (const k of ['wood', 'stone', 'food']) if (h.res[k]) a.push({ ic: IC[k], txt: `+${h.res[k]}`, sub: k === 'food' ? 'berries' : k });   // (compares the key: the display name changed in the UI voice pass)
    if (h.star) a.push({ ic: IC.star, txt: `+${fmtN(h.star)}`, sub: 'starlight: Elder ring growth', rare: true });   // update 3: a far-sky voyage
    if (h.crystal) a.push({ ic: IC.crystal, txt: `+${h.crystal}`, sub: h.cache ? 'crystals (a cache!)' : 'crystals' });
    if (h.seeds) a.push({ ic: IC.seed, txt: `+${h.seeds}`, sub: 'seeds' });
    for (const d of h.decor) a.push({ ic: IC.decor, txt: decorName(d), sub: 'treasure' });
    if (h.outfit) a.push({ ic: IC.scarf, txt: outfitName(h.outfit), sub: 'rare outfit!', rare: true });
    if (h.pup) a.push({ ic: IC.paw, txt: esc(h.pup.name), sub: h.waits ? 'a chihuahua from the isles! (moves in when a bed is free)' : 'a chihuahua from the isles comes home with them!', rare: true });
    return a;
  }
  const haulLine = h => haulItems(h).map(x => `<span class="gl">${x.ic}${x.txt}${/^\+/.test(x.txt) && x.sub !== 'berries' && x.sub !== 'wood' && x.sub !== 'stone' ? ' ' + x.sub.split(' ')[0] : ''}</span>`).join(' ');
  function tripState(tr) {
    if (tr.dep < 0) return { txt: 'climbing aboard at the dock', f: 0 };
    const el = S.time - tr.dep, FLY = Math.min(Exped.C.FLY, tr.dur * 0.25), left = Math.max(0, tr.dep + tr.dur - S.time);
    const vy = Exped.DEST[tr.dest].voy;   // (update 3: a far-sky voyage)
    return { txt: el < FLY ? 'sailing out' : left < FLY ? 'drifting home!' : `${vy ? 'past the clouds' : 'exploring'} &middot; back in ${fmtT(left)}`, f: Math.min(1, el / tr.dur), left };
  }
  function openExp(view) {
    closePlot(); closeEvents(); closeNeed(); closeCraft(); expView = view || { v: 'home' }; $('expCard').hidden = false; renderExp(true);
  }
  function closeExp() { expView = null; $('expCard').hidden = true; }
  function renderExp(force) {
    if (!expView) return;
    const sig = J(expView) + S.level + Math.floor(S.res.food) + J(S.exp.trips.map(t => [t.id, t.dep])) + S.exp.hauls.length + J(S.placed) + S.inv.decor.length + Math.floor(S.time / 15) + S.pups.length + S.pups.map(p => p.exp ? 1 : 0).join('');
    if (!force && sig === expSig) return; expSig = sig;
    const bd = Exped.board(S), body = $('ecBody');
    if (expView.v === 'plan') { renderPlan(body); return; }
    $('ecTitle').innerHTML = `${IC.board} The skyboat dock`;
    let h = '';
    if (bd === null) {
      const queued = Object.values(S.plots).some(e => e.type === 'board');
      h += `<p class="lockd">${IC.lock} ${S.level < Exped.C.BOARD_LV ? `The floating isles drift close when the Elder Tree reaches <b>level ${Exped.C.BOARD_LV}</b> (now ${S.level}). Keep it glowing!` : queued ? 'The pups are building the <b>Skyboat dock</b>. The first crew sails when it is done.' : 'Build a <b>Skyboat dock</b> on a free plot (tap <b>Build</b>), then send a crew to the floating isles.'}</p>`;
      if (S.level >= Exped.C.BOARD_LV && !queued) h += `<button class="go" data-x="findplot">${IC.home} Pick a plot for the dock</button>`;
    }
    if (S.exp.hauls.length) {
      h += `<h4>${IC.gift} Sacks of treasures</h4>`;
      S.exp.hauls.forEach((x, k) => { h += `<div class="qi hl" data-x="haul" data-k="${k}">${IC.board}<div><b>The ${Exped.DEST[x.dest].name} crew is home!</b><small>${x.names.map(esc).join(', ')}</small></div><button class="go">Open</button></div>`; });
    }
    if (S.exp.trips.length) {
      h += `<h4>${IC.isle} Out in the sky <span class="cnt">${S.exp.trips.length}/${Exped.maxTrips(S)}</span></h4>`;
      for (const tr of S.exp.trips) {
        const st = tripState(tr), d = Exped.DEST[tr.dest];
        h += `<div class="qi${d.voy ? ' voyq' : ''}" data-x="look" data-id="${tr.id}">${IC.board}<div><b>${d.name}</b> <small class="inl">${d.voy ? 'far-sky voyage &middot; ' + d.voy.h + ' h' : Exped.TIERS[tr.tier].label}</small><div class="bar"><i style="width:${(st.f * 100).toFixed(1)}%"></i></div><small>${tr.team.map(i => `<span class="dot" style="background:${S.pups[i].collar}"></span>${esc(S.pups[i].name)}`).join(' ')} &middot; ${st.txt}</small></div>${tr.dep < 0 ? `<button class="ghost" data-x="recall" data-id="${tr.id}">Stay home</button>` : ''}</div>`;
      }
    }
    h += `<h4>${IC.isle} Floating isles</h4>`;
    for (const d of Exped.DEST) {
      if (d.voy) continue;   // (update 3: the far-sky voyages have their own list below)
      const ok = Exped.unlocked(S, d);
      const finds = d.locked ? '' : Object.keys(d.res).map(k => IC[k]).join('') + (d.roll.crystal >= 2 ? IC.crystal : '') + (d.roll.seeds >= 2 ? IC.seed : '') + (d.roll.decor >= 2 ? IC.decor : '') + (d.rare ? IC.star : '');
      h += `<div class="bo dest${ok ? '' : ' off'}" data-x="${ok ? 'plan' : 'peek'}" data-d="${d.i}">${IC.isle}<div class="bi"><b>${d.name}</b><small>${d.blurb}</small>${ok ? `<div class="cs">${finds}</div>` : ''}</div>${ok ? `<button class="go"${bd === null ? ' disabled' : ''}>Plan</button>` : `<span class="why">${IC.lock}${d.locked ? 'Far sky, soon' : `Tree Lv ${d.lv}`}</span>`}</div>`;
    }
    h += voyListHtml(bd);   // update 3: far-sky voyages
    // decorations: what you own (not placed) + what's out on the island
    const own = {}; for (const id of S.inv.decor) own[id] = (own[id] || 0) + 1;
    const ids = Object.keys(own);
    h += `<h4>${IC.decor} Treasures <small class="inl">${S.placed.length} on the island</small><button class="go sm" data-x="craft" style="margin-left:auto">Craft</button></h4>`;
    if (!ids.length) h += `<div class="qe">Skyboat crews bring home wisp trees, rune boulders, glow shrooms, fairy rings and crystal pillars to set anywhere on your island.</div>`;
    else h += `<p class="sub small">Set one anywhere on open ground. Tap one on the island to move, turn or pack it away.</p>`;
    for (const id of ids) {
      const free = Exped.ownedFree(S, id), placed = S.placed.filter(x => x.id === id);
      h += `<div class="dec">${IC.decor}<b>${decorName(id)}</b><small>${placed.length} placed${free ? ` &middot; ${free} in the shed` : ''}</small>${free > 0 ? `<button class="go sm" data-x="place" data-id="${id}">Place</button>` : ''}${placed.length ? `<button class="ghost sm" data-x="unplace" data-k="${placed[placed.length - 1].k}">Pack away</button>` : ''}</div>`;
    }
    h += `<p class="sub small">Every pup always comes home. A quiet sky only means a smaller sack. A crew away does no island work but packs its own berries.</p>`;
    body.innerHTML = h;
  }
  function renderPlan(body) {
    const pv = expView, d = Exped.DEST[pv.dest], T = Exped.TIERS[pv.tier];
    if (d.voy) { renderVoyPlan(body, pv, d); return; }   // update 3
    $('ecTitle').innerHTML = `${IC.isle} ${d.name}`;
    let h = `<p class="sub">${d.blurb} Pick a crew of 1-${Exped.maxTeam(S)} pups: a pup who loves a job finds more of its kind.</p><div class="tiers">`;
    Exped.TIERS.forEach((t, k) => { if (t.voy) return; h += `<button data-x="tier" data-k="${k}" class="${k === pv.tier ? 'on' : ''}">${IC.clock}${t.label}<small>${IC.food}${t.food}/pup</small></button>`; });
    h += `</div><div class="team">`;
    S.pups.forEach((p, i) => {
      const on = pv.team.includes(i), bz = Exped.busy(p), w = Exped.LIKE[p.like], good = w && (!['wood', 'stone', 'food'].includes(w) || d.res[w]);
      h += `<button class="tp${on ? ' on' : ''}${bz ? ' busy' : ''}" data-x="pick" data-i="${i}"${bz ? ' disabled' : ''}><span class="dot" style="background:${p.collar}"></span><b>${esc(p.name)}</b><span class="xl">Explorer ${expLv(p)}</span><small>${bz ? (p.exp ? 'away on a skyboat' : 'just arriving') : `loves ${IC[p.like] || ''}${good ? ` <i class="bon">${Exped.LIKE_TXT[w]}</i>` : ''}`}</small>${on ? `<em>${pv.team.indexOf(i) + 1}</em>` : ''}</button>`;
    });
    h += `</div>`;
    const c = Exped.canSend(S, nav, pv.dest, pv.tier, pv.team), est = pv.team.length ? Exped.estimate(S, pv.dest, pv.tier, pv.team) : null;
    if (est) h += `<div class="est"><b>Likely treasures</b> ${Object.keys(est.res).filter(k => est.res[k]).map(k => `<span class="gl">${IC[k]}~${est.res[k]}</span>`).join(' ')} <span class="gl">${IC.crystal}~${est.crystal}+</span> <span class="gl">${IC.gift}${est.rolls} bonus finds</span> <span class="gl">${IC.star}${Math.max(1, Math.round(est.rare * 100))}% rare</span><br><small>Packed berries ${IC.food}${T.food * pv.team.length} &middot; home in ${T.label} (even while you're away) &middot; +${T.xp} explorer xp each</small></div>`;
    h += `<div class="pf"><button class="ghost" data-x="back">&#9664; Isles</button><button class="big${c.ok ? ' pulse' : ''}" data-x="send"${c.ok ? '' : ' disabled'}>${IC.board} Set sail!</button></div>${c.ok ? '' : `<p class="why2">${c.why}</p>`}`;
    body.innerHTML = h;
  }
  function sendTrip(dest, tier, team) {
    const tr = Exped.send(S, nav, dest, tier, team); if (!tr) return null;
    const d = Exped.DEST[dest]; save(); syncPups(); refreshRoster(true);
    toast(`${IC.board} ${team.map(i => esc(S.pups[i].name)).join(', ')} ${team.length > 1 ? 'sail' : 'sails'} for <b>${d.name}</b>!`, 3600);
    closeExp(); dockCam(dest);
    return tr;
  }
  // camera: frame the dock with the chosen isle behind it (departure shot)
  function dockCam(dest) {
    const f = expFx.dockFrame(S); if (!f) return;
    const dk = expFx.view.dock || new THREE.Vector3(f.door[0], f.door[1], f.door[2]), I = expFx.isle[Exped.DEST[dest].id];
    const toI = I.land.clone().sub(dk).setY(0).normalize();
    const k = W() < H() ? 1.4 : 1, tgt = dk.clone().add(toI.clone().multiplyScalar(14)).add(new THREE.Vector3(0, 6, 0));
    if (!document.body.classList.contains('phone')) tgt.add(new THREE.Vector3(toI.z, 0, -toI.x).multiplyScalar(16));   // PC: the side panel covers the left, keep the dock right of centre
    const eye = dk.clone().sub(toI.clone().multiplyScalar(48 * k)).add(new THREE.Vector3(0, 52 * k, 0)).add(new THREE.Vector3(-toI.z, 0, toI.x).multiplyScalar(30 * k));
    follow = -1; pups.select(-1); flyTo(eye, tgt, 1.4); sentAt = performance.now();
  }
  // lift-off shortly after the player sent a team: ride behind the boat for a few seconds (any drag ends it)
  let sentAt = -1e9, boatCam = null;
  function startBoatCam(tripId) { if (performance.now() - sentAt > 180000) return; boatCam = { id: tripId, t: 0 }; tween = null; follow = -1; }
  function boatCamTick(dt) {
    const v = expFx.view.trips.find(x => x.trip.id === boatCam.id); boatCam.t += dt;
    if (!v || boatCam.t > 11) { boatCam = null; return; }
    const b = v.boat, fwd = new THREE.Vector3(Math.sin(b.rotation.y), 0, Math.cos(b.rotation.y)), k = W() < H() ? 1.4 : 1;
    const tgt = b.position.clone().add(fwd.clone().multiplyScalar(30)).add(new THREE.Vector3(0, 4, 0));
    const eye = b.position.clone().sub(fwd.multiplyScalar(46 * k)).add(new THREE.Vector3(0, 20 * k, 0)), a = Math.min(1, dt * (boatCam.t < 1.2 ? 2.5 : 5));
    controls.target.lerp(tgt, a); camera.position.lerp(eye, a);
  }
  // ---- Round 3 update 2: photo mode. Hides the HUD; the camera orbits / tilts freely; time-of-day + season PREVIEW (view only:
  // the sky + season tint read PHOTO, the sim's clock and season never change); a frame; Save image = a PNG download (no upload).
  let PHOTO = null;   // { h: preview hour | null = now, sea: season index | null = now, frame: 'none' | 'soft' | 'card' }
  const PH_SEA = ['Now', 'Spring', 'Summer', 'Autumn', 'Winter'], PH_FRAME = [['none', 'No frame'], ['soft', 'Soft glow'], ['card', 'Postcard']];
  function openPhoto() {
    if (!booted || PHOTO) return; closeExp(); closePlot(); closeEvents(); closeNeed(); closeCraft(); closeWard(); closeSay(); closeDecMenu(); if (soc) soc.close(); endPlace();
    follow = -1; pups.select(-1); tween = null; boatCam = null;
    PHOTO = { h: null, sea: null, frame: 'soft' }; document.body.classList.add('photo'); $('photoBar').hidden = false; renderPhoto(); snd.sfx('open');
  }
  function closePhoto() { if (!PHOTO) return; PHOTO = null; document.body.classList.remove('photo'); $('photoBar').hidden = true; $('photoFrame').className = ''; snd.sfx('close'); }
  function renderPhoto() {
    if (!PHOTO) return; const h = PHOTO.h === null ? Sim.dayH(S) : PHOTO.h;
    $('phTime').value = h.toFixed(2); $('phTimeL').textContent = PHOTO.h === null ? 'Now' : String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0');
    $('phSea').innerHTML = PH_SEA.map((n, i) => `<button data-sea="${i - 1}" class="${(PHOTO.sea === null ? -1 : PHOTO.sea) === i - 1 ? 'on' : ''}">${n}</button>`).join('');
    $('phFrame').innerHTML = PH_FRAME.map(([k, n]) => `<button data-fr="${k}" class="${PHOTO.frame === k ? 'on' : ''}">${n}</button>`).join('');
    $('photoFrame').className = PHOTO.frame === 'none' ? '' : 'fr-' + PHOTO.frame;
    $('phCap').textContent = photoCaption();
  }
  function photoCaption() {
    const so = VISIT ? null : S.social, nm = VISIT && soc && soc.V ? (soc.V.name || '') : so && so.island ? so.island : 'My Elderglow isle';
    const d = new Date(); return `${nm} · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  function savePhoto() {
    renderer.render(scene, camera);   // the drawing buffer is only valid right after a render (no preserveDrawingBuffer)
    const src = renderer.domElement, w = src.width, h = src.height, c = document.createElement('canvas'), g = c.getContext('2d'), fr = PHOTO ? PHOTO.frame : 'none';
    if (fr === 'card') {
      const b = Math.round(Math.min(w, h) * 0.04), band = Math.round(h * 0.1); c.width = w + 2 * b; c.height = h + b + band;
      g.fillStyle = '#fffaf0'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, b, b);
      g.fillStyle = '#3e3860'; g.font = `${Math.round(band * 0.38)}px "Lilita One", Fredoka, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(photoCaption(), c.width / 2, h + b + band / 2);
    } else {
      c.width = w; c.height = h; g.drawImage(src, 0, 0);
      if (fr === 'soft') { const r = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6); r.addColorStop(0, 'rgba(42,36,66,0)'); r.addColorStop(1, 'rgba(42,36,66,0.45)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }
    }
    const d = new Date(), name = `elderglow-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.png`;
    c.toBlob(bl => { if (!bl) return; const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
    snd.sfx('sting_gift'); const fl = $('photoFlash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    return { w: c.width, h: c.height, name };
  }
  // ---- Round 3 update 2: the Craft card (src/catalog.js). Pick a set, see the cost + what a piece does (or "pure decoration"),
  // Craft = paid at once, into the shed; Place starts place mode; Undo = a crafted one still in the shed comes back for its cost.
  let craftSet = 'path', craftOpen = false;
  const COST_IC = { wood: 'wood', stone: 'stone', food: 'food', crystal: 'crystal', sap: 'sap', seeds: 'seed' };
  const CRAFT_WHY = { level: lv => `Tree level ${lv}`, rare: () => 'Found, never made' };
  function openCraft(set) { if (VISIT) return; closeExp(); closePlot(); closeEvents(); closeNeed(); if (set) craftSet = set; craftOpen = true; $('craftCard').hidden = false; renderCraft(); snd.sfx('open'); }
  function closeCraft() { if (!craftOpen) return; craftOpen = false; $('craftCard').hidden = true; }
  function renderCraft() {
    if (!craftOpen) return;
    $('crTitle').innerHTML = `${IC.decor} The crafting nook`;
    $('crSets').innerHTML = Catalog.SETS.filter(t => Catalog.LIST.some(e => e.set === t.id)).map(t => `<button data-set="${t.id}" class="${t.id === craftSet ? 'on' : ''}">${t.name}</button>`).join('') +
      `<button data-set="land" class="${craftSet === 'land' ? 'on' : ''}">Shape the land</button>` +   // creative build part 2
      `<button data-set="homes" class="${craftSet === 'homes' ? 'on' : ''}">Place a home</button>` +   // (buildings: a home on open land)
      `<button data-set="up" class="${craftSet === 'up' ? 'on' : ''}">Upgrades + offering</button>`;   // pacing pass
    if (craftSet === 'up') { $('crBody').innerHTML = upCraftHtml(); return; }
    if (craftSet === 'land') { $('crBody').innerHTML = landCraftHtml(); return; }
    if (craftSet === 'homes') { $('crBody').innerHTML = homesCraftHtml(); return; }
    let h = '';
    for (const e of Catalog.LIST.filter(x => x.set === craftSet)) {
      const shed = Catalog.inShed(S, e.id), out = S.placed.filter(x => x.id === e.id).length, F = e.fx ? Catalog.FX[e.fx] : null, c = Catalog.canCraft(S, e.id);
      const lock = e.from === 'craft' && c.why === 'level';
      h += `<div class="cri${lock ? ' lock' : ''}"><div class="crh">${IC[F ? F.ic : 'decor'] || IC.decor}<b>${esc(e.name)}</b><small>${out ? out + ' out' : ''}${out && shed ? ' &middot; ' : ''}${shed ? shed + ' in the shed' : ''}</small></div>`;
      if (e.from === 'craft') h += `<div class="crc">${Object.keys(e.cost).map(k => `<span class="${c.need && c.need[k] ? 'short' : ''}">${IC[COST_IC[k]] || ''}${e.cost[k]}</span>`).join('')}</div>`;
      h += F ? `<div class="crf">${IC.star}${esc(F.txt)}</div>` : `<div class="crf pure">Just for beauty</div>`;
      h += `<div class="crb">${e.from !== 'craft' ? `<span class="why">${e.from === 'gift' ? 'From a gift basket' : e.from === 'voyage' ? 'Found on far-sky voyages' : e.from === 'ring' ? 'An Elder ring gift' : 'Found by skyboat crews'}</span>` : !c.ok ? `<span class="why">${c.why === 'cost' ? 'A little more needed' : CRAFT_WHY[c.why] ? CRAFT_WHY[c.why](e.lv) : ''}</span>` : ''}`;
      if (S.inv.craft[e.id] > 0 && shed > 0) h += `<button class="ghost sm" data-x="undo" data-id="${e.id}" title="Take it apart: the full cost comes back">Undo</button>`;
      if (shed > 0) h += `<button class="ghost sm" data-x="place" data-id="${e.id}">Place</button>`;
      if (e.from === 'craft') h += `<button class="go sm" data-x="craft" data-id="${e.id}"${c.ok ? '' : ' disabled'}>Craft</button>`;
      h += `</div></div>`;
    }
    $('crBody').innerHTML = h;
  }
  function craftAct(x, id) {
    if (x === 'craft') { const r = Catalog.craft(S, id); if (!r.ok) return; save(); refreshTree(); snd.sfx('built'); toast(`${IC.decor} ${esc(decorName(id))} is ready, waiting in the shed`, 2000); }
    else if (x === 'undo') { if (!Catalog.uncraft(S, id)) return; save(); refreshTree(); snd.sfx('close'); toast(`${esc(decorName(id))} taken apart: everything is back`, 1800); }
    else if (x === 'place') { closeCraft(); startPlace(id); return; }
    else if (x === 'land') { closeCraft(); startLand(id); return; }
    else if (x === 'home') { const k = Homes.KINDS.find(k => k.k === id); if (k) { closeCraft(); startHome(k.piece); } return; }
    else if (x === 'up') { const r = Pacing.buy(S, id); if (!r.ok) return; const u = Pacing.UP[id]; save(); refreshTree(); snd.sfx('built'); toast(`${IC[u.ic] || IC.build} <b>${u.name}</b> level ${r.n}: ${u.txt(r.n)}`, 3200); }
    else if (x === 'offer') { const r = Pacing.offer(S); if (!r.ok) return; save(); refreshTree(); snd.sfx('sting_gift'); toast(`${IC.sprout} The Elder Tree drinks in your offering: it grows a little faster for the next 8 hours`, 3600); }
    renderCraft();
  }
  // pacing pass: the Craft card's "Upgrades + offering" tab (src/pacing.js): the growth pace and why, the tree offering, the
  // five island upgrades (level pips, the next price, what the next level does)
  function upCraftHtml() {
    const P = Pacing, w = P.words(S), cst = (c, need) => Object.keys(c).map(k => `<span class="${need && need[k] ? 'short' : ''}">${IC[COST_IC[k]] || ''}${fmtN(c[k])}</span>`).join('');
    let h = `<p class="sub pacebox">${IC.sprout} The Elder Tree is growing <b>${w.x}&times;</b>${w.why.length ? ': ' + esc(w.why.join(', ')) : ''}${w.low.length ? ' &middot; ' + esc(w.low.join(', ')) : ''}. Needs met, every job filled and homes built speed it up (up to 1.3&times;).</p>`;
    const oc = P.canOffer(S), oCost = P.C.OFFER.cost(Math.max(S.level, P.C.OFFER.LV));
    const oWhy = oc.ok ? '' : oc.why === 'level' ? `Tree level ${P.C.OFFER.LV}` : oc.why === 'on' ? `Glowing: ${fmtT(oc.left)} left` : oc.why === 'rest' ? `Again in ${fmtT(oc.left)}` : 'A little more needed';
    h += `<div class="cri offer${oc.why === 'level' ? ' lock' : ''}"><div class="crh">${IC.sap}<b>Tree offering</b><small>${S.pace && S.pace.offN ? S.pace.offN + ' given' : ''}</small></div><div class="crc">${cst(oCost, oc.need)}</div>`;
    h += `<div class="crf">${IC.star}Sap + berries at the roots: the tree grows +${Math.round(P.C.OFFER.K * 100)}% for 8 hours. One a day; it speeds the tree, it never skips a level.</div>`;
    h += `<div class="crb"><span class="why">${oWhy}</span><button class="go sm" data-x="offer" data-id="offer"${oc.ok ? '' : ' disabled'}>Offer</button></div></div>`;
    for (const id of P.ORDER) {
      const u = P.UP[id], n = P.lvOf(S, id), c = P.canUp(S, id), lock = c.why === 'level' || c.why === 'asleep';
      h += `<div class="cri${lock ? ' lock' : ''}"><div class="crh">${IC[u.ic] || IC.build}<b>${u.name}</b><small>level ${n} of ${u.max}</small></div><div class="upk">${[...Array(u.max)].map((_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</div>`;
      if (n < u.max) h += `<div class="crc">${cst(P.costOf(id, n), c.need)}</div>`;
      h += `<div class="crf">${IC.star}${n ? esc(u.txt(n)) + (n < u.max ? ` &middot; next: ${esc(u.next)}` : '') : 'Next: ' + esc(u.next)}</div>`;
      const why = c.ok ? '' : c.why === 'max' ? 'All done!' : c.why === 'level' ? `Tree level ${u.lv}` : c.why === 'asleep' ? 'Wakes with Nourish' : 'A little more needed';
      h += `<div class="crb"><span class="why">${why}</span>${n < u.max ? `<button class="go sm" data-x="up" data-id="${id}"${c.ok ? '' : ' disabled'}>Upgrade</button>` : ''}</div></div>`;
    }
    return h + `<p class="sub small">With "Let the pups plan the village" on, the pups now and then put a big spare pile into the cheapest upgrade themselves.</p>`;
  }
  // the Craft card's "Place a home" tab: a cottage / big cottage / treehouse anywhere on open land (its door within 25 m of a
  // path); it goes down as a blueprint the builders build like any plot (the usual cost, paid when they start)
  function homesCraftHtml() {
    const n = (S.free || []).length; let h = `<p class="sub">Set a home anywhere on open land. Its door wants a path within 25 m; the builders raise it like any plot. ${n} of ${Homes.C.MAX} placed.</p>`;
    for (const k of Homes.KINDS) {
      const q = { piece: k.piece }, cost = Sim.costOf('home', q), lock = k.lv && S.level < k.lv, full = n >= Homes.C.MAX;
      h += `<div class="cri${lock ? ' lock' : ''}"><div class="crh">${IC.home}<b>${k.name}</b><small>${IC.bed} +${Sim.bedsFor(q)} beds</small></div><div class="crc">${Object.keys(cost).map(c => `<span>${IC[COST_IC[c]] || ''}${cost[c]}</span>`).join('')}</div>`;
      h += `<div class="crf">${IC.star}Paid when the builders start; colours, roof + turn from its plot card</div><div class="crb">${lock ? `<span class="why">Tree level ${k.lv}</span>` : full ? '<span class="why">The island is full of homes</span>' : ''}<button class="go sm" data-x="home" data-id="${k.k}"${lock || full ? ' disabled' : ''}>Place</button></div></div>`;
    }
    return h;
  }
  // haul reveal: items pop in one by one; closing it marks the haul as opened
  let haulK = -1;
  function openHaul(k) {
    const h = S.exp.hauls[k]; if (!h) return; haulK = k; closeExp();
    const d = Exped.DEST[h.dest], items = haulItems(h);
    $('hTitle').innerHTML = d.voy ? `Home from the far sky: ${d.name}!` : `The skyboat drifts home from ${d.name}!`;
    $('hTeam').innerHTML = h.team.map((i, m) => S.pups[i] ? `<span class="tm2"><span class="dot" style="background:${S.pups[i].collar}"></span>${esc(S.pups[i].name)} <small>Explorer ${expLv(S.pups[i])}</small></span>` : '').join('') + (d.voy ? `<small class="trip voyw">${esc(d.voy.back)}${h.first ? ' <b>A first visit: they brought back something of the isle\'s own.</b>' : ''}</small>` : `<small class="trip">a ${Exped.TIERS[h.tier].label} skyboat trip</small>`);
    $('hItems').innerHTML = items.map((x, m) => `<div class="hi${x.rare ? ' rare' : ''}" style="animation-delay:${(0.45 + m * 0.32).toFixed(2)}s">${x.ic}<b>${x.txt}</b><small>${x.sub}</small></div>`).join('');
    $('hSack').classList.remove('open'); void $('hSack').offsetWidth; $('hSack').classList.add('open');
    $('hDecor').hidden = !h.decor.length; $('hPup').hidden = !(h.pup && h.pupIdx >= 0); $('hWard').hidden = !h.outfit;
    $('haul').hidden = false;
    snd.sfx('sting_haul'); items.forEach((x, m) => snd.sfx('pop', { delay: 0.5 + m * 0.32, rate: 1 + m * 0.07, gain: x.rare ? 1 : 0.8, force: true }));   // the items pop in (CSS delays)
  }
  function closeHaul() { if (haulK >= 0) { S.exp.hauls.splice(haulK, 1); haulK = -1; save(); } $('haul').hidden = true; refreshExpBtn(); }
  function refreshExpBtn() {
    const b = $('expBtn'); b.classList.toggle('ready', S.exp.hauls.length > 0); b.dataset.n = S.exp.trips.length ? S.exp.trips.length : '';
    b.classList.toggle('out', S.exp.trips.length > 0);
  }
  // ---- free decor (2026-11-01): place mode. Pick a decoration from the shed (Trips card) or tap one on the island (Move).
  // A see-through ghost follows the pointer over the ground: green = it fits, red = not here (the bar says why). Q / E (or the
  // bar's turn buttons) rotate it 15 degrees; a mouse click or "Place here" puts it down. Phone: a tap moves the ghost there,
  // dragging the ghost slides it, dragging elsewhere moves the camera. The rules are the sim's own (Decor.check: water,
  // bridges, paths, doors, buildings, trees + rocks, other decor, the trunk, job spots, the pups' ways), plus lane A's props.
  const WHY = { far: 'Not yet: more land opens as the tree grows', land: 'Only on open ground', tree: 'A little too close to the Elder Tree', door: 'The way to the tree door stays open',
    water: 'Not in the water', bridge: 'Not on a bridge', path: 'Not on a path', building: 'A little too close to a building', nature: 'A tree or rock is in the way',
    decor: 'Something else is in the way', job: 'The pups work right here', blocked: 'That would block the pups\' way to a job', full: `The island already holds ${Decor.C.MAX} treasures`, none: 'None left in the shed' };
  let PM = null;   // place mode: { id, k (moving: its handle, else null), x, z, r, ok, why, done (full check ran), t (last change), drag }
  const pmRay = new THREE.Raycaster();
  function pickGround(mx, my) {   // the ground point under a screen point (the same march as walker.js), or null off the map
    pmRay.setFromCamera({ x: mx / W() * 2 - 1, y: -(my / H()) * 2 + 1 }, camera);
    const o = pmRay.ray.origin, d = pmRay.ray.direction, at = t => [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
    const above = t => { const p = at(t), g = ground.raw(p[0], p[2]); return g === null ? null : p[1] - g; };
    let prev = 0, t = 0, step = 2;
    for (let i = 0; i < 900 && t < 2500; i++) {
      t += step; step = Math.min(8, step * 1.02); const h = above(t);
      if (h !== null && h <= 0) { let lo = prev, hi = t; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2, hm = above(m); if (hm !== null && hm <= 0) hi = m; else lo = m; } const p = at(hi); p[1] = ground.raw(p[0], p[2]); return p; }
      prev = t;
    }
    return null;
  }
  function decorCheck(id, x, z, r, k, full) {   // the sim's rules + the view's own props (benches, curiosities, ...)
    if (ground.raw(x, z) === null) return { ok: false, why: 'land' };
    const c = Decor.check(S, nav, id, x, z, r, k, { reach: !!full }); if (!c.ok) return c;
    return wfx && wfx.propHit && wfx.propHit(x, z, Decor.radOf(id) * 0.85) ? { ok: false, why: 'decor' } : c;
  }
  // (buildings: a home on open land uses the same place mode: PM.home = {piece, pid (moving) | null}, the rules are Homes.check)
  function homeCheck(piece, x, z, r, pid, full) {
    if (ground.raw(x, z) === null) return { ok: false, why: 'land' };
    const c = Homes.check(S, nav, { pid: pid !== null && pid !== undefined ? pid : Homes.FREE0 + Homes.nextId(S), piece, x, z, ry: r, s: 1, free: true }, { reach: !!full }); if (!c.ok) return c;
    const f = Nav.FOOT[piece]; return wfx && wfx.propHit && wfx.propHit(x + f[0], z + f[1], Math.max(f[2], f[3]) * 0.85) ? { ok: false, why: 'decor' } : c;
  }
  function pmShow() {
    $('pbWhy').textContent = PM.ok ? (PM.done ? (PHONE ? 'Looks lovely here!' : 'Looks lovely here! Click to set it down') : 'Having a look...') : (PM.home ? HOME_WHY : WHY)[PM.why] || 'Not here';
    pmFx();
    $('placeBar').classList.toggle('bad', !PM.ok); $('pbOk').disabled = !PM.ok;
  }
  // Round 3 update 2: what this piece would do right here (src/catalog.js preview) + a soft ring of its reach round the ghost
  let pmFxKey = '';
  const FX_HELP = { light: 'by a path: lamplighters bring more light', garden: 'by a garden: the beds grow more', bloom: 'by a garden: the beds grow a little more', rest: 'a cozy seat: every pup a bit happier',
    spirit: 'a happy spot: Song rises a little', protect: 'by a blight spot: it creeps slower there', gather: 'tidy yard: gatherers bring more' };
  const FX_NEED = { light: 'set it within 8 m of a path', garden: 'set it near a berry patch or a root bed', bloom: 'set it near a berry patch or a root bed', rest: 'set it near the plaza or a home',
    spirit: 'set it near the plaza or the stage', protect: 'set it near where blight grows', gather: 'set it near a woodshed, stone yard or berry patch' };
  function pmFx() {
    if (PM.home) { const el = $('pbFx'); el.hidden = false; el.className = PM.ok ? '' : 'none'; el.innerHTML = `${IC.bed} +${Sim.bedsFor({ piece: PM.home.piece })} beds &middot; ${PM.home.pid !== null ? 'it moves here just as it is' : 'plans the builders raise here'}`; if (expFx.ring) expFx.ring(null); return; }
    const e = Catalog.BY[PM.id], F = e && e.fx ? Catalog.FX[e.fx] : null, el = $('pbFx');
    if (!F) { el.hidden = false; el.className = 'none'; el.textContent = 'Just for beauty'; if (expFx.ring) expFx.ring(null); return; }
    const key = PM.id + PM.x + ',' + PM.z + PM.ok; if (key === pmFxKey) return; pmFxKey = key;
    const pv = PM.ok ? Catalog.preview(S, nav, PM.id, PM.x, PM.z) : null, on = !!(pv && pv.helps);
    el.hidden = false; el.className = on ? '' : 'none';
    el.innerHTML = `${IC[F.ic] || IC.star} ${on ? FX_HELP[e.fx] : 'Just for beauty here: ' + FX_NEED[e.fx]}`;
    if (expFx.ring) expFx.ring([PM.x, PM.z], F.R, on);
  }
  function pmCheck(full) { if (!PM) return; const c = PM.home ? homeCheck(PM.home.piece, PM.x, PM.z, PM.r, PM.home.pid, full) : decorCheck(PM.id, PM.x, PM.z, PM.r, PM.k, full); PM.ok = c.ok; PM.why = c.why; PM.done = !!full || !c.ok; pmShow(); }
  // place-mode prefs (a UI pref, NOT the save; its own key so the calm view's pref writes never drop it): grid snap on / off,
  // the last turn used ("Same turn" copies it, so rows line up). Snap on = a 1 m grid + 15 degree turns (Shift: 45);
  // snap off = free: any spot, 3 degree turns (hold Q / E or a turn button to keep turning)
  const DPREF_K = 'schiffy-elderglow.ui.decor', TAU = Math.PI * 2;
  const DPREF = (() => { try { const o = JSON.parse(localStorage.getItem(DPREF_K) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } })();
  const saveDPref = () => { try { localStorage.setItem(DPREF_K, JSON.stringify(DPREF)); } catch (e) {} };
  const SNAP = { grid: 1, step: Math.PI / 12, big: Math.PI / 4, free: Math.PI / 60, magnet: 0.5, guideR: 30 };
  const wrapR = r => ((r % TAU) + TAU) % TAU;
  // alignment guides: a placed piece in line (same x or same z, within SNAP.magnet m: the ghost clicks onto the line) and a
  // path the ghost sits along (a line parallel to it through the ghost); returns the guide lines [x0, z0, x1, z1, kind]
  function pmGuides() {
    const L = [], x = PM.x, z = PM.z;
    let bx = null, bz = null;
    for (const o of S.placed) {
      if (o.k === PM.k || Math.hypot(o.x - x, o.z - z) > SNAP.guideR) continue;
      if (Math.abs(o.x - x) <= SNAP.magnet && (!bx || Math.abs(o.z - z) < Math.abs(bx.z - z))) bx = o;
      if (Math.abs(o.z - z) <= SNAP.magnet && (!bz || Math.abs(o.x - x) < Math.abs(bz.x - x))) bz = o;
    }
    if (bx) { PM.x = bx.x; L.push([bx.x, bx.z, bx.x, z, 'decor']); }
    if (bz) { PM.z = bz.z; L.push([bz.x, bz.z, x, bz.z, 'decor']); }
    const rn = nav.roadNear(PM.x, PM.z, Decor.C.ROAD + Decor.radOf(PM.id) + 3);
    if (rn.a) { const dx = rn.b[0] - rn.a[0], dz = rn.b[2] - rn.a[2], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l; L.push([PM.x - ux * 12, PM.z - uz * 12, PM.x + ux * 12, PM.z + uz * 12, 'path']); }
    return L;
  }
  function pmMove(x, z) {
    if (!PM) return;
    if (DPREF.snap) { x = Math.round(x / SNAP.grid) * SNAP.grid; z = Math.round(z / SNAP.grid) * SNAP.grid; }
    const nx = Math.round(x * 10) / 10, nz = Math.round(z * 10) / 10; if (nx === PM.rx && nz === PM.rz) return;
    PM.rx = nx; PM.rz = nz; PM.x = nx; PM.z = nz; PM.guides = pmGuides(); PM.t = performance.now(); pmCheck(false);
  }
  function pmSetR(r) { PM.r = Math.round(wrapR(r) * 1000) / 1000; PM.t = performance.now(); pmCheck(false); }
  function pmTurn(d, big) {
    if (!PM) return; const st = DPREF.snap ? (big ? SNAP.big : SNAP.step) : SNAP.free;
    pmSetR(DPREF.snap ? Math.round(PM.r / st) * st + d * st : PM.r + d * st); snd.sfx('tap');
  }
  function pmSnap(v) { DPREF.snap = v === undefined ? !DPREF.snap : !!v; saveDPref(); $('pbSnap').classList.toggle('on', !!DPREF.snap); if (PM) { const x = PM.rx, z = PM.rz; PM.rx = NaN; pmMove(x, z); } snd.sfx('tap'); }
  function pmCopy() { if (!PM || typeof DPREF.lastR !== 'number') return; pmSetR(DPREF.lastR); snd.sfx('tap'); }  function startPlace(id, k) {
    if (VISIT || !booted) return false;
    const o = k !== undefined && k !== null ? S.placed.find(y => y.k === k) : null;
    if ((k !== undefined && k !== null && !o) || (!o && Exped.ownedFree(S, id) < 1)) return false;
    closeExp(); closePlot(); closeEvents(); closeNeed(); closeDecMenu(); closeCraft(); if (soc) soc.close(); endLand();
    follow = -1; pups.select(-1); refreshRoster(true);
    PM = { id: o ? o.id : id, k: o ? o.k : null, x: NaN, z: NaN, rx: NaN, rz: NaN, r: o ? o.r : 0, ok: false, why: 'land', done: false, t: performance.now(), drag: false, guides: [] };
    $('pbSnap').classList.toggle('on', !!DPREF.snap); $('pbCopy').disabled = typeof DPREF.lastR !== 'number';
    expFx.hideK = PM.k;
    const g = o ? [o.x, 0, o.z] : pickGround(W() / 2, H() * 0.55);
    $('pbName').innerHTML = `${IC.decor} ${o ? 'Move' : 'Place'} <b>${esc(decorName(PM.id))}</b>`;
    $('placeBar').hidden = false; document.body.classList.add('placing'); snd.sfx('open');
    pmMove(g ? g[0] : controls.target.x, g ? g[2] : controls.target.z);
    if (o) { const p = new THREE.Vector3(o.x, ground(o.x, o.z, nav.TP[1]) + 3, o.z), off = camera.position.clone().sub(controls.target); if (off.length() > 120) off.setLength(120); flyTo(p.clone().add(off), p, 0.8); }
    return true;
  }
  function startHome(piece, pid) {
    if (VISIT || !booted || !Homes.CLASS[piece]) return false;
    const f = pid !== undefined && pid !== null ? Homes.freeOf(S, pid) : null; if (pid !== undefined && pid !== null && !f) return false;
    if (PM) endPlace(); closeExp(); closePlot(); closeEvents(); closeNeed(); closeDecMenu(); closeCraft(); if (soc) soc.close(); endLand();
    follow = -1; pups.select(-1); refreshRoster(true);
    PM = { id: 'home:' + piece, home: { piece, pid: f ? +pid : null }, k: null, x: NaN, z: NaN, rx: NaN, rz: NaN, r: f ? f.r : 0, ok: false, why: 'land', done: false, t: performance.now(), drag: false, guides: [] };
    plots.hidePid = f ? +pid : null;
    $('pbSnap').classList.toggle('on', !!DPREF.snap); $('pbCopy').disabled = true;
    const kd = Homes.KINDS.find(k => Homes.CLASS[k.piece] === Homes.CLASS[piece]);
    const g = f ? [f.x, 0, f.z] : pickGround(W() / 2, H() * 0.55);
    $('pbName').innerHTML = `${IC.home} ${f ? 'Move' : 'Place'} <b>${esc(kd ? kd.name : 'a home')}</b>`;
    $('placeBar').hidden = false; document.body.classList.add('placing'); snd.sfx('open');
    pmMove(g ? g[0] : controls.target.x, g ? g[2] : controls.target.z);
    if (f) { const p = new THREE.Vector3(f.x, ground(f.x, f.z, nav.TP[1]) + 3, f.z), off = camera.position.clone().sub(controls.target); if (off.length() > 140) off.setLength(140); flyTo(p.clone().add(off), p, 0.8); }
    return true;
  }
  function endPlace() { if (!PM) return; if (PM.home) plots.hidePid = null; PM = null; expFx.hideK = null; expFx.ghost(null); expFx.guides(null); if (expFx.ring) expFx.ring(null); $('placeBar').hidden = true; document.body.classList.remove('placing'); controls.enabled = true; }
  function pmConfirm() {
    if (!PM) return false;
    if (!PM.done || !PM.ok) pmCheck(true);
    if (!PM.ok) { snd.sfx('close'); return false; }
    if (PM.home) {   // buildings: a home on open land (a blueprint) or a free home moved
      const res = {}, mv = PM.home.pid !== null, piece = PM.home.piece;
      const pid = mv ? (Homes.move(S, nav, PM.home.pid, PM.x, PM.z, PM.r, res) ? PM.home.pid : -1) : Homes.place(S, nav, piece, PM.x, PM.z, PM.r, res);
      if (pid < 0) { PM.ok = false; PM.why = res.why; PM.done = true; pmShow(); snd.sfx('close'); return false; }
      save(); snd.sfx('built'); syncPups(); refreshBuild(true);
      const builders = S.pups.filter(p => p.job === 'build').length, kd = Homes.KINDS.find(k => Homes.CLASS[k.piece] === Homes.CLASS[piece]);
      toast(`${IC.home} ${mv ? 'Moved!' : `Plans drawn: ${esc(kd ? kd.name : 'a home')} on open land${builders ? '' : ' &middot; a pup needs the Builder job'}`}`, 3000);
      endPlace(); return true;
    }
    const res = {}, id = PM.id, moving = PM.k !== null;
    const done = moving ? Decor.move(S, nav, PM.k, PM.x, PM.z, PM.r, res) : Decor.place(S, nav, id, PM.x, PM.z, PM.r, res) >= 0;
    if (!done) { PM.ok = false; PM.why = res.why; PM.done = true; pmShow(); snd.sfx('close'); return false; }
    DPREF.lastR = PM.r; saveDPref();   // "Same turn" next time
    save(); snd.sfx('built'); syncPups();
    toast(`${IC.decor} ${esc(decorName(id))} ${moving ? 'has a new spot' : 'is in its place'}!${!moving && Exped.ownedFree(S, id) > 0 ? ` ${Exped.ownedFree(S, id)} more in the shed.` : ''}`, 2400);
    endPlace(); return true;
  }
  // tap a placed decoration (not in place mode): a little menu over it: Move / Turn / Pack away
  let DM = null;
  function pickDecor(mx, my) {
    let best = null, bd = PHONE ? 44 : 34;
    for (const x of S.placed) {
      const D = Exped.DECOR[x.id]; if (!D) continue; const y0 = ground(x.x, x.z, nav.TP[1]);
      for (const h of [1, 3, 6]) { const v = new THREE.Vector3(x.x, y0 + h * Math.min(2, D.s), x.z).project(camera); if (v.z > 1) continue; const d = Math.hypot((v.x + 1) / 2 * W() - mx, (1 - v.y) / 2 * H() - my); if (d < bd) { bd = d; best = x.k; } }
    }
    if (best !== null) return best;
    const g = pickGround(mx, my), b = g && nav.decorAt(g[0], g[2]); return b ? b.dk : null;
  }
  function openDecMenu(k) {
    const o = S.placed.find(y => y.k === k); if (!o) return;
    DM = k; $('dmName').textContent = decorName(o.id); $('decMenu').hidden = false; snd.sfx('tap'); placeDecMenu();
  }
  function closeDecMenu() { DM = null; $('decMenu').hidden = true; }
  CardFn.decMenu = closeDecMenu;
  function placeDecMenu() {
    const o = DM !== null && S.placed.find(y => y.k === DM); if (!o) { closeDecMenu(); return; }
    const v = new THREE.Vector3(o.x, ground(o.x, o.z, nav.TP[1]) + 4 * Math.min(2, Exped.DECOR[o.id].s), o.z).project(camera), el = $('decMenu');
    el.style.left = Math.max(8, Math.min(W() - el.offsetWidth - 8, (v.x + 1) / 2 * W() - el.offsetWidth / 2)) + 'px';
    el.style.top = Math.max(8, Math.min(H() - el.offsetHeight - 8, (1 - v.y) / 2 * H() - el.offsetHeight - 14)) + 'px';
  }
  function decMenuAct(a) {
    const k = DM, o = S.placed.find(y => y.k === k); if (!o) { closeDecMenu(); return; }
    if (a === 'move') { closeDecMenu(); startPlace(o.id, k); }
    else if (a === 'turn') {
      // a quarter turn in place (or the next of 8 that fits); never through the rules' back door
      for (let n = 1; n < 8; n++) { const r = (o.r + n * Math.PI / 4) % (Math.PI * 2); if (decorCheck(o.id, o.x, o.z, r, k, true).ok && Decor.move(S, nav, k, o.x, o.z, r)) { DPREF.lastR = o.r; saveDPref(); save(); snd.sfx('pop'); return; } }
      toast(`${IC.decor} No room to turn it here`, 1800);
    } else if (a === 'tour') startTourPick({ t: 'd', r: k });   // piece 5: this piece as a stop on the guided tour
    else if (a === 'pack') { closeDecMenu(); if (Decor.remove(S, nav, k)) { save(); syncPups(); snd.sfx('close'); toast(`${IC.decor} ${esc(decorName(o.id))} is tucked back in the shed`, 2000); } }
  }
  function placeDecor(id) { return startPlace(id); }   // (kept for tests + the old callers: place mode for that decoration)

  // ---- creative build piece 5: the guided tour. HOME: tour mode (Explore -> My island -> Add a stop, or a placed piece's "Tour stop"):
  // tap a decoration, a building or a spot (pins show the stops so far), type a note (the guestbook filter, 60 letters), Add stop.
  // VISIT: the Tour button -> Schiffy walks the host's stops (walker.tour) with the notes as a bubble over her; any input ends it.
  const TOUR_WHY = { full: 'The tour has all 6 stops: take one out first', dup: 'That is already a stop', gone: 'That is not there any more', far: 'Pick a spot on the island (dry land, near a path)' };
  let TPM = null;   // { tgt: {t, r, x, z} | null, label }
  const stopName = st => st.t === 'd' ? (() => { const o = S.placed.find(p => p.k === st.r); return o ? decorName(o.id) : 'A spot'; })()
    : st.t === 'h' ? (S.plots[st.r] ? bName(S.plots[st.r].type, nav.plotBy[st.r]) : 'A spot') : 'A spot';
  function startTourPick(tgt, show) {
    if (VISIT) return; endPlace(); if (LM) endLand(); closeDecMenu(); closePlot(); if (soc) soc.close();
    TPM = { tgt: null, label: '', show: !!show }; $('tourBar').hidden = false; $('tbNote').value = ''; snd.sfx('open');
    if (tgt) tourTarget(tgt); else tpShow();
  }
  function endTourPick(back) { if (!TPM) return; TPM = null; $('tourBar').hidden = true; $('tourPins').innerHTML = ''; if (soc) { soc.pubSoon(); if (back) soc.open('mine'); } }
  function tourTarget(tgt) { if (!TPM) return; TPM.tgt = tgt; TPM.label = stopName(tgt); snd.sfx('tap'); tpShow(); setTimeout(() => { const n = $('tbNote'); if (n && !PHONE) n.focus(); }, 0); }
  function tpShow(why) {
    const n = (S.tour || []).length, full = n >= Tour.C.MAX, el = $('tourBar');
    $('tbName').innerHTML = `${IC.decor} ${TPM.show ? 'Your island tour' : full ? 'Your tour is full' : `Tour stop ${n + 1} of ${Tour.C.MAX}`}`;
    el.classList.toggle('bad', !!why); el.classList.toggle('got', !why && !!TPM.tgt);
    $('tbWhy').textContent = why || (TPM.show ? `${n} stop${n === 1 ? '' : 's'}: the numbers show where. Tap a spot to add another.` : TPM.tgt ? `Stop: ${TPM.label}. Leave a note for visitors (optional).` : full ? 'Take a stop out in Visit > My island to add another.' : (PHONE ? 'Tap' : 'Click') + ' a treasure, a home or a spot on the island.');
    $('tbAdd').disabled = !TPM.tgt || full; $('tbNote').hidden = !TPM.tgt;
  }
  function tourPickAt(mx, my) {   // what the tap is on: a placed piece, then a building, then the ground
    TPM.show = false;
    if (S.placed.length) { const k = pickDecor(mx, my); if (k !== null) return tourTarget({ t: 'd', r: k }); }
    const x = plots.pick(mx, my, camera, W(), H(), PHONE ? 44 : 34); if (x && S.plots[x.q.pid]) return tourTarget({ t: 'h', r: x.q.pid });
    const g = pickGround(mx, my); if (g) return tourTarget({ t: 's', x: g[0], z: g[2] });
  }
  function tourAdd() {
    if (!TPM || !TPM.tgt) return; const res = {}, i = Tour.add(S, nav, Object.assign({ note: $('tbNote').value }, TPM.tgt), res);
    if (i < 0) { tpShow(TOUR_WHY[res.why] || 'Note: ' + res.why); snd.sfx('close'); return; }
    save(); snd.sfx('pop'); toast(`${IC.decor} Tour stop ${i + 1} is ready`, 1600); TPM.tgt = null; $('tbNote').value = ''; tpShow();
  }
  // pins over the stops (tour mode) + the guide's bubble over Schiffy (a visit): DOM, placed after each render
  const tpV = new THREE.Vector3();
  const scr = (x, y, z) => { tpV.set(x, y, z).project(camera); return tpV.z < 1 && Math.abs(tpV.x) < 1.1 && Math.abs(tpV.y) < 1.1 ? [(tpV.x + 1) / 2 * W(), (1 - tpV.y) / 2 * H()] : null; };
  let GUIDE = null;   // { i, n, text, at }
  function tourFrame() {
    if (TPM) {
      const L = Tour.stops(S, nav).map(s => ({ x: s.x, z: s.z, n: s.i + 1 })); if (TPM.tgt) { const p = TPM.tgt.t === 's' ? [TPM.tgt.x, TPM.tgt.z] : Tour.posOf(S, nav, TPM.tgt); L.push({ x: p[0], z: p[1], n: '+', nw: 1 }); }
      const box = $('tourPins'); while (box.children.length < L.length) box.appendChild(document.createElement('div')); while (box.children.length > L.length) box.lastChild.remove();
      L.forEach((s, k) => { const el = box.children[k], p = scr(s.x, ground(s.x, s.z, nav.TP[1]) + 7, s.z); el.className = 'tpin' + (s.nw ? ' new' : ''); el.textContent = s.n; el.style.display = p ? '' : 'none'; if (p) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; } });
    }
    if (GUIDE && walker) { const w = walker.pos(), p = scr(w[0], w[1] + 9, w[2]), el = $('guideSay'); el.style.display = p && GUIDE.text ? '' : 'none'; if (p) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; } }
  }
  function startGuide() {
    if (!VISIT || !walker || !S.tour) return false;
    const stops = Tour.stops(S, nav), n = stops.length, el = $('guideSay'), chip = $('tourChip');
    const say = (html, i) => { GUIDE = { i, n, text: html }; el.innerHTML = html; el.hidden = false; el.classList.remove('in'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in'))); };
    chip.textContent = `Island tour: stop 1 of ${n} · tap or press a key to stop`; chip.hidden = false; $('visHint').hidden = true;
    const ok = walker.tour(stops, nav.trunkR(fx.scale), {
      onLeg: i => { chip.textContent = `Island tour: stop ${i + 1} of ${n} · tap or press a key to stop`; say(`<b>${i + 1} / ${n}</b>Trotting along...`, i); },
      onStop: (i, s) => { snd.sfx('pop'); stopCam(s); say(`<b>${i + 1} / ${n}</b>${s.note ? '"' + esc(s.note) + '"' : esc(i ? 'And here!' : 'Here it is!')}<small>${esc(SOC_HOST())}'s tour</small>`, i); },
      onEnd: skipped => { GUIDE = null; el.hidden = true; el.classList.remove('in'); chip.hidden = true; chip.textContent = 'Tap anywhere to skip'; if (!skipped) toast(`${IC.decor} That was ${esc(SOC_HOST())}'s island tour. Lovely!`, 2600); },
    });
    if (!ok) chip.hidden = true;
    return ok;
  }
  // at a stop: the camera swings round behind Schiffy so the stop is in front of her (the walker keeps following her)
  function stopCam(s) {
    const w = walker.pos(), dx = w[0] - s.x, dz = w[2] - s.z, L = Math.hypot(dx, dz);
    let ux = L > 1.5 ? dx / L : camera.position.x - w[0], uz = L > 1.5 ? dz / L : camera.position.z - w[2]; const l2 = Math.hypot(ux, uz) || 1; ux /= l2; uz /= l2;
    const d = W() < H() ? 40 : 30, ex = w[0] + (ux * 0.9 - uz * 0.45) * d, ez = w[2] + (uz * 0.9 + ux * 0.45) * d, ey = Math.max(w[1], ground(ex, ez, w[1])) + 15;
    flyTo(new THREE.Vector3(ex, ey, ez), new THREE.Vector3(w[0], w[1] + 4, w[2]), 1.3);
  }
  const SOC_HOST = () => (soc && soc.V && soc.V.island ? soc.V.island.host : 'The host');
  addEventListener('pointerdown', e => { if (walker && walker.guide && !(e.target && e.target.closest && e.target.closest('#vTour'))) walker.endTour(true); }, true);
  $('tbAdd').onclick = tourAdd; $('tbDone').onclick = () => { endTourPick(true); snd.sfx('close'); };
  addEventListener('keydown', e => {
    if (!TPM) return; const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
    if (e.code === 'Escape') { endTourPick(true); snd.sfx('close'); } else if (e.code === 'Enter') tourAdd(); else return;
    if (!typing || e.code === 'Escape' || e.code === 'Enter') e.preventDefault();
  });

  // ---- creative build part 2: shaping the land (src/land.js rules, src/land_fx.js view). The Craft card's "Shape the land" tab
  // opens the land bar: Path (drag a brush along the ground: stepping stones or packed earth; pups prefer painted paths), Meadow
  // (a flower patch, 3 sizes, 4 kinds, walked on), Plant (a Woods tree, 1 seed + 4 berries, sapling -> full over 2 days), Remove (a
  // forest tree on open land for wood once, or your own path / meadow / planted tree). Green / red + why like place mode; Undo =
  // the last change made this session. PC: left drag paints / click does it (right drag turns the view); phone: one finger paints
  // or taps, two fingers move the camera, "Here" confirms a tap.
  const LAND_WHY = Object.assign({}, WHY, { short: 'Drag a little further', long: `Paths can wind ${Land.C.TOTAL} m in all`, full: 'The island holds as many as it can',
    gather: 'The pups gather here: this tree stays', cost: 'A little more needed', level: 'Opens when the Elder Tree grows taller', none: 'Nothing of yours or a forest tree here' });
  const MEADOW_R = [3.5, 5.5, 8], MEADOW_N = ['Wildflower', 'Rose', 'Buttercup', 'Bluebell'], STYLE_N = ['Stepping stones', 'Packed earth'];
  const LAND_TOOLS = { path: 'Paint a path', meadow: 'Sow a meadow', plant: 'Plant a tree', remove: 'Remove' };
  let LM = null;   // land mode: { tool, style, kind, size, mf, raw (stroke), paint (painting now), pid (pointer), x, z, ok, why, bad, target, t }
  const landUndo = [];   // this session's changes, last first out
  const landYaw = (x, z) => Math.round(((Math.abs(x * 7.31 + z * 3.17) % 6.283)) * 1000) / 1000;
  function landCraftHtml() {
    const l = S.land, used = Land.total(S), cp = Land.canPlant(S, 0);
    const row = (id, ic, name, txt, small, extra) => `<div class="cri land"><div class="crh">${IC[ic] || IC.decor}<b>${name}</b><small>${small}</small></div>${extra || ''}<div class="crf">${txt}</div><div class="crb"><button class="go sm" data-x="land" data-id="${id}">${id === 'remove' ? 'Remove' : id === 'plant' ? 'Plant' : id === 'meadow' ? 'Sow' : 'Paint'}</button></div></div>`;
    return `<p class="crf pure" style="margin:4px 2px">Shape the island your way. The same gentle rules as treasures: dry, open land, clear of the pups' work spots.</p>` +
      row('path', 'build', 'Paint a path', 'Drag along the ground: stepping stones or packed earth. The pups love painted paths and take them when they are the shorter way.', `${Math.round(used)} of ${Land.C.TOTAL} m`) +
      row('meadow', 'sprout', 'Flower meadow', 'A patch of flowers to wander through. Beside a berry patch it helps the beds grow a little more.', `${l.meadows.length} of ${Land.C.MEADOWS}`) +
      row('plant', 'tree', 'Plant a tree', `Oaks + spruces from a seed: a sapling that grows into a full tree over 2 days. The pups walk round it.`, `${l.planted.length} of ${Land.C.PLANT}`,
        `<div class="crc">${Object.keys(Land.C.COST).map(k => `<span class="${cp.need && cp.need[k] ? 'short' : ''}">${IC[COST_IC[k]] || ''}${Land.C.COST[k]}</span>`).join('')}</div>`) +
      row('remove', 'wood', 'Remove', `A forest tree on open land gives ${Land.C.CUT_WOOD} wood, once (the trees the pups gather from stay). Also rubs out your own paths, meadows and planted trees.`, `${l.cut.length} trees removed`);
  }
  function startLand(tool) {
    if (VISIT || !booted) return false;
    if (PM) endPlace(); closeExp(); closePlot(); closeEvents(); closeNeed(); closeDecMenu(); closeCraft(); if (soc) soc.close();
    follow = -1; pups.select(-1); refreshRoster(true);
    LM = LM || { tool: 'path', style: 0, kind: 1, size: 1, mf: 0, raw: null, paint: false, pid: null, x: NaN, z: NaN, ok: false, why: 'land', target: null, t: 0, bad: null };
    $('landBar').hidden = false; document.body.classList.add('placing'); controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; snd.sfx('open');
    lmTool(tool || LM.tool);
    const g = pickGround(W() / 2, H() * 0.55); if (g) lmHover(g[0], g[2]);
    return true;
  }
  function endLand() {
    if (!LM) return; LM = null; $('landBar').hidden = true; document.body.classList.remove('placing'); controls.enabled = true; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    expFx.ghost(null); if (expFx.ring) expFx.ring(null); if (landFx) landFx.stroke(null);
  }
  function lmTool(t) {
    if (!LM || !LAND_TOOLS[t]) return; LM.tool = t; LM.failed = false; LM.raw = null; LM.paint = false; LM.target = null; expFx.ghost(null); if (expFx.ring) expFx.ring(null); if (landFx) landFx.stroke(null);
    for (const b of $('lbTools').querySelectorAll('button')) b.classList.toggle('on', b.dataset.t === t);
    $('lbOk').hidden = !(PHONE && t !== 'path');
    $('lbKeys').innerHTML = t === 'path' ? 'Drag to paint &middot; right drag turns the view &middot; Ctrl+Z undo &middot; Esc done' : 'Click to ' + (t === 'remove' ? 'remove' : t === 'plant' ? 'plant' : 'sow flowers') + ' &middot; Ctrl+Z undo &middot; 1-4 tools &middot; Esc done';
    lmOpts(); if (isFinite(LM.x)) lmHover(LM.x, LM.z); else lmShow();
  }
  function lmOpts() {
    const t = LM.tool, b = (k, v, on, txt) => `<button data-o="${k}" data-v="${v}" class="${on ? 'on' : ''}">${txt}</button>`; let h = '';
    if (t === 'path') h = STYLE_N.map((n, i) => b('style', i, LM.style === i, n)).join('') + `<button disabled><small>${Math.round(Land.total(S))} / ${Land.C.TOTAL} m</small></button>`;
    else if (t === 'meadow') h = ['Small', 'Medium', 'Large'].map((n, i) => b('size', i, LM.size === i, n)).join('') + MEADOW_N.map((n, i) => b('mf', i, LM.mf === i, n)).join('');
    else if (t === 'plant') h = Land.KINDS.map((id, i) => { const e = Catalog.BY[id], c = Land.canPlant(S, i); return b('kind', i, LM.kind === i, esc(e.name) + (c.why === 'level' ? ` <small>L${e.lv}</small>` : '')); }).join('');
    $('lbOpts').innerHTML = h;
  }
  function lmShow() {
    if (!LM) return; const t = LM.tool, el = $('lbFx');
    $('lbName').innerHTML = `${IC[{ path: 'build', meadow: 'sprout', plant: 'tree', remove: 'wood' }[t]]} <b>${LAND_TOOLS[t]}</b>`;
    let why = LM.ok ? '' : (LAND_WHY[LM.why] || 'Not here'), fx = '';
    if (t === 'path') { why = LM.paint ? (LM.ok ? 'Looks lovely: let go to lay it' : why) : LM.ok === 'done' ? 'Path laid!' : LM.failed ? why : (LM.why === 'land' || !LM.raw ? (PHONE ? 'Drag a finger along the ground' : 'Hold the mouse button and drag along the ground') : why); fx = LM.fx || 'The pups take painted paths when they are the shorter way'; }
    else if (t === 'meadow') { if (LM.ok) why = PHONE ? 'Tap Here to sow the flowers' : 'Click to sow the flowers'; fx = LM.fx || 'Walked through: blocks nobody'; }
    else if (t === 'plant') { const c = Land.canPlant(S, LM.kind); if (!c.ok && (LM.ok || !isFinite(LM.x))) { why = c.why === 'cost' ? `A little more needed: ${Object.keys(c.need).map(k => c.need[k] + ' ' + (k === 'food' ? 'berries' : k)).join(' + ')}` : LAND_WHY[c.why] || why; LM.ok = false; } else if (LM.ok) why = PHONE ? 'Tap Here to plant it' : 'Click to plant it here';
      fx = `${IC.seed}${Land.C.COST.seeds} + ${IC.food}${Land.C.COST.food} &middot; a sapling, full grown in 2 days`; }
    else if (t === 'remove') { const g = LM.target; if (g && g.ok) why = g.what; fx = g && g.ok ? g.fx : 'Point at a forest tree, or a path / meadow / tree of your own'; }
    $('lbWhy').textContent = why; el.hidden = !fx; el.className = LM.fxOn ? '' : 'none'; el.innerHTML = fx;
    $('landBar').classList.toggle('bad', t === 'path' ? (LM.paint ? !LM.ok : !!LM.failed) : !LM.ok); $('lbOk').disabled = !LM.ok;
    $('lbUndo').disabled = !landUndo.length;
  }
  // the pointer is over (x, z): preview what the tool would do there (cheap rules; the walk test for planting runs on confirm)
  function lmHover(x, z) {
    if (!LM) return; LM.x = Math.round(x * 10) / 10; LM.z = Math.round(z * 10) / 10; LM.fx = ''; LM.fxOn = false; const t = LM.tool;
    if (ground.raw(x, z) === null) { LM.ok = false; LM.why = 'land'; }
    else if (t === 'meadow') {
      const r = MEADOW_R[LM.size], c = Land.checkMeadow(S, nav, LM.x, LM.z, r); LM.ok = c.ok; LM.why = c.why;
      const pv = c.ok ? Catalog.landPreview(S, nav, 'meadow', { x: LM.x, z: LM.z, r }) : null; if (pv && pv.helps) { LM.fx = `${IC.nourish} By a garden: the beds grow a little more`; LM.fxOn = true; }
      if (expFx.ring) expFx.ring([LM.x, LM.z], r, c.ok);
    } else if (t === 'plant') {
      const r = landYaw(LM.x, LM.z), c = Land.checkPlant(S, nav, LM.kind, LM.x, LM.z, r, { reach: false, free: true }); LM.ok = c.ok && !(wfx && wfx.propHit && wfx.propHit(LM.x, LM.z, 2)); LM.why = c.ok ? 'decor' : c.why;
      expFx.ghost(Land.KINDS[LM.kind], LM.x, LM.z, r, LM.ok, performance.now() / 1000, 0);
    } else if (t === 'remove') {
      LM.target = landTarget(LM.x, LM.z); LM.ok = !!(LM.target && LM.target.ok); LM.why = LM.target ? LM.target.why : 'none';
      if (expFx.ring) expFx.ring(LM.target ? LM.target.c : null, LM.target ? LM.target.R : 1, LM.ok);
      if (landFx) landFx.stroke(LM.target && LM.target.kind === 'path' ? LM.target.pts : null, false);
    }
    LM.t = performance.now(); lmShow();
  }
  // what Remove would take at (x, z): your planted tree > your meadow > your painted path > a forest tree
  function landTarget(x, z) {
    const k1 = Land.plantedAt(S, x, z, 3.5); if (k1 !== null) { const it = S.land.planted.find(t => t.k === k1), e = Land.kindOf(it.t); return { kind: 'plant', k: k1, ok: true, c: [it.x, it.z], R: 3, what: `Dig up this ${e.name.toLowerCase()}`, fx: 'The seed stays in the ground: nothing comes back' }; }
    const k2 = Land.meadowAt(S, x, z); if (k2 !== null) { const m = S.land.meadows.find(q => q.k === k2); return { kind: 'meadow', k: k2, ok: true, c: [m.x, m.z], R: m.r, what: 'Pick these flowers', fx: 'The meadow goes' }; }
    const k3 = Land.pathAt(S, x, z, 1.6); if (k3 !== null) { const P = S.land.paths.find(q => q.k === k3); return { kind: 'path', k: k3, ok: true, c: [x, z], R: 1.5, pts: Land.ptsOf(P), what: 'Rub out this path', fx: `${Math.round(Land.lenOf(Land.ptsOf(P)))} m of ${STYLE_N[P.s].toLowerCase()}` }; }
    const tr = Land.treeAt(S, nav, x, z, 4.5); if (tr) { const p = map.layout.placements[tr.pid]; return { kind: 'tree', pid: tr.pid, ok: tr.ok, why: tr.why, c: [tr.pos[0], tr.pos[2]], R: 3.2 * (p.s || 1), what: `Remove this ${/Spruce/.test(p.piece) ? 'spruce' : 'oak'}: +${Land.C.CUT_WOOD} wood`, fx: `${IC.wood} +${Land.C.CUT_WOOD} wood, once; the ground joins open land` }; }
    return null;
  }
  function lmConfirm() {
    if (!LM) return false; const t = LM.tool, res = {};
    if (!isFinite(LM.x)) return false;
    if (t === 'meadow') { const k = LM.ok ? Land.addMeadow(S, nav, LM.x, LM.z, MEADOW_R[LM.size], LM.mf, res) : -1; if (k < 0) { snd.sfx('close'); return false; } landUndo.push({ kind: 'meadow', k }); snd.sfx('pop'); landDone('Flowers sown'); }
    else if (t === 'plant') {
      const r = landYaw(LM.x, LM.z), k = LM.ok ? Land.plant(S, nav, LM.kind, LM.x, LM.z, r, res) : -1;
      if (k < 0) { LM.ok = false; LM.why = res.why || LM.why; lmShow(); snd.sfx('close'); return false; }
      landUndo.push({ kind: 'plant', k }); snd.sfx('built'); landDone(`${Land.kindOf(LM.kind).name} planted: full grown in 2 days`);
    } else if (t === 'remove') {
      const g = LM.target; if (!g || !g.ok) { snd.sfx('close'); return false; }
      if (g.kind === 'plant') { const it = Object.assign({}, S.land.planted.find(x => x.k === g.k)); Land.unplant(S, nav, g.k, false); landUndo.push({ kind: 'replant', it }); landDone('Dug up'); }
      else if (g.kind === 'meadow') { const m = Object.assign({}, S.land.meadows.find(x => x.k === g.k)); Land.removeMeadow(S, g.k); landUndo.push({ kind: 'remeadow', m }); landDone('Flowers picked'); }
      else if (g.kind === 'path') { const P = S.land.paths.find(x => x.k === g.k); landUndo.push({ kind: 'repath', pts: Land.ptsOf(P), s: P.s }); Land.removePath(S, nav, g.k); landDone('Path rubbed out'); }
      else if (g.kind === 'tree') { if (!Land.cut(S, nav, g.pid, res)) { snd.sfx('close'); return false; } landUndo.push({ kind: 'cut', pid: g.pid }); const p = g.c; if (wfx) wfx.sparkle(p[0], ground(p[0], p[1], nav.TP[1]) + 2, p[1], 14, true); floater([p[0], ground(p[0], p[1], nav.TP[1]) + 8, p[1]], `+${Land.C.CUT_WOOD} ${IC.wood}`); landDone(`Tree removed: +${Land.C.CUT_WOOD} wood`); }
      snd.sfx('pop');
    }
    lmHover(LM.x, LM.z); return true;
  }
  function landDone(msg) { save(); syncPups(); refreshTree(); toast(`${IC.sprout} ${msg}`, 1800); if (LM) { lmOpts(); lmShow(); } }
  function lmUndo() {
    const u = landUndo.pop(); if (!u) return false; let ok = true;
    if (u.kind === 'path') ok = Land.removePath(S, nav, u.k);
    else if (u.kind === 'meadow') ok = Land.removeMeadow(S, u.k);
    else if (u.kind === 'plant') ok = Land.unplant(S, nav, u.k, true);   // a fresh planting comes back: seed + berries
    else if (u.kind === 'cut') { ok = Land.uncut(S, nav, u.pid); if (!ok) toast(`${IC.wood} To undo it, the ${Land.C.CUT_WOOD} wood goes back first`, 2200); }
    else if (u.kind === 'repath') ok = Land.addPath(S, nav, u.pts, u.s) >= 0;
    else if (u.kind === 'remeadow') ok = Land.addMeadow(S, nav, u.m.x, u.m.z, u.m.r, u.m.f) >= 0;
    else if (u.kind === 'replant') ok = Land.replant(S, nav, u.it);
    if (!ok) { if (u.kind !== 'cut') toast('That can\'t come back here any more', 1800); snd.sfx('close'); }
    else { save(); syncPups(); refreshTree(); snd.sfx('tap'); }
    if (LM) { lmOpts(); if (isFinite(LM.x)) lmHover(LM.x, LM.z); else lmShow(); }
    return ok;
  }
  // the path brush: raw pointer points on the ground (>= 0.4 m apart) -> the land rules every 80 ms -> laid on release
  let lmCheckT = 0;
  function lmStroke(x, z, end) {
    if (!LM || LM.tool !== 'path') return;
    const R = LM.raw || (LM.raw = []), last = R[R.length - 1];
    if (x !== null && (!last || Math.hypot(x - last[0], z - last[1]) >= 0.4)) R.push([x, z]);
    const now = performance.now();
    if (!end && now - lmCheckT < 80) return; lmCheckT = now;
    const pts = Land.resample(R, 2.5), c = pts.length >= 2 ? Land.checkPath(S, nav, pts) : { ok: false, why: 'short' };
    LM.ok = c.ok; LM.why = c.why; LM.bad = c.i; LM.fx = ''; LM.fxOn = false;
    if (c.ok) { const pv = Catalog.landPreview(S, nav, 'path', { k: -1, s: LM.style, p: [].concat(...pts.map(p => [Math.round(p[0] * 10), Math.round(p[1] * 10)])) }); if (pv.helps) { LM.fx = `${IC.wood} Leads to a tidy yard: gatherers bring more`; LM.fxOn = true; } }
    if (landFx) landFx.stroke(pts, c.ok, c.i);
    if (end) {
      LM.paint = false; controls.enabled = true;
      if (c.ok) { const k = Land.addPath(S, nav, pts, LM.style); if (k >= 0) { landUndo.push({ kind: 'path', k }); snd.sfx('built'); landDone(`${STYLE_N[LM.style]} laid: ${Math.round(Land.lenOf(pts))} m`); LM.ok = 'done'; } }
      else { snd.sfx('close'); LM.failed = true; }
      LM.raw = null; setTimeout(() => { if (LM && !LM.paint && landFx) landFx.stroke(null); }, c.ok ? 300 : 1400);
    }
    lmShow();
  }
  function buildExpUI() {
    $('expBtn').onclick = () => { if (expView) closeExp(); else openExp(); };
    $('ecClose').onclick = closeExp;
    // photo mode
    $('photoBtn').innerHTML = IC.photo || IC.star; $('photoBtn').onclick = openPhoto; $('phDone').onclick = closePhoto; $('phSave').onclick = savePhoto;
    $('phTime').oninput = e => { if (PHOTO) { PHOTO.h = +e.target.value; renderPhoto(); } }; $('phNow').onclick = () => { if (PHOTO) { PHOTO.h = null; renderPhoto(); } };
    $('phSea').addEventListener('click', e => { const b = e.target.closest('button[data-sea]'); if (b && PHOTO) { const v = +b.dataset.sea; PHOTO.sea = v < 0 ? null : v; renderPhoto(); } });
    $('phFrame').addEventListener('click', e => { const b = e.target.closest('button[data-fr]'); if (b && PHOTO) { PHOTO.frame = b.dataset.fr; renderPhoto(); } });
    addEventListener('keydown', e => { if (PHOTO && e.key === 'Escape') closePhoto(); });
    $('craftBtn').onclick = () => { if (craftOpen) closeCraft(); else openCraft(); }; $('crClose').onclick = closeCraft;
    $('pace').onclick = () => { if (craftOpen && craftSet === 'up') closeCraft(); else openCraft('up'); };   // pacing pass: the tree card's pace line
    $('crSets').addEventListener('click', e => { const b = e.target.closest('button[data-set]'); if (b) { craftSet = b.dataset.set; renderCraft(); $('craftCard').scrollTop = 0; } });
    $('crBody').addEventListener('click', e => { const b = e.target.closest('button[data-x]'); if (b && !b.disabled) craftAct(b.dataset.x, b.dataset.id); });
    // free decor: the place bar + the menu over a placed decoration
    $('pbOk').onclick = () => pmConfirm(); $('pbCancel').onclick = () => { endPlace(); snd.sfx('close'); };
    // turn buttons: a tap = one step, holding keeps turning (free rotation with snap off)
    for (const [id, d] of [['pbRotL', -1], ['pbRotR', 1]]) {
      const b = $(id); let iv = null, t0 = 0; const stop = () => { clearInterval(iv); iv = null; };
      b.addEventListener('pointerdown', e => { e.preventDefault(); pmTurn(d); t0 = performance.now(); stop(); iv = setInterval(() => { if (performance.now() - t0 > 350) pmTurn(d); }, 70); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    }
    $('pbSnap').onclick = () => pmSnap(); $('pbCopy').onclick = () => pmCopy();
    $('pbSnap').classList.toggle('on', !!DPREF.snap);
    $('decMenu').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) decMenuAct(b.dataset.a); });
    // creative build part 2: the land bar
    $('lbTools').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) { lmTool(b.dataset.t); snd.sfx('tap'); } });
    $('lbOpts').addEventListener('click', e => { const b = e.target.closest('button[data-o]'); if (!b || !LM) return; LM[b.dataset.o] = +b.dataset.v; lmOpts(); if (isFinite(LM.x)) lmHover(LM.x, LM.z); snd.sfx('tap'); });
    $('lbUndo').onclick = () => lmUndo(); $('lbDone').onclick = () => { endLand(); snd.sfx('close'); }; $('lbOk').onclick = () => lmConfirm();
    $('hOk').onclick = closeHaul;
    $('hDecor').onclick = () => { closeHaul(); openExp(); setTimeout(() => { const e = document.querySelector('#ecBody .dec'); if (e) e.scrollIntoView({ block: 'center' }); }, 50); };
    $('hWard').onclick = () => { closeHaul(); openWard(wardWho()); };
    $('hPup').onclick = () => { const h = S.exp.hauls[haulK], i = h ? h.pupIdx : -1; closeHaul(); if (i >= 0) { focusPup(i); showAway(null); } };
    $('ecBody').addEventListener('click', e => {
      const b = e.target.closest('[data-x]'); if (!b || b.disabled) return; const x = b.dataset.x;
      if (x === 'plan') { const d = +b.dataset.d; if (Exped.board(S) === null) return; expView = { v: 'plan', dest: d, tier: Exped.DEST[d].voy ? Exped.TIERS.findIndex(t => t.voy) : 1, team: [] }; }
      else if (x === 'peek') { const d = Exped.DEST[+b.dataset.d]; toast(`${IC.lock} ${d.name}: ${d.voy ? (S.level < 8 ? 'far out past the floating isles: the Elder Tree first' : 'opens with Elder ring ' + Rings.voyRing(d.id)) : d.locked ? 'far out in the sky, out of reach for now' : 'drifts close at tree level ' + d.lv}`, 2600); return; }
      else if (x === 'back') expView = { v: 'home' };
      else if (x === 'tier') expView.tier = +b.dataset.k;
      else if (x === 'pick') { const i = +b.dataset.i, k = expView.team.indexOf(i); if (k >= 0) expView.team.splice(k, 1); else if (expView.team.length < Exped.maxTeam(S)) expView.team.push(i); else toast(`A skyboat holds ${Exped.maxTeam(S)} pups`, 1600); }
      else if (x === 'send') { const v = expView; sendTrip(v.dest, v.tier, v.team.slice()); return; }
      else if (x === 'haul') { openHaul(+b.dataset.k); return; }
      else if (x === 'recall') { e.stopPropagation(); const tr = S.exp.trips.find(t => t.id === +b.dataset.id), vy = tr && tr.sup; if (Exped.recall(S, nav, +b.dataset.id)) { toast(vy ? 'The crew stays home: every bit of the supplies goes back to the stores' : 'The crew stays home: packed berries back in the pantry', 2400); save(); } }
      else if (x === 'look') { const v = expFx.view.trips.find(t => t.trip.id === +b.dataset.id); if (v && v.mode === 'far') { toast(`${IC.star} The crew is out past the clouds: home in ${fmtT(Math.max(0, v.trip.dep + v.trip.dur - S.time))}`, 2600); return; } if (v) { const p = v.label.clone(); follow = -1; flyTo(p.clone().add(camera.position.clone().sub(controls.target).setLength(160)), p, 1.3); } return; }
      else if (x === 'place') { placeDecor(b.dataset.id); }
      else if (x === 'craft') { openCraft(); return; }
      else if (x === 'unplace') { if (Exped.unplace(S, +b.dataset.k, nav)) { save(); syncPups(); toast('Tucked back in the shed', 1600); } }
      else if (x === 'findplot') { closeExp(); const pi = plots.info.find(p => p.st === 'open' && p.show); if (pi) openPlot(pi.q.pid, true); return; }
      renderExp(true);
    });
    $('tlabels').addEventListener('click', e => { const l = e.target.closest('[data-t]'); if (!l) return; if (l.dataset.t === 'haul') openHaul(0); else if (l.dataset.t === 'trader') { openEvents(); traderCam(); } else if (l.dataset.t === 'fruit') fruitCam(); else openExp(); });
  }
  // ---- step 4: the events card (happening now, the trader's stall, the island log) and the need card
  let evOpen = false, evSig = '';
  const agoT = t => { const d = S.time - t; return d < 90 ? 'just now' : fmtT(d) + ' ago'; };
  const pupN = i => S.pups[i] ? esc(S.pups[i].name) : 'A pup';
  const goodsHtml = o => Object.keys(o).map(k => `<span class="gl">${k === 'decor' ? IC.decor + decorName(o[k]) : (k === 'seeds' ? IC.seed : IC[k]) + o[k]}</span>`).join(' ');
  const EV_IC = { fruit: 'fruit', shower: 'rain', crystal: 'crystal', wish: 'wish', trader: 'cart', wave: 'blight', fest: 'fest' };
  // step 5: seasonal festivals (Events 'fest', e.sea = season index)
  const FEST = [{ t: 'Blossom picnic', s: 'petals everywhere, the pups play music under the blossoms' }, { t: 'Splash day', s: 'the pups splash in the river and bring the tree extra water' },
    { t: 'Lantern night', s: 'paper lanterns all round the plaza: the tree glows brighter' }, { t: 'Snow pup day', s: 'the pups build snow pups by the plaza, and everyone giggles' }];
  // a wish: "Mochi dreams of lighting the lamps"
  const JOB_DREAM = { water: 'carrying water from the spring', light: 'lighting the lamps', wood: 'chopping wood', stone: 'shaping stone', food: 'picking berries', build: 'building something',
    rest: 'a long lazy nap', nourish: 'tending the roots', protect: 'standing watch', spirit: 'playing music' };
  function evText(e, live) {   // e = an active event or a log entry -> {t: title, s: sub}
    const n = e.n, pl = (x, w) => x + ' ' + w + (x === 1 ? '' : 's');
    if (e.type === 'fruit') return { t: `The Elder Tree dropped ${pl(n, 'glowing fruit')}`, s: live ? 'Tap them by the roots: berries + roots, sometimes a seed' : e.out === 'auto' ? (e.got ? `you picked ${e.got}, the pups shared the rest` : 'the pups shared the fruit') : e.out === 'done' ? 'every last one gathered!' : '' };
    if (e.type === 'shower') return { t: 'A sudden shower', s: live ? 'the tree drinks it up (+' + Events.C.SHOWER + ' water an hour)' : 'the tree drank it all up' };
    if (e.type === 'crystal') return { t: `${pupN(e.pup)} found ${pl(n, 'crystal')}`, s: 'twinkling in the grass by the roots' };
    if (e.type === 'wish') return { t: `${pupN(e.pup)} dreams of ${IC[e.want] || ''}${JOB_DREAM[e.want] || JOB_NAMES[e.want] || e.want}`, s: live ? `give them the job: +${Events.C.WISH_MORALE} happiness` : e.out === 'done' ? 'wish granted, tail going like a windmill' : e.out === 'forgot' ? 'drifted off to another daydream (no harm done)' : '' };
    if (e.type === 'trader') return { t: 'A wandering trader', s: live ? `a little stall by the tree, here for ${fmtT(Math.max(0, e.end - S.time))}` : e.traded ? `traded ${e.traded} time${e.traded > 1 ? 's' : ''}, then wandered on` : 'wandered on' };
    if (e.type === 'wave') return { t: `A blight wave: ${pl(n || 0, 'dark patch')}`, s: 'wardens sweep them away' };
    if (e.type === 'fest') { const f = FEST[e.sea] || FEST[0], nd = e.need ? NEED_NAMES[e.need] : ''; return { t: f.t, s: live ? `${f.s} (+${Events.C.FEST_RATE} ${nd.toLowerCase()} an hour for ${fmtT(Math.max(0, e.end - S.time))})` : 'a lovely day, everyone a little happier' }; }
    return { t: e.type, s: '' };
  }
  function openEvents() { closePlot(); closeExp(); closeNeed(); evOpen = true; $('evTitle').innerHTML = `${IC.bell} Island happenings`; $('evCard').hidden = false; renderEvents(true); }
  function closeEvents() { evOpen = false; $('evCard').hidden = true; }
  function renderEvents(force) {
    if (!evOpen) return;
    const last = S.events.log[S.events.log.length - 1];
    const sig = J(S.events.active) + S.events.log.length + J(last || 0) + Math.floor(S.time / 20) + Math.floor(S.res.crystal || 0) + S.inv.seeds + Math.floor(S.res.food) + Math.floor(S.res.wood) + Math.floor(S.res.stone) + S.pups.map(p => p.job).join();
    if (!force && sig === evSig) return; evSig = sig;
    let h = `<h4>${IC.bell} Happening now</h4>`;
    if (!S.events.active.length) h += `<div class="qe">All quiet for now. Something small happens every few minutes: falling fruit, showers, wishes, a trader...</div>`;
    for (const e of S.events.active) {
      const x = evText(e, true);
      h += `<div class="evi live ${e.type}">${IC[EV_IC[e.type]]}<div><b>${x.t}</b><small>${x.s}</small>`;
      if (e.type === 'trader') {
        h += `<div class="offers">` + e.offers.map((k, j) => { const o = Events.OFFERS[k], done = e.done.includes(j), c = Events.canTrade(S, e.id, j);
          return `<div class="of${done ? ' done' : ''}"><span class="gv">${goodsHtml(o.give)}</span><span class="ar">&#10140;</span><span class="gt2">${goodsHtml(o.get)}</span>${done ? `<span class="ok">traded!</span>` : `<button class="go sm" data-x="trade" data-id="${e.id}" data-j="${j}"${c.ok ? '' : ' disabled title="A little more needed"'}>Trade</button>`}</div>`; }).join('') + `</div>`;
      } else if (e.type === 'wish') {
        const p = S.pups[e.pup];
        if (p && p.job !== e.want) h += `<button class="go sm" data-x="wish" data-id="${e.id}">${e.want === 'rest' ? `Let ${esc(p.name)} nap` : `Make ${esc(p.name)} ${anA(JOB_NAMES[e.want].toLowerCase())}`}</button>`;
      } else if (e.type === 'fruit') h += `<button class="ghost sm" data-x="fruit">Show me the fruit</button> <small class="inl">${e.n - e.got.length} left &middot; ${fmtT(Math.max(0, e.end - S.time))}</small>`;
      else if (e.type === 'shower') h += `<small class="inl">${fmtT(Math.max(0, e.end - S.time))} more</small>`;
      h += `</div></div>`;
    }
    h += `<h4>${IC.clock} Earlier on the island</h4>`;
    const L = S.events.log.slice().reverse().filter(l => !S.events.active.some(a => a.id === l.id)).slice(0, 24);
    if (!L.length) h += `<div class="qe">Nothing yet. The day is young.</div>`;
    for (const l of L) { const x = evText(l, false); h += `<div class="evi lg">${IC[EV_IC[l.type]]}<div><b>${x.t}</b><small>${x.s}${x.s ? ' &middot; ' : ''}${agoT(l.t)}</small></div></div>`; }
    h += `<p class="sub small">Happenings never cost you anything: while you are away the pups gather the fruit, and wishes and traders simply drift by.</p>`;
    $('evBody').innerHTML = h;
  }
  function refreshEvBtn() {
    const b = $('evBtn'), a = S.events.active; b.dataset.n = a.length ? a.length : '';
    b.classList.toggle('ready', a.some(e => e.type === 'trader' || e.type === 'fruit' || (e.type === 'wish' && S.pups[e.pup] && S.pups[e.pup].job !== e.want)));
  }
  function collectFruit(f) {
    const r = Events.collect(S, f.id, f.j); if (!r) return;
    nfx.sparkle(f.p); snd.sfx('pop', { rate: 1.1 }); floater(f.p, `+${r.food}${IC.food}${r.nourish ? ` +${r.nourish}${IC.nourish}` : r.light ? ` +${r.light}${IC.light}` : ''}${r.seed ? ` +1${IC.seed}` : ''}`);
    save(); refreshTree(); renderEvents(true); refreshEvBtn();
  }
  function fruitCam() {
    const e = S.events.active.find(x => x.type === 'fruit'); if (!e) return;
    const p = nfx.fruitAt(S, e, e.got.length < e.n ? [...Array(e.n).keys()].find(j => !e.got.includes(j)) : 0), tgt = new THREE.Vector3(p[0], p[1], p[2]);
    const out = new THREE.Vector3(p[0] - nav.TP[0], 0, p[2] - nav.TP[2]).normalize();
    follow = -1; pups.select(-1); flyTo(tgt.clone().add(out.multiplyScalar(52)).add(new THREE.Vector3(0, 30, 0)), tgt, 1.2);
  }
  function traderCam() {
    const p = nfx.traderAt(S), tgt = new THREE.Vector3(p[0], p[1] - 5, p[2]), out = new THREE.Vector3(p[0] - nav.TP[0], 0, p[2] - nav.TP[2]).normalize();
    follow = -1; pups.select(-1); flyTo(tgt.clone().add(out.multiplyScalar(30)).add(new THREE.Vector3(0, 13, 0)), tgt, 1.2);
  }

  // need card: what feeds a need, who is on it, the blight / wards / seeds / stage around it
  let needK = null, needSig = '';
  const NEED_TXT = {
    water: 'Spring carriers fill their buckets at the river and pour them at the roots. The tree drinks less at night.',
    light: 'Lamplighters light their lanterns at the shrine and tend the glowing orbs. Busiest at dusk.',
    nourish: 'Root gardeners tend the beds and bring compost to the roots. With seeds they plant glow sprouts: each sprout makes every gardener better for a few hours.',
    protect: 'Blight creeps in as dark patches near the roots. Wardens sweep it away; crystal wards slow it down. Blight only ever slows the tree, and never spreads while the tree is well.',
    spirit: 'Minstrels play music: their very best on a stage, or busking on the plaza. Music lifts every pup\'s happiness and nearby pups dance. At night the stage puts on a little light show.',
  };
  function openNeed(k) { closePlot(); closeExp(); closeEvents(); needK = k; $('needCard').hidden = false; renderNeed(true); }
  function closeNeed() { needK = null; $('needCard').hidden = true; }
  function renderNeed(force) {
    if (!needK) return; const k = needK, aw = Sim.C.NEEDS[k].floor ? Needs.awakeK(S, k) : 1, rate = needRate(k);
    const sig = k + Math.round(S.needs[k]) + (rate === null ? 'x' : Math.round(rate)) + S.pups.map(p => p.job).join() + S.blight.list.length + S.wards.length + Math.floor(S.res.crystal || 0) + S.inv.seeds + S.garden.sprouts.length + J(S.plots).length + Math.floor(S.time / 60);
    if (!force && sig === needSig) return; needSig = sig;
    $('ncTitle').innerHTML = `${IC[k]} ${NEED_NAMES[k]} <small>${Math.round(S.needs[k])}%${rate !== null ? ` &middot; ${rate >= 0 ? '+' : ''}${rate.toFixed(0)} an hour` : ''}</small>`;
    let h = `<p class="sub">${NEED_TXT[k]}</p>`;
    if (aw < 0) h += `<p class="lockd">${IC.lock} Still asleep: the island keeps it near ${Sim.C.NEEDS[k].floor}. ${S.wake.t === null ? 'It wakes when your <b>first skyboat</b> comes home (build the Skyboat dock at tree level 2).' : `It wakes in <b>${fmtT(Math.max(0, Needs.wakeAt(S, k) - S.time))}</b>.`}</p>`;
    else if (aw < 1) h += `<p class="sub small">Freshly awake: it starts gently and asks for more care over the next ${fmtT((1 - aw) * Needs.C.RAMP)}.</p>`;
    const on = S.pups.map((p, i) => i).filter(i => S.pups[i].job === k);
    if (aw >= 0) {
      h += `<h4>${IC[k]} ${JOB_WHO[k] || JOB_NAMES[k] + ' pups'} <span class="cnt">${on.length}</span></h4>`;
      h += on.length ? `<div class="chips">${on.map(i => `<span class="chip" data-x="pup" data-i="${i}"><span class="dot" style="background:${S.pups[i].collar}"></span>${esc(S.pups[i].name)}</span>`).join('')}</div>` : `<div class="qe">Nobody yet. Tap a pup below to hand out the job.</div>`;
      const cand = S.pups.map((p, i) => i).filter(i => S.pups[i].job !== k && !S.pups[i].exp && S.pups[i].dislike !== k).sort((a, b) => (S.pups[b].like === k) - (S.pups[a].like === k) || (S.pups[a].job === 'rest' ? -1 : 0) - (S.pups[b].job === 'rest' ? -1 : 0) || a - b).slice(0, 3);
      if (cand.length) h += `<div class="chips">${cand.map(i => `<button class="ghost sm" data-x="assign" data-i="${i}">${IC[k]} ${esc(S.pups[i].name)}${S.pups[i].like === k ? ' <span class="lv">loves it</span>' : ''}</button>`).join('')}</div>`;
    }
    if (k === 'protect' && aw >= 0) {
      const B = Needs.C.BLIGHT, free = nav.wardSpots.length - S.wards.length;
      h += `<h4>${IC.blight} Blight <span class="cnt">${S.blight.list.length}</span></h4><div class="qe">${S.blight.list.length ? S.blight.list.map(b => `<span class="chip" data-x="blight" data-k="${b.k}">${IC.blight}${Math.round(b.r * 100)}%</span>`).join(' ') : 'No blight right now.'}${S.health < B.SPREAD_H ? ' <b>The tree feels weak: blight can spread.</b>' : ''}</div>`;
      h += `<h4>${IC.ward} Crystal wards <span class="cnt">${S.wards.length}/${nav.wardSpots.length}</span></h4><p class="sub small">A ward is a glowing crystal pillar: blight within ${B.WARD_R} m appears ${Math.round((1 - B.WARD_K) * 100)} % less and grows slower.</p>`;
      h += `<button class="go" data-x="ward"${free > 0 && (S.res.crystal || 0) >= B.WARD_COST ? '' : ' disabled'}>${IC.ward} Raise a ward (${IC.crystal}${B.WARD_COST})</button>${free <= 0 ? ' <small class="inl">every ward spot glows already</small>' : (S.res.crystal || 0) < B.WARD_COST ? ` <small class="inl">${Math.floor(S.res.crystal || 0)} crystals: skyboats + happenings find more</small>` : ''}`;
    }
    if (k === 'nourish' && aw >= 0) {
      const mx = Needs.sproutMax(S), cs = Needs.built(S, 'conserv');
      h += `<h4>${IC.sprout} Glow sprouts <span class="cnt">${S.garden.sprouts.length}/${mx}</span></h4><p class="sub small">${IC.seed}${S.inv.seeds} seeds in the shed. Root gardeners plant one when a bed is free; each sprout gives every gardener +${Math.round(Needs.C.GARDEN.SPROUT_K * 100)} % for ${fmtT(Needs.C.GARDEN.SPROUT_LIFE)}.${Needs.gardens(S).length ? ' Your berry patches are gardening spots too.' : ' Without a berry patch they use the root beds by the door.'}</p>`;
      h += cs ? `<p>${IC.conserv} <b>Glasshouse</b> built: ${gives('conserv')}</p>` : `<p class="sub small">${IC.conserv} A <b>Glasshouse</b> (tree level 3, tap Build) helps: ${gives('conserv')}.</p>`;
    }
    if (k === 'spirit' && aw >= 0) {
      const st = Needs.firstBuilt(S, 'stage');
      h += st !== null ? `<p>${IC.stage} <b>Moonlit stage</b> built: ${gives('stage')}.</p>` : `<p class="sub small">${IC.stage} No stage yet: minstrels busk on the plaza at ${Math.round(Needs.C.BUSK_K * 100)} %. Build a <b>Moonlit stage</b> on a plot.</p><button class="ghost" data-x="plot">${IC.home} Pick a plot for the stage</button>`;
      if (S.needs.spirit < Needs.C.GLUM_SPIRIT) h += `<p class="lockd">The pups feel a bit glum (happiness -${Needs.C.GLUM_MORALE}). A song would help!</p>`;
    }
    $('ncBody').innerHTML = h;
  }
  function buildNeedUI() {
    $('evBtn').onclick = () => { if (evOpen) closeEvents(); else openEvents(); };
    $('evClose').onclick = closeEvents; $('ncClose').onclick = closeNeed;
    $('evBody').addEventListener('click', e => {
      const b = e.target.closest('[data-x]'); if (!b || b.disabled) return; const x = b.dataset.x;
      if (x === 'trade') { const o = Events.trade(S, +b.dataset.id, +b.dataset.j); if (o) { toast(`${IC.cart} Swapped ${goodsHtml(o.give)} for ${goodsHtml(o.get)}`, 2600); save(); refreshTree(); } }
      else if (x === 'wish') { const ev = S.events.active.find(y => y.id === +b.dataset.id); if (ev) setJob(ev.pup, ev.want); }
      else if (x === 'fruit') { fruitCam(); }
      renderEvents(true); refreshEvBtn();
    });
    $('ncBody').addEventListener('click', e => {
      const b = e.target.closest('[data-x]'); if (!b || b.disabled) return; const x = b.dataset.x;
      if (x === 'assign') setJob(+b.dataset.i, needK);
      else if (x === 'pup') focusPup(+b.dataset.i);
      else if (x === 'ward') { const k = Needs.placeWard(S, nav); if (k >= 0) { save(); snd.sfx('lantern'); toast(`${IC.ward} A crystal ward rises, glowing by the roots`, 2400); const p = nfx.wardPos(k); if (p) { const tgt = new THREE.Vector3(p[0], p[1] + 4, p[2]), out = new THREE.Vector3(p[0] - nav.TP[0], 0, p[2] - nav.TP[2]).normalize(); follow = -1; flyTo(tgt.clone().add(out.multiplyScalar(52)).add(new THREE.Vector3(0, 30, 0)), tgt, 1.2); } } }
      else if (x === 'blight') { const p = nfx.blightPos(+b.dataset.k); if (p) { const tgt = new THREE.Vector3(p[0], p[1], p[2]), out = new THREE.Vector3(p[0] - nav.TP[0], 0, p[2] - nav.TP[2]).normalize(); follow = -1; flyTo(tgt.clone().add(out.multiplyScalar(40)).add(new THREE.Vector3(0, 26, 0)), tgt, 1.2); } }
      else if (x === 'plot') { closeNeed(); const pi = plots.info.find(p => p.st === 'open' && p.show); if (pi) openPlot(pi.q.pid, true); return; }
      renderNeed(true);
    });
  }

  const J = o => JSON.stringify(o);
  // trip labels over the boats / isles, and "Haul ready!" over the dock
  function expLabels() {
    const box = $('tlabels'), want = [];
    for (const v of expFx.view.trips) { const st = tripState(v.trip); want.push({ key: 't' + v.trip.id, p: v.label, html: `${IC.board}<b>${Exped.DEST[v.trip.dest].name}</b><small>${st.txt}</small>`, t: 'trip' }); }
    { const tr = S.events.active.find(e => e.type === 'trader'); if (tr) { const p = nfx.traderAt(S); want.push({ key: 'trader', p: new THREE.Vector3(p[0], p[1] + 3, p[2]), html: `${IC.cart}<b>Wandering trader</b><small>tap to trade</small>`, t: 'trader', cls: 'trd' }); } }
    if (nfx.fruit.length) { const f = nfx.fruit[0]; want.push({ key: 'fruit', p: new THREE.Vector3(f.p[0], f.p[1] + 5, f.p[2]), html: `${IC.fruit}<b>Glowing fruit!</b><small>tap to gather</small>`, t: 'fruit', cls: 'hr' }); }
    if (S.exp.hauls.length && expFx.view.dock) want.push({ key: 'haul', p: expFx.view.dock.clone().setY(expFx.view.dock.y + 14), html: `${IC.gift}<b>A sack of treasures!</b><small>tap to open</small>`, t: 'haul', cls: 'hr' });
    const have = {}; box.querySelectorAll('.tl').forEach(el => { have[el.dataset.key] = el; });
    for (const w of want) {
      let el = have[w.key]; delete have[w.key];
      if (!el) { el = document.createElement('div'); el.className = 'tl card' + (w.cls ? ' ' + w.cls : ''); el.dataset.key = w.key; el.dataset.t = w.t; box.appendChild(el); }
      if (el.dataset.h !== w.html) { el.innerHTML = w.html; el.dataset.h = w.html; }
      const s = w.p.clone().project(camera), vis = s.z < 1 && Math.abs(s.x) < 1.05 && Math.abs(s.y) < 1.05;
      el.style.display = vis ? 'flex' : 'none'; if (vis) { el.style.left = ((s.x + 1) / 2 * W()) + 'px'; el.style.top = ((1 - s.y) / 2 * H()) + 'px'; }
    }
    for (const k in have) have[k].remove();
  }

  function floater(pos3, html) {
    const v = new THREE.Vector3().fromArray(pos3).project(camera); if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
    const d = document.createElement('div'); d.className = 'flo'; d.innerHTML = html;
    d.style.left = ((v.x + 1) / 2 * W()) + 'px'; d.style.top = ((1 - v.y) / 2 * H()) + 'px'; app.appendChild(d); setTimeout(() => d.remove(), 1500);
  }
  // vibe pass 1: the return is a gift, not a ledger. The card leads with the dream (or a line in the tree's voice), then only
  // what matters (growth, new buildings / pups / hauls, visitors, critters still here); the numbers sit behind "Details" and
  // lines that would read 0 are left out. A short absence (< 10 min) with nothing notable = a tiny note or nothing.
  // Closing it plays a short camera tour of what changed (runTour; tap to skip), then the queued cards (gift, memory) follow.
  const AWAY_SHORT = 600;
  let awayStops = null;
  const plural = (n, w, ws) => `${fmtN(n)} ${n === 1 ? w : (ws || w + 's')}`;
  const anA = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  function treeLine(sum, news) {
    const a = [], bl = (sum.built || []).map(b => nav.plotBy[b.pid] ? bName(b.kind, nav.plotBy[b.pid]).toLowerCase() : null).filter(Boolean);
    if (sum.levels > 0) a.push('I grew a little taller');
    if (bl.length) a.push(bl.length === 1 ? `the pups built ${anA(bl[0])}` : `the pups built ${bl.length} new things`);
    if (news.length) a.push(news.length === 1 ? `${S.pups[news[0]].name} crossed the bridge to stay` : `${news.length} new pups came to stay`);
    if ((sum.exped || []).length) a.push('a skyboat came home full');
    const h = sum.healthTo, feel = h >= 80 ? 'I feel wonderful.' : h >= 60 ? 'I feel well.' : h >= 40 ? 'I am a little thirsty.' : 'I am tired and thirsty. Will you help them?';
    if (!a.length) return `While you were away, the pups looked after me. ${feel}`;
    const j = a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];
    return `While you were away, ${j}. ${feel}`;
  }
  function tourStops(sum, news) {
    if (!sum || sum.toured) return [];
    const st = [];
    for (const b of sum.built || []) { const x = plots.byPid[b.pid]; if (x) st.push({ p: [x.c[0], x.gy + 4, x.c[1]], r: Math.max(x.w, x.d) }); }
    for (const i of news) { const P = pups.list[i]; if (P) { const v = P.holder.position; st.push({ p: [v.x, v.y + 3, v.z], r: 8, pup: i }); } }
    if ((sum.exped || []).length && expFx.view.dock) { const d = expFx.view.dock; st.push({ p: [d.x, d.y + 4, d.z], r: 14 }); }
    // close stops merge (two cottages side by side = one look)
    const out = []; for (const s of st) if (!out.some(o => Math.hypot(o.p[0] - s.p[0], o.p[2] - s.p[2]) < 25)) out.push(s);
    return out.slice(0, 4);
  }
  const capH = () => Math.round(Sim.C.OFFLINE_CAP / 3600);
  // "14 h", or "3 days" past 3 days
  const awayLen = sec =>sec >= 72 * 3600 ? `${Math.round(sec / 86400)} days` : `${Math.round(sec / 3600)} h`;
  function showAway(sum) {
    const news = S.pups.map((p, i) => p.isNew ? i : -1).filter(i => i >= 0);
    const sh = (soc ? soc.awayHtml() : '') + (lan ? lan.awayHtml(sum) : '');   // step 6: visitors, gifts, notes; Round 2 step 4: lanterns + bloom petals
    const live = sum ? (sum.critters || []).filter(v => Critters.BY[v.c] && S.crit.vis.some(x => x.id === v.id)) : [];
    const notable = sum && (sum.dream || sum.levels > 0 || (sum.built || []).length || (sum.exped || []).length || (sum.woke || []).length || live.length || (sum.resTo && sum.resTo.food <= 0));
    if (sum && sum.sec < AWAY_SHORT && !notable && !news.length && !sh) {   // a short absence: a tiny note (or nothing at all)
      if (sum.sec >= 180 && sum.buckets + sum.orbs > 0) toast(`${IC.tree} Welcome back! The pups kept the island humming while you were gone.`, 3200);
      return;
    }
    let h = '', det = '';
    // the lead: the tree's dream after a night away (Round 2 step 2), else a line in its voice
    const dream = sum && sum.dream ? `<li class="dreamli"><div class="dreamv">${[...Array(10)].map((_, k) => `<i style="left:${(k * 37 + 7) % 96}%;top:${(k * 53 + 20) % 80 + 10}%;animation-delay:${(k * 0.67).toFixed(2)}s"></i>`).join('')}<h3>${IC.moon}The Elder Tree dreamt...</h3><p>${esc(sum.dream)}</p></div></li>` : '';
    $('away').classList.toggle('dreamy', !!dream);
    if (sum) {
      h += dream || `<li class="treeli"><div>${IC.tree}<p>${esc(treeLine(sum, news))}</p></div></li>`;
      // pacing pass (3B): a long absence says plainly how much of it the pups worked (the offline cap, 12 h)
      if (sum.capped && sum.away > sum.sec) h += `<li class="capli">${IC.clock}<div>Your pups worked <b>${capH()}${sum.away >= 72 * 3600 ? ' h' : ''}</b> of your <b>${awayLen(sum.away)}</b> away<small>They keep count for up to ${capH()} hours at a time: drop by twice a day and nothing is missed.</small></div></li>`;
      if (sum.rings && sum.rings.length) { const L = sum.rings, n = L[L.length - 1]; h += `<li class="good exl ringli">${IC.tree}<div>The Elder Tree grew ${L.length > 1 ? L.length + ' new rings' : 'a new ring'} while you were away: <b>Ring ${n}</b>. ${esc(Rings.perkText(Rings.perkOf(n)))}.<br><button class="go sm" data-ringaway="${L.join(',')}">${IC.memory} See ${L.length > 1 ? 'the rings' : 'the ring'}</button></div></li>`; if (ringFx) ringFx.celebrate(n); }
      if (sum.levels > 0) h += `<li class="good exl">${IC.star}<div>The Elder Tree grew ${sum.levels > 1 ? sum.levels + ' levels' : 'a level'}! Now level ${S.level} (<b>${Growth.stageName(S.level)}</b>).<br><button class="go sm" data-memaway="${S.level}">${IC.memory} Read its memory</button></div></li>`;
      // new buildings: one line
      const bl = (sum.built || []).map(b => { const q = nav.plotBy[b.pid]; return q ? { b, q } : null; }).filter(Boolean);
      if (bl.length) h += `<li class="good">${IC[B_ICON[bl[0].b.kind]]}<div>Newly built: ${bl.map(x => `<b>${bName(x.b.kind, x.q)}</b>`).join(', ')}</div></li>`;
      // expeditions that landed while away (the haul is in; the reveal card opens from here or the trip board)
      for (const x of sum.exped || []) {
        const k = S.exp.hauls.findIndex(y => y.id === x.id);
        h += `<li class="good exl">${IC.board}<div>The skyboat drifted home from <b>${Exped.DEST[x.dest].name}</b> (${x.names.map(esc).join(', ')}) with ${haulLine(x)}${k >= 0 ? `<br><button class="go sm" data-haul="${k}">Open the sack</button>` : ''}</div></li>`;
      }
      for (const k of sum.woke || []) h += `<li class="good">${IC[k]}<div><b>${NEED_NAMES[k]}</b> woke up, and with it a new job: <b>${JOB_WHO[k]}</b>! Tap the bar to learn more.</div></li>`;
      if (sum.resTo && sum.resTo.food <= 0) h += `<li>${IC.food}The pantry ran empty: the pups are hungry and a little slower. A berry picker or a berry patch would help.</li>`;
      // sky critters still here: go see (the rest of the visitors are in the details)
      for (const v of live.slice(-2)) { const sp = Critters.BY[v.c], st = Critters.status(S, v.c); h += `<li class="evl live">${cface(sp, st === 'seen' ? 'seen' : 'glimpsed')}<div>${esc(Critters.line(S, v, nav, (sum.nightSec || 0) >= 5400))}<br><button class="go sm" data-crit="${v.id}">Still here: go say hello!</button></div></li>`; }
      // ---- the details (folded): the numbers, only the ones that are not zero
      const g = sum.gathered || {}, ledger = [];
      if (sum.buckets >= 1) ledger.push(`${IC.water}${plural(sum.buckets, 'bucket')}`); if (sum.orbs >= 1) ledger.push(`${IC.orb}${plural(sum.orbs, 'orb')}`); if (sum.sap >= 1) ledger.push(`${IC.sap}+${fmtN(sum.sap)}`);
      det += `<li>${IC.clock}${sum.capped ? `${awayLen(sum.away)} away &middot; the pups worked the first ${fmtT(sum.sec)} (they keep count for up to ${capH()} h)` : fmtT(sum.sec)}</li>`;
      if (ledger.length) det += `<li>${ledger.join(' &middot; ')}</li>`;
      det += `<li>${IC.heart}The Elder Tree ${Math.round(sum.healthFrom)}% &rarr; <b>${Math.round(sum.healthTo)}%</b> (${healthWord(sum.healthTo)})</li>`;
      if (sum.nightSec >= 1800) det += `<li>${IC.moon}${fmtT(sum.nightSec)} of it was night: the pups took sleepy naps and the tree drank less.</li>`;
      const gl = ['wood', 'stone', 'food'].filter(k => (g[k] || 0) >= 1).map(k => `${IC[k]}+${fmtN(g[k])}`);
      if (gl.length) det += `<li>${gl.join(' ')} gathered</li>`;
      for (const x of bl) det += `<li>${IC[B_ICON[x.b.kind]]}<div><b>${bName(x.b.kind, x.q)}</b>: ${gives(x.b.kind, x.q)}</div></li>`;
      for (const tr of S.exp.trips) if (tr.dep >= 0) det += `<li>${IC.isle}<span>The <b>${Exped.DEST[tr.dest].name}</b> crew is still ${Exped.DEST[tr.dest].voy ? 'out on its voyage' : 'exploring'}: home in ${fmtT(Math.max(0, tr.dep + tr.dur - S.time))}.</span></li>`;
      if (sum.elderTo) { const a = sum.elderFrom, b = sum.elderTo; det += `<li>${IC.tree}<span>Elder ring ${b.n + 1}: ${a && a.n === b.n ? Math.round(a.f * 100) + '% &rarr; ' : ''}<b>${Math.round(b.f * 100)}%</b> (+${fmtN(sum.xp)} growth)</span></li>`; }
      if (sum.fed) det += `<li>${IC.nourish}Root gardeners fed the roots ${plural(sum.fed, 'time')}</li>`;
      if (sum.cleared || sum.blightNew) det += `<li>${IC.blight}${sum.blightNew ? `${sum.blightNew} blight patch${sum.blightNew > 1 ? 'es' : ''} crept in` : ''}${sum.blightNew && sum.cleared ? ', ' : ''}${sum.cleared ? `wardens swept away ${sum.cleared}` : ''}</li>`;
      const evs = (sum.events || []).map(id => S.events.log.find(l => l.id === id)).filter(Boolean);
      if (evs.length) {
        det += `<li class="hd">${IC.bell}<b>${evs.length} little happening${evs.length > 1 ? 's' : ''}</b></li>`;
        for (const l of evs.slice(-6)) { const lv = S.events.active.find(a => a.id === l.id), x = evText(lv || l, !!lv); det += `<li class="evl${lv ? ' live' : ''}">${IC[EV_IC[l.type]]}<div>${x.t}${x.s ? `<small>${x.s}${lv ? ' &middot; <b>still here!</b>' : ''}</small>` : ''}</div></li>`; }
        if (evs.length > 6) det += `<li class="evl"><small>... and ${evs.length - 6} earlier (see Today)</small></li>`;
      }
      // Round 2 step 3: sky critters who visited, in the tree's voice
      const cv = (sum.critters || []).filter(v => Critters.BY[v.c] && !live.includes(v));
      if (cv.length) {
        const slept = (sum.nightSec || 0) >= 5400, gifts = (sum.critGifts || []).map(v => Critters.BY[v.c]).filter(Boolean);
        det += `<li class="hd">${IC.critter}<b>${cv.length === 1 ? 'A visitor came by' : cv.length + ' visitors came by'}</b></li>`;
        for (const v of cv.slice(-5)) { const sp = Critters.BY[v.c], st = Critters.status(S, v.c); det += `<li class="evl">${cface(sp, st === 'seen' ? 'seen' : 'glimpsed')}<div>${esc(Critters.line(S, v, nav, slept))}</div></li>`; }
        if (cv.length > 5) det += `<li class="evl"><small>... and ${cv.length - 5} more (the Book's Sky critters page)</small></li>`;
        if (gifts.length) det += `<li class="good">${IC.gift}<div>They left little gifts: ${gifts.slice(0, 4).map(sp => esc(sp.gift.name)).join(', ')}${gifts.length > 4 ? ' and more' : ''}.</div></li>`;
      }
    }
    if (news.length) {
      h += `<li class="hd">${IC.paw}<b>${news.length === 1 ? 'A new pup moved in!' : news.length + ' new pups moved in!'}</b></li>`;
      for (const i of news) {
        const p = S.pups[i];
        h += `<li class="np" data-i="${i}"><span class="dot" style="background:${p.collar}"></span><div><input data-i="${i}" maxlength="14" value="${esc(p.name)}" aria-label="Name"><small>${p.parents ? `${IC.paw}a puppy of ${p.parents.map(k => esc(S.pups[k] ? S.pups[k].name : '?')).join(' &amp; ')} &middot; ` : ''}${breedName(p.breed)} &middot; ${traitChip(i)} &middot; loves ${IC[p.like] || ''}${JOB_NAMES[p.like]} &middot; dislikes ${IC[p.dislike] || ''}${JOB_NAMES[p.dislike]}</small><div class="jobs">${jobBtns(p)}</div></div></li>`;
      }
    }
    h += sh;
    if (det) h += `<li class="awdbtn"><button class="ghost" data-awdet="1">The numbers &#9662;</button></li><li class="awdw"><ul class="awdet" hidden>${det}</ul></li>`;
    if (!h) return;
    $('awayTitle').textContent = sum || (sh && !news.length) ? (document.body.classList.contains('phone') ? 'While you were away' : 'While you were away · the island kept your lanterns lit') : 'Welcome, newcomer!';   // (the long one wraps to 3 lines on a 375 px phone)
    $('awayList').innerHTML = h; $('away').hidden = false;
    awayStops = sum ? tourStops(sum, news) : null; if (sum && awayStops && awayStops.length) sum.toured = true;
  }
  // ---- vibe pass 1: the return tour = a slow glide over what changed (new buildings, newcomers, the dock), then home.
  // A tap anywhere skips it. Cards, toasts, the tree's words and a colour wave wait for it.
  let tour = null;
  function runTour(stops) {
    if (!stops || !stops.length || VISIT) return;
    tour = { stops, k: -1, timer: 0 }; follow = -1; pups.select(-1); if (calm && !calm.pinned) calm.fold(true);
    $('tourChip').hidden = false; nextStop();
  }
  function nextStop() {
    if (!tour) return; tour.k++;
    if (tour.k >= tour.stops.length) { endTour(false); return; }
    const s = tour.stops[tour.k], tgt = new THREE.Vector3(s.p[0], s.p[1], s.p[2]), TP = nav.TP;
    const out = new THREE.Vector3(s.p[0] - TP[0], 0, s.p[2] - TP[2]); if (out.lengthSq() < 1) out.set(0, 0, 1); out.normalize();
    const d = Math.max(42, s.r * 3.2) * (W() < H() ? 1.35 : 1), eye = tgt.clone().addScaledVector(out, d).add(new THREE.Vector3(0, d * 0.55, 0));
    flyTo(eye, tgt, tour.k ? 2.2 : 1.8, () => { if (tour) tour.timer = setTimeout(nextStop, 1700); });
  }
  function endTour(skip) {
    if (!tour) return; clearTimeout(tour.timer); tour = null; $('tourChip').hidden = true;
    if (skip) setTimeout(() => { flyHome(); tween.dur = 0.9; }, 0);   // after OrbitControls' own pointerdown (it clears tweens)
    else flyHome();
  }
  addEventListener('pointerdown', () => { if (tour) endTour(true); }, true);
  addEventListener('keydown', () => { if (tour) endTour(true); }, true);
  // ---- playtest fixes: Esc closes the topmost card (a big card first, then the newest), then the tree's words, then lets go of
  // a followed pup. Place / land / tour-stop / photo modes keep their own Esc (this runs first and steps aside for them); in a
  // text field Esc only leaves the field.
  addEventListener('keydown', e => {
    if (e.code !== 'Escape' || !booted) return;
    const tg = e.target; if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) { tg.blur(); return; }
    if (PM || LM || TPM || PHOTO || tour) return;
    const c = topCard(); if (c) { closeCard(c); e.preventDefault(); return; }
    if (sayOpen) { closeSay(); e.preventDefault(); return; }
    if (!VISIT && (follow >= 0 || pups.selected >= 0)) { focusPup(-1); e.preventDefault(); }
  }, true);
  // hotkeys for the top buttons (shown in their tooltips); never while typing, with a modifier, in a tool mode, or on a visit
  // (WASD walks Schiffy there). G is the grid snap and C "same turn" only inside place mode, which this steps aside for.
  const HOTKEYS = { KeyG: 'giftBtn', KeyK: 'expBtn', KeyC: 'craftBtn', KeyT: 'evBtn', KeyB: 'bookBtn', KeyV: 'socBtn', KeyL: 'lanBtn', KeyP: 'buildBtn', KeyH: 'camTree' };
  addEventListener('keydown', e => {
    if (!booted || VISIT || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || PM || LM || TPM || PHOTO) return;
    const tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    const id = HOTKEYS[e.code], b = id && $(id); if (!b || b.hidden || !b.getClientRects().length || b.disabled) return;
    e.preventDefault(); b.click();
  });
  function hotkeyTips() {   // "Craft (C)" in each button's tooltip (the lantern button is made by lantern_ui after boot)
    for (const [k, id] of Object.entries(HOTKEYS)) { const b = $(id); if (!b || b.dataset.hk) continue; b.dataset.hk = 1; b.title = (b.title || b.textContent.trim()) + ` (${k.slice(3)})`; }
  }
  let hintShown = false;
  function hintDone() { if (hintShown) { hintShown = false; $('hint').style.opacity = 0; setTimeout(() => $('hint').hidden = true, 700); } }

  // ---- camera: orbit the tree, fly to / follow a pup, glance at the tree on level-up
  let follow = -1, tween = null;
  const v3 = new THREE.Vector3();
  const PORTRAIT = { aim: 60, up0: 14, up: 22, far: 2.1 };   // vibe pass 2: portrait home view (tests: __game.PORTRAIT, then flyHome())
  function homeView() {
    // tree growth: s = the scale the old (uniformly scaled) tree of the GROWN tree's height would have, so the frame follows the
    // real shape (a slim sapling is shorter, the Elder ~1.3x taller); ^0.5 = half way, so the bigger Elder also FILLS more of the view
    const s0 = fx ? fx.scale : Sim.scaleOf(S), sz = fx && fx.size ? fx.size(TreeFx.growthOf(S), Sim.scaleOf(S)) : null, s = sz ? s0 * Math.pow(sz.h / (156 * s0), 0.5) : s0;
    const TP = nav.TP, k = 0.78 + s * 0.8 + Math.max(0, s - 0.68) * 1.9;
    // step 5: from the Grown stage on the canopy reaches out over the plaza: the camera steps further back (L1-3 unchanged)
    // vibe pass 2: a portrait phone used to see the trunk + half a crown (crown cut off, little island): further back, lower, aimed
    // higher, so the whole tree stands as a silhouette with land round it
    // (blended in by the aspect: a near-square portrait window keeps the old x1.3 view, a phone (aspect <= .46) gets all of it)
    const asp = W() / Math.max(1, H()), p = asp >= 1 ? -1 : Math.max(0, Math.min(1, (0.75 - asp) / 0.29)), L = (a, b) => a + (b - a) * Math.max(0, p);
    const t = new THREE.Vector3(TP[0], TP[1] + L(48, PORTRAIT.aim) * s, TP[2]);   // tree growth: aimed higher (34 -> 48) so the taller crown fits
    return { target: t, eye: t.clone().add(new THREE.Vector3(70, L(34 + 30 * s, PORTRAIT.up0 + PORTRAIT.up * s), 140).multiplyScalar(k * (p < 0 ? 1 : L(1.3, PORTRAIT.far)))) };
  }
  function flyTo(eye, target, dur, then) { tween = { e0: camera.position.clone(), t0: controls.target.clone(), e1: eye.clone(), t1: target.clone(), t: 0, dur: dur || 1.2, then }; }
  function flyHome() { const h = homeView(); flyTo(h.eye, h.target, 1.4); }
  const fdy = () => wardI >= 0 ? 0.6 : 4;   // the followed pup's aim height (the wardrobe card covers the lower screen: aim below it)
  function focusPup(i, near) {   // near = camera distance (the wardrobe comes close), else 28-55 m
    if (VISIT) { const p = S.pups[i]; if (p) toast(`<span class="dot" style="background:${p.collar}"></span> <b>${esc(p.name)}</b> &middot; ${breedName(p.breed)} &middot; ${IC[p.job] || ''}${JOB_NAMES[p.job] || ''}`, 2200); pups.select(i); return; }
    follow = i; pups.select(i); refreshRoster(true);
    if (i < 0) { closeWard(); return; }
    if (wardI >= 0 && i !== wardI) closeWard();   // another pup picked on the island / roster: the wardrobe was for the old one
    const p = pups.list[i].holder.position, tgt = p.clone().setY(p.y + fdy());
    if (near) { const yw = pups.list[i].yaw + 0.55; flyTo(tgt.clone().add(new THREE.Vector3(Math.sin(yw), 0.42, Math.cos(yw)).setLength(near)), tgt, 1.0); return; }   // the wardrobe: a 3/4 front view
    const dir = camera.position.clone().sub(controls.target); const d = Math.min(Math.max(dir.length(), 28), 55);
    dir.setLength(d); if (dir.y < d * 0.35) dir.y = d * 0.35;
    flyTo(tgt.clone().add(dir.setLength(d)), tgt, 1.0);
  }
  controls.addEventListener('start', () => { tween = null; boatCam = null; });
  function cameraTick(dt) {
    if (boatCam) boatCamTick(dt);
    else if (tween) {
      tween.t += dt; const k = Math.min(1, tween.t / tween.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      let t1 = tween.t1; if (follow >= 0 && !tween.then) t1 = pups.list[follow].holder.position.clone().setY(pups.list[follow].holder.position.y + fdy());
      const off1 = tween.e1.clone().sub(tween.t1);
      controls.target.lerpVectors(tween.t0, t1, e); camera.position.lerpVectors(tween.e0, t1.clone().add(off1), e);
      if (k >= 1) { const th = tween.then; tween = null; if (th) th(); }
    } else if (follow >= 0 && pups.list[follow]) {
      const p = pups.list[follow].holder.position; v3.set(p.x, p.y + fdy(), p.z).sub(controls.target).multiplyScalar(Math.min(1, dt * 5));
      controls.target.add(v3); camera.position.add(v3);
      if (wardI === follow) { const yw = pups.list[follow].yaw + 0.55; v3.set(Math.sin(yw), 0.42, Math.cos(yw)).setLength(WARD_D).add(controls.target); camera.position.lerp(v3, Math.min(1, dt * 1.6)); }   // wardrobe: keep a 3/4 front view while the pup turns
    } else if (drift) drift.update(dt);   // vibe 2 lane C: the idle camera (starts by itself after ~20 s without input)
    if (!boatCam) keepOutOfTree(dt);
  }
  // playtest fixes (M3): the camera never goes inside the trunk or the root flare, at any growth stage. The wood's radius at a
  // height comes from the GROWN tree (TreeFx params: trunk core CORE 22 m x kT..kB by height, roots out to nav.trunkR at the
  // foot), + a margin; the camera is eased out along the radius (fast, never a snap). Above the crown top it is free.
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function trunkKeep(y, x, z) {
    if (!fx || !nav) return 0;
    if (fx.woodR && x !== undefined) { const r = fx.woodR(x, y, z); return r ? r + 3 : 0; }   // the grown model's own wood (tree_fx), 3 m clear
    const s = fx.scale, P = fx.params ? fx.params() : null, TP = nav.TP, yp = (y - TP[1]) / s;
    const top = fx.size ? fx.size().h / s : 156; if (yp > top * 0.8) return 0;
    const kTy = P ? P.kB + (P.kT - P.kB) * smooth(6, 34, yp) : 1, core = 22 * kTy * s;
    return Math.max(core * 1.15, nav.trunkR(s) * (1 - smooth(2, 22, yp))) + 3.5;
  }
  // Once the camera would enter, it is taken over in polar coordinates round the trunk axis (angle, radius, height) and eased
  // toward where it wants to be: a fly that would pass THROUGH the tree swings round it instead (the angle turns at most KEEP.W
  // rad/s), a follow camera slides along the bark; it lets go once the wanted spot is outside again and it has caught up.
  const KEEP = { W: 2.4, V: 45, K: 6 };
  let KO = null, KW = null;   // KW = where a fly wanted to end (it ends while the camera is still swinging round: keep heading there)
  controls.addEventListener('start', () => { KW = null; });
  function keepOutOfTree(dt) {
    const TP = nav.TP, c = camera.position;
    if (tween) KW = c.clone(); else if (KO && KW && follow < 0) c.copy(KW); else KW = null;
    const keepAt = (a, y) => trunkKeep(y, TP[0] + Math.cos(a) * 5, TP[2] + Math.sin(a) * 5);
    const ry = c.y, ra = Math.atan2(c.z - TP[2], c.x - TP[0]), rr = Math.hypot(c.x - TP[0], c.z - TP[2]), Rw = keepAt(ra, c.y), out = !Rw || rr >= Rw;
    if (!KO) { if (out) { KW = null; return; } KO = { a: ra, r: rr, y: c.y }; }
    let da = ra - KO.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const k = Math.min(1, Math.min(dt, 0.05) * KEEP.K), w = Math.min(KEEP.W, KEEP.V / Math.max(1, KO.r)) * Math.min(dt, 0.05), ka = Math.max(-w, Math.min(w, da * k));   // (at most V m/s round the trunk; a hitch frame counts as 50 ms)
    KO.a += ka; KO.y += (ry - KO.y) * k; KO.r += (rr - KO.r) * k;
    const R = keepAt(KO.a, KO.y); if (R && KO.r < R) KO.r = Math.max(KO.r + (R - KO.r) * Math.min(1, dt * 9), R - 1.5);   // eased out, never more than 1.5 m into the 3 m margin (= never in the wood)
    c.set(TP[0] + Math.cos(KO.a) * KO.r, KO.y, TP[2] + Math.sin(KO.a) * KO.r);
    if (out && Math.abs(da - ka) < 0.01 && Math.abs(rr - KO.r) < 0.3 && Math.abs(ry - KO.y) < 0.3) KO = null;
  }
  // vibe 2 lane C: what the idle camera may drift to now ({id, w weight (>= 9 cuts in), r frame radius m, el, hold s, pos()})
  function driftSubjects() {
    const L = [], TP = nav.TP, cp = fx.canopy();
    if (sayOpen || (voice && voice.live)) L.push({ id: 'tree-say', w: 10, r: cp.r * 1.15, el: 0.2, hold: 30, pos: () => { const c = fx.canopy(); return [TP[0], TP[1] + (c.y0 - TP[1]) * 0.75, TP[2]]; } });
    if (RST.wave) L.push({ id: 'wave', w: 9, r: Math.min(560, Story.radius(S).R) / 3, el: 0.55, hold: 14, pos: () => [TP[0], TP[1] + 20, TP[2]] });
    if (lfx && lfx.relPos && lfx.relPos()) L.push({ id: 'lantern', w: 9, r: 22, el: 0.12, hold: 14, pos: () => lfx.relPos && lfx.relPos() });
    if (crFx && S.crit) for (const v of S.crit.vis) { const p = crFx.posOf(v.id); if (!p) continue; const id = v.id;
      L.push(v.c === 'whale' ? { id: 'crit' + id, w: 6, r: 90, el: 0.1, hold: 20, pos: () => crFx.posOf(id) } : { id: 'crit' + id, w: 4, r: Math.max(6, (crFx.sizeOf(id) || 3) * 1.6), hold: 22, pos: () => crFx.posOf(id) }); }
    if (life) { const tg = controls.target, M = [];
      life.st.forEach((s, i) => { if (s.m === 'do' && s.v && pups.list[i] && !S.pups[i].exp) M.push([i, pups.list[i].holder.position.distanceTo(tg), s.v.k]); });
      M.sort((a, b) => a[1] - b[1]).slice(0, 6).forEach(([i, , k]) => L.push({ id: 'pup' + i, w: 2.5, r: k === 'snow' || k === 'tag' || k === 'nap2' ? 12 : 7, hold: 20, pos: () => { const h = pups.list[i] && pups.list[i].holder.position; return h ? [h.x, h.y + 2.5, h.z] : null; } })); }
    { const h = homeView(), d = h.eye.distanceTo(h.target); L.push({ id: 'home', w: L.length ? 1.5 : 3, r: d / 4.2, el: Math.asin((h.eye.y - h.target.y) / d), hold: 26, spin: 0.02, pos: () => homeView().target.toArray() }); }
    return L;
  }
  function levelUp(lv) {
    const newStage = Growth.STAGES.some(st => st.from === lv); snd.sfx('sting_level');
    toast(`${IC.star} The Elder Tree grows! <b>Level ${lv}</b>${newStage ? ` &middot; it becomes a <b>${Growth.stageName(lv)}</b> tree` : ''}`, 4200);
    const back = { e: camera.position.clone(), t: controls.target.clone() }, wasFollow = follow;
    const s = Sim.C.SCALE[lv - 1], TP = nav.TP, sz = fx.size(TreeFx.growthOf(S), s);   // framed for the GROWN tree (it grows while we watch)
    const tgt = new THREE.Vector3(TP[0], TP[1] + Math.max(45 * s, sz.h * 0.42), TP[2]);
    const far = Math.max(230 * s + 80, sz.h * 1.6 + 40) * (W() < H() ? 1.25 : 1);
    const eye = tgt.clone().add(camera.position.clone().sub(controls.target).setY(0).setLength(far)).setY(TP[1] + Math.max(60 * s + 30, sz.h * 0.5 + 20));
    follow = -1; fx.holdT = 1.2;   // the growth moment (tree_fx tick) starts as the camera arrives and plays ~3.6 s
    flyTo(eye, tgt, 1.3, () => { fx.burst(); setTimeout(() => { if (!tween) { follow = wasFollow; if (wasFollow < 0) flyTo(back.e, back.t, 1.3, () => {}); else focusPup(wasFollow); } queueCard('mem' + lv, () => showMemory(lv)); }, 4200); });
    growLand(lv); refreshBuild(true);
  }
  // click a pup (screen-space nearest, so small pups are easy to hit) or a plot (patch / sign)
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, performance.now()]; });
  // free decor place mode: a touch that starts on the ghost slides it (the camera stays put); runs before OrbitControls sees it
  const canvasXY = e => { const r = renderer.domElement.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pmTouches = new Set();
  addEventListener('pointerdown', e => {
    if (!PM || e.target !== renderer.domElement) return;
    if (e.pointerType !== 'mouse') pmTouches.add(e.pointerId);
    if (e.pointerType === 'mouse' || pmTouches.size > 1) { if (PM.drag) { PM.drag = false; controls.enabled = true; } return; }
    const [mx, my] = canvasXY(e), v = new THREE.Vector3(PM.x, ground(PM.x, PM.z, nav.TP[1]) + 1.5, PM.z).project(camera);
    if (Math.hypot((v.x + 1) / 2 * W() - mx, (1 - v.y) / 2 * H() - my) < 70) { PM.drag = true; controls.enabled = false; }
  }, true);
  addEventListener('pointerup', e => { pmTouches.delete(e.pointerId); if (PM && PM.drag) { PM.drag = false; controls.enabled = true; } }, true);
  addEventListener('pointercancel', e => { pmTouches.delete(e.pointerId); if (PM && PM.drag) { PM.drag = false; controls.enabled = true; } }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (!PM || (e.pointerType === 'mouse' ? e.buttons : !PM.drag)) return;   // a mouse drag orbits the camera; a touch drag on the ghost slides it
    const [mx, my] = canvasXY(e), g = pickGround(mx, my); if (g) pmMove(g[0], g[2]);
  });
  // land mode (creative build part 2): the path brush paints with the left button / one finger (the camera stays put; right
  // drag / two fingers move it); the other tools follow the mouse, a tap moves the preview (phone: "Here" confirms)
  const lmTouches = new Set();
  const lmCancelStroke = () => { if (!LM || !LM.paint) return; LM.paint = false; LM.raw = null; controls.enabled = true; if (landFx) landFx.stroke(null); lmShow(); };
  addEventListener('pointerdown', e => {
    if (!LM || e.target !== renderer.domElement) return;
    if (e.pointerType !== 'mouse') lmTouches.add(e.pointerId);
    if (LM.tool !== 'path') return;
    if ((e.pointerType === 'mouse' && e.button !== 0) || lmTouches.size > 1) { lmCancelStroke(); return; }
    const [mx, my] = canvasXY(e), g = pickGround(mx, my); if (!g) return;
    LM.paint = true; LM.failed = false; LM.pid = e.pointerId; LM.raw = []; controls.enabled = false; lmStroke(g[0], g[2], false);
  }, true);
  addEventListener('pointerup', e => { lmTouches.delete(e.pointerId); if (LM && LM.paint && e.pointerId === LM.pid) { const [mx, my] = canvasXY(e), g = e.target === renderer.domElement ? pickGround(mx, my) : null; lmStroke(g ? g[0] : null, g ? g[2] : null, true); } }, true);
  addEventListener('pointercancel', e => { lmTouches.delete(e.pointerId); lmCancelStroke(); }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (!LM) return; const [mx, my] = canvasXY(e);
    if (LM.paint) { if (e.pointerId === LM.pid) { const g = pickGround(mx, my); if (g) lmStroke(g[0], g[2], false); } return; }
    if (e.pointerType === 'mouse' && !e.buttons && LM.tool !== 'path' && performance.now() - LM.t > 40) { const g = pickGround(mx, my); if (g) lmHover(g[0], g[2]); }
  });
  addEventListener('keydown', e => {
    if (!LM || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if (e.code === 'Escape') { endLand(); snd.sfx('close'); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') lmUndo();
    else if (/^Digit[1-4]$/.test(e.code)) lmTool(['path', 'meadow', 'plant', 'remove'][+e.code.slice(5) - 1]);
    else if (e.code === 'Enter') lmConfirm();
    else return;
    e.preventDefault();
  });
  addEventListener('keydown', e => {
    if (!PM || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if (e.code === 'KeyQ') pmTurn(-1, e.shiftKey); else if (e.code === 'KeyE' || e.code === 'KeyR') pmTurn(1, e.shiftKey);
    else if (e.code === 'KeyG') pmSnap(); else if (e.code === 'KeyC') pmCopy();
    else if (e.code === 'Escape') { endPlace(); snd.sfx('close'); } else if (e.code === 'Enter') pmConfirm(); else return;
    e.preventDefault();
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || !pups) return;
    if (calm && calm.woke(down[2]) && !PM && !LM && !TPM) { down = null; return; }   // vibe pass 1: a tap that only woke the calm HUD
    down = null;
    const r = renderer.domElement.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (TPM) { tourPickAt(mx, my); return; }   // piece 5: tour mode picks a stop
    if (PM) { const g = pickGround(mx, my); if (g) { pmMove(g[0], g[2]); if (e.pointerType === 'mouse') pmConfirm(); } return; }   // place mode: a click puts it down, a tap moves the ghost there
    if (LM) { if (LM.tool !== 'path') { const g = pickGround(mx, my); if (g) { lmHover(g[0], g[2]); if (e.pointerType === 'mouse') lmConfirm(); } } return; }   // land mode: the same
    if (DM !== null) closeDecMenu();
    const fr = nfx && nfx.pickFruit(mx, my, camera, W(), H(), PHONE ? 44 : 32); if (fr) { collectFruit(fr); return; }   // glowing fruit first (events)
    const lp = lfx && lfx.pick(mx, my, camera, W(), H(), PHONE ? 44 : 34); if (lp && lan) { if (lp === 'bloom') lan.open('bloom'); else lan.openRead(lp, false); return; }   // a sky lantern / the World Bloom
    const cr = crFx && crFx.pick(mx, my, camera, W(), H(), PHONE ? 48 : 38); if (cr !== null && cr !== undefined) { meetCritter(cr, false); return; }   // then a sky critter
    let best = -1, bd = PHONE ? 46 : 36;
    pups.list.forEach((P, i) => {
      for (const hgt of [1, 2.2, 4]) {
        const v = P.holder.position.clone().setY(P.holder.position.y + hgt).project(camera); if (v.z > 1) continue;
        const d = Math.hypot((v.x + 1) / 2 * W() - mx, (1 - v.y) / 2 * H() - my); if (d < bd) { bd = d; best = i; }
      }
    });
    if (best >= 0) { focusPup(best); return; }
    if (!VISIT && S.placed.length) { const dk = pickDecor(mx, my); if (dk !== null) { openDecMenu(dk); return; } }   // free decor: a placed decoration
    if (VISIT) { if (walker) { const gp = walker.pickGround(mx, my, W(), H()); if (gp) walker.walkTo(gp, nav.trunkR(fx.scale)); } return; }   // tap / click = walk there
    const x = plots.pick(mx, my, camera, W(), H(), PHONE ? 44 : 34);
    if (x) openPlot(x.q.pid, false);
    // playtest fixes: on a PC a click on EMPTY world (nothing above picked it: fruit, lantern, critter, pup, decoration, plot)
    // closes the open side card / menu. Taps on a phone don't (a sheet covers half the screen; a stray tap would lose it).
    else if (e.pointerType === 'mouse') for (const c of openCards(['side', 'menu'])) closeCard(c);
  });

  // ---- boot
  const t0 = performance.now();
  ElderMap.load({ base: LIB, scene, lite: PHONE }).then(async m => {
    map = m; window.__map = m;
    if (PHONE) m.cull.px = 1.5;
    if (PHONE) m.batches.forEach(b => { if (b.inkMesh) b.inkMesh.material.visible = false; });
    const c = m.box.getCenter(new THREE.Vector3()), r = m.box.getSize(new THREE.Vector3()).length() / 2;
    scene.fog.near = r * 1.4; scene.fog.far = r * 4.5; camera.far = r * 8; camera.updateProjectionMatrix();
    const sc = sun.shadow.camera, s = Math.min(r, 450); Object.assign(sc, { left: -s, right: s, top: s, bottom: -s, far: r * 4 });
    sun.position.copy(c).add(new THREE.Vector3(-0.5, 1, 0.35).multiplyScalar(r * 1.2)); sun.target.position.copy(c); scene.add(sun.target); sc.updateProjectionMatrix();
    startIsland(m);
    // the water mask is data (data/water_cells.json, the same file tools/sim_check.mjs reads), so the decor / blight /
    // ward spot lists (saves store indices into them) are identical in the game and in the sim check
    const water = await fetch('data/water_cells.json').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!water) console.warn('data/water_cells.json missing: spot lists ignore water');
    if (water && water.runs) { const cs = water.cell || 3; sndWater = water.runs.map(([i, j0, j1]) => [i * cs + cs / 2, j0 * cs, (j1 + 1) * cs]); }   // sound: river near the camera
    nav = Nav(m.layout, { water }); ground = buildGround(m);
    const clr = treeClear(m, nav); if (clr) nav.setClear(clr);
    if (PHONE) m.cull.coverK = 0.7;
    // step 6: social (Explore, publishing, gifts, visits) through one backend interface (src/net.js: mock or Supabase)
    soc = SocialUI({ Q, SLOT, SAVE_KEY, IC, esc, toast, nav, net: NET, mode: VISIT ? 'visit' : 'home', get S() { return S; }, save, showAway: s => showAway(s || null), lastSum: () => bootSum,
      touch: () => { if (cloud) cloud.touch(); }, openSafe: v => { if (cloudUI) cloudUI.openSafe(v); }, cloudStatus: () => cloudUI ? cloudUI.statusHtml() : '',
      refresh: () => { refreshTree(); refreshBuild(true); },
      onVisitors: names => { if (!VISIT && S && Story.visit(S, names[0] || '')) save(); },   // Round 2 step 2: the tree notices a friend's visit
      onWater: () => { snd.sfx('water'); S.needs.water = Math.min(100, S.needs.water + Social.C.W_HOST.water); const d = nav.door(fx.scale).p; fx.splash(d[0], d[1], d[2]); floater([d[0], d[1] + 12, d[2]], `+${IC.water}`); hs = S.health = Sim.healthOf(S); },
      onGift: () => { snd.sfx('gift'); const p = walker ? walker.pos() : nav.door(fx.scale).p; floater([p[0], p[1] + 9, p[2]], IC.gift); },
      onLike: () => { snd.sfx('like'); const p = walker ? walker.pos() : nav.door(fx.scale).p; floater([p[0], p[1] + 9, p[2]], IC.heart); },
      // creative build piece 5: the beautiful star, the guided tour (home: mark stops; visit: take it)
      onStar: () => { snd.sfx('like'); const p = walker ? walker.pos() : nav.door(fx.scale).p; floater([p[0], p[1] + 9, p[2]], '&#11088;'); },
      stopName, tourPick: (tgt, show) => startTourPick(tgt, show), startGuide: () => startGuide() });
    let ld;
    if (VISIT) {
      const vs = await soc.visitLoad(VISIT);
      if (!vs) { $('loading').innerHTML = `<div class="card">That island has drifted out of sight (it may be private now). <a href="${soc.homeUrl()}">Back home</a></div>`; return; }
      ld = { state: vs, away: 0, visit: true };
    } else {
      const cb = await cloudBoot;   // <= Cloud.C.BOOT_WAIT; a newer cloud copy is already in SAVE_KEY: the normal load / migrate / catch-up runs on it
      ld = load(); ld.cloud = cb;
    }
    S = ld.state;
    fx = TreeFx(scene, m, nav); fx.setScale(Sim.scaleOf(S), TreeFx.growthOf(S));
    if (window.RingFx) ringFx = RingFx(scene, fx, nav);   // update 3: Elder rings round the trunk (view only)
    plots = Plots(scene, m, nav, ground);
    expFx = ExpFx(scene, m, nav, ground, { phone: PHONE, focus: () => controls.target });   // (phones: nearest 180 decorations to the orbit target)
    const loader = new THREE.GLTFLoader();
    pups = Pups(scene); await pups.load('art/pups.glb', loader);
    nfx = NeedsFx(scene, m, nav, ground, pups, { phone: PHONE, target: () => controls.target });
    seaFx = SeasonFx(scene, m, nav, ground, { phone: PHONE });
    // vibe pass 2: a living world (flowers, benches, cottage life, puddles, butterflies + sleeping curiosities the colour wakes)
    wfx = WorldFx(scene, m, nav, ground, plots, { phone: PHONE, onWake: c => curioWoke(c) });
    // creative build part 2: shaping the land (painted paths, removed + planted trees, meadows; home + visits)
    if (window.LandFx) landFx = LandFx(scene, m, nav, ground, { phone: PHONE, flowerKit: () => wfx && wfx.flowerKit ? wfx.flowerKit() : null });
    // vibe pass 2 lane B: pup life (visual only): moments while pups rest, reactions to critters + lanterns, chatter bubbles
    if (window.PupLife) life = PupLife(scene, nav, ground, { phone: PHONE, map: m, wfx, plots, pups, crFx: () => crFx, lfx: () => lfx, scale: () => fx.scale,
      quiet: () => !booted || overlayOpen() || sayOpen || !!tour || !!boatCam || CQ.length > 0 || !!tween || newbie() });   // (playtest fixes: no chatter during a brand-new island's first minutes)
    // pathing pass: drawn pups make room for each other + lane A's props (view only, src/steer.js)
    if (window.PupSteer) steer = PupSteer(nav, { wfx });
    // Round 2 step 3: sky critters (the library's elderglow_critters.glb; loads in the background, never blocks the boot)
    crFx = CritterFx(scene, m, nav, ground, { phone: PHONE, scale: () => fx.scale, H: () => renderer.domElement.height });
    crFx.load(LIB + 'elderglow_critters.glb', loader).catch(e => console.warn('critters not loaded:', e));
    if (!VISIT) lfx = LanternFx(scene, nav, { phone: PHONE, scale: () => fx.scale });   // Round 2 step 4: sky lanterns + the World Bloom on the horizon
    { const g0 = plots.glowPieces; plots.glowPieces = fn => { g0(fn); expFx.glowPieces(fn); nfx.glowPieces(fn); seaFx.glowPieces(fn); wfx.glowPieces(fn); }; }   // placed decor + wards + autumn lanterns glow at night too
    buildUI(); buildExpUI(); buildNeedUI();
    let sum = null;
    // anchor the island clock so that it reads "now" once the catch-up has run (the catch-up then lives through the
    // real hours, night included); a fresh island just starts at "now"
    if (!VISIT) RST.R = Story.radius(S).R;   // Round 2 step 2: the colour as it was when the player left (a new ring then waves in)
    if (ld.away > 5) { anchorClock(Math.min(ld.away, Sim.C.OFFLINE_CAP)); sum = Sim.catchUp(S, ld.away, nav); fx.setScale(Sim.scaleOf(S), TreeFx.growthOf(S)); }
    else anchorClock(0);
    // vibe pass 1: a visited island's pups all start on the nap grid by the door and used to leave in one conga line:
    // let its (read-only, never saved) copy live 1.5-4 min first so everyone is already out at their jobs
    // (a fresh island: its six start pups get a 75 s head start the same way, before the clock is anchored)
    if (VISIT || ld.fresh) { const ev0 = [], n = Math.round((VISIT ? 90 + (VISIT.length * 31 + VISIT.charCodeAt(0)) % 150 : 75) / Sim.C.STEP), xp = S.xp, lv = S.level;
      for (let k = 0; k < n; k++) Sim.step(S, Sim.C.STEP, nav, ev0); if (VISIT) { S.xp = xp; S.level = lv; S.health = Sim.healthOf(S); } else anchorClock(0); }
    if (!VISIT) { awayDream(sum, ld.away); Story.openDay(S, Daily.dayNum(new Date())); }
    dn = DayNight({ scene, renderer, camera, controls, hemi, sun, center: c, lightR: r * 1.2, map: m, nav, ground, plots, phone: PHONE, door: () => nav.door(fx.scale).p });
    if (window.LightFx) lightFx = LightFx(scene, m, nav, ground, { phone: PHONE, water: sndWater, camera });   // vibe 2 lane C: wind, cloud shadows, plaza warmth, god rays, dawn mist
    if (window.WeatherFx) { wxFx = WeatherFx(scene, m, nav, ground, { phone: PHONE }); wxUI = WeatherFx.chip({ $, toast, busy: () => !beatOk() }); CardFn.wxCard = () => wxUI && wxUI.close(); }   // seasons + weather pass
    growLand(S.level); fx.level = S.level;
    if (!ld.fresh && !VISIT && S.book.read < S.level) setTimeout(() => toast(`${IC.book} The Elder Tree kept ${S.level - S.book.read} new memor${S.level - S.book.read > 1 ? 'ies' : 'y'} for you. <u>Open the Book</u>`, 9000, () => openBook('mem')), 1500);
    syncPups();
    hs = S.health; hl = S.needs.light;
    const h = homeView(); camera.position.copy(h.eye); controls.target.copy(h.target); controls.update();
    const cq = /^pup(\d+)$/.exec(Q.get('cam') || ''); if (cq && +cq[1] < S.pups.length) { follow = +cq[1]; pups.select(follow); }
    refreshTree(); refreshRoster(true); refreshBuild(true); refreshExpBtn(); refreshEvBtn();
    if (ld.corrupt) toast('The old save could not be read, so a fresh island has begun.', 5000);
    if (ld.fromV < 5 && S.wake.t !== null) ev.push({ type: 'wake', need: 'nourish' });   // a v4 island that already sailed: Gardeners from now
    if (ld.migrated) toast('Your island moved to the new version: wood, stone, berries and building are here!', 5000);
    if ((sum && ld.away >= 60) || S.pups.some(p => p.isNew)) showAway(sum && ld.away >= 60 ? sum : null);
    if (ld.fresh) { hintShown = true; $('hint').hidden = false; }
    bootSum = sum && ld.away >= 60 ? sum : null;
    if (VISIT) {   // step 6: Schiffy walks in from the tree door; the camera follows her
      walker = Walker(scene, { nav, ground, camera, controls, wfx }); await walker.load(new THREE.GLTFLoader());
      // she starts on the path out of the tree door, past the pups' nap spots (rest grid reaches ~40 m beyond the door)
      const TP = nav.TP, dp = nav.door(fx.scale).p, ux = dp[0] - TP[0], uz = dp[2] - TP[2], ul = Math.hypot(ux, uz) || 1, out = 48;
      const sx = dp[0] + ux / ul * out, sz = dp[2] + uz / ul * out; walker.place([sx, ground(sx, sz, dp[1]), sz]); const wp = walker.pos();
      // camera behind her, looking past her at the tree (the tree fills the back of the first view)
      const ox = wp[0] - TP[0], oz = wp[2] - TP[2], ol = Math.hypot(ox, oz) || 1, back = (36 + 24 * fx.scale) * (W() < H() ? 1.35 : 1);
      controls.target.set(wp[0], wp[1] + 6, wp[2]); camera.position.set(wp[0] + ox / ol * back, wp[1] + 16 + 10 * fx.scale, wp[2] + oz / ol * back); controls.update();
      soc.startVisit();
    } else {
      soc.startHome();
      // Round 2 step 4: lantern notes + the World Bloom (src/lantern_ui.js; the server side is server/patch_3.sql)
      lan = LanternUI({ net: NET, get S() { return S; }, save, toast, esc, IC, snd, mode: 'home', lfx, prof: () => soc.prof, openExplore: () => soc.open(), touch: () => { if (cloud) cloud.touch(); },
        night: () => Sim.dayCurve(Sim.dayH(S)).night > 0.45, refresh: () => { refreshTree(); refreshBuild(true); }, closeOthers: () => { soc.close(); closePlot(); closeExp(); closeEvents(); closeNeed(); },
        critVisit: v => meetCritter(v.id, true), releaseCam, lookAt, bloomCam, awayOpen: () => !$('away').hidden, showAway: () => showAway(bootSum),
        floatHeart: () => { const d = nav.door(fx.scale).p; floater([d[0], d[1] + 12, d[2]], IC.heart); },
        busyUI: () => !$('away').hidden || !$('gift').hidden || !$('mem').hidden || !!boatCam || !!tween, onWords: () => { if (!$('book').hidden && bookTab === 'words') renderBook(); } });
      lan.start();
      // step 7: cloud save cards + account changes (email code, magic link landing, sign-out)
      cloudUI = CloudUI({ net: NET, cloud: CLOUD_ON ? cloud : null, esc, toast, IC, closeOthers: () => soc.close(), onAccount, signOut: cloudSignOut, reloadClean });
      NET.onAuth && NET.onAuth((ev, id) => { if (ev === 'switched') onAccount(id); else if (cloudUI.safeOpen) cloudUI.openSafe('main'); });
      if (pendingPick) { cloudUI.showPick(pendingPick); pendingPick = null; }
      if (ld.cloud && ld.cloud.loaded) setTimeout(() => toast(`${CloudUI && cloudUI.IX.cloud} Welcome back! Your island floated down from the cloud${ld.cloud.from ? ` (saved on ${esc(ld.cloud.from)})` : ''}.`, 5000), 600);
      { let a = null; try { a = sessionStorage.getItem('schiffy-elderglow.after' + SLOT); sessionStorage.removeItem('schiffy-elderglow.after' + SLOT); } catch (e) {} if (a) setTimeout(() => toast(`${cloudUI.IX.cloud} ${esc(a)}`, 5000), 700); }
      // step 7: this page was opened from an email link (sign-in link, or the "confirm your email" link on another device)
      { const L = NET.landed; if (L) setTimeout(() => {
        if (!L.ok) toast(`${cloudUI.IX.mail} That email link has expired or was already used. Ask for a new one in <u>Keep my island safe</u>.`, 9000, () => cloudUI.openSafe('main'));
        else if (cloud && cloud.conflict) {}   // the choice card says it all
        else toast(`${cloudUI.IX.shield} ${L.kind === 'confirm' ? 'Email confirmed: your island is safe!' : 'Signed in! This is your island.'}`, 5000);
      }, 800); }
      if (window.__linkError) setTimeout(() => toast(`${cloudUI.IX.mail} That email link has expired or was already used. Ask for a new code in <u>Keep my island safe</u>.`, 9000, () => cloudUI.openSafe('main')), 900);
      if (CLOUD_ON) setInterval(() => cloud.tick(), 5000);
    }
    // vibe pass 1: the calm view (src/calm.js): the panel folds to a pill when idle, the HUD fades after ~9 s without input.
    // Never while something is in use: a card / menu / the tree's words / a selected or followed pup / a text field / the tour.
    if (!VISIT && window.ElderCalm) {
      // (playtest fixes: every card comes from the one registry, overlayOpen(); a brand-new player's first minutes never fold the panel)
      calm = ElderCalm.make({ side: $('side'), phone: () => document.body.classList.contains('phone'),
        busy: () => overlayOpen() || sayOpen || !!tour || CQ.length > 0 || pups.selected >= 0 || follow >= 0 || curPlot !== null || newbie() ||
          (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) });
      if (calm.pinned && document.body.classList.contains('phone')) $('sheetBtn').innerHTML = 'Close &#9660;';
      // vibe 2 lane C: the idle camera drift (after ~20 s without input, once the calm view has faded) + the tree's night whispers
      const camBusy = () => overlayOpen() || !!tour || !!boatCam || !!tween || CQ.length > 0 || follow >= 0 || pups.selected >= 0 || curPlot !== null || plots.build ||
        (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
      if (window.ElderDrift) drift = ElderDrift.make({ camera, controls, nav, ground, scale: () => fx.scale, busy: camBusy, faded: () => calm.faded, subjects: driftSubjects,
        portrait: () => W() < H() * 0.8, maxDist: () => controls.maxDistance * 0.9 });
      if (window.TreeVoice) voice = TreeVoice({ S: () => S, camera, nav, scale: () => fx.scale, W, H, night: () => dn.state.night,
        blocked: () => overlayOpen() || sayOpen || !!tour || !!boatCam || CQ.length > 0 || !!RST.wave || !beatOk() });
    }
    { const ld0 = $('loading'); ld0.classList.add('done'); setTimeout(() => ld0.remove(), 800); }   // vibe pass 2: the loading scene fades out
    booted = true; bootAt = performance.now(); m.readyAt = performance.now() - t0;
    ElderMap.uRestC.value.set(nav.TP[0], nav.TP[2], Story.C.Y0, Story.C.YK);
    sndUI = ElderSound.ui(snd, { askGate: () => beatOk() && !overlayOpen(), onAsk: beat });   // playtest fixes: the sound chip waits its turn on a first launch
    hotkeyTips(); setTimeout(hotkeyTips, 3000);
    // vibe 2 lane C: the small sounds of island life (steps, chime, dock water, creaks, yawns + snores, the whale, gathering, dawn theme)
    if (window.Foley) foley = Foley(snd, { S: () => S, pups, nav, camera, target: () => controls.target, crFx: () => crFx, scale: () => fx.scale,
      door: () => nav.door(fx.scale).p,
      dock: () => { for (const k in S.plots) { const e = S.plots[k]; if (e.type === 'board' && e.done && plots.byPid[+k]) { const x = plots.byPid[+k]; return [x.c[0], ground(x.c[0], x.c[1], nav.TP[1]) + 1, x.c[1]]; } } return null; } });
    // Round 2 step 5: the island app (install + gentle notifications, src/app.js + sw.js; server side server/patch_4.sql + send-push)
    if (window.ElderApp) appUI = ElderApp.ui({ net: NET, get S() { return S; }, mode: VISIT ? 'visit' : 'home', toast, esc, phone: PHONE, closeOthers: () => { if (soc) soc.close(); closePlot(); closeExp(); closeEvents(); closeNeed(); },
      busy: () => !$('away').hidden || !$('gift').hidden || !$('mem').hidden || !$('book').hidden || !!boatCam || !!tween });
    save();
    giftCheck(true);
    window.__snd = snd;
    window.__game = { snd, get sndUI() { return sndUI; },
      // playtest fixes (tests): the card registry (openCards(kinds), topCard(), closeCard(el), overlayOpen()), first-launch pacing
      // (newbie(), beatOk()), the goal chip (goal.GOAL knobs, goal.next(), goal.tick(dt), goal.idleT), the camera keep-out (trunkKeep(y))
      openCards, topCard, closeCard, overlayOpen, newbie, beatOk, trunkKeep, goal: { GOAL, next: () => nextGoal(), tick: dt => goalTick(dt), idleT, get cur() { return goalCur; } },
      // vibe pass 1 (tests): calm (ElderCalm: faded, folded, pinned, fold(v), setPin(v)), toast(html, ms, onClick) through the queue,
      // TQ (queue + live toasts), queueCard(k, open), CQ, runTour(stops) / endTour, tour (null when none), tourStops(sum, news)
      // vibe pass 2 lane B: life = PupLife (force(kind, i, S, poses), say(i, text), stats(), st), Traits, poses (last frame's drawn poses)
      get life() { return life; }, Traits: window.Traits, get poses() { return poses; }, get steer() { return steer; },   // pathing pass
      // vibe 2 lane C (tests): laneC = { light (LightFx: K, on, gold, stats()), drift (ElderDrift: IDLE, force(v), active, subject, list(), stop()),
      // voice (TreeVoice: show(text), next, count, live), foley (stats) }, driftSubjects(), critCam(id)
      laneC: { get light() { return lightFx; }, get drift() { return drift; }, get voice() { return voice; }, get foley() { return foley; } }, driftSubjects, critCam, closeSay,
      get calm() { return calm; }, toast, TQ, queueCard, CQ, runTour, endTour, get tour() { return tour; }, tourStops, get appUI() { return appUI; }, sndState, renderer, get S() { return S; }, set S(v) { S = v; syncPups(); }, nav, map: m, pups, fx, plots, Sim, save, load, camera, controls, catchUp: sec => { const r = Sim.catchUp(S, sec, nav); syncPups(); return r; }, ev, focusPup, refreshTree, refreshRoster, refreshBuild, SAVE_KEY, lastAway: sum, ground, get social() { return soc; }, get cloud() { return cloud; }, get cloudUI() { return cloudUI; }, NET, CLOUD_ON, bootCloud: ld.cloud, get walker() { return walker; }, VISIT,
      snap() { hs = S.health; hl = S.needs.light; fx.setScale(Sim.scaleOf(S), TreeFx.growthOf(S)); syncPups(); refreshRoster(true); refreshBuild(true); }, flyHome, openPlot, closePlot, showAway, syncPups, flyTo,
      // day / night (tests): setTime('21:30' | hours | null = back to the real clock), clock() = island HH:MM, dn = DayNight
      dn, setTime(x) { TIME_FIX = parseT(x); anchorClock(0); refreshTree(); return this.clock(); },
      clock() { const h = Sim.tod(S); return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0'); },
      Daily, openGift, closeGift, claimGift, giftCheck, renderGift,
      // expeditions (tests): Exped, expFx, openExp(view), closeExp, sendTrip(dest, tier, [pups]), openHaul(k), closeHaul, placeDecor(id), dockCam(dest)
      Exped, expFx, openExp, closeExp, sendTrip, openHaul, closeHaul, placeDecor, dockCam, renderExp,
      // free decor (tests): Decor, decor = { start(id, k), end, confirm, turn(d), move(x, z) (the ghost), get PM, check(id, x, z, r, k, full),
      // pick(mx, my), menu(k), act('move' | 'turn' | 'pack'), closeMenu, ground(mx, my) }
      // creative build part 2, shaping the land: land.start(tool) / end / tool(t) / hover(x, z) / confirm / undo / stroke(x, z, end) / LM / undoList / target(x, z), landFx
      Land, get landFx() { return landFx; }, land: { start: startLand, end: endLand, tool: lmTool, hover: lmHover, confirm: lmConfirm, undo: lmUndo, stroke: lmStroke, target: landTarget, get LM() { return LM; }, undoList: landUndo },
      // buildings (creative build part 2): Homes, homes = { start(piece, pid) (place mode for a free home / moving one), act(a, el) (plot
      // card: col / roof / turn / hmove / hdown on curPlot), check(piece, x, z, r, pid, full), WHY }
      Homes, homes: { start: startHome, act: homeAct, check: homeCheck, WHY: HOME_WHY },
      // piece 5 "showing off" (tests): Tour, guide = { pick(tgt, show) / end(back) / target({t, r, x, z}) / at(mx, my) / add() (tour mode, home),
      // start() (the visitor's guided tour), get TPM, get GUIDE, stopName(st) }
      Tour, guide: { pick: startTourPick, end: endTourPick, target: tourTarget, at: tourPickAt, add: tourAdd, start: startGuide, get TPM() { return TPM; }, get GUIDE() { return GUIDE; }, stopName },
      Decor, decor: { start: startPlace, end: endPlace, confirm: pmConfirm, turn: pmTurn, move: pmMove, snap: pmSnap, copy: pmCopy, pref: DPREF, get PM() { return PM; }, check: decorCheck, pick: pickDecor, menu: openDecMenu, act: decMenuAct, closeMenu: closeDecMenu, ground: pickGround },
      // step 4 (tests): Needs, Events, nfx, openEvents / closeEvents, openNeed(k) / closeNeed, collectFruit({id, j, p}), fruitCam, traderCam,
      // waterRuns() = the water cells rebuilt from the terrain mesh (compare with data/water_cells.json), spotCheck() = mesh
      // water test vs the data-driven decor list (true = same list), spotSig() = fingerprint of every spot list (== sim_check's)
      Needs, Events, nfx, openEvents, closeEvents, openNeed, closeNeed, collectFruit, fruitCam, traderCam, renderEvents, renderNeed,
      // step 5 (tests): Seasons, Growth, seaFx, setSeason(k | name | null), setLevel(lv) (xp to that level's start + snap),
      // openBook(tab) / closeBook, showMemory(lv) / closeMemory, growLand, rootReach() (re-make Needs.C.ROOT from the tree mesh)
      Seasons, Growth, get seaFx() { return seaFx; }, openBook, closeBook, renderBook, showMemory, closeMemory, growLand,
      setSeason(k) { Seasons.fix = typeof k === 'string' ? Seasons.NAMES.indexOf(k) : k; if (Seasons.fix === -1) Seasons.fix = null; refreshTree(); return Seasons.of(S); },
      setLevel(lv) { S.level = Math.max(1, Math.min(8, lv)); S.xp = Sim.C.LV_XP[S.level - 1]; fx.level = S.level; fx.setScale(Sim.scaleOf(S), TreeFx.growthOf(S)); growLand(S.level); for (const p of S.pups) if (p.phase === 'rest') { p.phase = 'idle'; p.t = 0; p.dur = 0; } refreshTree(); refreshBuild(true); return S.level; },
      rootReach() {
        const b = m.batches.find(x => x.key === 'EG_ElderTree'), P = b.geo.attributes.position.array, TP = nav.TP, pl = m.layout.placements.find(p => p.role === 'tree');
        const M = new THREE.Matrix4().compose(new THREE.Vector3(...pl.pos), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.ry), new THREE.Vector3(pl.s, pl.s, pl.s)), v = new THREE.Vector3(), R = new Array(72).fill(0);
        for (let i = 0; i < P.length; i += 3) { if (P[i + 1] > 6) continue; v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); const dx = v.x - TP[0], dz = v.z - TP[2], a = Math.floor(((Math.atan2(dz, dx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 72) % 72; R[a] = Math.max(R[a], Math.hypot(dx, dz)); }
        return R.map(x => Math.round(x * 10) / 10);
      },
      // Round 2 step 2 (tests): Story, RST (shown colour radius / wave), session, trySpeak(force), showSay(words), closeSay,
      // openDiary(i), closeDiary, setColour(R | null, wave) = jump the shown radius (null = back to the earned one)
      Catalog, openCraft, closeCraft, craftAct, openPhoto, closePhoto, savePhoto, get PHOTO() { return PHOTO; }, Story, RST, session, trySpeak, showSay, closeSay, openDiary, closeDiary, Wardrobe, openWard, closeWard, wardPick, startWave, get wfx() { return wfx; }, wetness, get wxFx() { return wxFx; }, Weather: window.Weather, setWeather: (r, w, wet) => { if (wxFx) wxFx.force = r === null ? null : { r, w, wet }; }, PORTRAIT, homeView,
      // Round 2 step 3 (tests): Critters, crFx, meetCritter(id, fly), critCam(id), openCritCard(c, visit, first), closeCritCard,
      // spawnCritter(c, key, min) = put a visitor here NOW (captures only: use ?nosave=1 / a test slot), renderCritters
      // Round 2 step 4 (tests): Lanterns, lan (LanternUI: sync, open(tab), openRead(id), status, claim), lfx (LanternFx: release, setSky, setBloom, bloomPos)
      Lanterns, get lan() { return lan; }, get lfx() { return lfx; }, releaseCam, lookAt, bloomCam,
      Critters, get crFx() { return crFx; }, meetCritter, critCam, openCritCard, closeCritCard, sparkleAt,
      spawnCritter(c, key, min) { const sp = Critters.BY[c]; if (!sp) return null; S.crit.vis = S.crit.vis.filter(v => v.c !== c); const v = { id: ++S.crit.n, c, k: key || 't0', t0: S.time - 10, end: S.time + (min || 60) * 60, tap: 0 }; S.crit.vis.push(v); Critters.entry(S, c).v++; return v; },
      setColour(R, wave) { RST.lock = null; RST.wave = null; ElderMap.uRestWave.value = 0; if (R === null) { RST.R = Story.radius(S).R; return RST.R; } if (wave) { RST.R = Math.min(RST.R, R); startWave(RST.R, R); RST.wave.lockEnd = R; } else RST.lock = R; return R; },
      waterRuns() { return waterRuns(m); }, waterFine() { return waterFine(m); }, get ringFx() { return ringFx; }, Rings, Voyages, showRing, ringReached, voyPlan: (id, team) => { openExp({ v: 'plan', dest: Voyages.BY[id].i, tier: Exped.TIERS.findIndex(t => t.voy), team: team || [] }); },   // update 3
      spotCheck() { const n2 = Nav(m.layout); n2.setDecorOk(waterFree(m)); return J(n2.decorSpots.map(d => d.pid)) === J(nav.decorSpots.map(d => d.pid)); }, spotSig: () => nav.spotSig() };
  }).catch(e => { err('Could not start: ' + (e.stack || e)); window.__mapError = String(e); });

  // ---- loop: fixed sim steps from real time, render reads the sim
  let acc = 0, hs = 80, hl = 80, last = performance.now(), frames = 0, pacc = 0, cpu = 0, uiAcc = 0, clockAcc = 0;
  const STEP = Sim.C.STEP;
  const onEv = e => {
    if (cloud && (e.type === 'level' || e.type === 'ring' || e.type === 'built' || e.type === 'exp-back' || e.type === 'arrive')) cloud.soon();   // big moments reach the cloud within seconds
    if (snd.live) sndEv(e);   // sound: soft, positional, rate-limited (src/audio.js)
    if (e.type === 'deliver') {
      const P = pups.list[e.pup]; if (!P) return;
      const hp = P.holder.position;
      if (e.job === 'water') { fx.splash(hp.x, hp.y, hp.z); floater([hp.x, hp.y + 9, hp.z], `+${IC.water}`); }
      else if (e.job === 'light') { if (e.orb) fx.flashOrb(e.orb.pid); floater([hp.x, hp.y + 9, hp.z], `+${IC.light}`); }
      else if (e.job === 'nourish' || e.job === 'protect' || e.job === 'spirit') { if (e.job === 'nourish') fx.splash(hp.x, hp.y, hp.z); floater([hp.x, hp.y + 9, hp.z], `+${IC[e.job]}`); }
      else floater([hp.x, hp.y + 9, hp.z], `+${Math.max(1, Math.round(e.amount))}${IC[e.job]}`);
    } else if (e.type === 'level') levelUp(e.level);
    else if (e.type === 'ring') ringReached(e.n);   // update 3: Elder rings
    else if (e.type === 'built') {
      const q = nav.plotBy[e.pid]; if (!q) return;
      toast(`${IC[B_ICON[e.kind]]} Freshly built: <b>${bName(e.kind, q)}</b> &middot; ${gives(e.kind, q)}`, 4200, () => openPlot(e.pid, true));
    } else if (e.type === 'upgrade' && e.auto && Pacing.UP[e.id]) {   // pacing pass: "let the pups plan" put a surplus into an upgrade
      toast(`${IC[Pacing.UP[e.id].ic] || IC.build} The pups put the spare pile into the <b>${Pacing.UP[e.id].name}</b> (level ${e.n}) &middot; ${Pacing.UP[e.id].txt(e.n)}`, 5200, () => openCraft('up'));
    } else if (e.type === 'exp-go') {
      const tr = S.exp.trips.find(x => x.id === e.trip); if (tr) { const dv = Exped.DEST[tr.dest].voy; toast(dv ? `${IC.board} ${esc(dv.go)} Home in ${dv.h} hours.` : `${IC.board} Lift-off! The skyboat sails for <b>${Exped.DEST[tr.dest].name}</b>`, dv ? 5200 : 3000); startBoatCam(tr.id); }
    } else if (e.type === 'exp-back') {
      const h = e.haul; syncPups(); refreshExpBtn();
      toast(h.voy ? `${IC.star} The voyage is home from <b>${Exped.DEST[h.dest].name}</b>, the sack glowing with starlight! <u>Open it</u>` : `${IC.board} The skyboat drifts home from <b>${Exped.DEST[h.dest].name}</b> with a sack of treasures! <u>Open it</u>`, 15000, () => { const k = S.exp.hauls.findIndex(y => y.id === h.id); if (k >= 0) openHaul(k); });
    } else if (e.type === 'arrive') {
      syncPups(); const p = S.pups[e.pup];
      if (e.puppy && p.parents) toast(`${IC.friends} Puppy! <b>${esc(S.pups[p.parents[0]].name)}</b> and <b>${esc(S.pups[p.parents[1]].name)}</b> welcome little <b>${esc(p.name)}</b>! <u>Say hi</u>`, 14000, () => { focusPup(e.pup); showAway(null); });
      else toast(`${IC.paw} A wanderer, <b>${esc(p.name)}</b>, is crossing the bridge! <u>Say hi</u>`, 12000, () => { focusPup(e.pup); showAway(null); });
    }
    // ---- step 4
    else if (e.type === 'wake') {
      const k = e.need, msg = { nourish: 'The skyboat brought seeds: the tree\'s <b>Roots</b> are hungry. New job: <b>Root gardeners</b>!', protect: 'Dark <b>blight</b> creeps near the roots: the <b>Ward</b> wakes. New job: <b>Wardens</b>!', spirit: 'The pups long for music: <b>Song</b> woke up. New job: <b>Minstrels</b>!' }[k];
      toast(`${IC[k]} ${msg} <u>Tap</u>`, 16000, () => openNeed(k)); refreshRoster(true);
    } else if (e.type === 'cleared') { const P = pups.list[e.pup]; if (P) floater([P.holder.position.x, P.holder.position.y + 11, P.holder.position.z], `${IC.blight}&#10003;`); }
    else if (e.type === 'sprout') { const P = pups.list[e.pup]; if (P) floater([P.holder.position.x, P.holder.position.y + 9, P.holder.position.z], `${IC.sprout}`); }
    else if (e.type === 'blight' && e.why !== 'wave' && !S.pups.some(p => p.job === 'protect') && Needs.awakeK(S, 'protect') >= 0 && S.blight.list.length === 1) toast(`${IC.blight} A dark blight patch creeps by the roots. A <b>Warden</b> would sweep it away! <u>Show</u>`, 7000, () => openNeed('protect'));
    else if (e.type === 'event') {
      const x = e.e, tx = evText(x, e.k === 'start');
      if (e.k === 'start') {
        const tap = { fruit: fruitCam, trader: () => { openEvents(); traderCam(); }, wish: openEvents, wave: () => openNeed('protect') }[x.type];
        toast(`${IC[EV_IC[x.type]]} ${tx.t}${x.type === 'wave' ? '! Wardens, sweep!' : x.type === 'fruit' ? '! Tap them' : x.type === 'trader' ? ' sets up a stall by the tree' : ''}${tap ? ' <u>Show</u>' : ''}`, x.type === 'crystal' || x.type === 'shower' ? 4200 : 9000, tap || null);
      } else if (e.out === 'done' && x.type === 'wish') toast(`${IC.wish} ${pupN(x.pup)}'s wish is granted, tail going like a windmill! <b>+${Events.C.WISH_MORALE} happiness</b>`, 4200);
      else if (e.out === 'auto' && x.type === 'fruit') toast(`${IC.fruit} The pups gathered the leftover fruit`, 2600);
      else if (e.out === 'left') toast(`${IC.cart} The trader packed up and wandered on`, 2600);
      refreshEvBtn(); renderEvents(true);
    }
    // ---- Round 2 step 3: sky critters arrive / leave (a soft toast; tap = fly there; gifts float up when they go)
    else if (e.type === 'crit' && !VISIT) {
      const v = e.v, sp = Critters.BY[v.c]; if (!sp) return;
      if (e.k === 'start') {
        const isNew = !(S.crit.al[v.c] && S.crit.al[v.c].s), wh = Critters.where(S, v, nav);
        const msg = v.c === 'whale' ? `Look up! A <b>sky whale</b> is drifting over the island...` : isNew ? `Someone new is peeking in ${esc(wh)}...` : `${esc(Critters.article(sp)).replace(/^./, c => c.toUpperCase())} is visiting ${esc(wh)}`;
        toast(`${IC.critter} ${msg} <u>Go say hello</u>`, v.c === 'whale' ? 20000 : 9000, () => meetCritter(v.id, true));
        if (!$('book').hidden && bookTab === 'crit') renderBook();
      } else if (e.k === 'end') {
        if (critOpen === v.id) closeCritCard();
        if (e.gift) { const p = crFx && crFx.posOf(v.id); if (p) floater(p, IC.gift); toast(`${IC.gift} The ${esc(sp.name.toLowerCase())} left a little gift: ${esc(sp.gift.name)}`, 3600); refreshTree(); }
        if (!$('book').hidden && bookTab === 'crit') renderBook();
      }
    }
  };
  // ---- sound: sim events -> cozy sounds (never the other way round); a pup's tiny yip is rare (audio.js rate-limits it to one / 20 s)
  let lastYip = 0;
  function sndEv(e) {
    const at = (i, name, o) => { const P = pups.list[i]; if (!P) return false; const p = P.holder.position; return snd.sfx3(name, p.x, p.y, p.z, o); };
    if (e.type === 'deliver') {
      const j = e.job;
      if (j === 'water' || j === 'nourish') at(e.pup, 'pour', { gain: j === 'water' ? 0.7 : 0.5 });
      else if (j === 'light') at(e.pup, 'lantern', { gain: 0.7 });
      else if (j === 'protect') at(e.pup, 'shimmer', { gain: 0.6 });
      else if (j === 'spirit') at(e.pup, 'notify', { gain: 0.4 });
      else at(e.pup, j === 'food' ? 'pop' : 'tok', { gain: 0.45, rate: j === 'stone' ? 0.8 : 1 });
      const now = performance.now(); if (now - lastYip > 45000 && Math.random() < 0.05 && at(e.pup, 'yip', { gain: 0.55, rate: 0.9 + Math.random() * 0.25 })) lastYip = now;
    } else if (e.type === 'built') snd.sfx('built');
    else if (e.type === 'exp-go' || e.type === 'exp-back') snd.sfx('whoosh', { gain: 0.8 });
    else if (e.type === 'arrive') snd.sfx('sting_arrive');
    else if (e.type === 'wake') snd.sfx('notify');
    else if (e.type === 'cleared') at(e.pup, 'shimmer', { gain: 0.8 });
    else if (e.type === 'event' && e.k === 'start' && e.e.type !== 'shower') snd.sfx('notify', { gain: 0.8 });
    else if (e.type === 'event' && e.out === 'done' && e.e.type === 'wish') snd.sfx('gift', { gain: 0.7 });
    else if (e.type === 'crit' && e.k === 'start' && e.v.c !== 'whale') snd.sfx('shimmer', { gain: 0.7 });   // a visitor: a soft tinkle (the whale: its own call, src/foley.js)
  }
  // the sound's view of the world, 4x a second (cheap: a few distances; the river = nearest water run of data/water_cells.json)
  const sv = new THREE.Vector3();
  function sndState() {
    const cam = camera.position, tg = controls.target, TP = nav.TP;
    let wd = 1e9; if (sndWater) for (const [x, z0, z1] of sndWater) { const dx = tg.x - x, dz = tg.z < z0 ? z0 - tg.z : tg.z > z1 ? tg.z - z1 : 0, d = dx * dx + dz * dz; if (d < wd) wd = d; }
    const camD = cam.distanceTo(tg), close = clamp01((520 - camD) / 380);
    const river = clamp01(1 - (Math.sqrt(wd) - 8) / 110) * (0.35 + 0.65 * close);
    const tree = clamp01(1 - (Math.hypot(cam.x - TP[0], cam.y - (TP[1] + 20), cam.z - TP[2]) - 60) / 260);
    sv.set(1, 0, 0).applyQuaternion(camera.quaternion); const right = [sv.x, sv.y, sv.z];
    const pos = (list, R) => { if (!list.length) return null; let x = 0, y = 0, z = 0; for (const P of list) { x += P.holder.position.x; y += P.holder.position.y; z += P.holder.position.z; } x /= list.length; y /= list.length; z /= list.length;
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = Math.hypot(dx, dy, dz) || 1; return { g: Math.pow(clamp01(1 - (d - 30) / R), 1.4), pan: clamp(-1, 1, (dx * sv.x + dz * sv.z) / d * 0.8) }; };
    const players = [], builders = [];
    S.pups.forEach((p, i) => { if (!pups.list[i]) return; if ((p.task === 'stage' || p.task === 'busk') && p.phase === 'play') players.push(pups.list[i]); else if (p.task === 'site' && p.phase === 'build') builders.push(pups.list[i]); });
    const B = pos(builders, 300);
    // seasons + weather pass: rain 0..1 from the weather (a shower counts), wind + gusts, drips while wet, roof patter near cottages
    const wx = wxFx ? wxFx.wx : null; let rd = 1e9; for (const d of homeDoors()) rd = Math.min(rd, Math.hypot(d[0] - tg.x, d[1] - tg.z));
    return { night: dn.state.night, dawn: dn.state.dawn, dusk: dn.state.dusk, sw: sndSW, rain: wx ? clamp01(wx.r * (wx.snow ? 0.25 : 1)) : S.events.active.some(x => x.type === 'shower') ? 1 : 0, river, tree, health: hs, camD, say: sayOpen ? 1 : 0,
      wind: wx ? wx.windy : 0, gust: wx ? wx.gust : 0, wet: wx ? wx.wet : 0, roof: clamp01(1 - (rd - 25) / 140) * (0.35 + 0.65 * close),
      cam: [cam.x, cam.y, cam.z], right, stage: pos(players, 380), build: B ? { g: B.g * Math.min(1, 0.5 + builders.length * 0.25) * 0.5, pan: B.pan } : null };
  }
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x, clamp = (a, b, x) => x < a ? a : x > b ? b : x;
  let sndSW = [0, 0, 1, 0];
  // step 7: hidden = save + cloud upload now (phones often never fire pagehide); back after > 30 s = compare with the cloud
  // (another device may have played meanwhile: the choice card, never a silent swap)
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); save(); if (booted && CLOUD_ON && cloud) cloud.flush('hide'); }
    else if (booted) { giftCheck(true); if (CLOUD_ON && cloud && !cloud.busy && Date.now() - hiddenAt > 30000) cloud.check('visible'); }
  });
  addEventListener('pagehide', () => { save(); if (booted && CLOUD_ON && cloud) cloud.flush('pagehide'); });
  addEventListener('online', () => { if (booted && CLOUD_ON && cloud) cloud.soon(); });
  addEventListener('resize', () => { setLayout(); camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); });
  const LBL_STACK = 3;   // playtest fixes: at most 3 job labels stacked over a crowd, the rest = "+N"
  const poses = [], airY = (x, z, y) => y, v3n = new THREE.Vector3();   // pups in a sky boat / hopping: no ground snap
  renderer.setAnimationLoop(() => {
    const now = performance.now(), real = (now - last) / 1000; last = now;
    const dt = Math.min(0.1, real), t = now / 1000;
    if (!booted) { renderer.render(scene, camera); return; }
    const c0 = performance.now();
    // sim
    if (real > 30) {   // tab was hidden / laptop slept: coarse catch-up, summary if long
      const sum = Sim.catchUp(S, real * SPEED, nav); syncPups(); if (life) life.rewarm(); if (!VISIT) { if (real >= 3600) session.n = 0; /* back after an hour+ (a phone woken the next morning) = a new session open */ if (real >= 60 && session.n === 0) awayDream(sum, real); Story.openDay(S, Daily.dayNum(new Date())); } if (real >= 60 && !VISIT) showAway(sum); acc = 0;
    } else {
      acc += real * SPEED; let n = 0;
      if (cloud && !VISIT) cloud.played();   // real play since the last save: the save counter moves on (src/cloud.js)
      while (acc >= STEP && n < 4000) { Sim.step(S, STEP, nav, ev); acc -= STEP; n++; }
      if (acc >= STEP) acc = 0;
      // a frame with no sim step: another island built on this nav between frames (the mock's sample islands = Sim.create, a
      // visit's own-save read = Sim.sanitize) left nav.plotBy without this island's free homes -> bedsOf threw in refreshTree
      if (!n && window.Homes) Homes.sync(S, nav);
    }
    if (pups.list.length !== S.pups.length) syncPups();
    if (VISIT) {   // a visit is a light visual tick: pups work + animate, the tree never levels, only delivery floaters show
      if (S.level < Sim.C.MAX_LV) S.xp = Math.min(S.xp, Sim.C.LV_XP[S.level] - 1);
      for (let k = ev.length - 1; k >= 0; k--) if (ev[k].type !== 'deliver') ev.splice(k, 1);
    }
    while (ev.length) onEv(ev.shift());
    // view
    fx.tick(Sim.scaleOf(S), TreeFx.growthOf(S), dt);   // tree growth: eases inside a level, a growth moment on level-up (tree_fx.js)
    hs += (S.health - hs) * Math.min(1, dt * 1.5); hl += (S.needs.light - hl) * Math.min(1, dt * 1.5);
    fx.night = dn.state.night; fx.update(t, dt, hs, hl, renderer);
    if (ringFx) ringFx.update(t, dt, Rings.got(S), dn.state.night);
    const sick = Math.max(0, Math.min(1, (60 - hs) / 50));
    // the island clock: follows the sim (so ?speed shows days passing); on the real clock (speed 1, no ?time) it is
    // re-anchored when it drifts > 2 min (DST, time-zone trip, a sleep longer than the 12 h catch-up cap)
    clockAcc += real;
    if (clockAcc > 10) {
      clockAcc = 0;
      if (TIME_FIX === null && SPEED === 1) { const dft = Math.abs(((Sim.tod(S) * 3600 - realSec()) % 86400 + 86400 + 43200) % 86400 - 43200); if (dft > 120 || Math.abs(S.ep0 + S.time - Seasons.localNow()) > 120) anchorClock(0); }
      giftCheck(false);
      if (!VISIT) Story.openDay(S, Daily.dayNum(new Date()));   // past midnight with the game open: a new day played
    }
    // step 5: season (weights fade over the first night hours of a new week) -> map tints, sky, weather, tree petals / leaves;
    // the sky reads the season-warped hour (summer long days, winter short)
    const sw = PHOTO && PHOTO.sea !== null ? [0, 1, 2, 3].map(i => i === PHOTO.sea ? 1 : 0) : Seasons.weights(S.ep0 !== null ? S.ep0 + S.time : Seasons.localNow());   // (photo mode: a view-only season preview)
    dn.season = sw; fx.season = sw; fx.level = S.level; sndSW = sw;
    // seasons + weather pass: the weather the view shows (rain, wind, gusts, wet ground; src/weather_fx.js) -> sky, light, particles
    const wx = wxFx ? wxFx.view(S, t, dt, sw, { wet: showerWet() }) : null, shw = S.events.active.some(e => e.type === 'shower');
    dn.weather = wx || { r: shw ? 0.75 : 0, w: 0 }; seaFx.wx = wx;
    dn.update(PHOTO && PHOTO.h !== null ? PHOTO.h : Sim.dayH(S), t, dt, sick, fx.scale);   // (photo mode: a view-only time preview)
    if (lightFx) lightFx.update(dn, fx, t, dt, sw, { rain: wx ? wx.r : shw ? 1 : 0, wind: wx ? wx.windy * wx.motion : 0 });   // vibe 2 lane C
    { const fe = S.events.active.find(e => e.type === 'fest'); seaFx.fest = fe ? 1 : 0; seaFx.festSea = fe ? fe.sea : -1; }
    seaFx.update(sw, t, dt, dn.state.night, controls.target, renderer, homeDoors(), nav.trunkR(fx.scale));
    seasonCheck();
    if (crFx) { crFx.bind(S); crFx.update(S, t, dt, Math.min(STEP, acc), dn.state.night, camera, now / 1000); }   // sky critters
    if (lfx) lfx.update(dt, dn.state.night, scene.fog.color);   // Round 2 step 4: lanterns + the World Bloom
    poses.length = 0;
    // free decor place mode: the full rules (the pups' ways to their jobs) once the ghost has rested 0.15 s; the ghost + menu
    if (PM) { if (!PM.done && now - PM.t > 150) pmCheck(true); expFx.ghost(PM.id, PM.x, PM.z, PM.r, PM.ok, t, DPREF.snap ? SNAP.grid : 0); expFx.guides(PM.guides); }
    if (DM !== null) placeDecMenu();
    if (LM && LM.tool === 'plant' && isFinite(LM.x)) expFx.ghost(Land.KINDS[LM.kind], LM.x, LM.z, landYaw(LM.x, LM.z), LM.ok, t, 0);   // (land mode: the sapling's ghost pulses)
    expFx.update(S, t, dt, Math.min(STEP, acc));   // boats first: pups on a trip ride in them
    if (landFx) landFx.update(S, t, camera);   // creative build part 2: painted paths, removed + planted trees, meadows
    for (let i = 0; i < S.pups.length; i++) {
      let ps = Sim.pose(S, i, nav, Math.min(STEP, acc));
      const ov = expFx.pupPose(S, i, ps, t); if (ov) ps = ov; poses.push(ps);
    }
    nfx.dance(poses);   // resting pups near a performance dance
    if (life) { const dc = Sim.dayCurve(Sim.dayH(S)); life.apply(S, poses, t, dt, { night: dn.state.night, dusk: dc.dusk, winter: sw[3] || 0, rain: wx ? wx.r > 0.3 : shw, wet: wx ? wx.wet : 0, windy: wx ? wx.windy : 0, camera, target: controls.target, W: W(), H: H() }); }
    if (steer) steer.apply(poses, dt);   // pathing pass: make room for each other + props (view only)
    pups.glow(dn.state.night);   // Round 3 update 1: outfits (dress = no-op unless the outfit changed)
    for (let i = 0; i < poses.length; i++) { const ps = poses[i]; if (S.pups[i]) pups.dress(i, S.pups[i].fit); pups.update(i, ps, t, dt, ps.air ? airY : ground); ps.y = pups.list[i] ? pups.list[i].y : ps.p[1]; }
    nfx.update(S, t, dt, poses, dn.state.night, camera, renderer.domElement.height);
    plots.update(S, t, dt, S.level, poses);
    cameraTick(dt); if (walker) walker.update(dt); controls.update();
    pups.lod(camera.position, PHONE ? 220 : 260);   // home view sees the plaza at ~190 m: keep its pups inked
    // vibe pass 1: a pup right in front of the lens (critter / tour / free camera) is hidden instead of filling the screen
    for (const P of pups.list) { const hp = P.holder.position, near = camera.position.distanceToSquared(v3n.set(hp.x, hp.y + 2.5, hp.z)) < 36; if (near !== !!P.nearHid) { P.nearHid = near; P.holder.visible = !near; } }
    restoreTick(dt, t);   // Round 2 step 2: the colour radius (one uniform set) + the mist
    if (wfx) wfx.update(S, t, dt, dn.state.night, camera, sw, { wet: wetness(), rain: wx ? wx.r > 0.3 : shw, wind: wx ? wx.windy * wx.motion : 0, H: renderer.domElement.height });   // vibe pass 2
    if (wxFx) { const ur = ElderMap.uRest.value; wxFx.update(S, t, dt, dn.state.night, camera, controls.target, renderer, poses, sw, { w: ur.w, x: ur.x, h: dn.state.h }); }   // umbrellas, puffs, sunflowers, leaf piles
    map.update(camera, t, renderer.domElement.height);
    renderer.render(scene, camera);
    if (TPM || GUIDE) tourFrame();   // piece 5: tour pins (home) / the guide's bubble (visit)
    // labels: projected over each pup's head, then stacked upward where they would overlap (nearest pup keeps its spot)
    const hv = new THREE.Vector3(), placed = [], lbls = [];
    document.querySelectorAll('#labels .lbl').forEach(l => {
      const i = +l.dataset.i; if (!pups.list[i]) return; pups.head(i, hv); const d = hv.distanceTo(camera.position); hv.project(camera);
      const vis = hv.z < 1 && Math.abs(hv.x) < 1.05 && Math.abs(hv.y) < 1.05 && d < 600;
      l.style.display = vis ? 'flex' : 'none';
      if (vis) lbls.push({ l, i, d, x: (hv.x + 1) / 2 * W(), y: (1 - hv.y) / 2 * H(), w: l.offsetWidth || 26, h: l.offsetHeight || 22 });
    });
    // playtest fixes: a crowd (20 pups at the tree door) stacked a 7-high label tower. Now a stack is at most LBL_STACK high; the
    // rest fold into a "+N" bubble on the stack's own bottom label (the selected pup always keeps its label, nearest first)
    lbls.sort((a, b) => (b.i === pups.selected) - (a.i === pups.selected) || a.d - b.d);
    const more = new Map();
    for (const L of lbls) {
      let y = L.y, lv = 0, base = null, hidden = false;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find(p => Math.abs(p.x - L.x) < (p.w + L.w) / 2 + 2 && Math.abs(p.y - y) < (p.h + L.h) / 2 + 1);
        if (!hit) break;
        base = base || hit.base || hit; lv = hit.lv + 1;
        if (lv >= LBL_STACK && L.i !== pups.selected) { hidden = true; break; }
        y = hit.y - (hit.h + L.h) / 2 - 2;
      }
      if (hidden) { L.l.style.display = 'none'; more.set(base, (more.get(base) || 0) + 1); continue; }
      const P = { x: L.x, y, w: L.w, h: L.h, lv, base, L }; placed.push(P);
      L.l.style.left = L.x + 'px'; L.l.style.top = y + 'px';
    }
    for (const P of placed) { const m = P.L.l.querySelector('.mre'), n = more.get(P) || 0, t = n ? '+' + n : ''; if (m && m.textContent !== t) { m.textContent = t; m.hidden = !n; } }
    expLabels();
    if (voice) voice.update(dt);   // vibe 2 lane C: night whispers by the trunk
    if (foley) foley.update(dt, { night: dn.state.night, h: dn.state.h, wind: 0.5 + 0.5 * (1 - dn.state.night), poses, quiet: overlayOpen() || !!boatCam });
    uiAcc += dt; if (uiAcc > 0.25) { if (!VISIT) goalTick(uiAcc); uiAcc = 0; if (session.n === 0) trySpeak(false); if (snd.live) snd.update(sndState()); if (wxUI && wxFx) wxUI.refresh(wxFx.wx, S, now); refreshTree(); refreshRoster(false); refreshBuild(false); renderPlot(false); renderExp(false); refreshExpBtn(); renderEvents(false); renderNeed(false); refreshEvBtn(); }
    if (now - lastSave > 5000) save();
    cpu += performance.now() - c0; frames++; pacc += real;
    if (pacc >= 0.5) {
      const i = renderer.info.render;
      window.__perf = { fps: frames / pacc, cpuMs: cpu / frames, calls: i.calls, tris: i.triangles, drawn: map.stats.drawn, loadMs: Math.round(map.readyAt || 0), pups: S.pups.length };
      frames = 0; pacc = 0; cpu = 0;
    }
  });
})();
