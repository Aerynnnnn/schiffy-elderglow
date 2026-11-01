// Schiffy Elderglow - sound (Round 2 step 1): soft lo-fi music + nature ASMR + cozy UI sounds. ALL procedural WebAudio,
// no audio files. Every instrument note, bird phrase, cricket bed, rain loop and click is synthesised ONCE (plain JS DSP into
// Float32Arrays at SR) the first time sound is turned on, then played as AudioBuffers: runtime work = a look-ahead note
// scheduler on a 120 ms timer + a few parameter ramps 4x a second from the game (update). Nothing touches the sim.
//   Music: one sequencer (16th grid, swing), 8-bar sections composed on the fly from a seeded RNG: lo-fi chord progressions,
//   a motif-based melody, Rhodes comping, upright-ish bass, brushed drums (DAY layer) and felt-piano arpeggios + a soft pad +
//   sparse high notes (NIGHT layer); both play the same chords, their gains follow the island clock (crossfade). Season =
//   key / tempo / filter / lead voice (spring felt piano + glock, summer fuller, autumn warm Rhodes, winter celesta bells,
//   brushes only). Rest sections (vinyl + nature only) every few minutes so it never feels like a loop.
//   Ambience: birds by day (14 synthesised phrases, random timing / pan / pitch, dawn chorus), crickets + firefly tinkles at
//   night, wind in the leaves, river (camera near water), rain (shower events), winter hush, tree hum (near the tree), soft
//   hammering (builders near the camera), the stage's kalimba (performers, panned to where they play, ducks the music).
//   SFX: tap / open / close / assign / pour / lantern / tok / built / whoosh / pop / gift / yip / water / like / note / notify
//   / shimmer + stings (level, haul, gift, arrive) played in the music's current key.
// Settings: localStorage 'schiffy-elderglow.sound' (NOT the game save), starts MUTED; ElderSound.ui() = the button, panel and
// the gentle "turn on sound?" chip. ?mute=1 / window.__ELDER_SILENT = silent test mode (output gain 0, no output device when
// the browser allows it, own prefs key): levels are read with the analyser (engine.level()). ElderSound.render() renders
// into an OfflineAudioContext for checks (tools/sound_check.js).
(function () {
  'use strict';
  const SR = 24000;   // synthesis rate: the music is low-passed anyway (lo-fi), half the memory of 48 k
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ======================================================================= DSP helpers (plain JS, run once)
  const arr = sec => new Float32Array(Math.max(1, Math.round(sec * SR)));
  function norm(a, peak) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } if (m > 0) { const k = peak / m; for (let i = 0; i < a.length; i++) a[i] *= k; } return a; }
  function fadeOut(a, sec) { const n = Math.min(a.length, Math.round(sec * SR)); for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n; return a; }
  function fadeIn(a, sec) { const n = Math.min(a.length, Math.round(sec * SR)); for (let i = 0; i < n; i++) a[i] *= i / n; return a; }
  function mix(dst, src, at, g) { const o = Math.round(at * SR); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g; return dst; }
  // seamless loop: render N + F samples, cross-fade the tail into the head (equal power), return N
  function loopify(a, F) { const N = a.length - F, o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = a[i]; for (let i = 0; i < F; i++) { const u = i / F; o[i] = a[i] * Math.sqrt(u) + a[N + i] * Math.sqrt(1 - u); } return o; }
  // RBJ biquad (lp / hp / bp), retunable for sweeps
  function Biquad(type, f, Q) {
    let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const tune = (fr, q) => {
      const w = TAU * clamp(fr, 20, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * (q || 0.707)), a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = al; b1 = 0; b2 = -al; }
      b0 /= a0; b1 /= a0; b2 /= a0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
    };
    tune(f, Q);
    const fn = x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
    fn.tune = tune; return fn;
  }
  function pinkGen(r) { let b0 = 0, b1 = 0, b2 = 0; return () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.2; }; }
  // additive voice with rotating phasors (cheap: no Math.sin per sample). P = [{r: ratio, a: amp, tau: decay s}]
  function additive(f, P, T, att, r) {
    const a = arr(T), n = a.length;
    for (const p of P) {
      const fr = f * p.r; if (fr >= SR * 0.45) continue;
      const w = TAU * fr / SR, c = Math.cos(w), s = Math.sin(w), ph = r ? r() * TAU : 0;
      let x = Math.cos(ph), y = Math.sin(ph), e = p.a; const d = Math.exp(-1 / (p.tau * SR));
      for (let i = 0; i < n; i++) { a[i] += y * e; const nx = x * c - y * s; y = x * s + y * c; x = nx; e *= d; }
    }
    const an = Math.max(1, Math.round(att * SR)); for (let i = 0; i < an && i < n; i++) a[i] *= i / an;
    return fadeOut(a, 0.06);
  }

  // ======================================================================= instruments
  function rhodes(f) {   // FM electric piano: index decays (bright bark -> mellow), tiny tine ping, soft saturation
    const T = 3.0, a = arr(T), w = TAU * f / SR, tau = 1.5 * Math.pow(220 / f, 0.35), ping = f * 7.1 < SR * 0.42;
    for (let i = 0; i < a.length; i++) {
      const t = i / SR, I = 1.3 * Math.exp(-t / 0.2) + 0.16;
      let s = Math.sin(w * i + Math.sin(w * i) * I) + 0.16 * Math.sin(2 * w * i) * Math.exp(-t / 0.5);
      if (ping) s += 0.05 * Math.sin(w * 7.1 * i) * Math.exp(-t / 0.025);
      const env = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / tau);
      a[i] = Math.tanh(1.2 * s * env) / Math.tanh(1.2);
    }
    return norm(fadeOut(a, 0.08), 0.5);
  }
  function feltPiano(f, r) {   // inharmonic partials, felt-damped highs, two strings (slow beat), soft hammer thump
    const P = [], B = 0.00035;
    for (let n = 1; n <= 12; n++) {
      const rr = n * Math.sqrt(1 + B * n * n), lp = 1 / (1 + Math.pow(n * f / (1.6 * f + 450), 2));
      const tau = 2.6 * Math.pow(261 / f, 0.4) / (1 + 0.5 * (n - 1));
      P.push({ r: rr * 1.0004, a: Math.pow(n, -1.4) * lp, tau }, { r: rr * 0.9996, a: Math.pow(n, -1.4) * lp * 0.8, tau: tau * 1.1 });
    }
    const a = additive(f, P, 3.4, 0.005, r), lpf = Biquad('lp', 300, 0.7), nz = rng(Math.round(f));
    for (let i = 0; i < SR * 0.03; i++) a[i] += lpf(nz() * 2 - 1) * 0.25 * Math.exp(-i / (SR * 0.008));
    return norm(a, 0.5);
  }
  const celesta = (f, r) => norm(additive(f, [{ r: 1, a: 1, tau: 1.3 * Math.pow(523 / f, 0.3) }, { r: 2, a: 0.16, tau: 0.5 }, { r: 4, a: 0.1, tau: 0.18 }, { r: 5.43, a: 0.04, tau: 0.1 }], 2.8, 0.0015, r), 0.5);
  function kalimba(f, r) {
    const a = additive(f, [{ r: 1, a: 1, tau: 0.75 }, { r: 5.95, a: 0.2, tau: 0.05 }, { r: 2, a: 0.05, tau: 0.25 }], 1.8, 0.001, r);
    const bp = Biquad('bp', 2500, 1.2), nz = rng(Math.round(f) + 7);
    for (let i = 0; i < SR * 0.006; i++) a[i] += bp(nz() * 2 - 1) * 0.3 * (1 - i / (SR * 0.006));
    return norm(a, 0.5);
  }
  function bass(f) {
    const a = additive(f, [{ r: 1, a: 1, tau: 0.9 }, { r: 2, a: 0.32, tau: 0.45 }, { r: 3, a: 0.1, tau: 0.25 }, { r: 4, a: 0.04, tau: 0.15 }], 2.2, 0.008, null);
    for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * 1.4);
    return norm(a, 0.5);
  }
  // drums (soft, lo-fi)
  function kick() { const a = arr(0.45); let ph = 0; for (let i = 0; i < a.length; i++) { const t = i / SR, f = 46 + 70 * Math.exp(-t / 0.035); ph += TAU * f / SR; a[i] = Math.sin(ph) * Math.exp(-t / 0.16) * (1 - Math.exp(-t / 0.002)); } return norm(fadeOut(a, 0.05), 0.55); }
  function brush(seed) { const a = arr(0.32), r = rng(seed), bp = Biquad('bp', 2600, 0.7), lp = Biquad('lp', 5000, 0.7); for (let i = 0; i < a.length; i++) { const t = i / SR; a[i] = lp(bp(r() * 2 - 1)) * (1 - Math.exp(-t / 0.007)) * Math.exp(-t / 0.085) + 0.25 * Math.sin(TAU * 185 * t) * Math.exp(-t / 0.03); } return norm(fadeOut(a, 0.05), 0.4); }
  function shaker(seed) { const a = arr(0.1), r = rng(seed), hp = Biquad('hp', 5200, 0.7), lp = Biquad('lp', 9000, 0.7); for (let i = 0; i < a.length; i++) { const t = i / SR; a[i] = lp(hp(r() * 2 - 1)) * (1 - Math.exp(-t / 0.009)) * Math.exp(-t / 0.024); } return norm(fadeOut(a, 0.02), 0.3); }

  // ======================================================================= ambience beds (seamless loops)
  function vinyl(sec, seed) {   // very quiet hiss + sparse crackles (event-based, wrapped = seamless)
    const r = rng(seed), N = Math.round(sec * SR), a = new Float32Array(N), pk = pinkGen(r), lp = Biquad('lp', 3500, 0.7), F = Math.round(0.3 * SR), b = new Float32Array(N + F);
    for (let i = 0; i < N + F; i++) b[i] = lp(pk()) * 0.05;
    const h = loopify(b, F); for (let i = 0; i < N; i++) a[i] = h[i];
    const bp = Biquad('bp', 3000, 1.5); const cr = Math.round(sec * 5);
    for (let k = 0; k < cr; k++) { const at = Math.floor(r() * N), amp = Math.pow(r(), 3) * 0.9 * (r() < 0.5 ? 1 : -1), L = 30 + Math.floor(r() * 50); for (let i = 0; i < L; i++) a[(at + i) % N] += bp(i === 0 ? amp : (r() * 2 - 1) * amp * 0.3) * Math.exp(-i / 8); }
    return a;
  }
  function wind(sec, seed) {   // low whoosh + leaf rustle, both swelling with gusts (gust sines fit the loop exactly)
    const r = rng(seed), N = Math.round(sec * SR), a = new Float32Array(N), pk = pinkGen(r), lp = Biquad('lp', 520, 0.6), hp = Biquad('hp', 2400, 0.7), lp2 = Biquad('lp', 7000, 0.7), F = Math.round(0.5 * SR), b = new Float32Array(N + F);
    const G = [[1, r()], [2, r()], [3, r()], [5, r()]];
    let flut = 0;
    for (let i = 0; i < N + F; i++) {
      const u = (i % N) / N; let g = 0.55; for (const [k, p] of G) g += Math.sin(TAU * (k * u + p)) * 0.22 / k * 2; g = clamp(g, 0.08, 1.3);
      flut += ((r() < 0.003 ? 1 : 0) - flut) * 0.0006;
      b[i] = lp(pk()) * 1.6 * g + lp2(hp(r() * 2 - 1)) * 0.22 * g * g * (0.6 + flut * 3);
    }
    const o = loopify(b, F); for (let i = 0; i < N; i++) a[i] = o[i]; return norm(a, 0.5);
  }
  function river(sec, seed) {   // brook: low rush + babble band + many tiny rising bubbles
    const r = rng(seed), N = Math.round(sec * SR), F = Math.round(0.4 * SR), b = new Float32Array(N + F), pk = pinkGen(r), lp = Biquad('lp', 650, 0.6), bp = Biquad('bp', 1300, 1.1);
    let am = 0;
    for (let i = 0; i < N + F; i++) { am += ((r() * 2 - 1) - am) * 0.02; b[i] = lp(pk()) * 1.2 + bp(r() * 2 - 1) * (0.25 + Math.abs(am) * 1.6) * 0.5; }
    const a = loopify(b, F);
    const nb = Math.round(sec * 22);
    for (let k = 0; k < nb; k++) {
      const at = Math.floor(r() * N), f0 = 350 + Math.pow(r(), 1.5) * 1100, L = Math.round((0.012 + r() * 0.03) * SR), g = 0.04 + r() * 0.12; let ph = 0;
      for (let i = 0; i < L; i++) { const u = i / L; ph += TAU * f0 * (1 + 0.8 * u) / SR; a[(at + i) % N] += Math.sin(ph) * g * Math.sin(Math.PI * u); }
    }
    return norm(a, 0.5);
  }
  function rain(sec, seed) {   // hiss + patter on leaves + droplet ticks + a few bigger plips
    const r = rng(seed), N = Math.round(sec * SR), F = Math.round(0.4 * SR), b = new Float32Array(N + F), pk = pinkGen(r), hp = Biquad('hp', 1400, 0.7), lp = Biquad('lp', 8000, 0.7), lp2 = Biquad('lp', 900, 0.6);
    for (let i = 0; i < N + F; i++) b[i] = lp(hp(r() * 2 - 1)) * 0.22 + lp2(pk()) * 0.5;
    const a = loopify(b, F);
    const bp = Biquad('bp', 3000, 2);
    for (let k = 0; k < sec * 70; k++) { const at = Math.floor(r() * N), g = Math.pow(r(), 2) * 0.5; bp.tune(1800 + r() * 4500, 2.5); for (let i = 0; i < 90; i++) a[(at + i) % N] += bp(i < 3 ? (r() * 2 - 1) * g : 0); }
    for (let k = 0; k < sec * 3; k++) { const at = Math.floor(r() * N), f0 = 1400 + r() * 1500, g = 0.06 + r() * 0.08, L = Math.round(0.03 * SR); let ph = 0; for (let i = 0; i < L; i++) { const u = i / L; ph += TAU * f0 * (1 - 0.35 * u) / SR; a[(at + i) % N] += Math.sin(ph) * g * Math.exp(-u * 4); } }
    return norm(a, 0.5);
  }
  function crickets(sec, seed) {   // 3 crickets: chirps of 3-4 pulses (~28 Hz) on a 4-5 kHz carrier, wrapped = seamless
    const r = rng(seed), N = Math.round(sec * SR), a = new Float32Array(N);
    for (const fc of [4300, 4680, 4980]) {
      const per = 0.5 + r() * 0.4, pulses = 3 + (r() < 0.5 ? 1 : 0), g = 0.5 + r() * 0.5; let t = r() * per;
      while (t < sec) {
        for (let p = 0; p < pulses; p++) {
          const at = Math.round((t + p / 28) * SR), L = Math.round(0.017 * SR), ff = fc * (1 + (r() - 0.5) * 0.004);
          for (let i = 0; i < L; i++) { const u = i / L, e = Math.pow(Math.sin(Math.PI * u), 2); a[(at + i) % N] += Math.sin(TAU * ff * i / SR) * e * g * (0.8 + 0.2 * Math.sin(TAU * 900 * i / SR)); }
        }
        t += per * (0.9 + r() * 0.2);
      }
    }
    return norm(a, 0.5);
  }
  // birds: one phrase per buffer; kinds trill / whistle / feebee / chip / warble / dove
  function bird(kind, seed) {
    const r = rng(seed), notes = [];   // [start s, dur s, f0, f1, vibrato depth]
    let t = 0.02;
    if (kind === 'trill') { const n = 7 + Math.floor(r() * 8), f0 = 3300 + r() * 1300, d = 0.035 + r() * 0.02, gap = 0.016 + r() * 0.012; for (let k = 0; k < n; k++) { notes.push([t, d, f0 * (1 + 0.012 * k), f0 * 0.72, 0, 0.5 + 0.5 * Math.sin(Math.PI * (k + 0.5) / n)]); t += d + gap; } }
    else if (kind === 'whistle') { const n = 3 + Math.floor(r() * 3); let f = 2000 + r() * 1400; for (let k = 0; k < n; k++) { const d = 0.1 + r() * 0.13, f1 = clamp(f + (r() - 0.5) * 1100, 1800, 3700); notes.push([t, d, f, f1, 0.015, 0.7 + r() * 0.3]); t += d + 0.04 + r() * 0.09; f = clamp(f1 + (r() - 0.5) * 500, 1800, 3700); } }
    else if (kind === 'feebee') { const s = 0.97 + r() * 0.06; notes.push([t, 0.28, 3900 * s, 3850 * s, 0.004, 1]); t += 0.35; notes.push([t, 0.32, 3300 * s, 3220 * s, 0.004, 0.85]); }
    else if (kind === 'chip') { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) { notes.push([t, 0.03, 4700 + r() * 600, 3500, 0, 0.8]); t += 0.12 + r() * 0.14; } }
    else if (kind === 'warble') { const d = 0.7 + r() * 0.4; notes.push([t, d, -1, 0, 0, 0.8]); }
    else if (kind === 'dove') { const f = 520 + r() * 80; notes.push([t, 0.24, f * 0.92, f, 0.004, 0.6]); t += 0.32; notes.push([t, 0.46, f * 1.06, f * 0.94, 0.004, 1]); t += 0.55; notes.push([t, 0.3, f * 0.96, f * 0.9, 0.004, 0.7]); }
    const end = notes.reduce((m, n) => Math.max(m, n[0] + n[1]), 0) + 0.05, a = arr(end);
    const vr = 24 + r() * 10, wp = [r() * 6, r() * 6], wf = [8 + r() * 6, 3 + r() * 3];
    for (const [t0, d, f0, f1, vd, g] of notes) {
      const o = Math.round(t0 * SR), L = Math.round(d * SR); let ph = 0;
      for (let i = 0; i < L; i++) {
        const u = i / L, tt = i / SR;
        let f = f0 < 0 ? 2700 + 650 * Math.sin(TAU * wf[0] * tt + wp[0]) + 300 * Math.sin(TAU * wf[1] * tt + wp[1]) : f0 + (f1 - f0) * (kind === 'trill' || kind === 'chip' ? Math.sqrt(u) : u * u * (3 - 2 * u));
        f *= 1 + vd * Math.sin(TAU * vr * tt); ph += TAU * f / SR;
        const e = kind === 'dove' ? Math.pow(Math.sin(Math.PI * u), 1.2) : Math.pow(Math.sin(Math.PI * u), 0.6) * (f0 < 0 ? 0.7 + 0.3 * Math.sin(TAU * 17 * tt) : 1);
        a[o + i] += (Math.sin(ph) + (kind === 'dove' ? 0.25 : 0.12) * Math.sin(2 * ph)) * e * g;
      }
    }
    if (kind === 'dove') { const lp = Biquad('lp', 1400, 0.7); for (let i = 0; i < a.length; i++) a[i] = lp(a[i]); }
    return norm(a, 0.5);
  }
  function tink(seed) {   // firefly shimmer: 2-3 glassy high notes, soft attack
    const r = rng(seed), PENT = [84, 86, 88, 91, 93, 96, 98], n = 2 + Math.floor(r() * 2), a = arr(1.4);
    for (let k = 0; k < n; k++) { const f = mtof(PENT[Math.floor(r() * PENT.length)]), v = additive(f, [{ r: 1, a: 1, tau: 0.35 }, { r: 2.76, a: 0.12, tau: 0.12 }], 0.9, 0.015, r); mix(a, v, 0.02 + k * (0.09 + r() * 0.1), 0.7 - k * 0.15); }
    return norm(a, 0.4);
  }
  function tok(seed) {   // soft wooden hammer tap
    const r = rng(seed), a = arr(0.16), bp = Biquad('bp', 1900, 1.2); let ph = 0;
    for (let i = 0; i < a.length; i++) { const t = i / SR, f = 240 + 150 * Math.exp(-t / 0.012); ph += TAU * f / SR; a[i] = Math.sin(ph) * Math.exp(-t / 0.04) + 0.3 * Math.sin(TAU * 820 * t) * Math.exp(-t / 0.02) + bp(r() * 2 - 1) * 0.5 * Math.exp(-t / 0.005); }
    return norm(fadeOut(a, 0.02), 0.6);
  }

  // ======================================================================= SFX (rendered in C; musical ones follow the key)
  const K = (m, r) => kalimba(mtof(m), r), Ce = (m, r) => celesta(mtof(m), r), Pi = (m, r) => feltPiano(mtof(m), r);
  function plop(f0, f1, dur) { const a = arr(dur + 0.05); let ph = 0; for (let i = 0; i < a.length; i++) { const t = i / SR, u = Math.min(1, t / dur); ph += TAU * (f0 + (f1 - f0) * Math.sqrt(u)) / SR; a[i] = Math.sin(ph) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (dur * 0.45)); } return fadeOut(a, 0.02); }
  function sweepNoise(dur, fs, q, env, seed, hp) { const r = rng(seed), a = arr(dur), bp = Biquad('bp', fs(0), q), h = Biquad('hp', hp || 120, 0.7); for (let i = 0; i < a.length; i++) { const u = i / a.length; if (i % 32 === 0) bp.tune(fs(u), q); a[i] = bp(h(r() * 2 - 1)) * env(u); } return a; }
  const SFX = {
    tap: () => norm(plop(520, 900, 0.07), 0.35),
    open: () => { const a = arr(0.7), r = rng(3); mix(a, K(76, r), 0, 0.8); mix(a, K(83, r), 0.07, 0.7); return norm(fadeOut(a, 0.2), 0.3); },
    close: () => { const a = arr(0.6), r = rng(4); mix(a, K(81, r), 0, 0.7); mix(a, K(74, r), 0.065, 0.6); return norm(fadeOut(a, 0.2), 0.25); },
    assign: () => { const a = arr(0.8), r = rng(5); mix(a, plop(500, 820, 0.05), 0, 0.5); mix(a, K(79, r), 0.03, 0.8); mix(a, K(86, r), 0.1, 0.65); return norm(fadeOut(a, 0.25), 0.36); },
    pour: () => { const a = sweepNoise(0.9, u => 1900 - 900 * u, 1.6, u => Math.min(1, u * 12) * Math.pow(1 - u, 1.5), 11, 300), r = rng(12); for (let k = 0; k < 14; k++) mix(a, plop(380 + r() * 700, 900 + r() * 700, 0.03 + r() * 0.03), 0.05 + r() * 0.75, 0.25 + r() * 0.3); return norm(a, 0.4); },
    lantern: () => { const a = sweepNoise(0.5, u => 400 + 1300 * u, 1.2, u => Math.sin(Math.PI * u) * 0.5, 13), r = rng(14), o = new Float32Array(Math.round(1.6 * SR)); mix(o, a, 0, 1); mix(o, Ce(84, r), 0.18, 0.7); mix(o, Ce(91, r), 0.3, 0.5); return norm(fadeOut(o, 0.3), 0.38); },
    tok: () => tok(15),
    built: () => { const a = arr(2.2), r = rng(16); [72, 76, 79, 84].forEach((m, k) => mix(a, K(m, r), k * 0.11, 0.8)); mix(a, Ce(96, r), 0.5, 0.5); mix(a, Ce(91, r), 0.56, 0.35); return norm(fadeOut(a, 0.4), 0.5); },
    whoosh: () => norm(sweepNoise(1.4, u => 300 + 1300 * Math.sin(Math.PI * Math.min(1, u * 1.1)), 1.1, u => Math.pow(Math.sin(Math.PI * u), 1.5), 17, 150), 0.42),
    pop: () => { const a = plop(700, 1300, 0.05), r = rng(18), bp = Biquad('bp', 3000, 1); for (let i = 0; i < 60; i++) a[i] += bp(r() * 2 - 1) * 0.3 * (1 - i / 60); return norm(a, 0.4); },
    gift: () => { const a = arr(1.8), r = rng(19); [79, 84, 88, 91, 96].forEach((m, k) => mix(a, Ce(m, r), k * 0.07, 0.75)); mix(a, sweepNoise(1.2, () => 7000, 0.8, u => Math.sin(Math.PI * u) * 0.12, 20, 4000), 0.1, 1); return norm(fadeOut(a, 0.4), 0.45); },
    yip: () => {   // a tiny pup yip: harmonic source through a nasal formant, quick up-down glide
      const a = arr(0.2), bp = Biquad('bp', 1700, 2.2), bp2 = Biquad('bp', 3300, 3); let ph = 0;
      for (let i = 0; i < a.length; i++) { const t = i / SR, u = t / 0.15; const f = u < 0.3 ? 760 + 520 * (u / 0.3) : 1280 - 330 * Math.min(1, (u - 0.3) / 0.7); ph += TAU * f * (1 + 0.02 * Math.sin(TAU * 32 * t)) / SR; let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(ph * h) / h; a[i] = (bp(s) * 1.2 + bp2(s) * 0.4) * (1 - Math.exp(-t / 0.006)) * (u < 1 ? Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.5) : 0); }
      return norm(fadeOut(a, 0.03), 0.3);
    },
    water: () => { const p = SFX.pour(), a = arr(1.6), r = rng(21); mix(a, p, 0, 1); mix(a, Ce(88, r), 0.6, 0.6); mix(a, Ce(91, r), 0.72, 0.5); return norm(fadeOut(a, 0.3), 0.45); },
    like: () => { const a = arr(1.0), r = rng(22); mix(a, plop(600, 1000, 0.05), 0, 0.7); mix(a, plop(800, 1350, 0.05), 0.09, 0.7); mix(a, Ce(91, r), 0.16, 0.5); return norm(fadeOut(a, 0.3), 0.42); },
    note: () => { const a = arr(1.2), r = rng(23); for (let k = 0; k < 3; k++) mix(a, sweepNoise(0.07, u => 2600 + 900 * Math.sin(u * 30), 2, u => Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(u * 60)), 24 + k), k * 0.11, 0.6); mix(a, Ce(86, r), 0.4, 0.6); return norm(fadeOut(a, 0.3), 0.38); },
    notify: () => { const a = arr(1.3), r = rng(25); mix(a, Ce(79, r), 0, 0.7); mix(a, Ce(84, r), 0.12, 0.6); return norm(fadeOut(a, 0.3), 0.33); },
    shimmer: () => tink(26),
    sting_level: () => { const a = arr(4.2), r = rng(27); [48, 60, 67, 71, 74, 76, 79].forEach((m, k) => mix(a, Pi(m, r), k * 0.13, k === 0 ? 0.6 : 0.75 - k * 0.04)); [84, 88, 91, 96].forEach((m, k) => mix(a, Ce(m, r), 1.0 + k * 0.1, 0.45)); return norm(fadeOut(a, 0.8), 0.55); },
    sting_haul: () => { const a = arr(2.4), r = rng(28); mix(a, plop(500, 900, 0.06), 0, 0.7); [67, 71, 74, 79, 83].forEach((m, k) => mix(a, K(m, r), 0.12 + k * 0.09, 0.75)); mix(a, sweepNoise(1.4, () => 7500, 0.8, u => Math.sin(Math.PI * u) * 0.1, 29, 4000), 0.4, 1); return norm(fadeOut(a, 0.5), 0.5); },
    sting_gift: () => { const a = arr(2.6), r = rng(30); [72, 76, 79, 84, 88, 91].forEach((m, k) => mix(a, Ce(m, r), k * 0.085, 0.7)); mix(a, Pi(60, r), 0, 0.4); mix(a, Pi(64, r), 0.02, 0.3); mix(a, sweepNoise(1.6, () => 7000, 0.8, u => Math.sin(Math.PI * u) * 0.1, 31, 4000), 0.3, 1); return norm(fadeOut(a, 0.6), 0.5); },
    sting_arrive: () => { const a = arr(2.0), r = rng(32); [76, 79, 84].forEach((m, k) => mix(a, K(m, r), k * 0.15, 0.8)); mix(a, K(88, r), 0.5, 0.5); mix(a, SFX.yip(), 0.75, 0.6); return norm(fadeOut(a, 0.4), 0.48); },
    // Round 2 step 2: the colour wave (a slow felt-piano bloom rising under an airy swell + celesta sparkles) and the tree's
    // voice (two low soft piano notes + one high bell: "the tree speaks")
    sting_bloom: () => { const a = arr(6.2), r = rng(33); mix(a, sweepNoise(4.2, u => 500 + 2600 * u, 0.7, u => Math.pow(Math.sin(Math.PI * u), 2) * 0.09, 34, 200), 0.1, 1);
      [43, 55, 62, 67, 71, 74, 79, 83].forEach((m, k) => mix(a, Pi(m, r), k * 0.32, k === 0 ? 0.55 : 0.62 - k * 0.03)); [86, 91, 95, 98].forEach((m, k) => mix(a, Ce(m, r), 2.0 + k * 0.28, 0.32)); return norm(fadeOut(a, 1.4), 0.5); },
    voice: () => { const a = arr(3.0), r = rng(35); mix(a, Pi(48, r), 0, 0.5); mix(a, Pi(55, r), 0.18, 0.45); mix(a, Ce(88, r), 0.42, 0.3); mix(a, sweepNoise(1.8, () => 900, 0.6, u => Math.sin(Math.PI * u) * 0.05, 36, 200), 0.05, 1); return norm(fadeOut(a, 0.9), 0.36); },
    // Round 2 step 4: a lantern released (an airy lift + a slow rising celesta line over two soft piano notes), a lantern drifting in
    // (two far bells + a firefly shimmer), warmth back (a warm low chord + one bell), the World Bloom opening (a kalimba cascade + bells)
    lantern_rise: () => { const a = arr(4.6), r = rng(37); mix(a, sweepNoise(3.6, u => 350 + 1500 * u, 0.8, u => Math.pow(Math.sin(Math.PI * u), 1.6) * 0.16, 38, 180), 0.05, 1);
      mix(a, Pi(55, r), 0, 0.45); mix(a, Pi(62, r), 0.2, 0.38); [79, 83, 86, 91, 95].forEach((m, k) => mix(a, Ce(m, r), 0.5 + k * 0.42, 0.5 - k * 0.05)); return norm(fadeOut(a, 1.2), 0.42); },
    lantern_find: () => { const a = arr(2.6), r = rng(39); mix(a, Ce(88, r), 0, 0.55); mix(a, Ce(84, r), 0.34, 0.5); mix(a, tink(40), 0.6, 0.45); return norm(fadeOut(a, 0.8), 0.36); },
    warmth: () => { const a = arr(3.0), r = rng(41); mix(a, Pi(48, r), 0, 0.5); mix(a, Pi(55, r), 0.04, 0.42); mix(a, Pi(64, r), 0.08, 0.38); mix(a, Pi(67, r), 0.12, 0.3); mix(a, Ce(88, r), 0.5, 0.35); return norm(fadeOut(a, 1.0), 0.42); },
    sting_petals: () => { const a = arr(3.6), r = rng(42); [72, 76, 79, 83, 86, 88, 91].forEach((m, k) => mix(a, K(m, r), k * 0.11, 0.7 - k * 0.04)); [93, 96, 100].forEach((m, k) => mix(a, Ce(m, r), 0.9 + k * 0.22, 0.32));
      mix(a, sweepNoise(2.4, () => 6500, 0.8, u => Math.sin(Math.PI * u) * 0.08, 43, 3500), 0.4, 1); return norm(fadeOut(a, 1.0), 0.5); },
    // ---- vibe 2 lane C: the Elderglow theme as stings. theme_wave (a colour wave): the airy swell + felt-piano chords under the
    // theme on celesta, a kalimba echo of its answer; theme_dawn: phrase A alone on celesta over a soft low fifth, then home
    theme_wave: () => { const a = arr(11), r = rng(51), e8 = 0.27;
      mix(a, sweepNoise(6.5, u => 450 + 2400 * u, 0.7, u => Math.pow(Math.sin(Math.PI * u), 2) * 0.08, 52, 200), 0.1, 1);
      [[41, 0], [36, 1], [45, 2], [43, 3], [36, 4]].forEach(([m, bar]) => { const at = bar * 8 * e8; [0, 7, 16].forEach((iv, k) => mix(a, Pi(m + iv, r), at + k * 0.03, k ? 0.32 : 0.42)); });
      let t = 0.05; for (const [m, d] of THEME_A.concat(THEME_B)) { mix(a, Ce(m, r), t, 0.62); t += d * e8; }
      t = 0.05 + 16 * e8; for (const [m, d] of THEME_B) { mix(a, K(m + 12, r), t + 0.14, 0.18); t += d * e8; }
      return norm(fadeOut(a, 1.6), 0.5); },
    theme_dawn: () => { const a = arr(7.2), r = rng(53), e8 = 0.3;
      mix(a, Pi(41, r), 0, 0.3); mix(a, Pi(48, r), 0.05, 0.26);
      let t = 0.15; for (const [m, d] of THEME_A) { mix(a, Ce(m, r), t, 0.55); t += d * e8; }
      mix(a, Pi(36, r), t - 0.2, 0.28); mix(a, Ce(84, r), t, 0.3); return norm(fadeOut(a, 1.4), 0.36); },
    // the tree speaks: a low warm swell you feel more than hear (root, fifth, octave, a soft third), slow in, slow out
    swell: () => { const a = arr(6.5), lp = Biquad('lp', 520, 0.6);
      const P = [[36, 1], [43, 0.6], [48, 0.5], [52, 0.22], [55, 0.18]].map(([m, g]) => [TAU * mtof(m) / SR, g]);
      for (let i = 0; i < a.length; i++) { const t = i / SR, env = Math.min(1, t / 1.6) * (t > 4 ? Math.max(0, 1 - (t - 4) / 2.4) : 1); let s = 0; for (const [w, g] of P) s += Math.sin(w * i + 0.3 * Math.sin(TAU * 0.21 * t)) * g; a[i] = lp(s) * env * (0.85 + 0.15 * Math.sin(TAU * 0.33 * t)); }
      return norm(a, 0.36); },
    // foley: soft pitter-patter (3-4 tiny padded steps), a plaza wind chime, water lapping at the dock, the tree creaking at night,
    // a pup's yawn and a little snore, the sky whale's call, wood + stone gathering, lantern paper rustling
    step: () => { const a = arr(0.5), r = rng(54); let t = 0.01; for (let k = 0; k < 4; k++) { const bp = Biquad('bp', 260 + r() * 160, 1.1), o = Math.round(t * SR), L = Math.round(0.05 * SR);
        for (let i = 0; i < L && o + i < a.length; i++) { const u = i / SR; a[o + i] += bp(r() * 2 - 1) * Math.exp(-u / 0.012) * (k % 2 ? 0.8 : 1); } t += 0.09 + r() * 0.05; }
      return norm(fadeOut(a, 0.05), 0.3); },
    chime: () => { const a = arr(4.2), r = rng(55), notes = [84, 88, 91, 93, 96, 98]; let t = 0.02;
      for (let k = 0; k < 6; k++) { const f = mtof(notes[Math.floor(r() * notes.length)]); mix(a, additive(f, [{ r: 1, a: 1, tau: 1.6 }, { r: 2.76, a: 0.35, tau: 0.7 }, { r: 5.4, a: 0.16, tau: 0.3 }, { r: 8.93, a: 0.07, tau: 0.12 }], 2.6, 0.002, r), t, 0.6 - k * 0.05); t += 0.12 + r() * 0.3; }
      return norm(fadeOut(a, 0.6), 0.28); },
    lap: () => { const a = arr(2.4), r = rng(56), pk = pinkGen(r), lp = Biquad('lp', 700, 0.7), bp = Biquad('bp', 950, 2);
      for (let i = 0; i < a.length; i++) { const u = i / a.length, sw = Math.pow(Math.sin(Math.PI * Math.min(1, u * 2.1)), 2) * 0.9 + Math.pow(Math.max(0, Math.sin(Math.PI * (u * 2.1 - 1.05))), 2) * 0.6; const n = pk(); a[i] = (lp(n) * 0.8 + bp(n) * 0.5) * sw; }
      for (let k = 0; k < 5; k++) mix(a, plop(300 + r() * 300, 500 + r() * 400, 0.04 + r() * 0.03), 0.3 + r() * 1.7, 0.18 + r() * 0.12);
      return norm(fadeOut(a, 0.3), 0.3); },
    creak: () => { const a = arr(2.0), r = rng(57), bp = Biquad('bp', 520, 4), body = Biquad('bp', 170, 2); let ph = 0;
      for (let i = 0; i < a.length; i++) { const t = i / SR, u = t / 1.8, f = 34 + 22 * Math.sin(Math.PI * Math.min(1, u)) + (r() - 0.5) * 6; ph += f / SR; const pulse = ph % 1 < 0.08 ? 1 : 0;
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 0.7); a[i] = (bp(pulse) * 1.0 + body(pulse) * 0.6) * env; }
      return norm(fadeOut(a, 0.1), 0.28); },
    yawn: () => { const a = arr(1.0), f1 = Biquad('bp', 1500, 3), f2 = Biquad('bp', 2800, 4); let ph = 0;
      for (let i = 0; i < a.length; i++) { const t = i / SR, u = t / 0.9, f0 = u < 0.35 ? 560 + 420 * (u / 0.35) : 980 - 480 * Math.min(1, (u - 0.35) / 0.65);
        ph += TAU * f0 * (1 + 0.015 * Math.sin(TAU * 6 * t)) / SR; let s = 0; for (let h = 1; h <= 7; h++) s += Math.sin(ph * h) / (h * h * 0.6 + 0.4);
        if (i % 48 === 0) { f1.tune(1700 - 900 * Math.min(1, u), 3); f2.tune(2900 - 1100 * Math.min(1, u), 4); }
        const env = u < 1 ? Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.6) : 0; a[i] = (f1(s) + f2(s) * 0.35 + s * 0.05) * env; }
      return norm(fadeOut(a, 0.05), 0.24); },
    snore: () => { const a = arr(2.0), r = rng(58), bpI = Biquad('bp', 480, 2.5), bpO = Biquad('bp', 330, 2); let wph = 0;
      for (let i = 0; i < a.length; i++) { const t = i / SR, n = r() * 2 - 1;
        const inh = t < 0.9 ? Math.sin(Math.PI * t / 0.9) * (0.7 + 0.3 * Math.sin(TAU * 28 * t)) : 0, exh = t > 1.0 && t < 1.9 ? Math.sin(Math.PI * (t - 1.0) / 0.9) : 0;
        wph += TAU * (1250 - 200 * (t - 1)) / SR; a[i] = bpI(n) * inh * 0.9 + bpO(n) * exh * 0.5 + Math.sin(wph) * exh * 0.025; }
      return norm(a, 0.2); },
    whale: () => { const a = arr(5.2); let ph = 0;
      for (let i = 0; i < Math.round(3.4 * SR); i++) { const t = i / SR, u = t / 3.4, f = 150 + 80 * Math.sin(Math.PI * Math.min(1, u * 1.15)) - 30 * u + 4 * Math.sin(TAU * 5 * t) * Math.min(1, t);
        ph += TAU * f / SR; const env = Math.pow(Math.sin(Math.PI * u), 0.8); a[i] = (Math.sin(ph) + Math.sin(2 * ph) * 0.45 + Math.sin(3 * ph) * 0.18 + Math.sin(4 * ph + 0.3) * 0.08) * env; }
      const dry = a.slice(), lp = Biquad('lp', 900, 0.6), e = dry.map(x => lp(x)); mix(a, e, 0.45, 0.38); mix(a, e, 0.95, 0.18);
      return norm(fadeOut(a, 0.6), 0.4); },
    chop: () => { const a = plop(230, 140, 0.08), r = rng(59), bp = Biquad('bp', 1800, 1.4), body = Biquad('bp', 420, 2), o = arr(0.4); mix(o, a, 0, 0.7);
      for (let i = 0; i < Math.round(0.06 * SR); i++) { const n = r() * 2 - 1, u = i / SR; o[i] += (bp(n) * 0.8 + body(n) * 0.5) * Math.exp(-u / 0.01); }
      return norm(fadeOut(o, 0.05), 0.3); },
    clack: () => { const o = arr(0.45), r = rng(60);
      for (const [at, f, g] of [[0, 2600, 1], [0.13, 2050, 0.7]]) { const bp = Biquad('bp', 3200, 5), s0 = Math.round(at * SR); let ph = 0;
        for (let i = 0; i < Math.round(0.12 * SR); i++) { const u = i / SR; ph += TAU * f / SR; o[s0 + i] += (bp(r() * 2 - 1) * Math.exp(-u / 0.004) * 1.2 + Math.sin(ph) * Math.exp(-u / 0.03) * 0.35) * g; } }
      return norm(fadeOut(o, 0.05), 0.28); },
    rustle: () => { const a = arr(0.8), r = rng(61), hp = Biquad('hp', 2600, 0.7), bp = Biquad('bp', 5200, 1.5); let g = 0;
      for (let i = 0; i < a.length; i++) { const u = i / a.length; if (r() < 0.004) g = 0.6 + r() * 0.4; g *= 0.9975; const n = r() * 2 - 1; a[i] = (hp(n) * 0.5 + bp(n) * 0.7) * (0.15 + g) * Math.pow(Math.sin(Math.PI * u), 0.5); }
      return norm(fadeOut(a, 0.08), 0.24); },
  };
  const MUSICAL = { open: 1, close: 1, assign: 1, built: 1, gift: 1, water: 1, like: 1, note: 1, notify: 1, sting_level: 1, sting_haul: 1, sting_gift: 1, sting_arrive: 1, lantern: 1, sting_bloom: 1, voice: 1, lantern_rise: 1, lantern_find: 1, warmth: 1, sting_petals: 1, theme_wave: 1, theme_dawn: 1, swell: 1, chime: 1 };
  const STING = { sting_level: 4, sting_haul: 2.4, sting_gift: 2.6, sting_arrive: 2, sting_bloom: 6, voice: 2.6, lantern_rise: 4.6, sting_petals: 3.6, theme_wave: 9, theme_dawn: 5.5 };
  // vibe 2 lane C: foley is rate-limited per name (the game also spaces them out); gaps in seconds of audio time
  const GAP = { tap: 0.04, pour: 0.35, lantern: 0.35, tok: 0.08, pop: 0.03, yip: 20, shimmer: 0.3, notify: 0.5, open: 0.08, close: 0.08,
    step: 0.28, chime: 9, lap: 3, creak: 25, yawn: 12, snore: 5, whale: 14, chop: 0.5, clack: 0.5, rustle: 0.6, swell: 4, theme_wave: 8, theme_dawn: 60 };

  // ======================================================================= the bank (built once per page, shared by contexts)
  const RANGES = { rh: [45, 87], pi: [36, 96], ce: [60, 102], ka: [55, 91], ba: [28, 52] };
  const INST = { rh: (f) => rhodes(f), pi: (f, r) => feltPiano(f, r), ce: (f, r) => celesta(f, r), ka: (f, r) => kalimba(f, r), ba: f => bass(f) };
  let BANK = null, building = null;
  const mkBuf = (ctx, a) => { const b = ctx.createBuffer(1, a.length, SR); b.getChannelData(0).set(a); return b; };
  function build(ctx) {   // async, yields between instruments so a phone keeps drawing
    if (BANK) return Promise.resolve(BANK);
    if (building) return building;
    const B = { inst: {}, drums: {}, birds: [], tinks: [], toks: [], sfx: {}, loops: {} }, jobs = [];
    const t0 = performance.now();
    for (const k of Object.keys(RANGES)) { const [lo, hi] = RANGES[k], r = rng(k.charCodeAt(0) * 31 + 7); B.inst[k] = []; for (let m = lo; m <= hi; m += 6) jobs.push(() => { B.inst[k].push({ m, b: mkBuf(ctx, INST[k](mtof(m), r)) }); }); }   // one note per job
    jobs.push(() => { B.drums.kick = mkBuf(ctx, kick()); B.drums.brush = [mkBuf(ctx, brush(1)), mkBuf(ctx, brush(2))]; B.drums.shk = [mkBuf(ctx, shaker(3)), mkBuf(ctx, shaker(4)), mkBuf(ctx, shaker(5))]; });
    jobs.push(() => { const kinds = ['trill', 'whistle', 'feebee', 'chip', 'warble', 'whistle', 'trill', 'whistle', 'chip', 'warble', 'trill', 'whistle', 'feebee', 'dove']; kinds.forEach((k, i) => B.birds.push({ k, b: mkBuf(ctx, bird(k, 100 + i * 17)) })); for (let i = 0; i < 5; i++) B.tinks.push(mkBuf(ctx, tink(200 + i))); for (let i = 0; i < 3; i++) B.toks.push(mkBuf(ctx, tok(300 + i))); });
    jobs.push(() => { B.loops.vinylA = mkBuf(ctx, vinyl(7.1, 41)); B.loops.vinylB = mkBuf(ctx, vinyl(5.3, 42)); B.loops.wind = mkBuf(ctx, wind(14, 43)); });
    jobs.push(() => { B.loops.river = mkBuf(ctx, river(11, 44)); B.loops.rain = mkBuf(ctx, rain(10, 45)); B.loops.crickets = mkBuf(ctx, crickets(8, 46)); });
    for (const k of Object.keys(SFX)) jobs.push(() => { B.sfx[k] = mkBuf(ctx, SFX[k]()); });
    building = new Promise(res => {
      const next = () => { const t = performance.now(); while (jobs.length && performance.now() - t < 12) jobs.shift()(); if (jobs.length) setTimeout(next, 0); else { B.ms = Math.round(performance.now() - t0); BANK = B; res(B); } };
      next();
    });
    return building;
  }
  function pick(inst, m) { const L = BANK.inst[inst], lo = L[0].m, hi = L[L.length - 1].m + 5; while (m < lo) m += 12; while (m > hi) m -= 12; let best = L[0]; for (const x of L) if (Math.abs(x.m - m) < Math.abs(best.m - m)) best = x; return { b: best.b, rate: Math.pow(2, (m - best.m) / 12) }; }

  // ======================================================================= harmony + composition
  const CH = {
    Cmaj9: { b: 36, v: [52, 55, 59, 62] }, Cmaj7: { b: 36, v: [55, 59, 60, 64] }, Dm9: { b: 38, v: [53, 57, 60, 64] }, Em7: { b: 40, v: [55, 59, 62, 64] },
    Fmaj9: { b: 41, v: [55, 57, 60, 64] }, Fmaj7: { b: 41, v: [53, 57, 60, 64] }, Fm9: { b: 41, v: [55, 56, 60, 63] }, Fm6: { b: 41, v: [56, 60, 62, 65] },
    G13: { b: 43, v: [53, 57, 59, 64] }, G9sus: { b: 43, v: [53, 57, 60, 62] }, G6: { b: 43, v: [55, 59, 62, 64] }, Gm9: { b: 43, v: [53, 57, 58, 62] },
    C9: { b: 36, v: [52, 55, 58, 62] }, A7b13: { b: 45, v: [55, 61, 65, 69] }, Am9: { b: 45, v: [55, 59, 60, 64] }, E7b9: { b: 40, v: [56, 59, 62, 65] },
  };
  for (const k of Object.keys(CH)) {   // chord tones + a chord scale (C major with the chord's own notes replacing neighbours)
    const c = CH[k], pcs = new Set([c.b % 12, ...c.v.map(x => x % 12)]); c.pcs = pcs;
    const sc = new Set([0, 2, 4, 5, 7, 9, 11]); for (const p of pcs) if (!sc.has(p)) { sc.delete((p + 1) % 12); sc.delete((p + 11) % 12); sc.add(p); }
    c.scale = []; for (let m = 55; m <= 96; m++) if (sc.has(m % 12)) c.scale.push(m);
  }
  const DAY = [['Fmaj9', 'Em7', 'Dm9', 'Cmaj9'], ['Dm9', 'G13', 'Cmaj9', 'A7b13'], ['Am9', 'Fmaj9', 'Cmaj7', 'G6'],
    ['Fmaj9', 'Fm9', 'Em7', 'A7b13', 'Dm9', 'G9sus', 'Cmaj9', 'Cmaj9'], ['Cmaj9', 'E7b9', 'Am9', 'Gm9', 'C9', 'Fmaj9', 'Fm6', 'Cmaj9']];
  const NIGHT = [['Cmaj9', 'Am9', 'Fmaj9', 'Fm6'], ['Fmaj9', 'Em7', 'Am9', 'G9sus'], ['Dm9', 'Cmaj9', 'Fmaj9', 'Fm6'], ['Am9', 'Em7', 'Fmaj9', 'Cmaj9']];
  // season flavour: key (semitones from C), tempo, music low-pass, lead voices, extras
  const SEA = [
    { name: 'spring', key: 2, bpm: 76, lp: 6200, lead: 'pi', glock: 0.5, pad: 0, shk16: 0, drums: 1 },
    { name: 'summer', key: 0, bpm: 78, lp: 5200, lead: 'pi', glock: 0.2, pad: 0.6, shk16: 1, drums: 1 },
    { name: 'autumn', key: -3, bpm: 72, lp: 3300, lead: 'rh', glock: 0, pad: 0.3, shk16: 0, drums: 1 },
    { name: 'winter', key: -2, bpm: 68, lp: 3900, lead: 'ce', glock: 0, pad: 0.5, shk16: 0, drums: 0 },
  ];
  // ---- vibe 2 lane C: the "Elderglow theme", hand-written (C major, transposed with the season's key): [midi, 8ths]. Phrase A asks,
  // phrase B answers (2 bars each). It sounds at every colour wave (theme_wave) and at dawn (theme_dawn), and now and then a
  // section of the generated music is built round it on its own chords (THEME_PROG), in one of 3 variations.
  const THEME_A = [[76, 1], [79, 1], [81, 2], [79, 1], [76, 1], [74, 2], [72, 1], [74, 1], [76, 1], [79, 1], [76, 4]];
  const THEME_B = [[81, 1], [84, 1], [86, 2], [84, 1], [81, 1], [79, 2], [76, 1], [79, 1], [74, 2], [72, 4]];
  const THEME_PROG = ['Fmaj9', 'Cmaj9', 'Am9', 'G6', 'Fmaj9', 'Em7', 'Dm9', 'Cmaj9'];
  // variations: 0 = as written, 1 = up an octave + a pick-up and a held answer, 2 = neighbour-tone turns on the long notes
  function themeVar(k) {
    const A = THEME_A.map(x => x.slice()), B = THEME_B.map(x => x.slice());
    if (k === 1) { A.forEach(x => x[0] += 12); B.forEach(x => x[0] += 12); A[0][1] = 0.5; A.unshift([72 + 12, 0.5]); B[B.length - 1][1] = 4; }
    if (k === 2) { const turn = L => L.flatMap(([m, d]) => d >= 2 ? [[m, d / 2], [m + (m % 12 === 4 || m % 12 === 11 ? 1 : 2), d / 4], [m, d / 4]] : [[m, d]]); return { A: turn(A), B: turn(B) }; }
    return { A, B };
  }
  const COMP = [[[0, 10, 1], [10, 6, 0.7]], [[0, 6, 1], [6, 4, 0.6], [11, 5, 0.75]], [[0, 16, 0.9]], [[2, 6, 0.8], [8, 4, 0.7], [14, 2, 0.55]], [[0, 8, 0.95], [12, 4, 0.6]]];
  function compose(r, night, sea, n, forceTheme) {
    const S = SEA[sea], nightish = night > 0.5;
    const pool = nightish ? NIGHT : DAY, src = pool[Math.floor(r() * pool.length)];
    // kind: the first section is light, a rest (vinyl + nature only) every 11-15 sections, a light one every ~4
    let kind = n === 0 ? 'light' : n % 13 === 12 ? 'rest' : (n % 4 === 3 || r() < 0.18) ? 'light' : 'main';
    // vibe 2 lane C: the Elderglow theme woven in now and then (~1 section in 9, never the first / a rest), quietly
    const theme = forceTheme !== undefined && forceTheme !== null ? forceTheme : (kind !== 'rest' && n > 2 && n % 9 === 5 ? Math.floor(r() * 3) : -1);
    if (theme >= 0 && kind === 'rest') kind = 'light';
    const bars = theme >= 0 ? THEME_PROG.slice() : src.length === 8 ? src.slice() : nightish ? src.flatMap(c => [c, c]) : src.concat(src);
    const ev = Array.from({ length: 128 }, () => []), E = (st, e) => { if (st >= 0 && st < 128) ev[st].push(e); };
    const sec = { bars, kind, ev, sea, key: S.key, bpm: S.bpm, n, theme };
    if (kind === 'rest') return sec;
    // motif: 2-bar rhythm on the 8th grid + a contour in chord-scale steps
    const on = []; { let s = [0, 2, 4][Math.floor(r() * 3)]; while (s < 28 && on.length < 6) { on.push(s); s += [2, 2, 4, 4, 4, 6, 6, 8][Math.floor(r() * 8)]; } }
    const cont = on.map(() => [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(r() * 9)]);
    const cA = COMP[Math.floor(r() * COMP.length)], cB = COMP[Math.floor(r() * COMP.length)];
    const leadOn = kind === 'main' ? r() < 0.9 : r() < 0.45;
    for (let bar = 0; bar < 8; bar++) {
      const c = CH[bars[bar]], nx = CH[bars[(bar + 1) % 8]], b0 = bar * 16;
      // ---- DAY: Rhodes comping (strummed), bass, drums
      for (const [s, d, v] of (bar % 2 ? cB : cA)) c.v.forEach((m, k) => E(b0 + s, { L: 'd', i: 'rh', m, v: v * (0.17 + r() * 0.04) * (kind === 'light' ? 0.85 : 1), d, st: k }));
      if (kind === 'main') {
        const bp = [[[0, 10, 0], [10, 6, 7]], [[0, 14, 0], [14, 2, 'ap']], [[0, 6, 0], [6, 4, 12], [10, 6, 7]]][Math.floor(r() * 3)];
        for (const [s, d, iv] of bp) { const m = iv === 'ap' ? nx.b + (r() < 0.5 ? -1 : 2) : c.b + iv; E(b0 + s, { L: 'd', i: 'ba', m, v: 0.36, d }); }
        if (S.drums) { E(b0, { L: 'd', i: 'kick', v: 0.55 }); E(b0 + 10, { L: 'd', i: 'kick', v: 0.42 }); if (r() < 0.3) E(b0 + 7, { L: 'd', i: 'kick', v: 0.3 }); if (bar % 4 === 3 && r() < 0.6) E(b0 + 14, { L: 'd', i: 'kick', v: 0.32 }); }
        E(b0 + 4, { L: 'd', i: 'brush', v: S.drums ? 0.42 : 0.3 }); E(b0 + 12, { L: 'd', i: 'brush', v: S.drums ? 0.46 : 0.32 }); if (r() < 0.35) E(b0 + 15, { L: 'd', i: 'brush', v: 0.14 });
      } else E(b0, { L: 'd', i: 'ba', m: c.b, v: 0.3, d: 16 });
      for (let s = 0; s < 16; s += S.shk16 && kind === 'main' ? 1 : 2) E(b0 + s, { L: 'd', i: 'shk', v: (s % 4 === 2 ? 0.3 : s % 2 ? 0.12 : 0.2) * (kind === 'main' ? 1 : 0.6) * (S.drums ? 1 : 0.7) });
      if (S.pad) E(b0, { L: 'd', i: 'pad', ms: c.v, v: 0.05 * S.pad, d: 16 });
      // ---- NIGHT: felt piano arpeggio, pad, soft whole-note bass
      const arpS = bar % 2 ? [0, 3, 6, 8, 11, 14] : [0, 4, 8, 12], arpN = [c.b + 24, c.v[0] + 12, c.v[1] + 12, c.v[2] + 12, c.v[3] + 12, c.v[1] + 12];
      arpS.forEach((s, k) => E(b0 + s, { L: 'n', i: 'pi', m: arpN[k % arpN.length], v: (k ? 0.17 : 0.22) * (0.85 + r() * 0.3), d: 14 - s + 2 }));
      if (bar % 2 === 0 || bars[bar] !== bars[bar - 1]) E(b0, { L: 'n', i: 'pad', ms: c.v, v: 0.065, d: bars[bar + 1] === bars[bar] && bar % 2 === 0 ? 32 : 16 });
      E(b0, { L: 'n', i: 'ba', m: c.b, v: 0.14, d: 16 });
      // ---- STAGE (performers): kalimba strum in 3+3+2, a little higher
      const sp = [c.v[0], c.v[2], c.v[1], c.v[3], c.v[2], c.v[1], c.v[3], c.v[2]];
      for (let k = 0; k < 8; k++) E(b0 + k * 2, { L: 's', i: 'ka', m: sp[k] + 12, v: (k === 0 || k === 3 || k === 6 ? 0.34 : 0.2) * (0.9 + r() * 0.2), d: 4 });
    }
    // ---- vibe 2 lane C: a theme section: the Elderglow theme on the lead (day, soft) + celesta / kalimba (night, softer);
    // bars 1-4 = phrase A + B, bars 5-8 = A again then B (the second time ends home on C)
    if (theme >= 0) {
      const V = themeVar(theme), line = V.A.concat(V.B, V.A, V.B); let st8 = 0;
      for (const [m, d] of line) {
        const st = Math.round(st8 * 2); st8 += d; if (st >= 128) break; const dur = Math.max(1, Math.round(d * 2));
        E(st, { L: 'd', i: 'lead', m, v: 0.3, d: dur });
        E(st, { L: 'n', i: theme === 2 ? 'ka' : 'ce', m: m + (m < 84 ? 12 : 0), v: 0.12, d: dur + 2 });
        if (theme === 1 && st % 8 === 0) E(st, { L: 'd', i: 'ce', m: m + 12, v: 0.06, d: dur });
      }
      return sec;
    }
    // ---- melody (day lead; the night layer gets a sparse echo an octave up)
    if (leadOn) for (let p = 0; p < 4; p++) {
      const b0 = p * 32; let idx = -1;
      for (let k = 0; k < on.length; k++) {
        if (p === 3 && on[k] >= 14) break;   // the answer phrase: first half of the motif, then a long resolving note
        const st = b0 + on[k], c = CH[bars[Math.floor(st / 16)]], sc = c.scale;
        if (idx < 0) { const tgt = 72 + (p === 1 ? 2 : 0); idx = sc.findIndex(m => m >= tgt); }
        idx = clamp(idx + cont[k] + (p === 1 && k === 0 ? 1 : 0), 0, sc.length - 1);
        let m = sc[idx]; if (on[k] % 8 === 0) { let best = m, bd = 99; for (let d = -3; d <= 3; d++) if (c.pcs.has((m + d + 120) % 12) && Math.abs(d) < bd) { bd = Math.abs(d); best = m + d; } m = best; }
        while (m > 84) m -= 12; while (m < 64) m += 12;
        const nxt = k + 1 < on.length ? on[k + 1] : 32, d = Math.min(8, nxt - on[k]) + (k === on.length - 1 ? 4 : 0);
        E(st, { L: 'd', i: 'lead', m, v: 0.4 * (on[k] % 8 === 0 ? 1 : 0.8), d });
        if (S.glock && r() < S.glock * 0.6) E(st, { L: 'd', i: 'ce', m: m + 12, v: 0.08, d });
        if ((p === 1 || p === 3) && k < 3) E(st, { L: 'n', i: S.lead === 'ce' ? 'ce' : 'pi', m: m + 12, v: 0.11, d: d + 2 });
      }
      if (p === 3) { const st = b0 + 16, c = CH[bars[Math.floor(st / 16)]]; let m = 72; for (const t of [72, 76, 79, 74, 71]) if (c.pcs.has(t % 12)) { m = t; break; } E(st, { L: 'd', i: 'lead', m, v: 0.36, d: 14 }); }
    }
    return sec;
  }

  // ======================================================================= the engine
  const PREF_KEY = 'schiffy-elderglow.sound';
  const DEF = { on: false, master: 0.8, music: 0.6, amb: 0.7, sfx: 0.8, asked: false };
  function make(o) {
    o = o || {};
    const silent = !!o.silent, offline = !!o.ctx && typeof OfflineAudioContext !== 'undefined' && o.ctx instanceof OfflineAudioContext;
    const KEY = PREF_KEY + (silent ? '.test' : '');
    let prefs = Object.assign({}, DEF);
    if (o.prefs) Object.assign(prefs, o.prefs); else try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    const savePrefs = () => { if (o.prefs) return; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };
    let ctx = o.ctx || null, G = null, started = false, ready = false, timer = 0, hidden = false;
    const R = rng(o.seed !== undefined ? o.seed : (Date.now() & 0xffffff));
    const st = { night: 0, dawn: 0, dusk: 0, sw: [0, 0, 1, 0], rain: 0, river: 0, tree: 0, health: 80, wind: 0.5, stage: null, build: null, cam: [0, 0, 0], right: [1, 0, 0], camD: 200, fest: 0, say: 0 };
    let forceTheme = null, sec = null, step = 0, nextT = 0, secN = 0, seaNow = 2, last = {}, nextBird = 0, nextTink = 0, nextTok = 0, duckUntil = 0;
    const E = { prefs, get ctx() { return ctx; }, get ready() { return ready; }, get on() { return prefs.on; }, get live() { return started && prefs.on && !hidden; }, st, SR };

    function makeCtx() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try { ctx = silent ? new AC({ latencyHint: 'playback', sinkId: { type: 'none' } }) : new AC({ latencyHint: 'playback' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; } }
      return ctx;
    }
    function graph() {
      const g = {}, c = ctx, gain = (v, to) => { const n = c.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
      g.out = c.destination;
      g.comp = c.createDynamicsCompressor(); g.comp.threshold.value = -10; g.comp.knee.value = 8; g.comp.ratio.value = 4; g.comp.attack.value = 0.01; g.comp.release.value = 0.25;
      g.an = c.createAnalyser(); g.an.fftSize = 2048;
      g.master = gain(0); g.master.connect(g.comp); g.comp.connect(g.an);
      if (silent) { g.mute = gain(0, c.destination); g.an.connect(g.mute); } else g.an.connect(c.destination);
      g.musicVol = gain(prefs.music, g.master); g.ambVol = gain(prefs.amb, g.master); g.sfxVol = gain(prefs.sfx, g.master);
      g.duck = gain(1, g.musicVol); g.lp = c.createBiquadFilter(); g.lp.type = 'lowpass'; g.lp.frequency.value = 4500; g.lp.Q.value = 0.5; g.lp.connect(g.duck);
      g.day = gain(1, g.lp); g.night = gain(0, g.lp);
      g.rh = gain(1, g.day);   // Rhodes tremolo (an LFO on its gain)
      g.trem = c.createOscillator(); g.trem.frequency.value = 4.2; const td = gain(0.12, g.rh.gain); g.trem.connect(td);
      g.padBus = gain(1); const plp = c.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 1100; plp.Q.value = 0.3; g.padBus.connect(plp); g.padD = gain(1, g.day); g.padN = gain(1, g.night); plp.connect(g.padD); g.padBusN = gain(1); const plpN = c.createBiquadFilter(); plpN.type = 'lowpass'; plpN.frequency.value = 900; plpN.Q.value = 0.3; g.padBusN.connect(plpN); plpN.connect(g.padN);
      { const re = new Float32Array(14), im = new Float32Array(14); for (let n = 1; n < 14; n++) im[n] = 1 / Math.pow(n, 1.35); g.wave = c.createPeriodicWave(re, im); }
      g.stageG = gain(0); g.pan = c.createStereoPanner ? c.createStereoPanner() : null; if (g.pan) { g.stageG.connect(g.pan); g.pan.connect(g.musicVol); } else g.stageG.connect(g.musicVol);
      g.vinyl = gain(0.0, g.musicVol);
      // ambience
      const loop = (b, to, rate, off) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate || 1; s.connect(to); s.start(0, off || 0); return s; };
      g.windG = gain(0, g.ambVol); g.windLP = c.createBiquadFilter(); g.windLP.type = 'lowpass'; g.windLP.frequency.value = 8000; g.windLP.connect(g.windG);
      g.riverG = gain(0, g.ambVol); g.rainG = gain(0, g.ambVol); g.cricG = gain(0, g.ambVol); g.hushG = gain(0, g.ambVol); g.treeG = gain(0, g.ambVol); g.oneG = gain(1, g.ambVol);
      const hlp = c.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 380; hlp.connect(g.hushG);
      g.srcs = [loop(BANK.loops.vinylA, g.vinyl), loop(BANK.loops.vinylB, g.vinyl, 1, 2.1), loop(BANK.loops.wind, g.windLP), loop(BANK.loops.river, g.riverG), loop(BANK.loops.rain, g.rainG), loop(BANK.loops.wind, hlp, 0.5, 5)];
      const cp = (p, rate, off) => { if (c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = p; pn.connect(g.cricG); g.srcs.push(loop(BANK.loops.crickets, pn, rate, off)); } else g.srcs.push(loop(BANK.loops.crickets, g.cricG, rate, off)); };
      cp(-0.45, 1, 0); cp(0.5, 0.93, 3.3);
      // tree hum: soft drone on the key's root + fifth, slowly beating
      g.treeLP = c.createBiquadFilter(); g.treeLP.type = 'lowpass'; g.treeLP.frequency.value = 420; g.treeLP.connect(g.treeG);
      g.hum = [[0, 0.5, 0], [0, 0.4, 0.13], [7, 0.3, 0], [12, 0.22, -0.08], [19, 0.08, 0.05]].map(([iv, a, dt]) => { const os = c.createOscillator(); os.frequency.value = mtof(36 + iv) + dt; const og = gain(a, g.treeLP); os.connect(og); os.start(0); return { os, iv, dt }; });
      g.trem.start(0);
      return g;
    }
    // ---- one note
    function note(inst, m, v, t, dur, to) {
      const p = pick(inst, m), s = ctx.createBufferSource(), gn = ctx.createGain();
      s.buffer = p.b; s.playbackRate.value = p.rate * (1 + 0.0025 * Math.sin(t * TAU * 0.45) + 0.0012 * Math.sin(t * TAU * 0.13));
      gn.gain.value = v; s.connect(gn); gn.connect(to);
      s.start(t);
      if (dur) { const end = Math.min(t + dur, t + p.b.duration / p.rate); gn.gain.setValueAtTime(v, end); gn.gain.linearRampToValueAtTime(0, end + 0.18); s.stop(end + 0.2); }
    }
    function oneShot(b, t, v, to, rate) { const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate || 1; gn.gain.value = v; s.connect(gn); gn.connect(to); s.start(t); }
    function pad(ms, t, dur, v, bus) {
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(v, t + Math.min(1.4, dur * 0.4)); gn.gain.setValueAtTime(v, t + dur); gn.gain.linearRampToValueAtTime(0, t + dur + 1.6); gn.connect(bus);
      for (const m of ms) for (const dc of [-7, 7]) { const os = ctx.createOscillator(); os.setPeriodicWave(G.wave); os.frequency.value = mtof(m + sec.key); os.detune.value = dc; os.connect(gn); os.start(t); os.stop(t + dur + 1.7); }
    }
    const spb = () => 60 / sec.bpm / 4;   // seconds per 16th
    function schedStep(t) {
      if (!sec || step % 128 === 0) { sec = compose(R, st.night, seaNow, secN++, forceTheme); forceTheme = null; step = 0; retune(t); }
      const dG = 1 - st.night, nG = st.night, sG = st.stage ? st.stage.g : 0, key = sec.key, sd = spb();
      const tt = t + (step % 2 ? sd * 0.2 : 0);   // swing (odd 16ths late)
      for (const e of sec.ev[step]) {
        if (e.L === 'd' && dG < 0.02) continue; if (e.L === 'n' && nG < 0.02) continue; if (e.L === 's' && sG < 0.01) continue;
        const hum = e.L === 'd' ? (R() - 0.5) * 0.012 : (R() - 0.5) * 0.02, at = Math.max(ctx.currentTime, tt + hum + (e.st ? e.st * 0.014 : 0));
        if (e.i === 'kick') oneShot(BANK.drums.kick, at, e.v, G.day);
        else if (e.i === 'brush') oneShot(BANK.drums.brush[step & 1], at, e.v, G.day);
        else if (e.i === 'shk') oneShot(BANK.drums.shk[Math.floor(R() * 3)], at, e.v * (0.8 + R() * 0.4), G.day);
        else if (e.i === 'pad') pad(e.ms, at, e.d * sd, e.v, e.L === 'n' ? G.padBusN : G.padBus);
        else {
          const inst = e.i === 'lead' ? SEA[sec.sea].lead : e.i;
          const to = e.L === 's' ? G.stageG : e.L === 'n' ? G.night : inst === 'rh' ? G.rh : G.day;
          note(inst, e.m + key, e.v * (inst === 'ce' ? 0.8 : inst === 'rh' && e.i === 'lead' ? 1.1 : 1), at, e.d * sd + 0.05, to);
        }
      }
      step++;
    }
    function retune(t) {   // key change: the tree hum follows the music's root
      if (!G) return; for (const h of G.hum) h.os.frequency.setTargetAtTime(mtof(36 + sec.key + h.iv) + h.dt, t, 2);
    }
    // ambience one-shots (birds / fireflies / hammering), scheduled with the music in pump()
    function ambShots(until) {
      const sw = st.sw, rainK = 1 - st.rain * 0.85, now = ctx.currentTime;
      const birdK = (1 - st.night) * (1 + st.dawn * 1.8) * (sw[0] * 1.4 + sw[1] * 1.0 + sw[2] * 0.6 + sw[3] * 0.15) * rainK;
      if (nextBird < now) nextBird = now + R() * 2;
      while (nextBird < until) {
        if (birdK > 0.04) {
          const pool = BANK.birds.filter(b => b.k !== 'dove' || (sw[3] < 0.5 && R() < 0.3)), b = pool[Math.floor(R() * pool.length)], pan = (R() * 2 - 1) * 0.8, gv = (0.1 + R() * 0.2) * Math.min(1.3, birdK), rate = 0.9 + R() * 0.2;
          birdAt(b.b, nextBird, gv, pan, rate);
          if (R() < 0.3) birdAt(b.b, nextBird + b.b.duration / rate + 0.5 + R(), gv * 0.6, -pan * 0.8, rate * (0.97 + R() * 0.06));   // an answer from the other side
        }
        nextBird += birdK > 0.04 ? (1.2 + R() * 5.5) / Math.min(2.5, birdK) : 3;
      }
      const tinkK = st.night * (sw[0] * 1 + sw[1] * 1.3 + sw[2] * 0.7) * rainK;
      if (nextTink < now) nextTink = now + R() * 3;
      while (nextTink < until) { if (tinkK > 0.05) birdAt(BANK.tinks[Math.floor(R() * BANK.tinks.length)], nextTink, (0.05 + R() * 0.07) * tinkK, (R() * 2 - 1) * 0.7, 0.95 + R() * 0.1); nextTink += (3 + R() * 7) / Math.max(0.3, tinkK); }
      const B = st.build;
      if (nextTok < now) nextTok = now + 0.2;
      while (nextTok < until) { if (B && B.g > 0.02) birdAt(BANK.toks[Math.floor(R() * 3)], nextTok, B.g * (0.6 + R() * 0.4), B.pan, 0.9 + R() * 0.2); nextTok += 0.45 + R() * 0.7 + (R() < 0.15 ? 1.2 : 0); }
    }
    function birdAt(b, t, v, pan, rate) {
      const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; gn.gain.value = v; s.connect(gn);
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); gn.connect(p); p.connect(G.oneG); } else gn.connect(G.oneG);
      s.start(Math.max(ctx.currentTime, t));
    }
    function pump(ahead) {
      if (!G) return;
      const until = ctx.currentTime + (ahead || 0.5);
      if (nextT < ctx.currentTime - 0.05) nextT = ctx.currentTime + 0.05;
      while (nextT < until) { schedStep(nextT); nextT += spb(); }
      ambShots(until);
    }
    // ---- parameters (from the game, ~4x a second): cheap ramps only
    function set(p, v, tc) { if (last[p.__id] !== undefined && Math.abs(last[p.__id] - v) < 0.003) return; p.setTargetAtTime(v, ctx.currentTime, tc || 0.6); last[p.__id] = v; }
    let pid = 0; const P = p => { if (p.__id === undefined) p.__id = pid++; return p; };
    function apply(tc) {
      if (!G) return;
      const sw = st.sw, n = st.night, rainK = st.rain;
      seaNow = sw.indexOf(Math.max(...sw));
      const lpF = SEA.reduce((a, s, k) => a + s.lp * sw[k], 0) * (1 - 0.35 * n) * (1 - 0.2 * rainK);
      set(P(G.lp.frequency), lpF, tc || 2);
      set(P(G.day.gain), clamp(1 - n, 0, 1), tc || 3); set(P(G.night.gain), clamp(n, 0, 1) * 0.72, tc || 3);   // night = softer than day
      const stG = st.stage ? st.stage.g : 0; set(P(G.stageG.gain), stG * 0.9, tc || 0.8); if (G.pan) set(P(G.pan.pan), st.stage ? st.stage.pan : 0, tc || 0.5);
      set(P(G.duck.gain), (1 - 0.45 * stG) * (ctx.currentTime < duckUntil ? 0.45 : 1) * (st.say ? 0.72 : 1), tc || 0.4);   // vibe 2 lane C: the tree's bubble open = the music steps back a little
      set(P(G.vinyl.gain), 0.1 * (1 + sw[2] * 0.6) * (sec && sec.kind === 'rest' ? 0.6 : 1), tc || 2);
      const high = clamp(st.camD / 600, 0, 1);
      set(P(G.windG.gain), (0.07 + 0.08 * high + 0.06 * sw[2] - 0.03 * sw[3]) * (1 + rainK * 0.5), tc || 2);
      set(P(G.windLP.frequency), 8000 - 6000 * sw[3], tc || 3);
      set(P(G.riverG.gain), 0.32 * st.river, tc || 1);
      set(P(G.rainG.gain), 0.38 * rainK, tc || 3);
      set(P(G.cricG.gain), 0.1 * n * (sw[0] * 0.7 + sw[1] * 1 + sw[2] * 0.6) * (1 - rainK * 0.7), tc || 3);
      set(P(G.hushG.gain), 0.35 * sw[3], tc || 3);
      set(P(G.treeG.gain), 0.16 * st.tree * (0.5 + 0.5 * clamp(st.health / 100, 0, 1)), tc || 1.2);
      set(P(G.master.gain), prefs.on ? prefs.master : 0, tc || 0.25);
      set(P(G.musicVol.gain), prefs.music, 0.1); set(P(G.ambVol.gain), prefs.amb, 0.1); set(P(G.sfxVol.gain), prefs.sfx, 0.1);
    }
    E.update = function (s, instant) {
      if (s) for (const k in s) st[k] = s[k];
      if (!G) return; apply(instant ? 0.01 : 0);
    };
    // ---- SFX
    let lastAt = {};
    E.sfx = function (name, opt) {
      if (!G || !ready || !prefs.on || hidden) return false;
      const b = BANK.sfx[name]; if (!b) return false; opt = opt || {};
      const now = ctx.currentTime; if (!opt.force && GAP[name] && lastAt[name] && now - lastAt[name] < GAP[name]) return false; lastAt[name] = now;
      let rate = opt.rate || 1; if (MUSICAL[name] && sec) rate *= Math.pow(2, clamp(sec.key, -3, 3) / 12);
      const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; gn.gain.value = opt.gain === undefined ? 1 : opt.gain; s.connect(gn);
      if (opt.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(opt.pan, -1, 1); gn.connect(p); p.connect(G.sfxVol); } else gn.connect(G.sfxVol);
      s.start(now + (opt.delay || 0));
      if (STING[name]) { duckUntil = now + STING[name]; set(P(G.duck.gain), 0.45, 0.15); setTimeout(() => apply(), STING[name] * 1000 + 50); }
      return true;
    };
    // positional: gain + pan from the camera (game passes cam + right in update)
    E.sfx3 = function (name, x, y, z, opt) {
      const c = st.cam, dx = x - c[0], dy = y - c[1], dz = z - c[2], d = Math.hypot(dx, dy, dz), g = Math.pow(clamp(1 - (d - 40) / 360, 0, 1), 1.3);
      if (g < 0.04) return false; const r = st.right, pan = d > 1 ? (dx * r[0] + dz * r[2]) / d * 0.8 : 0;
      return E.sfx(name, Object.assign({}, opt, { gain: g * (opt && opt.gain !== undefined ? opt.gain : 1), pan }));
    };
    // ---- life cycle
    E.start = async function () {   // called from a user gesture (or by render with an offline ctx)
      if (!ctx && !makeCtx()) return false;
      if (!offline && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      if (!offline) { try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {} }   // iOS unlock
      if (started) return true; started = true;
      await build(ctx); G = graph(); ready = true; nextT = ctx.currentTime + 0.1;
      apply(0.01);
      if (!offline) { timer = setInterval(() => { if (!hidden && ctx.state === 'running') pump(0.5); }, 120); pump(0.5); }
      return true;
    };
    E.setOn = function (on) {
      prefs.on = !!on; prefs.asked = true; savePrefs();
      if (on) { E.start(); if (ctx && ctx.state === 'suspended' && !hidden) ctx.resume(); }
      if (G) apply();
      if (!on && ctx && !offline) setTimeout(() => { if (!prefs.on && ctx.state === 'running') ctx.suspend(); }, 400);   // muted = no audio thread work at all
    };
    E.setVol = function (k, v) { prefs[k] = clamp(+v, 0, 1); savePrefs(); if (G) apply(); };
    E.setAsked = function () { prefs.asked = true; savePrefs(); };
    E.hide = function (h) {   // tab hidden: stop the audio thread; back: resume + restart the clock of the scheduler
      hidden = !!h; if (!ctx || offline) return;
      if (hidden) { if (ctx.state === 'running') ctx.suspend(); }
      else if (prefs.on && started) { ctx.resume().then(() => { nextT = ctx.currentTime + 0.1; }).catch(() => {}); }
    };
    E.pump = pump;
    E.theme = k => { forceTheme = k === undefined ? 0 : k; };   // vibe 2 lane C: the next section is a theme section (variation k; tests + renders)
    E.level = function () {   // analyser: current output peak / rms (dBFS), works in silent mode
      if (!G) return null; const a = new Float32Array(G.an.fftSize); G.an.getFloatTimeDomainData(a);
      let pk = 0, s = 0; for (const v of a) { pk = Math.max(pk, Math.abs(v)); s += v * v; } const rms = Math.sqrt(s / a.length);
      return { peak: pk, rms, peakDb: 20 * Math.log10(pk || 1e-9), rmsDb: 20 * Math.log10(rms || 1e-9), state: ctx.state };
    };
    E.info = () => ({ started, ready, on: prefs.on, hidden, state: ctx && ctx.state, sec: sec && { kind: sec.kind, sea: SEA[sec.sea].name, key: sec.key, bpm: sec.bpm, n: sec.n, bars: sec.bars.join(' ') }, buildMs: BANK && BANK.ms, silent });
    E.dispose = () => { clearInterval(timer); if (ctx && !offline) ctx.close(); };
    return E;
  }

  // ======================================================================= offline render (checks) + WAV
  async function render(o) {
    const sr = o.sr || 44100, sec = o.sec || 20, ctx = new OfflineAudioContext(2, Math.round(sec * sr), sr);
    const E = make({ ctx, prefs: Object.assign({ on: true, master: 0.8, music: 0.6, amb: 0.7, sfx: 0.8 }, o.prefs || {}), seed: o.seed || 7 });
    await E.start(); E.update(Object.assign({ night: 0, sw: [0, 0, 1, 0] }, o.state || {}), true); if (o.theme !== undefined) E.theme(o.theme);
    const t0 = performance.now();
    E.pump(sec);   // music + ambience for the whole length (prefs.music / amb = 0 leave a part out)
    // SFX: [[name, atSec, opt]] (the offline ctx's clock is 0 before rendering: delay = when)
    for (const [name, at, opt] of (o.sfx || [])) E.sfx(name, Object.assign({ delay: at, force: true }, opt || {}));
    const buf = await ctx.startRendering();
    return { buf, stats: stats(buf), ms: Math.round(performance.now() - t0), info: E.info() };
  }
  function stats(buf) {
    let pk = 0, s = 0, nan = 0, clip = 0, n = 0; const blocks = [], B = Math.round(buf.sampleRate * 0.5);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) { nan++; continue; } const a = Math.abs(v); if (a > pk) pk = a; if (a >= 0.999) clip++; s += v * v; n++; } }
    const d0 = buf.getChannelData(0); for (let i = 0; i + B <= d0.length; i += B) { let q = 0; for (let j = i; j < i + B; j++) q += d0[j] * d0[j]; blocks.push(20 * Math.log10(Math.sqrt(q / B) || 1e-9)); }
    const rms = Math.sqrt(s / Math.max(1, n));
    return { peakDb: +(20 * Math.log10(pk || 1e-9)).toFixed(1), rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1), nan, clip, silentBlocks: blocks.filter(x => x < -60).length, blocks: blocks.length, len: +(buf.length / buf.sampleRate).toFixed(2) };
  }
  function wav(buf, rate) {   // 16-bit PCM, optional downsample by an integer factor
    const ch = buf.numberOfChannels, f = rate ? Math.max(1, Math.round(buf.sampleRate / rate)) : 1, n = Math.floor(buf.length / f), sr = Math.round(buf.sampleRate / f);
    const ab = new ArrayBuffer(44 + n * ch * 2), v = new DataView(ab), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const D = []; for (let c = 0; c < ch; c++) D.push(buf.getChannelData(c));
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { let s = 0; for (let k = 0; k < f; k++) s += D[c][i * f + k]; s /= f; v.setInt16(o, clamp(Math.round(s * 32767), -32768, 32767), true); o += 2; }
    return ab;
  }

  // ======================================================================= UI: sound button, panel, "turn on sound?" chip
  const SVG = b => `<svg class="ic" viewBox="0 0 24 24" stroke="#2a2442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${b}</svg>`;
  const SPK = '<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z" fill="#ffd36a"/>';
  const ICON = { on: SVG(SPK + '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none"/>'), off: SVG(SPK + '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none"/>'),
    music: SVG('<path d="M9 17.5a2.8 2.8 0 1 1-1.8-2.6V5.5l10-2v11a2.8 2.8 0 1 1-1.8-2.6V7l-6.4 1.3z" fill="#ff9fd0"/>'), amb: SVG('<path d="M5 19C5 10 11 4.5 19.5 4.5 19.5 13 14 19 5 19z" fill="#7fd36a"/><path d="M5 19l8-8" fill="none"/>'),
    sfx: SVG('<circle cx="12" cy="12" r="4" fill="#9fe8ff"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3" fill="none"/>'), master: SVG(SPK + '<path d="M15.5 9a4 4 0 0 1 0 6" fill="none"/>') };
  const CARDS = ['expCard', 'evCard', 'needCard', 'plotCard', 'socCard', 'gift', 'book', 'safeCard', 'away', 'visPanel'];
  function ui(E, o) {
    o = o || {}; const $ = id => document.getElementById(id), app = $('app') || document.body;
    const btn = document.createElement('button'); btn.id = 'sndBtn'; btn.className = 'card'; btn.title = 'Sound'; app.appendChild(btn);
    const card = document.createElement('div'); card.id = 'sndCard'; card.className = 'card'; card.hidden = true; app.appendChild(card);
    const row = (k, label) => `<label class="sndr">${ICON[k]}<span>${label}</span><input type="range" min="0" max="100" step="1" data-k="${k}" value="${Math.round(E.prefs[k] * 100)}"></label>`;
    card.innerHTML = `<div class="pch"><span class="disp sndt">${ICON.on}Sound</span><button id="sndClose" title="Close">&#10005;</button></div>
      <label class="tog sndon"><input type="checkbox" id="sndOn"><i></i><b>Sound on</b></label>
      ${row('master', 'Volume')}${row('music', 'Lo-fi music')}${row('amb', 'Nature')}${row('sfx', 'Little sounds')}
      <p class="sub">Soft tunes follow your clock and the season; birds by day, crickets at night, rain when it showers. Sound pauses when you leave the tab.</p>`;
    const refresh = () => { btn.innerHTML = E.on ? ICON.on : ICON.off; btn.classList.toggle('off', !E.on); $('sndOn').checked = E.on; card.classList.toggle('muted', !E.on); };
    btn.onclick = () => { card.hidden = !card.hidden; };
    $('sndClose').onclick = () => { card.hidden = true; };
    $('sndOn').onchange = e => { E.setOn(e.target.checked); refresh(); if (ask) ask.remove(); };
    card.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if (k) E.setVol(k, e.target.value / 100); });
    card.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.k === 'sfx') E.sfx('tap'); });
    // first-time players: a gentle chip, sound stays off until they say yes
    let ask = null;
    if (!E.prefs.asked && !o.noAsk) {
      ask = document.createElement('div'); ask.id = 'sndAsk'; ask.className = 'card';
      ask.innerHTML = `${ICON.on}<span>Cozy sounds? <small>lo-fi music + nature</small></span><button class="big" data-a="1">Turn on</button><button class="ghost" data-a="0" title="Keep it quiet">Not now</button>`;
      app.appendChild(ask); setTimeout(() => ask && ask.classList.add('in'), o.askDelay || 1500);
      ask.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a === '1') E.setOn(true); else E.setAsked(); ask.remove(); ask = null; refresh(); };
    }
    refresh();
    // sound was on last time: start on the first gesture (browsers need one), iOS too
    const unlock = () => { if (E.on) E.start(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); removeEventListener('touchend', unlock, true); };
    if (E.on) { addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true); addEventListener('touchend', unlock, true); }
    // cozy clicks: every button tap (job buttons play their own "assign"), cards opening / closing
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button, .need, .icard, .qi, .pup'); if (!b || b.dataset.job || b.id === 'sndBtn' && !E.on) return; E.sfx('tap'); }, true);
    const seen = {};
    const mo = new MutationObserver(ms => { for (const m of ms) { const el = m.target, id = el.id; if (!CARDS.includes(id) && id !== 'sndCard') continue; const vis = !el.hidden; if (seen[id] === vis) continue; seen[id] = vis; E.sfx(vis ? 'open' : 'close'); } });
    const watch = () => { for (const id of CARDS.concat('sndCard')) { const el = $(id); if (el && !el.__sndW) { el.__sndW = 1; seen[id] = !el.hidden; mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); } } };
    watch(); setTimeout(watch, 4000);   // cloud_ui makes #safeCard later
    document.addEventListener('visibilitychange', () => E.hide(document.hidden));
    return { refresh, btn, card, watch, get ask() { return ask; } };
  }

  window.ElderSound = { make, render, stats, wav, build, compose, ui, SFX_NAMES: Object.keys(SFX), SEA, CH, THEME_A, THEME_B, THEME_PROG, SR, get BANK() { return BANK; } };
})();
