// Geometry accumulator for the static town: everything is baked in world space into one
// vertex buffer per (material, shadow flags) so the whole town costs a few dozen draw calls.
// Vertex colours carry per-building tint and baked ambient occlusion (contact darkening).
import * as THREE from 'three';

const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Darkening of vertical surfaces near the ground (fake contact AO).
const groundAO = (y) => 1 - 0.32 * Math.exp(-Math.max(0, y) / 0.55);

// Box faces: [bit, normal, right(u), up(v), corner indices into (x0|x1, y0|y1, z0|z1) as CCW quads]
const FACES = [
  [1, [1, 0, 0], [0, 0, -1], [0, 1, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [2, [-1, 0, 0], [0, 0, 1], [0, 1, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [4, [0, 1, 0], [1, 0, 0], [0, 0, -1], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [8, [0, -1, 0], [1, 0, 0], [0, 0, 1], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [16, [0, 0, 1], [1, 0, 0], [0, 1, 0], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [32, [0, 0, -1], [-1, 0, 0], [0, 1, 0], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

export class Geo {
  constructor() {
    this.buckets = new Map();
    this.vcCache = new Map();
  }

  _bucket(mat, o) {
    const cast = o.cast !== false, receive = o.receive !== false;
    const key = mat.uuid + (cast ? 'c' : '-') + (receive ? 'r' : '-');
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat, cast, receive, pos: [], nrm: [], uv: [], col: [] }));
    return b;
  }

  _tint(o) {
    const t = o.tint ?? 1, ao = o.ao ?? 1;
    return Array.isArray(t) ? [t[0] * ao, t[1] * ao, t[2] * ao] : [t * ao, t * ao, t * ao];
  }

  _vert(b, x, y, z, nx, ny, nz, u, v, tint, gao) {
    b.pos.push(x, y, z); b.nrm.push(nx, ny, nz); b.uv.push(u, v);
    const k = gao && Math.abs(ny) < 0.5 ? groundAO(y) : 1;
    b.col.push(tint[0] * k, tint[1] * k, tint[2] * k);
  }

  // Axis-aligned box in world space. o: { tint, ao, gao, uvOff:[u,v], skip (face bitmask), cast, receive }
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const gao = o.gao !== false;
    // Split tall boxes so the ground AO gradient has vertices close to the ground.
    if (gao && y0 < 0.8 && y1 > 1.4) {
      this.box(mat, x0, y0, z0, x1, 0.8, z1, { ...o, skip: (o.skip || 0) | 4 });
      this.box(mat, x0, 0.8, z0, x1, y1, z1, { ...o, skip: (o.skip || 0) | 8 });
      return;
    }
    let skip = o.skip || 0;
    if (y0 <= 0.001) skip |= 8;
    const b = this._bucket(mat, o), tint = this._tint(o);
    const tile = mat.userData.tile || 2, ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0;
    const X = [x0, x1], Y = [y0, y1], Z = [z0, z1];
    for (const [bit, n, r, up, cs] of FACES) {
      if (skip & bit) continue;
      const P = cs.map(([i, j, k]) => [X[i], Y[j], Z[k]]);
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const p = P[idx];
        const u = (p[0] * r[0] + p[1] * r[1] + p[2] * r[2]) / tile + ou;
        const v = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / tile + ov;
        this._vert(b, p[0], p[1], p[2], n[0], n[1], n[2], u, v, tint, gao);
      }
    }
  }

  // Triangle / quad with explicit world positions; winding fixed to face `desired` normal.
  // uvFn(p) -> [u, v] in texture repeats; default is world box projection.
  tri(mat, a, b, c, desired, o = {}, uvFn = null) {
    _a.fromArray(a); _b.fromArray(b); _c.fromArray(c);
    _n.subVectors(_b, _a).cross(_c.clone().sub(_a));
    if (_n.lengthSq() < 1e-12) return;
    if (desired && _n.x * desired[0] + _n.y * desired[1] + _n.z * desired[2] < 0) { const t = b; b = c; c = t; _n.negate(); }
    _n.normalize();
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false;
    const tile = mat.userData.tile || 2;
    const f = uvFn || worldUV(_n, tile, o.uvOff);
    for (const p of [a, b, c]) {
      const [u, v] = f(p);
      this._vert(bk, p[0], p[1], p[2], _n.x, _n.y, _n.z, u, v, tint, gao);
    }
  }

  quad(mat, a, b, c, d, desired, o = {}, uvFn = null) {
    this.tri(mat, a, b, c, desired, o, uvFn);
    this.tri(mat, a, c, d, desired, o, uvFn);
  }

  // Arbitrary three.js geometry. o.flat recomputes faceted normals, o.flip inverts it, o.keepUV keeps its UVs.
  geom(mat, g, matrix = null, o = {}) {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    if (o.flat || !geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position.array, n = geo.attributes.normal.array;
    const uvs = o.keepUV && geo.attributes.uv ? geo.attributes.uv.array : null;
    const bk = this._bucket(mat, o), tint = this._tint(o), gao = o.gao !== false;
    const tile = mat.userData.tile || 2, cnt = geo.attributes.position.count;
    for (let i = 0; i < cnt; i += 3) {
      // Per-triangle projection plane for world UVs.
      const ia = i * 3, ib = ia + 3, ic = ia + 6;
      _a.set(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
      _b.set(p[ic] - p[ia], p[ic + 1] - p[ia + 1], p[ic + 2] - p[ia + 2]);
      _n.crossVectors(_a, _b);
      const f = worldUV(_n.normalize(), tile, o.uvOff);
      const order = o.flip ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        const j = i + k, q = [p[j * 3], p[j * 3 + 1], p[j * 3 + 2]];
        const [u, v] = uvs ? [uvs[j * 2] * (o.uvScale || 1), uvs[j * 2 + 1] * (o.uvScale || 1)] : f(q);
        const s = o.flip ? -1 : 1;
        this._vert(bk, q[0], q[1], q[2], n[j * 3] * s, n[j * 3 + 1] * s, n[j * 3 + 2] * s, u, v, tint, gao);
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
    for (const b of this.buckets.values()) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, this.vcMaterial(b.mat));
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
      tris += b.pos.length / 9;
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
