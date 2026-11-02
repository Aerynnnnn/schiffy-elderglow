// Events (step 4): small "every few minutes" happenings. Pure JS on the sim state (no three.js, no Math.random, no
// clock). One roll per SLOT of island time from a hash of (S.events.seed, slot), so online steps, the offline catch-up
// and a reloaded save see the same events at the same times. At most MAX_ACTIVE timed events at once.
//  - fruit:   the tree drops 2-4 glowing fruits around its roots (tap each: berries + Nourish + sometimes a seed);
//             what is left when it ends, the pups gather (half the berries, no seeds)
//  - shower:  a sudden shower (Water need +SHOWER per hour while it lasts)
//  - crystal: a pup finds a crystal or two (instant)
//  - wish:    a pup wants to try a job ("Mochi wants to try Light") -> give it that job while the wish lasts: a big
//             morale bonus (+ a little Spirit); it just forgets about it otherwise
//  - trader:  a wandering trader stays a while with 3 trades (crystals / seeds / berries / wood / stone <-> decor or
//             materials); each trade once; it simply moves on when the time is up
//  - wave:    a blight wave: 2-3 more patches (only once Protect is awake; guardians matter)
// Offline: fruit auto-gathered, shower + crystal just happen, wishes / traders pass harmlessly (never punished); events
// still running at the return are there to play with. State: S.events = {seed, slot, n, active: [...], log: [...], last}.
(function () {
  'use strict';
  const H = 3600;
  const C = {
    SLOT: 300, START: 900, P: 0.35, MAX_ACTIVE: 2, LOG: 40,
    DUR: { fruit: 900, shower: 600, wish: 1200, trader: 1800, fest: 1800 },
    W: { fruit: 3, shower: 2, crystal: 2, wish: 3, trader: 2, wave: 2, fest: 2 },
    GAP: { shower: 3600, trader: 5400, wave: 3600, fest: 3 * 3600 },   // at least this long between two of a kind
    AT: { crystal: 1800, trader: 3600 },               // not before this much island time
    FRUIT: { food: 6, auto: 3, nourish: 3, light: 2 }, SHOWER: 40, WISH_MORALE: 20, WISH_SPIRIT: 4,
    // step 5: a seasonal little festival (only on islands with a season: S.ep0 set), lifting one need while it lasts,
    // + a morale lift for everyone at the start. Spring blossom picnic, summer splash day, autumn lantern night, winter
    // snow pups. A built Market square brings the trader twice as often; a Great tree (L7+) drops fruit twice as often.
    FEST: { spring: 'spirit', summer: 'water', autumn: 'light', winter: 'spirit' }, FEST_RATE: 30, FEST_MORALE: 5, GREAT_LV: 7,
  };
  const TYPES = ['fruit', 'shower', 'crystal', 'wish', 'trader', 'wave', 'fest'];
  const TIMED = { fruit: 1, shower: 1, wish: 1, trader: 1, fest: 1 };
  // trader offers: give -> get (res keys: wood / stone / food / crystal, 'seeds', decor ids)
  const OFFERS = [
    { give: { crystal: 3 }, get: { decor: 'glow-shrooms' } },
    { give: { seeds: 4 }, get: { wood: 40 } },
    { give: { food: 30 }, get: { stone: 20 } },
    { give: { crystal: 2 }, get: { seeds: 5 } },
    { give: { wood: 30 }, get: { crystal: 2 } },
    { give: { seeds: 3, food: 10 }, get: { decor: 'fairy-ring' } },
    { give: { crystal: 4 }, get: { decor: 'wisp-tree' } },
    { give: { stone: 25 }, get: { seeds: 3 } },
    { give: { food: 20 }, get: { wood: 25 } },
    { give: { crystal: 5 }, get: { decor: 'crystal-pillar' } },
  ];
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const S_ = () => window.Sim, N_ = () => window.Needs;

  function create(s, seed) { s.events = { seed: (seed >>> 0) || 1, slot: Math.floor(s.time / C.SLOT), n: 0, active: [], log: [], last: {} }; }
  const have = (s, k) => k === 'seeds' ? s.inv.seeds : k === 'sap' ? s.sap : (s.res[k] || 0);
  // log entries keep one key order (id type t pup want n got traded out), so a saved + reloaded log is byte-identical
  const LOGK = ['id', 'type', 't', 'pup', 'want', 'n', 'sea', 'got', 'traded', 'out'];
  const canon = x => { const y = {}; for (const k of LOGK) if (x[k] !== undefined) y[k] = x[k]; return y; };
  function logIt(s, e, out) {
    const L = s.events.log; let j = L.findIndex(y => y.id === e.id);
    const x = j >= 0 ? L[j] : { id: e.id, type: e.type, t: e.t0 };
    for (const k of ['pup', 'want', 'n', 'sea']) if (e[k] !== undefined) x[k] = e[k];
    if (e.got) x.got = e.got.length; if (e.done) x.traded = e.done.length;
    if (out !== undefined) x.out = out;
    if (j >= 0) L[j] = canon(x); else { L.push(canon(x)); while (L.length > C.LOG) L.shift(); }
    return L[j >= 0 ? j : L.length - 1];
  }
  // a wish: the pup's liked job if it isn't on it (and the job is open), else another open job it doesn't dislike
  function wishFor(s, i, h) {
    const p = s.pups[i], J = S_().JOBS, Nd = N_();
    if (p.like !== p.job && J.includes(p.like) && Nd.jobOpen(s, p.like) && p.like !== 'rest') return p.like;
    const c = J.filter(j => j !== p.job && j !== p.dislike && j !== 'rest' && j !== 'build' && Nd.jobOpen(s, j));
    return c.length ? c[h % c.length] : null;
  }
  function roll(s, ts, k, nav, ev) {
    const E = s.events; if (ts < C.START) return;
    const h = hash(E.seed * 7 + Math.imul(k, 2654435761)); if ((h % 1000) / 1000 >= C.P) return;
    if (E.active.length >= C.MAX_ACTIVE) return;
    const act = t => E.active.some(e => e.type === t), since = t => ts - (E.last[t] === undefined ? -1e12 : E.last[t]);
    const sea = window.Seasons ? window.Seasons.of(s) : null, tGap = C.GAP.trader / (S_().fac(s, 'market') ? S_().C.FAC.market.trade : 1);
    const ok = {
      fruit: !act('fruit'), shower: !act('shower') && since('shower') >= C.GAP.shower, crystal: ts >= C.AT.crystal && s.pups.length > 0,
      wish: !act('wish') && s.pups.length > 0, trader: !act('trader') && ts >= C.AT.trader && since('trader') >= tGap,
      wave: N_().awakeK(s, 'protect') >= 0 && since('wave') >= C.GAP.wave,
      fest: sea !== null && !act('fest') && since('fest') >= C.GAP.fest,
    };
    const mk = S_().fac(s, 'market'), wOf = t => C.W[t] * (t === 'trader' && mk ? S_().C.FAC.market.trade : t === 'fruit' && s.level >= C.GREAT_LV ? 2 : 1);
    const cand = TYPES.filter(t => ok[t]); if (!cand.length) return;
    const wsum = cand.reduce((a, t) => a + wOf(t), 0); let u = (hash(h + 1) % 10000) / 10000 * wsum, type = cand[cand.length - 1];
    for (const t of cand) { if ((u -= wOf(t)) < 0) { type = t; break; } }
    const h2 = hash(h + 2), e = { id: ++E.n, type, t0: ts, end: ts + (C.DUR[type] || 0) };
    if (type === 'fruit') { e.n = 2 + h2 % 3; e.a = h2 % 360; e.got = []; }
    else if (type === 'shower') e.ap = 0;
    else if (type === 'crystal') { e.pup = h2 % s.pups.length; e.n = 1 + (h2 >>> 4) % 2; }
    else if (type === 'wish') { e.pup = h2 % s.pups.length; e.want = wishFor(s, e.pup, h2 >>> 3); if (!e.want) { E.n--; return; } }
    else if (type === 'trader') { const a = []; for (let j = 0; a.length < 3 && j < 40; j++) { const o = hash(h2 + j * 97) % OFFERS.length; if (!a.includes(o)) a.push(o); } e.offers = a; e.done = []; }
    else if (type === 'fest') { e.sea = sea; e.need = festNeed(s, sea); e.ap = 0; for (const p of s.pups) if (!p.exp) p.morale = Math.min(100, p.morale + C.FEST_MORALE); }
    E.last[type] = ts;
    if (type === 'crystal') { s.res.crystal = (s.res.crystal || 0) + e.n; logIt(s, e, 'done'); if (ev) ev.push({ type: 'event', k: 'start', e }); return; }
    if (type === 'wave') { e.n = N_().wave(s, nav, 2 + h2 % 2, h2, ev); logIt(s, e, 'done'); if (ev) ev.push({ type: 'event', k: 'start', e }); return; }
    E.active.push(e); logIt(s, e); if (ev) ev.push({ type: 'event', k: 'start', e });
  }
  function shower(s, e, upTo) {
    const until = Math.min(e.end, upTo), d = until - (e.t0 + e.ap); if (d <= 0) return;
    if (e.type === 'fest') s.needs[e.need] = Math.min(100, s.needs[e.need] + C.FEST_RATE * d / H);
    else s.needs.water = Math.min(100, s.needs.water + C.SHOWER * d / H);
    e.ap += d;
  }
  // the need a seasonal festival lifts (its season's, or Light while that need is still asleep)
  const festNeed = (s, k) => { const n = C.FEST[['spring', 'summer', 'autumn', 'winter'][k]] || 'light'; return n === 'water' || n === 'light' || N_().awakeK(s, n) >= 0 ? n : 'light'; };
  function end(s, e, out, ev) {
    const j = s.events.active.indexOf(e); if (j >= 0) s.events.active.splice(j, 1);
    logIt(s, e, out); if (ev) ev.push({ type: 'event', k: 'end', e, out });
  }
  // events that ran out by time `te` (in end-time order): fruit left over is gathered by the pups
  function expire(s, te, ev) {
    const due = s.events.active.filter(e => e.end <= te).sort((a, b) => a.end - b.end || a.id - b.id);
    for (const e of due) {
      if (e.type === 'shower' || e.type === 'fest') { shower(s, e, e.end); end(s, e, 'done', ev); }
      else if (e.type === 'fruit') { const left = e.n - e.got.length; s.res.food += C.FRUIT.auto * left; e.auto = left; end(s, e, left ? 'auto' : 'done', ev); }
      else if (e.type === 'wish') end(s, e, 'forgot', ev);
      else if (e.type === 'trader') end(s, e, 'left', ev);
      else end(s, e, 'done', ev);
    }
  }
  function fulfil(s, e, ev) {
    const p = s.pups[e.pup]; if (!p) return;
    p.morale = Math.min(100, p.morale + C.WISH_MORALE); s.stats.wishes++;
    if (N_().awakeK(s, 'spirit') >= 0) s.needs.spirit = Math.min(100, s.needs.spirit + C.WISH_SPIRIT);
    end(s, e, 'done', ev);
  }
  // per sim step (Sim.step calls it before the needs decay): slot rolls in time order, then running effects
  function tick(s, dt, nav, ev) {
    const E = s.events, t1 = s.time + dt;
    while ((E.slot + 1) * C.SLOT <= t1) { E.slot++; const ts = E.slot * C.SLOT; expire(s, ts, ev); roll(s, ts, E.slot, nav, ev); }
    for (const e of E.active.slice()) {
      if (e.type === 'shower' || e.type === 'fest') shower(s, e, t1);
      else if (e.type === 'wish' && s.pups[e.pup] && s.pups[e.pup].job === e.want) fulfil(s, e, ev);
    }
    expire(s, t1, ev);
  }

  // ---- player actions
  function collect(s, id, j) {
    const e = s.events.active.find(x => x.id === id && x.type === 'fruit'); if (!e || !Number.isInteger(j) || j < 0 || j >= e.n || e.got.includes(j)) return null;
    e.got.push(j); s.stats.fruit++;
    const r = { food: C.FRUIT.food, nourish: 0, light: 0, seed: hash(id * 13 + j) % 4 === 0 ? 1 : 0 };
    s.res.food += r.food; s.inv.seeds += r.seed;
    if (N_().awakeK(s, 'nourish') >= 0) { r.nourish = C.FRUIT.nourish; s.needs.nourish = Math.min(100, s.needs.nourish + r.nourish); }
    else { r.light = C.FRUIT.light; s.needs.light = Math.min(100, s.needs.light + r.light); }
    if (e.got.length >= e.n) end(s, e, 'done', null);
    return r;
  }
  function canTrade(s, id, j) {
    const e = s.events.active.find(x => x.id === id && x.type === 'trader'); if (!e || !Number.isInteger(j) || j < 0 || j >= e.offers.length || e.done.includes(j)) return { ok: false, why: 'Gone' };
    const o = OFFERS[e.offers[j]]; for (const k in o.give) if (have(s, k) < o.give[k] - 1e-9) return { ok: false, why: 'A little more needed', o, e };
    return { ok: true, o, e };
  }
  function trade(s, id, j) {
    const c = canTrade(s, id, j); if (!c.ok) return null;
    const { o, e } = c;
    for (const k in o.give) { if (k === 'seeds') s.inv.seeds -= o.give[k]; else s.res[k] -= o.give[k]; }
    for (const k in o.get) { if (k === 'decor') s.inv.decor.push(o.get.decor); else if (k === 'seeds') s.inv.seeds += o.get[k]; else s.res[k] = (s.res[k] || 0) + o.get[k]; }
    e.done.push(j); s.stats.trades++; logIt(s, e);
    return o;
  }

  // ---- save
  function sanitize(s, o) {
    const E = o && o.events && typeof o.events === 'object' ? o.events : null;
    // an island from before step 4: a seed from its own history (stable), first roll on the next slot
    const seed = E && Number.isInteger(E.seed) && E.seed > 0 ? E.seed >>> 0 : (hash(Math.round(s.time) ^ Math.imul(s.stats.trips + 1, 7919) ^ Math.round(s.clock0)) || 1);
    create(s, seed);
    if (!E) return;
    s.events.slot = Math.round(fin(E.slot, Math.floor(s.time / C.SLOT), 0, 1e12)); s.events.n = Math.round(fin(E.n, 0, 0, 1e9));
    if (E.last && typeof E.last === 'object') for (const t in E.last) if (TYPES.includes(t) && typeof E.last[t] === 'number' && isFinite(E.last[t])) s.events.last[t] = E.last[t];
    const N = s.pups.length;
    if (Array.isArray(E.active)) for (const e of E.active.slice(0, 12)) {
      if (!e || !TIMED[e.type] || s.events.active.some(x => x.type === e.type) || s.events.active.length >= C.MAX_ACTIVE) continue;
      const x = { id: Math.round(fin(e.id, 0, 1, 1e9)), type: e.type, t0: fin(e.t0, s.time, 0, 1e12), end: 0 };
      x.end = fin(e.end, x.t0 + C.DUR[e.type], x.t0, x.t0 + C.DUR[e.type]);
      if (e.type === 'fruit') { x.n = Math.round(fin(e.n, 2, 1, 4)); x.a = Math.round(fin(e.a, 0, 0, 359)); x.got = Array.isArray(e.got) ? [...new Set(e.got.filter(j => Number.isInteger(j) && j >= 0 && j < x.n))] : []; }
      else if (e.type === 'shower') x.ap = fin(e.ap, 0, 0, C.DUR.shower);
      else if (e.type === 'fest') { x.ap = fin(e.ap, 0, 0, C.DUR.fest); x.sea = Math.round(fin(e.sea, 0, 0, 3)); x.need = ['water', 'light', 'nourish', 'protect', 'spirit'].includes(e.need) ? e.need : 'light'; }
      else if (e.type === 'wish') { if (!Number.isInteger(e.pup) || e.pup < 0 || e.pup >= N || !S_().JOBS.includes(e.want)) continue; x.pup = e.pup; x.want = e.want; }
      else if (e.type === 'trader') { x.offers = Array.isArray(e.offers) ? [...new Set(e.offers.filter(k => Number.isInteger(k) && k >= 0 && k < OFFERS.length))].slice(0, 3) : []; if (!x.offers.length) continue; x.done = Array.isArray(e.done) ? [...new Set(e.done.filter(j => Number.isInteger(j) && j >= 0 && j < x.offers.length))] : []; }
      if (x.id > s.events.n) s.events.n = x.id;
      s.events.active.push(x);
    }
    if (Array.isArray(E.log)) for (const l of E.log.slice(-C.LOG)) {
      if (!l || !TYPES.includes(l.type)) continue;
      const x = { id: Math.round(fin(l.id, 0, 0, 1e9)), type: l.type, t: Math.round(fin(l.t, 0, 0, 1e12)) };
      if (Number.isInteger(l.pup) && l.pup >= 0 && l.pup < N) x.pup = l.pup;
      if (S_().JOBS.includes(l.want)) x.want = l.want;
      for (const k of ['n', 'sea', 'got', 'traded']) if (typeof l[k] === 'number' && isFinite(l[k])) x[k] = Math.round(fin(l[k], 0, 0, 99));
      if (['done', 'auto', 'left', 'forgot'].includes(l.out)) x.out = l.out;
      s.events.log.push(canon(x));
    }
  }

  window.Events = { C, TYPES, OFFERS, create, tick, collect, canTrade, trade, sanitize, hash, wishFor };
})();
