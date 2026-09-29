// STUB — replaced by the terrain agent. Analytic height field honouring layout.js (town plateau,
// site pads, lake, river) and one vertex-coloured grid mesh.
import * as THREE from 'three';
import { MAP_HALF, TOWN, SITES, LAKE, RIVER } from './layout.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function distToRect(x, z, r) {
  const dx = Math.max(r[0] - x, 0, x - r[1]), dz = Math.max(r[2] - z, 0, z - r[3]);
  return Math.hypot(dx, dz);
}
function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return { d: Math.hypot(px - ax - vx * t, pz - az - vz * t), t };
}

export function createTerrain(scene) {
  function base(x, z) {
    return -38 + Math.sin(x * 0.006) * 22 + Math.cos(z * 0.0075 + 1.3) * 18 + Math.sin((x + z) * 0.013) * 6;
  }
  function heightAt(x, z) {
    let h = base(x, z);
    // Town plateau.
    const dt = distToRect(x, z, TOWN.rect);
    const tw = 1 - smooth(TOWN.plateauMargin, TOWN.plateauMargin + 90, dt);
    h = h + (TOWN.y - 0.25 - h) * tw;
    // Site pads.
    for (const s of SITES) {
      const d = Math.hypot(x - s.x, z - s.z);
      const w = 1 - smooth(s.r, s.r + 60, d);
      h = h + (s.y - h) * w;
    }
    // Lake bowl.
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r + 40) h = Math.min(h, LAKE.y - 3 * (1 - smooth(0, LAKE.r, dl)) + smooth(LAKE.r - 5, LAKE.r + 40, dl) * 40);
    // River channel.
    let best = 1e9, by = 0;
    for (let i = 0; i < RIVER.points.length - 1; i++) {
      const a = RIVER.points[i], b = RIVER.points[i + 1];
      const { d, t } = distToSeg(x, z, a[0], a[1], b[0], b[1]);
      if (d < best) { best = d; by = a[2] + (b[2] - a[2]) * t; }
    }
    if (best < 60) h = Math.min(h, by - 2 * (1 - smooth(0, RIVER.width / 2, best)) + smooth(RIVER.width / 2, 60, best) * 60);
    return h;
  }

  const N = 180, S = MAP_HALF * 2;
  const g = new THREE.PlaneGeometry(S, S, N, N);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z);
    pos.setY(i, y);
    const k = 0.85 + 0.15 * Math.sin(x * 0.05) * Math.cos(z * 0.04);
    col[i * 3] = 0.45 * k; col[i * 3 + 1] = 0.5 * k; col[i * 3 + 2] = 0.3 * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4d6f78, roughness: 0.1 }));
  water.position.set(LAKE.x, LAKE.y, LAKE.z);
  scene.add(water);

  return { heightAt, colliders: [], navPoints: [], meshes: [mesh, water], update() {} };
}
