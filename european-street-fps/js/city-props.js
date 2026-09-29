// Street furniture and vegetation: the octagonal cistern fountain, wells, benches, café tables,
// crates, market stalls, laundry lines, planters, olive / cypress / fruit trees, low garden walls.
import * as THREE from 'three';
import { LOD } from './city-geo.js';

export function createProps(ctx) {
  const { geo, M, R, collide, decals, kit } = ctx;
  const { T, TPL, rr, setLod } = kit;
  const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lathe = (mat, pts, segs, o = {}, phi0 = 0, x = 0, z = 0) => {
    const g = new THREE.LatheGeometry(pts, segs, phi0);
    g.translate(x, 0, z);
    geo.geom(mat, g, null, { flat: true, gao: false, ...o });
    g.dispose();
  };

  function fountain(cx, cz) {
    geo.lock(cx, cz);
    setLod(LOD.BASE);
    lathe(T.trim, [V2(0, 0.06), V2(2.85, 0.06), V2(2.85, 0.4), V2(2.92, 0.42), V2(3.2, 0.42), V2(3.28, 0.39), V2(3.28, 0.3), V2(3.2, 0.27), V2(3.2, 0.1), V2(3.4, 0.06), V2(3.4, 0.0)].reverse(), 8, {}, Math.PI / 8, cx, cz);
    // Steps around the octagon.
    lathe(T.trim, [V2(4.1, 0), V2(4.1, 0.12), V2(3.4, 0.12)], 8, { tint: 0.92 }, Math.PI / 8, cx, cz);
    lathe(T.trim, [V2(0, 0.06), V2(0.48, 0.06), V2(0.48, 0.24), V2(0.32, 0.4), V2(0.24, 0.75), V2(0.3, 1.0), V2(0.26, 1.35), V2(0.34, 1.48), V2(0.2, 1.75), V2(0.26, 2.05), V2(0.16, 2.3), V2(0.22, 2.42), V2(0.1, 2.7), V2(0.14, 2.8), V2(0, 2.9)], 12, {}, 0, cx, cz);
    lathe(T.trim, [V2(0.3, 1.45), V2(0.9, 1.55), V2(1.35, 1.72), V2(1.42, 1.76), V2(1.42, 1.86), V2(1.32, 1.86), V2(0.9, 1.72), V2(0.3, 1.66)], 12, {}, 0, cx, cz);
    // The well frame over the cistern: two travertine pillars and an architrave with a pulley.
    for (const s of [-1, 1]) geo.box(T.trim, cx + s * 2.2 - 0.25, 0.42, cz - 0.25, cx + s * 2.2 + 0.25, 3.6, cz + 0.25, {});
    geo.box(T.trim, cx - 2.6, 3.6, cz - 0.32, cx + 2.6, 4.05, cz + 0.32, { gao: false });
    geo.box(T.iron, cx - 0.05, 3.1, cz - 0.05, cx + 0.05, 3.6, cz + 0.05, { gao: false });
    const water = (r, y, segs = 8) => {
      const g = new THREE.CircleGeometry(r, segs, segs === 8 ? Math.PI / 8 : 0); g.rotateX(-Math.PI / 2); g.translate(cx, y, cz);
      geo.geom(M.water, g, null, { gao: false });
      g.dispose();
    };
    water(2.86, 0.33); water(1.33, 1.82, 12);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8, ca = Math.cos(a), sa = Math.sin(a);
      const curve = new THREE.QuadraticBezierCurve3(V3(cx + ca * 1.42, 1.8, cz + sa * 1.42), V3(cx + ca * 1.75, 1.7, cz + sa * 1.75), V3(cx + ca * 2.0, 0.33, cz + sa * 2.0));
      const g = new THREE.TubeGeometry(curve, 6, 0.025, 4, false);
      geo.geom(M.waterJet, g, null, { gao: false }); g.dispose();
    }
    for (const s of [-1, 1]) collide(cx + (s > 0 ? 2.63 : -3.03), 0, cz - 1.26, cx + (s > 0 ? 3.03 : -2.63), 0.42, cz + 1.26);
    for (const s of [-1, 1]) collide(cx - 1.26, 0, cz + (s > 0 ? 2.63 : -3.03), cx + 1.26, 0.42, cz + (s > 0 ? 3.03 : -2.63));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const tau of [-1, -0.6, -0.2, 0.2, 0.6, 1]) {
      const x = cx + sx * (2.0 - 0.707 * tau), z = cz + sz * (2.0 + 0.707 * tau);
      collide(x - 0.2, 0, z - 0.2, x + 0.2, 0.42, z + 0.2);
    }
    collide(cx - 0.5, 0, cz - 0.5, cx + 0.5, 2.9, cz + 0.5);
    collide(cx - 1.3, 1.45, cz - 1.3, cx + 1.3, 1.9, cz + 1.3);
    for (const s of [-1, 1]) collide(cx + s * 2.2 - 0.25, 0, cz - 0.25, cx + s * 2.2 + 0.25, 4.05, cz + 0.25);
    decals.round(cx, cz, 4.6, 0.5);
    geo.unlock();
  }

  function well(x, z, s = 1) {
    geo.lock(x, z);
    setLod(LOD.BASE);
    const g = new THREE.LatheGeometry([V2(0, 0.3), V2(0.8, 0.3), V2(0.8, 1.0), V2(1.05, 1.0), V2(1.05, 0.9), V2(0.95, 0.85), V2(0.95, 0.0), V2(0, 0.0)].map((v) => v.multiplyScalar(s)).reverse(), 8);
    g.translate(x, 0, z);
    geo.geom(T.trim, g, null, { flat: true });
    g.dispose();
    geo.box(T.water ? T.water : T.glass, x - 0.6 * s, 0.85 * s, z - 0.6 * s, x + 0.6 * s, 0.88 * s, z + 0.6 * s, { gao: false, tint: 0.3, skip: 8 | 1 | 2 | 16 | 32 });
    setLod(LOD.DETAIL);
    for (const k of [-1, 1]) geo.box(T.iron, x + k * 0.9 * s - 0.04, s, z - 0.04, x + k * 0.9 * s + 0.04, 2.6, z + 0.04, { gao: false });
    geo.box(T.iron, x - 0.95 * s, 2.55, z - 0.04, x + 0.95 * s, 2.62, z + 0.04, { gao: false });
    geo.proto(T.metal, TPL.cyl8, x, 2.2, z, 0.12, 0.3, 0.12, 0, { gao: false, tint: 0.6 });
    setLod(LOD.BASE);
    collide(x - 1.0 * s, 0, z - 1.0 * s, x + 1.0 * s, 1.0 * s, z + 1.0 * s);
    decals.round(x, z, 1.6 * s, 0.45);
    geo.unlock();
  }

  function bench(x, z, alongX) {
    const [w, d] = alongX ? [1.9, 0.5] : [0.5, 1.9];
    setLod(LOD.BASE);
    geo.box(T.trim, x - w / 2, 0.4, z - d / 2, x + w / 2, 0.5, z + d / 2, { gao: false });
    for (const s of [-0.7, 0.7]) {
      const lx = alongX ? x + s : x, lz = alongX ? z : z + s;
      geo.box(T.trim, lx - (alongX ? 0.12 : 0.22), 0, lz - (alongX ? 0.22 : 0.12), lx + (alongX ? 0.12 : 0.22), 0.4, lz + (alongX ? 0.22 : 0.12), {});
    }
    collide(x - w / 2, 0, z - d / 2, x + w / 2, 0.5, z + d / 2);
    decals.round(x, z, 1.2, 0.35);
  }

  function cafe(x, z, tint) {
    setLod(LOD.DETAIL);
    geo.proto(T.iron, TPL.cyl6, x, 0, z, 0.05, 0.72, 0.05, 0, { gao: false });
    geo.proto(T.metal, TPL.cyl8, x, 0.72, z, 0.42, 0.04, 0.42, 0, { gao: false });
    for (const a of [0.4, 2.2, 3.9]) {
      const cx = x + Math.cos(a) * 0.72, cz = z + Math.sin(a) * 0.72;
      geo.box(T.wood, cx - 0.21, 0.44, cz - 0.21, cx + 0.21, 0.48, cz + 0.21, { gao: false });
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) geo.box(T.iron, cx + dx - 0.015, 0, cz + dz - 0.015, cx + dx + 0.015, 0.44, cz + dz + 0.015, { gao: false, skip: 4 | 8 });
      const bx = cx + Math.cos(a) * 0.2, bz = cz + Math.sin(a) * 0.2;
      geo.box(T.wood, bx - 0.2, 0.48, bz - 0.2, bx + 0.2, 0.9, bz + 0.2, { gao: false });
    }
    setLod(LOD.BASE);
    geo.proto(T.wood, TPL.cyl6, x, 0.76, z, 0.03, 1.7, 0.03, 0, { gao: false });
    const cone = new THREE.ConeGeometry(1.35, 0.45, 8, 1, true); cone.translate(x, 2.45, z);
    geo.geom(T.fabric, cone, null, { flat: true, gao: false, tint: tint || [1.0, 0.97, 0.92] });
    geo.geom(T.fabric, cone, null, { flat: true, gao: false, flip: true, ao: 0.75, tint: tint || 1 });
    cone.dispose();
    collide(x - 0.45, 0, z - 0.45, x + 0.45, 0.8, z + 0.45);
    decals.round(x, z, 1.2, 0.3);
  }

  function crates(x, z, n = 2, alongZ = false) {
    setLod(LOD.BASE);
    const hs = [];
    for (let k = 0; k < n; k++) {
      const s = rr(0.7, 0.9), rot = rr(-0.2, 0.2);
      const ox = alongZ ? x : x + (k % 2) * 0.95, oz = alongZ ? z + k * 0.95 : z + (k > 1 ? 0.95 : 0);
      geo.proto(T.wood, TPL.box, ox, 0, oz, s, s, s, rot, {});
      collide(ox - s / 2, 0, oz - s / 2, ox + s / 2, s, oz + s / 2);
      decals.round(ox, oz, s * 0.9, 0.35);
      hs.push(s);
    }
    if (n >= 2 && R() < 0.7) geo.proto(T.wood, TPL.box, alongZ ? x : x + 0.45, Math.max(hs[0], hs[1]), alongZ ? z + 0.45 : z, 0.65, 0.65, 0.65, rr(0, 1), { gao: false });
  }

  function barrel(x, z) {
    setLod(LOD.BASE);
    geo.proto(T.wood, TPL.cyl8, x, 0, z, 0.33, 0.9, 0.33, R(), { tint: 0.8 });
    setLod(LOD.DETAIL);
    for (const y of [0.15, 0.72]) geo.proto(T.iron, TPL.cyl8, x, y, z, 0.345, 0.05, 0.345, 0, { gao: false });
    setLod(LOD.BASE);
    collide(x - 0.33, 0, z - 0.33, x + 0.33, 0.9, z + 0.33);
    decals.round(x, z, 0.6, 0.35);
  }

  const STALL_TINTS = [[0.95, 0.9, 0.8], [0.7, 0.25, 0.2], [0.3, 0.45, 0.32], [0.85, 0.65, 0.3]];
  function stall(x, z, alongX, tint) {
    // Market stall: trestle table with produce crates and a striped canvas roof on poles.
    const w = alongX ? 2.6 : 1.3, d = alongX ? 1.3 : 2.6;
    geo.lock(x, z);
    setLod(LOD.BASE);
    geo.box(T.wood, x - w / 2, 0.8, z - d / 2, x + w / 2, 0.86, z + d / 2, { gao: false });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) geo.box(T.wood, x + sx * (w / 2 - 0.08) - 0.04, 0, z + sz * (d / 2 - 0.08) - 0.04, x + sx * (w / 2 - 0.08) + 0.04, 2.3, z + sz * (d / 2 - 0.08) + 0.04, {});
    const tile = T.fabric.tile, ct = tint || STALL_TINTS[Math.floor(R() * 4)];
    const hy = 2.45, ly = 2.2;
    const p = alongX ? [[x - w / 2 - 0.2, hy, z - d / 2 - 0.3], [x + w / 2 + 0.2, hy, z - d / 2 - 0.3], [x + w / 2 + 0.2, ly, z + d / 2 + 0.4], [x - w / 2 - 0.2, ly, z + d / 2 + 0.4]]
      : [[x - w / 2 - 0.3, hy, z + d / 2 + 0.2], [x - w / 2 - 0.3, hy, z - d / 2 - 0.2], [x + w / 2 + 0.4, ly, z - d / 2 - 0.2], [x + w / 2 + 0.4, ly, z + d / 2 + 0.2]];
    geo.quad(T.fabric, ...p, [0, 1, 0], { gao: false, tint: ct }, (q) => [(q[0] + q[2]) / tile, q[1] / tile]);
    geo.quad(T.fabric, ...p, [0, -1, 0], { gao: false, tint: mulK(ct, 0.7) }, (q) => [(q[0] + q[2]) / tile, q[1] / tile]);
    setLod(LOD.DETAIL);
    for (let k = 0; k < 4; k++) {
      const ox = alongX ? x - w / 2 + 0.35 + k * 0.63 : x, oz = alongX ? z : z - d / 2 + 0.35 + k * 0.63;
      geo.box(T.wood, ox - 0.26, 0.86, oz - 0.2, ox + 0.26, 1.02, oz + 0.2, { gao: false, tint: 0.85 });
      const pr = [[1.3, 0.45, 0.3], [0.5, 0.8, 0.35], [1.2, 0.9, 0.3], [1.1, 0.3, 0.25]][k % 4];
      for (let j = 0; j < 3; j++) geo.proto(T.plant, TPL.blob0, ox + rr(-0.15, 0.15), 1.08, oz + rr(-0.1, 0.1), 0.1, 0.09, 0.1, 0, { gao: false, tint: pr });
    }
    setLod(LOD.BASE);
    collide(x - w / 2, 0, z - d / 2, x + w / 2, 0.95, z + d / 2);
    decals.round(x, z, Math.max(w, d) * 0.7, 0.3);
    geo.unlock();
  }
  const mulK = (t, k) => t.map((v) => v * k);

  function laundry(a, b, y, alongX) {
    const [x0, z0] = a, [x1, z1] = b, len = Math.hypot(x1 - x0, z1 - z0);
    setLod(LOD.DETAIL);
    geo.box(T.iron, Math.min(x0, x1), y - 0.008, Math.min(z0, z1) - (alongX ? 0.008 : 0), Math.max(x0, x1), y + 0.008, Math.max(z0, z1) + (alongX ? 0.008 : 0), { gao: false });
    const cols = [[1, 1, 1], [0.75, 0.85, 1.0], [1.0, 0.95, 0.75], [1.0, 0.82, 0.8], [0.85, 0.95, 0.85], [0.9, 0.4, 0.35]];
    let t = 0.25;
    while (t < len - 0.5) {
      const w = rr(0.35, 0.7), h = rr(0.4, 0.8), c = cols[Math.floor(R() * cols.length)];
      const px = x0 + (x1 - x0) * (t + w / 2) / len, pz = z0 + (z1 - z0) * (t + w / 2) / len;
      geo.box(T.fabric, px - (alongX ? w / 2 : 0.006), y - h, pz - (alongX ? 0.006 : w / 2), px + (alongX ? w / 2 : 0.006), y, pz + (alongX ? 0.006 : w / 2), { gao: false, tint: c });
      t += w + rr(0.1, 0.35);
    }
    setLod(LOD.BASE);
  }

  function planter(x, z, s = 1.2) {
    setLod(LOD.BASE);
    geo.box(T.trim, x - s / 2, 0, z - s / 2, x + s / 2, 0.62, z + s / 2, {});
    geo.box(T.trim, x - s / 2 - 0.05, 0.62, z - s / 2 - 0.05, x + s / 2 + 0.05, 0.7, z + s / 2 + 0.05, { gao: false });
    for (let k = 0; k < 4; k++) geo.proto(T.plant, TPL.blob0, x + rr(-0.3, 0.3) * s, 0.95 + rr(0, 0.3), z + rr(-0.3, 0.3) * s, rr(0.3, 0.45) * s, rr(0.3, 0.4) * s, rr(0.3, 0.45) * s, R() * 3, { gao: false });
    collide(x - s / 2, 0, z - s / 2, x + s / 2, 0.7, z + s / 2);
    decals.round(x, z, s * 0.9, 0.4);
  }

  // Olive: twisted trunk (two leaning segments) and a few grey-green canopy clumps.
  function olive(x, z, s = 1) {
    geo.lock(x, z);
    setLod(LOD.BASE);
    const lean = R() * Math.PI * 2, lx = Math.cos(lean) * 0.35 * s, lz = Math.sin(lean) * 0.35 * s;
    const g = new THREE.CylinderGeometry(0.1 * s, 0.2 * s, 1.6 * s, 6); g.translate(0, 0.8 * s, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-lz, 0, lx).normalize(), 0.25)); g.translate(x, 0, z);
    geo.geom(T.wood, g, null, { flat: true, tint: [0.62, 0.58, 0.52] }); g.dispose();
    const tint = [0.78, 0.85, 0.72];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + R(), r = rr(0.5, 1.1) * s;
      geo.proto(T.plant, TPL.blob1, x + lx * 2 + Math.cos(a) * r, rr(2.0, 2.8) * s, z + lz * 2 + Math.sin(a) * r, rr(0.9, 1.3) * s, rr(0.55, 0.8) * s, rr(0.9, 1.3) * s, R() * 3, { gao: false, tint });
    }
    setLod(LOD.FAR);
    geo.proto(T.plant, TPL.blob0, x + lx * 2, 2.4 * s, z + lz * 2, 1.8 * s, 1.0 * s, 1.8 * s, 0, { gao: false, tint });
    setLod(LOD.BASE);
    collide(x - 0.2, 0, z - 0.2, x + 0.2, 2, z + 0.2);
    decals.round(x + lx * 2, z + lz * 2, 2.2 * s, 0.35);
    geo.unlock();
  }
  function cypress(x, z, h = 12) {
    geo.lock(x, z);
    for (const lod of [LOD.BASE, LOD.FAR]) {
      setLod(lod);
      const g = new THREE.CylinderGeometry(0.05, 0.9, h, lod === LOD.BASE ? 8 : 5, lod === LOD.BASE ? 3 : 1); g.translate(x, h / 2 + 0.4, z);
      const pos = g.attributes.position;
      if (lod === LOD.BASE) for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) - 0.4, k = Math.sin((y / h) * Math.PI) * 0.35 + 0.75; pos.setX(i, x + (pos.getX(i) - x) * k); pos.setZ(i, z + (pos.getZ(i) - z) * k); }
      geo.geom(T.plant, g, null, { flat: true, gao: false, tint: [0.5, 0.62, 0.45], uvScale: 1 }); g.dispose();
    }
    setLod(LOD.BASE);
    geo.proto(T.wood, TPL.cyl6, x, 0, z, 0.15, 0.6, 0.15, 0, {});
    collide(x - 0.3, 0, z - 0.3, x + 0.3, 3, z + 0.3);
    decals.round(x, z, 1.2, 0.35);
    geo.unlock();
  }
  function fruitTree(x, z, s = 1, tint = [0.95, 1.05, 0.85]) {
    geo.lock(x, z);
    setLod(LOD.BASE);
    geo.proto(T.wood, TPL.cyl6, x, 0, z, 0.12 * s, 1.5 * s, 0.12 * s, 0, { tint: 0.7 });
    geo.proto(T.plant, s > 1.2 ? TPL.blob1 : TPL.blob0, x, 2.3 * s, z, 1.4 * s, 1.1 * s, 1.4 * s, R() * 3, { gao: false, tint });
    geo.proto(T.plant, TPL.blob0, x + 0.5 * s, 2.9 * s, z - 0.3 * s, 0.8 * s, 0.7 * s, 0.8 * s, R() * 3, { gao: false, tint });
    setLod(LOD.FAR);
    geo.proto(T.plant, TPL.blob0, x, 2.4 * s, z, 1.5 * s, 1.2 * s, 1.5 * s, 0, { gao: false, tint });
    setLod(LOD.BASE);
    collide(x - 0.15, 0, z - 0.15, x + 0.15, 1.8, z + 0.15);
    decals.round(x, z, 1.6 * s, 0.35);
    geo.unlock();
  }
  // Low dry-stone garden wall (collider below step height is avoided: 0.9 m).
  function lowWall(x0, z0, x1, z1, h = 0.9) {
    setLod(LOD.BASE);
    geo.box(T.stone, x0, 0, z0, x1, h, z1, { tint: 0.92, uvOff: [x0 * 0.3, z0 * 0.3] });
    geo.box(T.trim, x0 - 0.04, h, z0 - 0.04, x1 + 0.04, h + 0.08, z1 + 0.04, { gao: false, tint: 0.9 });
    collide(x0, 0, z0, x1, h + 0.08, z1);
  }
  // Rows of vines on posts / vegetable beds.
  function vineRow(x0, x1, z) {
    setLod(LOD.BASE);
    for (let x = x0; x < x1; x += 1.4) {
      geo.proto(T.wood, TPL.cyl6, x, 0, z, 0.04, 1.3, 0.04, 0, {});
      geo.proto(T.plant, TPL.blob0, x + 0.7, 1.05, z, 0.8, 0.35, 0.3, 0, { gao: false, tint: [0.95, 1.1, 0.8] });
    }
    geo.box(T.gravel, x0 - 0.3, 0, z - 0.35, x1 + 0.3, 0.03, z + 0.35, { gao: false, tint: [0.75, 0.62, 0.5] });
  }

  return { fountain, well, bench, cafe, crates, barrel, stall, laundry, planter, olive, cypress, fruitTree, lowWall, vineRow };
}
