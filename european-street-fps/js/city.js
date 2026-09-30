// San Gimignano (artistic impression) filling the whole walled rectangle of layout.js → TOWN:
// walls with towers and four gatehouses, Via San Giovanni / San Matteo / del Castello / di
// Quercecchio from the gates to Piazza della Cisterna (octagonal well-fountain) and Piazza del Duomo
// (collegiata on its broad stair, Palazzo del Popolo with the 54 m Torre Grossa), Sant'Agostino
// with its convent cloister, San Francesco, San Jacopo, the civic loggia, fifteen tower houses,
// a market square, the Rocca garden with olives, orchards along the walls, alleys, vaulted passages.
//
// Rendering: every opaque surface uses the texture-array material (textures.js → M.town) and is
// bucketed per 42 × 40 m chunk and LOD (base / detail / far, see city-geo.js); update(dt, camera)
// shows detail within DETAIL_DIST and swaps base ↔ far at FAR_DIST. No per-frame allocation.
import * as THREE from 'three';
import { Geo, LOD, mulberry32 } from './city-geo.js';
import { createKit, makeFace } from './city-kit.js';
import { createBuilders } from './city-buildings.js';
import { createMonuments } from './city-monuments.js';
import { createProps } from './city-props.js';
import { buildGrid, makeLots, insetLots, SPACES, MON, TOWERS, WALL_TOWERS, PASSAGES, ALLEY_ARCHES, GROUND_KINDS, GW, WALK, COURT, TX0, TX1, TZ0, TZ1 } from './city-plan.js';

let DETAIL_DIST = 90, FAR_DIST = 190;

// Footprint of a city-wall tower (same rule as city-monuments.js wallTower), used to keep houses out of it.
function wallTowerRect([x, z, side]) {
  const corner = side.length === 2, s = corner ? 4.5 : 3.6, out = 2.2;
  let x0 = x - s, x1 = x + s, z0 = z - s, z1 = z + s;
  if (!corner) {
    if (side === 'N') { z0 = z - out; z1 = z + 2 * s - out; }
    if (side === 'S') { z1 = z + out; z0 = z - 2 * s + out; }
    if (side === 'W') { x0 = x - out; x1 = x + 2 * s - out; }
    if (side === 'E') { x1 = x + out; x0 = x - 2 * s + out; }
  } else {
    x0 = side.includes('W') ? x - out : x - 2 * s + out; x1 = x0 + 2 * s;
    z0 = side.includes('N') ? z - out : z - 2 * s + out; z1 = z0 + 2 * s;
  }
  return [x0 - 0.05, x1 + 0.05, z0 - 0.05, z1 + 0.05];
}
// Rectangle subtraction: lots overlapping a blocker are replaced by the (up to four) pieces around it;
// slivers narrower than 3 m are dropped.
function carveLots(lots, blockers) {
  let cur = lots;
  for (const [bx0, bx1, bz0, bz1] of blockers) {
    const next = [];
    for (const l of cur) {
      if (l.x1 <= bx0 || l.x0 >= bx1 || l.z1 <= bz0 || l.z0 >= bz1) { next.push(l); continue; }
      const pieces = [
        [l.x0, l.x1, l.z0, Math.min(l.z1, bz0)],                                   // north of it
        [l.x0, l.x1, Math.max(l.z0, bz1), l.z1],                                   // south
        [l.x0, Math.min(l.x1, bx0), Math.max(l.z0, bz0), Math.min(l.z1, bz1)],     // west
        [Math.max(l.x0, bx1), l.x1, Math.max(l.z0, bz0), Math.min(l.z1, bz1)],     // east
      ];
      for (const [x0, x1, z0, z1] of pieces) if (x1 - x0 >= 3 && z1 - z0 >= 3) next.push({ ...l, x0, x1, z0, z1 });
    }
    cur = next;
  }
  return cur;
}

export function buildCity(scene, M, opts = {}) {
  const t0 = performance.now();
  const R = mulberry32(20240917);
  const rr = (a, b) => a + (b - a) * R();
  const grid = buildGrid();
  let lots = makeLots(grid, R);
  insetLots(grid, lots, R);
  lots = carveLots(lots, WALL_TOWERS.map(wallTowerRect));
  const NX = 6, NZ = 8, GX0 = TX0 - 8, GZ0 = TZ0 - 8;
  const geo = new Geo(M.town, { x0: GX0, z0: GZ0, cw: (TX1 - TX0 + 16) / NX, ch: (TZ1 - TZ0 + 16) / NZ, nx: NX, nz: NZ });
  const colliders = [];
  const collide = (x0, y0, z0, x1, y1, z1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));

  // Contact-shadow decals: merged strips along façade bases and round blobs under props.
  const decalList = [];
  const decals = {
    strip(f, a, b) { if (b - a > 0.05) decalList.push({ f, a, b }); },
    round(x, z, r, alpha) { decalList.push({ round: true, x, z, r, alpha }); },
  };
  const ctx = { geo, M, R, grid, collide, decals };
  const kit = createKit(ctx); ctx.kit = kit;
  const B = createBuilders(ctx); ctx.B = B;
  const P = createProps(ctx); ctx.well = P.well;
  const Mo = createMonuments(ctx);
  const T = kit.T;
  const tA = performance.now();

  // ---------------------------------------------------------------- fabric
  for (const l of lots) B.buildLot(l);
  for (const t of TOWERS) B.buildTower(t);
  const tB = performance.now();

  // ---------------------------------------------------------------- monuments
  Mo.walls();
  Mo.gate(MON.gateS, 'S'); Mo.gate(MON.gateN, 'N'); Mo.gate(MON.gateE, 'E'); Mo.gate(MON.gateW, 'W');
  Mo.collegiata();
  const stoneS = (mat = T.stone) => ({ upper: mat, groundMat: mat, upperTint: [1.02, 0.99, 0.93], groundTint: [0.98, 0.95, 0.9] });
  Mo.palazzo(MON.popolo, { type: 'palazzo', storeys: 3, G: 6.2, S: { ...stoneS(), F: 4.6, eave: 'crenel', winKind: 'bifora', archShape: 'round', bench: true, shop: 0, lantern: true } });
  Mo.palazzo([4, 26, -60, -41], { type: 'palazzo', storeys: 3, G: 5.6, S: { ...stoneS(T.stoneDark), F: 4.4, eave: 'crenel', winKind: 'bifora', archShape: 'pointed', bench: true, shop: 0 } });
  Mo.palazzo([11, 26, -41, -34], { type: 'palazzo', storeys: 3, G: 5.6, S: { ...stoneS(T.stoneDark), F: 4.4, eave: 'crenel', winKind: 'bifora', archShape: 'pointed', bench: true, shop: 0 } });
  Mo.loggia(MON.loggia, 'W');
  Mo.church(MON.agostino, 'W', { mat: T.brick, tint: [1.02, 0.96, 0.9], h: 16, portalW: 2.4, portalSpring: 3.6, rose: 1.8, apse: 0, steps: 3, pointed: true, sideDoors: false });
  Mo.campanile(MON.campAgostino, { h: 24, mat: T.brick, tint: [1, 0.95, 0.9] });
  Mo.church(MON.francesco, 'E', { mat: T.stone, tint: [1.03, 1, 0.93], h: 12.5, portalW: 2.0, portalSpring: 3.0, rose: 1.3, apse: 0, steps: 3 });
  Mo.campanile(MON.campFrancesco, { h: 17, mat: T.stone, tint: [1, 0.98, 0.92] });
  Mo.church(MON.jacopo, 'W', { mat: T.stone, tint: [1.05, 1.02, 0.96], h: 12, portalW: 1.9, portalSpring: 2.9, rose: 1.2, apse: 4, steps: 2, bands: true, marble: true, pointed: true });
  Mo.campanile(MON.campJacopo, { h: 16, mat: T.stone, spire: 6.5 });
  // Convent wings around the cloister (plain plaster, two storeys) and the cloister arcades.
  const conventS = { type: 'casa', storeys: 2, G: 4.2, S: { shutters: true, balconies: false, shop: 0, eave: 'rafters', banded: false, pots: 0.05, lantern: false } };
  for (const r of [[57, 100, -108, -100], [57, 100, -80, -72], [57, 68, -100, -92], [57, 68, -88.5, -80], [90, 100, -100, -80]]) Mo.palazzo(r, conventS);
  Mo.cloister([68, 90, -100, -80]);
  const rocca = Mo.rocca();
  for (const p of PASSAGES) Mo.passage(p);
  for (const a of ALLEY_ARCHES) {
    // Measure the alley width across the arch position.
    const [x, z, along] = a;
    let w0 = 0, w1 = 0;
    const acr = along === 'z' ? (d) => grid.isWalk(x + d, z) : (d) => grid.isWalk(x, z + d);
    if (!acr(0)) continue;
    while (w0 < 4 && acr(-w0 - 0.25)) w0 += 0.25;
    while (w1 < 4 && acr(w1 + 0.25)) w1 += 0.25;
    if (w0 + w1 > 3.6) continue;
    const c = along === 'z' ? x + (w1 - w0) / 2 : z + (w1 - w0) / 2;
    Mo.alleyArch(along === 'z' ? [c, z, along, a[3]] : [x, c, along, a[3]], w0 + w1 + 0.25);
  }
  for (const t of TOWERS) if (t.vp) Mo.parapetColliders(t.r, t.h);
  Mo.parapetColliders(TOWERS.find((t) => t.id === 'salvucci-a').r, 42);
  const tC = performance.now();

  // ---------------------------------------------------------------- props and gardens
  P.fountain(0, 0);
  for (const [x, z, ax] of [[-9, 8.5, true], [9, 8.5, true], [-9, -8, true], [-14.5, 0, false], [14, -9, true]]) P.bench(x, z, ax);
  for (const [x, z] of [[11.5, 4.5], [15, 7.5], [11, 10.5], [16, 11.8], [-13, 11], [-15.5, 7.5]]) P.cafe(x, z, R() < 0.5 ? [0.95, 0.92, 0.85] : [0.75, 0.3, 0.22]);
  for (const [x, z] of [[-16, -12.5], [18, -12.5], [-16, 12.5]]) P.planter(x, z, 1.2);
  P.well(-18, -44, 1.1);
  for (const [x, z, ax] of [[-8, -56.3, true], [-22, -56.3, true], [-2.5, -30, false]]) P.bench(x, z, ax);
  for (const [x, z] of [[-30, -28], [-6, -28]]) P.planter(x, z, 1.4);
  P.well(40, -121); for (const [x, z] of [[27, -110], [53, -110], [27, -132], [53, -132]]) P.fruitTree(x, z, 1.5, [0.85, 1.0, 0.75]);
  for (const [x, z, ax] of [[34, -110, true], [46, -110, true]]) P.bench(x, z, ax);
  // Piazza delle Erbe: market stalls, crates, barrels.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) P.stall(36 + i * 8, 33 + j * 9, true);
  P.crates(31.5, 27.5, 3); P.crates(55.5, 48, 2, true); P.barrel(31, 50.5); P.barrel(32, 51); P.barrel(56.5, 28);
  P.well(-96, -47); P.bench(-104, -52.5, true);
  P.planter(-12, 86, 1.2); P.planter(3.5, 86, 1.2); P.bench(-1, 104.5, true);
  for (const [x, z] of [[-10, 129.5], [10, 129.5], [-10, -129.5], [10, -129.5], [100.5, -9.5], [100.5, 9.5], [-100.5, -9.5], [-100.5, 9.5]]) P.planter(x, z, 1.0);
  P.well(62, 124); P.cypress(56, 114.5, 11); P.cypress(56, 133.5, 12);
  // Rocca garden: olives, cypresses, gravel cross paths, a well, benches.
  const [gx0, gx1, gz0, gz1] = rocca.garden;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = gx0 + 5 + i * ((gx1 - gx0 - 10) / 3) + rr(-1.2, 1.2), z = gz0 + 6 + j * ((gz1 - gz0 - 12) / 3) + rr(-1.2, 1.2);
    if (Math.abs(x - (gx0 + gx1) / 2) < 3 || Math.abs(z - (gz0 + gz1) / 2) < 3) continue;
    P.olive(x, z, rr(0.9, 1.2));
  }
  for (let z = gz0 + 4; z < gz1 - 2; z += 7) { P.cypress(gx0 + 1.6, z, rr(10, 13)); }
  P.well((gx0 + gx1) / 2, (gz0 + gz1) / 2);
  P.bench((gx0 + gx1) / 2 - 5, (gz0 + gz1) / 2 + 3.5, true); P.bench((gx0 + gx1) / 2 + 5, (gz0 + gz1) / 2 - 3.5, true);
  // Orchards and the vineyard along the walls.
  for (let x = -112; x < -94; x += 6) for (let z = -142; z < -118; z += 6) P.fruitTree(x + rr(-1, 1), z + rr(-1, 1), rr(0.8, 1.1));
  for (let x = 64; x < 112; x += 7) P.fruitTree(x + rr(-1, 1), -143 + rr(-1, 1), rr(0.8, 1.05), [1.0, 1.08, 0.8]);
  for (let z = 44; z < 144; z += 3.2) P.vineRow(102, 114, z);
  for (const z of [40, 90]) P.olive(116 - 1.5, z, 1);
  // Private courtyards: a tree or a well now and then (seen from the towers).
  for (const c of grid.rects(COURT)) {
    const [x0, x1, z0, z1] = c.r;
    if (x1 - x0 > 5 && z1 - z0 > 5 && R() < 0.55) { if (R() < 0.75) P.fruitTree((x0 + x1) / 2, (z0 + z1) / 2, rr(0.8, 1.1)); else P.well((x0 + x1) / 2, (z0 + z1) / 2, 0.8); }
  }
  // Laundry across alleys, crates in corners.
  for (const s of SPACES) {
    if (s[4] !== 'al') continue;
    const alongZ = s[3] - s[2] > s[1] - s[0], len = alongZ ? s[3] - s[2] : s[1] - s[0];
    if (len < 8 || R() < 0.4) continue;
    const p = (alongZ ? s[2] : s[0]) + rr(2, len - 2), y = rr(5.4, 6.8);
    if (alongZ) P.laundry([s[0], p], [s[1], p], y, true); else P.laundry([p, s[2]], [p, s[3]], y, false);
  }
  const tD = performance.now();

  // ---------------------------------------------------------------- ground
  const cw = (TX1 - TX0 + 16) / NX, ch = (TZ1 - TZ0 + 16) / NZ;
  const groundMat = { sqH: T.herringbone, sqP: T.paving, sq: T.cobble, main: T.cobble, st: T.cobble, al: T.cobble, gate: T.paving, gar: T.grass, orch: T.grass, clo: T.grass, court: T.gravel, none: T.cobble };
  const groundTint = { al: 0.88, court: [0.85, 0.8, 0.72], orch: [0.95, 1.0, 0.9], st: 0.97 };
  const clipEmit = (r, mat, y, o) => {
    const [x0, x1, z0, z1] = r;
    for (let i = Math.floor((x0 - GX0) / cw); i <= Math.floor((x1 - 1e-6 - GX0) / cw); i++) for (let j = Math.floor((z0 - GZ0) / ch); j <= Math.floor((z1 - 1e-6 - GZ0) / ch); j++) {
      const a0 = Math.max(x0, GX0 + i * cw), a1 = Math.min(x1, GX0 + (i + 1) * cw), b0 = Math.max(z0, GZ0 + j * ch), b1 = Math.min(z1, GZ0 + (j + 1) * ch);
      if (a1 - a0 > 1e-3 && b1 - b0 > 1e-3) geo.rect(mat, 'y', 1, y, a0, a1, b0, b1, o);
    }
  };
  geo.lod = LOD.BASE;
  for (const c of grid.rects(WALK, true)) { const k = GROUND_KINDS[c.kind]; clipEmit(c.r, groundMat[k] || T.cobble, 0, { gao: false, tint: groundTint[k] ?? 1 }); }
  for (const c of grid.rects(COURT)) clipEmit(c.r, T.gravel, 0, { gao: false, tint: [0.85, 0.82, 0.74] });
  clipEmit([TX0, TX1, TZ0, TZ1], T.cobble, -0.03, { gao: false, tint: 0.8 }); // safety floor under everything
  // Flagstone gutters down the main streets, kerb borders and paving bands on the squares.
  for (const s of SPACES) {
    if (s[4] !== 'main') continue;
    const alongZ = s[3] - s[2] > s[1] - s[0], c = alongZ ? (s[0] + s[1]) / 2 : (s[2] + s[3]) / 2;
    clipEmit(alongZ ? [c - 0.6, c + 0.6, s[2], s[3]] : [s[0], s[1], c - 0.6, c + 0.6], T.paving, 0.012, { gao: false, tint: 0.95 });
  }
  const border = (r, mat, w, tint = 0.95) => {
    const [x0, x1, z0, z1] = r;
    for (const q of [[x0, x1, z0, z0 + w], [x0, x1, z1 - w, z1], [x0, x0 + w, z0 + w, z1 - w], [x1 - w, x1, z0 + w, z1 - w]]) clipEmit(q, mat, 0.015, { gao: false, tint });
  };
  border([-17.4, 19.4, -14.4, 14.4], T.trim, 0.45);
  for (let x = -11.2; x < 19; x += 6.2) clipEmit([x - 0.2, x + 0.2, -14, 14], T.paving, 0.016, { gao: false, tint: 0.92 });
  border([-36, -0.6, -57.4, -24.6], T.trim, 0.5, 0.9);
  for (let x = -30; x < -2; x += 6) clipEmit([x - 0.25, x + 0.25, -57, -25], T.trim, 0.016, { gao: false, tint: 0.88 });
  border([22.6, 57.4, -135.4, -106.6], T.trim, 0.45, 0.9);
  // Gravel cross paths in the rocca garden and the cloister garth.
  const gcx = (gx0 + gx1) / 2, gcz = (gz0 + gz1) / 2;
  clipEmit([gx0, gx1, gcz - 1.3, gcz + 1.3], T.gravel, 0.012, { gao: false }); clipEmit([gcx - 1.3, gcx + 1.3, gz0, gz1], T.gravel, 0.013, { gao: false });
  clipEmit([68, 90, -91.1, -88.9], T.gravel, 0.012, { gao: false }); clipEmit([77.9, 80.1, -100, -80], T.gravel, 0.013, { gao: false });
  // Arcade walks of the cloister are paved.
  for (const q of [[68, 90, -100, -96.8], [68, 90, -83.2, -80], [68, 71.2, -96.8, -83.2], [86.8, 90, -96.8, -83.2]]) clipEmit(q, T.paving, 0.011, { gao: false, tint: 0.95 });
  // Far LOD ground: one tinted quad per chunk.
  geo.lod = LOD.FAR;
  clipEmit([TX0, TX1, TZ0, TZ1], T.cobble, 0, { gao: false, tint: 0.85 });
  geo.lod = LOD.BASE;

  // ---------------------------------------------------------------- meshes
  const built = geo.finish(scene);
  const decalMesh = buildDecals(decalList);
  scene.add(decalMesh);
  const tE = performance.now();

  // ---------------------------------------------------------------- navigation
  // Collider hash for clearance checks.
  const HC = 4, hash = new Map();
  colliders.forEach((b, i) => {
    if (b.min.y > 1.8 || b.max.y < 0.3) return;
    for (let x = Math.floor(b.min.x / HC); x <= Math.floor(b.max.x / HC); x++) for (let z = Math.floor(b.min.z / HC); z <= Math.floor(b.max.z / HC); z++) {
      const k = x * 1000 + z; let l = hash.get(k); if (!l) hash.set(k, (l = [])); l.push(i);
    }
  });
  const blocked = (x, z, r) => {
    for (let gx = Math.floor((x - r) / HC); gx <= Math.floor((x + r) / HC); gx++) for (let gz = Math.floor((z - r) / HC); gz <= Math.floor((z + r) / HC); gz++) {
      const l = hash.get(gx * 1000 + gz);
      if (l) for (const i of l) { const b = colliders[i]; if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true; }
    }
    return false;
  };
  const clear = (x, z, r) => {
    if (!grid.isWalk(x, z)) return false;
    for (let a = 0; a < 8; a++) if (!grid.isWalk(x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r)) return false;
    return !blocked(x, z, r);
  };
  const navPoints = [];
  const navSeen = new Set();
  const addNav = (x, z, r) => {
    const k = Math.round(x / 1.5) * 10000 + Math.round(z / 1.5);
    if (navSeen.has(k) || !clear(x, z, r)) return;
    navSeen.add(k); navPoints.push(new THREE.Vector3(x, 0, z));
  };
  for (let z = TZ0 + 1.5; z < TZ1; z += 3) for (let x = TX0 + 1.5; x < TX1; x += 3) addNav(x, z, 0.9);
  for (const s of SPACES) {
    const alongZ = s[3] - s[2] > s[1] - s[0], c = alongZ ? (s[0] + s[1]) / 2 : (s[2] + s[3]) / 2;
    const a0 = alongZ ? s[2] : s[0], a1 = alongZ ? s[3] : s[1];
    for (let a = a0 + 0.8; a <= a1 - 0.8; a += 2.5) addNav(alongZ ? c : a, alongZ ? a : c, 0.55);
    if (s[4] === 'gate') { // through the gatehouse and a little way outside
      for (let a = -3; a <= 3; a += 2.5) {
        const [gx, gz] = alongZ ? [c, s[2] < 0 ? TZ0 - a - 1 : TZ1 + a + 1] : [s[0] < 0 ? TX0 - a - 1 : TX1 + a + 1, c];
        if (a > 0) navPoints.push(new THREE.Vector3(gx, -0.25, gz));
      }
    }
  }

  // ---------------------------------------------------------------- enemy squads, markers, viewpoints
  const SITES = [
    { id: 'town-cisterna', name: 'チステルナ広場', x: 6, z: 4, r: 15 },
    { id: 'town-duomo', name: 'ドゥオーモ広場', x: -20, z: -40, r: 15 },
    { id: 'town-agostino', name: 'サンタゴスティーノ広場', x: 40, z: -120, r: 14 },
    { id: 'town-rocca', name: 'ロッカの庭園', x: -95, z: 122, r: 18 },
    { id: 'town-erbe', name: 'エルベ広場', x: 44, z: 40, r: 13 },
    { id: 'town-cloister', name: '修道院の回廊', x: 79, z: -90, r: 10 },
  ];
  const enemySites = SITES.map((s) => {
    const cand = navPoints.filter((p) => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 < s.r * s.r && p.y === 0);
    const spawns = [];
    // Farthest-point sampling for well spread spawns.
    if (cand.length) {
      let best = cand[0], bd = 1e9;
      for (const p of cand) { const d = (p.x - s.x) ** 2 + (p.z - s.z) ** 2; if (d < bd) { bd = d; best = p; } }
      spawns.push(best);
      while (spawns.length < Math.min(6, cand.length)) {
        let far = null, fd = -1;
        for (const p of cand) { let m = 1e9; for (const q of spawns) m = Math.min(m, (p.x - q.x) ** 2 + (p.z - q.z) ** 2); if (m > fd) { fd = m; far = p; } }
        spawns.push(far);
      }
    }
    return { id: s.id, name: s.name, x: s.x, y: 0, z: s.z, r: s.r, spawns: spawns.map((p) => p.clone()) };
  });

  const tg = TOWERS.find((t) => t.id === 'grossa'), sv = TOWERS.find((t) => t.id === 'salvucci-a');
  const cxz = (r) => [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2];
  const viewpoints = [
    { id: 'torre-grossa', name: 'グロッサの塔（展望台）', base: new THREE.Vector3(cxz(tg.r)[0], 0, tg.r[2] - 1.3), top: new THREE.Vector3(cxz(tg.r)[0], tg.h, cxz(tg.r)[1]), yaw: 0.35 },
    { id: 'torre-salvucci', name: 'サルヴッチの塔', base: new THREE.Vector3(cxz(sv.r)[0], 0, sv.r[3] + 1.3), top: new THREE.Vector3(cxz(sv.r)[0], 42, cxz(sv.r)[1]), yaw: Math.PI },
    ...Mo.viewpoints.map(({ id, name, base, top, yaw }) => ({ id, name, base, top, yaw })),
  ];
  const markers = [
    { id: 'piazza-cisterna', name: 'チステルナ広場', type: 'piazza', x: 0, z: 0 },
    { id: 'piazza-duomo', name: 'ドゥオーモ広場', type: 'piazza', x: -20, z: -41 },
    { id: 'collegiata', name: '参事会教会（ドゥオーモ）', type: 'church', x: -61, z: -43 },
    { id: 'torre-grossa', name: 'グロッサの塔', type: 'tower', x: -13, z: -19.5 },
    { id: 'palazzo-popolo', name: 'ポポロ宮', type: 'palazzo', x: -31, z: -12 },
    { id: 'palazzo-podesta', name: 'ポデスタ宮とロニョーザの塔', type: 'palazzo', x: 15, z: -48 },
    { id: 'torri-salvucci', name: 'サルヴッチの双子の塔', type: 'tower', x: 12.7, z: -18 },
    { id: 'torre-diavolo', name: '悪魔の塔', type: 'tower', x: 17, z: 18 },
    { id: 'torri-ardinghelli', name: 'アルディンゲッリの塔', type: 'tower', x: -10.5, z: 18 },
    { id: 'sant-agostino', name: 'サンタゴスティーノ教会', type: 'church', x: 77, z: -126 },
    { id: 'chiostro', name: '修道院の回廊', type: 'cloister', x: 79, z: -90 },
    { id: 'san-francesco', name: 'サン・フランチェスコ教会', type: 'church', x: -29, z: 97 },
    { id: 'san-jacopo', name: 'サン・ヤコポ教会', type: 'church', x: 86, z: 124 },
    { id: 'piazza-erbe', name: 'エルベ広場（市場）', type: 'piazza', x: 44, z: 39 },
    { id: 'rocca-montestaffoli', name: 'モンテスタッフォリの城塞', type: 'rocca', x: -95, z: 122 },
    { id: 'porta-san-giovanni', name: 'サン・ジョヴァンニ門', type: 'gate', x: 0, z: 150 },
    { id: 'porta-san-matteo', name: 'サン・マッテーオ門', type: 'gate', x: 0, z: -150 },
    { id: 'porta-fonti', name: 'フォンティ門', type: 'gate', x: 120, z: 0 },
    { id: 'porta-quercecchio', name: 'クエルチェッキオ門', type: 'gate', x: -120, z: 0 },
    { id: 'orti', name: '修道士の果樹園', type: 'garden', x: 88, z: -143 },
  ];

  // ---------------------------------------------------------------- LOD update
  const chunks = built.chunks.filter((c) => c.base || c.detail || c.far);
  const waterMats = built.special.map((m) => m.material).filter((m) => m.normalMap && m.transparent);
  let lastX = 1e9, lastY = 1e9, lastZ = 1e9;
  function update(dt, camera) {
    for (const m of waterMats) { m.normalMap.offset.x += dt * 0.03; m.normalMap.offset.y += dt * 0.017; }
    if (!camera) return;
    const p = camera.position;
    if (Math.abs(p.x - lastX) + Math.abs(p.y - lastY) + Math.abs(p.z - lastZ) < 0.5) return;
    lastX = p.x; lastY = p.y; lastZ = p.z;
    const D2 = DETAIL_DIST * DETAIL_DIST, F2 = FAR_DIST * FAR_DIST;
    for (const c of chunks) {
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1), dz = Math.max(c.z0 - p.z, 0, p.z - c.z1), dy = Math.max(c.y0 - p.y, 0, p.y - c.y1);
      const d2 = dx * dx + dy * dy + dz * dz, near = d2 < F2;
      if (c.base) c.base.visible = near;
      if (c.far) c.far.visible = !near || !c.base;
      if (c.detail) c.detail.visible = d2 < D2;
    }
  }
  for (const c of chunks) if (c.far && c.base) c.far.visible = false;

  const meshes = [...chunks.flatMap((c) => [c.base, c.detail, c.far].filter(Boolean)), ...built.special, decalMesh];
  const tris = built.tris;
  const stats = { lots: lots.length, meshes: meshes.length, tris: { base: Math.round(tris[0]), detail: Math.round(tris[1]), far: Math.round(tris[2]), special: Math.round(tris[3]) }, colliders: colliders.length, nav: navPoints.length, ms: Math.round(tE - t0) };
  console.log(`[city] ${lots.length} lots, ${meshes.length} meshes, tris base ${Math.round(tris[0] / 1000)}k / detail ${Math.round(tris[1] / 1000)}k / far ${Math.round(tris[2] / 1000)}k / special ${Math.round(tris[3] / 1000)}k, ` +
    `${colliders.length} colliders, ${navPoints.length} nav points, ${(tE - t0).toFixed(0)} ms (lots ${(tB - tA).toFixed(0)}, monuments ${(tC - tB).toFixed(0)}, props ${(tD - tC).toFixed(0)}, meshes ${(tE - tD).toFixed(0)})`);

  return {
    colliders, navPoints, enemySites, viewpoints, markers,
    playerSpawn: new THREE.Vector3(0, 0, 128), playerYaw: 0,
    enemySpawns: enemySites.flatMap((s) => s.spawns),
    bounds: { minX: TX0, maxX: TX1, minZ: TZ0, maxZ: TZ1 },
    meshes, chunks, stats, update, grid,
    setDetailDistance(d, far) { DETAIL_DIST = d; if (far) FAR_DIST = far; lastX = 1e9; },
  };
}

// Contact-shadow decal mesh (transparent black with vertex alpha), one draw call for the whole town.
function buildDecals(list) {
  const pos = [], col = [];
  const push = (x, z, a) => { pos.push(x, 0.03, z); col.push(0, 0, 0, a); };
  for (const d of list) {
    if (d.round) {
      const segs = 12;
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
        push(d.x, d.z, d.alpha);
        push(d.x + Math.cos(a1) * d.r, d.z + Math.sin(a1) * d.r, 0);
        push(d.x + Math.cos(a0) * d.r, d.z + Math.sin(a0) * d.r, 0);
      }
      continue;
    }
    const { f, a: t0, b: t1 } = d;
    for (const [d0, d1, a0, a1] of [[0, 0.25, 0.42, 0.2], [0.25, 0.9, 0.2, 0]]) {
      const p = [[t0, d0, a0], [t1, d0, a0], [t1, d1, a1], [t0, d1, a1]].map(([t, dd, a]) => [f.ox + f.tx * t + f.dx * dd, f.oz + f.tz * t + f.dz * dd, a]);
      const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      const order = cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const i of order) push(p[i][0], p[i][1], p[i][2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'town-decals';
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export { makeFace };
