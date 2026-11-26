// 交通: 信号の周期、AI の車（車線追従・車間・信号停止・右左折）、遠くの車の入れ替え
import * as THREE from 'three';
import { PX, PZ, NBX, NBZ, RH, LANE, clamp, lerp, mulberry32 } from './config.js';
import { Vehicle } from './vehicle.js';

const CYCLE = [['g', 'r', 14], ['y', 'r', 3], ['r', 'r', 1.5], ['r', 'g', 14], ['r', 'y', 3], ['r', 'r', 1.5]];
const CYCLE_LEN = CYCLE.reduce((s, c) => s + c[2], 0);

const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const segLen = (di) => (di !== 0 ? PX : PZ) - 2 * RH;
const inGrid = (i, j) => i >= 0 && i <= NBX && j >= 0 && j <= NBZ;

export class Traffic {
  constructor(scene, city, count) {
    this.scene = scene; this.city = city; this.time = 0; this.rng = mulberry32(77);
    this.signal = { ew: 'g', ns: 'r' };
    this.cars = [];
    this.stats = { turns: 0, redRuns: 0, respawns: 0 };
    const types = ['sedan', 'sedan', 'sedan', 'suv', 'suv', 'taxi', 'taxi', 'truck'];
    for (let k = 0; k < count; k++) {
      const v = new Vehicle(scene, types[k % types.length], this.rng);
      v.ai = {}; this.cars.push(v);
    }
  }

  // ---- 信号 ----
  updateSignals(dt) {
    this.time += dt;
    let t = this.time % CYCLE_LEN;
    for (const [ew, ns, d] of CYCLE) { if (t < d) { this.signal.ew = ew; this.signal.ns = ns; break; } t -= d; }
    this.city.setSignals(this.signal);
  }

  // ---- 車線の幾何 ----
  lanePoint(seg, s, off) {
    const { i, j, di, dj } = seg;
    const ax = i * PX, az = j * PZ;
    const rx = -dj, rz = di;
    return [ax + di * (RH + s) + rx * off, az + dj * (RH + s) + rz * off];
  }

  randomSegment() {
    for (;;) {
      const i = Math.floor(this.rng() * (NBX + 1)), j = Math.floor(this.rng() * (NBZ + 1));
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [di, dj] = dirs[Math.floor(this.rng() * 4)];
      if (inGrid(i + di, j + dj)) return { i, j, di, dj };
    }
  }

  chooseNext(v) {
    const a = v.ai, { i, j, di, dj } = a.seg;
    const bi = i + di, bj = j + dj;
    const opts = [];
    if (inGrid(bi + di, bj + dj)) opts.push(['s', di, dj], ['s', di, dj]);
    if (inGrid(bi - dj, bj + di)) opts.push(['r', -dj, di]);   // 右折: 右ベクトル方向
    if (inGrid(bi + dj, bj - di)) opts.push(['l', dj, -di]);   // 左折
    const o = opts[Math.floor(this.rng() * opts.length)];
    a.next = { kind: o[0], seg: { i: bi, j: bj, di: o[1], dj: o[2] } };
    a.targetLane = o[0] === 'r' ? 1 : o[0] === 'l' ? 0 : a.lane;
  }

  spawn(v, player, avoidView) {
    for (let tries = 0; tries < 60; tries++) {
      const seg = this.randomSegment();
      const s = 4 + this.rng() * (segLen(seg.di) - 20);
      const lane = this.rng() < 0.5 ? 0 : 1;
      const [x, z] = this.lanePoint(seg, s, LANE[lane]);
      if (player) {
        const d = Math.hypot(x - player.x, z - player.z);
        if (d < 25 || d > 170) continue;
        if (avoidView && avoidView(x, z)) continue;
      }
      if (this.cars.some((o) => o !== v && o.ai.active && Math.hypot(o.pos.x - x, o.pos.z - z) < 12)) continue;
      const a = v.ai;
      Object.assign(a, { active: true, seg, s, lane, laneFrom: lane, phase: 'lane', v: 6 + this.rng() * 4, vmax: 10 + this.rng() * 4.5, stuck: 0, disp: [0, 0] });
      v.mode = 'ai'; v.root.visible = true;
      this.chooseNext(v);
      this.place(v);
      return true;
    }
    return false;
  }

  // 車線上の位置から姿勢を決める
  place(v) {
    const a = v.ai;
    let x, z, h;
    if (a.phase === 'lane') {
      const L = segLen(a.seg.di);
      const k = smooth(a.s / 22);
      const off = lerp(LANE[a.laneFrom], LANE[a.lane], k);
      [x, z] = this.lanePoint(a.seg, a.s, off);
      h = Math.atan2(a.seg.di, a.seg.dj);
      const dOff = (LANE[a.lane] - LANE[a.laneFrom]) * (k > 0 && k < 1 ? 6 * (a.s / 22) * (1 - a.s / 22) / 22 : 0);
      h -= Math.atan(dOff) * 0; void L;
    } else {
      const t = a.t, [p0, p1, p2] = a.path;
      const u = 1 - t;
      x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      z = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      const tx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), tz = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      h = Math.atan2(tx, tz);
    }
    a.px = x; a.pz = z;
    v.pos.x = x + a.disp[0]; v.pos.z = z + a.disp[1];
    // 向きは滑らかに（車線変更の傾きも少し出す）
    let dh = h - v.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.heading += dh * (a.snap ? 1 : 0.35);
    a.snap = false;
  }

  startTurn(v) {
    const a = v.ai, n = a.next;
    // 統計（テスト用）: 赤信号で交差点に入った回数
    this.stats.turns++;
    const { i, j, di, dj } = a.seg;
    const bx = (i + di) * PX, bz = (j + dj) * PZ;
    const rx = -dj, rz = di, off = LANE[a.lane];
    const p0 = [bx - di * RH + rx * off, bz - dj * RH + rz * off];
    const s2 = n.seg, r2x = -s2.dj, r2z = s2.di, off2 = LANE[a.targetLane];
    const p2 = [bx + s2.di * RH + r2x * off2, bz + s2.dj * RH + r2z * off2];
    const p1 = n.kind === 's' ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [bx + rx * off + r2x * off2, bz + rz * off + r2z * off2];
    // ベジェ曲線の長さ（折れ線近似）
    let len = 0, px = p0[0], pz = p0[1];
    for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], z = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]; len += Math.hypot(x - px, z - pz); px = x; pz = z; }
    Object.assign(a, { phase: 'turn', path: [p0, p1, p2], plen: len, t: 0 });
  }

  update(dt, all, player, avoidView) {
    this.updateSignals(dt);
    for (const v of this.cars) {
      if (v.mode !== 'ai') continue;
      const a = v.ai;
      if (!a.active) { if (this.spawn(v, player, avoidView)) this.stats.respawns++; continue; }
      // 遠すぎる・長く詰まっている車は入れ替える
      const dp = Math.hypot(v.pos.x - player.x, v.pos.z - player.z);
      if ((dp > 200 || a.stuck > 15) && (!avoidView || !avoidView(v.pos.x, v.pos.z))) { a.active = false; continue; }

      // 前方の障害（ほかの車・プレイヤー）
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      let gap = 1e9;
      for (const o of all) {
        if (o === v) continue;
        const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
        const along = dx * fx + dz * fz; if (along <= 0 || along > 40) continue;
        const lat = Math.abs(-dx * fz + dz * fx);
        if (lat > (a.phase === 'turn' ? 2.4 : 1.9)) continue;
        gap = Math.min(gap, along - v.halfL - (o.halfL || 0.4));
      }
      if (player.onFoot) {
        const dx = player.x - v.pos.x, dz = player.z - v.pos.z;
        const along = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
        if (along > 0 && along < 25 && lat < 1.8) gap = Math.min(gap, along - v.halfL - 0.5);
      }
      // 信号
      if (a.phase === 'lane') {
        const L = segLen(a.seg.di), stopS = L - 4.2 - v.halfL;
        const sig = this.signal[a.seg.di !== 0 ? 'ew' : 'ns'];
        const toStop = stopS - a.s;
        if (sig !== 'g' && toStop > -2.5) {
          // 黄色: 止まれる距離なら止まる。赤: 停止線を少し越えていても止まって待つ
          const canStop = toStop > (a.v * a.v) / (2 * 5.5) - 0.5;
          if (sig === 'r' ? (toStop > -2.5 && (a.signalStop || canStop || toStop > -0.2)) : canStop) { gap = Math.min(gap, Math.max(1.6, toStop + 1.6)); a.signalStop = true; }
        } else a.signalStop = false;
      }
      // 目標速度
      let vt = a.vmax * (a.phase === 'turn' && a.next.kind !== 's' ? 0.55 : 1);
      if (gap < 1e8) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 4.5 * Math.max(0, gap - 1.6))));
      if (v.bumped > 0) { v.bumped -= dt; vt = 0; }
      let acc = clamp((vt - a.v) * 2.2, -9, 3);
      if (gap < 1e8) {
        // 必要な減速度を直接求めて、目標の手前で止まる
        const d = gap - 1.6;
        if (d <= 0.05) acc = -9.5;
        else { const req = (a.v * a.v) / (2 * d); if (req > 1.2) acc = Math.min(acc, -Math.min(req * 1.15, 9.5)); }
      }
      a.v = Math.max(0, a.v + acc * dt);
      if (a.v < 0.15 && gap < 1.9) a.v = 0;
      a.stuck = a.v < 0.3 ? a.stuck + dt : 0;
      // 進める
      if (a.phase === 'lane') {
        const stopS = segLen(a.seg.di) - 4.2 - v.halfL, s0 = a.s;
        a.s += a.v * dt;
        // 統計（テスト用）: 赤信号で停止線を越えた回数
        if (s0 < stopS + 0.6 && a.s >= stopS + 0.6 && this.signal[a.seg.di !== 0 ? 'ew' : 'ns'] === 'r') this.stats.redRuns++;
        if (a.s >= segLen(a.seg.di)) { a.s = segLen(a.seg.di); this.startTurn(v); }
      } else {
        a.t += (a.v * dt) / Math.max(a.plen, 0.1);
        if (a.t >= 1) {
          const extra = (a.t - 1) * a.plen;
          a.seg = a.next.seg; a.laneFrom = a.targetLane; a.lane = a.targetLane; a.s = extra; a.phase = 'lane'; a.signalStop = false;
          this.chooseNext(v);
        }
      }
      // ぶつけられたずれは少しずつ戻す
      a.disp[0] *= Math.exp(-1.5 * dt); a.disp[1] *= Math.exp(-1.5 * dt);
      this.place(v);
      v.vx = fx * a.v; v.vz = fz * a.v; v.yawRate = 0; v.steer = 0;
      v._lastV = a.v;
      v.sync(dt, this.city);
    }
  }

  // 衝突で押された量を記録（place で上書きしないように）
  afterCollisions() {
    for (const v of this.cars) if (v.mode === 'ai' && v.ai.active) {
      v.ai.disp[0] = clamp(v.pos.x - v.ai.px, -3, 3); v.ai.disp[1] = clamp(v.pos.z - v.ai.pz, -3, 3);
      v.root.position.x = v.pos.x; v.root.position.z = v.pos.z;
    }
  }
}

export function vec3(x, y, z) { return new THREE.Vector3(x, y, z); }
