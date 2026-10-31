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
  function Nav(L, opts) {
    const dry = waterTest(opts && opts.water);
    const N = L.roads.nodes.map(a => ({ p: [a[0], a[1], a[2]], bridge: !!(a[3] && a[3].bridge), door: a[3] && a[3].door }));
    const adj = N.map(() => []);
    for (const e of L.roads.edges) {
      const [a, b, len] = e; if (a >= N.length || b >= N.length) continue;
      adj[a].push([b, len]); adj[b].push([a, len]);
    }
    const tree = L.placements.find(p => p.role === 'tree') || { pos: [0, 7, 0], doors: [[0, 7, 21.6, 270]], nodes: [0] };
    const TP = tree.pos, D0 = tree.doors[0];
    const doorOff = [D0[0] - TP[0], D0[2] - TP[2]], doorDist = Math.hypot(doorOff[0], doorOff[1]);
    const doorNode = (tree.nodes && tree.nodes[0]) || 0;
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

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
    // Dijkstra distance from one node to all (used once to rank water spots by walking distance)
    function distFrom(a) {
      const g = new Float64Array(N.length).fill(Infinity), done = new Uint8Array(N.length); g[a] = 0;
      for (;;) {
        let c = -1, bg = Infinity; for (let i = 0; i < N.length; i++) if (!done[i] && g[i] < bg) { bg = g[i]; c = i; }
        if (c < 0) break; done[c] = 1;
        for (const [nb, len] of adj[c]) if (g[c] + len < g[nb]) g[nb] = g[c] + len;
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

    // ---- legs: polyline + cumulative length, cached by endpoints (+ trunk radius)
    const legCache = new Map();
    function leg(A, B, trunkR) {
      const key = A.p.join(',') + '|' + A.n + '>' + B.p.join(',') + '|' + B.n + '@' + trunkR.toFixed(2);
      let L = legCache.get(key); if (L) return L;
      // through the road graph; two spots hanging off the same node (the tree plaza) = walk straight across
      const raw = [A.p], ids = [-1];
      if (A.n !== B.n) for (const i of path(A.n, B.n)) { raw.push(N[i].p); ids.push(i); }
      raw.push(B.p); ids.push(-1);
      // drop near-duplicate points, bend around the trunk
      const pts = [raw[0]], nid = [ids[0]];
      for (let i = 1; i < raw.length; i++) {
        if (d3(raw[i], pts[pts.length - 1]) < 0.05) { if (ids[i] >= 0) nid[nid.length - 1] = ids[i]; continue; }
        const tmp = []; bend(pts[pts.length - 1], raw[i], trunkR, tmp);
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
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], dir: [dx / dl, dz / dl], seg: i - 1, bridge: L.br[i - 1] || L.br[i] };
    }
    // first road node at or after segment k (where a pup that is interrupted mid-leg heads to), else the last before
    function nodeNear(L, k, fallback) {
      for (let i = k + 1; i < L.nid.length; i++) if (L.nid[i] >= 0) return L.nid[i];
      for (let i = k; i >= 0; i--) if (L.nid[i] >= 0) return L.nid[i];
      return fallback;
    }

    // ---- job spots
    const jobs = L.jobs || [];
    const r3 = v => v.map(x => Math.round(x * 1000) / 1000);
    const toward = (p, q, d) => { const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1; return r3([p[0] + dx / l * d, p[1], p[2] + dz / l * d]); };
    const dist = distFrom(doorNode);
    const water = jobs.filter(j => j.kind === 'water').map(j => ({ p: r3(j.at), n: j.node, dip: toward(j.at, j.water || j.at, 2.2), water: j.water || j.at, river: j.river, d: dist[j.node] + dxz(j.at, N[j.node].p) }))
      .filter(w => isFinite(w.d)).sort((a, b) => a.d - b.d);
    const orbs = jobs.filter(j => j.kind === 'light' && j.place === 'orb').map(j => ({ orb: j.at, p: toward(j.at, TP, 3.2), n: dxz(j.at, TP) < 70 ? doorNode : j.node, pid: j.placement }));   // plaza orbs: walk straight from the door
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
        out.push({ p: toward(p.pos, N[n].p, standR * (p.s || 1)), n, at: p.pos, pid: p.id, d });
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

    const restCache = {};
    const api = {
      nodes: N, adj, path, leg, at, nodeNear, tree, TP, doorNode, water, orbs, other, gather, plots, plotBy, spawns, dist, decorSpots, blightSpots, blightInner, wardSpots, dry,
      // fingerprint of every data-driven spot list (saves store indices into them): equal in the game and sim_check
      spotSig() { const f = a => a.map(s => (s.pid !== undefined ? s.pid : '') + '@' + s.p.map(v => Math.round(v * 10)).join(',')).join(';'); return 'decor ' + decorSpots.length + ':' + hashStr(f(decorSpots)) + ' blight ' + blightSpots.length + ':' + hashStr(f(blightSpots)) + ' ward ' + wardSpots.length + ':' + hashStr(f(wardSpots)); },
      // where the k-th builder stands at a plot (3 m out of its door, side by side)
      site(pid, k) {
        const q = plotBy[pid]; if (!q) return null;
        const o = q.out, side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.4, out = q.kind === 'market' ? 0 : 3 + (k > 4 ? 2.5 : 0);
        return { p: r3([q.door[0] + o[0] * out - o[1] * side, q.door[1], q.door[2] + o[1] * out + o[0] * side]), n: q.n };
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
  Nav.keepForest = keepForest; Nav.waterTest = waterTest;
  window.Nav = Nav;
})();
