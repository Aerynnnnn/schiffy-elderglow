// Cloud (step 7): cloud save. Pure helpers (decide / summary / stamp / backups, unit-tested in tools/sim_check.mjs) + the
// sync engine (Cloud.Sync) that talks to the backend only through Net (src/net.js: cloudGet / cloudPut).
// The local save wrapper (localStorage SAVE_KEY) = { savedAt, state, sync }, sync = {
//   gen:  this island's save counter: +1 on a save after real play (foreground ticks) or a touch() (gifts merged ...),
//         never on a save that only re-wrote the same state or a pure offline catch-up (any device replays that from saved_at)
//   base: the gen of the cloud copy this device last matched (uploaded or downloaded); gen > base = changed here since
//   rev:  the id of that cloud copy (uploads go only over it: compare-and-swap, server/patch_2.sql)
//   uid:  the account it was matched with (another account / never synced = unbound) }
// The cloud row = { state, save_v, gen, rev, device, saved_at (server clock) }. Nothing is ever thrown away silently:
// whichever copy loses a choice goes to the local backup list (SAVE_KEY + '.backup', newest first, 3 kept).
(function () {
  'use strict';
  const C = { EVERY: 60, SOON: 5, MIN_GAP: 3, RETRY: [10, 20, 40, 80, 160, 300], MAX_BYTES: 500000, BACKUPS: 3, BOOT_WAIT: 6000 };
  const fresh = () => ({ gen: 0, base: -1, rev: null, uid: null });
  const REV_RE = /^[A-Za-z0-9]{6,32}$/;
  function meta(x) {   // sanitize a stored sync record
    const m = fresh(); if (!x || typeof x !== 'object') return m;
    const int = (v, d, lo) => Number.isInteger(v) && v >= lo && v <= 1e12 ? v : d;
    m.gen = int(x.gen, 0, 0); m.base = Math.min(int(x.base, -1, -1), m.gen);
    m.rev = typeof x.rev === 'string' && REV_RE.test(x.rev) ? x.rev : null;
    m.uid = typeof x.uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.uid) ? x.uid : null;
    if (!m.rev) m.base = -1;
    return m;
  }
  // local = { sync, state, savedAt } | null (no island on this device), cloud = { gen, rev, ... } | null, uid = signed-in account
  //  -> 'none' | 'same' | 'upload' (this device is newer) | 'cloud' (the cloud is newer: load it) | 'conflict' (both changed: ask)
  function decide(local, cloud, uid) {
    if (!cloud) return local ? 'upload' : 'none';
    if (!local) return 'cloud';
    const s = meta(local.sync), bound = !!s.rev && s.uid === uid, dirty = s.gen > s.base;
    if (bound && cloud.rev === s.rev) return dirty ? 'upload' : 'same';
    // the cloud moved on since this device last matched it: newer = by the save counter (only goes up on the server),
    // not the wall clock; a cloud copy whose counter is not past ours (deleted + re-made from an older copy) is never trusted blindly
    if (bound && !dirty && cloud.gen > s.base) return 'cloud';
    return 'conflict';
  }
  const stageOf = lv => (window.Growth && window.Growth.stageName) ? window.Growth.stageName(lv) : '';
  // a short, safe summary of a save for the choice card (reads raw fields defensively: the state may be from any version)
  function summary(st, savedAt, now) {
    st = st && typeof st === 'object' ? st : {};
    const n = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
    const lv = Math.max(1, Math.min(8, Math.round(n(st.level, 1))));
    const plots = st.plots && typeof st.plots === 'object' ? Object.values(st.plots) : [];
    const so = st.social && typeof st.social === 'object' ? st.social : {};
    return { lv, stage: stageOf(lv), xp: n(st.xp, 0), pups: Array.isArray(st.pups) ? st.pups.length : 0, built: plots.filter(p => p && p.done === true).length,
      island: typeof so.island === 'string' && /^[A-Za-z0-9 '.!-]{1,24}$/.test(so.island) ? so.island : '', time: n(st.time, 0),
      savedAt: n(savedAt, 0), ago: Math.max(0, (n(now, 0) - n(savedAt, 0)) / 1000) };
  }
  // which copy is further along (for the "further along" badge only; the player always chooses)
  const further = (a, b) => (a.lv - b.lv) || (a.xp - b.xp) || (a.time - b.time) || (a.savedAt - b.savedAt);
  function stamp(sync, played) { if (played) sync.gen++; return sync; }
  function pushBackup(list, entry, keep) {
    const L = Array.isArray(list) ? list.filter(e => e && e.w && e.w.state) : [];
    L.unshift(entry); return L.slice(0, keep || C.BACKUPS);
  }
  const agoText = s => s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago';
  function device(ua, coarse) {
    ua = String(ua || '');
    const kind = /iPad|Tablet/i.test(ua) ? 'Tablet' : (/Mobi|iPhone|Android/i.test(ua) || coarse) ? 'Phone' : 'PC';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
    return kind + ' · ' + br;
  }
  const newRev = () => { let s = ''; const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * 36)]; return s; };

  // ================= the sync engine (browser) =================
  // o = { net, key (SAVE_KEY), storage (localStorage), save() -> writes the local wrapper now, device, on: { conflict(info), loaded(info), status() } }
  function Sync(o) {
    const st = o.storage, KEY = o.key, BK = KEY + '.backup';
    let sync = fresh(), uid = null, played = false, touched = false, busy = false, lastUp = 0, soonAt = 0, fails = 0, retryAt = 0;
    let off = false, offWhy = '', conflict = null, lastOk = 0, lastErr = '', handledUid = null, bootLate = false;
    const now = () => Date.now();
    const readW = () => { try { const w = JSON.parse(st.getItem(KEY) || 'null'); return w && typeof w === 'object' && w.state ? w : null; } catch (e) { return null; } };
    const writeW = w => { try { st.setItem(KEY, JSON.stringify(w)); return true; } catch (e) { return false; } };
    const backups = () => { try { const a = JSON.parse(st.getItem(BK) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    function backup(w, why, from) {
      if (!w || !w.state) return;
      try { st.setItem(BK, JSON.stringify(pushBackup(backups(), { at: now(), why, from: from || '', w }))); }
      catch (e) { try { st.setItem(BK, JSON.stringify([{ at: now(), why, from: from || '', w }])); } catch (e2) {} }   // storage full: keep at least this one
    }
    const status = () => { try { o.on.status && o.on.status(); } catch (e) {} };
    const local = () => { const w = readW(); return w ? { sync: meta(w.sync), state: w.state, savedAt: +w.savedAt || 0, w } : null; };
    const cloudWrap = row => ({ savedAt: row.saved, state: row.state, sync: { gen: row.gen, base: row.gen, rev: row.rev, uid } });
    function info(kind, row, L) {
      const t = now(), a = summary(L ? L.state : null, L ? L.savedAt : 0, t), b = summary(row.state, row.saved, t);
      return { kind, local: a, cloud: b, device: row.device || '', rec: further(a, b) >= 0 ? 'local' : 'cloud', row };
    }
    // put the cloud copy in place of the local one (the caller reloads / loads); the local copy goes to the backups if it had anything unsynced
    function takeCloud(row, why) {
      const L = local();
      if (L && (decide(L, row, uid) !== 'cloud')) backup(L.w, why || 'replaced by the cloud copy', 'this device');
      sync = meta({ gen: row.gen, base: row.gen, rev: row.rev, uid });
      return writeW(cloudWrap(row));
    }
    async function fetchRow() { const r = await o.net.cloudGet(); if (r && r.ok) return { ok: true, row: r.row ? Object.assign({}, r.row, { gen: +r.row.gen }) : null }; return r || { ok: false, why: 'network' }; }
    function disable(r) { off = true; offWhy = r.why || 'cloud save is off'; status(); }
    async function check(when) {   // compare with the cloud; returns the decision (and acts on 'upload' / shows the card on 'conflict')
      if (off || !uid) return null;
      const r = await fetchRow();
      if (!r.ok) { if (r.setup) disable(r); lastErr = r.why || 'network'; status(); return null; }
      const L = local(), d = decide(L, r.row, uid);
      if (d === 'same') { lastOk = r.row ? r.row.saved : lastOk; }
      else if (d === 'upload') soonAt = now();
      else if (d === 'cloud' || d === 'conflict') {
        if (when === 'boot' && d === 'cloud' && !bootLate) { takeCloud(r.row); return { d, loaded: true, from: r.row.device, saved: r.row.saved }; }
        const other = L && L.sync.uid && L.sync.uid !== uid;   // this island belongs to another account (signed in by code / magic link)
        conflict = info(when === 'login' || other ? 'login' : d === 'cloud' ? 'newer' : 'both', r.row, L); status(); o.on.conflict && o.on.conflict(conflict);
      }
      status(); return { d };
    }
    async function upload(why) {
      if (off || busy || conflict || !uid) return null;
      busy = true;
      try {
        o.save();   // capture right now: the server stamps saved_at at upload time
        const w = readW(); if (!w) return null;
        const gen = sync.gen, body = JSON.stringify(w.state);
        if (body.length > C.MAX_BYTES) { disable({ why: 'the island is too big for the cloud (' + Math.round(body.length / 1024) + ' KB)' }); return null; }
        const rev = newRev(), baseRev = sync.uid === uid ? sync.rev : null;
        const r = await o.net.cloudPut({ state: w.state, saveV: +w.state.v || 1, gen: Math.max(gen, 0), rev, baseRev, device: o.device });
        lastUp = now();
        if (r && r.ok) {
          sync.base = gen; sync.rev = rev; sync.uid = uid; fails = 0; retryAt = 0; lastOk = r.saved || now(); lastErr = '';
          const w2 = readW(); if (w2) { w2.sync = sync; writeW(w2); }
          status(); return true;
        }
        if (r && r.conflict) {
          if (r.row) { conflict = info('both', Object.assign({}, r.row, { gen: +r.row.gen }), local()); status(); o.on.conflict && o.on.conflict(conflict); }
          return false;
        }
        if (r && r.setup) { disable(r); return false; }
        fails++; retryAt = now() + C.RETRY[Math.min(fails, C.RETRY.length) - 1] * 1000; lastErr = (r && r.why) || 'network'; status();
        return false;
      } finally { busy = false; }
    }
    const api = {
      C,
      get sync() { return sync; }, get uid() { return uid; }, get off() { return off; }, get offWhy() { return offWhy; }, get conflict() { return conflict; },
      get lastOk() { return lastOk; }, get lastErr() { return lastErr; }, get dirty() { return sync.gen > sync.base; }, get busy() { return busy; },
      setMeta(x) { sync = meta(x); },
      stamp() { const p = played || touched; played = touched = false; return stamp(sync, p); },   // the game's save() embeds this
      played() { played = true; }, touch() { touched = true; soonAt = now() + C.SOON * 1000; },
      soon() { soonAt = Math.min(soonAt || Infinity, now() + C.SOON * 1000); retryAt = 0; },
      backups, local,
      // before the game loads its save: sign in, fetch, and if the cloud is newer, put it in place (the normal load +
      // migrate + sanitize + offline catch-up then run on it). Never waits longer than BOOT_WAIT.
      async boot() {
        const go = (async () => {
          const s = await o.net.signIn(); if (!s || !s.ok) { lastErr = (s && s.why) || 'offline'; return { d: null, offline: true }; }
          uid = s.uid; handledUid = uid;
          const L = local(); if (L) sync = L.sync;
          return (await check('boot')) || { d: null };
        })();
        let t; const late = new Promise(res => { t = setTimeout(() => res({ d: null, late: true }), C.BOOT_WAIT); });
        const r = await Promise.race([go, late]); clearTimeout(t);
        if (r.late) bootLate = true;   // too slow: the game started on its local copy; a newer cloud copy found later = the choice card, never a silent swap
        return r;
      },
      // every few seconds from the game loop
      tick() {
        if (off || conflict || busy || !uid) return;
        const t = now();
        if (retryAt && t < retryAt) return;
        if (api.dirty && (t - lastUp >= C.EVERY * 1000 || (soonAt && t >= soonAt && t - lastUp >= C.MIN_GAP * 1000) || retryAt)) { soonAt = 0; upload('tick'); }
      },
      flush(why) { if (!off && !conflict && uid && (api.dirty || played || touched)) return upload(why || 'flush'); return Promise.resolve(null); },
      check,
      // the player picked one copy on the choice card
      async resolve(pick) {
        const c = conflict; if (!c) return null;
        if (pick === 'cloud') { takeCloud(c.row, 'you picked the cloud copy'); conflict = null; return 'reload'; }
        backup(cloudWrap(c.row), 'you kept this device\'s island', c.device || 'cloud');
        sync.uid = uid; sync.rev = c.row.rev; sync.gen = Math.max(sync.gen, c.row.gen) + 1; sync.base = c.row.gen;
        conflict = null; touched = true; const r = await upload('resolve'); status(); return r ? 'kept' : 'queued';
      },
      later() { conflict = null; status(); },   // "decide later": no uploads until the next check (on the next start / tab return)
      // the signed-in account changed (email code / magic link / sign-out): compare again (card if both have progress)
      async accountChanged(id) {
        if (!id || id === handledUid) return null; handledUid = id; uid = id; conflict = null; fails = 0; retryAt = 0;
        const L = local(); if (L) sync = L.sync;
        return check('login');
      },
      restore(i) {   // a backup back in place: the current island goes to the backups, the restored one counts as changed here
        const L = backups(), e = L[i]; if (!e) return false;
        const cur = local(); L.splice(i, 1); try { st.setItem(BK, JSON.stringify(L)); } catch (x) {}
        if (cur) backup(cur.w, 'swapped for a backup', 'this device');
        const w = Object.assign({}, e.w, { savedAt: now(), sync: Object.assign(meta(cur ? cur.sync : null), { gen: (cur ? meta(cur.sync).gen : 0) + 1 }) });
        return writeW(w);
      },
      async signOut() {   // the cloud copy stays; this device starts a fresh anonymous island (the old one is kept as a backup too)
        if (api.dirty) await upload('sign-out');
        const L = local(); if (L) backup(L.w, 'signed out', 'this device');
        try { st.removeItem(KEY); } catch (e) {}
        sync = fresh(); conflict = null;
        const r = await o.net.signOut(); handledUid = uid = r && r.uid ? r.uid : null; return r;
      },
    };
    return api;
  }

  window.Cloud = { C, meta, fresh, decide, summary, further, stamp, pushBackup, device, agoText, newRev, Sync };
})();
