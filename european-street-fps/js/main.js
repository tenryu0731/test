import * as THREE from 'three';
import { Physics } from './physics.js';
import { createMaterials } from './textures.js';
import { buildWorld } from './world.js';
import { createGraphics } from './render.js';
import { Weapon } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
const canvas = document.getElementById('game');
const gfx = createGraphics(canvas, { isTouch, params });
const { renderer, scene, camera } = gfx;

// ---------- world ----------
const t0 = performance.now();
const materials = createMaterials(renderer);
const world = buildWorld(scene, materials, { renderer, camera });
const physics = new Physics(world.colliders, world.groundAt);
console.log(`[boot] world built in ${(performance.now() - t0).toFixed(0)} ms, ${world.colliders.length} colliders`);

const t1 = performance.now();
const audio = new GameAudio();
const weapon = new Weapon({ renderer, audio });
const t2 = performance.now();
const enemies = new EnemyManager({ scene, physics, audio, world, spawns: world.enemySites.flatMap((s) => s.spawns), navPoints: world.navPoints });
const t3 = performance.now();
const input = new Input(canvas, { isTouch });
const ui = new UI(document.getElementById('ui'), { isTouch });
console.log(`[boot] weapon ${(t2 - t1).toFixed(0)} ms, enemies ${(t3 - t2).toFixed(0)} ms, ui ${(performance.now() - t3).toFixed(0)} ms`);

// ---------- player ----------
const PLAYER = { radius: 0.35, height: 1.75, eye: 1.62, maxHP: 100, walk: 4.6, sprint: 7.0, jump: 4.8, gravity: 16 };
const player = {
  pos: new THREE.Vector3(), velY: 0, grounded: true, yaw: 0, pitch: 0,
  hp: PLAYER.maxHP, kickPitch: 0, kickYaw: 0, stepPhase: 0, hurtCooldown: 0,
};
const stats = { start: 0, shots: 0, hits: 0 };
let state = 'menu';
let winTimer = -1;

function resetGame() {
  player.pos.copy(world.playerSpawn);
  player.velY = 0; player.grounded = true;
  player.yaw = world.playerYaw; player.pitch = 0;
  player.kickPitch = player.kickYaw = 0;
  player.hp = PLAYER.maxHP;
  stats.start = performance.now(); stats.shots = 0; stats.hits = 0;
  winTimer = -1;
  weapon.reset();
  enemies.reset();
  input.reset();
  ui.setHP(player.hp, PLAYER.maxHP);
  ui.setAmmo(weapon.ammo, weapon.reserve, weapon.isReloading);
  ui.setEnemies(enemies.remaining, enemies.total);
}

function startPlaying() {
  audio.resume();
  audio.play('uiClick');
  ui.hideOverlays();
  ui.setHUDVisible(true);
  input.enabled = true;
  if (!isTouch) input.lockPointer();
  state = 'playing';
  clock.getDelta();
}

function newRound() { resetGame(); startPlaying(); }

function endRound(won) {
  state = won ? 'won' : 'lost';
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const s = {
    time: (performance.now() - stats.start) / 1000,
    accuracy: stats.shots ? stats.hits / stats.shots : 0,
    hpLeft: Math.max(0, Math.round(player.hp)),
    killed: enemies.total - enemies.remaining, total: enemies.total,
  };
  audio.play(won ? 'win' : 'lose');
  if (won) ui.showWin(s, newRound); else ui.showLose(s, newRound);
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  input.enabled = false;
  ui.showPause(() => startPlaying());
}

input.onPause = pause;
ui.bindInput(input);

document.addEventListener('pointerlockchange', () => {
  if (!isTouch && !document.pointerLockElement && state === 'playing') pause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- hitscan ----------
const _dir = new THREE.Vector3(), _origin = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

function shoot(shot) {
  stats.shots++;
  camera.getWorldPosition(_origin);
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * shot.spread;
  _e.set(player.pitch + player.kickPitch + Math.sin(a) * r, player.yaw + player.kickYaw + Math.cos(a) * r, 0);
  _dir.set(0, 0, -1).applyEuler(_e).normalize();

  const maxDist = 200;
  const worldHit = physics.raycast(_origin, _dir, maxDist);
  const enemyHit = enemies.raycast(_origin, _dir, worldHit ? worldHit.distance : maxDist);
  weapon.getMuzzleWorld(camera, _muzzle);

  if (enemyHit) {
    stats.hits++;
    const dmg = enemyHit.part === 'head' ? 50 : 25;
    const { killed } = enemies.damage(enemyHit, dmg);
    weapon.spawnImpact(scene, enemyHit.point, enemyHit.normal, 'robot');
    audio.play('hitRobot', { volume: 0.9 });
    ui.hitMarker(killed);
    if (killed) ui.toast(`訓練ロボットを停止 — 残り ${enemies.remaining}`);
    ui.setEnemies(enemies.remaining, enemies.total);
    _end.copy(enemyHit.point);
  } else if (worldHit) {
    weapon.spawnImpact(scene, worldHit.point, worldHit.normal, 'world');
    audio.play('hitWorld', { volume: Math.max(0.15, 1 - worldHit.distance / 60) * 0.6 });
    _end.copy(worldHit.point);
  } else {
    _end.copy(_origin).addScaledVector(_dir, maxDist);
  }
  weapon.spawnTracer(scene, _muzzle, _end);
}

function onPlayerHit(damage, fromPos) {
  if (state !== 'playing') return;
  player.hp = Math.max(0, player.hp - damage);
  ui.setHP(player.hp, PLAYER.maxHP);
  const ang = Math.atan2(fromPos.x - player.pos.x, fromPos.z - player.pos.z);
  // Camera forward is -Z rotated by yaw; relative angle 0 = in front, + = to the right.
  const fwd = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));
  ui.damageIndicator(THREE.MathUtils.euclideanModulo(fwd - ang + Math.PI, Math.PI * 2) - Math.PI);
  audio.play('playerHurt', { volume: 0.8 });
  player.kickPitch += (Math.random() - 0.3) * 0.02;
  player.kickYaw += (Math.random() - 0.5) * 0.03;
  if (player.hp <= 0) endRound(false);
}

// ---------- update ----------
const _move = new THREE.Vector3(), _eye = new THREE.Vector3();

function updatePlayer(dt) {
  const look = input.consumeLook();
  player.yaw -= look.dx;
  player.pitch = THREE.MathUtils.clamp(player.pitch + look.dy, -1.45, 1.45);

  if (input.consumeJump() && player.grounded) { player.velY = PLAYER.jump; player.grounded = false; }
  if (input.consumeReload()) weapon.reload();

  const m = input.move;
  const mag = Math.min(1, Math.hypot(m.x, m.y));
  const speed = (input.sprint && m.y > 0.3 ? PLAYER.sprint : PLAYER.walk) * mag;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let fx = m.x * cos - m.y * sin, fz = -m.x * sin - m.y * cos;
  const fl = Math.hypot(fx, fz) || 1;
  _move.set(fx / fl * speed * dt, 0, fz / fl * speed * dt);

  player.velY -= PLAYER.gravity * dt;
  _move.y = player.velY * dt;
  physics.moveCircle(player.pos, _move, PLAYER.radius, PLAYER.height);
  const ground = physics.groundHeight(player.pos.x, player.pos.z, PLAYER.radius, player.pos.y);
  if (player.pos.y <= ground) {
    // Smooth step-up onto kerbs / fountain rim instead of popping.
    player.pos.y = player.velY < 0 && ground - player.pos.y < 0.5 ? THREE.MathUtils.lerp(player.pos.y, ground, Math.min(1, dt * 18)) : ground;
    if (ground - player.pos.y < 0.02) player.pos.y = ground;
    player.velY = 0; player.grounded = true;
  } else if (player.pos.y - ground > 0.05) {
    player.grounded = false;
  }
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, world.bounds.minX, world.bounds.maxX);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, world.bounds.minZ, world.bounds.maxZ);

  // Footsteps.
  const moving = mag > 0.1 && player.grounded;
  if (moving) {
    player.stepPhase += dt * speed / 2.1;
    if (player.stepPhase >= 1) { player.stepPhase -= 1; audio.play('step', { volume: 0.35, rate: 0.9 + Math.random() * 0.2 }); }
  }

  // Fire.
  if (input.fireHeld) {
    const shot = weapon.tryFire();
    if (shot) {
      shoot(shot);
      player.kickPitch += shot.pitchKick;
      player.kickYaw += shot.yawKick;
    }
  }
  // Recoil recovery.
  const rec = Math.min(1, dt * 7);
  player.kickPitch -= player.kickPitch * rec;
  player.kickYaw -= player.kickYaw * rec;

  weapon.update(dt, { moving, speed01: speed / PLAYER.sprint, grounded: player.grounded, lookDX: look.dx, lookDY: look.dy });
  ui.setAmmo(weapon.ammo, weapon.reserve, weapon.isReloading);

  const bob = moving ? Math.sin(player.stepPhase * Math.PI * 2) * 0.025 * (speed / PLAYER.walk) : 0;
  camera.position.set(player.pos.x, player.pos.y + PLAYER.eye + bob, player.pos.z);
  camera.rotation.set(player.pitch + player.kickPitch, player.yaw + player.kickYaw, 0);
}

gfx.onResize((aspect) => weapon.resize(aspect));

// ---------- loop ----------
const clock = new THREE.Clock();
let frozen = false;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!frozen) { update(dt); render(); }
  requestAnimationFrame(frame);
}

function update(dt) {
  if (state === 'playing') {
    updatePlayer(dt);
    _eye.set(player.pos.x, player.pos.y + PLAYER.eye, player.pos.z);
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: player.hp > 0, onPlayerHit });
    ui.setEnemies(enemies.remaining, enemies.total);
    ui.setCrosshairSpread(4 + weapon.currentSpread * 900);
    if (enemies.remaining === 0 && winTimer < 0) winTimer = 1.2;
    if (winTimer > 0 && (winTimer -= dt) <= 0) endRound(true);
  } else if (state === 'menu') {
    // Slow orbit over the piazza behind the start screen.
    const t = performance.now() / 1000;
    camera.position.set(Math.sin(t * 0.06) * 10, 5.5, Math.cos(t * 0.06) * 7.5);
    camera.lookAt(0, 2.2, 0);
    enemies.update(dt, { playerPos: _far, playerEye: _far, playerAlive: false, onPlayerHit() {} });
  } else if (state === 'won' || state === 'lost') {
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: false, onPlayerHit() {} });
    weapon.update(dt, { moving: false, speed01: 0, grounded: true, lookDX: 0, lookDY: 0 });
  }
  weapon.updateEffects(dt);
  world.update(dt, camera);
  gfx.updateSun(state === 'menu' ? _zero : player.pos);
  gfx.update(dt, { adaptive: state === 'playing' });
}

function render() {
  if (state === 'menu') gfx.render();
  else gfx.render(weapon.viewScene, weapon.viewCamera);
}
const _far = new THREE.Vector3(0, -999, 0), _zero = new THREE.Vector3();

// ---------- boot ----------
const t4 = performance.now();
resetGame();
console.log(`[boot] resetGame ${(performance.now() - t4).toFixed(0)} ms`);
gfx.resize();
// Compile every shader behind the loading screen so the first frames don't hitch (slow on phones).
try {
  gfx.updateSun(_zero);
  await gfx.compile([[weapon.viewScene, weapon.viewCamera]]);
} catch (e) { console.warn('[boot] shader precompile skipped', e); }
console.log(`[boot] ready in ${(performance.now() - t0).toFixed(0)} ms`);
document.getElementById('boot')?.remove();
ui.setHUDVisible(false);
ui.showStart(() => startPlaying());
if (params.has('autostart')) startPlaying(); // for automated screenshots
// Debug/test hooks. freeze(true) stops the real-time loop; step(n, dt) advances the simulation
// n fixed steps and renders one frame (headless software GL is far too slow for real time).
window.__game = {
  scene, camera, player, enemies, weapon, world, city: world.parts.city, physics, renderer, gfx, input, ui, audio,
  get state() { return state; }, startPlaying, endRound, shoot,
  freeze(v = true) { frozen = v; clock.getDelta(); },
  step(n = 1, dt = 1 / 30, draw = true) { for (let i = 0; i < n; i++) update(dt); if (draw) render(); },
};
requestAnimationFrame(frame);
