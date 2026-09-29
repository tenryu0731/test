// HUD + overlays (start / pause / win / lose). See docs/CONTRACT.md → ui.js.
// The per-frame setters only touch the DOM when the displayed value actually changes.
import { Input } from './input.js';

const TITLE = 'サン・ジミニャーノ市街戦';
const SUBTITLE = 'San Gimignano Streets';
const BRIEFING = '昼下がりの旧市街に配備された訓練用ロボット 5 体をすべて停止させよ。';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const ROBOT_PIP = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="9.2" y="1.5" width="1.6" height="3"/><circle cx="10" cy="1.9" r="1.7"/><rect x="2.5" y="4.5" width="15" height="10.5" rx="3.2"/><circle class="eye" cx="7.3" cy="9.6" r="1.9"/><circle class="eye" cx="12.7" cy="9.6" r="1.9"/><rect x="6" y="16" width="8" height="3.2" rx="1.2"/></svg>';

function tryImmersive() {
  // Fullscreen + landscape lock on phones. Must run inside the user gesture; never blocks.
  try {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) { lockLandscape(); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { lockLandscape(); return; }
    const p = req.call(el, { navigationUI: 'hide' });
    if (p && p.then) p.then(lockLandscape, () => {}); else lockLandscape();
  } catch { /* unsupported */ }
}
function lockLandscape() {
  try { const p = screen.orientation?.lock?.('landscape'); p?.catch?.(() => {}); } catch { /* unsupported */ }
}

export class UI {
  constructor(root, { isTouch = false } = {}) {
    this.root = root;
    this.isTouch = !!isTouch || new URLSearchParams(location.search).has('touch');
    this.input = null;
    root.classList.add(this.isTouch ? 'is-touch' : 'is-desktop');
    root.innerHTML = `
      <div class="vignette" aria-hidden="true"></div>
      <div class="dmg-layer" aria-hidden="true"></div>
      <div class="hud" hidden>
        <div class="hud-hp hud-panel">
          <div class="hp-label">HP</div>
          <div class="hp-bar"><div class="hp-fill"></div></div>
          <div class="hp-num">100</div>
        </div>
        <div class="hud-enemies hud-panel">
          <div class="en-text">残り <b class="en-rem">5</b><span class="en-tot">/5</span></div>
          <div class="en-pips"></div>
        </div>
        <div class="hud-ammo hud-panel">
          <div class="ammo-text"><b class="ammo-mag">24</b><span class="ammo-sep"> / </span><span class="ammo-res">96</span></div>
          <div class="ammo-reload"><i></i><span>リロード中</span></div>
        </div>
        <div class="crosshair" aria-hidden="true">
          <i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b class="ch-dot"></b>
        </div>
        <div class="hitmarker" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="toasts" aria-live="polite"></div>
      <div class="overlay" hidden></div>`;

    const q = (s) => root.querySelector(s);
    this.el = {
      hud: q('.hud'), vignette: q('.vignette'), dmg: q('.dmg-layer'),
      hp: q('.hud-hp'), hpFill: q('.hp-fill'), hpNum: q('.hp-num'),
      enRem: q('.en-rem'), enTot: q('.en-tot'), enPips: q('.en-pips'),
      ammo: q('.hud-ammo'), ammoMag: q('.ammo-mag'), ammoRes: q('.ammo-res'),
      crosshair: q('.crosshair'), hit: q('.hitmarker'),
      toasts: q('.toasts'), overlay: q('.overlay'),
    };
    this._v = { hp: -1, hpMax: -1, mag: -1, res: -1, reloading: null, rem: -1, tot: -1, spread: -1 };
    this._hitAnim = null;
  }

  /** Optional explicit wiring for the pause-menu sensitivity slider (falls back to Input.current). */
  bindInput(input) { this.input = input; }
  _getInput() { return this.input || Input.current; }

  // ------------------------------------------------------------------ overlays
  _overlay(cls, html) {
    const ov = this.el.overlay;
    ov.className = `overlay ${cls}`;
    ov.innerHTML = `<div class="panel scrollable">${html}</div>`;
    ov.hidden = false;
    this.el.toasts.classList.add('behind');
    return ov;
  }

  /** Attach a handler that runs synchronously inside the user gesture, only once. */
  _onActivate(btn, fn) {
    let done = false;
    const go = (e) => {
      if (done) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      done = true;
      fn();
    };
    btn.addEventListener('click', go);
    btn.addEventListener('keydown', go);
  }

  _controlsHTML() {
    if (this.isTouch) {
      return `
        <div class="diagram" aria-label="タッチ操作の説明">
          <div class="dg-half dg-left"><div class="dg-joy"><i></i></div><span class="dg-cap"><b>移動</b>左側をドラッグ<br><small>大きく倒すとダッシュ</small></span></div>
          <div class="dg-half dg-right"><span class="dg-cap dg-look"><b>視点</b>右側をドラッグ</span></div>
          <div class="dg-btn dg-fire"><span>射撃</span></div>
          <div class="dg-btn dg-reload"><span>リロード</span></div>
          <div class="dg-btn dg-jump"><span>ジャンプ</span></div>
          <div class="dg-note">射撃ボタンを押したまま指を動かすと狙いを調整できます</div>
        </div>`;
    }
    const k = (keys, label) => `<li><span class="keys">${keys.map((x) => `<kbd>${x}</kbd>`).join('')}</span><span>${label}</span></li>`;
    return `
      <ul class="keylist">
        ${k(['W', 'A', 'S', 'D'], '移動（矢印キーも可）')}
        ${k(['マウス'], '視点')}
        ${k(['左クリック'], '射撃（長押しで連射）')}
        ${k(['R'], 'リロード')}
        ${k(['Space'], 'ジャンプ')}
        ${k(['Shift'], 'ダッシュ')}
        ${k(['Esc'], '一時停止')}
      </ul>`;
  }

  showStart(onStart) {
    const ov = this._overlay('ov-start', `
      <div class="start-grid">
        <div class="start-main">
          <div class="kicker">訓練任務 · トスカーナ</div>
          <h1 class="title">${TITLE}</h1>
          <div class="subtitle">${SUBTITLE}</div>
          <p class="brief">${BRIEFING}</p>
          <button type="button" class="btn-primary" data-act="start">出撃する</button>
          ${this.isTouch ? '<p class="hint">横向きの全画面でプレイできます</p>' : '<p class="hint">クリックでマウス操作を開始します</p>'}
        </div>
        <div class="start-controls">${this._controlsHTML()}</div>
      </div>`);
    this._onActivate(ov.querySelector('[data-act="start"]'), () => {
      if (this.isTouch) tryImmersive();
      onStart();
    });
  }

  showPause(onResume) {
    const input = this._getInput();
    const sens = input ? input.sensitivity : 1;
    const ov = this._overlay('ov-pause', `
      <h2 class="ov-title">一時停止</h2>
      <label class="slider">
        <span class="slider-head"><span>視点感度</span><output>${sens.toFixed(2)}</output></span>
        <input type="range" min="0.5" max="2" step="0.05" value="${sens}" aria-label="視点感度">
        <span class="slider-scale"><span>低</span><span>標準</span><span>高</span></span>
      </label>
      <button type="button" class="btn-primary" data-act="resume">再開する</button>
      ${this.isTouch ? '' : '<p class="hint">Esc キーでいつでも一時停止できます</p>'}`);
    const range = ov.querySelector('input[type=range]');
    const out = ov.querySelector('output');
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      out.textContent = v.toFixed(2);
      const inp = this._getInput();
      if (inp) { if (inp.setSensitivity) inp.setSensitivity(v); else inp.sensitivity = v; }
    });
    this._onActivate(ov.querySelector('[data-act="resume"]'), () => {
      if (this.isTouch) tryImmersive();
      onResume();
    });
  }

  _result(won, stats, onRestart) {
    const s = stats || {};
    const total = s.total ?? 5;
    const killed = s.killed ?? (won ? total : 0);
    const acc = Math.round((s.accuracy || 0) * 100);
    const ov = this._overlay(won ? 'ov-win' : 'ov-lose', `
      <div class="result-badge">${won ? '任務完了' : '任務失敗'}</div>
      <h2 class="ov-title">${won ? '全ロボット停止！' : '行動不能…'}</h2>
      <p class="brief">${won ? 'サン・ジミニャーノの訓練区域を制圧しました。' : '訓練ロボットに押し返されました。もう一度挑戦しよう。'}</p>
      <dl class="stats">
        <div><dt>タイム</dt><dd>${mmss(s.time)}</dd></div>
        <div><dt>命中率</dt><dd>${acc}<small>%</small></dd></div>
        <div><dt>残りHP</dt><dd>${Math.max(0, Math.round(s.hpLeft || 0))}</dd></div>
        <div><dt>停止数</dt><dd>${killed}<small>/${total}</small></dd></div>
      </dl>
      <button type="button" class="btn-primary" data-act="restart">もう一度</button>`);
    this._onActivate(ov.querySelector('[data-act="restart"]'), () => {
      if (this.isTouch) tryImmersive();
      onRestart();
    });
  }
  showWin(stats, onRestart) { this.setHUDVisible(false); this._result(true, stats, onRestart); }
  showLose(stats, onRestart) { this.setHUDVisible(false); this._result(false, stats, onRestart); }

  hideOverlays() {
    this.el.overlay.hidden = true;
    this.el.overlay.innerHTML = '';
    this.el.toasts.classList.remove('behind');
  }

  setHUDVisible(v) {
    this.el.hud.hidden = !v;
    if (!v) { this.el.vignette.style.opacity = '0'; this.el.dmg.replaceChildren(); }
    else this._applyVignette();
  }

  // ------------------------------------------------------------------ HUD setters (per frame)
  setHP(hp, max = 100) {
    hp = Math.max(0, Math.ceil(hp));
    if (hp === this._v.hp && max === this._v.hpMax) return;
    const prev = this._v.hp;
    this._v.hp = hp; this._v.hpMax = max;
    const r = max > 0 ? hp / max : 0;
    this.el.hpFill.style.transform = `scaleX(${r})`;
    this.el.hpNum.textContent = hp;
    this.el.hp.classList.toggle('warn', r <= 0.5 && r > 0.25);
    this.el.hp.classList.toggle('low', r <= 0.25);
    if (prev > hp && prev >= 0) this.el.hp.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 180 });
    this._applyVignette();
  }

  _applyVignette() {
    const r = this._v.hpMax > 0 ? this._v.hp / this._v.hpMax : 1;
    const o = r >= 0.4 ? 0 : Math.min(1, (0.4 - r) / 0.3);
    this.el.vignette.style.opacity = this.el.hud.hidden ? '0' : o.toFixed(2);
    this.el.vignette.classList.toggle('pulse', r > 0 && r <= 0.2);
  }

  setAmmo(mag, reserve, reloading) {
    reloading = !!reloading;
    const v = this._v;
    if (mag !== v.mag) {
      v.mag = mag; this.el.ammoMag.textContent = mag;
      this.el.ammo.classList.toggle('empty', mag === 0);
      this.el.ammo.classList.toggle('lowmag', mag > 0 && mag <= 6);
    }
    if (reserve !== v.res) { v.res = reserve; this.el.ammoRes.textContent = reserve; }
    if (reloading !== v.reloading) { v.reloading = reloading; this.el.ammo.classList.toggle('reloading', reloading); }
  }

  setEnemies(remaining, total) {
    const v = this._v;
    if (total !== v.tot) {
      v.tot = total; v.rem = -1;
      this.el.enTot.textContent = `/${total}`;
      this.el.enPips.innerHTML = Array.from({ length: total }, () => `<span class="pip">${ROBOT_PIP}</span>`).join('');
    }
    if (remaining !== v.rem) {
      v.rem = remaining;
      this.el.enRem.textContent = remaining;
      const pips = this.el.enPips.children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('down', i >= remaining);
    }
  }

  setCrosshairSpread(px) {
    const s = Math.round(Math.min(60, Math.max(2, px)) * 2) / 2;
    if (s === this._v.spread) return;
    this._v.spread = s;
    this.el.crosshair.style.setProperty('--gap', `${s}px`);
  }

  // ------------------------------------------------------------------ feedback
  hitMarker(killed) {
    const el = this.el.hit;
    el.classList.toggle('kill', !!killed);
    this._hitAnim?.cancel();
    if (el.animate) {
      this._hitAnim = el.animate(killed
        ? [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1.5) rotate(45deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.15) rotate(45deg)', offset: 0.35 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2) rotate(45deg)' }]
        : [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1.15) rotate(45deg)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(0.9) rotate(45deg)' }],
      { duration: killed ? 520 : 220, easing: 'ease-out' });
    }
  }

  damageIndicator(angle) {
    const layer = this.el.dmg;
    while (layer.childElementCount >= 4) layer.firstElementChild.remove();
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    arc.innerHTML = '<i></i>';
    layer.appendChild(arc);
    const done = () => arc.remove();
    if (arc.animate) {
      arc.firstElementChild.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 1300, easing: 'ease-out' }).onfinish = done;
    } else setTimeout(done, 1300);
  }

  toast(text) {
    const box = this.el.toasts;
    while (box.childElementCount >= 3) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = esc(text);
    box.appendChild(t);
    const done = () => t.remove();
    if (t.animate) {
      t.animate([
        { opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none', offset: 0.08 },
        { opacity: 1, transform: 'none', offset: 0.82 }, { opacity: 0, transform: 'translateY(-4px)' },
      ], { duration: 2600, easing: 'ease-out' }).onfinish = done;
    } else setTimeout(done, 2600);
  }
}
