// Global shader-chunk overrides used by render.js. They apply to every built-in material (and to custom
// ShaderMaterials that include the standard chunks), so other modules get the look for free:
//  - aerial perspective: height + distance based haze tinted by the sky (fog chunks),
//  - the sun's cascaded shadows (lights_fragment_begin) and a cheaper bilinear PCF (shadowmap chunk),
//  - the Tuscan colour grade inside CustomToneMapping (so direct renders and the post chain match).
// Must run before any program is compiled (createGraphics is called before the world is built).
import * as THREE from 'three';

const v3 = (c) => `vec3( ${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)} )`;
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export function installChunks({ sunDir, haze, sunColor, sunInscatter = 0.35, falloff = 1 / 280, farStart = 1150, farEnd = 2900, farExtra = 0.85 }) {
  const C = THREE.ShaderChunk;

  // ------------------------------------------------------------------ aerial perspective
  // fogNear = distance before which the air is perfectly clear, fogFar = extinction length (1/sigma)
  // at y = 0, fogColor = multiplier on the sky-derived in-scatter colour. Orthographic renders (e.g. the
  // top-down map) are never hazed.
  const sunH = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying vec3 vFogRay;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying vec3 vFogRay;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	vec4 aerialPerspective( vec3 ray ) {
		float d = length( ray );
		#ifdef FOG_EXP2
		float start = 0.0, sigma = fogDensity;
		#else
		float start = fogNear, sigma = 1.0 / max( fogFar, 1.0 );
		#endif
		float dd = max( d - start, 0.0 );
		vec3 dir = ray / max( d, 1e-4 );
		// exponential height falloff, integrated along the hazy part of the ray
		float y0 = cameraPosition.y + dir.y * ( d - dd );
		float h = ${f(falloff)} * dir.y * dd;
		float integ = abs( h ) > 1e-3 ? ( 1.0 - exp( -h ) ) / h : 1.0 - 0.5 * h;
		float od = sigma * exp( -${f(falloff)} * clamp( y0, -120.0, 2000.0 ) ) * dd * integ;
		od += smoothstep( ${f(farStart)}, ${f(farEnd)}, d ) * ${f(farExtra)};   // melt the far map edge into the sky
		float T = exp( -od );
		// in-scatter: the sky colour just above the horizon for this azimuth + a forward-scattering glow
		vec2 hd = dir.xz;
		float hl = length( hd );
		float ca = hl > 1e-4 ? dot( hd / hl, vec2( ${f(sunH.x)}, ${f(sunH.y)} ) ) : 0.0;
		vec3 col = ca > 0.0 ? mix( ${v3(haze.side)}, ${v3(haze.toward)}, ca ) : mix( ${v3(haze.side)}, ${v3(haze.away)}, -ca );
		float cs = max( dot( dir, vec3( ${f(sunDir.x)}, ${f(sunDir.y)}, ${f(sunDir.z)} ) ), 0.0 );
		col += ${v3(sunColor)} * ( ${f(sunInscatter)} * pow( cs, 6.0 ) );
		return vec4( col * fogColor, T );
	}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
	if ( ! isOrthographic ) {
		vec4 ap = aerialPerspective( vFogRay );
		gl_FragColor.rgb = gl_FragColor.rgb * ap.a + ap.rgb * ( 1.0 - ap.a );
	}
#endif`;

  // ------------------------------------------------------------------ bilinear PCF (4 taps)
  // renderer.shadowMap.type stays PCFShadowMap; each light's shadow.radius picks the kernel at runtime
  // (no recompile when the quality changes): radius <= 1.5 → 2×2 bilinear, otherwise 4×4 bilinear-weighted.
  {
    const s = C.shadowmap_pars_fragment;
    const a = s.indexOf('#if defined( SHADOWMAP_TYPE_PCF )');
    const b = s.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', a);
    if (a >= 0 && b > a) {
      C.shadowmap_pars_fragment = s.slice(0, a) + /* glsl */`#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			vec2 tc = shadowCoord.xy * shadowMapSize - 0.5;
			vec2 fl = floor( tc );
			vec2 fr = tc - fl;
			vec2 uv = ( fl + 0.5 ) * texelSize;
			float z = shadowCoord.z;
			if ( shadowRadius <= 1.5 ) {
				float s00 = texture2DCompare( shadowMap, uv, z );
				float s10 = texture2DCompare( shadowMap, uv + vec2( texelSize.x, 0.0 ), z );
				float s01 = texture2DCompare( shadowMap, uv + vec2( 0.0, texelSize.y ), z );
				float s11 = texture2DCompare( shadowMap, uv + texelSize, z );
				shadow = mix( mix( s00, s10, fr.x ), mix( s01, s11, fr.x ), fr.y );
			} else {
				// 4x4 texel footprint, bilinear weights at the border: smooth 2-texel penumbra
				float acc = 0.0;
				for ( int j = -1; j <= 2; j ++ ) {
					float wy = j == -1 ? 1.0 - fr.y : ( j == 2 ? fr.y : 1.0 );
					for ( int i = -1; i <= 2; i ++ ) {
						float wx = i == -1 ? 1.0 - fr.x : ( i == 2 ? fr.x : 1.0 );
						acc += wx * wy * texture2DCompare( shadowMap, uv + vec2( float( i ), float( j ) ) * texelSize, z );
					}
				}
				shadow = acc * ( 1.0 / 9.0 );
			}
		` + s.slice(b);
    } else console.warn('[render] shadow chunk layout changed; using the default PCF');
  }

  // ------------------------------------------------------------------ sun with cascaded shadows
  // Light 0 = the sun, whose shadow map is the near cascade; light 1 (when two directional lights cast
  // shadows) is a shadow-only far cascade that never lights anything. The near cascade fades into the far
  // one at its border; the last cascade fades to unshadowed at its edge (no hard line).
  {
    const s = C.lights_fragment_begin;
    const a = s.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    const b = s.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', a);
    if (a >= 0 && b > a) {
      const original = s.slice(a, b);
      C.lights_fragment_begin = s.slice(0, a) + /* glsl */`
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLight directionalLight;
	{
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		float sunShadow = 1.0;
		if ( directLight.visible && receiveShadow ) {
			vec4 sc0 = vDirectionalShadowCoord[ 0 ];
			vec2 e0 = abs( sc0.xy / sc0.w - 0.5 ) * 2.0;
			float edge0 = max( e0.x, e0.y );
			DirectionalLightShadow s0 = directionalLightShadows[ 0 ];
			#if NUM_DIR_LIGHT_SHADOWS > 1
				float w1 = smoothstep( 0.78, 0.96, edge0 );
				float sh0 = 1.0, sh1 = 1.0;
				if ( w1 < 1.0 ) sh0 = getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowIntensity, s0.shadowBias, s0.shadowRadius, sc0 );
				if ( w1 > 0.0 ) {
					DirectionalLightShadow s1 = directionalLightShadows[ 1 ];
					vec4 sc1 = vDirectionalShadowCoord[ 1 ];
					vec2 e1 = abs( sc1.xy / sc1.w - 0.5 ) * 2.0;
					sh1 = getShadow( directionalShadowMap[ 1 ], s1.shadowMapSize, s1.shadowIntensity, s1.shadowBias, s1.shadowRadius, sc1 );
					sh1 = mix( sh1, 1.0, smoothstep( 0.8, 0.98, max( e1.x, e1.y ) ) );
				}
				sunShadow = mix( sh0, sh1, w1 );
			#else
				sunShadow = getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowIntensity, s0.shadowBias, s0.shadowRadius, sc0 );
				sunShadow = mix( sunShadow, 1.0, smoothstep( 0.8, 0.98, edge0 ) );
			#endif
		}
		directLight.color *= sunShadow;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_start
	for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#else
${original}
#endif
`;
    } else console.warn('[render] lights chunk layout changed; cascades disabled');
  }

  // ------------------------------------------------------------------ Tuscan grade + ACES
  // renderer.toneMapping = CustomToneMapping. Warm white balance in scene-linear, ACES, then a gentle
  // saturation / split-tone in display-linear. Used by every material rendered to the screen (low /
  // medium and the viewmodel) and by the post chain's final pass (high), so all paths match.
  C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    /* glsl */`
vec3 CustomToneMapping( vec3 color ) {
	color *= vec3( 1.035, 1.0, 0.95 );
	vec3 c = ACESFilmicToneMapping( color );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, 1.07 );
	// warm, slightly lifted shadows; golden highlights
	float sh = 1.0 - smoothstep( 0.0, 0.3, l );
	float hi = smoothstep( 0.55, 1.0, l );
	c += vec3( 0.010, 0.005, -0.004 ) * sh + vec3( 0.012, 0.006, -0.012 ) * hi;
	return saturate( c );
}`);
}
