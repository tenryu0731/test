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

const SAND = [0.93, 0.86, 0.66], EARTH = [0.75, 0.62, 0.46];

// ------------------------------------------------------------------ trenches
export function buildTrenches(K, ctx) {
  const M = K.M, L = K.L, R = ctx.R;
  const soil = L.soil, sandbag = L.straw, wood = M.wood;
  const navs = [], spawns = [];

  // One trench line along x at depth zc, `front` = −1 (parapet toward −z) or +1.
  // Bays of 9 m alternate their centre line by ±1.4 m (the zig-zag that limits blast and enfilade).
  function trench(zc, front, own) {
    const W = 2.2, PH = 1.1, SB = 0.28, BH = 1.0;      // corridor width, parapet earth (+ sandbags = 1.38 m), parados
    const x0 = -54, bay = 9;
    for (let i = 0; x0 + i * bay < 54; i++) {
      const a = x0 + i * bay, b = Math.min(54, a + bay), off = (i % 2 ? 0.5 : -0.5);   // ±0.5: the bays still overlap by 1.2 m
      const z = zc + off;
      const zf = z + front * W / 2, zb = z - front * W / 2;       // front / back edge of the corridor
      // Parapet: earth core + sloped glacis toward the enemy + a row of sandbags on top.
      const pz0 = Math.min(zf, zf + front * 1.4), pz1 = Math.max(zf, zf + front * 1.4);
      K.box(soil, a, -0.3, pz0, b, PH, pz1, { tint: EARTH, col: true, gao: false });
      K.quad(soil, [a, PH, zf + front * 1.4], [b, PH, zf + front * 1.4], [b, 0, zf + front * 4.4], [a, 0, zf + front * 4.4],
        [0, 1, front], { tint: EARTH, gao: false });
      for (let x = a + 0.3; x < b - 0.2; x += 0.62) {
        K.box(sandbag, x - 0.29, PH, zf + front * 0.08, x + 0.29, PH + SB, zf + front * 0.62, { tint: SAND.map((v) => v * (0.9 + R() * 0.15)), gao: false });
      }
      K.col(a, PH, Math.min(zf, zf + front * 0.7), b, PH + SB, Math.max(zf, zf + front * 0.7));
      // Timber revetment on the corridor face of the parapet.
      K.box(wood, a, 0, Math.min(zf, zf + front * 0.06), b, PH, Math.max(zf, zf + front * 0.06), { tint: 0.7, gao: false });
      for (let x = a + 0.8; x < b; x += 1.8) K.box(wood, x - 0.07, 0, Math.min(zf, zf - front * 0.14), x + 0.07, PH + 0.1, Math.max(zf, zf - front * 0.14), { tint: 0.6, d: true });
      // Parados (rear wall), lower.
      const qz0 = Math.min(zb, zb - front * 1.2), qz1 = Math.max(zb, zb - front * 1.2);
      K.box(soil, a, -0.3, qz0, b, BH, qz1, { tint: EARTH.map((v) => v * 0.92), col: true, gao: false });
      // Duckboards on the floor.
      K.box(wood, a + 0.05, 0.0, Math.min(zf, zb) + 0.35, b - 0.05, 0.06, Math.max(zf, zb) - 0.35, { tint: 0.55, gao: false, cast: false });
      // Bay ends: short traverse walls where the zig-zag steps (leave a 1.2 m passage).
      if (i > 0) {
        const pz = zc - off;            // previous bay centre
        const zlo = Math.min(z, pz) - W / 2, zhi = Math.max(z, pz) + W / 2;
        void zlo; void zhi;
      }
      for (let k = 0; k < 3; k++) navs.push([a + (k + 0.5) * (b - a) / 3, 0.06, z]);
      // Exit steps over the parapet in every other bay (sandbag stairs, 0.35 m risers).
      if (i % 2 === 0) {
        const sx = (a + b) / 2 + (R() - 0.5) * 2;
        // Highest step against the parapet face, lowest toward the back of the corridor.
        for (let s = 0; s < 4; s++) {
          const y1 = 0.35 * (s + 1), zc2 = zf - front * (0.22 + (3 - s) * 0.45);
          K.box(sandbag, sx - 0.7, 0, zc2 - 0.22, sx + 0.7, y1, zc2 + 0.22, { tint: SAND, col: true, gao: false });
        }
        navs.push([sx, 0.35, zf - front * 1.5], [sx, 1.4, zf - front * 0.22], [sx, 1.48, zf + front * 0.5], [sx, 0.3, zf + front * 3.2]);
      }
      if (own) spawns.push(); else if (i % 2 === 1) spawns.push([(a + b) / 2, z]);
    }
    // Close the trench ends.
    for (const ex of [-54.6, 54.6]) K.box(soil, ex - 0.6, -0.3, zc - 4.2, ex + 0.6, 1.2, zc + 4.2, { tint: EARTH, col: true, gao: false });
    // Dugout behind the centre bay: timber frame, earth-covered roof, sandbag walls.
    {
      const dz = zc - front * 4.6, dx = own ? -18 : 18;
      const z0 = Math.min(dz, dz - front * 4), z1 = Math.max(dz, dz - front * 4);
      K.box(sandbag, dx - 3.2, 0, z0, dx - 2.8, 2.2, z1, { tint: SAND, col: true, gao: false });
      K.box(sandbag, dx + 2.8, 0, z0, dx + 3.2, 2.2, z1, { tint: SAND, col: true, gao: false });
      K.box(sandbag, dx - 3.2, 0, front > 0 ? z0 : z1 - 0.4, dx + 3.2, 2.2, front > 0 ? z0 + 0.4 : z1, { tint: SAND, col: true, gao: false });
      K.box(wood, dx - 3.4, 2.2, z0 - 0.2, dx + 3.4, 2.45, z1 + 0.2, { tint: 0.55, col: true });
      K.box(soil, dx - 3.6, 2.45, z0 - 0.4, dx + 3.6, 2.9, z1 + 0.4, { tint: EARTH, gao: false });
      for (let k = 0; k < 3; k++) K.box(wood, dx - 1.5 + k * 1.5 - 0.6, 0, dz - front * (2.2 + (k % 2) * 0.8) - 0.4, dx - 1.5 + k * 1.5 + 0.2, 0.5 + (k % 2) * 0.35, dz - front * (2.2 + (k % 2) * 0.8) + 0.4, { tint: 0.65, col: true, d: true });
      navs.push([dx, 0.05, dz - front * 2]);
    }
  }
  trench(44, -1, true);        // friendly line: parapet faces north (−z)
  trench(-44, 1, false);       // enemy line: parapet faces south (+z)

  // No-man's-land: craters (low rims), stumps, a ruined farmhouse, barbed wire belts.
  for (let k = 0; k < 22; k++) {
    const x = (R() - 0.5) * 100, z = (R() - 0.5) * 52, r = 1.6 + R() * 2.4;
    if (Math.abs(x) < 9 && Math.abs(z) < 7) continue;
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      K.blob(soil, px, 0, pz, 0.9 + R() * 0.5, 0.35 + R() * 0.25, 0.9 + R() * 0.5, { tint: EARTH.map((v) => v * (0.85 + R() * 0.2)), rot: R() * 3, detail: 0 });
    }
    K.box(soil, x - r * 0.6, -0.01, z - r * 0.6, x + r * 0.6, 0.02, z + r * 0.6, { tint: EARTH.map((v) => v * 0.55), gao: false, cast: false });
    if (r > 2.8) K.col(x - r - 0.5, 0, z - 0.8, x - r + 0.9, 0.55, z + 0.8);
  }
  for (const [x, z] of [[-30, 8], [22, -14], [40, 12], [-12, -20]]) {
    K.cyl(wood, x, 0, z, 0.28, 1.8 + R() * 1.5, 7, { tint: 0.45 });
    K.col(x - 0.3, 0, z - 0.3, x + 0.3, 2.5, z + 0.3);
  }
  // Ruined farmhouse in the middle: broken stone walls to fight around.
  {
    const S = M.stone, t = [0.95, 0.9, 0.82];
    const wall = (x0, z0, x1, z1, h) => K.box(S, x0, 0, z0, x1, h, z1, { tint: t, col: true });
    wall(-8, -6, -1.5, -5.4, 3.2); wall(1.5, -6, 8, -5.4, 2.1);
    wall(-8, -6, -7.4, 1, 2.6); wall(-8, 3.4, -7.4, 6, 1.4);
    wall(7.4, -6, 8, -1.5, 3.0); wall(7.4, 2, 8, 6, 1.1);
    wall(-8, 5.4, -3, 6, 1.6); wall(2.5, 5.4, 8, 6, 2.4);
    for (let k = 0; k < 14; k++) K.box(S, -7 + R() * 14 - 0.3, 0, -5 + R() * 10 - 0.3, -7 + R() * 14 + 0.3, 0.3 + R() * 0.4, -5 + R() * 10 + 0.3, { tint: t, d: true });
    K.box(wood, -6, 2.3, -5.5, 6, 2.5, -5.2, { tint: 0.4, d: true });
    navs.push([0, 0, 0], [-4, 0, 2], [4, 0, -2], [0, 0, 8], [0, 0, -8]);
  }
  // Barbed-wire belts in front of both lines: pickets and three strands, gaps every ~14 m.
  for (const zw of [30, -30]) {
    for (let x = -50; x < 50; x += 14) {
      const a = x + 1.5, b = x + 11;
      for (let px = a; px <= b + 0.01; px += 2.4) K.box(M.iron, px - 0.04, 0, zw - 0.04, px + 0.04, 1.2, zw + 0.04, { d: true, tint: 0.5 });
      for (const y of [0.35, 0.7, 1.05]) K.beam(M.iron, [a, y, zw + (R() - 0.5) * 0.2], [b, y + 0.05, zw + (R() - 0.5) * 0.2], 0.02, 0.02, { d: true, tint: 0.45 });
      K.col(a, 0, zw - 0.3, b, 1.3, zw + 0.3);
    }
  }
  // Sandbag fighting positions in no-man's-land.
  for (const [x, z, rot] of [[-38, 12, 0], [30, -10, 1], [-20, -16, 0], [44, 18, 1]]) {
    const w = 2.6;
    K.box(sandbag, x - w, 0, z - 0.4, x + w, 1.1, z + 0.4, { tint: SAND, col: true, gao: false });
    void rot;
    navs.push([x, 0, z + 2], [x, 0, z - 2]);
  }
  // Nav: open ground on a 5 m grid (the default pad grid) + trench corridors + gaps.
  ctx.navPts(navs);
  ctx.spawnsLocal(spawns.concat([[-30, -47], [30, -47], [0, -47]]));
  ctx.enemy = { x: 0, z: -44, r: 60 };
  ctx.arena = { playerSpawn: K.V(-4.5, 0.06, 44.5), center: K.V(0, 0, 0), front: -1 };  // centre of a friendly bay without exit steps
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
    K.box(K.L.straw, x - 1.6, 0, z - 0.4, x + 1.6, 1.0, z + 0.4, { tint: SAND, col: true, gao: false });
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
