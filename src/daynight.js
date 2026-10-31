// DayNight: the island follows the clock (hours come from Sim.tod(S), which the game anchors to the player's local time).
// Smooth keyframed palette (night -> pre-dawn -> dawn -> day -> golden hour -> sunset -> blue hour -> night) drives the
// sky dome (gradient + sun + moon), stars, fog, hemisphere light and the one directional light (sun by day, moon by
// night, shadows soften as the moon takes over). At night (ElderMap.uNight) Glow* parts brighten and fog less, house
// windows turn lamp-gold, and light sources really light up: N real PointLights (PC 8, phone 4) follow the brightest
// sources near where the player looks; every other source gets a cheap additive ground pool + a halo (2 draws total).
// Night life: fireflies over meadows / water, glowing spores rising around the Elder Tree, dew sparkles at dawn (one
// Points draw, animated in the vertex shader). three.js r128.
(function () {
  'use strict';
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // palettes: zen / hor / gnd = sky dome (hor is also the fog), sun = directional colour, sunI its intensity at that key,
  // hs / hg / hi = hemisphere sky / ground / intensity
  const PAL = {
    night: { zen: 0x10153e, hor: 0x343878, gnd: 0x1e2050, sun: 0xa8b8ff, sunI: 0, hs: 0x5a68d4, hg: 0x2a2052, hi: 0.36 },
    predawn: { zen: 0x262c68, hor: 0x9274b0, gnd: 0x3a3366, sun: 0xffa880, sunI: 0, hs: 0x9a90d8, hg: 0x44365e, hi: 0.46 },
    dawn: { zen: 0x6c8cd4, hor: 0xffbc98, gnd: 0x9a8ab0, sun: 0xffb27a, sunI: 0.55, hs: 0xe4d2f0, hg: 0x8a6a8a, hi: 0.68 },
    day: { zen: 0x6aa6ea, hor: 0xc3dcf7, gnd: 0xa9c4e2, sun: 0xfff4e0, sunI: 0.95, hs: 0xeaf4ff, hg: 0x8a7aa8, hi: 0.75 },
    golden: { zen: 0x7fa8e4, hor: 0xffdfa6, gnd: 0xd8c0a8, sun: 0xffcf8a, sunI: 0.9, hs: 0xfff0d8, hg: 0x9a7a88, hi: 0.72 },
    sunset: { zen: 0x5a5cb4, hor: 0xff9c7a, gnd: 0x9a6a8a, sun: 0xff8a5a, sunI: 0.55, hs: 0xecb4cc, hg: 0x6a4a7a, hi: 0.66 },
    blue: { zen: 0x232a6a, hor: 0x7060aa, gnd: 0x2c2a5a, sun: 0xa8b8ff, sunI: 0, hs: 0x7470d8, hg: 0x34285e, hi: 0.42 },
  };
  const KEYS = [[0, 'night'], [4.9, 'night'], [5.6, 'predawn'], [6.3, 'dawn'], [7.6, 'day'], [16.6, 'day'], [17.7, 'golden'], [18.6, 'sunset'], [19.4, 'blue'], [20.5, 'night'], [24, 'night']];
  const COLS = ['zen', 'hor', 'gnd', 'sun', 'hs', 'hg'];
  for (const k in PAL) for (const c of COLS) PAL[k][c] = new THREE.Color(PAL[k][c]);
  function palette(h, out) {
    let i = 0; while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const a = PAL[KEYS[i][1]], b = PAL[KEYS[i + 1][1]], f = sm(KEYS[i][0], KEYS[i + 1][0], h);
    for (const c of COLS) out[c].copy(a[c]).lerp(b[c], f);
    out.sunI = a.sunI + (b.sunI - a.sunI) * f; out.hi = a.hi + (b.hi - a.hi) * f;
    return out;
  }
  // sun: rises 6:06, sets 18:42, arc from az 80 deg (behind the home camera) to 260 deg (beyond the tree, so sunsets
  // show in the home view); the moon takes the same arc through the night, a bit lower
  const RISE = 6.1, DAYLEN = 12.6, D2R = Math.PI / 180;
  function sunAt(h, out) {
    const dayF = (h - RISE) / DAYLEN, isDay = dayF >= 0 && dayF <= 1;
    const nf = ((h - RISE - DAYLEN) % 24 + 24) % 24 / (24 - DAYLEN);
    out.sinEl = isDay ? Math.sin(Math.PI * dayF) : -Math.sin(Math.PI * nf);
    const sel = Math.asin(Math.max(-1, Math.min(1, out.sinEl * 0.88))), saz = (80 + 180 * Math.max(0, Math.min(1, dayF))) * D2R;
    out.sun.set(Math.cos(saz) * Math.cos(sel), Math.sin(sel), Math.sin(saz) * Math.cos(sel));
    const mel = Math.asin(0.72 * Math.max(0.12, Math.sin(Math.PI * nf))), maz = (95 + 150 * nf) * D2R;
    out.moon.set(Math.cos(maz) * Math.cos(mel), Math.sin(mel), Math.sin(maz) * Math.cos(mel));
    return out;
  }

  function glowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  // seeded random (the night-life anchors are the same every visit)
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // o: { scene, renderer, camera, controls, hemi, sun (DirectionalLight), center (Vector3, map centre), lightR, map, nav,
  //      ground(x, z, fallback), plots, phone }
  function DayNight(o) {
    const { scene, camera, hemi, map, nav, ground, phone } = o, sunL = o.sun;
    const pal = { zen: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), sunI: 0, hi: 0 };
    const sp = { sun: new THREE.Vector3(), moon: new THREE.Vector3(), sinEl: 0 };
    const MOON_COL = new THREE.Color(0x92a4ff), GREY = new THREE.Color(0xb8b8c4), WARM_WIN = new THREE.Color(1.0, 0.68, 0.34);
    const state = { h: 12, night: 0, dusk: 0, dawn: 0, sunK: 1, moonK: 0 };

    // ---- sky dome + stars (drawn at the far plane, follow the camera)
    const U = {
      zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, sunK: { value: 0 },
      moonDir: { value: new THREE.Vector3() }, moonK: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 }, uPx: { value: 1 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: U, depthWrite: false, side: THREE.BackSide, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; gl_Position.z = p.w * 0.99999; }',
      fragmentShader: `uniform vec3 zen, hor, gnd, sunDir, sunCol, moonDir; uniform float sunK, moonK; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float y = d.y;
          vec3 c = y > 0.0 ? mix(hor, zen, pow(y, 0.55)) : mix(hor, gnd, pow(min(1.0, -y * 3.0), 0.7));
          float sd = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(sd, 5.0) * 0.28 + pow(sd, 48.0) * 0.45) * sunK;
          c = mix(c, vec3(1.0, 0.97, 0.86), smoothstep(0.99935, 0.99965, sd) * sunK * step(-0.02, y));
          float md = max(dot(d, moonDir), 0.0);
          c += vec3(0.55, 0.62, 1.0) * pow(md, 90.0) * 0.35 * moonK;
          float disc = smoothstep(0.99955, 0.9998, md);
          vec3 off = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
          float lit = smoothstep(-0.2, 0.6, dot(normalize(d - moonDir * md), off) + 0.35);
          c = mix(c, mix(vec3(0.62, 0.66, 0.86), vec3(1.0, 0.97, 0.86), lit), disc * moonK);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat); dome.frustumCulled = false; dome.renderOrder = -10; scene.add(dome);
    const NS = phone ? 650 : 1300, r0 = rng(7), sPos = new Float32Array(NS * 3), sPh = new Float32Array(NS * 2);
    for (let i = 0; i < NS; i++) {
      const y = Math.pow(r0(), 0.7) * 1.02 - 0.02, a = r0() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - y * y));
      sPos.set([Math.cos(a) * rr, y, Math.sin(a) * rr], i * 3); sPh[i * 2] = r0() * 50; sPh[i * 2 + 1] = 0.6 + Math.pow(r0(), 4) * 2.6;
    }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sGeo.setAttribute('ph', new THREE.BufferAttribute(sPh, 2));
    const starMat = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute vec2 ph; uniform float uTime, uNight, uPx; varying float vA;
        void main(){ vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; gl_Position.z = p.w * 0.99998;
          vA = uNight * smoothstep(0.02, 0.2, position.y) * (0.55 + 0.45 * sin(uTime * (0.7 + fract(ph.x) * 1.6) + ph.x));
          gl_PointSize = vA < 0.01 ? 0.0 : ph.y * uPx; }`,
      fragmentShader: 'varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), vA * (1.0 - smoothstep(0.3, 1.0, r))); }',
    });
    const stars = new THREE.Points(sGeo, starMat); stars.frustumCulled = false; stars.renderOrder = -9; scene.add(stars);

    // ---- light sources (Glow* parts of map pieces + the game's own building pieces)
    const GT = glowTex();
    const SKIP = /^(terrain:|EG_ElderTree|EG_RuneCliff|EG_FloatIsle|child:|EG_FlowerPatch)/;
    // per class: pool radius (m, x instance scale) from the glow spread, strength
    function srcSpec(key, cls, a) {
      const big = /^EG_(Circus|HushHall|SproutHouse|Greenhold|GaleForge|SpiritTree)/.test(key);
      if (cls === 'win') return { r: Math.min(11, 4 + a.r * 0.5), k: 0.7, col: WARM_WIN, pl: true };
      if (cls === 'warm') return { r: big ? 16 : /Bush/.test(key) ? 2.2 : Math.min(12, 4 + a.r * 1.5), k: /Bush/.test(key) ? 0.35 : 0.9, col: a.col, pl: !/Bush/.test(key) };
      const tiny = /^EG_(Bush|FallenLog|RuneBoulder|Pond|Bridge)/.test(key);
      return { r: big ? 18 : tiny ? 2.6 : Math.min(10, 3 + a.r * 1.2), k: tiny ? 0.3 : big ? 0.8 : 0.6, col: a.col, pl: !tiny };
    }
    const specs = {};
    for (const b of map.batches) {
      if (!b.glow || SKIP.test(b.key)) continue;
      const list = []; for (const cls in b.glow) list.push(Object.assign({ cls, p: b.glow[cls].p }, srcSpec(b.key, cls, b.glow[cls])));
      if (list.length) specs[b.key] = list;
    }
    const mapSrc = []; for (const b of map.batches) if (specs[b.key]) for (const i of b.inst) if (i.role !== 'cover') for (const s of specs[b.key]) mapSrc.push({ i, s });
    const MAXP = phone ? 700 : 1200;
    const poolMat = new THREE.MeshBasicMaterial({ map: GT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), poolMat, MAXP);
    pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3); pools.frustumCulled = false; pools.count = 0; pools.renderOrder = 2; scene.add(pools);
    const hPos = new Float32Array(MAXP * 3), hCol = new Float32Array(MAXP * 4), hSize = new Float32Array(MAXP);
    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3).setUsage(THREE.DynamicDrawUsage)); hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 4).setUsage(THREE.DynamicDrawUsage));
    hGeo.setAttribute('size', new THREE.BufferAttribute(hSize, 1).setUsage(THREE.DynamicDrawUsage));
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: GT }, scale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.r); if (gl_FragColor.a < 0.005) discard; }',
    });
    const halos = new THREE.Points(hGeo, haloMat); halos.frustumCulled = false; halos.renderOrder = 3; scene.add(halos);
    // real point lights: a fixed number (shader light count never changes = no recompiles), intensity 0 by day
    const NPL = phone ? 4 : 8, lights = [];
    for (let k = 0; k < NPL; k++) { const l = new THREE.PointLight(0xffc070, 0, 40, 2); scene.add(l); lights.push({ l, id: null, cur: 0, want: 0 }); }

    // ---- night life: fireflies (kind 0), spores around the tree (1), dawn dew (2)
    const R = rng(1234), TP = nav.TP, anchors = [];
    const nodes = nav.nodes.filter(n => Math.hypot(n.p[0] - TP[0], n.p[2] - TP[2]) < 330 && n.p[1] < 40);
    const waterPts = (nav.water || []).map(w => w.water || w.p).filter(Boolean);
    const NF = phone ? 200 : 420, NSp = phone ? 120 : 260, ND = phone ? 140 : 300;
    const pick = a => a[Math.floor(R() * a.length)];
    for (let k = 0; k < NF; k++) {
      const near = R() < 0.4 && waterPts.length ? pick(waterPts) : R() < 0.35 ? [-110 + (R() - 0.5) * 80, 0, 70 + (R() - 0.5) * 80] : pick(nodes).p;
      const x = near[0] + (R() - 0.5) * 36, z = near[2] + (R() - 0.5) * 36, y = ground(x, z, near[1] || 0) + 1.2 + R() * 4.5;
      anchors.push(x, y, z, R(), R(), 0, 0.5 + R() * 0.45);
    }
    for (let k = 0; k < NSp; k++) { const a = R() * Math.PI * 2, rr = 8 + Math.sqrt(R()) * 62; anchors.push(Math.cos(a) * rr, R(), Math.sin(a) * rr, R(), R(), 1, 0.7 + R() * 0.9); }
    for (let k = 0; k < ND; k++) {
      const near = R() < 0.5 ? [-110 + (R() - 0.5) * 70, 0, 70 + (R() - 0.5) * 70] : pick(nodes).p;
      const x = near[0] + (R() - 0.5) * 30, z = near[2] + (R() - 0.5) * 30; anchors.push(x, ground(x, z, near[1] || 0) + 0.35, z, R(), R(), 2, 0.35 + R() * 0.25);
    }
    const NL = anchors.length / 7, lPos = new Float32Array(NL * 3), lPh = new Float32Array(NL * 4);
    for (let k = 0; k < NL; k++) { lPos.set(anchors.slice(k * 7, k * 7 + 3), k * 3); lPh.set(anchors.slice(k * 7 + 3, k * 7 + 7), k * 4); }
    const lGeo = new THREE.BufferGeometry(); lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3)); lGeo.setAttribute('ph', new THREE.BufferAttribute(lPh, 4));
    const LU = { uTime: U.uTime, uNight: { value: 0 }, uDawn: { value: 0 }, uScale: { value: 600 }, uTreeS: { value: 0.45 }, uTP: { value: new THREE.Vector3().fromArray(TP) } };
    const lifeMat = new THREE.ShaderMaterial({
      uniforms: LU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 ph; uniform float uTime, uNight, uDawn, uScale, uTreeS; uniform vec3 uTP; varying vec4 vC;
        void main(){
          vec3 p = position; float t = uTime, a = 0.0; vec3 col = vec3(1.0);
          if (ph.z < 0.5) {
            p += vec3(sin(t * 0.31 + ph.x * 6.0) * 3.0 + sin(t * 0.73 + ph.y * 9.0) * 1.2, sin(t * 0.5 + ph.x * 4.0) * 1.1, cos(t * 0.27 + ph.y * 7.0) * 3.0);
            float bl = smoothstep(0.2, 1.0, sin(t * (0.9 + ph.y * 0.8) + ph.x * 20.0));
            a = uNight * (0.12 + 0.88 * bl); col = mix(vec3(0.8, 1.0, 0.35), vec3(1.0, 0.86, 0.38), ph.y);
          } else if (ph.z < 1.5) {
            float h = fract(position.y + t * 0.006 * (0.5 + ph.y)), an = ph.x * 6.2831 + t * 0.04 * (ph.y - 0.5), r = length(position.xz);
            p = uTP + vec3(cos(an) * r, 3.0 + h * 130.0, sin(an) * r) * uTreeS;
            a = uNight * sin(h * 3.1416) * 0.95; col = ph.y > 0.72 ? vec3(1.0, 0.88, 0.5) : vec3(0.5, 0.95, 1.0);
          } else {
            a = uDawn * pow(max(0.0, sin(t * 1.7 + ph.x * 40.0)), 10.0); col = vec3(1.0, 1.0, 0.95);
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = -mv.z;
          a *= 1.0 - smoothstep(420.0, 650.0, d);
          vC = vec4(col, a);
          gl_PointSize = a < 0.01 ? 0.0 : max(2.0, ph.w * uScale / max(1.0, d));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: 'varying vec4 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float g = exp(-r * r * 3.5) - 0.03; gl_FragColor = vec4(vC.rgb, vC.a * g); if (gl_FragColor.a < 0.004) discard; }',
    });
    const life = new THREE.Points(lGeo, lifeMat); life.frustumCulled = false; life.renderOrder = 4; scene.add(life);

    // ---- per-frame
    const v = new THREE.Vector3(), v2 = new THREE.Vector3(), sc = new THREE.Vector3(), M = new THREE.Matrix4();
    let srcT = 1, src = [], fog0 = null;
    function gatherSources() {   // world position, pool radius, colour, strength, point-light ok
      src.length = 0;
      for (const e of mapSrc) {
        if (!map.on[e.i.role] || e.i.role === 'later' || e.i.role === 'plot') continue;
        v.copy(e.s.p).applyMatrix4(e.i.m); sc.setFromMatrixScale(e.i.m);
        src.push({ id: e, x: v.x, y: v.y, z: v.z, r: e.s.r * Math.min(1.7, sc.x), k: e.s.k, col: e.s.col, pl: e.s.pl });
      }
      if (o.plots && o.plots.glowPieces) o.plots.glowPieces((key, m, id) => {
        for (const s of specs[key] || []) { v.copy(s.p).applyMatrix4(m); sc.setFromMatrixScale(m); src.push({ id: id + ':' + s.cls, x: v.x, y: v.y, z: v.z, r: s.r * Math.min(1.7, sc.x), k: s.k, col: s.col, pl: s.pl }); }
      });
      // the shrine door of the Elder Tree (always a candidate, strongest)
      if (o.door) { const d = o.door(); src.push({ id: 'shrine', x: d[0], y: d[1] + 3, z: d[2], r: 16, k: 1.4, col: new THREE.Color(0.5, 0.9, 1.0), pl: true }); }
    }
    const tmpC = new THREE.Color(), WATER_N = new THREE.Color(), GR = new THREE.Vector3();
    const SEA_W = new THREE.Color(0.86, 0.9, 0.97), SEA_A = new THREE.Color(1.0, 0.86, 0.7), SEA_S = new THREE.Color(0.38, 0.66, 1.0), ICE = new THREE.Color(0.78, 0.9, 0.97);
    function updateLights(dt, night) {
      const cam = camera.position, tgt = o.controls.target;
      let n = 0, hn = 0;
      for (const s of src) {
        const dc = Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z), fade = 1 - sm(500, 900, dc);
        s.score = s.pl ? s.k * s.r / (Math.hypot(s.x - tgt.x, s.z - tgt.z) * 0.7 + dc * 0.3 + 12) : 0;
        if (fade <= 0 || n >= MAXP) continue;
        const gy = ground(s.x, s.z, s.y - 1);
        const k = night * s.k * fade;
        M.makeScale(s.r, 1, s.r).setPosition(s.x, Math.min(s.y, gy + 0.35) + 0.08, s.z); pools.setMatrixAt(n, M);
        tmpC.copy(s.col).multiplyScalar(k * 0.4); pools.setColorAt(n, tmpC); n++;
        if (s.r >= 3.5) {   // small things (bushes, boulders, logs) glow by themselves: pool only
          hPos[hn * 3] = s.x; hPos[hn * 3 + 1] = s.y; hPos[hn * 3 + 2] = s.z;
          hCol[hn * 4] = s.col.r; hCol[hn * 4 + 1] = s.col.g; hCol[hn * 4 + 2] = s.col.b; hCol[hn * 4 + 3] = Math.min(1, k * 0.15); hSize[hn] = Math.max(2, s.r * 0.4); hn++;
        }
      }
      pools.count = night > 0.01 ? n : 0; pools.instanceMatrix.needsUpdate = true; pools.instanceColor.needsUpdate = true;
      hGeo.setDrawRange(0, night > 0.01 ? hn : 0); hGeo.attributes.position.needsUpdate = hGeo.attributes.color.needsUpdate = hGeo.attributes.size.needsUpdate = true;
      // point lights: the NPL best scores; a light keeps its source while it stays in the set, new ones fade in
      const best = src.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, NPL), want = new Set(best.map(s => s.id));
      for (const L of lights) if (L.id !== null && !want.has(L.id)) L.want = 0;
      for (const s of best) {
        let L = lights.find(x => x.id === s.id);
        if (!L) { L = lights.find(x => x.id === null) || lights.find(x => !want.has(x.id) && x.cur < 0.05); if (!L) continue; L.id = s.id; L.cur = 0; }
        L.want = night * s.k * 0.5 * api.plK; L.l.position.set(s.x, s.y + 3.5, s.z); L.l.color.copy(s.col); L.l.distance = Math.max(18, Math.min(42, s.r * 2.4));
      }
    }

    const api = {
      state, lights, pools, halos, life, dome, stars, plK: 1, season: [0, 0, 0, 0],   // plK = point-light strength knob (tests); season weights (step 5)
      palette: h => palette(h, { zen: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color() }),
      // h = hours 0..24 (Sim.tod), t = seconds (animation), sick 0..1 (unhealthy tree greys the day sky a bit)
      update(h, t, dt, sick, treeScale) {
        state.h = h; const dc = Sim.dayCurve(h); state.night = dc.night; state.dusk = dc.dusk; state.dawn = dc.dawn;
        palette(h, pal); sunAt(h, sp);
        const greyK = (sick || 0) * 0.6 * (1 - dc.night);
        if (greyK > 0) { pal.hor.lerp(GREY, greyK); pal.zen.lerp(GREY, greyK * 0.7); }
        // step 5 seasons (api.season = weights spring, summer, autumn, winter): a pale wintry sky by day, a warm autumn haze
        const sw = api.season, dk = 1 - dc.night;
        if (sw[3] > 0.001) { pal.hor.lerp(SEA_W, sw[3] * 0.35 * dk); pal.zen.lerp(SEA_W, sw[3] * 0.2 * dk); }
        if (sw[2] > 0.001) pal.hor.lerp(SEA_A, sw[2] * 0.16 * dk);
        if (sw[1] > 0.001) pal.zen.lerp(SEA_S, sw[1] * 0.15 * dk);
        U.zen.value.copy(pal.zen); U.hor.value.copy(pal.hor); U.gnd.value.copy(pal.gnd);
        U.sunDir.value.copy(sp.sun); U.sunCol.value.copy(pal.sun); U.moonDir.value.copy(sp.moon); U.uTime.value = t; U.uNight.value = dc.night;
        U.uPx.value = o.renderer.getPixelRatio();
        const sunK = sm(-0.02, 0.12, sp.sinEl), moonK = 1 - sm(-0.2, -0.03, sp.sinEl); state.sunK = sunK; state.moonK = moonK;
        U.sunK.value = sm(-0.08, 0.02, sp.sinEl); U.moonK.value = moonK;
        scene.background.copy(pal.hor); scene.fog.color.copy(pal.hor);
        // night grade: the fog closes in (blue-violet distance), so the far island sinks into the night and the lights pop
        if (!fog0) fog0 = { near: scene.fog.near, far: scene.fog.far };
        const fk = Math.max(dc.night, dc.dusk * 0.4); scene.fog.near = fog0.near + (260 - fog0.near) * fk; scene.fog.far = fog0.far + (2400 - fog0.far) * fk;
        hemi.color.copy(pal.hs); hemi.groundColor.copy(pal.hg); hemi.intensity = pal.hi - (sick || 0) * 0.12 * (1 - dc.night);
        // directional: the sun while it is up, then the moon (both ~0 around the switch); never lower than 14 deg (no endless shadows)
        const useSun = sunK > 0.001 || moonK < 0.001;
        v2.copy(useSun ? sp.sun : sp.moon); if (v2.y < 0.24) { v2.y = 0.24; } v2.normalize();
        sunL.color.copy(useSun ? pal.sun : MOON_COL); sunL.intensity = useSun ? pal.sunI * sunK : 0.3 * moonK;
        sunL.position.copy(o.center).addScaledVector(v2, o.lightR); sunL.target.position.copy(o.center);
        ElderMap.uNight.value = Math.max(dc.night, dc.dusk * 0.5);   // lamps + glow come on at dusk already
        // colour grade of the map's lit surfaces: rosy at dawn, warm at golden hour / dusk, moonlit blue-violet at night
        const gw = dc.night * 0.42, gd = dc.dusk * (1 - dc.night) * 0.32, ga = dc.dawn * (1 - dc.night) * 0.22, gs = gw + gd + ga;
        if (gs > 1e-4) GR.set((0.72 * gw + 1.2 * gd + 1.1 * ga) / gs, (0.64 * gw + 0.86 * gd + 0.9 * ga) / gs, (1.35 * gw + 0.7 * gd + 1.05 * ga) / gs); else GR.set(1, 1, 1);
        ElderMap.uGrade.value.set(GR.x, GR.y, GR.z, gs);
        for (const k in ElderMap.seeMats) {   // water: darker + bluer at night, with a faint moonlit sheen
          const m = ElderMap.seeMats[k]; if (!/^Water/.test(k)) continue; if (!m.userData.c0) m.userData.c0 = m.color.clone();
          m.color.copy(m.userData.c0).multiply(WATER_N.setRGB(1 - 0.55 * dc.night, 1 - 0.5 * dc.night, 1 - 0.2 * dc.night)).lerp(ICE, sw[3] * 0.45 * dk);   // winter: icy pale water if (m.emissive) m.emissive.setRGB(0.03, 0.06, 0.16).multiplyScalar(dc.night);
        }
        LU.uNight.value = Math.max(dc.night, dc.dusk * 0.35); LU.uDawn.value = dc.dawn; LU.uTreeS.value = treeScale || 0.45;
        const scl = o.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        LU.uScale.value = scl; haloMat.uniforms.scale.value = scl;
        if (o.plots && o.plots.setNight) o.plots.setNight(dc.night);
        // sources + lights (re-gathered a few times a second), light intensities ease every frame
        srcT += dt; const nightL = Math.max(dc.night, dc.dusk * 0.3);
        if (srcT > 0.3) { srcT = 0; if (nightL > 0.005) { gatherSources(); updateLights(dt, nightL); } else { pools.count = 0; hGeo.setDrawRange(0, 0); for (const L of lights) L.want = 0; } }
        for (const L of lights) {
          L.cur += (L.want - L.cur) * Math.min(1, dt * 3); if (L.want === 0 && L.cur < 0.01) { L.cur = 0; L.id = null; }
          L.l.intensity = L.cur;
        }
      },
      sources: () => src,
    };
    return api;
  }
  DayNight.palette = palette; DayNight.sunAt = sunAt;
  window.DayNight = DayNight;
})();
