// Views: climbable lookout points (ViewpointSystem), the free overview / drone camera of the pause
// menu (OverviewCam) and the slow cinematic flyover behind the start screen (Flyover).
import * as THREE from 'three';
import { MAP_HALF, TOWN } from './layout.js';

const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ================================================================== viewpoints
export const VIEWPOINT_REACH = 3.2;      // horizontal distance to a base that shows 「登る」

export class ViewpointSystem {
  constructor(world) {
    this.list = (world.viewpoints || []).filter((v) => v && v.base && v.top).map((v, i) => ({
      id: v.id || `vp${i}`, name: v.name || '展望ポイント', base: v.base.clone(), top: v.top.clone(),
      yaw: Number.isFinite(v.yaw) ? v.yaw : null, climbed: false,
    }));
    this.current = null;         // viewpoint the player is standing on (top)
  }

  reset() { for (const v of this.list) v.climbed = false; this.current = null; }
  get(id) { return this.list.find((v) => v.id === id) || null; }
  get climbedCount() { let n = 0; for (const v of this.list) if (v.climbed) n++; return n; }

  /** What the interact button would do right now: { mode: 'climb'|'descend', vp } or null. */
  query(pos) {
    if (this.current) return { mode: 'descend', vp: this.current };
    let best = null, bd = VIEWPOINT_REACH * VIEWPOINT_REACH;
    for (const v of this.list) {
      const dx = pos.x - v.base.x, dz = pos.z - v.base.z, d2 = dx * dx + dz * dz;
      if (d2 < bd && Math.abs(pos.y - v.base.y) < 2.6) { bd = d2; best = v; }
    }
    return best ? { mode: 'climb', vp: best } : null;
  }
}

// ================================================================== overview / drone camera
/**
 * Free orbit camera over the world. Touch: 1 finger orbits, 2 fingers pinch-zoom and pan.
 * Mouse: left-drag orbits, right-drag (or Shift + drag) pans, wheel zooms. Keyboard: WASD / arrows pan,
 * Q / E rotate. All motion is damped.
 */
export class OverviewCam {
  constructor({ camera, world, element }) {
    this.camera = camera; this.world = world; this.el = element;
    this.active = false;
    this.target = new THREE.Vector3(); this.goal = { target: new THREE.Vector3(), yaw: 0, pitch: 0.8, dist: 180 };
    this.yaw = 0; this.pitch = 0.8; this.dist = 180;
    this.focus = new THREE.Vector3();
    this._ptr = new Map();
    this._pinch = null;
    this._keys = new Set();
    this._v = new THREE.Vector3();
    const el = element;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0012))); }, { passive: false });
    addEventListener('keydown', (e) => { if (this.active) this._keys.add(e.code); });
    addEventListener('keyup', (e) => this._keys.delete(e.code));
    addEventListener('blur', () => this._keys.clear());
  }

  enter(fromPos, yaw) {
    this.active = true;
    const g = this.world.groundAt || this.world.heightAt;
    // Start just above the player's head, then let the damping lift the drone into place.
    this.target.set(fromPos.x, g(fromPos.x, fromPos.z), fromPos.z);
    this.yaw = yaw; this.pitch = 0.35; this.dist = 6;
    this.goal.target.copy(this.target);
    this.goal.yaw = yaw; this.goal.pitch = 0.72; this.goal.dist = 150;
    this._ptr.clear(); this._pinch = null; this._keys.clear();
    this._apply();
  }
  exit() { this.active = false; this._ptr.clear(); this._pinch = null; }

  zoom(f) { this.goal.dist = clamp(this.goal.dist * f, 12, 1300); }
  lookAt(x, z, dist) {
    this.goal.target.set(x, 0, z);
    if (dist) this.goal.dist = dist;
  }

  _pan(dxPx, dyPx) {
    // Pan in the ground plane, scaled so the ground under the finger follows it.
    const h = this.el.clientHeight || innerHeight;
    const worldPerPx = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // Vertical drags cover more ground when the view is shallow (foreshortening).
    const dy = dyPx / Math.max(0.3, Math.sin(this.pitch));
    // screen right on the ground = (cos, -sin), screen up = forward = (-sin, -cos)
    this.goal.target.x -= (dxPx * c + dy * s) * worldPerPx;
    this.goal.target.z -= (-dxPx * s + dy * c) * worldPerPx;
  }

  _down(e) {
    if (!this.active) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey });
    this._pinch = null;
  }
  _move(e) {
    const p = this._ptr.get(e.pointerId);
    if (!p || !this.active) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (this._ptr.size >= 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...this._ptr.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch) {
        if (d > 10 && this._pinch.d > 10) this.zoom(this._pinch.d / d);
        this._pan(mx - this._pinch.mx, my - this._pinch.my);
      }
      this._pinch = { mx, my, d };
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    const panMode = e.pointerType === 'mouse' && (p.btn === 2 || p.btn === 1 || p.shift || e.shiftKey);
    if (panMode) this._pan(dx, dy);
    else {
      const k = 4.2 / Math.max(innerWidth, innerHeight);
      this.goal.yaw -= dx * k;
      this.goal.pitch = clamp(this.goal.pitch + dy * k * 0.8, 0.12, 1.5);
    }
  }
  _up(e) {
    this._ptr.delete(e.pointerId);
    this._pinch = null;
  }

  update(dt) {
    if (!this.active) return;
    const k = this._keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || ky) this._pan(-kx * 600 * dt, -ky * 600 * dt);
    const kr = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (kr) this.goal.yaw += kr * 1.4 * dt;
    if (k.has('Equal') || k.has('NumpadAdd')) this.zoom(Math.exp(-1.5 * dt));
    if (k.has('Minus') || k.has('NumpadSubtract')) this.zoom(Math.exp(1.5 * dt));

    const lim = MAP_HALF - 20;
    this.goal.target.x = clamp(this.goal.target.x, -lim, lim);
    this.goal.target.z = clamp(this.goal.target.z, -lim, lim);
    const g = this.world.groundAt || this.world.heightAt;
    this.goal.target.y = g(this.goal.target.x, this.goal.target.z);
    this.target.x = damp(this.target.x, this.goal.target.x, 9, dt);
    this.target.z = damp(this.target.z, this.goal.target.z, 9, dt);
    this.target.y = damp(this.target.y, this.goal.target.y, 6, dt);
    this.yaw = damp(this.yaw, this.goal.yaw, 10, dt);
    this.pitch = damp(this.pitch, this.goal.pitch, 10, dt);
    this.dist = Math.exp(damp(Math.log(this.dist), Math.log(this.goal.dist), 7, dt));
    this._apply();
  }

  _apply() {
    const cam = this.camera, cp = Math.cos(this.pitch);
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist);
    const g = this.world.heightAt || this.world.groundAt;
    const floor = Math.max(g(cam.position.x, cam.position.z), TOWN.y) + 3;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.target.x, this.target.y + Math.min(8, this.dist * 0.05), this.target.z);
    this.focus.copy(this.target);
  }
}

// ================================================================== menu flyover
// Slow closed camera path around the walled town and over the countryside. Each key is
// [x, z, heightAboveGround, lookX, lookY, lookZ].
const FLY_KEYS = [
  [40, 330, 42, 0, 14, 90],
  [230, 230, 58, 30, 22, 20],
  [330, -20, 70, 10, 26, -20],
  [240, -300, 64, 10, 22, -80],
  [30, -380, 58, -10, 22, -60],
  [-250, -260, 70, -20, 24, -30],
  [-360, 40, 55, -60, 18, 20],
  [-230, 280, 48, -20, 14, 80],
];

export class Flyover {
  constructor({ world, period = 150 }) {
    this.world = world;
    this.period = period;
    this.t = 0.02;
    const g = world.heightAt || world.groundAt;
    const pos = [], look = [];
    for (const [x, z, h, lx, ly, lz] of FLY_KEYS) {
      pos.push(new THREE.Vector3(x, Math.max(g(x, z), TOWN.y) + h, z));
      look.push(new THREE.Vector3(lx, ly, lz));
    }
    this.posCurve = new THREE.CatmullRomCurve3(pos, true, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(look, true, 'centripetal');
    this.focus = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  update(dt, camera) {
    this.t = (this.t + dt / this.period) % 1;
    const p = this.posCurve.getPoint(this.t, this._p);
    const g = this.world.heightAt || this.world.groundAt;
    p.y = Math.max(p.y, Math.max(g(p.x, p.z), TOWN.y) + 18);
    camera.position.copy(p);
    this.lookCurve.getPoint(this.t, this.focus);
    camera.lookAt(this.focus);
  }
}
