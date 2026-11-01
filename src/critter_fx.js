// Critter visuals (Round 2 step 3): the sky critters of S.crit.vis (src/critters.js) drawn from the Asset Library's
// elderglow_critters.glb (EG_Critter_*): one InstancedMesh per species body (+ its ink hull) and per animated part
// (wings / fins = *_flapL / *_flapR, tails = *_tail), all hidden while nobody of that species is here, so an empty island
// costs nothing. Simple procedural motion from the visit's own seed + the sim clock (perch + head turns + wing flaps,
// trot / hop wandering round the favourite spot, swarms circling a light, floating, the sky whale's long drift), a scale pop
// in + out, a glow pulse + soft halos at night (one Points draw). Owns no state: reads S every frame. Pick = screen-space
// nearest (pups-style). Materials = the map's lit toon (ElderMap.kitLitMat: Glow* parts shine at night, no grey mist).
(function () {
  'use strict';
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const h01 = n => (hash(n) % 10000) / 10000;
  const sm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  // per species: draw scale (the game draws pups ~3x), motion mode, halo (Blender-space offset [x, y, z] -> three [x, z, -y],
  // world size m at scale 1, colour), how high a picked camera looks
  const LOOK = {
    owl:    { s: 3.2, mode: 'perch', halo: [[0, -0.17, 0.49], 1.2, 0x9ff0ff] },
    fox:    { s: 2.7, mode: 'walk', R: 7, speed: 2.2, halo: [[0, 0.02, 0.55], 0.5, 0xbff4ff] },
    deer:   { s: 2.5, mode: 'walk', R: 6, speed: 1.4, seg: 14, halo: [[0, -0.47, 1.5], 1.4, 0x6fb8ff] },
    moth:   { s: 4.2, mode: 'swarm', n: 5, halo: [[0, 0, 0.4], 1.0, 0xffe59a] },
    frog:   { s: 3.6, mode: 'hop', R: 3, speed: 1.6, halo: [[0, 0, 0.32], 0.5, 0xbff4ff] },
    jelly:  { s: 3.6, mode: 'float', halo: [[0, 0, 1.35], 2.6, 0xffb0ec] },
    hare:   { s: 3.1, mode: 'hop', R: 7, speed: 2.6, halo: [[0, -0.25, 0.46], 0.4, 0xcff4ff] },
    sprite: { s: 4.2, mode: 'swarm', n: 3, halo: [[0, 0, 0.38], 0.8, 0xfff09a] },
    finch:  { s: 4.2, mode: 'hop', R: 4, speed: 2.0, fly: true, halo: null },
    snail:  { s: 4.4, mode: 'walk', R: 2.5, speed: 0.25, seg: 45, halo: [[0, 0.04, 0.22], 0.9, 0xc69bff] },
    whale:  { s: 2.3, mode: 'sky', halo: [[0, 0, 4.0], 16, 0x7fe8ff] },
  };
  const PARTS = /_(flapL|flapR|tail)$/;
  const MAXI = 8;

  function CritterFx(scene, map, nav, ground, opt) {
    opt = opt || {};
    const K = window.Critters, batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const group = new THREE.Group(); group.name = 'Critters'; scene.add(group);
    const kinds = {};   // species id -> { body: {m, ink}, parts: [{name, m, ink, pivot, kind}] , h: model height }
    const api = { ready: false, kinds, group, view: [], stats: { visible: 0 } };
    const lit = ElderMap.kitLitMat();
    function inst(geo, mat, cast) {
      const m = new THREE.InstancedMesh(geo, mat, MAXI); m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); return m;
    }
    function meshOf(b, cast) {
      if (!b || !b.geo) return null;
      const m = inst(b.geo, lit, cast);
      // per-instance glow pulse (vColor x instanceColor); r128 sizes instanceColor by the CURRENT count, so fill it at MAXI first
      m.count = MAXI; const W1 = new THREE.Color(1, 1, 1); for (let j = 0; j < MAXI; j++) m.setColorAt(j, W1); m.count = 0; m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      let ink = null; if (b.ink) { ink = new THREE.InstancedMesh(b.ink, ElderMap.inkMat, MAXI); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.visible = false; ink.frustumCulled = false; group.add(ink); }
      return { m, ink, b };
    }
    api.load = async (url, loader) => {
      loader = loader || new THREE.GLTFLoader(); if (window.MeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
      const g = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
      const roots = {}; for (const o of g.scene.children) roots[o.name] = o;
      for (const sp of K.SP) {
        const r = roots[sp.piece]; if (!r) { console.warn('critter model missing:', sp.piece); continue; }
        r.updateMatrixWorld(true);
        const partObs = r.children.filter(c => PARTS.test(c.name));
        const skip = m => { for (let a = m; a && a !== r; a = a.parent) if (PARTS.test(a.name)) return true; return false; };
        const bb = ElderMap.kitBatch(sp.piece, r, skip, false);
        const body = meshOf(bb, true);
        const parts = partObs.map(c => { const pb = ElderMap.kitBatch(c.name, c, null, false), pm = meshOf(pb, sp.id === 'whale'); return pm ? Object.assign(pm, { name: c.name, pivot: c.position.clone(), kind: /_tail$/.test(c.name) ? 'tail' : /L$/.test(c.name) ? 'L' : 'R' }) : null; }).filter(Boolean);
        const box = new THREE.Box3(); if (bb.geo) box.copy(bb.geo.boundingBox);
        kinds[sp.id] = { body, parts, h: box.max.y, box };
      }
      api.ready = true; return api;
    };

    // ---- halos (one additive Points draw, sized in world metres)
    const HN = 48, hPos = new Float32Array(HN * 3), hCol = new Float32Array(HN * 3), hSize = new Float32Array(HN);
    const hGeo = new THREE.BufferGeometry(); hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3)); hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 3)); hGeo.setAttribute('size', new THREE.BufferAttribute(hSize, 1));
    const hMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 400 } },
      vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale; void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uScale / -mv.z, 0.0, 220.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(vC * a, a); }' });
    const halos = new THREE.Points(hGeo, hMat); halos.frustumCulled = false; halos.renderOrder = 5; halos.visible = false; group.add(halos);

    // ---- where a visit's spot is (ground anchor + "top" for perches + a facing hint); key = 'd3', 'p88', ...
    const placementBy = {}; for (const p of map.layout.placements) placementBy[p.id] = p;
    const topOf = (piece, s) => { const b = batchOf[piece]; return b && b.box ? b.box.max.y * s : 6; };
    const radOf = (piece, s) => { const b = batchOf[piece]; return b && b.box ? Math.max(b.box.max.x - b.box.min.x, b.box.max.z - b.box.min.z) * 0.5 * s : 2; };
    const G = (x, z, y) => ground(x, z, y);
    function anchor(S, v) {
      const ch = v.k[0], n = +v.k.slice(1), TP = nav.TP, out = { p: null, top: 0, r: 0, face: null };
      if (ch === 'd') { const x = S.placed.find(y => y.k === n), D = x && Exped.DECOR[x.id], sp = x ? { p: [x.x, nav.TP[1], x.z] } : nav.decorSpots[n]; if (sp) { out.p = [sp.p[0], G(sp.p[0], sp.p[2], sp.p[1]), sp.p[2]]; if (D) { out.top = topOf(D.piece, D.s); out.r = radOf(D.piece, D.s); } } }   // free decor: where it stands now
      else if (ch === 'p') { const q = nav.plotBy[n]; if (q) { const d = q.kind === 'market' ? 4 : 8; const x = q.door[0] + q.out[0] * d, z = q.door[2] + q.out[1] * d; out.p = [x, G(x, z, q.door[1]), z]; out.face = q.out; out.top = 10; } }
      else if (ch === 'w') { const w = nav.wardSpots[n]; if (w) { out.p = [w.p[0], G(w.p[0], w.p[2], w.p[1]), w.p[2]]; out.r = 3; out.top = 6; } }
      else if (ch === 'r') { const w = nav.water[n]; if (w) { const ax = w.p[0] - w.water[0], az = w.p[2] - w.water[2], l = Math.hypot(ax, az) || 1, p = [w.p[0] + ax / l * 4, w.p[1], w.p[2] + az / l * 4]; out.p = [p[0], G(p[0], p[2], p[1]), p[2]]; out.away = Math.atan2(az / l, ax / l); } }   // the bank: wander away from the water side
      else if (ch === 'f') { const g = nav.gather.wood[n]; if (g) { out.p = [g.p[0], G(g.p[0], g.p[2], g.p[1]), g.p[2]]; const pl = placementBy[g.pid]; out.tree = [g.at[0], G(g.at[0], g.at[2], g.at[1]), g.at[2]]; out.top = pl ? topOf(pl.piece, pl.s || 1) : 10; out.r = 2; } }
      else if (ch === 'o') { const o = nav.orbs[n]; if (o) { out.p = o.orb.slice(); out.top = 0; } }
      else if (ch === 'e') { const e = nav.decorSpots[n]; if (e) out.p = [e.p[0], G(e.p[0], e.p[2], e.p[1]), e.p[2]]; }
      else if (ch === 't' || ch === 's') { const q = nav.rest(40 + n * 3, opt.scale ? opt.scale() : 0.6).p; out.p = [q[0], G(q[0], q[2], q[1]), q[2]]; }   // the plaza in front of the door (the nap grid, clear of the roots)
      if (!out.p) { const d = nav.door(0.6).p; out.p = d.slice(); }
      return out;
    }
    api.anchor = anchor;

    // ---- one pose per drawn instance: fills list with { sp, id, M (THREE.Matrix4), flap, tail, glow, pos }
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
    function put(list, sp, id, x, y, z, yaw, scale, pitch, roll, extra) {
      Q.setFromAxisAngle(Y, yaw); if (pitch) Q.multiply(Q2.setFromAxisAngle(X, pitch)); if (roll) Q.multiply(Q2.setFromAxisAngle(Z, roll));
      V.set(x, y, z); SC.setScalar(Math.max(0.001, scale));
      list.push(Object.assign({ sp, id, M: new THREE.Matrix4().compose(V, Q, SC), pos: [x, y, z], s: scale, flap: 0, tail: 0, glow: 1 }, extra || {}));
    }
    const yawTo = (dx, dz) => Math.atan2(dx, dz);   // models face +Z
    function poseVisit(S, v, now, t, list, fade, camPos) {
      const L = LOOK[v.c], sp = v.c, A = anchor(S, v), seed = v.id * 7919 + 13;
      const age = now - v.t0, left = v.end - now, pop = sm(Math.min(age, 2.5) / 2.5) * fade, sc = L.s;
      const arrive = 1 - sm(age / 5), go = 1 - sm(left / 5);   // flying arrive / leave (sim seconds)
      const base = A.p;
      if (L.mode === 'perch') {   // the owl: on top of its tree (or the decor), head turns, a wing stretch now and then
        const T = A.tree || base, R = A.tree ? 1.2 : Math.max(0.6, A.r * 0.25), a = h01(seed) * 6.28;
        const x = T[0] + Math.cos(a) * R, z = T[2] + Math.sin(a) * R, y = T[1] + A.top * 0.86 + (arrive * arrive) * 25 + go * go * 25;
        const look = Math.sin(t * 0.37 + seed) * 0.6 + (Math.sin(t * 0.11 + seed) > 0.7 ? 1.2 : 0);
        const camYaw = camPos ? yawTo(camPos.x - x, camPos.z - z) : a;
        const stretch = Math.max(0, Math.sin(t * 0.5 + seed * 0.1)) ** 12, fly = Math.max(arrive, go) > 0.02;
        put(list, sp, v.id, x, y + Math.sin(t * 1.3 + seed) * 0.05, z, camYaw + look * 0.5, sc * pop, 0, 0, { flap: fly ? 0.3 + 0.7 * Math.sin(t * 16) : stretch * (0.5 + 0.5 * Math.sin(t * 9)), glow: 1 + 0.18 * Math.sin(t * 2 + seed) });
      } else if (L.mode === 'walk' || L.mode === 'hop') {   // wander round the spot: walk to a hashed point, rest, again
        const seg = L.seg || (L.mode === 'hop' ? 6 : 9), k = Math.floor(age / seg), f = (age - k * seg) / seg, R = L.R * (sp === 'snail' ? 1 : 1);
        const off = (A.r || 0) + (sp === 'snail' ? 1.5 : 3);
        const wp = j => { const a = A.away !== undefined ? A.away + (h01(seed + j * 31) - 0.5) * 2.4 : h01(seed + j * 31) * 6.283, r = (A.away !== undefined ? 1 : off) + h01(seed + j * 57) * R; return [base[0] + Math.cos(a) * r, base[2] + Math.sin(a) * r]; };
        const p0 = wp(k - 1), p1 = wp(k), mv = Math.min(1, f / 0.45), e = sm(mv), moving = mv < 1 && f > 0;
        const x = p0[0] + (p1[0] - p0[0]) * e, z = p0[1] + (p1[1] - p0[1]) * e, gy = G(x, z, base[1]);
        let yaw = yawTo(p1[0] - p0[0], p1[1] - p0[1]); if (!moving && camPos && sp !== 'snail') yaw += Math.sin(t * 0.4 + seed) * 0.35;
        let y = gy, flap = 0, pitch = 0;
        if (L.mode === 'hop' && moving) { const hops = sp === 'frog' ? 2 : 4; y += Math.abs(Math.sin(mv * Math.PI * hops)) * (sp === 'frog' ? 1.6 : 0.9); }
        if (L.mode === 'walk' && moving && sp !== 'snail') y += Math.abs(Math.sin(age * L.speed * 4)) * 0.12;
        if (L.fly) { const fl = Math.max(arrive, go, moving && h01(seed + k) > 0.6 ? Math.sin(mv * Math.PI) : 0); y += fl * 5 + arrive * arrive * 18 + go * go * 18; flap = fl > 0.05 ? Math.sin(t * 20) : 0; }
        if (!moving && sp === 'deer') pitch = Math.max(0, Math.sin(t * 0.3 + seed)) * 0.18;   // a nibble of grass
        const tail = sp === 'fox' ? Math.sin(t * (moving ? 6 : 2.2)) * (moving ? 0.25 : 0.4) : 0;
        put(list, sp, v.id, x, y, z, yaw, sc * pop, pitch, 0, { flap, tail, glow: 1 + 0.15 * Math.sin(t * 1.7 + seed) });
      } else if (L.mode === 'swarm') {   // moths round a light, sprites round a garden: lissajous loops
        const hBase = A.top ? Math.min(A.top * 0.6, 7) : (base === A.p && v.k[0] === 'o' ? 0 : 3), n = L.n;
        for (let j = 0; j < n; j++) {
          const ph = j * 2.4 + h01(seed + j) * 2, w = 0.35 + 0.1 * h01(seed + j * 3), r = 3 + 2.5 * h01(seed + j * 5) + (A.r || 0) * 0.6;
          const x = base[0] + Math.cos(t * w + ph) * r, z = base[2] + Math.sin(t * w * 1.3 + ph) * r * 0.8, y = base[1] + hBase + 1.5 + Math.sin(t * w * 2.1 + ph) * 1.2 + arrive * 12 + go * 12;
          const dx = -Math.sin(t * w + ph) * r, dz = Math.cos(t * w * 1.3 + ph) * r * 0.8 * 1.3;
          put(list, sp, v.id, x, y, z, yawTo(dx, dz), sc * pop * (0.8 + 0.3 * h01(seed + j * 7)), 0.15, Math.sin(t * 2 + ph) * 0.2, { flap: Math.sin(t * (sp === 'moth' ? 24 : 18) + ph) * 0.8 + 0.1, glow: 1 + 0.25 * Math.sin(t * 3 + ph), sub: j });
        }
      } else if (L.mode === 'float') {   // the sky jelly: hovers high over its spot, bell pulses, drifts in a slow circle
        const a = t * 0.08 + h01(seed) * 6.28, r = 4, hh = 16 + Math.sin(t * 0.35 + seed) * 1.5 + arrive * 30 + go * 30;
        const pulse = Math.sin(t * 1.8 + seed), x = base[0] + Math.cos(a) * r, z = base[2] + Math.sin(a) * r;
        const s = sc * pop; put(list, sp, v.id, x, base[1] + hh + pulse * 0.25, z, a, s, 0, 0, { glow: 1.05 + 0.2 * pulse, sy: 1 + 0.08 * pulse, sx: 1 - 0.05 * pulse });
      } else if (L.mode === 'sky') {   // the sky whale: one long slow drift across the sky, passing near the tree
        const TP = nav.TP, n = +v.k.slice(1) || 0, a = n * Math.PI / 2 + 0.35, f = Math.max(0, Math.min(1, age / Math.max(60, v.end - v.t0)));
        const dx = Math.cos(a), dz = Math.sin(a), side = 140, span = 900;
        const x = TP[0] - dx * span * (f - 0.5) * 2 - dz * side, z = TP[2] - dz * span * (f - 0.5) * 2 + dx * side;
        const y = TP[1] + 175 + Math.sin(f * Math.PI * 3) * 10;
        const s = sc * Math.min(1, fade * 1.0) * sm(Math.min(1, age / 20)) * sm(Math.min(1, left / 20) + (left > 20 ? 1 : 0));
        put(list, sp, v.id, x, y, z, yawTo(-dx, -dz), s, Math.sin(t * 0.25) * 0.05, Math.sin(t * 0.18) * 0.06, { flap: Math.sin(t * 0.7) * 0.3, tail: Math.sin(t * 0.55) * 0.28, glow: 1 + 0.1 * Math.sin(t * 0.9) });
      }
    }

    // ---- per frame
    const ghosts = {}; let lastIds = new Map();
    const PIV = new THREE.Matrix4(), RT = new THREE.Matrix4(), PM = new THREE.Matrix4(), COL = new THREE.Color();
    const sx = new THREE.Vector3(), tmpS = new THREE.Matrix4();
    api.update = (S, t, dt, simExtra, night, camera, realNow) => {
      if (!api.ready) return;
      const now = S.time + (simExtra || 0), list = []; realNow = realNow || performance.now() / 1000;
      const ids = new Map(); for (const v of S.crit.vis) ids.set(v.id, v);
      for (const [id, v] of lastIds) if (!ids.has(id) && !ghosts[id]) ghosts[id] = { v: Object.assign({}, v), t0: realNow, now };
      lastIds = ids;
      for (const v of S.crit.vis) if (LOOK[v.c] && kinds[v.c]) poseVisit(S, v, now, t, list, 1, camera.position);
      for (const id in ghosts) { const g = ghosts[id], k = (realNow - g.t0) / 1.4; if (k >= 1 || !kinds[g.v.c]) { delete ghosts[id]; continue; } poseVisit(S, g.v, g.now + (realNow - g.t0), t, list, 1 - sm(k), camera.position); }
      api.view = list;
      // instances per species
      const n = {}; for (const sp in kinds) n[sp] = 0;
      let hi = 0;
      for (const P of list) {
        const kd = kinds[P.sp]; if (!kd || !kd.body) continue; const j = n[P.sp]++; if (j >= MAXI) continue;
        let M = P.M; if (P.sy) { tmpS.makeScale(P.sx || 1, P.sy, P.sx || 1); M = tmpS.premultiply(new THREE.Matrix4()).multiplyMatrices(P.M, tmpS); }
        kd.body.m.setMatrixAt(j, M);
        COL.setScalar(1 + (P.glow - 1) * (0.35 + 0.65 * night)); kd.body.m.setColorAt(j, COL);
        for (const pt of kd.parts) {
          const ang = pt.kind === 'tail' ? P.tail : (pt.kind === 'L' ? 1 : -1) * P.flap * 0.9;
          if (pt.kind === 'tail') RT.makeRotationAxis(P.sp === 'whale' ? X : Y, ang); else RT.makeRotationAxis(Z, ang);
          PIV.makeTranslation(pt.pivot.x, pt.pivot.y, pt.pivot.z);
          PM.multiplyMatrices(M, PIV).multiply(RT); pt.m.setMatrixAt(j, PM); pt.m.setColorAt(j, COL);
        }
        // halo
        const L = LOOK[P.sp]; if (L.halo && hi < HN && night > 0.05) {
          const o = L.halo[0]; sx.set(o[0], o[2], -o[1]).applyMatrix4(M);
          hPos[hi * 3] = sx.x; hPos[hi * 3 + 1] = sx.y; hPos[hi * 3 + 2] = sx.z; COL.setHex(L.halo[2]);
          const a = night * (0.55 + 0.25 * Math.sin(t * 2.3 + j)) * Math.min(1, P.s / L.s);
          hCol[hi * 3] = COL.r * a; hCol[hi * 3 + 1] = COL.g * a; hCol[hi * 3 + 2] = COL.b * a; hSize[hi] = L.halo[1] * L.s; hi++;
        }
      }
      let vis = 0;
      for (const sp in kinds) {
        const kd = kinds[sp], c = Math.min(MAXI, n[sp]); if (!kd.body) continue; vis += c;
        for (const o of [kd.body].concat(kd.parts)) { o.m.count = c; o.m.visible = c > 0; o.m.instanceMatrix.needsUpdate = true; if (o.m.instanceColor) o.m.instanceColor.needsUpdate = true; if (o.ink) { o.ink.count = c; o.ink.visible = c > 0; } }
      }
      hGeo.setDrawRange(0, hi); hGeo.attributes.position.needsUpdate = hGeo.attributes.color.needsUpdate = hGeo.attributes.size.needsUpdate = true; halos.visible = hi > 0;
      hMat.uniforms.uScale.value = (opt.H ? opt.H() : 800) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      api.stats.visible = vis;
    };
    // screen-space pick: the visit id nearest to (mx, my) within R px (bodies + swarm members), or null
    const pv = new THREE.Vector3();
    api.pick = (mx, my, camera, W, H, R) => {
      let best = null, bd = R;
      for (const P of api.view) {
        if (!S_has(P.id)) continue; const kd = kinds[P.sp], hh = (kd ? kd.h : 0.5) * P.s;
        for (const f of [0.3, 0.7]) {
          pv.set(P.pos[0], P.pos[1] + hh * f, P.pos[2]).project(camera); if (pv.z > 1) continue;
          const d = Math.hypot((pv.x + 1) / 2 * W - mx, (1 - pv.y) / 2 * H - my); if (d < bd) { bd = d; best = P.id; }
        }
      }
      return best;
    };
    // album portraits: each critter rendered once (neutral daylight, no season / night / grade) into a small transparent PNG
    // with the game's own renderer + materials (the album and the card show the real model; unknown = the same image as a
    // silhouette in CSS). Returns { id: dataURL }; cached.
    api.thumbs = (renderer, px) => {
      if (api._thumbs) return api._thumbs; if (!api.ready) return null;
      px = px || 160; const out = {}, EM = ElderMap;
      const rt = new THREE.WebGLRenderTarget(px, px); rt.texture.encoding = THREE.sRGBEncoding;
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0xb0a4d0, 0.85)); const dl = new THREE.DirectionalLight(0xfff4e0, 0.95); dl.position.set(-2, 4, 3); sc.add(dl);
      const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 500);
      const keep = { n: EM.uNight.value, g: EM.uGrade.value.clone(), s: EM.uSeason.value.clone(), d: EM.uGradeDark.value, c: EM.uCozy.value, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha(), rt: renderer.getRenderTarget(), sh: renderer.shadowMap.enabled };
      EM.uNight.value = 0; EM.uGrade.value.set(1, 1, 1, 0); EM.uSeason.value.set(0, 0, 0, 0); EM.uGradeDark.value = 0; EM.uCozy.value = 0;
      renderer.setClearColor(0x000000, 0); renderer.shadowMap.enabled = false;
      const buf = new Uint8Array(px * px * 4), cv = document.createElement('canvas'); cv.width = cv.height = px; const cx = cv.getContext('2d'), img = cx.createImageData(px, px);
      try {
        for (const sp of K.SP) {
          const kd = kinds[sp.id]; if (!kd || !kd.body) continue;
          const g = new THREE.Group(); const add = (geo, mat, m) => { const o = new THREE.Mesh(geo, mat); if (m) o.applyMatrix4(m); g.add(o); };
          const pose = new THREE.Matrix4().makeRotationY(-0.55);
          add(kd.body.b.geo, lit, pose); if (kd.body.b.ink) add(kd.body.b.ink, ElderMap.inkMat, pose);
          for (const pt of kd.parts) { const m = pose.clone().multiply(new THREE.Matrix4().makeTranslation(pt.pivot.x, pt.pivot.y, pt.pivot.z)); if (pt.kind !== 'tail') m.multiply(new THREE.Matrix4().makeRotationZ((pt.kind === 'L' ? 1 : -1) * 0.25)); add(pt.b.geo, lit, m); }
          sc.add(g);
          const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
          const d = r / Math.sin(THREE.MathUtils.degToRad(14)) * 0.74; cam.position.copy(c).add(new THREE.Vector3(0.1, 0.32, 1).normalize().multiplyScalar(d)); cam.lookAt(c); cam.near = d / 50; cam.far = d * 4; cam.updateProjectionMatrix();
          renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam); renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
          for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);   // flip: GL rows are bottom-up
          cx.putImageData(img, 0, 0); out[sp.id] = cv.toDataURL('image/png');
          sc.remove(g);
        }
      } finally {
        renderer.setRenderTarget(keep.rt); renderer.setClearColor(keep.cc, keep.ca); renderer.shadowMap.enabled = keep.sh; rt.dispose();
        EM.uNight.value = keep.n; EM.uGrade.value.copy(keep.g); EM.uSeason.value.copy(keep.s); EM.uGradeDark.value = keep.d; EM.uCozy.value = keep.c;
      }
      return (api._thumbs = out);
    };
    let curS = null; const S_has = id => !curS || curS.crit.vis.some(v => v.id === id);
    api.bind = S => { curS = S; };
    // where a visitor is now (for the camera / sparkle): centre of its first drawn instance
    api.posOf = id => { const P = api.view.find(x => x.id === id); if (!P) return null; const kd = kinds[P.sp]; return [P.pos[0], P.pos[1] + (kd ? kd.h * P.s * 0.5 : 1), P.pos[2]]; };
    api.sizeOf = id => { const P = api.view.find(x => x.id === id); if (!P) return 3; const kd = kinds[P.sp]; return kd ? kd.h * P.s : 3; };
    return api;
  }
  window.CritterFx = CritterFx;
  window.CritterFx.LOOK = LOOK;
})();
