// Helpers shared by the vehicles (helicopter, tanks).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAKE } from './layout.js';

/** waterAt(x, z): water surface height (lake, river) or -Infinity. */
export function makeWaterAt(world) {
  const rv = world.parts?.terrain?.river;
  const pts = rv ? rv.points : [], hw = rv ? rv.halfWidth + 1 : 0;
  return (x, z) => {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) return LAKE.y;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1], vx = bx - ax, vz = bz - az, vv = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / vv));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < hw) return ay + (by - ay) * t;
    }
    return -Infinity;
  };
}

/** Bake the direct mesh children of `group` into one mesh per material (keeps non-mesh children). */
export function mergeByMaterial(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(g);
    group.remove(c);
  }
  for (const [m, list] of byMat) {
    const merged = mergeGeometries(list, false);
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
}
