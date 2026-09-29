// Rendering pipeline: renderer, camera, physically based sky + clouds, sun with cascaded shadows,
// image-based light from the sky, aerial-perspective haze, colour grade, quality presets (with a
// post chain on 'high'), adaptive resolution and a `?debug` overlay. main.js only talks to the object
// returned by createGraphics (see docs/CONTRACT.md → render.js).
//
//   low    : direct render (canvas MSAA), 1 shadow cascade 1024² / ±32 m, 2×2 PCF, clouds w/o detail
//   medium : direct render (canvas MSAA), 1 cascade 2048² / ±46 m, 2×2 PCF — grade/haze/sky are in-material,
//            the vignette is a CSS layer: no extra full-screen pass at all
//   high   : HDR target (MSAA ×4) → GTAO (½ res) → sky-only bloom → grade; 2 cascades (±30 m + ±220 m,
//            the far one refreshed every 2nd frame), 4×4 PCF
// The first-person viewmodel is always drawn last, straight onto the canvas (tone mapped + graded
// in-material like the world, never touched by world AO / haze / bloom).
import * as THREE from 'three';
import { createSky } from './render-sky.js';
import { installChunks } from './render-chunks.js';
import { createPost } from './render-post.js';
import { createDebugOverlay } from './render-debug.js';

// Warm mid-afternoon sun from the south-west (Tuscany, summer ~15:30): elevation 50°, compass azimuth
// 235° (north = -z, east = +x).
const SUN_ELEVATION = 50, SUN_AZIMUTH = 235;
const SUN_DIR = (() => {
  const e = THREE.MathUtils.degToRad(SUN_ELEVATION), a = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
})();
const SUN_ILLUMINANCE = 3.0;
const EXPOSURE = 1.15;

// Shadow cascades: radius = half extent (m), size = map texels, kernel = shadow.radius (≤1.5 → 2×2
// bilinear PCF, >1.5 → 4×4), lift = light distance above the cascade centre along the sun, depth = far plane.
const QUALITY = {
  low: {
    pixelRatio: 1, minPixelRatio: 0.6, post: false, cloudDetail: false, vignette: 0.8,
    near: { size: 1024, radius: 32, kernel: 1, bias: -0.0002, normalBias: 0.07, lift: 150, depth: 320 },
  },
  medium: {
    pixelRatio: 1.5, minPixelRatio: 0.75, post: false, cloudDetail: true, vignette: 1,
    near: { size: 2048, radius: 46, kernel: 1, bias: -0.0002, normalBias: 0.05, lift: 150, depth: 320 },
  },
  high: {
    pixelRatio: 2, minPixelRatio: 0.85, post: true, cloudDetail: true, vignette: 1,
    near: { size: 2048, radius: 30, kernel: 2, bias: -0.00015, normalBias: 0.035, lift: 150, depth: 320 },
    far: { size: 2048, radius: 220, kernel: 2, bias: -0.0003, normalBias: 0.28, lift: 420, depth: 900, every: 2 },
  },
};

export function createGraphics(canvas, { isTouch = false, params = new URLSearchParams() } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.CustomToneMapping; // ACES + Tuscan grade (render-chunks.js)
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;  // filter chosen per light via shadow.radius
  renderer.autoClear = false;
  renderer.info.autoReset = false;               // reset once per frame in render(): totals include every pass

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 3000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // ---------- sky, sun, environment, haze ----------
  const sky = createSky({ sunDir: SUN_DIR, sunIlluminance: SUN_ILLUMINANCE });
  // A touch warmer than the physical afternoon sun.
  const sunColor = sky.sunColor.clone().multiply(new THREE.Color(1.05, 1.0, 0.93));
  sunColor.multiplyScalar(1 / (0.2126 * sunColor.r + 0.7152 * sunColor.g + 0.0722 * sunColor.b));
  installChunks({ sunDir: SUN_DIR, haze: sky.haze, sunColor });
  scene.add(sky.dome);
  scene.environment = sky.makeEnvironment(renderer);
  scene.environmentIntensity = 1.0;
  // Extra warm fill: light bounced from sunlit façades and ground into shaded streets.
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.95, 0.86, 0.74), new THREE.Color(0.9, 0.7, 0.48), 0.32);
  scene.add(hemi);
  // Aerial perspective (see render-chunks.js): fogNear = clear radius, fogFar = extinction length at y=0.
  scene.fog = new THREE.Fog(0xffffff, 60, 5200);

  // Sun = near cascade; sunFar = shadow-only far cascade (high only; intensity 0, never lights anything).
  const sun = new THREE.DirectionalLight(sunColor, SUN_ILLUMINANCE);
  sun.name = 'sun';
  sun.castShadow = true;
  scene.add(sun, sun.target);
  const sunFar = new THREE.DirectionalLight(0xffffff, 0);
  sunFar.name = 'sun-far-cascade';
  sunFar.castShadow = true;
  sunFar.shadow.autoUpdate = false;
  sunFar.target.name = 'sun-far-target';

  // Light-space basis of the shadow cameras (Matrix4.lookAt with up = +Y, z = SUN_DIR).
  const LX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const LY = new THREE.Vector3().crossVectors(SUN_DIR, LX);

  // ---------- quality ----------
  function detectQuality() {
    const qs = params.getAll('q').filter((q) => QUALITY[q]);
    if (qs.length) return qs[qs.length - 1]; // last one wins (tools may prepend their own ?q=)
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|softpipe|software/i.test(gpu)) return 'low';
    } catch (e) { /* ignore */ }
    return isTouch ? 'medium' : 'high';
  }
  let quality = detectQuality();
  let Q = QUALITY[quality];
  let maxPR = 1, pixelRatio = 1;
  let post = null;

  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;' +
    'background:radial-gradient(ellipse farthest-corner at 50% 46%, rgba(0,0,0,0) 58%, rgba(28,18,8,0.30) 100%)';
  canvas.after?.(vignette);

  function configureCascade(light, c) {
    const s = light.shadow;
    Object.assign(s.camera, { left: -c.radius, right: c.radius, top: c.radius, bottom: -c.radius, near: 1, far: c.depth });
    s.camera.updateProjectionMatrix();
    s.bias = c.bias; s.normalBias = c.normalBias; s.radius = c.kernel;
    if (s.mapSize.x !== c.size) {
      s.mapSize.set(c.size, c.size);
      s.map?.dispose(); s.map = null;
    }
    s.needsUpdate = true;
  }

  function setQuality(q) {
    if (!QUALITY[q]) return;
    const changed = q !== quality;
    quality = q; Q = QUALITY[q];
    configureCascade(sun, Q.near);
    if (Q.far) {
      configureCascade(sunFar, Q.far);
      if (!sunFar.parent) scene.add(sunFar, sunFar.target);
      farTick = 0;
    } else if (sunFar.parent) {
      scene.remove(sunFar, sunFar.target);
      sunFar.shadow.map?.dispose(); sunFar.shadow.map = null;
    }
    sky.setDetail({ clouds: true, detail: Q.cloudDetail });
    if (Q.post && !post) post = createPost(renderer);
    if (!Q.post && post) { post.dispose(); post = null; }
    vignette.style.opacity = String(Q.vignette);
    maxPR = Math.min(devicePixelRatio || 1, Q.pixelRatio);
    pixelRatio = maxPR;
    resize();
    if (changed && booted) compile().catch(() => {}); // warm the new program variants in the background
  }

  const resizeListeners = [];
  const _size = new THREE.Vector2();
  function resize() {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (post) { renderer.getDrawingBufferSize(_size); post.setSize(_size.x, _size.y); }
    for (const cb of resizeListeners) cb(camera.aspect);
  }
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));

  // ---------- shadows follow the player (texel-snapped in light space: no shimmering) ----------
  const _fwd = new THREE.Vector3(), _c = new THREE.Vector3();
  function placeCascade(light, x, y, z, c) {
    const texel = (2 * c.radius) / c.size;
    const px = x * LX.x + y * LX.y + z * LX.z, py = x * LY.x + y * LY.y + z * LY.z;
    const pz = x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z;
    const sx = Math.round(px / texel) * texel, sy = Math.round(py / texel) * texel;
    _c.set(0, 0, 0).addScaledVector(LX, sx).addScaledVector(LY, sy).addScaledVector(SUN_DIR, pz);
    light.target.position.copy(_c);
    light.position.copy(_c).addScaledVector(SUN_DIR, c.lift);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  }
  let farTick = 0;
  function updateSun(focus) {
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    const l = Math.hypot(_fwd.x, _fwd.z);
    if (l > 1e-4) _fwd.multiplyScalar(1 / l); else _fwd.set(0, 0, 0);
    const fy = focus.y || 0;
    // Shift each cascade ahead of the view so its texels land where the player looks.
    const n = Q.near;
    placeCascade(sun, focus.x + _fwd.x * n.radius * 0.35, fy, focus.z + _fwd.z * n.radius * 0.35, n);
    if (Q.far && farTick-- <= 0) {
      const f = Q.far;
      placeCascade(sunFar, focus.x + _fwd.x * f.radius * 0.3, fy, focus.z + _fwd.z * f.radius * 0.3, f);
      sunFar.shadow.needsUpdate = true;
      farTick = f.every - 1;
    }
  }

  // ---------- adaptive resolution: drop the pixel ratio when the frame rate sags, restore when fast ----------
  let frames = 0, fpsTime = 0;
  function adapt(dt) {
    frames++; fpsTime += dt;
    if (fpsTime < 2) return;
    const fps = frames / fpsTime;
    frames = 0; fpsTime = 0;
    if (fps < 45 && pixelRatio > Q.minPixelRatio) { pixelRatio = Math.max(Q.minPixelRatio, pixelRatio - 0.25); resize(); }
    else if (fps > 58 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.125); resize(); }
  }

  function update(dt, { adaptive = false } = {}) {
    sky.uniforms.time.value += dt;
    if (adaptive) adapt(dt);
  }

  // ---------- frame ----------
  const debug = params.has('debug') ? createDebugOverlay(renderer) : null;
  const timer = debug && debug.hasGpuTimer ? debug : null;
  function render(viewScene = null, viewCamera = null) {
    const t0 = debug ? performance.now() : 0;
    renderer.info.reset();
    if (post) {
      post.render(scene, camera, timer);
    } else {
      timer?.begin('world');
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
      timer?.end();
    }
    if (viewScene) {
      timer?.begin('view');
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
      timer?.end();
    }
    if (debug) {
      debug.frame(performance.now() - t0, renderer.info, () =>
        `${quality}  pr ${pixelRatio.toFixed(2)}  ${renderer.domElement.width}×${renderer.domElement.height}` +
        (post ? `  msaa ${post.samples}` : ''));
    }
  }

  function compile(extra = []) {
    const jobs = [];
    // The world is drawn into the HDR target on 'high' (linear, no tone mapping): compile that variant.
    if (post) renderer.setRenderTarget(post.target);
    jobs.push(renderer.compileAsync(scene, camera));
    renderer.setRenderTarget(null);
    for (const [s, c] of extra) jobs.push(renderer.compileAsync(s, c));
    if (post) { const [s, c] = post.compileTargets(); jobs.push(renderer.compileAsync(s, c)); }
    return Promise.all(jobs);
  }

  let booted = false;
  setQuality(quality);
  booted = true;
  console.log(`[render] quality ${quality}, sun ${SUN_DIR.toArray().map((v) => v.toFixed(2)).join(',')}` +
    (post ? `, post msaa ×${post.samples}` : ''));
  return {
    renderer, scene, camera, sun, sunDir: SUN_DIR,
    get quality() { return quality; }, setQuality,
    onResize(cb) { resizeListeners.push(cb); }, resize,
    updateSun, update, render, compile,
    // extras (optional use): sky uniforms (cloudCover, time…), haze (scene.fog), live post options
    sky: sky.uniforms, get post() { return post; }, qualities: Object.keys(QUALITY),
  };
}
