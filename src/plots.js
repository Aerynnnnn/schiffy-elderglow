// Plots: what the player sees of building. Reads the sim state (S.plots / S.queue) every frame; owns no game state.
//  - empty plot marker = soft outlined patch on the ground (house footprint) + a small sign (+ open, lock = locked,
//    hammer = blueprint), all instanced (5 draw calls for every plot on the island). Vibe pass 1: that strong look shows
//    only while building (api.build = the plot menu is open; the selected plot always). Otherwise a calm look: a worn
//    patch (grey outside the restored colour, warm earth inside) + foundation stones (kit pebbles, map material) round
//    it with a gap at the door side; blueprint signs stay. Tap targets unchanged (pick = patch centre + size).
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
  // vibe pass 1: the CALM look of an empty plot (when the player is not building): a soft worn patch of earth with a few
  // darker scuffs, no outline. Drawn in neutral greys; the instance colour tints it (grey outside the restored colour,
  // a warm earth tone inside). The foundation stones around it are kit pebbles (map material: lit, inked, greyed / coloured
  // by the colour restoring like the rest of the world).
  const CALM = canvasTex(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w * 0.5); r.addColorStop(0, 'rgba(70,60,50,.15)'); r.addColorStop(0.6, 'rgba(70,60,50,.11)'); r.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 18; k++) { const x = w * (0.22 + rnd() * 0.56), y = w * (0.22 + rnd() * 0.56), rr0 = 10 + rnd() * 22; const q = g.createRadialGradient(x, y, 0, x, y, rr0); q.addColorStop(0, `rgba(50,42,36,${0.03 + rnd() * 0.04})`); q.addColorStop(1, 'rgba(50,42,36,0)'); g.fillStyle = q; g.beginPath(); g.arc(x, y, rr0, 0, Math.PI * 2); g.fill(); }
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
    // vibe pass 2: a pup corner (the pups' own idea on a grown island): log benches round a little fire bowl, planters,
    // a stump seat, flowers + glow shrooms
    nook: [['EG_FallenLog_B', -3.4, 0.8, 1.35, 0.8], ['EG_FallenLog_A', 3.3, 1.2, 1.85, 0.72], ['EG_Brazier', 0, -0.2, 0, 1.45], ['EG_GardenBox', -5.0, -4.2, 0.1, 2.0],
      ['EG_GardenBox', 4.6, -4.4, -0.1, 2.0], ['EG_Stump', 0.3, 4.2, 0.6, 2.0], ['EG_GlowShrooms_B', -6.0, 3.6, 0.8, 1.5], ['EG_Bush_B', 6.6, 3.4, 2.1, 1.3], ['EG_Bush_A', -6.4, -0.6, 0.4, 1.1]],
    lantern: [['EG_Brazier', -5.5, -4, 0, 1.6], ['EG_Brazier', 5.5, -4, 0, 1.6], ['EG_Brazier', -5.5, 4, 0, 1.6], ['EG_Brazier', 5.5, 4, 0, 1.6], ['EG_FairyRing', 0, 0, 0, 1.7], ['EG_GlowShrooms_A', 0, -4.8, 0, 1.5], ['EG_GlowShrooms_B', 0, 4.8, 2, 1.4]],
  };

  function Plots(scene, map, nav, ground) {
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), CO = new THREE.Color();
    // ---- per plot: footprint (house batch box), frame, ground height. fit() again when a home turns / swaps its piece
    // (creative build part 2, src/homes.js: nav.setHomes changes the plot's piece / ry / door in place)
    function fit(x) {
      const q = x.q, b = batchOf[q.piece];
      let w = 10, d = 10, h = 7, cx = 0, cz = 0;
      if (b) { const bx = b.box; w = (bx.max.x - bx.min.x) * q.s; d = (bx.max.z - bx.min.z) * q.s; h = (bx.max.y - Math.max(0, bx.min.y)) * q.s; cx = (bx.max.x + bx.min.x) / 2 * q.s; cz = (bx.max.z + bx.min.z) / 2 * q.s; }
      if (q.kind === 'market') { w = d = 46; h = 6; }
      w = Math.min(w, 60); d = Math.min(d, 60);
      const cs = Math.cos(q.ry), sn = Math.sin(q.ry);
      x.c = [q.pos[0] + cx * cs + cz * sn, q.pos[2] - cx * sn + cz * cs];   // rotation.y of (cx, 0, cz)
      x.gy = ground(x.c[0], x.c[1], q.pos[1]); x.w = Math.max(6, w); x.d = Math.max(6, d); x.h = Math.max(3, h);
      x.fitK = q.piece + ',' + q.ry + ',' + q.pos[0] + ',' + q.pos[2];
      return x;
    }
    function mkInfo(q) {
      // the plot's own layout model(s): the house / faction hall instance; the market square = every layout piece of role market
      const inst = []; if (!q.free) for (const bb of map.batches) for (const i of bb.inst) if (q.pid >= 0 ? i.pid === q.pid : (q.kind === 'market' && i.pid >= 0 && map.layout.placements[i.pid] && map.layout.placements[i.pid].role === 'market')) inst.push({ b: bb, i, m0: i.m.clone(), role0: i.role });
      return fit({ q, inst, state: '', k: -1, show: q.pos[1] < 25 || q.kind !== 'house' || !!q.free });
    }
    const info = nav.plots.map(mkInfo);
    const byPid = {}; info.forEach(x => { byPid[x.q.pid] = x; });
    // free homes come + go with the island (nav.freePlots() = this island's, Sim.step keeps the nav in sync)
    function syncInfo() {
      const fq = nav.freePlots ? nav.freePlots() : [];
      for (let i = info.length - 1; i >= 0; i--) { const x = info[i]; if (x.q.free && (!fq.includes(x.q) || byPid[x.q.pid] !== x)) { info.splice(i, 1); if (byPid[x.q.pid] === x) delete byPid[x.q.pid]; } }
      for (const q of fq) if (!byPid[q.pid] && info.length < CAP) { const x = mkInfo(q); info.push(x); byPid[q.pid] = x; }
      for (const x of info) { const q = x.q; if (x.fitK !== q.piece + ',' + q.ry + ',' + q.pos[0] + ',' + q.pos[2]) fit(x); }
    }

    // ---- markers (instanced): patch + post + 3 sign faces (room for the free homes too)
    const CAP = info.length + 16, N = CAP;
    const patch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: PATCH, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), N);
    patch.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); patch.renderOrder = 1; patch.frustumCulled = false; scene.add(patch);
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 6).translate(0, 1.6, 0), toon(0x8a5a34), N); post.castShadow = true; post.frustumCulled = false; scene.add(post);
    const boardGeo = new THREE.PlaneGeometry(2.6, 1.95);
    const boards = {}; for (const k in SIGN) { const m = new THREE.InstancedMesh(boardGeo, new THREE.MeshBasicMaterial({ map: SIGN[k], side: THREE.DoubleSide, transparent: true, alphaTest: 0.3 }), N); m.frustumCulled = false; scene.add(m); boards[k] = m; }
    const COL = { open: 0xfff2c0, lock: 0xb8b0c8, blue: 0xffcc33, build: 0xffb347, sel: 0x7dfcff };
    // vibe pass 1: calm markers (worn patch + foundation stones) unless the player is building (api.build = the plot menu is open)
    const calmPatch = new THREE.InstancedMesh(patch.geometry, new THREE.MeshBasicMaterial({ map: CALM, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), N);
    calmPatch.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); calmPatch.renderOrder = 1; calmPatch.frustumCulled = false; scene.add(calmPatch);
    // vibe pass 2: the 7 scattered pebbles read as gravel. Now an empty plot is a PROMISE: a low mossy stone foundation round
    // the footprint (a gap at the door, corner stones; map material = greyed / coloured / snowed like the world; one merged
    // mesh for every empty plot, rebuilt when that set changes) + a faint GHOST of a cottage standing on it (one instanced
    // draw, fresnel rim, warm by day / soft cyan at night, fainter on locked land). The dashed outline stays build-mode only.
    const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
    let stoneSig = '';
    const GREY = new THREE.Color(0x9a978f), EARTH = new THREE.Color(0xb29a74), CK = new THREE.Color();
    const litMat = batchOf.EG_Pebbles && batchOf.EG_Pebbles.mesh ? batchOf.EG_Pebbles.mesh.material : null;
    const FMAT = {}; const fm = (hex) => FMAT[hex] || (FMAT[hex] = (() => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.name = 'Found'; m.color.convertSRGBToLinear(); return m; })());
    const FBOX = new THREE.BoxGeometry(1, 1, 1);
    const found = { m: null, ink: null };
    function foundationInto(root, x) {   // plot frame: x right, z out of the door side; local pieces placed with the plot's yaw
      const hw = x.w / 2 + 0.4, hd = x.d / 2 + 0.4, big = Math.max(x.w, x.d) > 24, pid = x.q.pid + 1, T = big ? 1.5 : 0.9, Hh = big ? 0.6 : 0.42;
      const cs = Math.cos(x.q.ry), sn = Math.sin(x.q.ry);
      const put = (lx, lz, w, h, d, hex, yaw, dy) => {
        const wx = x.c[0] + lx * cs + lz * sn, wz = x.c[1] - lx * sn + lz * cs, m = new THREE.Mesh(FBOX, fm(hex));
        m.position.set(wx, ground(wx, wz, x.gy) + h / 2 - 0.12 + (dy || 0), wz); m.rotation.y = x.q.ry + (yaw || 0); m.scale.set(w, h, d); root.add(m);
      };
      const STONE = 0x9d998f, STONE2 = 0x8b877e, MOSS = 0x7fae5c;
      // sill runs (back + two sides whole; the door side in two parts with a gap), slightly broken into blocks
      const run = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / (big ? 6 : 3.4))), yaw = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k < n; k++) { const f0 = k / n, f1 = (k + 1) / n, gap = 0.18, r = hsh(pid * 97 + Math.round(ax * 3) + k * 13);
          const cx = ax + (bx - ax) * (f0 + f1) / 2, cz = az + (bz - az) * (f0 + f1) / 2, len = L / n - gap;
          if (r < 0.12) continue;   // a block missing here and there: old, not new
          put(cx, cz, len, Hh * (0.8 + r * 0.4), T, r < 0.5 ? STONE : STONE2, yaw);
          if (r > 0.55) put(cx + (r - 0.75) * len * 0.5, cz, len * 0.45, 0.14, T * 1.05, MOSS, yaw, Hh * (0.8 + r * 0.4) / 2 + 0.02);   // moss on top
        } };
      const door = big ? 6 : 3.2;
      run(-hw, -hd, hw, -hd); run(-hw, -hd, -hw, hd); run(hw, -hd, hw, hd); run(-hw, hd, -door, hd); run(door, hd, hw, hd);
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { const r = hsh(pid * 31 + Math.round(lx + lz)); put(lx, lz, T * 1.45, Hh * 1.7, T * 1.45, STONE2, r); put(lx, lz, T * 1.05, 0.18, T * 1.05, MOSS, r, Hh * 0.85 + 0.09); }
    }
    function rebuildFoundations(pids) {
      for (const k of ['m', 'ink']) if (found[k]) { scene.remove(found[k]); found[k].geometry.dispose(); found[k] = null; }
      if (!pids.length || !litMat || !ElderMap.kitBatch) return;
      const root = new THREE.Group(); for (const pid of pids) if (byPid[pid].q.kind !== 'market') foundationInto(root, byPid[pid]);
      const b = ElderMap.kitBatch('plots:found', root, null, false); if (!b || !b.geo) return;
      // 1-instance InstancedMesh: the map's lit / ink materials are only ever used instanced (src/world_fx.js note)
      found.m = new THREE.InstancedMesh(b.geo, litMat, 1); found.m.setMatrixAt(0, new THREE.Matrix4()); found.m.receiveShadow = true; found.m.frustumCulled = false; scene.add(found.m);
      if (b.ink) { found.ink = new THREE.InstancedMesh(b.ink, ElderMap.inkMat, 1); found.ink.instanceMatrix = found.m.instanceMatrix; found.ink.frustumCulled = false; scene.add(found.ink); }
    }
    // the ghost cottage: a unit body + gable roof + chimney (base at y 0), scaled to the plot
    const ghostGeo = (() => {
      const body = new THREE.BoxGeometry(1, 0.56, 1).translate(0, 0.28, 0);
      const roof = new THREE.CylinderGeometry(0.62, 0.62, 1.12, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.62, 1).translate(0, 0.56 + 0.19, 0);
      const chim = new THREE.BoxGeometry(0.13, 0.32, 0.13).translate(0.26, 0.86, -0.18);
      const parts = [body, roof, chim].map(g => g.toNonIndexed()); const pos = [], nrm = [];
      for (const g of parts) { pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); return g;
    })();
    const GU = { uNight: { value: 0 }, uK: { value: 1 } };
    const ghostMat = new THREE.ShaderMaterial({ uniforms: GU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vI; varying float vY;
        void main() {
          mat4 im = mat4(1.0); vI = 1.0;
          #ifdef USE_INSTANCING
            im = instanceMatrix;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vI = instanceColor.r;
          #endif
          vec4 wp = modelMatrix * im * vec4(position, 1.0); vN = normalize(mat3(modelMatrix * im) * normal); vV = cameraPosition - wp.xyz; vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `uniform float uNight, uK; varying vec3 vN; varying vec3 vV; varying float vI; varying float vY;
        void main() {
          vec3 n = normalize(vN), v = normalize(vV); float rim = 1.0 - abs(dot(n, v));
          float a = (0.04 + 0.36 * pow(rim, 2.2)) * uK * vI * (0.55 + 0.45 * smoothstep(0.0, 0.5, vY)) * smoothstep(8.0, 30.0, length(vV)) * (1.0 - 0.75 * smoothstep(170.0, 420.0, length(vV)));   // far away: a grid of pale boxes read as zoning again
          vec3 c = mix(vec3(1.0, 0.95, 0.82), vec3(0.7, 0.86, 0.95), uNight);
          gl_FragColor = vec4(c, a * (1.0 - uNight * 0.55));   // night: a whisper (bright glass boxes on a dark island read as holograms)
        }` });
    const ghost = new THREE.InstancedMesh(ghostGeo, ghostMat, N); ghost.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3).fill(1), 3);
    ghost.count = 0; ghost.renderOrder = 2; ghost.frustumCulled = false; scene.add(ghost);

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

    // ---- creative build part 2, buildings (src/homes.js): a home in the player's colours, turned, with another roof (piece) or
    // standing on open land is drawn HERE (its layout instance stays hidden): one InstancedMesh per house piece with the map's
    // own lit material + 3 per-instance palette colours. Each vertex knows its part from its kit material colour (roof moss /
    // shingles, plaster walls, plank trim; measured once per piece) and keeps its shade within the part. Glow parts (warm
    // windows) are never repainted; colour restoring, seasons + snow, the night grade all stay the map shader's.
    const lin = h => new THREE.Color(h).convertSRGBToLinear(), lum = c => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    // [part 1 roof / 2 walls / 3 trim, kit colour, the colour its shade is measured against, only above this share of the height]
    const PARTS = [[1, 0x5DA65A, 0x5DA65A], [1, 0x8C5A48, 0x8C5A48], [1, 0x6A4236, 0x8C5A48], [1, 0x6FBF5A, 0x5DA65A, 0.45], [1, 0x4A8A4E, 0x5DA65A],
      [2, 0xE6D9BC, 0xE6D9BC], [2, 0xF2E8D2, 0xE6D9BC], [3, 0xB07A4E, 0xB07A4E], [3, 0x98663F, 0xB07A4E], [3, 0x7A5236, 0xB07A4E]]
      .map(([p, h, r, yk]) => ({ p, c: lin(h), shade: lum(lin(h)) / lum(lin(r)), yk }));
    const PALC = window.Homes ? Homes.PAL.map(p => [lin(p.roof), lin(p.wall), lin(p.trim)]) : [];
    const palStats = {};
    function pkOf(b) {
      const col = b.geo.attributes.color, pos = b.geo.attributes.position, un = b.geo.attributes.unlit, n = col.count, a = new Float32Array(n * 2), H = Math.max(0.5, b.box.max.y), st = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        if (un && un.getX(i) > 0.5) { st[0]++; continue; }
        const r = col.getX(i), g = col.getY(i), bl = col.getZ(i);
        const P = PARTS.find(P => Math.abs(P.c.r - r) < 0.012 && Math.abs(P.c.g - g) < 0.012 && Math.abs(P.c.b - bl) < 0.012 && (!P.yk || pos.getY(i) > P.yk * H));
        if (P) { a[2 * i] = P.p; a[2 * i + 1] = P.shade; st[P.p]++; } else st[0]++;
      }
      palStats[b.key] = { none: st[0], roof: st[1], wall: st[2], trim: st[3] }; return a;
    }
    let palM = null;
    function palMat() {
      if (palM) return palM; const base = batchOf.EG_House_A && batchOf.EG_House_A.mesh && batchOf.EG_House_A.mesh.material; if (!base) return null;
      palM = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: base.gradientMap, vertexColors: true });
      palM.onBeforeCompile = s => {
        base.onBeforeCompile(s);
        s.vertexShader = 'attribute vec2 pk;\nattribute vec3 pRoof;\nattribute vec3 pWall;\nattribute vec3 pTrim;\n' + s.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
          if (pk.x > 0.5) { vec3 pc = pk.x < 1.5 ? pRoof : (pk.x < 2.5 ? pWall : pTrim); if (pc.r >= 0.0) vColor.xyz = pc * pk.y; }`);
      };
      palM.customProgramCacheKey = () => 'eg-home-pal'; return palM;
    }
    const homes = {}, HC = 48;
    function homeMesh(key) {
      if (homes[key] !== undefined) return homes[key];
      const b = batchOf[key]; if (!b || !b.geo || !palMat()) return (homes[key] = null);
      const g = new THREE.BufferGeometry(); for (const k in b.geo.attributes) g.setAttribute(k, b.geo.attributes[k]); g.setIndex(b.geo.index); g.boundingSphere = b.geo.boundingSphere; g.boundingBox = b.geo.boundingBox;
      g.setAttribute('pk', new THREE.BufferAttribute(pkOf(b), 2));
      const at = () => new THREE.InstancedBufferAttribute(new Float32Array(HC * 3).fill(-1), 3), pr = at(), pw = at(), pt = at();
      g.setAttribute('pRoof', pr); g.setAttribute('pWall', pw); g.setAttribute('pTrim', pt);
      const m = new THREE.InstancedMesh(g, palMat(), HC); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
      let ink = null; if (b.inkMesh && b.ink) { ink = new THREE.InstancedMesh(b.ink, b.inkMesh.material, HC); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.frustumCulled = false; scene.add(ink); }
      const see = b.see.map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, HC); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = false; scene.add(im); return im; });
      return (homes[key] = { m, ink, see, pr, pw, pt, list: [] });
    }
    // a free home stands on the lowest ground under its footprint corners (never a floating corner)
    function homeY(x) {
      const q = x.q; if (!q.free) return q.pos[1];
      let y = ground(q.pos[0], q.pos[2], q.pos[1]); const hw = x.w / 2 * 0.8, hd = x.d / 2 * 0.8, cs = Math.cos(q.ry), sn = Math.sin(q.ry);
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { const wx = x.c[0] + lx * cs + lz * sn, wz = x.c[1] - lx * sn + lz * cs; y = Math.min(y, ground(wx, wz, y)); }
      return y - 0.1;
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
    const api = { info, byPid, sel: null, SCAF, build: false };   // build = the plot menu is open: strong outlines + signs (vibe pass 1)
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
      syncInfo();
      const sites = [], BUILD = !!api.build, sigA = [];
      let mi = 0, ci = 0, gi = 0; const bi = { open: 0, lock: 0, blue: 0 };
      const RU = window.ElderMap && ElderMap.uRest ? ElderMap.uRest.value : null, RC = window.ElderMap && ElderMap.uRestC ? ElderMap.uRestC.value : null;
      for (const x of info) {
        const e = S.plots[x.q.pid];
        const f = e ? (e.done ? 1 : Math.min(1, e.prog / Math.max(1, Sim.workOf(e.type, x.q)))) : 0;
        const st = !e ? (x.q.lv <= level ? 'open' : 'lock') : e.done ? 'done' : e.paid && f > 0 ? 'build' : 'blue';
        x.f = f; x.type = e ? e.type : null;
        // markers: open plots up to one ring further than reached (locked), factions / market always (when on the ground)
        const showMarker = x.show && st !== 'done' && st !== 'build' && (st !== 'lock' || x.q.lv <= level + 1 || x.q.kind !== 'house');
        if (showMarker || st === 'build') {
          Q.setFromAxisAngle(Y, x.q.ry); V.set(x.c[0], x.gy + 0.08, x.c[1]); SC.set(x.w + 2.5, 1, x.d + 2.5); M4.compose(V, Q, SC);
          // strong dashed outline only while building (plot menu open) or for the selected plot
          if (BUILD || api.sel === x.q.pid) { patch.setMatrixAt(mi, M4); patch.setColorAt(mi, CO.setHex(api.sel === x.q.pid ? COL.sel : (COL[st] || COL.open))); mi++; }
          // calm worn patch: grey outside the restored colour, warm earth inside (follows the colour wave)
          let k = 1; if (RU && RU.w > 0) { const dR = Math.hypot(x.c[0] - RC.x, x.c[1] - RC.y) - RU.x, e = Math.max(0, Math.min(1, (dR + RU.y) / (2 * RU.y))); k = 1 - e * e * (3 - 2 * e) * RU.w; }
          calmPatch.setMatrixAt(ci, M4); calmPatch.setColorAt(ci, CK.copy(GREY).lerp(EARTH, k).multiplyScalar(st === 'lock' ? 0.8 : 1)); ci++;
          if (showMarker) sigA.push(x.q.pid);
          // vibe pass 2: the ghost of a cottage on an empty plot (not the market square; not under a blueprint's scaffold)
          if (showMarker && st !== 'blue' && x.q.kind !== 'market') {
            Q.setFromAxisAngle(Y, x.q.ry); V.set(x.c[0], x.gy - 0.1, x.c[1]); SC.set(x.w * 0.72, Math.min(x.h, Math.max(x.w, x.d) * 0.75) * 0.95, x.d * 0.72);
            ghost.setMatrixAt(gi, M4.compose(V, Q, SC)); ghost.setColorAt(gi, CO.setRGB(st === 'lock' ? 0.45 : 1, 1, 1)); gi++;
          }
        }
        if (showMarker && (BUILD || st === 'blue' || api.sel === x.q.pid)) {
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
      patch.count = mi; patch.instanceMatrix.needsUpdate = true; if (patch.instanceColor) patch.instanceColor.needsUpdate = true; patch.visible = mi > 0;
      calmPatch.count = ci; calmPatch.instanceMatrix.needsUpdate = true; calmPatch.instanceColor.needsUpdate = true; calmPatch.visible = ci > 0;
      post.count = bi.open + bi.lock + bi.blue; post.instanceMatrix.needsUpdate = true; post.visible = post.count > 0;
      for (const k in boards) { boards[k].count = bi[k]; boards[k].instanceMatrix.needsUpdate = true; boards[k].visible = bi[k] > 0; }
      ghost.count = gi; ghost.instanceMatrix.needsUpdate = true; ghost.instanceColor.needsUpdate = true; ghost.visible = gi > 0;
      // mossy foundations round the empty plots (rebuilt only when that set changes; the ground under them never moves)
      const sg = sigA.join(',');
      if (sg !== stoneSig) { stoneSig = sg; rebuildFoundations(sigA); }
      // 2. buildings: homes move their own map instance; composites fill the extra meshes; scaffold for sites in progress
      for (const k in extra) if (extra[k]) extra[k].list.length = 0;
      for (const k in homes) if (homes[k]) homes[k].list.length = 0;
      const sc = [];
      for (const x of sites) {
        const rising = x.st === 'build' ? Math.max(0, (x.f - SCAF) / (1 - SCAF)) : x.st === 'done' ? 1 : -1;
        if (x.st === 'done' && x.state === 'build') burst(x);
        const sy = rising < 0 ? 0 : Math.max(0.06, rising * (2 - rising));   // ease-out: walls shoot up, the roof settles
        const e = S.plots[x.q.pid], vari = x.type === 'home' && (x.q.free || x.q.base || (e && e.col));
        if (vari) {   // buildings: drawn in the home meshes (layout instance hidden)
          if (x.inst.length && x.k !== 'v') setHome(x, false, 1); x.k = 'v';
          const hm = rising >= 0 && x.q.pid !== api.hidePid && homeMesh(x.q.piece);   // (hidePid: the free home being moved, its ghost shows instead)
          if (hm) { Q.setFromAxisAngle(Y, x.q.ry); V.set(x.q.pos[0], homeY(x), x.q.pos[2]); SC.setScalar(x.q.s); hm.list.push({ m: M4.compose(V, Q, SC).clone().multiply(SY.makeScale(1, sy, 1)), col: (e && e.col) || 0, pid: x.q.pid }); }
        } else if ((x.type === 'home' || (Sim.C.B[x.type] && Sim.C.B[x.type].piece)) && x.inst.length) {   // cottages + faction halls + the market: their own layout model rises
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
      for (const k in homes) {
        const hm = homes[k]; if (!hm) continue; const n = Math.min(HC, hm.list.length);
        for (let j = 0; j < n; j++) {
          const it = hm.list[j], P = it.col ? PALC[it.col - 1] : null; hm.m.setMatrixAt(j, it.m);
          if (P) { hm.pr.setXYZ(j, P[0].r, P[0].g, P[0].b); hm.pw.setXYZ(j, P[1].r, P[1].g, P[1].b); hm.pt.setXYZ(j, P[2].r, P[2].g, P[2].b); } else { hm.pr.setXYZ(j, -1, -1, -1); hm.pw.setXYZ(j, -1, -1, -1); hm.pt.setXYZ(j, -1, -1, -1); }
        }
        hm.m.count = n; hm.m.visible = n > 0; hm.m.instanceMatrix.needsUpdate = true; hm.pr.needsUpdate = hm.pw.needsUpdate = hm.pt.needsUpdate = true;
        if (hm.ink) { hm.ink.count = n; hm.ink.visible = n > 0; } hm.see.forEach(s => { s.count = n; s.visible = n > 0; });
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
    api.glowPieces = fn => {
      for (const k in extra) { const em = extra[k]; if (!em || !batchOf[k].glow || !Object.keys(batchOf[k].glow).length) continue; em.list.forEach((m, j) => fn(k, m, 'plot:' + k + ':' + j)); }
      for (const k in homes) { const hm = homes[k]; if (!hm || !batchOf[k].glow || !Object.keys(batchOf[k].glow).length) continue; hm.list.forEach(it => fn(k, it.m, 'home:' + it.pid)); }   // (warm windows of the player's homes)
    };
    api.homes = homes; api.palStats = palStats; api.syncInfo = syncInfo;
    let nightK = -1;
    api.setNight = n => {
      const k = Math.round(n * 50) / 50; if (k === nightK) return; nightK = k;
      const c = 1 - 0.42 * k; for (const b in boards) boards[b].material.color.setRGB(c, c, c * 1.05); patch.material.color.setRGB(c, c, c * 1.05);
      const c2 = 1 - 0.55 * k; calmPatch.material.color.setRGB(c2, c2, c2 * 1.08);
      GU.uNight.value = k;
    };
    return api;
  }
  window.Plots = Plots;
})();
