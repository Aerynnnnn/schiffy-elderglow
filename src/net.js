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
//   inbox(), claim(ids), news(sinceMs), linkEmail(email) (stub), onChange(fn)
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
        o = { v: 1, seq: 0, users: {}, islands: {}, visits: [], gifts: [], likes: [], notes: [], reports: [] };
        for (const x of (opt.samples ? opt.samples() : [])) o.islands[x.id] = { id: x.id, owner: 'sample', name: x.name, host: x.host, snap: x.snap, lv: x.snap.lv, col: x.snap.col, pub: true, likes: x.likes, created: Date.now() - 86400000 * (3 + x.snap.lv), updated: Date.now() - 3600000 * (2 + x.snap.lv * 5) };
        write(o);
      }
      return o;
    }
    function write(o) { localStorage.setItem(KEY, JSON.stringify(o)); if (bc) bc.postMessage(1); }
    const nid = (o, p) => p + pad(++o.seq, 8);
    let uid = null;
    const me = o => o.users[uid] || null;
    const mine = o => Object.values(o.islands).find(i => i.owner === uid) || null;
    const today = () => DAY(Date.now());
    const pubIsland = (o, id) => { const i = o.islands[id]; return i && i.pub ? i : null; };
    const card = i => ({ id: i.id, name: i.name, host: i.host, lv: i.lv, likes: i.likes, col: i.col, updated: i.updated, mine: i.owner === uid, sample: i.owner === 'sample' });
    const canVisitorAct = (o, id) => { if (!uid) return 'not signed in'; if (!me(o)) return 'no profile'; const i = pubIsland(o, id); if (!i) return 'island not found'; if (i.owner === uid) return 'your own island'; return null; };
    const api = {
      kind: 'mock', get uid() { return uid; },
      async signIn() { try { uid = localStorage.getItem(UIDK); if (!uid) { uid = 'mock-' + Math.random().toString(36).slice(2, 12); localStorage.setItem(UIDK, uid); } db(); return { ok: true, uid }; } catch (e) { return { ok: false, why: 'storage' }; } },
      async profile() { const o = db(); const u = me(o); return u ? { island: u.island, host: u.host } : null; },
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
        delete o.islands[i.id]; for (const k of ['visits', 'gifts', 'likes', 'notes']) o[k] = o[k].filter(x => x.island !== i.id); write(o); return { ok: true, n: 1 };
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
        const hr = o.visits.filter(v => v.uid === uid && Date.now() - v.at < 3600000).length; if (hr >= Soc().C.VISITS_PER_HOUR) return { ok: false, why: 'rate' };
        o.visits.push({ id: nid(o, 'v'), island: id, uid, from: me(o).host, fromIsland: me(o).island, at: Date.now() }); write(o); return { ok: true };
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
        o.reports.push({ id: nid(o, 'r'), uid, kind, target: id, reason: String(reason || '').slice(0, 200), at: Date.now() });
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
      async linkEmail() { return { ok: false, stub: true, why: 'Linking an email comes later (the mock server has no email).' }; },
      onChange(fn) { subs.push(fn); },
    };
    return api;
  }

  // ================= supabase =================
  function loadScript(src) { return new Promise((res, rej) => { if (window.supabase && window.supabase.createClient) return res(); const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('could not load supabase-js')); document.head.appendChild(s); }); }
  const gid = n => 'g' + pad(n, 12);   // bigint id -> sortable string id (Social.applyGifts sorts by id)
  function Supa(opt, cfg) {
    let sb = null, uid = null, myId = null;
    // 42501 = the database role lacks a GRANT (server/patch_1.sql): say so plainly instead of "permission denied for table x"
    const fail = (e, d) => ({ ok: false, why: e && e.code === '42501' && /^permission denied for/.test(e.message || '') ?'the island server is not set up yet (missing rights: server/patch_1.sql)' : (e && (e.message || e.hint)) || d || 'network' });
    const ready = async () => {
      if (sb) return sb;
      await loadScript(SB_URL);
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'schiffy-elderglow.sb' + (opt.slot || '') } });
      return sb;
    };
    const api = {
      kind: 'supabase', get uid() { return uid; },
      async signIn() {
        try {
          await ready(); let { data } = await sb.auth.getSession();
          if (!data || !data.session) { const r = await sb.auth.signInAnonymously(); if (r.error) return fail(r.error, 'sign-in'); data = r.data; }
          uid = data.session ? data.session.user.id : data.user.id; return { ok: true, uid };
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
      // upgrade the anonymous account later (sb.auth.updateUser({ email }) sends a confirm link); a stub until email is set up in the project
      async linkEmail() { return { ok: false, stub: true, why: 'Linking an email comes in a later update.' }; },
      onChange() {},
    };
    // wrap: a network error never throws into the game
    for (const k of Object.keys(api)) if (typeof api[k] === 'function' && k !== 'onChange') { const f = api[k]; api[k] = async (...a) => { try { if (!sb && k !== 'signIn') await ready(); return await f(...a); } catch (e) { return fail(e); } }; }
    return api;
  }

  window.Net = {
    SB_URL,
    make(opt) {
      const cfg = window.NET_CONFIG || {};
      return cfg.url && cfg.anonKey ? Supa(opt || {}, cfg) : Mock(opt || {});
    },
    Mock, Supa,
  };
})();
