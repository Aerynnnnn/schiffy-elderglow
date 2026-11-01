// WorldFx (vibe pass 2, lane A "a living world"): small things that make the island feel lived in, tied to the colour rings
// (src/story.js; the shown radius = ElderMap.uRest). Owns no game state: everything is derived from the layout + S, so a
// visit or a reload shows the same world.
//  - ambient props that come with the colour: flower clumps along the paths, log benches at path junctions + round the plaza,
//    stepping-stone trails, puddles after a shower, butterflies by day; by built cottages a laundry line (taken in at night)
//    and a little pile of pup things. Each one POPS in when the colour edge passes it (so a colour wave fills the land in
//    as it runs), already-coloured ones are simply there on load.
//  - sleeping curiosities in the grey: a handful per ring (a curled-up fox statue, an old swing, a broken lantern, an
//    overgrown bench, a mossy wishing well) on spots derived from the layout. Grey + still until the colour reaches them
//    (the map's own restore shader greys them), then the wave WAKES them: a sparkle, the lantern lights (and is a night
//    light source), the swing starts to sway, flowers come up round them.
//  Drawn with the map's own lit material + ink (seasons, snow, colour grade, colour restoring all apply): props are built
//  from primitives into kit-style batches (ElderMap.kitBatch). Draw calls: one per prop kind that has something to show.
(function () {
  'use strict';
  const hsh = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const back = x => { const c = 1.9; x = Math.max(0, Math.min(1, x)); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };   // ease-out-back (pop)
  const POP = 0.75;   // s

  // ---- primitive "kit pieces": a Group of meshes whose materials carry a colour + a name (Glow* = lit at night), merged by
  // ElderMap.kitBatch exactly like the library's pieces (vertex colours, unlit flag, ink hull for parts > 0.6 m)
  const MATS = {};
  // colours are written as sRGB hex; the library's GLB materials arrive linear (GLTFLoader), so convert to match them
  const mat = (hex, name) => { const k = hex + (name || ''); if (MATS[k]) return MATS[k]; const m = Object.assign(new THREE.MeshBasicMaterial({ color: hex }), { name: name || 'Prop' }); m.color.convertSRGBToLinear(); return (MATS[k] = m); };
  function part(g, hex, x, y, z, rx, ry, rz, sx, sy, sz, name) {
    const m = new THREE.Mesh(g, mat(hex, name)); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); m.scale.set(sx || 1, sy || sx || 1, sz || sx || 1); return m;
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = n => new THREE.CylinderGeometry(1, 1, 1, n || 8), SPH = new THREE.SphereGeometry(1, 12, 8), CONE = n => new THREE.ConeGeometry(1, 1, n || 8);
  const C8 = CYL(8), C6 = CYL(6), C12 = CYL(12), CO6 = CONE(6), CO4 = CONE(4);
  const TOR = new THREE.TorusGeometry(1, 0.22, 6, 14);
  const COL = { wood: 0x8a5a34, dark: 0x6b4a2c, plank: 0xa8743f, stone: 0xb0aca2, stoneD: 0x8f8b84, moss: 0x7fb05a, mossD: 0x5f8f48, rope: 0xd8c59c, metal: 0x4f4c5c,
    glassOff: 0x55586a, glow: 0xffc260, leaf: 0x6fbf5a, red: 0xe0605a, cream: 0xfff3dc, blue: 0x7ab8e8, pink: 0xf59ac0, yellow: 0xffd45a, bowl: 0x4fa3d1, bone: 0xf4ead6, cushion: 0xc98ad8 };
  const G = parts => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); return g; };
  // a log bench (plank on two stumps), ~5 m long; front = +z
  const benchG = () => G([part(BOX, COL.plank, 0, 1.25, 0, 0, 0, 0, 5.2, 0.32, 1.25), part(C8, COL.dark, -1.8, 0.55, 0, 0, 0, 0, 0.42, 1.1, 0.42), part(C8, COL.dark, 1.8, 0.55, 0, 0, 0, 0, 0.42, 1.1, 0.42),
    part(BOX, COL.plank, 0, 2.15, -0.55, -0.18, 0, 0, 5.0, 0.9, 0.22), part(BOX, COL.dark, -2.1, 1.75, -0.5, 0, 0, 0, 0.22, 1.0, 0.22), part(BOX, COL.dark, 2.1, 1.75, -0.5, 0, 0, 0, 0.22, 1.0, 0.22)]);
  const stoneG = () => G([part(C8, COL.stone, 0, 0.12, 0, 0, 0, 0, 1.25, 0.3, 1.0), part(C8, COL.moss, 0.25, 0.3, 0.1, 0, 0, 0, 0.55, 0.06, 0.45)]);
  // laundry line: two poles + a rope (cloths are their own piece so they can be taken in at night)
  const lineG = () => G([part(C6, COL.wood, -4, 2.2, 0, 0, 0, 0, 0.16, 4.4, 0.16), part(C6, COL.wood, 4, 2.2, 0, 0, 0, 0, 0.16, 4.4, 0.16), part(C6, COL.rope, 0, 4.1, 0, 0, 0, Math.PI / 2, 0.05, 8, 0.05)]);
  const clothG = () => G([part(BOX, COL.cream, -2.4, 3.35, 0, 0, 0, 0, 1.5, 1.4, 0.06), part(BOX, COL.blue, -0.4, 3.45, 0, 0, 0, 0.04, 1.2, 1.2, 0.06), part(BOX, COL.pink, 1.4, 3.3, 0, 0, 0, -0.05, 1.3, 1.5, 0.06),
    part(BOX, COL.yellow, 3.0, 3.6, 0, 0, 0, 0, 0.8, 0.9, 0.06)]);
  // pup things: a ball, a food bowl, a cushion bed, a bone
  const pileG = () => G([part(SPH, COL.red, 1.6, 0.45, 0.8, 0, 0, 0, 0.45), part(C12, COL.bowl, -1.2, 0.2, 0.9, 0, 0, 0, 0.6, 0.4, 0.6), part(C12, COL.plank, -1.2, 0.36, 0.9, 0, 0, 0, 0.45, 0.1, 0.45),
    part(C12, COL.cushion, 0, 0.25, -1.0, 0, 0, 0, 1.4, 0.5, 1.1), part(TOR, COL.cushion, 0, 0.5, -1.0, Math.PI / 2, 0, 0, 1.3, 1.0, 1.4), part(C6, COL.bone, 1.2, 0.15, -0.3, 0, 0.6, Math.PI / 2, 0.12, 0.9, 0.12),
    part(SPH, COL.bone, 1.2 + 0.47 * Math.cos(0.6), 0.15, -0.3 - 0.47 * Math.sin(0.6), 0, 0, 0, 0.18), part(SPH, COL.bone, 1.2 - 0.47 * Math.cos(0.6), 0.15, -0.3 + 0.47 * Math.sin(0.6), 0, 0, 0, 0.18)]);
  // ---- the sleeping curiosities (static bodies; the swing seat is separate + animated; WAKE = an overlay drawn once awake)
  const ST = 0x9aa0ab, STD = 0x7a7f8b, EYE = 0x3a3848;
  const CURIO = {
    // a fox of stone asleep on a round plinth, tail curled round its paws (faces +x)
    statue: () => G([part(C12, STD, 0, 0.45, 0, 0, 0, 0, 2.8, 0.9, 2.8), part(C12, ST, 0, 0.95, 0, 0, 0, 0, 2.55, 0.12, 2.55),
      part(SPH, ST, -0.2, 1.85, -0.2, 0, 0.3, 0, 2.0, 1.05, 1.45), part(SPH, ST, 0.5, 1.45, 1.15, 0, -0.5, 0, 1.9, 0.62, 0.7), part(SPH, 0xc9ccd2, 1.95, 1.4, 1.35, 0, 0, 0, 0.6, 0.5, 0.55),
      part(SPH, ST, 1.45, 2.1, 0.35, 0, 0, 0, 0.95, 0.82, 0.92), part(CO6, ST, 2.45, 1.98, 0.42, 0, 0, -Math.PI / 2, 0.42, 0.85, 0.42), part(SPH, EYE, 2.86, 1.98, 0.42, 0, 0, 0, 0.13),
      part(CO4, ST, 1.25, 2.95, 0.0, -0.25, 0, -0.2, 0.36, 0.85, 0.3), part(CO4, ST, 1.35, 2.95, 0.75, 0.25, 0, -0.2, 0.36, 0.85, 0.3),
      part(BOX, EYE, 2.02, 2.25, 0.12, 0, 0.25, 0, 0.08, 0.07, 0.34), part(BOX, EYE, 2.02, 2.25, 0.72, 0, -0.25, 0, 0.08, 0.07, 0.34),
      part(SPH, COL.moss, -0.5, 2.75, -0.4, 0, 0, 0, 0.95, 0.28, 0.75), part(SPH, COL.mossD, -1.6, 0.95, 1.4, 0, 0, 0, 0.9, 0.3, 0.6), part(SPH, COL.moss, 1.9, 0.95, -1.5, 0, 0, 0, 0.7, 0.25, 0.5)]),
    statueWake: () => G([part(TOR, 0x8ff3ff, 0, 1.02, 0, Math.PI / 2, 0, 0, 2.75, 2.75, 0.5, 'GlowCool'), part(SPH, 0xffb3d1, -0.7, 2.85, 0.4, 0, 0, 0, 0.3), part(SPH, 0xfff07a, -0.2, 2.9, -0.7, 0, 0, 0, 0.26),
      part(SPH, 0xffffff, 0.3, 2.82, 0.1, 0, 0, 0, 0.24), part(SPH, 0xffb3d1, 1.2, 2.95, 0.38, 0, 0, 0, 0.22)]),
    swing: () => G([part(C6, COL.dark, -3.4, 3.6, -1.3, 0.32, 0, 0, 0.26, 7.6, 0.26), part(C6, COL.dark, -3.4, 3.6, 1.3, -0.32, 0, 0, 0.26, 7.6, 0.26), part(C6, COL.dark, 3.4, 3.6, -1.3, 0.32, 0, 0, 0.26, 7.6, 0.26),
      part(C6, COL.dark, 3.4, 3.6, 1.3, -0.32, 0, 0, 0.26, 7.6, 0.26), part(C8, COL.wood, 0, 7.25, 0, 0, 0, Math.PI / 2, 0.3, 7.8, 0.3), part(SPH, COL.mossD, -3.4, 7.35, 0, 0, 0, 0, 0.7, 0.4, 0.7),
      part(SPH, COL.leaf, 2.6, 7.45, 0, 0, 0, 0, 1.2, 0.5, 0.6), part(SPH, COL.leaf, 0.6, 7.5, 0.1, 0, 0, 0, 0.8, 0.35, 0.45)]),
    swingWake: () => G([0, 1, 2, 3, 4, 5, 6].map(k => part(SPH, [0xff9ac2, 0xfff07a, 0xffffff, 0xffb36b][k % 4], -3 + k, 7.3 - 0.35 * Math.sin(k / 6 * Math.PI), 0.32, 0, 0, 0, 0.32))),
    swingSeat: () => G([part(C6, COL.rope, -1.2, -2.75, 0, 0, 0, 0, 0.07, 5.5, 0.07), part(C6, COL.rope, 1.2, -2.75, 0, 0, 0, 0, 0.07, 5.5, 0.07), part(BOX, COL.plank, 0, -5.5, 0, 0, 0, 0, 3.0, 0.26, 1.15)]),
    lantern: () => G([part(C6, COL.dark, 0, 3.6, 0, 0, 0, 0.07, 0.3, 7.2, 0.3), part(BOX, COL.dark, 1.05, 6.95, 0, 0, 0, -0.22, 2.3, 0.24, 0.24), part(C6, COL.metal, 2.05, 6.3, 0, 0, 0, 0, 0.06, 0.9, 0.06),
      part(C6, 0x5d6170, 2.05, 5.3, 0, 0, 0, 0.14, 0.72, 1.3, 0.72), part(CO6, COL.metal, 2.05, 6.12, 0, 0, 0, 0.14, 0.88, 0.6, 0.88), part(C6, COL.metal, 2.05, 4.6, 0, 0, 0, 0.14, 0.8, 0.12, 0.8),
      part(C8, STD, 0, 0.3, 0, 0, 0, 0, 1.1, 0.6, 1.1), part(SPH, COL.mossD, 0.5, 0.7, 0.4, 0, 0, 0, 0.7, 0.32, 0.55), part(TOR, COL.moss, 0.1, 2.2, 0, Math.PI / 2, 0, 0, 0.45, 0.45, 1.5)]),
    lanternWake: () => G([part(C6, COL.glow, 2.05, 5.3, 0, 0, 0, 0.14, 0.78, 1.36, 0.78, 'GlowWarm')]),
    bench: () => G([part(BOX, ST, 0, 1.35, 0, 0, 0, 0, 5.6, 0.45, 1.6), part(BOX, STD, -2.1, 0.6, 0, 0, 0, 0, 0.8, 1.2, 1.4), part(BOX, STD, 2.1, 0.6, 0, 0, 0, 0, 0.8, 1.2, 1.4),
      part(BOX, ST, 0, 2.5, -0.7, -0.12, 0, 0, 5.6, 1.8, 0.34), part(TOR, COL.mossD, -1.3, 2.1, -0.5, 0, 0.3, 0.4, 0.9, 0.9, 1.8), part(TOR, COL.moss, 1.5, 1.8, -0.25, 0.4, 0, -0.3, 0.8, 0.8, 1.6),
      part(SPH, COL.moss, -2.4, 3.3, -0.7, 0, 0, 0, 0.8, 0.4, 0.45), part(SPH, COL.leaf, 2.7, 0.5, 0.8, 0, 0, 0, 1.0, 0.5, 0.7), part(SPH, COL.leaf, -2.8, 0.5, 0.9, 0, 0, 0, 0.8, 0.45, 0.6)]),
    benchWake: () => G([part(C8, 0xc9774a, -1.6, 1.85, 0.1, 0, 0, 0, 0.35, 0.55, 0.35), part(SPH, 0xff9ac2, -1.6, 2.3, 0.1, 0, 0, 0, 0.42, 0.32, 0.42), part(C8, 0xc9774a, 1.7, 1.85, 0.2, 0, 0, 0, 0.35, 0.55, 0.35),
      part(SPH, 0xfff07a, 1.7, 2.3, 0.2, 0, 0, 0, 0.42, 0.32, 0.42), part(SPH, 0xffffff, 0.2, 3.5, -0.75, 0, 0, 0, 0.3), part(SPH, 0xffb36b, -0.6, 3.45, -0.8, 0, 0, 0, 0.26)]),
    well: () => G([part(C12, ST, 0, 1.0, 0, 0, 0, 0, 2.5, 2.0, 2.5), part(C12, STD, 0, 2.05, 0, 0, 0, 0, 2.7, 0.24, 2.7), part(C12, 0x3d4a5a, 0, 1.85, 0, 0, 0, 0, 2.0, 0.2, 2.0),
      part(C6, COL.dark, -2.2, 3.8, 0, 0, 0, 0, 0.24, 3.6, 0.24), part(C6, COL.dark, 2.2, 3.8, 0, 0, 0, 0, 0.24, 3.6, 0.24), part(CO4, COL.plank, 0, 6.3, 0, 0, Math.PI / 4, 0, 3.9, 1.6, 2.8),
      part(C6, COL.wood, 0, 4.9, 0, 0, 0, Math.PI / 2, 0.16, 4.4, 0.16), part(C8, COL.wood, 0.4, 3.9, 0, 0, 0, 0, 0.42, 0.6, 0.42), part(SPH, COL.moss, -1.4, 2.25, 1.7, 0, 0, 0, 1.0, 0.4, 0.7),
      part(SPH, COL.mossD, 1.8, 0.5, -1.6, 0, 0, 0, 0.9, 0.4, 0.7)]),
    wellWake: () => G([part(C12, 0x7fe9ff, 0, 1.97, 0, 0, 0, 0, 1.95, 0.08, 1.95, 'GlowCool'), part(SPH, 0xff9ac2, -1.8, 2.3, -1.3, 0, 0, 0, 0.32), part(SPH, 0xfff07a, 1.5, 2.3, 1.7, 0, 0, 0, 0.3)]),
  };
  const SCALE = { statue: 1.35, swing: 1.2, lantern: 1.2, bench: 1.25, well: 1.2 };  const KINDS = ['statue', 'swing', 'lantern', 'bench', 'well'];
  const NAMES = { statue: 'a sleeping fox of stone', swing: 'an old swing', lantern: 'a broken lantern', bench: 'an overgrown bench', well: 'a mossy wishing well' };
  // per ring band (m from the tree): how many curiosities (ring 0 = the tree's own patch: none)
  const BANDS = [[62, 92, 2, 90], [112, 205, 3, 46], [222, 298, 3, 46], [318, 470, 3, 60], [495, 640, 2, 90]];   // [from, to, how many, max m from a path]

  function WorldFx(scene, map, nav, ground, plots, opts) {
    opts = opts || {};
    const PHONE = !!opts.phone, TP = nav.TP, L = map.layout, PL = L.placements;
    const batchOf = {}; for (const b of map.batches) batchOf[b.key] = b;
    const lit = batchOf.EG_Pebbles && batchOf.EG_Pebbles.mesh ? batchOf.EG_Pebbles.mesh.material : map.batches.find(b => b.mesh && !b.terrain).mesh.material;
    const ink = ElderMap.inkMat;
    const Y = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), CO = new THREE.Color();
    const gy = (x, z) => { const r = ground.raw ? ground.raw(x, z) : null; return r === null || r === undefined ? ground(x, z, TP[1]) : r; };
    const dxz = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

    // ---------------------------------------------------------------- where things may go (once)
    // blockers: every placed thing with a footprint (houses, halls, trees incl. thinned ones that may grow back, rocks, decor...)
    const CELL = 16, grid = new Map();
    const addB = (x, z, r) => { const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push([x, z, r]); } };
    for (const p of PL) {
      if (p.role === 'cover' || p.role === 'flower' || p.role === 'isle' || p.role === 'mountain' || p.role === 'tree') continue;
      const r = p.role === 'house' || p.role === 'faction' ? 11 * (p.s || 1) : p.role === 'market' ? 9 : p.role === 'forest' ? 4.5 * (p.s || 1) : p.role === 'bridge' ? 14 : p.role === 'cliff' ? 30 : 3 * (p.s || 1);
      addB(p.pos[0], p.pos[2], r);
    }
    for (const x of plots.info) addB(x.c[0], x.c[1], Math.max(x.w, x.d) / 2 + 5);
    for (const list of [nav.decorSpots, nav.blightSpots, nav.wardSpots]) for (const s of list || []) addB(s.p[0], s.p[2], 5);
    const blocked = (x, z, pad) => { const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL), a = grid.get(k); if (!a) return false; for (const b of a) if (dxz(x, z, b[0], b[1]) < b[2] + pad) return true; return false; };
    // roads: segments between graph nodes (the path stones follow them), bridges skipped
    const N = L.roads.nodes, segs = [];
    for (const e of L.roads.edges) { const a = N[e[0]], b = N[e[1]]; if (!a || !b) continue; segs.push([a[0], a[2], b[0], b[2], !!((a[3] && a[3].bridge) || (b[3] && b[3].bridge))]); }
    const roadD = (x, z) => { let d = 1e9; for (const s of segs) { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2)); d = Math.min(d, dxz(x, z, s[0] + dx * t, s[1] + dz * t)); } return d; };
    const dry = (x, z) => !nav.dry || nav.dry(x, z);
    const onMap = (x, z) => !ground.raw || (ground.raw(x, z) !== null && ground.raw(x, z) !== undefined);
    const napGrid = (x, z) => { const D = nav.door(1).p, ux = D[0] - TP[0], uz = D[2] - TP[2], l = Math.hypot(ux, uz) || 1, u = ((x - TP[0]) * ux + (z - TP[2]) * uz) / l, v = (-(x - TP[0]) * uz + (z - TP[2]) * ux) / l; return u > 8 && u < 80 && Math.abs(v) < 34; };

    // ---- the sleeping curiosities: per band, scan rings of candidate spots, keep dry / free / near-a-path ones, pick by hash
    const curios = [];
    BANDS.forEach(([r0, r1, n, rMax], bi) => {
      const cand = [];
      for (let r = r0; r <= r1; r += 9) {
        const m = Math.max(12, Math.round(2 * Math.PI * r / 11));
        for (let k = 0; k < m; k++) {
          const a = (k + 0.37 * bi) / m * Math.PI * 2, x = TP[0] + Math.cos(a) * r, z = TP[2] + Math.sin(a) * r;
          if (!onMap(x, z) || !dry(x, z) || blocked(x, z, 4) || napGrid(x, z)) continue;
          const rd = roadD(x, z); if (rd < 8 || rd > rMax) continue;
          const y = gy(x, z); if (Math.abs(y - gy(x + 3, z)) > 1.6 || Math.abs(y - gy(x, z + 3)) > 1.6) continue;   // flat enough
          cand.push({ x, z, y, r, a, h: hsh(Math.round(x * 7) * 31 + Math.round(z * 7) + bi * 7919) });
        }
      }
      cand.sort((p, q) => p.h - q.h);
      const got = [];
      for (const c of cand) { if (got.length >= n) break; if (got.some(o => dxz(o.x, o.z, c.x, c.z) < 90) || curios.some(o => dxz(o.x, o.z, c.x, c.z) < 55)) continue; got.push(c); }
      got.forEach((c, j) => { const kind = KINDS[(bi * 2 + j) % KINDS.length]; curios.push({ kind, x: c.x, y: c.y, z: c.z, yaw: Math.atan2(TP[0] - c.x, TP[2] - c.z) + (c.h - 0.5) * 1.2, band: bi, awake: false, t: 99, wakeT: -1 }); });
    });
    // static bodies merged into ONE mesh (+ ink): their spots never change. Drawn as a 1-instance InstancedMesh: the map's lit /
    // ink materials are only ever used instanced (a plain Mesh with them broke the render: r128 attribute binding error)
    const one = (geo, m) => { const im = new THREE.InstancedMesh(geo, m, 1); im.setMatrixAt(0, new THREE.Matrix4()); return im; };
    let curioMesh = null, curioInk = null;
    {
      const root = new THREE.Group();
      for (const c of curios) { const g = CURIO[c.kind](); g.position.set(c.x, c.y - 0.05, c.z); g.rotation.y = c.yaw; g.scale.setScalar(SCALE[c.kind]); root.add(g); }
      const b = ElderMap.kitBatch('vp2:curios', root, null, false);
      if (b && b.geo) {
        curioMesh = one(b.geo, lit); curioMesh.castShadow = true; curioMesh.receiveShadow = true; curioMesh.frustumCulled = false; scene.add(curioMesh);
        if (b.ink && !PHONE) { curioInk = one(b.ink, ink); curioInk.instanceMatrix = curioMesh.instanceMatrix; curioInk.frustumCulled = false; scene.add(curioInk); }
      }
    }

    // what an AWAKE curiosity adds (lit lantern, rune ring + flower crown, water glow, flower pots, a garland): one merged mesh,
    // rebuilt only when the set of awake ones changes
    let wakeMesh = null, wakeSig = '';
    function rebuildWake() {
      const sig = curios.map(c => c.awake ? 1 : 0).join(''); if (sig === wakeSig) return; wakeSig = sig;
      if (wakeMesh) { scene.remove(wakeMesh); wakeMesh.geometry.dispose(); wakeMesh = null; }
      const root = new THREE.Group();
      for (const c of curios) { if (!c.awake || !CURIO[c.kind + 'Wake']) continue; const g = CURIO[c.kind + 'Wake'](); g.position.set(c.x, c.y - 0.05, c.z); g.rotation.y = c.yaw; g.scale.setScalar(SCALE[c.kind]); root.add(g); }
      if (!root.children.length) return;
      const b = ElderMap.kitBatch('vp2:wake', root, null, true); if (!b || !b.geo) return;
      wakeMesh = one(b.geo, lit); wakeMesh.receiveShadow = true; wakeMesh.frustumCulled = false; scene.add(wakeMesh);
    }
    // a flower clump = a few of the library's own flower patches merged (all their attributes: vertex colour, sway...), ~4 m
    function clumpGeo() {
      const src = [['EG_FlowerPatch_C', 0, 0, 0, 2.7], ['EG_FlowerPatch_A', 1.3, 0.6, 1.2, 2.5], ['EG_FlowerPatch_B', -1.1, 0.9, 2.3, 2.6], ['EG_FlowerPatch_C', 0.3, -1.3, 3.9, 2.3], ['EG_FlowerPatch_A', -0.9, -0.9, 5.1, 2.2]]
        .filter(s => batchOf[s[0]] && batchOf[s[0]].geo);
      if (!src.length) return null;
      const names = ['position', 'normal', 'color', 'unlit', 'swayP', 'swayW'], out = {}, idx = []; names.forEach(n => out[n] = []); let base = 0;
      const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
      for (const [key, x, z, yaw, s] of src) {
        const g = batchOf[key].geo; m.compose(V.set(x, 0, z), Q.setFromAxisAngle(Y, yaw), SC.setScalar(s)); nm.getNormalMatrix(m);
        const P = g.attributes.position, n = P.count;
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m); out.position.push(v.x, v.y, v.z);
          v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize(); out.normal.push(v.x, v.y, v.z);
          v.fromBufferAttribute(g.attributes.swayP, i).applyMatrix4(m); out.swayP.push(v.x, v.y, v.z);
          for (const a of ['color', 'unlit', 'swayW']) { const A = g.attributes[a]; for (let k = 0; k < A.itemSize; k++) out[a].push(A.array[i * A.itemSize + k]); }
        }
        const I = g.index.array; for (let i = 0; i < I.length; i++) idx.push(base + I[i]); base += n;
      }
      const geo = new THREE.BufferGeometry(); const sz = { position: 3, normal: 3, color: 3, unlit: 1, swayP: 3, swayW: 1 };
      for (const nme of names) geo.setAttribute(nme, new THREE.Float32BufferAttribute(out[nme], sz[nme]));
      geo.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); geo.computeBoundingSphere(); return geo;
    }

    // ---- instanced prop kinds (kit-style batches made from primitives, or the library's own kit geometry)
    function kind(key, group, max, o) {
      o = o || {};
      let geo, inkGeo = null;
      if (group && group.isBufferGeometry) geo = group;
      else if (typeof group === 'string') { const b = batchOf[group]; if (!b || !b.geo) return null; geo = b.geo; inkGeo = o.ink ? b.ink : null; }
      else { const b = ElderMap.kitBatch('vp2:' + key, group, null, !o.ink); geo = b.geo; inkGeo = o.ink ? b.ink : null; }
      const m = new THREE.InstancedMesh(geo, o.mat || lit, max); m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = !!o.shadow && !PHONE; m.receiveShadow = true; scene.add(m);
      if (o.tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      let im = null; if (inkGeo && !PHONE) { im = new THREE.InstancedMesh(inkGeo, ink, max); im.instanceMatrix = m.instanceMatrix; im.count = 0; im.visible = false; im.frustumCulled = false; scene.add(im); }
      return { key, m, ink: im, max, items: [], cull: o.cull || 0, sig: '' };
    }
    const K = {
      flower: kind('flower', clumpGeo() || 'EG_FlowerPatch_C', 900, { cull: PHONE ? 130 : 190, tint: true }),
      bench: kind('bench', benchG(), 80, { ink: true, shadow: true, cull: 320 }),
      stone: kind('stone', stoneG(), 260, { cull: 200 }),
      line: kind('line', lineG(), 48, { cull: 260 }),
      cloth: kind('cloth', clothG(), 48, { cull: 260 }),
      pile: kind('pile', pileG(), 48, { cull: 200 }),
      seat: kind('seat', CURIO.swingSeat(), 8, { cull: 600 }),
    };
    const item = (k, x, z, yaw, s, extra) => { const it = Object.assign({ x, z, y: gy(x, z), yaw, s, d: 0, shown: -1, t: 99 }, extra || {}); it.d = Math.hypot(x - TP[0], z - TP[2]); if (K[k]) K[k].items.push(it); return it; };
    const FLOWER_TINT = [[1, 1, 1], [1, 0.82, 0.9], [0.95, 1, 0.82], [1, 0.93, 0.75], [0.88, 0.9, 1]];
    // flowers along the paths (both sides, every ~15 m, thinned by hash), not on bridges / water / anything placed
    {
      let n = 0;
      for (let si = 0; si < segs.length; si++) {
        const s = segs[si]; if (s[4]) continue;
        const len = dxz(s[0], s[1], s[2], s[3]), ux = (s[2] - s[0]) / (len || 1), uz = (s[3] - s[1]) / (len || 1);
        for (let d = hsh(si * 41 + 3) * 8; d < len; d += 8) {   // road edges are short (~9 m): a hashed phase per edge
          for (const side of [-1, 1]) {
            const h = hsh(si * 977 + Math.round(d) * 13 + (side + 1) * 7); if (h < 0.3) continue;
            const off = 4.6 + h * 2.4, x = s[0] + ux * d - uz * off * side, z = s[1] + uz * d + ux * off * side;
            if (Math.hypot(x - TP[0], z - TP[2]) < 50 || !dry(x, z) || blocked(x, z, 1.5) || roadD(x, z) < 3.8 || !onMap(x, z)) continue;
            const it = item('flower', x, z, h * 40, 0.95 + h * 0.55); it.tint = FLOWER_TINT[Math.floor(h * 97) % FLOWER_TINT.length]; n++;
          }
        }
      }
    }
    // + flower drifts in the open meadow (away from the paths), a few clumps each
    for (let k = 0; k < 70; k++) {
      const a = hsh(k * 7919 + 1) * Math.PI * 2, r = 70 + hsh(k * 104729 + 5) * 330, x0 = TP[0] + Math.cos(a) * r, z0 = TP[2] + Math.sin(a) * r;
      if (!onMap(x0, z0) || !dry(x0, z0) || blocked(x0, z0, 4) || napGrid(x0, z0) || roadD(x0, z0) < 7) continue;
      for (let j = 0; j < 4; j++) { const b = hsh(k * 31 + j * 7) * 6.28, d = j ? 3 + hsh(k + j * 13) * 4 : 0, x = x0 + Math.cos(b) * d, z = z0 + Math.sin(b) * d;
        if (!dry(x, z) || blocked(x, z, 1.5)) continue; const h = hsh(k * 17 + j); const it = item('flower', x, z, h * 40, 0.9 + h * 0.5); it.tint = FLOWER_TINT[(k + j) % FLOWER_TINT.length]; }
    }
    // benches: at path junctions (3+ roads), facing the crossing, about every other one; + four round the plaza facing the tree
    {
      const deg = new Array(N.length).fill(0); for (const e of L.roads.edges) { deg[e[0]]++; deg[e[1]]++; }
      for (let i = 0; i < N.length; i++) {
        if (deg[i] < 3 || (N[i][3] && N[i][3].bridge)) continue;
        const h = hsh(i * 131 + 7); if (h < 0.45) continue;
        const a = h * 40, x = N[i][0] + Math.cos(a) * 7.5, z = N[i][2] + Math.sin(a) * 7.5;
        if (Math.hypot(x - TP[0], z - TP[2]) < 60 || !dry(x, z) || blocked(x, z, 2.5) || roadD(x, z) < 4.2 || !onMap(x, z)) continue;
        item('bench', x, z, Math.atan2(N[i][0] - x, N[i][2] - z), 1);
      }
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + 0.4, r = 82, x = TP[0] + Math.cos(a) * r, z = TP[2] + Math.sin(a) * r;
        if (!dry(x, z) || blocked(x, z, 3) || napGrid(x, z) || roadD(x, z) < 4.5 || !onMap(x, z)) continue;
        if (K.bench.items.filter(b => b.d < 100).length >= 4) break;
        item('bench', x, z, Math.atan2(TP[0] - x, TP[2] - z), 1);
      }
    }
    // stepping-stone trails from the nearest path to each curiosity; flowers come up round it when it wakes
    for (const c of curios) {
      let best = null, bd = 1e9;
      for (const s of segs) { if (s[4]) continue; const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((c.x - s[0]) * dx + (c.z - s[1]) * dz) / l2)), px = s[0] + dx * t, pz = s[1] + dz * t, d = dxz(c.x, c.z, px, pz); if (d < bd) { bd = d; best = [px, pz]; } }
      if (best) {
        const ux = (c.x - best[0]) / bd, uz = (c.z - best[1]) / bd, n = Math.min(12, Math.floor((bd - 7) / 2.7));
        // the trail is there from the start (grey in the grey): a hint that something waits at its end (laid from the curiosity
        // back toward the path, at most 12 stones)
        for (let k = 0; k < n; k++) { const d = bd - 4.5 - k * 2.7, side = (k % 2 ? 0.55 : -0.55), x = best[0] + ux * d - uz * side, z = best[1] + uz * d + ux * side; if (!dry(x, z)) break; item('stone', x, z, k * 1.3, 0.9 + hsh(k + c.x) * 0.3, { always: true }); }
      }
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + c.yaw, r = 4.2 + hsh(k * 7 + Math.round(c.z)) * 2.2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (!dry(x, z)) continue;
        const it = item('flower', x, z, a * 3, 0.6 + 0.3 * hsh(k + Math.round(c.x)), { curio: c, awakeOnly: true }); it.tint = FLOWER_TINT[(k + c.band) % FLOWER_TINT.length]; }
      if (c.kind === 'swing') item('seat', c.x, c.z, c.yaw, 1, { always: true, hang: c });
    }
    for (const it of K.seat.items) { it.y = it.hang.y - 0.05 + 7.25 * SCALE.swing; it.s = SCALE.swing; }

    // ---- puddles after a shower: soft decals by the paths (one draw), only in the coloured land
    const PUD = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const r = g.createRadialGradient(64, 64, 8, 64, 64, 62); r.addColorStop(0, 'rgba(235,242,255,.95)'); r.addColorStop(0.75, 'rgba(225,235,250,.85)'); r.addColorStop(1, 'rgba(220,230,250,0)');
      g.fillStyle = r; g.beginPath(); g.ellipse(64, 64, 62, 44, 0.3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5; g.beginPath(); g.ellipse(58, 56, 30, 16, 0.3, 3.6, 5.2); g.stroke(); const t = new THREE.CanvasTexture(c); return t; })();
    const pudMat = new THREE.MeshBasicMaterial({ map: PUD, color: 0x5d84ab, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pud = { key: 'puddle', m: new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), pudMat, 90), items: [], cull: 260, sig: '', max: 90 };
    pud.m.count = 0; pud.m.visible = false; pud.m.frustumCulled = false; pud.m.renderOrder = 1; scene.add(pud.m);
    for (let si = 0; si < segs.length && pud.items.length < 90; si++) {
      const s = segs[si]; if (s[4]) continue; const h = hsh(si * 3571 + 11); if (h < 0.62) continue;
      const len = dxz(s[0], s[1], s[2], s[3]), t = 0.3 + h * 0.4, side = h > 0.81 ? 1 : -1, ux = (s[2] - s[0]) / (len || 1), uz = (s[3] - s[1]) / (len || 1);
      const x = s[0] + (s[2] - s[0]) * t - uz * 1.2 * side, z = s[1] + (s[3] - s[1]) * t + ux * 1.2 * side;
      if (Math.hypot(x - TP[0], z - TP[2]) < 40 || !dry(x, z) || !onMap(x, z)) continue;
      pud.items.push({ x, z, y: gy(x, z) + 0.06, yaw: h * 9, s: 2.6 + h * 2.2, sx: 1.4, d: Math.hypot(x - TP[0], z - TP[2]), shown: -1, t: 99 });
    }
    K.puddle = pud;

    // ---- butterflies (day, not winter): one Points draw, each circles a flower clump that the colour has reached
    const BN = PHONE ? 40 : 80, bAnchor = new Float32Array(BN * 3), bSeed = new Float32Array(BN * 4), bOn = new Float32Array(BN);
    const bGeo = new THREE.BufferGeometry(); bGeo.setAttribute('position', new THREE.BufferAttribute(bAnchor, 3)); bGeo.setAttribute('seed', new THREE.BufferAttribute(bSeed, 4)); bGeo.setAttribute('on', new THREE.BufferAttribute(bOn, 1));
    const bAnch = []; { const fl = K.flower ? K.flower.items.filter(f => !f.curio) : []; for (let i = 0; i < BN && fl.length; i++) { const f = fl[Math.floor(hsh(i * 7717 + 3) * fl.length)]; bAnch.push(f); bAnchor[i * 3] = f.x; bAnchor[i * 3 + 1] = f.y + 2.5; bAnchor[i * 3 + 2] = f.z; for (let k = 0; k < 4; k++) bSeed[i * 4 + k] = hsh(i * 31 + k * 977 + 5); } }
    const WING = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fff';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(32 + s * 13, 24, 13, 15, s * 0.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(32 + s * 10, 44, 9, 11, -s * 0.4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#2a2442'; g.fillRect(30, 16, 4, 34); const t = new THREE.CanvasTexture(c); return t; })();
    const BU = { uT: { value: 0 }, uK: { value: 0 }, uScale: { value: 600 }, uMap: { value: WING } };
    const bMat = new THREE.ShaderMaterial({ uniforms: BU, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 seed; attribute float on; uniform float uT, uK, uScale; varying vec3 vC; varying float vA, vF;
        void main() {
          float sp = 0.35 + seed.x * 0.4, ph = seed.y * 6.28, r = 2.5 + seed.z * 4.0;
          vec3 p = position + vec3(cos(uT * sp + ph) * r + sin(uT * sp * 2.3 + ph) * 1.2, sin(uT * (1.1 + seed.w) + ph) * 1.4 + 1.0, sin(uT * sp + ph) * r * 0.8);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = on * uK * smoothstep(5.0, 16.0, -mv.z);
          gl_PointSize = vA > 0.001 ? min(1.7 * uScale / max(1.0, -mv.z), 28.0) : 0.0;
          gl_Position = projectionMatrix * mv;
          vC = seed.w < 0.3 ? vec3(1.0, 0.86, 0.3) : seed.w < 0.55 ? vec3(1.0, 1.0, 0.96) : seed.w < 0.8 ? vec3(0.55, 0.78, 1.0) : vec3(1.0, 0.62, 0.35);
          vF = 0.35 + 0.65 * abs(sin(uT * (9.0 + seed.x * 5.0) + ph));   // wing beat
        }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA, vF;
        void main() { vec2 q = gl_PointCoord - 0.5; q.x /= vF; q += 0.5; if (q.x < 0.0 || q.x > 1.0) discard; vec4 t = texture2D(uMap, q); float a = t.a * vA; if (a < 0.05) discard;
          gl_FragColor = vec4(t.r < 0.5 ? vec3(0.16, 0.14, 0.26) : vC, a); }` });
    const bPts = new THREE.Points(bGeo, bMat); bPts.frustumCulled = false; bPts.renderOrder = 3; scene.add(bPts);

    // ---- sparkles (a prop / curiosity waking up): small CPU particle pool, one Points draw
    const SPN = 160, spPos = new Float32Array(SPN * 3), spCol = new Float32Array(SPN * 4), spSize = new Float32Array(SPN), SP = [];
    for (let i = 0; i < SPN; i++) SP.push({ life: 0 });
    const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 4)); spGeo.setAttribute('size', new THREE.BufferAttribute(spSize, 1));
    const GL = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    const spMat = new THREE.ShaderMaterial({ uniforms: { map: { value: GL }, scale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); vC.a *= smoothstep(4.0, 14.0, -mv.z); gl_PointSize = min(size * scale / max(1.0, -mv.z), 40.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }' });
    const spPts = new THREE.Points(spGeo, spMat); spPts.frustumCulled = false; spPts.renderOrder = 4; scene.add(spPts);
    let spCur = 0, spLive = 0;
    function sparkle(x, y, z, n, big) {
      for (let k = 0; k < n; k++) {
        const p = SP[spCur]; spCur = (spCur + 1) % SPN; const a = Math.random() * 6.28, v = (big ? 2.5 : 1.2) + Math.random() * (big ? 3 : 1.5), gold = Math.random() < 0.6;
        Object.assign(p, { x: x + Math.cos(a) * (big ? 1.5 : 0.6), y: y + Math.random() * (big ? 3 : 1.2), z: z + Math.sin(a) * (big ? 1.5 : 0.6), vx: Math.cos(a) * v * 0.4, vy: 1.2 + Math.random() * (big ? 3 : 1.5), vz: Math.sin(a) * v * 0.4,
          life: 1, max: (big ? 1.6 : 1.0) + Math.random() * 0.6, s: (big ? 1.6 : 0.9) + Math.random(), r: gold ? 1 : 0.7, g: gold ? 0.88 : 1, b: gold ? 0.5 : 0.95 });
        p.life = p.max;
      }
      spLive = 2.5;
    }

    // ---------------------------------------------------------------- per frame
    const U = () => ElderMap.uRest.value, RC = () => ElderMap.uRestC.value;
    const EDGE = () => (window.Story ? Story.C.EDGE : 26), NOISE = () => (window.Story ? Story.C.NOISE : 18);
    // the same edge wobble as the shader's restoreFS: a thing is "reached" when the colour has clearly passed it
    function reached(x, y, z) {
      const u = U(); if (u.w <= 0) return true;
      const c = RC(), dR = Math.hypot(x - c.x, z - c.y) + Math.max(0, y - c.z) * c.w;
      const nR = Math.sin(x * 0.043 + z * 0.029) * 0.55 + Math.sin(z * 0.067 - x * 0.051 + 1.7) * 0.3 + Math.sin((x + z) * 0.13) * 0.15;
      return dR - u.x - nR * NOISE() < -EDGE() * 0.35;
    }
    let first = true, lastR = -1, homeSig = '', homes = [], camX = 1e9, camZ = 1e9, winterK = -1, nightK = -1, wetK = -1;
    const api = { curios, K, stats: () => ({ curios: curios.length, awake: curios.filter(c => c.awake).length, flower: K.flower ? K.flower.items.length : 0, bench: K.bench.items.length, stone: K.stone.items.length, puddle: pud.items.length }) };
    // homes: built cottages -> a laundry line on one side, a pile of pup things on the other (side + which by hash of the plot)
    function syncHomes(S) {
      const ids = []; for (const k in S.plots) { const e = S.plots[k]; if (e.done && e.type === 'home') ids.push(k); }
      const sig = ids.join(','); if (sig === homeSig) return; homeSig = sig;
      for (const k of ['line', 'cloth', 'pile']) K[k].items = K[k].items.filter(it => ids.includes(String(it.pid)));
      for (const pid of ids) {
        if (K.line.items.some(it => String(it.pid) === pid)) continue;
        const x = plots.byPid[+pid]; if (!x) continue;
        const h = hsh(+pid * 613 + 9), side = h < 0.5 ? 1 : -1, cs = Math.cos(x.q.ry), sn = Math.sin(x.q.ry);
        const at = (lx, lz) => [x.c[0] + lx * cs + lz * sn, x.c[1] - lx * sn + lz * cs];
        const a = at(side * (x.w / 2 + 4.5), -x.d * 0.1), b = at(-side * (x.w / 2 + 3.2), x.d * 0.32);
        if (dry(a[0], a[1])) { const yaw = x.q.ry + Math.PI / 2; const l = item('line', a[0], a[1], yaw, 1.3, { pid: +pid }); item('cloth', a[0], a[1], yaw, 1.3, { pid: +pid, y: l.y }); }
        if (h > 0.18 && dry(b[0], b[1])) item('pile', b[0], b[1], x.q.ry + h * 3, 1.3, { pid: +pid });
      }
    }
    function write(k, camP, extraS) {
      if (!k) return; let j = 0; const T = k.items;
      for (const it of T) {
        if (it.shown <= 0) continue;
        if (k.cull && (it.x - camP.x) * (it.x - camP.x) + (it.z - camP.z) * (it.z - camP.z) > k.cull * k.cull) continue;
        if (j >= k.max) break;
        const pop = it.t < POP ? back(it.t / POP) : 1, s = it.s * pop * it.shown * (extraS ? extraS(it) : 1); if (s < 0.01) continue;
        Q.setFromAxisAngle(Y, it.yaw); if (it.swing) Q.multiply(new THREE.Quaternion().setFromAxisAngle(V.set(1, 0, 0), it.swing));
        V.set(it.x, it.y, it.z); SC.set(s * (it.sx || 1), s, s); k.m.setMatrixAt(j, M4.compose(V, Q, SC));
        if (k.m.instanceColor && it.tint) k.m.setColorAt(j, CO.setRGB(it.tint[0], it.tint[1], it.tint[2]));
        j++;
      }
      k.m.count = j; k.m.visible = j > 0; k.m.instanceMatrix.needsUpdate = true; if (k.m.instanceColor) k.m.instanceColor.needsUpdate = true;
      if (k.ink) { k.ink.count = j; k.ink.visible = j > 0; }
    }
    api.update = (S, t, dt, night, camera, seasonW, opt2) => {
      opt2 = opt2 || {};
      const u = U(), R = u.w > 0 ? u.x : 1e9, cp = camera.position, winter = seasonW ? seasonW[3] : 0;
      syncHomes(S);
      let any = false;
      const rMoved = Math.abs(R - lastR) > 0.4; if (rMoved) lastR = R;
      // 1. curiosities: wake when the colour reaches them
      for (const c of curios) {
        const on = reached(c.x, c.y + 1, c.z);
        if (on && !c.awake) { c.awake = true; c.wakeT = t; if (!first) { sparkle(c.x, c.y + 2, c.z, 26, true); if (opts.onWake) opts.onWake(c); } else c.wakeT = -99; any = true; }
        else if (!on && c.awake) { c.awake = false; any = true; }
      }
      // 2. props: pop in when reached (and their own rule: awake curiosity, built home), out when not
      for (const key in K) {
        const k = K[key]; if (!k) continue;
        for (const it of k.items) {
          const want = it.always ? true : it.curio ? it.curio.awake : (rMoved || first || it.shown < 0 ? reached(it.x, it.y, it.z) : it.shown > 0);
          if (want && it.shown <= 0) { it.shown = 1; it.t = first ? 99 : 0; any = true; if (!first && (key === 'bench' || key === 'pile' || key === 'line' || (key === 'flower' && hsh(Math.round(it.x * 3)) < 0.25))) sparkle(it.x, it.y + 1, it.z, key === 'flower' ? 3 : 6, false); }
          else if (!want && it.shown !== 0) { it.shown = 0; any = true; }
          if (it.t < POP) { it.t += dt; any = true; k.sig = ''; }
        }
      }
      first = false;
      if (any) rebuildWake();
      // 3. animation: swings sway (awake), cloth flutters gently, lamps lit only when awake
      for (const it of K.seat.items) { const c = it.hang; it.swing = c.awake ? Math.sin(t * 1.4 + c.x) * 0.28 * Math.min(1, (t - c.wakeT) / 3) : 0; }
      // 4. write the instance lists when something changed or the camera moved (distance culls)
      const camMoved = Math.abs(cp.x - camX) + Math.abs(cp.z - camZ) > 6; if (camMoved) { camX = cp.x; camZ = cp.z; }
      const wk = Math.round(winter * 20) / 20, nk = night > 0.45 ? 1 : 0, wet = opt2.wet || 0, wtk = Math.round(wet * 40) / 40;
      const seasonChanged = wk !== winterK || nk !== nightK; winterK = wk; nightK = nk;
      for (const key in K) {
        const k = K[key]; if (!k) continue;
        if (!(any || camMoved || seasonChanged || k.sig === '' || key === 'seat')) continue;
        k.sig = 'x';
        if (key === 'flower') write(k, cp, it => 1 - 0.85 * winter);
        else if (key === 'cloth') write(k, cp, () => (nk || winter > 0.5 ? 0 : 1));   // taken in at night (and in deep winter)
        else if (key === 'puddle') { if (wtk !== wetK || any || camMoved) write(k, cp); }
        else write(k, cp);
      }
      wetK = wtk;
      pudMat.opacity = 0.62 * wet * (1 - winter * 0.7) * (1 - night * 0.3); pud.m.visible = pud.m.count > 0 && wet > 0.01;
      // butterflies: by day, not in winter, around reached flowers
      const bk = (1 - sm(0.15, 0.5, night)) * (1 - winter) * (opt2.rain ? 0.2 : 1);
      if (any || rMoved) { for (let i = 0; i < bAnch.length; i++) bOn[i] = bAnch[i].shown > 0 ? 1 : 0; bGeo.attributes.on.needsUpdate = true; }
      BU.uT.value = t; BU.uK.value = bk; bPts.visible = bk > 0.01;
      const H = opt2.H || 864; BU.uScale.value = H / (2 * Math.tan(Math.PI / 180 * 20)); spMat.uniforms.scale.value = BU.uScale.value;
      // sparkles
      if (spLive > 0) {
        spLive -= dt;
        for (let i = 0; i < SPN; i++) { const p = SP[i]; if (p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy *= 1 - dt * 0.8; }
          const a = p.life > 0 ? Math.min(1, p.life / 0.5) * Math.min(1, (p.max - p.life) / 0.15) : 0;
          spPos[i * 3] = p.x || 0; spPos[i * 3 + 1] = p.y || 0; spPos[i * 3 + 2] = p.z || 0; spCol[i * 4] = p.r || 1; spCol[i * 4 + 1] = p.g || 1; spCol[i * 4 + 2] = p.b || 1; spCol[i * 4 + 3] = a; spSize[i] = p.life > 0 ? p.s : 0; }
        spGeo.attributes.position.needsUpdate = spGeo.attributes.color.needsUpdate = spGeo.attributes.size.needsUpdate = true; spPts.visible = true;
      } else spPts.visible = false;
    };
    // night light sources (DayNight pools + point lights): the awake lanterns
    const OM = new THREE.Matrix4();
    api.glowPieces = fn => { for (const c of curios) if (c.kind === 'lantern' && c.awake) { const a = c.yaw; const k = SCALE.lantern; fn('EG_Brazier', OM.makeScale(0.5, 0.5, 0.5).setPosition(c.x + Math.cos(a) * 2.05 * k, c.y + 5.3 * k - 3, c.z - Math.sin(a) * 2.05 * k), 'curio:' + Math.round(c.x) + ':' + Math.round(c.z)); } };
    api.sparkle = sparkle;
    api.NAMES = NAMES;
    // vibe 2 lane C (pup moments keep clear of things): anything placed with a footprint (houses, halls, trees, rocks, plots, decor /
    // ward / blight spots) + this module's own props (benches, laundry lines, pup piles, curiosities incl. sleeping ones)
    const PROP_R = { bench: 3.2, line: 3.5, cloth: 2, pile: 2.2, seat: 3 };
    api.blocked = (x, z, pad) => {
      pad = pad || 0; if (blocked(x, z, pad)) return true;
      for (const c of curios) if (dxz(x, z, c.x, c.z) < 4.5 * (SCALE[c.kind] || 1) + pad) return true;
      for (const k in PROP_R) { const L = K[k]; if (!L) continue; for (const it of L.items) if (Math.abs(it.x - x) < 12 && Math.abs(it.z - z) < 12 && dxz(x, z, it.x, it.z) < PROP_R[k] * (it.s || 1) + pad) return true; }
      return false;
    };
    return api;
  }
  window.WorldFx = WorldFx;
})();
