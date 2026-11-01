// Foley (vibe pass 2, lane C): the small sounds of island life, all procedural (src/audio.js SFX), all view-side (never touches the
// sim), rate-limited (its own timers + audio.js GAP) and attenuated by the distance to the CAMERA (closer than audio.js's own
// sfx3 curve: little sounds fade out within tens of metres). Quiet by default (gains <= 0.6 before the player's sliders).
//  - soft pitter-patter from walking pups near the lens      - a wind chime on the plaza (more in a breeze)
//  - water lapping at the expedition dock                    - the Elder Tree creaking now and then at night
//  - a yawn when a pup near the lens lies down for a nap, little snores from nappers close by
//  - the sky whale's call while it passes (repeats while it is in the sky)
//  - wood chops / stone clacks from gatherers at work near the lens
//  - the Elderglow theme at dawn (once per island morning)
// game.js calls foley.update(dt, env) every frame (cheap: a few timers; the pup scans run only when a timer fires).
(function () {
  'use strict';
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  function Foley(snd, o) {
    let tStep = 1, tChime = 6, tLap = 3, tCreak = 30, tSnore = 4, tWhale = 0, tGather = 1, lastH = -1, whaleOn = false;
    const napWas = [], v = new THREE.Vector3();
    const R = () => Math.random();
    const camP = () => o.camera.position;
    const dist = (p) => camP().distanceTo(v.set(p[0], p[1], p[2]));
    // gain from the camera distance: full within `near` m, gone at `far` m
    const fall = (d, near, far) => Math.pow(clamp01(1 - (d - near) / (far - near)), 1.4);
    const at = (name, p, g, rate) => snd.sfx3(name, p[0], p[1], p[2], { gain: g, rate: rate || 1 });
    const api = {
      stats: { step: 0, chime: 0, lap: 0, creak: 0, yawn: 0, snore: 0, whale: 0, gather: 0, dawn: 0 },
      // env = { night, h (island hour), wind 0..1, rain, poses (drawn), quiet (a card / boat cam: little sounds pause) }
      update(dt, env) {
        if (!snd.live) return;
        const S = o.S(), P = o.pups.list, poses = env.poses || [], st = api.stats, camD = o.camera.position.distanceTo(o.target());
        // the Elderglow theme as the sun comes up (island clock crossing 06:24), once per island morning
        if (lastH >= 0 && lastH < 6.4 && env.h >= 6.4 && env.h < 7.5 && !env.quiet) { if (snd.sfx('theme_dawn', { gain: 0.8 })) st.dawn++; }
        lastH = env.h;
        // footsteps: the walking pup nearest the lens (only when the camera is down among them)
        if ((tStep -= dt) <= 0) {
          tStep = 0.55 + R() * 0.6;
          if (camD < 160) { let best = -1, bd = 70; for (let i = 0; i < poses.length; i++) { const ps = poses[i], Q = P[i]; if (!ps || !Q || !ps.walking || ps.air || !Q.holder.visible) continue; const d = Q.holder.position.distanceTo(camP()); if (d < bd) { bd = d; best = i; } }
            if (best >= 0) { const h = P[best].holder.position; if (at('step', [h.x, h.y, h.z], 0.55 * fall(bd, 12, 70), 0.85 + R() * 0.35)) st.step++; } }
        }
        // the plaza's wind chime (a breeze makes it ring more often; a soft one at night)
        if ((tChime -= dt) <= 0) {
          tChime = (22 + R() * 26) / (0.6 + (env.wind || 0.5));
          const d0 = o.door(); if (d0 && !env.quiet) { const p = [d0[0], d0[1] + 8, d0[2]], d = dist(p); if (d < 320 && at('chime', p, 0.42 * fall(d, 60, 320) * (1 - env.night * 0.4), 0.98 + R() * 0.05)) st.chime++; }
        }
        // water lapping at the dock (the expedition dock plot, once built)
        if ((tLap -= dt) <= 0) {
          tLap = 3.5 + R() * 3.5; const dk = o.dock();
          if (dk) { const d = dist(dk); if (d < 240 && at('lap', dk, 0.6 * fall(d, 30, 240), 0.9 + R() * 0.2)) st.lap++; }
        }
        // the tree creaks at night, now and then
        if ((tCreak -= dt) <= 0) {
          tCreak = 40 + R() * 60;
          if (env.night > 0.6) { const TP = o.nav.TP, s = o.scale(), p = [TP[0], TP[1] + 35 * s, TP[2]], d = dist(p); if (at('creak', p, 0.55 * fall(d, 80, 420), 0.8 + R() * 0.3)) st.creak++; }
        }
        // naps: a yawn when a pup near the lens lies down, little snores from the nearest napper
        for (let i = 0; i < S.pups.length; i++) {
          const nap = S.pups[i].phase === 'nap' || !!(poses[i] && poses[i].vg && poses[i].vg.zz);
          if (nap && napWas[i] === false && P[i]) { const h = P[i].holder.position, d = h.distanceTo(camP()); if (d < 90 && at('yawn', [h.x, h.y + 2, h.z], 0.5 * fall(d, 15, 90), 0.9 + R() * 0.25)) st.yawn++; }
          napWas[i] = nap;
        }
        if ((tSnore -= dt) <= 0) {
          tSnore = 6 + R() * 6; let best = -1, bd = 75;
          for (let i = 0; i < S.pups.length; i++) { if (!napWas[i] || !P[i] || !P[i].holder.visible) continue; const d = P[i].holder.position.distanceTo(camP()); if (d < bd) { bd = d; best = i; } }
          if (best >= 0) { const h = P[best].holder.position; if (at('snore', [h.x, h.y + 2, h.z], 0.5 * fall(bd, 10, 75), 0.9 + R() * 0.3)) st.snore++; }
        }
        // the sky whale: a call when it appears, then every 20-35 s while it is in the sky
        const cf = o.crFx && o.crFx(), wv = cf && cf.view ? cf.view.find(c => c.sp === 'whale' && c.s > 0.2) : null;
        if (wv && !whaleOn) tWhale = 0.5; whaleOn = !!wv;
        if (wv && (tWhale -= dt) <= 0) { tWhale = 20 + R() * 15; if (snd.sfx('whale', { gain: 0.5, rate: 0.92 + R() * 0.12 })) st.whale++; }
        // gathering: wood chops / stone clacks from the nearest pup at work
        if ((tGather -= dt) <= 0) {
          tGather = 0.8 + R() * 0.9; let best = -1, bd = 110;
          for (let i = 0; i < S.pups.length; i++) { const p = S.pups[i]; if (p.phase !== 'work' || (p.task !== 'wood' && p.task !== 'stone') || !P[i]) continue; const d = P[i].holder.position.distanceTo(camP()); if (d < bd) { bd = d; best = i; } }
          if (best >= 0) { const h = P[best].holder.position; if (at(S.pups[best].task === 'wood' ? 'chop' : 'clack', [h.x, h.y + 1, h.z], 0.5 * fall(bd, 15, 110), 0.88 + R() * 0.25)) st.gather++; }
        }
      },
    };
    return api;
  }
  window.Foley = Foley;
})();
