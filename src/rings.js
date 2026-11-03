// Elder rings (roadmap update 3, 2026-11-03, branch aeryn-post-elder; save v15). Pure JS on the sim state (no three.js, no
// Math.random, no clock), loaded right after pacing.js; tools/sim_check.mjs, pacing_check.mjs and elder_check.mjs load it too.
//   Past Elder (tree level 8) the tree's growth keeps counting (S.xp was never capped) and every RING costs more than the last:
//   ring n = R0 x G^(n-1) growth past Sim.C.LV_XP[7]. The growth rate is the pacing pass's (Pacing.xpRate = health x the
//   growth pace), so a well-kept island earns rings faster; far-sky voyages (src/voyages.js) bring "starlight" = ring progress.
//   Nothing is ever taken away (a cozy game: no reset). Each ring = a small permanent perk (PERK: a voyage opens, an island
//   upgrade works a little better, an extra skyboat seat), a gift (sap, crystals, seeds; every 5th ring an outfit, every 4th
//   a decoration while the lists last), a memory line in the tree's voice (MEMS, then made-up verses) and one more band of
//   light round the trunk (src/ring_fx.js, view only).
// State S.elder = {r: rings celebrated (gift + event given once each), t: island time of the last ring, vy: {voyage isle id:
// times sailed}} exists only from Elder on (every island below L8 is byte-for-byte the pacing pass's: no field, no change).
(function () {
  'use strict';
  const C = {
    LV: 8,              // rings start at this tree level
    R0: 6000, G: 1.15,  // ring n costs R0 x G^(n-1) growth (tools/elder_check.mjs prints what that means in days)
    UP_K: 0.05,         // a ring's upgrade perk: + this to that upgrade's multiplier (rings 2-17)
    UP_K2: 0.02,        // past the hand-made list: + this, round the five upgrades
    UP_CAP: 0.3,        // the most rings add to one upgrade
    SEAT: 4,            // the ring that adds a 5th skyboat seat
    LOG: 60,            // ring times kept (the Book's list shows the last ones)
  };
  // the hand-made perks (index = ring). After the list: a small upgrade bonus round the five upgrades, every ring, forever.
  const PERKS = [null,
    { k: 'voy', id: 'shoals' }, { k: 'up', id: 'well' }, { k: 'voy', id: 'lighthouse' }, { k: 'seat' }, { k: 'up', id: 'lamp' },
    { k: 'voy', id: 'whale' }, { k: 'up', id: 'roots' }, { k: 'up', id: 'berry' }, { k: 'voy', id: 'grove' }, { k: 'up', id: 'shop' },
    { k: 'up', id: 'well' }, { k: 'voy', id: 'starwell' }, { k: 'up', id: 'lamp' }, { k: 'up', id: 'roots' }, { k: 'voy', id: 'edge' },
    { k: 'up', id: 'berry' }, { k: 'up', id: 'shop' },
  ];
  const UP_IDS = ['well', 'lamp', 'roots', 'berry', 'shop'];
  function perkOf(n) {
    if (n < 1) return null;
    if (n < PERKS.length) { const p = PERKS[n]; return p.k === 'up' ? { k: 'up', id: p.id, v: C.UP_K } : p; }
    return { k: 'up', id: UP_IDS[(n - PERKS.length) % UP_IDS.length], v: C.UP_K2 };
  }
  // gifts: outfits on rings 5 / 10 / 15 / 20, decorations on 4 / 8 / 12 / 16 (Wardrobe.DEFS / Exped.DECOR hold them)
  const OUTFITS = ['bark-bandana', 'ringlight-cap', 'blossom-hood', 'elder-cape'];
  const DECOR = ['ring-orb', 'elder-wisp', 'ring-stones', 'ring-lantern'];
  function giftOf(n) {
    const g = { sap: 100 + 25 * n, crystal: 6 + 2 * n, seeds: 2 + Math.floor(n / 3), outfit: null, decor: null };
    if (n % 5 === 0) { const o = OUTFITS[n / 5 - 1]; if (o) g.outfit = o; else g.crystal += 10; }
    if (n % 4 === 0) { const d = DECOR[n / 4 - 1]; if (d) g.decor = d; else g.crystal += 10; }
    return g;
  }

  // ---- the ring curve: start(n) = growth past Elder at which ring n is reached (start(0) = 0)
  const S_ = () => window.Sim;
  const base = () => S_().C.LV_XP[C.LV - 1];
  const costOf = n => C.R0 * Math.pow(C.G, n - 1);
  const start = n => n <= 0 ? 0 : C.R0 * (Math.pow(C.G, n) - 1) / (C.G - 1);
  function ringOf(xp) {
    const past = (xp || 0) - base(); if (!(past > 0)) return 0;
    let n = Math.floor(Math.log(1 + past * (C.G - 1) / C.R0) / Math.log(C.G));
    while (n > 0 && start(n) > past + 1e-6) n--;     // (float edges: exact either side)
    while (start(n + 1) <= past + 1e-6) n++;
    return Math.min(n, 9999);
  }
  // -> {n rings reached, into (growth into the next one), need (its cost), f 0..1, left}
  function progress(s) {
    const past = Math.max(0, s.xp - base()), n = ringOf(s.xp), a = start(n), need = costOf(n + 1), into = Math.max(0, past - a);
    return { n, into, need, f: Math.min(1, into / need), left: Math.max(0, need - into), elder: s.level >= C.LV };
  }
  const got = s => (s.elder ? s.elder.r : 0);
  // perks in force (from the rings CELEBRATED, so a perk and its card arrive together)
  function upBonus(s, id) {
    const r = got(s); if (!r) return 0; let b = 0;
    for (let n = 1; n <= r; n++) { const p = perkOf(n); if (p.k === 'up' && p.id === id) b += p.v; }
    return Math.min(C.UP_CAP, Math.round(b * 1000) / 1000);
  }
  const seat = s => got(s) >= C.SEAT;
  // the ring that opens a voyage isle (0 = never in the list)
  const voyRing = id => { for (let n = 1; n < PERKS.length; n++) if (PERKS[n].k === 'voy' && PERKS[n].id === id) return n; return 0; };
  const voyOpen = (s, id) => { const n = voyRing(id); return n > 0 && s.level >= C.LV && got(s) >= n; };
  // the next perk worth a goal line: the next voyage / seat if one is left, else the next ring
  function nextBig(s) { const r = got(s); for (let n = r + 1; n < PERKS.length; n++) if (PERKS[n].k !== 'up') return { n, p: PERKS[n] }; return { n: r + 1, p: perkOf(r + 1) }; }

  // ---- per sim step (after the tree's growth + level-ups): a ring reached = its gift once + an event (the game's card)
  function ensure(s) { if (!s.elder) s.elder = { r: 0, t: [], vy: {} }; return s.elder; }
  function tick(s, dt, nav, ev) {
    if (s.level < C.LV) return;
    const E = ensure(s), n = ringOf(s.xp);
    while (E.r < n) {
      const k = ++E.r, g = giftOf(k);
      s.sap += g.sap; s.res.crystal = (s.res.crystal || 0) + g.crystal; s.inv.seeds += g.seeds;
      if (g.outfit && !s.inv.outfits.includes(g.outfit)) s.inv.outfits.push(g.outfit);
      if (g.decor) s.inv.decor.push(g.decor);
      E.t.push(Math.round(s.time)); if (E.t.length > C.LOG) E.t.shift();
      if (ev) ev.push({ type: 'ring', n: k, gift: g });
    }
  }

  // ---- the tree's ring memories (one line per ring, its own voice; past the list: a verse made from the ring + island)
  const MEMS = [null,
    ['The First Ring', 'Under the bark, quiet as snow, a new ring closed round the old ones. The tree feels it like a deep breath. Somewhere past the clouds, a shoal of lost songs starts to hum.'],
    ['Deep Water', 'The roots found an old spring far below and drank from it all night. The buckets come up colder and sweeter now. The pups have noticed.'],
    ['A Light Far Out', 'Last night the tree saw a light blinking at the edge of the sky, patient as a heartbeat. An old lighthouse, still keeping watch, with nobody left to keep it.'],
    ['Room for One More', 'The skyboat makers carved a fifth seat from a fallen bough. Nobody has to stay behind on the dock and wave any more, unless they want to.'],
    ['Lanterns Remember', 'Every lantern hung in these branches has a little of the tree in it now. They burn a touch brighter, and they hum when the wind is soft.'],
    ['Where the Whale Sleeps', 'The sky whale sang on its way past tonight, and the tree understood it for the first time: there is a place where it rests. It is not far, for a whale.'],
    ['Old Friends', 'The pups who planted the first bucket of water are old friends now. They nap in the same roots every afternoon, in the same order, and snore in the same key.'],
    ['Berry Weather', 'The bushes along the paths remember every gardener who tended them. This year they are so heavy the pups eat half on the way home. Nobody minds.'],
    ['The Sister Tree', 'The tree dreamt of another great tree, grey and asleep far across the sky. It does not know her name. It only knows she is waiting, and that she is kind.'],
    ['Hands That Build', 'The builders hum the tree\'s own song while they work now, hammers keeping time. Their beams go up straighter. The tree is a little proud of them.'],
    ['Slow Time', 'A tree counts time in rings, not days. Eleven rings since it was the Elder: to the pups that is a long while. To the tree it is a few good breaths.'],
    ['A Well of Stars', 'On the clearest nights the tree can see a well far out where the stars come down to drink. It would like the pups to see it too, one day.'],
    ['Little Lights', 'Even the smallest lantern on the farthest path leans toward the trunk at dusk, the way flowers lean toward the sun. The tree leans back.'],
    ['Deep Roots', 'The roots have reached the island\'s oldest stones and wrapped round them like a hug. The gardens above them have never grown so well.'],
    ['The Far Edge', 'There is an edge to the sky, the old stories say, where the clouds end and the stars begin. The tree thinks a brave boat could get there now.'],
    ['Sweet Harvest', 'So many berries this ring that the pups started a contest: whose pie is the biggest. Every pie won. The tree decided that was fair.'],
    ['Steady Hands', 'The workshop has been busy so long that the floor is worn smooth in the shape of pup paws. The tree likes that best of everything they have made.'],
    ['Many Seasons', 'The tree has seen spring come back so many times it has stopped being surprised. It is still delighted every single time.'],
    ['Names in the Bark', 'If you look closely at the old roots you can see where the pups scratched their names when they were small. The tree grew round them gently, so they would stay.'],
    ['Quiet Glow', 'Twenty rings. The tree glows even on the darkest nights now, softly, so no pup on the island ever has to sleep without a little light.'],
  ];
  const SEA_V = ['In spring', 'In summer', 'In autumn', 'In winter'];
  const VERSE = ['the bark grew one more line of light', 'a new ring settled round the heart of the wood', 'the tree breathed in and grew a little wider', 'one more ring of gold closed under the bark'];
  const TAIL = [p => `${p} slept in the roots and dreamt of it too.`, p => `${p} put an ear to the trunk and heard it hum.`, p => `${p} swears the leaves waved hello.`, p => `the pups threw a small party; ${p} brought the berries.`];
  // -> {title, text}; `sea` = the season index then (or -1), `pup` = a pup name for the made-up verses
  function memOf(n, sea, pup) {
    const m = MEMS[n]; if (m) return { title: m[0], text: m[1] };
    const p = pup || 'Pudding', a = SEA_V[sea >= 0 && sea < 4 ? sea : (n % 4)], b = VERSE[n % VERSE.length], c = TAIL[(n * 7) % TAIL.length](p);
    return { title: `Ring ${n}`, text: `${a}, ${b}, and ${c}` };
  }
  // the perk in words (cards, the Book, the tree card)
  function perkText(p) {
    if (!p) return '';
    if (p.k === 'voy') { const V = window.Voyages, d = V && V.BY[p.id]; return d ? `A far-sky voyage opens: ${d.name}` : 'A far-sky voyage opens'; }
    if (p.k === 'seat') return 'Every skyboat gets a 5th seat';
    const u = window.Pacing && window.Pacing.UP[p.id]; return `${u ? u.name : p.id} +${Math.round(p.v * 100)}%, for good`;
  }

  // ---- save (v15): {r, t, vy} with canonical key order; r never more than the xp has earned (a lost ring comes back next step)
  function sanitize(s, o) {
    delete s.elder; const e = o && o.elder; if (!e || typeof e !== 'object' || s.level < C.LV) return;
    const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
    const vy = {}, V = window.Voyages; if (e.vy && typeof e.vy === 'object') for (const id of (V ? V.IDS : Object.keys(e.vy))) { const n = Math.round(fin(e.vy[id], 0, 0, 1e6)); if (n) vy[id] = n; }
    const t = Array.isArray(e.t) ? e.t.filter(x => typeof x === 'number' && isFinite(x) && x >= 0 && x <= s.time + 1).map(Math.round).slice(-C.LOG) : [];
    s.elder = { r: Math.round(fin(e.r, 0, 0, ringOf(s.xp))), t, vy };
  }

  window.Rings = { C, PERKS, OUTFITS, DECOR, perkOf, giftOf, costOf, start, ringOf, progress, got, upBonus, seat, voyRing, voyOpen, nextBig, tick, memOf, perkText, sanitize, MEMS };
})();
