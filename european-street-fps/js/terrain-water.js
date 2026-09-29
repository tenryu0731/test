// Lake and river water surfaces (terrain agent). The river is a ribbon following the carved
// channel with its water level descending downstream; ripples flow along it in the shader.
import * as THREE from 'three';
import { LAKE } from './layout.js';
import { FINE, lakeRadiusAt } from './terrain-height.js';
import { makeWaterNormal } from './terrain-tex.js';

export function createWater(scene, river) {
  const tN = makeWaterNormal(256);
  const uniforms = { uTime: { value: 0 }, tWN: { value: tN } };
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a5a4a, roughness: 0.07, metalness: 0.0, transparent: true, opacity: 0.86, envMapIntensity: 1.1, side: THREE.DoubleSide,
  });
  mat.name = 'terrain-water';
  mat.userData.noCast = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wuv;\nvarying vec3 vWuv;\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWuv = wuv;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform sampler2D tWN;\nvarying vec3 vWuv;\nvarying vec3 vWP;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        float fl = vWuv.z;
        vec2 uv = vWuv.xy;
        vec3 n1 = texture(tWN, uv / 7.0 + vec2(uTime * 0.013, -uTime * (0.02 + 0.09 * fl))).xyz * 2.0 - 1.0;
        vec3 n2 = texture(tWN, uv / 19.0 * mat2(0.8, -0.6, 0.6, 0.8) + vec2(-uTime * 0.01, -uTime * (0.012 + 0.05 * fl))).xyz * 2.0 - 1.0;
        vec2 p = (n1.xy * 0.55 + n2.xy * 0.45) * 0.45;
        vec3 wn = normalize(vec3(p.x, 1.0, p.y));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', /* glsl */`
        vec3 vdir = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - clamp(vdir.y, 0.0, 1.0), 3.0);
        diffuseColor.a = mix(0.72, 0.97, fres);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'terrain-water-v1';

  const meshes = [];
  // ---- lake: disc a little larger than the irregular shoreline (edge hidden under the banks)
  {
    const seg = 96, rings = 3, pos = [], wuv = [], idx = [];
    pos.push(LAKE.x, LAKE.y, LAKE.z); wuv.push(LAKE.x, LAKE.z, 0);
    for (let r = 1; r <= rings; r++) for (let i = 0; i < seg; i++) {
      const a = i / seg * Math.PI * 2, rr = (lakeRadiusAt(a) + 3.5) * r / rings;
      const x = LAKE.x + Math.cos(a) * rr, z = LAKE.z + Math.sin(a) * rr;
      pos.push(x, LAKE.y, z); wuv.push(x, z, 0);
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + (i + 1) % seg, 1 + i);
    for (let r = 1; r < rings; r++) for (let i = 0; i < seg; i++) {
      const a = 1 + (r - 1) * seg + i, b = 1 + (r - 1) * seg + (i + 1) % seg, c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = 'lake'; m.receiveShadow = true;
    scene.add(m); meshes.push(m);
  }
  // ---- river ribbon in chunks
  {
    const { X, Z, W, S, halfW } = river;
    const n = X.length, CH = 160;
    for (let c0 = 0; c0 < n - 1; c0 += CH) {
      const c1 = Math.min(n - 1, c0 + CH);
      const pos = [], wuv = [], nor = [], idx = [];
      for (let i = c0; i <= c1; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let tx = X[b] - X[a], tz = Z[b] - Z[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const r = Math.max(Math.abs(X[i]), Math.abs(Z[i]));
        const hw = halfW + 1.6 + (r > FINE.half - 60 ? Math.min(1, (r - FINE.half + 60) / 60) * 26 : 0);
        for (const s of [-1, 1]) {
          pos.push(X[i] - tz * hw * s, W[i], Z[i] + tx * hw * s);
          wuv.push(hw * s, S[i], 1);
          nor.push(0, 1, 0);
        }
      }
      for (let i = 0; i < c1 - c0; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = 'river'; m.receiveShadow = true;
      scene.add(m); meshes.push(m);
    }
  }
  return { meshes, material: mat, update(dt) { uniforms.uTime.value += dt; } };
}
