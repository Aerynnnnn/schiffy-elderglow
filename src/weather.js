// Weather (seasons + weather pass, 2026-11-01): rain spells, snow, wind and the everyday breeze. Pure + deterministic, NO saved
// state: the weather at any moment is a function of the island's event seed (S.events.seed) and its LOCAL clock (S.ep0 + S.time,
// the same frame the seasons use), so online steps, the offline catch-up and a reloaded save all see the same sky. S.ep0 === null
// (sim_check's step 1-4 cases, a state the game has not anchored yet) = no weather at all (every effect x1).
// One roll per local HOUR (a spell); the visuals ease from one hour's value into the next (curve), the sim uses that curve
// sampled once per 10 min PIECE, so a step of any size integrates the same numbers. Each season has its own odds (C.RAIN_P /
// C.WIND_P: spring showers, dry summers, windy autumns, winter snow instead of rain).
// What it does (small, cozy, never punishing; numbers in C):
//  - rain fills Water a little (+C.WATER/h at full rain, snow C.SNOW_K of that) and the wet ground helps gardens + gardeners
//    (+C.GARDEN, fading as the ground dries; not in snow)
//  - wind: woodcutters bring more (fallen branches, +C.WOOD), sky boats that leave in a wind ride it home sooner (-C.TAIL of the
//    trip; Exped asks tripDur at departure + on load), and the ground dries faster (wet fades up to 2.5x quicker)
//  - critters (src/critters.js): the rain ones (frog, snail) come x RAIN_K in rain, the wind ones (finch, petal sprites) x WIND_K
// The game shows it (src/weather_fx.js: rain, ripples, puddles, wet ground, gusts, umbrellas; a weather chip + the tree's line).
(function () {
  'use strict';
  const H = 3600, PIECE = 600;
  const C = {
    RAIN_P: [0.24, 0.1, 0.2, 0.18],   // share of hours that start a rain (winter: snow) spell, per season [spring, summer, autumn, winter]
    WIND_P: [0.26, 0.12, 0.38, 0.24], // share of windy hours
    BREEZE: 0.16,                     // the everyday breeze (wind 0..1), a calm hour is 0.08 .. 0.24
    WATER: 12, SNOW_K: 0.4,           // Water need + per hour at full rain; snow gives less (it melts slowly)
    GARDEN: 0.2, WOOD: 0.15, TAIL: 0.12,
    DRY: 6,                           // wet ground dries over 6 pieces (1 h) in calm air; a full wind dries it 2.5x faster
    RAIN_ON: 0.3, WIND_ON: 0.5,       // "raining" / "windy" for critters + words
  };
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const u = x => (x % 10007) / 10007;
  const sm = f => f * f * (3 - 2 * f);
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const seaAt = sec => { const S = window.Seasons; if (!S) return 0; return S.fix !== null ? S.fix : S.idxOf(sec); };
  const windyOf = w => clamp01((w - 0.3) / 0.5);

  // one hour's spell: [rain 0..1, wind 0..1, season]
  const HC = new Map();
  function hourVal(seed, hr) {
    const key = seed + ':' + hr + ':' + (window.Seasons ? window.Seasons.fix : ''); let v = HC.get(key); if (v) return v;
    const k = seaAt(hr * H + H / 2);
    const a = hash((seed ^ 0x5bd1e995) + Math.imul(hr, 2654435761)), b = hash(a + 11), c = hash(a + 23), d = hash(a + 37);
    const r = u(a) < C.RAIN_P[k] ? 0.35 + 0.65 * u(b) : 0;
    let w = u(c) < C.WIND_P[k] ? 0.55 + 0.45 * u(d) : C.BREEZE * (0.5 + u(d));
    if (r > 0.7) w = Math.max(w, 0.42 + 0.3 * u(d));   // a heavy rain comes with a breeze
    v = [r, w, k]; if (HC.size > 4000) HC.clear(); HC.set(key, v); return v;
  }
  // the continuous curve (visuals): each hour's value sits at its centre, eased into the next
  function curve(seed, sec) {
    const x = sec / H - 0.5, h0 = Math.floor(x), f = sm(x - h0), A = hourVal(seed, h0), B = hourVal(seed, h0 + 1);
    return { r: A[0] + (B[0] - A[0]) * f, w: A[1] + (B[1] - A[1]) * f, snow: seaAt(sec) === 3 };
  }
  // the sim's value for 10-min piece j (local time), the curve at the piece's centre
  const piece = (seed, j) => curve(seed, (j + 0.5) * PIECE);
  // ground wetness 0..1 at piece j: the strongest recent rain, drying over C.DRY pieces (faster in a wind); snow does not wet
  function wetAt(seed, j) {
    const dec = (1 + 1.5 * windyOf(piece(seed, j).w)) / C.DRY; let wet = 0;
    for (let i = 0; i * dec < 1; i++) { const p = piece(seed, j - i); if (!p.snow) wet = Math.max(wet, p.r * (1 - i * dec)); }
    return wet;
  }
  const on = s => !!(s && typeof s.ep0 === 'number' && isFinite(s.ep0) && s.events && s.events.seed);
  const pieceOf = (s, t) => Math.floor((s.ep0 + (t === undefined ? s.time : t)) / PIECE);
  // the weather the sim uses at island time t (default now)
  function at(s, t) {
    if (!on(s)) return { on: false, r: 0, w: 0, wet: 0, snow: false, windy: 0 };
    const j = pieceOf(s, t), p = piece(s.events.seed, j);
    return { on: true, r: p.r, w: p.w, snow: p.snow, wet: wetAt(s.events.seed, j), windy: windyOf(p.w) };
  }
  // sim multipliers (sim.js sea(), needs.js gardeners): x1 without weather
  function k(s, key) {
    if (!on(s)) return 1;
    if (key === 'garden' || key === 'nourish') { const a = at(s); return a.snow ? 1 : 1 + C.GARDEN * a.wet; }
    if (key === 'wood') return 1 + C.WOOD * at(s).windy;
    return 1;
  }
  // per sim step (Sim.step, after Events): rain + snow fill Water, piece by piece (any step size = the same sum)
  function tick(s, dt) {
    if (!on(s) || dt <= 0) return;
    const seed = s.events.seed; let L = s.ep0 + s.time; const L1 = L + dt; let add = 0;
    while (L < L1 - 1e-9) {
      const j = Math.floor(L / PIECE), e = Math.min(L1, (j + 1) * PIECE), p = piece(seed, j);
      if (p.r > 0) add += p.r * (p.snow ? C.SNOW_K : 1) * C.WATER * (e - L) / H;
      L = e;
    }
    if (add > 0) s.needs.water = Math.min(100, s.needs.water + add);
  }
  // a sky boat leaving at island time dep rides the wind home sooner (Exped: at departure + on load, so a reload agrees)
  function tripDur(s, sec, dep) {
    if (!on(s) || !(dep >= 0)) return sec;
    return Math.round(sec * (1 - C.TAIL * windyOf(piece(s.events.seed, pieceOf(s, dep)).w)));
  }
  const rainAt = (s, t) => { const a = at(s, t); return a.r; };
  const windAt = (s, t) => at(s, t).windy;

  // ---- words (UI chip + the tree's line): kind + what it is doing right now
  function kind(a) {
    if (!a.on) return 'clear';
    if (a.r > 0.12) return a.snow ? 'snow' : a.r > 0.6 ? 'rain' : 'drizzle';
    if (a.windy > 0.4) return 'windy';
    if (a.wet > 0.2) return 'wet';
    return a.w > 0.2 ? 'breezy' : 'clear';
  }
  const TITLE = { clear: 'Clear', breezy: 'Breezy', windy: 'Windy', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snowfall', wet: 'After the rain' };
  function effects(s, a) {
    a = a || at(s); const out = [];
    if (!a.on) return out;
    if (a.r > 0.05) out.push({ ic: 'water', t: `Water +${Math.max(1, Math.round(a.r * (a.snow ? C.SNOW_K : 1) * C.WATER))}/h` });
    if (!a.snow && a.wet > 0.05) out.push({ ic: 'garden', t: `Gardens +${Math.max(1, Math.round(C.GARDEN * a.wet * 100))}%` });
    if (a.windy > 0.05) {
      out.push({ ic: 'wood', t: `Woodcutters +${Math.max(1, Math.round(C.WOOD * a.windy * 100))}%` });
      out.push({ ic: 'boat', t: `Sky boats ${Math.max(1, Math.round(C.TAIL * a.windy * 100))}% faster` });
      if (a.wet > 0.05 && !a.snow && a.r < 0.05) out.push({ ic: 'dry', t: 'Drying fast' });
    }
    return out;
  }
  const LINES = {
    rain: ['Rain on my leaves. I am drinking slowly, all the way down to the roots.', 'Listen: every leaf is a little drum. The gardens will be glad of this.', 'The pups think they hide from the rain under me. I lift my branches a little higher.'],
    drizzle: ['A soft rain. Just enough to wake the moss.', 'Drizzle. The river is humming to itself.'],
    snow: ['Snow is falling. It settles on my branches like a quiet blanket.', 'Every flake that melts is a sip for my roots.'],
    windy: ['The wind is up. It shakes dry branches loose for the woodcutters.', 'Feel that wind! The sky boats will ride it home.', 'Hold on to your hats, little ones. The wind is playing.'],
    breezy: ['A little breeze. It tickles.', 'The breeze carries the smell of the meadows up to me.'],
    wet: ['The ground is soft and wet. The gardens are drinking it all up.', 'Puddles everywhere. I can hear pups splashing.'],
  };
  const line = (kd, n) => { const L = LINES[kd]; return L ? L[((n % L.length) + L.length) % L.length] : null; };

  window.Weather = { C, PIECE, curve, piece, wetAt, at, k, tick, tripDur, rainAt, windAt, windyOf, kind, TITLE, effects, line, on, hourVal };
})();
