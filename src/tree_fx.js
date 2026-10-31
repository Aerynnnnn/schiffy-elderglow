// TreeFx: shows the tree's health without numbers. The EG_ElderTree batch and the EG_LightOrb batch get tint materials
// (ElderMap.makeTintMat: glow grey+dim -> bright cyan-gold, canopy dry brown -> full colour); halos over the light orbs
// follow the Light need; falling leaves when health is low, rising sparkles when thriving; a burst on level-up.
// The young tree is the elder tree scaled down (setScale rescales its instance; ElderMap culls with the new bounds).
(function () {
  'use strict';
  function glowTex(soft) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(soft ? 0.25 : 0.18, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function leafTex() {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(16, 16, 7, 13, 0.7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(8, 25); g.lineTo(24, 7); g.stroke();
    return new THREE.CanvasTexture(c);
  }
  // one Points cloud with per-point colour (rgb), alpha and size; positions/velocities managed on the CPU
  function Cloud(n, tex, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } }, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale;\n' +
        'void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a * t.r); if (gl_FragColor.a < 0.01) discard; }',
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    const P = []; for (let i = 0; i < n; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, s: 1, ph: 0, kind: 0 });
    let cursor = 0;
    return {
      pts, mat, P,
      spawn(o) { const p = P[cursor]; cursor = (cursor + 1) % n; Object.assign(p, { vx: 0, vy: 0, vz: 0, ph: Math.random() * 6.28, kind: 0 }, o); p.life = p.max; return p; },
      tick(dt, fn) {
        for (let i = 0; i < n; i++) {
          const p = P[i];
          if (p.life > 0) { p.life -= dt; fn(p, dt); p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
          const a = p.life > 0 ? Math.min(1, p.life / Math.min(1, p.max * 0.3)) * Math.min(1, (p.max - p.life) / 0.3) : 0;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = a * (p.a === undefined ? 1 : p.a);
          size[i] = p.life > 0 ? p.s : 0;
        }
        geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.size.needsUpdate = true;
      },
    };
  }

  function TreeFx(scene, map, nav) {
    const L = map.layout, TP = nav.TP;
    const treeU = { glow: { value: 1 }, leaf: { value: 1 }, boost: { value: 0 } };
    const orbU = { glow: { value: 1 }, leaf: { value: 1 }, boost: { value: 0 } };
    const treeB = map.batches.find(b => b.key === 'EG_ElderTree');
    const orbB = map.batches.find(b => b.key === 'EG_LightOrb');
    if (treeB && treeB.mesh) treeB.mesh.material = ElderMap.makeTintMat(treeU);
    if (orbB && orbB.mesh) orbB.mesh.material = ElderMap.makeTintMat(orbU);
    const treeInst = treeB ? treeB.inst.filter(i => i.role === 'tree') : [];
    const base = treeInst.map(i => ({ i, m: i.m.clone(), c: treeB.center.clone(), r: treeB.radius }));
    const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    let scale = 1;
    function setScale(s) {
      if (Math.abs(s - scale) < 1e-4) return; scale = s;
      for (const b of base) {
        b.m.decompose(_p, _q, _s); b.i.m.compose(_p, _q, _s.clone().multiplyScalar(s));
        b.i.c.copy(b.c).applyMatrix4(b.i.m); b.i.r = b.r * _s.x * s;
      }
      map.invalidate();
    }

    // ---- halos over the 10 light orbs (+ the shrine door)
    const GT = glowTex(false), ST = glowTex(true), LT = leafTex();
    const halos = [];
    for (const o of nav.orbs) {
      const pl = L.placements[o.pid] || { pos: o.orb, s: 1 };
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GT, color: 0xffe08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(pl.pos[0], pl.pos[1] + 1.72 * pl.s, pl.pos[2]); sp.userData = { base: 6 * pl.s, flash: 0 }; scene.add(sp); halos.push(sp);
    }
    const shrine = new THREE.Sprite(new THREE.SpriteMaterial({ map: ST, color: 0x9ff3ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(shrine);
    const crown = new THREE.Sprite(new THREE.SpriteMaterial({ map: ST, color: 0xfff0b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    scene.add(crown);
    const burstRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ST, color: 0xffe7a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    scene.add(burstRing);

    const leaves = Cloud(420, LT, false), sparks = Cloud(380, ST, true), splash = Cloud(120, ST, true);
    scene.add(leaves.pts, sparks.pts, splash.pts);
    let leafAcc = 0, sparkAcc = 0, burstT = 0, moteAcc = 0, seaAcc = 0;
    const canopy = () => ({ y0: TP[1] + 62 * scale, y1: TP[1] + 128 * scale, r: 52 * scale });

    // ---- step 5 growth stages: glowing fruit hung on the canopy's outer leaves (count per level), glow veins + crown
    // brighter per stage, glow motes rising from the canopy from Young on. Fruit spots = canopy vertices (swaying parts) on
    // the outer shell, picked once (deterministic), scaled with the tree.
    const FRUIT_N = [0, 0, 8, 14, 22, 32, 46, 64], STAGE_GLOW = [0, 0.04, 0.08, 0.12, 0.17, 0.22, 0.3, 0.4], MOTES = [0, 0, 1.5, 3, 5, 7, 11, 16];
    const fruitP = [];
    if (treeB && treeB.geo && base[0]) {
      const P = treeB.geo.attributes.position.array, SW = treeB.geo.attributes.swayW.array, M0 = base[0].m, v = new THREE.Vector3(), cand = [];
      for (let i = 0; i < SW.length; i += 5) if (SW[i] > 0.5) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; cand.push([x, y, z, Math.hypot(x, z)]); }
      // hanging under the canopy puffs, on the outside: the lower 40 % of the canopy's height, the outer half
      const ys = cand.map(c => c[1]).sort((a, b) => a - b), yCut = ys[Math.floor(ys.length * 0.4)] || 0;
      const low = cand.filter(c => c[1] <= yCut).sort((a, b) => b[3] - a[3]);
      const outer = low.slice(0, Math.max(64, Math.floor(low.length * 0.5)));
      for (let k = 0; k < 64 && outer.length; k++) {
        let best = null, bd = -1;
        for (let j = (k * 37) % 23; j < outer.length; j += 23) { const c = outer[j]; let dmin = 1e9; for (const f of fruitP) dmin = Math.min(dmin, Math.hypot(f.l[0] - c[0], f.l[1] - c[1], f.l[2] - c[2])); if (dmin > bd) { bd = dmin; best = c; } }
        if (!best) break; v.set(best[0], best[1] - 3.2, best[2]).applyMatrix4(M0); fruitP.push({ l: best, w: [v.x - TP[0], v.y - TP[1], v.z - TP[2]], ph: k * 1.7 });
      }
    }
    // fruit sprites: a toon fruit (ink outline + highlight + leaf) drawn solid, + an additive glow cloud behind it
    const FT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      g.fillStyle = '#7fd36a'; g.strokeStyle = '#2a2442'; g.lineWidth = 3; g.beginPath(); g.ellipse(40, 13, 10, 5, -0.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 38, 20, 0, Math.PI * 2); g.fill(); g.lineWidth = 4; g.stroke();
      g.fillStyle = '#fff6c0'; g.beginPath(); g.ellipse(25, 30, 6, 4, -0.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a2442'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 18); g.quadraticCurveTo(33, 12, 37, 9); g.stroke();
      const t = new THREE.CanvasTexture(c); return t; })();
    const fruitGeo = new THREE.BufferGeometry(), fPos = new Float32Array(64 * 3), fCol = new Float32Array(64 * 4), fSize = new Float32Array(64);
    fruitGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3).setUsage(THREE.DynamicDrawUsage)); fruitGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 4).setUsage(THREE.DynamicDrawUsage)); fruitGeo.setAttribute('size', new THREE.BufferAttribute(fSize, 1).setUsage(THREE.DynamicDrawUsage));
    const fruitMat = new THREE.ShaderMaterial({ uniforms: { map: { value: FT }, scale: { value: 600 }, glow: { value: 0 } }, transparent: false,
      vertexShader: 'attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale;\nvoid main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; uniform float glow; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.5 || vC.a < 0.01) discard; vec3 c = (t.r > 0.85 && t.b > 0.85) ? vC.rgb : t.rgb; gl_FragColor = vec4(c * (1.0 + glow * 0.6), 1.0); }' });
    const fruitPts = new THREE.Points(fruitGeo, fruitMat); fruitPts.frustumCulled = false; scene.add(fruitPts);
    const fruit = Cloud(64, GT, true); scene.add(fruit.pts);   // the glow behind each fruit
    const SEA_LEAF = { 0: [[1, 0.72, 0.84], [1, 0.86, 0.93], [0.98, 0.6, 0.78]], 2: [[0.96, 0.45, 0.14], [0.84, 0.24, 0.16], [1, 0.72, 0.22]] };

    const api = {
      treeU, orbU, setScale, get scale() { return scale; }, night: 0,   // night 0..1 (DayNight): halos, shrine + crown glow stronger
      level: 1, season: [0, 0, 0, 0],   // step 5: tree level (stage look) + season weights (spring petals, autumn leaves fall)
      fruitAt: k => { const f = fruitP[k]; return f ? [TP[0] + f.w[0] * scale, TP[1] + f.w[1] * scale, TP[2] + f.w[2] * scale] : null; },
      // h = smoothed health 0..100, light = smoothed light need 0..100
      update(t, dt, h, light, renderer) {
        const hk = Math.max(0, Math.min(1, (h - 15) / 70)), lv = Math.max(1, Math.min(8, api.level | 0));
        treeU.glow.value = hk; treeU.leaf.value = Math.max(0, Math.min(1, (h - 20) / 55));
        orbU.glow.value = Math.max(0, Math.min(1, light / 85));
        burstT = Math.max(0, burstT - dt);
        const bk = burstT > 0 ? Math.sin(Math.min(1, burstT / 3) * Math.PI) : 0;
        treeU.boost.value = bk * 1.2 + STAGE_GLOW[lv - 1] * hk * (1 + api.night * 0.5);
        // glowing fruit (a healthy tree shows them all, a struggling one only some), pulsing softly
        const nF = Math.min(fruitP.length, Math.round(FRUIT_N[lv - 1] * Math.max(0, Math.min(1, (h - 35) / 40))));
        for (let k = 0; k < 64; k++) {
          const p = fruit.P[k], f = fruitP[k];
          if (k < nF && f) { p.max = 1e6; p.life = 1e6 - 1; p.x = TP[0] + f.w[0] * scale; p.y = TP[1] + f.w[1] * scale + Math.sin(t * 1.3 + f.ph) * 0.25 * scale; p.z = TP[2] + f.w[2] * scale;
            const gold = k % 3 !== 0; p.r = 1; p.g = gold ? 0.82 : 0.62; p.b = gold ? 0.36 : 0.5; p.s = (11 + 2 * Math.sin(t * 2 + f.ph)) * (0.35 + scale * 0.65); p.a = 0.35 + api.night * 0.4;
            fPos[k * 3] = p.x; fPos[k * 3 + 1] = p.y; fPos[k * 3 + 2] = p.z; fCol[k * 4] = 1; fCol[k * 4 + 1] = gold ? 0.8 : 0.58; fCol[k * 4 + 2] = gold ? 0.3 : 0.42; fCol[k * 4 + 3] = 1; fSize[k] = 5.2 * (0.35 + scale * 0.65); }
          else { p.life = 0; fSize[k] = 0; fCol[k * 4 + 3] = 0; }
        }
        fruit.tick(0, () => {}); fruitGeo.attributes.position.needsUpdate = fruitGeo.attributes.color.needsUpdate = fruitGeo.attributes.size.needsUpdate = true;
        fruitMat.uniforms.glow.value = api.night; fruitMat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(Math.PI / 180 * 20));
        fruit.mat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(Math.PI / 180 * 20));
        for (const sp of halos) {
          sp.userData.flash = Math.max(0, sp.userData.flash - dt * 0.7);
          const k = orbU.glow.value * (0.85 + 0.15 * Math.sin(t * 2 + sp.position.x)) + sp.userData.flash * 1.5;
          sp.material.opacity = Math.min(1, 0.15 + k * 0.75 + api.night * 0.2 * orbU.glow.value); sp.scale.setScalar(sp.userData.base * (0.5 + k * 0.7) * (1 + api.night * 0.6 * orbU.glow.value));
        }
        const dp = nav.door(scale).p;
        shrine.position.set(dp[0] + (TP[0] - dp[0]) * 0.1, dp[1] + 4 * scale + 2, dp[2] + (TP[2] - dp[2]) * 0.1);
        shrine.material.opacity = Math.min(1, 0.15 + hk * 0.6 + api.night * 0.3 * hk); shrine.scale.setScalar((10 + hk * 10) * scale + 4);
        const cp = canopy();
        crown.position.set(TP[0], (cp.y0 + cp.y1) / 2, TP[2]); crown.scale.setScalar(cp.r * 3.2);
        crown.material.opacity = Math.max(0, (h - 70) / 30) * (0.3 + api.night * 0.25) * (0.8 + STAGE_GLOW[lv - 1]) + bk * 0.6;
        burstRing.position.copy(crown.position); burstRing.material.opacity = bk * 0.8; burstRing.scale.setScalar(cp.r * (2 + (3 - Math.min(3, burstT)) * 2.2));
        // falling leaves when health < 55 (more the worse it is), sparkles when >= 72
        leafAcc += dt * Math.min(1, Math.max(0, (58 - h) / 35)) * 45;
        while (leafAcc > 1) {
          leafAcc--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cp.r;
          const brown = Math.random();
          leaves.spawn({ x: TP[0] + Math.cos(a) * rr, y: cp.y0 + Math.random() * (cp.y1 - cp.y0) * 0.7, z: TP[2] + Math.sin(a) * rr, vy: -2.2 - Math.random() * 1.5,
            max: 14, s: 2.2 + Math.random() * 1.6, r: 0.75 + brown * 0.2, g: 0.45 + brown * 0.25, b: 0.18, a: 1, kind: 1 });
        }
        sparkAcc += dt * Math.max(0, (h - 72) / 28) * 40;
        while (sparkAcc > 1) {
          sparkAcc--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cp.r * 1.1, gold = Math.random() < 0.5;
          sparks.spawn({ x: TP[0] + Math.cos(a) * rr, y: TP[1] + Math.random() * (cp.y1 - TP[1]), z: TP[2] + Math.sin(a) * rr, vy: 0.8 + Math.random(), max: 3 + Math.random() * 2,
            s: 1.6 + Math.random() * 1.8, r: gold ? 1 : 0.6, g: gold ? 0.88 : 1, b: gold ? 0.5 : 1, a: 0.9 });
        }
        // stage: glow motes drift up out of the canopy (Young and up), more the bigger the tree
        moteAcc += dt * MOTES[lv - 1] * hk;
        while (moteAcc > 1) {
          moteAcc--; const a = Math.random() * 6.28, rr = (0.3 + Math.sqrt(Math.random()) * 0.8) * cp.r, cy = Math.random() < 0.5;
          sparks.spawn({ x: TP[0] + Math.cos(a) * rr, y: cp.y0 + Math.random() * (cp.y1 - cp.y0) * 0.8, z: TP[2] + Math.sin(a) * rr, vy: 1.2 + Math.random() * 1.2, max: 5 + Math.random() * 3,
            s: 1.2 + Math.random() * 1.4, r: cy ? 0.55 : 1, g: cy ? 1 : 0.9, b: cy ? 0.95 : 0.55, a: 0.8 });
        }
        // seasons: spring petals + autumn leaves drift down from the canopy (healthy tree; on top of the sick-leaf fall)
        const sw = api.season, pk = sw[0] > sw[2] ? 0 : 2, sk = Math.max(sw[0], sw[2]);
        seaAcc += dt * sk * 14 * (0.3 + hk * 0.7);
        while (seaAcc > 1) {
          seaAcc--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cp.r * 1.05, c = SEA_LEAF[pk][Math.floor(Math.random() * 3)];
          leaves.spawn({ x: TP[0] + Math.cos(a) * rr, y: cp.y0 + Math.random() * (cp.y1 - cp.y0) * 0.7, z: TP[2] + Math.sin(a) * rr, vy: pk ? -2.4 - Math.random() * 1.4 : -1.4 - Math.random(),
            max: 18, s: pk ? 2 + Math.random() * 1.4 : 1.4 + Math.random(), r: c[0], g: c[1], b: c[2], a: 1, kind: 1 });
        }
        const gy = TP[1] + 0.3;
        leaves.tick(dt, (p, d) => { p.vx = Math.sin(t * 1.3 + p.ph) * 2.2; p.vz = Math.cos(t * 1.1 + p.ph) * 1.6; if (p.y < gy) { p.y = gy; p.vy = 0; p.vx = p.vz = 0; p.life = Math.min(p.life, 1.2); } });
        sparks.tick(dt, (p, d) => { p.vx = Math.sin(t * 2 + p.ph) * 0.6; p.s *= 1 - d * 0.1; });
        splash.tick(dt, (p, d) => { p.vy -= 18 * d; if (p.y < p.gy) { p.y = p.gy; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; } });
        const sc = renderer.domElement.height / (2 * Math.tan(Math.PI / 180 * 20));
        leaves.mat.uniforms.scale.value = sparks.mat.uniforms.scale.value = splash.mat.uniforms.scale.value = sc;   // size = world diameter
      },
      flashOrb(pid) { const k = nav.orbs.findIndex(o => o.pid === pid); if (k >= 0) halos[k].userData.flash = 1; },
      splash(x, y, z) {
        for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, v = 2 + Math.random() * 3;
          splash.spawn({ x, y: y + 1, z, gy: y + 0.2, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 5 + Math.random() * 4, max: 0.9 + Math.random() * 0.4, s: 0.9 + Math.random() * 0.6, r: 0.5, g: 0.88, b: 1, a: 0.9 }); }
        for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; sparks.spawn({ x: x + Math.cos(a) * 2, y: y + Math.random() * 3, z: z + Math.sin(a) * 2, vy: 2, max: 1.5, s: 1.4, r: 0.6, g: 1, b: 1, a: 1 }); }
      },
      burst() {
        burstT = 3; const cp = canopy();
        for (let i = 0; i < 220; i++) { const a = Math.random() * 6.28, el = Math.random() * 1.2 - 0.3, v = 8 + Math.random() * 18, gold = Math.random() < 0.6;
          sparks.spawn({ x: TP[0], y: (cp.y0 + cp.y1) / 2, z: TP[2], vx: Math.cos(a) * Math.cos(el) * v, vy: Math.sin(el) * v, vz: Math.sin(a) * Math.cos(el) * v,
            max: 2 + Math.random() * 2, s: 2 + Math.random() * 2, r: gold ? 1 : 0.6, g: gold ? 0.86 : 1, b: gold ? 0.45 : 1, a: 1 }); }
      },
      canopy,
    };
    return api;
  }
  window.TreeFx = TreeFx;
})();
