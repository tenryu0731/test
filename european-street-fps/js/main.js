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
import { Settings } from './settings.js';
import { WorldMap } from './map.js';
import { ViewpointSystem, OverviewCam, Flyover } from './viewpoints.js';
import { Pickups } from './pickups.js';

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const params = new URLSearchParams(location.search);
const settings = new Settings();

// ---------- renderer ----------
const canvas = document.getElementById('game');
const gfx = createGraphics(canvas, { isTouch, params });
if (!params.has('q') && settings.quality && settings.quality !== gfx.quality) {
  try { gfx.setQuality(settings.quality); } catch (e) { console.warn('[settings] quality', e); }
}
const { renderer, scene, camera } = gfx;
const BASE_FOV = camera.fov;

// ---------- world ----------
const t0 = performance.now();
const materials = createMaterials(renderer);
const world = buildWorld(scene, materials, { renderer, camera });
const physics = new Physics(world.colliders, world.groundAt);
console.log(`[boot] world built in ${(performance.now() - t0).toFixed(0)} ms, ${world.colliders.length} colliders`);

const t1 = performance.now();
const audio = new GameAudio();
audio.setVolume(settings.volume);
const weapon = new Weapon({ renderer, audio });
const AIM_FOV = weapon.aimFov || BASE_FOV * (50 / 72);   // the weapon suggests the ADS zoom
const t2 = performance.now();
let preset = settings.preset();
const enemies = new EnemyManager({
  scene, physics, audio, world, difficulty: preset,
  spawns: world.enemySites.flatMap((s) => s.spawns || []), navPoints: world.navPoints,
});
const t3 = performance.now();
const input = new Input(canvas, { isTouch });
const ui = new UI(document.getElementById('ui'), { isTouch });
const pickups = new Pickups({ scene, world, physics });
const viewpoints = new ViewpointSystem(world);
const worldMap = new WorldMap({ gfx, world, root: ui.root, isTouch: ui.isTouch });
worldMap.attachHUD({ minimap: ui.el.minimapCanvas, compass: ui.el.compass });
const overviewCam = new OverviewCam({ camera, world, element: ui.el.overview });
const flyover = new Flyover({ world });
console.log(`[boot] weapon ${(t2 - t1).toFixed(0)} ms, enemies ${(t3 - t2).toFixed(0)} ms, ui+systems ${(performance.now() - t3).toFixed(0)} ms, ` +
  `${pickups.items.length} crates, ${viewpoints.list.length} viewpoints`);

// ---------- player ----------
const PLAYER = { radius: 0.35, height: 1.75, eye: 1.62, walk: 4.6, sprint: 7.0, jump: 4.8, gravity: 16 };
const AIM_TIME = 0.18;                 // seconds to blend into / out of aim-down-sights
const LEAN_DIST = 0.45, LEAN_ROLL = THREE.MathUtils.degToRad(12), LEAN_DROP = 0.05, LEAN_TIME = 0.2, LEAN_PAD = 0.3;
const TOP_RADIUS = 3.2;                // how far the player may walk from a viewpoint's top point
const player = {
  pos: new THREE.Vector3(), velY: 0, grounded: true, yaw: 0, pitch: 0,
  hp: 100, maxHP: 100, kickPitch: 0, kickYaw: 0, stepPhase: 0, sinceHit: 99,
  aim: 0, aimE: 0, leanRaw: 0, lean: 0, camRise: 0,
};
const stats = { time: 0, shots: 0, hits: 0, pickups: 0 };
let regenDelay = 6, regenRate = 4, maxReserve = 240, ammoPerCrate = 48;
let state = 'menu';
let winTimer = -1;
let roundDirty = false;              // the current round has been played (start must reset)
let appliedKey = '';
let climb = null;                    // viewpoint transition in progress
let mapReturn = 'playing';
let lockFailed = false;
let intelT = 0, hudT = 0;
const diffKey = () => `${settings.difficulty}|${JSON.stringify(settings.custom)}`;

// ---------- intel: squads, discovery, objective ----------
const sites = (world.enemySites || []).map((s, i) => ({
  id: s.id ?? `site${i}`, name: s.name || '敵部隊', x: s.x, z: s.z, r: s.r || 20,
  alive: 0, total: 0, known: false, cleared: false,
}));
const siteIndex = new Map(sites.map((s, i) => [s.id, i]));
const mapSites = [], mapRobots = [];
let objective = null;
const vpMarks = viewpoints.list.map((v) => ({ id: v.id, name: v.name, x: v.base.x, z: v.base.z, get climbed() { return v.climbed; } }));
const mapState = {
  player: { x: 0, z: 0, yaw: 0 }, sites: mapSites, robots: mapRobots, viewpoints: vpMarks, pickups: pickups.items,
  objective: null, markers: world.markers || [], remaining: 0, total: 0, pickupsKey: 0,
};
function getMapState() {
  mapState.player.x = player.pos.x; mapState.player.z = player.pos.z; mapState.player.yaw = player.yaw;
  mapState.objective = objective;
  mapState.remaining = enemies.remaining; mapState.total = enemies.total;
  mapState.pickupsKey = pickups.activeCount;
  return mapState;
}
worldMap.getState = getMapState;

function robotMarkers() {
  if (typeof enemies.getMapMarkers === 'function') return enemies.getMapMarkers() || [];
  // Fallback for an EnemyManager without getMapMarkers().
  return (enemies.list || []).map((r) => ({ x: r.pos.x, z: r.pos.z, alive: r.alive, siteId: null, alerted: !!r.state && r.state !== 'patrol' }));
}
function nearestSite(x, z) {
  let best = -1, bd = Infinity;
  sites.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
function updateIntel(silent = false) {
  const ms = robotMarkers();
  for (const s of sites) { s.alive = 0; s.total = 0; }
  const idx = [];
  for (const m of ms) {
    let i = m.siteId !== undefined && m.siteId !== null ? siteIndex.get(m.siteId) : undefined;
    if (i === undefined) i = nearestSite(m.x, m.z);
    idx.push(i);
    if (i < 0) continue;
    const s = sites[i];
    s.total++;
    if (m.alive) { s.alive++; if (m.alerted) s.known = true; }
  }
  const px = player.pos.x, pz = player.pos.z;
  mapSites.length = 0;
  objective = null;
  let od = Infinity;
  for (const s of sites) {
    if (!s.total) continue;
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < s.r + 70) s.known = true;
    if (s.alive === 0 && !s.cleared) {
      s.cleared = true;
      if (!silent && state === 'playing') { ui.toast(`${s.name} を制圧`, 'ok'); audio.play('objective'); }
    }
    mapSites.push(s);
    if (s.alive > 0 && d < od) { od = d; objective = { x: s.x, z: s.z, name: s.name, dist: d, alive: s.alive, inside: d < s.r + 10 }; }
  }
  mapRobots.length = 0;
  ms.forEach((m, k) => {
    if (!m.alive) return;
    const s = sites[idx[k]];
    const near = (m.x - px) ** 2 + (m.z - pz) ** 2 < 45 * 45;
    if ((s && s.known) || m.alerted || near) mapRobots.push({ x: m.x, z: m.z });
  });
  if (!objective) ui.setObjective(null);
  else if (objective.inside) ui.setObjective(`${objective.name} · 残り ${objective.alive} 体`);
  else ui.setObjective(`${objective.name} · ${Math.round(objective.dist / 10) * 10} m`);
}
function revealAround(vp) {
  let n = 0;
  for (const s of sites) {
    if (!s.total || s.cleared || s.known) continue;
    if (Math.hypot(s.x - vp.top.x, s.z - vp.top.z) < 460) { s.known = true; n++; }
  }
  return n;
}

// ---------- round flow ----------
function applyDifficulty() {
  preset = settings.preset();
  player.maxHP = preset.playerHP || 100;
  regenDelay = Number.isFinite(preset.regenDelay) ? preset.regenDelay : Infinity;
  regenRate = preset.regenRate || 0;
  appliedKey = diffKey();
}

function resetGame() {
  applyDifficulty();
  player.pos.copy(world.playerSpawn);
  player.velY = 0; player.grounded = true;
  player.yaw = world.playerYaw; player.pitch = 0;
  player.kickPitch = player.kickYaw = 0;
  player.hp = player.maxHP; player.sinceHit = 99;
  player.aim = player.aimE = player.leanRaw = player.lean = player.camRise = 0;
  stats.time = 0; stats.shots = 0; stats.hits = 0; stats.pickups = 0;
  winTimer = -1;
  climb = null;
  weapon.reset();
  const scale = preset.ammoScale || 1;
  weapon.reserve = Math.round(weapon.reserve * scale);
  maxReserve = Math.max(weapon.reserve, Math.round((weapon.magSize || 24) * 10 * scale));
  ammoPerCrate = Math.max(24, Math.round(48 * scale));
  enemies.reset(preset);
  pickups.reset();
  viewpoints.reset();
  for (const s of sites) { s.known = false; s.cleared = false; }
  worldMap.setWaypoint(null);
  input.reset(); input.clearToggles(); input.setInteract(null);
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  ui.fade(false, 0); ui.hideTitleCard(); ui.setPrompt(null); ui.setRegen(false); ui.setAiming(0);
  ui.setHP(player.hp, player.maxHP);
  ui.setAmmo(weapon.ammo, weapon.reserve, weapon.isReloading);
  ui.setEnemies(enemies.remaining, enemies.total);
  roundDirty = false;
  updateIntel(true);
}

function startPlaying() {
  audio.resume();
  audio.play('uiClick');
  ui.hideOverlays();
  ui.hideOverview();
  ui.setHUDVisible(true);
  input.enabled = true;
  if (!isTouch) input.lockPointer();
  const fresh = !roundDirty;
  state = 'playing';
  roundDirty = true;
  camera.fov = BASE_FOV + (AIM_FOV - BASE_FOV) * player.aimE; camera.updateProjectionMatrix();
  clock.getDelta();
  if (fresh) {
    const squads = mapSites.length;
    ui.titleCard('任務開始', '全ロボットを停止せよ', `訓練ロボット ${enemies.total} 体 · ${squads} 部隊 · 難易度 ${preset.label}`);
    setTimeout(() => { if (state === 'playing') ui.toast(ui.isTouch ? 'ミニマップをタップすると地図が開きます' : 'M キーで地図 · 塔の足元で F キーで登る'); }, 3800);
  }
}

function startFromMenu() {
  if (roundDirty || diffKey() !== appliedKey) resetGame();
  startPlaying();
}
function newRound() { resetGame(); startPlaying(); }

function toTitle() {
  resetGame();
  showStartScreen();
}

function endRound(won) {
  if (state !== 'playing') return;
  state = won ? 'won' : 'lost';
  input.enabled = false;
  input.setInteract(null);
  ui.setPrompt(null);
  climb = null; ui.fade(false, 0.2); ui.hideTitleCard();
  if (document.pointerLockElement) document.exitPointerLock();
  const s = {
    time: stats.time,
    accuracy: stats.shots ? stats.hits / stats.shots : 0,
    hpLeft: Math.max(0, Math.round(player.hp)),
    killed: enemies.total - enemies.remaining, total: enemies.total,
    difficulty: preset.label,
    viewpoints: viewpoints.list.length ? `${viewpoints.climbedCount}/${viewpoints.list.length}` : undefined,
    pickups: stats.pickups,
  };
  audio.play(won ? 'win' : 'lose');
  const opts = { onRestart: newRound, onTitle: toTitle };
  if (won) ui.showWin(s, opts); else ui.showLose(s, opts);
}

function showStartScreen() {
  state = 'menu';
  input.enabled = false;
  ui.setHUDVisible(false);
  ui.hideOverview();
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  ui.showStart({
    difficulty: settings.difficulty, custom: settings.custom,
    briefing: '城壁の町サン・ジミニャーノと周辺の丘に配備された訓練用ロボット部隊をすべて停止させよ。塔に登れば周囲の部隊を偵察できる。',
    onStart: startFromMenu,
    onDifficulty: (id, custom) => { settings.difficulty = id; if (custom) settings.custom = custom; settings.save(); },
    onSettings: () => showSettings(false, showStartScreen),
  });
}

function showPauseMenu() {
  ui.showPause({
    onResume: startPlaying,
    onMap: () => openMap(),
    onOverview: enterOverview,
    onSettings: () => showSettings(true, showPauseMenu),
    onRestart: newRound,
    difficultyLabel: preset.label, time: stats.time,
  });
}

function showSettings(inRound, back) {
  ui.showSettings({
    inRound, difficulty: settings.difficulty, custom: settings.custom, quality: gfx.quality, volume: settings.volume,
    onDifficulty: (id, custom) => {
      settings.difficulty = id; if (custom) settings.custom = custom; settings.save();
      if (inRound) newRound();
    },
    onQuality: (q) => { settings.set('quality', q); try { gfx.setQuality(q); } catch (e) { console.warn(e); } },
    onVolume: (v) => { settings.set('volume', v); audio.setVolume(v); },
    onBack: back,
  });
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  input.enabled = false;
  input.setInteract(null);
  ui.setPrompt(null);
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hideTitleCard();
  showPauseMenu();
}

function openMap() {
  if (state !== 'playing' && state !== 'paused') return;
  mapReturn = state;
  state = 'map';
  input.enabled = false;
  ui.hideOverlays();
  ui.setHUDVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
  updateIntel(true);
  ui.hideTitleCard();
  audio.resume();
  audio.play('mapOpen');
  worldMap.open();
}
worldMap.onClose = () => {
  if (state !== 'map') return;
  audio.play('mapClose');
  if (mapReturn === 'paused') { state = 'paused'; showPauseMenu(); } else startPlaying();
};
worldMap.onWaypoint = (wp) => { if (wp) audio.play('uiClick'); };

function enterOverview() {
  if (state !== 'paused' && state !== 'playing') return;
  state = 'overview';
  input.enabled = false;
  ui.hideOverlays();
  ui.setHUDVisible(false);
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  ui.hideTitleCard();
  overviewCam.enter(player.pos, player.yaw);
  ui.showOverview({
    back: exitOverview,
    me: () => overviewCam.lookAt(player.pos.x, player.pos.z, 110),
    town: () => overviewCam.lookAt(0, 0, 360),
    in: () => overviewCam.zoom(1 / 1.6),
    out: () => overviewCam.zoom(1.6),
  });
}
function exitOverview() {
  if (state !== 'overview') return;
  overviewCam.exit();
  ui.hideOverview();
  startPlaying();
}

input.onPause = pause;
input.onMap = () => { if (state === 'playing') openMap(); };
ui.bindInput(input);
ui.onMapRequest = () => { if (state === 'playing') openMap(); };

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { lockFailed = false; return; }
  if (!isTouch && state === 'playing') pause();
});
document.addEventListener('pointerlockerror', () => { lockFailed = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'overview') { e.preventDefault(); exitOverview(); }
});

// ---------- viewpoints ----------
function startClimb(vp, mode) {
  if (climb) return;
  climb = { vp, mode, t: 0, stage: 0 };
  input.clearToggles();
  ui.fade(true, 0.28);
  audio.play('whoosh');
}
function finishClimbTeleport(c) {
  const vp = c.vp;
  if (c.mode === 'climb') {
    player.pos.copy(vp.top);
    viewpoints.current = vp;
    if (vp.yaw !== null) player.yaw = vp.yaw;
    player.pitch = -0.2;
    player.camRise = -1.3;
    vp.climbed = true;
    const n = revealAround(vp);
    ui.titleCard('展望ポイント', vp.name, n ? `周辺の敵部隊 ${n} つを発見 — 地図に表示しました` : '周辺の敵部隊はすでに把握済みです');
    audio.play('discover');
  } else {
    player.pos.copy(vp.base);
    viewpoints.current = null;
    player.camRise = 0.7;
  }
  player.velY = 0; player.grounded = true;
  player.aim = player.aimE = player.leanRaw = player.lean = 0;
  updateIntel(true);
}
function updateClimb(dt) {
  const c = climb;
  c.t += dt;
  if (c.stage === 0 && c.t >= 0.3) {
    finishClimbTeleport(c);
    c.stage = 1;
    ui.fade(false, 0.55);
  }
  if (c.stage === 1 && c.t >= 0.95) climb = null;
}

// ---------- pickups ----------
let lastDenyToast = -10;
function denyToast(text) {
  if (stats.time - lastDenyToast < 4) return;
  lastDenyToast = stats.time;
  ui.toast(text);
}
function collect(item) {
  if (item.type === 'ammo') {
    const room = maxReserve - weapon.reserve;
    if (room <= 0) { denyToast('弾薬はこれ以上持てません'); return false; }
    const n = Math.min(room, ammoPerCrate);
    if (typeof weapon.addAmmo === 'function') weapon.addAmmo(n); else weapon.reserve += n;
    ui.toast(`弾薬を回収 +${n}`, 'ammo');
    audio.play('pickupAmmo');
  } else {
    if (player.hp >= player.maxHP - 0.5) { denyToast('体力は満タンです'); return false; }
    const n = Math.min(player.maxHP - player.hp, Math.round(player.maxHP * 0.5));
    player.hp += n;
    ui.setHP(player.hp, player.maxHP);
    ui.toast(`医療キット 体力 +${Math.round(n)}`, 'med');
    audio.play('pickupHealth');
  }
  stats.pickups++;
  return true;
}

// ---------- hitscan ----------
const _dir = new THREE.Vector3(), _origin = new THREE.Vector3(), _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

function shoot(shot) {
  stats.shots++;
  camera.getWorldPosition(_origin);
  enemies.noise?.(_origin, 45);   // nearby robots come to investigate gunfire
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * shot.spread;
  _e.set(player.pitch + player.kickPitch + Math.sin(a) * r, player.yaw + player.kickYaw + Math.cos(a) * r, 0);
  _dir.set(0, 0, -1).applyEuler(_e).normalize();

  const maxDist = 300;
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
    if (killed) { ui.toast(`訓練ロボットを停止 — 残り ${enemies.remaining}`); intelT = 0; }
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
  player.sinceHit = 0;
  ui.setHP(player.hp, player.maxHP);
  ui.setRegen(false);
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
const _move = new THREE.Vector3(), _eye = new THREE.Vector3(), _lo = new THREE.Vector3(), _ld = new THREE.Vector3();
const NO_MOVE = { x: 0, y: 0 };
const toward = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));
const smooth01 = (x) => x * x * (3 - 2 * x);

function updatePlayer(dt) {
  const busy = !!climb && climb.stage === 0;          // fading out: no control
  const look = input.consumeLook();
  const lookScale = 1 - 0.42 * player.aimE;            // finer aim while aiming down sights
  player.yaw -= look.dx * lookScale;
  player.pitch = THREE.MathUtils.clamp(player.pitch + look.dy * lookScale, -1.45, 1.45);

  const jump = input.consumeJump();
  if (!busy && jump && player.grounded) { player.velY = PLAYER.jump; player.grounded = false; }
  if (input.consumeReload()) weapon.reload();

  // Aim-down-sights blend (drops while reloading or climbing).
  const aimTarget = input.aim && !weapon.isReloading && !climb ? 1 : 0;
  player.aim = toward(player.aim, aimTarget, dt / AIM_TIME);
  player.aimE = smooth01(player.aim);
  const fov = BASE_FOV + (AIM_FOV - BASE_FOV) * player.aimE;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  const m = busy ? NO_MOVE : input.move;
  const mag = Math.min(1, Math.hypot(m.x, m.y));
  const leaning = Math.abs(player.lean) > 0.08;
  const sprinting = input.sprint && m.y > 0.3 && player.aimE < 0.1 && !leaning;
  const speed = (sprinting ? PLAYER.sprint : PLAYER.walk) * mag * (1 - 0.4 * player.aimE) * (leaning ? 0.85 : 1);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const fx = m.x * cos - m.y * sin, fz = -m.x * sin - m.y * cos;
  const fl = Math.hypot(fx, fz) || 1;
  _move.set(fx / fl * speed * dt, 0, fz / fl * speed * dt);

  player.velY -= PLAYER.gravity * dt;
  _move.y = player.velY * dt;
  physics.moveCircle(player.pos, _move, PLAYER.radius, PLAYER.height);
  const top = viewpoints.current;
  if (top) {
    // Stay on the lookout platform.
    const dx = player.pos.x - top.top.x, dz = player.pos.z - top.top.z, d = Math.hypot(dx, dz);
    if (d > TOP_RADIUS) { player.pos.x = top.top.x + dx / d * TOP_RADIUS; player.pos.z = top.top.z + dz / d * TOP_RADIUS; }
  }
  let ground = physics.groundHeight(player.pos.x, player.pos.z, PLAYER.radius, player.pos.y);
  if (top) ground = Math.max(ground, top.top.y);
  if (player.pos.y <= ground) {
    // Smooth step-up onto kerbs / fountain rim instead of popping.
    player.pos.y = player.velY < 0 && ground - player.pos.y < 0.5 ? THREE.MathUtils.lerp(player.pos.y, ground, Math.min(1, dt * 18)) : ground;
    if (ground - player.pos.y < 0.02) player.pos.y = ground;
    player.velY = 0; player.grounded = true;
  } else if (player.pos.y - ground > 0.05) {
    player.grounded = false;
  }
  const b = world.bounds;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, b.minX, b.maxX);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, b.minZ, b.maxZ);

  // Footsteps.
  const moving = mag > 0.1 && player.grounded;
  if (moving) {
    player.stepPhase += dt * speed / 2.1;
    if (player.stepPhase >= 1) { player.stepPhase -= 1; audio.play('step', { volume: 0.35, rate: 0.9 + Math.random() * 0.2 }); }
  }

  // Lean / peek: smooth, and never through a wall (ray from the head toward the lean side).
  const leanTarget = busy || sprinting ? 0 : input.lean;
  player.leanRaw = toward(player.leanRaw, leanTarget, dt / LEAN_TIME);
  let allowed = 1;
  if (Math.abs(player.leanRaw) > 0.001) {
    const s = Math.sign(player.leanRaw);
    _lo.set(player.pos.x, player.pos.y + PLAYER.eye - LEAN_DROP, player.pos.z);
    _ld.set(cos * s, 0, -sin * s);
    const hit = physics.raycast(_lo, _ld, LEAN_DIST + LEAN_PAD);
    if (hit) allowed = THREE.MathUtils.clamp((hit.distance - LEAN_PAD) / LEAN_DIST, 0, 1);
  }
  const leanMag = Math.min(Math.abs(player.leanRaw), allowed);
  player.lean = Math.sign(player.leanRaw) * leanMag;
  const le = Math.sign(player.lean) * smooth01(Math.abs(player.lean));

  // Camera: eye + head bob + lean offset/roll + climb rise.
  player.camRise *= Math.exp(-dt * 5);
  const bob = moving ? Math.sin(player.stepPhase * Math.PI * 2) * 0.025 * (speed / PLAYER.walk) * (1 - 0.7 * player.aimE) : 0;
  camera.position.set(
    player.pos.x + cos * LEAN_DIST * le,
    player.pos.y + PLAYER.eye + bob - LEAN_DROP * Math.abs(le) + player.camRise,
    player.pos.z - sin * LEAN_DIST * le);
  camera.rotation.set(player.pitch + player.kickPitch, player.yaw + player.kickYaw, -le * LEAN_ROLL);
  camera.updateMatrixWorld();

  // Viewpoint interaction.
  const q = climb ? null : viewpoints.query(player.pos);
  const label = q ? (q.mode === 'climb' ? '登る' : '降りる') : null;
  input.setInteract(label);
  ui.setPrompt(label, q ? q.vp.name : '');
  if (input.consumeInteract() && q) startClimb(q.vp, q.mode);

  // Fire.
  if (input.fireHeld && !busy) {
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

  weapon.update(dt, { moving, speed01: speed / PLAYER.sprint, grounded: player.grounded, lookDX: look.dx, lookDY: look.dy, aim: player.aimE, lean: le });
  ui.setAmmo(weapon.ammo, weapon.reserve, weapon.isReloading);

  // Health regeneration (per difficulty).
  player.sinceHit += dt;
  const regen = player.hp > 0 && player.hp < player.maxHP && regenRate > 0 && player.sinceHit >= regenDelay;
  if (regen) { player.hp = Math.min(player.maxHP, player.hp + regenRate * dt); ui.setHP(player.hp, player.maxHP); }
  ui.setRegen(regen);
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

const _far = new THREE.Vector3(0, -999, 0);
const _focus = new THREE.Vector3();
function update(dt) {
  if (state === 'map') { worldMap.update(dt); return; }
  if (state === 'playing') {
    stats.time += dt;
    if (climb) updateClimb(dt);
    updatePlayer(dt);
    _eye.copy(camera.position);  // enemies see / shoot at the real (leaned) head position
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: player.hp > 0, onPlayerHit, camera });
    pickups.update(dt, player.pos, collect);
    ui.setEnemies(enemies.remaining, enemies.total);
    ui.setCrosshairSpread(4 + weapon.currentSpread * 900);
    ui.setAiming(player.aimE);
    ui.setLockHint(!isTouch && lockFailed && !document.pointerLockElement && !params.has('autostart'));
    if ((intelT -= dt) <= 0) { intelT = 0.25; updateIntel(); }
    if ((hudT -= dt) <= 0) { hudT = 1 / 30; worldMap.drawHUD(getMapState(), 1 / 30); }
    const wp = worldMap.waypoint;
    if (wp && Math.hypot(wp.x - player.pos.x, wp.z - player.pos.z) < 10) { worldMap.setWaypoint(null); ui.toast('目的地に到着しました'); }
    if (enemies.total > 0 && enemies.remaining === 0 && winTimer < 0) winTimer = 1.2;
    if (winTimer > 0 && (winTimer -= dt) <= 0) endRound(true);
    _focus.copy(player.pos);
  } else if (state === 'menu') {
    flyover.update(dt, camera);
    enemies.update(dt, { playerPos: _far, playerEye: _far, playerAlive: false, onPlayerHit() {}, camera });
    _focus.copy(flyover.focus);
  } else if (state === 'overview') {
    overviewCam.update(dt);
    _focus.copy(overviewCam.focus);
  } else if (state === 'won' || state === 'lost') {
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: false, onPlayerHit() {}, camera });
    weapon.update(dt, { moving: false, speed01: 0, grounded: true, lookDX: 0, lookDY: 0, aim: 0, lean: 0 });
    _focus.copy(player.pos);
  } else {
    _focus.copy(player.pos);
  }
  weapon.updateEffects(dt);
  world.update(dt, camera);
  gfx.updateSun(_focus);
  gfx.update(dt, { adaptive: state === 'playing' });
}

function render() {
  if (state === 'map') return;                         // the map covers the whole screen
  if (state === 'menu' || state === 'overview') gfx.render();
  else gfx.render(weapon.viewScene, weapon.viewCamera);
}

// ---------- boot ----------
const t4 = performance.now();
resetGame();
console.log(`[boot] resetGame ${(performance.now() - t4).toFixed(0)} ms`);
gfx.resize();
// Compile every shader behind the loading screen so the first frames don't hitch (slow on phones).
try {
  gfx.updateSun(player.pos);
  await gfx.compile([[weapon.viewScene, weapon.viewCamera]]);
} catch (e) { console.warn('[boot] shader precompile skipped', e); }
// Bake the top-down map (robots, crates and effects hidden), still behind the loading screen.
if (!params.has('nomap')) {
  const robots = enemies.group ? [enemies.group] : (enemies.list || []).map((r) => r.group || r.mesh).filter(Boolean);
  worldMap.bake({ hide: [pickups.group, ...robots] });
}
console.log(`[boot] ready in ${(performance.now() - t0).toFixed(0)} ms`);
document.getElementById('boot')?.remove();
showStartScreen();
if (params.has('autostart')) startFromMenu(); // for automated screenshots
// Debug/test hooks. freeze(true) stops the real-time loop; step(n, dt) advances the simulation
// n fixed steps and renders one frame (headless software GL is far too slow for real time).
window.__game = {
  scene, camera, player, enemies, weapon, world, city: world.parts.city, physics, renderer, gfx, input, ui, audio,
  map: worldMap, pickups, viewpoints, overviewCam, flyover, settings, sites,
  get state() { return state; }, startPlaying, endRound, shoot, pause, newRound, toTitle,
  freeze(v = true) { frozen = v; clock.getDelta(); },
  step(n = 1, dt = 1 / 30, draw = true) { for (let i = 0; i < n; i++) update(dt); if (draw) render(); },
  openMap() { if (state === 'menu') startFromMenu(); openMap(); worldMap.update(0); },
  closeMap() { worldMap.close(); },
  /** Teleport next to a viewpoint and climb it instantly (or animated with instant=false). */
  climb(id, instant = true) {
    const vp = typeof id === 'object' ? id : (viewpoints.get(id) || viewpoints.list[0]);
    if (!vp) return false;
    if (state !== 'playing') startFromMenu();
    player.pos.copy(vp.base);
    if (instant) { finishClimbTeleport({ vp, mode: 'climb' }); player.camRise = 0; }
    else startClimb(vp, 'climb');
    return vp.id;
  },
  descend(instant = true) {
    const vp = viewpoints.current;
    if (!vp) return false;
    if (instant) { finishClimbTeleport({ vp, mode: 'descend' }); player.camRise = 0; } else startClimb(vp, 'descend');
    return true;
  },
  overview(on = true) { if (on) { if (state === 'menu') startFromMenu(); enterOverview(); } else exitOverview(); },
  setDifficulty(id, custom) { settings.difficulty = id; if (custom) settings.custom = custom; settings.save(); newRound(); return preset; },
  intel() { updateIntel(true); return { objective, sites: mapSites.map((s) => ({ id: s.id, alive: s.alive, total: s.total, known: s.known, cleared: s.cleared })) }; },
};
requestAnimationFrame(frame);
