// Geometry accumulator for the static town. Everything is baked in world space into buckets
// keyed by (spatial chunk, LOD level). All opaque town surfaces share ONE texture-array material
// (see textures.js → M.town), so a bucket is one draw call; the texture layer travels in a
// per-vertex `layer` attribute. A handful of special materials (water, jets, lamp glass) get
// whole-town buckets of their own.
//   LOD.BASE   walls with real window reveals, arches, roofs, cornices, ground  (near / mid range)
//   LOD.DETAIL frames, shutters, sills, bars, balconies, pots, lanterns, signs, rafters (near only)
//   LOD.FAR    simplified silhouettes (boxes, roofs, flush window panes) shown instead of BASE far away
// Vertex format (27 bytes): position f32×3, normal i8×3, uv f32×2, colour u8×3 (tint × baked AO at
// half scale: the array shader multiplies by 2), layer u8.
import * as THREE from 'three';

export const LOD = { BASE: 0, DETAIL: 1, FAR: 2 };

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
  constructor(scale) {
    this.scale = scale; // colour byte per unit
    this.cap = scale > 200 ? 1024 : 8192; this.n = 0; this.ni = 0;
    this.P = new Float32Array(this.cap * 3); this.N = new Int8Array(this.cap * 3);
    this.U = new Float32Array(this.cap * 2); this.C = new Uint8Array(this.cap * 3); this.L = new Uint8Array(this.cap);
    this.I = new Uint32Array(this.cap * 2);
  }
  reserve(verts, idx) {
    if (this.n + verts > this.cap) {
      const cap = Math.max(this.cap * 2, this.n + verts);
      const grow = (A, k) => { const B = new A.constructor(cap * k); B.set(A); return B; };
      this.P = grow(this.P, 3); this.N = grow(this.N, 3); this.U = grow(this.U, 2); this.C = grow(this.C, 3); this.L = grow(this.L, 1);
      this.cap = cap;
    }
    if (this.ni + idx > this.I.length) { const B = new Uint32Array(Math.max(this.I.length * 2, this.ni + idx)); B.set(this.I); this.I = B; }
  }
}

export class Geo {
  // town: { material, layers } from textures.js; grid: { x0, z0, cw, ch, nx, nz } chunk grid.
  constructor(town, grid) {
    this.town = town;
    this.grid = grid;
    this.buckets = new Map();   // chunk * 3 + lod -> Bucket
    this.special = new Map();   // THREE.Material -> Bucket
    this.lod = LOD.BASE;
    this.locked = -1;
  }

  chunkOf(x, z) {
    const g = this.grid;
    const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / g.cw)));
    const j = Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.z0) / g.ch)));
    return j * g.nx + i;
  }
  // Keeps every following primitive in the chunk containing (x, z) until unlock(): a building's parts
  // then switch LOD together.
  lock(x, z) { this.locked = this.chunkOf(x, z); }
  unlock() { this.locked = -1; }

  _bucket(mat, x, z) {
    if (mat.isMaterial) {
      let b = this.special.get(mat);
      if (!b) this.special.set(mat, (b = new Bucket(255)));
      return b;
    }
    const k = (this.locked >= 0 ? this.locked : this.chunkOf(x, z)) * 3 + this.lod;
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = new Bucket(127.5)));
    return b;
  }

  _tint(o) {
    const t = o.tint ?? 1, ao = o.ao ?? 1;
    return Array.isArray(t) ? [t[0] * ao, t[1] * ao, t[2] * ao] : [t * ao, t * ao, t * ao];
  }

  // Appends one vertex (capacity must be reserved); returns its index.
  _vert(b, layer, x, y, z, nx, ny, nz, u, v, tint, gao, top) {
    const i = b.n++, i3 = i * 3, i2 = i * 2;
    b.P[i3] = x; b.P[i3 + 1] = y; b.P[i3 + 2] = z;
    b.N[i3] = nx * 127; b.N[i3 + 1] = ny * 127; b.N[i3 + 2] = nz * 127;
    b.U[i2] = u; b.U[i2 + 1] = v;
    b.L[i] = layer;
    let k = b.scale;
    if (ny < 0.5 && ny > -0.5) {
      if (gao) k *= groundAO(y);
      if (top) k *= eaveAO(y, top);
    }
    const r = tint[0] * k, g = tint[1] * k, bl = tint[2] * k;
    b.C[i3] = r > 255 ? 255 : r; b.C[i3 + 1] = g > 255 ? 255 : g; b.C[i3 + 2] = bl > 255 ? 255 : bl;
    return i;
  }

  // Axis-aligned box in world space.
  // o: { tint, ao, gao (ground AO, default on), top (eave height for under-eave AO), uvOff:[u,v], skip (face bitmask) }
  box(mat, x0, y0, z0, x1, y1, z1, o = {}, xs = 0, noGao = false) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const gao = !noGao && o.gao !== false;
    // Foundations below the town floor: no contact AO there.
    if (gao && y0 < -0.05 && y1 > 0.05) {
      this.box(mat, x0, y0, z0, x1, 0, z1, o, xs | 4, true);
      this.box(mat, x0, 0, z0, x1, y1, z1, o, xs | 8, noGao);
      return;
    }
    // Split tall boxes so the AO gradients have vertices where they start.
    if (gao && y0 < 0.8 && y1 > 1.4 && (xs & 51) !== 51) {
      this.box(mat, x0, y0, z0, x1, 0.8, z1, o, xs | 4, noGao);
      this.box(mat, x0, 0.8, z0, x1, y1, z1, o, xs | 8, noGao);
      return;
    }
    const eb = o.top ? o.top - EAVE_BAND : 0;
    if (o.top && y0 < eb - 0.3 && y1 > eb + 0.05 && (xs & 51) !== 51) {
      this.box(mat, x0, y0, z0, x1, eb, z1, o, xs | 4, noGao);
      this.box(mat, x0, eb, z0, x1, y1, z1, o, xs | 8, noGao);
      return;
    }
    let skip = (o.skip || 0) | xs;
    if (y0 <= 0.001 && y0 >= -0.3) skip |= 8;
    const b = this._bucket(mat, (x0 + x1) / 2, (z0 + z1) / 2), tint = this._tint(o), top = o.top || 0;
    const layer = mat.layer | 0, tile = mat.tile || mat.userData?.tile || 2, ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0;
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
        this._vert(b, layer, px, py, pz, n[0], n[1], n[2], u, v, tint, gao, top);
      }
      const I = b.I, j = b.ni;
      I[j] = base; I[j + 1] = base + 1; I[j + 2] = base + 2; I[j + 3] = base; I[j + 4] = base + 2; I[j + 5] = base + 3;
      b.ni += 6;
    }
  }

  // Axis-aligned rectangle facing +/-x, +/-y or +/-z. axis: 'x'|'y'|'z', sgn ±1, c = plane coordinate,
  // (a0,a1) and (b0,b1) the extents along the two other axes in (y,z) for x, (x,z) for y, (x,y) for z.
  // Cheaper than box() when only one face can be seen. Honours gao/top vertical AO splits.
  rect(mat, axis, sgn, c, a0, a1, b0, b1, o = {}) {
    if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4) return;
    const gao = o.gao !== false;
    if (axis !== 'y') {
      // Vertical faces: the second extent pair is y for 'z' and first pair is y for 'x'.
      const ylo = axis === 'x' ? a0 : b0, yhi = axis === 'x' ? a1 : b1;
      const split = (gao && ylo < -0.05 && yhi > 0.05) ? 0 : (gao && ylo < 0.8 && yhi > 1.4) ? 0.8 : (o.top && ylo < o.top - EAVE_BAND - 0.3 && yhi > o.top - EAVE_BAND + 0.05) ? o.top - EAVE_BAND : null;
      if (split !== null) {
        const lo = split === 0 ? { ...o, gao: false } : o;
        if (axis === 'x') { this.rect(mat, axis, sgn, c, a0, split, b0, b1, lo); this.rect(mat, axis, sgn, c, split, a1, b0, b1, o); }
        else { this.rect(mat, axis, sgn, c, a0, a1, b0, split, lo); this.rect(mat, axis, sgn, c, a0, a1, split, b1, o); }
        return;
      }
    }
    let p;
    if (axis === 'x') p = sgn > 0 ? [[c, a0, b1], [c, a0, b0], [c, a1, b0], [c, a1, b1]] : [[c, a0, b0], [c, a0, b1], [c, a1, b1], [c, a1, b0]];
    else if (axis === 'y') p = sgn > 0 ? [[a0, c, b1], [a1, c, b1], [a1, c, b0], [a0, c, b0]] : [[a0, c, b0], [a1, c, b0], [a1, c, b1], [a0, c, b1]];
    else p = sgn > 0 ? [[a0, b0, c], [a1, b0, c], [a1, b1, c], [a0, b1, c]] : [[a1, b0, c], [a0, b0, c], [a0, b1, c], [a1, b1, c]];
    const nx = axis === 'x' ? sgn : 0, ny = axis === 'y' ? sgn : 0, nz = axis === 'z' ? sgn : 0;
    const cx = (p[0][0] + p[2][0]) / 2, cz = (p[0][2] + p[2][2]) / 2;
    const b = this._bucket(mat, cx, cz), tint = this._tint(o), top = o.top || 0;
    const layer = mat.layer | 0, tile = mat.tile || mat.userData?.tile || 2, ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0;
    b.reserve(4, 6);
    const base = b.n;
    for (let k = 0; k < 4; k++) {
      const [x, y, z] = p[k];
      let u, v;
      if (axis === 'y') { u = x; v = sgn > 0 ? -z : z; }
      else if (axis === 'x') { u = sgn > 0 ? -z : z; v = y; }
      else { u = sgn > 0 ? x : -x; v = y; }
      this._vert(b, layer, x, y, z, nx, ny, nz, u / tile + ou, v / tile + ov, tint, gao, top);
    }
    const I = b.I, j = b.ni;
    I[j] = base; I[j + 1] = base + 1; I[j + 2] = base + 2; I[j + 3] = base; I[j + 4] = base + 2; I[j + 5] = base + 3;
    b.ni += 6;
  }

  // Triangle with explicit world positions; winding fixed to face `desired` normal.
  // uvFn(p) -> [u, v] in texture repeats; default is world box projection.
  tri(mat, a, b, c, desired, o = {}, uvFn = null) {
    _a.fromArray(a); _b.fromArray(b); _c.fromArray(c);
    _c.sub(_a);
    _n.subVectors(_b, _a).cross(_c);
    if (_n.lengthSq() < 1e-12) return;
    if (desired && _n.x * desired[0] + _n.y * desired[1] + _n.z * desired[2] < 0) { const t = b; b = c; c = t; _n.negate(); }
    _n.normalize();
    const bk = this._bucket(mat, (a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0;
    const tile = mat.tile || mat.userData?.tile || 2, layer = mat.layer | 0;
    const f = uvFn || worldUV(_n, tile, o.uvOff);
    bk.reserve(3, 3);
    for (const p of [a, b, c]) {
      const [u, v] = f(p);
      bk.I[bk.ni++] = this._vert(bk, layer, p[0], p[1], p[2], _n.x, _n.y, _n.z, u, v, tint, gao, top);
    }
  }

  // Planar quad (a, b, c, d in order) as two triangles sharing vertices.
  quad(mat, a, b, c, d, desired, o = {}, uvFn = null) {
    _a.fromArray(a); _b.fromArray(b); _c.fromArray(c);
    _c.sub(_a);
    _n.subVectors(_b, _a).cross(_c);
    if (_n.lengthSq() < 1e-12) { this.tri(mat, a, c, d, desired, o, uvFn); return; }
    let pts = [a, b, c, d];
    if (desired && _n.x * desired[0] + _n.y * desired[1] + _n.z * desired[2] < 0) { pts = [a, d, c, b]; _n.negate(); }
    _n.normalize();
    const bk = this._bucket(mat, (a[0] + c[0]) / 2, (a[2] + c[2]) / 2), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0;
    const tile = mat.tile || mat.userData?.tile || 2, layer = mat.layer | 0;
    const f = uvFn || worldUV(_n, tile, o.uvOff);
    bk.reserve(4, 6);
    const base = bk.n;
    for (const p of pts) {
      const [u, v] = f(p);
      this._vert(bk, layer, p[0], p[1], p[2], _n.x, _n.y, _n.z, u, v, tint, gao, top);
    }
    const I = bk.I, j = bk.ni;
    I[j] = base; I[j + 1] = base + 1; I[j + 2] = base + 2; I[j + 3] = base; I[j + 4] = base + 2; I[j + 5] = base + 3;
    bk.ni += 6;
  }

  // Arbitrary three.js geometry. o.flat recomputes faceted normals, o.flip inverts it, o.keepUV keeps its UVs.
  geom(mat, g, matrix = null, o = {}) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (matrix) geo.applyMatrix4(matrix);
    if (o.flat || !geo.attributes.normal) geo.computeVertexNormals();
    this._emitArrays(mat, geo.attributes.position.array, geo.attributes.normal.array, o.keepUV && geo.attributes.uv ? geo.attributes.uv.array : null, o);
    geo.dispose();
  }

  // Reusable template: non-indexed position/normal arrays of a unit geometry (see proto()).
  static template(g, flat = true) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (flat) geo.computeVertexNormals();
    const t = { p: geo.attributes.position.array.slice(), n: geo.attributes.normal.array.slice() };
    geo.dispose(); g.dispose();
    return t;
  }
  // Instance of a template scaled (sx, sy, sz), rotated about Y by `rot` and moved to (x, y, z).
  proto(mat, t, x, y, z, sx, sy, sz, rot = 0, o = {}) {
    const cnt = t.p.length, P = this._tp && this._tp.length >= cnt ? this._tp : (this._tp = new Float32Array(cnt));
    const N = this._tn && this._tn.length >= cnt ? this._tn : (this._tn = new Float32Array(cnt));
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < cnt; i += 3) {
      const px = t.p[i] * sx, py = t.p[i + 1] * sy, pz = t.p[i + 2] * sz;
      P[i] = x + px * c + pz * s; P[i + 1] = y + py; P[i + 2] = z - px * s + pz * c;
      // Normals of a non-uniformly scaled shape: scale by the inverse, renormalise.
      let nx = t.n[i] / sx, ny = t.n[i + 1] / sy, nz = t.n[i + 2] / sz;
      const l = 1 / Math.hypot(nx, ny, nz); nx *= l; ny *= l; nz *= l;
      N[i] = nx * c + nz * s; N[i + 1] = ny; N[i + 2] = -nx * s + nz * c;
    }
    this._emitArrays(mat, P, N, null, o, cnt / 3, x, z);
  }

  _emitArrays(mat, p, n, uvs, o, count = p.length / 3, cx = null, cz = null) {
    if (cx === null) { cx = 0; cz = 0; for (let i = 0; i < count; i++) { cx += p[i * 3]; cz += p[i * 3 + 2]; } cx /= count || 1; cz /= count || 1; }
    const bk = this._bucket(mat, cx, cz), tint = this._tint(o), gao = o.gao !== false, top = o.top || 0;
    const tile = mat.tile || mat.userData?.tile || 2, layer = mat.layer | 0;
    const ou = o.uvOff ? o.uvOff[0] : 0, ov = o.uvOff ? o.uvOff[1] : 0, us = o.uvScale || 1;
    const s = o.flip ? -1 : 1;
    bk.reserve(count, count);
    for (let i = 0; i < count; i += 3) {
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
        bk.I[bk.ni++] = this._vert(bk, layer, x, y, z, n[j3] * s, n[j3 + 1] * s, n[j3 + 2] * s, u, v, tint, gao, top);
      }
    }
  }

  // Builds the meshes. Returns { chunks: [{ x0, x1, z0, z1, y0, y1, base, detail, far }], special: Mesh[], tris }.
  finish(scene) {
    const g = this.grid, arrMat = this.town.material;
    const chunks = [];
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      chunks.push({ x0: g.x0 + i * g.cw, x1: g.x0 + (i + 1) * g.cw, z0: g.z0 + j * g.ch, z1: g.z0 + (j + 1) * g.ch, y0: 0, y1: 10, base: null, detail: null, far: null, tris: [0, 0, 0] });
    }
    const tris = [0, 0, 0, 0];
    const make = (b, mat, withLayer) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.P.slice(0, b.n * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(b.N.slice(0, b.n * 3), 3, true));
      geo.setAttribute('uv', new THREE.BufferAttribute(b.U.slice(0, b.n * 2), 2));
      geo.setAttribute('color', new THREE.BufferAttribute(b.C.slice(0, b.n * 3), 3, true));
      if (withLayer) geo.setAttribute('layer', new THREE.BufferAttribute(b.L.slice(0, b.n), 1));
      geo.setIndex(new THREE.BufferAttribute(b.n < 65536 ? new Uint16Array(b.I.subarray(0, b.ni)) : b.I.slice(0, b.ni), 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      return mesh;
    };
    for (const [k, b] of this.buckets) {
      if (!b.n) continue;
      const ci = Math.floor(k / 3), lod = k % 3, c = chunks[ci];
      const mesh = make(b, arrMat, true);
      mesh.castShadow = lod === LOD.BASE; mesh.receiveShadow = true;
      mesh.name = `town-${ci}-${['base', 'detail', 'far'][lod]}`;
      c[['base', 'detail', 'far'][lod]] = mesh;
      c.tris[lod] = b.ni / 3;
      tris[lod] += b.ni / 3;
      if (lod === LOD.BASE) {
        const bb = mesh.geometry.boundingBox;
        c.x0 = Math.min(c.x0, bb.min.x); c.x1 = Math.max(c.x1, bb.max.x); c.z0 = Math.min(c.z0, bb.min.z); c.z1 = Math.max(c.z1, bb.max.z);
        c.y0 = Math.max(-2, bb.min.y); c.y1 = bb.max.y;
      }
    }
    const special = [];
    for (const [mat, b] of this.special) {
      if (!b.n) continue;
      const m = mat.clone();
      m.vertexColors = true;
      m.userData = { ...mat.userData };
      const mesh = make(b, m, false);
      mesh.castShadow = !mat.userData.noCast; mesh.receiveShadow = true;
      mesh.name = 'town-special-' + (mat.name || 'mat');
      special.push(mesh);
      tris[3] += b.ni / 3;
    }
    this.buckets.clear(); this.special.clear();
    return { chunks, special, tris };
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
