// Training robots: skinned primitive model (3 draw calls each), procedural animation, patrol /
// hunt AI with a lazily built nav graph, visible marker-blaster fire, hit reactions and power-down.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TOTAL = 5;
const RADIUS = 0.36, HEIGHT = 1.8;
const TAU = Math.PI * 2;

// Gameplay tuning.
const CFG = {
  hp: 100,
  viewDist: 35, huntViewDist: 48, fovHalfCos: Math.cos(THREE.MathUtils.degToRad(60)), senseNear: 3.5,
  losHz: 5,
  patrolSpeed: 1.3, chaseSpeed: 2.7, strafeSpeed: 1.6, retreatSpeed: 1.9,
  minRange: 8, maxRange: 18,
  reaction: 0.6,
  burst: [2, 4], burstGap: 0.14, burstCooldown: [0.95, 1.7],
  maxShooters: 3, shooterGap: 0.35,
  damage: 8,
  forget: 11,
  patrolRadius: 25,
};

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, TAU) - Math.PI;
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// Skeleton (bind pose, model space: feet at origin, facing +Z, robot's left = +X).
const BONES = [
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
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const bindPos = (i) => new THREE.Vector3(BONES[i][2], BONES[i][3], BONES[i][4]);

// Hit volumes, bind-space boxes attached to bones.
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
const MUZZLE_BIND = new THREE.Vector3(-0.29, 0.545, 0.085);

// ---------------------------------------------------------------------------------------------
// Geometry helpers.
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
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
    let u, v;
    const X = (px + w / 2) / w, Y = (py + h / 2) / h, Z = (pz + d / 2) / d;
    switch (face) {
      case 0: u = 1 - Z; v = Y; break;
      case 1: u = Z; v = Y; break;
      case 2: u = X; v = 1 - Z; break;
      case 3: u = X; v = Z; break;
      case 4: u = X; v = Y; break;
      default: u = 1 - X; v = Y;
    }
    const [u0, v0] = REGIONS[faceRegion(face)];
    uv.setXY(i, u0 + 0.01 + u * 0.48, v0 + 0.01 + v * 0.48);
  }
  return g;
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

function cylBetween(a, b, r, seg = 10, rTop = r) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rTop, r, len, seg, 1);
  _q.setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(_m4.compose(a.clone().add(b).multiplyScalar(0.5), _q, ONE));
  return remapUV(g, 'solid');
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sphere = (r, x, y, z, ws = 10, hs = 7) => remapUV(place(new THREE.SphereGeometry(r, ws, hs), x, y, z), 'solid');

const C = {
  white: 0xe6e5df, grey: 0xa3a8ad, orange: 0xef6a1e, dark: 0x3a3e44, darker: 0x24272b, rubber: 0x1b1c1e,
  gun: 0x4d545c, joint: 0x5b6168, visor: 0xffffff,
};

function buildRobotGeometry() {
  const parts = { shell: [], dark: [], visor: [] };
  const col = new THREE.Color();
  const add = (mat, g, bone, color) => {
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
  const solid = () => 'solid';

  // ---- pelvis
  add('dark', place(chamferBox(0.3, 0.14, 0.2, 0.035), 0, 0.95, 0), 'pelvis', C.dark);
  add('shell', place(chamferBox(0.24, 0.11, 0.05, 0.015, solid), 0, 0.93, 0.105, -0.12), 'pelvis', C.orange);
  add('shell', place(chamferBox(0.26, 0.1, 0.05, 0.015), 0, 0.94, -0.105, 0.1), 'pelvis', C.grey);
  add('shell', place(chamferBox(0.05, 0.12, 0.16, 0.015), 0.17, 0.93, 0), 'pelvis', C.grey);
  add('shell', place(chamferBox(0.05, 0.12, 0.16, 0.015), -0.17, 0.93, 0), 'pelvis', C.grey);

  // ---- spine / torso
  add('dark', cylBetween(V(0, 0.98, 0), V(0, 1.18, -0.01), 0.095, 12, 0.11), 'spine', C.darker);
  for (const y of [1.05, 1.11]) add('dark', cylBetween(V(0, y - 0.012, 0), V(0, y + 0.012, 0), 0.112, 12), 'spine', C.joint);
  add('shell', place(chamferBox(0.46, 0.36, 0.27, 0.055, (f) => (f === 4 ? 'chest' : f === 5 ? 'back' : 'generic')), 0, 1.34, 0.005), 'spine', C.white);
  add('shell', place(chamferBox(0.3, 0.07, 0.2, 0.025), 0, 1.53, -0.02), 'spine', C.grey);
  add('shell', place(chamferBox(0.012, 0.26, 0.1, 0.004, solid), 0.232, 1.33, 0.04), 'spine', C.orange);
  add('shell', place(chamferBox(0.012, 0.26, 0.1, 0.004, solid), -0.232, 1.33, 0.04), 'spine', C.orange);
  // backpack: power unit, two cells and vent fins
  add('dark', place(chamferBox(0.3, 0.27, 0.1, 0.025), 0, 1.33, -0.17), 'spine', C.dark);
  for (const x of [-0.08, 0.08]) add('shell', cylBetween(V(x, 1.22, -0.235), V(x, 1.44, -0.235), 0.036, 10), 'spine', C.grey);
  for (let i = 0; i < 4; i++) add('dark', place(new THREE.BoxGeometry(0.22, 0.012, 0.02), 0, 1.25 + i * 0.05, -0.225), 'spine', C.darker);

  // ---- head
  add('dark', cylBetween(V(0, 1.48, -0.01), V(0, 1.63, -0.01), 0.048, 10), 'head', C.joint);
  add('shell', place(chamferBox(0.24, 0.2, 0.25, 0.055), 0, 1.7, -0.005), 'head', C.white);
  add('shell', place(chamferBox(0.05, 0.02, 0.23, 0.008, solid), 0, 1.803, -0.01), 'head', C.orange);
  add('visor', place(chamferBox(0.2, 0.066, 0.05, 0.018), 0, 1.71, 0.11), 'head', C.visor);
  add('visor', place(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 12), -0.05, 1.71, 0.135, Math.PI / 2), 'head', C.visor);
  add('dark', place(chamferBox(0.225, 0.02, 0.045, 0.008), 0, 1.753, 0.107), 'head', C.darker);
  add('dark', place(chamferBox(0.15, 0.045, 0.04, 0.012), 0, 1.644, 0.11), 'head', C.darker);
  for (let i = 0; i < 3; i++) add('dark', place(new THREE.BoxGeometry(0.1, 0.005, 0.01), 0, 1.632 + i * 0.012, 0.131), 'head', C.joint);
  for (const s of [-1, 1]) {
    add('dark', place(new THREE.CylinderGeometry(0.048, 0.048, 0.045, 12), s * 0.125, 1.7, -0.02, 0, 0, Math.PI / 2), 'head', C.dark);
    add('shell', place(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 10), s * 0.127, 1.7, -0.02, 0, 0, Math.PI / 2), 'head', C.orange);
  }
  add('dark', cylBetween(V(0.09, 1.78, -0.07), V(0.1, 1.93, -0.09), 0.006, 5), 'head', C.darker);
  add('shell', sphere(0.013, 0.1, 1.935, -0.09, 6, 4), 'head', C.orange);

  // ---- arms
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    add('dark', sphere(0.075, s * 0.27, 1.43, 0), 'shoulder' + L, C.joint);
    add('shell', place(chamferBox(0.15, 0.12, 0.2, 0.04), s * 0.305, 1.47, 0, 0, 0, s * -0.12), 'shoulder' + L, C.white);
    add('shell', place(chamferBox(0.156, 0.03, 0.206, 0.012, solid), s * 0.305, 1.45, 0, 0, 0, s * -0.12), 'shoulder' + L, C.orange);
    add('shell', place(chamferBox(0.1, 0.2, 0.11, 0.028), s * 0.285, 1.29, 0), 'shoulder' + L, C.grey);
    add('dark', sphere(0.056, s * 0.29, 1.15, 0), 'elbow' + L, C.joint);
    add('shell', place(chamferBox(0.105, 0.22, 0.12, 0.032), s * 0.29, 1.005, 0), 'elbow' + L, C.white);
    add('shell', place(chamferBox(0.111, 0.026, 0.126, 0.012, solid), s * 0.29, 1.06, 0), 'elbow' + L, C.orange);
    add('dark', place(chamferBox(0.08, 0.09, 0.09, 0.02), s * 0.29, 0.85, 0.005), 'elbow' + L, C.dark);
  }
  // marker blaster, held along the right forearm (points down in bind pose, forward when aiming)
  add('dark', place(chamferBox(0.07, 0.3, 0.1, 0.018), -0.29, 0.8, 0.075), 'elbowR', C.gun);
  add('dark', place(chamferBox(0.05, 0.1, 0.05, 0.012), -0.29, 0.9, 0.02), 'elbowR', C.darker);
  add('dark', cylBetween(V(-0.29, 0.66, 0.085), V(-0.29, 0.57, 0.085), 0.019, 10), 'elbowR', C.darker);
  add('shell', cylBetween(V(-0.29, 0.585, 0.085), V(-0.29, 0.55, 0.085), 0.027, 12), 'elbowR', C.orange);
  add('dark', place(chamferBox(0.022, 0.07, 0.03, 0.006), -0.29, 0.84, 0.138), 'elbowR', C.darker);
  add('shell', place(chamferBox(0.074, 0.06, 0.104, 0.012, solid), -0.29, 0.72, 0.075), 'elbowR', C.orange);

  // ---- legs
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', x = s * 0.115;
    add('dark', sphere(0.07, x, 0.9, 0), 'hip' + L, C.joint);
    add('shell', place(chamferBox(0.14, 0.3, 0.16, 0.035), x + s * 0.005, 0.69, 0.005), 'hip' + L, C.white);
    add('shell', place(chamferBox(0.012, 0.22, 0.05, 0.004, solid), x + s * 0.077, 0.69, 0.02), 'hip' + L, C.orange);
    add('dark', sphere(0.06, x, 0.5, 0), 'knee' + L, C.joint);
    add('shell', place(chamferBox(0.1, 0.09, 0.05, 0.02), x, 0.49, 0.065), 'knee' + L, C.grey);
    add('dark', cylBetween(V(x, 0.47, 0), V(x, 0.12, 0), 0.045, 10), 'knee' + L, C.dark);
    add('shell', place(chamferBox(0.125, 0.27, 0.075, 0.025), x, 0.29, 0.035), 'knee' + L, C.white);
    add('shell', place(chamferBox(0.131, 0.026, 0.081, 0.01, solid), x, 0.37, 0.035), 'knee' + L, C.orange);
    add('dark', cylBetween(V(x, 0.45, -0.055), V(x, 0.16, -0.055), 0.017, 6), 'knee' + L, C.gun);
    add('dark', sphere(0.045, x, 0.1, 0), 'ankle' + L, C.joint);
    add('dark', place(chamferBox(0.13, 0.07, 0.28, 0.02), x, 0.036, 0.045), 'ankle' + L, C.rubber);
    add('shell', place(chamferBox(0.136, 0.055, 0.085, 0.02, solid), x, 0.06, 0.15), 'ankle' + L, C.orange);
    add('shell', place(chamferBox(0.11, 0.05, 0.1, 0.018), x, 0.085, -0.03), 'ankle' + L, C.grey);
  }

  const merged = mergeGeometries([mergeGeometries(parts.shell), mergeGeometries(parts.dark), mergeGeometries(parts.visor)], true);
  merged.computeBoundingBox();
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.1);
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Livery texture: generic panel (seams + screws), chest (number, panel lines, hazard band), back.
function makeLivery(num) {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  const speckle = (x0, y0, w, h, n) => {
    for (let i = 0; i < n; i++) {
      const v = 150 + Math.random() * 90 | 0;
      g.fillStyle = `rgba(${v},${v},${v - 6},${0.05 + Math.random() * 0.08})`;
      g.fillRect(x0 + Math.random() * w, y0 + Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
    }
    // soft scuffs
    for (let i = 0; i < 6; i++) {
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
  // generic (canvas top-left)
  speckle(0, 0, 256, 256, 500);
  seam(12, 12, 232, 232, 18);
  for (const [x, y] of [[30, 30], [226, 30], [30, 226], [226, 226]]) screw(x, y);
  // chest (canvas top-right) — drawn in face aspect 0.46 : 0.36
  const cx = 256;
  speckle(cx, 0, 256, 256, 600);
  seam(cx + 10, 10, 236, 236, 22);
  g.lineWidth = 3; g.strokeStyle = 'rgba(70,72,74,0.5)';
  g.beginPath(); g.moveTo(cx + 128, 10); g.lineTo(cx + 128, 150); g.stroke();
  g.beginPath(); g.moveTo(cx + 10, 150); g.lineTo(cx + 246, 150); g.stroke();
  // hazard band
  g.save(); g.beginPath(); g.rect(cx + 12, 164, 232, 50); g.clip();
  g.fillStyle = '#ee6a1f'; g.fillRect(cx, 160, 256, 60);
  g.fillStyle = '#f3f1ea';
  for (let x = -60; x < 280; x += 36) { g.beginPath(); g.moveTo(cx + x, 214); g.lineTo(cx + x + 18, 214); g.lineTo(cx + x + 68, 164); g.lineTo(cx + x + 50, 164); g.closePath(); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 2; g.strokeRect(cx + 12, 164, 232, 50);
  // number, compensated for the face aspect (u spans 0.46 m, v 0.36 m)
  g.save();
  g.translate(cx + 70, 88); g.scale(0.36 / 0.46 * 1.05, 1);
  g.fillStyle = '#2c3035'; g.font = 'bold 104px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num).padStart(2, '0'), 0, 4);
  g.restore();
  g.fillStyle = '#2c3035'; g.font = 'bold 17px Arial, Helvetica, sans-serif'; g.textAlign = 'center';
  g.fillText('TRAINING', cx + 190, 60); g.fillText('UNIT', cx + 190, 80);
  g.fillStyle = '#ee6a1f'; g.fillRect(cx + 160, 96, 60, 8);
  for (const [x, y] of [[cx + 26, 26], [cx + 230, 26], [cx + 26, 136], [cx + 230, 136]]) screw(x, y);
  // back (canvas bottom-left)
  speckle(0, 256, 256, 256, 500);
  seam(10, 266, 236, 236, 22);
  g.fillStyle = 'rgba(60,62,66,0.75)';
  for (let i = 0; i < 5; i++) g.fillRect(40, 300 + i * 16, 90, 6);
  g.fillStyle = '#2c3035'; g.font = 'bold 44px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num).padStart(2, '0'), 190, 330);
  g.fillStyle = '#ee6a1f'; g.fillRect(12, 440, 232, 22);
  // solid (bottom-right) stays plain white
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,250,235,1)');
  gr.addColorStop(0.25, 'rgba(255,214,150,0.85)');
  gr.addColorStop(0.6, 'rgba(255,150,70,0.25)');
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Pooled streaks (tracers + sparks) in a single additive InstancedMesh.
class Streaks {
  constructor(scene, cap = 160) {
    const g = new THREE.BufferGeometry();
    // two crossed quads along +Z (0..1), width 1; tail (z=0) dim, head (z=1) bright
    const p = [], col = [], idx = [];
    const quad = (ax, ay) => {
      const b = p.length / 3;
      p.push(-ax / 2, -ay / 2, 0, ax / 2, ay / 2, 0, ax / 2, ay / 2, 1, -ax / 2, -ay / 2, 1);
      col.push(0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 1, 1, 1, 1, 1, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    quad(1, 0); quad(0, 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cap = cap;
    this.items = [];
    this.free = [];
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }
  _new() {
    if (this.items.length >= this.cap) return null;
    const it = this.free.pop() || { p: new THREE.Vector3(), v: new THREE.Vector3(), dir: new THREE.Vector3() };
    this.items.push(it);
    return it;
  }
  tracer(from, to) {
    const it = this._new(); if (!it) return;
    it.kind = 0; it.p.copy(from); it.dir.subVectors(to, from);
    it.len = it.dir.length(); it.dir.divideScalar(it.len || 1);
    it.t = 0.35; it.speed = 150; it.streak = Math.min(3.2, it.len); it.w = 0.022; it.life = 1;
  }
  sparks(at, n, bias, speed = 4, hot = 1) {
    for (let i = 0; i < n; i++) {
      const it = this._new(); if (!it) return;
      it.kind = 1; it.p.copy(at);
      it.v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.35, 1.1));
      if (bias) it.v.addScaledVector(bias, speed * 0.6);
      it.max = it.life = rand(0.25, 0.6) * (0.6 + 0.4 * hot);
      it.w = rand(0.008, 0.014); it.hot = hot;
    }
  }
  clear() { while (this.items.length) this.free.push(this.items.pop()); this.mesh.count = 0; }
  update(dt) {
    const m = this.mesh, items = this.items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      let alive = true;
      if (it.kind === 0) {
        it.t += it.speed * dt;
        if (it.t - it.streak >= it.len) alive = false;
        else {
          const head = Math.min(it.t, it.len), tail = Math.max(0, it.t - it.streak);
          this._a.copy(it.p).addScaledVector(it.dir, tail);
          this._set(n++, this._a, it.dir, Math.max(0.05, head - tail), it.w, 0.85, 0.8, 0.68);
        }
      } else {
        it.life -= dt;
        if (it.life <= 0) alive = false;
        else {
          it.v.y -= 9.8 * dt;
          it.p.addScaledVector(it.v, dt);
          if (it.p.y < 0.01 && it.v.y < 0) { it.p.y = 0.01; it.v.y *= -0.35; it.v.x *= 0.6; it.v.z *= 0.6; }
          const sp = it.v.length();
          this._d.copy(it.v).divideScalar(sp || 1);
          const len = clamp(sp * 0.035, 0.02, 0.25);
          this._a.copy(it.p).addScaledVector(this._d, -len);
          const f = it.life / it.max;
          this._set(n++, this._a, this._d, len, it.w, 1.0 * f, (0.55 + 0.3 * f * it.hot) * f, 0.22 * f * f);
        }
      }
      if (!alive) { this.free.push(it); items[i] = items[items.length - 1]; items.pop(); }
    }
    m.count = n;
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
  _set(i, from, dir, len, w, r, g, b) {
    _q.setFromUnitVectors(Z_AXIS, dir);
    this._s.set(w, w, len);
    _m4.compose(from, _q, this._s);
    this.mesh.setMatrixAt(i, _m4);
    this.mesh.setColorAt(i, this._c.setRGB(r, g, b));
  }
}
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------------------------
// Tiny binary heap for A*.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------------------------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _hitP = new THREE.Vector3();
const _sensor = new THREE.Vector3(), _muz = new THREE.Vector3(), _aim = new THREE.Vector3();

export class EnemyManager {
  constructor({ scene, physics, audio, spawns, navPoints }) {
    this.scene = scene; this.physics = physics; this.audio = audio;
    this.spawns = spawns || []; this.navPoints = navPoints || [];
    this.total = TOTAL; this.remaining = TOTAL;
    this.list = [];
    this.time = 0;
    this.shooters = 0;
    this.lastBurstStart = -10;
    this.playerVel = new THREE.Vector3();
    this._pPrev = new THREE.Vector3(0, -1e4, 0);
    this._camera = null;

    this._buildNav();

    const geometry = buildRobotGeometry();
    this.geometry = geometry;
    this.triangles = geometry.index.count / 3;
    this.darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.55 });
    const flashTex = makeFlashTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, color: 0xffe0b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.streaks = new Streaks(scene);

    const boneInverses = BONES.map((b) => new THREE.Matrix4().makeTranslation(-b[2], -b[3], -b[4]));
    for (let i = 0; i < TOTAL; i++) this.list.push(this._createRobot(i, boneInverses));
    this.reset();
  }

  _createRobot(i, boneInverses) {
    const shellMat = new THREE.MeshStandardMaterial({
      map: makeLivery(i + 1), vertexColors: true, roughness: 0.46, metalness: 0.06, emissive: 0xffffff, emissiveIntensity: 0,
    });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b1a1d, roughness: 0.16, metalness: 0.3, emissive: 0x33b8ac, emissiveIntensity: 0.5 });
    const bones = BONES.map((b) => { const bone = new THREE.Bone(); bone.name = b[0]; return bone; });
    BONES.forEach((b, j) => {
      const parent = b[1];
      if (parent >= 0) {
        bones[j].position.set(b[2] - BONES[parent][2], b[3] - BONES[parent][3], b[4] - BONES[parent][4]);
        bones[parent].add(bones[j]);
      }
      if (/shoulder|spine|head/.test(b[0])) bones[j].rotation.order = 'YXZ';
    });
    const mesh = new THREE.SkinnedMesh(this.geometry, [shellMat, this.darkMat, visorMat]);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones, boneInverses.map((m) => m.clone())), new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.1);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.name = `robot${i + 1}`;
    group.add(mesh);
    this.scene.add(group);
    const flash = new THREE.Sprite(this.flashMat);
    flash.visible = false;
    flash.renderOrder = 3;
    this.scene.add(flash);

    const B = Object.fromEntries(BONES.map((b, j) => [b[0], bones[j]]));
    const hit = HITBOXES.map(([bone, part, mn, mx]) => {
      const o = bindPos(BI[bone]);
      return { bone: B[bone], part, box: new THREE.Box3(V(...mn).sub(o), V(...mx).sub(o)) };
    });
    return {
      id: i, group, mesh, bones: B, shellMat, visorMat, sprite: flash, hit,
      muzzleLocal: MUZZLE_BIND.clone().sub(bindPos(BI.elbowR)),
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), actVel: new THREE.Vector3(),
      target: new THREE.Vector3(), lastKnown: new THREE.Vector3(), alertPos: new THREE.Vector3(),
      stuckRef: new THREE.Vector3(), hitDir: new THREE.Vector3(),
      path: null, pathI: 0, pathGoal: new THREE.Vector3(),
    };
  }

  // -------------------------------------------------------------------------------------------
  reset() {
    this.time = 0; this.shooters = 0; this.lastBurstStart = -10;
    this.remaining = this.list.length;
    this.streaks.clear();
    const spawns = this.spawns.length ? this.spawns : [new THREE.Vector3()];
    this.list.forEach((r, i) => {
      const sp = spawns[i % spawns.length];
      r.pos.set(sp.x, sp.y || 0, sp.z);
      if (i >= spawns.length) r.pos.x += (i - spawns.length + 1) * 1.2;
      r.prev.copy(r.pos); r.vel.set(0, 0, 0); r.actVel.set(0, 0, 0);
      r.heading = Math.random() * TAU; r.desiredHeading = r.heading; r.turnRate = 0;
      r.hp = CFG.hp; r.alive = true; r.state = 'patrol';
      r.waitT = rand(0.2, 1.5) + i * 0.3; r.target.copy(r.pos); r.path = null; r.pathI = 0;
      r.stuckT = 0; r.stuckRef.copy(r.pos); r.stuckCount = 0;
      r.perceptT = i * 0.041; r.sees = false; r.lastSeen = -100; r.directOK = false;
      r.reactT = 0; r.burstLeft = 0; r.shotT = 0; r.nextBurst = rand(0.3, 1.2); r.firstBurst = true; r.hasToken = false;
      r.strafeDir = Math.random() < 0.5 ? 1 : -1; r.strafeT = rand(1.2, 2.6); r.prefRange = rand(10, 15);
      r.forcePathT = 0; r.alertIn = -1; r.searchT = 0; r.giveUpT = 0; r.lostT = 0;
      r.aimBlend = 0; r.alertLevel = 0; r.aimYaw = 0; r.aimPitch = 0; r.aimDist = 20;
      r.phase = Math.random() * TAU; r.recoil = 0; r.flinch = 0; r.flinchX = 0; r.flinchZ = 0; r.flash = 0; r.staggerT = 0;
      r.headYaw = 0; r.headPitch = 0; r.headYawT = 0; r.headPitchT = 0; r.twitchT = rand(0.3, 1.5); r.jitter = 0;
      r.deathT = -1; r.fallSign = 1; r.roll = 0; r.dieSparkT = 0;
      r.flashT = 0; r.sprite.visible = false;
      r.visorMat.emissiveIntensity = 0.5; r.visorMat.emissive.setHex(0x33b8ac);
      r.shellMat.emissiveIntensity = 0;
      const b = r.bones;
      for (const k in b) { b[k].rotation.set(0, 0, 0); b[k].position.copy(bindPos(BI[k])).sub(BONES[BI[k]][1] >= 0 ? bindPos(BONES[BI[k]][1]) : V(0, 0, 0)); }
      r.group.visible = true;
      this._animate(r, 0);
      r.group.updateMatrixWorld(true);
    });
  }

  // -------------------------------------------------------------------------------------------
  update(dt, ctx) {
    dt = Math.min(dt, 0.1);
    if (dt <= 0) return;
    this.time += dt;
    if (!this._camera) this._camera = this.scene.children.find((o) => o.isCamera) || null;
    const pp = ctx.playerPos;
    const valid = !!ctx.playerAlive && pp.y > -100;
    if (this._pPrev.distanceToSquared(pp) < 25) {
      _v1.subVectors(pp, this._pPrev).divideScalar(dt); _v1.y = 0;
      this.playerVel.lerp(_v1, Math.min(1, dt * 8));
    } else this.playerVel.set(0, 0, 0);
    this._pPrev.copy(pp);

    for (const r of this.list) if (r.alive) this._think(r, dt, ctx, valid);
    for (const r of this.list) {
      this._animate(r, dt);
      r.group.updateMatrixWorld(true);
      if (r.flashT > 0 && (r.flashT -= dt) <= 0) r.sprite.visible = false;
    }
    this.streaks.update(dt);
  }

  _think(r, dt, ctx, valid) {
    const P = this.physics;
    // ---- perception, throttled to ~5 Hz per robot (staggered)
    r.perceptT -= dt;
    if (r.perceptT <= 0) {
      r.perceptT += 1 / CFG.losHz * rand(0.9, 1.1);
      this._perceive(r, ctx, valid);
    }
    if (!valid) {
      r.sees = false;
      if (r.state === 'hunt' && (r.giveUpT += dt) > 1.5) this._toPatrol(r);
    } else r.giveUpT = 0;

    if (r.state === 'patrol' && r.alertIn > 0 && (r.alertIn -= dt) <= 0) {
      r.alertIn = -1;
      if (valid) { r.lastKnown.copy(r.alertPos); r.lastSeen = this.time - 2; this._enterHunt(r, false); }
    }

    r.reactT -= dt; r.staggerT -= dt; r.forcePathT -= dt; r.nextBurst -= dt;
    const want = _v2.set(0, 0, 0);
    let speed = 0, faceTarget = null;

    if (r.state === 'patrol') {
      if (r.waitT > 0) {
        r.waitT -= dt;
        if (r.waitT <= 0) this._pickPatrol(r);
      } else {
        speed = CFG.patrolSpeed;
        const reached = this._steer(r, r.target, want);
        if (reached < 0.9) { r.waitT = rand(0.6, 2.6); r.path = null; }
      }
    } else if (r.state === 'hunt') {
      _v1.subVectors(r.lastKnown, r.pos); _v1.y = 0;
      const d = _v1.length();
      const sinceSeen = this.time - r.lastSeen;
      if (r.sees || sinceSeen < 0.6) {
        faceTarget = r.lastKnown;
        r.searchT = 0;
        if ((r.strafeT -= dt) <= 0) { r.strafeT = rand(1.3, 3.0); if (Math.random() < 0.65) r.strafeDir *= -1; }
        const dir = _v1.divideScalar(d || 1);
        if (d > r.prefRange + 4 && d > CFG.minRange) {
          speed = CFG.chaseSpeed;
          if (r.forcePathT > 0) this._steer(r, r.lastKnown, want); else want.copy(dir);
        } else if (d < Math.max(CFG.minRange, r.prefRange - 4)) {
          speed = CFG.retreatSpeed;
          want.set(-dir.x + dir.z * r.strafeDir * 0.6, 0, -dir.z - dir.x * r.strafeDir * 0.6).normalize();
        } else {
          speed = r.burstLeft > 0 ? CFG.strafeSpeed * 0.55 : CFG.strafeSpeed;
          want.set(dir.z * r.strafeDir, 0, -dir.x * r.strafeDir);
        }
      } else if (sinceSeen > CFG.forget) {
        this._toPatrol(r);
      } else if (d > 1.4 && r.searchT === 0) {
        // go to the last known position
        speed = CFG.chaseSpeed * 0.9;
        this._steer(r, r.lastKnown, want);
      } else {
        // arrived: look around, then give up
        r.searchT += dt;
        r.desiredHeading += dt * 1.1 * r.strafeDir;
        if (r.searchT > 3.5) this._toPatrol(r);
      }
    }

    // separation from other robots and from the player
    for (const o of this.list) {
      if (o === r || !o.alive) continue;
      const dx = r.pos.x - o.pos.x, dz = r.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 2.6 && d2 > 1e-6) {
        const d = Math.sqrt(d2), f = (1.62 - d) / 1.62 * 1.6;
        want.x += dx / d * f; want.z += dz / d * f;
        if (speed < 0.8) speed = 0.8;
      }
    }
    if (valid) {
      const dx = r.pos.x - ctx.playerPos.x, dz = r.pos.z - ctx.playerPos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-6) { const d = Math.sqrt(d2); want.x += dx / d * 1.5; want.z += dz / d * 1.5; speed = Math.max(speed, 1.5); }
    }
    const wl = Math.hypot(want.x, want.z);
    if (wl > 1) want.multiplyScalar(1 / wl);
    want.multiplyScalar(speed * (r.staggerT > 0 ? 0.15 : 1));

    // accelerate toward the desired velocity, move with collisions
    const acc = Math.min(1, dt * 6);
    r.vel.x += (want.x - r.vel.x) * acc; r.vel.z += (want.z - r.vel.z) * acc;
    r.prev.copy(r.pos);
    _v1.set(r.vel.x * dt, 0, r.vel.z * dt);
    P.moveCircle(r.pos, _v1, RADIUS, HEIGHT);
    const gy = P.groundHeight(r.pos.x, r.pos.z, RADIUS * 0.8, r.pos.y);
    r.pos.y = gy > r.pos.y ? lerp(r.pos.y, gy, Math.min(1, dt * 12)) : Math.max(gy, r.pos.y - dt * 4);
    _v1.subVectors(r.pos, r.prev).divideScalar(dt); _v1.y = 0;
    r.actVel.lerp(_v1, Math.min(1, dt * 10));

    // stuck detection
    if (wl > 0.2 && speed > 0.5) {
      r.stuckT += dt;
      if (r.stuckT > 1.1) {
        const moved = Math.hypot(r.pos.x - r.stuckRef.x, r.pos.z - r.stuckRef.z);
        if (moved < 0.3 * speed) this._onStuck(r);
        else r.stuckCount = 0;
        r.stuckT = 0; r.stuckRef.copy(r.pos);
      }
    } else { r.stuckT = 0; r.stuckRef.copy(r.pos); }

    // heading
    if (faceTarget) r.desiredHeading = Math.atan2(faceTarget.x - r.pos.x, faceTarget.z - r.pos.z);
    else if (Math.hypot(r.vel.x, r.vel.z) > 0.35) r.desiredHeading = Math.atan2(r.vel.x, r.vel.z);
    const diff = wrapAngle(r.desiredHeading - r.heading);
    const maxTurn = 4.2 * dt;
    const step = clamp(diff * Math.min(1, dt * 7), -maxTurn, maxTurn);
    r.heading = wrapAngle(r.heading + step);
    r.turnRate = lerp(r.turnRate, step / dt, Math.min(1, dt * 10));

    // aim solution (spine yaw relative to heading + pitch) toward the player's chest / last known pos
    const hunting = r.state === 'hunt';
    if (hunting) {
      _aim.copy(r.lastKnown); _aim.y = (r.sees ? ctx.playerEye.y - 0.45 : r.lastKnown.y + 1.2);
      _sensor.set(r.pos.x, r.pos.y + 1.43, r.pos.z);
      const dx = _aim.x - _sensor.x, dz = _aim.z - _sensor.z, h = Math.hypot(dx, dz);
      r.aimYaw = lerp(r.aimYaw, clamp(wrapAngle(Math.atan2(dx, dz) - r.heading), -0.9, 0.9), Math.min(1, dt * 10));
      r.aimPitch = lerp(r.aimPitch, clamp(Math.atan2(_aim.y - _sensor.y, h), -0.7, 0.7), Math.min(1, dt * 8));
      r.aimDist = Math.max(2, h);
    } else { r.aimYaw = lerp(r.aimYaw, 0, Math.min(1, dt * 4)); r.aimPitch = lerp(r.aimPitch, 0, Math.min(1, dt * 4)); }
    const aimTarget = hunting ? (r.sees || this.time - r.lastSeen < 1.5 ? 1 : 0.55) : 0;
    r.aimBlend += clamp(aimTarget - r.aimBlend, -dt * 2.5, dt * 4);
    r.alertLevel += clamp((hunting ? 1 : 0) - r.alertLevel, -dt * 0.5, dt * 3);

    // ---- shooting (bursts, shared token so they do not all fire at once)
    if (r.burstLeft > 0) {
      if (!r.sees || !valid) this._endBurst(r, rand(0.5, 1.0));
      else if ((r.shotT -= dt) <= 0) {
        this._fire(r, ctx);
        r.shotT = CFG.burstGap * rand(0.85, 1.2);
        if (--r.burstLeft <= 0) this._endBurst(r, rand(...CFG.burstCooldown));
      }
    } else if (valid && r.sees && r.reactT <= 0 && r.nextBurst <= 0 && r.aimBlend > 0.85 && Math.abs(r.aimYaw) < 0.6
      && r.staggerT <= 0 && this.shooters < CFG.maxShooters && this.time - this.lastBurstStart > CFG.shooterGap && r.aimDist < 45) {
      r.burstLeft = CFG.burst[0] + Math.floor(Math.random() * (CFG.burst[1] - CFG.burst[0] + 1));
      r.shotT = 0; r.hasToken = true; this.shooters++;
      this.lastBurstStart = this.time;
    }
  }

  _endBurst(r, cooldown) {
    r.burstLeft = 0;
    if (r.hasToken) { r.hasToken = false; this.shooters = Math.max(0, this.shooters - 1); }
    r.nextBurst = cooldown;
    r.firstBurst = false;
  }

  _perceive(r, ctx, valid) {
    const P = this.physics;
    const wasSeeing = r.sees;
    r.sees = false;
    if (valid) {
      _sensor.set(r.pos.x, r.pos.y + 1.7, r.pos.z);
      const dx = ctx.playerEye.x - _sensor.x, dy = ctx.playerEye.y - _sensor.y, dz = ctx.playerEye.z - _sensor.z;
      const d = Math.hypot(dx, dy, dz), h = Math.hypot(dx, dz) || 1;
      const hunting = r.state === 'hunt';
      if (d < (hunting ? CFG.huntViewDist : CFG.viewDist)) {
        const cosA = (dx * Math.sin(r.heading) + dz * Math.cos(r.heading)) / h;
        const inCone = hunting || d < CFG.senseNear || cosA > CFG.fovHalfCos;
        if (inCone && P.lineOfSight(_sensor, ctx.playerEye)) r.sees = true;
      }
    }
    if (r.sees) {
      if (!wasSeeing && this.time - r.lastSeen > 1.2) r.reactT = Math.max(r.reactT, CFG.reaction + rand(0, 0.3));
      else if (!wasSeeing) r.reactT = Math.max(r.reactT, 0.25);
      r.lastSeen = this.time;
      r.lastKnown.set(ctx.playerPos.x, r.pos.y, ctx.playerPos.z);
      if (r.state !== 'hunt') this._enterHunt(r, true);
    } else if (r.state === 'hunt' || r.state === 'patrol') {
      // direct-walk check toward the current goal (cheap: only when not following LOS to the player)
      const goal = r.state === 'hunt' ? r.lastKnown : r.target;
      r.directOK = this._walkable(r.pos, goal);
    }
  }

  _enterHunt(r, sighted) {
    const wasPatrol = r.state === 'patrol';
    r.state = 'hunt'; r.path = null; r.searchT = 0; r.alertIn = -1; r.waitT = 0;
    r.prefRange = rand(10, 15);
    if (wasPatrol) {
      r.firstBurst = true;
      this._sound('robotAlert', r.pos, sighted ? 0.9 : 0.6);
      // alert nearby patrolling robots, staggered so they do not all engage at once
      let k = 0;
      for (const o of this.list) {
        if (o === r || !o.alive || o.state !== 'patrol' || o.alertIn > 0) continue;
        if (o.pos.distanceTo(r.pos) < 24) { o.alertIn = 1.4 + k++ * 1.1 + rand(0, 1.4); o.alertPos.copy(r.lastKnown); }
      }
    }
  }

  _toPatrol(r) {
    if (r.hasToken || r.burstLeft) this._endBurst(r, 1);
    r.state = 'patrol'; r.sees = false; r.path = null; r.waitT = rand(0.5, 1.5); r.searchT = 0; r.giveUpT = 0;
  }

  _onStuck(r) {
    r.stuckCount++;
    r.path = null;
    if (r.state === 'patrol') { r.waitT = 0.3; r.target.copy(r.pos); }
    else { r.strafeDir *= -1; r.forcePathT = 3; r.directOK = false; if (r.stuckCount > 3 && !r.sees) { r.searchT = 0.01; r.stuckCount = 0; } }
  }

  // Sets `out` to a unit direction toward goal (directly or along an A* path); returns distance to goal.
  _steer(r, goal, out) {
    const dx = goal.x - r.pos.x, dz = goal.z - r.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { out.set(0, 0, 0); return d; }
    if (r.directOK && r.forcePathT <= 0) { out.set(dx / d, 0, dz / d); return d; }
    if (!r.path || r.pathGoal.distanceToSquared(goal) > 4) {
      r.path = this._plan(r.pos, goal); r.pathI = 0; r.pathGoal.copy(goal);
      if (!r.path) { r.path = []; }
    }
    // skip waypoints that are already reached
    while (r.pathI < r.path.length) {
      const n = this.navPoints[r.path[r.pathI]];
      if (Math.hypot(n.x - r.pos.x, n.z - r.pos.z) < 0.9) r.pathI++; else break;
    }
    const wp = r.pathI < r.path.length ? this.navPoints[r.path[r.pathI]] : goal;
    const wx = wp.x - r.pos.x, wz = wp.z - r.pos.z, wd = Math.hypot(wx, wz) || 1;
    out.set(wx / wd, 0, wz / wd);
    return d;
  }

  // -------------------------------------------------------------------------------------------
  // Navigation: spatial hash over navPoints, lazily computed graph edges, A*.
  _buildNav() {
    const pts = this.navPoints;
    this.navCell = 4;
    this.navHash = new Map();
    pts.forEach((p, i) => {
      const k = this._navKey(Math.floor(p.x / this.navCell), Math.floor(p.z / this.navCell));
      let l = this.navHash.get(k); if (!l) this.navHash.set(k, l = []); l.push(i);
    });
    this.navEdges = new Array(pts.length).fill(null);
    this._g = new Float32Array(pts.length);
    this._from = new Int32Array(pts.length);
    this._seen = new Uint32Array(pts.length);
    this._stamp = 0;
  }
  _navKey(x, z) { return x * 7919 + z * 104729; }
  _navQuery(x, z, rad, out = []) {
    out.length = 0;
    const c = this.navCell, x0 = Math.floor((x - rad) / c), x1 = Math.floor((x + rad) / c), z0 = Math.floor((z - rad) / c), z1 = Math.floor((z + rad) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const l = this.navHash.get(this._navKey(i, j));
      if (l) for (const k of l) { const p = this.navPoints[k]; if ((p.x - x) ** 2 + (p.z - z) ** 2 <= rad * rad) out.push(k); }
    }
    return out;
  }
  _edges(i) {
    let e = this.navEdges[i];
    if (e) return e;
    e = this.navEdges[i] = [];
    const p = this.navPoints[i];
    for (const j of this._navQuery(p.x, p.z, 4.6, [])) {
      if (j === i) continue;
      const q = this.navPoints[j];
      const known = this.navEdges[j];
      if (known ? known.includes(i) : this._walkable(p, q)) e.push(j);
    }
    return e;
  }
  // Clear walking corridor between two feet positions (knee height + both shoulders).
  _walkable(a, b) {
    const P = this.physics;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    const px = -dz / d * 0.3, pz = dx / d * 0.3;
    _v3.set(a.x, 0.55, a.z); _v4.set(b.x, 0.55, b.z);
    if (!P.lineOfSight(_v3, _v4)) return false;
    _v3.set(a.x + px, 1.1, a.z + pz); _v4.set(b.x + px, 1.1, b.z + pz);
    if (!P.lineOfSight(_v3, _v4)) return false;
    _v3.set(a.x - px, 1.1, a.z - pz); _v4.set(b.x - px, 1.1, b.z - pz);
    return P.lineOfSight(_v3, _v4);
  }
  _nearestNode(pos) {
    const c = this._navQuery(pos.x, pos.z, 6, []);
    c.sort((a, b) => this.navPoints[a].distanceToSquared(pos) - this.navPoints[b].distanceToSquared(pos));
    for (let k = 0; k < Math.min(c.length, 6); k++) if (this._walkable(pos, this.navPoints[c[k]])) return c[k];
    if (c.length) return c[0];
    let best = -1, bd = Infinity;
    this.navPoints.forEach((p, i) => { const d = p.distanceToSquared(pos); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  _plan(from, to) {
    if (!this.navPoints.length) return null;
    const s = this._nearestNode(from), g = this._nearestNode(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return [g];
    const pts = this.navPoints, G = this._g, F = this._from, seen = this._seen, stamp = ++this._stamp;
    const heap = new Heap();
    G[s] = 0; F[s] = -1; seen[s] = stamp; heap.push(pts[s].distanceTo(pts[g]), s);
    let found = false, it = 0;
    while (heap.size && it++ < 1500) {
      const i = heap.pop();
      if (i === g) { found = true; break; }
      for (const j of this._edges(i)) {
        const ng = G[i] + pts[i].distanceTo(pts[j]);
        if (seen[j] !== stamp || ng < G[j]) {
          seen[j] = stamp; G[j] = ng; F[j] = i;
          heap.push(ng + pts[j].distanceTo(pts[g]), j);
        }
      }
    }
    if (!found) return null;
    const path = [];
    for (let i = g; i >= 0; i = F[i]) path.push(i);
    path.reverse();
    return path;
  }

  _pickPatrol(r) {
    const cands = this._navQuery(r.pos.x, r.pos.z, CFG.patrolRadius, []);
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    let best = null, bestScore = -Infinity;
    for (let n = 0; n < 14 && cands.length; n++) {
      const k = cands[Math.floor(Math.random() * cands.length)];
      const p = this.navPoints[k];
      const dx = p.x - r.pos.x, dz = p.z - r.pos.z, d = Math.hypot(dx, dz);
      if (d < 6) continue;
      let score = Math.random() * 2 + (dx * fx + dz * fz) / d * 1.2 + Math.min(d, 18) / 18;
      for (const o of this.list) if (o !== r && o.alive && o.target.distanceToSquared(p) < 36) score -= 2;
      if (score <= bestScore) continue;
      if (!this._walkable(r.pos, p)) continue;
      best = p; bestScore = score;
    }
    if (best) { r.target.copy(best); r.directOK = true; }
    else if (this.navPoints.length) {
      // nothing in direct view: walk along the nav graph to a random point
      r.target.copy(cands.length ? this.navPoints[cands[Math.floor(Math.random() * cands.length)]] : this.navPoints[Math.floor(Math.random() * this.navPoints.length)]);
      r.directOK = false;
    }
    r.path = null; r.stuckT = 0; r.stuckRef.copy(r.pos);
  }

  // -------------------------------------------------------------------------------------------
  _muzzleWorld(r, out) { return out.copy(r.muzzleLocal).applyMatrix4(r.bones.elbowR.matrixWorld); }

  _fire(r, ctx) {
    const P = this.physics;
    const muzzle = this._muzzleWorld(r, _muz);
    const chest = _aim.set(ctx.playerEye.x, ctx.playerEye.y - 0.45, ctx.playerEye.z);
    const d = muzzle.distanceTo(chest);
    let p = clamp(0.84 - 0.022 * d, 0.12, 0.72);
    const ps = Math.hypot(this.playerVel.x, this.playerVel.z);
    if (ps > 2.5) p *= 0.72;
    if (r.firstBurst) p *= 0.7;
    if (Math.hypot(r.actVel.x, r.actVel.z) > 0.9) p *= 0.9;
    const end = _v1;
    let hit = Math.random() < p;
    if (hit) {
      end.copy(chest).add(_v2.set(rand(-0.15, 0.15), rand(-0.35, 0.3), rand(-0.15, 0.15)));
      if (!P.lineOfSight(muzzle, end)) hit = false;
    }
    if (hit) {
      ctx.onPlayerHit(CFG.damage, muzzle.clone());
    } else {
      // miss: deviate around the player and end the tracer on the world
      const dir = _v2.subVectors(chest, muzzle).normalize();
      const u = _v3.set(rand(-1, 1), rand(-1, 0.6), rand(-1, 1));
      u.addScaledVector(dir, -u.dot(dir)).normalize();
      dir.addScaledVector(u, rand(0.55, 1.6) / Math.max(d, 1)).normalize();
      const w = P.raycast(muzzle, dir, 90);
      if (w) {
        end.copy(w.point);
        if (w.distance < 70) this.streaks.sparks(_v4.copy(w.point).addScaledVector(w.normal, 0.03), 3, w.normal, 2.2, 0.6);
      } else end.copy(muzzle).addScaledVector(dir, 90);
    }
    this.streaks.tracer(muzzle, end);
    r.sprite.position.copy(muzzle);
    r.sprite.scale.setScalar(rand(0.16, 0.24));
    r.sprite.material.rotation = Math.random() * TAU;
    r.sprite.visible = true; r.flashT = 0.06;
    r.recoil = 1;
    this._sound('robotShot', muzzle, 0.85, rand(0.94, 1.06));
  }

  _sound(name, at, vol = 1, rate = 1) {
    const a = this.audio;
    if (!a || !a.play) return;
    let pan = 0, v = vol;
    const cam = this._camera;
    if (cam) {
      cam.getWorldPosition(_v3);
      const dx = at.x - _v3.x, dz = at.z - _v3.z, d = Math.hypot(dx, dz) || 1;
      v *= clamp(1.15 - d / 55, 0.08, 1);
      _v4.set(1, 0, 0).applyQuaternion(cam.quaternion);
      pan = clamp((dx * _v4.x + dz * _v4.z) / d, -1, 1) * 0.8;
    }
    try { a.play(name, { volume: v, pan, rate }); } catch { /* audio optional */ }
  }

  // -------------------------------------------------------------------------------------------
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const r of this.list) {
      if (!r.alive) continue;
      // broad phase: sphere around the robot
      _v1.set(r.pos.x, r.pos.y + 0.95, r.pos.z).sub(origin);
      const tc = _v1.dot(dir);
      if (tc < -1.3 || tc > maxDist + 1.3) continue;
      if (_v1.lengthSq() - tc * tc > 1.3 * 1.3) continue;
      for (const h of r.hit) {
        _inv.copy(h.bone.matrixWorld).invert();
        _ray.origin.copy(origin).applyMatrix4(_inv);
        _ray.direction.copy(dir).transformDirection(_inv);
        if (!_ray.intersectBox(h.box, _hitP)) continue;
        const dist = _hitP.distanceTo(_ray.origin);
        if (dist > maxDist || (best && dist >= best.distance)) continue;
        // face normal in bone space
        const b = h.box, n = _v2.set(0, 0, 0);
        let m = Infinity;
        for (let a = 0; a < 3; a++) {
          const lo = Math.abs(_hitP.getComponent(a) - b.min.getComponent(a)), hi = Math.abs(_hitP.getComponent(a) - b.max.getComponent(a));
          if (lo < m) { m = lo; n.set(0, 0, 0).setComponent(a, -1); }
          if (hi < m) { m = hi; n.set(0, 0, 0).setComponent(a, 1); }
        }
        const normal = n.clone().transformDirection(h.bone.matrixWorld);
        best = {
          enemy: r, point: origin.clone().addScaledVector(dir, dist), normal, distance: dist, part: h.part,
          dir: dir.clone(), origin: origin.clone(),
        };
      }
    }
    return best;
  }

  damage(hit, amount) {
    const r = hit && hit.enemy;
    if (!r || !r.alive) return { killed: false };
    r.hp -= amount;
    const dir = r.hitDir.copy(hit.dir || _v1.copy(hit.normal).negate());
    dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
    const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
    r.flinchZ = dir.x * sh + dir.z * ch;
    r.flinchX = dir.x * ch - dir.z * sh;
    r.flinch = hit.part === 'head' ? 1.3 : 1;
    r.flash = 1;
    if (hit.point) this.streaks.sparks(hit.point, 4, hit.normal, 3, 0.8);
    if (r.hp <= 0) { this._die(r, dir); return { killed: true }; }
    r.staggerT = 0.28;
    this.physics.moveCircle(r.pos, _v1.copy(dir).multiplyScalar(0.12), RADIUS, HEIGHT);
    if (r.burstLeft > 0) r.shotT = Math.max(r.shotT, 0.3);
    this._sound('robotHurt', r.pos, 0.8, rand(0.95, 1.08));
    // being shot always alerts; turn toward the shooter
    if (hit.origin) r.lastKnown.set(hit.origin.x, r.pos.y, hit.origin.z);
    else r.lastKnown.copy(r.pos).addScaledVector(dir, -10);
    if (r.state !== 'hunt') {
      r.lastSeen = this.time - 0.2;
      this._enterHunt(r, false);
      r.reactT = Math.max(r.reactT, 0.5);
    } else if (!r.sees) r.lastSeen = Math.max(r.lastSeen, this.time - 0.2);
    return { killed: false };
  }

  _die(r, dir) {
    r.alive = false; r.hp = 0; r.state = 'dead'; r.sees = false;
    if (r.hasToken || r.burstLeft) this._endBurst(r, 99);
    this.remaining = Math.max(0, this.remaining - 1);
    r.deathT = 0; r.dieSparkT = 0.25;
    r.fallSign = r.flinchZ >= 0 ? 1 : -1;
    r.roll = rand(-0.35, 0.35) + r.flinchX * 0.25;
    r.vel.set(0, 0, 0); r.actVel.set(0, 0, 0);
    r.sprite.visible = false;
    _v1.set(r.pos.x, r.pos.y + 1.35, r.pos.z);
    this.streaks.sparks(_v1, 22, dir, 4.5, 1);
    this._sound('robotDie', r.pos, 1);
  }

  // -------------------------------------------------------------------------------------------
  // Procedural animation.
  _animate(r, dt) {
    const b = r.bones;
    r.flash = Math.max(0, r.flash - dt / 0.11);
    r.shellMat.emissiveIntensity = r.flash * 0.75;
    if (!r.alive) { this._animateDeath(r, dt); return; }

    const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
    const vx = r.actVel.x, vz = r.actVel.z, speed = Math.hypot(vx, vz);
    const fwd = vx * sh + vz * ch, side = vx * ch - vz * sh;
    const turn = Math.abs(r.turnRate);
    const move = Math.min(1, speed / 0.35 + turn * 0.25);
    const gait = clamp(speed / 2.7 + turn * 0.08, 0, 1);
    r.phase += dt * (speed + turn * 0.3) / 1.45 * TAU;
    const s = Math.sin(r.phase), c = Math.cos(r.phase);
    const A = (0.14 + 0.36 * gait) * move;
    const fN = speed > 0.08 ? fwd / speed : 1, sN = speed > 0.08 ? side / speed : 0;
    const aim = smooth01(r.aimBlend);
    const crouch = 0.1 + 0.12 * aim;

    r.recoil *= Math.exp(-dt * 13);
    r.flinch *= Math.exp(-dt * 8);
    const fl = r.flinch;

    const leg = (hip, knee, ankle, ls, lc) => {
      const lift = Math.pow(Math.max(0, lc), 1.5);
      hip.rotation.x = -ls * A * fN - crouch;
      hip.rotation.z = ls * A * 0.55 * sN;
      knee.rotation.x = crouch * 1.9 + lift * A * 1.5;
      ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.9;
      ankle.rotation.z = -hip.rotation.z;
      return Math.cos(Math.abs(ls) * A) ; // leg height factor
    };
    leg(b.hipL, b.kneeL, b.ankleL, s, c);
    leg(b.hipR, b.kneeR, b.ankleR, -s, -c);
    const legDrop = 0.8 * (1 - Math.cos(Math.abs(s) * A * Math.max(Math.abs(fN), Math.abs(sN)))) + 0.8 * (1 - Math.cos(crouch)) * 0.9;
    b.pelvis.position.y = BONES[BI.pelvis][3] - legDrop + 0.012 * move * Math.abs(c) - fl * 0.03;
    b.pelvis.position.x = -side * 0.0;
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
    if (r.state === 'hunt' && (r.sees || this.time - r.lastSeen < 2)) { hy = r.aimYaw; hp = -r.aimPitch * 0.8; }
    else if (r.state === 'hunt') { hy = r.headYawT * 1.3; }
    const servo = 7 * dt;
    r.headYaw += clamp(hy - r.headYaw, -servo, servo);
    r.headPitch += clamp(hp - r.headPitch, -servo * 0.7, servo * 0.7);

    // spine: aim twist + walk sway + flinch + recoil
    const yawAim = r.aimYaw * aim;
    b.spine.rotation.y = yawAim * 0.85 - b.pelvis.rotation.y + s * 0.06 * gait * (1 - aim);
    b.spine.rotation.x = 0.05 + gait * 0.08 - r.aimPitch * 0.25 * aim + fl * r.flinchZ * 0.45 - r.recoil * 0.05;
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
    b.shoulderR.rotation.x = lerp(rIdleX, rAimX, aim) - r.recoil * 0.32 - fl * 0.2;
    b.shoulderR.rotation.y = (conv + yawRest) * aim;
    b.shoulderR.rotation.z = lerp(-0.1, 0.05, aim);
    b.elbowR.rotation.x = lerp(rIdleEl, -0.14, aim) - r.recoil * 0.12;
    // left arm: swing → support grip under the blaster
    b.shoulderL.rotation.x = lerp(s * A * 0.9 + 0.05, -1.2 - pitchArm * 0.9, aim) - fl * 0.15;
    b.shoulderL.rotation.y = lerp(0, -0.55, aim);
    b.shoulderL.rotation.z = lerp(0.1, -0.2, aim);
    b.elbowL.rotation.x = lerp(-0.25 - Math.max(0, -s) * A * 0.6, -1.05, aim);

    r.group.position.copy(r.pos);
    r.group.rotation.set(0, r.heading, 0);
    b.root.rotation.set(0, 0, 0);
    b.root.position.set(0, 0, 0);

    // visor: teal on patrol, amber when alerted, soft (≤0.6)
    const vm = r.visorMat;
    vm.emissive.setRGB(lerp(0.2, 1.0, r.alertLevel), lerp(0.72, 0.52, r.alertLevel), lerp(0.66, 0.16, r.alertLevel)).convertSRGBToLinear();
    vm.emissiveIntensity = 0.5 + (r.sees ? 0.08 : 0);
  }

  _animateDeath(r, dt) {
    const b = r.bones;
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
    // tip around the toe (forward) or heel (backward) so the feet do not sink
    const ang = r.fallSign * 1.38 * f;
    b.root.rotation.set(ang, 0, r.roll * f);
    const pz = r.fallSign > 0 ? 0.18 : -0.1;
    _v1.set(0, 0, pz); _v2.set(0, 0, pz).applyEuler(b.root.rotation);
    b.root.position.set(_v1.x - _v2.x, _v1.y - _v2.y + 0.07 * f, _v1.z - _v2.z);
    r.group.position.copy(r.pos);
    r.group.rotation.set(0, r.heading, 0);
    // power-down: visor flickers, then dark
    const vm = r.visorMat;
    if (t < 1.1) vm.emissiveIntensity = (Math.sin(t * 60) > 0.2 ? 0.45 : 0.08) * (1 - t / 1.1);
    else vm.emissiveIntensity = 0;
    // a few trailing sparks from the neck/backpack
    if (r.dieSparkT > 0 && t < 1.6 && (r.dieSparkT -= dt) <= 0) {
      r.dieSparkT = rand(0.25, 0.5);
      b.spine.getWorldPosition(_v1); _v1.y += 0.25;
      this.streaks.sparks(_v1, 5, null, 2.5, 0.7);
    }
  }
}
