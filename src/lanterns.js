// Lanterns (Round 2 step 4): lantern notes + the shared World Bloom. Pure (no three.js, no network, no Math.random, no clock:
// times are passed in), loaded right after critters.js. The network side is src/net.js (mock or Supabase, server/patch_3.sql),
// the screen side src/lantern_ui.js + src/lantern_fx.js.
// - Lantern notes: a kind note (<= 120, the guestbook filter, also checked in SQL) in a paper lantern of one of 6 colours,
//   released from the plaza at night; the SERVER picks a random other player (never yourself, active islands first, never the
//   same one twice in a row) and keeps 3 a day per sender. The sender only ever learns "it found someone" (+ a warmth back).
// - World Bloom: one shared giant flower per season-week (cycle = UTC week, kind = the season of that week); each island's care
//   earns petals (healthy tree hours, watering other trees, sending lanterns) that are added on the server with a per-player
//   daily cap; every milestone opens a gift for EVERY player, claimable once (ids in the save).
// - S.lan (save v10): got / sent logs, merged ids, a lantern waiting for dusk, petals not yet sent, claimed gifts.
(function () {
  'use strict';
  const DAY = 86400, WEEK = 7 * DAY;
  const C = {
    NOTE_MAX: 120, PER_DAY: 3,                         // lanterns per sender per UTC day (SQL: send_lantern)
    COLS: { rose: '#ff9fc0', amber: '#ffc65a', mint: '#8fe3b5', sky: '#8fd0ff', lilac: '#c6a6ff', ember: '#ff9a6a' },
    PROMPTS: ["You're doing great", 'Your tree is lovely', 'Rest is part of growing', "Someone is glad you're here", 'Sending you a warm hug', 'Little steps still count',
      'You make the world softer', 'Sleep well, friend', 'Drink some water, you deserve it', 'The stars are out for you tonight'],
    GOT_MAX: 60, SENT_MAX: 40, IDS_MAX: 300, SKY_MAX: 8,
    // World Bloom petals (client side; the server caps every player at CAP_DAY a UTC day: bloom_add)
    PET_H: 3600, PET_HEALTH: 60, PET_CARE_DAY: 12,     // one petal per healthy tree hour (health >= 60), up to 12 a day from care
    PET_WATER: 3, PET_LANTERN: 2, PEND_MAX: 40, CAP_DAY: 20,
    MILES: [40, 120, 250, 450, 750, 1200, 2000],      // global petals for each gift (the same list as SQL bloom_status)
    CLAIM_KEEP: 40,
  };
  // the bloom of a cycle = the season of that week (the same week maths as src/seasons.js, on UTC: everyone shares one bloom)
  const KINDS = [
    { k: 'blossom', name: 'Starblossom', col: '#ffb3d0', core: '#fff1a8', sea: 'spring' },
    { k: 'sunbell', name: 'Sunbell', col: '#ffd24a', core: '#ff9a3c', sea: 'summer' },
    { k: 'ember', name: 'Ember Lily', col: '#ff8a4a', core: '#ffe08a', sea: 'autumn' },
    { k: 'frost', name: 'Frost Lotus', col: '#bfe6ff', core: '#ffffff', sea: 'winter' },
  ];
  const cycleOf = utcMs => Math.floor((utcMs / 1000 + 3 * DAY) / WEEK);
  const kindOf = cyc => KINDS[(((cyc + 1) % 4) + 4) % 4];   // +1 = Seasons.OFFSET
  const cycleLeft = utcMs => WEEK - ((utcMs / 1000 + 3 * DAY) - cycleOf(utcMs) * WEEK);   // seconds until the next bloom
  const utcDay = ms => Math.floor(ms / 86400000);
  // milestone gifts (index = milestone); crit = a special visitor comes to the plaza for an hour
  const GIFTS = [
    { res: { wood: 25, stone: 25 }, t: 'wood + stone' },
    { sap: 60, seeds: 1, t: 'glow sap + a seed' },
    { crit: 'deer', t: 'a crystal deer comes to visit' },
    { res: { crystal: 3 }, t: '3 crystals' },
    { decor: 'spirit-sapling', t: 'a spirit sapling decoration' },
    { seeds: 2, res: { food: 60 }, t: '2 seeds + berries' },
    { decor: 'star-shard', res: { crystal: 2 }, t: 'a star shard + crystals' },
  ];

  // ---------------------------------------------------------------- state (save v10)
  const freshBl = () => ({ hs: 0, day: -1, dayN: 0, pend: 0, cl: [], seen: {}, last: null });
  function create(s) { s.lan = { got: [], sent: [], ids: [], q: null, n: { sent: 0, got: 0, warm: 0, warmGot: 0 }, bl: freshBl() }; }
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const int = (v, d, lo, hi) => Math.round(fin(v, d, lo, hi));
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const S_ = () => window.Social;
  const noteOk = t => typeof t === 'string' && S_().noteCheck(t).ok && S_().noteCheck(t).v === t;
  const colOk = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(C.COLS, c);
  const fromOk = t => typeof t === 'string' && S_().nameCheck(t, 'island').ok;
  function sanitize(s, o) {
    create(s); const x = o && o.lan && typeof o.lan === 'object' ? o.lan : null; if (!x) return;
    const L = s.lan, seen = new Set();
    if (Array.isArray(x.got)) for (const g of x.got.slice(-C.GOT_MAX)) {
      if (!g || !ID_RE.test(g.id) || seen.has(g.id) || !noteOk(g.b) || !colOk(g.c)) continue; seen.add(g.id);
      L.got.push({ id: g.id, f: fromOk(g.f) ? g.f : 'Someone', b: g.b, c: g.c, at: int(g.at, 0, 0, 1e13), r: g.r === 1 ? 1 : 0, w: g.w === 1 ? 1 : 0, sky: g.sky === 1 && g.r !== 1 ? 1 : 0 });
    }
    const sseen = new Set();
    if (Array.isArray(x.sent)) for (const g of x.sent.slice(-C.SENT_MAX)) {
      if (!g || !ID_RE.test(g.id) || sseen.has(g.id) || !noteOk(g.b) || !colOk(g.c)) continue; sseen.add(g.id);
      L.sent.push({ id: g.id, b: g.b, c: g.c, at: int(g.at, 0, 0, 1e13), f: g.f === 1 ? 1 : 0, w: g.w === 1 ? 1 : 0 });
    }
    L.ids = Array.isArray(x.ids) ? [...new Set(x.ids.filter(i => typeof i === 'string' && ID_RE.test(i)))].slice(-C.IDS_MAX) : [];
    for (const g of L.got) if (!L.ids.includes(g.id)) L.ids.push(g.id);
    if (x.q && noteOk(x.q.b) && colOk(x.q.c)) L.q = { b: x.q.b, c: x.q.c };
    for (const k in L.n) L.n[k] = int(x.n && x.n[k], 0, 0, 1e7);
    const b = x.bl && typeof x.bl === 'object' ? x.bl : {};
    L.bl.hs = fin(b.hs, 0, 0, C.PET_H); L.bl.day = int(b.day, -1, -1, 1e7); L.bl.dayN = int(b.dayN, 0, 0, C.PET_CARE_DAY); L.bl.pend = int(b.pend, 0, 0, C.PEND_MAX);
    L.bl.cl = Array.isArray(b.cl) ? [...new Set(b.cl.filter(k => typeof k === 'string' && /^\d{1,7}:\d$/.test(k)))].slice(-C.CLAIM_KEEP) : [];
    if (b.seen && typeof b.seen === 'object') for (const k of Object.keys(b.seen).slice(-4)) if (/^\d{1,7}$/.test(k)) L.bl.seen[k] = int(b.seen[k], 0, 0, C.MILES.length);
    const la = b.last;
    if (la && typeof la === 'object' && Number.isInteger(la.cyc)) L.bl.last = { cyc: int(la.cyc, 0, 0, 1e7), total: int(la.total, 0, 0, 1e12), today: int(la.today, 0, 0, C.CAP_DAY), mine: int(la.mine, 0, 0, 1e6), prev: int(la.prev, 0, 0, 1e12), at: int(la.at, 0, 0, 1e13) };
  }

  // ---------------------------------------------------------------- sim (Sim.step, after health; deterministic)
  // a petal per healthy tree hour, at most PET_CARE_DAY on one island day; petals wait in pend until the game sends them
  function tick(s, dt) {
    const b = s.lan.bl, di = window.Story ? window.Story.dayIdx(s) : Math.floor(s.time / DAY);
    if (di !== b.day) { b.day = di; b.dayN = 0; }
    if (s.health < C.PET_HEALTH || b.dayN >= C.PET_CARE_DAY) return;
    b.hs += dt;
    while (b.hs >= C.PET_H) { b.hs -= C.PET_H; if (b.dayN < C.PET_CARE_DAY) { b.dayN++; b.pend = Math.min(C.PEND_MAX, b.pend + 1); } }
  }
  function petal(s, n) { s.lan.bl.pend = Math.min(C.PEND_MAX, s.lan.bl.pend + Math.max(0, Math.round(n) || 0)); }

  // ---------------------------------------------------------------- lanterns
  const sentToday = (s, nowMs) => s.lan.sent.filter(g => utcDay(g.at) === utcDay(nowMs)).length;
  const left = (s, nowMs) => Math.max(0, C.PER_DAY - sentToday(s, nowMs));
  // the server took it: remember it (the sender only learns found / warmth later)
  function addSent(s, rec) {
    const L = s.lan; if (!rec || !ID_RE.test(rec.id) || L.sent.some(g => g.id === rec.id) || !noteOk(rec.b) || !colOk(rec.c)) return false;
    L.sent.push({ id: rec.id, b: rec.b, c: rec.c, at: int(rec.at, 0, 0, 1e13), f: 0, w: 0 }); if (L.sent.length > C.SENT_MAX) L.sent.splice(0, L.sent.length - C.SENT_MAX);
    L.n.sent++; petal(s, C.PET_LANTERN); return true;
  }
  // inbox from the server -> new arrivals (sorted by id = deterministic; ids remembered = idempotent; bad notes never show)
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function merge(s, list) {
    const L = s.lan, have = new Set(L.ids), out = [];
    for (const g of (Array.isArray(list) ? list : []).filter(g => g && typeof g.id === 'string' && ID_RE.test(g.id)).slice().sort(byId)) {
      if (have.has(g.id)) {   // already here: keep the server's read / warmth marks (another device may have read it)
        const e = L.got.find(x => x.id === g.id); if (e) { if (g.read && !e.r) { e.r = 1; e.sky = 0; } if (g.warm && !e.w) e.w = 1; }
        continue;
      }
      have.add(g.id); L.ids.push(g.id);
      const nc = S_().noteCheck(g.body); if (!nc.ok || nc.v !== g.body || !colOk(g.col)) continue;   // a note the filter refuses never shows
      const e = { id: g.id, f: fromOk(g.from) ? g.from : 'Someone', b: g.body, c: g.col, at: int(g.at, 0, 0, 1e13), r: g.read ? 1 : 0, w: g.warm ? 1 : 0, sky: g.read ? 0 : 1 };
      L.got.push(e); L.n.got++; out.push(e);
    }
    if (L.ids.length > C.IDS_MAX) L.ids = L.ids.slice(-C.IDS_MAX);
    while (L.got.length > C.GOT_MAX) { const i = L.got.findIndex(x => x.r); L.got.splice(i >= 0 ? i : 0, 1); }
    return out;
  }
  // the sender's view from the server (found / warmth only, never who) -> what changed
  function mergeSent(s, list) {
    const out = { found: [], warm: [] };
    for (const g of Array.isArray(list) ? list : []) {
      const e = g && s.lan.sent.find(x => x.id === g.id); if (!e) continue;
      if (g.found && !e.f) { e.f = 1; out.found.push(e); }
      if (g.warm && !e.w) { e.w = 1; out.warm.push(e); s.lan.n.warmGot++; }
    }
    return out;
  }
  const sky = s => s.lan.got.filter(g => g.sky).slice(-C.SKY_MAX);
  function read(s, id) { const e = s.lan.got.find(g => g.id === id); if (!e) return null; e.r = 1; e.sky = 0; return e; }
  function warm(s, id) { const e = s.lan.got.find(g => g.id === id); if (!e || e.w) return false; e.w = 1; e.r = 1; e.sky = 0; s.lan.n.warm++; return true; }
  function drop(s, id) { const i = s.lan.got.findIndex(g => g.id === id); if (i < 0) return false; s.lan.got.splice(i, 1); return true; }   // reported: gone (the id stays in ids)
  function queue(s, b, c) { const nc = S_().noteCheck(b); if (!nc.ok || !colOk(c)) return false; s.lan.q = { b: nc.v, c }; return true; }

  // away-card lines (pure): arrivals while away + what the sender learnt
  function awayLines(got, sent) {
    const L = [];
    if (got && got.length) L.push(got.length === 1 ? 'A lantern drifted in while you were away' : `${got.length} lanterns drifted in while you were away`);
    if (sent && sent.found && sent.found.length) L.push(sent.found.length === 1 ? 'Your lantern found someone' : `${sent.found.length} of your lanterns found someone`);
    if (sent && sent.warm && sent.warm.length) L.push(sent.warm.length === 1 ? 'Someone sent warmth back for your lantern' : `${sent.warm.length} people sent warmth back for your lanterns`);
    return L;
  }

  // ---------------------------------------------------------------- World Bloom (status = the server's numbers)
  const reached = total => C.MILES.filter(m => total >= m).length;
  const key = (cyc, m) => cyc + ':' + m;
  const claimed = (s, cyc, m) => s.lan.bl.cl.includes(key(cyc, m));
  // claim the gift of milestone m of cycle cyc once (needs the global total to have reached it); returns the gift or null
  function claim(s, cyc, m, total) {
    const b = s.lan.bl; if (!Number.isInteger(cyc) || !Number.isInteger(m) || m < 0 || m >= C.MILES.length || !(total >= C.MILES[m]) || claimed(s, cyc, m)) return null;
    b.cl.push(key(cyc, m)); if (b.cl.length > C.CLAIM_KEEP) b.cl = b.cl.slice(-C.CLAIM_KEEP);
    const g = GIFTS[m];
    if (g.res) for (const k in g.res) s.res[k] = (s.res[k] || 0) + g.res[k];
    if (g.sap) s.sap += g.sap;
    if (g.seeds) s.inv.seeds += g.seeds;
    if (g.decor && s.inv.decor.length < 200) s.inv.decor.push(g.decor);
    let v = null;
    if (g.crit && s.crit && window.Critters && window.Critters.BY[g.crit]) {   // a special visit: on the plaza for an hour (like any visitor)
      s.crit.vis = s.crit.vis.filter(x => x.c !== g.crit);
      v = { id: ++s.crit.n, c: g.crit, k: 't2', t0: s.time, end: s.time + 3600, tap: 0 }; s.crit.vis.push(v); window.Critters.entry(s, g.crit).v++;
    }
    return { cyc, m, gift: g, visit: v };
  }
  // unclaimed gifts of the current + the previous cycle (a week away never loses one)
  function open(s, st) {
    const out = []; if (!st) return out;
    for (const [cyc, tot] of [[st.cyc, st.total], [st.cyc - 1, st.prev || 0]]) for (let m = 0; m < reached(tot); m++) if (!claimed(s, cyc, m)) out.push({ cyc, m });
    return out;
  }
  // milestones newly reached since the island last looked (for toasts / the tree's words), remembered per cycle
  function fresh(s, st) {
    if (!st) return [];
    const b = s.lan.bl, k = String(st.cyc), was = b.seen[k] || 0, now = reached(st.total), out = [];
    for (let m = was; m < now; m++) out.push(m);
    b.seen[k] = now; const ks = Object.keys(b.seen); if (ks.length > 4) for (const x of ks.sort((a, z) => a - z).slice(0, ks.length - 4)) delete b.seen[x];
    return out;
  }
  function frac(total) {   // 0..1 within the next milestone + overall openness for the giant flower
    const r = reached(total), lo = r ? C.MILES[r - 1] : 0, hi = C.MILES[Math.min(r, C.MILES.length - 1)];
    return { r, next: r < C.MILES.length ? hi : null, k: r >= C.MILES.length ? 1 : (total - lo) / Math.max(1, hi - lo), open: Math.min(1, total / C.MILES[C.MILES.length - 1]) };
  }

  window.Lanterns = { C, KINDS, GIFTS, cycleOf, kindOf, cycleLeft, utcDay, create, sanitize, tick, petal, sentToday, left, addSent, merge, mergeSent, sky, read, warm, drop, queue,
    awayLines, reached, claimed, claim, open, fresh, frac, noteOk, colOk };
})();
