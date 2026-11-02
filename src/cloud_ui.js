// CloudUI (step 7): the "Keep my island safe" card (link an email to this anonymous island, or sign in on a new device
// with a 6-digit code, sign out, older copies kept on this device) and the "Which island?" choice card (both copies
// changed / signed in on a device that already had an island / a newer cloud copy found mid-play).
// Talks to the backend through Net (src/net.js) and to the sync engine through Cloud.Sync (src/cloud.js).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SV = body => `<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  const IX = {
    cloud: SV('<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.6 9.1 4.75 4.75 0 0 0 7 18.5z" fill="#cfefff"/>'),
    link: SV('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none"/>'),
    shield: SV('<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" fill="#b8f0c4"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none"/>'),
    mail: SV('<rect x="3.5" y="6" width="17" height="12.5" rx="2" fill="#fff6dc"/><path d="M4 7l8 6.5L20 7" fill="none"/>'),
    key: SV('<circle cx="8" cy="12" r="4" fill="#ffd23f"/><path d="M12 12h8.5M17.5 12v3M20.5 12v2.2" fill="none"/>'),
    pc: SV('<rect x="3" y="4.5" width="18" height="11.5" rx="1.8" fill="#dff1ff"/><path d="M9 20h6M12 16v4" fill="none"/>'),
    phone: SV('<rect x="7" y="2.8" width="10" height="18.4" rx="2.2" fill="#dff1ff"/><path d="M11 18h2" fill="none"/>'),
    box: SV('<path d="M4 8.5l8-4 8 4v8l-8 4-8-4z" fill="#ffe2b8"/><path d="M4 8.5l8 4 8-4M12 12.5v8" fill="none"/>'),
  };
  const age = s => s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : s < 172800 ? (s / 3600).toFixed(s < 36000 ? 1 : 0) + ' h' : Math.round(s / 86400) + ' days';   // the island's own age (sim time)
  const agoT = ms => window.Cloud.agoText(Math.max(0, (Date.now() - ms) / 1000));
  const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;
  // cozy words for every backend error code (net.js authFail)
  const WHY = {
    rate: 'Our mail pigeon needs a rest: the free email service only sends a few emails per hour for the whole game. Please try again in a little while. (A link you already got still works for an hour.)',
    badcode: 'That code didn\'t work. It may have a typo or be too old (an hour). Use the link in the newest email, or ask for a new one.',
    exists: 'That email already has an island. To open that one here, use <b>I already have an island</b> (this device\'s island is kept as a backup).',
    nouser: 'No island answers to that email yet. Check the spelling, or keep this island safe with it instead.',
    bademail: 'That doesn\'t look quite like an email address.',
    offline: 'You seem to be offline. Your island keeps growing here; try again when you are back online.',
    setup: 'Email sign-in isn\'t open yet. Your island is still saved on this device.',
  };
  const why = r => WHY[r && r.code] || ('That didn\'t quite work' + (r && r.why ? ': ' + String(r.why).slice(0, 120) : '') + '. Please try again.');
  // email apps (Gmail on iPhone, Outlook, ...) often open links in their own little browser, which has its own storage
  const INAPP = 'Tip: some email apps open links in their own little browser. If your island does not show up, long-press the link and choose <b>Open in Safari</b> / <b>Open in Chrome</b>.';

  function CloudUI(g) {
    const { net, cloud, esc, toast, IC } = g;
    // views: main | linkSent (Keep my island safe: waiting for the confirm click) | have | haveSent (sign-in link sent) | signout
    let view = 'main', email = '', acct = null, msg = '', msgBad = false, busy = false, poll = null;
    // ---------- DOM (cards are made here; CSS in index.html)
    const app = $('app');
    const safe = document.createElement('div'); safe.id = 'safeCard'; safe.className = 'card'; safe.hidden = true;
    safe.innerHTML = `<div class="pch"><span id="safeTitle" class="disp">${IX.shield} Keep my island safe</span><button id="safeClose" title="Close">&#10005;</button></div><div id="safeBody"></div>`;
    const pick = document.createElement('div'); pick.id = 'pickCard'; pick.hidden = true; pick.innerHTML = '<div class="card"><div id="pickBody"></div></div>';
    app.appendChild(safe); app.appendChild(pick);
    $('safeClose').onclick = () => { safe.hidden = true; stopPoll(); };

    // ---------- the cloud status line
    function statusHtml() {
      if (!cloud) return '';
      if (cloud.off) return `<p class="cst">${IX.cloud}<span>${/patch_2|not switched on/.test(cloud.offWhy) ? 'Cloud saving opens with the next server update. Until then your island is kept on this device.' : esc(cloud.offWhy)}</span></p>`;
      if (cloud.conflict) return `<p class="cst warn">${IX.cloud}<span>Two islands found: pick one and cloud saving carries on. <u id="cuPickAgain">Show</u></span></p>`;
      if (!cloud.uid) return `<p class="cst">${IX.cloud}<span>Cloud save is off in this test window.</span></p>`;
      if (cloud.lastErr && cloud.dirty) return `<p class="cst warn">${IX.cloud}<span>Offline for now: new progress waits here and floats up to the cloud when you are back online${cloud.lastOk ? ` (last cloud copy ${agoT(cloud.lastOk)})` : ''}.</span></p>`;
      return `<p class="cst">${IX.cloud}<span>${cloud.lastOk ? `Cloud copy saved ${agoT(cloud.lastOk)}` : 'Cloud copy: saving soon'}</span></p>`;
    }
    function status() { const el = $('cuStatus'); if (el) el.innerHTML = statusHtml(); const m = $('socCloud'); if (m) m.innerHTML = statusHtml(); }

    // ---------- Keep my island safe
    const linked = a => !!(a && a.email && !a.anon);
    async function refreshAcct(quiet) {   // the confirm link is clicked in the email (any device): the server marks the email confirmed
      const a = await net.account(); if (!a || !a.ok) return acct;
      const was = linked(acct); acct = a;
      if (linked(a) && !was && (view === 'linkSent' || view === 'main')) {
        view = 'main'; msg = ''; stopPoll(); if (cloud) cloud.soon();
        toast(`${IX.shield} Your island is safe! It is linked to <b>${esc(a.email)}</b>`, 5000);
      } else if (!quiet && view === 'linkSent' && !linked(a)) say('Not confirmed yet. Tap the link in the email (any device is fine), then press the button again.', true);
      render(); return acct;
    }
    function startPoll() { stopPoll(); poll = setInterval(() => { if (!safe.hidden && view === 'linkSent' && !document.hidden) refreshAcct(true); }, 8000); }
    function stopPoll() { if (poll) clearInterval(poll); poll = null; }
    // coming back to the game after tapping the link in the mail app: check at once
    const onBack = () => { if (!safe.hidden && view === 'linkSent' && !document.hidden) refreshAcct(true); };
    addEventListener('focus', onBack); document.addEventListener('visibilitychange', onBack);
    async function openSafe(v) {
      safe.hidden = false; view = v || 'main'; msg = ''; render();
      if (g.closeOthers) g.closeOthers();
      const a = await net.account(); acct = a && a.ok ? a : null;
      if (view === 'main' && acct && acct.pending && !linked(acct)) { email = acct.pending; view = 'linkSent'; startPoll(); }
      render();
    }
    const line = () => msg ? `<p class="cmsg${msgBad ? ' bad' : ''}">${msg}</p>` : '';
    const backupsHtml = () => {
      const L = cloud ? cloud.backups() : []; if (!L.length) return '';
      return `<h4>${IX.box} Older copies on this device</h4><p class="sub small">Kept whenever an island was swapped, so nothing is lost.</p>` + L.map((e, i) => {
        const s = window.Cloud.summary(e.w.state, e.w.savedAt, Date.now());
        return `<div class="bkr"><div><b>${s.island ? esc(s.island) : 'Island'}</b> &middot; Lv ${s.lv} &middot; ${s.pups} pups<small>${esc(e.why || '')} &middot; ${agoT(e.at)}</small></div><button class="ghost" data-restore="${i}">Use this</button></div>`;
      }).join('');
    };
    // a code works too once the emails can carry one ({{ .Token }} needs custom SMTP on the free tier): kept small, folded away
    const codeBox = () => `<details class="codebox"><summary>Have a code instead?</summary><div class="srch"><input id="cuCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" class="code"><button class="go" id="cuOk"${busy ? ' disabled' : ''}>OK</button></div></details>`;
    const mailEl = () => `<label class="fl">Your email<input id="cuMail" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="you@example.com" value="${esc(email)}"></label>`;
    function render() {
      const b = $('safeBody'); if (!b || safe.hidden) return;
      const dis = busy ? ' disabled' : '';
      let h = '';
      if (view === 'main' && !acct) h = `<p class="sub">Checking your account...</p>${line()}`;
      else if (view === 'main' && linked(acct)) {
        h = `<div class="safeok">${IX.shield}<div><b class="disp">Your island is safe!</b><small>Linked to <b>${esc(acct.email)}</b></small></div></div>
          <div id="cuStatus">${statusHtml()}</div>
          <p class="sub">On your phone or another computer: open the game, tap <b>Visit</b> &rarr; <b>I already have an island</b> and type this email. We email a sign-in link, no password.</p>${line()}
          <div class="pf"><small class="sub">Leaving this device?</small><button class="ghost" id="cuOut"${dis}>Sign out here</button></div>${backupsHtml()}`;
      } else if (view === 'main') {
        h = `<p class="sub">Right now your island lives only in this browser. Add your email and it can follow you to your phone or another computer. No password: we email you a link to confirm.</p>
          <div id="cuStatus">${statusHtml()}</div>
          ${mailEl()}${line()}
          <div class="pf"><small class="sub">We only use it for sign-in links.</small><button class="go" id="cuSend"${dis}>${IX.mail} Send the link</button></div>
          <div class="cor"><span>or</span></div>
          <div class="pf"><small class="sub">Started an island on another device?</small><button class="ghost" id="cuHave"${dis}>${IX.key} I already have an island</button></div>${backupsHtml()}`;
      } else if (view === 'linkSent') {
        h = `<div class="sent">${IX.mail}<div><b class="disp">Check your email</b><small>We sent a link to <b>${esc(email)}</b></small></div></div>
          <p class="sub">Tap <b>the link in the email</b> to confirm it is yours. Any device is fine (your phone too). Then come back here: this card turns green by itself.</p>${line()}
          <div class="pf"><small class="sub">Done it?</small><button class="go" id="cuDone"${dis}>I've confirmed it</button></div>
          <p class="sub small">Nothing there after a few minutes? Check the spam folder.</p>
          <div class="pf"><button class="ghost" id="cuAgain"${dis}>Send again</button><button class="ghost" id="cuBack"${dis}>Use another email</button></div>${codeBox()}`;
        if (/Phone|Tablet/.test(navigator.userAgent) || document.body.classList.contains('phone')) h += `<p class="sub small inapp">${IX.link}<span>${INAPP.replace('If your island does not show up', 'If this card does not turn green')}</span></p>`;
      } else if (view === 'have') {
        h = `<p class="sub"><b>Welcome back!</b> Type the email you linked to your island. We send you a sign-in link (no password).</p>
          ${mailEl()}${line()}
          <p class="sub small">The island on this device is not lost: if you switch, it is kept here as a backup.</p>
          <div class="pf"><button class="ghost" id="cuBack0"${dis}>Back</button><button class="go" id="cuSendHave"${dis}>${IX.mail} Send the link</button></div>`;
      } else if (view === 'haveSent') {
        h = `<div class="sent">${IX.mail}<div><b class="disp">Check your email</b><small>We sent a sign-in link to <b>${esc(email)}</b></small></div></div>
          <p class="sub"><b>Open the email ON THE DEVICE YOU WANT TO PLAY ON</b> and tap <b>Sign in</b>. The game opens there with your island (if this device already has one, you pick which to keep).</p>${line()}
          <p class="sub small inapp">${IX.link}<span>${INAPP}</span></p>
          <p class="sub small">Nothing there after a few minutes? Check the spam folder. The link works for 1 hour.</p>
          <div class="pf"><button class="ghost" id="cuAgain"${dis}>Send again</button><button class="ghost" id="cuBack"${dis}>Use another email</button></div>${codeBox()}`;
      } else if (view === 'signout') {
        h = `<p class="sub"><b>Sign out of this device?</b> Your island stays safe in the cloud: sign in again with your email any time. This device then starts a fresh little island.</p>${line()}
          <div class="pf"><button class="ghost" id="cuBack0"${dis}>Stay signed in</button><button class="go" id="cuOutYes"${dis}>Sign out</button></div>`;
      }
      b.innerHTML = h;
      $('safeTitle').innerHTML = view === 'have' || view === 'haveSent' ? `${IX.key} I already have an island` : `${IX.shield} Keep my island safe`;
    }
    const say = (t, bad) => { msg = t; msgBad = !!bad; render(); };
    const mockNote = r => { if (r && r.mockLink) toast(`${IX.mail} Pretend server (no real email): <a href="${esc(r.mockLink)}">open the link</a>`, 20000); };
    async function send(kind) {   // kind: 'link' (this island gets the email) | 'have' (sign in to an island elsewhere)
      const v = (($('cuMail') || {}).value || email || '').trim(); email = v;
      if (!EMAIL_RE.test(v)) { say(WHY.bademail, true); return; }
      busy = true; say('Sending...');
      const r = kind === 'link' ? await net.linkEmail(v) : await net.sendCode(v); busy = false;
      if (!r.ok) { say(why(r), true); return; }
      mockNote(r); view = kind === 'link' ? 'linkSent' : 'haveSent'; say('');
      if (kind === 'link') startPoll();
    }
    async function confirm() {   // the folded "Have a code instead?" path
      const code = (($('cuCode') || {}).value || '').replace(/\s+/g, '');
      if (!/^\d{6,8}$/.test(code)) { say('The code is the 6 numbers in the email.', true); return; }
      busy = true; say('Checking...');
      const r = view === 'linkSent' ? await net.verifyLink(email, code) : await net.verifyCode(email, code); busy = false;
      if (!r.ok) { say(why(r), true); return; }
      if (view === 'linkSent') { await refreshAcct(true); if (!linked(acct)) { acct = Object.assign({}, acct || {}, { email, anon: false, pending: null }); view = 'main'; render(); } }
      else { safe.hidden = true; stopPoll(); toast(`${IX.key} Signed in! Your island is on its way...`, 3000); await g.onAccount(r.uid); }
    }
    safe.addEventListener('click', async e => {
      const t = e.target.closest('button, u'); if (!t) return;
      if (t.dataset.restore !== undefined) { if (cloud && cloud.restore(+t.dataset.restore)) g.reloadClean('That copy is back. Reloading...', 'The older copy is back. The island you had a moment ago is kept as a backup.'); return; }
      switch (t.id) {
        case 'cuSend': return send('link');
        case 'cuSendHave': return send('have');
        case 'cuHave': view = 'have'; msg = ''; stopPoll(); return render();
        case 'cuDone': busy = true; say('Checking...'); busy = false; return refreshAcct(false);
        case 'cuOk': return confirm();
        case 'cuAgain': return send(view === 'linkSent' ? 'link' : 'have');
        case 'cuBack': view = view === 'linkSent' ? 'main' : 'have'; msg = ''; stopPoll(); return render();
        case 'cuBack0': view = 'main'; msg = ''; return render();
        case 'cuOut': view = 'signout'; msg = ''; return render();
        case 'cuOutYes': { busy = true; say('Saving a last cloud copy...'); await g.signOut(); return; }
        case 'cuPickAgain': if (cloud && cloud.conflict) showPick(cloud.conflict); return;
      }
    });
    safe.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if (e.target.id === 'cuCode') confirm(); else if (e.target.id === 'cuMail') send(view === 'have' ? 'have' : 'link'); });

    // ---------- the choice card
    let pickInfo = null;
    function tile(side, s, label, ic, rec) {
      return `<div class="ptile${rec ? ' rec' : ''}">${rec ? '<span class="prec">further along</span>' : ''}<div class="pth">${ic}<b>${label}</b></div>
        <b class="disp pin">${s.island ? esc(s.island) : 'Your island'}</b>
        <ul><li>${IC.sprout || ''}Tree Lv ${s.lv}${s.stage ? ' &middot; ' + esc(s.stage) : ''}</li><li>${IC.paw || ''}${s.pups} pup${s.pups === 1 ? '' : 's'} &middot; ${s.built} building${s.built === 1 ? '' : 's'}</li><li>${IC.clock || ''}saved ${s.savedAt ? window.Cloud.agoText(s.ago) : 'just now'} &middot; ${age(s.time)} old</li></ul>
        <button class="big" data-pick="${side}">Keep this one</button></div>`;
    }
    function showPick(info) {
      pickInfo = info; pick.hidden = false;
      const dev = info.device ? esc(info.device) : 'another device';
      const T = { login: ['Welcome back!', 'You signed in, and this device already has an island too. Which one would you like to play here?'],
        newer: ['A newer island was found', `Your island moved on on ${dev}. Load that one, or keep this device's?`],
        both: ['Which island should we keep?', `This device and the cloud copy (from ${dev}) both have new progress.`] }[info.kind] || ['Which island should we keep?', ''];
      const phoneIc = /Phone|Tablet/.test(info.device || '') ? IX.phone : IX.pc;
      $('pickBody').innerHTML = `<h2 class="disp">${IX.cloud} ${T[0]}</h2><p class="sub">${T[1]}</p>
        <div class="ptiles">${tile('local', info.local, 'This device', document.body.classList.contains('phone') ? IX.phone : IX.pc, info.rec === 'local')}${tile('cloud', info.cloud, info.kind === 'login' ? 'Your saved island' : 'Cloud copy', phoneIc, info.rec === 'cloud')}</div>
        <p class="sub small pfoot">${IX.box} The other one is kept on this device as a backup, so nothing is lost. <u id="pickLater">Decide later</u></p>`;
    }
    pick.addEventListener('click', async e => {
      const t = e.target.closest('button, u'); if (!t) return;
      if (t.id === 'pickLater') { pick.hidden = true; if (cloud) cloud.later(); status(); toast(`${IX.cloud} Cloud saving waits until you pick (next time you open the game).`, 4000); return; }
      const side = t.dataset.pick; if (!side || !cloud) return;
      pick.querySelectorAll('button').forEach(x => { x.disabled = true; });
      const r = await cloud.resolve(side);
      if (r === 'reload') { g.reloadClean('Loading your saved island...', `Welcome back! This is your saved island${pickInfo && pickInfo.device ? ' (last played on ' + pickInfo.device + ')' : ''}. The other one is kept as a backup.`); return; }
      pick.hidden = true; status();
      toast(r === 'kept' ? `${IX.cloud} Keeping this island. It is now your cloud copy.` : `${IX.cloud} Keeping this island. It goes to the cloud as soon as you are online.`, 4200);
    });

    return { openSafe, closeSafe: () => { safe.hidden = true; }, showPick, status, statusHtml, render, get pickOpen() { return !pick.hidden; }, get safeOpen() { return !safe.hidden; }, IX };
  }
  window.CloudUI = CloudUI;
})();
