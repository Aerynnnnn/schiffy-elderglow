// Expedition visuals (step 3). Reads the sim state every frame, owns no game state:
//  - the destination isles (layout role 'isle', hidden on the start island) are shown in the sky (role 'sky')
//  - a leaf boat (hull + leaf-wing glider + bow lantern, toon + ink) per boat slot, parked hovering at the dock;
//    the team hops aboard (phase 'board'), lifts off on a curved path to the isle (FLY s of sim time), stays parked
//    on the isle with a bobbing pin marker over it, flies back with a loot sack, the pups hop off
//  - a notice board at the dock (canvas texture), placed decorations (S.placed on nav.decorSpots, instanced kit pieces)
(function () {
  'use strict';
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: new THREE.Color(c).convertSRGBToLinear(), gradientMap: grad }, o || {}));   // hex = the colour on screen (sRGB output)
  const INK = new THREE.MeshBasicMaterial({ color: 0x2a1a22, side: THREE.BackSide });
  function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; return t; }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const inked = (mesh, k) => { const h = new THREE.Mesh(mesh.geometry, INK); h.scale.setScalar(k || 1.06); mesh.add(h); return mesh; };
  const SEATS = [-4.3, -1.45, 1.45, 4.3];   // along the boat's long axis (local z)

  // ---- the leaf boat: ~15 m long (pups are drawn 3.1x), local +z = bow
  function makeBoat() {
    const g = new THREE.Group();
    const hull = inked(new THREE.Mesh(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0x8a5530)), 1.05);
    hull.scale.set(3.3, 1.9, 7.6); hull.castShadow = true; g.add(hull);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 28), toon(0x7a4f2c)); rim.rotation.x = Math.PI / 2; rim.scale.set(3.3, 7.6, 1); g.add(rim);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.25, 22), toon(0xc8905a)); deck.scale.set(3.05, 1, 7.2); deck.position.y = -0.35; g.add(deck);
    // leaf wing (glider canopy): a leaf outline, bent down at the tips, on two masts
    const sh = new THREE.Shape(); sh.moveTo(0, -11); sh.bezierCurveTo(7.5, -6, 7.5, 6, 0, 12); sh.bezierCurveTo(-7.5, 6, -7.5, -6, 0, -11);
    const lg = new THREE.ShapeGeometry(sh, 16); lg.rotateX(-Math.PI / 2);
    const P = lg.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); P.setY(i, -0.035 * x * x + 0.012 * z); } lg.computeVertexNormals();
    const leaf = new THREE.Mesh(lg, toon(0x3fa24a, { side: THREE.DoubleSide })); leaf.scale.setScalar(0.82); leaf.position.y = 8.2; leaf.castShadow = true; g.add(leaf);
    const under = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0x2a1a22, side: THREE.DoubleSide })); under.scale.set(0.85, 1, 0.845); under.position.y = 8.08; g.add(under);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 18.5), toon(0x2f7a35)); rib.position.y = 8.32; g.add(rib);
    for (const z of [-3.2, 3.2]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 8.6, 6), toon(0x7a4f2c)); m.position.set(0, 3.9, z); g.add(m); }
    // bow lantern (glows) + a pennant
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd36a).convertSRGBToLinear() })); lamp.position.set(0, 0.9, 7.9); g.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffd36a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(5); halo.position.copy(lamp.position); g.add(halo);
    const pen = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 3), toon(0xff8fc8)); pen.rotation.z = -Math.PI / 2; pen.position.set(1.2, 10.4, -9.5); g.add(pen);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 5), toon(0x7a4f2c)); pole.position.set(0, 9.8, -9.5); g.add(pole);
    // loot sack (shown on the way home + while a haul waits)
    const sack = new THREE.Group();
    const sb = inked(new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10), toon(0xd9b27a)), 1.07); sb.scale.set(1, 0.9, 1); sack.add(sb);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 8), toon(0xc49558)); knot.position.y = 1.25; sack.add(knot);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.12, 6, 12), toon(0xff5f8f)); tie.rotation.x = Math.PI / 2; tie.position.y = 0.95; sack.add(tie);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0x9fe8ff })); star.position.set(0.7, 1.5, 0.3); sack.add(star);
    sack.position.set(0, 0.6, -6.1); g.add(sack);
    g.userData = { sack, halo, leaf };
    return g;
  }
  const GLOW = canvasTex(64, 64, g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  // isle pin: round toon pin with a little leaf boat
  const PIN = canvasTex(128, 160, (g) => {
    g.lineWidth = 8; g.strokeStyle = '#2a2442'; g.fillStyle = '#ffd23f';
    g.beginPath(); g.arc(64, 58, 48, Math.PI * 0.82, Math.PI * 0.18); g.lineTo(64, 150); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff6dc'; g.beginPath(); g.arc(64, 58, 32, 0, Math.PI * 2); g.fill(); g.lineWidth = 5; g.stroke();
    g.fillStyle = '#b9824c'; g.beginPath(); g.moveTo(40, 64); g.quadraticCurveTo(64, 92, 88, 64); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#7fd36a'; g.beginPath(); g.ellipse(64, 42, 26, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  });
  // the notice board at the dock: pinned isle cards
  const BOARD = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#c98a4b'; rr(g, 6, 6, w - 12, h - 12, 18); g.fill(); g.lineWidth = 9; g.strokeStyle = '#2a2442'; g.stroke();
    g.fillStyle = '#2a2442'; g.font = 'bold 30px Lilita One, Fredoka, sans-serif'; g.textAlign = 'center'; g.fillText('SKY TRIPS', w / 2, 46);
    const cards = [['#7fd36a', 24, 64], ['#aab3c2', 98, 72], ['#ff9fd0', 172, 62], ['#9fe8ff', 60, 122], ['#ffd36a', 140, 124]];
    for (const [c, x, y] of cards) { g.save(); g.translate(x + 30, y + 26); g.rotate((x % 7 - 3) * 0.05); g.fillStyle = '#fff6dc'; rr(g, -30, -26, 60, 52, 6); g.fill(); g.lineWidth = 4; g.stroke(); g.fillStyle = c; g.beginPath(); g.ellipse(0, 4, 18, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#ff5f8f'; g.beginPath(); g.arc(0, -20, 5, 0, Math.PI * 2); g.fill(); g.restore(); }
  });

  function ExpFx(scene, map, nav, ground, opt) {
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), SC = new THREE.Vector3();
    // ---- destination isles: show them (role 'sky'), find each isle's landing point (ray down onto its top)
    const L = map.layout, isle = {};
    for (const d of Exped.DEST) {
      const p = L.placements[d.pid] && L.placements[d.pid].id === d.pid ? L.placements[d.pid] : L.placements.find(x => x.id === d.pid); if (!p) continue;
      let land = new THREE.Vector3().fromArray(p.pos).add(new THREE.Vector3(0, 20 * p.s, 0)), top = -Infinity;
      for (const b of map.batches) for (const i of b.inst) if (i.pid === d.pid) {
        i.role = 'sky';
        if (b.key === p.piece && b.geo) {
          const m = new THREE.Mesh(b.geo); m.matrixAutoUpdate = false; m.matrix.copy(i.m); m.matrixWorld.copy(i.m);
          const bb = b.box.clone().applyMatrix4(i.m); top = bb.max.y;
          const rc = new THREE.Raycaster(new THREE.Vector3(p.pos[0], bb.max.y + 50, p.pos[2]), new THREE.Vector3(0, -1, 0));
          let hit = null; for (const [dx, dz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [12, 12], [-12, -12]]) { rc.ray.origin.set(p.pos[0] + dx, bb.max.y + 50, p.pos[2] + dz); const h = rc.intersectObject(m)[0]; if (h && (!hit || h.point.y > hit.y - 0.5 && Math.hypot(dx, dz) < 1)) { hit = h.point.clone(); break; } }
          if (hit) land = hit;
        }
      }
      isle[d.id] = { land, top, d };
    }
    map.setRole('sky', true); map.invalidate();

    // ---- dock: the board plot's frame (door + out), boat parking slots, notice board
    const dockFrame = S => {
      const pid = Exped.board(S); if (pid === null) return null;
      const qq = nav.plotBy[pid]; const o = qq.out, side = [-o[1], o[0]];
      return { pid, q: qq, o, side, door: qq.door };
    };
    const slotPos = (f, k, out) => {
      const sd = k === 0 ? 0 : k === 1 ? 17 : -17, x = f.door[0] + f.o[0] * 11 + f.side[0] * sd, z = f.door[2] + f.o[1] * 11 + f.side[1] * sd;
      return (out || new THREE.Vector3()).set(x, ground(x, z, f.door[1]) + 3.2, z);
    };
    const boats = [makeBoat(), makeBoat(), makeBoat()];   // step 5: a 3rd boat at tree level 6 boats.forEach(b => { b.visible = false; scene.add(b); });
    const board = new THREE.Group();
    { const post = toon(0x7a4f2c); for (const x of [-2.6, 2.6]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 7, 6), post); m.position.set(x, 3.5, 0); m.castShadow = true; board.add(m); }
      const face = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.95), new THREE.MeshToonMaterial({ map: BOARD, gradientMap: grad, side: THREE.DoubleSide })); face.position.set(0, 4.6, 0.3); board.add(face);
      const roof = inked(new THREE.Mesh(new THREE.ConeGeometry(4.8, 1.6, 4), toon(0x5aa04a)), 1.05); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.35); roof.position.set(0, 7.7, 0.1); board.add(roof); }
    board.visible = false; scene.add(board);
    // pins over the isles
    const pins = [0, 1, 2].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: PIN, transparent: true, depthWrite: false, fog: false })); s.scale.set(19, 23.75, 1); s.visible = false; s.renderOrder = 5; scene.add(s); return s; });

    const api = { isle, boats, pins, slotOf: {}, hops: {}, labels: [], dockFrame, board };
    const slotOf = api.slotOf;
    const ease = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const bez = (a, m, b, u, out) => out.set((1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * m.x + u * u * b.x, (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * m.y + u * u * b.y, (1 - u) * (1 - u) * a.z + 2 * (1 - u) * u * m.z + u * u * b.z);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Mc = new THREE.Vector3(), P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
    // boat state per trip at sim time `now`: { pos, yaw, mode: 'dock'|'fly'|'isle', back, k (0..1 along the flight) }
    function boatState(S, f, t, now, k, out) {
      slotPos(f, k, A); const I = isle[Exped.DEST[t.dest].id]; B.copy(I.land).y += 2.2;
      if (t.dep < 0) { out.pos.copy(A); out.mode = 'dock'; out.yaw = Math.atan2(f.side[0], f.side[1]); out.back = false; return out; }
      const FLY = Math.min(Exped.C.FLY, t.dur * 0.25), el = now - t.dep, left = t.dep + t.dur - now;
      Mc.addVectors(A, B).multiplyScalar(0.5); Mc.y = Math.max(A.y, B.y) + 50 + A.distanceTo(B) * 0.12;
      let u, back = false;
      if (el < FLY) u = el / FLY; else if (left < FLY) { u = left / FLY; back = true; } else u = 1;
      u = Math.max(0, Math.min(1, u)); const e = ease(u);
      bez(A, Mc, B, e, out.pos);
      bez(A, Mc, B, Math.min(1, e + 0.01), P1); bez(A, Mc, B, Math.max(0, e - 0.01), P0);
      const dx = (P1.x - P0.x) * (back ? -1 : 1), dz = (P1.z - P0.z) * (back ? -1 : 1);
      out.yaw = u > 0.995 ? Math.atan2(B.x - A.x, B.z - A.z) : Math.atan2(dx, dz);   // parked on the isle: facing on along the route
      out.mode = u >= 0.995 ? 'isle' : 'fly'; out.back = back; out.k = u; return out;
    }
    const tmpState = { pos: new THREE.Vector3(), yaw: 0, yaw0: 0, mode: 'dock', back: false, k: 0 };
    const seatW = new THREE.Vector3();
    function seatOf(boat, k, out) { return out.set(0, 0.15, SEATS[k] || 0).applyMatrix4(boat.matrixWorld); }

    // ---- placed decorations: instanced kit pieces (same geometry + material as the map), scale-in pop when placed
    const extra = {};
    function extraMesh(key) {
      if (extra[key] !== undefined) return extra[key];
      const b = batchOf[key]; if (!b || !b.geo) return (extra[key] = null);
      const m = new THREE.InstancedMesh(b.geo, b.mesh.material, 24); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
      let ink = null; if (b.inkMesh && b.ink) { ink = new THREE.InstancedMesh(b.ink, b.inkMesh.material, 24); ink.instanceMatrix = m.instanceMatrix; ink.count = 0; ink.frustumCulled = false; scene.add(ink); }
      const see = b.see.map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, 24); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = false; scene.add(im); return im; });
      return (extra[key] = { m, ink, see, list: [] });
    }
    const born = {}; let decSig = '';
    api.decorPos = k => { const sp = nav.decorSpots[k]; if (!sp) return null; return [sp.p[0], ground(sp.p[0], sp.p[2], sp.p[1]), sp.p[2]]; };
    function updateDecor(S, t) {
      const sig = S.placed.map(x => x.id + x.k).join('|');
      let anim = false; for (const k in born) if (t - born[k] < 0.8) anim = true;
      if (sig === decSig && !anim) return;
      if (sig !== decSig) { const had = new Set(decSig.split('|')); for (const x of S.placed) if (!had.has(x.id + x.k) && decSig !== '-') born[x.k] = t; decSig = sig; }
      for (const k in extra) if (extra[k]) extra[k].list.length = 0;
      for (const x of S.placed) {
        const D = Exped.DECOR[x.id], em = D && extraMesh(D.piece), p = api.decorPos(x.k); if (!em || !p) continue;
        const a = born[x.k] !== undefined ? Math.min(1, (t - born[x.k]) / 0.7) : 1, pop = a < 1 ? Math.sin(a * Math.PI * 0.5) * (1 + 0.25 * Math.sin(a * Math.PI)) : 1;
        q.setFromAxisAngle(Y, (x.k * 2.399) % (Math.PI * 2)); v.set(p[0], p[1], p[2]); SC.setScalar(D.s * Math.max(0.02, pop));
        em.list.push(M4.compose(v, q, SC).clone());
      }
      for (const k in extra) { const em = extra[k]; if (!em) continue; em.list.forEach((m, j) => em.m.setMatrixAt(j, m)); em.m.count = em.list.length; em.m.instanceMatrix.needsUpdate = true; if (em.ink) em.ink.count = em.list.length; em.see.forEach(s => { s.count = em.list.length; }); }
    }
    decSig = '-';
    api.glowPieces = fn => { for (const k in extra) { const em = extra[k]; if (!em || !batchOf[k].glow || !Object.keys(batchOf[k].glow).length) continue; em.list.forEach((m, j) => fn(k, m, 'decor:' + k + ':' + j)); } };

    // ---- per frame. extra = sim seconds since the last tick (smooth motion). Returns nothing; fills api.view for game.js
    const lastPhase = {};
    api.view = { trips: [], dock: null };
    api.update = (S, t, dt, extraT) => {
      updateDecor(S, t);
      const f = dockFrame(S), now = S.time + (extraT || 0);
      board.visible = !!f;
      if (f) { const x = f.door[0] + f.o[0] * 4 - f.side[0] * 9, z = f.door[2] + f.o[1] * 4 - f.side[1] * 9; board.position.set(x, ground(x, z, f.door[1]), z); board.rotation.y = Math.atan2(f.o[0], f.o[1]); }
      // slots: keep a trip on the slot it started on
      const live = new Set(S.exp.trips.map(x => x.id));
      for (const id in slotOf) if (!live.has(+id)) delete slotOf[id];
      for (const tr of S.exp.trips) if (slotOf[tr.id] === undefined) { const used = new Set(Object.values(slotOf)); slotOf[tr.id] = !used.has(0) ? 0 : !used.has(1) ? 1 : 2; }
      const nSlots = Exped.maxTrips(S);
      api.view.trips.length = 0; api.view.dock = f ? slotPos(f, 0, new THREE.Vector3()) : null;
      pins.forEach(p => { p.visible = false; });
      boats.forEach((b, k) => {
        if (!f || k >= nSlots) { b.visible = false; return; }
        const tr = S.exp.trips.find(x => slotOf[x.id] === k);
        b.visible = true;
        let st;
        if (tr) st = boatState(S, f, tr, now, k, tmpState);
        else { slotPos(f, k, tmpState.pos); tmpState.mode = 'dock'; tmpState.yaw = Math.atan2(f.side[0], f.side[1]); tmpState.back = false; st = tmpState; }
        const bob = Math.sin(t * 1.3 + k * 2) * (st.mode === 'fly' ? 0.25 : 0.4);
        b.position.copy(st.pos); b.position.y += bob;
        let dy = st.yaw - b.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        b.rotation.y += dy * Math.min(1, dt * (st.mode === 'fly' ? 3 : 1.5)); b.rotation.z = st.mode === 'fly' ? -dy * 0.6 : Math.sin(t * 0.9 + k) * 0.03;
        b.userData.leaf.rotation.x = Math.sin(t * 1.7 + k) * 0.03;
        // the sack: on the way home, and parked at the dock while a haul waits to be opened
        b.userData.sack.visible = !!(tr && st.back) || (!tr && k === 0 && S.exp.hauls.length > 0);
        b.updateMatrixWorld(true);
        if (tr) {
          const I = isle[Exped.DEST[tr.dest].id];
          if (tr.dep >= 0 && st.mode === 'isle') { const pin = pins[k]; pin.visible = true; pin.position.copy(I.land).y += 26 + Math.sin(t * 2 + k) * 1.5; }
          api.view.trips.push({ trip: tr, slot: k, boat: b, mode: st.mode, back: st.back, label: (st.mode === 'isle' ? I.land.clone().setY(I.land.y + 42) : b.position.clone().setY(b.position.y + 13)) });
        }
      });
    };
    // where to draw pup i this frame (overrides the sim pose for pups on a trip): null = use the sim pose.
    // board: hop from the dock spot into its seat; away: ride in the boat; just landed: hop out to the sim spot
    api.pupPose = (S, i, ps, t) => {
      const p = S.pups[i], prev = lastPhase[i]; lastPhase[i] = p.phase;
      const H = api.hops;
      if (p.phase === 'board' || p.phase === 'away') {
        const tr = S.exp.trips.find(x => x.id === p.exp), k = tr ? tr.team.indexOf(i) : -1, slot = tr ? slotOf[tr.id] : undefined; if (k < 0 || slot === undefined) return null;
        seatOf(boats[slot], k, seatW);
        if (prev !== 'board' && prev !== 'away') H[i] = { t0: t, from: new THREE.Vector3(ps.p[0], ps.y !== undefined ? ps.y : ps.p[1], ps.p[2]), into: true };
        const b = boats[slot], fwd = [Math.sin(b.rotation.y), Math.cos(b.rotation.y)];
        let pos = seatW.clone(), u = 1;
        const h = H[i]; if (h && h.into) { u = Math.min(1, (t - h.t0) / 0.9); if (u >= 1) delete H[i]; else pos = h.from.clone().lerp(seatW, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * 4, 0)); }
        return { p: [pos.x, pos.y, pos.z], dir: u < 1 ? [seatW.x - pos.x, seatW.z - pos.z] : fwd, bridge: false, phase: 'board', f: 0, walking: false, carry: null, job: p.job, task: 'exp', air: true };
      }
      if ((prev === 'away' || prev === 'board') && boats.some(b => b.visible)) {
        // just back: hop out of the parked boat to where the sim put the pup
        const b = boats.find(bb => bb.visible); const k = Math.max(0, Object.keys(H).length % 4);
        H[i] = { t0: t, from: seatOf(b, k, new THREE.Vector3()).clone(), into: false };
      }
      const h = H[i];
      if (h && !h.into) {
        const u = Math.min(1, (t - h.t0) / 0.9); if (u >= 1) { delete H[i]; return null; }
        const to = new THREE.Vector3(ps.p[0], ground(ps.p[0], ps.p[2], ps.p[1]), ps.p[2]), pos = h.from.clone().lerp(to, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * 4, 0));
        return Object.assign({}, ps, { p: [pos.x, pos.y, pos.z], walking: false, air: true });
      }
      return null;
    };
    return api;
  }
  window.ExpFx = ExpFx;
})();
