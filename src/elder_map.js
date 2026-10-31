// ElderMap: draws the Elderglow Forest from DATA (Asset Library: glb/elderglow_layout.json + the kit GLBs + the terrain
// GLB) with one THREE.InstancedMesh per kit piece instead of the baked 11k-mesh elderglow_map.glb. three.js r128.
//
// How a kit piece becomes a batch: every mesh primitive of the piece (root + children, pre-transformed into the piece's
// space) is merged into ONE geometry with the flat material colour as a vertex colour, so a whole treehouse is one draw
// call. Glow* primitives are flagged per vertex (`unlit`) and drawn unlit by the same toon shader; Water*/Glass* go to
// small see-through batches per material. Canopy children (`*_canopy*`) keep their pivot per vertex (`swayP`, `swayW`)
// and sway in the vertex shader (uTime), also inside instances and in the ink hulls. Children that some placement hides
// or rescales (the trees on the floating isles) are split into their own instanced batches.
// Ink outlines = back-face hulls sharing the batch's instance buffer (instances drawn first are the ones big enough on
// screen to get ink). Per frame (when the camera moved): per instance role filter, frustum test and a screen-size cull
// (smaller than ~1 px radius = not drawn; < 3 px = no ink), so far flowers/decor cost nothing.
(function () {
  'use strict';
  const GLOW = /^Glow/, SEE = /^(Water|Glass)/;
  const sanitize = n => THREE.PropertyBinding.sanitizeNodeName(n || '');

  // ---- shared materials (same look as the library's viewer.html)
  const grad = (() => { const d = new Uint8Array([90, 170, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
  const uTime = { value: 0 };
  // ground cover (role 'cover', placement.sub) is drawn only this close to the camera (m), x api.cull.coverK
  const COVER_D = { grass: 75, flower: 80, clover: 65, pebbles: 55, mushroom: 65, fern: 95, tallgrass: 95, stump: 140 };
  const SWAY_VS = `
    if (swayW > 0.0) {
      vec3 ip = vec3(0.0);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
      #endif
      float ph = dot(swayP + ip, vec3(0.131, 0.071, 0.113));
      float az = sin(uTime * 0.6 + ph) * 0.012, ax = cos(uTime * 0.47 + ph) * 0.01;
      vec3 q = transformed - swayP;
      q = vec3(q.x * cos(az) - q.y * sin(az), q.x * sin(az) + q.y * cos(az), q.z);
      q = vec3(q.x, q.y * cos(ax) - q.z * sin(ax), q.y * sin(ax) + q.z * cos(ax));
      transformed = swayP + q;
    }`;
  const SWAY_DECL = 'attribute vec3 swayP;\nattribute float swayW;\nuniform float uTime;\n';
  const litMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, vertexColors: true });
  // Night (game: uNight 0 day .. 1 night): Glow* parts get brighter and fog less; GlowWindow parts (unlit = 2) turn from
  // their daytime cyan to a warm lamp-lit gold, as if the pups lit their lamps.
  const uNight = { value: 0 }, uGrade = { value: new THREE.Vector4(1, 1, 1, 0) }, uGradeDark = { value: 0.2 };
  const GLOW_FS = `
    gU = min(vUnlit, 1.0); float gW = step(1.5, vUnlit), gN = max(uNight, gW * uCozy);   // winter: windows lit warm from dusk
    vec3 gC = mix(diffuseColor.rgb, vec3(1.0, 0.7, 0.36), gW * gN * 0.85) * (1.0 + gN * 0.35);
    gC /= max(1.0, max(gC.r, max(gC.g, gC.b)));   // brighter but never blown to white: keep the hue
    outgoingLight = mix(outgoingLight, gC, gU * max(gN, uDayGlow));
    gl_FragColor = vec4( outgoingLight, diffuseColor.a );`;
  // r128's toon shader has no <output_fragment> chunk (the old '#include <output_fragment>' replace never matched, so
  // Glow* parts were drawn LIT by day in everything shipped so far); GLOW_FS replaces r128's output line. By day the
  // shipped look is kept (uDayGlow 0 = lit glow); at night glow goes unlit + brighter. uDayGlow 1 = viewer-like unlit glow.
  const OUT_R128 = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );', uDayGlow = { value: 0 };
  // colour grade of the ALBEDO of lit parts (game sets it: rosy dawn, warm dusk, moonlit blue-violet night); graded before
  // lighting, so warm lamp light on a graded wall still reads warm
  // step 5 seasons (game: uSeason = weights spring, summer, autumn, winter; uCozy = winter windows lit warm early):
  // tints of the lit albedo, before the grade. Canopy (swaying parts): spring pink blossom patches, summer deeper green,
  // autumn orange / red / gold patches; green ground + grass turn golden in autumn; winter = snow on up-facing surfaces
  // (ground, roofs, canopy tops; patchy) + a cold, paler world. No new models.
  const uSeason = { value: new THREE.Vector4(0, 0, 0, 0) }, uCozy = { value: 0 };
  const SEA_VS = `
    { vec3 nS = objectNormal; vec4 pS = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        nS = mat3(instanceMatrix) * nS; pS = instanceMatrix * pS;
      #endif
      vSeaUp = normalize(mat3(modelMatrix) * nS).y; vSeaWP = (modelMatrix * pS).xyz; vSeaLeaf = swayW;
      vec3 ipS = vec3(0.0);
      #ifdef USE_INSTANCING
        ipS = instanceMatrix[3].xyz;
      #endif
      vSeaSeed = fract(sin(dot(swayP * 1.37 + ipS, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`;   // one value per canopy puff
  const SEA_DECL_V = 'varying float vSeaUp;\nvarying vec3 vSeaWP;\nvarying float vSeaLeaf;\nvarying float vSeaSeed;\n';
  const SEA_FS = `
    if (vUnlit < 0.5 && dot(uSeason, vec4(1.0)) > 0.001) {
      vec3 c = diffuseColor.rgb; float sl = dot(c, vec3(0.3, 0.59, 0.11));
      float nz = 0.5 + 0.25 * (sin(vSeaWP.x * 0.23 + vSeaWP.y * 0.11) + sin(vSeaWP.z * 0.19 - vSeaWP.x * 0.07));
      float nz2 = fract(sin(dot(floor(vSeaWP * 0.18), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float green = clamp((c.g - max(c.r, c.b)) * 5.0, 0.0, 1.0);
      if (vSeaLeaf > 0.5) {
        vec3 pink = mix(vec3(1.0, 0.56, 0.74), vec3(1.0, 0.76, 0.86), vSeaSeed) * (0.6 + sl * 0.6);
        c = mix(c, pink, uSeason.x * (vSeaSeed < 0.62 ? 0.9 : 0.35 * smoothstep(0.45, 0.6, nz)));   // most puffs in blossom
        c = mix(c, c * vec3(0.82, 1.06, 0.8), uSeason.y);
        float na = vSeaSeed * 0.85 + nz * 0.15;
        vec3 au = mix(mix(vec3(0.97, 0.47, 0.13), vec3(0.85, 0.22, 0.15), smoothstep(0.32, 0.46, na)), vec3(1.0, 0.72, 0.2), smoothstep(0.56, 0.7, na));
        c = mix(c, au * (0.55 + sl * 0.9), uSeason.z * 0.88);
      } else {
        c = mix(c, mix(c, vec3(0.74, 0.6, 0.26) * (0.55 + sl * 0.8), 0.42), uSeason.z * green);
        c = mix(c, c * vec3(0.92, 1.07, 0.9), uSeason.y * green);
        c = mix(c, c * vec3(0.96, 1.06, 0.92), uSeason.x * green);   // spring: fresh green grass
      }
      c = mix(c, mix(vec3(sl), c, 0.6) * vec3(0.94, 0.97, 1.05), uSeason.w * 0.6);
      float snow = uSeason.w * smoothstep(0.4, 0.82, vSeaUp) * clamp(0.55 + 0.6 * nz, 0.0, 1.0);
      c = mix(c, vec3(0.93, 0.96, 1.0), snow);
      diffuseColor.rgb = c;
    }`;
  // Round 2 step 2 (colour restoring, src/story.js): albedo outside the restored radius is a soft misty grey. uRest = (radius m,
  // soft edge half-width m, edge wobble m, strength: 0 = full colour = exactly the shipped look); uRestC = (tree x, z, y0, yk:
  // height above y0 counts yk x, so the sky isles come last); uRestWave 0..1 = a warm glow band riding the edge during a
  // colour wave. One uniform set for every map batch (+ water / glass); the tree + orbs (makeTintMat) never grey.
  const uRest = { value: new THREE.Vector4(1e4, 26, 18, 0) }, uRestC = { value: new THREE.Vector4(0, 0, 30, 2) }, uRestWave = { value: 0 };
  const REST_DECL = 'uniform vec4 uRest;\nuniform vec4 uRestC;\nuniform float uRestWave;\n';
  const restoreFS = (wp, unlitK) => `
    #ifndef EG_NORESTORE
    if (uRest.w > 0.0) {
      vec3 wR = ${wp};
      float dR = length(wR.xz - uRestC.xy) + max(0.0, wR.y - uRestC.z) * uRestC.w;
      float nR = sin(wR.x * 0.043 + wR.z * 0.029) * 0.55 + sin(wR.z * 0.067 - wR.x * 0.051 + 1.7) * 0.3 + sin((wR.x + wR.z) * 0.13) * 0.15;
      float eR = dR - uRest.x - nR * uRest.z;
      float gR = smoothstep(-uRest.y, uRest.y, eR) * uRest.w;
      vec3 cR = diffuseColor.rgb; float lR = dot(cR, vec3(0.3, 0.59, 0.11));
      vec3 greyR = mix(vec3(lR), vec3(0.42), 0.4) * vec3(0.9, 0.9, 0.97);   // flat, muted, a little cool (not snow-white)
      float rimR = uRestWave * exp(-eR * eR / (uRest.y * uRest.y * 1.4));
      diffuseColor.rgb = mix(cR, greyR, gR * ${unlitK}) + rimR * vec3(1.0, 0.8, 0.42) * 0.4;
    }
    #endif`;
  const GRADE_FS = `#include <color_fragment>
    ${SEA_FS}
    ${restoreFS('vSeaWP', '(vUnlit > 0.5 ? 0.75 : 1.0)')}
    if (vUnlit < 0.5) { float aL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, aL * uGrade.rgb, uGrade.a) * (1.0 - uGradeDark * uNight); }`;
  const GLOW_FOG = 'vec3 preFog = gl_FragColor.rgb;\n#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, preFog, gU * uNight * 0.6);';
  const glowUniforms = s => { s.uniforms.uRest = uRest; s.uniforms.uRestC = uRestC; s.uniforms.uRestWave = uRestWave; s.uniforms.uNight = uNight; s.uniforms.uGrade = uGrade; s.uniforms.uGradeDark = uGradeDark; s.uniforms.uDayGlow = uDayGlow; s.uniforms.uSeason = uSeason; s.uniforms.uCozy = uCozy; };
  const GLOW_DECL = REST_DECL + 'uniform float uNight;\nuniform vec4 uGrade;\nuniform float uGradeDark;\nuniform float uDayGlow;\nuniform vec4 uSeason;\nuniform float uCozy;\nvarying float vSeaUp;\nvarying vec3 vSeaWP;\nvarying float vSeaLeaf;\nvarying float vSeaSeed;\nfloat gU = 0.0;\n';
  litMat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime; glowUniforms(s);
    s.vertexShader = SWAY_DECL + SEA_DECL_V + 'attribute float unlit;\nvarying float vUnlit;\n' + s.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUnlit = unlit;' + SWAY_VS + SEA_VS);
    // Glow*: unlit = the plain colour (what MeshBasicMaterial gives in the viewer); fog still applies after this
    s.fragmentShader = 'varying float vUnlit;\n' + GLOW_DECL + s.fragmentShader
      .replace('#include <color_fragment>', GRADE_FS).replace(OUT_R128, GLOW_FS).replace('#include <fog_fragment>', GLOW_FOG);
  };
  // Ink hull, pushed out in WORLD space after the instance matrix (so instance scale doesn't scale it): width = INK.px
  // screen pixels at that distance (uPxW = world size of one pixel per metre of distance), capped at INK.max metres.
  const INK = { px: { value: 2.0 }, pxW: { value: 0.001 }, max: { value: 0.35 }, min: { value: 0.012 } };
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x2a1a22, side: THREE.BackSide });
  inkMat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime; s.uniforms.uInkPx = INK.px; s.uniforms.uPxW = INK.pxW; s.uniforms.uInkMax = INK.max; s.uniforms.uInkMin = INK.min;
    s.vertexShader = SWAY_DECL + 'uniform float uInkPx;\nuniform float uPxW;\nuniform float uInkMax;\nuniform float uInkMin;\n' + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${SWAY_VS}`)
      .replace('#include <project_vertex>', `
      vec4 wpI = vec4(transformed, 1.0);
      vec3 nI = normal;
      #ifdef USE_INSTANCING
        wpI = instanceMatrix * wpI; nI = mat3(instanceMatrix) * nI;
      #endif
      wpI = modelMatrix * wpI; nI = normalize(mat3(modelMatrix) * nI);
      wpI.xyz += nI * clamp(uInkPx * uPxW * length(wpI.xyz - cameraPosition), uInkMin, uInkMax);
      vec4 mvPosition = viewMatrix * wpI;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  const seeCache = {};
  function seeMat(m) {   // Water* / Glass*: as in viewer.html
    if (seeCache[m.name]) return seeCache[m.name];
    const water = m.name.startsWith('Water');
    const sm = new THREE.MeshToonMaterial({ color: m.color.clone(), gradientMap: grad, transparent: true,
      opacity: m.opacity < 1 ? m.opacity : (water ? 0.8 : 0.35), depthWrite: false });
    sm.onBeforeCompile = s => {   // Round 2 step 2: rivers / lake / glass grey outside the restored radius too
      s.uniforms.uRest = uRest; s.uniforms.uRestC = uRestC; s.uniforms.uRestWave = uRestWave;
      s.vertexShader = 'varying vec3 vRestWP;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 pR = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            pR = instanceMatrix * pR;
          #endif
          vRestWP = (modelMatrix * pR).xyz; }`);
      s.fragmentShader = 'varying vec3 vRestWP;\n' + REST_DECL + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + restoreFS('vRestWP', '0.82'));
    };
    return (seeCache[m.name] = sm);
  }

  // ---- geometry merge
  function Builder(ink) { this.pos = []; this.nrm = []; this.col = []; this.unl = []; this.sp = []; this.sw = []; this.idx = []; this.n = 0; this.ink = ink; }
  const _v = new THREE.Vector3(), _nm = new THREE.Matrix3();
  Builder.prototype.add = function (geo, mat4, color, unlit, pivot) {
    const P = geo.attributes.position, N = geo.attributes.normal, base = this.n;
    _nm.getNormalMatrix(mat4);
    for (let i = 0; i < P.count; i++) {
      _v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(mat4); this.pos.push(_v.x, _v.y, _v.z);
      if (N) _v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_nm).normalize(); else _v.set(0, 1, 0);   // normalize = scale-free (quantized normals)
      this.nrm.push(_v.x, _v.y, _v.z);
      if (!this.ink) { this.col.push(color.r, color.g, color.b); this.unl.push(unlit); }
      if (pivot) { this.sp.push(pivot.x, pivot.y, pivot.z); this.sw.push(1); } else { this.sp.push(0, 0, 0); this.sw.push(0); }
    }
    const I = geo.index;
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    this.n += P.count;
  };
  Builder.prototype.build = function () {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (!this.ink) { g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('unlit', new THREE.Float32BufferAttribute(this.unl, 1)); }
    g.setAttribute('swayP', new THREE.Float32BufferAttribute(this.sp, 3));
    g.setAttribute('swayW', new THREE.Float32BufferAttribute(this.sw, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };

  // one batch = the merged geometry of a piece (or a split child) + its instances
  function makeBatch(key, rootObj, skip, noInk) {
    rootObj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rootObj.matrixWorld).invert();
    const lit = new Builder(false), ink = new Builder(true), see = {}, glow = {}; let tris = 0;
    const meshes = []; rootObj.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      if (skip && skip(m)) continue;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      let pv = null;   // canopy pivot: the nearest ancestor (or self) named *_canopy*, in batch space
      for (let a = m; a && a !== rootObj; a = a.parent) if (a.name.includes('_canopy')) { pv = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, a.matrixWorld)); break; }
      const mat = m.material; const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (SEE.test(mat.name)) { (see[mat.name] = see[mat.name] || { b: new Builder(false), m: mat }).b.add(g, rel, mat.color, 0, null); continue; }
      lit.add(g, rel, mat.color, GLOW.test(mat.name) ? (/^GlowWindow/.test(mat.name) ? 2 : 1) : 0, pv);
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (GLOW.test(mat.name)) {   // light-source info per glow class (game: night light pools / point lights)
        const cls = /^GlowWindow/.test(mat.name) ? 'win' : /^Glow(Warm|Skyhole)/.test(mat.name) ? 'warm' : 'cool', n = g.attributes.position.count;
        const a = glow[cls] || (glow[cls] = { p: new THREE.Vector3(), n: 0, col: new THREE.Color(0, 0, 0), r: 0, parts: [] });
        const c = g.boundingSphere.center.clone().applyMatrix4(rel);
        a.p.addScaledVector(c, n); a.n += n; a.col.r += mat.color.r * n; a.col.g += mat.color.g * n; a.col.b += mat.color.b * n;
        a.parts.push({ c, r: g.boundingSphere.radius * new THREE.Vector3().setFromMatrixScale(rel).x });
      }
      const ws = new THREE.Vector3().setFromMatrixScale(rel).x;
      if (!noInk && g.boundingSphere.radius * ws > 0.6) ink.add(g, rel, null, 0, pv);   // viewer.html rule: tiny parts get no hull
    }
    for (const k in glow) {   // centroid + mean colour + spread (piece space)
      const a = glow[k]; a.p.multiplyScalar(1 / a.n); a.col.r /= a.n; a.col.g /= a.n; a.col.b /= a.n;
      a.r = a.parts.reduce((m, q) => Math.max(m, q.c.distanceTo(a.p) + q.r), 0); delete a.parts;
    }
    const b = { key, geo: lit.build(), ink: ink.build(), see: [], inst: [], tris, glow };
    for (const k in see) { const g = see[k].b.build(); if (g) b.see.push({ geo: g, mat: seeMat(see[k].m) }); }
    const bs = b.geo ? b.geo.boundingSphere : (b.see[0] && b.see[0].geo.boundingSphere);
    b.center = bs ? bs.center.clone() : new THREE.Vector3(); b.radius = bs ? bs.radius : 0;
    b.box = b.geo ? b.geo.boundingBox.clone() : (b.see[0] ? (b.see[0].geo.computeBoundingBox(), b.see[0].geo.boundingBox.clone()) : new THREE.Box3());
    return b;
  }

  function loadGLB(loader, url) { return new Promise((res, rej) => loader.load(url, res, undefined, rej)); }
  async function loadJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); }

  // ---- the map
  async function load(opt) {
    const base = opt.base, scene = opt.scene, log = opt.log || (() => {});
    const t0 = performance.now();
    const loader = new THREE.GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const L = await loadJSON(base + 'elderglow_layout.json'); log('layout: ' + L.placements.length + ' placements');
    const files = Object.keys(L.kits); if (!files.includes('elderglow_terrain')) files.push('elderglow_terrain');
    const gl = {}; await Promise.all(files.map(f => loadGLB(loader, base + f + '.glb').then(g => { gl[f] = g; log('loaded ' + f); })));
    const tLoaded = performance.now();
    // piece name -> root object in its kit GLB
    const roots = {};
    for (const f of files) for (const o of gl[f].scene.children) roots[o.name] = o;
    // children that some placement hides/rescales -> split into their own batches
    const split = {};
    for (const p of L.placements) for (const n of [...(p.hide || []), ...Object.keys(p.childScale || {})]) (split[p.piece] = split[p.piece] || new Set()).add(sanitize(n));
    const batches = {}, missing = new Set(), missingKids = new Set(), noInk = new Set(L.noInk || []);
    const bodyOf = name => {
      if (batches[name] !== undefined) return batches[name];
      const r = roots[name]; if (!r) { missing.add(name); return (batches[name] = null); }
      const sp = split[name];
      const skip = sp ? m => { for (let a = m; a && a !== r; a = a.parent) if (a.parent === r && sp.has(a.name)) return true; return false; } : null;
      return (batches[name] = makeBatch(name, r, skip, noInk.has(name)));
    };
    const childBatch = (c, pieceNoInk) => {   // keyed by the geometry it draws, so the same isle tree mesh on 6 isles is one batch
      const gs = []; c.traverse(o => { if (o.isMesh) gs.push(o.geometry.uuid); });
      const key = 'child:' + gs.sort().join(',');
      return batches[key] || (batches[key] = makeBatch(key, c, null, pieceNoInk));
    };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), T = new THREE.Vector3();
    const addInst = (b, m, role, pid, md) => {
      if (!b) return;
      const c = b.center.clone().applyMatrix4(m); const r = b.radius * new THREE.Vector3().setFromMatrixScale(m).x;
      b.inst.push({ m: m.clone(), c, r, role, pid, md: md || 0 });
    };
    for (const p of L.placements) {
      const b = bodyOf(p.piece); if (b === null) continue;
      T.fromArray(p.pos); Q.setFromAxisAngle(Y, p.ry); S.setScalar(p.s); M.compose(T, Q, S);
      addInst(b, M, p.role, p.id, p.role === 'cover' ? (COVER_D[p.sub] || 80) : 0);
      const sp = split[p.piece]; if (!sp) continue;
      const hide = new Set((p.hide || []).map(sanitize)), cs = {}; for (const k in (p.childScale || {})) cs[sanitize(k)] = p.childScale[k];
      for (const c of roots[p.piece].children) {
        if (!sp.has(c.name) || hide.has(c.name)) continue;
        const loc = new THREE.Matrix4().compose(c.position, c.quaternion, c.scale.clone().multiplyScalar(cs[c.name] || 1));
        addInst(childBatch(c, noInk.has(p.piece)), new THREE.Matrix4().multiplyMatrices(M, loc), p.role, p.id);
      }
      for (const h of hide) if (!roots[p.piece].children.some(c => c.name === h)) missingKids.add(p.piece + '/' + h);
    }
    // terrain: unique geometry, one batch each (identity instance); the flower templates were handled as pieces above
    for (const o of gl.elderglow_terrain.scene.children) {
      if (o.name.startsWith('EG_Map_Flowers')) continue;
      const role = (L.terrain.parts || {})[o.name] || 'ground';
      const b = makeBatch('terrain:' + o.name, o, null, true); b.terrain = true; batches[b.key] = b;   // terrain: never ink (its hull rose over the horizon)
      addInst(b, new THREE.Matrix4(), role, -1);
    }
    // ---- three objects
    const group = new THREE.Group(); group.name = 'ElderMap'; scene.add(group);
    const list = [];
    for (const k in batches) {
      const b = batches[k]; if (!b || !b.inst.length) continue;
      const n = b.inst.length;
      if (b.geo) {
        // opt.lite (phones): small pieces (flowers, bushes, shrooms, boulders...) cast no shadow: the shadow pass is ~half the triangles
        b.mesh = new THREE.InstancedMesh(b.geo, litMat, n); b.mesh.castShadow = !(opt.lite && b.radius < 3); b.mesh.receiveShadow = true;
        b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); b.mesh.frustumCulled = false; b.mesh.name = k; group.add(b.mesh);
        if (b.ink) { b.inkMesh = new THREE.InstancedMesh(b.ink, inkMat, n); b.inkMesh.instanceMatrix = b.mesh.instanceMatrix; b.inkMesh.frustumCulled = false; b.inkMesh.name = k + ':ink'; group.add(b.inkMesh); }
      }
      b.seeMeshes = b.see.map(s => { const im = new THREE.InstancedMesh(s.geo, s.mat, n); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.receiveShadow = true; group.add(im); return im; });
      b.trisOne = (b.geo ? b.geo.index.count / 3 : 0) + b.see.reduce((a, s) => a + s.geo.index.count / 3, 0);
      b.inkTrisOne = b.ink ? b.ink.index.count / 3 : 0;
      list.push(b);
    }
    // bounds the way viewer.html gets them (Box3.setFromObject over every mesh)
    const box = new THREE.Box3(), tb = new THREE.Box3();
    for (const b of list) for (const i of b.inst) { tb.copy(b.box).applyMatrix4(i.m); box.union(tb); }
    const roles = {}; for (const b of list) for (const i of b.inst) roles[i.role] = (roles[i.role] || 0) + 1;
    const on = {}; for (const r in roles) on[r] = true;
    // ---- per frame culling
    const frustum = new THREE.Frustum(), PM = new THREE.Matrix4(), sph = new THREE.Sphere(), lastCam = new THREE.Matrix4(); let dirty = true;
    const api = {
      layout: L, batches: list, roles, on, box, group, missing: [...missing], missingKids: [...missingKids],
      loadMs: { fetchAndDecode: tLoaded - t0, total: 0 },
      cull: { px: 1.0, inkPx: 3.0, margin: 25, coverK: 1 },   // coverK scales the ground-cover distances (COVER_D)
        // screen radius (px) under which an instance / its ink is skipped
      setRole(r, v) { on[r] = v; dirty = true; },
      invalidate() { dirty = true; },   // after changing an instance's m / c / r / role by hand (the game rescales the tree)
      stats: { instances: 0, drawn: 0, tris: 0 },
      update(camera, time, H) {
        uTime.value = time; INK.pxW.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, H);
        camera.updateMatrixWorld();
        if (!dirty && lastCam.equals(camera.matrixWorld)) return;
        dirty = false; lastCam.copy(camera.matrixWorld);
        PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(PM);
        const k = (H / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), cp = camera.position;
        let drawn = 0, tris = 0, total = 0;
        for (const b of list) {
          const big = [], small = [];
          for (const i of b.inst) {
            total++;
            if (!on[i.role]) continue;
            const d = Math.max(0.1, i.c.distanceTo(cp) - i.r);
            if (i.md && d > i.md * api.cull.coverK) continue;   // ground cover: distance cull
            const px = i.r / d * k;
            if (!b.terrain && px < api.cull.px) continue;
            sph.center.copy(i.c); sph.radius = i.r + api.cull.margin;
            if (!b.terrain && !frustum.intersectsSphere(sph)) continue;
            (px >= api.cull.inkPx || b.terrain ? big : small).push(i);
          }
          const n = big.length + small.length; drawn += n;
          const arr = (b.mesh || b.seeMeshes[0]).instanceMatrix;
          let j = 0; for (const i of big) i.m.toArray(arr.array, 16 * j++); for (const i of small) i.m.toArray(arr.array, 16 * j++);
          arr.needsUpdate = true;
          if (b.mesh) { b.mesh.count = n; b.mesh.visible = n > 0; tris += n * (b.geo.index.count / 3); }
          if (b.inkMesh) { b.inkMesh.count = big.length; b.inkMesh.visible = big.length > 0; tris += big.length * b.inkTrisOne; }
          b.seeMeshes.forEach((m, si) => {
            if (m.instanceMatrix !== arr) { m.instanceMatrix.array.set(arr.array.subarray(0, 16 * n)); m.instanceMatrix.needsUpdate = true; }
            m.count = n; m.visible = n > 0; tris += n * (b.see[si].geo.index.count / 3);
          });
        }
        api.stats = { instances: total, drawn, tris };
      },
    };
    api.loadMs.total = performance.now() - t0;
    return api;
  }
  // A copy of the map's lit material with two live knobs, for one batch (the game swaps b.mesh.material):
  //   u.glow 0..1 = Glow* parts grey + dim (0) -> bright, nudged toward gold (1);  u.leaf 0..1 = canopy (swaying
  //   vertices) dry brown + desaturated (0) -> its own colours (1). u.boost = extra glow brightness (level-up burst).
  let tintN = 0;
  function makeTintMat(u) {
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, vertexColors: true }), id = ++tintN;
    m.onBeforeCompile = s => {
      s.uniforms.uTime = uTime; s.uniforms.uGlow = u.glow; s.uniforms.uLeaf = u.leaf; s.uniforms.uBoost = u.boost; glowUniforms(s);
      s.vertexShader = SWAY_DECL + SEA_DECL_V + 'attribute float unlit;\nvarying float vUnlit;\nvarying float vLeaf;\n' + s.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUnlit = unlit; vLeaf = swayW;' + SWAY_VS + SEA_VS);
      s.fragmentShader = '#define EG_NORESTORE\nvarying float vUnlit;\nvarying float vLeaf;\nuniform float uGlow;\nuniform float uLeaf;\nuniform float uBoost;\n' + GLOW_DECL + s.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          if (vUnlit > 0.5) {
            vec3 lo = vec3(lum) * 0.32 + vec3(0.03, 0.03, 0.05);
            vec3 hi = mix(diffuseColor.rgb, vec3(1.0, 0.86, 0.45), 0.25) * (1.45 + uBoost);
            diffuseColor.rgb = mix(lo, hi, clamp(uGlow, 0.0, 1.0));
          } else if (vLeaf > 0.5) {
            vec3 dry = mix(vec3(lum) * 0.9, vec3(0.72, 0.43, 0.2) * (0.4 + lum), 0.85);
            diffuseColor.rgb = mix(dry, diffuseColor.rgb * (1.0 + 0.08 * uBoost), clamp(uLeaf, 0.0, 1.0));
          }`)
        .replace('#include <color_fragment>', GRADE_FS).replace(OUT_R128, GLOW_FS).replace('#include <fog_fragment>', GLOW_FOG);
    };
    m.customProgramCacheKey = () => 'eg-tint-' + id;
    return m;
  }
  window.ElderMap = { load, uRest, uRestC, uRestWave, uTime, uNight, uGrade, uGradeDark, uDayGlow, uSeason, uCozy, makeTintMat, INK, seeMats: seeCache };
})();
