// STUB — replaced by the enemy agent. Static boxes that can be shot.
import * as THREE from 'three';

export class EnemyManager {
  constructor({ scene, spawns }) {
    this.scene = scene; this.spawns = spawns; this.list = [];
    this.total = 5; this.remaining = 5;
    this.ray = new THREE.Ray();
  }
  reset() {
    for (const e of this.list) this.scene.remove(e.mesh);
    this.list = this.spawns.slice(0, 5).map((p) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      mesh.position.copy(p).setY(0.9); mesh.castShadow = true;
      this.scene.add(mesh);
      return { mesh, hp: 100, alive: true, box: new THREE.Box3().setFromObject(mesh) };
    });
    this.remaining = this.list.length;
  }
  update() {}
  raycast(origin, dir, maxDist) {
    this.ray.set(origin, dir);
    let best = null;
    for (const e of this.list) {
      if (!e.alive) continue;
      const p = this.ray.intersectBox(e.box, new THREE.Vector3());
      const d = p && p.distanceTo(origin);
      if (p && d < maxDist && (!best || d < best.distance)) best = { enemy: e, point: p, normal: dir.clone().negate(), distance: d, part: 'body' };
    }
    return best;
  }
  damage(hit, amount) {
    const e = hit.enemy; e.hp -= amount;
    if (e.hp <= 0 && e.alive) { e.alive = false; e.mesh.rotation.z = Math.PI / 2; e.mesh.position.y = 0.4; this.remaining--; return { killed: true }; }
    return { killed: false };
  }
}
