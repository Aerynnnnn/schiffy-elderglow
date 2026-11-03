// Creative build (Round 3 update 2, save v13): the decoration catalogue, crafting, and what decorations DO for the island.
// Pure (no three.js, no Math.random), loaded right after decor.js; tools/sim_check.mjs loads it too.
//   Every catalogue piece is a kit piece the map already draws (instanced like free decor), registered into Exped.DECOR,
//   so placing / moving / packing away / snapshots / visits all go through src/decor.js unchanged.
//   Crafting is instant (the cost is the planning): Catalog.craft(S, id) pays and puts one in the shed (S.inv.decor);
//   uncraft gives the full cost back for a crafted one still in the shed. Rare pieces only come from trips / gifts (from).
//   Utility (the user's rule: most crafted / earned pieces do something, some are pure decoration): effects are LOCAL
//   (a piece counts only near what it helps), gently diminishing (bonus = min(cap, 1 - (1 - k)^n)), never needed (an island
//   with no decor gets exactly 1 everywhere = every balance case unchanged), deterministic (from S.placed + built plots only).
(function () {
  'use strict';
  const X_ = () => window.Exped, D_ = () => window.Decor;
  // ---- the sets (order = the Craft card's tabs)
  const SETS = [
    { id: 'path', name: 'Garden paths' }, { id: 'fence', name: 'Fences + hedges' }, { id: 'light', name: 'Lanterns' }, { id: 'seat', name: 'Benches + nooks' },
    { id: 'flower', name: 'Flower beds' }, { id: 'water', name: 'Ponds' }, { id: 'pup', name: 'Pup things' }, { id: 'sign', name: 'Signposts' },
    { id: 'shrine', name: 'Shrines + charms' }, { id: 'woods', name: 'Little woods' }, { id: 'sky', name: 'Sky treasures' },
    { id: 'grand', name: 'Grand wonders' },
  ];
  // ---- effects (fx): R = how close to what it helps (m), k = per piece, cap = the most all pieces of that kind add together
  const FX = {
    light: { k: 0.03, cap: 0.25, R: 8, ic: 'light', txt: 'Lamplit way: lamplighters bring a little more light (near a path)' },
    garden: { k: 0.08, cap: 0.25, R: 14, ic: 'nourish', txt: 'Garden spring: root gardeners + berry patches nearby grow more' },
    bloom: { k: 0.04, cap: 0.25, R: 14, ic: 'nourish', txt: 'Bees + blossoms: root gardeners + berry patches nearby grow a little more', as: 'garden' },
    rest: { k: 1, cap: 4, R: 16, ic: 'heart', txt: 'Cozy seat: every pup +1 happiness (near the plaza or a home)' },
    spirit: { k: 0.5, cap: 2, R: 30, ic: 'spirit', txt: 'Happy spot: Song +0.5 an hour (near the plaza or the stage)' },
    protect: { k: 0.1, cap: 0.3, R: 25, ic: 'protect', txt: 'Warding stone: blight nearby grows slower' },
    gather: { k: 0.05, cap: 0.25, R: 14, ic: 'wood', txt: 'Tidy yard: gatherers bring more (near a woodshed, stone yard or berry patch)' },
  };
  // critter sets: 3 pieces that species loves within CLUSTER m of each other = it comes x1.3 more often
  const CLUSTER = 30, CRIT_K = 1.3;
  // cost keys: wood, stone, food (berries), crystal, sap, seeds
  const P = [
    // garden path (walked on: no blocker)
    ['step-stones', 'path', 'Stepping stones', 'EG_StepStone', 1.9, { stone: 6 }, 1, 'gather', { walk: 1 }],
    ['pebble-path', 'path', 'Pebble path', 'EG_Pebbles', 2.2, { stone: 4 }, 1, 'gather', { walk: 1 }],
    ['log-step', 'path', 'Mossy log step', 'EG_FallenLog_B', 1.3, { wood: 8 }, 2, 'gather'],
    // fences + hedges (pure decoration)
    ['fence', 'fence', 'Picket fence', 'EG_Fence', 2, { wood: 6 }, 1, null],
    ['hedge', 'fence', 'Clipped hedge', 'EG_Bush_A', 1.6, { food: 10 }, 1, null, { crit: ['finch'] }],
    ['round-hedge', 'fence', 'Round hedge', 'EG_Bush_B', 1.4, { food: 12 }, 2, null, { crit: ['finch'] }],
    // lights
    ['lantern-post', 'light', 'Lantern post', 'EG_LanternPost', 2, { wood: 8, stone: 4, sap: 10 }, 2, 'light', { crit: ['moth'], glow: 1 }],
    ['light-orb', 'light', 'Light orb', 'EG_LightOrb', 1.4, { crystal: 2, sap: 25 }, 4, 'light', { crit: ['moth'], glow: 1 }],
    // benches + nooks
    ['bench', 'seat', 'Log bench', 'EG_Bench', 2, { wood: 10 }, 1, 'rest'],
    ['stump-seat', 'seat', 'Stump seat', 'EG_Stump', 1.6, { wood: 4 }, 1, 'rest'],
    ['picnic', 'seat', 'Picnic table', 'EG_Picnic', 2, { wood: 14, food: 10 }, 3, 'rest'],
    ['log-seat', 'seat', 'Fallen-log seat', 'EG_FallenLog_A', 0.9, { wood: 12 }, 2, 'rest'],
    // flower beds
    ['flower-bed', 'flower', 'Flower bed', 'EG_FlowerBed', 2, { wood: 4, food: 6 }, 1, 'bloom', { crit: ['sprite'] }],
    ['garden-box', 'flower', 'Garden box', 'EG_GardenBox', 1.8, { wood: 6, food: 4 }, 1, 'bloom', { crit: ['sprite'] }],
    ['flowers-pink', 'flower', 'Pink flowers', 'EG_FlowerPatch_A', 2.2, { food: 3 }, 1, 'bloom', { crit: ['sprite', 'finch'], walk: 1 }],
    ['flowers-gold', 'flower', 'Gold flowers', 'EG_FlowerPatch_B', 2.2, { food: 3 }, 1, 'bloom', { crit: ['sprite', 'finch'], walk: 1 }],
    ['flowers-blue', 'flower', 'Blue flowers', 'EG_FlowerPatch_C', 2.2, { food: 3 }, 1, 'bloom', { crit: ['sprite', 'finch'], walk: 1 }],
    ['clover-patch', 'flower', 'Clover patch', 'EG_Clover', 2.4, { food: 2 }, 1, null, { crit: ['hare'], walk: 1 }],
    ['mushroom-ring', 'flower', 'Mushroom ring', 'EG_Mushrooms', 2.4, { food: 4 }, 2, null, { crit: ['snail'], walk: 1 }],
    // water
    ['pond-small', 'water', 'Little pond', 'EG_Pond_C', 1, { stone: 10 }, 2, 'garden', { crit: ['frog'] }],
    ['pond', 'water', 'Lily pond', 'EG_Pond_A', 1, { stone: 16, food: 6 }, 3, 'garden', { crit: ['frog'] }],
    ['pond-long', 'water', 'Long pond', 'EG_Pond_B', 1, { stone: 24, food: 10 }, 4, 'garden', { crit: ['frog'] }],
    ['river-weeds', 'water', 'Water weeds', 'EG_RiverWeeds', 2, { food: 4 }, 1, null, { crit: ['frog'], walk: 1 }],
    // pup things
    ['wood-pile', 'pup', 'Wood pile', 'EG_WoodPile', 2, { wood: 12 }, 2, 'gather', { crit: ['fox'] }],
    ['berry-cart', 'pup', 'Berry cart', 'EG_BerryCart', 2, { wood: 16, food: 8 }, 3, 'gather'],
    // signs
    ['signpost', 'sign', 'Signpost', 'EG_Signpost', 2, { wood: 6 }, 1, 'spirit'],
    // woods (trees from seeds; critters love them)
    ['oak', 'woods', 'Round oak', 'EG_Oak_A', 1.6, { seeds: 1, food: 6 }, 2, null, { crit: ['owl', 'fox'] }],
    ['oak-tall', 'woods', 'Tall oak', 'EG_Oak_B', 1.5, { seeds: 1, food: 8 }, 3, null, { crit: ['owl', 'fox'] }],
    ['oak-little', 'woods', 'Little oak', 'EG_Oak_C', 1.6, { seeds: 1, food: 4 }, 2, null, { crit: ['owl', 'fox'] }],
    ['spruce', 'woods', 'Spruce', 'EG_Spruce_A', 1.4, { seeds: 1, food: 6 }, 2, null, { crit: ['owl'] }],
    ['spruce-b', 'woods', 'Snowy spruce', 'EG_Spruce_B', 1.4, { seeds: 1, food: 6 }, 3, null, { crit: ['owl'] }],
    ['stump', 'woods', 'Old stump', 'EG_Stump', 2.2, { wood: 2 }, 1, null, { crit: ['snail'] }],
    // pacing pass (2026-11-03): grand wonders = big, costly, pure decoration (somewhere for a week's pile to go; existing kit
    // models at a grand size, no stand-ins); critters still like them
    ['grand-wisp', 'grand', 'Elder wisp tree', 'EG_WispTree_B', 3.2, { wood: 2000, food: 800, sap: 300 }, 4, null, { crit: ['owl'] }],
    ['grand-ring', 'grand', 'Moonlit fairy circle', 'EG_FairyRing', 3.4, { food: 2000, stone: 600, sap: 300 }, 4, null, { crit: ['sprite', 'snail'] }],
    ['grand-crystal', 'grand', 'Crystal spire', 'EG_CrystalPillar', 1.8, { stone: 2500, crystal: 12, sap: 400 }, 5, null, { crit: ['deer'] }],
    ['grand-spirit', 'grand', 'Great spirit tree', 'EG_SpiritTree', 0.75, { wood: 1500, food: 1500, seeds: 3, sap: 500 }, 6, null, { crit: ['sprite', 'owl'] }],
  ];
  // the step-3 / step-5 decorations (trips + daily gifts) join the catalogue with an effect; never crafted
  const OLD = {
    'wisp-tree': ['woods', 'trip', null, ['owl']], 'wisp-tree-b': ['sky', 'trip', null, ['owl']], 'rune-boulder': ['shrine', 'trip', 'protect', ['deer']],
    'rune-boulder-b': ['shrine', 'trip', 'protect', ['deer']], 'glow-shrooms': ['light', 'trip', 'light', ['snail', 'moth']], 'fairy-ring': ['shrine', 'trip', 'spirit', ['sprite', 'snail']],
    'crystal-pillar': ['shrine', 'trip', 'protect', ['deer']], 'firefly-jar': ['light', 'gift', 'light', ['moth']], 'moon-lantern': ['light', 'gift', 'light', ['moth']],
    'star-shard': ['sky', 'trip', 'spirit', ['deer']], 'spirit-sapling': ['shrine', 'trip', 'spirit', ['sprite']],
    // update 3: far-sky voyage finds + Elder ring gifts (never crafted; Exped.DECOR holds their pieces)
    'song-stone': ['sky', 'voyage', 'spirit', ['finch']], 'shoal-glowcaps': ['sky', 'voyage', 'light', ['snail', 'moth']], 'lighthouse-lamp': ['sky', 'voyage', 'light', ['moth']],
    'whale-stone': ['sky', 'voyage', 'protect', ['deer']], 'sister-sapling': ['sky', 'voyage', 'spirit', ['sprite']], 'starwell-stone': ['sky', 'voyage', 'protect', ['deer']],
    'edge-orb': ['sky', 'voyage', 'light', ['moth']], 'ring-orb': ['sky', 'ring', 'light', ['moth']], 'elder-wisp': ['sky', 'ring', null, ['owl']],
    'ring-stones': ['sky', 'ring', 'spirit', ['sprite', 'snail']], 'ring-lantern': ['sky', 'ring', 'light', ['moth']],
  };
  // the planned pieces that need new library models (kit_elderglow_build request): listed, never shown as stand-ins
  const NEEDS_LIBRARY = ['path tiles x3', 'edging stones', 'log fence', 'garden gate', 'hedge arch', 'string lights', 'lantern arch', 'nap nook', 'swing bench',
    'hammock', 'raised bed', 'flower barrel', 'sunflower row', 'bird bath', 'fountain', 'little waterfall', 'pup bed', 'food bowl', 'toy box', 'ball pit',
    'scratching post', 'kennel', 'name board', 'flower arch', 'welcome arch', 'wind chime', 'scarecrow charm', 'little shrine', 'lighthouse lamp',
    'whale-bone arch', 'shell chime', 'star-well stone', 'bloom petal seat'];

  const BY = {}, LIST = [];
  for (const [id, set, name, piece, s, cost, lv, fx, o] of P) { const e = { id, set, name, piece, s, cost, lv, fx, from: 'craft', crit: (o && o.crit) || [], walk: !!(o && o.walk), glow: !!(o && o.glow) }; BY[id] = e; LIST.push(e); }
  function register() {   // into Exped.DECOR (+ the decor PR's effects hook); idempotent
    const DEC = X_().DECOR;
    for (const e of LIST) if (!DEC[e.id]) DEC[e.id] = { name: e.name, piece: e.piece, s: e.s };
    for (const id in OLD) { const D = DEC[id]; if (!D || BY[id]) continue; const [set, from, fx, crit] = OLD[id];
      const e = { id, set, name: D.name, piece: D.piece, s: D.s, cost: null, lv: 1, fx, from, crit, walk: false, glow: /lantern|jar|shrooms|glowcaps|lamp|orb|starwell/.test(id) }; BY[id] = e; LIST.push(e); }
    const EF = D_() && D_().EFFECTS; if (EF) for (const e of LIST) if (e.fx) EF[e.id] = e.fx;
  }
  register();
  const fxOf = id => { const e = BY[id]; return e && e.fx ? FX[e.fx] : null; };

  // ---- crafting
  const COST_KEYS = ['wood', 'stone', 'food', 'crystal', 'sap', 'seeds'];
  const have = (s, k) => k === 'sap' ? s.sap : k === 'seeds' ? s.inv.seeds : (s.res[k] || 0);
  const pay = (s, k, v) => { if (k === 'sap') s.sap -= v; else if (k === 'seeds') s.inv.seeds -= v; else s.res[k] -= v; };
  // -> {ok, why: 'unknown' | 'rare' | 'level' | 'cost' (+ need {k: missing})}
  function canCraft(s, id) {
    const e = BY[id]; if (!e) return { ok: false, why: 'unknown' };
    if (e.from !== 'craft') return { ok: false, why: 'rare' };
    if ((s.level || 1) < e.lv) return { ok: false, why: 'level' };
    const need = {}; let short = false; for (const k in e.cost) { const m = e.cost[k] - have(s, k); if (m > 1e-9) { need[k] = Math.ceil(m); short = true; } }
    return short ? { ok: false, why: 'cost', need } : { ok: true };
  }
  function craft(s, id) {
    const c = canCraft(s, id); if (!c.ok) return c;
    const e = BY[id]; for (const k in e.cost) pay(s, k, e.cost[k]);
    s.inv.decor.push(id); s.inv.craft[id] = (s.inv.craft[id] || 0) + 1; return { ok: true };
  }
  // a crafted one still in the shed goes back for its full cost (changing your mind is free: the cost is the planning)
  const inShed = (s, id) => s.inv.decor.filter(x => x === id).length - (s.placed || []).filter(x => x.id === id).length;
  function uncraft(s, id) {
    const e = BY[id]; if (!e || !(s.inv.craft[id] > 0) || inShed(s, id) < 1) return false;
    for (const k in e.cost) pay(s, k, -e.cost[k]);
    s.inv.decor.splice(s.inv.decor.lastIndexOf(id), 1); s.inv.craft[id]--; if (!s.inv.craft[id]) delete s.inv.craft[id]; return true;
  }
  // save v13: S.inv.craft = {id: crafted count} (never more than owned); older saves: {} (their pieces were found, not crafted)
  function sanitize(s, o) {
    const c = o && o.inv && o.inv.craft && typeof o.inv.craft === 'object' ? o.inv.craft : {}; s.inv.craft = {};
    for (const id of Object.keys(c).sort()) { const e = BY[id], n = Math.floor(c[id]); if (!e || e.from !== 'craft' || !(n > 0)) continue;
      const own = s.inv.decor.filter(x => x === id).length; if (own) s.inv.craft[id] = Math.min(n, own); }
  }

  // ---- effects: what the placed pieces do, worked out once per layout of the island (cache: decor signature + built plots)
  const CACHE = new WeakMap();
  const gain = (k, n, cap) => Math.min(cap, 1 - Math.pow(1 - k, n));
  function targets(s, nav) {   // the spots each kind helps (built plots + fixed island places)
    const T = { garden: [], rest: [], spirit: [], gather: [] }, door = nav.door(1).p;
    T.spirit.push(door); for (let k = 0; k < 16; k++) T.rest.push(nav.rest(k, 1).p);   // the plaza nap spots in front of the door
    for (let k = 24; k < 28; k++) T.garden.push(nav.rest(k, 1).p);   // the four root beds
    for (const pid of Object.keys(s.plots || {}).sort((a, b) => a - b)) {
      const e = s.plots[pid], q = nav.plotBy[pid]; if (!e || !e.done || !q) continue;
      const at = q.door || q.pos;
      if (e.type === 'garden' || e.type === 'conserv' || e.type === 'greenhold') { T.garden.push(q.pos); T.gather.push(q.pos); }
      if (e.type === 'woodshed' || e.type === 'quarry') T.gather.push(q.pos);
      if (e.type === 'home' || e.type === 'nook') T.rest.push(at);
      if (e.type === 'stage' || e.type === 'circus') T.spirit.push(q.pos);
    }
    return T;
  }
  function compute(s, nav) {
    const T = targets(s, nav), n = { light: 0, garden: 0, bloom: 0, rest: 0, spirit: 0, protect: 0, gather: 0 }, near = (o, L, R) => L.some(p => Math.hypot(p[0] - o.x, p[2] - o.z) <= R);
    const prot = [], by = {};
    for (const o of s.placed || []) {
      const e = BY[o.id]; if (!e) continue;
      for (const c of e.crit) (by[c] = by[c] || []).push(o);
      if (!e.fx) continue; const F = FX[e.fx];
      if (e.fx === 'light') { if (nav.roadDist(o.x, o.z, F.R + 1) <= F.R) n.light++; }
      else if (e.fx === 'garden' || e.fx === 'bloom') { if (near(o, T.garden, F.R)) n[e.fx]++; }
      else if (e.fx === 'rest') { if (near(o, T.rest, F.R)) n.rest++; }
      else if (e.fx === 'spirit') { if (near(o, T.spirit, F.R)) n.spirit++; }
      else if (e.fx === 'gather') { if (near(o, T.gather, F.R)) n.gather++; }
      else if (e.fx === 'protect') prot.push(o);
    }
    // shaping the land (src/land.js): a flower meadow by a garden counts like a flower bed (bloom), a painted path that reaches
    // a work yard like a work-yard piece (gather), each once
    const Ld = s.land;
    if (Ld) {
      for (const m of Ld.meadows || []) if (T.garden.some(p => Math.hypot(p[0] - m.x, p[2] - m.z) <= FX.bloom.R + m.r)) n.bloom++;
      for (const P of Ld.paths || []) { let hit = false; for (let i = 0; i + 1 < P.p.length && !hit; i += 2) { const x = P.p[i] / 10, z = P.p[i + 1] / 10; if (T.gather.some(g => Math.hypot(g[0] - x, g[2] - z) <= FX.gather.R)) hit = true; } if (hit) n.gather++; }
    }
    const garden = Math.min(FX.garden.cap, gain(FX.garden.k, n.garden, 1) + gain(FX.bloom.k, n.bloom, 1));
    const crit = {}; for (const c in by) { const L = by[c]; crit[c] = L.some(a => L.filter(b => Math.hypot(a.x - b.x, a.z - b.z) <= CLUSTER).length >= 3) ? CRIT_K : 1; }
    return { n, prot, crit, light: 1 + gain(FX.light.k, n.light, FX.light.cap), garden: 1 + garden, gather: 1 + gain(FX.gather.k, n.gather, FX.gather.cap),
      rest: Math.min(FX.rest.cap, n.rest * FX.rest.k), spirit: Math.min(FX.spirit.cap, n.spirit * FX.spirit.k), blight: {} };
  }
  const landSig = s => s.land ? s.land.paths.map(P => P.k + ':' + P.p.length + ':' + P.p.join(',')).join('|') + '#' + s.land.meadows.map(m => m.x + ',' + m.z + ',' + m.r).join('|') : '';
  const sigOf = s => D_().sigOf(s) + '#' + Object.keys(s.plots || {}).filter(k => s.plots[k].done).sort((a, b) => a - b).map(k => k + s.plots[k].type).join(',') + '#' + landSig(s) + (window.Homes ? '#' + window.Homes.sigOf(s) : '');   // (a turned / free home's door moves its rest target)
  const landNone = s => !s.land || (!s.land.paths.length && !s.land.meadows.length);
  function at(s, nav) {
    if ((!s.placed || !s.placed.length) && landNone(s)) return NONE;
    const sig = sigOf(s), c = CACHE.get(s); if (c && c.sig === sig && c.nav === nav) return c.v;
    const v = compute(s, nav); CACHE.set(s, { sig, nav, v }); return v;
  }
  const NONE = { n: {}, prot: [], crit: {}, light: 1, garden: 1, gather: 1, rest: 0, spirit: 0, blight: {} };
  // blight growth multiplier for blight spot k (warding stones within R of it)
  function blightK(s, nav, k) {
    const v = at(s, nav); if (!v.prot.length) return 1;
    if (v.blight[k] !== undefined) return v.blight[k];
    const sp = nav.blightSpots[k]; if (!sp) return (v.blight[k] = 1);
    const n = v.prot.filter(o => Math.hypot(o.x - sp.p[0], o.z - sp.p[2]) <= FX.protect.R).length;
    return (v.blight[k] = 1 - gain(FX.protect.k, n, FX.protect.cap));
  }
  const critK = (s, nav, c) => at(s, nav).crit[c] || 1;
  // what one piece would add if put at (x, z) now (the place-mode line): {kind, links (targets in range), before, after}
  function preview(s, nav, id, x, z) {
    const e = BY[id]; if (!e || !e.fx) return null;
    const fake = { placed: (s.placed || []).concat([{ id, k: -7, x, z, r: 0 }]), plots: s.plots, level: s.level, land: s.land };
    const b = at(s, nav), a = compute(fake, nav), F = FX[e.fx], kind = F.as || e.fx;
    return { kind: e.fx, R: F.R, txt: F.txt, before: kind === 'protect' ? b.prot.length : b[kind], after: kind === 'protect' ? a.prot.length : a[kind], helps: kind === 'protect' ? nav.blightSpots.some(sp => Math.hypot(sp.p[0] - x, sp.p[2] - z) <= F.R) : a[kind] !== b[kind] };
  }
  // the land tools' line: would this meadow ({x, z, r}) / painted path ({p: [x10, z10, ...]}) do something here?
  function landPreview(s, nav, what, it) {
    const L0 = s.land || { paths: [], meadows: [] }, land = Object.assign({}, L0, what === 'meadow' ? { meadows: L0.meadows.concat([it]) } : { paths: L0.paths.concat([it]) });
    const b = at(s, nav), a = compute({ placed: s.placed || [], plots: s.plots, level: s.level, land }, nav), kind = what === 'meadow' ? 'garden' : 'gather';
    return { kind, fx: what === 'meadow' ? 'bloom' : 'gather', R: what === 'meadow' ? FX.bloom.R : FX.gather.R, helps: a[kind] !== b[kind] };
  }
  window.Catalog = { SETS, FX, LIST, BY, OLD, NEEDS_LIBRARY, COST_KEYS, CLUSTER, CRIT_K, register, fxOf, canCraft, craft, uncraft, inShed, sanitize, at, compute, blightK, critK, preview, landPreview };
})();
