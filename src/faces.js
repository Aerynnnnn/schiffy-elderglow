// Schiffy's faces (2026-11-07, the user's expression sheet; master copy in Games/Schiffy/shared/faces/, read FACES.md there).
// art/faces/schiffy-faces.png = 1536 x 256, six 256 px faces on a flat grey (191) background, no alpha:
//   0 open (default)  1 shut (content / sleepy, "u u")  2 glance (pupils to the viewer's left)  3 glance (to the right)
//   4 joy ("^ ^", wide smile)  5 oops (big eyes, raised brows, "o" mouth)
// Each face tile is laid out exactly like Schiffy's own `facedecals` texture in art/schiffy.glb (tile x 2 = that 512 px texture),
// so walker.js swaps whole faces; pups.js uses only the EYES (every breed keeps its own brows / nose / mouth / blush from the GLB).
// View only: never touches the sim or the save. Loaded before pups.js; `ElderFaces.load()` once, `ready` / `onReady(fn)` after.
(function () {
  'use strict';
  const F = { open: 0, shut: 1, left: 2, right: 3, joy: 4, oops: 5 };
  const URL = 'art/faces/schiffy-faces.png', BG = 191, T = 256;
  const api = { F, ready: false, sheet: null };
  const waiting = [];
  api.onReady = fn => { if (api.ready) fn(api); else waiting.push(fn); };
  // grey -> alpha. Pixels touching the background (within 2 px of a pure-grey pixel) are anti-aliased edges: their alpha is how
  // far they are from grey compared with the strongest pixel near them, and their colour is un-mixed from the grey. Everything
  // else (ink, highlights inside the eyes, blush, nose) is solid, so the white eye highlights never turn see-through.
  function key(img) {
    const W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); const id = g.getImageData(0, 0, W, H), D = id.data;
    const d = new Float32Array(W * H), bg = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) { const i = p * 4; d[p] = Math.max(Math.abs(D[i] - BG), Math.abs(D[i + 1] - BG), Math.abs(D[i + 2] - BG)); bg[p] = d[p] < 8 ? 1 : 0; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, i = p * 4; if (bg[p]) { D[i + 3] = 0; continue; }
      let edge = false, mx = 0;
      for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = Y * W + X; if (bg[q]) edge = true; if (d[q] > mx) mx = d[q]; }
      if (!edge) { D[i + 3] = 255; continue; }
      const a = Math.min(1, d[p] / Math.max(40, mx));
      for (let k = 0; k < 3; k++) D[i + k] = Math.max(0, Math.min(255, (D[i + k] - (1 - a) * BG) / a));
      D[i + 3] = Math.round(a * 255);
    }
    g.putImageData(id, 0, 0); return c;
  }
  let loading = null;
  api.load = () => loading || (loading = new Promise(res => {
    const img = new Image();
    img.onload = () => { try { api.sheet = key(img); api.ready = true; waiting.splice(0).forEach(fn => fn(api)); } catch (e) { console.warn('faces', e); } res(api.ready); };
    img.onerror = () => { console.warn('faces: ' + URL + ' did not load'); res(false); };
    img.src = URL;
  }));
  // one face as a size x size canvas (cached)
  const tiles = {};
  api.tile = (k, size) => {
    const key2 = k + ':' + size; if (tiles[key2]) return tiles[key2];
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high'; g.drawImage(api.sheet, k * T, 0, T, T, 0, 0, size, size); return tiles[key2] = c;
  };
  // eyes atlas for the pups: 1024 x 256, 8 cells of 128 a row; row 0 = the sheet's LEFT eye (the pup's +x side is the viewer's
  // right, so this one sits at -x), row 1 = the right eye; cell k = face k. EYE = the crop round each eye in a tile (no brows, no nose).
  api.EYE = { L: [18, 102], R: [158, 102], S: 80, CELL: 128 };
  let atlas = null;
  api.eyes = () => {
    if (atlas) return atlas;
    const E = api.EYE, c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    for (let k = 0; k < 6; k++) for (let s = 0; s < 2; s++) { const o = s ? E.R : E.L; g.drawImage(api.sheet, k * T + o[0], o[1], E.S, E.S, k * E.CELL, s * E.CELL, E.CELL, E.CELL); }
    atlas = { canvas: c, uv: (k, s) => [k * E.CELL / 1024, 1 - (s + 1) * E.CELL / 256, (k + 1) * E.CELL / 1024, 1 - s * E.CELL / 256] };
    return atlas;
  };
  // which face to show this frame. mood = 'open' | 'shut' | 'joy' | 'oops'; t = seconds; seed = any number per character.
  // open / oops eyes blink (~0.13 s every 3-6 s, now and then twice); open eyes also glance left or right for ~1 s now and then.
  const fr = x => { x = Math.sin(x) * 43758.5453; return x - Math.floor(x); };
  api.pick = (mood, t, seed) => {
    if (mood === 'shut') return F.shut;
    if (mood === 'joy') return F.joy;
    const bp = 3 + 3 * fr(seed * 1.7), bt = t + seed * 5.3, bn = Math.floor(bt / bp), bph = bt - bn * bp;
    if (bph < 0.13 || (fr(bn * 3.1 + seed) < 0.18 && bph > 0.3 && bph < 0.43)) return F.shut;
    if (mood === 'oops') return F.oops;
    const gp = 6 + 6 * fr(seed * 2.9), gt = t + seed * 11.7, gn = Math.floor(gt / gp), gph = gt - gn * gp;
    if (gph > 1.4 && gph < 1.4 + 0.8 + 0.6 * fr(gn + seed) && fr(gn * 7.7 + seed * 3.3) < 0.6) return fr(gn * 1.9 + seed) < 0.5 ? F.left : F.right;
    return F.open;
  };
  window.ElderFaces = api;
})();
