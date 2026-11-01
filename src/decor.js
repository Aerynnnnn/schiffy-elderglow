// Free decor (2026-11-01): earned decorations stand anywhere on the island the player puts them. Pure, deterministic
// (no three.js, no Math.random), loaded right after expedition.js; tools/sim_check.mjs loads it too.
//   S.placed = [{ id, k, x, z, r }]  id = Exped.DECOR key, k = a stable handle per placed thing (critter visits point at
//   it: 'd<k>'), x / z = metres (0.1), r = yaw (radians, 0.001). Save v11; v4-v10 kept only a spot index k into
//   nav.decorSpots: migrated onto that spot with the yaw it was drawn with (k * 2.399), handle = the old index.
// Rules (check): on the island's open land (tree level ring, near a road), dry + off every bridge, off the roads, outside
// the Elder Tree's trunk + roots and its door path, clear of houses / halls / trees / rocks / other decor (nav's footprint
// boxes), clear of every job spot / door / builder spot, and (on placing) every job spot near it can still be walked to.
// sync(s, nav) hands S.placed to the nav as blockers (Sim.step calls it first), so the pups walk round decor.
(function () {
  'use strict';
  const C = {
    MAX: 60,           // things out on the island at once
    ROAD: 2.4,         // m from a road line to the decoration's footprint
    JOB: 2.4,          // m from a job spot / door / builder spot
    PIECE: 1,          // m from the layout's small decor pieces that have no footprint (braziers, fairy rings, garden boxes)
    NODE: 110,         // must be within this of a (non-bridge) road node: on the island (the plaza has few nodes; the game also needs ground there)
    REACH: 30,         // job spots whose walk to their road node passes this close are re-walked before a placement
    LAND: [0, 190, 260, 275, 275, 460, 460, 460, 460],   // m from the tree, by tree level (the land rings plots open on)
    THIN_R: 210,       // a thinned (hidden) forest tree inside this never grows back: decor may stand on its spot
  };
  // footprints of the kit pieces nav.js has none for ([cx, cz, hx, hz], piece space, measured from the kit GLBs 2026-11-01)
  // (vertices below 2 m of each kit batch; the same read gives EG_WispTree_A exactly its nav.FOOT box)
  const PFOOT = { EG_GlowShrooms_A: [0.16, 0.03, 1.14, 1.27], EG_GlowShrooms_B: [0.15, -0.01, 1.68, 1.53], EG_FairyRing: [0.01, 0.01, 2.28, 2.09], EG_Brazier: [0.01, 0, 0.47, 0.45] };
  const X_ = () => window.Exped, N_ = () => window.Nav;
  const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
  const TAU = Math.PI * 2, yaw = r => r3(((r % TAU) + TAU) % TAU);
  const dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  // the footprint of a decoration in metres at its own scale: [cx, cz, hx, hz] (yaw applied by nav.boxOf)
  function footOf(id) {
    const D = X_().DECOR[id]; if (!D) return null;
    const f = N_().FOOT[D.piece] || PFOOT[D.piece] || [0, 0, 1, 1];
    return [f[0] * D.s, f[1] * D.s, f[2] * D.s, f[3] * D.s];
  }
  const radOf = id => { const f = footOf(id); return f ? Math.hypot(f[2], f[3]) + Math.hypot(f[0], f[1]) : 1; };

  // ---- nav sync: S.placed -> nav blockers (cheap when nothing changed: the signature string is all it compares)
  const sigOf = s => (s.placed || []).map(x => x.id + ',' + x.k + ',' + x.x + ',' + x.z + ',' + x.r).join('|');
  const boxesOf = list => list.map(x => ({ k: x.k, f: footOf(x.id), x: x.x, z: x.z, r: x.r })).filter(b => b.f);
  function sync(s, nav) { if (nav && nav.setDecor) nav.setDecor(boxesOf(s.placed || []), sigOf(s)); }

  // ---- what may never be covered (per nav, built once): job spots, doors, builder spots, blight / ward rings, small pieces
  const PROT = new WeakMap();
  function protOf(nav) {
    let P = PROT.get(nav); if (P) return P;
    P = [];
    const add = (p, n, m, why) => { if (p) P.push({ p, n: n === undefined ? -1 : n, m, why }); };
    for (const w of nav.water) { add(w.p, w.n, C.JOB, 'job'); add(w.dip, -1, C.JOB, 'job'); }
    for (const o of nav.orbs) add(o.p, o.n, C.JOB, 'job');
    for (const k in nav.gather) for (const g of nav.gather[k]) add(g.p, g.n, C.JOB, 'job');
    for (const q of nav.plots) {
      add(q.door, -1, C.JOB, 'door');
      for (let j = 0; j < 7; j++) { const t = nav.site(q.pid, j); add(t.p, t.n, C.JOB, 'door'); }
      if (q.kind === 'market') add(q.pos, -1, 20, 'building');
    }
    for (const b of nav.blightSpots) add(b.p, b.n, 6, 'job');
    for (const w of nav.wardSpots) add(w.p, w.n, 4, 'job');
    for (const k in nav.other) { const j = nav.other[k]; add(j.at, -1, 4, 'job'); }
    for (const p of nav.placements || []) if (p.role === 'decor' && !N_().FOOT[p.piece]) add(p.pos, -1, C.PIECE + (PFOOT[p.piece] ? PFOOT[p.piece][2] * (p.s || 1) : 0.6), 'decor');
    PROT.set(nav, P); return P;
  }

  // ---- may decoration `id` stand at (x, z) with yaw r? -> { ok, why } (why: far, tree, door, water, bridge, path, building,
  // nature, decor, job, blocked, full, none). skipK = the handle of the one being moved (it does not block itself).
  // opt.reach = false skips the walk test (save repair: placed things passed it when they were put down)
  function check(s, nav, id, x, z, r, skipK, opt) {
    const f = footOf(id); if (!f) return { ok: false, why: 'none' };
    sync(s, nav);   // the nav's blockers = this island's decor (one nav may serve two islands)
    const Nav = N_(), TP = nav.TP, rad = radOf(id), lv = Math.max(1, Math.min(C.LAND.length - 1, s.level || 1));
    if (!isFinite(x) || !isFinite(z) || !isFinite(r)) return { ok: false, why: 'far' };
    if ((s.placed || []).filter(o => o.k !== skipK).length >= C.MAX) return { ok: false, why: 'full' };
    const dT = Math.hypot(x - TP[0], z - TP[2]);
    if (dT > C.LAND[lv]) return { ok: false, why: 'far' };
    let nn = Infinity; for (const n of nav.nodes) if (!n.bridge) nn = Math.min(nn, Math.hypot(n.p[0] - x, n.p[2] - z)); if (nn > C.NODE) return { ok: false, why: 'far' };
    if (dT < nav.trunkR(1) + rad) return { ok: false, why: 'tree' };   // the Elder Tree's trunk + root flare (its full size)
    { const D = nav.door(1).p, ux = (D[0] - TP[0]) / (Math.hypot(D[0] - TP[0], D[2] - TP[2]) || 1), uz = (D[2] - TP[2]) / (Math.hypot(D[0] - TP[0], D[2] - TP[2]) || 1);
      const u = (x - TP[0]) * ux + (z - TP[2]) * uz, v = -(x - TP[0]) * uz + (z - TP[2]) * ux; if (u > 0 && u < 95 && Math.abs(v) < 3.2 + rad) return { ok: false, why: 'door' }; }
    if (nav.onDeck(x, z)) return { ok: false, why: 'bridge' };
    if (nav.roadDist(x, z, C.ROAD + rad + 1) < C.ROAD + rad) return { ok: false, why: 'path' };
    // the footprint itself, sampled every <= 0.45 m (edges included): water (1 m cells), decks, footprints of other things
    const box = nav.boxOf(x, z, r, f, 1, 'cand', -1), hx = box.hx - Nav.PUP_R, hz = box.hz - Nav.PUP_R;
    const nx = Math.max(2, Math.ceil(2 * hx / 0.45)), nz = Math.max(2, Math.ceil(2 * hz / 0.45));
    const own = skipK === undefined || skipK === null ? null : (nav.decorBoxes().find(b => b.dk === skipK) || null);
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const lx = -hx + 2 * hx * i / nx, lz = -hz + 2 * hz * j / nz, px = box.x + lx * box.c + lz * box.sn, pz = box.z - lx * box.sn + lz * box.c;
      if (nav.onDeck(px, pz)) return { ok: false, why: 'bridge' };
    }
    // water: every mask cell whose centre lies in the box grown by half a cell's diagonal (no sliver slips between samples)
    { const wc = nav.wcell || 1, gx = hx + wc * 0.71, gz = hz + wc * 0.71, R = Math.hypot(gx, gz);
      for (let i = Math.floor((box.x - R) / wc); i <= Math.floor((box.x + R) / wc); i++) for (let j = Math.floor((box.z - R) / wc); j <= Math.floor((box.z + R) / wc); j++) {
        const cx = (i + 0.5) * wc, cz = (j + 0.5) * wc; if (!nav.cellWet(cx, cz)) continue;
        const dx = cx - box.x, dz = cz - box.z; if (Math.abs(dx * box.c - dz * box.sn) <= gx && Math.abs(dx * box.sn + dz * box.c) <= gz) return { ok: false, why: 'water' };
      } }
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {   // footprints of houses / trees / rocks / other decor
      const lx = -hx + 2 * hx * i / nx, lz = -hz + 2 * hz * j / nz, b = blockerAt(nav, box.x + lx * box.c + lz * box.sn, box.z - lx * box.sn + lz * box.c, own); if (b) return { ok: false, why: b };
    }
    // job spots, doors, builder spots, blight + ward rings, small layout pieces: none inside the footprint (+ margin)
    for (const q of protOf(nav)) {
      if (Math.abs(q.p[0] - x) > rad + q.m + 1 || Math.abs(q.p[2] - z) > rad + q.m + 1) continue;
      const dx = q.p[0] - box.x, dz = q.p[2] - box.z, lx = dx * box.c - dz * box.sn, lz = dx * box.sn + dz * box.c;
      if (Math.abs(lx) <= hx + q.m && Math.abs(lz) <= hz + q.m) return { ok: false, why: q.why };
    }
    if (opt && opt.reach === false) return { ok: true };
    // every job spot whose walk to its road node passes near: still walkable round the blockers with this one added
    const list = (s.placed || []).filter(o => o.k !== skipK).map(o => ({ k: o.k, f: footOf(o.id), x: o.x, z: o.z, r: o.r })).filter(b => b.f);
    const base = list.slice(); list.push({ k: -1, f, x, z, r });
    nav.setDecor(list, 'probe');
    let bad = false;
    try {
      const cut = [];
      for (const q of protOf(nav)) {
        if (q.n < 0) continue;
        const a = q.p, b = nav.nodes[q.n].p, dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2)) : 0;
        if (Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t) > C.REACH + rad) continue;
        if (!nav.reachOk(a, b)) cut.push([a, b]);
      }
      // only a spot THIS one cuts off counts (a few spots have no clean way round the map's own things already)
      if (cut.length) { nav.setDecor(base, 'probe0'); bad = cut.some(([a, b]) => nav.reachOk(a, b)); }
    } finally { sync(s, nav); }
    return bad ? { ok: false, why: 'blocked' } : { ok: true };
  }
  // the footprint under (px, pz) that a decoration may not overlap: 'building' / 'nature' / 'decor', or null
  function blockerAt(nav, px, pz, own) {
    for (const b of nav.blocksAt(px, pz)) {
      if (own && b.k === own.k) continue;
      if (b.id === 'decor') return 'decor';
      if (b.role === 'forest' && !N_().keepForest(b.id) && Math.hypot(b.x - nav.TP[0], b.z - nav.TP[2]) < C.THIN_R) continue;   // a hidden tree that never grows back
      return b.role === 'house' || b.role === 'faction' || b.role === 'market' ? 'building' : 'nature';
    }
    return null;
  }

  // ---- changes: every one goes through apply(), which re-walks the pups that are walking (their legs were made round the
  // old blockers) from where they are now, and moves a resting pup that now stands under a decoration. A save taken after
  // a change then holds only legs made round the current set: load == online.
  function apply(s, nav, fn) {
    const Sim = window.Sim; sync(s, nav);
    const at = s.pups.map(p => {
      if (!p.leg || !Sim.WALK[p.phase]) return null;
      const L = nav.leg(p.leg.a, p.leg.b, p.leg.R), q = nav.at(L, p.t * Sim.C.SPEED);
      return { p: q.p.map(v => Math.round(v * 1000) / 1000), n: nav.nodeNear(L, q.seg, p.leg.a.n) };
    });
    fn(); sync(s, nav);
    s.pups.forEach((p, i) => {
      if (at[i]) { const b = p.leg.b; p.at = at[i]; Sim._.startWalk(s, p, nav, b, p.phase); }
      else if (!p.exp && (p.phase === 'rest' || p.phase === 'nap' || p.phase === 'idle') && p.at && nav.decorAt(p.at.p[0], p.at.p[2])) { p.phase = 'idle'; p.t = 0; p.dur = 0; if (p.task === 'nap') p.task = null; }
    });
  }
  const owned = (s, id) => s.inv.decor.filter(x => x === id).length;
  const outN = (s, id) => s.placed.filter(x => x.id === id).length;
  const nextK = (s, nav) => { let k = (nav.decorSpots || []).length - 1; for (const x of s.placed) k = Math.max(k, x.k); return k + 1; };
  // put a decoration from the shed down at (x, z, yaw r) -> its handle k, or -1 (res.why says why when res is passed)
  function place(s, nav, id, x, z, r, res) {
    if (!X_().DECOR[id] || owned(s, id) - outN(s, id) < 1) { if (res) res.why = 'none'; return -1; }
    x = r1(x); z = r1(z); r = yaw(r || 0);
    const c = check(s, nav, id, x, z, r); if (res) res.why = c.why; if (!c.ok) return -1;
    const k = nextK(s, nav); apply(s, nav, () => s.placed.push({ id, k, x, z, r })); return k;
  }
  function move(s, nav, k, x, z, r, res) {
    const o = s.placed.find(y => y.k === k); if (!o) { if (res) res.why = 'none'; return false; }
    x = r1(x); z = r1(z); r = yaw(r);
    const c = check(s, nav, o.id, x, z, r, k); if (res) res.why = c.why; if (!c.ok) return false;
    apply(s, nav, () => { o.x = x; o.z = z; o.r = r; }); return true;
  }
  function remove(s, nav, k) {
    const j = s.placed.findIndex(y => y.k === k); if (j < 0) return false;
    apply(s, nav, () => s.placed.splice(j, 1)); return true;
  }
  // the old way (step 3): on the k-th decor spot (or the first free one that passes), drawn with the old yaw
  const spotYaw = k => yaw((k * 2.399) % TAU);
  // a placed record standing on decor spot k (migration, mock sample islands, tests); null when there is no such spot
  const spotItem = (nav, id, k) => { const sp = (nav.decorSpots || [])[k]; return sp ? { id, k, x: r1(sp.p[0]), z: r1(sp.p[2]), r: spotYaw(k) } : null; };
  function placeSpot(s, nav, id, k) {
    const spots = nav.decorSpots || [], near = j => s.placed.some(o => Math.hypot(o.x - spots[j].p[0], o.z - spots[j].p[2]) < 6);
    if (!X_().DECOR[id] || owned(s, id) - outN(s, id) < 1) return -1;
    const try1 = j => { if (j < 0 || j >= spots.length || near(j) || s.placed.some(o => o.k === j)) return false; const x = r1(spots[j].p[0]), z = r1(spots[j].p[2]), r = spotYaw(j);
      if (!check(s, nav, id, x, z, r).ok) return false; apply(s, nav, () => s.placed.push({ id, k: j, x, z, r })); return true; };
    if (k !== undefined && k !== null) return try1(k) ? k : -1;
    for (let j = 0; j < spots.length; j++) if (try1(j)) return j;
    return -1;
  }

  // ---- save (called by Sim.sanitize BEFORE the pups, so their saved legs are measured round the saved decor)
  const fin = v => typeof v === 'number' && isFinite(v);
  function sanitize(s, o, nav) {
    s.placed = [];
    const spots = nav.decorSpots || [], seen = new Set();
    if (Array.isArray(o && o.placed)) for (const x of o.placed) {
      if (!x || typeof x !== 'object' || !X_().DECOR[x.id] || owned(s, x.id) - outN(s, x.id) < 1 || s.placed.length >= C.MAX) continue;
      if (fin(x.x) && fin(x.z)) {   // v11: free placement (repaired / dropped by the cheap rules; the walk test ran when it was placed)
        const k = Number.isInteger(x.k) && x.k >= 0 && x.k < 1e6 && !seen.has(x.k) ? x.k : nextK(s, nav), it = { id: x.id, k, x: r1(x.x), z: r1(x.z), r: yaw(fin(x.r) ? x.r : 0) };
        // a migrated one still on its old decor spot keeps its place (those spots predate today's rules)
        const sp = spots[k], onSpot = sp && Math.abs(r1(sp.p[0]) - it.x) < 0.05 && Math.abs(r1(sp.p[2]) - it.z) < 0.05;
        sync(s, nav); if (!onSpot && !check(s, nav, it.id, it.x, it.z, it.r, null, { reach: false }).ok) continue;
        seen.add(k); s.placed.push(it);
      } else if (Number.isInteger(x.k) && x.k >= 0 && x.k < spots.length && !seen.has(x.k)) {   // v4-v10: a decor spot index
        const sp = spots[x.k]; if (s.placed.some(y => Math.hypot(y.x - sp.p[0], y.z - sp.p[2]) < 2)) continue;
        seen.add(x.k); s.placed.push(spotItem(nav, x.id, x.k));
      }
    }
    sync(s, nav);
  }

  // ---- hook for a later update (island utility, NOT built yet): an effects table keyed by decor id ('moon-lantern': keepers
  // nearby work faster, a well by a garden grows it faster, sets that attract critters, ...). A decoration with no entry stays
  // purely decorative. The sim would read where things stand through items() / near() (position, footprint radius, its entry),
  // the same records + boxes the nav blocks with; nothing reads EFFECTS today, so it changes no number in any check.
  const EFFECTS = {};
  const items = s => (s.placed || []).map(o => ({ id: o.id, k: o.k, x: o.x, z: o.z, r: o.r, rad: radOf(o.id), fx: EFFECTS[o.id] || null }));
  // placed things whose footprint comes within R m of (x, z) (optionally only of one decor id), nearest first
  const near = (s, x, z, R, id) => items(s).filter(o => (!id || o.id === id) && Math.hypot(o.x - x, o.z - z) <= R + o.rad).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) || a.k - b.k);

  // the public snapshot's entries: [id, k, x, z, r] (an older game reads a[0], a[1] = the old [id, spot] pair and drops a
  // k past its spot list), and back
  const snap = s => s.placed.map(x => [x.id, x.k, x.x, x.z, x.r]);
  const unsnap = a => Array.isArray(a) ? a.filter(Array.isArray).map(e => e.length >= 4 ? { id: e[0], k: e[1], x: e[2], z: e[3], r: e[4] } : { id: e[0], k: e[1] }) : [];

  window.Decor = { C, PFOOT, footOf, radOf, sync, check, place, move, remove, placeSpot, spotItem, sanitize, protOf, sigOf, snap, unsnap, EFFECTS, items, near };
})();
