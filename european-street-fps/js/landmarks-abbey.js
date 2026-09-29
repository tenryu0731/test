// San Vivaldo abbey: ashlar abbey church (façade with porch, transept, apse) facing the forecourt,
// tall bell tower, cloister (arcades on colonnettes around a garden with a well), chapter/refectory
// range, two-storey dormitory, guest range with the cloister entrance, walled kitchen garden.
import { portalDeco, rose, lombardBand, campanile, lowWall } from './landmarks-church.js';

export function buildAbbey(K, ctx) {
  const M = K.M, R = ctx.R, S = M.stone, T = M.stoneTrim, L = ctx.L;
  const ash = [1.0, 0.97, 0.9], rub = [1.0, 0.96, 0.9];
  const cw = { tint: ash, uvOff: [0.3, 0.1] }, rw = { tint: rub };

  // ---------------- church: nave x∈[-28,-16], façade at z = -6 (south), transept and apse north.
  const NX0 = -28, NX1 = -16, NZ0 = -44, NZ1 = -6, NH = 14.5;
  const TX0 = -36, TX1 = -8, TZ0 = -44, TZ1 = -34, TH = 12.5;
  {
    const fac = K.face(NX0, NX1, NZ0, NZ1, 'S');          // t = x - NX0
    const portal = { t0: 4.8, t1: 7.2, y0: 0.3, y1: 3.6, arch: true, fill: 'door' };
    K.wall(fac, -3, NH, -1.0, 0, T, [portal, { t0: 4.9, t1: 7.1, y0: 7.2, y1: 8.6, arch: true, bifora: true, fill: 'glass' }], cw);
    portalDeco(K, fac, 4.8, 7.2, 3.6, 0, { orders: 3 });
    rose(K, fac, 6, 11.4, 1.1, 0, { w: 0.32 });
    for (const t of [-0.1, 11.4]) K.fbox(fac, T, t, t + 0.7, 0, NH, -0.2, 0.2, { tint: 0.94 });
    K.fbox(fac, T, 0, 12, 5.6, 5.85, -0.1, 0.18, { gao: false, tint: 0.94 });
    lombardBand(K, fac, 0.6, 11.4, NH - 0.05, 0, { s: 0.9 });
    // Porch (protiro): two columns on plinths carrying a small gable roof.
    for (const s of [-1, 1]) {
      const x = NX0 + 6 + s * 1.9;
      K.box(T, x - 0.35, 0, NZ1 + 2.3, x + 0.35, 0.9, NZ1 + 3.0, { tint: 0.95, col: true });
      K.cyl(T, x, 0.9, NZ1 + 2.65, 0.2, 2.9, 10, {});
      K.box(T, x - 0.3, 3.8, NZ1 + 2.35, x + 0.3, 4.1, NZ1 + 2.95, { gao: false });
    }
    K.box(T, NX0 + 3.7, 4.1, NZ1, NX0 + 8.3, 4.6, NZ1 + 3.05, { tint: ash, gao: false });
    K.roof(NX0 + 3.7, NX0 + 8.3, NZ1, NZ1 + 3.05, 4.6, { axis: 'z', pitch: 0.5, ov: 0.2, wall: T, wallTint: ash, gables: 'end1' });
    K.box(M.paving, NX0 + 2.5, -0.4, NZ1, NX0 + 9.5, 0.3, NZ1 + 4.2, { col: true, tint: 0.95 });
    // Side walls (west visible; east faces the cloister walk).
    for (const dir of ['W', 'E']) {
      const f = K.face(NX0, NX1, NZ0, NZ1, dir), ops = [];
      for (let i = 0; i < 6; i++) { const t = (dir === 'W' ? 2.5 : 12.5) + i * 4.2; if (t > 27) continue; ops.push({ t0: t, t1: t + 0.7, y0: 8.6, y1: 11.2, arch: true, fill: 'glass', ring: true, ringW: 0.16 }); }
      K.wall(f, -3, NH, -1.0, 0, T, ops, cw);
      for (let i = 0; i <= 6; i++) K.fbox(f, T, Math.min(f.W - 0.8, i * 4.2 + 0.3), Math.min(f.W, i * 4.2 + 1.0), 0, NH - 0.4, -0.2, 0.25, { tint: 0.93 });
      lombardBand(K, f, 0.2, f.W - 0.2, NH - 0.05, 0, { s: 0.95 });
    }
    K.roof(NX0, NX1, NZ0, NZ1, NH, { axis: 'z', pitch: 0.4, ov: 0.35, wall: T, wallTint: ash });
    // Transept.
    for (const dir of ['N', 'S', 'E', 'W']) {
      const f = K.face(TX0, TX1, TZ0, TZ1, dir);
      const ops = [];
      if (dir === 'E' || dir === 'W') ops.push({ t0: 4.4, t1: 5.6, y0: 7.2, y1: 9.8, arch: true, fill: 'glass', ring: true });
      if (dir === 'S') { ops.push({ t0: 3.4, t1: 4.2, y0: 6.8, y1: 9.2, arch: true, fill: 'glass', ring: true }); ops.push({ t0: 23.8, t1: 24.6, y0: 6.8, y1: 9.2, arch: true, fill: 'glass', ring: true }); }
      if (dir === 'S') {
        K.wall(K.subFace(f, 0, 8), -3, TH, -1, 0, T, ops.filter((o) => o.t1 < 8), cw);
        K.wall(K.subFace(f, 20, 8), -3, TH, -1, 0, T, ops.filter((o) => o.t0 > 20).map((o) => ({ ...o, t0: o.t0 - 20, t1: o.t1 - 20 })), cw);
      } else if (dir === 'N') {
        K.wall(K.subFace(f, 0, 8), -3, TH, -1, 0, T, [], cw);
        K.wall(K.subFace(f, 20, 8), -3, TH, -1, 0, T, [], cw);
      } else K.wall(f, -3, TH, -1, 0, T, ops, cw);
      if (dir === 'E' || dir === 'W') lombardBand(K, f, 0.2, f.W - 0.2, TH - 0.05, 0, { s: 0.95 });
    }
    rose(K, K.face(TX0, TX1, TZ0, TZ1, 'W'), 5, 13.7, 0.7, 0, { w: 0.22 });
    K.roof(TX0, NX0, TZ0, TZ1, TH, { axis: 'x', pitch: 0.4, ov: 0.35, wall: T, wallTint: ash, gables: 'end1' });
    K.roof(NX1, TX1, TZ0, TZ1, TH, { axis: 'x', pitch: 0.4, ov: 0.35, wall: T, wallTint: ash, gables: 'end0' });
    // Apse with slit windows and half-columns.
    K.apseWall(-22, NZ0, 5, -3, 10.5, 'N', T, { ...cw, cornice: true, segs: 11 });
    for (let k = 1; k < 6; k++) {
      const a = -Math.PI / 2 - Math.PI / 2 + (k * Math.PI) / 6, x = -22 + Math.cos(a) * 5.05, z = NZ0 + Math.sin(a) * 5.05;
      K.cyl(T, x, 0, z, 0.22, 10.2, 8, { tint: 0.94 });
      if (k === 2 || k === 3 || k === 4) {
        const am = a + Math.PI / 12, wx = -22 + Math.cos(am) * 5.02, wz = NZ0 + Math.sin(am) * 5.02;
        K.box(S, wx - 0.2, 4.5, wz - 0.2, wx + 0.2, 7.2, wz + 0.2, { tint: 0.06, gao: false });
      }
    }
    K.apseRoof(-22, NZ0, 5, 10.5, 3.0, 'N', { segs: 11 });
    K.col(NX0, -3, NZ0, NX1, NH, NZ1); K.col(TX0, -3, TZ0, TX1, TH, TZ1);
    K.col(-27, -3, NZ0 - 5, -17, 10, NZ0);
  }

  // ---------------- bell tower in the angle of transept and north range (viewpoint).
  {
    const bx0 = -8, bz0 = -50.6, bw = 6.4;
    const fy = campanile(K, bx0, bz0, bw, 25.5, { door: 'E', mat: T, tint: ash, belfryH: 6, roofH: 4.2, courses: [9, 17.5], uvOff: [0.2, 0.4] });
    ctx.viewpoints.push({ id: 'abbey-tower', name: 'サン・ヴィヴァルド修道院の鐘楼', base: K.V(bx0 + bw + 1.1, 0, bz0 + bw / 2), top: K.V(bx0 + bw / 2 - 0.9, fy, bz0 + bw / 2 + 0.9), yaw: Math.atan2(K.wx(0, 0), K.wz(0, 0)) });
  }

  // ---------------- conventual ranges.
  const range = (x0, x1, z0, z1, H, faces, o = {}) => {
    for (const dir of ['N', 'S', 'E', 'W']) {
      if (o.skip && o.skip.includes(dir)) continue;
      const f = K.face(x0, x1, z0, z1, dir);
      K.wall(f, -3, H, -0.7, 0, S, faces[dir] ? faces[dir](f) : [], { ...rw, top: H });
      K.fbox(f, T, -0.05, f.W + 0.05, H - 0.3, H, -0.1, 0.12, { gao: false, tint: 0.95 });
    }
    K.roof(x0, x1, z0, z1, H, { axis: o.axis, pitch: 0.36, ov: 0.55, wall: S, wallTint: rub, hip: o.hip });
    K.col(x0, -3, z0, x1, H, z1);
  };
  const windows = (f, y0, y1, sp, o = {}) => {
    const ops = [], n = Math.max(1, Math.floor(f.W / sp));
    for (let i = 0; i < n; i++) {
      const t = (f.W / n) * (i + 0.5);
      if (o.skip && o.skip(t)) continue;
      ops.push({ t0: t - (o.w ?? 0.45), t1: t + (o.w ?? 0.45), y0, y1, fill: 'glass', frame: true, arch: !!o.arch, shutters: o.shut });
    }
    return ops;
  };
  // North range (chapter house below, refectory): x∈[-8, 28], z∈[-44, -34].
  range(-8, 18, -44, -34, 9, {
    N: (f) => [...windows(f, 2.0, 3.6, 4.2, { arch: true, w: 0.5 }), ...windows(f, 5.6, 7.2, 4.2, { w: 0.45 })],
    S: (f) => [...windows(f, 5.6, 7.2, 3.4, { w: 0.4 })],
  }, { axis: 'x', skip: ['W'] });
  // Dormitory (east range): x∈[18, 28], z∈[-44, -2], two storeys and a chimney row.
  range(18, 28, -44, -2, 10.4, {
    E: (f) => [...windows(f, 2.2, 3.6, 3.5, { w: 0.42 }), ...windows(f, 6.2, 7.8, 2.6, { w: 0.4, shut: 0 })],
    W: (f) => [...windows(f, 6.2, 7.8, 2.6, { w: 0.4 })],
    S: (f) => [{ t0: 4.3, t1: 5.7, y0: 0, y1: 2.5, arch: true, fill: 'door', ring: true }, ...windows(f, 6.2, 7.8, 3.3, { w: 0.42 })],
    N: (f) => windows(f, 6.2, 7.8, 3.3, { w: 0.42 }),
  }, { axis: 'z' });
  for (const z of [-40, -26, -12]) { K.box(S, 24.5, 10, z - 0.5, 25.6, 13.6, z + 0.5, { tint: rub }); K.box(M.roof, 24.3, 13.6, z - 0.7, 25.8, 13.8, z + 0.7, { gao: false }); }
  // South (guest/cellarium) range with the cloister entrance passage: x∈[-16, 18], z∈[-8, -1].
  {
    const x0 = -16, x1 = 18, z0 = -8, z1 = -1, H = 7.2, px0 = 0, px1 = 3.2;
    for (const [a, b] of [[x0, px0], [px1, x1]]) {
      const fS = K.face(a, b, z0, z1, 'S');
      const ops = windows(fS, 1.2, 2.5, 3.3, { w: 0.42, shut: 1 }).concat(windows(fS, 4.4, 5.8, 3.3, { w: 0.42, shut: 1 }));
      K.wall(fS, -3, H, -0.7, 0, S, ops, { ...rw, top: H });
      K.wall(K.face(a, b, z0, z1, 'N'), -3, H, -0.7, 0, S, windows(K.face(a, b, z0, z1, 'N'), 4.4, 5.8, 3.3, { w: 0.4 }), { ...rw, top: H });
      K.col(a, -3, z0, b, H, z1);
    }
    for (const dir of ['E', 'W']) K.wall(K.face(x0, x1, z0, z1, dir), -3, H, -0.7, 0, S, [], rw);
    // Passage: arched gateway through the range.
    for (const dir of ['S', 'N']) {
      const f = K.face(px0, px1, z0, z1, dir);
      K.wall(f, 3.0 + 1.6, H, -0.7, 0, S, [], rw);
      K.ring(f, 1.6, 3.0, 1.6, 0.3, -0.05, 0.08, T, { gao: false }, dir === 'S');
      K.spandrel(f, S, 1.6, 3.0, 1.6, 4.6, -0.7, 0, rw, false);
    }
    K.box(S, px0 - 0.02, 0, z0, px0 + 0.02, 4.6, z1, { tint: 0.7 }); K.box(S, px1 - 0.02, 0, z0, px1 + 0.02, 4.6, z1, { tint: 0.7 });
    K.box(S, px0, 4.4, z0, px1, 4.62, z1, { tint: 0.5, gao: false });
    K.box(M.paving, px0, -0.1, z0 - 0.5, px1, 0.05, z1 + 0.5, { gao: false, cast: false });
    K.col(px0, 4.4, z0, px1, H, z1);
    K.roof(x0, x1, z0, z1, H, { axis: 'x', pitch: 0.36, ov: 0.5, wall: S, wallTint: rub });
    lombardBand(K, K.face(px0 - 1, px1 + 1, z0, z1, 'S'), 0, 5.2, 6.2, 0, { s: 0.87 });
    ctx.navPts([[1.6, 0, 1], [1.6, 0, -2.5], [1.6, 0, -5.5], [1.6, 0, -9.5]]);
  }

  // ---------------- cloister: walks around a garth x∈[-12.4, 14.4], z∈[-30.4, -11.6].
  {
    const CX0 = -16, CX1 = 18, CZ0 = -34, CZ1 = -8, D = 3.6, AH = 4.4, SP = 2.35;
    const GX0 = CX0 + D, GX1 = CX1 - D, GZ0 = CZ0 + D, GZ1 = CZ1 - D;
    const sides = [
      { dir: 'N', rect: [GX0, GX1, GZ0 - 0.5, GZ0], low: 'S', roof: [CX0, CX1, CZ0, GZ0] },
      { dir: 'S', rect: [GX0, GX1, GZ1, GZ1 + 0.5], low: 'N', roof: [CX0, CX1, GZ1, CZ1] },
      { dir: 'W', rect: [GX0 - 0.5, GX0, GZ0 - 0.5, GZ1 + 0.5], low: 'E', roof: [CX0, GX0, GZ0, GZ1] },
      { dir: 'E', rect: [GX1, GX1 + 0.5, GZ0 - 0.5, GZ1 + 0.5], low: 'W', roof: [GX1, CX1, GZ0, GZ1] },
    ];
    for (const sd of sides) {
      // Arcade wall faces the garth: build it on the garth-facing face of a 0.5 m slab.
      const inward = { N: 'S', S: 'N', W: 'E', E: 'W' }[sd.dir];
      const f = K.face(...sd.rect, inward);
      const n = Math.round((f.W - 0.5) / SP), sp = (f.W - 0.5) / n, ops = [];
      for (let i = 0; i < n; i++) {
        const t0 = 0.25 + i * sp + 0.2, t1 = 0.25 + (i + 1) * sp - 0.2;
        ops.push({ t0, t1, y0: i === Math.floor(n / 2) ? 0 : 0.55, y1: 2.55, arch: true, fill: 'open' });
      }
      K.wall(f, -0.5, AH, -0.5, 0, T, ops, { tint: ash, back: true, col: true });
      K.fbox(f, T, -0.05, f.W + 0.05, AH - 0.05, AH + 0.12, -0.6, 0.1, { gao: false });
      // Paired colonnettes with capitals at every pier (both faces).
      for (let i = 1; i < n; i++) {
        const t = 0.25 + i * sp;
        for (const d of [0.1, -0.6]) {
          const p = K.fp(f, t, 0, d);
          K.cyl(T, p[0], 0.55, p[2], 0.1, 1.72, 8, { d: true });
          K.fbox(f, T, t - 0.2, t + 0.2, 2.27, 2.55, d - 0.12, d + 0.12, { gao: false, d: true });
        }
      }
      for (let i = 0; i < n; i++) {
        const t0 = 0.25 + i * sp + 0.2, t1 = 0.25 + (i + 1) * sp - 0.2;
        K.ring(f, (t0 + t1) / 2, 2.55, (t1 - t0) / 2, 0.14, -0.02, 0.04, T, { gao: false, tint: 0.96 });
      }
      const [rx0, rx1, rz0, rz1] = sd.roof;
      K.lean(rx0, rx1, rz0, rz1, AH + 0.1, AH + 1.6, sd.low, { ov: 0.45, ovSides: 0 });
      // Walk floor.
      K.box(M.paving, rx0, -0.1, rz0, rx1, 0.04, rz1, { tint: 0.95, gao: false, cast: false });
    }
    // Garth: cross paths, four box-hedged beds, central well.
    const gx = (GX0 + GX1) / 2, gz = (GZ0 + GZ1) / 2;
    K.box(L.gravel, GX0, -0.1, gz - 1.1, GX1, 0.03, gz + 1.1, { cast: false });
    K.box(L.gravel, gx - 1.1, -0.1, GZ0, gx + 1.1, 0.03, GZ1, { cast: false });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx0 = sx < 0 ? GX0 + 1 : gx + 1.6, bx1 = sx < 0 ? gx - 1.6 : GX1 - 1, bz0 = sz < 0 ? GZ0 + 1 : gz + 1.6, bz1 = sz < 0 ? gz - 1.6 : GZ1 - 1;
      K.hedge(bx0, bz0, bx1, bz0 + 0.45, 0.55); K.hedge(bx0, bz1 - 0.45, bx1, bz1, 0.55);
      K.hedge(bx0, bz0 + 0.45, bx0 + 0.45, bz1 - 0.45, 0.55); K.hedge(bx1 - 0.45, bz0 + 0.45, bx1, bz1 - 0.45, 0.55);
      K.tree((bx0 + bx1) / 2, (bz0 + bz1) / 2, 3.2, 1.3, 0, { tint: [0.75, 0.9, 0.6], d: false });
    }
    K.box(T, gx - 1.9, -0.2, gz - 1.9, gx + 1.9, 0.3, gz + 1.9, { col: true, tint: 0.95 });
    K.well(gx, gz, 0.3, { r: 0.95, posts: T });
    ctx.navRect(CX0 + 1.6, CZ0 + 1.6, CX1 - 1.6, CZ1 - 1.6, 0, 3);
  }

  // ---------------- kitchen garden (orto) east of the dormitory.
  {
    const x0 = 31, x1 = 56, z0 = -44, z1 = -4;
    lowWall(K, x0, z0, x1, z0 + 0.45, 1.6, S, { tint: rub });
    lowWall(K, x1 - 0.45, z0, x1, z1, 1.6, S, { tint: rub });
    lowWall(K, x0, z0, x0 + 0.45, z1, 1.6, S, { tint: rub });
    lowWall(K, x0, z1 - 0.45, 41.5, z1, 1.6, S, { tint: rub });
    lowWall(K, 45.5, z1 - 0.45, x1, z1, 1.6, S, { tint: rub });
    for (const x of [41.1, 45.5]) { K.sbox(T, x - 0.2, 0, z1 - 0.6, x + 0.4, 2.2, z1 + 0.15); }
    // Raised beds with vegetable rows, trellised beans, a gravel spine.
    K.box(L.gravel, 42, -0.1, z0 + 0.5, 45, 0.03, z1 - 0.5, { cast: false });
    for (let i = 0; i < 6; i++) for (const side of [0, 1]) {
      const bx0 = side ? 46 : 32.5, bx1 = side ? 54.5 : 41, bz0 = z0 + 2 + i * 6.2, bz1 = bz0 + 4.4;
      K.box(M.wood, bx0, -0.1, bz0, bx1, 0.34, bz1, { tint: [0.85, 0.75, 0.6] });
      K.box(L.soil, bx0 + 0.08, 0.3, bz0 + 0.08, bx1 - 0.08, 0.38, bz1 - 0.08, { gao: false });
      const kind = (i + side) % 3;
      for (let r = 0; r < 4; r++) {
        const rz = bz0 + 0.6 + r * 1.07;
        if (kind === 0) for (let k = 0; k < 11; k++) K.blob(M.plant, bx0 + 0.5 + k * ((bx1 - bx0 - 1) / 10), 0.5, rz, 0.28, 0.2, 0.28, { tint: [0.9, 1.05, 0.7], detail: 0, d: true });
        else if (kind === 1) K.box(M.plant, bx0 + 0.3, 0.36, rz - 0.18, bx1 - 0.3, 0.72, rz + 0.18, { tint: [0.85, 1.0, 0.65], gao: false, d: true });
        else { for (let k = 0; k < 6; k++) K.beam(M.wood, [bx0 + 0.5 + k * ((bx1 - bx0 - 1) / 5), 0.38, rz], [bx0 + 0.5 + k * ((bx1 - bx0 - 1) / 5), 2.0, rz], 0.04, 0.04, { d: true }); K.box(M.plant, bx0 + 0.4, 0.5, rz - 0.12, bx1 - 0.4, 1.9, rz + 0.12, { tint: [0.8, 0.95, 0.62], gao: false, d: true }); }
      }
    }
    // Espaliered fruit trees along the north wall, beehives, tool shed, well.
    for (let i = 0; i < 6; i++) K.tree(33 + i * 4.2, z0 + 1.8, 3.6, 1.4, 0, { tint: [0.75, 0.86, 0.58] });
    for (let i = 0; i < 4; i++) { const hx = 52.5, hz = -30 + i * 1.4; K.box(M.wood, hx - 0.35, 0.3, hz - 0.3, hx + 0.35, 0.95, hz + 0.3, { tint: [1.1, 1.0, 0.8], d: true }); K.box(M.roof, hx - 0.42, 0.95, hz - 0.36, hx + 0.42, 1.05, hz + 0.36, { d: true, gao: false }); }
    K.box(M.wood, 49.5, 0, -12, 55.4, 2.6, -8, { tint: [0.9, 0.82, 0.7], col: true });
    K.lean(49.5, 55.4, -12, -8, 2.5, 3.1, 'S', { ov: 0.3 });
    K.well(38, -9);
    ctx.navRect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, 0, 4);
  }

  // ---------------- forecourt, trees, approach.
  K.box(L.gravel, -34, -0.1, -1, 22, 0.03, 12, { cast: false });
  K.cypress(-32, 4, 13, 1.1); K.cypress(-12, 4, 12, 1.05); K.cypress(-38, -20, 14, 1.15); K.cypress(-38, -30, 12.5, 1.05);
  K.pine(-44, 8, 12, 6); K.tree(24, 6, 5.2, 2.4, 0, { tint: [0.64, 0.74, 0.54], col: true });
  const rd = [0.36, 0.935], nrm = [0.935, -0.36];
  for (let d = 16; d < 60; d += 9) for (const s of [-1, 1]) {
    const x = rd[0] * d + nrm[0] * s * 5, z = rd[1] * d + nrm[1] * s * 5;
    if (ctx.roadClear(x, z, 3) && Math.hypot(x, z) < 58) K.cypress(x, z, 11 + R() * 3, 1.0 + R() * 0.15);
  }
  K.bench(-12, 1.5, 2.2, 0, 0, { stone: true });

  ctx.spawnsLocal([[4, 6], [-8, 8], [-24, 6], [1, -20], [10, -26], [-8, -14], [43, -24], [38, -36], [12, 10]]);
  ctx.enemy = { x: 4, z: -8, r: 36 };
}
