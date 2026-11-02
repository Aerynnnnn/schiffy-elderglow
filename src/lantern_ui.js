// LanternUI (Round 2 step 4): the Lanterns card (Release / Received / World Bloom), the lantern reading card, the home sync
// (petals out, bloom status + gifts, lanterns in, "found someone" / warmth back), away-card lines and the Book's Lanterns page.
// Pure rules live in src/lanterns.js; the server (server/patch_3.sql) checks everything again. Talks to the backend only through Net.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SV = (body) => `<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  const lanIc = c => SV(`<path d="M10 2.5h4M12 2.5v2" fill="none"/><path d="M8.5 5h7l-.6 1.4C17.6 7.6 19 10 19 12.6c0 2.7-1.6 5-4 6.1l.6 1.3h-7.2l.6-1.3c-2.4-1.1-4-3.4-4-6.1C5 10 6.4 7.6 9.1 6.4z" fill="${c || '#ffc65a'}"/><path d="M12 8.5c-1.2 1.6-1.8 2.8-1.8 4 0 1.2.8 2 1.8 2s1.8-.8 1.8-2c0-1.2-.6-2.4-1.8-4z" fill="#fff6c8"/>`);
  const IX = {
    lantern: lanIc(),
    bloom: SV('<path d="M12 21v-7" fill="none"/><circle cx="12" cy="6" r="3.2" fill="#ffb3d0"/><circle cx="7" cy="9.5" r="3.2" fill="#ffb3d0"/><circle cx="17" cy="9.5" r="3.2" fill="#ffb3d0"/><circle cx="9" cy="14" r="3.2" fill="#ffb3d0"/><circle cx="15" cy="14" r="3.2" fill="#ffb3d0"/><circle cx="12" cy="10.5" r="2.4" fill="#fff1a8"/>'),
    warm: SV('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="#ffb05a"/><path d="M9 11.5c1 1.3 2 1.8 3 1.8s2-.5 3-1.8" fill="none"/>'),
    flag: SV('<path d="M6 21V4" fill="none"/><path d="M6 4h11l-2.5 4L17 12H6z" fill="#ff8f8f"/>'),
    sky: SV('<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.3 6.3 0 0 0 10 10z" fill="#c6a6ff"/><circle cx="17" cy="5" r="1" fill="#fff"/><circle cx="20" cy="9" r=".8" fill="#fff"/>'),
    send: SV('<path d="M4 12l16-8-6 16-2.5-6.5z" fill="#9fe8ff"/><path d="M11.5 13.5L20 4" fill="none"/>'),
  };
  const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };

  function LanternUI(g) {
    const { net, toast, esc, IC } = g, L = window.Lanterns, St = window.Story;
    const S = () => g.S;
    let tab = 'send', off = false, busy = false, news = null, draftB = '', draftC = 'amber', reading = null, repArm = false, status = null, lastAdd = 0;
    const sfx = n => { if (g.snd) g.snd.sfx(n); };
    const once = (k, x) => { const s = S(); if (St.once(s, k, x)) { if (g.onWords) g.onWords(); return true; } return false; };
    const say = (k, x) => { St.say(S(), k, x); if (g.onWords) g.onWords(); };
    const kindNow = () => L.kindOf(status ? status.cyc : L.cycleOf(Date.now()));

    // ---------------- sync with the server (home only): petals out, bloom in, lanterns in, the sender's news
    async function sync(boot) {
      const s = S(); if (busy || !s || g.mode !== 'home') return; busy = true;
      try {
        if (!net.uid) { const r = await net.signIn(); if (!r.ok) return; }
        const nw = { got: [], found: [], warm: [], miles: [], petals: 0 };
        const pend = s.lan.bl.pend;
        if (pend > 0 && Date.now() - lastAdd > 11000) {
          lastAdd = Date.now(); const r = await net.bloomAdd(pend);
          if (r && r.setup) { off = true; return; }
          if (r && r.ok) { s.lan.bl.pend = Math.max(0, s.lan.bl.pend - pend); nw.petals = r.added; }
        }
        const st = await net.bloomStatus();
        if (st && st.setup) { off = true; return; }
        if (st && st.ok) {
          const prevCyc = s.lan.bl.last ? s.lan.bl.last.cyc : null;
          status = st; s.lan.bl.last = { cyc: st.cyc, total: st.total, today: st.today, mine: st.mine, prev: st.prev, at: Date.now() };
          if (prevCyc !== null && prevCyc !== st.cyc) say('bloomNew', L.kindOf(st.cyc).name);
          nw.miles = L.fresh(s, st);
          for (const m of nw.miles) say('bloom' + m);
          if (g.lfx) g.lfx.setBloom(L.kindOf(st.cyc), L.frac(st.total).open);
        }
        const inbox = await net.lanternInbox();
        if (inbox && inbox.setup) { off = true; return; }
        if (Array.isArray(inbox)) { nw.got = L.merge(s, inbox); if (nw.got.length) once('lan1'); }
        const sent = await net.lanternSent();
        if (Array.isArray(sent)) { const ch = L.mergeSent(s, sent); nw.found = ch.found; nw.warm = ch.warm; if (ch.warm.length) once('warm1'); }
        off = false;
        const any = nw.got.length || nw.found.length || nw.warm.length || nw.miles.length;
        if (any || nw.petals) { g.save(); if (g.touch) g.touch(); }
        skyRefresh();
        if (any) {
          news = news ? { got: news.got.concat(nw.got), found: news.found.concat(nw.found), warm: news.warm.concat(nw.warm), miles: news.miles.concat(nw.miles) } : nw;
          if (boot && g.awayOpen && g.awayOpen()) g.showAway();   // re-draw the away card with the lantern lines
          else {
            if (nw.got.length) { sfx('lantern_find'); toast(`${lanIc(L.C.COLS[nw.got[0].c])} ${nw.got.length === 1 ? 'A lantern drifted into your sky' : nw.got.length + ' lanterns drifted into your sky'}. Tap to read`, 9000, () => openRead(nw.got[0].id, true)); }
            if (nw.warm.length) { sfx('warmth'); toast(`${IX.warm} Someone sent warmth back for your lantern`, 6000, () => open('send')); }
            else if (nw.found.length) toast(`${IX.lantern} Your lantern found someone`, 5000, () => open('send'));
            if (nw.miles.length) { sfx('sting_petals'); toast(`${IX.bloom} The World Bloom opened! A gift for everyone is waiting. <u>See</u>`, 12000, () => open('bloom')); }
          }
        }
        if (!$('lanCard').hidden) render();
        refreshBtn();
      } catch (e) { console.warn('lanterns sync', e); } finally { busy = false; }
    }
    function skyRefresh() { if (g.lfx) g.lfx.setSky(L.sky(S()).map(x => ({ id: x.id, c: L.C.COLS[x.c] }))); }
    function refreshBtn() { const b = $('lanBtn'); if (!b) return; const s = S(); b.classList.toggle('wig', !!(s && (L.sky(s).length || (status && L.open(s, status).length)))); }

    // ---------------- away card (lantern arrivals while away, the sender's news, bloom gifts, petals the care earned)
    function awayHtml(sum) {
      let h = '';
      const pet = sum && sum.petals > 0 ? sum.petals : 0;
      if (news) {
        const lines = L.awayLines(news.got, news);
        if (lines.length || news.miles.length) h += `<li class="hd">${IX.lantern}<b>Lanterns</b></li>`;
        lines.forEach((t, i) => {
          const isGot = i === 0 && news.got.length, c = isGot ? L.C.COLS[news.got[0].c] : null;
          h += `<li class="good">${isGot ? lanIc(c) : /warmth/.test(t) ? IX.warm : IX.lantern}<div>${esc(t)}${isGot ? `<br><button class="go sm" data-lanread="${esc(news.got[0].id)}">Read ${news.got.length > 1 ? 'them' : 'it'}</button>` : ''}</div></li>`;
        });
        if (news.miles.length) h += `<li class="good">${IX.bloom}<div>The World Bloom opened ${news.miles.length > 1 ? news.miles.length + ' petal rings' : 'a new ring of petals'}: a gift for everyone.<br><button class="go sm" data-lanbloom="1">See the Bloom</button></div></li>`;
      }
      if (pet) h += `<li>${IX.bloom}<div>Your tree's care earned <b>${pet}</b> petal${pet > 1 ? 's' : ''} for the World Bloom</div></li>`;
      return h;
    }
    function awayDone() { news = null; }

    // ---------------- the Lanterns card
    function open(t) { if (t) tab = t; if (g.closeOthers) g.closeOthers(); $('lanCard').hidden = false; render(); sfx('open'); if (!status && !busy) sync(false); }
    function close() { $('lanCard').hidden = true; }
    const nightNow = () => g.night();
    function render() {
      const b = $('lanBody'); if (!b) return; const s = S();
      $('lanTitle').innerHTML = `${IX.lantern} Lanterns`;
      const unread = L.sky(s).length, gifts = status ? L.open(s, status).length : 0;
      let h = `<div class="stabs">${[['send', IX.send, 'Release'], ['got', IX.sky, 'Received' + (unread ? ` (${unread})` : '')], ['bloom', IX.bloom, 'World Bloom' + (gifts ? ` (${gifts})` : '')]].map(([k, ic, t]) => `<button data-lt="${k}" class="${tab === k ? 'on' : ''}">${ic}${t}</button>`).join('')}</div>`;
      if (off) h += `<p class="sub lanoff">${IX.sky} The sky post isn't open yet: lanterns and the World Bloom begin soon. Your tree's petals are kept safe until then.</p>`;
      if (tab === 'send') h += sendHtml(); else if (tab === 'got') h += gotHtml(); else h += bloomHtml();
      b.innerHTML = h;
      const ta = $('lanText'); if (ta) { ta.value = draftB; count(); }
    }
    function sendHtml() {
      const s = S(), left = L.left(s, Date.now()), q = s.lan.q, nt = nightNow(), prof = g.prof && g.prof();
      let h = `<p class="sub">Write something kind. Your lantern drifts into a stranger's night sky; all you will ever know is that it found someone.</p>`;
      if (q) h += `<div class="lanq">${lanIc(L.C.COLS[q.c])}<div>Waiting for dusk: "${esc(q.b)}"<small>It rises by itself when night falls on your island.</small></div><button class="ghost" data-lanunq="1">Take it back</button></div>`;
      h += `<div class="lanprompts">${L.C.PROMPTS.map((p, i) => `<button data-lanp="${i}">${esc(p)}</button>`).join('')}</div>
        <div class="lanta"><textarea id="lanText" maxlength="${L.C.NOTE_MAX}" rows="3" placeholder="Write something kind..."></textarea><small id="lanCnt">0 / ${L.C.NOTE_MAX}</small></div>
        <div class="lancols">${Object.keys(L.C.COLS).map(k => `<button data-lanc="${k}" class="${draftC === k ? 'on' : ''}" title="${k}" style="background:${L.C.COLS[k]}"></button>`).join('')}</div>
        <p id="lanWhy" class="why2"></p>
        <div class="pf"><small class="sub">${left} of ${L.C.PER_DAY} left today &middot; ${nt ? `${IC.moon} night: the sky is ready` : `${IC.sun} lanterns rise after dusk`}</small>
        <button class="go" id="lanGo"${left <= 0 || off || !prof ? ' disabled' : ''}>${IX.lantern}${nt ? 'Release' : 'Release at dusk'}</button></div>`;
      if (!prof) h += `<p class="sub small">Give your island a name first (<u data-lanexp="1">Visit</u>): lanterns carry your island's name.</p>`;
      const sent = s.lan.sent.slice().reverse();
      if (sent.length) h += `<h4>${IX.send} Sent</h4>` + sent.slice(0, 12).map(x => `<div class="lanrow">${lanIc(L.C.COLS[x.c])}<div>"${esc(x.b)}"<small>${ago(x.at)} &middot; ${x.w ? `${IX.warm}<b>warmth came back</b>` : x.f ? 'found someone' : 'still drifting...'}</small></div></div>`).join('');
      return h;
    }
    function gotHtml() {
      const s = S(), got = s.lan.got.slice().reverse();
      if (!got.length) return `<p class="sub">No lanterns yet. When someone's lantern drifts into your sky it glows past the tree (brightest at night): tap it to read.</p>`;
      return `<p class="sub">Lanterns from faraway isles. Tap one to read it again.</p>` + got.map(x => `<button class="lanrow lanbtn${x.sky ? ' new' : ''}" data-lanread="${esc(x.id)}">${lanIc(L.C.COLS[x.c])}<div>${x.sky ? '<b>A new lantern: tap to read</b>' : `"${esc(x.b)}"`}<small>from ${esc(x.f)} &middot; ${ago(x.at)}${x.w ? ` &middot; ${IX.warm}warmth sent` : ''}</small></div></button>`).join('');
    }
    function bloomHtml() {
      const s = S(), st = status || (s.lan.bl.last ? Object.assign({ ok: true }, s.lan.bl.last) : null), k = kindNow();
      if (!st) return `<p class="sub">Looking at the horizon...</p>`;
      const f = L.frac(st.total), leftD = Math.ceil(L.cycleLeft(Date.now()) / 86400), pend = s.lan.bl.pend;
      const last = s.story.log.slice().reverse().find(e => /^bloom/.test(e.k)), w = last ? St.words(last) : null;
      let h = `<div class="blhd"><span class="blsw" style="background:${k.col}">${IX.bloom}</span><div><b class="disp">${esc(k.name)}</b><small>This week's World Bloom, grown by everyone's care &middot; a new bloom in ${leftD} day${leftD > 1 ? 's' : ''}</small></div></div>
        <div class="bar blbar"><i style="width:${Math.round(100 * Math.min(1, f.next ? st.total / f.next : 1))}%;background:${k.col}"></i><span>${st.total.toLocaleString()} petals${f.next ? ` &middot; next gift at ${f.next.toLocaleString()}` : ' &middot; fully open!'}</span></div>
        <p class="sub">Your petals today: <b>${st.today} / ${st.cap || L.C.CAP_DAY}</b>${pend ? ` (+${pend} on the way)` : ''} &middot; this week: ${st.mine || 0}. Petals come from a healthy tree (one an hour), watering friends' trees and sending lanterns.</p>`;
      if (g.bloomCam) h += `<div class="pf" style="margin:0 0 8px"><small class="sub">It grows on the horizon, past the island's edge.</small><button class="ghost" data-lancam="1">See it</button></div>`;
      if (w) h += `<div class="blsay">${IC.tree}<div><b>${esc(w.t)}</b>"${esc(w.x)}"</div></div>`;
      h += `<h4>${IX.bloom} Gifts for everyone</h4>`;
      const row = (cyc, m, tot, prevWk) => {
        const got = L.claimed(s, cyc, m), reached = tot >= L.C.MILES[m];
        return `<div class="blm${got ? ' done' : reached ? ' ready' : ''}"><b>${L.C.MILES[m].toLocaleString()}</b><div>${esc(L.GIFTS[m].t)}${prevWk ? '<small>last week</small>' : ''}</div>${got ? `<span class="ok">${IC.star}claimed</span>` : reached ? `<button class="go sm" data-lanclaim="${cyc}:${m}">Claim</button>` : `<span class="lk">${IC.lock}</span>`}</div>`;
      };
      for (let m = 0; m < L.C.MILES.length; m++) h += row(st.cyc, m, st.total, false);
      if (st.prev) for (let m = 0; m < L.reached(st.prev); m++) if (!L.claimed(s, st.cyc - 1, m)) h += row(st.cyc - 1, m, st.prev, true);
      return h;
    }
    function count() { const t = $('lanText'), c = $('lanCnt'); if (t && c) c.textContent = t.value.length + ' / ' + L.C.NOTE_MAX; }

    async function release() {
      const s = S(), t = $('lanText'), nc = window.Social.noteCheck(t ? t.value : draftB), why = $('lanWhy');
      if (!nc.ok) { if (why) why.textContent = nc.why; return; }
      if (!(g.prof && g.prof())) { if (why) why.textContent = 'Give your island a name first (Visit)'; return; }
      if (L.left(s, Date.now()) <= 0) { if (why) why.textContent = 'Three lanterns a day: the sky needs a rest'; return; }
      if (!nightNow()) { L.queue(s, nc.v, draftC); draftB = ''; g.save(); toast(`${lanIc(L.C.COLS[draftC])} Your lantern will rise by itself when dusk falls on your island`, 5000); render(); return; }
      const r = await send(nc.v, draftC); if (!r.ok && why) why.textContent = r.why;
    }
    async function send(b, c) {
      const s = S(), r = await net.lanternSend({ body: b, col: c });
      if (!r || !r.ok) { if (r && r.setup) { off = true; render(); } return { ok: false, why: r ? kindWhy(r.why) : 'network' }; }
      L.addSent(s, { id: r.id, b, c, at: Date.now() }); if (s.lan.q && s.lan.q.b === b) s.lan.q = null; draftB = '';
      once('lanSent1'); g.save(); if (g.touch) g.touch();
      close(); const p = g.lfx ? g.lfx.release(L.C.COLS[c]) : null; if (p && g.releaseCam) g.releaseCam(p);
      sfx('lantern_rise'); sfx('rustle'); toast(`${lanIc(L.C.COLS[c])} Your lantern drifts off over the water to find someone`, 6000);
      return { ok: true };
    }
    const kindWhy = w => ({ 'three lanterns a day': 'Three lanterns a day: the sky needs a rest', 'no one new to find yet: try again later': 'No one new to find right now: try again later' }[w] || w || 'The lantern stayed on the ground: try again');
    // a lantern written by day rises at dusk (called every few seconds by the game while it is open)
    async function tick() {
      const s = S(); if (!s || g.mode !== 'home' || off || busy || !s.lan.q || !nightNow() || (g.busyUI && g.busyUI())) return;
      busy = true; try { const q = s.lan.q, r = await send(q.b, q.c); if (!r.ok) { s.lan.q = null; g.save(); toast(`${IX.lantern} Your waiting lantern stayed on the ground: ${esc(r.why)}`, 6000); } } finally { busy = false; }
    }

    // ---------------- reading card
    function openRead(id, fly) {
      const s = S(), e = s.lan.got.find(x => x.id === id); if (!e) return;
      if (fly && g.lfx && g.lookAt) { const p = g.lfx.posOf(id); if (p) g.lookAt(p); }
      const first = !e.r; L.read(s, id); if (first) { net.lanternAct(id, 'read'); g.save(); }
      reading = id; repArm = false; drawRead(); $('lanRead').hidden = false; sfx(first ? 'lantern_find' : 'open'); sfx('rustle');   // vibe 2 lane C: paper rustle
      setTimeout(skyRefresh, first ? 900 : 0); refreshBtn(); if (!$('lanCard').hidden) render();
    }
    function drawRead() {
      const e = S().lan.got.find(x => x.id === reading); if (!e) { $('lanRead').hidden = true; return; }
      $('lrBody').innerHTML = `<div class="lrh" style="--lc:${L.C.COLS[e.c]}">${lanIc(L.C.COLS[e.c])}<small>A lantern from <b>${esc(e.f)}</b> &middot; ${ago(e.at)}</small></div>
        <p class="lrt">"${esc(e.b)}"</p>
        <div class="lrf"><button class="ghost rp" id="lrRep" title="Report this note">${IX.flag}${repArm ? 'Report it?' : ''}</button>
        ${e.w ? `<span class="lrw">${IX.warm} warmth sent</span>` : `<button class="go" id="lrWarm">${IX.warm} Send warmth back</button>`}<button class="big" id="lrOk">Keep it</button></div>`;
    }
    async function warmth() {
      const s = S(), id = reading, r = await net.lanternAct(id, 'warmth');
      if (r.ok || r.why === 'already sent') { L.warm(s, id); g.save(); if (g.touch) g.touch(); sfx('warmth'); toast(`${IX.warm} Warmth sent back. They will feel it`, 3600); drawRead(); if (g.floatHeart) g.floatHeart(); }
      else toast('The warmth didn\'t go yet: ' + esc(r.why), 3000);
    }
    async function report() {
      if (!repArm) { repArm = true; drawRead(); return; }
      const s = S(), id = reading, r = await net.lanternAct(id, 'report');
      if (r.ok) { L.drop(s, id); g.save(); $('lanRead').hidden = true; skyRefresh(); toast('Thank you. That lantern is gone and won\'t come back', 3600); if (!$('lanCard').hidden) render(); }
      else toast('Not reported yet: ' + esc(r.why), 3000);
    }

    // ---------------- World Bloom gifts
    function claim(cyc, m) {
      const s = S(), tot = status ? (cyc === status.cyc ? status.total : cyc === status.cyc - 1 ? status.prev : 0) : 0;
      const r = L.claim(s, cyc, m, tot); if (!r) return;
      g.save(); if (g.touch) g.touch(); if (g.refresh) g.refresh(); sfx('sting_petals');
      toast(`${IX.bloom} A gift from the World Bloom: <b>${esc(r.gift.t)}</b>`, 5000);
      if (r.visit && g.critVisit) setTimeout(() => g.critVisit(r.visit), 600);
      render(); refreshBtn();
    }

    // ---------------- the Book's Lanterns page
    function bookHtml() {
      const s = S(), n = s.lan.n;
      let h = `<p class="sub">${n.got} lantern${n.got === 1 ? '' : 's'} received &middot; ${n.sent} sent &middot; ${n.warm} warmth given &middot; ${n.warmGot} warmth received</p>`;
      const got = s.lan.got.slice().reverse(), sent = s.lan.sent.slice().reverse();
      h += `<h4>${IX.sky} Received</h4>` + (got.length ? got.map(x => `<button class="lanrow lanbtn${x.sky ? ' new' : ''}" data-lanread="${esc(x.id)}">${lanIc(L.C.COLS[x.c])}<div>${x.sky ? '<b>Unread: tap to read</b>' : `"${esc(x.b)}"`}<small>from ${esc(x.f)} &middot; ${ago(x.at)}</small></div></button>`).join('') : '<p class="sub">None yet: they drift in at night.</p>');
      h += `<h4>${IX.send} Sent</h4>` + (sent.length ? sent.map(x => `<div class="lanrow">${lanIc(L.C.COLS[x.c])}<div>"${esc(x.b)}"<small>${ago(x.at)} &middot; ${x.w ? 'warmth came back' : x.f ? 'found someone' : 'still drifting'}</small></div></div>`).join('') : '<p class="sub">None yet. Open <b>Lanterns</b> to release one.</p>');
      return h;
    }

    // ---------------- start
    function build() {
      const card = document.createElement('div'); card.id = 'lanCard'; card.className = 'card'; card.hidden = true;
      card.innerHTML = `<div class="pch"><span id="lanTitle" class="disp"></span><button id="lanClose" title="Close">&#10005;</button></div><div id="lanBody"></div>`; $('app').appendChild(card);
      const rd = document.createElement('div'); rd.id = 'lanRead'; rd.className = 'card'; rd.hidden = true; rd.innerHTML = `<button id="lrClose" title="Close">&#10005;</button><div id="lrBody"></div>`; $('app').appendChild(rd);
      const btn = document.createElement('button'); btn.id = 'lanBtn'; btn.title = 'Lanterns: kind notes for faraway isles + the World Bloom'; btn.innerHTML = lanIc() + '<span>Lanterns</span>';
      const top = $('topBtns'), sb = $('socBtn'); top.insertBefore(btn, sb ? sb.nextSibling : null);
      btn.onclick = () => { if ($('lanCard').hidden) open(); else close(); };
      $('lanClose').onclick = close; $('lrClose').onclick = () => { $('lanRead').hidden = true; };
      $('lanBody').addEventListener('click', e => {
        const t = e.target.closest('button,u'); if (!t) return;
        if (t.dataset.lt) { tab = t.dataset.lt; render(); return; }
        if (t.dataset.lanp) { draftB = L.C.PROMPTS[+t.dataset.lanp]; const ta = $('lanText'); if (ta) { ta.value = draftB; count(); ta.focus(); } return; }
        if (t.dataset.lanc) { draftC = t.dataset.lanc; document.querySelectorAll('.lancols button').forEach(b => b.classList.toggle('on', b.dataset.lanc === draftC)); return; }
        if (t.dataset.lanunq) { S().lan.q = null; g.save(); render(); return; }
        if (t.dataset.lanread) { openRead(t.dataset.lanread, false); return; }
        if (t.dataset.lanclaim) { const [c, m] = t.dataset.lanclaim.split(':').map(Number); claim(c, m); return; }
        if (t.dataset.lancam) { close(); g.bloomCam(); return; }
        if (t.dataset.lanexp) { close(); if (g.openExplore) g.openExplore(); return; }
        if (t.id === 'lanGo') release();
      });
      $('lanBody').addEventListener('input', e => { if (e.target.id === 'lanText') { draftB = e.target.value; count(); } });
      $('lrBody').addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.id === 'lrWarm') warmth(); else if (t.id === 'lrRep') report(); else if (t.id === 'lrOk') $('lanRead').hidden = true; });
      // away card + Book links (their lists are re-drawn; listen on the containers)
      for (const id of ['awayList', 'bookBody']) { const el = $(id); if (el) el.addEventListener('click', e => { const t = e.target.closest('[data-lanread],[data-lanbloom]'); if (!t) return; if (t.dataset.lanread) openRead(t.dataset.lanread, true); else open('bloom'); }); }
      const s = S(), la = s && s.lan.bl.last;   // the last numbers seen (offline: the giant flower still shows them)
      if (g.lfx) g.lfx.setBloom(L.kindOf(la ? la.cyc : L.cycleOf(Date.now())), la ? L.frac(la.total).open : 0);
      skyRefresh(); refreshBtn();
    }
    function start() {
      build();
      setInterval(() => { if (!document.hidden) sync(false); }, 120000);
      setInterval(tick, 5000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false); });
      return sync(true);
    }
    return { start, sync, open, close, openRead, render, awayHtml, awayDone, bookHtml, claim, tick, skyRefresh, get status() { return status; }, get off() { return off; }, get news() { return news; }, IX, lanIc };
  }
  window.LanternUI = LanternUI;
})();
