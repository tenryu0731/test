// Plan of the dug trenches on the trench-warfare arena (SITES id 'trenches'), shared by
//   terrain.js       heightAt() returns the trench floor inside the cut (players / robots walk in it),
//   terrain-mesh.js  the ground surface is not drawn over the cut (holes),
//   terrain-grass.js no grass in the cut,
//   landmarks-arenas.js  floor, revetments, fire steps, berms and sandbags in and around the cut.
//
// Layout in the site's local frame (metres, +z south): the friendly fire trench runs along z = +40,
// the enemy's along z = −40. Both are crenellated — 10 m fire bays, the trench stepping 4.5 m to the
// rear around 3 m earth traverses (the classic plan that stops a blast or enfilade fire running
// along the trench) — and each has a communication trench back to a dugout and
// stepped exits cut into the front wall.
import { SITES } from './layout.js';

// 2 m deep: a man standing on the floor is covered; on the fire step (0.8 m, two treads) his eye
// clears the sandbagged parapet.
export const TRENCH = { depth: 2.0, width: 2.2, fireStep: 0.8 };

// Centre-line polylines (local x, z). Every segment is axis-aligned.
function fireTrench(zf, back) {
  const pts = [[-54, zf]];
  for (let x = -54 + 10; x < 50; x += 15) {
    pts.push([x, zf], [x, zf + back], [x + 5, zf + back], [x + 5, zf]);
  }
  pts.push([54, zf]);
  return pts;
}
export const TRENCH_LINES = [
  fireTrench(40, 4.5),                    // friendly (the enemy is to the north, −z)
  [[-19, 40], [-19, 62]],                 // communication trench to the friendly dugout
  fireTrench(-40, -4.5),                  // enemy
  [[26, -40], [26, -58]],                 // enemy communication trench
];
// Exits over the top: a notch cut into the front wall of a fire bay holding a flight of steps, so the
// stairs never block the trench itself. zf: fire-trench line, front: −1 / +1 = the enemy side is −z / +z.
export const STAIR_RUN = 1.8, STAIR_HALF = 0.8;
export const STAIRS = [
  { zf: 40, front: -1, xs: [-34, 11, 41] },
  { zf: -40, front: 1, xs: [-34, -4, 41] },
];
// Dugouts at the end of the communication trenches: [x0, x1, z0, z1] (roofed at ground level).
export const DUGOUTS = [[-22, -16, 61, 66], [23, 29, -62, -57]];

/** Corridor rectangles in local coordinates: [x0, x1, z0, z1]. */
export function localRects() {
  const h = TRENCH.width / 2, out = [];
  for (const line of TRENCH_LINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      if (ax === bx && az === bz) continue;
      out.push([Math.min(ax, bx) - h, Math.max(ax, bx) + h, Math.min(az, bz) - h, Math.max(az, bz) + h]);
    }
  }
  for (const S of STAIRS) {
    const wallZ = S.zf + S.front * h, endZ = wallZ + S.front * STAIR_RUN;
    for (const x of S.xs) out.push([x - STAIR_HALF, x + STAIR_HALF, Math.min(S.zf, endZ), Math.max(S.zf, endZ)]);
  }
  for (const d of DUGOUTS) out.push(d.slice());
  return out;
}

const SITE = SITES.find((s) => s.type === 'trenches');
/** World-space rectangles [x0, x1, z0, z1] of the cut (empty if the arena is not in the layout). */
export const TRENCH_RECTS = SITE ? localRects().map(([a, b, c, d]) => [a + SITE.x, b + SITE.x, c + SITE.z, d + SITE.z]) : [];
const BB = TRENCH_RECTS.reduce((m, r) => [Math.min(m[0], r[0]), Math.max(m[1], r[1]), Math.min(m[2], r[2]), Math.max(m[3], r[3])], [1e9, -1e9, 1e9, -1e9]);

/** Floor height of the trench at world (x, z), or null outside the cut. */
export function trenchFloorAt(x, z) {
  if (!SITE || x < BB[0] || x > BB[1] || z < BB[2] || z > BB[3]) return null;
  for (const r of TRENCH_RECTS) if (x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) return SITE.y - TRENCH.depth;
  return null;
}
