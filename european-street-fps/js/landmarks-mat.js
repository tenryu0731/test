// Extra procedural materials for the landmarks (textures.js stays read-only): white gravel for
// garden paths and yards, tilled soil for kitchen gardens, straw for haystacks, burlap for sandbags. Small (128–256 px)
// tiling textures from a hashed value noise, generated in a few milliseconds.
import * as THREE from 'three';

function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Periodic value noise on a q×q lattice sampled at n×n.
function noise(n, q, s) {
  const F = new Float32Array(n * n), L = new Float32Array(q * q);
  for (let i = 0; i < q * q; i++) L[i] = hash(i % q, (i / q) | 0, s);
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * q, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % q;
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * q, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % q;
      const a = L[y0 * q + x0], b = L[y0 * q + x1], c = L[y1 * q + x0], d = L[y1 * q + x1];
      F[y * n + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return F;
}
function tex(data, n, srgb) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function normalTex(H, n, k) {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = H[y * n + ((x + 1) % n)] - H[y * n + ((x - 1 + n) % n)];
    const dy = H[((y + 1) % n) * n + x] - H[((y - 1 + n) % n) * n + x];
    const nx = -dx * k, ny = -dy * k, l = 1 / Math.hypot(nx, ny, 1), i = (y * n + x) * 4;
    out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return tex(out, n, false);
}
// fn(i, x, y) -> [r, g, b, height, rough]
function make(n, tile, k, fn, extra = {}) {
  const C = new Uint8Array(n * n * 4), H = new Float32Array(n * n), O = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, [r, g, b, h, ro] = fn(i, x, y), j = i * 4;
    C[j] = Math.min(255, r * 255); C[j + 1] = Math.min(255, g * 255); C[j + 2] = Math.min(255, b * 255); C[j + 3] = 255;
    H[i] = h;
    O[j] = 255; O[j + 1] = ro * 255; O[j + 2] = 0; O[j + 3] = 255;
  }
  const orm = tex(O, n, false);
  const m = new THREE.MeshStandardMaterial({ map: tex(C, n, true), normalMap: normalTex(H, n, k), roughnessMap: orm, roughness: 1, metalness: 0, ...extra });
  m.userData.tile = tile;
  return m;
}

export function createLandmarkMaterials() {
  const L = {};
  // White gravel (strade bianche / garden paths): pebbles on a pale dusty base.
  {
    const n = 256, A = noise(n, 64, 11), B = noise(n, 16, 12), C = noise(n, 128, 13);
    L.gravel = make(n, 2.5, 6, (i) => {
      const peb = Math.max(0, A[i] - 0.52) * 3.2, fine = C[i], big = B[i];
      const k = 0.78 + 0.16 * big + 0.1 * fine - peb * 0.18;
      return [0.86 * k, 0.82 * k, 0.74 * k, peb * 0.6 + fine * 0.15, 0.95];
    }, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  // Tilled soil with clods.
  {
    const n = 128, A = noise(n, 32, 21), B = noise(n, 8, 22), C = noise(n, 64, 23);
    L.soil = make(n, 2, 5, (i) => {
      const k = 0.6 + 0.3 * A[i] + 0.15 * B[i] + 0.1 * C[i];
      return [0.42 * k, 0.31 * k, 0.22 * k, A[i] * 0.7 + C[i] * 0.3, 0.97];
    });
  }
  // Straw: fibres along v.
  {
    const n = 128, A = noise(n, 8, 31), F = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) F[y * n + x] = hash(x, (y / 12) | 0, 33) * 0.6 + hash(x, (y / 5) | 0, 34) * 0.4;
    L.straw = make(n, 1.2, 4, (i) => {
      const k = 0.62 + 0.38 * F[i] * (0.8 + 0.4 * A[i]);
      return [0.86 * k, 0.72 * k, 0.42 * k, F[i], 0.95];
    });
  }
  // Burlap (sandbags): a coarse weave of khaki threads with a seam every bag width.
  {
    const n = 128, A = noise(n, 16, 41), B = noise(n, 4, 42);
    L.burlap = make(n, 0.6, 3, (i, x, y) => {
      const w = ((x >> 1) + (y >> 1)) & 1 ? 0.9 + 0.1 * hash(x, y, 43) : 0.78 + 0.1 * hash(x, y, 44);
      const k = w * (0.82 + 0.18 * A[i]) * (0.9 + 0.1 * B[i]);
      return [0.78 * k, 0.7 * k, 0.52 * k, w * 0.5 + A[i] * 0.2, 0.98];
    });
  }
  return L;
}
