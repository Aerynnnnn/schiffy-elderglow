// Walker (step 6): the visitor walks someone's island as Schiffy (art/schiffy.glb = Sky Patrol's rigged model, a COPY
// via Pawty; Idle + Run clips). Simpler than the library viewer's walk mode (walktest.js).
//  - PC: WASD / arrows walk (camera-relative, Shift = run), the camera orbits + follows; click the ground = walk there
//  - phone: tap the ground = walk there (the road graph, like the pups: bridges, bent round the trunk)
// Height from the game's ground grid (the same one the pups stand on), the deck on a bridge; off the map = blocked.
// Pathing pass (2026-11-01): she no longer walks into deep water off a bridge, through a house / tree / rock footprint
// (nav.blockAt) or lane A's props (wfx.propsNear); WASD slides along them, a tap walks round them (nav legs) and a tap
// in the river / on a roof walks to the nearest free spot.
(function () {
  'use strict';
  const V3 = THREE.Vector3;
  function Walker(scene, opt) {
    const { nav, ground, camera, controls, wfx } = opt;
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
    const deck = (x, z) => (nav.deckY ? nav.deckY(x, z) : null);
    const gy = (x, z, fb, br) => { const d = deck(x, z); return d !== null ? d : ground(x, z, fb, br); };
    // where she may stand: not deep water (off a deck), not inside a footprint, not on a prop (R = her half width)
    const PR = [], R = 1.1;
    function free(x, z) {
      if (nav.wet && nav.wet(x, z)) return false;
      if (nav.blockAt && nav.blockAt(x, z, null)) return false;
      if (wfx && wfx.propsNear) for (const c of wfx.propsNear(x, z, 4, PR)) if (Math.hypot(x - c[0], z - c[1]) < c[2] + R) return false;
      return true;
    }
    // the nearest free point to p (rings out to 24 m), or p
    function freeNear(p) { if (free(p[0], p[2])) return p; for (let r = 2; r <= 24; r += 2) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r; if (free(x, z) && ground.raw(x, z) !== null) return [x, gy(x, z, p[1]), z]; } return p; }
    function place(p) { st.x = p[0]; st.z = p[2]; st.y = gy(p[0], p[2], p[1]); st.path = null; holder.position.set(st.x, st.y, st.z); }
    // nearest road node (bridges included: tapping a bridge walks onto it; never a door node: she would go in at that door)
    function nodeNear(x, z) { let bi = 0, bd = Infinity; nav.nodes.forEach((n, i) => { if (n.door) return; const d = (n.p[0] - x) ** 2 + (n.p[2] - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; }
    function walkTo(p, trunkR) {
      p = freeNear(p);
      const a = { p: [st.x, st.y, st.z], n: nodeNear(st.x, st.z) }, b = { p: [p[0], p[1], p[2]], n: nodeNear(p[0], p[2]) };
      // a short hop goes straight when that line is dry + clear; else the nav leg (round water, houses, trees, by the bridges)
      const direct = Math.hypot(p[0] - st.x, p[2] - st.z) < 30 && (!nav.segOk || nav.segOk(a.p, b.p, null, true));      st.path = direct ? { pts: [a.p, b.p], cum: [0, Math.hypot(p[0] - st.x, p[2] - st.z)], br: [false, false] } : nav.leg(a, b, trunkR);
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
    addEventListener('keydown', e => { if (G && !typing(e)) endTour(true); const k = KEYMAP[e.code]; if (!k || typing(e)) return; st.keys[k] = true; if (k !== 'run') { st.path = null; ring.visible = false; } if (e.code.startsWith('Arrow')) e.preventDefault(); });
    addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) st.keys[k] = false; });
    addEventListener('blur', () => { st.keys = {}; });

    // ---- piece 5: the host's guided tour. Schiffy walks the stops in order on the road graph (walkTo = nav legs, free spot near
    // the stop), stands at each for READ s (+ a bit per letter) while the game shows the note; any key (here) or pointer / Skip (the
    // game calls endTour(true)) ends it where she is. cb = { onLeg(i, stop), onStop(i, stop), onEnd(skipped) }.
    const READ = 3.6;
    let G = null;   // { stops, i, phase 'walk' | 'read', t, R, cb }
    function tour(stops, trunkR, cb) {
      if (!stops || !stops.length) return false;
      endTour(true); st.keys = {}; G = { stops, i: -1, phase: 'walk', t: 0, R: trunkR, cb: cb || {} }; nextStop(); return true;
    }
    function nextStop() {
      if (!G) return; G.i++;
      if (G.i >= G.stops.length) { const cb = G.cb; G = null; ring.visible = false; if (cb.onEnd) cb.onEnd(false); return; }
      const s = G.stops[G.i], y = gy(s.x, s.z, st.y); walkTo([s.x, y, s.z], G.R); G.phase = 'walk'; G.t = 0;
      if (G.cb.onLeg) G.cb.onLeg(G.i, s);
    }
    function endTour(skipped) { if (!G) return; const cb = G.cb; G = null; st.path = null; ring.visible = false; if (cb.onEnd) cb.onEnd(!!skipped); }
    function tourTick(dt) {
      if (!G) return;
      G.t += dt;
      if (G.phase === 'walk' && (!st.path || G.t > 90)) { const s = G.stops[G.i]; G.phase = 'read'; G.t = 0; G.dur = READ + Math.min(4, (s.note || '').length * 0.06); st.path = null; ring.visible = false; if (G.cb.onStop) G.cb.onStop(G.i, s); }
      else if (G.phase === 'read') {
        const s = G.stops[G.i]; if (Math.hypot(s.x - st.x, s.z - st.z) > 1.5) { let d = Math.atan2(s.x - st.x, s.z - st.z) - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); st.yaw += d * Math.min(1, dt * 5); }   // she looks at it
        if (G.t >= G.dur) nextStop();
      }
    }
    const fwd = new V3(), side = new V3();
    function update(dt) {
      tourTick(dt);
      const K = st.keys; let mx = (K.r ? 1 : 0) - (K.l ? 1 : 0), mz = (K.f ? 1 : 0) - (K.b ? 1 : 0), sp = 0;
      const x0 = st.x, z0 = st.z;
      if (mx || mz) {
        camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); side.set(-fwd.z, 0, fwd.x);
        const l = Math.hypot(mx, mz); mx /= l; mz /= l; sp = K.run ? RUN : SPEED;
        const vx = (fwd.x * mz + side.x * mx) * sp * dt, vz = (fwd.z * mz + side.z * mx) * sp * dt;
        // blocked ahead: slide along the edge (only the x or only the z part of the step); already stuck inside something
        // (a door spawn, a prop that popped in on her) = any step that is free counts
        const ok = (x, z) => { const g = ground.raw(x, z); return g !== null && Math.abs(gy(x, z, st.y) - st.y) < 6 && (free(x, z) || !free(st.x, st.z)); };
        let nx = st.x + vx, nz = st.z + vz;
        if (!ok(nx, nz)) { if (ok(st.x + vx, st.z)) nz = st.z; else if (ok(st.x, st.z + vz)) nx = st.x; else { nx = st.x; nz = st.z; } }
        if (nx !== st.x || nz !== st.z) { st.x = nx; st.z = nz; st.y = gy(nx, nz, st.y); }
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
    return { holder, load, place, walkTo, pickGround, update, st, free, freeNear, get ready() { return ready; }, pos: () => [st.x, st.y, st.z],
      tour, endTour, get guide() { return G; } };
  }
  window.Walker = Walker;
})();
