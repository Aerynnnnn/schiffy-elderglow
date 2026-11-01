// Pup steering (pathing pass, 2026-11-01). VIEW ONLY: never touches S, so the sim's walks stay deterministic and offline ==
// online. After the sim poses, the boats and the pup-life moments (game.js, right before pups.update), each drawn pup is
// eased out of the other pups and out of lane A's solid props (benches, swings, piles, curiosities: wfx.propsNear) by a
// small offset (<= C.MAX m) that springs in and out. A walking pup only moves sideways (pups pass shoulder to shoulder
// instead of through each other, the sim's timing untouched); a standing one in any direction. Never into deep water or
// a house / tree / rock footprint (nav.wet / nav.blockAt, the same tests the paths use). Pups that sit or perch (benches,
// fire logs, bridge seats), dance, or ride a boat hold their exact spot; the others make room round them.
(function () {
  'use strict';
  function PupSteer(nav, o) {
    o = o || {};
    // R = a drawn pup's half width (pups are drawn ~3x life size), MAX = the most a pup is moved off its own spot, K = spring
    const C = { on: true, R: 1.2, MAX: 3, K: 9, BACK: 1.2 };
    const off = [], cell = new Map(), PR = [], base = [];
    const key = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);
    const held = ps => !!(ps.air || ps.dance || (ps.vg && (ps.vg.perch || ps.vg.sit)));
    const okAt = (x, z, x0, z0) => !(nav.wet && nav.wet(x, z) && !nav.wet(x0, z0)) && !(nav.blockAt && nav.blockAt(x, z, null) && !nav.blockAt(x0, z0, null));
    let props = 0;
    function apply(poses, dt) {
      const n = poses.length; dt = Math.min(dt, 0.1);
      while (off.length < n) off.push([0, 0]);
      if (!C.on) { for (let i = 0; i < n; i++) off[i][0] = off[i][1] = 0; return; }
      // where everyone is drawn now (last frame's offset on this frame's spot), in a 4 m hash
      cell.clear();
      for (let i = 0; i < n; i++) {
        const ps = poses[i], f = off[i]; base[i] = ps.p;
        const x = ps.p[0] + f[0], z = ps.p[2] + f[1], k = key(x, z); let a = cell.get(k); if (!a) cell.set(k, a = []); a.push(i);
      }
      props = 0;
      for (let i = 0; i < n; i++) {
        const ps = poses[i], f = off[i], hold = held(ps);
        if (hold) { f[0] *= Math.max(0, 1 - dt * C.K * 2); f[1] *= Math.max(0, 1 - dt * C.K * 2); }
        else {
          const x = ps.p[0] + f[0], z = ps.p[2] + f[1]; let px = 0, pz = 0;
          const ki = Math.floor(x / 4), kj = Math.floor(z / 4);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const L = cell.get((ki + a) * 100003 + kj + b); if (!L) continue;
            for (const j of L) {
              if (j === i) continue; const q = poses[j]; if (q.air) continue;
              const g = off[j], dx = x - (q.p[0] + g[0]), dz = z - (q.p[2] + g[1]), d = Math.hypot(dx, dz), want = 2 * C.R * (q.small || ps.small ? 0.7 : 1);
              if (d >= want) continue;
              const w = (want - d) * (held(q) ? 1 : 0.6);   // a seated pup does not move: the other one makes all the room
              if (d > 1e-3) { px += dx / d * w; pz += dz / d * w; }
              else { const s = i < j ? 1 : -1, dir = ps.dir || [0, 1], l = Math.hypot(dir[0], dir[1]) || 1; px += -dir[1] / l * s * w; pz += dir[0] / l * s * w; }   // same spot: step aside
            }
          }
          if (o.wfx && o.wfx.propsNear) for (const c of o.wfx.propsNear(x, z, 3, PR)) {
            const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz) || 1e-3, want = c[2] + C.R;
            if (d < want) { px += dx / d * (want - d); pz += dz / d * (want - d); props++; }
          }
          // walking: sideways only (keep to the side the push points to); the last stretch of a walk (sim f > 0.8: arriving
          // at the tree door / a job spot where others already stand) may step aside any way
          if (ps.walking && ps.dir && !(ps.f > 0.8)) {
            const l = Math.hypot(ps.dir[0], ps.dir[1]) || 1, sx = -ps.dir[1] / l, sz = ps.dir[0] / l, lat = px * sx + pz * sz; px = sx * lat; pz = sz * lat;
          }
          // spring toward (current offset + push), drift back toward the pup's own spot when nothing pushes
          let tx = f[0] + px, tz = f[1] + pz;
          if (!px && !pz) { const k = Math.max(0, 1 - dt * C.BACK); tx = f[0] * k; tz = f[1] * k; }
          const m = Math.hypot(tx, tz); if (m > C.MAX) { tx *= C.MAX / m; tz *= C.MAX / m; }
          const e = Math.min(1, dt * C.K), nx = f[0] + (tx - f[0]) * e, nz = f[1] + (tz - f[1]) * e;
          if (okAt(ps.p[0] + nx, ps.p[2] + nz, ps.p[0], ps.p[2])) { f[0] = nx; f[1] = nz; }
          else { f[0] *= 1 - e; f[1] *= 1 - e; }   // that way is the river / a wall: give the room back instead
        }
        if (f[0] || f[1]) ps.p = [ps.p[0] + f[0], ps.p[1], ps.p[2] + f[1]];   // a new array: Sim.pose can hand out the sim's own p.at.p
      }
    }
    // overlaps right now (for checks / captures): pairs of drawn pups closer than `d` m (default a pup's width)
    function overlaps(poses, d) {
      d = d || 2 * C.R * 0.8; let k = 0;
      for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) { const a = poses[i], b = poses[j]; if (a.air || b.air) continue; if (Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) < d) k++; }
      return k;
    }
    return { apply, overlaps, C, off, stats: () => ({ moved: off.filter(f => Math.hypot(f[0], f[1]) > 0.05).length, props }) };
  }
  window.PupSteer = PupSteer;
})();
