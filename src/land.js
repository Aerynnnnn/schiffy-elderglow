// Shaping the land (Round 3 update 2, creative build part 2, piece 3; save v13): paint your own paths, remove a forest tree,
// plant a tree that grows, lay flower meadows. Pure (no three.js, no Math.random), loaded right after catalog.js;
// tools/sim_check.mjs, decor_check.mjs and path_check.mjs load it too.
//   S.land = { paths: [{k, s, p}], cut: [pid], planted: [{k, t, x, z, r, at}], meadows: [{k, x, z, r, f}], n }
//     paths    p = [x10, z10, x10, z10, ...] (0.1 m ints), s = style 0 stepping stones / 1 packed earth (1.5 m strips)
//     cut      layout placement ids of removed forest trees (the layout is never edited: the instance is hidden by id)
//     planted  t = index into KINDS, x / z 0.1 m, r yaw (0.001), at = sim time planted (grows sapling -> full over C.GROW)
//     meadows  x / z 0.1 m, r radius (0.1 m), f = flower kind (0 mixed, 1 pink, 2 gold, 3 blue)
//     n        the next handle (k) for a new path / tree / meadow
// sync(s, nav) hands it to the nav (Sim.step calls it right after Decor.sync): cut trees lose their footprint, planted trees
// get one (full size from the day they are planted), painted paths join the road graph as cheap legs (pups prefer them).
// An empty S.land leaves the nav exactly as it was (every older sim case byte-identical).
(function () {
  'use strict';
  const C = {
    PATH_W: 1.5,       // m: a painted strip's width
    SEG: 6, MINSEG: 1, // m: the longest / shortest step between two stored points (the brush lays one every ~2.5 m)
    PATHS: 24, PTS: 64, TOTAL: 800,   // paths per island, points per path, metres of painted path in all
    JOB: 1.2,          // m: a painted path keeps this far from a job spot / door / builder spot (strip edge)
    CUT: 60, CUT_WOOD: 12,            // forest trees an island may remove; wood a removed tree gives (once)
    PLANT: 40, GROW: 2 * 86400, SAPLING: 0.22, COST: { seeds: 1, food: 4 },   // planted trees, sim seconds to full size, sapling size, cost each
    MEADOWS: 40, MR: [2.5, 9], MKINDS: 4,    // meadow patches, radius range (m), flower kinds
  };
  // what can be planted: the catalogue's Woods trees (same kit piece + size; full size = the crafted tree)
  const KINDS = ['oak-little', 'oak', 'oak-tall', 'spruce', 'spruce-b'];
  const D_ = () => window.Decor, Cat = () => window.Catalog, N_ = () => window.Nav;
  const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000, i10 = v => Math.round(v * 10);
  const TAU = Math.PI * 2, yaw = r => r3(((r % TAU) + TAU) % TAU);
  const fin = v => typeof v === 'number' && isFinite(v);
  const empty = () => ({ paths: [], cut: [], planted: [], meadows: [], n: 0 });
  function create(s) { s.land = empty(); }
  const L_ = s => s.land || (s.land = empty());
  const isEmpty = s => { const l = s.land; return !l || (!l.paths.length && !l.cut.length && !l.planted.length && !l.meadows.length); };
  const ptsOf = P => { const o = []; for (let i = 0; i + 1 < P.p.length; i += 2) o.push([P.p[i] / 10, P.p[i + 1] / 10]); return o; };
  const lenOf = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
  const total = s => L_(s).paths.reduce((a, P) => a + lenOf(ptsOf(P)), 0);
  const kindOf = t => Cat().BY[KINDS[t]];
  const footOf = t => D_().footOf(KINDS[t]);
  // how grown a planted tree is at sim time `now` (0 = just planted .. 1 = full), from S.time only (offline == online)
  const growth = (s, it) => Math.max(0, Math.min(1, ((s.time || 0) - it.at) / C.GROW));
  const sizeOf = g => C.SAPLING + (1 - C.SAPLING) * (1 - Math.pow(1 - g, 2));   // drawn size (x the kind's s): eased

  // ---- nav sync (cheap when nothing changed: the signature string is all it compares)
  const sigOf = s => { const l = s.land; if (!l) return ''; return l.paths.map(P => P.k + ':' + P.p.join(',')).join('|') + '#' + l.cut.join(',') + '#' + l.planted.map(t => t.k + ':' + t.t + ',' + t.x + ',' + t.z + ',' + t.r).join('|'); };
  function sync(s, nav) {
    if (!nav || !nav.setLand) return;
    const l = s.land, sig = sigOf(s);
    if (!l || sig === '##') { nav.setLand(null, ''); return; }
    nav.setLand({ paths: l.paths.map(P => ({ k: P.k, p: ptsOf(P) })), cut: l.cut, plant: l.planted.map(t => ({ k: t.k, f: footOf(t.t), x: t.x, z: t.z, r: t.r })).filter(b => b.f) }, sig);
  }
  // every change goes through apply(): walking pups re-walk from where they are (their legs were made on the old land), a
  // resting pup under a new tree gets up (the same as src/decor.js apply)
  function apply(s, nav, fn) {
    const Sim = window.Sim; D_().sync(s, nav); sync(s, nav);
    const at = s.pups.map(p => {
      if (!p.leg || !Sim.WALK[p.phase]) return null;
      const Lg = nav.leg(p.leg.a, p.leg.b, p.leg.R), q = nav.at(Lg, p.t * Sim.C.SPEED);
      return { p: q.p.map(v => Math.round(v * 1000) / 1000), n: nav.nodeNear(Lg, q.seg, p.leg.a.n) };
    });
    fn(); sync(s, nav);
    s.pups.forEach((p, i) => {
      if (at[i]) { const b = p.leg.b; p.at = at[i]; Sim._.startWalk(s, p, nav, b, p.phase); }
      else if (!p.exp && (p.phase === 'rest' || p.phase === 'nap' || p.phase === 'idle') && p.at && nav.plantAt && nav.plantAt(p.at.p[0], p.at.p[2])) { p.phase = 'idle'; p.t = 0; p.dur = 0; if (p.task === 'nap') p.task = null; }
    });
  }
  const nextK = s => { const l = L_(s); let k = l.n || 0; for (const a of [l.paths, l.planted, l.meadows]) for (const x of a) k = Math.max(k, x.k + 1); return k; };

  // ---- the open-land rules every land change shares (Decor's: the tree-level ring, near a road node, out of the Elder Tree)
  function landOk(s, nav, x, z, rad) {
    const TP = nav.TP, lv = Math.max(1, Math.min(D_().C.LAND.length - 1, s.level || 1));
    if (!fin(x) || !fin(z)) return 'far';
    const dT = Math.hypot(x - TP[0], z - TP[2]); if (dT > D_().C.LAND[lv]) return 'far';
    let nn = Infinity; for (const n of nav.nodes) if (!n.bridge) nn = Math.min(nn, Math.hypot(n.p[0] - x, n.p[2] - z)); if (nn > D_().C.NODE) return 'far';
    if (dT < nav.trunkR(1) + rad) return 'tree';
    return null;
  }

  // ---- painted paths. pts = [[x, z], ...] metres (the brush's points). -> {ok, why, i (the first bad point)}
  function checkPath(s, nav, pts, skipK) {
    D_().sync(s, nav); sync(s, nav); if (window.Homes) window.Homes.sync(s, nav);   // (this island's turned / free homes too)
    const l = L_(s), others = l.paths.filter(P => P.k !== skipK);
    if (!Array.isArray(pts) || pts.length < 2) return { ok: false, why: 'short' };
    if (others.length >= C.PATHS) return { ok: false, why: 'full' };
    if (pts.length > C.PTS) return { ok: false, why: 'long' };
    const len = lenOf(pts); if (len < 3) return { ok: false, why: 'short' };
    if (others.reduce((a, P) => a + lenOf(ptsOf(P)), 0) + len > C.TOTAL) return { ok: false, why: 'long' };
    const hw = C.PATH_W / 2, prot = D_().protOf(nav), y = nav.TP[1];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i]; const w = landOk(s, nav, x, z, hw + 1); if (w) return { ok: false, why: w, i };
      if (i) { const d = Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]); if (d > C.SEG + 0.05 || d < C.MINSEG - 0.05) return { ok: false, why: 'far', i }; }
    }
    for (let i = 1; i < pts.length; i++) {
      const p = [pts[i - 1][0], y, pts[i - 1][1]], q = [pts[i][0], y, pts[i][1]], d = Math.hypot(q[0] - p[0], q[2] - p[2]), n = Math.max(1, Math.ceil(d / 0.4));
      for (let k = 0; k <= n; k++) { const x = p[0] + (q[0] - p[0]) * k / n, z = p[2] + (q[2] - p[2]) * k / n; if (nav.onDeck(x, z)) return { ok: false, why: 'bridge', i }; }
      // dry (half a metre from deep water) + clear of houses / trees / rocks / decorations (their footprints grown by PUP_R),
      // every 0.4 m (no end point frees a footprint here: a strip never runs through a house)
      for (let k = 0; k <= n; k++) {
        const x = p[0] + (q[0] - p[0]) * k / n, z = p[2] + (q[2] - p[2]) * k / n;
        if (nav.wet(x, z) || nav.wet(x + 0.5, z) || nav.wet(x - 0.5, z) || nav.wet(x, z + 0.5) || nav.wet(x, z - 0.5)) return { ok: false, why: 'water', i };
        const B = nav.blocksAt(x, z).filter(b => !(b.role === 'forest' && !N_().keepForest(b.id) && Math.hypot(b.x - nav.TP[0], b.z - nav.TP[2]) < D_().C.THIN_R));   // (a hidden thinned tree that never grows back: Decor's rule)
        if (B.length) { const b = B[0]; return { ok: false, why: b.id === 'decor' ? 'decor' : b.role === 'house' || b.role === 'faction' || b.role === 'market' ? 'building' : 'nature', i }; }
      }
      // job spots, doors, builder spots: the strip stays C.JOB m off them (blight / ward rings and small pieces at most 1.2 m too)
      const dx = q[0] - p[0], dz = q[2] - p[2], l2 = dx * dx + dz * dz || 1e-9;
      for (const o of prot) {
        const m = Math.min(o.m, C.JOB) + hw, t = Math.max(0, Math.min(1, ((o.p[0] - p[0]) * dx + (o.p[2] - p[2]) * dz) / l2));
        if (Math.abs(o.p[0] - p[0] - dx * t) <= m && Math.abs(o.p[2] - p[2] - dz * t) <= m && Math.hypot(o.p[0] - p[0] - dx * t, o.p[2] - p[2] - dz * t) <= m) return { ok: false, why: o.why, i };
      }
    }
    return { ok: true };
  }
  // the brush: raw pointer points -> stored points (one every `step` m along the stroke, the last one kept)
  function resample(raw, step) {
    step = step || 2.5; const out = []; if (!raw || !raw.length) return out;
    out.push([r1(raw[0][0]), r1(raw[0][1])]); let acc = 0;
    for (let i = 1; i < raw.length; i++) {
      let [x0, z0] = raw[i - 1]; const [x1, z1] = raw[i]; let d = Math.hypot(x1 - x0, z1 - z0);
      while (acc + d >= step) { const f = (step - acc) / d; x0 = x0 + (x1 - x0) * f; z0 = z0 + (z1 - z0) * f; d = Math.hypot(x1 - x0, z1 - z0); acc = 0; out.push([r1(x0), r1(z0)]); }
      acc += d;
    }
    const e = raw[raw.length - 1], last = out[out.length - 1], dl = Math.hypot(e[0] - last[0], e[1] - last[1]);
    if (dl >= C.MINSEG) out.push([r1(e[0]), r1(e[1])]); else if (out.length > 1 && dl > 0.05) out[out.length - 1] = [r1(e[0]), r1(e[1])];   // (the stroke ends where it ended)
    return out.slice(0, C.PTS);
  }
  function addPath(s, nav, pts, style, res) {
    pts = (pts || []).map(p => [r1(p[0]), r1(p[1])]);
    const c = checkPath(s, nav, pts); if (res) { res.why = c.why; res.i = c.i; } if (!c.ok) return -1;
    const k = nextK(s); apply(s, nav, () => { const l = L_(s); l.paths.push({ k, s: style === 1 ? 1 : 0, p: [].concat(...pts.map(p => [i10(p[0]), i10(p[1])])) }); l.n = k + 1; });
    return k;
  }
  function removePath(s, nav, k) { const l = L_(s), j = l.paths.findIndex(P => P.k === k); if (j < 0) return false; apply(s, nav, () => l.paths.splice(j, 1)); return true; }
  // the painted path under (x, z) within R m: its handle, or null
  function pathAt(s, x, z, R) {
    let best = null, bd = R === undefined ? C.PATH_W : R;
    for (const P of L_(s).paths) { const q = ptsOf(P); for (let i = 1; i < q.length; i++) { const [ax, az] = q[i - 1], [bx, bz] = q[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t); if (d < bd) { bd = d; best = P.k; } } }
    return best;
  }

  // ---- removing a forest tree: a kept (shown) forest tree on open land, never a wood / stone / berry gather spot (the
  // sim's spot lists are fingerprinted and saves point into them: those trees stay). Gives C.CUT_WOOD wood, once.
  const GATHER = new WeakMap();
  const gatherPids = nav => { let g = GATHER.get(nav); if (!g) { g = new Set(); for (const k in nav.gather) for (const x of nav.gather[k]) g.add(x.pid); GATHER.set(nav, g); } return g; };
  function canCut(s, nav, pid) {
    const p = nav.placements[pid]; if (!p || p.id !== pid || p.role !== 'forest' || !N_().keepForest(pid)) return { ok: false, why: 'none' };
    const l = L_(s); if (l.cut.includes(pid)) return { ok: false, why: 'none' };
    if (gatherPids(nav).has(pid)) return { ok: false, why: 'gather' };
    if (l.cut.length >= C.CUT) return { ok: false, why: 'full' };
    const w = landOk(s, nav, p.pos[0], p.pos[2], 0); if (w) return { ok: false, why: w };
    return { ok: true };
  }
  function cut(s, nav, pid, res) {
    const c = canCut(s, nav, pid); if (res) res.why = c.why; if (!c.ok) return false;
    apply(s, nav, () => { L_(s).cut.push(pid); s.res.wood += C.CUT_WOOD; }); return true;
  }
  // undo a removal (the tree comes back, its wood goes back): only with that much wood in the store, so wood comes once
  function uncut(s, nav, pid) {
    const l = L_(s), j = l.cut.indexOf(pid); if (j < 0 || s.res.wood < C.CUT_WOOD) return false;
    apply(s, nav, () => { l.cut.splice(j, 1); s.res.wood -= C.CUT_WOOD; }); return true;
  }
  // the removable forest tree nearest (x, z) within R m (shown kept forest trees only), or {pid, why} of the nearest refused one
  function treeAt(s, nav, x, z, R) {
    let best = null, bd = R || 4;
    for (const p of nav.placements) { if (p.role !== 'forest' || !N_().keepForest(p.id) || L_(s).cut.includes(p.id)) continue; const d = Math.hypot(p.pos[0] - x, p.pos[2] - z); if (d < bd) { bd = d; best = p; } }
    if (!best) return null; const c = canCut(s, nav, best.id); return { pid: best.id, ok: c.ok, why: c.why, pos: best.pos };
  }

  // ---- planting: costs C.COST (seeds + berries), the kind's tree level, Decor's placement rules for that tree (dry, open
  // land, off paths / job spots / other things, and with opt.reach every job spot near it still walkable)
  const have = (s, k) => k === 'seeds' ? s.inv.seeds : (s.res[k] || 0);
  function canPlant(s, t) {
    const e = kindOf(t); if (!e) return { ok: false, why: 'none' };
    if ((s.level || 1) < e.lv) return { ok: false, why: 'level', lv: e.lv };
    if (L_(s).planted.length >= C.PLANT) return { ok: false, why: 'full' };
    const need = {}; let short = false; for (const k in C.COST) { const m = C.COST[k] - have(s, k); if (m > 1e-9) { need[k] = Math.ceil(m); short = true; } }
    return short ? { ok: false, why: 'cost', need } : { ok: true };
  }
  function checkPlant(s, nav, t, x, z, r, opt) {
    const c = canPlant(s, t); if (!c.ok && !(opt && opt.free)) return c;
    D_().sync(s, nav); sync(s, nav);
    return D_().check(s, nav, KINDS[t], x, z, r || 0, null, { reach: !(opt && opt.reach === false), cap: false });
  }
  function plant(s, nav, t, x, z, r, res) {
    x = r1(x); z = r1(z); r = yaw(r || 0);
    const c = checkPlant(s, nav, t, x, z, r); if (res) res.why = c.why; if (!c.ok) return -1;
    const k = nextK(s);
    apply(s, nav, () => { for (const q in C.COST) { if (q === 'seeds') s.inv.seeds -= C.COST[q]; else s.res[q] -= C.COST[q]; } const l = L_(s); l.planted.push({ k, t, x, z, r, at: Math.round(s.time || 0) }); l.n = k + 1; });
    return k;
  }
  // dig a planted tree up (refund = the undo of a fresh planting: seeds + berries back)
  function unplant(s, nav, k, refund) {
    const l = L_(s), j = l.planted.findIndex(t => t.k === k); if (j < 0) return false;
    apply(s, nav, () => { l.planted.splice(j, 1); if (refund) for (const q in C.COST) { if (q === 'seeds') s.inv.seeds += C.COST[q]; else s.res[q] += C.COST[q]; } }); return true;
  }
  // undo of a dig-up: the same tree back where it stood, as grown as it was (no cost: digging gave nothing back)
  function replant(s, nav, it) {
    if (!it || !KINDS[it.t] || L_(s).planted.length >= C.PLANT) return false;
    if (!checkPlant(s, nav, it.t, it.x, it.z, it.r, { free: true }).ok) return false;
    const k = nextK(s); apply(s, nav, () => { const l = L_(s); l.planted.push({ k, t: it.t, x: it.x, z: it.z, r: it.r, at: it.at }); l.n = k + 1; }); return true;
  }
  const plantedAt = (s, x, z, R) => { let best = null, bd = R || 3; for (const t of L_(s).planted) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = t.k; } } return best; };

  // ---- flower meadows: walked on (block nobody), so only the land rules + dry ground under the middle
  function checkMeadow(s, nav, x, z, r, skipK) {
    const l = L_(s); if (l.meadows.filter(m => m.k !== skipK).length >= C.MEADOWS) return { ok: false, why: 'full' };
    if (!fin(r) || r < C.MR[0] - 1e-9 || r > C.MR[1] + 1e-9) return { ok: false, why: 'far' };
    const w = landOk(s, nav, x, z, r); if (w) return { ok: false, why: w };
    if (nav.cellWet(x, z) && !nav.onDeck(x, z)) return { ok: false, why: 'water' };
    if (nav.onDeck(x, z)) return { ok: false, why: 'bridge' };
    return { ok: true };
  }
  function addMeadow(s, nav, x, z, r, f, res) {
    x = r1(x); z = r1(z); r = r1(r);
    const c = checkMeadow(s, nav, x, z, r); if (res) res.why = c.why; if (!c.ok) return -1;
    const l = L_(s), k = nextK(s); l.meadows.push({ k, x, z, r, f: Math.max(0, Math.min(C.MKINDS - 1, f | 0)) }); l.n = k + 1; return k;   // (walked on: nav unchanged)
  }
  function removeMeadow(s, k) { const l = L_(s), j = l.meadows.findIndex(m => m.k === k); if (j < 0) return false; l.meadows.splice(j, 1); return true; }
  const meadowAt = (s, x, z) => { let best = null, bd = Infinity; for (const m of L_(s).meadows) { const d = Math.hypot(m.x - x, m.z - z); if (d <= m.r && d < bd) { bd = d; best = m.k; } } return best; };

  // ---- save (Sim.sanitize calls it right after Decor.sanitize, BEFORE the pups: their legs are measured on this land).
  // v12 / v13 saves without land: an empty S.land. Junk dropped, lists capped, every entry re-checked by the cheap rules in
  // the order it was made (removed trees, then paths, then planted trees: a tree is never planted on a path)
  function sanitize(s, o, nav, visit) {
    s.land = empty();
    const src = o && o.land && typeof o.land === 'object' ? o.land : null;
    if (src) {
      const l = s.land, seenK = new Set(), okK = k => Number.isInteger(k) && k >= 0 && k < 1e6 && !seenK.has(k);
      if (Array.isArray(src.cut)) for (const pid of src.cut) { if (Number.isInteger(pid) && !l.cut.includes(pid) && l.cut.length < C.CUT && canCut({ land: l, level: 8, res: {} }, nav, pid).ok) l.cut.push(pid); }
      sync(s, nav);
      if (Array.isArray(src.paths)) for (const P of src.paths) {
        if (!P || !Array.isArray(P.p) || P.p.length < 4 || P.p.length % 2 || P.p.length > 2 * C.PTS || !P.p.every(v => Number.isInteger(v) && Math.abs(v) < 40000)) continue;
        const pts = []; for (let i = 0; i < P.p.length; i += 2) pts.push([P.p[i] / 10, P.p[i + 1] / 10]);
        const k = okK(P.k) ? P.k : nextK(s); if (!checkPath(s, nav, pts).ok) continue;
        seenK.add(k); l.paths.push({ k, s: P.s === 1 ? 1 : 0, p: P.p.slice() }); sync(s, nav);
      }
      if (Array.isArray(src.planted)) for (const t of src.planted) {
        if (!t || !Number.isInteger(t.t) || !KINDS[t.t] || !fin(t.x) || !fin(t.z) || l.planted.length >= C.PLANT) continue;
        const k = okK(t.k) ? t.k : nextK(s), it = { k, t: t.t, x: r1(t.x), z: r1(t.z), r: yaw(fin(t.r) ? t.r : 0), at: Math.round(Math.max(-1e12, Math.min(s.time || 0, fin(t.at) ? t.at : 0))) };
        if (!checkPlant(s, nav, it.t, it.x, it.z, it.r, { free: true, reach: false }).ok) continue;
        seenK.add(k); l.planted.push(it); sync(s, nav);
      }
      if (Array.isArray(src.meadows)) for (const m of src.meadows) {
        if (!m || !fin(m.x) || !fin(m.z) || !fin(m.r)) continue;
        const k = okK(m.k) ? m.k : nextK(s), it = { k, x: r1(m.x), z: r1(m.z), r: r1(Math.max(C.MR[0], Math.min(C.MR[1], m.r))), f: Number.isInteger(m.f) && m.f >= 0 && m.f < C.MKINDS ? m.f : 0 };
        if (!checkMeadow(s, nav, it.x, it.z, it.r).ok) continue;
        seenK.add(k); l.meadows.push(it);
      }
      l.n = Math.max(nextK(s), Number.isInteger(src.n) && src.n >= 0 && src.n < 1e6 ? src.n : 0);
    }
    sync(s, nav);
  }

  // ---- the public snapshot (compact: ints + short arrays; omitted when the land is untouched, so older snapshots are the
  // same bytes): {p: [[style, x10, z10, ...]], c: [pid], t: [[kind, x10, z10, yaw1000, grown %]], m: [[x10, z10, r10, f]]}
  function snap(s) {
    if (isEmpty(s)) return null; const l = s.land;
    return { p: l.paths.map(P => [P.s].concat(P.p)), c: l.cut.slice(), t: l.planted.map(t => [t.t, i10(t.x), i10(t.z), Math.round(t.r * 1000), Math.round(100 * growth(s, t))]), m: l.meadows.map(m => [i10(m.x), i10(m.z), i10(m.r), m.f]) };
  }
  // a visited island's land from its snapshot (untrusted: the same repair as a save), planted trees as grown as the host's
  function unsnap(st, a, nav) {
    if (!a || typeof a !== 'object') { st.land = empty(); sync(st, nav); return; }
    const arr = v => Array.isArray(v) ? v.filter(Array.isArray) : [];
    const o = { land: {
      cut: Array.isArray(a.c) ? a.c.slice(0, C.CUT) : [],
      paths: arr(a.p).slice(0, C.PATHS).map((P, i) => ({ k: i, s: P[0] === 1 ? 1 : 0, p: P.slice(1) })),
      planted: arr(a.t).slice(0, C.PLANT).map((t, i) => ({ k: 100 + i, t: t[0], x: t[1] / 10, z: t[2] / 10, r: t[3] / 1000, at: (st.time || 0) - C.GROW * Math.max(0, Math.min(100, +t[4] || 0)) / 100 })),
      meadows: arr(a.m).slice(0, C.MEADOWS).map((m, i) => ({ k: 200 + i, x: m[0] / 10, z: m[1] / 10, r: m[2] / 10, f: m[3] })),
    } };
    const lv = st.level; st.level = 8; sanitize(st, o, nav, true); st.level = lv;   // (the host's own land rules held when it was made)
  }

  // ---- for the renderer + effects: paths in metres, planted trees with their growth
  const paths = s => L_(s).paths.map(P => ({ k: P.k, s: P.s, pts: ptsOf(P) }));
  const trees = s => L_(s).planted.map(t => { const e = kindOf(t.t), g = growth(s, t); return { k: t.k, t: t.t, piece: e.piece, s: e.s, x: t.x, z: t.z, r: t.r, g, size: sizeOf(g) }; });

  window.Land = { C, KINDS, empty, create, isEmpty, sigOf, sync, apply, checkPath, resample, addPath, removePath, pathAt, total, lenOf, ptsOf, canCut, cut, uncut, treeAt,
    canPlant, checkPlant, plant, unplant, replant, plantedAt, growth, sizeOf, checkMeadow, addMeadow, removeMeadow, meadowAt, sanitize, snap, unsnap, paths, trees, kindOf };
})();
