'use strict';
// ============================================================
//  LAST LIGHT — shared utilities (math, easing, noise, tracks)
// ============================================================
const W = 1920, H = 1080, FPS = 30, DUR = 60;
const TAU = Math.PI * 2;

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, v) => clamp((v - a) / (b - a));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const eio = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eio2 = (t) => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const eout = (t) => 1 - Math.pow(1 - clamp(t), 3);
const eout4 = (t) => 1 - Math.pow(1 - clamp(t), 4);
const eout5 = (t) => 1 - Math.pow(1 - clamp(t), 5);
const ein = (t) => Math.pow(clamp(t), 3);
const ein2 = (t) => Math.pow(clamp(t), 2);
const eback = (t) => { t = clamp(t); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const eelastic = (t) => { t = clamp(t); if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1; };
const pulse = (t, t0, att, dec) => (t < t0 ? Math.exp(-Math.pow((t - t0) / Math.max(att, 1e-4), 2) * 4) * (t > t0 - att ? 1 : 0) : Math.exp(-(t - t0) / dec));
const bump = (t, a, b, c, d) => smooth(inv(a, b, t)) * (1 - smooth(inv(c, d, t)));
const EASES = { io: eio, io2: eio2, o: eout, o4: eout4, o5: eout5, i: ein, i2: ein2, l: (x) => clamp(x), s: smooth, b: eback, e: eelastic, h: () => 0 };

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// keyframe track: keys = [[t, value(s)..., easeName?], ...]; ease applies to the segment ENDING at that key
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1).filter((v) => typeof v === 'number');
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last.slice(1).filter((v) => typeof v === 'number');
  let i = 1; while (keys[i][0] < t) i++;
  const a = keys[i - 1], b = keys[i];
  const e = typeof b[b.length - 1] === 'string' ? EASES[b[b.length - 1]] : eio;
  const u = e((t - a[0]) / (b[0] - a[0]));
  const out = [];
  for (let k = 1; k < b.length; k++) if (typeof b[k] === 'number') out.push(a[k] + (b[k] - a[k]) * u);
  return out;
}
const track1 = (keys, t) => track(keys, t)[0];

// ---------- colour
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------- simplex noise 2D
function makeNoise(seed) {
  const r = rng(seed); const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const tmp = p[i]; p[i] = p[j]; p[j] = tmp; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1; if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { const gi = pm12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { const gi = pm12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { const gi = pm12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2 = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  };
}
const N1 = makeNoise(11), N2 = makeNoise(23), N3 = makeNoise(37), N4 = makeNoise(51);
function fbm(n, x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return s / norm;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  return [c, x];
}
