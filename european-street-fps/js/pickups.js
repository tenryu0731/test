// Supply crates (ammo / medkit) near every robot squad site and at a few town squares.
// Walk over a crate to pick it up. Crates respawn with reset() (new round).
//
// One draw call per crate (crate + handle share one atlas material) plus a soft ground ring,
// both hidden beyond VIEW_DIST. No emissive / glow: the highlight is a gentle warm ring on the
// ground and a slow hover of the crate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOWN, LAKE } from './layout.js';

const VIEW_DIST = 140;          // crates beyond this are hidden (also saves draw calls)
const PICK_R = 1.25;            // horizontal pick-up radius (m)
const TAU = Math.PI * 2;

export const PICKUP_TYPES = {
  ammo: { label: '弾薬', size: [0.72, 0.34, 0.42] },
  med: { label: '医療キット', size: [0.54, 0.3, 0.36] },
};

// ------------------------------------------------------------------ textures (atlas 512×256)
// Atlas layout (u, v in 0..1, v up): side design [0,0.5]-[0.5,1], top design [0.5,0.5]-[1,1],
// plain [0,0]-[0.5,0.5], handle [0.5,0]-[1,0.5].
function makeAtlas(type) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const ammo = type === 'ammo';
  const base = ammo ? '#5a6238' : '#e6e1d3';
  const dark = ammo ? '#3f4527' : '#b9b2a0';
  const noise = (x, y, w, h, a) => {
    for (let i = 0; i < w * h / 18; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`;
      g.fillRect(x + Math.random() * w, y + Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  };
  // canvas y down: atlas v=1 is canvas y=0.
  // side (x 0..256, y 0..128)
  g.fillStyle = base; g.fillRect(0, 0, 512, 256);
  noise(0, 0, 512, 256, 0.08);
  g.strokeStyle = dark; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
  if (ammo) {
    g.fillStyle = '#d9b441'; g.fillRect(0, 50, 256, 26);                 // yellow band
    g.fillStyle = '#2d2a1c'; g.font = '800 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('弾薬 5.56', 128, 64);
    g.fillStyle = 'rgba(235,225,190,0.85)'; g.font = '700 16px sans-serif'; g.fillText('AMMO · 48', 128, 100);
    g.fillText('▲ この面を上に', 128, 26);
  } else {
    g.fillStyle = '#2f8a58'; g.beginPath(); g.roundRect(88, 24, 80, 80, 12); g.fill();
    g.fillStyle = '#fff'; g.fillRect(118, 34, 20, 60); g.fillRect(98, 54, 60, 20);
    g.fillStyle = '#3b3a34'; g.font = '800 18px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('医療', 12, 64); g.textAlign = 'right'; g.fillText('+50', 244, 64);
  }
  // top (x 256..512, y 0..128)
  g.strokeStyle = dark; g.lineWidth = 8; g.strokeRect(262, 6, 244, 116);
  if (ammo) {
    g.fillStyle = '#d9b441'; g.fillRect(256, 52, 256, 22);
    g.fillStyle = '#2d2a1c'; g.font = '800 20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('5.56 × 48', 384, 63);
  } else {
    g.fillStyle = '#2f8a58'; g.beginPath(); g.roundRect(344, 24, 80, 80, 12); g.fill();
    g.fillStyle = '#fff'; g.fillRect(374, 34, 20, 60); g.fillRect(354, 54, 60, 20);
  }
  // plain (x 0..256, y 128..256) keeps the base colour; handle (x 256..512, y 128..256)
  g.fillStyle = '#2b2a26'; g.fillRect(256, 128, 256, 128);
  noise(256, 128, 256, 128, 0.12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function remapUV(geo, faceRegions) {
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each).
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = faceRegions[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  geo.clearGroups();
  return geo;
}

function makeCrateGeometry(type) {
  const [w, h, d] = PICKUP_TYPES[type].size;
  const SIDE = [0, 0.5, 0.5, 1], TOP = [0.5, 0.5, 1, 1], PLAIN = [0.02, 0.02, 0.48, 0.48], HANDLE = [0.52, 0.02, 0.98, 0.48];
  const body = remapUV(new THREE.BoxGeometry(w, h, d), [PLAIN, PLAIN, TOP, PLAIN, SIDE, SIDE]);
  body.translate(0, h / 2, 0);
  const hw = type === 'ammo' ? 0.22 : 0.18;
  const handle = remapUV(new THREE.BoxGeometry(hw, 0.035, 0.05), Array(6).fill(HANDLE));
  handle.translate(0, h + 0.03, 0);
  const posts = [-1, 1].map((s) => remapUV(new THREE.BoxGeometry(0.03, 0.05, 0.05), Array(6).fill(HANDLE)).translate(s * (hw / 2 - 0.015), h + 0.012, 0));
  const parts = [body, handle, ...posts];
  if (type === 'ammo') {
    // latches on the long sides
    for (const s of [-1, 1]) parts.push(remapUV(new THREE.BoxGeometry(0.06, 0.07, 0.02), Array(6).fill(HANDLE)).translate(s * 0.2, h - 0.05, d / 2 + 0.008));
  }
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

function makeRingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.28)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  grd.addColorStop(0.78, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.86, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Deterministic pseudo-random so crate spots are the same every load.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

// ------------------------------------------------------------------ manager
export class Pickups {
  constructor({ scene, world, physics }) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    scene.add(this.group);
    this.geo = { ammo: makeCrateGeometry('ammo'), med: makeCrateGeometry('med') };
    this.mat = {
      ammo: new THREE.MeshStandardMaterial({ map: makeAtlas('ammo'), roughness: 0.78, metalness: 0.15 }),
      med: new THREE.MeshStandardMaterial({ map: makeAtlas('med'), roughness: 0.55, metalness: 0.05 }),
    };
    this.ringGeo = new THREE.CircleGeometry(1.05, 40).rotateX(-Math.PI / 2);
    const ringTex = makeRingTexture();
    this.ringMat = {
      ammo: new THREE.MeshBasicMaterial({ map: ringTex, color: 0xfff1cf, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      med: new THREE.MeshBasicMaterial({ map: ringTex, color: 0xe4f6e8, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    this.time = 0;
    this._cullT = 0;
    this._place();
  }

  // ---------------------------------------------------------------- placement
  _blocked(x, y, z) {
    const ph = this.physics, r = 0.7;
    if (!ph?.query) return false;
    const ids = ph.query(x - r, z - r, x + r, z + r);
    for (const i of ids) {
      const b = ph.boxes[i];
      if (b.max.x > x - r && b.min.x < x + r && b.max.z > z - r && b.min.z < z + r && b.max.y > y + 0.05 && b.min.y < y + 1.6) return true;
    }
    return false;
  }

  _findSpot(cx, cz, rMin, rMax, yRef, seed) {
    const ground = this.world.groundAt || this.world.heightAt;
    const [tx0, tx1, tz0, tz1] = TOWN.rect;
    for (let ring = 0; ring < 5; ring++) {
      const rr = rMin + (rMax - rMin) * (ring / 4);
      for (let a = 0; a < 12; a++) {
        const ang = seed * TAU + a * TAU / 12 + ring * 0.37;
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
        if (Math.abs(x) > 660 || Math.abs(z) > 660) continue;
        const y = ground(x, z);
        if (!Number.isFinite(y)) continue;
        if (yRef !== undefined && Math.abs(y - yRef) > 3) continue;
        const slope = Math.max(Math.abs(ground(x + 0.8, z) - y), Math.abs(ground(x, z + 0.8) - y), Math.abs(ground(x - 0.8, z) - y), Math.abs(ground(x, z - 0.8) - y));
        if (slope > 0.3) continue;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6 && y < LAKE.y + 1) continue;
        // Keep out of the wall ring (just inside/outside the town walls).
        const inTownBand = x > tx0 - 4 && x < tx1 + 4 && z > tz0 - 4 && z < tz1 + 4 && !(x > tx0 + 6 && x < tx1 - 6 && z > tz0 + 6 && z < tz1 - 6);
        if (inTownBand) continue;
        if (this._blocked(x, y, z)) continue;
        return { x, y, z };
      }
    }
    return null;
  }

  _place() {
    const w = this.world;
    const sites = w.enemySites || [];
    const used = [];
    const farFromUsed = (p, d) => used.every((u) => (u.x - p.x) ** 2 + (u.z - p.z) ** 2 > d * d);
    const add = (type, p, name) => {
      if (!p || !farFromUsed(p, 6)) return;
      used.push(p);
      this._addItem(type, p, name);
    };
    sites.forEach((s, i) => {
      const r = Math.max(10, s.r || 20);
      const seed = hash(s.id || String(i));
      add('ammo', this._findSpot(s.x, s.z, Math.min(6, r * 0.3), r * 0.85, s.y, seed), s.name);
      if (i % 2 === 0 || r > 40) add('med', this._findSpot(s.x, s.z, Math.min(8, r * 0.4), r * 0.95, s.y, seed + 0.5), s.name);
    });
    // A few extra crates at town squares away from the squads.
    const [tx0, tx1, tz0, tz1] = TOWN.rect;
    const townMarkers = (w.markers || []).filter((m) => m.x > tx0 + 10 && m.x < tx1 - 10 && m.z > tz0 + 10 && m.z < tz1 - 10);
    let n = 0;
    for (const m of townMarkers) {
      if (n >= 4) break;
      if (!sites.every((s) => (s.x - m.x) ** 2 + (s.z - m.z) ** 2 > 28 * 28)) continue;
      const p = this._findSpot(m.x, m.z, 3, 14, undefined, hash(m.id || m.name || String(n)));
      if (p) { add(n % 2 ? 'med' : 'ammo', p, m.name); n++; }
    }
    // Fallback so a round always has a couple of crates in town.
    if (n === 0) {
      for (const [x, z, type] of [[0, 60, 'ammo'], [0, -60, 'med']]) add(type, this._findSpot(x, z, 2, 20, undefined, hash(type)), '市街');
    }
  }

  _addItem(type, p, name) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const crate = new THREE.Mesh(this.geo[type], this.mat[type]);
    crate.castShadow = true; crate.receiveShadow = true;
    crate.rotation.y = hash(`${p.x},${p.z}`) * TAU;
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat[type]);
    ring.position.y = 0.04;
    ring.renderOrder = 1;
    // Tilt the ring to the local ground slope.
    const ground = this.world.groundAt || this.world.heightAt;
    const nx = ground(p.x - 0.5, p.z) - ground(p.x + 0.5, p.z), nz = ground(p.x, p.z - 0.5) - ground(p.x, p.z + 0.5);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 1, nz).normalize());
    g.add(crate, ring);
    this.group.add(g);
    this.items.push({ type, name, x: p.x, y: p.y, z: p.z, pos: g.position, group: g, crate, ring, active: true, phase: hash(`${p.z},${p.x}`) * TAU, near: true, denyT: 0 });
  }

  // ---------------------------------------------------------------- per round / frame
  reset() {
    for (const it of this.items) { it.active = true; it.group.visible = true; it.denyT = 0; }
    this._cullT = 0;
  }

  /**
   * Animate and test pick-ups. `tryCollect(item)` returns true when the item was consumed
   * (e.g. false when HP is already full); the crate then disappears until the next round.
   */
  update(dt, playerPos, tryCollect) {
    this.time += dt;
    const t = this.time;
    this._cullT -= dt;
    const doCull = this._cullT <= 0;
    if (doCull) this._cullT = 0.3;
    const pulse = 0.3 + 0.12 * Math.sin(t * 2.2);
    this.ringMat.ammo.opacity = pulse; this.ringMat.med.opacity = pulse;
    for (const it of this.items) {
      if (!it.active) continue;
      const dx = playerPos.x - it.x, dz = playerPos.z - it.z;
      const d2 = dx * dx + dz * dz;
      if (doCull) { it.near = d2 < VIEW_DIST * VIEW_DIST; it.group.visible = it.near; }
      if (!it.near) continue;
      if (d2 < 45 * 45) {
        it.crate.position.y = 0.16 + Math.sin(t * 1.9 + it.phase) * 0.05;
        it.crate.rotation.y += dt * 0.5;
      }
      if (it.denyT > 0) it.denyT -= dt;
      if (d2 < PICK_R * PICK_R && Math.abs(playerPos.y - it.y) < 1.8 && it.denyT <= 0) {
        if (tryCollect(it)) { it.active = false; it.group.visible = false; }
        else it.denyT = 3; // e.g. HP full: don't re-prompt every frame
      }
    }
  }

  get activeCount() { let n = 0; for (const it of this.items) if (it.active) n++; return n; }
}
