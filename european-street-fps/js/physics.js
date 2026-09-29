import * as THREE from 'three';

// Axis-aligned box world with a uniform XZ grid for broad-phase.
const CELL = 4;
const STEP_UP = 0.45;

export class Physics {
  constructor(colliders) {
    this.boxes = colliders;
    this.grid = new Map();
    this._stamp = 0;
    this._marks = new Uint32Array(colliders.length);
    colliders.forEach((b, i) => {
      const x0 = Math.floor(b.min.x / CELL), x1 = Math.floor(b.max.x / CELL);
      const z0 = Math.floor(b.min.z / CELL), z1 = Math.floor(b.max.z / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, list = []);
        list.push(i);
      }
    });
    this._out = [];
  }

  // Unique collider indices overlapping an XZ rectangle.
  query(minX, minZ, maxX, maxZ) {
    const out = this._out; out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const list = this.grid.get(x * 73856093 ^ z * 19349663);
      if (!list) continue;
      for (const i of list) {
        if (this._marks[i] !== stamp) { this._marks[i] = stamp; out.push(i); }
      }
    }
    return out;
  }

  groundHeight(x, z, radius, feetY) {
    let h = 0;
    for (const i of this.query(x - radius, z - radius, x + radius, z + radius)) {
      const b = this.boxes[i];
      if (b.max.y > feetY + STEP_UP || b.max.y <= h) continue;
      if (circleRectDist2(x, z, b) < radius * radius * 0.5) h = b.max.y;
    }
    return h;
  }

  moveCircle(pos, delta, radius, height) {
    // Sub-step so fast moves never tunnel through thin walls.
    const len = Math.hypot(delta.x, delta.z);
    const steps = Math.max(1, Math.ceil(len / (radius * 0.8)));
    for (let s = 0; s < steps; s++) {
      pos.x += delta.x / steps;
      pos.z += delta.z / steps;
      this._resolve(pos, radius, height);
    }
    pos.y += delta.y;
    return pos;
  }

  _resolve(pos, radius, height) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const ids = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
      for (const i of ids) {
        const b = this.boxes[i];
        // Only boxes that overlap the body vertically and are too tall to step onto.
        if (b.max.y <= pos.y + STEP_UP || b.min.y >= pos.y + height) continue;
        const cx = clamp(pos.x, b.min.x, b.max.x);
        const cz = clamp(pos.z, b.min.z, b.max.z);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = radius - d;
          pos.x += dx / d * push; pos.z += dz / d * push;
        } else {
          // Centre inside the box: push out along the shallowest axis.
          const l = pos.x - b.min.x, r = b.max.x - pos.x, n = pos.z - b.min.z, f = b.max.z - pos.z;
          const m = Math.min(l, r, n, f);
          if (m === l) pos.x = b.min.x - radius; else if (m === r) pos.x = b.max.x + radius;
          else if (m === n) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  raycast(origin, dir, maxDist) {
    // March the grid cells along the ray (2D DDA) and test boxes in each cell.
    let best = null, bestT = maxDist;
    const stamp = ++this._stamp;
    const end = origin.x + dir.x * maxDist, endZ = origin.z + dir.z * maxDist;
    const cells = gridLine(origin.x, origin.z, end, endZ);
    for (const [cx, cz] of cells) {
      const list = this.grid.get(cx * 73856093 ^ cz * 19349663);
      if (list) for (const i of list) {
        if (this._marks[i] === stamp) continue;
        this._marks[i] = stamp;
        const hit = rayBox(origin, dir, this.boxes[i], bestT);
        if (hit) { bestT = hit.t; best = hit; }
      }
    }
    // Ground plane.
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < bestT) { bestT = t; best = { t, axis: 1, sign: 1 }; }
    }
    if (!best) return null;
    const normal = new THREE.Vector3();
    normal.setComponent(best.axis, best.sign);
    return { point: origin.clone().addScaledVector(dir, best.t), normal, distance: best.t };
  }

  lineOfSight(a, b) {
    const dir = _v.subVectors(b, a);
    const dist = dir.length();
    if (dist < 1e-4) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(a, dir.clone(), dist);
    return !hit || hit.distance >= dist - 0.05;
  }
}

const _v = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function circleRectDist2(x, z, b) {
  const dx = x - clamp(x, b.min.x, b.max.x), dz = z - clamp(z, b.min.z, b.max.z);
  return dx * dx + dz * dz;
}

function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = o.getComponent(a), da = d.getComponent(a);
    const lo = b.min.getComponent(a), hi = b.max.getComponent(a);
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // origin inside the box
  return { t: tmin, axis, sign };
}

function gridLine(x0, z0, x1, z1) {
  const cells = [];
  let cx = Math.floor(x0 / CELL), cz = Math.floor(z0 / CELL);
  const ex = Math.floor(x1 / CELL), ez = Math.floor(z1 / CELL);
  const dx = x1 - x0, dz = z1 - z0;
  const sx = Math.sign(dx), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(CELL / dx) : Infinity, tdz = sz ? Math.abs(CELL / dz) : Infinity;
  let tx = sx ? ((sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
  let tz = sz ? ((sz > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / Math.abs(dz)) : Infinity;
  cells.push([cx, cz]);
  let guard = 0;
  while ((cx !== ex || cz !== ez) && guard++ < 256) {
    if (tx < tz) { cx += sx; tx += tdx; } else { cz += sz; tz += tdz; }
    cells.push([cx, cz]);
  }
  return cells;
}
