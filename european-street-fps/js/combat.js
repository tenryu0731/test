// Vehicle combat: projectiles (tank shells, rockets), hitscan bursts (machine guns, helicopter
// cannons), explosions with splash damage, smoke / dust effects and burning wrecks.
//
// Damage goes by team. Player fire hits enemy vehicles (registered targets) and the training robots
// (EnemyManager); enemy fire hits `combat.player` (the player on foot, or the vehicle they are in).
//
//   const combat = new Combat({ scene, physics, world, enemies, audio })
//   combat.addTarget({ team, pos, radius, cy, alive, damage(amount, from, kind) })
//   combat.player = { pos, radius, cy, damage(amount, from, kind) }      // set by main.js
//   combat.projectile({ pos, dir, speed, gravity, damage, splash, splashDmg, team, kind, owner })
//   combat.hitscan({ origin, dir, range, damage, team, owner, robotDamage }) -> hit point
//   combat.explode(pos, radius, damage, team, owner, size)
//   combat.update(dt, camera)
import * as THREE from 'three';

const MAX_PROJ = 64, MAX_PUFF = 220, MAX_TRACER = 48;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);

// Soft round puff (alpha falls off, a little grain) for smoke / dust / fire sprites.
function puffTexture() {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r = Math.hypot(dx, dy);
    const grain = 0.85 + 0.15 * Math.sin(x * 1.7 + y * 2.3) * Math.cos(x * 0.9 - y * 1.3);
    const a = Math.max(0, 1 - r) ** 1.6 * grain;
    const k = (y * n + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = Math.round(Math.min(1, a) * 255);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Segment p0 + dir * t (0..len) against a sphere: distance along the segment or -1.
function segSphere(p0, dir, len, c, r) {
  const ox = c.x - p0.x, oy = c.y - p0.y, oz = c.z - p0.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < -r || t > len + r) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - t * t;
  if (d2 > r * r) return -1;
  const hit = t - Math.sqrt(r * r - d2);
  return hit >= -r && hit <= len ? Math.max(0, hit) : -1;
}

export class Combat {
  constructor({ scene, physics, world, enemies, audio }) {
    this.scene = scene; this.physics = physics; this.world = world; this.enemies = enemies; this.audio = audio;
    this.targets = [];
    this.player = null;
    this.onExplosion = null;        // (pos, size) — main.js shakes the camera
    this.onKill = null;             // (target) — an enemy vehicle was destroyed by the player
    this.onRobotKill = null;        // (robot)
    this.camPos = new THREE.Vector3();

    // Projectiles: instanced shells (brass-grey) and rockets (dark body).
    this.proj = [];
    const shellGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.9, 6).rotateX(Math.PI / 2);
    const rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.3, 6).rotateX(Math.PI / 2);
    this.shells = new THREE.InstancedMesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.4, metalness: 0.6 }), MAX_PROJ);
    this.rockets = new THREE.InstancedMesh(rocketGeo, new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.5, metalness: 0.4 }), MAX_PROJ);
    for (const im of [this.shells, this.rockets]) { im.count = 0; im.frustumCulled = false; im.name = 'combat-projectiles'; scene.add(im); }

    // Tracers: thin warm streaks, a few frames each.
    const trGeo = new THREE.BoxGeometry(0.05, 0.05, 1); trGeo.translate(0, 0, -0.5);
    this.tracers = new THREE.InstancedMesh(trGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.75, depthWrite: false }), MAX_TRACER);
    this.tracers.count = 0; this.tracers.frustumCulled = false; this.tracers.name = 'combat-tracers';
    scene.add(this.tracers);
    this.tr = [];

    // Puffs: smoke, dust and short fire balls (normal blending, no glow).
    const tex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < MAX_PUFF; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x888888 }));
      s.visible = false; s.renderOrder = 4;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, size: 1, alpha: 1, kind: 0 });
    }
    this.pi = 0;
    this.columns = [];              // wreck smoke emitters
    this.stats = { fired: { player: 0, enemy: 0 }, hits: { target: 0, robot: 0, player: 0, world: 0 } };
  }

  reset() {
    this.proj.length = 0; this.tr.length = 0; this.columns.length = 0;
    for (const p of this.puffs) { p.life = 0; p.s.visible = false; }
    this.shells.count = this.rockets.count = this.tracers.count = 0;
  }

  addTarget(t) { this.targets.push(t); return t; }
  removeTarget(t) { const i = this.targets.indexOf(t); if (i >= 0) this.targets.splice(i, 1); }

  // ---------------------------------------------------------------- firing
  projectile({ pos, dir, speed = 200, gravity = 0, damage = 100, splash = 5, splashDmg = 80, team = 'player', kind = 'shell', owner = null, life = 5 }) {
    if (this.proj.length >= MAX_PROJ) this.proj.shift();
    this.stats.fired[team] = (this.stats.fired[team] || 0) + 1;
    this.proj.push({ pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(speed), gravity, damage, splash, splashDmg, team, kind, owner, life, trailT: 0 });
    if (kind === 'rocket') this.puff(pos, 1, 0.9, 0.6, 1);
    else this.muzzleBlast(pos, dir, kind === 'shell' ? 1.4 : 0.6);
  }

  /** Instant hit along a ray: world, vehicles of the other team, robots (player fire) or the player
   *  (enemy fire). Draws a tracer and returns the end point. */
  hitscan({ origin, dir, range = 400, damage = 20, team = 'player', owner = null, robotDamage = damage, tracer = true, impact = true }) {
    const hit = this._trace(origin, dir, range, team, owner);
    const end = hit ? hit.point : _c.copy(origin).addScaledVector(dir, range).clone();
    if (hit) {
      this._applyHit(hit, team === 'player' && hit.robot ? robotDamage : damage, team, owner, 'bullet', origin, dir);
      if (impact && !hit.target && !hit.player) this.puff(hit.point, 0, 0.35, 0.5, 0.7);
    }
    if (tracer) this.tracer(origin, end);
    return end;
  }

  // ---------------------------------------------------------------- hits
  // Nearest thing along origin + dir * t for t in [0, len].
  _trace(origin, dir, len, team, owner) {
    let best = null;
    const w = this.physics.raycast(origin, dir, len);
    if (w) best = { distance: w.distance, point: w.point.clone(), normal: w.normal };
    for (const t of this.targets) {
      if (!t.alive || t.team === team || t === owner) continue;
      _c.set(t.pos.x, t.pos.y + t.cy, t.pos.z);
      const d = segSphere(origin, dir, best ? best.distance : len, _c, t.radius);
      if (d >= 0 && (!best || d < best.distance)) best = { distance: d, point: origin.clone().addScaledVector(dir, d), target: t };
    }
    if (team === 'player' && this.enemies) {
      const r = this.enemies.raycast(origin, dir, best ? best.distance : len);
      if (r && (!best || r.distance < best.distance)) best = { distance: r.distance, point: r.point, robot: r };
    }
    if (team === 'enemy' && this.player && this.player.alive !== false) {
      const P = this.player;
      _c.set(P.pos.x, P.pos.y + P.cy, P.pos.z);
      const d = segSphere(origin, dir, best ? best.distance : len, _c, P.radius);
      if (d >= 0 && (!best || d < best.distance)) best = { distance: d, point: origin.clone().addScaledVector(dir, d), player: true };
    }
    return best;
  }

  _applyHit(hit, damage, team, owner, kind, from, dir) {
    this.stats.hits[hit.target ? 'target' : hit.robot ? 'robot' : hit.player ? 'player' : 'world']++;
    if (hit.target) {
      const t = hit.target, was = t.alive;
      t.damage(damage, from, kind);
      if (was && !t.alive && team === 'player') this.onKill?.(t);
    } else if (hit.robot) {
      const r = hit.robot;
      const { killed } = this.enemies.damage(r, r.part === 'head' ? damage * 1.6 : damage);
      if (killed) this.onRobotKill?.(r.enemy);
    } else if (hit.player) this.player.damage(damage, from, kind);
    void owner; void dir;
  }

  /** Blast: full damage at the centre falling to 30 % at the edge; robots, vehicles, the player. */
  explode(pos, radius, damage, team, owner = null, size = 1) {
    this.fireball(pos, size);
    const r2 = radius * radius;
    for (const t of this.targets) {
      if (!t.alive || t.team === team || t === owner) continue;
      const d2 = (t.pos.x - pos.x) ** 2 + (t.pos.y + t.cy - pos.y) ** 2 + (t.pos.z - pos.z) ** 2;
      const rr = radius + t.radius;
      if (d2 > rr * rr) continue;
      const k = 1 - 0.7 * Math.min(1, Math.max(0, Math.sqrt(d2) - t.radius) / radius);
      const was = t.alive;
      t.damage(damage * k, pos, 'blast');
      if (was && !t.alive && team === 'player') this.onKill?.(t);
    }
    if (team === 'player' && this.enemies) {
      for (const r of this.enemies.list) {
        if (!r.alive) continue;
        const dx = r.pos.x - pos.x, dy = r.pos.y + 1 - pos.y, dz = r.pos.z - pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) || 0.01, k = 1 - 0.7 * d / radius;
        const hit = { enemy: r, part: 'body', point: _a.set(r.pos.x, r.pos.y + 1, r.pos.z).clone(), normal: _up.clone(), dir: new THREE.Vector3(dx / d, 0, dz / d), origin: pos.clone() };
        const { killed } = this.enemies.damage(hit, damage * k);
        if (killed) this.onRobotKill?.(r);
      }
    }
    if (team === 'enemy' && this.player && this.player.alive !== false) {
      const P = this.player;
      const d = Math.hypot(P.pos.x - pos.x, P.pos.y + P.cy - pos.y, P.pos.z - pos.z) - P.radius;
      if (d < radius) P.damage(damage * (1 - 0.7 * Math.max(0, d) / radius), pos, 'blast');
    }
    this.enemies?.noise?.(pos, 70);
    this.onExplosion?.(pos, size);
    this._sound(size > 1.2 ? 'explosionBig' : 'explosion', pos, 1.2);
  }

  // ---------------------------------------------------------------- effects
  puff(pos, kind, size, life, alpha = 1) {
    // kind 0 dust (tan), 1 smoke (grey), 2 fire (orange), 3 dark smoke
    const p = this.puffs[this.pi]; this.pi = (this.pi + 1) % MAX_PUFF;
    p.kind = kind; p.life = p.max = life; p.size = size; p.alpha = alpha;
    p.grow = kind === 2 ? 2.2 : kind === 3 ? 1.4 : 1.8;
    p.s.position.copy(pos);
    p.vel.set(rand(-0.4, 0.4), kind === 0 ? rand(0.3, 1) : kind === 2 ? rand(0.5, 1.5) : rand(0.8, 1.8), rand(-0.4, 0.4));
    const m = p.s.material;
    m.color.setHex(kind === 0 ? 0xb8a482 : kind === 1 ? 0x8f8b86 : kind === 2 ? 0xff9a40 : 0x3a3633);
    m.opacity = alpha; m.rotation = Math.random() * Math.PI * 2;
    p.s.scale.setScalar(size); p.s.visible = true;
    return p;
  }
  muzzleBlast(pos, dir, size) {
    this.puff(_a.copy(pos).addScaledVector(dir, 0.6), 2, size * 0.9, 0.09, 0.85);
    for (let i = 0; i < 3; i++) {
      const p = this.puff(_a.copy(pos).addScaledVector(dir, 0.8 + i * 0.7), 1, size * (1.2 + i * 0.4), 1.2 + i * 0.3, 0.45);
      p.vel.addScaledVector(dir, 2.5);
    }
  }
  fireball(pos, size = 1) {
    this.puff(pos, 2, 3.2 * size, 0.22, 0.9);
    for (let i = 0; i < 3; i++) this.puff(_a.set(pos.x + rand(-1, 1) * size, pos.y + rand(0, 1.2) * size, pos.z + rand(-1, 1) * size), 2, rand(1.5, 2.4) * size, rand(0.25, 0.4), 0.8);
    for (let i = 0; i < 8; i++) {
      const p = this.puff(_a.set(pos.x + rand(-1.5, 1.5) * size, pos.y + rand(0, 2) * size, pos.z + rand(-1.5, 1.5) * size), 1, rand(2.2, 3.6) * size, rand(2.2, 3.8), 0.7);
      p.vel.set(rand(-1.5, 1.5), rand(1.2, 3), rand(-1.5, 1.5));
    }
    const gy = this.world.groundAt(pos.x, pos.z);
    if (pos.y - gy < 3) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, p = this.puff(_a.set(pos.x + Math.cos(a) * size, gy + 0.4, pos.z + Math.sin(a) * size), 0, rand(1.6, 2.4) * size, rand(1.5, 2.5), 0.75);
      p.vel.set(Math.cos(a) * 4 * size, 0.6, Math.sin(a) * 4 * size);
    }
  }
  tracer(a, b) {
    if (this.tr.length >= MAX_TRACER) this.tr.shift();
    this.tr.push({ a: a.clone(), b: b.clone(), life: 0.07 });
  }
  /** Dark smoke rising from a wreck for `dur` seconds. */
  smokeColumn(pos, dur = 25, size = 1) { this.columns.push({ pos: pos.clone(), t: dur, acc: 0, size }); }

  _sound(name, pos, vol = 1) {
    if (!this.audio) return;
    const d = pos.distanceTo(this.camPos);
    const v = vol * Math.max(0, 1 - d / 420) ** 1.3;
    if (v > 0.03) this.audio.play(name, { volume: Math.min(1, v * 1.4) });
  }

  // ---------------------------------------------------------------- update
  update(dt, camera) {
    if (camera) camera.getWorldPosition(this.camPos);
    // Projectiles.
    let ns = 0, nr = 0;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      const step = p.vel.length() * dt;
      _d.copy(p.vel).normalize();
      const hit = this._trace(p.pos, _d, step, p.team, p.owner);
      if (hit || p.life <= 0) {
        const at = hit ? hit.point : p.pos;
        if (hit) this._applyHit(hit, p.damage, p.team, p.owner, p.kind, p.pos, _d);
        this.explode(at.clone ? at.clone() : at, p.splash, p.splashDmg, p.team, p.owner, p.kind === 'shell' ? 1.15 : 0.9);
        this.proj.splice(i, 1);
        continue;
      }
      p.pos.addScaledVector(_d, step);
      if (p.kind === 'rocket' && (p.trailT -= dt) <= 0) { p.trailT = 0.035; this.puff(p.pos, 1, 0.7, 1.1, 0.55); }
      _q.setFromUnitVectors(_b.set(0, 0, 1), _d);
      _m.compose(p.pos, _q, _s.set(1, 1, 1));
      if (p.kind === 'rocket') this.rockets.setMatrixAt(nr++, _m); else this.shells.setMatrixAt(ns++, _m);
    }
    this.shells.count = ns; this.rockets.count = nr;
    if (ns) this.shells.instanceMatrix.needsUpdate = true;
    if (nr) this.rockets.instanceMatrix.needsUpdate = true;

    // Tracers.
    let nt = 0;
    for (let i = this.tr.length - 1; i >= 0; i--) {
      const t = this.tr[i];
      if ((t.life -= dt) <= 0) { this.tr.splice(i, 1); continue; }
      _d.copy(t.b).sub(t.a); const L = _d.length(); _d.divideScalar(L || 1);
      _q.setFromUnitVectors(_b.set(0, 0, -1), _d);
      // a short streak partway along the path, so it reads as a travelling round
      const k = 1 - t.life / 0.07;
      _a.copy(t.a).addScaledVector(_d, Math.min(L, L * (0.25 + 0.75 * k) + 6));
      _m.compose(_a, _q, _s.set(1, 1, Math.min(L, 12)));
      this.tracers.setMatrixAt(nt++, _m);
    }
    this.tracers.count = nt;
    if (nt) this.tracers.instanceMatrix.needsUpdate = true;

    // Wreck smoke.
    for (let i = this.columns.length - 1; i >= 0; i--) {
      const c = this.columns[i];
      if ((c.t -= dt) <= 0) { this.columns.splice(i, 1); continue; }
      if ((c.acc -= dt) <= 0) {
        c.acc = 0.16;
        const p = this.puff(_a.set(c.pos.x + rand(-0.6, 0.6), c.pos.y + 1, c.pos.z + rand(-0.6, 0.6)), 3, rand(1.6, 2.6) * c.size, rand(3, 5), Math.min(0.75, c.t / 6));
        p.vel.set(rand(-0.3, 0.3) + 0.8, rand(2.2, 3.4), rand(-0.3, 0.3));
      }
    }

    // Puffs.
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * (p.kind === 0 ? 1.8 : 0.6)));
      p.s.scale.setScalar(p.size * (1 + t * p.grow));
      p.s.material.opacity = p.alpha * (p.kind === 2 ? (1 - t) : (1 - t) * Math.min(1, t * 6 + 0.3));
    }
  }
}
