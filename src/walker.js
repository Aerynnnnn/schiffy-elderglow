// Walker (step 6): the visitor walks someone's island as Schiffy (art/schiffy.glb = Sky Patrol's rigged model, a COPY
// via Pawty; Idle + Run clips). Simpler than the library viewer's walk mode (walktest.js): no wall collision.
//  - PC: WASD / arrows walk (camera-relative, Shift = run), the camera orbits + follows; click the ground = walk there
//  - phone: tap the ground = walk there (the road graph, like the pups: bridges, bent round the trunk)
// Height from the game's ground grid (the same one the pups stand on); off the map = blocked.
(function () {
  'use strict';
  const V3 = THREE.Vector3;
  function Walker(scene, opt) {
    const { nav, ground, camera, controls } = opt;
    const H = 5.2, SPEED = 11, RUN = 20;
    const holder = new THREE.Group(); scene.add(holder);
    let model = null, mixer = null, idle = null, run = null, ready = false;
    const st = { x: 0, z: 0, y: 0, yaw: 0, path: null, s: 0, keys: {}, moving: 0, dest: null };
    // a stand-in until the GLB lands (or if it fails): a soft cream capsule pup
    const stub = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), new THREE.MeshToonMaterial({ color: 0xfbe3b5 }));
    stub.position.y = 2.2; stub.castShadow = true; holder.add(stub);
    // destination marker (tap / click target)
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.0, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    // a soft pink disc under her (like the pups' collar discs)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 28), new THREE.MeshBasicMaterial({ color: 0xff8fc8, transparent: true, opacity: 0.35, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.08; holder.add(disc);

    function load(loader) {
      return new Promise(res => {
        if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
        loader.load('art/schiffy.glb', gl => {
          model = gl.scene;
          model.traverse(n => {
            if (!n.isMesh) return;
            const m = n.material, src = Array.isArray(m) ? m[0] : m;
            n.material = new THREE.MeshToonMaterial({ color: src.color ? src.color.clone() : 0xffffff, map: src.map || null, transparent: !!src.transparent, alphaTest: src.alphaTest || 0, side: src.side, skinning: !!n.isSkinnedMesh });
            n.castShadow = !src.transparent; n.frustumCulled = false;
          });
          model.updateMatrixWorld(true);
          const top = model.getObjectByName('HeadEnd_M'), h = top ? top.getWorldPosition(new V3()).y : 1.4;
          model.scale.setScalar(H / Math.max(0.2, h));
          holder.add(model); stub.visible = false;
          mixer = new THREE.AnimationMixer(model);
          const clip = n => gl.animations.find(a => a.name === n) || gl.animations.find(a => a.name.toLowerCase().includes(n.toLowerCase()));
          idle = clip('Idle') && mixer.clipAction(clip('Idle')); run = clip('Run') && mixer.clipAction(clip('Run'));
          if (idle) idle.play(); if (run) { run.play(); run.setEffectiveWeight(0); }
          ready = true; res(true);
        }, undefined, e => { console.warn('Schiffy model', e); res(false); });
      });
    }
    const gy = (x, z, fb, br) => ground(x, z, fb, br);
    function place(p) { st.x = p[0]; st.z = p[2]; st.y = gy(p[0], p[2], p[1]); st.path = null; holder.position.set(st.x, st.y, st.z); }
    // nearest road node (bridges included: tapping a bridge walks onto it)
    function nodeNear(x, z) { let bi = 0, bd = Infinity; nav.nodes.forEach((n, i) => { const d = (n.p[0] - x) ** 2 + (n.p[2] - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; }
    function walkTo(p, trunkR) {
      const a = { p: [st.x, st.y, st.z], n: nodeNear(st.x, st.z) }, b = { p: [p[0], p[1], p[2]], n: nodeNear(p[0], p[2]) };
      // a short hop goes straight; a long one follows the roads
      const direct = Math.hypot(p[0] - st.x, p[2] - st.z) < 30;
      st.path = direct ? { pts: [a.p, b.p], cum: [0, Math.hypot(p[0] - st.x, p[2] - st.z)], br: [false, false] } : nav.leg(a, b, trunkR);
      if (direct) st.path.len = st.path.cum[1];
      st.s = 0; st.dest = p.slice(); ring.position.set(p[0], gy(p[0], p[2], p[1]) + 0.25, p[2]); ring.visible = true;
    }
    // ray from the camera through a screen point onto the ground grid (march + bisect)
    const ray = new THREE.Raycaster();
    function pickGround(mx, my, W, H2) {
      ray.setFromCamera({ x: mx / W * 2 - 1, y: -(my / H2) * 2 + 1 }, camera);
      const o = ray.ray.origin, d = ray.ray.direction, at = t => [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
      const above = t => { const p = at(t), g = ground.raw(p[0], p[2]); return g === null ? null : p[1] - g; };
      let prev = 0, t = 0, step = 2;
      for (let i = 0; i < 900 && t < 2500; i++) {
        t += step; step = Math.min(8, step * 1.02); const h = above(t);
        if (h !== null && h <= 0) { let lo = prev, hi = t; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2, hm = above(m); if (hm !== null && hm <= 0) hi = m; else lo = m; } const p = at(hi); p[1] = ground.raw(p[0], p[2]); return p; }
        prev = t;
      }
      return null;
    }
    // keys (ignored while typing in a field)
    const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'run', ShiftRight: 'run' };
    const typing = e => /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
    addEventListener('keydown', e => { const k = KEYMAP[e.code]; if (!k || typing(e)) return; st.keys[k] = true; if (k !== 'run') { st.path = null; ring.visible = false; } if (e.code.startsWith('Arrow')) e.preventDefault(); });
    addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) st.keys[k] = false; });
    addEventListener('blur', () => { st.keys = {}; });

    const fwd = new V3(), side = new V3();
    function update(dt) {
      const K = st.keys; let mx = (K.r ? 1 : 0) - (K.l ? 1 : 0), mz = (K.f ? 1 : 0) - (K.b ? 1 : 0), sp = 0;
      const x0 = st.x, z0 = st.z;
      if (mx || mz) {
        camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); side.set(-fwd.z, 0, fwd.x);
        const l = Math.hypot(mx, mz); mx /= l; mz /= l; sp = K.run ? RUN : SPEED;
        const nx = st.x + (fwd.x * mz + side.x * mx) * sp * dt, nz = st.z + (fwd.z * mz + side.z * mx) * sp * dt, g = ground.raw(nx, nz);
        if (g !== null && Math.abs(g - st.y) < 6) { st.x = nx; st.z = nz; st.y = g; }
      } else if (st.path) {
        sp = st.path.len > 80 ? RUN : SPEED; st.s = Math.min(st.path.len, st.s + sp * dt);
        const q = nav.at(st.path, st.s); st.x = q.p[0]; st.z = q.p[2]; st.y = gy(q.p[0], q.p[2], q.p[1], q.bridge);
        if (st.s >= st.path.len - 1e-3) { st.path = null; ring.visible = false; }
      }
      const dx = st.x - x0, dz = st.z - z0, moved = Math.hypot(dx, dz);
      if (moved > 1e-4) { const want = Math.atan2(dx, dz); let d = want - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); st.yaw += d * Math.min(1, dt * 12); }
      st.moving += ((moved > 1e-4 ? 1 : 0) - st.moving) * Math.min(1, dt * 8);
      holder.position.set(st.x, st.y, st.z); holder.rotation.y = st.yaw;
      if (mixer) { if (run) run.setEffectiveWeight(st.moving); if (idle) idle.setEffectiveWeight(1 - st.moving); if (run) run.timeScale = sp > SPEED ? 1.4 : 1; mixer.update(dt); }
      else stub.position.y = 2.2 + Math.abs(Math.sin(performance.now() / 120)) * 0.4 * st.moving;
      if (ring.visible) ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 180);
      // camera follows (orbit stays free)
      const tgt = new V3(st.x, st.y + 4, st.z), dv = tgt.sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
      controls.target.add(dv); camera.position.add(dv);
    }
    return { holder, load, place, walkTo, pickGround, update, st, get ready() { return ready; }, pos: () => [st.x, st.y, st.z] };
  }
  window.Walker = Walker;
})();
