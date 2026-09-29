// Procedural textures for the countryside (terrain agent): ground material layers as texture
// arrays (albedo + height, gradient normal + roughness), a macro noise texture, water ripples,
// foliage and bark. Everything is generated from seeded periodic noise (tiles seamlessly).
import * as THREE from 'three';

function hash(ix, iz, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Periodic value-noise field (size n×n, q lattice cells per side), smooth interpolation, [0,1].
function vfield(n, q, seed) {
  const L = new Float32Array(q * q);
  for (let i = 0; i < q * q; i++) L[i] = hash(i % q, (i / q) | 0, seed);
  const F = new Float32Array(n * n);
  const i0 = new Int32Array(n), i1 = new Int32Array(n), w = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const f = (x + 0.5) / n * q, i = Math.floor(f), t = f - i;
    i0[x] = i % q; i1[x] = (i + 1) % q; w[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < n; y++) {
    const r0 = i0[y] * q, r1 = i1[y] * q, wy = w[y];
    for (let x = 0; x < n; x++) {
      const a = L[r0 + i0[x]], b = L[r0 + i1[x]], c = L[r1 + i0[x]], d = L[r1 + i1[x]], wx = w[x];
      F[y * n + x] = (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy;
    }
  }
  return F;
}
function fbmField(n, q, oct, seed, gain = 0.5) {
  const F = new Float32Array(n * n);
  let a = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const L = vfield(n, Math.min(n, q << o), seed + o * 31);
    for (let i = 0; i < n * n; i++) F[i] += L[i] * a;
    tot += a; a *= gain;
  }
  for (let i = 0; i < n * n; i++) F[i] /= tot;
  return F;
}
// Periodic Worley: returns {F1, F2, id} for q×q cells.
function worley(n, q, seed, jit = 0.9) {
  const px = new Float32Array(q * q), pz = new Float32Array(q * q);
  for (let j = 0; j < q; j++) for (let i = 0; i < q; i++) {
    px[j * q + i] = i + 0.5 + (hash(i, j, seed) - 0.5) * jit;
    pz[j * q + i] = j + 0.5 + (hash(i, j, seed + 1) - 0.5) * jit;
  }
  const F1 = new Float32Array(n * n), F2 = new Float32Array(n * n), ID = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * q, v = (y + 0.5) / n * q, cu = Math.floor(u), cv = Math.floor(v);
    let d1 = 9, d2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ci = cu + di, cj = cv + dj, wi = ((ci % q) + q) % q, wj = ((cj % q) + q) % q;
      const k = wj * q + wi;
      const fx = px[k] + (ci - wi) - u, fz = pz[k] + (cj - wj) - v, d = fx * fx + fz * fz;
      if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
    }
    const k = y * n + x;
    F1[k] = Math.sqrt(d1); F2[k] = Math.sqrt(d2); ID[k] = hash(id, 3, seed);
  }
  return { F1, F2, ID };
}

// Each layer generator returns { col: [r,g,b] per pixel (Float32Array n*n*3), h: height, rough }.
function genGrass(n) {
  const col = new Float32Array(n * n * 3), H = new Float32Array(n * n), R = new Float32Array(n * n);
  const clump = fbmField(n, 6, 4, 101), fine = fbmField(n, 64, 2, 103), blade = vfield(n, 128, 105);
  const streak = new Float32Array(n * n);
  // short blade strokes: stretched noise at a few orientations
  const s1 = vfield(n, 96, 107), s2 = vfield(n, 48, 109);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x, k2 = ((y * 3) % n) * n + x;
    streak[k] = s1[k2] * 0.6 + s2[((y * 2) % n) * n + ((x + y) % n)] * 0.4;
  }
  for (let k = 0; k < n * n; k++) {
    const c = clump[k], b = blade[k] * 0.5 + streak[k] * 0.5, f = fine[k];
    const h = clamp01(0.25 + c * 0.35 + b * 0.5 - 0.1);
    const dryness = smooth(0.55, 0.85, c + f * 0.25 - 0.1);
    const lum = 0.55 + 0.55 * b + 0.2 * (c - 0.5);
    let r = 0.20 + 0.18 * dryness, g = 0.30 + 0.12 * dryness, bl = 0.10 + 0.04 * dryness;
    col[k * 3] = r * lum; col[k * 3 + 1] = g * lum; col[k * 3 + 2] = bl * lum;
    H[k] = h; R[k] = 0.88 + 0.08 * (1 - b);
  }
  return { col, H, R, normal: 2.2 };
}
function genDry(n) {
  const col = new Float32Array(n * n * 3), H = new Float32Array(n * n), R = new Float32Array(n * n);
  const clump = fbmField(n, 5, 4, 201), fine = fbmField(n, 80, 2, 203);
  const s1 = vfield(n, 128, 205), s2 = vfield(n, 64, 207), soil = fbmField(n, 16, 3, 209);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    const st = s1[((y * 4) % n) * n + x] * 0.5 + s2[((y * 2) % n) * n + ((x * 2 + y) % n)] * 0.5;
    const c = clump[k];
    const bare = smooth(0.62, 0.8, soil[k] * 0.7 + (1 - c) * 0.4);
    const lum = 0.7 + 0.45 * st + 0.15 * (fine[k] - 0.5);
    let r = 0.66, g = 0.55, b = 0.33;
    r = r + (0.52 - r) * bare; g = g + (0.42 - g) * bare; b = b + (0.3 - b) * bare;
    col[k * 3] = r * lum; col[k * 3 + 1] = g * lum; col[k * 3 + 2] = b * lum;
    H[k] = clamp01(0.3 + 0.5 * st + 0.2 * c - 0.3 * bare); R[k] = 0.9;
  }
  return { col, H, R, normal: 1.8 };
}
function genEarth(n) {
  const col = new Float32Array(n * n * 3), H = new Float32Array(n * n), R = new Float32Array(n * n);
  const w = worley(n, 18, 301), f = fbmField(n, 8, 5, 303), g = fbmField(n, 64, 2, 305);
  for (let k = 0; k < n * n; k++) {
    const clod = smooth(0.0, 0.5, w.F2[k] - w.F1[k]);
    const h = clamp01(0.25 + clod * 0.45 + (f[k] - 0.5) * 0.5 + (g[k] - 0.5) * 0.2);
    const lum = 0.72 + 0.4 * h + 0.12 * (w.ID[k] - 0.5);
    const pebble = w.ID[k] > 0.93 && w.F1[k] < 0.25 ? 1 : 0;
    let r = 0.47, gg = 0.35, b = 0.24;
    if (pebble) { r = 0.7; gg = 0.66; b = 0.58; }
    col[k * 3] = r * lum; col[k * 3 + 1] = gg * lum; col[k * 3 + 2] = b * lum;
    H[k] = pebble ? 0.9 : h; R[k] = 0.95 - 0.1 * pebble;
  }
  return { col, H, R, normal: 3.0 };
}
function genGravel(n) {
  const col = new Float32Array(n * n * 3), H = new Float32Array(n * n), R = new Float32Array(n * n);
  const w1 = worley(n, 40, 401, 0.95), w2 = worley(n, 90, 403, 0.95), f = fbmField(n, 6, 4, 405), d = fbmField(n, 32, 3, 407);
  for (let k = 0; k < n * n; k++) {
    const p1 = 1 - smooth(0.15, 0.55, w1.F1[k]), p2 = 1 - smooth(0.1, 0.5, w2.F1[k]);
    const h = clamp01(Math.max(p1 * (0.6 + 0.4 * w1.ID[k]), p2 * 0.7) * 0.8 + (f[k] - 0.5) * 0.3 + 0.1);
    const tone = 0.82 + 0.2 * (w1.ID[k] - 0.5) * p1 + 0.12 * (w2.ID[k] - 0.5) * p2;
    const dust = smooth(0.4, 0.7, d[k]);
    const lum = tone * (0.86 + 0.18 * h);
    let r = 0.82, g = 0.78, b = 0.7;
    r -= 0.06 * dust; g -= 0.08 * dust; b -= 0.1 * dust;
    col[k * 3] = r * lum; col[k * 3 + 1] = g * lum; col[k * 3 + 2] = b * lum;
    H[k] = h; R[k] = 0.82 + 0.1 * dust;
  }
  return { col, H, R, normal: 2.6 };
}
function genRock(n) {
  const col = new Float32Array(n * n * 3), H = new Float32Array(n * n), R = new Float32Array(n * n);
  const w = worley(n, 7, 501, 0.8), f = fbmField(n, 4, 6, 503, 0.55), lay = vfield(n, 24, 505), pits = worley(n, 48, 507);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    const crack = smooth(0.0, 0.08, w.F2[k] - w.F1[k]);
    const strata = lay[((y * 5) % n) * n + x];
    const pit = 1 - smooth(0.05, 0.2, pits.F1[k]);
    const h = clamp01(0.3 + 0.5 * f[k] + 0.15 * strata) * crack - 0.15 * pit;
    const lum = 0.75 + 0.35 * f[k] + 0.1 * (w.ID[k] - 0.5) - 0.2 * (1 - crack);
    col[k * 3] = 0.68 * lum; col[k * 3 + 1] = 0.63 * lum; col[k * 3 + 2] = 0.54 * lum;
    H[k] = clamp01(h); R[k] = 0.78;
  }
  return { col, H, R, normal: 4.0 };
}

function toLayers(layers, n) {
  const A = new Uint8Array(n * n * 4 * layers.length), N = new Uint8Array(n * n * 4 * layers.length);
  layers.forEach((L, li) => {
    const o = li * n * n * 4;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const k = y * n + x, q = o + k * 4;
      A[q] = Math.min(255, Math.sqrt(Math.max(0, L.col[k * 3])) * 255); // store ~sRGB (sqrt), decoded in shader
      A[q + 1] = Math.min(255, Math.sqrt(Math.max(0, L.col[k * 3 + 1])) * 255);
      A[q + 2] = Math.min(255, Math.sqrt(Math.max(0, L.col[k * 3 + 2])) * 255);
      A[q + 3] = L.H[k] * 255;
      // gradient (texture space) for the normal: dh/du, dh/dv
      const xl = y * n + ((x + n - 1) % n), xr = y * n + ((x + 1) % n);
      const yu = ((y + n - 1) % n) * n + x, yd = ((y + 1) % n) * n + x;
      const gx = (L.H[xr] - L.H[xl]) * L.normal, gz = (L.H[yd] - L.H[yu]) * L.normal;
      N[q] = Math.max(0, Math.min(255, 128 + gx * 127));
      N[q + 1] = Math.max(0, Math.min(255, 128 + gz * 127));
      N[q + 2] = L.R[k] * 255;
      N[q + 3] = 255;
    }
  });
  const mk = (data) => {
    const t = new THREE.DataArrayTexture(data, n, n, layers.length);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(A), normal: mk(N) };
}

export function makeGroundTextures(size = 256) {
  const layers = [genGrass(size), genDry(size), genEarth(size), genGravel(size), genRock(size)];
  return toLayers(layers, size);
}

// Macro noise: 4 independent periodic fbm channels.
export function makeNoiseTexture(n = 256) {
  const a = fbmField(n, 4, 5, 601), b = fbmField(n, 8, 4, 603), c = fbmField(n, 16, 4, 605), d = fbmField(n, 3, 3, 607);
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) { data[k * 4] = a[k] * 255; data[k * 4 + 1] = b[k] * 255; data[k * 4 + 2] = c[k] * 255; data[k * 4 + 3] = d[k] * 255; }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return { tex: t, data, n };
}

// Water ripple normal map (tangent space, periodic).
export function makeWaterNormal(n = 256) {
  const h = fbmField(n, 8, 4, 701, 0.55), w = worley(n, 12, 703);
  const H = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) H[k] = h[k] * 0.7 + (w.F1[k]) * 0.3;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    const gx = (H[y * n + (x + 1) % n] - H[y * n + (x + n - 1) % n]) * 6, gz = (H[((y + 1) % n) * n + x] - H[((y + n - 1) % n) * n + x]) * 6;
    const l = Math.hypot(gx, gz, 1);
    data[k * 4] = (-gx / l * 0.5 + 0.5) * 255; data[k * 4 + 1] = (-gz / l * 0.5 + 0.5) * 255; data[k * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Foliage: tangent-space normal of leaf clumps + a luminance mask (alpha) for shading variation.
export function makeFoliageTextures(n = 128) {
  const w1 = worley(n, 10, 801), w2 = worley(n, 22, 803), f = fbmField(n, 4, 3, 805);
  const H = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const a = 1 - smooth(0, 0.7, w1.F1[k]), b = 1 - smooth(0, 0.6, w2.F1[k]);
    H[k] = a * 0.6 + b * 0.4 + (f[k] - 0.5) * 0.2;
  }
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    const gx = (H[y * n + (x + 1) % n] - H[y * n + (x + n - 1) % n]) * 3.5, gz = (H[((y + 1) % n) * n + x] - H[((y + n - 1) % n) * n + x]) * 3.5;
    const l = Math.hypot(gx, gz, 1);
    data[k * 4] = (-gx / l * 0.5 + 0.5) * 255; data[k * 4 + 1] = (-gz / l * 0.5 + 0.5) * 255; data[k * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
    data[k * 4 + 3] = clamp01(0.45 + H[k] * 0.7) * 255;
  }
  const nt = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.magFilter = THREE.LinearFilter; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.generateMipmaps = true;
  nt.needsUpdate = true;
  // luminance map (colour texture, grey; multiplies vertex colours)
  const cd = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) { const v = Math.round(clamp01(0.55 + H[k] * 0.6) * 255); cd[k * 4] = cd[k * 4 + 1] = cd[k * 4 + 2] = v; cd[k * 4 + 3] = 255; }
  const ct = new THREE.DataTexture(cd, n, n, THREE.RGBAFormat);
  ct.colorSpace = THREE.SRGBColorSpace;
  ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.magFilter = THREE.LinearFilter; ct.minFilter = THREE.LinearMipmapLinearFilter; ct.generateMipmaps = true;
  ct.needsUpdate = true;
  return { normal: nt, lum: ct };
}

// Bark: vertical fissures (colour + normal).
export function makeBarkTextures(n = 128) {
  const f = fbmField(n, 6, 3, 901), s = vfield(n, 24, 903);
  const H = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) H[y * n + x] = s[((y >> 3) % n) * n + x] * 0.7 + f[y * n + x] * 0.3;
  const cd = new Uint8Array(n * n * 4), nd = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x, v = H[k];
    const l = 0.55 + 0.6 * v;
    cd[k * 4] = Math.min(255, 150 * l); cd[k * 4 + 1] = Math.min(255, 135 * l); cd[k * 4 + 2] = Math.min(255, 115 * l); cd[k * 4 + 3] = 255;
    const gx = (H[y * n + (x + 1) % n] - H[y * n + (x + n - 1) % n]) * 4, gz = (H[((y + 1) % n) * n + x] - H[((y + n - 1) % n) * n + x]) * 4;
    const ln = Math.hypot(gx, gz, 1);
    nd[k * 4] = (-gx / ln * 0.5 + 0.5) * 255; nd[k * 4 + 1] = (-gz / ln * 0.5 + 0.5) * 255; nd[k * 4 + 2] = (1 / ln * 0.5 + 0.5) * 255; nd[k * 4 + 3] = 255;
  }
  const mk = (d, srgb) => {
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(cd, true), normal: mk(nd, false) };
}
