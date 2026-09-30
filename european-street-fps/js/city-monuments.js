// Monuments: city walls with towers and gatehouses, the collegiata with its stair, churches with
// campanili, the civic palazzi and loggia, the convent cloister, the rocca, vaulted passages and
// buttress arches across alleys.
import * as THREE from 'three';
import { LOD } from './city-geo.js';
import { makeFace, fx, fz, mulTint } from './city-kit.js';
import { TX0, TX1, TZ0, TZ1, IX0, IX1, IZ0, IZ1, MON, WALL_TOWERS, PASSAGES, ALLEY_ARCHES } from './city-plan.js';

export function createMonuments(ctx) {
  const { geo, R, collide, kit, B } = ctx;
  const { T, TPL, FAC, rr, setLod, front, side, hor, lbox, archCurve, curveTop, spandrel, intrados, archFill, archRing, roof, pyramid, merlons, doorFill } = kit;
  const FOUND = -30;           // foundations / outer wall faces go down the hillside
  const WALL_H = 10.5;
  const wallTint = [1.0, 0.98, 0.94];
  const viewpoints = [];

  // ---------------------------------------------------------------- city walls
  // Wall segments between gatehouses and towers, split every ≤ 40 m so they chunk well.
  function wallRun(axis, c0, c1, a0, a1, outSide) {
    // axis 'x': wall runs along x, occupies z∈[c0,c1]; outSide: -1 → outer face at c0.
    for (let a = a0; a < a1 - 0.01; a += 40) {
      const b = Math.min(a1, a + 40);
      const box = (y0, y1, d0, d1, o) => axis === 'x' ? geo.box(T.stoneDark, a, y0, d0, b, y1, d1, o) : geo.box(T.stoneDark, d0, y0, a, d1, y1, b, o);
      const lo = { tint: wallTint, uvOff: [a * 0.13, 0.3] };
      setLod(LOD.BASE);
      box(FOUND, WALL_H, c0, c1, lo);
      // Walkway parapet with merlons on the outer edge, low parapet inside.
      const outer = outSide < 0 ? [c0 - 0.15, c0 + 0.55] : [c1 - 0.55, c1 + 0.15];
      const inner = outSide < 0 ? [c1 - 0.35, c1] : [c0, c0 + 0.35];
      box(WALL_H, WALL_H + 1.0, outer[0], outer[1], { ...lo, gao: false });
      box(WALL_H, WALL_H + 0.6, inner[0], inner[1], { ...lo, gao: false });
      for (let m = a + 0.4; m + 0.9 <= b; m += 1.9) {
        if (axis === 'x') geo.box(T.stoneDark, m, WALL_H + 1.0, outer[0], m + 0.9, WALL_H + 2.0, outer[1], { ...lo, gao: false, skip: 8 });
        else geo.box(T.stoneDark, outer[0], WALL_H + 1.0, m, outer[1], WALL_H + 2.0, m + 0.9, { ...lo, gao: false, skip: 8 });
      }
      // Corbelled string course on the outer face.
      const sc = outSide < 0 ? [c0 - 0.3, c0] : [c1, c1 + 0.3];
      box(WALL_H - 0.6, WALL_H - 0.3, sc[0], sc[1], { gao: false, tint: 0.95 });
      setLod(LOD.FAR);
      box(FOUND, WALL_H + 1.6, c0, c1, { ...lo, gao: false });
      setLod(LOD.DETAIL);
      // Arrow slits on the outer face.
      for (let m = a + 3; m < b - 1; m += 7) {
        if (axis === 'x') geo.rect(T.glass, 'z', outSide, outSide < 0 ? c0 - 0.01 : c1 + 0.01, m - 0.08, m + 0.08, 4.5, 6.0, { gao: false, tint: 0.3 });
        else geo.rect(T.glass, 'x', outSide, outSide < 0 ? c0 - 0.01 : c1 + 0.01, 4.5, 6.0, m - 0.08, m + 0.08, { gao: false, tint: 0.3 });
      }
      setLod(LOD.BASE);
      if (axis === 'x') collide(a, FOUND, c0, b, WALL_H + 2, c1); else collide(c0, FOUND, a, c1, WALL_H + 2, b);
    }
  }
  function walls() {
    // Break points: gatehouses (±9 around gate centres) on each side.
    wallRun('x', TZ0, IZ0, TX0, -9, -1); wallRun('x', TZ0, IZ0, 9, TX1, -1);
    wallRun('x', IZ1, TZ1, TX0, -9, 1); wallRun('x', IZ1, TZ1, 9, TX1, 1);
    wallRun('z', TX0, IX0, IZ0, -9, -1); wallRun('z', TX0, IX0, 9, IZ1, -1);
    wallRun('z', IX1, TX1, IZ0, -9, 1); wallRun('z', IX1, TX1, 9, IZ1, 1);
    for (const [x, z, side] of WALL_TOWERS) wallTower(x, z, side);
  }
  function wallTower(x, z, sideName) {
    const corner = sideName.length === 2, s = corner ? 4.5 : 3.6, out = 2.2, H = corner ? 16 : rr(13.5, 15);
    let x0 = x - s, x1 = x + s, z0 = z - s, z1 = z + s;
    if (!corner) {
      if (sideName === 'N') { z0 = z - out; z1 = z + 2 * s - out; }
      if (sideName === 'S') { z1 = z + out; z0 = z - 2 * s + out; }
      if (sideName === 'W') { x0 = x - out; x1 = x + 2 * s - out; }
      if (sideName === 'E') { x1 = x + out; x0 = x - 2 * s + out; }
    } else {
      x0 = sideName.includes('W') ? x - out : x - 2 * s + out; x1 = x0 + 2 * s;
      z0 = sideName.includes('N') ? z - out : z - 2 * s + out; z1 = z0 + 2 * s;
    }
    const tint = mulTint(wallTint, rr(0.94, 1.03));
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    setLod(LOD.BASE);
    geo.box(T.stoneDark, x0, FOUND, z0, x1, H, z1, { tint, uvOff: [x * 0.1, z * 0.1] });
    // Batter (scarp) at the foot outside, corbels, merlons.
    geo.box(T.stoneDark, x0 - 0.25, FOUND, z0 - 0.25, x1 + 0.25, -0.2, z1 + 0.25, { tint: mulTint(tint, 0.9), gao: false });
    geo.box(T.trim, x0 - 0.2, H - 0.3, z0 - 0.2, x1 + 0.2, H, z1 + 0.2, { gao: false, tint: 0.9 });
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace([x0, x1, z0, z1], dir);
      lbox(f, T.stoneDark, -0.2, f.W + 0.2, H, H + 0.9, -0.3, 0.2, { gao: false, tint, open: 'u' });
      merlons(f, H + 0.9, 1.0, -0.3, 0.2, T.stoneDark, { tint }, 1.6, 0.85, 0.0, f.W);
      setLod(LOD.DETAIL);
      front(f, T.glass, f.W / 2 - 0.08, f.W / 2 + 0.08, H - 5, H - 3.4, 0.01, { gao: false, tint: 0.3 });
      setLod(LOD.BASE);
    }
    setLod(LOD.FAR); geo.box(T.stoneDark, x0, FOUND, z0, x1, H + 1.9, z1, { tint, gao: false }); setLod(LOD.BASE);
    collide(x0, FOUND, z0, x1, H + 2, z1);
    geo.unlock();
  }

  // ---------------------------------------------------------------- gatehouses
  function gate(r, outDir, name) {
    const [x0, x1, z0, z1] = r, H = 15.5;
    const f = makeFace(r, outDir), back = makeFace(r, { N: 'S', S: 'N', E: 'W', W: 'E' }[outDir]);
    const W = f.W, c = W / 2, w = 5.6, spring = 5.0;
    const depth = outDir === 'N' || outDir === 'S' ? z1 - z0 : x1 - x0;
    const tint = mulTint(wallTint, 1.02);
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    setLod(LOD.BASE);
    // Solid side masses and the mass above the vault.
    const along = outDir === 'N' || outDir === 'S';
    const pass0 = along ? (x0 + x1) / 2 - w / 2 : (z0 + z1) / 2 - w / 2, pass1 = pass0 + w;
    const mass = (a0, a1, y0, y1, o) => along ? geo.box(T.stoneDark, a0, y0, z0, a1, y1, z1, o) : geo.box(T.stoneDark, x0, y0, a0, x1, y1, a1, o);
    const lo = { tint, uvOff: [0.2, 0.1] };
    const Aa = along ? x0 : z0, Ab = along ? x1 : z1;
    mass(Aa, pass0, FOUND, H, lo); mass(pass1, Ab, FOUND, H, lo);
    const crown = spring + w / 2;
    mass(pass0, pass1, crown, H, { ...lo, skip: along ? 16 | 32 : 1 | 2 });
    if (along) { collide(x0, FOUND, z0, pass0, H + 1, z1); collide(pass1, FOUND, z0, x1, H + 1, z1); collide(pass0, spring, z0, pass1, H + 1, z1); }
    else { collide(x0, FOUND, z0, x1, H + 1, pass0); collide(x0, FOUND, pass1, x1, H + 1, z1); collide(x0, spring, pass0, x1, H + 1, pass1); }
    // Arched faces front and back, the barrel vault and a deep outer archivolt (Sienese style).
    for (const ff of [f, back]) {
      const ct = ff === f ? c : W - c;
      const curve = archCurve(ct - w / 2, ct + w / 2, spring, 'round');
      spandrel(ff, T.stoneDark, curve, crown + 0.01, 0.001, lo);
      archRing(ff, T.trim, curve, 0.55, -0.01, 0.12, { tint: 0.92 });
      if (ff === f) { // outer pointed relieving arch and coat of arms
        const big = archCurve(ct - w / 2 - 1.2, ct + w / 2 + 1.2, spring + 0.6, 'pointed');
        archRing(ff, T.trim, big, 0.35, -0.01, 0.08, { tint: 0.88 }, false);
        lbox(ff, T.marble, ct - 0.5, ct + 0.5, crown + 2.4, crown + 3.6, 0, 0.12, { gao: false, open: 'b' });
      }
    }
    const curve = archCurve(pass0, pass1, spring, 'round');
    for (let k = 0; k < curve.length - 1; k++) {
      const [ta, ya] = curve[k], [tb, yb] = curve[k + 1], mt = (ta + tb) / 2 - (pass0 + pass1) / 2, my = (ya + yb) / 2 - spring, l = Math.hypot(mt, my);
      if (along) geo.quad(T.stoneDark, [ta, ya, z0], [tb, yb, z0], [tb, yb, z1], [ta, ya, z1], [-mt / l, -my / l, 0], { gao: false, ao: 0.6 });
      else geo.quad(T.stoneDark, [x0, ya, ta], [x0, yb, tb], [x1, yb, tb], [x1, ya, ta], [0, -my / l, -mt / l], { gao: false, ao: 0.6 });
    }
    // Open wooden gate leaves folded against the passage walls, iron-studded.
    const leafD = Math.min(2.6, w / 2 - 0.1), innerC = along ? (outDir === 'N' ? z0 + 1.6 : z1 - 1.6) : (outDir === 'W' ? x0 + 1.6 : x1 - 1.6);
    const sgn = outDir === 'N' || outDir === 'W' ? 1 : -1;
    for (const s of [pass0 + 0.06, pass1 - 0.18]) {
      if (along) geo.box(T.door, s, 0, Math.min(innerC, innerC + sgn * leafD), s + 0.12, spring - 0.2, Math.max(innerC, innerC + sgn * leafD), { tint: 0.85 });
      else geo.box(T.door, Math.min(innerC, innerC + sgn * leafD), 0, s, Math.max(innerC, innerC + sgn * leafD), spring - 0.2, s + 0.12, { tint: 0.85 });
    }
    // Machicolated top: corbels, parapet and merlons on all sides.
    for (const dir of ['N', 'S', 'W', 'E']) {
      const ff = makeFace(r, dir);
      for (let t = 0.3; t < ff.W - 0.2; t += 1.0) lbox(ff, T.trim, t - 0.16, t + 0.16, H - 0.9, H - 0.3, 0, 0.35, { gao: false, ao: 0.85, open: 'b' });
      lbox(ff, T.stoneDark, -0.35, ff.W + 0.35, H - 0.3, H + 0.9, -0.3, 0.35, { tint, gao: false, open: 'b' });
      merlons(ff, H + 0.9, 1.1, -0.3, 0.35, T.stoneDark, { tint }, 1.7, 0.9, -0.2, ff.W + 0.2);
    }
    setLod(LOD.FAR);
    mass(Aa, pass0, FOUND, H + 2, { ...lo, gao: false }); mass(pass1, Ab, FOUND, H + 2, { ...lo, gao: false }); mass(pass0, pass1, crown, H + 2, { ...lo, gao: false });
    setLod(LOD.DETAIL);
    kit.lantern(back, W / 2 + w / 2 + 1.0, 3.6);
    kit.lantern(back, W / 2 - w / 2 - 1.0, 3.6);
    setLod(LOD.BASE);
    geo.unlock();
    void depth; void name;
  }

  // ---------------------------------------------------------------- churches
  // Generic church: nave (optionally with lower aisles), façade toward `faceDir`, apse opposite,
  // portal(s), rose window or oculus, pilaster strips, cornice following the gable, sagrato steps.
  function church(r, faceDir, o) {
    const [x0, x1, z0, z1] = r;
    const mat = o.mat, tint = o.tint || 1, H = o.h, pitch = o.pitch || 0.36;
    const along = faceDir === 'E' || faceDir === 'W' ? 'x' : 'z';
    const f = makeFace(r, faceDir), W = f.W, c = W / 2;
    const S = { wallFor: () => mat, tintFor: () => tint, uvOff: [0.3, 0.7], H, trimTint: 0.95, canPot: () => false, noPots: true, fanlight: false, lantern: false };
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    geo.lock(cx, cz);
    setLod(LOD.BASE);
    const aisle = o.aisles ? Math.min(6, W * 0.28) : 0, Ha = H * 0.64;
    const skipFront = { N: 32, S: 16, W: 2, E: 1 }[faceDir];
    if (aisle) {
      // Central nave box + two lower aisles, all behind the façade slab.
      const inset = (rr) => { const q = rr.slice(); if (faceDir === 'N') q[2] += FAC; if (faceDir === 'S') q[3] -= FAC; if (faceDir === 'W') q[0] += FAC; if (faceDir === 'E') q[1] -= FAC; return q; };
      const nave = along === 'x' ? [x0, x1, cz - (W / 2 - aisle), cz + (W / 2 - aisle)] : [cx - (W / 2 - aisle), cx + (W / 2 - aisle), z0, z1];
      const a1 = along === 'x' ? [x0, x1, z0, nave[2]] : [x0, nave[0], z0, z1];
      const a2 = along === 'x' ? [x0, x1, nave[3], z1] : [nave[1], x1, z0, z1];
      const n = inset(nave), q1 = inset(a1), q2 = inset(a2);
      geo.box(mat, n[0], 0, n[2], n[1], H, n[3], { tint, top: H, skip: skipFront | 4 });
      geo.box(mat, q1[0], 0, q1[2], q1[1], Ha, q1[3], { tint, top: Ha, skip: skipFront | 4 });
      geo.box(mat, q2[0], 0, q2[2], q2[1], Ha, q2[3], { tint, top: Ha, skip: skipFront | 4 });
      roof(nave[0], nave[1], nave[2], nave[3], H, { pitch, wall: mat, tint }, 0.4, { axis: along, gable: true });
      // Lean-to aisle roofs.
      for (const [q, sgn] of [[a1, -1], [a2, 1]]) {
        const tile = T.roof.tile, lo = Ha + 0.1, hi = Ha + 1.6;
        if (along === 'x') {
          const zi = sgn < 0 ? q[3] : q[2], zo = sgn < 0 ? q[2] - 0.4 : q[3] + 0.4;
          geo.quad(T.roof, [q[0] - 0.3, hi, zi], [q[1] + 0.3, hi, zi], [q[1] + 0.3, lo, zo], [q[0] - 0.3, lo, zo], [0, 1, sgn], { gao: false }, (p) => [p[0] / tile, (p[2] - zo) * -sgn / tile]);
          geo.quad(T.wood, [q[0] - 0.3, lo - 0.1, zo], [q[1] + 0.3, lo - 0.1, zo], [q[1] + 0.3, Ha, zi], [q[0] - 0.3, Ha, zi], [0, -1, 0], { gao: false, ao: 0.7 });
        } else {
          const xi = sgn < 0 ? q[1] : q[0], xo = sgn < 0 ? q[0] - 0.4 : q[1] + 0.4;
          geo.quad(T.roof, [xi, hi, q[2] - 0.3], [xi, hi, q[3] + 0.3], [xo, lo, q[3] + 0.3], [xo, lo, q[2] - 0.3], [sgn, 1, 0], { gao: false }, (p) => [p[2] / tile, (p[0] - xo) * -sgn / tile]);
        }
      }
      setLod(LOD.FAR);
      geo.box(mat, nave[0], 0, nave[2], nave[1], H, nave[3], { tint, gao: false, skip: 4 });
      geo.box(mat, a1[0], 0, a1[2], a1[1], Ha + 1.2, a1[3], { tint, gao: false });
      geo.box(mat, a2[0], 0, a2[2], a2[1], Ha + 1.2, a2[3], { tint, gao: false });
      setLod(LOD.BASE);
    } else {
      const q = [x0, x1, z0, z1];
      if (faceDir === 'N') q[2] += FAC; if (faceDir === 'S') q[3] -= FAC; if (faceDir === 'W') q[0] += FAC; if (faceDir === 'E') q[1] -= FAC;
      geo.box(mat, q[0], 0, q[2], q[1], H, q[3], { tint, top: H, skip: skipFront | 4 });
      roof(x0, x1, z0, z1, H, { pitch, wall: mat, tint }, 0.4, { axis: along, gable: true, noFar: true });
      setLod(LOD.FAR); geo.box(mat, x0, 0, z0, x1, H, z1, { tint, gao: false, skip: 4 }); roof(x0, x1, z0, z1, H, { pitch, wall: mat, tint }, 0.4, { axis: along, gable: true, noFar: true }); setLod(LOD.BASE);
    }
    collide(x0, 0, z0, x1, H + 2, z1);
    // The body sits FAC behind the façade slab: close both ends of that gap on the side walls.
    if (faceDir === 'N' || faceDir === 'S') {
      const zz = faceDir === 'N' ? [z0, z0 + FAC] : [z1 - FAC, z1];
      geo.box(mat, x0, 0, zz[0], x0 + FAC, H, zz[1], { tint, top: H, skip: 63 & ~2 });
      geo.box(mat, x1 - FAC, 0, zz[0], x1, H, zz[1], { tint, top: H, skip: 63 & ~1 });
    } else {
      const xx = faceDir === 'W' ? [x0, x0 + FAC] : [x1 - FAC, x1];
      geo.box(mat, xx[0], 0, z0, xx[1], H, z0 + FAC, { tint, top: H, skip: 63 & ~32 });
      geo.box(mat, xx[0], 0, z1 - FAC, xx[1], H, z1, { tint, top: H, skip: 63 & ~16 });
    }

    // Façade: portals and a rose window / oculus in the gable field.
    const portal = { kind: 'door', t0: c - o.portalW / 2, t1: c + o.portalW / 2, y0: 0, y1: o.portalSpring, shape: o.pointed ? 'pointed' : 'round', ring: 0.5 };
    const ops = [portal];
    if (o.sideDoors) for (const s of [-1, 1]) { const t = c + s * (W / 2 - aisle / 2 - (aisle ? 0 : 3)); ops.push({ kind: 'door', t0: t - 0.7, t1: t + 0.7, y0: 0, y1: 2.6, shape: 'round', ring: 0.3 }); }
    const hTop = H + (W / 2) * Math.tan(pitch);
    const bands = [{ y0: 0, y1: H * 0.55, ops }, { y0: H * 0.55, y1: H, ops: [] }];
    kit.facadeWall(f, bands, S, 0, W);
    for (const op of ops) doorFill(f, op, { ...S, trimTint: o.marble ? 1.05 : 0.95 });
    // Marble bands (bichrome) or pilaster strips.
    if (o.bands) {
      for (let y = 0.9; y < H; y += 1.1) lbox(f, T.marble, 0, W, y, y + 0.45, 0, 0.02, { gao: false, tint: [0.35, 0.45, 0.4], open: 'b' });
    }
    for (const t of o.pilasters || [0.35, W - 0.35]) lbox(f, T.trim, t - 0.35, t + 0.35, 0, H, 0, 0.14, { tint: 0.95, open: 'b' });
    lbox(f, T.trim, 0, W, H - 0.35, H, 0, 0.3, { gao: false, open: 'b' });
    // Raking cornice along the gable (façade gable wall comes from roof()).
    const tp = Math.tan(pitch), n = 8;
    for (let k = 0; k < n; k++) {
      const ta = (W / 2) * (k / n), tb = (W / 2) * ((k + 1) / n);
      for (const [a, b] of [[ta, tb], [W - tb, W - ta]]) {
        const ya = H + Math.min(a, W - a) * tp, yb = H + Math.min(b, W - b) * tp;
        geo.quad(T.trim, kit.P3(f, a, ya - 0.3, 0.25), kit.P3(f, b, yb - 0.3, 0.25), kit.P3(f, b, yb + 0.05, 0.25), kit.P3(f, a, ya + 0.05, 0.25), [f.dx, 0, f.dz], { gao: false });
        geo.quad(T.trim, kit.P3(f, a, ya + 0.05, 0), kit.P3(f, b, yb + 0.05, 0), kit.P3(f, b, yb + 0.05, 0.25), kit.P3(f, a, ya + 0.05, 0.25), [0, 1, 0], { gao: false });
      }
    }
    // Screen gable across the whole façade (hides the lower aisle roofs, 'facciata a capanna').
    for (const lod of [LOD.BASE, LOD.FAR]) {
      setLod(lod);
      geo.tri(mat, kit.P3(f, 0, H - 0.01, 0.02), kit.P3(f, W, H - 0.01, 0.02), kit.P3(f, W / 2, H + (W / 2) * tp, 0.02), [f.dx, 0, f.dz], { tint, gao: false });
    }
    setLod(LOD.BASE);
    // Rose window: ring, tracery spokes, glass.
    const ry = Math.min(H + 1.2, hTop - o.rose - 1.0), rad = o.rose;
    if (rad > 0) {
      const g = new THREE.RingGeometry(rad * 0.78, rad, 24);
      g.translate(c, ry, 0.06);
      geo.geom(T.trim, g, kit.faceMatrix(f), { gao: false, tint: o.marble ? 1.08 : 1 }); g.dispose();
      const d = new THREE.CircleGeometry(rad * 0.78, 16); d.translate(c, ry, 0.02);
      geo.geom(T.glass, d, kit.faceMatrix(f), { gao: false }); d.dispose();
      setLod(LOD.DETAIL);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const p = (rr0) => kit.P3(f, c + Math.cos(a) * rr0, ry + Math.sin(a) * rr0, 0.05);
        const q = (rr0) => kit.P3(f, c + Math.cos(a + 0.05) * rr0, ry + Math.sin(a + 0.05) * rr0, 0.05);
        geo.quad(T.trim, p(0.2), p(rad * 0.8), q(rad * 0.8), q(0.2), [f.dx, 0, f.dz], { gao: false });
      }
      const hub = new THREE.CircleGeometry(0.25, 10); hub.translate(c, ry, 0.07);
      geo.geom(T.trim, hub, kit.faceMatrix(f), { gao: false }); hub.dispose();
      setLod(LOD.BASE);
    }
    setLod(LOD.FAR); front(f, T.glass, c - o.portalW / 2, c + o.portalW / 2, 0, o.portalSpring + o.portalW / 2, 0.02, { gao: false, tint: 0.6 }); setLod(LOD.BASE);

    // Side walls: tall narrow lancets high up and pilaster buttresses.
    for (const sd of along === 'x' ? ['N', 'S'] : ['W', 'E']) {
      const sf = makeFace(aisle ? (along === 'x' ? [x0, x1, sd === 'N' ? z0 : z1 - 0.01, sd === 'N' ? z0 + 0.01 : z1] : [sd === 'W' ? x0 : x1 - 0.01, sd === 'W' ? x0 + 0.01 : x1, z0, z1]) : r, sd);
      const hh = aisle ? Ha : H;
      for (let t = 2.5; t < sf.W - 2; t += 4.5) {
        lbox(sf, mat, t - 0.4, t + 0.4, 0, hh - 0.4, 0, 0.35, { tint, open: 'b' });
        const wt = t + 2.25;
        if (wt < sf.W - 1.5) {
          const curve = archCurve(wt - 0.38, wt + 0.38, hh - 2.4, o.pointed ? 'pointed' : 'round');
          front(sf, T.glass, wt - 0.38, wt + 0.38, hh - 5.0, hh - 2.4, 0.02, { gao: false, tint: 0.8 });
          archFill(sf, T.glass, curve, 0.02, { tint: 0.8 });
          archRing(sf, T.trim, curve, 0.16, 0, 0.06, { tint: 0.95 }, false);
          lbox(sf, T.trim, wt - 0.5, wt + 0.5, hh - 5.1, hh - 5.0, 0, 0.1, { gao: false, open: 'b' });
        }
      }
      if (aisle) { // clerestory oculi on the nave wall above the aisle roof
        const nf = makeFace(along === 'x' ? [x0, x1, sd === 'N' ? cz - (W / 2 - aisle) : cz + (W / 2 - aisle) - 0.01, sd === 'N' ? cz - (W / 2 - aisle) + 0.01 : cz + (W / 2 - aisle)] : [sd === 'W' ? cx - (W / 2 - aisle) : cx + (W / 2 - aisle) - 0.01, sd === 'W' ? cx - (W / 2 - aisle) + 0.01 : cx + (W / 2 - aisle), z0, z1], sd);
        for (let t = 4.75; t < nf.W - 2; t += 4.5) {
          const g = new THREE.RingGeometry(0.45, 0.62, 12); g.translate(t, H - 2, 0.03);
          geo.geom(T.trim, g, kit.faceMatrix(nf), { gao: false }); g.dispose();
          const d = new THREE.CircleGeometry(0.45, 10); d.translate(t, H - 2, 0.01);
          geo.geom(T.glass, d, kit.faceMatrix(nf), { gao: false }); d.dispose();
        }
      }
    }
    // Apse at the back: half-polygon with a conical roof.
    if (o.apse) {
      const bf = makeFace(r, { N: 'S', S: 'N', E: 'W', W: 'E' }[faceDir]);
      const ar = Math.min(o.apse, W / 2 - aisle - 0.5), ah = (aisle ? Ha : H) + 0.5, segs = 6;
      const cxA = fx(bf, bf.W / 2, 0), czA = fz(bf, bf.W / 2, 0);
      for (let k = 0; k < segs; k++) {
        const a0 = Math.PI * (k / segs), a1 = Math.PI * ((k + 1) / segs);
        const p = (a, y, rad) => [cxA + (-bf.tx * Math.cos(a) + bf.dx * Math.sin(a)) * rad, y, czA + (-bf.tz * Math.cos(a) + bf.dz * Math.sin(a)) * rad];
        const am = (a0 + a1) / 2, nrm = [-bf.tx * Math.cos(am) + bf.dx * Math.sin(am), 0, -bf.tz * Math.cos(am) + bf.dz * Math.sin(am)];
        geo.quad(mat, p(a0, 0, ar), p(a1, 0, ar), p(a1, 0.8, ar), p(a0, 0.8, ar), nrm, { tint, gao: true });
        geo.quad(mat, p(a0, 0.8, ar), p(a1, 0.8, ar), p(a1, ah, ar), p(a0, ah, ar), nrm, { tint, gao: true });
        geo.quad(T.trim, p(a0, ah, ar + 0.2), p(a1, ah, ar + 0.2), p(a1, ah + 0.3, ar + 0.2), p(a0, ah + 0.3, ar + 0.2), nrm, { gao: false });
        geo.tri(T.roof, p(a0, ah + 0.3, ar + 0.4), p(a1, ah + 0.3, ar + 0.4), p(am, ah + 0.3 + ar * 0.45, 0), [nrm[0], 1, nrm[2]], { gao: false });
        if (k === 1 || k === 4) {
          const wp = (a, y) => p(a, y, ar + 0.02), aa = am - 0.06, ab = am + 0.06;
          geo.quad(T.glass, wp(aa, ah - 4.5), wp(ab, ah - 4.5), wp(ab, ah - 1.6), wp(aa, ah - 1.6), nrm, { gao: false, tint: 0.8 });
        }
      }
      const ax = [cxA - ar, cxA + ar], az = [czA - ar, czA + ar];
      collide(Math.max(ax[0], Math.min(x0, x1) - ar), 0, az[0], ax[1], ah, az[1]);
    }
    // Sagrato steps.
    if (o.steps) {
      const n = o.steps, sw = W * 0.6;
      for (let k = 0; k < n; k++) {
        const d0 = 0, d1 = (n - k) * 0.55, h = 0.16 * (k + 1);
        lbox(f, T.trim, c - sw / 2 - (n - k) * 0.2, c + sw / 2 + (n - k) * 0.2, 0, h, d0, d1, { gao: false, tint: 0.97 });
        const xa = fx(f, c - sw / 2 - (n - k) * 0.2, d0), xb = fx(f, c + sw / 2 + (n - k) * 0.2, d1), za = fz(f, c - sw / 2 - (n - k) * 0.2, d0), zb = fz(f, c + sw / 2 + (n - k) * 0.2, d1);
        collide(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), h, Math.max(za, zb));
      }
    }
    B.contact(f, 0, W);
    geo.unlock();
    return { face: f, doorPos: [fx(f, c, 1.5), fz(f, c, 1.5)] };
  }

  function campanile(r, o) {
    const [x0, x1, z0, z1] = r, H = o.h, top = H + 5, mat = o.mat || T.brick, tint = o.tint || 1;
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    setLod(LOD.BASE);
    geo.box(mat, x0, 0, z0, x1, H, z1, { tint, uvOff: [0.4, 0.2] });
    collide(x0, 0, z0, x1, top + 4, z1);
    for (const y of [H * 0.35, H * 0.7]) geo.box(T.trim, x0 - 0.12, y, z0 - 0.12, x1 + 0.12, y + 0.25, z1 + 0.12, { gao: false });
    geo.box(T.trim, x0 - 0.2, H, z0 - 0.2, x1 + 0.2, H + 0.4, z1 + 0.2, { gao: false });
    const p = 1.0;
    for (const [px, pz] of [[x0, z0], [x1 - p, z0], [x0, z1 - p], [x1 - p, z1 - p]]) geo.box(mat, px, H + 0.4, pz, px + p, top, pz + p, { tint, gao: false });
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace(r, dir);
      const curve = archCurve(p, f.W - p, top - 0.5 - (f.W - 2 * p) / 2, 'round');
      spandrel(f, mat, curve, top, 0, { tint }); spandrel(f, mat, curve, top, -0.6, { tint }, -1);
      intrados(f, mat, curve, -0.6, 0, { tint, ao: 0.8 });
      archRing(f, T.trim, curve, 0.22, -0.01, 0.05, {}, false);
      // Blind arcading (archetti pensili) under the belfry.
      for (let t = 0.3; t < f.W - 0.5; t += 0.75) archRing(f, T.trim, archCurve(t, t + 0.55, H - 0.9, 'round', 4), 0.08, 0, 0.06, {}, false);
      setLod(LOD.DETAIL);
      front(f, T.glass, f.W / 2 - 0.12, f.W / 2 + 0.12, H * 0.5, H * 0.5 + 1.6, 0.01, { gao: false, tint: 0.35 });
      setLod(LOD.BASE);
    }
    geo.box(mat, x0, top, z0, x1, top + 0.5, z1, { tint, gao: false });
    geo.box(T.trim, x0 - 0.25, top + 0.5, z0 - 0.25, x1 + 0.25, top + 0.75, z1 + 0.25, { gao: false });
    if (o.spire) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      geo.proto(T.brick, TPL.cone8, cx, top + 0.75, cz, (x1 - x0) * 0.45, o.spire, (z1 - z0) * 0.45, Math.PI / 8, { gao: false, tint });
    } else pyramid(x0, x1, z0, z1, top + 0.75, 3.8, 0.35);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    geo.proto(T.metal, TPL.cone8, cx, top - 3.2, cz, 0.6, 1.1, 0.6, 0, { gao: false, tint: [0.75, 0.6, 0.4] });
    geo.box(T.wood, x0 + 0.3, top - 2.0, cz - 0.1, x1 - 0.3, top - 1.8, cz + 0.1, { gao: false });
    setLod(LOD.FAR);
    geo.box(mat, x0, 0, z0, x1, top + 0.75, z1, { tint, gao: false });
    pyramid(x0, x1, z0, z1, top + 0.75, 3.8, 0.35);
    setLod(LOD.BASE);
    geo.unlock();
  }

  // ---------------------------------------------------------------- the collegiata (duomo)
  function collegiata() {
    const r = MON.collegiata;
    const res = church(r, 'E', { mat: T.stone, tint: [1.02, 0.98, 0.9], h: 17, aisles: true, portalW: 2.6, portalSpring: 1.4 + 3.4, sideDoors: true, rose: 0, apse: 6, pilasters: [0.35, 6.0, 16.0, 21.65], pitch: 0.34 });
    // Oculus in the gable and a broad stair up to the raised sagrato (7 steps × 0.2 m).
    const f = res.face;
    const g = new THREE.RingGeometry(1.0, 1.35, 20); g.translate(f.W / 2, 13.2, 0.05);
    geo.geom(T.trim, g, kit.faceMatrix(f), { gao: false }); g.dispose();
    const d = new THREE.CircleGeometry(1.0, 16); d.translate(f.W / 2, 13.2, 0.01);
    geo.geom(T.glass, d, kit.faceMatrix(f), { gao: false }); d.dispose();
    const [, , z0, z1] = r, xf = r[1];
    geo.lock(xf + 4, (z0 + z1) / 2);
    const platX = xf + 3.5, nSteps = 7, rise = 0.2, tread = 0.6;
    geo.box(T.paving, xf, 0, z0 - 1, platX, nSteps * rise, z1 + 1, { gao: false, tint: 0.95 });
    collide(xf, 0, z0 - 1, platX, nSteps * rise, z1 + 1);
    for (let k = 0; k < nSteps; k++) {
      const h = (nSteps - k) * rise, xa = platX + k * tread, xb = xa + tread;
      geo.box(T.marble, xa, h - rise, z0 - 1, xb, h, z1 + 1, { gao: false, tint: [0.95, 0.93, 0.88], skip: 8 });
      geo.box(T.trim, platX, 0, z0 - 1, xb, h - rise, z1 + 1, { gao: false, skip: 8 | 4 | 16 | 32 });
      collide(xa, 0, z0 - 1, xb, h, z1 + 1);
    }
    // Side walls of the stair.
    for (const z of [z0 - 1.4, z1 + 1]) {
      geo.box(T.trim, xf, 0, z, platX + nSteps * tread, 0.6, z + 0.4, { tint: 0.95 });
      geo.box(T.trim, xf, 0.6, z, platX + 0.2, nSteps * rise + 0.9, z + 0.4, { tint: 0.95 });
    }
    B.contact(makeFace([xf, platX + nSteps * tread, z0 - 1.4, z1 + 1.4], 'E'), 0, z1 - z0 + 2.8);
    geo.unlock();
    campanile(MON.campColl, { h: 27, mat: T.stone, tint: [1, 0.97, 0.9] });
    return { base: new THREE.Vector3(xf + 1.2, nSteps * rise, (z0 + z1) / 2) };
  }

  // ---------------------------------------------------------------- civic palazzi
  function palazzo(r, force, opt = {}) {
    const info = B.faceInfo(r);
    const S = B.makeStyle({ x0: r[0], x1: r[1], z0: r[2], z1: r[3] }, info, force);
    B.building(r, S, info, opt);
    return S;
  }
  function loggia(r, openDir) {
    // Open arcade (ground) with a lean-to roof, like the Loggia del Comune.
    const [x0, x1, z0, z1] = r, f = makeFace(r, openDir), cols = Math.max(3, Math.round(f.W / 4) + 1);
    const spring = 3.2, colTop = 2.9, top = 5.0;
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    const step = (f.W - 0.6) / (cols - 1), ts = [];
    for (let k = 0; k < cols; k++) ts.push(0.3 + k * step);
    for (const t of ts) {
      const x = fx(f, t, -0.3), z = fz(f, t, -0.3);
      geo.box(T.trim, x - 0.32, 0, z - 0.32, x + 0.32, 0.35, z + 0.32, {});
      geo.proto(T.trim, TPL.cyl12, x, 0.35, z, 0.22, colTop - 0.35, 0.22, 0, { gao: true });
      geo.box(T.trim, x - 0.34, colTop, z - 0.34, x + 0.34, spring, z + 0.34, { gao: false });
      collide(x - 0.3, 0, z - 0.3, x + 0.3, spring, z + 0.3);
    }
    for (let k = 0; k < cols - 1; k++) {
      const c = archCurve(ts[k] + 0.34, ts[k + 1] - 0.34, spring, 'round');
      spandrel(f, T.stone, c, top, 0, { tint: 1.0 }); spandrel(f, T.stone, c, top, -0.6, { tint: 1.0 }, -1);
      intrados(f, T.stone, c, -0.6, 0, { ao: 0.8 });
      archRing(f, T.trim, c, 0.26, -0.01, 0.05, {}, true);
    }
    lbox(f, T.stone, 0, 0.3 - 0.34, 0, top, -0.6, 0, {});
    lbox(f, T.trim, 0, f.W, top - 0.3, top, 0, 0.14, { gao: false, open: 'b' });
    // Ceiling beams and lean-to roof toward the palazzo behind.
    const back = makeFace(r, { N: 'S', S: 'N', E: 'W', W: 'E' }[openDir]);
    const yb = top + 1.6;
    geo.quad(T.wood, kit.P3(f, 0, top - 0.02, 0), kit.P3(f, f.W, top - 0.02, 0), kit.P3(back, 0, top - 0.02, 0), kit.P3(back, back.W, top - 0.02, 0), [0, -1, 0], { gao: false, ao: 0.75 });
    const tile = T.roof.tile, D = openDir === 'N' || openDir === 'S' ? z1 - z0 : x1 - x0;
    geo.quad(T.roof, kit.P3(f, -0.2, top, 0.4), kit.P3(f, f.W + 0.2, top, 0.4), kit.P3(f, f.W + 0.2, yb, -D), kit.P3(f, -0.2, yb, -D), [f.dx, 1, f.dz], { gao: false }, (p) => [(p[0] + p[2]) / tile, p[1] / tile * 2]);
    collide(x0, spring, z0, x1, yb, z1);
    geo.unlock();
  }

  // ---------------------------------------------------------------- convent and cloister
  function cloister(court) {
    const [x0, x1, z0, z1] = court, D = 3.2, spring = 2.8, top = 4.4;
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    // Four arcades facing the garth; walkways behind them are part of the walkable court.
    const inner = [x0 + D, x1 - D, z0 + D, z1 - D];
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace(inner, dir), n = Math.round(f.W / 2.6), step = f.W / n;
      for (let k = 0; k <= n; k++) {
        const t = k * step, x = fx(f, t, 0.2), z = fz(f, t, 0.2);
        geo.proto(T.marble, TPL.cyl8, x, 0.45, z, 0.13, spring - 0.6, 0.13, 0, { gao: true });
        geo.box(T.trim, x - 0.22, spring - 0.15, z - 0.22, x + 0.22, spring, z + 0.22, { gao: false });
        collide(x - 0.15, 0, z - 0.15, x + 0.15, spring, z + 0.15);
      }
      lbox(f, T.trim, -0.2, f.W + 0.2, 0, 0.45, 0.05, 0.4, { tint: 0.95 }); // low parapet wall of the garth
      for (let k = 0; k < n; k++) {
        const c = archCurve(k * step + 0.2, (k + 1) * step - 0.2, spring, 'round');
        spandrel(f, T.plaster, c, top, 0.4, { tint: [1.02, 0.97, 0.88] });
        intrados(f, T.plaster, c, 0.0, 0.4, { tint: [1.02, 0.97, 0.88], ao: 0.8 });
        archRing(f, T.trim, c, 0.14, 0.38, 0.42, {}, false);
      }
      lbox(f, T.trim, -0.2, f.W + 0.2, top - 0.2, top, 0, 0.55, { gao: false });
      // Lean-to roof over the walk.
      const tile = T.roof.tile;
      geo.quad(T.roof, kit.P3(f, -D - 0.3, top + 1.4, -D), kit.P3(f, f.W + D + 0.3, top + 1.4, -D), kit.P3(f, f.W + D + 0.3, top, 0.7), kit.P3(f, -D - 0.3, top, 0.7), [f.dx, 1, f.dz], { gao: false }, (p) => [(p[0] * Math.abs(f.tx) + p[2] * Math.abs(f.tz)) / tile, p[1] / tile * 2.5]);
      geo.quad(T.wood, kit.P3(f, -D, top - 0.01, -D), kit.P3(f, f.W + D, top - 0.01, -D), kit.P3(f, f.W + D, top - 0.01, 0.4), kit.P3(f, -D, top - 0.01, 0.4), [0, -1, 0], { gao: false, ao: 0.7 });
      // Parapet collider (walkable gaps at the middle of each side).
      const half = f.W / 2;
      for (const [a, b] of [[-0.2, half - 0.9], [half + 0.9, f.W + 0.2]]) {
        const xa = fx(f, a, 0.05), xb = fx(f, b, 0.4), za = fz(f, a, 0.05), zb = fz(f, b, 0.4);
        collide(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), 0.45, Math.max(za, zb));
      }
    }
    // Well-head in the centre of the garth.
    ctx.well((x0 + x1) / 2, (z0 + z1) / 2);
    geo.unlock();
  }

  // ---------------------------------------------------------------- rocca
  function rocca() {
    const [rx0, rx1, rz0, rz1] = MON.rocca, gx0 = -114, gx1 = -76, gz0 = 100, gz1 = 144;
    const tint = mulTint(wallTint, 0.97), H = 8;
    const ruinTop = (a0, a1, dir, c0, c1) => {
      // Irregular broken crest along a wall.
      for (let a = a0; a < a1 - 0.01; a += 1.6) {
        const b = Math.min(a1, a + 1.6), h = H + rr(-1.8, 1.4);
        if (dir === 'x') { geo.box(T.stoneDark, a, H - 2, c0, b, h, c1, { tint, gao: false, uvOff: [a * 0.2, 0] }); }
        else geo.box(T.stoneDark, c0, H - 2, a, c1, h, b, { tint, gao: false, uvOff: [a * 0.2, 0] });
      }
    };
    geo.lock(-100, 98);
    // North wall with the entrance gap, east wall, thickened west and south walls.
    for (const [a, b] of [[rx0 + 2.4, -98], [-94, rx1]]) { geo.box(T.stoneDark, a, 0, rz0, b, H - 2, gz0, { tint }); ruinTop(a, b, 'x', rz0, gz0); collide(a, 0, rz0, b, H, gz0); }
    geo.unlock(); geo.lock(-73, 120);
    geo.box(T.stoneDark, gx1, FOUND + 28, gz0, rx1, H - 2, rz1 - 2.4, { tint }); ruinTop(gz0, rz1 - 2.4, 'z', gx1, rx1); collide(gx1, 0, gz0, rx1, H, rz1 - 2.4);
    geo.unlock(); geo.lock(-115, 120);
    geo.box(T.stoneDark, rx0 + 2.4, 0, gz0, gx0, H - 2, rz1 - 2.4, { tint }); collide(rx0 + 2.4, 0, gz0, gx0, H, rz1 - 2.4);
    geo.box(T.stoneDark, gx0, 0, gz1, gx1, H - 2, rz1 - 2.4, { tint }); collide(gx0, 0, gz1, gx1, H, rz1 - 2.4);
    geo.unlock();
    // Entrance arch over the gap.
    const ef = makeFace([-98, -94, rz0, gz0], 'N');
    const ec = archCurve(0, 4, 3.4, 'round');
    spandrel(ef, T.stoneDark, ec, H - 1, 0, { tint }); archRing(ef, T.trim, ec, 0.4, -0.01, 0.1, {});
    geo.box(T.stoneDark, -98, 5.4, rz0, -94, H - 1, gz0, { tint, skip: 16 | 32 }); collide(-98, 5.4, rz0, -94, H, gz0);
    // The torrione (climbable viewpoint) in the north-east corner.
    const tr = [-82, -72, 96, 106], th = 21;
    const t = { id: 'rocca', r: tr, h: th, top: 'parapet', dark: true, door: 'W' };
    B.buildTower(t);
    viewpoints.push({ id: 'rocca', name: 'ロッカの見張り塔', base: new THREE.Vector3(-83.2, 0, 101), top: new THREE.Vector3(-77, th, 101), yaw: Math.PI * 0.75, tower: t });
    parapetColliders(tr, th);
    return { garden: [gx0, gx1, gz0, gz1] };
  }

  function parapetColliders(r, H) {
    const [x0, x1, z0, z1] = r, h = H + 1.3;
    collide(x0 - 0.2, H, z0 - 0.2, x1 + 0.2, h, z0 + 0.3); collide(x0 - 0.2, H, z1 - 0.3, x1 + 0.2, h, z1 + 0.2);
    collide(x0 - 0.2, H, z0, x0 + 0.3, h, z1); collide(x1 - 0.3, H, z0, x1 + 0.2, h, z1);
  }

  // ---------------------------------------------------------------- passages and alley arches
  function passage([x0, x1, z0, z1, axis, H]) {
    const L = B.makeStyle({ x0, x1, z0, z1 }, B.faceInfo([x0, x1, z0, z1]), { type: 'casa', storeys: 2 });
    L.H = H;
    const ends = axis === 'z' ? ['N', 'S'] : ['W', 'E'];
    const span = axis === 'z' ? x1 - x0 : z1 - z0;
    const spring = 2.5, crown = spring + span / 2, dep = 0.45, o = { tint: L.tint, uvOff: L.uvOff };
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    setLod(LOD.BASE);
    for (const dir of ends) {
      const f = makeFace([x0, x1, z0, z1], dir);
      const c = archCurve(0, f.W, spring, 'round');
      spandrel(f, L.wall, c, H, 0, o);
      front(f, L.wall, 0, f.W, crown, H, 0, o);
      archRing(f, T.trim, c, 0.3, -0.01, 0.05, {}, true);
      if (H - crown > 2.8) {
        const tc = f.W / 2;
        kit.windowFill(f, { kind: 'win', t0: tc - 0.4, t1: tc + 0.4, y0: crown + 1.0, y1: crown + 2.2, shape: 'rect' }, { ...L, shutters: true });
      }
      lbox(f, T.trim, 0, f.W, H - 0.35, H - 0.1, 0, 0.3, { gao: false, open: 'b' });
    }
    if (axis === 'z') geo.box(L.wall, x0, crown, z0 + 0.01, x1, H, z1 - 0.01, { ...o, skip: 3 | 16 | 32 });
    else geo.box(L.wall, x0 + 0.01, crown, z0, x1 - 0.01, H, z1, { ...o, skip: 48 | 1 | 2 });
    const segs = 10, a0 = axis === 'z' ? z0 : x0, a1 = axis === 'z' ? z1 : x1, c = axis === 'z' ? (x0 + x1) / 2 : (z0 + z1) / 2, r = span / 2;
    for (let k = 0; k < segs; k++) {
      const t0 = (Math.PI * k) / segs, t1 = (Math.PI * (k + 1)) / segs, tm = (t0 + t1) / 2;
      const p = (t, a) => (axis === 'z' ? [c + r * Math.cos(t), spring + r * Math.sin(t), a] : [a, spring + r * Math.sin(t), c + r * Math.cos(t)]);
      const n = axis === 'z' ? [-Math.cos(tm), -Math.sin(tm), 0] : [0, -Math.sin(tm), -Math.cos(tm)];
      geo.quad(T.stone, p(t0, a0), p(t0, a1), p(t1, a1), p(t1, a0), n, { gao: false, ao: 0.55 });
    }
    // Side walls below the springing line fill the gap to the neighbours.
    collide(x0, spring, z0, x1, H, z1);
    roof(x0, x1, z0, z1, H, { pitch: 0.33, wall: L.wall, tint: L.tint, uvOff: L.uvOff }, 0.3);
    setLod(LOD.FAR); geo.box(L.wall, x0, crown, z0, x1, H, z1, { ...o, gao: false });
    setLod(LOD.BASE);
    geo.unlock();
  }
  function alleyArch([x, z, along, h], width) {
    // A stone arch spanning a narrow alley between two façades (0.6 m deep).
    const w = width, d = 0.6;
    const r = along === 'z' ? [x - w / 2, x + w / 2, z - d / 2, z + d / 2] : [x - d / 2, x + d / 2, z - w / 2, z + w / 2];
    geo.lock(x, z);
    setLod(LOD.BASE);
    for (const dir of along === 'z' ? ['N', 'S'] : ['W', 'E']) {
      const f = makeFace(r, dir);
      const c = archCurve(0, f.W, h, 'seg');
      spandrel(f, T.stone, c, h + w / 5 + 0.7, 0, { tint: 0.95 });
      if (dir === 'N' || dir === 'W') intrados(f, T.stone, c, -d, 0, { ao: 0.8 });
    }
    geo.box(T.trim, r[0], h + w / 5 + 0.7, r[2], r[1], h + w / 5 + 0.85, r[3], { gao: false });
    collide(r[0], h - 0.1, r[2], r[1], h + w / 5 + 0.85, r[3]);
    geo.unlock();
  }

  return { walls, gate, church, campanile, collegiata, palazzo, loggia, cloister, rocca, passage, alleyArch, parapetColliders, viewpoints, PASSAGES, ALLEY_ARCHES, side, hor };
}
