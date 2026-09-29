// Robot effects: pooled tracers + sparks in one additive InstancedMesh, and the muzzle-flash sprite
// texture. Sparks bounce on the real ground (terrain / town paving), sampled once per burst.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();

export function makeFlashTexture() {
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

export class Streaks {
  // groundAt(x, z) -> ground height used for spark bounces (optional).
  constructor(scene, cap = 200, groundAt = null) {
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
    this.mesh.name = 'robotStreaks';
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cap = cap;
    this.groundAt = groundAt;
    this.items = [];
    this.free = [];
    this._a = new THREE.Vector3(); this._d = new THREE.Vector3();
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
  // `floor` (optional): ground height under the burst; sampled from groundAt when omitted.
  sparks(at, n, bias, speed = 4, hot = 1, floor) {
    let gy = floor;
    if (gy === undefined) gy = this.groundAt ? this.groundAt(at.x, at.z) : 0;
    if (!(gy <= at.y)) gy = at.y - 0.05; // e.g. hit on a roof / wall above a lower street
    for (let i = 0; i < n; i++) {
      const it = this._new(); if (!it) return;
      it.kind = 1; it.p.copy(at); it.gy = gy + 0.01;
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
          if (it.p.y < it.gy && it.v.y < 0) { it.p.y = it.gy; it.v.y *= -0.35; it.v.x *= 0.6; it.v.z *= 0.6; }
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

