// Arenas of the extra game modes, built with the landmark kit on their SITES pads.
//
//  trenches — 塹壕演習場: two zig-zag trench lines facing each other across a cratered no-man's-land
//             with barbed wire. The trenches are raised earthworks (the pad cannot be dug): a corridor
//             between a sandbagged parapet (front, 1.45 m — the player can look over it) and a lower
//             parados, with sandbag steps to climb out, timber revetments and a dugout.
//             Friendly line to the south (local +z), enemy line to the north (local −z).
//  compound — 屋内戦闘訓練施設: a single-storey walled training building around an open courtyard:
//             a ring corridor, eleven rooms with doorways, an entrance hall, a back door, crates and
//             furniture as cover. Ceilings cast shadows so the interior reads as indoors.
import * as THREE from 'three';
import { TRENCH, TRENCH_LINES, DUGOUTS, STAIRS, STAIR_RUN, STAIR_HALF, localRects } from './trench-plan.js';

const SAND = [0.93, 0.86, 0.66], EARTH = [0.75, 0.62, 0.46], SPOIL = [1.35, 1.3, 1.1];   // SPOIL: dry ochre topsoil

// ------------------------------------------------------------------ trenches
// The trenches are cut into the ground (trench-plan.js: terrain.heightAt returns the floor inside the
// cut and the ground surface is not drawn over it). Here: revetted walls (planks and posts) on every
// edge of the cut, an earth floor with duckboards, a fire step along the front wall of each fire bay,
// sandbag stairs to go over the top, a sandbag row on the front lip, a low spoil bank behind, and
// roofed dugouts at the end of the communication trenches.
export function buildTrenches(K, ctx) {
  const M = K.M, L = K.L, R = ctx.R;
  const soil = L.soil, sandbag = L.burlap, wood = M.wood;
  const D = TRENCH.depth, rects = localRects();
  const navs = [], spawns = [];
  const inCut = (x, z, m = 0) => rects.some((r) => x > r[0] - m && x < r[1] + m && z > r[2] - m && z < r[3] + m);

  // ---- walls: boundary of the union of the corridor rectangles, rasterised on a 0.25 m grid.
  const g = 0.25, bx0 = Math.min(...rects.map((r) => r[0])) - 1, bx1 = Math.max(...rects.map((r) => r[1])) + 1;
  const bz0 = Math.min(...rects.map((r) => r[2])) - 1, bz1 = Math.max(...rects.map((r) => r[3])) + 1;
  const NX = Math.ceil((bx1 - bx0) / g), NZ = Math.ceil((bz1 - bz0) / g);
  const cell = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) cell[j * NX + i] = inCut(bx0 + (i + 0.5) * g, bz0 + (j + 0.5) * g) ? 1 : 0;
  const at = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? 0 : cell[j * NX + i]);
  const T = 0.14, plank = { tint: [0.62, 0.52, 0.4], col: true };
  const wallRun = (x0, x1, z0, z1, nx, nz) => {
    K.box(wood, x0, -D - 0.1, z0, x1, 0.02, z1, plank);
    // posts every 1.6 m on the trench side of the revetment
    const alongX = z1 - z0 < x1 - x0, len = alongX ? x1 - x0 : z1 - z0;
    for (let t = 0.8; t < len - 0.3; t += 1.6) {
      const px = alongX ? x0 + t : (nx > 0 ? x1 : x0 - 0.1), pz = alongX ? (nz > 0 ? z1 : z0 - 0.1) : z0 + t;
      K.box(wood, px - 0.06, -D, pz, px + 0.06 + (alongX ? 0 : 0.1) - (alongX ? 0 : 0.1), 0.05, pz + 0.1, { tint: 0.45, d: true, gao: false });
    }
  };
  // rows (walls parallel to x)
  for (let j = 0; j <= NZ; j++) {
    let run = null;
    for (let i = 0; i <= NX; i++) {
      const a = at(i, j - 1), b = at(i, j), type = i < NX && a !== b ? (b ? 1 : 2) : 0;   // 1: cut below (+z side)
      if (run && type !== run.type) {
        const z = bz0 + j * g, x0 = bx0 + run.i * g, x1 = bx0 + i * g;
        if (run.type === 1) wallRun(x0, x1, z - T, z, 0, 1); else wallRun(x0, x1, z, z + T, 0, -1);
        run = null;
      }
      if (type && !run) run = { i, type };
    }
  }
  // columns (walls parallel to z)
  for (let i = 0; i <= NX; i++) {
    let run = null;
    for (let j = 0; j <= NZ; j++) {
      const a = at(i - 1, j), b = at(i, j), type = j < NZ && a !== b ? (b ? 1 : 2) : 0;
      if (run && type !== run.type) {
        const x = bx0 + i * g, z0 = bz0 + run.j * g, z1 = bz0 + j * g;
        if (run.type === 1) wallRun(x - T, x, z0, z1, 1, 0); else wallRun(x, x + T, z0, z1, -1, 0);
        run = null;
      }
      if (type && !run) run = { j, type };
    }
  }

  // ---- floor and duckboards, nav along the centre lines
  for (const r of rects) K.box(soil, r[0], -D - 0.4, r[2], r[1], -D, r[3], { tint: [0.62, 0.5, 0.38], gao: false, cast: false });
  for (const line of TRENCH_LINES) for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    K.box(wood, Math.min(ax, bx) - (uz ? 0.45 : 0), -D, Math.min(az, bz) - (ux ? 0.45 : 0), Math.max(ax, bx) + (uz ? 0.45 : 0), -D + 0.05, Math.max(az, bz) + (ux ? 0.45 : 0), { tint: 0.5, gao: false, cast: false });
    for (let t = 0.4; t < len; t += 0.9) K.box(wood, ax + ux * t - (uz ? 0.5 : 0.05), -D + 0.05, az + uz * t - (ux ? 0.5 : 0.05), ax + ux * t + (uz ? 0.5 : 0.05), -D + 0.08, az + uz * t + (ux ? 0.5 : 0.05), { tint: 0.4, d: true, gao: false, cast: false });
    for (let t = 1.2; t < len - 0.6; t += 2.4) navs.push([ax + ux * t, -D + 0.08, az + uz * t]);
  }

  // ---- per fire trench: fire steps, stepped exits in notches, sandbagged parapet, spoil bank behind
  const h = TRENCH.width / 2;
  const bagTint = () => [0.95, 0.9, 0.78].map((v) => v * (0.86 + R() * 0.18));
  // One course of sandbags along x (bags 0.6 m long, 0.15 m high, rows offset half a bag).
  const bagsX = (p0, p1, z0, z1, y, off) => {
    for (let x = p0 + off; x < p1 - 0.25; x += 0.6) {
      const a = Math.max(p0, x - 0.29), b = Math.min(p1, x + 0.29);
      if (b - a > 0.2) K.box(sandbag, a, y, z0 + R() * 0.03, b, y + 0.15 + R() * 0.015, z1 - R() * 0.03, { tint: bagTint(), gao: false });
    }
  };
  const bagsZ = (x0, x1, p0, p1, y, off) => {
    for (let z = p0 + off; z < p1 - 0.25; z += 0.6) {
      const a = Math.max(p0, z - 0.29), b = Math.min(p1, z + 0.29);
      if (b - a > 0.2) K.box(sandbag, x0 + R() * 0.03, y, a, x1 - R() * 0.03, y + 0.15 + R() * 0.015, b, { tint: bagTint(), gao: false });
    }
  };
  for (const S of STAIRS) {
    const own = S.front < 0, F = S.front;
    const wallZ = S.zf + F * h;                        // the front wall (enemy side) of the fire bays
    const line = TRENCH_LINES[own ? 0 : 2];
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1];
      if (az !== S.zf || bz !== S.zf) continue;         // fire bays only (not the rear jogs)
      const x0 = Math.min(ax, bx) + (k === 0 ? 0 : h), x1 = Math.max(ax, bx) - (k === line.length - 2 ? 0 : h);
      const stair = S.xs.find((sx) => sx > x0 && sx < x1);
      const gap = stair === undefined ? [] : [[stair - STAIR_HALF - 0.15, stair + STAIR_HALF + 0.15]];
      const split = (p0, p1) => { const out = []; let c = p0; for (const [g0, g1] of gap) { if (g0 > c) out.push([c, g0]); c = Math.max(c, g1); } if (c < p1) out.push([c, p1]); return out; };
      // fire step: two treads (0.4 m each, 0.4 m deep) along the front wall, the top one 0.8 m up
      const FS = TRENCH.fireStep;
      for (const [p0, p1] of split(x0, x1)) if (p1 - p0 > 0.5) {
        K.box(wood, p0, -D, Math.min(wallZ, wallZ - F * 0.8), p1, -D + FS / 2, Math.max(wallZ, wallZ - F * 0.8), { tint: 0.5, col: true });
        K.box(wood, p0, -D + FS / 2, Math.min(wallZ, wallZ - F * 0.4), p1, -D + FS, Math.max(wallZ, wallZ - F * 0.4), { tint: 0.58, col: true });
        for (let t = p0 + 1; t < p1; t += 2.5) navs.push([t, -D + FS + 0.02, wallZ - F * 0.2]);
      }
      // sandbagged parapet on the front lip: two courses (0.3 m: an eye on the fire step just clears it)
      const sb0 = Math.min(wallZ, wallZ + F * 0.7), sb1 = Math.max(wallZ, wallZ + F * 0.7);
      for (const [p0, p1] of split(x0 - h, x1 + h)) {
        bagsX(p0, p1, sb0, sb1, 0, 0.3);
        bagsX(p0, p1, sb0 + 0.06, sb1 - 0.06, 0.15, 0.6);
        K.col(p0, 0, sb0, p1, 0.3, sb1);
      }
      if (stair !== undefined) {
        // flight of four steps in the notch (0.4 m rises), the ground at the top; bags line the notch
        for (let st = 0; st < 4; st++) {
          const za = wallZ + F * st * 0.45, zb = wallZ + F * (st + 1) * 0.45, y1 = -D + (D / 5) * (st + 1);
          K.box(wood, stair - STAIR_HALF + 0.02, -D, Math.min(za, zb), stair + STAIR_HALF - 0.02, y1, Math.max(za, zb), { tint: 0.5 + (st % 2) * 0.08, col: true });
          navs.push([stair, y1 + 0.02, (za + zb) / 2]);
        }
        navs.push([stair, -D + 0.08, S.zf], [stair, 0.02, wallZ + F * (STAIR_RUN + 0.8)], [stair, 0.02, wallZ + F * (STAIR_RUN + 3)]);
        const n0 = Math.min(wallZ, wallZ + F * STAIR_RUN), n1 = Math.max(wallZ, wallZ + F * STAIR_RUN);
        for (const sx of [-1, 1]) {
          const xa = stair + sx * (STAIR_HALF + 0.14), xb = xa + sx * 0.6;
          bagsZ(Math.min(xa, xb), Math.max(xa, xb), n0, n1, 0, 0.3);
          K.col(Math.min(xa, xb), 0, n0, Math.max(xa, xb), 0.15, n1);
        }
      }
      if (!own) spawns.push([(x0 + x1) / 2 + (stair !== undefined ? 3 : 0), S.zf - F * 0.3, -D + 0.08]);
    }
    // spoil bank (parados) behind the rear walls: a lumpy low mound of the dug earth, open where the
    // communication trench passes through
    const rearZ = S.zf - F * (h + 4.5 + 2.0);
    const cx = TRENCH_LINES[own ? 1 : 3][0][0];
    for (let x = -55; x <= 55; x += 1.2) {
      if (Math.abs(x - cx) < h + 1.2) continue;
      K.blob(soil, x + (R() - 0.5) * 0.5, -0.05, rearZ + (R() - 0.5) * 0.5, 0.9 + R() * 0.35, 0.28 + R() * 0.12, 1.0 + R() * 0.3,
        { tint: SPOIL.map((v) => v * (0.9 + R() * 0.15)), rot: R() * 3, detail: 1, gao: false });
    }
  }
  // Dugouts: carved rooms roofed at ground level (timber roof + earth), bunks and a table inside.
  for (const [x0, x1, z0, z1] of DUGOUTS) {
    const own = z0 > 0, entryZ = own ? z0 : z1;          // entrance on the communication-trench side
    K.box(wood, x0 - 0.2, -0.12, z0 - 0.2, x1 + 0.2, 0.05, z1 + 0.2, { tint: 0.45 });
    for (let x = x0; x < x1; x += 0.8) K.box(wood, x, -0.3, z0 - 0.1, x + 0.2, -0.12, z1 + 0.1, { tint: 0.35, d: true });
    K.box(soil, x0 - 0.6, 0.05, z0 - 0.6, x1 + 0.6, 0.4, z1 + 0.6, { tint: [0.66, 0.55, 0.42], gao: false });
    K.box(wood, x0 + 0.3, -D, own ? z1 - 1.2 : z0 + 0.3, x1 - 0.3, -D + 0.5, own ? z1 - 0.3 : z0 + 1.2, { tint: 0.5, col: true });   // bunk
    K.box(wood, x0 + 0.5, -D + 0.72, (z0 + z1) / 2 - 0.4, x0 + 1.5, -D + 0.78, (z0 + z1) / 2 + 0.4, { tint: 0.6 });
    navs.push([(x0 + x1) / 2, -D + 0.05, (z0 + z1) / 2], [(x0 + x1) / 2, -D + 0.05, entryZ]);
  }

  // ---- no-man's-land: craters, stumps, a ruined farmhouse, barbed wire, fighting positions
  for (let k = 0; k < 22; k++) {
    const x = (R() - 0.5) * 100, z = (R() - 0.5) * 50, r = 1.6 + R() * 2.4;
    if ((Math.abs(x) < 9 && Math.abs(z) < 7) || inCut(x, z, r + 2)) continue;
    for (let s2 = 0; s2 < 8; s2++) {
      const a = (s2 / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      K.blob(soil, px, 0, pz, 0.9 + R() * 0.5, 0.3 + R() * 0.2, 0.9 + R() * 0.5, { tint: EARTH.map((v) => v * (0.85 + R() * 0.2)), rot: R() * 3, detail: 1 });
    }
    K.box(soil, x - r * 0.6, -0.01, z - r * 0.6, x + r * 0.6, 0.02, z + r * 0.6, { tint: EARTH.map((v) => v * 0.55), gao: false, cast: false });
  }
  for (const [x, z] of [[-30, 8], [22, -14], [40, 12], [-12, -20]]) {
    K.cyl(wood, x, 0, z, 0.28, 1.8 + R() * 1.5, 7, { tint: 0.45 });
    K.col(x - 0.3, 0, z - 0.3, x + 0.3, 2.5, z + 0.3);
  }
  {
    const S = M.stone, t = [0.95, 0.9, 0.82];
    const wall = (x0, z0, x1, z1, hh) => K.box(S, x0, 0, z0, x1, hh, z1, { tint: t, col: true });
    wall(-8, -6, -1.5, -5.4, 3.2); wall(1.5, -6, 8, -5.4, 2.1);
    wall(-8, -6, -7.4, 1, 2.6); wall(-8, 3.4, -7.4, 6, 1.4);
    wall(7.4, -6, 8, -1.5, 3.0); wall(7.4, 2, 8, 6, 1.1);
    wall(-8, 5.4, -3, 6, 1.6); wall(2.5, 5.4, 8, 6, 2.4);
    for (let k = 0; k < 14; k++) K.box(S, -7 + R() * 14 - 0.3, 0, -5 + R() * 10 - 0.3, -7 + R() * 14 + 0.3, 0.3 + R() * 0.4, -5 + R() * 10 + 0.3, { tint: t, d: true });
    K.box(wood, -6, 2.3, -5.5, 6, 2.5, -5.2, { tint: 0.4, d: true });
    navs.push([0, 0, 0], [-4, 0, 2], [4, 0, -2], [0, 0, 8], [0, 0, -8]);
  }
  for (const zw of [28, -28]) {
    for (let x = -50; x < 50; x += 14) {
      const a = x + 1.5, b = x + 11;
      for (let px = a; px <= b + 0.01; px += 2.4) K.box(M.iron, px - 0.04, 0, zw - 0.04, px + 0.04, 1.2, zw + 0.04, { d: true, tint: 0.5 });
      for (const y of [0.35, 0.7, 1.05]) K.beam(M.iron, [a, y, zw + (R() - 0.5) * 0.2], [b, y + 0.05, zw + (R() - 0.5) * 0.2], 0.02, 0.02, { d: true, tint: 0.45 });
      K.col(a, 0, zw - 0.3, b, 1.3, zw + 0.3);
    }
  }
  for (const [x, z] of [[-38, 12], [30, -10], [-20, -16], [44, 18]]) {
    for (let c = 0; c < 7; c++) bagsX(x - 2.6, x + 2.6, z - 0.4 + c * 0.03, z + 0.4 - c * 0.03, c * 0.15, c % 2 ? 0.6 : 0.3);
    K.col(x - 2.6, 0, z - 0.4, x + 2.6, 1.05, z + 0.4);
    navs.push([x, 0, z + 2], [x, 0, z - 2]);
  }
  // Pad nav grid: not over the cut or on its walls (those points are above the trench).
  ctx.navExclude = (x, z) => inCut(x, z, 0.8);
  ctx.navPts(navs);
  ctx.spawnsLocal(spawns);
  ctx.enemy = { x: 0, z: -40, r: 60 };
  ctx.arena = { playerSpawn: K.V(-4, -D + 0.1, 40), center: K.V(0, 0, 0), tankLine: -70 };
}

// ------------------------------------------------------------------ indoor compound
export function buildCompound(K, ctx) {
  const M = K.M, R = ctx.R;
  const PL = Array.isArray(M.plaster) ? M.plaster[1] : M.plaster;   // colour variants: [1] is the pale lime wash
  const H = 3.4, T = 0.3, DH = 2.2;          // wall height, thickness, door height
  const outer = [0.98, 0.93, 0.84], inner = [1.04, 1.03, 1.0];
  const navs = [];

  // Wall along x (at z, from x0 to x1) or along z (at x, from z0 to z1), with door gaps [a, b].
  function wallX(z, x0, x1, gaps = [], mat = PL, tint = inner, win = []) {
    let c = x0;
    const cut = [...gaps].sort((p, q) => p[0] - q[0]);
    for (const [a, b] of cut) {
      if (a > c) K.box(mat, c, 0, z - T / 2, a, H, z + T / 2, { tint, col: true });
      K.box(mat, a, DH, z - T / 2, b, H, z + T / 2, { tint, col: true });                 // lintel
      navs.push([(a + b) / 2, 0.05, z - 0.9], [(a + b) / 2, 0.05, z], [(a + b) / 2, 0.05, z + 0.9]);
      c = b;
    }
    if (c < x1) K.box(mat, c, 0, z - T / 2, x1, H, z + T / 2, { tint, col: true });
    for (const [a, b] of win) K.box(M.glass, a, 1.2, z - T / 2 - 0.01, b, 2.2, z + T / 2 + 0.01, { gao: false, tint: 0.7 });
  }
  function wallZ(x, z0, z1, gaps = [], mat = PL, tint = inner, win = []) {
    let c = z0;
    const cut = [...gaps].sort((p, q) => p[0] - q[0]);
    for (const [a, b] of cut) {
      if (a > c) K.box(mat, x - T / 2, 0, c, x + T / 2, H, a, { tint, col: true });
      K.box(mat, x - T / 2, DH, a, x + T / 2, H, b, { tint, col: true });
      navs.push([x - 0.9, 0.05, (a + b) / 2], [x, 0.05, (a + b) / 2], [x + 0.9, 0.05, (a + b) / 2]);
      c = b;
    }
    if (c < z1) K.box(mat, x - T / 2, 0, c, x + T / 2, H, z1, { tint, col: true });
    for (const [a, b] of win) K.box(M.glass, x - T / 2 - 0.01, 1.2, a, x + T / 2 + 0.01, 2.2, b, { gao: false, tint: 0.7 });
  }

  const X = 17, Z = 13;
  // Floor, ceiling (over everything but the courtyard), flat roof with a parapet.
  K.box(M.paving, -X, -0.4, -Z, X, 0.02, Z, { tint: 0.92, gao: false });
  const ceil = (x0, z0, x1, z1) => K.box(PL, x0, H, z0, x1, H + 0.35, z1, { tint: [0.95, 0.93, 0.88], gao: false });
  ceil(-X, -Z, X, -4); ceil(-X, 4, X, Z); ceil(-X, -4, -5, 4); ceil(5, -4, X, 4);
  for (const [x0, z0, x1, z1] of [[-X - 0.2, -Z - 0.2, X + 0.2, -Z + 0.3], [-X - 0.2, Z - 0.3, X + 0.2, Z + 0.2], [-X - 0.2, -Z, -X + 0.3, Z], [X - 0.3, -Z, X + 0.2, Z]]) {
    K.box(M.stoneTrim, x0, H + 0.35, z0, x1, H + 0.9, z1, { tint: 0.95 });
  }
  // Outer walls (stone) with the main door (south), the back door (north) and windows.
  const wins = (a, b, step) => { const w = []; for (let x = a; x < b; x += step) w.push([x, x + 1.1]); return w; };
  wallX(Z, -X, X, [[-0.9, 0.9]], M.stone, outer, wins(-15, -2, 4.4).concat(wins(3.2, 16, 4.4)));
  wallX(-Z, -X, X, [[8.5, 9.8]], M.stone, outer, wins(-15, 7, 4.4));
  wallZ(-X, -Z, Z, [], M.stone, outer, wins(-11, 12, 4.6));
  wallZ(X, -Z, Z, [], M.stone, outer, wins(-11, 12, 4.6));
  // Courtyard walls (open arches on every side) and the courtyard itself: gravel, a well, a tree.
  wallX(-4, -5, 5, [[-1.3, 1.3]]); wallX(4, -5, 5, [[-1.3, 1.3]]);
  wallZ(-5, -4, 4, [[-1.1, 1.1]]); wallZ(5, -4, 4, [[-1.1, 1.1]]);
  K.box(K.L.gravel, -4.85, 0.02, -3.85, 4.85, 0.05, 3.85, { gao: false, cast: false });
  K.well(0, 0);
  K.tree(3, 2.4, 4.6, 1.8);
  navs.push([-3, 0, -2.5], [3, 0, -2.5], [-3, 0, 2.5], [-2.5, 0, 0], [2.6, 0, 0]);
  // Ring corridor walls: rooms outside it. North band z∈[−13, −6.5], south band z∈[6.5, 13],
  // west band x∈[−17, −7.5], east band x∈[7.5, 17].
  wallX(-6.5, -X, X, [[-12.5, -11.3], [-1.2, 1.2], [11.3, 12.5]]);
  wallX(6.5, -X, X, [[-12.5, -11.3], [-2.4, 2.4], [11.3, 12.5]]);
  wallZ(-7.5, -6.5, 6.5, [[-3.8, -2.6], [2.6, 3.8]]);
  wallZ(7.5, -6.5, 6.5, [[-3.8, -2.6], [2.6, 3.8]]);
  // Room partitions.
  wallZ(-6, -Z, -6.5); wallZ(6, -Z, -6.5);              // north: three rooms
  wallZ(-6, 6.5, Z); wallZ(6, 6.5, Z);                  // south: two rooms + the entrance hall
  wallX(0, -X, -7.5); wallX(0, 7.5, X);                 // west and east: two rooms each
  // Corridor corners are open; the ring connects all rooms and the courtyard.

  // Furniture and cover: crates, desks, shelves, a vehicle bay's pallets.
  const crate = (x, z, s = 1, h = 1) => K.box(M.wood, x - 0.55 * s, 0, z - 0.55 * s, x + 0.55 * s, 1.1 * h, z + 0.55 * s, { tint: 0.75 + R() * 0.2, col: true });
  const desk = (x, z, alongX = true) => {
    const w = alongX ? 1.6 : 0.8, d = alongX ? 0.8 : 1.6;
    K.box(M.wood, x - w / 2, 0.72, z - d / 2, x + w / 2, 0.78, z + d / 2, { tint: 0.6 });
    K.box(M.wood, x - w / 2 + 0.05, 0, z - d / 2 + 0.05, x + w / 2 - 0.05, 0.72, z + d / 2 - 0.05, { tint: 0.45 });
    K.col(x - w / 2, 0, z - d / 2, x + w / 2, 0.8, z + d / 2);
  };
  const shelf = (x0, z0, x1, z1) => {
    K.box(M.wood, x0, 0, z0, x1, 2.0, z1, { tint: 0.5, col: true });
    for (let y = 0.5; y < 2; y += 0.5) K.box(M.fabric, x0 + 0.05, y, z0 - 0.02, x1 - 0.05, y + 0.28, z1 + 0.02, { tint: 0.6 + R() * 0.4, d: true });
  };
  // North rooms: storage (crates), armoury (shelves), office (desks).
  crate(-14, -11); crate(-12.8, -11, 1, 2); crate(-14, -9.3); crate(-10, -8.6, 1.2);
  shelf(-2, -12.7, 2, -12.2); shelf(-5.6, -11, -5.1, -8); crate(3, -9, 0.9);
  desk(10, -10); desk(14, -8.5, false); shelf(15.8, -12.7, 16.7, -9);
  // West / east rooms.
  desk(-12, -3); crate(-15.5, 4.5, 1, 2); crate(-10, 3, 1.1); desk(-12.5, 3.8, false);
  crate(10, -4, 1.2); crate(11.3, -4, 1, 2); shelf(16.2, 1, 16.7, 5.5); desk(11, 3.5);
  // South rooms and entrance hall (a reception counter).
  crate(-13, 9.5); crate(-11.8, 11.5, 1, 2); desk(-9, 9, false);
  K.box(M.wood, -3, 0, 8.8, 3, 1.1, 9.4, { tint: 0.55, col: true });
  desk(12, 9.5); crate(15, 11.5); shelf(8, 12.2, 11.5, 12.7);
  // Lamps under the ceiling (visual).
  for (const [x, z] of [[-11, -9.5], [0, -9.5], [11, -9.5], [-12, -3], [-12, 3], [12, -3], [12, 3], [-11, 9.5], [0, 10], [11, 9.5], [0, -5.3], [0, 5.3], [-6.2, 0], [6.2, 0]]) {
    K.box(M.metalBright || M.iron, x - 0.3, H - 0.08, z - 0.12, x + 0.3, H - 0.02, z + 0.12, { d: true, gao: false });
  }
  // Outside: sandbag cover by the main door, a parked cart, the approach.
  for (const [x, z] of [[-4, 19], [4.5, 21], [-9, 24]]) {
    K.box(K.L.burlap, x - 1.6, 0, z - 0.4, x + 1.6, 1.0, z + 0.4, { tint: SAND, col: true, gao: false });
    navs.push([x, 0, z + 1.6], [x, 0, z - 1.6]);
  }
  K.cart(-12, 18, 0, 1, {});
  // Nav: dense grid inside (2.2 m) + the door points above.
  ctx.navRect(-X + 1, -Z + 1, X - 1, Z - 1, 0.05, 2.2);
  ctx.navPts(navs);
  // Robots start in the rooms and the corridor.
  ctx.spawnsLocal([[-13, -9.5], [-2, -9.5], [3.5, -11], [10, -11.5], [14.5, -11], [-12, -2.5], [-14.5, 2.5], [12, -2], [14, 3],
    [-13, 11], [-9, 11.5], [11, 11], [14.5, 9], [0, -5.3], [0, 5.3], [-6.2, 2.5], [6.2, -2.5], [2, 1.8], [-3, -1.5], [9, 8.5]]);
  ctx.enemy = { x: 0, z: 0, r: 20 };
  ctx.arena = { playerSpawn: K.V(0, 0.05, 25), center: K.V(0, 0, 0) };
}
