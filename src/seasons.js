// Seasons (step 5): one season per real WEEK (Mon 00:00 local -> Sun 24:00), spring -> summer -> autumn -> winter, so the
// whole cycle takes 4 weeks = about the climb from a sapling to the Elder Tree (every player sees every season while the
// tree grows). Why not the real calendar: 3-month seasons would show one season for the whole climb, the two hemispheres
// disagree, and the tropics (the user's own Malaysia) have none at all. Pure + deterministic: the season is a function of
// the island's LOCAL timestamp only (S.ep0 + S.time; the game anchors S.ep0 to the player's local clock like S.clock0), so
// online steps, the offline catch-up (which lives through the real hours) and a reloaded save all agree, across a season
// change too. S.ep0 === null (sim_check's step 1-4 cases, a state before the game anchors it) = no season (all x1).
// Effects stay small and cozy (numbers in FX): spring gardeners +20 %; summer longer days, thirstier tree, +10 % sap;
// autumn harvest (gathering + gardens +25 %); winter shorter days, light matters more (light need -30 % faster, lantern paths
// +50 %), the tree drinks less. Visuals are tints + particles (src/season_fx.js, ElderMap.uSeason), never new models.
(function () {
  'use strict';
  const DAY = 86400, WEEK = 7 * DAY;
  const NAMES = ['spring', 'summer', 'autumn', 'winter'];
  const TITLE = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  // week index of a local timestamp (seconds since 1970-01-01 00:00 LOCAL; that day was a Thursday, so +3 days = Monday)
  // OFFSET puts the week of Mon 2026-10-26 (this build's week) on autumn
  const OFFSET = 1, BLEND = 6 * 3600;   // visuals fade from the old season over the first 6 h of the new week (night)
  const weekOf = sec => Math.floor((sec + 3 * DAY) / WEEK);
  const idxOf = sec => (((weekOf(sec) + OFFSET) % 4) + 4) % 4;
  const FX = {
    spring: { nourish: 1.2 },
    summer: { waterDecay: 1.15, sap: 1.1 },
    autumn: { gather: 1.25, garden: 1.25 },
    winter: { lightDecay: 1.3, waterDecay: 0.8, lantern: 1.5 },
  };
  // day length: real hours are warped onto the standard day curve (Sim.dayCurve) - summer sunrise ~45 min earlier and
  // sunset ~45 min later, winter sunrise 30 min later and dusk an hour earlier. Midnight + noon are fixed points, so the
  // warp is continuous across the Monday-midnight season change.
  const WARP = { spring: [0, 0], summer: [0.75, 0.75], autumn: [0, 0], winter: [-0.5, -1.0] };
  function warp(h, k) {
    if (k === null || k === undefined) return h;
    const w = WARP[NAMES[k]], m = w[0], e = w[1]; if (!m && !e) return h;
    const K = [[0, 0], [6 - m, 6], [13, 13], [19.5 + e, 19.5], [24, 24]];
    h = ((h % 24) + 24) % 24;
    for (let i = 1; i < K.length; i++) if (h <= K[i][0]) { const a = K[i - 1], b = K[i]; return a[1] + (b[1] - a[1]) * (h - a[0]) / (b[0] - a[0]); }
    return h;
  }
  let fix = null;   // tests / screenshots only (__game.setSeason, ?season=): forces a season (never saved)
  function at(sec) {
    const k = fix !== null ? fix : idxOf(sec), w = weekOf(sec), into = sec + 3 * DAY - w * WEEK;
    return { k, name: NAMES[k], week: w, day: Math.floor(into / DAY), left: WEEK - into, into };
  }
  const of = s => (s && typeof s.ep0 === 'number' && isFinite(s.ep0)) ? (fix !== null ? fix : idxOf(s.ep0 + s.time)) : null;
  const k = (s, key) => { const i = of(s); if (i === null) return 1; const v = FX[NAMES[i]][key]; return v === undefined ? 1 : v; };
  // visual weights [spring, summer, autumn, winter] (sum 1): the old season fades out over BLEND after the change
  function weights(sec) {
    const w = [0, 0, 0, 0], a = at(sec); if (fix !== null) { w[fix] = 1; return w; }
    const f = Math.min(1, a.into / BLEND), u = f * f * (3 - 2 * f), prev = (a.k + 3) % 4;
    w[a.k] += u; w[prev] += 1 - u; return w;
  }
  // the player's local timestamp now (seconds), the same frame as S.ep0 + S.time
  const localNow = () => { const d = new Date(); return d.getTime() / 1000 - d.getTimezoneOffset() * 60; };
  window.Seasons = { NAMES, TITLE, FX, WARP, OFFSET, BLEND, DAY, WEEK, weekOf, idxOf, at, of, k, warp, weights, localNow,
    get fix() { return fix; }, set fix(v) { fix = v === null || v === undefined ? null : ((+v % 4) + 4) % 4; } };
})();
