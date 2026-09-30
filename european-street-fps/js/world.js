// Assembles the whole semi-open world: terrain + countryside (terrain.js), the walled town
// (city.js) and the countryside landmarks (landmarks.js). Everything the game needs about the
// world is exposed on the returned object (see docs/CONTRACT.md → world.js).
import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { buildCity } from './city.js';
import { buildLandmarks } from './landmarks.js';
import { PLAYER_START, PLAY_HALF, TOWN } from './layout.js';

export function buildWorld(scene, materials, { renderer, camera } = {}) {
  const t0 = performance.now();
  const terrain = createTerrain(scene, { materials, renderer, camera });
  const t1 = performance.now();
  const city = buildCity(scene, materials, { backdrop: false, heightAt: terrain.heightAt });
  const t2 = performance.now();
  const landmarks = buildLandmarks(scene, materials, { heightAt: terrain.heightAt });
  const t3 = performance.now();

  const townSites = city.enemySites || [{ id: 'town', name: '市街', x: 0, y: 0, z: 0, r: 40, spawns: city.enemySpawns || [] }];
  // Walkable ground: the town paves its whole walled rectangle at TOWN.y; outside, the terrain.
  const [tx0, tx1, tz0, tz1] = TOWN.rect;
  const groundAt = (x, z) => {
    const h = terrain.heightAt(x, z);
    return x > tx0 && x < tx1 && z > tz0 && z < tz1 ? Math.max(h, TOWN.y) : h;
  };
  const world = {
    heightAt: terrain.heightAt,
    groundAt,
    colliders: [...city.colliders, ...(terrain.colliders || []), ...(landmarks.colliders || [])],
    navPoints: [...(city.navPoints || []), ...(terrain.navPoints || []), ...(landmarks.navPoints || [])],
    enemySites: [...townSites, ...(landmarks.enemySites || [])],
    viewpoints: [...(city.viewpoints || []), ...(landmarks.viewpoints || [])],
    markers: [...(city.markers || []), ...(landmarks.markers || [])],
    playerSpawn: city.enemySites ? new THREE.Vector3(PLAYER_START.x, 0, PLAYER_START.z) : city.playerSpawn.clone(),
    playerYaw: city.enemySites ? PLAYER_START.yaw : city.playerYaw,
    bounds: { minX: -PLAY_HALF, maxX: PLAY_HALF, minZ: -PLAY_HALF, maxZ: PLAY_HALF },
    parts: { terrain, city, landmarks },
    update(dt, cam) {
      terrain.update?.(dt, cam);
      city.update?.(dt, cam);
      landmarks.update?.(dt, cam);
    },
  };
  world.playerSpawn.y = groundAt(world.playerSpawn.x, world.playerSpawn.z);
  console.log(`[world] terrain ${(t1 - t0).toFixed(0)} ms, town ${(t2 - t1).toFixed(0)} ms, landmarks ${(t3 - t2).toFixed(0)} ms; ` +
    `${world.colliders.length} colliders, ${world.navPoints.length} nav points, ${world.enemySites.length} enemy sites`);
  return world;
}
