// Watermill and three-arch stone bridge. The bridge carries the south road (local z axis) over
// the river on a gentle hump (walkable deck, parapet colliders); the mill stands on the north
// bank, fed by a stone-lined leat with a turning breast-shot wheel and a tail race back into the
// river; miller's house, weir, millstones, sacks and a cart complete the scene.
import * as THREE from 'three';
import { LGeo } from './landmarks-geo.js';
import { Kit } from './landmarks-kit.js';
import { riverAt } from './landmarks.js';

export function buildMill(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim, s = ctx.s;
  const st = [0.98, 0.95, 0.9], wo = { tint: st };
  const bedLocal = riverAt(s.x, s.z).bed - s.y;           // ≈ -2
  const waterY = bedLocal + 0.8;

  // ---------------- bridge along z (x ∈ [-3, 3]); deck hump peaks HB at z = 0.
  const BL = 24, HB = 2.1, DW = 2.5, OW = 3.05;
  const deck = (z) => { const t = Math.min(1, Math.abs(z) / BL); return HB * (1 - t * t * (3 - 2 * t)) + 0.05; };
  const arches = [{ c: 0, r: 5.6, spring: bedLocal + 0.7, seg: 0.62 }, { c: -9.4, r: 2.1, spring: bedLocal + 0.2, seg: 1 }, { c: 9.4, r: 2.1, spring: bedLocal + 0.2, seg: 1 }];
  // Intrados height at z (or null when solid).
  const intr = (z) => {
    for (const a of arches) {
      const half = a.seg < 1 ? a.r * Math.sin(Math.PI * a.seg / 2) : a.r;
      if (Math.abs(z - a.c) < half) {
        const cy = a.seg < 1 ? a.spring - a.r * Math.cos(Math.PI * a.seg / 2) : a.spring;
        return cy + Math.sqrt(Math.max(0, a.r * a.r - (z - a.c) ** 2));
      }
    }
    return null;
  };
  const found = bedLocal - 2.5;
  const dz = 0.6;
  for (let z = -BL - 1.5; z < BL + 1.5 - 1e-6; z += dz) {
    const za = z, zb = z + dz, ya = deck(za), yb = deck(zb);
    const ia = intr(za), ib = intr(zb);
    const lowA = ia ?? found, lowB = ib ?? found;
    for (const sx of [-1, 1]) {
      const n = [sx, 0, 0], x = sx * OW;
      // Spandrel face (outer), parapet inner face, coping.
      K.quad(S, [x, lowA, za], [x, lowB, zb], [x, yb + 0.95, zb], [x, ya + 0.95, za], n, { ...wo, gao: false });
      K.quad(S, [sx * DW, ya, za], [sx * DW, yb, zb], [sx * DW, yb + 0.95, zb], [sx * DW, ya + 0.95, za], [-sx, 0, 0], { ...wo, gao: false, ao: 0.9 });
      K.quad(T, [sx * DW - sx * 0.05, ya + 0.95, za], [sx * DW - sx * 0.05, yb + 0.95, zb], [x + sx * 0.08, yb + 0.95, zb], [x + sx * 0.08, ya + 0.95, za], [0, 1, 0], { gao: false });
      K.quad(T, [x + sx * 0.08, ya + 0.8, za], [x + sx * 0.08, yb + 0.8, zb], [x + sx * 0.08, yb + 0.95, zb], [x + sx * 0.08, ya + 0.95, za], n, { gao: false });
      // Voussoir ring on the arch faces.
      if (ia !== null && ib !== null) {
        K.quad(T, [x + sx * 0.06, ia, za], [x + sx * 0.06, ib, zb], [x + sx * 0.06, Math.min(ib + 0.55, yb + 0.7), zb], [x + sx * 0.06, Math.min(ia + 0.55, ya + 0.7), za], n, { gao: false, tint: 0.96 });
      }
    }
    // Deck paving and arch barrel.
    K.quad(M.cobble, [-DW, ya, za], [DW, ya, za], [DW, yb, zb], [-DW, yb, zb], [0, 1, 0], { tint: [1, 0.98, 0.92], gao: false });
    if (ia !== null && ib !== null) K.quad(S, [-OW, ia, za], [OW, ia, za], [OW, ib, zb], [-OW, ib, zb], [0, -1, 0], { ...wo, ao: 0.6, gao: false });
    // Colliders: deck slab (walkable), parapets.
    const top = Math.max(ya, yb);
    K.col(-DW, ia !== null ? Math.min(ia, ib) : found, za, DW, (ya + yb) / 2, zb);
    for (const sx of [-1, 1]) K.col(sx < 0 ? -OW - 0.1 : DW, top - 0.2, za, sx < 0 ? -DW : OW + 0.1, top + 0.95, zb);
    if (Math.round(z / dz) % 5 === 0) ctx.navPts([[0, (ya + yb) / 2, (za + zb) / 2]]);
  }
  // Piers with cutwaters (pointed upstream on +x, downstream on -x).
  for (const pz of [-6.2, 6.2]) {
    const top = intr(pz + 0.9) ?? 1;
    K.box(S, -OW, found, pz - 1.0, OW, top, pz + 1.0, { ...wo, gao: false });
    for (const sx of [-1, 1]) {
      const tip = sx * (OW + 2.2), h = waterY + 1.6;
      for (const [a, b] of [[pz - 1.0, pz], [pz, pz + 1.0]]) { void a; void b; }
      K.quad(S, [sx * OW, found, pz - 1.0], [tip, found, pz], [tip, h, pz], [sx * OW, h, pz - 1.0], [sx, 0, -1], { ...wo, gao: false });
      K.quad(S, [tip, found, pz], [sx * OW, found, pz + 1.0], [sx * OW, h, pz + 1.0], [tip, h, pz], [sx, 0, 1], { ...wo, gao: false });
      K.tri(T, [sx * OW, h, pz - 1.0], [tip, h, pz], [sx * OW, h + 1.1, pz], [sx, 1, -1], { gao: false });
      K.tri(T, [tip, h, pz], [sx * OW, h, pz + 1.0], [sx * OW, h + 1.1, pz], [sx, 1, 1], { gao: false });
    }
    K.col(-OW - 2.2, found, pz - 1.0, OW + 2.2, waterY + 1.6, pz + 1.0);
  }
  // Abutment wing walls at both ends.
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const z0 = sz * BL, z1 = sz * (BL + 1.5);
    K.box(S, sx < 0 ? -OW - 1.2 : OW, -1.5, Math.min(z0, z1), sx < 0 ? -OW : OW + 1.2, 1.05, Math.max(z0, z1), { ...wo, col: true });
    K.box(T, sx < 0 ? -OW - 1.25 : OW - 0.05, 1.05, Math.min(z0, z1) - 0.05, sx < 0 ? -OW + 0.05 : OW + 1.25, 1.2, Math.max(z0, z1) + 0.05, { gao: false });
  }
  // Small shrine niche on the crown of the parapet.
  K.box(T, OW, HB + 1.0, -0.5, OW + 0.3, HB + 2.1, 0.5, { tint: 0.95 });
  K.box(S, OW + 0.29, HB + 1.2, -0.3, OW + 0.31, HB + 1.85, 0.3, { tint: 0.15, gao: false });
  K.pyramid(OW - 0.05, OW + 0.35, -0.6, 0.6, HB + 2.1, 0.35, { ov: 0.05, mat: T });

  // ---------------- leat (headrace) along z ∈ [-13.4, -10.6] from the east pad edge to the wheel.
  const LZ0 = -13.2, LZ1 = -10.4, LX0 = 6.5, LX1 = 36, lw = 0.5, ly = 1.0;
  const lwY = ly - 0.25;
  for (const [z0, z1] of [[LZ0 - lw, LZ0], [LZ1, LZ1 + lw]]) {
    K.box(S, LX0, -1.2, z0, LX1, ly, z1, { ...wo, col: true });
    K.box(T, LX0, ly, z0 - 0.04, LX1, ly + 0.12, z1 + 0.04, { gao: false });
  }
  K.box(S, LX0 - lw, -1.2, LZ0 - lw, LX0, ly, LZ1 + lw, { ...wo, col: true });
  K.box(M.water, LX0, lwY - 0.02, LZ0, LX1, lwY, LZ1, { gao: false, tint: 0.62, receive: true });
  K.box(S, LX0, -0.9, LZ0, LX1, -0.8, LZ1, { tint: 0.3, gao: false });
  // Sluice gate at the head of the leat.
  K.box(M.wood, 30, ly, LZ0 - 0.3, 30.25, ly + 1.6, LZ1 + 0.3, { d: true });
  K.box(M.wood, 30.3, -0.4, LZ0, 30.45, ly + 0.9, LZ1, { tint: 0.8 });
  // Tail race: from under the wheel south into the river (a stone chute).
  const chuteX0 = 12.5, chuteX1 = 15.5;
  for (const x of [chuteX0 - 0.4, chuteX1]) K.box(S, x, -2.5, LZ1 + lw, x + 0.4, 0.6, -6.0, { ...wo, col: true });
  K.quad(M.water, [chuteX0, lwY - 0.8, LZ1 + lw], [chuteX1, lwY - 0.8, LZ1 + lw], [chuteX1, waterY + 0.05, -6.0], [chuteX0, waterY + 0.05, -6.0], [0, 1, 0], { gao: false, tint: 0.7 });

  // ---------------- the water wheel (separate animated mesh, axle along z).
  const WX = 16, WY = 2.2, WZ = (LZ0 + LZ1) / 2, WR = 2.75;
  {
    const wg = new LGeo(-99);
    const wctx = { ...ctx, G: wg, D: wg, col: [] };
    const W = Kit.root(wctx, 0, 0, 0);
    const wood = M.wood, iron = M.iron;
    for (const zz of [-0.62, 0.52]) {
      W.tplM(wood, torusTpl(), new THREE.Matrix4().makeTranslation(0, 0, zz + 0.05).multiply(new THREE.Matrix4().makeScale(WR, WR, 1)), { tint: [0.8, 0.7, 0.6], gao: false });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        W.beam(wood, [0, 0, zz + 0.05], [Math.cos(a) * WR, Math.sin(a) * WR, zz + 0.05], 0.14, 0.12, { tint: [0.8, 0.7, 0.6], gao: false });
      }
    }
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      W.beam(wood, [c * (WR - 0.55), sn * (WR - 0.55), -0.62], [c * (WR - 0.55), sn * (WR - 0.55), 0.7], 0.46, 0.06, { tint: [0.75, 0.66, 0.56], gao: false });
      W.beam(wood, [c * (WR + 0.1), sn * (WR + 0.1), -0.62], [c * (WR + 0.1), sn * (WR + 0.1), 0.7], 0.06, 0.06, { gao: false });
    }
    W.tplM(iron, cylTplZ(), new THREE.Matrix4().makeScale(0.22, 0.22, 3.6).premultiply(new THREE.Matrix4().makeTranslation(0, 0, -1.6)), { gao: false });
    const g = new THREE.Group();
    wg.finish(g);
    const wp = K.P(WX, WY, WZ);
    g.position.set(wp[0], wp[1], wp[2]);
    g.traverse((o) => { if (o.isMesh) { o.matrixAutoUpdate = true; o.castShadow = true; } });
    ctx.extraMeshes.push(g);
    ctx.anim.push((dt) => { g.rotation.z -= dt * 0.9; });
    // Bearing blocks.
    K.box(S, WX - 0.5, ly, LZ0 - lw - 0.1, WX + 0.5, WY - 0.2, LZ0 - lw + 0.4, { ...wo, gao: false });
    K.box(S, WX - 0.5, ly, LZ1 + lw - 0.4, WX + 0.5, WY - 0.2, LZ1 + lw + 0.1, { ...wo, gao: false });
    // Foam where the water hits the paddles.
    K.box(M.fabric, WX - 1.6, lwY + 0.01, LZ0 + 0.1, WX + 1.4, lwY + 0.04, LZ1 - 0.1, { tint: [1.1, 1.1, 1.1], gao: false, d: true, cast: false });
  }

  // ---------------- mill house (3 storeys) and the miller's house.
  {
    const x0 = 8, x1 = 22, z0 = -25.5, z1 = LZ0 - lw, H = 9.6;
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(x0, x1, z0, z1, dir), ops = [];
      const n = Math.max(2, Math.floor(f.W / 3.4));
      for (let i = 0; i < n; i++) {
        const t = (f.W / n) * (i + 0.5);
        if (dir === 'N' && i === 1) ops.push({ t0: t - 1.1, t1: t + 1.1, y0: 0, y1: 2.6, arch: true, fill: 'door', ring: true, keystone: true });
        else if (dir !== 'S') ops.push({ t0: t - 0.4, t1: t + 0.4, y0: 1.3, y1: 2.5, fill: 'grille', frame: true, frameTint: 0.9 });
        ops.push({ t0: t - 0.42, t1: t + 0.42, y0: 4.3, y1: 5.6, fill: 'glass', frame: true, shutters: 2 });
        ops.push({ t0: t - 0.35, t1: t + 0.35, y0: 7.3, y1: 8.4, fill: 'glass', frame: true });
      }
      if (dir === 'W') ops.push({ t0: f.W - 3.2, t1: f.W - 2.2, y0: 4.2, y1: 6.2, fill: 'door', frame: true });
      K.wall(f, -2.5, H, -0.7, 0, S, ops, { ...wo, top: H });
      for (let y = 0, k = 0; y < H - 0.3; y += 0.6, k++) {
        const e = k % 2 ? 0.45 : 0.8;
        K.fbox(f, T, -0.03, e, y, y + 0.55, -0.1, 0.05, { gao: y < 1, tint: 0.93 });
      }
    }
    K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.34, ov: 0.6, wall: S, wallTint: st });
    K.col(x0, -2.5, z0, x1, H, z1);
    // Hoist beam and pulley over the loft door, sacks, millstones.
    K.beam(M.wood, [x0 - 1.4, 7.2, z0 + 11.3], [x0 + 0.5, 7.2, z0 + 11.3], 0.22, 0.26);
    K.box(M.iron, x0 - 1.3, 6.4, z0 + 11.25, x0 - 1.2, 7.1, z0 + 11.35, { d: true });
    K.box(M.wood, x0 - 1.3, 4.0, z0 + 11.25, x0 - 1.2, 4.1, z0 + 11.35, { d: true });
    for (let i = 0; i < 3; i++) {
      const mx = x0 + 3.6 + i * 1.4;
      K.tplM(T, cylTplZ(), new THREE.Matrix4().makeTranslation(mx, 0.72, z0 - 0.62).multiply(new THREE.Matrix4().makeRotationX(-0.12)).multiply(new THREE.Matrix4().makeScale(0.7, 0.7, 0.26)), { tint: [0.85, 0.83, 0.8] });
    }
    K.col(x0 + 2.8, 0, z0 - 1.1, x0 + 7.4, 1.4, z0 - 0.3);
    for (let i = 0; i < 6; i++) K.blob(M.fabric, x0 - 0.7 - (i % 3) * 0.75, 0.32 + Math.floor(i / 3) * 0.45, z0 + 6 + (i % 2) * 0.3, 0.38, 0.3, 0.28, { tint: [0.95, 0.88, 0.72], detail: 0, d: true });
    K.cart(x0 - 5, z0 + 3, 0, 0, { load: 'hay' });
  }
  {
    const x0 = 22, x1 = 30.5, z0 = -24.5, z1 = -15.5, H = 6.6, P = M.plaster[4];
    for (const dir of ['N', 'E', 'S']) {
      const f = K.face(x0, x1, z0, z1, dir), ops = [];
      const n = Math.max(1, Math.floor(f.W / 3.2));
      for (let i = 0; i < n; i++) {
        const t = (f.W / n) * (i + 0.5);
        if (dir === 'N' && i === 0) ops.push({ t0: t - 0.55, t1: t + 0.55, y0: 0, y1: 2.3, fill: 'door', frame: true });
        else ops.push({ t0: t - 0.42, t1: t + 0.42, y0: 1.1, y1: 2.3, fill: 'glass', frame: true, shutters: 0 });
        ops.push({ t0: t - 0.42, t1: t + 0.42, y0: 4.0, y1: 5.3, fill: 'glass', frame: true, shutters: 0 });
      }
      K.wall(f, -2.5, H, -0.6, 0, P, ops, { top: H });
    }
    K.roof(x0 - 0.3, x1, z0, z1, H, { axis: 'x', pitch: 0.32, ov: 0.5, wall: P, gables: 'end1' });
    K.col(x0, -2.5, z0, x1, H, z1);
    K.pergola(x0 + 0.5, z0 - 4.2, x1 - 0.5, z0 - 0.4, 2.5, 0, { skipSide: 'none' });
    K.box(M.wood, x0 + 2, 0, z0 - 3.2, x0 + 4.5, 0.75, z0 - 2.2, { d: true, col: true });
    K.woodpile(x1 + 1.2, -20, 3.4, 0, 1);
  }
  // Weir across the river upstream of the leat head (a low stone sill, water spilling over).
  {
    const wx = 40;
    const { d } = riverAt(K.wx(wx, 0), K.wz(wx, 0));
    const zc = -(wx * 20) / 190;
    void d;
    K.box(S, wx - 1.2, bedLocal - 1, zc - 9, wx + 1.2, waterY + 0.25, zc + 9, { ...wo, gao: false });
    K.quad(M.waterJet, [wx - 1.2, waterY + 0.28, zc - 8], [wx - 1.2, waterY + 0.28, zc + 8], [wx - 2.4, waterY - 0.05, zc + 8], [wx - 2.4, waterY - 0.05, zc - 8], [-0.3, 1, 0], { gao: false, d: true });
  }
  // Trees along the banks: poplars (slim) and willows.
  for (const [x, z] of [[-14, -12], [-22, -14], [-30, -15], [26, 12], [34, 10], [-18, 14], [-10, 20]]) {
    if (!ctx.roadClear(x, z, 2.5)) continue;
    if (x > 20 || z > 0) K.tree(x, z, 5.5, 2.8, 0, { tint: [0.72, 0.84, 0.55] });
    else K.cypress(x, z, 14, 1.3, 0, { tint: [0.72, 0.84, 0.58] });
  }
  K.tree(-8, -24, 5, 2.4, 0, { tint: [0.64, 0.74, 0.54], col: true });

  // River channel is not walkable ground: keep nav points off it (the bridge adds its own).
  ctx.navExclude = (x, z) => riverAt(K.wx(x, z), K.wz(x, z)).d < 9;
  ctx.spawnsLocal([[-6, -20], [4, -30], [18, -31], [-12, 18], [10, 20], [-10, -30], [0, HB + 0.05, 0]].map((p) => p.length === 3 ? [p[0], p[2], p[1]] : p));
  ctx.enemy = { x: 4, z: -12, r: 30 };
}

// Unit torus ring (radius 1) in the XY plane, and a unit cylinder along +z (radius 1, length 1).
let _torus = null, _cylz = null;
function torusTpl() {
  if (!_torus) { const g = new THREE.TorusGeometry(1, 0.07, 4, 24).toNonIndexed(); g.computeVertexNormals(); _torus = { P: Float32Array.from(g.attributes.position.array), N: Float32Array.from(g.attributes.normal.array) }; g.dispose(); }
  return _torus;
}
function cylTplZ() {
  if (!_cylz) { const g = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0).rotateX(Math.PI / 2).toNonIndexed(); _cylz = { P: Float32Array.from(g.attributes.position.array), N: Float32Array.from(g.attributes.normal.array) }; g.dispose(); }
  return _cylz;
}
