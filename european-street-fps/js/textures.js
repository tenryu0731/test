// Procedural PBR materials for the San Gimignano street scene.
// Every texture is generated at load time from seeded, periodic (seamlessly tiling) noise.
// Each material gets: colour map (sRGB), normal map (from a height field) and an "ORM" map
// (R = cavity AO, G = roughness, B = metalness) that is shared by aoMap/roughnessMap/metalnessMap.
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

// Periodic value noise; px, py are integer periods in lattice cells.
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Fractal noise over texture coordinates u,v ∈ [0,1); tiles because every octave period is an integer.
function fbm(u, v, p, oct, seed, py = p) {
  let s = 0, amp = 0.5, norm = 0, qx = p, qy = py;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * qx, v * qy, qx, qy, seed + o * 101);
    norm += amp; amp *= 0.5; qx *= 2; qy *= 2;
  }
  return s / norm;
}

// Periodic Voronoi on an n×n jittered grid. Result written to V.
const V = { f1: 0, f2: 0, id: 0, px: 0, py: 0 };
function voronoi(u, v, n, seed, jit = 0.85) {
  const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jit;
    const py = cy + 0.5 + (hash2(wx, wy, seed + 17) - 0.5) * jit;
    const dx = px - x, dy = py - y, d = dx * dx + dy * dy;
    if (d < f1) { f2 = f1; f1 = d; id = wy * n + wx; bx = px; by = py; } else if (d < f2) f2 = d;
  }
  V.f1 = Math.sqrt(f1); V.f2 = Math.sqrt(f2); V.id = id; V.px = bx; V.py = by;
  return V;
}

// Running-bond block layouts (flagstones, masonry, brick). Rows are normalised to [0,1).
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
  for (const r of rows) if (v < r.y1) { row = r; break; }
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

// ---------------------------------------------------------------- texture baking
const O = { h: 0, r: 0, g: 0, b: 0, rough: 1, ao: 1, metal: 0 };
function bake(n, fn) {
  const H = new Float32Array(n * n), C = new Uint8Array(n * n * 4), M = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      O.rough = 1; O.ao = 1; O.metal = 0; O.h = 0.5;
      fn(u, v, O, i);
      H[i] = O.h;
      // Bake a little of the cavity into albedo too: direct sunlight ignores aoMap.
      const cav = 0.55 + 0.45 * O.ao;
      C[i * 4] = clamp01(O.r * cav) * 255; C[i * 4 + 1] = clamp01(O.g * cav) * 255;
      C[i * 4 + 2] = clamp01(O.b * cav) * 255; C[i * 4 + 3] = 255;
      M[i * 4] = clamp01(O.ao) * 255; M[i * 4 + 1] = clamp01(O.rough) * 255;
      M[i * 4 + 2] = clamp01(O.metal) * 255; M[i * 4 + 3] = 255;
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
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n, yc = y * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n, xp = (x + 1) % n;
      // Sobel.
      const dx = (H[ym + xp] + 2 * H[yc + xp] + H[yp + xp]) - (H[ym + xm] + 2 * H[yc + xm] + H[yp + xm]);
      const dy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp]) - (H[ym + xm] + 2 * H[ym + x] + H[ym + xp]);
      let nx = -dx * strength * 0.25, ny = -dy * strength * 0.25, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (yc + x) * 4;
      out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * l * 0.5 + 0.5) * 255; out[i + 3] = 255;
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
function genCobble(n, seed) {
  const pal = [[0.56, 0.53, 0.49], [0.63, 0.59, 0.51], [0.5, 0.48, 0.45], [0.67, 0.61, 0.52], [0.58, 0.5, 0.42], [0.6, 0.57, 0.54]];
  return bake(n, (u, v, o) => {
    const nz = fbm(u, v, 32, 3, seed + 5);
    voronoi(u, v, 13, seed, 0.8);
    const e = V.f2 - V.f1 + (nz - 0.5) * 0.14;
    const stone = smooth(0.05, 0.2, e);
    const dome = Math.sqrt(clamp01(e / 0.8));
    const r1 = hash1(V.id, seed + 3), r2 = hash1(V.id, seed + 9);
    const grit = fbm(u, v, 128, 2, seed + 7);
    const fine = fbm(u, v, 64, 3, seed + 11);
    o.h = stone * (0.45 + 0.45 * dome + fine * 0.1) + (1 - stone) * grit * 0.12;
    const c = pick(pal, r1), k = (0.84 + 0.3 * r2) * (0.9 + 0.2 * fine) + dome * 0.05;
    const mr = 0.33 * (0.8 + 0.4 * grit);
    o.r = mix(mr, c[0] * k, stone); o.g = mix(mr * 0.93, c[1] * k, stone); o.b = mix(mr * 0.82, c[2] * k, stone);
    o.rough = mix(0.96, 0.78 - 0.14 * dome, stone);
    o.ao = mix(0.35, 0.75 + 0.25 * dome, stone);
  });
}

function genPaving(n, seed) {
  const heights = []; for (let i = 0; i < 4; i++) heights.push(0.2 + hash1(i, seed) * 0.1);
  const rows = makeRows(seed, heights, 0.24, 0.44);
  return bake(n, (u, v, o) => {
    blockAt(rows, u, v);
    const chip = (fbm(u, v, 48, 3, seed + 2) - 0.5) * 0.012;
    const edge = Math.min(B.dx, B.dy) + chip;
    const stone = smooth(0.003, 0.008, edge);
    const bevel = smooth(0.0, 0.03, edge);
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 4);
    const tilt = (B.lx - 0.5) * (r1 - 0.5) * 0.12 + (B.ly - 0.5) * (r2 - 0.5) * 0.12;
    const wear = fbm(u, v, 8, 4, seed + 6), fine = fbm(u, v, 64, 3, seed + 8);
    o.h = stone * (0.6 + 0.25 * bevel + tilt + fine * 0.12 - smooth(0.6, 0.8, wear) * 0.08) + (1 - stone) * 0.15;
    const k = (0.86 + 0.22 * r1) * (0.92 + 0.14 * fine) * (1 - smooth(0.55, 0.85, wear) * 0.12);
    const base = [0.66 + 0.04 * r2, 0.62, 0.55 - 0.03 * r2];
    const g = 0.3 + 0.1 * fine;
    o.r = mix(g, base[0] * k, stone); o.g = mix(g * 0.95, base[1] * k, stone); o.b = mix(g * 0.85, base[2] * k, stone);
    o.rough = mix(0.95, 0.8 - smooth(0.4, 0.7, wear) * 0.14, stone);
    o.ao = mix(0.35, 0.8 + 0.2 * bevel, stone);
  });
}

// 2:1 herringbone of terracotta bricks, 16 brick-widths per tile.
function genHerringbone(n, seed) {
  const cells = 16;
  const pal = [[0.7, 0.4, 0.27], [0.64, 0.35, 0.23], [0.74, 0.46, 0.31], [0.6, 0.38, 0.28], [0.68, 0.44, 0.33]];
  return bake(n, (u, v, o) => {
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
    const chip = (fbm(u, v, 64, 2, seed + 3) - 0.5) * 0.08;
    const edge = Math.min(lx, w - lx, ly, h - ly) + chip;
    const brick = smooth(0.04, 0.11, edge);
    const r1 = hash1(id, seed), r2 = hash1(id, seed + 5);
    const fine = fbm(u, v, 128, 2, seed + 7), wear = fbm(u, v, 6, 4, seed + 9);
    o.h = brick * (0.6 + 0.2 * smooth(0, 0.25, edge) + fine * 0.1 + (r2 - 0.5) * 0.08) + (1 - brick) * 0.2 * fine;
    const c = pick(pal, r1), k = (0.85 + 0.25 * r2) * (0.9 + 0.15 * fine) * (1 - smooth(0.5, 0.8, wear) * 0.15);
    const sand = [0.58, 0.54, 0.47];
    o.r = mix(sand[0] * (0.8 + 0.3 * fine), c[0] * k, brick);
    o.g = mix(sand[1] * (0.8 + 0.3 * fine), c[1] * k, brick);
    o.b = mix(sand[2] * (0.8 + 0.3 * fine), c[2] * k, brick);
    o.rough = mix(0.97, 0.82 - 0.1 * smooth(0.5, 0.8, wear), brick);
    o.ao = mix(0.45, 0.85 + 0.15 * smooth(0, 0.2, edge), brick);
  });
}

// Coursed travertine / rubble masonry, like the medieval towers.
function genMasonry(n, seed) {
  const heights = []; for (let i = 0; i < 11; i++) heights.push(0.07 + hash1(i, seed + 2) * 0.06);
  const rows = makeRows(seed, heights, 0.07, 0.2);
  const pal = [[0.74, 0.66, 0.53], [0.64, 0.58, 0.5], [0.72, 0.6, 0.44], [0.68, 0.63, 0.56], [0.6, 0.53, 0.44]];
  return bake(n, (u, v, o) => {
    blockAt(rows, u, v);
    const nz = fbm(u, v, 32, 4, seed + 3);
    const edge = Math.min(B.dx, B.dy * 1.2) + (nz - 0.5) * 0.012;
    const block = smooth(0.003, 0.01, edge);
    const pillow = smooth(0, 0.028, edge);
    const pits = smooth(0.62, 0.72, fbm(u, v, 64, 3, seed + 5));
    const fine = fbm(u, v, 128, 2, seed + 6);
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 8);
    o.h = block * (0.5 + 0.3 * pillow + nz * 0.2 - pits * 0.15) + (1 - block) * (0.18 + fine * 0.08);
    const c = pick(pal, r1), k = (0.86 + 0.24 * r2) * (0.88 + 0.2 * nz) * (1 - pits * 0.25);
    const mort = [0.6, 0.57, 0.51], mk = 0.8 + 0.3 * fine;
    o.r = mix(mort[0] * mk, c[0] * k, block); o.g = mix(mort[1] * mk, c[1] * k, block); o.b = mix(mort[2] * mk, c[2] * k, block);
    o.rough = mix(0.97, 0.86 + 0.08 * pits, block);
    o.ao = mix(0.45, 0.7 + 0.3 * pillow - pits * 0.3, block);
  });
}

function genStoneTrim(n, seed) {
  return bake(n, (u, v, o) => {
    const a = fbm(u, v, 4, 5, seed), f = fbm(u, v, 64, 2, seed + 1);
    const pits = smooth(0.7, 0.78, fbm(u, v, 96, 2, seed + 2));
    o.h = 0.5 + a * 0.15 + f * 0.08 - pits * 0.2;
    setRGB(o, [0.8, 0.75, 0.65], (0.9 + 0.14 * a) * (0.95 + 0.08 * f) * (1 - pits * 0.2));
    o.rough = 0.8 + 0.1 * f; o.ao = 1 - pits * 0.4;
  });
}

function genBrick(n, seed) {
  const heights = new Array(16).fill(1);
  const rows = makeRows(seed, heights, 0.2, 0.2, [0, 0.1]);
  const pal = [[0.55, 0.29, 0.19], [0.62, 0.35, 0.21], [0.5, 0.31, 0.23], [0.67, 0.41, 0.27], [0.58, 0.33, 0.24]];
  return bake(n, (u, v, o) => {
    blockAt(rows, u, v);
    const nz = fbm(u, v, 32, 3, seed + 3), fine = fbm(u, v, 128, 2, seed + 4);
    const edge = Math.min(B.dx, B.dy) + (nz - 0.5) * 0.006;
    const brick = smooth(0.003, 0.007, edge);
    const r1 = hash1(B.id, seed + 1), r2 = hash1(B.id, seed + 2);
    o.h = brick * (0.6 + 0.15 * smooth(0, 0.015, edge) + fine * 0.12) + (1 - brick) * 0.25;
    const c = pick(pal, r1), k = (0.82 + 0.3 * r2) * (0.88 + 0.2 * nz);
    const m = [0.66, 0.62, 0.55];
    o.r = mix(m[0] * (0.85 + 0.2 * fine), c[0] * k, brick); o.g = mix(m[1] * (0.85 + 0.2 * fine), c[1] * k, brick);
    o.b = mix(m[2] * (0.85 + 0.2 * fine), c[2] * k, brick);
    o.rough = mix(0.96, 0.88, brick); o.ao = mix(0.5, 0.9, brick);
  });
}

// Plaster: structure (height/ORM + masks) is shared by several colour variants.
function genPlasterStructure(n, seed) {
  const N = n * n;
  const S = { n, H: new Float32Array(N), M: new Uint8Array(N * 4), patch: new Float32Array(N), crack: new Float32Array(N),
    streak: new Float32Array(N), damp: new Float32Array(N), brickC: new Float32Array(N * 3) };
  const brickRows = makeRows(seed + 50, new Array(28).fill(1), 0.11, 0.11, [0, 0.055]);
  const bpal = [[0.6, 0.36, 0.24], [0.66, 0.43, 0.3], [0.7, 0.62, 0.5], [0.55, 0.33, 0.23], [0.72, 0.64, 0.52]];
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      const b = fbm(u, v, 8, 5, seed), trowel = fbm(u, v, 48, 3, seed + 1);
      const pr = fbm(u, v, 4, 4, seed + 2) + (trowel - 0.5) * 0.06;
      const patch = smooth(0.66, 0.675, pr);
      const rim = smooth(0.6, 0.66, pr) * (1 - patch);
      voronoi(u, v, 5, seed + 3, 0.9);
      const crackMask = smooth(0.55, 0.65, fbm(u, v, 3, 3, seed + 4));
      const crack = (1 - smooth(0.0, 0.02, V.f2 - V.f1 + (trowel - 0.5) * 0.03)) * crackMask * (1 - patch);
      const streak = smooth(0.5, 0.85, fbm(u, v, 48, 3, seed + 5, 2)) * smooth(0.35, 0.7, fbm(u, v, 3, 2, seed + 9));
      const damp = smooth(0.58, 0.78, fbm(u, v, 3, 4, seed + 6));
      blockAt(brickRows, u, v);
      const bEdge = Math.min(B.dx, B.dy);
      const bm = smooth(0.002, 0.006, bEdge);
      const bc = pick(bpal, hash1(B.id, seed + 7)), bk = 0.8 + 0.3 * hash1(B.id, seed + 8);
      const mortar = 0.62;
      S.brickC[i * 3] = mix(mortar, bc[0] * bk, bm); S.brickC[i * 3 + 1] = mix(mortar * 0.95, bc[1] * bk, bm);
      S.brickC[i * 3 + 2] = mix(mortar * 0.86, bc[2] * bk, bm);
      const plasterH = 0.62 + b * 0.22 + trowel * 0.08 - crack * 0.3 + rim * 0.05;
      const brickH = 0.12 + bm * 0.18;
      S.H[i] = mix(plasterH, brickH, patch);
      S.patch[i] = patch; S.crack[i] = crack; S.streak[i] = streak; S.damp[i] = damp;
      const ao = mix(1 - crack * 0.6, 0.55 + 0.35 * bm, patch) * (1 - rim * 0.25);
      S.M[i * 4] = ao * 255;
      S.M[i * 4 + 1] = mix(0.9 + trowel * 0.07 - damp * 0.08, 0.93, patch) * 255;
      S.M[i * 4 + 2] = 0; S.M[i * 4 + 3] = 255;
    }
  }
  return S;
}
function plasterColour(S, base, seed) {
  const n = S.n, C = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      const mott = fbm(u, v, 6, 4, seed), fine = fbm(u, v, 64, 2, seed + 1);
      const k = (0.86 + 0.26 * mott) * (0.95 + 0.08 * fine) * (1 - S.streak[i] * 0.14) * (1 - S.damp[i] * 0.16) * (1 - S.crack[i] * 0.45);
      // Streaks and damp shift slightly toward grey-green.
      const g = S.streak[i] * 0.3 + S.damp[i] * 0.4;
      let r = mix(base[0], 0.55, g * 0.3) * k, gg = mix(base[1], 0.55, g * 0.3) * k, b = mix(base[2], 0.5, g * 0.3) * k;
      const p = S.patch[i];
      r = mix(r, S.brickC[i * 3], p); gg = mix(gg, S.brickC[i * 3 + 1], p); b = mix(b, S.brickC[i * 3 + 2], p);
      const cav = 0.55 + 0.45 * (S.M[i * 4] / 255);
      C[i * 4] = clamp01(r * cav) * 255; C[i * 4 + 1] = clamp01(gg * cav) * 255; C[i * 4 + 2] = clamp01(b * cav) * 255; C[i * 4 + 3] = 255;
    }
  }
  return tex(C, n, true);
}

// Terracotta coppi: u along the eave (8 channels), v up the slope (4 tiles per repeat).
function genRoof(n, seed) {
  const cols = 8, rowsN = 4;
  const pal = [[0.72, 0.39, 0.25], [0.66, 0.34, 0.21], [0.77, 0.47, 0.31], [0.6, 0.36, 0.26], [0.7, 0.43, 0.3], [0.64, 0.4, 0.3]];
  return bake(n, (u, v, o) => {
    const x = u * cols, ci = Math.floor(x), fx = x - ci;
    const convex = ci % 2 === 1;
    const y = v * rowsN + (convex ? 0.5 : 0) + hash1(ci, seed) * 0.15;
    const ri = Math.floor(y), fy = y - ri;
    const id = ci * 31 + (((ri % rowsN) + rowsN) % rowsN);
    const across = Math.sin(Math.PI * fx);
    let h = convex ? 0.45 + 0.5 * across : 0.35 - 0.22 * across;
    h += (1 - fy) * 0.12;
    const fine = fbm(u, v, 64, 3, seed + 2);
    h += fine * 0.05;
    o.h = h;
    const r1 = hash1(id, seed + 1), r2 = hash1(id, seed + 3);
    const c = pick(pal, r1);
    let k = (0.84 + 0.26 * r2) * (0.9 + 0.15 * fine);
    // Soot/grime in the channels, lighter sun-bleached crowns.
    k *= convex ? 0.95 + 0.1 * across : 0.82 + 0.1 * (1 - across);
    setRGB(o, c, k);
    const lich = smooth(0.7, 0.76, fbm(u, v, 24, 3, seed + 4 + (id % 5)));
    const dark = smooth(0.72, 0.8, fbm(u, v, 40, 2, seed + 9));
    o.r = mix(o.r, 0.72, lich * 0.7); o.g = mix(o.g, 0.7, lich * 0.7); o.b = mix(o.b, 0.52, lich * 0.7);
    o.r *= 1 - dark * 0.35; o.g *= 1 - dark * 0.3; o.b *= 1 - dark * 0.3;
    const lipShadow = smooth(0.82, 1, fy);
    const sideShadow = convex ? 0 : across * 0.35;
    o.ao = 1 - lipShadow * 0.55 - sideShadow;
    o.rough = 0.82 + 0.1 * fine + lich * 0.05;
  });
}

// Persiane (louvred shutters): shared structure, several paint colours.
function genShutterStructure(n, seed) {
  const slats = 18;
  const N = n * n, S = { n, H: new Float32Array(N), M: new Uint8Array(N * 4), chip: new Float32Array(N), shade: new Float32Array(N), grain: new Float32Array(N), fade: new Float32Array(N) };
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, i = y * n + x;
      const sy = v * slats, fy = sy - Math.floor(sy);
      const chip = smooth(0.68, 0.71, fbm(u, v, 12, 5, seed) + (fy < 0.12 ? 0.06 : 0));
      const grain = fbm(u, v, 4, 4, seed + 2, 96);
      S.H[i] = fy * 0.8 + (1 - chip) * 0.05 + grain * 0.03;
      // Each louvre shadows the top of the one below it.
      const shade = fy < 0.16 ? 1 - 0.45 * (1 - fy / 0.16) : 1;
      S.shade[i] = shade; S.chip[i] = chip; S.grain[i] = grain; S.fade[i] = fbm(u, v, 3, 3, seed + 4);
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
    const wood = [0.46 * (0.8 + 0.3 * S.grain[i]), 0.39 * (0.8 + 0.3 * S.grain[i]), 0.31 * (0.8 + 0.3 * S.grain[i])];
    const f = 0.88 + 0.22 * S.fade[i];
    const c = S.chip[i], s = 0.55 + 0.45 * S.shade[i];
    // Sun-faded paint drifts toward grey.
    C[i * 4] = clamp01(mix(mix(paint[0], 0.6, 0.15 * S.fade[i]) * f, wood[0], c) * s) * 255;
    C[i * 4 + 1] = clamp01(mix(mix(paint[1], 0.6, 0.15 * S.fade[i]) * f, wood[1], c) * s) * 255;
    C[i * 4 + 2] = clamp01(mix(mix(paint[2], 0.58, 0.15 * S.fade[i]) * f, wood[2], c) * s) * 255;
    C[i * 4 + 3] = 255;
  }
  return tex(C, n, true);
}

// Bare weathered timber (beams, rafters, benches); grain runs along u.
function genWood(n, seed) {
  const planks = 5;
  return bake(n, (u, v, o) => {
    const py = v * planks, pi = Math.floor(py), fy = py - pi;
    const grain = fbm(u, v, 2, 5, seed + pi * 13, 64);
    const gap = 1 - smooth(0.0, 0.03, Math.min(fy, 1 - fy));
    const r = hash1(pi, seed);
    o.h = 0.6 + grain * 0.2 - gap * 0.4;
    setRGB(o, [0.5, 0.42, 0.33], (0.8 + 0.3 * grain) * (0.88 + 0.2 * r) * (1 - gap * 0.5));
    // Silvery weathering.
    const w = fbm(u, v, 4, 3, seed + 3);
    o.r = mix(o.r, 0.55, w * 0.3); o.g = mix(o.g, 0.53, w * 0.3); o.b = mix(o.b, 0.5, w * 0.3);
    o.rough = 0.85; o.ao = 1 - gap * 0.6;
  });
}

// Heavy dark door planks, vertical, with iron studs.
function genDoor(n, seed) {
  const planks = 7;
  return bake(n, (u, v, o) => {
    const px = u * planks, pi = Math.floor(px), fx = px - pi;
    const grain = fbm(u, v, 64, 4, seed + pi * 7, 2);
    const gap = 1 - smooth(0.0, 0.05, Math.min(fx, 1 - fx));
    const r = hash1(pi, seed);
    const sx = fx - 0.5, sy = (v * 6) % 1 - 0.5;
    const stud = 1 - smooth(0.05, 0.09, Math.sqrt(sx * sx * 0.6 + sy * sy * 0.02 * 36));
    o.h = 0.6 + grain * 0.15 - gap * 0.45 + stud * 0.3;
    setRGB(o, [0.33, 0.22, 0.14], (0.8 + 0.35 * grain) * (0.85 + 0.25 * r) * (1 - gap * 0.5));
    if (stud > 0.01) { o.r = mix(o.r, 0.2, stud); o.g = mix(o.g, 0.19, stud); o.b = mix(o.b, 0.18, stud); }
    o.rough = mix(0.78, 0.55, stud); o.metal = stud * 0.8; o.ao = 1 - gap * 0.6;
  });
}

function genIron(n, seed) {
  return bake(n, (u, v, o) => {
    const rust = smooth(0.55, 0.75, fbm(u, v, 8, 5, seed));
    const f = fbm(u, v, 64, 2, seed + 1);
    o.h = 0.5 + rust * 0.2 + f * 0.1;
    o.r = mix(0.17, 0.4, rust) * (0.9 + 0.2 * f); o.g = mix(0.17, 0.23, rust) * (0.9 + 0.2 * f); o.b = mix(0.18, 0.14, rust) * (0.9 + 0.2 * f);
    o.rough = mix(0.62, 0.92, rust); o.metal = mix(0.75, 0.15, rust); o.ao = 1;
  });
}

function genGlass(n, seed) {
  return bake(n, (u, v, o) => {
    const d = fbm(u, v, 6, 4, seed), s = smooth(0.6, 0.8, fbm(u, v, 3, 2, seed + 2, 24));
    o.h = 0.5;
    o.r = 0.17 + d * 0.05 + s * 0.05; o.g = 0.21 + d * 0.05 + s * 0.05; o.b = 0.25 + d * 0.04 + s * 0.04;
    o.rough = 0.06 + d * 0.12 + s * 0.15; o.metal = 0.1; o.ao = 1;
  });
}

function genWater(n, seed) {
  return bake(n, (u, v, o) => {
    o.h = fbm(u, v, 6, 4, seed) * 0.7 + fbm(u, v, 16, 2, seed + 1) * 0.3;
    o.r = 0.3; o.g = 0.46; o.b = 0.5; o.rough = 0.05; o.ao = 1;
  });
}

function genMetalBright(n, seed) {
  return bake(n, (u, v, o) => {
    const f = fbm(u, v, 8, 4, seed), s = fbm(u, v, 2, 3, seed + 1, 128);
    o.h = 0.5 + s * 0.05;
    setRGB(o, [0.72, 0.73, 0.74], 0.9 + 0.1 * f);
    o.rough = 0.3 + 0.2 * f + s * 0.1; o.metal = 0.85; o.ao = 1;
  });
}

// Two layers of overlapping leaves.
function genPlant(n, seed) {
  const leaf = (u, v, cells, s) => {
    voronoi(u, v, cells, s, 0.95);
    const id = V.id, ang = hash1(id, s + 1) * Math.PI;
    let dx = u * cells - V.px, dy = v * cells - V.py;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
    const d = Math.sqrt((lx / 0.6) ** 2 + (ly / 0.3) ** 2);
    return { inside: 1 - smooth(0.85, 1.0, d), dome: 1 - d, vein: 1 - smooth(0, 0.04, Math.abs(ly)), r: hash1(id, s + 2) };
  };
  return bake(n, (u, v, o) => {
    const a = leaf(u, v, 14, seed), b = leaf(u, v, 11, seed + 40);
    const top = a.inside > b.inside ? a : b;
    const cov = Math.max(a.inside, b.inside);
    o.h = cov * (0.5 + 0.4 * Math.max(0, top.dome)) + (a.inside > 0.5 && b.inside > 0.5 ? 0.1 : 0);
    const g = [mix(0.22, 0.36, top.r), mix(0.36, 0.5, top.r), mix(0.14, 0.22, top.r)];
    const vk = 1 + top.vein * 0.2;
    o.r = mix(0.08, g[0] * vk, cov); o.g = mix(0.13, g[1] * vk, cov); o.b = mix(0.06, g[2] * vk, cov);
    o.rough = mix(0.95, 0.55, cov); o.ao = mix(0.3, 1, cov);
  });
}

// Plain-weave canvas for café umbrellas / awnings.
function genFabric(n, seed) {
  const N = 96;
  return bake(n, (u, v, o) => {
    const wx = Math.sin(u * N * Math.PI * 2), wy = Math.sin(v * N * Math.PI * 2);
    const f = fbm(u, v, 8, 3, seed);
    o.h = 0.5 + 0.2 * wx * wy;
    setRGB(o, [0.86, 0.81, 0.7], (0.92 + 0.08 * wx * wy) * (0.92 + 0.12 * f));
    o.rough = 0.92; o.ao = 0.85 + 0.15 * (wx * wy * 0.5 + 0.5);
  });
}

// ---------------------------------------------------------------- public API
export function createMaterials(renderer) {
  const t0 = performance.now();
  ANISO = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);

  const M = {};
  M.cobble = material(genCobble(512, 11), { tile: 2.0, normal: 6 });        // 2 m per repeat (~15 cm stones)
  M.paving = material(genPaving(512, 23), { tile: 3.0, normal: 5 });        // 3 m (flagstones 0.6–1.3 m)
  M.herringbone = material(genHerringbone(512, 31), { tile: 2.0, normal: 5 }); // 2 m (bricks 12.5 × 25 cm)
  M.stone = material(genMasonry(512, 41), { tile: 3.0, normal: 6 });        // 3 m (courses 20–40 cm)
  M.stoneTrim = material(genStoneTrim(256, 43), { tile: 1.5, normal: 3 });  // 1.5 m dressed stone
  M.brick = material(genBrick(512, 47), { tile: 1.2, normal: 5 });          // 1.2 m (bricks 24 × 7.5 cm)

  // Plaster: 3 structures × colour variants, 4 m per repeat.
  const structs = [genPlasterStructure(512, 101), genPlasterStructure(512, 211), genPlasterStructure(512, 307)];
  const sNormals = structs.map((s) => normalTex(s.H, s.n, 5));
  const sOrm = structs.map((s) => tex(s.M, s.n, false));
  const plasterColours = [
    [0.84, 0.66, 0.43], // warm ochre
    [0.9, 0.85, 0.74],  // cream
    [0.88, 0.72, 0.65], // pale pink
    [0.74, 0.47, 0.32], // burnt sienna
    [0.9, 0.78, 0.5],   // faded yellow
    [0.8, 0.74, 0.64],  // stone grey-beige
  ];
  M.plaster = plasterColours.map((c, i) => material(null, {
    tile: 4.0, colorTex: plasterColour(structs[i % 3], c, 500 + i * 37), normalMap: sNormals[i % 3], ormTex: sOrm[i % 3],
  }));

  M.roof = material(genRoof(512, 61), { tile: 1.5, normal: 7 });            // 1.5 m (8 coppi channels × 4 rows)
  M.wood = material(genWood(256, 71), { tile: 1.0, normal: 4 });            // 1 m weathered timber, grain along u

  // Shutters: 1 m per repeat (18 louvres).
  const ss = genShutterStructure(512, 81);
  const shN = normalTex(ss.H, ss.n, 4), shO = tex(ss.M, ss.n, false);
  M.shutters = [[0.29, 0.4, 0.28], [0.4, 0.47, 0.52], [0.42, 0.29, 0.2], [0.33, 0.5, 0.48], [0.55, 0.52, 0.42]]
    .map((c) => material(null, { tile: 1.0, colorTex: shutterColour(ss, c), normalMap: shN, ormTex: shO }));

  M.door = material(genDoor(256, 91), { tile: 1.2, normal: 5, metal: 0.01 }); // 1.2 m door leaf
  M.iron = material(genIron(128, 93), { tile: 1.0, normal: 2, metal: 0.8 });
  M.glass = material(genGlass(128, 95), { tile: 1.5, normal: 0.5, extra: { envMapIntensity: 1.4 } });
  M.water = material(genWater(256, 97), { tile: 1.5, normal: 1.5, extra: { transparent: true, opacity: 0.86, envMapIntensity: 1.3 } });
  M.metalBright = material(genMetalBright(128, 98), { tile: 1.0, normal: 1, metal: 0.85 });
  M.plant = material(genPlant(256, 99), { tile: 0.6, normal: 5 });          // 0.6 m foliage clump
  M.fabric = material(genFabric(256, 100), { tile: 0.5, normal: 1.5 });     // 0.5 m canvas weave

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
