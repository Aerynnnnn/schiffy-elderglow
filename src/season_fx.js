// SeasonFx (step 5): what the season looks like, on top of the map tints (ElderMap.uSeason, set here) - no new models.
//  - weather: ONE Points draw animated in the vertex shader around the camera target (positions wrap in a box, so they
//    stay put in the world while the camera moves): spring petals, summer pollen motes, autumn leaves, winter snow
//  - autumn lanterns: paper lanterns on little poles in a ring round the plaza + at built cottages (instanced; glow
//    points; night light sources through plots.glowPieces)
//  - winter snow pups: little pups made of snow by the plaza (instanced spheres + cones + coal eyes + a scarf)
//  - seasonal festival (Events 'fest'): more lanterns lit / more snow pups / a petal swirl / sun sparkles
//  - winter cozy windows (ElderMap.uCozy: GlowWindow parts lit warm from dusk); the sky + water tints live in DayNight
(function () {
  'use strict';
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, o || {}));
  function tex(draw) { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); return t; }
  const SOFT = tex(g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const LEAF = tex(g => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(32, 32, 13, 26, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 8); g.lineTo(32, 56); g.stroke(); });
  const HALO = tex(g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

  function SeasonFx(scene, map, nav, ground, opts) {
    const PHONE = !!(opts && opts.phone), TP = nav.TP;
    // ---- weather (GPU particles)
    const N = PHONE ? 700 : 1500, BOX = 240, HGT = 120;
    const geo = new THREE.BufferGeometry(), seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    // vibe pass 2: every particle picks its season by the blend weights (uW), so a season change cross-fades (the old kind thins out while
    // the new one fills in) instead of the dominant one switching over half-way; uDen = density per kind (festival boost included)
    // seasons + weather pass: uOff = wind travel (m, integrated by the game's weather, wrapped every 10 boxes: speeds are k/10 so a wrap
    // never jumps a particle), uGust = 0..1 (leaves + petals tumble and lift in a gust)
    const WU = { uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uW: { value: new THREE.Vector4(0, 0, 1, 0) }, uDen: { value: new THREE.Vector4(1, 1, 1, 1) }, uScale: { value: 600 }, uNight: { value: 0 }, uLeaf: { value: LEAF }, uSoft: { value: SOFT },
      uOff: { value: new THREE.Vector2() }, uGust: { value: 0 } };
    const wMat = new THREE.ShaderMaterial({
      uniforms: WU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 seed; uniform float uT, uScale, uNight, uGust; uniform vec4 uW, uDen; uniform vec3 uC; uniform vec2 uOff; varying vec4 vC; varying float vRot; varying float vKind;
        void main() {
          float pick = fract(seed.x * 7.31 + seed.y * 3.77), acc = uW.x, uKind = 0.0, den = uDen.x, wk = uW.x;
          if (pick >= acc) { acc += uW.y; uKind = 1.0; den = uDen.y; wk = uW.y; }
          if (pick >= acc) { acc += uW.z; uKind = 2.0; den = uDen.z; wk = uW.z; }
          if (pick >= acc) { uKind = 3.0; den = uDen.w; wk = uW.w; }
          vKind = uKind;
          float B = ${BOX.toFixed(1)}, Hh = ${HGT.toFixed(1)};
          float fall = uKind < 0.5 ? 1.6 : uKind < 1.5 ? -0.35 : uKind < 2.5 ? 3.2 : 2.6;
          fall *= 0.7 + 0.6 * seed.z;
          float sw = sin(uT * (0.6 + seed.w) + seed.x * 40.0) * (uKind > 2.5 ? 1.2 : 3.0);
          vec3 p;
          vec2 wo = uOff * ((7.0 + floor(seed.w * 6.99)) / 10.0) * (uKind > 0.5 && uKind < 1.5 ? 0.6 : 1.0);   // blown along the wind
          p.x = uC.x + (fract(seed.x - (uC.x - sw - wo.x - uT * (uKind > 1.5 && uKind < 2.5 ? 1.2 : 0.5)) / B) - 0.5) * B;
          p.z = uC.z + (fract(seed.y - (uC.z - wo.y - cos(uT * 0.5 + seed.y * 30.0) * 2.0) / B) - 0.5) * B;
          p.y = uC.y - 30.0 + fract(seed.z * 7.0 - uT * fall / Hh) * Hh;
          p.y += uGust * (uKind < 2.5 ? 4.0 : 1.5) * sin(uT * (1.3 + seed.x) + seed.y * 20.0);   // gusts lift + tumble them
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float on = step(seed.w, den) * step(0.001, wk) * min(1.0, dot(uW, vec4(1.0)) * 1.25);
          float sz = uKind < 0.5 ? 0.8 : uKind < 1.5 ? 0.55 : uKind < 2.5 ? 0.95 : 0.85;
          // vibe pass 1: never a giant blob by the lens: capped size, and faded out near the camera (vibe pass 2: smaller leaves / petals,
          // a lower cap (~3.5 % of the view height) and a longer fade, 10 -> 40 m: the follow view no longer shows red ovals)
          gl_PointSize = on > 0.001 ? min(sz * (0.7 + 0.6 * seed.x) * uScale / max(1.0, -mv.z), uScale * 0.035) : 0.0;
          on *= smoothstep(10.0, 40.0, -mv.z);
          gl_Position = projectionMatrix * mv;
          float fadeD = 1.0 - smoothstep(B * 0.32, B * 0.5, length(p.xz - uC.xz));
          vec3 col = uKind < 0.5 ? mix(vec3(1.0, 0.72, 0.85), vec3(1.0, 0.92, 0.96), seed.y)
                   : uKind < 1.5 ? mix(vec3(1.0, 0.9, 0.45), vec3(0.85, 1.0, 0.6), seed.y)
                   : uKind < 2.5 ? (seed.y < 0.34 ? vec3(0.95, 0.45, 0.15) : seed.y < 0.67 ? vec3(0.82, 0.24, 0.16) : vec3(1.0, 0.74, 0.24))
                   : vec3(0.97, 0.98, 1.0);
          col *= 1.0 - uNight * (uKind > 2.5 ? 0.35 : 0.55);
          vC = vec4(col, on * fadeD * (uKind > 0.5 && uKind < 1.5 ? 0.75 : 0.95));
          vRot = seed.x * 6.28 + uT * (seed.w - 0.5) * (3.0 + uGust * 6.0);
        }`,
      fragmentShader: `uniform sampler2D uLeaf, uSoft; varying vec4 vC; varying float vRot; varying float vKind;
        void main() {
          vec2 q = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) + 0.5;
          vec4 t = (vKind < 0.5 || (vKind > 1.5 && vKind < 2.5)) ? texture2D(uLeaf, q) : texture2D(uSoft, gl_PointCoord);
          float a = vC.a * t.a; if (a < 0.02) discard;
          gl_FragColor = vec4(vC.rgb * (0.75 + 0.25 * t.r), a);
        }`,
    });
    const weather = new THREE.Points(geo, wMat); weather.frustumCulled = false; weather.renderOrder = 3; scene.add(weather);
    const KIND_DEN = [0.45, 0.3, 0.5, 1.0], NOWX = { r: 0, windy: 0, snow: false, gust: 0, off: [0, 0] };

    // ---- autumn lanterns: ring round the plaza + one by each built cottage door
    const MAXL = 48, LS = 2.4;
    const lPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 4.2, 6).translate(0, 2.1, 0), toon(0x6b4a2c), MAXL);
    const lArm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.14, 0.14).translate(0.6, 4.1, 0), toon(0x6b4a2c), MAXL);
    const lBody = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 12, 8).scale(1, 1.25, 1).translate(1.25, 3.2, 0), new THREE.MeshBasicMaterial({ color: 0xff8a3a }), MAXL);
    const lCol = new Float32Array(MAXL * 3); lBody.instanceColor = new THREE.InstancedBufferAttribute(lCol, 3);
    for (const m of [lPole, lArm, lBody]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== lBody; scene.add(m); }
    const lGlow = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      uniforms: { map: { value: HALO }, scale: { value: 600 }, k: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 16.0 * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; uniform float k; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(1.0, 0.62, 0.25, t.a * k); }',
    }));
    lGlow.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 3), 3)); lGlow.frustumCulled = false; scene.add(lGlow);
    const lanternSpots = [];
    { const R = 40, n = 14; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + 0.11, x = TP[0] + Math.cos(a) * R, z = TP[2] + Math.sin(a) * R; if (nav.dry && !nav.dry(x, z)) continue; lanternSpots.push({ x, z, yaw: -a + Math.PI, ring: true, R }); } }

    // ---- winter snow pups (built of snow): body + head + ears + coal eyes + a red scarf, each a few instanced parts
    // seasons pass: + up to FAR more out across the island (beside road junctions 80-460 m out), so winter is not just the plaza
    const NEAR_S = 14, FAR = PHONE ? 10 : 18, MAXS = NEAR_S + FAR, snowM = toon(0xf4f8ff), coalM = toon(0x2a2442), scarfM = toon(0xe0455a);
    const sBall = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), snowM, MAXS * 2);
    const sEar = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 0.9, 8), snowM, MAXS * 2);
    const sEye = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), coalM, MAXS * 3);
    const sScarf = new THREE.InstancedMesh(new THREE.TorusGeometry(1.3, 0.28, 6, 14).rotateX(Math.PI / 2), scarfM, MAXS);
    for (const m of [sBall, sEar, sEye, sScarf]) { m.count = 0; m.frustumCulled = false; m.castShadow = m === sBall; m.receiveShadow = true; scene.add(m); }
    const snowSpots = [];
    { const n = NEAR_S; for (let k = 0; k < n; k++) { const a = k * 2.399 + 0.5, R = 46 + (k % 3) * 9, x = TP[0] + Math.cos(a) * R, z = TP[2] + Math.sin(a) * R; if (nav.dry && !nav.dry(x, z)) continue; snowSpots.push({ x, z, yaw: Math.atan2(TP[0] - x, TP[2] - z) + (k % 2 ? 0.4 : -0.3), s: 0.9 + (k % 4) * 0.12 }); } }
    const farSpots = [];
    { const hs = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
      const cand = (nav.nodes || []).map((nd, i) => ({ nd, i, d: Math.hypot(nd.p[0] - TP[0], nd.p[2] - TP[2]) })).filter(c => c.d > 80 && c.d < 460 && c.nd.p[1] < 60).sort((a, b) => hs(a.i * 7 + 3) - hs(b.i * 7 + 3));
      for (const c of cand) {
        if (farSpots.length >= FAR) break;
        const a = hs(c.i * 13 + 1) * 6.283, x = c.nd.p[0] + Math.cos(a) * 7, z = c.nd.p[2] + Math.sin(a) * 7;
        if ((nav.dry && !nav.dry(x, z)) || (nav.roadDist && nav.roadDist(x, z) < 3.5) || (nav.blockAt && nav.blockAt(x, z)) || farSpots.some(f => Math.hypot(f.x - x, f.z - z) < 40)) continue;
        farSpots.push({ x, z, far: true, yaw: a + Math.PI, s: 0.85 + hs(c.i) * 0.4 });
      } }

    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), O = new THREE.Matrix4(), CL = new THREE.Color();
    const put = (mesh, j, x, y, z, yaw, s, sx, sy, sz) => { Q.setFromAxisAngle(Y, yaw); V.set(x, y, z); SC.set(s * (sx || 1), s * (sy || 1), s * (sz || 1)); mesh.setMatrixAt(j, M.compose(V, Q, SC)); };
    let lSig = '', sSig = '', lanternsNow = [], lSwing = false; const lPlace = [];
    const api = {
      weights: [0, 0, 0, 0], fest: 0, festSea: -1, weather, lanterns: () => lanternsNow, wx: null,   // wx = the game's weather view (src/weather_fx.js)
      // homes: [[x, z, yaw]] (built cottage doors), camT = orbit target, night 0..1, rootR = the tree's trunk + root radius
      update(w, t, dt, night, camT, renderer, homes, rootR) {
        api.weights = w;
        ElderMap.uSeason.value.set(w[0], w[1], w[2], w[3]);
        ElderMap.uCozy.value = w[3] * Math.max(night, 0.55);
        // weather: each particle's season is picked by the blend weights (a season change cross-fades)
        // seasons + weather pass: the first snow ends the leaf fall (autumn's share turns into snowflakes: the shader gives what is
        // left of the weights to snow), wind blows them along (api.wx from the game's weather), a snowfall thickens the snow, rain
        // washes the pollen out of the air, a wind shakes more leaves + petals loose
        const wx = api.wx || NOWX;
        WU.uT.value = t; WU.uC.value.copy(camT); WU.uW.value.set(w[0], w[1], w[2] * Math.pow(1 - w[3], 4), w[3]); WU.uNight.value = night;
        WU.uOff.value.set(wx.off[0], wx.off[1]); WU.uGust.value = wx.gust;
        const fb = k => KIND_DEN[k] * (api.fest && api.festSea === k ? 1.6 : 1) * (k === 3 ? 1 + (wx.snow ? 2.2 * wx.r : 0) : k === 1 ? 1 - 0.8 * wx.r : 1 + 0.9 * wx.windy);
        WU.uDen.value.set(fb(0), fb(1), fb(2), fb(3));
        WU.uScale.value = renderer.domElement.height / (2 * Math.tan(Math.PI / 180 * 20));
        // autumn lanterns (fade in with autumn; during the lantern festival all lit + brighter)
        const aw = w[2], R = Math.max(44, rootR * 1.65);   // a ring just outside the roots
        const want = [];
        if (aw > 0.02) {
          lanternSpots.forEach(sp => { const a = Math.atan2(sp.z - TP[2], sp.x - TP[0]); want.push([TP[0] + Math.cos(a) * R, TP[2] + Math.sin(a) * R, -a + Math.PI]); });
          for (const h of homes) if (want.length < MAXL) want.push(h);
        }
        const sig = want.length + ':' + R.toFixed(1) + ':' + aw.toFixed(2);
        if (sig !== lSig) {
          lSig = sig; const gp = lGlow.geometry.attributes.position.array; lanternsNow = [];
          want.forEach((p, j) => {
            const y = ground(p[0], p[1], TP[1]), s = Math.min(1, aw * 1.3), L = LS;   // drawn ~2.5x like the pups
            put(lPole, j, p[0], y, p[1], p[2], L, 1, s, 1); put(lArm, j, p[0], y, p[1], p[2], L, 1, 1, 1); put(lBody, j, p[0], y + (1 - s) * -3 * L, p[1], p[2], s * L);
            lPlace[j] = [p[0], y + (1 - s) * -3 * L, p[1], p[2], s * L];
            lBody.setColorAt(j, CL.setHSL(0.05 + (j % 3) * 0.025, 1, 0.58));
            const ax = p[0] + Math.cos(-p[2]) * 1.25 * L, az = p[1] + Math.sin(-p[2]) * 1.25 * L; gp[j * 3] = ax; gp[j * 3 + 1] = y + 3.2 * L; gp[j * 3 + 2] = az; lanternsNow.push([ax, y + 3.2 * L, az]);
          });
          for (const m of [lPole, lArm, lBody]) { m.count = want.length; m.instanceMatrix.needsUpdate = true; }
          lBody.instanceColor.needsUpdate = true; lGlow.geometry.setDrawRange(0, want.length); lGlow.geometry.attributes.position.needsUpdate = true;
        }
        // seasons + weather pass: the paper lanterns swing on their hooks in a wind (a lean downwind + a sway)
        if (lanternsNow.length && (wx.windy > 0.02 || lSwing)) {
          lSwing = wx.windy > 0.02;
          for (let j = 0; j < lanternsNow.length; j++) {
            const q = lPlace[j]; if (!q) continue; const a = lSwing ? (Math.sin(t * (1.7 + j * 0.07) + j * 1.3) * 0.32 + 0.12) * wx.windy : 0;
            V.set(q[0], q[1], q[2]); Q.setFromAxisAngle(Y, q[3]); M.compose(V, Q, SC.set(1, 1, 1));
            M.multiply(O.makeTranslation(1.25 * q[4], 4.1 * q[4], 0)).multiply(O.makeRotationX(a)).multiply(O.makeTranslation(-1.25 * q[4], -4.1 * q[4], 0)).multiply(O.makeScale(q[4], q[4], q[4]));
            lBody.setMatrixAt(j, M);
          }
          lBody.instanceMatrix.needsUpdate = true;
        }
        lGlow.material.uniforms.k.value = aw * (0.25 + 0.75 * Math.max(night, (api.fest && api.festSea === 2) ? 0.8 : 0)) * (0.9 + 0.1 * Math.sin(t * 3));
        lGlow.material.uniforms.scale.value = WU.uScale.value;
        // winter snow pups (more during the snow-pup festival), a little bob of the head
        const ww = w[3], fest3 = api.fest && api.festSea === 3, nNear = Math.min(snowSpots.length, fest3 ? NEAR_S : 5), nFar = Math.min(farSpots.length, fest3 ? FAR : Math.ceil(FAR * 0.6));
        const nS = ww > 0.05 ? nNear + nFar : 0, ssig = nS + ':' + ww.toFixed(2) + ':' + R.toFixed(1);
        if (ssig !== sSig) {
          sSig = ssig;
          for (let j = 0; j < nS; j++) {
            const sp = j < nNear ? snowSpots[j] : farSpots[j - nNear], a = Math.atan2(sp.z - TP[2], sp.x - TP[0]), r = sp.far ? Math.hypot(sp.x - TP[0], sp.z - TP[2]) : Math.max(Math.hypot(sp.x - TP[0], sp.z - TP[2]), R + 6 + (j % 3) * 8);
            const x = TP[0] + Math.cos(a) * r, z = TP[2] + Math.sin(a) * r, y = ground(x, z, TP[1]), s = sp.s * 2.3 * Math.min(1, ww * 1.4), yaw = sp.far ? sp.yaw : Math.atan2(TP[0] - x, TP[2] - z) + (j % 2 ? 0.4 : -0.3);
            const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
            put(sBall, j * 2, x, y + 0.9 * s, z, yaw, s, 1.05, 0.9, 1.1);                                  // body
            put(sBall, j * 2 + 1, x + fx * 0.25 * s, y + 2.35 * s, z + fz * 0.25 * s, yaw, s * 0.72);       // head
            for (const e of [-1, 1]) {
              put(sEar, j * 2 + (e + 1) / 2, x + rx * e * 0.45 * s + fx * 0.1 * s, y + 3.05 * s, z + rz * e * 0.45 * s + fz * 0.1 * s, yaw, s * 0.7);
              put(sEye, j * 3 + (e + 1) / 2, x + rx * e * 0.25 * s + fx * 0.82 * s, y + 2.5 * s, z + rz * e * 0.25 * s + fz * 0.82 * s, yaw, s);
            }
            put(sEye, j * 3 + 2, x + fx * 0.98 * s, y + 2.25 * s, z + fz * 0.98 * s, yaw, s * 1.3);        // nose
            put(sScarf, j, x + fx * 0.1 * s, y + 1.72 * s, z + fz * 0.1 * s, yaw, s * 0.62);
          }
          sBall.count = nS * 2; sEar.count = nS * 2; sEye.count = nS * 3; sScarf.count = nS;
          for (const m of [sBall, sEar, sEye, sScarf]) m.instanceMatrix.needsUpdate = true;
        }
      },
      // night light sources: lanterns as small warm braziers (DayNight pools + point lights)
      glowPieces(fn) { if (api.weights[2] < 0.3) return; lanternsNow.forEach((p, j) => { if (j % 2) return; fn('EG_Brazier', O.makeScale(0.6, 0.6, 0.6).setPosition(p[0], p[1] - 2.5, p[2]), 'lantern:' + j); }); },
    };
    return api;
  }
  window.SeasonFx = SeasonFx;
})();
