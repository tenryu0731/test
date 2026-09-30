// San Gimignano town plan (artistic impression, north = -Z). Everything is axis-aligned so that
// colliders stay Box3: streets and squares are unions of rectangles [x0, x1, z0, z1], with jogs and
// widenings for a medieval feel; monuments have reserved footprints; the rest of the walled area is
// cut into blocks and building lots.
import { TOWN } from './layout.js';

export const [TX0, TX1, TZ0, TZ1] = TOWN.rect;   // outer faces of the walls
export const WALL_T = 2.4;                        // wall thickness
export const IX0 = TX0 + WALL_T, IX1 = TX1 - WALL_T, IZ0 = TZ0 + WALL_T, IZ1 = TZ1 - WALL_T;
export const CELL = 0.5;
export const GW = Math.round((TX1 - TX0) / CELL), GH = Math.round((TZ1 - TZ0) / CELL);

// Cell values.
export const SOLID = 0, WALK = 1, RES = 2, COURT = 3;

// ------------------------------------------------------------------ public spaces
// [x0, x1, z0, z1, kind]. kind: sqH (herringbone square), sqP (flagstone square), sq (cobbled square),
// main (main street, cobbles + flagstone gutter), st (street), al (alley), gate (gate passage),
// gar (garden: grass + gravel paths), orch (orchard: grass), clo (cloister garth).
export const SPACES = [
  // Gates and the little squares inside them.
  [-2.8, 2.8, 139, TZ1, 'gate'], [-12, 12, 127, 139, 'sq'],                // Porta San Giovanni (S)
  [-2.8, 2.8, TZ0, -139, 'gate'], [-12, 12, -139, -127, 'sq'],               // Porta San Matteo (N)
  [109, TX1, -2.8, 2.8, 'gate'], [98, 109, -11, 11, 'sq'],                   // Porta alle Fonti (E)
  [TX0, -109, -2.8, 2.8, 'gate'], [-109, -98, -11, 11, 'sq'],                  // Porta Quercecchio (W)

  // Piazza della Cisterna, the link to Piazza del Duomo, Piazza del Duomo (with the collegiata stair).
  [-18, 20, -15, 15, 'sqH'],
  [-8, 4, -24, -15, 'sqP'],
  [-44, 0, -58, -24, 'sqP'],

  // Via San Giovanni (S gate → Cisterna) with the slargo in front of San Francesco.
  [-3, 3, 106, 127, 'main'], [-14, 5, 84, 106, 'sq'], [-4.5, 1.5, 58, 84, 'main'], [-2, 4, 15, 58, 'main'],
  // Via San Matteo (N gate → Piazza del Duomo).
  [-3, 3, -127, -114, 'main'], [-6, 0, -114, -86, 'main'], [-9, -3, -86, -58, 'main'],
  // Via del Castello (Cisterna → E gate) and Via di Quercecchio (Cisterna → W gate).
  [20, 58, -4, 1.5, 'main'], [58, 98, -2.5, 3, 'main'],
  [-58, -18, -1, 5, 'main'], [-98, -58, -3, 3, 'main'],

  // North-east: Piazza Sant'Agostino, its street, the convent street and cloister entrance.
  [3, 22, -126, -121, 'st'], [22, 58, -136, -106, 'sqP'],
  [52, 57, -106, -64, 'st'], [57, 68, -92, -88.5, 'al'],          // vaulted entrance into the cloister
  [68, 90, -100, -80, 'clo'],
  [-9, 104, -64, -60, 'st'],                                       // Via Garibaldi-like cross street
  [100, 104, -60, -9, 'st'],                                       // lane toward the E gate square
  [58, 117.6 - 0.1, -147.5, -138, 'orch'],                          // friars' orchard behind Sant'Agostino
  [96, 100, -138, -116, 'al'],
  [22, 26, -106, -64, 'al'],
  [26, 52, -84, -81.5, 'al'],
  [30, 33, -60, -4, 'al'],                                         // alley down to Via del Castello
  [40, 72, -35, -32, 'st'], [69, 73, -60, -2.5, 'st'],
  [84, 86.5, -60, -35, 'al'], [84, 104, -37.5, -35, 'al'],
  [10, 22, -134, -130, 'al'],

  // North-west: Via delle Romite, Via del Pozzo, Via Berignano, Piazza Pecori, orchard, north lane.
  [-100, -6, -104, -100, 'st'],
  [-84, -9, -72, -68, 'st'],
  [-90, -86, -130, -72, 'st'], [-88, -84, -72, -3, 'st'],
  [-108, -84, -54, -40, 'sq'],                                     // Piazza Pecori (behind the collegiata)
  [-108, -104, -40, -9, 'al'],
  [IX0 + 0.1, -92, -147.5, -114, 'orch'],
  [-92, -10, -134, -130, 'st'],
  [-40, -37.5, -100, -72, 'al'], [-62, -59.5, -100, -72, 'al'],
  [-44, -41.5, -30, -24, 'sqP'],
  [-66, -63.5, -32, -3, 'al'], [-84, -66, -30, -27.5, 'al'],
  [-26, -23.5, -130, -104, 'al'], [-56, -53.5, -130, -104, 'al'],

  // South-west: the Rocca (garden inside its own walls), Via della Rocca, Via Mainardi, lanes.
  [-72, -14, 80, 84.5, 'st'], [-100, -72, 80, 84.5, 'st'], [-98, -94, 84.5, 100.5, 'gate'],
  [-114, -76, 100, 144, 'gar'],
  [-88, -84, 3, 80, 'st'],
  [-84, -4.5, 46, 50, 'st'],
  [-58, -55.5, 5, 46, 'al'], [-34, -31.5, 5, 46, 'al'], [-58, -34, 22, 24.5, 'al'],
  [-70, -67.5, 50, 80, 'al'], [-40, -37.5, 50, 80, 'al'],
  [-40, -14, 106, 110, 'st'], [-68, -40, 128, 132, 'al'], [-44, -41.5, 110, 144, 'al'],
  [-68, -65.5, 104, 128, 'al'], [-68, -44, 140, 144, 'al'],
  [-116, -100, 50, 53, 'al'], [-108, -104.5, 3, 50, 'al'],

  // South-east: Piazza delle Erbe, Via delle Erbe, San Jacopo, the lane along the south wall, vineyard.
  [4, 30, 34, 38.5, 'st'], [30, 58, 26, 52, 'sq'], [40, 44, 1.5, 26, 'al'],
  [58, 72, 36, 40, 'st'], [72, 76, 3, 112, 'st'],
  [4, 72, 70, 74, 'st'],
  [54, 72, 112, 136, 'sq'],                                          // Piazzetta San Jacopo
  [5, 54, 132, 136, 'al'], [30, 33, 74, 132, 'al'], [1.5, 30, 100, 103, 'al'],
  [100, IX1 - 0.1, 36, 147.5, 'orch'],                               // vineyard / orchard along the east wall
  [76, 100, 52, 56, 'al'], [96, 100, 3, 52, 'al'],
  [14, 17, 52, 70, 'al'], [44, 47, 52, 70, 'al'], [58, 72, 90, 93, 'al'],
  [20, 40, 15, 18, 'al'],
];

// Vaulted passages: a small house bridging an alley (the alley stays walkable underneath).
// [x0, x1, z0, z1, axis of travel, height]
export const PASSAGES = [
  [57, 68, -92, -88.5, 'x', 9.5],       // cloister entrance through the convent's west wing
  [-40, -37.5, -90, -85, 'z', 8.2],
  [30, 33, -30, -25, 'z', 8.6],
  [-34, -31.5, 30, 35, 'z', 7.8],
  [-58, -53, 22, 24.5, 'x', 8.0],
  [44, 47, 60, 65, 'z', 8.4],
  [-44, -41.5, 118, 123, 'z', 7.6],
];

// Buttress arches across narrow alleys (archi di contrasto): [x, z, axis the alley runs along, height]
export const ALLEY_ARCHES = [
  [-62 + 1.25, -80, 'z', 5.6], [-26 + 1.25, -118, 'z', 5.2], [31.5, -45, 'z', 6.0], [85.25, -48, 'z', 5.4],
  [-65 + 0.25, -15, 'z', 5.8], [-56.75, 36, 'z', 5.0], [-38.75, 64, 'z', 5.5], [31.5, 110, 'z', 5.2],
  [15.5, 60, 'z', 5.4], [-50, 23.25, 'x', 5.6], [66, 101.5 + 0.25, 'x', 5.3],
];

// ------------------------------------------------------------------ monuments (reserved footprints)
export const MON = {
  collegiata: [-78, -44, -54, -32], apse: [-84, -78, -48, -38], campColl: [-58, -51, -61, -54],
  popolo: [-44, -17.5, -24, -1], torreGrossa: [-17.5, -8.5, -24, -15],
  podesta: [4, 26, -60, -34], loggia: [0, 4, -54, -38], rognosa: [4, 11, -41, -34],
  agostino: [58, 96, -136, -116], campAgostino: [89, 96, -116, -109],
  convent: [57, 100, -108, -72],
  francesco: [-44, -14, 90, 104], campFrancesco: [-44, -38.5, 84.5, 90],
  jacopo: [72, 100, 116, 132], campJacopo: [94, 100, 110, 116],
  rocca: [TX0, -70, 96, TZ1],
  gateN: [-9, 9, TZ0, -139], gateS: [-9, 9, 139, TZ1], gateE: [109, TX1, -9, 9], gateW: [TX0, -109, -9, 9],
};

// Tower houses. top: parapet | flat | roof | ruin | belfry. vp: exposed as a climbable viewpoint.
export const TOWERS = [
  { id: 'grossa', r: MON.torreGrossa, h: 54, top: 'parapet', dark: true, name: 'グロッサの塔', vp: true, door: 'N' },
  { id: 'rognosa', r: MON.rognosa, h: 45, top: 'belfry', dark: true, name: 'ロニョーザの塔' },
  { id: 'salvucci-a', r: [6, 12, -21, -15], h: 42, top: 'parapet', name: 'サルヴッチの双子の塔' },
  { id: 'salvucci-b', r: [13.5, 19.5, -21, -15], h: 39.5, top: 'parapet' },
  { id: 'ardinghelli-a', r: [-17, -11.5, 15, 21], h: 33, top: 'roof', name: 'アルディンゲッリの塔' },
  { id: 'ardinghelli-b', r: [-9.5, -4, 15, 21], h: 30.5, top: 'parapet' },
  { id: 'diavolo', r: [14, 20, 15, 21], h: 37, top: 'parapet', dark: true, name: '悪魔の塔' },
  { id: 'chigi', r: [-28, -22, -65, -58], h: 38, top: 'flat', name: 'キージの塔' },
  { id: 'cugnanesi', r: [4, 10, 42, 48], h: 38, top: 'roof', dark: true, name: 'クニャネージの塔' },
  { id: 'becci', r: [-8, -2, 26, 32], h: 35, top: 'parapet' },
  { id: 'pettini', r: [0, 6, -100, -94], h: 33, top: 'ruin' },
  { id: 'campatelli', r: [-15, -9, -80, -74], h: 29, top: 'roof', name: 'カンパテッリの塔' },
  { id: 'erbe', r: [58, 64, 30, 36], h: 32, top: 'ruin', dark: true },
  { id: 'quercecchio', r: [-52, -46, 5, 11], h: 34, top: 'flat' },
  { id: 'castello', r: [44, 50, -12, -4], h: 30, top: 'parapet', dark: true },
];

// City-wall towers (projecting outwards by `out` metres): [x, z, side]
export const WALL_TOWERS = [
  [-60, TZ0, 'N'], [44, TZ0, 'N'], [90, TZ0, 'N'],
  [-54, TZ1, 'S'], [40, TZ1, 'S'], [86, TZ1, 'S'],
  [TX1, -104, 'E'], [TX1, -52, 'E'], [TX1, 56, 'E'], [TX1, 108, 'E'],
  [TX0, -110, 'W'], [TX0, -56, 'W'], [TX0, 50, 'W'],
  [TX0, TZ1, 'SW'], [TX1, TZ0, 'NE'], [TX0, TZ0, 'NW'], [TX1, TZ1, 'SE'],
];

// ------------------------------------------------------------------ grid
export class Grid {
  constructor() {
    this.a = new Uint8Array(GW * GH);   // cell class
    this.k = new Uint8Array(GW * GH);   // ground kind index (see GROUND_KINDS)
  }
  ix(x) { return Math.floor((x - TX0) / CELL); }
  iz(z) { return Math.floor((z - TZ0) / CELL); }
  get(x, z) {
    const i = this.ix(x), j = this.iz(z);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
    return this.a[j * GW + i];
  }
  isWalk(x, z) { return this.get(x, z) === WALK; }
  isOpen(x, z) { const v = this.get(x, z); return v === WALK || v === COURT; }
  fill(r, v, kind = -1) {
    const i0 = Math.max(0, this.ix(r[0] + 1e-3)), i1 = Math.min(GW - 1, this.ix(r[1] - 1e-3));
    const j0 = Math.max(0, this.iz(r[2] + 1e-3)), j1 = Math.min(GH - 1, this.iz(r[3] - 1e-3));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      this.a[j * GW + i] = v;
      if (kind >= 0) this.k[j * GW + i] = kind;
    }
  }
  // Greedy decomposition of all cells with value v into rectangles (optionally split by `kindAware`).
  rects(v, kindAware = false) {
    const used = new Uint8Array(GW * GH), out = [];
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const c = j * GW + i;
      if (this.a[c] !== v || used[c]) continue;
      const kk = this.k[c];
      const ok = (q) => this.a[q] === v && !used[q] && (!kindAware || this.k[q] === kk);
      let w = 0;
      while (i + w < GW && ok(j * GW + i + w)) w++;
      let h = 1;
      grow: while (j + h < GH) {
        for (let t = 0; t < w; t++) if (!ok((j + h) * GW + i + t)) break grow;
        h++;
      }
      for (let a = 0; a < h; a++) for (let t = 0; t < w; t++) used[(j + a) * GW + i + t] = 1;
      out.push({ r: [TX0 + i * CELL, TX0 + (i + w) * CELL, TZ0 + j * CELL, TZ0 + (j + h) * CELL], kind: kk });
    }
    return out;
  }
}

export const GROUND_KINDS = ['none', 'sqH', 'sqP', 'sq', 'main', 'st', 'al', 'gate', 'gar', 'orch', 'clo', 'court'];
export const kindIndex = (k) => Math.max(0, GROUND_KINDS.indexOf(k));

// Builds the occupancy grid: walls and monuments reserved, public spaces walkable, the rest solid.
export function buildGrid() {
  const g = new Grid();
  // Wall ring.
  g.fill([TX0, TX1, TZ0, IZ0], RES); g.fill([TX0, TX1, IZ1, TZ1], RES);
  g.fill([TX0, IX0, TZ0, TZ1], RES); g.fill([IX1, TX1, TZ0, TZ1], RES);
  for (const k in MON) g.fill(MON[k], RES);
  for (const t of TOWERS) g.fill(t.r, RES);
  for (const s of SPACES) g.fill(s, WALK, kindIndex(s[4]));
  // The rocca interior garden and its gate are walkable inside the reserved rocca footprint.
  return g;
}

// Splits the solid cells into blocks and building lots.
// Lot: { x0, x1, z0, z1, inner } (inner: no street frontage expected; courtyards are COURT cells).
export function makeLots(g, R) {
  const rr = (a, b) => a + (b - a) * R();
  const snap = (v) => Math.round(v * 2) / 2;
  const blocks = g.rects(SOLID).map((b) => b.r);
  const lots = [];
  const strip = (x0, x1, z0, z1) => {
    const w = x1 - x0, d = z1 - z0, alongX = w >= d;
    const L = alongX ? w : d;
    let s = alongX ? x0 : z0;
    const end = s + L;
    while (s < end - 0.01) {
      let len = snap(rr(6.5, 11));
      if (R() < 0.12) len = snap(rr(11, 16)); // occasional wide palazzo lot
      if (end - (s + len) < 4.5) len = end - s;
      const e = s + len;
      lots.push(alongX ? { x0: s, x1: e, z0, z1 } : { x0, x1, z0: s, z1: e });
      s = e;
    }
  };
  for (const [x0, x1, z0, z1] of blocks) {
    const w = x1 - x0, d = z1 - z0, sh = Math.min(w, d);
    if (sh < 2.5 && Math.max(w, d) < 6) { g.fill([x0, x1, z0, z1], COURT, kindIndex('court')); continue; }
    if (sh > 34) {
      // Deep block: building strips along both long sides, a courtyard strip with rear houses inside.
      const alongX = w >= d, dep0 = snap(rr(11, 15)), dep1 = snap(rr(11, 15));
      if (alongX) {
        strip(x0, x1, z0, z0 + dep0); strip(x0, x1, z1 - dep1, z1);
        const m0 = z0 + dep0, m1 = z1 - dep1, cd = snap(Math.min(9, (m1 - m0) * 0.45));
        g.fill([x0, x1, m0, m0 + cd], COURT, kindIndex('court'));
        if (m1 - (m0 + cd) > 3) strip(x0, x1, m0 + cd, m1); else g.fill([x0, x1, m0 + cd, m1], COURT, kindIndex('court'));
      } else {
        strip(x0, x0 + dep0, z0, z1); strip(x1 - dep1, x1, z0, z1);
        const m0 = x0 + dep0, m1 = x1 - dep1, cd = snap(Math.min(9, (m1 - m0) * 0.45));
        g.fill([m0, m0 + cd, z0, z1], COURT, kindIndex('court'));
        if (m1 - (m0 + cd) > 3) strip(m0 + cd, m1, z0, z1); else g.fill([m0 + cd, m1, z0, z1], COURT, kindIndex('court'));
      }
    } else if (sh > 17) {
      const f = rr(0.42, 0.58);
      if (w < d) { const xm = snap(x0 + w * f); strip(x0, xm, z0, z1); strip(xm, x1, z0, z1); }
      else { const zm = snap(z0 + d * f); strip(x0, x1, z0, zm); strip(x0, x1, zm, z1); }
    } else strip(x0, x1, z0, z1);
  }
  return lots;
}

// Medieval street fronts are never straight: set some façades back from the street line by
// 0.3–0.9 m (the strip becomes part of the street, with the street's paving).
export function insetLots(g, lots, R) {
  const probe = (x, z) => { const i = g.ix(x), j = g.iz(z); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; };
  for (const l of lots) {
    if (R() > 0.4) continue;
    const w = l.x1 - l.x0, d = l.z1 - l.z0;
    const sides = [];
    // [dir, outward probe fn]
    const test = (dir) => {
      let n = 0, k = 0, kind = 0;
      const L = dir === 'N' || dir === 'S' ? w : d;
      for (let t = 0.25; t < L; t += 0.5) {
        k++;
        const x = dir === 'N' || dir === 'S' ? l.x0 + t : dir === 'W' ? l.x0 - 0.25 : l.x1 + 0.25;
        const z = dir === 'W' || dir === 'E' ? l.z0 + t : dir === 'N' ? l.z0 - 0.25 : l.z1 + 0.25;
        const c = probe(x, z);
        if (c >= 0 && g.a[c] === WALK) { n++; kind = g.k[c]; }
      }
      return n === k && k > 0 ? kind : -1;
    };
    for (const dir of ['N', 'S', 'W', 'E']) { const kd = test(dir); if (kd >= 0) sides.push([dir, kd]); }
    if (!sides.length) continue;
    const [dir, kd] = sides[Math.floor(R() * sides.length)];
    const depth = dir === 'N' || dir === 'S' ? d : w;
    if (depth < 9) continue;
    const s = [0.5, 0.5, 1.0][Math.floor(R() * 3)];
    let strip;
    if (dir === 'N') { strip = [l.x0, l.x1, l.z0, l.z0 + s]; l.z0 += s; }
    else if (dir === 'S') { strip = [l.x0, l.x1, l.z1 - s, l.z1]; l.z1 -= s; }
    else if (dir === 'W') { strip = [l.x0, l.x0 + s, l.z0, l.z1]; l.x0 += s; }
    else { strip = [l.x1 - s, l.x1, l.z0, l.z1]; l.x1 -= s; }
    g.fill(strip, WALK, kd);
  }
}
