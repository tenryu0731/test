// 入力: キーボード・マウス（ポインタロック）と、スマートフォンのタッチ操作
import { clamp, isTouch } from './config.js';

export class Input {
  constructor(canvas, touchRoot) {
    this.keys = new Set();
    this.look = [0, 0];
    this.stick = [0, 0];
    this.btn = { gas: false, brake: false, hb: false };
    this.pressed = new Set();   // このフレームで押されたもの（enter, cam, horn, pause）
    this.canvas = canvas;
    this.touch = isTouch;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyF: 'enter', KeyE: 'enter', KeyC: 'cam', KeyH: 'horn', Escape: 'pause', KeyP: 'pause', KeyM: 'map' };
      if (map[e.code]) this.pressed.add(map[e.code]);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.look[0] += e.movementX; this.look[1] += e.movementY; }
    });
    canvas.addEventListener('click', () => { if (!this.touch && this.active && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
    if (this.touch) this.buildTouch(touchRoot);
  }

  buildTouch(root) {
    root.innerHTML = `
      <div class="stick" id="stick"><div class="knob" id="knob"></div></div>
      <div class="tbtns">
        <button data-b="enter" class="tb wide" id="tb-enter">乗る</button>
        <button data-b="cam" class="tb">視点</button>
        <button data-b="horn" class="tb">ホーン</button>
        <button data-h="hb" class="tb hb" id="tb-hb">サイド<br>ブレーキ</button>
        <button data-h="brake" class="tb pedal brake" id="tb-brake">ブレーキ</button>
        <button data-h="gas" class="tb pedal gas" id="tb-gas">アクセル</button>
      </div>
      <button class="tb pause" data-b="pause">Ⅱ</button>`;
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    const R = 55;
    root.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const el = t.target.closest('button');
        if (el) {
          if (el.dataset.b) this.pressed.add(el.dataset.b);
          if (el.dataset.h) { this.btn[el.dataset.h] = true; el.classList.add('on'); el._tid = t.identifier; }
          continue;
        }
        if (t.clientX < innerWidth * 0.45 && sid === null) {
          sid = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx - 70 + 'px'; stick.style.top = sy - 70 + 'px'; stick.classList.add('on');
        } else if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          const dx = t.clientX - sx, dy = t.clientY - sy, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
          this.stick = [clamp(dx / R, -1, 1), clamp(-dy / R, -1, 1)];
          knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        } else if (t.identifier === lid) {
          this.look[0] += (t.clientX - lx) * 2.2; this.look[1] += (t.clientY - ly) * 2.2; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) { sid = null; this.stick = [0, 0]; knob.style.transform = ''; stick.classList.remove('on'); }
        if (t.identifier === lid) lid = null;
        for (const b of root.querySelectorAll('[data-h]')) if (b._tid === t.identifier) { this.btn[b.dataset.h] = false; b.classList.remove('on'); b._tid = null; }
      }
    };
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
    this.touchRoot = root;
  }

  setMode(mode) {
    if (!this.touchRoot) return;
    this.touchRoot.dataset.mode = mode;
    this.touchRoot.querySelector('#tb-enter').textContent = mode === 'car' ? '降りる' : '乗る';
  }

  // 1 フレーム分の入力をまとめて返す
  read() {
    const k = (c) => this.keys.has(c);
    const ax = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const ay = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let mx = ax + this.stick[0], my = ay + this.stick[1];
    let throttle = ay;
    if (this.touch) {
      throttle = (this.btn.gas ? 1 : 0) - (this.btn.brake ? 1 : 0);
      if (!this.btn.gas && !this.btn.brake) throttle = clamp(this.stick[1] * 1.2, -1, 1);
    }
    const out = {
      moveX: clamp(mx, -1, 1), moveY: clamp(my, -1, 1),
      steer: clamp(ax + this.stick[0] * 1.15, -1, 1),
      throttle: clamp(throttle, -1, 1),
      handbrake: k('Space') || this.btn.hb,
      run: k('ShiftLeft') || k('ShiftRight') || Math.hypot(...this.stick) > 0.92,
      lookX: this.look[0], lookY: this.look[1],
      pressed: this.pressed,
    };
    this.look = [0, 0];
    this.pressed = new Set();
    return out;
  }
}
