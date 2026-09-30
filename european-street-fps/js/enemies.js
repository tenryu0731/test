// Training robots for the semi-open world: squads per enemy site (walled town + countryside
// landmarks), three robot types (standard trooper, armoured heavy, fast flanking scout), difficulty
// scaling, patrol / alert / hunt / leash-and-return AI on a lazily built nav graph that follows the
// terrain, simulation + animation LOD (far squads sleep, off-screen robots skip animation), visible
// marker-blaster fire, non-bloody hit reactions (sparks, flash, flinch) and a power-down collapse.
//
// API (docs/CONTRACT.md → enemies.js):
//   new EnemyManager({ scene, physics, audio, world, difficulty })   // or the old { spawns, navPoints }
//   reset(difficultyPreset?)       // (re)spawn all squads; keeps the previous preset when omitted
//   total, remaining
//   update(dt, { playerPos, playerEye, playerAlive, onPlayerHit(damage, fromPos), camera })
//   raycast(origin, dir, maxDist) -> { enemy, point, normal, distance, part: 'head'|'body', dir, origin } | null
//   damage(hit, amount) -> { killed }
//   getMapMarkers() -> [{ x, z, alive, siteId, alerted, type, state }]   (array reused between calls)
//   getSiteStatus() -> [{ id, name, x, z, r, total, alive, alerted }]    (array reused between calls)
//   noise(pos, radius)             // optional: a loud sound (e.g. the player's shot) alerts nearby robots
import * as THREE from 'three';
import { TOWN, SITES, PLAY_HALF } from './layout.js';
import { DIFFICULTY } from './difficulty.js';
import { buildRobotGeometry, createRig, liveryTexture, resetPose, syncMatrices, animateRobot, animateDeath } from './enemies-rig.js';
import { NavGraph } from './enemies-nav.js';
import { Streaks, makeFlashTexture } from './enemies-fx.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wrapAngle = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, TAU) - Math.PI;

// Robot types. Speeds m/s, ranges m, damage per hit on "normal" (× preset.enemyDamage).
export const ROBOT_TYPES = {
  trooper: {
    hp: 100, scale: 1, radius: 0.36, height: 1.8,
    patrolSpeed: 1.3, chaseSpeed: 2.7, strafeSpeed: 1.6, retreatSpeed: 1.9,
    prefRange: [10, 15], minRange: 8,
    burst: [2, 4], burstGap: 0.14, burstCooldown: [0.95, 1.7], damage: 8, accuracy: 1,
    viewDist: 38, huntViewDist: 58, fireRange: 50, stagger: 0.28, knock: 0.12, flinch: 1,
    stride: 1.45, gaitRef: 2.7, crouch: 0.1, lean: 1, kick: 0.32, pitch: 1,
  },
  heavy: {
    hp: 220, scale: 1.12, radius: 0.42, height: 2.0,
    patrolSpeed: 1.0, chaseSpeed: 1.95, strafeSpeed: 1.05, retreatSpeed: 1.3,
    prefRange: [14, 22], minRange: 6,
    burst: [5, 8], burstGap: 0.12, burstCooldown: [1.7, 2.6], damage: 7, accuracy: 0.85,
    viewDist: 38, huntViewDist: 58, fireRange: 60, stagger: 0.1, knock: 0.03, flinch: 0.55,
    stride: 1.35, gaitRef: 2.0, crouch: 0.13, lean: 0.6, kick: 0.2, pitch: 0.82,
  },
  scout: {
    hp: 60, scale: 0.94, radius: 0.33, height: 1.7,
    patrolSpeed: 1.6, chaseSpeed: 3.9, strafeSpeed: 2.9, retreatSpeed: 2.7,
    prefRange: [8, 13], minRange: 6, flank: true,
    burst: [2, 3], burstGap: 0.09, burstCooldown: [0.65, 1.15], damage: 6, accuracy: 0.9,
    viewDist: 44, huntViewDist: 62, fireRange: 42, stagger: 0.3, knock: 0.16, flinch: 1.15,
    stride: 1.6, gaitRef: 3.9, crouch: 0.08, lean: 1.4, kick: 0.4, pitch: 1.2,
  },
};
const TYPE_NAMES = Object.keys(ROBOT_TYPES);

// Shared tuning.
const CFG = {
  fovHalfCos: Math.cos(THREE.MathUtils.degToRad(60)), senseNear: 3.5, losHz: 5,
  reaction: 0.6, forget: 11, shooterGap: 0.35,
  leash: 120,            // max distance from the squad's site while chasing
  patrolMax: 40,         // patrol area radius cap around a site
  lodNear: 120,          // full AI (perception / LOS) within this distance of the player
  lodSleep: 200,         // beyond: squads sleep (rare tick only)
  hideDist: 330,         // robots are not drawn beyond this distance from the camera
  animFull: 45, animHalf: 110, shadowDist: 70, detailDist: 40,
  walkBudget: 45,        // uncached nav walk tests per frame
  plansPerFrame: 1,
  baseCount: 40,         // robots on "normal" (enemyCount = 1)
};
// Kind of countryside site → squad composition preferences.
const FORTIFIED = new Set(['rocca', 'abbey', 'quarry', 'villa']);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _want = new THREE.Vector3(), _goal = new THREE.Vector3(), _camPos = new THREE.Vector3(), _camRight = new THREE.Vector3();
const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _hitP = new THREE.Vector3(), _pv = new THREE.Matrix4();
const _sensor = new THREE.Vector3(), _muz = new THREE.Vector3(), _aim = new THREE.Vector3(), _tgt = new THREE.Vector3();
const _eye = new THREE.Vector3(), _sphere = new THREE.Sphere(), _frustum = new THREE.Frustum();

export class EnemyManager {
  constructor({ scene, physics, audio, world, difficulty, spawns, navPoints, camera } = {}) {
    const t0 = performance.now();
    this.scene = scene; this.physics = physics; this.audio = audio; this.world = world || null;
    this.camera = camera || null;
    const g = (world && world.groundAt) || physics.groundAt;
    this.groundAt = g ? (x, z) => g(x, z) : () => 0;
    this.preset = difficulty || DIFFICULTY.normal;
    this.total = 0; this.remaining = 0;
    this.list = [];
    this.pool = Object.fromEntries(TYPE_NAMES.map((t) => [t, []]));
    this.time = 0; this.frame = 0;
    this.shooters = 0; this.maxShooters = 3;
    this.lastBurstStart = -10;
    this.playerVel = new THREE.Vector3();
    this._pPrev = new THREE.Vector3(0, -1e4, 0);
    this._markers = []; this._siteStatus = [];
    this.stats = { ms: 0, msMax: 0, near: 0, mid: 0, sleep: 0, animated: 0, drawn: 0 };

    // Sites and navigation.
    this.sites = this.allSites = this._buildSites(world, spawns);
    this.nav = new NavGraph(physics, this.groundAt, (world && world.navPoints) || navPoints || []);
    const navGiven = this.nav.size;
    let added = 0;
    for (const s of this.sites) {
      // Thin nav sets (e.g. a countryside site with only a ring of points): add a standable grid,
      // wider in the countryside so chases up to the leash have a graph to follow.
      if (s.mode === 'cqb') continue;   // the compound brings its own dense indoor nav grid
      added += s.town ? this.nav.densify(s.x, s.z, s.patrolR + 6, 3.5, 2.4) : this.nav.densify(s.x, s.z, 75, 6, 4.2);
    }
    for (const s of this.sites) {
      s.nav = this.nav.query(s.x, s.z, s.patrolR).filter((i) => Math.abs(this.nav.pts[i].y - s.y) < 6);
    }
    this.navPoints = this.nav.pts;

    // Shared render resources.
    this.geometries = {};
    for (const t of TYPE_NAMES) this.geometries[t] = { hi: buildRobotGeometry(t, false), lo: buildRobotGeometry(t, true) };
    this.triangles = Object.fromEntries(TYPE_NAMES.map((t) => [t, [this.geometries[t].hi.index.count / 3, this.geometries[t].lo.index.count / 3]]));
    this.darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.55 });
    this.flashMat = new THREE.SpriteMaterial({ map: makeFlashTexture(), color: 0xffe0b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.streaks = new Streaks(scene, 220, this.groundAt);

    this.reset(this.preset);
    console.log(`[enemies] ${this.sites.length} sites, nav ${navGiven} + ${added} synthetic points, ${this.total} robots ` +
      `(${TYPE_NAMES.map((t) => `${t} ${this.list.filter((r) => r.type === t).length}`).join(', ')}), ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // -------------------------------------------------------------------------------------------
  _buildSites(world, spawns) {
    let src = world && Array.isArray(world.enemySites) && world.enemySites.length ? world.enemySites : null;
    if (!src) {
      const sp = (spawns || []).filter(Boolean);
      const c = sp.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, sp.length));
      src = [{ id: 'town', name: '市街', x: c.x, y: sp.length ? c.y : 0, z: c.z, r: 40, spawns: sp }];
    }
    const [tx0, tx1, tz0, tz1] = TOWN.rect;
    return src.map((s, i) => {
      const x = Number.isFinite(s.x) ? s.x : 0, z = Number.isFinite(s.z) ? s.z : 0;
      const town = x > tx0 && x < tx1 && z > tz0 && z < tz1;
      const lay = SITES.find((q) => q.id === s.id) || SITES.find((q) => Math.hypot(q.x - x, q.z - z) < (q.r || 40) + 30);
      const kind = town ? 'town' : (s.type || (lay && lay.type) || 'field');
      const r = Number.isFinite(s.r) ? s.r : 30;
      return {
        id: s.id != null ? String(s.id) : `site${i}`, name: s.name || (lay && lay.name) || s.id || `site${i}`,
        x, z, y: Number.isFinite(s.y) ? s.y : this.groundAt(x, z), r,
        town, kind, patrolR: clamp(r, town ? 16 : 20, CFG.patrolMax),
        mode: s.mode || (lay && lay.mode) || null,
        // Indoor arena: robots stay in the building; trench arena: they cross no-man's-land.
        leash: (s.mode || lay?.mode) === 'cqb' ? 30 : (s.mode || lay?.mode) === 'trench' ? 150 : 0,
        spawns: (s.spawns || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z)),
        nav: [], robots: [],
      };
    });
  }

  // How many robots per site for an enemy-count multiplier (≥ 1 per site, town 2–4, countryside 1–3
  // around normal; the caps grow only when the total would not fit).
  _allocate(c) {
    const sites = this.sites, T = Math.max(sites.length, Math.round(CFG.baseCount * c));
    const w = sites.map((s) => (s.town ? 3 : FORTIFIED.has(s.kind) ? 2.1 : 1.6));
    const sw = w.reduce((a, b) => a + b, 0);
    const minOf = (s) => (s.town && c >= 0.95 ? 2 : 1);
    let capBonus = 0;
    const capOf = (s) => (s.town ? 4 : 3) + capBonus;
    while (sites.reduce((a, s) => a + capOf(s), 0) < T && capBonus < 6) capBonus++;
    const share = sites.map((s, i) => T * w[i] / sw);
    const n = sites.map((s, i) => clamp(Math.floor(share[i]), minOf(s), capOf(s)));
    let left = T - n.reduce((a, b) => a + b, 0);
    const order = sites.map((s, i) => i).sort((a, b) => (share[b] - Math.floor(share[b]) + Math.random() * 0.3) - (share[a] - Math.floor(share[a]) + Math.random() * 0.3));
    for (let pass = 0; left > 0 && pass < 8; pass++) {
      for (const i of order) { if (left <= 0) break; if (n[i] < capOf(sites[i])) { n[i]++; left--; } }
    }
    return n;
  }

  // Robot types for every site: global quotas (≈ 20 % heavy, ≈ 28 % scout, rest troopers) handed to
  // squad slots by preference — heavies lead fortified sites and back up bigger town squads, scouts
  // roam farms / chapels and flank in the town.
  _mixAll(counts) {
    const T = counts.reduce((a, b) => a + b, 0);
    const quota = { heavy: Math.round(T * 0.2), scout: Math.round(T * 0.28) };
    const slots = [];
    this.sites.forEach((site, si) => { for (let k = 0; k < counts[si]; k++) slots.push({ site, si, k, type: null }); });
    const score = {
      heavy: ({ site, k }) => (FORTIFIED.has(site.kind) ? (k === 0 ? 3 : 1) : site.town ? (k === 2 ? 2.5 : k >= 3 ? 1.5 : 0.3) : (k === 1 ? 2 : 1)) + Math.random() * 0.8,
      scout: ({ site, k }) => (site.town ? (k === 1 ? 3 : 0.5) : FORTIFIED.has(site.kind) ? (k === 2 ? 2.5 : k === 1 ? 1.5 : 0.2) : (k === 1 ? 2.5 : 2)) + Math.random(),
    };
    for (const type of ['heavy', 'scout']) {
      const free = slots.filter((sl) => !sl.type).map((sl) => [score[type](sl), sl]).sort((a, b) => b[0] - a[0]);
      for (let n = 0; n < quota[type] && n < free.length; n++) free[n][1].type = type;
    }
    const out = this.sites.map(() => []);
    for (const sl of slots) out[sl.si][sl.k] = sl.type || 'trooper';
    return out;
  }

  _acquire(type) {
    const pool = this.pool[type];
    const r = pool.find((q) => !q.inUse);
    if (r) { r.inUse = true; return r; }
    const k = pool.length;
    const G = this.geometries[type];
    const rig = createRig(type, G.hi, this.darkMat, liveryTexture(type, k));
    rig.group.name = `robot-${type}-${k + 1}`;
    this.scene.add(rig.group);
    const sprite = new THREE.Sprite(this.flashMat);
    sprite.visible = false; sprite.renderOrder = 3;
    this.scene.add(sprite);
    const robot = {
      ...rig, type, cfg: ROBOT_TYPES[type], poolIndex: k, inUse: true, sprite, lod: 0,
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), actVel: new THREE.Vector3(),
      target: new THREE.Vector3(), lastKnown: new THREE.Vector3(), alertPos: new THREE.Vector3(), flankPt: new THREE.Vector3(),
      stuckRef: new THREE.Vector3(), hitDir: new THREE.Vector3(),
      path: null, pathI: 0, pathGoal: new THREE.Vector3(),
    };
    pool.push(robot);
    return robot;
  }

  // -------------------------------------------------------------------------------------------
  // opts: { mode: 'campaign' | 'trench' | 'cqb', count } — the campaign uses every site without a
  // mode; a mode uses only its arena site, with `count` robots (0 → the arena is filled by waves).
  reset(preset, opts) {
    if (preset && typeof preset === 'object') this.preset = preset;
    if (opts) this.opts = opts;
    const O = this.opts || {}, mode = O.mode || 'campaign';
    this.mode = mode;
    this.sites = this.allSites.filter((s) => (mode === 'campaign' ? !s.mode : s.mode === mode));
    const P = this.preset || DIFFICULTY.normal;
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const c = clamp(num(P.enemyCount, 1), 0.2, 3);
    this.hpMul = clamp(num(P.enemyHP, 1), 0.1, 10);
    this.dmgMul = clamp(num(P.enemyDamage, 1), 0, 10);
    this.accMul = clamp(num(P.enemyAccuracy, 1), 0.1, 3);
    this.reactMul = clamp(num(P.enemyReaction, 1), 0.2, 5);
    this.viewMul = clamp(num(P.enemyViewDist, 1), 0.3, 3);
    this.maxShooters = clamp(Math.round(3 * Math.pow(c, 0.6)), 2, 5);

    // Return every robot to its pool, then spawn the new squads.
    for (const r of this.list) { r.inUse = false; r.group.visible = false; r.sprite.visible = false; }
    this.list.length = 0;
    this.time = 0; this.shooters = 0; this.lastBurstStart = -10; this.frame = 0;
    this.streaks.clear();
    const counts = mode === 'campaign' ? this._allocate(c) : this.sites.map(() => Math.max(0, O.count | 0));
    const mix = this._mixAll(counts);
    this.sites.forEach((site, si) => {
      site.robots = [];
      const types = mix[si];
      const spawns = site.spawns.slice().sort(() => Math.random() - 0.5);
      types.forEach((type, k) => {
        const r = this._acquire(type);
        r.site = site; r.id = this.list.length;
        this._placeAtSpawn(r, spawns, k);
        this._initRobot(r);
        site.robots.push(r);
        this.list.push(r);
      });
    });
    this.total = this.list.length;
    this.remaining = this.total;
  }

  _placeAtSpawn(r, spawns, k) {
    const site = r.site, rad = r.cfg.radius;
    const tryAt = (x, z, y0) => {
      const g = this.groundAt(x, z);
      const feet = Number.isFinite(y0) ? Math.max(y0, g) : g;
      const h = this.nav.probe(x, z, rad, feet + 0.05);
      if (h !== h) return false;
      r.pos.set(x, h, z);
      return true;
    };
    let ok = false;
    if (spawns.length) {
      const sp = spawns[k % spawns.length], ring = Math.floor(k / spawns.length);
      const a = k * 2.4;
      ok = tryAt(sp.x + (ring ? Math.cos(a) * 1.6 * ring : 0), sp.z + (ring ? Math.sin(a) * 1.6 * ring : 0), sp.y);
      if (!ok && ring) ok = tryAt(sp.x, sp.z, sp.y);
    }
    for (let n = 0; !ok && n < 12 && site.nav.length; n++) {
      const p = this.nav.pts[site.nav[Math.floor(Math.random() * site.nav.length)]];
      ok = tryAt(p.x, p.z, p.y);
    }
    for (let n = 0; !ok && n < 16; n++) {
      const a = Math.random() * TAU, d = n === 0 ? 0 : rand(2, site.patrolR * 0.6);
      ok = tryAt(site.x + Math.cos(a) * d, site.z + Math.sin(a) * d, site.y);
    }
    if (!ok) r.pos.set(site.x, this.groundAt(site.x, site.z), site.z);
    // Push out of any overlapping collider, then settle on the ground.
    _v1.set(0, 0, 0);
    this.physics.moveCircle(r.pos, _v1, rad, r.cfg.height);
    r.pos.y = this.physics.groundHeight(r.pos.x, r.pos.z, rad * 0.8, r.pos.y + 0.05);
  }

  _initRobot(r) {
    const cfg = r.cfg;
    r.prev.copy(r.pos); r.vel.set(0, 0, 0); r.actVel.set(0, 0, 0);
    r.heading = Math.random() * TAU; r.desiredHeading = r.heading; r.turnRate = 0;
    r.hpMax = cfg.hp * this.hpMul; r.hp = r.hpMax; r.alive = true; r.state = 'patrol';
    r.waitT = rand(0.2, 2.5); r.target.copy(r.pos); r.path = null; r.pathI = 0; r.planWait = 0;
    r.stuckT = 0; r.stuckRef.copy(r.pos); r.stuckCount = 0;
    r.perceptT = Math.random() / CFG.losHz; r.sees = false; r.lastSeen = -100; r.directOK = false;
    r.reactT = 0; r.burstLeft = 0; r.shotT = 0; r.nextBurst = rand(0.3, 1.2); r.firstBurst = true; r.hasToken = false;
    r.strafeDir = Math.random() < 0.5 ? 1 : -1; r.strafeT = rand(1.2, 2.6); r.prefRange = rand(...cfg.prefRange);
    r.flankSide = Math.random() < 0.5 ? 1 : -1; r.flankStage = 0;
    r.forcePathT = 0; r.alertIn = -1; r.searchT = 0; r.giveUpT = 0; r.lostT = 0;
    r.aimBlend = 0; r.alertLevel = 0; r.aimYaw = 0; r.aimPitch = 0; r.aimDist = 20; r.slopePitch = 0;
    r.phase = Math.random() * TAU; r.recoil = 0; r.flinch = 0; r.flinchX = 0; r.flinchZ = 0; r.flash = 0; r.staggerT = 0;
    r.headYaw = 0; r.headPitch = 0; r.headYawT = 0; r.headPitchT = 0; r.twitchT = rand(0.3, 1.5); r.jitter = 0;
    r.deathT = -1; r.fallSign = 1; r.fallTilt = 1.38; r.roll = 0; r.dieSparkT = 0;
    r.flashT = 0; r.sprite.visible = false;
    r.midAcc = 0; r.sleepAcc = rand(0, 2); r.animAcc = 0; r.stale = false; r.tier = 0;
    r.visorMat.emissiveIntensity = 0.5; r.visorMat.emissive.setHex(0x33b8ac);
    r.shellMat.emissiveIntensity = 0;
    if (r.lod !== 0) { r.mesh.geometry = this.geometries[r.type].hi; r.lod = 0; }
    r.mesh.castShadow = true;
    resetPose(r);
    r.group.visible = true;
    animateRobot(r, 0, 0);
  }

  // -------------------------------------------------------------------------------------------
  update(dt, ctx) {
    dt = Math.min(dt, 0.1);
    if (!(dt > 0)) return;
    const t0 = performance.now();
    this.time += dt; this.frame++;
    const cam = ctx.camera || this.camera || (this.camera = this.scene.children.find((o) => o.isCamera) || null);
    this._cam = cam;
    const pp = ctx.playerPos;
    const valid = !!ctx.playerAlive && !!pp && pp.y > -100;
    if (ctx.playerEye) _eye.copy(ctx.playerEye); else if (pp) _eye.set(pp.x, pp.y + 1.62, pp.z);
    this._ctx = ctx;
    if (valid && this._pPrev.distanceToSquared(pp) < 25) {
      _v1.subVectors(pp, this._pPrev).divideScalar(dt); _v1.y = 0;
      this.playerVel.lerp(_v1, Math.min(1, dt * 8));
    } else this.playerVel.set(0, 0, 0);
    if (pp) this._pPrev.copy(pp);

    // Camera frustum for animation culling.
    if (cam) {
      cam.updateMatrixWorld();
      cam.getWorldPosition(_camPos);
      _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
    } else _camPos.copy(pp || _v1.set(0, 0, 0));
    // LOD focus: the player, or the camera when there is no live player (menu flyover).
    const fx = valid ? pp.x : _camPos.x, fz = valid ? pp.z : _camPos.z;

    this.nav.budget = CFG.walkBudget;
    this._plansLeft = CFG.plansPerFrame;
    const st = this.stats;
    st.near = st.mid = st.sleep = st.animated = st.drawn = 0;
    const near2 = CFG.lodNear ** 2, sleep2 = CFG.lodSleep ** 2;

    for (const r of this.list) {
      if (!r.alive) continue;
      const dx = r.pos.x - fx, dz = r.pos.z - fz, d2 = dx * dx + dz * dz;
      if (d2 < near2 || (r.state !== 'patrol' && d2 < sleep2)) {
        r.tier = 0; st.near++;
        this._think(r, Math.min(dt + r.midAcc, 0.2), ctx, valid, d2 < near2);
        r.midAcc = 0;
      } else if (d2 < sleep2) {
        r.tier = 1; st.mid++;
        r.midAcc += dt;
        if ((this.frame + r.id) % 4 === 0) { this._think(r, Math.min(r.midAcc, 0.2), ctx, valid, false); r.midAcc = 0; }
      } else {
        r.tier = 2; st.sleep++;
        if ((r.sleepAcc += dt) > 2) { r.sleepAcc = 0; this._sleepTick(r); }
      }
    }

    // Drawing / animation LOD.
    const hide2 = CFG.hideDist ** 2, full2 = CFG.animFull ** 2, half2 = CFG.animHalf ** 2;
    const shadow2 = CFG.shadowDist ** 2, detail2 = CFG.detailDist ** 2;
    for (const r of this.list) {
      if (r.flashT > 0 && (r.flashT -= dt) <= 0) r.sprite.visible = false;
      const dx = r.pos.x - _camPos.x, dy = r.pos.y - _camPos.y, dz = r.pos.z - _camPos.z, d2 = dx * dx + dy * dy + dz * dz;
      r.animAcc += dt;
      if (d2 > hide2) { if (r.group.visible) r.group.visible = false; r.stale = true; continue; }
      r.group.visible = true;
      const s = r.cfg.scale;
      _sphere.center.set(r.pos.x, r.pos.y + 0.9 * s, r.pos.z); _sphere.radius = 1.3 * s;
      const inView = !cam || _frustum.intersectsSphere(_sphere);
      const lod = d2 > detail2 ? 1 : 0;
      if (lod !== r.lod) { r.lod = lod; r.mesh.geometry = lod ? this.geometries[r.type].lo : this.geometries[r.type].hi; }
      r.mesh.castShadow = d2 < shadow2;
      if (!inView) { r.stale = true; if (r.animAcc > 0.5) r.animAcc = 0.5; continue; }
      st.drawn++;
      const every = d2 < full2 ? 1 : d2 < half2 ? 2 : 4;
      if (r.stale || every === 1 || (this.frame + r.id) % every === 0) this._animate(r);
    }
    this.streaks.update(dt);
    const ms = performance.now() - t0;
    st.ms = st.ms * 0.95 + ms * 0.05; st.msMax = Math.max(st.msMax * 0.995, ms);
  }

  _animate(r) {
    const dt = Math.min(r.animAcc, 0.25);
    r.animAcc = 0; r.stale = false;
    this.stats.animated++;
    if (r.alive) animateRobot(r, dt, this.time);
    else animateDeath(r, dt, (p) => this.streaks.sparks(p, 5, null, 2.5, 0.7));
  }

  // Sleeping squads (far from the player): no simulation; wanderers are sent home out of sight.
  _sleepTick(r) {
    const site = r.site;
    if (r.hasToken || r.burstLeft) this._endBurst(r, 1);
    if (r.state !== 'patrol') { r.state = 'patrol'; r.sees = false; r.path = null; r.alertIn = -1; r.alertLevel = 0; r.aimBlend = 0; }
    const ds = Math.hypot(r.pos.x - site.x, r.pos.z - site.z);
    const dc = Math.hypot(r.pos.x - _camPos.x, r.pos.z - _camPos.z);
    if (ds > site.patrolR + 10 && dc > CFG.hideDist && site.nav.length) {
      const p = this.nav.pts[site.nav[Math.floor(Math.random() * site.nav.length)]];
      r.pos.copy(p); r.prev.copy(p); r.target.copy(p); r.vel.set(0, 0, 0); r.actVel.set(0, 0, 0);
      r.waitT = rand(0.5, 3); r.stale = true;
    }
  }

  // -------------------------------------------------------------------------------------------
  _think(r, dt, ctx, valid, perceive) {
    const P = this.physics, cfg = r.cfg, site = r.site;
    if (perceive) {
      r.perceptT -= dt;
      if (r.perceptT <= 0) {
        r.perceptT = Math.max(0, r.perceptT) + 1 / CFG.losHz * rand(0.9, 1.1);
        this._perceive(r, ctx, valid);
      }
    } else if (r.sees) r.sees = false;
    if (!valid) {
      r.sees = false;
      if (r.state === 'hunt' && (r.giveUpT += dt) > 1.5) this._toReturn(r);
    } else r.giveUpT = 0;

    if (r.state !== 'hunt' && r.alertIn > 0 && (r.alertIn -= dt) <= 0) {
      r.alertIn = -1;
      if (valid) { r.lastKnown.copy(r.alertPos); r.lastSeen = this.time - 2; this._enterHunt(r, false); }
    }

    r.reactT -= dt; r.staggerT -= dt; r.forcePathT -= dt; r.nextBurst -= dt; r.planWait -= dt;
    const want = _want.set(0, 0, 0);
    let speed = 0, faceTarget = null;
    const dSite = Math.hypot(r.pos.x - site.x, r.pos.z - site.z);

    if (r.state === 'patrol') {
      if (r.waitT > 0) {
        r.waitT -= dt;
        if (r.waitT <= 0) this._pickPatrol(r);
      } else {
        speed = cfg.patrolSpeed;
        const reached = this._steer(r, r.target, want);
        if (reached < 0.9) { r.waitT = rand(0.6, 2.6); r.path = null; }
      }
    } else if (r.state === 'return') {
      speed = cfg.chaseSpeed * 0.7;
      const reached = this._steer(r, r.target, want);
      if (reached < 1.5 || (dSite < site.patrolR * 0.6 && reached < 6)) this._toPatrol(r);
    } else if (r.state === 'hunt') {
      if (dSite > (site.leash || CFG.leash)) this._toReturn(r);
      else {
        // Chase goal: the last known position, but never beyond the leash around the site.
        _goal.copy(r.lastKnown);
        const gx = _goal.x - site.x, gz = _goal.z - site.z, gd = Math.hypot(gx, gz), lim = (site.leash || CFG.leash) - 6;
        if (gd > lim) { _goal.set(site.x + gx / gd * lim, 0, site.z + gz / gd * lim); _goal.y = this.groundAt(_goal.x, _goal.z); }
        _v1.subVectors(r.lastKnown, r.pos); _v1.y = 0;
        const d = _v1.length();
        const sinceSeen = this.time - r.lastSeen;
        if (r.sees || sinceSeen < 0.6) {
          faceTarget = r.lastKnown;
          r.searchT = 0; r.flankStage = 0;
          if ((r.strafeT -= dt) <= 0) {
            r.strafeT = rand(1.3, 3.0);
            if (Math.random() < 0.65) r.strafeDir *= -1;
            if (cfg.flank && Math.random() < 0.3) r.flankSide *= -1;
          }
          const dir = _v1.divideScalar(d || 1);
          if (cfg.flank && d < r.prefRange + 10) {
            // Scouts orbit the player at their preferred range, swinging round the flank.
            const a = Math.atan2(-dir.x, -dir.z) + r.flankSide * 0.75;
            const tx = r.lastKnown.x + Math.sin(a) * r.prefRange, tz = r.lastKnown.z + Math.cos(a) * r.prefRange;
            want.set(tx - r.pos.x, 0, tz - r.pos.z);
            const wl = want.length();
            if (wl > 0.01) want.divideScalar(wl);
            speed = d < cfg.minRange ? cfg.retreatSpeed : (r.burstLeft > 0 ? cfg.strafeSpeed * 0.75 : cfg.strafeSpeed);
          } else if (d > r.prefRange + 4 && d > cfg.minRange && gd <= lim + 1) {
            speed = cfg.chaseSpeed;
            if (r.forcePathT > 0) this._steer(r, _goal, want); else want.copy(dir);
          } else if (d < Math.max(cfg.minRange, r.prefRange - 4)) {
            speed = cfg.retreatSpeed;
            want.set(-dir.x + dir.z * r.strafeDir * 0.6, 0, -dir.z - dir.x * r.strafeDir * 0.6).normalize();
          } else {
            speed = r.burstLeft > 0 ? cfg.strafeSpeed * 0.55 : cfg.strafeSpeed;
            want.set(dir.z * r.strafeDir, 0, -dir.x * r.strafeDir);
          }
        } else if (sinceSeen > CFG.forget) {
          if (dSite > site.patrolR) this._toReturn(r); else this._toPatrol(r);
        } else {
          // Lost sight: go to the last known position (scouts first swing out to a flank point).
          if (cfg.flank && r.flankStage === 0) {
            r.flankStage = 1;
            const px = -(r.lastKnown.z - r.pos.z), pz = r.lastKnown.x - r.pos.x, pl = Math.hypot(px, pz) || 1;
            const fx = r.lastKnown.x + px / pl * 7 * r.flankSide, fz = r.lastKnown.z + pz / pl * 7 * r.flankSide;
            const fy = this.nav.probe(fx, fz, cfg.radius, this.groundAt(fx, fz) + 0.3);
            if (fy === fy && Math.hypot(fx - site.x, fz - site.z) < (site.leash || CFG.leash) - 6) r.flankPt.set(fx, fy, fz); else r.flankStage = 2;
          }
          const goal = r.flankStage === 1 ? r.flankPt : _goal;
          const dg = Math.hypot(goal.x - r.pos.x, goal.z - r.pos.z);
          if (r.flankStage === 1 && dg < 1.6) r.flankStage = 2;
          if (dg > 1.4 && r.searchT === 0) {
            speed = cfg.chaseSpeed * 0.9;
            this._steer(r, goal, want);
          } else {
            // arrived: look around, then give up
            r.searchT += dt;
            r.desiredHeading += dt * 1.1 * r.strafeDir;
            if (r.searchT > 3.5) { if (dSite > site.patrolR) this._toReturn(r); else this._toPatrol(r); }
          }
        }
      }
    }

    // separation from other robots and from the player
    for (const o of this.list) {
      if (o === r || !o.alive) continue;
      const dx = r.pos.x - o.pos.x;
      if (dx > 1.7 || dx < -1.7) continue;
      const dz = r.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      const rr = r.cfg.radius + o.cfg.radius + 0.9;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2), f = (rr - d) / rr * 1.6;
        want.x += dx / d * f; want.z += dz / d * f;
        if (speed < 0.8) speed = 0.8;
      }
    }
    if (valid) {
      const dx = r.pos.x - ctx.playerPos.x, dz = r.pos.z - ctx.playerPos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-6) { const d = Math.sqrt(d2); want.x += dx / d * 1.5; want.z += dz / d * 1.5; speed = Math.max(speed, 1.5); }
    }
    const wl = Math.hypot(want.x, want.z);
    if (wl > 1) want.multiplyScalar(1 / wl);
    want.multiplyScalar(speed * (r.staggerT > 0 ? 0.15 : 1));
    // never step into water or off the map
    if (speed > 0) {
      const nx = r.pos.x + want.x * 0.6, nz = r.pos.z + want.z * 0.6;
      if (this.nav.waterLevel(nx, nz) > this.groundAt(nx, nz) || Math.abs(nx) > PLAY_HALF || Math.abs(nz) > PLAY_HALF) {
        want.set(0, 0, 0); r.strafeDir *= -1; r.flankSide *= -1;
      }
    }

    // accelerate toward the desired velocity, move with collisions, follow the ground
    const acc = Math.min(1, dt * 6);
    r.vel.x += (want.x - r.vel.x) * acc; r.vel.z += (want.z - r.vel.z) * acc;
    r.prev.copy(r.pos);
    const vl2 = r.vel.x * r.vel.x + r.vel.z * r.vel.z;
    if (vl2 > 1e-6) {
      _v1.set(r.vel.x * dt, 0, r.vel.z * dt);
      P.moveCircle(r.pos, _v1, cfg.radius, cfg.height);
    }
    const gy = P.groundHeight(r.pos.x, r.pos.z, cfg.radius * 0.8, r.pos.y);
    const rise = gy - r.pos.y;
    if (rise > 0) r.pos.y = rise < 0.12 ? gy : lerp(r.pos.y, gy, Math.min(1, dt * 14));
    else r.pos.y = Math.max(gy, r.pos.y - dt * 6);
    _v1.subVectors(r.pos, r.prev).divideScalar(dt); _v1.y = 0;
    r.actVel.lerp(_v1, Math.min(1, dt * 10));
    // ground slope along the heading (feet / lean)
    if (vl2 > 0.01 || r.tier === 0) {
      const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
      const ga = this.groundAt(r.pos.x + sh * 0.5, r.pos.z + ch * 0.5), gb = this.groundAt(r.pos.x - sh * 0.5, r.pos.z - ch * 0.5);
      r.slopePitch = lerp(r.slopePitch, clamp(Math.atan(ga - gb), -0.35, 0.35), Math.min(1, dt * 6));
    }

    // stuck detection
    if (wl > 0.2 && speed > 0.5) {
      r.stuckT += dt;
      if (r.stuckT > 1.1) {
        const moved = Math.hypot(r.pos.x - r.stuckRef.x, r.pos.z - r.stuckRef.z);
        if (moved < 0.3 * speed) this._onStuck(r);
        else r.stuckCount = 0;
        r.stuckT = 0; r.stuckRef.copy(r.pos);
      }
    } else { r.stuckT = 0; r.stuckRef.copy(r.pos); }

    // heading
    if (faceTarget) r.desiredHeading = Math.atan2(faceTarget.x - r.pos.x, faceTarget.z - r.pos.z);
    else if (Math.hypot(r.vel.x, r.vel.z) > 0.35) r.desiredHeading = Math.atan2(r.vel.x, r.vel.z);
    const diff = wrapAngle(r.desiredHeading - r.heading);
    const maxTurn = (cfg.flank ? 5.5 : r.type === 'heavy' ? 3.2 : 4.2) * dt;
    const step = clamp(diff * Math.min(1, dt * 7), -maxTurn, maxTurn);
    r.heading = wrapAngle(r.heading + step);
    r.turnRate = lerp(r.turnRate, step / dt, Math.min(1, dt * 10));

    // aim solution (spine yaw relative to heading + pitch) toward the player's chest / last known pos
    const hunting = r.state === 'hunt';
    if (hunting) {
      if (r.sees) _aim.set(_eye.x, _eye.y - 0.45, _eye.z); else _aim.set(r.lastKnown.x, r.lastKnown.y + 1.2, r.lastKnown.z);
      _sensor.set(r.pos.x, r.pos.y + 1.43 * cfg.scale, r.pos.z);
      const dx = _aim.x - _sensor.x, dz = _aim.z - _sensor.z, h = Math.hypot(dx, dz);
      r.aimYaw = lerp(r.aimYaw, clamp(wrapAngle(Math.atan2(dx, dz) - r.heading), -0.9, 0.9), Math.min(1, dt * 10));
      r.aimPitch = lerp(r.aimPitch, clamp(Math.atan2(_aim.y - _sensor.y, h), -1.0, 1.0), Math.min(1, dt * 8));
      r.aimDist = Math.max(2, h);
    } else { r.aimYaw = lerp(r.aimYaw, 0, Math.min(1, dt * 4)); r.aimPitch = lerp(r.aimPitch, 0, Math.min(1, dt * 4)); }
    const aimTarget = hunting ? (r.sees || this.time - r.lastSeen < 1.5 ? 1 : 0.55) : 0;
    r.aimBlend += clamp(aimTarget - r.aimBlend, -dt * 2.5, dt * 4);
    r.alertLevel += clamp((hunting || r.state === 'return' ? 1 : 0) - r.alertLevel, -dt * 0.5, dt * 3);

    // ---- shooting (bursts, shared token so they do not all fire at once)
    if (r.burstLeft > 0) {
      if (!r.sees || !valid) this._endBurst(r, rand(0.5, 1.0));
      else if ((r.shotT -= dt) <= 0) {
        this._fire(r, ctx);
        r.shotT = cfg.burstGap * rand(0.85, 1.2);
        if (--r.burstLeft <= 0) this._endBurst(r, rand(...cfg.burstCooldown));
      }
    } else if (valid && r.sees && r.reactT <= 0 && r.nextBurst <= 0 && r.aimBlend > 0.85 && Math.abs(r.aimYaw) < 0.6
      && r.staggerT <= 0 && this.shooters < this.maxShooters && this.time - this.lastBurstStart > CFG.shooterGap
      && r.aimDist < cfg.fireRange * Math.max(1, this.viewMul)) {
      r.burstLeft = randi(cfg.burst[0], cfg.burst[1]);
      r.shotT = 0; r.hasToken = true; this.shooters++;
      this.lastBurstStart = this.time;
    }
  }

  _endBurst(r, cooldown) {
    r.burstLeft = 0;
    if (r.hasToken) { r.hasToken = false; this.shooters = Math.max(0, this.shooters - 1); }
    r.nextBurst = cooldown;
    r.firstBurst = false;
  }

  _perceive(r, ctx, valid) {
    const P = this.physics, cfg = r.cfg;
    const wasSeeing = r.sees;
    r.sees = false;
    const hunting = r.state === 'hunt';
    if (valid) {
      // Perception uses the real camera position (leaning around a corner exposes only the head).
      _sensor.set(r.pos.x, r.pos.y + 1.7 * cfg.scale, r.pos.z);
      const dx = _eye.x - _sensor.x, dy = _eye.y - _sensor.y, dz = _eye.z - _sensor.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const view = (hunting ? cfg.huntViewDist : cfg.viewDist) * this.viewMul;
      if (d2 < view * view) {
        const h = Math.hypot(dx, dz) || 1;
        const cosA = (dx * Math.sin(r.heading) + dz * Math.cos(r.heading)) / h;
        const inCone = hunting || d2 < CFG.senseNear * CFG.senseNear || cosA > CFG.fovHalfCos;
        if (inCone && P.lineOfSight(_sensor, _eye)) r.sees = true;
      }
    }
    if (r.sees) {
      const react = CFG.reaction * this.reactMul;
      if (!wasSeeing && this.time - r.lastSeen > 1.2) r.reactT = Math.max(r.reactT, react + rand(0, 0.3));
      else if (!wasSeeing) r.reactT = Math.max(r.reactT, 0.25 * this.reactMul);
      r.lastSeen = this.time;
      r.lastKnown.set(ctx.playerPos.x, ctx.playerPos.y, ctx.playerPos.z);
      if (r.state === 'patrol' || (r.state === 'return' && Math.hypot(r.pos.x - r.site.x, r.pos.z - r.site.z) < (r.site.leash || CFG.leash) - 12)) this._enterHunt(r, true);
    } else {
      // direct-walk check toward the current goal (cheap: only when not following LOS to the player)
      const goal = hunting ? r.lastKnown : r.target;
      if (Math.hypot(goal.x - r.pos.x, goal.z - r.pos.z) < 60) r.directOK = this.nav.walkable(r.pos, goal, cfg.radius * 0.85, 1.6);
      else r.directOK = false;
    }
  }

  _enterHunt(r, sighted) {
    const was = r.state;
    r.state = 'hunt'; r.path = null; r.searchT = 0; r.alertIn = -1; r.waitT = 0; r.flankStage = 0;
    r.prefRange = rand(...r.cfg.prefRange);
    if (was !== 'hunt') r.firstBurst = true;
    if (was === 'patrol') {
      this._sound('robotAlert', r.pos, sighted ? 0.9 : 0.6, r.cfg.pitch);
      // alert squadmates (and robots of other squads close by), staggered so they do not all engage at once
      let k = 0;
      for (const o of this.list) {
        if (o === r || !o.alive || o.state === 'hunt' || o.alertIn > 0) continue;
        const d = Math.hypot(o.pos.x - r.pos.x, o.pos.z - r.pos.z);
        if ((o.site === r.site && d < 70) || d < 30) {
          o.alertIn = (0.9 + k++ * 0.9 + rand(0, 1.0)) * Math.sqrt(this.reactMul);
          o.alertPos.copy(r.lastKnown);
        }
      }
    }
  }

  _toPatrol(r) {
    if (r.hasToken || r.burstLeft) this._endBurst(r, 1);
    r.state = 'patrol'; r.sees = false; r.path = null; r.waitT = rand(0.5, 1.5); r.searchT = 0; r.giveUpT = 0;
  }

  _toReturn(r) {
    if (r.hasToken || r.burstLeft) this._endBurst(r, 1);
    const site = r.site;
    r.state = 'return'; r.sees = false; r.path = null; r.searchT = 0; r.giveUpT = 0; r.alertIn = -1;
    const c = site.nav.filter((i) => { const p = this.nav.pts[i]; return (p.x - site.x) ** 2 + (p.z - site.z) ** 2 < (site.patrolR * 0.6) ** 2; });
    if (c.length) r.target.copy(this.nav.pts[c[Math.floor(Math.random() * c.length)]]);
    else r.target.set(site.x, site.y, site.z);
    r.directOK = false; r.forcePathT = 0;
  }

  _onStuck(r) {
    r.stuckCount++;
    r.path = null;
    if (r.state === 'patrol') { r.waitT = 0.3; r.target.copy(r.pos); }
    else if (r.state === 'return') { r.forcePathT = 3; r.directOK = false; if (r.stuckCount > 4) { r.stuckCount = 0; this._toPatrol(r); } }
    else { r.strafeDir *= -1; r.flankSide *= -1; r.forcePathT = 3; r.directOK = false; if (r.stuckCount > 3 && !r.sees) { r.searchT = 0.01; r.stuckCount = 0; } }
  }

  // Sets `out` to a unit direction toward goal (directly or along an A* path); returns distance to goal.
  _steer(r, goal, out) {
    const dx = goal.x - r.pos.x, dz = goal.z - r.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { out.set(0, 0, 0); return d; }
    if (r.directOK && r.forcePathT <= 0) { out.set(dx / d, 0, dz / d); return d; }
    if (!r.path || r.pathGoal.distanceToSquared(goal) > Math.max(4, d * d * 0.06)) {
      if (this._plansLeft > 0 && r.planWait <= 0) {
        this._plansLeft--;
        const p = this.nav.plan(r.pos, goal, 700);
        if (p === undefined) { r.path = null; r.planWait = 0.1; } // budget spent: retry soon
        else { r.path = p || []; r.pathI = 0; r.pathGoal.copy(goal); r.planWait = p ? 0.3 : 1.5; }
      }
      if (!r.path) { out.set(dx / d, 0, dz / d); return d; }
    }
    // skip waypoints that are already reached
    const pts = this.nav.pts;
    while (r.pathI < r.path.length) {
      const n = pts[r.path[r.pathI]];
      if (Math.hypot(n.x - r.pos.x, n.z - r.pos.z) < 0.9) r.pathI++; else break;
    }
    const wp = r.pathI < r.path.length ? pts[r.path[r.pathI]] : goal;
    const wx = wp.x - r.pos.x, wz = wp.z - r.pos.z, wd = Math.hypot(wx, wz) || 1;
    out.set(wx / wd, 0, wz / wd);
    return d;
  }

  _pickPatrol(r) {
    const site = r.site, cands = site.nav, pts = this.nav.pts;
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    r.path = null; r.stuckT = 0; r.stuckRef.copy(r.pos);
    if (!cands.length) {
      const a = Math.random() * TAU, d = rand(0, site.patrolR * 0.6);
      const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
      r.target.set(x, this.groundAt(x, z), z);
      r.directOK = true;
      return;
    }
    let best = null, bestScore = -Infinity, tests = 0;
    for (let n = 0; n < 12 && tests < 4; n++) {
      const p = pts[cands[Math.floor(Math.random() * cands.length)]];
      const dx = p.x - r.pos.x, dz = p.z - r.pos.z, d = Math.hypot(dx, dz);
      if (d < 5) continue;
      let score = Math.random() * 2 + (dx * fx + dz * fz) / d * 1.2 + Math.min(d, 18) / 18;
      for (const o of site.robots) if (o !== r && o.alive && o.target.distanceToSquared(p) < 36) score -= 2;
      if (score <= bestScore) continue;
      tests++;
      if (!this.nav.walkable(r.pos, p, r.cfg.radius * 0.85)) continue;
      best = p; bestScore = score;
    }
    if (best) { r.target.copy(best); r.directOK = true; }
    else {
      // nothing in direct reach: walk along the nav graph to a random point of the patrol area
      r.target.copy(pts[cands[Math.floor(Math.random() * cands.length)]]);
      r.directOK = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  _muzzleWorld(r, out) { return out.copy(r.muzzleLocal).applyMatrix4(r.bones.elbowR.matrixWorld); }

  _fire(r, ctx) {
    const P = this.physics, cfg = r.cfg;
    if (r.stale) this._animate(r); // off-screen robots are not animated: bring the pose up to date
    const muzzle = this._muzzleWorld(r, _muz);
    const pp = ctx.playerPos;
    // What of the player can the muzzle see? Chest under the (possibly leaned) eye, the body centre,
    // or only the head peeking round a corner (much harder to hit).
    let exposure = 1, jitter = 1;
    _tgt.set(_eye.x, _eye.y - 0.45, _eye.z);
    if (!P.lineOfSight(muzzle, _tgt)) {
      _tgt.set(pp.x, pp.y + 1.05, pp.z);
      if (!P.lineOfSight(muzzle, _tgt)) {
        _tgt.set(_eye.x, _eye.y - 0.03, _eye.z);
        exposure = 0.4; jitter = 0.35;
      }
    }
    const d = muzzle.distanceTo(_tgt);
    let p = clamp(0.84 - 0.022 * d, 0.12, 0.72) * cfg.accuracy * this.accMul;
    const ps = Math.hypot(this.playerVel.x, this.playerVel.z);
    if (ps > 2.5) p *= 0.72;
    if (r.firstBurst) p *= 0.7;
    const rs = Math.hypot(r.actVel.x, r.actVel.z);
    if (rs > 0.9) p *= cfg.flank ? 0.82 : 0.9;
    p = Math.min(0.92, p * exposure);
    const end = _v1;
    let hit = Math.random() < p;
    if (hit) {
      end.copy(_tgt).add(_v2.set(rand(-0.15, 0.15) * jitter, rand(-0.35, 0.3) * jitter, rand(-0.15, 0.15) * jitter));
      if (!P.lineOfSight(muzzle, end)) hit = false;
    }
    if (hit) {
      ctx.onPlayerHit(cfg.damage * this.dmgMul, muzzle.clone());
    } else {
      // miss: deviate around the player and end the tracer on the world
      const dir = _v2.subVectors(_tgt, muzzle).normalize();
      const u = _v3.set(rand(-1, 1), rand(-1, 0.6), rand(-1, 1));
      u.addScaledVector(dir, -u.dot(dir)).normalize();
      dir.addScaledVector(u, rand(0.55, 1.6) / Math.max(d, 1)).normalize();
      const w = P.raycast(muzzle, dir, 60);
      if (w) {
        end.copy(w.point);
        if (w.distance < 70) this.streaks.sparks(_v4.copy(w.point).addScaledVector(w.normal, 0.03), 3, w.normal, 2.2, 0.6);
      } else end.copy(muzzle).addScaledVector(dir, 60);
    }
    this.streaks.tracer(muzzle, end);
    r.sprite.position.copy(muzzle);
    r.sprite.scale.setScalar(rand(0.16, 0.24) * (r.type === 'heavy' ? 1.25 : 1));
    r.sprite.material.rotation = Math.random() * TAU;
    r.sprite.visible = true; r.flashT = 0.06;
    r.recoil = 1;
    this._sound('robotShot', muzzle, 0.85, rand(0.94, 1.06) * cfg.pitch);
  }

  _sound(name, at, vol = 1, rate = 1) {
    const a = this.audio;
    if (!a || !a.play) return;
    let pan = 0, v = vol;
    const cam = this._cam;
    if (cam) {
      const dx = at.x - _camPos.x, dz = at.z - _camPos.z, d = Math.hypot(dx, dz) || 1;
      v *= clamp(1.15 - d / 60, 0, 1);
      _camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
      pan = clamp((dx * _camRight.x + dz * _camRight.z) / d, -1, 1) * 0.8;
    }
    if (v < 0.03) return;
    try { a.play(name, { volume: v, pan, rate }); } catch { /* audio optional */ }
  }

  /** Trench mode: `n` more robots climb out of the arena site's spawns and advance on `goal`. */
  spawnWave(n, goal, heavyEvery = 5) {
    const site = this.sites[0];
    if (!site) return 0;
    const spawns = site.spawns.slice().sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) {
      const type = k % heavyEvery === heavyEvery - 1 ? 'heavy' : k % 3 === 2 ? 'scout' : 'trooper';
      const r = this._acquire(type);
      r.site = site; r.id = this.list.length;
      this._placeAtSpawn(r, spawns, k);
      this._initRobot(r);
      site.robots.push(r); this.list.push(r);
      this.total++; this.remaining++;
      if (goal) { r.alertIn = 0.4 + k * 0.35; r.alertPos.copy(goal); }
    }
    return n;
  }
  /** Keep attackers pressing toward `goal` (the defended line) while they cannot see the player. */
  pressAssault(goal, spread = 12) {
    for (const r of this.list) {
      if (!r.alive || r.sees) continue;
      r.lastKnown.set(goal.x + rand(-spread, spread), goal.y, goal.z + rand(-3, 3));
      r.lastSeen = this.time - 1;
      if (r.state !== 'hunt' && r.alertIn <= 0) this._enterHunt(r, false);
    }
  }

  // A loud noise at pos (e.g. the player's gunshot): patrolling robots within radius come to look.
  noise(pos, radius = 45) {
    if (!pos) return;
    const r2 = radius * radius;
    for (const r of this.list) {
      if (!r.alive || r.state === 'hunt' || r.alertIn > 0 || r.tier !== 0) continue;
      const dx = r.pos.x - pos.x, dz = r.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      r.alertIn = rand(0.6, 1.6) * this.reactMul;
      r.alertPos.set(pos.x + rand(-6, 6), pos.y, pos.z + rand(-6, 6));
      r.alertPos.y = this.groundAt(r.alertPos.x, r.alertPos.z);
    }
  }

  // -------------------------------------------------------------------------------------------
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const r of this.list) {
      if (!r.alive) continue;
      // broad phase: sphere around the robot
      const s = r.cfg.scale, R = 1.3 * s;
      _v1.set(r.pos.x, r.pos.y + 0.95 * s, r.pos.z).sub(origin);
      const tc = _v1.dot(dir);
      if (tc < -R || tc > maxDist + R) continue;
      if (_v1.lengthSq() - tc * tc > R * R) continue;
      if (r.stale) syncMatrices(r); // not animated lately (off-screen): at least put it where it is
      for (const h of r.hit) {
        _inv.copy(h.bone.matrixWorld).invert();
        _ray.origin.copy(origin).applyMatrix4(_inv);
        _ray.direction.copy(dir).transformDirection(_inv);
        if (!_ray.intersectBox(h.box, _hitP)) continue;
        const local = _v3.copy(_hitP);
        _hitP.applyMatrix4(h.bone.matrixWorld); // world-space distance (robots may be scaled)
        const dist = _hitP.distanceTo(origin);
        if (dist > maxDist || (best && dist >= best.distance)) continue;
        // face normal in bone space
        const b = h.box, n = _v2.set(0, 0, 0);
        let m = Infinity;
        for (let a = 0; a < 3; a++) {
          const lo = Math.abs(local.getComponent(a) - b.min.getComponent(a)), hi = Math.abs(local.getComponent(a) - b.max.getComponent(a));
          if (lo < m) { m = lo; n.set(0, 0, 0).setComponent(a, -1); }
          if (hi < m) { m = hi; n.set(0, 0, 0).setComponent(a, 1); }
        }
        const normal = n.clone().transformDirection(h.bone.matrixWorld);
        best = {
          enemy: r, point: origin.clone().addScaledVector(dir, dist), normal, distance: dist, part: h.part,
          dir: dir.clone(), origin: origin.clone(),
        };
      }
    }
    return best;
  }

  // amount already includes the head multiplier; robot HP includes the difficulty multiplier.
  damage(hit, amount) {
    const r = hit && hit.enemy;
    if (!r || !r.alive || !(amount > 0)) return { killed: false };
    const cfg = r.cfg;
    r.hp -= amount;
    const dir = r.hitDir.copy(hit.dir || _v1.copy(hit.normal).negate());
    dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
    const sh = Math.sin(r.heading), ch = Math.cos(r.heading);
    r.flinchZ = dir.x * sh + dir.z * ch;
    r.flinchX = dir.x * ch - dir.z * sh;
    r.flinch = (hit.part === 'head' ? 1.3 : 1) * cfg.flinch;
    r.flash = 1;
    if (hit.point) this.streaks.sparks(hit.point, r.type === 'heavy' ? 6 : 4, hit.normal, 3, 0.8);
    if (r.hp <= 0) { this._die(r, dir); return { killed: true }; }
    r.staggerT = cfg.stagger;
    if (cfg.knock > 0) this.physics.moveCircle(r.pos, _v1.copy(dir).multiplyScalar(cfg.knock), cfg.radius, cfg.height);
    if (r.burstLeft > 0) r.shotT = Math.max(r.shotT, r.type === 'heavy' ? 0.12 : 0.3);
    this._sound('robotHurt', r.pos, 0.8, rand(0.95, 1.08) * cfg.pitch);
    // being shot always alerts; turn toward the shooter
    if (hit.origin) r.lastKnown.set(hit.origin.x, hit.origin.y - 1.6, hit.origin.z);
    else r.lastKnown.copy(r.pos).addScaledVector(dir, -10);
    if (r.state !== 'hunt') {
      r.lastSeen = this.time - 0.2;
      this._enterHunt(r, false);
      r.reactT = Math.max(r.reactT, 0.5 * this.reactMul);
    } else if (!r.sees) r.lastSeen = Math.max(r.lastSeen, this.time - 0.2);
    return { killed: false };
  }

  _die(r, dir) {
    r.alive = false; r.hp = 0; r.state = 'dead'; r.sees = false; r.alertIn = -1;
    if (r.hasToken || r.burstLeft) this._endBurst(r, 99);
    this.remaining = Math.max(0, this.remaining - 1);
    r.deathT = 0; r.dieSparkT = 0.25;
    if (this.onDeath) this.onDeath(r);
    r.fallSign = r.flinchZ >= 0 ? 1 : -1;
    r.roll = rand(-0.35, 0.35) + r.flinchX * 0.25;
    // Lie along the slope in the fall direction.
    const L = 1.5 * r.cfg.scale, sh = Math.sin(r.heading) * r.fallSign, ch = Math.cos(r.heading) * r.fallSign;
    const hA = this.physics.groundHeight(r.pos.x + sh * L, r.pos.z + ch * L, 0.2, r.pos.y + 0.6) - r.pos.y;
    r.fallTilt = clamp(1.38 - Math.atan2(hA, L), 0.9, 1.75);
    r.vel.set(0, 0, 0); r.actVel.set(0, 0, 0);
    r.sprite.visible = false;
    _v1.set(r.pos.x, r.pos.y + 1.35 * r.cfg.scale, r.pos.z);
    this.streaks.sparks(_v1, 22, dir, 4.5, 1, r.pos.y);
    this._sound('robotDie', r.pos, 1, r.cfg.pitch);
  }

  // -------------------------------------------------------------------------------------------
  // Map / minimap support. Arrays and objects are reused between calls (copy what you keep).
  getMapMarkers() {
    const out = this._markers;
    out.length = this.list.length;
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      const m = out[i] || (out[i] = {});
      m.x = r.pos.x; m.z = r.pos.z; m.alive = r.alive; m.siteId = r.site.id; m.type = r.type; m.state = r.state;
      m.alerted = r.alive && (r.state === 'hunt' || r.alertIn > 0);
    }
    return out;
  }

  getSiteStatus() {
    const out = this._siteStatus;
    out.length = this.sites.length;
    this.sites.forEach((s, i) => {
      const m = out[i] || (out[i] = {});
      m.id = s.id; m.name = s.name; m.x = s.x; m.z = s.z; m.r = s.r; m.town = s.town;
      m.total = s.robots.length; m.alive = 0; m.alerted = false;
      for (const r of s.robots) if (r.alive) { m.alive++; if (r.state === 'hunt' || r.alertIn > 0) m.alerted = true; }
    });
    return out;
  }
}
