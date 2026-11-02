// WeatherFx (seasons + weather pass, 2026-11-01): what the weather (src/weather.js) and the season look like ACROSS the map.
// View only, owns no state, never touches the sim. The game calls view(S, t, dt, sw) once a frame (the smoothed weather every
// other module reads: rain, wind, gusts, wetness, wind travel for blown particles) and update(...) after the pups are posed.
//  - rain: ONE Points draw of streaks round the camera target (GPU, slanted + carried by the wind); rings on rivers + ponds and wet,
//    darker ground through ElderMap.uWet (elder_map.js WATER_FS / GRADE_FS), puddles by the paths (world_fx, via the game's wetness())
//  - snow: a snowfall thickens season_fx's flakes; rivers freeze over in patches (elder_map.js WATER_FS, winter weight)
//  - wind: ElderMap.uWind (canopy sway, grass bend, gusts: light_fx) + leaves / petals / snow blown along (season_fx uOff, uGust),
//    lanterns + laundry swing (season_fx, world_fx), clouds drift faster (light_fx)
//  - pups: leaf umbrellas over pups out working in the rain (2 instanced draws), splashes at their feet on wet ground, breath puffs
//    in winter (1 Points draw shared); resting pups shelter under the tree (the sim's nap grid is under the crown) and puddle-play
//    / chase blown leaves through pup_life (env.wet / env.windy)
//  - seasons on the land: summer sunflowers in the meadows (3 draws), autumn leaf piles under the oaks (1 draw), a summer midday
//    heat shimmer (1 draw), all only inside the restored colour (Story ring) and hidden at weight 0 (0 draws)
//  - chip: #wxChip in the resource bar (icon + what the weather is doing) + #wxCard (the effects in words + the tree's line);
//    a short tree line as a toast when rain / snow / a wind starts (at most once per kind per 90 min)
// prefers-reduced-motion: fewer + slower streaks, a gentler wind (sway, gusts, swinging) and a still heat shimmer.
(function () {
  'use strict';
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
  const WIND = [0.83, 0.55];   // the island's wind direction (elder_map.js EG_GRASS, light_fx clouds)
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, o || {}));
  const lin = h => new THREE.Color(h).convertSRGBToLinear();

  function WeatherFx(scene, map, nav, ground, o) {
    o = o || {};
    const PHONE = !!o.phone, TP = nav.TP;
    const RED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const MOT = RED ? 0.35 : 1;
    const wx = { r: 0, w: 0.15, windy: 0, wet: 0, snow: false, gust: 0, off: [0, 0], offR: [0, 0], kind: 'clear', motion: MOT, raw: null };
    const api = { wx, force: null, reduced: RED };

    // ---------------------------------------------------------------- rain streaks (GPU, one draw)
    const NR = Math.round((PHONE ? 1800 : 4200) * (RED ? 0.45 : 1)), BOX = 120, HGT = 70;
    const rg = new THREE.BufferGeometry(), rs = new Float32Array(NR * 4);
    for (let i = 0; i < NR; i++) { rs[i * 4] = hsh(i * 4 + 1); rs[i * 4 + 1] = hsh(i * 4 + 2); rs[i * 4 + 2] = hsh(i * 4 + 3); rs[i * 4 + 3] = hsh(i * 4 + 4); }
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NR * 3), 3)); rg.setAttribute('seed', new THREE.BufferAttribute(rs, 4));
    const RU = { uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uR: { value: 0 }, uOff: { value: new THREE.Vector2() }, uSlant: { value: 0 }, uScale: { value: 600 }, uNight: { value: 0 }, uFall: { value: 34 } };
    const rain = new THREE.Points(rg, new THREE.ShaderMaterial({
      uniforms: RU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 seed; uniform float uT, uR, uSlant, uScale, uNight, uFall; uniform vec3 uC; uniform vec2 uOff; varying float vA; varying float vS;
        void main() {
          float B = ${BOX.toFixed(1)}, Hh = ${HGT.toFixed(1)}, k = (7.0 + floor(seed.w * 6.99)) / 10.0;
          vec3 p;
          p.x = uC.x + (fract(seed.x - (uC.x - uOff.x * k) / B) - 0.5) * B;
          p.z = uC.z + (fract(seed.y - (uC.z - uOff.y * k) / B) - 0.5) * B;
          p.y = uC.y - 20.0 + fract(seed.z * 5.0 - uT * uFall * (0.85 + 0.3 * seed.w) / Hh) * Hh;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float on = step(seed.w, uR) * (1.0 - smoothstep(B * 0.32, B * 0.5, length(p.xz - uC.xz))) * smoothstep(9.0, 26.0, -mv.z);   // never a slash across the lens
          gl_PointSize = on > 0.001 ? clamp(3.4 * uScale / max(1.0, -mv.z), 3.0, uScale * 0.035) : 0.0;
          gl_Position = projectionMatrix * mv; vA = on * (0.3 + 0.25 * seed.x) * (1.0 - uNight * 0.35); vS = uSlant;
        }`,
      fragmentShader: `varying float vA; varying float vS;
        void main() {
          vec2 q = gl_PointCoord - 0.5; float x = q.x + q.y * vS;   // a thin streak, leaning with the wind
          float a = vA * smoothstep(0.07, 0.01, abs(x)) * smoothstep(0.5, 0.12, abs(q.y)); if (a < 0.01) discard;
          gl_FragColor = vec4(0.82, 0.9, 1.0, a);
        }`,
    }));
    rain.frustumCulled = false; rain.renderOrder = 3; rain.visible = false; scene.add(rain);

    // ---------------------------------------------------------------- puffs: winter breath + splashes (CPU pool, one Points draw)
    const NP = 96, pPos = new Float32Array(NP * 3), pA = new Float32Array(NP * 2), puffs = [];
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage)); pg.setAttribute('pa', new THREE.BufferAttribute(pA, 2).setUsage(THREE.DynamicDrawUsage));
    const PU = { uScale: { value: 600 } };
    const puffPts = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: PU, transparent: true, depthWrite: false,
      vertexShader: 'attribute vec2 pa; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = pa.y * uScale / max(1.0, -mv.z); vA = pa.x; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = vA * (1.0 - r * r); if (a < 0.01) discard; gl_FragColor = vec4(0.94, 0.97, 1.0, a); }',
    }));
    puffPts.frustumCulled = false; puffPts.renderOrder = 3; scene.add(puffPts);
    const spawnPuff = (x, y, z, vx, vy, vz, life, s0, s1, a) => { if (puffs.length >= NP) puffs.shift(); puffs.push({ x, y, z, vx, vy, vz, t: 0, life, s0, s1, a }); };

    // ---------------------------------------------------------------- leaf umbrellas (stick + canopy, instanced)
    const MU = 48, uStick = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5).translate(0, 1.2, 0), toon(lin(0x7a5434)), MU);
    const uTop = new THREE.InstancedMesh(new THREE.ConeGeometry(1.25, 0.55, 9, 1, true).translate(0, 2.55, 0), toon(0xffffff, { side: THREE.DoubleSide }), MU);
    uTop.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MU * 3), 3);
    const UCOL = [0x7fcf5a, 0x5fb85a, 0xff8fb0, 0xffd34d, 0x8fc8ff, 0xffa65a].map(lin);
    for (const m of [uStick, uTop]) { m.count = 0; m.visible = false; m.frustumCulled = false; scene.add(m); }

    // ---------------------------------------------------------------- summer sunflowers + autumn leaf piles (from the layout)
    const PL = (map.layout && map.layout.placements) || [], dry = (x, z) => !nav.dry || nav.dry(x, z), road = (x, z) => nav.roadDist ? nav.roadDist(x, z, 6) : 99;
    const blocked = (x, z) => !!(nav.blockAt && nav.blockAt(x, z));
    const sunSpots = [], pileSpots = [];
    { const MAXF = PHONE ? 70 : 150;
      const fl = PL.filter(p => p.role === 'cover' && p.sub === 'flower' && p.pos).sort((a, b) => hsh(a.id * 7 + 1) - hsh(b.id * 7 + 1));
      for (const p of fl) {
        if (sunSpots.length >= MAXF * 3) break;
        const d = Math.hypot(p.pos[0] - TP[0], p.pos[2] - TP[2]); if (d < 70 || d > 620) continue;
        if (sunSpots.some(s => Math.abs(s.x - p.pos[0]) + Math.abs(s.z - p.pos[2]) < 30)) continue;
        for (let k = 0; k < 3; k++) {
          const a = hsh(p.id * 13 + k) * 6.283, r = k ? 1.6 + hsh(p.id * 3 + k) * 1.6 : 0, x = p.pos[0] + Math.cos(a) * r, z = p.pos[2] + Math.sin(a) * r;
          if (!dry(x, z) || road(x, z) < 2.5 || blocked(x, z)) continue;
          sunSpots.push({ x, z, y: ground(x, z, p.pos[1]), s: 1.4 + hsh(p.id + k * 31) * 0.6, yaw: -0.4 + hsh(p.id * 5 + k) * 0.8, d });
        }
      }
      const MAXP = PHONE ? 90 : 200;
      const oaks = PL.filter(p => (p.role === 'forest' || p.role === 'decor') && /^EG_Oak/.test(p.piece || '') && p.pos && (p.role !== 'forest' || !window.Nav || !window.Nav.keepForest || window.Nav.keepForest(p.id)))
        .sort((a, b) => hsh(a.id * 11 + 5) - hsh(b.id * 11 + 5));
      for (const p of oaks) {
        if (pileSpots.length >= MAXP) break;
        const d = Math.hypot(p.pos[0] - TP[0], p.pos[2] - TP[2]); if (d > 640) continue;
        for (let k = 0; k < 2; k++) {
          const a = hsh(p.id * 17 + k) * 6.283, r = (4 + hsh(p.id + k) * 3.5) * (p.s || 1), x = p.pos[0] + Math.cos(a) * r, z = p.pos[2] + Math.sin(a) * r;
          if (!dry(x, z) || road(x, z) < 2 || blocked(x, z)) continue;
          pileSpots.push({ x, z, y: ground(x, z, p.pos[1]), s: 1.0 + hsh(p.id * 3 + k) * 0.8, yaw: a, d, c: Math.floor(hsh(p.id * 29 + k) * 3) });
        }
      }
      // around the plaza too (the oaks there were thinned for the tree): a ring of piles just outside the roots
      for (let k = 0; k < 10; k++) { const a = k * 0.63 + 0.2, r = 62 + (k % 3) * 9, x = TP[0] + Math.cos(a) * r, z = TP[2] + Math.sin(a) * r; if (dry(x, z) && road(x, z) > 2.5 && !blocked(x, z)) pileSpots.push({ x, z, y: ground(x, z, TP[1]), s: 1.1, yaw: a, d: r, c: k % 3 }); }
    }
    const sfStem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 3.0, 5).translate(0, 1.5, 0), toon(lin(0x5f9a3c)), sunSpots.length || 1);
    const sfPet = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.95, 0.75, 0.1, 12).rotateX(Math.PI / 2).translate(0, 3.05, 0.08), toon(lin(0xffc928)), sunSpots.length || 1);
    const sfDisc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 10).rotateX(Math.PI / 2).translate(0, 3.05, 0.16), toon(lin(0x6a3d1e)), sunSpots.length || 1);
    const pile = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.7, 0.55, 1.35), toon(0xffffff), pileSpots.length || 1);
    pile.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((pileSpots.length || 1) * 3), 3);
    const PCOL = [0xe8732a, 0xc8432a, 0xf2b13c].map(lin);
    for (const m of [sfStem, sfPet, sfDisc, pile]) { m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; scene.add(m); }
    let sfSig = '', plSig = '';

    // ---------------------------------------------------------------- summer heat shimmer (one draw: low wavy billboards)
    const NH = PHONE ? 6 : 12, hg = new THREE.BufferGeometry(), hc = [], hcen = [], hprm = [], hix = [];
    for (let k = 0; k < NH; k++) { for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { hc.push(cx, cy); hcen.push(0, 0, 0); hprm.push(hsh(k * 7 + 1) * 6.283, 0.5 + hsh(k * 3) * 0.8, hsh(k * 11 + 2)); } const b = k * 4; hix.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hcen, 3)); hg.setAttribute('corner', new THREE.Float32BufferAttribute(hc, 2)); hg.setAttribute('prm', new THREE.Float32BufferAttribute(hprm, 3)); hg.setIndex(hix);
    const HU = { uK: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uMot: { value: MOT } };
    const shimmer = new THREE.Mesh(hg, new THREE.ShaderMaterial({
      uniforms: HU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute vec2 corner; attribute vec3 prm; uniform vec3 uC; uniform float uT; varying vec2 vU; varying float vP; varying float vF;
        void main() {
          float a = prm.x, r = 38.0 + prm.z * 70.0; vec3 c = uC + vec3(cos(a) * r, 0.0, sin(a) * r);
          vec4 mv = modelViewMatrix * vec4(c, 1.0); mv.xy += corner * vec2(28.0 * prm.y + 14.0, 7.0);
          vU = corner; vP = prm.x; vF = smoothstep(18.0, 60.0, -mv.z) * (1.0 - smoothstep(160.0, 260.0, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uK, uT, uMot; varying vec2 vU; varying float vP; varying float vF;
        void main() { float w = sin(vU.y * 42.0 - uT * 3.2 * uMot + sin(vU.x * 9.0 + uT * 1.3 * uMot + vP) * 2.4);
          float a = uK * vF * smoothstep(0.55, 1.0, w) * (1.0 - vU.y) * smoothstep(0.0, 0.25, vU.y) * (1.0 - vU.x * vU.x);
          if (a < 0.003) discard; gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * a, 1.0); }`,
    }));
    shimmer.frustumCulled = false; shimmer.renderOrder = 2; shimmer.visible = false; scene.add(shimmer);

    // ---------------------------------------------------------------- the weather (smoothed), read by every module
    const WALK = { go: 1, carry: 1, fill: 1, pour: 1, work: 1, drop: 1, build: 1, plant: 1, feed: 1, light: 1, tend: 1, arrive: 1, clear: 1, patrol: 1, play: 0 };
    api.view = (S, t, dt, sw, extra) => {
      const W = window.Weather, onW = !!(W && W.on(S));
      const c = onW ? W.curve(S.events.seed, S.ep0 + S.time) : { r: 0, w: 0.15 }, a = onW ? W.at(S) : { wet: 0 };
      const shower = S.events && S.events.active.some(e => e.type === 'shower');
      let r = Math.max(c.r, shower ? 0.75 : 0), w = c.w, wet = Math.max(a.wet || 0, (extra && extra.wet) || 0);
      if (api.force) { if (api.force.r !== undefined) r = api.force.r; if (api.force.w !== undefined) w = api.force.w; if (api.force.wet !== undefined) wet = api.force.wet; }
      const snow = (sw ? sw[3] : 0) > 0.5;
      if (snow) wet = 0;
      const k = api.force ? 1 : Math.min(1, dt * 0.6);   // tests (setWeather) jump straight there
      wx.r += (r - wx.r) * k; wx.w += (w - wx.w) * k; wx.wet += (Math.max(wet, wx.r) - wx.wet) * (api.force ? 1 : Math.min(1, dt * 0.4)); wx.snow = snow;
      wx.windy = W ? W.windyOf(wx.w) : 0;
      const g = 0.5 + 0.5 * Math.sin(t * 0.41) * Math.sin(t * 0.17 + 1.3) + 0.25 * Math.sin(t * 1.3);
      wx.gust = Math.max(0, Math.min(1, g)) * wx.windy * MOT;
      const sp = (1.2 + 13 * wx.windy * (0.7 + 0.5 * wx.gust) + 2 * wx.r) * dt * MOT;
      wx.off[0] = (wx.off[0] + WIND[0] * sp) % 2400; wx.off[1] = (wx.off[1] + WIND[1] * sp) % 2400;
      wx.offR[0] = (wx.offR[0] + WIND[0] * sp * 1.6) % 1500; wx.offR[1] = (wx.offR[1] + WIND[1] * sp * 1.6) % 1500;
      wx.kind = W ? W.kind({ on: true, r: wx.r, w: wx.w, windy: wx.windy, wet: wx.wet, snow }) : 'clear';
      wx.raw = onW ? Object.assign({}, a, { r, w }) : null; wx.on = onW;
      return wx;
    };

    // ---------------------------------------------------------------- per frame
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3();
    const breathT = new Map();
    let umbK = 0;
    api.update = (S, t, dt, night, camera, target, renderer, poses, sw, rest) => {
      const scale = renderer.domElement.height / (2 * Math.tan(Math.PI / 180 * 20));
      const restR = rest && rest.w > 0 ? rest.x : 1e9;   // only inside the restored colour (Story ring): the grey keeps its hush
      // 1. shader knobs: wet ground, rain on water, wind for the animators
      ElderMap.uWet.value.set(wx.snow ? 0 : Math.min(1, wx.wet) * 0.85, wx.snow ? 0 : Math.min(1, wx.r * 1.2), 0, 0);
      ElderMap.uWind.value.w = wx.windy * MOT;
      // 2. rain streaks
      const rr = wx.snow ? 0 : wx.r;
      rain.visible = rr > 0.02;
      if (rain.visible) {
        // the rain box sits in front of the lens (not at the orbit target): a wide view is in the rain too
        const cd = camera.position.distanceTo(target); RU.uC.value.copy(target).sub(camera.position).multiplyScalar(Math.min(1, 70 / Math.max(1, cd))).add(camera.position);
        RU.uT.value = t; RU.uR.value = Math.min(1, rr * 1.15); RU.uOff.value.set(wx.offR[0], wx.offR[1]); RU.uNight.value = night;
        RU.uSlant.value = -(0.15 + wx.windy * 0.55) * (RED ? 0.5 : 1); RU.uScale.value = scale; RU.uFall.value = RED ? 18 : 34;
      }
      // 3. umbrellas over pups working in the rain (resting / napping pups are in the shelter of the tree), splashes on wet ground
      umbK += ((rr > 0.25 ? 1 : 0) - umbK) * (api.force ? 1 : Math.min(1, dt * 1.5));
      let nu = 0; const cp = camera.position;
      if (poses && (umbK > 0.02 || wx.wet > 0.25 || (sw && sw[3] > 0.3))) {
        for (let i = 0; i < poses.length; i++) {
          const ps = poses[i]; if (!ps || !ps.p || ps.hidden || ps.air || ps.phase === 'away') continue;
          const dx = ps.p[0] - cp.x, dz = ps.p[2] - cp.z, dc = Math.hypot(dx, dz, ps.p[1] - cp.y), walk = !!WALK[ps.phase];
          const sz = ps.small ? 0.6 : 1;
          if (umbK > 0.02 && walk && dc < 260 && nu < MU) {
            const lean = 0.18 * wx.windy + 0.06 * Math.sin(t * 3 + i), dirA = Math.atan2(WIND[0], WIND[1]);
            Q.setFromAxisAngle(Y, (ps.yaw || 0)); AX.set(Math.cos(dirA), 0, -Math.sin(dirA)); Q2.setFromAxisAngle(AX, lean * MOT); Q.premultiply(Q2);
            V.set(ps.p[0], (ps.y !== undefined ? ps.y : ps.p[1]) + 2.2 * sz, ps.p[2]); const s = 1.75 * sz * umbK; SC.set(s, s, s); M.compose(V, Q, SC);   // held high over the head (pups are drawn ~4.5 m tall)
            uStick.setMatrixAt(nu, M); uTop.setMatrixAt(nu, M); uTop.setColorAt(nu, UCOL[i % UCOL.length]); nu++;
          }
          // splashes at the feet of walking pups on wet ground (puddle play), breath puffs in winter
          if (dc < 80) {
            const nt = breathT.get(i) || 0;
            if (t > nt) {
              if (sw && sw[3] > 0.3) {
                const d = ps.dir || [0, 0, 1], L = Math.hypot(d[0], d[2]) || 1, fx = d[0] / L, fz = d[2] / L;
                spawnPuff(ps.p[0] + fx * 1.5 * sz, ps.p[1] + 2.3 * sz, ps.p[2] + fz * 1.5 * sz, fx * 0.6, 0.35, fz * 0.6, 1.6, 0.5, 1.6, 0.55 * sw[3]);
                breathT.set(i, t + 2.2 + hsh(i * 7 + Math.floor(t)) * 1.4);
              } else if (wx.wet > 0.25 && walk) {
                for (let k = 0; k < 2; k++) spawnPuff(ps.p[0] + (hsh(i + k + Math.floor(t * 9)) - 0.5) * 1.2, ps.p[1] + 0.15, ps.p[2] + (hsh(i * 3 + k + Math.floor(t * 7)) - 0.5) * 1.2, 0, 1.6, 0, 0.45, 0.25, 0.7, 0.6 * wx.wet);
                breathT.set(i, t + 0.35 + hsh(i * 5 + Math.floor(t * 3)) * 0.5);
              } else breathT.set(i, t + 1);
            }
          }
        }
      }
      uStick.count = uTop.count = nu; uStick.visible = uTop.visible = nu > 0;
      if (nu) { uStick.instanceMatrix.needsUpdate = uTop.instanceMatrix.needsUpdate = true; uTop.instanceColor.needsUpdate = true; }
      // puffs
      let np = 0;
      for (let k = puffs.length - 1; k >= 0; k--) { const p = puffs[k]; p.t += dt; if (p.t >= p.life) puffs.splice(k, 1); }
      for (const p of puffs) {
        const u = p.t / p.life; p.x += p.vx * dt; p.y += p.vy * dt * (1 - u); p.z += p.vz * dt;
        pPos[np * 3] = p.x; pPos[np * 3 + 1] = p.y; pPos[np * 3 + 2] = p.z; pA[np * 2] = p.a * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u * 0.5); pA[np * 2 + 1] = p.s0 + (p.s1 - p.s0) * u; np++;
      }
      pg.setDrawRange(0, np); puffPts.visible = np > 0; if (np) { pg.attributes.position.needsUpdate = true; pg.attributes.pa.needsUpdate = true; } PU.uScale.value = scale;
      // 4. summer sunflowers + autumn leaf piles (rebuilt when the weight / ring moves on)
      const wS = sw ? sw[1] : 0, wA = sw ? sw[2] * (1 - sw[3]) : 0, rq = Math.round(Math.min(restR, 2000) / 10);
      const sSig = (Math.round(wS * 20)) + ':' + rq;
      if (sSig !== sfSig) {
        sfSig = sSig; let n = 0; const g = sm(0.05, 0.6, wS);
        if (g > 0.01) for (const s of sunSpots) {
          if (s.d > restR) continue;
          Q.setFromAxisAngle(Y, s.yaw); V.set(s.x, s.y, s.z); SC.set(s.s, s.s * g, s.s); M.compose(V, Q, SC);
          sfStem.setMatrixAt(n, M); SC.set(s.s * g, s.s * g, s.s * g); V.set(s.x, s.y + 3.05 * s.s * (g - 1), s.z); M.compose(V, Q, SC); sfPet.setMatrixAt(n, M); sfDisc.setMatrixAt(n, M); n++;
        }
        for (const m of [sfStem, sfPet, sfDisc]) { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; }
      }
      const pSig = (Math.round(wA * 20)) + ':' + rq;
      if (pSig !== plSig) {
        plSig = pSig; let n = 0; const g = sm(0.05, 0.7, wA);
        if (g > 0.01) for (const s of pileSpots) {
          if (s.d > restR) continue;
          Q.setFromAxisAngle(Y, s.yaw); V.set(s.x, s.y - 0.1, s.z); SC.set(s.s * (0.6 + 0.4 * g), s.s * g, s.s * (0.6 + 0.4 * g)); M.compose(V, Q, SC);
          pile.setMatrixAt(n, M); pile.setColorAt(n, PCOL[s.c]); n++;
        }
        pile.count = n; pile.visible = n > 0; pile.instanceMatrix.needsUpdate = true; if (pile.instanceColor) pile.instanceColor.needsUpdate = true;
      }
      // 5. heat shimmer: summer, late morning to mid afternoon, dry + calm-ish
      const h = rest && rest.h !== undefined ? rest.h : 12;
      const hk = wS * sm(10.5, 12.5, h) * (1 - sm(15.5, 17.5, h)) * (1 - night) * (1 - wx.r) * (1 - wx.windy * 0.6) * 0.07;
      shimmer.visible = hk > 0.003; if (shimmer.visible) { HU.uK.value = hk; HU.uT.value = t; HU.uC.value.set(target.x, ground(target.x, target.z, target.y) + 0.2, target.z); }
    };
    api.stats = () => ({ rain: rain.visible, umbrellas: uTop.count, puffs: puffs.length, sunflowers: sfStem.count, piles: pile.count, shimmer: shimmer.visible, sunSpots: sunSpots.length, pileSpots: pileSpots.length, reduced: RED });
    return api;
  }

  // ---------------------------------------------------------------- the weather chip + card (home + visits)
  // o = { $: id => el, toast(html, ms), IC (icons), title(kind) } ; refresh(wx, S) a few times a second
  const WXI = {
    clear: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5" fill="#ffd34d"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" fill="none" stroke-linecap="round"/></svg>',
    breezy: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linecap="round" fill="none"><path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/></svg>',
    windy: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linecap="round" fill="none"><path d="M2 8h12a3 3 0 1 0-3-3"/><path d="M2 12h18a3 3 0 1 1-3 3"/><path d="M2 16h8a2.5 2.5 0 1 1-2.5 2.5"/></svg>',
    drizzle: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 13a4 4 0 0 1 1-7.8A5 5 0 0 1 17 6a3.5 3.5 0 0 1 1 7z" fill="#e3effa"/><path d="M9 16l-.6 2M14 16l-.6 2" fill="none"/></svg>',
    rain: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 13a4 4 0 0 1 1-7.8A5 5 0 0 1 17 6a3.5 3.5 0 0 1 1 7z" fill="#bcd7f2"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" fill="none"/></svg>',
    snow: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 12a4 4 0 0 1 1-7.8A5 5 0 0 1 17 5a3.5 3.5 0 0 1 1 7z" fill="#eef5ff"/><path d="M8 16v4M6 18h4M15 15v4M13 17h4" fill="none"/></svg>',
    get flurry() { return WXI.snow; },
    wet: '<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round"><path d="M12 3c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10z" fill="#9fd0f5"/></svg>',
  };
  const FXI = { water: '#7fc4f0', garden: '#7fd36a', wood: '#c78b55', boat: '#b8a4f2', dry: '#ffd34d' };
  WeatherFx.chip = function (o) {
    const $ = o.$, bar = $('resbar'); if (!bar) return null;
    bar.insertAdjacentHTML('beforeend', '<div id="wxChip" title="The sky today"><span id="wxI"></span><span id="wxT"></span></div>');
    const card = document.createElement('div'); card.id = 'wxCard'; card.className = 'card'; card.dataset.card = 'menu'; card.hidden = true; ($('app') || document.body).appendChild(card);
    const chip = $('wxChip'); let kind = '', open = false, lastFx = '', said = {}, held = { k: '', t: 0 }, lineN = 0;
    chip.onclick = e => { e.stopPropagation(); open = !open; card.hidden = !open; lastFx = ''; };
    card.onclick = () => { open = false; card.hidden = true; };
    const ui = {
      refresh(wx, S, now) {
        const W = window.Weather; if (!W) return;
        let k = wx.on || wx.r > 0.05 ? wx.kind : 'clear';
        // playtest fixes (c4): in winter season_fx always lets a light snow drift down (its season particles), so a "clear" or
        // breezy winter sky says so instead of "Clear skies" under falling snow (a real snow spell stays 'snow' + its effects)
        if (wx.snow && (k === 'clear' || k === 'breezy')) k = 'flurry';
        if (k !== kind) { kind = k; $('wxI').innerHTML = WXI[k] || WXI.clear; $('wxT').textContent = W.TITLE[k] || 'Clear skies'; chip.className = 'wx-' + k; }
        const a = Object.assign({}, wx.raw || W.at(S), { r: wx.r, windy: wx.windy, wet: wx.wet, snow: wx.snow, on: true }), fx = W.effects(S, a);
        const sig = k + ':' + fx.map(f => f.t).join('|');
        chip.title = (W.TITLE[k] || 'Clear skies') + (fx.length ? ': ' + fx.map(f => f.t).join(', ') : ': a quiet sky. Rain fills the Water bar, wind helps woodcutters + skyboats.');
        chip.classList.toggle('busy', fx.length > 0);
        if (open && sig !== lastFx) {
          lastFx = sig; const ln = W.line(k, lineN);
          card.innerHTML = `<div class="wxh">${WXI[k] || WXI.clear}<b class="disp">${W.TITLE[k] || 'Clear skies'}</b></div>` +
            (fx.length ? '<ul>' + fx.map(f => `<li><i style="background:${FXI[f.ic] || '#ddd'}"></i>${f.t}</li>`).join('') + '</ul>' : '<p class="sub">A quiet sky. Rain fills the Water bar and helps the gardens; a wind helps the woodcutters and blows the skyboats home sooner.</p>') +
            (ln ? `<p class="wxl">&ldquo;${ln}&rdquo;</p>` : '');
        }
        // the tree says something when rain / snow / a wind settles in (held 45 s), once per kind per 90 min of real time
        const sayK = k === 'rain' || k === 'snow' || k === 'windy' ? k : null;
        if (sayK !== held.k) held = { k: sayK, t: now };
        if (sayK && now - held.t > 45000 && (!said[sayK] || now - said[sayK] > 90 * 60000) && o.toast && !(o.busy && o.busy())) {
          said[sayK] = now; lineN++; const ln = W.line(sayK, lineN + Math.floor(now / 1000));
          if (ln) o.toast(`<b>The Elder Tree:</b> ${ln}`, 6500);
        }
      },
      close() { open = false; card.hidden = true; },
    };
    return ui;
  };
  window.WeatherFx = WeatherFx;
})();
