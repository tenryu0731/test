// Terrain surface (terrain agent): quadtree chunked LOD (32×32-quad nodes from 2 m to 128 m
// spacing, skirts hide cracks) and a slope/height/land-use aware splat material built on
// MeshStandardMaterial (shadows, fog, IBL keep working). Per-pixel normals come from the 2 m
// normal texture, so coarse far nodes still light like the full-resolution ground.
import * as THREE from 'three';
import { TOWN } from './layout.js';
import { FINE } from './terrain-height.js';
import { FIELD } from './terrain-land.js';

const Q = 32;                     // quads per node side
const ROOT = 4096;                // root node size (±2048 m)
const LEVELS = 6;                 // root level; level 0 = 64 m nodes at 2 m spacing

export function createTerrainSurface(scene, { heightAt, fieldTex, ground, noiseTex, quality = 'high' }) {
  const [rx0, rx1, rz0, rz1] = TOWN.rect;
  const IN = 1.8; // below the paved town the rendered ground is sunk (no z-fight with the paving)
  const hRender = (x, z) => (x > rx0 + IN && x < rx1 - IN && z > rz0 + IN && z < rz1 - IN ? -3 : heightAt(x, z));

  const material = makeMaterial({ fieldTex, ground, noiseTex, quality });
  const group = new THREE.Group();
  group.name = 'terrain';
  scene.add(group);

  // shared index: grid + skirts
  const V = Q + 1, NV = V * V + 4 * V;
  const idx = [];
  for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const edges = [
    (k) => k,                      // z = min row (north)
    (k) => Q * V + k,              // z = max row
    (k) => k * V,                  // x = min column
    (k) => k * V + Q,              // x = max column
  ];
  for (let e = 0; e < 4; e++) for (let k = 0; k < Q; k++) {
    const a = edges[e](k), b = edges[e](k + 1), sa = V * V + e * V + k, sb = sa + 1;
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb); // both windings: skirts visible from either side
  }
  const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);

  const nodes = new Map();   // key -> { mesh, minY, maxY }
  function nodeInfo(l, ix, iz) {
    const key = l * 1e6 + ix * 1000 + iz;
    let nd = nodes.get(key);
    if (nd) return nd;
    const size = 64 * (1 << l), x0 = -ROOT / 2 + ix * size, z0 = -ROOT / 2 + iz * size;
    let mn = 1e9, mx = -1e9;
    for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
      const h = heightAt(x0 + size * i / 8, z0 + size * j / 8);
      if (h < mn) mn = h; if (h > mx) mx = h;
    }
    nd = { key, l, ix, iz, size, x0, z0, minY: mn - 2, maxY: mx + 2, mesh: null, fine: Math.max(Math.abs(x0), Math.abs(z0), Math.abs(x0 + size), Math.abs(z0 + size)) <= FINE.half };
    nodes.set(key, nd);
    return nd;
  }
  function buildMesh(nd) {
    const { size, x0, z0 } = nd, sp = size / Q;
    const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = x0 + i * sp, z = z0 + j * sp, k = (j * V + i) * 3;
      const y = hRender(x, z);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const e = Math.max(2, sp * 0.5);
      let nx = heightAt(x - e, z) - heightAt(x + e, z), nz = heightAt(x, z - e) - heightAt(x, z + e), ny = 2 * e;
      const l = Math.hypot(nx, ny, nz); nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
    }
    const drop = Math.max(1.5, sp * 0.9);
    for (let e = 0; e < 4; e++) for (let k = 0; k < V; k++) {
      const src = edges[e](k) * 3, dst = (V * V + e * V + k) * 3;
      pos[dst] = pos[src]; pos[dst + 1] = pos[src + 1] - drop; pos[dst + 2] = pos[src + 2];
      nor[dst] = nor[src]; nor[dst + 1] = nor[src + 1]; nor[dst + 2] = nor[src + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, nd.minY, z0), new THREE.Vector3(x0 + size, nd.maxY, z0 + size));
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.name = `terrain-L${nd.l}`;
    m.visible = false;
    group.add(m);
    nd.mesh = m;
    return m;
  }

  const KQ = { low: 0.5, medium: 0.56, high: 0.72 };
  let K = KQ[quality] || 0.6;
  const active = new Set(), next = new Set();
  const last = new THREE.Vector3(1e9, 0, 0);
  function select(cam) {
    const cx = cam.x, cy = cam.y, cz = cam.z;
    next.clear();
    const visit = (l, ix, iz) => {
      const nd = nodeInfo(l, ix, iz);
      const dx = Math.max(nd.x0 - cx, 0, cx - nd.x0 - nd.size), dz = Math.max(nd.z0 - cz, 0, cz - nd.z0 - nd.size);
      const dy = Math.max(nd.minY - cy, 0, cy - nd.maxY);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const minL = nd.fine ? 0 : 2;
      if (l > minL && d < K * nd.size) {
        for (let c = 0; c < 4; c++) visit(l - 1, ix * 2 + (c & 1), iz * 2 + (c >> 1));
      } else next.add(nd);
    };
    visit(LEVELS, 0, 0);
    for (const nd of active) if (!next.has(nd)) nd.mesh.visible = false;
    for (const nd of next) { (nd.mesh || buildMesh(nd)).visible = true; }
    active.clear();
    for (const nd of next) active.add(nd);
  }

  function update(camera) {
    const p = camera.position;
    if (p.distanceToSquared(last) > 4) { last.copy(p); select(p); }
  }
  function setQuality(q) { K = KQ[q] || 0.6; last.set(1e9, 0, 0); }
  // Selecting all nodes around a point up front (so the first frame and the map render have ground).
  select(new THREE.Vector3(0, 60, 150));
  return { group, material, update, setQuality, get activeCount() { return active.size; } };
}

// ------------------------------------------------------------------ material
function makeMaterial({ fieldTex, ground, noiseTex, quality }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.name = 'terrain-splat';
  const uniforms = {
    tFields: { value: fieldTex }, tAlb: { value: ground.albedo }, tNrm: { value: ground.normal }, tNoise: { value: noiseTex },
    uFineHalf: { value: FINE.half }, uFineN: { value: FINE.n }, uDetail: { value: quality === 'low' ? 0.0 : 1.0 },
    uVineNear: { value: 110 }, uG0: { value: FIELD.G0 }, uSP: { value: FIELD.SP },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_SPLAT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  return mat;
}

const FRAG_HEAD = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray tFields;
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform sampler2D tNoise;
uniform float uFineHalf, uFineN, uDetail, uVineNear, uG0, uSP;
varying vec3 vWPos;
varying vec3 vWN;
float gRough;
vec3 gN;
uint hsh(ivec2 c, int s) {
  uint h = (uint(c.x) * 0x27d4eb2du) ^ (uint(c.y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b9u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
float hh(ivec2 c, int s) { return float(hsh(c, s)) / 4294967296.0; }
vec2 seedPos(ivec2 c) { return uG0 + (vec2(c) + 0.5) * uSP + (vec2(hh(c, 1), hh(c, 2)) - 0.5) * uSP * 0.8; }
ivec2 seedRep(ivec2 c) { float m = hh(c, 5); return m < 0.28 ? c - ivec2(1, 0) : m < 0.48 ? c - ivec2(0, 1) : c; }
// Same Voronoi field layout as terrain-land.js, for the ground beyond the detailed area.
void farFields(vec2 xz, out vec4 l1, out vec4 l2, out float tint) {
  ivec2 cc = ivec2(floor((xz - uG0) / uSP));
  float d1 = 1e18, d2 = 1e18; ivec2 c1 = cc, c2 = cc; vec2 p1 = xz, p2 = xz;
  for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) {
    ivec2 c = cc + ivec2(di, dj); vec2 p = seedPos(c); vec2 dd = xz - p; float d = dot(dd, dd);
    if (d < d1) { d2 = d1; c2 = c1; p2 = p1; d1 = d; c1 = c; p1 = p; } else if (d < d2) { d2 = d; c2 = c; p2 = p; }
  }
  ivec2 r1 = seedRep(c1), r2 = seedRep(c2);
  float e = r1 == r2 ? 99.0 : (d2 - d1) / (2.0 * length(p2 - p1));
  float r = hh(r1, 3) - 0.3 * smoothstep(900.0, 1500.0, max(abs(xz.x), abs(xz.y)));
  l1 = vec4(0.0); l2 = vec4(0.0);
  if (r < 0.42) l2.g = 1.0; else if (r < 0.58) { l1.b = 0.75; l2.r = 0.25; } else if (r < 0.72) l1.r = 1.0;
  else if (r < 0.84) l2.r = 1.0; else if (r < 0.93) l1.g = 1.0; else l1.a = 1.0;
  float em = 1.0 - smoothstep(1.2, 3.2, e);
  l1 *= 1.0 - em; l2 *= 1.0 - em; l2.r += 0.5 * em; l1.b += 0.45 * em;
  l2.a = hh(r1, 7); tint = hh(r1, 4);
}
vec4 lay(vec2 uv, float i) { return texture(tAlb, vec3(uv, i)); }
vec4 layN(vec2 uv, float i) { return texture(tNrm, vec3(uv, i)); }
`;

const FRAG_SPLAT = /* glsl */`
{
  vec3 wp = vWPos;
  vec2 xz = wp.xz;
  float camD = distance(cameraPosition, wp);
  float edgeR = max(abs(xz.x), abs(xz.y));
  vec4 A, L1, L2;
  vec3 N;
  if (edgeR < uFineHalf - 1.0) {
    vec2 fuv = ((xz + uFineHalf) * 0.5 + 0.5) / uFineN;
    A = texture(tFields, vec3(fuv, 0.0));
    L1 = texture(tFields, vec3(fuv, 1.0));
    L2 = texture(tFields, vec3(fuv, 2.0));
    N.xz = A.rg * 2.0 - 1.0;
    N.y = sqrt(max(0.02, 1.0 - dot(N.xz, N.xz)));
    N = normalize(N);
  } else {
    float tn;
    farFields(xz, L1, L2, tn);
    A = vec4(0.5, 0.5, tn, 1.0);
    N = normalize(vWN);
  }
  vec4 mn = texture(tNoise, xz / 97.0);
  vec4 mn2 = texture(tNoise, xz / 23.0);
  float tint = A.b;
  float sd = A.a * 12.75 - 2.5;
  float road = 1.0 - smoothstep(-0.35, 0.2, sd + (mn2.r - 0.5) * 0.6);
  float verge = (1.0 - smoothstep(0.0, 2.4, sd + (mn2.g - 0.5) * 1.2)) * (1.0 - road);
  float slope = 1.0 - N.y;
  float wheat = L1.r, plough = L1.g, lush = L1.b, vine = L1.a;
  float dry = L2.r, woods = L2.g, wet = L2.b, ang = L2.a * 3.14159265;
  float rest = max(0.0, 1.0 - (wheat + plough + lush + vine + dry + woods + wet));
  vec2 dir = vec2(cos(ang), sin(ang));
  float t = dot(xz, dir);

  // vine rows: soil strip under each row, grass between
  float tr = t / 2.6;
  float dRow = abs(fract(tr + 0.5) - 0.5) * 2.6;
  float aaR = clamp(fwidth(tr) * 1.5, 0.0, 1.0);
  float soilStrip = mix(1.0 - smoothstep(0.35, 0.75, dRow), 0.4, aaR);

  float shift = (mn.r - 0.5) * 0.7;
  float wG = (lush * 1.25 + rest * 0.5 + vine * (1.0 - soilStrip) * 0.8 + woods * 0.25 + wet * 0.35 + verge * 0.4) * (1.0 + shift);
  float wD = (dry + wheat + rest * 0.5 + vine * (1.0 - soilStrip) * 0.2 + verge * 0.45) * (1.0 - shift);
  float wE = plough + vine * soilStrip + woods * 0.75 + wet * 0.6 + verge * 0.1;
  float wR = smoothstep(0.30, 0.52, slope + (mn.b - 0.5) * 0.25);
  float k = 1.0 - road;
  wG *= k * (1.0 - wR); wD *= k * (1.0 - wR); wE *= k * (1.0 - wR * 0.6); wR *= k;
  float wV = road + verge * 0.12;

  mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  float at = smoothstep(0.3, 0.7, mn2.b);
  vec2 u0 = xz / 3.1, u1 = xz / 3.7, u2 = xz / 4.3, u3 = xz / 2.6, u4 = xz / 7.0;
  vec4 g = mix(lay(u0, 0.0), lay(R * u0 * 0.41 + 0.37, 0.0), at);
  vec4 d = mix(lay(u1, 1.0), lay(R * u1 * 0.45 + 0.71, 1.0), 1.0 - at);
  vec4 e = lay(u2, 2.0);
  vec4 v = lay(u3, 3.0);
  vec4 r = lay(u4, 4.0);
  // height-aware blend
  wG *= 0.35 + g.a; wD *= 0.35 + d.a; wE *= 0.35 + e.a; wV *= 0.35 + v.a; wR *= 0.35 + r.a;
  float ws = wG + wD + wE + wV + wR + 1e-4;
  wG /= ws; wD /= ws; wE /= ws; wV /= ws; wR /= ws;

  vec3 cg = g.rgb * g.rgb, cd = d.rgb * d.rgb, ce = e.rgb * e.rgb, cv = v.rgb * v.rgb, cr = r.rgb * r.rgb;
  // tints: grass lushness, wheat gold vs pale stubble, clay colours, woodland litter
  cg *= mix(vec3(0.92, 1.04, 0.82), vec3(1.12, 1.02, 0.7), clamp(tint * 0.5 + mn.g * 0.6 - 0.1, 0.0, 1.0));
  float wf = wheat / (wheat + dry + 0.001);
  cd *= mix(vec3(1.06, 1.0, 0.88), vec3(1.14, 0.94, 0.55), wf);
  cd *= mix(1.0, 0.92 + 0.16 * smoothstep(0.3, 0.7, abs(fract(t / 3.4) - 0.5) * 2.0), (1.0 - wf) * dry * (1.0 - clamp(fwidth(t / 3.4) * 2.0, 0.0, 1.0)));
  cd *= 0.9 + 0.2 * tint;
  vec3 clay = mix(vec3(1.0, 0.9, 0.78), vec3(0.7, 0.57, 0.45), tint);
  ce *= mix(clay, vec3(0.62, 0.56, 0.42), clamp(woods * 1.3, 0.0, 1.0));
  // furrows on ploughed fields
  float tf = t / 0.9, aaF = clamp(fwidth(tf) * 2.0, 0.0, 1.0);
  float fur = sin(tf * 6.2832) * (1.0 - aaF);
  ce *= 1.0 + 0.16 * fur * plough;

  // strada bianca: compacted wheel tracks, loose gravel and a hint of grass on the crown
  float trk = smoothstep(-2.3, -1.9, sd) * (1.0 - smoothstep(-1.2, -0.85, sd));
  cv *= 1.0 + 0.1 * trk - 0.06 * (1.0 - trk);
  cv = mix(cv, cg, (1.0 - smoothstep(-2.5, -2.1, sd)) * smoothstep(0.45, 0.75, mn2.r) * 0.45);
  cg *= vec3(0.8, 0.84, 0.6); cd *= vec3(0.74, 0.7, 0.62); cv *= 0.68;
  vec3 col = cg * wG + cd * wD + ce * wE + cv * wV + cr * wR;
  // macro brightness variation, wet darkening
  col *= 0.9 + 0.22 * mn.a + 0.08 * (mn2.a - 0.5);
  col *= 1.0 - wet * 0.35;
  // far vineyards: canopy stripes where the vine geometry is not drawn
  float farV = smoothstep(uVineNear * 0.8, uVineNear, camD);
  float canopy = mix(1.0 - smoothstep(0.45, 0.8, dRow), 0.42, aaR);
  col = mix(col, vec3(0.055, 0.085, 0.03), vine * farV * canopy * 0.9);
  diffuseColor.rgb = col;

  // detail normal (texture-space gradients) + furrow relief
  vec2 grad = vec2(0.0);
  float ds = uDetail * (1.0 - smoothstep(35.0, 200.0, camD));
  {
    grad = (layN(u0, 0.0).rg * 2.0 - 1.0) * wG + (layN(u1, 1.0).rg * 2.0 - 1.0) * wD
         + (layN(u2, 2.0).rg * 2.0 - 1.0) * wE + (layN(u3, 3.0).rg * 2.0 - 1.0) * wV + (layN(u4, 4.0).rg * 2.0 - 1.0) * wR;
    grad *= ds;
  }
  grad += dir * cos(tf * 6.2832) * 0.35 * (1.0 - aaF) * plough;
  gN = normalize(N + vec3(-grad.x, 0.0, -grad.y));
  gRough = mix(0.93, 0.8, wV) - wet * 0.3;
}
`;
