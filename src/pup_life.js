// Vibe pass 2, lane B: pup life (VISUAL ONLY: it never touches S, the sim keeps every pup where it was).
// After Sim.pose() + nfx.dance(), apply() may override a resting pup's DRAWN pose:
//  - slice-of-life moments while a pup rests / naps / waits for a blueprint: sitting on a lane A log bench with paws
//    dangling, dangling paws over a bridge, watching the river, sitting by a curiosity the colour woke, chasing a butterfly
//    (a moth at night), two friends napping back to back, tag (puppies tumble), snowball fights in winter, gathering round
//    a pup corner's fire bowl at dusk, stargazing. Which one: the pup's trait (src/traits.js) + time of day + season.
//    The pup walks there on the road graph (nav.leg), and hurries back the moment the sim sends it somewhere (then
//    chases its sim position until it is on it again), so nothing ever teleports.
//  - reactions: a critter arrives -> the nearest free pups run over, look at it, wag + hop; working pups nearby turn their
//    heads; the sky whale = everyone looks up. A lantern rises from the plaza / a lantern drifts in -> pups look up, cheer.
//  - chatter: little speech bubbles in the pup's own voice (Traits.chat), one at a time, now and then while you watch.
(function () {
  'use strict';
  const REST = { rest: 1, nap: 1, wait: 1 };
  const T_ = () => window.Traits;
  // vignette weights per trait (0 = never); context rules in plan()
  const WT = {
    bench: { sleepy: 3, brave: 1, foodie: 2, poet: 2, curious: 1, cuddly: 2, bouncy: 0.5, tidy: 3 },
    bridge: { sleepy: 1, brave: 3, foodie: 1, poet: 3, curious: 2, cuddly: 1, bouncy: 1, tidy: 1 },
    river: { sleepy: 1, brave: 1, foodie: 2, poet: 3, curious: 3, cuddly: 1, bouncy: 1, tidy: 1 },
    curio: { sleepy: 0.5, brave: 2, foodie: 0.5, poet: 2, curious: 3, cuddly: 1, bouncy: 1, tidy: 1 },
    moth: { sleepy: 0.3, brave: 1, foodie: 1, poet: 1, curious: 3, cuddly: 0.5, bouncy: 3, tidy: 0.3 },
    tag: { sleepy: 0.2, brave: 1, foodie: 1, poet: 0.3, curious: 1, cuddly: 1.5, bouncy: 3, tidy: 0.3 },
    nap2: { sleepy: 3, brave: 0.5, foodie: 1, poet: 1, curious: 0.5, cuddly: 3, bouncy: 0.5, tidy: 1 },
    fire: { sleepy: 2, brave: 2, foodie: 3, poet: 3, curious: 2, cuddly: 3, bouncy: 2, tidy: 2 },
    snow: { sleepy: 0.5, brave: 2, foodie: 1, poet: 0.5, curious: 1.5, cuddly: 1, bouncy: 3, tidy: 0.5 },
    stars: { sleepy: 1, brave: 1, foodie: 0.5, poet: 3, curious: 2, cuddly: 1, bouncy: 0.5, tidy: 1 },
  };
  const C = { SPEED: 5, BACK: 8, CHASE: 9.5, MAXLEG: 190, MAXN: 12, SETTLE: 4, CHAT_GAP: [32, 70], STAGGER: 6 };   // STAGGER: vibe 2 lane C
  const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
  const dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

  function PupLife(scene, nav, ground, o) {
    o = o || {};
    const PHONE = !!o.phone, TP = nav.TP, N = nav.nodes;
    const st = [];   // per pup
    let tNow = 0, planT = 0, chatT = 18, chatN = 0, critSeen = null, lanSeen = null, relWas = false;
    const occ = new Map();   // spot key -> pup index
    const departAt = new Map();   // road node -> when a pup last walked out from it to a moment (vibe 2 lane C stagger)
    const nearNode = p => { let bi = 0, bd = Infinity; for (let i = 0; i < N.length; i++) { const d = Math.hypot(N[i].p[0] - p[0], N[i].p[2] - p[2]); if (d < bd) { bd = d; bi = i; } } return bi; };
    const gy = (x, z, y) => ground(x, z, y === undefined ? TP[1] : y);
    // a straight walk across the meadow is fine when it never crosses water (the last 12 m may be a bank / bridge seat)
    const dryLine = (a, b) => { if (!nav.dry) return false; const L = dxz(a, b), n = Math.ceil(L / 3); for (let k = 1; k < n; k++) { const f = k / n; if (L * (1 - f) < 12) break; if (!nav.dry(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f)) return false; } return true; };

    // ---- spots (lazy, cached; benches + curiosities are re-checked for "shown" / "awake" when picked)
    let SP = null;
    // the bridge deck under (x, z): the lowest up-facing surface of the map's bridge pieces near the road height (null = none)
    const RC = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), NM = new THREE.Matrix3();
    function deckY(x, z, y0) {
      // pathing pass: the nav's deck profile first (the raycast below only sees bridges drawn this frame: a seat or deck
      // height asked for while that bridge was culled came back null and stayed cached)
      if (nav.deckY) { const y = nav.deckY(x, z); if (y !== null) return y > y0 - 1.5 && y < y0 + 8 ? y : null; }
      const ms = o.map ? o.map.batches.filter(b => /Bridge/.test(b.key) && b.mesh).map(b => b.mesh) : []; if (!ms.length) return null;
      RC.set(new THREE.Vector3(x, y0 + 25, z), DOWN); RC.far = 40; let best = null;
      for (const h of RC.intersectObjects(ms, false)) {
        if (!h.face) continue; const n = h.face.normal.clone();
        if (h.instanceId !== undefined) { const im = new THREE.Matrix4(); h.object.getMatrixAt(h.instanceId, im); im.premultiply(h.object.matrixWorld); n.applyMatrix3(NM.getNormalMatrix(im)).normalize(); }
        if (n.y > 0.75 && h.point.y > y0 - 1.5 && h.point.y < y0 + 8 && (best === null || h.point.y < best)) best = h.point.y;
      }
      return best;
    }
    // the road nodes of a bridge sit at its ends' height, the kit's arched deck rises ~3-4 m above them: every pup crossing
    // (sim walks included) is drawn on the deck (1 m cells, cached; null = no deck there)
    const deckC = new Map();
    function deckAt(x, z, y0) { const k = Math.round(x) * 100003 + Math.round(z); let v = deckC.get(k); if (v === undefined) { v = deckY(Math.round(x), Math.round(z), y0); if (deckC.size > 4000) deckC.clear(); deckC.set(k, v); } return v === null ? null : Math.max(v, y0); }
    function spots() {
      if (SP) return SP;
      SP = { bridge: [], river: [] };
      // bridges: a bridge node with a bridge neighbour = mid-span; seats on both edges, facing out over the water
      // (the kit's bridges have rails: the pup sits on the deck at mid-span, side-on to the rail, looking down at the water)
      for (let i = 0; i < N.length; i++) {
        if (!N[i].bridge) continue;
        for (const nb of nav.adj[i].map(a => a[0])) {
          if (!N[nb].bridge || nb < i) continue;   // each span once
          const a = N[i].p, b = N[nb].p, dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, px = -dz / l, pz = dx / l, m = [(a[0] + b[0]) / 2, Math.max(a[1], b[1]), (a[2] + b[2]) / 2];
          if (l < 5) continue;
          for (const s of [-1, 1]) {
            const x = m[0] + px * s * 1.3, z = m[2] + pz * s * 1.3, y = deckY(x, z, m[1]); if (y === null) continue;   // the deck arches above the road nodes
            SP.bridge.push({ key: 'b' + i + '.' + nb + (s > 0 ? 'r' : 'l'), p: [x, y, z], face: [px * s, pz * s], n: i, bridge: true });
          }
        }
      }
      // river banks: between the water job's stand point and the water, a little to the side (water carriers keep their spot)
      // + banks found by walking out from the tree until the water mask (nav.dry: ~6 m margin) says water is near: the
      // plaza's own river ring has few water-job spots, and these are a straight dry walk away
      if (nav.dry) for (let k = 0; k < 36; k++) {
        const a = k / 36 * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
        for (let r = 40; r < 260; r += 2) {
          const x = TP[0] + ux * r, z = TP[2] + uz * r; if (nav.dry(x, z)) continue;
          const R2 = r + 2.5, X = TP[0] + ux * R2, Z = TP[2] + uz * R2;
          if (r > 45) SP.river.push({ key: 'k' + k, p: [X, gy(X, Z), Z], face: [ux, uz] });
          break;
        }
      }
      nav.water.forEach((w, k) => {
        if (k < 4) return;   // the water carriers' own four spots (sim.js waterSpot)
        const ax = w.water[0] - w.p[0], az = w.water[2] - w.p[2], l = Math.hypot(ax, az) || 1, ux = ax / l, uz = az / l;
        for (const s of [-1, 1]) { const x = w.p[0] + ux * Math.min(2.2, l * 0.5) - uz * s * 6, z = w.p[2] + uz * Math.min(2.2, l * 0.5) + ux * s * 6; SP.river.push({ key: 'r' + k + s, p: [x, w.p[1], z], face: [ux, uz], n: w.n }); }
      });
      // pathing pass: a bank seat that is really in the river (some lake job spots stand in it) or in a house is dropped
      if (nav.wet) SP.river = SP.river.filter(v => !nav.wet(v.p[0], v.p[2]) && !(nav.blockAt && nav.blockAt(v.p[0], v.p[2], null)));
      return SP;
    }
    function benchSeats() {
      const out = [], K = o.wfx && o.wfx.K && o.wfx.K.bench; if (!K) return out;
      K.items.forEach((it, k) => {
        if (!(it.shown > 0)) return; const fx = Math.sin(it.yaw), fz = Math.cos(it.yaw), rx = Math.cos(it.yaw), rz = -Math.sin(it.yaw), s = it.s || 1;
        for (const side of [-1, 1]) out.push({ key: 'e' + k + side, p: [it.x + rx * side * 1.3 * s + fx * 0.15, it.y, it.z + rz * side * 1.3 * s + fz * 0.15], face: [fx, fz], lift: 1.42 * s });
      });
      return out;
    }
    function curioSeats() {
      const out = []; if (!o.wfx || !o.wfx.curios) return out;
      o.wfx.curios.forEach((c, k) => { if (!c.awake) return; const ax = TP[0] - c.x, az = TP[2] - c.z, l = Math.hypot(ax, az) || 1, ux = ax / l, uz = az / l;
        for (const side of [-1, 1]) { const x = c.x + ux * 7 - uz * side * 2.2, z = c.z + uz * 7 + ux * side * 2.2; out.push({ key: 'c' + k + side, p: [x, gy(x, z, c.y), z], face: [-ux, -uz] }); } });
      return out;
    }
    function fires(S) {
      const out = []; if (!o.plots) return out;
      for (const k in S.plots) {
        const e = S.plots[k]; if (!e.done || e.type !== 'nook') continue; const x = o.plots.byPid[+k]; if (!x) continue;
        // the pup corner's own pieces (plots.js COMPOSITE.nook, plot frame): perch on the two logs, sit on the grass between the
        // planters + behind the stump (4 seats: pups are drawn ~3x life size); everyone faces the fire bowl at (0, -0.2)
        const cs = Math.cos(x.q.ry), sn = Math.sin(x.q.ry), W = (lx, lz) => [x.c[0] + lx * cs + lz * sn, x.c[1] - lx * sn + lz * cs];
        const F0 = W(0, -0.2), f = [F0[0], gy(F0[0], F0[1], x.gy), F0[1]];
        const top = (piece, s, d) => { const b = o.map && o.map.batches.find(q => q.key === piece); return b && b.box ? b.box.max.y * s : d; };
        [[-3.6, 0.9, Math.min(1.4, top('EG_FallenLog_B', 0.8, 0.9))], [3.5, 1.3, Math.min(1.4, top('EG_FallenLog_A', 0.72, 0.9))], [0, -6.6, 0], [0.4, 6.4, 0]].forEach(([lx, lz, lift], j) => {
          const P = W(lx, lz), dx = f[0] - P[0], dz = f[2] - P[1], l = Math.hypot(dx, dz) || 1;
          out.push({ key: 'f' + k + '.' + j, p: [P[0], gy(P[0], P[1], f[1]), P[1]], face: [dx / l, dz / l], fire: f, lift });
        });
      }
      return out;
    }

    // ---- bugs (butterfly by day, glowing moth by night) for the chase moment: a tiny sprite pool
    const WING = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fff';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(32 + s * 13, 24, 13, 15, s * 0.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(32 + s * 10, 44, 9, 11, -s * 0.4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#2a2442'; g.fillRect(30, 16, 4, 34); return new THREE.CanvasTexture(g.canvas); })();
    const bugs = []; for (let k = 0; k < 3; k++) { const m = new THREE.SpriteMaterial({ map: WING, color: 0xffd36a, transparent: true, depthWrite: false }); const s = new THREE.Sprite(m); s.visible = false; s.scale.set(1.3, 1.3, 1); s.renderOrder = 3; scene.add(s); bugs.push({ s, m, used: -1 }); }
    // ---- snowballs: one instanced mesh
    const SBN = 12, sbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf6f8ff, emissive: 0x4a5266 }), SBN);
    sbMesh.count = 0; sbMesh.visible = false; sbMesh.frustumCulled = false; scene.add(sbMesh);
    const balls = [];   // {a: [x,y,z], b: [x,y,z], t, dur, to}
    const M4 = new THREE.Matrix4();

    // ---- chatter bubbles (DOM, positioned each frame over the pup's head)
    const layer = document.createElement('div'); layer.id = 'chat'; (document.getElementById('app') || document.body).appendChild(layer);
    const bubbles = [];   // {i, el, t, dur}
    function say(i, text, dur) {
      if (!text || (o.quiet && o.quiet())) return false;
      for (const b of bubbles.slice()) if (b.i === i || bubbles.length >= (PHONE ? 1 : 2)) { b.el.remove(); bubbles.splice(bubbles.indexOf(b), 1); }
      const el = document.createElement('div'); el.className = 'chatb'; el.textContent = text; layer.appendChild(el);
      bubbles.push({ i, el, t: 0, dur: dur || Math.min(7, 3 + text.length * 0.05) }); chatT = Math.max(chatT, 14); return true;
    }
    const v3 = new THREE.Vector3();
    function placeBubbles(dt, camera, W, H) {
      for (let k = bubbles.length - 1; k >= 0; k--) {
        const b = bubbles[k]; b.t += dt; const P = o.pups.list[b.i];
        if (b.t > b.dur || !P) { b.el.classList.remove('in'); if (b.t > b.dur + 0.5 || !P) { b.el.remove(); bubbles.splice(k, 1); } continue; }
        if (b.t > 0.05) b.el.classList.add('in');
        o.pups.head(b.i, v3); v3.y += 2.6; const d = v3.distanceTo(camera.position); v3.project(camera);
        const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 && d < 420 && P.holder.visible;
        b.el.style.display = vis ? '' : 'none'; if (!vis) continue;
        b.el.style.left = ((v3.x + 1) / 2 * W) + 'px'; b.el.style.top = ((1 - v3.y) / 2 * H - 30) + 'px';
      }
    }

    // ---- per pup state
    const S0 = () => ({ m: 'sim', v: null, L: null, s: 0, pos: null, dir: [0, 1], sp: null, settled: 0, cool: 0, home: null, r: null });
    function legTo(i, S, from, to) {
      const R = nav.trunkR(o.scale ? o.scale() : 0.6);
      return nav.leg(from, to, R);
    }
    function begin(i, S, v, ps) {
      const s = st[i], p = S.pups[i]; if (!p || !p.at) return false;
      // the nearest road node, not the sim's own node (resting pups hang off the door node: every walk would start at the door)
      const home = { p: ps.p.slice(), n: nearNode(ps.p) }, near = dxz(ps.p, v.p) < 30 || (dxz(ps.p, v.p) < (v.maxLeg ? 200 : 125) && dryLine(ps.p, v.p));
      const tn = v.n !== undefined ? v.n : nearNode(v.p);
      let L = null;
      if (dxz(home.p, v.p) >= 1.5) {
        if (near) L = legTo(i, S, home, { p: v.p.slice(), n: home.n });   // a short / dry hop = straight (bent round the trunk)
        else {   // the road: from the nearest node or from the sim's own node (the door for resting pups), whichever is shorter
          const a = legTo(i, S, home, { p: v.p.slice(), n: tn }), b = p.at.n !== home.n ? legTo(i, S, { p: home.p, n: p.at.n }, { p: v.p.slice(), n: tn }) : a;
          L = a.len <= b.len ? a : b;
        }
        if (L.len > (v.maxLeg || C.MAXLEG)) return false;
      }
      s.m = L ? 'go' : 'do'; s.v = v; s.L = L; s.s = 0; s.home = home; s.pos = ps.p.slice(); s.t0 = tNow; v.t0 = null;
      if (L) departAt.set(home.n, tNow);   // vibe 2 lane C: the next walk-out from this node waits a little (no conga line)
      if (v.key) occ.set(v.key, i);
      return true;
    }
    // both or neither (a nap for two / a game of tag)
    function pair(i, j, S, v, w, pi, pj) { if (!begin(i, S, v, pi)) return false; if (!begin(j, S, w, pj)) { cancel(i); return false; } return true; }
    function cancel(i) { if (!st[i] || st[i].m === 'sim') return; release(i); const c = st[i].cool; st[i] = S0(); st[i].cool = c; }
    function release(i) { const s = st[i]; if (s.v && s.v.key && occ.get(s.v.key) === i) occ.delete(s.v.key); if (s.v && s.v.bug) s.v.bug.used = -1, s.v.bug.s.visible = false; }
    function goBack(i, S, ps) {
      const s = st[i]; if (s.m === 'sim' || s.m === 'back' || s.m === 'chase') return;
      const v = s.v; release(i);
      // walking out: turn round on the same leg; at a fixed spot: walk the leg back; running in circles / no leg: straight back
      const circle = v && (v.k === 'moth' || v.k === 'tag');
      if (s.m === 'go' && s.L) { s.m = 'back'; s.Lb = s.L; s.sb = s.s; }
      else if (s.L && !circle && s.pos && v && v.p && dxz(s.pos, v.p) < 1.5) { s.m = 'back'; s.Lb = s.L; s.sb = s.L.len; }
      else s.m = 'chase';
      if (!s.pos) s.pos = (ps ? ps.p : (v && v.p) || [0, 0, 0]).slice();
      // a pair moment ends for both (mode changed first, so the partner's call can't come back here)
      if (v && v.mate !== undefined && st[v.mate] && st[v.mate].v && st[v.mate].v.mate === i) goBack(v.mate, S, null);
    }
    const free = (i, S) => { const s = st[i]; return s && s.m === 'sim' && s.settled > C.SETTLE && s.cool < tNow && !S.pups[i].exp && !!REST[S.pups[i].phase]; };

    // ---- planning: who starts a moment now
    function weightOf(k, tr) { return (WT[k] && WT[k][tr]) || 0; }
    // pick = a pup to start (the boot spread-out); else one random free pup, if it is keen
    function plan(S, poses, env, pick) {
      const T = T_(); if (!T) return false;
      let busy = 0; for (const s of st) if (s && s.m !== 'sim') busy++;
      if (busy >= C.MAXN) return false;
      const night = env.night, dusk = env.dusk, winter = env.winter, rain = env.rain;
      let i = pick;
      if (i === undefined) {
        const cand = []; for (let k = 0; k < S.pups.length; k++) if (free(k, S)) cand.push(k);
        if (!cand.length) return false;
        // one start per planning tick at most (a gentle drift into moments, not everyone at once)
        i = cand[Math.floor(hsh(Math.floor(tNow * 2) * 131 + cand.length) * cand.length)];
      }
      const ps = poses[i], p = S.pups[i], tr = T.of(S, i);
      // vibe 2 lane C: pups leaving the same spot (the door's nap grid) for their moments go one at a time, several seconds apart
      if (pick === undefined) { const n0 = nearNode(ps.p), dt0 = departAt.get(n0); if (dt0 !== undefined && tNow - dt0 < C.STAGGER) { st[i].cool = tNow + 1.5 + hsh(i * 29 + Math.floor(tNow)) * 3; return false; } }
      const sleepy = p.phase === 'nap' || (p.job === 'rest' && night > 0.6);
      // how keen: a resting pup more than a builder between blueprints
      const keen = p.job === 'rest' ? 0.55 : p.phase === 'nap' ? 0.4 : 0.25;
      if (pick === undefined && hsh(Math.floor(tNow * 2) * 977 + i) > keen) { st[i].cool = tNow + 6 + hsh(i * 13 + Math.floor(tNow)) * 10; return false; }
      const opts = [];
      const add = (k, w) => { if (w > 0) opts.push([k, w]); };
      const small = !!ps.small;
      if (sleepy) {
        add('nap2', weightOf('nap2', tr) * 1.5); add('fire', weightOf('fire', tr) * (fires(S).length ? 1 : 0)); add('bench', weightOf('bench', tr) * 0.5);
      } else if (rain) {
        add('nap2', weightOf('nap2', tr)); add('fire', fires(S).length ? weightOf('fire', tr) : 0);
      } else if (night > 0.6) {
        add('stars', weightOf('stars', tr)); add('fire', fires(S).length ? weightOf('fire', tr) * 1.5 : 0); add('moth', weightOf('moth', tr) * 0.6); add('nap2', weightOf('nap2', tr) * 0.6); add('bridge', weightOf('bridge', tr) * 0.4);
      } else {
        const golden = dusk > 0.3 || night > 0.25;
        add('bench', weightOf('bench', tr)); add('bridge', weightOf('bridge', tr)); add('river', weightOf('river', tr)); add('curio', weightOf('curio', tr));
        add('tag', weightOf('tag', tr) * (small ? 4 : 1)); add('nap2', weightOf('nap2', tr) * 0.4);
        if (winter > 0.5) add('snow', weightOf('snow', tr) * 2.5); else add('moth', weightOf('moth', tr));
        if (golden && fires(S).length) add('fire', weightOf('fire', tr) * 3);
      }
      let tot = opts.reduce((a, x) => a + x[1], 0), r = hsh(Math.floor(tNow * 3) * 7 + i * 31) * tot, k = null;
      for (const [kk, w] of opts) { r -= w; if (r <= 0) { k = kk; break; } }
      if (!k) return false;
      if (!startKind(k, i, S, poses, env)) { st[i].cool = tNow + 5; return false; }
      return true;
    }
    // nearest free spot of a list (straight-line pre-filter, then the road leg)
    const pickSpots = (list, from, maxD) => list.filter(v => !occ.has(v.key) && dxz(v.p, from) < (maxD || 110)).sort((a, b) => dxz(a.p, from) - dxz(b.p, from)).slice(0, 5);
    // the nearest free spot that can be walked to (straight over dry land or a road leg <= MAXLEG): tries up to 5
    function tryAt(i, S, ps, list, maxD, make) { for (const v of pickSpots(list, ps.p, maxD)) if (begin(i, S, make(v), ps)) return true; return false; }
    // open ground for a running game: dry, clear of the trunk + roots (nav.clear = the nap grid's own root test), centre + rim
    // vibe 2 lane C: + clear of props / curiosities / buildings / trees (world_fx.blocked: a pup once stood inside a log mid snowball fight)
    const okXZ = (x, z) => Math.hypot(x - TP[0], z - TP[2]) > nav.trunkR(o.scale ? o.scale() : 0.6) + 8 && (!nav.dry || nav.dry(x, z)) && (!nav.clear || nav.clear(x, z, o.scale ? o.scale() : 0.6)) &&
      !(o.wfx && o.wfx.blocked && o.wfx.blocked(x, z, 2.2));
    // the centre, a ring at r (8 bearings: running games circle it) and a half ring
    const openAt = (x, z, r) => okXZ(x, z) && [0, 1, 2, 3, 4, 5, 6, 7].every(k => okXZ(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r)) && [0, 2, 4, 6].every(k => okXZ(x + Math.cos(k * 0.785) * r * 0.5, z + Math.sin(k * 0.785) * r * 0.5));    const outA = (p, h) => Math.atan2(p[2] - TP[2], p[0] - TP[0]) + (hsh(h + Math.floor(tNow)) - 0.5) * 1.6;   // a bearing away from the tree
    function startKind(k, i, S, poses, env) {
      const ps = poses[i], here = ps.p, dur = (a, b) => tNow + a + hsh(i * 71 + Math.floor(tNow)) * (b - a);
      const mates = (R, n) => { const out = []; for (let j = 0; j < S.pups.length; j++) if (j !== i && free(j, S) && dxz(poses[j].p, here) < R) out.push(j); return out.sort((a, b) => (S.pups[b].job === 'rest') - (S.pups[a].job === 'rest') || a - b).slice(0, n); };   // resting pups first: they stay longest
      if (k === 'bench') return tryAt(i, S, ps, benchSeats(), 125, v => ({ k, key: v.key, p: v.p, face: v.face, lift: v.lift, until: dur(45, 120) }));
      if (k === 'bridge') return tryAt(i, S, ps, spots().bridge, 150, v => ({ k, key: v.key, p: v.p, face: v.face, bridge: true, n: v.n, until: dur(40, 100) }));
      if (k === 'river') return tryAt(i, S, ps, spots().river, 190, v => ({ k, key: v.key, p: v.p, face: v.face, n: v.n, until: dur(40, 100) }));
      if (k === 'curio') return tryAt(i, S, ps, curioSeats(), 140, v => ({ k, key: v.key, p: v.p, face: v.face, until: dur(35, 80) }));
      if (k === 'fire') return tryAt(i, S, ps, fires(S), 230, v => ({ k, key: v.key, p: v.p, face: v.face, fire: v.fire, lift: v.lift, until: dur(90, 240), maxLeg: 280 }));   // worth a longer walk at dusk
      if (k === 'stars') {   // a quiet open patch a little way off the nap grid, lying back looking up
        const a0 = outA(here, i * 13); let c = null;
        for (let t = 0; t < 10 && !c; t++) { const a = a0 + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.45, D = 16 + (t % 3) * 7, x = here[0] + Math.cos(a) * D, z = here[2] + Math.sin(a) * D; if (openAt(x, z, 3)) c = [x, gy(x, z, here[1]), z]; }
        if (env && env.at) c = env.at.slice();
        if (!c) return false;   // vibe 2 lane C: no clear patch = no moment (it used to lie down right where it stood, props or not)
        const fa = Math.atan2((c || here)[2] - TP[2], (c || here)[0] - TP[0]);
        return begin(i, S, { k, p: (c || here).slice(), face: [Math.cos(fa), Math.sin(fa)], until: dur(40, 100) }, ps);
      }
      if (k === 'moth') {
        const bug = bugs.find(b => b.used < 0); if (!bug) return false;
        const a0 = outA(here, i * 7); let c = null;   // out into the open, away from the trunk
        for (let t = 0; t < 16 && !c; t++) { const a = a0 + (t % 2 ? 1 : -1) * Math.ceil(t % 8 / 2) * 0.5, D = t < 8 ? 14 : 26, x = here[0] + Math.cos(a) * D, z = here[2] + Math.sin(a) * D; if (openAt(x, z, 7)) c = [x, gy(x, z, here[1]), z]; }
        if (env && env.at) c = env.at.slice();   // captures: a chosen spot
        if (!c) return false; bug.used = i; const r = 5 + hsh(i + 3) * 2.5;
        return begin(i, S, { k, p: [c[0] + r, c[1], c[2]], c, r, bug, ph: 0, until: dur(16, 28), night: env.night > 0.5 }, ps);
      }
      if (k === 'nap2' || k === 'tag') {
        const m = mates(k === 'tag' ? 45 : 60, 4); if (!m.length) return false;
        // nap2 prefers a friend; tag prefers a puppy / a bouncy pup
        const N2 = window.Needs, fr = N2 && N2.friendsOf ? N2.friendsOf(S, i).map(f => f.i) : [];
        const j = m.find(x => fr.includes(x)) !== undefined ? m.find(x => fr.includes(x)) : m[0];
        if (k === 'nap2') {
          // a quiet patch of grass a little way off the crowded nap grid (else right where they are)
          const a0 = outA(here, i * 11); let c = openAt(here[0], here[2], 3) ? here.slice() : null;   // vibe 2 lane C: right here only if it is clear
          for (let t = 0; t < 10; t++) { const a = a0 + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.45, D = 18 + (t % 3) * 6, x = here[0] + Math.cos(a) * D, z = here[2] + Math.sin(a) * D; if (openAt(x, z, 3)) { c = [x, gy(x, z, here[1]), z]; break; } }
          if (env && env.at) c = env.at.slice();
          if (!c) return false;
          const fa = hsh(i * 3 + j) * Math.PI * 2, f = [Math.cos(fa), Math.sin(fa)];
          const v = { k, p: [c[0] + f[0] * 1.05, c[1], c[2] + f[1] * 1.05], face: f.slice(), until: dur(60, 180), mate: j };
          const w = { k, p: [c[0] - f[0] * 1.05, c[1], c[2] - f[1] * 1.05], face: [-f[0], -f[1]], until: v.until, mate: i };
          return pair(i, j, S, v, w, ps, poses[j]);
        }
        const a0 = outA(here, i * 5); let c = null;
        for (let t = 0; t < 16 && !c; t++) { const a = a0 + t * 0.8, D = t < 8 ? 10 : 22, x = (here[0] + poses[j].p[0]) / 2 + Math.cos(a) * D, z = (here[2] + poses[j].p[2]) / 2 + Math.sin(a) * D; if (openAt(x, z, 7)) c = [x, gy(x, z, here[1]), z]; }
        if (env && env.at) c = env.at.slice();   // captures: a chosen spot
        if (!c) return false; const r = 5.5, until = dur(16, 26), tumble = !!(ps.small || poses[j].small);
        const v = { k, c, r, ph: 0, p: [c[0] + r, c[1], c[2]], until, mate: j, tumble, lead: true }, w = { k, c, r, ph: -0.9, p: [c[0] + r * Math.cos(-0.9), c[1], c[2] + r * Math.sin(-0.9)], until, mate: i, tumble };
        return pair(i, j, S, v, w, ps, poses[j]);
      }
      if (k === 'snow') {
        const m = mates(55, 3); if (!m.length) return false; const g = [i].concat(m);
        const a0 = outA(here, i * 3); let c = null;
        for (let t = 0; t < 16 && !c; t++) { const a = a0 + t * 0.8, D = t < 8 ? 24 : 38, x = here[0] + Math.cos(a) * D, z = here[2] + Math.sin(a) * D; if (openAt(x, z, 10)) c = [x, gy(x, z, here[1]), z]; }
        if (env && env.at) c = env.at.slice();   // captures: a chosen spot
        if (!c) return false; const until = dur(25, 45), R = 6 + g.length;
        const V = { k, c, group: g, until };
        let okAll = true;
        g.forEach((j, n) => { const a = n / g.length * Math.PI * 2 + a0, x = c[0] + Math.cos(a) * R, z = c[2] + Math.sin(a) * R;
          const v = Object.assign({}, V, { p: [x, gy(x, z, c[1]), z], face: [-Math.cos(a), -Math.sin(a)], slot: n, next: tNow + 1.5 + n * 0.9 });
          if (okAll && !begin(j, S, v, poses[j])) okAll = false; });
        if (!okAll) { for (const j of g) cancel(j); return false; }
        for (const j of g) if (st[j].v) st[j].v.group = g;
        return okAll;
      }
      return false;
    }
    // ---- reactions (critters, lanterns): a short 'react' moment; pups already in a moment keep their spot but look over
    function react(i, S, poses, target, opt) {
      const s = st[i]; if (!s) return;
      s.look = { p: target, id: opt.id, until: tNow + (opt.dur || 10), cheer: !!opt.cheer, hop: opt.hop !== false };
      if (opt.run && s.m === 'sim' && s.settled > 1 && !S.pups[i].exp) {
        const here = poses[i].p, dx = here[0] - target[0], dz = here[2] - target[2], l = Math.hypot(dx, dz) || 1, rr = opt.near || 7;
        const x = target[0] + dx / l * rr, z = target[2] + dz / l * rr;
        if (!nav.dry || nav.dry(x, z)) begin(i, S, { k: 'react', p: [x, gy(x, z, here[1]), z], face: [-dx / l, -dz / l], until: tNow + (opt.dur || 12) + Math.min(20, l / C.SPEED) }, poses[i]);
      }
    }
    // vibe 2 lane C: the tree speaks -> pups within R of `from` (the door) turn and look up at `target` (its crown) for dur s;
    // the nearest few hop / wag, a sleepy one wakes for it. Returns the pups that turned (nearest first).
    function attend(S, poses, target, from, R, dur) {
      const L = poses.map((ps, i) => [i, dxz(ps.p, from)]).filter(x => x[1] < R && S.pups[x[0]] && !S.pups[x[0]].exp && !poses[x[0]].air).sort((a, b) => a[1] - b[1]);
      L.forEach(([i], k) => react(i, S, poses, target, { dur: dur + k * 0.15, hop: k < 4, cheer: false }));
      return L.map(x => x[0]);
    }
    function critterWatch(S, poses, env) {
      const cf = o.crFx && o.crFx(); if (!cf || !cf.ready || !S.crit) return;
      const ids = S.crit.vis.map(v => v.id);
      if (critSeen === null) { critSeen = new Set(ids); return; }   // already here at boot: no rush (heads still turn)
      for (const v of S.crit.vis) {
        if (critSeen.has(v.id)) continue; const pos = cf.posOf(v.id); if (!pos) continue;
        if (v.c === 'whale') { critSeen.add(v.id); continue; }   // the whale: the continuous look-up below covers it
        if (S.time - v.t0 < 3) continue;   // still flying in
        critSeen.add(v.id);
        const bv = cf.view && cf.view.find(x => x.id === v.id), base = bv ? bv.pos : pos;   // its feet (posOf = its middle)
        const near = poses.map((ps, i) => [i, dxz(ps.p, pos)]).filter(x => x[1] < 95 && !S.pups[x[0]].exp).sort((a, b) => a[1] - b[1]);
        let ran = 0, first = -1;
        for (const [i] of near.slice(0, 6)) {
          const s = st[i], canRun = s && s.m === 'sim' && s.settled > 1 && ran < 3;
          const low = base[1] - poses[i].p[1] < 5;   // perched / floating high: look up, don't run under it
          react(i, S, poses, pos, { run: canRun && low, near: 6 + ran * 2.5, dur: 11, id: v.id });
          if (canRun && low) ran++; if (first < 0) first = i;
        }
        if (first >= 0 && T_()) setTimeout(() => say(first, T_().chat(T_().of(S, first), 'critter', chatN++)), 1400);
      }
      for (const id of [...critSeen]) if (!ids.includes(id)) critSeen.delete(id);
    }
    function lanternWatch(S, poses) {
      const L = o.lfx && o.lfx(); if (!L) return;
      const rel = L.relPos ? L.relPos() : null;
      if (rel && !relWas) {   // a lantern rises from the plaza: everyone near the door looks up and cheers
        const d = nav.door(o.scale ? o.scale() : 0.6).p; let first = -1;
        poses.forEach((ps, i) => { if (S.pups[i].exp || dxz(ps.p, d) > 130) return; st[i].follow = 'rel'; react(i, S, poses, rel, { dur: 13, cheer: true }); if (first < 0 && st[i].m !== 'go') first = i; });
        if (first >= 0 && T_()) setTimeout(() => say(first, T_().chat(T_().of(S, first), 'lantern', chatN++)), 1800);
      }
      relWas = !!rel;
      if (!S.lan || !L.posOf) return;
      const sky = S.lan.got.filter(x => L.posOf(x.id)).map(x => x.id);
      if (lanSeen === null) { lanSeen = new Set(sky); return; }
      for (const id of sky) {
        if (lanSeen.has(id)) continue; lanSeen.add(id); const p = L.posOf(id); if (!p) continue;
        let first = -1; poses.forEach((ps, i) => { if (S.pups[i].exp || dxz(ps.p, p) > 160) return; react(i, S, poses, p, { dur: 9, cheer: (i + chatN) % 3 === 0 }); if (first < 0) first = i; });
        if (first >= 0 && T_()) setTimeout(() => say(first, T_().chat(T_().of(S, first), 'lantern', chatN++)), 2600);
      }
    }

    let warm = 1;
    function spreadOut(S, poses, env) {
      const L = []; for (let i = 0; i < S.pups.length; i++) { const p = S.pups[i], ps = poses[i]; if (st[i].m === 'sim' && !p.exp && !ps.dance && !ps.walking && REST[p.phase]) L.push(i); }
      L.sort((a, b) => hsh(a * 7919 + 3) - hsh(b * 7919 + 3));
      let n = 0; for (const i of L.slice(0, Math.ceil(L.length * 0.6))) { if (st[i].m !== 'sim') continue; st[i].settled = 99; if (plan(S, poses, env, i)) { jump(i); n++; } }
      return n;
    }
    // ---- per frame
    function apply(S, poses, t, dt, env) {
      tNow += dt; env = env || {};
      while (st.length < S.pups.length) st.push(S0());
      if (st.length > S.pups.length) { for (let i = S.pups.length; i < st.length; i++) release(i); st.length = S.pups.length; }
      // 1. settledness + leaving: the sim always wins
      for (let i = 0; i < poses.length; i++) {
        const ps = poses[i], s = st[i], p = S.pups[i];
        const tiny = ps.walking && p.leg && Math.hypot(p.leg.a.p[0] - p.leg.b.p[0], p.leg.a.p[2] - p.leg.b.p[2]) < 3;
        const still = !ps.air && !p.exp && !ps.dance && (REST[ps.phase] || tiny);
        if (!s.sp || dxz(ps.p, s.sp) > 2.5) { s.sp = ps.p.slice(); s.settled = 0; }
        else if (still) s.settled += dt; else s.settled = 0;
        if ((s.m === 'go' || s.m === 'do') && (!still || (s.home && dxz(ps.p, s.home.p) > 3) || (s.v && s.v.until < tNow))) goBack(i, S, ps);
      }
      // 2. start moments (twice a second), reactions
      // the first frames after boot / a long hidden tab: the island is already mid-afternoon (or mid-night), so about half of the
      // resting pups are already out in their moments (they walked there while you were away) instead of all on the nap grid
      if (warm === 1 && tNow > 0.4) { warm = 2; spreadOut(S, poses, env); }
      planT -= dt; if (planT <= 0) { planT = 0.5; plan(S, poses, env); }
      critterWatch(S, poses, env); lanternWatch(S, poses);
      // 3. draw overrides
      const cf = o.crFx && o.crFx(), crit = cf && cf.view ? cf.view : [];
      const L = o.lfx && o.lfx(), relP = L && L.relPos ? L.relPos() : null;
      let nb = 0;
      for (let i = 0; i < poses.length; i++) {
        const ps = poses[i], s = st[i]; let vg = null;
        if (s.m === 'go') {
          s.s += C.SPEED * (0.85 + hsh(i * 7 + 1) * 0.3) * dt; const q = nav.at(s.L, Math.min(s.L.len, s.s));   // each pup its own pace
          s.pos = q.p; s.dir = q.dir; ps.p = q.p.slice(); ps.dir = q.dir; ps.walking = true; ps.phase = 'go'; ps.bridge = q.bridge; ps.carry = null;
          if (s.s >= s.L.len) { s.m = 'do'; s.s = s.L.len; s.v.t0 = tNow; }
        } else if (s.m === 'back') {
          s.sb -= C.BACK * dt; const q = nav.at(s.Lb, Math.max(0, s.sb)), d = q.dir;
          s.pos = q.p; ps.p = q.p.slice(); ps.dir = [-d[0], -d[1]]; ps.walking = true; ps.phase = 'go'; ps.bridge = q.bridge; ps.carry = null;
          if (s.sb <= 0) { s.m = 'chase'; }
        } else if (s.m === 'chase') {
          const tgt = ps.p, dx = tgt[0] - s.pos[0], dz = tgt[2] - s.pos[2], l = Math.hypot(dx, dz);
          if (l < 0.6) { s.m = 'sim'; s.v = null; s.L = null; s.cool = tNow + 20 + hsh(i * 17 + Math.floor(tNow)) * 40; }
          else { const k = Math.min(1, C.CHASE * dt / l); s.pos = [s.pos[0] + dx * k, tgt[1], s.pos[2] + dz * k]; ps.p = s.pos.slice(); ps.dir = [dx / l, dz / l]; ps.walking = true; ps.phase = 'go'; }
        }
        if (s.m === 'do' && s.v) {
          const v = s.v, k = v.k, lt = tNow - (v.t0 || tNow);
          if (v.t0 === null) v.t0 = tNow;
          const sleepy = S.pups[i].phase === 'nap' || (S.pups[i].job === 'rest' && env.night > 0.6);
          ps.walking = false; ps.carry = null; ps.phase = 'rest';
          if (k === 'bridge') { ps.p = v.p.slice(); ps.dir = v.face; ps.bridge = true; vg = { sit: 1, zz: sleepy, headX: sleepy ? 0.5 : 0.42 + Math.sin(t * 0.5 + i) * 0.08, headY: Math.sin(t * 0.3 + i) * 0.4, wag: 0.25 }; }
          else if (k === 'bench') { ps.p = v.p.slice(); ps.dir = v.face; vg = { perch: 1, lift: v.lift || 0.05, zz: sleepy, headX: sleepy ? 0.45 : 0.1 + Math.sin(t * 0.5 + i) * 0.1, headY: sleepy ? 0 : Math.sin(t * 0.33 + i) * 0.5 }; }
          else if (k === 'river' || k === 'curio' || k === 'react') { ps.p = v.p.slice(); ps.dir = v.face; vg = { sit: k === 'react' ? 0 : 1, zz: sleepy && k !== 'react', headX: k === 'river' ? 0.3 : -0.1, headY: Math.sin(t * 0.4 + i) * 0.35, wag: k === 'react' ? 1 : 0.3 }; }
          else if (k === 'fire') { ps.p = v.p.slice(); ps.dir = v.face; vg = { sit: 1, perch: v.lift > 0 ? 1 : 0, lift: v.lift || 0, zz: sleepy && Math.sin(t * 0.1 + i) > 0.3, headX: sleepy ? 0.4 : -0.05 + Math.sin(t * 0.7 + i) * 0.08, sway: 0.12, wag: 0.4 }; }
          else if (k === 'stars') { ps.p = v.p.slice(); ps.dir = v.face; vg = { sit: 1, lean: -0.62, headX: -0.85, headY: Math.sin(t * 0.2 + i) * 0.4 }; }
          else if (k === 'nap2') { ps.p = v.p.slice(); ps.dir = v.face; vg = { sit: 1, lean: -0.32, headX: 0.5 + Math.sin(t * 0.6 + i) * 0.05, zz: true, wag: 0.1 }; }
          else if (k === 'moth' || k === 'tag') {
            const w = (k === 'moth' ? 4.6 : 5.6) / v.r; v.ph += w * dt * (k === 'tag' && !v.lead ? 1 : 1);
            const a = v.ph, x = v.c[0] + Math.cos(a) * v.r, z = v.c[2] + Math.sin(a) * v.r;
            ps.p = [x, v.c[1], z]; ps.dir = [-Math.sin(a), Math.cos(a)]; ps.walking = true; ps.phase = 'go';
            const jump = Math.max(0, Math.sin(t * 3.1 + i)) ** 6;
            vg = { hop: k === 'moth' ? jump : 0.35, cheer: k === 'moth' ? jump : 0, wag: 1, roll: v.tumble && Math.sin(t * 1.7 + i) > 0.6 ? (t * 9 + i) % (Math.PI * 2) : 0 };
            if (k === 'moth' && v.bug) {
              const b = v.bug, ba = a + 0.5, by = v.c[1] + 3.2 + Math.sin(t * 2.3) * 1.1 + jump * 0.6;
              b.s.position.set(v.c[0] + Math.cos(ba) * (v.r + 0.6), by, v.c[2] + Math.sin(ba) * (v.r + 0.6)); b.s.visible = true;
              b.m.color.set(v.night ? 0xfff0b8 : [0xffc23a, 0x6fb8ff, 0xff7ab0][i % 3]); b.m.opacity = 0.95; const f = 0.35 + 0.65 * Math.abs(Math.sin(t * 14 + i)); b.s.scale.set(2.3 * f, 2.3, 1);
              ps.look = b.s.position.toArray(); nb++;
            }
          } else if (k === 'snow') {
            ps.p = v.p.slice(); ps.dir = v.face; vg = { sit: 0, zz: false, throwT: -1, hop: 0, wag: 0.7 };
            if (v.next < tNow) {   // throw at the next pup in the ring
              const g = v.group || [i], to = g[(g.indexOf(i) + 1 + Math.floor(hsh(Math.floor(tNow) + i) * (g.length - 1))) % g.length];
              if (to !== i && poses[to] && st[to] && st[to].m === 'do' && st[to].v && st[to].v.k === 'snow') { const a = [v.p[0] + v.face[0] * 1.2, v.p[1] + 3.2, v.p[2] + v.face[1] * 1.2]; balls.push({ a, to, t: 0, dur: 0.9 }); v.thrown = tNow; }
              v.next = tNow + 2.2 + hsh(i * 9 + Math.floor(tNow)) * 2.5;
            }
            const since = tNow - (v.thrown || -9); if (since < 0.5) vg.throwT = since / 0.5;
            if (v.hit && tNow - v.hit < 0.6) vg.hop = 1 - (tNow - v.hit) / 0.6;
          }
          if (vg && !vg.look) vg.look = null;
        }
        // reactions (any mode): look at the target, wag; a cheer / hop for the free ones
        if (s.look && s.look.until > tNow) {
          const tg = s.follow === 'rel' && relP ? relP : (s.look.id !== undefined && cf && cf.posOf(s.look.id)) || s.look.p;   // a critter: follow it as it wanders
          vg = vg || {}; vg.look = tg; vg.wag = 1; vg.zz = false;   // woken up by it
          if (!ps.walking && s.look.hop) vg.hop = Math.max(vg.hop || 0, Math.max(0, Math.sin(t * 6 + i)) * 0.6);
          if (!ps.walking && s.look.cheer) vg.cheer = Math.max(0, Math.sin(t * 4 + i * 0.7));
          if (!ps.walking && (s.m === 'sim' || (s.m === 'do' && s.v && s.v.k === 'react'))) { const dx = tg[0] - ps.p[0], dz = tg[2] - ps.p[2], l = Math.hypot(dx, dz); if (l > 1) ps.dir = [dx / l, dz / l]; }
        } else if (s.look) { s.look = null; s.follow = null; }
        // ambient: a critter close by gets a look from resting pups (heads only), the sky whale from everyone
        if (!vg || !vg.look) for (const c of crit) {
          const d = dxz(c.pos, ps.p);
          if ((c.sp === 'whale' && c.s > 0.2) || (d < 32 && !ps.walking && c.pos[1] - ps.p[1] < 30)) { vg = vg || {}; vg.look = c.pos; if (c.sp === 'whale') vg.wag = 0.8; break; }
        }
        if (ps.look && !(vg && vg.look)) { vg = vg || {}; vg.look = ps.look; }
        if (ps.bridge && !ps.air) { const y = deckAt(ps.p[0], ps.p[2], ps.p[1]); if (y !== null) ps.p = [ps.p[0], y, ps.p[2]]; }   // walk ON the arched deck, not under it
        if (vg) ps.vg = vg;
        if (s.m !== 'sim') s.pos = ps.p.slice();
      }
      for (const b of bugs) if (b.used >= 0 && !(st[b.used] && st[b.used].v && st[b.used].v.bug === b && st[b.used].m === 'do')) { if (!(st[b.used] && st[b.used].m === 'go' && st[b.used].v && st[b.used].v.bug === b)) { b.used = -1; } b.s.visible = false; }
      // snowballs
      let n = 0;
      for (let k = balls.length - 1; k >= 0; k--) {
        const B = balls[k]; B.t += dt; const P = poses[B.to]; if (!P) { balls.splice(k, 1); continue; }
        const f = Math.min(1, B.t / B.dur), b = [P.p[0], (P.y || P.p[1]) + 2.6, P.p[2]];
        const x = B.a[0] + (b[0] - B.a[0]) * f, z = B.a[2] + (b[2] - B.a[2]) * f, y = B.a[1] + (b[1] - B.a[1]) * f + Math.sin(f * Math.PI) * 4;
        if (f >= 1) { balls.splice(k, 1); if (st[B.to] && st[B.to].v) st[B.to].v.hit = tNow; if (o.wfx && o.wfx.sparkle) o.wfx.sparkle(x, y, z, 5, false); continue; }
        if (n < SBN) { M4.makeTranslation(x, y, z); sbMesh.setMatrixAt(n++, M4); }
      }
      sbMesh.count = n; sbMesh.visible = n > 0; if (n) sbMesh.instanceMatrix.needsUpdate = true;
      // 4. chatter now and then (a visible pup near the view)
      if (env.camera) {
        chatT -= dt;
        if (chatT <= 0 && T_() && !(o.quiet && o.quiet())) {
          chatT = C.CHAT_GAP[0] + hsh(chatN * 7 + 3) * (C.CHAT_GAP[1] - C.CHAT_GAP[0]);
          const tg = env.target || env.camera.position, list = [];
          poses.forEach((ps, i) => { const P = o.pups.list[i]; if (!P || !P.holder.visible || S.pups[i].exp) return; const d = P.holder.position.distanceTo(env.camera.position); if (d > (PHONE ? 230 : 280)) return; v3.copy(P.holder.position).project(env.camera); if (v3.z > 1 || Math.abs(v3.x) > 0.8 || Math.abs(v3.y) > 0.8) return; list.push([i, d + (st[i].m === 'do' ? -80 : 0)]); });
          list.sort((a, b) => a[1] - b[1]);
          if (list.length) {
            const i = list[Math.floor(hsh(chatN * 13 + 1) * Math.min(4, list.length))][0], p = S.pups[i], s = st[i], tr = T_().of(S, i);
            const kind = s.m === 'do' && s.v ? 'moment:' + ({ bench: 'bench', bridge: 'bridge', river: 'river', curio: 'curio', fire: 'fire', moth: 'moth', snow: 'snow', nap2: 'nap', tag: 'tumble', stars: 'stars', react: 'curio' }[s.v.k] || 'bench')
              : env.night > 0.6 ? 'night' : p.job === 'rest' || REST[p.phase] ? 'rest' : 'work';
            say(i, T_().chat(tr, kind, chatN * 31 + i, { j: T_().JOBW[p.job] }));
          }
          chatN++;
        }
        placeBubbles(dt, env.camera, env.W || innerWidth, env.H || innerHeight);
      }
    }
    // tests / captures: start a moment now for pup i (k = 'bench', 'bridge', 'river', 'curio', 'fire', 'stars', 'moth', 'nap2', 'tag', 'snow')
    function force(k, i, S, poses, env) { const s = st[i]; if (!s) return false; if (s.m !== 'sim') { release(i); s.m = 'sim'; s.v = null; } s.settled = 99; s.cool = 0; return startKind(k, i, S, poses, env || { night: 0, dusk: 0, winter: 0 }); }
    // captures only: skip the walk there (the pup appears at its spot next frame); long = hold the moment for 10 min
    function jump(i, long) { const s = st[i]; if (!s || !s.v) return false; if (s.m === 'go') s.s = s.L.len; if (long) s.v.until = tNow + 600; if (s.v.mate !== undefined && st[s.v.mate] && st[s.v.mate].v) { const m = st[s.v.mate]; if (m.m === 'go') m.s = m.L.len; if (long) m.v.until = tNow + 600; } if (s.v.group) for (const j of s.v.group) { const m = st[j]; if (m && m.v) { if (m.m === 'go') m.s = m.L.len; if (long) m.v.until = tNow + 600; } } return true; }
    function reset() { for (let i = 0; i < st.length; i++) { release(i); st[i] = S0(); } occ.clear(); balls.length = 0; }
    const stats = () => { const m = {}; for (const s of st) { const k = s.m === 'do' && s.v ? s.v.k : s.m; m[k] = (m[k] || 0) + 1; } return m; };
    return { apply, say, force, jump, reset, stats, clearAt: (x, z) => okXZ(x, z), attend: (S, poses, target, from, R, dur) => attend(S, poses, target, from, R || 140, dur || 8), departAt, spreadOut: (S, poses, env) => spreadOut(S, poses, env || {}), rewarm: () => { warm = 1; }, st, C, WT, spots, benchSeats, curioSeats, fires, bubbles };
  }
  window.PupLife = PupLife;
})();
