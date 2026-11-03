// Wardrobe (Round 3 update 1, save v12): earned outfits go on pups. Pure (no three.js); loaded after daily.js, sim_check loads it.
// One outfit per pup; the island owns one of each outfit (S.inv.outfits), so an outfit is worn by at most one pup.
// Pup field `fit` = outfit id or null. Cosmetic only: no sim number ever reads it.
(function () {
  'use strict';
  // every outfit in one place (Daily.OUTFITS / Exped.OUTFITS keep their id lists). slot = where the mesh hangs (src/pups.js);
  // look = the primitive recipe pups.js builds: kind + colours (sRGB hex) + glow (unlit, brighter at night)
  const DEFS = {
    'moon-scarf': { name: 'Moonlit scarf', slot: 'neck', from: 'gift', look: { kind: 'scarf', col: 0x3a4a9a, col2: 0xffe27a, glow: true } },
    'firefly-cape': { name: 'Firefly cape', slot: 'back', from: 'gift', look: { kind: 'cape', col: 0x3f6b4a, col2: 0xffe36a, glow: true } },
    'acorn-cap': { name: 'Acorn cap', slot: 'head', from: 'gift', look: { kind: 'acorn', col: 0x8a5a2e, col2: 0x5b3a1e } },
    'star-collar': { name: 'Star collar', slot: 'neck', from: 'gift', look: { kind: 'stars', col: 0xffd34d, col2: 0x6a4aa8, glow: true } },
    'leaf-hood': { name: 'Leaf hood', slot: 'head', from: 'gift', look: { kind: 'leaves', col: 0x6fbf5a, col2: 0x3f8a3a } },
    'sun-bandana': { name: 'Sunny bandana', slot: 'neck', from: 'gift', look: { kind: 'bandana', col: 0xff9a3c, col2: 0xffe08a } },
    'cloud-cape': { name: 'Cloud cape', slot: 'back', from: 'trip', look: { kind: 'cloud', col: 0xf4f7ff, col2: 0xb9d4ff } },
    'feather-cap': { name: 'Feather cap', slot: 'head', from: 'trip', look: { kind: 'beret', col: 0x4a7fd6, col2: 0xff6f91 } },
    'sky-goggles': { name: 'Sky goggles', slot: 'face', from: 'trip', look: { kind: 'goggles', col: 0xb8743a, col2: 0x9fe8ff } },
    // update 3: far-sky voyage finds (src/voyages.js) + Elder ring gifts (src/rings.js): the same recipes in their own colours
    'aurora-scarf': { name: 'Aurora scarf', slot: 'neck', from: 'voyage', look: { kind: 'scarf', col: 0x3fbfa8, col2: 0xd99bff, glow: true } },
    'keeper-cape': { name: "Lighthouse keeper's cape", slot: 'back', from: 'voyage', look: { kind: 'cape', col: 0xc8423a, col2: 0xfff2c4, glow: true } },
    'cloudwool-cape': { name: 'Cloudwool cape', slot: 'back', from: 'voyage', look: { kind: 'cloud', col: 0xe9ddff, col2: 0xa98be0 } },
    'sister-hood': { name: 'Sister-leaf hood', slot: 'head', from: 'voyage', look: { kind: 'leaves', col: 0xc9d6c2, col2: 0x9ff0c8, glow: true } },
    'star-sailor-hat': { name: 'Star-sailor hat', slot: 'head', from: 'voyage', look: { kind: 'beret', col: 0x26306a, col2: 0xffd84a } },
    'edgelight-collar': { name: 'Edge-light collar', slot: 'neck', from: 'voyage', look: { kind: 'stars', col: 0xbfe9ff, col2: 0x24305e, glow: true } },
    'bark-bandana': { name: 'Bark bandana', slot: 'neck', from: 'ring', look: { kind: 'bandana', col: 0x7a5232, col2: 0x8fd16a } },
    'ringlight-cap': { name: 'Ring-light cap', slot: 'head', from: 'ring', look: { kind: 'acorn', col: 0xd9a441, col2: 0xfff0a8, glow: true } },
    'blossom-hood': { name: 'Blossom hood', slot: 'head', from: 'ring', look: { kind: 'leaves', col: 0xffb3d1, col2: 0xfff4f8 } },
    'elder-cape': { name: 'Elder leaf cape', slot: 'back', from: 'ring', look: { kind: 'cape', col: 0x2f6b3c, col2: 0xffd86a, glow: true } },
  };
  const IDS = Object.keys(DEFS);
  const FROM = { gift: 'a gift-basket outfit', trip: 'a rare skyboat find', voyage: 'a far-sky voyage find', ring: 'an Elder ring gift' };

  const owns = (s, id) => !!DEFS[id] && s.inv.outfits.includes(id);
  const wearer = (s, id) => s.pups.findIndex(p => p.fit === id);
  // put outfit id on pup i; whoever wore it takes it off. -> {ok, from (pup index that took it off, -1 = none), why}
  function wear(s, i, id) {
    const p = s.pups[i];
    if (!p) return { ok: false, why: 'pup' };
    if (!DEFS[id]) return { ok: false, why: 'unknown' };
    if (!owns(s, id)) return { ok: false, why: 'unowned' };
    if (p.fit === id) return { ok: true, from: -1 };
    const w = wearer(s, id); if (w >= 0) s.pups[w].fit = null;
    p.fit = id; return { ok: true, from: w };
  }
  function off(s, i) { const p = s.pups[i]; if (!p || !p.fit) return false; p.fit = null; return true; }
  // after Sim.sanitize built the pups (p.fit from the save, v12): only owned, known ids; the first pup wearing each keeps it
  function sanitize(s) {
    const seen = new Set();
    for (const p of s.pups) {
      if (typeof p.fit !== 'string' || !owns(s, p.fit) || seen.has(p.fit)) { p.fit = null; continue; }
      seen.add(p.fit);
    }
  }
  // a visit: snapshot pup rows carry an 8th entry (outfit id or 0); unknown ids dropped, one pup per outfit
  function unsnap(st, rows) {
    const seen = new Set();
    st.pups.forEach((p, i) => { const a = rows[i], id = Array.isArray(a) ? a[7] : null; p.fit = typeof id === 'string' && DEFS[id] && !seen.has(id) ? (seen.add(id), id) : null; });
  }
  const name = id => (DEFS[id] || {}).name || id;
  const where = id => FROM[(DEFS[id] || {}).from] || 'an outfit';
  window.Wardrobe = { DEFS, IDS, FROM, owns, wearer, wear, off, sanitize, unsnap, name, where };
})();
