// LightFx (vibe pass 2, lane C): the day lighting pass. View only, owns no state, never touches the sim.
//  - wind: canopies sway more by day + gusts rolling across the land, ground cover bends (elder_map.js uWind, EG_GRASS)
//  - drifting cloud shadows over the land by day (elder_map.js uCloud: value noise in world xz, scrolled with the wind)
//  - a warm soft grade on the plaza round the tree by day (uPlaza)
//  - golden hour (+ a softer dawn): a warm rim light on the Elder Tree (tree_fx `golden`) and god-ray shafts slanting out of the
//    canopy along the sun (ONE additive draw, cylindrical billboards in the vertex shader) + a soft glow behind the crown
//  - dawn mist pockets: soft billboards hugging the rivers + low meadows (ONE draw), only around dawn
// Night (dayCurve night 1) = every knob back to the shipped look (the grass keeps a faint stir), so night is untouched.
// Knobs for tests: `api.K` (strengths), `api.on = false` = everything off (A/B in the same page).
(function () {
  'use strict';
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

  function LightFx(scene, map, nav, ground, o) {
    o = o || {};
    const TP = nav.TP, PHONE = !!o.phone;
    const K = { cloud: 0.28, cloudSize: 190, cloudSpeed: 4.5, plaza: 0.75, plazaR: 100, sway: 0.8, grass: 0.6, grassNight: 0.18, gust: 0.55,
      rays: 0.5, raysDawn: 0.22, rim: 0.32, rimDawn: 0.15, halo: 0.15, mist: 0.34 };
    const WIND = new THREE.Vector2(0.83, 0.55);   // the same direction the grass bends in (elder_map.js EG_GRASS)
    let scroll = 0;

    // ---- god rays: N quads, each a shaft hanging out of the canopy's underside, slanting away from the sun
    const NR = PHONE ? 5 : 8;
    const rg = new THREE.BufferGeometry(), corner = [], base = [], prm = [], idx = [];
    for (let k = 0; k < NR; k++) {
      const a = (k / NR) * Math.PI * 2 + hsh(k * 31 + 7) * 0.6, rr = 0.35 + hsh(k * 17 + 3) * 0.55;
      for (const [x, y] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { corner.push(x, y); base.push(Math.cos(a) * rr, Math.sin(a) * rr, hsh(k * 7 + 1)); prm.push(0.75 + hsh(k * 13 + 5) * 0.6, 0.5 + hsh(k * 19 + 2) * 0.8, hsh(k * 23 + 9) * 6.28); }
      const b = k * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Array(NR * 4 * 3).fill(0), 3));
    rg.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2)); rg.setAttribute('base', new THREE.Float32BufferAttribute(base, 3)); rg.setAttribute('prm', new THREE.Float32BufferAttribute(prm, 3)); rg.setIndex(idx);
    const RU = { uK: { value: 0 }, uC: { value: new THREE.Vector4(0, 0, 0, 1) }, uDir: { value: new THREE.Vector3(0, -1, 0) }, uTime: ElderMap.uTime, uCol: { value: new THREE.Color(1, 0.82, 0.5) } };
    const rays = new THREE.Mesh(rg, new THREE.ShaderMaterial({
      uniforms: RU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec2 corner; attribute vec3 base; attribute vec3 prm; uniform vec4 uC; uniform vec3 uDir; uniform float uTime; varying vec2 vU; varying float vF;
        void main() {
          // uC = (canopy centre x, canopy underside y, z, canopy radius); base = (unit offset x, z, height jitter); prm = (length k, width k, phase)
          vec3 b0 = vec3(uC.x + base.x * uC.w, uC.y - base.z * uC.w * 0.1, uC.z + base.y * uC.w);   // just under the canopy (never drawn over the leaves)
          float len = uC.w * 2.3 * prm.x, wid = uC.w * 0.16 * prm.y;
          vec3 p = b0 + uDir * len * corner.y;
          vec3 toCam = normalize(cameraPosition - p), side = normalize(cross(uDir, toCam));
          p += side * wid * corner.x * (1.0 + corner.y * 0.8);
          vU = corner; vF = 0.6 + 0.4 * sin(uTime * 0.35 + prm.z) * sin(uTime * 0.21 + prm.z * 1.7);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vF *= smoothstep(20.0, 90.0, -mv.z);   // never a sheet over the lens
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uCol; varying vec2 vU; varying float vF;
        void main() { float xs = 1.0 - vU.x * vU.x; float a = uK * vF * pow(1.0 - vU.y, 1.4) * smoothstep(0.0, 0.18, vU.y) * xs * xs;
          if (a < 0.002) discard; gl_FragColor = vec4(uCol * a, 1.0); }`,
    }));
    rays.frustumCulled = false; rays.renderOrder = 4; rays.visible = false; scene.add(rays);
    // a soft glow behind the crown at golden hour
    const GT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GT, color: 0xffc879, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
    halo.visible = false; scene.add(halo);

    // ---- dawn mist: soft billboards over the rivers (every few water cells) + low meadow pockets
    const MP = [];
    if (o.water && o.water.length) {
      const cells = []; for (const [x, z0, z1] of o.water) for (let z = z0; z < z1; z += 3) cells.push([x, z]);
      const step = Math.max(1, Math.floor(cells.length / (PHONE ? 40 : 70)));
      for (let k = Math.floor(hsh(5) * step); k < cells.length; k += step) { const [x, z] = cells[k]; if (Math.hypot(x - TP[0], z - TP[2]) > 620) continue; MP.push([x + (hsh(k) - 0.5) * 8, z + (hsh(k + 9) - 0.5) * 8, 1]); }
    }
    for (let k = 0; k < (PHONE ? 14 : 24); k++) { const a = hsh(k * 7919 + 11) * Math.PI * 2, r = 90 + hsh(k * 104729 + 3) * 360; MP.push([TP[0] + Math.cos(a) * r, TP[2] + Math.sin(a) * r, 0.8]); }
    const mg = new THREE.BufferGeometry(), mc = [], mcen = [], mprm = [], midx = [];
    MP.forEach(([x, z, w], k) => {
      const y = ground(x, z, TP[1]) + 2.5, s = (18 + hsh(k * 3 + 1) * 22) * w;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { mc.push(cx, cy); mcen.push(x, y, z); mprm.push(s, hsh(k * 11 + 2) * 6.28, 0.6 + hsh(k * 5) * 0.4); }
      const b = k * 4; midx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    mg.setAttribute('position', new THREE.Float32BufferAttribute(mcen, 3)); mg.setAttribute('corner', new THREE.Float32BufferAttribute(mc, 2)); mg.setAttribute('prm', new THREE.Float32BufferAttribute(mprm, 3)); mg.setIndex(midx);
    const MU = { uK: { value: 0 }, uTime: ElderMap.uTime, uCol: { value: new THREE.Color(0.93, 0.9, 0.98) }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 } };
    const mist = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      uniforms: MU, transparent: true, depthWrite: false, fog: false,   // fog by hand (uniforms copied in update)
      vertexShader: `attribute vec2 corner; attribute vec3 prm; uniform float uTime; varying vec2 vU; varying float vA; varying float vD;
        void main() {
          vec3 c = position + vec3(sin(uTime * 0.05 + prm.y) * 6.0, sin(uTime * 0.11 + prm.y) * 0.8, cos(uTime * 0.04 + prm.y) * 6.0);
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          float s = prm.x * (1.0 + 0.12 * sin(uTime * 0.09 + prm.y));
          mv.xy += corner * vec2(s * 1.6, s * 0.55);   // wide + low: a pocket of mist lying on the ground
          vU = corner; vA = prm.z * smoothstep(25.0, 110.0, -mv.z); vD = -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uCol; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying vec2 vU; varying float vA; varying float vD;
        void main() { float r = length(vU); float a = uK * vA * pow(max(0.0, 1.0 - r), 1.8);
          if (a < 0.004) discard; float f = smoothstep(fogNear, fogFar, vD);
          gl_FragColor = vec4(mix(uCol, fogColor, f * 0.7), a * (1.0 - f * 0.5)); }`,
    }));
    mist.frustumCulled = false; mist.renderOrder = 2; mist.visible = false; scene.add(mist);

    const v3 = new THREE.Vector3();
    const api = {
      K, on: true, gold: 0, dawnMist: 0, stats: () => ({ rays: rays.visible, mist: mist.visible, mistN: MP.length, halo: halo.visible }),
      // dn = DayNight, fx = TreeFx, sw = season weights, env = { rain }
      update(dn, fx, t, dt, sw, env) {
        env = env || {}; const h = dn.state.h, night = dn.state.night, day = 1 - night, on = api.on;
        // seasons + weather pass: env.rain is the weather's rain 0..1 (a shower counts), env.wind = windiness 0..1 (src/weather_fx.js,
        // already x the reduced-motion factor): canopies + grass sway harder, gusts roll across day AND night, clouds race
        const winter = sw ? sw[3] || 0 : 0, rain = Math.min(1, +env.rain || 0), wnd = Math.min(1, +env.wind || 0);
        // golden hour (17:25 - 18:35 full) and a softer dawn glow; dawn mist 05:30 - 08:00
        const gold = on ? sm(16.3, 17.4, h) * (1 - sm(18.6, 19.4, h)) * day : 0, dawnG = on ? sm(5.6, 6.3, h) * (1 - sm(7.2, 8.0, h)) * (1 - night * 0.6) : 0;
        api.gold = gold;
        // wind + clouds + plaza warmth (all 0 / 1 at night = the shipped look)
        const W = ElderMap.uWind.value, ww = W.w; scroll += dt * K.cloudSpeed * (1 + rain + wnd * 3.5);
        if (on) W.set(1 + K.sway * day * (1 + rain * 0.6) + wnd * 1.4, (K.grassNight + (K.grass - K.grassNight) * day) * (1 - winter * 0.5) * (1 + rain * 0.5) + wnd * 0.9, K.gust * day * (1 + rain) + wnd * 1.1, ww);
        else W.set(1, 0, 0, ww);
        const cl = on ? K.cloud * day * (1 - dawnG * 0.5) * (1 - rain * 0.6) * (1 - (dn.mist || 0) * 0.5) : 0;
        ElderMap.uCloud.value.set(cl, 1 / K.cloudSize, -WIND.x * scroll, -WIND.y * scroll);
        const s = fx ? fx.scale : 0.6;
        ElderMap.uPlaza.value.set(K.plazaR * (0.7 + s * 0.6), on ? K.plaza * day * (1 - winter * 0.4) : 0, TP[1], 0);
        // tree rim (tree_fx owns the uniform: golden + speaking)
        if (fx) fx.golden = gold * K.rim + dawnG * K.rimDawn;
        // god rays + the halo behind the crown
        const rk = (gold * K.rays + dawnG * K.raysDawn) * (1 - rain * 0.8) * (fx && fx.health !== undefined ? Math.max(0.3, Math.min(1, (fx.health - 20) / 50)) : 1);
        rays.visible = rk > 0.004 && !!fx;
        if (rays.visible) {
          const cp = fx.canopy(), sd = dn.dome && dn.dome.material && dn.dome.material.uniforms && dn.dome.material.uniforms.sunDir ? dn.dome.material.uniforms.sunDir.value : v3.set(-0.5, 0.4, 0.3);
          v3.set(-sd.x, -Math.max(0.35, Math.abs(sd.y) + 0.25), -sd.z).normalize();   // away from the sun, slanting down (never flat)
          RU.uDir.value.copy(v3); RU.uC.value.set(TP[0], cp.y0 + (cp.y1 - cp.y0) * 0.1, TP[2], cp.r); RU.uK.value = rk;
          RU.uCol.value.setRGB(1, 0.78 + dawnG * 0.08, 0.5 + dawnG * 0.2);
        }
        halo.visible = (gold + dawnG * 0.5) > 0.01 && !!fx;
        // (set back behind the crown, away from the camera: the canopy hides its middle, so it reads as a back-light round the edge)
        if (halo.visible) { const cp = fx.canopy(), c = o.camera ? o.camera.position : null; halo.position.set(TP[0], (cp.y0 + cp.y1) / 2 + cp.r * 0.2, TP[2]);
          if (c) { v3.set(TP[0] - c.x, 0, TP[2] - c.z).normalize(); halo.position.addScaledVector(v3, cp.r * 1.6); }
          halo.scale.setScalar(cp.r * 4.6); halo.material.opacity = (gold + dawnG * 0.5) * K.halo; }
        // dawn mist
        const mk = on ? sm(5.0, 5.8, h) * (1 - sm(7.4, 8.6, h)) * K.mist * (1 - (dn.mist || 0) * 0.5) : 0;
        api.dawnMist = mk; mist.visible = mk > 0.004 && MP.length > 0;
        if (mist.visible) { MU.uK.value = mk; const f = scene.fog; if (f) { MU.fogColor.value.copy(f.color); MU.fogNear.value = f.near; MU.fogFar.value = f.far; } }
      },
    };
    return api;
  }
  window.LightFx = LightFx;
})();
