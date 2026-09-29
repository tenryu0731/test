// Countryside vegetation and props (terrain agent): procedural cypress, olive, oak, stone pine,
// poplar, bushes, vine rows, round hay bales and rocks. Near the camera every type is an
// InstancedMesh per 192 m cell (frustum culled by three.js); farther away all trees of a cell are
// one merged low-poly mesh. The handover is per instance in the vertex shader (no cell popping).
import * as THREE from 'three';
import { FINE } from './terrain-height.js';
import { makeFoliageTextures, makeBarkTextures } from './terrain-tex.js';

// ------------------------------------------------------------------ geometry builder
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.ctr = []; }
  // add a three geometry transformed by matrix m; colour fn(x,y,z,nx,ny,nz) -> [r,g,b]; normal mode
  add(geo, m, colFn, { center = null, sphereN = 0, uvMode = 'geo', ctr = null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv?.array;
    for (let i = 0; i < P.length / 3; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      if (center && sphereN > 0) {
        let dx = x - center.x, dy = y - center.y, dz = z - center.z; const l = Math.hypot(dx, dy, dz) || 1;
        nx = nx * (1 - sphereN) + dx / l * sphereN; ny = ny * (1 - sphereN) + dy / l * sphereN; nz = nz * (1 - sphereN) + dz / l * sphereN;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      }
      this.p.push(x, y, z); this.n.push(nx, ny, nz);
      const c = colFn(x, y, z, nx, ny, nz); this.c.push(c[0], c[1], c[2]);
      if (uvMode === 'sphere' && center) {
        const dx = x - center.x, dy = y - center.y, dz = z - center.z;
        this.u.push(Math.atan2(dz, dx) / Math.PI * 1.5 + 1.5, dy * 0.7);
      } else if (U) this.u.push(U[i * 2] * 2, U[i * 2 + 1] * 2);
      else this.u.push(x * 0.5, y * 0.5);
      if (ctr) this.ctr.push(ctr[0], ctr[1], ctr[2]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.ctr.length) g.setAttribute('center', new THREE.Float32BufferAttribute(this.ctr, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), E4 = new THREE.Euler(), V4 = new THREE.Vector3(), S4 = new THREE.Vector3();
const mat = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
function jitter(geo, amt, seed) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position.array;
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`, map = new Map();
  let s = seed;
  for (let i = 0; i < P.length; i += 3) {
    const k = key(P[i], P[i + 1], P[i + 2]);
    let d = map.get(k);
    if (!d) { s = (s * 16807) % 2147483647; const a = s / 2147483647; s = (s * 16807) % 2147483647; const b = s / 2147483647; s = (s * 16807) % 2147483647; d = [(a - 0.5) * amt, (b - 0.5) * amt, ((s / 2147483647) - 0.5) * amt]; map.set(k, d); }
    P[i] += d[0]; P[i + 1] += d[1]; P[i + 2] += d[2];
  }
  g.computeVertexNormals();
  return g;
}
const shade = (base, lo, y0, y1, noiseAmt = 0.08) => (x, y, z) => {
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const k = lo + (1 - lo) * t, n = 1 + (Math.sin(x * 7.1 + z * 5.3) * Math.cos(y * 6.7 + x * 3.1)) * noiseAmt;
  return [base[0] * k * n, base[1] * k * n, base[2] * k * n];
};
const BARK = [0.3, 0.26, 0.21];

function blob(b, cx, cy, cz, r, sy, colBase, seed, detail = 0, ctr = null) {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.35, seed);
  b.add(g, mat(cx, cy, cz, seed * 0.3, seed * 0.7, 0, r, r * sy, r), shade(colBase, 0.55, cy - r * sy, cy + r * sy),
    { center: new THREE.Vector3(cx, cy - r * 0.2, cz), sphereN: 0.7, uvMode: 'sphere', ctr });
}
function lathe(b, prof, seg, col, lo, jit, seed, ctr = null, h = 1) {
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  let g = new THREE.LatheGeometry(pts, seg);
  if (jit) g = jitter(g, jit, seed);
  b.add(g, mat(0, 0, 0, 0, seed, 0), shade(col, lo, 0, h), { center: new THREE.Vector3(0, h * 0.45, 0), sphereN: 0.5, uvMode: 'sphere', ctr });
}
const trunk = (b, h, r0, r1, bend, seg = 6, ctr = null) => {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3, true);
  const P = g.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) { const t = (P[i + 1] + h / 2) / h; P[i] += Math.sin(t * 2.5) * bend; P[i + 2] += Math.sin(t * 1.7 + 1) * bend * 0.6; }
  g.computeVertexNormals();
  b.add(g, mat(0, h / 2, 0), shade(BARK, 0.7, 0, h, 0.15), { ctr });
};

// near (detailed) geometries, in metres
function geoCypress(poplar = false) {
  const b = new Builder();
  const H = poplar ? 17 : 14, R = poplar ? 2.3 : 1.35;
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = poplar ? R * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)), 0.8) * (1 - t * 0.35)
      : R * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.06)), 0.75) * (1 - t * 0.55);
    prof.push([Math.max(0.02, r), t * H]);
  }
  prof[0][0] = 0.25; prof.unshift([0.0, 0.0]);
  lathe(b, prof, 8, poplar ? [0.26, 0.34, 0.14] : [0.1, 0.16, 0.08], 0.45, poplar ? 0.7 : 0.45, poplar ? 3 : 7, null, H);
  return b.build();
}
function geoOlive() {
  const b = new Builder();
  trunk(b, 1.7, 0.32, 0.2, 0.18, 5);
  const limb = new THREE.CylinderGeometry(0.1, 0.16, 1.4, 4, 1, true);
  b.add(limb, mat(0.35, 2.1, 0.1, 0.2, 0, -0.5), shade(BARK, 0.8, 1.5, 2.8));
  b.add(limb, mat(-0.3, 2.1, -0.2, -0.3, 0, 0.45), shade(BARK, 0.8, 1.5, 2.8));
  const C = [0.33, 0.39, 0.25];
  const bl = [[0.9, 2.85, 0.3, 1.35], [-0.8, 2.95, -0.4, 1.3], [0.1, 3.5, 0.1, 1.25], [-0.1, 2.6, 0.2, 1.3]];
  bl.forEach(([x, y, z, r], i) => blob(b, x, y, z, r, 0.72, C, i + 3));
  return b.build();
}
function geoOak() {
  const b = new Builder();
  trunk(b, 3.6, 0.45, 0.3, 0.2, 7);
  const C = [0.17, 0.23, 0.1];
  const bl = [[0, 5.6, 0, 2.5], [1.8, 4.9, 0.6, 1.9], [-1.7, 5.0, -0.5, 2.0], [0.5, 4.7, -1.8, 1.8], [-0.6, 4.6, 1.8, 1.8], [0.8, 6.6, 0.7, 1.7], [-0.9, 6.4, -0.6, 1.6]];
  bl.forEach(([x, y, z, r], i) => blob(b, x, y, z, r, 0.8, C, i + 11));
  return b.build();
}
function geoPine() {
  const b = new Builder();
  trunk(b, 8.2, 0.34, 0.2, 0.45, 6);
  const C = [0.15, 0.21, 0.1];
  const bl = [[0.4, 8.6, 0.2, 2.8], [-1.9, 8.2, -0.6, 2.2], [1.9, 8.0, -1.2, 2.0], [-0.4, 8.1, 2.1, 2.1], [1.2, 9.1, 1.2, 1.8]];
  bl.forEach(([x, y, z, r], i) => blob(b, x, y, z, r, 0.38, C, i + 21));
  return b.build();
}
function geoBush() {
  const b = new Builder();
  const C = [0.2, 0.26, 0.12];
  [[0, 0.55, 0, 0.8], [0.6, 0.45, 0.2, 0.6], [-0.5, 0.45, -0.3, 0.62]].forEach(([x, y, z, r], i) => blob(b, x, y, z, r, 0.8, C, i + 31));
  return b.build();
}
function geoVine() {
  // 6 m row segment along -z..+z with a post; leafy hedge between 0.55 and 1.6 m
  const b = new Builder();
  let hedge = new THREE.BoxGeometry(0.6, 1.0, 6.0, 1, 2, 6);
  const P = hedge.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) {
    const t = P[i + 1] + 0.5; // 0 bottom .. 1 top
    P[i] *= 0.6 + 0.5 * t + 0.15 * Math.sin(P[i + 2] * 2.3 + P[i + 1] * 3);
    P[i + 1] += 0.08 * Math.sin(P[i + 2] * 3.1);
  }
  hedge = jitter(hedge, 0.12, 41);
  b.add(hedge, mat(0, 1.08, 0), (x, y, z) => {
    const autumn = 0.5 + 0.5 * Math.sin(z * 1.3 + 2);
    const k = 0.55 + 0.45 * (y - 0.58);
    return [(0.2 + 0.12 * autumn) * k, (0.27 + 0.04 * autumn) * k, 0.08 * k];
  }, { center: new THREE.Vector3(0, 0.6, 0), sphereN: 0.35, uvMode: 'sphere' });
  const post = new THREE.BoxGeometry(0.08, 1.75, 0.08);
  b.add(post, mat(0, 0.87, 3.0), () => [0.35, 0.3, 0.24]);
  const stem = new THREE.CylinderGeometry(0.04, 0.06, 0.6, 4, 1, true);
  for (const z of [-2, 0, 2]) b.add(stem, mat(0, 0.3, z), () => BARK);
  return b.build();
}
function geoBale() {
  const b = new Builder();
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14, 1);
  b.add(g, mat(0, 0.72, 0, 0, 0, Math.PI / 2), (x, y, z, nx) => (Math.abs(nx) > 0.7 ? [0.55, 0.43, 0.24] : [0.7, 0.58, 0.33]));
  return b.build();
}
function geoRock() {
  const b = new Builder();
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.5, 51);
  b.add(g, mat(0, 0.25, 0), (x, y, z) => { const k = 0.85 + 0.15 * y; return [0.56 * k, 0.53 * k, 0.47 * k]; });
  return b.build();
}

// far (merged, low poly) shapes: returns function adding one instance to a Builder
function farShapes() {
  const cone = (h, r, seg) => { const g = new THREE.ConeGeometry(r, h, seg, 2, true); g.translate(0, h / 2, 0); return g; };
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const oct = new THREE.OctahedronGeometry(1, 0);
  return {
    cypress: { g: cone(14, 1.3, 5), c: [0.1, 0.16, 0.08], y: 0 },
    poplar: { g: cone(17, 2.0, 5), c: [0.26, 0.34, 0.14], y: 0 },
    olive: { g: oct, c: [0.33, 0.39, 0.25], y: 2.9, s: [2.1, 1.5, 2.1] },
    oak: { g: ico, c: [0.17, 0.23, 0.1], y: 5.4, s: [3.3, 2.6, 3.3] },
    pine: { g: ico, c: [0.15, 0.21, 0.1], y: 8.5, s: [3.6, 1.3, 3.6] },
    bush: { g: oct, c: [0.2, 0.26, 0.12], y: 0.5, s: [1.0, 0.7, 1.0] },
    oakFar: { g: oct, c: [0.17, 0.23, 0.1], y: 5.2, s: [3.4, 2.8, 3.4] },
    pineFar: { g: oct, c: [0.15, 0.21, 0.1], y: 8.3, s: [3.6, 1.4, 3.6] },
    bale: { g: oct, c: [0.7, 0.58, 0.33], y: 0.7, s: [0.8, 0.75, 0.8] },
  };
}

// ------------------------------------------------------------------ materials
function vegMaterial(uniforms, kind, fol) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, map: fol?.lum || null, normalMap: fol?.normal || null });
  if (fol) m.normalScale.set(0.9, 0.9);
  m.name = 'terrain-veg-' + kind;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    const head = 'uniform float uTime, uNearR, uFarR, uWind;\n' + (kind === 'far' ? 'attribute vec3 center;\n' : '');
    let body;
    if (kind === 'far') body = `
      if (distance(center, cameraPosition) < uNearR) transformed = center;`;
    else body = `
      #ifdef USE_INSTANCING
      vec3 ic = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float cdist = distance(ic, cameraPosition);
      if (cdist > uFarR) transformed = vec3(0.0);
      float sway = sin(uTime * 1.3 + ic.x * 0.21 + ic.z * 0.17) * uWind * max(0.0, transformed.y) * 0.012;
      transformed.x += sway; transformed.z += sway * 0.6;
      #endif`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + head)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + body);
  };
  m.customProgramCacheKey = () => 'terrain-veg-' + kind;
  return m;
}

// ------------------------------------------------------------------ main
export function createVegetation(scene, land, { quality = 'high', heightAt }) {
  const t0 = performance.now();
  const nearR = { low: 130, medium: 180, high: 230 }[quality] || 180;
  const vineR = { low: 70, medium: 100, high: 120 }[quality] || 100;
  const fol = makeFoliageTextures(128);
  const bark = makeBarkTextures(64); void bark;
  const uTree = { uTime: { value: 0 }, uNearR: { value: nearR }, uFarR: { value: nearR }, uWind: { value: 1 } };
  const uSmall = { uTime: uTree.uTime, uNearR: { value: nearR * 0.8 }, uFarR: { value: nearR * 0.8 }, uWind: { value: 0.3 } };
  const uVine = { uTime: uTree.uTime, uNearR: { value: vineR }, uFarR: { value: vineR }, uWind: { value: 0.2 } };
  const matTree = vegMaterial(uTree, 'near', fol);
  const matSmall = vegMaterial(uSmall, 'nearS', fol);
  const matVine = vegMaterial(uVine, 'nearV', fol);
  const matProp = vegMaterial(uSmall, 'nearP', null);
  const matFar = vegMaterial(uTree, 'far', null);

  const GEO = {
    cypress: geoCypress(false), poplar: geoCypress(true), olive: geoOlive(), oak: geoOak(), pine: geoPine(),
    bush: geoBush(), vine: geoVine(), bale: geoBale(), rock: geoRock(),
  };
  const MAT = { cypress: matTree, poplar: matTree, olive: matTree, oak: matTree, pine: matTree, bush: matSmall, vine: matVine, bale: matProp, rock: matProp };
  const REACH = { cypress: nearR, poplar: nearR, olive: nearR, oak: nearR, pine: nearR, bush: nearR * 0.8, vine: vineR, bale: nearR * 0.8, rock: nearR * 0.8 };
  const CASTS = { cypress: true, poplar: true, olive: true, oak: true, pine: true, bush: false, vine: false, bale: true, rock: false };

  // ---- near instances: per type, precomputed matrices on a 64 m grid; the InstancedMeshes are
  // refilled with everything within reach whenever the camera has moved 15 m (shader collapses
  // instances beyond reach for an exact per-instance handover to the far meshes). Trees within
  // 50 m go to a separate shadow-casting InstancedMesh.
  const GS = 64, GN = Math.ceil(FINE.half * 2 / GS), GO = -FINE.half;
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const types = [];
  let instCount = 0;
  const TREE = { cypress: 1, poplar: 1, olive: 1, oak: 1, pine: 1 };
  for (const type of Object.keys(GEO)) {
    const arr = land.inst[type];
    if (!arr || !arr.length) continue;
    const N = arr.length / 8;
    const Mx = new Float32Array(N * 16), Cl = new Float32Array(N * 3), Px = new Float32Array(N), Pz = new Float32Array(N);
    const grid = Array.from({ length: GN * GN }, () => []);
    for (let q = 0; q < N; q++) {
      const k = q * 8;
      const x = arr[k], y = arr[k + 1], z = arr[k + 2], rot = arr[k + 3], s = arr[k + 4], sy = arr[k + 5], v = arr[k + 6], ex = arr[k + 7];
      if (type === 'vine') { dummy.rotation.set(ex, rot, 0, 'YXZ'); dummy.scale.set(1, sy, 1); dummy.position.set(x, y - 0.05, z); }
      else if (type === 'rock') { dummy.rotation.set(v * 0.6, rot, 0, 'XYZ'); dummy.scale.set(s, s * sy, s * (0.8 + v * 0.4)); dummy.position.set(x, y - 0.25 * s * sy, z); }
      else if (type === 'bale') { dummy.rotation.set(0, rot, 0, 'XYZ'); dummy.scale.set(s, s, s); dummy.position.set(x, y - 0.05, z); }
      else { dummy.rotation.set((v - 0.5) * 0.06, rot, (v - 0.5) * 0.05, 'XYZ'); dummy.scale.set(s, s * sy, s); dummy.position.set(x, y - 0.15, z); }
      dummy.updateMatrix();
      dummy.matrix.toArray(Mx, q * 16);
      const tv = 0.82 + v * 0.36;
      if (type === 'olive') col.setRGB(tv * 1.02, tv, tv * (0.92 + v * 0.15));
      else if (type === 'vine' || type === 'bale' || type === 'rock') col.setRGB(tv, tv, tv * 0.97);
      else col.setRGB(tv * (0.95 + v * 0.1), tv, tv * (1.05 - v * 0.15));
      Cl[q * 3] = col.r; Cl[q * 3 + 1] = col.g; Cl[q * 3 + 2] = col.b;
      Px[q] = x; Pz[q] = z;
      const gi = Math.min(GN - 1, Math.max(0, Math.floor((x - GO) / GS))), gj = Math.min(GN - 1, Math.max(0, Math.floor((z - GO) / GS)));
      grid[gj * GN + gi].push(q);
    }
    const mk = (cap, name, cast) => {
      const im = new THREE.InstancedMesh(GEO[type], MAT[type], cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, col);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
      im.name = name;
      scene.add(im);
      return im;
    };
    const cap = Math.min(N, type === "vine" ? 6000 : 4000);
    const t = { type, N, Mx, Cl, Px, Pz, grid, far: mk(cap, 'veg-' + type, false), close: TREE[type] ? mk(Math.min(N, 600), 'veg-' + type + '-near', true) : null };
    types.push(t);
    instCount += N;
  }
  const reachOf = (type, r, vr) => (type === 'vine' ? vr : ['bush', 'bale', 'rock'].includes(type) ? r * 0.8 : r);
  let reachR = nearR, reachV = vineR;
  let nearTris = 0;
  function refill(p) {
    nearTris = 0;
    for (const t of types) {
      const R = reachOf(t.type, reachR, reachV) + 20, R2 = R * R, C2 = 50 * 50;
      const i0 = Math.max(0, Math.floor((p.x - R - GO) / GS)), i1 = Math.min(GN - 1, Math.floor((p.x + R - GO) / GS));
      const j0 = Math.max(0, Math.floor((p.z - R - GO) / GS)), j1 = Math.min(GN - 1, Math.floor((p.z + R - GO) / GS));
      const fm = t.far.instanceMatrix.array, fc = t.far.instanceColor.array, capF = t.far.instanceMatrix.count;
      const cm = t.close?.instanceMatrix.array, cc = t.close?.instanceColor.array, capC = t.close ? t.close.instanceMatrix.count : 0;
      let nf = 0, nc = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        for (const q of t.grid[j * GN + i]) {
          const dx = t.Px[q] - p.x, dz = t.Pz[q] - p.z, d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          if (t.close && d2 < C2 && nc < capC) {
            cm.set(t.Mx.subarray(q * 16, q * 16 + 16), nc * 16); cc.set(t.Cl.subarray(q * 3, q * 3 + 3), nc * 3); nc++;
          } else if (nf < capF) {
            fm.set(t.Mx.subarray(q * 16, q * 16 + 16), nf * 16); fc.set(t.Cl.subarray(q * 3, q * 3 + 3), nf * 3); nf++;
          }
        }
      }
      const up = (im, n) => {
        im.count = n;
        im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, Math.max(16, n * 16)); im.instanceMatrix.needsUpdate = true;
        im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, Math.max(3, n * 3)); im.instanceColor.needsUpdate = true;
        im.boundingSphere = null;
        nearTris += n * GEO[t.type].attributes.position.count / 3;
      };
      up(t.far, nf);
      if (t.close) up(t.close, nc);
    }
  }


  // ---- far merged meshes (fine area: 384 m cells; beyond: 768 m cells). Written straight into
  // typed arrays: yaw + scale + translate of a few tiny shapes per tree.
  const F = farShapes();
  const SH = {};
  for (const [k, sh] of Object.entries(F)) {
    const g = sh.g.index ? sh.g.toNonIndexed() : sh.g;
    SH[k] = { p: g.attributes.position.array, n: g.attributes.normal.array, c: sh.c, y: sh.y, s: sh.s || [1, 1, 1] };
  }
  const farList = [];   // [type, x, y, z, rot, s, sy, v]
  for (const type of ['cypress', 'poplar', 'olive', 'oak', 'pine', 'bale']) {
    const arr = land.inst[type];
    for (let k = 0; k < arr.length; k += 8) farList.push([type, arr[k], arr[k + 1], arr[k + 2], arr[k + 3], arr[k + 4], arr[k + 5], arr[k + 6]]);
  }
  const ft = land.farTrees;
  for (let k = 0; k < ft.length; k += 8) farList.push([ft[k + 7] ? 'pineFar' : 'oakFar', ft[k], ft[k + 1], ft[k + 2], ft[k + 3], ft[k + 4], 1, ft[k + 6]]);
  const groups = new Map();
  for (const it of farList) {
    const x = it[1], z = it[3], inside = Math.abs(x) < FINE.half && Math.abs(z) < FINE.half, cs = inside ? 384 : 768;
    const key = (inside ? 'i' : 'o') + Math.floor(x / cs) + ',' + Math.floor(z / cs);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const farMeshes = [];
  let farTris = 0;
  for (const list of groups.values()) {
    let nv = 0;
    for (const it of list) nv += SH[it[0]].p.length / 3;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), CT = new Float32Array(nv * 3);
    let o = 0;
    for (const [type, x, y, z, rot, s, sy, v] of list) {
      const sh = SH[type], cr = Math.cos(rot), sr = Math.sin(rot);
      const sx = sh.s[0] * s, syy = sh.s[1] * s * sy, sz = sh.s[2] * s, oy = y + sh.y * s * sy - 0.2;
      const tv = 0.8 + v * 0.35, c0 = sh.c[0] * tv, c1 = sh.c[1] * tv, c2 = sh.c[2] * tv;
      const sp = sh.p, sn = sh.n;
      for (let i = 0; i < sp.length; i += 3) {
        const lx = sp[i] * sx, ly = sp[i + 1] * syy, lz = sp[i + 2] * sz;
        P[o] = x + lx * cr + lz * sr; P[o + 1] = oy + ly; P[o + 2] = z - lx * sr + lz * cr;
        const nx = sn[i] / sx, ny = sn[i + 1] / syy, nz = sn[i + 2] / sz, nl = Math.hypot(nx, ny, nz) || 1;
        N[o] = (nx * cr + nz * sr) / nl; N[o + 1] = ny / nl; N[o + 2] = (-nx * sr + nz * cr) / nl;
        const sh2 = 0.75 + 0.25 * Math.min(1, Math.max(0, sp[i + 1] + 0.5));
        C[o] = c0 * sh2; C[o + 1] = c1 * sh2; C[o + 2] = c2 * sh2;
        CT[o] = x; CT[o + 1] = y; CT[o + 2] = z;
        o += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('center', new THREE.BufferAttribute(CT, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, matFar);
    m.name = 'veg-far'; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
    scene.add(m); farMeshes.push(m);
    farTris += nv / 3;
  }

  // ---- update
  const last = new THREE.Vector3(1e9, 0, 0);
  function update(dt, camera) {
    uTree.uTime.value += dt;
    const p = camera.position;
    if (p.distanceToSquared(last) < 225) return;
    last.copy(p);
    refill(p);
  }
  function setQuality(q) {
    reachR = { low: 130, medium: 180, high: 230 }[q] || 180; reachV = { low: 70, medium: 100, high: 120 }[q] || 100;
    uTree.uNearR.value = uTree.uFarR.value = reachR;
    uSmall.uNearR.value = uSmall.uFarR.value = reachR * 0.8;
    uVine.uNearR.value = uVine.uFarR.value = reachV;
    last.set(1e9, 0, 0);
  }
  const stats = { get nearTris() { return nearTris; }, farTris, instCount, farMeshes: farMeshes.length, ms: performance.now() - t0 };
  void heightAt;
  return { update, setQuality, stats, vineR: uVine.uNearR, meshes: [...farMeshes, ...types.flatMap((t) => (t.close ? [t.far, t.close] : [t.far]))] };
}
