// マテリアル: Poly Haven の PBR テクスチャ（CC0）と、窓をシェーダーで描く外壁マテリアル
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maxAniso = 4;
export let manifest = null;

export async function initMaterials(renderer) {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  manifest = await (await fetch('assets/game/manifest.json')).json();
}

function tex(url, srgb) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// テクスチャ 1 枚が覆う実寸（メートル）。ジオメトリ側で UV をこの値で割る。
export function texSize(id) {
  const d = manifest?.textures?.[id]?.dimensions_mm;
  if (!d) return [2, 2];
  return [Math.max(0.5, d[0] / 1000), Math.max(0.5, d[1] / 1000)];
}

const cache = {};
export function pbr(id, opts = {}) {
  const key = id + JSON.stringify(opts);
  if (cache[key]) return cache[key];
  const base = `assets/game/tex/${id}`;
  const arm = tex(`${base}_arm.jpg`, false);
  const m = new THREE.MeshStandardMaterial({
    map: tex(`${base}_diff.jpg`, true),
    normalMap: tex(`${base}_nor.jpg`, false),
    aoMap: arm, roughnessMap: arm, metalnessMap: arm,
    roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 1,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    aoMapIntensity: 0.8,
    vertexColors: !!opts.vertexColors,
  });
  if (opts.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  cache[key] = m;
  return m;
}

// ---- 外壁（窓・店舗のガラス・インテリアマッピング） -------------------------
export const facadeUniforms = { uInteriorGain: { value: 0.24 }, uStoreGain: { value: 0.2 }, uDbg: { value: 0 } };

const FACADE_PARS = /* glsl */`
varying vec4 vFacade; varying vec2 vFuv; varying float vSeed; varying vec3 vWPos; varying vec3 vWNorm;
uniform float uInteriorGain; uniform float uStoreGain; uniform float uDbg;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
struct FM { float glass; float frame; float store; float spandrel; float sill; vec3 interior; };
FM fmCompute() {
  FM m; m.glass = 0.; m.frame = 0.; m.store = 0.; m.spandrel = 0.; m.sill = 0.; m.interior = vec3(0.);
  float style = vFacade.w;
  if (style < -0.5) return m;
  float noStore = 0.; if (style > 9.5) { noStore = 1.; style -= 10.; }
  float bay = vFacade.x, fh = vFacade.y, gh = vFacade.z;
  float u = vFuv.x, v = vFuv.y;
  float cx = floor(u / bay); float lx = u - cx * bay;
  float fl, ly, h;
  if (v < gh) { fl = -1.; ly = v; h = gh; } else { fl = floor((v - gh) / fh); ly = v - gh - fl * fh; h = fh; }
  // 種は補間でわずかに揺れるので整数に丸めてから使う（揺れるとハッシュが画素ごとに変わりノイズになる）
  float sd = floor(vSeed * 997. + 0.5);
  float rnd = h12(vec2(cx + sd * 0.0917 * 1000., fl + sd * 13.1));
  bool storeF = fl < 0. && noStore < 0.5;
  bool upper = !storeF;
  if (fl < 0.) fh = gh;
  vec2 lo, hi;
  if (storeF) {
    float door = step(rnd, 0.28);
    lo = vec2(0.22, door > 0.5 ? 0.02 : 0.6); hi = vec2(bay - 0.22, gh - 1.25);
    m.store = 1.;
  } else if (style < 0.5) {
    float w = clamp(bay * 0.46, 0.9, 1.5);
    lo = vec2(0.5 * (bay - w), fh * 0.27); hi = vec2(0.5 * (bay + w), fh * 0.85);
  } else if (style < 1.5) {
    lo = vec2(0.1, fh * 0.30); hi = vec2(bay - 0.1, fh * 0.86);
  } else {
    lo = vec2(0.03, fh * 0.28); hi = vec2(bay - 0.03, fh * 0.985);
  }
  float fw = (style > 1.5 && upper) ? 0.05 : 0.09;
  vec2 p = vec2(lx, ly);
  float inOuter = step(lo.x - fw, p.x) * step(p.x, hi.x + fw) * step(lo.y - fw, p.y) * step(p.y, hi.y + fw);
  float inGlass = step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y);
  if (inGlass > 0.5) {
    if (upper && style < 0.5) {
      if (abs(p.y - 0.5 * (lo.y + hi.y)) < 0.035) inGlass = 0.;
    } else if (upper && style < 1.5) {
      float sub = (hi.x - lo.x) / max(1., floor((hi.x - lo.x) / 1.4));
      float mx = mod(p.x - lo.x, sub); if (mx < 0.03 || mx > sub - 0.03) inGlass = 0.;
    } else if (upper) {
      float mx = mod(p.x - lo.x, 1.5); if (mx < 0.035) inGlass = 0.;
    } else {
      float mx = mod(p.x - lo.x, 1.7); if (mx < 0.045) inGlass = 0.;
      if (abs(p.y - (hi.y - 0.55)) < 0.03) inGlass = 0.;
    }
  }
  if (style > 1.5 && upper && inOuter < 0.5) m.spandrel = 1.;
  // 窓台（レンガ壁の窓の下）
  if (style < 0.5 && upper && inOuter < 0.5 && p.x > lo.x - 0.12 && p.x < hi.x + 0.12 && p.y > lo.y - 0.2 && p.y < lo.y - fw) m.sill = 1.;
  m.glass = inGlass; m.frame = inOuter * (1. - inGlass);
  if (inGlass > 0.5) {
    // インテリアマッピング: 窓の奥に箱型の部屋があるものとして視線と交差させる
    vec3 n = normalize(vWNorm); vec3 t = vec3(n.z, 0., -n.x);
    vec3 vd = normalize(vWPos - cameraPosition);
    vec3 d = vec3(dot(vd, t), vd.y, dot(vd, -n));
    d.z = max(d.z, 0.05);
    float depth = storeF ? 7.5 : 4.2;
    vec3 o = vec3(lx, ly, 0.);
    float tx = d.x > 0. ? (bay - o.x) / d.x : -o.x / min(d.x, -1e-4);
    float ty = d.y > 0. ? (h - o.y) / d.y : -o.y / min(d.y, -1e-4);
    float tz = depth / d.z;
    // どの面に当たったかを明示的に決める（== での比較は GPU によって画素ごとに揺れてノイズになる）
    float tt; float face;
    if (tz <= tx && tz <= ty) { tt = tz; face = 0.; } else if (tx <= ty) { tt = tx; face = 1.; } else { tt = ty; face = 2.; }
    vec3 hp = o + d * tt;
    vec3 wallC = mix(vec3(0.80, 0.74, 0.64), vec3(0.62, 0.68, 0.74), h12(vec2(rnd * 7., 3.)));
    vec3 col;
    if (face < 0.5) col = wallC * 0.95;
    else if (face < 1.5) col = wallC * 0.72;
    else if (d.y < 0.) col = mix(vec3(0.24, 0.16, 0.10), vec3(0.32, 0.31, 0.30), step(0.5, h12(vec2(rnd, 9.))));
    else {
      col = vec3(0.86);
      vec2 c = vec2(hp.x - bay * 0.5, hp.z - depth * 0.5);
      if (abs(c.x) < 0.45 && abs(c.y) < 0.45) col = vec3(2.2, 2.05, 1.8);
    }
    // 奥の家具の影（低い箱）
    if (face < 0.5 && hp.y < 0.9 && abs(hp.x - bay * (0.3 + 0.4 * h12(vec2(rnd, 4.)))) < 0.6) col *= 0.35;
    col *= 1.0 - 0.5 * clamp(tt / (depth * 1.7), 0., 1.);
    float lit = step(rnd, 0.6);
    float dark = step(0.88, rnd);
    col *= (storeF ? uStoreGain : mix(0.3, 1.0, lit) * uInteriorGain) * (1. - dark * 0.85);
    if (upper && h12(vec2(rnd, 5.)) < 0.35) {
      float bh = mix(lo.y + 0.25, hi.y, h12(vec2(rnd, 6.)));
      if (ly > bh) col = vec3(0.78, 0.76, 0.70) * 0.32;
    }
    m.interior = col;
    if (uDbg > 0.5 && uDbg < 1.5) m.interior = vec3(0.3);
  }
  return m;
}
vec3 frameColor(float s, float store) {
  if (store > 0.5) return vec3(0.04, 0.045, 0.05);
  float f = fract(floor(s * 997. + 0.5) * 0.00731 * 1000.);
  return f < 0.45 ? vec3(0.78, 0.76, 0.70) : (f < 0.8 ? vec3(0.05, 0.05, 0.05) : vec3(0.08, 0.16, 0.11));
}
`;

export function makeFacadeMaterial(id, opts = {}) {
  const m = pbr(id, opts).clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, facadeUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFacade; attribute vec2 aFuv; attribute float aSeed;
varying vec4 vFacade; varying vec2 vFuv; varying float vSeed; varying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vFacade = aFacade; vFuv = aFuv; vSeed = aSeed;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);`);
    const ao = THREE.ShaderChunk.aomap_fragment.replace(
      'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;',
      'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0; ambientOcclusion = mix(ambientOcclusion, 1.0, wSurf);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS)
      .replace('#include <map_fragment>', `#include <map_fragment>
FM fm = fmCompute();
// 遠くでは窓の模様が画素より細かくなりモアレになるので、平均の色へ寄せる
float fmSt = vFacade.w > 9.5 ? vFacade.w - 10. : vFacade.w;
float fmFade = vFacade.w < -0.5 ? 0. : smoothstep(0.22, 0.7, length(fwidth(vFuv)));
float fmCov = fmSt > 1.5 ? 0.78 : (fmSt > 0.5 ? 0.5 : 0.3);
float wG = mix(fm.glass, fmCov, fmFade);
float wF = mix(fm.frame, 0.1, fmFade);
float wS = mix(fm.spandrel, fmSt > 1.5 ? 0.2 : 0., fmFade);
float wSill = fm.sill * (1. - fmFade);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.56), wSill * 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.07), wS);
diffuseColor.rgb = mix(diffuseColor.rgb, frameColor(vSeed, fm.store), wF);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), wG);
float wSurf = clamp(wG + wF + wS, 0., 1.);
if (uDbg > 1.5 && uDbg < 2.5) { diffuseColor.rgb = vec3(fmFade, wG, fm.glass); }
if (uDbg > 2.5) { diffuseColor.rgb = fm.interior * 3.; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.22, wS); roughnessFactor = mix(roughnessFactor, 0.45, wF); roughnessFactor = mix(roughnessFactor, mix(0.035, 0.12, fmFade), wG);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.6, wS); metalnessFactor = mix(metalnessFactor, 0.1, wF); metalnessFactor = mix(metalnessFactor, fmSt > 1.5 ? 0.35 : 0.0, wG);`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 fmGeomNormal = normal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, fmGeomNormal, wSurf));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += fm.interior * (1. - fmFade) + vec3(0.30, 0.28, 0.25) * uInteriorGain * fmCov * 0.35 * fmFade;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
{
  // 低い階のガラスには空ではなく向かいの建物が映るので、空の映り込みを弱めて暗くする
  float hk = smoothstep(2.0, 45.0, vFuv.y);
  radiance *= mix(vec3(1.0), mix(0.22, fmSt > 1.5 ? 0.85 : 0.6, hk) * vec3(0.92, 0.95, 1.0), wG);
}
#endif`)
      .replace('#include <aomap_fragment>', ao);
  };
  m.customProgramCacheKey = () => 'facade';
  return m;
}

// 単色のマテリアル（車体以外の小物、信号機など）
export function solid(color, roughness = 0.6, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
