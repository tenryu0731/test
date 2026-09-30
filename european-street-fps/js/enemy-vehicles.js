// Enemy training vehicles: tanks patrolling the countryside roads and helicopters flying patrol
// loops. Both engage the player — on foot or in the player's tank / helicopter — and are part of the
// "destroy every enemy" victory condition. Counts scale with the difficulty's enemyCount.
//
//   const ev = new EnemyVehicles({ scene, physics, world, combat, audio })
//   ev.reset(preset)
//   ev.update(dt, { target: { pos, cy, vel, kind: 'foot' | 'tank' | 'heli', alive } })
//   ev.total / ev.remaining / ev.markers()
import * as THREE from 'three';
import { Tank } from './tank.js';
import { Helicopter } from './helicopter.js';
import { TOWN, PLAYER_START, HELIPAD, TANK_DEPOT } from './layout.js';

const BASE_TANKS = 5, BASE_HELIS = 3;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

function inTown(x, z, m = 0) {
  const [x0, x1, z0, z1] = TOWN.rect;
  return x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
}

export class EnemyVehicles {
  constructor({ scene, physics, world, combat, audio }) {
    this.scene = scene; this.physics = physics; this.world = world; this.combat = combat; this.audio = audio;
    this.tanks = []; this.helis = [];
    this.total = 0; this.remaining = 0;
    this.time = 0;
    this._markers = [];
    // Patrol routes: the graded roads outside the town, resampled every ~12 m.
    const roads = world.parts?.terrain?.roads || [];
    this.routes = [];
    for (const r of roads) {
      const pts = [];
      let last = null;
      for (const [x, , z] of r.points) {
        if (inTown(x, z, 28)) continue;
        if (last && Math.hypot(x - last[0], z - last[1]) < 12) continue;
        pts.push([x, z]); last = [x, z];
      }
      if (pts.length >= 4) this.routes.push(pts);
    }
  }

  _pool(list, make, n) {
    while (list.length < n) list.push(make());
    list.forEach((v, i) => { v.inUse = i < n; if (!v.inUse) { v.obj.group.visible = false; v.obj.alive = false; } });
  }

  // opts.none: no vehicles this round (arena modes; tanks can still be added with spawnTank).
  reset(preset, opts = {}) {
    const c = clamp(Number.isFinite(preset?.enemyCount) ? preset.enemyCount : 1, 0.2, 3);
    this.acc = clamp(preset?.enemyAccuracy ?? 1, 0.2, 3);
    this.react = clamp(preset?.enemyReaction ?? 1, 0.2, 5);
    this.view = clamp(preset?.enemyViewDist ?? 1, 0.3, 3);
    this.dmg = clamp(preset?.enemyDamage ?? 1, 0, 5);
    this.hpMul = clamp(preset?.enemyHP ?? 1, 0.2, 5);
    const nT = opts.none ? 0 : Math.max(1, Math.round(BASE_TANKS * c)), nH = opts.none ? 0 : Math.max(1, Math.round(BASE_HELIS * c));
    const mkTank = this._mkTank = () => {
      const t = new Tank({ scene: this.scene, physics: this.physics, world: this.world, livery: 'enemy', hp: 1100 });
      const v = { kind: 'tank', obj: t, name: '敵の訓練戦車' };
      v.target = this.combat.addTarget({ team: 'enemy', pos: t.pos, radius: 2.9, cy: 1.3, get alive() { return t.alive && v.inUse; }, damage: (a) => this._hit(v, a), ref: v });
      return v;
    };
    const mkHeli = () => {
      const h = new Helicopter({ scene: this.scene, physics: this.physics, world: this.world, livery: 'enemy', hp: 520 });
      const v = { kind: 'heli', obj: h, name: '敵の訓練ヘリ' };
      v.target = this.combat.addTarget({ team: 'enemy', pos: h.pos, radius: 3.4, cy: 1.6, get alive() { return h.alive && v.inUse; }, damage: (a) => this._hit(v, a), ref: v });
      return v;
    };
    this._pool(this.tanks, mkTank, nT);
    this._pool(this.helis, mkHeli, nH);
    const avoid = [[PLAYER_START.x, PLAYER_START.z], [HELIPAD.x, HELIPAD.z], [TANK_DEPOT.x, TANK_DEPOT.z]];
    const farFromStart = (x, z) => avoid.every(([ax, az]) => Math.hypot(x - ax, z - az) > 230);
    this.tanks.filter((v) => v.inUse).forEach((v, i) => {
      let route = null, k = 0;
      for (let n = 0; n < 40 && !route; n++) {
        const r = this.routes[(i * 3 + n) % Math.max(1, this.routes.length)];
        if (!r) break;
        const j = Math.floor(Math.random() * r.length);
        if (farFromStart(r[j][0], r[j][1])) { route = r; k = j; }
      }
      if (!route) { route = this.routes[0] || [[300, 300], [320, 320]]; k = 0; }
      const t = v.obj;
      t.hpMax = 1100 * this.hpMul;
      const [x, z] = route[k], [nx, nz] = route[Math.min(route.length - 1, k + 1)];
      t.reset(x, z, Math.atan2(-(nx - x), -(nz - z)));
      t.reloadTime = 5.2 * this.react;
      Object.assign(v, { route, wp: Math.min(route.length - 1, k + 1), dirStep: 1, state: 'patrol', seeT: 0, lastSeen: -99, lastPos: new THREE.Vector3(), stuckT: 0, backT: 0, percT: rand(0, 0.3), sees: false, aimJit: new THREE.Vector3(), jitT: 0, deadT: -1 });
    });
    this.helis.filter((v) => v.inUse).forEach((v, i) => {
      const h = v.obj;
      h.hpMax = 520 * this.hpMul;
      const a = (i / Math.max(1, nH)) * Math.PI * 2 + rand(-0.4, 0.4), R = rand(380, 560);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      h.resetAt(x, this.world.groundAt(x, z) + 60, z, rand(0, 6.28));
      Object.assign(v, { wpA: a, wpDir: Math.random() < 0.5 ? 1 : -1, wpR: R, state: 'patrol', lastSeen: -99, lastPos: new THREE.Vector3(), percT: rand(0, 0.3), sees: false, orbit: rand(0, 6.28), burst: 0, burstT: rand(1, 3), rocketT: rand(4, 8), deadT: -1 });
    });
    this.total = nT + nH;
    this._preset = preset;
    this.remaining = this.total;
    this.time = 0;
  }

  /** Add one enemy tank at (x, z) that drives along `route` ([[x, z], ...], local patrol) — used by
   *  the trench mode's last wave. */
  spawnTank(x, z, yaw, route, { hold = false, hpScale = 1 } = {}) {
    let v = this.tanks.find((q) => !q.inUse);
    if (!v) { v = this._mkTank(); this.tanks.push(v); }
    v.inUse = true;
    const t = v.obj;
    t.hpMax = 1100 * this.hpMul * hpScale; t.reset(x, z, yaw); t.reloadTime = 5.2 * this.react;
    Object.assign(v, { route, wp: 0, dirStep: 1, state: 'patrol', seeT: 0, lastSeen: -99, lastPos: new THREE.Vector3(), stuckT: 0, backT: 0, percT: 0, sees: false, aimJit: new THREE.Vector3(), jitT: 0, deadT: -1, noTownCheck: true, hold });
    this.total++; this.remaining++;
    return v;
  }

  _hit(v, amount) {
    const o = v.obj;
    if (!o.alive) return;
    o.damage(amount);
    v.lastSeen = this.time;                 // being hit reveals the shooter's general area
    if (!o.alive) {
      this.remaining = Math.max(0, this.remaining - 1);
      v.deadT = 0;
      if (v.kind === 'tank') { this.combat.explode(_a.set(o.pos.x, o.pos.y + 1.4, o.pos.z), 5, 0, 'enemy', v.target, 1.6); this.combat.smokeColumn(o.pos, 40, 1.2); }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, { target }) {
    this.time += dt;
    for (const v of this.tanks) if (v.inUse) this._tank(v, dt, target);
    for (const v of this.helis) if (v.inUse) this._heli(v, dt, target);
  }

  _perceive(v, dt, from, target, range) {
    if ((v.percT -= dt) > 0) return v.sees;
    v.percT = 0.25;
    v.sees = false;
    if (!target || !target.alive) return false;
    _b.set(target.pos.x, target.pos.y + target.cy, target.pos.z);
    const d = from.distanceTo(_b);
    if (d > range) return false;
    v.sees = this.physics.lineOfSight(from, _b);
    if (v.sees) { v.lastSeen = this.time; v.lastPos.copy(target.pos); }
    return v.sees;
  }

  _tank(v, dt, target) {
    const t = v.obj;
    if (!t.alive) { t.update(dt); t.drive(dt, 0, 0); return; }
    const p = t.pos;
    _a.set(p.x, p.y + 2.6, p.z);
    const range = 200 * this.view * (target && target.kind === 'heli' ? 1.2 : 1);
    const sees = this._perceive(v, dt, _a, target, range);
    const engaged = this.time - v.lastSeen < 10;
    let throttle = 0, steer = 0, goal = null;
    if (engaged) {
      const tp = v.lastPos, dist = Math.hypot(tp.x - p.x, tp.z - p.z);
      // Aim: turret onto the target with an accuracy-dependent wobble; fire when on target.
      if ((v.jitT -= dt) <= 0) {
        v.jitT = rand(0.8, 1.6);
        const miss = (0.018 * dist + 1.2) / this.acc;
        v.aimJit.set(rand(-1, 1) * miss, rand(-0.3, 0.6) * miss, rand(-1, 1) * miss);
      }
      _b.set(tp.x + v.aimJit.x, tp.y + (target?.cy ?? 1) + v.aimJit.y + dist * 0.004, tp.z + v.aimJit.z);
      if (sees && target) { const lead = dist / 170; _b.addScaledVector(target.vel || _c.set(0, 0, 0), lead * 0.6); }
      t.aimAt(dt, _b);
      if (sees && t.aimError(_b) < 0.035 && dist < range) {
        const shot = t.fireMain();
        if (shot) {
          this.combat.projectile({ pos: shot.pos, dir: shot.dir, speed: 170, gravity: 3, damage: 260 * this.dmg, splash: 6, splashDmg: 120 * this.dmg, team: 'enemy', kind: 'shell', owner: v.target });
          this.combat._sound('tankGun', shot.pos, 1);
        }
      }
      // Manoeuvre: close in when far, back off when very close, otherwise hold.
      if (v.hold) goal = null;                          // holds its firing line (trench arena)
      else if (dist > 130 || !sees) goal = tp; else if (dist < 45) { throttle = -0.5; }
    } else {
      // Patrol along the route, turning around at its ends.
      const r = v.route, [wx, wz] = r[v.wp];
      if (Math.hypot(wx - p.x, wz - p.z) < 8) {
        if (v.wp + v.dirStep < 0 || v.wp + v.dirStep >= r.length) v.dirStep = -v.dirStep;
        v.wp += v.dirStep;
      }
      goal = _c.set(wx, 0, wz);
      t.aimYawPitch(dt, t.yaw, 0);
    }
    if (goal) {
      const want = Math.atan2(-(goal.x - p.x), -(goal.z - p.z)), err = wrap(want - t.yaw);
      steer = clamp(-err * 2, -1, 1);
      throttle = Math.abs(err) > 1.2 ? 0.15 : engaged ? 0.75 : 0.55;
    }
    // Stay out of the walled town; back out and turn when stuck.
    const s = Math.sin(t.yaw), c = Math.cos(t.yaw);
    if (inTown(p.x - s * 8, p.z - c * 8, 14) && throttle > 0) { throttle = -0.3; steer = 1; }
    if (v.backT > 0) { v.backT -= dt; throttle = -0.6; steer = 0.8; }
    else if (throttle > 0.3 && Math.abs(t.speed) < 0.6) { if ((v.stuckT += dt) > 2) { v.stuckT = 0; v.backT = 1.6; } }
    else v.stuckT = 0;
    t.drive(dt, throttle, steer);
    t.update(dt);
  }

  _heli(v, dt, target) {
    const h = v.obj;
    if (!h.alive) {
      h.update(dt, null);
      if (h.justCrashed) { this.combat.explode(_a.set(h.pos.x, h.pos.y + 1, h.pos.z), 6, 0, 'enemy', v.target, 1.4); this.combat.smokeColumn(h.pos, 35, 1); }
      return;
    }
    const p = h.pos;
    _a.set(p.x, p.y + 1, p.z);
    const range = 270 * this.view;
    const sees = this._perceive(v, dt, _a, target, range);
    const engaged = this.time - v.lastSeen < 12;
    const ground = this.world.groundAt(p.x, p.z);
    let tx, tz, alt, heading;
    if (engaged) {
      const tp = v.lastPos;
      // Circle the target at a stand-off distance, nose pointed at it.
      v.orbit += dt * 0.22 * v.wpDir;
      const R = target && target.kind === 'heli' ? 70 : 105;
      tx = tp.x + Math.cos(v.orbit) * R; tz = tp.z + Math.sin(v.orbit) * R;
      alt = Math.max(this.world.groundAt(tx, tz), tp.y) + (target && target.kind === 'heli' ? Math.max(12, p.y - tp.y > 0 ? 18 : 25) : 38);
      heading = Math.atan2(-(tp.x - p.x), -(tp.z - p.z));
      const dist = Math.hypot(tp.x - p.x, tp.z - p.z);
      const facing = Math.abs(wrap(heading - h.yaw)) < 0.25;
      // Cannon bursts.
      if ((v.burstT -= dt) <= 0 && sees && facing && dist < 240) { v.burst = 7; v.burstT = rand(2.2, 3.4) * this.react; }
      if (v.burst > 0 && sees) {
        const m = h.fireCannon();
        if (m) {
          v.burst--;
          _b.set(tp.x, tp.y + (target?.cy ?? 1), tp.z);
          const spread = (0.05 + 1.2 / Math.max(20, dist)) / this.acc;
          _d.copy(_b).sub(m).normalize();
          _d.x += rand(-spread, spread); _d.y += rand(-spread, spread) * 0.6; _d.z += rand(-spread, spread); _d.normalize();
          this.combat.hitscan({ origin: m, dir: _d, range: 320, damage: 9 * this.dmg, team: 'enemy', owner: v.target });
          this.combat._sound('heliCannon', m, 0.7);
        }
      }
      // Rocket pairs at vehicles (and now and then at infantry).
      if ((v.rocketT -= dt) <= 0 && sees && facing && dist < 230) {
        v.rocketT = rand(5, 8) * this.react;
        if (target.kind === 'tank') {                // rockets are for armour; the cannon handles the rest
          for (let k = 0; k < 2; k++) {
            const m = h.fireRocket();
            if (!m) break;
            _b.set(tp.x + rand(-3, 3) / this.acc, tp.y + 0.8, tp.z + rand(-3, 3) / this.acc);
            _d.copy(_b).sub(m).normalize();
            this.combat.projectile({ pos: m, dir: _d, speed: 120, gravity: 0.5, damage: 170 * this.dmg, splash: 6, splashDmg: 90 * this.dmg, team: 'enemy', kind: 'rocket', owner: v.target });
            h.rocketT = 0;   // second rocket straight after the first
          }
          this.combat._sound('rocket', p, 0.8);
        }
      }
    } else {
      // Patrol: a wide loop around the town.
      v.wpA += dt * 0.035 * v.wpDir;
      tx = Math.cos(v.wpA) * v.wpR; tz = Math.sin(v.wpA) * v.wpR;
      alt = this.world.groundAt(tx, tz) + 60;
      heading = Math.atan2(-(tx - p.x), -(tz - p.z));
    }
    const dx = tx - p.x, dz = tz - p.z, dh = Math.hypot(dx, dz) || 1;
    const sp = Math.min(engaged ? 24 : 26, dh * 0.6);
    // Terrain look-ahead: climb early over ridges.
    const ahead = this.world.groundAt(p.x + dx / dh * 60, p.z + dz / dh * 60);
    alt = Math.max(alt, ahead + 25, ground + 20);
    _c.set(dx / dh * sp, clamp((alt - p.y) * 0.5, -6, 8), dz / dh * sp);
    h.update(dt, { vel: _c, heading });
  }

  /** Map markers for the vehicles still in action (array reused). */
  markers() {
    const m = this._markers; m.length = 0;
    for (const v of [...this.tanks, ...this.helis]) if (v.inUse && v.obj.alive) m.push({ x: v.obj.pos.x, z: v.obj.pos.z, kind: v.kind, alerted: this.time - v.lastSeen < 10 });
    return m;
  }
  /** Nearest vehicle still in action (for the objective once the robot squads are cleared). */
  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const v of [...this.tanks, ...this.helis]) {
      if (!v.inUse || !v.obj.alive) continue;
      const d = Math.hypot(v.obj.pos.x - x, v.obj.pos.z - z);
      if (d < bd) { bd = d; best = { x: v.obj.pos.x, z: v.obj.pos.z, name: v.name, dist: d, kind: v.kind }; }
    }
    return best;
  }
}
