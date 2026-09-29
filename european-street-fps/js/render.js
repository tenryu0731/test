// Rendering pipeline: renderer, camera, sky, sun + shadows, image-based light, haze, quality
// presets and adaptive resolution. The game (main.js) only talks to the object returned here.
import * as THREE from 'three';

const QUALITY = {
  low: { pixelRatio: 1, shadowMap: 1024, shadowRadius: 40 },
  medium: { pixelRatio: 1.5, shadowMap: 2048, shadowRadius: 45 },
  high: { pixelRatio: 2, shadowMap: 4096, shadowRadius: 55 },
};

export function createGraphics(canvas, { isTouch = false, params = new URLSearchParams() } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 3000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // ---------- sky, sun, environment ----------
  const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(215));
  const SKY_TOP = new THREE.Color(0x3f7fd0), SKY_HORIZON = new THREE.Color(0xc9dcec), SKY_GROUND = new THREE.Color(0xb7a58c);
  function makeSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, ground: { value: SKY_GROUND }, sunDir: { value: SUN_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top, horizon, ground, sunDir; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += vec3(1.0,0.93,0.8) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.12);
          float cl = smoothstep(0.55, 1.0, sin(d.x*9.0 + d.z*3.0) * sin(d.z*7.0 - d.x*2.0 + 1.3)) * smoothstep(0.05, 0.35, h) * 0.18;
          c = mix(c, vec3(1.0), cl);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    return sky;
  }
  const sky = makeSky();
  scene.add(sky);
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSky());
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();
  }
  const hemi = new THREE.HemisphereLight(0xdde6f0, 0xb49a78, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9cc, 3.0);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  // Light aerial haze for the distant countryside only.
  scene.fog = new THREE.Fog(SKY_HORIZON.clone().lerp(new THREE.Color(0xffffff), 0.1), 250, 2200);

  // ---------- quality ----------
  let quality = params.get('q') || (isTouch ? 'medium' : 'high');
  if (!QUALITY[quality]) quality = 'medium';
  let shadowR = QUALITY[quality].shadowRadius;
  let maxPR = Math.min(devicePixelRatio, QUALITY[quality].pixelRatio);
  let pixelRatio = maxPR;
  function setQuality(q) {
    if (!QUALITY[q]) return;
    quality = q;
    const Q = QUALITY[q];
    shadowR = Q.shadowRadius;
    Object.assign(sun.shadow.camera, { left: -shadowR, right: shadowR, top: shadowR, bottom: -shadowR, near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== Q.shadowMap) {
      sun.shadow.mapSize.setScalar(Q.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    maxPR = Math.min(devicePixelRatio, Q.pixelRatio);
    pixelRatio = maxPR;
    resize();
  }

  const resizeListeners = [];
  function resize() {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    for (const cb of resizeListeners) cb(camera.aspect);
  }
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));

  function updateSun(focus) {
    // Shadow frustum follows the focus point, snapped to texels to avoid shimmering.
    const texel = (shadowR * 2) / sun.shadow.mapSize.x;
    const cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel, cy = focus.y || 0;
    sun.target.position.set(cx, cy, cz);
    sun.position.set(cx, cy, cz).addScaledVector(SUN_DIR, 200);
    sun.target.updateMatrixWorld();
  }

  // Adaptive resolution: drop the pixel ratio when the frame rate sags (phones), restore when fast.
  let frames = 0, fpsTime = 0;
  function adapt(dt) {
    frames++; fpsTime += dt;
    if (fpsTime < 2) return;
    const fps = frames / fpsTime;
    frames = 0; fpsTime = 0;
    if (fps < 45 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
    else if (fps > 58 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.125); resize(); }
  }

  function update(dt, { adaptive = false } = {}) {
    sky.position.copy(camera.position);
    if (adaptive) adapt(dt);
  }

  function render(viewScene = null, viewCamera = null) {
    renderer.clear();
    renderer.render(scene, camera);
    if (viewScene) {
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
    }
  }

  function compile(extra = []) {
    return Promise.all([renderer.compileAsync(scene, camera), ...extra.map(([s, c]) => renderer.compileAsync(s, c))]);
  }

  setQuality(quality);
  return {
    renderer, scene, camera, sun, sunDir: SUN_DIR,
    get quality() { return quality; }, setQuality,
    onResize(cb) { resizeListeners.push(cb); }, resize,
    updateSun, update, render, compile,
  };
}
