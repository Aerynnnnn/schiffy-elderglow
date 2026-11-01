// NeedsFx (step 4): what the player sees of the three new needs and of the events. Reads the sim state every frame,
// owns no game state.
//  - blight patches: dark purple creeping ground decals (1 instanced draw) + rising dark spores (1 Points draw); a patch
//    being swept shrinks; a cleared one bursts into sparkles
//  - crystal wards: the kit's crystal pillar (instanced) + a faint ring on the ground showing what it shelters; they are
//    night light sources too (glowPieces)
//  - gardening: soil beds in front of the door (where gardeners without a garden plot work) + glow sprouts (planted seeds)
//  - music: notes rising over performers (1 Points draw), at night a little light show at the stage (3 sweeping beams +
//    sparkles); resting pups near a performance dance (game.js sets pose.dance)
//  - events: glowing fruit around the roots (tap to collect: pickFruit), rain for a shower (1 Points draw), the wandering
//    trader (a pup from pups.glb beside a market stall) near the plaza
(function () {
  'use strict';
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  // splotchy blight: overlapping dark blobs, violet veins + a glowing rim (deterministic, no Math.random in the texture)
  const BLIGHT = canvasTex(256, 256, (g, w) => {
    let a = 12345; const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
    for (let k = 0; k < 16; k++) {
      const an = k / 16 * Math.PI * 2 + rnd() * 0.4, r = 40 + rnd() * 50, x = w / 2 + Math.cos(an) * r * 0.75, y = w / 2 + Math.sin(an) * r * 0.75, R = 28 + rnd() * 26;
      const gr = g.createRadialGradient(x, y, 2, x, y, R); gr.addColorStop(0, 'rgba(58,22,78,.9)'); gr.addColorStop(0.7, 'rgba(70,28,96,.75)'); gr.addColorStop(1, 'rgba(70,28,96,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
    }
    const c = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, 70); c.addColorStop(0, 'rgba(34,10,48,.95)'); c.addColorStop(1, 'rgba(34,10,48,0)'); g.fillStyle = c; g.beginPath(); g.arc(w / 2, w / 2, 70, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,110,255,.85)'; g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {   // veins
      let x = w / 2, y = w / 2, an = k / 9 * Math.PI * 2 + rnd(); g.lineWidth = 3.5; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 7; s++) { an += (rnd() - 0.5) * 0.9; x += Math.cos(an) * 13; y += Math.sin(an) * 13; g.lineTo(x, y); g.lineWidth = Math.max(1, 3.5 - s * 0.4); }
      g.stroke();
    }
    for (let k = 0; k < 18; k++) { const an = rnd() * Math.PI * 2, r = 60 + rnd() * 50, x = w / 2 + Math.cos(an) * r, y = w / 2 + Math.sin(an) * r; const gr = g.createRadialGradient(x, y, 0, x, y, 7); gr.addColorStop(0, 'rgba(210,150,255,.95)'); gr.addColorStop(1, 'rgba(210,150,255,0)'); g.fillStyle = gr; g.fillRect(x - 8, y - 8, 16, 16); }
  });
  const RING = canvasTex(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w * 0.5); r.addColorStop(0, 'rgba(160,240,255,0)'); r.addColorStop(0.85, 'rgba(160,240,255,.28)'); r.addColorStop(0.95, 'rgba(200,250,255,.7)'); r.addColorStop(1, 'rgba(200,250,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const SOFT = canvasTex(64, 64, g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const NOTE = canvasTex(64, 64, g => {
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#2a2442'; g.lineWidth = 6; g.fillStyle = '#fff';
    const draw = () => { g.beginPath(); g.ellipse(22, 46, 10, 7.5, -0.4, 0, Math.PI * 2); g.moveTo(31, 44); g.lineTo(31, 10); g.quadraticCurveTo(42, 14, 48, 24); };
    draw(); g.stroke(); g.beginPath(); g.ellipse(22, 46, 10, 7.5, -0.4, 0, Math.PI * 2); g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(31, 42); g.lineTo(31, 12); g.quadraticCurveTo(41, 15, 46, 23); g.stroke();
  });
  const STREAK = canvasTex(16, 64, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, 'rgba(220,240,255,0)'); r.addColorStop(1, 'rgba(220,240,255,.85)'); g.fillStyle = r; g.fillRect(6, 0, 4, h); });
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, o || {}));

  // one Points draw of short-lived sprites (position, colour, size, alpha per point); CPU-updated
  function Particles(scene, cap, tex, additive) {
    const geo = new THREE.BufferGeometry(), P = new Float32Array(cap * 3), Cc = new Float32Array(cap * 3), Sz = new Float32Array(cap), A = new Float32Array(cap);
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(Sz, 1)); geo.setAttribute('alpha', new THREE.BufferAttribute(A, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      vertexShader: 'attribute float size; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)); gl_FragColor = vec4(t.rgb * vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }',
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
    const live = []; const col = new THREE.Color();
    return {
      pts, mat, live,
      emit(x, y, z, vx, vy, vz, life, size, color, fade) { if (live.length >= cap) live.shift(); live.push({ x, y, z, vx, vy, vz, t: 0, life, size, c: col.set(color).toArray(), fade: fade === undefined ? 1 : fade }); },
      update(dt) {
        let n = 0;
        for (let k = live.length - 1; k >= 0; k--) { const q = live[k]; q.t += dt; if (q.t >= q.life) { live.splice(k, 1); } }
        for (const q of live) {
          q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; const a = q.t / q.life;
          P[n * 3] = q.x; P[n * 3 + 1] = q.y; P[n * 3 + 2] = q.z; Cc[n * 3] = q.c[0]; Cc[n * 3 + 1] = q.c[1]; Cc[n * 3 + 2] = q.c[2];
          Sz[n] = q.size * (q.fade === 2 ? 1 : 0.7 + 0.5 * Math.sin(Math.min(1, a * 2) * Math.PI * 0.5)); A[n] = q.fade === 2 ? 0.85 : Math.min(1, a * 6) * (1 - Math.pow(a, 2)); n++;
        }
        geo.setDrawRange(0, n); for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true; pts.visible = n > 0;
      },
    };
  }

  function NeedsFx(scene, map, nav, ground, pupsApi, opts) {
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
    const gy = (x, z, y) => ground(x, z, y);
    const api = { fruit: [], trader: null };
    // kit pieces drawn by this file (instanced, same geometry + material as the map)
    const kits = {};
    function kitMesh(key, cap) {
      if (kits[key] !== undefined) return kits[key];
      const b = batchOf[key]; if (!b || !b.geo) return (kits[key] = null);
      const m = new THREE.InstancedMesh(b.geo, b.mesh.material, cap); m.count = 0; m.castShadow = true; m.frustumCulled = false; scene.add(m);
      let ink = null; if (b.inkMesh && b.ink && !opts.phone) { ink = new THREE.InstancedMesh(b.ink, b.inkMesh.material, cap); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.frustumCulled = false; scene.add(ink); }
      const see = b.see.map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, cap); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = false; scene.add(im); return im; });
      return (kits[key] = { m, ink, see, list: [], b });
    }
    const flushKit = k => { if (!k) return; k.list.forEach((m, j) => k.m.setMatrixAt(j, m)); k.m.count = k.list.length; k.m.instanceMatrix.needsUpdate = true; if (k.ink) k.ink.count = k.list.length; k.see.forEach(s => { s.count = k.list.length; }); };

    // ---- blight decals + spores
    const MAXB = 12;
    const decal = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: BLIGHT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), MAXB);
    decal.count = 0; decal.frustumCulled = false; decal.renderOrder = 1; scene.add(decal);
    const spores = Particles(scene, 260, SOFT, false), sparks = Particles(scene, 220, SOFT, true), notes = Particles(scene, 90, NOTE, false), show = Particles(scene, 160, SOFT, true);
    const shown = new Map();   // patch id -> last pos (for the cleared burst)
    api.blightPos = k => { const sp = nav.blightSpots[k]; return sp ? [sp.p[0], gy(sp.p[0], sp.p[2], sp.p[1]), sp.p[2]] : null; };
    const hk = k => ((k * 2654435761) >>> 0) / 4294967296;

    // ---- wards: crystal pillar + ground ring
    const ringM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: RING, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 8);
    ringM.count = 0; ringM.frustumCulled = false; scene.add(ringM);
    api.wardPos = k => { const w = nav.wardSpots[k]; return w ? [w.p[0], gy(w.p[0], w.p[2], w.p[1]), w.p[2]] : null; };

    // ---- soil beds (root beds) + glow sprouts
    const bedGeo = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(4.6, 1.0, 3.3);
    const beds = new THREE.InstancedMesh(bedGeo, toon(0x4e3220), 8); beds.count = 0; beds.receiveShadow = true; beds.frustumCulled = false; scene.add(beds);
    const stemGeo = new THREE.ConeGeometry(0.42, 3.2, 6).translate(0, 1.6, 0), leafGeo = new THREE.SphereGeometry(0.95, 8, 6).scale(1, 0.32, 0.5), bulbGeo = new THREE.SphereGeometry(0.62, 12, 10);
    const stems = new THREE.InstancedMesh(stemGeo, toon(0x2f7d3a), 24), leaves = new THREE.InstancedMesh(leafGeo, toon(0x4fae45), 48), bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffb21f }), 24);
    for (const m of [stems, leaves, bulbs]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    const bedSpot = (S, j) => nav.rest(24 + j, Sim.scaleOf(S));

    // ---- glowing fruit
    const fruitM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb21f }), 8); fruitM.count = 0; fruitM.frustumCulled = false; scene.add(fruitM);
    const fruitLeaf = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 6).scale(1, 0.3, 0.5), toon(0x6fcf5a), 8); fruitLeaf.count = 0; fruitLeaf.frustumCulled = false; scene.add(fruitLeaf);
    const halo = Particles(scene, 16, SOFT, true);   // re-filled every frame (static halos)
    function fruitAt(S, e, j) {
      const R = nav.trunkR(Sim.scaleOf(S)) * 1.9 + 2, an = (e.a + j * 360 / e.n + j * 23) * Math.PI / 180, TP = nav.TP;
      const x = TP[0] + Math.cos(an) * R, z = TP[2] + Math.sin(an) * R; return [x, gy(x, z, TP[1]) + 1.3, z];
    }
    api.fruitAt = fruitAt;

    // ---- rain (shower)
    const RN = opts.phone ? 700 : 1500, rg = new THREE.BufferGeometry(), rp = new Float32Array(RN * 3);
    for (let k = 0; k < RN; k++) { rp[k * 3] = (hk(k + 1) - 0.5) * 220; rp[k * 3 + 1] = hk(k + 7777) * 90; rp[k * 3 + 2] = (hk(k + 3333) - 0.5) * 220; }
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    const rainMat = new THREE.PointsMaterial({ map: STREAK, size: 2.4, transparent: true, opacity: 0.0, depthWrite: false, color: 0xd8ecff });
    const rain = new THREE.Points(rg, rainMat); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
    let rainK = 0;

    // ---- light show beams (night performance at a stage)
    // a soft beam: bright at the lamp, fading out before it reaches the ground (no hard cone end)
    const beamGeo = new THREE.ConeGeometry(3.2, 30, 20, 1, true).translate(0, -15, 0);
    const beams = [0xff7ad9, 0x7ad8ff, 0xffe066].map(c => {
      const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(c) }, opacity: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; uniform float opacity; varying float vY; void main(){ float k = 1.0 - smoothstep(0.0, 30.0, -vY); gl_FragColor = vec4(uColor * opacity * k * k, 1.0); }' });
      Object.defineProperty(mat, 'opacity', { get: () => mat.uniforms.opacity.value, set: v => { if (mat.uniforms) mat.uniforms.opacity.value = v; } });
      const m = new THREE.Mesh(beamGeo, mat); m.visible = false; scene.add(m); return m;
    });

    // ---- the wandering trader: a pup + a stall near the plaza
    let npc = null;
    // the trader stands behind its stall, facing out to the plaza (where the player's camera usually comes from)
    const traderSpot = S => { const a = nav.rest(13, Sim.scaleOf(S)), dx = a.p[0] - nav.TP[0], dz = a.p[2] - nav.TP[2], l = Math.hypot(dx, dz) || 1; return { p: a.p, out: [dx / l, dz / l], stall: [a.p[0] + dx / l * 4.2, 0, a.p[2] + dz / l * 4.2] }; };
    api.traderAt = S => { const t = traderSpot(S); return [t.p[0], gy(t.p[0], t.p[2], t.p[1]) + 8, t.p[2]]; };

    let noteT = 0, sporeT = 0, showT = 0;
    const COLS = [0xff8fd0, 0xffd36a, 0x8fe6ff, 0xc69bff];
    api.update = (S, t, dt, poses, night, camera, H) => {
      const uScale = H * 0.5 / Math.tan(camera.fov * Math.PI / 360);
      for (const p of [spores, sparks, notes, show, halo]) p.mat.uniforms.uScale.value = uScale;
      // blight
      const live = new Set(); let n = 0;
      for (const b of S.blight.list) {
        const sp = nav.blightSpots[b.k]; if (!sp || n >= MAXB) continue; live.add(b.id);
        let shrink = 1; for (const p of S.pups) if (p.task === 'blight' && p.tgt === b.id && p.phase === 'clear') shrink = Math.min(shrink, 1 - 0.75 * Math.min(1, p.t / Math.max(1, p.dur)));
        const age = Math.min(1, (S.time - b.t) / 20 + 0.02), D = (5 + 9 * b.r) * shrink * (0.3 + 0.7 * age) * (1 + 0.03 * Math.sin(t * 1.6 + b.id));
        const x = sp.p[0], z = sp.p[2], y = gy(x, z, sp.p[1]) + 0.12;
        Q.setFromAxisAngle(Y, hk(b.k) * 6.28 + t * 0.02); V.set(x, y, z); SC.set(D, 1, D); decal.setMatrixAt(n++, M4.compose(V, Q, SC));
        shown.set(b.id, [x, y, z, D]);
      }
      decal.count = n; decal.instanceMatrix.needsUpdate = true;
      for (const [id, q] of shown) if (!live.has(id)) {   // cleared: a sparkle burst
        shown.delete(id);
        for (let k = 0; k < 26; k++) { const an = k / 26 * 6.28; sparks.emit(q[0] + Math.cos(an) * q[3] * 0.3, q[1] + 0.5, q[2] + Math.sin(an) * q[3] * 0.3, Math.cos(an) * 3, 4 + (k % 5), Math.sin(an) * 3, 1.3, 2.2, k % 3 ? 0xfff2a8 : 0x9ff6ff); }
      }
      sporeT += dt;
      if (sporeT > 0.12 && S.blight.list.length) {
        sporeT = 0;
        for (const [, q] of shown) { const k = Math.floor(t * 97 + q[0]) % 7; sporeEmit(q, k); }
      }
      function sporeEmit(q, k) { const an = (t * 2.3 + k) % 6.28, r = q[3] * 0.32 * ((k + 1) / 8); spores.emit(q[0] + Math.cos(an) * r, q[1] + 0.3, q[2] + Math.sin(an) * r, 0, 1.2 + (k % 3) * 0.4, 0, 2.6, 1.3, k % 2 ? 0x4a2266 : 0x7a3aa8); }
      // wards
      const pk = kitMesh('EG_CrystalPillar', 8); if (pk) pk.list.length = 0; let rn = 0;
      for (const k of S.wards) {
        const w = api.wardPos(k); if (!w) continue;
        if (pk) { Q.setFromAxisAngle(Y, hk(k + 9) * 6.28); V.set(w[0], w[1], w[2]); SC.setScalar(0.85); pk.list.push(M4.compose(V, Q, SC).clone()); }
        const R = Needs.C.BLIGHT.WARD_R * 2 * (1 + 0.015 * Math.sin(t * 1.2 + k)); Q.identity(); V.set(w[0], w[1] + 0.1, w[2]); SC.set(R, 1, R); ringM.setMatrixAt(rn++, M4.compose(V, Q, SC));
      }
      flushKit(pk); ringM.count = rn; ringM.instanceMatrix.needsUpdate = true; ringM.material.opacity = 0.55 + 0.45 * night;
      // soil beds + sprouts (gardening): beds once Nourish is awake and no garden plot is built yet
      const nAw = Needs.awakeK(S, 'nourish') >= 0, gardens = Needs.gardens(S); let bn = 0;
      if (nAw && !gardens.length) for (let j = 0; j < 4; j++) { const s = bedSpot(S, j).p; Q.setFromAxisAngle(Y, Math.atan2(s[0] - nav.TP[0], s[2] - nav.TP[2])); V.set(s[0], gy(s[0], s[2], s[1]) - 0.15, s[2]); SC.setScalar(1); beds.setMatrixAt(bn++, M4.compose(V, Q, SC)); }
      beds.count = bn; beds.instanceMatrix.needsUpdate = true;
      let sn = 0, ln = 0;
      S.garden.sprouts.forEach((sp, m) => {
        let x, z;
        if (sp.k >= 0 && nav.plotBy[sp.k]) { const q = nav.plotBy[sp.k], a = m * 2.1; x = q.pos[0] + Math.cos(a) * 4; z = q.pos[2] + Math.sin(a) * 4; }
        else { const s = bedSpot(S, (-1 - sp.k) % 4).p, a = m * 2.4 + 0.6; x = s[0] + Math.cos(a) * 3.6; z = s[2] + Math.sin(a) * 2.4; }
        const y = gy(x, z, nav.TP[1]), grow = Math.min(1, (S.time - sp.t) / 120 + 0.25), s = grow * (1 + 0.05 * Math.sin(t * 2 + m));
        Q.setFromAxisAngle(Y, m); V.set(x, y, z); SC.setScalar(s); stems.setMatrixAt(sn, M4.compose(V, Q, SC));
        V.set(x, y + 3.3 * s, z); SC.setScalar(s); bulbs.setMatrixAt(sn, M4.compose(V, Q, SC)); sn++;
        for (const side of [-1, 1]) { Q.setFromAxisAngle(Y, m + side * 1.3); V.set(x + side * 0.7 * s, y + 1.5 * s, z); leaves.setMatrixAt(ln++, M4.compose(V, Q, SC.setScalar(s))); }
        if (Math.floor(t * 3 + m) % 4 === 0 && Math.random() < dt * 4) sparks.emit(x, y + 3.5 * s, z, 0, 1.5, 0, 1.2, 1.6, 0xffe680);
      });
      stems.count = bulbs.count = sn; leaves.count = ln; for (const m of [stems, leaves, bulbs]) m.instanceMatrix.needsUpdate = true;
      // glowing fruit (events)
      api.fruit.length = 0; let fn = 0; halo.live.length = 0;
      for (const e of S.events.active) if (e.type === 'fruit') for (let j = 0; j < e.n; j++) {
        if (e.got.includes(j) || fn >= 8) continue;
        const p = fruitAt(S, e, j), bob = Math.sin(t * 2.2 + j) * 0.35, s = 0.95 + 0.08 * Math.sin(t * 3 + j);
        Q.identity(); V.set(p[0], p[1] + bob, p[2]); SC.setScalar(s); fruitM.setMatrixAt(fn, M4.compose(V, Q, SC));
        V.set(p[0], p[1] + bob + 0.95, p[2]); fruitLeaf.setMatrixAt(fn, M4.compose(V, Q.setFromAxisAngle(Y, j), SC.setScalar(1)));
        halo.live.push({ x: p[0], y: p[1] + bob, z: p[2], vx: 0, vy: 0, vz: 0, t: 0.5, life: 1e9, size: 7 + Math.sin(t * 3 + j), c: [1, 0.85, 0.4], fade: 2 });
        api.fruit.push({ id: e.id, j, p: [p[0], p[1] + bob, p[2]] }); fn++;
      }
      fruitM.count = fruitLeaf.count = fn; fruitM.instanceMatrix.needsUpdate = true; fruitLeaf.instanceMatrix.needsUpdate = true;
      // rain while a shower lasts: drawn by src/weather_fx.js since the seasons + weather pass (a shower = rain 0.75 there)
      const raining = !window.WeatherFx && S.events.active.some(e => e.type === 'shower');
      rainK += ((raining ? 1 : 0) - rainK) * Math.min(1, dt * 0.8); rain.visible = rainK > 0.02; rainMat.opacity = 0.75 * rainK;
      if (rain.visible) {
        const c = opts.target(), A = rg.attributes.position.array;
        for (let k = 0; k < RN; k++) { A[k * 3 + 1] -= dt * 55; if (A[k * 3 + 1] < 0) A[k * 3 + 1] += 90; }
        rain.position.set(c.x, c.y - 10, c.z); rg.attributes.position.needsUpdate = true;
      }
      // music: notes over performers; at night a light show at the stage; who dances (resting pups within 34 m)
      noteT += dt; const players = [];
      poses.forEach((ps, i) => { if (ps.phase === 'play') players.push(ps); });
      if (noteT > 0.45) {
        noteT = 0;
        for (const ps of players) { const k = Math.floor(t * 10) % 4; notes.emit(ps.p[0] + (k - 1.5) * 0.6, (ps.y || ps.p[1]) + 6.2, ps.p[2], (k - 1.5) * 0.5, 2.2, 0, 2.4, 2.1, COLS[k]); }
      }
      const stagePid = Needs.firstBuilt(S, 'stage'), onStage = players.some(ps => ps.task === 'stage');
      const showK = night > 0.35 && onStage && stagePid !== null ? 1 : 0;
      beams.forEach((b, k) => {
        b.material.opacity += ((showK ? 0.42 : 0) - b.material.opacity) * Math.min(1, dt * 2); b.visible = b.material.opacity > 0.01;
        if (!b.visible) return; const q = nav.plotBy[stagePid]; if (!q) return;
        const y = gy(q.pos[0], q.pos[2], q.pos[1]), sx = q.pos[0] + (k - 1) * 6 * Math.cos(q.ry), sz = q.pos[2] - (k - 1) * 6 * Math.sin(q.ry);
        b.position.set(sx, y + 30, sz); b.rotation.set(Math.sin(t * 0.9 + k * 2) * 0.45, 0, Math.cos(t * 0.7 + k * 1.7) * 0.45);
      });
      showT += dt;
      if (showK && showT > 0.08) {
        showT = 0; const q = nav.plotBy[stagePid];
        if (q) { const y = gy(q.pos[0], q.pos[2], q.pos[1]), k = Math.floor(t * 31) % 4, an = t * 3.1; show.emit(q.pos[0] + Math.cos(an) * 6, y + 3, q.pos[2] + Math.sin(an) * 6, Math.cos(an) * 1.5, 7 + k, Math.sin(an) * 1.5, 1.8, 2.6, COLS[k]); }
      }
      // the trader
      const tr = S.events.active.find(e => e.type === 'trader');
      if (tr && !npc && pupsApi) { npc = pupsApi.npc({ id: 'trader', breed: 'pepper', collar: '#ffb347' }); }
      const stall = kitMesh('EG_MarketStall_B', 1);
      if (stall) stall.list.length = 0;
      if (npc) npc.visible = !!tr;
      if (tr) {
        const ts = traderSpot(S), sx = ts.stall[0], sz = ts.stall[2], yaw = Math.atan2(ts.out[0], ts.out[1]);
        if (stall) { Q.setFromAxisAngle(Y, yaw + Math.PI / 2); V.set(sx, gy(sx, sz, nav.TP[1]), sz); SC.setScalar(1.6); stall.list.push(M4.compose(V, Q, SC).clone()); }
        if (npc) {
          const wave = Math.sin(t * 0.8) > 0.6;
          npc.update({ p: ts.p, dir: ts.out, phase: wave ? 'tend' : 'watch', f: 0, walking: false, carry: null, task: null }, t, dt, (x, z, y) => gy(x, z, y));
        }
        if (Math.random() < dt * 1.5) sparks.emit(ts.p[0], gy(ts.p[0], ts.p[2], ts.p[1]) + 7, ts.p[2], 0, 1.5, 0, 1.2, 1.6, 0xffe680);
      }
      flushKit(stall);
      for (const p of [spores, sparks, notes, show, halo]) p.update(p === halo ? 0 : dt);
    };
    // who dances: resting / waiting pups within 34 m of a pup playing music (called before the pups are drawn)
    api.dance = poses => {
      const players = poses.filter(ps => ps.phase === 'play');
      for (const ps of poses) ps.dance = !!players.length && !ps.walking && (ps.phase === 'rest' || ps.phase === 'wait' || ps.phase === 'watch') && players.some(q => Math.hypot(q.p[0] - ps.p[0], q.p[2] - ps.p[2]) < 34);
    };
    // screen-space pick of a fruit (nearest within reach) -> {id, j}
    api.pickFruit = (mx, my, camera, W, H, reach) => {
      let best = null, bd = reach; const v = new THREE.Vector3();
      for (const f of api.fruit) { v.set(f.p[0], f.p[1], f.p[2]).project(camera); if (v.z > 1) continue; const d = Math.hypot((v.x + 1) / 2 * W - mx, (1 - v.y) / 2 * H - my); if (d < bd) { bd = d; best = f; } }
      return best;
    };
    api.sparkle = (p, color) => { for (let k = 0; k < 18; k++) { const an = k / 18 * 6.28; sparks.emit(p[0], p[1], p[2], Math.cos(an) * 4, 3 + (k % 4), Math.sin(an) * 4, 1.1, 1.8, color || 0xffe680); } };
    // night light sources: wards (crystal pillars glow)
    api.glowPieces = fn => { const k = kits['EG_CrystalPillar']; if (!k || !batchOf.EG_CrystalPillar.glow || !Object.keys(batchOf.EG_CrystalPillar.glow).length) return; k.list.forEach((m, j) => fn('EG_CrystalPillar', m, 'ward:' + j)); };
    return api;
  }
  window.NeedsFx = NeedsFx;
})();
