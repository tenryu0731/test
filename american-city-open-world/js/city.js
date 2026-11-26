// 街の生成: 碁盤目の道路、歩道、車線表示、建物（外壁シェーダー）、屋上設備、看板、信号、街灯などの小物
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PX, PZ, NBX, NBZ, RH, SW, CURB_H, CITY_W, CITY_D, mulberry32 } from './config.js';
import { pbr, makeFacadeMaterial, texSize, solid } from './materials.js';

// ---------------------------------------------------------------------------
// ジオメトリを材質ごとに溜めて、最後に 1 つの BufferGeometry にする
class Builder {
  constructor(facade) { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.facade = facade; if (facade) { this.fa = []; this.fuv = []; this.sd = []; } }
  get count() { return this.p.length / 3; }
  // a,b,c,d は正面から見て反時計回り
  quad(a, b, c, d, n, uvs, col = [1, 1, 1], fa = null, fuvs = null, seed = 0) {
    const base = this.count;
    for (const v of [a, b, c, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    if (this.facade) { for (let k = 0; k < 4; k++) { this.fa.push(...(fa || [3, 3, 0, -1])); this.sd.push(seed); } for (const t of (fuvs || uvs)) this.fuv.push(t[0], t[1]); }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.facade) {
      g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fa, 4));
      g.setAttribute('aFuv', new THREE.Float32BufferAttribute(this.fuv, 2));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.sd, 1));
    }
    g.setIndex(this.i);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// 面の法線ごとの接線（外から見て右向き）
const FACES = [
  { n: [0, 0, 1], t: [1, 0, 0] }, { n: [0, 0, -1], t: [-1, 0, 0] },
  { n: [1, 0, 0], t: [0, 0, -1] }, { n: [-1, 0, 0], t: [0, 0, 1] },
];

export class City {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(20261126);
    this.chunks = new Map();      // key -> { builders: Map(matKey -> Builder) }
    this.mats = {};
    this.colliders = [];          // 建物などの AABB {x0,z0,x1,z1}
    this.poles = [];              // 円の障害物 {x,z,r}
    this.blocks = [];             // ミニマップ用
    this.instances = {};          // 小物の配置 name -> [Matrix4]
    this.signals = { ew: [], ns: [] };
    this.grid = new Map();        // 衝突判定用グリッド（10 m）
  }

  // ---- 材質 ----
  initMaterials() {
    const M = this.mats;
    M.asphalt = pbr('asphalt_02', { normal: 0.6 });
    M.sidewalk = pbr('concrete_pavement', { normal: 0.8 });
    M.curb = pbr('brushed_concrete');
    M.trim = pbr('brushed_concrete', { color: 0xd8d2c8 });
    M.trimDark = pbr('brushed_concrete', { color: 0x5a554e });
    M.roof = pbr('bitumen');
    M.white = solid(0xe9e6dc, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    M.yellow = solid(0xe3a817, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    M.awning = solid(0xffffff, 0.85, 0, { vertexColors: true, side: THREE.DoubleSide });
    M.metal = solid(0x2b2d2f, 0.45, 0.6);
    M.galv = solid(0x8d9196, 0.4, 0.8);
    M.wood = solid(0x5b4636, 0.85, 0);
    M.housing = solid(0x1c1d1e, 0.5, 0.2);
    M.backplate = solid(0x0b0b0b, 0.7, 0);
    for (const id of ['red_brick_03', 'factory_brick', 'painted_brick', 'beige_wall_001', 'concrete_wall_008', 'grey_plaster_02', 'concrete_tile_facade'])
      M['f_' + id] = makeFacadeMaterial(id);
    // 信号のレンズ（方向 × 色）。点灯は emissiveIntensity で切り替える
    const lens = (c) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.05, roughness: 0.2 });
    this.signalMats = {
      ew: { r: lens(0xff2a1a), y: lens(0xffb000), g: lens(0x20ff90) },
      ns: { r: lens(0xff2a1a), y: lens(0xffb000), g: lens(0x20ff90) },
    };
  }

  builder(x, z, key, facade = false) {
    const ck = Math.floor(x / (PX * 2)) + ',' + Math.floor(z / (PZ * 2));
    let ch = this.chunks.get(ck);
    if (!ch) { ch = new Map(); this.chunks.set(ck, ch); }
    let b = ch.get(key);
    if (!b) { b = new Builder(facade); ch.set(key, b); }
    return b;
  }

  // 直方体（面ごとに世界座標の UV）。mat は文字列、または {top, side, bottom}
  box(x0, y0, z0, x1, y1, z1, mat, opts = {}) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const m = typeof mat === 'string' ? { top: mat, side: mat, bottom: null } : mat;
    const ts = opts.ts || [2, 2];
    const col = opts.color || [1, 1, 1];
    const put = (key, a, b, c, d, n, uvs) => { if (key) this.builder(cx, cz, key).quad(a, b, c, d, n, uvs, col); };
    const U = (u, v) => [u / ts[0], v / ts[1]];
    put(m.top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [U(x0, -z1), U(x1, -z1), U(x1, -z0), U(x0, -z0)]);
    if (opts.noBottom !== false && m.bottom) put(m.bottom, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)]);
    const s = m.side;
    if (s) {
      put(s, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)]);
      put(s, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [U(-x1, y0), U(-x0, y0), U(-x0, y1), U(-x1, y1)]);
      put(s, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [U(-z1, y0), U(-z0, y0), U(-z0, y1), U(-z1, y1)]);
      put(s, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [U(z0, y0), U(z1, y0), U(z1, y1), U(z0, y1)]);
    }
  }

  flat(x0, z0, x1, z1, y, key, ts = [1, 1]) {
    this.builder((x0 + x1) / 2, (z0 + z1) / 2, key).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
      [[x0 / ts[0], -z1 / ts[1]], [x1 / ts[0], -z1 / ts[1]], [x1 / ts[0], -z0 / ts[1]], [x0 / ts[0], -z0 / ts[1]]]);
  }

  addCollider(x0, z0, x1, z1, h = 100) {
    const c = { x0, z0, x1, z1, h };
    this.colliders.push(c);
    for (let gx = Math.floor(x0 / 10); gx <= Math.floor(x1 / 10); gx++)
      for (let gz = Math.floor(z0 / 10); gz <= Math.floor(z1 / 10); gz++) {
        const k = gx + ',' + gz; if (!this.grid.has(k)) this.grid.set(k, { boxes: [], poles: [] }); this.grid.get(k).boxes.push(c);
      }
  }
  addPole(x, z, r) {
    const p = { x, z, r }; this.poles.push(p);
    const k = Math.floor(x / 10) + ',' + Math.floor(z / 10);
    if (!this.grid.has(k)) this.grid.set(k, { boxes: [], poles: [] }); this.grid.get(k).poles.push(p);
  }
  // 周辺の障害物を集める
  query(x, z, r) {
    const boxes = new Set(), poles = new Set();
    for (let gx = Math.floor((x - r) / 10); gx <= Math.floor((x + r) / 10); gx++)
      for (let gz = Math.floor((z - r) / 10); gz <= Math.floor((z + r) / 10); gz++) {
        const c = this.grid.get(gx + ',' + gz); if (!c) continue;
        for (const b of c.boxes) boxes.add(b); for (const p of c.poles) poles.add(p);
      }
    return { boxes, poles };
  }
  // 地面の高さ（歩道は一段高い）
  groundAt(x, z) {
    const bx = Math.floor((x + PX / 2) / PX), bz = Math.floor((z + PZ / 2) / PZ);
    // 最寄りの交差点からの距離で道路かどうかを判定
    const dx = Math.abs(x - Math.round(x / PX) * PX), dz = Math.abs(z - Math.round(z / PZ) * PZ);
    void bx; void bz;
    return (dx > RH && dz > RH) ? CURB_H : 0;
  }

  // ---- 生成 ----
  generate() {
    this.initMaterials();
    const R = this.rng;
    // 地面（アスファルト）
    const [aw, ah] = texSize('asphalt_02');
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.mats.asphalt);
    this.ground.geometry.rotateX(-Math.PI / 2);
    const uv = this.ground.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4000 / (aw * 1.5), uv.getY(i) * 4000 / (ah * 1.5));
    this.ground.position.set(CITY_W / 2, 0, CITY_D / 2);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // ブロック（外周 1 列は街の外側を囲む背景用）
    const cx = CITY_W / 2, cz = CITY_D / 2;
    const special = new Map([['2,3', 'plaza'], ['3,5', 'parking'], ['4,2', 'plaza']]);
    for (let bx = -1; bx <= NBX; bx++) for (let bz = -1; bz <= NBZ; bz++) {
      const ring = bx < 0 || bz < 0 || bx >= NBX || bz >= NBZ;
      const x0 = bx * PX + RH, x1 = (bx + 1) * PX - RH, z0 = bz * PZ + RH, z1 = (bz + 1) * PZ - RH;
      const type = ring ? 'ring' : (special.get(bx + ',' + bz) || 'buildings');
      this.sidewalkBlock(x0, z0, x1, z1);
      const lot = { x0: x0 + SW, z0: z0 + SW, x1: x1 - SW, z1: z1 - SW };
      const mx = (x0 + x1) / 2 - cx, mz = (z0 + z1) / 2 - cz;
      const district = Math.exp(-Math.hypot(mx, mz * 1.1) / 170);
      this.blocks.push({ x0, z0, x1, z1, lot, type });
      if (type === 'buildings' || type === 'ring') this.buildBlock(lot, district, ring, R);
      else if (type === 'plaza') this.buildPlaza(lot, R);
      else if (type === 'parking') this.buildParking(lot, R);
      if (!ring) this.sidewalkProps(x0, z0, x1, z1, R);
    }
    this.roadMarkings();
    this.trafficSignals();
    // 外側には出られないようにする（外周道路の外側の歩道まで）
    const m = RH + 1;
    this.bounds = { x0: -m, z0: -m, x1: CITY_W + m, z1: CITY_D + m };
  }

  sidewalkBlock(x0, z0, x1, z1) {
    const ts = texSize('concrete_pavement');
    this.box(x0, -0.05, z0, x1, CURB_H, z1, { top: 'sidewalk', side: 'curb' }, { ts });
  }

  // 1 ブロックを区画に分け、建物を建てる
  buildBlock(lot, district, ring, R) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    const rows = [[lot.z0, lot.z0 + d / 2, 'n'], [lot.z0 + d / 2, lot.z1, 's']];
    const bigTower = !ring && district > 0.55 && R() < 0.45;
    for (const [rz0, rz1, side] of rows) {
      let x = lot.x0;
      while (x < lot.x1 - 0.1) {
        let pw = bigTower ? w / 2 : 9 + R() * (8 + district * 14);
        if (lot.x1 - (x + pw) < 8) pw = lot.x1 - x;
        const x1 = Math.min(lot.x1, x + pw);
        const parcel = bigTower ? { x0: x, x1, z0: lot.z0, z1: lot.z1 } : { x0: x, x1, z0: rz0, z1: rz1 };
        this.building(parcel, { district, ring, front: bigTower ? 'both' : side, endW: x === lot.x0, endE: x1 >= lot.x1 - 0.01 }, R);
        x = x1;
      }
      if (bigTower) break;
    }
  }

  building(p, ctx, R) {
    const { district, ring } = ctx;
    let floors = Math.round(3 + R() * 4 + district * district * R() * 46 + (ring ? 6 + R() * 18 : 0));
    if (R() < 0.08) floors += 10;
    const brick = floors <= 8 && R() < 0.8;
    let mat, style, fh, bay;
    if (brick) {
      mat = ['red_brick_03', 'factory_brick', 'painted_brick', 'red_brick_03', 'factory_brick'][Math.floor(R() * 5)]; style = 0; fh = 3.15; bay = 2.5 + R() * 0.6;
    } else if (floors <= 18) {
      mat = ['beige_wall_001', 'concrete_wall_008', 'grey_plaster_02', 'concrete_tile_facade', 'red_brick_03'][Math.floor(R() * 5)]; style = R() < 0.6 ? 0 : 1; fh = 3.3; bay = style ? 3.6 : 2.7 + R() * 0.5;
    } else {
      mat = ['concrete_tile_facade', 'concrete_wall_008', 'grey_plaster_02'][Math.floor(R() * 3)]; style = R() < 0.65 ? 2 : 1; fh = 3.6; bay = 3 + R() * 0.6;
    }
    const gh = 4.6;
    const H = gh + floors * fh;
    const seed = R();
    const key = 'f_' + mat;
    const ts = texSize(mat);
    const cxp = (p.x0 + p.x1) / 2, czp = (p.z0 + p.z1) / 2;
    const fb = this.builder(cxp, czp, key, true);
    // 段（高層はセットバック）
    const tiers = [];
    if (floors > 14 && R() < 0.75) {
      const f1 = Math.round(floors * (0.45 + R() * 0.2));
      tiers.push([0, gh + f1 * fh, 0]);
      const inset1 = 1.5 + R() * 2.5;
      const f2 = Math.round(floors * (0.78 + R() * 0.12));
      tiers.push([gh + f1 * fh, gh + f2 * fh, inset1]);
      tiers.push([gh + f2 * fh, H, inset1 + 2 + R() * 3]);
    } else tiers.push([0, H, 0]);
    const isFront = (n) => (ctx.front === 'both' && n[0] === 0) || (ctx.front === 'n' && n[2] === -1) || (ctx.front === 's' && n[2] === 1);
    for (let ti = 0; ti < tiers.length; ti++) {
      const [y0, y1, ins] = tiers[ti];
      const x0 = p.x0 + ins, x1 = p.x1 - ins, z0 = p.z0 + ins, z1 = p.z1 - ins;
      if (x1 - x0 < 4 || z1 - z0 < 4) break;
      for (const F of FACES) {
        const n = F.n, t = F.t;
        // 面の左下の点と長さ
        let L, ox, oz;
        if (n[2] === 1) { L = x1 - x0; ox = x0; oz = z1; } else if (n[2] === -1) { L = x1 - x0; ox = x1; oz = z0; }
        else if (n[0] === 1) { L = z1 - z0; ox = x1; oz = z1; } else { L = z1 - z0; ox = x0; oz = z0; }
        // 隣の建物と接する側壁は窓なし（ただし上の段は見えるので窓あり）
        let st = style;
        const party = (n[0] === 1 && !ctx.endE) || (n[0] === -1 && !ctx.endW);
        if (ti === 0 && party) st = -1;
        if (ti === 0 && !isFront(n) && n[0] === 0 && ctx.front !== 'both' && st === 0 && R() < 0.4) st = -1;
        const nb = Math.max(1, Math.round(L / bay)), b = L / nb;
        // 店舗（ガラス張りの 1 階）は通りに面した面だけ。それ以外の面の 1 階は普通の窓（style + 10 で指示）
        const hasStore = ti === 0 && (isFront(n) || (n[0] === 1 && ctx.endE) || (n[0] === -1 && ctx.endW));
        const fa = [b, fh, gh, hasStore || st < 0 ? st : st + 10];
        const a = [ox, y0, oz], bb = [ox + t[0] * L, y0, oz + t[2] * L], c = [ox + t[0] * L, y1, oz + t[2] * L], dd = [ox, y1, oz];
        const uU = (u, v) => [u / ts[0], v / ts[1]];
        fb.quad(a, bb, c, dd, n, [uU(0, y0), uU(L, y0), uU(L, y1), uU(0, y1)], [1, 1, 1], fa,
          [[0, y0], [L, y0], [L, y1], [0, y1]], seed + ti * 0.17);
      }
      // 屋根と軒（コーニス）
      this.box(x0, y1 - 0.02, z0, x1, y1, z1, { top: 'roof', side: null }, { ts: texSize('bitumen') });
      const cornice = brick ? 'trim' : (R() < 0.5 ? 'trim' : 'trimDark');
      const o = brick ? 0.32 : 0.18;
      this.box(x0 - o, y1, z0 - o, x1 + o, y1 + (brick ? 0.7 : 0.45), z1 + o, { top: cornice, side: cornice }, { ts: texSize('brushed_concrete') });
      if (ti === 0) {
        // 1 階と 2 階の間の帯
        this.box(x0 - 0.12, gh - 0.05, z0 - 0.12, x1 + 0.12, gh + 0.3, z1 + 0.12, { top: cornice, side: cornice }, { ts: texSize('brushed_concrete') });
        this.addCollider(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, y1);
      }
      if (ti === tiers.length - 1) this.rooftop(x0, z0, x1, z1, y1, brick, floors, R);
    }
    if (!ring) this.storefront(p, ctx, gh, brick, R);
    // 非常階段（レンガの中低層、正面）
    if (brick && floors >= 4 && !ring && R() < 0.55) {
      const w = p.x1 - p.x0;
      if (w > 8) {
        const fz = ctx.front === 'n' ? p.z0 : p.z1;
        const dir = ctx.front === 'n' ? -1 : 1;
        const x = p.x0 + w * (0.3 + R() * 0.4);
        const tiersFE = Math.min(Math.floor((floors - 1) / 3), 4);
        for (let k = 0; k < tiersFE; k++) {
          const y = gh + 3.65 + k * 9.45 + 0.3;
          this.place('modular_fire_escape', x, y, fz + dir * 0.75, dir === 1 ? 0 : Math.PI, 0.97);
        }
      }
    }
  }

  rooftop(x0, z0, x1, z1, y, brick, floors, R) {
    const w = x1 - x0, d = z1 - z0;
    // 給水塔（NY の中層ビルの象徴）
    if (brick && floors >= 5 && w > 7 && d > 7 && R() < 0.45) this.place('watertower', x0 + w * (0.3 + R() * 0.4), y, z0 + d * (0.3 + R() * 0.4), R() * 6, 1);
    // 空調機
    const n = Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const ax = x0 + 1.5 + R() * Math.max(0.1, w - 3), az = z0 + 1.5 + R() * Math.max(0.1, d - 3);
      const s = 1 + R() * 1.2;
      this.box(ax - s, y, az - s * 0.7, ax + s, y + 1.2 + R() * 0.6, az + s * 0.7, 'trimDark', { ts: [2, 2] });
    }
    // 塔屋
    if (floors > 10 && R() < 0.7) {
      const s = 2.5 + R() * 2;
      const ax = x0 + w / 2, az = z0 + d / 2;
      this.box(ax - s, y, az - s, ax + s, y + 3.5, az + s, 'trim', { ts: [2, 2] });
      if (floors > 30 && R() < 0.6) this.box(ax - 0.15, y + 3.5, az - 0.15, ax + 0.15, y + 3.5 + 8 + R() * 10, az + 0.15, 'trimDark');
    }
  }

  // 店の日よけと看板
  storefront(p, ctx, gh, brick, R) {
    const faces = ctx.front === 'both' ? ['n', 's'] : [ctx.front];
    for (const f of faces) {
      const z = f === 'n' ? p.z0 : p.z1, dir = f === 'n' ? -1 : 1;
      const w = p.x1 - p.x0;
      if (R() < (brick ? 0.55 : 0.3)) {
        // 日よけ（傾いた布）
        const col = [[0.12, 0.25, 0.16], [0.45, 0.07, 0.07], [0.08, 0.12, 0.28], [0.3, 0.05, 0.12], [0.1, 0.1, 0.1]][Math.floor(R() * 5)];
        const ax0 = p.x0 + 0.6 + R() * 1, ax1 = Math.min(p.x1 - 0.6, ax0 + 4 + R() * (w - 4));
        const yT = gh - 0.9, yB = gh - 1.75, out = 1.5;
        const b = this.builder((ax0 + ax1) / 2, z, 'awning');
        const zt = z + dir * 0.05, zb = z + dir * out;
        const n = [0, 0.86, dir * 0.5];
        if (dir === 1) b.quad([ax0, yB, zb], [ax1, yB, zb], [ax1, yT, zt], [ax0, yT, zt], n, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
        else b.quad([ax1, yB, zb], [ax0, yB, zb], [ax0, yT, zt], [ax1, yT, zt], n, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
        const vn = [0, 0, dir];
        if (dir === 1) b.quad([ax0, yB - 0.3, zb], [ax1, yB - 0.3, zb], [ax1, yB, zb], [ax0, yB, zb], vn, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
        else b.quad([ax1, yB - 0.3, zb], [ax0, yB - 0.3, zb], [ax0, yB, zb], [ax1, yB, zb], vn, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
      }
      if (R() < 0.75) {
        // 看板（架空の店名。実在の企業名は使わない）
        const sw = Math.min(w - 1.5, 3 + R() * 4);
        if (sw > 2) {
          const sx = p.x0 + 0.75 + R() * (w - 1.5 - sw);
          this.signs.push({ x0: sx, x1: sx + sw, y0: gh - 1.18, y1: gh - 0.32, z: z + dir * 0.06, dir, id: Math.floor(R() * SIGN_NAMES.length) });
        }
      }
    }
  }

  buildPlaza(lot, R) {
    const ts = texSize('concrete_pavement');
    void ts;
    // 広場: 植え込み・ベンチ・噴水の代わりの水盤
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    this.box(cx - 7, CURB_H, cz - 7, cx + 7, CURB_H + 0.55, cz + 7, { top: 'trimDark', side: 'trim' }, { ts: [2, 2] });
    this.waterPools.push({ x: cx, z: cz, s: 6.6, y: CURB_H + 0.45 });
    this.addCollider(cx - 7, cz - 7, cx + 7, cz + 7, 0.6);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 12 + (i % 2) * 6;
      const x = cx + Math.cos(a) * r * 1.2, z = cz + Math.sin(a) * r * 0.8;
      if (i % 3 === 0) this.place('modular_street_seating', x, CURB_H, z, -a + Math.PI / 2, 1);
      else { this.place('planter_box_01', x, CURB_H, z, -a, 2.2); }
    }
    for (let i = 0; i < 6; i++) this.place('street_lamp_01', cx + (R() - 0.5) * 50, CURB_H, cz + (R() - 0.5) * 32, R() * 6, 1, 0.2);
  }

  buildParking(lot, R) {
    // 駐車場: 白線と、駐車中の車（車両モジュール側で配置）
    const cz = (lot.z0 + lot.z1) / 2;
    for (let x = lot.x0 + 2; x < lot.x1 - 2; x += 2.8) {
      for (const [za, zb] of [[lot.z0 + 1, cz - 3], [cz + 3, lot.z1 - 1]]) {
        this.flat(x - 0.06, za, x + 0.06, zb, CURB_H + 0.01, 'white');
        if (R() < 0.6 && x + 1.4 < lot.x1 - 2) this.parkedSpots.push({ x: x + 1.4, z: (za + zb) / 2, rot: (za < cz ? 0 : Math.PI) + (R() - 0.5) * 0.05 });
      }
    }
    for (let i = 0; i < 3; i++) this.place('covered_car', lot.x0 + 6 + i * 3, CURB_H, cz + 0.5, Math.PI / 2, 1);
    for (let x = lot.x0 + 1; x < lot.x1; x += 1.7) this.place('concrete_road_barrier', x, CURB_H, lot.z0 - 0.5, 0, 1, 0.4);
  }

  // 歩道の小物
  sidewalkProps(x0, z0, x1, z1, R) {
    const edge = 0.7;
    const sides = [
      { a: [x0, z0], b: [x1, z0], n: [0, -1] }, { a: [x0, z1], b: [x1, z1], n: [0, 1] },
      { a: [x0, z0], b: [x0, z1], n: [-1, 0] }, { a: [x1, z0], b: [x1, z1], n: [1, 0] },
    ];
    for (const s of sides) {
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const dx = (s.b[0] - s.a[0]) / L, dz = (s.b[1] - s.a[1]) / L;
      const px = (t) => s.a[0] + dx * t - s.n[0] * edge, pz = (t) => s.a[1] + dz * t - s.n[1] * edge;
      const rotToRoad = Math.atan2(s.n[0], s.n[1]);
      for (let t = 14; t < L - 10; t += 34) this.place('street_lamp_01', px(t), CURB_H, pz(t), rotToRoad, 1, 0.18);
      // 消火栓（角の近く）
      if (R() < 0.8) { const t = 6 + R() * 3; this.place('fire_hydrant', px(t) - s.n[0] * 0.2, CURB_H, pz(t) - s.n[1] * 0.2, rotToRoad, 1, 0.25); }
      if (R() < 0.7) { const t = L - 6 - R() * 4; this.place('metal_trash_can', px(t) - s.n[0] * 0.3, CURB_H, pz(t) - s.n[1] * 0.3, rotToRoad, 1, 0.35); }
      if (R() < 0.35) { const t = 20 + R() * (L - 40); this.place(R() < 0.5 ? 'utility_box_01' : 'utility_box_02', px(t) - s.n[0] * 3.2, CURB_H, pz(t) - s.n[1] * 3.2, rotToRoad + Math.PI, 1, 0.4); }
    }
  }

  // 小物の配置を記録（後で InstancedMesh にまとめる）
  place(name, x, y, z, rot, scale = 1, collideR = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, scale, scale));
    (this.instances[name] ||= []).push(m);
    if (collideR) this.addPole(x, z, collideR);
  }

  // 車線の表示: 中央の黄色 2 本線、白の破線、停止線、横断歩道
  roadMarkings() {
    const W = 'white', Y = 'yellow', y = 0.012;
    const seg = (x0, z0, x1, z1, key) => this.flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, key);
    const ext = 1; // 外周道路も含める
    for (let j = 0; j <= NBZ; j++) for (let i = -ext; i < NBX + ext; i++) {
      // 東西方向の道路（z = j*PZ）の区間 [i*PX, (i+1)*PX]
      if (i < 0 || i >= NBX) continue;
      const zc = j * PZ, xa = i * PX + RH, xb = (i + 1) * PX - RH;
      const cw0 = xa + 0.6, cw1 = xa + 3.6, cw2 = xb - 3.6, cw3 = xb - 0.6;
      seg(cw1 + 1, zc - 0.22, cw2 - 1, zc - 0.1, Y); seg(cw1 + 1, zc + 0.1, cw2 - 1, zc + 0.22, Y);
      for (let x = cw1 + 2; x < cw2 - 3; x += 12) for (const o of [-3.5, 3.5]) seg(x, zc + o - 0.06, Math.min(x + 3, cw2 - 1), zc + o + 0.06, W);
      // 停止線（東行きは +z 側、西行きは -z 側）
      seg(cw2 - 1.0, zc + 0.3, cw2 - 0.5, zc + RH - 0.3, W);
      seg(cw1 + 0.5, zc - RH + 0.3, cw1 + 1.0, zc - 0.3, W);
      // 横断歩道
      for (const [c0, c1] of [[cw0, cw1], [cw2, cw3]]) for (let zz = zc - RH + 0.5; zz < zc + RH - 0.5; zz += 1.2) seg(c0, zz, c1, zz + 0.6, W);
    }
    for (let i = 0; i <= NBX; i++) for (let j = 0; j < NBZ; j++) {
      const xc = i * PX, za = j * PZ + RH, zb = (j + 1) * PZ - RH;
      const cw0 = za + 0.6, cw1 = za + 3.6, cw2 = zb - 3.6, cw3 = zb - 0.6;
      seg(xc - 0.22, cw1 + 1, xc - 0.1, cw2 - 1, Y); seg(xc + 0.1, cw1 + 1, xc + 0.22, cw2 - 1, Y);
      for (let z = cw1 + 2; z < cw2 - 3; z += 12) for (const o of [-3.5, 3.5]) seg(xc + o - 0.06, z, xc + o + 0.06, Math.min(z + 3, cw2 - 1), W);
      // 南行き(+z)の右側は -x、北行きの右側は +x
      seg(xc - RH + 0.3, cw2 - 1.0, xc - 0.3, cw2 - 0.5, W);
      seg(xc + 0.3, cw1 + 0.5, xc + RH - 0.3, cw1 + 1.0, W);
      for (const [c0, c1] of [[cw0, cw1], [cw2, cw3]]) for (let xx = xc - RH + 0.5; xx < xc + RH - 0.5; xx += 1.2) seg(xx, c0, xx + 0.6, c1, W);
      // マンホール
      if (this.rng() < 0.7) this.place('water_manhole_cover', xc + (this.rng() < 0.5 ? -1.75 : 1.75), 0.03, za + 10 + this.rng() * (zb - za - 20), 0, 1);
    }
  }

  // 信号機: 交差点の奥側の角に柱を立て、アームを車線の上に伸ばす（米国式のマストアーム）
  trafficSignals() {
    const parts = { pole: [], housing: [], back: [], ew: { r: [], y: [], g: [] }, ns: { r: [], y: [], g: [] } };
    const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 10);
    const add = (list, geo, m) => { geo.applyMatrix4(m); list.push(geo); };
    const M = (x, y, z, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    for (let i = 0; i <= NBX; i++) for (let j = 0; j <= NBZ; j++) {
      const X = i * PX, Z = j * PZ;
      // 進入方向: d = 進む向き。柱は交差点の向こう側・右側の角
      const approaches = [
        { d: [1, 0], axis: 'ew' }, { d: [-1, 0], axis: 'ew' }, { d: [0, 1], axis: 'ns' }, { d: [0, -1], axis: 'ns' },
      ];
      for (const a of approaches) {
        const [dx, dz] = a.d, rx = -dz, rz = dx; // 右
        // 存在しない道路からの進入は除く
        const fromX = X - dx * PX, fromZ = Z - dz * PZ;
        if (fromX < -1 || fromX > CITY_W + 1 || fromZ < -1 || fromZ > CITY_D + 1) continue;
        const toX = X + dx * PX, toZ = Z + dz * PZ;
        if (toX < -1 || toX > CITY_W + 1 || toZ < -1 || toZ > CITY_D + 1) continue;
        const px = X + dx * (RH + 1.2) + rx * (RH + 1.0), pz = Z + dz * (RH + 1.2) + rz * (RH + 1.0);
        add(parts.pole, cyl(0.16, 7.2), M(px, 3.6, pz));
        this.addPole(px, pz, 0.3);
        // アーム（-右方向へ 6.5 m）
        const armLen = 6.6, ay = 6.7;
        const amx = px - rx * armLen / 2, amz = pz - rz * armLen / 2;
        const arm = cyl(0.09, armLen); arm.rotateZ(Math.PI / 2); arm.rotateY(Math.atan2(-rz, rx));
        add(parts.pole, arm, M(amx, ay, amz));
        // 信号灯 2 基（各車線の上）
        for (const off of [LANE_OFFS[0], LANE_OFFS[1]]) {
          const hx = X + dx * (RH + 1.2) + rx * off, hz = Z + dz * (RH + 1.2) + rz * off;
          const face = Math.atan2(-dx, -dz); // 車の方を向く
          add(parts.housing, new THREE.BoxGeometry(0.38, 1.15, 0.28), M(hx, ay - 0.75, hz, face));
          add(parts.back, new THREE.BoxGeometry(0.62, 1.4, 0.03), M(hx + dx * 0.15, ay - 0.75, hz + dz * 0.15, face));
          add(parts.pole, cyl(0.03, 0.25), M(hx, ay - 0.1, hz));
          const ys = { r: ay - 0.4, y: ay - 0.75, g: ay - 1.1 };
          for (const c of ['r', 'y', 'g']) {
            const g = new THREE.CircleGeometry(0.12, 14);
            add(parts[a.axis][c], g, M(hx - dx * 0.145, ys[c], hz - dz * 0.145, face));
          }
        }
      }
    }
    const mk = (list, mat, shadow = true) => { const g = mergeGeometries(list); const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; this.scene.add(m); return m; };
    mk(parts.pole, this.mats.galv); mk(parts.housing, this.mats.housing); mk(parts.back, this.mats.backplate);
    for (const ax of ['ew', 'ns']) for (const c of ['r', 'y', 'g']) mk(parts[ax][c], this.signalMats[ax][c], false);
  }

  // 信号の状態を反映（traffic.js から呼ぶ）
  setSignals(state) {
    for (const ax of ['ew', 'ns']) for (const c of ['r', 'y', 'g']) {
      const on = state[ax] === c;
      this.signalMats[ax][c].emissiveIntensity = on ? 6 : 0.04;
      this.signalMats[ax][c].color.setScalar(on ? 0.2 : 0.03);
    }
  }

  // ---- メッシュ化 ----
  async finalize(onProgress) {
    // 看板
    this.buildSigns();
    // 材質ごと・チャンクごとにメッシュ化
    for (const [, ch] of this.chunks) for (const [key, b] of ch) {
      const g = b.build(); if (!g) continue;
      const mat = this.mats[key]; if (!mat) { console.warn('no mat', key); continue; }
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !['white', 'yellow', 'sidewalk'].includes(key);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
    }
    onProgress?.('小物を配置しています…');
    await this.buildInstances();
    // 水盤
    for (const w of this.waterPools) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w.s * 2, w.s * 2).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x0d1d22, roughness: 0.03, metalness: 0.1 }));
      m.position.set(w.x, w.y, w.z); m.receiveShadow = true; this.scene.add(m);
    }
  }

  buildSigns() {
    if (!this.signs.length) return;
    const atlas = makeSignAtlas();
    const b = new Builder(false);
    for (const s of this.signs) {
      const col = s.id % SIGN_COLS, row = Math.floor(s.id / SIGN_COLS);
      const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS, v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
      if (s.dir === 1) b.quad([s.x0, s.y0, s.z], [s.x1, s.y0, s.z], [s.x1, s.y1, s.z], [s.x0, s.y1, s.z], [0, 0, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      else b.quad([s.x1, s.y0, s.z], [s.x0, s.y0, s.z], [s.x0, s.y1, s.z], [s.x1, s.y1, s.z], [0, 0, -1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  async buildInstances() {
    const loader = new GLTFLoader();
    const tmp = new THREE.Matrix4(), pos = new THREE.Vector3();
    for (const name of Object.keys(this.instances)) {
      let src;
      if (name === 'watertower') src = makeWaterTower(this.mats);
      else src = (await loader.loadAsync(`assets/game/props/${name}.glb`)).scene;
      src.updateMatrixWorld(true);
      // 区画（2×2 ブロック）ごとに InstancedMesh を分け、画面外の区画は描かない
      const groups = new Map();
      for (const m of this.instances[name]) {
        pos.setFromMatrixPosition(m);
        const k = Math.floor(pos.x / (PX * 2)) + ',' + Math.floor(pos.z / (PZ * 2));
        if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m);
      }
      // 1 つのファイルに 2 種類（新品と錆びたもの）が並んでいるモデルは片方だけ使い、中心に寄せる
      const variant = PROP_VARIANT[name];
      const shift = new THREE.Matrix4().makeTranslation(...(variant?.shift || [0, 0, 0]));
      src.traverse((o) => {
        if (!o.isMesh) return;
        if (variant && variant.exclude.test(o.name)) return;
        const local = new THREE.Matrix4().multiplyMatrices(shift, o.matrixWorld);
        for (const [, list] of groups) {
          const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
          for (let k = 0; k < list.length; k++) im.setMatrixAt(k, tmp.multiplyMatrices(list[k], local));
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = name !== 'water_manhole_cover';
          im.receiveShadow = true;
          im.computeBoundingSphere();
          this.scene.add(im);
        }
      });
    }
  }
}

const LANE_OFFS = [1.75, 5.25];
const PROP_VARIANT = {
  fire_hydrant: { exclude: /_aged|chain/, shift: [0.3, 0, 0] },
  metal_trash_can: { exclude: /rust/, shift: [-0.5, 0, 0] },
};

// 架空の店名（実在の企業・ブランド名は使わない）
const SIGN_NAMES = [
  ['DELI', '#1c3d2a', '#f2e6c8'], ['PIZZA', '#7a1414', '#ffe9b0'], ['LAUNDROMAT', '#0f2a4a', '#ffffff'], ['BAR & GRILL', '#111111', '#f0b54a'],
  ['PHARMACY', '#0d5c3f', '#ffffff'], ['BOOKS', '#3a2615', '#f3e2c0'], ['CAFE', '#2b1d14', '#f5d9a8'], ['DINER', '#a51b1b', '#ffffff'],
  ['HARDWARE', '#1d2f5c', '#ffd34a'], ['HOTEL', '#151515', '#e8d18a'], ['NAIL SALON', '#5a1846', '#ffd6f0'], ['BAKERY', '#5e3a1e', '#fff1d6'],
  ['LIQUORS', '#4a0f0f', '#ffd27a'], ['TAILOR', '#202a33', '#e8e8e8'], ['BARBER', '#0e2240', '#ff4d4d'], ['FLOWERS', '#28462b', '#ffe0ea'],
  ['PAWN SHOP', '#33280d', '#ffd700'], ['TACOS', '#0f5a52', '#ffe66b'], ['DRY CLEANING', '#16384f', '#ffffff'], ['GROCERY', '#21401b', '#fff6d0'],
  ['NOODLES', '#5c0d0d', '#ffcc33'], ['OPTICAL', '#1d1d2c', '#9fe7ff'], ['RECORDS', '#151515', '#ff6a3d'], ['CHECK CASHING', '#123d1c', '#fff35c'],
];
const SIGN_COLS = 4, SIGN_ROWS = 6;
function makeSignAtlas() {
  const W = 512, H = 128;
  const c = document.createElement('canvas'); c.width = W * SIGN_COLS; c.height = H * SIGN_ROWS;
  const g = c.getContext('2d');
  SIGN_NAMES.forEach(([text, bg, fg], i) => {
    const x = (i % SIGN_COLS) * W, y = Math.floor(i / SIGN_COLS) * H;
    g.fillStyle = bg; g.fillRect(x, y, W, H);
    g.strokeStyle = fg; g.globalAlpha = 0.6; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, W - 16, H - 16); g.globalAlpha = 1;
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 70; g.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(text).width > W - 50 && size > 20) { size -= 4; g.font = `bold ${size}px Georgia, 'Times New Roman', serif`; }
    g.fillText(text, x + W / 2, y + H / 2 + 4);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 屋上の給水塔（木製の樽 + 円錐の屋根 + 鉄骨の脚）
function makeWaterTower(M) {
  const g = new THREE.Group();
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 3.6, 20, 1, false), M.wood); wood.position.y = 4.6; g.add(wood);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.5, 20), M.metal); roof.position.y = 7.15; g.add(roof);
  const hoopG = [];
  for (const y of [3.3, 4.2, 5.1, 6.0]) hoopG.push(new THREE.TorusGeometry(2.0, 0.04, 4, 24).rotateX(Math.PI / 2).translate(0, y, 0));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; hoopG.push(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 6).translate(Math.cos(a) * 1.5, 1.4, Math.sin(a) * 1.5)); }
  hoopG.push(new THREE.CylinderGeometry(1.9, 1.9, 0.15, 16).translate(0, 2.8, 0));
  const hoops = new THREE.Mesh(mergeGeometries(hoopG), M.metal); g.add(hoops);
  return g;
}

City.prototype.signs = null;
const _init = City.prototype.generate;
City.prototype.generate = function () { this.signs = []; this.waterPools = []; this.parkedSpots = []; return _init.call(this); };
