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
import { Helicopter } from './helicopter.js';
import { Tank, buildDepot } from './tank.js';
import { Combat } from './combat.js';
import { EnemyVehicles } from './enemy-vehicles.js';
import { HELIPAD, TANK_DEPOT } from './layout.js';

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
const heli = new Helicopter({ scene, physics, world, pad: HELIPAD, hp: 520 });
buildDepot(scene, TANK_DEPOT, world.groundAt);
const ptank = new Tank({ scene, physics, world, livery: 'player', hp: 1600 });
ptank.reset(TANK_DEPOT.x, TANK_DEPOT.z, TANK_DEPOT.yaw);
const combat = new Combat({ scene, physics, world, enemies, audio });
const ev = new EnemyVehicles({ scene, physics, world, combat, audio });
const heliHud = document.createElement('div');
heliHud.className = 'heli-hud';
heliHud.innerHTML = '<span>装甲 <b class="hh-hp">100</b>%</span><span class="hh-alt-w">高度 <b class="hh-alt">0</b> m</span><span>速度 <b class="hh-spd">0</b> km/h</span><span class="hh-wpn"></span><small class="hh-hint"></small>';
ui.root.appendChild(heliHud);
const hh = { hp: heliHud.querySelector('.hh-hp'), altW: heliHud.querySelector('.hh-alt-w'), alt: heliHud.querySelector('.hh-alt'), spd: heliHud.querySelector('.hh-spd'), wpn: heliHud.querySelector('.hh-wpn'), hint: heliHud.querySelector('.hh-hint') };
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
let vehicle = null;                  // null | 'heli' | 'tank' — the vehicle the player is in
const fcam = { yaw: 0, pitch: -0.12 };  // chase-camera orientation in a vehicle
const respawnT = { heli: -1, tank: -1 }; // destroyed player vehicles come back at the pad / depot
let shake = 0;                         // camera shake from nearby explosions
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
  // Squads cleared: the nearest enemy vehicle becomes the objective.
  if (!objective && typeof ev !== 'undefined') {
    const n = ev.nearest(px, pz);
    if (n) objective = { x: n.x, z: n.z, name: n.name, dist: n.dist, alive: 1, inside: false };
  }
  mapRobots.length = 0;
  if (typeof ev !== 'undefined') for (const m of ev.markers()) mapRobots.push({ x: m.x, z: m.z, kind: m.kind });
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
  setVehicle(null);
  heli.reset();
  ptank.reset(TANK_DEPOT.x, TANK_DEPOT.z, TANK_DEPOT.yaw);
  respawnT.heli = respawnT.tank = -1; shake = 0;
  combat.reset();
  weapon.reset();
  const scale = preset.ammoScale || 1;
  weapon.reserve = Math.round(weapon.reserve * scale);
  maxReserve = Math.max(weapon.reserve, Math.round((weapon.magSize || 24) * 10 * scale));
  ammoPerCrate = Math.max(24, Math.round(48 * scale));
  enemies.reset(preset);
  ev.reset(preset);
  ev.solids = [ptank];
  pickups.reset();
  viewpoints.reset();
  for (const s of sites) { s.known = false; s.cleared = false; }
  worldMap.setWaypoint(null);
  input.reset(); input.clearToggles(); input.setInteract(null);
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  ui.fade(false, 0); ui.hideTitleCard(); ui.setPrompt(null); ui.setRegen(false); ui.setAiming(0);
  ui.setHP(player.hp, player.maxHP);
  ui.setAmmo(weapon.ammo, weapon.reserve, weapon.isReloading);
  ui.setEnemies(remainingEnemies(), totalEnemies());
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
    ui.titleCard('任務開始', '全ロボットと敵車両を撃破せよ', `訓練ロボット ${enemies.total} 体 · ${squads} 部隊 · 戦車とヘリ ${ev.total} 台 · 難易度 ${preset.label}`);
    setTimeout(() => { if (state === 'playing') ui.toast('南門の外にヘリ、東門の外に戦車があります'); }, 3800);
    setTimeout(() => { if (state === 'playing') ui.toast(ui.isTouch ? 'ミニマップをタップすると地図が開きます' : 'M キーで地図 · 塔の足元で F キーで登る'); }, 8000);
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
    killed: totalEnemies() - remainingEnemies(), total: totalEnemies(),
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
  let enemyHit = enemies.raycast(_origin, _dir, worldHit ? worldHit.distance : maxDist);
  weapon.getMuzzleWorld(camera, _muzzle);
  // Enemy tanks / helicopters: rifle rounds do little against armour.
  const vHit = combat._trace(_origin, _dir, enemyHit ? enemyHit.distance : worldHit ? worldHit.distance : maxDist, 'player', null);
  if (vHit && vHit.target) {
    stats.hits++;
    const t = vHit.target, was = t.alive;
    t.damage(t.ref?.kind === 'tank' ? 8 : 22, _origin, 'bullet');
    weapon.spawnImpact(scene, vHit.point, _dir.clone().negate(), 'robot');
    audio.play('hitRobot', { volume: 0.8, rate: 0.7 });
    ui.hitMarker(was && !t.alive);
    if (was && !t.alive) onVehicleKill(t);
    weapon.spawnTracer(scene, _muzzle, vHit.point);
    return;
  }

  if (enemyHit) {
    stats.hits++;
    const dmg = enemyHit.part === 'head' ? 50 : 25;
    const { killed } = enemies.damage(enemyHit, dmg);
    weapon.spawnImpact(scene, enemyHit.point, enemyHit.normal, 'robot');
    audio.play('hitRobot', { volume: 0.9 });
    ui.hitMarker(killed);
    if (killed) { ui.toast(`訓練ロボットを停止 — 残り ${remainingEnemies()}`); intelT = 0; }
    ui.setEnemies(remainingEnemies(), totalEnemies());
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

// Robot rifle fire: armour takes it while in a vehicle (the tank shrugs most of it off).
function onPlayerHit(damage, fromPos) {
  if (vehicle) { vehicleDamage(damage * (vehicle === 'tank' ? 0.15 : 0.9), fromPos); return; }
  playerDamage(damage, fromPos);
}
function playerDamage(damage, fromPos) {
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
  pushOutOfTanks(player.pos, PLAYER.radius);
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

  // Viewpoint / vehicle interaction.
  const free = !climb && !viewpoints.current;
  const board = free && heli.canBoard(player.pos) ? 'heli' : free && canBoardTank(player.pos) ? 'tank' : null;
  const q = climb || board ? null : viewpoints.query(player.pos);
  const label = board === 'heli' ? 'ヘリに乗る' : board === 'tank' ? '戦車に乗る' : q ? (q.mode === 'climb' ? '登る' : '降りる') : null;
  input.setInteract(label);
  ui.setPrompt(label, board === 'heli' ? 'ヘリコプター' : board === 'tank' ? '戦車' : q ? q.vp.name : '');
  if (input.consumeInteract()) { if (board) { enterVehicle(board); return; } if (q) startClimb(q.vp, q.mode); }

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
  regenerate(dt);
}

// ---------- vehicles (player helicopter and tank) ----------
const _ct = new THREE.Vector3(), _cd = new THREE.Vector3(), _cp = new THREE.Vector3(), _ce = new THREE.Euler(0, 0, 0, 'YXZ');
const _ap = new THREE.Vector3(), _ao = new THREE.Vector3(), _adir = new THREE.Vector3(), _vm = new THREE.Vector3(), _vd = new THREE.Vector3();
const _pv = new THREE.Vector3(), _ppPrev = new THREE.Vector3();
let hudHeliT = 0, heliBlocked = false, mgT = 0;
const vehObj = () => (vehicle === 'heli' ? heli : vehicle === 'tank' ? ptank : null);
const totalEnemies = () => enemies.total + ev.total;
const remainingEnemies = () => enemies.remaining + ev.remaining;

// Enemy fire (shells, rockets, cannon) finds the player through this target.
combat.player = {
  pos: new THREE.Vector3(), radius: 0.55, cy: 1.0, alive: true,
  damage(amount, from, kind) { if (vehicle) vehicleDamage(amount, from); else playerDamage(kind === 'blast' ? amount * 0.8 : amount, from); },
};
combat.onKill = (t) => onVehicleKill(t);
combat.onRobotKill = () => { intelT = 0; ui.hitMarker(true); ui.toast(`訓練ロボットを停止 — 残り ${remainingEnemies()}`); };
combat.onExplosion = (pos, size) => {
  const d = pos.distanceTo(camera.position);
  shake = Math.max(shake, size * 0.9 * Math.max(0, 1 - d / 70));
};
function onVehicleKill(t) {
  intelT = 0;
  ui.hitMarker(true);
  ui.toast(`${t.ref?.name || '敵車両'}を撃破 — 残り ${remainingEnemies()}`, 'ok');
  audio.play('objective');
}

function canBoardTank(p) {
  return ptank.alive && Math.hypot(p.x - ptank.pos.x, p.z - ptank.pos.z) < 4.6 && Math.abs(p.y - ptank.pos.y) < 2.5;
}
// Keep a body (the player on foot, the player's tank) out of the tanks' hulls.
function pushOutOfTanks(pos, r, self = null) {
  const list = [ptank, ...ev.tanks.filter((v) => v.inUse).map((v) => v.obj)];
  for (const t of list) {
    if (t === self || !t.group.visible) continue;
    const dx = pos.x - t.pos.x, dz = pos.z - t.pos.z, d = Math.hypot(dx, dz), R = r + t.radius - 0.2;
    if (d < R && d > 1e-4 && Math.abs(pos.y - t.pos.y) < 3) { pos.x = t.pos.x + dx / d * R; pos.z = t.pos.z + dz / d * R; }
  }
}

function setVehicle(kind) {
  vehicle = kind;
  heli.piloted = kind === 'heli';
  input.setVehicle(kind);
  document.body.classList.toggle('flying', kind === 'heli');
  document.body.classList.toggle('in-vehicle', !!kind);
  hh.altW.style.display = kind === 'heli' ? '' : 'none';
}
function enterVehicle(kind) {
  setVehicle(kind);
  input.clearToggles();
  player.aim = player.aimE = player.leanRaw = player.lean = 0;
  const v = vehObj();
  fcam.yaw = kind === 'tank' ? v.yaw + v.turretYaw : v.yaw; fcam.pitch = kind === 'tank' ? -0.05 : -0.12;
  camera.fov = BASE_FOV; camera.updateProjectionMatrix();
  ui.setPrompt(null); input.setInteract(null);
  audio.play('vehicleEnter');
  if (kind === 'heli') {
    hh.hint.textContent = isTouch ? '' : 'WASD 移動 · Space/C 上昇/下降 · 左クリック 機関砲 · 右クリック ロケット · 着陸して F';
    ui.toast(isTouch ? 'ヘリに搭乗' : 'ヘリコプターに搭乗 — ローターが回り始めます');
  } else {
    hh.hint.textContent = isTouch ? '' : 'W/S 前進・後退 · A/D 旋回 · マウスで砲塔 · 左クリック 主砲 · 右クリック 機銃 · F で降りる';
    ui.toast(isTouch ? '戦車に搭乗 — 右側ドラッグで砲塔' : '戦車に搭乗 — 砲塔は視点の向きに回ります');
  }
}
function tankExitSpot(out) {
  const t = ptank, s = Math.sin(t.yaw), c = Math.cos(t.yaw);
  for (const [dx, dz] of [[-c, s], [c, -s], [s, c], [-s, -c]]) for (const d of [3.4, 4.6, 6]) {
    const x = t.pos.x + dx * d, z = t.pos.z + dz * d;
    _ao.set(x, t.pos.y + 0.3, z);
    physics.moveCircle(_ao, _vd.set(0, 0, 0), 0.4, 1.7);
    if (Math.hypot(_ao.x - x, _ao.z - z) > 0.05) continue;
    const g = physics.groundHeight(x, z, 0.35, t.pos.y + 1.5);
    if (Math.abs(g - t.pos.y) > 1.8) continue;
    return out.set(x, g, z);
  }
  return out.set(t.pos.x + c * 3.4, t.pos.y, t.pos.z - s * 3.4);
}
function exitVehicle() {
  const kind = vehicle, v = vehObj();
  if (kind === 'heli') heli.exitSpot(player.pos); else tankExitSpot(player.pos);
  setVehicle(null);
  player.yaw = kind === 'tank' ? v.yaw + v.turretYaw : v.yaw; player.pitch = 0; player.velY = 0; player.grounded = true;
  audio.play('uiClick');
}
function vehicleDamage(amount, fromPos) {
  if (state !== 'playing' || !vehicle) return;
  const v = vehObj();
  v.damage(amount);
  const ang = Math.atan2(fromPos.x - v.pos.x, fromPos.z - v.pos.z), fwd = Math.atan2(-Math.sin(fcam.yaw), -Math.cos(fcam.yaw));
  ui.damageIndicator(THREE.MathUtils.euclideanModulo(fwd - ang + Math.PI, Math.PI * 2) - Math.PI);
  if (amount > 20) audio.play('hitRobot', { volume: 0.7, rate: 0.6 });
  if (!v.alive) vehicleDestroyed();
}
// The player's vehicle is knocked out: blast, burning wreck, the player thrown clear and hurt.
function vehicleDestroyed() {
  const kind = vehicle, v = vehObj();
  combat.fireball(_ao.set(v.pos.x, v.pos.y + 1.5, v.pos.z), 1.6);
  combat._sound('explosionBig', v.pos, 1.3);
  combat.smokeColumn(v.pos, 40, 1.1);
  shake = 1.5;
  if (kind === 'heli') {
    const g = physics.groundHeight(v.pos.x, v.pos.z, 0.4, v.pos.y + 1);
    player.pos.set(v.pos.x + 3, Math.max(g, world.groundAt(v.pos.x + 3, v.pos.z)), v.pos.z);
  } else tankExitSpot(player.pos);
  setVehicle(null);
  player.yaw = fcam.yaw; player.pitch = 0; player.velY = 0; player.grounded = true;
  respawnT[kind] = 45;
  ui.toast(kind === 'heli' ? 'ヘリコプターが撃墜された — 45 秒後にヘリポートに補充されます' : '戦車が撃破された — 45 秒後に補充されます', 'warn');
  playerDamage(player.maxHP * (kind === 'heli' ? 0.45 : 0.3), v.pos);
}
function updateRespawns(dt) {
  for (const k of ['heli', 'tank']) {
    if (respawnT[k] < 0 || (respawnT[k] -= dt) > 0) continue;
    const at = k === 'heli' ? HELIPAD : TANK_DEPOT;
    if (Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < 14) { respawnT[k] = 3; continue; }
    respawnT[k] = -1;
    if (k === 'heli') heli.reset(); else ptank.reset(TANK_DEPOT.x, TANK_DEPOT.z, TANK_DEPOT.yaw);
    ui.toast(k === 'heli' ? 'ヘリコプターがヘリポートに補充された' : '戦車が東門の外に補充された');
  }
}

/** The point under the crosshair (what the vehicle weapons converge on). An enemy vehicle close to
 *  the crosshair pulls the aim onto its centre (aim assist; bumps in the ground often cross the ray). */
function aimPoint(out) {
  camera.getWorldPosition(_ao); camera.getWorldDirection(_adir);
  let best = null, bestA = Infinity;
  for (const t of combat.targets) {
    if (!t.alive || t.team === 'player') continue;
    const dx = t.pos.x - _ao.x, dy = t.pos.y + t.cy - _ao.y, dz = t.pos.z - _ao.z, d = Math.hypot(dx, dy, dz);
    if (d > 600 || d < 3) continue;
    const a = Math.acos(THREE.MathUtils.clamp((dx * _adir.x + dy * _adir.y + dz * _adir.z) / d, -1, 1));
    if (a < Math.max(0.035, Math.atan(t.radius * 1.4 / d)) && a < bestA) { bestA = a; best = t; }
  }
  if (best) return out.set(best.pos.x, best.pos.y + best.cy, best.pos.z);
  const h = combat._trace(_ao, _adir, 700, 'player', null);
  return h ? out.copy(h.point) : out.copy(_ao).addScaledVector(_adir, 700);
}

function updateVehicle(dt) {
  const look = input.consumeLook();
  fcam.yaw -= look.dx;
  fcam.pitch = THREE.MathUtils.clamp(fcam.pitch + look.dy, vehicle === 'heli' ? -1.1 : -0.5, 0.45);
  input.consumeJump(); input.consumeReload();
  const v = vehObj();
  if (vehicle === 'heli') {
    heli.update(dt, { move: input.move, up: input.upHeld, down: input.downHeld, boost: input.sprint, heading: fcam.yaw });
    if (heli.blocked && !heliBlocked) ui.toast('ここには着陸できません — 地面か広場に降りてください');
    heliBlocked = heli.blocked;
  } else {
    ptank.drive(dt, input.move.y, input.move.x);
    pushOutOfTanks(ptank.pos, ptank.radius, ptank);
    ptank.update(dt);
  }
  _pv.copy(v.pos).sub(_ppPrev).divideScalar(Math.max(dt, 1e-3)); _ppPrev.copy(v.pos);
  player.pos.copy(v.pos);
  player.yaw = fcam.yaw;
  // Get out: the helicopter has to be landed; the tank any time.
  const canExit = vehicle === 'heli' ? heli.canExit() : true;
  input.setInteract(canExit ? '降りる' : null);
  ui.setPrompt(canExit ? '降りる' : null, vehicle === 'heli' ? 'ヘリコプター' : '戦車');
  if (input.consumeInteract() && canExit) { exitVehicle(); return; }

  // Chase camera: behind and above (over the turret for the tank), pulled in when blocked.
  const tank = vehicle === 'tank';
  _ct.set(v.pos.x, v.pos.y + (tank ? 3.3 : 2.4), v.pos.z);
  _ce.set(fcam.pitch, fcam.yaw, 0);
  _cd.set(0, 0, -1).applyEuler(_ce);
  const dist = tank ? 9 : 13 + heli.speed * 0.12;
  _cp.copy(_ct).addScaledVector(_cd, -dist); _cp.y += tank ? 1.2 : 1.4;
  _ld.copy(_cp).sub(_ct); const L = _ld.length(); _ld.divideScalar(L);
  const hit = physics.raycast(_ct, _ld, L);
  if (hit) _cp.copy(_ct).addScaledVector(_ld, Math.max(1.5, hit.distance - 0.5));
  // Stay out of the ground and out of pitched roofs (building colliders end at the eaves).
  const terr = world.groundAt(_cp.x, _cp.z), top = physics.groundHeight(_cp.x, _cp.z, 0.6, _cp.y + 20);
  _cp.y = Math.max(_cp.y, terr + 0.6, !tank && top > terr + 0.8 ? top + 4 : -Infinity);
  camera.position.copy(_cp);
  camera.lookAt(_ct.x + _cd.x * 30, _ct.y + _cd.y * 30, _ct.z + _cd.z * 30);
  // Tilt the view up a little so the vehicle sits in the lower part of the frame and the way ahead
  // (and the crosshair) stays clear; more on short landscape screens.
  camera.rotateX((tank ? 0.07 : 0.13) * (camera.aspect > 1.6 ? 1.25 : 1));
  camera.updateMatrixWorld();

  // Weapons converge on the point under the crosshair.
  aimPoint(_ap);
  if (tank) {
    ptank.aimAt(dt, _ap);
    if (input.fireHeld) {
      const shot = ptank.fireMain();
      if (shot) {
        combat.projectile({ pos: shot.pos, dir: shot.dir, speed: 240, gravity: 3, damage: 520, splash: 7, splashDmg: 260, team: 'player', kind: 'shell' });
        audio.play('tankGun'); shake = Math.max(shake, 0.6); stats.shots++;
        enemies.noise?.(ptank.pos, 90);
      }
    }
    if (input.fire2Held && (mgT -= dt) <= 0) {
      mgT = 0.09;
      ptank.muzzle(_vm, _vd);
      _vm.addScaledVector(_vd, -3.6); _vm.x += Math.cos(ptank.yaw + ptank.turretYaw) * 0.45; _vm.z -= Math.sin(ptank.yaw + ptank.turretYaw) * 0.45;
      _vd.copy(_ap).sub(_vm).normalize();
      _vd.x += (Math.random() - 0.5) * 0.02; _vd.y += (Math.random() - 0.5) * 0.015; _vd.z += (Math.random() - 0.5) * 0.02; _vd.normalize();
      combat.hitscan({ origin: _vm, dir: _vd, range: 350, damage: 14, robotDamage: 30, team: 'player' });
      audio.play('mg', { volume: 0.7 }); stats.shots++;
      enemies.noise?.(ptank.pos, 60);
    }
  } else if (heli.alive) {
    if (input.fireHeld) {
      const m = heli.fireCannon();
      if (m) {
        _vd.copy(_ap).sub(m).normalize();
        heli.forward(_vm);
        if (_vd.dot(_vm) < 0.55) _vd.lerp(_vm, 0.6).normalize();   // outside the gun's arc
        _vd.x += (Math.random() - 0.5) * 0.012; _vd.y += (Math.random() - 0.5) * 0.012; _vd.z += (Math.random() - 0.5) * 0.012; _vd.normalize();
        combat.hitscan({ origin: m, dir: _vd, range: 450, damage: 30, robotDamage: 45, team: 'player' });
        combat.puff(m, 2, 0.5, 0.05, 0.8);
        audio.play('heliCannon', { volume: 0.8 }); stats.shots++;
        enemies.noise?.(heli.pos, 80);
      }
    }
    if (input.fire2Held) {
      const m = heli.fireRocket();
      if (m) {
        _vd.copy(_ap).sub(m).normalize();
        combat.projectile({ pos: m, dir: _vd, speed: 150, gravity: 0.3, damage: 300, splash: 7, splashDmg: 190, team: 'player', kind: 'rocket' });
        audio.play('rocket'); stats.shots++;
      }
    }
  }

  if ((hudHeliT -= dt) <= 0) {
    hudHeliT = 0.1;
    hh.hp.textContent = String(Math.max(0, Math.round(v.hp / v.hpMax * 100)));
    hh.alt.textContent = String(Math.max(0, Math.round(heli.altitude)));
    hh.spd.textContent = String(Math.round((tank ? Math.abs(ptank.speed) : heli.speed) * 3.6));
    hh.wpn.textContent = tank ? (ptank.reload > 0 ? `主砲 装填中 ${ptank.reload.toFixed(1)}s` : '主砲 発射可') : `ロケット ${heli.rockets}`;
  }
  regenerate(dt);
}
function regenerate(dt) {
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
    if (vehicle) updateVehicle(dt);
    else { updatePlayer(dt); _pv.copy(player.pos).sub(_ppPrev).divideScalar(Math.max(dt, 1e-3)); _ppPrev.copy(player.pos); }
    if (vehicle !== 'heli') heli.update(dt, null);
    if (vehicle !== 'tank') { ptank.drive(dt, 0, 0); ptank.update(dt); }
    if (heli.justCrashed) { combat.fireball(heli.pos, 1.3); combat.smokeColumn(heli.pos, 30, 1); }
    updateRespawns(dt);
    // Enemies see / shoot at the real (leaned) head position, or at the vehicle the player is in.
    const vo = vehObj();
    if (vo) _eye.set(vo.pos.x, vo.pos.y + (vehicle === 'tank' ? 2.2 : 1.6), vo.pos.z); else _eye.copy(camera.position);
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: player.hp > 0, onPlayerHit, camera });
    const cp = combat.player;
    cp.pos.copy(vo ? vo.pos : player.pos); cp.radius = vehicle === 'tank' ? 2.9 : vehicle === 'heli' ? 3.3 : 0.55; cp.cy = vehicle ? 1.4 : 1.0; cp.alive = player.hp > 0;
    ev.update(dt, { target: { pos: cp.pos, cy: cp.cy, vel: _pv, kind: vehicle || 'foot', alive: player.hp > 0 } });
    combat.update(dt, camera);
    if (!vehicle) pickups.update(dt, player.pos, collect);
    ui.setEnemies(remainingEnemies(), totalEnemies());
    ui.setCrosshairSpread(4 + weapon.currentSpread * 900);
    ui.setAiming(player.aimE);
    ui.setLockHint(!isTouch && lockFailed && !document.pointerLockElement && !params.has('autostart'));
    if ((intelT -= dt) <= 0) { intelT = 0.25; updateIntel(); }
    if ((hudT -= dt) <= 0) { hudT = 1 / 30; worldMap.drawHUD(getMapState(), 1 / 30); }
    const wp = worldMap.waypoint;
    if (wp && Math.hypot(wp.x - player.pos.x, wp.z - player.pos.z) < 10) { worldMap.setWaypoint(null); ui.toast('目的地に到着しました'); }
    if (totalEnemies() > 0 && remainingEnemies() === 0 && winTimer < 0) winTimer = 1.2;
    if (winTimer > 0 && (winTimer -= dt) <= 0) endRound(true);
    _focus.copy(player.pos);
  } else if (state === 'menu') {
    heli.update(dt, null);
    ev.update(dt, { target: null });
    combat.update(dt, camera);
    flyover.update(dt, camera);
    enemies.update(dt, { playerPos: _far, playerEye: _far, playerAlive: false, onPlayerHit() {}, camera });
    _focus.copy(flyover.focus);
  } else if (state === 'overview') {
    overviewCam.update(dt);
    _focus.copy(overviewCam.focus);
  } else if (state === 'won' || state === 'lost') {
    heli.update(dt, null);
    ev.update(dt, { target: null });
    combat.update(dt, camera);
    enemies.update(dt, { playerPos: player.pos, playerEye: _eye, playerAlive: false, onPlayerHit() {}, camera });
    weapon.update(dt, { moving: false, speed01: 0, grounded: true, lookDX: 0, lookDY: 0, aim: 0, lean: 0 });
    _focus.copy(player.pos);
  } else {
    _focus.copy(player.pos);
  }
  weapon.updateEffects(dt);
  // Rotor / engine sound: full inside, fading with distance outside; silent in menus / the map.
  const heard = state === 'playing' || state === 'won' || state === 'lost';
  audio.setRotor(heard ? heli.rotor * (vehicle === 'heli' ? 1 : Math.max(0, 1 - camera.position.distanceTo(heli.pos) / 160)) : 0);
  audio.setEngine(heard && vehicle === 'tank' ? 0.15 + 0.85 * Math.min(1, Math.abs(ptank.speed) / 12) : 0);
  // Camera shake from explosions nearby (and the tank's own gun).
  if (shake > 0.01 && (state === 'playing' || state === 'won' || state === 'lost')) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.35; camera.position.y += (Math.random() - 0.5) * shake * 0.35;
    camera.updateMatrixWorld();
  }
  shake *= Math.exp(-dt * 6);
  world.update(dt, camera);
  gfx.updateSun(_focus);
  gfx.update(dt, { adaptive: state === 'playing' });
}

function render() {
  if (state === 'map') return;                         // the map covers the whole screen
  if (state === 'menu' || state === 'overview' || vehicle) gfx.render();   // no weapon viewmodel in a vehicle
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
  map: worldMap, pickups, viewpoints, overviewCam, flyover, settings, sites, heli, fcam,
  ptank, ev, combat,
  get state() { return state; }, get flying() { return vehicle === 'heli'; }, get vehicle() { return vehicle; },
  enterHeli: () => enterVehicle('heli'), exitHeli: () => exitVehicle(), enterTank: () => enterVehicle('tank'), exitVehicle, startPlaying, endRound, shoot, pause, newRound, toTitle,
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
