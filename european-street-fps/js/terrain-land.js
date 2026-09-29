// Land use for the countryside (terrain agent): Voronoi field patchwork (wheat, stubble with hay
// bales, ploughed earth, vineyards, olive groves, meadows, woods, scrub), road distance field,
// the per-texel data textures the terrain shader reads, and the placement of every tree, vine
// row, bale, rock and dry-stone wall.
import * as THREE from 'three';
import { TOWN, SITES, LAKE, ROADS, MAP_HALF } from './layout.js';
import { FINE, RIVER_HALF_W, smooth, clamp, distToRect, lakeRadiusAt, rand2 } from './terrain-height.js';

export const CLS = { MEADOW: 0, WHEAT: 1, STUBBLE: 2, PLOUGH: 3, VINE: 4, OLIVE: 5, WOOD: 6, SCRUB: 7, EDGE: 8, TOWN: 9, PAD: 10, WATER: 11, ROAD: 12 };
export const ROAD_SD_MAX = 10.25, ROAD_SD_MIN = -2.5; // encoded range of the signed road distance
const SP = 92;          // field seed spacing (m)

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Sample the macro noise texture data (same as the GPU does with LinearFilter + repeat).
export function makeNoiseSampler(noise) {
  const { data, n } = noise;
  return (u, v, ch) => {
    let x = u * n - 0.5, y = v * n - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
    const i0 = ((ix % n) + n) % n, i1 = (i0 + 1) % n, j0 = ((iy % n) + n) % n, j1 = (j0 + 1) % n;
    const a = data[(j0 * n + i0) * 4 + ch], b = data[(j0 * n + i1) * 4 + ch], c = data[(j1 * n + i0) * 4 + ch], d = data[(j1 * n + i1) * 4 + ch];
    return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) / 255;
  };
}

// Land use beyond the detailed area; mirrored exactly in the terrain shader (farLand()).
export function farLand(ns, x, z) {
  const n1 = ns(x / 1100, z / 1100, 0), n2 = ns(x / 420, z / 420, 1), n3 = ns(x / 300 + 0.3, z / 300, 2);
  const woods = smooth(0.47, 0.55, n1 + (n2 - 0.5) * 0.35);
  const f = 1 - woods;
  const wheat = smooth(0.54, 0.6, n3) * f, plough = (1 - smooth(0.38, 0.44, n3)) * f;
  const meadow = Math.max(0, f - wheat - plough);
  return { wheat, plough, lush: meadow * 0.6, dry: meadow * 0.4, woods };
}

export function buildLand(hf, noise) {
  const t0 = performance.now();
  const { n, step: st, half } = FINE, o = -half;
  const H = hf.H, heightAt = hf.heightAt;
  const ns = makeNoiseSampler(noise);

  // ---------------------------------------------------------------- road signed distance
  const RS = new Float32Array(n * n).fill(ROAD_SD_MAX);
  for (const r of hf.roads) {
    const R = 12, hw = r.hw;
    for (let a = 0; a < r.X.length - 1; a++) {
      const ax = r.X[a], az = r.Z[a], vx = r.X[a + 1] - ax, vz = r.Z[a + 1] - az, vv = vx * vx + vz * vz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + vx) - R - o) / st)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, ax + vx) + R - o) / st));
      const j0 = Math.max(0, Math.floor((Math.min(az, az + vz) - R - o) / st)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, az + vz) + R - o) / st));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = o + i * st, z = o + j * st;
        let t = ((x - ax) * vx + (z - az) * vz) / vv; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - hw, k = j * n + i;
        if (d < RS[k]) RS[k] = d;
      }
    }
  }
  const roadSD = (x, z) => {
    const fx = clamp((x - o) / st, 0, n - 1.001), fz = clamp((z - o) / st, 0, n - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * n + ix;
    return (RS[k] + (RS[k + 1] - RS[k]) * tx) * (1 - tz) + (RS[k + n] + (RS[k + n + 1] - RS[k + n]) * tx) * tz;
  };
  const chan = hf.chanDist;
  const riverD = (x, z) => {
    const i = Math.round((x - o) / st), j = Math.round((z - o) / st);
    if (i < 0 || j < 0 || i >= n || j >= n) return 1e9;
    return chan[j * n + i];
  };
  const lakeE = (x, z) => { const dx = x - LAKE.x, dz = z - LAKE.z; return Math.hypot(dx, dz) - lakeRadiusAt(Math.atan2(dz, dx)); };
  const slopeAt = (x, z) => { const e = 3; return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e); };

  // ---------------------------------------------------------------- field seeds
  const G = Math.ceil((half + SP) * 2 / SP) + 1, G0 = -(half + SP);
  const seeds = [];
  const rng = mulberry(4242);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = G0 + (i + 0.5) * SP + (rng() - 0.5) * SP * 0.8, z = G0 + (j + 0.5) * SP + (rng() - 0.5) * SP * 0.8;
    const r = rng(), h = heightAt(x, z), sl = slopeAt(x, z), dR = distToRect(x, z, TOWN.rect);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    let near = 1e9; for (const s of SITES) if (s.type === 'farm' || s.type === 'villa') near = Math.min(near, Math.hypot(x - s.x, z - s.z));
    let cls;
    if (edge > 690) cls = r < 0.5 ? CLS.WOOD : r < 0.7 ? CLS.MEADOW : r < 0.85 ? CLS.WHEAT : CLS.PLOUGH;
    else if (dR < 75) cls = r < 0.6 ? CLS.OLIVE : r < 0.8 ? CLS.MEADOW : r < 0.9 ? CLS.VINE : CLS.SCRUB;
    else if (riverD(x, z) < 50) cls = r < 0.7 ? CLS.MEADOW : CLS.WHEAT;
    else if (sl > 0.32) cls = r < 0.45 ? CLS.WOOD : r < 0.75 ? CLS.SCRUB : CLS.OLIVE;
    else if (near < 190) cls = r < 0.4 ? CLS.VINE : r < 0.62 ? CLS.OLIVE : r < 0.75 ? CLS.WHEAT : r < 0.88 ? CLS.STUBBLE : CLS.PLOUGH;
    else if (h > 22 || edge > 590) cls = r < 0.42 ? CLS.WOOD : r < 0.55 ? CLS.SCRUB : r < 0.7 ? CLS.OLIVE : r < 0.85 ? CLS.STUBBLE : CLS.MEADOW;
    else cls = r < 0.17 ? CLS.WHEAT : r < 0.34 ? CLS.STUBBLE : r < 0.49 ? CLS.PLOUGH : r < 0.65 ? CLS.VINE : r < 0.79 ? CLS.OLIVE : r < 0.91 ? CLS.MEADOW : CLS.WOOD;
    // contour-following row direction: rows run across the slope
    const gx = heightAt(x + 8, z) - heightAt(x - 8, z), gz = heightAt(x, z + 8) - heightAt(x, z - 8);
    let ang = Math.hypot(gx, gz) > 0.4 ? Math.atan2(gz, gx) : rng() * Math.PI; // row normal = gradient
    ang = ((ang % Math.PI) + Math.PI) % Math.PI;
    seeds.push({ x, z, cls, ang, tint: rng(), id: seeds.length, walls: rng() });
  }
  const nearestSeeds = (x, z, out) => {
    const ci = Math.floor((x - G0) / SP), cj = Math.floor((z - G0) / SP);
    let d1 = 1e18, d2 = 1e18, s1 = null, s2 = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= G || j >= G) continue;
      const s = seeds[j * G + i], dx = x - s.x, dz = z - s.z, d = dx * dx + dz * dz;
      if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = s; } else if (d < d2) { d2 = d; s2 = s; }
    }
    out.s = s1;
    out.e = s2 ? (d2 - d1) / (2 * Math.hypot(s2.x - s1.x, s2.z - s1.z)) : 99;
    return out;
  };

  // ---------------------------------------------------------------- per-texel land use
  const NN = n * n;
  const L0 = new Uint8Array(NN * 4 * 3); // 3 layers RGBA8
  const L1o = NN * 4, L2o = NN * 8;
  const cls = new Uint8Array(NN);           // class per texel (for placement / grass)
  const q = {};
  for (let j = 0; j < n; j++) {
    const z = o + j * st;
    for (let i = 0; i < n; i++) {
      const x = o + i * st, k = j * n + i, p = k * 4;
      // normal
      const hl = H[j * n + Math.max(0, i - 1)], hr = H[j * n + Math.min(n - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * n + i], hd = H[Math.min(n - 1, j + 1) * n + i];
      let nx = -(hr - hl) / (2 * st), nz = -(hd - hu) / (2 * st);
      const nl = Math.sqrt(nx * nx + nz * nz + 1); nx /= nl; nz /= nl;
      L0[p] = Math.round((nx * 0.5 + 0.5) * 255); L0[p + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      L0[p + 3] = Math.round(clamp((RS[k] - ROAD_SD_MIN) / (ROAD_SD_MAX - ROAD_SD_MIN), 0, 1) * 255);

      nearestSeeds(x, z, q);
      const s = q.s;
      let wheat = 0, plough = 0, lush = 0, vine = 0, dry = 0, woods = 0, wet = 0;
      let c = s.cls;
      switch (c) {
        case CLS.MEADOW: lush = 0.75; dry = 0.25; break;
        case CLS.WHEAT: wheat = 1; break;
        case CLS.STUBBLE: dry = 1; break;
        case CLS.PLOUGH: plough = 1; break;
        case CLS.VINE: vine = 1; break;
        case CLS.OLIVE: dry = 0.55; lush = 0.35; break;
        case CLS.WOOD: woods = 1; break;
        case CLS.SCRUB: dry = 0.75; lush = 0.1; break;
      }
      let tint = s.tint;
      // field margins (grass strips / hedgerows)
      const em = 1 - smooth(1.2, 3.2, q.e);
      if (em > 0) {
        const k2 = 1 - em;
        wheat *= k2; plough *= k2; vine *= k2; woods *= k2; dry = dry * k2 + 0.5 * em; lush = lush * k2 + 0.45 * em;
        if (em > 0.5) c = CLS.EDGE;
      }
      // town plateau and pads: mown grass
      const dR = distToRect(x, z, TOWN.rect);
      let padW = dR < TOWN.plateauMargin + 4 ? 1 - smooth(TOWN.plateauMargin, TOWN.plateauMargin + 4, dR) : 0;
      if (dR <= 0) c = CLS.TOWN; else if (padW > 0.5) c = CLS.PAD;
      for (const si of SITES) {
        const d = Math.hypot(x - si.x, z - si.z);
        if (d < si.r + 8) { const w = 1 - smooth(si.r, si.r + 8, d); if (w > padW) padW = w; if (d < si.r) c = CLS.PAD; }
      }
      if (padW > 0) {
        const k2 = 1 - padW;
        wheat *= k2; plough *= k2; vine *= k2; woods *= k2; dry = dry * k2 + 0.55 * padW; lush = lush * k2 + 0.4 * padW;
      }
      // water edges
      const rd = chan[k];
      if (rd < RIVER_HALF_W + 7) { wet = Math.max(wet, 1 - smooth(RIVER_HALF_W + 1, RIVER_HALF_W + 7, rd)); if (rd < RIVER_HALF_W + 1.5) c = CLS.WATER; }
      const le = lakeE(x, z);
      if (le < 7) { wet = Math.max(wet, 1 - smooth(0.5, 7, le)); if (le < 1) c = CLS.WATER; }
      if (wet > 0) { const k2 = 1 - wet * 0.8; wheat *= k2; plough *= k2; vine *= k2; dry *= k2; }
      if (RS[k] < 0.3) c = CLS.ROAD;
      // blend to the far land use at the border of the detailed area
      const r = Math.max(Math.abs(x), Math.abs(z));
      if (r > 700) {
        const w = smooth(700, half - 4, r), F = farLand(ns, x, z), k2 = 1 - w;
        wheat = wheat * k2 + F.wheat * w; plough = plough * k2 + F.plough * w; lush = lush * k2 + F.lush * w;
        dry = dry * k2 + F.dry * w; woods = woods * k2 + F.woods * w; vine *= k2; wet *= k2;
        tint = tint * k2 + 0.5 * w;
      }
      cls[k] = c;
      L0[p + 2] = Math.round(tint * 255);
      L0[L1o + p] = wheat * 255; L0[L1o + p + 1] = plough * 255; L0[L1o + p + 2] = lush * 255; L0[L1o + p + 3] = vine * 255;
      L0[L2o + p] = dry * 255; L0[L2o + p + 1] = woods * 255; L0[L2o + p + 2] = wet * 255; L0[L2o + p + 3] = Math.round(s.ang / Math.PI * 255);
    }
  }
  const tex = new THREE.DataArrayTexture(L0, n, n, 3);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const t1 = performance.now();

  const classAt = (x, z) => {
    const i = Math.round((x - o) / st), j = Math.round((z - o) / st);
    if (i < 0 || j < 0 || i >= n || j >= n) return CLS.WOOD;
    return cls[j * n + i];
  };
  const seedAt = (x, z) => nearestSeeds(x, z, {});

  const place = placeAll({ hf, seeds, G, G0, nearestSeeds, roadSD, riverD, lakeE, classAt, slopeAt, ns });
  const t2 = performance.now();
  return { tex, cls, classAt, seedAt, roadSD, riverD, lakeE, slopeAt, seeds, ...place, timings: { land: t1 - t0, place: t2 - t1 } };
}

// ------------------------------------------------------------------ placement
function placeAll(ctx) {
  const { hf, seeds, roadSD, riverD, lakeE, classAt, slopeAt, ns } = ctx;
  const heightAt = hf.heightAt;
  const rng = mulberry(777);
  const T = { cypress: [], olive: [], oak: [], pine: [], poplar: [], bush: [], vine: [], bale: [], rock: [] };
  const walls = [];      // { pts: [[x,z],...], h, collide }
  const trunks = [];     // for colliders: [x, z, r, y, h]
  const add = (type, x, z, rot, s, sy, v, extra = 0) => {
    const y = heightAt(x, z);
    T[type].push(x, y, z, rot, s, sy, v, extra);
  };
  const inMap = (x, z, m = 2) => Math.abs(x) < FINE.half - m && Math.abs(z) < FINE.half - m;
  const padClear = (x, z, extra) => { for (const s of SITES) if (Math.hypot(x - s.x, z - s.z) < s.r + extra) return false; return true; };
  const free = (x, z, road = 2.5, pad = 3) => inMap(x, z) && roadSD(x, z) > road && riverD(x, z) > RIVER_HALF_W + 3 && lakeE(x, z) > 3 &&
    distToRect(x, z, TOWN.rect) > 4 && padClear(x, z, pad);
  const nearRoadOrSite = (x, z, d) => roadSD(x, z) < d || !padClear(x, z, d + 10) || distToRect(x, z, TOWN.rect) < d + 30;

  // ---- per-field content
  const seedTmp = {};
  for (const s of seeds) {
    if (Math.max(Math.abs(s.x), Math.abs(s.z)) > FINE.half + 40) continue;
    const ca = Math.cos(s.ang), sa = Math.sin(s.ang);   // row normal
    const R = 70; // scan radius around the seed (cells are ≤ ~90 m)
    const inField = (x, z, margin) => { ctx.nearestSeeds(x, z, seedTmp); return seedTmp.s === s && seedTmp.e > margin; };
    if (s.cls === CLS.OLIVE) {
      const sp = 7.6 + s.tint * 1.5;
      for (let a = -R; a <= R; a += sp) for (let b = -R; b <= R; b += sp) {
        const x = s.x + ca * a - sa * b + (rng() - 0.5) * 1.2, z = s.z + sa * a + ca * b + (rng() - 0.5) * 1.2;
        if (!inField(x, z, 3) || !free(x, z, 3.5) || rng() < 0.07) continue;
        add('olive', x, z, rng() * 6.28, 0.8 + rng() * 0.45, 0.85 + rng() * 0.3, rng());
        if (nearRoadOrSite(x, z, 25)) trunks.push([x, z, 0.35, 2.2]);
      }
    } else if (s.cls === CLS.VINE) {
      const sp = 2.6, seg = 6;
      // rows are lines perpendicular to the row normal (ca, sa): along direction (-sa, ca)
      const off = ((s.x * ca + s.z * sa) % sp + sp) % sp;
      for (let a = -R - off; a <= R; a += sp) for (let b = -R; b <= R; b += seg) {
        const x = s.x + ca * a - sa * (b + seg / 2), z = s.z + sa * a + ca * (b + seg / 2);
        if (!inField(x, z, 4.5) || !free(x, z, 3.5, 4)) continue;
        // skip segments whose ends leave the field
        const x0 = x + sa * seg / 2, z0 = z - ca * seg / 2, x1 = x - sa * seg / 2, z1 = z + ca * seg / 2;
        if (!inField(x0, z0, 3.5) || !inField(x1, z1, 3.5) || !free(x0, z0, 3, 4) || !free(x1, z1, 3, 4)) continue;
        const y0 = heightAt(x0, z0), y1 = heightAt(x1, z1);
        const rot = Math.atan2(-(x1 - x0), -(z1 - z0)); // yaw so local -z points along the row
        const pitch = Math.atan2(y1 - y0, seg);
        T.vine.push(x, (y0 + y1) / 2, z, rot, 1, 0.9 + rng() * 0.2, rng(), pitch);
      }
      // a few cypresses or an olive at the vineyard corners
      if (s.walls > 0.6) add('cypress', s.x + sa * 20, s.z - ca * 20, rng() * 6, 1, 1, rng());
    } else if (s.cls === CLS.WOOD) {
      for (let a = -R; a <= R; a += 8.5) for (let b = -R; b <= R; b += 8.5) {
        const x = s.x + a + (rng() - 0.5) * 6, z = s.z + b + (rng() - 0.5) * 6;
        if (!inField(x, z, 1) || !free(x, z, 4) || rng() < 0.12) continue;
        const r = rng();
        const type = r < 0.58 ? 'oak' : r < 0.84 ? 'pine' : 'cypress';
        add(type, x, z, rng() * 6.28, type === 'oak' ? 0.8 + rng() * 0.6 : 0.85 + rng() * 0.4, 0.85 + rng() * 0.35, rng());
        if (nearRoadOrSite(x, z, 15)) trunks.push([x, z, type === 'cypress' ? 0.35 : 0.45, 3]);
        if (rng() < 0.35) add('bush', x + (rng() - 0.5) * 6, z + (rng() - 0.5) * 6, rng() * 6.28, 0.8 + rng() * 0.7, 0.8 + rng() * 0.4, rng());
      }
    } else if (s.cls === CLS.SCRUB) {
      for (let a = -R; a <= R; a += 9) for (let b = -R; b <= R; b += 9) {
        const x = s.x + a + (rng() - 0.5) * 8, z = s.z + b + (rng() - 0.5) * 8;
        if (!inField(x, z, 1) || !free(x, z, 3)) continue;
        const r = rng();
        if (r < 0.45) add('bush', x, z, rng() * 6.28, 0.7 + rng() * 0.9, 0.7 + rng() * 0.5, rng());
        else if (r < 0.58) add('rock', x, z, rng() * 6.28, 0.5 + rng() * 1.3, 0.5 + rng() * 0.4, rng());
        else if (r < 0.66) add(rng() < 0.6 ? 'oak' : 'pine', x, z, rng() * 6.28, 0.7 + rng() * 0.4, 0.8 + rng() * 0.3, rng());
      }
    } else if (s.cls === CLS.STUBBLE) {
      // round bales dropped in lines along the harvest direction
      const lines = 2 + Math.floor(rng() * 3);
      for (let l = 0; l < lines; l++) {
        const a = (rng() - 0.5) * 60;
        for (let b = -R; b <= R; b += 9 + rng() * 14) {
          const x = s.x + ca * a - sa * b, z = s.z + sa * a + ca * b;
          if (!inField(x, z, 4) || !free(x, z, 4) || rng() < 0.3) continue;
          add('bale', x, z, rng() * 6.28, 0.95 + rng() * 0.15, 1, rng());
          const y = heightAt(x, z);
          trunks.push([x, z, 0.8, 1.5, y]);
        }
      }
    } else if (s.cls === CLS.MEADOW && s.walls < 0.25) {
      // a lone oak or two
      for (let k = 0; k < 2; k++) {
        const x = s.x + (rng() - 0.5) * 50, z = s.z + (rng() - 0.5) * 50;
        if (inField(x, z, 4) && free(x, z, 6)) { add('oak', x, z, rng() * 6.28, 1.1 + rng() * 0.4, 1, rng()); trunks.push([x, z, 0.5, 3]); }
      }
    }
  }

  // ---- hedgerows along some field margins (bushes, the odd oak or cypress)
  for (let x = -760; x <= 760; x += 3.2) for (let z = -760; z <= 760; z += 3.2) {
    const jx = x + (rand2(x | 0, z | 0, 5) - 0.5) * 2.4, jz = z + (rand2(x | 0, z | 0, 6) - 0.5) * 2.4;
    ctx.nearestSeeds(jx, jz, seedTmp);
    if (seedTmp.e > 1.4) continue;
    const s = seedTmp.s;
    if (s.walls > 0.55 || s.cls === CLS.WOOD) continue;
    if (!free(jx, jz, 3.5, 2)) continue;
    const r = rng();
    if (r < 0.32) add('bush', jx, jz, rng() * 6.28, 0.8 + rng() * 0.8, 0.8 + rng() * 0.5, rng());
    else if (r < 0.345) { add('oak', jx, jz, rng() * 6.28, 0.9 + rng() * 0.5, 1, rng()); if (nearRoadOrSite(jx, jz, 12)) trunks.push([jx, jz, 0.5, 3]); }
    else if (r < 0.36) add('cypress', jx, jz, rng() * 6.28, 0.9 + rng() * 0.3, 0.9 + rng() * 0.3, rng());
  }

  // ---- cypress avenues along roads and rings around sites
  const avenue = (roadId, s0, s1, spacing, offset, sides = 2) => {
    const r = hf.roads.find((q) => q.id === roadId);
    if (!r) return;
    const m = r.X.length;
    let next = s0;
    for (let i = 1; i < m; i++) {
      if (r.S[i] < next) continue;
      if (r.S[i] > s1) break;
      next += spacing;
      const tx = r.X[i] - r.X[i - 1], tz = r.Z[i] - r.Z[i - 1], tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl;
      for (const side of sides === 2 ? [-1, 1] : [sides]) {
        const off = r.hw + offset + (rng() - 0.5) * 0.4;
        const x = r.X[i] + nx * off * side, z = r.Z[i] + nz * off * side;
        if (!inMap(x, z) || roadSD(x, z) < offset - 0.6 || riverD(x, z) < RIVER_HALF_W + 3 || lakeE(x, z) < 3 || distToRect(x, z, TOWN.rect) < 3) continue;
        if (!padClear(x, z, -6)) continue;
        add('cypress', x, z, rng() * 6.28, 0.9 + rng() * 0.25, 0.9 + rng() * 0.25, rng());
        trunks.push([x, z, 0.35, 3]);
      }
    }
  };
  avenue('south', 30, 260, 10, 2.6);
  avenue('east-villa', 60, 260, 9, 2.6);
  avenue('west-pieve', 190, 330, 10, 2.6);
  avenue('north', 360, 470, 11, 2.8, 1);
  avenue('east-rocca', 380, 470, 11, 2.8, -1);
  avenue('west', 300, 380, 12, 2.8, -1);
  avenue('pieve-farm', 170, 250, 10, 2.6, 1);
  const ring = (site, count, extra, arcFrom = 0, arcTo = Math.PI * 2) => {
    for (let k = 0; k < count; k++) {
      const a = arcFrom + (arcTo - arcFrom) * (k + 0.5) / count;
      const rr = site.r + extra + (rng() - 0.5) * 1.5;
      const x = site.x + Math.cos(a) * rr, z = site.z + Math.sin(a) * rr;
      if (!inMap(x, z) || roadSD(x, z) < 2.5 || riverD(x, z) < RIVER_HALF_W + 3) continue;
      add('cypress', x, z, rng() * 6.28, 0.95 + rng() * 0.25, 0.95 + rng() * 0.3, rng());
      trunks.push([x, z, 0.35, 3]);
    }
  };
  const S = Object.fromEntries(SITES.map((s) => [s.id, s]));
  ring(S.chapel, 14, 5);
  ring(S.pieve, 12, 5, 0.3, 2.6);
  ring(S.villa, 18, 6, 3.4, 6.0);
  ring(S.watchtower, 7, 6, 0.5, 3.5);
  ring(S['farm-w'], 5, 7, 4.2, 5.8);
  ring(S['farm-e'], 5, 7, 0.4, 2.0);
  ring(S['farm-n'], 5, 7, 1.0, 2.6);
  ring(S.abbey, 8, 7, 3.6, 5.4);
  // the town: cypresses and olives dotting the slopes under the walls
  for (let k = 0; k < 40; k++) {
    const a = rng() * Math.PI * 2, d = 24 + rng() * 60;
    const [x0, x1, z0, z1] = TOWN.rect;
    const px = clamp(Math.cos(a) * 400, x0 - d, x1 + d), pz = clamp(Math.sin(a) * 400, z0 - d, z1 + d);
    if (!free(px, pz, 4)) continue;
    add('cypress', px, pz, rng() * 6.28, 0.9 + rng() * 0.3, 0.9 + rng() * 0.3, rng());
  }

  // ---- riparian poplars along the river, a few around the lake
  {
    const { X, Z } = hf.river;
    for (let i = 2; i < X.length - 2; i += 3) {
      if (!inMap(X[i], Z[i], 10) || rng() < 0.45) continue;
      const tx = X[i + 1] - X[i - 1], tz = Z[i + 1] - Z[i - 1], tl = Math.hypot(tx, tz) || 1;
      const side = rng() < 0.5 ? -1 : 1, off = RIVER_HALF_W + 4 + rng() * 6;
      const x = X[i] - tz / tl * off * side, z = Z[i] + tx / tl * off * side;
      if (!inMap(x, z) || roadSD(x, z) < 3 || !padClear(x, z, 2) || riverD(x, z) < RIVER_HALF_W + 2.5) continue;
      if (rng() < 0.7) add('poplar', x, z, rng() * 6.28, 0.85 + rng() * 0.35, 0.9 + rng() * 0.3, rng());
      else add('bush', x, z, rng() * 6.28, 1 + rng() * 0.8, 0.8 + rng() * 0.4, rng());
    }
    for (let k = 0; k < 26; k++) {
      const a = rng() * Math.PI * 2, rr = lakeRadiusAt(a) + 5 + rng() * 9;
      const x = LAKE.x + Math.cos(a) * rr, z = LAKE.z + Math.sin(a) * rr;
      if (!free(x, z, 3) || lakeE(x, z) < 4) continue;
      add(rng() < 0.6 ? 'poplar' : 'bush', x, z, rng() * 6.28, 0.8 + rng() * 0.4, 0.9 + rng() * 0.3, rng());
    }
  }

  // ---- rocks along roads and on steep ground
  for (let k = 0; k < 900; k++) {
    const x = (rng() - 0.5) * 1500, z = (rng() - 0.5) * 1500;
    if (!free(x, z, 2)) continue;
    const sl = slopeAt(x, z), c = classAt(x, z);
    if (sl < 0.3 && !(c === CLS.SCRUB || c === CLS.EDGE || c === CLS.MEADOW) ) continue;
    const s = 0.4 + rng() * (sl > 0.3 ? 1.6 : 0.8);
    add('rock', x, z, rng() * 6.28, s, 0.45 + rng() * 0.4, rng());
    if (s > 1.1) trunks.push([x, z, s * 0.8, s * 0.8]);
  }

  // ---- far woods on the hills beyond the map (low-poly only)
  const farTrees = [];
  for (let x = -1500; x <= 1500; x += 24) for (let z = -1500; z <= 1500; z += 24) {
    const jx = x + (rand2(x, z, 11) - 0.5) * 20, jz = z + (rand2(x, z, 12) - 0.5) * 20;
    const r = Math.max(Math.abs(jx), Math.abs(jz));
    if (r < FINE.half + 6 || r > 1500) continue;
    const F = farLand(ns, jx, jz);
    if (rand2(x, z, 13) > F.woods * 0.9 + 0.03) continue;
    const t = rand2(x, z, 14);
    farTrees.push(jx, heightAt(jx, jz), jz, t * 6.28, 1.6 + t * 0.8, 1, t, t < 0.2 ? 1 : 0);
  }

  // ---- dry-stone walls: along roads near the town and the farms, terraces under the walls
  const roadWall = (roadId, s0, s1, side, offset = 1.9) => {
    const r = hf.roads.find((q) => q.id === roadId);
    if (!r) return;
    const pts = [];
    for (let i = 1; i < r.X.length; i++) {
      if (r.S[i] < s0 || r.S[i] > s1) continue;
      const tx = r.X[i] - r.X[i - 1], tz = r.Z[i] - r.Z[i - 1], tl = Math.hypot(tx, tz) || 1;
      const x = r.X[i] - tz / tl * (r.hw + offset) * side, z = r.Z[i] + tx / tl * (r.hw + offset) * side;
      const ok = inMap(x, z) && riverD(x, z) > RIVER_HALF_W + 4 && padClear(x, z, 0) && distToRect(x, z, TOWN.rect) > 2 && roadSD(x, z) > offset - 0.5;
      if (ok) pts.push([x, z]);
      else if (pts.length) { if (pts.length > 3) walls.push({ pts: pts.splice(0), h: 1.05, collide: true }); else pts.length = 0; }
    }
    if (pts.length > 3) walls.push({ pts, h: 1.05, collide: true });
  };
  roadWall('south', 22, 150, 1); roadWall('south', 40, 110, -1);
  roadWall('east', 22, 95, 1);
  roadWall('west', 25, 100, -1);
  roadWall('north', 22, 120, 1);
  roadWall('pieve-farm', 20, 120, -1);
  roadWall('east-villa', 20, 60, 1);
  roadWall('north-quarry', 60, 180, 1);
  roadWall('west-abbey', 300, 400, 1);
  // terrace walls following contours on the town hill (olive slopes)
  terraceWalls(hf, walls, (x, z) => {
    const c = classAt(x, z);
    return (c === CLS.OLIVE || c === CLS.EDGE || c === CLS.SCRUB) && free(x, z, 3, 3) && distToRect(x, z, TOWN.rect) > 22;
  });

  return { inst: T, farTrees, walls, trunks };
}

// Marching squares on a region around the town at a few iso-levels; emits short wall polylines.
function terraceWalls(hf, walls, ok) {
  const [x0, x1, z0, z1] = TOWN.rect, pad = 130, st = 4;
  const nx = Math.ceil((x1 - x0 + pad * 2) / st), nz = Math.ceil((z1 - z0 + pad * 2) / st);
  const ox = x0 - pad, oz = z0 - pad;
  const levels = [-5, -9, -13, -17, -21, -25];
  for (const L of levels) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const xa = ox + i * st, za = oz + j * st;
      const h00 = hf.heightAt(xa, za) - L, h10 = hf.heightAt(xa + st, za) - L, h01 = hf.heightAt(xa, za + st) - L, h11 = hf.heightAt(xa + st, za + st) - L;
      const pts = [];
      const edge = (ha, hb, ax, az, bx, bz) => { if ((ha < 0) !== (hb < 0)) { const t = ha / (ha - hb); pts.push([ax + (bx - ax) * t, az + (bz - az) * t]); } };
      edge(h00, h10, xa, za, xa + st, za); edge(h10, h11, xa + st, za, xa + st, za + st);
      edge(h11, h01, xa + st, za + st, xa, za + st); edge(h01, h00, xa, za + st, xa, za);
      if (pts.length !== 2) continue;
      const mx = (pts[0][0] + pts[1][0]) / 2, mz = (pts[0][1] + pts[1][1]) / 2;
      if (!ok(mx, mz)) continue;
      walls.push({ pts, h: 0.8, collide: false, terrace: true });
    }
  }
}

export { mulberry };
void MAP_HALF; void ROADS;
