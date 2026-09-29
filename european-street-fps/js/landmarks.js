// STUB — replaced by the landmarks agent. One placeholder block per countryside site.
import * as THREE from 'three';
import { SITES } from './layout.js';

export function buildLandmarks(scene, M, { heightAt } = {}) {
  const colliders = [], markers = [], enemySites = [], viewpoints = [], navPoints = [];
  for (const s of SITES) {
    const h = 8;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), M.stone);
    mesh.position.set(s.x, s.y + h / 2, s.z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    markers.push({ id: s.id, name: s.name, type: s.type, x: s.x, z: s.z });
    enemySites.push({ id: s.id, x: s.x + 12, y: s.y, z: s.z + 12, r: 20, spawns: [new THREE.Vector3(s.x + 12, s.y, s.z + 12), new THREE.Vector3(s.x - 12, s.y, s.z + 12)] });
    for (let a = 0; a < 8; a++) navPoints.push(new THREE.Vector3(s.x + Math.cos(a) * 18, s.y, s.z + Math.sin(a) * 18));
  }
  void heightAt;
  return { colliders, markers, enemySites, viewpoints, navPoints, update() {} };
}
