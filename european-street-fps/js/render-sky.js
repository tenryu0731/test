// Physically based sky for render.js.
// - A single-scattering atmosphere (Rayleigh + Mie + ozone, planet-scale geometry) is integrated on the CPU
//   once at boot into a small sky-view LUT (relative sun azimuth × elevation, sqrt-warped towards the
//   horizon) — the sun is static, so the per-frame sky costs one texture lookup per pixel.
// - The sky dome adds the sun disc + aureole and two procedural cloud layers (soft cumulus + cirrus,
//   slowly drifting, thinned around the sun) from a tileable noise texture generated here.
// - The same shader in "environment" mode (no sun disc, warm ground + town bounce below/at the horizon)
//   feeds PMREM for image-based lighting, and the CPU model gives the sun colour, the hemisphere fill and
//   the aerial-perspective haze colours, so materials, haze and sky all agree.
import * as THREE from 'three';

// ---------------------------------------------------------------- atmosphere model (CPU)
const RE = 6360e3, RA = 6420e3, HR = 8000, HM = 1200;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];     // Rayleigh scattering at sea level (1/m)
const OZ = [0.650e-6, 1.881e-6, 0.085e-6];     // ozone absorption
const MIE_S = 3.996e-6, MIE_E = 4.40e-6;       // Mie scattering / extinction (clear air)

function raySphere(oy, dy, R) {
  // origin (0, oy, 0) relative to the planet centre, unit direction with vertical component dy
  const b = oy * dy, c = oy * oy - R * R, d = b * b - c;
  if (d < 0) return [-1, -1];
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

export function createAtmosphere({ sunDir, turbidity = 2.6, altitude = 350, mieG = 0.8 }) {
  const mieS = MIE_S * turbidity, mieE = MIE_E * turbidity;
  const ext = (dr, dm, dO, out) => {
    out[0] = BR[0] * dr + mieE * dm + OZ[0] * dO;
    out[1] = BR[1] * dr + mieE * dm + OZ[1] * dO;
    out[2] = BR[2] * dr + mieE * dm + OZ[2] * dO;
  };
  const ozone = (h) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

  // Optical depth from a point (height h above ground, radial frame) towards the sun.
  // Uses the fact that the sun ray only depends on (h, cos of zenith angle).
  function sunOpticalDepth(px, py, pz, out) {
    const r = Math.hypot(px, py, pz);
    const mu = (px * sunDir.x + py * sunDir.y + pz * sunDir.z) / r;
    const g = raySphere(r, mu, RE);
    if (g[0] > 0) { out[0] = out[1] = out[2] = 1e9; return; } // below the horizon
    const tTop = raySphere(r, mu, RA)[1];
    const N = 10;
    let dr = 0, dm = 0, dO = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      const t1 = tTop * ((i + 1) / N) ** 2, tm = (prev + t1) * 0.5, dt = t1 - prev; prev = t1;
      const h = Math.sqrt(r * r + tm * tm + 2 * r * mu * tm) - RE;
      dr += Math.exp(-h / HR) * dt; dm += Math.exp(-h / HM) * dt; dO += ozone(h) * dt;
    }
    ext(dr, dm, dO, out);
  }

  const ALB = [0.26, 0.21, 0.15]; // distant Tuscan land (fields, woods, stone), for rays that hit the ground
  const _od = [0, 0, 0], _sod = [0, 0, 0];
  // Radiance for a unit sun (irradiance 1 at the top of the atmosphere), direction d from the camera.
  function radiance(dx, dy, dz, out) {
    const oy = RE + altitude;
    const gnd = raySphere(oy, dy, RE);
    const hitGround = gnd[0] > 0;
    const tMax = hitGround ? gnd[0] : raySphere(oy, dy, RA)[1];
    const N = 28;
    let sr0 = 0, sr1 = 0, sr2 = 0, sm0 = 0, sm1 = 0, sm2 = 0;
    let odr = 0, odm = 0, odo = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      const t1 = tMax * ((i + 1) / N) ** 2, tm = (prev + t1) * 0.5, dt = t1 - prev; prev = t1;
      const px = dx * tm, py = oy + dy * tm, pz = dz * tm;
      const h = Math.hypot(px, py, pz) - RE;
      const dr = Math.exp(-h / HR), dm = Math.exp(-h / HM), dO = ozone(h);
      odr += dr * dt * 0.5; odm += dm * dt * 0.5; odo += dO * dt * 0.5; // half step: transmittance to the sample centre
      ext(odr, odm, odo, _od);
      sunOpticalDepth(px, py, pz, _sod);
      const t0 = Math.exp(-(_od[0] + _sod[0])), t1r = Math.exp(-(_od[1] + _sod[1])), t2 = Math.exp(-(_od[2] + _sod[2]));
      sr0 += dr * t0 * dt; sr1 += dr * t1r * dt; sr2 += dr * t2 * dt;
      sm0 += dm * t0 * dt; sm1 += dm * t1r * dt; sm2 += dm * t2 * dt;
      odr += dr * dt * 0.5; odm += dm * dt * 0.5; odo += dO * dt * 0.5;
    }
    const mu = dx * sunDir.x + dy * sunDir.y + dz * sunDir.z;
    const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
    const g = mieG, pM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    // Crude multiple-scattering term: isotropic re-scatter of the single-scattered light, brightens and
    // desaturates the lower sky like the real thing (keeps the horizon from turning grey-blue).
    const ms = 0.32 / (4 * Math.PI);
    out[0] = BR[0] * sr0 * (pR + ms) + mieS * sm0 * (pM + ms);
    out[1] = BR[1] * sr1 * (pR + ms) + mieS * sm1 * (pM + ms);
    out[2] = BR[2] * sr2 * (pR + ms) + mieS * sm2 * (pM + ms);
    if (hitGround) {
      // Lambertian ground lit by the attenuated sun (+ a sky term), seen through the atmosphere.
      ext(odr, odm, odo, _od);
      const gx = dx * tMax, gy = oy + dy * tMax, gz = dz * tMax;
      const gr = Math.hypot(gx, gy, gz);
      const cosS = Math.max(0, (gx * sunDir.x + gy * sunDir.y + gz * sunDir.z) / gr);
      sunOpticalDepth(gx, gy, gz, _sod);
      for (let k = 0; k < 3; k++) {
        const E = Math.exp(-_sod[k]) * cosS * 1.25;
        out[k] += ALB[k] * E / Math.PI * Math.exp(-_od[k]);
      }
    }
    return out;
  }

  // Sun transmittance at the camera (colour of the direct light).
  const sunT = [0, 0, 0];
  sunOpticalDepth(0, RE + altitude, 0, _sod);
  for (let k = 0; k < 3; k++) sunT[k] = Math.exp(-_sod[k]);

  // ---- sky-view LUT: u = relative azimuth to the sun / PI, v = 0.5 ± 0.5 sqrt(|elevation| / 90°)
  const W = 32, H = 64;
  const data = new Float32Array(W * H * 4);
  const sunH = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  const tmp = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1), s = v * 2 - 1;
    const el = Math.sign(s) * s * s * Math.PI / 2;
    const ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i < W; i++) {
      const az = i / (W - 1) * Math.PI;
      // horizontal direction at angle az from the sun's azimuth
      const hx = sunH.x * Math.cos(az) - sunH.y * Math.sin(az), hz = sunH.x * Math.sin(az) + sunH.y * Math.cos(az);
      radiance(hx * ce, se, hz * ce, tmp);
      const o = (j * W + i) * 4;
      data[o] = tmp[0]; data[o + 1] = tmp[1]; data[o + 2] = tmp[2]; data[o + 3] = 1;
    }
  }
  return { data, W, H, sunT, sunH, radiance, lookup: (az, el, out) => lutLookup(data, W, H, az, el, out) };
}

// Bilinear LUT lookup by relative sun azimuth (radians) and elevation (radians).
function lutLookup(data, W, H, az, el, out) {
  const u = Math.min(1, Math.max(0, Math.abs(az) / Math.PI)) * (W - 1);
  const v = (0.5 + 0.5 * Math.sign(el) * Math.sqrt(Math.min(1, Math.abs(el) / (Math.PI / 2)))) * (H - 1);
  const i0 = Math.min(W - 2, Math.floor(u)), j0 = Math.min(H - 2, Math.floor(v));
  const fu = u - i0, fv = v - j0;
  const at = (i, j, k) => data[(j * W + i) * 4 + k];
  for (let k = 0; k < 3; k++) {
    out[k] = (at(i0, j0, k) * (1 - fu) + at(i0 + 1, j0, k) * fu) * (1 - fv) + (at(i0, j0 + 1, k) * (1 - fu) + at(i0 + 1, j0 + 1, k) * fu) * fv;
  }
  return out;
}

// ---------------------------------------------------------------- tileable cloud noise
function makeNoiseTexture(size = 256) {
  // Tileable gradient noise; each channel is an fBm with a different base frequency / character.
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const grads = new Float32Array(512 * 2);
  for (let i = 0; i < 512; i++) { const a = rnd() * Math.PI * 2; grads[i * 2] = Math.cos(a); grads[i * 2 + 1] = Math.sin(a); }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y, period, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const g = (ix, iy, dx, dy) => {
      const h = perm[(perm[((ix % period) + period) % period + seed] + ((iy % period) + period) % period) & 511] & 511;
      return grads[h * 2] * dx + grads[h * 2 + 1] * dy;
    };
    const u = fade(fx), v = fade(fy);
    const a = g(xi, yi, fx, fy), b = g(xi + 1, yi, fx - 1, fy), c = g(xi, yi + 1, fx, fy - 1), d = g(xi + 1, yi + 1, fx - 1, fy - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // ~[-0.7, 0.7]
  }
  function fbm(x, y, base, oct, seed, billow) {
    let sum = 0, amp = 0.5, norm = 0, f = base;
    for (let o = 0; o < oct; o++) {
      let n = noise(x * f, y * f, f, (seed + o * 31) & 255);
      if (billow) n = 0.7 - Math.abs(n) * 2; // puffy
      sum += n * amp; norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, o = (y * size + x) * 4;
      px[o] = Math.max(0, Math.min(255, (fbm(u, v, 4, 5, 11, false) * 0.9 + 0.5) * 255));
      px[o + 1] = Math.max(0, Math.min(255, (fbm(u, v, 8, 4, 57, true) * 0.55 + 0.5) * 255));
      px[o + 2] = Math.max(0, Math.min(255, (fbm(u, v, 16, 3, 101, true) * 0.55 + 0.5) * 255));
      px[o + 3] = Math.max(0, Math.min(255, (fbm(u, v, 4, 5, 173, false) * 0.9 + 0.5) * 255));
    }
  }
  const tex = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- sky dome shader
const skyVertex = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Direction-only transform: the dome is always centred on the camera and drawn at the far plane.
    vec4 p = projectionMatrix * vec4( ( viewMatrix * vec4( position, 0.0 ) ).xyz, 1.0 );
    gl_Position = p.xyww;
  }`;

const skyFragment = /* glsl */`
  uniform sampler2D tSky;
  uniform sampler2D tNoise;
  uniform vec3 sunDir;
  uniform vec2 sunH;
  uniform vec3 sunRadiance;     // disc radiance
  uniform vec3 sunLight;        // illuminance colour reaching the clouds / ground
  uniform vec3 cloudAmbient;    // sky light on cloud undersides
  uniform vec3 groundBounce;    // env only: warm light bouncing off sunlit ground / walls
  uniform float skyGain;
  uniform float cloudCover;
  uniform float time;
  varying vec3 vDir;

  #define PI 3.141592653589793

  vec3 skyLut( vec3 d ) {
    float el = asin( clamp( d.y, -1.0, 1.0 ) );
    float v = 0.5 + 0.5 * sign( el ) * sqrt( abs( el ) / ( 0.5 * PI ) );
    vec2 h = d.xz;
    float hl = length( h );
    float ca = hl > 1e-5 ? dot( h / hl, sunH ) : 1.0;
    float u = acos( clamp( ca, -1.0, 1.0 ) ) / PI;
    vec2 uv = vec2( ( u * 31.0 + 0.5 ) / 32.0, ( v * 63.0 + 0.5 ) / 64.0 );
    return texture2D( tSky, uv ).rgb * skyGain;
  }

  float hg( float c, float g ) { float g2 = g * g; return ( 1.0 - g2 ) / ( 4.0 * PI * pow( 1.0 + g2 - 2.0 * g * c, 1.5 ) ); }

  void main() {
    vec3 d = normalize( vDir );
    vec3 col = skyLut( d );
    float cs = dot( d, sunDir );

    #ifdef CLOUDS
    if ( d.y > 0.0 ) {
      // ---- cumulus layer (~1.6 km up): drifting fBm, thinned around the sun, lit from the sun side
      float t = 1600.0 / max( d.y, 0.02 );
      vec2 p = d.xz * t;
      vec2 wind = vec2( 1.0, 0.35 ) * time * 6.0;
      vec2 uv = ( p + wind ) / 9000.0;
      float base = texture2D( tNoise, uv ).r;
      float puff = texture2D( tNoise, uv * 2.3 + vec2( 0.31, 0.17 ) ).g;
      #ifdef CLOUD_DETAIL
      float det = texture2D( tNoise, uv * 6.1 + vec2( 0.53, 0.71 ) + wind / 60000.0 ).b;
      #else
      float det = 0.5;
      #endif
      float n = base * 0.55 + puff * 0.33 + det * 0.12;
      n = n + ( puff - 0.5 ) * 0.12 * smoothstep( 0.35, 0.7, base );
      float cover = cloudCover * ( 1.0 - 0.9 * smoothstep( 0.93, 0.992, cs ) );   // keep the sun clear
      float thr = 1.0 - cover;
      float dens = smoothstep( thr, thr + 0.16, n );
      // self-shadowing: density a little towards the sun
      vec2 uvs = uv + sunH * 0.018;
      float ns = texture2D( tNoise, uvs ).r * 0.62 + texture2D( tNoise, uvs * 2.3 + vec2( 0.31, 0.17 ) ).g * 0.28 + det * 0.10;
      float occl = smoothstep( thr, thr + 0.35, ns );
      float core = smoothstep( thr + 0.08, thr + 0.45, n );
      float lit = clamp( 1.0 - 0.6 * occl - 0.45 * core, 0.0, 1.0 );
      vec3 cl = cloudAmbient + sunLight * ( 0.20 + 0.55 * lit ) + sunLight * hg( cs, 0.6 ) * 2.2 * ( 1.0 - core );
      // aerial perspective on far clouds + fade at the horizon
      float far = 1.0 - exp( -t / 38000.0 );
      cl = mix( cl, col, far * 0.85 );
      float a = dens * smoothstep( 0.02, 0.12, d.y ) * 0.92;
      col = mix( col, cl, a );

      // ---- cirrus (~8 km): long thin streaks, faint
      float t2 = 8000.0 / max( d.y, 0.02 );
      vec2 p2 = d.xz * t2 + wind * 2.5;
      vec2 q = vec2( dot( p2, vec2( 0.8, 0.6 ) ), dot( p2, vec2( -0.6, 0.8 ) ) ) / vec2( 90000.0, 22000.0 );
      float ci = texture2D( tNoise, q ).a * 0.7 + texture2D( tNoise, q * 3.1 + 0.4 ).a * 0.3;
      float cir = smoothstep( 0.56, 0.8, ci ) * smoothstep( 0.03, 0.25, d.y ) * 0.32 * ( 1.0 - 0.8 * smoothstep( 0.95, 0.995, cs ) );
      col = mix( col, ( sunLight * 0.62 + cloudAmbient * 1.2 ) * ( 1.0 + hg( cs, 0.7 ) * 3.0 ), cir * ( 1.0 - far ) );
    }
    #endif

    #ifndef ENV
    // Below the horizon only the world beyond the map edge shows: make it hazy distant land that melts
    // into the horizon colour instead of the LUT's brown ground.
    if ( d.y < 0.0 ) {
      vec3 hz = skyLut( normalize( vec3( d.x, 0.012, d.z ) ) );
      vec3 land = hz * vec3( 0.78, 0.84, 0.86 );
      col = mix( hz, land, smoothstep( 0.0, -0.3, d.y ) );
    }
    #endif
    #ifdef ENV
    // Environment for image-based light: warm bounce from sunlit ground below, and a warm band at the
    // horizon for the sunlit façades / hills that surround every street and field.
    // desaturate the sky dome for diffuse light: the blue is partly replaced by light bounced off the town
    float sl = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    col = mix( col, vec3( sl ) * vec3( 1.08, 1.0, 0.9 ), 0.35 );
    float band = exp( -abs( d.y + 0.05 ) * 5.0 );
    col = mix( col, groundBounce * 1.25, band * 0.55 );
    if ( d.y < 0.0 ) col = mix( col, groundBounce, smoothstep( 0.0, -0.18, d.y ) );
    #else
    // Sun disc (limb darkened) + a tight aureole the sky LUT is too coarse for.
    float sd = smoothstep( 0.99996, 0.99999, cs );
    float r = clamp( ( 1.0 - cs ) / ( 1.0 - 0.99996 ), 0.0, 1.0 );
    col += sunRadiance * sd * ( 1.0 - 0.45 * r );
    col += sunLight * hg( cs, 0.93 ) * 0.035;
    #endif

    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #ifndef ENV
    // tiny dither against banding in the 8-bit gradient
    gl_FragColor.rgb += ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;
    #endif
  }`;

export function createSky({ sunDir, sunIlluminance = 3.0, turbidity = 2.6, skyGain = 1.9, zenithBoost = 1.8 }) {
  const t0 = performance.now();
  const atm = createAtmosphere({ sunDir, turbidity });
  // Scene units: the direct sun at the ground has illuminance `sunIlluminance`; the top-of-atmosphere
  // irradiance follows from the (luminance of the) sun transmittance. Single scattering alone is too
  // dim and too grey-green in the upper sky next to a sunlit wall, so the LUT gets an artistic gain
  // (stronger towards the zenith) and a slight blue tint above the horizon; everything below (haze
  // colours, IBL, clouds) is derived from the adjusted LUT so it all stays consistent.
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const E0 = sunIlluminance / lum(atm.sunT);
  const { W, H } = atm;
  const adj = new Float32Array(atm.data.length);
  const TINT = [0.95, 1.0, 1.1];
  for (let j = 0; j < H; j++) {
    const s = (j / (H - 1)) * 2 - 1, elDeg = Math.sign(s) * s * s * 90;
    const g = E0 * skyGain * (1 + (zenithBoost - 1) * Math.sqrt(Math.max(0, elDeg) / 90));
    const up = THREE.MathUtils.smoothstep(elDeg, -2, 1);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      for (let k = 0; k < 3; k++) adj[o + k] = atm.data[o + k] * g * (1 + (TINT[k] - 1) * up);
      adj[o + 3] = 1;
    }
  }
  const half = new Uint16Array(W * H * 4);
  for (let i = 0; i < adj.length; i++) half[i] = THREE.DataUtils.toHalfFloat(adj[i]);
  const lutTex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  lutTex.magFilter = lutTex.minFilter = THREE.LinearFilter;
  lutTex.wrapS = lutTex.wrapT = THREE.ClampToEdgeWrapping;
  lutTex.needsUpdate = true;
  const noiseTex = makeNoiseTexture(256);

  const sunColor = new THREE.Color(atm.sunT[0], atm.sunT[1], atm.sunT[2]).multiplyScalar(1 / lum(atm.sunT));
  const skyC = (az, el) => { const c = lutLookup(adj, W, H, az, el, [0, 0, 0]); return new THREE.Color(c[0], c[1], c[2]); };
  // Cosine-weighted sky irradiance on a horizontal surface.
  const irradiance = new THREE.Color(0, 0, 0);
  {
    const n = 24, c = [0, 0, 0];
    for (let j = 0; j < n; j++) {
      const el = (j + 0.5) / n * Math.PI / 2, w = Math.sin(el) * Math.cos(el) * (Math.PI / 2 / n) * (2 * Math.PI / (2 * n));
      for (let i = 0; i < 2 * n; i++) {
        lutLookup(adj, W, H, ((i + 0.5) / (2 * n)) * 2 * Math.PI - Math.PI, el, c);
        irradiance.r += c[0] * w; irradiance.g += c[1] * w; irradiance.b += c[2] * w;
      }
    }
  }
  const sky = skyC;
  const zenith = sky(0, Math.PI / 2);
  // Aerial-perspective colours: the sky just above the horizon towards / across / away from the sun.
  const el = THREE.MathUtils.degToRad(1.5);
  const haze = { toward: sky(0, el), side: sky(Math.PI / 2, el), away: sky(Math.PI, el) };
  // Warm bounce from the sunlit Tuscan ground and façades (albedo ~ ochre / travertine / terracotta).
  const sunOnGround = sunIlluminance * Math.max(0.2, sunDir.y);
  const groundBounce = new THREE.Color(0.36, 0.28, 0.19).multiply(sunColor).multiplyScalar((sunOnGround + irradiance.g) / Math.PI);

  const uniforms = {
    tSky: { value: lutTex },
    tNoise: { value: noiseTex },
    sunDir: { value: sunDir.clone() },
    sunH: { value: atm.sunH.clone() },
    sunRadiance: { value: sunColor.clone().multiplyScalar(60) },
    sunLight: { value: sunColor.clone().multiplyScalar(sunIlluminance / Math.PI * 1.1) },
    cloudAmbient: { value: zenith.clone().lerp(new THREE.Color(1, 1, 1).multiplyScalar(zenith.g), 0.45).multiplyScalar(1.6) },
    groundBounce: { value: groundBounce },
    skyGain: { value: 1.0 },          // extra runtime multiplier (1 = as computed)
    cloudCover: { value: 0.40 },
    time: { value: 0 },
  };
  function material({ env = false, clouds = true, detail = true } = {}) {
    const defines = {};
    if (env) defines.ENV = '';
    if (clouds) defines.CLOUDS = '';
    if (detail) defines.CLOUD_DETAIL = '';
    return new THREE.ShaderMaterial({
      name: env ? 'SkyEnv' : 'Sky',
      uniforms, defines, vertexShader: skyVertex, fragmentShader: skyFragment,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
  }
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const dome = new THREE.Mesh(geo, material());
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = 1e6; // after all opaque geometry: early-z skips every covered pixel
  dome.castShadow = dome.receiveShadow = false;
  dome.matrixAutoUpdate = false;

  function setDetail({ clouds = true, detail = true }) {
    const m = dome.material;
    const want = (k, on) => { if (on !== (k in m.defines)) { if (on) m.defines[k] = ''; else delete m.defines[k]; m.needsUpdate = true; } };
    want('CLOUDS', clouds); want('CLOUD_DETAIL', detail);
  }

  // Image-based light: PMREM of the sky in environment mode (clouds frozen, no disc).
  function makeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const m = material({ env: true, clouds: true, detail: false });
    const envDome = new THREE.Mesh(geo, m);
    envDome.frustumCulled = false;
    envScene.add(envDome);
    const rt = pmrem.fromScene(envScene, 0.035, 0.1, 100);
    pmrem.dispose();
    m.dispose();
    return rt.texture;
  }

  console.log(`[render] sky model ${(performance.now() - t0).toFixed(0)} ms`);
  return { dome, uniforms, sunColor, haze, zenith, irradiance, groundBounce, makeEnvironment, setDetail, atm, E0 };
}
