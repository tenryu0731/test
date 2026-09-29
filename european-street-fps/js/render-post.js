// High-quality post chain for render.js (quality 'high' only):
//   world → HDR half-float target (MSAA ×4 when available, resolved depth texture)
//   → GTAO at half resolution from depth only (no extra scene pass) → 4×4 depth-aware denoise
//   → subtle bloom restricted to sky pixels (sun disc / bright cloud rims), ¼ + ⅛ resolution
//   → final pass: AO (ambient-weighted, faded with distance) + bloom + CustomToneMapping grade + dither.
// The first-person viewmodel is drawn afterwards straight onto the canvas by render.js (same tone
// mapping / grade in-material), so world AO, haze and bloom never touch it.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOShader } from 'three/addons/shaders/GTAOShader.js';

const quadVertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

// 4×4 interleaved rotation noise for GTAO (the 4×4 denoise then averages every rotation exactly once).
function makeAoNoise() {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const jitter = [5, 12, 1, 8, 14, 3, 10, 7, 0, 9, 6, 15, 11, 4, 13, 2];
  const data = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const a = (bayer[i] / 16) * Math.PI * 2;
    data[i * 4] = (Math.cos(a) * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (Math.sin(a) * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = 127;
    data[i * 4 + 3] = ((jitter[i] + 0.5) / 16) * 255;
  }
  const t = new THREE.DataTexture(data, 4, 4);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function createPost(renderer) {
  const caps = renderer.capabilities;
  const samples = Math.min(4, caps.maxSamples || 0);
  const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, samples, depthTexture, depthBuffer: true, stencilBuffer: false,
  });
  sceneRT.texture.name = 'post.scene';
  const lin = { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const aoRT = new THREE.WebGLRenderTarget(1, 1, lin);
  const aoBlurRT = new THREE.WebGLRenderTarget(1, 1, lin);
  const hdr = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const bloomA = new THREE.WebGLRenderTarget(1, 1, hdr), bloomA2 = new THREE.WebGLRenderTarget(1, 1, hdr);
  const bloomB = new THREE.WebGLRenderTarget(1, 1, hdr), bloomB2 = new THREE.WebGLRenderTarget(1, 1, hdr);

  // ---- GTAO (depth-only normals)
  const gtao = new THREE.ShaderMaterial({
    name: 'post.gtao',
    defines: { ...GTAOShader.defines, NORMAL_VECTOR_TYPE: 0, SAMPLES: 12, PERSPECTIVE_CAMERA: 1 },
    uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
    vertexShader: GTAOShader.vertexShader, fragmentShader: GTAOShader.fragmentShader,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  gtao.uniforms.tDepth.value = depthTexture;
  gtao.uniforms.tNoise.value = makeAoNoise();
  gtao.uniforms.radius.value = 1.1;
  gtao.uniforms.thickness.value = 1.2;
  gtao.uniforms.distanceExponent.value = 1.6;
  gtao.uniforms.distanceFallOff.value = 1.0;
  gtao.uniforms.scale.value = 1.0;

  const aoBlur = new THREE.ShaderMaterial({
    name: 'post.aoBlur',
    uniforms: { tAO: { value: aoRT.texture }, tDepth: { value: depthTexture }, texel: { value: new THREE.Vector2() }, cameraNear: { value: 0.1 }, cameraFar: { value: 3000 } },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */`
      #include <packing>
      uniform sampler2D tAO, tDepth;
      uniform vec2 texel;
      uniform float cameraNear, cameraFar;
      varying vec2 vUv;
      float viewZ( vec2 uv ) { return -perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, cameraNear, cameraFar ); }
      void main() {
        float z0 = viewZ( vUv );
        float sum = 0.0, wsum = 0.0;
        for ( int j = -2; j < 2; j ++ ) {
          for ( int i = -2; i < 2; i ++ ) {
            vec2 uv = vUv + ( vec2( float( i ), float( j ) ) + 0.5 ) * texel;
            float w = exp( -abs( viewZ( uv ) - z0 ) / ( 0.04 * z0 + 0.05 ) );
            sum += texture2D( tAO, uv ).r * w; wsum += w;
          }
        }
        gl_FragColor = vec4( vec3( sum / max( wsum, 1e-4 ) ), 1.0 );
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });

  // ---- bloom (sky only)
  const prefilter = new THREE.ShaderMaterial({
    name: 'post.bloomPrefilter',
    uniforms: { tColor: { value: sceneRT.texture }, tDepth: { value: depthTexture }, texel: { value: new THREE.Vector2() }, threshold: { value: 2.2 } },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor, tDepth;
      uniform vec2 texel;
      uniform float threshold;
      varying vec2 vUv;
      vec3 tap( vec2 uv ) {
        vec3 c = min( texture2D( tColor, uv ).rgb, vec3( 60.0 ) );
        float sky = step( 0.9999999, texture2D( tDepth, uv ).x );
        float l = max( c.r, max( c.g, c.b ) );
        float k = max( l - threshold, 0.0 ) / max( l, 1e-4 );
        return c * k * sky;
      }
      void main() {
        vec3 c = tap( vUv + vec2( -1.0, -1.0 ) * texel ) + tap( vUv + vec2( 1.0, -1.0 ) * texel )
               + tap( vUv + vec2( -1.0, 1.0 ) * texel ) + tap( vUv + vec2( 1.0, 1.0 ) * texel );
        gl_FragColor = vec4( c * 0.25, 1.0 );
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const blur = new THREE.ShaderMaterial({
    name: 'post.blur',
    uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() } },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc;
      uniform vec2 dir;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D( tSrc, vUv ).rgb * 0.2270270270;
        c += ( texture2D( tSrc, vUv + dir * 1.3846153846 ).rgb + texture2D( tSrc, vUv - dir * 1.3846153846 ).rgb ) * 0.3162162162;
        c += ( texture2D( tSrc, vUv + dir * 3.2307692308 ).rgb + texture2D( tSrc, vUv - dir * 3.2307692308 ).rgb ) * 0.0702702703;
        gl_FragColor = vec4( c, 1.0 );
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const copy = new THREE.ShaderMaterial({
    name: 'post.down',
    uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D( tSrc, vUv + vec2( -0.5, -0.5 ) * texel ).rgb + texture2D( tSrc, vUv + vec2( 0.5, -0.5 ) * texel ).rgb
               + texture2D( tSrc, vUv + vec2( -0.5, 0.5 ) * texel ).rgb + texture2D( tSrc, vUv + vec2( 0.5, 0.5 ) * texel ).rgb;
        gl_FragColor = vec4( c * 0.25, 1.0 );
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });

  // ---- final composite → canvas (tone mapping + grade come from the renderer's CustomToneMapping)
  const composite = new THREE.ShaderMaterial({
    name: 'post.composite',
    uniforms: {
      tColor: { value: sceneRT.texture }, tAO: { value: aoBlurRT.texture }, tDepth: { value: depthTexture },
      tBloomA: { value: bloomA.texture }, tBloomB: { value: bloomB.texture },
      aoStrength: { value: 0.85 }, bloomStrength: { value: 0.07 }, cameraNear: { value: 0.1 }, cameraFar: { value: 3000 },
    },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */`
      #include <packing>
      uniform sampler2D tColor, tAO, tDepth, tBloomA, tBloomB;
      uniform float aoStrength, bloomStrength, cameraNear, cameraFar;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D( tColor, vUv ).rgb;
        float z = -perspectiveDepthToViewZ( texture2D( tDepth, vUv ).x, cameraNear, cameraFar );
        float ao = texture2D( tAO, vUv ).r;
        // AO darkens mostly the ambient-lit (darker) pixels: brightly sunlit surfaces keep most of their light.
        float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        float w = aoStrength * ( 1.0 - 0.65 * smoothstep( 0.15, 1.1, l ) ) * ( 1.0 - smoothstep( 60.0, 160.0, z ) );
        c *= mix( 1.0, ao, w );
        c += ( texture2D( tBloomA, vUv ).rgb * 0.6 + texture2D( tBloomB, vUv ).rgb * 0.4 ) * bloomStrength;
        gl_FragColor = vec4( c, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });

  const quad = new FullScreenQuad(null);
  const white = new THREE.Color(1, 1, 1), _clear = new THREE.Color();
  let W = 1, H = 1;
  const options = { ao: true, bloom: true };

  function setSize(w, h) {
    W = Math.max(1, w | 0); H = Math.max(1, h | 0);
    sceneRT.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    aoRT.setSize(hw, hh); aoBlurRT.setSize(hw, hh);
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2), ew = Math.max(1, W >> 3), eh = Math.max(1, H >> 3);
    bloomA.setSize(qw, qh); bloomA2.setSize(qw, qh); bloomB.setSize(ew, eh); bloomB2.setSize(ew, eh);
    gtao.uniforms.resolution.value.set(hw, hh);
    aoBlur.uniforms.texel.value.set(1 / hw, 1 / hh);
    prefilter.uniforms.texel.value.set(1 / W, 1 / H);
  }

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }

  function render(scene, camera, timer = null) {
    timer?.begin('world');
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    timer?.end();
    timer?.begin('post');

    const near = camera.near, far = camera.far;
    if (options.ao) {
      const u = gtao.uniforms;
      u.cameraNear.value = near; u.cameraFar.value = far;
      u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      renderer.getClearColor(_clear); const alpha = renderer.getClearAlpha();
      renderer.setClearColor(white, 1);
      renderer.setRenderTarget(aoRT); renderer.clear(true, false, false);
      renderer.setClearColor(_clear, alpha);
      pass(gtao, aoRT);
      aoBlur.uniforms.cameraNear.value = near; aoBlur.uniforms.cameraFar.value = far;
      pass(aoBlur, aoBlurRT);
      composite.uniforms.tAO.value = aoBlurRT.texture;
    }
    composite.uniforms.aoStrength.value = options.ao ? 0.85 : 0;
    if (options.bloom) {
      pass(prefilter, bloomA);
      blur.uniforms.tSrc.value = bloomA.texture; blur.uniforms.dir.value.set(1 / bloomA.width, 0); pass(blur, bloomA2);
      blur.uniforms.tSrc.value = bloomA2.texture; blur.uniforms.dir.value.set(0, 1 / bloomA.height); pass(blur, bloomA);
      copy.uniforms.tSrc.value = bloomA.texture; copy.uniforms.texel.value.set(1 / bloomA.width, 1 / bloomA.height); pass(copy, bloomB);
      blur.uniforms.tSrc.value = bloomB.texture; blur.uniforms.dir.value.set(1 / bloomB.width, 0); pass(blur, bloomB2);
      blur.uniforms.tSrc.value = bloomB2.texture; blur.uniforms.dir.value.set(0, 1 / bloomB.height); pass(blur, bloomB);
    }
    composite.uniforms.bloomStrength.value = options.bloom ? 0.07 : 0;
    composite.uniforms.cameraNear.value = near; composite.uniforms.cameraFar.value = far;
    pass(composite, null);
    timer?.end();
  }

  // For compile(): a scene holding one quad per material, so every program is built up front.
  function compileTargets() {
    const s = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    for (const m of [gtao, aoBlur, prefilter, blur, copy, composite]) s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m));
    return [s, cam];
  }

  function dispose() {
    for (const t of [sceneRT, aoRT, aoBlurRT, bloomA, bloomA2, bloomB, bloomB2]) t.dispose();
    depthTexture.dispose();
  }

  return { setSize, render, options, samples, compileTargets, dispose, target: sceneRT, get size() { return [W, H]; } };
}
