// LanternFx (Round 2 step 4): paper lanterns + the World Bloom on the horizon. Reads what the game gives it, owns no game state.
// - sky lanterns: received, unread lanterns float in the sky past the tree (positions from a hash of the id), bob + drift, glow at
//   night (body brightens + an additive halo), tap = read (pick)
// - release: one lantern rises from the plaza with a sway and drifts off into the sky (~14 s), fading at the end
// - the World Bloom: one giant glowing flower far beyond the island (stem, two leaves, two petal rings that open one by one with
//   the shared petal total, a core), in the colours of this week's bloom; 5 draw calls, unlit (fog: off, hazed by hand)
(function () {
  'use strict';
  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  const fr = (h, k) => ((Math.imul(h ^ (k * 0x9e3779b1), 2654435761) >>> 0) % 10007) / 10007;
  let haloTex = null;
  function halo() {
    if (haloTex) return haloTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); haloTex = new THREE.CanvasTexture(c); return haloTex;
  }
  // a paper lantern: lathe body (white, warm bottom) + dark caps, coloured by the material
  function lanternGeo() {
    const P = [[0.001, -1.12], [0.42, -1.12], [0.44, -1.0], [0.86, -0.78], [1.06, -0.25], [1.08, 0.2], [0.94, 0.72], [0.52, 1.0], [0.5, 1.12], [0.001, 1.12]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(P, 14), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), cap = Math.abs(y) > 0.97; const k = cap ? 0.3 : 0.82 + 0.18 * (1 - (y + 1) / 2); col[i * 3] = k; col[i * 3 + 1] = cap ? 0.22 : k * 0.96; col[i * 3 + 2] = cap ? 0.2 : k * 0.88; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
  }

  function LanternFx(scene, nav, o) {
    const TP = nav.TP, root = new THREE.Group(); root.name = 'lanterns'; scene.add(root);
    const GEO = lanternGeo(), SZ = o.phone ? 3.8 : 3.4;
    const home = Math.atan2(-140, -70);   // the home view looks this way (game.js homeView: eye = target + (70, .., 140))
    const items = new Map();   // id -> { g, mat, halo, base, ph, col }
    let night = 0, rel = null, t = 0;
    function make(colHex) {
      const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colHex), vertexColors: true, transparent: true });
      const body = new THREE.Mesh(GEO, mat); g.add(body);
      const hm = new THREE.SpriteMaterial({ map: halo(), color: new THREE.Color(colHex), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 });
      const h = new THREE.Sprite(hm); h.scale.set(7, 7, 1); g.add(h); g.scale.setScalar(SZ);
      return { g, mat, hm, col: new THREE.Color(colHex) };
    }
    function free(it) { root.remove(it.g); it.mat.dispose(); it.hm.dispose(); }
    // the unread lanterns in the sky: [{ id, c (colour hex) }]
    function setSky(list) {
      const want = new Set(list.map(x => x.id));
      for (const [id, it] of items) if (!want.has(id)) { free(it); items.delete(id); }
      for (const x of list) {
        if (items.has(x.id)) continue;
        const h = hash(x.id), it = make(x.c), sc = o.scale ? o.scale() : 0.5, a = home + Math.PI + (fr(h, 5) < 0.5 ? -1 : 1) * (0.08 + fr(h, 1) * 0.3), r = 38 + fr(h, 2) * 34, y = TP[1] + 22 + 52 * sc + fr(h, 3) * 18;   // floating over the plaza in front of the tree (seen from the home view, also on a portrait phone)
        it.base = [TP[0] + Math.cos(a) * r, y, TP[2] + Math.sin(a) * r]; it.ph = fr(h, 4) * 6.28; it.id = x.id; it.born = t;
        it.g.position.set(it.base[0], it.base[1] - 40, it.base[2]); root.add(it.g); items.set(x.id, it);
      }
    }
    function release(colHex, from) {
      if (rel) free(rel.it);
      const it = make(colHex); it.g.scale.setScalar(SZ * 0.55); root.add(it.g);
      const p = from || nav.door(0.6).p, ux = p[0] - TP[0], uz = p[2] - TP[2], ul = Math.hypot(ux, uz) || 1;
      rel = { it, p0: [p[0] + ux / ul * 10, p[1] + 5, p[2] + uz / ul * 10], dir: [ux / ul, uz / ul], t: 0, dur: 14 };
      return rel.p0;
    }
    const relPos = () => rel ? rel.it.g.position.toArray() : null;
    // ---- the World Bloom: a giant flower far out, on a bearing to the side of the home view
    const BD = 1300, ba = home + 0.34, BP = [TP[0] + Math.cos(ba) * BD, TP[1] - 150, TP[2] + Math.sin(ba) * BD];   // a little orbit / tilt up from the home view shows it
    const bloom = new THREE.Group(); bloom.position.set(BP[0], BP[1], BP[2]); bloom.rotation.y = -ba + Math.PI / 2; root.add(bloom);
    const STEM_H = 430, OUT = 11, INN = 7, NP = OUT + INN;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-10, -260, 4), new THREE.Vector3(0, -40, 0), new THREE.Vector3(18, 120, 6), new THREE.Vector3(-14, 280, -4), new THREE.Vector3(0, STEM_H, 0)]);
    const stemM = new THREE.MeshBasicMaterial({ color: 0x5fb86a, fog: false }), stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 9, 7, false), stemM); bloom.add(stem);
    const leafG = new THREE.SphereGeometry(1, 12, 6); leafG.translate(1, 0, 0);
    const leafM = new THREE.MeshBasicMaterial({ color: 0x6fca72, fog: false }), leaves = new THREE.InstancedMesh(leafG, leafM, 2); bloom.add(leaves);
    { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      [[200, 1, 0.35], [270, -1, -0.25]].forEach(([y, side, tw], i) => { e.set(0, side > 0 ? 0.3 : Math.PI - 0.3, side * 0.35 + tw); q.setFromEuler(e); m.compose(new THREE.Vector3(side * 6, y, 0), q, new THREE.Vector3(62, 8, 24)); leaves.setMatrixAt(i, m); }); }
    const petG = new THREE.SphereGeometry(1, 14, 8); petG.translate(1, 0, 0);
    { const pos = petG.attributes.position, col = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { const k = 0.72 + 0.28 * Math.min(1, pos.getX(i) / 1.6); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; } petG.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    const head = new THREE.Group(); head.position.y = STEM_H; bloom.add(head);   // the flower's face tilts toward the island
    { bloom.updateMatrixWorld(); const up = new THREE.Vector3(TP[0] - BP[0], 0, TP[2] - BP[2]).normalize().multiplyScalar(0.75).add(new THREE.Vector3(0, 1, 0)).normalize(); const qw = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up); head.quaternion.copy(bloom.quaternion.clone().invert().multiply(qw)); }
    const petM = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), pets = new THREE.InstancedMesh(petG, petM, NP); head.add(pets);
    pets.setColorAt(0, new THREE.Color(1, 1, 1));
    const coreM = new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false }), core = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 10), coreM); core.scale.y = 0.6; core.position.y = 8; head.add(core);
    const bhM = new THREE.SpriteMaterial({ map: halo(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.2, fog: false });
    const bh = new THREE.Sprite(bhM); bh.scale.set(560, 560, 1); bh.position.y = 10; head.add(bh);
    let B = { col: new THREE.Color('#ffb3d0'), core: new THREE.Color('#fff1a8'), open: 0, shown: 0, kind: null };
    function setBloom(kind, open) { B.col.set(kind.col); B.core.set(kind.core); B.open = Math.max(0, Math.min(1, open)); B.kind = kind.k; bloom.visible = true; }
    // it rises out of a sea of clouds (soft puffs hide where the stem goes down into the haze): ONE Points draw
    const cloudN = 9, cg = new THREE.BufferGeometry(), cp = new Float32Array(cloudN * 3);
    for (let i = 0; i < cloudN; i++) { const a = i / cloudN * 6.283 + 0.4, r = i % 3 === 0 ? 30 : 110 + (i * 37) % 90; cp[i * 3] = Math.cos(a) * r; cp[i * 3 + 1] = -150 + (i * 53) % 70; cp[i * 3 + 2] = Math.sin(a) * r * 0.6; }
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    const cloudM = new THREE.PointsMaterial({ map: halo(), size: 330, sizeAttenuation: true, transparent: true, depthWrite: false, fog: false, opacity: 0.95, color: 0xc3dcf7 }), clouds = new THREE.Points(cg, cloudM); bloom.add(clouds);
    bloom.visible = false;
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(), c4 = new THREE.Color();
    function bloomTick(dt, fogC) {
      B.shown += (B.open - B.shown) * Math.min(1, dt * 0.8);
      const haze = 0.42 * (1 - night) + 0.12, sway = Math.sin(t * 0.25) * 0.02;
      for (let i = 0; i < NP; i++) {
        const outer = i < OUT, n = outer ? OUT : INN, j = outer ? i : i - OUT, a = (j + (outer ? 0 : 0.5)) / n * Math.PI * 2;
        const k = Math.max(0, Math.min(1, B.shown * NP - (outer ? j * 1.0 : OUT + j))), op = 0.15 + 0.85 * k;   // petals open one by one
        const tilt = (outer ? 1.25 : 1.45) - op * (outer ? 1.15 : 0.9) + sway;
        e4.set(0, -a, tilt, 'YXZ'); q4.setFromEuler(e4); v4.set(0, outer ? 0 : 6, 0);
        const L = outer ? 120 : 82; s4.set(L * (0.75 + 0.25 * op), outer ? 12 : 11, outer ? 52 : 40); m4.compose(v4, q4, s4); pets.setMatrixAt(i, m4);
        c4.copy(outer ? B.col : B.col.clone().lerp(B.core, 0.35)).multiplyScalar(0.55 + 0.45 * op + 0.2 * night).lerp(fogC, haze); pets.setColorAt(i, c4);
      }
      pets.instanceMatrix.needsUpdate = true; if (pets.instanceColor) pets.instanceColor.needsUpdate = true;
      coreM.color.copy(B.core).multiplyScalar(0.8 + 0.4 * night).lerp(fogC, haze * 0.6);
      stemM.color.set(0x5fb86a).multiplyScalar(0.7 + 0.2 * (1 - night)).lerp(fogC, haze); leafM.color.set(0x6fca72).multiplyScalar(0.7 + 0.2 * (1 - night)).lerp(fogC, haze);
      cloudM.color.copy(fogC).lerp(new THREE.Color(1, 1, 1), 0.25 * (1 - night)); cloudM.opacity = 0.9 + 0.1 * night;
      bhM.color.copy(B.col).lerp(B.core, 0.4); bhM.opacity = 0.06 + 0.32 * night * (0.4 + 0.6 * B.shown);
    }
    function update(dt, n, fogC) {
      t += dt; night = n;
      const glow = 0.62 + 0.3 * night;
      for (const it of items.values()) {
        const a = (t - it.born), up = Math.min(1, a / 6), e = up * up * (3 - 2 * up), b = it.base;
        it.g.position.set(b[0] + Math.sin(t * 0.13 + it.ph) * 6, b[1] - 40 * (1 - e) + Math.sin(t * 0.7 + it.ph) * 1.6, b[2] + Math.cos(t * 0.11 + it.ph) * 6);
        it.g.rotation.z = Math.sin(t * 0.9 + it.ph) * 0.08;
        it.mat.color.copy(it.col).multiplyScalar(glow + 0.12);
        it.hm.opacity = (0.14 + 0.7 * night) * (0.85 + 0.15 * Math.sin(t * 2.1 + it.ph));
      }
      if (rel) {
        rel.t += dt; const k = rel.t / rel.dur, it = rel.it, p = rel.p0, rise = 2.2 * rel.t + 1.2 * rel.t * rel.t;
        it.g.position.set(p[0] + rel.dir[0] * rel.t * 7 + Math.sin(rel.t * 1.3) * 2.5, p[1] + rise, p[2] + rel.dir[1] * rel.t * 7 + Math.cos(rel.t * 1.1) * 2.5);
        it.g.rotation.z = Math.sin(rel.t * 1.7) * 0.12; it.g.scale.setScalar(SZ * (0.55 + 0.45 * Math.min(1, rel.t / 3)));
        it.mat.color.copy(it.col).multiplyScalar(glow + 0.12);
        const fade = k > 0.8 ? Math.max(0, 1 - (k - 0.8) / 0.2) : 1; it.mat.opacity = fade; it.hm.opacity = (0.3 + 0.7 * night) * fade;
        if (k >= 1) { free(it); rel = null; }
      }
      if (bloom.visible) bloomTick(dt, fogC || new THREE.Color(0xc3dcf7));
    }
    // tap: the nearest sky lantern within r px (screen space), or 'bloom' for the giant flower's head
    function pick(mx, my, camera, W, H, r) {
      let best = null, bd = r; const v = new THREE.Vector3();
      for (const it of items.values()) { v.copy(it.g.position).project(camera); if (v.z > 1) continue; const d = Math.hypot((v.x + 1) / 2 * W - mx, (1 - v.y) / 2 * H - my); if (d < bd) { bd = d; best = it.id; } }
      if (best) return best;
      if (bloom.visible) { v.set(0, 0, 0).applyMatrix4(head.matrixWorld).project(camera); if (v.z <= 1 && Math.hypot((v.x + 1) / 2 * W - mx, (1 - v.y) / 2 * H - my) < r * 2.2) return 'bloom'; }
      return null;
    }
    const posOf = id => { const it = items.get(id); return it ? it.g.position.toArray() : null; };
    const bloomPos = () => { bloom.updateMatrixWorld(); return new THREE.Vector3(0, 0, 0).applyMatrix4(head.matrixWorld).toArray(); };
    return { root, setSky, release, relPos, setBloom, update, pick, posOf, bloomPos, get count() { return items.size; }, get releasing() { return !!rel; }, bloom };
  }
  window.LanternFx = LanternFx;
})();
