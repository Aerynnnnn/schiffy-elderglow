// Sim: the game state and its fixed-step tick. Pure JS, no three.js, no Math.random, no clock: the same state + the
// same steps give the same result, online (STEP s per tick) or offline (COARSE s per tick, capped at OFFLINE_CAP).
// Pups are phase machines (go -> fill -> carry -> pour ...); a walking phase lasts leg length / SPEED, so the renderer
// only reads where a pup is along its leg. Supply is paid per finished trip but scales with the time the trip took
// (acc = seconds worked x morale), so a far water spot is not worse than a near one, only slower to show.
// v2 (step 1 of the build-out): wood / stone / food gathering, build plots + blueprints worked by Builder pups,
// "let the pups decide", food eaten per pup, new pups arriving over a bridge when there are free beds + food + morale.
(function () {
  'use strict';
  const H = 3600;
  const C = {
    STEP: 0.2, COARSE: 10, OFFLINE_CAP: 8 * H, SPEED: 5,
    FILL: 3, POUR: 3, LIGHT: 3, TEND: 4, DROP: 2, WAIT: 20, BUILD_CHUNK: 15,
    WORK: { wood: 8, stone: 9, food: 6 },
    // need decay in points per hour; jobs supply points per hour per pup (x morale multiplier 0.6 .. 1.2)
    // step 4: the last three needs got jobs. Asleep (before the first sky trip lands, src/needs.js) they drift to
    // `floor`; awake they decay (ramping up over an hour) but never below `min` (cozy: neglect only slows the tree).
    // Protect also decays with the blight on the ground (Needs.C.BLIGHT.LOAD per patch size).
    NEEDS: {
      water: { w: 0.28, decay: 24 }, light: { w: 0.24, decay: 18 },
      nourish: { w: 0.18, decay: 9, floor: 75, drift: 3, min: 20 }, protect: { w: 0.15, decay: 1, floor: 75, drift: 3, min: 25 }, spirit: { w: 0.15, decay: 8, floor: 75, drift: 3, min: 20 },
    },
    SUPPLY: { water: 15, light: 11, nourish: 16, protect: 14, spirit: 15 },
    GATHER: { wood: 36, stone: 24, food: 40 },   // per pup-hour of work (x morale), paid per trip like water
    // step 5: 8 levels in 5 stages (src/growth.js). xp/h = 3 x (health - 40): health 85 = 135 xp/h -> L2 ~20 min, L3 ~3 h,
    // L4 ~22 h (day 2), L5 ~2.5 days, L6 ~5 days, L7 ~9 days, Elder ~17 days of round-the-clock health 85 (~3 weeks for a
    // player who checks in a few times a day: the 8 h offline cap loses some night hours). Table in tools/sim_check.mjs.
    LV_XP: [0, 40, 400, 3000, 8000, 16000, 30000, 55000], MAX_LV: 8, SCALE: [0.45, 0.56, 0.68, 0.76, 0.83, 0.89, 0.95, 1.0],
    ELDER_SAP: 1.25,      // L8: +25 % glow sap
    // faction buildings (step 5; each on its own layout plot, one each): what they do
    FAC: { hush: { protect: 1.4, blightP: 0.7, clear: 0.7 }, sprout: { school: 1.5, grow: 0.5, morale0: 85 }, market: { trade: 2 },
      greenhold: { nourish: 1.3, nourishH: 3, sprouts: 2 }, circus: { spirit: 1.3, spiritH: 3, music: 3 }, forge: { gather: 1.25, build: 1.25 } },
    XP_PER_H: h => Math.max(0, h - 40) * 3,          // health 85 -> 135 xp/h
    SAP_PER_H: h => Math.max(0, h - 60) * 1.5,       // health 90 -> 45 sap/h
    MORALE_TAU: 1200,
    // economy
    START_RES: { wood: 30, stone: 20, food: 80, crystal: 0 },   // crystals: expeditions only (step 3)
    EAT: 3,               // food per pup per hour
    HUNGRY_MORALE: 25,    // morale target drop while the pantry is empty (never deadly: things only slow down)
    BEDS0: 6,             // the tree hollow sleeps the first six
    FOOD_LOW: 60,         // "let the pups decide": a garden when food is below this and not rising
    // arrivals: while free bed + food >= ARRIVE_FOOD + average morale >= ARRIVE_MORALE, a stray turns up after
    // ARRIVE_WAIT s, at most one per ARRIVE_GAP s; population <= beds and <= MAX_PUPS
    ARRIVE_WAIT: 2700, ARRIVE_GAP: 2 * H, ARRIVE_FOOD: 30, ARRIVE_MORALE: 55, MAX_PUPS: 40,
    // day + night (step 2): the island's local clock = (clock0 + time) mod 24 h (clock0 = local seconds-of-day at time 0;
    // the game re-anchors it to the real clock on load, so online, offline and catch-up all see the same hours).
    // At night each pup is sleepy in NAP_P x night of the half-hour SLOTs (deterministic hash) and naps after its trip until the slot ends, the tree drinks less (water decay x
    // (1 - WATER_SLEEP x night)); lantern keepers nap half as often and never at dusk, and work LIGHT_DUSK faster at dusk.
    CLOCK0: 12 * H,
    NIGHT: { NAP_P: 0.35, WATER_SLEEP: 0.3, LIGHT_DUSK: 0.5, SLOT: 1800 },
    INVITE_WAIT: 600,     // a daily-gift pup (invite) walks in this long after a bed is free (no food / morale / gap rules)
    // buildings: cost + builder-seconds of work (one pup at morale x1), what it gives
    HOME_BEDS: { EG_House_A: 2, EG_House_B: 2, EG_House_C: 3, EG_House_D: 2, EG_House_E: 2, EG_House_F: 3, EG_House_G: 2, EG_House_H: 3, EG_Treehouse_Cottage: 4, EG_Treehouse_Totem: 4 },
    B: {
      home: { name: 'Cottage', cost: b => ({ wood: 20 * b, stone: 8 * b }), work: b => 1800 * b },
      garden: { name: 'Berry garden', cost: () => ({ wood: 25 }), work: () => 1800, food: 14 },
      woodshed: { name: 'Woodshed', cost: () => ({ wood: 20, stone: 10 }), work: () => 2400, wood: 5, boost: 0.25 },
      quarry: { name: 'Stone pile', cost: () => ({ wood: 30 }), work: () => 2400, stone: 4, boost: 0.25 },
      lantern: { name: 'Lantern path', cost: () => ({ wood: 15, stone: 20, sap: 25 }), work: () => 1800, light: 5 },
      // step 3: one per island, from tree level 2: the dock the sky boats leave from (src/expedition.js)
      board: { name: 'Expedition dock', cost: () => ({ wood: 40, stone: 15 }), work: () => 1500, lv: 2, one: true },
      // step 4: a little music stage (performers play there at full joy, busking on the plaza gives 70 %) and a
      // Greenhold-style conservatory (gardeners +30 %, +2 glow-sprout beds, +3 nourish/h by itself), one each
      stage: { name: 'Music stage', cost: () => ({ wood: 30, stone: 12 }), work: () => 1800, lv: 2, one: true, need: 'spirit' },
      conserv: { name: 'Conservatory', cost: () => ({ wood: 45, stone: 25, sap: 30 }), work: () => 2700, lv: 3, one: true, need: 'nourish' },
      // step 5: faction buildings + the market, each only on its own plot (`piece` = the layout piece of that plot); the
      // layout's own model rises out of the ground like a cottage. Crystals / sap / berries are waited for, wood + stone fetched.
      hush: { name: 'Hush Hall', piece: 'EG_HushHall', cost: () => ({ wood: 90, stone: 70, crystal: 6 }), work: () => 3 * H, lv: 4, one: true, need: 'protect' },
      sprout: { name: 'Sprout House', piece: 'EG_SproutHouse', cost: () => ({ wood: 80, stone: 50, sap: 60 }), work: () => 3 * H, lv: 4, one: true },
      market: { name: 'Market square', piece: 'market', cost: () => ({ wood: 70, stone: 40, food: 40 }), work: () => 2.5 * H, lv: 4, one: true },
      greenhold: { name: 'Greenhold', piece: 'EG_Greenhold', cost: () => ({ wood: 120, stone: 80, sap: 100 }), work: () => 4 * H, lv: 5, one: true, need: 'nourish' },
      circus: { name: 'Circus', piece: 'EG_Circus', cost: () => ({ wood: 120, stone: 60, crystal: 8 }), work: () => 4 * H, lv: 5, one: true, need: 'spirit' },
      forge: { name: 'Gale Forge', piece: 'EG_GaleForge', cost: () => ({ wood: 150, stone: 140, crystal: 12 }), work: () => 5 * H, lv: 6, one: true },
      // vibe pass 2: a small cozy corner (log benches, planters, a little lantern, a pup bed). No sim effect: the pups make
      // these themselves on a grown island ("let the pups decide", COZY below) so an idle island looks lived in.
      // APPENDED last: diaries store indices into Object.keys(B)
      nook: { name: 'Pup corner', cost: () => ({ wood: 18, stone: 6 }), work: () => 1200, lv: 3 },
    },
    // vibe pass 2: "let the pups decide" also fills a grown island with small things over time (after beds / berries /
    // sheds): from tree level LV, one order at most every GAP s of island time, only from a surplus (wood >= WOOD, stone >=
    // STONE), never taking the last KEEP free house plots, at most MAX[level] of them in all, in ORDER (a lantern path only
    // with spare glow sap). Berry gardens keep coming from the food rule above. Pure state (auto plots of a KIND + their
    // order time `t`): no new save fields, offline == online.
    COZY: { LV: 4, GAP: 3 * H, WOOD: 60, STONE: 30, SAP: 40, KEEP: 4, MAX: [0, 0, 0, 0, 2, 4, 6, 8, 10], ORDER: ['nook', 'nook', 'lantern'], KIND: { nook: 1, lantern: 1 } },
  };
  const JOBS = ['water', 'light', 'nourish', 'protect', 'spirit', 'wood', 'stone', 'food', 'build', 'rest'];
  const GATHER_JOBS = ['wood', 'stone', 'food'];
  const BREEDS = ['noodle', 'bean', 'biscuit', 'mochi', 'pepper', 'pudding', 'waffles'];
  const PUPS = [
    { id: 'pudding', name: 'Pudding', like: 'water', dislike: 'light', collar: '#ff7a59' },
    { id: 'bean', name: 'Bean', like: 'light', dislike: 'rest', collar: '#4fb3ff' },
    { id: 'mochi', name: 'Mochi', like: 'nourish', dislike: 'water', collar: '#ff8fc8' },
    { id: 'biscuit', name: 'Biscuit', like: 'water', dislike: 'rest', collar: '#ffcf3f' },
    { id: 'waffles', name: 'Waffles', like: 'light', dislike: 'water', collar: '#9b7bff' },
    { id: 'pepper', name: 'Pepper', like: 'rest', dislike: 'light', collar: '#3fd18b' },
  ];
  const NAMES = ['Maple', 'Tofu', 'Clover', 'Nugget', 'Juniper', 'Sprout', 'Pickle', 'Hazel', 'Muffin', 'Pip', 'Rosie', 'Toffee', 'Bramble', 'Ginger',
    'Olive', 'Basil', 'Pebble', 'Cocoa', 'Sunny', 'Willow', 'Fig', 'Dumpling', 'Acorn', 'Marble', 'Poppy', 'Truffle', 'Nori', 'Peanut', 'Cricket',
    'Daisy', 'Ember', 'Fern', 'Gumdrop', 'Honey', 'Kiwi', 'Latte', 'Moss', 'Noodle', 'Oats', 'Plum', 'Quill', 'Rusk', 'Saffron', 'Tansy'];
  const COLLARS = ['#ff6b6b', '#4fd1c5', '#f6ad55', '#9f7aea', '#68d391', '#f687b3', '#63b3ed', '#ecc94b', '#fc8181', '#b794f4', '#38b2ac', '#ed8936'];
  const START_JOBS = ['water', 'light', 'food', 'water', 'light', 'build'];
  const PHASES = ['idle', 'go', 'fill', 'carry', 'pour', 'light', 'tend', 'rest', 'work', 'drop', 'build', 'wait', 'arrive', 'nap', 'board', 'away', 'plant', 'feed', 'clear', 'watch', 'play'];
  const NTASK = { garden: 'nourish', blight: 'protect', patrol: 'protect', stage: 'spirit', busk: 'spirit' };   // = Needs.TASK_JOB
  const NEEDJOB = { nourish: 1, protect: 1, spirit: 1 };
  const WALK = { go: 1, carry: 1, arrive: 1 };
  const scaleOf = s => C.SCALE[Math.max(0, Math.min(C.MAX_LV, s.level) - 1)];
  // step 5: built faction buildings (fac) and the season's multipliers (sea; 1 when the island has no timestamp yet)
  const fac = (s, type) => { for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === type) return true; } return false; };
  const facK = (s, type, key) => fac(s, type) ? C.FAC[type][key] : 1;
  const sea = (s, key) => window.Seasons ? window.Seasons.k(s, key) : 1;
  const season = s => window.Seasons ? window.Seasons.of(s) : null;
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };

  // ---- the clock: hours 0..24 of the island's local day, and the day curve (shared with the renderer's sky)
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function tod(s) { const c = typeof s.clock0 === 'number' ? s.clock0 : C.CLOCK0; return (((c + s.time) % 86400) + 86400) % 86400 / H; }
  // the hour on the standard day curve: the season's day length warps the real hour (summer long days, winter short)
  const dayH = s => { const k = season(s); return k === null ? tod(s) : window.Seasons.warp(tod(s), k); };
  // night 0..1 (full 20:30-5:00, ramps 19:00-20:30 and 5:00-6:45), dusk = golden hour -> blue hour bump (17:15-20:15),
  // dawn bump (5:15-7:45)
  function dayCurve(h) {
    h = ((h % 24) + 24) % 24;
    const night = h < 12 ? 1 - sm(5.0, 6.75, h) : sm(19.0, 20.5, h);
    const dusk = sm(17.25, 18.25, h) * (1 - sm(19.25, 20.25, h));
    const dawn = sm(5.25, 6.0, h) * (1 - sm(6.75, 7.75, h));
    return { night, dusk, dawn };
  }
  function napNow(s, i) {
    const p = s.pups[i], dc = dayCurve(dayH(s)); if (dc.night < 0.05 || p.job === 'rest') return false;
    let pr = C.NIGHT.NAP_P * dc.night; if (p.job === 'light') pr *= 0.5 * (1 - dc.dusk);
    if (window.Traits) pr *= window.Traits.napK(s, i);   // vibe pass 2 lane B: sleepy pups nap a little more, brave ones a little less
    // sleepy slots: each pup is sleepy in a hashed share (pr) of the night's half hours and naps until the slot ends,
    // so the napping share doesn't depend on how long a trip takes
    return hash(i * 7919 + Math.floor(s.time / C.NIGHT.SLOT) * 17 + 5) % 1000 < pr * 1000;
  }
  const napLeft = s => Math.max(60, (Math.floor(s.time / C.NIGHT.SLOT) + 1) * C.NIGHT.SLOT - s.time);

  function newPup(def, job, at) {
    return { id: def.id, name: def.name, breed: def.breed, collar: def.collar, like: def.like, dislike: def.dislike,
      job, phase: 'idle', t: 0, dur: 0, leg: null, at, face: null, trips: 0, acc: 0, morale: 70, task: null, tgt: null, exp: null, xpE: 0, dy: [], dd: null, dt0: 0 };
  }
  function create(nav, seed) {   // seed: the island's event seed (the game passes a random one for a fresh island)
    const sc = C.SCALE[0];
    const s = {
      v: 10, time: 0, clock0: C.CLOCK0, ep0: null, book: { read: 0, sea: -1 }, level: 1, xp: 0, sap: 0, health: 0,
      daily: { claims: 0, last: -1, maxDay: -1, streak: 0, mkey: -1, mN: 0 }, inv: { seeds: 0, decor: [], outfits: [], lumen: false }, invite: null,
      needs: { water: 80, light: 80, nourish: 80, protect: 80, spirit: 80 },
      res: Object.assign({}, C.START_RES),
      stats: { buckets: 0, orbs: 0, trips: 0, wood: 0, stone: 0, food: 0, built: 0, arrived: 0, exped: 0, wishes: 0, fruit: 0, trades: 0 },
      plots: {}, queue: [], decide: false, seq: 0, arrive: 0, lastArrive: -1e6,
      pups: PUPS.map((d, i) => newPup(Object.assign({ breed: d.id }, d), START_JOBS[i], nav.rest(i, sc))),
    };
    window.Exped.create(s);   // S.exp + S.placed (src/expedition.js, loaded right after this file)
    window.Needs.create(s);   // S.wake, S.blight, S.wards, S.garden, S.fr (src/needs.js)
    window.Events.create(s, seed || 1);   // S.events (src/events.js)
    if (window.Social) window.Social.create(s);   // S.social (step 6, src/social.js): account, public flag, merged gift ids
    if (window.Story) window.Story.create(s);     // S.story (Round 2 step 2, src/story.js): colour rings, the tree's words, diaries
    if (window.Critters) window.Critters.create(s);   // S.crit (Round 2 step 3, src/critters.js): sky critter visits + album
    if (window.Lanterns) window.Lanterns.create(s);   // S.lan (Round 2 step 4, src/lanterns.js): lantern notes + World Bloom petals
    s.health = healthOf(s); return s;
  }
  const eaters = s => { let n = 0; for (const p of s.pups) if (p.phase !== 'away') n++; return n; };   // a team away eats its packed supplies
  function healthOf(s) { let h = 0; for (const k in C.NEEDS) h += C.NEEDS[k].w * s.needs[k]; return h; }
  // add = music / glum island (Needs.moraleAdd, computed once per step)
  const moraleTarget = (p, job, s, add) => {
    let m = job === p.like ? 100 : job === p.dislike ? 35 : job === 'rest' ? 85 : 70;
    if (s && s.wake) m = Math.max(10, Math.min(100, m + (add === undefined ? window.Needs.moraleAdd(s) : add)));
    return s && s.res && s.res.food <= 0 ? Math.max(20, m - C.HUNGRY_MORALE) : m;
  };
  const mult = m => 0.6 + 0.6 * m / 100;

  // ---- buildings
  const plotOf = (nav, pid) => nav.plotBy[pid];
  const bedsFor = q => C.HOME_BEDS[q.piece] || 2;
  function costOf(type, q) { const b = C.B[type]; return b ? b.cost(type === 'home' ? bedsFor(q) : 0) : null; }
  function workOf(type, q) { const b = C.B[type]; return b ? b.work(type === 'home' ? bedsFor(q) : 0) : 0; }
  function counts(s) {
    const c = { home: 0, garden: 0, woodshed: 0, quarry: 0, lantern: 0, board: 0, stage: 0, conserv: 0, hush: 0, sprout: 0, market: 0, greenhold: 0, circus: 0, forge: 0, nook: 0, total: 0, queued: 0 };
    for (const k in s.plots) { const e = s.plots[k]; if (e.done) { c[e.type]++; c.total++; } else c.queued++; }
    return c;
  }
  // a faction / market plot takes only its own building; every other type goes on house plots
  const fits = (q, type) => { const b = C.B[type]; return !!b && (b.piece ? q.piece === b.piece : q.kind === 'house'); };
  function bedsOf(s, nav) { let b = C.BEDS0; for (const k in s.plots) { const e = s.plots[k]; if (e.done && e.type === 'home') b += bedsFor(plotOf(nav, +k)); } return b; }
  function canBuild(s, q, type) {
    const b = C.B[type]; if (!b || !q || !fits(q, type) || q.lv > s.level || s.plots[q.pid] || (b.lv && s.level < b.lv)) return false;
    if (b.need && window.Needs.awakeK(s, b.need) < 0) return false;   // the stage / conservatory come with their need
    if (b.one) for (const k in s.plots) if (s.plots[k].type === type) return false;   // one dock per island
    return true;
  }
  function afford(s, cost) { for (const k in cost) if ((k === 'sap' ? s.sap : s.res[k]) < cost[k] - 1e-9) return false; return true; }
  function pay(s, cost, sign) { for (const k in cost) { if (k === 'sap') s.sap += sign * cost[k]; else s.res[k] += sign * cost[k]; } }
  function shortOf(s, cost) {   // which gatherable material is missing most (relative), or 'sap' / null
    let best = null, bv = 0;
    for (const k of ['wood', 'stone']) if (cost[k] && s.res[k] < cost[k]) { const v = (cost[k] - s.res[k]) / cost[k]; if (v > bv) { bv = v; best = k; } }
    if (!best && cost.sap && s.sap < cost.sap) best = 'sap';
    return best;
  }
  function order(s, pid, type, nav, auto) {
    const q = plotOf(nav, pid); if (!canBuild(s, q, type)) return false;
    s.plots[pid] = { type, prog: 0, paid: false, done: false, auto: !!auto, t: Math.round(s.time) };
    s.queue.push(pid); return true;
  }
  function stopWalking(p, nav) {   // stop where it is, keep walking from there later
    if (p.leg && WALK[p.phase]) {
      const L = nav.leg(p.leg.a, p.leg.b, p.leg.R), q = nav.at(L, p.t * C.SPEED);
      p.at = { p: q.p.map(v => Math.round(v * 1000) / 1000), n: nav.nodeNear(L, q.seg, p.leg.a.n) };
    }
    p.phase = 'idle'; p.leg = null; p.t = 0; p.dur = 0; p.task = null; p.tgt = null;
  }
  function cancel(s, pid, nav) {
    const e = s.plots[pid]; if (!e || e.done) return false;
    if (e.paid) pay(s, costOf(e.type, plotOf(nav, pid)), +1);   // cozy: a cancelled blueprint refunds everything
    delete s.plots[pid]; s.queue = s.queue.filter(x => x !== pid);
    for (const p of s.pups) if (p.tgt === pid) stopWalking(p, nav);
    return true;
  }
  function foodNet(s) {
    const c = counts(s); let f = c.garden * C.B.garden.food - C.EAT * eaters(s);
    for (const p of s.pups) if (p.job === 'food' && !p.exp) f += C.GATHER.food * mult(p.morale) * 0.8;   // ~20 % of a trip is walking back
    return f;
  }
  // "let the pups decide": what the island needs most, on the nearest free plot that is open
  function autoPlan(s, nav) {
    const n = s.pups.length, c = counts(s); let type = null;
    if (n + 1 > bedsOf(s, nav) && n < C.MAX_PUPS) type = 'home';
    else if (s.res.food < C.FOOD_LOW && foodNet(s) < 1) type = 'garden';
    // sheds / quarries only once the village has a few homes (early on the builders fetch what they need themselves)
    else if (c.home >= 2 && s.res.wood < 25 && c.woodshed < 1 + Math.floor(c.total / 5)) type = 'woodshed';
    else if (c.home >= 2 && s.res.stone < 15 && c.quarry < 1 + Math.floor(c.total / 5)) type = 'quarry';
    if (!type) return fillPlan(s, nav);
    for (const q of nav.plots) if (canBuild(s, q, type)) return { pid: q.pid, type };
    return null;
  }
  // vibe pass 2: nothing needed -> on a grown island the pups slowly add small things (C.COZY)
  function fillPlan(s, nav) {
    const F = C.COZY; if (s.level < F.LV) return null;
    let n = 0, last = -1e12;
    for (const k in s.plots) { const e = s.plots[k]; if (!e.auto || !F.KIND[e.type]) continue; n++; if (e.t > last) last = e.t; }
    if (n >= F.MAX[Math.min(C.MAX_LV, s.level)] || s.time - last < F.GAP || s.res.wood < F.WOOD || s.res.stone < F.STONE) return null;
    let free = 0; for (const q of nav.plots) if (q.kind === 'house' && q.lv <= s.level && !s.plots[q.pid]) free++;
    if (free <= F.KEEP) return null;
    let type = F.ORDER[n % F.ORDER.length];
    if (type === 'lantern' && s.sap < C.B.lantern.cost().sap + F.SAP) type = 'nook';
    for (const q of nav.plots) if (canBuild(s, q, type)) return { pid: q.pid, type };
    return null;
  }
  // a builder's next target: the first paid blueprint, else the first affordable one (paid now), else the first one
  function pickBuild(s, nav) {
    if (!s.queue.length && s.decide) { const a = autoPlan(s, nav); if (a) order(s, a.pid, a.type, nav, true); }
    let first = null;
    for (const pid of s.queue) { const e = s.plots[pid]; if (e && !e.done && e.paid) return pid; }
    for (const pid of s.queue) {
      const e = s.plots[pid]; if (!e || e.done) continue; if (first === null) first = pid;
      const cost = costOf(e.type, plotOf(nav, pid)); if (afford(s, cost)) { pay(s, cost, -1); e.paid = true; return pid; }
    }
    return first;
  }
  function complete(s, pid, nav, ev) {
    const e = s.plots[pid]; e.done = true; e.prog = workOf(e.type, plotOf(nav, pid)); e.at = Math.round(s.time);
    s.queue = s.queue.filter(x => x !== pid); s.stats.built++;
    if (ev) ev.push({ type: 'built', pid, kind: e.type });
    for (const p of s.pups) if (p.tgt === pid && p.phase === 'build') { p.phase = 'idle'; p.t = 0; p.dur = 0; p.task = null; p.tgt = null; }
    if (e.type === 'stage') for (const p of s.pups) if (p.phase === 'rest') { p.phase = 'idle'; p.t = 0; p.dur = 0; }   // resting pups go and watch
  }

  // ---- walking + job spots
  function legLen(nav, leg) { return nav.leg(leg.a, leg.b, leg.R).len; }
  function startWalk(s, p, nav, to, phase) {
    p.leg = { a: { p: p.at.p.slice(), n: p.at.n }, b: { p: to.p.slice(), n: to.n }, R: nav.trunkR(scaleOf(s)) };
    p.phase = phase; p.t = 0; p.dur = Math.max(0.5, legLen(nav, p.leg) / C.SPEED);
  }
  function rankIn(s, i, job) { let r = 0; for (let k = 0; k < i; k++) if (s.pups[k].job === job) r++; return r; }
  function waterSpot(s, i, nav) { const K = Math.min(4, nav.water.length); return nav.water[(rankIn(s, i, 'water') + s.pups[i].trips) % K]; }
  function orbSpot(s, i, nav) { const p = s.pups[i]; return nav.orbs[(i * 3 + p.trips * 7) % nav.orbs.length]; }
  function gatherSpot(s, i, nav, kind) { const L = nav.gather[kind], K = Math.min(4, L.length); return L[(rankIn(s, i, s.pups[i].job) + s.pups[i].trips) % K]; }
  function siteSlot(s, i, pid) { let k = 0; for (let j = 0; j < i; j++) if (s.pups[j].tgt === pid && s.pups[j].task === 'site') k++; return k; }
  const toward = (a, b) => [b[0] - a[0], b[2] - a[2]];

  // what to do when a pup is standing with nothing to do / finished a phase
  function begin(s, i, nav) {
    const p = s.pups[i], sc = scaleOf(s);
    p.task = null; p.tgt = null;
    if (p.job === 'water') startWalk(s, p, nav, waterSpot(s, i, nav), 'go');
    else if (p.job === 'light') startWalk(s, p, nav, nav.door(sc), 'go');
    else if (GATHER_JOBS.includes(p.job) && nav.gather[p.job].length) { p.task = p.job; p.acc = 0; startWalk(s, p, nav, gatherSpot(s, i, nav, p.job), 'go'); }
    else if (NEEDJOB[p.job]) window.Needs.begin(s, i, nav);   // gardeners / guardians / performers (src/needs.js)
    else if (p.job === 'build') {
      const pid = pickBuild(s, nav), e = pid !== null ? s.plots[pid] : null;
      if (e && e.paid) { p.task = 'site'; p.tgt = pid; startWalk(s, p, nav, nav.site(pid, siteSlot(s, i, pid)), 'go'); }
      else {
        const k = e ? shortOf(s, costOf(e.type, plotOf(nav, pid))) : null;
        if ((k === 'wood' || k === 'stone') && nav.gather[k].length) { p.task = k; p.acc = 0; startWalk(s, p, nav, gatherSpot(s, i, nav, k), 'go'); }
        else { p.task = 'wait'; startWalk(s, p, nav, nav.rest(i, sc), 'go'); }
      }
    }
    else startWalk(s, p, nav, window.Needs.audience(s, i, nav) || nav.rest(i, sc), 'go');   // resting pups watch the show at the stage
  }
  function deliver(s, i, nav, ev, kind) {
    const p = s.pups[i], c = counts(s);
    const boost = kind === 'wood' ? 1 + C.B.woodshed.boost * Math.min(4, c.woodshed) : kind === 'stone' ? 1 + C.B.quarry.boost * Math.min(4, c.quarry) : 1;
    const amt = C.GATHER[kind] * p.acc / H * boost * facK(s, 'forge', 'gather') * sea(s, 'gather');   // Gale Forge tools, autumn harvest
    s.res[kind] += amt; s.stats[kind] += amt; p.acc = 0; p.trips++; s.stats.trips++;
    if (ev) ev.push({ type: 'deliver', pup: i, job: kind, amount: amt });
  }
  function goNap(s, i, nav) { const p = s.pups[i]; p.task = 'nap'; p.tgt = null; startWalk(s, p, nav, nav.rest(i, scaleOf(s)), 'go'); }
  function finish(s, i, nav, ev) {
    const p = s.pups[i], sc = scaleOf(s);
    if (p.leg && WALK[p.phase]) { p.at = { p: p.leg.b.p.slice(), n: p.leg.b.n }; p.leg = null; }
    if (NTASK[p.task] && p.phase !== 'arrive') { window.Needs.finish(s, i, nav, ev); return; }
    const work = (ph, dur, face) => { p.phase = ph; p.t = 0; p.dur = dur; p.face = face; };
    const nap = () => goNap(s, i, nav);
    switch (p.phase) {
      case 'arrive': p.phase = 'idle'; begin(s, i, nav); break;
      case 'nap': p.task = null; begin(s, i, nav); break;
      case 'go':
        if (p.task === 'exp') work('board', 1e6, toward(nav.TP, p.at.p));   // at the dock: waits for the team (Exped.tick departs)
        else if (p.task === 'nap') work('nap', napLeft(s), toward(nav.TP, p.at.p));
        else if (p.task === 'site') {
          const e = s.plots[p.tgt], q = plotOf(nav, p.tgt);
          if (!e || e.done || !q) begin(s, i, nav); else work('build', C.BUILD_CHUNK, toward(p.at.p, q.pos));
        } else if (p.task === 'wood' || p.task === 'stone' || p.task === 'food') {
          const g = gatherSpot(s, i, nav, p.task); work('work', C.WORK[p.task], toward(p.at.p, g.at));
        } else if (p.task === 'wait') work('wait', C.WAIT, toward(nav.TP, p.at.p));
        else if (p.job === 'water') { const w = waterSpot(s, i, nav); work('fill', C.FILL, toward(p.at.p, w.water)); }
        else if (p.job === 'light') work('light', C.LIGHT, toward(p.at.p, nav.TP));
        else work('rest', 0, toward(nav.TP, p.at.p));
        break;
      case 'fill': startWalk(s, p, nav, nav.door(sc), 'carry'); break;
      case 'light': startWalk(s, p, nav, orbSpot(s, i, nav), 'carry'); break;
      case 'work': startWalk(s, p, nav, nav.door(sc), 'carry'); break;
      case 'carry':
        if (p.task === 'wood' || p.task === 'stone' || p.task === 'food') work('drop', C.DROP, toward(p.at.p, nav.TP));
        else if (p.job === 'water') work('pour', C.POUR, toward(p.at.p, nav.TP));
        else { const o = orbSpot(s, i, nav); work('tend', C.TEND, toward(p.at.p, o.orb)); }
        break;
      case 'drop': deliver(s, i, nav, ev, p.task); if (napNow(s, i)) nap(); else begin(s, i, nav); break;
      case 'build': {
        const e = s.plots[p.tgt];
        if (!e || e.done) begin(s, i, nav); else if (napNow(s, i)) nap(); else { p.t = 0; p.dur = C.BUILD_CHUNK; }
        break;
      }
      case 'wait': begin(s, i, nav); break;
      case 'board': p.t = 0; break;   // still waiting at the dock
      case 'away': break;
      case 'pour': case 'tend': {
        const job = p.phase === 'pour' ? 'water' : 'light', amt = C.SUPPLY[job] * p.acc / H;
        s.needs[job] = Math.min(100, s.needs[job] + amt); p.acc = 0; p.trips++; s.stats.trips++;
        if (job === 'water') s.stats.buckets++; else s.stats.orbs++;
        if (ev) ev.push({ type: 'deliver', pup: i, job, amount: amt, orb: job === 'light' ? orbSpot(s, i, nav) : null });
        if (napNow(s, i)) nap();
        else if (job === 'water') startWalk(s, p, nav, waterSpot(s, i, nav), 'go');
        else startWalk(s, p, nav, nav.door(sc), 'go');
        break;
      }
      default: begin(s, i, nav);
    }
  }

  // ---- arrivals: a stray walks in over a bridge
  function arrive(s, nav, ev) {
    const seq = s.seq++, h = hash(seq * 7919 + 13);
    const taken = new Set(s.pups.map(p => p.name));
    // vibe pass 1: the name pick is seeded by the island's own event seed (fresh islands: random), so newcomers differ from
    // island to island (every island used to get Maple, Tofu, Clover...). Pure + deterministic: offline == online; pups
    // already living there keep their names (only new arrivals pick).
    const es = s.events && s.events.seed ? s.events.seed >>> 0 : 0, n0 = es ? hash(es * 31 + seq * 7919 + 101) % NAMES.length : seq % NAMES.length;
    let name = NAMES[n0]; for (let k = 1; taken.has(name) && k < NAMES.length; k++) name = NAMES[(n0 + k * 7) % NAMES.length];
    if (taken.has(name)) name = name + ' ' + (seq + 2);
    let like = JOBS[h % JOBS.length];
    // vibe pass 2 lane B: a stray's liked job leans toward its personality (src/traits.js; the trait itself is derived, never saved)
    if (window.Traits && !s.invite) like = window.Traits.like(window.Traits.pick(s, 'n' + seq, s.pups.length, null), h, like);
    let dislike = JOBS[(h >>> 5) % JOBS.length]; if (dislike === like) dislike = JOBS[(JOBS.indexOf(like) + 3) % JOBS.length];
    let def = { id: 'n' + seq, name, breed: BREEDS[(seq * 3) % BREEDS.length], collar: COLLARS[(h >>> 9) % COLLARS.length], like, dislike };
    const inv = s.invite; if (inv) { def = Object.assign({}, inv); if (taken.has(def.name)) def.name = def.name + ' ' + (seq + 2); s.invite = null; }
    // step 4: close friends' puppy (instead of a stray; a gift pup still comes first): a parent's breed + liked job
    const pp = inv ? null : window.Needs.puppyPair(s);
    if (pp) { const a = s.pups[pp[h % 2]], b = s.pups[pp[1 - h % 2]]; def.breed = a.breed; def.like = (h >>> 3) % 2 ? a.like : b.like; if (def.dislike === def.like) def.dislike = JOBS[(JOBS.indexOf(def.like) + 4) % JOBS.length]; }
    let at;
    if (pp) at = nav.rest(pp[0], scaleOf(s));   // born at home: starts beside a parent's nap spot
    else { const sp = nav.spawns.length ? nav.spawns[(h >>> 13) % Math.min(4, nav.spawns.length)] : nav.doorNode; const n = nav.nodes[sp]; at = { p: n.p.map(v => Math.round(v * 1000) / 1000), n: sp }; }
    const p = newPup(def, window.Needs.jobOpen(s, def.like) ? def.like : 'rest', at); p.born = Math.round(s.time); p.isNew = true; if (inv) p.special = true;   // a liked job that isn't open yet: rest until the player picks
    if (pp) { p.parents = pp.slice(); s.fr.lastPuppy = Math.round(s.time); s.fr.puppies++; }
    if (fac(s, 'sprout')) p.morale = C.FAC.sprout.morale0;   // the Sprout House school welcomes newcomers
    s.pups.push(p); s.stats.arrived++; s.lastArrive = s.time; s.arrive = 0;
    startWalk(s, p, nav, nav.door(scaleOf(s)), 'arrive');
    if (ev) ev.push({ type: 'arrive', pup: s.pups.length - 1, puppy: !!pp });
  }
  const avgMorale = s => s.pups.reduce((a, p) => a + p.morale, 0) / Math.max(1, s.pups.length);
  function arrivalOk(s, nav) {
    const n = s.pups.length;
    if (s.invite) return n < bedsOf(s, nav) && n < C.MAX_PUPS;   // a gift pup only needs a bed
    return n < bedsOf(s, nav) && n < C.MAX_PUPS && s.res.food >= C.ARRIVE_FOOD && avgMorale(s) >= C.ARRIVE_MORALE && s.time - s.lastArrive >= C.ARRIVE_GAP;
  }

  function step(s, dt, nav, ev) {
    if (!ev) ev = [];   // Round 2 step 2: the story reads this step's events (pushes only: nothing else depends on ev)
    const e0 = ev.length;
    const dc = dayCurve(dayH(s)), duskK = 1 + C.NIGHT.LIGHT_DUSK * dc.dusk;
    const N = window.Needs, madd = N.moraleAdd(s), frK = N.friendK(s);   // music / glum island; friends on the same job work a bit faster
    // pups
    for (let i = 0; i < s.pups.length; i++) {
      const p = s.pups[i];
      if (p.phase === 'away') continue;   // off on an expedition: no island work, morale paused
      p.morale += (moraleTarget(p, p.job, s, madd) - p.morale) * (1 - Math.exp(-dt / C.MORALE_TAU));
      if (p.job !== 'rest' && p.task !== 'nap' && p.task !== 'exp') p.acc += dt * mult(p.morale) * (p.job === 'light' ? duskK : 1) * frK[i];
      let rem = dt;
      for (let guard = 0; guard < 24; guard++) {
        if (p.phase === 'idle') begin(s, i, nav);
        if (p.phase === 'rest') break;
        const use = Math.min(rem, Math.max(0, p.dur - p.t));
        if (p.phase === 'build') {
          const e = s.plots[p.tgt];
          if (e && !e.done) { e.prog += use * mult(p.morale) * facK(s, 'forge', 'build'); if (e.prog >= workOf(e.type, plotOf(nav, p.tgt))) { complete(s, p.tgt, nav, ev); continue; } }
        }
        p.t += rem;
        if (p.t < p.dur) break;
        rem = p.t - p.dur; p.t = p.dur;
        finish(s, i, nav, ev);
      }
    }
    window.Exped.tick(s, dt, nav, ev);   // expeditions: depart when the team is aboard, land + haul when due
    N.tick(s, dt, nav, ev);              // wake-ups, blight, sprouts, friendships (src/needs.js)
    window.Events.tick(s, dt, nav, ev);  // small events (src/events.js)
    if (window.Critters) window.Critters.tick(s, dt, nav, ev);   // sky critters come + go (src/critters.js; after Events: rain)
    // needs: water + light decay; the other three sleep (drift toward a floor) until they wake, then decay gently
    // (ramping up), never below their min
    for (const k in C.NEEDS) {
      const n = C.NEEDS[k];
      if (!n.floor) { s.needs[k] = Math.max(0, s.needs[k] - n.decay * (k === 'water' ? (1 - C.NIGHT.WATER_SLEEP * dc.night) * sea(s, 'waterDecay') : sea(s, 'lightDecay')) * dt / H); continue; }
      const aw = N.awakeK(s, k), v = s.needs[k];
      if (aw < 0) { const st = n.drift * dt / H; s.needs[k] = v > n.floor ? Math.max(n.floor, v - st) : Math.min(n.floor, v + st); }
      else if (v > n.min) { const d = (n.decay + (k === 'protect' ? N.C.BLIGHT.LOAD * N.load(s) : 0)) * (0.25 + 0.75 * aw); s.needs[k] = Math.max(n.min, v - d * dt / H); }
    }
    // buildings work by themselves; pups eat
    const c = counts(s);
    if (c.lantern) s.needs.light = Math.min(100, s.needs.light + c.lantern * C.B.lantern.light * sea(s, 'lantern') * dt / H);
    s.res.food = Math.max(0, s.res.food + (c.garden * C.B.garden.food * sea(s, 'garden') - C.EAT * eaters(s)) * dt / H);
    s.res.wood += c.woodshed * C.B.woodshed.wood * dt / H; s.res.stone += c.quarry * C.B.quarry.stone * dt / H;
    s.health = healthOf(s);
    s.xp += C.XP_PER_H(s.health) * dt / H;
    if (window.Lanterns) window.Lanterns.tick(s, dt);   // Round 2 step 4: World Bloom petals from healthy tree hours
    const sap = C.SAP_PER_H(s.health) * sea(s, 'sap') * (s.level >= 8 ? C.ELDER_SAP : 1) * dt / H; s.sap += sap;
    while (s.level < C.MAX_LV && s.xp >= C.LV_XP[s.level]) {
      s.level++; if (ev) ev.push({ type: 'level', level: s.level });
      for (const p of s.pups) if (p.phase === 'rest') { p.phase = 'idle'; p.t = 0; p.dur = 0; }   // the trunk grew: nap further out
      window.Needs.rootsGrew(s, nav, ev);   // step 5: blight under the grown roots is pushed out
    }
    // arrivals
    if (arrivalOk(s, nav)) { s.arrive += dt; if (s.arrive >= (s.invite ? C.INVITE_WAIT : C.ARRIVE_WAIT)) arrive(s, nav, ev); }
    s.time += dt;
    if (window.Story) window.Story.tick(s, dt, ev, e0);   // colour rings, the tree's words, pup diaries (src/story.js)
  }

  function assign(s, i, job, nav) {
    const p = s.pups[i]; if (!p || !JOBS.includes(job) || p.job === job || !window.Needs.jobOpen(s, job)) return false;
    if (p.phase === 'arrive' || p.exp) { p.job = job; return true; }   // still crossing the bridge / on a trip: starts the new job when back
    stopWalking(p, nav);
    p.job = job; p.acc = 0;
    return true;
  }
  function rename(s, i, name) {
    const p = s.pups[i]; if (!p) return false;
    const n = String(name || '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 14); if (!n) return false;
    p.name = n; return true;
  }

  // offline catch-up in coarse steps; returns a summary for the "while you were away" card
  function catchUp(s, seconds, nav) {
    const sec = Math.max(0, Math.min(C.OFFLINE_CAP, seconds || 0));
    const b = { buckets: s.stats.buckets, orbs: s.stats.orbs, sap: s.sap, xp: s.xp, level: s.level, health: s.health, needs: Object.assign({}, s.needs), res: Object.assign({}, s.res), st: Object.assign({}, s.stats), cleared: s.blight.cleared, fed: s.garden.fed, pend: s.lan ? s.lan.bl.pend : 0 };
    let left = sec, nightSec = 0; const ev = [], tr0 = s.pups.map(p => p.trips), ring0 = s.story ? s.story.ring : 0;
    while (left > 1e-6) { const dt = Math.min(C.COARSE, left); if (dayCurve(dayH(s)).night > 0.5) nightSec += dt; step(s, dt, nav, ev); left -= dt; }
    return { sec, nightSec, capped: seconds > C.OFFLINE_CAP, buckets: s.stats.buckets - b.buckets, orbs: s.stats.orbs - b.orbs, sap: s.sap - b.sap,
      xp: s.xp - b.xp, levels: s.level - b.level, healthFrom: b.health, healthTo: s.health, needsFrom: b.needs, needsTo: Object.assign({}, s.needs),
      gathered: { wood: s.stats.wood - b.st.wood, stone: s.stats.stone - b.st.stone, food: s.stats.food - b.st.food }, resFrom: b.res, resTo: Object.assign({}, s.res),
      built: ev.filter(e => e.type === 'built').map(e => ({ pid: e.pid, kind: e.kind })), arrived: ev.filter(e => e.type === 'arrive').map(e => e.pup),
      exped: ev.filter(e => e.type === 'exp-back').map(e => e.haul), departed: ev.filter(e => e.type === 'exp-go').map(e => e.trip),
      // step 4: events that happened (start records; their outcome is in S.events.log), blight, gardening, wake-ups, puppies
      events: ev.filter(e => e.type === 'event' && e.k === 'start').map(e => e.e.id), blightNew: ev.filter(e => e.type === 'blight').length, cleared: s.blight.cleared - b.cleared,
      fed: s.garden.fed - b.fed, woke: ev.filter(e => e.type === 'wake').map(e => e.need), puppies: ev.filter(e => e.type === 'arrive' && e.puppy).map(e => e.pup),
      // Round 2 step 2: trips per pup while away (tree dreams) + the colour rings before / after
      pupTrips: s.pups.map((p, i) => p.trips - (tr0[i] || 0)), ringFrom: ring0, ringTo: s.story ? s.story.ring : 0,
      // Round 2 step 3: sky critters that came while away (start records) + the visits that left a gift
      critters: ev.filter(e => e.type === 'crit' && e.k === 'start').map(e => e.v), critGifts: ev.filter(e => e.type === 'crit' && e.k === 'end' && e.gift).map(e => e.v),
      // Round 2 step 4: World Bloom petals the island's care earned while away (sent when the game is online)
      petals: s.lan ? s.lan.bl.pend - b.pend : 0 };
  }

  // where a pup is for the renderer (extra = seconds since the last tick, for smooth motion)
  function pose(s, i, nav, extra) {
    const p = s.pups[i];
    const walking = WALK[p.phase] && p.leg;
    let pos, dir, bridge = false, f = p.dur > 0 ? Math.min(1, (p.t + (extra || 0)) / p.dur) : 0;
    if (walking) { const L = nav.leg(p.leg.a, p.leg.b, p.leg.R), q = nav.at(L, Math.min(L.len, (p.t + (extra || 0)) * C.SPEED)); pos = q.p; dir = q.dir; bridge = q.bridge; }
    else { pos = p.at.p; dir = p.face || [0, 1]; }
    let carry = null;
    const g = p.task === 'wood' ? 'log' : p.task === 'stone' ? 'rock' : p.task === 'food' ? 'berries' : null;
    if (g) carry = p.phase === 'carry' || p.phase === 'drop' ? g : g === 'log' ? 'axe' : g === 'rock' ? 'pick' : 'basket';
    else if (p.job === 'water') carry = p.phase === 'carry' || p.phase === 'pour' ? 'water' : 'bucket';
    else if (p.job === 'light') carry = p.phase === 'carry' || p.phase === 'tend' || p.phase === 'light' ? 'lantern-on' : 'lantern';
    else if (p.job === 'build' && p.task === 'site') carry = 'hammer';
    else if (p.task === 'garden') carry = p.phase === 'carry' || p.phase === 'feed' ? (s.garden.sprouts.length ? 'fruit' : 'compost') : 'trowel';
    else if (p.task === 'blight' || p.task === 'patrol') carry = 'broom';
    else if (p.task === 'stage' || p.task === 'busk') carry = i % 2 ? 'drum' : 'lute';
    const small = !!(p.parents && s.time - (p.born || 0) < window.Needs.C.PUPPY_GROW * facK(s, 'sprout', 'grow'));   // a puppy grows up in 6 h (3 h with the Sprout House)
    return { p: pos, dir, bridge, phase: p.phase, f, walking: !!walking, carry, job: p.job, task: p.task, small };
  }

  // ---- save / load (versioned, repairs what it can, rejects what it cannot). v1 = 6 fixed pups, no economy.
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const isP = a => Array.isArray(a) && a.length === 3 && a.every(v => typeof v === 'number' && isFinite(v));
  const isLoc = l => l && isP(l.p) && Number.isInteger(l.n) && l.n >= 0;
  const LIKES = JOBS.concat(['nourish', 'protect', 'spirit']);
  function sanitize(o, nav) {
    if (!o || typeof o !== 'object' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(o.v) || !Array.isArray(o.pups)) return null;
    const v1 = o.v === 1;
    const s = create(nav);
    s.time = fin(o.time, 0, 0, 1e12); s.clock0 = fin(o.clock0, C.CLOCK0, 0, 86400);
    // v6 (step 5): the island's local timestamp anchor (seasons; older saves: null until the game anchors it) + the Book
    s.ep0 = typeof o.ep0 === 'number' && isFinite(o.ep0) ? fin(o.ep0, 0, -1e11, 1e11) : null;
    s.book = { read: Math.round(fin(o.book && o.book.read, 0, 0, C.MAX_LV)), sea: Math.round(fin(o.book && o.book.sea, -1, -1, 3)) };   // sea = last season greeted
    // v3: daily gift calendar, inventory stubs, a gift pup waiting for a bed (v1 / v2 saves start with an empty calendar)
    const d = o.daily && typeof o.daily === 'object' ? o.daily : {};
    s.daily = { claims: Math.round(fin(d.claims, 0, 0, 1e6)), last: Math.round(fin(d.last, -1, -1, 1e7)), maxDay: Math.round(fin(d.maxDay, -1, -1, 1e7)),
      streak: Math.round(fin(d.streak, 0, 0, 1e6)), mkey: Math.round(fin(d.mkey, -1, -1, 1e6)), mN: Math.round(fin(d.mN, 0, 0, 31)) };
    if (s.daily.maxDay < s.daily.last) s.daily.maxDay = s.daily.last;
    const iv = o.inv && typeof o.inv === 'object' ? o.inv : {}, ids = (a, uniq) => { if (!Array.isArray(a)) return []; const r = a.filter(x => typeof x === 'string' && /^[a-z0-9-]{1,24}$/.test(x)); return (uniq ? [...new Set(r)] : r).slice(0, 200); };
    s.inv = { seeds: Math.round(fin(iv.seeds, 0, 0, 1e6)), decor: ids(iv.decor, false), outfits: ids(iv.outfits, true), lumen: iv.lumen === true };
    s.level = Math.round(fin(o.level, 1, 1, C.MAX_LV)); s.xp = fin(o.xp, 0, 0, 1e12); s.sap = fin(o.sap, 0, 0, 1e15);
    for (const k in s.needs) s.needs[k] = fin(o.needs && o.needs[k], s.needs[k], 0, 100);
    for (const k in s.stats) s.stats[k] = Math.round(fin(o.stats && o.stats[k], 0, 0, 1e12));
    if (!v1) {
      for (const k in s.res) s.res[k] = fin(o.res && o.res[k], s.res[k], 0, 1e12);
      s.decide = o.decide === true; s.seq = Math.round(fin(o.seq, 0, 0, 1e9)); s.arrive = fin(o.arrive, 0, 0, C.ARRIVE_WAIT);
      s.lastArrive = fin(o.lastArrive, -1e6, -1e6, s.time);
      if (o.plots && typeof o.plots === 'object') for (const k in o.plots) {
        const e = o.plots[k], pid = +k, q = plotOf(nav, pid); if (!q || !e || typeof e !== 'object' || !C.B[e.type] || !fits(q, e.type)) continue;
        const w = workOf(e.type, q);
        s.plots[pid] = { type: e.type, prog: fin(e.prog, 0, 0, w), paid: e.paid === true || e.done === true, done: e.done === true, auto: e.auto === true, t: Math.round(fin(e.t, 0, 0, 1e12)) };
        if (e.done) s.plots[pid].at = Math.round(fin(e.at, s.time, 0, 1e12));
      }
      const seen = new Set();
      if (Array.isArray(o.queue)) for (const x of o.queue) { const e = s.plots[x]; if (e && !e.done && !seen.has(x)) { seen.add(x); s.queue.push(+x); } }
      for (const k in s.plots) if (!s.plots[k].done && !seen.has(+k)) s.queue.push(+k);   // a blueprint the queue lost
    }
    // pups: v1 = the six start pups by index; v2 = its own list (defs inside), first six default to the start pups
    const src = o.pups.slice(0, C.MAX_PUPS), taken = new Set();
    s.pups = [];
    src.forEach((q, i) => {
      if (!q || typeof q !== 'object') { if (i < PUPS.length) s.pups.push(create(nav).pups[i]); return; }
      const base = i < PUPS.length ? Object.assign({ breed: PUPS[i].id }, PUPS[i]) : null;
      const str = (v, re, d) => typeof v === 'string' && re.test(v) ? v : d;
      const def = v1 ? base : {
        id: str(q.id, /^[a-z0-9]{1,16}$/, base ? base.id : 'n' + (s.seq + i)), name: str(q.name, /^[^<>&"\u0000-\u001f]{1,14}$/, base ? base.name : NAMES[i % NAMES.length]),
        breed: BREEDS.includes(q.breed) ? q.breed : base ? base.breed : BREEDS[i % BREEDS.length], collar: str(q.collar, /^#[0-9a-fA-F]{6}$/, base ? base.collar : COLLARS[i % COLLARS.length]),
        like: LIKES.includes(q.like) ? q.like : base ? base.like : 'rest', dislike: LIKES.includes(q.dislike) ? q.dislike : base ? base.dislike : 'water',
      };
      if (!def) return;
      if (taken.has(def.id)) def.id = 'n' + (1000 + i); taken.add(def.id);
      const p = newPup(def, JOBS.includes(q.job) ? q.job : (i < START_JOBS.length ? START_JOBS[i] : 'rest'), nav.rest(i, scaleOf(s)));
      p.morale = fin(q.morale, 70, 0, 100); p.trips = Math.round(fin(q.trips, 0, 0, 1e9)); p.acc = fin(q.acc, 0, 0, 1e6);
      if (typeof q.born === 'number' && isFinite(q.born)) p.born = q.born;
      if (isLoc(q.at) && q.at.n < nav.nodes.length) p.at = { p: q.at.p.slice(), n: q.at.n };
      const legOk = q.leg && isLoc(q.leg.a) && isLoc(q.leg.b) && q.leg.a.n < nav.nodes.length && q.leg.b.n < nav.nodes.length && typeof q.leg.R === 'number' && isFinite(q.leg.R);
      if (PHASES.includes(q.phase) && (!WALK[q.phase] || legOk)) {
        p.phase = q.phase; p.t = fin(q.t, 0, 0, 1e6); p.dur = fin(q.dur, 0, 0, 1e6);
        p.leg = legOk ? { a: { p: q.leg.a.p.slice(), n: q.leg.a.n }, b: { p: q.leg.b.p.slice(), n: q.leg.b.n }, R: q.leg.R } : null;
        p.face = Array.isArray(q.face) && q.face.length === 2 && q.face.every(Number.isFinite) ? q.face.slice() : null;
        p.task = ['wood', 'stone', 'food', 'site', 'wait', 'nap', 'exp'].includes(q.task) || NTASK[q.task] ? q.task : null;
        if (p.phase === 'nap' && p.task !== 'nap') p.task = 'nap';
        p.tgt = p.task === 'site' && s.plots[q.tgt] && !s.plots[q.tgt].done ? +q.tgt : (p.task === 'blight' || p.task === 'garden') && Number.isInteger(q.tgt) ? q.tgt : null;
        if (p.leg) p.dur = Math.max(0.5, legLen(nav, p.leg) / C.SPEED);   // the map may have changed under the save
        if (p.phase === 'rest') { p.phase = 'idle'; p.t = 0; p.dur = 0; }   // re-find the nap spot (tree size / layout may differ)
        // a task that doesn't fit the phase / job any more: start over from where it stands
        const gatherPh = p.phase === 'work' || p.phase === 'drop' || (p.phase === 'carry' && p.task && p.task !== 'site' && p.task !== 'garden');
        const needPh = window.Needs.PH.includes(p.phase) || (p.phase === 'carry' && p.task === 'garden');
        if ((p.phase === 'build' && p.tgt === null) || (p.task === 'site' && p.tgt === null) || (gatherPh && !['wood', 'stone', 'food'].includes(p.task)) || (needPh && !NTASK[p.task]) ||
            (p.task && p.task !== 'nap' && p.task !== 'exp' && (NTASK[p.task] || p.task) !== p.job && p.job !== 'build')) { if (p.leg) { p.at = { p: p.leg.a.p.slice(), n: p.leg.a.n }; } p.phase = 'idle'; p.leg = null; p.t = 0; p.dur = 0; p.task = null; p.tgt = null; }
      }
      if (Array.isArray(q.parents) && q.parents.length === 2 && q.parents.every(x => Number.isInteger(x) && x >= 0 && x < i)) p.parents = q.parents.slice();
      if (typeof q.xpE === 'number') p.xpE = q.xpE;   // explorer xp (v4); trips are checked by Exped.sanitize below
      if (q.isNew === true && !v1) p.isNew = true;
      if (q.special === true && !v1) p.special = true;
      if (window.Story) window.Story.pupIn(p, v1 ? null : q);   // v8: diary
      s.pups.push(p);
    });
    if (!s.pups.length) return null;
    const vi = o.invite;
    if (!v1 && vi && typeof vi === 'object' && typeof vi.name === 'string' && /^[^<>&"\u0000-\u001f]{1,14}$/.test(vi.name) && BREEDS.includes(vi.breed) && JOBS.includes(vi.like) && LIKES.includes(vi.dislike))
      s.invite = { id: /^[a-z0-9]{1,16}$/.test(vi.id) ? vi.id : 'gift', name: vi.name, breed: vi.breed, collar: /^#[0-9a-fA-F]{6}$/.test(vi.collar) ? vi.collar : '#9fe8ff', like: vi.like, dislike: vi.dislike };
    // v4: expeditions (trips, unopened hauls, placed decor, explorer xp); older saves start with none
    window.Exped.sanitize(s, o.v >= 4 ? o : {}, nav);
    // v5 (step 4): wake-up, blight, wards, garden sprouts, friendships, events; older saves start fresh (a v4 island
    // that already went on a trip wakes its new needs from now)
    window.Needs.sanitize(s, o.v >= 5 ? o : {}, nav);
    window.Events.sanitize(s, o.v >= 5 ? o : {});
    // v7 (step 6): account id, public flag, island + host names, gift / outbox ids already merged; older saves: none yet
    if (window.Social) window.Social.sanitize(s, o.v >= 7 ? o : {});
    // v8 (Round 2 step 2): colour ring, the tree's log, chapters; older saves get the ring of their progress (no grey regression)
    if (window.Story) window.Story.sanitize(s, o.v >= 8 ? o : {});
    // v9 (Round 2 step 3): sky critters (visitors here now, album, recent visits); older saves: an empty album
    if (window.Critters) window.Critters.sanitize(s, o.v >= 9 ? o : {});
    // v10 (Round 2 step 4): lantern notes (received / sent logs, a lantern waiting for dusk) + World Bloom petals + claimed gifts
    if (window.Lanterns) window.Lanterns.sanitize(s, o.v >= 10 ? o : {});
    s.health = healthOf(s); return s;
  }

  window.Sim = { C, PUPS, JOBS, BREEDS, NAMES, tod, dayH, dayCurve, napNow, fac, facK, fits, season, create, step, assign, rename, order, cancel, catchUp, pose, sanitize, healthOf, scaleOf, mult, moraleTarget,
    bedsOf, counts, costOf, workOf, afford, canBuild, foodNet, autoPlan, fillPlan, arrivalOk, avgMorale, bedsFor, WALK, eaters,
    NTASK, _: { stopWalking, startWalk, newPup, begin, goNap } };   // internals for src/expedition.js + src/needs.js
})();
