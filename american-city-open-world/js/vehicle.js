// 車両: 手続き生成のモデル（実在の車種・ロゴは再現しない）と、アーケード寄りの挙動
import * as THREE from 'three';
import { clamp, damp } from './config.js';

const shared = {};
function sharedMats() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1014, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 });
  shared.tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  shared.rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 1 });
  shared.dark = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.6 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 });
  shared.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.6, roughness: 0.1 });
  shared.tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 0.5, roughness: 0.2 });
  shared.plate = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.5 });
  shared.cargo = new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.55, metalness: 0.3 });
  shared.taxiSign = makeTextMat('TAXI', '#f7d21a', '#111');
  return shared;
}
function makeTextMat(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64); g.fillStyle = fg; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.4 });
}

const PAINTS = [0xe8e8e6, 0x111214, 0x9ea3a8, 0x5b6066, 0x1b2a4a, 0x7c1010, 0x2c4a36, 0xb8a98c, 0x3a3f46, 0xf2f2ef, 0x0f1d33, 0x6e6a63];
export const TYPES = {
  sedan: { L: 4.75, W: 1.86, hs: 1, wr: 0.36, wb: 1.42, mass: 1, vmax: 52 },
  suv: { L: 4.9, W: 1.95, hs: 1.2, wr: 0.41, wb: 1.48, mass: 1.3, vmax: 46 },
  taxi: { L: 4.75, W: 1.86, hs: 1, wr: 0.36, wb: 1.42, mass: 1, vmax: 48 },
  truck: { L: 6.6, W: 2.3, hs: 1, wr: 0.45, wb: 2.1, mass: 2.4, vmax: 34 },
};

function bodyShape(L, hs, wr, wb) {
  const s = new THREE.Shape();
  const h = (y) => y * hs, f = L / 2;
  const r = wr + 0.08;
  s.moveTo(f - 0.08, h(0.28));
  s.lineTo(f + 0.02, h(0.52));
  s.quadraticCurveTo(f + 0.04, h(0.74), f - 0.18, h(0.8));
  s.lineTo(f - 1.42, h(0.95));
  s.lineTo(-f + 0.65, h(0.99));
  s.lineTo(-f + 0.08, h(0.95));
  s.quadraticCurveTo(-f - 0.06, h(0.86), -f - 0.02, h(0.52));
  s.lineTo(-f + 0.06, h(0.28));
  s.lineTo(-wb - r, h(0.28));
  s.absarc(-wb, wr, r, Math.PI, 0, true);
  s.lineTo(wb - r, h(0.28));
  s.absarc(wb, wr, r, Math.PI, 0, true);
  s.lineTo(f - 0.08, h(0.28));
  return s;
}
function cabinShape(L, hs) {
  const s = new THREE.Shape(); const h = (y) => y * hs, f = L / 2;
  s.moveTo(f - 1.42, h(0.93));
  s.lineTo(f - 2.3, h(1.40));
  s.lineTo(-f + 1.35, h(1.42));
  s.lineTo(-f + 0.62, h(0.97));
  s.closePath();
  return s;
}
function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

export function makeCarModel(type, rnd = Math.random) {
  const M = sharedMats();
  const T = TYPES[type];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const color = type === 'taxi' ? 0xf2bd1a : PAINTS[Math.floor(rnd() * PAINTS.length)];
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const { L, W, hs, wr, wb } = T;
  if (type === 'truck') {
    // 箱型トラック: キャブ + 荷箱
    add(new THREE.BoxGeometry(W, 1.35, 2.0), paint, 0, 1.05, L / 2 - 1.0);
    add(new THREE.BoxGeometry(W - 0.1, 0.75, 1.2), M.glass, 0, 2.05, L / 2 - 1.35);
    add(new THREE.BoxGeometry(W, 0.12, 1.3), paint, 0, 2.47, L / 2 - 1.35);
    add(new THREE.BoxGeometry(W + 0.1, 2.5, L - 2.25), M.cargo, 0, 2.0, -1.1);
    add(new THREE.BoxGeometry(W, 0.3, L), M.dark, 0, 0.6, 0);
    for (const x of [-0.75, 0.75]) { add(new THREE.BoxGeometry(0.3, 0.18, 0.05), M.head, x, 0.95, L / 2 + 0.01); add(new THREE.BoxGeometry(0.2, 0.25, 0.05), M.tail, x * 1.3, 1.1, -L / 2 - 0.04); }
  } else {
    add(extrude(bodyShape(L, hs, wr, wb), W, 0.07), paint);
    add(extrude(cabinShape(L, hs), W - 0.28, 0.06), M.glass);
    // 屋根（車体色）と A・C ピラー
    add(new THREE.BoxGeometry(W - 0.34, 0.06, (L / 2 - 2.3) - (-L / 2 + 1.35) + 0.1), paint, 0, 1.43 * hs, ((L / 2 - 2.3) + (-L / 2 + 1.35)) / 2);
    for (const sx of [-1, 1]) {
      const ap = add(new THREE.BoxGeometry(0.07, 0.62 * hs, 0.09), paint, sx * (W / 2 - 0.2), 1.17 * hs, L / 2 - 1.86); ap.rotation.x = -0.94;
      const cp = add(new THREE.BoxGeometry(0.07, 0.6 * hs, 0.12), paint, sx * (W / 2 - 0.2), 1.19 * hs, -L / 2 + 0.98); cp.rotation.x = 0.88;
      add(new THREE.BoxGeometry(0.07, 0.45 * hs, 0.08), paint, sx * (W / 2 - 0.17), 1.17 * hs, -0.25);
      add(new THREE.BoxGeometry(0.2, 0.1, 0.12), paint, sx * (W / 2 + 0.06), 0.98 * hs, L / 2 - 1.55);
      // ドアの線
      add(new THREE.BoxGeometry(0.005, 0.5 * hs, 0.02), M.dark, sx * (W / 2 + 0.001), 0.66 * hs, -0.25);
      add(new THREE.BoxGeometry(0.005, 0.03, 0.18), M.chrome, sx * (W / 2 + 0.004), 0.82 * hs, 0.55);
      add(new THREE.BoxGeometry(0.005, 0.03, 0.18), M.chrome, sx * (W / 2 + 0.004), 0.82 * hs, -0.95);
    }
    // 前後: ライト・グリル・ナンバープレート（文字なし）
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.44, 0.12 * hs, 0.12), M.head, sx * (W / 2 - 0.34), 0.66 * hs, L / 2 + 0.0);
      add(new THREE.BoxGeometry(0.42, 0.13 * hs, 0.12), M.tail, sx * (W / 2 - 0.32), 0.74 * hs, -L / 2 - 0.05);
    }
    add(new THREE.BoxGeometry(W * 0.42, 0.16 * hs, 0.05), M.dark, 0, 0.6 * hs, L / 2 + 0.01);
    add(new THREE.BoxGeometry(0.52, 0.13, 0.02), M.plate, 0, 0.42 * hs, L / 2 + 0.03);
    add(new THREE.BoxGeometry(0.52, 0.13, 0.02), M.plate, 0, 0.6 * hs, -L / 2 - 0.02);
    add(new THREE.BoxGeometry(W - 0.05, 0.14, 0.12), M.dark, 0, 0.33 * hs, L / 2 - 0.02);
    add(new THREE.BoxGeometry(W - 0.05, 0.14, 0.12), M.dark, 0, 0.33 * hs, -L / 2 + 0.04);
    if (type === 'taxi') add(new THREE.BoxGeometry(0.75, 0.24, 0.3), M.taxiSign, 0, 1.58 * hs, -0.35);
  }
  // 車輪
  const wheels = [];
  const tireG = new THREE.CylinderGeometry(wr, wr, 0.25, 20).rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(wr * 0.64, wr * 0.64, 0.26, 12).rotateZ(Math.PI / 2);
  const hubG = new THREE.BoxGeometry(0.27, wr * 1.1, 0.07);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * (W / 2 - 0.17), wr, sz * wb * (type === 'truck' ? 1 : 1)); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    add(tireG, M.tire, 0, 0, 0, spin); add(rimG, M.rim, 0, 0, 0, spin);
    const hb = add(hubG, M.rim, 0, 0, 0, spin); hb.rotation.x = 0; const hb2 = add(hubG, M.rim, 0, 0, 0, spin); hb2.rotation.x = Math.PI / 2;
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  // 車の下の接地影（影の解像度が低いときの補助）
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.05, L * 1.02).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, map: blobTex() }));
  sh.position.y = 0.02; sh.renderOrder = 1; root.add(sh);
  return { root, body, wheels, paint };
}
let _blob;
function blobTex() {
  if (_blob) return _blob;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _blob = new THREE.CanvasTexture(c); return _blob;
}

// ---------------------------------------------------------------------------
export class Vehicle {
  constructor(scene, type, rnd) {
    this.type = type; this.spec = TYPES[type];
    const m = makeCarModel(type, rnd);
    this.model = m; this.root = m.root; scene.add(this.root);
    this.pos = new THREE.Vector3(); this.heading = 0; this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.steer = 0; this.y = 0; this.pitch = 0; this.roll = 0; this.wheelAngle = 0;
    this.radius = this.spec.W * 0.52; this.halfL = this.spec.L / 2;
    this.mode = 'ai';   // 'ai' | 'player' | 'parked'
    this.impact = 0; this.skid = 0; this.speed = 0;
  }
  get forward() { return [Math.sin(this.heading), Math.cos(this.heading)]; }
  get vLong() { const [fx, fz] = this.forward; return this.vx * fx + this.vz * fz; }
  setPose(x, z, heading) { this.pos.set(x, 0, z); this.heading = heading; this.vx = this.vz = 0; this.sync(0); }

  // 衝突用の円（前・中・後）
  circles() {
    const [fx, fz] = this.forward, o = this.halfL - this.radius * 0.95;
    return [[this.pos.x + fx * o, this.pos.z + fz * o], [this.pos.x, this.pos.z], [this.pos.x - fx * o, this.pos.z - fz * o]];
  }

  // プレイヤーの運転
  drive(dt, inp, city) {
    const S = this.spec;
    const [fx, fz] = this.forward; const rx = -fz, rz = fx;
    let vl = this.vx * fx + this.vz * fz, vlat = this.vx * rx + this.vz * rz;
    const thr = inp.throttle, hb = inp.handbrake;
    // 加速・ブレーキ・後退
    let acc = 0;
    if (thr > 0.05) acc = vl < -0.5 ? 16 * thr : 9.5 * thr * clamp(1 - vl / S.vmax, 0, 1) / Math.sqrt(S.mass);
    else if (thr < -0.05) acc = vl > 0.5 ? -15 * -thr : -6 * -thr * clamp(1 + vl / 14, 0, 1);
    vl += acc * dt;
    vl -= vl * (0.06 + Math.abs(vl) * 0.0018) * dt * 2; // 空気・転がり抵抗
    if (hb) vl -= Math.sign(vl) * Math.min(Math.abs(vl), 7 * dt);
    if (Math.abs(thr) < 0.05 && Math.abs(vl) < 0.3) vl = 0;
    // 操舵（速いほど切れ角を減らす）
    const maxSteer = 0.62 / (1 + Math.abs(vl) / 16);
    this.steer = damp(this.steer, inp.steer * maxSteer, 9, dt);
    const wheelBase = S.wb * 2;
    let targetYaw = -(vl / wheelBase) * Math.tan(this.steer); // 右（+）に切ると時計回り
    if (hb) targetYaw *= 1.45;
    this.yawRate = damp(this.yawRate, targetYaw, hb ? 5 : 10, dt);
    this.heading += this.yawRate * dt;
    // 横滑り（グリップ）。サイドブレーキでドリフト
    const grip = hb ? 1.2 : (Math.abs(vlat) > 6 ? 4 : 9);
    vlat *= Math.exp(-grip * dt);
    this.skid = clamp((Math.abs(vlat) - 1.5) / 6, 0, 1) + (hb && Math.abs(vl) > 5 ? 0.5 : 0);
    const [nfx, nfz] = this.forward; const nrx = -nfz, nrz = nfx;
    this.vx = nfx * vl + nrx * vlat; this.vz = nfz * vl + nrz * vlat;
    this.integrate(dt, city);
  }

  integrate(dt, city) {
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    this.collideWorld(city);
    this.speed = Math.hypot(this.vx, this.vz);
    this.sync(dt, city);
  }

  collideWorld(city) {
    const b = city.bounds;
    let hit = 0;
    for (const [cx, cz] of this.circles()) {
      const { boxes, poles } = city.query(cx, cz, this.radius + 1);
      const r = this.radius;
      for (const bx of boxes) {
        const px = clamp(cx, bx.x0, bx.x1), pz = clamp(cz, bx.z0, bx.z1);
        const dx = cx - px, dz = cz - pz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-3; hit = Math.max(hit, this.resolve(dx / d, dz / d, r - d)); }
      }
      for (const p of poles) {
        const dx = cx - p.x, dz = cz - p.z, d2 = dx * dx + dz * dz, rr = r + p.r;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; hit = Math.max(hit, this.resolve(dx / d, dz / d, rr - d)); }
      }
      if (cx < b.x0 + r) hit = Math.max(hit, this.resolve(1, 0, b.x0 + r - cx));
      if (cx > b.x1 - r) hit = Math.max(hit, this.resolve(-1, 0, cx - (b.x1 - r)));
      if (cz < b.z0 + r) hit = Math.max(hit, this.resolve(0, 1, b.z0 + r - cz));
      if (cz > b.z1 - r) hit = Math.max(hit, this.resolve(0, -1, cz - (b.z1 - r)));
    }
    if (hit > 2) this.impact = Math.max(this.impact, hit);
  }
  // 押し戻して、法線方向の速度を消す（少し跳ね返る）
  resolve(nx, nz, depth) {
    this.pos.x += nx * depth; this.pos.z += nz * depth;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= vn * nx * 1.25; this.vz -= vn * nz * 1.25;
      this.vx *= 0.85; this.vz *= 0.85; this.yawRate *= 0.6;
      return -vn;
    }
    return 0;
  }

  // モデルの姿勢を更新（車体の傾き・車輪の回転）
  sync(dt, city) {
    const gy = city ? city.groundAt(this.pos.x, this.pos.z) : 0;
    this.y = dt ? damp(this.y, gy, 18, dt) : gy;
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.root.rotation.y = this.heading;
    if (!dt) return;
    const vl = this.vLong;
    const [fx, fz] = this.forward;
    const vlat = this.vx * -fz + this.vz * fx;
    const latAcc = this.yawRate * vl;
    this.roll = damp(this.roll, clamp(-latAcc * 0.006, -0.07, 0.07) + clamp(vlat * 0.004, -0.03, 0.03), 6, dt);
    const lastV = this._lastV ?? vl; const longAcc = (vl - lastV) / Math.max(dt, 1e-3); this._lastV = vl;
    this.pitch = damp(this.pitch, clamp(-longAcc * 0.004, -0.05, 0.05), 5, dt);
    this.model.body.rotation.set(this.pitch, 0, this.roll);
    this.wheelAngle += vl * dt / this.spec.wr;
    for (const w of this.model.wheels) { w.spin.rotation.x = this.wheelAngle; if (w.front) w.pivot.rotation.y = -this.steer; }
  }
}

// 車どうしの衝突（円の組で押し合う）
export function collideVehicles(list) {
  let maxImpact = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
    if (dx0 * dx0 + dz0 * dz0 > 64) continue;
    for (const ca of a.circles()) for (const cb of b.circles()) {
      const dx = ca[0] - cb[0], dz = ca[1] - cb[1], d2 = dx * dx + dz * dz, rr = a.radius + b.radius;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d, pen = rr - d;
      const ma = a.mode === 'parked' ? 6 : a.spec.mass, mb = b.mode === 'parked' ? 6 : b.spec.mass;
      const ta = mb / (ma + mb), tb = ma / (ma + mb);
      a.pos.x += nx * pen * ta; a.pos.z += nz * pen * ta; b.pos.x -= nx * pen * tb; b.pos.z -= nz * pen * tb;
      const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rv < 0) {
        const jimp = -1.3 * rv / (1 / ma + 1 / mb);
        a.vx += jimp * nx / ma; a.vz += jimp * nz / ma; b.vx -= jimp * nx / mb; b.vz -= jimp * nz / mb;
        if (a.mode === 'player' || b.mode === 'player') maxImpact = Math.max(maxImpact, -rv);
        if (a.mode === 'ai') a.bumped = 1.5; if (b.mode === 'ai') b.bumped = 1.5;
      }
    }
  }
  return maxImpact;
}
