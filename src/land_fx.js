// Shaping the land, the view (creative build part 2, piece 3). Reads S.land every frame, owns no game state (home + visits):
//  - painted paths: stepping-stone strips = ONE InstancedMesh of the cozy kit's EG_StepStone (map material + ink), packed-earth
//    strips = ONE merged ribbon mesh (map lit material, vertex colours), both rebuilt only when the paths change
//  - planted trees: the kit's oak / spruce pieces instanced per piece (+ ink), sized by their growth (sapling -> full over
//    Land.C.GROW of sim time; matrices refreshed every second while something still grows)
//  - removed trees: the layout instance is hidden by id (role 'cut'), shown again when the removal is undone
//  - flower meadows: lane A's flower clump (5 library flower patches merged, world_fx `flowerKit`) instanced, one draw,
//    tinted per meadow kind, distance-culled like lane A's flowers
// Plus the land tools' preview: the brush stroke (green / red line + the bad point), a radius ring is expFx.ring.
(function () {
  'use strict';
  const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
  const TINT = [[1, 1, 1], [1, 0.8, 0.9], [1, 0.95, 0.72], [0.82, 0.88, 1]];
  const EARTH = new THREE.Color(0xa47650).convertSRGBToLinear(), EDGE = new THREE.Color(0x9c8a4c).convertSRGBToLinear();   // packed earth: a warm path brown, a mossy edge
  function LandFx(scene, map, nav, ground, opt) {
    opt = opt || {};
    const PHONE = !!opt.phone, TP = nav.TP;
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const lit = batchOf.EG_Pebbles && batchOf.EG_Pebbles.mesh ? batchOf.EG_Pebbles.mesh.material : map.batches.find(b => b.mesh && !b.terrain).mesh.material;
    const gy = (x, z) => { const r = ground.raw ? ground.raw(x, z) : null; return r === null || r === undefined ? ground(x, z, TP[1]) : r; };
    const V = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), CO = new THREE.Color();
    // an instanced copy of a kit piece (same geometry + material as the map, + its ink hull and see-through parts)
    function kitMesh(key, cap) {
      const b = batchOf[key]; if (!b || !b.geo) return null;
      const m = new THREE.InstancedMesh(b.geo, b.mesh.material, cap); m.count = 0; m.castShadow = !PHONE; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
      let ink = null; if (b.inkMesh && b.ink && !PHONE) { ink = new THREE.InstancedMesh(b.ink, b.inkMesh.material, cap); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.frustumCulled = false; scene.add(ink); }
      const see = (b.see || []).map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, cap); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = false; scene.add(im); return im; });
      return { m, ink, see, cap, n: 0, set(n) { this.n = n; m.count = n; m.instanceMatrix.needsUpdate = true; if (ink) ink.count = n; see.forEach(s => { s.count = n; }); } };
    }
    const one = (geo, m) => { const im = new THREE.InstancedMesh(geo, m, 1); im.setMatrixAt(0, new THREE.Matrix4()); im.frustumCulled = false; return im; };

    // ---- painted paths
    const STONE_CAP = 1400, stones = kitMesh('EG_StepStone', STONE_CAP);
    let earth = null, pathSig = '';
    function buildPaths(S) {
      const P = Land.paths(S); let n = 0;
      if (earth) { scene.remove(earth); earth.geometry.dispose(); earth = null; }
      const pos = [], nor = [], col = [], unl = [], swp = [], sww = [], idx = [];
      for (const path of P) {
        const pts = path.pts, segs = []; let tot = 0;
        for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push([pts[i - 1], pts[i], tot, l]); tot += l; }
        const at = d => { for (const [a, b, t0, l] of segs) if (d <= t0 + l + 1e-6) { const f = l > 1e-9 ? (d - t0) / l : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, (b[0] - a[0]) / (l || 1), (b[1] - a[1]) / (l || 1)]; } const s = segs[segs.length - 1]; return [s[1][0], s[1][1], (s[1][0] - s[0][0]) / (s[3] || 1), (s[1][1] - s[0][1]) / (s[3] || 1)]; };
        if (path.s === 0 && stones) {   // stepping stones: one every ~1.15 m, side to side, turned + sized by hash
          for (let d = 0.4, j = 0; d < tot && n < STONE_CAP; d += 1.15, j++) {
            const [x0, z0, ux, uz] = at(d), h = hsh(path.k * 7919 + j * 131), side = (j % 2 ? 1 : -1) * (0.22 + 0.18 * h), x = x0 - uz * side, z = z0 + ux * side;
            Q.setFromAxisAngle(Y, h * 6.28); V.set(x, gy(x, z) - 0.02, z); SC.setScalar(1.55 + 0.4 * hsh(j * 977 + path.k));
            stones.m.setMatrixAt(n++, M4.compose(V, Q, SC));
          }
        } else if (path.s === 1) {   // packed earth: a ribbon 1.5 m wide (soft wobbly edge), 0.12 m over the ground
          const step = 0.9, rows = Math.max(2, Math.ceil(tot / step) + 1), base = pos.length / 3;
          for (let r = 0; r < rows; r++) {
            const d = Math.min(tot, r * step), [x0, z0, ux, uz] = at(d);
            for (const sd of [-1, 0, 1]) {
              const w = sd === 0 ? 0 : sd * (0.75 + 0.14 * (hsh(path.k * 31 + r * 7 + sd) - 0.5)), x = x0 - uz * w, z = z0 + ux * w;
              pos.push(x, gy(x, z) + 0.12, z); nor.push(0, 1, 0); swp.push(x, 0, z); sww.push(0); unl.push(0);
              const k = 0.92 + 0.12 * hsh(r * 13 + path.k + sd * 5); CO.copy(sd ? EDGE : EARTH).multiplyScalar(k); col.push(CO.r, CO.g, CO.b);   // (sRGB picks -> linear, like lane A's props)
            }
            if (r) { const a = base + (r - 1) * 3, b = base + r * 3; idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); }   // (counter-clockwise seen from above: the face looks up)
          }
        }
      }
      if (stones) stones.set(n);
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setAttribute('unlit', new THREE.Float32BufferAttribute(unl, 1)); g.setAttribute('swayP', new THREE.Float32BufferAttribute(swp, 3)); g.setAttribute('swayW', new THREE.Float32BufferAttribute(sww, 1));
        g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeBoundingSphere();
        earth = one(g, lit); earth.receiveShadow = true; scene.add(earth);
      }
      api.stats.stones = n; api.stats.earth = earth ? pos.length / 3 : 0;
    }

    // ---- planted trees (per kit piece)
    const treeM = {};
    let treeSig = '', treeT = -1e9;
    function buildTrees(S, t) {
      for (const k in treeM) if (treeM[k]) treeM[k].list = 0;
      for (const it of Land.trees(S)) {
        let tm = treeM[it.piece]; if (tm === undefined) tm = treeM[it.piece] = kitMesh(it.piece, Land.C.PLANT) || null; if (!tm) continue;
        tm.list = tm.list || 0; const pop = born[it.k] !== undefined ? Math.min(1, (t - born[it.k]) / 0.7) : 1, s = it.s * it.size * (pop < 1 ? Math.sin(pop * Math.PI * 0.5) * (1 + 0.25 * Math.sin(pop * Math.PI)) : 1);
        Q.setFromAxisAngle(Y, it.r); V.set(it.x, gy(it.x, it.z) - 0.05, it.z); SC.setScalar(Math.max(0.02, s)); tm.m.setMatrixAt(tm.list++, M4.compose(V, Q, SC));
      }
      for (const k in treeM) if (treeM[k]) treeM[k].set(treeM[k].list || 0);
    }
    const born = {};

    // ---- removed trees: hide the layout's instance by id
    let cutSig = '', cutSet = new Set();
    function syncCut(S) {
      const sig = S.land.cut.join(','); if (sig === cutSig) return; cutSig = sig;
      const now = new Set(S.land.cut);
      for (const b of map.batches) for (const i of b.inst) {
        if (i.pid < 0) continue;
        if (now.has(i.pid) && i.role === 'forest') { i.role = 'cut'; i.wasCut = true; }
        else if (!now.has(i.pid) && i.wasCut) { i.role = 'forest'; i.wasCut = false; }
      }
      cutSet = now; map.invalidate();
    }

    // ---- flower meadows: lane A's clump, a hashed scatter inside each circle (dry, off roads + painted paths)
    const MCAP = PHONE ? 1100 : 1800;
    let mesh = null, mItems = [], mSig = '', camX = 1e9, camZ = 1e9;
    function meadowMesh() {
      if (mesh !== null) return mesh;
      const fk = opt.flowerKit ? opt.flowerKit() : null; if (!fk || !fk.geo) return (mesh = null, null);
      mesh = new THREE.InstancedMesh(fk.geo, fk.mat || lit, MCAP); mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MCAP * 3).fill(1), 3); scene.add(mesh); return mesh;
    }
    function buildMeadows(S) {
      mItems = [];
      for (const m of S.land.meadows) {
        const g = 2.9, n = Math.ceil(m.r / g);
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
          const h = hsh(m.k * 104729 + (i + 50) * 997 + (j + 50) * 31), x = m.x + (i + (h - 0.5) * 0.9) * g, z = m.z + (j + (hsh(h * 1e6 | 0) - 0.5) * 0.9) * g, d = Math.hypot(x - m.x, z - m.z);
          if (d > m.r || (d > m.r * 0.7 && h < (d / m.r - 0.7) * 2.2)) continue;   // a soft, ragged edge
          if (nav.wet(x, z) || nav.roadDist(x, z, 2.4) < 2.2 || (nav.paintDist && nav.paintDist(x, z, 1.6) < 1.4)) continue;
          const f = m.f === 0 ? 1 + Math.floor(h * 3) : m.f;
          mItems.push({ x, y: gy(x, z) - 0.05, z, yaw: h * 40, s: 0.62 + 0.4 * hsh(j * 7 + i * 13 + m.k), tint: TINT[f] });
        }
      }
      camX = 1e9;
    }
    function writeMeadows(cam) {
      const M = meadowMesh(); if (!M) return;
      const cull = PHONE ? 130 : 190; let j = 0;
      for (const it of mItems) {
        if (j >= MCAP) break; if ((it.x - cam.x) * (it.x - cam.x) + (it.z - cam.z) * (it.z - cam.z) > cull * cull) continue;
        Q.setFromAxisAngle(Y, it.yaw); V.set(it.x, it.y, it.z); SC.setScalar(it.s); M.setMatrixAt(j, M4.compose(V, Q, SC)); M.setColorAt(j, CO.setRGB(it.tint[0], it.tint[1], it.tint[2])); j++;
      }
      M.count = j; M.visible = j > 0; M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; api.stats.flowers = j;
    }

    // ---- the brush stroke preview (depth test off, on top): green = fits, red = not here; the bad stretch in red
    const strokeM = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * 600), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * 2 * 600), 3)); g.setDrawRange(0, 0);
      const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false })); m.renderOrder = 7; m.frustumCulled = false; scene.add(m); return m; })();
    const api = { stats: { stones: 0, earth: 0, trees: 0, flowers: 0, cut: 0 } };
    api.stroke = (pts, ok, bad) => {
      const P = strokeM.geometry.attributes.position, A = P.array, Cc = strokeM.geometry.attributes.color.array; let n = 0;
      if (pts) for (let i = 1; i < pts.length && n < 1200; i++) {
        const red = !ok && (bad === undefined || bad === null || i >= bad), c = red ? [1, 0.36, 0.43] : [0.49, 1, 0.66];
        for (const p of [pts[i - 1], pts[i]]) { A[n * 3] = p[0]; A[n * 3 + 1] = gy(p[0], p[1]) + 0.45; A[n * 3 + 2] = p[1]; Cc[n * 3] = c[0]; Cc[n * 3 + 1] = c[1]; Cc[n * 3 + 2] = c[2]; n++; }
      }
      P.needsUpdate = true; strokeM.geometry.attributes.color.needsUpdate = true; strokeM.geometry.setDrawRange(0, n);
    };

    // ---- per frame (cheap: signatures + a 1 s growth tick + meadow re-cull when the camera moved > 12 m)
    let known = null;
    api.update = (S, t, camera) => {
      if (!S || !S.land) return;
      syncCut(S);
      const ps = S.land.paths.map(P => P.k + ':' + P.s + ':' + P.p.length + ':' + P.p[0] + ',' + P.p[P.p.length - 1]).join('|');
      if (ps !== pathSig) { pathSig = ps; buildPaths(S); }
      const ts = S.land.planted.map(x => x.k + ',' + x.t + ',' + x.x + ',' + x.z + ',' + x.r + ',' + x.at).join('|');
      if (ts !== treeSig) { if (known) for (const x of S.land.planted) if (!known.has(x.k)) born[x.k] = t; known = new Set(S.land.planted.map(x => x.k)); treeSig = ts; treeT = -1e9; }
      let anim = false; for (const k in born) { if (t - born[k] < 0.8) anim = true; else delete born[k]; }
      if (anim || t - treeT > 1) { treeT = t; buildTrees(S, t); api.stats.trees = S.land.planted.length; }
      const ms = S.land.meadows.map(m => m.k + ',' + m.x + ',' + m.z + ',' + m.r + ',' + m.f).join('|') + '#' + pathSig;
      if (ms !== mSig) { mSig = ms; buildMeadows(S); }
      const c = camera ? camera.position : { x: TP[0], z: TP[2] };
      if (Math.hypot(c.x - camX, c.z - camZ) > 12) { camX = c.x; camZ = c.z; writeMeadows(c); }
      api.stats.cut = S.land.cut.length;
    };
    // the planted trees' night-glow / light hooks: none (trees have no Glow parts)
    return api;
  }
  window.LandFx = LandFx;
})();
