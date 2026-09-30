// Near-player grass and wild flowers (terrain agent): world-anchored 8 m tiles recycled around
// the camera into two InstancedMeshes; wind sway and distance fade in the vertex shader.
import * as THREE from 'three';
import { HELIPAD, TANK_DEPOT, SITES } from './layout.js';
import { trenchFloorAt } from './trench-plan.js';
const INDOOR = SITES.filter((s) => s.type === 'compound');   // no grass through building floors
import { CLS } from './terrain-land.js';
import { rand2, RIVER_HALF_W } from './terrain-height.js';

const TILE = 8;

function tuftGeometry(blades = 4) {
  const pos = [], col = [], nor = [];
  for (let b = 0; b < blades; b++) {
    const a = b / blades * Math.PI + (b % 2) * 0.4, ca = Math.cos(a), sa = Math.sin(a);
    const ox = Math.cos(b * 2.4) * 0.2 * (0.4 + (b % 3) * 0.3), oz = Math.sin(b * 2.4) * 0.2 * (0.4 + (b % 3) * 0.3);
    const w = 0.03, lean = 0.05 + 0.05 * (b % 3);
    const lx = Math.cos(b * 1.7) * lean, lz = Math.sin(b * 1.7) * lean;
    const P = [
      [ox - ca * w, 0, oz - sa * w], [ox + ca * w, 0, oz + sa * w],
      [ox - ca * w * 0.6 + lx * 0.4, 0.55, oz - sa * w * 0.6 + lz * 0.4], [ox + ca * w * 0.6 + lx * 0.4, 0.55, oz + sa * w * 0.6 + lz * 0.4],
      [ox + lx, 1.0 - 0.1 * (b % 2), oz + lz],
    ];
    const C = [0.4, 0.4, 0.75, 0.75, 1.05];
    for (const [i, j, k] of [[0, 1, 4]]) {
      for (const q of [i, j, k]) { pos.push(...P[q]); col.push(C[q], C[q], C[q]); nor.push(ca * 0.25, 0.95, sa * 0.25); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function flowerGeometry() {
  const g = new THREE.BufferGeometry(), pos = [], col = [], nor = [];
  const head = new THREE.OctahedronGeometry(0.045, 0);
  const P = head.attributes.position.array, N = head.attributes.normal.array;
  for (const [x, y, z] of [[0, 0.42, 0], [0.09, 0.33, 0.05]]) {
    for (let i = 0; i < P.length; i += 3) { pos.push(P[i] + x, P[i + 1] * 0.6 + y, P[i + 2] + z); col.push(1, 1, 1); nor.push(N[i], N[i + 1] + 0.5, N[i + 2]); }
    // stem
    pos.push(x - 0.01, 0, z, x + 0.01, 0, z, x, y, z); col.push(0.25, 0.4, 0.2, 0.25, 0.4, 0.2, 0.3, 0.45, 0.2); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function grassMaterial(uniforms, name) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.name = name;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uR;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float fd = distance(ip.xz, cameraPosition.xz);
      float fade = 1.0 - smoothstep(uR * 0.7, uR, fd);
      transformed.y *= fade;
      float h2 = position.y * position.y;
      float w = sin(uTime * 1.9 + ip.x * 0.35 + ip.z * 0.25) + 0.5 * sin(uTime * 3.7 + ip.x * 0.9 - ip.z * 0.7);
      transformed.x += w * 0.09 * h2; transformed.z += w * 0.05 * h2;
      #endif`);
  };
  m.customProgramCacheKey = () => name;
  return m;
}

export function createGrass(scene, land, heightAt, quality = 'high') {
  const Qs = { low: { R: 12, sp: 0.95 }, medium: { R: 17, sp: 0.8 }, high: { R: 23, sp: 0.72 } };
  let cfg = Qs[quality] || Qs.medium;
  const uniforms = { uTime: { value: 0 }, uR: { value: cfg.R } };
  const per = Math.ceil(TILE / cfg.sp) ** 2;
  const maxTiles = Math.ceil(Math.PI * (cfg.R + TILE * 1.5) ** 2 / (TILE * TILE)) + 8;
  const grass = new THREE.InstancedMesh(tuftGeometry(9), grassMaterial(uniforms, 'terrain-grass'), per * maxTiles);
  const flowers = new THREE.InstancedMesh(flowerGeometry(), grassMaterial(uniforms, 'terrain-flowers'), Math.ceil(per * 0.12) * maxTiles);
  for (const im of [grass, flowers]) {
    im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    scene.add(im);
  }
  grass.name = 'grass'; flowers.name = 'flowers';
  for (let i = 0; i < grass.instanceMatrix.count; i++) grass.instanceMatrix.array[i * 16 + 15] = 1, grass.instanceMatrix.array.fill(0, i * 16, i * 16 + 15);
  for (let i = 0; i < flowers.instanceMatrix.count; i++) flowers.instanceMatrix.array.fill(0, i * 16, i * 16 + 15);
  grass.setColorAt(0, new THREE.Color(1, 1, 1)); flowers.setColorAt(0, new THREE.Color(1, 1, 1));
  const fPer = Math.ceil(per * 0.12);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), c = new THREE.Color();
  const tiles = new Map();           // key -> slot
  const free = [];
  for (let i = maxTiles - 1; i >= 0; i--) free.push(i);
  const FLOWER = [[0.85, 0.12, 0.08], [0.95, 0.93, 0.85], [0.95, 0.8, 0.2], [0.55, 0.45, 0.8], [0.95, 0.95, 0.95]];

  function fillTile(slot, tx, tz) {
    let gi = slot * per, fi = slot * fPer;
    const g0 = gi, f0 = fi;
    for (let a = 0; a < TILE; a += cfg.sp) for (let b = 0; b < TILE; b += cfg.sp) {
      const ix = Math.round((tx * TILE + a) * 10), iz = Math.round((tz * TILE + b) * 10);
      const r1 = rand2(ix, iz, 71), r2 = rand2(ix, iz, 72), r3 = rand2(ix, iz, 73);
      const x = tx * TILE + a + (r1 - 0.5) * cfg.sp, z = tz * TILE + b + (r2 - 0.5) * cfg.sp;
      const cl = land.classAt(x, z);
      let dens, h, cr, cg, cb;
      switch (cl) {
        case CLS.MEADOW: case CLS.EDGE: dens = 0.95; h = 0.35 + r3 * 0.3; cr = 0.36; cg = 0.46; cb = 0.18; break;
        case CLS.WHEAT: dens = 1; h = 0.75 + r3 * 0.25; cr = 0.72; cg = 0.57; cb = 0.27; break;
        case CLS.STUBBLE: dens = 0.9; h = 0.16 + r3 * 0.1; cr = 0.62; cg = 0.52; cb = 0.32; break;
        case CLS.PLOUGH: dens = 0.06; h = 0.2; cr = 0.4; cg = 0.42; cb = 0.2; break;
        case CLS.VINE: dens = 0.6; h = 0.25 + r3 * 0.15; cr = 0.4; cg = 0.46; cb = 0.2; break;
        case CLS.OLIVE: dens = 0.8; h = 0.3 + r3 * 0.25; cr = 0.42; cg = 0.44; cb = 0.22; break;
        case CLS.WOOD: dens = 0.35; h = 0.35 + r3 * 0.2; cr = 0.3; cg = 0.38; cb = 0.16; break;
        case CLS.SCRUB: dens = 0.6; h = 0.3 + r3 * 0.2; cr = 0.5; cg = 0.46; cb = 0.27; break;
        case CLS.PAD: dens = 0.6; h = 0.2 + r3 * 0.12; cr = 0.4; cg = 0.43; cb = 0.22; break;
        default: dens = 0;
      }
      if (dens <= 0 || rand2(ix, iz, 74) > dens) continue;
      if (land.roadSD(x, z) < 0.25 || land.riverD(x, z) < RIVER_HALF_W + 1.2 || land.lakeE(x, z) < 1) continue;
      if ((x - HELIPAD.x) ** 2 + (z - HELIPAD.z) ** 2 < (HELIPAD.r + 0.3) ** 2) continue;   // concrete helipad
      if ((x - TANK_DEPOT.x) ** 2 + (z - TANK_DEPOT.z) ** 2 < (TANK_DEPOT.r + 0.3) ** 2) continue;   // tank depot
      if (INDOOR.some((q) => Math.abs(x - q.x) < 18 && Math.abs(z - q.z) < 14)) continue;
      if (trenchFloorAt(x, z) !== null) continue;
      const mix = rand2(ix, iz, 75);
      if (cl === CLS.MEADOW || cl === CLS.OLIVE || cl === CLS.EDGE || cl === CLS.PAD) { if (mix < 0.3) { cr = 0.52; cg = 0.47; cb = 0.26; } }
      if (land.roadSD(x, z) < 1.8) h *= 0.6;
      const y = heightAt(x, z);
      const isFlower = (cl === CLS.MEADOW || cl === CLS.EDGE || cl === CLS.OLIVE || cl === CLS.PAD) && mix > 0.86;
      e.set((r1 - 0.5) * 0.3, r2 * 6.28, (r3 - 0.5) * 0.3);
      q.setFromEuler(e);
      pv.set(x, y - 0.03, z);
      const w = (0.8 + mix * 0.5) * Math.min(1, 0.45 + h * 0.9);
      if (isFlower && fi < f0 + fPer) {
        sv.set(1, 0.8 + r3 * 0.6, 1);
        m4.compose(pv, q, sv); flowers.setMatrixAt(fi, m4);
        const fc = FLOWER[Math.floor(rand2(ix, iz, 76) * FLOWER.length)];
        c.setRGB(fc[0], fc[1], fc[2]); flowers.setColorAt(fi, c); fi++;
      }
      sv.set(w, h, w);
      m4.compose(pv, q, sv); grass.setMatrixAt(gi, m4);
      const t = 0.85 + r1 * 0.3;
      c.setRGB(cr * t, cg * t, cb * t); grass.setColorAt(gi, c);
      gi++;
    }
    for (; gi < g0 + per; gi++) grass.setMatrixAt(gi, ZERO);
    for (; fi < f0 + fPer; fi++) flowers.setMatrixAt(fi, ZERO);
  }

  const lastT = { x: 1e9, z: 1e9 };
  const want = new Set();
  function update(dt, camera) {
    uniforms.uTime.value += dt;
    const p = camera.position;
    // No grass when the camera is high above the ground (tower tops, overview).
    const agl = p.y - heightAt(p.x, p.z);
    grass.visible = flowers.visible = agl < 60;
    const tx = Math.floor(p.x / TILE), tz = Math.floor(p.z / TILE);
    if (tx === lastT.x && tz === lastT.z) return;
    lastT.x = tx; lastT.z = tz;
    want.clear();
    const rt = Math.ceil(cfg.R / TILE) + 1, R2 = (cfg.R + TILE * 0.8) ** 2;
    for (let j = -rt; j <= rt; j++) for (let i = -rt; i <= rt; i++) {
      const cx = (tx + i + 0.5) * TILE - p.x, cz = (tz + j + 0.5) * TILE - p.z;
      if (cx * cx + cz * cz > R2) continue;
      want.add((tx + i) * 100000 + (tz + j));
    }
    let changed = false;
    for (const [k, slot] of tiles) if (!want.has(k)) {
      tiles.delete(k); free.push(slot); changed = true;
      for (let i = slot * per; i < (slot + 1) * per; i++) grass.setMatrixAt(i, ZERO);
      for (let i = slot * fPer; i < (slot + 1) * fPer; i++) flowers.setMatrixAt(i, ZERO);
    }
    for (const k of want) {
      if (tiles.has(k) || !free.length) continue;
      const slot = free.pop();
      tiles.set(k, slot);
      const ttx = Math.round(k / 100000), ttz = k - ttx * 100000;
      fillTile(slot, ttx, ttz);
      changed = true;
    }
    if (changed) {
      let mx = -1; for (const sl of tiles.values()) if (sl > mx) mx = sl;
      grass.count = per * (mx + 1); flowers.count = fPer * (mx + 1);
      grass.instanceMatrix.needsUpdate = true; flowers.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    }
  }
  return { update, meshes: [grass, flowers] };
}
