// Social (step 6): public island exploring, async visits. Pure JS (no three.js, no network, no Math.random, no clock:
// times / days are passed in), loaded right after sim.js. The network side is src/net.js (mock or Supabase).
// - names + notes: the same filter runs here and in SQL (server/schema.sql: text_ok / name_ok / note_ok)
// - S.social (save v7): account id, public flag, names, gift ids already applied (idempotent merge), the visitor's own
//   sent effects (outbox ids), islands watered per UTC day
// - snapshot(S): the compact public copy of an island (layout state + pups + tree), visitState(snap): a read-only
//   copy of it for the renderer (through Sim.sanitize, so a hostile snapshot is repaired / rejected like a bad save)
// - applyGifts / applySent: deterministic (sorted by id) and idempotent (ids remembered) merge into the sim
(function () {
  'use strict';
  const C = {
    SNAP_V: 1, SNAP_MAX: 48000,           // bytes of JSON (SQL check: 64 KB)
    PUBLISH_EVERY: 600,                   // s between uploads while the game is open (+ on exit)
    // a visitor waters the tree: once per island per UTC day; the host gets W_HOST on the next load, the visitor W_SELF
    W_HOST: { water: 6, xp: 12, sap: 4 }, W_SELF: { water: 4, sap: 3 },
    GIFT_MAX: { wood: 30, stone: 30, food: 30, crystal: 3, seeds: 2 },   // per gift
    GIFTS_PER_DAY: 3,                     // per visitor per island per UTC day
    NOTE_MAX: 120, NOTES_PER_DAY: 3, VISITS_PER_HOUR: 30,
    GOT_KEEP: 400, SENT_KEEP: 400, WATERED_KEEP: 200,
    ISLAND: [3, 24], HOST: [2, 14], PUP: [1, 14],
  };
  const RES = ['wood', 'stone', 'food', 'crystal', 'seeds'];
  const day = ms => Math.floor(ms / 86400000);   // UTC day number (the server's current_date at UTC)

  // ---- text filter (mirrors server/schema.sql exactly: same charset, same leet map, same two word lists)
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
  const STRONG = ['fuck', 'fuk', 'shit', 'cunt', 'nigg', 'niga', 'faggot', 'rapist', 'nazi', 'hitler', 'porn', 'pussy', 'whore', 'slut', 'retard', 'kike', 'wank', 'twat', 'motherf', 'cocksuck', 'dildo', 'jizz'];
  const WORDS = ['ass', 'arse', 'sex', 'sexy', 'cum', 'tit', 'tits', 'dick', 'cock', 'bitch', 'bastard', 'kys', 'piss', 'crap', 'prick', 'boob', 'boobs', 'nude', 'nudes', 'xxx', 'penis', 'vagina', 'anal'];
  const clean = t => String(t).toLowerCase().replace(/[013457@$!]/g, c => LEET[c] || c);
  function textOk(t) {
    const n = clean(t), sq = n.replace(/[^a-z]/g, '');
    if (STRONG.some(w => sq.includes(w))) return false;
    const words = n.split(/[^a-z]+/);
    return !words.some(w => WORDS.includes(w));
  }
  const NAME_RE = /^[A-Za-z0-9 '.!-]+$/;
  // kind: 'island' | 'host' | 'pup' -> { ok, why, v (trimmed, single spaces) }
  function nameCheck(raw, kind) {
    const [lo, hi] = kind === 'island' ? C.ISLAND : kind === 'pup' ? C.PUP : C.HOST;
    const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (v.length < lo) return { ok: false, why: `at least ${lo} letters`, v };
    if (v.length > hi) return { ok: false, why: `at most ${hi} letters`, v };
    if (!NAME_RE.test(v)) return { ok: false, why: "letters, numbers, spaces and ' . ! - only", v };
    if (!/[A-Za-z]/.test(v)) return { ok: false, why: 'needs a letter', v };
    if (!textOk(v)) return { ok: false, why: 'please pick a kinder name', v };
    return { ok: true, why: '', v };
  }
  const URL_RE = /(https?:|www\.|\.(com|net|org|gg|io|xyz|ly|me|tv)\b)/i;
  function noteCheck(raw) {
    const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!v.length) return { ok: false, why: 'write something nice', v };
    if (v.length > C.NOTE_MAX) return { ok: false, why: `at most ${C.NOTE_MAX} letters`, v };
    if (/[^ -~]/.test(v) || /[<>]/.test(v)) return { ok: false, why: 'plain letters and punctuation only', v };
    if (URL_RE.test(v)) return { ok: false, why: 'no links, please', v };
    if (!textOk(v)) return { ok: false, why: 'please keep it kind', v };
    return { ok: true, why: '', v };
  }

  // ---- save v7: S.social
  function create(s) {
    s.social = { acct: null, pub: true, island: '', host: '', got: [], sent: [], watered: {}, pubAt: 0, seenAt: 0,
      tot: { waters: 0, gifts: 0, visitors: 0, likes: 0, notes: 0 } };
  }
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function sanitize(s, o) {
    create(s); const x = o && o.social && typeof o.social === 'object' ? o.social : null; if (!x) return;
    const so = s.social;
    so.acct = typeof x.acct === 'string' && ID_RE.test(x.acct) ? x.acct : null;
    so.pub = x.pub !== false;
    so.island = nameCheck(x.island, 'island').ok ? nameCheck(x.island, 'island').v : '';
    so.host = nameCheck(x.host, 'host').ok ? nameCheck(x.host, 'host').v : '';
    const ids = (a, k) => Array.isArray(a) ? [...new Set(a.filter(i => typeof i === 'string' && ID_RE.test(i)))].slice(-k) : [];
    so.got = ids(x.got, C.GOT_KEEP); so.sent = ids(x.sent, C.SENT_KEEP);
    if (x.watered && typeof x.watered === 'object') for (const k of Object.keys(x.watered).slice(-C.WATERED_KEEP)) if (ID_RE.test(k) && Number.isInteger(x.watered[k])) so.watered[k] = x.watered[k];
    so.pubAt = fin(x.pubAt, 0, 0, 1e13); so.seenAt = fin(x.seenAt, 0, 0, 1e13);
    for (const k in so.tot) so.tot[k] = Math.round(fin(x.tot && x.tot[k], 0, 0, 1e9));
  }

  // ---- the public snapshot (compact; arrays not objects for the long lists)
  const r1 = v => Math.round(v * 10) / 10;
  function snapshot(s, sea, nav) {
    const so = s.social, pups = s.pups.slice(0, 40).map((p, i) => {
      const nm = nameCheck(p.name, 'pup').ok ? p.name : window.Sim.NAMES[i % window.Sim.NAMES.length];   // a rude pup name never goes public
      return [nm, p.breed, p.collar, p.exp ? 'rest' : p.job, p.like, p.dislike, p.parents ? 1 : 0, p.fit || 0];   // 8th = outfit (wardrobe, v12); an older game reads 7
    });
    const plots = []; for (const k in s.plots) { const e = s.plots[k]; plots.push([+k, e.type, e.done ? 1 : 0, e.done ? 100 : Math.round(100 * e.prog / Math.max(1, window.Sim.workOf(e.type, (nav && nav.plotBy[k]) || { piece: '' }) || 1))]); }
    plots.sort((a, b) => a[0] - b[0]);
    const h = s.health;
    return {
      v: C.SNAP_V, name: so.island, host: so.host, lv: s.level, xp: Math.round(s.xp), hp: Math.round(h),
      nd: ['water', 'light', 'nourish', 'protect', 'spirit'].map(k => Math.round(s.needs[k])), sea: typeof sea === 'number' ? sea : -1,
      wk: s.wake && s.wake.t !== null ? 1 : 0, plots, placed: window.Decor.snap(s), wards: s.wards.slice(0, 12), pups,
      st: { buckets: s.stats.buckets, orbs: s.stats.orbs, built: s.stats.built, arrived: s.stats.arrived, exped: s.stats.exped, days: Math.floor(s.time / 86400), pups: s.pups.length },
      col: colOf(h, sea),
    };
  }
  // card colour: the tree's health + the season (cheap "thumbnail")
  function colOf(h, sea) {
    const base = [[255, 182, 214], [127, 211, 106], [242, 131, 45], [190, 222, 255]][sea >= 0 && sea < 4 ? sea : 1];
    const k = Math.max(0.35, Math.min(1, h / 90)), g = [168, 164, 180];
    return '#' + base.map((c, i) => Math.round(g[i] + (c - g[i]) * k).toString(16).padStart(2, '0')).join('');
  }
  const snapSize = o => JSON.stringify(o).length;
  // a snapshot from the network (untrusted): shape check only; the content is repaired by visitState
  function checkSnap(o) {
    if (!o || typeof o !== 'object' || o.v !== C.SNAP_V || !Array.isArray(o.pups) || !Array.isArray(o.plots) || snapSize(o) > C.SNAP_MAX) return null;
    return o;
  }
  // a read-only island to show: the sim state the renderer needs, made by Sim.sanitize (repairs / rejects like a save)
  function visitState(o, nav) {
    if (!checkSnap(o)) return null;
    const Sim = window.Sim, lv = Math.round(fin(o.lv, 1, 1, Sim.C.MAX_LV));
    const NK = ['water', 'light', 'nourish', 'protect', 'spirit'], needs = {}; NK.forEach((k, i) => { needs[k] = fin(Array.isArray(o.nd) ? o.nd[i] : 80, 80, 0, 100); });
    const plots = {};
    for (const a of o.plots.slice(0, 200)) {
      if (!Array.isArray(a) || !Sim.C.B[a[1]]) continue; const q = nav.plotBy[a[0]]; if (!q) continue;
      const w = Sim.workOf(a[1], q); plots[a[0]] = { type: a[1], done: a[2] === 1, paid: true, prog: a[2] === 1 ? w : w * fin(a[3], 0, 0, 99) / 100 };
    }
    const pups = o.pups.slice(0, Sim.C.MAX_PUPS).map((a, i) => Array.isArray(a) ? { id: 'v' + i, name: nameCheck(a[0], 'pup').ok ? a[0] : Sim.NAMES[i % Sim.NAMES.length], breed: a[1], collar: a[2], job: a[3], like: a[4], dislike: a[5] } : null);
    const placed = window.Decor.unsnap(o.placed);   // free decor [id, k, x, z, r]; an older game's [id, spot] still reads
    const st = Sim.sanitize({ v: 7, level: lv, xp: Sim.C.LV_XP[lv - 1], needs, plots, queue: [], pups, placed, inv: { decor: placed.map(x => x.id).filter(x => typeof x === 'string') },
      wards: Array.isArray(o.wards) ? o.wards : [], wake: { t: o.wk ? -7200 : null }, res: { wood: 50, stone: 50, food: 200, crystal: 0 } }, nav);
    if (!st) return null;
    if (window.Wardrobe) window.Wardrobe.unsnap(st, o.pups);   // outfits (8th entry; a 7-entry snapshot = everyone undressed)
    st.events.slot = 1e9; st.decide = false; st.lastArrive = 1e9; st.social.acct = null;   // quiet: no events, no arrivals, no account
    return st;
  }

  // ---- merge gifts into the host's island: sorted by id (deterministic), each id once (idempotent)
  // gift = { id, kind: 'water' | 'res' | 'decor', item, n, from }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function applyGifts(s, gifts) {
    const so = s.social, have = new Set(so.got), out = [];
    for (const g of (gifts || []).filter(g => g && typeof g.id === 'string' && ID_RE.test(g.id)).slice().sort(byId)) {
      if (have.has(g.id)) continue; have.add(g.id);
      const r = giftEffect(s, g); so.got.push(g.id); if (r) out.push(r);
    }
    if (so.got.length > C.GOT_KEEP) so.got = so.got.slice(-C.GOT_KEEP);
    if (out.length) s.health = window.Sim.healthOf(s);
    return out;
  }
  function giftEffect(s, g) {
    const so = s.social;
    if (g.kind === 'water') {
      s.needs.water = Math.min(100, s.needs.water + C.W_HOST.water); s.xp += C.W_HOST.xp; s.sap += C.W_HOST.sap; so.tot.waters++;
      return { id: g.id, kind: 'water', from: g.from };
    }
    if (g.kind === 'res' && RES.includes(g.item)) {
      const n = Math.round(fin(g.n, 0, 0, C.GIFT_MAX[g.item])); if (n <= 0) return null;
      if (g.item === 'seeds') s.inv.seeds += n; else s.res[g.item] += n; so.tot.gifts++;
      return { id: g.id, kind: 'res', item: g.item, n, from: g.from };
    }
    if (g.kind === 'decor' && window.Exped.DECOR[g.item]) {
      if (s.inv.decor.length < 200) s.inv.decor.push(g.item); so.tot.gifts++;
      return { id: g.id, kind: 'decor', item: g.item, n: 1, from: g.from };
    }
    return null;
  }
  // the visitor's own side, merged on its next load: what it gave away (taken from its resources, never below 0)
  // and its own little boost for watering. out = { id, kind: 'water' | 'res' | 'decor', item, n, island, day }
  function applySent(s, outbox) {
    const so = s.social, have = new Set(so.sent), done = [];
    for (const x of (outbox || []).filter(x => x && typeof x.id === 'string' && ID_RE.test(x.id)).slice().sort(byId)) {
      if (have.has(x.id)) continue; have.add(x.id); so.sent.push(x.id);
      if (x.kind === 'water') {
        s.needs.water = Math.min(100, s.needs.water + C.W_SELF.water); s.sap += C.W_SELF.sap;
        if (typeof x.island === 'string' && ID_RE.test(x.island) && Number.isInteger(x.day)) so.watered[x.island] = Math.max(so.watered[x.island] || 0, x.day);
        if (window.Lanterns && s.lan) window.Lanterns.petal(s, window.Lanterns.C.PET_WATER);   // Round 2 step 4: watering a friend's tree adds World Bloom petals
      } else if (x.kind === 'res' && RES.includes(x.item)) {
        const n = Math.round(fin(x.n, 0, 0, C.GIFT_MAX[x.item]));
        if (x.item === 'seeds') s.inv.seeds = Math.max(0, s.inv.seeds - n); else s.res[x.item] = Math.max(0, s.res[x.item] - n);
      } else if (x.kind === 'decor') {
        if (window.Exped.ownedFree(s, x.item) > 0) { const k = s.inv.decor.lastIndexOf(x.item); if (k >= 0) s.inv.decor.splice(k, 1); }
      } else continue;
      done.push(x.id);
    }
    if (so.sent.length > C.SENT_KEEP) so.sent = so.sent.slice(-C.SENT_KEEP);
    const ks = Object.keys(so.watered); if (ks.length > C.WATERED_KEEP) for (const k of ks.slice(0, ks.length - C.WATERED_KEEP)) delete so.watered[k];
    if (done.length) s.health = window.Sim.healthOf(s);
    return done;
  }
  // may this visitor water that island today? (own save + sent-but-not-merged outbox; the server checks again)
  function waterOk(s, island, dayN, outbox) {
    if (s && s.social && s.social.watered[island] === dayN) return false;
    return !(outbox || []).some(x => x && x.kind === 'water' && x.island === island && x.day === dayN);
  }
  // what a visitor can still give from its own island (resources minus what is already in the outbox)
  function spare(s, outbox) {
    const r = {}; for (const k of RES) r[k] = k === 'seeds' ? s.inv.seeds : (s.res[k] || 0);
    const sentIds = new Set(s.social.sent), dec = {};
    for (const x of outbox || []) {
      if (!x || sentIds.has(x.id)) continue;
      if (x.kind === 'res' && RES.includes(x.item)) r[x.item] = Math.max(0, r[x.item] - (x.n || 0));
      if (x.kind === 'decor') dec[x.item] = (dec[x.item] || 0) + 1;
    }
    const decor = []; const seen = {};
    for (const id of s.inv.decor) { if (!window.Exped.DECOR[id] || seen[id]) continue; seen[id] = 1; const n = window.Exped.ownedFree(s, id) - (dec[id] || 0); if (n > 0) decor.push({ id, n }); }
    return { res: r, decor };
  }

  // ---- sample islands for the mock backend (browsing works offline): deterministic, made from the real nav lists
  const SAMPLES = [
    { name: 'Mossy Hollow', host: 'Clover', lv: 3, sea: 0, homes: 3, extra: ['garden', 'board', 'stage'], pups: 10, likes: 12 },
    { name: 'Lantern Bay', host: 'Ember', lv: 5, sea: 2, homes: 6, extra: ['garden', 'board', 'stage', 'conserv', 'lantern', 'hush'], pups: 18, likes: 31 },
    { name: 'Puddle Patch', host: 'Pip', lv: 2, sea: 1, homes: 1, extra: ['garden'], pups: 7, likes: 3 },
    { name: 'Starfall Glade', host: 'Juniper', lv: 7, sea: 3, homes: 9, extra: ['garden', 'board', 'stage', 'conserv', 'lantern', 'hush', 'sprout', 'greenhold', 'circus'], pups: 26, likes: 58 },
  ];
  function samples(nav) {
    const Sim = window.Sim;
    return SAMPLES.map((d, si) => {
      const s = Sim.create(nav, 1000 + si); s.level = d.lv; s.xp = Sim.C.LV_XP[d.lv - 1] + 10;
      let homes = 0; const want = d.extra.slice();
      for (const q of nav.plots) {
        if (q.lv > d.lv) continue;
        let type = null;
        for (const t of want) if (Sim.canBuild(s, q, t)) { type = t; break; }
        if (!type && homes < d.homes && Sim.canBuild(s, q, 'home')) type = 'home';
        if (!type) continue;
        if (type === 'home') homes++; else want.splice(want.indexOf(type), 1);
        s.plots[q.pid] = { type, prog: Sim.workOf(type, q), paid: true, done: true, auto: false, t: 0, at: 0 };
      }
      const jobs = ['water', 'light', 'water', 'light', 'food', 'build', 'wood', 'stone', 'nourish', 'protect', 'spirit', 'rest'];
      for (let i = s.pups.length; i < d.pups; i++) {
        const b = Sim.BREEDS[(i * 3 + si) % Sim.BREEDS.length];
        s.pups.push(Sim._.newPup({ id: 'n' + i, name: Sim.NAMES[(i * 7 + si * 5) % Sim.NAMES.length], breed: b, collar: ['#ff6b6b', '#4fd1c5', '#f6ad55', '#9f7aea', '#68d391', '#f687b3'][i % 6], like: jobs[i % 9], dislike: 'rest' }, 'rest', nav.rest(i, 0.5)));
      }
      s.pups.forEach((p, i) => { p.job = jobs[i % (d.lv >= 3 ? 11 : 8)]; });
      if (d.lv >= 3) s.wake.t = -7200;
      const nd = 55 + (si * 13) % 40; for (const k in s.needs) s.needs[k] = Math.min(100, nd + (k.length * 3) % 15);
      s.health = Sim.healthOf(s);
      for (let k = 0; k < Math.min(nav.decorSpots.length, 2 + si * 2); k++) { const it = window.Decor.spotItem(nav, Object.keys(window.Exped.DECOR)[(k + si) % 7], k * 3 + si); if (it) s.placed.push(it); }
      s.social.island = d.name; s.social.host = d.host;
      const snap = snapshot(s, d.sea, nav); snap.st.days = 2 + si * 5;
      return { id: 'sample-' + (si + 1), name: d.name, host: d.host, snap, likes: d.likes, sample: true };
    });
  }

  window.Social = { C, day, textOk, nameCheck, noteCheck, create, sanitize, snapshot, colOf, snapSize, checkSnap, visitState, applyGifts, applySent, waterOk, spare, samples, RES };
})();
