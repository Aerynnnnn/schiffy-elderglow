// Nav: the layout's road graph as walkable legs. Pure JS (no three.js), deterministic: the sim uses leg LENGTHS, the
// renderer walks the same polylines. A leg = from a location {p:[x,y,z], n: road node} to another: p -> (A* over the
// road graph from node to node) -> p, with off-graph segments bent around the tree trunk (circle of radius trunkR).
(function () {
  'use strict';
  // the start island keeps ~45 % of the forest (same hash in game.js startIsland and in the wood spots)
  function keepForest(n) { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) % 100 < 45; }
  // water mask (data/water_cells.json, made from the terrain's water parts): ok(x, z) = no water cell within 2 cells
  // (~6-9 m). Pure data, so every spot list below is identical in the game and in tools/sim_check.mjs.
  function waterTest(W) {
    if (!W || !Array.isArray(W.runs)) return null;
    const C = W.cell || 3, cells = new Set();
    for (const [i, j0, j1] of W.runs) for (let j = j0; j <= j1; j++) cells.add(i * 100003 + j);
    return (x, z) => { const i = Math.floor(x / C), j = Math.floor(z / C); for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (cells.has((i + di) * 100003 + j + dj)) return false; return true; };
  }
  // ground footprints of the kit pieces pups must walk round: [centre x, centre z, half x, half z] in piece space (life size,
  // vertices below 2 m; measured from the kit GLBs 2026-11-01). Trees = trunk (+ low spruce boughs), houses = walls / stilts.
  const FOOT = {
    EG_HushHall: [-0.32, -2.07, 18.85, 20.57], EG_SproutHouse: [1.14, -1.6, 23.48, 20.69], EG_Greenhold: [0.02, 0.8, 17.41, 13.26], EG_Circus: [0, -6, 49.92, 54.08],
    EG_GaleForge: [-4.27, -3.31, 9.9, 12.33], EG_House_A: [0.58, 0.04, 4.43, 4.58], EG_House_B: [-1.66, 0.92, 6.2, 4.9], EG_House_C: [0.71, 2, 4.34, 5.72],
    EG_House_D: [-0.46, -0.34, 6.03, 6.06], EG_House_E: [0, 0.46, 3.9, 3.37], EG_House_F: [0.88, 2.21, 4.18, 5.01], EG_House_G: [-0.12, -0.11, 4.7, 4.62],
    EG_House_H: [-0.52, 2.92, 3.47, 7.33], EG_Treehouse_Totem: [0.37, 0.1, 8.26, 8.66], EG_Treehouse_Cottage: [0.38, -1.13, 11.43, 10.8], EG_SpiritTree: [0.52, 0.12, 4.42, 3.94],
    EG_MarketStall_A: [0, 0.12, 1.5, 0.75], EG_MarketStall_B: [0, 0, 2.08, 2.08], EG_Pond_A: [0, -0.07, 2.71, 2.76], EG_Pond_B: [0.07, -0.03, 4.57, 3.07], EG_Pond_C: [0.03, -0.03, 1.79, 1.6],
    EG_RuneCliff_A: [0, -21, 32, 21.38], EG_RuneCliff_B: [0, -20.99, 44, 21.53], EG_Mountain_A: [-0.01, -0.03, 79.99, 70], EG_Mountain_B: [0, 0.05, 100.03, 60.01],
    EG_Spruce_A: [0.05, 0.13, 1.6, 1.6], EG_Spruce_B: [0.05, -0.04, 1.6, 1.6], EG_Oak_A: [0.01, 0, 0.73, 0.79], EG_Oak_B: [0.03, -0.21, 1.07, 0.89], EG_Oak_C: [0.09, 0.02, 0.66, 0.55],
    EG_Bush_A: [0.09, 0.1, 0.97, 1.09], EG_Bush_B: [-0.09, -0.07, 1.42, 1.4], EG_WispTree_A: [-0.02, -0.28, 1.63, 1.73], EG_WispTree_B: [-0.11, -0.01, 1.54, 1.71],
    EG_RuneBoulder_A: [-0.05, -0.12, 1.31, 0.9], EG_RuneBoulder_B: [-0.01, 0, 0.94, 0.8], EG_FallenLog_A: [0.27, 0, 4.06, 1.5], EG_FallenLog_B: [0, -0.26, 1.75, 0.71],
    EG_CrystalPillar: [0.19, 0.21, 2.38, 2.45], EG_LightOrb: [-0.02, -0.08, 1.2, 1.2],
    // map cleanup (2026-11-01): the library's cozy sets (kit_elderglow_cozy, placed at 2x); stepping stones are walked on, so none
    EG_Bench: [0.02, -0.11, 0.98, 0.39], EG_BerryCart: [-0.18, 0.2, 1.69, 0.95], EG_Fence: [0, 0.07, 1.59, 0.15], EG_FlowerBed: [0.19, -0.02, 1.44, 1.27],
    EG_LanternPost: [0.27, 0.02, 0.54, 0.28], EG_Picnic: [0, 0, 0.9, 0.9], EG_Signpost: [0.03, 0.17, 0.68, 0.57], EG_WoodPile: [0.39, 0.3, 1.74, 0.96],
  };
  const PUP_R = 0.9;   // half a drawn pup's width (pups are drawn ~3x life size): footprints grow by this much
  const SLACK = 6;     // m a walk may still be over water next to an end point that lies in the water mask (bank / shore nodes)
  function Nav(L, opts) {
    const dry = waterTest(opts && opts.water);
    const N = L.roads.nodes.map(a => ({ p: [a[0], a[1], a[2]], bridge: !!(a[3] && a[3].bridge), door: a[3] && a[3].door }));
    const tree = L.placements.find(p => p.role === 'tree') || { pos: [0, 7, 0], doors: [[0, 7, 21.6, 270]], nodes: [0] };
    const TP = tree.pos, D0 = tree.doors[0];
    const doorOff = [D0[0] - TP[0], D0[2] - TP[2]], doorDist = Math.hypot(doorOff[0], doorOff[1]);
    const doorNode = (tree.nodes && tree.nodes[0]) || 0;
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    const r3 = v => v.map(x => Math.round(x * 1000) / 1000);

    // ---- where a pup may stand (pathing pass 2026-11-01). Pure data (layout + data/water_cells.json), so every leg is the
    // same in the game and in tools/sim_check.mjs. Water: a cell of the mask is closed unless a bridge deck (+ 2 m landing
    // at each end) covers the point. Blockers: footprints of houses / halls / stalls / trees / bushes / boulders / logs /
    // pillars / ponds / cliffs (FOOT, grown by PUP_R), in a 12 m hash. A footprint that holds a walk's own start or end
    // (a door, a gather spot beside its tree, a decor spot where a thinned tree stood) does not block that walk.
    // (data/water_cells.json `fine` = 1 m cells whose centre is inside a water triangle; the old 3 m `runs` had a slack that
    // made every bank water. Without `fine` (old data) the 3 m cells are used.)
    const WM = opts && opts.water ? (opts.water.fine || opts.water) : null, WC = (WM && WM.cell) || 3, wcells = new Set(), G = 2;
    if (WM && Array.isArray(WM.runs)) for (const [i, j0, j1] of WM.runs) for (let j = j0; j <= j1; j++) wcells.add(i * 100003 + j);
    const cellWet = (x, z) => wcells.has(Math.floor(x / WC) * 100003 + Math.floor(z / WC));
    const decks = L.placements.filter(p => p.role === 'bridge').map(p => {
      const log = /Log/.test(p.piece), s = p.s || 1, c = Math.cos(p.ry || 0), sn = Math.sin(p.ry || 0);
      // deck along the piece's local X (three.js: rotation.y = ry turns +X to (cos, -sin)); the log bridge's plank ramp
      // leaves sideways at its root end, so its box is the measured footprint
      const f = log ? [1.09, 0.99, 8.36, 2.92] : [0, 0, 8.05, 1.65];
      return { x: p.pos[0] + (f[0] * c + f[1] * sn) * s, z: p.pos[2] + (-f[0] * sn + f[1] * c) * s, ux: c, uz: -sn, h: f[2] * s + 2, w: Math.max(f[3] * s, 2.2), y: p.pos[1], id: p.id, px: p.pos[0], pz: p.pos[2], s, log };
    });
    const onDeck = (x, z) => { for (const d of decks) { const dx = x - d.x, dz = z - d.z, a = dx * d.ux + dz * d.uz, b = -dx * d.uz + dz * d.ux; if (Math.abs(a) <= d.h && Math.abs(b) <= d.w) return d; } return null; };
    // the walking surface of the deck under (x, z) (kit profile: the arch deck = 0.25 + 2.2 sin over its 16 m, the log's
    // flat top 1.2 m; x scale), or null: Schiffy + the pups' fallback when the map's deck mesh is not drawn this frame
    function deckY(x, z) {
      const d = onDeck(x, z); if (!d) return null;
      const a = ((x - d.px) * d.ux + (z - d.pz) * d.uz) / d.s;
      return d.y + d.s * (d.log ? (Math.abs(a) < 6.5 ? 1.2 : Math.max(0, 1.2 * (1 - (Math.abs(a) - 6.5) / 3.4))) : 0.25 + 2.2 * Math.sin(Math.PI * (Math.max(-8, Math.min(8, a)) + 8) / 16));
    }
    const wet = (x, z) => cellWet(x, z) && !onDeck(x, z);
    const blk = [], BH = new Map(), BC = 12;
    // a footprint box f = [centre x, centre z, half x, half z] (piece space) at scale s, yaw ry, grown by PUP_R
    function boxOf(x0, z0, ry, f, s, id, k) {
      const c = Math.cos(ry || 0), sn = Math.sin(ry || 0);
      const b = { x: x0 + (f[0] * c + f[1] * sn) * s, z: z0 + (-f[0] * sn + f[1] * c) * s, c, sn, hx: f[2] * s + PUP_R, hz: f[3] * s + PUP_R, id, k };
      b.r = Math.hypot(b.hx, b.hz); return b;
    }
    const cellsOf = (b, fn) => { for (let i = Math.floor((b.x - b.r) / BC); i <= Math.floor((b.x + b.r) / BC); i++) for (let j = Math.floor((b.z - b.r) / BC); j <= Math.floor((b.z + b.r) / BC); j++) fn(i * 100003 + j); };
    const hashIn = b => cellsOf(b, k => { let a = BH.get(k); if (!a) BH.set(k, a = []); a.push(b); });
    for (const p of L.placements) {
      const f = FOOT[p.piece]; if (!f) continue;
      const b = boxOf(p.pos[0], p.pos[2], p.ry, f, p.s || 1, p.id, blk.length); b.role = p.role; blk.push(b); hashIn(b);
    }
    // the blocker under (x, z), skipping the ones in `ex` (a Set of blocker indices), or null
    const inBox = (b, x, z) => { const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.sn, lz = dx * b.sn + dz * b.c; return Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz; };
    function blockAt(x, z, ex) { const a = BH.get(Math.floor(x / BC) * 100003 + Math.floor(z / BC)); if (a) for (const b of a) if ((!ex || !ex.has(b.k)) && inBox(b, x, z)) return b; return null; }
    function holding(p) { const ex = new Set(), a = BH.get(Math.floor(p[0] / BC) * 100003 + Math.floor(p[2] / BC)); if (a) for (const b of a) if (inBox(b, p[0], p[2])) ex.add(b.k); return ex; }
    // can a pup walk straight from p to q? (water + blockers; a start / end point in a water cell - the bank nodes the layout
    // set at a shore, off any deck - may leave / reach dry land within SLACK m)
    // Samples every 0.4 m keep half a metre from deep water (wetM) once 1 m away from either end, so a line never grazes the
    // corner of a water cell between two samples.
    const wetM = (x, z) => wet(x, z) || wet(x + 0.5, z) || wet(x - 0.5, z) || wet(x, z + 0.5) || wet(x, z - 0.5);
    // A footprint that holds an end point (a door node, a builder's spot by the wall) only frees the line until it first
    // leaves that footprint: walking out of your own door is fine, cutting back through the hall is not (`ex` is unused,
    // kept so old callers read the same).
    function exitAt(b, p, q) {   // m along p -> q at which the line leaves box b (p inside)
      const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      const ox = p[0] - b.x, oz = p[2] - b.z, lx = ox * b.c - oz * b.sn, lz = ox * b.sn + oz * b.c, vx = ux * b.c - uz * b.sn, vz = ux * b.sn + uz * b.c;
      let t = Infinity; if (Math.abs(vx) > 1e-9) t = Math.min(t, ((vx > 0 ? b.hx : -b.hx) - lx) / vx); if (Math.abs(vz) > 1e-9) t = Math.min(t, ((vz > 0 ? b.hz : -b.hz) - lz) / vz);
      // only a line that heads out the near way is free (within 2 m of the shortest way out); one that crosses the
      // footprint (a door path drawn through its own hall to a road behind it) is not: -1
      return t <= Math.min(b.hx - Math.abs(lx), b.hz - Math.abs(lz)) + 2 ? t : -1;
    }
    // (useBlk 'dec' = only the player's decorations block: the fallback for a walk the layout's own footprints leave no
    // clean way for, e.g. a berry bush on the river bank; free decor, 2026-11-01)
    function blocksAt(x, z, mode) { const a = BH.get(Math.floor(x / BC) * 100003 + Math.floor(z / BC)), out = []; if (a) for (const b of a) if ((mode !== 'dec' || b.id === 'decor' || b.id === 'plant' || b.home) && inBox(b, x, z)) out.push(b); return out; }   // (planted trees + the player's own turned / free homes count as the player's things too)
    const blockAtM = (x, z, ex, mode) => { if (mode !== 'dec') return blockAt(x, z, ex); for (const b of blocksAt(x, z, 'dec')) if (!ex || !ex.has(b.k)) return b; return null; };
    function segOk(p, q, ex, useBlk) {
      const l = dxz(p, q), n = Math.max(1, Math.ceil(l / 0.4)), wa = wet(p[0], p[2]), wb = wet(q[0], q[2]), ma = wetM(p[0], p[2]), mb = wetM(q[0], q[2]);
      let ea = null, eb = null;
      if (useBlk) { ea = new Map(); eb = new Map(); for (const b of blocksAt(p[0], p[2], useBlk)) ea.set(b.k, exitAt(b, p, q)); for (const b of blocksAt(q[0], q[2], useBlk)) eb.set(b.k, exitAt(b, q, p)); }
      for (let k = 1; k < n; k++) {
        const f = k / n, x = p[0] + (q[0] - p[0]) * f, z = p[2] + (q[2] - p[2]) * f, near = (ma && l * f < 1) || (mb && l * (1 - f) < 1);
        if ((near ? wet(x, z) : wetM(x, z)) && !((wa && l * f < SLACK) || (wb && l * (1 - f) < SLACK))) return false;
        if (useBlk) for (const b of blocksAt(x, z, useBlk)) { const a = ea.get(b.k), c = eb.get(b.k); if (!((a !== undefined && l * f <= a + 0.05) || (c !== undefined && l * (1 - f) <= c + 0.05))) return false; }
      }
      return true;
    }
    // ---- detours: A* over a 2 m grid (8 neighbours, a cost for hugging water), then string-pulled
    // with segOk. Returns the inner points from p to q ([x, y, z], y blended), or null when there is no way round within
    // the search box (then the caller keeps the straight line and the path check reports it).
    function detour(p, q, ex, useBlk, wide) {
      const WC = G;   // the search grid's own step (2 m), not the water mask's cell
      const pad = wide ? Math.max(160, dxz(p, q)) : Math.max(45, dxz(p, q) * 0.7), x0 = Math.min(p[0], q[0]) - pad, z0 = Math.min(p[2], q[2]) - pad;
      const nx = Math.ceil((Math.max(p[0], q[0]) + pad - x0) / WC) + 1, nz = Math.ceil((Math.max(p[2], q[2]) + pad - z0) / WC) + 1;
      const cx = i => x0 + (i + 0.5) * WC, cz = j => z0 + (j + 0.5) * WC;
      const si = Math.floor((p[0] - x0) / WC), sj = Math.floor((p[2] - z0) / WC), ti = Math.floor((q[0] - x0) / WC), tj = Math.floor((q[2] - z0) / WC);
      const pass = new Int8Array(nx * nz).fill(-1);   // -1 unknown, 0 closed, 1 open, 2 open but beside water
      const open = (i, j) => {
        if (i < 0 || j < 0 || i >= nx || j >= nz) return 0; const k = j * nx + i; if (pass[k] >= 0) return pass[k];
        const x = cx(i), z = cz(j); let v = 1;
        if ((i === si && j === sj) || (i === ti && j === tj)) v = 1;
        else if (wet(x, z) || (useBlk && blockAtM(x, z, ex, useBlk))) v = 0;
        else if (useBlk && blockAtM(x, z, null, useBlk)) v = 3;   // inside the footprint an end point stands in: open, but leave it quickly
        else if (cellWet(x + WC, z) || cellWet(x - WC, z) || cellWet(x, z + WC) || cellWet(x, z - WC)) v = onDeck(x, z) ? 1 : 2;
        return (pass[k] = v);
      };
      const g = new Float64Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), done = new Uint8Array(nx * nz);
      const H = (i, j) => Math.hypot(i - ti, j - tj) * WC, heap = [];
      const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const pa = (c - 1) >> 1; if (heap[pa][0] < heap[c][0] || (heap[pa][0] === heap[c][0] && heap[pa][1] <= heap[c][1])) break; [heap[pa], heap[c]] = [heap[c], heap[pa]]; c = pa; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; const lt = (a, b) => heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]); if (l < heap.length && lt(l, m)) m = l; if (r < heap.length && lt(r, m)) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      const s0 = sj * nx + si, t0 = tj * nx + ti; g[s0] = 0; push(H(si, sj), s0); let found = false;
      while (heap.length) {
        const [, k] = pop(); if (done[k]) continue; done[k] = 1; if (k === t0) { found = true; break; }
        const i = k % nx, j = (k - i) / nx;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue; const a = i + di, b = j + dj, o = open(a, b); if (!o) continue;
          const mx = cx(i) + di * WC / 2, mz = cz(j) + dj * WC / 2;   // the step itself must stay dry (a sliver of river between two dry cell centres)
          if (wetM(mx, mz) || wetM((cx(i) + mx) / 2, (cz(j) + mz) / 2) || wetM((cx(a) + mx) / 2, (cz(b) + mz) / 2)) continue;
          if (useBlk && o !== 3 && open(i, j) !== 3 && blockAt(mx, mz, ex)) continue;   // nor clip a footprint's corner (a diagonal step past an oak)
          const nk = b * nx + a, ng = g[k] + Math.hypot(di, dj) * WC * (o === 2 ? 1.8 : o === 3 ? 4 : 1);
          if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + H(a, b), nk); }
        }
      }
      if (!found) return null;
      const cells = []; for (let k = from[t0]; k >= 0 && k !== s0; k = from[k]) cells.push(k); cells.reverse();
      const raw = [p].concat(cells.map(k => { const i = k % nx, j = (k - i) / nx; return [cx(i), 0, cz(j)]; }), [q]);
      // string pulling: from each kept point jump to the farthest point it can see
      const out = []; let a = 0;
      while (a < raw.length - 1) { let b = raw.length - 1; while (b > a + 1 && !segOk(raw[a], raw[b], ex, useBlk)) b--; if (b < raw.length - 1) out.push(raw[b]); a = b; }
      const tot = dxz(p, q) || 1;
      return out.map(c => { const f = Math.min(1, dxz(p, c) / tot); return r3([c[0], p[1] + (q[1] - p[1]) * f, c[2]]); });
    }

    // ---- road graph; an edge that runs through water off a bridge deck (the tree door's straight path south over the
    // plaza river, door paths to a road over a brook) becomes a detour polyline with its real length, or is dropped when
    // there is none (unless that would cut a node off: then it stays and the path check reports it)
    const adj = N.map(() => []), edgePts = new Map(), edgeFix = { detoured: [], dropped: [], kept: [], rehung: [] };
    // a door node is a dead end: its first edge goes out to the path node in front of the door; any later path the layout
    // hung on it (the Spirit Tree's shore path starts at a cottage's front door) is re-hung on that outside node, so walks
    // past it no longer go in at the door and out through the house
    const outside = new Map(); for (const [a, b] of L.roads.edges) { if (N[a] && N[a].door && !outside.has(a)) outside.set(a, b); if (N[b] && N[b].door && !outside.has(b)) outside.set(b, a); }
    for (const e of L.roads.edges) {
      let [a, b, len, kind] = e; if (a >= N.length || b >= N.length) continue;
      if (kind !== 'road' && kind !== 'bridge') {
        const a0 = a, b0 = b;
        if (N[a].door && outside.get(a) !== b) a = outside.get(a); if (N[b].door && outside.get(b) !== a0) b = outside.get(b);
        if (a !== a0 || b !== b0) { if (a === b) continue; len = Math.round(d3(N[a].p, N[b].p) * 100) / 100; edgeFix.rehung.push([a0, b0, a, b]); }
      }
      let l = len;
      if (!segOk(N[a].p, N[b].p, null, false) || (kind !== 'bridge' && !segOk(N[a].p, N[b].p, null, true))) {
        const ex = unite(holding(N[a].p), holding(N[b].p)), mid = detour(N[a].p, N[b].p, ex, kind !== 'bridge');
        if (mid && (mid.length ? polyLen([N[a].p].concat(mid, [N[b].p])) : len) < Math.max(3 * len, len + 160)) {
          if (mid.length) { edgePts.set(a + '>' + b, mid); edgePts.set(b + '>' + a, mid.slice().reverse()); l = Math.round(polyLen([N[a].p].concat(mid, [N[b].p])) * 100) / 100; }
          edgeFix.detoured.push([a, b, len, l]);
        } else { edgeFix.dropped.push([a, b, len]); continue; }
      }
      adj[a].push([b, l]); adj[b].push([a, l]);
    }
    function unite(A, B) { for (const k of B) A.add(k); return A; }
    function polyLen(P) { let s = 0; for (let i = 1; i < P.length; i++) s += d3(P[i - 1], P[i]); return s; }
    // a dropped edge that left a node unreachable from the tree door comes back (straight, as the layout drew it)
    {
      const seen = new Uint8Array(N.length), st = [doorNode]; seen[doorNode] = 1;
      while (st.length) { const c = st.pop(); for (const [nb] of adj[c]) if (!seen[nb]) { seen[nb] = 1; st.push(nb); } }
      for (const [a, b, len] of edgeFix.dropped) if (!seen[a] || !seen[b]) { adj[a].push([b, len]); adj[b].push([a, len]); edgeFix.kept.push([a, b]); }
    }

    // ---- A* (418 nodes: a linear-scan open list is plenty)
    const pathCache = new Map();
    function path(a, b) {
      if (a === b) return [a];
      const key = a + ':' + b; if (pathCache.has(key)) return pathCache.get(key);
      const g = new Float64Array(N.length).fill(Infinity), from = new Int32Array(N.length).fill(-1), closed = new Uint8Array(N.length);
      const open = [a]; g[a] = 0; const h = i => d3(N[i].p, N[b].p);
      let res = null;
      while (open.length) {
        let bi = 0, bf = Infinity;
        for (let k = 0; k < open.length; k++) { const f = g[open[k]] + h(open[k]); if (f < bf || (f === bf && open[k] < open[bi])) { bf = f; bi = k; } }
        const c = open[bi]; open.splice(bi, 1);
        if (c === b) { res = []; for (let x = b; x !== -1; x = from[x]) res.push(x); res.reverse(); break; }
        if (closed[c]) continue; closed[c] = 1;
        for (const [nb, len] of adj[c]) {
          if (closed[nb]) continue; const ng = g[c] + len;
          if (ng < g[nb]) { g[nb] = ng; from[nb] = c; if (!open.includes(nb)) open.push(nb); }
        }
      }
      if (!res) res = [a, b];   // disconnected: walk straight (never expected; ROAD GRAPH PASS says connected)
      pathCache.set(key, res); pathCache.set(b + ':' + a, res.slice().reverse());
      return res;
    }
    // Dijkstra distance from one node to all (used once to rank water spots by walking distance). It runs on the LAYOUT's
    // edge lengths (adj0), not the detoured ones: the spot lists keep the order they shipped with (saved critter visits
    // point into nav.water / gather by index, the sim's first-4 water + gather spots stay the same spots)
    const adj0 = N.map(() => []); for (const [a, b, len] of L.roads.edges) if (a < N.length && b < N.length) { adj0[a].push([b, len]); adj0[b].push([a, len]); }
    function distFrom(a) {
      const g = new Float64Array(N.length).fill(Infinity), done = new Uint8Array(N.length); g[a] = 0;
      for (;;) {
        let c = -1, bg = Infinity; for (let i = 0; i < N.length; i++) if (!done[i] && g[i] < bg) { bg = g[i]; c = i; }
        if (c < 0) break; done[c] = 1;
        for (const [nb, len] of adj0[c]) if (g[c] + len < g[nb]) g[nb] = g[c] + len;
      }
      return g;
    }

    // ---- trunk avoidance: a segment that cuts the circle (centre TP, radius R) is replaced by an arc around it
    function bend(a, b, R, out) {
      const ax = a[0] - TP[0], az = a[2] - TP[2], bx = b[0] - TP[0], bz = b[2] - TP[2];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 > 1e-9 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / L2)) : 0;
      const cx = ax + dx * t, cz = az + dz * t;
      if (Math.hypot(cx, cz) >= R || t <= 0 || t >= 1) { out.push(b); return; }
      const a0 = Math.atan2(az, ax), a1 = Math.atan2(bz, bx); let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.3)), Rr = R + 0.6;
      // radially out to the circle, round it, radially back in/out to b (the door sits inside the circle, in the root gap)
      for (let i = 0; i <= steps; i++) {
        const an = a0 + da * i / steps;
        out.push([TP[0] + Math.cos(an) * Rr, a[1] + (b[1] - a[1]) * i / steps, TP[2] + Math.sin(an) * Rr]);
      }
      out.push(b);
    }
    // creative build part 2: the straight runs a trunk bend adds (out to the circle, back from it to the spot) were never
    // checked against the player's decorations (300 pieces: door -> plaza blight legs clipped a crystal pillar). A run that
    // passes through a decoration goes round it (footprints + decor first, decor only as the fallback, like offPath), as
    // long as the way round keeps out of the trunk circle. Only runs WITH decor change: without decor this is never called.
    function trunkClear(P, R) {
      for (let i = 1; i < P.length; i++) {
        const ax = P[i - 1][0] - TP[0], az = P[i - 1][2] - TP[2], dx = P[i][0] - P[i - 1][0], dz = P[i][2] - P[i - 1][2], L2 = dx * dx + dz * dz;
        const t = L2 > 1e-9 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / L2)) : 0;
        if (Math.hypot(ax + dx * t, az + dz * t) < R - 0.05 && t > 0 && t < 1) return false;
      }
      return true;
    }
    function bendDec(a, tmp, R) {
      const out = []; let p = a;
      for (const q of tmp) {
        if (!segOk(p, q, null, 'dec')) {
          const ex = unite(holding(p), holding(q));
          for (const m of [detour(p, q, ex, true), detour(p, q, ex, 'dec'), detour(p, q, ex, 'dec', true)]) {
            if (m && trunkClear([p].concat(m, [q]), R) && polyOk([p].concat(m, [q]), ex, 'dec')) { for (const c of m) out.push(c); break; }
          }
        }
        out.push(q); p = q;
      }
      return out;
    }

    // ---- legs: polyline + cumulative length, cached by endpoints (+ trunk radius)
    const legCache = new Map();
    function leg(A, B, trunkR) {
      const key = A.p.join(',') + '|' + A.n + '>' + B.p.join(',') + '|' + B.n + '@' + trunkR.toFixed(2);
      let L = legCache.get(key); if (L) return L;
      // through the road graph; two spots hanging off the same node (the tree plaza) = walk straight across. The off-graph
      // ends and the edges themselves follow their detours round water + blockers (pathing pass)
      const raw = [A.p], ids = [-1], add = m => { for (const c of m) { raw.push(c); ids.push(-1); } };
      // a walk that would start / end at a road node across water (the nearest node is over the river) uses the nearest
      // node it can reach dry instead
      // (two spots on the same node walk straight, unless that line has no dry way round: then via the node(s) too)
      const direct = A.n === B.n ? offPath(A.p, B.p) : null;
      if (direct && !direct.wet) add(direct);
      else {
        const an = dryNode(A.p, A.n), bn = dryNode(B.p, B.n), R = paintIn.length ? paintRoute(A, B, an, bn) : null;
        if (R) {   // shaping the land: by a painted path (its points are off-graph points: ids -1, so saved nodes stay road nodes)
          if (R[0] < N0) add(offPath(A.p, N[R[0]].p));
          R.forEach((i, k) => { if (k && i < N0 && R[k - 1] < N0) { const m = edgePts.get(R[k - 1] + '>' + i); if (m) add(m); } raw.push(i < N0 ? N[i].p : PN[i - N0].p); ids.push(i < N0 ? i : -1); });
          const e = R[R.length - 1]; if (e < N0) add(offPath(N[e].p, B.p));
        } else {
          const P = path(an, bn);
          add(offPath(A.p, N[P[0]].p));
          P.forEach((i, k) => { if (k) { const m = edgePts.get(P[k - 1] + '>' + i); if (m) add(m); } raw.push(N[i].p); ids.push(i); });
          add(offPath(N[P[P.length - 1]].p, B.p));
        }
      }
      raw.push(B.p); ids.push(-1);
      // drop near-duplicate points, bend around the trunk
      const pts = [raw[0]], nid = [ids[0]];
      for (let i = 1; i < raw.length; i++) {
        if (d3(raw[i], pts[pts.length - 1]) < 0.05) { if (ids[i] >= 0) nid[nid.length - 1] = ids[i]; continue; }
        let tmp = []; bend(pts[pts.length - 1], raw[i], trunkR, tmp);
        if (tmp.length > 1 && (decB.length || plB.length || homeB.length)) tmp = bendDec(pts[pts.length - 1], tmp, trunkR);
        for (let k = 0; k < tmp.length; k++) { pts.push(tmp[k]); nid.push(k === tmp.length - 1 ? ids[i] : -1); }
      }
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + d3(pts[i - 1], pts[i]));
      const br = nid.map(i => i >= 0 && N[i].bridge);
      L = { pts, nid, br, cum, len: cum[cum.length - 1] };
      if (legCache.size > 400) legCache.clear();
      legCache.set(key, L); return L;
    }
    // point at distance s along a leg -> {p, dir:[dx,dz], seg, onBridge}
    function at(L, s) {
      const c = L.cum, n = c.length; if (n < 2) return { p: L.pts[0].slice(), dir: [0, 1], seg: 0, bridge: false };
      s = Math.max(0, Math.min(L.len, s));
      let i = 1; while (i < n - 1 && c[i] < s) i++;
      const a = L.pts[i - 1], b = L.pts[i], f = c[i] > c[i - 1] ? (s - c[i - 1]) / (c[i] - c[i - 1]) : 1;
      const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz) || 1;
      const x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f;
      return { p: [x, a[1] + (b[1] - a[1]) * f, z], dir: [dx / dl, dz / dl], seg: i - 1, bridge: L.br[i - 1] || L.br[i] || (decks.length > 0 && !!onDeck(x, z)) };
    }
    // the inner points of a straight walk p -> q off the road graph: none when it is dry + clear, else a detour (cached:
    // a pure function of the two points, so a cleared cache changes nothing)
    const offCache = new Map();
    function offPath(p, q) {
      if (dxz(p, q) < 0.05) return [];
      const key = p[0].toFixed(2) + ',' + p[2].toFixed(2) + '>' + q[0].toFixed(2) + ',' + q[2].toFixed(2);
      let m = offCache.get(key); if (m) return m;
      const ex = unite(holding(p), holding(q));
      m = segOk(p, q, ex, true) ? [] : detour(p, q, ex, true);
      if (!m) {
        // no clean way round the footprints: the water-only line, as the pathing pass shipped it, unless it runs through one
        // of the player's decorations (free decor): then a way that keeps out of those (Decor's rules keep one open)
        m = detour(p, q, ex, false) || detour(p, q, ex, false, true);
        if (m && (decB.length || plB.length || homeB.length) && !polyOk([p].concat(m, [q]), ex, 'dec')) m = detour(p, q, ex, 'dec') || detour(p, q, ex, 'dec', true) || m;
      }
      if (!m) { m = []; if (!segOk(p, q, null, false)) m.wet = true; }   // no dry way round: leg() goes by the road instead
      if (offCache.size > 3000) offCache.clear();
      offCache.set(key, m); return m;
    }
    // first road node at or after segment k (where a pup that is interrupted mid-leg heads to), else the last before
    function nodeNear(L, k, fallback) {
      for (let i = k + 1; i < L.nid.length; i++) if (L.nid[i] >= 0) return L.nid[i];
      for (let i = k; i >= 0; i--) if (L.nid[i] >= 0) return L.nid[i];
      return fallback;
    }

    // ---- job spots
    const jobs = L.jobs || [];
    const toward = (p, q, d) => { const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1; return r3([p[0] + dx / l * d, p[1], p[2] + dz / l * d]); };
    const dist = distFrom(doorNode);
    // pathing pass: the node a spot hangs off for WALKING = its own node when the straight line between them stays dry, else
    // the nearest node that has one (a bush across the river from its road node: the pup crossed the river to it); the
    // ranking `d` keeps the layout's node, so every list keeps its shipped order
    const dryC = new Map();
    function dryNode(p, n0) {
      if (n0 < 0 || n0 >= N.length || segOk(N[n0].p, p, null, false)) return n0;
      const key = p[0].toFixed(2) + ',' + p[2].toFixed(2) + ':' + n0; if (dryC.has(key)) return dryC.get(key);
      // (never a door node: the walk would go in at that door and out through the hall; clear of footprints first)
      const c = []; for (let i = 0; i < N.length; i++) { const d = dxz(N[i].p, p); if (!N[i].bridge && !N[i].door && d < 150) c.push([d, i]); }
      c.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let r = n0; const ex = holding(p);
      for (const [, i] of c) if (segOk(N[i].p, p, ex, true)) { r = i; break; }
      if (r === n0) for (const [, i] of c) if (segOk(N[i].p, p, null, false)) { r = i; break; }
      if (dryC.size > 3000) dryC.clear(); dryC.set(key, r); return r;
    }
    // a stand point in deep water (a bush on the river's edge, toward its node) moves round the thing to the driest side
    const dryStand = (at, p, r) => {
      if (!wet(p[0], p[2])) return p;
      let best = null, bd = Infinity;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, q = r3([at[0] + Math.cos(a) * r, p[1], at[2] + Math.sin(a) * r]); if (wet(q[0], q[2])) continue; const d = dxz(q, p); if (d < bd) { bd = d; best = q; } }
      return best || p;
    };
    const water = jobs.filter(j => j.kind === 'water').map(j => ({ p: r3(j.at), n: dryNode(r3(j.at), j.node), dip: toward(j.at, j.water || j.at, 2.2), water: j.water || j.at, river: j.river, d: dist[j.node] + dxz(j.at, N[j.node].p) }))
      .filter(w => isFinite(w.d)).sort((a, b) => a.d - b.d);
    const orbs = jobs.filter(j => j.kind === 'light' && j.place === 'orb').map(j => { const p = toward(j.at, TP, 3.2), n0 = dxz(j.at, TP) < 70 ? doorNode : j.node; return { orb: j.at, p, n: dryNode(p, n0), pid: j.placement }; });   // plaza orbs: walk straight from the door
    const other = {}; for (const j of jobs) if (j.kind !== 'water' && j.kind !== 'light') other[j.kind] = j;

    // ---- gathering spots: kept forest trees (wood), rune boulders + crystal pillars (stone), bushes + wisp trees
    // (berries). Each hangs off its nearest road node (<= 30 m, not a bridge); the pup stands beside it, toward the node.
    const nearNode = p => { let bi = -1, bd = Infinity; for (let i = 0; i < N.length; i++) { if (N[i].bridge) continue; const d = dxz(N[i].p, p); if (d < bd) { bd = d; bi = i; } } return [bi, bd]; };
    const PL = L.placements;
    function spots(filter, standR, K) {
      const out = [];
      for (const p of PL) {
        if (!filter(p)) continue;
        const [n, dn] = nearNode(p.pos); if (n < 0 || dn > 30 || dn < 2) continue;
        const d = dist[n] + dn; if (!isFinite(d)) continue;
        const sp = dryStand(p.pos, toward(p.pos, N[n].p, standR * (p.s || 1)), standR * (p.s || 1));
        out.push({ p: sp, n: dryNode(sp, n), at: p.pos, pid: p.id, d });
      }
      out.sort((a, b) => a.d - b.d || a.pid - b.pid);
      return out.slice(0, K);
    }
    const gather = {
      wood: spots(p => p.role === 'forest' && keepForest(p.id), 3.2, 8),
      stone: spots(p => /^EG_(RuneBoulder|CrystalPillar)/.test(p.piece), 3.4, 8),
      food: spots(p => /^EG_(Bush_|WispTree)/.test(p.piece), 2.6, 8),
    };

    // ---- build plots: every house + faction placement, and the market square (one plot). Builders stand 3 m out of
    // the first door (+ a sideways offset per builder). lv = tree level that opens it (rings of land; treehouses at 3).
    // faction halls (step 5: buildable from these tree levels, Sim.C.B hush / sprout / greenhold / circus / forge / market)
    const FACTION = { EG_HushHall: { lv: 4, name: 'Hush Hall', what: 'the guardians\' hall' }, EG_SproutHouse: { lv: 4, name: 'Sprout House', what: 'a school that trains pups faster' },
      EG_Greenhold: { lv: 5, name: 'Greenhold', what: 'the great conservatory' }, EG_Circus: { lv: 5, name: 'Circus', what: 'a big top for the performers' }, EG_GaleForge: { lv: 6, name: 'Gale Forge', what: 'tools + crafting on the cliffs' } };
    // land rings: L1 <= 180 m, L2 <= 250 m, L3 the rest + treehouses; step 5: the outer ring past OUTER m opens at L5
    const OUTER = 262;
    const plots = [];
    for (const p of PL) {
      if (p.role !== 'house' && p.role !== 'faction') continue;
      const D = p.doors && p.doors[0], n = p.nodes && p.nodes[0]; if (!D || !Number.isInteger(n) || n >= N.length) continue;
      const yaw = D[3] * Math.PI / 180, out = [Math.cos(yaw), -Math.sin(yaw)];
      const r = dxz(p.pos, TP), tree = /Treehouse/.test(p.piece);
      const f = FACTION[p.piece];
      plots.push({ pid: p.id, piece: p.piece, kind: p.role, pos: p.pos, ry: p.ry, s: p.s || 1, out, door: [D[0], D[1], D[2]], n, r,
        d: dist[n] + dxz(D, N[n].p), lv: f ? f.lv : r > OUTER ? 5 : Math.max(tree ? 3 : 1, r <= 180 ? 1 : r <= 250 ? 2 : 3), faction: f || null });
    }
    const mk = other.trade;
    if (mk) plots.push({ pid: -1, piece: 'market', kind: 'market', pos: mk.at, ry: 0, s: 1, out: [0, 1], door: mk.at, n: mk.node, r: dxz(mk.at, TP), d: dist[mk.node] || 0, lv: 4,
      faction: { lv: 4, name: 'Market square', what: 'stalls that bring the trader twice as often' } });
    plots.sort((a, b) => a.d - b.d || a.pid - b.pid);
    const plotBy = {}; plots.forEach((q, i) => { q.i = i; plotBy[q.pid] = q; });

    // ---- strays arrive over a bridge: the first road node past a bridge's far end (farther from the tree door)
    const spawns = [];
    for (let i = 0; i < N.length; i++) {
      if (!N[i].bridge) continue;
      for (const [nb] of adj[i]) if (!N[nb].bridge && dist[nb] > dist[i] && dist[nb] < 520 && !spawns.includes(nb)) spawns.push(nb);
    }
    spawns.sort((a, b) => dist[a] - dist[b] || a - b);

    // ---- decor spots (expedition finds): where the start island thinned the forest out (those trees are hidden, so the
    // ground there is free of houses and roads by the layout's own design), 30-160 m from the tree, >= 9 m apart, clear
    // of plots (16 m), kept trees (5 m) and road nodes (4 m); nearest the tree first
    // + the water mask (opts.water = data/water_cells.json) so nothing lands in a river; saves store spot indices, so
    // the list only depends on the layout + that data (same in every session, in the game and in sim_check).
    const decorSpots = [], decorCand = [];
    {
      const kept = PL.filter(p => p.role === 'forest' && keepForest(p.id));
      for (const p of PL) {
        if (p.role !== 'forest' || keepForest(p.id)) continue;
        const r = dxz(p.pos, TP); if (r < 30 || r > 200) continue;
        if (plots.some(q => dxz(q.pos, p.pos) < 16) || kept.some(k => dxz(k.pos, p.pos) < 5)) continue;
        let nn = Infinity; for (const n of N) nn = Math.min(nn, dxz(n.p, p.pos)); if (nn < 4) continue;
        decorCand.push({ p: r3(p.pos), r, pid: p.id });
      }
      decorCand.sort((a, b) => a.r - b.r || a.pid - b.pid);
    }
    function pickDecor(ok) {
      decorSpots.length = 0;
      for (const c of decorCand) { if (decorSpots.length >= 36) break; if (decorSpots.some(d => dxz(d.p, c.p) < 9) || (ok && !ok(c.p[0], c.p[2]))) continue; decorSpots.push({ p: c.p, pid: c.pid }); }
    }
    pickDecor(dry);

    // ---- blight spots (step 4, Protect): ground spots on rings around the trunk (44-76 m: clear of the grown tree's
    // roots), dry, off the plots (14 m), kept trees / plaza orbs + shrooms (4 m), road nodes (3 m) and the nap area in
    // front of the door, >= 10 m apart. The plaza has almost no road nodes, so (like the plaza orbs) pups walk there
    // straight from the door node. Ward spots: a ring of 6 at ~50 m (crystal wards slow blight within WARD_R).
    const TA = Math.atan2(doorOff[1], doorOff[0]), UX = doorOff[0] / doorDist, UZ = doorOff[1] / doorDist;
    function ringSpots(radii, stepM, minGap, max, phase) {
      const block = PL.filter(p => (p.role === 'forest' && keepForest(p.id)) || (p.role === 'decor' && dxz(p.pos, TP) < 90)), out = [];
      for (const r of radii) {
        const n = Math.max(6, Math.round(2 * Math.PI * r / stepM));
        for (let k = 0; k < n; k++) {
          const a = TA + (phase || 0) + k * 2 * Math.PI / n, x = TP[0] + Math.cos(a) * r, z = TP[2] + Math.sin(a) * r;
          if (dry && !dry(x, z)) continue;
          const u = (x - TP[0]) * UX + (z - TP[2]) * UZ, v = -(x - TP[0]) * UZ + (z - TP[2]) * UX; if (u > 10 && u < 74 && Math.abs(v) < 32) continue;   // nap grid
          if (plots.some(q => dxz(q.pos, [x, 0, z]) < 14) || block.some(t => dxz(t.pos, [x, 0, z]) < 4)) continue;
          let nn = Infinity; for (const nd of N) nn = Math.min(nn, dxz(nd.p, [x, 0, z])); if (nn < 3) continue;
          if (out.some(o => dxz(o.p, [x, 0, z]) < minGap)) continue;
          out.push({ p: r3([x, D0[1], z]), n: doorNode, r, a: Math.round(((a - TA) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) * 1000) / 1000 });
          if (out.length >= max) return out;
        }
      }
      return out;
    }
    const blightSpots = ringSpots([44, 52, 60, 68, 76], 11, 10, 28, 0.21);
    const wardSpots = ringSpots([56, 50, 62], 2 * Math.PI * 56 / 6, 30, 6, Math.PI / 6);
    // step 5: outer rings APPENDED (saves store indices: the first lists stay as they were) for the grown tree, whose
    // roots cover most of the inner ring from L4 on (Needs.spotOk)
    const blightInner = blightSpots.length; blightSpots.push(...ringSpots([92, 102, 112], 12, 10, 20, 0.37));
    wardSpots.push(...ringSpots([100, 94, 106], 2 * Math.PI * 100 / 8, 34, 6, Math.PI / 8));

    // ---- free decor (2026-11-01): the decorations a player placed are blockers too. Decor.sync (src/decor.js) hands the
    // list over from S.placed ({k, f: [cx, cz, hx, hz] in m, x, z, r}); their boxes join the footprint hash like the
    // layout's, and every cache that saw the blockers (off-graph paths, legs, dry nodes, nap spots) is cleared when the
    // set changes. Road edges never change: decor may not stand on a road (roadDist), so no edge detour needs a redo.
    let decB = [], decSig = '', homeB = [];   // (homeB: the player's turned / free homes' boxes, src/homes.js below)
    function setDecor(list, sig) {
      if (sig === decSig) return false;
      for (const b of decB) cellsOf(b, k => { const a = BH.get(k); if (!a) return; const j = a.indexOf(b); if (j >= 0) a.splice(j, 1); if (!a.length) BH.delete(k); });
      decB = (list || []).map((d, i) => { const b = boxOf(d.x, d.z, d.r, d.f, 1, 'decor', 1e6 + i); b.dk = d.k; return b; });
      for (const b of decB) hashIn(b);
      offCache.clear(); legCache.clear(); dryC.clear(); for (const k in restCache) delete restCache[k];
      if (paintIn.length) paintDirty = true;   // painted paths link to the roads round the decorations: re-link before the next leg
      decSig = sig; return true;
    }
    const decorAt = (x, z) => { for (const b of decB) if (inBox(b, x, z)) return b; return null; };

    // ---- shaping the land (creative build part 2, src/land.js). Land.sync hands over {cut: [placement ids], plant: [{k, f, x,
    // z, r}], paths: [{k, p: [[x, z], ...]}]}: a removed forest tree's footprint leaves the hash (back when the removal is
    // undone), a planted tree's joins it (id 'plant'), painted paths become extra graph nodes (ids N0 + i) with cheap edges
    // along them (PREF of their length, so pups prefer them) + straight, clear links to the nearest road nodes (LINK m) and
    // between paths. leg() takes a painted path only when that way is cheaper; empty land = no node, no link, the old nav.
    const N0 = N.length, LINK = 22, PREF = 0.7;
    let landSig = '', cutB = [], plB = [], PN = [], linkAdj = new Map(), paintSegs = [], paintIn = [], paintDirty = false;
    const unhash = b => cellsOf(b, k => { const a = BH.get(k); if (!a) return; const j = a.indexOf(b); if (j >= 0) a.splice(j, 1); if (!a.length) BH.delete(k); });
    const rehash = b => cellsOf(b, k => { let a = BH.get(k); if (!a) BH.set(k, a = []); a.push(b); a.sort((x, y) => x.k - y.k); });   // (back in the layout's order)
    function setLand(Ld, sig) {
      if (sig === landSig) return false;
      for (const b of cutB) rehash(b); cutB = [];
      for (const b of plB) unhash(b); plB = [];
      const cut = new Set((Ld && Ld.cut) || []);
      if (cut.size) for (const b of blk) if (cut.has(b.id) && b.role === 'forest') { unhash(b); cutB.push(b); }
      plB = ((Ld && Ld.plant) || []).map((d, i) => { const b = boxOf(d.x, d.z, d.r, d.f, 1, 'plant', 2e6 + i); b.role = 'plant'; b.pk = d.k; return b; });
      for (const b of plB) hashIn(b);
      paintIn = (Ld && Ld.paths) || []; buildPaint();
      offCache.clear(); legCache.clear(); dryC.clear(); pathCache.clear(); for (const k in restCache) delete restCache[k];
      landSig = sig; return true;
    }
    // the y of a painted point: its nearest road node's (the game draws pups on the ground; the sim only needs lengths)
    const yNear = (x, z) => { let bi = -1, bd = Infinity; for (let i = 0; i < N0; i++) { if (N[i].bridge) continue; const d = (N[i].p[0] - x) * (N[i].p[0] - x) + (N[i].p[2] - z) * (N[i].p[2] - z); if (d < bd) { bd = d; bi = i; } } return bi >= 0 ? N[bi].p[1] : TP[1]; };
    function buildPaint() {
      PN = []; linkAdj = new Map(); paintSegs = []; paintDirty = false;
      for (const P of paintIn) {
        const base = PN.length;
        P.p.forEach(([x, z]) => PN.push({ p: r3([x, yNear(x, z), z]), adj: [], path: P.k }));
        for (let j = base + 1; j < PN.length; j++) { const l = d3(PN[j - 1].p, PN[j].p); PN[j - 1].adj.push([N0 + j, l * PREF, l]); PN[j].adj.push([N0 + j - 1, l * PREF, l]); paintSegs.push([PN[j - 1].p, PN[j].p]); }
      }
      for (let i = 0; i < PN.length; i++) {
        const p = PN[i].p, c = [];
        for (let n = 0; n < N0; n++) { if (N[n].bridge || N[n].door || wetM(N[n].p[0], N[n].p[2])) continue; const d = dxz(N[n].p, p); if (d <= LINK) c.push([d, n]); }   // (a shore node's water slack never mid-walk)
        c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        let got = 0;
        for (const [, n] of c) { if (got >= 2) break; if (!segOk(p, N[n].p, holding(N[n].p), true)) continue; const l = d3(p, N[n].p); PN[i].adj.push([n, l, l]); let a = linkAdj.get(n); if (!a) linkAdj.set(n, a = []); a.push([N0 + i, l, l]); got++; }
        for (let j = i + 1; j < PN.length; j++) if (PN[j].path !== PN[i].path && dxz(PN[j].p, p) < 4 && segOk(p, PN[j].p, null, true)) { const l = d3(p, PN[j].p); PN[i].adj.push([N0 + j, l * PREF, l]); PN[j].adj.push([N0 + i, l * PREF, l]); }
      }
    }
    // the cheapest way from A to B that uses a painted path (multi-source Dijkstra: A's own node via its off-graph walk, or
    // straight onto a painted point within LINK m; the same at B's end) -> node ids, or null when the best way uses none
    function paintRoute(A, B, an, bn) {
      if (paintDirty) buildPaint();
      if (!PN.length) return null;
      const M = N0 + PN.length, g = new Float64Array(M).fill(Infinity), from = new Int32Array(M).fill(-1), done = new Uint8Array(M), heap = [];
      const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const pa = (c - 1) >> 1; if (heap[pa][0] < heap[c][0] || (heap[pa][0] === heap[c][0] && heap[pa][1] <= heap[c][1])) break; [heap[pa], heap[c]] = [heap[c], heap[pa]]; c = pa; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; const lt = (a, b) => heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]); if (l < heap.length && lt(l, m)) m = l; if (r < heap.length && lt(r, m)) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      const offLen = (p, q, m) => polyLen([p].concat(m, [q]));
      const ends = (p, n0, out) => {   // (node, cost) pairs to enter / leave the graph at p
        const r = [[n0, out ? offLen(N[n0].p, p, offPath(N[n0].p, p)) : offLen(p, N[n0].p, offPath(p, N[n0].p))]], ex = holding(p), c = [];
        for (let i = 0; i < PN.length; i++) { const d = dxz(PN[i].p, p); if (d <= LINK) c.push([d, i]); }
        c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        let got = 0; for (const [, i] of c) { if (got >= 3) break; if (segOk(p, PN[i].p, ex, true)) { r.push([N0 + i, d3(p, PN[i].p)]); got++; } }
        return r;
      };
      const S0 = ends(A.p, an, false), E0 = ends(B.p, bn, true), endC = new Map(); for (const [n, c] of E0) endC.set(n, c);
      for (const [n, c] of S0) if (c < g[n]) { g[n] = c; from[n] = -1; push(c, n); }
      let best = Infinity, bestN = -1;
      while (heap.length) {
        const [f, k] = pop(); if (done[k]) continue; done[k] = 1; if (f >= best) break;
        if (endC.has(k) && f + endC.get(k) < best) { best = f + endC.get(k); bestN = k; }
        const A2 = k < N0 ? (linkAdj.has(k) ? adj[k].concat(linkAdj.get(k)) : adj[k]) : PN[k - N0].adj;
        for (const e of A2) { const nb = e[0], ng = f + e[1]; if (ng < g[nb]) { g[nb] = ng; from[nb] = k; push(ng, nb); } }
      }
      if (bestN < 0) return null;
      const seq = []; for (let x = bestN; x !== -1; x = from[x]) seq.push(x); seq.reverse();
      return seq.some(i => i >= N0) ? seq : null;
    }
    // m from (x, z) to the nearest painted strip's middle line (capped at max)
    function paintDist(x, z, max) {
      let d = max === undefined ? Infinity : max;
      for (const [a, b] of paintSegs) { const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2)) : 0; d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t)); }
      return d;
    }
    const plantAt = (x, z) => { for (const b of plB) if (inBox(b, x, z)) return b; return null; };
    // the road graph's walked lines (edges + their detours) in a 12 m hash: how far (x, z) is from the nearest road
    const RS = new Map();
    {
      const add = (a, b, ea, eb) => { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
        for (let i = Math.floor(x0 / BC); i <= Math.floor(x1 / BC); i++) for (let j = Math.floor(z0 / BC); j <= Math.floor(z1 / BC); j++) { const k = i * 100003 + j; let s = RS.get(k); if (!s) RS.set(k, s = []); s.push([a, b, ea, eb]); } };
      adj.forEach((e, a) => { for (const [b] of e) { if (b < a) continue; const m = edgePts.get(a + '>' + b) || [], P = [N[a].p].concat(m, [N[b].p]); for (let i = 1; i < P.length; i++) add(P[i - 1], P[i], a, b); } });
    }
    // the nearest road line within max m of (x, z): { d, a, b } (the segment's ends), or { d: max } when none (exN: skip the
    // edges of that road node, e.g. a turned home's own old door path: src/homes.js)
    function roadNear(x, z, max, exN) {
      const r = { d: max, a: null, b: null }, c = Math.ceil(max / BC);
      for (let i = Math.floor(x / BC) - c; i <= Math.floor(x / BC) + c; i++) for (let j = Math.floor(z / BC) - c; j <= Math.floor(z / BC) + c; j++) {
        const s = RS.get(i * 100003 + j); if (!s) continue;
        for (const [a, b, ea, eb] of s) { if (exN !== undefined && (ea === exN || eb === exN)) continue; const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2)) : 0, d = Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
          if (d < r.d) { r.d = d; r.a = a; r.b = b; } }
      }
      return r;
    }
    const roadDist = (x, z, max) => roadNear(x, z, max).d;   // m to the nearest road line, capped at max (looks only that far)
    // can a pup still walk from p to q without going through a decoration? (round every footprint, or - where the layout's own
    // footprints leave no clean way, as offPath falls back - round the decorations at least)
    function reachOk(p, q) { const ex = unite(holding(p), holding(q)); return segOk(p, q, ex, true) || !!detour(p, q, ex, true) || segOk(p, q, ex, 'dec') || !!detour(p, q, ex, 'dec'); }
    function polyOk(P, ex, mode) { for (let i = 1; i < P.length; i++) if (!segOk(P[i - 1], P[i], ex, mode)) return false; return true; }

    // ---- buildings (creative build part 2, piece 4, src/homes.js). Homes.sync hands over [{pid, piece, x, z, ry, s, free}]:
    // a fixed plot that was TURNED (90 deg steps round its placement) or SWAPPED to another house piece gets its own footprint
    // box (the layout's leaves the hash), its door + out are re-made from the piece's local door, and a turned one hangs off a
    // road node by a door leg (homeLink) instead of its layout door node (q.base keeps the layout's fields). A FREE plot (pid
    // FREE0 + id, a home on open land) is a new plotBy entry that is NOT in nav.plots (the pups' plot lists stay the layout's).
    // Empty list = the old nav, byte for byte.
    const FREE0 = 900000, DOOR_R = 25, LINK_MAX = 80;
    const DOORL = {};   // piece -> [local x, local z, door yaw - ry, door height] (the same on every placement of a piece)
    for (const p of PL) {
      if (DOORL[p.piece] || (p.role !== 'house' && p.role !== 'faction') || !p.doors || !p.doors[0]) continue;
      const D = p.doors[0], c = Math.cos(p.ry || 0), sn = Math.sin(p.ry || 0), s = p.s || 1, dx = (D[0] - p.pos[0]) / s, dz = (D[2] - p.pos[2]) / s;
      DOORL[p.piece] = [dx * c - dz * sn, dx * sn + dz * c, D[3] * Math.PI / 180 - (p.ry || 0), (D[1] - p.pos[1]) / s];
    }
    function homeGeo(piece, x, y, z, ry, s) {
      const d = DOORL[piece] || [0, 3, 1.5 * Math.PI, 0.4], c = Math.cos(ry), sn = Math.sin(ry), yw = ry + d[2], r6 = v => Math.round(v * 1e6) / 1e6;
      return { door: r3([x + (d[0] * c + d[1] * sn) * s, y + d[3] * s, z + (-d[0] * sn + d[1] * c) * s]), out: [r6(Math.cos(yw)), r6(-Math.sin(yw))] };
    }
    let homeSig = '', homeHid = [], homeMod = [], freeQ = [];
    // the door leg of a turned / free home: the builders' stand 3 m out of the door -> the nearest road node (not a bridge or
    // door node) whose walk from there is dry, clear of every footprint and <= LINK_MAX m. ok = that, the door + stand are dry
    // and free, and a road (or a painted path linked to a road) passes within DOOR_R m of the door. why: door | road | blocked
    function homeLink(q) {
      const st = r3([q.door[0] + q.out[0] * 3, q.door[1], q.door[2] + q.out[1] * 3]), own = new Set(homeB.filter(b => b.id === q.pid).map(b => b.k));
      const res = { n: -1, ok: false, why: null, len: 0, st };
      if (wetM(q.door[0], q.door[2]) || wetM(st[0], st[2]) || blocksAt(st[0], st[2]).some(b => !own.has(b.k)) || !segOk(q.door, st, own, true)) res.why = 'door';   // (a porch house's stand is inside its own footprint, as on the layout)
      const c = []; for (let i = 0; i < N0; i++) { if (N[i].bridge || N[i].door) continue; const d = dxz(N[i].p, st); if (d <= LINK_MAX) c.push([d, i]); }
      c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, i] of c) {
        const m = offPath(st, N[i].p); if (m.wet) continue; const P = [st].concat(m, [N[i].p]);
        if (polyLen(P) > LINK_MAX || !polyOk(P, unite(holding(st), holding(N[i].p)), true)) continue;
        res.n = i; res.len = polyLen(P); break;
      }
      if (res.n < 0) { res.n = c.length ? c[0][1] : doorNode; if (!res.why) res.why = 'blocked'; return res; }
      let near = roadNear(q.door[0], q.door[2], DOOR_R).d < DOOR_R;
      if (!near && paintIn.length) {
        if (paintDirty) buildPaint();
        const linked = new Set(); for (const pn of PN) if (pn.adj.some(e => e[0] < N0)) linked.add(pn.path);
        near = PN.some(pn => linked.has(pn.path) && dxz(pn.p, q.door) <= DOOR_R && segOk(st, pn.p, null, true));
      }
      if (!near && !res.why) res.why = 'road';
      res.ok = !res.why; return res;
    }
    function setHomes(list, sig) {
      if (sig === homeSig) return false;
      for (const q of homeMod) { Object.assign(q, q.base); delete q.base; delete q.road; delete q.link; }
      for (const q of freeQ) delete plotBy[q.pid];
      for (const b of homeB) unhash(b); for (const b of homeHid) rehash(b);
      homeB = []; homeHid = []; homeMod = []; freeQ = [];
      offCache.clear(); legCache.clear(); dryC.clear();
      (list || []).forEach((h, i) => {
        let q = plotBy[h.pid];
        if (h.free) { if (q) return; q = { pid: h.pid, kind: 'house', lv: 1, faction: null, free: true, d: 0 }; plotBy[h.pid] = q; freeQ.push(q); }
        else {
          if (!q || q.kind !== 'house') return;
          q.base = { piece: q.piece, pos: q.pos, ry: q.ry, s: q.s, out: q.out, door: q.door, n: q.n }; homeMod.push(q);
          for (const b of blk) if (b.id === q.pid) { unhash(b); homeHid.push(b); }
        }
        const y = h.free ? yNear(h.x, h.z) : q.base.pos[1], g = homeGeo(h.piece, h.x, y, h.z, h.ry, h.s || 1);
        q.piece = h.piece; q.pos = r3([h.x, y, h.z]); q.ry = h.ry; q.s = h.s || 1; q.door = g.door; q.out = g.out; q.r = dxz(q.pos, TP);
        q.road = !!(h.free || h.turn);   // a turned / free home hangs off a road node by its door leg (an untouched door keeps its door node)
        const f = FOOT[h.piece]; if (f) { const b = boxOf(h.x, h.z, h.ry, f, q.s, q.pid, 3e6 + i); b.role = 'house'; b.home = true; homeB.push(b); hashIn(b); }
      });
      offCache.clear(); legCache.clear(); dryC.clear(); for (const k in restCache) delete restCache[k];
      if (paintIn.length) paintDirty = true;
      for (const q of homeMod.concat(freeQ)) { q.link = homeLink(q); if (q.road) q.n = q.link.n; }
      offCache.clear(); legCache.clear(); dryC.clear();
      homeSig = sig; return true;
    }

    const restCache = {};
    const api = {
      nodes: N, adj, path, leg, at, nodeNear, tree, TP, doorNode, water, orbs, other, gather, plots, plotBy, spawns, dist, decorSpots, blightSpots, blightInner, wardSpots, dry,
      // pathing pass: wet(x, z) = water off any bridge deck, cellWet = the raw mask, onDeck(x, z) -> deck | null, blockAt(x, z,
      // ex) -> blocker | null, holding(p) = blockers under p, segOk(p, q, ex, useBlockers), offPath(p, q), edgeFix (what the
      // road graph needed: detoured / dropped / kept edges), blk (the blocker boxes, grown by PUP_R)
      wet, cellWet, onDeck, deckY, decks, blockAt, holding, segOk, offPath, detour, edgeFix, blk, edgePts,
      // free decor: setDecor(list, sig) (src/decor.js), decorAt(x, z) -> decor box | null, decorSig(), roadDist(x, z, max), reachOk(p, q), boxOf
      wcell: WC, setDecor, decorAt, decorSig: () => decSig, decorBoxes: () => decB, roadDist, roadNear, reachOk, boxOf, inBox, blocksAt, placements: PL,
      // shaping the land: setLand(land, sig) (src/land.js), landSig(), paintDist(x, z, max), plantAt(x, z) -> planted box | null,
      // paint() = the painted graph points, cutBoxes() / plantBoxes()
      setLand, landSig: () => landSig, paintDist, plantAt, paint: () => { if (paintDirty) buildPaint(); return PN; }, cutBoxes: () => cutB, plantBoxes: () => plB, N0,
      // buildings (src/homes.js): setHomes(list, sig), homeSig(), freePlots() (free plot entries), homeBoxes(), homeGeo(piece, x, y,
      // z, ry, s) -> {door, out}, homeLink(q) -> {n, ok, why, len, st}, DOORL, FREE0, DOOR_R, yNear(x, z)
      setHomes, homeSig: () => homeSig, freePlots: () => freeQ, homeBoxes: () => homeB, homeGeo, homeLink, DOORL, FREE0, DOOR_R, yNear,
      // fingerprint of every data-driven spot list (saves store indices into them): equal in the game and sim_check
      spotSig() { const f = a => a.map(s => (s.pid !== undefined ? s.pid : '') + '@' + s.p.map(v => Math.round(v * 10)).join(',')).join(';'); return 'decor ' + decorSpots.length + ':' + hashStr(f(decorSpots)) + ' blight ' + blightSpots.length + ':' + hashStr(f(blightSpots)) + ' ward ' + wardSpots.length + ':' + hashStr(f(wardSpots)); },
      // where the k-th builder stands at a plot (3 m out of its door, side by side)
      site(pid, k) {
        const q = plotBy[pid]; if (!q) return null;
        const o = q.out, side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.4, out = q.kind === 'market' ? 0 : 3 + (k > 4 ? 2.5 : 0);
        if (q.road) return { p: r3([q.door[0] + o[0] * out - o[1] * side, q.door[1], q.door[2] + o[1] * out + o[0] * side]), n: q.n };   // a turned / free home: its door leg's road node (src/homes.js)
        // pathing pass: hung off the path node just outside the door (not the door node itself: the builder walked in at
        // the door and back out to its spot)
        const outN = (adj0[q.n] || []).map(e => e[0]).find(i => !N[i].door);
        return { p: r3([q.door[0] + o[0] * out - o[1] * side, q.door[1], q.door[2] + o[1] * out + o[0] * side]), n: outN !== undefined ? outN : q.n };
      },
      // the tree door / pour point at a given tree scale (the young tree is the elder tree scaled down)
      door(scale) { const k = (doorDist * scale + 2.2) / doorDist; return { p: r3([TP[0] + doorOff[0] * k, D0[1], TP[2] + doorOff[1] * k]), n: doorNode }; },
      trunkR(scale) { return doorDist * scale * 1.7; },   // trunk + root flare
      // rest spots: a ring on the plaza around the trunk, beside the door
      // nap spots: the k-th of a grid in front of the door (nearest the path first, >= 4.5 m apart) that is clear of
      // the trunk + roots. `clear(x, z, scale)` comes from the game (tree mesh); without it (node checks) all are clear.
      rest(k, scale) {
        const key = scale.toFixed(4); let list = restCache[key];
        if (!list) {
          const ux = doorOff[0] / doorDist, uz = doorOff[1] / doorDist, base = doorDist * scale * 1.4 + 6, cand = [];
          for (let r = 0; r <= 40; r += 3) for (let sd = -27; sd <= 27; sd += 4.5) {
            if (Math.abs(sd) < 3) continue;   // keep the path itself free
            cand.push({ p: [TP[0] + ux * (base + r) - uz * sd, D0[1], TP[2] + uz * (base + r) + ux * sd], w: Math.abs(sd) + r * 0.7 + (sd > 0 ? 0.1 : 0) });
          }
          cand.sort((a, b) => a.w - b.w);
          list = [];
          for (const c of cand) {
            if (list.length >= 32) break;
            if (api.clear && !api.clear(c.p[0], c.p[2], scale)) continue;
            if (decB.length && decorAt(c.p[0], c.p[2])) continue;   // free decor: a nap spot under a decoration moves on
            if (plB.length && plantAt(c.p[0], c.p[2])) continue;    // (and under a planted tree)
            if (list.some(q => Math.hypot(q[0] - c.p[0], q[2] - c.p[2]) < 4.5)) continue;
            list.push(r3(c.p));
          }
          if (!list.length) list.push(r3([TP[0] + ux * base, D0[1], TP[2] + uz * base]));
          restCache[key] = list;
        }
        return { p: list[k % list.length].slice(), n: doorNode };
      },
      setDecorOk(fn) { pickDecor(fn); },
      clear: null, setClear(fn) { api.clear = fn; for (const k in restCache) delete restCache[k]; },
    };
    return api;
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  Nav.keepForest = keepForest; Nav.waterTest = waterTest; Nav.FOOT = FOOT; Nav.PUP_R = PUP_R; Nav.SLACK = SLACK;
  window.Nav = Nav;
})();
