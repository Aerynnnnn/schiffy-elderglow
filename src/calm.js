// Calm view (vibe pass 1): the HUD gets out of the way so the island can breathe.
//  - the side panel (tree stats + pup roster) folds to a small pill after a few idle seconds (PC: header row; phone: the
//    header row of the bottom sheet). Tap the pill = open again. The pin keeps it open; that choice is a UI pref in
//    localStorage['schiffy-elderglow.ui'] (NOT the save), so it survives reloads and never touches the island.
//  - after ~9 s with no input at all the whole HUD fades to a minimal state (body.calm: only a faint pill is left); any
//    tap / mouse move / wheel / key brings it back at once. The first tap that wakes it does not also act on the world.
//  - never while something is in use: open cards, the plot / build menu, a selected or followed pup, a text field,
//    the tree's words (game.js passes busy()).
(function () {
  'use strict';
  const KEY = 'schiffy-elderglow.ui';
  const readP = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const writeP = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };
  function Calm(o) {   // o = { side, busy: () => bool, phone: () => bool, fadeMs, foldMs }
    const side = o.side, P = readP(), FADE = o.fadeMs || 9000, FOLD = o.foldMs || 4500;
    let lastIn = performance.now(), lastSide = performance.now(), faded = false, wokeAt = -1e9, hover = false;
    const pinned = () => P.roster === 'open';
    const api = {
      get faded() { return faded; }, get pinned() { return pinned(); }, get folded() { return side.classList.contains('min'); },
      // a tap that woke the HUD from the calm state (pointerdown time t) = only a wake-up, the world ignores it
      woke: t => t - wokeAt < 400,
      setPin(v) { P.roster = v ? 'open' : 'auto'; writeP(P); sync(); if (v) fold(false); },
      fold, wake,
    };
    function sync() { side.classList.toggle('pinned', pinned()); const b = side.querySelector('#sidePin'); if (b) { b.classList.toggle('on', pinned()); b.title = pinned() ? 'Pinned open: tap to let it fold away when idle' : 'Keep this panel open'; } }
    function fold(v) {
      if (side.classList.contains('min') === v) return;
      side.classList.toggle('min', v);
      if (!v) lastSide = performance.now();
      if (o.onFold) o.onFold(v);
    }
    function wake(e) {
      lastIn = performance.now();
      if (faded) { faded = false; if (e && (e.type === 'pointerdown' || e.type === 'touchstart')) wokeAt = lastIn; document.body.classList.remove('calm'); }
    }
    for (const t of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(t, wake, { capture: true, passive: true });
    side.addEventListener('pointerenter', () => { hover = true; lastSide = performance.now(); });
    side.addEventListener('pointerleave', () => { hover = false; lastSide = performance.now(); });
    for (const t of ['pointerdown', 'wheel', 'touchstart', 'input', 'change']) side.addEventListener(t, () => { lastSide = performance.now(); }, { passive: true });
    side.addEventListener('scroll', () => { lastSide = performance.now(); }, { capture: true, passive: true });
    // the folded pill opens on a tap (anywhere on it); the header's fold button closes it again
    side.addEventListener('click', e => {
      if (e.target.closest('#sidePin')) { api.setPin(!pinned()); e.stopPropagation(); return; }
      if (e.target.closest('#sideFold')) { if (pinned()) { P.roster = 'auto'; writeP(P); sync(); } fold(true); e.stopPropagation(); return; }
      if (side.classList.contains('min') && !e.target.closest('#sheetBtn')) { fold(false); e.stopPropagation(); }
    }, true);
    if (o.phone && o.phone() && pinned()) side.classList.add('open');   // phone: the sheet comes back as the player left it
    sync();
    setInterval(() => {
      const now = performance.now(), busy = o.busy();
      if (busy) { lastIn = now; lastSide = Math.max(lastSide, now - FOLD + 2500); }   // in use: never calm; the countdowns restart after
      if (!faded && !busy && now - lastIn > FADE) { faded = true; document.body.classList.add('calm'); }
      if (faded && busy) { faded = false; document.body.classList.remove('calm'); }
      // fold the panel when nobody touched it for a while (not pinned, not hovered, not in use, and not the phone's open sheet)
      const sheetOpen = side.classList.contains('open');
      if (!pinned() && !hover && !busy && !sheetOpen && now - lastSide > FOLD) fold(true);
    }, 250);
    return api;
  }
  window.ElderCalm = { make: Calm, KEY, read: readP };
})();
