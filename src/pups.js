// Pups: Pawty's Blender pups (art/pups.glb, copied from Schiffy Pawty) as walking agents. Contract (Pawty's
// blender/build_pups.py docstring): root Pup_<id> > meshes with their origin on their joint (_body hips, _head, _armN/P,
// _legN/P, _tail, _earN/P), feet on y 0, facing +z; material 'Collar' = the pup's colour, the rest vertex colour.
// Eyes are not in the GLB (Pawty draws them), so we add simple ones. If the GLB fails, a primitive toon stand-in is used.
// The pup's state comes from Sim.pose(); this file only draws: walk cycle, work poses, sitting rest, carried item.
(function () {
  'use strict';
  const S = 3.1;   // pup scale: ~5.3 m tall, readable from the home view next to a 60 m young tree
  const grad = (() => { const d = new Uint8Array([110, 190, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const toon = (c, o) => new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, o || {}));
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x2a1a22, side: THREE.BackSide });
  inkMat.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.028;'); };
  const vcMat = toon(0xffffff, { vertexColors: true });

  // ---- carried props (shared geometry)
  const G = {
    bucket: new THREE.CylinderGeometry(0.2, 0.15, 0.3, 12), rim: new THREE.TorusGeometry(0.2, 0.025, 6, 14),
    drop: new THREE.SphereGeometry(0.3, 16, 12), tip: new THREE.ConeGeometry(0.21, 0.36, 16),
    lamp: new THREE.CylinderGeometry(0.13, 0.15, 0.3, 6), cap: new THREE.ConeGeometry(0.18, 0.14, 6), flame: new THREE.SphereGeometry(0.1, 10, 8),
    eye: new THREE.SphereGeometry(0.07, 10, 8), shine: new THREE.SphereGeometry(0.022, 6, 5), ring: new THREE.RingGeometry(0.75, 0.95, 32),
    water: new THREE.CircleGeometry(0.17, 12),
    log: new THREE.CylinderGeometry(0.12, 0.12, 0.62, 8).rotateZ(Math.PI / 2), logEnd: new THREE.CircleGeometry(0.1, 8),
    rock: new THREE.DodecahedronGeometry(0.2, 0), berry: new THREE.SphereGeometry(0.07, 8, 6), basket: new THREE.CylinderGeometry(0.2, 0.15, 0.16, 10),
    handle: new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6).translate(0, 0.27, 0), axeHead: new THREE.BoxGeometry(0.06, 0.16, 0.2), pickHead: new THREE.BoxGeometry(0.05, 0.06, 0.42),
    hamHead: new THREE.BoxGeometry(0.1, 0.1, 0.2),
    // step 4: gardener trowel + compost / glowing fruit, guardian leaf broom, performer lute / drum
    trowel: new THREE.ConeGeometry(0.07, 0.18, 4).rotateX(Math.PI), fruit: new THREE.SphereGeometry(0.16, 14, 10), soil: new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    bristle: new THREE.ConeGeometry(0.17, 0.34, 7, 1, true), luteBody: new THREE.SphereGeometry(0.17, 12, 8).scale(1, 1.2, 0.5), neck: new THREE.BoxGeometry(0.05, 0.36, 0.04),
    drum: new THREE.CylinderGeometry(0.2, 0.2, 0.2, 14), drumTop: new THREE.CircleGeometry(0.2, 14), stick: new THREE.CylinderGeometry(0.018, 0.018, 0.3, 5),
  };
  const M = {
    wood: toon(0xa0683a), band: toon(0x5b3a26), water: toon(0x5fd0ff, { transparent: true, opacity: 0.92 }),
    dropGlow: new THREE.MeshBasicMaterial({ color: 0x8fe6ff }), lampBody: toon(0x6a4a8c), lampGlass: toon(0xfff0c0, { transparent: true, opacity: 0.55 }),
    flameOn: new THREE.MeshBasicMaterial({ color: 0xffd36a }), flameOff: new THREE.MeshBasicMaterial({ color: 0x6b6470 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x1d1420 }), shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    bark: toon(0x8a5a34), logEnd: toon(0xe8c48a), rock: toon(0x9aa0ad), berry: toon(0xe0457b), leafy: toon(0x6fbf5a), steel: toon(0xc9d2dc),
    soil: toon(0x6b4a2e), fruit: new THREE.MeshBasicMaterial({ color: 0xffd86b }), straw: toon(0xe8c470), lute: toon(0xd9894a), drumSide: toon(0xe0457b), drumTop: toon(0xfff3d6),
  };
  function glowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
  }
  const GLOW = glowTex();
  // soft disc under every pup (its collar colour) and a "z z" card over napping pups: readable from far away
  function discTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 10, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.7, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function zzTex() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.font = '900 54px Lilita One, Fredoka, sans-serif'; g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = '#2a2442'; g.fillStyle = '#d9ccff';
    for (const [t, x, y, s] of [['z', 22, 108, 1], ['Z', 62, 70, 1.3]]) { g.font = '900 ' + Math.round(48 * s) + 'px Lilita One, Fredoka, sans-serif'; g.strokeText(t, x, y); g.fillText(t, x, y); }
    return new THREE.CanvasTexture(c);
  }
  const DISC = discTex(), ZZ = zzTex(), discGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);

  function makeProps() {
    const bucket = new THREE.Group();
    const b = new THREE.Mesh(G.bucket, M.wood), rim = new THREE.Mesh(G.rim, M.band); rim.rotation.x = Math.PI / 2; rim.position.y = 0.15;
    const surf = new THREE.Mesh(G.water, M.water); surf.rotation.x = -Math.PI / 2; surf.position.y = 0.12;
    bucket.add(b, rim, surf); bucket.userData.surf = surf;
    const drop = new THREE.Group();
    const d1 = new THREE.Mesh(G.drop, M.water), d2 = new THREE.Mesh(G.tip, M.water); d2.position.y = 0.3;
    const dg = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x7fdcff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    dg.scale.setScalar(1.6); drop.add(d1, d2, dg);
    const lamp = new THREE.Group();
    const lb = new THREE.Mesh(G.lamp, M.lampGlass), lc = new THREE.Mesh(G.cap, M.lampBody); lc.position.y = 0.22;
    const fl = new THREE.Mesh(G.flame, M.flameOff);
    const lg = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffcf6a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    lg.scale.setScalar(1.5); lamp.add(lb, lc, fl, lg); lamp.userData = { flame: fl, glow: lg };
    // gathered goods (carried in both arms) and tools (right hand)
    const log = new THREE.Group(); log.add(new THREE.Mesh(G.log, M.bark));
    for (const s of [-1, 1]) { const e = new THREE.Mesh(G.logEnd, M.logEnd); e.rotation.y = s * Math.PI / 2; e.position.x = s * 0.311; log.add(e); }
    const l2 = new THREE.Mesh(G.log, M.bark); l2.position.set(0.05, 0.2, 0); l2.scale.setScalar(0.85); log.add(l2);
    const rock = new THREE.Group(); rock.add(new THREE.Mesh(G.rock, M.rock)); const r2 = new THREE.Mesh(G.rock, M.rock); r2.scale.setScalar(0.6); r2.position.set(0.15, 0.12, 0); rock.add(r2);
    const berries = new THREE.Group(); berries.add(new THREE.Mesh(G.basket, M.wood));
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(G.berry, k % 3 ? M.berry : M.leafy); b.position.set(Math.cos(k * 1.05) * 0.1, 0.1, Math.sin(k * 1.05) * 0.1); berries.add(b); }
    const tool = kind => { const g = new THREE.Group(); g.add(new THREE.Mesh(G.handle, M.wood));
      const h = new THREE.Mesh(kind === 'axe' ? G.axeHead : kind === 'pick' ? G.pickHead : G.hamHead, kind === 'hammer' ? M.band : M.steel); h.position.set(0, 0.52, kind === 'axe' ? 0.08 : 0); g.add(h); return g; };
    // step 4 props
    const trowel = new THREE.Group(); { const h = new THREE.Mesh(G.handle, M.wood); h.scale.set(1, 0.55, 1); const b = new THREE.Mesh(G.trowel, M.steel); b.position.y = -0.06; trowel.add(h, b); }
    const compost = new THREE.Group(); { compost.add(new THREE.Mesh(G.basket, M.wood)); const s = new THREE.Mesh(G.soil, M.soil); s.position.y = 0.05; compost.add(s); const l = new THREE.Mesh(G.berry, M.leafy); l.position.set(0.05, 0.15, 0); compost.add(l); }
    const fruit = new THREE.Group(); { fruit.add(new THREE.Mesh(G.fruit, M.fruit)); const fg = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffd36a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })); fg.scale.setScalar(1.3); fruit.add(fg); const lf = new THREE.Mesh(G.berry, M.leafy); lf.position.y = 0.17; lf.scale.set(1.4, 0.6, 0.8); fruit.add(lf); }
    const broom = new THREE.Group(); { const h = new THREE.Mesh(G.handle, M.wood); h.scale.set(1, 1.5, 1); const b = new THREE.Mesh(G.bristle, M.leafy); b.material = M.leafy; b.rotation.x = Math.PI; b.position.y = -0.1; broom.add(h, b); }
    const lute = new THREE.Group(); { const b = new THREE.Mesh(G.luteBody, M.lute); const n = new THREE.Mesh(G.neck, M.band); n.position.y = 0.3; lute.add(b, n); }
    const drum = new THREE.Group(); { const d = new THREE.Mesh(G.drum, M.drumSide); const top = new THREE.Mesh(G.drumTop, M.drumTop); top.rotation.x = -Math.PI / 2; top.position.y = 0.101; drum.add(d, top); }
    return { bucket, drop, lamp, log, rock, berries, axe: tool('axe'), pick: tool('pick'), hammer: tool('hammer'), basket: (() => { const g = new THREE.Group(); g.add(new THREE.Mesh(G.basket, M.wood)); return g; })(),
      trowel, compost, fruit, broom, lute, drum };
  }
  const CARRY = ['log', 'rock', 'berries', 'compost', 'fruit'], TOOLS = ['axe', 'pick', 'hammer', 'basket', 'trowel', 'broom'], INSTR = ['lute', 'drum'];

  // ---- outfits (Round 3 update 1, src/wardrobe.js DEFS[id].look): primitives, one template per outfit (geometry + materials
  // shared by every pup wearing it), parented to a joint so they follow every animation. Head / face items hang on _head
  // (head sphere ~0.45 round the joint, face +z), neck / back items on _body (hips joint; neck ~0.66 above it).
  const fitMats = {}, fitGlow = [];
  const fitMat = (c, glow) => { const k = c + (glow ? 'g' : ''); if (fitMats[k]) return fitMats[k];
    const col = new THREE.Color(c).convertSRGBToLinear();
    const m = glow ? new THREE.MeshBasicMaterial({ color: col }) : toon(col); if (glow) { m.userData.base = col.clone(); fitGlow.push(m); } return fitMats[k] = m; };
  const STAR = (() => { const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.045 : 0.1, a = k / 10 * Math.PI * 2 + Math.PI / 2; s[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } return new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02); })();
  const fitTpl = {};
  function outfitTemplate(id) {
    if (fitTpl[id]) return fitTpl[id];
    const D = window.Wardrobe && window.Wardrobe.DEFS[id]; if (!D) return null;
    const L = D.look, g = new THREE.Group(), a = fitMat(L.col), b = fitMat(L.col2, L.glow), ink = [];
    const add = (geo, m, pos, rot, sc, inked) => { const o = new THREE.Mesh(geo, m); if (pos) o.position.fromArray(pos); if (rot) o.rotation.fromArray(rot); if (sc) o.scale.fromArray(sc); g.add(o); if (inked) ink.push(o); return o; };
    const K = L.kind;
    // measured on art/pups.glb: head = +-0.47 round its joint (top 0.43, snout front 0.5), ears at x +-0.23 from y 0.29 up to 0.53;
    // the body's neck band (under the head) at body y ~0.46, ~0.46 round; the back at z ~-0.55
    if (K === 'acorn') {   // half-sphere cap with a darker rim + a stalk
      add(new THREE.SphereGeometry(0.46, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), a, [0, 0.27, -0.02], null, [1, 0.62, 1], true);
      add(new THREE.TorusGeometry(0.46, 0.06, 8, 24), b, [0, 0.27, -0.02], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.04, 0.06, 0.22, 8), b, [0.03, 0.63, -0.02], [0, 0, -0.35]);
    } else if (K === 'leaves') {   // a big leaf over the crown, one over each ear + a curled stem
      const leaf = new THREE.SphereGeometry(0.24, 12, 8).scale(1, 0.24, 0.6);
      add(leaf, a, [0, 0.47, -0.04], [-0.2, 0, 0], [1.5, 1, 1.5], true);
      add(leaf, b, [-0.33, 0.42, 0], [0, 0.3, 0.85], null, true);
      add(leaf, b, [0.33, 0.42, 0], [0, -0.3, -0.85], null, true);
      add(new THREE.TorusGeometry(0.07, 0.022, 6, 10, Math.PI * 1.4), b, [0, 0.56, 0.16], [0, Math.PI / 2, 0]);
    } else if (K === 'beret') {   // flat beret tilted to one side + one long feather
      add(new THREE.CylinderGeometry(0.4, 0.36, 0.12, 22), a, [0.06, 0.45, -0.02], [0.1, 0, -0.22], null, true);
      add(new THREE.SphereGeometry(0.06, 8, 6), a, [0.14, 0.53, -0.02]);
      add(new THREE.SphereGeometry(0.12, 10, 8), b, [-0.3, 0.7, 0.04], [0.15, 0, 0.6], [0.5, 2.8, 0.24], true);
    } else if (K === 'goggles') {   // two rings + lenses pushed up on the forehead, strap round the head
      for (const s of [-1, 1]) { add(new THREE.TorusGeometry(0.13, 0.04, 8, 16), a, [s * 0.16, 0.27, 0.4], [-0.5, 0, 0]); add(new THREE.CircleGeometry(0.115, 16), b, [s * 0.16, 0.275, 0.41], [-0.5, 0, 0]); }
      add(new THREE.TorusGeometry(0.47, 0.035, 6, 28), a, [0, 0.22, 0], [Math.PI / 2 - 0.3, 0, 0]);
    } else if (K === 'scarf') {   // wrapped round the neck band + two tails at the back + a little glowing star
      add(new THREE.TorusGeometry(0.46, 0.1, 10, 26), a, [0, 0.46, 0.02], [Math.PI / 2, 0, 0], null, true);
      add(new THREE.BoxGeometry(0.16, 0.38, 0.06), a, [0.14, 0.28, -0.5], [0.3, 0, 0.12]);
      add(new THREE.BoxGeometry(0.16, 0.3, 0.06), a, [-0.06, 0.31, -0.51], [0.25, 0, -0.18]);
      add(STAR, b, [0.18, 0.42, 0.55], [0, 0.3, 0], [1.3, 1.3, 1.3]);
    } else if (K === 'stars') {   // a thin band with five star charms across the chest
      add(new THREE.TorusGeometry(0.46, 0.045, 6, 26), fitMat(L.col2), [0, 0.46, 0.02], [Math.PI / 2, 0, 0]);
      for (let k = -2; k <= 2; k++) { const an = k * 0.4; add(STAR, fitMat(L.col, true), [Math.sin(an) * 0.5, 0.4 - Math.abs(k) * 0.02, Math.cos(an) * 0.5 + 0.02], [0, an, 0], [1.3, 1.3, 1.3]); }
    } else if (K === 'bandana') {   // a triangle over the chest + a knot at the back
      add(new THREE.TorusGeometry(0.46, 0.06, 8, 26), a, [0, 0.46, 0.02], [Math.PI / 2, 0, 0]);
      add(new THREE.ConeGeometry(0.3, 0.4, 3), a, [0, 0.28, 0.46], [Math.PI - 0.25, 0, 0], [1, 1, 0.3], true);
      add(new THREE.SphereGeometry(0.07, 8, 6), b, [0, 0.24, 0.53]);
      add(new THREE.SphereGeometry(0.09, 8, 6), a, [0, 0.46, -0.48]);
    } else if (K === 'cape') {   // a curved cape from the neck down the back, glowing firefly dots
      add(new THREE.CylinderGeometry(0.47, 0.66, 0.66, 20, 1, true, Math.PI * 0.6, Math.PI * 0.8), new THREE.MeshToonMaterial({ color: a.color, gradientMap: grad, side: THREE.DoubleSide }), [0, 0.15, 0.02], null, null, true);
      add(new THREE.TorusGeometry(0.46, 0.05, 6, 24), a, [0, 0.47, 0.02], [Math.PI / 2, 0, 0]);
      const dot = new THREE.SphereGeometry(0.05, 6, 5);
      for (const [d, y] of [[-0.5, 0.38], [0.35, 0.3], [-0.1, 0.14], [0.7, 0.05], [-0.75, 0.0], [0.15, -0.1]]) { const r = 0.48 + (0.48 - y) / 0.66 * 0.19, an = Math.PI + d; add(dot, b, [Math.sin(an) * r, y, Math.cos(an) * r + 0.02]); }   // on the cape's outside
    } else if (K === 'cloud') {   // puffy cloud balls along the back, a soft blue underside
      const ball = new THREE.SphereGeometry(0.19, 12, 9);
      for (const [x, y, z, s, m] of [[0, 0.46, -0.5, 1.1, a], [-0.27, 0.42, -0.45, 0.95, a], [0.27, 0.42, -0.45, 0.95, a], [-0.16, 0.2, -0.6, 1, a], [0.16, 0.2, -0.6, 1, a], [0, -0.02, -0.64, 0.9, b], [-0.34, 0.08, -0.52, 0.75, b], [0.34, 0.08, -0.52, 0.75, b]]) add(ball, m, [x, y, z], null, [s, s, s * 0.8], m === a && y > 0.3);
    }
    for (const o of ink) { const h = new THREE.Mesh(o.geometry, inkMat); h.userData.ink = 1; o.add(h); }   // ink hulls on the big pieces only
    g.userData = { slot: D.slot };
    return fitTpl[id] = g;
  }

  // ---- primitive stand-in (same joint layout as the GLB pups)
  function primitivePup(col) {
    const root = new THREE.Group(), body = toon(col), light = toon(0xfff3e0);
    const part = (name, geo, mat, pos) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.fromArray(pos); root.add(m); return m; };
    part('_body', new THREE.SphereGeometry(0.36, 16, 12).translate(0, 0.12, 0), body, [0, 0.34, 0]);
    part('_head', new THREE.SphereGeometry(0.45, 18, 14), body, [0, 1.22, 0.02]).add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), light), { position: new THREE.Vector3(0, -0.12, 0.33) }));
    for (const s of [-1, 1]) {
      part(s < 0 ? '_armN' : '_armP', new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.09, 0.3) : new THREE.CylinderGeometry(0.09, 0.09, 0.42, 8).translate(0, -0.2, 0), body, [s * 0.31, 0.73, 0.02]);
      part(s < 0 ? '_legN' : '_legP', new THREE.CylinderGeometry(0.11, 0.12, 0.34, 8).translate(0, -0.17, 0), body, [s * 0.16, 0.34, 0]);
      part(s < 0 ? '_earN' : '_earP', new THREE.ConeGeometry(0.14, 0.32, 8).translate(0, 0.14, 0), body, [s * 0.3, 1.55, 0]);
    }
    part('_tail', new THREE.ConeGeometry(0.08, 0.36, 8).rotateX(-0.9).translate(0, 0.08, -0.1), body, [0, 0.48, -0.2]);
    return root;
  }

  // defs = {id, breed (GLB root Pup_<breed>), collar}; pups can be added any time after load() (api.add / api.sync)
  function Pups(scene) {
    const list = [], src = {};
    const api = { list, S, ready: false, selected: -1 };
    const ring = new THREE.Mesh(G.ring, M.ring); ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 2; scene.add(ring);

    function rig(root, def) {
      const j = {}; root.traverse(o => { const m = /_(body|head|armN|armP|legN|legP|tail|earN|earP)$/.exec(o.name); if (m) j[m[1]] = o; });
      for (const k in j) j[k].userData.rest = j[k].rotation.clone(), j[k].userData.pos0 = j[k].position.clone();
      root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = /_(body|head)$/.test(o.name);   // limbs/ears/tail: no shadow pass (draw calls with 20+ pups)
        const name = o.material && o.material.name;
        o.material = name === 'Collar' ? toon(def.collar) : (o.material && o.material.vertexColors !== false && o.geometry.attributes.color ? vcMat : o.material.isMeshToonMaterial ? o.material : toon(o.material.color || 0xffffff));
      });
      // ink hulls on the big parts only (draw calls)
      const detail = [];   // ink + eye shines: hidden on far pups (api.lod)
      for (const k of ['body', 'head', 'earN', 'earP']) if (j[k]) j[k].traverse(o => { if (o.isMesh && !o.userData.ink) { const h = new THREE.Mesh(o.geometry, inkMat); h.userData.ink = 1; o.add(h); detail.push(h); } });
      // eyes (Pawty's face front: eyes at +-.17, .05, .36 on the head joint)
      if (j.head) for (const s of [-1, 1]) {
        const e = new THREE.Mesh(G.eye, M.eye); e.scale.set(0.85, 1.25, 0.55); e.position.set(s * 0.17, 0.06, 0.4); j.head.add(e);
        const w = new THREE.Mesh(G.shine, M.shine); w.position.set(s * 0.17 + 0.025, 0.11, 0.44); j.head.add(w); detail.push(w);
      }
      j._detail = detail;
      return j;
    }
    function add(i, def) { list[i] = make(def, i); }
    function make(def, i) {
      const holder = new THREE.Group(); holder.scale.setScalar(S); holder.name = 'pup:' + def.id;
      const s0 = src[def.breed] || src[def.id];
      const model = s0 ? s0.clone(true) : primitivePup(def.collar);
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0);
      holder.add(model); scene.add(holder);
      const j = rig(model, def), props = makeProps();
      for (const k in props) { holder.add(props[k]); props[k].visible = false; }
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ map: DISC, color: def.collar, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      disc.position.y = 0.06; disc.renderOrder = 1; holder.add(disc);
      const zz = new THREE.Sprite(new THREE.SpriteMaterial({ map: ZZ, transparent: true, depthWrite: false })); zz.scale.setScalar(1.1); zz.visible = false; holder.add(zz);
      return { def, holder, model, j, props, disc, zz, walk: 0, last: null, yaw: 0, y: null, t0: i * 1.7, collar: def.collar };
    }
    // a pup that is not on the island's list (the wandering trader): same model + animation, its own pose
    api.npc = def => { const P = make(def, 7); return { P, update: (pose, t, dt, groundY) => upd(P, -1, pose, t, dt, groundY), set visible(v) { P.holder.visible = v; } }; };
    api.load = (url, loader) => new Promise(res => {
      loader.load(url, g => {
        for (const o of g.scene.children) src[o.name.replace(/^Pup_/, '')] = o;
        api.ready = true; api.fromGlb = true; res(api);
      }, undefined, () => { api.ready = true; api.fromGlb = false; res(api); });
    });
    api.add = def => { add(list.length, def); return list.length - 1; };
    // make the drawn pups match the sim's list (new arrivals appended; a different save = rebuilt)
    api.sync = pups => {
      for (let i = 0; i < list.length; i++) if (!pups[i] || pups[i].id !== list[i].def.id) { for (let k = list.length - 1; k >= i; k--) { scene.remove(list[k].holder); list.pop(); } break; }
      while (list.length < pups.length) add(list.length, pups[list.length]);
    };

    const tmp = new THREE.Vector3();
    // pose: Sim.pose() result; groundY(x, z, fallbackY, onBridge) -> y; t = seconds (render clock)
    api.update = (i, pose, t, dt, groundY) => { const P = list[i]; if (P) upd(P, i, pose, t, dt, groundY); };
    function upd(P, i, pose, t, dt, groundY) {
      const h = P.holder, j = P.j, x = pose.p[0], z = pose.p[2], V = pose.vg;   // vg = vibe pass 2 lane B overrides (src/pup_life.js)
      const gy = groundY(x, z, pose.p[1], pose.bridge) + (V && V.perch ? V.lift || 0 : 0);
      P.y = P.y === null || Math.abs(P.y - gy) > 6 ? gy : P.y + (gy - P.y) * Math.min(1, dt * 10);
      const moved = P.last ? Math.hypot(x - P.last[0], z - P.last[1]) : 0; P.last = [x, z];
      const yawT = Math.atan2(pose.dir[0], pose.dir[1]);
      let dy = yawT - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      P.yaw += dy * Math.min(1, dt * 8); h.rotation.y = P.yaw;
      // animation
      const R = (k, x = 0, y = 0, zz = 0) => { if (j[k]) { const r = j[k].userData.rest; j[k].rotation.set(r.x + x, r.y + y, r.z + zz); } };
      let bob = 0, lean = 0, armX = 0, armZ = 0, legX = 0, legL = 0, headX = 0, headY = 0, bodyY = 0, armX2 = null, tail = Math.sin(t * 9 + P.t0) * 0.35, sit = 0;
      if (pose.walking) {
        P.walk += moved / (S * 0.42);
        const w = P.walk; legX = Math.sin(w) * 0.75; armX = -Math.sin(w) * 0.55; bob = Math.abs(Math.cos(w)) * 0.07; lean = 0.12; tail = Math.sin(t * 14) * 0.5;
      } else {
        const br = Math.sin(t * 2 + P.t0); bob = br * 0.012;
        if (pose.dance) {   // a pup resting near a performance dances along
          const d = t * 5.2 + P.t0; bob = Math.abs(Math.sin(d)) * 0.16; armX = -2.5 + Math.sin(d) * 0.5; armX2 = -2.5 - Math.sin(d) * 0.5; bodyY = Math.sin(d * 0.5) * 0.45; tail = Math.sin(t * 16) * 0.6; headX = -0.25;
        }
        else if (pose.phase === 'fill') { lean = 0.45 + Math.sin(pose.f * Math.PI) * 0.2; armX = -1.1; headX = 0.3; }
        else if (pose.phase === 'pour') { lean = 0.15; armX = -1.6 - Math.sin(pose.f * Math.PI) * 0.6; headX = -0.15; }
        else if (pose.phase === 'light') { armX = -2.4; headX = -0.35; tail = Math.sin(t * 12) * 0.5; }
        else if (pose.phase === 'tend') { armX = -2.2 + Math.sin(t * 5) * 0.25; armZ = Math.sin(t * 3) * 0.15; headX = -0.35; }
        else if (pose.phase === 'board') { sit = 1; lean = -0.1; armX = -0.9 - Math.max(0, Math.sin(t * 1.3 + P.t0)) * 1.3; headX = -0.25; tail = Math.sin(t * 10 + P.t0) * 0.5; }   // on a sky boat: waving
        else if (pose.phase === 'rest' || pose.phase === 'wait' || pose.phase === 'nap') { sit = 1; lean = -0.2; armX = -0.5; headX = 0.35 + Math.sin(t * 0.8 + P.t0) * 0.08; tail = Math.sin(t * 2 + P.t0) * 0.25; }
        else if (pose.phase === 'work' && pose.task === 'food') { lean = 0.4; armX = -1.2 + Math.sin(t * 6 + P.t0) * 0.4; armZ = Math.sin(t * 3) * 0.2; headX = 0.3; }
        else if (pose.phase === 'work' || pose.phase === 'build') { const sw = Math.sin(t * (pose.phase === 'build' ? 9 : 6) + P.t0); lean = 0.18 + sw * 0.06; armX = -1.9 + sw * 0.9; headX = 0.2; }
        else if (pose.phase === 'drop') { lean = 0.4 + Math.sin(pose.f * Math.PI) * 0.15; armX = -0.9; headX = 0.3; }
        // step 4: gardening (kneel + dig), feeding the tree, sweeping blight, keeping watch, playing music, dancing
        else if (pose.phase === 'plant') { sit = 0.45; lean = 0.55; armX = -1.3 + Math.sin(t * 7 + P.t0) * 0.5; headX = 0.45; tail = Math.sin(t * 6 + P.t0) * 0.4; }
        else if (pose.phase === 'feed') { lean = 0.2; armX = -1.5 - Math.sin(pose.f * Math.PI) * 0.5; headX = -0.1; }
        else if (pose.phase === 'clear') { lean = 0.3; armX = -1.0; armZ = Math.sin(t * 5 + P.t0) * 0.55; headX = 0.35; }
        else if (pose.phase === 'watch') { armX = -0.4; headY = Math.sin(t * 0.7 + P.t0) * 0.7; tail = Math.sin(t * 3 + P.t0) * 0.3; }
        else if (pose.phase === 'play') {
          const b = Math.sin(t * 4.4 + P.t0); bob = Math.abs(b) * 0.05; headX = -0.1 + b * 0.12; tail = Math.sin(t * 11) * 0.55; lean = -0.05;
          if (pose.carry === 'drum') { armX = -1.1 + Math.max(0, Math.sin(t * 8.8 + P.t0)) * 0.7; armX2 = -1.1 + Math.max(0, -Math.sin(t * 8.8 + P.t0)) * 0.7; }
          else { armX = -1.0; armZ = Math.sin(t * 14 + P.t0) * 0.22; armX2 = -1.25; }
        }
      }
      // vibe pass 2 lane B: moments + reactions (all optional): perch on a bench / bridge edge with paws dangling, sit,
      // lean, head, wag, hop, cheer (arms up), throw (right arm), roll (puppies tumbling), look at a world point
      let perch = 0, roll = 0;
      if (V) {
        if (V.sit !== undefined) sit = V.sit;
        if (V.perch) { sit = 1; perch = 1; lean = -0.12; armX = -0.35; }
        if (V.lean !== undefined) lean = V.lean;
        if (V.headX !== undefined) headX = V.headX;
        if (V.headY !== undefined) headY = V.headY;
        if (V.sway) bodyY = Math.sin(t * 0.9 + P.t0) * V.sway;
        if (V.wag) tail = Math.sin(t * (10 + 12 * V.wag) + P.t0) * (0.3 + 0.4 * V.wag);
        if (V.hop) bob += Math.abs(Math.sin(t * 7 + P.t0)) * 0.3 * V.hop;
        if (V.cheer) { const up = -2.7 + Math.sin(t * 9 + P.t0) * 0.3; armX += (up - armX) * V.cheer; armX2 = (armX2 === null ? armX : armX2) + (-2.7 - Math.sin(t * 9 + P.t0) * 0.3 - (armX2 === null ? armX : armX2)) * V.cheer; }
        if (V.throwT >= 0) { const f = V.throwT; armX2 = f < 0.5 ? -2.9 * f / 0.5 : -2.9 + (f - 0.5) / 0.5 * 2.4; }
        if (V.roll) roll = V.roll;
        if (V.look) {
          const L = V.look, dx = L[0] - x, dz = L[2] - z, hz = Math.hypot(dx, dz) || 1;
          let rel = Math.atan2(dx, dz) - P.yaw; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
          headY = Math.max(-1.15, Math.min(1.15, rel)); headX = -Math.max(-0.3, Math.min(0.95, Math.atan2(L[1] - (P.y + S * 1.3), hz))) * 0.9;
        }
      }
      const c = pose.carry, isTool = TOOLS.includes(c), isLoad = CARRY.includes(c);
      const carrying = c && !['pour', 'light', 'tend', 'fill', 'work', 'build', 'drop'].includes(pose.phase) && pose.walking;
      if (carrying && (c === 'bucket' || c === 'water' || isLoad)) armX = -1.0 + armX * 0.2;
      const toolSwing = (pose.phase === 'work' || pose.phase === 'build' || pose.phase === 'plant') && isTool;
      if (perch) { const sw = Math.sin(t * 2.2 + P.t0) * 0.32; R('legN', -0.3 + sw); R('legP', -0.3 - sw); }   // paws dangling over the edge
      else { R('legN', legX - sit * 1.45); R('legP', -legX - sit * 1.45); }
      const armP = armX2 !== null ? armX2 : (c && c.startsWith('lantern') && pose.walking) || (isTool && pose.walking) ? -0.7 : toolSwing ? armX : (carrying ? armX : -armX * (pose.walking ? 1 : -1));
      R('armN', armX, 0, -armZ - sit * 0.2); R('armP', armP, 0, armZ + sit * 0.2);
      R('head', headX, headY); R('tail', 0, tail, 0);
      R('body', lean, bodyY);
      P.model.position.y = bob - sit * 0.34 + (roll ? 0.45 : 0); P.model.rotation.z = roll;
      { const k = pose.small ? 0.62 : 1; if (P.k !== k) { P.k = k; h.scale.setScalar(S * k); } }   // puppies
      P.zz.visible = V && V.zz !== undefined ? !!V.zz : sit > 0 && (pose.phase === 'rest' || pose.phase === 'nap'); if (P.zz.visible) { const k = (t * 0.45 + P.t0) % 1; P.zz.position.set(0.35 + k * 0.3, 1.9 + k * 0.6, 0); P.zz.material.opacity = Math.sin(k * Math.PI); }
      P.disc.material.opacity = api.selected === i ? 0.85 : 0.5; P.disc.visible = !pose.air;
      h.position.set(x, P.y, z);
      // props
      const pr = P.props;
      pr.bucket.visible = c === 'bucket' || c === 'water'; pr.drop.visible = c === 'water'; pr.lamp.visible = !!c && c.startsWith('lantern');
      for (const k of CARRY) pr[k].visible = c === k;
      for (const k of TOOLS) pr[k].visible = c === k;
      for (const k of INSTR) pr[k].visible = c === k;
      if (isLoad) {
        const o = pr[c];
        if (pose.phase === 'drop') o.position.set(0, 0.55 - pose.f * 0.4, 0.55);
        else if (pose.phase === 'feed') o.position.set(0, 0.8 + Math.sin(pose.f * Math.PI) * 0.4, 0.62 - pose.f * 0.1);
        else o.position.set(0, 0.72 + bob, 0.48);
        o.rotation.set(0, 0, 0); o.scale.setScalar(pose.phase === 'feed' ? Math.max(0.05, 1 - pose.f * 0.9) : 1);
      }
      if (INSTR.includes(c)) {
        const o = pr[c], play = pose.phase === 'play';
        if (c === 'lute') { o.position.set(play ? 0.05 : 0.36, play ? 0.66 + bob : 0.5 + bob, play ? 0.4 : 0.1); o.rotation.set(0, 0, play ? 1.0 : 0.3); }
        else { o.position.set(0, play ? 0.52 + bob * 0.3 : 0.5 + bob, play ? 0.5 : -0.3); o.rotation.set(play ? 0.15 : 0, 0, 0); }
      }
      if (isTool) {
        const o = pr[c];
        if (c === 'broom' && (pose.phase === 'clear' || pose.phase === 'watch')) { const sw = pose.phase === 'clear' ? armZ : 0; o.position.set(0.25 + sw * 0.6, pose.phase === 'clear' ? 0.45 : 0.55, 0.42); o.rotation.set(pose.phase === 'clear' ? 0.9 : 0.15, 0, sw * 1.2); }
        else if (toolSwing || (c === 'basket' && pose.phase === 'work')) { const sw = armX; o.position.set(0.3, 0.75 + Math.sin(-sw) * 0.4, 0.2 + Math.cos(sw) * 0.25); o.rotation.set(-sw - 1.4, 0, 0); }
        else if (c === 'basket') { o.position.set(0.38, 0.55 + bob, 0.3); o.rotation.set(0, 0, 0); }
        else { o.position.set(0.4, 0.45 + bob, 0.15); o.rotation.set(0.5, 0, 0); }
      }
      if (pr.bucket.visible) {
        pr.bucket.userData.surf.visible = c === 'water' || (pose.phase === 'fill' && pose.f > 0.5);
        if (pose.phase === 'fill') { pr.bucket.position.set(0, 0.25 - Math.sin(pose.f * Math.PI) * 0.15, 0.75); pr.bucket.rotation.set(0.3, 0, 0); }
        else if (pose.phase === 'pour') { pr.bucket.position.set(0, 1.0 + Math.sin(pose.f * Math.PI) * 0.25, 0.62); pr.bucket.rotation.set(1.2 * Math.sin(pose.f * Math.PI), 0, 0); }
        else { pr.bucket.position.set(0, 0.62 + bob, 0.5); pr.bucket.rotation.set(0, 0, 0); }
      }
      if (pr.drop.visible) { pr.drop.position.set(0, 2.25 + Math.sin(t * 4 + P.t0) * 0.08, 0); pr.drop.scale.setScalar(pose.phase === 'pour' ? Math.max(0.05, 1 - pose.f) : 1); }
      if (pr.lamp.visible) {
        const on = c === 'lantern-on'; pr.lamp.userData.flame.material = on ? M.flameOn : M.flameOff; pr.lamp.userData.glow.visible = on;
        if (pose.phase === 'tend' || pose.phase === 'light') pr.lamp.position.set(0, 2.0 + Math.sin(t * 5) * 0.08, 0.35);
        else pr.lamp.position.set(0.38, 0.62 + bob, 0.32);
        if (on && pose.phase === 'tend') pr.lamp.userData.glow.scale.setScalar(1.5 + Math.sin(pose.f * Math.PI) * 1.5);
        else if (on) pr.lamp.userData.glow.scale.setScalar(1.5);
      }
      if (i >= 0 && api.selected === i) { ring.visible = true; ring.position.set(x, P.y + 0.15, z); ring.scale.setScalar(S * (1 + Math.sin(t * 4) * 0.06)); }
    }
    // far pups (> FAR m from the camera) drop their ink hulls + eye shines: ~6 draw calls each, invisible at that size
    api.lod = (cam, FAR) => {
      for (const P of list) {
        const far = P.holder.position.distanceTo(cam) > (FAR || 170);
        if (P.far === far) continue; P.far = far;
        for (const o of P.j._detail || []) o.visible = !far;
        if (P.fit) P.fit.traverse(o => { if (o.userData.ink) o.visible = !far; });
      }
    };
    // outfits: dress(i, id | null) swaps pup i's outfit (no-op when unchanged; game.js calls it every frame from S.pups[i].fit)
    api.dress = (i, id) => {
      const P = typeof i === 'object' ? i : list[i]; if (!P) return;   // (an npc's P too: tools/wardrobe_review.js) id = id || null; if (P.fitId === id) return;
      if (P.fit) P.fit.parent.remove(P.fit); P.fit = null; P.fitId = id;
      const t = id && outfitTemplate(id), jt = t && (t.userData.slot === 'head' || t.userData.slot === 'face' ? P.j.head : P.j.body); if (!jt) return;
      const o = t.clone(true); o.traverse(x => { if (x.userData.ink) x.visible = !P.far; }); jt.add(o); P.fit = o;
    };
    // glowing outfit parts (unlit): a little dimmer by day, brighter at night (k = DayNight night 0..1)
    api.glow = k => { for (const m of fitGlow) m.color.copy(m.userData.base).multiplyScalar(0.85 + 0.75 * k); };
    api.select = i => { api.selected = i; if (i < 0) ring.visible = false; };
    api.head = (i, out) => { const P = list[i]; return out.copy(P.holder.position).setY(P.holder.position.y + S * 1.85); };
    return api;
  }
  window.Pups = Pups;
})();
