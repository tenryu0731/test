// エントリーポイント: 描画設定、HDRI の空と太陽、ゲームループ、カメラ、乗り降り
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { PX, PZ, RH, CITY_W, CITY_D, clamp, damp, params, isTouch, mulberry32 } from './config.js';
import { initMaterials, facadeUniforms } from './materials.js';
import { City } from './city.js';
import { Vehicle, collideVehicles } from './vehicle.js';
import { Traffic } from './traffic.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';

const bootEl = document.getElementById('boot');
if (isTouch) document.body.classList.add('touch');
const say = (t) => { bootEl.textContent = t; };
const QUALITY = params.get('q') || localStorage.getItem('acq') || (isTouch ? 'low' : 'high');

// ---- 描画 ----
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY !== 'high' && QUALITY !== 'low', powerPreference: 'high-performance' });
const maxDpr = { high: 1.5, medium: 1.25, low: 1 }[QUALITY];
let dpr = Math.min(devicePixelRatio, maxDpr);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = QUALITY === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1100);

let composer = null;
function buildComposer() {
  if (QUALITY !== 'high') return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.92));
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass(innerWidth * dpr, innerHeight * dpr));
}

// ---- 空と光（Poly Haven の HDRI から太陽の向きを求める） ----
const sun = new THREE.DirectionalLight(0xfff1de, 3.2);
sun.castShadow = true;
const SH = QUALITY === 'low' ? 1024 : 2048;
sun.shadow.mapSize.set(SH, SH);
const SHR = QUALITY === 'low' ? 55 : 80;
Object.assign(sun.shadow.camera, { left: -SHR, right: SHR, top: SHR, bottom: -SHR, near: 1, far: 400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const sunDir = new THREE.Vector3(0.4, 0.75, 0.3).normalize();

async function loadSky() {
  const hdr = await new RGBELoader().setDataType(THREE.FloatType).loadAsync('assets/game/sky/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
  // 一番明るい画素 = 太陽
  const { data, width, height } = hdr.image;
  let best = -1, bi = 0;
  for (let i = 0; i < width * height; i++) { const l = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722; if (l > best) { best = l; bi = i; } }
  const px = bi % width, py = Math.floor(bi / width);
  const u = (px + 0.5) / width, v = 1 - (py + 0.5) / height;
  const lat = (v - 0.5) * Math.PI, lon = (u - 0.5) * Math.PI * 2;
  sunDir.set(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));
  if (sunDir.y < 0.42) { sunDir.y = 0.42; } // 影が長くなりすぎないように
  sunDir.normalize();
  hdr.dispose();
  // 環境光は HalfFloat で読み直す（Float のままだと一部の GPU / ソフトウェア描画で PMREM が黒くなる）
  const env = await new RGBELoader().loadAsync('assets/game/sky/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
  env.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(env).texture;
  scene.environmentIntensity = 0.9;
  env.dispose(); pm.dispose();
  const bg = await new THREE.TextureLoader().loadAsync('assets/game/sky/kloofendal_48d_partly_cloudy_puresky_4k.jpg');
  bg.mapping = THREE.EquirectangularReflectionMapping; bg.colorSpace = THREE.SRGBColorSpace;
  scene.background = bg;
  scene.backgroundIntensity = 0.85;
  scene.fog = new THREE.FogExp2(0xb9c6d3, 0.0016);
}

// ---- 状態 ----
const player = { onFoot: false, x: 0, z: 0, y: 1.7, yaw: 0, pitch: 0, vy: 0, bob: 0, car: null };
const cam = { mode: 0, yawOff: 0, pitchOff: 0.12, idle: 0, pos: new THREE.Vector3(), shake: 0 };
let city, traffic, input, hud, audio, all = [], parked = [];
let running = false, paused = false;

async function boot() {
  say('マテリアルを読み込んでいます…');
  await initMaterials(renderer);
  say('空（HDRI）を読み込んでいます…');
  await loadSky();
  say('街を生成しています…');
  await new Promise((r) => setTimeout(r, 0));
  city = new City(scene);
  city.generate();
  await city.finalize(say);
  sun.position.copy(sunDir).multiplyScalar(200);

  say('車を準備しています…');
  traffic = new Traffic(scene, city, isTouch || QUALITY === 'low' ? 30 : 46);
  const rnd = mulberry32(5);
  // プレイヤーの車（中央付近の南北道路、北向き）
  const pc = new Vehicle(scene, 'sedan', rnd);
  pc.mode = 'player';
  pc.model.paint.color.set(0x7a0d12);
  pc.setPose(3 * PX + 5.25, 4 * PZ + 30, Math.PI);
  player.car = pc;
  // 駐車場の車
  for (const s of city.parkedSpots) {
    const v = new Vehicle(scene, rnd() < 0.7 ? 'sedan' : 'suv', rnd);
    v.mode = 'parked'; v.setPose(s.x, s.z, s.rot); v.sync(0.016, city); parked.push(v);
  }
  all = [pc, ...traffic.cars, ...parked];
  for (const v of traffic.cars) traffic.spawn(v, { x: pc.pos.x, z: pc.pos.z }, null);

  input = new Input(canvas, document.getElementById('touch'));
  hud = new HUD(document.getElementById('ui'), city);
  audio = new Audio();
  buildComposer();
  // シェーダーを先にコンパイルしておく
  placeCamera(1, true);
  say('シェーダーを準備しています…');
  await renderer.compileAsync(scene, camera);
  bootEl.remove();

  const qs = document.getElementById('quality'); qs.value = QUALITY;
  qs.onchange = () => { localStorage.setItem('acq', qs.value); location.reload(); };
  const go = () => {
    document.getElementById('start').classList.add('hidden');
    running = true; paused = false; input.active = true; audio.start(); document.body.classList.add('playing');
    if (!isTouch) canvas.requestPointerLock?.();
    input.setMode('car');
    if (isTouch) { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); }
  };
  document.getElementById('go').onclick = go;
  document.getElementById('resume').onclick = () => { paused = false; document.getElementById('pause').classList.add('hidden'); if (!isTouch) canvas.requestPointerLock?.(); };
  if (params.has('autostart')) go();
  requestAnimationFrame(loop);
}

// ---- 乗り降り ----
function nearestCar(x, z, maxD) {
  let best = null, bd = maxD;
  for (const v of all) { if (v.mode === 'player') continue; const d = Math.hypot(v.pos.x - x, v.pos.z - z); if (d < bd) { bd = d; best = v; } }
  return best;
}
function enterCar(v) {
  if (v.mode === 'ai') v.ai.active = false;
  v.mode = 'player'; v.vx *= 0.3; v.vz *= 0.3;
  player.car = v; player.onFoot = false; input.setMode('car');
  cam.yawOff = 0; hud.toast(v.type === 'taxi' ? 'タクシーに乗った' : '車に乗った');
}
function exitCar() {
  const v = player.car;
  if (v.speed > 6) { hud.toast('止まってから降りてください'); return; }
  const [fx, fz] = v.forward, lx = fz, lz = -fx; // 左側
  player.x = v.pos.x + lx * (v.spec.W / 2 + 0.7); player.z = v.pos.z + lz * (v.spec.W / 2 + 0.7);
  player.yaw = v.heading + Math.PI; player.pitch = 0;
  v.mode = 'parked'; v.vx = v.vz = 0; v.steer = 0;
  player.car = null; player.onFoot = true; input.setMode('foot');
}

// ---- 徒歩 ----
const tmpV = new THREE.Vector3();
function walk(dt, inp) {
  const sens = 0.0022;
  player.yaw -= inp.lookX * sens; player.pitch = clamp(player.pitch - inp.lookY * sens, -1.35, 1.35);
  const sp = inp.run ? 6.2 : 2.6;
  const fx = Math.sin(player.yaw + Math.PI), fz = Math.cos(player.yaw + Math.PI);
  const rx = -fz, rz = fx;
  let mx = fx * inp.moveY + rx * inp.moveX, mz = fz * inp.moveY + rz * inp.moveX;
  const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
  player.x += mx * sp * dt; player.z += mz * sp * dt;
  // 衝突（建物・柱・車）
  const r = 0.35;
  for (let it = 0; it < 2; it++) {
    const { boxes, poles } = city.query(player.x, player.z, 2);
    for (const b of boxes) {
      const px = clamp(player.x, b.x0, b.x1), pz = clamp(player.z, b.z0, b.z1), dx = player.x - px, dz = player.z - pz, d = Math.hypot(dx, dz);
      if (d < r) { if (d < 1e-4) { player.z = b.z1 + r; } else { player.x += dx / d * (r - d); player.z += dz / d * (r - d); } }
    }
    for (const p of poles) { const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz), rr = r + p.r; if (d < rr && d > 1e-4) { player.x += dx / d * (rr - d); player.z += dz / d * (rr - d); } }
    for (const v of all) for (const [cx, cz] of v.circles()) { const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz), rr = r + v.radius; if (d < rr && d > 1e-4) { player.x += dx / d * (rr - d); player.z += dz / d * (rr - d); } }
  }
  const b = city.bounds; player.x = clamp(player.x, b.x0, b.x1); player.z = clamp(player.z, b.z0, b.z1);
  const gy = city.groundAt(player.x, player.z);
  player.bob += m * sp * dt * 1.9;
  player.y = damp(player.y, gy + 1.68, 14, dt);
  camera.position.set(player.x, player.y + Math.sin(player.bob * 2) * 0.03 * Math.min(1, m), player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  camera.fov = damp(camera.fov, 70, 4, dt); camera.updateProjectionMatrix();
}

// ---- 運転中のカメラ ----
function placeCamera(dt, snap = false, inp = null) {
  const v = player.car;
  if (inp) {
    if (Math.abs(inp.lookX) + Math.abs(inp.lookY) > 0) { cam.yawOff -= inp.lookX * 0.004; cam.pitchOff = clamp(cam.pitchOff + inp.lookY * 0.003, -0.1, 0.9); cam.idle = 0; }
    else cam.idle += dt;
    if (cam.idle > 1.2) { cam.yawOff = damp(cam.yawOff, 0, 3, dt); cam.pitchOff = damp(cam.pitchOff, 0.12, 2, dt); }
  }
  const big = v.type === 'truck';
  if (cam.mode === 1) {
    // ボンネット視点
    const [fx, fz] = v.forward;
    camera.position.set(v.pos.x + fx * 0.2, v.y + 1.25 * (v.spec.hs || 1), v.pos.z + fz * 0.2);
    camera.rotation.set(-cam.pitchOff * 0.3, v.heading + Math.PI + cam.yawOff, 0, 'YXZ');
  } else {
    const dist = (big ? 11 : 6.8) + v.speed * 0.04, h = (big ? 3.6 : 2.2);
    const ang = v.heading + cam.yawOff;
    // 横滑りしているときは進行方向に少し寄せる
    const tx = v.pos.x - Math.sin(ang) * dist * Math.cos(cam.pitchOff), tz = v.pos.z - Math.cos(ang) * dist * Math.cos(cam.pitchOff);
    const ty = v.y + h + Math.sin(cam.pitchOff) * dist;
    if (snap) cam.pos.set(tx, ty, tz);
    else { cam.pos.x = damp(cam.pos.x, tx, 7, dt); cam.pos.z = damp(cam.pos.z, tz, 7, dt); cam.pos.y = damp(cam.pos.y, ty, 5, dt); }
    camera.position.copy(cam.pos);
    if (cam.shake > 0) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake = Math.max(0, cam.shake - dt * 2); }
    camera.lookAt(tmpV.set(v.pos.x + Math.sin(v.heading) * 2.5, v.y + 1.2, v.pos.z + Math.cos(v.heading) * 2.5));
  }
  const fov = 60 + clamp(v.speed / 40, 0, 1) * 14;
  camera.fov = snap ? fov : damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix();
}

// カメラから見えているか（AI の車の入れ替えで使う）
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere();
function visible(x, z) { sph.center.set(x, 1.5, z); sph.radius = 4; return frustum.intersectsSphere(sph) && camera.position.distanceTo(sph.center) < 320; }

// ---- ループ ----
let last = performance.now(), fpsAcc = 0, fpsN = 0, frameAvg = 16;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!running || paused) { if (!running) { traffic.updateSignals(dt); traffic.update(dt, all, { x: player.car.pos.x, z: player.car.pos.z }, null); orbitPreview(now); render(); } return; }
  const inp = input.read();
  if (inp.pressed.has('pause')) { paused = true; document.getElementById('pause').classList.remove('hidden'); document.exitPointerLock?.(); return; }
  update(dt, inp);
  render();

  // 解像度の自動調整
  frameAvg = frameAvg * 0.95 + (dt * 1000) * 0.05;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) {
    if (params.has('fps')) hud.fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps @' + dpr.toFixed(2);
    if (frameAvg > 24 && dpr > 0.6) setDpr(dpr - 0.1); else if (frameAvg < 15 && dpr < Math.min(devicePixelRatio, maxDpr) - 0.05) setDpr(dpr + 0.05);
    fpsAcc = 0; fpsN = 0;
  }
}
// 1 ステップ分のゲーム更新（描画はしない）
function update(dt, inp) {
  if (inp.pressed.has('cam')) cam.mode = (cam.mode + 1) % 2;
  if (inp.pressed.has('horn')) audio.honk();

  let prompt = '';
  if (player.onFoot) {
    walk(dt, inp);
    const near = nearestCar(player.x, player.z, 3.6);
    if (near) prompt = isTouch ? '「乗る」で乗車' : 'F で乗車';
    if (inp.pressed.has('enter') && near) enterCar(near);
  } else {
    const v = player.car;
    v.drive(dt, inp, city);
    if (inp.pressed.has('enter')) exitCar();
  }
  const pp = player.onFoot ? { x: player.x, z: player.z, onFoot: true } : { x: player.car.pos.x, z: player.car.pos.z, onFoot: false };
  projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projM);
  traffic.update(dt, all, pp, visible);
  // 降りた車は遠くなったら交通に戻す
  for (const v of all) if (v.mode === 'parked' && v.ai && Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z) > 150 && !visible(v.pos.x, v.pos.z)) { v.mode = 'ai'; v.ai.active = false; }
  const imp = collideVehicles(all);
  traffic.afterCollisions();
  if (!player.onFoot) {
    const v = player.car;
    v.sync(0.0001, city);
    const hit = Math.max(imp, v.impact); v.impact = 0;
    if (hit > 3) { audio.crash(hit); cam.shake = Math.min(0.5, hit * 0.03); }
    placeCamera(dt, false, inp);
  }
  // 影のカメラをプレイヤーに追従（テクセル単位に揃えてちらつきを抑える）
  const fx = player.onFoot ? player.x : player.car.pos.x, fz = player.onFoot ? player.z : player.car.pos.z;
  const step = (SHR * 2) / SH;
  const cx = Math.round(fx / step) * step, cz = Math.round(fz / step) * step;
  sun.target.position.set(cx, 0, cz); sun.position.set(cx + sunDir.x * 200, sunDir.y * 200, cz + sunDir.z * 200);

  audio.update(dt, { inCar: !player.onFoot, speed: player.onFoot ? 0 : player.car.vLong, throttle: player.onFoot ? 0 : Math.max(0, inp.throttle), skid: player.onFoot ? 0 : player.car.skid });
  hud.update({ inCar: !player.onFoot, speed: player.onFoot ? 0 : player.car.speed, prompt });
  const heading = player.onFoot ? player.yaw + Math.PI : player.car.heading;
  hud.drawMinimap(fx, fz, heading, all);
}

function setDpr(v) { dpr = v; renderer.setPixelRatio(dpr); if (composer) { composer.setPixelRatio(dpr); } }

// 開始前は街の上空をゆっくり回る
function orbitPreview(now) {
  const t = now * 0.00004;
  const cx = CITY_W / 2, cz = CITY_D / 2;
  camera.position.set(cx + Math.cos(t) * 190, 75, cz + Math.sin(t) * 190);
  camera.fov = 55; camera.updateProjectionMatrix();
  camera.lookAt(cx, 20, cz);
}

function render() { if (composer) composer.render(); else renderer.render(scene, camera); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight);
});

// テスト用: 外部から状態を見られるようにする
window.__game = {
  get player() { return player; }, get traffic() { return traffic; }, get all() { return all; }, scene, camera, renderer, cam, RH, facadeUniforms,
  // 描画せずに秒数分だけ進める（自動テスト用）
  simulate(seconds, over = {}, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) {
      const inp = { moveX: 0, moveY: 0, steer: 0, throttle: 0, handbrake: false, run: false, lookX: 0, lookY: 0, pressed: new Set(), ...over };
      if (over.pressedOnce && t === 0) inp.pressed = new Set(over.pressedOnce);
      camera.updateMatrixWorld(); update(dt, inp);
    }
  },
};

boot().catch((e) => { console.error(e); say('読み込みに失敗しました: ' + e.message); });
