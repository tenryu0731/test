// Building kit for the town: face frames, real openings with reveals (rectangular, round, pointed
// and segmental arches), window/door/shop fillings, Gothic bifore, balconies, roofs, chimneys and
// small façade furniture. Every function emits into the shared Geo at the right LOD level:
// silhouettes and reveals in BASE, fine dressing in DETAIL, flush simplified versions in FAR.
import * as THREE from 'three';
import { Geo, LOD } from './city-geo.js';

export const FAC = 0.3;   // façade slab thickness (window reveal depth)

export function makeFace(r, dir) {
  const [x0, x1, z0, z1] = r;
  switch (dir) {
    case 'N': return { dir, W: x1 - x0, ox: x1, oz: z0, tx: -1, tz: 0, dx: 0, dz: -1 };
    case 'S': return { dir, W: x1 - x0, ox: x0, oz: z1, tx: 1, tz: 0, dx: 0, dz: 1 };
    case 'W': return { dir, W: z1 - z0, ox: x0, oz: z0, tx: 0, tz: 1, dx: -1, dz: 0 };
    default: return { dir, W: z1 - z0, ox: x1, oz: z1, tx: 0, tz: -1, dx: 1, dz: 0 };
  }
}
export const fx = (f, t, d) => f.ox + f.tx * t + f.dx * d;
export const fz = (f, t, d) => f.oz + f.tz * t + f.dz * d;

// Srgb-ish colour ratio → linear tint multiplier.
export const tintFrom = (c, base) => [(c[0] / base[0]) ** 2.2, (c[1] / base[1]) ** 2.2, (c[2] / base[2]) ** 2.2];
export const mulTint = (t, k) => (Array.isArray(t) ? [t[0] * k, t[1] * k, t[2] * k] : t * k);

export function createKit({ geo, M, R, grid, collide, decals }) {
  const T = M.town.layers;
  const rr = (a, b) => a + (b - a) * R();
  const pick = (a) => a[Math.floor(R() * a.length) % a.length];
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const setLod = (l) => { const p = geo.lod; geo.lod = l; return p; };

  // Templates for repeated small shapes.
  const TPL = {
    blob0: Geo.template(new THREE.IcosahedronGeometry(1, 0)),
    blob1: Geo.template(new THREE.IcosahedronGeometry(1, 1)),
    pot: Geo.template(new THREE.CylinderGeometry(1, 0.72, 1, 6, 1, true).translate(0, 0.5, 0)),
    cyl6: Geo.template(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), false),
    cyl8: Geo.template(new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0), false),
    cyl12: Geo.template(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0), false),
    cone4: Geo.template(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
    cone8: Geo.template(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0)),
    box: Geo.template(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  };

  // ---------------------------------------------------------------- face-space primitives
  const P3 = (f, t, y, d) => [fx(f, t, d), y, fz(f, t, d)];
  function front(f, mat, t0, t1, y0, y1, d, o) {
    if (t1 - t0 < 1e-3 || y1 - y0 < 1e-3) return;
    if (f.dz) { const xa = f.ox + f.tx * t0, xb = f.ox + f.tx * t1; geo.rect(mat, 'z', f.dz, f.oz + f.dz * d, Math.min(xa, xb), Math.max(xa, xb), y0, y1, o); }
    else { const za = f.oz + f.tz * t0, zb = f.oz + f.tz * t1; geo.rect(mat, 'x', f.dx, f.ox + f.dx * d, y0, y1, Math.min(za, zb), Math.max(za, zb), o); }
  }
  // Face whose normal is sgn × tangent, at t, spanning depth d0..d1 and height y0..y1.
  function side(f, mat, t, sgn, d0, d1, y0, y1, o) {
    if (d1 - d0 < 1e-3 || y1 - y0 < 1e-3) return;
    if (f.tx) { const za = f.oz + f.dz * d0, zb = f.oz + f.dz * d1; geo.rect(mat, 'x', sgn * f.tx, f.ox + f.tx * t, y0, y1, Math.min(za, zb), Math.max(za, zb), o); }
    else { const xa = f.ox + f.dx * d0, xb = f.ox + f.dx * d1; geo.rect(mat, 'z', sgn * f.tz, f.oz + f.tz * t, Math.min(xa, xb), Math.max(xa, xb), y0, y1, o); }
  }
  function hor(f, mat, y, sgn, t0, t1, d0, d1, o) {
    if (t1 - t0 < 1e-3 || d1 - d0 < 1e-3) return;
    const xa = fx(f, t0, d0), xb = fx(f, t1, d1), za = fz(f, t0, d0), zb = fz(f, t1, d1);
    geo.rect(mat, 'y', sgn, y, Math.min(xa, xb), Math.max(xa, xb), Math.min(za, zb), Math.max(za, zb), o);
  }
  // Box in face space. o.open: face-relative faces to skip: 'b' back, 'f' front, 'l', 'r', 't', 'u' (under).
  function lbox(f, mat, t0, t1, y0, y1, d0, d1, o = {}) {
    const xa = fx(f, t0, d0), xb = fx(f, t1, d1), za = fz(f, t0, d0), zb = fz(f, t1, d1);
    let skip = o.skip || 0;
    if (o.open) {
      const bit = (vx, vz) => (vx > 0 ? 1 : vx < 0 ? 2 : vz > 0 ? 16 : 32);
      for (const ch of o.open) {
        if (ch === 'b') skip |= bit(-f.dx, -f.dz);
        else if (ch === 'f') skip |= bit(f.dx, f.dz);
        else if (ch === 'l') skip |= bit(-f.tx, -f.tz);
        else if (ch === 'r') skip |= bit(f.tx, f.tz);
        else if (ch === 't') skip |= 4;
        else if (ch === 'u') skip |= 8;
      }
    }
    geo.box(mat, Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), o, skip);
  }
  const faceMatrix = (f) => new THREE.Matrix4().makeBasis(V3(f.tx, 0, f.tz), V3(0, 1, 0), V3(f.dx, 0, f.dz)).setPosition(f.ox, 0, f.oz);

  // ---------------------------------------------------------------- arches
  const segsFor = (w) => (w < 1.0 ? 4 : w < 1.8 ? 5 : w < 3 ? 7 : w < 5 ? 9 : 12);
  // Intrados curve from the left springer to the right one: [[t, y], ...].
  function archCurve(t0, t1, spring, kind = 'round', n = 0) {
    const w = t1 - t0, tc = (t0 + t1) / 2, pts = [];
    n = n || segsFor(w);
    if (kind === 'pointed') {
      // Equilateral-ish Gothic arch: two arcs of radius k·w centred inside the opening.
      const rad = w * 0.8, c0 = t0 + rad, c1 = t1 - rad; // left arc centred at c0 (right of t0)
      const apexY = Math.sqrt(rad * rad - (tc - c0) ** 2);
      const a1 = Math.atan2(apexY, tc - c0);
      const h = Math.max(2, n >> 1);
      for (let k = 0; k <= h; k++) { const a = Math.PI - (Math.PI - a1) * (k / h); pts.push([c0 + rad * Math.cos(a), spring + rad * Math.sin(a)]); }
      for (let k = h - 1; k >= 0; k--) { const a = Math.PI - (Math.PI - a1) * (k / h); pts.push([c1 - rad * Math.cos(a), spring + rad * Math.sin(a)]); }
    } else if (kind === 'seg') {
      // Segmental arch: rise = w / 5.
      const rise = w / 5, rad = (w * w / 4 + rise * rise) / (2 * rise), cy = spring + rise - rad;
      const a0 = Math.asin((w / 2) / rad);
      for (let k = 0; k <= n; k++) { const a = -a0 + (2 * a0 * k) / n; pts.push([tc - rad * Math.sin(-a), cy + rad * Math.cos(a)]); }
    } else {
      const r = w / 2;
      for (let k = 0; k <= n; k++) { const a = Math.PI * (1 - k / n); pts.push([tc + r * Math.cos(a), spring + r * Math.sin(a)]); }
    }
    return pts;
  }
  const curveTop = (c) => c.reduce((m, p) => Math.max(m, p[1]), -1e9);
  // Wall between an arch curve and the horizontal line `top`, front face at d.
  function spandrel(f, mat, curve, top, d, o, normalSign = 1) {
    const out = [f.dx * normalSign, 0, f.dz * normalSign];
    for (let k = 0; k < curve.length - 1; k++) {
      const [ta, ya] = curve[k], [tb, yb] = curve[k + 1];
      if (ya >= top - 1e-3 && yb >= top - 1e-3) continue;
      geo.quad(mat, P3(f, ta, Math.min(ya, top), d), P3(f, tb, Math.min(yb, top), d), P3(f, tb, top, d), P3(f, ta, top, d), out, { gao: false, ...o });
    }
  }
  // Soffit of the arch (intrados) spanning depth d0..d1.
  function intrados(f, mat, curve, d0, d1, o) {
    const tc = (curve[0][0] + curve[curve.length - 1][0]) / 2, sp = curve[0][1];
    for (let k = 0; k < curve.length - 1; k++) {
      const [ta, ya] = curve[k], [tb, yb] = curve[k + 1];
      const mt = (ta + tb) / 2 - tc, my = (ya + yb) / 2 - sp, l = Math.hypot(mt, my) || 1;
      const n = [(-mt / l) * f.tx, -my / l, (-mt / l) * f.tz];
      geo.quad(mat, P3(f, ta, ya, d0), P3(f, tb, yb, d0), P3(f, tb, yb, d1), P3(f, ta, ya, d1), n, { gao: false, ...o });
    }
  }
  // Fan-filled arch area (glass, door leaf, tympanum) above the springing line at depth d.
  function archFill(f, mat, curve, d, o) {
    const tc = (curve[0][0] + curve[curve.length - 1][0]) / 2, sp = curve[0][1], out = [f.dx, 0, f.dz];
    for (let k = 0; k < curve.length - 1; k++) geo.tri(mat, P3(f, tc, sp, d), P3(f, curve[k][0], curve[k][1], d), P3(f, curve[k + 1][0], curve[k + 1][1], d), out, { gao: false, ...o });
  }
  // Dressed-stone archivolt: ring of width w on the wall face (front at d1, returns to d0).
  function archRing(f, mat, curve, w, d0, d1, o = {}, keystone = true) {
    const tc = (curve[0][0] + curve[curve.length - 1][0]) / 2, sp = curve[0][1], out = [f.dx, 0, f.dz];
    const ext = curve.map(([t, y], k) => {
      // Outward direction: from the arch centre for round arches; averaged neighbour normal otherwise.
      const a = curve[Math.max(0, k - 1)], b = curve[Math.min(curve.length - 1, k + 1)];
      let nt = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nt, ny) || 1; nt /= l; ny /= l;
      if (k === 0) { nt = -1; ny = 0; } else if (k === curve.length - 1) { nt = 1; ny = 0; }
      return [t + nt * w, y + ny * w];
    });
    for (let k = 0; k < curve.length - 1; k++) {
      const i0 = curve[k], i1 = curve[k + 1], e0 = ext[k], e1 = ext[k + 1];
      geo.quad(mat, P3(f, i0[0], i0[1], d1), P3(f, i1[0], i1[1], d1), P3(f, e1[0], e1[1], d1), P3(f, e0[0], e0[1], d1), out, { gao: false, ...o });
      if (d1 - d0 > 0.09 && w >= 0.3) {
        const mt = (e0[0] + e1[0]) / 2 - tc, my = (e0[1] + e1[1]) / 2 - sp, l = Math.hypot(mt, my) || 1;
        geo.quad(mat, P3(f, e0[0], e0[1], d0), P3(f, e1[0], e1[1], d0), P3(f, e1[0], e1[1], d1), P3(f, e0[0], e0[1], d1), [(mt / l) * f.tx, my / l, (mt / l) * f.tz], { gao: false, ...o });
      }
    }
    if (keystone) {
      const top = curve[Math.floor(curve.length / 2)], pl = setLod(geo.lod === LOD.BASE ? LOD.DETAIL : geo.lod);
      lbox(f, mat, top[0] - 0.12, top[0] + 0.12, top[1] - 0.02, top[1] + w + 0.06, Math.max(d0, d1 - 0.02), d1 + 0.03, { gao: false, open: 'bu', ...o });
      setLod(pl);
    }
    return ext;
  }

  // ---------------------------------------------------------------- façades with openings
  // S (style): { wallFor(bandIndex) -> layer, tint(bandIndex), uvOff, H, revealTint }
  // bands: [{ y0, y1, ops }], op: { t0, t1, y0, y1, shape: 'rect'|'round'|'pointed'|'seg', kind }
  function opTop(op) { return op.shape && op.shape !== 'rect' ? curveTop(op.curve || (op.curve = archCurve(op.t0, op.t1, op.y1, op.shape))) : op.y1; }
  function facadeWall(f, bands, S, ts, te) {
    bands.forEach((band, bi) => {
      const mat = S.wallFor(bi), o = { tint: S.tintFor(bi), uvOff: S.uvOff, top: S.H };
      const ro = { tint: mulTint(S.tintFor(bi), 0.82), uvOff: S.uvOff, gao: false };
      const ops = band.ops.slice().sort((a, b) => a.t0 - b.t0);
      let cur = ts;
      for (const op of ops) {
        front(f, mat, cur, op.t0, band.y0, band.y1, 0, o);
        if (op.y0 > band.y0 + 1e-3) front(f, mat, op.t0, op.t1, band.y0, op.y0, 0, o);
        const top = opTop(op);
        if (op.shape && op.shape !== 'rect') {
          spandrel(f, mat, op.curve, Math.min(band.y1, top + 0.001), 0, o);
          if (band.y1 > top) front(f, mat, op.t0, op.t1, top, band.y1, 0, o);
          intrados(f, S.revealMat?.(bi) || mat, op.curve, -FAC, 0, ro);
        } else {
          front(f, mat, op.t0, op.t1, op.y1, band.y1, 0, o);
          hor(f, S.revealMat?.(bi) || mat, op.y1, -1, op.t0, op.t1, -FAC, 0, ro);
        }
        // Jambs and sill of the reveal.
        const rm = S.revealMat?.(bi) || mat;
        side(f, rm, op.t0, 1, -FAC, 0, op.y0, op.y1, ro);
        side(f, rm, op.t1, -1, -FAC, 0, op.y0, op.y1, ro);
        if (op.y0 > 0.01) hor(f, rm, op.y0, 1, op.t0, op.t1, -FAC, 0, ro);
        cur = op.t1;
      }
      front(f, mat, cur, te, band.y0, band.y1, 0, o);
      // Plinth / base course on the ground band.
      if (bi === 0 && S.plinth) {
        let c0 = ts;
        const plinthPiece = (a, b) => { if (b - a > 0.02) lbox(f, S.plinth, a, b, 0, S.plinthH, 0, 0.05, { tint: S.plinthTint || 1, open: 'bulr' }); };
        for (const op of ops) { if (op.y0 < S.plinthH) { plinthPiece(c0, op.t0 - (op.kind === 'door' || op.kind === 'shop' ? 0.25 : 0)); c0 = op.t1 + (op.kind === 'door' || op.kind === 'shop' ? 0.25 : 0); } }
        plinthPiece(c0, te);
      }
    });
  }

  // ---------------------------------------------------------------- fillings
  function glassPane(f, op, d) {
    front(f, T.glass, op.t0, op.t1, op.y0, op.y1, d, { gao: false });
    if (op.curve) archFill(f, T.glass, op.curve, d, {});
  }

  function shutters(f, op, S) {
    const { t0, t1, y0, y1 } = op, w = t1 - t0, lw = w / 2, th = 0.035, sm = T.shutter, o = { gao: false, tint: S.shutterTint };
    const mode = R();
    if (mode < 0.55) { // open flat against the wall
      lbox(f, sm, t0 - lw - 0.03, t0 - 0.03, y0, y1, 0.005, 0.005 + th, { ...o, open: 'b' });
      lbox(f, sm, t1 + 0.03, t1 + lw + 0.03, y0, y1, 0.005, 0.005 + th, { ...o, open: 'b' });
    } else if (mode < 0.8) { // ajar
      for (const [hinge, sgn] of [[t0, 1], [t1, -1]]) {
        const th2 = rr(1.9, 2.7);
        const g = new THREE.BoxGeometry(lw, y1 - y0, th);
        g.translate(sgn * lw / 2, (y0 + y1) / 2, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(sgn > 0 ? -th2 : th2));
        g.translate(hinge, 0, 0.02);
        geo.geom(sm, g, faceMatrix(f), o);
        g.dispose();
      }
    } else { // closed in the reveal
      front(f, sm, t0 + 0.01, t1 - 0.01, y0 + 0.01, y1 - 0.01, -0.12, o);
      front(f, T.wood, (t0 + t1) / 2 - 0.01, (t0 + t1) / 2 + 0.01, y0 + 0.01, y1 - 0.01, -0.115, { gao: false, ao: 0.6 });
    }
  }

  function windowFill(f, op, S) {
    const { t0, t1, y0, y1 } = op, w = t1 - t0, gd = -FAC + 0.05;
    let prev = setLod(LOD.BASE);
    glassPane(f, op, gd);
    if (op.kind === 'win' && S.sillBase) lbox(f, T.trim, t0 - 0.1, t1 + 0.1, y0 - 0.09, y0 + 0.02, -FAC + 0.02, 0.08, { tint: S.trimTint, gao: false, open: 'b' });
    setLod(LOD.FAR);
    front(f, T.glass, t0, t1, y0, opTop(op), 0.02, { gao: false, tint: 0.8 });
    if (S.court) { setLod(prev); return; }
    setLod(LOD.DETAIL);
    // Frame, mullion and transom set back in the reveal.
    const fr = T.door, fw = 0.055, fd = gd + 0.06, fo = { gao: false, tint: S.frameTint ?? 0.9 };
    front(f, fr, t0, t0 + fw, y0, y1, fd, fo); front(f, fr, t1 - fw, t1, y0, y1, fd, fo);
    front(f, fr, t0 + fw, t1 - fw, y0, y0 + fw, fd, fo); front(f, fr, t0 + fw, t1 - fw, y1 - fw, y1, fd, fo);
    const tc = (t0 + t1) / 2;
    lbox(f, fr, tc - 0.025, tc + 0.025, y0 + fw, y1 - fw, gd, fd, { ...fo, open: 'btu' });
    if (op.kind !== 'balc') { const yt = y0 + (y1 - y0) * 0.68; lbox(f, fr, t0 + fw, t1 - fw, yt, yt + 0.05, gd, fd, { ...fo, open: 'blr' }); }
    else lbox(f, fr, t0 + fw, t1 - fw, y0, y0 + 0.9, gd, fd - 0.01, { ...fo, open: 'blr' });
    // Sill.
    if (op.kind === 'win' && !S.sillBase) lbox(f, T.trim, t0 - 0.09, t1 + 0.09, y0 - 0.08, y0 + 0.015, -FAC + 0.02, 0.07, { tint: S.trimTint, gao: false, open: 'b' });
    // Stone surround.
    if (S.framed && !op.curve) {
      const so = { gao: false, tint: S.trimTint, open: 'b' };
      lbox(f, T.trim, t0 - 0.13, t0, y0, y1, 0, 0.035, { ...so, open: 'btu' });
      lbox(f, T.trim, t1, t1 + 0.13, y0, y1, 0, 0.035, { ...so, open: 'btu' });
      lbox(f, T.trim, t0 - 0.16, t1 + 0.16, y1, y1 + 0.17, 0, 0.05, so);
    }
    if (op.kind === 'gwin') { // grille
      for (let k = 1; k < 5; k++) { const t = t0 + (w * k) / 5; lbox(f, T.iron, t - 0.012, t + 0.012, y0, opTop(op), -0.1, -0.075, { gao: false, open: 'b' }); }
      lbox(f, T.iron, t0, t1, (y0 + y1) / 2 - 0.012, (y0 + y1) / 2 + 0.012, -0.11, -0.07, { gao: false, open: 'b' });
    } else if (S.shutters && !op.curve) shutters(f, op, S);
    if (op.kind === 'win' && !op.curve && R() < S.pots) { // flower box
      const pc = (t0 + t1) / 2;
      lbox(f, T.roof, pc - 0.32, pc + 0.32, y0 + 0.01, y0 + 0.2, 0.0, 0.22, { gao: false, open: 'b', tint: 0.9 });
      geo.proto(T.plant, TPL.blob0, fx(f, pc, 0.11), y0 + 0.3, fz(f, pc, 0.11), f.dz ? 0.36 : 0.18, rr(0.15, 0.2), f.dz ? 0.18 : 0.36, 0, { gao: false, tint: R() < 0.4 ? [1.25, 0.6, 0.55] : 1 });
    }
    setLod(prev);
  }

  function doorFill(f, op, S) {
    const { t0, t1, y1 } = op, w = t1 - t0, tc = (t0 + t1) / 2, dd = -FAC + 0.04;
    let prev = setLod(LOD.BASE);
    front(f, T.door, t0, t1, 0, y1, dd, { tint: rr(0.8, 1.05), gao: true });
    const st = { tint: S.trimTint, gao: false, open: 'b' };
    if (op.curve) {
      archFill(f, S.fanlight ? T.glass : T.door, op.curve, dd, { tint: S.fanlight ? 1 : 0.9 });
      archRing(f, T.trim, op.curve, op.ring ?? 0.3, -0.02, 0.05, { tint: S.trimTint });
      lbox(f, T.trim, t0 - (op.ring ?? 0.3), t0, 0, y1, 0, 0.05, { ...st, open: 'btu' });
      lbox(f, T.trim, t1, t1 + (op.ring ?? 0.3), 0, y1, 0, 0.05, { ...st, open: 'btu' });
    } else {
      lbox(f, T.trim, t0 - 0.2, t0, 0, y1, 0, 0.05, { ...st, open: 'btu' });
      lbox(f, T.trim, t1, t1 + 0.2, 0, y1, 0, 0.05, { ...st, open: 'btu' });
      lbox(f, T.trim, t0 - 0.28, t1 + 0.28, y1, y1 + 0.26, 0, 0.08, st);
    }
    setLod(LOD.DETAIL);
    lbox(f, T.trim, t0 - 0.1, t1 + 0.1, 0, 0.1, -FAC, 0.2, { gao: false, tint: S.trimTint, open: 'bu' });
    setLod(LOD.FAR);
    front(f, T.door, t0, t1, 0, opTop(op), 0.02, { gao: false, tint: 0.7 });
    setLod(LOD.DETAIL);
    if (op.curve && S.fanlight) for (let k = 1; k < 4; k++) {
      const a = (Math.PI * k) / 4, r = w / 2;
      geo.quad(T.iron, P3(f, tc, y1, dd + 0.02), P3(f, tc + Math.cos(a) * r, y1 + Math.sin(a) * r, dd + 0.02), P3(f, tc + Math.cos(a) * r + 0.03, y1 + Math.sin(a) * r, dd + 0.02), P3(f, tc + 0.03, y1, dd + 0.02), [f.dx, 0, f.dz], { gao: false });
    }
    // Door furniture: knocker ring and a panel moulding.
    lbox(f, T.iron, tc - 0.05, tc + 0.05, 1.2, 1.3, dd, dd + 0.05, { gao: false, open: 'b' });
    front(f, T.wood, t0 + 0.12, t1 - 0.12, 0.3, 0.36, dd + 0.015, { gao: false, tint: 0.7 });
    if (S.lantern) lantern(f, t1 + 0.75, 3.2);
    if (!S.noPots && R() < 0.25 && S.canPot(f, tc)) { // potted plants beside the door (not in narrow alleys)
      for (const t of [t0 - 0.6, t1 + 0.6]) {
        const x = fx(f, t, 0.36), z = fz(f, t, 0.36);
        pottedPlant(x, z, rr(0.85, 1.15));
      }
    }
    setLod(prev);
  }

  function pottedPlant(x, z, s = 1, big = false) {
    const prev = setLod(LOD.DETAIL);
    geo.proto(T.roof, TPL.pot, x, 0, z, 0.24 * s, 0.42 * s, 0.24 * s, 0, { tint: 0.95 });
    if (big) { // lemon / bay tree in a large pot
      geo.proto(T.wood, TPL.cyl6, x, 0.42 * s, z, 0.03, 0.8 * s, 0.03, 0, { gao: false });
      geo.proto(T.plant, TPL.blob1, x, 1.45 * s, z, 0.5 * s, 0.55 * s, 0.5 * s, R() * 3, { gao: false, tint: [0.9, 1, 0.85] });
    } else geo.proto(T.plant, TPL.blob0, x, 0.62 * s, z, 0.3 * s, 0.36 * s, 0.3 * s, R() * 3, { gao: false });
    setLod(prev);
    collide(x - 0.25 * s, 0, z - 0.25 * s, x + 0.25 * s, 0.9, z + 0.25 * s);
    decals?.round(x, z, 0.55 * s, 0.35);
  }

  function shopFill(f, op, S) {
    const { t0, t1, y1 } = op, w = t1 - t0, tc = (t0 + t1) / 2, dd = -FAC + 0.05;
    let prev = setLod(LOD.BASE);
    const wooden = op.wooden;
    if (wooden) front(f, T.door, t0, t1, 0, y1, dd, { tint: rr(0.75, 0.95) });
    else {
      front(f, T.door, t0, t1, 0, 0.8, dd, { tint: 0.8 });
      front(f, T.glass, t0, t1, 0.8, y1, dd, { gao: false });
    }
    if (op.curve) {
      archFill(f, wooden ? T.door : T.glass, op.curve, dd, { tint: wooden ? 0.85 : 1 });
      archRing(f, T.trim, op.curve, 0.32, -0.02, 0.05, { tint: S.trimTint });
      lbox(f, T.trim, t0 - 0.32, t0, 0, y1, 0, 0.05, { tint: S.trimTint, open: 'btu' });
      lbox(f, T.trim, t1, t1 + 0.32, 0, y1, 0, 0.05, { tint: S.trimTint, open: 'btu' });
    }
    setLod(LOD.FAR);
    front(f, T.glass, t0, t1, 0, opTop(op), 0.02, { gao: false, tint: 0.8 });
    setLod(LOD.DETAIL);
    if (!wooden) {
      for (const t of [t0 + 0.04, tc, t1 - 0.04]) lbox(f, T.door, t - 0.035, t + 0.035, 0.8, y1, dd, dd + 0.08, { gao: false, open: 'b' });
      lbox(f, T.door, t0, t1, y1 - 0.04, y1 + 0.04, dd, dd + 0.08, { gao: false, open: 'b' });
      // Goods behind the glass: a few warm blocks (bottles, bread, ceramics).
      for (let k = 0; k < 4; k++) {
        const t = t0 + 0.2 + (k + 0.5) * (w - 0.4) / 4;
        lbox(f, pick([T.roof, T.fabric, T.wood, T.marble]), t - 0.12, t + 0.12, 0.8, 0.8 + rr(0.15, 0.4), dd - 0.35, dd - 0.1, { gao: false, tint: rr(0.6, 1) });
      }
    } else {
      for (let k = 1; k < 4; k++) { const t = t0 + (w * k) / 4; front(f, T.iron, t - 0.015, t + 0.015, 0.2, y1 - 0.1, dd + 0.01, { gao: false }); }
    }
    // Hanging wooden shop sign or fabric awning.
    const kind = R();
    if (kind < 0.35) {
      const t = t1 + 0.55;
      lbox(f, T.iron, t - 0.02, t + 0.02, 3.05, 3.09, 0, 0.95, { gao: false });
      lbox(f, T.wood, t - 0.03, t + 0.03, 2.45, 3.02, 0.28, 0.9, { gao: false, tint: rr(0.7, 1) });
    } else if (kind < 0.6 && S.awnings) awning(f, t0 - 0.2, t1 + 0.2, opTop(op) + 0.25, pick(AWNING_TINTS));
    setLod(prev);
  }
  const AWNING_TINTS = [[0.95, 0.9, 0.8], [0.62, 0.22, 0.16], [0.28, 0.4, 0.28], [0.75, 0.55, 0.25], [0.35, 0.38, 0.5]];

  function awning(f, t0, t1, y, tint) {
    const D = 1.1, drop = 0.55, prev = setLod(LOD.DETAIL);
    const o = { gao: false, tint };
    // Sloped canvas (double-sided) and a valance.
    const a = P3(f, t0, y, 0.02), b = P3(f, t1, y, 0.02), c = P3(f, t1, y - drop, D), d = P3(f, t0, y - drop, D);
    geo.quad(T.fabric, a, b, c, d, [f.dx, 1, f.dz], o);
    geo.quad(T.fabric, a, b, c, d, [-f.dx, -1, -f.dz], { gao: false, tint: mulTint(tint, 0.7) });
    front(f, T.fabric, t0, t1, y - drop - 0.25, y - drop, D, o);
    front(f, T.fabric, t0, t1, y - drop - 0.25, y - drop, D - 0.01, { gao: false, tint: mulTint(tint, 0.7) }); // back of valance (faces the same way; cheap)
    for (const t of [t0 + 0.05, t1 - 0.05]) lbox(f, T.iron, t - 0.015, t + 0.015, y - drop - 0.02, y, 0, D, { gao: false });
    setLod(prev);
  }

  // Gothic bifora: two narrow round-arched lights with a colonnette, under a relieving arch.
  // Base: the two openings (as real reveals) + tympanum; detail: colonnette + capital.
  function biforaOps(tc, y0, w, h, shape = 'round') {
    const lw = (w - 0.2) / 2;
    return [
      { kind: 'bif', t0: tc - w / 2, t1: tc - w / 2 + lw, y0, y1: y0 + h - lw / 2, shape: 'round', group: tc, gw: w, gs: shape },
      { kind: 'bif', t0: tc + w / 2 - lw, t1: tc + w / 2, y0, y1: y0 + h - lw / 2, shape: 'round', group: tc },
    ];
  }
  function biforaDress(f, op, S) {
    // Called once per bifora (left light carries gw).
    if (!op.gw) return;
    const w = op.gw, tc = op.group, y0 = op.y0, lw = op.t1 - op.t0, spring = op.y1;
    const outer = archCurve(tc - w / 2 - 0.02, tc + w / 2 + 0.02, spring, op.gs, 0);
    let prev = setLod(LOD.BASE);
    archRing(f, S.archMat || T.trim, outer, 0.22, -0.02, 0.05, { tint: S.trimTint }, op.gs !== 'pointed');
    lbox(f, T.trim, tc - w / 2 - 0.12, tc + w / 2 + 0.12, y0 - 0.1, y0 + 0.01, -FAC + 0.02, 0.08, { tint: S.trimTint, gao: false, open: 'b' });
    setLod(LOD.DETAIL);
    // Colonnette and capital between the lights.
    geo.proto(T.marble, TPL.cyl6, fx(f, tc, -0.12), y0, fz(f, tc, -0.12), 0.07, spring - y0 - 0.12, 0.07, 0, { gao: false });
    lbox(f, T.marble, tc - 0.1, tc + 0.1, spring - 0.14, spring + 0.02, -0.22, -0.02, { gao: false });
    setLod(prev);
    void lw;
  }

  function lantern(f, t, y) {
    const prev = setLod(LOD.DETAIL);
    lbox(f, T.iron, t - 0.025, t + 0.025, y + 0.2, y + 0.25, 0, 0.45, { gao: false, open: 'b' });
    const x = fx(f, t, 0.45), z = fz(f, t, 0.45);
    geo.box(M.lampGlass, x - 0.1, y - 0.2, z - 0.1, x + 0.1, y + 0.12, z + 0.1, { gao: false });
    geo.box(T.iron, x - 0.12, y - 0.24, z - 0.12, x + 0.12, y - 0.2, z + 0.12, { gao: false });
    geo.proto(T.iron, TPL.cone4, x, y + 0.12, z, 0.16, 0.14, 0.16, 0, { gao: false });
    setLod(prev);
  }

  function balcony(f, op, S) {
    const t0 = op.t0 - 0.45, t1 = op.t1 + 0.45, y = op.y0 - 0.02, D = 0.85;
    let prev = setLod(LOD.BASE);
    lbox(f, T.trim, t0, t1, y - 0.15, y, 0, D, { ao: 0.9, gao: false, tint: S.trimTint, open: 'b' });
    setLod(LOD.FAR);
    lbox(f, T.trim, t0, t1, y - 0.15, y, 0, D, { gao: false, open: 'b' });
    setLod(LOD.DETAIL);
    for (const t of [t0 + 0.2, t1 - 0.2]) {
      lbox(f, T.trim, t - 0.08, t + 0.08, y - 0.42, y - 0.15, 0, 0.55, { ao: 0.85, gao: false, open: 'bt' });
      lbox(f, T.trim, t - 0.07, t + 0.07, y - 0.62, y - 0.42, 0, 0.3, { ao: 0.85, gao: false, open: 'bt' });
    }
    const ir = T.iron, top = y + 1.0, io = { gao: false, open: 'b' };
    lbox(f, ir, t0 + 0.02, t1 - 0.02, top - 0.04, top, D - 0.06, D - 0.02, { gao: false });
    lbox(f, ir, t0 + 0.02, t0 + 0.06, top - 0.04, top, 0, D - 0.06, io);
    lbox(f, ir, t1 - 0.06, t1 - 0.02, top - 0.04, top, 0, D - 0.06, io);
    lbox(f, ir, t0 + 0.02, t1 - 0.02, y + 0.1, y + 0.13, D - 0.06, D - 0.02, { gao: false });
    const bars = { gao: false, open: 'tub' };
    for (let t = t0 + 0.06; t <= t1 - 0.05; t += 0.2) lbox(f, ir, t - 0.01, t + 0.01, y, top, D - 0.05, D - 0.03, bars);
    for (let d = 0.15; d < D - 0.08; d += 0.2) {
      lbox(f, ir, t0 + 0.03, t0 + 0.05, y, top, d - 0.01, d + 0.01, bars);
      lbox(f, ir, t1 - 0.05, t1 - 0.03, y, top, d - 0.01, d + 0.01, bars);
    }
    if (R() < 0.7) for (let k = 0; k < 3; k++) { // pots and geraniums
      const t = rr(t0 + 0.2, t1 - 0.2), x = fx(f, t, D - 0.25), z = fz(f, t, D - 0.25);
      geo.proto(T.roof, TPL.pot, x, y, z, 0.14, 0.24, 0.14, 0, { gao: false });
      geo.proto(T.plant, TPL.blob0, x, y + 0.38, z, rr(0.16, 0.24), rr(0.16, 0.22), rr(0.16, 0.24), R() * 3, { gao: false, tint: R() < 0.4 ? [1.3, 0.55, 0.5] : 1 });
    }
    setLod(prev);
  }

  // ---------------------------------------------------------------- roofs
  // Gable (ridge along the long side) or hip roof with overhang, underside, fascia and ridge caps.
  // Pitched roof over the rectangle. ov: eave overhang; opt.sides {N, S, W, E} overrides it per side
  // (0 on party walls, so neighbouring roofs meet at the wall instead of crossing), opt.ends
  // {A0, A1}: 'hip' | 'gable' per ridge end (a gable end gets a triangular wall up to the ridge).
  function roof(x0, x1, z0, z1, H, L, ov, opt = {}) {
    const tp = Math.tan(L.pitch ?? 0.35);
    const alongX = opt.axis ? opt.axis === 'x' : x1 - x0 >= z1 - z0;
    const hipAll = opt.hip || (!opt.gable && Math.max(x1 - x0, z1 - z0) / Math.min(x1 - x0, z1 - z0) < 1.35);
    const sd = opt.sides || {};
    const ovOf = (d) => (sd[d] ?? ov);
    const oA0 = ovOf(alongX ? 'W' : 'N'), oA1 = ovOf(alongX ? 'E' : 'S'), oB0 = ovOf(alongX ? 'N' : 'W'), oB1 = ovOf(alongX ? 'S' : 'E');
    const hip0 = opt.ends ? opt.ends.A0 === 'hip' : hipAll, hip1 = opt.ends ? opt.ends.A1 === 'hip' : hipAll;
    const wa0 = alongX ? x0 : z0, wa1 = alongX ? x1 : z1, wb0 = alongX ? z0 : x0, wb1 = alongX ? z1 : x1;
    const A0 = wa0 - oA0, A1 = wa1 + oA1, B0 = wb0 - oB0, B1 = wb1 + oB1;
    const half = (wb1 - wb0) / 2, Bc = (wb0 + wb1) / 2, Hr = H + half * tp;
    const ye0 = H - oB0 * tp, ye1 = H - oB1 * tp;          // eave heights of the two long sides
    const mid = (wa0 + wa1) / 2;
    const Ar0 = hip0 ? Math.min(wa0 + half, mid) : A0, Ar1 = hip1 ? Math.max(wa1 - half, mid) : A1;
    const P = (a, y, b) => (alongX ? [a, y, b] : [b, y, a]);
    const D = (da, dy, db) => (alongX ? [da, dy, db] : [db, dy, da]);
    const rf = T.roof, tile = rf.tile;
    const rt = L.roofTint ?? 1;
    const uvPlane = (eaveDir, eaveOrigin, upDir) => (p) => {
      const e = p[0] * eaveDir[0] + p[2] * eaveDir[2];
      const s = (p[0] - eaveOrigin[0]) * upDir[0] + (p[1] - eaveOrigin[1]) * upDir[1] + (p[2] - eaveOrigin[2]) * upDir[2];
      return [e / tile, s / tile];
    };
    const n1 = Math.hypot(1, tp);
    const nrm = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; return n[1] < 0 ? n.map((x) => -x / l) : n.map((x) => x / l); };
    const planes = [];
    planes.push({ pts: [P(A0, ye0, B0), P(A1, ye0, B0), P(Ar1, Hr, Bc), P(Ar0, Hr, Bc)], n: D(0, 1, -tp), e: D(1, 0, 0), up: D(0, tp / n1, 1 / n1), o: P(A0, ye0, B0) });
    planes.push({ pts: [P(A1, ye1, B1), P(A0, ye1, B1), P(Ar0, Hr, Bc), P(Ar1, Hr, Bc)], n: D(0, 1, tp), e: D(1, 0, 0), up: D(0, tp / n1, -1 / n1), o: P(A0, ye1, B1) });
    if (hip0) { const pts = [P(A0, ye1, B1), P(A0, ye0, B0), P(Ar0, Hr, Bc)]; planes.push({ pts, n: nrm(...pts), e: D(0, 0, 1), up: D(1 / n1, tp / n1, 0), o: P(A0, ye0, B0) }); }
    if (hip1) { const pts = [P(A1, ye0, B0), P(A1, ye1, B1), P(Ar1, Hr, Bc)]; planes.push({ pts, n: nrm(...pts), e: D(0, 0, 1), up: D(-1 / n1, tp / n1, 0), o: P(A1, ye0, B0) }); }
    const wallO = { tint: L.tint ?? 1, uvOff: L.uvOff, gao: false };
    const emit = (lod) => {
      const prev = setLod(lod);
      for (const pl of planes) {
        const uv = uvPlane(pl.e, pl.o, pl.up);
        if (pl.pts.length === 4) geo.quad(rf, ...pl.pts, pl.n, { gao: false, tint: rt }, uv);
        else geo.tri(rf, ...pl.pts, pl.n, { gao: false, tint: rt }, uv);
        if (lod === LOD.BASE) {
          const under = pl.pts.map((p) => [p[0], p[1] - 0.1, p[2]]), dn = [-pl.n[0], -pl.n[1], -pl.n[2]];
          if (pl.pts.length === 4) geo.quad(T.wood, ...under, dn, { gao: false, ao: 0.7 });
          else geo.tri(T.wood, ...under, dn, { gao: false, ao: 0.7 });
          const [a, b] = pl.pts;
          geo.quad(T.wood, [a[0], a[1] - 0.14, a[2]], [b[0], b[1] - 0.14, b[2]], b, a, [pl.n[0], 0, pl.n[2]], { gao: false, ao: 0.85 });
        }
      }
      // Gable ends: wall triangle up to the ridge (both faces, so a party-wall gable reads from either side).
      const wall = L.wall || T.plaster;
      for (const [isHip, wa, s, Aend] of [[hip0, wa0, -1, A0], [hip1, wa1, 1, A1]]) {
        if (isHip) continue;
        geo.tri(wall, P(wa, H, wb0), P(wa, H, wb1), P(wa, Hr, Bc), D(s, 0, 0), wallO);
        geo.tri(wall, P(wa, H, wb1), P(wa, H, wb0), P(wa, Hr, Bc), D(-s, 0, 0), wallO);
        if (lod === LOD.BASE && Math.abs(Aend - wa) > 0.02) for (const [Bend, ye] of [[B0, ye0], [B1, ye1]]) {
          const lo = P(Aend, ye, Bend), hi = P(Aend, Hr, Bc);
          geo.quad(T.wood, [lo[0], lo[1] - 0.14, lo[2]], [hi[0], hi[1] - 0.14, hi[2]], hi, lo, D(s, 0, 0), { gao: false, ao: 0.85 });
        }
      }
      if (lod === LOD.BASE) {
        if (Ar1 - Ar0 > 0.05) halfTube(rf, P(Ar0, Hr + 0.02, Bc), P(Ar1, Hr + 0.02, Bc), 0.13, { tint: rt }, 3);
        for (const [isHip, ae, ar] of [[hip0, A0, Ar0], [hip1, A1, Ar1]]) if (isHip) for (const [be, ye] of [[B0, ye0], [B1, ye1]]) halfTube(rf, P(ae, ye + 0.02, be), P(ar, Hr + 0.02, Bc), 0.11, { tint: rt }, 2);
      }
      setLod(prev);
    };
    emit(LOD.BASE);
    if (!opt.noFar) emit(LOD.FAR);
    return Hr;
  }

  // Half tube (ridge caps, gutters) between two points; the round side faces up.
  function halfTube(mat, a, b, r, o = {}, segs = 4) {
    const A = V3(...a), Bv = V3(...b), axis = Bv.clone().sub(A).normalize();
    const sd = new THREE.Vector3().crossVectors(axis, V3(0, 1, 0));
    if (sd.lengthSq() < 1e-6) sd.set(1, 0, 0);
    sd.normalize();
    const up = new THREE.Vector3().crossVectors(sd, axis).normalize();
    if (up.y < 0) up.negate();
    for (let k = 0; k < segs; k++) {
      const a0 = (Math.PI * k) / segs, a1 = (Math.PI * (k + 1)) / segs;
      const o0 = sd.clone().multiplyScalar(Math.cos(a0) * r).addScaledVector(up, Math.sin(a0) * r);
      const o1 = sd.clone().multiplyScalar(Math.cos(a1) * r).addScaledVector(up, Math.sin(a1) * r);
      const mid = o0.clone().add(o1).normalize();
      geo.quad(mat, A.clone().add(o0).toArray(), Bv.clone().add(o0).toArray(), Bv.clone().add(o1).toArray(), A.clone().add(o1).toArray(), mid.toArray(), { ...o, gao: false });
    }
  }

  // Four-sided pyramid roof (towers, campanili) with eave overhang e over [x0,x1]×[z0,z1] at y.
  function pyramid(x0, x1, z0, z1, y, h, e = 0.35, tint = 1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ap = [cx, y + h, cz];
    const c = [[x0 - e, y, z0 - e], [x1 + e, y, z0 - e], [x1 + e, y, z1 + e], [x0 - e, y, z1 + e]];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4], mid = [(a[0] + b[0]) / 2 - cx, 1.2, (a[2] + b[2]) / 2 - cz];
      geo.tri(T.roof, a, b, ap, mid, { gao: false, tint });
      if (geo.lod === LOD.BASE) geo.tri(T.wood, [a[0], y - 0.08, a[2]], [b[0], y - 0.08, b[2]], [cx, y - 0.08, cz], [0, -1, 0], { gao: false, ao: 0.7 });
    }
  }

  function chimney(cx, cz, base, top, S) {
    const prev = setLod(LOD.BASE);
    geo.box(S.wall, cx - 0.3, base, cz - 0.35, cx + 0.3, top, cz + 0.35, { tint: S.tint, gao: false, skip: 8 });
    geo.box(T.trim, cx - 0.4, top, cz - 0.45, cx + 0.4, top + 0.08, cz + 0.45, { gao: false });
    geo.box(S.wall, cx - 0.25, top + 0.08, cz - 0.3, cx + 0.25, top + 0.3, cz + 0.3, { tint: S.tint, gao: false, skip: 8 });
    halfTube(T.roof, [cx, top + 0.3, cz - 0.42], [cx, top + 0.3, cz + 0.42], 0.3, {}, 4);
    setLod(LOD.FAR);
    geo.box(S.wall, cx - 0.3, base, cz - 0.35, cx + 0.3, top + 0.3, cz + 0.35, { tint: S.tint, gao: false, skip: 8 });
    setLod(prev);
  }

  // Merlons along a face (Guelph = square). Emitted in BASE and FAR.
  function merlons(f, y, h, d0, d1, mat, o, step = 1.5, w = 0.8, t0 = 0.3, t1 = null) {
    t1 = t1 ?? f.W - 0.3;
    for (let t = t0; t + w <= t1 + 0.01; t += step) lbox(f, mat, t, t + w, y, y + h, d0, d1, { gao: false, ...o, open: 'u' });
  }

  return {
    T, TPL, FAC, rr, pick, setLod, front, side, hor, lbox, P3, faceMatrix,
    archCurve, curveTop, spandrel, intrados, archFill, archRing, opTop,
    facadeWall, windowFill, doorFill, shopFill, awning, biforaOps, biforaDress, lantern, balcony, pottedPlant,
    roof, halfTube, pyramid, chimney, merlons, shutters, glassPane,
  };
}
