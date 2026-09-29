# Module contract v2 — San Gimignano, semi-open world

The game grows from one walled town into a **semi-open world of 1.4 km × 1.4 km**: an expanded,
more refined San Gimignano on a hilltop plateau, surrounded by Tuscan countryside (rolling hills,
white gravel roads, cypress avenues, vineyards, olive groves, wheat fields, a river and a lake) with
countryside landmarks (Romanesque parish church, hilltop fortress, abbey, villa with garden, mill and
stone bridge, farmhouses, chapel, watchtower, travertine quarry). Robots are spread over the world;
the player can climb viewpoints (towers) to look down on the town, open a map, and pick a difficulty.

Target: "AAA-looking" town, map, systems and graphics — while staying playable on a mid-range phone.

## Hard rules (from the brief)
- Bright natural daylight, contact shading, material roughness, beautiful and believable.
- **Forbidden:** neon, strong emissive glow, dense fog, heavy depth of field hiding the modelling.
  (Distance haze for aerial perspective at the kilometre scale is fine; bloom only very subtle.)
- Non-bloody training robots (sparks, chips, no blood).
- Phones first: touch controls, legible Japanese UI, performance budgets below.
- Everything procedural, no external assets, no network requests except the vendored three.js in
  `vendor/` (import map: `three`, `three/addons/...` → `vendor/addons/...`; postprocessing, shaders,
  csm, objects, math, lights, environments, utils and geometries addons are vendored).
- Edit only the files you own (table below). Need something from another module? Put it in your
  final report; do not edit their file. `layout.js` is read-only for everyone except the integrator.

## Coordinates and the map (`js/layout.js`)
- Y up, metres. Map x,z ∈ [-700, 700]; the player is clamped to ±680.
- **Town**: `TOWN.rect = [-120, 120, -150, 150]` (outer face of the walls), flat plateau at y = 0.
  Four gates at the wall centres (N z=-150, S z=150, E x=120, W x=-120), openings ≥ 5 m wide.
- **Sites** (`SITES`): countryside landmarks with a flat pad at elevation `y`, radius `r`.
- **Roads** (`ROADS`): polylines starting at the gates. **Lake** (`LAKE`), **River** (`RIVER`,
  points are `[x, z, bedY]`). The south road crosses the river at the mill site.
- Player start `PLAYER_START` inside the south gate, looking north.

## Files and owners
| File(s) | Owner |
|---|---|
| `js/main.js`, `js/physics.js`, `js/world.js`, `js/layout.js`, `js/difficulty.js`, `index.html` | integrator (systems agent may edit `main.js` — see below) |
| `js/render.js` (+ new `js/render-*.js`) | **graphics agent** |
| `js/terrain.js` (+ new `js/terrain-*.js`) | **terrain agent** |
| `js/city.js`, `js/city-geo.js`, `js/textures.js` (+ new `js/city-*.js`) | **town agent** |
| `js/landmarks.js` (+ new `js/landmarks-*.js`) | **landmarks agent** |
| `js/enemies.js` (+ new `js/enemies-*.js`) | **enemy agent** |
| `js/main.js` (game logic), `js/ui.js`, `js/input.js`, `css/style.css`, new `js/map.js`, `js/viewpoints.js`, `js/pickups.js`, `js/settings.js` | **systems agent** |
| `js/weapon.js` (+ new `js/weapon-*.js`) | **weapon agent** (hands/grip, aim down sights, lean) |
| `js/audio.js` | systems agent (add sounds if needed) |

## Performance budget
Quality presets `low | medium | high` (phones default `medium`, desktop `high`, `?q=low` forces low).
- medium, any view, all passes: ≤ 700k triangles, ≤ 400 draw calls (incl. shadow pass), 60 fps
  target on a recent phone at pixel ratio ≤ 1.5. high: ≤ 2M triangles.
- **Everything big must be chunked** (e.g. 40–100 m cells) so frustum culling works, and must hide
  fine detail with distance: each module exposes `update(dt, camera)` and toggles detail/LOD meshes
  there (cheap: compare squared distances, no allocation per frame).
- Load time (desktop): whole world ≤ 5 s including textures; show nothing heavy per frame at boot.
- Shadow casters: only what matters (buildings, trees near the player). Distant vegetation: no shadows.

## world.js (integrator) — what the game sees
```js
buildWorld(scene, materials, { renderer, camera }) -> {
  heightAt(x, z)        // terrain height (below the town it is TOWN.y - 0.25)
  groundAt(x, z)        // walkable ground (terrain, or TOWN.y inside the walls)
  colliders: Box3[]     // all solid boxes (town + terrain props + landmarks)
  navPoints: Vector3[]  // feet positions for enemy navigation
  enemySites: [{ id, name, x, y, z, r, spawns: Vector3[] }]   // where robot squads live
  viewpoints: [{ id, name, base: Vector3, top: Vector3, yaw }] // climbable lookout points
  markers: [{ id, name, type, x, z }]                          // map labels
  playerSpawn: Vector3, playerYaw, bounds: { minX, maxX, minZ, maxZ },
  parts: { terrain, city, landmarks }, update(dt, camera)
}
```
`Physics(colliders, groundAt)`: `moveCircle`, `groundHeight` (terrain + boxes you can step on),
`raycast` (boxes + terrain), `lineOfSight`.

## terrain.js — terrain agent
```js
createTerrain(scene, { materials, renderer, camera }) -> {
  heightAt(x, z),                 // fast (called thousands of times per frame by physics/AI)
  colliders: Box3[],              // e.g. dry-stone walls, big rocks, hay bales, tree trunks near roads
  navPoints: Vector3[],           // along every road (≤ 10 m apart) + open walkable ground grid
  meshes: Object3D[],
  update(dt, camera)              // LOD, vegetation streaming/culling, grass around the camera, water animation
}
```
Honour `layout.js`: flat plateau under the town at TOWN.y − 0.25 out to `plateauMargin`, then a
natural hillside; every site pad flat at `site.y` within `site.r`; lake basin with water at `LAKE.y`;
river channel following `RIVER`; roads graded (max ~12 % slope) and surfaced (white gravel). Build
the countryside: rolling hills, vineyards (rows), olive groves, cypress avenues along some roads and
around sites, wheat/ fallow fields in patchwork, woods on far hills, dry-stone walls, hay bales, rocks,
near-player grass with wind. Own materials in `js/terrain-*.js`; you may read `textures.js` materials.

## city.js — town agent
```js
buildCity(scene, materials, { backdrop: false, heightAt }) -> {
  colliders, navPoints,
  enemySites: [...],              // 4–6 squad locations inside the walls (piazze, streets)
  viewpoints: [...],              // at least the tallest civic tower (Torre Grossa-like) with a walkable top
  markers: [...],                 // piazze, duomo, towers, rocca, gates…
  playerSpawn, playerYaw,         // may be ignored (world uses PLAYER_START)
  update(dt, camera)              // detail LOD per chunk
}
```
Fill the whole `TOWN.rect` (walls included) with a flat paved/cobbled town at y = 0: city walls with
the four gates (open, walk-through), a denser and more varied fabric (palazzi, houses, shops, 12–15
stone tower houses, duomo/collegiata with piazza and stairs, other churches with façades and
campanili, convent/cloister, loggia, the rocca with a garden at a high corner, wells, fountains,
steps, arches, alleys, gardens). Extend walls/foundations below y = 0 (to −30 m) where the hill drops
outside. Remove the old backdrop (the terrain replaces it). Keep the existing façade quality and push it further.

## landmarks.js — landmarks agent
```js
buildLandmarks(scene, materials, { heightAt }) -> { colliders, navPoints, enemySites, viewpoints, markers, update(dt, camera) }
```
One detailed landmark per `SITES` entry built on its pad (`site.y`): Romanesque pieve with campanile
and cemetery, hilltop rocca (walls, keep = viewpoint), abbey with cloister and church, villa with
formal Italian garden and cypress avenue, watermill + multi-arch stone bridge carrying the south road
over the river, farmhouse clusters (podere with barn, dovecote tower, haystacks), hilltop chapel,
watchtower (viewpoint), travertine quarry (terraced cuts, blocks, crane). Each site gets an
enemySite with ≥ 4 spawns and nav points. Build so it looks good from 500 m away (silhouettes) and
up close. Reuse `materials` from textures.js; add own materials in `js/landmarks-*.js` if needed.

## render.js — graphics agent
```js
createGraphics(canvas, { isTouch, params }) -> {
  renderer, scene, camera, sun, sunDir,
  quality, setQuality('low'|'medium'|'high'), onResize(cb), resize(),
  updateSun(focus), update(dt, { adaptive }), render(viewScene?, viewCamera?), compile(extra) -> Promise
}
```
Beautiful daytime Tuscany: physically based sky with soft clouds, sun, image-based light from the
sky, cascaded or otherwise large-world shadows (crisp near, stable), aerial perspective haze by
distance/height (light!), post-processing chain per quality (AO on high, anti-aliasing, very subtle
bloom, warm colour grade, gentle vignette), correct handling of the first-person viewmodel pass.

## enemies.js — enemy agent
```js
new EnemyManager({ scene, physics, audio, world, difficulty })   // world: see world.js above
reset(difficultyPreset)            // (re)spawn all squads for this difficulty (js/difficulty.js)
total, remaining
update(dt, ctx)                    // ctx: { playerPos, playerEye, playerAlive, onPlayerHit(damage, fromPos), camera }
raycast(origin, dir, maxDist), damage(hit, amount)
getMapMarkers() -> [{ x, z, alive, siteId, alerted }]   // for map/minimap
```
Squads per `world.enemySites` (count scaled by difficulty; ~20 robots on normal), 2–3 robot types
(standard trooper, heavy with more HP, a light fast scout), simulation LOD (far squads sleep / tick
slowly, no LOS checks beyond ~120 m, animation skipped when off-screen or far).

## Systems (game logic, UI, map) — systems agent
Difficulty selection on the start screen and in settings; settings menu (difficulty, graphics quality
→ `gfx.setQuality`, look sensitivity); HP regen per difficulty; objectives HUD (robots remaining,
nearest site); **full-screen map** (top-down render of the actual world made once at load, with
markers, player arrow, robot squads, viewpoints) and a **minimap**/compass; **viewpoints**: walk to a
viewpoint base, a 「登る」 button appears, the player is taken to the top (short camera move), can look
around/shoot and 「降りる」; **俯瞰モード** (overview/drone camera in the pause menu: orbit & zoom over the
town/world with touch drag/pinch or mouse); supply pickups (ammo/health) at sites; a cinematic menu
flyover over the town. Keep the existing weapon/HUD quality.

## Aim down sights and lean
- Input (systems): right mouse / touch AIM toggle → `input.aim`; Q/E / touch peek buttons → `input.lean` (-1/0/1).
- main.js (systems): FOV zoom toward `weapon.aimFov`, slower movement and look while aiming, camera lean
  (~0.45 m sideways, ~12° roll, collision-checked), hitscan from the camera, `ctx.playerEye` = camera position.
- weapon.js (weapon agent): `update(dt, { moving, speed01, grounded, lookDX, lookDY, aim, lean })`,
  sights aligned at screen centre at aim = 1, `currentSpread` smaller when aiming, `aimFov`.
- Difficulty: `DIFFICULTY_ORDER` (story, easy, normal, hard, expert) + `makeCustomDifficulty()` for カスタム.

## Testing
`node tools/shot.mjs <out.png> --port <yours> --wait 12000 --query "autostart" --eval "<js>" [--mobile] [--raw]`
loads `?q=low`, freezes the loop, runs the eval, renders one frame (skip with `--raw` if your eval
already rendered, e.g. an overhead view via `__game.gfx.render()`), screenshots. Headless GL is
software (seconds per frame). `window.__game` exposes scene, camera, player, enemies, weapon, world,
physics, renderer, gfx, input, ui, audio, step(n, dt, draw), freeze(v).
