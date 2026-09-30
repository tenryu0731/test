// Tracked tank shared by the player (olive drab, at the motor pool outside the east gate) and the
// enemy training tanks (grey with orange training stripes, driven by enemy-vehicles.js).
//
//   const t = new Tank({ scene, physics, world, livery: 'player' | 'enemy' })
//   t.reset(x, z, yaw)
//   t.drive(dt, throttle -1..1, steer -1..1)     hull movement with collisions and slope pose
//   t.aimAt(dt, point) / t.aimYawPitch(dt, yaw, pitch)   turret traverse and gun elevation (rate limited)
//   t.fireMain() -> { pos, dir } | null           reload-gated main gun, recoil
//   t.muzzle(outPos, outDir)                       barrel tip and bore direction
//   t.damage(amount) / t.destroy()                 hit points and the burnt-out wreck
import * as THREE from 'three';
import { makeWaterAt, mergeByMaterial } from './vehicle-util.js';

const RADIUS = 2.5, HEIGHT = 2.4;
const MAX_FWD = 12, MAX_REV = 5, ACCEL = 7, TURN = 0.95;
const TRAVERSE = 1.1, ELEVATE = 0.6, PITCH_MIN = -0.3, PITCH_MAX = 0.4;

function mat(color, rough = 0.75, metal = 0.25) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }
const LIVERIES = {
  player: { body: 0x5b6640, dark: 0x3f472c, accent: 0x6d7650 },
  enemy: { body: 0x7b7f82, dark: 0x4e5255, accent: 0xd9772b },
};

function buildModel(livery) {
  const L = LIVERIES[livery] || LIVERIES.player;
  const M = { body: mat(L.body), dark: mat(L.dark, 0.8), accent: mat(L.accent, 0.6, 0.1), track: mat(0x2b2a28, 0.9, 0.3), metal: mat(0x3d3f41, 0.5, 0.7) };
  const root = new THREE.Group(); root.name = `tank-${livery}`;
  const hull = new THREE.Group(); root.add(hull);
  const add = (parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  };
  // Hull: lower tub, sloped glacis (extruded profile along x), rear deck, side skirts.
  const prof = new THREE.Shape();
  prof.moveTo(-3.3, 0.55); prof.lineTo(-2.3, 1.55); prof.lineTo(3.0, 1.55); prof.lineTo(3.4, 1.2); prof.lineTo(3.3, 0.55); prof.lineTo(-3.3, 0.55);
  const hullGeo = new THREE.ExtrudeGeometry(prof, { depth: 2.7, bevelEnabled: false });
  hullGeo.translate(0, 0, -1.35); hullGeo.rotateY(-Math.PI / 2);  // profile x → world z (glacis at the nose, -z)
  add(hull, hullGeo, M.body, 0, 0, 0);
  for (const s of [-1, 1]) {
    add(hull, new THREE.BoxGeometry(0.62, 0.9, 6.6), M.track, s * 1.66, 0.52, 0);                    // track run
    add(hull, new THREE.BoxGeometry(0.08, 0.55, 6.2), M.dark, s * 1.99, 1.05, 0);                    // skirt
    for (let k = 0; k < 6; k++) add(hull, new THREE.CylinderGeometry(0.36, 0.36, 0.5, 12), M.metal, s * 1.66, 0.45, -2.5 + k, 0, 0, Math.PI / 2);
    add(hull, new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10), M.metal, s * 1.66, 0.8, -3.1, 0, 0, Math.PI / 2);   // idler
    add(hull, new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10), M.metal, s * 1.66, 0.8, 3.1, 0, 0, Math.PI / 2);    // sprocket
    add(hull, new THREE.BoxGeometry(0.5, 0.35, 1.2), M.dark, s * 1.2, 1.72, 2.2);                   // stowage bins
  }
  add(hull, new THREE.BoxGeometry(2.4, 0.08, 1.6), M.dark, 0, 1.6, 2.3);                            // engine grille
  add(hull, new THREE.BoxGeometry(0.5, 0.2, 0.5), M.dark, -0.7, 1.62, -1.6);                        // driver hatch
  if (livery === 'enemy') for (const s of [-1, 1]) add(hull, new THREE.BoxGeometry(0.1, 0.22, 5.8), M.accent, s * 2.04, 1.12, 0);
  // Turret: faceted body, mantlet, gun, commander cupola, antenna.
  const turret = new THREE.Group(); turret.position.set(0, 1.55, 0.3); hull.add(turret);
  const tp = new THREE.Shape();
  tp.moveTo(-1.35, -1.4); tp.lineTo(1.35, -1.4); tp.lineTo(1.6, 0.2); tp.lineTo(1.2, 1.6); tp.lineTo(-1.2, 1.6); tp.lineTo(-1.6, 0.2); tp.lineTo(-1.35, -1.4);
  const tg = new THREE.ExtrudeGeometry(tp, { depth: 0.85, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
  tg.rotateX(-Math.PI / 2); tg.translate(0, 0, 0);          // shape y → world -z, extrusion up
  add(turret, tg, M.body, 0, 0.05, 0);
  add(turret, new THREE.CylinderGeometry(0.42, 0.46, 0.4, 12), M.dark, -0.55, 1.05, 0.55);          // cupola
  add(turret, new THREE.CylinderGeometry(0.012, 0.012, 2.4, 4), M.metal, 0.9, 2.1, 1.2);           // antenna
  if (livery === 'enemy') add(turret, new THREE.BoxGeometry(2.9, 0.18, 0.12), M.accent, 0, 0.55, -1.52);
  const gun = new THREE.Group(); gun.position.set(0, 0.5, -1.45); turret.add(gun);
  add(gun, new THREE.BoxGeometry(0.9, 0.62, 0.5), M.dark, 0, 0, -0.1);                             // mantlet
  add(gun, new THREE.CylinderGeometry(0.1, 0.13, 4.4, 12), M.metal, 0, 0, -2.4, Math.PI / 2);        // barrel
  add(gun, new THREE.CylinderGeometry(0.17, 0.17, 0.7, 12), M.metal, 0, 0, -2.0, Math.PI / 2);       // fume extractor
  add(gun, new THREE.CylinderGeometry(0.15, 0.15, 0.35, 10), M.dark, 0, 0, -4.55, Math.PI / 2);      // muzzle brake
  const tip = new THREE.Object3D(); tip.position.set(0, 0, -4.8); gun.add(tip);
  // One mesh per material in each moving part (hull / turret / gun) keeps a tank to ~12 draw calls.
  for (const g of [hull, turret, gun]) mergeByMaterial(g);
  return { root, hull, turret, gun, tip, M };
}

export class Tank {
  constructor({ scene, physics, world, livery = 'player', hp = 1500 }) {
    this.physics = physics; this.world = world; this.livery = livery;
    const m = buildModel(livery);
    Object.assign(this, { group: m.root, hullG: m.hull, turretG: m.turret, gunG: m.gun, tipO: m.tip, mats: m.M });
    scene.add(this.group);
    this.waterAt = makeWaterAt(world);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0; this.turn = 0;
    this.turretYaw = 0; this.gunPitch = 0; this.reload = 0; this.recoil = 0;
    this.pitch = 0; this.roll = 0; this.hpMax = hp; this.hp = hp; this.alive = true;
    this.radius = RADIUS; this.cy = 1.4; this.team = livery === 'player' ? 'player' : 'enemy';
    this.reloadTime = 2.4;
    this._d = new THREE.Vector3(); this._p = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
  }

  reset(x, z, yaw = 0) {
    this.pos.set(x, this.world.groundAt(x, z), z);
    this.yaw = yaw; this.speed = 0; this.turn = 0; this.turretYaw = 0; this.gunPitch = 0; this.reload = 0; this.recoil = 0;
    this.hp = this.hpMax; this.alive = true; this.burnT = 0;
    this.group.visible = true;
    for (const k of ['body', 'dark', 'accent']) this.mats[k].color.setHex((LIVERIES[this.livery] || LIVERIES.player)[k]);
    this._settle(0);
  }

  /** Hull movement: throttle / steer in -1..1. Tracks pivot-steer when standing. */
  drive(dt, throttle, steer) {
    if (!this.alive) { this.speed *= Math.exp(-dt * 3); throttle = 0; steer = 0; }
    const target = throttle >= 0 ? throttle * MAX_FWD : throttle * MAX_REV;
    const a = Math.abs(target) > Math.abs(this.speed) ? ACCEL : ACCEL * 1.6;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -a * dt, a * dt);
    this.turn += (steer * TURN * (this.speed < -0.5 ? -1 : 1) - this.turn) * Math.min(1, dt * 5);
    this.yaw -= this.turn * dt;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const p = this.pos, ox = p.x, oz = p.z;
    this.physics.moveCircle(p, this._d.set(-s * this.speed * dt, 0, -c * this.speed * dt), RADIUS, HEIGHT);
    // No driving into deep water (the lake); the river can be forded.
    const g = this.physics.groundHeight(p.x, p.z, 1.2, p.y + 0.6);
    if (this.waterAt(p.x, p.z) > g + 1.5) { p.x = ox; p.z = oz; this.speed *= 0.3; }
    const b = this.world.bounds;
    p.x = THREE.MathUtils.clamp(p.x, b.minX + 3, b.maxX - 3); p.z = THREE.MathUtils.clamp(p.z, b.minZ + 3, b.maxZ - 3);
    const moved = Math.hypot(p.x - ox, p.z - oz);
    if (Math.abs(this.speed) * dt > 0.05 && moved < Math.abs(this.speed) * dt * 0.25) this.speed *= 0.6;   // blocked
    this.track = (this.track || 0) + moved;
    this._settle(dt);
  }

  // Sit on the ground: height from the four track ends, hull pitched and rolled with the slope.
  _settle(dt) {
    const p = this.pos, s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const h = (fx, fz) => this.physics.groundHeight(p.x + fx, p.z + fz, 0.5, p.y + 0.9);
    const hf = h(-s * 2.8, -c * 2.8), hb = h(s * 2.8, c * 2.8), hl = h(-c * 1.5, s * 1.5), hr = h(c * 1.5, -s * 1.5);
    const y = Math.max((hf + hb + hl + hr) / 4, this.world.groundAt(p.x, p.z) - 0.2);
    const k = dt ? Math.min(1, dt * 8) : 1;
    p.y += (y - p.y) * k;
    this.pitch += (Math.atan2(hf - hb, 5.6) - this.pitch) * k;
    this.roll += (Math.atan2(hr - hl, 3.0) - this.roll) * k;
    this._pose(dt);
  }

  _pose(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, -this.roll, 'YXZ');
    this.turretG.rotation.y = this.turretYaw;
    this.recoil = Math.max(0, this.recoil - (dt || 0) * 2.5);
    this.gunG.rotation.x = this.gunPitch;
    this.gunG.position.z = -1.45 + this.recoil * 0.45;
  }

  /** Rotate the turret / gun toward a world yaw and pitch (rate limited). */
  aimYawPitch(dt, yaw, pitch) {
    if (!this.alive) return;
    let d = ((yaw - this.yaw - this.turretYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.turretYaw += THREE.MathUtils.clamp(d, -TRAVERSE * dt, TRAVERSE * dt);
    const tp = THREE.MathUtils.clamp(pitch - this.pitch, PITCH_MIN, PITCH_MAX);
    this.gunPitch += THREE.MathUtils.clamp(tp - this.gunPitch, -ELEVATE * dt, ELEVATE * dt);
    this._pose(0);
  }
  /** Traverse / elevate toward a world point, solved in the hull's frame (exact on slopes, whatever
   *  way the turret faces). */
  aimAt(dt, point) {
    if (!this.alive) return;
    this.group.updateMatrixWorld(true);
    this._m.copy(this.group.matrixWorld).invert();
    const l = this._p.copy(point).applyMatrix4(this._m);
    l.x -= 0; l.y -= 2.05; l.z -= 0.3;                        // turret ring centre, gun trunnion height
    const wantYaw = Math.atan2(-l.x, -l.z), wantPitch = Math.atan2(l.y, Math.hypot(l.x, l.z));
    const d = ((wantYaw - this.turretYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.turretYaw += THREE.MathUtils.clamp(d, -TRAVERSE * dt, TRAVERSE * dt);
    const tp = THREE.MathUtils.clamp(wantPitch, PITCH_MIN, PITCH_MAX);
    this.gunPitch += THREE.MathUtils.clamp(tp - this.gunPitch, -ELEVATE * dt, ELEVATE * dt);
    this._pose(0);
  }
  /** Angle (rad) between the bore and the direction to `point`. */
  aimError(point) {
    const P = this._p, D = this._d;
    this.muzzle(P, D);
    const vx = point.x - P.x, vy = point.y - P.y, vz = point.z - P.z, L = Math.hypot(vx, vy, vz) || 1;
    return Math.acos(THREE.MathUtils.clamp((vx * D.x + vy * D.y + vz * D.z) / L, -1, 1));
  }

  muzzle(outPos, outDir) {
    this.group.updateMatrixWorld(true);
    this.tipO.getWorldPosition(outPos);
    this.gunG.getWorldQuaternion(this._q);
    if (outDir) outDir.set(0, 0, -1).applyQuaternion(this._q);
    return outPos;
  }

  update(dt) {
    if (this.reload > 0) this.reload -= dt;
    this._pose(dt);
  }

  fireMain() {
    if (!this.alive || this.reload > 0) return null;
    this.reload = this.reloadTime; this.recoil = 1;
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.muzzle(pos, dir);
    return { pos, dir };
  }

  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) this.destroy();
  }
  destroy() {
    this.hp = 0; this.alive = false; this.speed = 0;
    for (const k of ['body', 'dark', 'accent']) this.mats[k].color.setHex(0x2a2725);   // burnt out
    this.turretYaw += (Math.random() - 0.5) * 0.8; this.gunPitch = -0.12; this._pose(0);
  }
}

/** Concrete apron with fuel drums at the motor pool. Returns the apron top height. */
export function buildDepot(scene, depot, groundAt) {
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 12; a++) for (const r of [0, depot.r]) {
    const h = groundAt(depot.x + Math.cos(a / 12 * Math.PI * 2) * r, depot.z + Math.sin(a / 12 * Math.PI * 2) * r);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const top = hi + 0.03, g = new THREE.Group(); g.name = 'tank-depot';
  const slab = new THREE.Mesh(new THREE.BoxGeometry(depot.r * 2, top - lo + 0.4, depot.r * 1.6), mat(0x9d998f, 0.9, 0));
  slab.position.set(depot.x, (top + lo - 0.4) / 2, depot.z); slab.receiveShadow = true; g.add(slab);
  const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), dm = mat(0x4d5a3a, 0.6, 0.3);
  for (const [dx, dz] of [[depot.r - 1, depot.r * 0.8 - 0.6], [depot.r - 1.7, depot.r * 0.8 - 0.6], [depot.r - 1.35, depot.r * 0.8 - 1.2]]) {
    const d = new THREE.Mesh(drum, dm); d.position.set(depot.x + dx, top + 0.45, depot.z + dz); d.castShadow = true; g.add(d);
  }
  scene.add(g);
  return top;
}
