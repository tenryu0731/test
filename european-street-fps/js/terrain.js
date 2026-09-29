// Tuscan countryside around San Gimignano (terrain agent).
// createTerrain(scene, { materials, renderer, camera }) -> { heightAt, colliders, navPoints, meshes, update, setQuality }
//   terrain-height.js  height field (2 m grid ±768 m + 16 m far grid), plateau, pads, graded roads, lake, river
//   terrain-land.js    field patchwork, road distance field, data textures, placement of trees/props/walls
//   terrain-mesh.js    quadtree chunked-LOD ground with splat shader (roads, fields, vine rows, rock)
//   terrain-veg.js     trees, vines, bales, rocks: near instanced cells + far merged low-poly
//   terrain-grass.js   grass and flowers around the camera with wind
//   terrain-water.js   lake + flowing river
import * as THREE from 'three';
import { TOWN, SITES, PLAY_HALF } from './layout.js';
import { buildHeightfield, RIVER_HALF_W, distToRect } from './terrain-height.js';
import { buildLand } from './terrain-land.js';
import { makeGroundTextures, makeNoiseTexture } from './terrain-tex.js';
import { createTerrainSurface } from './terrain-mesh.js';
import { createVegetation } from './terrain-veg.js';
import { createGrass } from './terrain-grass.js';
import { createWater } from './terrain-water.js';

function detectQuality() {
  try {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    return touch ? 'medium' : 'high';
  } catch { return 'high'; }
}

export function createTerrain(scene, { materials = {}, renderer = null, camera = null } = {}) {
  const T0 = performance.now();
  const quality = detectQuality();
  const hf = buildHeightfield();
  const heightAt = hf.heightAt;
  const T1 = performance.now();
  const noise = makeNoiseTexture(256);
  const ground = makeGroundTextures(quality === 'low' ? 128 : 256);
  const T2 = performance.now();
  const land = buildLand(hf, noise);
  const T3 = performance.now();
  const surface = createTerrainSurface(scene, { heightAt, fieldTex: land.tex, ground, noiseTex: noise.tex, quality });
  const water = createWater(scene, hf.river);
  const T4 = performance.now();
  const veg = createVegetation(scene, land, { quality, heightAt });
  surface.material.userData.uniforms.uVineNear.value = veg.vineR.value;
  const grass = createGrass(scene, land, heightAt, quality);
  const T5 = performance.now();
  const walls = buildWalls(scene, land.walls, heightAt, materials.stone);
  const T6 = performance.now();

  // ---------------------------------------------------------------- colliders
  const colliders = [...walls.colliders];
  const MAXC = 1400;
  // trunks/bales/rocks sorted by importance (near roads, sites and the town first)
  const tr = land.trunks.map((t) => {
    const [x, z] = t;
    let d = Math.min(land.roadSD(x, z), distToRect(x, z, TOWN.rect) - 20);
    for (const s of SITES) d = Math.min(d, Math.hypot(x - s.x, z - s.z) - s.r - 10);
    return { t, d };
  }).sort((a, b) => a.d - b.d);
  for (const { t } of tr) {
    if (colliders.length >= MAXC) break;
    const [x, z, r, h] = t, y = t[4] ?? heightAt(x, z);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, y - 0.5, z - r), new THREE.Vector3(x + r, y + h, z + r)));
  }

  // ---------------------------------------------------------------- nav points
  const navPoints = [];
  const inPlay = (x, z) => Math.abs(x) < PLAY_HALF - 2 && Math.abs(z) < PLAY_HALF - 2;
  for (const r of hf.roads) {
    let next = 0;
    for (let i = 0; i < r.X.length; i++) {
      if (r.S[i] < next) continue;
      next = r.S[i] + 8;
      const x = r.X[i], z = r.Z[i];
      if (!inPlay(x, z) || distToRect(x, z, TOWN.rect) < 1 || land.riverD(x, z) < RIVER_HALF_W + 2) continue;
      navPoints.push(new THREE.Vector3(x, heightAt(x, z), z));
    }
  }
  for (let x = -PLAY_HALF + 12; x < PLAY_HALF; x += 24) for (let z = -PLAY_HALF + 12; z < PLAY_HALF; z += 24) {
    if (distToRect(x, z, TOWN.rect) < 6 || land.roadSD(x, z) < 3) continue;
    if (land.riverD(x, z) < RIVER_HALF_W + 3 || land.lakeE(x, z) < 2) continue;
    if (SITES.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
    if (land.slopeAt(x, z) > 0.45) continue;
    navPoints.push(new THREE.Vector3(x, heightAt(x, z), z));
  }

  const meshes = [surface.group, ...water.meshes, ...veg.meshes, ...grass.meshes, ...walls.meshes];
  const total = performance.now() - T0;
  console.log(`[terrain] ${total.toFixed(0)} ms (height ${(T1 - T0).toFixed(0)}, textures ${(T2 - T1).toFixed(0)}, land ${(T3 - T2).toFixed(0)}, ` +
    `surface+water ${(T4 - T3).toFixed(0)}, vegetation ${(T5 - T4).toFixed(0)}, walls ${(T6 - T5).toFixed(0)}); quality ${quality}; ` +
    `${colliders.length} colliders, ${navPoints.length} nav points, ${veg.stats.instCount} instances; roads max grade ` +
    hf.roads.map((r) => `${r.id} ${(r.maxGrade * 100).toFixed(0)}%`).join(', '));

  if (camera) surface.update(camera);
  return {
    heightAt, colliders, navPoints, meshes,
    roads: hf.roads.map((r) => ({ id: r.id, width: r.width, points: Array.from(r.X, (x, i) => [x, r.H[i], r.Z[i]]) })),
    river: { points: Array.from(hf.river.X, (x, i) => [x, hf.river.W[i], hf.river.Z[i]]), halfWidth: RIVER_HALF_W },
    update(dt, cam) {
      if (!cam) return;
      surface.update(cam);
      veg.update(dt, cam);
      grass.update(dt, cam);
      water.update(dt);
    },
    setQuality(q) { surface.setQuality(q); veg.setQuality(q); },
    stats: { buildMs: total, veg: veg.stats },
  };
  void renderer;
}

// ------------------------------------------------------------------ dry-stone walls
function buildWalls(scene, list, heightAt, stoneMat) {
  const chunks = new Map();
  let pos, nor, uv, col;
  const colliders = [];
  const quad = (a, b, c, d, n, ua, ub, va, vb, shadeK) => {
    for (const [p, u, v] of [[a, ua, va], [b, ub, va], [c, ub, vb], [a, ua, va], [c, ub, vb], [d, ua, vb]]) {
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(u / 3, v / 3); col.push(shadeK, shadeK, shadeK);
    }
  };
  let s = 0;
  for (const w of list) {
    const pts = w.pts;
    const key = Math.floor(pts[0][0] / 400) + ',' + Math.floor(pts[0][1] / 400);
    if (!chunks.has(key)) chunks.set(key, { pos: [], nor: [], uv: [], col: [] });
    ({ pos, nor, uv, col } = chunks.get(key));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.2) continue;
      const tx = (x1 - x0) / len, tz = (z1 - z0) / len, nx = -tz, nz = tx;
      const g0 = heightAt(x0, z0), g1 = heightAt(x1, z1);
      const j0 = Math.sin(x0 * 1.7 + z0 * 2.3) * 0.08, j1 = Math.sin(x1 * 1.7 + z1 * 2.3) * 0.08;
      const bw = w.terrace ? 0.4 : 0.36, tw = w.terrace ? 0.3 : 0.26;
      const y0b = g0 - (w.terrace ? 0.9 : 0.35), y1b = g1 - (w.terrace ? 0.9 : 0.35);
      const y0t = g0 + (w.terrace ? 0.4 : w.h) + j0, y1t = g1 + (w.terrace ? 0.4 : w.h) + j1;
      const L = (x, z, off, y) => [x + nx * off, y, z + nz * off];
      const A0 = L(x0, z0, bw, y0b), A1 = L(x1, z1, bw, y1b), B0 = L(x0, z0, tw, y0t), B1 = L(x1, z1, tw, y1t);
      const C0 = L(x0, z0, -bw, y0b), C1 = L(x1, z1, -bw, y1b), D0 = L(x0, z0, -tw, y0t), D1 = L(x1, z1, -tw, y1t);
      const k = 0.9 + 0.1 * Math.sin(s * 0.7);
      quad(A0, A1, B1, B0, [nx, 0.15, nz], s, s + len, y0b, y0t, k);
      quad(C1, C0, D0, D1, [-nx, 0.15, -nz], s + len, s, y1b, y1t, k);
      quad(B0, B1, D1, D0, [0, 1, 0], s, s + len, 0, 0.6, k * 0.95);
      quad(C0, A0, B0, D0, [-tx, 0, -tz], 0, 0.7, y0b, y0t, k);
      quad(A1, C1, D1, B1, [tx, 0, tz], 0, 0.7, y1b, y1t, k);
      s += len;
      if (w.collide) {
        // split into ≤ 2 m axis-aligned boxes
        const nb = Math.max(1, Math.ceil(len / 2));
        for (let b = 0; b < nb; b++) {
          const ax = x0 + (x1 - x0) * b / nb, az = z0 + (z1 - z0) * b / nb, cx = x0 + (x1 - x0) * (b + 1) / nb, cz = z0 + (z1 - z0) * (b + 1) / nb;
          const g = Math.min(heightAt(ax, az), heightAt(cx, cz));
          colliders.push(new THREE.Box3(new THREE.Vector3(Math.min(ax, cx) - 0.3, g - 0.4, Math.min(az, cz) - 0.3), new THREE.Vector3(Math.max(ax, cx) + 0.3, g + w.h, Math.max(az, cz) + 0.3)));
        }
      }
    }
  }
  const meshes = [];
  let mat;
  if (stoneMat) { mat = stoneMat.clone(); mat.vertexColors = true; mat.color = new THREE.Color(0xcfc3ad); }
  else mat = new THREE.MeshStandardMaterial({ color: 0xb3a58d, roughness: 0.95, vertexColors: true });
  mat.name = 'terrain-walls';
  for (const { pos, nor, uv, col } of chunks.values()) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = 'dry-stone-walls'; m.castShadow = true; m.receiveShadow = true;
    scene.add(m); meshes.push(m);
  }
  return { meshes, colliders };
}
