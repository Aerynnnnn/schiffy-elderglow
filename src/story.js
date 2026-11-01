// Story (Round 2 step 2, pure, no three.js, no Math.random, no clock): colour restoring + the Elder Tree's voice + tree
// dreams + pup diaries. Loaded after social.js; Sim.step calls Story.tick at the end of every step (it reads the events the
// step pushed), Sim.create / sanitize call Story.create / sanitize / pupIn.
//
// COLOUR: the island starts grey + misty and colour returns outward from the tree in RINGS (plaza -> meadows + rivers ->
// near woods -> far woods / cliffs / mountains -> sky isles). Progress P = the tree's fractional level (level - 1 + share of
// the way to the next level) + up to CARE_MAX from total care (deliveries + sky trips). P is a pure function of the state,
// so online play, the offline catch-up and a reloaded save agree; an old save just gets the radius of its progress. Inside a
// ring the colour creeps out a little (CREEP of the gap); crossing a ring's p sends a COLOUR WAVE to the next ring (sim event
// `bloom`, the game animates it). The renderer reads radius(S) only (one uniform set, src/elder_map.js).
// VOICE: the tree's words go to S.story.log (chapters, milestone reactions, dreams, visits); the game shows at most ONE
// unprompted message per session open (pick = Story.next), the rest wait in the Book ("Tree's words"). Chapters: one per
// day PLAYED (Story.openDay, local date) once progress reaches the chapter's p.
// DIARIES: each pup keeps one line per notable island day (arrival, trips, friends, puppies, wishes, builds, colour waves,
// a busy day at its job): p.dd = today's best entry, flushed into p.dy at the island's midnight.
(function () {
  'use strict';
  const DAY = 86400;
  const C = {
    // r = colour radius in metres from the tree (height above Y0 counts x YK, so the sky isles come last), p = progress at
    // which the wave reaches it. P: L1 0..1, L2 1..2, ... L8 = 7 (+ care up to 0.5). Full colour = the last ring.
    RINGS: [
      { id: 'start', r: 22, p: 0, name: 'the tree' },
      { id: 'plaza', r: 96, p: 0.3, name: 'the plaza' },
      { id: 'meadow', r: 215, p: 1.5, name: 'the meadows and the rivers' },
      { id: 'forest', r: 305, p: 2.6, name: 'the near woods' },
      { id: 'far', r: 485, p: 4.0, name: 'the far woods, the cliffs and the mountains' },
      { id: 'sky', r: 1500, p: 5.5, name: 'the sky isles' },
    ],
    Y0: 30, YK: 2, EDGE: 26, NOISE: 18,   // shader: soft edge half-width (m) + edge wobble (m)
    CREEP: 0.3, CARE_T: 200000, CARE_MAX: 0.5, EXP_W: 400,   // care = deliveries (+ 400 per sky trip): ~a week of play
    LOG_MAX: 80, DIARY_MAX: 24, DREAM_NIGHT: 5400,   // a dream needs >= 1.5 h of night in the catch-up
  };
  const JOBS = ['water', 'light', 'nourish', 'protect', 'spirit', 'wood', 'stone', 'food', 'build', 'rest'];
  const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
  const pick = (arr, h) => arr[h % arr.length];
  const Sim_ = () => window.Sim;

  // ---------------------------------------------------------------- colour progress (pure)
  function bloom(s) {
    const Sm = Sim_(), LV = Sm.C.LV_XP, lv = Math.max(1, Math.min(Sm.C.MAX_LV, s.level || 1));
    const lvf = (lv - 1) + (lv < Sm.C.MAX_LV ? Math.max(0, Math.min(1, ((s.xp || 0) - LV[lv - 1]) / (LV[lv] - LV[lv - 1]))) : 0);
    const st = s.stats || {}, care = (st.trips || 0) + C.EXP_W * (st.exped || 0);
    return lvf + C.CARE_MAX * Math.min(1, care / C.CARE_T);
  }
  function ringOf(P) { let k = 0; for (let i = 1; i < C.RINGS.length; i++) if (P >= C.RINGS[i].p) k = i; return k; }
  const LAST = () => C.RINGS.length - 1;
  // the radius the island has earned (m); ring = which ring the last wave reached; full = everything coloured
  function radiusOf(P) {
    const k = ringOf(P), R = C.RINGS, a = R[k];
    if (k === LAST()) return { R: a.r, ring: k, full: true, P };
    const b = R[k + 1], f = Math.max(0, Math.min(1, (P - a.p) / (b.p - a.p)));
    return { R: a.r + (b.r - a.r) * C.CREEP * f, ring: k, full: false, P };
  }
  const radius = s => radiusOf(bloom(s));
  const ringR = k => C.RINGS[Math.max(0, Math.min(LAST(), k))].r;

  // ---------------------------------------------------------------- the tree's words
  // ~30 chapters, one per day played once the island has grown far enough (p = progress P)
  const CH = [
    [0, 'Hello', 'Oh, hello. I have been listening to your pups for a while now, but trees are slow to find their words. Today I found a few. Stay a while?'],
    [0.1, 'The grey', 'You must wonder why everything is grey. Colour is not lost, little one. It is only sleeping, the way a seed sleeps. It is waiting for a reason to wake.'],
    [0.3, 'Water', 'The first bucket of water tasted like a song I used to know. I felt it all the way down, past the stones, where my oldest roots keep their secrets.'],
    [0.5, 'Footsteps', 'Some of your pups hum while they work. Some count their steps and lose count at seven. I am learning them one footstep at a time.'],
    [0.8, 'Long ago', 'Long ago this island was loud with colour. Blue rivers, red roofs, a meadow so yellow the bees got lost in it. Then the sky grew quiet, and so did I.'],
    [1.1, 'Why it faded', 'No storm took the colour. Nobody stole it. The pups who lived here sailed away one by one, and no one was left to sing to the island. Colour stays where it is cared for. That is all.'],
    [1.5, 'Green', 'Did you see the grass this morning? Green, as if it had only been holding its breath. I am a little proud of it. I am a little proud of you.'],
    [1.9, 'The river', 'The river has started talking again. It says the same thing over and over, but it says it so cheerfully that I do not mind.'],
    [2.2, 'Lanterns', 'At night your lantern keepers walk in little circles of gold. From up here they look like fireflies who learned to be patient.'],
    [2.5, 'Tree dreams', 'Trees dream, you know. Slowly. One dream can take a whole winter. Lately mine are full of small feet and the smell of berries.'],
    [2.8, 'The mist', 'The mist is not unkind. It is only the island pulling a blanket over its head. Every morning it lets a little more of the world peek out.'],
    [3.0, 'The isles', 'The floating isles were my seeds once. The wind carried them up and they never came down. I think they like the view. I think they miss me a little.'],
    [3.3, 'Two by two', 'Two of your pups worked side by side all day, and now they walk home the long way, together. I have watched that for a hundred years. It never gets old.'],
    [3.6, 'Family', 'The near woods are waking. Some of those trees are my grandchildren. They rustle at night and never let anyone sleep, but they are family.'],
    [3.9, 'Rings', 'Inside me there is a ring for every year. The grey years are thin, like pencil lines. This year\'s ring is going to be thick and warm. I can feel it.'],
    [4.1, 'Rain', 'When it rains, the pups stand under my branches and pretend they are not getting wet. I lift my leaves a little higher for them. Do not tell.'],
    [4.4, 'The cliffs', 'The old rune cliffs remember a song in a language I have nearly forgotten. As the colour climbs them, I hear one more word of it each day.'],
    [4.7, 'Blue hills', 'The mountains turned blue at dawn today. They used to do that every morning. I had stopped expecting it.'],
    [5.0, 'Stars', 'The stars are the same stars. They were never grey. I only stopped looking up. Your pups look up all the time.'],
    [5.3, 'Last', 'Look up: the sky isles are waiting their turn. They are always last. They like to make an entrance.'],
    [5.5, 'Whole', 'There. The whole island, every leaf and every stone, awake. Trees are not good at saying things. Thank you will have to do.'],
    [5.7, 'After', 'Colour, it turns out, is not the end of the story. It is only the part where everybody can finally see each other.'],
    [5.9, 'Other trees', 'Far away, past the clouds, there are other trees like me. When the wind is right I feel them stir. Some of them are still asleep.'],
    [6.1, 'Seasons', 'Every season leaves something behind. Spring leaves petals in the pups\' fur. Winter leaves quiet. I like both.'],
    [6.3, 'Small things', 'A pup napped in my roots today with a berry in its paw, too sleepy to eat it. I have grown very tall, but this is the kind of thing I keep.'],
    [6.5, 'The old pups', 'I used to think the pups who sailed away took the colour with them. Now I think they left it here on purpose, for whoever came next.'],
    [6.7, 'Not old', 'They will call me the Elder Tree soon. I do not feel old. I feel like someone who just woke up and found breakfast waiting.'],
    [6.8, 'Listening', 'If you sit still at night you can hear the island breathing: the river, the crickets, a pup snoring. That is the sound of a place being loved.'],
    [6.9, 'Seeds', 'I have been making seeds again. Not for me. For the next grey island, wherever it is, waiting for someone like you.'],
    [7.0, 'The light on', 'On the days you are away, I keep the light on. Not because I worry. Just so you can find your way back. Come home whenever you like.'],
  ].map(([p, t, x]) => ({ p, t, x }));
  // milestone reactions (key -> title + words; {x} = a name)
  const MS = {
    home1: ['A door', 'A house! With a door and a little window and everything. Someone is planning to stay.'],
    arrive1: ['A stranger', 'Someone crossed the bridge today and nobody had to ask them twice. That is how you know a place is waking up.'],
    trip1: ['Home from the sky', 'The boat came home heavy with treasures and light with laughter. I watched it the whole way, the way you watch a kettle.'],
    puppy1: ['Small', 'A puppy. On my island. I had forgotten how small new things are.'],
    wave1: ['Warm stones', 'Feel that? The stones by my door remembered that they are warm and golden. It is only a little colour. It is a beginning.'],
    wave2: ['Green and blue', 'The meadows woke up green and the rivers remembered they are blue. I may have cried a little sap.'],
    wave3: ['The near woods', 'The near woods are green again. My grandchildren are already showing off.'],
    wave4: ['The edges', 'All the way to the cliffs and the mountains. I can see the edges of my island again, and they are beautiful.'],
    wave5: ['Every colour', 'Even the sky isles. Everything. Every colour came home.'],
    sea0: ['Spring', 'Spring. The blossoms do not ask whether they are ready. They just open. I am trying to learn that.'],
    sea1: ['Summer', 'Summer, and the days are long and lazy. Keep the water coming, little ones. I get thirsty when the sun shows off.'],
    sea2: ['Autumn', 'Autumn. My leaves are turning gold and red, and I let them go one at a time, like stories.'],
    sea3: ['Winter', 'Winter. The snow makes everything quiet, so I can hear every paw step. Keep the lanterns lit for me?'],
    crit1: ['Small guests', 'Did you see? Someone small came to visit, not a pup at all. The wild things are coming back. They only come where it feels like home.'],
    whale1: ['The whale', 'A sky whale sang over us today. I have not heard that song since I was a sapling. It means the sky remembers us.'],
    // Round 2 step 4: lantern notes + the World Bloom (src/lanterns.js)
    lan1: ['A lantern', 'A little light came drifting over the water tonight, all the way from another island. Somebody out there was thinking of us. Go on, read it.'],
    lanSent1: ['Kind words', 'You sent a light into the dark for someone you have never met. I watched it go until it was a star. That is the oldest kind of magic.'],
    warm1: ['Warmth', 'Someone sent warmth back. They will never know who you are, and they did not need to. Kindness does not need a name.'],
    bloomNew: ['A new bud', 'Far beyond the edge of the sky, a new bud is waking{x}. Every island that is cared for helps it open. Ours too.'],
    bloom0: ['The first ring', 'The World Bloom opened its first ring of petals. Every tree that was cared for is in it, a little. There is a gift for everyone.'],
    bloom1: ['Many hands', 'Another ring opened on the World Bloom. I never knew there were so many of us. It makes my roots tingle.'],
    bloom2: ['A guest of honour', 'The Bloom is so bright now that the crystal deer came down from the far hills to see it. One of them is coming here.'],
    bloom3: ['Crystal rain', 'When the Bloom opened again, a little crystal rain fell on every island at once. Imagine that: everywhere, together.'],
    bloom4: ['A seedling', 'The Bloom dropped seedlings on the wind, one for every island. Plant it somewhere you like to sit.'],
    bloom5: ['Full and golden', 'The World Bloom is nearly open. I can feel the other trees humming along with me, very far away.'],
    bloom6: ['Wide open', 'Wide open. Every petal. This is what all of us did, together, without ever meeting. I will remember this season.'],
    visit: ['A visitor','Someone from another island walked under my branches today{x}. They left the air a little warmer than they found it.'],
  };
  function words(e) {   // log entry -> { t: title, x: text, kind }
    if (!e) return null;
    if (e.k === 'dream') return { t: 'A dream', x: e.x || '', kind: 'dream' };
    const m = /^ch(\d+)$/.exec(e.k); if (m) { const c = CH[+m[1]]; return c ? { t: c.t, x: c.x, kind: 'chapter', n: +m[1] + 1 } : null; }
    const ms = MS[e.k]; if (!ms) return null;
    return { t: ms[0], x: ms[1].replace('{x}', e.x ? ', ' + e.x : ''), kind: 'moment' };
  }

  // ---------------------------------------------------------------- state
  const fresh = () => ({ ring: 0, day: -1, dn: 1, days: 0, open: -1, ch: 0, chDay: 0, sea: -1, m: [], fr: {}, log: [] });
  function create(s) {
    s.story = fresh();
    for (const p of s.pups) setDD(p, 'arr', 0, 0, 9);   // the six start pups: day 1 = waking up under the tree
  }
  const fin = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
  const int = (v, d, lo, hi) => Math.round(fin(v, d, lo, hi));
  // v8: older saves get the ring of their progress (no wave, no grey regression), an empty log, day 1 (pups: pupIn)
  function sanitize(s, o) {
    const q = o && o.story && typeof o.story === 'object' ? o.story : null;
    s.story = fresh();
    const st = s.story;
    if (!q) { st.ring = ringOf(bloom(s)); return; }
    st.ring = int(q.ring, 0, 0, LAST()); st.day = int(q.day, -1, -1, 1e7); st.dn = int(q.dn, 1, 1, 1e6); st.days = int(q.days, 0, 0, 1e6);
    st.open = int(q.open, -1, -1, 1e7); st.ch = int(q.ch, 0, 0, CH.length); st.chDay = int(q.chDay, 0, 0, st.days); st.sea = int(q.sea, -1, -1, 3);
    st.m = Array.isArray(q.m) ? [...new Set(q.m.filter(k => typeof k === 'string' && MS[k]))] : [];
    if (q.fr && typeof q.fr === 'object') for (const k of Object.keys(q.fr).sort()) if (/^\d{1,3}\.\d{1,3}$/.test(k)) { const a = k.split('.').map(Number); if (a[0] < s.pups.length && a[1] < s.pups.length) st.fr[k] = int(q.fr[k], 0, 0, 3); }
    if (Array.isArray(q.log)) for (const e of q.log.slice(-C.LOG_MAX)) {
      if (!e || typeof e.k !== 'string' || !(e.k === 'dream' || /^ch\d+$/.test(e.k) || MS[e.k])) continue;
      const r = { k: e.k, d: int(e.d, 1, 1, 1e6), u: e.u === 1 ? 1 : 0 };
      if (typeof e.x === 'string') r.x = e.x.replace(/[<>&"\u0000-\u001f]/g, '').slice(0, 400);
      if (words(r)) st.log.push(r);
    }
  }
  // per pup (called by Sim.sanitize after the pup is rebuilt): diary + today's entry + trips at the start of the day
  function pupIn(p, q) {
    p.dy = []; p.dd = null; p.dt0 = p.trips;
    if (!q || typeof q !== 'object') return;
    if (Array.isArray(q.dy)) for (const e of q.dy.slice(-C.DIARY_MAX)) if (Array.isArray(e) && e.length === 4 && Number.isInteger(e[0]) && typeof e[1] === 'string' && /^[a-z]{2,5}$/.test(e[1])) p.dy.push([e[0], e[1], int(e[2], 0, -1, 1e6), int(e[3], 0, -1, 1e6)]);
    if (Array.isArray(q.dd) && q.dd.length === 4 && typeof q.dd[0] === 'string' && /^[a-z]{2,5}$/.test(q.dd[0])) p.dd = [q.dd[0], int(q.dd[1], 0, -1, 1e6), int(q.dd[2], 0, -1, 1e6), int(q.dd[3], 0, 0, 9)];
    p.dt0 = int(q.dt0, p.trips, 0, p.trips);
  }
  // today's entry: [kind, a, b, priority]; a stronger moment replaces a weaker one (ties: the later one)
  function setDD(p, kind, a, b, pri) { if (!p) return; if (!p.dd || pri >= p.dd[3]) p.dd = [kind, a, b, pri]; }
  function say(s, k, x) {
    const st = s.story, e = { k, d: st.dn, u: 1 }; if (x !== undefined && x !== null && x !== '') e.x = String(x).slice(0, 400);
    st.log.push(e);
    while (st.log.length > C.LOG_MAX) { const i = st.log.findIndex(y => !y.u); st.log.splice(i >= 0 ? i : 0, 1); }
    return e;
  }
  function once(s, k, x) { if (s.story.m.includes(k)) return false; s.story.m.push(k); say(s, k, x); return true; }
  const dayIdx = s => Math.floor(((typeof s.ep0 === 'number' ? s.ep0 : s.clock0) + s.time) / DAY);
  const BKEYS = () => Object.keys(Sim_().C.B);

  // ---------------------------------------------------------------- per sim step (end of Sim.step)
  function tick(s, dt, ev, e0) {
    const st = s.story;
    for (let k = e0; k < ev.length; k++) {
      const e = ev[k], P = s.pups;
      if (e.type === 'arrive') {
        const p = P[e.pup]; if (!p) continue;
        if (e.puppy && p.parents) { setDD(p, 'born', p.parents[0], p.parents[1], 9); for (const q of p.parents) setDD(P[q], 'pup', e.pup, 0, 8); once(s, 'puppy1'); }
        else { setDD(p, 'arr', p.special ? 3 : 1, 0, 9); once(s, 'arrive1'); }
      } else if (e.type === 'exp-go') {
        const tr = s.exp.trips.find(x => x.id === e.trip); if (!tr) continue;
        for (const i of tr.team) setDD(P[i], 'go', tr.dest, 0, 3);
      } else if (e.type === 'exp-back') {
        const h = e.haul, fl = (h.crystal > 0 ? 1 : 0) | (h.pupIdx >= 0 ? 2 : 0) | (h.seeds > 0 ? 4 : 0) | (h.decor && h.decor.length ? 8 : 0);
        for (const i of h.team) setDD(P[i], 'back', h.dest, fl, 7);
        if (h.pupIdx >= 0) setDD(P[h.pupIdx], 'isle', h.dest, 0, 9);
        once(s, 'trip1');
      } else if (e.type === 'built') {
        const kind = s.plots[e.pid] ? s.plots[e.pid].type : e.kind, bi = BKEYS().indexOf(kind);
        for (const p of P) if (p.job === 'build' && !p.exp) setDD(p, 'blt', bi, 0, 4);
        if (kind === 'home') once(s, 'home1');
      } else if (e.type === 'event' && e.k === 'end' && e.out === 'done' && e.e.type === 'wish') setDD(P[e.e.pup], 'wish', JOBS.indexOf(e.e.want), 0, 5);
      else if (e.type === 'crit' && e.k === 'start') { once(s, 'crit1'); if (e.v.c === 'whale') once(s, 'whale1'); }   // Round 2 step 3: sky critters
    }
    // colour: a new ring = a wave (every ring between gets its line, in order)
    const r = ringOf(bloom(s));
    if (r > st.ring) {
      for (let k = st.ring + 1; k <= r; k++) once(s, 'wave' + k);
      for (const p of s.pups) if (!p.exp) setDD(p, 'wave', r, 0, 5);
      ev.push({ type: 'bloom', ring: r, from: st.ring, t: s.time }); st.ring = r;
    }
    // seasons (the real week, never the ?season= test override): a line when it changes (not the first one seen)
    if (typeof s.ep0 === 'number' && window.Seasons) { const k = window.Seasons.idxOf(s.ep0 + s.time); if (k !== st.sea) { if (st.sea >= 0) say(s, 'sea' + k); st.sea = k; } }
    // the island's midnight: diaries; a jump other than +1 day = the clock was re-anchored (nothing written)
    const di = dayIdx(s);
    if (st.day < 0) st.day = di;
    else if (di === st.day + 1) { midnight(s); st.day = di; }
    else if (di !== st.day) st.day = di;
    chapterCheck(s);
  }
  function midnight(s) {
    const st = s.story, N = window.Needs, later = [];
    // friendships that grew today (both pups write it; a pup whose day was already bigger writes it tomorrow)
    const frDD = (p, o, l) => { if (!p) return; if (p.dd && p.dd[3] > 6) later.push([p, o, l]); else setDD(p, 'fr', o, l, 6); };
    if (s.fr && s.fr.pairs && N) for (const k of Object.keys(s.fr.pairs)) {
      const l = N.lvOf(s.fr.pairs[k]); if (l <= (st.fr[k] || 0)) continue;
      st.fr[k] = l; const [a, b] = k.split('.').map(Number); frDD(s.pups[a], b, l); frDD(s.pups[b], a, l);
    }
    s.pups.forEach((p, i) => {
      const n = p.trips - (p.dt0 || 0);
      if (!p.dd && !p.exp) {
        const j = JOBS.indexOf(p.job), busy = ['water', 'light', 'wood', 'stone', 'food', 'nourish'].includes(p.job) ? n >= 5 : p.job === 'rest' ? hash(st.dn * 31 + i) % 3 === 0 : n >= 2 || p.job === 'build' || p.job === 'spirit' || p.job === 'protect';
        if (busy) p.dd = ['job', j, n, 1];
      }
      if (p.dd) { p.dy.push([st.dn, p.dd[0], p.dd[1], p.dd[2]]); if (p.dy.length > C.DIARY_MAX) p.dy.splice(1, 1); }   // keep the first line (arrival)
      p.dd = null; p.dt0 = p.trips;
    });
    for (const [p, o, l] of later) setDD(p, 'fr', o, l, 6);
    st.dn++;
  }
  // a chapter: at most one per day played, once the island has grown far enough
  function chapterCheck(s) {
    const st = s.story; if (st.ch >= CH.length || st.days <= st.chDay || bloom(s) < CH[st.ch].p) return false;
    say(s, 'ch' + st.ch); st.ch++; st.chDay = st.days; return true;
  }
  // the game: a new local date opened (Daily.dayNum); a clock turned back counts nothing
  function openDay(s, key) {
    const st = s.story; if (!(key > st.open)) return false;
    st.open = key; st.days++; chapterCheck(s); return true;
  }
  // someone visited (social news): one line a day at most
  function visit(s, name) {
    const st = s.story; if (st.log.some(e => e.k === 'visit' && e.d === st.dn)) return null;
    return say(s, 'visit', name ? String(name).replace(/[<>&"\u0000-\u001f]/g, '').slice(0, 24) : '');
  }

  // ---------------------------------------------------------------- the one-message-per-session rule
  // next unread message to show unprompted: the newest unread chapter, else the newest unread moment (dreams are shown on
  // the away card, never as a bubble). Returns the log index or -1.
  function next(s) {
    const L = s.story.log; let best = -1;
    for (let i = L.length - 1; i >= 0; i--) { const e = L[i]; if (!e.u || e.k === 'dream') continue; if (/^ch/.test(e.k)) return i; if (best < 0) best = i; }
    return best;
  }
  const unread = s => s.story.log.reduce((n, e) => n + (e.u ? 1 : 0), 0);
  function read(s, i) { const e = s.story.log[i]; if (e) e.u = 0; }
  function readAll(s) { for (const e of s.story.log) e.u = 0; }
  // a session (= one page open): speak() returns the entry to show or null; only the first call in a session can speak
  function Session() { return { n: 0, speak(s) { if (this.n >= 1) return null; const i = next(s); if (i < 0) return null; this.n++; read(s, i); return { i, e: s.story.log[i], w: words(s.story.log[i]) }; }, used(s) { this.n++; } }; }

  // ---------------------------------------------------------------- dreams (from the offline catch-up summary)
  const JOBF = {
    water: ['{a} carrying water by lantern light', '{a} filling buckets at the river while the moon watched', '{a} carrying water through the rain'],
    light: ['{a} keeping the orbs lit while the stars turned', '{a} walking in a little circle of gold'],
    wood: ['{a} stacking logs under the moon'], stone: ['{a} rolling stones home, one by one'], food: ['{a} with a basket of berries bigger than {o} head'],
    build: ['{a}\'s little hammer going tap, tap in the dark'], nourish: ['{a} tucking compost around my roots like a blanket'],
    protect: ['{a} sweeping the shadows from my roots'], spirit: ['{a}\'s music drifting up through my leaves'], rest: ['{a} curled up asleep between my roots'],
  };
  const OPEN = ['I dreamt of', 'Last night I dreamt of', 'While you were gone, I dreamt of'];
  const CLOSE = ['When I woke, the dew was still on my leaves.', 'It was a good dream. I think it was true.', 'I kept the best part for you.', 'Then morning came, softly, like a pup\'s nose.'];
  // sum = Sim.catchUp's summary (+ pupTrips, ringFrom / ringTo); s = the state after it. Pure: same summary -> same words.
  function dream(s, sum) {
    if (!sum || (sum.nightSec || 0) < C.DREAM_NIGHT) return null;
    const P = s.pups, nm = i => P[i] ? P[i].name : 'a pup', F = [];
    const h0 = hash(Math.floor(sum.sec || 0) * 7 + Math.floor(s.time || 0) % 100003 + (s.level || 1) * 131);
    const evs = (sum.events || []).map(id => s.events && s.events.log.find(l => l.id === id)).filter(Boolean), rain = evs.some(e => e.type === 'shower');
    if ((sum.ringTo || 0) > (sum.ringFrom || 0)) F.push([10, `colour running like water across ${C.RINGS[sum.ringTo].name}`]);
    if ((sum.puppies || []).length) F.push([9, 'a tiny new heartbeat on the island']);
    const strays = (sum.arrived || []).filter(i => !(sum.puppies || []).includes(i));
    if (strays.length) F.push([8, `a small stranger called ${nm(strays[0])} crossing the bridge`]);
    if ((sum.exped || []).length) { const x = sum.exped[0]; F.push([7, `a boat drifting home ${x.crystal > 0 ? 'with crystals' : x.pupIdx >= 0 ? 'with a new friend aboard' : x.seeds > 0 ? 'full of seeds' : 'with treasures'}`]); }
    if (sum.levels > 0) F.push([6, 'growing a little taller in my sleep']);
    // the pups who worked hardest (most trips while away)
    const tr = (sum.pupTrips || []).map((n, i) => [n, i]).filter(x => x[0] > 0 && P[x[1]]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    tr.slice(0, 2).forEach(([n, i], k) => {
      const p = P[i], L = JOBF[p.job] || JOBF.rest;
      let t = p.job === 'water' && rain ? L[2] : L[hash(h0 + i) % (p.job === 'water' ? 2 : L.length)];
      F.push([k ? 3 : 6.5, t.replace('{a}', p.name).replace('{o}', 'its')]);
    });
    if ((sum.built || []).length) F.push([5, 'a new roof where there was only grass']);
    // Round 2 step 3: a sky critter that visited in the night (the whale always makes the dream)
    { const K = window.Critters, cs = (sum.critters || []).filter(v => K && K.BY[v.c]); const wh = cs.find(v => v.c === 'whale');
      if (wh) F.push([9.5, 'a sky whale singing as it drifted over my crown']); else if (cs.length) { const v = cs[hash(h0 + 5) % cs.length]; F.push([5.5, `${K.article(K.BY[v.c])} that ${K.BY[v.c].verb} ${K.where(s, v)}`]); } }
    if (sum.cleared > 0) F.push([4, 'dark patches melting away like frost']);
    if (rain && !F.some(f => /rain/.test(f[1]))) F.push([3.5, 'warm rain on every leaf']);
    const nap = P.map((p, i) => i).filter(i => P[i].job === 'rest');
    if (nap.length >= 2) F.push([2, `${nm(nap[0])} and ${nm(nap[1])} napping in a heap`]);
    if (F.length < 2) F.push([1, 'the river humming to itself all night']);
    if (F.length < 2) F.push([0.5, 'fireflies drawing slow circles over the plaza']);
    const top = F.map((f, k) => [f[0], k, f[1]]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(f => f[2]);
    const body = top.length === 3 ? `${top[0]}, of ${top[1]}, and of ${top[2]}` : `${top[0]}, and of ${top[1]}`;
    return { text: `${pick(OPEN, h0)} ${body}. ${pick(CLOSE, h0 >>> 3)}`, frags: top };
  }

  // ---------------------------------------------------------------- pup diaries (text from data, a pup's voice)
  const JOB_LINE = {
    water: ['Carried water {n} times. The tree said thank you with its leaves.', 'Water, water, water ({n} buckets). My paws are soggy and my heart is full.'],
    light: ['Lit the orbs {n} times. My nose smells like candles.', '{n} lantern trips. The orbs glowed back at me, I am sure of it.'],
    wood: ['Chopped and stacked wood all day ({n} loads). Splinters: zero!', '{n} loads of logs. The woodpile is taller than me now.'],
    stone: ['Hauled {n} loads of stone. Strong paws, happy tail.', 'Stones all day ({n} loads). Found one shaped like a heart. Kept it.'],
    food: ['Picked berries, {n} baskets. Only ate a few. Okay, more than a few.', '{n} baskets of berries. Purple paws again.'],
    nourish: ['Tucked compost around the roots, {n} times. Can trees purr? I think it purred.', 'Gardening day ({n} trips). The sprouts are coming along.'],
    protect: ['Swept blight away from the roots. The roots looked relieved.', 'Kept watch by the roots all day. Nothing sneaky got past me.'],
    spirit: ['Played music all day. Somebody danced. It might have been me.', 'Practised a new song. The tree hummed along, very low.'],
    build: ['Busy building day. Tap tap tap.', 'Measured twice, hammered once. Mostly.'],
    rest: ['A lazy day. Watched the clouds. Very important work.', 'Napped in the sun. Then napped in the shade. Balance.'],
  };
  const AREA = ['', 'The stones by the tree', 'The meadows', 'The near woods', 'The far hills', 'Even the sky isles'];
  function diaryLine(s, i, e) {
    const P = s.pups, nm = k => P[k] ? P[k].name : 'a friend', X = window.Exped, dest = k => (X && X.DEST[k] ? X.DEST[k].name : 'a sky isle');
    const [dn, kind, a, b] = e, h = hash(dn * 977 + i * 31 + kind.length);
    // vibe pass 2 lane B: the pup's personality (src/traits.js) writes most lines in its own voice; the shared lines stay in the mix
    const T = window.Traits, t = T ? T.of(s, i) : null, mine = (k, o, job) => t ? T.diary(t, k, job, h >>> 4, o) : null, own = (h >>> 2) % 3 !== 0;
    switch (kind) {
      case 'arr': return a === 0 ? (mine('arr0') || 'Woke up under a big grey tree. It yawned at me. I think we will be friends.')
        : a === 3 ? 'Came to the island as a gift. Everybody says I glow. I just feel happy.'
        : (own && mine('arr')) || pick(['Crossed a long bridge and found an island that needed paws. Found a bed too!', 'Arrived today. The tree waved its branches at me. Probably the wind. Probably.'], h);
      case 'born': return `Was born today! Everything is very big. ${nm(a)} and ${nm(b)} keep licking my ears.`;
      case 'pup': return (own && mine('pup', { f: nm(a) })) || `${nm(a)} was born today! Tiny. Loud. Perfect.`;
      case 'isle': return `Came home on the leaf boat from ${dest(a)}. The ground here does not float. Strange, but nice.`;
      case 'go': return (own && mine('go', { d: dest(a) })) || pick([`Flew to ${dest(a)} on a leaf boat. Did not look down. Okay, I looked down once.`, `Off to ${dest(a)}! Packed berries, packed courage.`], h);
      case 'back': return (!(b & 15) && mine('back', { d: dest(a) })) || `Back from ${dest(a)}! ` + (b & 2 ? 'We brought a new friend home!' : b & 1 ? 'My pockets are full of crystals.' : b & 4 ? 'Seeds everywhere. Even in my ears.' : b & 8 ? 'Found something pretty for the island.' : 'Sky air makes me sleepy.');
      case 'fr': return b >= 3 ? ((own && mine('fr3', { f: nm(a) })) || `${nm(a)} is my closest friend. We nap back to back.`) : (own && mine('fr', { f: nm(a) })) || (b === 2 ? `${nm(a)} and I are good friends now. We have a secret paw-shake.` : `Made a friend: ${nm(a)}. We share the work and the snacks.`);
      case 'wish': return `My wish came true! I got to try ${JOBS[a] === 'spirit' ? 'music' : JOBS[a] === 'nourish' ? 'gardening' : JOBS[a] === 'protect' ? 'guarding' : JOBS[a] || 'something new'}.`;
      case 'wave': return mine('wave', { a: AREA[a] || 'The island', l: (AREA[a] || 'The island').replace(/^./, c => c.toLowerCase()) }) || `${AREA[a] || 'The island'} turned colourful today! I rolled in ${a >= 5 ? 'the sunshine' : 'it'}.`;
      case 'blt': { const k = BKEYS()[a], B = k && Sim_().C.B[k], nmB = B ? (k === 'home' ? 'a cottage' : 'the ' + B.name) : 'something'; return (own && mine('blt', { b: nmB })) || `Helped build ${nmB}. Hammered my paw only twice.`; }
      case 'job': { const L = JOB_LINE[JOBS[a]] || JOB_LINE.rest; return ((own && mine('job', { n: b }, JOBS[a])) || pick(L, h)).replace('{n}', b); }
      default: return '';
    }
  }
  // the diary, newest first (today's entry, if any, on top as day = the current island day)
  function diary(s, i) {
    const p = s.pups[i]; if (!p) return [];
    const out = (p.dy || []).map(e => ({ dn: e[0], text: diaryLine(s, i, e) })).reverse();
    if (p.dd) out.unshift({ dn: s.story.dn, today: true, text: diaryLine(s, i, [s.story.dn, p.dd[0], p.dd[1], p.dd[2]]) });
    return out.filter(x => x.text);
  }

  window.Story = { once, C, CH, MS, JOBS, bloom, ringOf, radiusOf, radius, ringR, words, create, sanitize, pupIn, tick, midnight, openDay, visit, chapterCheck,
    next, unread, read, readAll, Session, dream, diary, diaryLine, dayIdx, say };
})();
