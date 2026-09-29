# Module contract — San Gimignano Streets FPS

Setting: **San Gimignano** (Tuscany, Italy), a small medieval hill town, on a clear summer
afternoon. The game is an artistic impression, not a survey-accurate reconstruction: plastered
walls with age stains, terracotta roofs, wooden shutters, wrought-iron balconies, stone arches,
a cobbled piazza with a fountain, narrow alleys, and the town's signature tall stone tower
houses (torri) on the skyline.

Hard art rules (from the brief): bright natural daylight, visible contact shadows, material
roughness. **Forbidden:** neon, strong emissive glow, dense fog, heavy depth-of-field, anything
that hides the geometry. Enemies are non-bloody training robots (sparks / dust / plastic
chips only, no blood). Target: smartphones first (touch), desktop also works.

Everything is plain ES modules, no build step. `three` is imported through the import map in
`index.html` (`import * as THREE from 'three'`, addons via `three/addons/...`, vendored in
`vendor/`). No network requests to CDNs, no external assets: every texture and sound is generated
in code.

## Coordinate system and scale
- Y up, 1 unit = 1 metre. Ground is flat at **y = 0** everywhere the player can walk
  (low props like steps, fountain rims and benches may be stood on — see physics).
- The playable town fits inside x,z ∈ [-60, 60]. The piazza is centred on the origin.
- Player: feet position `pos`, radius 0.35, height 1.75, eye height 1.62.

## Files and owners
| File | Owner | Purpose |
|---|---|---|
| `index.html`, `js/main.js`, `js/physics.js` | integrator | bootstrap, renderer, sky, lights, game loop, player movement, hitscan |
| `js/textures.js` | textures agent | procedural PBR materials |
| `js/city.js` | city agent | town geometry, colliders, spawn points |
| `js/weapon.js`, `js/audio.js` | weapon agent | first-person gun + arms, recoil, effects, all sound |
| `js/enemies.js` | enemy agent | training robots: model, AI, attack, hit reaction |
| `js/input.js`, `js/ui.js`, `css/style.css` | UI agent | touch + keyboard/mouse input, HUD, menus |

Do not edit files you do not own. If you need a contract change, write it in your final report.

## Performance budget (mid-range phone)
- ≤ 250 draw calls for the whole frame, ≤ 450k triangles in view. Merge static geometry per
  material (`mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`) and/or use
  `InstancedMesh` for repeated parts.
- Canvas textures ≤ 1024², most at 512². Generate once at load (< 1.5 s total on desktop).
- One shadow-casting directional light (owned by main). Static meshes: `castShadow`/`receiveShadow`
  set appropriately and `matrixAutoUpdate = false`.

---

## `textures.js`
```js
export function createMaterials(renderer) // -> Materials
```
Returns an object of `THREE.MeshStandardMaterial` (all with `map`, `roughnessMap`, `normalMap`
where sensible; `metalness` 0 except iron). Every material has `userData.tile` = metres covered by
one texture repeat, so geometry UVs must be in **metres / tile** (city computes UVs in world metres
and divides by `userData.tile`). Textures use `RepeatWrapping`, colour maps are `SRGBColorSpace`,
anisotropy = `renderer.capabilities.getMaxAnisotropy()` capped at 8.

Required keys:
- `cobble` – rounded cobblestones with mortar gaps (streets)
- `paving` – larger flagstones for the piazza
- `plaster` – **array of ≥ 5** aged plaster variants (ochre, cream, pale pink, sienna, faded
  yellow…), with stains, water streaks, patches where bricks show through
- `stone` – dressed limestone for trims, arches, sills, cornices, fountain
- `brick` – old exposed brick
- `roof` – terracotta tile rows (UV u along the eave, v up the slope; 1 tile = one texture repeat)
- `wood` – painted wooden shutter slats; provide `shutters` = **array of ≥ 4** colours (green,
  blue-grey, brown, faded teal)
- `door` – dark stained wood planks
- `iron` – dark wrought iron (metalness ~0.6, rough)
- `glass` – dark window glass with slight reflection (low roughness, no transparency needed)
- `water` – fountain water (bluish, low roughness; may be `transparent` with opacity ~0.85)
- `metalBright` – light grey metal (for props)
- `plant` – leaf green for pots / climbing plants (vertexColors allowed)
Any extra keys are welcome.

## `city.js`
```js
export function buildCity(scene, materials) // -> City
```
Adds all static meshes to `scene` and returns:
```js
{
  colliders: THREE.Box3[],      // axis-aligned boxes for everything solid (walls, fountain,
                                // benches, arch pillars, arch tops at their real height...)
  playerSpawn: THREE.Vector3,   // feet position, y = 0
  playerYaw: number,            // radians, yaw 0 looks toward -Z
  enemySpawns: THREE.Vector3[], // ≥ 5 feet positions, spread over the town, ≥ 15 m from player
  navPoints: THREE.Vector3[],   // ≥ 20 walkable waypoints (streets, piazza, alleys) for patrols
  bounds: { minX, maxX, minZ, maxZ } // walkable limits (outer walls must also be colliders)
}
```
The whole outer boundary must be closed by buildings/walls (no gaps to the void). Beyond the
boundary, add cheap backdrop (distant roofs, hills, cypress trees, a bell tower) so the horizon
is not empty.

## `physics.js` (integrator — available to everyone)
```js
export class Physics {
  constructor(colliders /* Box3[] */)
  moveCircle(pos, delta, radius, height) // mutates pos (feet); slides along walls, steps up ≤ 0.45 m
  groundHeight(x, z, radius, feetY)      // highest walkable surface under the circle
  raycast(origin, dir /* normalized */, maxDist) // -> { point, normal, distance } | null
  lineOfSight(a, b)                      // true if nothing blocks the segment a→b
}
```

## `audio.js`
```js
export class GameAudio {
  constructor()
  resume()                       // call from a user gesture
  play(name, { volume = 1, pan = 0, rate = 1 } = {})
  setMuted(bool)
}
```
Names: `shot`, `empty`, `reload`, `hitRobot`, `hitWorld`, `robotShot`, `robotHurt`, `robotDie`,
`robotAlert`, `playerHurt`, `step`, `win`, `lose`, `uiClick`. All synthesised with Web Audio.

## `weapon.js`
```js
export class Weapon {
  constructor({ renderer, audio })
  viewScene; viewCamera           // rendered on top of the world after renderer.clearDepth()
  magSize; ammo; reserve; isReloading
  currentSpread                   // radians, current bloom (main draws the crosshair from it)
  reset()
  update(dt, { moving, speed01, grounded, lookDX, lookDY }) // bob, sway, recoil recovery, reload anim
  tryFire() // -> null or { pitchKick, yawKick, spread } ; handles ammo, fire rate, muzzle flash, sound
  reload()  // starts reload if possible
  getMuzzleWorld(camera, target /*Vector3*/) // approx. muzzle position in world space for tracers
  spawnImpact(scene, point, normal, kind /* 'world' | 'robot' */)
  spawnTracer(scene, from, to)
  updateEffects(dt)               // world-space effects (impacts, decals, tracers)
  resize(aspect)
}
```
Semi-auto carbine feel: fire interval 0.11 s while held, mag 24, reserve 96, reload 1.6 s,
auto-reload when empty and fire held. Viewmodel: gun plus two arms (sleeves + gloves), lit by its
own lights in `viewScene` matching the daylight. Muzzle flash: tiny, ~50 ms, warm, not neon.

## `enemies.js`
```js
export class EnemyManager {
  constructor({ scene, physics, audio, spawns, navPoints })
  total; remaining
  reset()                          // (re)spawn 5 robots at spawns
  update(dt, ctx)                  // ctx: { playerPos /*feet*/, playerEye, playerAlive, onPlayerHit(damage, fromPos) }
  raycast(origin, dir, maxDist)    // -> { enemy, point, normal, distance, part: 'head'|'body' } | null
  damage(hit, amount)              // -> { killed: boolean }  (head = 2x handled by caller: amount already scaled)
}
```
Robots: 100 HP, body shot 25, head 50. States: patrol → alert (sees player) → chase / strafe →
shoot (needs line of sight, uses `physics.lineOfSight`). Damage to the player ~8 per hit with
distance-based accuracy so a careful player can win. They must collide with the town via
`physics.moveCircle`. Visible hit reaction (flinch, sparks, brief white flash), death = collapse
and power-down (no blood).

## `input.js`
```js
export class Input {
  constructor(canvas, { isTouch })
  enabled                          // false while menus are open
  move                             // { x, y } strafe/forward in [-1,1]
  sprint                           // bool
  fireHeld                         // bool
  consumeLook()                    // -> { dx, dy } radians since last call (yaw right +, pitch up +)
  consumeReload(); consumeJump()   // -> bool (edge-triggered)
  lockPointer()                    // desktop: request pointer lock (call from a user gesture)
  reset()
}
```
Touch layout: left half = floating virtual joystick, right half = drag to look, big FIRE button
(bottom right, also allows dragging to look while held), RELOAD and JUMP buttons. Must handle
multi-touch, ignore the browser's default gestures (no scroll, zoom, text select). Desktop: WASD,
mouse look with pointer lock, left click fire, R reload, Space jump, Shift sprint.

## `ui.js`
```js
export class UI {
  constructor(root /* #ui element */, { isTouch })
  showStart(onStart)               // title + instructions (touch or desktop variant), start button
  showPause(onResume)
  showWin(stats, onRestart)        // stats: { time, accuracy, hpLeft }
  showLose(stats, onRestart)
  hideOverlays()
  setHUDVisible(bool)
  setHP(hp, max); setAmmo(mag, reserve, reloading); setEnemies(remaining, total)
  hitMarker(killed)
  damageIndicator(angle)           // angle of attacker relative to view, radians (0 = in front)
  setCrosshairSpread(px)
  toast(text)
}
```
The touch-control DOM (joystick, buttons) is created by `input.js` inside `#touch`; `ui.js`
owns `#ui` (HUD + overlays). Text must stay readable (dark translucent panels behind light text,
contrast ≥ 4.5:1). Japanese UI text.
