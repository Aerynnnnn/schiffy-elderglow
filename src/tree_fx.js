// TreeFx: shows the tree's health without numbers. The EG_ElderTree batch and the EG_LightOrb batch get tint materials
// (ElderMap.makeTintMat: glow grey+dim -> bright cyan-gold, canopy dry brown -> full colour); halos over the light orbs
// follow the Light need; falling leaves when health is low, rising sparkles when thriving; a burst on level-up.
// The young tree is the elder tree scaled down (setScale rescales its instance; ElderMap culls with the new bounds) AND
// grown by parts (2026-11-01, see "tree growth" below): thin trunk, short roots, canopy tiers opening, hanging lanterns.
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
        // vibe pass 1: a point close to the camera fades out (5 -> 16 m) and never grows past ~1/9 of the screen (no giant blobs in follow / close views)
        'void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); vC.a *= smoothstep(8.0, 30.0, -mv.z); gl_PointSize = min(size * scale / max(1.0, -mv.z), scale * 0.05); gl_Position = projectionMatrix * mv; }',
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

  // ---- tree growth (2026-11-01): the ONE EG_ElderTree model grows by parts in the vertex shader, driven by G = 0 (a fresh
  // Sapling) .. 4 (the Elder Tree), see growthOf. Piece space (y up, trunk axis at x = z = 0, ground y 0):
  //   wood (trunk blob, limbs, roots) = radial squeeze: inside the trunk core (CORE m) by kT (thin trunk) easing to kB at the
  //     foot (the shrine door keeps some width), beyond the core by kR (roots, y < 30) or by spread x rev(y) (limbs, y > 58);
  //     above 8 m the height is stretched by hY;
  //   canopy clusters (swaying, pivot swayP) = moved with their limb, scaled about it by rev(pivot y) x cK: layers open top down
  //     (rev: the crown at G 0, the lowest tier by G ~3);
  //   small parts (shrooms, cage orbs, spores: gAnc.w = 1, anchor = their centre) = moved with the wood, scaled by pK.
  // VIEW only: nav / sim keep Sim.C.SCALE (the instance's uniform scale), and the squeeze only ever pulls the foot in, so
  // trunkR, the door, treeClear and Needs.C.ROOT stay right. JS mirrors the GLSL (fruit, lanterns, canopy()).
  const CORE = 22;
  // stage table at G = 0 Sapling, 1 Young, 2 Grown, 3 Great, 4 Elder (linear in between); the Elder is ~1.28x the old tree
  const ST = { kT: [0.3, 0.42, 0.7, 0.92, 1], kB: [0.62, 0.7, 0.84, 0.97, 1], kR: [0.28, 0.36, 0.5, 1.05, 1.12], hY: [0.62, 0.8, 0.95, 1.08, 1.3],
    sp: [0.5, 0.56, 0.78, 1, 1.3], cK: [0.55, 0.62, 0.86, 1, 1.18], pK: [0.5, 0.6, 0.85, 1, 1.1] };
  const GB = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4];   // G at the start of each level; inside a level it creeps 40 % of the way (the rest = the level-up moment)
  function growthOf(S) {
    const lv = Math.max(1, Math.min(8, S.level | 0)); if (lv >= 8) return 4;
    const X = Sim.C.LV_XP, f = Math.max(0, Math.min(1, (S.xp - X[lv - 1]) / Math.max(1, X[lv] - X[lv - 1])));
    return GB[lv - 1] + f * (GB[lv] - GB[lv - 1]) * 0.4;
  }
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const revOf = (y, G) => { const T = Math.max(0, Math.min(1, (130 - y) / 64)) * 3.0 - 0.85; return sm(T, T + 0.9, G); };
  function paramsOf(G) {
    const g = Math.max(0, Math.min(4, G)), i = Math.min(3, Math.floor(g)), f = g - i, o = { G: g };
    for (const k in ST) o[k] = ST[k][i] + (ST[k][i + 1] - ST[k][i]) * f;
    return o;
  }
  function woodJS(x, y, z, P, out) {
    const r = Math.hypot(x, z), dx = r > 1e-4 ? x / r : 0, dz = r > 1e-4 ? z / r : 0;
    const kTy = P.kB + (P.kT - P.kB) * sm(6, 34, y), kO = P.kR + (P.sp * revOf(y, P.G) - P.kR) * sm(30, 58, y);
    const r2 = r <= CORE ? r * kTy : CORE * kTy + (r - CORE) * kO;
    out[0] = dx * r2; out[1] = y < 8 ? y : 8 + (y - 8) * P.hY; out[2] = dz * r2; return out;
  }
  function canopyJS(p, piv, P, out) {   // a canopy vertex p of the cluster hung at piv
    woodJS(piv[0], piv[1], piv[2], P, out); const c = revOf(piv[1], P.G) * P.cK;
    out[0] += (p[0] - piv[0]) * c; out[1] += (p[1] - piv[1]) * c; out[2] += (p[2] - piv[2]) * c; return out;
  }
  const GROW_DECL = `attribute vec4 gAnc;
uniform vec4 uGa;   // kT, kB, kR, hY
uniform vec4 uGb;   // G, spread, cK, pK
float egRev(float y) { float T = clamp((130.0 - y) / 64.0, 0.0, 1.0) * 3.0 - 0.85; return smoothstep(T, T + 0.9, uGb.x); }
vec3 egWood(vec3 p) {
  float r = length(p.xz); vec2 d = r > 1e-4 ? p.xz / r : vec2(0.0);
  float kTy = mix(uGa.y, uGa.x, smoothstep(6.0, 34.0, p.y)), kO = mix(uGa.z, uGb.y * egRev(p.y), smoothstep(30.0, 58.0, p.y));
  float r2 = r <= ${CORE.toFixed(1)} ? r * kTy : ${CORE.toFixed(1)} * kTy + (r - ${CORE.toFixed(1)}) * kO;
  return vec3(d.x * r2, p.y < 8.0 ? p.y : 8.0 + (p.y - 8.0) * uGa.w, d.y * r2);
}
`;
  const GROW_VS = `
    vec3 gSwayP = swayP;
    if (swayW > 0.5) { gSwayP = egWood(swayP); transformed = gSwayP + (transformed - swayP) * (egRev(swayP.y) * uGb.z); }
    else if (gAnc.w > 0.5) { transformed = egWood(gAnc.xyz) + (transformed - gAnc.xyz) * (uGb.w * (gAnc.y > 50.0 ? egRev(gAnc.y) : 1.0)); }
    else transformed = egWood(transformed);
`;
  // gAnc per vertex: small separate parts (welded by position, bounding radius < 9 m, not canopy) get their centre + w = 1
  function addAnchors(geo) {
    if (!geo || geo.attributes.gAnc) return;
    const P = geo.attributes.position.array, SW = geo.attributes.swayW.array, I = geo.index.array, n = P.length / 3, par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const weld = new Map();
    for (let i = 0; i < n; i++) { const k = Math.round(P[i * 3] * 200) + ',' + Math.round(P[i * 3 + 1] * 200) + ',' + Math.round(P[i * 3 + 2] * 200); const j = weld.get(k); if (j === undefined) weld.set(k, i); else uni(i, j); }
    for (let t = 0; t < I.length; t += 3) { uni(I[t], I[t + 1]); uni(I[t], I[t + 2]); }
    const C = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i); let c = C.get(r); if (!c) C.set(r, c = { n: 0, x: 0, y: 0, z: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], sw: 0 });
      c.n++; c.x += P[i * 3]; c.y += P[i * 3 + 1]; c.z += P[i * 3 + 2]; c.sw += SW[i];
      for (let a = 0; a < 3; a++) { c.lo[a] = Math.min(c.lo[a], P[i * 3 + a]); c.hi[a] = Math.max(c.hi[a], P[i * 3 + a]); }
    }
    const A = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = C.get(find(i)); if (c.sw > 0 || Math.hypot(c.hi[0] - c.lo[0], c.hi[1] - c.lo[1], c.hi[2] - c.lo[2]) / 2 >= 9) continue;
      A[i * 4] = c.x / c.n; A[i * 4 + 1] = c.y / c.n; A[i * 4 + 2] = c.z / c.n; A[i * 4 + 3] = 1;
    }
    geo.setAttribute('gAnc', new THREE.BufferAttribute(A, 4));
  }

  function TreeFx(scene, map, nav) {
    const L = map.layout, TP = nav.TP;
    // vibe 2 lane C: + sway (the canopy's own sway multiplier) + rim (a warm fresnel edge: golden hour, the tree speaking)
    const treeU = { glow: { value: 1 }, leaf: { value: 1 }, boost: { value: 0 }, sway: { value: 1 }, rim: { value: new THREE.Vector4(1, 0.8, 0.46, 0) } };
    const orbU = { glow: { value: 1 }, leaf: { value: 1 }, boost: { value: 0 } };
    const uGa = { value: new THREE.Vector4(1, 1, 1, 1) }, uGb = { value: new THREE.Vector4(4, 1, 1, 1) };
    // the tree's materials (tint, ink, shadow depth) get the growth code right after <begin_vertex>, before the sway, which
    // then turns each cluster about its MOVED pivot (the season colour seed keeps the original swayP)
    const growMat = (m, depth) => {
      const ob = m.onBeforeCompile, ck = m.customProgramCacheKey;
      m.onBeforeCompile = (s, r) => {
        if (ob) ob.call(m, s, r);
        s.uniforms.uGa = uGa; s.uniforms.uGb = uGb;
        s.vertexShader = (depth ? 'attribute vec3 swayP;\nattribute float swayW;\n' : '') + GROW_DECL + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GROW_VS)
          .split('vec3 q = transformed - swayP;').join('vec3 q = transformed - gSwayP;').split('transformed = swayP + q;').join('transformed = gSwayP + q;');
      };
      m.customProgramCacheKey = () => (ck ? ck.call(m) : '') + '-grow' + (depth ? 'D' : '');
      return m;
    };
    const treeB = map.batches.find(b => b.key === 'EG_ElderTree');
    const orbB = map.batches.find(b => b.key === 'EG_LightOrb');
    if (treeB) { addAnchors(treeB.geo); addAnchors(treeB.ink); }
    if (treeB && treeB.mesh) {
      treeB.mesh.material = growMat(ElderMap.makeTintMat(treeU));
      treeB.mesh.customDepthMaterial = growMat(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), true);   // its shadow grows too
    }
    if (treeB && treeB.inkMesh && ElderMap.makeInkMat) treeB.inkMesh.material = growMat(ElderMap.makeInkMat(treeU.sway));   // its ink hull sways (and grows) with it
    if (orbB && orbB.mesh) orbB.mesh.material = ElderMap.makeTintMat(orbU);
    const treeInst = treeB ? treeB.inst.filter(i => i.role === 'tree') : [];
    const base = treeInst.map(i => ({ i, m: i.m.clone(), c: treeB.center.clone(), r: treeB.radius }));
    const M0 = base[0] ? base[0].m : new THREE.Matrix4().makeTranslation(TP[0], TP[1], TP[2]);
    const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    let scale = 1, G = 4, P = paramsOf(4), gen = 0, anim = null;   // gen: bumps whenever the shape changed (cached points re-made)
    function applyShape() {
      uGa.value.set(P.kT, P.kB, P.kR, P.hY); uGb.value.set(P.G, P.sp, P.cK, P.pK);
      const vk = Math.max(1, P.hY, P.sp * 1.1);   // culling bounds: the grown shape reaches past the model's own sphere
      for (const b of base) { b.m.decompose(_p, _q, _s); b.i.m.compose(_p, _q, _s.clone().multiplyScalar(scale)); b.i.c.copy(b.c).applyMatrix4(b.i.m); b.i.r = b.r * _s.x * scale * vk; }
      map.invalidate(); gen++;
    }
    // setScale(s, g): jump to sim scale s (+ growth g if given); tick() eases / animates toward them
    function setScale(s, g) {
      const gg = g === undefined ? G : Math.max(0, Math.min(4, g));
      if (Math.abs(s - scale) < 1e-4 && Math.abs(gg - G) < 1e-4) return; scale = s; G = gg; P = paramsOf(G); anim = null; applyShape();
    }
    // the world position of a piece-space point (wood or a canopy point of the cluster at piv), for the current shape
    const _o = [0, 0, 0], _w = new THREE.Vector3();
    function toWorld(local, out) { _w.set(local[0], local[1], local[2]).applyMatrix4(M0); out[0] = TP[0] + (_w.x - TP[0]) * scale; out[1] = TP[1] + (_w.y - TP[1]) * scale; out[2] = TP[2] + (_w.z - TP[2]) * scale; return out; }

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
    let leafAcc = 0, sparkAcc = 0, burstT = 0, moteAcc = 0, seaAcc = 0, spk = 0, spkT = 0, spiralAcc = 0, growAcc = 0;
    // canopy pivots (piece space), for canopy() = the band the OPEN clusters fill (leaves, crown glow, god rays, the camera)
    const pivots = [];
    if (treeB && treeB.geo) { const SP = treeB.geo.attributes.swayP.array, SW = treeB.geo.attributes.swayW.array, seen = new Set();
      for (let i = 0; i < SW.length; i++) if (SW[i] > 0.5) { const k = SP[i * 3].toFixed(1) + ',' + SP[i * 3 + 1].toFixed(1) + ',' + SP[i * 3 + 2].toFixed(1); if (!seen.has(k)) { seen.add(k); pivots.push([SP[i * 3], SP[i * 3 + 1], SP[i * 3 + 2]]); } } }
    let cpGen = -1, cpVal = null;
    const canopy = () => {
      if (cpGen === gen && cpVal) return cpVal;
      let y0 = 1e9, y1 = -1e9, r = 0; const w = [0, 0, 0];
      for (const pv of pivots) { const c = revOf(pv[1], P.G) * P.cK; if (c < 0.25) continue; woodJS(pv[0], pv[1], pv[2], P, w);
        y0 = Math.min(y0, w[1] - 6 * c); y1 = Math.max(y1, w[1] + 22 * c); r = Math.max(r, Math.hypot(w[0], w[2]) + 30 * c); }
      if (y1 < y0) { y0 = 62; y1 = 128; r = 52; } else r *= 0.8;
      cpGen = gen; return (cpVal = { y0: TP[1] + y0 * scale, y1: TP[1] + y1 * scale, r: r * scale });
    };

    // ---- step 5 growth stages: glowing fruit hung on the canopy's outer leaves (count per level), glow veins + crown
    // brighter per stage, glow motes rising from the canopy from Young on. Fruit spots = canopy vertices (swaying parts) on
    // the outer shell, picked once (deterministic), scaled with the tree.
    const FRUIT_N = [0, 0, 8, 14, 22, 32, 46, 64], STAGE_GLOW = [0, 0.04, 0.08, 0.12, 0.17, 0.22, 0.3, 0.4], MOTES = [0, 0, 1.5, 3, 5, 7, 11, 16];
    const fruitP = [];
    if (treeB && treeB.geo && base[0]) {
      const P = treeB.geo.attributes.position.array, SW = treeB.geo.attributes.swayW.array, SP = treeB.geo.attributes.swayP.array, cand = [];
      for (let i = 0; i < SW.length; i += 5) if (SW[i] > 0.5) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; cand.push([x, y, z, Math.hypot(x, z), [SP[i * 3], SP[i * 3 + 1], SP[i * 3 + 2]]]); }
      // hanging under the canopy puffs, on the outside: the lower 40 % of the canopy's height, the outer half
      const ys = cand.map(c => c[1]).sort((a, b) => a - b), yCut = ys[Math.floor(ys.length * 0.4)] || 0;
      const low = cand.filter(c => c[1] <= yCut).sort((a, b) => b[3] - a[3]);
      const outer = low.slice(0, Math.max(64, Math.floor(low.length * 0.5)));
      for (let k = 0; k < 64 && outer.length; k++) {
        let best = null, bd = -1;
        for (let j = (k * 37) % 23; j < outer.length; j += 23) { const c = outer[j]; let dmin = 1e9; for (const f of fruitP) dmin = Math.min(dmin, Math.hypot(f.l[0] - c[0], f.l[1] - c[1], f.l[2] - c[2])); if (dmin > bd) { bd = dmin; best = c; } }
        if (!best) break; fruitP.push({ l: best, h: [best[0], best[1] - 3.2, best[2]], piv: best[4], w: [0, 0, 0], ph: k * 1.7, open: 0 });
      }
    }
    let fruitGen = -1;
    function fruitPlace() {   // world spots of the fruit for the current shape (+ how open its cluster is)
      if (fruitGen === gen) return; fruitGen = gen;
      for (const f of fruitP) { canopyJS(f.h, f.piv, P, _o); toWorld(_o, f.w); f.open = revOf(f.piv[1], P.G); }
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

    // ---- hanging lanterns (Great: the first 14, Elder: all 26): paper lanterns on ropes under the lower canopy tiers, one
    // instanced kit-style batch (Glow paper = lit at night) + ink + one additive halo cloud; they sway on their ropes
    const LN = 26, lanA = [];
    if (treeB && treeB.geo) {
      const Pp = treeB.geo.attributes.position.array, SW = treeB.geo.attributes.swayW.array, SP = treeB.geo.attributes.swayP.array, low = new Map();
      for (let i = 0; i < SW.length; i++) {   // per cluster of the lower tiers: its lowest vertex out past the pivot (the cluster's underside, outside)
        if (SW[i] < 0.5 || SP[i * 3 + 1] > 112) continue;
        const k = SP[i * 3].toFixed(1) + ',' + SP[i * 3 + 2].toFixed(1), x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2];
        if (Math.hypot(x, z) < Math.hypot(SP[i * 3], SP[i * 3 + 2]) + 6) continue;
        const c = low.get(k); if (!c || y < c.p[1]) low.set(k, { p: [x, y + 2.5, z], piv: [SP[i * 3], SP[i * 3 + 1], SP[i * 3 + 2]] });
      }
      const L2 = [...low.values()].sort((a, b) => Math.atan2(a.p[2], a.p[0]) - Math.atan2(b.p[2], b.p[0]));
      for (let k = 0; k < Math.min(LN, L2.length); k++) lanA.push(Object.assign(L2[(k * 11) % L2.length], { k, top: [0, 0, 0], ph: k * 2.3, len: 0.85 + ((k * 7) % 5) * 0.09 }));
    }
    const lanAt = k => k < 14 ? 2.72 + 0.26 * k / 13 : 3.3 + 0.6 * (k - 14) / 11;   // G where lantern k appears
    const LAN_TOP = 2.6;   // local: rope top above the body's centre (the body is ~1.1 tall, ~1 wide)
    let lanMesh = null, lanInk = null, lanGen = -1;
    const lanHalo = Cloud(LN, GT, true); scene.add(lanHalo.pts);
    if (lanA.length && ElderMap.kitBatch) {
      const mt = (hex, name) => { const m = new THREE.MeshBasicMaterial({ color: hex }); m.name = name || 'Lantern'; m.color.convertSRGBToLinear(); return m; };
      const g = new THREE.Group(), add = (geo, m, y, sx, sy) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.scale.set(sx || 1, sy || 1, sx || 1); g.add(o); };
      const paper = new THREE.LatheGeometry([[0.12, -0.55], [0.38, -0.42], [0.5, -0.15], [0.52, 0.1], [0.44, 0.36], [0.16, 0.5]].map(q => new THREE.Vector2(q[0], q[1])), 12);
      add(paper, mt(0xffb45a, 'GlowWarmLantern'), 0);
      for (const y of [-0.2, 0.12]) add(new THREE.TorusGeometry(0.505, 0.03, 4, 14).rotateX(Math.PI / 2), mt(0xc0563e), y, y < 0 ? 0.96 : 1);
      add(new THREE.CylinderGeometry(0.2, 0.26, 0.14, 10), mt(0x7a3a2c), 0.57);
      add(new THREE.ConeGeometry(0.3, 0.2, 10), mt(0x7a3a2c), 0.72);
      add(new THREE.CylinderGeometry(0.16, 0.12, 0.1, 10), mt(0x7a3a2c), -0.6);
      add(new THREE.ConeGeometry(0.07, 0.36, 6).rotateX(Math.PI), mt(0xe0503a), -0.85);
      add(new THREE.CylinderGeometry(0.025, 0.025, LAN_TOP - 0.8, 4), mt(0x5a3a2a, 'Rope'), 0.8 + (LAN_TOP - 0.8) / 2);
      const b = ElderMap.kitBatch('tree:lanterns', g, null, false);
      if (b && b.geo) {
        lanMesh = new THREE.InstancedMesh(b.geo, ElderMap.kitLitMat(), LN); lanMesh.count = 0; lanMesh.visible = false; lanMesh.frustumCulled = false; lanMesh.castShadow = false; lanMesh.receiveShadow = true;   // no shadow: a speck under a 200 m crown, a draw saved scene.add(lanMesh);
        if (b.ink) { lanInk = new THREE.InstancedMesh(b.ink, ElderMap.inkMat, LN); lanInk.instanceMatrix = lanMesh.instanceMatrix; lanInk.count = 0; lanInk.visible = false; lanInk.frustumCulled = false; scene.add(lanInk); }
      }
    }
    const _lm = new THREE.Matrix4(), _lr = new THREE.Matrix4(), _ls = new THREE.Matrix4(), _le = new THREE.Euler(), _lv = new THREE.Vector3();
    function lanterns(t) {
      if (!lanMesh) return;
      if (lanGen !== gen) { lanGen = gen; for (const a of lanA) { canopyJS(a.p, a.piv, P, _o); toWorld(_o, a.top); } }
      let n = 0;
      for (const a of lanA) {
        const k = sm(lanAt(a.k), lanAt(a.k) + 0.22, G), hp = lanHalo.P[a.k];
        if (k < 0.01) { hp.life = 0; continue; }
        const u = 8.5 * scale * a.len * (0.3 + 0.7 * k);   // ~9 m tall at the Elder (reads from the home view), grows in as it appears
        _le.set(Math.sin(t * 0.8 + a.ph) * 0.06, 0, Math.cos(t * 0.65 + a.ph) * 0.06);
        _lm.makeTranslation(a.top[0], a.top[1], a.top[2]).multiply(_lr.makeRotationFromEuler(_le)).multiply(_ls.makeScale(u, u, u)).multiply(_lr.makeTranslation(0, -LAN_TOP, 0));
        _lm.toArray(lanMesh.instanceMatrix.array, 16 * n); n++;
        _lv.set(0, 0, 0).applyMatrix4(_lm);
        hp.max = 1e6; hp.life = 1e6 - 1; hp.x = _lv.x; hp.y = _lv.y; hp.z = _lv.z; hp.r = 1; hp.g = 0.72; hp.b = 0.36; hp.s = u * 2.6; hp.a = (0.16 + api.night * 0.6) * k;
      }
      lanMesh.count = n; lanMesh.visible = n > 0; lanMesh.instanceMatrix.needsUpdate = true;
      if (lanInk) { lanInk.count = n; lanInk.visible = n > 0; }
      lanHalo.tick(0, () => {});
    }

    // ---- easing / the level-up growth moment: a jump of > 0.08 in G plays over GROW_S seconds (after api.holdT, so it starts
    // as the level-up camera arrives): the tree swells, glows and sheds sparks up the trunk; small changes creep
    const GROW_S = 3.6;
    function tick(sT, gT, dt) {
      if (anim && gT - anim.g1 > 0.08) anim = null;   // a level-up while still growing: a new moment from here
      if (anim) {
        if (anim.hold > 0) anim.hold -= dt; else anim.t += dt;
        const k = Math.max(0, Math.min(1, anim.t / GROW_S)), e = k * k * k * (k * (k * 6 - 15) + 10);
        scale = anim.s0 + (anim.s1 - anim.s0) * e; G = anim.g0 + (anim.g1 - anim.g0) * e; P = paramsOf(G); applyShape();
        if (k >= 1) anim = null;
        return;
      }
      if (gT - G > 0.08) { anim = { g0: G, g1: gT, s0: scale, s1: sT, t: 0, hold: api.holdT || 0 }; api.holdT = 0; return; }
      const ds = sT - scale, dg = gT - G;
      if (Math.abs(ds) < 1e-4 && Math.abs(dg) < 1e-4) return;
      scale += Math.abs(ds) < 1e-4 ? ds : ds * Math.min(1, dt * 1.2) + Math.sign(ds) * 1e-4;
      G = dg < 0 ? gT : G + dg * Math.min(1, dt * 0.6) + Math.sign(dg) * 1e-5; P = paramsOf(G); applyShape();
    }
    const growK = () => anim && anim.hold <= 0 ? Math.sin(Math.min(1, anim.t / GROW_S) * Math.PI) : 0;   // 0..1..0 over the growth moment

    const api = {
      treeU, orbU, setScale, get scale() { return scale; }, night: 0,   // night 0..1 (DayNight): halos, shrine + crown glow stronger
      level: 1, season: [0, 0, 0, 0],   // step 5: tree level (stage look) + season weights (spring petals, autumn leaves fall)
      speak: false, golden: 0, health: 80, get speakK() { return spk; },   // vibe 2 lane C: speaking (game.js), golden rim (light_fx.js)
      // growth: tick(sim scale, growthOf(S), dt) every frame; holdT = seconds the next growth moment waits (levelUp's camera fly)
      tick, holdT: 0, get growth() { return G; }, get growing() { return !!anim; }, params: () => Object.assign({}, P),
      // the visual height (world m above the trunk foot) + crown radius at growth g / scale s (default: as shown): camera framing
      size(g, s) { const p = g === undefined ? P : paramsOf(g), sc = s === undefined ? scale : s; let y1 = 0, r = 0; const w = [0, 0, 0];
        for (const pv of pivots) { const c = revOf(pv[1], p.G) * p.cK; if (c < 0.25) continue; woodJS(pv[0], pv[1], pv[2], p, w); y1 = Math.max(y1, w[1] + 24 * c); r = Math.max(r, Math.hypot(w[0], w[2]) + 36 * c); }
        return { h: (y1 || 156) * sc, r: (r || 90) * sc }; },
      fruitAt: k => { fruitPlace(); const f = fruitP[k]; return f ? f.w.slice() : null; },
      // h = smoothed health 0..100, light = smoothed light need 0..100
      update(t, dt, h, light, renderer) {
        const hk = Math.max(0, Math.min(1, (h - 15) / 70)), lv = Math.max(1, Math.min(8, api.level | 0));
        treeU.glow.value = hk; treeU.leaf.value = Math.max(0, Math.min(1, (h - 20) / 55));
        orbU.glow.value = Math.max(0, Math.min(1, light / 85));
        burstT = Math.max(0, burstT - dt);
        const bk = burstT > 0 ? Math.sin(Math.min(1, burstT / 3) * Math.PI) : 0;
        // vibe 2 lane C: the tree speaking (api.speak 0/1 from game.js) = canopy glows + sways, a warm rim, leaves spiral down
        // (strong for the first ~12 s of the words, then a gentle glow while the bubble stays open)
        api.health = h; spkT = api.speak ? spkT + dt : 0; const spkTo = api.speak ? (spkT < 12 ? 1 : 0.35) : 0;
        spk += (spkTo - spk) * Math.min(1, dt * (spkTo > spk ? 1.1 : 0.45));
        const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);
        const gk = growK();
        treeU.boost.value = bk * 1.2 + STAGE_GLOW[lv - 1] * hk * (1 + api.night * 0.5) + spk * (0.28 + 0.14 * breathe) + gk * 0.7;
        treeU.sway.value = 1 + spk * 2.6;
        treeU.rim.value.w = (api.golden || 0) + spk * (0.32 + 0.1 * breathe);
        spiralAcc += dt * spk * spk * 16;
        // glowing fruit (a healthy tree shows them all, a struggling one only some), pulsing softly
        const nF = Math.min(fruitP.length, Math.round(FRUIT_N[lv - 1] * Math.max(0, Math.min(1, (h - 35) / 40))));
        fruitPlace(); let shown = 0;   // fruit only hangs on open canopy clusters
        for (let k = 0; k < 64; k++) {
          const p = fruit.P[k], f = fruitP[k];
          if (f && shown < nF && f.open > 0.85) { shown++; p.max = 1e6; p.life = 1e6 - 1; p.x = f.w[0]; p.y = f.w[1] + Math.sin(t * 1.3 + f.ph) * 0.25 * scale; p.z = f.w[2];
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
        // tree growth: the Elder's own glow (G 3 -> 4) = a wider, brighter crown aura, strongest at night
        const eK = Math.max(0, Math.min(1, G - 3)); crown.scale.multiplyScalar(1 + eK * 0.35);
        crown.material.opacity = Math.max(0, (h - 70) / 30) * (0.3 + api.night * (0.25 + eK * 0.3)) * (0.8 + STAGE_GLOW[lv - 1]) + bk * 0.6 + spk * (0.22 + 0.1 * breathe) + gk * 0.35;
        // spiralling leaves while it speaks: they circle the trunk on the way down (season colours, else green + gold)
        while (spiralAcc > 1) {
          spiralAcc--; const a = Math.random() * 6.28, rr = cp.r * (0.55 + Math.random() * 0.5), sw0 = api.season, pk = sw0[0] > 0.5 ? 0 : sw0[2] > 0.5 ? 2 : -1;
          const c = pk >= 0 ? SEA_LEAF[pk][Math.floor(Math.random() * 3)] : (Math.random() < 0.35 ? [1, 0.84, 0.4] : [0.5 + Math.random() * 0.15, 0.82, 0.36]);
          leaves.spawn({ x: TP[0] + Math.cos(a) * rr, y: cp.y0 + Math.random() * (cp.y1 - cp.y0) * 0.5, z: TP[2] + Math.sin(a) * rr, vy: -2.6 - Math.random() * 1.4,
            max: 16, s: 1.4 + Math.random() * 0.9, r: c[0], g: c[1], b: c[2], a: 1, kind: 3, ang: a, rr, spin: (0.32 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1) });
        }
        burstRing.position.copy(crown.position); burstRing.material.opacity = bk * 0.8; burstRing.scale.setScalar(cp.r * (2 + (3 - Math.min(3, burstT)) * 2.2));
        // falling leaves when health < 55 (more the worse it is), sparkles when >= 72
        leafAcc += dt * Math.min(1, Math.max(0, (58 - h) / 35)) * 45;
        while (leafAcc > 1) {
          leafAcc--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cp.r;
          const brown = Math.random(), wi = api.season[3] || 0;   // vibe pass 2: a winter tree drops dull brown-grey leaves, not autumn orange
          leaves.spawn({ x: TP[0] + Math.cos(a) * rr, y: cp.y0 + Math.random() * (cp.y1 - cp.y0) * 0.7, z: TP[2] + Math.sin(a) * rr, vy: -2.2 - Math.random() * 1.5,
            max: 14, s: 1.5 + Math.random() * 1.1, r: (0.75 + brown * 0.2) * (1 - wi * 0.3), g: (0.45 + brown * 0.25) * (1 - wi * 0.05), b: 0.18 + wi * 0.16, a: 1, kind: 1 });
        }
        sparkAcc += dt * Math.max(0, (h - 72) / 28) * 40;
        while (sparkAcc > 1) {
          sparkAcc--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cp.r * 1.1, gold = Math.random() < 0.5;
          sparks.spawn({ x: TP[0] + Math.cos(a) * rr, y: TP[1] + Math.random() * (cp.y1 - TP[1]), z: TP[2] + Math.sin(a) * rr, vy: 0.8 + Math.random(), max: 3 + Math.random() * 2,
            s: 1.6 + Math.random() * 1.8, r: gold ? 1 : 0.6, g: gold ? 0.88 : 1, b: gold ? 0.5 : 1, a: 0.9 });
        }
        // the growth moment: gold + cyan sparks spiral up the trunk into the crown while it grows
        growAcc += dt * gk * 90;
        while (growAcc > 1) {
          growAcc--; const a = Math.random() * 6.28, y = TP[1] + Math.random() * (cp.y0 - TP[1]) * 0.9, rr = CORE * P.kT * scale * (1 + Math.random() * 0.6), gold = Math.random() < 0.6;
          sparks.spawn({ x: TP[0] + Math.cos(a) * rr, y, z: TP[2] + Math.sin(a) * rr, vx: -Math.sin(a) * 3, vz: Math.cos(a) * 3, vy: 6 + Math.random() * 6, max: 2 + Math.random() * 1.5,
            s: 1.6 + Math.random() * 1.6, r: gold ? 1 : 0.6, g: gold ? 0.88 : 1, b: gold ? 0.5 : 1, a: 1 });
        }
        lanterns(t);
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
            max: 18, s: pk ? 1.3 + Math.random() * 0.9 : 1.0 + Math.random() * 0.7, r: c[0], g: c[1], b: c[2], a: 1, kind: 2, sk: pk });
        }
        // vibe pass 2: a season's own leaves / petals stop the moment its weight is gone (a forced setSeason, or the end of the real
        // 6 h blend): the ones in the air fade out within a second instead of drifting down for up to 18 s
        for (const p of leaves.P) if (p.kind === 2 && p.life > 1 && (sw[p.sk] || 0) < 0.04) p.life = 1;
        const gy = TP[1] + 0.3;
        leaves.tick(dt, (p, d) => {
          if (p.kind === 3 && p.y > gy) {   // a spiralling leaf: round the trunk, drifting in a little
            p.ang += p.spin * d; p.rr = Math.max(cp.r * 0.3, p.rr - d * 0.6); const nx = TP[0] + Math.cos(p.ang) * p.rr, nz = TP[2] + Math.sin(p.ang) * p.rr;
            p.vx = (nx - p.x) / Math.max(d, 1e-3); p.vz = (nz - p.z) / Math.max(d, 1e-3); return; }
          p.vx = Math.sin(t * 1.3 + p.ph) * 2.2; p.vz = Math.cos(t * 1.1 + p.ph) * 1.6; if (p.y < gy) { p.y = gy; p.vy = 0; p.vx = p.vz = 0; p.life = Math.min(p.life, 1.2); } });
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
  TreeFx.growthOf = growthOf; TreeFx.paramsOf = paramsOf;
  window.TreeFx = TreeFx;
})();
