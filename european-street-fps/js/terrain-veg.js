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
    const g = geo.index ? geo.toNonIndexed() : geo;
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
  trunk(b, 1.7, 0.32, 0.2, 0.18, 6);
  const limb = new THREE.CylinderGeometry(0.1, 0.16, 1.4, 5, 1, true);
  b.add(limb, mat(0.35, 2.1, 0.1, 0.2, 0, -0.5), shade(BARK, 0.8, 1.5, 2.8));
  b.add(limb, mat(-0.3, 2.1, -0.2, -0.3, 0, 0.45), shade(BARK, 0.8, 1.5, 2.8));
  const C = [0.33, 0.39, 0.25];
  const bl = [[0.9, 2.9, 0.3, 1.25], [-0.8, 3.0, -0.4, 1.2], [0.1, 3.6, 0.1, 1.2], [0.2, 2.7, -1.0, 1.0], [-0.3, 2.6, 0.9, 1.05], [0.0, 2.3, 0.0, 1.0]];
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
    olive: { g: ico, c: [0.33, 0.39, 0.25], y: 2.9, s: [1.9, 1.3, 1.9] },
    oak: { g: ico, c: [0.17, 0.23, 0.1], y: 5.4, s: [3.3, 2.6, 3.3] },
    pine: { g: ico, c: [0.15, 0.21, 0.1], y: 8.5, s: [3.6, 1.3, 3.6] },
    bush: { g: oct, c: [0.2, 0.26, 0.12], y: 0.5, s: [1.0, 0.7, 1.0] },
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

  // ---- near instanced cells
  const CS = 192, CN = Math.ceil(FINE.half * 2 / CS), CO = -FINE.half;
  const cells = [];
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) cells.push({ x0: CO + i * CS, z0: CO + j * CS, meshes: [] });
  const cellOf = (x, z) => {
    const i = Math.min(CN - 1, Math.max(0, Math.floor((x - CO) / CS))), j = Math.min(CN - 1, Math.max(0, Math.floor((z - CO) / CS)));
    return j * CN + i;
  };
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  let nearTris = 0, instCount = 0;
  for (const type of Object.keys(GEO)) {
    const arr = land.inst[type];
    if (!arr || !arr.length) continue;
    const buckets = new Map();
    for (let k = 0; k < arr.length; k += 8) {
      const c = cellOf(arr[k], arr[k + 2]);
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c).push(k);
    }
    for (const [c, list] of buckets) {
      const im = new THREE.InstancedMesh(GEO[type], MAT[type], list.length);
      list.forEach((k, idx) => {
        const x = arr[k], y = arr[k + 1], z = arr[k + 2], rot = arr[k + 3], s = arr[k + 4], sy = arr[k + 5], v = arr[k + 6], ex = arr[k + 7];
        if (type === 'vine') { dummy.rotation.set(ex, rot, 0, 'YXZ'); dummy.scale.set(1, sy, 1); dummy.position.set(x, y - 0.05, z); }
        else if (type === 'rock') { dummy.rotation.set(v * 0.6, rot, 0); dummy.scale.set(s, s * sy, s * (0.8 + v * 0.4)); dummy.position.set(x, y - 0.25 * s * sy, z); }
        else if (type === 'bale') { dummy.rotation.set(0, rot, 0); dummy.scale.set(s, s, s); dummy.position.set(x, y - 0.05, z); }
        else { dummy.rotation.set((v - 0.5) * 0.06, rot, (v - 0.5) * 0.05); dummy.scale.set(s, s * sy, s); dummy.position.set(x, y - 0.15, z); }
        dummy.updateMatrix();
        im.setMatrixAt(idx, dummy.matrix);
        const tv = 0.82 + v * 0.36;
        if (type === 'olive') col.setRGB(tv * 1.02, tv, tv * (0.92 + v * 0.15));
        else if (type === 'vine' || type === 'bale' || type === 'rock') col.setRGB(tv, tv, tv * 0.97);
        else col.setRGB(tv * (0.95 + v * 0.1), tv, tv * (1.05 - v * 0.15));
        im.setColorAt(idx, col);
      });
      im.computeBoundingSphere();
      im.castShadow = false; im.receiveShadow = true;
      im.frustumCulled = true;
      im.visible = false;
      im.name = 'veg-' + type;
      im.userData.reach = REACH[type]; im.userData.casts = CASTS[type];
      scene.add(im);
      cells[c].meshes.push(im);
      nearTris += GEO[type].attributes.position.count / 3 * list.length;
      instCount += list.length;
    }
  }

  // ---- far merged meshes (fine area: 384 m cells; beyond: 768 m cells)
  const F = farShapes();
  const farMeshes = [];
  const farCells = new Map();
  const farCellKey = (x, z) => {
    const inside = Math.abs(x) < FINE.half && Math.abs(z) < FINE.half;
    const s = inside ? 384 : 768;
    return (inside ? 'i' : 'o') + Math.floor(x / s) + ',' + Math.floor(z / s);
  };
  const pushFar = (type, x, y, z, rot, s, sy, v) => {
    const sh = F[type]; if (!sh) return;
    const key = farCellKey(x, z);
    let b = farCells.get(key);
    if (!b) farCells.set(key, b = new Builder());
    const sc = sh.s || [1, 1, 1];
    const m = mat(x, y + sh.y * s * sy, z, 0, rot, 0, sc[0] * s, sc[1] * s * sy, sc[2] * s);
    const tv = 0.8 + v * 0.35, c = sh.c;
    b.add(sh.g, m, () => [c[0] * tv, c[1] * tv, c[2] * tv], { ctr: [x, y, z] });
  };
  for (const type of ['cypress', 'poplar', 'olive', 'oak', 'pine', 'bush', 'bale']) {
    const arr = land.inst[type];
    for (let k = 0; k < arr.length; k += 8) pushFar(type, arr[k], arr[k + 1], arr[k + 2], arr[k + 3], arr[k + 4], arr[k + 5], arr[k + 6]);
  }
  const ft = land.farTrees;
  for (let k = 0; k < ft.length; k += 8) pushFar(ft[k + 7] ? 'pine' : 'oak', ft[k], ft[k + 1], ft[k + 2], ft[k + 3], ft[k + 4], 1, ft[k + 6]);
  let farTris = 0;
  for (const b of farCells.values()) {
    const g = b.build();
    const m = new THREE.Mesh(g, matFar);
    m.name = 'veg-far'; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
    scene.add(m); farMeshes.push(m);
    farTris += g.attributes.position.count / 3;
  }

  // ---- update: cell visibility + shadow casters near the camera
  const last = new THREE.Vector3(1e9, 0, 0);
  function update(dt, camera) {
    uTree.uTime.value += dt;
    const p = camera.position;
    if (p.distanceToSquared(last) < 9) return;
    last.copy(p);
    for (const c of cells) {
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x0 - CS), dz = Math.max(c.z0 - p.z, 0, p.z - c.z0 - CS);
      const d = Math.hypot(dx, dz);
      for (const m of c.meshes) {
        m.visible = d < m.userData.reach;
        m.castShadow = m.userData.casts && d < 40;
      }
    }
  }
  function setQuality(q) {
    const r = { low: 130, medium: 180, high: 230 }[q] || 180, vr = { low: 70, medium: 100, high: 120 }[q] || 100;
    uTree.uNearR.value = uTree.uFarR.value = r;
    uSmall.uNearR.value = uSmall.uFarR.value = r * 0.8;
    uVine.uNearR.value = uVine.uFarR.value = vr;
    for (const c of cells) for (const m of c.meshes) {
      const t = m.name.slice(4);
      m.userData.reach = t === 'vine' ? vr : ['bush', 'bale', 'rock'].includes(t) ? r * 0.8 : r;
    }
    last.set(1e9, 0, 0);
  }
  const stats = { nearTris, farTris, instCount, farMeshes: farMeshes.length, ms: performance.now() - t0 };
  void heightAt;
  return { update, setQuality, stats, vineR: uVine.uNearR, meshes: [...farMeshes, ...cells.flatMap((c) => c.meshes)] };
}
