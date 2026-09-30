// Input: touch controls (floating joystick, drag-to-look, FIRE / AIM / RELOAD / JUMP, lean toggles,
// contextual interact button) and desktop keyboard + pointer-lock mouse.
//
// Touch uses Pointer Events, tracked per pointerId, so any combination of fingers works
// (move + look + fire at once). Touch controls are created inside #touch when the device is
// touch-capable, or when the URL contains `?touch` (handy for testing with a mouse).
//
// Public state read by main.js every frame:
//   move {x, y}, sprint, fireHeld, aim (0/1 target), lean (-1/0/1), sensitivity
//   consumeLook(), consumeReload(), consumeJump(), consumeInteract()
// Callbacks set by main.js: onPause(), onMap()  (M key; the touch map opens from the minimap).

const SENS_KEY = 'sg-fps-sensitivity';
const MOUSE_RAD_PER_PX = 0.0022;
// Touch look: radians per CSS pixel = TOUCH_LOOK / longest screen side. On an 844-px-wide phone a
// swipe across the right half turns ~115°, independent of the screen's pixel density.
const TOUCH_LOOK = 4.2;
const TOUCH_LOOK_Y = 0.8;        // vertical look slightly slower than horizontal
const DEAD_ZONE = 0.12;          // joystick dead zone (fraction of radius)
const SPRINT_AT = 0.9;           // pushing the knob past 90 % of its radius = sprint

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function readSens() {
  try { const v = parseFloat(localStorage.getItem(SENS_KEY)); if (v >= 0.5 && v <= 2) return v; } catch { /* storage blocked */ }
  return 1;
}

const ICONS = {
  fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M19.5 3.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  leanL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5 8.5 12 15 19.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  leanR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 15.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  climb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V4M17 21V4M7 8h10M7 13h10M7 18h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

export class Input {
  /** Most recently created instance (lets ui.js reach the sensitivity without extra wiring). */
  static current = null;

  constructor(canvas, { isTouch = false } = {}) {
    Input.current = this;
    this.canvas = canvas;
    const forceTouch = new URLSearchParams(location.search).has('touch');
    this.isTouch = !!isTouch || forceTouch;

    this.move = { x: 0, y: 0 };
    this.sprint = false;
    this.sensitivity = readSens();
    /** Optional: main sets `input.onPause = pause` so the on-screen pause button works. */
    this.onPause = null;
    /** Optional: main sets `input.onMap` (M key while playing). */
    this.onMap = null;

    this._enabled = false;
    this._lookX = 0; this._lookY = 0;
    this._reload = false; this._jump = false; this._interact = false;
    this._keys = new Set();
    this._keyMove = { x: 0, y: 0 };
    this._keySprint = false;
    this._mouseFire = false;
    this._mouseAim = false;
    this._aimToggle = false;         // touch AIM button (toggle)
    this._leanToggle = 0;            // touch lean buttons (toggle: -1 / 0 / 1)
    this._interactLabel = null;
    this._joy = { x: 0, y: 0, sprint: false };
    this._pointers = new Map(); // pointerId -> { role, x, y, el? }

    this._preventBrowserGestures();
    this._initKeyboardMouse();
    if (this.isTouch) this._initTouch();
  }

  // ---------------------------------------------------------------- public API
  get enabled() { return this._enabled; }
  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    if (!v) this.reset();
    this.touchRoot?.classList.toggle('active', v);
  }

  get fireHeld() {
    if (!this._enabled) return false;
    if (this._mouseFire) return true;
    for (const p of this._pointers.values()) if (p.role === 'fire') return true;
    return false;
  }
  set fireHeld(v) { if (!v) this._mouseFire = false; }

  /** Aim-down-sights target: 1 while the right mouse button is held or the touch AIM toggle is on. */
  get aim() { return this._enabled && (this._mouseAim || this._aimToggle) ? 1 : 0; }
  /** Lean target: -1 left, 0 none, 1 right (Q / E held, or the touch lean toggles). */
  get lean() {
    if (!this._enabled) return 0;
    const k = this._keys;
    const kl = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    return kl || this._leanToggle;
  }

  /** Helicopter controls: climb (Space / touch ▲) and descend (C or Ctrl / touch ▼) while held. */
  get upHeld() { return this._enabled && (this._keys.has('Space') || this._held('up')); }
  get downHeld() { return this._enabled && (this._keys.has('KeyC') || this._keys.has('ControlLeft') || this._held('down')); }
  _held(role) { for (const p of this._pointers.values()) if (p.role === role) return true; return false; }
  /** Secondary weapon in a vehicle (rockets / machine gun): right mouse button or the touch button. */
  get fire2Held() { return this._enabled && (this._mouseAim || this._held('fire2')); }
  /** In a vehicle ('heli' | 'tank' | null): swap the on-foot touch buttons for the vehicle's. */
  setVehicle(kind) {
    this.vehicle = kind || null;
    const r = this.touchRoot;
    if (!r) return;
    r.classList.toggle('veh', !!kind); r.classList.toggle('fly', kind === 'heli'); r.classList.toggle('drive', kind === 'tank');
    const fire = r.querySelector('.tbtn-fire span'), f2 = r.querySelector('.tbtn-fire2 span');
    if (fire) fire.textContent = kind === 'heli' ? '機関砲' : kind === 'tank' ? '主砲' : '射撃';
    if (f2) f2.textContent = kind === 'heli' ? 'ロケット' : '機銃';
  }
  setFlying(v) { this.setVehicle(v ? 'heli' : null); }

  /** Drop the touch toggles (e.g. when a round restarts or the player climbs a tower). */
  clearToggles() {
    this._aimToggle = false; this._leanToggle = 0;
    this._syncToggleUI();
  }

  setSensitivity(v) {
    this.sensitivity = clamp(+v || 1, 0.5, 2);
    try { localStorage.setItem(SENS_KEY, String(this.sensitivity)); } catch { /* ignore */ }
  }

  /** Show the contextual interact button (touch) with a label such as 「登る」, or hide it (null). */
  setInteract(label) {
    label = label || null;
    if (label === this._interactLabel) return;
    this._interactLabel = label;
    if (!this._interactEl) return;
    this._interactEl.classList.toggle('shown', !!label);
    if (label) this._interactEl.querySelector('span').textContent = label;
    this._interactEl.setAttribute('aria-hidden', label ? 'false' : 'true');
  }

  consumeLook() {
    const r = { dx: this._lookX, dy: this._lookY };
    this._lookX = this._lookY = 0;
    return this._enabled ? r : { dx: 0, dy: 0 };
  }
  consumeReload() { const r = this._reload; this._reload = false; return r && this._enabled; }
  consumeJump() { const r = this._jump; this._jump = false; return r && this._enabled; }
  consumeInteract() { const r = this._interact; this._interact = false; return r && this._enabled; }

  lockPointer() {
    if (this.isTouch) return;
    try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed right now */ }
  }

  reset() {
    this._lookX = this._lookY = 0;
    this._reload = this._jump = this._interact = false;
    this._mouseFire = false; this._mouseAim = false;
    this._keys.clear();
    this._keyMove.x = this._keyMove.y = 0;
    this._keySprint = false;
    for (const [id] of this._pointers) this._release(id);
    this._pointers.clear();
    this._joy.x = this._joy.y = 0; this._joy.sprint = false;
    this._syncMove();
    this._hideJoystick();
    this.touchRoot?.querySelectorAll('.pressed').forEach((b) => b.classList.remove('pressed'));
  }

  // ---------------------------------------------------------------- shared
  _syncMove() {
    const joyActive = this._joy.x !== 0 || this._joy.y !== 0;
    if (joyActive) {
      this.move.x = this._joy.x; this.move.y = this._joy.y;
      this.sprint = this._joy.sprint || this._keySprint;
    } else {
      this.move.x = this._keyMove.x; this.move.y = this._keyMove.y;
      this.sprint = this._keySprint;
    }
  }

  _preventBrowserGestures() {
    const inScrollable = (t) => t instanceof Element && !!t.closest('input, .scrollable');
    document.addEventListener('touchmove', (e) => { if (!inScrollable(e.target) && e.cancelable) e.preventDefault(); }, { passive: false });
    // A second finger landing would otherwise start pinch-zoom on some browsers.
    document.addEventListener('touchstart', (e) => { if (e.touches.length > 1 && !inScrollable(e.target) && e.cancelable) e.preventDefault(); }, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('selectstart', (e) => { if (!(e.target instanceof Element && e.target.closest('input'))) e.preventDefault(); });
    addEventListener('blur', () => this.reset());
  }

  // ---------------------------------------------------------------- keyboard / mouse
  _initKeyboardMouse() {
    const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'KeyM', 'KeyC', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'Tab']);
    addEventListener('keydown', (e) => {
      if (e.target instanceof Element && e.target.closest('input')) return;
      if (GAME_KEYS.has(e.code) && this._enabled) e.preventDefault();
      this._keys.add(e.code);
      if (!e.repeat && this._enabled) {
        if (e.code === 'KeyR') this._reload = true;
        if (e.code === 'Space') this._jump = true;
        if (e.code === 'KeyF') this._interact = true;
        if (e.code === 'KeyM' || e.code === 'Tab') this.onMap?.();
      }
      this._updateKeys();
    });
    addEventListener('keyup', (e) => { this._keys.delete(e.code); this._updateKeys(); });

    document.addEventListener('mousemove', (e) => {
      if (!this._enabled || !document.pointerLockElement) return;
      // Guard against the occasional huge spike some browsers emit when the lock engages.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      const k = MOUSE_RAD_PER_PX * this.sensitivity;
      this._lookX += e.movementX * k;
      this._lookY -= e.movementY * k;
    });
    if (!this.isTouch) {
      document.addEventListener('mousedown', (e) => {
        if (!this._enabled) return;
        if (e.target instanceof Element && e.target.closest('#ui button, #ui input, #ui .clickable')) return;
        // Playing without the pointer lock (e.g. it was refused after closing the map with Esc):
        // the click only re-engages the lock, it does not shoot.
        if (!document.pointerLockElement) { this.lockPointer(); return; }
        if (e.button === 0) this._mouseFire = true;
        if (e.button === 2) this._mouseAim = true;
      });
      addEventListener('mouseup', (e) => {
        if (e.button === 0) this._mouseFire = false;
        if (e.button === 2) this._mouseAim = false;
      });
      document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { this._mouseAim = false; this._mouseFire = false; } });
    }
  }

  _updateKeys() {
    const k = this._keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    this._keyMove.x = x / l; this._keyMove.y = y / l;
    this._keySprint = k.has('ShiftLeft') || k.has('ShiftRight');
    this._syncMove();
  }

  // ---------------------------------------------------------------- touch
  _initTouch() {
    const root = document.getElementById('touch') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'touch' }));
    this.touchRoot = root;
    root.classList.add('touch-on');
    root.innerHTML = `
      <div class="joy" aria-hidden="true"><div class="joy-ring"></div><div class="joy-knob"></div></div>
      <button type="button" class="tbtn tbtn-fire" data-role="fire" aria-label="射撃">${ICONS.fire}<span>射撃</span></button>
      <button type="button" class="tbtn tbtn-aim" data-role="aim" aria-label="狙う（切り替え）" aria-pressed="false">${ICONS.aim}<span>狙う</span></button>
      <button type="button" class="tbtn tbtn-reload" data-role="reload" aria-label="リロード">${ICONS.reload}<span>リロード</span></button>
      <button type="button" class="tbtn tbtn-jump" data-role="jump" aria-label="ジャンプ">${ICONS.jump}<span>ジャンプ</span></button>
      <div class="lean-pad" aria-label="覗き込み">
        <button type="button" class="tbtn tbtn-lean" data-role="leanL" aria-label="左に覗く" aria-pressed="false">${ICONS.leanL}<span>左</span></button>
        <button type="button" class="tbtn tbtn-lean" data-role="leanR" aria-label="右に覗く" aria-pressed="false">${ICONS.leanR}<span>右</span></button>
        <em class="lean-cap">覗く</em>
      </div>
      <button type="button" class="tbtn tbtn-veh tbtn-fire2" data-role="fire2" aria-label="副武装">${ICONS.fire}<span>機銃</span></button>
      <button type="button" class="tbtn tbtn-fly tbtn-up" data-role="up" aria-label="上昇">${ICONS.jump}<span>上昇</span></button>
      <button type="button" class="tbtn tbtn-fly tbtn-down" data-role="down" aria-label="下降"><span class="flip">${ICONS.jump}</span><span>下降</span></button>
      <button type="button" class="tbtn tbtn-interact" data-role="interact" aria-hidden="true">${ICONS.climb}<span>登る</span></button>
      <button type="button" class="tbtn tbtn-pause" data-role="pause" aria-label="一時停止">${ICONS.pause}</button>`;
    this._joyEl = root.querySelector('.joy');
    this._knobEl = root.querySelector('.joy-knob');
    this._interactEl = root.querySelector('.tbtn-interact');
    this._aimEl = root.querySelector('.tbtn-aim');
    this._leanEls = { '-1': root.querySelector('[data-role="leanL"]'), 1: root.querySelector('[data-role="leanR"]') };
    this._leanPadEl = root.querySelector('.lean-pad');
    this._joyBase = { x: 0, y: 0, r: 60 };
    this._hideJoystick();

    const opts = { passive: false };
    root.addEventListener('pointerdown', (e) => this._onDown(e), opts);
    root.addEventListener('pointermove', (e) => this._onMove(e), opts);
    root.addEventListener('pointerup', (e) => this._onUp(e), opts);
    root.addEventListener('pointercancel', (e) => this._onUp(e), opts);
    root.addEventListener('lostpointercapture', (e) => this._onUp(e));
    addEventListener('resize', () => this._hideJoystick());
  }

  _syncToggleUI() {
    if (!this._aimEl) return;
    this._aimEl.classList.toggle('on', this._aimToggle);
    this._aimEl.setAttribute('aria-pressed', String(this._aimToggle));
    for (const s of [-1, 1]) {
      const el = this._leanEls[s];
      el.classList.toggle('on', this._leanToggle === s);
      el.setAttribute('aria-pressed', String(this._leanToggle === s));
    }
  }

  _joyRadius() { return clamp(Math.min(innerWidth, innerHeight) * 0.17, 48, 78); }

  _onDown(e) {
    if (e.cancelable) e.preventDefault();
    if (!this._enabled) return;
    // A primary pointer means no other finger is down: drop anything stale.
    if (e.isPrimary && this._pointers.size) { for (const [id] of this._pointers) this._release(id); this._pointers.clear(); this._setJoy(0, 0); this._hideJoystick(); }

    const btn = e.target instanceof Element ? e.target.closest('[data-role]') : null;
    let role = btn?.dataset.role;
    if (role === 'interact' && !this._interactLabel) role = null; // hidden button: treat as screen
    if (!role) {
      const hasRole = (r) => [...this._pointers.values()].some((p) => p.role === r);
      if (e.clientX < innerWidth / 2) role = hasRole('joy') ? null : 'joy';
      else role = hasRole('look') ? null : 'look';
    }
    if (!role) return;
    try { this.touchRoot.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const el = role === 'joy' || role === 'look' ? null : btn;
    const p = { role, x: e.clientX, y: e.clientY, el };
    this._pointers.set(e.pointerId, p);
    el?.classList.add('pressed');

    if (role === 'reload') this._reload = true;
    else if (role === 'jump') this._jump = true;
    else if (role === 'interact') this._interact = true;
    else if (role === 'aim') { this._aimToggle = !this._aimToggle; this._syncToggleUI(); }
    else if (role === 'leanL' || role === 'leanR') {
      const s = role === 'leanL' ? -1 : 1;
      this._leanToggle = this._leanToggle === s ? 0 : s;
      this._syncToggleUI();
    } else if (role === 'pause') { this._pause(); }
    else if (role === 'joy') this._showJoystick(e.clientX, e.clientY);
  }

  _onMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p || !this._enabled) return;
    if (e.cancelable) e.preventDefault();
    if (p.role === 'joy') { this._updateJoystick(e.clientX, e.clientY); return; }
    // FIRE and AIM double as look pads: keep the thumb down and slide to adjust the aim.
    if (p.role === 'look' || p.role === 'fire' || p.role === 'aim' || p.role === 'fire2') {
      // Raw deltas, no smoothing: the camera follows the finger 1:1.
      const k = TOUCH_LOOK / Math.max(innerWidth, innerHeight) * this.sensitivity;
      this._lookX += (e.clientX - p.x) * k;
      this._lookY -= (e.clientY - p.y) * k * TOUCH_LOOK_Y;
      p.x = e.clientX; p.y = e.clientY;
    }
  }

  _onUp(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._release(e.pointerId);
    this._pointers.delete(e.pointerId);
  }

  _release(id) {
    const p = this._pointers.get(id);
    if (!p) return;
    p.el?.classList.remove('pressed');
    if (p.role === 'joy') { this._setJoy(0, 0); this._hideJoystick(); }
  }

  _pause() {
    if (typeof this.onPause === 'function') { this.onPause(); return; }
    // Fallback until main wires `input.onPause`: main already pauses on visibilitychange when
    // document.hidden is true, so emulate a (momentary) hidden page.
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    } finally { delete document.hidden; }
  }

  _showJoystick(x, y) {
    const r = this._joyRadius();
    const m = r + 10;
    // Keep the ring below the lean buttons so it never covers them.
    const lp = this._leanPadEl?.getBoundingClientRect();
    const top = lp && lp.height ? Math.min(lp.bottom + r + 6, innerHeight - m) : m;
    x = clamp(x, m, innerWidth / 2 - 10); y = clamp(y, Math.max(m, top), innerHeight - m);
    this._joyBase = { x, y, r };
    this._placeJoy(x, y, r, true);
    this._knobEl.style.transform = 'translate3d(-50%, -50%, 0)';
  }

  _hideJoystick() {
    if (!this._joyEl) return;
    // Idle: a faint ring rests bottom-left as a hint of where to put the thumb.
    const r = this._joyRadius();
    const x = Math.max(r + 24, innerWidth * 0.16), y = innerHeight - r - Math.max(24, innerHeight * 0.1);
    this._placeJoy(x, y, r, false);
    this._knobEl.style.transform = 'translate3d(-50%, -50%, 0)';
  }

  _placeJoy(x, y, r, active) {
    const s = this._joyEl.style;
    s.width = s.height = `${r * 2}px`;
    s.transform = `translate3d(${x - r}px, ${y - r}px, 0)`;
    this._joyEl.classList.toggle('held', active);
  }

  _updateJoystick(x, y) {
    const b = this._joyBase;
    let dx = x - b.x, dy = y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > b.r) { dx *= b.r / d; dy *= b.r / d; }
    this._knobEl.style.transform = `translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0)`;
    const n = Math.min(1, d / b.r);
    if (n < DEAD_ZONE) { this._setJoy(0, 0); return; }
    const s = (n - DEAD_ZONE) / (1 - DEAD_ZONE) / n; // rescale so output starts at 0 past the dead zone
    this._setJoy((dx / b.r) * s, (-dy / b.r) * s, n >= SPRINT_AT);
    this._joyEl.classList.toggle('sprint', n >= SPRINT_AT);
  }

  _setJoy(x, y, sprint = false) {
    this._joy.x = x; this._joy.y = y; this._joy.sprint = sprint;
    if (!sprint) this._joyEl?.classList.remove('sprint');
    this._syncMove();
  }
}
