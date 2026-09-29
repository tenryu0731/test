// Geometry accumulator for the static town: everything is baked in world space into one
// vertex buffer per (material, shadow flags) so the whole town costs a few dozen draw calls.
// Vertex colours carry per-building tint and baked ambient occlusion (contact darkening).
// Buffers are growable typed arrays and quads are indexed (4 vertices instead of 6) to keep
// both build time and vertex-shader work low on phones.
import * as THREE from 'three';

const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Darkening of vertical surfaces near the ground (fake contact AO).
const groundAO = (y) => 1 - 0.3 * Math.exp(-Math.max(0, y) / 0.55);
// Soft darkening of walls just below the eaves (sky occlusion by the roof overhang).
const EAVE_BAND = 1.1;
const eaveAO = (y, top) => { const t = (y - (top - EAVE_BAND)) / EAVE_BAND; return t <= 0 ? 1 : 1 - 0.26 * Math.min(1, t) ** 1.5; };

// Box faces: [bit, normal, right(u), up(v), corner indices into (x0|x1, y0|y1, z0|z1) as CCW quads]
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
    this.cap = 8192; this.n = 0; this.ni = 0;
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

export class Geo {
  constructor() {
    this.buckets = new Map();
    this.vcCache = new Map();
  }

  _bucket(mat, o) {
    const cast = o.cast !== false, receive = o.receive !== false, k = (cast ? 2 : 0) + (receive ? 1 : 0);
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = [null, null, null, null]));
    return arr[k] || (arr[k] = new Bucket(mat, cast, receive));
  }

  _tint(o) {
    const t = o.tint ?? 1, ao = o.ao ?? 1;
    return Array.isArray(t) ? [t[0] * ao, t[1] * ao, t[2] * ao] : [t * ao, t * ao, t * ao];
  }

  // Appends one vertex (capacity must be reserved); returns its index.
  _vert(b, x, y, z, nx, ny, nz, u, v, tint, gao, top) {
    const i = b.n++, i3 = i * 3, i2 = i * 2;
    b.P[i3] = x; b.P[i3 + 1] = y; b.P[i3 + 2] = z;
    b.N[i3] = nx; b.N[i3 + 1] = ny; b.N[i3 + 2] = nz;
    b.U[i2] = u; b.U[i2 + 1] = v;
    let k = 1;
    if (ny < 0.5 && ny > -0.5) {
      if (gao) k = groundAO(y);
      if (top) k *= eaveAO(y, top);
    }
    b.C[i3] = tint[0] * k; b.C[i3 + 1] = tint[1] * k; b.C[i3 + 2] = tint[2] * k;
    return i;
  }

  // Axis-aligned box in world space.
  // o: { tint, ao, gao (ground AO, default on), top (eave height for under-eave AO), uvOff:[u,v],
  //      skip (face bitmask), cast, receive }
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const gao = o.gao !== false;
    // Split tall boxes so the AO gradients have vertices where they start.
    if (gao && y0 < 0.8 && y1 > 1.4) {
      this.box(mat, x0, y0, z0, x1, 0.8, z1, { ...o, skip: (o.skip || 0) | 4 });
      this.box(mat, x0, 0.8, z0, x1, y1, z1, { ...o, skip: (o.skip || 0) | 8 });
      return;
    }
    const eb = o.top ? o.top - EAVE_BAND : 0;
    if (o.top && y0 < eb - 0.3 && y1 > eb + 0.05) {
      this.box(mat, x0, y0, z0, x1, eb, z1, { ...o, skip: (o.skip || 0) | 4 });
      this.box(mat, x0, eb, z0, x1, y1, z1, { ...o, skip: (o.skip || 0) | 8 });
      return;
    }
    let skip = o.skip || 0;
    if (y0 <= 0.001) skip |= 8;
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
        this._vert(b, px, py, pz, n[0], n[1], n[2], u, v, tint, gao, top);
      }
      const I = b.I, j = b.ni;
      I[j] = base; I[j + 1] = base + 1; I[j + 2] = base + 2; I[j + 3] = base; I[j + 4] = base + 2; I[j + 5] = base + 3;
      b.ni += 6;
    }
  }

  // Triangle / quad with explicit world positions; winding fixed to face `desired` normal.
  // uvFn(p) -> [u, v] in texture repeats; default is world box projection.
  tri(mat, a, b, c, desired, o = {}, uvFn = null) {
    _a.fromArray(a); _b.fromArray(b); _c.fromArray(c);
    _c.sub(_a);
    _n.subVectors(_b, _a).cross(_c);
    if (_n.lengthSq() < 1e-12) return;
    if (desired && _n.x * desired[0] + _n.y * desired[1] + _n.z * desired[2] < 0) { const t = b; b = c; c = t; _n.negate(); }
    _n.normalize();
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0;
    const tile = mat.userData.tile || 2;
    const f = uvFn || worldUV(_n, tile, o.uvOff);
    bk.reserve(3, 3);
    for (const p of [a, b, c]) {
      const [u, v] = f(p);
      bk.I[bk.ni++] = this._vert(bk, p[0], p[1], p[2], _n.x, _n.y, _n.z, u, v, tint, gao, top);
    }
  }

  quad(mat, a, b, c, d, desired, o = {}, uvFn = null) {
    this.tri(mat, a, b, c, desired, o, uvFn);
    this.tri(mat, a, c, d, desired, o, uvFn);
  }

  // Arbitrary three.js geometry. o.flat recomputes faceted normals, o.flip inverts it, o.keepUV keeps its UVs.
  geom(mat, g, matrix = null, o = {}) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    if (o.flat || !geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position.array, n = geo.attributes.normal.array;
    const uvs = o.keepUV && geo.attributes.uv ? geo.attributes.uv.array : null;
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0;
    const tile = mat.userData.tile || 2, cnt = geo.attributes.position.count;
    const ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0, us = o.uvScale || 1;
    const s = o.flip ? -1 : 1;
    bk.reserve(cnt, cnt);
    for (let i = 0; i < cnt; i += 3) {
      // Per-triangle projection plane for world UVs (same convention as worldUV()).
      const ia = i * 3, ib = ia + 3, ic = ia + 6;
      const e1x = p[ib] - p[ia], e1y = p[ib + 1] - p[ia + 1], e1z = p[ib + 2] - p[ia + 2];
      const e2x = p[ic] - p[ia], e2y = p[ic + 1] - p[ia + 1], e2z = p[ic + 2] - p[ia + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      const plane = ay >= ax && ay >= az ? (ny > 0 ? 0 : 1) : ax >= az ? (nx > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
      for (let t = 0; t < 3; t++) {
        const j = i + (o.flip ? (t === 0 ? 0 : 3 - t) : t), j3 = j * 3;
        const x = p[j3], y = p[j3 + 1], z = p[j3 + 2];
        let u, v;
        if (uvs) { u = uvs[j * 2] * us; v = uvs[j * 2 + 1] * us; }
        else {
          switch (plane) {
            case 0: u = x; v = -z; break;
            case 1: u = x; v = z; break;
            case 2: u = -z; v = y; break;
            case 3: u = z; v = y; break;
            case 4: u = x; v = y; break;
            default: u = -x; v = y;
          }
          u = u / tile + ou; v = v / tile + ov;
        }
        bk.I[bk.ni++] = this._vert(bk, x, y, z, n[j3] * s, n[j3 + 1] * s, n[j3 + 2] * s, u, v, tint, gao, top);
      }
    }
    geo.dispose();
  }

  vcMaterial(mat) {
    let m = this.vcCache.get(mat);
    if (!m) {
      m = mat.clone();
      m.vertexColors = true;
      m.userData.tile = mat.userData.tile;
      this.vcCache.set(mat, m);
    }
    return m;
  }

  finish(scene) {
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
      const mesh = new THREE.Mesh(g, this.vcMaterial(b.mat));
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
      tris += b.ni / 3;
    }
    this.buckets.clear();
    return { meshes, tris };
  }
}

// World-space box projection matching the box() convention.
export function worldUV(n, tile, off) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const ou = off ? off[0] : 0, ov = off ? off[1] : 0;
  if (ay >= ax && ay >= az) return n.y > 0 ? (p) => [p[0] / tile + ou, -p[2] / tile + ov] : (p) => [p[0] / tile + ou, p[2] / tile + ov];
  if (ax >= az) return n.x > 0 ? (p) => [-p[2] / tile + ou, p[1] / tile + ov] : (p) => [p[2] / tile + ou, p[1] / tile + ov];
  return n.z > 0 ? (p) => [p[0] / tile + ou, p[1] / tile + ov] : (p) => [-p[0] / tile + ou, p[1] / tile + ov];
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
