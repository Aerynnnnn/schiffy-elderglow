// Tour (creative build part 2, piece 5 "showing off"): the host's guided tour. Pure JS (no three.js, no network, no clock),
// loaded right after homes.js (sim_check loads it too).
// The host marks up to C.MAX stops: a placed decoration (t 'd', r = its stable handle k), a building (t 'h', r = plot pid,
// incl. free homes 900000+) or a spot on open ground (t 's'), each with a note of up to C.NOTE letters through the SAME
// filter as guestbook notes (Social.noteCheck; SQL: tour_note_ok in server/patch_5.sql). An empty note is fine.
// Save v13 (no version bump): S.tour = [{t, r, x, z, n}] exists ONLY when there is at least one stop (an island without a
// tour saves the same bytes as before). x / z (0.1 m) = where the stop was when marked (a decoration / building: its spot
// is read live, so a moved piece takes its stop along; a packed-away piece leaves a spot stop where it stood).
// Snapshot `tour` = [[t 0 d | 1 h | 2 s, r, x10, z10, note]] (only when set). A visitor's Tour button walks Schiffy through
// them in order (src/walker.js tour()). No stops = no field = no button.
(function () {
  'use strict';
  const C = { MAX: 6, NOTE: 60, NEAR: 120 };   // NEAR: a spot stop must be within this of a road node (on the island)
  const T = ['d', 'h', 's'];
  const fin = v => typeof v === 'number' && isFinite(v);
  const r1 = v => Math.round(v * 10) / 10;
  // the note filter: the guestbook's, capped at 60 letters; '' = no note
  function noteCheck(raw) {
    const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!v) return { ok: true, why: '', v: '' };
    if (v.length > C.NOTE) return { ok: false, why: `at most ${C.NOTE} letters`, v };
    const c = window.Social.noteCheck(v); return c.ok ? { ok: true, why: '', v: c.v } : c;
  }
  const pieceOf = (s, k) => (s.placed || []).find(p => p.k === k) || null;
  const plotOk = (s, nav, pid) => !!(s.plots && s.plots[pid] && nav && nav.plotBy && nav.plotBy[pid] && nav.plotBy[pid].pos);
  function spotOk(nav, x, z) {
    if (!fin(x) || !fin(z) || Math.abs(x) > 3000 || Math.abs(z) > 3000) return false;
    if (!nav) return true;
    if (nav.wet && nav.wet(x, z)) return false;
    if (nav.nodes) { let bd = Infinity; for (const n of nav.nodes) { const d = (n.p[0] - x) ** 2 + (n.p[2] - z) ** 2; if (d < bd) bd = d; } if (bd > C.NEAR * C.NEAR) return false; }
    return true;
  }
  // where a stop is now: [x, z] (a decoration / building live, else the stored spot)
  function posOf(s, nav, st) {
    if (st.t === 'd') { const p = pieceOf(s, st.r); if (p) return [p.x, p.z]; }
    if (st.t === 'h' && plotOk(s, nav, st.r)) { const q = nav.plotBy[st.r]; return [q.pos[0], q.pos[2]]; }
    return [st.x, st.z];
  }
  const same = (a, b) => a.t === b.t && (a.t === 's' ? Math.hypot(a.x - b.x, a.z - b.z) < 2 : a.r === b.r);
  // add a stop: {t, r, x, z, note} -> index or -1 (res.why: full | note text | gone | far | dup)
  function add(s, nav, st, res) {
    res = res || {}; const L = s.tour || [];
    if (L.length >= C.MAX) { res.why = 'full'; return -1; }
    const n = noteCheck(st.note); if (!n.ok) { res.why = n.why; return -1; }
    const e = { t: T.includes(st.t) ? st.t : 's', r: 0, x: 0, z: 0, n: n.v };
    if (e.t === 'd') { const p = pieceOf(s, st.r); if (!p) { res.why = 'gone'; return -1; } e.r = p.k; e.x = r1(p.x); e.z = r1(p.z); }
    else if (e.t === 'h') { if (!plotOk(s, nav, st.r)) { res.why = 'gone'; return -1; } const q = nav.plotBy[st.r]; e.r = +st.r; e.x = r1(q.pos[0]); e.z = r1(q.pos[2]); }
    else { if (!spotOk(nav, st.x, st.z)) { res.why = 'far'; return -1; } e.x = r1(st.x); e.z = r1(st.z); }
    if (L.some(o => same(o, e))) { res.why = 'dup'; return -1; }
    L.push(e); s.tour = L; res.why = ''; return L.length - 1;
  }
  function edit(s, i, note, res) {
    res = res || {}; const st = s.tour && s.tour[i]; if (!st) { res.why = 'gone'; return false; }
    const n = noteCheck(note); if (!n.ok) { res.why = n.why; return false; }
    st.n = n.v; return true;
  }
  function remove(s, i) { if (!s.tour || !s.tour[i]) return false; s.tour.splice(i, 1); if (!s.tour.length) delete s.tour; return true; }
  function move(s, i, d) { const L = s.tour, j = i + d; if (!L || !L[i] || !L[j]) return false; [L[i], L[j]] = [L[j], L[i]]; return true; }
  // the stops in order: [{i, t, r, x, z, note}] (positions live)
  function stops(s, nav) { return (s.tour || []).map((st, i) => { const p = posOf(s, nav, st); return { i, t: st.t, r: st.r, x: p[0], z: p[1], note: st.n }; }); }

  // save: after Decor / Land / Homes sanitize (the pieces + plots they point at are known). Junk repaired: unknown kinds,
  // bad numbers, a note the filter refuses (-> no note), duplicates and stops past 6 dropped; a decoration that is gone ->
  // a spot stop where it stood (if that spot is fine). No valid stop = no field.
  function sanitize(s, o, nav) {
    delete s.tour;
    const a = o && Array.isArray(o.tour) ? o.tour : null; if (!a) return;
    const L = [];
    for (const x of a.slice(0, 40)) {
      if (L.length >= C.MAX) break;
      if (!x || typeof x !== 'object' || !T.includes(x.t) || !fin(x.x) || !fin(x.z)) continue;
      const n = noteCheck(typeof x.n === 'string' ? x.n : ''), e = { t: x.t, r: 0, x: r1(x.x), z: r1(x.z), n: n.ok ? n.v : '' };
      if (e.t === 'd') { if (Number.isInteger(x.r) && pieceOf(s, x.r)) e.r = x.r; else e.t = 's'; }
      else if (e.t === 'h') { if (Number.isInteger(x.r) && plotOk(s, nav, x.r)) e.r = x.r; else e.t = 's'; }
      if (e.t === 's' && !spotOk(nav, e.x, e.z)) continue;
      if (L.some(y => same(y, e))) continue;
      L.push(e);
    }
    if (L.length) s.tour = L;
  }
  // snapshot (public, untrusted on the other side): [[t#, r, x10, z10, note]]
  function snap(s) {
    if (!s.tour || !s.tour.length) return null;
    return s.tour.slice(0, C.MAX).map(st => { const p = st.t === 'd' ? pieceOf(s, st.r) : null; return [T.indexOf(st.t), st.r, Math.round((p ? p.x : st.x) * 10), Math.round((p ? p.z : st.z) * 10), st.n]; });
  }
  // a visit: the snapshot's stops onto the read-only island (through the same sanitize = the same repair)
  function unsnap(st, a, nav) {
    if (!Array.isArray(a)) { delete st.tour; return; }
    const o = { tour: a.slice(0, 40).map(x => Array.isArray(x) ? { t: T[x[0]], r: x[1], x: x[2] / 10, z: x[3] / 10, n: x[4] } : null) };
    sanitize(st, o, nav);
  }
  window.Tour = { C, noteCheck, posOf, add, edit, remove, move, stops, sanitize, snap, unsnap };
})();
