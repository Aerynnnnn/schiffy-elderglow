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
    const S = () => g.S;
    const seasonNow = () => { const k = window.Seasons.of(S()); return k === null ? -1 : k; };

    async function ensureSignIn() {
      if (signed) return true;
      const r = await net.signIn(); if (!r.ok) { toast(`${IX.globe} Could not reach the island server (${esc(r.why)})`, 4000); return false; }
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
      const nn = { got, visits: (nw && nw.visits) || [], notes: (nw && nw.notes) || [], likesNew: (nw && nw.likesNew) || 0, likes: (nw && nw.likes) || 0 };
      if (got.length || nn.visits.length || nn.notes.length || nn.likesNew) {
        news = nn; s.social.tot.visitors += nn.visits.length; s.social.tot.notes += nn.notes.length; s.social.tot.likes = nn.likes;
        s.social.seenAt = Date.now(); g.save(); g.refresh();
        if (showCard) g.showAway(g.lastSum && g.lastSum()); else toast(`${IX.globe} Visitors came by! <u>See</u>`, 8000, () => g.showAway(null));
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
      if (names.length) h += `<li class="good">${IC.paw}<div>${names.slice(0, 6).map(x => `<b>${esc(x)}</b>`).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} visited your island</div></li>`;
      if (waters.length) h += `<li class="good">${IC.water}<div>${waters.length} watered your tree: ${IC.water}+${waters.length * window.Social.C.W_HOST.water} ${IC.sap}+${waters.length * window.Social.C.W_HOST.sap}</div></li>`;
      for (const x of gifts.slice(0, 6)) h += `<li class="good">${IC.gift}<div><b>${esc(x.from || 'A visitor')}</b> left a gift: ${x.kind === 'decor' ? IC.decor + esc(window.Exped.DECOR[x.item].name) : (IC[x.item === 'seeds' ? 'seed' : x.item] || '') + '+' + x.n}</div></li>`;
      if (n.likesNew) h += `<li>${IC.heart}+${n.likesNew} like${n.likesNew > 1 ? 's' : ''} (${n.likes} in all)</li>`;
      for (const x of n.notes.slice(0, 4)) h += `<li class="evl">${IX.note}<div>"${esc(x.text)}"<small>${esc(x.from)} &middot; ${ago(x.at)}</small></div></li>`;
      return h;
    }
    function awayDone() { news = null; }

    // ---------- Explore card
    function open() { $('socCard').hidden = false; render(); if (!signed) ensureSignIn().then(render); }
    function close() { $('socCard').hidden = true; }
    const setupForm = (why) => {
      const s = S(), isl = (prof && prof.island) || (s && s.social.island) || '', host = (prof && prof.host) || (s && s.social.host) || 'Schiffy';
      return `<p class="sub">${why || 'Give your island a name to share it. Other players can visit, water your tree, leave gifts and kind notes. Nothing a visitor does can take anything away.'}</p>
        <label class="fl">Island name<input id="socIsl" maxlength="24" value="${esc(isl)}" placeholder="e.g. Mossy Hollow"></label>
        <label class="fl">Your pup name (shown as the host)<input id="socHost" maxlength="14" value="${esc(host)}" placeholder="e.g. Schiffy"></label>
        <p id="socWhy" class="why2"></p>
        <label class="tog"><input type="checkbox" id="socPub0" ${!s || s.social.pub ? 'checked' : ''}><i></i>Public island (anyone can visit)</label>
        <div class="pf"><small class="sub">No email needed. ${net.kind === 'mock' ? 'Offline test server: only this browser sees it.' : ''}</small><button class="go" id="socMake">${prof ? 'Save' : 'Share my island'}</button></div>
        ${g.mode === 'home' && g.openSafe && !prof ? `<div class="acctrow"><button class="ghost" id="cuOpenSafe">${IX.lock} Keep my island safe</button><button class="ghost" id="cuOpenHave">I already have an island</button></div>` : ''}`;
    };
    function render() {
      const b = $('socBody'); if (!b) return;
      $('socTitle').innerHTML = `${IX.globe} ${g.mode === 'visit' ? 'Islands' : 'Explore islands'}`;
      if (!signed) { b.innerHTML = '<p class="sub">Connecting...</p>'; return; }
      if (!prof || (g.mode === 'home' && !S().social.acct)) { b.innerHTML = setupForm(); return; }
      const tabs = [['recent', IC.clock, 'Recent'], ['liked', IC.heart, 'Most liked'], ['random', IX.dice, 'Random'], ['search', IX.search, 'Search']].concat(g.mode === 'home' ? [['mine', IX.home, 'My island']] : []);
      let h = `<div class="stabs">${tabs.map(([k, ic, t]) => `<button data-st="${k}" class="${tab === k ? 'on' : ''}">${ic}${t}</button>`).join('')}</div>`;
      if (tab === 'mine') h += mineHtml();
      else {
        if (tab === 'search') h += `<div class="srch"><input id="socQ" maxlength="24" placeholder="Island name" value="${esc(query)}"><button class="go sm" id="socGo">${IX.search}</button></div>`;
        if (!list) h += '<p class="sub">Looking for islands...</p>';
        else if (!list.length) h += `<p class="sub">${tab === 'search' ? 'No island with that name yet.' : 'No public islands yet. Be the first!'}</p>`;
        else h += `<div class="icards">${list.map(cardHtml).join('')}</div>`;
      }
      b.innerHTML = h;
      if (!list && tab !== 'mine') load();
    }
    function cardHtml(c) {
      const stage = window.Growth.stageName(Math.max(1, Math.min(8, c.lv || 1)));
      return `<button class="icard${c.mine ? ' mine' : ''}" data-isl="${esc(c.id)}"${c.mine ? ' disabled' : ''}><span class="isw" style="background:${/^#[0-9a-f]{6}$/i.test(c.col || '') ? c.col : '#9fd88a'}">${IC.sprout}</span><span class="ici"><b>${esc(c.name)}</b><small>${esc(c.host)}'s island &middot; ${esc(stage)} (Lv ${c.lv | 0})</small><small>${IC.heart}${c.likes | 0} &middot; ${c.sample ? 'sample island' : 'updated ' + ago(c.updated)}${c.mine ? ' &middot; <i>yours</i>' : ''}</small></span></button>`;
    }
    function mineHtml() {
      const s = S(), so = s.social;
      let h = `<div class="myisl"><span class="isw lg" style="background:${window.Social.colOf(s.health, seasonNow())}">${IC.sprout}</span><div><b class="disp">${esc(prof.island)}</b><small>host ${esc(prof.host)} &middot; ${IC.heart}${mine ? mine.likes : so.tot.likes} likes &middot; ${so.pubAt ? 'shared ' + ago(so.pubAt) : 'not shared yet'}</small></div></div>
        <label class="tog"><input type="checkbox" id="socPub" ${so.pub ? 'checked' : ''}><i></i>${so.pub ? 'Public: anyone can visit' : 'Private: hidden from Explore'}</label>
        <p class="sub small">Your island is shared every 10 minutes while you play and when you leave (layout, pups, tree; never your resources).</p>
        <div class="pf"><button class="ghost" id="socEdit">Change names</button><button class="go sm" id="socPubNow">Share now</button></div>
        <h4>${IX.note} Your guestbook</h4><div id="socGb"><p class="sub">...</p></div>
        <h4>${IX.lock} Keep my island safe</h4><div id="socCloud">${g.cloudStatus ? g.cloudStatus() : ''}</div>
        <p class="sub small">Add your email to open this island on your phone or another computer (no password, a 6-digit code).</p>
        <div class="acctrow"><button class="go sm" id="cuOpenSafe">${IX.lock} Keep my island safe</button><button class="ghost" id="cuOpenHave">I already have an island</button></div>`;
      setTimeout(loadGb, 0); return h;
    }
    async function loadGb() {
      const el = $('socGb'); if (!el) return; if (!mine) mine = await net.myIsland();
      const L = mine ? await net.guestbook(mine.id) : [];
      el.innerHTML = Array.isArray(L) && L.length ? L.map(n => `<div class="gbn">${IX.note}<div>"${esc(n.text)}"<small>${esc(n.from)} &middot; ${ago(n.at)}</small></div><button class="rp" data-rep="${esc(n.id)}" title="Report this note">${IX.flag}</button></div>`).join('') : '<p class="sub">No notes yet.</p>';
    }
    async function load() {
      busy = true;
      const r = await net.browse({ sort: tab === 'search' ? 'recent' : tab, q: tab === 'search' ? query : '', limit: 24 });
      list = Array.isArray(r) ? r : []; busy = false; render();
    }
    async function makeAccount(fromVisit) {
      const a = window.Social.nameCheck($('socIsl').value, 'island'), b = window.Social.nameCheck($('socHost').value, 'host');
      if (!a.ok) { $('socWhy').textContent = 'Island name: ' + a.why; return; } if (!b.ok) { $('socWhy').textContent = 'Pup name: ' + b.why; return; }
      if (!(await ensureSignIn())) return;
      const r = await net.saveProfile({ island: a.v, host: b.v }); if (!r.ok) { $('socWhy').textContent = r.why; return; }
      prof = { island: a.v, host: b.v };
      if (g.mode === 'home') {
        const s = S(); s.social.acct = net.uid; s.social.island = a.v; s.social.host = b.v; s.social.pub = $('socPub0') ? $('socPub0').checked : s.social.pub; g.save();
        const p = await publish(true); toast(`${IX.globe} <b>${esc(a.v)}</b> is ${s.social.pub ? 'shared! Others can visit it now' : 'set up (private)'}`, 3600);
        if (p && !p.ok) toast('Could not share yet: ' + esc(p.why), 4000);
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
        if (t.dataset.rep) { const r = await net.report('note', t.dataset.rep, 'reported by the island owner'); toast(r.ok ? 'Thanks, the note was reported' : 'Could not report: ' + esc(r.why), 2600); return; }
        if (t.id === 'socMake') { makeAccount(g.mode === 'visit'); return; }
        if (t.id === 'socGo') { query = ($('socQ').value || '').trim(); list = null; render(); return; }
        if (t.id === 'socEdit') { prof = Object.assign({}, prof); $('socBody').innerHTML = setupForm('Change your island or host name.'); return; }
        if (t.id === 'socPubNow') { const r = await publish(true); toast(r && r.ok ? `${IX.globe} Island shared` : 'Could not share: ' + esc(r ? r.why : 'no account'), 2600); render(); return; }
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
      V = { island: isl, own, liked: await net.liked(id) };
      if (isl.snap.sea >= 0) window.Seasons.fix = isl.snap.sea;   // the host's season (visual), never saved
      net.visit(id);
      return st;
    }
    const today = () => window.Social.day(Date.now());
    function visitHud() {
      const isl = V.island, c = window.Growth.stageName(Math.max(1, Math.min(8, isl.lv || 1)));
      $('visBan').innerHTML = `<span class="isw" style="background:${/^#[0-9a-f]{6}$/i.test(isl.col || '') ? isl.col : '#9fd88a'}">${IC.sprout}</span><div><small>Visiting</small><b class="disp">${esc(isl.name)}</b><small>${esc(isl.host)}'s island &middot; ${esc(c)} (Lv ${isl.lv | 0}) &middot; ${IC.heart}<span id="visLikes">${isl.likes | 0}</span></small></div><button class="go sm" id="visHome">${IX.home}Home</button>`;
      $('visBan').hidden = false; $('visBar').hidden = false;
      const box = readBox(SLOT), canW = !V.own || window.Social.waterOk(V.own, isl.id, today(), box);
      $('visBar').innerHTML = `<button id="vWater" class="${canW ? '' : 'done'}" title="Water their tree (once a day): a little boost for both trees">${IC.water}<span>${canW ? 'Water' : 'Watered'}</span></button>
        <button id="vGift" title="Leave a gift from your own island">${IC.gift}<span>Gift</span></button>
        <button id="vLike" class="${V.liked ? 'done' : ''}" title="Like this island">${IC.heart}<span>${V.liked ? 'Liked' : 'Like'}</span></button>
        <button id="vNote" title="Guestbook">${IX.note}<span>Notes</span></button>
        <button id="vMore" title="Other islands">${IX.globe}<span>Islands</span></button>`;
      $('visHome').onclick = () => { location.href = homeUrl(); };
      $('vWater').onclick = water; $('vGift').onclick = () => panel('gift'); $('vLike').onclick = like; $('vNote').onclick = () => panel('note'); $('vMore').onclick = open;
      if (document.body.classList.contains('phone')) $('visHint').innerHTML = 'Tap the ground to walk there. Drag to look around.';
      $('visHint').hidden = false; setTimeout(() => { const h = $('visHint'); if (h) h.style.opacity = 0; }, 9000);
    }
    const needProfile = () => { if (prof) return false; open(); $('socBody').innerHTML = setupForm('To water, gift, like or write a note, pick a name first (no email needed).'); return true; };
    async function water() {
      if (needProfile()) return;
      const box = readBox(SLOT), d = today();
      if (V.own && !window.Social.waterOk(V.own, V.island.id, d, box)) { toast(`${IC.water} You already watered this tree today. Come back tomorrow!`, 2600); return; }
      const r = await net.water(V.island.id);
      if (!r.ok) { toast(`${IC.water} ${esc(r.why === 'already watered today' ? 'You already watered this tree today. Come back tomorrow!' : 'Could not water: ' + r.why)}`, 2800); return; }
      box.push({ id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), kind: 'water', island: V.island.id, day: d }); writeBox(SLOT, box);
      g.onWater(); toast(`${IC.water} You watered <b>${esc(V.island.name)}</b>'s tree! Your own tree gets ${IC.water}+${window.Social.C.W_SELF.water} too`, 3600);
      $('vWater').classList.add('done'); $('vWater').querySelector('span').textContent = 'Watered';
    }
    async function like() {
      if (needProfile()) return; if (V.liked) { toast(`${IC.heart} You already like this island`, 1800); return; }
      const r = await net.like(V.island.id);
      if (r.ok || r.why === 'liked') { V.liked = true; $('vLike').classList.add('done'); $('vLike').querySelector('span').textContent = 'Liked'; if (r.ok) { $('visLikes').textContent = (+$('visLikes').textContent + 1); g.onLike(); toast(`${IC.heart} You liked <b>${esc(V.island.name)}</b>`, 2000); } }
      else toast('Could not like: ' + esc(r.why), 2400);
    }
    async function panel(kind) {
      if (needProfile()) return;
      const el = $('visPanel'); el.hidden = false;
      if (kind === 'gift') {
        const sp = V.own ? window.Social.spare(V.own, readBox(SLOT)) : { res: {}, decor: [] }, M = window.Social.C.GIFT_MAX;
        const opts = [['wood', 10], ['wood', 30], ['stone', 10], ['stone', 30], ['food', 10], ['food', 30], ['crystal', 1], ['seeds', 1]].filter(([k, n]) => n <= M[k]);
        el.innerHTML = `<div class="pch"><span class="disp">${IC.gift} Leave a gift</span><button data-x="1">&#10005;</button></div><p class="sub">From your own island (${window.Social.C.GIFTS_PER_DAY} gifts per island a day). It reaches ${esc(V.island.host)} next time they come home.</p>
          <div class="gopts">${opts.map(([k, n]) => `<button data-gk="${k}" data-gn="${n}"${(sp.res[k] || 0) < n ? ' disabled' : ''}>${IC[k === 'seeds' ? 'seed' : k]}+${n}<small>you have ${Math.floor(sp.res[k] || 0)}</small></button>`).join('')}
          ${sp.decor.map(d => `<button data-gd="${esc(d.id)}">${IC.decor}${esc(window.Exped.DECOR[d.id].name)}<small>you have ${d.n}</small></button>`).join('')}</div>${V.own ? '' : '<p class="sub">You have no island in this browser yet, so there is nothing to give.</p>'}`;
      } else {
        el.innerHTML = `<div class="pch"><span class="disp">${IX.note} ${esc(V.island.name)}'s guestbook</span><button data-x="1">&#10005;</button></div>
          <div class="srch"><input id="vNoteT" maxlength="${window.Social.C.NOTE_MAX}" placeholder="Write something kind..."><button class="go sm" id="vNoteGo">Sign</button></div><p id="vNoteWhy" class="why2"></p><div id="vGb"><p class="sub">...</p></div>
          <div class="pf"><small class="sub">See something unkind?</small><button class="ghost" id="vRepIsl">${IX.flag} Report island</button></div>`;
        loadVisitGb();
      }
    }
    async function loadVisitGb() {
      const L = await net.guestbook(V.island.id), el = $('vGb'); if (!el) return;
      el.innerHTML = Array.isArray(L) && L.length ? L.map(n => `<div class="gbn">${IX.note}<div>"${esc(n.text)}"<small>${esc(n.from)} &middot; ${ago(n.at)}</small></div>${n.mine ? '' : `<button class="rp" data-rep="${esc(n.id)}" title="Report this note">${IX.flag}</button>`}</div>`).join('') : '<p class="sub">No notes yet: be the first!</p>';
    }
    function bindVisit() {
      $('visPanel').addEventListener('click', async e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.x) { $('visPanel').hidden = true; return; }
        if (t.dataset.gk || t.dataset.gd) {
          const g0 = t.dataset.gd ? { kind: 'decor', item: t.dataset.gd, n: 1 } : { kind: 'res', item: t.dataset.gk, n: +t.dataset.gn };
          const r = await net.gift(V.island.id, g0);
          if (!r.ok) { toast('Could not give: ' + esc(r.why), 2800); return; }
          const box = readBox(SLOT); box.push(Object.assign({ id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), island: V.island.id }, g0)); writeBox(SLOT, box);
          g.onGift(); toast(`${IC.gift} Gift left for <b>${esc(V.island.host)}</b>!`, 2600); panel('gift'); return;
        }
        if (t.id === 'vNoteGo') {
          const c = window.Social.noteCheck($('vNoteT').value); if (!c.ok) { $('vNoteWhy').textContent = c.why; return; }
          const r = await net.note(V.island.id, c.v); if (!r.ok) { $('vNoteWhy').textContent = r.why; return; }
          $('vNoteT').value = ''; $('vNoteWhy').textContent = ''; toast(`${IX.note} You signed the guestbook`, 2000); loadVisitGb(); return;
        }
        if (t.dataset.rep) { const r = await net.report('note', t.dataset.rep, 'unkind note'); toast(r.ok ? 'Thanks, the note was reported' : 'Could not report', 2400); return; }
        if (t.id === 'vRepIsl') { const r = await net.report('island', V.island.id, 'reported from a visit'); toast(r.ok ? 'Thanks, the island was reported' : 'Could not report', 2400); return; }
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
    return { net, open, close, render, publish, homeSync, accountChanged, awayHtml, awayDone, visitLoad, startHome, startVisit, homeUrl, visitUrl, goVisit, get V() { return V; }, get prof() { return prof; }, get news() { return news; }, readBox: () => readBox(SLOT) };
  }
  window.SocialUI = SocialUI;
})();
