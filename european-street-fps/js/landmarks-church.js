// Romanesque pieces (portal, rose window, campanile, archetti pensili) and three sites:
// the parish church (pieve) with campanile + cemetery, the hilltop chapel, the watchtower.
import * as THREE from 'three';
import { ruinTop } from './landmarks-kit.js';
import { T_bell } from './landmarks-geo.js';

// ------------------------------------------------------------------ shared pieces
// Decorates an arched door opening already cut by wall(): receding orders, jamb colonnettes,
// lintel and stone tympanum over the lunette.
export function portalDeco(K, f, t0, t1, y1, d1, o = {}) {
  const M = K.M, r = (t1 - t0) / 2, tc = (t0 + t1) / 2, T = M.stoneTrim;
  const di = d1 - (o.inset ?? 0.2);
  K.fbox(f, T, t0, t1, y1 - 0.34, y1, di, di + 0.08, { gao: false });            // architrave
  K.halfDisc(f, T, tc, y1, r, di + 0.03, { tint: 0.92 });                        // tympanum
  K.fbox(f, M.iron, tc - 0.03, tc + 0.03, y1 + r * 0.25, y1 + r * 0.8, di + 0.03, di + 0.06, { gao: false, d: true });
  K.fbox(f, M.iron, tc - 0.2, tc + 0.2, y1 + r * 0.55, y1 + r * 0.6, di + 0.03, di + 0.06, { gao: false, d: true });
  const orders = o.orders ?? 2;
  for (let k = 0; k < orders; k++) {
    const rr = r + 0.02 + k * 0.24, dd = d1 + 0.06 + k * 0.1;
    K.ring(f, tc, y1, rr, 0.24, d1 - 0.02, dd, T, { gao: false, tint: 1 - k * 0.04 });
    for (const s of [-1, 1]) {
      const tj = tc + s * (rr + 0.12);
      K.fbox(f, T, tj - 0.12, tj + 0.12, 0, y1, d1 - 0.02, dd, { tint: 1 - k * 0.04 });
    }
  }
  // Colonnettes in the outer order.
  for (const s of [-1, 1]) {
    const p = K.fp(f, tc + s * (r + 0.02 + orders * 0.24 + 0.12), 0, d1 + 0.18);
    K.cyl(T, p[0], 0.25, p[2], 0.11, y1 - 0.55, 8, { d: true });
    K.fbox(f, T, tc + s * (r + orders * 0.24 + 0.14) - 0.17, tc + s * (r + orders * 0.24 + 0.14) + 0.17, y1 - 0.3, y1, d1, d1 + 0.34, { gao: false });
    K.fbox(f, T, tc + s * (r + orders * 0.24 + 0.14) - 0.17, tc + s * (r + orders * 0.24 + 0.14) + 0.17, 0, 0.25, d1, d1 + 0.34, {});
  }
}
// Round rose window as a relief on a wall face (no hole): stone ring, dark glass, spokes.
export function rose(K, f, tc, yc, r, d1, o = {}) {
  const M = K.M, n = 16, w = o.w ?? 0.28, out = [f.dx, 0, f.dz], T = M.stoneTrim;
  const P = (a, rr, d) => K.fp(f, tc + Math.cos(a) * rr, yc + Math.sin(a) * rr, d);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    K.quad(T, P(a0, r, d1 + 0.12), P(a1, r, d1 + 0.12), P(a1, r + w, d1 + 0.12), P(a0, r + w, d1 + 0.12), out, { gao: false });
    K.quad(T, P(a0, r + w, d1), P(a1, r + w, d1), P(a1, r + w, d1 + 0.12), P(a0, r + w, d1 + 0.12), [Math.cos(am) * f.tx, Math.sin(am), Math.cos(am) * f.tz], { gao: false });
    K.quad(T, P(a0, r, d1), P(a1, r, d1), P(a1, r, d1 + 0.12), P(a0, r, d1 + 0.12), [-Math.cos(am) * f.tx, -Math.sin(am), -Math.cos(am) * f.tz], { gao: false, ao: 0.8 });
    K.tri(M.glass, K.fp(f, tc, yc, d1 + 0.01), P(a0, r, d1 + 0.01), P(a1, r, d1 + 0.01), out, { gao: false, tint: 0.7 });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    K.beam(T, K.fp(f, tc, yc, d1 + 0.06), P(a, r, d1 + 0.06), 0.07, 0.07, { d: true });
  }
}
// Lombard band: small blind arches hanging under a cornice along a face (relief).
export function lombardBand(K, f, t0, t1, y, d1, o = {}) {
  const M = K.M, s = o.s ?? 0.9, r = s / 2 - 0.06, n = Math.floor((t1 - t0) / s);
  const off = t0 + (t1 - t0 - n * s) / 2;
  for (let i = 0; i < n; i++) {
    const tc = off + s * (i + 0.5);
    K.ring(f, tc, y - r - 0.08, r, 0.08, d1, d1 + 0.07, M.stoneTrim, { gao: false, tint: 0.95 });
    K.fbox(f, M.stoneTrim, tc + s / 2 - 0.07, tc + s / 2 + 0.07, y - r - 0.28, y - r - 0.08, d1, d1 + 0.09, { gao: false });
  }
  K.fbox(f, M.stoneTrim, t0, t1, y - 0.08, y + 0.14, d1 - 0.05, d1 + 0.14, { gao: false });
}

// Square Romanesque bell tower on rect [x0, x0+w]×[z0, z0+w]: solid shaft to `floorY`, open
// belfry with bifore on every face, cornice and pyramid roof. Returns the belfry floor height.
// o.door: face with the ground door; o.viewpoint: walkable belfry (parapets are colliders).
export function campanile(K, x0, z0, w, floorY, o = {}) {
  const M = K.M, x1 = x0 + w, z1 = z0 + w, bH = o.belfryH ?? 5.2, mat = o.mat || M.stone, tint = o.tint ?? 1;
  const wo = { tint, uvOff: o.uvOff };
  const th = 0.65;
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(x0, x1, z0, z1, dir);
    const ops = [];
    if (dir === o.door) ops.push({ t0: w / 2 - 0.6, t1: w / 2 + 0.6, y0: 0, y1: 2.3, arch: true, fill: 'door', ring: true, ringW: 0.2 });
    // Slit windows up the shaft.
    for (let y = 5; y < floorY - 2.5; y += 4.2) ops.push({ t0: w / 2 - 0.12, t1: w / 2 + 0.12, y0: y, y1: y + 1.0, arch: true, fill: 'dark', archTop: 0.1 });
    K.wall(f, -3, floorY, -th, 0, mat, ops, wo);
    // Belfry with a bifora (open), sill acting as parapet 1 m above the floor.
    const bo = { t0: 0.9, t1: w - 0.9, y0: floorY + 1.0, y1: floorY + bH - 1.6 - (w - 1.8) / 2 + 0.6, arch: true, bifora: true, fill: 'open', pier: 0.3 };
    bo.y1 = Math.min(bo.y1, floorY + bH - 0.3 - (w - 1.8) / 2);
    K.wall(f, floorY, floorY + bH, -th, 0, mat, [bo], { ...wo, back: true });
    // String courses and cornice.
    for (const yy of o.courses || [floorY * 0.45]) K.fbox(f, M.stoneTrim, -0.12, w + 0.12, yy, yy + 0.22, -0.2, 0.1, { gao: false });
    K.fbox(f, M.stoneTrim, -0.12, w + 0.12, floorY - 0.05, floorY + 0.22, -0.2, 0.12, { gao: false });
    lombardBand(K, f, 0.2, w - 0.2, floorY + bH - 0.15, 0, { s: (w - 0.4) / 5 });
    K.fbox(f, M.stoneTrim, -0.22, w + 0.22, floorY + bH - 0.05, floorY + bH + 0.3, -0.2, 0.22, { gao: false });
  }
  // Interior of the belfry: floor, inner faces are the wall back faces (wall() back: true).
  K.box(M.stone, x0 + 0.3, floorY - 0.2, z0 + 0.3, x1 - 0.3, floorY, z1 - 0.3, { tint: 0.7, gao: false });
  K.box(M.wood, x0 + th, floorY + bH - 0.4, z0 + th, x1 - th, floorY + bH - 0.2, z1 - th, { tint: 0.6, gao: false });
  K.pyramid(x0, x1, z0, z1, floorY + bH + 0.3, o.roofH ?? w * 0.55, { ov: 0.35 });
  // Bell hung high enough to stand under.
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  K.tpl(M.metalBright, T_bell(), cx, floorY + bH - 1.75, cz, 0.55, 0.9, 0.55, 0, { tint: [0.75, 0.6, 0.38], d: true, gao: false });
  K.box(M.wood, x0 + th, floorY + bH - 0.7, cz - 0.12, x1 - th, floorY + bH - 0.45, cz + 0.12, { d: true, gao: false });
  // Colliders: shaft, parapets and corner piers of the belfry.
  K.col(x0, -3, z0, x1, floorY, z1);
  const ph = floorY + 1.05, pt = th;
  K.col(x0, floorY, z0, x1, ph, z0 + pt); K.col(x0, floorY, z1 - pt, x1, ph, z1);
  K.col(x0, floorY, z0, x0 + pt, ph, z1); K.col(x1 - pt, floorY, z0, x1, ph, z1);
  for (const [px, pz] of [[x0, z0], [x1 - 0.9, z0], [x0, z1 - 0.9], [x1 - 0.9, z1 - 0.9]]) K.col(px, floorY, pz, px + 0.9, floorY + bH, pz + 0.9);
  K.col(x0, floorY + bH - 0.4, z0, x1, floorY + bH + 3, z1);
  return floorY;
}

// Low cemetery / enclosure wall along x or z with a coping.
export function lowWall(K, x0, z0, x1, z1, h, mat, o = {}) {
  const M = K.M;
  K.box(mat, x0, -1, z0, x1, h, z1, { tint: o.tint ?? 1, col: true });
  K.box(o.cap || M.stoneTrim, x0 - 0.06, h, z0 - 0.06, x1 + 0.06, h + 0.14, z1 + 0.06, { gao: false });
}

// ------------------------------------------------------------------ PIEVE
export function buildPieve(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim;
  const st = [1.04, 1.0, 0.93];                          // warm sandstone tint
  const wo = { tint: st };
  const X0 = -42, X1 = -14, AZ = 8.4, NZ = 4.6, AE = 6.8, NE = 12.4, LT = 9.0;
  // Sagrato (paved parvis) and a stone bench along it.
  K.box(M.paving, X1 - 0.2, -0.5, -9.5, 1, 0.15, 9.5, { col: true, tint: [1.02, 1, 0.95] });
  K.box(T, X1 - 0.2, -0.5, -9.7, 1.2, 0.2, -9.5, { gao: false }); K.box(T, X1 - 0.2, -0.5, 9.5, 1.2, 0.2, 9.7, { gao: false });
  K.box(T, 1, -0.5, -9.7, 1.2, 0.2, 9.7, { gao: false });

  // --- Church body. Façade on the east (x = X1).
  const fac = K.face(X0, X1, -AZ, AZ, 'E');           // t = 8.4 - z
  const c = AZ;                                         // centre t
  const portal = { t0: c - 1.15, t1: c + 1.15, y0: 0.15, y1: 3.35, arch: true, fill: 'door' };
  const sideS = { t0: 1.55, t1: 2.65, y0: 0.15, y1: 2.5, arch: true, fill: 'door', ring: true };
  const sideN = { t0: 2 * AZ - 2.65, t1: 2 * AZ - 1.55, y0: 0.15, y1: 2.5, arch: true, fill: 'door', ring: true };
  K.wall(fac, -3, AE, -0.9, 0, S, [portal, sideS, sideN], wo);
  portalDeco(K, fac, portal.t0, portal.t1, portal.y1, 0);
  // Upper façade of the nave with a bifora and the rose window.
  const up = K.subFace(fac, AZ - NZ, 2 * NZ);
  K.wall(up, AE, NE, -0.9, 0, S, [{ t0: NZ - 0.9, t1: NZ + 0.9, y0: 7.2, y1: 8.4, arch: true, bifora: true, fill: 'glass' }], wo);
  rose(K, up, NZ, 10.9, 0.85, 0);
  // Pilasters (lesene) and the gable's blind arcade.
  for (const t of [0, AZ - NZ - 0.35, AZ + NZ - 0.35, 2 * AZ - 0.7]) K.fbox(fac, T, t, t + 0.7, 0, t === 0 || t > 16 ? AE : NE, -0.1, 0.16, { tint: 0.97 });
  K.fbox(fac, T, 0, 2 * AZ, AE - 0.1, AE + 0.12, -0.1, 0.2, { gao: false });
  lombardBand(K, up, 0.4, 2 * NZ - 0.4, NE - 0.05, 0, { s: 0.85 });
  // West end wall (behind the apse) and the side walls.
  const west = K.face(X0, X1, -AZ, AZ, 'W');
  K.wall(west, -3, AE, -0.9, 0, S, [], wo);
  K.wall(K.subFace(west, AZ - NZ, 2 * NZ), AE, NE, -0.9, 0, S, [], wo);
  for (const dir of ['N', 'S']) {
    const side = K.face(X0, X1, -AZ, AZ, dir);         // aisle outer walls, t along x
    const ops = [];
    for (let i = 0; i < 6; i++) { const t = 2.4 + i * 4.6; ops.push({ t0: t + 1.35, t1: t + 1.85, y0: 3.2, y1: 4.9, arch: true, fill: 'glass', ring: true, ringW: 0.14 }); }
    if (dir === 'S') ops.push({ t0: 13.4, t1: 14.6, y0: 0, y1: 2.4, arch: true, fill: 'door', ring: true });
    K.wall(side, -3, AE, -0.8, 0, S, ops, wo);
    for (let i = 0; i <= 6; i++) K.fbox(side, T, Math.min(side.W - 0.6, 0.0 + i * 4.6), Math.min(side.W, 0.6 + i * 4.6), 0, AE - 0.3, -0.1, 0.18, { tint: 0.96 });
    lombardBand(K, side, 0.2, side.W - 0.2, AE - 0.05, 0, { s: 0.92 });
    // Clerestory.
    const cl = K.face(X0, X1, -NZ, NZ, dir), cops = [];
    for (let i = 0; i < 6; i++) { const t = 2.4 + i * 4.6; cops.push({ t0: t + 1.38, t1: t + 1.82, y0: 9.8, y1: 11.0, arch: true, fill: 'glass', ring: true, ringW: 0.12 }); }
    K.wall(cl, LT - 0.4, NE, -0.8, 0, S, cops, wo);
    lombardBand(K, cl, 0.2, cl.W - 0.2, NE - 0.05, 0, { s: 0.92 });
    K.lean(X0, X1, dir === 'N' ? -AZ : NZ, dir === 'N' ? -NZ : AZ, AE, LT, dir, { ov: 0.35, wall: S, wallTint: st, ovSides: 0.25 });
  }
  K.roof(X0, X1, -NZ, NZ, NE, { axis: 'x', pitch: 0.36, ov: 0.3, wall: S, wallTint: st });
  // Apse.
  K.apseWall(X0, 0, 4.4, -3, 8.2, 'W', S, { ...wo, cornice: true, segs: 10 });
  for (const a of [-0.55, 0, 0.55]) {
    const ax = X0 - Math.cos(a) * 4.42, az = Math.sin(a) * 4.42;
    K.box(M.stone, ax - 0.2, 3.4, az - 0.2, ax + 0.2, 5.2, az + 0.2, { tint: 0.07, gao: false });
    K.box(T, ax - 0.3, 3.2, az - 0.3, ax + 0.26, 3.4, az + 0.3, { gao: false });
  }
  for (let k = 1; k < 5; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; K.box(T, X0 - Math.cos(a) * 4.4 - 0.18, 0, Math.sin(a) * 4.4 - 0.18, X0 - Math.cos(a) * 4.4 + 0.18, 7.8, Math.sin(a) * 4.4 + 0.18, { tint: 0.96 }); }
  K.apseRoof(X0, 0, 4.4, 8.2, 2.4, 'W', { segs: 10 });
  // Colliders: nave + aisles, apse.
  K.col(X0, -3, -AZ, X1, NE, AZ);
  K.col(X0 - 4.4, -3, -3.2, X0, 8, 3.2); K.col(X0 - 3.2, -3, -4.4, X0, 8, 4.4);

  // --- Campanile (viewpoint) north of the sagrato.
  const cx0 = -12.2, cz0 = -17, cw = 5.4;
  const floorY = campanile(K, cx0, cz0, cw, 17.2, { door: 'S', tint: st, courses: [6.4, 11.8] });
  ctx.viewpoints.push({ id: 'pieve-campanile', name: 'サンタ・マリア教会の鐘楼', base: K.V(cx0 + cw / 2, 0, cz0 + cw + 1.0), top: K.V(cx0 + cw / 2, floorY, cz0 + cw / 2 + 0.9), yaw: K.yaw(Math.PI * 0.75) });

  // --- Cemetery (walled, cypresses, graves, small ossuary chapel).
  const CX0 = -46, CX1 = -18, CZ0 = -38, CZ1 = -15, WH = 2.3;
  lowWall(K, CX0, CZ0, CX1, CZ0 + 0.5, WH, S, { tint: st });
  lowWall(K, CX0, CZ1 - 0.5, CX1, CZ1, WH, S, { tint: st });
  lowWall(K, CX0, CZ0, CX0 + 0.5, CZ1, WH, S, { tint: st });
  const gz0 = -28.2, gz1 = -24.8;
  lowWall(K, CX1 - 0.5, CZ0, CX1, gz0, WH, S, { tint: st });
  lowWall(K, CX1 - 0.5, gz1, CX1, CZ1, WH, S, { tint: st });
  for (const gz of [gz0 - 0.6, gz1]) {
    K.sbox(T, CX1 - 0.65, 0, gz, CX1 + 0.15, 2.9, gz + 0.6);
    K.pyramid(CX1 - 0.65, CX1 + 0.15, gz, gz + 0.6, 2.9, 0.45, { ov: 0.05, mat: T });
  }
  for (let i = 0; i < 12; i++) { // iron gate (two leaves, ajar)
    const z = gz0 + 0.15 + i * 0.27;
    K.box(M.iron, CX1 - 0.3, 0.05, z - 0.015, CX1 - 0.27, 2.0, z + 0.015, { d: true, gao: false });
  }
  K.box(M.iron, CX1 - 0.31, 1.9, gz0, CX1 - 0.26, 1.96, gz1, { d: true, gao: false });
  K.box(M.iron, CX1 - 0.31, 0.4, gz0, CX1 - 0.26, 0.45, gz1, { d: true, gao: false });
  K.box(ctx.L.gravel, CX0 + 0.5, -0.1, gz0 + 0.2, CX1 - 0.5, 0.03, gz1 - 0.2, { receive: true, cast: false });
  // Graves in rows either side of the path.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
    if (R() < 0.15) continue;
    const gx = -40 + i * 3.1 + (R() - 0.5) * 0.3, gz = (side < 0 ? gz0 - 2.2 - row * 3.0 : gz1 + 1.4 + row * 3.0);
    if (gz < CZ0 + 1.2 || gz > CZ1 - 2.2) continue;
    K.box(T, gx - 0.45, 0, gz, gx + 0.45, 0.22, gz + 1.9, { tint: 0.9 + R() * 0.12, d: true });
    const hz = side < 0 ? gz + 1.9 : gz - 0.12;
    if (R() < 0.35) {
      K.box(M.iron, gx - 0.03, 0, hz, gx + 0.03, 1.15, hz + 0.06, { d: true, gao: false });
      K.box(M.iron, gx - 0.3, 0.8, hz, gx + 0.3, 0.86, hz + 0.06, { d: true, gao: false });
    } else {
      const hh = 0.7 + R() * 0.4;
      K.box(T, gx - 0.38, 0, hz, gx + 0.38, hh, hz + 0.12, { tint: 0.85 + R() * 0.15 });
      K.halfTube(T, [gx - 0.38, hh, hz + 0.06], [gx + 0.38, hh, hz + 0.06], 0.06, { d: true }, 3);
    }
  }
  // Ossuary chapel at the far end.
  {
    const ox0 = -45.5, ox1 = -40, oz0 = gz0 - 1.8, oz1 = gz1 + 1.8;
    const f = K.face(ox0, ox1, oz0, oz1, 'E');
    K.wall(f, -1, 3.6, -0.5, 0, S, [{ t0: (oz1 - oz0) / 2 - 0.65, t1: (oz1 - oz0) / 2 + 0.65, y0: 0, y1: 2.2, arch: true, fill: 'grille', ring: true }], wo);
    for (const d of ['N', 'S']) K.wall(K.face(ox0, ox1, oz0, oz1, d), -1, 3.6, -0.5, 0, S, [], wo);
    K.roof(ox0, ox1, oz0, oz1, 3.6, { axis: 'x', pitch: 0.4, ov: 0.3, wall: S, wallTint: st });
    K.col(ox0, -1, oz0, ox1, 3.6, oz1);
    K.box(M.iron, ox1 + 0.02, 5.1, (oz0 + oz1) / 2 - 0.04, ox1 + 0.08, 6.0, (oz0 + oz1) / 2 + 0.04, { gao: false });
    K.box(M.iron, ox1 + 0.02, 5.6, (oz0 + oz1) / 2 - 0.3, ox1 + 0.08, 5.67, (oz0 + oz1) / 2 + 0.3, { gao: false });
  }
  for (const [x, z] of [[-43, -35.5], [-36, -35.6], [-29, -35.5], [-22, -35.6], [-43, -17.6], [-36, -17.5], [-29, -17.6], [-22, -17.5]]) K.cypress(x, z, 10 + R() * 4, 0.95 + R() * 0.25);

  // --- Canonica (rectory) south-west with pergola and well.
  {
    const x0 = -40, x1 = -26, z0 = 13, z1 = 21.5, H = 7.2;
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(x0, x1, z0, z1, dir), ops = [];
      const n = Math.floor(f.W / 3.2);
      for (let i = 0; i < n; i++) {
        const t = (f.W / n) * (i + 0.5);
        if (dir === 'E' && i === Math.floor(n / 2)) ops.push({ t0: t - 0.6, t1: t + 0.6, y0: 0, y1: 2.4, fill: 'door', frame: true });
        else ops.push({ t0: t - 0.45, t1: t + 0.45, y0: 1.0, y1: 2.4, fill: 'glass', frame: true, shutters: 2 });
        ops.push({ t0: t - 0.45, t1: t + 0.45, y0: 4.3, y1: 5.8, fill: 'glass', frame: true, shutters: 2 });
      }
      K.wall(f, -2, H, -0.5, 0, S, ops, { tint: [0.98, 0.96, 0.92], top: H });
    }
    K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.33, ov: 0.55, wall: S, wallTint: [0.98, 0.96, 0.92] });
    K.col(x0, -2, z0, x1, H, z1);
    K.box(T, x1 - 3.2, 5.0, z0 + 2.8, x1 - 2.4, 5.1, z0 + 5.6, { d: true });
    K.pergola(x0 + 1, z1 + 0.6, x1 - 1, z1 + 3.8, 2.6, 0, { skipSide: 'z0' });
    K.well(-20, 18);
    K.pine(-48, 20, 12, 5.5);
    K.tree(-33, 30, 5, 2.2, 0, { tint: [0.7, 0.78, 0.62] });
    K.tree(-24, 31, 4.6, 2.0, 0, { tint: [0.7, 0.78, 0.62] });
  }
  // Cypresses flanking the sagrato and along the approach road (east-north-east).
  K.cypress(2.5, -11.5, 13, 1.1); K.cypress(2.5, 11.5, 12.5, 1.1);
  const rd = [0.83, -0.55], nrm = [0.55, 0.83];
  for (let d = 14; d < 46; d += 8.5) for (const s of [-1, 1]) {
    const x = rd[0] * d + nrm[0] * s * 5.5, z = rd[1] * d + nrm[1] * s * 5.5;
    if (ctx.roadClear(x, z, 3.5)) K.cypress(x, z, 11 + R() * 3, 1.0 + R() * 0.2);
  }
  K.bench(-6, -9.2, 2.2, 0.15, 0, { stone: true });

  ctx.spawnsLocal([[6, -4], [7, 9], [-20, 11], [-50, 9], [-30, -26], [-3, -22], [-47, -8]]);
  ctx.enemy = { x: -12, z: 0, r: 34 };
}

// ------------------------------------------------------------------ CHAPEL
export function buildChapel(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim;
  const st = [1.05, 1.02, 0.96];
  // Façade faces west (toward the road end); nave along x.
  const x0 = 1, x1 = 11, z0 = -3.4, z1 = 3.4, H = 5.4;
  K.box(M.paving, x0 - 3.2, -0.4, -4.4, x0 + 0.2, 0.15, 4.4, { col: true });
  const fac = K.face(x0, x1, z0, z1, 'W');
  K.wall(fac, -2, H, -0.6, 0, S, [{ t0: 2.8, t1: 4.0, y0: 0.15, y1: 2.6, arch: true, fill: 'door' }], { tint: st });
  portalDeco(K, fac, 2.8, 4.0, 2.6, 0, { orders: 1 });
  rose(K, fac, 3.4, 4.3, 0.45, 0, { w: 0.18 });
  for (const dir of ['N', 'S']) {
    const f = K.face(x0, x1, z0, z1, dir);
    K.wall(f, -2, H, -0.6, 0, S, [{ t0: 4.7, t1: 5.2, y0: 2.2, y1: 3.6, arch: true, fill: 'glass', ring: true, ringW: 0.12 }], { tint: st });
    lombardBand(K, f, 0.2, f.W - 0.2, H - 0.05, 0, { s: 0.8 });
  }
  K.wall(K.face(x0, x1, z0, z1, 'E'), -2, H, -0.6, 0, S, [], { tint: st });
  K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.42, ov: 0.35, wall: S, wallTint: st });
  K.apseWall(x1, 0, 2.4, -2, 4.4, 'E', S, { tint: st, cornice: true, segs: 8 });
  K.apseRoof(x1, 0, 2.4, 4.4, 1.3, 'E', { segs: 8 });
  // Bell-cote (campanile a vela) on the façade gable.
  const ridge = H + 3.4 * Math.tan(0.42);
  const bf = K.face(x0 - 0.05, x0 + 0.55, -1.3, 1.3, 'W');
  K.wall(bf, ridge - 0.9, ridge + 2.4, -0.6, 0, S, [{ t0: 0.75, t1: 1.85, y0: ridge - 0.1, y1: ridge + 1.0, arch: true, fill: 'open' }], { tint: st, back: true });
  K.fbox(bf, T, -0.1, 2.7, ridge + 2.4, ridge + 2.6, -0.7, 0.1, { gao: false });
  K.tpl(M.metalBright, T_bell(), x0 + 0.25, ridge + 0.35, 0, 0.36, 0.55, 0.36, 0, { tint: [0.75, 0.6, 0.38], d: true, gao: false });
  K.box(M.iron, x0 + 0.22, ridge + 2.6, -0.03, x0 + 0.28, ridge + 3.3, 0.03, { gao: false });
  K.box(M.iron, x0 + 0.22, ridge + 3.0, -0.22, x0 + 0.28, ridge + 3.06, 0.22, { gao: false });
  K.col(x0, -2, z0, x1, H, z1); K.col(x1, -2, -2.4, x1 + 2.4, 4.4, 2.4);
  // Ring of cypresses, stone bench and cross on the hilltop, low wall on the east brow.
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13;
    const rr = 15.5 + (R() - 0.5) * 1.2, x = 4 + Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!ctx.roadClear(x, z, 3.2)) continue;
    K.cypress(x, z, 11 + R() * 3.5, 1.0 + R() * 0.2);
  }
  K.bench(16, -5, 2.4, 0, 1, { stone: true }); K.bench(16, 5, 2.4, 0, 1, { stone: true });
  K.box(T, -8.3, 0, 6.8, -7.7, 0.4, 7.4, {});
  K.box(T, -8.1, 0.4, 7.0, -7.9, 3.0, 7.2, {}); K.box(T, -8.1, 2.1, 6.6, -7.9, 2.3, 7.6, {});
  for (let i = 0; i < 7; i++) {
    const a = -0.75 + i * 0.25, x = 4 + Math.cos(a) * 21, z = Math.sin(a) * 21;
    K.box(S, x - 1.6, -1.2, z - 1.6, x + 1.6, 0.55 + R() * 0.3, z + 1.6, { tint: st, col: true });
  }
  K.tree(-6, -12, 5, 2.3, 0, { tint: [0.68, 0.76, 0.6] });
  ctx.spawnsLocal([[-6, -4], [-5, 6], [18, 0], [6, -9], [6, 9], [-12, 1]]);
  ctx.enemy = { x: 2, z: 0, r: 22 };
}

// ------------------------------------------------------------------ WATCHTOWER
export function buildWatchtower(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim;
  const st = [0.95, 0.94, 0.92];
  const x0 = -8, x1 = -1, z0 = -3.5, z1 = 3.5, H = 22, w = x1 - x0;
  // Battered base (scarp) and shaft.
  const sb = 1.1, sh = 3.2;
  K.box(S, x0 - sb, -4, z0 - sb, x1 + sb, 0.6, z1 + sb, { tint: st });
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(x0, x1, z0, z1, dir);
    K.quad(S, K.fp(f, -sb, 0.6, sb), K.fp(f, w + sb, 0.6, sb), K.fp(f, w, sh, 0), K.fp(f, 0, sh, 0), [f.dx, 0.5, f.dz], { tint: st, gao: false });
    const ops = [];
    for (let y = 6; y < H - 3; y += 4.5) ops.push({ t0: w / 2 - 0.12, t1: w / 2 + 0.12, y0: y, y1: y + 1.1, arch: false, fill: 'dark' });
    if (dir === 'E') ops.push({ t0: w / 2 - 0.55, t1: w / 2 + 0.55, y0: 5.4, y1: 7.6, arch: true, fill: 'door', ring: true });
    if (dir === 'S' || dir === 'W') ops.push({ t0: 1.6, t1: 2.3, y0: 14.5, y1: 15.8, arch: true, fill: 'dark', ring: true, ringW: 0.14 });
    K.wall(f, sh - 0.2, H, -0.9, 0, S, ops, { tint: st });
    // Putlog holes (dark specks) and machicolated parapet.
    for (let k = 0; k < 10; k++) { const t = 0.4 + R() * (w - 0.8), y = 3.5 + R() * (H - 5); K.fbox(f, S, t - 0.09, t + 0.09, y - 0.09, y + 0.09, -0.3, 0.01, { tint: 0.1, gao: false, d: true }); }
    K.corbels(f, -0.1, w + 0.1, H + 0.9, 0.55, T, { sp: 1.0 });
    K.fbox(f, S, -0.55, w + 0.55, H + 0.9, H + 1.9, -0.05, 0.55, { tint: st, gao: false });
    K.merlons(f, -0.55, w + 0.55, H + 1.9, 1.1, -0.05, 0.55, S, { w: 0.8, g: 0.62, tint: st });
    K.fbox(f, T, -0.6, w + 0.6, H + 1.85, H + 1.95, -0.1, 0.6, { gao: false });
  }
  K.box(S, x0 - 0.5, H + 0.6, z0 - 0.5, x1 + 0.5, H + 0.9, z1 + 0.5, { tint: 0.8, gao: false });
  K.box(M.paving, x0, H + 0.9, z0, x1, H + 1.0, z1, { tint: 0.85, gao: false });
  K.box(S, x0 + 2.2, H + 1.0, z0 + 2.2, x0 + 3.4, H + 1.9, z0 + 3.4, { tint: 0.8 }); // stair hatch
  K.box(M.wood, x0 + 2.25, H + 1.9, z0 + 2.25, x0 + 3.35, H + 1.95, z0 + 3.35, { d: true });
  // External wooden stair to the raised door (east face): one flight north, then a landing.
  const dx = x1, top = 5.4, ns = 16, run = 0.36, zs = 1.3 + ns * run;
  K.stair(dx + 1.0, zs, 1.1, 'N', ns, top / ns, run, M.wood, 0, { solid: false });
  K.box(M.wood, dx, top - 0.16, -0.9, dx + 2.0, top, 1.3, { col: true, gao: false });
  for (const [px, pz] of [[dx + 1.9, -0.8], [dx + 1.9, 1.2], [dx + 1.5, 3.2], [dx + 1.5, 5.2]]) K.box(M.wood, px - 0.09, -0.3, pz - 0.09, px + 0.09, pz > 2 ? top * (zs - pz) / (ns * run) : top, pz + 0.09, { d: true });
  K.beam(M.wood, [dx + 1.55, 1.0, zs], [dx + 1.55, top + 1.0, 1.3], 0.07, 0.07, { d: true });
  K.box(M.wood, dx + 1.95, top, -0.9, dx + 2.0, top + 1.0, 1.3, { d: true, gao: false, col: true });
  K.box(M.wood, dx, top, -0.95, dx + 2.0, top + 1.0, -0.9, { d: true, gao: false, col: true });
  // Colliders: shaft + scarp, walkable top with parapets.
  K.col(x0 - sb, -4, z0 - sb, x1 + sb, 0.6, z1 + sb);
  K.col(x0, 0, z0, x1, H + 1.0, z1);
  const py = H + 1.0, ph = py + 1.9, p = 0.5;
  K.col(x0 - 0.55, py, z0 - 0.55, x1 + 0.55, ph, z0 + 0.05); K.col(x0 - 0.55, py, z1 - 0.05, x1 + 0.55, ph, z1 + 0.55);
  K.col(x0 - 0.55, py, z0 - 0.55, x0 + 0.05, ph, z1 + 0.55); K.col(x1 - 0.05, py, z0 - 0.55, x1 + 0.55, ph, z1 + 0.55);
  K.col(x0 + 2.2, py, z0 + 2.2, x0 + 3.4, py + 0.9, z0 + 3.4);
  void p;
  ctx.viewpoints.push({ id: 'watchtower', name: '見張りの塔', base: K.V(x1 + 1.0, 0, zs + 0.8), top: K.V(x0 + 5.3, py, z0 + 5.3), yaw: K.yaw(-Math.PI / 2) });
  // Ruined enclosure wall with a broken gate toward the road (east).
  const rw = [[-17, -13, 14, -12.2], [-17, 13, 14, 13.8], [-17.8, -13, -17, 13.8], [13.2, -13, 14, -2.6], [13.2, 2.6, 14, 13.8]];
  for (const [ax0, az0, ax1, az1] of rw) {
    const alongX = ax1 - ax0 > az1 - az0;
    const f = alongX ? K.face(ax0, ax1, az0, az1, 'S') : K.face(ax0, ax1, az0, az1, 'E');
    const d0 = -(alongX ? az1 - az0 : ax1 - ax0);
    // Walls: some stretches stand high with merlon stubs, others are low rubble.
    let t = 0;
    while (t < f.W - 0.1) {
      const seg = Math.min(f.W - t, 3 + R() * 5), hi = R() < 0.45;
      ruinTop(K, f, t, t + seg, -1.5, hi ? 3.2 + R() * 1.6 : 0.6 + R() * 1.0, d0, 0, S, R, { tint: st, col: true });
      t += seg;
    }
  }
  for (const s of [-1, 1]) { // gate piers
    K.sbox(S, 12.8, -1, s * 2.6 - (s > 0 ? 0 : 1.2), 14.4, 4.2 + (s > 0 ? 0 : -1.4), s * 2.6 + (s > 0 ? 1.2 : 0), { tint: st });
  }
  // Rubble heaps.
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.28, rr = 7 + R() * 7, x = -4.5 + Math.cos(a) * rr * 1.3, z = Math.sin(a) * rr;
    const s = 0.25 + R() * 0.5;
    K.box(S, x - s, -0.2, z - s * 0.8, x + s, s * 0.9, z + s * 0.8, { tint: st.map((v) => v * (0.85 + R() * 0.2)), d: true });
  }
  K.pine(-14, 9, 11, 5); K.cypress(9, -9, 11, 1.0); K.cypress(10.5, 9, 12, 1.05);
  K.tree(-12, -9, 4.5, 2.0, 0, { tint: [0.7, 0.76, 0.6] });
  ctx.spawnsLocal([[8, 0], [3, 8], [3, -8], [-12, 3], [-10, -6], [18, 4]]);
  ctx.enemy = { x: 2, z: 0, r: 22 };
}
