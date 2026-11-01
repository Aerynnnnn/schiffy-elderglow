// Net (step 6): the online-islands backend behind ONE interface, two implementations:
//  - mock (default; src/net_config.js empty): a pretend server in localStorage (+ BroadcastChannel so other tabs see
//    changes), seeded with sample islands, the same rules / rate limits as server/schema.sql. Each ?slot= is its own
//    "account"; ?mockdb=NAME = a separate pretend server (tests).
//  - supabase: supabase-js v2 (pinned UMD from jsDelivr, loaded only when configured), anonymous sign-in, the anon key
//    only; every rule is enforced by Row Level Security + triggers + RPCs in server/schema.sql.
// Every method is async and returns plain objects; failures return { ok: false, why } (never throw into the game).
// Interface: kind, uid, signIn(), profile(), saveProfile({island, host}), publish({snap, pub}), setPublic(pub),
//   deleteIsland() (owner only; no UI yet, tests clean up with it), myIsland(), browse({sort: 'recent'|'liked'|'random', q, limit}), getIsland(id), visit(id), water(id),
//   gift(id, {kind, item, n}), like(id), liked(id), note(id, text), guestbook(id), report(kind, id, reason),
//   inbox(), claim(ids), news(sinceMs), onChange(fn)
// Step 7 (cloud save + email, server/patch_2.sql): cloudGet() -> { ok, row: { state, save_v, gen, rev, device, saved } | null },
//   cloudPut({ state, saveV, gen, rev, baseRev, device }) -> { ok, saved } | { ok: false, conflict: true, row } (compare-and-swap
//   on rev) | { ok: false, setup: true } (table missing), cloudDelete(); account() -> { anon, email, pending }, linkEmail(email)
//   (this anonymous user gets an email: same uid), verifyLink(email, code), sendCode(email) (new device; never creates a user),
//   verifyCode(email, code) -> { uid } (now signed in as that account), signOut() -> a fresh anonymous uid, onAuth(fn('switched'|'updated', uid)).
//   Auth failures carry code: rate | badcode | exists | nouser | bademail | offline | setup | other. The mock shows its pretend code as mockCode.
// Round 2 step 4 (lantern notes + World Bloom, server/patch_3.sql; { setup: true } = patch not run yet): lanternSend({ body, col }) -> { ok, id, left },
//   lanternInbox() -> [{ id, from, body, col, at, read, warm }] (marks them delivered), lanternAct(id, 'read'|'warmth'|'report'),
//   lanternSent() -> [{ id, at, found, warm }] (never who), bloomStatus() -> { cyc, total, prev, today, mine, cap }, bloomAdd(n) -> { added, today, total }
// Round 2 step 5 (push, server/patch_4.sql; { setup: true } = patch not run yet): pushSubscribe({ endpoint, p256dh, auth, prefs, qf, qt, tz }),
//   pushUnsubscribe(endpoint), pushPlan(tripKey, dueMs, n) (boat home push while the app is away), pushUnplan(tripKey | null)
// Creative build piece 5 (showing off, server/patch_5.sql; { setup: true } = patch not run yet -> the game shows no stars / no shelf):
//   star(id) -> { ok, stars } | { ok: false, why: starred | visit first | rate | your own island | ... } (once per visitor per island, no undo),
//   starInfo(ids) -> { n: {id: count}, mine: [ids I starred] }, starNews(sinceMs) -> { total, since } (my island),
//   shelf() -> { cyc, week: card | null, last: card | null, featured: [card] } (card + stars, week, new). Mock: opt.p5 === false = patch missing.
(function () {
  'use strict';
  const SB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  const Soc = () => window.Social;
  const pad = (n, w) => String(n).padStart(w, '0');
  const DAY = ms => Math.floor(ms / 86400000);

  // ================= mock =================
  function Mock(opt) {
    const KEY = 'schiffy-elderglow.mockdb' + (opt.mockdb ? '.' + opt.mockdb : ''), UIDK = 'schiffy-elderglow.mock.uid' + (opt.slot || '') + (opt.mockdb ? '.' + opt.mockdb : '');
    const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(KEY) : null, subs = [];
    if (bc) bc.onmessage = () => subs.forEach(f => { try { f(); } catch (e) {} });
    const read = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.v === 1) return o; } catch (e) {} return null; };
    function db() {
      let o = read();
      if (!o) {
        o = { v: 1, seq: 0, users: {}, islands: {}, visits: [], gifts: [], likes: [], notes: [], reports: [], stars: [] };
        for (const x of (opt.samples ? opt.samples() : [])) {
          o.islands[x.id] = { id: x.id, owner: 'sample', name: x.name, host: x.host, snap: x.snap, lv: x.snap.lv, col: x.snap.col, pub: true, likes: x.likes, created: Date.now() - 86400000 * (3 + x.snap.lv), updated: Date.now() - 3600000 * (2 + x.snap.lv * 5) };
          // piece 5: a few pretend visitors found the sample islands beautiful (so the no-server Explore shelf is not empty)
          for (let k = 0; k < (x.stars || 0); k++) o.stars.push({ island: x.id, uid: 'sample-v' + k, at: Date.now() - 60000 * (k + 1) });
        }
        write(o);
      }
      return o;
    }
    function write(o) { localStorage.setItem(KEY, JSON.stringify(o)); if (bc) bc.postMessage(1); }
    const nid = (o, p) => p + pad(++o.seq, 8);
    const now = () => (opt.now ? opt.now() : Date.now());   // tests may move the pretend server's clock (stars + the week pick)
    const OFF5 = { ok: false, setup: true, why: 'stars are not switched on on the server yet (server/patch_5.sql)' };
    let uid = null, landed = null;   // landed = the result of a pretend email link this page was opened with
    const me = o => o.users[uid] || null;
    const mine = o => Object.values(o.islands).find(i => i.owner === uid) || null;
    const today = () => DAY(Date.now());
    const pubIsland = (o, id) => { const i = o.islands[id]; return i && i.pub ? i : null; };
    const card = i => ({ id: i.id, name: i.name, host: i.host, lv: i.lv, likes: i.likes, col: i.col, updated: i.updated, mine: i.owner === uid, sample: i.owner === 'sample' });
    const canVisitorAct = (o, id) => { if (!uid) return 'not signed in'; if (!me(o)) return 'no profile'; const i = pubIsland(o, id); if (!i) return 'island not found'; if (i.owner === uid) return 'your own island'; return null; };
    const api = {
      kind: 'mock', get uid() { return uid; },
      // no db() here: the cloud save signs in before the map (and the sample islands' nav) exist
      async signIn() { try {
        uid = localStorage.getItem(UIDK);
        if (typeof location !== 'undefined' && /mock_(confirm|login)=/.test(location.hash)) { landed = api.landLink(location.hash); history.replaceState(null, '', location.pathname + location.search); }
        if (!uid) { uid = 'mock-' + Math.random().toString(36).slice(2, 12); localStorage.setItem(UIDK, uid); } return { ok: true, uid, landed }; } catch (e) { return { ok: false, why: 'storage' }; } },
      get landed() { return landed; },
      async profile() { const o = db(); const u = uid && o.users[uid]; return u ? { island: u.island, host: u.host } : null; },
      async saveProfile(p) {
        const a = Soc().nameCheck(p.island, 'island'), b = Soc().nameCheck(p.host, 'host'); if (!a.ok) return { ok: false, why: 'Island name: ' + a.why }; if (!b.ok) return { ok: false, why: 'Pup name: ' + b.why };
        const o = db(); o.users[uid] = { island: a.v, host: b.v, created: (me(o) || {}).created || Date.now() };
        const i = mine(o); if (i) { i.name = a.v; i.host = b.v; } write(o); return { ok: true };
      },
      async publish({ snap, pub }) {
        const o = db(), u = me(o); if (!u) return { ok: false, why: 'no profile' };
        if (!Soc().checkSnap(snap)) return { ok: false, why: 'snapshot too big or bad' };
        let i = mine(o); if (!i) { i = { id: nid(o, 'isl'), owner: uid, likes: 0, created: Date.now() }; o.islands[i.id] = i; }
        Object.assign(i, { name: u.island, host: u.host, snap, lv: snap.lv, col: snap.col, pub: pub !== false, updated: Date.now() }); write(o);
        return { ok: true, id: i.id };
      },
      async setPublic(pub) { const o = db(), i = mine(o); if (!i) return { ok: false, why: 'not published yet' }; i.pub = !!pub; write(o); return { ok: true }; },
      async deleteIsland() {   // = SQL on delete cascade: its visits, gifts, likes, notes go with it
        const o = db(), i = mine(o); if (!i) return { ok: false, why: 'not published yet' };
        delete o.islands[i.id]; for (const k of ['visits', 'gifts', 'likes', 'notes', 'stars']) o[k] = (o[k] || []).filter(x => x.island !== i.id); write(o); return { ok: true, n: 1 };
      },
      async myIsland() { const i = mine(db()); return i ? { id: i.id, likes: i.likes, pub: i.pub, updated: i.updated } : null; },
      async browse({ sort, q, limit }) {
        let L = Object.values(db().islands).filter(i => i.pub);
        if (q) { const s = String(q).toLowerCase().slice(0, 24); L = L.filter(i => i.name.toLowerCase().includes(s)); }
        if (sort === 'liked') L.sort((a, b) => b.likes - a.likes || b.updated - a.updated);
        else if (sort === 'random') { for (let k = L.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [L[k], L[j]] = [L[j], L[k]]; } }
        else L.sort((a, b) => b.updated - a.updated);
        return L.slice(0, limit || 24).map(card);
      },
      async getIsland(id) { const i = pubIsland(db(), id) || (mine(db()) && mine(db()).id === id ? mine(db()) : null); return i ? Object.assign(card(i), { snap: i.snap }) : null; },
      async visit(id) {
        const o = db(), why = canVisitorAct(o, id); if (why) return { ok: false, why };
        const hr = o.visits.filter(v => v.uid === uid && now() - v.at < 3600000).length; if (hr >= Soc().C.VISITS_PER_HOUR) return { ok: false, why: 'rate' };
        o.visits.push({ id: nid(o, 'v'), island: id, uid, from: me(o).host, fromIsland: me(o).island, at: now() }); write(o); return { ok: true };
      },
      async water(id) {
        const o = db(), why = canVisitorAct(o, id); if (why) return { ok: false, why };
        if (o.gifts.some(g => g.island === id && g.uid === uid && g.kind === 'water' && g.day === today())) return { ok: false, why: 'already watered today' };
        o.gifts.push({ id: nid(o, 'g'), island: id, uid, from: me(o).host, kind: 'water', item: null, n: 1, day: today(), claimed: false, at: Date.now() }); write(o); return { ok: true, day: today() };
      },
      async gift(id, g) {
        const o = db(), why = canVisitorAct(o, id); if (why) return { ok: false, why };
        const C = Soc().C, n = Math.round(+g.n || 0);
        if (g.kind === 'res' ? !(C.GIFT_MAX[g.item] >= n && n >= 1) : !(g.kind === 'decor' && window.Exped.DECOR[g.item])) return { ok: false, why: 'bad gift' };
        if (o.gifts.filter(x => x.island === id && x.uid === uid && x.kind !== 'water' && x.day === today()).length >= C.GIFTS_PER_DAY) return { ok: false, why: `${C.GIFTS_PER_DAY} gifts per island per day` };
        o.gifts.push({ id: nid(o, 'g'), island: id, uid, from: me(o).host, kind: g.kind, item: g.item, n: g.kind === 'decor' ? 1 : n, day: today(), claimed: false, at: Date.now() }); write(o); return { ok: true };
      },
      async like(id) {
        const o = db(), why = canVisitorAct(o, id); if (why) return { ok: false, why };
        if (o.likes.some(l => l.island === id && l.uid === uid)) return { ok: false, why: 'liked' };
        o.likes.push({ island: id, uid, from: me(o).host, at: Date.now() }); o.islands[id].likes++; write(o); return { ok: true, likes: o.islands[id].likes };
      },
      async liked(id) { return db().likes.some(l => l.island === id && l.uid === uid); },
      // ---- piece 5 "showing off" (= server/patch_5.sql: the same rules, limits, picks; opt.p5 === false = the patch is missing)
      async star(id) {
        if (opt.p5 === false) return OFF5;
        const o = db(), St = Soc().C.STAR, t = now(); if (!uid) return { ok: false, why: 'not signed in' }; if (!me(o)) return { ok: false, why: 'pick a name first' };
        const i = pubIsland(o, id); if (!i) return { ok: false, why: 'island not found' }; if (i.owner === uid) return { ok: false, why: 'your own island' };
        const L = o.stars || (o.stars = []); if (L.some(s => s.island === id && s.uid === uid)) return { ok: false, why: 'starred' };
        if (!o.visits.some(v => v.island === id && v.uid === uid && t - v.at < St.VISIT_H * 3600000 && v.at <= t)) return { ok: false, why: 'visit first' };
        const my = L.filter(s => s.uid === uid);
        if (my.filter(s => t - s.at < 3600000).length >= St.HOUR || my.filter(s => DAY(s.at) === DAY(t)).length >= St.DAY) return { ok: false, why: 'rate' };
        L.push({ island: id, uid, at: t }); write(o); return { ok: true, stars: L.filter(s => s.island === id).length };
      },
      async starInfo(ids) {
        if (opt.p5 === false) return OFF5;
        const o = db(), L = o.stars || [], n = {}, A = (ids || []).slice(0, 60);
        for (const id of A) { const i = o.islands[id]; if (i && (i.pub || i.owner === uid)) n[id] = L.filter(s => s.island === id).length; }
        return { ok: true, n, mine: A.filter(id => L.some(s => s.island === id && s.uid === uid)) };
      },
      async starNews(since) {
        if (opt.p5 === false) return OFF5;
        const o = db(), i = mine(o); if (!i) return { ok: true, total: 0, since: 0 };
        const L = (o.stars || []).filter(s => s.island === i.id); return { ok: true, total: L.length, since: L.filter(s => s.at > (since || 0)).length };
      },
      async shelf() {
        if (opt.p5 === false) return OFF5;
        const o = db(), t = now(), So = Soc(), St = So.C.STAR, c = So.weekOf(t), ws = So.weekStart(c), L = o.stars || [];
        const okI = id => { const i = o.islands[id]; return i && i.pub && !o.reports.some(r => r.kind === 'island' && r.target === id && t - r.at < St.REPORT_DAYS * 86400000) ? i : null; };
        const rank = (a, b) => b.n - a.n || a.m - b.m || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        const groups = (from, to, not) => { const g = {}; for (const s of L) { if (s.at < from || s.at >= to || s.island === not || !okI(s.island)) continue; const e = g[s.island] || (g[s.island] = { id: s.island, n: 0, m: 0 }); e.n++; e.m = Math.max(e.m, s.at); } return Object.values(g).sort(rank); };
        const leader = (cc, not) => { const w = groups(So.weekStart(cc), So.weekStart(cc + 1), not)[0]; return w && w.n >= St.WEEK_MIN ? w.id : null; };
        const wp = o.wpick || (o.wpick = {});
        if (!(String(c - 1) in wp)) { wp[c - 1] = leader(c - 1, wp[c - 2] === undefined ? null : wp[c - 2]); write(o); }   // freeze last week's pick once
        const prev = wp[c - 1], w = leader(c, prev);
        const top = groups(ws, Infinity, w).filter(e => e.n >= St.FEAT_MIN).slice(0, St.FEAT_TOP).map(e => e.id);
        const all = id => L.filter(s => s.island === id).length;
        const nw = Object.values(o.islands).filter(i => okI(i.id) && t - (i.created || 0) < St.NEW_DAYS * 86400000 && i.id !== w && !top.includes(i.id) && all(i.id) > 0)
          .sort((a, b) => all(b.id) - all(a.id) || (b.created || 0) - (a.created || 0) || (a.id < b.id ? -1 : 1)).slice(0, St.FEAT_NEW).map(i => i.id);
        const cardW = id => { const i = id && okI(id); if (!i) return null; return Object.assign(card(i), { created: i.created || 0, stars: all(id), week: L.filter(s => s.island === id && s.at >= ws).length, new: t - (i.created || 0) < St.NEW_DAYS * 86400000 }); };
        return { ok: true, cyc: c, week: cardW(w), last: prev !== w ? cardW(prev) : null, featured: top.concat(nw).map(cardW).filter(Boolean) };
      },
      mockStar(island, u, at) { const o = db(); (o.stars || (o.stars = [])).push({ island, uid: u, at: at || now() }); write(o); },   // tests only (= an SQL superuser insert)
      async note(id, text) {
        const o = db(), why = canVisitorAct(o, id); if (why) return { ok: false, why };
        const c = Soc().noteCheck(text); if (!c.ok) return { ok: false, why: c.why };
        if (o.notes.filter(x => x.island === id && x.uid === uid && DAY(x.at) === today()).length >= Soc().C.NOTES_PER_DAY) return { ok: false, why: `${Soc().C.NOTES_PER_DAY} notes per island per day` };
        o.notes.push({ id: nid(o, 'n'), island: id, uid, from: me(o).host, text: c.v, hidden: false, at: Date.now() }); write(o); return { ok: true };
      },
      async guestbook(id) { return db().notes.filter(n => n.island === id && !n.hidden).slice(-30).reverse().map(n => ({ id: n.id, from: n.from, text: n.text, at: n.at, mine: n.uid === uid })); },
      async report(kind, id, reason) {
        const o = db(); if (!uid) return { ok: false, why: 'not signed in' };
        if (o.reports.some(r => r.uid === uid && r.kind === kind && r.target === id)) return { ok: true };
        o.reports.push({ id: nid(o, 'r'), uid, kind, target: id, reason: String(reason || '').slice(0, 200), at: now() });
        if (kind === 'note') {   // = the SQL trigger: hidden at once when the island's owner reports it, or after 3 reporters
          const n = o.notes.find(x => x.id === id), own = n && o.islands[n.island] && o.islands[n.island].owner === uid;
          if (n && (own || o.reports.filter(r => r.kind === 'note' && r.target === id).length >= 3)) n.hidden = true;
        }
        write(o); return { ok: true };
      },
      async inbox() { const o = db(), i = mine(o); if (!i) return []; return o.gifts.filter(g => g.island === i.id && !g.claimed).map(g => ({ id: g.id, kind: g.kind, item: g.item, n: g.n, from: g.from, at: g.at })); },
      async claim(ids) { const o = db(), i = mine(o); if (!i) return { ok: false }; const s = new Set(ids); for (const g of o.gifts) if (g.island === i.id && s.has(g.id)) g.claimed = true; write(o); return { ok: true }; },
      async news(since) {
        const o = db(), i = mine(o); if (!i) return { visits: [], notes: [], likes: 0, likesNew: 0 };
        return { visits: o.visits.filter(v => v.island === i.id && v.at > since).map(v => ({ from: v.from, island: v.fromIsland, at: v.at })),
          notes: o.notes.filter(n => n.island === i.id && n.at > since && !n.hidden).map(n => ({ id: n.id, from: n.from, text: n.text, at: n.at })), likes: i.likes,
          likesNew: o.likes.filter(l => l.island === i.id && l.at > since).length };
      },
      // ---- cloud save (= server/patch_2.sql): one row per account, compare-and-swap on rev, counter only goes up, <= 512 KB
      async cloudGet() {
        if (!uid) return { ok: false, why: 'not signed in' };
        const r = rdS().saves[uid]; return { ok: true, row: r ? JSON.parse(JSON.stringify(r)) : null };
      },
      async cloudPut(p) {
        if (!uid) return { ok: false, why: 'not signed in' };
        if (opt.offline && opt.offline()) return { ok: false, why: 'network' };
        const o = rdS(), cur = o.saves[uid], body = JSON.stringify(p.state || null);
        if (!p.state || typeof p.state !== 'object' || body.length > 524288) return { ok: false, why: 'save too big or bad' };
        if (!/^[A-Za-z0-9]{6,32}$/.test(p.rev || '') || String(p.device || '').length > 40) return { ok: false, why: 'bad rev / device' };
        if (cur && (!p.baseRev || p.baseRev !== cur.rev)) return { ok: false, conflict: true, row: JSON.parse(JSON.stringify(cur)) };   // insert over a row / update over a rev it no longer has
        if (!cur && p.baseRev) { /* the row is gone: insert, like the SQL client does */ }
        if (cur && !(p.gen > cur.gen)) return { ok: false, conflict: true, row: JSON.parse(JSON.stringify(cur)) };   // stale counter
        o.saves[uid] = { state: JSON.parse(body), save_v: p.saveV, gen: p.gen, rev: p.rev, device: String(p.device || ''), saved: Date.now() };
        wrS(o); return { ok: true, saved: o.saves[uid].saved };
      },
      async cloudDelete() { const o = rdS(); const had = !!o.saves[uid]; delete o.saves[uid]; wrS(o); return { ok: had }; },
      // ---- email (pretend: no mail is sent; the code comes back as mockCode and the game shows it in a toast)
      async account() { if (!uid) return { ok: false, why: 'not signed in' }; const a = rdA().users[uid] || {}; return { ok: true, uid, anon: !a.email, email: a.email || null, pending: a.pend ? a.pend.email : null }; },
      async linkEmail(email) {
        const o = rdA(), e = String(email || '').trim().toLowerCase(); if (!EMAIL_RE.test(e)) return { ok: false, code: 'bademail' };
        if (mailRate(o)) return { ok: false, code: 'rate' };
        if (Object.keys(o.users).some(k => k !== uid && o.users[k].email === e)) return { ok: false, code: 'exists' };
        const u = o.users[uid] = o.users[uid] || {}; u.pend = { email: e, code: code6(), tok: tok16(), at: Date.now() }; o.mails.push(Date.now()); wrA(o);
        return { ok: true, sent: true, mockCode: u.pend.code, mockLink: linkOf('confirm', u.pend.tok) };
      },
      async verifyLink(email, code) {
        const o = rdA(), u = o.users[uid], e = String(email || '').trim().toLowerCase();
        if (!u || !u.pend || u.pend.email !== e || u.pend.code !== String(code).trim() || Date.now() - u.pend.at > 3600000) return { ok: false, code: 'badcode' };
        u.email = e; delete u.pend; wrA(o); return { ok: true, uid };
      },
      async sendCode(email) {
        const o = rdA(), e = String(email || '').trim().toLowerCase(); if (!EMAIL_RE.test(e)) return { ok: false, code: 'bademail' };
        if (mailRate(o)) return { ok: false, code: 'rate' };
        const k = Object.keys(o.users).find(x => o.users[x].email === e); if (!k) return { ok: false, code: 'nouser' };
        o.users[k].login = { code: code6(), tok: tok16(), at: Date.now() }; o.mails.push(Date.now()); wrA(o); return { ok: true, sent: true, mockCode: o.users[k].login.code, mockLink: linkOf('login', o.users[k].login.tok) };
      },
      // a pretend email link opened on this device (= Supabase's verify link: server-side confirm, then this device is signed
      // in as that account). hash = '#mock_confirm=TOKEN' | '#mock_login=TOKEN'
      landLink(hash) {
        const m = /mock_(confirm|login)=([a-z0-9]{16})/.exec(String(hash || '')); if (!m) return null;
        const o = rdA(), now = Date.now();
        const k = Object.keys(o.users).find(x => { const u = o.users[x]; return m[1] === 'confirm' ? u.pend && u.pend.tok === m[2] && now - u.pend.at < 3600000 : u.login && u.login.tok === m[2] && now - u.login.at < 3600000; });
        if (!k) return { ok: false, code: 'badcode' };
        const u = o.users[k]; if (m[1] === 'confirm') { u.email = u.pend.email; delete u.pend; } else delete u.login; wrA(o);
        const prev = uid; uid = k; try { localStorage.setItem(UIDK, uid); } catch (e) {}
        if (prev && prev !== uid) authSubs.forEach(f => f('switched', uid));
        return { ok: true, kind: m[1], uid };
      },
      async verifyCode(email, code) {
        const o = rdA(), e = String(email || '').trim().toLowerCase(), k = Object.keys(o.users).find(x => o.users[x].email === e), u = k && o.users[k];
        if (!u || !u.login || u.login.code !== String(code).trim() || Date.now() - u.login.at > 3600000) return { ok: false, code: 'badcode' };
        delete u.login; wrA(o); uid = k; try { localStorage.setItem(UIDK, uid); } catch (x) {} authSubs.forEach(f => f('switched', uid)); return { ok: true, uid };
      },
      async signOut() { uid = 'mock-' + Math.random().toString(36).slice(2, 12); try { localStorage.setItem(UIDK, uid); } catch (e) {} return { ok: true, uid }; },
      // ---- lantern notes + World Bloom (= server/patch_3.sql: the same picks, limits and privacy)
      async lanternSend({ body, col }) {
        const o = rdL(), d = db(), u = me(d); if (!uid) return { ok: false, why: 'not signed in' }; if (!u) return { ok: false, why: 'pick a name first' };
        const c = Soc().noteCheck(body); if (!c.ok) return { ok: false, why: 'please keep it kind' };
        if (!window.Lanterns.colOk(col)) return { ok: false, why: 'bad colour' };
        const day = today(), mineL = o.lan.filter(l => l.from === uid);
        if (mineL.filter(l => l.hidden && Date.now() - l.at < 30 * 86400000).length >= 3) return { ok: false, why: 'your lanterns are resting for a while' };
        const n = mineL.filter(l => l.day === day).length; if (n >= window.Lanterns.C.PER_DAY) return { ok: false, why: 'three lanterns a day', left: 0 };
        const last = mineL.length ? mineL[mineL.length - 1].to : null;
        const cands = Object.values(d.islands).filter(i => i.owner !== uid && i.owner !== 'sample' && i.owner !== last && o.lan.filter(l => l.to === i.owner && l.day === day).length < 6);
        const act = cands.filter(i => Date.now() - (i.updated || 0) < 3 * 86400000), pool = act.length ? act : cands;
        // nobody else plays in this pretend world: a sample island "finds" it (so a solo test still sees "found someone")
        const to = pool.length ? pool[Math.floor(Math.random() * pool.length)].owner : (last !== 'sample' ? 'sample' : null);
        if (!to) return { ok: false, why: 'no one new to find yet: try again later' };
        const l = { id: 'lan' + pad(++o.seq, 8), from: uid, to, fromName: u.island, body: c.v, col, day, at: Date.now(), dl: to === 'sample' ? Date.now() : 0, rd: 0, warm: 0, hidden: false };
        o.lan.push(l); wrL(o); return { ok: true, id: l.id, left: window.Lanterns.C.PER_DAY - 1 - n };
      },
      async lanternInbox() {
        if (!uid) return []; const o = rdL(); let ch = false;
        const L = o.lan.filter(l => l.to === uid && !l.hidden && Date.now() - l.at < 30 * 86400000);
        for (const l of L) if (!l.dl) { l.dl = Date.now(); ch = true; }
        if (ch) wrL(o);
        return L.slice(-50).reverse().map(l => ({ id: l.id, from: l.fromName, body: l.body, col: l.col, at: l.at, read: !!l.rd, warm: !!l.warm }));
      },
      async lanternAct(id, act) {
        const o = rdL(), l = o.lan.find(x => x.id === id && x.to === uid); if (!uid || !l) return { ok: false, why: 'not your lantern' };
        if (act === 'read') l.rd = l.rd || Date.now();
        else if (act === 'warmth') { if (l.warm) return { ok: false, why: 'already sent' }; if (l.hidden) return { ok: false, why: 'not your lantern' }; l.warm = Date.now(); l.rd = l.rd || Date.now(); }
        else if (act === 'report') { l.hidden = true; const d = db(); if (!d.reports.some(r => r.uid === uid && r.kind === 'lantern' && r.target === id)) { d.reports.push({ id: nid(d, 'r'), uid, kind: 'lantern', target: id, reason: 'reported by its recipient', at: Date.now() }); write(d); } }
        else return { ok: false, why: 'bad action' };
        wrL(o); return { ok: true };
      },
      async lanternSent() { if (!uid) return []; return rdL().lan.filter(l => l.from === uid && Date.now() - l.at < 30 * 86400000).slice(-40).reverse().map(l => ({ id: l.id, at: l.at, found: !!l.dl, warm: !!l.warm })); },
      async bloomStatus() {
        if (!uid) return { ok: false, why: 'not signed in' };
        const o = rdL(), c = window.Lanterns.cycleOf(Date.now()), day = today(), k = c + '|' + uid + '|' + day;
        let mine = 0; for (const x in o.pet) if (x.startsWith(c + '|' + uid + '|')) mine += o.pet[x].n;
        return { ok: true, cyc: c, total: o.tot[c] || 0, prev: o.tot[c - 1] || 0, today: o.pet[k] ? o.pet[k].n : 0, mine, cap: window.Lanterns.C.CAP_DAY };
      },
      async bloomAdd(n) {
        if (!uid) return { ok: false, why: 'not signed in' };
        const o = rdL(), c = window.Lanterns.cycleOf(Date.now()), k = c + '|' + uid + '|' + today(), cur = o.pet[k] || { n: 0, at: 0 }, cap = window.Lanterns.C.CAP_DAY;
        if (cur.at && Date.now() - cur.at < (opt.bloomGap === undefined ? 10000 : opt.bloomGap)) return { ok: false, why: 'slow down' };
        const add = Math.max(0, Math.min(Math.round(+n || 0), cap - cur.n));
        o.pet[k] = { n: cur.n + add, at: Date.now() }; o.tot[c] = (o.tot[c] || 0) + add; wrL(o);
        return { ok: true, added: add, today: cur.n + add, cap, cyc: c, total: o.tot[c] };
      },
      // ---- push (Round 2 step 5): the mock only remembers devices + planned boats (nothing is ever sent: there is no sender)
      async pushSubscribe(p) {
        if (!uid) return { ok: false, why: 'not signed in' };
        if (!/^https:\/\//.test(p.endpoint || '')) return { ok: false, why: 'not a valid push subscription' };
        const o = rdP(); for (const e in o.subs) if (e === p.endpoint) delete o.subs[e];
        o.subs[p.endpoint] = { owner: uid, prefs: p.prefs, qf: p.qf, qt: p.qt, tz: p.tz, at: Date.now() }; wrP(o);
        return { ok: true, devices: Object.values(o.subs).filter(s => s.owner === uid).length };
      },
      async pushUnsubscribe(endpoint) { const o = rdP(); const had = o.subs[endpoint] && o.subs[endpoint].owner === uid; if (had) delete o.subs[endpoint]; if (!Object.values(o.subs).some(s => s.owner === uid)) o.plan = o.plan.filter(x => x.owner !== uid); wrP(o); return { ok: true, removed: had ? 1 : 0 }; },
      async pushPlan(key, due, n) {
        const o = rdP(); if (!Object.values(o.subs).some(s => s.owner === uid && s.prefs && s.prefs.boat)) return { ok: false, why: 'off' };
        if (!(due > Date.now() + 30000 && due < Date.now() + 30 * 3600000)) return { ok: false, why: 'bad time' };
        o.plan = o.plan.filter(x => !(x.owner === uid && x.key === key)); o.plan.push({ owner: uid, key, due, n }); wrP(o); return { ok: true };
      },
      async pushUnplan(key) { const o = rdP(), n0 = o.plan.length; o.plan = o.plan.filter(x => !(x.owner === uid && (key == null || x.key === key))); wrP(o); return { ok: true, n: n0 - o.plan.length }; },
      pushPlanned() { return rdP().plan.filter(x => x.owner === uid); },   // tests only
      onAuth(fn) { authSubs.push(fn); },
      onChange(fn) { subs.push(fn); },
    };
    const SKEY = KEY + '.saves', AKEY = KEY + '.auth', LKEY = KEY + '.lan', authSubs = [];
    const rdL = () => { try { const o = JSON.parse(localStorage.getItem(LKEY) || 'null'); if (o && Array.isArray(o.lan) && o.tot && o.pet) return o; } catch (e) {} return { seq: 0, lan: [], tot: {}, pet: {} }; };
    const wrL = o => { localStorage.setItem(LKEY, JSON.stringify(o)); if (bc) bc.postMessage(1); };
    const PKEY = KEY + '.push';
    const rdP = () => { try { const o = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (o && o.subs && Array.isArray(o.plan)) return o; } catch (e) {} return { subs: {}, plan: [] }; };
    const wrP = o => localStorage.setItem(PKEY, JSON.stringify(o));
    const rdS = () => { try { const o = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (o && o.saves) return o; } catch (e) {} return { saves: {} }; };
    const wrS = o => localStorage.setItem(SKEY, JSON.stringify(o));
    const rdA = () => { try { const o = JSON.parse(localStorage.getItem(AKEY) || 'null'); if (o && o.users && Array.isArray(o.mails)) return o; } catch (e) {} return { users: {}, mails: [] }; };
    const wrA = o => { o.mails = o.mails.filter(t => Date.now() - t < 3600000); localStorage.setItem(AKEY, JSON.stringify(o)); };
    const mailRate = o => o.mails.filter(t => Date.now() - t < 3600000).length >= (opt.mailsPerHour || 4);   // like Supabase's built-in sender: a few per hour
    const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
    const tok16 = () => { let s = ''; for (let i = 0; i < 16; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; };
    const linkOf = (kind, tok) => (typeof location !== 'undefined' ? location.origin + location.pathname + location.search : '') + '#mock_' + kind + '=' + tok;
    return api;
  }
  const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;

  // ================= supabase =================
  function loadScript(src) { return new Promise((res, rej) => { if (window.supabase && window.supabase.createClient) return res(); const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('could not load supabase-js')); document.head.appendChild(s); }); }
  const gid = n => 'g' + pad(n, 12);   // bigint id -> sortable string id (Social.applyGifts sorts by id)
  function Supa(opt, cfg) {
    let sb = null, uid = null, myId = null, landed = null;
    // 42501 = the database role lacks a GRANT (server/patch_1.sql): say so plainly instead of "permission denied for table x"
    const fail = (e, d) => ({ ok: false, why: e && e.code === '42501' && /^permission denied for/.test(e.message || '') ?'the island server is not set up yet (missing rights: server/patch_1.sql)' : (e && (e.message || e.hint)) || d || 'network' });
    const ready = async () => {
      if (sb) return sb;
      await loadScript(SB_URL);
      // keepalive: the last upload when the tab closes still arrives (browsers cap keepalive bodies at 64 KB, so only small ones)
      const kfetch = (u, o) => fetch(u, Object.assign({}, o, { keepalive: !!(o && typeof o.body === 'string' && o.body.length < 60000) }));
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'schiffy-elderglow.sb' + (opt.slot || ''), flowType: 'implicit' }, global: { fetch: kfetch } });
      return sb;
    };
    const api = {
      kind: 'supabase', get uid() { return uid; }, get landed() { return landed; },
      async signIn() {
        try {
          // an email link lands here as #access_token=...&type=magiclink|email_change|signup (implicit flow: works on ANY device,
          // unlike PKCE which needs the browser that asked). supabase-js reads it on createClient; we note what it was + tidy the URL
          const h = new URLSearchParams(location.hash.replace(/^#/, '')), lt = h.get('access_token') ? (h.get('type') || 'magiclink') : null;
          await ready(); let { data } = await sb.auth.getSession();
          if (lt || location.hash === '#' || /access_token|refresh_token/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
          if (lt) landed = { ok: !!(data && data.session), kind: /email_change|signup/.test(lt) ? 'confirm' : 'login' };
          if (!data || !data.session) { const r = await sb.auth.signInAnonymously(); if (r.error) return fail(r.error, 'sign-in'); data = r.data; }
          uid = data.session ? data.session.user.id : data.user.id; return { ok: true, uid, landed };
        } catch (e) { return fail(e); }
      },
      async profile() { const r = await sb.from('profiles').select('island_name, host_name').eq('id', uid).maybeSingle(); return r.data ? { island: r.data.island_name, host: r.data.host_name } : null; },
      async saveProfile(p) {
        const a = Soc().nameCheck(p.island, 'island'), b = Soc().nameCheck(p.host, 'host'); if (!a.ok) return { ok: false, why: 'Island name: ' + a.why }; if (!b.ok) return { ok: false, why: 'Pup name: ' + b.why };
        const r = await sb.from('profiles').upsert({ id: uid, island_name: a.v, host_name: b.v }); if (r.error) return fail(r.error);
        await sb.from('islands').update({ name: a.v, host: b.v }).eq('owner', uid);
        return { ok: true };
      },
      async publish({ snap, pub }) {
        if (!Soc().checkSnap(snap)) return { ok: false, why: 'snapshot too big or bad' };
        const r = await sb.from('islands').upsert({ owner: uid, name: snap.name, host: snap.host, level: snap.lv, color: snap.col, snap, snap_v: snap.v, is_public: pub !== false }, { onConflict: 'owner' }).select('id').single();
        if (r.error) return fail(r.error); myId = r.data.id; return { ok: true, id: myId };
      },
      async setPublic(pub) { const r = await sb.from('islands').update({ is_public: !!pub }).eq('owner', uid); return r.error ? fail(r.error) : { ok: true }; },
      async deleteIsland() { const r = await sb.from('islands').delete().eq('owner', uid).select('id'); if (r.error) return fail(r.error); myId = null; return r.data.length ? { ok: true, n: r.data.length } : { ok: false, why: 'not published yet' }; },
      async myIsland() { const r = await sb.from('islands').select('id, likes, is_public, updated_at').eq('owner', uid).maybeSingle(); if (!r.data) return null; myId = r.data.id; return { id: r.data.id, likes: r.data.likes, pub: r.data.is_public, updated: Date.parse(r.data.updated_at) }; },
      async browse({ sort, q, limit }) {
        const cols = 'id, owner, name, host, level, color, likes, updated_at', n = limit || 24;
        let r;
        if (sort === 'random') r = await sb.rpc('random_islands', { n });
        else {
          let qq = sb.from('islands').select(cols).eq('is_public', true);
          if (q) qq = qq.ilike('name', '%' + String(q).slice(0, 24).replace(/[\\%_]/g, c => '\\' + c) + '%');
          r = await qq.order(sort === 'liked' ? 'likes' : 'updated_at', { ascending: false }).limit(n);
        }
        if (r.error) return [];
        return r.data.map(i => ({ id: i.id, name: i.name, host: i.host, lv: i.level, likes: i.likes, col: i.color, updated: Date.parse(i.updated_at), mine: i.owner === uid, sample: false }));
      },
      async getIsland(id) { const r = await sb.from('islands').select('id, owner, name, host, level, color, likes, updated_at, snap').eq('id', id).maybeSingle(); const i = r.data; return i ? { id: i.id, name: i.name, host: i.host, lv: i.level, likes: i.likes, col: i.color, updated: Date.parse(i.updated_at), mine: i.owner === uid, snap: i.snap } : null; },
      async visit(id) { const r = await sb.from('visits').insert({ island_id: id }); return r.error ? fail(r.error) : { ok: true }; },
      async water(id) { const r = await sb.rpc('water_tree', { p_island: id }); if (r.error) return fail(r.error); return r.data && r.data.ok ? { ok: true, day: DAY(Date.now()) } : { ok: false, why: (r.data && r.data.why) || 'no' }; },
      async gift(id, g) { const r = await sb.from('gifts').insert({ island_id: id, kind: g.kind, item: g.item, n: g.kind === 'decor' ? 1 : Math.round(+g.n || 0) }); return r.error ? fail(r.error) : { ok: true }; },
      async like(id) { const r = await sb.from('likes').insert({ island_id: id }); if (r.error) return r.error.code === '23505' ? { ok: false, why: 'liked' } : fail(r.error); return { ok: true }; },
      async liked(id) { const r = await sb.from('likes').select('island_id').eq('island_id', id).eq('uid', uid).maybeSingle(); return !!r.data; },
      // ---- piece 5 "showing off" (server/patch_5.sql; a missing function = patch_5 not run yet -> { setup: true }: no stars, no shelf)
      async star(id) { const r = await sb.rpc('star_island', { p_island: id }); if (r.error) return failF(r.error); return r.data && r.data.ok ? { ok: true, stars: +r.data.stars || 0 } : { ok: false, why: (r.data && r.data.why) || 'no' }; },
      async starInfo(ids) {
        const A = (ids || []).filter(x => UUID_RE.test(String(x))).slice(0, 60); if (!A.length) return { ok: true, n: {}, mine: [] };
        const r = await sb.rpc('island_stars', { p_ids: A }); if (r.error) return failF(r.error); const d = r.data || {};
        const n = {}; for (const k in (d.n || {})) n[k] = +d.n[k] || 0; return { ok: true, n, mine: Array.isArray(d.mine) ? d.mine : [] };
      },
      async starNews(since) { const r = await sb.rpc('star_news', { p_since: new Date(since || 0).toISOString() }); if (r.error) return failF(r.error); const d = r.data || {}; return { ok: true, total: +d.total || 0, since: +d.since || 0 }; },
      async shelf() {
        const r = await sb.rpc('island_week'); if (r.error) return failF(r.error); const d = r.data || {};
        const cw = i => i && i.id ? { id: i.id, name: i.name, host: i.host, lv: i.level, likes: i.likes, col: i.color, updated: Date.parse(i.updated_at), created: Date.parse(i.created_at), stars: +i.stars || 0, week: +i.week || 0, new: !!i.new, mine: false, sample: false } : null;
        return { ok: true, cyc: d.cycle, week: cw(d.week), last: cw(d.last), featured: (Array.isArray(d.featured) ? d.featured : []).map(cw).filter(Boolean) };
      },
      async note(id, text) { const c = Soc().noteCheck(text); if (!c.ok) return { ok: false, why: c.why }; const r = await sb.from('guestbook').insert({ island_id: id, body: c.v }); return r.error ? fail(r.error) : { ok: true }; },
      async guestbook(id) { const r = await sb.from('guestbook').select('id, author, author_name, body, created_at').eq('island_id', id).eq('hidden', false).order('id', { ascending: false }).limit(30); return (r.data || []).map(n => ({ id: String(n.id), from: n.author_name, text: n.body, at: Date.parse(n.created_at), mine: n.author === uid })); },
      async report(kind, id, reason) { const r = await sb.from('reports').insert({ target_kind: kind, target_id: String(id), reason: String(reason || '').slice(0, 200) }); return r.error && r.error.code !== '23505' ? fail(r.error) : { ok: true }; },
      async inbox() {
        if (!myId) await api.myIsland(); if (!myId) return [];
        const r = await sb.from('gifts').select('id, kind, item, n, from_name, created_at').eq('island_id', myId).eq('claimed', false).order('id').limit(200);
        return (r.data || []).map(g => ({ id: gid(g.id), kind: g.kind, item: g.item, n: g.n, from: g.from_name, at: Date.parse(g.created_at) }));
      },
      async claim(ids) { const r = await sb.rpc('claim_gifts', { p_ids: ids.map(s => +String(s).slice(1)) }); return r.error ? fail(r.error) : { ok: true }; },
      async news(since) {
        if (!myId) await api.myIsland(); if (!myId) return { visits: [], notes: [], likes: 0, likesNew: 0 };
        const t = new Date(since || 0).toISOString();
        const [v, n, l, i] = await Promise.all([
          sb.from('visits').select('visitor_name, visitor_island, created_at').eq('island_id', myId).gt('created_at', t).order('id', { ascending: false }).limit(50),
          sb.from('guestbook').select('id, author_name, body, created_at').eq('island_id', myId).eq('hidden', false).gt('created_at', t).order('id', { ascending: false }).limit(20),
          sb.from('likes').select('uid', { count: 'exact', head: true }).eq('island_id', myId).gt('created_at', t),
          sb.from('islands').select('likes').eq('id', myId).maybeSingle()]);
        return { visits: (v.data || []).map(x => ({ from: x.visitor_name, island: x.visitor_island, at: Date.parse(x.created_at) })), notes: (n.data || []).map(x => ({ id: String(x.id), from: x.author_name, text: x.body, at: Date.parse(x.created_at) })),
          likes: i.data ? i.data.likes : 0, likesNew: l.count || 0 };
      },
      // ---- cloud save (server/patch_2.sql): compare-and-swap on rev; a missing table = patch_2 not run yet -> { setup: true }
      async cloudGet() {
        if (!uid) return { ok: false, why: 'not signed in' };
        const r = await sb.from('saves').select('state, save_v, gen, rev, device, saved_at').eq('owner', uid).maybeSingle();
        if (r.error) return failS(r.error);
        return { ok: true, row: r.data ? { state: r.data.state, save_v: r.data.save_v, gen: +r.data.gen, rev: r.data.rev, device: r.data.device, saved: Date.parse(r.data.saved_at) } : null };
      },
      async cloudPut(p) {
        if (!uid) return { ok: false, why: 'not signed in' };
        const row = { state: p.state, save_v: p.saveV, gen: p.gen, rev: p.rev, device: String(p.device || '').slice(0, 40) };
        const conflict = async () => { const g = await api.cloudGet(); return g.ok ? { ok: false, conflict: !!g.row, why: g.row ? 'changed' : 'gone', row: g.row } : g; };
        if (p.baseRev) {
          const r = await sb.from('saves').update(row).eq('owner', uid).eq('rev', p.baseRev).select('saved_at');
          if (r.error) return /stale save/.test(r.error.message || '') ? conflict() : failS(r.error);
          if (r.data && r.data.length) return { ok: true, saved: Date.parse(r.data[0].saved_at) };
          const c = await conflict(); if (c.conflict || !c.ok) return c;   // the rev moved on (another device) -> card; the row is gone -> insert
        }
        const r = await sb.from('saves').insert(row).select('saved_at').single();
        if (r.error) return r.error.code === '23505' ? conflict() : failS(r.error);
        return { ok: true, saved: Date.parse(r.data.saved_at) };
      },
      async cloudDelete() { const r = await sb.from('saves').delete().eq('owner', uid).select('owner'); return r.error ? failS(r.error) : { ok: r.data.length > 0 }; },
      // ---- email (Supabase Auth, passwordless). Codes: rate | badcode | exists | nouser | bademail | offline | setup | other
      async account() {
        const { data, error } = await sb.auth.getUser(); if (error) return authFail(error); const u = data && data.user; if (!u) return { ok: false, why: 'not signed in' };
        return { ok: true, uid: u.id, anon: !!u.is_anonymous || !u.email, email: u.email || null, pending: u.new_email || null };
      },
      // link the CURRENT (anonymous) user to an email: same user id, so the island, profile and likes stay. The email holds a
      // 6-digit code ({{ .Token }}, SETUP.md) -> verifyLink(), or a link back to the game (handled by supabase-js on load)
      async linkEmail(email) {
        const e = String(email || '').trim().toLowerCase(); if (!EMAIL_RE.test(e)) return { ok: false, code: 'bademail' };
        const r = await sb.auth.updateUser({ email: e }, { emailRedirectTo: redirect() }); return r.error ? authFail(r.error) : { ok: true, sent: true };
      },
      // linking an anonymous user is an "email change" in Supabase; 'email' is tried too in case the project sends it as a signup confirmation
      async verifyLink(email, code) {
        const e = String(email).trim().toLowerCase(), t = String(code).trim();
        let r = await sb.auth.verifyOtp({ email: e, token: t, type: 'email_change' });
        if (r.error && authFail(r.error).code === 'badcode') { const r2 = await sb.auth.verifyOtp({ email: e, token: t, type: 'email' }); if (!r2.error) r = r2; }
        if (r.error) return authFail(r.error);
        const id = r.data && r.data.user ? r.data.user.id : uid; if (id && uid && id !== uid) { uid = id; myId = null; }
        return { ok: true, uid: id };
      },
      // a NEW device: a code to an email that already has an island (never creates an account)
      async sendCode(email) {
        const e = String(email || '').trim().toLowerCase(); if (!EMAIL_RE.test(e)) return { ok: false, code: 'bademail' };
        const r = await sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false, emailRedirectTo: redirect() } }); return r.error ? authFail(r.error) : { ok: true, sent: true };
      },
      async verifyCode(email, code) {
        const r = await sb.auth.verifyOtp({ email: String(email).trim().toLowerCase(), token: String(code).trim(), type: 'email' }); if (r.error) return authFail(r.error);
        const id = r.data && r.data.user ? r.data.user.id : null; if (!id) return { ok: false, code: 'badcode' };
        uid = id; myId = null; return { ok: true, uid: id };
      },
      async signOut() { await sb.auth.signOut({ scope: 'local' }); uid = null; myId = null; return api.signIn(); },
      // ---- lantern notes + World Bloom (server/patch_3.sql; a missing function = patch_3 not run yet -> { setup: true })
      async lanternSend({ body, col }) {
        const c = Soc().noteCheck(body); if (!c.ok) return { ok: false, why: c.why };
        const r = await sb.rpc('send_lantern', { p_body: c.v, p_color: col }); if (r.error) return failL(r.error);
        return r.data && r.data.ok ? { ok: true, id: lid(r.data.id), left: r.data.left } : { ok: false, why: (r.data && r.data.why) || 'no', left: r.data && r.data.left };
      },
      async lanternInbox() { const r = await sb.rpc('lantern_inbox'); if (r.error) return failL(r.error); return (r.data || []).map(l => ({ id: lid(l.id), from: l.from, body: l.body, col: l.color, at: Date.parse(l.at), read: !!l.read, warm: !!l.warm })); },
      async lanternAct(id, act) { const r = await sb.rpc('lantern_act', { p_id: +String(id).slice(1), p_act: act }); if (r.error) return failL(r.error); return r.data && r.data.ok ? { ok: true } : { ok: false, why: (r.data && r.data.why) || 'no' }; },
      async lanternSent() { const r = await sb.rpc('my_lanterns'); if (r.error) return failL(r.error); return (r.data || []).map(l => ({ id: lid(l.id), at: Date.parse(l.at), found: !!l.found, warm: !!l.warm })); },
      async bloomStatus() { const r = await sb.rpc('bloom_status'); if (r.error) return failL(r.error); const d = r.data || {}; return { ok: true, cyc: d.cycle, total: +d.total || 0, prev: +d.prev || 0, today: +d.today || 0, mine: +d.mine || 0, cap: d.cap || 20 }; },
      async bloomAdd(n) { const r = await sb.rpc('bloom_add', { p_n: Math.max(0, Math.round(+n || 0)) }); if (r.error) return failL(r.error); const d = r.data || {}; return d.ok ? { ok: true, added: d.added, today: d.today, cap: d.cap, cyc: d.cycle, total: +d.total || 0 } : { ok: false, why: d.why || 'no' }; },
      // ---- gentle push notifications (server/patch_4.sql; a missing function = patch_4 not run yet -> { setup: true })
      async pushSubscribe(p) {
        if (!uid) return { ok: false, why: 'not signed in' };
        const r = await sb.rpc('push_subscribe', { p_endpoint: p.endpoint, p_p256dh: p.p256dh, p_auth: p.auth, p_prefs: p.prefs, p_quiet_from: p.qf, p_quiet_to: p.qt, p_tz: p.tz });
        if (r.error) return failP(r.error); return r.data && r.data.ok ? { ok: true, devices: r.data.devices } : { ok: false, why: (r.data && r.data.why) || 'no' };
      },
      async pushUnsubscribe(endpoint) { if (!uid) return { ok: false, why: 'not signed in' }; const r = await sb.rpc('push_unsubscribe', { p_endpoint: endpoint }); return r.error ? failP(r.error) : { ok: true, removed: r.data && r.data.removed }; },
      async pushPlan(key, due, n) { if (!uid) return { ok: false, why: 'not signed in' }; const r = await sb.rpc('push_plan', { p_key: String(key), p_due: new Date(due).toISOString(), p_n: n || 1 }); if (r.error) return failP(r.error); return r.data && r.data.ok ? { ok: true } : { ok: false, why: (r.data && r.data.why) || 'no' }; },
      async pushUnplan(key) { if (!uid) return { ok: false, why: 'not signed in' }; const r = await sb.rpc('push_unplan', { p_key: key == null ? null : String(key) }); return r.error ? failP(r.error) : { ok: true, n: r.data }; },
      onAuth(fn) {   // a magic link opened in this tab / another tab signed in: tell the game (deferred: no supabase calls inside the callback)
        ready().then(() => sb.auth.onAuthStateChange((ev, ses) => { const id = ses && ses.user ? ses.user.id : null; if (id && uid && id !== uid) { uid = id; myId = null; setTimeout(() => fn('switched', id), 0); } else if (ev === 'USER_UPDATED') setTimeout(() => fn('updated', id), 0); })).catch(() => {});
      },
      onChange() {},
    };
    // the page the email link returns to (Supabase -> Authentication -> URL Configuration must allow it: SETUP.md step 6)
    const redirect = () => location.origin + location.pathname + (opt.slot ? '?slot=' + encodeURIComponent(opt.slot) : '');
    const lid = n => 'l' + pad(n, 12);   // bigint lantern id -> sortable string id (Lanterns.merge sorts by id)
    // a missing RPC (PGRST202 / 42883) = server/patch_3.sql not run yet: the game keeps lanterns + the bloom quiet
    const failL = e => (e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || /could not find the function|function .* does not exist/i.test(e.message || ''))) ? { ok: false, setup: true, why: 'lanterns are not switched on on the server yet (server/patch_3.sql)' } : fail(e);
    const failP = e => (e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|function .* does not exist/i.test(e.message || ''))) ? { ok: false, setup: true, why: 'notifications are not switched on on the server yet (server/patch_4.sql)' } : fail(e);
    const failF = e => (e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.status === 404 || /could not find the function|function .* does not exist/i.test(e.message || ''))) ? { ok: false, setup: true, why: 'stars are not switched on on the server yet (server/patch_5.sql)' } : fail(e);
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const failS = e => (e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|relation .*saves.* does not exist/i.test(e.message || ''))) ? { ok: false, setup: true, why: 'cloud save is not switched on on the server yet (server/patch_2.sql)' } : fail(e);
    function authFail(e) {
      const c = (e && e.code) || '', m = String((e && e.message) || ''), st = e && e.status;
      let code = 'other';
      if (st === 429 || /rate_limit|rate limit|too many/i.test(c + ' ' + m)) code = 'rate';
      else if (/otp_expired|expired|invalid.*(token|otp)|token.*invalid/i.test(c + ' ' + m)) code = 'badcode';
      else if (/email_exists|already (been )?registered|already in use|identity_already_exists/i.test(c + ' ' + m)) code = 'exists';
      else if (/otp_disabled|signups? not allowed|user_not_found|not found/i.test(c + ' ' + m)) code = 'nouser';
      else if (/email_address_invalid|validation_failed|invalid.*email|unable to validate email/i.test(c + ' ' + m)) code = 'bademail';
      else if (/email_provider_disabled|email_address_not_authorized|provider.*disabled/i.test(c + ' ' + m)) code = 'setup';
      else if ((e && (e.name === 'AuthRetryableFetchError' || e.name === 'TypeError')) || st === 0 || /fetch|network|offline/i.test(m)) code = 'offline';
      return { ok: false, code, why: m || code };
    }
    // wrap: a network error never throws into the game
    const AUTH = ['account', 'linkEmail', 'verifyLink', 'sendCode', 'verifyCode', 'signOut'];
    for (const k of Object.keys(api)) if (typeof api[k] === 'function' && k !== 'onChange' && k !== 'onAuth') { const f = api[k]; api[k] = async (...a) => { try { if (!sb && k !== 'signIn') await ready(); return await f(...a); } catch (e) { return AUTH.includes(k) ? authFail(e) : fail(e); } }; }
    return api;
  }

  window.Net = {
    SB_URL,
    make(opt) {
      const cfg = window.NET_CONFIG || {};
      // ?mockdb=NAME always means the pretend server (tests never touch the live project by accident)
      return cfg.url && cfg.anonKey && !(opt && opt.mockdb) ? Supa(opt || {}, cfg) : Mock(opt || {});
    },
    Mock, Supa,
  };
})();
