// Villa Belvedere: symmetrical three-storey Renaissance villa (ground-floor loggia, pedimented
// piano-nobile windows, rusticated quoins, bracketed cornice, hip roof with an open belvedere that
// is a walkable viewpoint), raised front terrace, rondeau with fountain, cypress avenue along the
// arriving road, formal Italian garden behind (box parterres, gravel walks, fountain, lemon pots,
// topiary, statues, tall hedge enclosure) and a limonaia.

export function buildVilla(K, ctx) {
  const M = K.M, R = ctx.R, T = M.stoneTrim, L = ctx.L, P = M.plaster[0];
  const pt = [1.02, 1.0, 0.97], wo = { tint: pt, uvOff: [0.4, 0.2] };
  const X0 = -15, X1 = 15, Z0 = 14, Z1 = 30, H = 13.2, G = 0.9;       // G: terrace / floor level
  const F1 = G + 4.4, F2 = F1 + 4.6;

  // ---------------- terrace with steps and balustrade in front of the villa.
  K.box(T, X0 - 1, -1.5, Z0 - 4.5, X1 + 1, G, Z0, { col: true, tint: 0.95 });
  K.box(M.paving, X0 - 0.9, G - 0.02, Z0 - 4.4, X1 + 0.9, G + 0.02, Z0, { gao: false, cast: false });
  K.stair(0, Z0 - 4.5 - 1.35, 6, 'S', 3, G / 3, 0.45, T, 0, { tint: 0.95 });
  for (const s of [-1, 1]) {
    // Balustrade: plinth, balusters (detail), handrail; broken by the central steps.
    const a = s < 0 ? X0 - 1 : 3.2, b = s < 0 ? -3.2 : X1 + 1;
    K.box(T, a, G, Z0 - 4.5, b, G + 0.18, Z0 - 4.2, { gao: false, col: true });
    K.box(T, a, G + 0.85, Z0 - 4.55, b, G + 1.0, Z0 - 4.15, { gao: false });
    K.col(a, G, Z0 - 4.5, b, G + 1.0, Z0 - 4.2);
    for (let x = a + 0.2; x < b - 0.1; x += 0.32) K.cyl(T, x, G + 0.18, Z0 - 4.35, 0.07, 0.67, 6, { d: true });
    K.box(T, s < 0 ? -3.6 : 3.2, G, Z0 - 4.6, s < 0 ? -3.2 : 3.6, G + 1.15, Z0 - 4.1, {});
    K.lemonPot(s * 4.0, Z0 - 5.6, 0);
    const ex = s < 0 ? X0 - 1 : X1 + 1;
    K.box(T, ex - 0.2, G, Z0 - 4.5, ex + 0.2, G + 1.0, Z0, { gao: false, col: true });
  }

  // ---------------- main block.
  const bays = 7, bw = (X1 - X0) / bays;
  const faceOps = (f, front) => {
    const ops = [], n = Math.round(f.W / bw), w = f.W / n;
    for (let i = 0; i < n; i++) {
      const c = w * (i + 0.5), centre = front && i >= 2 && i <= 4;
      if (front && centre) ops.push({ t0: c - 1.45, t1: c + 1.45, y0: G, y1: G + 2.4, arch: true, fill: 'open', ring: true, ringW: 0.3, keystone: true });
      else if (!front && i === Math.floor(n / 2) && f.dir === 'S') ops.push({ t0: c - 0.9, t1: c + 0.9, y0: G, y1: G + 2.7, arch: true, fill: 'door', frame: true, keystone: true });
      else ops.push({ t0: c - 0.55, t1: c + 0.55, y0: G + 1.1, y1: G + 2.7, fill: 'glass', frame: true, shutters: 0 });
      ops.push({ t0: c - 0.62, t1: c + 0.62, y0: F1 + 1.0, y1: F1 + 3.3, fill: 'glass', frame: true, pediment: true, shutters: 0, frameW: 0.16 });
      ops.push({ t0: c - 0.45, t1: c + 0.45, y0: F2 + 0.9, y1: F2 + 2.2, fill: 'glass', frame: true, shutters: 0, frameW: 0.12 });
    }
    return ops;
  };
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(X0, X1, Z0, Z1, dir);
    K.wall(f, -2, H, -0.6, 0, P, faceOps(f, dir === 'N'), { ...wo, top: H, gy: dir === 'N' ? G : 0 });
    // Rusticated quoins, plinth, string courses, bracketed cornice.
    for (let y = 0, k = 0; y < H - 0.4; y += 0.55, k++) {
      const e = k % 2 ? 0.55 : 0.9;
      K.fbox(f, T, -0.04, e, y, y + 0.5, -0.1, 0.06, { gao: y < 1, tint: 0.97 });
      K.fbox(f, T, f.W - e, f.W + 0.04, y, y + 0.5, -0.1, 0.06, { gao: y < 1, tint: 0.97 });
    }
    K.fbox(f, T, -0.05, f.W + 0.05, -1, G + 0.35, -0.1, 0.1, { tint: 0.9 });
    K.fbox(f, T, -0.05, f.W + 0.05, F1 - 0.1, F1 + 0.12, -0.1, 0.1, { gao: false });
    K.fbox(f, T, -0.05, f.W + 0.05, F2 - 0.05, F2 + 0.1, -0.1, 0.08, { gao: false });
    K.fbox(f, T, -0.3, f.W + 0.3, H - 0.25, H, -0.1, 0.45, { gao: false });
    for (let t = 0.4; t < f.W - 0.2; t += 0.75) K.fbox(f, T, t - 0.08, t + 0.08, H - 0.55, H - 0.25, -0.05, 0.36, { gao: false, ao: 0.9, d: true });
  }
  // Loggia behind the three front arches: back wall with door and windows, ceiling, floor.
  {
    const lx0 = X0 + 2 * bw - 0.1, lx1 = X0 + 5 * bw + 0.1, lz = Z0 + 3.2;
    K.box(M.paving, lx0, G - 0.05, Z0 - 0.02, lx1, G + 0.02, lz, { gao: false, cast: false, tint: 0.9 });
    const f = K.face(lx0, lx1, lz, lz + 0.5, 'N');
    K.wall(f, G, F1, -0.5, 0, P, [{ t0: f.W / 2 - 0.9, t1: f.W / 2 + 0.9, y0: G, y1: G + 2.6, fill: 'door', frame: true, arch: true },
      { t0: 1.2, t1: 2.3, y0: G + 0.9, y1: G + 2.6, fill: 'glass', frame: true }, { t0: f.W - 2.3, t1: f.W - 1.2, y0: G + 0.9, y1: G + 2.6, fill: 'glass', frame: true }], { tint: pt.map((v) => v * 0.85), gy: G });
    for (const x of [lx0, lx1]) K.box(P, x - 0.3, G, Z0, x + 0.3, F1, lz, { tint: pt.map((v) => v * 0.8), gy: G });
    K.box(P, lx0, F1 - 0.3, Z0, lx1, F1, lz, { tint: 0.62, gao: false });
    K.col(lx0 - 0.3, -2, lz, lx1 + 0.3, H, Z1);
    K.col(X0, -2, Z0, lx0, H, Z1); K.col(lx1, -2, Z0, X1, H, Z1);
    K.col(lx0, F1 - 0.4, Z0, lx1, H, lz);
    // Arcade piers of the front wall are colliders.
    for (let i = 2; i <= 5; i++) { const x = X0 + i * bw; K.col(x - (bw / 2 - 1.45), G, Z0 - 0.6, x + (bw / 2 - 1.45), F1, Z0); }
  }
  // Hip roof and the belvedere (altana): an open loggia above the ridge.
  K.roof(X0, X1, Z0, Z1, H, { hip: true, pitch: 0.32, ov: 0.9, axis: 'x' });
  const BX0 = -3.6, BX1 = 3.6, BZ0 = 18.4, BZ1 = 25.6, BF = H + 3.3, BH = BF + 3.6;
  for (const dir of ['N', 'S', 'E', 'W']) {
    const f = K.face(BX0, BX1, BZ0, BZ1, dir);
    K.wall(f, H, BF, -0.5, 0, P, [], { ...wo, gao: false });
    K.fbox(f, T, -0.1, f.W + 0.1, BF - 0.15, BF + 0.1, -0.1, 0.14, { gao: false });
    const ops = [0, 1, 2].map((i) => ({ t0: 0.55 + i * 2.2, t1: 0.55 + i * 2.2 + 1.7, y0: BF + 1.0, y1: BF + 2.5, arch: true, fill: 'open', ring: true, ringW: 0.16 }));
    K.wall(f, BF, BH, -0.4, 0, P, ops, { ...wo, back: true, gao: false });
    K.fbox(f, T, -0.2, f.W + 0.2, BH - 0.2, BH + 0.05, -0.1, 0.3, { gao: false });
    K.fbox(f, T, -0.05, 0.4, BF, BH, -0.08, 0.05, { gao: false }); K.fbox(f, T, f.W - 0.4, f.W + 0.05, BF, BH, -0.08, 0.05, { gao: false });
  }
  K.box(M.paving, BX0 + 0.3, BF - 0.1, BZ0 + 0.3, BX1 - 0.3, BF, BZ1 - 0.3, { tint: 0.8, gao: false });
  K.box(P, BX0 + 0.4, BH - 0.35, BZ0 + 0.4, BX1 - 0.4, BH - 0.2, BZ1 - 0.4, { tint: 0.7, gao: false });
  K.roof(BX0, BX1, BZ0, BZ1, BH, { hip: true, pitch: 0.36, ov: 0.6 });
  K.col(BX0, H - 1, BZ0, BX1, BF, BZ1);
  for (const [a, b, c, d] of [[BX0, BZ0, BX1, BZ0 + 0.4], [BX0, BZ1 - 0.4, BX1, BZ1], [BX0, BZ0, BX0 + 0.4, BZ1], [BX1 - 0.4, BZ0, BX1, BZ1]]) K.col(a, BF, b, c, BF + 1.05, d);
  K.col(BX0, BH - 0.4, BZ0, BX1, BH + 2.5, BZ1);
  for (const x of [-9, 9]) { K.box(M.brick, x - 0.5, H + 1.2, 26, x + 0.5, H + 3.4, 27, {}); K.box(M.roof, x - 0.65, H + 3.4, 25.85, x + 0.65, H + 3.55, 27.15, { gao: false }); }
  ctx.viewpoints.push({ id: 'villa-belvedere', name: 'ヴィラ・ベルヴェデーレの見晴らし台', base: K.V(0, 0, Z0 - 6.2), top: K.V(0, BF, (BZ0 + BZ1) / 2), yaw: Math.atan2(K.wx(0, 0), K.wz(0, 0)) });

  // ---------------- rondeau with fountain, and the cypress avenue along the arriving road.
  const disc = (mat, cx, cz, r, y, n = 28, o = {}) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      K.tri(mat, [cx, y, cz], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [0, 1, 0], { gao: false, cast: false, ...o });
    }
  };
  disc(L.gravel, 0, 0, 13, 0.03);
  K.box(L.gravel, -12, -0.1, 0, 12, 0.03, Z0 - 4.5, { cast: false });
  fountain(K, 0, 0, 2.8);
  const rd = [-0.42, -0.91], nrm = [0.91, -0.42];
  for (let d = 18; d < 118; d += 8.5) for (const s of [-1, 1]) {
    const x = rd[0] * d + nrm[0] * s * 5.8, z = rd[1] * d + nrm[1] * s * 5.8;
    if (!ctx.roadClear(x, z, 2.2)) continue;
    const y = Math.hypot(x, z) < 66 ? 0 : ctx.groundLocal(x, z);
    K.cypress(x, z, 12 + R() * 3, 1.05 + R() * 0.15, y);
  }

  // ---------------- formal garden behind the villa.
  const GX0 = -27, GX1 = 27, GZ0 = 34, GZ1 = 64, gc = 49;
  K.box(L.gravel, GX0, -0.1, Z1, GX1, 0.03, GZ1, { cast: false });
  // Tall hedge enclosure with an exedra gap at the far end.
  K.hedge(GX0 - 1.4, GZ0 - 2, GX0, GZ1 + 1.4, 2.6, 0, { col: true, tint: [0.5, 0.66, 0.44] });
  K.hedge(GX1, GZ0 - 2, GX1 + 1.4, GZ1 + 1.4, 2.6, 0, { col: true, tint: [0.5, 0.66, 0.44] });
  K.hedge(GX0, GZ1, -3, GZ1 + 1.4, 2.6, 0, { col: true, tint: [0.5, 0.66, 0.44] });
  K.hedge(3, GZ1, GX1, GZ1 + 1.4, 2.6, 0, { col: true, tint: [0.5, 0.66, 0.44] });
  // Parterres: box-edged beds with inner knots and topiary cones.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const bx0 = sx < 0 ? GX0 + 2.5 : 2.5, bx1 = sx < 0 ? -2.5 : GX1 - 2.5;
    const bz0 = sz < 0 ? GZ0 + 1 : gc + 2.5, bz1 = sz < 0 ? gc - 2.5 : GZ1 - 2;
    const e = 0.45, hh = 0.6;
    K.hedge(bx0, bz0, bx1, bz0 + e, hh, 0, { col: true }); K.hedge(bx0, bz1 - e, bx1, bz1, hh, 0, { col: true });
    K.hedge(bx0, bz0 + e, bx0 + e, bz1 - e, hh, 0, { col: true }); K.hedge(bx1 - e, bz0 + e, bx1, bz1 - e, hh, 0, { col: true });
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, iw = (bx1 - bx0) / 2 - 3, id = (bz1 - bz0) / 2 - 2.6;
    K.hedge(cx - iw, cz - id, cx + iw, cz - id + 0.35, 0.45, 0, { d: false }); K.hedge(cx - iw, cz + id - 0.35, cx + iw, cz + id, 0.45);
    K.hedge(cx - iw, cz - id, cx - iw + 0.35, cz + id, 0.45); K.hedge(cx + iw - 0.35, cz - id, cx + iw, cz + id, 0.45);
    K.hedge(cx - 0.18, cz - id, cx + 0.18, cz + id, 0.45); K.hedge(cx - iw, cz - 0.18, cx + iw, cz + 0.18, 0.45);
    K.box(M.plant, cx - iw + 0.4, 0, cz - id + 0.4, cx + iw - 0.4, 0.12, cz + id - 0.4, { tint: [0.95, 0.75, 0.75], gao: false, cast: false, d: true });
    for (const [px, pz] of [[bx0 + 0.25, bz0 + 0.25], [bx1 - 0.25, bz0 + 0.25], [bx0 + 0.25, bz1 - 0.25], [bx1 - 0.25, bz1 - 0.25]]) {
      K.cone(M.plant, px, 0.5, pz, 0.55, 2.0, 8, { tint: [0.52, 0.68, 0.45] });
      K.col(px - 0.4, 0, pz - 0.4, px + 0.4, 2, pz + 0.4);
    }
  }
  fountain(K, 0, gc, 3.6, true);
  // Lemon pots along the main walk, statues at the cross-walk ends and in the exedra.
  for (let z = GZ0 + 1.5; z < GZ1 - 1; z += 4) if (Math.abs(z - gc) > 5) for (const s of [-1, 1]) K.lemonPot(s * 2.0, z, 0);
  for (const [x, z] of [[GX0 + 1.2, gc], [GX1 - 1.2, gc], [0, GZ1 + 3.2]]) {
    K.box(T, x - 0.5, 0, z - 0.5, x + 0.5, 1.3, z + 0.5, { col: true });
    K.box(T, x - 0.6, 1.3, z - 0.6, x + 0.6, 1.45, z + 0.6, { gao: false });
    K.cyl(T, x, 1.45, z, 0.28, 1.3, 8, { tint: 1.05 }); K.blob(T, x, 3.0, z, 0.2, 0.26, 0.2, { tint: 1.05, detail: 0 });
    K.box(T, x - 0.3, 2.1, z - 0.12, x + 0.3, 2.5, z + 0.12, { tint: 1.05, gao: false });
  }
  K.hedge(-6, GZ1 + 1.4, 6, GZ1 + 5.5, 3.0, 0, { col: true, tint: [0.5, 0.66, 0.44] });
  K.cypress(-4.2, GZ1 + 3.2, 13, 1.0); K.cypress(4.2, GZ1 + 3.2, 13, 1.0);

  // ---------------- limonaia west of the villa (big arched openings to the south).
  {
    const x0 = -40, x1 = -21, z0 = 16, z1 = 23, h = 5.4;
    const f = K.face(x0, x1, z0, z1, 'S'), ops = [];
    for (let i = 0; i < 5; i++) { const c = 1.9 + i * 3.8; ops.push({ t0: c - 1.2, t1: c + 1.2, y0: 0, y1: 3.2, arch: true, fill: 'glass', ring: true, keystone: true }); }
    K.wall(f, -2, h, -0.5, 0, M.plaster[1], ops, { top: h });
    for (const d of ['N', 'E', 'W']) K.wall(K.face(x0, x1, z0, z1, d), -2, h, -0.5, 0, M.plaster[1], [], { top: h });
    K.roof(x0, x1, z0, z1, h, { axis: 'x', pitch: 0.3, ov: 0.5, wall: M.plaster[1] });
    K.col(x0, -2, z0, x1, h, z1);
    for (let i = 0; i < 5; i++) K.lemonPot(x0 + 2 + i * 3.8, z1 + 1.4, 0);
  }
  // Scattered trees: holm oaks and an umbrella pine frame the villa.
  K.pine(28, 6, 13, 6.5); K.pine(-32, 2, 12, 6);
  K.tree(34, 26, 6, 3.0, 0, { tint: [0.55, 0.66, 0.46], col: true }); K.tree(-46, 34, 6, 3.0, 0, { tint: [0.55, 0.66, 0.46], col: true });
  for (let i = 0; i < 6; i++) K.tree(38 + (i % 2) * 7, 34 + i * 5, 4.2, 2.0, 0, { tint: [0.68, 0.74, 0.62] });

  ctx.navRect(-12, -12, 12, Z0 - 5, 0, 4);
  ctx.navRect(GX0 + 1, GZ0, GX1 - 1, GZ1 - 1, 0, 3);
  ctx.spawnsLocal([[6, 8], [-7, 7], [0, 38], [-12, gc], [12, gc], [0, 61], [-30, 28], [24, 28]]);
  ctx.enemy = { x: 0, z: 22, r: 44 };
}

// Round two-tier fountain with a basin rim, water, central shaft and spill jet.
function fountain(K, x, z, r, big = false) {
  const M = K.M, T = M.stoneTrim;
  K.cyl(T, x, -0.2, z, r, 0.65, 20, { tint: 0.95 });
  K.cyl(T, x, 0.45, z, r + 0.12, 0.12, 20, { gao: false });
  K.cyl(M.water, x, 0.5, z, r - 0.2, 0.02, 20, { gao: false, tint: 0.55 });
  K.cyl(T, x, 0.52, z, 0.35, big ? 1.6 : 1.2, 10, {});
  K.cyl(T, x, big ? 2.0 : 1.6, z, big ? 1.3 : 1.0, 0.25, 14, { gao: false });
  K.cyl(M.water, x, (big ? 2.0 : 1.6) + 0.26, z, big ? 1.1 : 0.85, 0.01, 12, { gao: false, tint: 0.6, d: true });
  K.cyl(T, x, (big ? 2.25 : 1.85), z, 0.16, 0.8, 8, { gao: false });
  K.cyl(M.waterJet, x, (big ? 2.25 : 1.85) + 0.8, z, 0.05, 0.7, 6, { gao: false, d: true });
  K.col(x - r, -0.2, z - r, x + r, 0.62, z + r);
  K.col(x - 0.4, 0, z - 0.4, x + 0.4, 2.2, z + 0.4);
}
