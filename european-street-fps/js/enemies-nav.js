// Robot navigation for the semi-open world: nav points (town + countryside, any height) in a spatial
// hash, lazily built and pruned graph edges, walkability tests that follow the local ground (terrain,
// steps, bridges) with the same step/body rules as the physics, water avoidance, and a region-limited
// A* whose edge building is metered by a per-frame budget (so path planning never hitches a frame).
import * as THREE from 'three';
import { LAKE, RIVER } from './layout.js';

const STEP_UP = 0.45;   // same as physics.js
const BODY = 1.7;       // body height that must be clear above the feet
const SAMPLE = 0.8;     // walk-test sample spacing (m)
const MAX_SLOPE = 0.75; // rise / run (≈ 37°)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function circleRectDist2(x, z, b) {
  const dx = x - clamp(x, b.min.x, b.max.x), dz = z - clamp(z, b.min.z, b.max.z);
  return dx * dx + dz * dz;
}

// Tiny binary heap for A*.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.v.length = 0; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// River polyline bounds (for a cheap reject before the segment distance).
const RIV = RIVER.points;
const RIV_BOX = RIV.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);

export class NavGraph {
  // physics: Physics (boxes + grid query); groundAt(x, z): walkable terrain/town height.
  constructor(physics, groundAt, points = []) {
    this.P = physics;
    this.groundAt = groundAt || ((x, z) => (physics.groundAt ? physics.groundAt(x, z) : 0));
    this.cell = 5;
    this.hash = new Map();
    this.pts = [];
    this.edges = [];
    this.walkCache = new Map();
    this.budget = Infinity;   // uncached walk tests allowed (reset every frame by the manager)
    this.stats = { walkTests: 0, plans: 0, expansions: 0, busy: 0 };
    this._tmp = []; this._tmp2 = [];
    this._heap = new Heap();
    for (const p of points) if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) this.add(p.clone());
    this._alloc();
  }

  get size() { return this.pts.length; }
  _key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  add(p) {
    if (!Number.isFinite(p.y)) p.y = this.groundAt(p.x, p.z);
    const i = this.pts.length;
    this.pts.push(p); this.edges.push(null);
    const k = this._key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
    let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(i);
    return i;
  }
  _alloc() {
    const n = this.pts.length;
    this.G = new Float32Array(n); this.F = new Int32Array(n); this.seen = new Uint32Array(n);
    this.stamp = 0;
  }

  // Indices of nav points within `rad` (XZ) of (x, z).
  query(x, z, rad, out = []) {
    out.length = 0;
    const c = this.cell, r2 = rad * rad;
    const x0 = Math.floor((x - rad) / c), x1 = Math.floor((x + rad) / c), z0 = Math.floor((z - rad) / c), z1 = Math.floor((z + rad) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const l = this.hash.get(this._key(i, j));
      if (!l) continue;
      for (const k of l) { const p = this.pts[k]; const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz <= r2) out.push(k); }
    }
    return out;
  }

  // Water surface height at (x, z) or -Infinity (lake from layout, river channel along RIVER).
  waterLevel(x, z) {
    const lx = x - LAKE.x, lz = z - LAKE.z;
    if (lx * lx + lz * lz < (LAKE.r + 4) ** 2) return LAKE.y;
    const m = RIVER.width;
    if (x < RIV_BOX[0] - m || x > RIV_BOX[1] + m || z < RIV_BOX[2] - m || z > RIV_BOX[3] + m) return -Infinity;
    let best = Infinity, by = 0;
    for (let i = 0; i < RIV.length - 1; i++) {
      const a = RIV[i], b = RIV[i + 1];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
      const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
      if (d < best) { best = d; by = a[2] + (b[2] - a[2]) * t; }
    }
    return best < RIVER.width / 2 + 1 ? by + 0.5 : -Infinity;
  }

  // Ground under a body of radius `rad` whose feet are at `feet` (terrain + boxes it can step on),
  // or NaN when the spot is blocked (a box in the body's height range) or under water.
  probe(x, z, rad, feet) {
    let h = this.groundAt(x, z);
    const boxes = this.P.boxes, ids = this.P.query(x - rad, z - rad, x + rad, z + rad), r2 = rad * rad;
    for (let n = 0; n < ids.length; n++) {
      const b = boxes[ids[n]];
      if (b.max.y > feet + STEP_UP || b.max.y <= h) continue;
      if (circleRectDist2(x, z, b) < r2 * 0.5) h = b.max.y;
    }
    for (let n = 0; n < ids.length; n++) {
      const b = boxes[ids[n]];
      if (b.max.y <= h + STEP_UP || b.min.y >= h + BODY) continue;
      if (circleRectDist2(x, z, b) < r2) return NaN;
    }
    if (h < this.waterLevel(x, z)) return NaN;
    return h;
  }

  // Can a robot walk in a straight line from feet position a to feet position b?
  walkable(a, b, rad = 0.3, endTol = 0.9) {
    this.stats.walkTests++;
    this.budget--;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    let feet = this.probe(a.x, a.z, rad * 0.7, a.y + 0.2);
    if (feet !== feet) feet = a.y; // start slightly inside geometry (pushed out by physics): be lenient
    if (d < 0.25) return Math.abs(b.y - feet) < endTol + 0.4;
    const n = Math.ceil(d / SAMPLE), sx = dx / n, sz = dz / n, run = d / n;
    const maxRise = Math.max(STEP_UP, run * MAX_SLOPE);
    for (let i = 1; i <= n; i++) {
      const h = this.probe(a.x + sx * i, a.z + sz * i, rad, feet);
      if (h !== h) return false;
      const rise = h - feet;
      if (rise > maxRise || rise < -maxRise) return false;
      feet = h;
    }
    return Math.abs(b.y - feet) < endTol;
  }

  _walkCached(i, j) {
    const key = i < j ? i * 4194304 + j : j * 4194304 + i;
    let w = this.walkCache.get(key);
    if (w === undefined) { w = this.walkable(this.pts[i], this.pts[j]); this.walkCache.set(key, w); }
    return w;
  }

  // Neighbours of node i (built on first use; null when the frame's budget is spent).
  edgesOf(i) {
    let e = this.edges[i];
    if (e) return e;
    if (this.budget <= 0) return null;
    const p = this.pts[i];
    let c = this.query(p.x, p.z, 7.5, this._tmp2);
    if (c.length < 5) c = this.query(p.x, p.z, 13, this._tmp2);
    const pts = this.pts;
    c.sort((a, b) => ((pts[a].x - p.x) ** 2 + (pts[a].z - p.z) ** 2) - ((pts[b].x - p.x) ** 2 + (pts[b].z - p.z) ** 2));
    e = [];
    const dirs = [];
    let tests = 0;
    for (const j of c) {
      if (j === i) continue;
      const q = pts[j], dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;
      if (Math.abs(q.y - p.y) > d * MAX_SLOPE + STEP_UP) continue;
      // Pruning: a closer accepted neighbour in (almost) the same direction already covers it.
      let covered = false;
      for (let k = 0; k < dirs.length; k += 2) if (dx * dirs[k] + dz * dirs[k + 1] > d * 0.94) { covered = true; break; }
      if (covered) continue;
      if (tests++ >= 10) break;
      if (this._walkCached(i, j)) { e.push(j); dirs.push(dx / d, dz / d); }
    }
    this.edges[i] = e;
    return e;
  }

  // Nearest nav point reachable in a straight line from pos (or the closest one when none is).
  nearest(pos, maxR = 9, tests = 4) {
    let c = this.query(pos.x, pos.z, maxR, this._tmp);
    if (!c.length) c = this.query(pos.x, pos.z, maxR * 3, this._tmp);
    if (!c.length) return -1;
    const pts = this.pts;
    const score = (k) => { const p = pts[k]; return (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + ((p.y - pos.y) * 2) ** 2; };
    c.sort((a, b) => score(a) - score(b));
    for (let k = 0; k < Math.min(c.length, tests); k++) if (this.walkable(pos, pts[c[k]])) return c[k];
    return c[0];
  }

  // A* from `from` to `to` limited to a region around both. Returns an array of node indices
  // (possibly a partial path toward the goal), null when there is no useful path, or undefined
  // when the per-frame budget ran out (retry next frame; edges built so far are kept).
  plan(from, to, maxIter = 1200) {
    if (!this.pts.length) return null;
    if (this.budget <= 0) { this.stats.busy++; return undefined; }
    this.stats.plans++;
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return [g];
    const pts = this.pts, G = this.G, F = this.F, seen = this.seen, stamp = ++this.stamp;
    const cx = (from.x + to.x) / 2, cz = (from.z + to.z) / 2;
    const R = Math.hypot(to.x - from.x, to.z - from.z) / 2 + 40, R2 = R * R;
    const heap = this._heap; heap.clear();
    const gp = pts[g];
    G[s] = 0; F[s] = -1; seen[s] = stamp; heap.push(pts[s].distanceTo(gp), s);
    let found = false, it = 0, best = s, bestH = pts[s].distanceTo(gp);
    while (heap.size && it++ < maxIter) {
      const i = heap.pop();
      if (i === g) { found = true; break; }
      const e = this.edgesOf(i);
      if (!e) { this.stats.busy++; this.stats.expansions += it; return undefined; }
      const pi = pts[i];
      for (let n = 0; n < e.length; n++) {
        const j = e[n], pj = pts[j];
        const ng = G[i] + pi.distanceTo(pj);
        if (seen[j] === stamp && ng >= G[j]) continue;
        if ((pj.x - cx) ** 2 + (pj.z - cz) ** 2 > R2) continue;
        seen[j] = stamp; G[j] = ng; F[j] = i;
        const h = pj.distanceTo(gp);
        if (h < bestH) { bestH = h; best = j; }
        heap.push(ng + h, j);
      }
    }
    this.stats.expansions += it;
    let end = g;
    if (!found) {
      if (best === s || bestH > pts[s].distanceTo(gp) - 3) return null;
      end = best; // partial: get as close as the local graph allows
    }
    const path = [];
    for (let i = end; i >= 0; i = F[i]) path.push(i);
    path.reverse();
    return path;
  }

  // Add standable points on a grid around (cx, cz) where the given nav points are sparse
  // (e.g. countryside sites whose nav set is thin). Returns the number added.
  densify(cx, cz, radius, spacing, minGap) {
    let added = 0;
    const tmp = this._tmp, e = 1.5;
    for (let x = cx - radius; x <= cx + radius; x += spacing) {
      for (let z = cz - radius; z <= cz + radius; z += spacing) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > radius * radius) continue;
        if (this.query(x, z, minGap, tmp).length) continue;
        const g = this.groundAt(x, z);
        const h = this.probe(x, z, 0.45, g + 0.05);
        if (h !== h) continue;
        const gx = this.groundAt(x + e, z) - this.groundAt(x - e, z), gz = this.groundAt(x, z + e) - this.groundAt(x, z - e);
        if (Math.hypot(gx, gz) / (2 * e) > 0.6) continue;
        this.add(new THREE.Vector3(x, h, z));
        added++;
      }
    }
    if (added) this._alloc();
    return added;
  }
}
