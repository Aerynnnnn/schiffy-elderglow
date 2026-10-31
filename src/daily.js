// Daily gift (attendance calendar). Pure JS on the sim state S (S.daily, S.inv, S.res, S.sap, S.invite); no three.js,
// no Date.now(): the caller passes the local time, so sim_check can test any calendar.
// Rules (cozy + fair):
//  - one gift per LOCAL calendar day, claimed by a tap on the first open of that day;
//  - a 7-day cycle of growing gifts that never resets: a missed day just means the next tile waits for you;
//  - a gentle streak bonus (+5 % per consecutive day, max +30 %) that only goes back to +0 % when a day is missed;
//  - a monthly bonus on the MONTH_GOAL-th gift of a calendar month;
//  - anti-cheese: a gift needs today > the highest day ever claimed (S.daily.maxDay), so turning the clock back never
//    gives a second gift (it only waits until the real date passes the last claim again).
(function () {
  'use strict';
  const DAY = 864e5;
  const C = { MONTH_GOAL: 20, STREAK_STEP: 0.05, STREAK_MAX: 0.3, RARE_SAP: 80 };
  const dayNum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);   // local date -> day number
  const monthKey = d => d.getFullYear() * 12 + d.getMonth();
  const WEEK = [
    { res: { wood: 25 } },
    { res: { food: 40 } },
    { res: { stone: 20 } },
    { res: { wood: 15 }, seeds: 3 },
    { sap: 30, decor: 'firefly-jar' },
    { res: { wood: 30, stone: 25, food: 30 } },
    { rare: true },
  ];
  const OUTFITS = { 'moon-scarf': 'Moonlit scarf', 'firefly-cape': 'Firefly cape', 'acorn-cap': 'Acorn cap', 'star-collar': 'Star collar', 'leaf-hood': 'Leaf hood', 'sun-bandana': 'Sunny bandana',
    // expedition rare finds (src/expedition.js OUTFITS); listed last so the day-7 gifts give the six above first
    'cloud-cape': 'Cloud cape', 'feather-cap': 'Feather cap', 'sky-goggles': 'Sky goggles' };
  const DECOR = { 'firefly-jar': 'Firefly jar', 'moon-lantern': 'Moon lantern' };
  const LUMEN = { id: 'lumen', name: 'Lumen', breed: 'mochi', collar: '#9fe8ff', like: 'light', dislike: 'wood' };

  const streakK = n => 1 + Math.min(C.STREAK_MAX, C.STREAK_STEP * Math.max(0, n - 1));
  // the gift on tile `pos` (0..6) of cycle `cycle` with a streak of `streak` days (incl. today); `own` = S.inv
  function giftFor(pos, cycle, streak, own) {
    const w = WEEK[pos], k = streakK(streak), g = { pos, cycle, streak, k, res: {}, sap: 0, seeds: 0, decor: null, outfit: null, pup: null };
    for (const r in w.res || {}) g.res[r] = Math.round(w.res[r] * k);
    if (w.sap) g.sap = Math.round(w.sap * k);
    if (w.seeds) g.seeds = w.seeds;
    if (w.decor) g.decor = w.decor;
    if (w.rare) {
      if (cycle % 2 === 1 && !(own && own.lumen)) g.pup = Object.assign({}, LUMEN);   // every second week: a special pup
      else { const o = Object.keys(OUTFITS).find(id => !(own && own.outfits.includes(id))); if (o) g.outfit = o; else g.sap = Math.round(C.RARE_SAP * k); }
    }
    return g;
  }
  // what the calendar shows right now
  function status(S, now) {
    const d = S.daily, today = dayNum(now), can = today > d.maxDay;
    const streakNext = d.last >= 0 && today - d.last === 1 ? d.streak + 1 : 1;
    const n = can || d.claims === 0 ? d.claims : d.claims - 1;   // the cycle on screen: the one today's gift is (or was) in
    const cycle = Math.floor(n / 7), start = cycle * 7;
    const tiles = [];
    for (let k = 0; k < 7; k++) {
      const idx = start + k, done = idx < d.claims, isToday = can ? idx === d.claims : idx === d.claims - 1;
      tiles.push({ k, done, today: isToday, gift: giftFor(k, cycle, done ? (isToday ? d.streak : 1) : can ? streakNext + k - (d.claims - start) : d.streak + 1 + k - (d.claims - start), S.inv) });
    }
    const mk = monthKey(now), mN = d.mkey === mk ? d.mN : 0;
    return { today, can, back: d.maxDay >= 0 && today < d.maxDay, waitDays: can ? 0 : d.maxDay + 1 - today, missed: d.last >= 0 && today - d.last > 1,
      streak: can ? streakNext : d.streak, bonusPct: Math.round((streakK(can ? streakNext : d.streak) - 1) * 100), cycle, tiles,
      month: { n: mN, goal: C.MONTH_GOAL, done: mN >= C.MONTH_GOAL } };
  }
  // claim today's gift: returns what was given, or null when today's gift was already taken (or the clock went back)
  function claim(S, now) {
    const d = S.daily, today = dayNum(now);
    if (!(today > d.maxDay)) return null;
    const streak = d.last >= 0 && today - d.last === 1 ? d.streak + 1 : 1;
    const g = giftFor(d.claims % 7, Math.floor(d.claims / 7), streak, S.inv);
    for (const r in g.res) S.res[r] += g.res[r];
    S.sap += g.sap; S.inv.seeds += g.seeds;
    if (g.decor) S.inv.decor.push(g.decor);
    if (g.outfit) S.inv.outfits.push(g.outfit);
    if (g.pup) { S.inv.lumen = true; S.invite = Object.assign({}, g.pup); }
    // monthly bonus on the MONTH_GOAL-th gift of this calendar month
    const mk = monthKey(now); if (d.mkey !== mk) { d.mkey = mk; d.mN = 0; }
    d.mN++;
    if (d.mN === C.MONTH_GOAL) {
      g.month = { sap: 100, decor: S.inv.decor.includes('moon-lantern') ? null : 'moon-lantern', seeds: S.inv.decor.includes('moon-lantern') ? 5 : 0 };
      S.sap += g.month.sap; S.inv.seeds += g.month.seeds; if (g.month.decor) S.inv.decor.push(g.month.decor);
    }
    d.streak = streak; d.last = today; d.maxDay = Math.max(d.maxDay, today); d.claims++;
    return g;
  }
  window.Daily = { C, WEEK, OUTFITS, DECOR, LUMEN, dayNum, monthKey, giftFor, status, claim, streakK };
})();
