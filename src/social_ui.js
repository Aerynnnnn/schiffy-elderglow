// SocialUI (step 6): the Explore card (account setup, browse recent / most liked / random / search, my island: public
// toggle, guestbook, link-email stub), publishing on a throttle, the home sync (gifts merged into the sim, visitors /
// notes / likes on the away card), and the visit view's HUD (host banner, water / gift / like / guestbook / report).
// Talks to the backend only through Net (src/net.js); every rule that matters is checked again by the server.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SV = (body) => `<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  const IX = {
    globe: SV('<circle cx="12" cy="12" r="9" fill="#9fe8ff"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none"/>'),
    flag: SV('<path d="M6 21V4" fill="none"/><path d="M6 4h11l-2.5 4L17 12H6z" fill="#ff8f8f"/>'),
    note: SV('<path d="M5 3.5h10l4 4v13H5z" fill="#fff6dc"/><path d="M15 3.5v4h4M8 11h8M8 14.5h8M8 18h5" fill="none"/>'),
    home: SV('<path d="M3.5 11.5L12 4l8.5 7.5" fill="none"/><path d="M6 10v10h12V10" fill="#ffd9a8"/><rect x="10" y="14" width="4" height="6" fill="#b07a45"/>'),
    dice: SV('<rect x="4" y="4" width="16" height="16" rx="3.5" fill="#fff"/><circle cx="8.5" cy="8.5" r="1.4" fill="#2a2442"/><circle cx="15.5" cy="15.5" r="1.4" fill="#2a2442"/><circle cx="12" cy="12" r="1.4" fill="#2a2442"/>'),
    search: SV('<circle cx="10.5" cy="10.5" r="6" fill="#fff"/><path d="M15 15l5.5 5.5" fill="none" stroke-width="3"/>'),
    lock: SV('<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none"/><rect x="5.5" y="11" width="13" height="9" rx="2" fill="#b9a7ff"/>'),
    // piece 5: the "beautiful" star, the week crown, the tour flag
    star: SV('<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z" fill="#ffd23f"/>'),
    crown: SV('<path d="M4 18l-1-10 5 4 4-7 4 7 5-4-1 10z" fill="#ffd23f"/><path d="M4 18h16" fill="none"/>'),
    tour: SV('<path d="M6 21V4" fill="none"/><path d="M6 4h9l-2 3.5 2 3.5H6" fill="#9fe8ff"/><circle cx="16.5" cy="18" r="2.5" fill="#ffd23f"/><path d="M6 18h8" fill="none" stroke-dasharray="2 2"/>'),
  };
  const OUTBOX = slot => 'schiffy-elderglow.outbox' + slot;
  const readBox = slot => { try { const a = JSON.parse(localStorage.getItem(OUTBOX(slot)) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const writeBox = (slot, a) => { try { localStorage.setItem(OUTBOX(slot), JSON.stringify(a.slice(-100))); } catch (e) {} };
  const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };

  function SocialUI(g) {
    const { Q, SLOT, IC, esc, toast, nav } = g;
    const IIC = Object.assign({}, IC, IX);
    // step 7: the game passes its one backend (shared with the cloud save: one supabase-js client per page)
    const net = g.net || window.Net.make({ slot: SLOT.replace(/^\./, ''), mockdb: /^[a-z0-9]{1,12}$/.test(Q.get('mockdb') || '') ? Q.get('mockdb') : '', samples: () => window.Social.samples(nav) });
    let signed = false, prof = null, tab = 'recent', query = '', list = null, mine = null, news = null, busy = false;
    // piece 5 "showing off" (server/patch_5.sql): P5 = null (not asked yet) | true | false (the patch is missing: no stars, no
    // shelf, never an error); SN = star counts by island id, STARRED = ids this player starred, shelf = the Explore shelf
    let P5 = null, shelf = null, shelfAt = 0; const SN = {}, STARRED = new Set();
    const p5 = r => { if (r && r.setup) { P5 = false; return false; } if (r && r.ok) P5 = true; return !!(r && r.ok); };
    async function starsFor(ids) {
      if (P5 === false || !ids.length) return;
      const r = await net.starInfo(ids); if (!p5(r)) return;
      for (const k in r.n) SN[k] = r.n[k]; for (const id of r.mine || []) STARRED.add(id);
    }
    const stc = id => (P5 && SN[id] !== undefined ? ` &middot; <span class="stc" title="visitors who found it beautiful">${IX.star}${SN[id]}</span>` : '');
    const S = () => g.S;
    const seasonNow = () => { const k = window.Seasons.of(S()); return k === null ? -1 : k; };

    async function ensureSignIn() {
      if (signed) return true;
      const r = await net.signIn(); if (!r.ok) { toast(`${IX.globe} The neighbour isles are out of reach right now (${esc(r.why)})`, 4000); return false; }
      signed = true; prof = await net.profile(); return true;
    }
    // ---------- publishing (home only)
    let lastPub = 0;
    async function publish(force) {
      const s = S(); if (g.mode !== 'home' || !s || !s.social.acct || !prof) return null;
      if (!force && Date.now() - lastPub < window.Social.C.PUBLISH_EVERY * 1000) return null;
      lastPub = Date.now();
      s.social.island = prof.island; s.social.host = prof.host;
      const snap = window.Social.snapshot(s, seasonNow(), nav);
      const r = await net.publish({ snap, pub: s.social.pub });
      if (r.ok) { s.social.pubAt = Date.now(); g.save(); }
      return r;
    }
    // a changed tour goes out a few seconds later (the server takes one upload per 20 s)
    let pubT = 0; function pubSoon() { clearTimeout(pubT); pubT = setTimeout(() => { lastPub = 0; publish(true); }, 4000); }
    // ---------- home sync: own outbox first (what this player gave away on visits), then gifts for this island, then news
    async function homeSync(showCard) {
      const s = S(); if (g.mode !== 'home' || !s) return;
      const box = readBox(SLOT);
      if (box.length) { window.Social.applySent(s, box); if (g.touch) g.touch(); g.save(); writeBox(SLOT, box.filter(x => !s.social.sent.includes(x.id))); }
      if (!s.social.acct) return;
      if (!(await ensureSignIn())) return;
      if (net.uid !== s.social.acct) { s.social.acct = net.uid; }
      const gifts = await net.inbox(), got = Array.isArray(gifts) ? window.Social.applyGifts(s, gifts) : [];
      if (Array.isArray(gifts) && gifts.length) { if (g.touch) g.touch(); g.save(); await net.claim(gifts.map(x => x.id)); }   // claimed AFTER the save: a crash in between re-delivers, the ids make it a no-op
      const nw = await net.news(s.social.seenAt || 0);
      const sw = P5 === false ? null : await net.starNews(s.social.seenAt || 0); p5(sw);   // piece 5: "N visitors found your island beautiful"
      const nn = { got, visits: (nw && nw.visits) || [], notes: (nw && nw.notes) || [], likesNew: (nw && nw.likesNew) || 0, likes: (nw && nw.likes) || 0,
        starsNew: sw && sw.ok ? sw.since : 0, stars: sw && sw.ok ? sw.total : 0 };
      if (got.length || nn.visits.length || nn.notes.length || nn.likesNew || nn.starsNew) {
        news = nn; s.social.tot.visitors += nn.visits.length; s.social.tot.notes += nn.notes.length; s.social.tot.likes = nn.likes;
        s.social.seenAt = Date.now();
        const who = [...new Set(nn.visits.map(v => v.from).concat(got.map(x => x.from)).filter(Boolean))];
        if (who.length && g.onVisitors) g.onVisitors(who);   // Round 2 step 2: the tree's words remember a friend's visit
        g.save(); g.refresh();
        if (showCard) g.showAway(g.lastSum && g.lastSum()); else toast(`${IX.globe} Visitors dropped by! <u>See who</u>`, 8000, () => g.showAway(null));
      }
      if (got.length) refreshTree();
      await publish(false);
    }
    const refreshTree = () => { try { g.refresh(); } catch (e) {} };
    // lines for the away card ("visitors while you were away")
    function awayHtml() {
      if (!news) return '';
      const n = news; let h = `<li class="hd">${IX.globe}<b>Visitors while you were away</b></li>`;
      const waters = n.got.filter(x => x.kind === 'water'), gifts = n.got.filter(x => x.kind !== 'water');
      const names = [...new Set(n.visits.map(v => v.from).concat(n.got.map(x => x.from)).filter(Boolean))];
      if (names.length) h += `<li class="good">${IC.paw}<div>${names.slice(0, 6).map(x => `<b>${esc(x)}</b>`).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} came to visit</div></li>`;
      if (waters.length) h += `<li class="good">${IC.water}<div>${waters.length === 1 ? 'A friend' : waters.length + ' friends'} gave your tree a drink: ${IC.water}+${waters.length * window.Social.C.W_HOST.water} ${IC.sap}+${waters.length * window.Social.C.W_HOST.sap}</div></li>`;
      for (const x of gifts.slice(0, 6)) h += `<li class="good">${IC.gift}<div><b>${esc(x.from || 'A visitor')}</b> left a little gift: ${x.kind === 'decor' ? IC.decor + esc(window.Exped.DECOR[x.item].name) : (IC[x.item === 'seeds' ? 'seed' : x.item] || '') + '+' + x.n}</div></li>`;
      if (n.likesNew) h += `<li>${IC.heart}+${n.likesNew} like${n.likesNew > 1 ? 's' : ''} (${n.likes} in all)</li>`;
      if (n.starsNew) h += `<li class="good">${IX.star}<div>${n.starsNew === 1 ? 'A visitor' : n.starsNew + ' visitors'} found your island beautiful${n.stars > n.starsNew ? ` (${n.stars} in all)` : ''}</div></li>`;
      for (const x of n.notes.slice(0, 4)) h += `<li class="evl">${IX.note}<div>"${esc(x.text)}"<small>${esc(x.from)} &middot; ${ago(x.at)}</small></div></li>`;
      return h;
    }
    function awayDone() { news = null; }

    // ---------- Explore card
    function open(t) { if (typeof t === 'string') { tab = t; list = null; } $('socCard').hidden = false; render(); if (!signed) ensureSignIn().then(render); }
    function close() { $('socCard').hidden = true; }
    const setupForm = (why) => {
      const s = S(), isl = (prof && prof.island) || (s && s.social.island) || '', host = (prof && prof.host) || (s && s.social.host) || 'Schiffy';
      return `<p class="sub">${why || 'Give your island a name to share it with the neighbour isles. Visitors can water your tree, leave gifts and kind notes. Nothing a visitor does can take anything away.'}</p>
        <label class="fl">Island name<input id="socIsl" maxlength="24" value="${esc(isl)}" placeholder="e.g. Mossy Hollow"></label>
        <label class="fl">Your pup name (shown as the host)<input id="socHost" maxlength="14" value="${esc(host)}" placeholder="e.g. Schiffy"></label>
        <p id="socWhy" class="why2"></p>
        <label class="tog"><input type="checkbox" id="socPub0" ${!s || s.social.pub ? 'checked' : ''}><i></i>Open to visitors (anyone can drop by)</label>
        <div class="pf"><small class="sub">No email needed. ${net.kind === 'mock' ? 'Pretend test server: only this browser sees it.' : ''}</small><button class="go" id="socMake">${prof ? 'Save' : 'Share my island'}</button></div>
        ${g.mode === 'home' && g.openSafe && !prof ? `<div class="acctrow"><button class="ghost" id="cuOpenSafe">${IX.lock} Keep my island safe</button><button class="ghost" id="cuOpenHave">I already have an island</button></div>` : ''}`;
    };
    function render() {
      const b = $('socBody'); if (!b) return;
      $('socTitle').innerHTML = `${IX.globe} Neighbour isles`;
      if (!signed) { b.innerHTML = '<p class="sub">Looking across the sky...</p>'; return; }
      if (!prof || (g.mode === 'home' && !S().social.acct)) { b.innerHTML = setupForm(); return; }
      const tabs = [['recent', IC.clock, 'Recent'], ['liked', IC.heart, 'Most liked'], ['random', IX.dice, 'Random'], ['search', IX.search, 'Search']].concat(g.mode === 'home' ? [['mine', IX.home, 'My island']] : []);
      let h = `<div class="stabs">${tabs.map(([k, ic, t]) => `<button data-st="${k}" class="${tab === k ? 'on' : ''}">${ic}${t}</button>`).join('')}</div>`;
      if (tab === 'mine') h += mineHtml();
      else {
        if (tab !== 'search') h += shelfHtml();   // piece 5: Island of the week + Featured, right under the tabs
        if (tab === 'search') h += `<div class="srch"><input id="socQ" maxlength="24" placeholder="Island name" value="${esc(query)}"><button class="go sm" id="socGo">${IX.search}</button></div>`;
        if (!list) h += '<p class="sub">Looking for islands...</p>';
        else if (!list.length) h += `<p class="sub">${tab === 'search' ? 'No island by that name yet.' : 'No isles open to visitors yet. Yours could be the first!'}</p>`;
        else h += `<div class="icards">${list.map(cardHtml).join('')}</div>`;
      }
      b.innerHTML = h;
      if (!list && tab !== 'mine') load();
      if (tab !== 'search' && tab !== 'mine' && P5 !== false && (!shelf || Date.now() - shelfAt > 60000)) loadShelf();
    }
    // ---- piece 5: the Explore shelf (Island of the week + Featured); nothing at all while patch_5 is missing or nobody has stars
    async function loadShelf() {
      shelfAt = Date.now(); const r = await net.shelf(); if (!p5(r)) { shelf = null; return; }
      shelf = r; for (const c of [r.week, r.last].concat(r.featured || [])) if (c) SN[c.id] = c.stars;
      if (!$('socCard').hidden && tab !== 'mine' && tab !== 'search') render();
    }
    function shelfHtml() {
      if (P5 === false || !shelf || (!shelf.week && !shelf.last && !(shelf.featured || []).length)) return '';
      const col = c => /^#[0-9a-f]{6}$/i.test(c.col || '') ? c.col : '#9fd88a';
      const w = shelf.week || shelf.last, own = c => c.mine || (mine && mine.id === c.id);
      let h = '<div class="shelf">';
      if (w) h += `<button class="wkcard" data-isl="${esc(w.id)}"${own(w) ? ' disabled' : ''}><span class="isw" style="background:${col(w)}">${IC.sprout}</span><span><span class="wkl">${IX.crown} ${shelf.week ? 'Isle of the week' : "Last week's isle"}</span><b class="disp">${esc(w.name)}</b>
        <small>${esc(w.host)}'s island &middot; Lv ${w.lv | 0}</small><small class="stc">${IX.star}${shelf.week ? `${w.week | 0} visitor${w.week === 1 ? '' : 's'} found it beautiful this week` : `${w.stars | 0} in all`}${own(w) ? ' &middot; <i>yours!</i>' : ''}</small></span></button>`;
      const F = shelf.featured || [];
      if (F.length) h += `<h4>${IX.star} Much admired</h4><div class="feat">${F.map(c => `<button class="fcard" data-isl="${esc(c.id)}"${own(c) ? ' disabled' : ''}>${c.new ? '<span class="nw">new</span>' : ''}<span class="isw" style="background:${col(c)}">${IC.sprout}</span><b>${esc(c.name)}</b><small>${esc(c.host)} &middot; Lv ${c.lv | 0}</small><small class="stc">${IX.star}${c.stars | 0}${c.week ? ` &middot; ${c.week} this week` : ''}</small></button>`).join('')}</div>`;
      return h + '</div>';
    }
    function cardHtml(c) {
      const stage = window.Growth.stageName(Math.max(1, Math.min(8, c.lv || 1)));
      return `<button class="icard${c.mine ? ' mine' : ''}" data-isl="${esc(c.id)}"${c.mine ? ' disabled' : ''}><span class="isw" style="background:${/^#[0-9a-f]{6}$/i.test(c.col || '') ? c.col : '#9fd88a'}">${IC.sprout}</span><span class="ici"><b>${esc(c.name)}</b><small>${esc(c.host)}'s island &middot; ${esc(stage)} (Lv ${c.lv | 0})</small><small>${IC.heart}${c.likes | 0}${stc(c.id)} &middot; ${c.sample ? 'a sample isle' : 'updated ' + ago(c.updated)}${c.mine ? ' &middot; <i>yours</i>' : ''}</small></span></button>`;
    }
    function mineHtml() {
      const s = S(), so = s.social;
      let h = `<div class="myisl"><span class="isw lg" style="background:${window.Social.colOf(s.health, seasonNow())}">${IC.sprout}</span><div><b class="disp">${esc(prof.island)}</b><small>host ${esc(prof.host)} &middot; ${IC.heart}${mine ? mine.likes : so.tot.likes} likes<span id="socMyStars">${mine && P5 && SN[mine.id] !== undefined ? ` &middot; <span class="stc">${IX.star}${SN[mine.id]}</span> found it beautiful` : ''}</span> &middot; ${so.pubAt ? 'shared ' + ago(so.pubAt) : 'not shared yet'}</small></div></div>
        <label class="tog"><input type="checkbox" id="socPub" ${so.pub ? 'checked' : ''}><i></i>${so.pub ? 'Open: anyone can drop by' : 'Private: hidden from the neighbour isles'}</label>
        <p class="sub small">Your island is shared every 10 minutes while you play and when you leave (layout, pups, tree; never your resources).</p>
        <div class="pf"><button class="ghost" id="socEdit">Change names</button><button class="go sm" id="socPubNow">Share now</button></div>
        ${tourHtml()}
        <h4>${IX.note} Your guestbook</h4><div id="socGb"><p class="sub">...</p></div>
        <h4>${IX.lock} Keep my island safe</h4><div id="socCloud">${g.cloudStatus ? g.cloudStatus() : ''}</div>
        <p class="sub small">Add your email to open this island on your phone or another computer (no password: a link in your inbox).</p>
        <div class="acctrow"><button class="go sm" id="cuOpenSafe">${IX.lock} Keep my island safe</button><button class="ghost" id="cuOpenHave">I already have an island</button></div>`;
      setTimeout(loadGb, 0); return h;
    }
    // piece 5: the host's guided tour (up to 6 stops; marked in the world through g.tourPick, notes through the guestbook filter)
    function tourHtml() {
      const T = window.Tour, L = T.stops(S(), nav), n = L.length, M = T.C.MAX;
      let h = `<h4>${IX.tour} Island tour <small class="sub">(${n} / ${M} stops)</small></h4><p class="sub small">Visitors tap <b>Tour</b> and Schiffy trots to your stops in order, reading your notes. Kind words only (no links), ${T.C.NOTE} letters a note.</p><div id="socTour">`;
      h += L.map((st, i) => `<div class="trow"><b>${i + 1}</b><span class="tn"><small>${esc(g.stopName ? g.stopName(st) : st.t)}</small><input data-tn="${i}" maxlength="${T.C.NOTE}" value="${esc(st.note)}" placeholder="A note (optional)"></span>
        <button class="ghost" data-tsave="${i}" title="Save the note">Save</button>${i ? `<button class="ghost" data-tup="${i}" title="Earlier in the tour">&#9650;</button>` : ''}<button class="ghost" data-tdel="${i}" title="Take this stop out">&#10005;</button></div>`).join('');
      h += `</div><p id="socTourWhy" class="why2"></p><div class="pf">${n ? `<button class="ghost" id="socTourShow">Show the stops</button>` : '<small class="sub">No stops yet: visitors won\'t see a Tour button.</small>'}${n < M && g.tourPick ? `<button class="go sm" id="socTourAdd">${IX.tour} Add a stop</button>` : ''}</div>`;
      return h;
    }
    async function loadGb() {
      const el = $('socGb'); if (!el) return; if (!mine) mine = await net.myIsland();
      if (mine && P5 !== false) { await starsFor([mine.id]); const ms = $('socMyStars'); if (ms && P5 && SN[mine.id] !== undefined) ms.innerHTML = ` &middot; <span class="stc">${IX.star}${SN[mine.id]}</span> found it beautiful`; }
      const L = mine ? await net.guestbook(mine.id) : [];
      el.innerHTML = Array.isArray(L) && L.length ? L.map(n => `<div class="gbn">${IX.note}<div>"${esc(n.text)}"<small>${esc(n.from)} &middot; ${ago(n.at)}</small></div><button class="rp" data-rep="${esc(n.id)}" title="Report this note">${IX.flag}</button></div>`).join('') : '<p class="sub">No notes yet. Visitors can sign it.</p>';
    }
    async function load() {
      busy = true;
      const r = await net.browse({ sort: tab === 'search' ? 'recent' : tab, q: tab === 'search' ? query : '', limit: 24 });
      list = Array.isArray(r) ? r : []; busy = false; render();
      if (list.length && P5 !== false) { await starsFor(list.map(c => c.id)); if (P5 && !$('socCard').hidden) render(); }   // piece 5: star counts on the cards
    }
    async function makeAccount(fromVisit) {
      const a = window.Social.nameCheck($('socIsl').value, 'island'), b = window.Social.nameCheck($('socHost').value, 'host');
      if (!a.ok) { $('socWhy').textContent = 'Island name: ' + a.why; return; } if (!b.ok) { $('socWhy').textContent = 'Pup name: ' + b.why; return; }
      if (!(await ensureSignIn())) return;
      const r = await net.saveProfile({ island: a.v, host: b.v }); if (!r.ok) { $('socWhy').textContent = r.why; return; }
      prof = { island: a.v, host: b.v };
      if (g.mode === 'home') {
        const s = S(); s.social.acct = net.uid; s.social.island = a.v; s.social.host = b.v; s.social.pub = $('socPub0') ? $('socPub0').checked : s.social.pub; g.save();
        const p = await publish(true); toast(`${IX.globe} <b>${esc(a.v)}</b> is ${s.social.pub ? 'shared! Neighbours can drop by now' : 'named (and private)'}`, 3600);
        if (p && !p.ok) toast('Not shared yet: ' + esc(p.why), 4000);
      } else toast(`${IX.globe} Hello, <b>${esc(b.v)}</b>!`, 2400);
      list = null; render(); if (fromVisit) visitHud();
    }
    function visitUrl(id) {
      const u = new URLSearchParams(location.search); ['reset', 'away', 'seed', 'visit', 'speed', 'cam'].forEach(k => u.delete(k)); u.set('visit', id); u.set('nogift', '1');
      return location.pathname + '?' + u.toString();
    }
    function homeUrl() { const u = new URLSearchParams(location.search); ['visit', 'reset', 'away', 'seed', 'cam'].forEach(k => u.delete(k)); return location.pathname + (u.toString() ? '?' + u.toString() : ''); }
    async function goVisit(id) {
      if (g.mode === 'home') { g.save(); await publish(true); }
      location.href = visitUrl(id);
    }
    function bind() {
      $('socClose').onclick = close;
      $('socBody').addEventListener('click', async e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.st) { tab = t.dataset.st; list = null; render(); return; }
        if (t.dataset.isl) { goVisit(t.dataset.isl); return; }
        if (t.dataset.rep) { const r = await net.report('note', t.dataset.rep, 'reported by the island owner'); toast(r.ok ? 'Thank you: that note is reported' : 'Not reported yet: ' + esc(r.why), 2600); return; }
        if (t.id === 'socMake') { makeAccount(g.mode === 'visit'); return; }
        if (t.id === 'socGo') { query = ($('socQ').value || '').trim(); list = null; render(); return; }
        if (t.id === 'socEdit') { prof = Object.assign({}, prof); $('socBody').innerHTML = setupForm('Change your island or host name.'); return; }
        if (t.id === 'socPubNow') { const r = await publish(true); toast(r && r.ok ? `${IX.globe} Island shared with the neighbour isles` : 'Not shared yet: ' + esc(r ? r.why : 'no account'), 2600); render(); return; }
        // piece 5: the tour editor (My island)
        if (t.dataset.tsave !== undefined || t.dataset.tup !== undefined || t.dataset.tdel !== undefined) {
          const s = S(), T = window.Tour, why = $('socTourWhy');
          if (t.dataset.tsave !== undefined) { const i = +t.dataset.tsave, inp = $('socBody').querySelector(`input[data-tn="${i}"]`), res = {};
            if (!T.edit(s, i, inp ? inp.value : '', res)) { if (why) why.textContent = 'Note: ' + res.why; return; } toast(`${IX.tour} Note tucked in`, 1600); }
          else if (t.dataset.tup !== undefined) T.move(s, +t.dataset.tup, -1);
          else T.remove(s, +t.dataset.tdel);
          g.save(); pubSoon(); render(); return;
        }
        if (t.id === 'socTourAdd' && g.tourPick) { close(); g.tourPick(); return; }
        if (t.id === 'socTourShow' && g.tourPick) { close(); g.tourPick(null, true); return; }
        if (t.id === 'cuOpenSafe' && g.openSafe) { g.openSafe('main'); return; }
        if (t.id === 'cuOpenHave' && g.openSafe) { g.openSafe('have'); return; }
      });
      $('socBody').addEventListener('change', async e => {
        if (e.target.id === 'socPub') { const s = S(); s.social.pub = e.target.checked; g.save(); const r = await net.setPublic(s.social.pub); if (!r.ok) await publish(true); render(); }
      });
      $('socBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'socQ') $('socGo').click(); });
    }

    // ---------- visit mode
    let V = null;   // { island, own (visitor's own island, read-only), box }
    async function visitLoad(id) {
      if (!(await ensureSignIn())) return null;
      const isl = await net.getIsland(id); if (!isl || !isl.snap) return null;
      const st = window.Social.visitState(isl.snap, nav); if (!st) return null;
      // the visitor's own island, read-only: what it can give, what it already watered (never saved from here)
      let own = null; try { const raw = JSON.parse(localStorage.getItem(g.SAVE_KEY) || 'null'); own = raw && window.Sim.sanitize(raw.state, nav); } catch (e) {}
      V = { island: isl, own, liked: await net.liked(id), tour: !!(st.tour && st.tour.length) };
      if (isl.snap.sea >= 0) window.Seasons.fix = isl.snap.sea;   // the host's season (visual), never saved
      await net.visit(id);   // (awaited: the server's star rule wants a visit first)
      await starsFor([id]);  // piece 5: its star count + whether this visitor already starred it (nothing while patch_5 is missing)
      return st;
    }
    const today = () => window.Social.day(Date.now());
    function visitHud() {
      const isl = V.island, c = window.Growth.stageName(Math.max(1, Math.min(8, isl.lv || 1)));
      $('visBan').innerHTML = `<span class="isw" style="background:${/^#[0-9a-f]{6}$/i.test(isl.col || '') ? isl.col : '#9fd88a'}">${IC.sprout}</span><div><small>Visiting</small><b class="disp">${esc(isl.name)}</b><small>${esc(isl.host)}'s island &middot; ${esc(c)} (Lv ${isl.lv | 0}) &middot; ${IC.heart}<span id="visLikes">${isl.likes | 0}</span>${P5 ? ` &middot; <span class="stc" title="visitors who found it beautiful">${IX.star}<span id="visStars">${SN[isl.id] | 0}</span></span>` : ''}</small></div><button class="go sm" id="visHome">${IX.home}Home</button>`;
      $('visBan').hidden = false; $('visBar').hidden = false;
      const box = readBox(SLOT), canW = !V.own || window.Social.waterOk(V.own, isl.id, today(), box);
      $('visBar').innerHTML = `<button id="vWater" class="${canW ? '' : 'done'}" title="Give their tree a drink (once a day): a little boost for both trees">${IC.water}<span>${canW ? 'Water' : 'Watered'}</span></button>
        <button id="vGift" title="Leave a gift from your own island">${IC.gift}<span>Gift</span></button>
        <button id="vLike" class="${V.liked ? 'done' : ''}" title="Like this island">${IC.heart}<span>${V.liked ? 'Liked' : 'Like'}</span></button>
        ${P5 ? `<button id="vStar" class="star${STARRED.has(isl.id) ? ' done' : ''}" title="Found it beautiful? Tell the host (once)">${IX.star}<span>${STARRED.has(isl.id) ? 'Beautiful!' : 'Beautiful'}</span></button>` : ''}
        ${V.tour && g.startGuide ? `<button id="vTour" class="tour" title="Take the host's guided tour">${IX.tour}<span>Tour</span></button>` : ''}
        <button id="vNote" title="Guestbook">${IX.note}<span>Notes</span></button>
        <button id="vMore" title="The neighbour isles">${IX.globe}<span>Isles</span></button>`;
      $('visHome').onclick = () => { location.href = homeUrl(); };
      $('vWater').onclick = water; $('vGift').onclick = () => panel('gift'); $('vLike').onclick = like; $('vNote').onclick = () => panel('note'); $('vMore').onclick = () => open();
      if ($('vStar')) $('vStar').onclick = star;
      if ($('vTour')) $('vTour').onclick = () => { $('visPanel').hidden = true; g.startGuide(); };
      if (document.body.classList.contains('phone')) $('visHint').innerHTML = 'Tap the ground to trot there. Drag to look around.';
      $('visHint').hidden = false; setTimeout(() => { const h = $('visHint'); if (h) h.style.opacity = 0; }, 9000);
    }
    const needProfile = () => { if (prof) return false; open(); $('socBody').innerHTML = setupForm('To water, gift, like or sign the guestbook, pick a name first (no email needed).'); return true; };
    async function water() {
      if (needProfile()) return;
      const box = readBox(SLOT), d = today();
      if (V.own && !window.Social.waterOk(V.own, V.island.id, d, box)) { toast(`${IC.water} This tree already had a drink from you today. Come back tomorrow!`, 2600); return; }
      const r = await net.water(V.island.id);
      if (!r.ok) { toast(`${IC.water} ${esc(r.why === 'already watered today' ? 'This tree already had a drink from you today. Come back tomorrow!' : 'The water didn\'t reach it: ' + r.why)}`, 2800); return; }
      box.push({ id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), kind: 'water', island: V.island.id, day: d }); writeBox(SLOT, box);
      g.onWater(); toast(`${IC.water} You gave <b>${esc(V.island.name)}</b>'s tree a drink! Your own tree gets ${IC.water}+${window.Social.C.W_SELF.water} too`, 3600);
      $('vWater').classList.add('done'); $('vWater').querySelector('span').textContent = 'Watered';
    }
    async function like() {
      if (needProfile()) return; if (V.liked) { toast(`${IC.heart} You already like this isle`, 1800); return; }
      const r = await net.like(V.island.id);
      if (r.ok || r.why === 'liked') { V.liked = true; $('vLike').classList.add('done'); $('vLike').querySelector('span').textContent = 'Liked'; if (r.ok) { $('visLikes').textContent = (+$('visLikes').textContent + 1); g.onLike(); toast(`${IC.heart} You liked <b>${esc(V.island.name)}</b>`, 2000); } }
      else toast('The like didn\'t land: ' + esc(r.why), 2400);
    }
    // piece 5: "beautiful" = once per visitor per island, no undo (positive-only; the server keeps the same rules)
    async function star() {
      if (needProfile()) return; const isl = V.island;
      if (STARRED.has(isl.id)) { toast(`${IX.star} You already found <b>${esc(isl.name)}</b> beautiful`, 2000); return; }
      let r = await net.star(isl.id);
      if (r.why === 'visit first') { await net.visit(isl.id); r = await net.star(isl.id); }
      if (r.setup) { P5 = false; const b = $('vStar'); if (b) b.remove(); return; }   // the patch is missing: the button just goes away
      if (r.ok || r.why === 'starred') {
        STARRED.add(isl.id); const b = $('vStar'); if (b) { b.classList.add('done'); b.querySelector('span').textContent = 'Beautiful!'; }
        if (r.ok) { SN[isl.id] = r.stars; const n = $('visStars'); if (n) n.textContent = r.stars; if (g.onStar) g.onStar(); toast(`${IX.star} You found <b>${esc(isl.name)}</b> beautiful! ${esc(isl.host)} will hear about it`, 2600); }
        else toast(`${IX.star} You already found <b>${esc(isl.name)}</b> beautiful`, 2000);
        return;
      }
      toast(`${IX.star} ${r.why === 'rate' ? 'So many beautiful islands today! Try again a little later' : 'Not marked yet: ' + esc(r.why)}`, 2600);
    }
    async function panel(kind) {
      if (needProfile()) return;
      const el = $('visPanel'); el.hidden = false;
      if (kind === 'gift') {
        const sp = V.own ? window.Social.spare(V.own, readBox(SLOT)) : { res: {}, decor: [] }, M = window.Social.C.GIFT_MAX;
        const opts = [['wood', 10], ['wood', 30], ['stone', 10], ['stone', 30], ['food', 10], ['food', 30], ['crystal', 1], ['seeds', 1]].filter(([k, n]) => n <= M[k]);
        el.innerHTML = `<div class="pch"><span class="disp">${IC.gift} Leave a gift</span><button data-x="1">&#10005;</button></div><p class="sub">From your own island (${window.Social.C.GIFTS_PER_DAY} gifts per island a day). It reaches ${esc(V.island.host)} the next time they come home.</p>
          <div class="gopts">${opts.map(([k, n]) => `<button data-gk="${k}" data-gn="${n}"${(sp.res[k] || 0) < n ? ' disabled' : ''}>${IC[k === 'seeds' ? 'seed' : k]}+${n}<small>you have ${Math.floor(sp.res[k] || 0)}</small></button>`).join('')}
          ${sp.decor.map(d => `<button data-gd="${esc(d.id)}">${IC.decor}${esc(window.Exped.DECOR[d.id].name)}<small>you have ${d.n}</small></button>`).join('')}</div>${V.own ? '' : '<p class="sub">You have no island in this browser yet, so there is nothing to give just now.</p>'}`;
      } else {
        el.innerHTML = `<div class="pch"><span class="disp">${IX.note} ${esc(V.island.name)}'s guestbook</span><button data-x="1">&#10005;</button></div>
          <div class="srch"><input id="vNoteT" maxlength="${window.Social.C.NOTE_MAX}" placeholder="Write something kind..."><button class="go sm" id="vNoteGo">Sign</button></div><p id="vNoteWhy" class="why2"></p><div id="vGb"><p class="sub">...</p></div>
          <div class="pf"><small class="sub">See something unkind?</small><button class="ghost" id="vRepIsl">${IX.flag} Report island</button></div>`;
        loadVisitGb();
      }
    }
    async function loadVisitGb() {
      const L = await net.guestbook(V.island.id), el = $('vGb'); if (!el) return;
      el.innerHTML = Array.isArray(L) && L.length ? L.map(n => `<div class="gbn">${IX.note}<div>"${esc(n.text)}"<small>${esc(n.from)} &middot; ${ago(n.at)}</small></div>${n.mine ? '' : `<button class="rp" data-rep="${esc(n.id)}" title="Report this note">${IX.flag}</button>`}</div>`).join('') : '<p class="sub">No notes yet: be the first to sign!</p>';
    }
    function bindVisit() {
      $('visPanel').addEventListener('click', async e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.x) { $('visPanel').hidden = true; return; }
        if (t.dataset.gk || t.dataset.gd) {
          const g0 = t.dataset.gd ? { kind: 'decor', item: t.dataset.gd, n: 1 } : { kind: 'res', item: t.dataset.gk, n: +t.dataset.gn };
          const r = await net.gift(V.island.id, g0);
          if (!r.ok) { toast('The gift didn\'t go: ' + esc(r.why), 2800); return; }
          const box = readBox(SLOT); box.push(Object.assign({ id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), island: V.island.id }, g0)); writeBox(SLOT, box);
          g.onGift(); toast(`${IC.gift} Gift left for <b>${esc(V.island.host)}</b>!`, 2600); panel('gift'); return;
        }
        if (t.id === 'vNoteGo') {
          const c = window.Social.noteCheck($('vNoteT').value); if (!c.ok) { $('vNoteWhy').textContent = c.why; return; }
          const r = await net.note(V.island.id, c.v); if (!r.ok) { $('vNoteWhy').textContent = r.why; return; }
          $('vNoteT').value = ''; $('vNoteWhy').textContent = ''; toast(`${IX.note} You signed the guestbook`, 2000); if (window.__snd) window.__snd.sfx('note'); loadVisitGb(); return;
        }
        if (t.dataset.rep) { const r = await net.report('note', t.dataset.rep, 'unkind note'); toast(r.ok ? 'Thank you: that note is reported' : 'Not reported yet: try again', 2400); return; }
        if (t.id === 'vRepIsl') { const r = await net.report('island', V.island.id, 'reported from a visit'); toast(r.ok ? 'Thank you: that island is reported' : 'Not reported yet: try again', 2400); return; }
      });
      $('visPanel').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'vNoteT') $('vNoteGo').click(); });
    }

    // ---------- start
    function startHome() {
      bind(); $('socBtn').hidden = false; $('socBtn').onclick = () => { if ($('socCard').hidden) open(); else close(); };
      net.onChange(() => { if (!$('socCard').hidden && tab !== 'mine') { list = null; render(); } });
      // publish every 10 min while open + when leaving (mock: instant; Supabase: best effort)
      setInterval(() => publish(false), 30000);
      addEventListener('pagehide', () => { publish(true); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) publish(true); else homeSync(false); });
      return homeSync(true);
    }
    function startVisit() { bind(); bindVisit(); document.body.classList.add('visit'); visitHud(); }
    // step 7: signed in as another account (email code / magic link): forget the old account's profile + island
    function accountChanged() { signed = false; prof = null; mine = null; list = null; if (!$('socCard').hidden) { render(); ensureSignIn().then(render); } }
    return { net, open, close, render, publish, homeSync, pubSoon, loadShelf, get P5() { return P5; }, get shelf() { return shelf; }, SN, STARRED, accountChanged, awayHtml, awayDone, visitLoad, startHome, startVisit, homeUrl, visitUrl, goVisit, get V() { return V; }, get prof() { return prof; }, get news() { return news; }, readBox: () => readBox(SLOT) };
  }
  window.SocialUI = SocialUI;
})();
