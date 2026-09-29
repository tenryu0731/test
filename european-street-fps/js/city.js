// San Gimignano (artistic impression): piazza with fountain and loggia, main street to the
// southern gate, a small cathedral square to the north with campanile, streets to the east and
// west gates, a ring of narrow alleys with vaulted passages, and the town's stone tower houses.
import * as THREE from 'three';
import { Geo, mulberry32 } from './city-geo.js';

const HALF = 56;            // solid town area is [-HALF, HALF]^2
const CELL = 0.5;
const GN = (HALF * 2) / CELL;
const FAC = 0.3;            // façade slab thickness (window reveal depth)

// Walkable rectangles [x0, x1, z0, z1].
const WALK = [
  [-13, 13, -11, 11],       // Piazza della Cisterna-like main square
  [-3, 3, 11, 47],          // main street south → Porta San Giovanni-like gate
  [-3.5, 3.5, -30, -11],    // street north
  [-10, 10, -44, -30],      // cathedral square
  [-47, -13, -3, 3],        // west street
  [13, 47, -2.5, 2.5],      // east street
  [-24.5, -22, -26, 26.5],  // alley A (west ring)
  [21, 23.5, -26, 26.5],    // alley B (east ring)
  [-24.5, 23.5, 24, 26.5],  // alley C (south ring)
  [-24.5, 23.5, -26, -23.5],// alley D (north ring)
];

// Hand-placed landmark footprints (kept out of the generic building lots).
const TOWERS = [
  { r: [3.5, 9.5, -18, -11], h: 44, top: 'parapet' },
  { r: [3, 9, 11, 17], h: 38, top: 'roof' },
  { r: [-9, -3, 18, 24], h: 33, top: 'parapet' },
  { r: [-16, -10, -38, -32], h: 41, top: 'parapet' },
  { r: [10, 16, -38, -30], h: 42, top: 'roof' },
  { r: [-44, -38, -20, -14], h: 36, top: 'parapet' },
  { r: [36, 42, 12, 18], h: 39, top: 'roof' },
  { r: [30, 35, -40, -35], h: 30, top: 'parapet' },
];
const CHURCH = [-10, 10, -56, -44];
const CAMPANILE = [10, 16, -44, -38];
const GATES = [
  { r: [-6, 6, 47, 56], face: 'N' },
  { r: [-56, -47, -6, 6], face: 'E' },
  { r: [47, 56, -6, 6], face: 'W' },
];
const PASSAGES = [
  { r: [-24.5, -22, 8, 12], axis: 'z', h: 7.6 },
  { r: [21, 23.5, -14, -10], axis: 'z', h: 7.2 },
  { r: [-15, -11, 24, 26.5], axis: 'x', h: 7.4 },
];

export function buildCity(scene, M) {
  const t0 = performance.now();
  const R = mulberry32(20240917);
  const rr = (a, b) => a + (b - a) * R();
  const geo = new Geo();
  const colliders = [];
  const collide = (x0, y0, z0, x1, y1, z1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  const trim = M.stoneTrim || M.stone;
  const decals = []; // ground contact-shadow strips: [x0,z0,x1,z1, dir]

  // ------------------------------------------------------------------ occupancy grid
  const grid = new Uint8Array(GN * GN); // 0 solid, 1 walkable, 2 reserved
  const cellOf = (v) => Math.floor((v + HALF) / CELL);
  const mark = (r, val) => {
    for (let iz = Math.max(0, cellOf(r[2] + 1e-3)); iz <= Math.min(GN - 1, cellOf(r[3] - 1e-3)); iz++)
      for (let ix = Math.max(0, cellOf(r[0] + 1e-3)); ix <= Math.min(GN - 1, cellOf(r[1] - 1e-3)); ix++) grid[iz * GN + ix] = val;
  };
  WALK.forEach((r) => mark(r, 1));
  [...TOWERS.map((t) => t.r), CHURCH, CAMPANILE, ...GATES.map((g) => g.r)].forEach((r) => mark(r, 2));
  const isWalk = (x, z) => {
    const ix = cellOf(x), iz = cellOf(z);
    if (ix < 0 || iz < 0 || ix >= GN || iz >= GN) return false;
    return grid[iz * GN + ix] === 1;
  };

  // Greedy rectangle decomposition of the remaining solid cells into blocks.
  const used = new Uint8Array(GN * GN);
  const blocks = [];
  for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) {
    const i = iz * GN + ix;
    if (grid[i] !== 0 || used[i]) continue;
    let w = 0;
    while (ix + w < GN && grid[iz * GN + ix + w] === 0 && !used[iz * GN + ix + w]) w++;
    let h = 1;
    grow: while (iz + h < GN) {
      for (let k = 0; k < w; k++) { const j = (iz + h) * GN + ix + k; if (grid[j] !== 0 || used[j]) break grow; }
      h++;
    }
    for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) used[(iz + a) * GN + ix + k] = 1;
    blocks.push([-HALF + ix * CELL, -HALF + (ix + w) * CELL, -HALF + iz * CELL, -HALF + (iz + h) * CELL]);
  }

  // Split blocks into building lots.
  const lots = [];
  for (const [x0, x1, z0, z1] of blocks) {
    const w = x1 - x0, d = z1 - z0;
    const parts = [];
    if (Math.min(w, d) > 15) {
      const f = rr(0.42, 0.58);
      if (w < d) { const xm = snap(x0 + w * f); parts.push([x0, xm, z0, z1], [xm, x1, z0, z1]); }
      else { const zm = snap(z0 + d * f); parts.push([x0, x1, z0, zm], [x0, x1, zm, z1]); }
    } else parts.push([x0, x1, z0, z1]);
    for (const [a0, a1, b0, b1] of parts) {
      const alongX = a1 - a0 >= b1 - b0;
      const L = alongX ? a1 - a0 : b1 - b0;
      let s = alongX ? a0 : b0;
      const end = s + L;
      while (s < end - 0.01) {
        let len = snap(rr(5, 9));
        if (end - (s + len) < 4) len = end - s;
        const e = s + len;
        lots.push(alongX ? { x0: s, x1: e, z0: b0, z1: b1 } : { x0: a0, x1: a1, z0: s, z1: e });
        s = e;
      }
    }
  }

  // ------------------------------------------------------------------ helpers
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function makeFace(r, dir) {
    const [x0, x1, z0, z1] = r;
    switch (dir) {
      case 'N': return { dir, W: x1 - x0, ox: x1, oz: z0, tx: -1, tz: 0, dx: 0, dz: -1 };
      case 'S': return { dir, W: x1 - x0, ox: x0, oz: z1, tx: 1, tz: 0, dx: 0, dz: 1 };
      case 'W': return { dir, W: z1 - z0, ox: x0, oz: z0, tx: 0, tz: 1, dx: -1, dz: 0 };
      default: return { dir, W: z1 - z0, ox: x1, oz: z1, tx: 0, tz: -1, dx: 1, dz: 0 };
    }
  }
  const fx = (f, t, d) => f.ox + f.tx * t + f.dx * d;
  const fz = (f, t, d) => f.oz + f.tz * t + f.dz * d;
  function lbox(f, mat, t0, t1, y0, y1, d0, d1, o) {
    const xa = fx(f, t0, d0), xb = fx(f, t1, d1), za = fz(f, t0, d0), zb = fz(f, t1, d1);
    geo.box(mat, Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), o);
  }
  const faceMatrix = (f) => new THREE.Matrix4().makeBasis(V3(f.tx, 0, f.tz), V3(0, 1, 0), V3(f.dx, 0, f.dz)).setPosition(f.ox, 0, f.oz);
  const walkOut = (f, t, d = 0.6) => isWalk(fx(f, t, d), fz(f, t, d));

  // Extruded 2D shape in face coordinates (t, y), from d = d0 to d1.
  function lshape(f, mat, shape, d0, d1, o) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: d1 - d0, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, d0);
    geo.geom(mat, g, faceMatrix(f), o);
    g.dispose();
  }
  // Arches are generated directly (no triangulation): only faces that can be seen are emitted.
  const P3 = (f, t, y, d) => [fx(f, t, d), y, fz(f, t, d)];
  const arcSegs = (r) => Math.min(16, Math.max(8, Math.round(6 + r * 6)));
  // Wall above a semicircular opening: from the arc up to `top`, front face at d1 (back optional).
  function spandrel(f, mat, t0, t1, spring, top, d0, d1, o, back = false) {
    const r0 = (t1 - t0) / 2, r = r0 + 0.005, tc = (t0 + t1) / 2, n = arcSegs(r0);
    const out = [f.dx, 0, f.dz], inn = [-f.dx, 0, -f.dz];
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * (1 - k / n), a1 = Math.PI * (1 - (k + 1) / n);
      const ta = tc + r * Math.cos(a0), ya = spring + r * Math.sin(a0), tb = tc + r * Math.cos(a1), yb = spring + r * Math.sin(a1);
      geo.quad(mat, P3(f, ta, ya, d1), P3(f, tb, yb, d1), P3(f, tb, top, d1), P3(f, ta, top, d1), out, o);
      if (back) geo.quad(mat, P3(f, ta, ya, d0), P3(f, tb, yb, d0), P3(f, tb, top, d0), P3(f, ta, top, d0), inn, o);
    }
  }
  // Dressed-stone arch ring (archivolt) with keystone; intrados spans the whole reveal depth.
  function archRing(f, t0, t1, spring, d0, d1, width = 0.3, o = {}, back = false) {
    const r = (t1 - t0) / 2, R = r + width, tc = (t0 + t1) / 2, n = arcSegs(r);
    const oo = { gao: false, ...o }, out = [f.dx, 0, f.dz], dv = Math.max(d0, -0.02);
    for (let k = 0; k < n; k++) {
      const a0 = Math.PI * (1 - k / n), a1 = Math.PI * (1 - (k + 1) / n), am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), cm = Math.cos(am), sm = Math.sin(am);
      const i0 = [tc + r * c0, spring + r * s0], i1 = [tc + r * c1, spring + r * s1];
      const e0 = [tc + R * c0, spring + R * s0], e1 = [tc + R * c1, spring + R * s1];
      geo.quad(trim, P3(f, i0[0], i0[1], d1), P3(f, i1[0], i1[1], d1), P3(f, e1[0], e1[1], d1), P3(f, e0[0], e0[1], d1), out, oo);
      if (back) geo.quad(trim, P3(f, i0[0], i0[1], d0), P3(f, i1[0], i1[1], d0), P3(f, e1[0], e1[1], d0), P3(f, e0[0], e0[1], d0), [-f.dx, 0, -f.dz], oo);
      geo.quad(trim, P3(f, i0[0], i0[1], d0), P3(f, i1[0], i1[1], d0), P3(f, i1[0], i1[1], d1), P3(f, i0[0], i0[1], d1), [-cm * f.tx, -sm, -cm * f.tz], oo);
      geo.quad(trim, P3(f, e0[0], e0[1], dv), P3(f, e1[0], e1[1], dv), P3(f, e1[0], e1[1], d1), P3(f, e0[0], e0[1], d1), [cm * f.tx, sm, cm * f.tz], oo);
    }
    for (const sgn of [-1, 1]) geo.quad(trim, P3(f, tc + sgn * r, spring, dv), P3(f, tc + sgn * R, spring, dv), P3(f, tc + sgn * R, spring, d1), P3(f, tc + sgn * r, spring, d1), [0, -1, 0], oo);
    lbox(f, trim, tc - 0.13, tc + 0.13, spring + r - 0.02, spring + R + 0.06, dv, d1 + 0.03, oo); // keystone
  }
  function halfDisc(f, mat, tc, spring, r, d, o) {
    const g = new THREE.CircleGeometry(r, 10, 0, Math.PI);
    g.translate(tc, spring, d);
    geo.geom(mat, g, faceMatrix(f), { ...o, gao: false });
    g.dispose();
  }
  // Half tube (ridge caps, gutters) between two points; the round side faces `upHint`.
  function halfTube(mat, a, b, r, o = {}, segs = 6) {
    const A = V3(...a), Bv = V3(...b), axis = Bv.clone().sub(A).normalize();
    const side = new THREE.Vector3().crossVectors(axis, V3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, axis).normalize();
    if (up.y < 0) up.negate();
    for (let k = 0; k < segs; k++) {
      const a0 = (Math.PI * k) / segs, a1 = (Math.PI * (k + 1)) / segs;
      const o0 = side.clone().multiplyScalar(Math.cos(a0) * r).addScaledVector(up, Math.sin(a0) * r);
      const o1 = side.clone().multiplyScalar(Math.cos(a1) * r).addScaledVector(up, Math.sin(a1) * r);
      const mid = o0.clone().add(o1).normalize();
      geo.quad(mat, A.clone().add(o0).toArray(), Bv.clone().add(o0).toArray(), Bv.clone().add(o1).toArray(), A.clone().add(o1).toArray(), mid.toArray(), { ...o, gao: false });
    }
  }
  const cyl = (mat, x, y0, z, r, h, segs = 8, o = {}) => {
    const g = new THREE.CylinderGeometry(r, r, h, segs);
    g.translate(x, y0 + h / 2, z);
    geo.geom(mat, g, null, { flat: segs < 10, ...o });
    g.dispose();
  };
  const blob = (mat, x, y, z, r, sy = 0.8, o = {}) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    geo.geom(mat, g, null, { flat: true, gao: false, ...o });
    g.dispose();
  };

  // ------------------------------------------------------------------ openings
  function windowFill(f, op, L) {
    const { t0, t1, y0, y1 } = op, w = t1 - t0, fr = M.door, gd = -FAC + 0.04;
    const top = op.arch ? y1 + w / 2 : y1;
    // Glass pane and frame set back in the reveal.
    lbox(f, M.glass, t0, t1, y0, y1, gd - 0.01, gd + 0.01, { gao: false });
    if (op.arch) halfDisc(f, M.glass, (t0 + t1) / 2, y1, w / 2, gd + 0.01, {});
    const fw = 0.055, fd0 = gd, fd1 = gd + 0.07;
    lbox(f, fr, t0, t0 + fw, y0, y1, fd0, fd1, { gao: false });
    lbox(f, fr, t1 - fw, t1, y0, y1, fd0, fd1, { gao: false });
    lbox(f, fr, t0, t1, y0, y0 + fw, fd0, fd1, { gao: false });
    lbox(f, fr, t0, t1, y1 - fw, y1, fd0, fd1, { gao: false });
    lbox(f, fr, (t0 + t1) / 2 - 0.025, (t0 + t1) / 2 + 0.025, y0, y1, fd0, fd1, { gao: false });
    if (op.kind === 'balc') lbox(f, fr, t0, t1, y0, y0 + 0.9, fd0 - 0.01, fd1 - 0.02, { gao: false });
    else lbox(f, fr, t0, t1, y0 + (y1 - y0) * 0.68, y0 + (y1 - y0) * 0.68 + 0.05, fd0, fd1, { gao: false });

    // Sill.
    if (op.kind !== 'balc') lbox(f, trim, t0 - 0.09, t1 + 0.09, y0 - 0.08, y0 + 0.015, -FAC + 0.02, 0.07, { tint: L.tint, gao: false });
    // Stone surround.
    if (L.framed && !op.arch) {
      lbox(f, trim, t0 - 0.13, t0, y0, y1, 0, 0.035, { gao: false });
      lbox(f, trim, t1, t1 + 0.13, y0, y1, 0, 0.035, { gao: false });
      lbox(f, trim, t0 - 0.16, t1 + 0.16, y1, y1 + 0.17, 0, 0.05, { gao: false });
    }
    if (op.arch) archRing(f, t0, t1, y1, -FAC, 0.04, 0.2, {});

    // Grille on ground-floor windows.
    if (op.kind === 'gwin') {
      for (let k = 1; k < 5; k++) { const t = t0 + (w * k) / 5; lbox(f, M.iron, t - 0.012, t + 0.012, y0, top, -0.1, -0.075, { gao: false }); }
      lbox(f, M.iron, t0, t1, (y0 + y1) / 2 - 0.012, (y0 + y1) / 2 + 0.012, -0.11, -0.07, { gao: false });
      return;
    }

    // Louvred shutters (persiane): open flat, ajar, or closed.
    if (!L.shutters || op.arch) return;
    const sm = L.shutterMat, lw = w / 2, th = 0.035;
    const mode = R();
    if (mode < 0.55) {
      lbox(f, sm, t0 - lw - 0.02, t0 - 0.02, y0, y1, 0.005, 0.005 + th, { gao: false });
      lbox(f, sm, t1 + 0.02, t1 + lw + 0.02, y0, y1, 0.005, 0.005 + th, { gao: false });
    } else if (mode < 0.8) {
      for (const [hinge, sgn] of [[t0, 1], [t1, -1]]) {
        const th2 = rr(1.9, 2.7); // radians from closed
        const g = new THREE.BoxGeometry(lw, y1 - y0, th);
        g.translate(sgn * lw / 2, (y0 + y1) / 2, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(sgn > 0 ? -th2 : th2));
        g.translate(hinge, 0, 0.02);
        geo.geom(sm, g, faceMatrix(f), { gao: false });
        g.dispose();
      }
    } else {
      lbox(f, sm, t0 + 0.01, t1 - 0.01, y0 + 0.01, y1 - 0.01, -0.13, -0.13 + th, { gao: false });
    }
    // Flower pot on some sills.
    if (op.kind === 'win' && R() < 0.18) {
      const pc = (t0 + t1) / 2;
      lbox(f, M.roof, pc - 0.3, pc + 0.3, y0, y0 + 0.2, 0.0, 0.22, { gao: false });
      const x = fx(f, pc, 0.11), z = fz(f, pc, 0.11);
      blob(M.plant, x - f.tx * 0.14, y0 + 0.28, z - f.tz * 0.14, 0.2);
      blob(M.plant, x + f.tx * 0.14, y0 + 0.3, z + f.tz * 0.14, 0.22);
    }
  }

  function doorFill(f, op, L) {
    const { t0, t1, y1 } = op, w = t1 - t0, tc = (t0 + t1) / 2, dd = -FAC + 0.03;
    lbox(f, M.door, t0, t1, 0, y1, dd, dd + 0.07, { tint: rr(0.85, 1.05), gao: false });
    if (op.arch) {
      halfDisc(f, M.glass, tc, y1, w / 2, dd + 0.05, {});
      for (let k = 1; k < 4; k++) {
        const a = (Math.PI * k) / 4;
        const g = new THREE.BoxGeometry(0.03, w / 2, 0.03);
        g.translate(0, w / 4, 0); g.rotateZ(a - Math.PI / 2); g.translate(tc, y1, dd + 0.08);
        geo.geom(M.iron, g, faceMatrix(f), { gao: false }); g.dispose();
      }
      archRing(f, t0, t1, y1, -FAC, 0.045, 0.28, {});
      lbox(f, trim, t0 - 0.28, t0, 0, y1, 0, 0.045, {});
      lbox(f, trim, t1, t1 + 0.28, 0, y1, 0, 0.045, {});
    } else {
      lbox(f, trim, t0 - 0.2, t0, 0, y1, 0, 0.045, {});
      lbox(f, trim, t1, t1 + 0.2, 0, y1, 0, 0.045, {});
      lbox(f, trim, t0 - 0.28, t1 + 0.28, y1, y1 + 0.26, 0, 0.07, {});
    }
    lbox(f, trim, t0 - 0.1, t1 + 0.1, 0, 0.1, -FAC, 0.22, { gao: false }); // threshold step
    if (R() < 0.5 && walkOut(f, (t0 + t1) / 2, 3.2)) { // potted plants beside the door (not in narrow alleys)
      for (const t of [t0 - 0.55, t1 + 0.55]) {
        const x = fx(f, t, 0.35), z = fz(f, t, 0.35);
        const g = new THREE.CylinderGeometry(0.24, 0.17, 0.42, 10);
        g.translate(x, 0.21, z);
        geo.geom(M.roof, g, null, {});
        g.dispose();
        blob(M.plant, x, 0.62, z, 0.3, 1.1);
        collide(x - 0.24, 0, z - 0.24, x + 0.24, 0.9, z + 0.24);
      }
    }
    if (L.lantern) lantern(f, t1 + 0.7, 3.1);
  }

  function shopFill(f, op) {
    const { t0, t1, y1 } = op, w = t1 - t0, tc = (t0 + t1) / 2, dd = -FAC + 0.05;
    lbox(f, M.door, t0, t1, 0, 0.85, dd - 0.02, dd + 0.06, { gao: false });
    lbox(f, M.glass, t0, t1, 0.85, y1, dd - 0.01, dd + 0.01, { gao: false });
    halfDisc(f, M.glass, tc, y1, w / 2, dd + 0.01, {});
    for (const t of [t0 + 0.04, tc, t1 - 0.04]) lbox(f, M.door, t - 0.035, t + 0.035, 0.85, y1, dd, dd + 0.08, { gao: false });
    lbox(f, M.door, t0, t1, y1 - 0.04, y1 + 0.04, dd, dd + 0.08, { gao: false });
    archRing(f, t0, t1, y1, -FAC, 0.045, 0.32, {});
    lbox(f, trim, t0 - 0.32, t0, 0, y1, 0, 0.045, {});
    lbox(f, trim, t1, t1 + 0.32, 0, y1, 0, 0.045, {});
    // Hanging wooden shop sign on an iron bracket.
    if (R() < 0.45) {
      const t = t1 + 0.55;
      lbox(f, M.iron, t - 0.02, t + 0.02, 3.0, 3.04, 0, 0.9, { gao: false });
      lbox(f, M.wood, t - 0.03, t + 0.03, 2.35, 2.95, 0.25, 0.85, { gao: false });
    }
  }

  function lantern(f, t, y) {
    lbox(f, M.iron, t - 0.025, t + 0.025, y + 0.2, y + 0.25, 0, 0.45, { gao: false });
    const x = fx(f, t, 0.45), z = fz(f, t, 0.45);
    geo.box(M.lampGlass || M.glass, x - 0.1, y - 0.2, z - 0.1, x + 0.1, y + 0.12, z + 0.1, { gao: false });
    geo.box(M.iron, x - 0.12, y - 0.24, z - 0.12, x + 0.12, y - 0.2, z + 0.12, { gao: false });
    const g = new THREE.ConeGeometry(0.16, 0.14, 4);
    g.rotateY(Math.PI / 4); g.translate(x, y + 0.19, z);
    geo.geom(M.iron, g, null, { flat: true, gao: false }); g.dispose();
  }

  function balcony(f, op) {
    const t0 = op.t0 - 0.45, t1 = op.t1 + 0.45, y = op.y0 - 0.02, D = 0.85;
    lbox(f, trim, t0, t1, y - 0.15, y, 0, D, { ao: 0.9, gao: false });
    for (const t of [t0 + 0.2, t1 - 0.2]) {
      lbox(f, trim, t - 0.08, t + 0.08, y - 0.42, y - 0.15, 0, 0.55, { ao: 0.85, gao: false });
      lbox(f, trim, t - 0.07, t + 0.07, y - 0.62, y - 0.42, 0, 0.3, { ao: 0.85, gao: false });
    }
    const ir = M.iron, top = y + 1.0;
    lbox(f, ir, t0 + 0.02, t1 - 0.02, top - 0.04, top, D - 0.06, D - 0.02, { gao: false });
    lbox(f, ir, t0 + 0.02, t0 + 0.06, top - 0.04, top, 0, D - 0.02, { gao: false });
    lbox(f, ir, t1 - 0.06, t1 - 0.02, top - 0.04, top, 0, D - 0.02, { gao: false });
    lbox(f, ir, t0 + 0.02, t1 - 0.02, y + 0.1, y + 0.13, D - 0.06, D - 0.02, { gao: false });
    for (let t = t0 + 0.04; t <= t1 - 0.03; t += 0.12) lbox(f, ir, t - 0.01, t + 0.01, y, top, D - 0.05, D - 0.03, { gao: false });
    for (let d = 0.1; d < D - 0.05; d += 0.12) {
      lbox(f, ir, t0 + 0.03, t0 + 0.05, y, top, d - 0.01, d + 0.01, { gao: false });
      lbox(f, ir, t1 - 0.05, t1 - 0.03, y, top, d - 0.01, d + 0.01, { gao: false });
    }
    if (R() < 0.6) { // pots on the balcony
      for (let k = 0; k < 3; k++) {
        const t = rr(t0 + 0.2, t1 - 0.2), x = fx(f, t, D - 0.25), z = fz(f, t, D - 0.25);
        const g = new THREE.CylinderGeometry(0.14, 0.1, 0.24, 8);
        g.translate(x, y + 0.12, z);
        geo.geom(M.roof, g, null, { gao: false }); g.dispose();
        blob(M.plant, x, y + 0.38, z, rr(0.16, 0.24));
      }
    }
  }

  // Façade slab with real openings. bands: [{ y0, y1, ops:[{t0,t1,y0,y1,arch,kind}] }]
  function slab(f, bands, L, ts, te) {
    const o = { tint: L.tint, uvOff: L.uvOff, top: L.eaveAO };
    for (const band of bands) {
      const ops = band.ops.slice().sort((a, b) => a.t0 - b.t0);
      let cur = ts;
      const piece = (a, b, y0, y1) => {
        if (b - a < 0.01 || y1 - y0 < 0.01) return;
        lbox(f, L.wall, a, b, y0, y1, -FAC, 0, o);
        if (L.plinth && y0 < 0.01) lbox(f, L.plinth, a, b, 0, Math.min(y1, L.plinthH), 0, 0.05, { ...o, tint: 1 });
      };
      for (const op of ops) {
        piece(cur, op.t0, band.y0, band.y1);
        piece(op.t0, op.t1, band.y0, op.y0);
        const top = op.arch ? op.y1 + (op.t1 - op.t0) / 2 + 0.02 : op.y1;
        if (op.arch) spandrel(f, L.wall, op.t0, op.t1, op.y1, top, -FAC, 0, o);
        piece(op.t0, op.t1, top, band.y1);
        cur = op.t1;
      }
      piece(cur, te, band.y0, band.y1);
    }
  }

  // ------------------------------------------------------------------ buildings
  const nearPiazza = (l) => l.x1 > -16 && l.x0 < 16 && l.z1 > -14 && l.z0 < 14;
  const onMain = (l) => (l.x1 >= -3.01 && l.x0 <= 3.01 && l.z0 >= 10) || nearPiazza(l);

  function lotStyle(l) {
    const piazza = nearPiazza(l);
    const storeys = piazza ? 3 + (R() < 0.5 ? 1 : 0) : 2 + (R() < 0.6 ? 1 : 0) + (R() < 0.1 ? 1 : 0);
    const G = 3.9, F = 3.25;
    const r = R();
    const style = r < 0.62 ? 'plaster' : r < 0.9 ? 'stone' : 'brick';
    const wall = style === 'plaster' ? M.plaster[Math.floor(R() * M.plaster.length)] : style === 'stone' ? M.stone : M.brick;
    return Object.assign(l, {
      storeys, G, F, H: G + (storeys - 1) * F + 0.55, style, wall,
      plinth: style === 'plaster' ? (R() < 0.6 ? M.stone : trim) : null, plinthH: rr(0.5, 0.9),
      framed: style !== 'plaster' || R() < 0.45, banded: R() < 0.45,
      eave: R() < 0.5 ? 'rafters' : 'cornice',
      shutters: R() < 0.85, shutterMat: M.shutters[Math.floor(R() * M.shutters.length)],
      ww: rr(0.95, 1.15), wh: rr(1.55, 1.8), bay: rr(2.6, 3.3),
      balcony: storeys >= 3 && R() < 0.5, archDoor: style !== 'plaster' || R() < 0.4,
      shop: onMain(l), lantern: R() < 0.35,
      tint: rr(0.92, 1.06), uvOff: [R() * 4, R() * 4], pitch: rr(0.3, 0.4),
    });
  }

  function lotBands(f, L) {
    const W = f.W, bands = [];
    const nb = Math.max(1, Math.floor((W - 0.5) / L.bay));
    const bw = W / nb;
    const bays = [];
    for (let i = 0; i < nb; i++) { const tc = (i + 0.5) * bw; if (W > 2.6 && walkOut(f, tc)) bays.push(tc); }
    const doorBay = bays.length ? Math.floor(R() * bays.length) : -1;
    const balcBay = Math.floor(R() * Math.max(1, bays.length));
    const winArch = L.style === 'stone' && R() < 0.4;
    for (let s = 0; s < L.storeys; s++) {
      const y0 = s === 0 ? 0 : L.G + (s - 1) * L.F;
      const y1 = s === L.storeys - 1 ? L.H : s === 0 ? L.G : y0 + L.F;
      const ops = [];
      bays.forEach((tc, i) => {
        if (s === 0) {
          if (i === doorBay) {
            const w = 1.25;
            ops.push(L.archDoor ? { kind: 'door', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: 2.3, arch: true } : { kind: 'door', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: 2.55 });
          } else if (L.shop && R() < 0.75) {
            const w = Math.min(2.3, bw - 0.9);
            ops.push({ kind: 'shop', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: Math.min(2.2, L.G - 0.45 - w / 2), arch: true });
          } else if (R() < 0.7) ops.push({ kind: 'gwin', t0: tc - 0.42, t1: tc + 0.42, y0: 1.55, y1: 2.6 });
        } else {
          const balc = s === 1 && L.balcony && (i === balcBay || R() < 0.25);
          const w = L.ww, sill = y0 + 0.95;
          if (balc) ops.push({ kind: 'balc', t0: tc - w / 2, t1: tc + w / 2, y0: y0 + 0.02, y1: sill + L.wh });
          else if (winArch) ops.push({ kind: 'win', t0: tc - w / 2, t1: tc + w / 2, y0: sill, y1: sill + L.wh - w / 2, arch: true });
          else ops.push({ kind: 'win', t0: tc - w / 2, t1: tc + w / 2, y0: sill, y1: Math.min(sill + L.wh, y1 - 0.4) });
        }
      });
      bands.push({ y0, y1, ops });
    }
    return bands;
  }

  function faceInfo(r) {
    const out = {};
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace(r, dir);
      let n = 0, k = 0;
      for (let t = 0.25; t < f.W; t += 0.5) { k++; if (walkOut(f, t)) n++; }
      out[dir] = { f, walk: n, frac: k ? n / k : 0 };
    }
    return out;
  }

  // Street-facing wall base: ground contact shadow strips.
  function contactStrip(f, t0, t1) {
    for (let t = t0; t < t1 - 0.01; t += 0.5) {
      const te = Math.min(t1, t + 0.5);
      if (walkOut(f, (t + te) / 2, 0.3)) decals.push([f, t, te]);
    }
  }

  function buildLot(l) {
    const L = lotStyle(l);
    const r = [l.x0, l.x1, l.z0, l.z1];
    const info = faceInfo(r);
    const isFac = (d) => info[d].walk >= 3;
    // Loggia on the piazza's north side needs a taller ground floor behind it.
    if (l.z1 === -11 && l.x1 > -12 && l.x0 < -4) { L.G = 4.9; L.H = L.G + (L.storeys - 1) * L.F + 0.55; }

    // Body inset behind the façade slabs.
    const bx0 = l.x0 + (isFac('W') ? FAC : 0), bx1 = l.x1 - (isFac('E') ? FAC : 0);
    const bz0 = l.z0 + (isFac('N') ? FAC : 0), bz1 = l.z1 - (isFac('S') ? FAC : 0);
    L.eaveAO = L.H;
    geo.box(L.wall, bx0, 0, bz0, bx1, L.H, bz1, { tint: L.tint, uvOff: L.uvOff, top: L.H });
    collide(l.x0, 0, l.z0, l.x1, L.H, l.z1);

    for (const dir of ['N', 'S', 'W', 'E']) {
      if (!isFac(dir)) continue;
      const f = info[dir].f;
      // Trim slab ends where the neighbouring face also has a slab (avoid overlapping corners).
      const prev = { N: 'E', S: 'W', W: 'N', E: 'S' }[dir], next = { N: 'W', S: 'E', W: 'S', E: 'N' }[dir];
      const ts = (dir === 'W' || dir === 'E') && isFac(prev) ? FAC : 0;
      const te = (dir === 'W' || dir === 'E') && isFac(next) ? f.W - FAC : f.W;
      const bands = lotBands(f, L);
      slab(f, bands, L, ts, te);
      for (const band of bands) for (const op of band.ops) {
        if (op.kind === 'door') doorFill(f, op, L);
        else if (op.kind === 'shop') shopFill(f, op);
        else { windowFill(f, op, L); if (op.kind === 'balc') balcony(f, op); }
      }
      // String courses (interrupted by balcony doors).
      if (L.banded) for (let s = 1; s < L.storeys; s++) {
        const y = L.G + (s - 1) * L.F;
        let t = 0;
        const gaps = bands[s].ops.filter((op) => op.kind === 'balc').sort((a, b) => a.t0 - b.t0);
        for (const op of gaps) { lbox(f, trim, t, op.t0, y - 0.12, y + 0.06, 0, 0.07, { gao: false }); t = op.t1; }
        lbox(f, trim, t, f.W, y - 0.12, y + 0.06, 0, 0.07, { gao: false });
      }
      // Eaves: kept below the roof soffit (which starts 0.1 m under the roof plane at the wall line).
      if (L.eave === 'cornice') {
        lbox(f, trim, 0, f.W, L.H - 0.72, L.H - 0.58, 0, 0.1, { ao: 0.95, gao: false });
        lbox(f, trim, 0, f.W, L.H - 0.58, L.H - 0.44, 0, 0.21, { ao: 0.9, gao: false });
        lbox(f, trim, 0, f.W, L.H - 0.44, L.H - 0.3, 0, 0.32, { ao: 0.85, gao: false });
      } else {
        for (let t = 0.3; t < f.W - 0.1; t += 0.55) lbox(f, M.wood, t - 0.05, t + 0.05, L.H - 0.5, L.H - 0.3, 0, 0.42, { ao: 0.8, gao: false });
      }
      // Drainpipe at one end of the façade.
      if (R() < 0.45) {
        const t = R() < 0.5 ? 0.22 : f.W - 0.22;
        cyl(M.iron, fx(f, t, 0.09), 0, fz(f, t, 0.09), 0.05, L.H - 0.2, 8, { gao: false });
      }
      contactStrip(f, 0, f.W);
    }
    buildRoof(l.x0, l.x1, l.z0, l.z1, L.H, L, 0.45);
    // Chimney.
    if (R() < 0.35) {
      const cx = rr(l.x0 + 1, l.x1 - 1), cz = rr(l.z0 + 1, l.z1 - 1);
      const top = L.H + Math.min(l.x1 - l.x0, l.z1 - l.z0) * 0.5 * Math.tan(L.pitch) + 0.9;
      geo.box(L.wall, cx - 0.3, L.H, cz - 0.35, cx + 0.3, top, cz + 0.35, { tint: L.tint, gao: false });
      geo.box(trim, cx - 0.4, top, cz - 0.45, cx + 0.4, top + 0.08, cz + 0.45, { gao: false });
      geo.box(L.wall, cx - 0.25, top + 0.08, cz - 0.3, cx + 0.25, top + 0.3, cz + 0.3, { tint: L.tint, gao: false, skip: 8 });
      halfTube(M.roof, [cx, top + 0.3, cz - 0.42], [cx, top + 0.3, cz + 0.42], 0.3, {}, 5);
    }
  }

  // Gable (ridge along the long side) or hip roof with overhang, underside, fascia and ridge caps.
  function buildRoof(x0, x1, z0, z1, H, L, ov, forceHip = false, axis = null) {
    const tp = Math.tan(L.pitch ?? 0.35);
    const alongX = axis ? axis === 'x' : x1 - x0 >= z1 - z0;
    const hip = forceHip || Math.max(x1 - x0, z1 - z0) / Math.min(x1 - x0, z1 - z0) < 1.35;
    // Work in a frame where the ridge runs along "a" (x or z).
    const A0 = (alongX ? x0 : z0) - ov, A1 = (alongX ? x1 : z1) + ov;
    const B0 = (alongX ? z0 : x0) - ov, B1 = (alongX ? z1 : x1) + ov;
    const half = (B1 - B0) / 2, Bc = (B0 + B1) / 2;
    const ye = H - ov * tp, Hr = H + (half - ov) * tp;
    let Ar0 = A0, Ar1 = A1;
    if (hip) { Ar0 = Math.min(A0 + half, (A0 + A1) / 2); Ar1 = Math.max(A1 - half, (A0 + A1) / 2); }
    const P = (a, y, b) => (alongX ? [a, y, b] : [b, y, a]);
    const D = (da, dy, db) => (alongX ? [da, dy, db] : [db, dy, da]);
    const roof = M.roof, tile = roof.userData.tile || 1.5;
    const slopeLen = Math.hypot(half, half * tp);
    const uvPlane = (eaveDir, eaveOrigin, upDir) => (p) => {
      const e = p[0] * eaveDir[0] + p[2] * eaveDir[2];
      const s = (p[0] - eaveOrigin[0]) * upDir[0] + (p[1] - eaveOrigin[1]) * upDir[1] + (p[2] - eaveOrigin[2]) * upDir[2];
      return [e / tile, s / tile];
    };
    const n1 = Math.hypot(1, tp);
    const planes = [];
    // Long sides (B0 side and B1 side).
    planes.push({ pts: [P(A0, ye, B0), P(A1, ye, B0), P(Ar1, Hr, Bc), P(Ar0, Hr, Bc)], n: D(0, 1, -tp), e: D(1, 0, 0), up: D(0, tp / n1, 1 / n1), o: P(A0, ye, B0) });
    planes.push({ pts: [P(A1, ye, B1), P(A0, ye, B1), P(Ar0, Hr, Bc), P(Ar1, Hr, Bc)], n: D(0, 1, tp), e: D(1, 0, 0), up: D(0, tp / n1, -1 / n1), o: P(A0, ye, B1) });
    if (hip) {
      planes.push({ pts: [P(A0, ye, B1), P(A0, ye, B0), P(Ar0, Hr, Bc)], n: D(-tp, 1, 0), e: D(0, 0, 1), up: D(1 / n1, tp / n1, 0), o: P(A0, ye, B0) });
      planes.push({ pts: [P(A1, ye, B0), P(A1, ye, B1), P(Ar1, Hr, Bc)], n: D(tp, 1, 0), e: D(0, 0, 1), up: D(-1 / n1, tp / n1, 0), o: P(A1, ye, B0) });
    }
    for (const pl of planes) {
      const uv = uvPlane(pl.e, pl.o, pl.up);
      const under = pl.pts.map((p) => [p[0], p[1] - 0.1, p[2]]);
      const dn = [-pl.n[0], -pl.n[1], -pl.n[2]];
      if (pl.pts.length === 4) {
        geo.quad(roof, ...pl.pts, pl.n, { gao: false }, uv);
        geo.quad(M.wood, ...under, dn, { gao: false, ao: 0.75 });
      } else {
        geo.tri(roof, ...pl.pts, pl.n, { gao: false }, uv);
        geo.tri(M.wood, ...under, dn, { gao: false, ao: 0.75 });
      }
      // Fascia along the eave (first edge of every plane).
      const [a, b] = pl.pts;
      const out = [pl.n[0], 0, pl.n[2]];
      geo.quad(M.wood, [a[0], a[1] - 0.14, a[2]], [b[0], b[1] - 0.14, b[2]], b, a, out, { gao: false, ao: 0.9 });
    }
    if (!hip) {
      // Gable walls and barge boards.
      const wallO = { tint: L.tint ?? 1, uvOff: L.uvOff, gao: false };
      const wa0 = alongX ? x0 : z0, wa1 = alongX ? x1 : z1, wb0 = alongX ? z0 : x0, wb1 = alongX ? z1 : x1;
      const HrW = H + ((wb1 - wb0) / 2) * tp;
      geo.tri(L.wall || M.plaster[0], P(wa0, H, wb0), P(wa0, H, wb1), P(wa0, HrW, Bc), D(-1, 0, 0), wallO);
      geo.tri(L.wall || M.plaster[0], P(wa1, H, wb0), P(wa1, H, wb1), P(wa1, HrW, Bc), D(1, 0, 0), wallO);
      for (const [Aend, s] of [[A0, -1], [A1, 1]]) {
        for (const Bend of [B0, B1]) {
          const lo = P(Aend, ye, Bend), hi = P(Aend, Hr, Bc);
          geo.quad(M.wood, [lo[0], lo[1] - 0.14, lo[2]], [hi[0], hi[1] - 0.14, hi[2]], hi, lo, D(s, 0, 0), { gao: false, ao: 0.9 });
        }
      }
    }
    // Ridge and hip caps.
    if (Ar1 - Ar0 > 0.05) halfTube(roof, P(Ar0, Hr + 0.02, Bc), P(Ar1, Hr + 0.02, Bc), 0.13);
    if (hip) {
      for (const [ae, ar] of [[A0, Ar0], [A1, Ar1]]) for (const be of [B0, B1]) halfTube(roof, P(ae, ye + 0.02, be), P(ar, Hr + 0.02, Bc), 0.11, {}, 4);
    }
    return Hr;
  }

  // ------------------------------------------------------------------ towers, church, gates
  function buildTower(T) {
    const [x0, x1, z0, z1] = T.r, H = T.h;
    const L = { wall: M.stone, tint: rr(0.94, 1.05), uvOff: [R() * 3, R() * 3], plinth: null, framed: true, shutters: false, pitch: 0.45 };
    const info = faceInfo(T.r);
    geo.box(M.stone, x0 + FAC, 0, z0 + FAC, x1 - FAC, H, z1 - FAC, { tint: L.tint, uvOff: L.uvOff });
    collide(x0, 0, z0, x1, H, z1);
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = info[dir].f, street = info[dir].walk >= 3;
      const bands = [];
      let y = 0;
      const tc = f.W / 2;
      const doorOp = street ? { kind: 'door', t0: tc - 0.7, t1: tc + 0.7, y0: 0, y1: 2.4, arch: true } : null;
      bands.push({ y0: 0, y1: 5, ops: doorOp ? [doorOp] : [] });
      y = 5;
      let k = 0;
      while (y + 5.5 < H - 2) {
        const ops = [];
        if (y > 7 && (street || y > 11) && R() < 0.7) {
          const c = f.W * (k % 2 ? 0.35 : 0.65);
          ops.push({ kind: 'twin', t0: c - 0.36, t1: c + 0.36, y0: y + 1.8, y1: y + 3.0, arch: true });
        }
        bands.push({ y0: y, y1: y + 5.5, ops });
        y += 5.5; k++;
      }
      bands.push({ y0: y, y1: H, ops: [] });
      const ts = dir === 'W' || dir === 'E' ? FAC : 0, te = dir === 'W' || dir === 'E' ? f.W - FAC : f.W;
      slab(f, bands, L, ts, te);
      for (const b of bands) for (const op of b.ops) {
        if (op.kind === 'door') doorFill(f, op, L);
        else {
          lbox(f, M.glass, op.t0, op.t1, op.y0, op.y1, -FAC + 0.03, -FAC + 0.05, { gao: false });
          halfDisc(f, M.glass, (op.t0 + op.t1) / 2, op.y1, (op.t1 - op.t0) / 2, -FAC + 0.05, {});
          archRing(f, op.t0, op.t1, op.y1, -FAC, 0.03, 0.18, {});
          lbox(f, trim, op.t0 - 0.08, op.t1 + 0.08, op.y0 - 0.08, op.y0, -FAC, 0.06, { gao: false });
        }
      }
      // Putlog holes: small dark squares in rows.
      for (let py = 6; py < H - 3; py += 3.3) for (let t = 0.9; t < f.W - 0.6; t += 1.7) {
        if (R() < 0.55) lbox(f, M.iron, t - 0.09, t + 0.09, py, py + 0.18, 0, 0.02, { gao: false, ao: 0.5, skip: 4 | 8 });
      }
      if (street) contactStrip(f, 0, f.W);
    }
    if (T.top === 'parapet') {
      // Corbelled band and parapet.
      geo.box(trim, x0 - 0.15, H - 0.6, z0 - 0.15, x1 + 0.15, H - 0.35, z1 + 0.15, { gao: false });
      geo.box(M.stone, x0 - 0.2, H - 0.35, z0 - 0.2, x1 + 0.2, H + 0.8, z0 + 0.25, { tint: L.tint, gao: false });
      geo.box(M.stone, x0 - 0.2, H - 0.35, z1 - 0.25, x1 + 0.2, H + 0.8, z1 + 0.2, { tint: L.tint, gao: false });
      geo.box(M.stone, x0 - 0.2, H - 0.35, z0 + 0.25, x0 + 0.25, H + 0.8, z1 - 0.25, { tint: L.tint, gao: false });
      geo.box(M.stone, x1 - 0.25, H - 0.35, z0 + 0.25, x1 + 0.2, H + 0.8, z1 - 0.25, { tint: L.tint, gao: false });
      // Corbels (beccatelli) under the parapet on every side.
      for (let x = x0 + 0.4; x < x1 - 0.2; x += 1.2) {
        geo.box(trim, x - 0.15, H - 0.9, z0 - 0.15, x + 0.15, H - 0.6, z0 + 0.05, { gao: false, ao: 0.9 });
        geo.box(trim, x - 0.15, H - 0.9, z1 - 0.05, x + 0.15, H - 0.6, z1 + 0.15, { gao: false, ao: 0.9 });
      }
      for (let z = z0 + 0.4; z < z1 - 0.2; z += 1.2) {
        geo.box(trim, x0 - 0.15, H - 0.9, z - 0.15, x0 + 0.05, H - 0.6, z + 0.15, { gao: false, ao: 0.9 });
        geo.box(trim, x1 - 0.05, H - 0.9, z - 0.15, x1 + 0.15, H - 0.6, z + 0.15, { gao: false, ao: 0.9 });
      }
    } else {
      buildRoof(x0, x1, z0, z1, H, L, 0.35, true);
    }
  }

  function buildChurch() {
    const [x0, x1, z0, z1] = CHURCH, H = 15;
    const L = { wall: M.stone, tint: 1.02, uvOff: [0.3, 0.7], plinth: trim, plinthH: 0.7, framed: true, shutters: false, pitch: 0.42 };
    geo.box(M.stone, x0, 0, z0, x1, H, z1 - FAC, { tint: L.tint, uvOff: L.uvOff });
    collide(x0, 0, z0, x1, H + 6, z1);
    const f = makeFace(CHURCH, 'S'); // façade toward the square (+Z)
    const W = f.W, c = W / 2;
    const portal = { kind: 'door', t0: c - 1.4, t1: c + 1.4, y0: 0, y1: 3.4, arch: true };
    const side1 = { kind: 'door', t0: c - 6.2, t1: c - 5.0, y0: 0, y1: 2.5, arch: true };
    const side2 = { kind: 'door', t0: c + 5.0, t1: c + 6.2, y0: 0, y1: 2.5, arch: true };
    const bands = [{ y0: 0, y1: 6.5, ops: [side1, portal, side2] }, { y0: 6.5, y1: H, ops: [] }];
    slab(f, bands, L, 0, W);
    for (const op of [portal, side1, side2]) doorFill(f, op, { ...L, lantern: false });
    // Rose window.
    const rw = new THREE.Shape(); rw.absarc(c, 10, 1.9, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(c, 10, 1.4, 0, Math.PI * 2, true); rw.holes.push(hole);
    lshape(f, trim, rw, 0, 0.12, {});
    const disc = new THREE.CircleGeometry(1.4, 16); disc.translate(c, 10, 0.02);
    geo.geom(M.glass, disc, faceMatrix(f), { gao: false }); disc.dispose();
    for (let k = 0; k < 8; k++) {
      const g = new THREE.BoxGeometry(0.06, 2.8, 0.05); g.rotateZ((k * Math.PI) / 8); g.translate(c, 10, 0.05);
      geo.geom(trim, g, faceMatrix(f), { gao: false }); g.dispose();
    }
    // Pilasters and cornice.
    for (const t of [0.4, 5.75, W - 5.75, W - 0.4]) lbox(f, trim, t - 0.35, t + 0.35, 0, H, 0, 0.12, {});
    lbox(f, trim, 0, W, H - 0.4, H, 0, 0.3, { gao: false });
    // Gable roof with ridge along z so the gable faces the square.
    buildRoof(x0, x1, z0, z1, H, { ...L, pitch: 0.42 }, 0.3, false, 'z');
    // Steps.
    for (let k = 0; k < 3; k++) {
      const zz = z1 + 1.8 - k * 0.6, h = 0.15 * (k + 1);
      geo.box(trim, x0 + 2.5, 0, z1, x1 - 2.5, h, zz, { gao: false });
      collide(x0 + 2.5, 0, z1, x1 - 2.5, h, zz);
    }
    contactStrip(f, 0, W);
  }

  function buildCampanile() {
    const [x0, x1, z0, z1] = CAMPANILE, H = 24, top = 31;
    const tint = 0.98;
    geo.box(M.brick, x0, 0, z0, x1, H, z1, { tint });
    collide(x0, 0, z0, x1, top + 4, z1);
    geo.box(trim, x0 - 0.2, H, z0 - 0.2, x1 + 0.2, H + 0.4, z1 + 0.2, { gao: false });
    // Belfry: corner piers and open arches.
    const p = 1.1;
    for (const [px, pz] of [[x0, z0], [x1 - p, z0], [x0, z1 - p], [x1 - p, z1 - p]]) geo.box(M.brick, px, H + 0.4, pz, px + p, top, pz + p, { tint, gao: false });
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace(CAMPANILE, dir);
      spandrel(f, M.brick, p, f.W - p, top - 2.6, top, -0.6, 0, { tint, gao: false }, true);
      archRing(f, p, f.W - p, top - 2.6, -0.61, 0.05, 0.25, {}, true);
    }
    geo.box(M.brick, x0, top, z0, x1, top + 0.5, z1, { tint, gao: false });
    geo.box(trim, x0 - 0.25, top + 0.5, z0 - 0.25, x1 + 0.25, top + 0.75, z1 + 0.25, { gao: false });
    // Pyramid roof.
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ap = [cx, top + 4.2, cz], y = top + 0.75, e = 0.35;
    const c = [[x0 - e, y, z0 - e], [x1 + e, y, z0 - e], [x1 + e, y, z1 + e], [x0 - e, y, z1 + e]];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4], mid = [(a[0] + b[0]) / 2 - cx, 1.2, (a[2] + b[2]) / 2 - cz];
      geo.tri(M.roof, a, b, ap, mid, { gao: false });
      geo.tri(M.wood, [a[0], y - 0.08, a[2]], [b[0], y - 0.08, b[2]], [cx, y - 0.08, cz], [0, -1, 0], { gao: false });
    }
    // Bell.
    const bell = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0.05), new THREE.Vector2(0.62, 0.0), new THREE.Vector2(0.55, 0.15), new THREE.Vector2(0.42, 0.55), new THREE.Vector2(0.36, 0.95), new THREE.Vector2(0.1, 1.05), new THREE.Vector2(0.0, 1.05)], 14);
    bell.translate(cx, top - 2.4, cz);
    geo.geom(M.metalBright, bell, null, { gao: false, tint: [0.75, 0.6, 0.4] });
    bell.dispose();
    geo.box(M.wood, x0 + 0.3, top - 1.3, cz - 0.1, x1 - 0.3, top - 1.1, cz + 0.1, { gao: false });
  }

  function buildGate(G) {
    const [x0, x1, z0, z1] = G.r, H = 13.5;
    const L = { wall: M.stone, tint: 0.97, uvOff: [0.2, 0.1], plinth: null, framed: true, shutters: false };
    // Body is set back behind the deep gate arch; the front wall is built from face pieces.
    const inset = { N: [0, 0, 1.2, 0], S: [0, 0, 0, -1.2], W: [1.2, 0, 0, 0], E: [0, -1.2, 0, 0] }[G.face];
    geo.box(M.stone, x0 + inset[0], 0, z0 + inset[2], x1 + inset[1], H, z1 + inset[3], { tint: L.tint });
    // The gate front projects 0.3 m into the street: the collider includes it.
    const gx = { E: [0, 0.3], W: [-0.3, 0] }[G.face] || [0, 0], gz = { N: [-0.3, 0], S: [0, 0.3] }[G.face] || [0, 0];
    collide(x0 + gx[0], 0, z0 + gz[0], x1 + gx[1], H, z1 + gz[1]);
    const f = makeFace(G.r, G.face);
    const c = f.W / 2, w = 4.4, spring = 3.8, top = spring + w / 2 + 0.02;
    // Deep arch with closed wooden gates.
    spandrel(f, M.stone, c - w / 2, c + w / 2, spring, top, -1.2, 0.3, { tint: L.tint });
    archRing(f, c - w / 2, c + w / 2, spring, -1.2, 0.35, 0.45, {});
    lbox(f, M.stone, 0, c - w / 2, 0, H, -1.2, 0.3, { tint: L.tint });
    lbox(f, M.stone, c + w / 2, f.W, 0, H, -1.2, 0.3, { tint: L.tint });
    lbox(f, M.stone, c - w / 2, c + w / 2, top, H, -1.2, 0.3, { tint: L.tint });
    lbox(f, M.door, c - w / 2, c + w / 2, 0, spring, -1.15, -1.0, { gao: false, tint: 0.9 });
    const g = new THREE.CircleGeometry(w / 2, 12, 0, Math.PI); g.translate(c, spring, -1.02);
    geo.geom(M.door, g, faceMatrix(f), { gao: false, tint: 0.9 }); g.dispose();
    for (let y = 0.6; y < spring; y += 0.9) lbox(f, M.iron, c - w / 2, c + w / 2, y, y + 0.08, -1.0, -0.97, { gao: false });
    lbox(f, M.iron, c - 0.03, c + 0.03, 0, spring + w / 2, -1.0, -0.96, { gao: false });
    // Merlons.
    for (let t = 0.3; t < f.W - 0.3; t += 1.5) lbox(f, M.stone, t, t + 0.8, H, H + 1.1, -0.9, 0.3, { tint: L.tint, gao: false });
    lbox(f, trim, 0, f.W, H - 0.9, H - 0.6, 0, 0.45, { gao: false });
    contactStrip(f, 0, f.W);
  }

  // Vaulted passage (sottopassaggio) carrying a small house over an alley.
  function buildPassage(P) {
    const [x0, x1, z0, z1] = P.r, H = P.h;
    const L = lotStyle({ x0, x1, z0, z1 });
    L.H = H;
    const along = P.axis; // travel direction
    const ends = along === 'z' ? ['N', 'S'] : ['W', 'E'];
    const span = along === 'z' ? x1 - x0 : z1 - z0;
    const spring = 2.4, r = span / 2, crown = spring + r, dep = 0.45;
    for (const dir of ends) {
      const f = makeFace(P.r, dir);
      spandrel(f, L.wall, 0, f.W, spring, H, -dep, 0, { tint: L.tint, uvOff: L.uvOff });
      archRing(f, 0.02, f.W - 0.02, spring, -dep, 0.04, 0.32, {});
      if (H - crown > 2.6) { // small window above the arch
        const tc = f.W / 2;
        lbox(f, M.glass, tc - 0.4, tc + 0.4, crown + 1.0, crown + 2.1, -dep + 0.03, -dep + 0.05, { gao: false });
        lbox(f, trim, tc - 0.5, tc + 0.5, crown + 0.92, crown + 1.0, -dep, 0.06, { gao: false });
      }
      lbox(f, trim, 0, f.W, H - 0.35, H - 0.1, 0, 0.3, { gao: false });
    }
    // Body above the vault, between the end slabs.
    if (along === 'z') geo.box(L.wall, x0, crown, z0 + dep, x1, H, z1 - dep, { tint: L.tint, uvOff: L.uvOff, skip: 3 });
    else geo.box(L.wall, x0 + dep, crown, z0, x1 - dep, H, z1, { tint: L.tint, uvOff: L.uvOff, skip: 48 });
    // Barrel vault (inner surface).
    const segs = 12, a0 = along === 'z' ? z0 + dep : x0 + dep, a1 = along === 'z' ? z1 - dep : x1 - dep;
    const c = along === 'z' ? (x0 + x1) / 2 : (z0 + z1) / 2;
    for (let k = 0; k < segs; k++) {
      const t0 = (Math.PI * k) / segs, t1 = (Math.PI * (k + 1)) / segs, tm = (t0 + t1) / 2;
      const p = (t, a) => (along === 'z' ? [c + r * Math.cos(t), spring + r * Math.sin(t), a] : [a, spring + r * Math.sin(t), c + r * Math.cos(t)]);
      const n = along === 'z' ? [-Math.cos(tm), -Math.sin(tm), 0] : [0, -Math.sin(tm), -Math.cos(tm)];
      geo.quad(M.stone, p(t0, a0), p(t0, a1), p(t1, a1), p(t1, a0), n, { gao: false, ao: 0.7 });
    }
    collide(x0, spring, z0, x1, H, z1);
    buildRoof(x0, x1, z0, z1, H, L, 0.3);
  }

  function buildLoggia() {
    const x0 = -12.3, x1 = -3.7, zf = -8.5, zb = -11, cols = 4;
    const spring = 2.6, colTop = 2.35, bandTop = 4.3;
    const step = (x1 - x0 - 0.6) / (cols - 1);
    const xs = []; for (let k = 0; k < cols; k++) xs.push(x0 + 0.3 + k * step);
    const zc = zf + 0.25;
    for (const x of xs) {
      geo.box(trim, x - 0.3, 0, zc - 0.3, x + 0.3, 0.32, zc + 0.3, {});
      cyl(trim, x, 0.32, zc, 0.2, colTop - 0.32, 14, { gao: true });
      geo.box(trim, x - 0.32, colTop, zc - 0.32, x + 0.32, spring, zc + 0.32, { gao: false });
      collide(x - 0.3, 0, zc - 0.3, x + 0.3, spring, zc + 0.3);
    }
    // Arcade wall: rectangle minus arches, extruded 0.5 m.
    const f = { W: x1 - x0, ox: x0, oz: zf + 0.5, tx: 1, tz: 0, dx: 0, dz: 1 };
    const s = new THREE.Shape();
    s.moveTo(0, bandTop); s.lineTo(0, spring);
    for (let k = 0; k < cols - 1; k++) {
      const a = xs[k] - x0 + 0.32, b = xs[k + 1] - x0 - 0.32;
      s.lineTo(a - 0.01, spring);
      s.absarc((a + b) / 2, spring, (b - a) / 2 + 0.01, Math.PI, 0, true); // hidden behind the arch ring's intrados
    }
    s.lineTo(f.W, spring); s.lineTo(f.W, bandTop); s.lineTo(0, bandTop);
    lshape(f, M.plaster[1], s, -0.5, 0, { tint: 1.02 });
    for (let k = 0; k < cols - 1; k++) archRing(f, xs[k] - x0 + 0.32, xs[k + 1] - x0 - 0.32, spring, -0.51, 0.03, 0.22, {}, true);
    lbox(f, trim, 0, f.W, bandTop - 0.25, bandTop, 0, 0.12, { gao: false });
    collide(x0, spring, zf, x1, bandTop + 0.4, zf + 0.5);
    // End walls, ceiling and lean-to roof.
    for (const [a, b] of [[x0, x0 + 0.3], [x1 - 0.3, x1]]) { geo.box(M.plaster[1], a, 0, zb, b, bandTop, zf, { tint: 1.02 }); collide(a, 0, zb, b, bandTop, zf); }
    geo.quad(M.wood, [x0, bandTop - 0.02, zb], [x1, bandTop - 0.02, zb], [x1, bandTop - 0.02, zf + 0.5], [x0, bandTop - 0.02, zf + 0.5], [0, -1, 0], { gao: false, ao: 0.8 });
    for (let x = x0 + 0.5; x < x1; x += 0.7) geo.box(M.wood, x - 0.06, bandTop - 0.2, zb, x + 0.06, bandTop - 0.02, zf + 0.5, { gao: false, ao: 0.8 });
    const yb = 5.35, yf = bandTop + 0.02, tile = M.roof.userData.tile || 1.5;
    const slope = Math.hypot(zb - (zf + 0.8), yb - yf);
    const uv = (p) => [p[0] / tile, ((p[2] - (zf + 0.8)) / (zb - (zf + 0.8))) * slope / tile];
    geo.quad(M.roof, [x0 - 0.2, yf, zf + 0.8], [x1 + 0.2, yf, zf + 0.8], [x1 + 0.2, yb, zb], [x0 - 0.2, yb, zb], [0, 1, 0.3], { gao: false }, uv);
    geo.quad(M.wood, [x0 - 0.2, yf - 0.1, zf + 0.8], [x1 + 0.2, yf - 0.1, zf + 0.8], [x1 + 0.2, yb - 0.1, zb], [x0 - 0.2, yb - 0.1, zb], [0, -1, -0.3], { gao: false });
    // Triangular end caps under the lean-to.
    for (const [x, s] of [[x0 - 0.2, -1], [x1 + 0.2, 1]]) geo.tri(M.plaster[1], [x, yf, zf + 0.8], [x, yb, zb], [x, yf, zb], [s, 0, 0], { gao: false });
  }

  // ------------------------------------------------------------------ build everything
  lots.forEach(buildLot);
  TOWERS.forEach(buildTower);
  buildChurch();
  buildCampanile();
  GATES.forEach(buildGate);
  PASSAGES.forEach(buildPassage);
  buildLoggia();

  // ------------------------------------------------------------------ ground
  geo.box(M.cobble, -60, -0.2, -60, 60, 0, 60, { gao: false, cast: false, skip: 1 | 2 | 16 | 32 | 8 });
  // Piazza: herringbone brick with a dressed stone border; flagstone cathedral square; central gutters.
  const herr = M.herringbone || M.paving;
  geo.box(trim, -13, 0, -11, 13, 0.035, 11, { gao: false, cast: false });
  geo.box(herr, -12.4, 0, -10.4, 12.4, 0.045, 10.4, { gao: false, cast: false });
  for (let x = -12.4; x < 12.3; x += 6.2) geo.box(M.paving, x - 0.2 + (x > -12.4 ? 0 : 0.2), 0, -10.4, x + 0.2, 0.05, 10.4, { gao: false, cast: false, tint: 0.92 });
  geo.box(M.paving, -10, 0, -44, 10, 0.04, -30, { gao: false, cast: false });
  geo.box(M.paving, -0.6, 0, 11, 0.6, 0.03, 46.8, { gao: false, cast: false });
  geo.box(M.paving, -0.6, 0, -30, 0.6, 0.03, -11, { gao: false, cast: false });
  geo.box(M.paving, -46.8, 0, -0.6, -13, 0.03, 0.6, { gao: false, cast: false });
  geo.box(M.paving, 13, 0, -0.55, 46.8, 0.03, 0.55, { gao: false, cast: false });

  // ------------------------------------------------------------------ fountain
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const lathe = (mat, pts, segs, o = {}, phi0 = 0) => {
    const g = new THREE.LatheGeometry(pts, segs, phi0);
    geo.geom(mat, g, null, { flat: true, gao: false, ...o });
    g.dispose();
  };
  lathe(trim, [V2(0, 0.06), V2(2.85, 0.06), V2(2.85, 0.4), V2(2.92, 0.42), V2(3.2, 0.42), V2(3.28, 0.39), V2(3.28, 0.3), V2(3.2, 0.27), V2(3.2, 0.1), V2(3.4, 0.06), V2(3.4, 0.0)].reverse(), 8, {}, Math.PI / 8);
  lathe(trim, [V2(0, 0.06), V2(0.48, 0.06), V2(0.48, 0.24), V2(0.32, 0.4), V2(0.24, 0.75), V2(0.3, 1.0), V2(0.26, 1.35), V2(0.34, 1.48), V2(0.2, 1.75), V2(0.26, 2.05), V2(0.16, 2.3), V2(0.22, 2.42), V2(0.1, 2.7), V2(0.14, 2.8), V2(0, 2.9)], 12);
  lathe(trim, [V2(0.3, 1.45), V2(0.9, 1.55), V2(1.35, 1.72), V2(1.42, 1.76), V2(1.42, 1.86), V2(1.32, 1.86), V2(0.9, 1.72), V2(0.3, 1.66)], 12);
  const water = (r, y, segs = 8) => {
    const g = new THREE.CircleGeometry(r, segs, segs === 8 ? Math.PI / 8 : 0); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
    geo.geom(M.water, g, null, { gao: false, cast: false });
    g.dispose();
  };
  water(2.86, 0.33); water(1.33, 1.82, 12);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, ca = Math.cos(a), sa = Math.sin(a);
    const curve = new THREE.QuadraticBezierCurve3(V3(ca * 1.42, 1.8, sa * 1.42), V3(ca * 1.75, 1.7, sa * 1.75), V3(ca * 2.0, 0.33, sa * 2.0));
    const g = new THREE.TubeGeometry(curve, 8, 0.025, 5, false);
    geo.geom(M.waterJet || M.water, g, null, { gao: false, cast: false }); g.dispose();
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    geo.box(M.metalBright, ca * 0.15 - 0.03, 2.42, sa * 0.15 - 0.03, ca * 0.3 + 0.03, 2.47, sa * 0.3 + 0.03, { gao: false, tint: [0.7, 0.6, 0.45] });
    const curve = new THREE.QuadraticBezierCurve3(V3(ca * 0.3, 2.44, sa * 0.3), V3(ca * 0.7, 2.5, sa * 0.7), V3(ca * 0.95, 1.82, sa * 0.95));
    const g = new THREE.TubeGeometry(curve, 8, 0.018, 4, false);
    geo.geom(M.waterJet || M.water, g, null, { gao: false, cast: false }); g.dispose();
  }
  // Octagonal rim (flats facing the axes and diagonals): 0.42 m, low enough to step onto and over
  // into the shallow basin. Axis flats are exact boxes, diagonal flats are covered by three boxes.
  for (const s of [-1, 1]) {
    collide(s > 0 ? 2.63 : -3.03, 0, -1.26, s > 0 ? 3.03 : -2.63, 0.42, 1.26);
    collide(-1.26, 0, s > 0 ? 2.63 : -3.03, 1.26, 0.42, s > 0 ? 3.03 : -2.63);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const tau of [-0.78, 0, 0.78]) {
    const cx = sx * (2.0 - 0.707 * tau), cz = sz * (2.0 + 0.707 * tau);
    collide(cx - 0.28, 0, cz - 0.28, cx + 0.28, 0.42, cz + 0.28);
  }
  collide(-0.5, 0, -0.5, 0.5, 2.9, 0.5);
  collide(-1.3, 1.45, -1.3, 1.3, 1.9, 1.3);
  decalsRound(0, 0, 4.1, 0.55);

  // ------------------------------------------------------------------ street furniture
  function bench(x, z, alongX) {
    const [w, d] = alongX ? [1.9, 0.5] : [0.5, 1.9];
    geo.box(trim, x - w / 2, 0.4, z - d / 2, x + w / 2, 0.5, z + d / 2, { gao: false });
    for (const s of [-0.7, 0.7]) {
      const lx = alongX ? x + s : x, lz = alongX ? z : z + s;
      geo.box(trim, lx - (alongX ? 0.12 : 0.22), 0, lz - (alongX ? 0.22 : 0.12), lx + (alongX ? 0.12 : 0.22), 0.4, lz + (alongX ? 0.22 : 0.12), {});
    }
    collide(x - w / 2, 0, z - d / 2, x + w / 2, 0.5, z + d / 2);
    decalsRound(x, z, 1.2, 0.35);
  }
  bench(-7.5, 7.2, true); bench(7.5, 7.2, true); bench(-7.5, -6.3, true); bench(7.5, -6.3, true);
  bench(-6, -36, true); bench(6, -36, true);

  function planter(x, z, s = 1.2) {
    geo.box(trim, x - s / 2, 0, z - s / 2, x + s / 2, 0.62, z + s / 2, {});
    geo.box(trim, x - s / 2 - 0.05, 0.62, z - s / 2 - 0.05, x + s / 2 + 0.05, 0.7, z + s / 2 + 0.05, { gao: false });
    for (let k = 0; k < 5; k++) blob(M.plant, x + rr(-0.3, 0.3) * s, 0.95 + rr(0, 0.35), z + rr(-0.3, 0.3) * s, rr(0.3, 0.45) * s);
    collide(x - s / 2, 0, z - s / 2, x + s / 2, 0.7, z + s / 2);
    decalsRound(x, z, s * 0.9, 0.4);
  }
  planter(-11, -9.2); planter(11, -9.2); planter(11, 9.2); planter(-8, -41.5, 1.4); planter(8, -41.5, 1.4);

  function cafe(x, z) {
    cyl(M.iron, x, 0, z, 0.05, 0.72, 8, { gao: false });
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16); g.translate(x, 0.74, z);
    geo.geom(M.metalBright, g, null, { gao: false }); g.dispose();
    geo.box(M.iron, x - 0.25, 0, z - 0.25, x + 0.25, 0.03, z + 0.25, { gao: false });
    for (const a of [0.4, 2.2, 3.9]) {
      const cx = x + Math.cos(a) * 0.72, cz = z + Math.sin(a) * 0.72;
      geo.box(M.wood, cx - 0.21, 0.44, cz - 0.21, cx + 0.21, 0.48, cz + 0.21, { gao: false });
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) geo.box(M.iron, cx + dx - 0.015, 0, cz + dz - 0.015, cx + dx + 0.015, 0.44, cz + dz + 0.015, { gao: false });
      const bx = cx + Math.cos(a) * 0.2, bz = cz + Math.sin(a) * 0.2;
      geo.box(M.wood, bx - 0.2, 0.48, bz - 0.2, bx + 0.2, 0.9, bz + 0.2, { gao: false, ao: 1 });
    }
    // Umbrella (double-sided canvas).
    cyl(M.wood, x, 0.76, z, 0.03, 1.7, 6, { gao: false });
    const cone = new THREE.ConeGeometry(1.35, 0.45, 8, 1, true); cone.translate(x, 2.45, z);
    geo.geom(M.fabric, cone, null, { flat: true, gao: false, tint: [1.0, 0.97, 0.92] });
    geo.geom(M.fabric, cone, null, { flat: true, gao: false, flip: true, ao: 0.8 });
    cone.dispose();
    collide(x - 0.45, 0, z - 0.45, x + 0.45, 0.8, z + 0.45);
    decalsRound(x, z, 1.1, 0.3);
  }
  cafe(-9.8, 4.2); cafe(-6.8, 2.2); cafe(-10.2, 0.2); cafe(9.5, -2.8);

  function crates(x, z, n = 2) {
    for (let k = 0; k < n; k++) {
      const s = rr(0.75, 0.95), ox = x + (k % 2) * 0.95, oz = z + (k > 1 ? 0.95 : 0), rot = rr(-0.2, 0.2);
      const g = new THREE.BoxGeometry(s, s, s); g.rotateY(rot); g.translate(ox, s / 2, oz);
      geo.geom(M.wood, g, null, { gao: true }); g.dispose();
      collide(ox - s / 2, 0, oz - s / 2, ox + s / 2, s, oz + s / 2);
      decalsRound(ox, oz, s * 0.9, 0.35);
    }
    if (n >= 2 && R() < 0.7) {
      const s = 0.7; const g = new THREE.BoxGeometry(s, s, s); g.rotateY(rr(0, 1)); g.translate(x + 0.45, 0.85 + s / 2, z);
      geo.geom(M.wood, g, null, { gao: false }); g.dispose();
    }
  }
  crates(-23.8, -8, 2); crates(21.4, 6, 3); crates(-30, 1.8, 2); crates(30, -1.6, 2); crates(-1.9, 30, 2);
  crates(12, 24.4, 2); crates(-18, -25.3, 2); crates(1.8, -20, 1); crates(-40, -2, 1);

  // Well in the cathedral square.
  {
    const x = 4.5, z = -35;
    const g = new THREE.LatheGeometry([V2(0, 0.3), V2(0.8, 0.3), V2(0.8, 1.0), V2(1.05, 1.0), V2(1.05, 0.9), V2(0.95, 0.85), V2(0.95, 0.0), V2(0, 0.0)].reverse(), 8);
    g.translate(x, 0, z);
    geo.geom(trim, g, null, { flat: true });
    g.dispose();
    for (const s of [-1, 1]) geo.box(M.iron, x + s * 0.9 - 0.04, 1.0, z - 0.04, x + s * 0.9 + 0.04, 2.6, z + 0.04, { gao: false });
    geo.box(M.iron, x - 0.95, 2.55, z - 0.04, x + 0.95, 2.62, z + 0.04, { gao: false });
    collide(x - 1.0, 0, z - 1.0, x + 1.0, 1.0, z + 1.0);
    decalsRound(x, z, 1.6, 0.45);
  }

  // Laundry lines across alleys.
  function laundry(a, b, y, alongX) {
    const [x0, z0] = a, [x1, z1] = b;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.CylinderGeometry(0.008, 0.008, len, 4);
    g.rotateZ(Math.PI / 2); if (!alongX) g.rotateY(Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    geo.geom(M.iron, g, null, { gao: false, cast: false }); g.dispose();
    const cols = [[1, 1, 1], [0.75, 0.85, 1.0], [1.0, 0.95, 0.75], [1.0, 0.82, 0.8], [0.85, 0.95, 0.85]];
    let t = 0.25;
    while (t < len - 0.5) {
      const w = rr(0.35, 0.7), h = rr(0.4, 0.8), c = cols[Math.floor(R() * cols.length)];
      const px = x0 + (x1 - x0) * (t + w / 2) / len, pz = z0 + (z1 - z0) * (t + w / 2) / len;
      const gg = new THREE.BoxGeometry(alongX ? w : 0.012, h, alongX ? 0.012 : w);
      gg.translate(px, y - h / 2, pz);
      geo.geom(M.fabric, gg, null, { gao: false, tint: c }); gg.dispose();
      t += w + rr(0.1, 0.35);
    }
  }
  laundry([-24.5, 18], [-22, 18], 5.8, true);
  laundry([21, -19], [23.5, -19], 6.1, true);
  laundry([6, 24], [6, 26.5], 5.6, false);
  laundry([-19, 24], [-19, 26.5], 6.0, false);
  laundry([-35, -3], [-35, 3], 6.4, false);

  // ------------------------------------------------------------------ contact-shadow decals
  function decalsRound(x, z, r, alpha) { decals.push({ round: true, x, z, r, alpha }); }
  const decalMesh = (() => {
    const pos = [], col = [];
    const push = (x, z, a) => { pos.push(x, 0.052, z); col.push(0, 0, 0, a); };
    for (const d of decals) {
      if (d.round) {
        const segs = 16;
        for (let k = 0; k < segs; k++) {
          const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
          push(d.x, d.z, d.alpha);
          push(d.x + Math.cos(a1) * d.r, d.z + Math.sin(a1) * d.r, 0);
          push(d.x + Math.cos(a0) * d.r, d.z + Math.sin(a0) * d.r, 0);
        }
        continue;
      }
      const [f, t0, t1] = d;
      const bands = [[0, 0.25, 0.42, 0.2], [0.25, 0.9, 0.2, 0]];
      for (const [d0, d1, a0, a1] of bands) {
        const p = [[t0, d0, a0], [t1, d0, a0], [t1, d1, a1], [t0, d1, a1]].map(([t, dd, a]) => [fx(f, t, dd), fz(f, t, dd), a]);
        // Winding facing up.
        const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
        const order = cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const i of order) push(p[i][0], p[i][1], p[i][2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    return mesh;
  })();

  const { meshes, tris } = geo.finish(scene);
  scene.add(decalMesh);

  // ------------------------------------------------------------------ backdrop
  const backdrop = buildBackdrop(scene, M, R);

  // ------------------------------------------------------------------ navigation
  const clear = (x, z, r) => {
    for (let a = 0; a < 8; a++) if (!isWalk(x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r)) return false;
    if (!isWalk(x, z)) return false;
    for (const b of colliders) if (b.min.y < 1.8 && x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
    return true;
  };
  const navPoints = [];
  for (let z = -46; z <= 46; z += 3) for (let x = -46; x <= 46; x += 3) if (clear(x, z, 0.9)) navPoints.push(V3(x, 0, z));
  // Alleys are narrower than the sampling grid; add their centre lines explicitly.
  for (let z = -24; z <= 25; z += 3) { if (clear(-23.25, z, 0.6)) navPoints.push(V3(-23.25, 0, z)); if (clear(22.25, z, 0.6)) navPoints.push(V3(22.25, 0, z)); }
  for (let x = -22; x <= 21; x += 3) { if (clear(x, 25.25, 0.6)) navPoints.push(V3(x, 0, 25.25)); if (clear(x, -24.75, 0.6)) navPoints.push(V3(x, 0, -24.75)); }

  const pick = (x, z) => { let best = null, bd = 1e9; for (const p of navPoints) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best.clone(); };
  const enemySpawns = [pick(-23.25, -16), pick(22.25, 14), pick(0, -37), pick(-38, 0), pick(38, 0), pick(-10, 25.25), pick(9, -24.75)];

  const waterMat = geo.vcCache.get(M.water);
  console.log(`[city] ${lots.length} lots, ${meshes.length} meshes, ${Math.round(tris / 1000)}k tris, ${colliders.length} colliders, ${navPoints.length} nav points, ${(performance.now() - t0).toFixed(0)} ms`);

  return {
    colliders,
    playerSpawn: V3(0, 0, 42),
    playerYaw: 0,
    enemySpawns,
    navPoints,
    bounds: { minX: -47, maxX: 47, minZ: -44, maxZ: 47 },
    meshes: [...meshes, decalMesh, ...backdrop],
    update(dt) {
      if (waterMat?.normalMap) { waterMat.normalMap.offset.x += dt * 0.03; waterMat.normalMap.offset.y += dt * 0.017; }
    },
  };
}

const snap = (v) => Math.round(v * 2) / 2;

// Rolling Tuscan countryside around the hill town, cypresses and distant farmhouses.
function buildBackdrop(scene, M, R) {
  const out = [];
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const fbm = (x, y) => vn(x, y) * 0.55 + vn(x * 2.1, y * 2.1) * 0.3 + vn(x * 4.3, y * 4.3) * 0.15;
  const height = (x, z) => {
    const r = Math.hypot(x, z);
    const drop = -(1 - Math.exp(-Math.max(0, r - 58) / 45)) * 38;
    const roll = (fbm(x / 140, z / 140) - 0.45) * 110 * THREE.MathUtils.smoothstep(r, 110, 360);
    return drop + roll;
  };
  const RINGS = [58, 64, 72, 82, 95, 115, 140, 175, 220, 280, 360, 460, 600, 780];
  const SEG = 72;
  const pos = [], col = [];
  const colourAt = (x, z, h) => {
    const n = fbm(x / 60 + 7, z / 60 - 3), m = fbm(x / 25, z / 25);
    const olive = [0.4, 0.45, 0.27], gold = [0.74, 0.64, 0.4], field = [0.6, 0.47, 0.33], wood = [0.26, 0.33, 0.2], green = [0.47, 0.55, 0.3];
    let c = n < 0.35 ? gold : n < 0.5 ? olive : n < 0.62 ? green : n < 0.72 ? field : wood;
    const k = 0.9 + m * 0.2;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  for (let i = 0; i < RINGS.length - 1; i++) for (let s = 0; s < SEG; s++) {
    const p = (ri, si) => { const a = (si / SEG) * Math.PI * 2, r = RINGS[ri]; const x = Math.cos(a) * r, z = Math.sin(a) * r; return [x, height(x, z), z]; };
    const a = p(i, s), b = p(i, s + 1), c = p(i + 1, s + 1), d = p(i + 1, s);
    for (const tri of [[a, b, c], [a, c, d]]) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      const cc = colourAt(cx, cz, 0);
      for (const v of tri) { pos.push(...v); col.push(...cc); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const hills = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  hills.receiveShadow = false; hills.matrixAutoUpdate = false;
  scene.add(hills); out.push(hills);

  // Cypresses: instanced cones.
  const cyp = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x33472a, roughness: 1, flatShading: true }), 260);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (let k = 0; k < 400 && n < 260; k++) {
    const a = R() * Math.PI * 2, r = 70 + R() ** 1.5 * 380;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // Cypresses line roads: cluster some in rows.
    const rows = R() < 0.5 ? 5 : 1;
    for (let j = 0; j < rows && n < 260; j++) {
      const xx = x + j * 5 * Math.cos(a + 1.3), zz = z + j * 5 * Math.sin(a + 1.3);
      const h = 8 + R() * 6;
      sc.set(1.1 + R() * 0.5, h, 1.1 + R() * 0.5);
      p.set(xx, height(xx, zz) + h / 2 - 0.5, zz);
      cyp.setMatrixAt(n++, m4.compose(p, q, sc));
    }
  }
  cyp.count = n;
  scene.add(cyp); out.push(cyp);

  // Distant farmhouses with terracotta roofs.
  const houseN = 70;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd9c29a, roughness: 1 }), houseN);
  const roofG = new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1); roofG.rotateZ(Math.PI / 2); roofG.scale(1, 0.5, 1);
  const roofs = new THREE.InstancedMesh(roofG, new THREE.MeshStandardMaterial({ color: 0xa4553a, roughness: 1, flatShading: true }), houseN);
  for (let k = 0; k < houseN; k++) {
    const a = R() * Math.PI * 2, r = 110 + R() * 380;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(x, z);
    const w = 8 + R() * 8, d = 6 + R() * 4, h = 5 + R() * 4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * Math.PI);
    walls.setMatrixAt(k, m4.compose(p.set(x, y + h / 2 - 1, z), q, sc.set(w, h, d)));
    roofs.setMatrixAt(k, m4.compose(p.set(x, y + h - 1 + d * 0.22, z), q, sc.set(w * 1.05, d * 0.9, d * 1.25)));
  }
  scene.add(walls, roofs); out.push(walls, roofs);
  return out;
}
