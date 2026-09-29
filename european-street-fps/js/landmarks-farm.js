// Poderi (Tuscan farmsteads) in three different arrangements, and the travertine quarry.
// Farm components are built in their own frames (front = local +z) and composed per site:
// casa colonica with external stair and first-floor loggia, dovecote (on the roof or as a
// tower), barn with brick lattice screens, threshing floor, pergola, haystacks, cart, well…
import * as THREE from 'three';
import { T_cone } from './landmarks-geo.js';

// Two-storey farmhouse centred on the frame origin, x ∈ [-w/2, w/2], z ∈ [-d/2, d/2].
function farmhouse(K, ctx, o) {
  const M = K.M, T = M.stoneTrim, wall = o.wall, tint = o.tint ?? 1, w = o.w ?? 14, d = o.d ?? 9, H = o.H ?? 7.2;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, F1 = 3.4;
  const wo = { tint, top: H, uvOff: o.uvOff };
  const shut = o.shut ?? 0;
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(x0, x1, z0, z1, dir), ops = [];
    const n = Math.max(1, Math.round(f.W / 3.3));
    for (let i = 0; i < n; i++) {
      const t = (f.W / n) * (i + 0.5);
      const lower = dir === 'S' && i === n - 1 ? { t0: t - 0.6, t1: t + 0.6, y0: 0, y1: 2.3, fill: 'door', frame: true }
        : dir === 'S' && i === 1 ? { t0: t - 1.0, t1: t + 1.0, y0: 0, y1: 2.4, arch: true, fill: 'door', ring: true }
          : { t0: t - 0.36, t1: t + 0.36, y0: 1.2, y1: 2.2, fill: dir === 'N' ? 'grille' : 'glass', frame: true, shutters: dir === 'N' ? undefined : shut };
      // Upper floor: no window where the loggia door opens (left end of the front).
      if (!(dir === 'S' && i === 0)) ops.push(lower);
      ops.push(dir === 'S' && i === 0 ? { t0: t - 0.55, t1: t + 0.55, y0: F1 + 0.05, y1: F1 + 2.3, fill: 'door', frame: true }
        : { t0: t - 0.42, t1: t + 0.42, y0: F1 + 0.9, y1: F1 + 2.2, fill: 'glass', frame: true, shutters: shut });
    }
    K.wall(f, -2.5, H, -0.6, 0, wall, ops, wo);
    if (o.quoins) for (let y = 0, k = 0; y < H - 0.3; y += 0.5, k++) {
      const e = k % 2 ? 0.4 : 0.7;
      K.fbox(f, T, -0.03, e, y, y + 0.46, -0.1, 0.04, { gao: y < 1, tint: 0.92 });
    }
    if (o.plinth) K.fbox(f, M.stone, -0.05, f.W + 0.05, -1, 0.7, -0.1, 0.08, {});
  }
  K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.32, ov: 0.6, wall, wallTint: tint, hip: !!o.hip });
  K.col(x0, -2.5, z0, x1, H, z1);
  // Loggia on the front-left: arch below, open upper floor on brick pillars, lean-to roof.
  const lx0 = x0, lx1 = x0 + 4.2, lz0 = z1, lz1 = z1 + 3.2;
  const lf = K.face(lx0, lx1, lz0, lz1, 'S');
  K.wall(lf, -2.5, F1, -0.6, 0, wall, [{ t0: 0.9, t1: 3.3, y0: 0, y1: 1.9, arch: true, fill: 'dark', ring: !!o.quoins }], { tint });
  K.wall(K.face(lx0, lx1, lz0, lz1, 'W'), -2.5, F1, -0.6, 0, wall, [], { tint });
  K.wall(K.face(lx0, lx1, lz0, lz1, 'E'), -2.5, F1, -0.6, 0, wall, [], { tint });
  K.box(M.herringbone, lx0 + 0.1, F1 - 0.05, lz0, lx1 - 0.1, F1 + 0.05, lz1 - 0.1, { gao: false });
  for (const [px, pz] of [[lx0 + 0.3, lz1 - 0.3], [lx1 - 0.3, lz1 - 0.3]]) { K.box(M.brick, px - 0.28, F1, pz - 0.28, px + 0.28, H - 0.8, pz + 0.28, { col: true }); }
  K.box(M.brick, lx0 + 0.6, F1, lz1 - 0.5, lx1 - 0.6, F1 + 0.95, lz1 - 0.1, { col: true });
  K.box(M.brick, lx0, F1, lz0, lx0 + 0.5, F1 + 0.95, lz1 - 0.6, { col: true });
  K.lean(lx0, lx1, lz0, lz1, H - 0.9, H - 0.2, 'S', { ov: 0.4, wall });
  K.col(lx0, -2.5, lz0, lx1, F1, lz1);
  // External stone stair along the front, rising toward the loggia (−x).
  const n = 12, rise = F1 / n, run = 0.36, sx = lx1 + n * run;
  K.stair(sx, z1 + 0.7, 1.2, 'W', n, rise, run, M.stone, 0, { tint: tint });
  K.box(M.stone, lx1, -0.2, z1 + 1.3, sx, 0.2, z1 + 1.55, { tint });
  K.beam(T, [sx, 1.0, z1 + 1.42], [lx1, F1 + 0.9, z1 + 1.42], 0.3, 0.2);
  K.col(lx1, 0, z1 + 1.3, sx, F1 * 0.5, z1 + 1.55);
  // Chimneys and an outdoor bread oven against the east gable.
  K.box(M.brick, x1 - 3, H - 0.5, -0.6, x1 - 2.1, H + 2.8, 0.3, {});
  K.box(M.roof, x1 - 3.15, H + 2.8, -0.75, x1 - 1.95, H + 2.95, 0.45, { gao: false });
  K.box(wall, x1, -0.5, -2.2, x1 + 1.8, 1.4, 0.8, { tint, col: true });
  K.halfTube(M.brick, [x1, 1.4, -0.7], [x1 + 1.8, 1.4, -0.7], 0.95, {}, 6);
  if (o.roofDovecote) dovecote(K, -1.8, -1.8, 3.6, H - 0.5, H + 4.4, { wall, tint, pitchOnly: true });
  return { F1, H };
}

// Dovecote: square tower with pigeon holes, ledge and pyramid roof. From y0 to y1 (roof above).
function dovecote(K, x0, z0, w, y0, y1, o = {}) {
  const M = K.M, T = M.stoneTrim, wall = o.wall || M.stone, x1 = x0 + w, z1 = z0 + w;
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(x0, x1, z0, z1, dir);
    const ops = [];
    for (let i = 0; i < 3; i++) ops.push({ t0: 0.6 + i * (w - 1.2) / 2 - 0.13, t1: 0.6 + i * (w - 1.2) / 2 + 0.13, y0: y1 - 1.4, y1: y1 - 1.0, arch: true, fill: 'dark', archTop: 0.05 });
    if (!o.pitchOnly && dir === 'S') ops.push({ t0: w / 2 - 0.5, t1: w / 2 + 0.5, y0: y0, y1: y0 + 2.1, fill: 'door', frame: true });
    if (!o.pitchOnly) ops.push({ t0: w / 2 - 0.3, t1: w / 2 + 0.3, y0: y0 + 4.5, y1: y0 + 5.4, fill: 'glass', frame: true });
    K.wall(f, o.pitchOnly ? y0 : y0 - 2.5, y1, -0.45, 0, wall, ops, { tint: o.tint ?? 1, gao: !o.pitchOnly, gy: 0 });
    K.fbox(f, T, -0.12, w + 0.12, y1 - 2.0, y1 - 1.85, -0.1, 0.25, { gao: false });   // ledge keeps rats out
    K.fbox(f, M.brick, -0.08, w + 0.08, y1 - 0.3, y1, -0.1, 0.14, { gao: false });
  }
  K.pyramid(x0, x1, z0, z1, y1, w * 0.42, { ov: 0.45 });
  K.col(x0, o.pitchOnly ? y0 : y0 - 2.5, z0, x1, y1, z1);
}

// Barn (fienile): stone ground floor with brick-pier open front, brick lattice screens above.
function barn(K, ctx, o = {}) {
  const M = K.M, w = o.w ?? 13, d = o.d ?? 8, H = o.H ?? 6.4, x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, S = o.wall || M.stone, tint = o.tint ?? 1;
  for (const dir of ['N', 'E', 'W']) K.wall(K.face(x0, x1, z0, z1, dir), -2.5, H, -0.5, 0, S, dir === 'N' ? [] : [{ t0: d / 2 - 0.7, t1: d / 2 + 0.7, y0: 3.4, y1: 4.8, fill: 'dark', frame: false }], { tint, top: H });
  // Front: 3 brick piers, open bays below, lattice screens above.
  const f = K.face(x0, x1, z0, z1, 'S'), bays = 3, bw = w / bays;
  for (let i = 0; i <= bays; i++) {
    const t = i * bw;
    K.fbox(f, M.brick, Math.max(0, t - 0.35), Math.min(w, t + 0.35), -1, H, -0.6, 0, { col: true });
  }
  K.fbox(f, M.brick, 0, w, 2.9, 3.3, -0.6, 0, { gao: false });
  for (let i = 0; i < bays; i++) {
    const t0 = i * bw + 0.35, t1 = (i + 1) * bw - 0.35;
    // Mandolato: diamond brick lattice (dark backing + brick grid).
    K.fquad(f, M.stone, t0, t1, 3.3, H - 0.15, -0.45, { tint: 0.08, gao: false });
    const nx = Math.round((t1 - t0) / 0.42), ny = Math.round((H - 3.45) / 0.3);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      if ((r + c) % 2) continue;
      const tc = t0 + (c + 0.5) * (t1 - t0) / nx, yc = 3.3 + (r + 0.5) * (H - 3.45) / ny;
      K.fbox(f, M.brick, tc - 0.2, tc + 0.2, yc - 0.14, yc + 0.14, -0.3, -0.05, { gao: false, d: r > 1 });
    }
    // Interior shadow and hay inside the open bay.
    K.fquad(f, M.stone, t0, t1, 0, 2.9, -o.depthIn || -6, { tint: 0.1, gao: false });
    K.box(ctx.L.straw, x0 + t0 + 0.2, 0, z0 + 1.2, x0 + t1 - 0.2, 1.4 + (i % 2) * 0.8, z1 - 3.5, { tint: 0.75, gao: false });
  }
  K.box(M.stone, x0 + 0.4, 0, z0 + 0.4, x1 - 0.4, 2.9, z0 + 0.6, { tint: 0.25 });
  K.box(M.stone, x0 + 0.4, 2.9, z0 + 0.4, x1 - 0.4, 3.0, z1 - 0.6, { tint: 0.3, gao: false });
  K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.3, ov: 0.6, wall: S, wallTint: tint });
  K.col(x0, -2.5, z0, x1, H, z0 + 0.6); K.col(x0, -2.5, z0, x0 + 0.5, H, z1); K.col(x1 - 0.5, -2.5, z0, x1, H, z1);
  K.col(x0, 2.9, z0, x1, H, z1);
}

// Threshing floor (aia): herringbone brick paving with a stone kerb.
function aia(K, x0, z0, x1, z1) {
  const M = K.M;
  K.box(M.herringbone, x0, -0.2, z0, x1, 0.06, z1, { tint: [1.0, 0.95, 0.9], gao: false, cast: false });
  for (const [a, b, c, d] of [[x0 - 0.25, z0 - 0.25, x1 + 0.25, z0], [x0 - 0.25, z1, x1 + 0.25, z1 + 0.25], [x0 - 0.25, z0, x0, z1], [x1, z0, x1 + 0.25, z1]]) K.box(M.stoneTrim, a, -0.2, b, c, 0.12, d, { gao: false });
}

const FARMS = {
  // Pieve side: stone house with the dovecote rising from its roof, barn to the east, pergola.
  'farm-w': { rot: 2, mir: false, house: { x: -4, z: -14, wall: 'stone', roofDovecote: true, quoins: true }, barn: { x: 16, z: -12, rot: 0 }, tower: null, aia: [-12, -5, 6, 4], stacks: [[16, 6], [22, 4], [21, 11]], cart: [10, -2, 1], well: [-14, 8], pergola: [-16, -24, -4, -20.5], olive: [[-26, 10], [-28, 20], [-20, 22], [26, -20]], cyp: [[-10, -26], [2, -27], [30, 0]] },
  // East road: ochre plastered house north of the road, separate dovecote tower, barn west.
  'farm-e': { rot: 0, mir: false, house: { x: 14, z: -20, wall: 'plaster', plaster: 0, quoins: false, plinth: true }, barn: { x: 31, z: -17, rot: 3 }, tower: [-0.5, -30, 4.2, 11.5], aia: [6, -13, 22, -7], stacks: [[16, 18], [22, 22], [18, 28]], cart: [3, -12, 0], well: [24, -9], pergola: [8, -31, 20, -27.5], olive: [[-12, 20], [-20, 26], [-4, 30], [30, 30]], cyp: [[-4, -12], [34, -6], [40, -2]] },
  // North road end: stone-and-brick house, barn across the aia, corner dovecote tower.
  'farm-n': { rot: 0, mir: true, house: { x: -6, z: -16, wall: 'stone', quoins: true, hip: true }, barn: { x: 17, z: -3, rot: 1 }, tower: [-17, -25, 3.8, 12], aia: [-10, -7, 6, 3], stacks: [[-20, 6], [-24, 12], [-18, 14]], cart: [8, 10, 2], well: [8, 6], pergola: [-12, -27, 0, -23.5], olive: [[20, 22], [26, 16], [-28, -6], [30, -18]], cyp: [[-14, 20], [10, 22], [-30, 6]] },
};

export function buildFarm(K0, ctx) {
  const M = K0.M, R = ctx.R, cfg = FARMS[ctx.s.id] || FARMS['farm-w'];
  const K = K0.frame(0, 0, cfg.rot, cfg.mir);
  const wallOf = (h) => (h.wall === 'plaster' ? M.plaster[h.plaster ?? 0] : M.stone);
  const hTint = cfg.house.wall === 'plaster' ? [1.0, 0.98, 0.95] : [1.0, 0.95, 0.88];
  const HK = K.frame(cfg.house.x, cfg.house.z, 0);
  farmhouse(HK, ctx, { wall: wallOf(cfg.house), tint: hTint, quoins: cfg.house.quoins, plinth: cfg.house.plinth, roofDovecote: cfg.house.roofDovecote, hip: cfg.house.hip, shut: cfg.house.wall === 'plaster' ? 0 : 2, uvOff: [R() * 3, R() * 3] });
  barn(K.frame(cfg.barn.x, cfg.barn.z, cfg.barn.rot), ctx, { tint: [0.98, 0.94, 0.88] });
  if (cfg.tower) {
    const [tx, tz, w, h] = cfg.tower;
    dovecote(K, tx, tz, w, 0, h, { wall: cfg.house.wall === 'plaster' ? M.plaster[cfg.house.plaster ?? 0] : M.stone, tint: hTint });
  }
  aia(K, ...cfg.aia);
  for (const [x, z] of cfg.stacks) K.haystack(x, z, 4 + R() * 0.8, 2.0 + R() * 0.3);
  K.cart(cfg.cart[0], cfg.cart[1], 0, cfg.cart[2], { load: R() < 0.5 ? 'hay' : 'barrels' });
  K.well(cfg.well[0], cfg.well[1]);
  const [px0, pz0, px1, pz1] = cfg.pergola;
  K.pergola(px0, pz0, px1, pz1, 2.5);
  K.box(M.wood, (px0 + px1) / 2 - 1.2, 0, (pz0 + pz1) / 2 - 0.5, (px0 + px1) / 2 + 1.2, 0.78, (pz0 + pz1) / 2 + 0.5, { d: true, col: true });
  for (const [x, z] of cfg.olive) if (ctx.roadClear(K.wx(x, z) - K0.tx, K.wz(x, z) - K0.tz, 2)) K.tree(x, z, 4.2, 2.1, 0, { tint: [0.72, 0.76, 0.64] });
  for (const [x, z] of cfg.cyp) if (ctx.roadClear(K.wx(x, z) - K0.tx, K.wz(x, z) - K0.tz, 2)) K.cypress(x, z, 11 + R() * 3, 1.0);
  K.woodpile(cfg.house.x + 9.5, cfg.house.z - 3, 3.2, 0, 1);
  for (let i = 0; i < 3; i++) K.barrel(cfg.barn.x - 5 + i * 0.8, cfg.barn.z + 6.5, 0);
  // A small vegetable garden with a pomegranate and a fig beside the house.
  const gx = cfg.house.x - 13, gz = cfg.house.z - 2;
  K.box(ctx.L.soil, gx - 3, -0.1, gz - 4, gx + 3, 0.12, gz + 4, { gao: false, cast: false });
  for (let r = 0; r < 5; r++) K.box(M.plant, gx - 2.6, 0.1, gz - 3.4 + r * 1.6, gx + 2.6, 0.45, gz - 3.0 + r * 1.6, { tint: [0.85, 1.0, 0.65], gao: false, d: true });
  K.tree(gx + 4.5, gz + 5, 3.8, 1.8, 0, { tint: [0.7, 0.84, 0.55] });
  const sp = [[cfg.aia[0] + 3, (cfg.aia[1] + cfg.aia[3]) / 2], [cfg.aia[2] - 3, (cfg.aia[1] + cfg.aia[3]) / 2], [cfg.well[0] + 3, cfg.well[1] + 3], [cfg.stacks[0][0] - 4, cfg.stacks[0][1] - 4], [0, 14], [-18, -4]];
  for (const [x, z] of sp) ctx.spawns.push(K.V(x, 0, z));
  const c = [(cfg.aia[0] + cfg.aia[2]) / 2, (cfg.aia[1] + cfg.aia[3]) / 2];
  ctx.enemy = { x: K.wx(...c) - K0.tx, z: K.wz(...c) - K0.tz, r: 26 };
}

// ------------------------------------------------------------------ QUARRY
export function buildQuarry(K, ctx) {
  const M = K.M, R = ctx.R, T = M.stoneTrim, S = M.stone;
  const trav = [1.1, 1.05, 0.9], rough = [0.95, 0.9, 0.8];
  // Terraced cut faces wrap the north and east sides of the quarry floor (road arrives from SW).
  // Each bench: a vertical travertine face `bh` high, set back `step`; bench ends step down too.
  const benches = 3, bh = 3.6, step = 5.5, fx = 14, fz = -16, OX = 40, OZ = -40;
  for (let b = 0; b < benches; b++) {
    const y0 = b * bh, y1 = (b + 1) * bh, ex = fx + b * step, ez = fz - b * step;
    const zEnd = 24 - b * 7, xStart = -38 + b * 7;
    const parts = [[ex, OZ, OX, zEnd], [xStart, OZ, ex, ez]];
    for (const [x0, z0, x1, z1] of parts) {
      K.box(T, x0, y0 - (b === 0 ? 6 : 0.01), z0, x1, y1, z1, { tint: trav.map((v) => v * (0.93 + R() * 0.1)), uvOff: [R() * 2, R() * 2], col: true, gy: y0 });
      K.box(S, x0 + 0.3, y1, z0, x1, y1 + 0.2, z1 - 0.3, { tint: rough, gao: false });
    }
    // Saw-cut grooves on the faces (detail).
    for (let k = 0; k < 14; k++) {
      const onEast = R() < 0.5, t = R(), yj = y0 + 0.5 + R() * (bh - 1);
      if (onEast) { const z = OZ + 4 + t * (zEnd - OZ - 8); K.box(S, ex - 0.03, yj, z, ex + 0.01, yj + 0.06, z + 3 + R() * 3, { tint: 0.35, gao: false, d: true }); }
      else { const x = xStart + 2 + t * (ex - xStart - 7); K.box(S, x, yj, ez - 0.01, x + 3 + R() * 3, yj + 0.06, ez + 0.03, { tint: 0.35, gao: false, d: true }); }
    }
    for (let k = 0; k < 5; k++) {
      const onEast = k % 2 === 0;
      const x = onEast ? ex + 1.5 + R() * (step - 2) : xStart + 3 + R() * (ex - xStart - 6), z = onEast ? OZ + 6 + R() * (zEnd - OZ - 10) : ez - 1.5 - R() * (step - 2);
      if (b === benches - 1) K.tree(x, z, 3.5, 1.6, y1 + 0.2, { tint: [0.66, 0.74, 0.52] });
      else K.blob(M.plant, x, y1 + 0.4, z, 0.8 + R() * 0.6, 0.5, 0.8, { tint: [0.7, 0.78, 0.55], d: true });
    }
  }
  // Skirt: the hill the quarry is cut into falls from the top bench edge to the real terrain.
  {
    const top = benches * bh + 0.2, zE = 24 - (benches - 1) * 7, xS = -38 + (benches - 1) * 7;
    const edge = [];
    void zE; void xS;
    for (let z = 24; z > OZ; z -= 3.5) edge.push([OX, z, 1, 0]);
    edge.push([OX, OZ, 0.7071, -0.7071]);
    for (let x = OX - 3.5; x >= -38; x -= 3.5) edge.push([x, OZ, 0, -1]);
    const topAt = (x, z) => { let t = 0; for (let b = 0; b < benches; b++) if (z <= 24 - b * 7 + 0.01 && x >= -38 + b * 7 - 0.01) t = (b + 1) * bh + 0.2; return t; };
    const skirt = edge.map(([x, z, nx, nz]) => {
      const top = topAt(x, z);
      let L = 6, gx = 0, gz = 0, g = 0;
      for (let k = 0; k < 6; k++) { gx = x + nx * L; gz = z + nz * L; g = ctx.groundLocal(gx, gz); L = Math.max(4, Math.min(40, (top - g) * 1.3)); }
      return [[x, top, z], [x + nx * L, Math.min(top, g) - 0.8, z + nz * L]];
    });
    for (let i = 0; i < skirt.length - 1; i++) {
      const [a0, a1] = skirt[i], [b0, b1] = skirt[i + 1];
      K.quad(S, a0, b0, b1, a1, [skirt[i][1][0] - a0[0], 1, skirt[i][1][2] - a0[2]], { tint: [0.72, 0.74, 0.58], gao: false });
      if (i % 2 === 0) K.blob(M.plant, (a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2 + 0.3, (a0[2] + a1[2]) / 2, 1.4, 0.7, 1.4, { tint: [0.62, 0.72, 0.5], d: false, detail: 0 });
    }
  }
  // Haul ramp from the quarry floor up to the first bench along the east face (walkable).
  {
    const x = fx, n = 16;
    for (let i = 0; i < n; i++) {
      const z = 20 - i * 1.25, yt = ((i + 1) * bh) / n;
      K.box(S, x - 2, -0.5, z - 1.25, x + 0.02, yt, z, { tint: rough, col: true });
    }
    ctx.navPts([[x - 1, 1, 12], [x - 1, 2.5, 6], [x - 1, 4, 0.5]]);
  }
  // Stacked cut blocks, a block on rollers, spoil heap.
  const block = (x, z, y, w, h, d, t = 1) => K.box(T, x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { tint: trav.map((v) => v * t), uvOff: [R() * 3, R() * 3], col: true, gy: 0 });
  for (const [bx, bz, rows] of [[-18, 8, 3], [-24, 0, 2], [-8, 20, 2], [2, -6, 3], [-30, 12, 1]]) {
    for (let r = 0; r < rows; r++) for (let i = 0; i < 3 - r; i++) block(bx + (i - (2 - r) / 2) * 2.3, bz + (R() - 0.5) * 0.3, r * 1.2, 2.1, 1.15, 1.4, 0.9 + R() * 0.15);
  }
  block(6, 6, 0.3, 3.2, 1.6, 1.8, 1.05);
  for (let k = 0; k < 3; k++) K.tplM(M.wood, cylX(), new THREE.Matrix4().makeTranslation(4.4 + k * 1.4, 0.15, 6).multiply(new THREE.Matrix4().makeScale(1, 0.15, 0.15)), { d: true });
  for (let i = 0; i < 60; i++) {
    const a = R() * 3.14, rr = R() * 6, x = -34 + Math.cos(a) * rr, z = -12 + Math.sin(a) * rr * 0.7, s = 0.2 + R() * 0.35;
    const y = Math.max(0, 2.6 - rr * 0.45);
    K.box(T, x - s, y - s, z - s, x + s, y + s * 0.6, z + s, { tint: trav.map((v) => v * (0.85 + R() * 0.2)), d: i > 25, gao: false });
  }
  K.tpl(T, T_cone(10), -34, -0.2, -12, 6, 2.8, 4.2, 0, { tint: [1.0, 0.95, 0.82], col: false });
  K.col(-38, -0.2, -15, -30, 1.8, -9);
  // Wooden derrick crane: mast with guy ropes, luffing boom, winch.
  {
    const cx = -4, cz = -4, mh = 13;
    K.box(T, cx - 1.2, 0, cz - 1.2, cx + 1.2, 0.6, cz + 1.2, { col: true });
    K.beam(M.wood, [cx, 0.6, cz], [cx, mh, cz], 0.36, 0.36);
    K.beam(M.wood, [cx, 1.2, cz], [cx + 7.5, 9.5, cz + 5.5], 0.26, 0.26);
    K.beam(M.wood, [cx, mh - 0.3, cz], [cx + 7.5, 9.5, cz + 5.5], 0.05, 0.05, { d: true });
    for (const [gx, gz] of [[-14, -10], [8, -14], [-10, 10]]) {
      K.beam(M.wood, [cx, mh - 0.2, cz], [cx + gx, 0, cz + gz], 0.04, 0.04, { d: true, tint: 0.6 });
      K.box(M.wood, cx + gx - 0.15, 0, cz + gz - 0.15, cx + gx + 0.15, 0.6, cz + gz + 0.15, { d: true });
    }
    K.beam(M.wood, [cx + 7.5, 9.5, cz + 5.5], [cx + 7.5, 3.2, cz + 5.5], 0.04, 0.04, { d: true, tint: 0.6 });
    K.box(M.iron, cx + 7.3, 2.8, cz + 5.3, cx + 7.7, 3.2, cz + 5.7, { d: true });
    block(cx + 7.5, cz + 5.5, 0, 1.8, 1.0, 1.2, 1.0);
    // Winch.
    K.box(M.wood, cx + 1.2, 0, cz - 0.9, cx + 1.4, 1.2, cz - 0.7, {}); K.box(M.wood, cx + 1.2, 0, cz + 0.7, cx + 1.4, 1.2, cz + 0.9, {});
    K.tplM(M.wood, cylX(), new THREE.Matrix4().makeTranslation(cx + 1.3, 1.0, cz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-0.85, 0, 0)).multiply(new THREE.Matrix4().makeScale(1.7, 0.22, 0.22)), { d: true, tint: 0.8 });
    K.col(cx - 0.3, 0, cz - 0.3, cx + 0.3, mh, cz + 0.3);
  }
  // Shed (capanno) with tools, and the cart track: two worn ruts into the quarry floor.
  {
    const x0 = -30, x1 = -22, z0 = 22, z1 = 27;
    for (const dir of ['N', 'E', 'W']) K.wall(K.face(x0, x1, z0, z1, dir), -1, 3.2, -0.4, 0, S, dir === 'E' ? [{ t0: 1.9, t1: 3.1, y0: 0, y1: 2.2, fill: 'door' }] : [], { tint: rough, top: 3.2 });
    const f = K.face(x0, x1, z0, z1, 'S');
    K.wall(f, -1, 3.2, -0.4, 0, S, [{ t0: 3.0, t1: 4.2, y0: 1.2, y1: 2.1, fill: 'glass', frame: true, shutters: 2 }], { tint: rough, top: 3.2 });
    K.roof(x0, x1, z0, z1, 3.2, { axis: 'x', pitch: 0.35, ov: 0.45, wall: S, wallTint: rough });
    K.col(x0, -1, z0, x1, 3.2, z1);
    for (let i = 0; i < 4; i++) K.beam(M.wood, [x1 + 0.1, 0, z0 + 0.8 + i * 0.5], [x1 + 0.35, 1.7, z0 + 0.8 + i * 0.5], 0.05, 0.05, { d: true });
  }
  const rd = [-0.566, 0.824];
  for (const off of [-0.8, 0.8]) {
    const nx = rd[1] * off, nz = -rd[0] * off;
    for (let i = 0; i < 12; i++) {
      const d0 = i * 3.5 - 8, d1 = d0 + 3.5;
      K.quad(ctx.L.soil, [rd[0] * d0 + nx - 0.22, 0.035, rd[1] * d0 + nz], [rd[0] * d0 + nx + 0.22, 0.035, rd[1] * d0 + nz], [rd[0] * d1 + nx + 0.22, 0.035, rd[1] * d1 + nz], [rd[0] * d1 + nx - 0.22, 0.035, rd[1] * d1 + nz], [0, 1, 0], { gao: false, cast: false, tint: 0.8 });
    }
  }
  K.cart(-12, 14, 0, 3, {});
  K.pine(-40, 30, 12, 6); K.tree(24, 30, 5, 2.4, 0, { tint: [0.62, 0.7, 0.5] }); K.cypress(-14, 36, 12, 1.05);
  ctx.spawnsLocal([[-10, 4], [8, 14], [-20, 18], [0, -12], [-28, 6], [4, 26]]);
  ctx.enemy = { x: -6, z: 6, r: 30 };
}

let _cylX = null;
function cylX() {
  if (!_cylX) { const g = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0).rotateZ(-Math.PI / 2).toNonIndexed(); _cylX = { P: Float32Array.from(g.attributes.position.array), N: Float32Array.from(g.attributes.normal.array) }; g.dispose(); }
  return _cylX;
}
