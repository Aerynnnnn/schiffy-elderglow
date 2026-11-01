// Buildings (Round 3 update 2, creative build part 2, piece 4; save v13): homes in the player's colours, another roof (house
// piece) of the same class, turned in 90 deg steps, and new homes on open land. Pure (no three.js, no Math.random), loaded
// right after land.js; tools/sim_check.mjs, decor_check.mjs and path_check.mjs load it too.
//   plot entry fields (S.plots[pid], only when set): rot = quarter turns 1..3 round the placement (fixed house plots),
//     col = palette 1..PAL.length (homes; none = the kit's own colours), piece = another house piece of the same CLASS (fixed
//     plots; same beds by design, so beds / costs / work never change)
//   S.free = [{ id, x, z, r, piece }]: homes the player put on open land (only once one was placed). Plot key FREE0 + id
//     (nav.FREE0 = 900000), x / z metres (0.1), r yaw (0.001; Turn adds 90 deg). The plot entry is a normal 'home' blueprint:
//     builders build it with the usual costs; done = its beds count (Sim.bedsOf) and the "let the pups decide" arrivals fill it.
//     The pups never place one (their plot lists are nav.plots = the layout's).
// sync(s, nav) (Sim.step, right after Land.sync) hands every turned / swapped / free home to nav.setHomes: footprints, doors and
// door legs. An island with none leaves the nav exactly as it was (every older case byte-identical).
(function () {
  'use strict';
  const C = {
    MAX: 12,           // free homes per island
    ROAD: 2.4,         // m: a footprint sample keeps this far from a road line (a fixed plot's own old door path excepted)
    ROAD_FIXED: 1.5,   // m: a turned / re-roofed layout home may come this close to a road line (its kit wall at the road's edge),
                       // or as close as its layout footprint already was
    PAINT: 1.95,       // m: ... and from a painted path's middle line (strip half width + 1.2)
    REACH: 30,         // job spots whose walk passes this close are re-walked before a home goes down / turns (Decor's rule)
    TREE_LV: 3,        // treehouses: from this tree level (the layout's treehouse plots open at 3 too)
    TAKE_BACK: 0.5,    // a built free home taken down gives back this share of its cost
  };
  // 6 palettes (sRGB hex; the view converts): roof / walls / trim (wood). None = the kit's own moss + plaster look.
  const PAL = [
    { name: 'Berry', roof: '#b4506e', wall: '#f3e2d2', trim: '#7d4a3c' },
    { name: 'Sky', roof: '#4f7fc4', wall: '#eef0f3', trim: '#8a6a4e' },
    { name: 'Honey', roof: '#e0a33c', wall: '#f6e7c6', trim: '#93593a' },
    { name: 'Lilac', roof: '#8d6cc4', wall: '#efe5f3', trim: '#6c5a7c' },
    { name: 'Coral', roof: '#d9644f', wall: '#f7e3d6', trim: '#7a5236' },
    { name: 'Pine', roof: '#3e7f5c', wall: '#ebe3cf', trim: '#5b4030' },
  ];
  // house pieces by class (a roof change keeps the class = about the same footprint + the same beds, Sim.C.HOME_BEDS)
  const CLASS = { EG_House_A: 's2', EG_House_E: 's2', EG_House_G: 's2', EG_House_B: 'l2', EG_House_D: 'l2', EG_House_C: 'm3', EG_House_F: 'm3', EG_House_H: 'm3',
    EG_Treehouse_Cottage: 't4', EG_Treehouse_Totem: 't4' };
  const PIECES = Object.keys(CLASS);   // index = the snapshot's piece number
  // what the "Place a home" card offers (piece = the first look; Change roof cycles its class afterwards)
  const KINDS = [{ k: 'cottage', name: 'Cottage', piece: 'EG_House_A' }, { k: 'big', name: 'Big cottage', piece: 'EG_House_C' }, { k: 'tree', name: 'Treehouse', piece: 'EG_Treehouse_Cottage', lv: C.TREE_LV }];
  const S_ = () => window.Sim, D_ = () => window.Decor, N_ = () => window.Nav;
  const FREE0 = 900000, QT = Math.PI / 2;
  const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
  const TAU = Math.PI * 2, yaw = r => r3(((r % TAU) + TAU) % TAU);
  const fin = v => typeof v === 'number' && isFinite(v);
  const isFree = pid => +pid >= FREE0;
  const freeOf = (s, pid) => (s.free || []).find(f => FREE0 + f.id === +pid) || null;
  const baseOf = q => q.base || q;
  const canTurn = q => !!q && q.kind === 'house' && !!CLASS[baseOf(q).piece];

  // ---- the effective look of a plot: {pid, piece, x, z, ry, s, free, turn} for a turned / swapped / free home, else null
  function specOf(s, nav, pid) {
    pid = +pid;
    if (isFree(pid)) { const f = freeOf(s, pid); return f ? { pid, piece: f.piece, x: f.x, z: f.z, ry: f.r, s: 1, free: true } : null; }
    const e = s.plots[pid], q = nav.plotBy[pid]; if (!e || !canTurn(q)) return null;
    const b = baseOf(q), rot = e.rot || 0, piece = e.piece || b.piece;
    if (!rot && piece === b.piece) return null;
    return { pid, piece, x: b.pos[0], z: b.pos[2], ry: b.ry + rot * QT, s: b.s, turn: rot > 0 };
  }
  function list(s, nav) {
    const out = [];
    for (const k of Object.keys(s.plots || {}).map(Number).filter(k => !isFree(k)).sort((a, b) => a - b)) { const h = specOf(s, nav, k); if (h) out.push(h); }
    for (const f of (s.free || []).slice().sort((a, b) => a.id - b.id)) out.push(specOf(s, nav, FREE0 + f.id));
    return out;
  }
  const hsig = h => h.pid + ':' + h.piece + ',' + h.x + ',' + h.z + ',' + h.ry + ',' + (h.free ? 'f' : h.turn ? 't' : '');
  const sigList = L => L.map(hsig).join('|');
  // (colours are view-only: not in the nav signature)
  const sigOf = s => { let o = ''; for (const k in s.plots || {}) { const e = s.plots[k]; if (e.rot || e.col || e.piece) o += k + ':' + (e.rot || 0) + (e.col || 0) + (e.piece || '') + ','; } return o + '#' + (s.free || []).map(f => f.id + ',' + f.x + ',' + f.z + ',' + f.r + ',' + f.piece).join('|'); };
  function sync(s, nav) {
    if (!nav || !nav.setHomes) return;
    const L = list(s, nav); nav.setHomes(L, L.length ? sigList(L) : '');
  }
  // every change goes through apply(): walking pups re-walk from where they are, a resting pup under a home gets up (Decor's way)
  function apply(s, nav, fn) {
    const Sim = S_(); D_().sync(s, nav); if (window.Land) window.Land.sync(s, nav); sync(s, nav);
    const at = s.pups.map(p => {
      if (!p.leg || !Sim.WALK[p.phase]) return null;
      const Lg = nav.leg(p.leg.a, p.leg.b, p.leg.R), q = nav.at(Lg, p.t * Sim.C.SPEED);
      return { p: q.p.map(v => Math.round(v * 1000) / 1000), n: nav.nodeNear(Lg, q.seg, p.leg.a.n) };
    });
    fn(); sync(s, nav);
    const under = p => nav.homeBoxes().some(b => nav.inBox(b, p[0], p[2]));
    s.pups.forEach((p, i) => {
      if (at[i]) { const b = p.leg.b; p.at = at[i]; Sim._.startWalk(s, p, nav, b, p.phase); }
      else if (!p.exp && (p.phase === 'rest' || p.phase === 'nap' || p.phase === 'idle') && p.at && under(p.at.p)) { p.phase = 'idle'; p.t = 0; p.dur = 0; if (p.task === 'nap') p.task = null; }
    });
  }
  // canonical key order of a plot entry (save round trips byte-identical whatever order things happened in)
  function norm(e) {
    const v = [e.rot, e.col, e.piece]; delete e.rot; delete e.col; delete e.piece;
    if (v[0]) e.rot = v[0]; if (v[1]) e.col = v[1]; if (v[2]) e.piece = v[2]; return e;
  }

  // ---- may this home stand here? h = {pid, piece, x, z, ry, s, free}. -> {ok, why}. why: far, full, level, tree, plaza,
  // door (the Elder Tree's door path, or this home's own door / stand point), bridge, path, water, building, nature, decor, job,
  // road (no road / painted path within nav.DOOR_R m of its door), blocked (its door leg, or a job spot it would cut off).
  // opt.reach === false = the cheap rules + the door's own spot only (every pointer move; the leg + walk test on still / confirm)
  function check(s, nav, h, opt) {
    opt = opt || {}; const Nav = N_(), Dc = D_(), TP = nav.TP;
    Dc.sync(s, nav); if (window.Land) window.Land.sync(s, nav); sync(s, nav);
    const f = Nav.FOOT[h.piece], sc = h.s || 1; if (!f || !CLASS[h.piece]) return { ok: false, why: 'none' };
    if (!fin(h.x) || !fin(h.z) || !fin(h.ry)) return { ok: false, why: 'far' };
    const old = nav.plotBy[h.pid], fixed = !h.free;
    if (h.free) {
      if ((s.free || []).filter(o => FREE0 + o.id !== h.pid).length >= C.MAX) return { ok: false, why: 'full' };
      const kd = KINDS.find(k => CLASS[k.piece] === CLASS[h.piece]); if (kd && kd.lv && s.level < kd.lv) return { ok: false, why: 'level' };
      const lv = Math.max(1, Math.min(Dc.C.LAND.length - 1, s.level || 1)), dT = Math.hypot(h.x - TP[0], h.z - TP[2]);
      if (dT > Dc.C.LAND[lv]) return { ok: false, why: 'far' };
      let nn = Infinity; for (const n of nav.nodes) if (!n.bridge) nn = Math.min(nn, Math.hypot(n.p[0] - h.x, n.p[2] - h.z)); if (nn > Dc.C.NODE) return { ok: false, why: 'far' };
    }
    const box = nav.boxOf(h.x, h.z, h.ry, f, sc, 'cand', -1), rad = Math.hypot(box.hx - Nav.PUP_R, box.hz - Nav.PUP_R);
    if (h.free && Math.hypot(box.x - TP[0], box.z - TP[2]) < nav.trunkR(1) + rad) return { ok: false, why: 'tree' };
    const own = new Set(nav.homeBoxes().filter(b => b.id === h.pid).map(b => b.k)); for (const b of nav.blk) if (b.id === h.pid) own.add(b.k);
    // a fixed plot already stands where the layout put it (often a metre from a road, beside a tree): only what the TURNED /
    // swapped footprint adds counts (its layout footprint's own touches are allowed, the road at least as far as it was)
    const allow = fixed && old ? baseline(s, nav, old, own) : null;
    let bad = null;
    footScan(s, nav, box, own, allow ? baseOf(old).n : undefined, h.pid, (why, key, d) => {
      if (key[0] === 'u') { /* never: see footScan */ }
      else if (key[0] === 'n') { if (allow && allow.nd[key] !== undefined && d <= allow.nd[key] + 0.3) return false; }   // a road node only as deep inside as the layout's footprint had it (a door node at its wall)
      else if (allow && (allow.keys.has(key) || (why === 'path' && key === 'road' && d >= Math.min(allow.road - 0.05, C.ROAD_FIXED)))) return false;
      bad = why; return true;
    });
    if (bad) return { ok: false, why: bad };
    // its door: dry + free, a road within reach (cheap: straight distance; the full test walks the door leg)
    const y = h.free ? nav.yNear(h.x, h.z) : baseOf(old).pos[1], g = nav.homeGeo(h.piece, h.x, y, h.z, h.ry, sc), st = [g.door[0] + g.out[0] * 3, g.door[1], g.door[2] + g.out[1] * 3];
    if (nav.wet(st[0], st[2]) || nav.wet(g.door[0], g.door[2]) || nav.onDeck(st[0], st[2]) || nav.blocksAt(st[0], st[2]).some(b => !own.has(b.k))) return { ok: false, why: 'door' };
    // its builders' spots (nav.site: 3 m out, side by side) keep Decor's job margin from the player's other homes, the same rule
    // those homes' own spots get from this one (protOf): a save re-check never finds two homes in each other's way
    { const o = g.out, others = nav.homeBoxes().filter(b => !own.has(b.k));
      for (let k = 0; k < 7 && others.length; k++) {
        const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.4, out = 3 + (k > 4 ? 2.5 : 0), px = g.door[0] + o[0] * out - o[1] * side, pz = g.door[2] + o[1] * out + o[0] * side;
        for (const b of others) { const dx = px - b.x, dz = pz - b.z; if (Math.abs(dx * b.c - dz * b.sn) <= b.hx - Nav.PUP_R + Dc.C.JOB && Math.abs(dx * b.sn + dz * b.c) <= b.hz - Nav.PUP_R + Dc.C.JOB) return { ok: false, why: 'door' }; }
      } }
    if (opt.reach === false) {
      if (nav.roadDist(g.door[0], g.door[2], nav.DOOR_R) >= nav.DOOR_R && !(nav.landSig && nav.landSig() && nav.paintDist(g.door[0], g.door[2], nav.DOOR_R) < nav.DOOR_R)) return { ok: false, why: 'road' };
      return { ok: true };
    }
    // the full test: this home in the nav (probe), its door leg, and every job spot near it still walkable
    const base = list(s, nav).filter(x => x.pid !== h.pid), probe = base.concat([Object.assign({}, h, { s: sc, turn: fixed ? (h.turn !== undefined ? h.turn : true) : false })]);
    let why = null;
    try {
      nav.setHomes(probe, 'probe');
      const q = nav.plotBy[h.pid];
      if (!q || !q.link || !q.link.ok) why = q && q.link ? q.link.why : 'blocked';
      if (!why) {
        const cut = [];
        for (const o of Dc.protOf(nav)) {
          if (o.n < 0 || o.pid === h.pid) continue;
          const a = o.p, b = nav.nodes[o.n].p, dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((box.x - a[0]) * dx + (box.z - a[2]) * dz) / l2)) : 0;
          if (Math.hypot(box.x - a[0] - dx * t, box.z - a[2] - dz * t) > C.REACH + rad) continue;
          if (!nav.reachOk(a, b)) cut.push([a, b]);
        }
        if (cut.length) { nav.setHomes(base, 'probe0'); if (cut.some(([a, b]) => nav.reachOk(a, b))) why = 'blocked'; }
      }
    } finally { sync(s, nav); }
    return why ? { ok: false, why } : { ok: true };
  }
  // every rule a footprint box can break, sample by sample (0.9 m grid incl. the edges): emit(why, key, d) -> true = stop.
  // keys name WHAT was touched (a blocker box, a water cell, a job spot), so a fixed plot's own layout touches can be allowed
  function footScan(s, nav, box, own, exN, pid, emit) {
    const Nav = N_(), TP = nav.TP, hx = box.hx - Nav.PUP_R, hz = box.hz - Nav.PUP_R, rad = Math.hypot(hx, hz);
    const D = nav.door(1).p, dl = Math.hypot(D[0] - TP[0], D[2] - TP[2]) || 1, ux = (D[0] - TP[0]) / dl, uz = (D[2] - TP[2]) / dl;
    const nx = Math.max(2, Math.ceil(2 * hx / 0.9)), nz = Math.max(2, Math.ceil(2 * hz / 0.9)), paint = nav.landSig && nav.landSig() && nav.paintDist;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const lx = -hx + 2 * hx * i / nx, lz = -hz + 2 * hz * j / nz, px = box.x + lx * box.c + lz * box.sn, pz = box.z - lx * box.sn + lz * box.c;
      const u = (px - TP[0]) * ux + (pz - TP[2]) * uz, v = -(px - TP[0]) * uz + (pz - TP[2]) * ux;
      if (u > 8 && u < 80 && Math.abs(v) < 34 && emit('plaza', 'plaza')) return;   // the nap grid in front of the door
      if (u > 0 && u < 95 && Math.abs(v) < 3.2 && emit('door', 'tdoor')) return;   // the Elder Tree's door path
      if (nav.onDeck(px, pz) && emit('bridge', 'bridge')) return;
      const rd = nav.roadNear(px, pz, C.ROAD, exN).d; if (rd < C.ROAD && emit('path', 'road', rd)) return;
      if (paint && nav.paintDist(px, pz, C.PAINT + 0.1) < C.PAINT && emit('path', 'paint')) return;
      for (const b of nav.blocksAt(px, pz)) {
        if (own.has(b.k)) continue;
        if (b.role === 'forest' && !N_().keepForest(b.id) && Math.hypot(b.x - TP[0], b.z - TP[2]) < D_().C.THIN_R) continue;   // a hidden tree that never grows back
        const why = b.id === 'decor' ? 'decor' : b.role === 'house' || b.role === 'faction' || b.role === 'market' ? 'building' : 'nature';
        if (emit(why, 'b' + b.k)) return;
      }
    }
    { const wc = nav.wcell || 1, gx = hx + wc * 0.71, gz = hz + wc * 0.71, R = Math.hypot(gx, gz);
      for (let i = Math.floor((box.x - R) / wc); i <= Math.floor((box.x + R) / wc); i++) for (let j = Math.floor((box.z - R) / wc); j <= Math.floor((box.z + R) / wc); j++) {
        const cx = (i + 0.5) * wc, cz = (j + 0.5) * wc; if (!nav.cellWet(cx, cz)) continue;
        const dx = cx - box.x, dz = cz - box.z; if (Math.abs(dx * box.c - dz * box.sn) <= gx && Math.abs(dx * box.sn + dz * box.c) <= gz && emit('water', 'w' + i + ',' + j)) return;
      } }
    // no road node under it (other walks start + end there; d = how deep inside the box it is): a turned home's own old door
    // node is free only when no job spot hangs off it
    const P = D_().protOf(nav);
    for (let i = 0; i < nav.N0; i++) {
      const n = nav.nodes[i].p; if (Math.abs(n[0] - box.x) > box.r + 1 || Math.abs(n[2] - box.z) > box.r + 1 || !nav.inBox(box, n[0], n[2])) continue;
      if (i === exN && !P.some(o => o.n === i && o.pid !== pid)) continue;
      const dx = n[0] - box.x, dz = n[2] - box.z, depth = Math.min(box.hx - Math.abs(dx * box.c - dz * box.sn), box.hz - Math.abs(dx * box.sn + dz * box.c));
      // (a node a job spot hangs off: never under a turned / swapped / free home, the walks to that spot would cross it)
      if (P.some(o => o.n === i && o.pid !== pid) ? emit('job', 'u' + i) : emit('path', 'n' + i, depth)) return;
    }
    for (const q of P) {
      if (q.pid === pid) continue;   // (its own door + builder spots move with it)
      if (Math.abs(q.p[0] - box.x) > rad + q.m + 1 || Math.abs(q.p[2] - box.z) > rad + q.m + 1) continue;
      const dx = q.p[0] - box.x, dz = q.p[2] - box.z, lx = dx * box.c - dz * box.sn, lz = dx * box.sn + dz * box.c;
      if (Math.abs(lx) <= hx + q.m && Math.abs(lz) <= hz + q.m && emit(q.why, 'p' + q.p[0] + ',' + q.p[2])) return;
    }
  }
  // what a fixed plot's layout footprint (its own piece, unturned) already touches: {keys, road (m to the nearest road line)}
  function baseline(s, nav, q, own) {
    const b = baseOf(q), f = N_().FOOT[b.piece], keys = new Set(), nd = {}; let road = C.ROAD; if (!f) return { keys, road, nd };
    footScan(s, nav, nav.boxOf(b.pos[0], b.pos[2], b.ry, f, b.s, 'base', -1), own, b.n, q.pid, (why, key, d) => { if (key === 'road') road = Math.min(road, d); else if (key[0] === 'n') nd[key] = d; else keys.add(key); return false; });
    return { keys, road, nd };
  }

  // ---- free homes
  const nextId = s => { let k = 0; for (const f of s.free || []) k = Math.max(k, f.id); return k + 1; };
  const kindOk = (s, piece) => { const kd = KINDS.find(k => CLASS[k.piece] === CLASS[piece]); return !kd || !kd.lv || s.level >= kd.lv; };
  // put a new home (blueprint) down at (x, z, yaw r) -> its plot key, or -1 (res.why)
  function place(s, nav, piece, x, z, r, res) {
    res = res || {};
    if (!CLASS[piece]) { res.why = 'none'; return -1; }
    x = r1(x); z = r1(z); r = yaw(r || 0);
    const id = nextId(s), pid = FREE0 + id, c = check(s, nav, { pid, piece, x, z, ry: r, s: 1, free: true }); res.why = c.why; if (!c.ok) return -1;
    let okd = false;
    apply(s, nav, () => { if (!s.free) s.free = []; s.free.push({ id, x, z, r, piece }); sync(s, nav); okd = S_().order(s, pid, 'home', nav, false); if (!okd) s.free.pop(); });
    if (!okd) { res.why = 'none'; return -1; }
    return pid;
  }
  function move(s, nav, pid, x, z, r, res) {
    res = res || {}; const f = freeOf(s, pid); if (!f) { res.why = 'none'; return false; }
    x = r1(x); z = r1(z); r = yaw(r);
    const c = check(s, nav, { pid: +pid, piece: f.piece, x, z, ry: r, s: 1, free: true }); res.why = c.why; if (!c.ok) return false;
    apply(s, nav, () => { f.x = x; f.z = z; f.r = r; }); return true;
  }
  // a home's beds would leave the island short: a built home with pups living in it (beds after < pups) stays
  function canTakeDown(s, nav, pid) {
    sync(s, nav);   // (one nav may serve two islands: this one's homes first)
    const e = s.plots[pid], q = nav.plotBy[pid]; if (!isFree(pid) || !e || !q) return { ok: false, why: 'none' };
    if (!e.done) return { ok: true };
    if (S_().bedsOf(s, nav) - S_().bedsFor(q) < s.pups.length) return { ok: false, why: 'beds' };
    return { ok: true };
  }
  // pack a free home away: a blueprint = Sim.cancel (paid = full refund); a built one only when nobody needs its beds (half back)
  function takeDown(s, nav, pid, res) {
    res = res || {}; const c = canTakeDown(s, nav, pid); res.why = c.why; if (!c.ok) return false;
    const e = s.plots[pid];
    if (!e.done) return S_().cancel(s, pid, nav);
    const cost = S_().costOf('home', nav.plotBy[pid]);
    apply(s, nav, () => {
      for (const k in cost) { const v = Math.floor(cost[k] * C.TAKE_BACK); if (k === 'sap') s.sap += v; else s.res[k] += v; }
      delete s.plots[pid]; s.queue = s.queue.filter(x => x !== +pid); s.free = s.free.filter(f => FREE0 + f.id !== +pid);
    });
    return true;
  }
  // Sim.cancel hook: a cancelled free blueprint leaves the island with its plot
  function gone(s, pid, nav) { if (!isFree(pid) || !freeOf(s, pid)) return; apply(s, nav, () => { s.free = s.free.filter(f => FREE0 + f.id !== +pid); }); }

  // ---- variants on any home (built or a blueprint)
  // turn by 90 deg (the next quarter that passes; the refusal of the first one is the reason when none does)
  function turn(s, nav, pid, res) {
    res = res || {}; pid = +pid; sync(s, nav); const e = s.plots[pid]; if (!e) { res.why = 'none'; return false; }
    if (isFree(pid)) {
      const f = freeOf(s, pid); let first = null;
      for (let k = 1; k < 4; k++) { const r = yaw(f.r + k * QT), c = check(s, nav, { pid, piece: f.piece, x: f.x, z: f.z, ry: r, s: 1, free: true }); if (c.ok) { apply(s, nav, () => { f.r = r; }); res.why = first; res.k = k; return true; } if (!first) first = c.why; }
      res.why = first; return false;
    }
    const q = nav.plotBy[pid]; if (!canTurn(q)) { res.why = 'none'; return false; }
    const b = baseOf(q), piece = e.piece || b.piece; let first = null;
    for (let k = 1; k < 4; k++) {
      const rot = ((e.rot || 0) + k) % 4;
      const c = rot === 0 && piece === b.piece ? { ok: true } : check(s, nav, { pid, piece, x: b.pos[0], z: b.pos[2], ry: b.ry + rot * QT, s: b.s, turn: rot > 0 });
      if (c.ok) { apply(s, nav, () => { e.rot = rot; norm(e); }); res.why = first; res.k = k; return true; }
      if (!first) first = c.why;
    }
    res.why = first; return false;
  }
  // the next house piece of the same class that fits here (a roof change); -> the new piece or null (res.why)
  function swap(s, nav, pid, res) {
    res = res || {}; pid = +pid; sync(s, nav); const e = s.plots[pid]; if (!e || e.type !== 'home') { res.why = 'none'; return null; }
    const free = isFree(pid), f = free ? freeOf(s, pid) : null, q = nav.plotBy[pid]; if (!q || (!free && !canTurn(q))) { res.why = 'none'; return null; }
    const b = baseOf(q), cur = free ? f.piece : (e.piece || b.piece), cls = CLASS[cur], L = PIECES.filter(p => CLASS[p] === cls);
    let first = null;
    for (let k = 1; k < L.length; k++) {
      const piece = L[(L.indexOf(cur) + k) % L.length];
      if (S_().C.HOME_BEDS[piece] !== S_().C.HOME_BEDS[cur]) continue;   // (the classes keep beds equal; this keeps it a rule)
      const h = free ? { pid, piece, x: f.x, z: f.z, ry: f.r, s: 1, free: true } : { pid, piece, x: b.pos[0], z: b.pos[2], ry: b.ry + (e.rot || 0) * QT, s: b.s, turn: (e.rot || 0) > 0 };
      const c = !free && !e.rot && piece === b.piece ? { ok: true } : check(s, nav, h);
      if (c.ok) { apply(s, nav, () => { if (free) f.piece = piece; else { e.piece = piece === b.piece ? undefined : piece; norm(e); } }); res.why = first; return piece; }
      if (!first) first = c.why;
    }
    res.why = first || 'none'; return null;
  }
  // palette 1..PAL.length (0 = the kit's own colours); homes only. View-only: no nav, no sim number reads it.
  function paint(s, pid, col) {
    const e = s.plots[pid]; if (!e || e.type !== 'home') return false;
    col = Math.round(col); if (!(col >= 0 && col <= PAL.length)) return false;
    e.col = col || undefined; norm(e); return true;
  }
  const pieceOf = (s, nav, pid) => { const f = isFree(pid) ? freeOf(s, pid) : null; if (f) return f.piece; const e = s.plots[pid], q = nav.plotBy[pid]; return (e && e.piece) || (q && baseOf(q).piece) || null; };
  const choices = (s, nav, pid) => { const p = pieceOf(s, nav, pid); return p && CLASS[p] ? PIECES.filter(x => CLASS[x] === CLASS[p]) : []; };

  // ---- save (Sim.sanitize): pre = S.free before the plots (their keys must resolve); entry = one plot's fields; post = after
  // decor + land (before the pups): anything that fails the cheap rules today is dropped (free) / reset (fixed), then sync
  function pre(s, o, nav) {
    delete s.free;
    if (Array.isArray(o && o.free)) {
      s.free = []; const seen = new Set();
      for (const f of o.free) {
        if (!f || typeof f !== 'object' || !Number.isInteger(f.id) || f.id < 1 || f.id > 99999 || seen.has(f.id) || !CLASS[f.piece] || !fin(f.x) || !fin(f.z) || Math.abs(f.x) > 5000 || Math.abs(f.z) > 5000 || s.free.length >= C.MAX) continue;
        const e = o.plots && o.plots[FREE0 + f.id]; if (!e || typeof e !== 'object' || e.type !== 'home') continue;
        seen.add(f.id); s.free.push({ id: f.id, x: r1(f.x), z: r1(f.z), r: yaw(fin(f.r) ? f.r : 0), piece: f.piece });
      }
      s.free.sort((a, b) => a.id - b.id);
    }
    sync(s, nav);
  }
  function entry(d, e, q, pid) {
    if (!e || typeof e !== 'object') return d;
    if (!isFree(pid) && canTurn(q) && Number.isInteger(e.rot) && e.rot >= 1 && e.rot <= 3) d.rot = e.rot;
    if (d.type === 'home' && Number.isInteger(e.col) && e.col >= 1 && e.col <= PAL.length) d.col = e.col;
    if (!isFree(pid) && d.type === 'home' && canTurn(q) && typeof e.piece === 'string' && CLASS[e.piece] === CLASS[baseOf(q).piece] && e.piece !== baseOf(q).piece && S_().C.HOME_BEDS[e.piece] === S_().C.HOME_BEDS[baseOf(q).piece]) d.piece = e.piece;
    return norm(d);
  }
  function post(s, nav) {
    if (s.free) s.free = s.free.filter(f => s.plots[FREE0 + f.id] && s.plots[FREE0 + f.id].type === 'home');
    for (const k of Object.keys(s.plots).map(Number).sort((a, b) => a - b)) if (isFree(k) && !freeOf(s, k)) { delete s.plots[k]; s.queue = s.queue.filter(x => x !== k); }
    sync(s, nav);
    // re-check each changed home with the cheap rules (+ its door leg); one that fails today: fixed = back to the layout's turn / roof;
    // free = dropped ONLY on hard map facts (junk: off the land, wet, on a bridge, in the trunk). A free home that fails a softer rule
    // (path, decor, job spot, door leg) passed them when placed and is KEPT: a later rule or map tweak must never delete a home + its beds
    const HARD = { none: 1, far: 1, water: 1, bridge: 1, tree: 1 };
    // check() stops at the FIRST failed rule: a soft one (a road beside it) can hide a hard one (the river under it), so a soft
    // failure re-scans the footprint for water / a bridge deck only
    const hardScan = h => { const box = nav.boxOf(h.x, h.z, h.ry, N_().FOOT[h.piece], 1, 'cand', -1), own = new Set(nav.homeBoxes().filter(b => b.id === h.pid).map(b => b.k));
      let w = null; footScan(s, nav, box, own, undefined, h.pid, why => (why === 'water' || why === 'bridge') ? (w = why, true) : false); return w; };
    for (const h of list(s, nav)) {
      const c = check(s, nav, h, { reach: false }), q = nav.plotBy[h.pid], lk = q && q.link;
      if (c.ok && (!lk || lk.ok)) continue;
      if (h.free) { if (!HARD[c.why] && !hardScan(h)) continue; s.free = s.free.filter(f => FREE0 + f.id !== h.pid); delete s.plots[h.pid]; s.queue = s.queue.filter(x => x !== h.pid); }
      else { const e = s.plots[h.pid]; delete e.rot; delete e.piece; norm(e); }
      sync(s, nav);
    }
  }

  // ---- public snapshot: hm = { f: [[id, x10, z10, r1000, piece #]], v: [[pid, rot, col, piece # or -1]] } (only when used: an
  // older island's snapshot = the same bytes). An older game ignores hm and skips the free plot rows (no plotBy entry).
  function snap(s) {
    const f = (s.free || []).map(x => [x.id, Math.round(x.x * 10), Math.round(x.z * 10), Math.round(x.r * 1000), PIECES.indexOf(x.piece)]);
    const v = []; for (const k of Object.keys(s.plots).map(Number).sort((a, b) => a - b)) { const e = s.plots[k]; if (e.rot || e.col || e.piece) v.push([k, e.rot || 0, e.col || 0, e.piece ? PIECES.indexOf(e.piece) : -1]); }
    return f.length || v.length ? { f, v } : null;
  }
  // visits: st = Social.visitState's island (its plots loop dropped the free rows: no plotBy entry yet)
  function unsnap(st, hm, rows, nav) {
    if (!hm || typeof hm !== 'object') { sync(st, nav); return; }
    const f = Array.isArray(hm.f) ? hm.f : [], v = Array.isArray(hm.v) ? hm.v : [], Sim = S_();
    const free = [], plots = {};
    for (const a of f.slice(0, C.MAX)) if (Array.isArray(a) && Number.isInteger(a[0]) && a[0] >= 1 && a[0] <= 99999 && PIECES[a[4]] && fin(a[1]) && fin(a[2])) free.push({ id: a[0], x: r1(a[1] / 10), z: r1(a[2] / 10), r: yaw(fin(a[3]) ? a[3] / 1000 : 0), piece: PIECES[a[4]] });
    for (const a of Array.isArray(rows) ? rows.slice(0, 200) : []) if (Array.isArray(a) && isFree(a[0]) && a[1] === 'home') plots[a[0]] = a;
    const o = { free: free.filter(x => plots[FREE0 + x.id]), plots: {} };
    for (const x of o.free) o.plots[FREE0 + x.id] = { type: 'home' };
    pre(st, o, nav);
    for (const x of st.free || []) { const pid = FREE0 + x.id, a = plots[pid], q = nav.plotBy[pid]; if (!q) continue; const w = Sim.workOf('home', q); st.plots[pid] = { type: 'home', done: a[2] === 1, paid: true, prog: a[2] === 1 ? w : w * Math.max(0, Math.min(99, fin(a[3]) ? a[3] : 0)) / 100 }; }
    for (const a of v.slice(0, 200)) {
      if (!Array.isArray(a)) continue; const pid = +a[0], e = st.plots[pid], q = nav.plotBy[pid]; if (!e || !q) continue;
      entry(e, { rot: a[1], col: a[2], piece: PIECES[a[3]] }, q, pid);
    }
    post(st, nav);
  }

  window.Homes = { C, PAL, CLASS, PIECES, KINDS, FREE0, nextId, isFree, freeOf, specOf, list, sigOf, sync, apply, norm, check, place, move, canTakeDown, takeDown, gone,
    turn, swap, paint, pieceOf, choices, canTurn, kindOk, pre, entry, post, snap, unsnap, _: { footScan, baseline } };
})();
