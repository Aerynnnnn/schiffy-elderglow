// TreeVoice (vibe pass 2, lane C): at night the Elder Tree whispers IN the world: one soft line of text floating by its trunk,
// fading in and out (~11 s), one at a time, every 1.5-3 min of night. Lines come from what it has already said (S.story.log:
// chapters, moments, dreams; a single sentence each, dreams first) - so a whisper never uses up the once-per-session rule
// (Story.Session) and never writes to the save. Hidden while any card / the tree's bubble / the tour / the boat cam is up,
// and when the trunk is off screen. View only. Tests: voice.show(text) (now), voice.next (s to the next one), voice.count.
(function () {
  'use strict';
  function sentences(x) { return String(x || '').split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(s => s.length >= 16 && s.length <= 96); }
  function TreeVoice(o) {
    const el = document.createElement('div'); el.id = 'whisper'; el.className = 'whisper'; el.hidden = true;
    (document.getElementById('app') || document.body).appendChild(el);
    const v = new THREE.Vector3(), recent = [];
    let t = 0, dur = 11, live = false, nightT = 0;
    const api = { next: 30 + Math.random() * 15, count: 0, get live() { return live; }, el, line: '' };
    function pickLine() {
      const S = o.S(); if (!S || !S.story || !S.story.log || !S.story.log.length) return null;
      const pool = [];
      S.story.log.forEach((e, i) => { const w = window.Story && Story.words(e); if (!w) return; sentences(w.x).forEach((s, j) => { const key = i + '.' + j; if (!recent.includes(key)) pool.push({ s, key, w: w.kind === 'dream' ? 3 : w.kind === 'chapter' ? 1.5 : 1 }); }); });
      if (!pool.length) { recent.length = 0; return null; }
      let tot = 0; for (const p of pool) tot += p.w; let r = Math.random() * tot; for (const p of pool) { r -= p.w; if (r <= 0) return p; } return pool[pool.length - 1];
    }
    api.show = function (text) {
      let line = text; if (!line) { const p = pickLine(); if (!p) return false; line = p.s; recent.push(p.key); if (recent.length > 6) recent.shift(); }
      el.textContent = line; api.line = line; el.hidden = false; el.classList.remove('in'); live = true; t = 0; dur = Math.min(14, 8 + line.length * 0.05); api.count++;
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
      if (o.onShow) o.onShow(line);
      return true;
    };
    function hide() { el.classList.remove('in'); live = false; setTimeout(() => { if (!live) el.hidden = true; }, 2200); }
    api.update = function (dt) {
      const night = o.night(), blocked = o.blocked();
      if (live) {
        t += dt;
        if (t > dur || blocked || night < 0.35) { hide(); return; }
        // float by the trunk (projected each frame), rising a little as it fades
        const TP = o.nav.TP, s = o.scale(); v.set(TP[0], TP[1] + (24 + 18 * s), TP[2]); const d = v.distanceTo(o.camera.position); v.project(o.camera);
        const on = v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92 && d < 900;
        el.style.visibility = on ? '' : 'hidden';
        if (on) { el.style.left = ((v.x + 1) / 2 * o.W()) + 'px'; el.style.top = ((1 - v.y) / 2 * o.H() - t * 1.6) + 'px'; }
        return;
      }
      if (night < 0.6 || blocked) { nightT = 0; return; }
      nightT += dt; api.next -= dt;
      if (api.next <= 0 && nightT > 20) { api.next = 90 + Math.random() * 90; api.show(); }
    };
    return api;
  }
  window.TreeVoice = TreeVoice;
})();
