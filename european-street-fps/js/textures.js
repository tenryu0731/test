// Procedural PBR materials for the San Gimignano street scene.
// Every texture is generated at load time from seeded, periodic (seamlessly tiling) noise.
// Each material gets: colour map (sRGB), normal map (from a height field) and an "ORM" map
// (R = cavity AO, G = roughness, B = metalness) that is shared by aoMap/roughnessMap/metalnessMap.
//
// Speed: noise is never evaluated per pixel with hashing. Each fractal noise layer is baked once
// into a Float32Array "field" at texture resolution from a small precomputed lattice (separable
// per-axis indices and weights), and cached, so a generator only does array lookups per pixel.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise helpers
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash1 = (i, s) => hash2(i, 911, s);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);

// Per-axis lattice lookup tables: cell index pair and (smoothstep or linear) weight for each pixel.
const axisCache = new Map();
function axis(n, q, linear = false) {
  const key = `${n},${q},${linear}`;
  let A = axisCache.get(key);
  if (A) return A;
  const i0 = new Int32Array(n), i1 = new Int32Array(n), w = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const f = ((x + 0.5) / n) * q, i = Math.floor(f), t = f - i;
    i0[x] = i % q; i1[x] = (i + 1) % q; w[x] = linear ? t : t * t * (3 - 2 * t);
  }
  axisCache.set(key, (A = { i0, i1, w }));
  return A;
}

// Adds amp × (periodic interpolation of the qx×qy grid L) to the n×n field F.
function addLattice(F, n, L, qx, qy, amp, linear) {
  const X = axis(n, qx, linear), Y = axis(n, qy, linear), X0 = X.i0, X1 = X.i1, XW = X.w, Y0 = Y.i0, Y1 = Y.i1, YW = Y.w;
  for (let y = 0; y < n; y++) {
    const r0 = Y0[y] * qx, r1 = Y1[y] * qx, sy = YW[y], row = y * n;
    for (let x = 0; x < n; x++) {
      const x0 = X0[x], x1 = X1[x], sx = XW[x];
      const a = L[r0 + x0], b = L[r0 + x1], c = L[r1 + x0], d = L[r1 + x1];
      F[row + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
  }
}

// Periodic fractal value noise baked to an n×n field in [0,1]. p / py = lattice cells of the first
// octave across the texture. Octaves finer than 4 px are skipped (they would only alias). Octaves are
// accumulated in a resolution pyramid: each is evaluated at ~4 samples per lattice cell and the sum
// is upsampled ×2 (bilinear) as finer octaves are added, so smooth fields cost about one pass.
const fieldCache = new Map();
const pow2ceil = (x) => 2 ** Math.ceil(Math.log2(x));
function field(n, p, oct, seed, py = p) {
  const key = `${n},${p},${py},${oct},${seed}`;
  let F = fieldCache.get(key);
  if (F) return F;
  const q0 = Math.max(p, py);
  let used = 1;
  while (used < oct && q0 * 2 ** used <= n / 4) used++;
  let r = Math.min(n, Math.max(32, pow2ceil(q0 * 4)));
  let G = new Float32Array(r * r);
  let amp = 0.5, norm = 0, qx = p, qy = py;
  for (let o = 0; o < used; o++) {
    const need = Math.min(n, pow2ceil(Math.max(qx, qy) * 4));
    while (r < need) { const U = new Float32Array(4 * r * r); addLattice(U, 2 * r, G, r, r, 1, true); G = U; r *= 2; }
    const s = seed + o * 101, L = new Float32Array(qx * qy);
    for (let j = 0; j < qy; j++) for (let i = 0; i < qx; i++) L[j * qx + i] = hash2(i, j, s);
    addLattice(G, r, L, qx, qy, amp, false);
    norm += amp; amp *= 0.5; qx *= 2; qy *= 2;
  }
  const k = 1 / norm;
  for (let i = 0; i < G.length; i++) G[i] *= k;
  if (r === n) F = G;
  else { F = new Float32Array(n * n); addLattice(F, n, G, r, r, 1, true); }
  fieldCache.set(key, F);
  return F;
}

// Value below which a fraction q of the field lies (sampled), so masks have a known coverage
// whatever the noise statistics.
function quantile(F, q) {
  const s = new Float32Array(Math.ceil(F.length / 13));
  for (let i = 0, j = 0; i < F.length; i += 13) s[j++] = F[i];
  s.sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Periodic Voronoi on an n×n jittered grid with precomputed feature points. Result written to V.
const V = { f1: 0, f2: 0, id: 0, px: 0, py: 0 };
const vorCache = new Map();
function voronoi(u, v, n, seed, jit = 0.85) {
  const key = `${n},${seed},${jit}`;
  let P = vorCache.get(key);
  if (!P) {
    P = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      P[(j * n + i) * 2] = 0.5 + (hash2(i, j, seed) - 0.5) * jit;
      P[(j * n + i) * 2 + 1] = 0.5 + (hash2(i, j, seed + 17) - 0.5) * jit;
    }
    vorCache.set(key, P);
  }
  const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) {
    const cy = yi + j, wy = cy < 0 ? cy + n : cy >= n ? cy - n : cy;
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, wx = cx < 0 ? cx + n : cx >= n ? cx - n : cx;
      const k = (wy * n + wx) * 2;
      const px = cx + P[k], py = cy + P[k + 1];
      const dx = px - x, dy = py - y, d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = wy * n + wx; bx = px; by = py; } else if (d < f2) f2 = d;
    }
  }
  V.f1 = Math.sqrt(f1); V.f2 = Math.sqrt(f2); V.id = id; V.px = bx; V.py = by;
  return V;
}

// Running-bond block layouts (flagstones, masonry, brick, setts). Rows are normalised to [0,1).
function makeRows(seed, heights, minW, maxW, fixedOffsets = null) {
  let rnd = seed;
  const r = () => hash1(rnd++, seed * 7 + 3);
  const total = heights.reduce((a, b) => a + b, 0);
  const rows = [];
  let y = 0;
  heights.forEach((h, ri) => {
    const widths = [];
    let tot = 0;
    while (tot < 1 - minW * 0.5) { const w = minW + r() * (maxW - minW); widths.push(w); tot += w; }
    const s = 1 / tot;
    let c = fixedOffsets ? fixedOffsets[ri % fixedOffsets.length] : r();
    const cuts = widths.map((w) => { const k = c - Math.floor(c); c += w * s; return k; }).sort((a, b) => a - b);
    rows.push({ y0: y / total, y1: (y + h) / total, cuts, id0: ri * 64 });
    y += h;
  });
  return rows;
}
const B = { id: 0, dx: 0, dy: 0, lx: 0, ly: 0, w: 0, h: 0 };
function blockAt(rows, u, v) {
  let row = rows[rows.length - 1];
  for (let i = 0; i < rows.length; i++) if (v < rows[i].y1) { row = rows[i]; break; }
  const cuts = row.cuts;
  let k = -1;
  for (let i = 0; i < cuts.length; i++) if (cuts[i] <= u) k = i;
  let left, right;
  if (k < 0) { left = cuts[cuts.length - 1] - 1; right = cuts[0]; k = cuts.length - 1; }
  else { left = cuts[k]; right = k + 1 < cuts.length ? cuts[k + 1] : cuts[0] + 1; }
  B.id = row.id0 + k;
  B.w = right - left; B.h = row.y1 - row.y0;
  B.dx = Math.min(u - left, right - u);
  B.dy = Math.min(v - row.y0, row.y1 - v);
  B.lx = (u - left) / B.w; B.ly = (v - row.y0) / B.h;
  return B;
}
// Distance to the edge of a block with rounded corners of radius r (uv units).
function roundEdge(dx, dy, r) {
  if (dx < r && dy < r) { const a = r - dx, b = r - dy; return r - Math.sqrt(a * a + b * b); }
  return dx < dy ? dx : dy;
}

// ---------------------------------------------------------------- texture baking
const O = { h: 0, r: 0, g: 0, b: 0, rough: 1, ao: 1, metal: 0 };
function bake(n, fn) {
  const H = new Float32Array(n * n), C = new Uint8Array(n * n * 4), M = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      O.rough = 1; O.ao = 1; O.metal = 0; O.h = 0.5;
      fn(u, v, O, i, x, y);
      H[i] = O.h;
      // Bake a little of the cavity into albedo too: direct sunlight ignores aoMap.
      const cav = 0.6 + 0.4 * O.ao, j = i * 4;
      C[j] = clamp01(O.r * cav) * 255; C[j + 1] = clamp01(O.g * cav) * 255;
      C[j + 2] = clamp01(O.b * cav) * 255; C[j + 3] = 255;
      M[j] = clamp01(O.ao) * 255; M[j + 1] = clamp01(O.rough) * 255;
      M[j + 2] = clamp01(O.metal) * 255; M[j + 3] = 255;
    }
  }
  return { n, H, C, M };
}

let ANISO = 4;
function tex(data, n, srgb) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Tangent-space normal map (+X = +u, +Y = +v, OpenGL convention) from a wrapped height field.
function normalTex(H, n, strength) {
  const out = new Uint8Array(n * n * 4);
  const s = strength * 0.25;
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n, yc = y * n;
    for (let x = 0; x < n; x++) {
      const xm = x === 0 ? n - 1 : x - 1, xp = x === n - 1 ? 0 : x + 1;
      // Sobel.
      const dx = (H[ym + xp] + 2 * H[yc + xp] + H[yp + xp]) - (H[ym + xm] + 2 * H[yc + xm] + H[yp + xm]);
      const dy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp]) - (H[ym + xm] + 2 * H[ym + x] + H[ym + xp]);
      const nx = -dx * s, ny = -dy * s;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (yc + x) * 4;
      out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255;
      out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  return tex(out, n, false);
}

function material(b, { tile, normal = 4, metal = 0, colorTex = null, normalMap = null, ormTex = null, extra = {} }) {
  const orm = ormTex || tex(b.M, b.n, false);
  const m = new THREE.MeshStandardMaterial({
    map: colorTex || tex(b.C, b.n, true),
    normalMap: normalMap || normalTex(b.H, b.n, normal),
    roughnessMap: orm, aoMap: orm, aoMapIntensity: 0.85,
    metalnessMap: metal > 0 ? orm : null,
    roughness: 1, metalness: metal,
    ...extra,
  });
  m.userData.tile = tile;
  return m;
}

const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
function setRGB(o, c, k = 1) { o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; }

// ---------------------------------------------------------------- generators
// Street setts: small, irregular, rounded stones in slightly wavy rows, bedded in sandy mortar.
function genCobble(n, seed) {
  const heights = []; for (let i = 0; i < 16; i++) heights.push(0.85 + hash1(i, seed) * 0.3);
  const rows = makeRows(seed, heights, 0.055, 0.085);
  const pal = [[0.6, 0.56, 0.5], [0.64, 0.59, 0.51], [0.56, 0.53, 0.49], [0.65, 0.58, 0.48], [0.61, 0.54, 0.46], [0.58, 0.55, 0.51], [0.62, 0.53, 0.44]];
  const WU = field(n, 3, 3, seed + 1), WV = field(n, 3, 3, seed + 2), EN = field(n, 24, 3, seed + 3);
  const FI = field(n, 64, 2, 7064), GR = field(n, 128, 2, 7128), DI = field(n, 5, 4, seed + 6);
  return bake(n, (u, v, o, i) => {
    blockAt(rows, frac(u + (WU[i] - 0.5) * 0.06), frac(v + (WV[i] - 0.5) * 0.04));
    const id = B.id;
    const r1 = hash1(id, seed + 3), r2 = hash1(id, seed + 9);
    // Each stone is an irregular rounded quad: random inset on every side.
    const hw = B.w * 0.5, hh = B.h * 0.5;
    const sx = B.lx < 0.5 ? hash1(id, seed + 21) : hash1(id, seed + 22);
    const sy = B.ly < 0.5 ? hash1(id, seed + 23) : hash1(id, seed + 24);
    const dx = B.dx - sx * 0.006, dy = B.dy - sy * 0.005;
    const e = roundEdge(dx, dy, Math.min(hw, hh) * 0.55) + (EN[i] - 0.5) * 0.012;
    const stone = smooth(0.002, 0.0045, e);
    const dome = smooth(0.002, 0.02, e);
    const fine = FI[i], grit = GR[i], dirt = DI[i];
    o.h = stone * (0.4 + 0.4 * Math.sqrt(dome) + fine * 0.07 + (r2 - 0.5) * 0.08) + (1 - stone) * (0.1 + grit * 0.1);
    const c = pick(pal, r1);
    const k = (0.9 + 0.14 * r2) * (0.93 + 0.12 * fine) * (0.88 + 0.12 * dome) * (1 - smooth(0.55, 0.8, dirt) * 0.1);
    const sk = (0.85 + 0.3 * grit) * (1 - smooth(0.55, 0.8, dirt) * 0.1);
    o.r = mix(0.48 * sk, c[0] * k, stone); o.g = mix(0.43 * sk, c[1] * k, stone); o.b = mix(0.36 * sk, c[2] * k, stone);
    o.rough = mix(0.97, 0.84 - 0.18 * dome * (0.4 + fine), stone);
    o.ao = mix(0.5, 0.72 + 0.28 * dome, stone);
  });
}

// Travertine flagstones (cathedral square, gutters).
function genPaving(n, seed) {
  const heights = []; for (let i = 0; i < 4; i++) heights.push(0.2 + hash1(i, seed) * 0.1);
  const rows = makeRows(seed, heights, 0.24, 0.44);
  const CH = field(n, 48, 3, seed + 2), WE = field(n, 8, 4, seed + 6), FI = field(n, 64, 2, 7064);
  const PO = field(n, 128, 1, seed + 9), pq = quantile(PO, 0.95);
  return bake(n, (u, v, o, i) => {
    blockAt(rows, u, v);
    const edge = Math.min(B.dx, B.dy) + (CH[i] - 0.5) * 0.006;
    const stone = smooth(0.0025, 0.005, edge);
    const bevel = smooth(0.0, 0.02, edge);
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 4);
    const tilt = (B.lx - 0.5) * (r1 - 0.5) * 0.1 + (B.ly - 0.5) * (r2 - 0.5) * 0.1;
    const wear = WE[i], fine = FI[i], pore = smooth(pq, pq + 0.04, PO[i]);
    o.h = stone * (0.6 + 0.2 * bevel + tilt + fine * 0.1 - pore * 0.12 - smooth(0.6, 0.8, wear) * 0.06) + (1 - stone) * 0.2;
    const k = (0.9 + 0.14 * r1) * (0.93 + 0.12 * fine) * (1 - smooth(0.55, 0.85, wear) * 0.1) * (1 - pore * 0.12);
    const base = [0.67 + 0.03 * r2, 0.62 + 0.01 * r2, 0.54 - 0.02 * r2];
    const g = 0.4 + 0.08 * fine;
    o.r = mix(g, base[0] * k, stone); o.g = mix(g * 0.95, base[1] * k, stone); o.b = mix(g * 0.86, base[2] * k, stone);
    o.rough = mix(0.95, 0.82 - smooth(0.4, 0.7, wear) * 0.12, stone);
    o.ao = mix(0.5, 0.82 + 0.18 * bevel - pore * 0.2, stone);
  });
}

// 2:1 herringbone of terracotta bricks, 16 brick-widths per tile.
function genHerringbone(n, seed) {
  const cells = 16;
  const pal = [[0.66, 0.42, 0.3], [0.62, 0.38, 0.27], [0.69, 0.46, 0.33], [0.6, 0.41, 0.31], [0.65, 0.44, 0.33]];
  const CH = field(n, 64, 2, 7064), FI = field(n, 128, 2, 7128), WE = field(n, 6, 4, seed + 9);
  return bake(n, (u, v, o, idx) => {
    const x = u * cells, y = v * cells, i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const m = (((i - j) % 4) + 4) % 4;
    let lx, ly, w, h, oi, oj, vert;
    // m=0: left half of a horizontal brick, m=1: right half, m=3: bottom of a vertical, m=2: top.
    if (m === 0) { lx = fx; ly = fy; w = 2; h = 1; oi = i; oj = j; vert = 0; }
    else if (m === 1) { lx = fx + 1; ly = fy; w = 2; h = 1; oi = i - 1; oj = j; vert = 0; }
    else if (m === 3) { lx = fx; ly = fy; w = 1; h = 2; oi = i; oj = j; vert = 1; }
    else { lx = fx; ly = fy + 1; w = 1; h = 2; oi = i; oj = j - 1; vert = 1; }
    const id = (((oi % cells) + cells) % cells) * 97 + (((oj % cells) + cells) % cells) * 3 + vert;
    const edge = Math.min(lx, w - lx, ly, h - ly) + (CH[idx] - 0.5) * 0.07;
    const brick = smooth(0.035, 0.09, edge);
    const r1 = hash1(id, seed), r2 = hash1(id, seed + 5);
    const fine = FI[idx], wear = WE[idx];
    o.h = brick * (0.6 + 0.18 * smooth(0, 0.25, edge) + fine * 0.08 + (r2 - 0.5) * 0.06) + (1 - brick) * (0.2 + 0.1 * fine);
    const c = pick(pal, r1), k = (0.9 + 0.16 * r2) * (0.92 + 0.12 * fine) * (1 - smooth(0.5, 0.8, wear) * 0.12);
    const sk = 0.85 + 0.25 * fine;
    o.r = mix(0.6 * sk, c[0] * k, brick); o.g = mix(0.56 * sk, c[1] * k, brick); o.b = mix(0.49 * sk, c[2] * k, brick);
    o.rough = mix(0.97, 0.84 - 0.1 * smooth(0.5, 0.8, wear), brick);
    o.ao = mix(0.5, 0.86 + 0.14 * smooth(0, 0.2, edge), brick);
  });
}

// Coursed travertine / sandstone masonry like the medieval towers: muted, low-contrast blocks.
function genMasonry(n, seed) {
  const heights = []; for (let i = 0; i < 12; i++) heights.push(0.065 + hash1(i, seed + 2) * 0.05);
  const rows = makeRows(seed, heights, 0.08, 0.22);
  const pal = [[0.67, 0.61, 0.52], [0.62, 0.58, 0.52], [0.66, 0.59, 0.49], [0.6, 0.56, 0.5], [0.64, 0.57, 0.48], [0.69, 0.64, 0.56]];
  const NZ = field(n, 32, 4, seed + 3), MO = field(n, 12, 3, seed + 4), FI = field(n, 128, 2, 7128);
  const PT = field(n, 64, 2, 7064), pq = quantile(PT, 0.94);
  const ST = field(n, 20, 3, seed + 7, 3), GR = field(n, 3, 3, seed + 8);
  return bake(n, (u, v, o, i) => {
    blockAt(rows, u, v);
    const nz = NZ[i];
    const edge = roundEdge(B.dx, B.dy * 1.15, 0.01) + (nz - 0.5) * 0.012;
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 8), r3 = hash1(B.id, seed + 11);
    const joint = 0.003 + r3 * 0.002;
    const block = smooth(joint, joint + 0.004, edge);
    const pillow = smooth(joint, joint + 0.03, edge);
    const pits = smooth(pq, pq + 0.05, PT[i]);
    const fine = FI[i];
    // Vertical rain streaks and broad grime, lighter at block tops.
    const streak = smooth(0.5, 0.8, ST[i]) * 0.1 + smooth(0.45, 0.75, GR[i]) * 0.08;
    o.h = block * (0.52 + 0.24 * pillow + nz * 0.14 - pits * 0.1 + (r2 - 0.5) * 0.05) + (1 - block) * (0.2 + fine * 0.06);
    const c = pick(pal, r1);
    const k = (0.92 + 0.12 * r2) * (0.94 + 0.1 * MO[i]) * (0.96 + 0.06 * fine) * (1 - pits * 0.08) * (1 - streak);
    const mk = (0.84 + 0.2 * fine) * (1 - streak);
    o.r = mix(0.6 * mk, c[0] * k, block); o.g = mix(0.56 * mk, c[1] * k, block); o.b = mix(0.49 * mk, c[2] * k, block);
    o.rough = mix(0.97, 0.88 + 0.06 * pits, block);
    o.ao = mix(0.55, 0.8 + 0.2 * pillow - pits * 0.2, block);
  });
}

// Dressed limestone (pietra) for trims, arches, sills, cornices, fountain: smooth, softly mottled.
function genStoneTrim(n, seed) {
  const A = field(n, 4, 4, seed), F = field(n, 48, 3, seed + 1), T = field(n, 3, 2, seed + 3, 40);
  const P = field(n, 96, 1, seed + 2), pq = quantile(P, 0.97);
  return bake(n, (u, v, o, i) => {
    const a = A[i], f = F[i], pits = smooth(pq, pq + 0.03, P[i]);
    o.h = 0.5 + a * 0.12 + f * 0.06 + T[i] * 0.03 - pits * 0.08;
    setRGB(o, [0.76, 0.72, 0.64], (0.92 + 0.12 * a) * (0.96 + 0.06 * f) * (1 - pits * 0.06) * (0.98 + 0.04 * T[i]));
    o.rough = 0.78 + 0.1 * f; o.ao = 1 - pits * 0.25;
  });
}

function genBrick(n, seed) {
  const heights = new Array(16).fill(1);
  const rows = makeRows(seed, heights, 0.2, 0.2, [0, 0.1]);
  const pal = [[0.58, 0.34, 0.24], [0.62, 0.38, 0.26], [0.55, 0.35, 0.27], [0.65, 0.43, 0.31], [0.6, 0.37, 0.27]];
  const NZ = field(n, 32, 3, seed + 3), FI = field(n, 128, 2, 7128);
  return bake(n, (u, v, o, i) => {
    blockAt(rows, u, v);
    const nz = NZ[i], fine = FI[i];
    const edge = roundEdge(B.dx, B.dy, 0.004) + (nz - 0.5) * 0.006;
    const brick = smooth(0.003, 0.007, edge);
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 2);
    o.h = brick * (0.6 + 0.15 * smooth(0, 0.015, edge) + fine * 0.1) + (1 - brick) * 0.25;
    const c = pick(pal, r1), k = (0.88 + 0.2 * r2) * (0.9 + 0.16 * nz);
    const mk = 0.86 + 0.2 * fine;
    o.r = mix(0.64 * mk, c[0] * k, brick); o.g = mix(0.6 * mk, c[1] * k, brick); o.b = mix(0.53 * mk, c[2] * k, brick);
    o.rough = mix(0.96, 0.88, brick); o.ao = mix(0.55, 0.92, brick);
  });
}

// Plaster: structure (height/ORM + masks) is shared by several colour variants.
function genPlasterStructure(n, seed) {
  const N = n * n;
  const S = { n, H: new Float32Array(N), M: new Uint8Array(N * 4), patch: new Float32Array(N), crack: new Float32Array(N),
    streak: new Float32Array(N), damp: new Float32Array(N), brickC: new Float32Array(N * 3), fine: null };
  // Exposed brick where the render has fallen off: small (~6 % of the wall), in a few spots.
  const brickRows = makeRows(seed + 50, new Array(48).fill(1), 0.065, 0.065, [0, 0.0325]);
  const bpal = [[0.6, 0.38, 0.27], [0.64, 0.43, 0.31], [0.68, 0.6, 0.5], [0.56, 0.36, 0.26], [0.66, 0.5, 0.38]];
  const BL = field(n, 8, 5, seed), TR = field(n, 48, 3, seed + 1), FI = field(n, 128, 2, 7128);
  const PR = field(n, 3, 5, seed + 2), pq = quantile(PR, 0.94);
  const CR = field(n, 7, 4, seed + 4), CM = field(n, 6, 3, seed + 10), cq = quantile(CM, 0.88);
  const SA = field(n, 40, 3, seed + 5, 2), SB = field(n, 3, 2, seed + 9), DA = field(n, 3, 4, seed + 6), dq = quantile(DA, 0.8);
  S.fine = FI;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      const b = BL[i], trowel = TR[i];
      const pr = PR[i] + (trowel - 0.5) * 0.03;
      const patch = smooth(pq, pq + 0.008, pr);
      const rim = smooth(pq - 0.03, pq, pr) * (1 - patch);
      // Hairline cracks: thin ridges of a noise field, only in some areas.
      const crack = (1 - smooth(0.0, 0.006, Math.abs(CR[i] - 0.5))) * smooth(cq, cq + 0.05, CM[i]) * (1 - patch);
      const streak = smooth(0.56, 0.85, SA[i]) * smooth(0.45, 0.75, SB[i]);
      const damp = smooth(dq, dq + 0.12, DA[i]);
      let bm = 0, br = 0.62, bg = 0.59, bb = 0.53;
      if (patch > 0.001) {
        blockAt(brickRows, u, v);
        bm = smooth(0.002, 0.005, roundEdge(B.dx, B.dy, 0.003) + (trowel - 0.5) * 0.004);
        const bc = pick(bpal, hash1(B.id, seed + 7)), bk = 0.86 + 0.2 * hash1(B.id, seed + 8);
        br = mix(0.62, bc[0] * bk, bm); bg = mix(0.59, bc[1] * bk, bm); bb = mix(0.53, bc[2] * bk, bm);
      }
      S.brickC[i * 3] = br; S.brickC[i * 3 + 1] = bg; S.brickC[i * 3 + 2] = bb;
      const plasterH = 0.62 + b * 0.2 + trowel * 0.07 - crack * 0.12 + rim * 0.06;
      const brickH = 0.14 + bm * 0.16;
      S.H[i] = mix(plasterH, brickH, patch);
      S.patch[i] = patch; S.crack[i] = crack; S.streak[i] = streak; S.damp[i] = damp;
      const ao = mix(1 - crack * 0.35, 0.6 + 0.3 * bm, patch) * (1 - rim * 0.15);
      S.M[i * 4] = ao * 255;
      S.M[i * 4 + 1] = mix(0.9 + trowel * 0.07 - damp * 0.06, 0.93, patch) * 255;
      S.M[i * 4 + 2] = 0; S.M[i * 4 + 3] = 255;
    }
  }
  return S;
}
function plasterColour(S, base, seed) {
  const n = S.n, C = new Uint8Array(n * n * 4);
  // One shared mottling field, shifted per colour variant.
  const MO = field(n, 6, 4, 4242), FI = S.fine;
  const ox = Math.floor(hash1(seed, 5) * n), oy = Math.floor(hash1(seed, 6) * n);
  for (let y = 0; y < n; y++) for (let x = 0, mrow = ((y + oy) % n) * n, xs = n - ox; x < n; x++) {
    const i = y * n + x;
    const mott = MO[mrow + (x < xs ? x + ox : x - xs)], fine = FI[i];
    const k = (0.9 + 0.16 * mott) * (0.96 + 0.06 * fine) * (1 - S.streak[i] * 0.08) * (1 - S.damp[i] * 0.07) * (1 - S.crack[i] * 0.3);
    // Streaks and damp shift slightly toward grey-green.
    const g = (S.streak[i] * 0.25 + S.damp[i] * 0.35) * 0.3;
    let r = mix(base[0], 0.5, g) * k, gg = mix(base[1], 0.5, g) * k, b = mix(base[2], 0.46, g) * k;
    const p = S.patch[i];
    r = mix(r, S.brickC[i * 3], p); gg = mix(gg, S.brickC[i * 3 + 1], p); b = mix(b, S.brickC[i * 3 + 2], p);
    const cav = 0.6 + 0.4 * (S.M[i * 4] / 255);
    C[i * 4] = clamp01(r * cav) * 255; C[i * 4 + 1] = clamp01(gg * cav) * 255; C[i * 4 + 2] = clamp01(b * cav) * 255; C[i * 4 + 3] = 255;
  }
  return tex(C, n, true);
}

// Terracotta coppi: u along the eave (8 channels), v up the slope (4 tiles per repeat).
function genRoof(n, seed) {
  const cols = 8, rowsN = 4;
  const pal = [[0.68, 0.39, 0.26], [0.63, 0.35, 0.23], [0.72, 0.45, 0.31], [0.58, 0.36, 0.27], [0.66, 0.42, 0.3], [0.61, 0.4, 0.31]];
  const FI = field(n, 64, 2, 7064), LI = field(n, 24, 3, seed + 4), DK = field(n, 40, 2, seed + 9);
  const lq = quantile(LI, 0.95), dq = quantile(DK, 0.9);
  return bake(n, (u, v, o, i) => {
    const x = u * cols, ci = Math.floor(x), fx = x - ci;
    const convex = ci % 2 === 1;
    const y = v * rowsN + (convex ? 0.5 : 0) + hash1(ci, seed) * 0.15;
    const ri = Math.floor(y), fy = y - ri;
    const id = ci * 31 + (((ri % rowsN) + rowsN) % rowsN);
    const across = Math.sin(Math.PI * fx);
    let h = convex ? 0.45 + 0.5 * across : 0.35 - 0.22 * across;
    h += (1 - fy) * 0.12;
    const fine = FI[i];
    h += fine * 0.05;
    o.h = h;
    const r1 = hash1(id, seed + 1), r2 = hash1(id, seed + 3);
    const c = pick(pal, r1);
    let k = (0.88 + 0.18 * r2) * (0.92 + 0.12 * fine);
    // Soot/grime in the channels, lighter sun-bleached crowns.
    k *= convex ? 0.95 + 0.1 * across : 0.84 + 0.1 * (1 - across);
    setRGB(o, c, k);
    const lich = smooth(lq - 0.01 + (r2 - 0.5) * 0.04, lq + 0.03, LI[i]) * 0.45;
    const dark = smooth(dq, dq + 0.06, DK[i]);
    o.r = mix(o.r, 0.66, lich); o.g = mix(o.g, 0.64, lich); o.b = mix(o.b, 0.5, lich);
    o.r *= 1 - dark * 0.25; o.g *= 1 - dark * 0.22; o.b *= 1 - dark * 0.2;
    const lipShadow = smooth(0.82, 1, fy);
    const sideShadow = convex ? 0 : across * 0.3;
    o.ao = 1 - lipShadow * 0.5 - sideShadow;
    o.rough = 0.82 + 0.1 * fine + lich * 0.05;
  });
}

// Persiane (louvred shutters): shared structure, several paint colours.
function genShutterStructure(n, seed) {
  const slats = 18;
  const N = n * n, S = { n, H: new Float32Array(N), M: new Uint8Array(N * 4), chip: new Float32Array(N), shade: new Float32Array(N), grain: null, fade: null };
  const CH = field(n, 20, 4, seed), cq = quantile(CH, 0.95);
  S.grain = field(n, 4, 4, seed + 2, 96); S.fade = field(n, 3, 3, seed + 4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    const sy = v * slats, fy = sy - Math.floor(sy);
    // Each louvre shadows the top of the one below it.
    const shade = fy < 0.16 ? 1 - 0.45 * (1 - fy / 0.16) : 1;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const chip = smooth(cq, cq + 0.02, CH[i] + (fy < 0.12 ? 0.04 : 0));
      S.H[i] = fy * 0.8 + (1 - chip) * 0.05 + S.grain[i] * 0.03;
      S.shade[i] = shade; S.chip[i] = chip;
      S.M[i * 4] = shade * 255;
      S.M[i * 4 + 1] = mix(0.55 + 0.1 * S.fade[i], 0.88, chip) * 255;
      S.M[i * 4 + 2] = 0; S.M[i * 4 + 3] = 255;
    }
  }
  return S;
}
function shutterColour(S, paint) {
  const n = S.n, C = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const gk = 0.8 + 0.3 * S.grain[i];
    const f = 0.9 + 0.2 * S.fade[i], fd = 0.15 * S.fade[i];
    const c = S.chip[i], s = 0.55 + 0.45 * S.shade[i];
    // Sun-faded paint drifts toward grey.
    C[i * 4] = clamp01(mix(mix(paint[0], 0.6, fd) * f, 0.46 * gk, c) * s) * 255;
    C[i * 4 + 1] = clamp01(mix(mix(paint[1], 0.6, fd) * f, 0.39 * gk, c) * s) * 255;
    C[i * 4 + 2] = clamp01(mix(mix(paint[2], 0.58, fd) * f, 0.31 * gk, c) * s) * 255;
    C[i * 4 + 3] = 255;
  }
  return tex(C, n, true);
}

// Bare weathered timber (beams, rafters, benches); grain runs along u.
function genWood(n, seed) {
  const planks = 5;
  const G = field(n, 2, 5, seed, 64), W = field(n, 4, 3, seed + 3);
  return bake(n, (u, v, o, i, x, y) => {
    const py = v * planks, pi = Math.floor(py), fy = py - pi;
    // Shift the shared grain field per plank so neighbouring planks differ.
    const grain = G[y * n + ((x + pi * 97) % n)];
    const gap = 1 - smooth(0.0, 0.03, Math.min(fy, 1 - fy));
    const r = hash1(pi, seed);
    o.h = 0.6 + grain * 0.2 - gap * 0.4;
    setRGB(o, [0.5, 0.42, 0.33], (0.8 + 0.3 * grain) * (0.88 + 0.2 * r) * (1 - gap * 0.5));
    // Silvery weathering.
    const w = W[i] * 0.3;
    o.r = mix(o.r, 0.55, w); o.g = mix(o.g, 0.53, w); o.b = mix(o.b, 0.5, w);
    o.rough = 0.85; o.ao = 1 - gap * 0.6;
  });
}

// Heavy dark door planks, vertical, with iron studs.
function genDoor(n, seed) {
  const planks = 7;
  const G = field(n, 64, 4, seed, 2);
  return bake(n, (u, v, o, i, x, y) => {
    const px = u * planks, pi = Math.floor(px), fx = px - pi;
    const grain = G[((y + pi * 61) % n) * n + x];
    const gap = 1 - smooth(0.0, 0.05, Math.min(fx, 1 - fx));
    const r = hash1(pi, seed);
    const sx = fx - 0.5, sy = (v * 6) % 1 - 0.5;
    const stud = 1 - smooth(0.05, 0.09, Math.sqrt(sx * sx * 0.6 + sy * sy * 0.72));
    o.h = 0.6 + grain * 0.15 - gap * 0.45 + stud * 0.3;
    setRGB(o, [0.33, 0.22, 0.14], (0.8 + 0.35 * grain) * (0.85 + 0.25 * r) * (1 - gap * 0.5));
    if (stud > 0.01) { o.r = mix(o.r, 0.2, stud); o.g = mix(o.g, 0.19, stud); o.b = mix(o.b, 0.18, stud); }
    o.rough = mix(0.78, 0.55, stud); o.metal = stud * 0.8; o.ao = 1 - gap * 0.6;
  });
}

function genIron(n, seed) {
  const RU = field(n, 8, 5, seed), F = field(n, 64, 2, seed + 1);
  return bake(n, (u, v, o, i) => {
    const rust = smooth(0.55, 0.75, RU[i]), f = F[i];
    o.h = 0.5 + rust * 0.2 + f * 0.1;
    const k = 0.9 + 0.2 * f;
    o.r = mix(0.17, 0.36, rust) * k; o.g = mix(0.17, 0.22, rust) * k; o.b = mix(0.18, 0.15, rust) * k;
    o.rough = mix(0.62, 0.92, rust); o.metal = mix(0.75, 0.15, rust); o.ao = 1;
  });
}

// Old window glass: dark and neutral so it reads as a pane with a room behind it, not a blue board.
function genGlass(n, seed) {
  const D = field(n, 6, 4, seed), S = field(n, 3, 2, seed + 2, 24);
  return bake(n, (u, v, o, i) => {
    const d = D[i], s = smooth(0.6, 0.8, S[i]);
    o.h = 0.5 + d * 0.02;
    o.r = 0.085 + d * 0.03 + s * 0.03; o.g = 0.09 + d * 0.03 + s * 0.03; o.b = 0.095 + d * 0.03 + s * 0.03;
    o.rough = 0.08 + d * 0.1 + s * 0.12; o.metal = 0.05; o.ao = 1;
  });
}

function genWater(n, seed) {
  const A = field(n, 6, 4, seed), Bf = field(n, 16, 2, seed + 1);
  return bake(n, (u, v, o, i) => {
    o.h = A[i] * 0.7 + Bf[i] * 0.3;
    o.r = 0.2; o.g = 0.3; o.b = 0.3; o.rough = 0.05; o.ao = 1;
  });
}

function genMetalBright(n, seed) {
  const F = field(n, 8, 4, seed), S = field(n, 2, 3, seed + 1, 128);
  return bake(n, (u, v, o, i) => {
    const f = F[i], s = S[i];
    o.h = 0.5 + s * 0.05;
    setRGB(o, [0.72, 0.73, 0.74], 0.9 + 0.1 * f);
    o.rough = 0.3 + 0.2 * f + s * 0.1; o.metal = 0.85; o.ao = 1;
  });
}

// Two layers of overlapping leaves.
function genPlant(n, seed) {
  const L = { inside: 0, dome: 0, vein: 0, r: 0 }, L2 = { inside: 0, dome: 0, vein: 0, r: 0 };
  const leaf = (u, v, cells, s, out) => {
    voronoi(u, v, cells, s, 0.95);
    const id = V.id, ang = hash1(id, s + 1) * Math.PI;
    const dx = u * cells - V.px, dy = v * cells - V.py;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const lx = (dx * ca + dy * sa) / 0.6, ly = (-dx * sa + dy * ca);
    const d = Math.sqrt(lx * lx + (ly / 0.3) * (ly / 0.3));
    out.inside = 1 - smooth(0.85, 1.0, d); out.dome = 1 - d; out.vein = 1 - smooth(0, 0.04, Math.abs(ly)); out.r = hash1(id, s + 2);
    return out;
  };
  return bake(n, (u, v, o) => {
    const a = leaf(u, v, 14, seed, L), b = leaf(u, v, 11, seed + 40, L2);
    const top = a.inside > b.inside ? a : b;
    const cov = Math.max(a.inside, b.inside);
    o.h = cov * (0.5 + 0.4 * Math.max(0, top.dome)) + (a.inside > 0.5 && b.inside > 0.5 ? 0.1 : 0);
    const g = [mix(0.24, 0.36, top.r), mix(0.34, 0.46, top.r), mix(0.16, 0.22, top.r)];
    const vk = 1 + top.vein * 0.15;
    o.r = mix(0.09, g[0] * vk, cov); o.g = mix(0.13, g[1] * vk, cov); o.b = mix(0.07, g[2] * vk, cov);
    o.rough = mix(0.95, 0.6, cov); o.ao = mix(0.35, 1, cov);
  });
}

// Plain-weave canvas for café umbrellas / awnings / laundry.
function genFabric(n, seed) {
  const N = 96, F = field(n, 8, 3, seed);
  const sn = new Float32Array(n);
  for (let x = 0; x < n; x++) sn[x] = Math.sin(((x + 0.5) / n) * N * Math.PI * 2);
  return bake(n, (u, v, o, i, x, y) => {
    const ww = sn[x] * sn[y], f = F[i];
    o.h = 0.5 + 0.2 * ww;
    setRGB(o, [0.84, 0.8, 0.7], (0.93 + 0.07 * ww) * (0.93 + 0.1 * f));
    o.rough = 0.92; o.ao = 0.88 + 0.12 * (ww * 0.5 + 0.5);
  });
}

// ---------------------------------------------------------------- public API
export function createMaterials(renderer) {
  const t0 = performance.now();
  ANISO = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);

  const M = {};
  M.cobble = material(genCobble(512, 11), { tile: 2.0, normal: 6 });        // 2 m per repeat (setts ~13 × 12–20 cm)
  M.paving = material(genPaving(512, 23), { tile: 3.0, normal: 4 });        // 3 m (flagstones 0.6–1.3 m)
  M.herringbone = material(genHerringbone(512, 31), { tile: 2.0, normal: 5 }); // 2 m (bricks 12.5 × 25 cm)
  M.stone = material(genMasonry(512, 41), { tile: 3.0, normal: 5 });        // 3 m (courses 20–35 cm)
  M.stoneTrim = material(genStoneTrim(256, 43), { tile: 1.5, normal: 2 }); // 1.5 m dressed stone
  M.brick = material(genBrick(512, 47), { tile: 1.2, normal: 5 });          // 1.2 m (bricks 24 × 7.5 cm)

  // Plaster: one shared structure (height/ORM/normal) × colour variants, 4 m per repeat. Every
  // building also gets a random UV offset, so the stains and patches never line up between houses.
  const ps = genPlasterStructure(512, 101);
  const pN = normalTex(ps.H, ps.n, 4), pO = tex(ps.M, ps.n, false);
  const plasterColours = [
    [0.76, 0.6, 0.41],  // warm ochre
    [0.8, 0.76, 0.66],  // cream
    [0.78, 0.64, 0.57], // pale pink
    [0.68, 0.46, 0.33], // burnt sienna
    [0.8, 0.7, 0.48],   // faded yellow
    [0.72, 0.68, 0.6],  // stone grey-beige
    [0.74, 0.55, 0.42], // faded terracotta
  ];
  M.plaster = plasterColours.map((c, i) => material(null, {
    tile: 4.0, colorTex: plasterColour(ps, c, 500 + i * 37), normalMap: pN, ormTex: pO,
  }));

  M.roof = material(genRoof(512, 61), { tile: 1.5, normal: 7 });            // 1.5 m (8 coppi channels × 4 rows)
  M.wood = material(genWood(256, 71), { tile: 1.0, normal: 4 });            // 1 m weathered timber, grain along u

  // Shutters: 1 m per repeat (18 louvres).
  const ss = genShutterStructure(256, 81);
  const shN = normalTex(ss.H, ss.n, 2), shO = tex(ss.M, ss.n, false);
  M.shutters = [[0.3, 0.38, 0.28], [0.4, 0.45, 0.48], [0.4, 0.29, 0.2], [0.33, 0.46, 0.44], [0.52, 0.49, 0.41]]
    .map((c) => material(null, { tile: 1.0, colorTex: shutterColour(ss, c), normalMap: shN, ormTex: shO }));

  M.door = material(genDoor(256, 91), { tile: 1.2, normal: 5, metal: 0.01 }); // 1.2 m door leaf
  M.iron = material(genIron(128, 93), { tile: 1.0, normal: 2, metal: 0.8 });
  M.glass = material(genGlass(128, 95), { tile: 1.5, normal: 0.5, extra: { envMapIntensity: 1.1 } });
  M.water = material(genWater(256, 97), { tile: 1.5, normal: 1.5, extra: { transparent: true, opacity: 0.88, envMapIntensity: 1.2 } });
  M.metalBright = material(genMetalBright(128, 98), { tile: 1.0, normal: 1, metal: 0.85 });
  M.plant = material(genPlant(256, 99), { tile: 0.6, normal: 5 });          // 0.6 m foliage clump
  M.fabric = material(genFabric(256, 100), { tile: 0.5, normal: 1.5 });     // 0.5 m canvas weave

  // Falling water jets (thin, pale, translucent) and frosted lantern glass: plain materials.
  M.waterJet = new THREE.MeshStandardMaterial({ color: 0xcfdcdc, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 1.2 });
  M.waterJet.userData.tile = 1;
  M.lampGlass = new THREE.MeshStandardMaterial({ color: 0xb9ab8c, roughness: 0.35, metalness: 0 });
  M.lampGlass.userData.tile = 1;

  fieldCache.clear(); axisCache.clear(); vorCache.clear();
  console.log(`[textures] generated in ${(performance.now() - t0).toFixed(0)} ms`);
  return M;
}

// Box-projected UVs in world metres / tile. Chooses the projection plane per triangle from its
// dominant normal axis. Works on indexed or non-indexed geometry that is already in world space.
export function setWorldUV(geometry, tile = 2) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array, n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 3) {
    const a = i * 3, b = a + 3, c = a + 6;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      const x = p[(i + k) * 3], y = p[(i + k) * 3 + 1], z = p[(i + k) * 3 + 2];
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = -z; }
      else if (ax >= az) { u = nx > 0 ? -z : z; v = y; }
      else { u = nz > 0 ? x : -x; v = y; }
      uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
