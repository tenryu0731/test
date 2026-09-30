// Light utility helicopter the player can board on the helipad outside the south gate and fly over
// the town and the countryside (arcade flight model, third-person chase camera driven by main.js).
//
//   const heli = new Helicopter({ scene, physics, world, pad })
//   heli.reset()                         back on the pad, rotor stopped
//   heli.canBoard(pos) / heli.canExit()  interaction checks
//   heli.update(dt, ctl)                 ctl = { move {x, y}, up, down, boost, heading } while piloted, null otherwise
//   heli.exitSpot(out)                   a free spot beside the cabin to put the pilot down
import * as THREE from 'three';
import { LAKE } from './layout.js';

const ROTOR_R = 5.2;
const BODY_R = 4.2;           // collision radius (rotor disc, slightly inside the tips)
const BODY_H = 3.4;           // collision height above the skids
const MAX_SPEED = 28, BOOST_SPEED = 46, CLIMB = 7, CEILING = 380;
const ROOF_CLEAR = 4.5;       // colliders only reach the eaves: keep this far above them (pitched roofs)

function mat(color, rough, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

// ------------------------------------------------------------------ model (nose toward -z)
function buildModel() {
  const g = new THREE.Group();
  g.name = 'helicopter';
  const paint = mat(0xe8e3d6, 0.42, 0.1), band = mat(0xa3342b, 0.45, 0.1), dark = mat(0x3b3e41, 0.55, 0.5);
  const glass = mat(0x1a242c, 0.06, 0.6, { envMapIntensity: 1.3 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
  };
  // Cabin pod, glazed nose, belly band, engine cowling.
  const pod = new THREE.SphereGeometry(1, 28, 18); pod.scale(1.22, 1.08, 2.05);
  add(pod, paint, 0, 1.55, 0);
  const nose = new THREE.SphereGeometry(1.012, 28, 14, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.16, Math.PI * 0.46);
  nose.rotateY(Math.PI * 0.5); nose.scale(1.22, 1.08, 2.05);
  add(nose, glass, 0, 1.55, 0);
  const side = new THREE.SphereGeometry(1.014, 20, 10, Math.PI * 0.05, Math.PI * 0.3, Math.PI * 0.26, Math.PI * 0.26); side.scale(1.22, 1.08, 2.05);
  add(side, glass, 0, 1.55, 0.35);
  add(side.clone().scale(-1, 1, 1), glass, 0, 1.55, 0.35);
  const belly = new THREE.CylinderGeometry(1.0, 1.0, 1.6, 28, 1, true); belly.rotateX(Math.PI / 2); belly.scale(1.235, 0.3, 1.2);
  add(belly, band, 0, 1.2, 0.2);
  add(new THREE.BoxGeometry(1.0, 0.55, 1.9), paint, 0, 2.55, 0.55);
  add(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12), dark, 0, 2.6, 1.55, Math.PI / 2);
  // Tapered fairing from the cabin into the boom, exhaust, door frames and a boom stripe.
  const fair = new THREE.CylinderGeometry(0.42, 0.95, 1.7, 20); fair.rotateX(Math.PI / 2); fair.scale(1, 0.9, 1);
  add(fair, paint, 0, 1.9, 2.15);
  add(new THREE.CylinderGeometry(0.13, 0.16, 0.55, 10), dark, 0.32, 2.55, 1.75, Math.PI / 2 - 0.3);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 1.15, 0.05), dark, sx * 1.2, 1.55, 0.95);     // door rear frame
    add(new THREE.BoxGeometry(0.03, 0.05, 1.1), dark, sx * 1.16, 2.05, 0.4);      // window top frame
    add(new THREE.BoxGeometry(0.035, 0.08, 0.16), dark, sx * 1.22, 1.35, 0.72);   // door handle
  }
  add(new THREE.CylinderGeometry(0.205, 0.33, 3.2, 12, 1, true), band, 0, 1.95, 4.0, Math.PI / 2).scale.set(1.02, 1, 1.02);
  // Tail boom, fin, stabiliser, tail rotor guard.
  add(new THREE.CylinderGeometry(0.2, 0.42, 5.2, 12), paint, 0, 1.95, 4.1, Math.PI / 2);
  add(new THREE.BoxGeometry(0.08, 1.1, 0.62), band, 0, 2.35, 6.6, -0.4);
  add(new THREE.BoxGeometry(2.0, 0.07, 0.5), paint, 0, 1.98, 5.5);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.42, 0.4), band, sx * 1.0, 2.05, 5.55);   // end plates
  // Skids with struts.
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 8), dark, s * 1.15, 0.07, -0.1, Math.PI / 2);
    add(new THREE.SphereGeometry(0.06, 8, 6), dark, s * 1.15, 0.07, -1.9);
    for (const z of [-0.85, 0.75]) add(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 6), dark, s * 0.95, 0.62, z, 0, 0, s * 0.35);
  }
  // Main rotor: mast, hub, three blades + a faint blur disc when spinning fast.
  add(new THREE.CylinderGeometry(0.09, 0.12, 0.55, 10), dark, 0, 3.05, 0.15);
  const main = new THREE.Group(); main.position.set(0, 3.32, 0.15); g.add(main);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), dark); hub.castShadow = true; main.add(hub);
  const bladeGeo = new THREE.BoxGeometry(ROTOR_R, 0.045, 0.3); bladeGeo.translate(ROTOR_R / 2 + 0.15, 0, 0);
  for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(bladeGeo, dark); b.rotation.set(0, (k * Math.PI * 2) / 3, 0.02); b.castShadow = true; main.add(b); }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_R + 0.15, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x26282a, transparent: true, opacity: 0, depthWrite: false }));
  blur.position.y = 0.02; blur.renderOrder = 2; main.add(blur);
  const tail = new THREE.Group(); tail.position.set(0.16, 2.45, 6.72); g.add(tail);
  const tb = new THREE.BoxGeometry(0.04, 1.1, 0.12);
  for (let k = 0; k < 2; k++) { const b = new THREE.Mesh(tb, dark); b.rotation.x = k * Math.PI / 2; tail.add(b); }
  return { group: g, main, tail, blur, blades: main.children.filter((c) => c !== hub && c !== blur) };
}

function buildPad(scene, pad, groundAt) {
  const g = new THREE.Group();
  g.name = 'helipad';
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 16; a++) for (const r of [0, pad.r * 0.5, pad.r]) {
    const h = groundAt(pad.x + Math.cos(a / 16 * Math.PI * 2) * r, pad.z + Math.sin(a / 16 * Math.PI * 2) * r);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const top = hi + 0.03;              // nearly flush, so walking onto it needs no collider
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r + 0.3, top - lo + 0.4, 40), mat(0x9a968c, 0.85));
  slab.position.set(pad.x, (top + lo - 0.4) / 2, pad.z); slab.receiveShadow = true; g.add(slab);
  const paintM = mat(0xece7da, 0.7), yellow = mat(0xd8b23a, 0.7);
  const ring = new THREE.Mesh(new THREE.RingGeometry(pad.r - 1.0, pad.r - 0.6, 48).rotateX(-Math.PI / 2), yellow);
  ring.position.set(pad.x, top + 0.012, pad.z); g.add(ring);
  const bar = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), paintM); m.position.set(pad.x + x, top + 0.014, pad.z + z); g.add(m); };
  bar(0.7, 4.2, -1.3, 0); bar(0.7, 4.2, 1.3, 0); bar(1.9, 0.6, 0, 0);
  scene.add(g);
  return top;
}

// ------------------------------------------------------------------ helicopter
export class Helicopter {
  constructor({ scene, physics, world, pad }) {
    this.physics = physics; this.world = world; this.pad = pad;
    const m = buildModel();
    Object.assign(this, { group: m.group, mainRotor: m.main, tailRotor: m.tail, blur: m.blur });
    scene.add(this.group);
    this.padTop = buildPad(scene, pad, world.groundAt);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.rotor = 0; this.spin = 0;
    this.piloted = false; this.landed = true; this.altitude = 0;
    this._d = new THREE.Vector3(); this._p = new THREE.Vector3();
    // Water: the lake and the river (surface polyline from the terrain), where it cannot set down.
    const rv = world.parts?.terrain?.river;
    this._river = rv ? { pts: rv.points, hw: rv.halfWidth + 1 } : null;
    this.noLand = false;
    this.reset();
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  reset() {
    this.pos.set(this.pad.x, this.padTop, this.pad.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.pad.yaw || 0; this.pitch = this.roll = 0;
    this.rotor = 0; this.piloted = false; this.landed = true; this.altitude = 0;
    this._pose(0);
  }

  /** Water surface under (x, z), or -Infinity. */
  waterAt(x, z) {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) return LAKE.y;
    const r = this._river;
    if (!r) return -Infinity;
    const P = r.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay, az] = P[i], [bx, by, bz] = P[i + 1], vx = bx - ax, vz = bz - az, vv = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / vv));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < r.hw) return ay + (by - ay) * t;
    }
    return -Infinity;
  }

  /** Lowest safe height under the airframe. Sets noLand over buildings (the colliders stop at the
   *  eaves, the pitched roof rises above them) and over water: it hovers there instead of landing. */
  groundUnder(x, z, y) {
    const terr = this.world.groundAt(x, z);
    let h = this.physics.groundHeight(x, z, 2.4, y + 0.5 - ROOF_CLEAR);
    this.noLand = false;
    if (h > terr + 0.8) { h += ROOF_CLEAR; this.noLand = true; }
    const w = this.waterAt(x, z);
    if (w + 0.6 > h) { h = w + 0.6; this.noLand = true; }
    if (Math.hypot(x - this.pad.x, z - this.pad.z) < this.pad.r) { h = Math.max(h, this.padTop); this.noLand = false; }
    return h;
  }

  canBoard(p) {
    return !this.piloted && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 5.5 && Math.abs(p.y - this.pos.y) < 3;
  }
  canExit() { return this.piloted && this.landed && this.speed < 3; }

  /** A free spot beside the cabin (left, right, behind, front) for the pilot to step out to. */
  exitSpot(out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tries = [[-c, s], [c, -s], [s, c], [-s, -c]];            // left, right, back, front
    for (const [dx, dz] of tries) for (const d of [3.2, 4.5, 6]) {
      const x = this.pos.x + dx * d, z = this.pos.z + dz * d;
      const p = this._p.set(x, this.pos.y + 0.2, z);
      this.physics.moveCircle(p, this._d.set(0, 0, 0), 0.4, 1.7);
      if (Math.hypot(p.x - x, p.z - z) > 0.05) continue;           // pushed: blocked
      const g = this.physics.groundHeight(x, z, 0.35, this.pos.y + 1);
      if (Math.abs(g - this.pos.y) > 1.6) continue;                 // a drop or a wall
      return out.set(x, g, z);
    }
    return out.set(this.pos.x, this.pos.y, this.pos.z);
  }

  update(dt, ctl) {
    const flying = !!ctl;
    // Rotor spools up while someone is at the controls, down otherwise.
    this.rotor = THREE.MathUtils.clamp(this.rotor + (flying ? dt / 2.2 : -dt / 5), 0, 1);
    const lift = this.rotor > 0.85;
    if (flying && ctl.heading !== undefined) {
      // Nose turns toward the camera heading (chase-camera steering), at a helicopter-like rate.
      let d = ((ctl.heading - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const rate = this.landed ? 0 : 1.9;
      this.yawRate = THREE.MathUtils.clamp(d * 3, -rate, rate);
      this.yaw += this.yawRate * dt;
    } else this.yawRate = 0;

    // Target velocities.
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let tvx = 0, tvz = 0, tvy = 0;
    if (flying && lift) {
      const vmax = ctl.boost ? BOOST_SPEED : MAX_SPEED;
      const mv = ctl.move || { x: 0, y: 0 };
      if (!this.landed) {
        tvx = (-s * mv.y + c * mv.x) * vmax;
        tvz = (-c * mv.y - s * mv.x) * vmax;
      }
      tvy = ((ctl.up ? 1 : 0) - (ctl.down ? 1 : 0)) * CLIMB * (ctl.boost ? 1.4 : 1);
    } else if (!this.landed) tvy = lift ? -1.5 : -9;                 // unmanned / spooling down: settle
    const kh = Math.min(1, dt * (flying ? 0.95 : 0.6)), kv = Math.min(1, dt * 2.4);
    this.vel.x += (tvx - this.vel.x) * kh;
    this.vel.z += (tvz - this.vel.z) * kh;
    this.vel.y += (tvy - this.vel.y) * kv;

    // Move with collision against buildings / towers / trees (boxes above the skids block).
    const p = this.pos;
    // The collision body reaches ROOF_CLEAR below the skids: box tops stop at the eaves, so this keeps
    // the airframe out of the pitched roofs above them (and matches the hover floor in groundUnder).
    p.y -= ROOF_CLEAR;
    this.physics.moveCircle(p, this._d.set(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt), BODY_R, BODY_H + ROOF_CLEAR);
    p.y += ROOF_CLEAR;
    const b = this.world.bounds;
    p.x = THREE.MathUtils.clamp(p.x, b.minX + 5, b.maxX - 5);
    p.z = THREE.MathUtils.clamp(p.z, b.minZ + 5, b.maxZ - 5);
    const g = this.groundUnder(p.x, p.z, p.y);
    if (p.y <= g + 0.02) {
      if (this.vel.y < -0.1 || p.y < g) p.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      if (!this.noLand) { this.vel.x *= Math.exp(-dt * 6); this.vel.z *= Math.exp(-dt * 6); }
      this.landed = !this.noLand;
    } else this.landed = !this.noLand && p.y - g < 0.15;
    this.blocked = this.noLand && p.y - g < 0.6;          // holding just above a roof or water
    if (p.y > CEILING) { p.y = CEILING; this.vel.y = Math.min(0, this.vel.y); }
    this.altitude = p.y - Math.max(this.world.groundAt(p.x, p.z), this.waterAt(p.x, p.z));   // above the street / field / water
    this._pose(dt);
  }

  _pose(dt) {
    // Attitude from the velocity in the helicopter's frame: nose down to fly forward, bank to strafe/turn.
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const fwd = -s * this.vel.x - c * this.vel.z, right = c * this.vel.x - s * this.vel.z;
    const tp = this.landed ? 0 : -THREE.MathUtils.clamp(fwd / BOOST_SPEED, -1, 1) * 0.2;
    const tr = this.landed ? 0 : -THREE.MathUtils.clamp(right / MAX_SPEED, -1, 1) * 0.22 - (this.yawRate || 0) * 0.06;
    const k = dt ? Math.min(1, dt * 3) : 1;
    this.pitch += (tp - this.pitch) * k; this.roll += (tr - this.roll) * k;
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.spin += dt * this.rotor * this.rotor * 34;
    this.mainRotor.rotation.y = -this.spin;
    this.tailRotor.rotation.x = this.spin * 2.3;
    this.blur.material.opacity = THREE.MathUtils.smoothstep(this.rotor, 0.55, 1) * 0.22;
  }
}
