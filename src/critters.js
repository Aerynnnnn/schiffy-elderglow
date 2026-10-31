// Critters (Round 2 step 3, pure, no three.js, no Math.random, no clock): magical sky creatures that VISIT the island,
// drawn by the decorations + buildings the player places, and a Neko Atsume-style critter album. Loaded after story.js;
// Sim.step calls Critters.tick (after Events: a shower is rain for the lily frogs), Sim.create / sanitize call create /
// sanitize. State S.crit (save v9) = { seed, slot, n, vis: [visits here now], al: {species: album entry}, log: [last visits] }.
//
// VISITS: one roll per SLOT of island time per species, from a hash of (seed, slot, species) - like Events - so online steps,
// the offline catch-up (any step size) and a reloaded save agree exactly. The chance = rarity x how well the island's clock
// (night / dusk / day / dawn) and season suit it x how much the island has of what it loves (attract(): placed decor,
// buildings, wards, water, rain...) - so decor really decides who comes. A visit picks one of its favourite spots (a string
// key the renderer turns into a place: 'd3' decor on decor spot 3, 'p88' building plot 88, 'w2' ward spot 2, 'r1' water spot
// 1, 'f0' forest tree, 't5' round the tree, 'o2' light orb, 'e4' a free meadow spot, 's1' a sky path), stays a while, leaves,
// sometimes leaving a small gift (credited when it leaves, online or offline). At most MAX visitors at once (+ the whale).
// ALBUM: a visit nobody tapped = a "glimpse" (name known, no card yet); tapping a visitor (Critters.tap) = seen: the card. The
// player's tap only marks things seen, it never changes a later roll. Hints for unseen critters get clearer as the colour comes
// back (the game passes Story's ring).
(function () {
  'use strict';
  const H = 3600, MIN = 60;
  const C = {
    SLOT: 1200, START: 600, MAX: 4, LOG: 30, RAIN_K: 4,
    P: { common: 0.05, uncommon: 0.025, rare: 0.015, legendary: 0.0028 },   // per slot at a perfect match
  };
  // when: d day, k dusk, n night, a dawn (0..1 each); sea: [spring, summer, autumn, winter]; stay: minutes [min, max];
  // gift: what it sometimes leaves (pct = chance per visit); verb / where-text for the tree's voice
  const SP = [
    { id: 'owl', name: 'Wisp owl', piece: 'EG_Critter_WispOwl', rar: 'uncommon', when: { d: 0, k: 0.35, n: 1, a: 0.2 }, sea: [1, 1, 1, 1], stay: [45, 90],
      gift: { k: 'feather', name: 'a moon feather', sap: 8, pct: 30 }, fav: 'wisp trees', verb: 'perched', col: '#a99ad0',
      note: 'A wisp owl hoots in a voice like a lullaby. It likes to sit high in a wisp tree and watch the lanterns come on.',
      whenT: 'at night', hint: ['Something soft hoots in the dark...', 'It likes tall trees that glow a little.', 'Place a Wisp tree (sky trips to Mossy Isle).'] },
    { id: 'fox', name: 'Moss fox', piece: 'EG_Critter_MossFox', rar: 'common', when: { d: 1, k: 0.5, n: 0, a: 0.6 }, sea: [1, 1, 1.2, 0.6], stay: [30, 60],
      gift: { k: 'berries', name: 'a few berries', food: 8, pct: 25 }, fav: 'the woods + a woodshed', verb: 'curled up for a nap', col: '#e58a4a',
      note: 'The moss fox grows a little garden on its back. It naps wherever the wood smells nicest.',
      whenT: 'by day', hint: ['Small pawprints in the woods by day...', 'It loves the woods and the smell of fresh logs.', 'Build a Woodshed (or keep some woods).'] },
    { id: 'deer', name: 'Crystal deer', piece: 'EG_Critter_CrystalDeer', rar: 'rare', when: { d: 0.1, k: 1, n: 0.25, a: 0.6 }, sea: [1, 1, 1, 1.1], stay: [25, 45],
      gift: { k: 'shard', name: 'a crystal shard', crystal: 1, pct: 35 }, fav: 'crystal pillars + wards', verb: 'stood quietly', col: '#9fd8ff',
      note: 'The crystal deer\'s antlers ring like glass bells when it nods. It only comes where crystals sing.',
      whenT: 'at dusk', hint: ['Something chimes softly at sunset...', 'It is drawn to crystals that glow.', 'Place a Crystal pillar or set a crystal ward.'] },
    { id: 'moth', name: 'Glow moths', piece: 'EG_Critter_GlowMoth', rar: 'common', when: { d: 0, k: 0.6, n: 1, a: 0 }, sea: [1, 1, 1.3, 0.5], stay: [40, 80],
      gift: { k: 'dust', name: 'a pinch of glow dust', sap: 5, pct: 25 }, fav: 'lanterns', verb: 'danced', col: '#ffe59a', swarm: 5,
      note: 'Glow moths drift to warm light like pups to a fire. They dust everything they touch with a little shine.',
      whenT: 'at night', hint: ['Tiny lights flutter after dark...', 'They love warm lantern light.', 'Build a Lantern path or place a Moon lantern / Firefly jar.'] },
    { id: 'frog', name: 'Lily frog spirit', piece: 'EG_Critter_LilyFrog', rar: 'common', when: { d: 0.5, k: 0.8, n: 0.4, a: 1 }, sea: [1.2, 1, 0.8, 0.2], stay: [30, 60], rain: true,
      gift: { k: 'lily', name: 'a lily seed', seeds: 1, pct: 30 }, fav: 'the river in the rain', verb: 'sang', col: '#5cc29e',
      note: 'The lily frog spirit wears its pond as a hat. It sings the rain in, and sometimes it sings it out again.',
      whenT: 'in the rain', hint: ['Something croaks happily by the water...', 'It sings by the river, loudest in the rain.', 'Wait for a rain shower by the river.'] },
    { id: 'jelly', name: 'Sky jellyfish', piece: 'EG_Critter_SkyJelly', rar: 'uncommon', when: { d: 0.1, k: 1, n: 0.8, a: 0.2 }, sea: [0.3, 1.6, 0.4, 0.1], stay: [30, 60],
      gift: { k: 'drop', name: 'a sky drop', sap: 6, pct: 30 }, fav: 'the expedition dock', verb: 'drifted', col: '#f5b8e0', fly: true,
      note: 'Sky jellyfish float down from the high isles on warm evenings, glowing like paper lanterns that forgot their strings.',
      whenT: 'on summer evenings', hint: ['Pink lights drift down on warm evenings...', 'They follow the sky boats home from the isles.', 'Build the Expedition dock; summer evenings are best.'] },
    { id: 'hare', name: 'Snow hare', piece: 'EG_Critter_SnowHare', rar: 'common', when: { d: 1, k: 0.6, n: 0.1, a: 0.8 }, sea: [0, 0, 0.1, 1.4], stay: [30, 60],
      gift: { k: 'snowberry', name: 'snowberries', food: 6, pct: 25 }, fav: 'cosy cottages', verb: 'hopped about', col: '#dfe6f7',
      note: 'The snow hare has a little star of frost on its forehead. It visits cosy cottages to warm its paws by the windows.',
      whenT: 'in winter', hint: ['Small round tracks in the snow...', 'It visits warm cottages when it is cold.', 'Build cottages; it comes in winter.'] },
    { id: 'sprite', name: 'Petal sprites', piece: 'EG_Critter_PetalSprite', rar: 'common', when: { d: 1, k: 0.4, n: 0, a: 0.6 }, sea: [1.5, 0.4, 0.15, 0], stay: [30, 50],
      gift: { k: 'petal', name: 'a petal seed', seeds: 1, pct: 30 }, fav: 'gardens + fairy rings', verb: 'played', col: '#f2a9cf', swarm: 3,
      note: 'Petal sprites are born when a blossom laughs. They play tag in gardens and fall asleep in flowers.',
      whenT: 'in spring', hint: ['Giggles among the flowers...', 'They play where things bloom and grow.', 'Build a Berry garden or place a Fairy ring; spring is best.'] },
    { id: 'finch', name: 'Song finch', piece: 'EG_Critter_SongFinch', rar: 'uncommon', when: { d: 1, k: 0.3, n: 0, a: 1 }, sea: [1.2, 1, 0.8, 0.6], stay: [25, 45],
      gift: { k: 'note', name: 'a song feather', sap: 6, pct: 30 }, fav: 'music (the stage)', verb: 'sang along', col: '#ffd24a',
      note: 'The song finch never sings its own song. It learns the pups\' tunes and sings them back, a little better.',
      whenT: 'by day', hint: ['A bright little voice joins in the music...', 'It comes wherever pups play music.', 'Build the Music stage (or let a pup busk).'] },
    { id: 'snail', name: 'Glow snail', piece: 'EG_Critter_GlowSnail', rar: 'common', when: { d: 0, k: 0.2, n: 1, a: 0.8 }, sea: [1.2, 1, 1.2, 0.3], stay: [60, 120],
      gift: { k: 'trail', name: 'a jar of glow trail', sap: 4, pct: 25 }, fav: 'glow shrooms + fairy rings', verb: 'left a glowing trail', col: '#b48cd8',
      note: 'The glow snail is in no hurry at all. It leaves a silver trail that shines until morning.',
      whenT: 'at night', hint: ['A silver line shines on the ground at dawn...', 'It loves mushrooms and soft garden soil.', 'Place Glow shrooms or a Fairy ring (root sprouts help).'] },
    { id: 'whale', name: 'Sky whale', piece: 'EG_Critter_SkyWhale', rar: 'legendary', when: { d: 1, k: 1, n: 0.6, a: 0.8 }, sea: [1, 1, 1, 1], stay: [14, 18], minLv: 2,
      gift: { k: 'song', name: 'whale song: 2 crystals and glow sap', crystal: 2, sap: 20, pct: 100 }, fav: 'a healing island', verb: 'sang as it drifted', col: '#5b80cc', sky: true,
      note: 'Once in a long while a sky whale drifts over a healing island. Nobody knows where it goes. It always sings on the way.',
      whenT: 'once in a long while', hint: ['A song so low the leaves tremble...', 'It passes over islands that are healing.', 'Grow the tree; look up now and then (about once a week).'] },
  ];
  const BY = {}; SP.forEach((x, i) => { x.i = i; BY[x.id] = x; });
  const RAR = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const S_ = () => window.Sim, X_ = () => window.Exped;

  // ---------------------------------------------------------------- state
  function create(s) { s.crit = { seed: (hash((s.events && s.events.seed || 1) * 31 + 7) || 1) >>> 0, slot: Math.floor(s.time / C.SLOT), n: 0, vis: [], al: {}, log: [] }; }
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const int = (v, d, lo, hi) => Math.round(fin(v, d, lo, hi));
  const KEY = /^[dpwrftoes]-?\d{1,6}$/;
  function visIn(v, s) {
    if (!v || typeof v !== 'object' || !BY[v.c] || typeof v.k !== 'string' || !KEY.test(v.k)) return null;
    const t0 = fin(v.t0, null, 0, 1e12); if (t0 === null) return null;
    return { id: int(v.id, 0, 0, 1e9), c: v.c, k: v.k, t0, end: fin(v.end, t0 + 1800, t0, t0 + 3 * H), tap: v.tap === 1 ? 1 : 0 };
  }
  // v9: older saves start with an empty album (a seed from their event seed: stable), first roll on the next slot
  function sanitize(s, o) {
    create(s);
    const q = o && o.crit && typeof o.crit === 'object' ? o.crit : null; if (!q) return;
    const c = s.crit;
    if (Number.isInteger(q.seed) && q.seed > 0) c.seed = q.seed >>> 0;
    c.slot = int(q.slot, c.slot, 0, 1e12); c.n = int(q.n, 0, 0, 1e9);
    if (Array.isArray(q.vis)) { const seen = new Set(); for (const v of q.vis) { const x = visIn(v, s); if (x && !seen.has(x.c) && c.vis.length < C.MAX + 1) { seen.add(x.c); c.vis.push(x); } } }
    if (q.al && typeof q.al === 'object') for (const id of Object.keys(q.al)) { const a = q.al[id]; if (!BY[id] || !a || typeof a !== 'object') continue;   // key order kept (byte-identical round trip)
      c.al[id] = { v: int(a.v, 0, 0, 1e7), s: int(a.s, 0, 0, 1e7), g: int(a.g, 0, 0, 1e7), f: fin(a.f, -1, -1, 1e12), l: fin(a.l, -1, -1, 1e12) }; }
    if (Array.isArray(q.log)) for (const e of q.log.slice(-C.LOG)) { const x = visIn(e, s); if (x) { x.g = e.g === 1 ? 1 : 0; c.log.push(x); } }
  }
  const entry = (s, id) => s.crit.al[id] || (s.crit.al[id] = { v: 0, s: 0, g: 0, f: -1, l: -1 });

  // ---------------------------------------------------------------- what draws whom (pure: state + nav)
  // returns { A: 0..1 attraction, spots: [{k, w}] } ; at = the slot time (season, rain), dc = the day curve then
  const decorAt = (s, ids) => (s.placed || []).filter(x => ids.includes(x.id)).map(x => 'd' + x.k);
  const plotsOf = (s, types) => Object.keys(s.plots || {}).filter(k => s.plots[k].done && types.includes(s.plots[k].type)).sort((a, b) => a - b).map(k => 'p' + k);
  const range = (ch, n) => [...Array(Math.max(0, n))].map((_, i) => ch + i);
  function freeSpots(s, nav, n) { const used = new Set((s.placed || []).map(x => x.k)), out = []; for (let k = 0; k < nav.decorSpots.length && out.length < n; k++) if (!used.has(k)) out.push('e' + k); return out; }
  const rainAt = (s, t) => { const E = s.events, D = window.Events ? window.Events.C.DUR.shower : 1200; if (!E) return false; return E.active.some(e => e.type === 'shower' && e.t0 <= t && t < e.end) || E.log.some(e => e.type === 'shower' && e.t <= t && t < e.t + D); };
  function attract(s, nav, sp, t) {
    const L = [], add = (keys, w) => { for (const k of keys) L.push({ k, w }); };
    let A = 0;
    switch (sp.id) {
      case 'owl': { const d = decorAt(s, ['wisp-tree', 'wisp-tree-b']); if (d.length) { add(d, 1); A = Math.min(1, 0.9 + 0.1 * (d.length - 1)); } else { add(range('f', Math.min(4, nav.gather.wood.length)), 1); A = 0.15; } break; }
      case 'fox': { const p = plotsOf(s, ['woodshed']); add(range('f', Math.min(6, nav.gather.wood.length)), 1); A = 0.5; if (p.length) { add(p, 3); A = 1; } break; }
      case 'deer': { const d = decorAt(s, ['crystal-pillar']), w = (s.wards || []).map(k => 'w' + k); add(d, 1.5); add(w, 1); A = Math.min(1, (d.length ? 0.6 : 0) + 0.2 * w.length + 0.1 * Math.max(0, d.length - 1)); break; }
      case 'moth': { const p = plotsOf(s, ['lantern']), d = decorAt(s, ['moon-lantern', 'firefly-jar']); add(p, 1); add(d, 1);
        if (p.length + d.length) A = Math.min(1, 0.7 + 0.15 * (p.length + d.length - 1)); else { add(range('o', Math.min(4, nav.orbs.length)), 1); A = 0.3; } break; }
      case 'frog': add(range('r', Math.min(6, nav.water.length)), 1); A = 0.5; break;
      case 'jelly': { const p = plotsOf(s, ['board']); add(p, 1); A = p.length ? 1 : 0; break; }
      case 'hare': { const p = plotsOf(s, ['home']); add(p, 1); add(range('t', 8), 0.3); A = Math.min(1, 0.3 + 0.15 * p.length); break; }
      case 'sprite': { const p = plotsOf(s, ['garden', 'conserv', 'greenhold']), d = decorAt(s, ['fairy-ring']); add(p, 1); add(d, 1);
        if (p.length + d.length) A = Math.min(1, 0.65 + 0.12 * (p.length + d.length - 1)); else { add(freeSpots(s, nav, 6), 1); A = 0.2; } break; }
      case 'finch': { const p = plotsOf(s, ['stage', 'circus']); add(p, 1); if (p.length) A = 1; else if (s.pups.some(q => q.job === 'spirit' && !q.exp)) { add(range('t', 8), 1); A = 0.4; } break; }
      case 'snail': { const d = decorAt(s, ['glow-shrooms', 'fairy-ring']); add(d, 1); if (d.length) A = Math.min(1, 0.7 + 0.15 * (d.length - 1)); else { add(range('t', 8), 1); A = s.garden && s.garden.sprouts && s.garden.sprouts.length ? 0.5 : 0.3; } break; }
      case 'whale': add(range('s', 4), 1); A = s.level >= sp.minLv ? 1 : 0; break;
    }
    return { A, spots: L };
  }
  // the chance per slot (without the rarity cap rules), t = slot time
  function chance(s, nav, sp, t) {
    const S = S_(), h = (((typeof s.clock0 === 'number' ? s.clock0 : S.C.CLOCK0) + t) % 86400 + 86400) % 86400 / H;
    const k = window.Seasons ? window.Seasons.of({ ep0: s.ep0, time: t }) : null, hh = k === null ? h : window.Seasons.warp(h, k), dc = S.dayCurve(hh);
    const w = sp.when, day = (1 - dc.night) * (1 - dc.dusk) * (1 - dc.dawn);
    const tw = Math.min(1, w.d * day + w.k * dc.dusk + w.n * dc.night + w.a * dc.dawn);
    const sw = k === null ? 1 : sp.sea[k];
    const at = attract(s, nav, sp, t); if (!at.A || !tw || !sw) return { p: 0, at };
    const rain = sp.rain && rainAt(s, t) ? C.RAIN_K : 1;
    return { p: Math.min(0.5, C.P[sp.rar] * tw * sw * at.A * rain), at };
  }

  // ---------------------------------------------------------------- per sim step
  function tick(s, dt, nav, ev) {
    const c = s.crit, t1 = s.time + dt;   // in time order: who leaves before each roll, then the roll (any step size = the same)
    while ((c.slot + 1) * C.SLOT <= t1) { c.slot++; const ts = c.slot * C.SLOT; leave(s, ts, ev); roll(s, nav, ts, c.slot, ev); }
    leave(s, t1, ev);
  }
  function roll(s, nav, ts, k, ev) {
    const c = s.crit; if (ts < C.START) return;
    for (const sp of SP) {
      if (c.vis.some(v => v.c === sp.id)) continue;
      if (!sp.sky && c.vis.filter(v => !BY[v.c].sky).length >= C.MAX) continue;
      const h = hash(c.seed * 13 + Math.imul(k, 2654435761) + sp.i * 7919);
      const { p, at } = chance(s, nav, sp, ts); if (!p || (h % 100000) / 100000 >= p) continue;
      const tot = at.spots.reduce((a, x) => a + x.w, 0); if (!tot) continue;
      let u = (hash(h + 1) % 10000) / 10000 * tot, key = at.spots[at.spots.length - 1].k;
      for (const x of at.spots) if ((u -= x.w) < 0) { key = x.k; break; }
      const st = sp.stay, dur = (st[0] + (hash(h + 2) % 1000) / 1000 * (st[1] - st[0])) * MIN;
      const v = { id: ++c.n, c: sp.id, k: key, t0: ts, end: ts + Math.round(dur), tap: 0 };
      c.vis.push(v); const e = entry(s, sp.id); e.v++; e.l = ts;
      if (ev) ev.push({ type: 'crit', k: 'start', v: Object.assign({}, v), first: e.v === 1 });
    }
  }
  // visits that are over by te leave (in end order); some leave a gift (decided by the visit's own hash = the same offline)
  function leave(s, te, ev) {
    const c = s.crit, due = c.vis.filter(v => v.end <= te).sort((a, b) => a.end - b.end || a.id - b.id);
    for (const v of due) {
      c.vis.splice(c.vis.indexOf(v), 1);
      const sp = BY[v.c], g = sp.gift, give = hash(c.seed * 3 + v.id * 977) % 100 < g.pct;
      if (give) { if (g.sap) s.sap += g.sap; if (g.crystal) s.res.crystal = (s.res.crystal || 0) + g.crystal; if (g.food) s.res.food += g.food; if (g.seeds) s.inv.seeds += g.seeds; entry(s, v.c).g++; }
      const r = Object.assign({}, v, { g: give ? 1 : 0 }); c.log.push(r); while (c.log.length > C.LOG) c.log.shift();
      if (ev) ev.push({ type: 'crit', k: 'end', v: r, gift: give });
    }
  }

  // ---------------------------------------------------------------- player: tap a visitor = seen (album card)
  function tap(s, id) {
    const v = s.crit.vis.find(x => x.id === id); if (!v) return null;
    const e = entry(s, v.c), was = e.s;
    if (!v.tap) { v.tap = 1; e.s++; if (e.f < 0) e.f = s.time; }
    return { v, sp: BY[v.c], first: was === 0 && e.s === 1, e };
  }
  // album status of a species: 'seen' (tapped once), 'glimpsed' (visited, never tapped), 'unknown'
  const status = (s, id) => { const e = s.crit.al[id]; return !e ? 'unknown' : e.s > 0 ? 'seen' : e.v > 0 ? 'glimpsed' : 'unknown'; };
  // hint for an unseen critter, clearer as the colour comes back (ring = Story ring 0..5) or once glimpsed
  const hint = (s, id, ring) => { const sp = BY[id], st = status(s, id); const lv = st !== 'unknown' || ring >= 4 ? 2 : ring >= 2 ? 1 : 0; return { lv, text: sp.hint[lv] }; };
  // where a visit is, in words (the tree's voice, the card)
  function where(s, v, nav) {
    const k = v.k, ch = k[0], n = +k.slice(1);
    if (ch === 'd') { const x = (s.placed || []).find(y => y.k === n), D = x && X_() && X_().DECOR[x.id]; const nm = D ? D.name.toLowerCase() : 'a decoration'; return (BY[v.c].id === 'owl' ? 'on the ' : 'by the ') + nm; }
    if (ch === 'p') { const e = s.plots[n], B = e && S_().C.B[e.type]; return e ? (e.type === 'home' ? 'by a cottage' : e.type === 'board' ? 'over the expedition dock' : 'by the ' + (B ? B.name.toLowerCase() : 'buildings')) : 'near the houses'; }
    return { w: 'by a crystal ward', r: 'by the river', f: BY[v.c].id === 'owl' ? 'in the old woods' : 'in the woods', t: 'under the Elder Tree', o: 'round the light orbs', e: 'in the meadow', s: 'over the island' }[ch] || 'on the island';
  }
  const article = sp => /s$/.test(sp.name) ? sp.name.toLowerCase() : (/^[aeiou]/i.test(sp.name) ? 'an ' : 'a ') + sp.name.toLowerCase();
  // one line in the tree's voice for the away card: "While you slept, a wisp owl perched on the wisp tree."
  function line(s, v, nav, slept) {
    const sp = BY[v.c];
    return `${slept ? 'While you slept' : 'While you were away'}, ${article(sp)} ${sp.verb} ${where(s, v, nav)}.`;
  }
  // the island's typical rates (sim_check / Book): expected visits per day of each species for the island as it is now,
  // averaged over a day's 72 slots (the season of `t`), ignoring the visitor cap
  function rates(s, nav) { const out = {}; const t0 = Math.floor(s.time / 86400) * 86400; for (const sp of SP) { let e = 0; for (let k = 0; k < 86400 / C.SLOT; k++) e += chance(s, nav, sp, t0 + k * C.SLOT).p; out[sp.id] = e; } return out; }
  const seenN = s => SP.filter(sp => status(s, sp.id) === 'seen').length;

  window.Critters = { C, SP, BY, RAR, create, sanitize, tick, tap, status, hint, where, line, article, attract, chance, rates, rainAt, seenN, entry };
})();
