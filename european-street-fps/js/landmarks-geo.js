// Geometry accumulator for the countryside landmarks (same conventions as city-geo.js: world-space
// UVs in metres / material tile, per-vertex tint × baked contact AO, one buffer per material and
// shadow flags). Differences: the ground AO is measured from a per-site ground level (`gy`, or
// `o.gy` per call) instead of y = 0, template instancing (pre-built unit shapes transformed by an
// affine matrix, no THREE geometry per prop), and a merged vertex-colour far-LOD mesh built from the
// same buffers (one draw call per site at long range).
import * as THREE from 'three';

const groundAO = (h) => 1 - 0.32 * Math.exp(-Math.max(0, h) / 0.6);
const EAVE_BAND = 1.1;
const eaveAO = (y, top) => { const t = (y - (top - EAVE_BAND)) / EAVE_BAND; return t <= 0 ? 1 : 1 - 0.26 * Math.min(1, t) ** 1.5; };

// Box faces: [bit, normal, right(u), up(v), corners (x0|x1, y0|y1, z0|z1) as CCW quads]
const FACES = [
  [1, [1, 0, 0], [0, 0, -1], [0, 1, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [2, [-1, 0, 0], [0, 0, 1], [0, 1, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [4, [0, 1, 0], [1, 0, 0], [0, 0, -1], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [8, [0, -1, 0], [1, 0, 0], [0, 0, 1], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [16, [0, 0, 1], [1, 0, 0], [0, 1, 0], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [32, [0, 0, -1], [-1, 0, 0], [0, 1, 0], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

class Bucket {
  constructor(mat, cast, receive) {
    this.mat = mat; this.cast = cast; this.receive = receive;
    this.cap = 4096; this.n = 0; this.ni = 0;
    this.P = new Float32Array(this.cap * 3); this.N = new Float32Array(this.cap * 3);
    this.U = new Float32Array(this.cap * 2); this.C = new Float32Array(this.cap * 3);
    this.I = new Uint32Array(this.cap * 2);
  }
  reserve(verts, idx) {
    if (this.n + verts > this.cap) {
      const cap = Math.max(this.cap * 2, this.n + verts);
      const grow = (A, k) => { const B = new A.constructor(cap * k); B.set(A); return B; };
      this.P = grow(this.P, 3); this.N = grow(this.N, 3); this.U = grow(this.U, 2); this.C = grow(this.C, 3);
      this.cap = cap;
    }
    if (this.ni + idx > this.I.length) { const B = new Uint32Array(Math.max(this.I.length * 2, this.ni + idx)); B.set(this.I); this.I = B; }
  }
}

// Shared across all sites: one vertex-colour clone per source material, one far material.
const vcCache = new Map();
function vcMaterial(mat) {
  let m = vcCache.get(mat);
  if (!m) {
    m = mat.clone();
    m.vertexColors = true;
    m.userData = { ...mat.userData };
    vcCache.set(mat, m);
  }
  return m;
}
let farMat = null;
export function farMaterial() {
  if (!farMat) farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.9 });
  return farMat;
}
// Average linear albedo of a material (its colour map × colour), for the far LOD.
const avgCache = new Map();
function avgColor(mat) {
  let c = avgCache.get(mat);
  if (c) return c;
  c = [mat.color?.r ?? 1, mat.color?.g ?? 1, mat.color?.b ?? 1];
  const d = mat.map?.image?.data;
  if (d && d.length >= 4) {
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(4, Math.floor(d.length / 4 / 2048) * 4);
    for (let i = 0; i < d.length; i += step) { r += (d[i] / 255) ** 2.2; g += (d[i + 1] / 255) ** 2.2; b += (d[i + 2] / 255) ** 2.2; n++; }
    c = [c[0] * r / n, c[1] * g / n, c[2] * b / n];
  }
  if (mat.userData.farTint) c = c.map((v, i) => v * mat.userData.farTint[i]);
  avgCache.set(mat, c);
  return c;
}

export class LGeo {
  constructor(gy = 0) {
    this.buckets = new Map();
    this.gy = gy;
  }

  _bucket(mat, o) {
    const cast = o.cast !== false && !mat.userData.noCast, receive = o.receive !== false, k = (cast ? 2 : 0) + (receive ? 1 : 0);
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = [null, null, null, null]));
    return arr[k] || (arr[k] = new Bucket(mat, cast, receive));
  }

  _tint(o) {
    const t = o.tint ?? 1, ao = o.ao ?? 1;
    return Array.isArray(t) ? [t[0] * ao, t[1] * ao, t[2] * ao] : [t * ao, t * ao, t * ao];
  }

  _vert(b, x, y, z, nx, ny, nz, u, v, tint, gao, top, gy) {
    const i = b.n++, i3 = i * 3, i2 = i * 2;
    b.P[i3] = x; b.P[i3 + 1] = y; b.P[i3 + 2] = z;
    b.N[i3] = nx; b.N[i3 + 1] = ny; b.N[i3 + 2] = nz;
    b.U[i2] = u; b.U[i2 + 1] = v;
    let k = 1;
    if (ny < 0.5 && ny > -0.5) {
      if (gao) k = groundAO(y - gy);
      if (top) k *= eaveAO(y, top);
    }
    b.C[i3] = tint[0] * k; b.C[i3 + 1] = tint[1] * k; b.C[i3 + 2] = tint[2] * k;
    return i;
  }

  // Axis-aligned box in world space. o: { tint, ao, gao, gy, top, uvOff, skip, cast, receive }
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const gao = o.gao !== false, gy = o.gy ?? this.gy;
    if (gao && y0 < gy + 0.8 && y1 > gy + 1.4 && y1 - y0 > 1.2) {
      const m = Math.max(y0 + 0.01, gy + 0.8);
      this.box(mat, x0, y0, z0, x1, m, z1, { ...o, skip: (o.skip || 0) | 4 });
      this.box(mat, x0, m, z0, x1, y1, z1, { ...o, skip: (o.skip || 0) | 8 });
      return;
    }
    const eb = o.top ? o.top - EAVE_BAND : 0;
    if (o.top && y0 < eb - 0.3 && y1 > eb + 0.05) {
      this.box(mat, x0, y0, z0, x1, eb, z1, { ...o, skip: (o.skip || 0) | 4 });
      this.box(mat, x0, eb, z0, x1, y1, z1, { ...o, skip: (o.skip || 0) | 8 });
      return;
    }
    let skip = o.skip || 0;
    if (y0 <= gy + 0.001 && o.bottom !== true) skip |= 8;
    const b = this._bucket(mat, o), tint = this._tint(o), top = o.top || 0;
    const tile = mat.userData.tile || 2, ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0;
    const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
    b.reserve(24, 36);
    for (let f = 0; f < 6; f++) {
      const [bit, n, r, up, cs] = FACES[f];
      if (skip & bit) continue;
      const base = b.n;
      for (let k = 0; k < 4; k++) {
        const c = cs[k], px = X[c[0]], py = Y[c[1]], pz = Z[c[2]];
        const u = (px * r[0] + py * r[1] + pz * r[2]) / tile + ou;
        const v = (px * up[0] + py * up[1] + pz * up[2]) / tile + ov;
        this._vert(b, px, py, pz, n[0], n[1], n[2], u, v, tint, gao, top, gy);
      }
      const I = b.I, j = b.ni;
      I[j] = base; I[j + 1] = base + 1; I[j + 2] = base + 2; I[j + 3] = base; I[j + 4] = base + 2; I[j + 5] = base + 3;
      b.ni += 6;
    }
  }

  // Triangle with explicit world positions; winding fixed to face `desired`.
  // uvFn(p) -> [u, v] in texture repeats; default: world box projection. o.smoothN: per-vertex normals.
  tri(mat, a, b, c, desired, o = {}, uvFn = null, na = null) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    let swap = false;
    if (desired && nx * desired[0] + ny * desired[1] + nz * desired[2] < 0) { swap = true; nx = -nx; ny = -ny; nz = -nz; }
    nx /= l; ny /= l; nz /= l;
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0, gy = o.gy ?? this.gy;
    const tile = mat.userData.tile || 2;
    const f = uvFn || worldUV(nx, ny, nz, tile, o.uvOff);
    bk.reserve(3, 3);
    const pts = swap ? [a, c, b] : [a, b, c];
    const ns = na ? (swap ? [na[0], na[2], na[1]] : na) : null;
    for (let k = 0; k < 3; k++) {
      const p = pts[k], [u, v] = f(p);
      const n = ns ? ns[k] : null;
      bk.I[bk.ni++] = this._vert(bk, p[0], p[1], p[2], n ? n[0] : nx, n ? n[1] : ny, n ? n[2] : nz, u, v, tint, gao, top, gy);
    }
  }

  quad(mat, a, b, c, d, desired, o = {}, uvFn = null) {
    this.tri(mat, a, b, c, desired, o, uvFn);
    this.tri(mat, a, c, d, desired, o, uvFn);
  }

  // Template instance. T = { P: Float32Array, N: Float32Array } (non-indexed triangles).
  // m: affine 3×4 row-major [a b c tx; d e f ty; g h i tz]; nm: 3×3 normal matrix (row-major).
  tpl(mat, T, m, nm, o = {}) {
    const P = T.P, N = T.N, cnt = P.length / 3;
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0, gy = o.gy ?? this.gy;
    const tile = mat.userData.tile || 2, ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0;
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
    const flip = det < 0;
    bk.reserve(cnt, cnt);
    const X = [0, 0, 0], Y = [0, 0, 0], Z = [0, 0, 0], NX = [0, 0, 0], NY = [0, 0, 0], NZ = [0, 0, 0];
    for (let i = 0; i < cnt; i += 3) {
      for (let t = 0; t < 3; t++) {
        const j = (i + (flip && t ? 3 - t : t)) * 3;
        const x = P[j], y = P[j + 1], z = P[j + 2];
        X[t] = m[0] * x + m[1] * y + m[2] * z + m[3];
        Y[t] = m[4] * x + m[5] * y + m[6] * z + m[7];
        Z[t] = m[8] * x + m[9] * y + m[10] * z + m[11];
        const a = N[j], b = N[j + 1], c = N[j + 2];
        let nx = nm[0] * a + nm[1] * b + nm[2] * c, ny = nm[3] * a + nm[4] * b + nm[5] * c, nz = nm[6] * a + nm[7] * b + nm[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        NX[t] = nx / l; NY[t] = ny / l; NZ[t] = nz / l;
      }
      const e1x = X[1] - X[0], e1y = Y[1] - Y[0], e1z = Z[1] - Z[0], e2x = X[2] - X[0], e2y = Y[2] - Y[0], e2z = Z[2] - Z[0];
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
      const plane = ay >= ax && ay >= az ? (fy > 0 ? 0 : 1) : ax >= az ? (fx > 0 ? 2 : 3) : (fz > 0 ? 4 : 5);
      for (let t = 0; t < 3; t++) {
        const x = X[t], y = Y[t], z = Z[t];
        let u, v;
        switch (plane) {
          case 0: u = x; v = -z; break;
          case 1: u = x; v = z; break;
          case 2: u = -z; v = y; break;
          case 3: u = z; v = y; break;
          case 4: u = x; v = y; break;
          default: u = -x; v = y;
        }
        bk.I[bk.ni++] = this._vert(bk, x, y, z, NX[t], NY[t], NZ[t], u / tile + ou, v / tile + ov, tint, gao, top, gy);
      }
    }
  }

  get triangles() {
    let t = 0;
    for (const arr of this.buckets.values()) for (const b of arr) if (b) t += b.ni / 3;
    return t;
  }

  // Builds one mesh per bucket into `parent`. Returns { meshes, tris }.
  finish(parent) {
    let tris = 0;
    const meshes = [];
    for (const b of [...this.buckets.values()].flat()) {
      if (!b || !b.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.P.slice(0, b.n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.N.slice(0, b.n * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.U.slice(0, b.n * 2), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.C.slice(0, b.n * 3), 3));
      g.setIndex(new THREE.BufferAttribute(b.n < 65536 ? new Uint16Array(b.I.subarray(0, b.ni)) : b.I.slice(0, b.ni), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, vcMaterial(b.mat));
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
      tris += b.ni / 3;
    }
    return { meshes, tris };
  }

  // One merged vertex-colour mesh of every opaque bucket (far LOD). Materials flagged
  // userData.noFar (water, glass…) are left out.
  farMesh() {
    let nv = 0, ni = 0;
    const list = [];
    for (const b of [...this.buckets.values()].flat()) {
      if (!b || !b.n || b.mat.transparent || b.mat.userData.noFar) continue;
      list.push(b); nv += b.n; ni += b.ni;
    }
    if (!nv) return null;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const b of list) {
      P.set(b.P.subarray(0, b.n * 3), vo * 3);
      N.set(b.N.subarray(0, b.n * 3), vo * 3);
      const a = avgColor(b.mat);
      for (let i = 0; i < b.n * 3; i += 3) {
        C[vo * 3 + i] = b.C[i] * a[0]; C[vo * 3 + i + 1] = b.C[i + 1] * a[1]; C[vo * 3 + i + 2] = b.C[i + 2] * a[2];
      }
      for (let i = 0; i < b.ni; i++) I[io + i] = b.I[i] + vo;
      vo += b.n; io += b.ni;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, farMaterial());
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.tris = ni / 3;
    return mesh;
  }

  clear() { this.buckets.clear(); }
}

// World-space box projection matching the box() convention (normal given as components).
export function worldUV(nx, ny, nz, tile, off) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const ou = off ? off[0] : 0, ov = off ? off[1] : 0;
  if (ay >= ax && ay >= az) return ny > 0 ? (p) => [p[0] / tile + ou, -p[2] / tile + ov] : (p) => [p[0] / tile + ou, p[2] / tile + ov];
  if (ax >= az) return nx > 0 ? (p) => [-p[2] / tile + ou, p[1] / tile + ov] : (p) => [p[2] / tile + ou, p[1] / tile + ov];
  return nz > 0 ? (p) => [p[0] / tile + ou, p[1] / tile + ov] : (p) => [-p[0] / tile + ou, p[1] / tile + ov];
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ unit templates
function fromGeometry(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.attributes.normal) ng.computeVertexNormals();
  const T = { P: Float32Array.from(ng.attributes.position.array), N: Float32Array.from(ng.attributes.normal.array) };
  g.dispose(); if (ng !== g) ng.dispose();
  return T;
}
const tplCache = new Map();
function cached(key, make) { let t = tplCache.get(key); if (!t) tplCache.set(key, (t = make())); return t; }

// Cylinder of radius 1, height 1 standing on y = 0 (with top cap; bottom cap optional).
export const T_cyl = (segs = 8, bottom = false) => cached(`cyl${segs}${bottom}`, () => {
  const g = new THREE.CylinderGeometry(1, 1, 1, segs, 1, false);
  g.translate(0, 0.5, 0);
  const T = fromGeometry(g);
  if (bottom) return T;
  return stripDown(T);
});
// Cone of radius 1, height 1 standing on y = 0.
export const T_cone = (segs = 8) => cached(`cone${segs}`, () => {
  const g = new THREE.ConeGeometry(1, 1, segs, 1, true);
  g.translate(0, 0.5, 0);
  return fromGeometry(flatten(g, false));
});
// Blob: icosphere radius 1 (detail 1 = 80 triangles), faceted.
export const T_blob = (detail = 1) => cached(`blob${detail}`, () => fromGeometry(flatten(new THREE.IcosahedronGeometry(1, detail), true)));
// Cypress: spindle of height 1, max radius 1 (at ~0.28 h), smooth normals, 7 sides.
export const T_cypress = () => cached('cypress', () => {
  const prof = [[0.0, 0.0], [0.55, 0.02], [0.86, 0.1], [1.0, 0.24], [0.96, 0.38], [0.82, 0.54], [0.6, 0.72], [0.36, 0.87], [0.12, 0.97], [0.0, 1.0]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 7);
  return fromGeometry(g);
});
// Umbrella pine canopy: flattened dome of radius 1.
export const T_dome = () => cached('dome', () => {
  const prof = [[0.0, 0.0], [0.7, 0.05], [1.0, 0.3], [0.85, 0.7], [0.45, 0.95], [0.0, 1.0]];
  return fromGeometry(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 9));
});
// Terracotta pot: tapered, open top rim, radius 1 at the rim, height 1.
export const T_pot = () => cached('pot', () => {
  const prof = [[0.0, 0.0], [0.62, 0.0], [0.7, 0.1], [0.95, 0.82], [1.05, 0.86], [1.05, 1.0], [0.9, 1.0], [0.85, 0.9], [0.0, 0.9]];
  return fromGeometry(flatten(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 8), true));
});
// Bell: radius 1 at the lip, height ~1.2.
export const T_bell = () => cached('bell', () => {
  const prof = [[0.0, 1.2], [0.42, 1.18], [0.52, 0.9], [0.62, 0.45], [0.86, 0.12], [1.0, 0.0], [0.92, 0.02], [0.5, 0.4], [0.0, 0.42]];
  return fromGeometry(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10));
});
// Unit box: x,y ∈ [-0.5, 0.5], z ∈ [0, 1] (beams between two points).
export const T_beam = () => cached('beam', () => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0, 0.5); return fromGeometry(g); });
// Wheel rim/ring: torus-like box ring in the XY plane, radius 1, used for cart wheels.
export const T_ring = (segs = 12, t = 0.08, w = 0.08) => cached(`ring${segs},${t},${w}`, () => {
  const g = new THREE.TorusGeometry(1, t, 3, segs);
  return fromGeometry(flatten(g, true));
});

function flatten(g, flat) {
  if (!flat) return g;
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  if (ng !== g) g.dispose();
  return ng;
}
// Drops triangles facing straight down (bottom caps never seen).
function stripDown(T) {
  const P = [], N = [];
  for (let i = 0; i < T.P.length; i += 9) {
    const ny = (T.N[i + 1] + T.N[i + 4] + T.N[i + 7]) / 3;
    if (ny < -0.99) continue;
    for (let k = 0; k < 9; k++) { P.push(T.P[i + k]); N.push(T.N[i + k]); }
  }
  return { P: Float32Array.from(P), N: Float32Array.from(N) };
}
