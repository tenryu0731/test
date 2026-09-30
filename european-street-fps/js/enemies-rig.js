// Training-robot rigs: one skeleton shared by three robot types (standard trooper, heavy, scout).
// Each type has a skinned primitive model (3 material groups) in two detail levels, a livery atlas
// (4 unit numbers per type, per-robot texture clones share one GPU texture), hit volumes and the
// procedural animation (walk / aim with two-bone IK / flinch / power-down collapse).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// Skeleton (bind pose, model space: feet at origin, facing +Z, robot's left = +X).
export const BONES = [
  ['root', -1, 0, 0, 0],
  ['pelvis', 0, 0, 0.95, 0],
  ['spine', 1, 0, 1.04, 0],
  ['head', 2, 0, 1.55, 0],
  ['shoulderL', 2, 0.27, 1.43, 0],
  ['elbowL', 4, 0.29, 1.15, 0],
  ['shoulderR', 2, -0.27, 1.43, 0],
  ['elbowR', 6, -0.29, 1.15, 0],
  ['hipL', 1, 0.115, 0.9, 0],
  ['kneeL', 8, 0.115, 0.5, 0],
  ['ankleL', 9, 0.115, 0.1, 0],
  ['hipR', 1, -0.115, 0.9, 0],
  ['kneeR', 11, -0.115, 0.5, 0],
  ['ankleR', 12, -0.115, 0.1, 0],
];
export const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const bindPos = (i) => new THREE.Vector3(BONES[i][2], BONES[i][3], BONES[i][4]);
const LOCAL_POS = BONES.map((b) => (b[1] >= 0 ? V(b[2] - BONES[b[1]][2], b[3] - BONES[b[1]][3], b[4] - BONES[b[1]][4]) : V(0, 0, 0)));

// Hit volumes, bind-space boxes attached to bones (the group scale is applied on top).
const HITBOXES = [
  ['head', 'head', [-0.145, 1.575, -0.15], [0.145, 1.83, 0.16]],
  ['spine', 'body', [-0.25, 1.02, -0.25], [0.25, 1.56, 0.17]],
  ['pelvis', 'body', [-0.2, 0.84, -0.12], [0.2, 1.04, 0.13]],
  ['hipL', 'body', [0.04, 0.5, -0.1], [0.2, 0.94, 0.1]],
  ['hipR', 'body', [-0.2, 0.5, -0.1], [-0.04, 0.94, 0.1]],
  ['kneeL', 'body', [0.04, 0.12, -0.08], [0.19, 0.54, 0.1]],
  ['kneeR', 'body', [-0.19, 0.12, -0.08], [-0.04, 0.54, 0.1]],
  ['ankleL', 'body', [0.045, 0, -0.1], [0.185, 0.12, 0.19]],
  ['ankleR', 'body', [-0.185, 0, -0.1], [-0.045, 0.12, 0.19]],
  ['shoulderL', 'body', [0.2, 1.17, -0.1], [0.38, 1.54, 0.1]],
  ['shoulderR', 'body', [-0.38, 1.17, -0.1], [-0.2, 1.54, 0.1]],
  ['elbowL', 'body', [0.23, 0.8, -0.07], [0.35, 1.16, 0.08]],
  ['elbowR', 'body', [-0.35, 0.56, -0.07], [-0.22, 1.16, 0.15]],
];
const HITBOX_MOD = {
  heavy: {
    head: [[-0.155, 1.57, -0.16], [0.155, 1.84, 0.17]],
    spine: [[-0.285, 1.0, -0.3], [0.285, 1.58, 0.21]],
    pelvis: [[-0.22, 0.8, -0.15], [0.22, 1.04, 0.16]],
    shoulderL: [[0.2, 1.15, -0.14], [0.43, 1.57, 0.14]],
    shoulderR: [[-0.43, 1.15, -0.14], [-0.2, 1.57, 0.14]],
    elbowR: [[-0.36, 0.44, -0.08], [-0.22, 1.16, 0.17]],
    hipL: [[0.03, 0.5, -0.12], [0.22, 0.94, 0.12]],
    hipR: [[-0.22, 0.5, -0.12], [-0.03, 0.94, 0.12]],
    kneeL: [[0.03, 0.12, -0.09], [0.2, 0.55, 0.12]],
    kneeR: [[-0.2, 0.12, -0.09], [-0.03, 0.55, 0.12]],
  },
  scout: {
    spine: [[-0.22, 1.03, -0.22], [0.22, 1.54, 0.15]],
    elbowR: [[-0.34, 0.6, -0.07], [-0.23, 1.16, 0.14]],
  },
};

export const MUZZLE = {
  trooper: V(-0.29, 0.545, 0.085),
  heavy: V(-0.29, 0.455, 0.1),
  scout: V(-0.29, 0.62, 0.085),
};

// ---------------------------------------------------------------------------------------------
// Palettes (vertex colours; the livery texture multiplies them).
const PAL = {
  trooper: { shell: 0xe6e5df, panel: 0xa3a8ad, accent: 0xef6a1e, dark: 0x3a3e44, darker: 0x24272b, rubber: 0x1b1c1e, gun: 0x4d545c, joint: 0x5b6168, plate: 0xffffff },
  heavy: { shell: 0x959ca2, panel: 0x6c7379, accent: 0xf0b622, dark: 0x33373b, darker: 0x1f2124, rubber: 0x18191b, gun: 0x3c4248, joint: 0x51565c, plate: 0xffffff },
  scout: { shell: 0xeceae4, panel: 0xbfc5cb, accent: 0x2f6fb8, dark: 0x3a3f46, darker: 0x23272c, rubber: 0x1b1c1e, gun: 0x4a525b, joint: 0x5e646b, plate: 0xffffff },
};
const VISOR = 0xffffff;

// ---------------------------------------------------------------------------------------------
// Geometry helpers.
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = V(0, 1, 0), ONE = V(1, 1, 1);
const REGIONS = { generic: [0, 0.5], chest: [0.5, 0.5], back: [0, 0], solid: [0.5, 0] }; // u0, v0 of a 0.5 square

// Box with 45° chamfered, smooth-shaded edges; planar UVs per face (so face textures are not stretched).
function chamferBox(w, h, d, r, faceRegion = () => 'generic') {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const sx = Math.sign(x), sy = Math.sign(y), sz = Math.sign(z);
    n.set(x - sx / 6, y - sy / 6, z - sz / 6).normalize();
    const px = sx * hx + n.x * r, py = sy * hy + n.y * r, pz = sz * hz + n.z * r;
    pos.setXYZ(i, px, py, pz);
    nor.setXYZ(i, n.x, n.y, n.z);
    const face = Math.floor(i / 16);
    const X = (px + w / 2) / w, Y = (py + h / 2) / h, Z = (pz + d / 2) / d;
    const [u, v] = faceUV(face, X, Y, Z);
    const [u0, v0] = REGIONS[faceRegion(face)];
    uv.setXY(i, u0 + 0.01 + u * 0.48, v0 + 0.01 + v * 0.48);
  }
  return g;
}
// Low-detail box (flat faces, same UV layout).
function plainBox(w, h, d, faceRegion = () => 'generic') {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const face = Math.floor(i / 4);
    const X = pos.getX(i) / w + 0.5, Y = pos.getY(i) / h + 0.5, Z = pos.getZ(i) / d + 0.5;
    const [u, v] = faceUV(face, X, Y, Z);
    const [u0, v0] = REGIONS[faceRegion(face)];
    uv.setXY(i, u0 + 0.01 + u * 0.48, v0 + 0.01 + v * 0.48);
  }
  return g;
}
function faceUV(face, X, Y, Z) {
  switch (face) {
    case 0: return [1 - Z, Y];
    case 1: return [Z, Y];
    case 2: return [X, 1 - Z];
    case 3: return [X, Z];
    case 4: return [X, Y];
    default: return [1 - X, Y];
  }
}
function remapUV(g, region = 'generic') {
  const uv = g.attributes.uv, [u0, v0] = REGIONS[region];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + 0.01 + clamp(uv.getX(i), 0, 1) * 0.48, v0 + 0.01 + clamp(uv.getY(i), 0, 1) * 0.48);
  return g;
}
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  g.applyMatrix4(_m4.compose(new THREE.Vector3(x, y, z), _q, ONE));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Robot geometry for a type ('trooper' | 'heavy' | 'scout'); lod = true builds the far model.
export function buildRobotGeometry(type = 'trooper', lod = false) {
  const H = type === 'heavy', S = type === 'scout';
  const C = PAL[type] || PAL.trooper;
  const parts = { shell: [], dark: [], visor: [] };
  const col = new THREE.Color();
  const add = (mat, g, bone, color, detail = false) => {
    if (lod && detail) { g.dispose(); return; }
    const bi = BI[bone];
    const n = g.attributes.position.count;
    col.setHex(color);
    const colors = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      si[i * 4] = bi; sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.clearGroups();
    parts[mat].push(g);
  };
  const box = (w, h, d, r, fr) => (lod ? plainBox(w, h, d, fr) : chamferBox(w, h, d, r, fr));
  const seg = (n) => (lod ? Math.max(5, Math.round(n / 2)) : n);
  const cyl = (a, b, r, sg = 10, rTop = r) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(rTop, r, len, seg(sg), 1);
    _q.setFromUnitVectors(UP, dir.normalize());
    g.applyMatrix4(_m4.compose(a.clone().add(b).multiplyScalar(0.5), _q, ONE));
    return remapUV(g, 'solid');
  };
  const cylAt = (r, h, sg, x, y, z, rx = 0, ry = 0, rz = 0) => remapUV(place(new THREE.CylinderGeometry(r, r, h, seg(sg)), x, y, z, rx, ry, rz), 'solid');
  const sphere = (r, x, y, z, ws = 10, hs = 7) => remapUV(place(new THREE.SphereGeometry(r, lod ? 6 : ws, lod ? 4 : hs), x, y, z), 'solid');
  const solid = () => 'solid';

  // ---- pelvis
  add('dark', place(box(0.3, 0.14, 0.2, 0.035), 0, 0.95, 0), 'pelvis', C.dark);
  add('shell', place(box(0.24, 0.11, 0.05, 0.015, solid), 0, 0.93, 0.105, -0.12), 'pelvis', C.accent);
  add('shell', place(box(0.26, 0.1, 0.05, 0.015), 0, 0.94, -0.105, 0.1), 'pelvis', C.panel);
  add('shell', place(box(0.05, 0.12, 0.16, 0.015), 0.17, 0.93, 0), 'pelvis', C.panel);
  add('shell', place(box(0.05, 0.12, 0.16, 0.015), -0.17, 0.93, 0), 'pelvis', C.panel);
  if (H) {
    // armoured skirt: front/back tassets and hip guards
    add('shell', place(box(0.28, 0.15, 0.04, 0.012), 0, 0.84, 0.135, -0.18), 'pelvis', C.shell);
    add('shell', place(box(0.29, 0.13, 0.04, 0.012), 0, 0.85, -0.13, 0.15), 'pelvis', C.panel);
    for (const s of [1, -1]) add('shell', place(box(0.04, 0.17, 0.2, 0.012), s * 0.205, 0.87, 0, 0, 0, s * 0.12), 'pelvis', C.shell);
  }

  // ---- spine / torso
  add('dark', cyl(V(0, 0.98, 0), V(0, 1.18, -0.01), 0.095, 12, 0.11), 'spine', C.darker);
  for (const y of [1.05, 1.11]) add('dark', cyl(V(0, y - 0.012, 0), V(0, y + 0.012, 0), 0.112, 12), 'spine', C.joint, true);
  const TW = H ? 0.54 : S ? 0.4 : 0.46, TH = H ? 0.38 : S ? 0.33 : 0.36, TD = H ? 0.31 : S ? 0.24 : 0.27;
  const TY = S ? 1.35 : 1.34;
  if (H) {
    // grey torso; the chest plate (vertex white, painted chest region) carries the number + hazard band
    add('shell', place(box(TW, TH, TD, 0.06, (f) => (f === 5 ? 'back' : 'generic')), 0, TY, -0.01), 'spine', C.shell);
    add('shell', place(box(0.46, 0.29, 0.05, 0.02, (f) => (f === 4 ? 'chest' : 'generic')), 0, TY + 0.005, TD / 2 + 0.005), 'spine', C.plate);
    add('shell', place(box(0.2, 0.08, 0.28, 0.025), 0, TY + 0.2, -0.02), 'spine', C.panel);
  } else {
    add('shell', place(box(TW, TH, TD, 0.055, (f) => (f === 4 ? 'chest' : f === 5 ? 'back' : 'generic')), 0, TY, 0.005), 'spine', C.shell);
  }
  add('shell', place(box(H ? 0.36 : S ? 0.26 : 0.3, 0.07, H ? 0.24 : 0.2, 0.025), 0, 1.53, -0.02), 'spine', C.panel);
  add('shell', place(box(0.012, TH - 0.1, 0.1, 0.004, solid), TW / 2 + 0.002, TY - 0.01, 0.04), 'spine', C.accent);
  add('shell', place(box(0.012, TH - 0.1, 0.1, 0.004, solid), -TW / 2 - 0.002, TY - 0.01, 0.04), 'spine', C.accent);
  // backpack: power unit, cells and vent fins
  const BW = H ? 0.38 : S ? 0.24 : 0.3, BH = H ? 0.32 : S ? 0.22 : 0.27, BD = H ? 0.14 : S ? 0.08 : 0.1;
  const BZ = -TD / 2 - BD / 2 + 0.02;
  add('dark', place(box(BW, BH, BD, 0.025), 0, 1.33, BZ), 'spine', C.dark);
  for (const x of (H ? [-0.11, 0, 0.11] : [-0.08, 0.08])) add('shell', cyl(V(x, 1.33 - BH * 0.4, BZ - BD / 2 - 0.015), V(x, 1.33 + BH * 0.4, BZ - BD / 2 - 0.015), H ? 0.04 : 0.034, 10), 'spine', C.panel);
  for (let i = 0; i < 4; i++) add('dark', place(new THREE.BoxGeometry(BW * 0.72, 0.012, 0.02), 0, 1.33 - BH * 0.3 + i * BH * 0.19, BZ - BD / 2 - 0.005), 'spine', C.darker, true);
  if (H) {
    for (const s of [1, -1]) {
      add('dark', cyl(V(s * 0.14, 1.46, BZ - 0.02), V(s * 0.15, 1.62, BZ - 0.04), 0.03, 10), 'spine', C.gun);
      add('shell', cylAt(0.034, 0.03, 10, s * 0.152, 1.625, BZ - 0.042), 'spine', C.accent);
    }
  }
  if (S) {
    // sensor mast with a small dish
    add('dark', cyl(V(0.09, 1.42, BZ - 0.02), V(0.1, 1.78, BZ - 0.05), 0.008, 5), 'spine', C.darker);
    add('shell', remapUV(place(new THREE.CylinderGeometry(0.05, 0.02, 0.025, seg(12)), 0.1, 1.79, BZ - 0.05, 0.5, 0, 0), 'solid'), 'spine', C.accent);
  }

  // ---- head
  add('dark', cyl(V(0, 1.48, -0.01), V(0, 1.63, -0.01), 0.048, 10), 'head', C.joint);
  if (H) {
    add('shell', place(box(0.27, 0.2, 0.27, 0.06), 0, 1.7, -0.01), 'head', C.shell);
    add('shell', place(box(0.29, 0.045, 0.1, 0.015, solid), 0, 1.775, 0.1, 0.25), 'head', C.accent); // brow guard
    add('shell', place(box(0.06, 0.025, 0.25, 0.008, solid), 0, 1.806, -0.02), 'head', C.panel);
    add('visor', place(box(0.22, 0.04, 0.05, 0.012), 0, 1.71, 0.12), 'head', VISOR);
    add('dark', place(box(0.2, 0.06, 0.05, 0.015), 0, 1.645, 0.12), 'head', C.darker);
    for (let i = 0; i < 3; i++) add('dark', place(new THREE.BoxGeometry(0.13, 0.006, 0.01), 0, 1.628 + i * 0.014, 0.146), 'head', C.joint, true);
  } else {
    const hw = S ? 0.22 : 0.24;
    add('shell', place(box(hw, S ? 0.185 : 0.2, S ? 0.24 : 0.25, 0.055), 0, 1.7, -0.005), 'head', C.shell);
    add('shell', place(box(0.05, 0.02, 0.23, 0.008, solid), 0, S ? 1.795 : 1.803, -0.01), 'head', C.accent);
    if (S) add('visor', place(box(0.2, 0.08, 0.05, 0.02), 0, 1.71, 0.105), 'head', VISOR);
    else add('visor', place(box(0.2, 0.066, 0.05, 0.018), 0, 1.71, 0.11), 'head', VISOR);
    add('dark', place(box(hw - 0.015, 0.02, 0.045, 0.008), 0, 1.753 + (S ? 0.004 : 0), 0.107), 'head', C.darker);
    add('dark', place(box(0.15, 0.045, 0.04, 0.012), 0, 1.644, 0.11), 'head', C.darker);
    for (let i = 0; i < 3; i++) add('dark', place(new THREE.BoxGeometry(0.1, 0.005, 0.01), 0, 1.632 + i * 0.012, 0.131), 'head', C.joint, true);
  }
  // camera lens(es)
  if (S) for (const x of [-0.055, 0.055]) add('visor', place(new THREE.CylinderGeometry(0.018, 0.02, 0.03, seg(12)), x, 1.71, 0.132, Math.PI / 2), 'head', VISOR, true);
  else add('visor', place(new THREE.CylinderGeometry(0.02, 0.022, 0.03, seg(12)), -0.05, 1.71, H ? 0.145 : 0.135, Math.PI / 2), 'head', VISOR, true);
  const earX = H ? 0.14 : S ? 0.115 : 0.125, earR = H ? 0.056 : 0.048;
  for (const s of [-1, 1]) {
    add('dark', place(new THREE.CylinderGeometry(earR, earR, 0.045, seg(12)), s * earX, 1.7, -0.02, 0, 0, Math.PI / 2), 'head', C.dark);
    add('shell', place(new THREE.CylinderGeometry(earR * 0.55, earR * 0.55, 0.05, seg(10)), s * (earX + 0.002), 1.7, -0.02, 0, 0, Math.PI / 2), 'head', C.accent);
  }
  if (S) {
    for (const s of [-1, 1]) {
      add('dark', cyl(V(s * 0.08, 1.77, -0.08), V(s * 0.11, 1.99, -0.12), 0.006, 5), 'head', C.darker, true);
      add('shell', sphere(0.012, s * 0.11, 1.995, -0.12, 6, 4), 'head', C.accent, true);
    }
  } else if (!H) {
    add('dark', cyl(V(0.09, 1.78, -0.07), V(0.1, 1.93, -0.09), 0.006, 5), 'head', C.darker, true);
    add('shell', sphere(0.013, 0.1, 1.935, -0.09, 6, 4), 'head', C.accent, true);
  }

  // ---- arms
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    add('dark', sphere(0.075, s * 0.27, 1.43, 0), 'shoulder' + L, C.joint);
    if (H) {
      add('shell', place(box(0.2, 0.15, 0.27, 0.045), s * 0.315, 1.475, 0, 0, 0, s * -0.16), 'shoulder' + L, C.shell);
      add('shell', place(box(0.206, 0.04, 0.276, 0.014, solid), s * 0.318, 1.45, 0, 0, 0, s * -0.16), 'shoulder' + L, C.accent);
      add('shell', place(box(0.17, 0.08, 0.24, 0.03), s * 0.33, 1.39, 0, 0, 0, s * -0.3), 'shoulder' + L, C.panel);
      add('shell', place(box(0.115, 0.2, 0.125, 0.03), s * 0.29, 1.28, 0), 'shoulder' + L, C.panel);
    } else {
      const pw = S ? 0.125 : 0.15, pd = S ? 0.17 : 0.2;
      add('shell', place(box(pw, S ? 0.1 : 0.12, pd, 0.04), s * 0.3, 1.47, 0, 0, 0, s * -0.12), 'shoulder' + L, C.shell);
      add('shell', place(box(pw + 0.006, 0.03, pd + 0.006, 0.012, solid), s * 0.3, 1.45, 0, 0, 0, s * -0.12), 'shoulder' + L, C.accent);
      add('shell', place(box(S ? 0.09 : 0.1, 0.2, S ? 0.1 : 0.11, 0.028), s * 0.285, 1.29, 0), 'shoulder' + L, C.panel);
    }
    add('dark', sphere(0.056, s * 0.29, 1.15, 0), 'elbow' + L, C.joint);
    add('shell', place(box(H ? 0.125 : 0.105, 0.22, H ? 0.14 : 0.12, 0.032), s * 0.29, 1.005, 0), 'elbow' + L, C.shell);
    add('shell', place(box(H ? 0.131 : 0.111, 0.026, H ? 0.146 : 0.126, 0.012, solid), s * 0.29, 1.06, 0), 'elbow' + L, C.accent);
    add('dark', place(box(0.08, 0.09, 0.09, 0.02), s * 0.29, 0.85, 0.005), 'elbow' + L, C.dark);
  }
  // marker blaster, held along the right forearm (points down in bind pose, forward when aiming)
  if (H) {
    add('dark', place(box(0.095, 0.36, 0.125, 0.02), -0.29, 0.78, 0.08), 'elbowR', C.gun);
    add('dark', cylAt(0.055, 0.07, 14, -0.235, 0.8, 0.08, 0, 0, Math.PI / 2), 'elbowR', C.darker); // drum
    add('shell', cylAt(0.035, 0.074, 12, -0.235, 0.8, 0.08, 0, 0, Math.PI / 2), 'elbowR', C.accent);
    add('dark', place(box(0.05, 0.1, 0.05, 0.012), -0.29, 0.92, 0.02), 'elbowR', C.darker);
    add('dark', cyl(V(-0.29, 0.61, 0.1), V(-0.29, 0.475, 0.1), 0.024, 10), 'elbowR', C.darker);
    add('shell', cyl(V(-0.29, 0.5, 0.1), V(-0.29, 0.46, 0.1), 0.032, 12), 'elbowR', C.accent);
    add('shell', place(box(0.1, 0.07, 0.13, 0.012, solid), -0.29, 0.66, 0.08), 'elbowR', C.accent);
  } else if (S) {
    add('dark', place(box(0.06, 0.22, 0.085, 0.016), -0.29, 0.83, 0.07), 'elbowR', C.gun);
    add('dark', place(box(0.045, 0.08, 0.045, 0.01), -0.29, 0.91, 0.02), 'elbowR', C.darker);
    add('dark', cyl(V(-0.29, 0.72, 0.085), V(-0.29, 0.635, 0.085), 0.016, 10), 'elbowR', C.darker);
    add('shell', cyl(V(-0.29, 0.655, 0.085), V(-0.29, 0.625, 0.085), 0.023, 12), 'elbowR', C.accent);
    add('shell', place(box(0.064, 0.05, 0.089, 0.01, solid), -0.29, 0.77, 0.07), 'elbowR', C.accent);
  } else {
    add('dark', place(box(0.07, 0.3, 0.1, 0.018), -0.29, 0.8, 0.075), 'elbowR', C.gun);
    add('dark', place(box(0.05, 0.1, 0.05, 0.012), -0.29, 0.9, 0.02), 'elbowR', C.darker);
    add('dark', cyl(V(-0.29, 0.66, 0.085), V(-0.29, 0.57, 0.085), 0.019, 10), 'elbowR', C.darker);
    add('shell', cyl(V(-0.29, 0.585, 0.085), V(-0.29, 0.55, 0.085), 0.027, 12), 'elbowR', C.accent);
    add('dark', place(box(0.022, 0.07, 0.03, 0.006), -0.29, 0.84, 0.138), 'elbowR', C.darker, true);
    add('shell', place(box(0.074, 0.06, 0.104, 0.012, solid), -0.29, 0.72, 0.075), 'elbowR', C.accent);
  }

  // ---- legs
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', x = s * 0.115;
    add('dark', sphere(0.07, x, 0.9, 0), 'hip' + L, C.joint);
    const tw = H ? 0.17 : S ? 0.12 : 0.14, td = H ? 0.19 : S ? 0.14 : 0.16;
    add('shell', place(box(tw, 0.3, td, 0.035), x + s * 0.005, 0.69, 0.005), 'hip' + L, C.shell);
    add('shell', place(box(0.012, 0.22, 0.05, 0.004, solid), x + s * (tw / 2 + 0.007), 0.69, 0.02), 'hip' + L, C.accent);
    add('dark', sphere(0.06, x, 0.5, 0), 'knee' + L, C.joint);
    add('shell', place(box(H ? 0.13 : 0.1, H ? 0.11 : 0.09, 0.05, 0.02), x, 0.49, H ? 0.08 : 0.065), 'knee' + L, H ? C.accent : C.panel);
    add('dark', cyl(V(x, 0.47, 0), V(x, 0.12, 0), 0.045, 10), 'knee' + L, C.dark);
    const sw = H ? 0.15 : S ? 0.11 : 0.125, sd = H ? 0.1 : S ? 0.065 : 0.075;
    add('shell', place(box(sw, 0.27, sd, 0.025), x, 0.29, 0.035), 'knee' + L, C.shell);
    add('shell', place(box(sw + 0.006, 0.026, sd + 0.006, 0.01, solid), x, 0.37, 0.035), 'knee' + L, C.accent);
    add('dark', cyl(V(x, 0.45, -0.055), V(x, 0.16, -0.055), 0.017, 6), 'knee' + L, C.gun, true);
    add('dark', sphere(0.045, x, 0.1, 0), 'ankle' + L, C.joint);
    add('dark', place(box(H ? 0.15 : S ? 0.12 : 0.13, H ? 0.08 : 0.07, H ? 0.31 : S ? 0.27 : 0.28, 0.02), x, 0.036, 0.045), 'ankle' + L, C.rubber);
    add('shell', place(box(H ? 0.156 : 0.136, 0.055, 0.085, 0.02, solid), x, 0.06, H ? 0.16 : 0.15), 'ankle' + L, C.accent);
    add('shell', place(box(H ? 0.13 : 0.11, 0.05, 0.1, 0.018), x, 0.085, -0.03), 'ankle' + L, C.panel);
  }

  const merged = mergeGeometries([mergeGeometries(parts.shell), mergeGeometries(parts.dark), mergeGeometries(parts.visor)], true);
  for (const k in parts) for (const g of parts[k]) g.dispose();
  merged.computeBoundingBox();
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.1);
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Livery atlas per type: 2×2 cells, each a full livery (generic panel, chest, back, solid) with its
// own unit number. Robots use texture clones with offset/repeat (one GPU upload per type).
const LIVERY = {
  trooper: { nums: ['07', '12', '23', '31'], band: ['#ee6a1f', '#f3f1ea'], text: '#2c3035', label: ['TRAINING', 'UNIT'], stripe: '#ee6a1f', chestBg: '#ffffff' },
  heavy: { nums: ['H2', 'H5', 'H7', 'H9'], band: ['#f0b622', '#26282b'], text: '#1d2024', label: ['HEAVY', 'UNIT'], stripe: '#3a3d41', chestBg: '#a3a9ae' },
  scout: { nums: ['S1', 'S3', 'S4', 'S8'], band: ['#2f6fb8', '#f3f1ea'], text: '#23303d', label: ['SCOUT', 'UNIT'], stripe: '#2f6fb8', chestBg: '#ffffff' },
};
export const LIVERY_CELLS = 4;

function paintLivery(g, L, num) {
  const S = 512;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  const speckle = (x0, y0, w, h, n) => {
    for (let i = 0; i < n; i++) {
      const v = 150 + Math.random() * 90 | 0;
      g.fillStyle = `rgba(${v},${v},${v - 6},${0.05 + Math.random() * 0.08})`;
      g.fillRect(x0 + Math.random() * w, y0 + Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
    }
    for (let i = 0; i < 5; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(120,112,100,0.10)'); gr.addColorStop(1, 'rgba(120,112,100,0)');
      g.save(); g.translate(x0 + Math.random() * w, y0 + Math.random() * h); g.scale(10 + Math.random() * 30, 4 + Math.random() * 12);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    }
  };
  const seam = (x, y, w, h, rr = 10) => {
    g.lineWidth = 3; g.strokeStyle = 'rgba(70,72,74,0.55)';
    g.beginPath(); g.roundRect(x, y, w, h, rr); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.roundRect(x + 2, y + 2, w, h, rr); g.stroke();
  };
  const screw = (x, y) => {
    g.fillStyle = 'rgba(90,92,95,0.8)'; g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill();
    g.fillStyle = 'rgba(210,210,205,1)'; g.beginPath(); g.arc(x - 0.7, y - 0.7, 2.2, 0, TAU); g.fill();
  };
  // generic (top-left)
  speckle(0, 0, 256, 256, 380);
  seam(12, 12, 232, 232, 18);
  for (const [x, y] of [[30, 30], [226, 30], [30, 226], [226, 226]]) screw(x, y);
  // chest (top-right) — face aspect 0.46 : 0.36
  const cx = 256;
  g.fillStyle = L.chestBg; g.fillRect(cx, 0, 256, 256);
  speckle(cx, 0, 256, 256, 420);
  seam(cx + 10, 10, 236, 236, 22);
  g.lineWidth = 3; g.strokeStyle = 'rgba(70,72,74,0.5)';
  g.beginPath(); g.moveTo(cx + 128, 10); g.lineTo(cx + 128, 150); g.stroke();
  g.beginPath(); g.moveTo(cx + 10, 150); g.lineTo(cx + 246, 150); g.stroke();
  // hazard band
  g.save(); g.beginPath(); g.rect(cx + 12, 164, 232, 50); g.clip();
  g.fillStyle = L.band[0]; g.fillRect(cx, 160, 256, 60);
  g.fillStyle = L.band[1];
  for (let x = -60; x < 280; x += 36) { g.beginPath(); g.moveTo(cx + x, 214); g.lineTo(cx + x + 18, 214); g.lineTo(cx + x + 68, 164); g.lineTo(cx + x + 50, 164); g.closePath(); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 2; g.strokeRect(cx + 12, 164, 232, 50);
  // number, compensated for the face aspect (u spans 0.46 m, v 0.36 m)
  g.save();
  g.translate(cx + 70, 88); g.scale(0.36 / 0.46 * 1.05, 1);
  g.fillStyle = L.text; g.font = 'bold 104px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, 0, 4);
  g.restore();
  g.fillStyle = L.text; g.font = 'bold 17px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(L.label[0], cx + 190, 60); g.fillText(L.label[1], cx + 190, 80);
  g.fillStyle = L.band[0]; g.fillRect(cx + 160, 96, 60, 8);
  for (const [x, y] of [[cx + 26, 26], [cx + 230, 26], [cx + 26, 136], [cx + 230, 136]]) screw(x, y);
  // back (bottom-left)
  speckle(0, 256, 256, 256, 380);
  seam(10, 266, 236, 236, 22);
  g.fillStyle = 'rgba(60,62,66,0.75)';
  for (let i = 0; i < 5; i++) g.fillRect(40, 300 + i * 16, 90, 6);
  g.fillStyle = L.text; g.font = 'bold 44px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, 190, 330);
  g.fillStyle = L.stripe; g.fillRect(12, 440, 232, 22);
  // solid (bottom-right) stays plain white
}

const _atlases = new Map();
function liveryAtlas(type) {
  let t = _atlases.get(type);
  if (t) return t;
  const L = LIVERY[type] || LIVERY.trooper;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  for (let k = 0; k < LIVERY_CELLS; k++) {
    g.save(); g.translate((k % 2) * 512, (k >> 1) * 512);
    g.beginPath(); g.rect(0, 0, 512, 512); g.clip();
    paintLivery(g, L, L.nums[k]);
    g.restore();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _atlases.set(type, t);
  return t;
}
// Texture for livery cell k of a type (clone sharing the atlas' image and GPU texture).
export function liveryTexture(type, k) {
  const t = liveryAtlas(type).clone();
  const cell = k % LIVERY_CELLS;
  t.repeat.set(0.5, 0.5);
  t.offset.set((cell % 2) * 0.5, (cell >> 1) ? 0 : 0.5); // canvas row 0 is the top (v 0.5..1)
  return t;
}
export function liveryNumber(type, k) { return (LIVERY[type] || LIVERY.trooper).nums[k % LIVERY_CELLS]; }

// ---------------------------------------------------------------------------------------------
// Rig instance: SkinnedMesh + bones + hit volumes. Matrices are updated manually (matrixAutoUpdate
// off) only when the robot is animated, so culled / far robots cost nothing in the scene update.
const _boneInverses = BONES.map((b) => new THREE.Matrix4().makeTranslation(-b[2], -b[3], -b[4]));
export function createRig(type, geometry, darkMat, shellMap) {
  const shellMat = new THREE.MeshStandardMaterial({
    map: shellMap, vertexColors: true, roughness: type === 'heavy' ? 0.5 : 0.46, metalness: type === 'heavy' ? 0.18 : 0.06,
    emissive: 0xffffff, emissiveIntensity: 0,
  });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b1a1d, roughness: 0.16, metalness: 0.3, emissive: 0x33b8ac, emissiveIntensity: 0.5 });
  const bones = BONES.map((b) => { const bone = new THREE.Bone(); bone.name = b[0]; return bone; });
  BONES.forEach((b, j) => {
    const parent = b[1];
    if (parent >= 0) { bones[j].position.copy(LOCAL_POS[j]); bones[parent].add(bones[j]); }
    if (/shoulder|spine|head/.test(b[0])) bones[j].rotation.order = 'YXZ';
    bones[j].matrixAutoUpdate = false;
  });
  const mesh = new THREE.SkinnedMesh(geometry, [shellMat, darkMat, visorMat]);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones, _boneInverses.map((m) => m.clone())), new THREE.Matrix4());
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.1);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  const group = new THREE.Group();
  group.add(mesh);
  group.matrixAutoUpdate = false;
  const B = Object.fromEntries(BONES.map((b, j) => [b[0], bones[j]]));
  const mods = HITBOX_MOD[type] || {};
  const hit = HITBOXES.map(([bone, part, mn, mx]) => {
    const o = bindPos(BI[bone]);
    const m = mods[bone];
    return { bone: B[bone], part, box: new THREE.Box3(V(...(m ? m[0] : mn)).sub(o), V(...(m ? m[1] : mx)).sub(o)) };
  });
  return {
    group, mesh, bones: B, boneList: bones, shellMat, visorMat, hit,
    muzzleLocal: (MUZZLE[type] || MUZZLE.trooper).clone().sub(bindPos(BI.elbowR)),
  };
}

export function resetPose(r) {
  const b = r.bones;
  for (const k in b) { b[k].rotation.set(0, 0, 0); b[k].position.copy(LOCAL_POS[BI[k]]); }
}

export function syncMatrices(r) {
  const g = r.group;
  g.position.copy(r.pos);
  g.rotation.set(0, r.heading, 0);
  g.scale.setScalar(r.cfg.scale);
  g.updateMatrix();
  for (const bone of r.boneList) bone.updateMatrix();
  g.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------------------------
// Two-bone IK: shoulder quaternion (in its parent's space) so the chain (upper a, lower b, bone
// axis -Y, elbow bending toward local +Z) reaches `t`; the elbow points toward `pole`. Returns bend.
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _mb = new THREE.Matrix4();
const _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3(), _ik3 = new THREE.Vector3(), _ik4 = new THREE.Vector3();
const SUPPORT_R = new THREE.Vector3(0.03, -0.3, -0.04); // under the blaster, in the right forearm's space
const POLE_L = new THREE.Vector3(1, -1.2, -0.5).normalize();
function armIK(t, a, b, pole, outQ) {
  const d = clamp(t.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const th = _ik1.copy(t).normalize();
  const bend = Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const ph = _ik2.copy(pole).addScaledVector(th, -pole.dot(th)).normalize();
  const u = _ik3.copy(th).multiplyScalar(Math.cos(alpha)).addScaledVector(ph, Math.sin(alpha)).normalize();
  const yAxis = u.negate();
  const zAxis = _ik4.copy(ph).addScaledVector(yAxis, -ph.dot(yAxis)).negate().normalize();
  const xAxis = _ik2.crossVectors(yAxis, zAxis).normalize();
  _mb.makeBasis(xAxis, yAxis, zAxis);
  outQ.setFromRotationMatrix(_mb);
  return bend;
}

// ---------------------------------------------------------------------------------------------
// Procedural animation of a living robot. `time` is the manager clock.
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
export function animateRobot(r, dt, time) {
  const b = r.bones, cfg = r.cfg;
  r.flash = Math.max(0, r.flash - dt / 0.11);
  r.shellMat.emissiveIntensity = r.flash * 0.75;

  const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
  const vx = r.actVel.x, vz = r.actVel.z, speed = Math.hypot(vx, vz) / cfg.scale;
  const fwd = vx * sh + vz * ch, side = vx * ch - vz * sh;
  const turn = Math.abs(r.turnRate);
  const move = Math.min(1, speed / 0.35 + turn * 0.25);
  const gait = clamp(speed / cfg.gaitRef + turn * 0.08, 0, 1);
  r.phase += dt * (speed + turn * 0.3) / cfg.stride * TAU;
  const s = Math.sin(r.phase), c = Math.cos(r.phase);
  const A = (0.14 + 0.36 * gait) * move;
  const sp = Math.hypot(fwd, side);
  const fN = sp > 0.08 ? fwd / sp : 1, sN = sp > 0.08 ? side / sp : 0;
  const aim = smooth01(r.aimBlend);
  const crouch = cfg.crouch + 0.12 * aim;

  r.recoil *= Math.exp(-dt * 13);
  r.flinch *= Math.exp(-dt * 8);
  const fl = r.flinch;

  const leg = (hip, knee, ankle, ls, lc) => {
    const lift = Math.pow(Math.max(0, lc), 1.5);
    hip.rotation.x = -ls * A * fN - crouch;
    hip.rotation.z = ls * A * 0.55 * sN;
    knee.rotation.x = crouch * 1.9 + lift * A * 1.5;
    ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.9 - r.slopePitch;
    ankle.rotation.z = -hip.rotation.z;
  };
  leg(b.hipL, b.kneeL, b.ankleL, s, c);
  leg(b.hipR, b.kneeR, b.ankleR, -s, -c);
  const legDrop = 0.8 * (1 - Math.cos(Math.abs(s) * A * Math.max(Math.abs(fN), Math.abs(sN)))) + 0.8 * (1 - Math.cos(crouch)) * 0.9;
  b.pelvis.position.y = BONES[BI.pelvis][3] - legDrop + 0.012 * move * Math.abs(c) - fl * 0.03;
  b.pelvis.rotation.y = s * 0.08 * gait * (1 - aim * 0.7);
  b.pelvis.rotation.z = s * 0.03 * gait;

  // idle servo twitches / head scanning
  if ((r.twitchT -= dt) <= 0) {
    if (r.state === 'patrol') {
      r.twitchT = rand(0.5, 2.4);
      r.headYawT = Math.random() < 0.3 ? 0 : rand(-0.75, 0.75);
      r.headPitchT = rand(-0.12, 0.2);
    } else { r.twitchT = rand(0.25, 0.9); r.headYawT = rand(-0.5, 0.5); r.headPitchT = rand(-0.1, 0.1); }
    r.jitter = 1;
  }
  r.jitter *= Math.exp(-dt * 20);
  let hy = r.headYawT, hp = r.headPitchT;
  if (r.state === 'hunt' && (r.sees || time - r.lastSeen < 2)) { hy = r.aimYaw; hp = -r.aimPitch * 0.8; }
  else if (r.state === 'hunt') { hy = r.headYawT * 1.3; }
  const servo = 7 * dt;
  r.headYaw += clamp(hy - r.headYaw, -servo, servo);
  r.headPitch += clamp(hp - r.headPitch, -servo * 0.7, servo * 0.7);

  // spine: aim twist + walk sway + flinch + recoil (+ lean into slopes)
  const yawAim = r.aimYaw * aim;
  b.spine.rotation.y = yawAim * 0.85 - b.pelvis.rotation.y + s * 0.06 * gait * (1 - aim);
  b.spine.rotation.x = 0.05 + gait * 0.08 * cfg.lean - r.aimPitch * 0.25 * aim + fl * r.flinchZ * 0.45 - r.recoil * 0.05 + r.slopePitch * 0.35;
  b.spine.rotation.z = -s * 0.03 * gait - fl * r.flinchX * 0.35 + r.jitter * 0.01;
  b.head.rotation.y = clamp(r.headYaw - b.spine.rotation.y, -1, 1) + r.jitter * 0.03 * Math.sin(r.phase * 7 + r.id);
  b.head.rotation.x = r.headPitch - (b.spine.rotation.x - 0.05) * 0.6 + fl * r.flinchZ * 0.35;
  b.head.rotation.z = -fl * r.flinchX * 0.2;

  // arms
  const pitchArm = r.aimPitch - r.aimPitch * 0.25 * aim; // share taken by the spine
  const conv = Math.atan2(0.25, r.aimDist || 20);
  const yawRest = (r.aimYaw - yawAim * 0.85) * aim;
  // right (blaster) arm: low-ready → aim
  const rIdleX = -0.35 - s * A * 0.35, rIdleEl = -0.75;
  const rAimX = -Math.PI / 2 - pitchArm + 0.14;
  b.shoulderR.rotation.x = lerp(rIdleX, rAimX, aim) - r.recoil * cfg.kick - fl * 0.2;
  b.shoulderR.rotation.y = (conv + yawRest) * aim;
  b.shoulderR.rotation.z = lerp(-0.1, 0.05, aim);
  b.elbowR.rotation.x = lerp(rIdleEl, -0.14, aim) - r.recoil * 0.12;
  // left arm: swing → support grip under the blaster (analytic two-bone IK in spine space)
  const idleElL = -0.25 - Math.max(0, -s) * A * 0.6;
  _e.set(s * A * 0.9 + 0.05 - fl * 0.15, 0, 0.1, 'YXZ');
  _qa.setFromEuler(_e);
  if (aim > 0.001) {
    b.shoulderR.updateMatrix(); b.elbowR.updateMatrix();
    _v1.copy(SUPPORT_R).applyMatrix4(b.elbowR.matrix).applyMatrix4(b.shoulderR.matrix).sub(b.shoulderL.position);
    const bend = armIK(_v1, 0.281, 0.3, POLE_L, _qb);
    b.shoulderL.quaternion.copy(_qa).slerp(_qb, aim);
    b.elbowL.rotation.x = lerp(idleElL, -bend, aim);
  } else {
    b.shoulderL.quaternion.copy(_qa);
    b.elbowL.rotation.x = idleElL;
  }
  b.root.rotation.set(0, 0, 0);
  b.root.position.set(0, 0, 0);

  // visor: teal on patrol, amber when alerted, soft (≤0.6)
  const vm = r.visorMat;
  vm.emissive.setRGB(lerp(0.2, 1.0, r.alertLevel), lerp(0.72, 0.52, r.alertLevel), lerp(0.66, 0.16, r.alertLevel)).convertSRGBToLinear();
  vm.emissiveIntensity = lerp(0.5, 0.4, r.alertLevel) + (r.sees ? 0.06 : 0);
  syncMatrices(r);
}

// Power-down collapse. `sparks(pos)` emits a few trailing sparks.
export function animateDeath(r, dt, sparks) {
  const b = r.bones;
  r.flash = Math.max(0, r.flash - dt / 0.11);
  r.shellMat.emissiveIntensity = r.flash * 0.75;
  r.deathT += dt;
  const t = r.deathT;
  r.recoil = 0;
  // knees buckle
  const k = smooth01(t / 0.35);
  // topple (gravity-like ease-in), then a small settle bounce
  const tf = clamp((t - 0.28) / 0.75, 0, 1);
  let f = tf * tf;
  if (t > 1.03) f = 1 - 0.05 * Math.sin((t - 1.03) * 14) * Math.exp(-(t - 1.03) * 6);
  const straighten = smooth01((t - 0.35) / 0.6);
  const kneeB = lerp(1.15 * k, 0.25, straighten), hipB = lerp(-0.75 * k, -0.15, straighten);
  for (const L of ['L', 'R']) {
    b['hip' + L].rotation.set(hipB, 0, (L === 'L' ? 1 : -1) * 0.06 * k);
    b['knee' + L].rotation.x = kneeB;
    b['ankle' + L].rotation.set(-(hipB + kneeB) * 0.7 * (1 - f), 0, 0);
  }
  b.pelvis.position.y = BONES[BI.pelvis][3] - lerp(0.28 * k, 0.04, straighten);
  b.pelvis.rotation.set(0, 0, 0);
  b.spine.rotation.set(lerp(0.35 * k, 0.15, f) * (r.fallSign > 0 ? 1 : 0.4), 0, r.roll * 0.3 * k);
  b.head.rotation.set(0.45 * k * (1 - 0.5 * f), r.roll * 0.4, 0);
  b.shoulderR.rotation.set(lerp(-0.2 * k, -0.6 * r.fallSign, f), 0, -0.25 * k);
  b.elbowR.rotation.x = -0.3 * k;
  b.shoulderL.rotation.set(lerp(0.1 * k, -0.5 * r.fallSign, f), 0, 0.25 * k);
  b.elbowL.rotation.x = -0.4 * k;
  // tip around the toe (forward) or heel (backward) so the feet do not sink; the final angle follows
  // the slope in the fall direction (fallTilt, set at death) so the body lies on the hillside.
  const ang = r.fallSign * r.fallTilt * f;
  b.root.rotation.set(ang, 0, r.roll * f);
  const pz = r.fallSign > 0 ? 0.18 : -0.1;
  _v1.set(0, 0, pz); _v2.set(0, 0, pz).applyEuler(b.root.rotation);
  b.root.position.set(_v1.x - _v2.x, _v1.y - _v2.y + 0.07 * f, _v1.z - _v2.z);
  // power-down: visor flickers, then dark
  const vm = r.visorMat;
  if (t < 1.1) vm.emissiveIntensity = (Math.sin(t * 60) > 0.2 ? 0.45 : 0.08) * (1 - t / 1.1);
  else vm.emissiveIntensity = 0;
  syncMatrices(r);
  // a few trailing sparks from the neck/backpack
  if (r.dieSparkT > 0 && t < 1.6 && (r.dieSparkT -= dt) <= 0) {
    r.dieSparkT = rand(0.25, 0.5);
    b.spine.getWorldPosition(_v1); _v1.y += 0.25 * r.cfg.scale;
    sparks(_v1);
  }
}
