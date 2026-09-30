// HUD + overlays (start / pause / settings / custom difficulty / win / lose), overview-mode UI,
// fades and title cards. The per-frame setters only touch the DOM when the value changes.
// The full-screen map is built by map.js inside the same root; the minimap / compass canvases
// live here and are drawn by map.js.
import { Input } from './input.js';
import { DIFFICULTY, makeCustomDifficulty } from './difficulty.js';
import { CUSTOM_ASPECTS, DIFFICULTY_CHOICES, QUALITY_CHOICES } from './settings.js';

const TITLE = 'サン・ジミニャーノ市街戦';
const SUBTITLE = 'San Gimignano · Toscana';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const diffInfo = (id, custom) => (id === 'custom' ? makeCustomDifficulty(custom) : DIFFICULTY[id] || DIFFICULTY.normal);

const ROBOT_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="9.2" y="1.5" width="1.6" height="3"/><circle cx="10" cy="1.9" r="1.7"/><rect x="2.5" y="4.5" width="15" height="10.5" rx="3.2"/><circle class="eye" cx="7.3" cy="9.6" r="1.9"/><circle class="eye" cx="12.7" cy="9.6" r="1.9"/><rect x="6" y="16" width="8" height="3.2" rx="1.2"/></svg>';
const TARGET_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.6" y="5.6" width="8.8" height="8.8" transform="rotate(45 10 10)"/></svg>';
const MAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5M15 6.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

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
    /** Set by main: called when the minimap is tapped / clicked. */
    this.onMapRequest = null;
    root.classList.add(this.isTouch ? 'is-touch' : 'is-desktop');
    root.innerHTML = `
      <div class="vignette" aria-hidden="true"></div>
      <div class="dmg-layer" aria-hidden="true"></div>
      <div class="hud" hidden>
        <div class="hud-hp hud-panel">
          <div class="hp-label">HP</div>
          <div class="hp-bar"><div class="hp-regen"></div><div class="hp-fill"></div></div>
          <div class="hp-num">100</div>
        </div>
        <div class="hud-top">
          <canvas class="hud-compass" aria-hidden="true"></canvas>
          <div class="hud-obj">
            <span class="obj-robots">${ROBOT_ICON}<span>残り <b class="en-rem">0</b><span class="en-tot">/0</span></span></span>
            <span class="obj-target"><i>${TARGET_ICON}</i><span class="obj-text"></span></span>
          </div>
        </div>
        <div class="hud-ammo hud-panel">
          <div class="ammo-text"><b class="ammo-mag">24</b><span class="ammo-sep"> / </span><span class="ammo-res">96</span></div>
          <div class="ammo-reload"><i></i><span>リロード中</span></div>
        </div>
        <button type="button" class="hud-minimap clickable" aria-label="地図を開く">
          <canvas aria-hidden="true"></canvas>
          <span class="mm-tag">${MAP_ICON}<span>地図</span>${this.isTouch ? '' : '<kbd>M</kbd>'}</span>
        </button>
        <div class="crosshair" aria-hidden="true">
          <i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b class="ch-dot"></b>
        </div>
        <div class="hitmarker" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="prompt" hidden><kbd>F</kbd><b class="pr-act">登る</b><span class="pr-name"></span></div>
        <div class="lock-hint" hidden>クリックして操作に戻る</div>
      </div>
      <div class="titlecard" hidden aria-live="polite"><small></small><b></b><span></span></div>
      <div class="toasts" aria-live="polite"></div>
      <div class="overview-ui" hidden>
        <div class="ovw-head">
          <div class="ovw-title"><b>俯瞰モード</b><span>ゲームは一時停止中です</span></div>
          <button type="button" class="btn-primary btn-sm" data-ovw="back">戻る</button>
        </div>
        <div class="ovw-tools">
          <button type="button" class="map-btn" data-ovw="me">現在地</button>
          <button type="button" class="map-btn" data-ovw="town">町の中心</button>
          <button type="button" class="map-btn map-round" data-ovw="in" aria-label="近づく">＋</button>
          <button type="button" class="map-btn map-round" data-ovw="out" aria-label="離れる">－</button>
        </div>
        <div class="ovw-hint">${this.isTouch
          ? '1本指で回転 · 2本指でピンチ拡大・移動'
          : 'ドラッグで回転 · 右ドラッグ / WASD で移動 · ホイールで拡大 · Esc で戻る'}</div>
      </div>
      <div class="fade" aria-hidden="true"></div>
      <div class="overlay" hidden></div>`;

    const q = (s) => root.querySelector(s);
    this.el = {
      hud: q('.hud'), vignette: q('.vignette'), dmg: q('.dmg-layer'), fade: q('.fade'),
      hp: q('.hud-hp'), hpFill: q('.hp-fill'), hpRegen: q('.hp-regen'), hpNum: q('.hp-num'),
      enRem: q('.en-rem'), enTot: q('.en-tot'), objText: q('.obj-text'), objTarget: q('.obj-target'),
      compass: q('.hud-compass'), minimap: q('.hud-minimap'), minimapCanvas: q('.hud-minimap canvas'),
      ammo: q('.hud-ammo'), ammoMag: q('.ammo-mag'), ammoRes: q('.ammo-res'),
      crosshair: q('.crosshair'), hit: q('.hitmarker'),
      prompt: q('.prompt'), promptAct: q('.pr-act'), promptName: q('.pr-name'), lockHint: q('.lock-hint'),
      title: q('.titlecard'), toasts: q('.toasts'), overlay: q('.overlay'), overview: q('.overview-ui'),
    };
    this._v = { hp: -1, hpMax: -1, mag: -1, res: -1, reloading: null, rem: -1, tot: -1, spread: -1, obj: null, aim: null, prompt: null, lock: null, regen: null };
    this._hitAnim = null;
    this._titleT = null;

    // Minimap = map button (tap / click). pointerup keeps it snappy on touch.
    const mm = this.el.minimap;
    let down = null;
    mm.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; e.stopPropagation(); });
    mm.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14) this.onMapRequest?.();
      down = null;
    });
    mm.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onMapRequest?.(); } });
  }

  /** Optional explicit wiring for the sensitivity slider (falls back to Input.current). */
  bindInput(input) { this.input = input; }
  _getInput() { return this.input || Input.current; }

  // ------------------------------------------------------------------ overlays
  _overlay(cls, html, { raw = false } = {}) {
    const ov = this.el.overlay;
    ov.className = `overlay ${cls}`;
    ov.innerHTML = raw ? html : `<div class="panel scrollable">${html}</div>`;
    ov.hidden = false;
    this.el.toasts.classList.add('behind');
    return ov;
  }

  /** Attach a handler that runs synchronously inside the user gesture, only once. */
  _onActivate(btn, fn, { once = true } = {}) {
    if (!btn) return;
    let done = false;
    const go = (e) => {
      if (done) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (once) done = true;
      fn(e);
    };
    btn.addEventListener('click', go);
    btn.addEventListener('keydown', go);
  }

  _controlsHTML() {
    if (this.isTouch) {
      const row = (icon, label, text) => `<li><span class="tc-ic ${icon}">${label}</span><span>${text}</span></li>`;
      return `
        <ul class="touchlist" aria-label="タッチ操作">
          ${row('tc-joy', '', '<b>左側をドラッグ</b> 移動（大きく倒すとダッシュ）')}
          ${row('tc-look', '', '<b>右側をドラッグ</b> 視点')}
          ${row('tc-fire', '射撃', '<b>射撃</b>・<b>狙う</b>・リロード・ジャンプは右下')}
          ${row('tc-lean', '覗', '<b>覗く</b> 左の「左」「右」で壁から顔を出す')}
          ${row('tc-map', '地図', '<b>地図</b> 右上のミニマップをタップ')}
          ${row('tc-act', '登る', '塔の足元で<b>登る</b>ボタンが出ます')}
        </ul>`;
    }
    const k = (keys, label) => `<li><span class="keys">${keys.map((x) => `<kbd>${x}</kbd>`).join('')}</span><span>${label}</span></li>`;
    return `
      <ul class="keylist">
        ${k(['W', 'A', 'S', 'D'], '移動（Shift でダッシュ）')}
        ${k(['マウス'], '視点 · 左クリックで射撃')}
        ${k(['右クリック'], '狙う（押している間）')}
        ${k(['Q', 'E'], '左右に覗く（壁から顔を出す）')}
        ${k(['R'], 'リロード · Space ジャンプ')}
        ${k(['F'], '登る / 降りる（展望ポイント）')}
        ${k(['M'], '地図 · Esc 一時停止')}
      </ul>`;
  }

  // ---------------------------------------------------------------- difficulty picker (shared)
  _diffPickerHTML(sel, custom) {
    const opts = DIFFICULTY_CHOICES.map((id) => {
      const d = diffInfo(id, custom);
      return `<button type="button" class="diff-opt${id === 'custom' ? ' diff-custom' : ''}" role="radio" aria-checked="${id === sel}" data-diff="${id}">${esc(d.label)}</button>`;
    }).join('');
    const d = diffInfo(sel, custom);
    return `
      <div class="diff" role="radiogroup" aria-label="難易度">
        <div class="diff-grid">${opts}</div>
        <p class="diff-desc"><b>${esc(d.label)}</b> ${esc(d.desc)}${sel === 'custom' ? ` <span class="diff-levels">${this._customSummary(custom)}</span>` : ''}</p>
      </div>`;
  }
  _customSummary(c) {
    return CUSTOM_ASPECTS.map((a) => `${a.label}: ${a.steps[c[a.key] ?? 2]}`).join(' / ');
  }
  _bindDiffPicker(root, onPick) {
    root.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); onPick(b.dataset.diff); }));
  }

  /** Custom difficulty editor. onDone(levels) or onDone(null) when cancelled. */
  showCustom(levels, onDone, { confirmLabel = '決定' } = {}) {
    const lv = { ...levels };
    const sliders = CUSTOM_ASPECTS.map((a) => `
      <label class="slider cs">
        <span class="slider-head"><span>${a.label}</span><output data-out="${a.key}">${esc(a.steps[lv[a.key]])}</output></span>
        <input type="range" min="0" max="4" step="1" value="${lv[a.key]}" data-key="${a.key}" aria-label="${a.label}">
        <span class="slider-scale"><span>やさしい</span><span>標準</span><span>きびしい</span></span>
      </label>`).join('');
    const ov = this._overlay('ov-custom', `
      <h2 class="ov-title">カスタム難易度</h2>
      <p class="sub">項目ごとに 5 段階で調整できます</p>
      <div class="custom-grid">${sliders}</div>
      <div class="row-actions">
        <button type="button" class="btn-ghost" data-act="cancel">戻る</button>
        <button type="button" class="btn-primary btn-sm" data-act="ok">${confirmLabel}</button>
      </div>`);
    ov.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
      const k = r.dataset.key, v = Math.round(+r.value);
      lv[k] = v;
      ov.querySelector(`[data-out="${k}"]`).textContent = CUSTOM_ASPECTS.find((a) => a.key === k).steps[v];
    }));
    this._onActivate(ov.querySelector('[data-act="ok"]'), () => onDone({ ...lv }));
    this._onActivate(ov.querySelector('[data-act="cancel"]'), () => onDone(null));
  }

  // ---------------------------------------------------------------- start
  /**
   * opts: { difficulty, custom, briefing, onStart(), onDifficulty(id, custom), onSettings() }
   */
  showStart(opts) {
    const { difficulty, custom } = opts;
    const ov = this._overlay('ov-start', `
      <div class="start-side panel scrollable">
        <div class="kicker">訓練任務 · トスカーナ</div>
        <h1 class="title">${TITLE}</h1>
        <div class="subtitle">${SUBTITLE}</div>
        <p class="brief">${esc(opts.briefing || '城壁の町と周辺の丘に配備された訓練用ロボット部隊をすべて停止させよ。')}</p>
        ${opts.modes ? `<div class="field"><div class="field-label">モード</div>
          <div class="diff" role="radiogroup" aria-label="モード"><div class="diff-grid mode-grid">${opts.modes.map((m) => `<button type="button" class="diff-opt mode-opt" role="radio" aria-checked="${m.id === opts.mode}" data-mode="${m.id}">${esc(m.label)}</button>`).join('')}</div>
          </div></div>` : ''}
        <div class="field"><div class="field-label">難易度</div>${this._diffPickerHTML(difficulty, custom)}</div>
        <div class="start-actions">
          <button type="button" class="btn-primary" data-act="start">出撃する</button>
          <button type="button" class="btn-ghost" data-act="settings">設定</button>
        </div>
        ${this.isTouch ? '<p class="hint">横向きの全画面でプレイできます</p>' : '<p class="hint">クリックでマウス操作を開始します</p>'}
      </div>
      <div class="start-controls panel">${this._controlsHTML()}</div>`, { raw: true });
    this._bindDiffPicker(ov, (id) => {
      if (id === 'custom') {
        this.showCustom(custom, (lv) => {
          if (lv) opts.onDifficulty('custom', lv);
          this.showStart({ ...opts, difficulty: lv ? 'custom' : difficulty, custom: lv || custom });
        });
        return;
      }
      opts.onDifficulty(id, custom);
      this.showStart({ ...opts, difficulty: id });
    });
    ov.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const m = b.dataset.mode;
      const next = opts.onMode ? opts.onMode(m) : null;
      this.showStart({ ...opts, ...(next || {}), mode: m });
    }));
    this._onActivate(ov.querySelector('[data-act="start"]'), () => {
      if (this.isTouch) tryImmersive();
      opts.onStart();
    });
    this._onActivate(ov.querySelector('[data-act="settings"]'), () => opts.onSettings());
  }

  // ---------------------------------------------------------------- pause
  /** opts: { onResume, onMap, onOverview, onSettings, onRestart, difficultyLabel, time } */
  showPause(opts) {
    const ov = this._overlay('ov-pause', `
      <h2 class="ov-title">一時停止</h2>
      <p class="sub">難易度: ${esc(opts.difficultyLabel || '')}${opts.time !== undefined ? ` · 経過 ${mmss(opts.time)}` : ''}</p>
      <button type="button" class="btn-primary" data-act="resume">再開する</button>
      <div class="menu-grid">
        <button type="button" class="btn-ghost" data-act="map">地図</button>
        <button type="button" class="btn-ghost" data-act="overview">俯瞰モード</button>
        <button type="button" class="btn-ghost" data-act="settings">設定</button>
        <button type="button" class="btn-ghost" data-act="restart">最初から</button>
      </div>
      ${this.isTouch ? '' : '<p class="hint">Esc キーでいつでも一時停止できます</p>'}`);
    this._onActivate(ov.querySelector('[data-act="resume"]'), () => { if (this.isTouch) tryImmersive(); opts.onResume(); });
    this._onActivate(ov.querySelector('[data-act="map"]'), () => opts.onMap());
    this._onActivate(ov.querySelector('[data-act="overview"]'), () => opts.onOverview());
    this._onActivate(ov.querySelector('[data-act="settings"]'), () => opts.onSettings());
    this._onActivate(ov.querySelector('[data-act="restart"]'), () => {
      this.showConfirm('最初からやり直しますか？', '現在の進行状況は失われます。', 'やり直す', () => { if (this.isTouch) tryImmersive(); opts.onRestart(); }, () => this.showPause(opts));
    });
  }

  /** In-page confirmation (no window.confirm). */
  showConfirm(title, text, okLabel, onYes, onNo) {
    const ov = this._overlay('ov-confirm', `
      <h2 class="ov-title">${esc(title)}</h2>
      ${text ? `<p class="brief">${esc(text)}</p>` : ''}
      <div class="row-actions">
        <button type="button" class="btn-ghost" data-act="no">キャンセル</button>
        <button type="button" class="btn-primary btn-sm" data-act="yes">${esc(okLabel)}</button>
      </div>`);
    this._onActivate(ov.querySelector('[data-act="yes"]'), onYes);
    this._onActivate(ov.querySelector('[data-act="no"]'), onNo);
  }

  // ---------------------------------------------------------------- settings
  /**
   * opts: { inRound, difficulty, custom, quality, volume, onDifficulty(id, custom), onQuality(q), onVolume(v), onBack() }
   * In a round a difficulty change asks for confirmation and restarts (main does the restart).
   */
  showSettings(opts) {
    const input = this._getInput();
    const sens = input ? input.sensitivity : 1;
    const vol = Math.round((opts.volume ?? 0.8) * 100);
    const ov = this._overlay('ov-settings', `
      <h2 class="ov-title">設定</h2>
      <div class="settings-grid">
        <div class="field field-diff"><div class="field-label">難易度${opts.inRound ? '<small>変更すると最初からやり直します</small>' : ''}</div>${this._diffPickerHTML(opts.difficulty, opts.custom)}
          ${opts.difficulty === 'custom' ? '<button type="button" class="btn-link" data-act="edit-custom">カスタムを調整する</button>' : ''}</div>
        <div class="field"><div class="field-label">画質</div>
          <div class="seg" role="radiogroup" aria-label="画質">${QUALITY_CHOICES.map(([id, label]) => `<button type="button" class="seg-opt" role="radio" aria-checked="${id === opts.quality}" data-q="${id}">${label}</button>`).join('')}</div>
          <p class="field-note">低くすると動作が軽くなります</p>
        </div>
        <label class="slider">
          <span class="slider-head"><span>視点感度</span><output data-out="sens">${sens.toFixed(2)}</output></span>
          <input type="range" min="0.5" max="2" step="0.05" value="${sens}" data-set="sens" aria-label="視点感度">
          <span class="slider-scale"><span>低</span><span>標準</span><span>高</span></span>
        </label>
        <label class="slider">
          <span class="slider-head"><span>音量</span><output data-out="vol">${vol}%</output></span>
          <input type="range" min="0" max="100" step="5" value="${vol}" data-set="vol" aria-label="音量">
          <span class="slider-scale"><span>ミュート</span><span>最大</span></span>
        </label>
      </div>
      <button type="button" class="btn-primary btn-sm" data-act="back">戻る</button>`);
    const again = (patch) => this.showSettings({ ...opts, ...patch });
    const pickDiff = (id, custom) => {
      if (!opts.inRound) { opts.onDifficulty(id, custom); again({ difficulty: id, custom }); return; }
      const label = diffInfo(id, custom).label;
      this.showConfirm(`難易度を「${label}」に変更しますか？`, '変更するとミッションを最初からやり直します。', 'やり直す',
        () => { if (this.isTouch) tryImmersive(); opts.onDifficulty(id, custom); },
        () => again({}));
    };
    this._bindDiffPicker(ov, (id) => {
      if (id === 'custom') {
        this.showCustom(opts.custom, (lv) => { if (lv) pickDiff('custom', lv); else again({}); }, { confirmLabel: opts.inRound ? '決定' : '決定' });
        return;
      }
      if (id === opts.difficulty) return;
      pickDiff(id, opts.custom);
    });
    ov.querySelector('[data-act="edit-custom"]')?.addEventListener('click', () => {
      this.showCustom(opts.custom, (lv) => { if (lv) pickDiff('custom', lv); else again({}); });
    });
    ov.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.q === opts.quality) return;
      opts.quality = b.dataset.q;
      ov.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      // The first switch to a preset recompiles shaders (brief hitch): say so, then apply.
      const note = ov.querySelector('.field-note');
      if (note) note.textContent = '適用中…';
      setTimeout(() => { opts.onQuality(b.dataset.q); setTimeout(() => { if (note) note.textContent = '低くすると動作が軽くなります'; }, 50); }, 40);
    }));
    const sr = ov.querySelector('[data-set="sens"]'), so = ov.querySelector('[data-out="sens"]');
    sr.addEventListener('input', () => {
      const v = parseFloat(sr.value);
      so.textContent = v.toFixed(2);
      const inp = this._getInput();
      if (inp) { if (inp.setSensitivity) inp.setSensitivity(v); else inp.sensitivity = v; }
    });
    const vr = ov.querySelector('[data-set="vol"]'), vo = ov.querySelector('[data-out="vol"]');
    vr.addEventListener('input', () => {
      const v = Math.round(+vr.value);
      vo.textContent = `${v}%`;
      opts.volume = v / 100;
      opts.onVolume(v / 100);
    });
    this._onActivate(ov.querySelector('[data-act="back"]'), () => opts.onBack());
  }

  // ---------------------------------------------------------------- results
  _result(won, stats, opts) {
    const s = stats || {};
    const total = s.total ?? 0;
    const killed = s.killed ?? (won ? total : 0);
    const acc = Math.round((s.accuracy || 0) * 100);
    const extra = [
      `残りHP ${Math.max(0, Math.round(s.hpLeft || 0))}`,
      s.viewpoints !== undefined ? `展望ポイント ${s.viewpoints}` : '',
      s.pickups !== undefined ? `補給 ${s.pickups} 回` : '',
    ].filter(Boolean).join(' · ');
    const ov = this._overlay(won ? 'ov-win' : 'ov-lose', `
      <div class="result-badge">${won ? '任務完了' : '任務失敗'}</div>
      <h2 class="ov-title">${won ? '全ロボット停止！' : '行動不能…'}</h2>
      <p class="brief">${won ? 'サン・ジミニャーノ周辺の訓練区域を制圧しました。' : '訓練ロボットに押し返されました。もう一度挑戦しよう。'}</p>
      <dl class="stats">
        <div><dt>タイム</dt><dd>${mmss(s.time)}</dd></div>
        <div><dt>命中率</dt><dd>${acc}<small>%</small></dd></div>
        <div><dt>停止数</dt><dd>${killed}<small>/${total}</small></dd></div>
        <div><dt>難易度</dt><dd class="dd-text">${esc(s.difficulty || '')}</dd></div>
      </dl>
      <p class="stats-extra">${esc(extra)}</p>
      <div class="row-actions">
        <button type="button" class="btn-ghost" data-act="title">タイトルへ</button>
        <button type="button" class="btn-primary" data-act="restart">もう一度</button>
      </div>`);
    this._onActivate(ov.querySelector('[data-act="restart"]'), () => { if (this.isTouch) tryImmersive(); opts.onRestart(); });
    this._onActivate(ov.querySelector('[data-act="title"]'), () => opts.onTitle());
  }
  showWin(stats, opts) { this.setHUDVisible(false); this._result(true, stats, opts); }
  showLose(stats, opts) { this.setHUDVisible(false); this._result(false, stats, opts); }

  hideOverlays() {
    this.el.overlay.hidden = true;
    this.el.overlay.innerHTML = '';
    this.el.toasts.classList.remove('behind');
  }

  // ---------------------------------------------------------------- overview UI
  showOverview(handlers) {
    const el = this.el.overview;
    el.hidden = false;
    this._ovwHandlers = handlers;
    if (!this._ovwBound) {
      this._ovwBound = true;
      el.addEventListener('click', (e) => {
        const b = e.target instanceof Element ? e.target.closest('[data-ovw]') : null;
        if (b) this._ovwHandlers?.[b.dataset.ovw]?.();
      });
    }
    return el;
  }
  hideOverview() { this.el.overview.hidden = true; }

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
    if (prev > hp && prev >= 0 && this._v.hpMax === max) this.el.hp.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 180 });
    this._applyVignette();
  }
  /** Regenerating: soft pulse on the HP bar. */
  setRegen(on) {
    on = !!on;
    if (on === this._v.regen) return;
    this._v.regen = on;
    this.el.hp.classList.toggle('regen', on);
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
    if (total !== v.tot) { v.tot = total; this.el.enTot.textContent = `/${total}`; }
    if (remaining !== v.rem) {
      const drop = v.rem > remaining && v.rem >= 0;
      v.rem = remaining;
      this.el.enRem.textContent = remaining;
      if (drop) this.el.enRem.animate?.([{ transform: 'scale(1.5)', color: '#ffd28a' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
    }
  }

  /** Objective line under the compass, e.g. 「モンテ・ロッソ城塞 · 320 m」 (null hides it). */
  setObjective(text) {
    text = text || '';
    if (text === this._v.obj) return;
    this._v.obj = text;
    this.el.objText.textContent = text;
    this.el.objTarget.hidden = !text;
  }

  setCrosshairSpread(px) {
    const s = Math.round(Math.min(60, Math.max(2, px)) * 2) / 2;
    if (s === this._v.spread) return;
    this._v.spread = s;
    this.el.crosshair.style.setProperty('--gap', `${s}px`);
  }

  /** Aim-down-sights amount 0..1: the crosshair fades out while aiming. */
  setAiming(a) {
    const q = Math.round(a * 10) / 10;
    if (q === this._v.aim) return;
    this._v.aim = q;
    this.el.crosshair.style.opacity = String(Math.max(0, 1 - q * 1.6));
    this.el.hud.classList.toggle('aiming', q > 0.5);
  }

  /** Desktop interact prompt: setPrompt('登る', 'トッレ・グロッサ') / setPrompt(null). */
  setPrompt(action, name = '') {
    const key = action ? `${action}|${name}` : null;
    if (key === this._v.prompt) return;
    this._v.prompt = key;
    this.el.prompt.hidden = !action || this.isTouch;
    if (action) { this.el.promptAct.textContent = action; this.el.promptName.textContent = name; }
  }

  setLockHint(v) {
    v = !!v && !this.isTouch;
    if (v === this._v.lock) return;
    this._v.lock = v;
    this.el.lockHint.hidden = !v;
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

  toast(text, kind = '') {
    const box = this.el.toasts;
    while (box.childElementCount >= (this.isTouch ? 2 : 3)) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = `toast${kind ? ` toast-${kind}` : ''}`;
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

  /** Large centred card, e.g. the name of a viewpoint when you reach the top. */
  titleCard(kicker, title, sub = '') {
    const el = this.el.title;
    el.querySelector('small').textContent = kicker;
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = sub;
    el.hidden = false;
    this._titleAnim?.cancel();
    if (el.animate) {
      this._titleAnim = el.animate([
        { opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.1 },
        { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -4px)' },
      ], { duration: this.isTouch ? 2600 : 3600, easing: 'ease-out' });
      this._titleAnim.onfinish = () => { el.hidden = true; };
    } else { clearTimeout(this._titleT); this._titleT = setTimeout(() => { el.hidden = true; }, 3600); }
  }
  hideTitleCard() { this._titleAnim?.cancel(); this.el.title.hidden = true; }

  /** Full-screen fade to dark (on = true) or back (false) over `dur` seconds. */
  fade(on, dur = 0.3) {
    const s = this.el.fade.style;
    s.transitionDuration = `${dur}s`;
    s.opacity = on ? '1' : '0';
  }
}
