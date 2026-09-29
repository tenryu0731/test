// STUB — replaced by the weapon agent. A grey box gun, no effects.
import * as THREE from 'three';

export class Weapon {
  constructor({ audio }) {
    this.audio = audio;
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2));
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    this.gun.position.set(0.2, -0.2, -0.45);
    this.viewScene.add(this.gun);
    this.magSize = 24;
    this.currentSpread = 0;
    this.reset();
  }
  reset() { this.ammo = this.magSize; this.reserve = 96; this.isReloading = false; this.cool = 0; this.reloadT = 0; }
  update(dt) {
    this.cool -= dt;
    if (this.isReloading && (this.reloadT -= dt) <= 0) {
      const n = Math.min(this.magSize - this.ammo, this.reserve);
      this.ammo += n; this.reserve -= n; this.isReloading = false;
    }
  }
  tryFire() {
    if (this.cool > 0 || this.isReloading) return null;
    if (this.ammo <= 0) { this.reload(); return null; }
    this.ammo--; this.cool = 0.11;
    return { pitchKick: 0.012, yawKick: (Math.random() - 0.5) * 0.006, spread: 0.004 };
  }
  reload() {
    if (this.isReloading || this.ammo >= this.magSize || this.reserve <= 0) return;
    this.isReloading = true; this.reloadT = 1.6;
  }
  getMuzzleWorld(camera, target) { return target.set(0.2, -0.15, -0.8).applyMatrix4(camera.matrixWorld); }
  spawnImpact() {}
  spawnTracer() {}
  updateEffects() {}
  resize(aspect) { this.viewCamera.aspect = aspect; this.viewCamera.updateProjectionMatrix(); }
}
