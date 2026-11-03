// Elder rings on the tree (roadmap update 3, 2026-11-03; VIEW only, owns no game state). One band of soft light round the
// trunk per ring (up to SLOTS bands, low to high along the bark; past that they burn brighter and their colours slowly turn),
// hugging the grown wood (TreeFx.woodR: the real trunk shape by height + direction), with light flowing round them. A new ring
// = its band draws itself round the trunk (`celebrate(n)`) + the tree's burst. The tree's own glow steps up with the rings
// (TreeFx `ringK`, read in tree_fx update). ONE draw call (one merged ribbon geometry, additive, rebuilt only when the band
// count or the tree's shape changes).
(function () {
  'use strict';
  const SLOTS = 10, SEG = 64, HW = 1.3;   // bands, points round each band, half the band's height (m)
  const VS = `attribute vec3 aB; varying vec3 vB; varying float vY;
void main() { vB = aB; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  // aB = (band index, u round the trunk 0..1, v across the band 0..1)
  const FS = `uniform float uN; uniform float uT; uniform float uNew; uniform float uDraw; uniform float uGlow; uniform vec3 uA; uniform vec3 uB; varying vec3 vB;
void main() {
  float k = vB.x; if (k > uN - 0.5) discard;
  float u = vB.y, v = vB.z;
  float across = pow(sin(3.14159 * v), 1.6);
  float flow = 0.55 + 0.45 * sin(6.2832 * (u * 3.0 - uT * 0.05 * (1.0 + mod(k, 3.0) * 0.35)) + k * 1.7);
  float spark = smoothstep(0.93, 1.0, sin(6.2832 * (u * 7.0 + uT * 0.08) + k * 2.3));
  float isNew = step(abs(k - uNew), 0.1);
  float drawn = mix(1.0, smoothstep(uDraw, uDraw - 0.04, u), isNew);   // the newest band draws itself round the trunk
  float head = isNew * smoothstep(0.06, 0.0, abs(u - uDraw)) * step(uDraw, 0.999) * 2.0;
  vec3 col = mix(uA, uB, 0.5 + 0.5 * sin(k * 1.3 + uT * 0.02));
  float a = across * (0.5 + 0.35 * flow + 0.8 * spark) * drawn * uGlow + head * across;
  gl_FragColor = vec4(col * a, a);
}`;

  function RingFx(scene, fx, nav) {
    const TP = nav.TP;
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uN: { value: 0 }, uT: { value: 0 }, uNew: { value: -1 }, uDraw: { value: 1 }, uGlow: { value: 0.8 }, uA: { value: new THREE.Color(1, 0.78, 0.38) }, uB: { value: new THREE.Color(0.55, 0.95, 1) } } });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false; scene.add(mesh);
    let key = '', shown = 0, cel = null, chk = 0;
    // the band heights: SLOTS slots spread up the clean trunk above the root flare (30 % .. 95 % of the way to the canopy's underside)
    function slotY(k) { const cp = fx.canopy(), y0 = TP[1] + (cp.y0 - TP[1]) * 0.3, y1 = TP[1] + (cp.y0 - TP[1]) * 0.95; return y0 + (k + 0.5) / SLOTS * (y1 - y0); }
    function build(n) {
      const nb = Math.min(SLOTS, n), P = [], B = [], I = [];
      for (let k = 0; k < nb; k++) {
        const y = slotY(k), r = [];
        for (let i = 0; i < SEG; i++) { const a = i / SEG * Math.PI * 2; r.push(fx.woodR(TP[0] + Math.cos(a) * 5, y, TP[2] + Math.sin(a) * 5) || 20 * fx.scale); }
        const rs = r.map((_, i) => Math.max(r[(i + SEG - 1) % SEG], r[i], r[(i + 1) % SEG]) + 1.2);   // never inside the bark between samples
        const o = P.length / 3;
        for (let i = 0; i <= SEG; i++) {
          const a = i / SEG * Math.PI * 2, R = rs[i % SEG], x = TP[0] + Math.cos(a) * R, z = TP[2] + Math.sin(a) * R, w = Math.sin(i * 0.7 + k) * 0.35;   // a gentle wave in the band
          P.push(x, y - HW + w, z, x, y + HW + w, z); B.push(k, i / SEG, 0, k, i / SEG, 1);
          if (i < SEG) { const q = o + i * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3)); g.setIndex(I);
      mesh.geometry.dispose(); mesh.geometry = g;
    }
    const api = {
      mesh,
      // rings = how many to show; night 0..1; t = seconds
      update(t, dt, rings, night) {
        rings = Math.max(0, rings | 0); mesh.visible = rings > 0;
        fx.ringK = Math.min(1, rings / 15);   // the tree's own glow steps up with the rings (tree_fx)
        if (!rings) return;
        chk -= dt;
        if (chk <= 0) { chk = 2; const k = Math.min(SLOTS, rings) + ':' + fx.scale.toFixed(3) + ':' + fx.growth.toFixed(2); if (k !== key && !fx.growing) { key = k; build(rings); } }
        const U = mat.uniforms; U.uT.value = t; U.uN.value = Math.min(SLOTS, rings);
        // brighter at night, and brighter past the last slot (every 4 rings a step), max x1.8
        U.uGlow.value = (0.7 + 0.6 * night) * Math.min(1.8, 1 + Math.max(0, rings - SLOTS) / 4 * 0.1) * (0.8 + 0.2 * Math.sin(t * 0.8));
        if (cel) { cel.t += dt; U.uNew.value = cel.k; U.uDraw.value = Math.min(1, cel.t / cel.dur); if (cel.t > cel.dur + 1) { cel = null; U.uNew.value = -1; U.uDraw.value = 1; } }
        shown = rings;
      },
      // ring n reached while watching: its band draws itself round the trunk (past the slots: the top band redraws)
      celebrate(n) { key = ''; chk = 0; cel = { k: Math.min(SLOTS, n) - 1, t: 0, dur: 3.2 }; if (fx.burst) fx.burst(); },
      get shown() { return shown; }, slotY, SLOTS,
    };
    return api;
  }
  window.RingFx = RingFx;
})();
