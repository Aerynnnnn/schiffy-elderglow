// ElderDrift (vibe pass 2, lane C): the idle camera. After ~20 s with no input (and the calm view faded), the camera starts a
// slow orbit with a gentle dolly toward whatever is happening on the island: the tree speaking / a whisper, a colour wave, a
// lantern rising, a critter, a pup moment (src/pup_life.js), and back to the whole tree now and then. Subjects ease into each
// other (critically damped springs with a speed cap, the orbit speed ramps in), so it is never jarring; any input stops it
// on the spot (OrbitControls simply carries on from where the camera is). Off while a card / the build menu / a followed pup /
// the tour / the boat cam / a camera flight is active (game.js busy()). View only: never touches the sim. Home + phone.
// Tests: drift.IDLE (s), drift.force(true) = start now, drift.subject (current), drift.list() (candidates now), drift.stop().
(function () {
  'use strict';
  // smooth damp (Unity-style critically damped spring) for scalars; vector version below
  function damp(cur, tgt, st, k, T, maxV, dt) {
    const om = 2 / T, x = om * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let ch = cur - tgt; const mx = maxV * T; ch = Math.max(-mx, Math.min(mx, ch));
    const tmp = (st[k] + om * ch) * dt; st[k] = (st[k] - om * tmp) * e; let out = cur - ch + (ch + tmp) * e;
    if ((tgt - cur > 0) === (out > tgt)) { out = tgt; st[k] = 0; } return out;
  }
  function make(o) {
    const cam = o.camera, ctl = o.controls, TP = o.nav.TP;
    let inputT = performance.now(), active = false, forced = false, subj = null, holdT = 0, listT = 0, cands = [];
    const F = new THREE.Vector3(), VEL = { x: 0, y: 0, z: 0, d: 0, e: 0 }, P = new THREE.Vector3();
    let az = 0, el = 0.5, dist = 200, azV = 0;
    const api = {
      IDLE: 20, get active() { return active; }, get subject() { return subj; }, list: () => o.subjects(),
      force(v) { forced = !!v; if (v) inputT = performance.now() - api.IDLE * 1000 - 1; else api.stop(); },
      stop() { active = false; subj = null; azV = 0; for (const k in VEL) VEL[k] = 0; },
    };
    const wake = () => { inputT = performance.now(); forced = false; if (active) api.stop(); };
    for (const t of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(t, wake, { capture: true, passive: true });

    function begin() {
      active = true; F.copy(ctl.target); P.copy(cam.position).sub(F);
      dist = P.length(); el = Math.asin(Math.max(-1, Math.min(1, P.y / Math.max(1e-3, dist)))); az = Math.atan2(P.x, P.z);
      for (const k in VEL) VEL[k] = 0; azV = 0; subj = null; holdT = 0;
    }
    // weighted pick of the next subject (not the same one again unless it is all there is); urgent ones (w >= 9) cut in
    function pickNext() {
      const L = cands.filter(c => !subj || c.id !== subj.id); if (!L.length) return cands[0] || null;
      let tot = 0; for (const c of L) tot += c.w; let r = Math.random() * tot; for (const c of L) { r -= c.w; if (r <= 0) return c; } return L[L.length - 1];
    }
    api.update = function (dt) {
      const now = performance.now();
      if (!active) { if (o.busy() || !(forced || (o.faded() && now - inputT > api.IDLE * 1000))) return false; begin(); }
      if (o.busy()) { api.stop(); return false; }
      listT -= dt; if (listT <= 0 || !subj) { listT = 1; cands = o.subjects(); }
      const urgent = cands.find(c => c.w >= 9 && (!subj || subj.id !== c.id) && !(subj && subj.w >= 9));
      holdT -= dt;
      if (urgent) { subj = urgent; holdT = urgent.hold || 20; }
      else if (!subj || holdT <= 0 || (subj && !cands.some(c => c.id === subj.id) && holdT > 3)) { const n = pickNext(); if (n) { subj = n; holdT = n.hold || 24 + Math.random() * 12; } }
      if (!subj) return false;
      const p = subj.pos(); if (!p) { subj = null; return false; }
      // where to look + how far: a subject's frame radius r, a lower angle for small things, further back on a portrait phone
      const portrait = o.portrait ? o.portrait() : false, k = portrait ? 1.35 : 1;
      const tD = Math.max(32, Math.min(o.maxDist ? o.maxDist() : 520, subj.r * 4.2)) * k, tE = subj.el !== undefined ? subj.el : (subj.r < 12 ? 0.42 : 0.45);   // small things from a little higher: over the plaza's lamp posts
      F.x = damp(F.x, p[0], VEL, 'x', 4.5, 28, dt); F.y = damp(F.y, p[1], VEL, 'y', 4.5, 28, dt); F.z = damp(F.z, p[2], VEL, 'z', 4.5, 28, dt);
      dist = damp(dist, tD, VEL, 'd', 6, 30, dt); el = damp(el, tE, VEL, 'e', 6, 0.08, dt);
      azV += ((subj.spin !== undefined ? subj.spin : 0.028) - azV) * Math.min(1, dt * 0.25); az += azV * dt;   // the orbit eases in
      const ce = Math.cos(el); P.set(Math.sin(az) * ce * dist, Math.sin(el) * dist, Math.cos(az) * ce * dist).add(F);
      // never inside the trunk / roots, never under the ground
      const tr = o.nav.trunkR(o.scale()) + 12, dx = P.x - TP[0], dz = P.z - TP[2], dh = Math.hypot(dx, dz);
      if (dh < tr && P.y < TP[1] + 60 * o.scale()) { P.x = TP[0] + dx / (dh || 1) * tr; P.z = TP[2] + dz / (dh || 1) * tr; }
      const gy = o.ground(P.x, P.z, TP[1]) + 7; if (P.y < gy) P.y = gy;
      cam.position.copy(P); ctl.target.copy(F);
      return true;
    };
    return api;
  }
  window.ElderDrift = { make };
})();
