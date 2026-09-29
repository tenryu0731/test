// Countryside landmarks: one detailed compound per layout.js SITES pad (pieve, rocca, abbey, villa,
// mill + bridge, three poderi, chapel, watchtower, quarry). Each site is baked into a handful of
// meshes (one per material) in three LOD levels:
//   near  (< ~150 m): main + detail meshes (small props, glazing bars, bells, gravestones…)
//   mid   (< ~340 m): main textured meshes
//   far   (beyond):   one merged vertex-colour mesh (1 draw call per site)
// Returns colliders, nav points, enemy sites, viewpoints and map markers (see docs/CONTRACT.md).
import * as THREE from 'three';
import { SITES, ROADS, RIVER } from './layout.js';
import { LGeo, mulberry32, farMeshFrom } from './landmarks-geo.js';
import { Kit } from './landmarks-kit.js';
import { createLandmarkMaterials } from './landmarks-mat.js';
import { buildPieve, buildChapel, buildWatchtower } from './landmarks-church.js';
import { buildRocca } from './landmarks-rocca.js';
import { buildAbbey } from './landmarks-abbey.js';
import { buildVilla } from './landmarks-villa.js';
import { buildMill } from './landmarks-mill.js';
import { buildFarm, buildQuarry } from './landmarks-farm.js';

const BUILDERS = { pieve: buildPieve, rocca: buildRocca, abbey: buildAbbey, villa: buildVilla, mill: buildMill, farm: buildFarm, chapel: buildChapel, watchtower: buildWatchtower, quarry: buildQuarry };
const NEAR = 150, MID = 340, HYST = 12;

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// Distance from (x, z) to the nearest road centreline (world).
function roadDist(x, z, skip = null) {
  let best = 1e9;
  for (const r of ROADS) {
    if (skip && skip.includes(r.id)) continue;
    const p = r.points;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - r.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}
// Distance to the river centreline and the bed height there.
export function riverAt(x, z) {
  let best = 1e9, by = 0;
  const P = RIVER.points;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az, ay] = P[i], [bx, bz, bY] = P[i + 1], vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) { best = d; by = ay + (bY - ay) * t; }
  }
  return { d: best, bed: by };
}

// A nav/spawn point is free when no collider blocks a body standing there (step-up boxes are fine).
function colGrid(cols) {
  const g = new Map(), C = 8;
  cols.forEach((b) => {
    for (let i = Math.floor(b.min.x / C); i <= Math.floor(b.max.x / C); i++) for (let j = Math.floor(b.min.z / C); j <= Math.floor(b.max.z / C); j++) {
      const k = i * 100003 + j; let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(b);
    }
  });
  return (x, z) => g.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) || [];
}
function clear(grid, x, y, z, rad = 0.7) {
  for (const b of grid(x, z)) {
    if (b.max.y <= y + 0.45 || b.min.y >= y + 1.7) continue;
    const dx = Math.max(b.min.x - x, 0, x - b.max.x), dz = Math.max(b.min.z - z, 0, z - b.max.z);
    if (dx * dx + dz * dz < rad * rad) return false;
  }
  return true;
}

export function buildLandmarks(scene, M, { heightAt } = {}) {
  const t0 = performance.now();
  const L = createLandmarkMaterials();
  const hAt = heightAt || (() => 0);
  const root = new THREE.Group();
  root.name = 'landmarks';
  scene.add(root);
  const colliders = [], navPoints = [], enemySites = [], viewpoints = [], markers = [];
  const sites = [];
  const stats = { mid: 0, near: 0, far: 0, meshes: 0 };
  const timings = [];

  for (const s of SITES) {
    const ts = performance.now();
    const ctx = {
      s, M, L, heightAt: hAt, G: new LGeo(s.y), D: new LGeo(s.y), col: [], navAreas: [], navLocal: [], spawns: [], viewpoints: [], anim: [],
      R: mulberry32(hashStr(s.id)), enemy: null, extraMeshes: [],
      // true when local (x, z) is at least `m` metres from every road edge
      roadClear: (x, z, m = 2, skip = null) => roadDist(K.wx(x, z), K.wz(x, z), skip) > m,
      spawnsLocal: (list) => { for (const [x, z, y = 0] of list) ctx.spawns.push(K.V(x, y, z)); },
      navRect: (x0, z0, x1, z1, y = 0, step = 5) => ctx.navAreas.push({ x0, z0, x1, z1, y, step }),
      navPts: (list) => { for (const [x, y, z] of list) ctx.navLocal.push(K.V(x, y, z)); },
      navExclude: null,
      groundLocal: (x, z) => hAt(K.wx(x, z), K.wz(x, z)) - s.y,
    };
    const K = Kit.root(ctx, s.x, s.y, s.z);
    const build = BUILDERS[s.type];
    const tb = performance.now();
    try { build(K, ctx); } catch (e) { console.error(`[landmarks] ${s.id} failed:`, e); }

    // --- meshes and LOD groups
    const mid = new THREE.Group(), near = new THREE.Group();
    mid.name = `lm-${s.id}-mid`; near.name = `lm-${s.id}-near`;
    const tf = performance.now();
    const gm = ctx.G.finish(mid), dm = ctx.D.finish(near);
    const tfar = performance.now();
    // The far LOD is merged lazily (one site per frame, see update) except for the first site,
    // so its material is compiled with the rest at boot.
    const far = sites.length === 0 ? farMeshFrom(gm.meshes) : null;
    const tn = performance.now();
    stats.tBuild = (stats.tBuild || 0) + tf - tb; stats.tFinish = (stats.tFinish || 0) + tfar - tf; stats.tFar = (stats.tFar || 0) + tn - tfar;
    for (const m of ctx.extraMeshes) mid.add(m);
    root.add(mid, near);
    if (far) { far.name = `lm-${s.id}-far`; root.add(far); }
    stats.mid += gm.tris; stats.near += dm.tris; stats.meshes += gm.meshes.length + dm.meshes.length;
    ctx.G.clear(); ctx.D.clear();
    sites.push({ s, mid, near, far, midMeshes: gm.meshes, anim: ctx.anim, nearOn: true, midOn: true });

    // --- gameplay data
    colliders.push(...ctx.col);
    const grid = colGrid(ctx.col);
    const navs = [];
    const areas = ctx.navAreas.length ? ctx.navAreas : [];
    // Default: grid over the pad.
    const pad = { x0: -s.r, z0: -s.r, x1: s.r, z1: s.r, y: 0, step: 5, disc: s.r - 2 };
    for (const a of [pad, ...areas]) {
      for (let x = a.x0; x <= a.x1 + 1e-6; x += a.step) for (let z = a.z0; z <= a.z1 + 1e-6; z += a.step) {
        if (a.disc && x * x + z * z > a.disc * a.disc) continue;
        if (ctx.navExclude && ctx.navExclude(x, z, a.y)) continue;
        const p = K.V(x, a.y, z);
        if (!clear(grid, p.x, p.y, p.z)) continue;
        navs.push(p);
      }
    }
    for (const p of ctx.navLocal) if (clear(grid, p.x, p.y, p.z, 0.5)) navs.push(p);
    navPoints.push(...navs);
    const spawns = ctx.spawns.filter((p) => clear(grid, p.x, p.y, p.z, 0.6));
    if (spawns.length < ctx.spawns.length) console.warn(`[landmarks] ${s.id}: ${ctx.spawns.length - spawns.length} blocked spawn(s) dropped`);
    while (spawns.length < 4 && navs.length) spawns.push(navs[Math.floor(ctx.R() * navs.length)].clone());
    const e = ctx.enemy || { x: 0, z: 0, r: s.r * 0.6 };
    const ec = K.V(e.x, e.y ?? 0, e.z);
    enemySites.push({ id: s.id, name: s.name, x: ec.x, y: ec.y, z: ec.z, r: e.r, spawns });
    viewpoints.push(...ctx.viewpoints);
    markers.push({ id: s.id, name: s.name, type: s.type, x: s.x, z: s.z });
    stats.tNav = (stats.tNav || 0) + performance.now() - tn;
    timings.push(`${s.id} ${(performance.now() - ts).toFixed(0)}`);
  }

  const ms = performance.now() - t0;
  console.log(`[landmarks] ${SITES.length} sites in ${ms.toFixed(0)} ms (${timings.join(', ')}); tris main ${stats.mid | 0} + detail ${stats.near | 0}; ` +
    `${stats.meshes} meshes (+1 far mesh per site); ${colliders.length} colliders, ${navPoints.length} nav points, ${viewpoints.length} viewpoints`);

  let time = 0;
  const cam = new THREE.Vector3();
  return {
    colliders, navPoints, enemySites, viewpoints, markers, group: root, stats,
    update(dt, camera) {
      time += dt;
      if (!camera) return;
      camera.getWorldPosition(cam);
      let merged = false;
      for (const q of sites) {
        const dx = cam.x - q.s.x, dy = (cam.y - q.s.y) * 0.7, dz = cam.z - q.s.z, d2 = dx * dx + dy * dy + dz * dz;
        const nearLim = q.nearOn ? NEAR + HYST : NEAR - HYST, midLim = q.midOn ? MID + HYST : MID - HYST;
        const nOn = d2 < nearLim * nearLim, mOn = d2 < midLim * midLim;
        if (nOn !== q.nearOn) { q.nearOn = nOn; q.near.visible = nOn; }
        if (!mOn && !q.far && !merged) { // merge the far LOD on first need (at most one per frame)
          q.far = farMeshFrom(q.midMeshes); merged = true;
          if (q.far) { q.far.name = `lm-${q.s.id}-far`; root.add(q.far); stats.far += q.far.userData.tris; q.midOn = !mOn; }
        }
        if (mOn !== q.midOn && (mOn || q.far)) { q.midOn = mOn; q.mid.visible = mOn; if (q.far) q.far.visible = !mOn; }
        else if (q.far && q.far.visible === q.mid.visible) q.far.visible = !q.mid.visible;
        if (nOn) for (const a of q.anim) a(dt, time);
      }
    },
  };
}
