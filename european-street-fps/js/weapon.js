// First-person carbine + arms, recoil/reload animation, muzzle flash, casings and all
// world-space shot effects (impact dust, stone chips, decals, sparks, tracers).
// Everything is procedural and pooled: no per-shot geometry or material allocation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Fire / ammo tuning (contract).
const FIRE_INTERVAL = 0.11, MAG = 24, RESERVE = 96, RELOAD_TIME = 1.6;
// Reload timeline (seconds). Audio 'reload' is scheduled to match these beats.
const R = { tiltIn: 0.25, magDrop: 0.18, handDown: [0.12, 0.42], handUp: [0.55, 0.88], insert: [0.88, 0.98], slap: [0.98, 1.12], back: [1.12, 1.4], tiltOut: [1.25, 1.6] };

// ---------------------------------------------------------------- textures
function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, srgb, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function metalTextures() {
  const S = 256;
  const col = makeCanvas(S), rgh = makeCanvas(S);
  const a = col.getContext('2d'), b = rgh.getContext('2d');
  a.fillStyle = 'rgb(214,214,214)'; a.fillRect(0, 0, S, S);
  b.fillStyle = 'rgb(118,118,118)'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) { // mottling of the anodising / oil
    const x = Math.random() * S, y = Math.random() * S, r = rand(3, 14), v = rand(-1, 1);
    a.fillStyle = v > 0 ? `rgba(255,255,255,${0.05 * v})` : `rgba(0,0,0,${-0.07 * v})`;
    a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
    b.fillStyle = v > 0 ? `rgba(200,200,200,${0.08 * v})` : `rgba(40,40,40,${-0.1 * v})`;
    b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
  }
  for (let i = 0; i < 160; i++) { // fine scratches: brighter and shinier
    const x = Math.random() * S, y = Math.random() * S, ang = rand(-0.5, 0.5) + (Math.random() < 0.5 ? 0 : PI / 2), l = rand(4, 26);
    const x2 = x + Math.cos(ang) * l, y2 = y + Math.sin(ang) * l;
    a.strokeStyle = `rgba(255,255,255,${rand(0.2, 0.55)})`; a.lineWidth = rand(0.4, 1.1);
    a.beginPath(); a.moveTo(x, y); a.lineTo(x2, y2); a.stroke();
    b.strokeStyle = `rgba(50,50,50,${rand(0.3, 0.7)})`; b.lineWidth = 1;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x2, y2); b.stroke();
  }
  return { map: canvasTex(col, true), rough: canvasTex(rgh, false) };
}

function noiseTexture(S, base, amp, cell = 1, srgb = false) {
  const c = makeCanvas(S), g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const n = Math.floor(x / cell) * 7 + Math.floor(y / cell) * 131;
    const v = clamp(base + (Math.sin(n * 12.9898) * 43758.5453 % 1) * amp + (Math.random() - 0.5) * amp * 0.6, 0, 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, srgb);
}

function fabricTexture() {
  const S = 128, c = makeCanvas(S), g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const tw = ((x + y) >> 1) % 4 < 2 ? 1 : 0.86; // twill diagonal
    const v = clamp(215 * tw + (Math.random() - 0.5) * 30 + Math.sin(y * 0.35) * 6, 0, 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, false);
}

function flashTexture() {
  // Atlas: left half = front star, right half = side flame. White/yellow core → warm orange edges.
  const c = makeCanvas(256, 128), g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const cx = 64, cy = 64;
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, 30);
  core.addColorStop(0, 'rgba(255,245,215,1)'); core.addColorStop(0.35, 'rgba(255,190,110,0.8)'); core.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.fill();
  const spikes = 6;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * PI * 2 + rand(-0.15, 0.15), L = rand(40, 60), w = rand(5, 8);
    const gr = g.createLinearGradient(cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
    gr.addColorStop(0, 'rgba(255,225,170,0.9)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.beginPath();
    g.moveTo(cx + Math.cos(a + PI / 2) * w, cy + Math.sin(a + PI / 2) * w);
    g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
    g.lineTo(cx + Math.cos(a - PI / 2) * w, cy + Math.sin(a - PI / 2) * w);
    g.fill();
  }
  // side flame (points toward +x in the atlas half)
  for (let k = 0; k < 3; k++) {
    const len = rand(70, 110), w = rand(10, 16);
    const gr = g.createLinearGradient(132, 64, 132 + len, 64);
    gr.addColorStop(0, 'rgba(255,235,190,0.85)'); gr.addColorStop(0.4, 'rgba(255,170,80,0.55)'); gr.addColorStop(1, 'rgba(255,110,30,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(132, 64 - w * 0.5);
    g.quadraticCurveTo(132 + len * 0.4, 64 - w * rand(0.9, 1.3), 132 + len, 64 + rand(-6, 6));
    g.quadraticCurveTo(132 + len * 0.4, 64 + w * rand(0.9, 1.3), 132, 64 + w * 0.5); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture() {
  const S = 64, c = makeCanvas(S), g = c.getContext('2d');
  for (let i = 0; i < 9; i++) { // lumpy soft blob
    const x = S / 2 + rand(-8, 8), y = S / 2 + rand(-8, 8), r = rand(14, 24);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

function sparkTexture() {
  const S = 32, c = makeCanvas(S), g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

function decalTexture() {
  const S = 128, c = makeCanvas(S), g = c.getContext('2d'), m = S / 2;
  const blob = (r0, r1, n) => { g.beginPath(); for (let i = 0; i <= n; i++) { const a = (i / n) * PI * 2, r = rand(r0, r1); g[i ? 'lineTo' : 'moveTo'](m + Math.cos(a) * r, m + Math.sin(a) * r); } g.closePath(); g.fill(); };
  const dust = g.createRadialGradient(m, m, 10, m, m, 62);
  dust.addColorStop(0, 'rgba(90,80,68,0.45)'); dust.addColorStop(1, 'rgba(90,80,68,0)');
  g.fillStyle = dust; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(226,214,192,0.95)'; blob(22, 36, 22);      // freshly chipped, lighter stone
  g.fillStyle = 'rgba(170,158,140,1)'; blob(15, 22, 16);
  const hole = g.createRadialGradient(m, m, 2, m, m, 16);
  hole.addColorStop(0, 'rgba(12,10,9,1)'); hole.addColorStop(0.55, 'rgba(40,34,30,1)'); hole.addColorStop(1, 'rgba(95,85,75,1)');
  g.fillStyle = hole; blob(10, 15, 14);
  g.strokeStyle = 'rgba(60,52,45,0.45)'; g.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) { // hairline cracks
    const a = rand(0, PI * 2); let r = 12, x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) { r += rand(4, 7); const aa = a + rand(-0.25, 0.25); x = m + Math.cos(aa) * r; y = m + Math.sin(aa) * r; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- geometry helpers
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** Collects parts with per-vertex colour and merges them into one geometry (one draw call). */
class Bag {
  constructor() { this.parts = []; }
  add(geo, color, m) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m) g.applyMatrix4(m);
    if (color !== null && color !== undefined) {
      const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    g.clearGroups();
    this.parts.push(g);
    return g;
  }
  build(uvScale = 0) {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (uvScale) boxUV(g, uvScale);
    g.computeBoundingSphere();
    return g;
  }
}

/** Box-projected UVs (per triangle, dominant normal axis) so textures have uniform texel density. */
function boxUV(g, scale) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i) + n.getX(i + 1) + n.getX(i + 2)), ny = Math.abs(n.getY(i) + n.getY(i + 1) + n.getY(i + 2)), nz = Math.abs(n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      if (nx >= ny && nx >= nz) uv.setXY(k, z / scale, y / scale);
      else if (ny >= nz) uv.setXY(k, x / scale, z / scale);
      else uv.setXY(k, x / scale, y / scale);
    }
  }
}

function mirrorX(g) { // mirror a non-indexed geometry and fix the winding
  g.scale(-1, 1, 1);
  for (const key of Object.keys(g.attributes)) {
    const a = g.attributes[key], s = a.itemSize, arr = a.array;
    for (let t = 0; t < a.count; t += 3) for (let j = 0; j < s; j++) { const i1 = (t + 1) * s + j, i2 = (t + 2) * s + j; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
  }
  return g;
}

function chamferRect(w, h, c) {
  const x = w / 2, y = h / 2; c = Math.min(c, x * 0.9, y * 0.9);
  const s = new THREE.Shape();
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c);
  s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  return s;
}
/** Chamfered box: w (x) × h (y) cross-section extruded along z (total depth d), centred. */
function ebox(w, h, d, c = 0.004, b = 0.0015) {
  const inner = Math.max(d - 2 * b, 0.0005);
  const g = new THREE.ExtrudeGeometry(chamferRect(w - 2 * b, h - 2 * b, c), { depth: inner, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1 });
  g.translate(0, 0, -inner / 2);
  return g;
}
/** Side profile given as [z, y] points in gun space, extruded along x with width w (centred). */
function prof(pts, w, b = 0.002, curveSeg = 6) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const inner = Math.max(w - 2 * b, 0.0005);
  const g = new THREE.ExtrudeGeometry(s, { depth: inner, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: curveSeg });
  g.rotateY(PI / 2); g.translate(-inner / 2, 0, 0);
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** Cylinder along z (rz = rotation around its own axis). */
function zcyl(r0, r1, len, seg = 12, open = false) { const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open); g.rotateX(-PI / 2); return g; }

// ---------------------------------------------------------------- colours (sRGB hex)
const C = {
  recv: 0x3b3d41, recvDark: 0x2c2e31, guard: 0x35373a, barrel: 0x2c2c2e, steel: 0x5d5f63, steelBright: 0xa4a29c,
  poly: 0x2f2e2c, polyMag: 0x3a3733, rubber: 0x1c1c1c, void: 0x060606, wear: 0x6c6e70,
  glove: 0x6e5f47, gloveDark: 0x3f382e, glovePalm: 0x5c5040, sleeve: 0x5b6045, sleeveDark: 0x474b36, brass: 0xa7843f,
};

// ---------------------------------------------------------------- gun model
function buildGun() {
  const metal = new Bag(), poly = new Bag(), bolt = new Bag(), mag = new Bag();

  // Upper receiver with a chamfered top edge, ejection port, forward assist and brass deflector.
  metal.add(ebox(0.05, 0.046, 0.25, 0.008, 0.0018), C.recv, M(0, 0.004, -0.03));
  metal.add(ebox(0.012, 0.016, 0.03, 0.003, 0.001), C.recv, M(0.027, 0.012, 0.06));            // deflector
  metal.add(zcyl(0.0065, 0.0065, 0.03, 10), C.recvDark, M(0.03, 0.004, 0.075));                // forward assist
  poly.add(box(0.0022, 0.017, 0.058), C.void, M(0.0254, 0.005, -0.046));                         // ejection port
  poly.add(box(0.0022, 0.0065, 0.11), C.void, M(-0.0254, 0.013, -0.018));                        // side charging slot
  // Picatinny rail on top (receiver + handguard): base strip + cross teeth.
  metal.add(ebox(0.021, 0.006, 0.55, 0.002, 0.0008), C.recvDark, M(0, 0.030, -0.182));
  for (let z = 0.085; z > -0.455; z -= 0.01) metal.add(box(0.022, 0.0042, 0.0052), C.recvDark, M(0, 0.0345, z));
  // Charging handle (T) at the rear.
  metal.add(ebox(0.016, 0.01, 0.03, 0.002, 0.001), C.recvDark, M(0, 0.021, 0.104));
  metal.add(ebox(0.058, 0.009, 0.012, 0.003, 0.001), C.recvDark, M(0, 0.021, 0.119));

  // Lower receiver + flared magwell, trigger guard, trigger, controls.
  metal.add(ebox(0.047, 0.034, 0.215, 0.005, 0.0016), C.recv, M(0, -0.036, -0.018));
  metal.add(prof([[-0.024, -0.05], [-0.128, -0.05], [-0.133, -0.08], [-0.126, -0.083], [-0.024, -0.083], [-0.02, -0.078]], 0.05, 0.0025), C.recv);
  metal.add(ebox(0.012, 0.005, 0.078, 0.0015, 0.0008), C.recvDark, M(0, -0.09, 0.002, 0.08, 0, 0)); // guard bottom
  metal.add(ebox(0.012, 0.036, 0.006, 0.0015, 0.0008), C.recvDark, M(0, -0.072, -0.036));
  metal.add(ebox(0.005, 0.024, 0.006, 0.0015, 0.0006), C.steel, M(0, -0.066, -0.006, 0.3, 0, 0)); // trigger
  metal.add(ebox(0.003, 0.009, 0.026, 0.002, 0.0008), C.steel, M(-0.026, -0.03, 0.052, 0.35, 0, 0)); // selector
  metal.add(zcyl(0.006, 0.006, 0.004, 10), C.steel, M(-0.024, -0.03, 0.052, 0, PI / 2, 0));
  metal.add(ebox(0.004, 0.024, 0.009, 0.002, 0.0008), C.steel, M(-0.0255, -0.034, -0.012));          // bolt catch
  metal.add(zcyl(0.005, 0.005, 0.006, 10), C.steel, M(0.026, -0.042, -0.02, 0, PI / 2, 0));          // mag release
  for (const [z, y] of [[0.075, -0.04], [-0.1, -0.03], [0.02, -0.045]]) metal.add(zcyl(0.0028, 0.0028, 0.05, 8), C.steel, M(0, y, z, 0, PI / 2, 0)); // pins

  // Pistol grip (raked, with a beaver-tail and finger swell).
  poly.add(prof([[0.036, -0.048], [0.082, -0.048], [0.09, -0.06], [0.122, -0.15], [0.118, -0.158], [0.072, -0.158], [0.066, -0.148],
    [0.056, -0.12], [0.05, -0.108], [0.052, -0.095], [0.044, -0.08], [0.038, -0.06]], 0.03, 0.0045), C.poly);

  // Buffer tube, castle nut, collapsible stock and butt pad.
  metal.add(zcyl(0.0145, 0.0145, 0.24, 14), C.recvDark, M(0, 0.0, 0.205));
  metal.add(zcyl(0.018, 0.018, 0.008, 12), C.steel, M(0, 0, 0.092));
  poly.add(prof([[0.19, 0.02], [0.335, 0.03], [0.34, -0.1], [0.325, -0.108], [0.25, -0.03], [0.19, -0.022]], 0.046, 0.005), C.poly);
  poly.add(ebox(0.048, 0.14, 0.012, 0.006, 0.002), C.rubber, M(0, -0.036, 0.345));

  // Free-float octagonal handguard with M-LOK slots and an end cap.
  {
    const ap = 0.0275, Rr = ap / Math.cos(PI / 8), s = new THREE.Shape();
    for (let i = 0; i < 8; i++) { const a = PI / 8 + i * PI / 4; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * Rr, Math.sin(a) * Rr); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1 });
    g.translate(0, -0.002, -0.458);
    metal.add(g, C.guard);
    const apo = ap + 0.0015;
    for (const deg of [0, 135, 180, 225, 270, 315]) {
      const a = (deg * PI) / 180, cnt = deg === 135 ? 3 : 5;
      for (let k = 0; k < cnt; k++) {
        const z = -0.19 - k * 0.052 - (deg === 135 ? 0.05 : 0);
        poly.add(box(0.0016, 0.0072, 0.032), C.void, M(Math.cos(a) * apo, -0.002 + Math.sin(a) * apo, z, 0, 0, a));
      }
    }
    metal.add(zcyl(0.026, 0.026, 0.008, 16), C.recvDark, M(0, -0.002, -0.463));
  }
  // Barrel, gas block hint and a slotted flash hider (lathe).
  metal.add(zcyl(0.0095, 0.0095, 0.14, 14), C.barrel, M(0, -0.002, -0.53));
  {
    const pts = [[0, 0.0105], [0.004, 0.0122], [0.012, 0.0122], [0.014, 0.0112], [0.017, 0.0124], [0.05, 0.0124], [0.053, 0.0112], [0.055, 0.008], [0.055, 0.0065]]
      .map(([z, r]) => new THREE.Vector2(r, z));
    const g = new THREE.LatheGeometry(pts, 14);
    g.rotateX(-PI / 2);
    g.translate(0, -0.002, -0.595);
    metal.add(g, C.barrel);
    for (let k = 0; k < 4; k++) { const a = PI / 4 + k * PI / 2; poly.add(box(0.0014, 0.0035, 0.024), C.void, M(Math.cos(a) * 0.0122, -0.002 + Math.sin(a) * 0.0122, -0.628, 0, 0, a)); }
  }
  // Flip-up sights.
  metal.add(ebox(0.024, 0.009, 0.028, 0.002, 0.0008), C.recvDark, M(0, 0.04, 0.066));
  {
    const s = chamferRect(0.024, 0.026, 0.006);
    const hole = new THREE.Path(); hole.absarc(0, 0.004, 0.0032, 0, PI * 2, true); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: 10 });
    metal.add(g, C.recvDark, M(0, 0.047, 0.079, -1.45, 0, 0));
  }
  metal.add(ebox(0.024, 0.01, 0.02, 0.002, 0.0008), C.recvDark, M(0, 0.041, -0.44));   // folded front sight
  metal.add(ebox(0.022, 0.005, 0.026, 0.0015, 0.0007), C.recvDark, M(0, 0.0475, -0.452));
  metal.add(ebox(0.004, 0.003, 0.02, 0.001, 0.0005), C.steel, M(0, 0.0505, -0.455));

  // Worn edges: a few lighter strips where hands and holsters rub the anodising.
  metal.add(box(0.0012, 0.004, 0.2), C.wear, M(-0.0252, 0.022, -0.03));
  metal.add(box(0.0012, 0.003, 0.18), C.wear, M(-0.0238, -0.052, -0.02));

  // Reciprocating parts: bolt carrier face in the port (right) + side charging knob (left).
  bolt.add(ebox(0.003, 0.013, 0.05, 0.001, 0.0005), C.steelBright, M(0.0245, 0.005, -0.046));
  bolt.add(ebox(0.006, 0.005, 0.012, 0.0015, 0.0006), C.steel, M(-0.0275, 0.013, -0.06));
  bolt.add(ebox(0.014, 0.012, 0.014, 0.003, 0.0015), C.recvDark, M(-0.036, 0.013, -0.06));

  // Curved magazine (origin = top centre of the magazine).
  {
    const N = 7, rear = [], front = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = -0.192 * t;
      rear.push([0.033 - 0.05 * t * t, y]);
      front.push([-0.033 - 0.056 * t * t, y]);
    }
    const pts = [...rear, ...front.reverse()];
    mag.add(prof(pts, 0.022, 0.0028), C.polyMag, M(0, 0, 0));
    const bt = -0.192;
    mag.add(prof([[0.022 - 0.05 + 0.014, bt + 0.004], [-0.089 - 0.004, bt + 0.004], [-0.09, bt - 0.012], [-0.012, bt - 0.012]], 0.028, 0.003), C.poly);
    for (let k = 0; k < 4; k++) { // grip ribs on both sides
      const t = 0.55 + k * 0.1, y = -0.192 * t, z = -0.053 * t * t;
      for (const sx of [-1, 1]) mag.add(box(0.002, 0.0035, 0.048), C.poly, M(sx * 0.0117, y, z, -0.9 * t, 0, 0));
    }
  }

  return {
    metal: metal.build(0.12), poly: poly.build(0.08), bolt: bolt.build(0.1), mag: mag.build(0.08),
  };
}

// ---------------------------------------------------------------- hands & arms
const FINGERS = [ // right hand, palm facing -y, fingers along -z, thumb on -x side
  { x: -0.0285, len: [0.042, 0.026, 0.021], r: 0.0094 },
  { x: -0.0095, len: [0.046, 0.029, 0.023], r: 0.0097 },
  { x: 0.0095, len: [0.044, 0.027, 0.022], r: 0.0094 },
  { x: 0.0275, len: [0.035, 0.022, 0.019], r: 0.0084 },
];

/** Builds one gloved hand in hand space (origin at the wrist). Returns a non-indexed geometry. */
function handGeometry(pose, mirror) {
  const bag = new Bag();
  const root = new THREE.Object3D();
  const rec = [];
  const capsule = (parent, L, r, color) => {
    const g = new THREE.CapsuleGeometry(r, Math.max(L - r * 0.4, 0.001), 3, 9);
    g.rotateX(-PI / 2); g.translate(0, 0, -L / 2);
    rec.push([g, parent, color]);
  };
  // Palm, knuckle armour, thenar pad and the back-of-hand strap.
  bag.add(ebox(0.08, 0.027, 0.088, 0.01, 0.006), C.glove, M(0, 0, -0.046));
  bag.add(ebox(0.074, 0.02, 0.012, 0.008, 0.004), C.glove, M(0, -0.003, -0.084));
  bag.add(ebox(0.066, 0.008, 0.026, 0.003, 0.002), C.gloveDark, M(0.002, 0.0145, -0.074));
  bag.add(ebox(0.07, 0.006, 0.035, 0.003, 0.002), C.gloveDark, M(0, 0.0135, -0.022));
  const th = new THREE.SphereGeometry(1, 10, 8);
  bag.add(th, C.glovePalm, M(-0.024, -0.011, -0.032, 0, -0.35, 0, 0.022, 0.014, 0.034));
  bag.add(new THREE.SphereGeometry(1, 10, 8), C.glovePalm, M(0.01, -0.012, -0.05, 0, 0, 0, 0.034, 0.008, 0.036));

  FINGERS.forEach((f, i) => {
    const p = pose.fingers[i];
    let node = new THREE.Object3D();
    node.position.set(f.x, 0.001, -0.086);
    node.rotation.set(-p[0], p[3] || 0, 0, 'YXZ');
    root.add(node);
    for (let k = 0; k < 3; k++) {
      capsule(node, f.len[k], f.r * (1 - k * 0.06), k === 2 ? C.glovePalm : C.glove);
      if (k < 2) { const n2 = new THREE.Object3D(); n2.position.z = -f.len[k]; n2.rotation.x = -p[k + 1]; node.add(n2); node = n2; }
    }
  });
  { // thumb
    const t = pose.thumb;
    let node = new THREE.Object3D();
    node.position.set(...(t.pos || [-0.03, -0.009, -0.02]));
    node.rotation.set(t.rot[0], t.rot[1], t.rot[2], 'YXZ');
    root.add(node);
    const lens = [0.038, 0.03, 0.025];
    for (let k = 0; k < 3; k++) {
      capsule(node, lens[k], 0.0118 - k * 0.0006, k === 2 ? C.glovePalm : C.glove);
      if (k < 2) { const n2 = new THREE.Object3D(); n2.position.z = -lens[k]; n2.rotation.x = -t.curl[k]; node.add(n2); node = n2; }
    }
  }
  root.updateMatrixWorld(true);
  for (const [g, node, color] of rec) bag.add(g, color, node.matrixWorld);
  const geo = bag.build();
  if (mirror) mirrorX(geo);
  return geo;
}

/** Hand-to-parent matrix from the direction the palm faces, where the fingers point, and the palm centre. */
function handMatrix(palmFaces, fingersPoint, palmCentre) {
  const Y = palmFaces.clone().normalize().negate();
  const f = fingersPoint.clone().normalize();
  const Z = f.addScaledVector(Y, -f.dot(Y)).normalize().negate();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  const origin = palmCentre.clone().addScaledVector(Z, 0.046);
  m.setPosition(origin);
  return m;
}

/** Forearm (sleeve) and glove cuff from wrist w toward elbow e. */
function addForearm(gloveBag, sleeveBag, w, e) {
  const dir = e.clone().sub(w).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const at = (d, g, color, bag) => { g.applyQuaternion(q); const p = w.clone().addScaledVector(dir, d); g.translate(p.x, p.y, p.z); bag.add(g, color); };
  // glove cuff with velcro strap
  const cuff = new THREE.CylinderGeometry(0.0335, 0.031, 0.06, 14, 1, false);
  at(0.02, cuff, C.gloveDark, gloveBag);
  const strap = new THREE.BoxGeometry(0.03, 0.024, 0.012); strap.translate(0, 0, 0.033);
  at(0.022, strap, C.gloveDark, gloveBag);
  // sleeve: tapered cylinder with fabric folds
  const L = w.distanceTo(e);
  const sl = new THREE.CylinderGeometry(0.05, 0.039, L, 16, 10, true);
  const pos = sl.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x), t = y / L + 0.5;
    const k = 1 + 0.07 * Math.sin(a * 3 + t * 9) * Math.sin(t * 13 + 1.3) * (0.4 + t) + 0.03 * Math.sin(a * 5 - t * 21);
    pos.setXYZ(i, x * k, y, z * k);
  }
  sl.computeVertexNormals();
  sl.translate(0, L / 2, 0);
  at(0.045, sl, C.sleeve, sleeveBag);
  const cuffS = new THREE.CylinderGeometry(0.044, 0.043, 0.03, 16, 1, true);
  at(0.05, cuffS, C.sleeveDark, sleeveBag);
  const lip = new THREE.TorusGeometry(0.043, 0.005, 6, 16); lip.rotateX(PI / 2);
  at(0.036, lip, C.sleeveDark, sleeveBag);
}

// ---------------------------------------------------------------- shaders
const PART_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData; attribute vec3 iColor; attribute vec3 iVel;
uniform float stretch;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iData.x;
  vec2 c = position.xy;
  vec2 off;
  if (stretch > 0.0) {
    vec2 d = (modelViewMatrix * vec4(iVel, 0.0)).xy;
    float l = length(d);
    vec2 ax = l > 1e-5 ? d / l : vec2(0.0, 1.0);
    off = vec2(ax.y, -ax.x) * c.x * size + ax * c.y * (size + l * stretch);
  } else {
    float cs = cos(iData.z), sn = sin(iData.z);
    off = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vUv = uv; vAlpha = iData.y; vColor = iColor;
}`;
const PART_FRAG = /* glsl */`
uniform sampler2D map;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const TRACER_VERT = /* glsl */`
attribute vec3 iA; attribute vec3 iB; attribute float iAlpha;
varying float vAlpha; varying vec2 vUv;
void main() {
  vec4 a = modelViewMatrix * vec4(iA, 1.0);
  vec4 b = modelViewMatrix * vec4(iB, 1.0);
  vec4 p = mix(a, b, position.x);
  vec3 d = normalize(b.xyz - a.xyz + vec3(1e-6));
  vec3 side = normalize(cross(d, normalize(p.xyz)));
  p.xyz += side * position.y * (0.0025 + 0.0009 * -p.z);
  gl_Position = projectionMatrix * p;
  vAlpha = iAlpha; vUv = position.xy;
}`;
const TRACER_FRAG = /* glsl */`
uniform vec3 color;
varying float vAlpha; varying vec2 vUv;
void main() {
  float e = 1.0 - abs(vUv.y);
  float a = vAlpha * e * e * (0.15 + 0.85 * vUv.x);
  gl_FragColor = vec4(color, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Pooled camera-facing particles (one draw call). Simulated on the CPU. */
class Particles {
  constructor(max, map, { additive = false, stretch = 0 } = {}) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * 20);
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const ia = (k, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a; };
    this.aPos = ia('iPos', 3); this.aData = ia('iData', 4); this.aColor = ia('iColor', 3); this.aVel = ia('iVel', 3);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, stretch: { value: stretch } }, vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  // p: [x,y,z], v: [x,y,z]
  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, col, grav = 0, drag = 0, fadeIn = 0) {
    if (this.n >= this.max) return;
    const o = this.n++ * 20, d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = 0; d[o + 7] = life; d[o + 8] = s0; d[o + 9] = s1; d[o + 10] = a0;
    d[o + 11] = col.r; d[o + 12] = col.g; d[o + 13] = col.b; d[o + 14] = grav; d[o + 15] = drag;
    d[o + 16] = Math.random() * PI * 2; d[o + 17] = rand(-1.5, 1.5); d[o + 18] = fadeIn;
  }
  clear() { this.n = 0; this.mesh.geometry.instanceCount = 0; this.mesh.visible = false; }
  update(dt) {
    const d = this.d;
    this.mesh.visible = this.n > 0;
    if (this.n === 0) return;
    for (let i = 0; i < this.n;) {
      const o = i * 20;
      d[o + 6] += dt;
      if (d[o + 6] >= d[o + 7]) { // swap-remove
        const last = (this.n - 1) * 20;
        for (let k = 0; k < 20; k++) d[o + k] = d[last + k];
        this.n--; continue;
      }
      const drag = Math.max(0, 1 - d[o + 15] * dt);
      d[o + 3] *= drag; d[o + 4] = d[o + 4] * drag - d[o + 14] * dt; d[o + 5] *= drag;
      d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
      d[o + 16] += d[o + 17] * dt;
      i++;
    }
    const P = this.aPos.array, D = this.aData.array, Cc = this.aColor.array, V = this.aVel.array;
    for (let i = 0; i < this.n; i++) {
      const o = i * 20, t = d[o + 6] / d[o + 7];
      P[i * 3] = d[o]; P[i * 3 + 1] = d[o + 1]; P[i * 3 + 2] = d[o + 2];
      V[i * 3] = d[o + 3]; V[i * 3 + 1] = d[o + 4]; V[i * 3 + 2] = d[o + 5];
      D[i * 4] = lerp(d[o + 8], d[o + 9], 1 - (1 - t) * (1 - t));
      D[i * 4 + 1] = d[o + 10] * Math.pow(1 - t, 1.4) * (d[o + 18] ? Math.min(1, t * 6) : 1);
      D[i * 4 + 2] = d[o + 16];
      Cc[i * 3] = d[o + 11]; Cc[i * 3 + 1] = d[o + 12]; Cc[i * 3 + 2] = d[o + 13];
    }
    for (const a of [this.aPos, this.aData, this.aColor, this.aVel]) a.needsUpdate = true;
    this.mesh.geometry.instanceCount = this.n;
  }
}

function instanceAlphaMaterial(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vIAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIAlpha = iAlpha;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vIAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vIAlpha;');
  };
  mat.customProgramCacheKey = () => 'weapon-instance-alpha';
  return mat;
}

// ---------------------------------------------------------------- springs
class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt, target = 0) { this.v += (-(this.x - target) * this.k - this.v * this.c) * dt; this.x += this.v * dt; }
  reset() { this.x = this.v = 0; }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const _col = new THREE.Color(), _col2 = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Viewmodel layout (gun space: bore along -z, origin above the pistol grip). Exported for tuning.
export const ARM = {
  base: [0.155, -0.135, -0.395], baseRot: [0.0, 0.1, -0.18],
  // [palm faces, fingers point, palm centre]
  rPalm: [[-1, 0.05, 0.25], [0, 0.0, -1], [0.03, -0.1, 0.078]], rElbow: [0.13, -0.3, 0.42],
  lPalm: [[-0.25, 1, 0], [-1, -0.1, -0.45], [0.006, -0.047, -0.39]], lElbow: [-0.12, -0.37, 0.02],
  rPose: {
    fingers: [[0.3, 0.8, 0.5, 0.1], [1.45, 1.5, 0.75, 0.02], [1.5, 1.5, 0.75, -0.02], [1.55, 1.45, 0.7, -0.06]],
    thumb: { pos: [-0.03, -0.035, -0.012], rot: [-0.34, 0.07, 0.0], curl: [-0.1, -0.05] },
  },
  lPose: {
    fingers: [[1.0, 1.2, 0.6, 0.03], [1.05, 1.25, 0.6, 0.0], [1.1, 1.25, 0.55, -0.03], [1.15, 1.2, 0.5, -0.06]],
    thumb: { rot: [-0.6, -0.1, 0.0], curl: [0.2, 0.1] },
  },
};

// ================================================================= Weapon
export class Weapon {
  constructor({ renderer, audio } = {}) {
    this.audio = audio;
    this.renderer = renderer;
    this.magSize = MAG;
    this.currentSpread = 0;

    // ---- view scene, camera and lighting (warm afternoon sun from the upper left)
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(56, (typeof innerWidth !== 'undefined' ? innerWidth / innerHeight : 16 / 9), 0.01, 20);
    this.viewScene.add(this.viewCamera);
    this.viewScene.add(new THREE.HemisphereLight(0xd8e8ff, 0xa08a6a, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
    sun.position.set(-0.55, 1.0, 0.45);
    this.viewScene.add(sun);
    const fill = new THREE.DirectionalLight(0xffe2c0, 0.5); // warm bounce from the sunlit street
    fill.position.set(0.4, -0.6, 0.3);
    this.viewScene.add(fill);
    this._makeEnvironment();

    // ---- materials
    const mt = metalTextures();
    mt.map.repeat.set(1, 1);
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, map: mt.map, roughnessMap: mt.rough, roughness: 1.0, metalness: 0.4 }),
      poly: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, roughnessMap: noiseTexture(128, 200, 40), bumpMap: noiseTexture(128, 128, 110), bumpScale: 0.6 }),
      glove: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0, bumpMap: noiseTexture(128, 128, 90, 2), bumpScale: 0.8 }),
      sleeve: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0, map: fabricTexture(), bumpMap: null, bumpScale: 0.5 }),
      brass: new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.4, metalness: 0.85 }),
    };
    this.mats.sleeve.bumpMap = this.mats.sleeve.map;
    this.mats.sleeve.map.repeat.set(6, 6);
    this.mats.glove.bumpMap.repeat.set(20, 20);
    this.mats.poly.roughnessMap.repeat.set(3, 3); this.mats.poly.bumpMap.repeat.set(10, 10);

    // ---- rig hierarchy: rig (animated) → gun parts, right arm, left arm, muzzle
    this.rig = new THREE.Group();
    this.viewScene.add(this.rig);
    const gun = buildGun();
    this.gunMetal = new THREE.Mesh(gun.metal, this.mats.metal);
    this.gunPoly = new THREE.Mesh(gun.poly, this.mats.poly);
    this.bolt = new THREE.Mesh(gun.bolt, this.mats.metal);
    this.mag = new THREE.Mesh(gun.mag, this.mats.poly);
    this.magHome = new THREE.Vector3(0, -0.045, -0.077);
    this.mag.position.copy(this.magHome);
    this.rig.add(this.gunMetal, this.gunPoly, this.bolt, this.mag);

    this._buildArms();

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.002, -0.652);
    this.rig.add(this.muzzle);
    this.ejectPort = new THREE.Object3D();
    this.ejectPort.position.set(0.03, 0.006, -0.046);
    this.rig.add(this.ejectPort);

    // ---- muzzle flash: star + two crossed side flames, one draw call, additive, warm
    {
      const pos = [], uv = [], idx = [];
      const quad = (pts, uvs) => { const b = pos.length / 3; pts.forEach((p) => pos.push(...p)); uvs.forEach((u) => uv.push(...u)); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
      const s = 0.8;
      quad([[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
      const L = 1.6, w = 0.45;
      quad([[0, -w, 0], [0, -w, -L], [0, w, -L], [0, w, 0]], [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
      quad([[-w, 0, 0], [-w, 0, -L], [w, 0, -L], [w, 0, 0]], [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.flash = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: flashTexture(), color: 0xffd9a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0,
      }));
      this.flash.visible = false;
      this.flash.renderOrder = 3;
      this.muzzle.add(this.flash);
      this.flashLight = new THREE.PointLight(0xffb070, 0, 1.4, 2);
      this.flashLight.position.set(0, 0.02, 0.05);
      this.muzzle.add(this.flashLight);
    }

    // ---- view-space smoke and brass
    this.puffTex = puffTexture();
    this.sparkTex = sparkTexture();
    this.smoke = new Particles(48, this.puffTex);
    this.viewScene.add(this.smoke.mesh);
    const casingGeo = new THREE.CylinderGeometry(0.0042, 0.0045, 0.027, 8);
    casingGeo.rotateX(PI / 2);
    this.casings = new THREE.InstancedMesh(casingGeo, this.mats.brass, 10);
    this.casings.frustumCulled = false;
    this.casings.count = 0;
    this.casingData = Array.from({ length: 10 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), t: 0, alive: false }));
    this.casingNext = 0;
    this.viewScene.add(this.casings);

    // ---- world-space effects (added to the world scene lazily)
    this.dust = new Particles(220, this.puffTex);
    this.sparks = new Particles(120, this.sparkTex, { additive: true, stretch: 0.016 });
    this.chipMax = 70;
    const chipGeo = new THREE.IcosahedronGeometry(1, 0);
    this.chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), this.chipMax);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chips.setColorAt(0, _col.set(0xffffff));
    this.chips.count = 0; this.chips.frustumCulled = false; this.chips.castShadow = false;
    this.chipData = [];
    this.decalMax = 40;
    const decGeo = new THREE.PlaneGeometry(1, 1);
    this.decalAlpha = new THREE.InstancedBufferAttribute(new Float32Array(this.decalMax), 1);
    this.decalAlpha.setUsage(THREE.DynamicDrawUsage);
    decGeo.setAttribute('iAlpha', this.decalAlpha);
    this.decals = new THREE.InstancedMesh(decGeo, instanceAlphaMaterial(new THREE.MeshStandardMaterial({
      map: decalTexture(), transparent: true, depthWrite: false, roughness: 0.95, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })), this.decalMax);
    this.decals.count = 0; this.decals.frustumCulled = false; this.decals.receiveShadow = true;
    this.decals.renderOrder = 1;
    this.decalAge = new Float32Array(this.decalMax);
    this.decalNext = 0; this.decalUsed = 0;
    this.tracerMax = 12;
    {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const ia = (k, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(this.tracerMax * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a; };
      this.tA = ia('iA', 3); this.tB = ia('iB', 3); this.tAlpha = ia('iAlpha', 1);
      g.instanceCount = 0;
      this.tracers = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(1.0, 0.93, 0.8) } }, vertexShader: TRACER_VERT, fragmentShader: TRACER_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      this.tracers.frustumCulled = false;
      this.tracerData = [];
    }

    // ---- animation state
    this.base = new THREE.Vector3(...ARM.base);
    this.baseRot = new THREE.Euler(...ARM.baseRot);
    this.rec = { z: new Spring(260, 24), pitch: new Spring(230, 21), roll: new Spring(160, 16), x: new Spring(200, 20), yaw: new Spring(200, 20) };
    this.sway = { x: new Spring(90, 14), y: new Spring(90, 14), land: new Spring(120, 13) };
    this.resize(this.viewCamera.aspect);
    this.reset();
  }

  _makeEnvironment() {
    if (!this.renderer) return;
    try {
      const env = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vD; void main(){ vec3 d = normalize(vD);
          vec3 top = vec3(0.42,0.52,0.68), hor = vec3(0.82,0.82,0.8), gnd = vec3(0.58,0.48,0.36);
          vec3 c = d.y > 0.0 ? mix(hor, top, pow(d.y, 0.6)) : mix(hor, gnd, clamp(-d.y * 3.0, 0.0, 1.0));
          float s = max(dot(d, normalize(vec3(-0.55, 1.0, 0.45))), 0.0);
          c += vec3(1.0, 0.92, 0.78) * pow(s, 60.0) * 6.0;
          gl_FragColor = vec4(c, 1.0); }`,
      });
      env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), mat));
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.viewScene.environment = pmrem.fromScene(env, 0.02).texture;
      this.viewScene.environmentIntensity = 0.55;
      pmrem.dispose();
      mat.dispose();
    } catch (e) { /* no environment: lights alone still work */ }
  }

  _buildArms() {
    const A = ARM, V = (a) => new THREE.Vector3(...a);
    const rPose = A.rPose, lPose = A.lPose;
    const rGlove = new Bag(), rSleeve = new Bag(), lGlove = new Bag(), lSleeve = new Bag();
    const rm = handMatrix(V(A.rPalm[0]), V(A.rPalm[1]), V(A.rPalm[2]));
    rGlove.add(handGeometry(rPose, false), null, rm);
    const rWrist = new THREE.Vector3().setFromMatrixPosition(rm);
    addForearm(rGlove, rSleeve, rWrist, V(A.rElbow));

    // Left hand under the handguard; geometry is relative to the palm centre (the arm's pivot).
    this.leftPalm = V(A.lPalm[2]);
    const lm = handMatrix(V(A.lPalm[0]), V(A.lPalm[1]), this.leftPalm);
    lGlove.add(handGeometry(lPose, true), null, lm);
    const lWrist = new THREE.Vector3().setFromMatrixPosition(lm);
    addForearm(lGlove, lSleeve, lWrist, V(A.lElbow));

    this.rightGlove = new THREE.Mesh(rGlove.build(0.05), this.mats.glove);
    this.rightSleeve = new THREE.Mesh(rSleeve.build(0.2), this.mats.sleeve);
    this.rig.add(this.rightGlove, this.rightSleeve);

    const lg = lGlove.build(0.05), ls = lSleeve.build(0.2);
    lg.translate(-this.leftPalm.x, -this.leftPalm.y, -this.leftPalm.z);
    ls.translate(-this.leftPalm.x, -this.leftPalm.y, -this.leftPalm.z);
    this.leftArm = new THREE.Group();
    this.leftArm.add(new THREE.Mesh(lg, this.mats.glove), new THREE.Mesh(ls, this.mats.sleeve));
    this.leftArm.position.copy(this.leftPalm);
    this.rig.add(this.leftArm);

    // Left-hand key poses (gun space) for the reload.
    const E = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    this.poseA = { p: this.leftPalm.clone(), q: new THREE.Quaternion() };
    this.poseB = { p: new THREE.Vector3(0.004, -0.268, -0.118), q: E(0.15, -0.25, 0.1) };             // palm under the seated mag
    this.poseP = { p: this.poseB.p.clone().add(new THREE.Vector3(0, -0.075, 0.012)), q: this.poseB.q }; // mag just below the well
    this.poseD = { p: new THREE.Vector3(-0.07, -0.52, 0.06), q: E(0.3, -0.2, 0.15) };                 // down at the pouch
    this.poseS = { p: new THREE.Vector3(-0.03, -0.095, -0.05), q: E(0.1, 0.2, -0.35) };               // slap the bolt catch
    // Mag relative to the hand at pose B (so it follows the hand while carried).
    _mA.compose(this.poseB.p, this.poseB.q, _s.set(1, 1, 1)).invert();
    _mB.compose(this.magHome, _q1.identity(), _s);
    this.magInHand = new THREE.Matrix4().multiplyMatrices(_mA, _mB);
  }

  reset() {
    this.ammo = MAG; this.reserve = RESERVE; this.isReloading = false;
    this.cool = 0; this.reloadT = 0; this.emptyCool = 0; this.flashT = 0; this.boltT = 1; this.boltLocked = false;
    this.bloom = 0; this.currentSpread = 0.003; this.lastShot = 10;
    this.t = 0; this.bobPhase = 0; this.bobAmt = 0; this.sprint = 0; this.wasGrounded = true; this.airT = 0;
    this.trigger = 0; this.reloadWithEmpty = false; this.magSwapped = false;
    Object.values(this.rec).forEach((s) => s.reset());
    Object.values(this.sway).forEach((s) => s.reset());
    this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    this.leftArm.position.copy(this.poseA.p); this.leftArm.quaternion.identity();
    this.smoke.clear(); this.dust.clear(); this.sparks.clear();
    this.casingData.forEach((c) => (c.alive = false)); this.casings.count = 0;
    this.chipData.length = 0; this.chips.count = 0;
    this.decalUsed = 0; this.decalNext = 0; this.decals.count = 0;
    this.tracerData.length = 0; this.tracers.geometry.instanceCount = 0;
    this.flash.visible = false; this.flashLight.intensity = 0;
    this._pose(0);
  }

  // ------------------------------------------------------------- firing
  tryFire() {
    if (this.cool > 0 || this.isReloading) return null;
    if (this.ammo <= 0) {
      if (this.reserve > 0) { this.reload(); return null; }
      if (this.emptyCool <= 0) {
        this.emptyCool = 0.35; this.trigger = 1;
        this.audio?.play('empty', { volume: 0.7 });
        this.rec.pitch.v += 0.15;
      }
      return null;
    }
    this.ammo--;
    this.cool = Math.max(-0.034, this.cool) + FIRE_INTERVAL; // keeps the cadence stable at low frame rates
    this.lastShot = 0;
    this.trigger = 1;
    this.boltT = 0;
    if (this.ammo === 0) this.boltLocked = true;
    const spread = this.currentSpread;
    this.bloom = Math.min(0.022, this.bloom + 0.0042);

    // recoil impulses (spring-damped)
    this.rec.z.v += rand(0.85, 1.0);
    this.rec.pitch.v += rand(1.9, 2.4);
    this.rec.roll.v += rand(-1.6, 1.6);
    this.rec.x.v += rand(-0.08, 0.08);
    this.rec.yaw.v += rand(-0.5, 0.5);

    // muzzle flash
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * PI * 2;
    const sc = rand(0.085, 0.11);
    this.flash.scale.set(sc, sc, sc * rand(0.8, 1.2));
    this._pose(0);
    this._emitMuzzleFx();

    this.audio?.play('shot', { volume: 1, rate: rand(0.96, 1.04) });
    return { pitchKick: rand(0.0085, 0.0115), yawKick: rand(-0.0045, 0.0045), spread };
  }

  _emitMuzzleFx() {
    this.muzzle.getWorldPosition(_v1);
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(_v1.x + rand(-0.004, 0.004), _v1.y + rand(-0.004, 0.004), _v1.z - rand(0, 0.02),
        rand(-0.05, 0.05), rand(0.05, 0.16), rand(-0.25, -0.05), rand(0.45, 0.85), rand(0.012, 0.02), rand(0.07, 0.12), rand(0.1, 0.16),
        _col.setRGB(0.82, 0.8, 0.77), -0.08, 1.8, 1);
    }
    // brass casing out of the ejection port: up, right and slightly back
    const c = this.casingData[this.casingNext]; this.casingNext = (this.casingNext + 1) % this.casingData.length;
    this.ejectPort.getWorldPosition(c.p);
    _q1.setFromRotationMatrix(this.rig.matrixWorld);
    c.v.set(rand(1.1, 1.6), rand(0.9, 1.3), rand(0.1, 0.45)).applyQuaternion(_q1);
    c.q.copy(_q1).multiply(_q2.setFromEuler(_e.set(0, PI / 2, 0)));
    c.w.set(rand(-25, 25), rand(-10, 10), rand(15, 30));
    c.t = 0; c.alive = true;
  }

  reload() {
    if (this.isReloading || this.ammo >= MAG || this.reserve <= 0) return;
    this.isReloading = true;
    this.reloadT = 0;
    this.reloadWithEmpty = this.ammo === 0;
    this.magSwapped = false;
    this.audio?.play('reload', { volume: 0.8 });
  }

  // ------------------------------------------------------------- per-frame animation
  update(dt, { moving = false, speed01 = 0, grounded = true, lookDX = 0, lookDY = 0 } = {}) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.cool -= dt; this.emptyCool -= dt; this.lastShot += dt;
    this.trigger = Math.max(0, this.trigger - dt * 10);

    // spread: base + movement + air + sustained-fire bloom (recovers)
    this.bloom = Math.max(0, this.bloom - dt * (0.012 + this.bloom * 3.5));
    this.airT = grounded ? 0 : this.airT + dt;
    const target = 0.0028 + (moving ? speed01 * 0.016 : 0) + (grounded ? 0 : 0.014) + this.bloom;
    this.currentSpread = lerp(this.currentSpread, target, 1 - Math.exp(-dt * 14));

    // reload timeline
    if (this.isReloading) {
      this.reloadT += dt;
      if (!this.magSwapped && this.reloadT >= R.insert[1]) {
        const n = Math.min(MAG - this.ammo, this.reserve);
        this.ammo += n; this.reserve -= n; this.magSwapped = true;
      }
      if (this.reloadT >= RELOAD_TIME) { this.isReloading = false; this.boltLocked = false; }
    }

    // jump / land
    if (this.wasGrounded && !grounded) this.sway.land.v += 0.25;
    if (!this.wasGrounded && grounded) this.sway.land.v -= 0.55;
    this.wasGrounded = grounded;

    // walk / run bob
    const bobTarget = moving && grounded ? speed01 : 0;
    this.bobAmt = lerp(this.bobAmt, bobTarget, 1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (4 + speed01 * 7.5) * (moving ? 1 : 0.3);
    const sprintTarget = moving && speed01 > 0.8 && !this.isReloading && this.lastShot > 0.35 ? 1 : 0;
    this.sprint = lerp(this.sprint, sprintTarget, 1 - Math.exp(-dt * 7));

    // look lag
    const inv = 1 / Math.max(dt, 1e-3);
    const sx = clamp(-lookDX * inv * 0.012, -0.03, 0.03), sy = clamp(-lookDY * inv * 0.012, -0.03, 0.03);

    // springs (sub-stepped for stability)
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const s of Object.values(this.rec)) s.step(h);
      this.sway.x.step(h, sx); this.sway.y.step(h, sy); this.sway.land.step(h);
    }

    // bolt cycle: back and forward within ~60 ms, locked back on an empty mag until release
    this.boltT = Math.min(1, this.boltT + dt / 0.065);
    let boltX = this.boltT < 1 ? Math.sin(this.boltT * PI) : 0;
    if (this.boltLocked) {
      if (this.boltT >= 0.5) boltX = 1;
      if (this.isReloading && this.reloadT >= R.slap[1]) { this.boltLocked = false; boltX = 0; this.rec.z.v += 0.2; }
    }
    this.bolt.position.z = boltX * 0.042;

    // muzzle flash (≈50 ms)
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = clamp(this.flashT / 0.05, 0, 1);
      this.flash.visible = k > 0.02;
      this.flash.material.opacity = 0.85 * k;
      this.flashLight.intensity = 0.35 * k;
    } else { this.flash.visible = false; this.flashLight.intensity = 0; }

    this._pose(dt);
    this._updateViewFx(dt);
  }

  _pose() {
    const t = this.t, bob = this.bobAmt, ph = this.bobPhase;
    const breathe = 1 - Math.min(1, bob * 2);
    let px = this.base.x * this.xScale, py = this.base.y, pz = this.base.z;
    let rx = this.baseRot.x, ry = this.baseRot.y, rz = this.baseRot.z;

    // idle breathing
    py += Math.sin(t * 1.7) * 0.0016 * breathe; rx += Math.sin(t * 1.1) * 0.004 * breathe; px += Math.sin(t * 0.9) * 0.001 * breathe;
    // bob: figure-eight
    px += Math.sin(ph) * 0.011 * bob; py -= Math.abs(Math.cos(ph)) * 0.013 * bob; rz += Math.sin(ph) * 0.02 * bob; ry += Math.sin(ph) * 0.012 * bob;
    // look lag
    px += this.sway.x.x * 0.9; py += this.sway.y.x * 0.9; ry -= this.sway.x.x * 1.6; rx += this.sway.y.x * 1.2; rz -= this.sway.x.x * 1.8;
    // jump / land
    py += this.sway.land.x * 0.12; rx += this.sway.land.x * 0.4;
    // recoil
    pz += this.rec.z.x; py += this.rec.pitch.x * 0.05; rx += this.rec.pitch.x; rz += this.rec.roll.x * 0.05; px += this.rec.x.x * 0.02; ry += this.rec.yaw.x * 0.03;
    // sprint: gun canted and lowered
    const s = this.sprint;
    px -= 0.02 * s; py -= 0.05 * s; ry += 0.42 * s; rx -= 0.22 * s; rz += 0.2 * s;

    // reload
    let tilt = 0;
    if (this.isReloading) {
      const u = this.reloadT;
      tilt = smooth(0, R.tiltIn, u) * (1 - smooth(R.tiltOut[0], R.tiltOut[1], u));
      this._animateReload(u);
    } else {
      this.leftArm.position.copy(this.poseA.p); this.leftArm.quaternion.identity();
      this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    }
    px -= 0.035 * tilt; py += 0.05 * tilt; pz += 0.0 * tilt; rx += 0.14 * tilt; ry -= 0.04 * tilt; rz -= 0.42 * tilt;

    this.rig.position.set(px, py, pz);
    this.rig.rotation.set(rx, ry, rz, 'XYZ');
    this.rig.updateMatrixWorld(true);
  }

  _animateReload(u) {
    // mag: drop out of the well, then ride in the left hand, then seat
    if (u < R.magDrop) {
      this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    } else if (u < R.handUp[0]) {
      const k = u - R.magDrop;
      this.mag.visible = k < 0.3;
      this.mag.position.set(this.magHome.x + k * 0.05, this.magHome.y - 3.2 * k * k - 0.05 * k, this.magHome.z + k * 0.08);
      this.mag.quaternion.setFromEuler(_e.set(-k * 1.2, 0, k * 0.8));
    } else if (u < R.insert[1]) {
      this.mag.visible = true;
      this.mag.matrix.multiplyMatrices(_mA.compose(this.leftArm.position, this.leftArm.quaternion, _s.set(1, 1, 1)), this.magInHand);
      this.mag.matrix.decompose(this.mag.position, this.mag.quaternion, _s);
    } else {
      this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    }
    // left hand key poses
    const seg = (a, b, k) => { this.leftArm.position.lerpVectors(a.p, b.p, k); this.leftArm.quaternion.slerpQuaternions(a.q, b.q, k); };
    if (u < R.handDown[0]) seg(this.poseA, this.poseA, 0);
    else if (u < R.handDown[1]) seg(this.poseA, this.poseD, smooth(R.handDown[0], R.handDown[1], u));
    else if (u < R.handUp[0]) seg(this.poseD, this.poseD, 0);
    else if (u < R.handUp[1]) seg(this.poseD, this.poseP, smooth(R.handUp[0], R.handUp[1], u));
    else if (u < R.insert[1]) seg(this.poseP, this.poseB, smooth(R.insert[0], R.insert[1], u));
    else if (u < R.slap[1]) seg(this.poseB, this.reloadWithEmpty ? this.poseS : this.poseB, Math.sin(smooth(R.slap[0], R.slap[1], u) * PI * (this.reloadWithEmpty ? 0.5 : 1)) * (this.reloadWithEmpty ? 1 : 0.15));
    else if (u < R.back[1]) seg(this.reloadWithEmpty ? this.poseS : this.poseB, this.poseA, smooth(R.back[0], R.back[1], u));
    else seg(this.poseA, this.poseA, 0);
    if (u >= R.insert[0] && u < R.slap[0] + 0.05) this.rig.position.y += 0; // (seat bump handled by recoil spring below)
    if (u >= R.insert[1] && !this._seatKick) { this._seatKick = true; this.sway.land.v += 0.18; }
    if (u < R.insert[1]) this._seatKick = false;
  }

  _updateViewFx(dt) {
    this.smoke.update(dt);
    let n = 0;
    for (const c of this.casingData) {
      if (!c.alive) continue;
      c.t += dt;
      if (c.t > 0.8) { c.alive = false; continue; }
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      c.q.multiply(_q2.setFromEuler(_e.set(c.w.x * dt, c.w.y * dt, c.w.z * dt)));
      _mA.compose(c.p, c.q, _s.setScalar(1));
      this.casings.setMatrixAt(n++, _mA);
    }
    this.casings.count = n;
    this.casings.visible = n > 0;
    if (n) this.casings.instanceMatrix.needsUpdate = true;
  }

  getMuzzleWorld(camera, target) {
    this.muzzle.getWorldPosition(_v1); // view space (view camera sits at the origin)
    const depth = -_v1.z;
    _v1.project(this.viewCamera);
    camera.updateMatrixWorld();
    _v2.set(_v1.x, _v1.y, 0.5).unproject(camera);
    camera.getWorldPosition(_v3);
    _v2.sub(_v3).normalize();
    camera.getWorldDirection(_v1);
    return target.copy(_v3).addScaledVector(_v2, depth / Math.max(0.2, _v2.dot(_v1)));
  }

  // ------------------------------------------------------------- world effects
  _attach(scene) {
    if (this.worldScene === scene) return;
    this.worldScene = scene;
    scene.add(this.decals, this.chips, this.dust.mesh, this.sparks.mesh, this.tracers);
  }

  spawnImpact(scene, point, normal, kind = 'world') {
    this._attach(scene);
    const n = _v3.copy(normal).normalize();
    // tangent basis for spraying around the normal
    const t1 = Math.abs(n.y) < 0.9 ? _v1.set(0, 1, 0).cross(n).normalize() : _v1.set(1, 0, 0).cross(n).normalize();
    const t2 = _v2.crossVectors(n, t1);
    const dirAround = (spreadK, out) => {
      const a = Math.random() * PI * 2, r = Math.random() * spreadK;
      return out.copy(n).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
    };
    const d = new THREE.Vector3(); // reused below (small, cached on the instance)
    const tmp = this._tmpDir || (this._tmpDir = d);
    const px = point.x + n.x * 0.02, py = point.y + n.y * 0.02, pz = point.z + n.z * 0.02;

    if (kind === 'robot') {
      const ns = 12 + (Math.random() * 6 | 0);
      for (let i = 0; i < ns; i++) {
        dirAround(1.3, tmp); const sp = rand(2.5, 7);
        _col.setRGB(1.0, rand(0.5, 0.7), rand(0.15, 0.3)).multiplyScalar(rand(1.2, 1.8));
        this.sparks.spawn(px, py, pz, tmp.x * sp, tmp.y * sp, tmp.z * sp, rand(0.12, 0.3), 0.015, 0.007, 1, _col, 9.8, 1.5);
      }
      for (let i = 0; i < 6; i++) {
        dirAround(1.1, tmp); const sp = rand(1.2, 3.2);
        this._chip(px, py, pz, tmp.x * sp, tmp.y * sp + 0.8, tmp.z * sp, rand(0.006, 0.013), _col.setRGB(rand(0.85, 0.95), rand(0.85, 0.95), rand(0.84, 0.92)), point, normal);
      }
      for (let i = 0; i < 2; i++) {
        dirAround(0.8, tmp); const sp = rand(0.3, 0.7);
        this.dust.spawn(px, py, pz, tmp.x * sp, tmp.y * sp, tmp.z * sp, rand(0.35, 0.6), 0.05, 0.22, 0.28, _col.setRGB(0.75, 0.75, 0.75), -0.1, 3, 1);
      }
      return;
    }

    // stone / plaster: dust plume, fast grit, chips and a decal
    const stone = _col2.setRGB(0.8, 0.73, 0.62);
    for (let i = 0; i < 6; i++) {
      dirAround(0.7, tmp); const sp = rand(0.5, 1.8);
      _col.copy(stone).multiplyScalar(rand(0.85, 1.08));
      this.dust.spawn(px, py, pz, tmp.x * sp, tmp.y * sp, tmp.z * sp, rand(0.7, 1.4), rand(0.05, 0.09), rand(0.3, 0.55), rand(0.35, 0.5), _col, 0.35, 2.6, 1);
    }
    for (let i = 0; i < 7; i++) {
      dirAround(1.0, tmp); const sp = rand(2, 5);
      _col.copy(stone).multiplyScalar(0.55);
      this.dust.spawn(px, py, pz, tmp.x * sp, tmp.y * sp, tmp.z * sp, rand(0.25, 0.45), 0.018, 0.028, 0.9, _col, 9.8, 0.5);
    }
    for (let i = 0; i < 5; i++) {
      dirAround(1.0, tmp); const sp = rand(1.2, 3.5);
      this._chip(px, py, pz, tmp.x * sp, tmp.y * sp + 0.5, tmp.z * sp, rand(0.005, 0.012), _col.copy(stone).multiplyScalar(rand(0.7, 1.05)), point, normal);
    }
    if (Math.random() < 0.35) { // occasional tiny spark on stone
      dirAround(1.0, tmp); const sp = rand(3, 6);
      this.sparks.spawn(px, py, pz, tmp.x * sp, tmp.y * sp, tmp.z * sp, rand(0.08, 0.15), 0.008, 0.004, 0.8, _col.setRGB(1, 0.75, 0.45), 9.8, 1);
    }
    // decal
    const i = this.decalNext; this.decalNext = (this.decalNext + 1) % this.decalMax;
    this.decalUsed = Math.min(this.decalMax, this.decalUsed + 1);
    _q1.setFromUnitVectors(Z_AXIS, n).multiply(_q2.setFromAxisAngle(Z_AXIS, Math.random() * PI * 2));
    const sc = rand(0.085, 0.13);
    _mA.compose(_p.set(point.x + n.x * 0.004, point.y + n.y * 0.004, point.z + n.z * 0.004), _q1, _s.set(sc, sc, sc));
    this.decals.setMatrixAt(i, _mA);
    this.decalAge[i] = 0;
    this.decalAlpha.setX(i, 1);
    this.decals.count = this.decalUsed;
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalAlpha.needsUpdate = true;
  }

  _chip(x, y, z, vx, vy, vz, size, color, planeP, planeN) {
    let c;
    if (this.chipData.length < this.chipMax) { c = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), pp: new THREE.Vector3(), pn: new THREE.Vector3(), col: new THREE.Color() }; this.chipData.push(c); }
    else { c = this.chipData.shift(); this.chipData.push(c); }
    c.p.set(x, y, z); c.v.set(vx, vy, vz); c.q.setFromEuler(_e.set(rand(0, 6), rand(0, 6), rand(0, 6)));
    c.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20)); c.t = 0; c.life = rand(1.0, 1.6); c.size = size;
    c.sx = rand(0.6, 1.2); c.sy = rand(0.4, 0.9); c.pp.copy(planeP); c.pn.copy(planeN); c.col.copy(color);
  }

  spawnTracer(scene, from, to) {
    this._attach(scene);
    const dist = from.distanceTo(to);
    if (dist < 1.5) return;
    if (this.tracerData.length >= this.tracerMax) this.tracerData.shift();
    this.tracerData.push({ a: from.clone(), dir: to.clone().sub(from).divideScalar(dist), dist, s: 0, speed: 420, len: Math.min(5, dist * 0.5), alpha: 0.5 });
  }

  updateEffects(dt) {
    dt = Math.min(dt, 0.1);
    this.dust.update(dt);
    this.sparks.update(dt);

    // chips with a simple bounce on the impact surface and the ground
    let n = 0;
    for (let i = this.chipData.length - 1; i >= 0; i--) {
      const c = this.chipData[i];
      c.t += dt;
      if (c.t >= c.life) { this.chipData.splice(i, 1); continue; }
    }
    for (const c of this.chipData) {
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      const dPlane = _v1.copy(c.p).sub(c.pp).dot(c.pn);
      if (dPlane < 0) { c.p.addScaledVector(c.pn, -dPlane); const vn = c.v.dot(c.pn); if (vn < 0) c.v.addScaledVector(c.pn, -1.4 * vn).multiplyScalar(0.6); c.w.multiplyScalar(0.7); }
      if (c.p.y < 0.004) { c.p.y = 0.004; if (c.v.y < 0) { c.v.y *= -0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5); } }
      c.q.multiply(_q2.setFromEuler(_e.set(c.w.x * dt, c.w.y * dt, c.w.z * dt)));
      const k = c.size * Math.min(1, (c.life - c.t) / 0.35);
      _mA.compose(c.p, c.q, _s.set(k * c.sx, k * c.sy, k));
      this.chips.setMatrixAt(n, _mA);
      this.chips.setColorAt(n, c.col);
      n++;
    }
    this.chips.count = n;
    this.chips.visible = n > 0;
    if (n) {
      this.chips.instanceMatrix.needsUpdate = true;
      if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
    }

    // decals fade after ~20 s
    let dirty = false;
    for (let i = 0; i < this.decalUsed; i++) {
      this.decalAge[i] += dt;
      const a = 1 - smooth(17, 21, this.decalAge[i]);
      if (Math.abs(this.decalAlpha.getX(i) - a) > 1e-3) { this.decalAlpha.setX(i, a); dirty = true; }
    }
    if (dirty) this.decalAlpha.needsUpdate = true;

    // tracers: a short pale streak racing from the muzzle to the hit point
    let m = 0;
    const A = this.tA.array, B = this.tB.array, AL = this.tAlpha.array;
    for (let i = this.tracerData.length - 1; i >= 0; i--) {
      const tr = this.tracerData[i];
      tr.s += tr.speed * dt;
      if (tr.s - tr.len >= tr.dist) this.tracerData.splice(i, 1);
    }
    for (const tr of this.tracerData) {
      const s0 = Math.max(0, tr.s - tr.len), s1 = Math.min(tr.s, tr.dist);
      A[m * 3] = tr.a.x + tr.dir.x * s0; A[m * 3 + 1] = tr.a.y + tr.dir.y * s0; A[m * 3 + 2] = tr.a.z + tr.dir.z * s0;
      B[m * 3] = tr.a.x + tr.dir.x * s1; B[m * 3 + 1] = tr.a.y + tr.dir.y * s1; B[m * 3 + 2] = tr.a.z + tr.dir.z * s1;
      AL[m] = tr.alpha;
      m++;
    }
    if (m) this.tA.needsUpdate = this.tB.needsUpdate = this.tAlpha.needsUpdate = true;
    this.tracers.geometry.instanceCount = m;
    this.tracers.visible = m > 0;
    this.decals.visible = this.decalUsed > 0;
  }

  resize(aspect) {
    this.viewCamera.aspect = aspect;
    // Keep the gun at a similar place on screen for wide phones and narrow windows.
    this.xScale = clamp(aspect / 1.78, 0.45, 1.2);
    this.viewCamera.fov = aspect < 1 ? 66 : 56;
    this.viewCamera.updateProjectionMatrix();
  }
}
