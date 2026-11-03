// Pacing (2026-11-03, branch aeryn-pacing; save v14): growth that answers the player + somewhere for a big pile to go.
// Pure JS on the sim state (no three.js, no Math.random, no clock), loaded right after sim.js; tools/sim_check.mjs and
// tools/pacing_check.mjs load it too.
//   1B growth pace: the tree's xp per hour = Sim.C.XP_PER_H(health) x k. k = 1 on an island nobody touches (the shipped
//      clock: L2 ~0.3 h, L3 ~3 h, L4 ~21 h ...); things the player does push it up to K_MAX (needs met, every job filled,
//      homes built), neglect pulls it down to K_MIN, and the tree never stops: at least XP_MIN xp an hour.
//   2D sinks: island upgrades (a few levels each, rising costs, each a real sim number: see UP) + the tree offering
//      (sap + berries for OFFER.K extra growth over OFFER.DUR, once per OFFER.GAP of island time, can't skip a level:
//      it only speeds the rate) + "let the pups plan" invests a big surplus in the cheapest upgrade now and then.
// State S.pace = {up: {well: n, ...}, off: offering ends (sim s), offAt: last offering began, offN, auto: last pup buy}
// exists only once used (a fresh island has none = every older balance case + byte-identical round trip unchanged).
(function () {
  'use strict';
  const H = 3600;
  const C = {
    K_MIN: 0.8, K_MAX: 1.3,
    // needs met: each of the three later needs (nourish / protect / spirit) awake and at >= MET (asleep = not yet yours)
    NEED: 0.04, MET: 70,
    // jobs filled: each later need with >= 1 pup on it, and no builder standing about with nothing planned
    CREW: 0.02, BUSY: 0.02,
    // homes built (cottages, any kind): per home, up to HOMES of them
    HOME: 0.025, HOMES: 4,
    // neglect: below NEG_H health the pace drops, NEG at NEG_H - NEG_SPAN and lower
    NEG_H: 75, NEG_SPAN: 30, NEG: 0.2,
    XP_MIN: 45,   // xp an hour however the tree feels (~1/3 of a tree at 85 %): it never stalls
    // the tree offering: + K growth for DUR, one per GAP of island time; cost grows with the tree's level
    OFFER: { K: 0.1, DUR: 8 * H, GAP: 24 * H, LV: 2, cost: lv => ({ sap: 100 * lv, food: 150 * lv }) },
    // pups invest (with "let the pups plan" on): from tree level AUTO_LV, at most once per AUTO_GAP, only when the
    // stock holds AUTO_X x the price of every part of it
    AUTO_LV: 3, AUTO_GAP: 6 * H, AUTO_X: 2, AUTO_FOOD: 400,
  };
  // island upgrades: k per level (what the sim multiplies), max level, tree level, base cost x GROW^level (rounded to 5)
  const UP = {
    // (the piles a week leaves are mostly wood, stone + berries, sap a bit less: the prices lean the same way)
    well: { name: 'Deep well', ic: 'water', lv: 2, max: 5, k: 0.12, base: { sap: 60, stone: 150 }, txt: n => `Water carriers bring +${12 * n}% a bucket`, next: 'each bucket +12% more' },
    lamp: { name: 'Brighter lanterns', ic: 'light', lv: 2, max: 5, k: 0.12, base: { sap: 80, wood: 150 }, txt: n => `Lamplighters + lantern walks shine +${12 * n}%`, next: 'light +12% more' },
    roots: { name: 'Root gardens', ic: 'nourish', lv: 3, max: 5, k: 0.15, base: { sap: 60, food: 250 }, need: 'nourish', txt: n => `Root gardeners feed the tree +${15 * n}%`, next: 'gardeners +15% more' },
    berry: { name: 'Berry bushes', ic: 'food', lv: 3, max: 5, k: 0.2, base: { wood: 150, stone: 60 }, txt: n => `Berry patches grow +${20 * n}% berries`, next: 'berry patches +20% more' },
    shop: { name: "Builders' workshop", ic: 'build', lv: 3, max: 5, k: 0.15, base: { wood: 200, stone: 200 }, txt: n => `Builders work +${15 * n}% faster`, next: 'builders +15% faster' },
  };
  const ORDER = ['well', 'lamp', 'roots', 'berry', 'shop'];
  const GROW = 2;
  const S_ = () => window.Sim, N_ = () => window.Needs;
  const NEW = ['nourish', 'protect', 'spirit'];

  // ---- growth pace
  const lvOf = (s, id) => (s.pace && s.pace.up && s.pace.up[id]) || 0;
  const offerOn = s => !!(s.pace && s.pace.off > s.time);
  function homes(s) { let n = 0; for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === 'home') n++; } return n; }
  function idleBuilder(s) { if (s.queue.length || s.decide) return false; return s.pups.some(p => p.job === 'build' && !p.exp); }
  // -> {k, parts: {need, crew, home, neg, offer}} (each part = what it adds / takes away)
  function pace(s) {
    const N = N_(); let need = 0, crew = 0;
    for (const k of NEW) {
      const aw = N ? N.awakeK(s, k) >= 0 : false; if (!aw) continue;
      if (s.needs[k] >= C.MET) need += C.NEED;
      if (s.pups.some(p => p.job === k && !p.exp)) crew += C.CREW;
    }
    // nobody idle: the untouched start island's builder waits with nothing planned, so it stays at x1
    if (!idleBuilder(s)) crew += C.BUSY;
    const home = C.HOME * Math.min(C.HOMES, homes(s));
    const neg = C.NEG * Math.max(0, Math.min(1, (C.NEG_H - s.health) / C.NEG_SPAN));
    const offer = offerOn(s) ? C.OFFER.K : 0;
    const k = Math.max(C.K_MIN, Math.min(C.K_MAX, 1 + need + crew + home - neg)) + offer;
    return { k, need, crew, home, neg, offer };
  }
  const k = s => pace(s).k;
  // xp an hour for the sim (Sim.step): health rate x pace, never below the trickle
  const xpRate = s => Math.max(C.XP_MIN, S_().C.XP_PER_H(s.health) * k(s));
  // the words for the tree card: "Growing 1.2x" + why (what is helping, what is holding it back)
  function words(s) {
    const p = pace(s), why = [], low = [];
    if (p.need > 0) why.push(p.need >= 3 * C.NEED - 1e-9 ? 'needs met' : 'some needs met');
    if (p.crew > 0) why.push(p.crew >= 3 * C.CREW + C.BUSY - 1e-9 ? 'every job filled' : 'pups busy');
    if (p.home > 0) why.push(p.home >= C.HOME * C.HOMES - 1e-9 ? 'cosy homes' : 'homes built');
    if (p.offer > 0) why.push('your offering');
    if (p.neg > 0) low.push(s.health < 50 ? 'the tree is thirsty' : 'the tree could use care');
    if (idleBuilder(s)) low.push('a builder has nothing to do');
    return { k: p.k, p, why, low, x: (Math.round(p.k * 100) / 100).toFixed(2).replace(/0$/, '') };
  }

  // ---- island upgrades
  const costOf = (id, n) => { const u = UP[id], c = {}; for (const r in u.base) c[r] = Math.round(u.base[r] * Math.pow(GROW, n) / 5) * 5; return c; };
  const have = (s, r) => r === 'sap' ? s.sap : (s.res[r] || 0);
  function afford(s, c, x) { for (const r in c) if (have(s, r) < c[r] * (x || 1) - 1e-9) return false; return true; }
  function payC(s, c) { for (const r in c) { if (r === 'sap') s.sap -= c[r]; else s.res[r] -= c[r]; } }
  function ensure(s) { if (!s.pace) s.pace = { up: {}, off: 0, offAt: -1e9, offN: 0, auto: -1e9 }; return s.pace; }
  // -> {ok, why: unknown | max | level | asleep | cost (+ need)}
  function canUp(s, id) {
    const u = UP[id]; if (!u) return { ok: false, why: 'unknown' };
    const n = lvOf(s, id); if (n >= u.max) return { ok: false, why: 'max' };
    if (s.level < u.lv) return { ok: false, why: 'level' };
    if (u.need && N_() && N_().awakeK(s, u.need) < 0) return { ok: false, why: 'asleep' };
    const c = costOf(id, n), need = {}; let short = false;
    for (const r in c) { const m = c[r] - have(s, r); if (m > 1e-9) { need[r] = Math.ceil(m); short = true; } }
    return short ? { ok: false, why: 'cost', need, cost: c } : { ok: true, cost: c };
  }
  function buy(s, id) { const c = canUp(s, id); if (!c.ok) return c; payC(s, c.cost); const P = ensure(s); P.up[id] = lvOf(s, id) + 1; norm(P); return { ok: true, n: P.up[id] }; }
  // the sim's multipliers: exactly 1 with no upgrades
  // (update 3: Elder rings add a small bonus of their own, src/rings.js; none below Elder = exactly as before)
  const upK = (s, id) => { const n = lvOf(s, id), rb = s.elder && window.Rings ? window.Rings.upBonus(s, id) : 0; return (n ? 1 + UP[id].k * n : 1) + rb; };

  // ---- the tree offering
  function canOffer(s) {
    if (s.level < C.OFFER.LV) return { ok: false, why: 'level' };
    if (offerOn(s)) return { ok: false, why: 'on', left: s.pace.off - s.time };
    const P = s.pace; if (P && s.time - P.offAt < C.OFFER.GAP) return { ok: false, why: 'rest', left: P.offAt + C.OFFER.GAP - s.time };
    const c = C.OFFER.cost(s.level), need = {}; let short = false;
    for (const r in c) { const m = c[r] - have(s, r); if (m > 1e-9) { need[r] = Math.ceil(m); short = true; } }
    return short ? { ok: false, why: 'cost', need, cost: c } : { ok: true, cost: c };
  }
  function offer(s, ev) {
    const c = canOffer(s); if (!c.ok) return c; payC(s, c.cost);
    const P = ensure(s); P.off = Math.round(s.time + C.OFFER.DUR); P.offAt = Math.round(s.time); P.offN++;
    if (ev) ev.push({ type: 'offer', auto: false }); return { ok: true };
  }

  // ---- "let the pups plan": now and then the pups put a big surplus into the cheapest upgrade (Sim.step)
  function tick(s, dt, nav, ev) {
    if (!s.decide || s.level < C.AUTO_LV) return;
    const last = s.pace ? s.pace.auto : -1e9; if (s.time - last < C.AUTO_GAP) return;
    let best = null, bv = Infinity;
    for (const id of ORDER) {
      if (id === 'berry' && s.res.food > C.AUTO_FOOD) continue;   // a full pantry needs no more berries
      const c = canUp(s, id); if (!c.ok || !afford(s, c.cost, C.AUTO_X)) continue;
      let v = 0; for (const r in c.cost) v += c.cost[r]; if (v < bv) { bv = v; best = id; }
    }
    if (best === null) return;
    const r = buy(s, best); if (r.ok) { s.pace.auto = Math.round(s.time); if (ev) ev.push({ type: 'upgrade', id: best, n: r.n, auto: true }); }
  }

  // ---- save (v14): canonical key order so round trips stay byte-identical
  function norm(P) {
    const up = {}; for (const id of ORDER) if (P.up[id]) up[id] = P.up[id];
    const o = { up, off: P.off, offAt: P.offAt, offN: P.offN, auto: P.auto }; for (const k in P) delete P[k]; Object.assign(P, o); return P;
  }
  function sanitize(s, o) {
    delete s.pace; const p = o && o.pace; if (!p || typeof p !== 'object') return;
    const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
    const up = {}; if (p.up && typeof p.up === 'object') for (const id of ORDER) { const n = Math.round(fin(p.up[id], 0, 0, UP[id].max)); if (n) up[id] = n; }
    s.pace = norm({ up, off: Math.round(fin(p.off, 0, 0, s.time + C.OFFER.DUR)), offAt: Math.round(fin(p.offAt, -1e9, -1e9, s.time)), offN: Math.round(fin(p.offN, 0, 0, 1e6)), auto: Math.round(fin(p.auto, -1e9, -1e9, s.time)) });
  }

  window.Pacing = { C, UP, ORDER, GROW, pace, k, xpRate, words, homes, idleBuilder, costOf, canUp, buy, upK, lvOf, canOffer, offer, offerOn, tick, sanitize };
})();
