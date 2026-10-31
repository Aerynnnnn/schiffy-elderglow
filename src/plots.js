// Plots: what the player sees of building. Reads the sim state (S.plots / S.queue) every frame; owns no game state.
//  - empty plot marker = soft outlined patch on the ground (house footprint) + a small sign (+ open, lock = locked,
//    hammer = blueprint), all instanced (5 draw calls for every plot on the island)
//  - homes = the layout's own house instance (map batch, role 'built'); garden / woodshed / stone pile / lantern path =
//    small groups of kit pieces drawn with their own InstancedMeshes (same geometry + material as the map)
//  - building in stages: scaffold (f < SCAF) -> frame (the model rises out of the ground inside the scaffold) -> done
//    (scaffold gone, dust burst). Builders hammering raise dust puffs.
(function () {
  'use strict';
  const SCAF = 0.18;
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, o || {}));
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  // patch: soft fill + dashed rounded outline (white; tinted per instance)
  const PATCH = canvasTex(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 20, w / 2, w / 2, w * 0.62); r.addColorStop(0, 'rgba(255,255,255,.34)'); r.addColorStop(1, 'rgba(255,255,255,.12)');
    rr(g, 14, 14, w - 28, w - 28, 46); g.fillStyle = r; g.fill();
    g.setLineDash([26, 16]); g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,.95)'; rr(g, 14, 14, w - 28, w - 28, 46); g.stroke();
  });
  const SIGN = {};
  for (const k of ['open', 'lock', 'blue']) SIGN[k] = canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = k === 'lock' ? '#c9c2d6' : k === 'blue' ? '#ffd86b' : '#fff6dc'; rr(g, 4, 4, w - 8, h - 8, 16); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#2a2442'; rr(g, 4, 4, w - 8, h - 8, 16); g.stroke();
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 9;
    if (k === 'open') { g.strokeStyle = '#3aa35a'; g.beginPath(); g.moveTo(64, 26); g.lineTo(64, 70); g.moveTo(42, 48); g.lineTo(86, 48); g.stroke(); }
    else if (k === 'lock') { g.strokeStyle = '#2a2442'; g.lineWidth = 7; g.beginPath(); g.arc(64, 40, 13, Math.PI, 0); g.stroke(); g.fillStyle = '#7a6a9a'; rr(g, 44, 40, 40, 32, 6); g.fill(); g.stroke(); }
    else { g.fillStyle = '#8a5a34'; g.save(); g.translate(64, 48); g.rotate(-0.6); g.fillRect(-5, -6, 10, 40); g.fillStyle = '#5b3a26'; g.fillRect(-20, -22, 40, 16); g.restore(); }
  });
  const DUST = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.5, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

  // composite buildings: kit pieces in the plot's frame (x right, z out of the door side), y follows the ground
  // (kit pieces are life-size, the pups are drawn ~3x: pieces here are scaled up to fill a house footprint, ~12 m)
  const COMPOSITE = {
    garden: [['EG_GardenBox', -4.6, -2.8, 0, 2], ['EG_GardenBox', 0, -2.8, 0, 2], ['EG_GardenBox', 4.6, -2.8, 0, 2], ['EG_GardenBox', -4.6, 2.8, 0, 2], ['EG_GardenBox', 0, 2.8, 0, 2], ['EG_GardenBox', 4.6, 2.8, 0, 2],
      ['EG_Bush_A', -8, 0, 0.4, 1.7], ['EG_Bush_B', 8, 0.2, 1.3, 1.6]],
    woodshed: [['EG_MarketStall_A', 0, -1.5, 0, 2.2], ['EG_FallenLog_A', -0.5, 4.2, 0, 0.85], ['EG_FallenLog_B', 0.3, 6.2, 0.05, 0.75], ['EG_Stump', -6.4, 2.6, 0, 2.2], ['EG_Stump', 6.4, 3.2, 1, 1.8]],
    quarry: [['EG_RuneBoulder_A', -2.6, -1, 0.3, 2.2], ['EG_RuneBoulder_B', 3, -1.4, 2.1, 1.8], ['EG_RuneBoulder_B', 0.4, 3, 4.0, 1.2], ['EG_Pebbles', -4.2, 3, 0, 4], ['EG_Pebbles', 4.6, 2.6, 1, 3.5], ['EG_CrystalPillar', 5.2, -4.2, 0, 0.55]],
    // expedition dock (step 3): a trip-planning stall between two beacon braziers + supply logs; the boats + notice
    // board are drawn by src/expedition_fx.js in front of it
    board: [['EG_MarketStall_B', 0, -1.5, 0, 2.2], ['EG_Brazier', -6.2, 3.8, 0, 1.7], ['EG_Brazier', 6.2, 3.8, 0, 1.7], ['EG_FallenLog_A', 5.8, -4.6, 1.57, 0.7],
      ['EG_CrystalPillar', -6, -4.4, 0.4, 0.45], ['EG_GlowShrooms_B', -3.4, 4.6, 0, 1.4]],
    // step 4: music stage (bandstand stall, fairy-ring dance floor, beacon braziers, log benches) and a Greenhold-style
    // conservatory (the faction's own model, small, with garden beds + a wisp tree)
    stage: [['EG_MarketStall_A', 0, -3, 0, 2.4], ['EG_FairyRing', 0, 3.2, 0, 2.3], ['EG_Brazier', -6.4, -3.4, 0, 1.7], ['EG_Brazier', 6.4, -3.4, 0, 1.7],
      ['EG_FallenLog_A', -7.2, 4.4, 1.57, 0.6], ['EG_FallenLog_B', 7.2, 4.2, 1.57, 0.6], ['EG_GlowShrooms_A', -3.5, -6.5, 0, 1.3], ['EG_GlowShrooms_B', 3.5, -6.5, 1, 1.2]],
    conserv: [['EG_Greenhold', 0, -1, 0, 0.3], ['EG_GardenBox', -6.4, 4.2, 0, 1.8], ['EG_GardenBox', 6.4, 4.2, 0, 1.8], ['EG_WispTree_A', -7, -4, 0, 0.9], ['EG_GlowShrooms_B', 6.6, -4.4, 0, 1.4]],
    lantern: [['EG_Brazier', -5.5, -4, 0, 1.6], ['EG_Brazier', 5.5, -4, 0, 1.6], ['EG_Brazier', -5.5, 4, 0, 1.6], ['EG_Brazier', 5.5, 4, 0, 1.6], ['EG_FairyRing', 0, 0, 0, 1.7], ['EG_GlowShrooms_A', 0, -4.8, 0, 1.5], ['EG_GlowShrooms_B', 0, 4.8, 2, 1.4]],
  };

  function Plots(scene, map, nav, ground) {
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), CO = new THREE.Color();
    // ---- per plot: footprint (house batch box), frame, ground height
    const info = nav.plots.map(q => {
      const b = batchOf[q.piece];
      let w = 10, d = 10, h = 7, cx = 0, cz = 0;
      if (b) { const bx = b.box; w = (bx.max.x - bx.min.x) * q.s; d = (bx.max.z - bx.min.z) * q.s; h = (bx.max.y - Math.max(0, bx.min.y)) * q.s; cx = (bx.max.x + bx.min.x) / 2 * q.s; cz = (bx.max.z + bx.min.z) / 2 * q.s; }
      if (q.kind === 'market') { w = d = 46; h = 6; }
      w = Math.min(w, 60); d = Math.min(d, 60);
      const cs = Math.cos(q.ry), sn = Math.sin(q.ry);
      const c = [q.pos[0] + cx * cs + cz * sn, q.pos[2] - cx * sn + cz * cs];   // rotation.y of (cx, 0, cz)
      const gy = ground(c[0], c[1], q.pos[1]);
      // the plot's own layout model(s): the house / faction hall instance; the market square = every layout piece of role market
      const inst = []; for (const bb of map.batches) for (const i of bb.inst) if (q.pid >= 0 ? i.pid === q.pid : (q.kind === 'market' && i.pid >= 0 && map.layout.placements[i.pid] && map.layout.placements[i.pid].role === 'market')) inst.push({ b: bb, i, m0: i.m.clone(), role0: i.role });
      return { q, w: Math.max(6, w), d: Math.max(6, d), h: Math.max(3, h), c, gy, inst, state: '', k: -1, show: q.pos[1] < 25 || q.kind !== 'house' };
    });
    const byPid = {}; info.forEach(x => { byPid[x.q.pid] = x; });

    // ---- markers (instanced): patch + post + 3 sign faces
    const N = info.length;
    const patch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: PATCH, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), N);
    patch.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); patch.renderOrder = 1; patch.frustumCulled = false; scene.add(patch);
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 6).translate(0, 1.6, 0), toon(0x8a5a34), N); post.castShadow = true; post.frustumCulled = false; scene.add(post);
    const boardGeo = new THREE.PlaneGeometry(2.6, 1.95);
    const boards = {}; for (const k in SIGN) { const m = new THREE.InstancedMesh(boardGeo, new THREE.MeshBasicMaterial({ map: SIGN[k], side: THREE.DoubleSide, transparent: true, alphaTest: 0.3 }), N); m.frustumCulled = false; scene.add(m); boards[k] = m; }
    const COL = { open: 0xfff2c0, lock: 0xb8b0c8, blue: 0xffcc33, build: 0xffb347, sel: 0x7dfcff };

    // ---- composite pieces (own instanced meshes per kit piece)
    const extra = {};
    function extraMesh(key) {
      if (extra[key] !== undefined) return extra[key];
      const b = batchOf[key]; if (!b || !b.geo) return (extra[key] = null);
      const m = new THREE.InstancedMesh(b.geo, b.mesh.material, 48); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
      let ink = null; if (b.inkMesh && b.ink) { ink = new THREE.InstancedMesh(b.ink, b.inkMesh.material, 48); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.frustumCulled = false; scene.add(ink); }
      const see = b.see.map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, 48); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = false; scene.add(im); return im; });
      return (extra[key] = { m, ink, see, h: Math.max(0.5, b.box.max.y), list: [] });
    }

    // ---- scaffold: one instanced unit box for every pole / rail of every site
    const scaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), toon(0xb07a45), 600); scaf.count = 0; scaf.castShadow = true; scaf.frustumCulled = false; scene.add(scaf);
    function scaffoldInto(x, list, hgt) {   // poles at the corners + along the sides, rails at 1/3 + 2/3 + top
      const hw = x.w / 2 + 1, hd = x.d / 2 + 1, cs = Math.cos(x.q.ry), sn = Math.sin(x.q.ry);
      const put = (lx, lz, ly, sx, sy, sz, rot) => list.push([x.c[0] + lx * cs + lz * sn, x.gy + ly, x.c[1] - lx * sn + lz * cs, sx, sy, sz, x.q.ry + (rot || 0)]);
      const nx = Math.max(1, Math.round(x.w / 5)), nz = Math.max(1, Math.round(x.d / 5));
      for (let i = 0; i <= nx; i++) for (const z of [-hd, hd]) put(-hw + 2 * hw * i / nx, z, 0, 0.32, hgt, 0.32);
      for (let i = 1; i < nz; i++) for (const xx of [-hw, hw]) put(xx, -hd + 2 * hd * i / nz, 0, 0.32, hgt, 0.32);
      for (const fr of [0.34, 0.67, 0.98]) {
        if (hgt < x.h * fr * 1.05) continue;
        const y = x.h * 1.05 * fr;
        for (const z of [-hd, hd]) put(0, z, y, 2 * hw + 0.4, 0.22, 0.26);
        for (const xx of [-hw, hw]) put(xx, 0, y, 0.26, 0.22, 2 * hd + 0.4);
      }
    }

    // ---- dust puffs
    const puffs = [], pool = [];
    function puff(x, y, z, big) {
      const s = pool.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ map: DUST, color: 0xc9a77c, transparent: true, depthWrite: false }));
      s.position.set(x, y, z); s.userData = { t: 0, life: big ? 1.8 : 1.2, s0: big ? 4 : 2.4, vy: big ? 2.2 : 1.2, vx: (Math.random() - 0.5) * (big ? 4 : 1.2), vz: (Math.random() - 0.5) * (big ? 4 : 1.2) };
      scene.add(s); puffs.push(s);
    }
    function burst(x) { for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; puff(x.c[0] + Math.cos(a) * x.w * 0.55, x.gy + 0.6, x.c[1] + Math.sin(a) * x.d * 0.55, true); } }

    // world matrix of a plot-frame piece (lx, lz, extra yaw, scale), lifted by dy
    function pieceM(x, lx, lz, yaw, s, dy) {
      const cs = Math.cos(x.q.ry), sn = Math.sin(x.q.ry), wx = x.c[0] + lx * cs + lz * sn, wz = x.c[1] - lx * sn + lz * cs;
      Q.setFromAxisAngle(Y, x.q.ry + yaw); V.set(wx, ground(wx, wz, x.q.pos[1]) + dy, wz); SC.setScalar(s); return M4.compose(V, Q, SC);
    }
    let builtOn = false;
    const api = { info, byPid, sel: null, SCAF };
    // house instance: grows up out of its footprint (y scale sy, base on the ground) or restore / hide
    const SY = new THREE.Matrix4();
    function setHome(x, vis, sy) {
      if (!builtOn) { map.setRole('built', true); builtOn = true; }
      for (const r of x.inst) {
        if (!vis) { r.i.role = r.role0; r.i.m.copy(r.m0); }
        else { r.i.role = 'built'; r.i.m.copy(r.m0).multiply(SY.makeScale(1, sy, 1)); }
        r.i.c.copy(r.b.center).applyMatrix4(r.i.m);
      }
      map.invalidate();
    }

    let dustT = 0;
    // S = sim state; pupsPose(i) -> pose; dt seconds
    api.update = (S, t, dt, level, poses) => {
      // 1. per plot state
      const sites = [];
      let mi = 0; const bi = { open: 0, lock: 0, blue: 0 };
      for (const x of info) {
        const e = S.plots[x.q.pid];
        const f = e ? (e.done ? 1 : Math.min(1, e.prog / Math.max(1, Sim.workOf(e.type, x.q)))) : 0;
        const st = !e ? (x.q.lv <= level ? 'open' : 'lock') : e.done ? 'done' : e.paid && f > 0 ? 'build' : 'blue';
        x.f = f; x.type = e ? e.type : null;
        // markers: open plots up to one ring further than reached (locked), factions / market always (when on the ground)
        const showMarker = x.show && st !== 'done' && st !== 'build' && (st !== 'lock' || x.q.lv <= level + 1 || x.q.kind !== 'house');
        if (showMarker || st === 'build') {
          Q.setFromAxisAngle(Y, x.q.ry); V.set(x.c[0], x.gy + 0.08, x.c[1]); SC.set(x.w + 2.5, 1, x.d + 2.5); patch.setMatrixAt(mi, M4.compose(V, Q, SC));
          patch.setColorAt(mi, CO.setHex(api.sel === x.q.pid ? COL.sel : (COL[st] || COL.open))); mi++;
        }
        if (showMarker) {
          // sign: at the door side corner, facing out
          const o = x.q.out, side = [-o[1], o[0]], hw = x.w / 2 + 1.6;
          const sx = x.q.door[0] + o[0] * 4 + side[0] * Math.min(hw, 6), sz = x.q.door[2] + o[1] * 4 + side[1] * Math.min(hw, 6), sy = ground(sx, sz, x.gy);
          const k = st === 'lock' ? 'lock' : st === 'blue' ? 'blue' : 'open', j = bi[k]++;
          Q.setFromAxisAngle(Y, Math.atan2(o[0], o[1])); V.set(sx, sy, sz); SC.setScalar(1); post.setMatrixAt(bi.open + bi.lock + bi.blue - 1, M4.compose(V, Q, SC));
          V.set(sx, sy + 3.3, sz); boards[k].setMatrixAt(j, M4.compose(V, Q, SC));
          x.sign = [sx, sy + 3.3, sz];
        } else x.sign = null;
        x.marker = showMarker; x.st = st;
        if (st === 'build' || st === 'blue' || st === 'done') sites.push(x);
        else if (x.state !== st) { if (x.state === 'done' || x.state === 'build' || x.state === 'rise') { if (x.inst.length) setHome(x, false, 0); } x.state = st; }
      }
      patch.count = mi; patch.instanceMatrix.needsUpdate = true; if (patch.instanceColor) patch.instanceColor.needsUpdate = true;
      post.count = bi.open + bi.lock + bi.blue; post.instanceMatrix.needsUpdate = true;
      for (const k in boards) { boards[k].count = bi[k]; boards[k].instanceMatrix.needsUpdate = true; }
      // 2. buildings: homes move their own map instance; composites fill the extra meshes; scaffold for sites in progress
      for (const k in extra) if (extra[k]) extra[k].list.length = 0;
      const sc = [];
      for (const x of sites) {
        const rising = x.st === 'build' ? Math.max(0, (x.f - SCAF) / (1 - SCAF)) : x.st === 'done' ? 1 : -1;
        if (x.st === 'done' && x.state === 'build') burst(x);
        const sy = rising < 0 ? 0 : Math.max(0.06, rising * (2 - rising));   // ease-out: walls shoot up, the roof settles
        if ((x.type === 'home' || (Sim.C.B[x.type] && Sim.C.B[x.type].piece)) && x.inst.length) {   // cottages + faction halls + the market: their own layout model rises
          const key = rising < 0 ? -1 : Math.round(sy * 200);
          if (x.k !== key || x.state !== x.st) { if (rising < 0) setHome(x, false, 1); else setHome(x, true, sy); x.k = key; }
        } else if (rising >= 0) {
          const parts = COMPOSITE[x.type] || [];
          for (const [piece, lx, lz, yaw, s] of parts) {
            const em = extraMesh(piece); if (!em) continue;
            em.list.push(pieceM(x, lx, lz, yaw, s, 0).clone().multiply(SY.makeScale(1, sy, 1)));
          }
        }
        if (x.st === 'build') scaffoldInto(x, sc, Math.min(1, x.f / SCAF) * x.h * 1.05);
        x.state = x.st;
      }
      for (const k in extra) {
        const em = extra[k]; if (!em) continue;
        em.list.forEach((m, j) => em.m.setMatrixAt(j, m)); em.m.count = em.list.length; em.m.instanceMatrix.needsUpdate = true;
        if (em.ink) em.ink.count = em.list.length; em.see.forEach(s => { s.count = em.list.length; });
      }
      sc.forEach((a, j) => {
        Q.setFromAxisAngle(Y, a[6]); if (a[7]) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a[7]));
        V.set(a[0], a[1], a[2]); SC.set(a[3], a[4], a[5]); scaf.setMatrixAt(j, M4.compose(V, Q, SC));
      });
      scaf.count = Math.min(600, sc.length); scaf.instanceMatrix.needsUpdate = true;
      // 3. dust while builders hammer
      dustT += dt;
      if (dustT > 0.35) {
        dustT = 0;
        for (const ps of poses) if (ps.phase === 'build') puff(ps.p[0] + (Math.random() - 0.5) * 3, (ps.y || ps.p[1]) + 0.4, ps.p[2] + (Math.random() - 0.5) * 3, false);
      }
      for (let k = puffs.length - 1; k >= 0; k--) {
        const s = puffs[k], u = s.userData; u.t += dt; const a = u.t / u.life;
        if (a >= 1) { scene.remove(s); puffs.splice(k, 1); pool.push(s); continue; }
        s.position.x += u.vx * dt; s.position.y += u.vy * dt * (1 - a); s.position.z += u.vz * dt;
        s.scale.setScalar(u.s0 * (0.6 + a * 1.4)); s.material.opacity = 0.9 * (1 - a * a);
      }
    };
    // screen-space pick: nearest marker / site centre (or its sign) within reach -> plot info
    api.pick = (mx, my, camera, W, H, reach) => {
      let best = null, bd = Infinity; const v = new THREE.Vector3();
      for (const x of info) {
        if (!x.marker && x.st !== 'build' && x.st !== 'done') continue;
        if (x.st === 'done' && !x.inst.length && !x.type) continue;
        for (const p of [[x.c[0], x.gy + 1, x.c[1]], x.sign].filter(Boolean)) {
          v.set(p[0], p[1], p[2]).project(camera); if (v.z > 1) continue;
          const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H, d = Math.hypot(sx - mx, sy - my);
          // reach grows with the patch's size on screen
          const e = new THREE.Vector3(x.c[0] + x.w / 2, x.gy + 1, x.c[1]).project(camera), rpx = Math.abs((e.x + 1) / 2 * W - sx);
          if (d < Math.max(reach, rpx * 0.9) && d < bd) { bd = d; best = x; }
        }
      }
      return best;
    };
    api.burst = burst;
    // day / night: the game's own building pieces that have Glow* parts (braziers, shrooms, fairy rings...) as light
    // sources: fn(kit key, world matrix, stable id); plot signs + patches dim at night (they are unlit)
    api.glowPieces = fn => { for (const k in extra) { const em = extra[k]; if (!em || !batchOf[k].glow || !Object.keys(batchOf[k].glow).length) continue; em.list.forEach((m, j) => fn(k, m, 'plot:' + k + ':' + j)); } };
    let nightK = -1;
    api.setNight = n => {
      const k = Math.round(n * 50) / 50; if (k === nightK) return; nightK = k;
      const c = 1 - 0.42 * k; for (const b in boards) boards[b].material.color.setRGB(c, c, c * 1.05); patch.material.color.setRGB(c, c, c * 1.05);
    };
    return api;
  }
  window.Plots = Plots;
})();
