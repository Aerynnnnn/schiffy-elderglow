// "Help build this" (2026-11-06, branch aeryn-help-build; save v16). Pure JS on the sim state (no three.js, no Math.random,
// no clock), loaded right after rings.js; every node check that loads the sim modules loads it too.
// Pups already walk the shortest road paths, so the lever is WHO is on which job: one tap moves a few pups onto whatever
// the building is short of (wood / stone / berries) until it is paid for; then the sim sends them back to the jobs they
// had (Sim.step -> Help.tick), so offline == online.
//   Who goes (plan): resting pups first, then pups from jobs that are comfortably fine (the need >= FINE, or a gather job
//   whose pile is not short), and only while that job keeps >= 1 pup (never the last water / light pup, never the only
//   pup of an awake need's job). Never a builder, never a pup on a skyboat trip / boarding / still arriving. A pup's
//   disliked job only when nobody else can go; pups who like it first. At least 1 per short resource, more until the
//   estimate (the sim's own gather rates) is <= GOAL, at most MAX in all.
//   Going back (tick): when the building is paid (or built, cancelled / removed, or after LIMIT), or as soon as the crew's
//   piles are all in ('ready': everything is here and a builder busy on another plan pays it when free = no over-gathering;
//   'part': it still waits for sap / crystals / seeds, or a pile the builders fetch themselves). A pup the player moved by hand
//   leaves the crew. A pup on a skyboat gets its old job back at once and starts it when it lands (Sim.assign).
// State S.help = {pid, at, crew: [[pup index, old job, help job]]} exists only while a crew is out (an island that never
// uses it has no field = every older case byte-identical). Visits / snapshots never carry it.
(function () {
  'use strict';
  const H = 3600;
  const C = { GOAL: 30 * 60, MAX: 4, LIMIT: 12 * H, FINE: 80, FOOD_OK: 100, FOOD_PAD: 5, RES: ['wood', 'stone', 'food'], NEEDJ: ['water', 'light', 'nourish', 'protect', 'spirit'] };
  const Sm = () => window.Sim;
  const have = (s, k) => k === 'sap' ? s.sap : k === 'seed' ? (s.inv ? s.inv.seeds : 0) : (s.res[k] || 0);
  const busy = p => !!p.exp || p.phase === 'arrive';
  const sea = (s, key) => (window.Seasons ? window.Seasons.k(s, key) : 1) * (window.Weather ? window.Weather.k(s, key) : 1);

  // what still has to come in before this plot can be paid: gatherable shortfall (d) incl. the unpaid plans AHEAD of it in
  // the queue that will be paid first (Sim pickBuild pays the first affordable one), + non-gatherable things it waits for
  function deficit(s, nav, pid) {
    const S = Sm(), e = s.plots[pid], q = nav.plotBy[pid]; if (!e || e.done || e.paid || !q) return null;
    const tot = {}, cost = S.costOf(e.type, q);
    for (const x of s.queue) {
      if (x === pid) break;
      const ex = s.plots[x], qx = nav.plotBy[x]; if (!ex || ex.done || ex.paid || !qx) continue;
      const c = S.costOf(ex.type, qx); let blocked = false;
      for (const k in c) if (!C.RES.includes(k) && have(s, k) < c[k] - 1e-9) blocked = true;
      if (!blocked) for (const k of C.RES) if (c[k]) tot[k] = (tot[k] || 0) + c[k];
    }
    for (const k of C.RES) if (cost[k]) tot[k] = (tot[k] || 0) + cost[k];
    if (tot.food) tot.food += C.FOOD_PAD;   // the pups keep eating: a few spare berries so 'ready' still pays when a builder gets to it
    const d = {}, other = [];
    for (const k of C.RES) if (tot[k] && have(s, k) < tot[k] - 1e-9) d[k] = tot[k] - have(s, k);
    for (const k in cost) if (!C.RES.includes(k) && have(s, k) < cost[k] - 1e-9) other.push(k);
    return { d, other, cost };
  }
  // the sim's own numbers: what one pup on gather job k brings an hour (Sim deliver: rate x seconds worked x morale x sheds
  // x forge x season x the work yard; the morale halfway to the new job's), less the night naps
  function perPup(s, nav, p, k) {
    const S = Sm(), c = S.counts(s);
    const boost = k === 'wood' ? 1 + S.C.B.woodshed.boost * Math.min(4, c.woodshed) : k === 'stone' ? 1 + S.C.B.quarry.boost * Math.min(4, c.quarry) : 1;
    const cat = window.Catalog ? window.Catalog.at(s, nav).gather : 1, m = (p.morale + S.moraleTarget(p, k, s)) / 2;
    const nap = 1 - S.C.NIGHT.NAP_P * S.dayCurve(S.dayH(s)).night;
    return S.C.GATHER[k] * S.mult(m) * boost * S.facK(s, 'forge', 'gather') * sea(s, 'gather') * cat * (k === 'wood' ? sea(s, 'wood') : 1) * nap;
  }
  // the pile's own drift an hour (sheds, quarries, berry patches - what the pups eat)
  function base(s, k) {
    const S = Sm(), c = S.counts(s);
    if (k === 'wood') return c.woodshed * S.C.B.woodshed.wood;
    if (k === 'stone') return c.quarry * S.C.B.quarry.stone;
    const up = window.Pacing ? window.Pacing.upK(s, 'berry') : 1;
    return c.garden * S.C.B.garden.food * sea(s, 'garden') * up - S.C.EAT * S.eaters(s);
  }
  // the builders fetch the most-missing of wood / stone for the plan they work toward (= sim.js shortOf, read only)
  function fetchK(s, nav) {
    const S = Sm(); let pid = null;
    for (const x of s.queue) { const e = s.plots[x]; if (e && !e.done) { pid = x; break; } }
    if (pid === null) return null; for (const x of s.queue) { const e = s.plots[x]; if (e && !e.done && e.paid) return null; }
    const e = s.plots[pid], q = nav.plotBy[pid]; if (!q) return null; const cost = S.costOf(e.type, q);
    let best = null, bv = 0; for (const k of ['wood', 'stone']) if (cost[k] && s.res[k] < cost[k]) { const v = (cost[k] - s.res[k]) / cost[k]; if (v > bv) { bv = v; best = k; } }
    return best;
  }
  // an hour's intake of k with the pups on it now (+ extra helpers, - pups leaving it)
  function rateOf(s, nav, k, extra, leaving) {
    let r = base(s, k); const fk = fetchK(s, nav);
    s.pups.forEach((p, i) => { if (busy(p) || leaving.has(i)) return; if (p.job === k || (p.job === 'build' && fk === k)) r += perPup(s, nav, p, k); });
    for (const i of extra) r += perPup(s, nav, s.pups[i], k);
    return r;
  }

  // -> {ok, why, pid, crew: [[i, old, k]], t: seconds (about), d, other}. why: gone | on | other | none | nobuilder | busy
  function plan(s, nav, pid) {
    const e = s.plots[pid]; if (!e || e.done || e.paid || !nav.plotBy[pid]) return { ok: false, why: 'gone' };
    if (s.help) return { ok: false, why: s.help.pid === pid ? 'on' : 'other' };
    const df = deficit(s, nav, pid), R = Object.keys(df.d);
    if (!R.length) return { ok: false, why: 'none', other: df.other };
    if (!s.pups.some(p => p.job === 'build' && !busy(p))) return { ok: false, why: 'nobuilder' };
    const cnt = {}; for (const p of s.pups) if (!busy(p)) cnt[p.job] = (cnt[p.job] || 0) + 1;
    const cand = [];
    s.pups.forEach((p, i) => {
      if (busy(p) || p.job === 'build' || df.d[p.job] !== undefined) return;   // (a gatherer of a short pile is already on it)
      let tier;
      if (p.job === 'rest') tier = 0;
      else if (C.RES.includes(p.job)) { if (p.job === 'food' && have(s, 'food') < C.FOOD_OK) return; tier = 1; }
      else if (C.NEEDJ.includes(p.job)) { if (!(s.needs[p.job] >= C.FINE)) return; tier = 2; }
      else return;
      cand.push({ i, tier, job: p.job, fine: C.NEEDJ.includes(p.job) ? s.needs[p.job] : 100, used: false });
    });
    const left = Object.assign({}, cnt), add = {}, leaving = new Set(), crew = [];
    for (const k of R) add[k] = [];
    const best = (k, mustHave) => {
      let pool = cand.filter(c => !c.used && (c.job === 'rest' || left[c.job] >= 2));
      const nd = pool.filter(c => s.pups[c.i].dislike !== k);
      if (nd.length || !mustHave) pool = nd;   // a disliked job only for the one pup a pile must have, when nobody else can go
      pool.sort((a, b) => a.tier - b.tier || (s.pups[b.i].like === k) - (s.pups[a.i].like === k) || b.fine - a.fine || a.i - b.i);
      return pool[0] || null;
    };
    const take = (c, k) => { c.used = true; left[c.job]--; leaving.add(c.i); add[k].push(c.i); crew.push([c.i, c.job, k]); };
    const tOf = k => { const r = rateOf(s, nav, k, add[k], leaving); return r > 1e-9 ? df.d[k] / r * H : Infinity; };
    // the slowest pile first gets the first pup
    const order = R.map(k => [k, tOf(k)]).sort((a, b) => b[1] - a[1] || R.indexOf(a[0]) - R.indexOf(b[0])).map(x => x[0]);
    for (const k of order) { if (crew.length >= C.MAX) break; const c = best(k, true); if (c) take(c, k); }
    if (!crew.length) return { ok: false, why: 'busy' };
    const full = new Set();
    while (crew.length < C.MAX) {
      let kk = null, tt = C.GOAL; for (const k of order) { if (full.has(k)) continue; const t = tOf(k); if (t > tt) { tt = t; kk = k; } }
      if (kk === null) break; const c = best(kk, false); if (c) take(c, kk); else full.add(kk);
    }
    let t = 0; for (const k of R) t = Math.max(t, tOf(k));
    crew.sort((a, b) => R.indexOf(a[2]) - R.indexOf(b[2]) || a[0] - b[0]);
    return { ok: true, pid, crew, t, d: df.d, other: df.other };
  }
  // the player's Send them: moves the crew (Sim.assign = stop where they are, walk to the new job from there)
  function start(s, nav, pid) {
    const p = plan(s, nav, pid); if (!p.ok) return p;
    for (const [i, , k] of p.crew) Sm().assign(s, i, k, nav);
    s.help = { pid, at: Math.round(s.time), crew: p.crew.map(c => c.slice()) };
    return p;
  }
  // everyone still in the crew back to the job they had; a pup on a skyboat gets it at once and starts it when it lands
  function back(s, nav, why, ev) {
    const h = s.help; if (!h) return null; const e = s.plots[h.pid], home = [], later = [];
    for (const [i, old, k] of h.crew) { const p = s.pups[i]; if (!p || p.job !== k) continue; (p.exp ? later : home).push(i); Sm().assign(s, i, old, nav); }
    delete s.help;
    const r = { type: 'help-back', pid: h.pid, kind: e ? e.type : null, why, pups: home, later };
    if (ev) ev.push(r); return r;
  }
  const stopNow = (s, nav, ev) => back(s, nav, 'now', ev);
  // Sim.step (after the pups moved, so a payment this step is seen this step)
  function tick(s, dt, nav, ev) {
    const h = s.help; if (!h) return;
    h.crew = h.crew.filter(c => s.pups[c[0]] && s.pups[c[0]].job === c[2]);   // moved by hand = left the crew (the player's choice stays)
    if (!h.crew.length) { delete s.help; return; }
    const e = s.plots[h.pid]; let why = null;
    if (!e) why = 'gone'; else if (e.done) why = 'built'; else if (e.paid) why = 'paid';
    else if (s.time - h.at >= C.LIMIT) why = 'time';
    else {   // the crew's piles are all in: everything here = 'ready' (a busy builder pays it the moment it is free), else 'part'
      const df = deficit(s, nav, h.pid);
      if (!df) why = 'gone'; else if (h.crew.every(c => df.d[c[2]] === undefined)) why = df.other.length || Object.keys(df.d).length ? 'part' : 'ready';
    }
    if (why) back(s, nav, why, ev);
  }
  const crewOf = (s, i) => { if (!s.help) return null; const c = s.help.crew.find(x => x[0] === i); return c ? c[2] : null; };

  // ---- save (v16): {pid, at, crew} in this key order; bad entries dropped (pup gone, bad jobs, twice); a plot that is gone
  // keeps the crew so the first step sends them home
  function sanitize(s, o) {
    delete s.help; const h = o && o.help; if (!h || typeof h !== 'object' || !Array.isArray(h.crew) || !Number.isInteger(h.pid)) return;
    const JOBS = Sm().JOBS, seen = new Set(), crew = [];
    for (const c of h.crew.slice(0, 16)) {
      if (!Array.isArray(c) || c.length !== 3) continue; const [i, old, k] = c;
      if (!Number.isInteger(i) || i < 0 || i >= s.pups.length || seen.has(i) || !JOBS.includes(old) || old === 'build' || !C.RES.includes(k) || old === k) continue;
      seen.add(i); crew.push([i, old, k]); if (crew.length >= C.MAX) break;
    }
    if (!crew.length) return;
    const at = typeof h.at === 'number' && isFinite(h.at) ? Math.max(s.time - C.LIMIT, Math.min(s.time, h.at)) : s.time;
    s.help = { pid: h.pid, at: Math.round(at), crew };
  }

  window.Help = { C, plan, start, back, stopNow, tick, deficit, perPup, crewOf, sanitize };
})();
