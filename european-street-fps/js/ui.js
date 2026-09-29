// STUB — replaced by the UI agent.
export class UI {
  constructor(root) {
    this.root = root;
    root.innerHTML = `<div id="hud" style="position:fixed;left:12px;bottom:12px;color:#fff;background:#0009;padding:6px 10px;font:14px sans-serif"></div>
      <div id="ov" style="position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#000a;color:#fff;font:16px sans-serif"></div>`;
    this.hud = root.querySelector('#hud'); this.ov = root.querySelector('#ov');
    this.s = { hp: 0, mag: 0, res: 0, rem: 0, tot: 0 };
  }
  _overlay(html, cb) {
    this.ov.innerHTML = html + '<br><button id="ovb" style="font-size:20px;padding:10px 24px">OK</button>';
    this.ov.style.display = 'flex';
    this.ov.querySelector('#ovb').onclick = () => cb();
  }
  showStart(cb) { this._overlay('サン・ジミニャーノ市街戦 — 敵ロボット5体を全滅させよ', cb); }
  showPause(cb) { this._overlay('一時停止', cb); }
  showWin(s, cb) { this._overlay(`クリア！ ${s.time.toFixed(1)}秒`, cb); }
  showLose(s, cb) { this._overlay('敗北…', cb); }
  hideOverlays() { this.ov.style.display = 'none'; }
  setHUDVisible(v) { this.hud.style.display = v ? '' : 'none'; }
  _r() { const s = this.s; this.hud.textContent = `HP ${Math.round(s.hp)} | 弾 ${s.mag}/${s.res} | 敵 ${s.rem}/${s.tot}`; }
  setHP(hp) { this.s.hp = hp; this._r(); }
  setAmmo(m, r) { this.s.mag = m; this.s.res = r; this._r(); }
  setEnemies(a, b) { this.s.rem = a; this.s.tot = b; this._r(); }
  hitMarker() {} damageIndicator() {} setCrosshairSpread() {} toast() {}
}
