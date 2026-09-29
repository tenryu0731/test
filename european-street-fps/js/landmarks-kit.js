// Building kit for the countryside landmarks. A Kit is a local frame on a site: positions are
// given in local metres (y = 0 on the site pad) and mapped to world space through a 90°-step
// rotation (+ optional mirror), so colliders stay axis-aligned Box3s and whole compounds can be
// re-arranged per site. Every primitive writes into the site's main (G) or detail (D, o.d = true)
// geometry accumulator; `col` options also register colliders.
import * as THREE from 'three';
import { T_cyl, T_cone, T_blob, T_cypress, T_dome, T_pot, T_beam } from './landmarks-geo.js';

const ROT = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]];
const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const arcN = (r) => Math.min(12, Math.max(6, Math.round(5 + r * 3)));

export class Kit {
  // world x = a·x + b·z + tx ; world z = c·x + d·z + tz ; world y = y + ty
  constructor(ctx, a, b, c, d, tx, ty, tz) {
    this.ctx = ctx; this.M = ctx.M; this.L = ctx.L;
    this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty; this.tz = tz;
  }
  static root(ctx, x, y, z) { return new Kit(ctx, 1, 0, 0, 1, x, y, z); }
  // Child frame at local (x, z), rotated rot × 90° (local +z "front" → S, E, N, W for rot 0..3).
  frame(x, z, rot = 0, mir = false, y = 0) {
    let [ra, rb, rc, rd] = ROT[rot & 3];
    if (mir) { ra = -ra; rc = -rc; }
    return new Kit(this.ctx, this.a * ra + this.b * rc, this.a * rb + this.b * rd, this.c * ra + this.d * rc, this.c * rb + this.d * rd,
      this.a * x + this.b * z + this.tx, this.ty + y, this.c * x + this.d * z + this.tz);
  }
  P(x, y, z) { return [this.a * x + this.b * z + this.tx, y + this.ty, this.c * x + this.d * z + this.tz]; }
  N(x, y, z) { return [this.a * x + this.b * z, y, this.c * x + this.d * z]; }
  V(x, y, z) { const p = this.P(x, y, z); return new THREE.Vector3(p[0], p[1], p[2]); }
  wx(x, z) { return this.a * x + this.b * z + this.tx; }
  wz(x, z) { return this.c * x + this.d * z + this.tz; }
  // Local heading (radians, 0 = local -z) → world yaw (0 looks -Z).
  yaw(a) { const dx = -Math.sin(a), dz = -Math.cos(a); const w = this.N(dx, 0, dz); return Math.atan2(-w[0], -w[2]); }
  geo(o) { return o && o.d ? this.ctx.D : this.ctx.G; }
  _o(o) { return o.gy !== undefined ? { ...o, gy: o.gy + this.ty } : o; }

  // ---------------------------------------------------------------- primitives
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    const p0 = this.P(x0, y0, z0), p1 = this.P(x1, y1, z1);
    const oo = o.skip ? { ...this._o(o), skip: o.skip & 12 } : this._o(o);
    this.geo(o).box(mat, Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), Math.max(p0[2], p1[2]), oo);
    if (o.col) this.col(x0, y0, z0, x1, y1, z1);
  }
  col(x0, y0, z0, x1, y1, z1) {
    const p0 = this.P(x0, y0, z0), p1 = this.P(x1, y1, z1);
    const b = new THREE.Box3(new THREE.Vector3(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.min(p0[2], p1[2])),
      new THREE.Vector3(Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), Math.max(p0[2], p1[2])));
    this.ctx.col.push(b);
    return b;
  }
  sbox(mat, x0, y0, z0, x1, y1, z1, o = {}) { this.box(mat, x0, y0, z0, x1, y1, z1, { ...o, col: true }); }
  // Quad / triangle from local points; n = desired local normal. uv: { e, up, o } local vectors
  // (u along e, v along up, from origin o) or a function of the world point.
  _uv(mat, uv) {
    if (!uv || typeof uv === 'function') return uv;
    const tile = mat.userData.tile || 2, e = this.N(...uv.e), up = this.N(...uv.up), o = this.P(...(uv.o || [0, 0, 0]));
    const su = uv.su || 1, sv = uv.sv || 1;
    return (p) => [((p[0] - o[0]) * e[0] + (p[1] - o[1]) * e[1] + (p[2] - o[2]) * e[2]) / tile * su,
      ((p[0] - o[0]) * up[0] + (p[1] - o[1]) * up[1] + (p[2] - o[2]) * up[2]) / tile * sv];
  }
  quad(mat, a, b, c, d, n, o = {}, uv = null) {
    const f = this._uv(mat, uv), g = this.geo(o), oo = this._o(o), nn = n ? this.N(...n) : null;
    const A = this.P(...a), B = this.P(...b), C = this.P(...c), D = this.P(...d);
    g.tri(mat, A, B, C, nn, oo, f); g.tri(mat, A, C, D, nn, oo, f);
  }
  tri(mat, a, b, c, n, o = {}, uv = null) {
    this.geo(o).tri(mat, this.P(...a), this.P(...b), this.P(...c), n ? this.N(...n) : null, this._o(o), this._uv(mat, uv));
  }
  // Template at local (x, y, z), scaled (sx, sy, sz), rotated ry about Y.
  tpl(mat, T, x, y, z, sx, sy, sz, ry = 0, o = {}) {
    const cr = Math.cos(ry), sr = Math.sin(ry), a = this.a, b = this.b, c = this.c, d = this.d;
    const r00 = a * cr - b * sr, r02 = a * sr + b * cr, r20 = c * cr - d * sr, r22 = c * sr + d * cr;
    const p = this.P(x, y, z);
    const m = [r00 * sx, 0, r02 * sz, p[0], 0, sy, 0, p[1], r20 * sx, 0, r22 * sz, p[2]];
    const nm = [r00 / sx, 0, r02 / sz, 0, 1 / sy, 0, r20 / sx, 0, r22 / sz];
    this.geo(o).tpl(mat, T, m, nm, this._o(o));
  }
  // Template with an arbitrary local Matrix4.
  tplM(mat, T, local, o = {}) {
    _m4.set(this.a, 0, this.b, this.tx, 0, 1, 0, this.ty, this.c, 0, this.d, this.tz, 0, 0, 0, 1).multiply(local);
    const e = _m4.elements;
    const m = [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
    _n3.getNormalMatrix(_m4);
    const n = _n3.elements;
    const nm = [n[0], n[3], n[6], n[1], n[4], n[7], n[2], n[5], n[8]];
    this.geo(o).tpl(mat, T, m, nm, this._o(o));
  }
  // Square-section beam between two local points (w wide, h tall; `up` hint keeps it level).
  beam(mat, p0, p1, w, h = w, o = {}) {
    _v.set(...p0); _v2.set(...p1);
    const len = _v.distanceTo(_v2);
    if (len < 1e-4) return;
    _m4b.lookAt(_v2, _v, _v3.set(0, 1, 0));
    if (Math.abs(_v2.x - _v.x) < 1e-6 && Math.abs(_v2.z - _v.z) < 1e-6) _m4b.lookAt(_v2, _v, _v3.set(1, 0, 0));
    _q.setFromRotationMatrix(_m4b);
    _m4b.compose(_v, _q, _s.set(w, h, len));
    this.tplM(mat, T_beam(), _m4b, o);
  }
  cyl(mat, x, y0, z, r, h, segs = 8, o = {}) { this.tpl(mat, T_cyl(segs), x, y0, z, r, h, r, o.ry || 0, o); }
  cone(mat, x, y0, z, r, h, segs = 8, o = {}) { this.tpl(mat, T_cone(segs), x, y0, z, r, h, r, o.ry || 0, o); }
  blob(mat, x, y, z, rx, ry, rz, o = {}) { this.tpl(mat, T_blob(o.detail ?? 1), x, y, z, rx, ry, rz, o.rot || 0, { gao: false, ...o }); }

  // ---------------------------------------------------------------- faces
  // Face of the rectangle [x0,x1]×[z0,z1] on side dir ('N' = -z, 'S' = +z, 'E' = +x, 'W' = -x).
  // t runs along the face (left → right seen from outside), d outward from the face plane.
  face(x0, x1, z0, z1, dir) {
    switch (dir) {
      case 'N': return { dir, W: x1 - x0, ox: x1, oz: z0, tx: -1, tz: 0, dx: 0, dz: -1 };
      case 'S': return { dir, W: x1 - x0, ox: x0, oz: z1, tx: 1, tz: 0, dx: 0, dz: 1 };
      case 'W': return { dir, W: z1 - z0, ox: x0, oz: z0, tx: 0, tz: 1, dx: -1, dz: 0 };
      default: return { dir, W: z1 - z0, ox: x1, oz: z1, tx: 0, tz: -1, dx: 1, dz: 0 };
    }
  }
  // Sub-face shifted along t by s0 with width W.
  subFace(f, s0, W) { return { ...f, W, ox: f.ox + f.tx * s0, oz: f.oz + f.tz * s0 }; }
  fp(f, t, y, d) { return [f.ox + f.tx * t + f.dx * d, y, f.oz + f.tz * t + f.dz * d]; }
  fbox(f, mat, t0, t1, y0, y1, d0, d1, o = {}) {
    const xa = f.ox + f.tx * t0 + f.dx * d0, xb = f.ox + f.tx * t1 + f.dx * d1;
    const za = f.oz + f.tz * t0 + f.dz * d0, zb = f.oz + f.tz * t1 + f.dz * d1;
    this.box(mat, Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), o);
  }
  fquad(f, mat, t0, t1, y0, y1, d, o = {}, n = null) {
    this.quad(mat, this.fp(f, t0, y0, d), this.fp(f, t1, y0, d), this.fp(f, t1, y1, d), this.fp(f, t0, y1, d), n || [f.dx, 0, f.dz], o);
  }

  // Wall slab on a face from d0 (inside) to d1 (outer plane) with openings.
  // ops: [{ t0, t1, y0, y1, arch, fill: 'glass'|'door'|'dark'|'open'|'shut'|'grille', frame, ring, shutters, bifora }]
  // Openings sharing a column must share t0/t1. o.col registers colliders for the solid pieces.
  wall(f, y0, y1, d0, d1, mat, ops = [], o = {}) {
    const M = this.M;
    const list = [];
    for (const op of ops) {
      if (op.bifora) {
        const tc = (op.t0 + op.t1) / 2, g = op.pier ?? 0.22;
        const sub = { ...op, bifora: false, ring: false, frame: false };
        list.push({ ...sub, t1: tc - g / 2 }, { ...sub, t0: tc + g / 2 });
        const rs = (tc - g / 2 - op.t0) / 2, R = (op.t1 - op.t0) / 2;
        // Colonnette with capital in front of the pier, outer relief arch spanning both lights.
        const cp = this.fp(f, tc, 0, d1 - 0.12);
        this.cyl(M.stoneTrim, cp[0], op.y0, cp[2], 0.085, op.y1 - op.y0 - 0.18, 8, { d: true });
        this.fbox(f, M.stoneTrim, tc - 0.16, tc + 0.16, op.y1 - 0.2, op.y1 + 0.02, d1 - 0.3, d1 - 0.02, { gao: false });
        if (op.ring !== false) this.ring(f, tc, op.y1, R + 0.02, 0.2, d1, d1 + 0.05, M.stoneTrim, { gao: false });
        void rs;
      } else list.push(op);
    }
    list.sort((a, b) => a.t0 - b.t0 || a.y0 - b.y0);
    const groups = [];
    for (const op of list) {
      const g = groups.find((q) => Math.abs(q.t0 - op.t0) < 1e-3 && Math.abs(q.t1 - op.t1) < 1e-3);
      if (g) g.ops.push(op); else groups.push({ t0: op.t0, t1: op.t1, ops: [op] });
    }
    groups.sort((a, b) => a.t0 - b.t0);
    const oc = { ...o, col: !!o.col };
    let t = 0;
    for (const g of groups) {
      if (g.t0 > t + 1e-4) this.fbox(f, mat, t, g.t0, y0, y1, d0, d1, oc);
      let y = y0;
      g.ops.sort((a, b) => a.y0 - b.y0);
      for (const op of g.ops) {
        if (op.y0 > y + 1e-4) this.fbox(f, mat, op.t0, op.t1, y, op.y0, d0, d1, oc);
        if (op.arch) {
          const r = (op.t1 - op.t0) / 2, top = op.y1 + r + (op.archTop ?? 0.02);
          const back = op.fill === 'open' || op.fill === undefined && o.back || o.back === true;
          this.spandrel(f, mat, (op.t0 + op.t1) / 2, op.y1, r, top, d0, d1, o, back);
          y = top;
        } else y = op.y1;
        this.fill(f, op, d0, d1, o);
      }
      if (y < y1 - 1e-4) this.fbox(f, mat, g.t0, g.t1, y, y1, d0, d1, oc);
      t = g.t1;
    }
    if (t < f.W - 1e-4) this.fbox(f, mat, t, f.W, y0, y1, d0, d1, oc);
  }
  // Wall above a semicircular opening: from the arc up to `top`; intrados across the reveal.
  spandrel(f, mat, tc, spring, r, top, d0, d1, o = {}, back = false) {
    const n = arcN(r), out = [f.dx, 0, f.dz], inn = [-f.dx, 0, -f.dz], oo = { gao: false, ...o };
    const oi = { ...oo, ao: (o.ao ?? 1) * 0.82 };
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * (1 - k / n), a1 = Math.PI * (1 - (k + 1) / n), am = (a0 + a1) / 2;
      const ta = tc + r * Math.cos(a0), ya = spring + r * Math.sin(a0), tb = tc + r * Math.cos(a1), yb = spring + r * Math.sin(a1);
      this.quad(mat, this.fp(f, ta, ya, d1), this.fp(f, tb, yb, d1), this.fp(f, tb, top, d1), this.fp(f, ta, top, d1), out, oo);
      if (back) this.quad(mat, this.fp(f, ta, ya, d0), this.fp(f, tb, yb, d0), this.fp(f, tb, top, d0), this.fp(f, ta, top, d0), inn, oo);
      const cm = Math.cos(am), sm = Math.sin(am);
      this.quad(mat, this.fp(f, ta, ya, d0), this.fp(f, tb, yb, d0), this.fp(f, tb, yb, d1), this.fp(f, ta, ya, d1), [-cm * f.tx, -sm, -cm * f.tz], oi);
    }
  }
  // Arch ring (archivolt) of inner radius r, width w, between d0 and d1 (front face at d1).
  ring(f, tc, spring, r, w, d0, d1, mat, o = {}, keystone = false) {
    const R = r + w, n = arcN(r), out = [f.dx, 0, f.dz], oo = { gao: false, ...o };
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * (1 - k / n), a1 = Math.PI * (1 - (k + 1) / n), am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), cm = Math.cos(am), sm = Math.sin(am);
      const i0 = [tc + r * c0, spring + r * s0], i1 = [tc + r * c1, spring + r * s1], e0 = [tc + R * c0, spring + R * s0], e1 = [tc + R * c1, spring + R * s1];
      this.quad(mat, this.fp(f, i0[0], i0[1], d1), this.fp(f, i1[0], i1[1], d1), this.fp(f, e1[0], e1[1], d1), this.fp(f, e0[0], e0[1], d1), out, oo);
      this.quad(mat, this.fp(f, e0[0], e0[1], d0), this.fp(f, e1[0], e1[1], d0), this.fp(f, e1[0], e1[1], d1), this.fp(f, e0[0], e0[1], d1), [cm * f.tx, sm, cm * f.tz], oo);
      if (d1 - d0 > 0.08) this.quad(mat, this.fp(f, i0[0], i0[1], d0), this.fp(f, i1[0], i1[1], d0), this.fp(f, i1[0], i1[1], d1), this.fp(f, i0[0], i0[1], d1), [-cm * f.tx, -sm, -cm * f.tz], oo);
    }
    if (keystone) this.fbox(f, mat, tc - 0.14, tc + 0.14, spring + r - 0.04, spring + R + 0.08, d0, d1 + 0.03, oo);
  }
  // Half disc (lunette) at depth d.
  halfDisc(f, mat, tc, spring, r, d, o = {}) {
    const n = arcN(r), c = this.fp(f, tc, spring, d), out = [f.dx, 0, f.dz];
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * (1 - k / n), a1 = Math.PI * (1 - (k + 1) / n);
      this.tri(mat, c, this.fp(f, tc + r * Math.cos(a0), spring + r * Math.sin(a0), d), this.fp(f, tc + r * Math.cos(a1), spring + r * Math.sin(a1), d), out, { gao: false, ...o });
    }
  }
  // Opening infill, frame, shutters.
  fill(f, op, d0, d1, o = {}) {
    const M = this.M, { t0, t1, y0, y1 } = op, w = t1 - t0, r = w / 2, tc = (t0 + t1) / 2;
    const kind = op.fill || 'glass';
    const inset = op.inset ?? Math.min(0.2, (d1 - d0) * 0.5);
    const di = d1 - inset;
    if (kind === 'glass' || kind === 'door' || kind === 'shut') {
      const mat = kind === 'glass' ? M.glass : kind === 'door' ? M.door : M.shutters[op.shutMat ?? 0];
      this.fquad(f, mat, t0, t1, y0, y1, di, { gao: kind === 'door', ao: kind === 'glass' ? 0.8 : 0.9 });
      if (op.arch) this.halfDisc(f, kind === 'door' ? M.door : mat, tc, y1, r, di, { ao: 0.85 });
      if (kind === 'glass' && w > 0.5) { // mullion / transom in dark wood
        this.fbox(f, M.wood, tc - 0.03, tc + 0.03, y0, y1 + (op.arch ? r * 0.9 : 0), di, di + 0.04, { ao: 0.6, gao: false, d: true });
        if (y1 - y0 > 1.2) this.fbox(f, M.wood, t0, t1, y0 + (y1 - y0) * 0.62, y0 + (y1 - y0) * 0.62 + 0.05, di, di + 0.04, { ao: 0.6, gao: false, d: true });
      }
      if (kind === 'door') this.fbox(f, M.stoneTrim, t0 - 0.05, t1 + 0.05, y0 - 0.2, y0 + 0.06, di - 0.05, d1 + 0.15, { gao: false });
    } else if (kind === 'dark') {
      this.fquad(f, M.stone, t0, t1, y0, y1, d0 + 0.02, { tint: 0.07, gao: false });
      if (op.arch) this.halfDisc(f, M.stone, tc, y1, r, d0 + 0.02, { tint: 0.07 });
    } else if (kind === 'grille') {
      this.fquad(f, M.stone, t0, t1, y0, y1, d0 + 0.02, { tint: 0.08, gao: false });
      if (op.arch) this.halfDisc(f, M.stone, tc, y1, r, d0 + 0.02, { tint: 0.08 });
      for (let k = 1; k < Math.max(2, Math.round(w / 0.16)); k++) {
        const tk = t0 + (w * k) / Math.max(2, Math.round(w / 0.16));
        this.fbox(f, M.iron, tk - 0.012, tk + 0.012, y0, y1 + (op.arch ? r * 0.8 : 0), di - 0.02, di + 0.01, { gao: false, d: true });
      }
    }
    if (op.frame) {
      const fw = op.frameW ?? 0.14, fp = 0.05, T = M.stoneTrim, fo = { gao: false, tint: op.frameTint ?? 1 };
      if (kind !== 'door') this.fbox(f, T, t0 - fw - 0.04, t1 + fw + 0.04, y0 - 0.12, y0, d0 + 0.05, d1 + fp + 0.04, fo); // sill
      this.fbox(f, T, t0 - fw, t0, y0, y1, d1 - 0.02, d1 + fp, fo);
      this.fbox(f, T, t1, t1 + fw, y0, y1, d1 - 0.02, d1 + fp, fo);
      if (op.arch) this.ring(f, tc, y1, r, fw, d1 - 0.02, d1 + fp, T, fo, op.keystone);
      else {
        this.fbox(f, T, t0 - fw, t1 + fw, y1, y1 + fw * 1.3, d1 - 0.02, d1 + fp, fo);
        if (op.pediment) this.fbox(f, T, t0 - fw - 0.1, t1 + fw + 0.1, y1 + fw * 1.3, y1 + fw * 1.3 + 0.1, d1 - 0.02, d1 + fp + 0.08, fo);
      }
    } else if (op.arch && op.ring) {
      this.ring(f, tc, y1, r, op.ringW ?? 0.22, d1 - 0.02, d1 + 0.04, M.stoneTrim, { gao: false, tint: op.frameTint ?? 1 }, op.keystone);
    }
    if (op.shutters !== undefined && kind === 'glass') {
      const sm = M.shutters[op.shutters], hw = w / 2, yt = y1 + (op.arch ? r : 0);
      for (const [a, b] of [[t0 - hw - 0.02, t0 - 0.02], [t1 + 0.02, t1 + hw + 0.02]]) this.fbox(f, sm, a, b, y0, yt, d1 + 0.02, d1 + 0.06, { gao: false, d: true });
    }
  }

  // ---------------------------------------------------------------- roofs
  // Gable (ridge along `axis`) or hip roof with overhang, soffit, fascia and ridge caps.
  // Gable end triangles use o.wall (material) with o.wallTint. Returns the ridge height.
  roof(x0, x1, z0, z1, H, o = {}) {
    const M = this.M, roof = o.mat || M.roof, tile = roof.userData.tile || 1.5;
    const tp = Math.tan(o.pitch ?? 0.36), ov = o.ov ?? 0.5;
    const alongX = o.axis ? o.axis === 'x' : x1 - x0 >= z1 - z0;
    const hip = !!o.hip;
    const A0 = (alongX ? x0 : z0) - ov, A1 = (alongX ? x1 : z1) + ov;
    const B0 = (alongX ? z0 : x0) - ov, B1 = (alongX ? z1 : x1) + ov;
    const half = (B1 - B0) / 2, Bc = (B0 + B1) / 2;
    const ye = H - ov * tp, Hr = H + (half - ov) * tp;
    let Ar0 = A0, Ar1 = A1;
    if (hip) { Ar0 = Math.min(A0 + half, (A0 + A1) / 2); Ar1 = Math.max(A1 - half, (A0 + A1) / 2); }
    const P = (a, y, b) => (alongX ? [a, y, b] : [b, y, a]);
    const D = (da, dy, db) => (alongX ? [da, dy, db] : [db, dy, da]);
    const n1 = Math.hypot(1, tp), ro = { gao: false, tint: o.tint ?? 1, d: o.d };
    const planes = [];
    planes.push({ pts: [P(A0, ye, B0), P(A1, ye, B0), P(Ar1, Hr, Bc), P(Ar0, Hr, Bc)], n: D(0, 1, -tp), e: D(1, 0, 0), up: D(0, tp / n1, 1 / n1), o: P(A0, ye, B0) });
    planes.push({ pts: [P(A1, ye, B1), P(A0, ye, B1), P(Ar0, Hr, Bc), P(Ar1, Hr, Bc)], n: D(0, 1, tp), e: D(1, 0, 0), up: D(0, tp / n1, -1 / n1), o: P(A0, ye, B1) });
    if (hip) {
      planes.push({ pts: [P(A0, ye, B1), P(A0, ye, B0), P(Ar0, Hr, Bc)], n: D(-tp, 1, 0), e: D(0, 0, 1), up: D(1 / n1, tp / n1, 0), o: P(A0, ye, B0) });
      planes.push({ pts: [P(A1, ye, B0), P(A1, ye, B1), P(Ar1, Hr, Bc)], n: D(tp, 1, 0), e: D(0, 0, 1), up: D(-1 / n1, tp / n1, 0), o: P(A1, ye, B0) });
    }
    for (const pl of planes) {
      const uv = { e: pl.e, up: pl.up, o: pl.o };
      const under = pl.pts.map((p) => [p[0], p[1] - 0.12, p[2]]);
      const dn = [-pl.n[0], -pl.n[1], -pl.n[2]];
      if (pl.pts.length === 4) {
        this.quad(roof, ...pl.pts, pl.n, ro, uv);
        if (ov > 0.05) this.quad(M.wood, ...under, dn, { gao: false, ao: 0.6, d: o.d });
      } else {
        this.tri(roof, ...pl.pts, pl.n, ro, uv);
        if (ov > 0.05) this.tri(M.wood, ...under, dn, { gao: false, ao: 0.6, d: o.d });
      }
      const [a, b] = pl.pts;
      this.quad(roof, [a[0], a[1] - 0.16, a[2]], [b[0], b[1] - 0.16, b[2]], b, a, [pl.n[0], 0, pl.n[2]], { ...ro, ao: 0.55 });
    }
    if (!hip) {
      const wa0 = alongX ? x0 : z0, wa1 = alongX ? x1 : z1, wb0 = alongX ? z0 : x0, wb1 = alongX ? z1 : x1;
      const HrW = H + ((wb1 - wb0) / 2) * tp;
      if (o.wall && o.gables !== false) {
        const wo = { tint: o.wallTint ?? 1, gao: false, d: o.d };
        if (o.gables !== 'end1') this.tri(o.wall, P(wa0, H, wb0), P(wa0, H, wb1), P(wa0, HrW, Bc), D(-1, 0, 0), wo);
        if (o.gables !== 'end0') this.tri(o.wall, P(wa1, H, wb0), P(wa1, H, wb1), P(wa1, HrW, Bc), D(1, 0, 0), wo);
      }
      for (const [Aend, s] of [[A0, -1], [A1, 1]]) for (const Bend of [B0, B1]) {
        const lo = P(Aend, ye, Bend), hi = P(Aend, Hr, Bc);
        this.quad(roof, [lo[0], lo[1] - 0.16, lo[2]], [hi[0], hi[1] - 0.16, hi[2]], hi, lo, D(s, 0, 0), { ...ro, ao: 0.6 });
      }
    }
    if (Ar1 - Ar0 > 0.05) this.halfTube(roof, P(Ar0, Hr + 0.02, Bc), P(Ar1, Hr + 0.02, Bc), 0.14, ro);
    if (hip) for (const [ae, ar] of [[A0, Ar0], [A1, Ar1]]) for (const be of [B0, B1]) this.halfTube(roof, P(ae, ye + 0.02, be), P(ar, Hr + 0.02, Bc), 0.12, ro, 4);
    return Hr;
  }
  // Pyramid roof over a rectangle with eaves at H and apex h above it.
  pyramid(x0, x1, z0, z1, H, h, o = {}) {
    const M = this.M, roof = o.mat || M.roof, ov = o.ov ?? 0.4;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2 + ov, hz = (z1 - z0) / 2 + ov;
    const k = h / Math.min((x1 - x0) / 2, (z1 - z0) / 2), ye = H - ov * k;
    const ap = [cx, H + h, cz], c = [[cx - hx, ye, cz - hz], [cx + hx, ye, cz - hz], [cx + hx, ye, cz + hz], [cx - hx, ye, cz + hz]];
    const ro = { gao: false, tint: o.tint ?? 1, d: o.d };
    const sides = [[0, 1, [0, 0, -1]], [1, 2, [1, 0, 0]], [2, 3, [0, 0, 1]], [3, 0, [-1, 0, 0]]];
    for (const [i, j, dn] of sides) {
      const a = c[i], b = c[j], e = [b[0] - a[0], 0, b[2] - a[2]], el = Math.hypot(e[0], e[2]);
      const mid = [(a[0] + b[0]) / 2, ye, (a[2] + b[2]) / 2], up = [ap[0] - mid[0], ap[1] - mid[1], ap[2] - mid[2]], ul = Math.hypot(...up);
      const n = [dn[0], (Math.abs(dn[0]) ? hx : hz) / h, dn[2]];
      this.tri(roof, a, b, ap, n, ro, { e: [e[0] / el, 0, e[2] / el], up: [up[0] / ul, up[1] / ul, up[2] / ul], o: a });
      this.quad(roof, [a[0], a[1] - 0.15, a[2]], [b[0], b[1] - 0.15, b[2]], b, a, dn, { ...ro, ao: 0.55 });
      if (ov > 0.05) this.tri(M.wood, [a[0], a[1] - 0.12, a[2]], [b[0], b[1] - 0.12, b[2]], [ap[0], ap[1] - 0.12, ap[2]], [-n[0], -n[1], -n[2]], { gao: false, ao: 0.6, d: o.d });
      this.halfTube(roof, [a[0], a[1] + 0.02, a[2]], [ap[0], ap[1] + 0.02, ap[2]], 0.11, ro, 4);
    }
    return H + h;
  }
  // Lean-to roof: low edge on side `low` ('N','S','E','W') at yl, high edge at yh.
  lean(x0, x1, z0, z1, yl, yh, low, o = {}) {
    const M = this.M, roof = o.mat || M.roof, ov = o.ov ?? 0.35, ro = { gao: false, tint: o.tint ?? 1, d: o.d };
    const X0 = x0 - (o.ovSides ?? ov), X1 = x1 + (o.ovSides ?? ov), Z0 = z0 - (o.ovSides ?? ov), Z1 = z1 + (o.ovSides ?? ov);
    let a, b, c, d, n, e, up;
    const run = low === 'N' || low === 'S' ? z1 - z0 : x1 - x0, k = (yh - yl) / run, yo = yl - ov * k;
    if (low === 'N') { a = [X1, yo, z0 - ov]; b = [X0, yo, z0 - ov]; c = [X0, yh, z1]; d = [X1, yh, z1]; n = [0, 1, -k]; e = [1, 0, 0]; up = [0, k, 1]; }
    else if (low === 'S') { a = [X0, yo, z1 + ov]; b = [X1, yo, z1 + ov]; c = [X1, yh, z0]; d = [X0, yh, z0]; n = [0, 1, k]; e = [1, 0, 0]; up = [0, k, -1]; }
    else if (low === 'W') { a = [x0 - ov, yo, Z0]; b = [x0 - ov, yo, Z1]; c = [x1, yh, Z1]; d = [x1, yh, Z0]; n = [-k, 1, 0]; e = [0, 0, 1]; up = [1, k, 0]; }
    else { a = [x1 + ov, yo, Z1]; b = [x1 + ov, yo, Z0]; c = [x0, yh, Z0]; d = [x0, yh, Z1]; n = [k, 1, 0]; e = [0, 0, 1]; up = [-1, k, 0]; }
    const ul = Math.hypot(...up);
    this.quad(roof, a, b, c, d, n, ro, { e, up: up.map((v) => v / ul), o: a });
    const dn = [n[0] ? Math.sign(n[0]) : 0, 0, n[2] ? Math.sign(n[2]) : 0];
    this.quad(roof, [a[0], a[1] - 0.15, a[2]], [b[0], b[1] - 0.15, b[2]], b, a, dn, { ...ro, ao: 0.55 });
    this.quad(M.wood, [a[0], a[1] - 0.1, a[2]], [b[0], b[1] - 0.1, b[2]], [c[0], c[1] - 0.1, c[2]], [d[0], d[1] - 0.1, d[2]], [-n[0], -1, -n[2]], { gao: false, ao: 0.55, d: o.d });
    // Barge edges.
    this.quad(roof, [b[0], b[1] - 0.15, b[2]], [c[0], c[1] - 0.15, c[2]], c, b, null, { ...ro, ao: 0.6 });
    this.quad(roof, [d[0], d[1] - 0.15, d[2]], [a[0], a[1] - 0.15, a[2]], a, d, null, { ...ro, ao: 0.6 });
    if (o.wall) {
      const wo = { gao: false, tint: o.wallTint ?? 1, d: o.d };
      if (low === 'N' || low === 'S') {
        const zl = low === 'N' ? z0 : z1, zh = low === 'N' ? z1 : z0;
        for (const x of [x0, x1]) this.tri(o.wall, [x, yl, zl], [x, yh, zh], [x, yl, zh], [x === x0 ? -1 : 1, 0, 0], wo);
      } else {
        const xl = low === 'W' ? x0 : x1, xh = low === 'W' ? x1 : x0;
        for (const z of [z0, z1]) this.tri(o.wall, [xl, yl, z], [xh, yh, z], [xh, yl, z], [0, 0, z === z0 ? -1 : 1], wo);
      }
    }
  }
  // Half-cone roof over a semicircular apse centred (cx, cz), bulging toward dir.
  apseRoof(cx, cz, r, H, h, dir, o = {}) {
    const M = this.M, roof = M.roof, ov = o.ov ?? 0.35, n = o.segs ?? 9, R = r + ov, k = h / r, ye = H - ov * k;
    const base = { N: -Math.PI / 2, S: Math.PI / 2, E: 0, W: Math.PI }[dir];
    const ap = [cx, H + h, cz], ro = { gao: false, d: o.d };
    for (let i = 0; i < n; i++) {
      const a0 = base - Math.PI / 2 + (Math.PI * i) / n, a1 = base - Math.PI / 2 + (Math.PI * (i + 1)) / n, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * R, ye, cz + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R, ye, cz + Math.sin(a1) * R];
      const nn = [Math.cos(am), 1 / k, Math.sin(am)], e = [-Math.sin(am), 0, Math.cos(am)];
      const up = [ap[0] - (p0[0] + p1[0]) / 2, ap[1] - ye, ap[2] - (p0[2] + p1[2]) / 2], ul = Math.hypot(...up);
      this.tri(roof, p0, p1, ap, nn, ro, { e, up: up.map((v) => v / ul), o: p0 });
      this.quad(roof, [p0[0], p0[1] - 0.15, p0[2]], [p1[0], p1[1] - 0.15, p1[2]], p1, p0, [Math.cos(am), 0, Math.sin(am)], { ...ro, ao: 0.55 });
      this.tri(M.wood, [p0[0], p0[1] - 0.1, p0[2]], [p1[0], p1[1] - 0.1, p1[2]], [ap[0], ap[1] - 0.1, ap[2]], [-nn[0], -nn[1], -nn[2]], { gao: false, ao: 0.6, d: o.d });
    }
  }
  // Semicircular apse wall (outer skin) from y0 to y1.
  apseWall(cx, cz, r, y0, y1, dir, mat, o = {}) {
    const n = o.segs ?? 9, base = { N: -Math.PI / 2, S: Math.PI / 2, E: 0, W: Math.PI }[dir];
    for (let i = 0; i < n; i++) {
      const a0 = base - Math.PI / 2 + (Math.PI * i) / n, a1 = base - Math.PI / 2 + (Math.PI * (i + 1)) / n, am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r, 0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, 0, cz + Math.sin(a1) * r];
      const q = (p, y) => [p[0], y, p[2]], nn = [Math.cos(am), 0, Math.sin(am)];
      // Split near the ground so the contact AO has vertices there.
      const ys = y0 < 0.8 && y1 > 1.4 ? [y0, 0.8, y1] : [y0, y1];
      for (let j = 0; j < ys.length - 1; j++) this.quad(mat, q(p0, ys[j]), q(p1, ys[j]), q(p1, ys[j + 1]), q(p0, ys[j + 1]), nn, o);
      if (o.cornice) {
        const R2 = r + 0.12, c0 = [cx + Math.cos(a0) * R2, 0, cz + Math.sin(a0) * R2], c1 = [cx + Math.cos(a1) * R2, 0, cz + Math.sin(a1) * R2];
        this.quad(this.M.stoneTrim, q(c0, y1 - 0.3), q(c1, y1 - 0.3), q(c1, y1), q(c0, y1), nn, { gao: false });
        this.quad(this.M.stoneTrim, q(p0, y1 - 0.3), q(p1, y1 - 0.3), q(c1, y1 - 0.3), q(c0, y1 - 0.3), [0, -1, 0], { gao: false, ao: 0.7 });
      }
    }
  }
  // Half tube (ridge caps) between two local points, round side up.
  halfTube(mat, a, b, r, o = {}, segs = 5) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), axis = B.clone().sub(A).normalize();
    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, axis).normalize();
    if (up.y < 0) up.negate();
    for (let k = 0; k < segs; k++) {
      const a0 = (Math.PI * k) / segs, a1 = (Math.PI * (k + 1)) / segs;
      const o0 = side.clone().multiplyScalar(Math.cos(a0) * r).addScaledVector(up, Math.sin(a0) * r);
      const o1 = side.clone().multiplyScalar(Math.cos(a1) * r).addScaledVector(up, Math.sin(a1) * r);
      const mid = o0.clone().add(o1).normalize();
      this.quad(mat, A.clone().add(o0).toArray(), B.clone().add(o0).toArray(), B.clone().add(o1).toArray(), A.clone().add(o1).toArray(), mid.toArray(), { ...o, gao: false });
    }
  }

  // ---------------------------------------------------------------- fortification
  // Merlons along a face between t0 and t1 standing on y (h tall) between d0 and d1.
  merlons(f, t0, t1, y, h, d0, d1, mat, o = {}) {
    const w = o.w ?? 0.9, g = o.g ?? 0.65, n = Math.max(1, Math.floor((t1 - t0 + g) / (w + g)));
    const step = (t1 - t0 - n * w) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? (t0 + t1 - w) / 2 : t0 + i * (w + step);
      this.fbox(f, mat, a, a + w, y, y + h, d0, d1, { gao: false, ...o, col: false });
      if (o.swallow) { // Ghibelline swallowtail notch
        const m = a + w / 2;
        this.fbox(f, mat, a, m - 0.12, y + h, y + h + 0.35, d0, d1, { gao: false, ...o, col: false });
        this.fbox(f, mat, m + 0.12, a + w, y + h, y + h + 0.35, d0, d1, { gao: false, ...o, col: false });
      }
    }
    if (o.col) this.fboxCol(f, t0, t1, y, y + h, d0, d1);
  }
  fboxCol(f, t0, t1, y0, y1, d0, d1) {
    const xa = f.ox + f.tx * t0 + f.dx * d0, xb = f.ox + f.tx * t1 + f.dx * d1;
    const za = f.oz + f.tz * t0 + f.dz * d0, zb = f.oz + f.tz * t1 + f.dz * d1;
    this.col(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb));
  }
  // Machicolation: corbels under a parapet projecting `proj` beyond the face.
  corbels(f, t0, t1, y, proj, mat, o = {}) {
    const sp = o.sp ?? 1.1, n = Math.max(2, Math.round((t1 - t0) / sp) + 1), w = o.w ?? 0.34;
    for (let i = 0; i < n; i++) {
      const tc = t0 + ((t1 - t0 - w) * i) / (n - 1) + w / 2;
      this.fbox(f, mat, tc - w / 2, tc + w / 2, y - 0.9, y - 0.55, 0, proj * 0.35, { gao: false, ao: 0.9 });
      this.fbox(f, mat, tc - w / 2, tc + w / 2, y - 0.55, y - 0.28, 0, proj * 0.7, { gao: false, ao: 0.95 });
      this.fbox(f, mat, tc - w / 2, tc + w / 2, y - 0.28, y, 0, proj, { gao: false });
    }
    // Small arches between corbels read as a dark band from below.
    this.fquad(f, mat, t0, t1, y - 0.9, y, 0.01, { gao: false, ao: 0.7 });
  }

  // Straight stair of n steps ascending toward local dir ('N','S','E','W') starting at (x, z) edge.
  // w = width across; blocks are solid down to y0 - 0.5; each step is a collider.
  stair(x, z, w, dir, n, rise, run, mat, y0 = 0, o = {}) {
    for (let i = 0; i < n; i++) {
      const yt = y0 + (i + 1) * rise, s0 = i * run, s1 = (i + 1) * run;
      let b;
      if (dir === 'N') b = [x - w / 2, z - s1, x + w / 2, z - s0];
      else if (dir === 'S') b = [x - w / 2, z + s0, x + w / 2, z + s1];
      else if (dir === 'E') b = [x + s0, z - w / 2, x + s1, z + w / 2];
      else b = [x - s1, z - w / 2, x - s0, z + w / 2];
      const yb = o.solid === false ? yt - rise - 0.18 : y0 - 0.5;
      this.box(mat, b[0], yb, b[1], b[2], yt, b[3], { ...o, col: o.col !== false, gao: o.solid !== false });
    }
    return y0 + n * rise;
  }

  // ---------------------------------------------------------------- vegetation
  cypress(x, z, h = 12, r = 1.1, y = 0, o = {}) {
    const R = this.ctx.R, M = this.M;
    const tint = o.tint || [0.5 + R() * 0.08, 0.6 + R() * 0.08, 0.5 + R() * 0.06];
    this.tpl(M.plant, T_cypress(), x, y - 0.3, z, r, h, r * (0.9 + R() * 0.2), R() * 6.28, { tint, gao: false });
    // Second, slimmer lobe breaks the lathe symmetry.
    this.tpl(M.plant, T_cypress(), x + (R() - 0.5) * 0.3, y + h * 0.1, z + (R() - 0.5) * 0.3, r * 0.72, h * 0.86, r * 0.7, R() * 6.28, { tint: tint.map((v) => v * 1.1), gao: false });
    if (o.col !== false) this.col(x - 0.3, y - 0.5, z - 0.3, x + 0.3, y + h * 0.7, z + 0.3);
  }
  pine(x, z, h = 11, r = 5, y = 0, o = {}) {
    const R = this.ctx.R, M = this.M, lean = (R() - 0.5) * 1.2;
    this.beam(M.wood, [x, y - 0.3, z], [x + lean, y + h * 0.78, z + lean * 0.5], 0.42, 0.42, { tint: [0.55, 0.45, 0.4] });
    const tx = x + lean, tz = z + lean * 0.5;
    this.tpl(M.plant, T_dome(), tx, y + h * 0.72, tz, r, h * 0.3, r * 0.92, R() * 6, { tint: [0.62, 0.74, 0.5], gao: false });
    this.tpl(M.plant, T_dome(), tx + r * 0.35, y + h * 0.66, tz - r * 0.2, r * 0.6, h * 0.22, r * 0.55, R() * 6, { tint: [0.58, 0.7, 0.48], gao: false });
    if (o.col !== false) this.col(x - 0.3, y - 0.5, z - 0.3, x + 0.3, y + h * 0.6, z + 0.3);
  }
  // Round-crowned tree (olive, lemon, fruit, holm oak).
  tree(x, z, h = 5, r = 2.2, y = 0, o = {}) {
    const R = this.ctx.R, M = this.M, tint = o.tint || [0.75, 0.85, 0.62];
    const trunkH = h - r * 1.1;
    this.beam(M.wood, [x, y - 0.2, z], [x + (R() - 0.5) * 0.4, y + trunkH + r * 0.3, z + (R() - 0.5) * 0.4], o.trunk ?? 0.26, o.trunk ?? 0.26, { tint: [0.6, 0.52, 0.45], d: o.d });
    this.blob(M.plant, x, y + trunkH + r * 0.75, z, r, r * 0.82, r * 0.95, { tint, rot: R() * 6, d: o.d });
    if (r > 1.4) {
      this.blob(M.plant, x + r * 0.45, y + trunkH + r * 0.55, z + r * 0.2, r * 0.62, r * 0.55, r * 0.6, { tint: tint.map((v) => v * 0.94), rot: R() * 6, d: o.d });
      this.blob(M.plant, x - r * 0.4, y + trunkH + r * 0.6, z - r * 0.3, r * 0.58, r * 0.5, r * 0.6, { tint: tint.map((v) => v * 1.05), rot: R() * 6, d: o.d });
    }
    if (o.col) this.col(x - 0.25, y - 0.5, z - 0.25, x + 0.25, y + trunkH, z + 0.25);
  }
  // Clipped hedge (rounded by a narrower cap).
  hedge(x0, z0, x1, z1, h, y = 0, o = {}) {
    const M = this.M, tint = o.tint || [0.62, 0.78, 0.5], e = Math.min(0.08, (x1 - x0) / 4, (z1 - z0) / 4);
    this.box(M.plant, x0, y - 0.1, z0, x1, y + h - e, z1, { tint, d: o.d, gao: true });
    this.box(M.plant, x0 + e, y + h - e, z0 + e, x1 - e, y + h, z1 - e, { tint: tint.map((v) => v * 1.06), d: o.d, gao: false, skip: 8 });
    if (o.col) this.col(x0, y - 0.2, z0, x1, y + h, z1);
  }
  // Terracotta pot with a lemon tree / clipped ball.
  lemonPot(x, z, y = 0, o = {}) {
    const M = this.M, R = this.ctx.R;
    this.box(M.stoneTrim, x - 0.42, y, z - 0.42, x + 0.42, y + 0.28, z + 0.42, { d: true });
    this.tpl(M.brick, T_pot(), x, y + 0.28, z, 0.4, 0.62, 0.4, 0, { tint: [1.15, 0.85, 0.7], d: true, gao: false });
    this.beam(M.wood, [x, y + 0.8, z], [x, y + 1.35, z], 0.07, 0.07, { d: true });
    this.blob(M.plant, x, y + 1.7, z, 0.6, 0.55, 0.6, { tint: [0.72, 0.9, 0.55], rot: R() * 6, d: true });
    if (!o.noFruit) for (let k = 0; k < 5; k++) {
      const a = R() * 6.28, rr = 0.5;
      this.box(M.plaster[4], x + Math.cos(a) * rr - 0.05, y + 1.55 + R() * 0.35, z + Math.sin(a) * rr - 0.05, x + Math.cos(a) * rr + 0.05, y + 1.65 + R() * 0.35, z + Math.sin(a) * rr + 0.05, { tint: [1.3, 1.15, 0.3], d: true, gao: false });
    }
    this.col(x - 0.42, y, z - 0.42, x + 0.42, y + 1.0, z + 0.42);
  }

  // ---------------------------------------------------------------- props
  // Well with round stone curb, two posts, crossbeam, pulley and bucket.
  well(x, z, y = 0, o = {}) {
    const M = this.M, r = o.r ?? 0.85;
    this.cyl(M.stone, x, y - 0.3, z, r, 1.2, 12, { tint: 0.95 });
    this.cyl(M.stoneTrim, x, y + 0.9, z, r + 0.06, 0.12, 12, { gao: false });
    this.cyl(M.water, x, y + 0.3, z, r - 0.18, 0.01, 10, { gao: false, tint: 0.4, d: true });
    this.cyl(M.stone, x, y + 0.31, z, r - 0.17, 0.01, 10, { gao: false, tint: 0.05 });
    for (const s of [-1, 1]) this.box(o.posts || M.stoneTrim, x + s * (r - 0.05) - 0.12, y + 0.9, z - 0.12, x + s * (r - 0.05) + 0.12, y + 2.5, z + 0.12, { gao: false });
    this.box(M.wood, x - r - 0.1, y + 2.4, z - 0.09, x + r + 0.1, y + 2.58, z + 0.09, { gao: false, d: true });
    this.box(M.iron, x - 0.03, y + 1.9, z - 0.18, x + 0.03, y + 2.4, z + 0.18, { d: true, gao: false });
    this.cyl(M.wood, x, y + 1.35, z + 0.25, 0.14, 0.26, 8, { d: true, gao: false });
    this.col(x - r, y - 0.3, z - r, x + r, y + 1.02, z + r);
  }
  // Two-wheeled farm cart (barroccio) along local x.
  cart(x, z, y = 0, rot = 0, o = {}) {
    const K = this.frame(x, z, rot, false, y), M = this.M;
    const bed = { tint: [1.05, 0.95, 0.85] };
    K.box(M.wood, -1.6, 0.85, -0.7, 1.4, 0.95, 0.7, { ...bed, gao: false });
    for (const s of [-1, 1]) K.box(M.wood, -1.6, 0.95, s * 0.7 - 0.05, 1.4, 1.35, s * 0.7 + 0.05, { ...bed, gao: false });
    K.box(M.wood, -1.6, 0.95, -0.7, -1.5, 1.3, 0.7, { ...bed, gao: false });
    // Shafts resting on the ground, wheels with spokes.
    for (const s of [-0.45, 0.45]) K.beam(M.wood, [1.4, 0.9, s], [3.6, 0.1, s * 0.8], 0.09, 0.09, { d: true });
    for (const s of [-1, 1]) {
      const wz = s * 0.86;
      K.tplM(M.wood, T_cyl(14), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, 0.72, wz - s * 0.05)).multiply(new THREE.Matrix4().makeScale(0.72, 0.1, 0.72)), { tint: 0.8, gao: false });
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 6;
        K.beam(M.wood, [Math.cos(a) * 0.66, 0.72 + Math.sin(a) * 0.66, wz + s * 0.02], [-Math.cos(a) * 0.66, 0.72 - Math.sin(a) * 0.66, wz + s * 0.02], 0.05, 0.05, { d: true, tint: 0.7 });
      }
    }
    K.box(M.iron, -0.05, 0.68, -0.95, 0.05, 0.76, 0.95, { d: true, gao: false });
    if (o.load === 'hay') K.blob(this.L.straw, -0.1, 1.45, 0, 1.45, 0.55, 0.72, { tint: 1.05 });
    if (o.load === 'barrels') for (const bx of [-0.9, 0.1]) K.cyl(M.wood, bx, 0.95, 0, 0.36, 0.8, 10, { tint: [0.9, 0.75, 0.6], d: true });
    K.col(-1.6, 0, -0.95, 1.4, 1.4, 0.95);
  }
  // Conical haystack (pagliaio) around a pole.
  haystack(x, z, h = 4.2, r = 2.1, y = 0) {
    const M = this.M, L = this.L, R = this.ctx.R;
    this.cyl(L.straw, x, y - 0.2, z, r * 0.93, h * 0.35, 12, { tint: 0.95, ry: R() * 3 });
    this.tpl(L.straw, T_cone(12), x, y + h * 0.35 - 0.2, z, r, h * 0.65, r, R() * 3, { tint: 1.02, gao: false });
    this.beam(M.wood, [x, y + h * 0.9, z], [x + 0.05, y + h + 0.9, z], 0.1, 0.1, { d: true });
    this.cone(M.roof, x, y + h + 0.05, z, 0.35, 0.3, 8, { gao: false, d: true });
    this.col(x - r * 0.75, y - 0.2, z - r * 0.75, x + r * 0.75, y + h * 0.6, z + r * 0.75);
  }
  // Round hay bales / wood pile / barrels.
  barrel(x, z, y = 0, o = {}) {
    const M = this.M;
    this.cyl(M.wood, x, y, z, 0.34, 0.9, 10, { tint: [0.9, 0.72, 0.55], d: true });
    for (const hh of [0.15, 0.72]) this.cyl(M.iron, x, y + hh, z, 0.355, 0.05, 10, { d: true, gao: false });
    if (o.col !== false) this.col(x - 0.34, y, z - 0.34, x + 0.34, y + 0.9, z + 0.34);
  }
  woodpile(x, z, len, y = 0, rot = 0) {
    const K = this.frame(x, z, rot, false, y), M = this.M, R = this.ctx.R;
    for (let row = 0; row < 4; row++) for (let i = 0; i < Math.round(len / 0.24) - (row % 2); i++) {
      const cx = -len / 2 + 0.12 + i * 0.24 + (row % 2) * 0.12;
      K.tplM(M.wood, T_cyl(6), new THREE.Matrix4().makeTranslation(cx, 0.12 + row * 0.21, -0.5).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(0.11, 1.0, 0.11)), { tint: [0.95 + R() * 0.15, 0.8, 0.62], d: true, gao: false });
    }
    K.col(-len / 2, 0, -0.5, len / 2, 0.9, 0.5);
  }
  bench(x, z, len = 2, y = 0, rot = 0, o = {}) {
    const K = this.frame(x, z, rot, false, y), M = this.M;
    if (o.stone) {
      for (const s of [-1, 1]) K.box(M.stoneTrim, s * (len / 2 - 0.25) - 0.15, 0, -0.22, s * (len / 2 - 0.25) + 0.15, 0.42, 0.22, {});
      K.box(M.stoneTrim, -len / 2, 0.42, -0.26, len / 2, 0.52, 0.26, { gao: false });
    } else {
      for (const s of [-1, 1]) K.box(M.iron, s * (len / 2 - 0.2) - 0.04, 0, -0.25, s * (len / 2 - 0.2) + 0.04, 0.45, 0.25, { d: true });
      K.box(M.wood, -len / 2, 0.42, -0.25, len / 2, 0.47, 0.22, { d: true, gao: false });
      K.box(M.wood, -len / 2, 0.55, 0.2, len / 2, 0.9, 0.25, { d: true, gao: false });
    }
    K.col(-len / 2, 0, -0.26, len / 2, 0.5, 0.26);
  }
  // Pergola with vines on stone/brick piers, rafters along local x.
  pergola(x0, z0, x1, z1, h = 2.6, y = 0, o = {}) {
    const M = this.M, R = this.ctx.R, pm = o.pier || M.brick, sp = o.sp ?? 3;
    const nx = Math.max(1, Math.round((x1 - x0) / sp)), nz = 1;
    for (let i = 0; i <= nx; i++) for (const zz of [z0, z1]) {
      const px = x0 + ((x1 - x0) * i) / nx;
      if (o.skipSide === 'z0' && zz === z0) continue;
      this.box(pm, px - 0.2, y - 0.1, zz - 0.2, px + 0.2, y + h, zz + 0.2, { col: true, tint: 1 });
    }
    for (const zz of [z0, z1]) if (!(o.skipSide === 'z0' && zz === z0)) this.box(M.wood, x0 - 0.3, y + h, zz - 0.08, x1 + 0.3, y + h + 0.18, zz + 0.08, { d: true, gao: false });
    const nr = Math.round((x1 - x0) / 0.8);
    for (let i = 0; i <= nr; i++) {
      const px = x0 + ((x1 - x0) * i) / nr;
      this.box(M.wood, px - 0.04, y + h + 0.18, z0 - 0.4, px + 0.04, y + h + 0.28, z1 + 0.4, { d: true, gao: false });
    }
    // Vine canopy: irregular leafy slabs.
    for (let i = 0; i < nx * 3; i++) {
      const cx = x0 + ((x1 - x0) * (i + 0.5)) / (nx * 3) + (R() - 0.5) * 0.5, cz = (z0 + z1) / 2 + (R() - 0.5) * (z1 - z0) * 0.5;
      this.blob(M.plant, cx, y + h + 0.35, cz, (x1 - x0) / (nx * 3) * 0.9, 0.28, (z1 - z0) * 0.45, { tint: [0.8, 0.95, 0.6], rot: R() * 0.4, detail: 0 });
    }
    void nz;
  }
}

// Simple jagged ruin top: a wall piece along a face whose top height varies.
export function ruinTop(K, f, t0, t1, yBase, yMax, d0, d1, mat, R, o = {}) {
  let t = t0;
  while (t < t1 - 0.05) {
    const w = Math.min(t1 - t, 0.5 + R() * 1.1), y = yBase + (yMax - yBase) * (0.25 + 0.75 * R());
    K.fbox(f, mat, t, t + w, yBase, y, d0 + (R() < 0.3 ? 0.2 : 0), d1, { ...o, col: false });
    t += w;
  }
  if (o.col) K.fboxCol(f, t0, t1, yBase, yBase + (yMax - yBase) * 0.5, d0, d1);
}
