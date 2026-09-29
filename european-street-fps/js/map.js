// World map: a top-down render of the real world baked once behind the loading screen, shown as
// a full-screen pan/zoom map, a rotating minimap and a compass strip.
//
// The dynamic content (player, squads, viewpoints, crates, objective) comes from a state provider
// set by main.js:  map.getState = () => ({ player:{x,z,yaw}, sites:[…], robots:[…], viewpoints:[…],
// pickups:[…], objective, markers, remaining, total })
import * as THREE from 'three';
import { MAP_HALF, TOWN, ROADS } from './layout.js';

const TAU = Math.PI * 2;
const WORLD = MAP_HALF * 2;
// Town detail render: square around the town (walls + a margin).
const TOWN_HALF = 175;

const C = {
  bg: '#1c1914',
  ink: '#fbf5ea', inkDim: '#d9ccb6', halo: 'rgba(16,12,8,0.92)',
  accent: '#f0b04a', robot: '#ff6a3d', robotEdge: '#2a0f05',
  known: 'rgba(255,128,70,0.95)', knownFill: 'rgba(255,110,50,0.14)',
  unknown: 'rgba(255,236,210,0.85)', unknownFill: 'rgba(20,16,12,0.28)',
  cleared: 'rgba(166,221,131,0.95)', road: 'rgba(252,244,226,0.55)',
  waypoint: '#7fd3ff',
};

const wrapPI = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ small canvas icon painters
function halo(g, text, x, y, size, { weight = 700, color = C.ink, align = 'center', base = 'middle' } = {}) {
  g.font = `${weight} ${size}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic UI", Meiryo, sans-serif`;
  g.textAlign = align; g.textBaseline = base;
  g.lineJoin = 'round'; g.lineWidth = Math.max(3, size * 0.32); g.strokeStyle = C.halo;
  g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
function playerArrow(g, x, y, ang, s) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.72, s * 0.78); g.lineTo(0, s * 0.42); g.lineTo(-s * 0.72, s * 0.78); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = Math.max(2.5, s * 0.28); g.strokeStyle = 'rgba(16,12,8,0.95)'; g.stroke();
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = Math.max(1, s * 0.1); g.strokeStyle = C.accent; g.stroke();
  g.restore();
}
function robotDot(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, TAU);
  g.fillStyle = C.robot; g.fill();
  g.lineWidth = Math.max(1.5, r * 0.45); g.strokeStyle = C.robotEdge; g.stroke();
}
function towerBadge(g, x, y, s, climbed) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.roundRect(-s, -s, s * 2, s * 2, s * 0.4);
  g.fillStyle = climbed ? C.accent : 'rgba(28,24,18,0.92)'; g.fill();
  g.lineWidth = Math.max(1.5, s * 0.16); g.strokeStyle = climbed ? '#fff3d6' : C.accent; g.stroke();
  const k = s / 10;
  g.fillStyle = climbed ? '#2a1a06' : '#f7e6c4';
  g.fillRect(-2.6 * k, -5.5 * k, 5.2 * k, 11.5 * k);            // shaft
  g.fillRect(-4 * k, -7 * k, 8 * k, 2.4 * k);                   // crenellated top
  g.fillRect(-4 * k, 4.8 * k, 8 * k, 1.8 * k);
  g.restore();
}
function crateIcon(g, x, y, s, type) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.roundRect(-s, -s * 0.8, s * 2, s * 1.6, s * 0.3);
  g.fillStyle = type === 'ammo' ? '#5d653a' : '#f1ede2'; g.fill();
  g.lineWidth = Math.max(1.2, s * 0.2); g.strokeStyle = 'rgba(16,12,8,0.9)'; g.stroke();
  if (type === 'ammo') { g.fillStyle = '#e1bd46'; g.fillRect(-s, -s * 0.18, s * 2, s * 0.36); }
  else { g.fillStyle = '#2f8a58'; g.fillRect(-s * 0.2, -s * 0.6, s * 0.4, s * 1.2); g.fillRect(-s * 0.6, -s * 0.2, s * 1.2, s * 0.4); }
  g.restore();
}
function objectiveIcon(g, x, y, s, t = 0) {
  g.save(); g.translate(x, y);
  const pr = s * (1.6 + 0.5 * ((t * 0.8) % 1));
  g.beginPath(); g.arc(0, 0, pr, 0, TAU);
  g.strokeStyle = `rgba(240,176,74,${0.7 * (1 - ((t * 0.8) % 1))})`; g.lineWidth = 2; g.stroke();
  g.rotate(Math.PI / 4);
  g.beginPath(); g.rect(-s * 0.62, -s * 0.62, s * 1.24, s * 1.24);
  g.fillStyle = C.accent; g.fill();
  g.lineWidth = Math.max(1.5, s * 0.22); g.strokeStyle = 'rgba(16,12,8,0.95)'; g.stroke();
  g.restore();
}
function waypointPin(g, x, y, s) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-s * 0.2, -s * 0.6, -s * 0.8, -s * 0.9, -s * 0.8, -s * 1.5);
  g.arc(0, -s * 1.5, s * 0.8, Math.PI, 0); g.bezierCurveTo(s * 0.8, -s * 0.9, s * 0.2, -s * 0.6, 0, 0); g.closePath();
  g.fillStyle = C.waypoint; g.fill(); g.lineWidth = Math.max(1.5, s * 0.18); g.strokeStyle = 'rgba(10,20,30,0.95)'; g.stroke();
  g.beginPath(); g.arc(0, -s * 1.5, s * 0.3, 0, TAU); g.fillStyle = '#0d2233'; g.fill();
  g.restore();
}
function checkMark(g, x, y, s) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, s, 0, TAU); g.fillStyle = 'rgba(28,40,22,0.92)'; g.fill();
  g.lineWidth = Math.max(1.5, s * 0.16); g.strokeStyle = C.cleared; g.stroke();
  g.beginPath(); g.moveTo(-s * 0.45, 0); g.lineTo(-s * 0.1, s * 0.38); g.lineTo(s * 0.5, -s * 0.35);
  g.lineWidth = Math.max(2, s * 0.24); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  g.restore();
}

const LEGEND_SVG = {
  robot: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.5" fill="#ff6a3d" stroke="#2a0f05" stroke-width="2.4"/></svg>',
  unknown: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="rgba(20,16,12,.3)" stroke="#ffecd2" stroke-width="1.6" stroke-dasharray="3 2.4"/><text x="10" y="14" text-anchor="middle" font-size="10" font-weight="800" fill="#ffecd2">?</text></svg>',
  tower: '<svg viewBox="0 0 20 20"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="#1c1812" stroke="#f0b04a" stroke-width="1.6"/><rect x="8" y="5.5" width="4" height="10" fill="#f7e6c4"/><rect x="6.8" y="4.5" width="6.4" height="2" fill="#f7e6c4"/></svg>',
  crate: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4.5" width="15" height="11" rx="2.2" fill="#5d653a" stroke="#100c08" stroke-width="1.4"/><rect x="2.5" y="8.7" width="15" height="2.6" fill="#e1bd46"/></svg>',
  med: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4.5" width="15" height="11" rx="2.2" fill="#f1ede2" stroke="#100c08" stroke-width="1.4"/><path d="M10 6.3v7.4M6.3 10h7.4" stroke="#2f8a58" stroke-width="2.6"/></svg>',
  objective: '<svg viewBox="0 0 20 20"><rect x="5.6" y="5.6" width="8.8" height="8.8" transform="rotate(45 10 10)" fill="#f0b04a" stroke="#100c08" stroke-width="1.6"/></svg>',
  waypoint: '<svg viewBox="0 0 20 20"><path d="M10 18c-1-3-5-5-5-9a5 5 0 0 1 10 0c0 4-4 6-5 9z" fill="#7fd3ff" stroke="#0a141e" stroke-width="1.4"/><circle cx="10" cy="9" r="1.8" fill="#0d2233"/></svg>',
};

export class WorldMap {
  constructor({ gfx, world, root, isTouch = false }) {
    this.gfx = gfx; this.world = world; this.root = root; this.isTouch = isTouch;
    this.getState = () => null;
    this.worldImg = null; this.townImg = null;
    this.waypoint = null;
    this.onClose = null;
    this.onWaypoint = null;
    this.isOpen = false;
    this.time = 0;
    this.view = { cx: 0, cz: 0, s: 0.5 };
    this._ptr = new Map();
    this._pinch = null;
    this._dirty = true;
    this._redrawT = 0;
    this._mini = null; this._compass = null;
    this._miniKey = '';
    this._buildDOM();
  }

  // ================================================================ bake (top-down render)
  /**
   * Render the whole world once from straight above with an orthographic camera (north up) into
   * 2D canvases: the full 1.4 km map and a sharper town close-up. Objects in `hide` are hidden
   * for the shot. Cheap enough to run behind the loading screen.
   */
  bake({ hide = [], size } = {}) {
    const t0 = performance.now();
    const { renderer, scene } = this.gfx;
    const S = size || (this.gfx.quality === 'low' ? 1024 : 2048);
    const prevPR = renderer.getPixelRatio();
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevTarget = renderer.getRenderTarget();
    const fog = scene.fog;
    const fogSave = fog ? { near: fog.near, far: fog.far, density: fog.density } : null;
    const hidden = [];
    for (const o of hide) if (o && o.visible) { o.visible = false; hidden.push(o); }

    // Shadows: temporarily stretch the sun's shadow box over the rendered area.
    const sun = this.gfx.sun, sh = sun?.shadow, sc = sh?.camera;
    const canShadow = !!(sun && sun.castShadow && sc && sc.isOrthographicCamera && sun.target);
    const shSave = canShadow ? {
      l: sc.left, r: sc.right, t: sc.top, b: sc.bottom, n: sc.near, f: sc.far, bias: sh.bias, nb: sh.normalBias,
      pos: sun.position.clone(), tgt: sun.target.position.clone(),
    } : null;
    const sunDir = (this.gfx.sunDir?.clone?.() || (canShadow ? sun.position.clone().sub(sun.target.position) : new THREE.Vector3(0.4, 1, 0.3))).normalize();
    const fitShadow = (half, cx, cz) => {
      if (!canShadow) return;
      Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 5000 });
      sc.updateProjectionMatrix();
      const texel = (2 * half) / sh.mapSize.x;
      sh.normalBias = texel * 1.4; sh.bias = -0.0003;
      sun.target.position.set(cx, 0, cz);
      sun.position.copy(sunDir).multiplyScalar(2000).add(sun.target.position);
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      sh.needsUpdate = true;
    };

    const shot = (half, cx, cz, height, px) => {
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, height + 400);
      cam.up.set(0, 0, -1);                              // north (-z) at the top of the image
      cam.position.set(cx, height, cz);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      renderer.setSize(px, px, false);
      this.world.update?.(0, cam);                       // pick LODs for this view
      fitShadow(half * 1.08, cx, cz);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, cam);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      c.getContext('2d').drawImage(renderer.domElement, 0, 0, px, px);
      return c;
    };

    try {
      if (fog) { if (fog.isFogExp2) fog.density = 0; else { fog.near = 1e6; fog.far = 2e6; } }
      renderer.setPixelRatio(1);
      this.worldImg = shot(MAP_HALF, 0, 0, 900, S);
      this.townImg = shot(TOWN_HALF, 0, 0, 260, S >= 2048 ? 1536 : 1024);
    } catch (e) {
      console.warn('[map] bake failed', e);
    } finally {
      if (fog && fogSave) { fog.near = fogSave.near; fog.far = fogSave.far; if (fogSave.density !== undefined) fog.density = fogSave.density; }
      for (const o of hidden) o.visible = true;
      if (shSave) {
        Object.assign(sc, { left: shSave.l, right: shSave.r, top: shSave.t, bottom: shSave.b, near: shSave.n, far: shSave.f });
        sc.updateProjectionMatrix();
        sh.bias = shSave.bias; sh.normalBias = shSave.nb;
        sun.position.copy(shSave.pos); sun.target.position.copy(shSave.tgt);
        sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
        sh.needsUpdate = true;
      }
      renderer.setRenderTarget(prevTarget);
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prevSize.x, prevSize.y, false);
      this.gfx.resize?.();
      this.world.update?.(0, this.gfx.camera);
    }
    this._miniKey = '';
    this._dirty = true;
    console.log(`[map] baked ${S}px world + town in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // ================================================================ full-screen map
  _buildDOM() {
    const el = document.createElement('div');
    el.className = 'map-screen';
    el.hidden = true;
    const lg = (icon, text) => `<span class="lg"><i>${LEGEND_SVG[icon]}</i>${text}</span>`;
    el.innerHTML = `
      <canvas class="map-canvas" aria-label="ワールドマップ"></canvas>
      <div class="map-head">
        <div class="map-title"><b>地図</b><span class="map-sub">トスカーナ訓練区域</span></div>
        <button type="button" class="map-btn map-close" data-map="close" aria-label="地図を閉じる">閉じる</button>
      </div>
      <div class="map-legend">
        ${lg('robot', 'ロボット')}${lg('unknown', '未確認の部隊')}${lg('objective', '目標')}
        ${lg('tower', '展望ポイント')}${lg('crate', '弾薬')}${lg('med', '医療キット')}${lg('waypoint', '目的地')}
      </div>
      <div class="map-foot">
        <div class="map-info"><div class="mi-line mi-obj"></div><div class="mi-line mi-stats"></div><div class="mi-hint">${this.isTouch
          ? 'ドラッグで移動 · ピンチで拡大 · タップで目的地を設定'
          : 'ドラッグで移動 · ホイールで拡大 · クリックで目的地を設定 · M / Esc で閉じる'}</div></div>
        <div class="map-zoom">
          <button type="button" class="map-btn map-round" data-map="in" aria-label="拡大">＋</button>
          <button type="button" class="map-btn map-round" data-map="out" aria-label="縮小">－</button>
          <button type="button" class="map-btn map-me" data-map="me" aria-label="現在地に戻る">現在地</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('.map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.infoObj = el.querySelector('.mi-obj');
    this.infoStats = el.querySelector('.mi-stats');

    el.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-map]') : null;
      if (!b) return;
      const a = b.dataset.map;
      if (a === 'close') this.close();
      else if (a === 'in') this._zoomAt(1.6, this._W / 2, this._H / 2, true);
      else if (a === 'out') this._zoomAt(1 / 1.6, this._W / 2, this._H / 2, true);
      else if (a === 'me') this._centerOnPlayer(true);
    });
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this._down(e));
    cv.addEventListener('pointermove', (e) => this._move(e));
    cv.addEventListener('pointerup', (e) => this._up(e));
    cv.addEventListener('pointercancel', (e) => { this._ptr.delete(e.pointerId); this._pinch = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.06 : 0.0015)), e.offsetX, e.offsetY);
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'KeyM' || e.code === 'Escape' || e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.close(); }
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') this._zoomAt(1.4, this._W / 2, this._H / 2, true);
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this._zoomAt(1 / 1.4, this._W / 2, this._H / 2, true);
    });
    addEventListener('resize', () => { if (this.isOpen) { this._resize(); this._dirty = true; } });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.hidden = false;
    this._resize();
    const st = this.getState();
    const fit = this._fitScale();
    this.view.s = Math.max(fit, Math.min(this._W, this._H) / 820);
    this._anim = null;
    if (st) { this.view.cx = st.player.x; this.view.cz = st.player.z; }
    this._clampView();
    this._ptr.clear(); this._pinch = null;
    this._dirty = true;
    this.draw();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this._ptr.clear(); this._pinch = null;
    this.onClose?.();
  }

  _resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = this.canvas.clientWidth || innerWidth, H = this.canvas.clientHeight || innerHeight;
    this._W = W; this._H = H; this._dpr = dpr;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  _fitScale() { return Math.min(this._W, this._H) / WORLD * 0.94; }
  _clampView() {
    const v = this.view;
    v.s = clamp(v.s, this._fitScale(), 7);
    const lim = MAP_HALF;
    v.cx = clamp(v.cx, -lim, lim); v.cz = clamp(v.cz, -lim, lim);
  }
  _zoomAt(f, px, py, animate = false) {
    const v = this.view;
    const wx = (px - this._W / 2) / v.s + v.cx, wz = (py - this._H / 2) / v.s + v.cz;
    const s = clamp(v.s * f, this._fitScale(), 7);
    const goal = { s, cx: wx - (px - this._W / 2) / s, cz: wz - (py - this._H / 2) / s };
    if (animate) this._anim = { from: { ...v }, to: goal, t: 0 };
    else { Object.assign(v, goal); this._clampView(); }
    this._dirty = true;
  }
  _centerOnPlayer(animate) {
    const st = this.getState();
    if (!st) return;
    const goal = { s: Math.max(this.view.s, 1.1), cx: st.player.x, cz: st.player.z };
    if (animate) this._anim = { from: { ...this.view }, to: goal, t: 0 };
    else Object.assign(this.view, goal);
    this._dirty = true;
  }

  _down(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
    if (this._ptr.size > 1) for (const p of this._ptr.values()) p.moved = true;
    this._pinch = null;
    this._anim = null;
  }
  _move(e) {
    const p = this._ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const v = this.view;
    if (this._ptr.size >= 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...this._ptr.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch) {
        const r = this.canvas.getBoundingClientRect();
        v.cx -= (mx - this._pinch.mx) / v.s; v.cz -= (my - this._pinch.my) / v.s;
        if (d > 10 && this._pinch.d > 10) this._zoomAt(d / this._pinch.d, mx - r.left, my - r.top);
        this._clampView();
      }
      this._pinch = { mx, my, d };
      this._dirty = true;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) p.moved = true;
    if (!p.moved) return;
    v.cx -= dx / v.s; v.cz -= dy / v.s;
    this._clampView();
    this._dirty = true;
  }
  _up(e) {
    const p = this._ptr.get(e.pointerId);
    this._ptr.delete(e.pointerId);
    this._pinch = null;
    if (!p || p.moved || performance.now() - p.t0 > 450 || this._ptr.size) return;
    // Tap: set / clear the waypoint.
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    const wx = (e.clientX - r.left - this._W / 2) / v.s + v.cx, wz = (e.clientY - r.top - this._H / 2) / v.s + v.cz;
    if (this.waypoint && Math.hypot(this.waypoint.x - wx, this.waypoint.z - wz) * v.s < 26) this.setWaypoint(null);
    else if (Math.abs(wx) < MAP_HALF && Math.abs(wz) < MAP_HALF) this.setWaypoint({ x: wx, z: wz });
  }

  setWaypoint(wp) {
    this.waypoint = wp;
    this._dirty = true;
    this._miniKey = '';
    this.onWaypoint?.(wp);
  }

  /** Called every frame by main while the map is open. */
  update(dt) {
    if (!this.isOpen) return;
    this.time += dt;
    if (this._anim) {
      const a = this._anim;
      a.t = Math.min(1, a.t + dt / 0.28);
      const k = 1 - (1 - a.t) ** 3;
      this.view.s = Math.exp(Math.log(a.from.s) + (Math.log(a.to.s) - Math.log(a.from.s)) * k);
      this.view.cx = a.from.cx + (a.to.cx - a.from.cx) * k;
      this.view.cz = a.from.cz + (a.to.cz - a.from.cz) * k;
      this._clampView();
      if (a.t >= 1) this._anim = null;
      this._dirty = true;
    }
    this._redrawT -= dt;
    if (this._dirty || this._redrawT <= 0) this.draw();
  }

  draw() {
    this._dirty = false;
    this._redrawT = 1 / 15;
    const g = this.ctx, v = this.view, W = this._W, H = this._H, dpr = this._dpr;
    const st = this.getState();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const sx = (x) => (x - v.cx) * v.s + W / 2, sy = (z) => (z - v.cz) * v.s + H / 2;

    // Base images.
    g.save();
    g.translate(W / 2, H / 2); g.scale(v.s, v.s); g.translate(-v.cx, -v.cz);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (this.worldImg) g.drawImage(this.worldImg, -MAP_HALF, -MAP_HALF, WORLD, WORLD);
    else { g.fillStyle = '#6f7a4c'; g.fillRect(-MAP_HALF, -MAP_HALF, WORLD, WORLD); }
    if (this.townImg) g.drawImage(this.townImg, -TOWN_HALF, -TOWN_HALF, TOWN_HALF * 2, TOWN_HALF * 2);
    g.restore();
    // Soft darkening for label contrast + the edge of the training area.
    g.fillStyle = 'rgba(12,10,8,0.12)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,236,205,0.45)'; g.lineWidth = 1.5; g.setLineDash([8, 6]);
    g.strokeRect(sx(-680), sy(-680), 1360 * v.s, 1360 * v.s); g.setLineDash([]);

    // Roads (subtle vector overlay when zoomed out; the render shows them up close).
    const roadA = clamp(1.6 - v.s, 0, 1);
    if (roadA > 0.02) {
      g.save(); g.globalAlpha = roadA; g.strokeStyle = C.road; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const r of ROADS) {
        g.lineWidth = Math.max(1.5, r.width * v.s * 0.9);
        g.beginPath();
        r.points.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z))));
        g.stroke();
      }
      g.restore();
    }
    if (!st) return;
    const t = this.time;

    // Squad areas.
    for (const s of st.sites) {
      const x = sx(s.x), y = sy(s.z), rr = Math.max(14, (s.r || 20) * v.s);
      if (s.cleared) { if (v.s > 0.35) checkMark(g, x, y, 9); continue; }
      g.beginPath(); g.arc(x, y, rr, 0, TAU);
      if (s.known) {
        g.fillStyle = C.knownFill; g.fill();
        g.lineWidth = 2; g.strokeStyle = C.known; g.stroke();
      } else {
        g.fillStyle = C.unknownFill; g.fill();
        g.setLineDash([6, 5]); g.lineWidth = 1.8; g.strokeStyle = C.unknown; g.stroke(); g.setLineDash([]);
        halo(g, '?', x, y, 16, { weight: 800 });
      }
    }
    // Markers (landmark names; town details only when zoomed in).
    const [tx0, tx1, tz0, tz1] = TOWN.rect;
    const zoomTown = v.s > 1.15;
    if (!zoomTown) halo(g, 'サン・ジミニャーノ', sx(0), sy(tz0) - 12, v.s > 0.5 ? 15 : 13, { weight: 800 });
    for (const m of st.markers) {
      const inTown = m.x > tx0 && m.x < tx1 && m.z > tz0 && m.z < tz1;
      if (inTown && !zoomTown) continue;
      const x = sx(m.x), y = sy(m.z);
      if (x < -80 || x > W + 80 || y < -30 || y > H + 30) continue;
      g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fillStyle = C.ink; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.halo; g.stroke();
      halo(g, m.name, x, y + 6, inTown ? 12 : 13, { base: 'top', weight: inTown ? 700 : 800 });
    }
    // Squad labels (count) and robots.
    for (const s of st.sites) {
      if (!s.known || s.cleared) continue;
      halo(g, `${s.alive} 体`, sx(s.x), sy(s.z) - Math.max(14, (s.r || 20) * v.s) - 9, 12, { weight: 800, color: '#ffc9ae' });
    }
    const rr = clamp(v.s * 2.2, 3.2, 6);
    for (const r of st.robots) robotDot(g, sx(r.x), sy(r.z), rr);
    // Pickups and viewpoints.
    const ic = clamp(v.s * 6, 5, 9);
    for (const p of st.pickups) if (p.active) crateIcon(g, sx(p.x), sy(p.z), ic, p.type);
    for (const vp of st.viewpoints) towerBadge(g, sx(vp.x), sy(vp.z), ic + 2, vp.climbed);
    // Objective + waypoint.
    if (st.objective) objectiveIcon(g, sx(st.objective.x), sy(st.objective.z), 8, t);
    if (this.waypoint) waypointPin(g, sx(this.waypoint.x), sy(this.waypoint.z), 11);
    // Player.
    playerArrow(g, sx(st.player.x), sy(st.player.z), -st.player.yaw, 11);

    // Scale bar.
    const nice = [10, 20, 50, 100, 200, 500];
    const m = nice.find((n) => n * v.s >= 70) || 500;
    const bx = 16 + (this._safeL || 0), by = H - 18;
    g.fillStyle = 'rgba(20,16,12,0.75)'; g.fillRect(bx - 8, by - 20, m * v.s + 16, 28);
    g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + m * v.s, by); g.lineTo(bx + m * v.s, by - 4); g.stroke();
    halo(g, `${m} m`, bx + m * v.s / 2, by - 11, 12, { weight: 700 });
    // North.
    halo(g, '北 ▲', W - 20 - (this._safeR || 0), 76, 13, { align: 'right', weight: 800 });

    // Info panel text (DOM, only when it changes).
    const obj = st.objective ? `目標: ${st.objective.name}（${Math.round(st.objective.dist)} m）` : '全部隊を停止しました';
    if (obj !== this._objTxt) { this._objTxt = obj; this.infoObj.textContent = obj; }
    const knownN = st.sites.filter((s) => s.known || s.cleared).length;
    const vpN = st.viewpoints.filter((x) => x.climbed).length;
    const stats = `残り ${st.remaining}/${st.total} 体 · 発見した部隊 ${knownN}/${st.sites.length}${st.viewpoints.length ? ` · 展望 ${vpN}/${st.viewpoints.length}` : ''}`;
    if (stats !== this._statsTxt) { this._statsTxt = stats; this.infoStats.textContent = stats; }
  }

  // ================================================================ minimap + compass (HUD)
  attachHUD({ minimap, compass }) { this._mini = minimap || null; this._compass = compass || null; }

  _fitCanvas(cv) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; this._miniKey = ''; }
    return { w, h, dpr };
  }

  /** Draw minimap + compass. Cheap: skips the minimap when nothing moved. */
  drawHUD(st, dt = 0) {
    if (!st) return;
    this.time += dt;
    if (this._compass) this._drawCompass(st);
    if (this._mini) this._drawMinimap(st);
  }

  _drawMinimap(st) {
    const cv = this._mini;
    const f = this._fitCanvas(cv);
    if (!f) return;
    const p = st.player;
    const key = `${p.x.toFixed(1)},${p.z.toFixed(1)},${p.yaw.toFixed(3)},${st.robots.length},${st.pickupsKey},${st.objective?.x},${Math.floor(this.time * 4)}`;
    if (key === this._miniKey) return;
    this._miniKey = key;
    const g = cv.getContext('2d'), { w, h, dpr } = f;
    const R = Math.min(w, h) / 2 - 1, cx = w / 2, cy = h / 2;
    const range = w < 150 ? 105 : 125;                      // metres from centre to rim
    const k = R / range;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.fillStyle = '#2a261e'; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(cx, cy); g.rotate(p.yaw); g.scale(k, k); g.translate(-p.x, -p.z);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    if (this.worldImg) g.drawImage(this.worldImg, -MAP_HALF, -MAP_HALF, WORLD, WORLD);
    if (this.townImg && Math.abs(p.x) < TOWN_HALF + range && Math.abs(p.z) < TOWN_HALF + range) g.drawImage(this.townImg, -TOWN_HALF, -TOWN_HALF, TOWN_HALF * 2, TOWN_HALF * 2);
    g.restore();
    g.fillStyle = 'rgba(12,10,8,0.16)'; g.fillRect(0, 0, w, h);
    // View cone.
    const cone = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
    cone.addColorStop(0, 'rgba(255,248,230,0.32)'); cone.addColorStop(1, 'rgba(255,248,230,0)');
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.9, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath();
    g.fillStyle = cone; g.fill();

    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    const toS = (x, z, out) => {
      const rx = (x - p.x) * k, rz = (z - p.z) * k;
      out.x = cx + rx * cs - rz * sn; out.y = cy + rx * sn + rz * cs;
      out.d = Math.hypot(out.x - cx, out.y - cy);
      return out;
    };
    const q = { x: 0, y: 0, d: 0 };
    for (const s of st.sites) {
      if (s.cleared) continue;
      toS(s.x, s.z, q);
      const rr = (s.r || 20) * k;
      if (q.d - rr > R) continue;
      g.beginPath(); g.arc(q.x, q.y, Math.max(6, rr), 0, TAU);
      if (s.known) { g.fillStyle = C.knownFill; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.known; g.stroke(); }
      else { g.setLineDash([4, 4]); g.lineWidth = 1.3; g.strokeStyle = C.unknown; g.stroke(); g.setLineDash([]); }
    }
    for (const it of st.pickups) { if (!it.active) continue; toS(it.x, it.z, q); if (q.d < R - 4) crateIcon(g, q.x, q.y, 4.5, it.type); }
    for (const vp of st.viewpoints) { toS(vp.x, vp.z, q); if (q.d < R - 5) towerBadge(g, q.x, q.y, 6, vp.climbed); }
    for (const r of st.robots) { toS(r.x, r.z, q); if (q.d < R - 3) robotDot(g, q.x, q.y, 3.2); }
    const edge = (x, z, draw) => {
      toS(x, z, q);
      if (q.d <= R - 8) { draw(q.x, q.y, false); return; }
      const a = Math.atan2(q.y - cy, q.x - cx);
      draw(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8), true);
    };
    if (st.objective) edge(st.objective.x, st.objective.z, (x, y) => objectiveIcon(g, x, y, 5.5, this.time));
    if (this.waypoint) edge(this.waypoint.x, this.waypoint.z, (x, y) => waypointPin(g, x, y + 6, 7));
    g.restore();
    // Rim + north.
    g.beginPath(); g.arc(cx, cy, R - 0.5, 0, TAU);
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,236,205,0.55)'; g.stroke();
    const nx = cx + sn * (R - 9), ny = cy - cs * (R - 9);
    g.beginPath(); g.arc(nx, ny, 8.5, 0, TAU); g.fillStyle = 'rgba(16,12,8,0.9)'; g.fill();
    halo(g, '北', nx, ny + 0.5, 10.5, { weight: 800, color: C.accent });
    playerArrow(g, cx, cy, 0, 7.5);
  }

  _drawCompass(st) {
    const cv = this._compass;
    const f = this._fitCanvas(cv);
    if (!f) return;
    const g = cv.getContext('2d'), { w, h, dpr } = f;
    const p = st.player;
    const heading = wrapPI(-p.yaw);                // bearing, clockwise from north (-z)
    const range = 1.35;                            // ± radians shown
    const ppr = (w / 2) / range;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // Background with faded ends.
    const bg = g.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, 'rgba(20,16,12,0)'); bg.addColorStop(0.12, 'rgba(20,16,12,0.7)');
    bg.addColorStop(0.88, 'rgba(20,16,12,0.7)'); bg.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const NAMES = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    const base = h - 3;
    for (let d = 0; d < 360; d += 15) {
      const rel = wrapPI(d * Math.PI / 180 - heading);
      if (Math.abs(rel) > range) continue;
      const x = w / 2 + rel * ppr;
      const fade = clamp((range - Math.abs(rel)) / 0.35, 0, 1);
      g.globalAlpha = fade;
      if (d % 45 === 0) {
        const card = d % 90 === 0;
        halo(g, NAMES[d / 45], x, base - 12, card ? 14 : 11.5, { weight: card ? 800 : 700, color: d === 0 ? C.accent : C.ink });
        g.fillStyle = C.ink; g.fillRect(x - 1, base - 3, 2, 3);
      } else {
        g.fillStyle = 'rgba(251,245,234,0.7)'; g.fillRect(x - 0.75, base - 5, 1.5, 5);
      }
    }
    g.globalAlpha = 1;
    const mark = (x, z, draw) => {
      const dx = x - p.x, dz = z - p.z;
      const rel = wrapPI(Math.atan2(dx, -dz) - heading);
      const cl = clamp(rel, -range + 0.08, range - 0.08);
      draw(w / 2 + cl * ppr, Math.abs(rel) > range - 0.08, Math.hypot(dx, dz));
    };
    for (const vp of st.viewpoints) {
      if (vp.climbed) continue;
      const d = Math.hypot(vp.x - p.x, vp.z - p.z);
      if (d > 320 || d < 4) continue;
      mark(vp.x, vp.z, (x, clipped) => { if (!clipped) towerBadge(g, x, 9, 6.5, false); });
    }
    if (this.waypoint) mark(this.waypoint.x, this.waypoint.z, (x, clipped, d) => {
      waypointPin(g, x, 16, 7);
      if (!clipped) halo(g, `${Math.round(d)}m`, x + 12, 9, 10.5, { align: 'left', weight: 700, color: '#cdeeff' });
    });
    if (st.objective) mark(st.objective.x, st.objective.z, (x, clipped, d) => {
      objectiveIcon(g, x, 9, 5.5, 0);
      if (!clipped) halo(g, `${Math.round(d)}m`, x + 10, 9, 10.5, { align: 'left', weight: 700, color: '#ffe0a6' });
    });
    // Centre notch.
    g.fillStyle = C.accent;
    g.beginPath(); g.moveTo(w / 2 - 5, h); g.lineTo(w / 2 + 5, h); g.lineTo(w / 2, h - 6); g.closePath(); g.fill();
  }
}
