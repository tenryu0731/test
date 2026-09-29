// Monte Rosso fortress: curtain walls on a battered scarp around a raised courtyard, square corner
// towers with machicolations (one collapsed), gate tower with a ramp down to the road, a tall keep
// whose top is a walkable viewpoint, a roofless ruined palazzo, barracks, cistern and a breach.
import { ruinTop } from './landmarks-kit.js';

export function buildRocca(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim;
  const st = [0.9, 0.89, 0.86], wo = { tint: st };
  const X0 = -36, X1 = 30, Z0 = -30, Z1 = 32, TH = 2.4, CY = 3, WY = 12, FD = -9;
  const IX0 = X0 + TH, IX1 = X1 - TH, IZ0 = Z0 + TH, IZ1 = Z1 - TH;
  const gateX = -16, gw = 4.2;
  const breach = [-3, 6];                     // z-range of the breach in the east wall
  const cg = { gy: CY };                      // contact AO relative to the courtyard

  // --- Courtyard terrace (walkable) with a trodden gravel surface.
  K.box(S, IX0, FD, IZ0, IX1, CY - 0.05, IZ1, { tint: 0.8, col: true, gao: false });
  K.box(ctx.L.gravel, IX0, CY - 0.1, IZ0, IX1, CY, IZ1, { tint: [0.9, 0.86, 0.78], cast: false });

  // --- Curtain walls: scarp + wall + walkway + merlons on the outer edge.
  const walls = [
    { dir: 'S', x0: X0, x1: X1, z0: IZ1, z1: Z1, gap: [gateX - gw / 2 - 3, gateX + gw / 2 + 3] },
    { dir: 'N', x0: X0, x1: X1, z0: Z0, z1: IZ0 },
    { dir: 'W', x0: X0, x1: IX0, z0: Z0, z1: Z1 },
    { dir: 'E', x0: IX1, x1: X1, z0: Z0, z1: Z1, gap: breach },
  ];
  for (const w of walls) {
    const f = K.face(w.x0, w.x1, w.z0, w.z1, w.dir), W = f.W;
    // Scarp: sloping base from the foundation to CY + 0.5, 1.6 m proud at the bottom.
    const sc = 1.6;
    K.fbox(f, S, 0, W, FD, 0.2, -TH, sc, { ...wo });
    K.quad(S, K.fp(f, 0, 0.2, sc), K.fp(f, W, 0.2, sc), K.fp(f, W, CY + 0.6, 0), K.fp(f, 0, CY + 0.6, 0), [f.dx, 0.45, f.dz], { ...wo, gao: false });
    K.fbox(f, T, 0, W, CY + 0.55, CY + 0.8, -0.2, 0.14, { gao: false, tint: 0.95 });
    // Wall body split around the gap (gate passage / breach) so the pieces are exact colliders.
    const pieces = [];
    if (w.gap) {
      const tA = w.dir === 'S' ? w.gap[0] - X0 : Z1 - w.gap[1], tB = w.dir === 'S' ? w.gap[1] - X0 : Z1 - w.gap[0];
      pieces.push([0, tA], [tB, W]);
      if (w.dir === 'E') {
        // Breach: broken wall stump with a jagged top.
        ruinTop(K, f, tA, tB, CY - 0.5, CY + 1.1, -TH, 0, S, R, { ...wo });
        K.fboxCol(f, tA, tB, FD, CY + 0.35, -TH, 0);
      }
    } else pieces.push([0, W]);
    for (const [a, b] of pieces) {
      K.fbox(f, S, a, b, CY + 0.6, WY, -TH, 0, { ...wo, col: false });
      K.fboxCol(f, a, b, FD, WY, -TH, 0);
      // Parapet with merlons, putlog holes.
      K.merlons(f, a + 0.3, b - 0.3, WY, 1.9, -0.6, 0, S, { w: 1.0, g: 0.7, tint: st, col: true });
      K.fbox(f, T, a, b, WY - 0.12, WY + 0.05, -TH, 0.08, { gao: false });
      for (let k = 0; k < (b - a) / 6; k++) { const t = a + 1 + R() * (b - a - 2), y = CY + 3 + R() * (WY - CY - 5); K.fbox(f, S, t - 0.1, t + 0.1, y - 0.1, y + 0.1, -0.3, 0.01, { tint: 0.08, gao: false, d: true }); }
      // Arrow slits.
      for (let t = a + 3; t < b - 2; t += 7.5) K.fbox(f, S, t - 0.08, t + 0.08, CY + 3.5, CY + 5.0, -0.25, 0.005, { tint: 0.06, gao: false });
    }
  }
  // Walkway top surface.
  for (const [x0, z0, x1, z1] of [[X0, IZ1, X1, Z1], [X0, Z0, X1, IZ0], [X0, Z0, IX0, Z1], [IX1, Z0, X1, Z1]]) K.box(M.paving, x0 + 0.02, WY - 0.02, z0 + 0.02, x1 - 0.02, WY + 0.02, z1 - 0.02, { tint: 0.8, gao: false, cast: false, d: true });

  // --- Corner towers (NE collapsed).
  const towers = [[X0 - 4, Z1 - 4, 'SW'], [X1 - 4, Z1 - 4, 'SE'], [X0 - 4, Z0 - 4, 'NW'], [X1 - 4, Z0 - 4, 'NE']];
  for (const [tx, tz, id] of towers) {
    const x0 = tx, x1 = tx + 8, z0 = tz, z1 = tz + 8, H = id === 'NE' ? 0 : 18.5;
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(x0, x1, z0, z1, dir);
      K.fbox(f, S, -1.8, f.W + 1.8, FD, 0.2, -2, 1.8, { ...wo });
      K.quad(S, K.fp(f, -1.8, 0.2, 1.8), K.fp(f, f.W + 1.8, 0.2, 1.8), K.fp(f, f.W, CY + 1.5, 0), K.fp(f, 0, CY + 1.5, 0), [f.dx, 0.45, f.dz], { ...wo, gao: false });
      if (id === 'NE') {
        ruinTop(K, f, 0, f.W, CY + 1.4, CY + 8 + R() * 3, -1.4, 0, S, R, { ...wo });
        continue;
      }
      const ops = [{ t0: 3.8, t1: 4.2, y0: CY + 5, y1: CY + 6.6, fill: 'dark' }, { t0: 3.7, t1: 4.3, y0: CY + 10, y1: CY + 11.2, arch: true, fill: 'dark', ring: true, ringW: 0.14 }];
      K.wall(f, CY + 1.4, H, -1.4, 0, S, ops, wo);
      K.corbels(f, -0.1, f.W + 0.1, H + 0.9, 0.6, T, { sp: 1.05 });
      K.fbox(f, S, -0.6, f.W + 0.6, H + 0.9, H + 2.0, -0.2, 0.6, { ...wo, gao: false });
      K.merlons(f, -0.6, f.W + 0.6, H + 2.0, 1.3, -0.2, 0.6, S, { w: 0.9, g: 0.7, tint: st });
      K.fbox(f, T, -0.65, f.W + 0.65, H + 1.95, H + 2.08, -0.25, 0.65, { gao: false });
    }
    if (id === 'NE') {
      K.col(x0, FD, z0, x1, CY + 6, z1);
      for (let i = 0; i < 40; i++) { // rubble at the foot of the collapsed tower
        const x = x0 + 4 + (R() - 0.3) * 14, z = z0 + 4 + (R() - 0.7) * 14, s = 0.3 + R() * 0.7;
        if (x > IX0 && x < IX1 && z > IZ0 && z < IZ1) continue;
        K.box(S, x - s, -0.4, z - s * 0.8, x + s, s * 0.8 + (x > x0 - 1 && x < x1 + 1 && z > z0 - 1 && z < z1 + 1 ? 2 : 0), z + s * 0.8, { tint: st.map((v) => v * (0.8 + R() * 0.25)), d: i > 16 });
      }
      K.box(S, x0 + 1.4, CY - 0.1, z0 + 1.4, x1 - 1.4, CY + 1.6, z1 - 1.4, { tint: 0.7 });
    } else {
      K.box(S, x0 + 0.2, H + 0.85, z0 + 0.2, x1 - 0.2, H + 0.95, z1 - 0.2, { tint: 0.75, gao: false });
      K.pyramid(x0 + 1.4, x1 - 1.4, z0 + 1.4, z1 - 1.4, H + 0.95, 1.6, { ov: 0.1 }); // hatch roof
      K.col(x0, FD, z0, x1, H + 1, z1);
    }
  }

  // --- Gate tower with passage and portcullis; ramp down to the road.
  {
    const x0 = gateX - 5, x1 = gateX + 5, z0 = IZ1 - 1.5, z1 = Z1 + 4.5, H = 17;
    const gt = { t0: 5 - gw / 2, t1: 5 + gw / 2, y0: CY, y1: CY + 3.4, arch: true, fill: 'open' };
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(x0, x1, z0, z1, dir);
      if (dir === 'S') {
        K.fbox(f, S, -1.6, f.W + 1.6, FD, 0.2, -2, 1.6, { ...wo });
        K.quad(S, K.fp(f, -1.6, 0.2, 1.6), K.fp(f, f.W + 1.6, 0.2, 1.6), K.fp(f, f.W, CY + 0.6, 0), K.fp(f, 0, CY + 0.6, 0), [f.dx, 0.45, f.dz], { ...wo, gao: false });
      }
      const ops = dir === 'S' || dir === 'N' ? [{ ...gt, ring: dir === 'S', ringW: 0.4, keystone: true }] : [];
      if (dir === 'S') ops.push({ t0: 4.7, t1: 5.3, y0: CY + 8.5, y1: CY + 9.8, arch: true, fill: 'dark', ring: true, ringW: 0.15 });
      K.wall(f, dir === 'S' ? CY + 0.6 : CY - 0.2, H, -1.2, 0, S, ops, { ...wo, back: false });
      K.corbels(f, -0.1, f.W + 0.1, H + 0.9, 0.55, T, { sp: 1.05 });
      K.fbox(f, S, -0.55, f.W + 0.55, H + 0.9, H + 1.9, -0.2, 0.55, { ...wo, gao: false });
      K.merlons(f, -0.55, f.W + 0.55, H + 1.9, 1.3, -0.2, 0.55, S, { w: 0.9, g: 0.7, tint: st });
    }
    // Passage vault walls, floor, portcullis teeth.
    const px0 = gateX - gw / 2, px1 = gateX + gw / 2, sp = CY + 3.4 + gw / 2;
    K.box(S, x0 + 1.2, CY - 0.2, z0 + 1.2, px0, sp, z1 - 1.2, { tint: 0.75 });
    K.box(S, px1, CY - 0.2, z0 + 1.2, x1 - 1.2, sp, z1 - 1.2, { tint: 0.75 });
    K.box(S, px0, sp - 0.2, z0, px1, H - 0.5, z1, { tint: 0.55 });
    K.box(M.cobble, px0, CY - 0.3, z0 - 0.3, px1, CY + 0.02, z1 + 0.3, { tint: 0.9, gao: false, col: true });
    for (let i = 0; i < 9; i++) { const x = px0 + 0.25 + i * (gw - 0.5) / 8; K.box(M.iron, x - 0.04, CY + 3.3, z1 - 1.0, x + 0.04, sp + 0.1, z1 - 0.9, { d: true, gao: false }); }
    K.box(M.iron, px0, CY + 3.9, z1 - 1.02, px1, CY + 4.0, z1 - 0.88, { d: true, gao: false });
    K.col(x0, FD, z0, px0, H, z1); K.col(px1, FD, z0, x1, H, z1); K.col(px0, sp - 0.2, z0, px1, H, z1);
    K.col(x0 - 0.55, H + 0.9, z0 - 0.55, x1 + 0.55, H + 3.2, z1 + 0.55);
    K.box(S, x0 + 0.2, H - 0.1, z0 + 0.2, x1 - 0.2, H + 0.95, z1 - 0.2, { tint: 0.7, gao: false });
    // Ramp: diagonal causeway along the road (south-south-west), from CY at the gate to the pad.
    const dir = [-0.447, 0.894], nrm = [dir[1], -dir[0]], L = 26, RW = 5.2, sx = gateX, sz = z1 + 0.2;
    const at = (s, o) => [sx + dir[0] * s + nrm[0] * o, sz + dir[1] * s + nrm[1] * o];
    const yAt = (s) => CY * (1 - Math.min(1, s / L));
    const n = 13;
    for (let i = 0; i < n; i++) {
      const s0 = (L * i) / n, s1 = (L * (i + 1)) / n, y0 = yAt(s0) + 0.02, y1 = yAt(s1) + 0.02;
      const a = at(s0, -RW / 2), b = at(s0, RW / 2), c = at(s1, RW / 2), d = at(s1, -RW / 2);
      K.quad(M.cobble, [a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]], [0, 1, 0], { tint: 0.95 });
      for (const side of [-1, 1]) {
        const o0 = at(s0, side * RW / 2), o1 = at(s1, side * RW / 2), p0 = at(s0, side * (RW / 2 + 0.5)), p1 = at(s1, side * (RW / 2 + 0.5));
        const nn = [nrm[0] * side, 0, nrm[1] * side];
        // Retaining wall face down to the ground and the low parapet on top.
        K.quad(S, [p0[0], -1, p0[1]], [p1[0], -1, p1[1]], [p1[0], y1 + 0.85, p1[1]], [p0[0], y0 + 0.85, p0[1]], nn, { ...wo });
        K.quad(S, [o0[0], y0, o0[1]], [o1[0], y1, o1[1]], [o1[0], y1 + 0.85, o1[1]], [o0[0], y0 + 0.85, o0[1]], [-nn[0], 0, -nn[2]], { ...wo, gy: y0 });
        K.quad(T, [o0[0], y0 + 0.85, o0[1]], [o1[0], y1 + 0.85, o1[1]], [p1[0], y1 + 0.85, p1[1]], [p0[0], y0 + 0.85, p0[1]], [0, 1, 0], { gao: false });
      }
      if (y0 > 0.3) {
        const cx = (at(s0, 0)[0] + at(s1, 0)[0]) / 2, cz = (at(s0, 0)[1] + at(s1, 0)[1]) / 2, top = (y0 + y1) / 2;
        K.col(cx - 2.1, -1, cz - 1.3, cx + 2.1, top, cz + 1.3);
      }
      for (const side of [-1, 1]) {
        const m = at((s0 + s1) / 2, side * (RW / 2 + 0.25));
        K.col(m[0] - 0.55, -1, m[1] - 0.55, m[0] + 0.55, Math.max(y0, y1) + 0.85, m[1] + 0.55);
      }
      ctx.navPts([[at((s0 + s1) / 2, 0)[0], (y0 + y1) / 2, at((s0 + s1) / 2, 0)[1]]]);
    }
    ctx.navPts([[gateX, CY, z1 - 1], [gateX, CY, z0 + 1], [gateX, CY, z0 - 2.5]]);
    ctx.gateTop = z1;
  }

  // --- Keep (mastio): 28 m, raised door by a stone stair, walkable machicolated top.
  const KX0 = -5, KX1 = 6, KZ0 = IZ0, KZ1 = IZ0 + 11, KH = CY + 28;
  {
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(KX0, KX1, KZ0, KZ1, dir);
      const ops = [];
      for (let y = CY + 6; y < KH - 6; y += 5.5) ops.push({ t0: f.W / 2 - 0.1, t1: f.W / 2 + 0.1, y0: y, y1: y + 1.4, fill: 'dark' });
      if (dir === 'S') { ops.length = 0; ops.push({ t0: 7.0, t1: 8.3, y0: CY + 4.2, y1: CY + 6.4, arch: true, fill: 'door', ring: true, ringW: 0.3, keystone: true }); ops.push({ t0: 7.25, t1: 8.05, y0: CY + 12, y1: CY + 13.8, arch: true, fill: 'dark', ring: true, ringW: 0.18 }); ops.push({ t0: 7.25, t1: 8.05, y0: CY + 19, y1: CY + 20.8, arch: true, fill: 'dark', ring: true, ringW: 0.18 }); }
      if (dir === 'W' || dir === 'E') ops.push({ t0: 5.1, t1: 5.9, y0: CY + 16, y1: CY + 17.8, arch: true, fill: 'dark', ring: true, ringW: 0.18 });
      K.fbox(f, S, -1, f.W + 1, CY - 0.5, CY + 0.4, -1, 1, { ...wo, gy: CY });
      K.quad(S, K.fp(f, -1, CY + 0.4, 1), K.fp(f, f.W + 1, CY + 0.4, 1), K.fp(f, f.W, CY + 2.2, 0), K.fp(f, 0, CY + 2.2, 0), [f.dx, 0.55, f.dz], { ...wo, gao: false });
      K.wall(f, dir === 'N' ? FD : CY + 2.1, KH, -1.5, 0, S, ops, { ...wo, gy: CY });
      K.fbox(f, T, -0.1, f.W + 0.1, CY + 9.5, CY + 9.75, -0.3, 0.1, { gao: false });
      K.corbels(f, -0.1, f.W + 0.1, KH + 1.0, 0.7, T, { sp: 1.0 });
      K.fbox(f, S, -0.7, f.W + 0.7, KH + 1.0, KH + 2.1, -0.25, 0.7, { ...wo, gao: false });
      K.merlons(f, -0.7, f.W + 0.7, KH + 2.1, 1.4, -0.25, 0.7, S, { w: 0.95, g: 0.72, tint: st });
      K.fbox(f, T, -0.75, f.W + 0.75, KH + 2.05, KH + 2.18, -0.3, 0.75, { gao: false });
    }
    K.box(S, KX0 - 0.5, KH + 0.8, KZ0 - 0.5, KX1 + 0.5, KH + 1.0, KZ1 + 0.5, { tint: 0.8, gao: false });
    K.box(M.paving, KX0 - 0.2, KH + 1.0, KZ0 - 0.2, KX1 + 0.2, KH + 1.08, KZ1 + 0.2, { tint: 0.85, gao: false, cast: false });
    // Stair hatch hut and a flagpole on the top.
    K.box(S, KX0 + 1, KH + 1.0, KZ0 + 1, KX0 + 3.4, KH + 3.4, KZ0 + 3.4, { tint: st });
    K.lean(KX0 + 1, KX0 + 3.4, KZ0 + 1, KZ0 + 3.4, KH + 3.2, KH + 3.7, 'S', { ov: 0.15, wall: S, wallTint: st });
    K.beam(M.wood, [KX1 - 1.4, KH + 1.0, KZ0 + 1.4], [KX1 - 1.4, KH + 7.5, KZ0 + 1.4], 0.12, 0.12);
    K.box(M.fabric, KX1 - 1.36, KH + 5.9, KZ0 + 1.36, KX1 - 1.3, KH + 7.3, KZ0 + 3.6, { tint: [0.95, 0.35, 0.25], gao: false, d: true });
    // Colliders: shaft (walkable top), parapets, hatch.
    const py = KH + 1.08, ph = py + 2.4;
    K.col(KX0, FD, KZ0, KX1, py, KZ1);
    K.col(KX0 - 0.75, py, KZ0 - 0.75, KX1 + 0.75, ph, KZ0 - 0.05); K.col(KX0 - 0.75, py, KZ1 + 0.05, KX1 + 0.75, ph, KZ1 + 0.75);
    K.col(KX0 - 0.75, py, KZ0 - 0.75, KX0 - 0.05, ph, KZ1 + 0.75); K.col(KX1 + 0.05, py, KZ0 - 0.75, KX1 + 0.75, ph, KZ1 + 0.75);
    K.col(KX0 + 1, py, KZ0 + 1, KX0 + 3.4, KH + 3.7, KZ0 + 3.4);
    K.col(KX0 - 1, CY - 0.5, KZ0 - 1, KX1 + 1, CY + 1.2, KZ1 + 1);
    // External stone stair up to the raised door (south face): landing, upper and lower flights.
    const doorX = KX0 + 7.65, sz = KZ1 + 1.9, ux = doorX + 1.2 + 13 * 0.32, lx = ux + 4 * 0.9;
    K.box(S, doorX - 1.0, CY, KZ1 + 0.05, doorX + 1.2, CY + 4.2, KZ1 + 2.7, { tint: st, col: true, gy: CY });
    K.stair(ux, sz, 1.5, 'W', 13, 3.0 / 13, 0.32, S, CY + 1.2, { tint: st, gy: CY });
    K.stair(lx, sz, 1.5, 'W', 4, 0.3, 0.9, S, CY, { tint: st, gy: CY });
    K.beam(T, [doorX + 1.2, CY + 4.6, sz + 0.78], [ux, CY + 1.6, sz + 0.78], 0.22, 0.3, { d: true });
    ctx.viewpoints.push({ id: 'rocca-keep', name: 'モンテ・ロッソ城塞の主塔', base: K.V(lx + 1.2, CY, sz), top: K.V((KX0 + KX1) / 2 + 1.5, py, (KZ0 + KZ1) / 2 + 1.5), yaw: Math.atan2(K.wx(0, 0), K.wz(0, 0)) });
  }

  // --- Ruined palazzo along the west wall: roofless shell with window holes.
  {
    const x0 = IX0, x1 = IX0 + 11, z0 = -14, z1 = 14, H = CY + 9;
    for (const dir of ['N', 'S', 'E']) {
      const f = K.face(x0, x1, z0, z1, dir), ops = [];
      const n = Math.max(2, Math.floor(f.W / 3.6));
      for (let i = 0; i < n; i++) {
        const t = (f.W / n) * (i + 0.5);
        if (dir === 'E' && (i === 1 || i === n - 2)) ops.push({ t0: t - 0.8, t1: t + 0.8, y0: CY, y1: CY + 2.6, arch: true, fill: 'open', ring: true });
        else ops.push({ t0: t - 0.5, t1: t + 0.5, y0: CY + 1.3, y1: CY + 2.9, fill: 'open', frame: true });
        ops.push({ t0: t - 0.5, t1: t + 0.5, y0: CY + 5.4, y1: CY + 7.0, arch: true, fill: 'open', ring: true, ringW: 0.14 });
      }
      K.wall(f, CY - 0.3, CY + 7.6, -0.8, 0, S, ops, { ...wo, gy: CY, back: true, col: true });
      ruinTop(K, f, 0, f.W, CY + 7.6, H + 1, -0.8, 0, S, R, { ...wo, gy: CY });
    }
    // Floor beams sockets / broken floor slab stub, inner vegetation.
    K.box(S, x0 + 0.8, CY + 4.4, z0 + 0.8, x0 + 4, CY + 4.7, z1 - 0.8, { tint: 0.7, gao: false });
    K.tree(x0 + 6, 2, CY + 5, 2.3, 0, { tint: [0.62, 0.72, 0.5] });
    K.tree(x0 + 6.5, -8, CY + 3.5, 1.5, 0, { tint: [0.66, 0.74, 0.52] });
  }

  // --- Barracks against the east wall (intact, lean-to roof), cistern and courtyard dressing.
  {
    const x0 = IX1 - 7, x1 = IX1, z0 = -24, z1 = -6, H = CY + 5.5;
    const f = K.face(x0, x1, z0, z1, 'W'), ops = [];
    for (let i = 0; i < 5; i++) { const t = 1.8 + i * 3.6; ops.push(i === 2 ? { t0: t - 0.7, t1: t + 0.7, y0: CY, y1: CY + 2.4, arch: true, fill: 'door', ring: true } : { t0: t - 0.4, t1: t + 0.4, y0: CY + 1.3, y1: CY + 2.5, fill: 'grille', frame: true }); }
    K.wall(f, CY - 0.2, H, -0.6, 0, S, ops, { ...wo, gy: CY });
    for (const d of ['N', 'S']) K.wall(K.face(x0, x1, z0, z1, d), CY - 0.2, H, -0.6, 0, S, [], { ...wo, gy: CY });
    K.lean(x0, x1, z0, z1, H, H + 2.2, 'W', { ov: 0.5, wall: S, wallTint: st });
    K.col(x0, CY - 0.2, z0, x1, H, z1);
    K.well(0, 10, CY, { r: 1.1 });
    K.tree(-12, 18, CY + 7, 3.4, 0, { tint: [0.6, 0.7, 0.5], trunk: 0.45, col: true });
    for (let i = 0; i < 4; i++) K.barrel(IX1 - 2 - i * 0.8, -4.5, CY);
    K.cart(12, 20, CY, 1, { load: 'barrels' });
    // Stair to the south wall-walk along its inner face (ascending west).
    K.stair(10, IZ1 - 1.0, 2.0, 'W', 26, (WY - CY) / 26, 0.4, S, CY, { tint: st, gy: CY });
    ctx.navPts([[4, CY + 4.5, IZ1 - 1.0], [-2, CY + 8.8, IZ1 - 1.0], [-4, WY, Z1 - 1.2], [-2, WY, Z1 - 1.2], [4, WY, Z1 - 1.2], [10, WY, Z1 - 1.2], [16, WY, Z1 - 1.2]]);
  }
  // Breach rubble ramp (walkable mound from the pad up to the courtyard).
  {
    const bx = X1, zc = (breach[0] + breach[1]) / 2;
    for (let i = 0; i < 8; i++) {
      const x0 = bx + 8 - i, y = (i + 1) * (CY + 0.4) / 8;
      K.box(S, x0 - 1, -0.5, breach[0] + 0.2 + i * 0.1, x0, y, breach[1] - 0.2 - i * 0.1, { tint: st.map((v) => v * 0.85), col: true, d: false });
    }
    for (let i = 0; i < 34; i++) {
      const x = bx + R() * 9, z = zc + (R() - 0.5) * 12, s = 0.25 + R() * 0.55, y = Math.max(0, (1 - (x - bx) / 9) * (CY + 0.5));
      K.box(S, x - s, y - s, z - s, x + s, y + s * 0.7, z + s, { tint: st.map((v) => v * (0.75 + R() * 0.3)), d: i > 14 });
    }
    ctx.navPts([[bx + 6, 1.1, zc], [bx + 3, 2.4, zc], [bx, CY, zc], [bx - 3, CY, zc]]);
  }
  // Vegetation outside the walls.
  K.cypress(-36, 46, 12, 1.1); K.cypress(-4, 48, 11, 1.0); K.cypress(-40, 38, 13, 1.1); K.pine(44, 36, 12, 6); K.pine(-50, -20, 11, 5.5);
  K.tree(45, -8, 5, 2.5, 0, { tint: [0.62, 0.7, 0.5] }); K.tree(-48, 8, 4.6, 2.2, 0, { tint: [0.62, 0.7, 0.5] });

  ctx.navRect(IX0 + 1, IZ0 + 1, IX1 - 1, IZ1 - 1, CY, 5);
  ctx.spawnsLocal([[0, 0, CY], [-10, 12, CY], [12, -2, CY], [-12, -14, CY], [8, 22, CY], [-20, 44], [30, 46]]);
  ctx.enemy = { x: 0, z: 2, y: CY, r: 32 };
}
