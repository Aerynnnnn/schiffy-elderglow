// Expeditions (step 3): send a team of 1-4 pups from the Expedition dock to a floating isle for a real-time trip.
// Pure JS on the sim state (no three.js, no Math.random, no clock): Sim.step calls Exped.tick, so online steps, the
// offline catch-up and a loaded save all finish trips the same way. The haul is a pure function of the trip (seed,
// destination, length, team snapshot), so it never depends on how the time was stepped.
// Cozy rules: nothing is ever lost (bad luck = a smaller haul), a team away does no island work but eats from the
// supplies it packed (not the pantry), a trip can be called off for a full refund until the boat lifts off.
// State: S.exp = { n, trips: [{ id, dest, tier, team: [pup idx], lv: [explorer lv at send], like: [..], seed, t0, dep, dur }],
//                  hauls: [haul records not opened yet] }, S.res.crystal, S.inv.seeds / decor / outfits, S.placed (decor on spots),
//        pup.exp = trip id while on a trip, pup.xpE = explorer xp. Pup phases: go (task 'exp', to the dock) -> board -> away.
(function () {
  'use strict';
  const H = 3600;
  const TIERS = [
    { sec: 1800, label: '30 min', food: 4, xp: 5 },
    { sec: 2 * H, label: '2 h', food: 10, xp: 20 },
    { sec: 4 * H, label: '4 h', food: 18, xp: 40 },
    { sec: 8 * H, label: '8 h', food: 32, xp: 80 },
  ];
  const C = {
    MAX_TEAM: 4, BASE_RES: 12, BASE_CRYSTAL: 0.5, ROLLS_PER_H: 2.5, MIN_ROLLS: 2, RARE: 0.006, LIKE_K: 1.6, LV_K: 0.1,
    BOARD_LV: 2, GATHER_MAX: 1800, FLY: 120, MAX_HAULS: 12,
    EXP_LV: [0, 20, 60, 140, 300, 600],   // explorer xp per level 1..6
  };
  // destinations: the nearby floating isles first (layout placement ids of role 'isle', visible in the sky), far sky
  // islands later (locked cards). res = weights of the resources found; roll = weights of the bonus rolls.
  const DEST = [
    { id: 'mossy', name: 'Mossy Isle', pid: 122, lv: 2, res: { wood: 3, food: 2 }, roll: { seeds: 3, crystal: 1, res: 3, decor: 1 }, decor: ['wisp-tree', 'glow-shrooms', 'fairy-ring'],
      blurb: 'A soft green isle of wisp trees: wood, berries and lots of seeds.' },
    { id: 'lantern', name: 'Lantern Rock', pid: 123, lv: 2, res: { stone: 3, wood: 1 }, roll: { crystal: 3, seeds: 1, res: 2, decor: 1 }, decor: ['rune-boulder', 'crystal-pillar'],
      blurb: 'Rune stones that hum in the wind: stone and crystals.' },
    { id: 'perch', name: 'Cloud Perch', pid: 124, lv: 3, res: { food: 2, stone: 1, wood: 1 }, roll: { decor: 3, crystal: 2, seeds: 1, res: 2 }, decor: ['fairy-ring', 'glow-shrooms', 'crystal-pillar'],
      blurb: 'High up where the fairies dance: decorations and crystals.' },
    { id: 'hollow', name: 'Sunken Hollow', pid: 95, lv: 3, res: { wood: 1, stone: 1, food: 1 }, roll: { seeds: 2, crystal: 2, res: 2, decor: 2 }, rare: 2, decor: ['wisp-tree', 'rune-boulder', 'glow-shrooms'],
      blurb: 'A low, misty isle full of lost things: rare finds twice as often.' },
    // step 5: the far isles open as the tree grows (Young II, Grown I, Grown II)
    { id: 'spires', name: 'Far Spires', pid: 115, lv: 4, res: { stone: 3, wood: 1 }, roll: { crystal: 4, decor: 2, seeds: 1, res: 2 }, decor: ['crystal-pillar', 'rune-boulder-b'],
      blurb: 'Tall crystal shards far out in the clouds: lots of crystals.' },
    { id: 'starfall', name: 'Starfall Isles', pid: 109, lv: 5, res: { food: 1, stone: 1, wood: 1 }, roll: { decor: 4, crystal: 2, seeds: 2, res: 1 }, rare: 2, decor: ['star-shard', 'fairy-ring', 'wisp-tree-b'],
      blurb: 'Where falling stars come to rest: decorations and rare finds.' },
    { id: 'ember', name: 'Ember Reach', pid: 120, lv: 6, res: { wood: 2, food: 2 }, roll: { seeds: 3, decor: 2, crystal: 2, res: 2 }, rare: 3, decor: ['spirit-sapling', 'rune-boulder-b', 'wisp-tree-b'],
      blurb: 'The warm isles at the edge of the sky: seeds, spirit saplings, the rarest finds.' },
  ];
  const DESTBY = {}; DEST.forEach((d, i) => { d.i = i; DESTBY[d.id] = d; });
  // decorations: kit pieces placed on free decor spots (nav.decorSpots); daily-gift decor maps onto kit pieces too
  const DECOR = {
    'wisp-tree': { name: 'Wisp tree', piece: 'EG_WispTree_A', s: 1.7 }, 'rune-boulder': { name: 'Rune boulder', piece: 'EG_RuneBoulder_A', s: 1.9 },
    'glow-shrooms': { name: 'Glow shrooms', piece: 'EG_GlowShrooms_A', s: 2.4 }, 'fairy-ring': { name: 'Fairy ring', piece: 'EG_FairyRing', s: 1.7 },
    'crystal-pillar': { name: 'Crystal pillar', piece: 'EG_CrystalPillar', s: 0.6 },
    'firefly-jar': { name: 'Firefly jar', piece: 'EG_GlowShrooms_B', s: 2.4 }, 'moon-lantern': { name: 'Moon lantern', piece: 'EG_Brazier', s: 1.8 },
    // step 5 (far isles)
    'rune-boulder-b': { name: 'Mossy rune stone', piece: 'EG_RuneBoulder_B', s: 1.9 }, 'star-shard': { name: 'Star shard', piece: 'EG_CrystalPillar', s: 0.9 },
    'wisp-tree-b': { name: 'Silver wisp tree', piece: 'EG_WispTree_B', s: 1.7 }, 'spirit-sapling': { name: 'Spirit sapling', piece: 'EG_SpiritTree', s: 0.3 },
  };
  // rare finds: isle pups (a breed the island doesn't have yet: Noodle) and sky outfits (names in Daily.OUTFITS)
  const ISLE_PUPS = [
    { id: 'nimbus', name: 'Nimbus', breed: 'noodle', collar: '#8fd8ff', like: 'light', dislike: 'stone' },
    { id: 'cirrus', name: 'Cirrus', breed: 'noodle', collar: '#c7b8ff', like: 'water', dislike: 'build' },
    { id: 'puffin', name: 'Puffin', breed: 'noodle', collar: '#ffc48a', like: 'food', dislike: 'rest' },
  ];
  const OUTFITS = ['cloud-cape', 'feather-cap', 'sky-goggles'];
  // what a pup's liked job helps find: x LIKE_K on that part of the haul (rest-lovers are lucky nappers: rare finds)
  const LIKE = { wood: 'wood', stone: 'stone', food: 'food', light: 'crystal', protect: 'crystal', water: 'seeds', nourish: 'seeds', build: 'decor', spirit: 'decor', rest: 'rare' };
  const LIKE_TXT = { wood: 'more wood', stone: 'more stone', food: 'more berries', crystal: 'more crystals', seeds: 'more seeds', decor: 'more decorations', rare: 'lucky: rare finds' };

  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const lvOf = xp => { let l = 1; while (l < C.EXP_LV.length && (xp || 0) >= C.EXP_LV[l]) l++; return l; };
  const S_ = () => window.Sim;

  function board(s) { for (const k in s.plots) { const e = s.plots[k]; if (e.type === 'board' && e.done) return +k; } return null; }
  const maxTrips = s => s.level >= 6 ? 3 : s.level >= 3 ? 2 : 1;   // step 5: a third boat at tree level 6
  const unlocked = (s, d) => !d.locked && s.level >= d.lv;
  // where the k-th team pup waits at the dock (beside the boat), and the boat's parking spot
  function dockSpot(s, nav, k) { const b = board(s); return b !== null ? nav.site(b, k) : nav.rest(k, S_().scaleOf(s)); }
  const busy = p => !!p.exp || p.phase === 'arrive';

  function canSend(s, nav, di, tier, team) {
    const d = DEST[di], T = TIERS[tier];
    if (board(s) === null) return { ok: false, why: 'Build the Expedition dock first' };
    if (!d || !T) return { ok: false, why: 'Pick an isle' };
    if (!unlocked(s, d)) return { ok: false, why: d.locked ? 'Far away: opens in a later update' : `Opens at tree level ${d.lv}` };
    if (s.exp.trips.length >= maxTrips(s)) return { ok: false, why: s.level >= 6 ? 'All three boats are out' : s.level >= 3 ? 'Both boats are out (a 3rd boat at tree level 6)' : 'The boat is out (a 2nd boat at tree level 3)' };
    if (!Array.isArray(team) || !team.length) return { ok: false, why: 'Pick 1-4 pups' };
    if (team.length > C.MAX_TEAM || new Set(team).size !== team.length) return { ok: false, why: 'Up to 4 pups' };
    for (const i of team) { const p = s.pups[i]; if (!p) return { ok: false, why: 'Pick 1-4 pups' }; if (busy(p)) return { ok: false, why: p.name + (p.exp ? ' is on a trip' : ' is still arriving') }; }
    const food = T.food * team.length; if (s.res.food < food - 1e-9) return { ok: false, why: `Needs ${food} berries for the trip` };
    return { ok: true, food };
  }
  function send(s, nav, di, tier, team) {
    const c = canSend(s, nav, di, tier, team); if (!c.ok) return null;
    const I = S_()._, n = s.exp.n++;
    const seed = hash(n * 7919 + di * 131 + tier * 17 + team.reduce((a, i) => a + (i + 1) * 31, 0) + Math.floor(s.time)) || 1;
    const trip = { id: n + 1, dest: di, tier, team: team.slice(), lv: team.map(i => lvOf(s.pups[i].xpE)), like: team.map(i => s.pups[i].like), seed, t0: Math.round(s.time * 1000) / 1000, dep: -1, dur: TIERS[tier].sec };
    s.res.food -= c.food; s.exp.trips.push(trip);
    team.forEach((i, k) => {
      const p = s.pups[i]; I.stopWalking(p, nav);
      p.exp = trip.id; p.task = 'exp'; p.tgt = null; p.acc = 0;
      I.startWalk(s, p, nav, dockSpot(s, nav, k), 'go');
    });
    return trip;
  }
  // call a trip off before the boat lifts off: supplies back, pups back to work
  function recall(s, nav, id) {
    const k = s.exp.trips.findIndex(t => t.id === id); if (k < 0) return false;
    const t = s.exp.trips[k]; if (t.dep >= 0) return false;
    s.res.food += TIERS[t.tier].food * t.team.length; s.exp.trips.splice(k, 1);
    for (const i of t.team) { const p = s.pups[i]; if (!p) continue; S_()._.stopWalking(p, nav); p.exp = null; }
    return true;
  }

  // ---- the haul: pure function of the trip (seed + destination + length + team snapshot) and what is still findable
  // (isle pups / outfits the island doesn't have yet = `own`, read at return time; the rare roll itself is seeded)
  function haul(trip, own) {
    const d = DEST[trip.dest], T = TIERS[trip.tier], hrs = T.sec / H, r = rng(trip.seed);
    const h = { res: { wood: 0, stone: 0, food: 0 }, crystal: 0, seeds: 0, decor: [], outfit: null, pup: null, cache: 0 };
    const likeK = what => 1 + (C.LIKE_K - 1) * trip.like.filter(l => LIKE[l] === what).length;
    const lvK = trip.lv.reduce((a, l) => a + 1 + C.LV_K * (l - 1), 0);   // = team size, + 10 % per explorer level above 1
    // base: every pup brings back resources (split by the isle's weights; a pup who loves that kind finds more)
    const rw = d.res, rs = Object.values(rw).reduce((a, b) => a + b, 0);
    trip.lv.forEach((l, m) => {
      const k = 1 + C.LV_K * (l - 1), luck = 0.75 + 0.5 * r();
      for (const res in rw) h.res[res] += C.BASE_RES * hrs * k * luck * rw[res] / rs * (LIKE[trip.like[m]] === res ? C.LIKE_K : 1);
    });
    h.crystal += C.BASE_CRYSTAL * hrs * lvK * (d.roll.crystal || 1) / 2 * likeK('crystal') * (0.75 + 0.5 * r());
    // bonus rolls: more pups = more rolls; liked jobs tilt the odds
    const n = Math.max(C.MIN_ROLLS, Math.round(hrs * C.ROLLS_PER_H * (0.6 + 0.4 * trip.lv.length)));
    const W = { seeds: d.roll.seeds || 0, crystal: d.roll.crystal || 0, res: d.roll.res || 0, decor: d.roll.decor || 0 };
    for (const l of trip.like) { const w = LIKE[l]; if (W[w] !== undefined) W[w] += 0.6; }
    const wsum = W.seeds + W.crystal + W.res + W.decor;
    const rareP = C.RARE * (d.rare || 1) * likeK('rare') * (1 + 0.05 * trip.lv.reduce((a, l) => a + l - 1, 0));
    let rare = false;
    for (let k = 0; k < n; k++) {
      const x = r(), y = r();
      if (!rare && x < rareP) { rare = true; continue; }
      let u = y * wsum;
      if ((u -= W.seeds) < 0) h.seeds += 1 + Math.floor(r() * 3 * likeK('seeds'));
      else if ((u -= W.crystal) < 0) h.crystal += 1 + Math.floor(r() * 2 * likeK('crystal'));
      else if ((u -= W.res) < 0) { const keys = Object.keys(rw), res = keys[Math.floor(r() * keys.length)]; h.res[res] += 5 + Math.floor(r() * 10 * likeK(res)); }
      else if (h.decor.length < 2 + Math.floor(likeK('decor'))) h.decor.push(d.decor[Math.floor(r() * d.decor.length)]);
      else h.crystal += 2;
    }
    if (rare) {   // a new isle pup or a sky outfit (whatever is still findable), else a crystal cache
      const pups = ISLE_PUPS.filter(p => !(own && own.pups.includes(p.id))), outs = OUTFITS.filter(o => !(own && own.outfits.includes(o)));
      const pick = r();
      if (pups.length && (pick < 0.5 || !outs.length)) h.pup = Object.assign({}, pups[Math.floor(r() * pups.length)]);
      else if (outs.length) h.outfit = outs[Math.floor(r() * outs.length)];
      else h.cache = 12;
    }
    for (const k in h.res) h.res[k] = Math.round(h.res[k]);
    h.crystal = Math.round(h.crystal + h.cache);
    return h;
  }
  const ownOf = s => ({ pups: s.pups.map(p => p.id).concat(s.invite ? [s.invite.id] : []), outfits: s.inv.outfits });

  function depart(s, t, nav) {
    t.dep = Math.round((s.time) * 1000) / 1000;
    t.team.forEach((i, k) => { const p = s.pups[i]; const at = dockSpot(s, nav, k); p.phase = 'away'; p.leg = null; p.t = 0; p.dur = 0; p.at = { p: at.p.slice(), n: at.n }; });
  }
  function land(s, t, nav, ev) {
    const I = S_()._, h = haul(t, ownOf(s)), T = TIERS[t.tier];
    for (const k in h.res) s.res[k] += h.res[k];
    s.res.crystal += h.crystal; s.inv.seeds += h.seeds;
    for (const d of h.decor) s.inv.decor.push(d);
    if (h.outfit) s.inv.outfits.push(h.outfit);
    let pupIdx = -1;
    if (h.pup) {
      // a new pup joins when there is a free bed (walks in from the dock), else waits as the invite, else a crystal cache
      if (s.pups.length < S_().bedsOf(s, nav) && s.pups.length < S_().C.MAX_PUPS) {
        const at = dockSpot(s, nav, t.team.length), p = I.newPup(h.pup, h.pup.like, { p: at.p.slice(), n: at.n });
        p.born = Math.round(s.time); p.isNew = true; p.isle = true; s.pups.push(p); pupIdx = s.pups.length - 1; s.stats.arrived++;
        I.startWalk(s, p, nav, nav.door(S_().scaleOf(s)), 'arrive');
      } else if (!s.invite) { s.invite = Object.assign({}, h.pup); h.waits = true; }
      else { h.crystal += 12; s.res.crystal += 12; h.pup = null; h.cache = 12; }
    }
    t.team.forEach((i, k) => {
      const p = s.pups[i]; if (!p) return; const at = dockSpot(s, nav, k);
      p.exp = null; p.task = null; p.tgt = null; p.phase = 'idle'; p.leg = null; p.t = 0; p.dur = 0; p.at = { p: at.p.slice(), n: at.n };
      p.xpE = (p.xpE || 0) + Math.round(T.xp * S_().facK(s, 'sprout', 'school'));   // the Sprout House trains explorers faster
    });
    s.stats.exped++;
    const rec = Object.assign({ id: t.id, dest: t.dest, tier: t.tier, team: t.team.slice(), names: t.team.map(i => s.pups[i] ? s.pups[i].name : '?'), at: Math.round(s.time), pupIdx }, h);
    s.exp.hauls.push(rec); while (s.exp.hauls.length > C.MAX_HAULS) s.exp.hauls.shift();
    if (ev) ev.push({ type: 'exp-back', trip: t.id, haul: rec });
  }
  // per sim step (after the pups moved): depart when the whole team is aboard (or after GATHER_MAX), land when due
  function tick(s, dt, nav, ev) {
    const tr = s.exp.trips; if (!tr.length) return;
    for (let k = 0; k < tr.length; k++) {
      const t = tr[k];
      if (t.dep < 0) {
        const aboard = t.team.every(i => s.pups[i] && s.pups[i].phase === 'board');
        if (aboard || s.time + dt - t.t0 >= C.GATHER_MAX) { depart(s, t, nav); if (ev) ev.push({ type: 'exp-go', trip: t.id }); }
      } else if (s.time + dt >= t.dep + t.dur) { land(s, t, nav, ev); tr.splice(k--, 1); }
    }
  }
  // the board's estimate (expected haul ignoring luck), for the team picker
  function estimate(s, di, tier, team) {
    const d = DEST[di], T = TIERS[tier], hrs = T.sec / H; if (!d || d.locked) return null;
    const like = team.map(i => s.pups[i].like), lv = team.map(i => lvOf(s.pups[i].xpE));
    const rs = Object.values(d.res).reduce((a, b) => a + b, 0), out = { res: {}, crystal: 0, rolls: 0, rare: 0, bonus: [] };
    for (const r in d.res) out.res[r] = 0;
    lv.forEach((l, m) => { for (const r in d.res) out.res[r] += C.BASE_RES * hrs * (1 + C.LV_K * (l - 1)) * d.res[r] / rs * (LIKE[like[m]] === r ? C.LIKE_K : 1); });
    for (const r in out.res) out.res[r] = Math.round(out.res[r]);
    const likeK = what => 1 + (C.LIKE_K - 1) * like.filter(l => LIKE[l] === what).length;
    out.crystal = Math.round(C.BASE_CRYSTAL * hrs * lv.reduce((a, l) => a + 1 + C.LV_K * (l - 1), 0) * (d.roll.crystal || 1) / 2 * likeK('crystal'));
    out.rolls = Math.max(C.MIN_ROLLS, Math.round(hrs * C.ROLLS_PER_H * (0.6 + 0.4 * lv.length)));
    out.rare = 1 - Math.pow(1 - C.RARE * (d.rare || 1) * likeK('rare') * (1 + 0.05 * lv.reduce((a, l) => a + l - 1, 0)), out.rolls);
    team.forEach((i, m) => { const w = LIKE[like[m]]; if (w && (w !== 'wood' && w !== 'stone' && w !== 'food' || d.res[w])) out.bonus.push({ i, what: w, txt: LIKE_TXT[w] }); });
    return out;
  }

  // ---- decorations: S.placed = [{ id, k, x, z, r }] anywhere on the island since 2026-11-01 (src/decor.js owns the rules +
  // the save); place(s, nav, id, k) = the old way, on the k-th (or first free) nav.decorSpots spot
  const ownedFree = (s, id) => s.inv.decor.filter(x => x === id).length - s.placed.filter(x => x.id === id).length;
  function place(s, nav, id, k) { return window.Decor.placeSpot(s, nav, id, k); }
  function unplace(s, k, nav) { return window.Decor.remove(s, nav, k); }

  // ---- save: repair or drop what doesn't fit (called by Sim.sanitize with the pups already rebuilt)
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const ID = /^[a-z0-9-]{1,24}$/;
  function sanitize(s, o, nav) {
    const e = o && o.exp && typeof o.exp === 'object' ? o.exp : {};
    s.exp = { n: Math.round(fin(e.n, 0, 0, 1e9)), trips: [], hauls: [] };
    const inTrip = new Map();
    if (Array.isArray(e.trips)) for (const t of e.trips) {
      if (!t || typeof t !== 'object' || !DEST[t.dest] || DEST[t.dest].locked || !TIERS[t.tier] || !Array.isArray(t.team)) continue;
      const team = t.team.filter((i, k, a) => Number.isInteger(i) && s.pups[i] && a.indexOf(i) === k && !inTrip.has(i)).slice(0, C.MAX_TEAM); if (!team.length) continue;
      const id = Math.round(fin(t.id, 0, 1, 1e9)); if (s.exp.trips.some(x => x.id === id)) continue;
      const lv = team.map((i, k) => Math.round(fin(Array.isArray(t.lv) ? t.lv[t.team.indexOf(i)] : 1, 1, 1, C.EXP_LV.length)));
      const like = team.map(i => Array.isArray(t.like) && typeof t.like[t.team.indexOf(i)] === 'string' && LIKE[t.like[t.team.indexOf(i)]] !== undefined ? t.like[t.team.indexOf(i)] : s.pups[i].like);
      const dep = fin(t.dep, -1, -1, 1e12), trip = { id, dest: t.dest, tier: t.tier, team, lv, like, seed: (Math.round(fin(t.seed, 1, 0, 4294967295)) >>> 0) || 1, t0: fin(t.t0, s.time, 0, 1e12), dep: dep < 0 ? -1 : dep, dur: TIERS[t.tier].sec };
      s.exp.trips.push(trip); team.forEach(i => inTrip.set(i, trip));
      if (id > s.exp.n) s.exp.n = id;
    }
    // pups: a trip member keeps its phase only if it fits the trip (walking to the dock / aboard / away), else it is put
    // back at the dock in the right state; a pup that claims a trip that isn't there goes back to work
    s.pups.forEach((p, i) => {
      const t = inTrip.get(i);
      if (!t) { if (p.task === 'exp' || p.phase === 'board' || p.phase === 'away') { p.phase = 'idle'; p.task = null; p.leg = null; p.t = 0; p.dur = 0; } p.exp = null; return; }
      p.exp = t.id; p.task = 'exp'; p.tgt = null;
      const at = () => { const a = dockSpot(s, nav, t.team.indexOf(i)); p.at = { p: a.p.slice(), n: a.n }; p.leg = null; p.t = 0; p.dur = 0; };
      if (t.dep >= 0) { if (p.phase !== 'away') { p.phase = 'away'; at(); } }
      else if (p.phase !== 'go' && p.phase !== 'board') { p.phase = 'board'; at(); p.dur = 1e9; }
    });
    if (Array.isArray(e.hauls)) for (const h of e.hauls.slice(-C.MAX_HAULS)) {
      if (!h || typeof h !== 'object' || !DEST[h.dest] || !TIERS[h.tier]) continue;
      const res = {}; for (const k of ['wood', 'stone', 'food']) res[k] = Math.round(fin(h.res && h.res[k], 0, 0, 1e7));
      const pup = h.pup && typeof h.pup === 'object' && ISLE_PUPS.find(x => x.id === h.pup.id);
      s.exp.hauls.push({ id: Math.round(fin(h.id, 0, 0, 1e9)), dest: h.dest, tier: h.tier, team: Array.isArray(h.team) ? h.team.filter(i => Number.isInteger(i) && s.pups[i]).slice(0, 4) : [],
        names: Array.isArray(h.names) ? h.names.filter(n => typeof n === 'string' && /^[^<>&"\u0000-\u001f]{1,24}$/.test(n)).slice(0, 4) : [], at: Math.round(fin(h.at, 0, 0, 1e12)),
        pupIdx: Number.isInteger(h.pupIdx) && s.pups[h.pupIdx] ? h.pupIdx : -1, res, crystal: Math.round(fin(h.crystal, 0, 0, 1e6)), seeds: Math.round(fin(h.seeds, 0, 0, 1e6)),
        decor: Array.isArray(h.decor) ? h.decor.filter(x => DECOR[x]).slice(0, 8) : [], outfit: OUTFITS.includes(h.outfit) ? h.outfit : null, pup: pup ? Object.assign({}, pup) : null,
        cache: Math.round(fin(h.cache, 0, 0, 1e3)), waits: h.waits === true });
    }
    // (placed decor: src/decor.js, run by Sim.sanitize before the pups)
    for (const p of s.pups) p.xpE = Math.round(fin(p.xpE, 0, 0, 1e7));
  }
  function create(s) { s.exp = { n: 0, trips: [], hauls: [] }; s.placed = []; }

  window.Exped = { C, TIERS, DEST, DESTBY, DECOR, ISLE_PUPS, OUTFITS, LIKE, LIKE_TXT, lvOf, board, maxTrips, unlocked, dockSpot, busy, canSend, send, recall, haul, ownOf, tick, estimate,
    place, unplace, ownedFree, sanitize, create, rng, hash };
})();
