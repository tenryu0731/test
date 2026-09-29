// STUB — replaced by the UI agent. Desktop keyboard/mouse only.
export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.enabled = false; this.keys = new Set();
    this.move = { x: 0, y: 0 }; this.sprint = false; this.fireHeld = false;
    this.lx = 0; this.ly = 0; this.rl = false; this.jp = false;
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'KeyR') this.rl = true; if (e.code === 'Space') this.jp = true; this._upd(); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this._upd(); });
    addEventListener('mousemove', (e) => { if (this.enabled && document.pointerLockElement) { this.lx += e.movementX * 0.0022; this.ly -= e.movementY * 0.0022; } });
    addEventListener('mousedown', () => { if (this.enabled) this.fireHeld = true; });
    addEventListener('mouseup', () => { this.fireHeld = false; });
  }
  _upd() {
    const k = this.keys;
    this.move.x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.move.y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    this.sprint = k.has('ShiftLeft');
  }
  consumeLook() { const r = { dx: this.lx, dy: this.ly }; this.lx = this.ly = 0; return this.enabled ? r : { dx: 0, dy: 0 }; }
  consumeReload() { const r = this.rl; this.rl = false; return r && this.enabled; }
  consumeJump() { const r = this.jp; this.jp = false; return r && this.enabled; }
  lockPointer() { this.canvas.requestPointerLock?.(); }
  reset() { this.lx = this.ly = 0; this.fireHeld = false; this.rl = this.jp = false; }
}
