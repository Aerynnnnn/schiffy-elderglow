// Far-sky voyages (roadmap update 3, 2026-11-03, branch aeryn-post-elder; save v15). Pure JS (no three.js, no Math.random, no
// clock), loaded right after expedition.js; the node checks load it too. Voyages ARE skyboat trips (src/expedition.js runs
// them: dock, boarding, a boat slot, landing, the haul card): six far isles past Ember Reach, appended LAST to Exped.DEST
// (older saved dest indices stay valid), each opened by an Elder ring (src/rings.js PERKS), each a long fixed trip (5-12 h:
// inside the 12 h offline cap, so a voyage is island time like every trip: offline == online == a reload).
//   Supplies = the late-game sink for the pacing pass's piles: wood + stone + glow sap for the boat, berries per pup per hour;
//   paid when the crew is sent, a full refund until lift-off. One voyage out at a time (it takes a boat), crew 2-4 (5 with
//   the 4th ring's seat). The haul is a pure function of the trip (seed, isle, team + `first` = first sail to that isle, kept
//   when it was sent): starlight (Elder ring progress = tree growth), lots of
//   crystals, seeds, a little of the isle's resources, the isle's story find the first time, then a chance at its rare
//   decorations / voyage outfits.
(function () {
  'use strict';
  const H = 3600;
  const C = {
    MIN_TEAM: 2,
    // supplies per hour of voyage: for the boat (whole crew) + berries per pup
    SUP: { wood: 360, stone: 150, sap: 30 }, FOOD: 30,
    KEEP: 400,   // berries a voyage always leaves in the pantry (the pups at home eat too)
    // starlight (Elder ring progress, = tree growth) = STAR_H x hours x crew (CREW0 + CREW_K x pups, x explorer levels) x luck (0.85..1.15):
    // a fixed amount, NOT a share of the ring, so the rings still slow down ring by ring (tools/elder_check.mjs: a sailing player ~ +35 % growth)
    STAR_H: 100, CREW0: 0.7, CREW_K: 0.1,
    CRYSTAL_H: 3, SEEDS_H: 0.8, RES_H: 10, XP_H: 30,
    DECOR_P: 0.35, OUTFIT_P: 0.2,
  };
  // at = [bearing (rad, from +x toward +z), distance m, height m] from the tree: where the boat sails off to (beyond the fog)
  const LIST = [
    { id: 'shoals', name: 'Whisper Shoals', h: 5, at: [0.6, 1900, 140], res: { food: 2, wood: 1 }, first: { decor: 'song-stone' }, decor: ['song-stone', 'shoal-glowcaps'], outfit: ['aurora-scarf'],
      blurb: 'Sand bars of cloud where lost songs wash up. Seeds, crystals and a humming stone.',
      go: 'The crew sails for the Whisper Shoals, ears pricked for a tune.', back: 'They came back humming a song nobody on the island ever taught them.' },
    { id: 'lighthouse', name: 'The Old Lighthouse', h: 6, at: [2.3, 2100, 220], res: { stone: 2, wood: 1 }, first: { decor: 'lighthouse-lamp' }, decor: ['lighthouse-lamp'], outfit: ['keeper-cape'],
      blurb: 'A lighthouse nobody tends, its lamp still warm. Crystals, and a lamp to bring home.',
      go: 'The crew sets off toward the blinking light at the edge of the sky.', back: 'They climbed every step, wound the old lamp, and left it shining a little brighter.' },
    { id: 'whale', name: 'Whale Rest', h: 8, at: [-0.9, 2400, 260], res: { food: 1, stone: 1 }, first: { outfit: 'cloudwool-cape' }, decor: ['whale-stone'], outfit: ['cloudwool-cape'],
      blurb: 'Where the sky whale sleeps between its journeys. Soft cloudwool and old stones.',
      go: 'The crew sails out on tiptoe, to the place where the sky whale sleeps.', back: 'The whale opened one huge eye, hummed, and went back to sleep. Nobody will ever forget it.' },
    { id: 'grove', name: 'The Sister Grove', h: 9, at: [3.6, 2600, 180], res: { wood: 2, food: 1 }, first: { decor: 'sister-sapling' }, decor: ['sister-sapling'], outfit: ['sister-hood'],
      blurb: 'Another great tree, grey and asleep. The pups bring her water and come home with seedlings.',
      go: 'The crew packs water buckets for a tree on the far side of the sky.', back: 'They watered the grey tree and sang to her. One of her leaves turned green before they left.' },
    { id: 'starwell', name: 'Starwell', h: 10, at: [1.5, 2800, 300], res: { stone: 2 }, first: { decor: 'starwell-stone' }, decor: ['starwell-stone'], outfit: ['star-sailor-hat'],
      blurb: 'A deep well where the stars come down to drink. Starlight by the bucket.',
      go: 'The crew sails up toward the well where the stars come down to drink.', back: 'They let down a bucket and pulled it up full of starlight. It is still glowing.' },
    { id: 'edge', name: 'The Far Edge', h: 12, at: [-2.4, 3000, 340], res: { wood: 1, stone: 1, food: 1 }, first: { outfit: 'edgelight-collar' }, decor: ['edge-orb'], outfit: ['edgelight-collar'],
      blurb: 'Where the clouds end and the stars begin. The longest voyage, the brightest finds.',
      go: 'The bravest crew yet sails for the very edge of the sky.', back: 'They sat with their paws over the edge of everything and watched the stars come up from below.' },
  ];
  const BY = {}, IDS = LIST.map(d => d.id);
  const OUTFITS = [...new Set(LIST.flatMap(d => d.outfit.concat(d.first.outfit ? [d.first.outfit] : [])))];
  const X_ = () => window.Exped, R_ = () => window.Rings;
  // register into Exped.DEST (appended last: older saved dest indices stay valid). lv 8 = Elder; `voy` marks the far isles
  function register() {
    const X = X_(); if (!X || X.DEST.some(d => d.voy)) return;
    for (const v of LIST) {
      const d = { id: v.id, name: v.name, pid: null, lv: 8, voy: v, res: v.res, roll: { crystal: 3, seeds: 2, decor: 2, res: 1 }, decor: v.decor, blurb: v.blurb, rare: 0 };
      d.i = X.DEST.length; X.DEST.push(d); X.DESTBY[d.id] = d; BY[v.id] = d;
    }
  }
  register();

  const secOf = d => d.voy.h * H;
  // supplies for a crew of n
  function supplies(d, n) { const h = d.voy.h, c = {}; for (const k in C.SUP) c[k] = Math.round(C.SUP[k] * h / 5) * 5; c.food = Math.round(C.FOOD * h * n / 5) * 5; return c; }
  const have = (s, k) => k === 'sap' ? s.sap : (s.res[k] || 0);
  function pay(s, c, sign) { for (const k in c) { if (k === 'sap') s.sap -= sign * c[k]; else s.res[k] -= sign * c[k]; } }
  const out = s => s.exp.trips.find(t => X_().DEST[t.dest] && X_().DEST[t.dest].voy) || null;
  // -> {ok, why} (the board's words) + cost; the general checks (dock, crew busy, boats) are Exped.canSend's
  function canSend(s, d, team) {
    if (!R_() || !R_().voyOpen(s, d.id)) { const n = R_() ? R_().voyRing(d.id) : 0; return { ok: false, why: s.level < 8 ? 'Far out in the sky: the Elder Tree first' : `Opens with Elder ring ${n}` }; }
    if (out(s)) return { ok: false, why: 'A voyage is already out: one at a time' };
    const max = X_().maxTeam(s);
    if (!Array.isArray(team) || team.length < C.MIN_TEAM) return { ok: false, why: `A voyage needs a crew of ${C.MIN_TEAM}-${max}` };
    if (team.length > max) return { ok: false, why: `A skyboat holds ${max} pups` };
    const c = supplies(d, team.length), need = {}; let short = false;
    for (const k in c) { const m = c[k] + (k === 'food' ? C.KEEP : 0) - have(s, k); if (m > 1e-9) { need[k] = Math.ceil(m); short = true; } }
    if (short) return { ok: false, why: need.food && Object.keys(need).length === 1 ? `The pantry keeps ${C.KEEP} berries for the pups at home: a few more needed` : 'A little more needed for the supplies', need, cost: c };
    return { ok: true, cost: c };
  }

  // ---- the haul: pure function of the trip
  function haul(trip, own) {
    const X = X_(), d = X.DEST[trip.dest], v = d.voy, hrs = v.h, r = X.rng(trip.seed);
    const n = trip.lv.length, lvK = trip.lv.reduce((a, l) => a + 1 + X.C.LV_K * (l - 1), 0) / Math.max(1, n);   // the crew's explorer levels
    const crew = (C.CREW0 + C.CREW_K * n) * lvK;
    const h = { res: { wood: 0, stone: 0, food: 0 }, crystal: 0, seeds: 0, decor: [], outfit: null, pup: null, cache: 0, star: 0, voy: true, first: !!trip.first };
    h.star = Math.round(C.STAR_H * hrs * crew * (0.85 + 0.3 * r()));
    h.crystal = Math.round(C.CRYSTAL_H * hrs * crew * (0.8 + 0.4 * r()));
    h.seeds = Math.round(C.SEEDS_H * hrs * crew * (0.7 + 0.6 * r()));
    const rs = Object.values(v.res).reduce((a, b) => a + b, 0);
    for (const k in v.res) h.res[k] = Math.round(C.RES_H * hrs * crew * v.res[k] / rs * (0.75 + 0.5 * r()));
    const owns = o => !!(own && own.outfits.includes(o));
    if (trip.first) {   // the isle's story find, once
      if (v.first.decor) h.decor.push(v.first.decor);
      if (v.first.outfit && !owns(v.first.outfit)) h.outfit = v.first.outfit; else if (v.first.outfit) h.crystal += 15;
    } else {
      const a = r(), b = r(), c = r();
      if (a < C.DECOR_P) h.decor.push(v.decor[Math.floor(b * v.decor.length)]);
      const left = v.outfit.filter(o => !owns(o));
      if (c < C.OUTFIT_P) { if (left.length) h.outfit = left[Math.floor(r() * left.length)]; else { h.cache = 15; h.crystal += 15; } }
    }
    for (const l of trip.like) { const w = X.LIKE[l]; if (w === 'crystal') h.crystal += Math.round(2 * hrs); else if (w === 'seeds') h.seeds += Math.round(0.5 * hrs); }
    return h;
  }
  // the board's estimate (luck in the middle)
  function estimate(s, d, team) {
    const X = X_(), v = d.voy, n = team.length; if (!n) return null;
    const lvK = team.reduce((a, i) => a + 1 + X.C.LV_K * (X.lvOf(s.pups[i].xpE) - 1), 0) / n, crew = (C.CREW0 + C.CREW_K * n) * lvK;
    const R = R_(), need = R ? R.progress(s).need : 0, first = !(s.elder && s.elder.vy && s.elder.vy[d.id]), star = Math.round(C.STAR_H * v.h * crew);
    return { star, starF: need ? star / need : 0, crystal: Math.round(C.CRYSTAL_H * v.h * crew), seeds: Math.round(C.SEEDS_H * v.h * crew), first, cost: supplies(d, n) };
  }
  // the words: a departure / return line (the isle's own), the story find
  const words = d => ({ go: d.voy.go, back: d.voy.back });

  window.Voyages = { C, LIST, BY, IDS, OUTFITS, register, secOf, supplies, pay, out, canSend, haul, estimate, words };
})();
