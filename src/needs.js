// Needs (step 4): the three needs that got jobs last - Nourish (Gardeners), Protect (Guardians), Spirit (Performers) -
// plus blight patches, crystal wards and pup friendships (+ puppies). Pure JS on the sim state, no three.js, no
// Math.random, no clock: Sim.step calls Needs.tick, Sim's phase machine hands the new jobs' phases to begin / finish here.
// Tutorial order: water -> light -> build -> expeditions -> these. The three needs sleep (held near FLOOR by the island)
// until the first sky trip lands; then Nourish wakes (the trip brought seeds), Protect 30 min later (the first blight
// creeps in), Spirit 30 min after that; each one's decay ramps up over RAMP so a fresh need starts easy.
// Cozy rules: blight only ever slows the tree (Protect never drops below its MIN, health stays well above 0), it never
// spreads while the tree's health is >= SPREAD_H, nothing is lost; friendships never decay.
// State: S.wake = {t} (first landing time, null = asleep), S.blight = {n, list: [{id, k (nav.blightSpots), t, r (size .35..1)}],
//   slot, cleared}, S.wards = [k (nav.wardSpots)], S.garden = {sprouts: [{t, k}], fed}, S.fr = {pairs: {'a.b': hours},
//   lastPuppy, puppies}. Pup tasks: garden (go -> plant -> carry -> feed), blight (go -> clear) / patrol (go -> watch),
//   stage / busk (go -> play, play, play...).
(function () {
  'use strict';
  const H = 3600;
  const C = {
    WAKE: { nourish: 0, protect: 1800, spirit: 3600 }, RAMP: 3600,
    GARDEN: { PLANT: 12, FEED: 3, SPROUT_K: 0.25, SPROUTS: 4, SPROUT_LIFE: 4 * H, CONS_K: 0.3, CONS_SPROUTS: 2, CONS_N: 3 },
    GUARD: { CLEAR: 14, CLEAR_R: 12, WATCH: 25 },
    PLAY: 60, BUSK_K: 0.7, MUSIC_MORALE: 6, GLUM_SPIRIT: 40, GLUM_MORALE: 6,
    // blight: one roll per SLOT (spawn chance P, x WARD_K when the spot is warded); patches grow R0 -> 1 over GROW s
    // (x WARD_G warded); Protect decays LOAD x total size per hour on top of its base decay; spreading (a full-size patch
    // seeds its nearest free spot, chance SPREAD_P per slot) only while health < SPREAD_H; at most MAX (waves: WAVE_MAX)
    BLIGHT: { SLOT: 1200, P: 0.5, R0: 0.35, GROW: 7200, LOAD: 2, MAX: 6, WAVE_MAX: 9, SPREAD_H: 60, SPREAD_P: 0.5, WARD_R: 30, WARD_K: 0.3, WARD_G: 0.4, WARD_COST: 5 },
    // friendships: hours worked side by side (same job) -> level 1 friends / 2 good friends / 3 close friends; a pup works
    // FR_K faster per level of its best friend on the same job; close friends may have a puppy (>= PUPPY_GAP apart)
    FR_LV: [0, 2, 6, 14], FR_K: 0.04, PUPPY_GAP: 8 * H, PUPPY_GROW: 6 * H,
    // step 5: how far the full-size tree's roots reach (m from the trunk, world space, 72 sectors of 5 deg from +x toward +z):
    // the library's EG_ElderTree vertices below piece-space y 6 (re-make with __game.rootReach() if the tree model changes)
    ROOT: [23.5, 55.3, 66.8, 85.9, 69.3, 59.4, 48.7, 63.2, 50.4, 45.6, 44, 52.6, 81.7, 78.4, 32.4, 33, 21.5, 20.8, 20.9, 21.5, 28.1, 28.9, 35.3, 70.1, 60.2, 51.1, 30.1, 51.4, 60.9, 59.5, 57.2, 57.1,
      51.1, 62.1, 48.7, 42.2, 50, 79.4, 58.1, 27.8, 28.1, 28.3, 37.5, 46.6, 54.4, 83.7, 77.1, 46.2, 59.1, 62, 43.4, 53.3, 60.4, 77.2, 32.5, 34.6, 34.2, 28.9, 58.3, 76.1, 82.2, 52.7, 72.2, 54.6, 57.3, 73.1,
      73.2, 57.1, 46.7, 39.6, 33.2, 24.4],
    ROOT_PAD: 5, ROOT_R: 86,   // ROOT_R = the longest root (UI / camera)
  };
  const NEW = ['nourish', 'protect', 'spirit'];
  const TASK_JOB = { garden: 'nourish', blight: 'protect', patrol: 'protect', stage: 'spirit', busk: 'spirit' };
  const PH = ['plant', 'feed', 'clear', 'watch', 'play'];
  const FR_NAMES = ['', 'friends', 'good friends', 'close friends'];
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const S_ = () => window.Sim;
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;

  function create(s) {
    s.wake = { t: null };
    s.blight = { n: 0, list: [], slot: null, cleared: 0 };
    s.wards = [];
    s.garden = { sprouts: [], fed: 0 };
    s.fr = { pairs: {}, lastPuppy: -1e9, puppies: 0 };
  }
  // -1 = asleep, else 0..1 = how far its decay has ramped up
  function awakeK(s, k) {
    if (!s.wake || s.wake.t === null || C.WAKE[k] === undefined) return -1;
    const t0 = s.wake.t + C.WAKE[k]; if (s.time < t0) return -1;
    return Math.min(1, (s.time - t0) / C.RAMP);
  }
  const jobOpen = (s, job) => !NEW.includes(job) || awakeK(s, job) >= 0;
  const wakeAt = (s, k) => s.wake && s.wake.t !== null ? s.wake.t + C.WAKE[k] : null;

  // ---- buildings this file cares about
  const built = (s, type) => { let n = 0; for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === type) n++; } return n; };
  const firstBuilt = (s, type) => { let b = null; for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === type && (b === null || +k < b)) b = +k; } return b; };
  const gardens = s => { const a = []; for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === 'garden') a.push(+k); } return a.sort((x, y) => x - y); };
  const sproutMax = s => C.GARDEN.SPROUTS + (built(s, 'conserv') ? C.GARDEN.CONS_SPROUTS : 0) + (built(s, 'greenhold') ? S_().C.FAC.greenhold.sprouts : 0);
  // step 5: the grown tree's roots: from L4 on, blight never creeps in where a root lies (ROOT[sector] x the tree scale +
  // ROOT_PAD), and a level-up pushes out the patches the new roots cover. L1-3 keep step 4's rule (every spot, as reviewed).
  const rootAt = (nav, p) => { const N = C.ROOT.length, a = Math.floor(((Math.atan2(p[2] - nav.TP[2], p[0] - nav.TP[0]) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * N) % N; return C.ROOT[a]; };
  const rootR = s => C.ROOT_R * S_().scaleOf(s);
  const spotOk = (s, nav, k) => { const sp = nav.blightSpots[k]; return !!sp && (s.level <= 3 ? k < nav.blightInner : sp.r >= rootAt(nav, sp.p) * S_().scaleOf(s) + C.ROOT_PAD); };
  function okSpots(s, nav) { const a = []; for (let k = 0; k < nav.blightSpots.length; k++) if (spotOk(s, nav, k)) a.push(k); return a; }
  function rootsGrew(s, nav, ev) {
    const out = s.blight.list.filter(b => !spotOk(s, nav, b.k)); if (!out.length) return 0;
    s.blight.list = s.blight.list.filter(b => spotOk(s, nav, b.k));
    for (const b of out) if (ev) ev.push({ type: 'cleared', id: b.id, k: b.k, pup: -1, roots: true });   // guardians on it re-pick (finish: patch gone)
    return out.length;
  }

  // ---- blight
  const load = s => s.blight.list.reduce((a, b) => a + b.r, 0);
  function warded(s, nav, k) {
    const sp = nav.blightSpots[k]; if (!sp) return false;
    for (const w of s.wards) { const ws = nav.wardSpots[w]; if (ws && Math.hypot(ws.p[0] - sp.p[0], ws.p[2] - sp.p[2]) <= C.BLIGHT.WARD_R) return true; }
    return false;
  }
  function spawnAt(s, k, ev, why) {
    const b = { id: ++s.blight.n, k, t: Math.round(s.time), r: C.BLIGHT.R0 };
    s.blight.list.push(b); if (ev) ev.push({ type: 'blight', id: b.id, k, why }); return b;
  }
  // a blight wave (event): n patches on free spots picked by hash, up to WAVE_MAX
  function wave(s, nav, n, h, ev) {
    const V = okSpots(s, nav), N = V.length; let made = 0; if (!N) return 0;
    for (let j = 0; j < 12 && made < n && s.blight.list.length < C.BLIGHT.WAVE_MAX; j++) {
      const k = V[hash(h + j * 7919) % N]; if (s.blight.list.some(b => b.k === k)) continue;
      spawnAt(s, k, ev, 'wave'); made++;
    }
    return made;
  }
  function blightSlot(s, nav, slot, ev) {
    const B = C.BLIGHT, V = okSpots(s, nav), N = V.length; if (!N) return;
    const seed = s.events ? s.events.seed : 1, h = hash(Math.imul(seed, 31) + Math.imul(slot, 2654435761));
    const k = V[h % N], u = (hash(h + 1) % 10000) / 10000, there = s.blight.list.find(b => b.k === k);
    if (there) there.r = Math.min(1, there.r + 0.2);   // creeping: an old patch grows instead of a new one
    else if (s.blight.list.length < B.MAX && u < B.P * (warded(s, nav, k) ? B.WARD_K : 1) * (built(s, 'hush') ? S_().C.FAC.hush.blightP : 1)) spawnAt(s, k, ev, 'creep');
    // spreading: only when the tree is struggling (cozy: a healthy tree keeps blight in check by itself)
    if (s.health < B.SPREAD_H) {
      for (const b of s.blight.list.slice()) {
        if (b.r < 1 || s.blight.list.length >= B.MAX) continue;
        if ((hash(h + b.id * 131) % 1000) / 1000 >= B.SPREAD_P * (warded(s, nav, b.k) ? B.WARD_K : 1)) continue;
        const sp = nav.blightSpots[b.k]; let best = -1, bd = Infinity;
        nav.blightSpots.forEach((o, j) => { if (s.blight.list.some(x => x.k === j) || !spotOk(s, nav, j)) return; const d = Math.hypot(o.p[0] - sp.p[0], o.p[2] - sp.p[2]); if (d < bd) { bd = d; best = j; } });
        if (best >= 0) spawnAt(s, best, ev, 'spread');
      }
    }
  }
  function placeWard(s, nav, k) {
    if (awakeK(s, 'protect') < 0 || (s.res.crystal || 0) < C.BLIGHT.WARD_COST - 1e-9) return -1;
    const W = nav.wardSpots; if (!W.length) return -1;
    if (k === undefined || k === null) {   // the free ward spot covering the most blight (then the most blight spots)
      let bk = -1, bv = -1;
      W.forEach((w, j) => {
        if (s.wards.includes(j)) return;
        let v = 0; nav.blightSpots.forEach((sp, m) => { if (spotOk(s, nav, m) && Math.hypot(w.p[0] - sp.p[0], w.p[2] - sp.p[2]) <= C.BLIGHT.WARD_R) v += 1 + 10 * s.blight.list.filter(b => b.k === m).reduce((a, b) => a + b.r, 0); });
        if (v > bv) { bv = v; bk = j; }
      });
      k = bk;
    }
    if (k < 0 || k >= W.length || s.wards.includes(k)) return -1;
    s.res.crystal -= C.BLIGHT.WARD_COST; s.wards.push(k); return k;
  }

  // ---- the new jobs' phase machines (called from Sim's begin / finish)
  function rankIn(s, i, job) { let r = 0; for (let k = 0; k < i; k++) if (s.pups[k].job === job) r++; return r; }
  function gardenSpot(s, i, nav) {
    const g = gardens(s), r = rankIn(s, i, 'nourish');
    if (g.length) { const pid = g[(r + s.pups[i].trips) % g.length]; return { at: nav.site(pid, r % 4), pid }; }
    return { at: nav.rest(24 + r % 4, S_().scaleOf(s)), pid: -1 };   // root beds in front of the door
  }
  function stageSpot(s, i, nav) {
    const st = firstBuilt(s, 'stage'), r = rankIn(s, i, 'spirit');
    if (st !== null) return { at: nav.site(st, r % 6), stage: true };
    return { at: nav.rest(20 + r % 3, S_().scaleOf(s)), stage: false };   // busking on the plaza
  }
  function begin(s, i, nav) {
    const p = s.pups[i], I = S_()._;
    p.task = null; p.tgt = null;
    if (p.job === 'nourish') { const g = gardenSpot(s, i, nav); p.task = 'garden'; p.tgt = g.pid; I.startWalk(s, p, nav, g.at, 'go'); }
    else if (p.job === 'protect') {
      // the biggest patch nobody is on yet (ties: the lower spot), else a patrol round to a ward spot / blight spot
      let best = null;
      for (const b of s.blight.list) { if (s.pups.some((q, j) => j !== i && q.task === 'blight' && q.tgt === b.id)) continue; if (!best || b.r > best.r + 1e-9 || (Math.abs(b.r - best.r) < 1e-9 && b.k < best.k)) best = b; }
      if (best) { p.task = 'blight'; p.tgt = best.id; I.startWalk(s, p, nav, blightStand(nav, best.k), 'go'); }
      else {
        const L = nav.wardSpots.length ? nav.wardSpots : nav.blightSpots, k = (i * 3 + p.trips) % Math.max(1, L.length);
        p.task = 'patrol'; I.startWalk(s, p, nav, L.length ? { p: L[k].p, n: L[k].n } : nav.rest(i, S_().scaleOf(s)), 'go');
      }
    } else if (p.job === 'spirit') { const st = stageSpot(s, i, nav); p.task = st.stage ? 'stage' : 'busk'; I.startWalk(s, p, nav, st.at, 'go'); }
  }
  // resting pups go and watch the show when there is a stage with performers (they dance while the music plays)
  function audience(s, i, nav) {
    const p = s.pups[i]; if (p.job !== 'rest') return null;
    const st = firstBuilt(s, 'stage'); if (st === null || !s.pups.some(q => q.job === 'spirit' && !q.exp)) return null;
    return nav.site(st, 6 + rankIn(s, i, 'rest') % 6);
  }
  // the guardian stands at the patch's edge on the tree side
  function blightStand(nav, k) {
    const sp = nav.blightSpots[k], TP = nav.TP, dx = TP[0] - sp.p[0], dz = TP[2] - sp.p[2], l = Math.hypot(dx, dz) || 1;
    return { p: [Math.round((sp.p[0] + dx / l * 4.5) * 1000) / 1000, sp.p[1], Math.round((sp.p[2] + dz / l * 4.5) * 1000) / 1000], n: sp.n };
  }
  function finish(s, i, nav, ev) {
    const p = s.pups[i], I = S_()._, Sim = S_(), sc = Sim.scaleOf(s);
    const work = (ph, dur, face) => { p.phase = ph; p.t = 0; p.dur = dur; p.face = face; };
    const toward = (a, b) => [b[0] - a[0], b[2] - a[2]];
    const next = () => { if (Sim.napNow(s, i)) I.goNap(s, i, nav); else I.begin(s, i, nav); };
    const supply = (need, k) => { const amt = Sim.C.SUPPLY[need] * p.acc / H * k; s.needs[need] = Math.min(100, s.needs[need] + amt); p.acc = 0; p.trips++; s.stats.trips++; return amt; };
    switch (p.phase) {
      case 'go':
        if (p.task === 'garden') work('plant', C.GARDEN.PLANT, p.tgt >= 0 && nav.plotBy[p.tgt] ? toward(p.at.p, nav.plotBy[p.tgt].pos) : toward(nav.TP, p.at.p));
        else if (p.task === 'blight') { const b = s.blight.list.find(x => x.id === p.tgt); if (!b) { next(); break; } const sp = nav.blightSpots[b.k]; work('clear', (C.GUARD.CLEAR + C.GUARD.CLEAR_R * b.r) * Sim.facK(s, 'hush', 'clear'), toward(p.at.p, sp.p)); }
        else if (p.task === 'patrol') work('watch', C.GUARD.WATCH, toward(nav.TP, p.at.p));
        else if (p.task === 'stage' || p.task === 'busk') work('play', C.PLAY, p.task === 'stage' ? toward(p.at.p, nav.plotBy[firstBuilt(s, 'stage')] ? nav.plotBy[firstBuilt(s, 'stage')].pos : nav.TP) : toward(nav.TP, p.at.p));
        else next();
        break;
      case 'plant': {
        // plant a seed when the beds have room: a glow sprout (boosts every gardener for SPROUT_LIFE)
        const g = s.garden; g.sprouts = g.sprouts.filter(x => s.time - x.t < C.GARDEN.SPROUT_LIFE);
        if (s.inv.seeds >= 1 && g.sprouts.length < sproutMax(s)) { s.inv.seeds -= 1; g.sprouts.push({ t: Math.round(s.time), k: p.tgt >= 0 ? p.tgt : -1 - ((rankIn(s, i, 'nourish') + g.sprouts.length) % 4) }); if (ev) ev.push({ type: 'sprout', pup: i }); }
        I.startWalk(s, p, nav, nav.door(sc), 'carry'); break;
      }
      case 'carry': work('feed', C.GARDEN.FEED, toward(p.at.p, nav.TP)); break;
      case 'feed': {
        const k = (1 + C.GARDEN.SPROUT_K * s.garden.sprouts.length) * (1 + C.GARDEN.CONS_K * Math.min(1, built(s, 'conserv'))) * Sim.facK(s, 'greenhold', 'nourish') * (window.Seasons ? window.Seasons.k(s, 'nourish') : 1) * (window.Catalog ? window.Catalog.at(s, nav).garden : 1) * (window.Weather ? window.Weather.k(s, 'nourish') : 1);   // water + flowers by the beds (catalog.js); wet ground helps (weather.js)
        const amt = supply('nourish', k); s.garden.fed++;
        if (ev) ev.push({ type: 'deliver', pup: i, job: 'nourish', amount: amt });
        next(); break;
      }
      case 'clear': {
        const j = s.blight.list.findIndex(x => x.id === p.tgt);
        if (j >= 0) { const b = s.blight.list[j]; s.blight.list.splice(j, 1); s.blight.cleared++; if (ev) ev.push({ type: 'cleared', id: b.id, k: b.k, pup: i }); }
        const amt = supply('protect', Sim.facK(s, 'hush', 'protect')); if (ev) ev.push({ type: 'deliver', pup: i, job: 'protect', amount: amt });
        next(); break;
      }
      case 'watch': { supply('protect', Sim.facK(s, 'hush', 'protect')); next(); break; }
      case 'play': {
        const amt = supply('spirit', (p.task === 'stage' ? 1 : C.BUSK_K) * Sim.facK(s, 'circus', 'spirit'));
        if (ev) ev.push({ type: 'deliver', pup: i, job: 'spirit', amount: amt });
        if (Sim.napNow(s, i)) I.goNap(s, i, nav);
        else if (p.task === 'busk' && firstBuilt(s, 'stage') !== null) I.begin(s, i, nav);   // a stage got built: move there
        else work('play', C.PLAY, p.face);
        break;
      }
      default: I.begin(s, i, nav);
    }
  }

  // ---- friendships: pups on the same job (both working, not on a trip / napping) become friends
  const key = (a, b) => a < b ? a + '.' + b : b + '.' + a;
  const lvOf = h => { let l = 0; while (l + 1 < C.FR_LV.length && h >= C.FR_LV[l + 1]) l++; return l; };
  const level = (s, a, b) => lvOf(s.fr.pairs[key(a, b)] || 0);
  function groups(s) {
    const g = {};
    s.pups.forEach((p, i) => { if (p.job === 'rest' || p.exp || p.phase === 'nap' || p.task === 'nap' || p.phase === 'arrive' || p.phase === 'away') return; (g[p.job] = g[p.job] || []).push(i); });
    return g;
  }
  // per pup: x work speed from its best friend on the same job (1 = none)
  function friendK(s) {
    const out = new Array(s.pups.length).fill(1), g = groups(s);
    for (const j in g) { const a = g[j]; if (a.length < 2) continue; for (const x of a) { let best = 0; for (const y of a) if (y !== x) best = Math.max(best, level(s, x, y)); out[x] = 1 + C.FR_K * best; } }
    return out;
  }
  function friendsOf(s, i) {
    const out = [];
    for (const k in s.fr.pairs) { const [a, b] = k.split('.').map(Number); if (a !== i && b !== i) continue; const l = lvOf(s.fr.pairs[k]); if (l > 0) out.push({ i: a === i ? b : a, lv: l, h: s.fr.pairs[k] }); }
    return out.sort((x, y) => y.h - x.h || x.i - y.i);
  }
  // the pair that would have the next puppy: close friends, the longest together first
  function puppyPair(s) {
    if (s.time - s.fr.lastPuppy < C.PUPPY_GAP) return null;
    let best = null, bh = -1;
    for (const k in s.fr.pairs) { const h = s.fr.pairs[k]; if (lvOf(h) < 3 || h <= bh) continue; const [a, b] = k.split('.').map(Number); if (!s.pups[a] || !s.pups[b]) continue; best = [a, b]; bh = h; }
    return best;
  }

  // ---- per sim step (after the pups moved, before the needs decay)
  function tick(s, dt, nav, ev) {
    // wake: the first sky trip landed (seeds!) -> Nourish now, Protect + 30 min, Spirit + 60 min
    if (s.wake.t === null && s.stats.exped >= 1) { s.wake.t = Math.round(s.time); if (ev) ev.push({ type: 'wake', need: 'nourish' }); }
    if (s.wake.t !== null) for (const k of ['protect', 'spirit']) { const t0 = s.wake.t + C.WAKE[k]; if (s.time < t0 && s.time + dt >= t0 && ev) ev.push({ type: 'wake', need: k }); }
    // blight: grows; a roll per SLOT once Protect is awake (slot times are fixed, so offline == online)
    const B = C.BLIGHT;
    for (const b of s.blight.list) b.r = Math.min(1, b.r + dt / B.GROW * (warded(s, nav, b.k) ? B.WARD_G : 1) * (window.Catalog ? window.Catalog.blightK(s, nav, b.k) : 1) * (1 - C.BLIGHT.R0));   // (warding stones: catalog.js)
    const pt = wakeAt(s, 'protect');
    if (pt !== null) {
      if (s.blight.slot === null) s.blight.slot = Math.floor(pt / B.SLOT);   // the first roll comes on the first slot after waking
      const t1 = s.time + dt;
      while ((s.blight.slot + 1) * B.SLOT <= t1) { s.blight.slot++; if (s.blight.slot * B.SLOT >= pt) blightSlot(s, nav, s.blight.slot, ev); }
      // the very first patch arrives with the wake-up (a clear "here is the new job" moment)
      if (s.time < pt && t1 >= pt && !s.blight.list.length && nav.blightSpots.length) { const V = okSpots(s, nav); if (V.length) spawnAt(s, V[(s.events ? s.events.seed : 1) % V.length], ev, 'creep'); }
    }
    // garden sprouts wilt after SPROUT_LIFE (their seed was used up)
    if (s.garden.sprouts.length && s.garden.sprouts[0].t + C.GARDEN.SPROUT_LIFE <= s.time) s.garden.sprouts = s.garden.sprouts.filter(x => s.time - x.t < C.GARDEN.SPROUT_LIFE);
    // conservatory: a little nourishment by itself
    if (awakeK(s, 'nourish') >= 0) { const c = built(s, 'conserv'), g = built(s, 'greenhold'); if (c || g) s.needs.nourish = Math.min(100, s.needs.nourish + (C.GARDEN.CONS_N * Math.min(1, c) + (g ? S_().C.FAC.greenhold.nourishH : 0)) * dt / H); }
    // step 5: the Circus keeps a little joy going by itself
    if (awakeK(s, 'spirit') >= 0 && built(s, 'circus')) s.needs.spirit = Math.min(100, s.needs.spirit + S_().C.FAC.circus.spiritH * dt / H);
    // friendships
    const g = groups(s), fk = built(s, 'sprout') ? S_().C.FAC.sprout.school : 1;   // the Sprout House school: friendships grow faster
    for (const j in g) { const a = g[j]; if (a.length < 2) continue; for (let x = 0; x < a.length; x++) for (let y = x + 1; y < a.length; y++) { const k = key(a[x], a[y]); s.fr.pairs[k] = (s.fr.pairs[k] || 0) + fk * dt / H; } }
  }
  // morale: music lifts everyone a little, a glum island (low Spirit) pulls everyone down a little
  function moraleAdd(s) {
    if (awakeK(s, 'spirit') < 0) return 0;
    let m = 0; if (s.pups.some(p => p.phase === 'play')) m += C.MUSIC_MORALE + (built(s, 'circus') ? S_().C.FAC.circus.music : 0);
    if (s.needs.spirit < C.GLUM_SPIRIT) m -= C.GLUM_MORALE;
    return m;
  }

  // ---- save
  function sanitize(s, o, nav) {
    const w = o && o.wake && typeof o.wake === 'object' ? o.wake : null;
    s.wake = { t: w && typeof w.t === 'number' && isFinite(w.t) ? Math.round(fin(w.t, 0, -1e12, 1e12)) : null };
    // a v4 island that already went on a trip: the new needs wake from now (staggered as on a fresh island)
    if (s.wake.t === null && !w && s.stats.exped >= 1) s.wake.t = Math.round(s.time);
    const b = o && o.blight && typeof o.blight === 'object' ? o.blight : {}, N = nav.blightSpots.length, used = new Set();
    s.blight = { n: Math.round(fin(b.n, 0, 0, 1e9)), list: [], slot: typeof b.slot === 'number' && isFinite(b.slot) ? Math.round(fin(b.slot, 0, -1e9, 1e12)) : null, cleared: Math.round(fin(b.cleared, 0, 0, 1e9)) };
    if (Array.isArray(b.list)) for (const x of b.list.slice(0, C.BLIGHT.WAVE_MAX)) {
      if (!x || !Number.isInteger(x.k) || x.k < 0 || x.k >= N || used.has(x.k)) continue; used.add(x.k);
      const id = Math.round(fin(x.id, 0, 1, 1e9)); if (s.blight.list.some(y => y.id === id)) continue;
      s.blight.list.push({ id, k: x.k, t: Math.round(fin(x.t, s.time, 0, 1e12)), r: fin(x.r, C.BLIGHT.R0, C.BLIGHT.R0, 1) }); if (id > s.blight.n) s.blight.n = id;
    }
    s.wards = Array.isArray(o && o.wards) ? [...new Set(o.wards.filter(k => Number.isInteger(k) && k >= 0 && k < nav.wardSpots.length))] : [];
    const g = o && o.garden && typeof o.garden === 'object' ? o.garden : {};
    s.garden = { sprouts: Array.isArray(g.sprouts) ? g.sprouts.filter(x => x && typeof x.t === 'number' && isFinite(x.t) && Number.isInteger(x.k)).slice(0, C.GARDEN.SPROUTS + C.GARDEN.CONS_SPROUTS).map(x => ({ t: Math.round(fin(x.t, 0, 0, 1e12)), k: x.k })) : [], fed: Math.round(fin(g.fed, 0, 0, 1e9)) };
    const f = o && o.fr && typeof o.fr === 'object' ? o.fr : {}, n = s.pups.length;
    s.fr = { pairs: {}, lastPuppy: fin(f.lastPuppy, -1e9, -1e9, 1e12), puppies: Math.round(fin(f.puppies, 0, 0, 1e6)) };
    if (f.pairs && typeof f.pairs === 'object') for (const k in f.pairs) {
      const m = /^(\d+)\.(\d+)$/.exec(k); if (!m) continue; const a = +m[1], c = +m[2];
      if (a >= c || c >= n) continue; const h = fin(f.pairs[k], 0, 0, 1e7); if (h > 0) s.fr.pairs[k] = h;
    }
    // pups whose new-job task points at something gone start over
    s.pups.forEach(p => {
      if (p.task === 'blight' && !s.blight.list.some(x => x.id === p.tgt)) { p.phase = 'idle'; p.task = null; p.tgt = null; p.leg = null; p.t = 0; p.dur = 0; }
      if (p.task === 'garden' && !(Number.isInteger(p.tgt) && (p.tgt === -1 || (s.plots[p.tgt] && s.plots[p.tgt].done && s.plots[p.tgt].type === 'garden')))) p.tgt = -1;
      if (p.task === 'stage' && firstBuilt(s, 'stage') === null) { p.phase = 'idle'; p.task = null; p.tgt = null; p.leg = null; p.t = 0; p.dur = 0; }
    });
  }

  window.Needs = { C, NEW, TASK_JOB, PH, FR_NAMES, create, awakeK, jobOpen, wakeAt, load, warded, wave, placeWard, begin, finish, tick, moraleAdd, friendK, friendsOf, level, lvOf, puppyPair,
    built, firstBuilt, gardens, sproutMax, blightStand, audience, sanitize, key, rootR, rootAt, spotOk, okSpots, rootsGrew };
})();
