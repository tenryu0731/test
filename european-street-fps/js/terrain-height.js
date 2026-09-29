// Terrain height field for the San Gimignano countryside (terrain agent).
// Builds a 2 m grid over ±768 m (the 1.4 km map plus a scenery band) and a 16 m grid over
// ±2048 m for the far hills, honouring layout.js: town plateau, flat site pads, graded roads,
// lake basin and river channel. heightAt() is a bilinear lookup (fast enough for physics/AI).
import { TOWN, SITES, LAKE, RIVER, ROADS, MAP_HALF } from './layout.js';

export const FINE = { half: 768, step: 2 };
FINE.n = FINE.half * 2 / FINE.step + 1;          // 769 samples per axis
export const COARSE = { half: 2048, step: 16 };
COARSE.n = COARSE.half * 2 / COARSE.step + 1;    // 257

export const RIVER_HALF_W = RIVER.width / 2;
export const RIVER_DEPTH = 1.2;                   // water surface = bed + depth
const PLATEAU_Y = TOWN.y - 0.25;

// ------------------------------------------------------------------ noise
export function hash2i(ix, iz, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const rand2 = (ix, iz, seed) => hash2i(ix, iz, seed) / 4294967296;
const GX = new Float32Array(16), GZ = new Float32Array(16);
for (let i = 0; i < 16; i++) { GX[i] = Math.cos(i * Math.PI / 8 + 0.2); GZ[i] = Math.sin(i * Math.PI / 8 + 0.2); }

const PERM = new Uint8Array(512);
{
  const a = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = hash2i(i, 7, 1234) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = a[i & 255];
}
// 2D gradient noise (permutation table, period 256), range ≈ [-1, 1].
export function perlin(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const X = (ix + seed * 37) & 255, Z = (iz + seed * 11) & 255, X1 = (X + 1) & 255;
  const pa = PERM[X], pb = PERM[X1];
  const a = PERM[pa + Z] & 15, b = PERM[pb + Z] & 15, c = PERM[pa + Z + 1] & 15, d = PERM[pb + Z + 1] & 15;
  const na = GX[a] * fx + GZ[a] * fz, nb = GX[b] * (fx - 1) + GZ[b] * fz;
  const nc = GX[c] * fx + GZ[c] * (fz - 1), nd = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const x1 = na + (nb - na) * u, x2 = nc + (nd - nc) * u;
  return (x1 + (x2 - x1) * v) * 1.45;
}
// hashed variant (no period), used for rare lookups
export function perlinH(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2i(ix, iz, seed) & 15, b = hash2i(ix + 1, iz, seed) & 15;
  const c = hash2i(ix, iz + 1, seed) & 15, d = hash2i(ix + 1, iz + 1, seed) & 15;
  const na = GX[a] * fx + GZ[a] * fz, nb = GX[b] * (fx - 1) + GZ[b] * fz;
  const nc = GX[c] * fx + GZ[c] * (fz - 1), nd = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const x1 = na + (nb - na) * u, x2 = nc + (nd - nc) * u;
  return (x1 + (x2 - x1) * v) * 1.45;
}
export function fbm(x, z, oct, seed) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += perlin(x, z, seed + o * 17) * a; n += a;
    const t = x * 1.6 - z * 1.2; z = x * 1.2 + z * 1.6; x = t; // rotate + scale ×2
    a *= 0.5;
  }
  return s / n;
}

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function distToRect(x, z, r) {
  const dx = Math.max(r[0] - x, 0, x - r[1]), dz = Math.max(r[2] - z, 0, z - r[3]);
  return Math.sqrt(dx * dx + dz * dz);
}

// ------------------------------------------------------------------ curves
// Centripetal Catmull-Rom through 2D/3D control points, resampled every `step` metres.
export function sampleCurve(pts, step) {
  const P = pts.map((p) => p.slice());
  const n = P.length;
  const ext = (a, b) => a.map((v, i) => 2 * v - b[i]);
  const C = [ext(P[0], P[1]), ...P, ext(P[n - 1], P[n - 2])];
  const out = [];
  for (let i = 1; i < C.length - 2; i++) {
    const p0 = C[i - 1], p1 = C[i], p2 = C[i + 1], p3 = C[i + 2];
    const d = (a, b) => Math.max(1e-3, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < m; k++) {
      const t = t1 + (t2 - t1) * (k / m);
      const q = [];
      for (let c = 0; c < p1.length; c++) {
        const A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c];
        const A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
        const A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        q.push((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2);
      }
      out.push(q);
    }
  }
  out.push(P[n - 1].slice());
  // cumulative arc length
  const s = new Float32Array(out.length);
  for (let i = 1; i < out.length; i++) s[i] = s[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  return { pts: out, s };
}

// ------------------------------------------------------------------ landform design
// Gaussian hills solved so the natural ground passes through these heights (pads then refine).
const CONTROLS = [
  // x, z, target, radius
  ...SITES.map((s) => {
    const t = {
      pieve: [5, 150], rocca: [49, 190], abbey: [14, 170], villa: [-7, 130], mill: [-33, 85],
      'farm-w': [-17, 110], 'farm-e': [-20, 110], 'farm-n': [4, 140], chapel: [35, 130],
      watchtower: [39, 150], quarry: [4, 115],
    }[s.id] || [s.y, 120];
    return [s.x, s.z, t[0], t[1]];
  }),
  [LAKE.x, LAKE.z, LAKE.y + 2, 140],
  [0, -300, -15, 100],     // ridge north of the town (north road)
  [25, 310, -21, 95],      // southern spur (south road)
  [240, 20, -14, 80],      // eastern spur
  [-240, 0, -13, 85],      // western saddle
  [175, 190, -34, 80],     // hollows around the town hill
  [-190, 200, -30, 80],
  [-170, -230, -26, 80],
  [170, -220, -28, 80],
  [310, -250, 12, 170],    // hills north-east
  [-300, -250, 10, 150],   // hills north-west
  [-600, 350, 18, 170],    // south-west hill beyond the pieve
  [600, -120, 28, 170],    // east ridge behind the chapel
  [-40, -620, 16, 140],    // north hill between farm and quarry
  [220, 330, -24, 110],    // valley bowl between the south road and the villa
];
const TOWN_R = 115;

function edgeRise(x, z) {
  // Rounded-square radius; far hills rise beyond the map so the horizon has depth.
  const ax = Math.abs(x), az = Math.abs(z);
  const r = Math.pow(Math.pow(ax, 6) + Math.pow(az, 6), 1 / 6);
  return 22 * smooth(430, 760, r) + 75 * smooth(760, 1650, r);
}

// Base natural ground (no roads/pads/water), identical for fine and coarse grids.
function makeBase() {
  const base0 = (x, z) => {
    // gentle domain warp keeps the hills from looking like blobs
    const wx = x + 60 * perlin(x / 700 + 5.2, z / 700, 3), wz = z + 60 * perlin(x / 700, z / 700 + 9.1, 4);
    let h = -34 + edgeRise(x, z);
    h += 12 * fbm(wx / 430 + 3.1, wz / 430 - 1.7, 3, 11);
    h += 6 * fbm(wx / 170, wz / 170, 3, 29);
    const far = smooth(650, 1200, Math.max(Math.abs(x), Math.abs(z)));
    if (far > 0) h += far * 30 * fbm(x / 520 + 7, z / 520 + 3, 4, 51);
    return h;
  };
  const detail = (x, z) => 1.4 * fbm(x / 46, z / 46, 3, 37);
  // Solve Gaussian amplitudes: H(c_j) = target_j.
  const C = [[0, 0, PLATEAU_Y, TOWN_R, true], ...CONTROLS];
  const g = (ci, x, z) => {
    const c = C[ci];
    const d = c[4] ? distToRect(x, z, TOWN.rect) : Math.hypot(x - c[0], z - c[1]);
    return Math.exp(-(d / c[3]) * (d / c[3]));
  };
  const n = C.length, M = [], rhs = [];
  for (let j = 0; j < n; j++) {
    M.push(C.map((_, i) => g(i, C[j][0], C[j][1])));
    rhs.push(C[j][2] - base0(C[j][0], C[j][1]) - detail(C[j][0], C[j][1]));
  }
  const amp = solve(M, rhs);
  const bumps = C.map((c, i) => ({ c, a: amp[i], rr: c[3] * 3 }));
  return { base0, detail, bumps, g, C };
}

function fillDirect(H, n, o, st, B) {
  for (let j = 0; j < n; j++) {
    const z = o + j * st;
    for (let i = 0; i < n; i++) H[j * n + i] = B.base0(o + i * st, z);
  }
  B.bumps.forEach((bp, ci) => {
    const c = bp.c;
    let x0, x1, z0, z1;
    if (c[4]) { x0 = TOWN.rect[0] - bp.rr; x1 = TOWN.rect[1] + bp.rr; z0 = TOWN.rect[2] - bp.rr; z1 = TOWN.rect[3] + bp.rr; }
    else { x0 = c[0] - bp.rr; x1 = c[0] + bp.rr; z0 = c[1] - bp.rr; z1 = c[1] + bp.rr; }
    const i0 = Math.max(0, Math.floor((x0 - o) / st)), i1 = Math.min(n - 1, Math.ceil((x1 - o) / st));
    const j0 = Math.max(0, Math.floor((z0 - o) / st)), j1 = Math.min(n - 1, Math.ceil((z1 - o) / st));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) H[j * n + i] += bp.a * B.g(ci, o + i * st, o + j * st);
  });
}

// Fill grid H (n×n, origin o, spacing st) with base + bumps (+ detail on fine grids). Fine grids
// evaluate the smooth part on an 8 m helper grid and upsample it bicubically (C1, no creases).
function fillBase(H, n, o, st, B, detail) {
  if (!detail) { fillDirect(H, n, o, st, B); return; }
  const hs = 8, ho = o - 2 * hs, hn = Math.ceil(((n - 1) * st + 4 * hs) / hs) + 1;
  const G = new Float32Array(hn * hn);
  fillDirect(G, hn, ho, hs, B);
  const r = st / hs;
  for (let j = 0; j < n; j++) {
    const fz = (o + j * st - ho) / hs, jz = Math.floor(fz), tz = fz - jz;
    const wz0 = cr0(tz), wz1 = cr1(tz), wz2 = cr2(tz), wz3 = cr3(tz);
    const z = o + j * st;
    for (let i = 0; i < n; i++) {
      const fx = (o + i * st - ho) / hs, ix = Math.floor(fx), tx = fx - ix;
      const wx0 = cr0(tx), wx1 = cr1(tx), wx2 = cr2(tx), wx3 = cr3(tx);
      let v = 0;
      for (let q = -1; q <= 2; q++) {
        const k = (jz + q) * hn + ix;
        const row = G[k - 1] * wx0 + G[k] * wx1 + G[k + 1] * wx2 + G[k + 2] * wx3;
        v += row * (q === -1 ? wz0 : q === 0 ? wz1 : q === 1 ? wz2 : wz3);
      }
      H[j * n + i] = v + B.detail(o + i * st, z);
    }
  }
  void r;
}
const cr0 = (t) => ((-t + 2) * t - 1) * t * 0.5;
const cr1 = (t) => ((3 * t - 5) * t * t + 2) * 0.5;
const cr2 = (t) => ((-3 * t + 4) * t + 1) * t * 0.5;
const cr3 = (t) => ((t - 1) * t * t) * 0.5;

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// ------------------------------------------------------------------ river geometry
export function buildRiver() {
  const pts = RIVER.points.map((p) => [p[0], p[1], p[2]]);
  const n = pts.length;
  const extend = (a, b, len) => {
    const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz), slope = (a[2] - b[2]) / l;
    return [a[0] + dx / l * len, a[1] + dz / l * len, a[2] + slope * len];
  };
  const P = [extend(pts[0], pts[1], 700), ...pts, extend(pts[n - 1], pts[n - 2], 700)];
  const smoothC = sampleCurve(P, 10);
  const fine = sampleCurve(P, 3);
  // Meander (zero around the mill bridge so the crossing stays where layout.js says).
  const mill = SITES.find((s) => s.id === 'mill');
  let sMill = 0, best = 1e9;
  fine.pts.forEach((p, i) => { const d = Math.hypot(p[0] - mill.x, p[1] - mill.z); if (d < best) { best = d; sMill = fine.s[i]; } });
  const m = fine.pts.length;
  const X = new Float32Array(m), Z = new Float32Array(m), W = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const a = fine.pts[Math.max(0, i - 1)], b = fine.pts[Math.min(m - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const s = fine.s[i];
    const env = smooth(25, 90, Math.abs(s - sMill));
    const off = env * (7 * Math.sin(s / 170 * Math.PI * 2 + 0.7) + 3 * Math.sin(s / 61 + 2.1));
    X[i] = fine.pts[i][0] - tz * off; Z[i] = fine.pts[i][1] + tx * off;
    W[i] = fine.pts[i][2] + RIVER_DEPTH; // water surface
  }
  // make water level monotonic (never flows uphill)
  for (let i = 1; i < m; i++) W[i] = Math.min(W[i], W[i - 1] - 0.001);
  const S = new Float32Array(m);
  for (let i = 1; i < m; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  return { smooth: smoothC, X, Z, W, S, halfW: RIVER_HALF_W };
}

// ------------------------------------------------------------------ main build
export function buildHeightfield() {
  const T = { t0: performance.now() };
  const B = makeBase();
  const { n, step: st, half } = FINE, o = -half;
  const H = new Float32Array(n * n);
  fillBase(H, n, o, st, B, true);
  T.base = performance.now();

  // Coarse far grid (16 m) of the same base.
  const cn = COARSE.n, co = -COARSE.half, cs = COARSE.step;
  const HC = new Float32Array(cn * cn);
  fillBase(HC, cn, co, cs, B, false);

  const river = buildRiver();
  // River valley on both grids (distance to the smoothed river line on an 8 m helper grid).
  carveValley(H, n, o, st, river);
  carveValley(HC, cn, co, cs, river, true);
  T.valley = performance.now();

  // Site pads and town plateau (soft).
  applyPads(H, n, o, st, false);
  applyPads(HC, cn, co, cs, false);
  T.pads = performance.now();

  lakeBowl(H, n, o, st);
  lakeBowl(HC, cn, co, cs);
  // Roads: graded profiles, then cut/fill stamping.
  const sampler = (x, z) => bilinear(H, n, o, st, x, z);
  const roads = gradeRoads(sampler);
  stampRoads(H, n, o, st, roads);
  T.roads = performance.now();

  // Lake and river channel.
  carveLake(H, n, o, st);
  carveLake(HC, cn, co, cs);
  const chan = carveChannel(H, n, o, st, river);
  carveChannelCoarse(HC, cn, co, cs, river);
  // Hard pads/plateau (except where the river channel passes, i.e. the mill).
  applyPads(H, n, o, st, true, chan);
  T.water = performance.now();

  // Blend the fine border into the coarse grid so both meet exactly.
  for (let j = 0; j < n; j++) {
    const z = o + j * st;
    for (let i = 0; i < n; i++) {
      const x = o + i * st, r = Math.max(Math.abs(x), Math.abs(z));
      if (r < 712) continue;
      const w = smooth(712, half - 2, r);
      H[j * n + i] += (bilinear(HC, cn, co, cs, x, z) - H[j * n + i]) * w;
    }
  }
  // Coarse cells inside the fine area take the fine values (for LOD / far rendering continuity).
  for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) {
    const x = co + i * cs, z = co + j * cs;
    if (Math.abs(x) <= half && Math.abs(z) <= half) HC[j * cn + i] = bilinear(H, n, o, st, x, z);
  }
  T.done = performance.now();

  const heightAt = makeSampler(H, HC);
  return { H, HC, heightAt, roads, river, chanDist: chan, timings: T };
}

export function bilinear(H, n, o, st, x, z) {
  let fx = (x - o) / st, fz = (z - o) / st;
  if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001;
  if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * n + ix;
  const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

function makeSampler(H, HC) {
  const n = FINE.n, inv = 1 / FINE.step, o = FINE.half, lim = n - 1.001;
  const cn = COARSE.n, cinv = 1 / COARSE.step, co = COARSE.half, clim = cn - 1.001;
  return function heightAt(x, z) {
    let fx = (x + o) * inv, fz = (z + o) * inv;
    if (fx >= 0 && fz >= 0 && fx <= lim && fz <= lim) {
      const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * n + ix;
      const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }
    fx = (x + co) * cinv; fz = (z + co) * cinv;
    fx = fx < 0 ? 0 : fx > clim ? clim : fx; fz = fz < 0 ? 0 : fz > clim ? clim : fz;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * cn + ix;
    const a = HC[k], b = HC[k + 1], c = HC[k + cn], d = HC[k + cn + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

// Distance from p to polyline (X,Z arrays), returns {d, i, t} (segment index + param).
function nearestOnPolyline(X, Z, x, z, out) {
  let best = 1e18, bi = 0, bt = 0;
  for (let i = 0; i < X.length - 1; i++) {
    const ax = X[i], az = Z[i], vx = X[i + 1] - ax, vz = Z[i + 1] - az;
    let t = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - vx * t, dz = z - az - vz * t, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; bt = t; }
  }
  out.d = Math.sqrt(best); out.i = bi; out.t = bt;
  return out;
}

function carveValley(H, n, o, st, river, skipInside) {
  const sm = river.smooth, sp = sm.pts.filter((_, i) => i % 4 === 0 || i === sm.pts.length - 1);
  const X = Float32Array.from(sp, (p) => p[0]), Z = Float32Array.from(sp, (p) => p[1]);
  const Y = Float32Array.from(sp, (p) => p[2] + RIVER_DEPTH);
  // helper grid 8 m (or the grid itself if coarser)
  const hs = Math.max(8, st), hn = Math.ceil((n - 1) * st / hs) + 1;
  const D = new Float32Array(hn * hn), WL = new Float32Array(hn * hn);
  const q = {};
  // coarse pre-filter: only segments whose bbox is near
  for (let j = 0; j < hn; j++) for (let i = 0; i < hn; i++) {
    const x = o + i * hs, z = o + j * hs;
    if (skipInside && Math.abs(x) < FINE.half - 24 && Math.abs(z) < FINE.half - 24) { D[j * hn + i] = 1e9; continue; }
    nearestOnPolyline(X, Z, x, z, q);
    D[j * hn + i] = q.d;
    WL[j * hn + i] = Y[q.i] + (Y[q.i + 1] - Y[q.i]) * q.t;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = o + i * st, z = o + j * st;
    const d = hs === st ? D[j * n + i] : bilinear(D, hn, o, hs, x, z);
    if (d > 420) continue;
    const wl = bilinear(WL, hn, o, hs, x, z);
    const e = Math.max(0, d - 22);
    const v = wl + 1.3 + 0.11 * e + 0.00055 * e * e;
    const k = j * n + i;
    if (H[k] > v) H[k] = v + (H[k] - v) * smooth(160, 420, d);
  }
}

function applyPads(H, n, o, st, hard, chan) {
  const [rx0, rx1, rz0, rz1] = TOWN.rect, pm = TOWN.plateauMargin;
  // town plateau
  {
    const R = pm + 70;
    const i0 = Math.max(0, Math.floor((rx0 - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((rx1 + R - o) / st));
    const j0 = Math.max(0, Math.floor((rz0 - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((rz1 + R - o) / st));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = o + i * st, z = o + j * st, k = j * n + i;
      const d = distToRect(x, z, TOWN.rect);
      if (hard) { if (d <= pm) H[k] = PLATEAU_Y; continue; }
      if (d <= pm) { H[k] = PLATEAU_Y; continue; }
      const bw = clamp(Math.abs(H[k] - PLATEAU_Y) * 0.9, 6, 60);
      const w = 1 - smooth(pm, pm + bw, d);
      H[k] += (PLATEAU_Y - H[k]) * w;
    }
  }
  for (const s of SITES) {
    const R = s.r + 95;
    const i0 = Math.max(0, Math.floor((s.x - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((s.x + R - o) / st));
    const j0 = Math.max(0, Math.floor((s.z - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((s.z + R - o) / st));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = o + i * st, z = o + j * st, k = j * n + i;
      const d = Math.hypot(x - s.x, z - s.z);
      if (hard) {
        if (d <= s.r + 0.5 && !(chan && chan[k] < RIVER_HALF_W + 3)) H[k] = s.y;
        continue;
      }
      if (d <= s.r) { H[k] = s.y; continue; }
      const bw = clamp(Math.abs(H[k] - s.y) * 2.2, 24, 90);
      let w = 1 - smooth(s.r, s.r + bw, d); w = w * w * (3 - 2 * w);
      H[k] += (s.y - H[k]) * w;
    }
  }
}

// ------------------------------------------------------------------ roads
function gradeRoads(heightAt) {
  const MAXG = 0.12;
  const done = [];
  for (const r of ROADS) {
    const P = r.points.map((p) => p.slice());
    // extend roads that leave the map
    const last = P[P.length - 1], prev = P[P.length - 2];
    if (Math.max(Math.abs(last[0]), Math.abs(last[1])) >= MAP_HALF - 10) {
      const dx = last[0] - prev[0], dz = last[1] - prev[1], l = Math.hypot(dx, dz);
      P.push([last[0] + dx / l * 80, last[1] + dz / l * 80]);
    }
    const c = sampleCurve(P, 3);
    const m = c.pts.length;
    const X = new Float32Array(m), Z = new Float32Array(m), h0 = new Float32Array(m);
    for (let i = 0; i < m; i++) { X[i] = c.pts[i][0]; Z[i] = c.pts[i][1]; h0[i] = heightAt(X[i], Z[i]); }
    // smooth natural profile (σ ≈ 24 m)
    const hs = gauss1d(h0, c.s, 24);
    // pins
    const pin = new Float32Array(m).fill(NaN);
    for (let i = 0; i < m; i++) {
      const x = X[i], z = Z[i];
      if (distToRect(x, z, TOWN.rect) <= TOWN.plateauMargin) pin[i] = PLATEAU_Y;
      for (const s of SITES) if (Math.hypot(x - s.x, z - s.z) <= s.r - 0.5) pin[i] = s.y;
    }
    // junction with an earlier road
    for (const q of done) {
      const o = nearestOnPolyline(q.X, q.Z, X[0], Z[0], {});
      if (o.d < 2) pin[0] = q.H[o.i] + (q.H[o.i + 1] - q.H[o.i]) * o.t;
    }
    // grade-limited fit between pins
    const Hh = Float32Array.from(hs);
    const pins = [];
    for (let i = 0; i < m; i++) if (!Number.isNaN(pin[i])) { Hh[i] = pin[i]; pins.push(i); }
    // per-section max grade (steeper only where pins demand it)
    const G = new Float32Array(m).fill(MAXG);
    for (let k = 0; k < pins.length - 1; k++) {
      const a = pins[k], b = pins[k + 1];
      if (b - a < 2) continue;
      const need = Math.abs(pin[b] - pin[a]) / (c.s[b] - c.s[a]) + 0.004;
      if (need > MAXG) for (let i = a; i <= b; i++) G[i] = need;
    }
    const limit = (Hh) => { for (let it = 0; it < 4; it++) {
      for (let i = 1; i < m; i++) {
        if (!Number.isNaN(pin[i])) continue;
        const ds = c.s[i] - c.s[i - 1], g = G[i] * ds;
        Hh[i] = clamp(Hh[i], Hh[i - 1] - g, Hh[i - 1] + g);
      }
      for (let i = m - 2; i >= 0; i--) {
        if (!Number.isNaN(pin[i])) continue;
        const ds = c.s[i + 1] - c.s[i], g = G[i] * ds;
        Hh[i] = clamp(Hh[i], Hh[i + 1] - g, Hh[i + 1] + g);
      }
    } };
    for (let i = 0; i < m; i++) G[i] *= 0.95;
    limit(Hh);
    // round vertical curves, keep pins, re-limit
    const Hs = gauss1d(Hh, c.s, 8);
    for (let i = 0; i < m; i++) { if (!Number.isNaN(pin[i])) Hs[i] = pin[i]; G[i] /= 0.95; }
    limit(Hs);
    let maxGrade = 0;
    for (let i = 1; i < m; i++) maxGrade = Math.max(maxGrade, Math.abs(Hs[i] - Hs[i - 1]) / (c.s[i] - c.s[i - 1]));
    const road = { id: r.id, width: r.width, hw: r.width / 2, X, Z, H: Hs, S: c.s, maxGrade };
    done.push(road);
  }
  return done;
}

function gauss1d(v, s, sigma) {
  const m = v.length, out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let sw = 0, sv = 0;
    for (let k = i; k >= 0 && s[i] - s[k] < sigma * 2.5; k--) { const d = (s[i] - s[k]) / sigma, w = Math.exp(-0.5 * d * d); sw += w; sv += v[k] * w; }
    for (let k = i + 1; k < m && s[k] - s[i] < sigma * 2.5; k++) { const d = (s[k] - s[i]) / sigma, w = Math.exp(-0.5 * d * d); sw += w; sv += v[k] * w; }
    out[i] = sv / sw;
  }
  return out;
}

// Per-road nearest-distance stamping with cut/fill banks; earlier road surfaces are protected.
function stampRoads(H, n, o, st, roads) {
  const R = 70;
  const D = new Float32Array(n * n).fill(1e9), RH = new Float32Array(n * n);
  const lock = new Float32Array(n * n);
  for (const r of roads) {
    const m = r.X.length;
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (let i = 0; i < m; i++) { bx0 = Math.min(bx0, r.X[i]); bx1 = Math.max(bx1, r.X[i]); bz0 = Math.min(bz0, r.Z[i]); bz1 = Math.max(bz1, r.Z[i]); }
    const I0 = Math.max(0, Math.floor((bx0 - R - o) / st)), I1 = Math.min(n - 1, Math.ceil((bx1 + R - o) / st));
    const J0 = Math.max(0, Math.floor((bz0 - R - o) / st)), J1 = Math.min(n - 1, Math.ceil((bz1 + R - o) / st));
    for (let j = J0; j <= J1; j++) D.fill(1e9, j * n + I0, j * n + I1 + 1);
    // segments of ~6 m
    const stride = 2;
    for (let a = 0; a < m - 1; a += stride) {
      const b = Math.min(m - 1, a + stride);
      const ax = r.X[a], az = r.Z[a], vx = r.X[b] - ax, vz = r.Z[b] - az, vv = vx * vx + vz * vz || 1;
      const ha = r.H[a], hb = r.H[b];
      const i0 = Math.max(I0, Math.floor((Math.min(ax, ax + vx) - R - o) / st)), i1 = Math.min(I1, Math.ceil((Math.max(ax, ax + vx) + R - o) / st));
      const j0 = Math.max(J0, Math.floor((Math.min(az, az + vz) - R - o) / st)), j1 = Math.min(J1, Math.ceil((Math.max(az, az + vz) + R - o) / st));
      for (let j = j0; j <= j1; j++) {
        const z = o + j * st;
        for (let i = i0; i <= i1; i++) {
          const x = o + i * st;
          let t = ((x - ax) * vx + (z - az) * vz) / vv; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - ax - vx * t, dz = z - az - vz * t, d = Math.sqrt(dx * dx + dz * dz);
          const k = j * n + i;
          if (d < D[k]) { D[k] = d; RH[k] = ha + (hb - ha) * t; }
        }
      }
    }
    const hw = r.hw;
    for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) {
      const k = j * n + i, d = D[k];
      if (d >= R) continue;
      const h0 = H[k], rh = RH[k], dh = h0 - rh;
      // wide softening (roads follow spurs and valleys), then cut/fill bank
      const hs = h0 - dh * 0.7 * (1 - smooth(hw + 2, R, d));
      const bank = clamp(Math.abs(hs - rh) * 1.8, 1.5, 30);
      const w = 1 - smooth(hw + 0.8, hw + 0.8 + bank, d);
      const hn = hs + (rh - hs) * w;
      const L = lock[k];
      H[k] = hn + (h0 - hn) * L;
      const lw = 1 - smooth(hw + 0.6, hw + 1.6, d);
      if (lw > L) lock[k] = lw;
    }
  }
}

// ------------------------------------------------------------------ water
export function lakeRadiusAt(ang) {
  return LAKE.r + 3.5 * Math.sin(ang * 3 + 0.8) + 2.2 * Math.sin(ang * 5 + 2.1) + 1.2 * Math.sin(ang * 9);
}

// Gentle basin around the lake (before the roads are graded, so they follow it).
function lakeBowl(H, n, o, st) {
  const R = LAKE.r + 170;
  const i0 = Math.max(0, Math.floor((LAKE.x - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((LAKE.x + R - o) / st));
  const j0 = Math.max(0, Math.floor((LAKE.z - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((LAKE.z + R - o) / st));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = o + i * st, z = o + j * st, k = j * n + i;
    const e = Math.max(0, Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r);
    const v = LAKE.y + 0.8 + 0.1 * e + 0.0012 * e * e;
    if (H[k] > v) H[k] = v + (H[k] - v) * smooth(90, 170, e);
  }
}

function carveLake(H, n, o, st) {
  const R = LAKE.r + 60;
  const i0 = Math.max(0, Math.floor((LAKE.x - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((LAKE.x + R - o) / st));
  const j0 = Math.max(0, Math.floor((LAKE.z - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((LAKE.z + R - o) / st));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = o + i * st, z = o + j * st, k = j * n + i;
    const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz);
    const rr = lakeRadiusAt(Math.atan2(dz, dx));
    if (d < rr) {
      const u = d / rr;
      const bed = LAKE.y - 0.25 - 4.2 * (1 - u * u) * smooth(0, 0.5, 1 - u) - 0.4 * (1 - u);
      H[k] = Math.min(H[k], bed);
    } else {
      const e = d - rr;
      const shore = LAKE.y - 0.25 + 1.0 * smooth(0, 5, e) + 0.03 * e;
      if (e < 5) H[k] = Math.min(H[k], shore);
      H[k] = Math.max(H[k], shore + (e < 5 ? -0.001 : 0.25 * smooth(5, 12, e)));
    }
  }
}

function carveChannel(H, n, o, st, river) {
  const { X, Z, W } = river, hw = RIVER_HALF_W, R = 28;
  const D = new Float32Array(n * n).fill(1e9), WL = new Float32Array(n * n);
  const m = X.length;
  for (let a = 0; a < m - 1; a += 2) {
    const b = Math.min(m - 1, a + 2);
    const ax = X[a], az = Z[a], vx = X[b] - ax, vz = Z[b] - az, vv = vx * vx + vz * vz || 1;
    const wa = W[a], wb = W[b];
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + vx) - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, ax + vx) + R - o) / st));
    const j0 = Math.max(0, Math.floor((Math.min(az, az + vz) - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, az + vz) + R - o) / st));
    if (i0 > i1 || j0 > j1) continue;
    for (let j = j0; j <= j1; j++) {
      const z = o + j * st;
      for (let i = i0; i <= i1; i++) {
        const x = o + i * st;
        let t = ((x - ax) * vx + (z - az) * vz) / vv; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - ax - vx * t, dz = z - az - vz * t, d = Math.sqrt(dx * dx + dz * dz), k = j * n + i;
        if (d < D[k]) { D[k] = d; WL[k] = wa + (wb - wa) * t; }
      }
    }
  }
  for (let k = 0; k < n * n; k++) {
    const d = D[k];
    if (d >= R) continue;
    const wl = WL[k];
    if (d < hw) {
      const u = d / hw;
      H[k] = Math.min(H[k], wl - RIVER_DEPTH + RIVER_DEPTH * 0.9 * u * u);
    } else if (d < hw + 2.5) {
      const bank = wl - 0.12 + 1.0 * smooth(hw, hw + 2.5, d);
      H[k] = Math.min(H[k], bank);
    } else {
      // keep the banks above the water so the water ribbon never shows outside the channel
      H[k] = Math.max(H[k], wl + 0.75 + 0.03 * (d - hw - 2.5));
    }
  }
  return D;
}

function carveChannelCoarse(H, n, o, st, river) {
  const { X, Z, W } = river, q = {};
  // only outside the fine area matters; coarse sampling of the river polyline
  const Xs = [], Zs = [], Ws = [];
  for (let i = 0; i < X.length; i += 16) { Xs.push(X[i]); Zs.push(Z[i]); Ws.push(W[i]); }
  const XA = Float32Array.from(Xs), ZA = Float32Array.from(Zs);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = o + i * st, z = o + j * st;
    if (Math.abs(x) < FINE.half - 40 && Math.abs(z) < FINE.half - 40) continue;
    nearestOnPolyline(XA, ZA, x, z, q);
    if (q.d > 80) continue;
    const wl = Ws[q.i] + (Ws[q.i + 1] - Ws[q.i]) * q.t;
    const v = q.d < 20 ? wl - 1.5 : wl - 1.5 + (q.d - 20) * 0.12;
    const k = j * n + i;
    if (H[k] > v) H[k] = v;
  }
}
