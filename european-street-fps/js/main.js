import * as THREE from 'three';
import { Physics } from './physics.js';
import { createMaterials } from './textures.js';
import { buildCity } from './city.js';
import { Weapon } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const maxPR = isTouch ? 1.5 : 2;
let pixelRatio = Math.min(devicePixelRatio, maxPR);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

// ---------- sky, sun, environment ----------
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(215));
const SKY_TOP = new THREE.Color(0x3f7fd0), SKY_HORIZON = new THREE.Color(0xc9dcec), SKY_GROUND = new THREE.Color(0xb7a58c);

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, ground: { value: SKY_GROUND },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top, horizon, ground, sunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-h*4.0,0.0,1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0,0.93,0.8) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.12);
        // a few soft cirrus streaks, very faint
        float cl = smoothstep(0.55, 1.0, sin(d.x*9.0 + d.z*3.0) * sin(d.z*7.0 - d.x*2.0 + 1.3)) * smoothstep(0.05, 0.35, h) * 0.18;
        c = mix(c, vec3(1.0), cl);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
const sky = makeSky();
scene.add(sky);

{
  // Image-based lighting baked from the sky so PBR materials pick up bright daylight.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
}

const hemi = new THREE.HemisphereLight(0xd8e8ff, 0xa08a6a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.castShadow = true;
const SHADOW_R = isTouch ? 34 : 45;
// ?q=low: small shadow map (used by headless screenshot tooling, also handy on weak phones).
sun.shadow.mapSize.setScalar(params.get('q') === 'low' ? 1024 : isTouch ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -SHADOW_R, right: SHADOW_R, top: SHADOW_R, bottom: -SHADOW_R, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 2;
scene.add(sun, sun.target);
// Light haze only for aerial perspective on the far backdrop — never hides the street.
scene.fog = new THREE.Fog(SKY_HORIZON.clone().lerp(new THREE.Color(0xffffff), 0.1), 90, 420);

// ---------- world ----------
const t0 = performance.now();
const materials = createMaterials(renderer);
const city = buildCity(scene, materials);
const physics = new Physics(city.colliders);
console.log(`[boot] city built in ${(performance.now() - t0).toFixed(0)} ms, ${city.colliders.length} colliders`);

const audio = new GameAudio();
const weapon = new Weapon({ renderer, audio });
const enemies = new EnemyManager({ scene, physics, audio, spawns: city.enemySpawns, navPoints: city.navPoints });
const input = new Input(canvas, { isTouch });
const ui = new UI(document.getElementById('ui'), { isTouch });

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
  player.pos.copy(city.playerSpawn);
  player.velY = 0; player.grounded = true;
  player.yaw = city.playerYaw; player.pitch = 0;
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
  if (city.bounds) {
    player.pos.x = THREE.MathUtils.clamp(player.pos.x, city.bounds.minX, city.bounds.maxX);
    player.pos.z = THREE.MathUtils.clamp(player.pos.z, city.bounds.minZ, city.bounds.maxZ);
  }

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

function updateSun(focus) {
  // Shadow frustum follows the player, snapped to texels to avoid shimmering.
  const texel = (SHADOW_R * 2) / sun.shadow.mapSize.x;
  const cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 100);
  sun.target.updateMatrixWorld();
}

// ---------- adaptive resolution (keeps phones smooth) ----------
let frames = 0, fpsTime = 0, lowStreak = 0;
function adaptResolution(dt) {
  frames++; fpsTime += dt;
  if (fpsTime < 2) return;
  const fps = frames / fpsTime;
  frames = 0; fpsTime = 0;
  if (fps < 45 && pixelRatio > 0.75) { if (++lowStreak >= 1) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); applySize(); lowStreak = 0; } }
  else if (fps > 58 && pixelRatio < Math.min(devicePixelRatio, maxPR)) { pixelRatio = Math.min(Math.min(devicePixelRatio, maxPR), pixelRatio + 0.125); applySize(); }
}

function applySize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  weapon.resize(camera.aspect);
}
addEventListener('resize', applySize);
addEventListener('orientationchange', () => setTimeout(applySize, 200));

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
    adaptResolution(dt);
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
  city.update?.(dt);
  updateSun(state === 'menu' ? _zero : player.pos);
  sky.position.copy(camera.position);
}

function render() {
  renderer.clear();
  renderer.render(scene, camera);
  if (state !== 'menu') {
    renderer.clearDepth();
    renderer.render(weapon.viewScene, weapon.viewCamera);
  }
}
const _far = new THREE.Vector3(0, -999, 0), _zero = new THREE.Vector3();

// ---------- boot ----------
resetGame();
applySize();
document.getElementById('boot')?.remove();
ui.setHUDVisible(false);
ui.showStart(() => startPlaying());
if (params.has('autostart')) startPlaying(); // for automated screenshots
// Debug/test hooks. freeze(true) stops the real-time loop; step(n, dt) advances the simulation
// n fixed steps and renders one frame (headless software GL is far too slow for real time).
window.__game = {
  scene, camera, player, enemies, weapon, city, physics, renderer, input, ui, audio,
  get state() { return state; }, startPlaying, endRound, shoot,
  freeze(v = true) { frozen = v; clock.getDelta(); },
  step(n = 1, dt = 1 / 30, draw = true) { for (let i = 0; i < n; i++) update(dt); if (draw) render(); },
};
requestAnimationFrame(frame);
