// First-person carbine + skinned arms, hip/ADS/lean/recoil/reload animation, red-dot sight,
// muzzle flash, casings and all world-space shot effects (impact dust, stone chips, decals, sparks,
// tracers). Everything is procedural and pooled: no per-shot geometry or material allocation.
// The arms/hands rig lives in weapon-arms.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Arm, FINGERS, handFrame, seatPalm, grasp, solveDigit, poseQuats, mirrorMatrix, sdBox, sdProfile } from './weapon-arms.js';

const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Fire / ammo tuning (contract).
const FIRE_INTERVAL = 0.11, MAG = 24, RESERVE = 96, RELOAD_TIME = 1.6;
// Reload timeline (seconds). Audio 'reload' is scheduled to match these beats.
const R = { tiltIn: 0.25, magDrop: 0.18, handDown: [0.12, 0.42], handUp: [0.55, 0.88], insert: [0.88, 0.98], slap: [0.98, 1.12], back: [1.12, 1.4], tiltOut: [1.25, 1.6] };

const SIGHT_Y = 0.0685; // red-dot optical axis above the gun origin (gun space)

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
function gloveTexture() { // fine stretch-knit / synthetic leather grain (bump)
  const S = 128, c = makeCanvas(S), g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const knit = ((x >> 1) + (y >> 2)) % 2 ? 1 : 0.86;
    const v = clamp(150 * knit + (Math.random() - 0.5) * 56, 0, 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(c, false);
}

function camoTexture() { // low-contrast multi-terrain camouflage with a twill weave (tileable)
  const S = 256, c = makeCanvas(S), g = c.getContext('2d');
  g.fillStyle = '#6e6a51'; g.fillRect(0, 0, S, S);
  const layers = [['#7c7558', 14, 30], ['#5b5c43', 12, 24], ['#8a8264', 10, 18], ['#4c4939', 9, 13], ['#737557', 8, 20]];
  for (const [col, n, R0] of layers) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * S, cy = Math.random() * S, r = R0 * rand(0.6, 1.3), N = 9, shape = [];
      for (let k = 0; k < N; k++) { const a = (k / N) * PI * 2; shape.push([Math.cos(a) * r * rand(0.6, 1.3), Math.sin(a) * r * rand(0.5, 1.2) * 1.5]); }
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        g.beginPath(); shape.forEach(([x, y], k) => (k ? g.lineTo(cx + x + ox, cy + y + oy) : g.moveTo(cx + x + ox, cy + y + oy))); g.closePath(); g.fill();
      }
    }
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, k = (((x + y) >> 1) % 4 < 2 ? 1.0 : 0.93) * (1 + (Math.random() - 0.5) * 0.08);
    d[i] = clamp(d[i] * k, 0, 255); d[i + 1] = clamp(d[i + 1] * k, 0, 255); d[i + 2] = clamp(d[i + 2] * k, 0, 255);
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c, true);
  t.repeat.set(0.45, 0.45);
  return t;
}

// Red-dot lens: faint coated glass with a collimated circle-dot reticle. The reticle is drawn
// where the view ray is parallel to the optical axis, so it sits at the point of aim (screen
// centre when aimed) regardless of eye position, like a real parallax-free sight.
const LENS_VERT = /* glsl */`
attribute float aRet;
varying vec3 vPos; varying vec3 vAxis; varying vec3 vN; varying float vRet;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  vAxis = normalize((modelViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
  vN = normalize(normalMatrix * normal);
  vRet = aRet;
  gl_Position = projectionMatrix * mv;
}`;
const LENS_FRAG = /* glsl */`
uniform float pxAngle; uniform vec3 retColor;
varying vec3 vPos; varying vec3 vAxis; varying vec3 vN; varying float vRet;
void main() {
  vec3 ray = normalize(vPos);
  float c = dot(ray, vAxis);
  vec3 off = ray / max(c, 0.05) - vAxis;
  float r = length(off) / pxAngle;                      // CSS pixels from the collimated aim point
  float dotA = 1.0 - smoothstep(1.5, 2.9, r);
  float halo = exp(-r * 0.45) * 0.18;
  float ring = (1.0 - smoothstep(0.35, 1.1, abs(r - 13.0))) * 0.5;
  float ret = clamp((dotA + halo + ring) * vRet * step(0.5, c), 0.0, 1.0);
  float fres = pow(1.0 - clamp(abs(dot(normalize(vN), -ray)), 0.0, 1.0), 2.5);
  float glassA = mix(0.05, 0.5, fres) * (vRet > 0.5 ? 1.0 : 0.6);
  vec3 glass = mix(vec3(0.42, 0.5, 0.6), vec3(0.78, 0.84, 0.9), fres);
  float a = 1.0 - (1.0 - ret) * (1.0 - glassA);
  vec3 col = (retColor * ret + glass * glassA * (1.0 - ret)) / max(a, 1e-3);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function lensMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { pxAngle: { value: 0.001 }, retColor: { value: new THREE.Color(1.0, 0.26, 0.16).multiplyScalar(1.35) } },
    vertexShader: LENS_VERT, fragmentShader: LENS_FRAG, transparent: true, depthWrite: false,
  });
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
  // Folded front sight (the red dot is the primary sight).
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

  // Micro red-dot sight on a riser mount; its optical axis is at SIGHT_Y (lens drawn by its own shader).
  let lens;
  {
    const zc = -0.004, sy = SIGHT_Y;
    metal.add(ebox(0.021, 0.016, 0.038, 0.002, 0.001), C.recvDark, M(0, 0.0445, zc));                 // riser
    metal.add(ebox(0.03, 0.006, 0.032, 0.0015, 0.0008), C.recvDark, M(0, 0.0385, zc));                // clamp base
    metal.add(ebox(0.006, 0.011, 0.026, 0.0015, 0.0008), C.recvDark, M(0.0158, 0.0345, zc));          // clamp jaw (right)
    for (const dz of [-0.007, 0.008]) metal.add(zcyl(0.0042, 0.0042, 0.005, 10), C.steel, M(0.0196, 0.0345, zc + dz, 0, PI / 2, 0));
    const outer = [[0.0121, -0.0245], [0.0132, -0.0265], [0.0176, -0.0265], [0.0185, -0.0225], [0.0185, 0.011], [0.0177, 0.0175],
      [0.0171, 0.0205], [0.0136, 0.0215], [0.0121, 0.021]].map(([r, z]) => new THREE.Vector2(r, z));
    const tube = new THREE.LatheGeometry(outer, 24);
    tube.rotateX(PI / 2); tube.translate(0, sy, zc);
    metal.add(tube, C.recvDark);
    const bore = new THREE.LatheGeometry([[0.0122, 0.0212], [0.0119, 0.015], [0.0119, -0.02], [0.0122, -0.0248]].map(([r, z]) => new THREE.Vector2(r, z)), 24);
    bore.rotateX(PI / 2); bore.translate(0, sy, zc);
    poly.add(bore, 0x141414);                                                                            // matte black bore
    metal.add(new THREE.CylinderGeometry(0.0066, 0.0072, 0.0075, 14), C.recvDark, M(0, sy + 0.0205, zc - 0.002));          // elevation cap
    metal.add(new THREE.CylinderGeometry(0.0066, 0.0072, 0.0075, 14), C.recvDark, M(0.0205, sy, zc - 0.002, 0, 0, -PI / 2)); // windage cap
    metal.add(ebox(0.005, 0.012, 0.016, 0.002, 0.001), C.steel, M(-0.0195, sy - 0.008, zc - 0.002));   // brightness buttons
    const rear = new THREE.CircleGeometry(0.0119, 24); rear.translate(0, sy, zc + 0.017);
    const front = new THREE.CircleGeometry(0.0119, 24); front.translate(0, sy, zc - 0.021);
    rear.setAttribute('aRet', new THREE.Float32BufferAttribute(new Float32Array(rear.attributes.position.count).fill(1), 1));
    front.setAttribute('aRet', new THREE.Float32BufferAttribute(new Float32Array(front.attributes.position.count), 1));
    lens = mergeGeometries([rear, front], false);
  }

  return {
    metal: metal.build(0.12), poly: poly.build(0.08), bolt: bolt.build(0.1), mag: mag.build(0.08), lens,
  };
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
// ---------------------------------------------------------------- gun surfaces (signed distance, gun space)
// Used once at start-up to seat the palms and close the fingers onto the real surfaces.
const GRIP_PTS = [[0.036, -0.048], [0.082, -0.048], [0.09, -0.06], [0.122, -0.15], [0.118, -0.158], [0.072, -0.158], [0.066, -0.148],
  [0.056, -0.12], [0.05, -0.108], [0.052, -0.095], [0.044, -0.08], [0.038, -0.06]];
const MW_PTS = [[-0.024, -0.05], [-0.128, -0.05], [-0.133, -0.08], [-0.126, -0.083], [-0.024, -0.083], [-0.02, -0.078]];
const MAG_PTS = (() => {
  const N = 7, rear = [], front = [];
  for (let i = 0; i <= N; i++) { const t = i / N, y = -0.192 * t; rear.push([0.033 - 0.05 * t * t, y]); front.push([-0.033 - 0.056 * t * t, y]); }
  return [...rear, ...front.reverse()];
})();
function sdfLower(p) {
  let d = sdProfile(p, GRIP_PTS, 0.015, 0.0045);
  d = Math.min(d, sdBox(p, [0, -0.036, -0.018], [0.0235, 0.017, 0.1075], 0.004));
  d = Math.min(d, sdBox(p, [0, 0.004, -0.03], [0.025, 0.023, 0.125], 0.006));
  d = Math.min(d, sdBox(p, [0, -0.0905, 0.002], [0.006, 0.0028, 0.039], 0.001));
  d = Math.min(d, sdBox(p, [0, -0.072, -0.036], [0.006, 0.018, 0.003], 0.001));
  d = Math.min(d, sdProfile(p, MW_PTS, 0.025, 0.0025));
  d = Math.min(d, Math.hypot(Math.max(Math.hypot(p.x, p.y) - 0.0145, 0), Math.max(Math.abs(p.z - 0.205) - 0.12, 0)));
  d = Math.min(d, sdBox(p, [0.03, 0.004, 0.075], [0.004, 0.0065, 0.015], 0.002)); // forward assist
  return d;
}
function sdfGuard(p) {
  const y = p.y + 0.002, x = p.x;
  let d2 = -Infinity;
  for (let i = 0; i < 8; i++) { const a = (i * PI) / 4; d2 = Math.max(d2, x * Math.cos(a) + y * Math.sin(a) - 0.029); }
  const dz = Math.max(-0.462 - p.z, p.z + 0.156);
  const d = Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0);
  return Math.min(d, sdBox(p, [0, 0.0318, -0.2], [0.011, 0.0048, 0.27], 0.0008));
}
function sdfMag(p) { return sdProfile(p, MAG_PTS, 0.0138, 0.0028); }
const _mir = new THREE.Vector3();
const mirrored = (sdf) => (p) => sdf(_mir.set(-p.x, p.y, p.z));

// ---------------------------------------------------------------- springs
class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt, target = 0) { this.v += (-(this.x - target) * this.k - this.v * this.c) * dt; this.x += this.v * dt; }
  reset() { this.x = this.v = 0; }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const _col = new THREE.Color(), _col2 = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);
const V3 = (a) => new THREE.Vector3(...a);

// Viewmodel layout (view space: camera at the origin looking down -z; gun space: bore along -z,
// origin above the pistol grip). Exported for tuning.
export const LAYOUT = {
  hipPos: [0.122, -0.094, -0.44], hipRot: [0.035, 0.08, -0.05],
  eyeZ: 0.132,                          // gun-space z of the eye at full aim (eye relief behind the optic)
  hipFov: 54, adsFovK: 0.78,            // view-model FOV (desktop landscape) and its ADS factor
  rShoulder: [0.2, -0.3, 0.13], rElbow: [0.36, -0.52, -0.05], rShoulderAds: [0.15, -0.28, 0.17], rElbowAds: [0.28, -0.5, 0.02],
  lShoulder: [-0.2, -0.36, 0.06], lElbow: [-0.16, -0.7, -0.32], lShoulderAds: [-0.18, -0.32, 0.08], lElbowAds: [-0.2, -0.52, -0.12],
  // hands: [palm normal, knuckle line toward the little finger, palm contact point] in gun space
  rGrip: [[-1, 0.05, -0.36], [0, -0.949, 0.316], [0.0185, -0.098, 0.1]],
  lGuard: [[0.35, 1, 0.0], [0.5, -0.35, 1], [-0.004, -0.03, -0.365]],
  lMag: [[1, 0, 0.06], [0, -1, 0.35], [-0.014, -0.112, 0.0]],     // mag space
  lSlap: [[1, -0.1, 0.1], [0.1, -0.75, 0.66], [-0.027, -0.036, -0.015]],
};

// ================================================================= Weapon
export class Weapon {
  constructor({ renderer, audio } = {}) {
    this.audio = audio;
    this.renderer = renderer;
    this.magSize = MAG;
    this.currentSpread = 0;
    this.aimFov = 50;          // suggested world-camera FOV at full aim (main.js zooms toward it)
    this.aimAmount = 0;        // eased 0..1 (0 while reloading / sprinting)
    this.lean = 0;             // smoothed lean -1..1

    // ---- view scene, camera and lighting (warm afternoon sun from the upper left)
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(LAYOUT.hipFov, (typeof innerWidth !== 'undefined' ? innerWidth / innerHeight : 16 / 9), 0.01, 20);
    this.viewScene.add(this.viewCamera);
    this.viewScene.add(new THREE.HemisphereLight(0xd8e8ff, 0x9a8466, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.9);
    sun.position.set(-0.55, 1.0, 0.45);
    this.viewScene.add(sun);
    const fill = new THREE.DirectionalLight(0xffe2c0, 0.55); // warm bounce from the sunlit street
    fill.position.set(0.4, -0.6, 0.3);
    this.viewScene.add(fill);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.6);   // cool sky rim from ahead, separates the gun from the world
    rim.position.set(0.3, 0.4, -1);
    this.viewScene.add(rim);
    this._makeEnvironment();

    // ---- materials
    const mt = metalTextures();
    mt.map.repeat.set(1, 1);
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, map: mt.map, roughnessMap: mt.rough, roughness: 1.0, metalness: 0.4 }),
      poly: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, roughnessMap: noiseTexture(128, 200, 40), bumpMap: noiseTexture(128, 128, 110), bumpScale: 0.6 }),
      glove: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, bumpMap: gloveTexture(), bumpScale: 1.2 }),
      sleeve: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0, map: camoTexture(), bumpMap: fabricTexture(), bumpScale: 0.9 }),
      brass: new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.4, metalness: 0.85 }),
    };
    this.mats.sleeve.bumpMap.repeat.set(10, 10);
    this.mats.poly.roughnessMap.repeat.set(3, 3); this.mats.poly.bumpMap.repeat.set(10, 10);

    // ---- rig hierarchy: rig (animated) → gun parts, muzzle; arms are skinned meshes in view space
    this.rig = new THREE.Group();
    this.viewScene.add(this.rig);
    const gun = buildGun();
    this.gunMetal = new THREE.Mesh(gun.metal, this.mats.metal);
    this.gunPoly = new THREE.Mesh(gun.poly, this.mats.poly);
    this.bolt = new THREE.Mesh(gun.bolt, this.mats.metal);
    this.mag = new THREE.Mesh(gun.mag, this.mats.poly);
    this.magHome = new THREE.Vector3(0, -0.045, -0.077);
    this.mag.position.copy(this.magHome);
    this.lens = new THREE.Mesh(gun.lens, lensMaterial());
    this.lens.renderOrder = 2;
    this.rig.add(this.gunMetal, this.gunPoly, this.bolt, this.mag, this.lens);

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
        map: flashTexture(), color: 0xf2c89a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0, forceSinglePass: true,
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
    this.rec = { z: new Spring(260, 24), pitch: new Spring(230, 21), roll: new Spring(160, 16), x: new Spring(200, 20), yaw: new Spring(200, 20) };
    this.sway = { x: new Spring(90, 14), y: new Spring(90, 14), land: new Spring(120, 13) };
    this.leanS = new Spring(70, 15);
    this.xScale = 1; this.yOff = 0; this.hipFov = LAYOUT.hipFov; this.viewHeight = 0;
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
    const L = LAYOUT;
    const mats = { glove: this.mats.glove, sleeve: this.mats.sleeve };
    this.armR = new Arm(1, mats);
    this.armL = new Arm(-1, mats, { watch: true });
    this.viewScene.add(...this.armR.meshes, ...this.armL.meshes);

    // ---- right hand on the pistol grip: seat the palm, wrap the fingers, place the index finger
    const rH = handFrame(1, V3(L.rGrip[0]), V3(L.rGrip[1]), V3(L.rGrip[2]));
    seatPalm(rH, 1, sdfLower, 0.0006);
    this.rHand = rH;
    const rp = { fingers: [[0, 0.2, 0.3, 0.2], [0.03, 0.25, 0.1, 0.05], [-0.01, 0.25, 0.1, 0.05], [-0.06, 0.25, 0.1, 0.05]], thumb: [0.15, 0.35, 0.1, 0.05, 0.05] };
    for (let i = 1; i < 4; i++) rp.fingers[i] = grasp(rH, sdfLower, FINGERS[i], rp.fingers[i]);
    // thumb: around the back of the grip onto the left side, under the selector
    const thT = new THREE.Vector3(-0.025, -0.071, 0.05), thM = new THREE.Vector3(-0.017, -0.06, 0.088);
    const thPen = (W, r) => { let c = 0; for (let k = 0; k < 3; k++) for (let s = k ? 0 : 3; s <= 5; s++) { const d = sdfLower(_v1.lerpVectors(W[k], W[k + 1], s / 5)) - r[k] * 0.92; if (d < 0) c += d * d * 4e5; } return c; };
    const sTh = solveDigit(rH, -1, [0.4, 0.3, 0.2, 0.2, 0.15], (W, pad, r, x) => W[3].distanceToSquared(thT) * 1e4 + W[2].distanceToSquared(thM) * 3e3 + thPen(W, r) + (x[3] ** 2 + x[4] ** 2) * 0.01,
      { limits: [[-0.4, 1.4], [-0.8, 1.2], [-0.8, 0.8], [-0.1, 1.0], [-0.2, 1.1]], steps: 200 });
    rp.thumb = sTh.angles;
    const trig = new THREE.Vector3(0, -0.071, -0.0092), rel = new THREE.Vector3(0.0305, -0.042, -0.02), frame = new THREE.Vector3(0.035, -0.041, -0.075);
    const pen = (W, r) => { // penetration of the finger into the gun (the trigger itself is not in the SDF)
      let c = 0;
      for (let k = 0; k < 3; k++) for (let s = k ? 0 : 2; s <= 5; s++) { const d = sdfLower(_v1.lerpVectors(W[k], W[k + 1], s / 5)) - r[k] * 0.95; if (d < 0) c += d * d * 4e5; }
      return c;
    };
    const lim = [[-0.35, 0.35], [-0.3, 1.5], [0, 1.8], [0, 1.2]];
    const sTrig = solveDigit(rH, 0, [0.05, 0.4, 0.9, 0.4], (W, pad, r, x) => pad.distanceToSquared(trig) * 1e4 + pen(W, r) + (x[3] - 0.6 * x[2]) ** 2 * 0.02, { limits: lim, steps: 120 });
    const sRel = solveDigit(rH, 0, [0.1, 0.3, 0.5, 0.3], (W, pad, r, x) => pad.distanceToSquared(rel) * 1e4 + pen(W, r) + (x[3] - 0.6 * x[2]) ** 2 * 0.02, { limits: lim, steps: 120 });
    const sFrame = solveDigit(rH, 0, [0.1, 0.1, 0.05, 0.05], (W, pad, r, x) => W[3].distanceToSquared(frame) * 1e4 + pen(W, r) + (x[2] ** 2 + x[3] ** 2) * 0.05, { limits: lim, steps: 120 });
    this.solveInfo = { trig: sTrig.cost, rel: sRel.cost, frame: sFrame.cost, thumb: sTh.cost, thumbTip: sTh.joints[3].toArray().map((v) => +v.toFixed(3)) };
    const mk = (idx) => poseQuats({ fingers: [idx, ...rp.fingers.slice(1)], thumb: rp.thumb });
    const pull = sTrig.angles.slice(); pull[2] += 0.28; pull[3] += 0.14; pull[1] += 0.05;
    this.rPoses = { trigger: mk(sTrig.angles), pull: mk(pull), frame: mk(sFrame.angles), release: mk(sRel.angles) };
    this.rPoseDbg = { rp, trig: sTrig.angles, frame: sFrame.angles, rel: sRel.angles };

    // ---- left hand under the handguard (solved as a mirrored right hand)
    const solveLeft = (H, sdf, init, opts = {}) => {
      const Hm = mirrorMatrix(H), sm = mirrored(sdf);
      const p = { fingers: init.fingers.map((f, i) => grasp(Hm, sm, FINGERS[i], f, opts.finger)), thumb: grasp(Hm, sm, null, init.thumb, { thumb: true, ...(opts.thumb || {}) }) };
      return p;
    };
    const lH = handFrame(-1, V3(L.lGuard[0]), V3(L.lGuard[1]), V3(L.lGuard[2]));
    seatPalm(lH, -1, sdfGuard, 0.0006);
    const lp = solveLeft(lH, sdfGuard, { fingers: [[-0.06, 0.2, 0.15, 0.1], [0, 0.2, 0.15, 0.1], [0.05, 0.2, 0.15, 0.1], [0.1, 0.2, 0.15, 0.1]], thumb: [0.05, 0.1, 0.0, 0.05, 0.05] },
      { thumb: { vel: [0.5, 1, 1], max: [0.7, 0.8, 0.9] } });
    // mag grip (in magazine space) and the bolt-catch slap
    const mH = handFrame(-1, V3(L.lMag[0]), V3(L.lMag[1]), V3(L.lMag[2]));
    seatPalm(mH, -1, sdfMag, 0.0006);
    const mp = solveLeft(mH, sdfMag, { fingers: [[0.05, 0.2, 0.2, 0.1], [0, 0.2, 0.2, 0.1], [-0.03, 0.2, 0.2, 0.1], [-0.06, 0.2, 0.2, 0.1]], thumb: [0.1, 0.2, 0.0, 0.05, 0.05] },
      { thumb: { vel: [0.6, 1, 1], max: [0.8, 0.8, 0.9] } });
    const sH = handFrame(-1, V3(L.lSlap[0]), V3(L.lSlap[1]), V3(L.lSlap[2]));
    seatPalm(sH, -1, sdfLower, 0.001);
    this.lPoses = {
      grip: poseQuats(lp, true), mag: poseQuats(mp, true),
      open: poseQuats({ fingers: [[-0.08, 0.25, 0.35, 0.2], [0, 0.3, 0.4, 0.25], [0.06, 0.35, 0.45, 0.25], [0.12, 0.4, 0.5, 0.3]], thumb: [0.1, 0.3, 0.1, 0.15, 0.1] }, true),
      flat: poseQuats({ fingers: [[-0.05, 0.05, 0.08, 0.05], [0, 0.05, 0.08, 0.05], [0.04, 0.08, 0.1, 0.05], [0.08, 0.1, 0.12, 0.08]], thumb: [0.0, 0.45, 0.0, 0.05, 0.05] }, true),
    };
    this.lPoseDbg = { lp, mp };
    this.armR.setFingers(this.rPoses.trigger);
    this.armL.setFingers(this.lPoses.grip);

    // Left-hand key poses (gun space) for the reload.
    const pq = (m) => { const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, _v1); return { p, q }; };
    const magAt = (pos, rx = 0, rz = 0) => new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), ONE).multiply(mH);
    this.poseA = pq(lH);                                                                        // on the handguard
    this.poseB = pq(magAt(this.magHome));                                                       // new mag seated
    this.poseP = pq(magAt(this.magHome.clone().add(new THREE.Vector3(0, -0.07, 0.014)), -0.14)); // mag just below the well
    this.poseD = pq(magAt(new THREE.Vector3(-0.1, -0.4, 0.1), 0.5, 0.6));                       // down at the pouch
    this.poseS = pq(sH);                                                                        // slap the bolt catch
    this.magInHand = mH.clone().invert();
    this.lHandP = this.poseA.p.clone(); this.lHandQ = this.poseA.q.clone();
    this.lFinger = [this.lPoses.grip, null, 0];
    this._lq = this.lPoses.grip.map((q) => q.clone());
    this._rq = this.rPoses.trigger.map((q) => q.clone());
    this.idxMix = { frame: 0, release: 0 };
    this.shoulders = {
      r: V3(L.rShoulder), re: V3(L.rElbow), rA: V3(L.rShoulderAds), reA: V3(L.rElbowAds),
      l: V3(L.lShoulder), le: V3(L.lElbow), lA: V3(L.lShoulderAds), leA: V3(L.lElbowAds),
    };
  }

  reset() {
    this.ammo = MAG; this.reserve = RESERVE; this.isReloading = false;
    this.cool = 0; this.reloadT = 0; this.emptyCool = 0; this.flashT = 0; this.boltT = 1; this.boltLocked = false;
    this.bloom = 0; this.currentSpread = 0.003; this.lastShot = 10;
    this.t = 0; this.bobPhase = 0; this.bobAmt = 0; this.sprint = 0; this.wasGrounded = true; this.airT = 0;
    this.trigger = 0; this.reloadWithEmpty = false; this.magSwapped = false;
    this.aimLin = 0; this.aimK = 0; this.aimAmount = 0; this.aimDir = 1; this.lean = 0;
    Object.values(this.rec).forEach((s) => s.reset());
    Object.values(this.sway).forEach((s) => s.reset());
    this.leanS.reset();
    this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    this.lHandP.copy(this.poseA.p); this.lHandQ.copy(this.poseA.q);
    this.idxMix.frame = 0; this.idxMix.release = 0;
    this.smoke.clear(); this.dust.clear(); this.sparks.clear();
    this.casingData.forEach((c) => (c.alive = false)); this.casings.count = 0;
    this.chipData.length = 0; this.chips.count = 0;
    this.decalUsed = 0; this.decalNext = 0; this.decals.count = 0;
    this.tracerData.length = 0; this.tracers.geometry.instanceCount = 0;
    this.flash.visible = false; this.flashLight.intensity = 0;
    this._applyFov();
    this._pose(0);
  }

  /** Adds reserve ammunition (supply pickups). Returns the number of rounds actually added. */
  addAmmo(n = MAG * 2, max = Infinity) {
    const add = Math.max(0, Math.min(n, max - this.reserve));
    this.reserve += add;
    return add;
  }
  /** Full resupply: magazine and reserve. */
  refill() { this.ammo = MAG; this.reserve = Math.max(this.reserve, RESERVE); }

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

    // recoil impulses (spring-damped); a little softer when shouldered and aimed
    const ads = this.aimK;
    this.rec.z.v += rand(0.85, 1.0);
    this.rec.pitch.v += rand(1.9, 2.4) * lerp(1, 0.8, ads);
    this.rec.roll.v += rand(-1.6, 1.6);
    this.rec.x.v += rand(-0.08, 0.08);
    this.rec.yaw.v += rand(-0.5, 0.5);

    // muzzle flash (smaller when aimed so it does not hide the target)
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * PI * 2;
    const sc = rand(0.075, 0.1) * lerp(1, 0.6, ads);
    this.flash.scale.set(sc, sc, sc * rand(0.8, 1.2));
    this._pose(0);
    this._emitMuzzleFx();

    this.audio?.play('shot', { volume: 1, rate: rand(0.96, 1.04) });
    return { pitchKick: rand(0.0085, 0.0115) * lerp(1, 0.8, ads), yawKick: rand(-0.0045, 0.0045) * lerp(1, 0.7, ads), spread };
  }

  _emitMuzzleFx() {
    this.muzzle.getWorldPosition(_v1);
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(_v1.x + rand(-0.004, 0.004), _v1.y + rand(-0.004, 0.004), _v1.z - rand(0, 0.02),
        rand(-0.05, 0.05), rand(0.05, 0.16), rand(-0.25, -0.05), rand(0.45, 0.85), rand(0.012, 0.02), rand(0.07, 0.12), rand(0.1, 0.16) * lerp(1, 0.6, this.aimK),
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
  /**
   * ctx: { moving, speed01, grounded, lookDX, lookDY, aim: 0..1 (ADS request), lean: -1..1 }.
   * Reloading (and sprinting) drops out of ADS; `aimAmount` is the eased aim for the camera zoom.
   */
  update(dt, { moving = false, speed01 = 0, grounded = true, lookDX = 0, lookDY = 0, aim = 0, lean = 0 } = {}) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.cool -= dt; this.emptyCool -= dt; this.lastShot += dt;
    this.trigger = Math.max(0, this.trigger - dt * 10);

    // aim: linear progress over ~0.18 s, eased; out of ADS while reloading or sprinting
    const wantAim = this.isReloading || this.sprint > 0.5 ? 0 : clamp(aim, 0, 1);
    const prevLin = this.aimLin;
    this.aimLin = clamp(this.aimLin + Math.sign(wantAim - this.aimLin) * Math.min(Math.abs(wantAim - this.aimLin), dt / 0.18), 0, 1);
    if (this.aimLin !== prevLin) this.aimDir = this.aimLin > prevLin ? 1 : -1;
    if (prevLin < 1 && this.aimLin >= 1) { this.sway.land.v -= 0.12; this.rec.z.v -= 0.12; }  // settles with a little weight
    if (prevLin > 0 && this.aimLin <= 0) this.sway.land.v -= 0.08;
    const k = this.aimLin;
    this.aimK = k * k * (3 - 2 * k);
    this.aimAmount = this.aimK;

    // spread: base + movement + air + sustained-fire bloom (recovers); ~25 % when aiming
    this.bloom = Math.max(0, this.bloom - dt * (0.012 + this.bloom * 3.5));
    this.airT = grounded ? 0 : this.airT + dt;
    const target = (0.0028 + (moving ? speed01 * 0.016 : 0) + (grounded ? 0 : 0.014) + this.bloom) * lerp(1, 0.25, this.aimK);
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
    const sprintTarget = moving && speed01 > 0.8 && !this.isReloading && this.lastShot > 0.35 && aim < 0.5 ? 1 : 0;
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
      this.leanS.step(h, clamp(lean, -1, 1));
    }
    this.lean = this.leanS.x;

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
      const kf = clamp(this.flashT / 0.05, 0, 1);
      this.flash.visible = kf > 0.02;
      this.flash.material.opacity = 0.7 * kf;
      this.flashLight.intensity = 0.3 * kf;
    } else { this.flash.visible = false; this.flashLight.intensity = 0; }

    // right index finger: trigger / along the frame (sprint, reload) / on the mag release
    const u = this.reloadT;
    const relT = this.isReloading ? smooth(0.0, 0.08, u) * (1 - smooth(0.2, 0.3, u)) : 0;
    const frameT = this.isReloading ? smooth(0.2, 0.32, u) * (1 - smooth(1.3, 1.5, u)) : smooth(0.3, 0.8, this.sprint);
    this.idxMix.release = relT; this.idxMix.frame = Math.max(frameT, 0);

    this._applyFov();
    this._pose(dt);
    this._updateViewFx(dt);
  }

  _applyFov() {
    const f = lerp(this.hipFov, this.hipFov * LAYOUT.adsFovK, this.aimK);
    if (Math.abs(f - this.viewCamera.fov) > 1e-3) { this.viewCamera.fov = f; this.viewCamera.updateProjectionMatrix(); }
    const hPx = this.viewHeight || (typeof innerHeight !== 'undefined' ? innerHeight : 720);
    this.lens.material.uniforms.pxAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(f) / 2)) / Math.max(200, hPx);
  }

  _pose() {
    const L = LAYOUT, t = this.t, aim = this.aimK, hip = 1 - aim;
    const bob = this.bobAmt * lerp(1, 0.15, aim), ph = this.bobPhase;
    const breathe = (1 - Math.min(1, this.bobAmt * 2)) * lerp(1, 0.45, aim);
    // hip layout → aimed (optical axis on the camera axis)
    let px = lerp(L.hipPos[0] * this.xScale, 0, aim), py = lerp(L.hipPos[1] + this.yOff, -SIGHT_Y, aim), pz = lerp(L.hipPos[2], -L.eyeZ, aim);
    let rx = L.hipRot[0] * hip, ry = L.hipRot[1] * hip, rz = L.hipRot[2] * hip;
    // transition arc: the gun dips and cants on its way up, so it reads as weight rather than a slide
    const arc = Math.sin(PI * this.aimLin);
    py -= 0.012 * arc; rz += 0.075 * arc * (this.aimDir > 0 ? 1 : 0.6); px -= 0.006 * arc * this.aimDir; rx -= 0.02 * arc;

    // idle breathing (slow drift of the dot when aimed)
    py += Math.sin(t * 1.7) * 0.0016 * breathe; rx += Math.sin(t * 1.1) * 0.004 * breathe * lerp(1, 0.4, aim);
    px += Math.sin(t * 0.9) * 0.001 * breathe; ry += Math.sin(t * 0.63) * 0.0016 * breathe * aim;
    // bob: figure-eight
    px += Math.sin(ph) * 0.011 * bob; py -= Math.abs(Math.cos(ph)) * 0.013 * bob; rz += Math.sin(ph) * 0.02 * bob; ry += Math.sin(ph) * 0.012 * bob;
    // look lag
    const sw = lerp(1, 0.25, aim);
    px += this.sway.x.x * 0.9 * sw; py += this.sway.y.x * 0.9 * sw; ry -= this.sway.x.x * 1.6 * sw; rx += this.sway.y.x * 1.2 * sw; rz -= this.sway.x.x * 1.8 * sw;
    // jump / land
    py += this.sway.land.x * 0.12 * lerp(1, 0.45, aim); rx += this.sway.land.x * 0.4 * lerp(1, 0.4, aim);
    // recoil (kept readable when aimed: the optic kicks back and the dot climbs, then settles)
    const rk = lerp(1, 0.5, aim);
    pz += this.rec.z.x * lerp(1, 0.55, aim); py += this.rec.pitch.x * 0.05 * rk; rx += this.rec.pitch.x * lerp(1, 0.32, aim);
    rz += this.rec.roll.x * 0.05 * rk; px += this.rec.x.x * 0.02 * rk; ry += this.rec.yaw.x * 0.03 * rk;
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
      this.lHandP.copy(this.poseA.p); this.lHandQ.copy(this.poseA.q);
      this.lFinger[0] = this.lPoses.grip; this.lFinger[1] = null; this.lFinger[2] = 0;
      this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    }
    px -= 0.03 * tilt; py += 0.045 * tilt; rx += 0.12 * tilt; ry -= 0.05 * tilt; rz -= 0.38 * tilt;

    // lean: roll with the camera a little further and drift toward the lean side
    const ln = this.lean;
    rz -= ln * lerp(0.09, 0.03, aim); px += ln * 0.012 * hip; py -= Math.abs(ln) * 0.007 * hip;

    // compose about a pivot: the grip when at the hip, the eye (optical axis) when aimed
    this.rig.rotation.set(rx, ry, rz, 'XYZ');
    this.rig.quaternion.setFromEuler(this.rig.rotation);
    _v1.set(0, lerp(-0.04, SIGHT_Y, aim), lerp(0.1, L.eyeZ, aim));
    _v2.copy(_v1).applyQuaternion(this.rig.quaternion);
    this.rig.position.set(px + _v1.x - _v2.x, py + _v1.y - _v2.y, pz + _v1.z - _v2.z);
    this.rig.updateMatrixWorld(true);
    this._updateArms();
  }

  _updateArms() {
    const S = this.shoulders, aim = this.aimK;
    // fingers
    const rq = this._rq, P = this.rPoses;
    for (let i = 0; i < 3; i++) {
      rq[i].slerpQuaternions(P.trigger[i], P.pull[i], this.trigger * (1 - this.idxMix.frame));
      if (this.idxMix.frame > 0) rq[i].slerp(P.frame[i], this.idxMix.frame);
      if (this.idxMix.release > 0) rq[i].slerp(P.release[i], this.idxMix.release);
      this.armR.bones[4 + i].quaternion.copy(rq[i]);
    }
    const [la, lb, lk] = this.lFinger;
    this.armL.setFingers(la, lb, lk);
    // right arm (hand locked to the grip)
    _mA.multiplyMatrices(this.rig.matrixWorld, this.rHand);
    _v1.lerpVectors(S.r, S.rA, aim); _v2.lerpVectors(S.re, S.reA, aim);
    this.armR.update(_mA, _v1, _v2);
    // left arm (animated in gun space)
    _mB.compose(this.lHandP, this.lHandQ, ONE);
    _mA.multiplyMatrices(this.rig.matrixWorld, _mB);
    _v1.lerpVectors(S.l, S.lA, aim); _v2.lerpVectors(S.le, S.leA, aim);
    if (this.isReloading) _v2.y -= 0.12 * smooth(0.1, 0.4, this.reloadT) * (1 - smooth(0.9, 1.4, this.reloadT));
    this.armL.update(_mA, _v1, _v2, { flex: [-0.6, 0.8], dev: [-0.5, 0.45] });
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
    }
    // left hand key poses (position lerp with a small arc, rotation slerp) + finger poses
    const G = this.lPoses, F = this.lFinger;
    const seg = (a, b, k, lift = 0) => {
      this.lHandP.lerpVectors(a.p, b.p, k); this.lHandP.y += lift * Math.sin(PI * k);
      this.lHandQ.slerpQuaternions(a.q, b.q, k);
    };
    const fing = (a, b, k) => { F[0] = a; F[1] = b; F[2] = k; };
    const empty = this.reloadWithEmpty;
    if (u < R.handDown[0]) { seat(this, this.poseA); fing(G.grip, null, 0); }
    else if (u < R.handDown[1]) {
      const k = smooth(R.handDown[0], R.handDown[1], u);
      seg(this.poseA, this.poseD, k, -0.03);
      if (k < 0.5) fing(G.grip, G.open, smooth(0, 0.35, k)); else fing(G.open, G.mag, smooth(0.6, 1, k));
    } else if (u < R.handUp[0]) { seat(this, this.poseD); fing(G.mag, null, 0); }
    else if (u < R.handUp[1]) { seg(this.poseD, this.poseP, smooth(R.handUp[0], R.handUp[1], u), 0.02); fing(G.mag, null, 0); }
    else if (u < R.insert[1]) { seg(this.poseP, this.poseB, smooth(R.insert[0], R.insert[1], u)); fing(G.mag, null, 0); }
    else if (u < R.slap[1]) {
      const k = smooth(R.slap[0], R.slap[1], u);
      if (empty) { seg(this.poseB, this.poseS, Math.sin(k * PI * 0.5)); fing(G.mag, G.flat, smooth(0, 0.5, k)); }
      else { seg(this.poseB, this.poseB, 0); this.lHandP.y += 0.012 * Math.sin(k * PI); fing(G.mag, G.open, smooth(0.3, 1, k)); }
    } else if (u < R.back[1]) {
      const k = smooth(R.back[0], R.back[1], u);
      seg(empty ? this.poseS : this.poseB, this.poseA, k, -0.02);
      fing(empty ? G.flat : G.open, G.grip, smooth(0.55, 1, k));
    } else { seat(this, this.poseA); fing(G.grip, null, 0); }
    // the new mag rides in the hand from the pouch until it is seated
    if (u >= R.handUp[0] - 0.08 && u < R.insert[1]) {
      this.mag.visible = true;
      _mB.compose(this.lHandP, this.lHandQ, ONE).multiply(this.magInHand);
      _mB.decompose(this.mag.position, this.mag.quaternion, _v4);
    } else if (u >= R.insert[1]) {
      this.mag.visible = true; this.mag.position.copy(this.magHome); this.mag.quaternion.identity();
    }
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

  /** Suggested world-camera FOV for the current aim (baseFov at the hip → aimFov when aimed). */
  worldFov(baseFov = 72) { return lerp(baseFov, this.aimFov, this.aimK); }

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
    // Keep the gun at a natural place on screen for wide phones, narrow windows and portrait.
    this.xScale = clamp(0.62 + 0.22 * aspect, 0.72, 1.12);
    this.yOff = aspect < 1 ? -0.012 : 0;
    this.hipFov = aspect < 1 ? LAYOUT.hipFov + 24 * clamp((1 - aspect) / 0.55, 0, 1) : LAYOUT.hipFov;
    this.viewCamera.updateProjectionMatrix();
    if (this.lens) this._applyFov();
  }
}

function seat(w, pose) { w.lHandP.copy(pose.p); w.lHandQ.copy(pose.q); }
