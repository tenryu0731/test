// HUD: 速度計、ミニマップ、操作のヒント、開始・一時停止画面
import { CITY_W, CITY_D, isTouch } from './config.js';

export class HUD {
  constructor(root, city) {
    this.root = root; this.city = city;
    root.innerHTML = `
      <div id="minimap"><canvas width="360" height="360"></canvas><div class="n">N</div></div>
      <div id="speed"><b>0</b><span>MPH</span></div>
      <div id="mode"></div>
      <div id="prompt"></div>
      <div id="toast"></div>
      <div id="fps"></div>
      <div class="screen" id="start">
        <div class="panel">
          <h1>AMERICAN CITY</h1>
          <p class="sub">ダウンタウンを自由に運転・散策するオープンワールド</p>
          <table class="keys">
            ${isTouch ? `
            <tr><th>移動・ハンドル</th><td>画面左をドラッグ</td></tr>
            <tr><th>アクセル / ブレーキ</th><td>右下のボタン（スティックの上下でも可）</td></tr>
            <tr><th>視点</th><td>画面右をドラッグ</td></tr>
            <tr><th>乗る / 降りる</th><td>「乗る」ボタン</td></tr>` : `
            <tr><th>運転</th><td>W / S（アクセル・ブレーキ・後退）、A / D（ハンドル）、Space（サイドブレーキ）</td></tr>
            <tr><th>歩く</th><td>W A S D、Shift で走る、マウスで視点</td></tr>
            <tr><th>乗る / 降りる</th><td>F（近くの車を奪うこともできます）</td></tr>
            <tr><th>その他</th><td>C（カメラ切替）、H（ホーン）、Esc（一時停止）</td></tr>`}
          </table>
          <label class="q">画質
            <select id="quality">
              <option value="high">高（AO・ブルーム・SMAA）</option>
              <option value="medium">中</option>
              <option value="low">低（軽い端末向け）</option>
            </select>
          </label>
          <button id="go">街へ出る</button>
          <p class="credit">テクスチャ・HDRI・小物: Poly Haven（CC0）。車・建物の形・音はコードで生成。</p>
        </div>
      </div>
      <div class="screen hidden" id="pause"><div class="panel"><h2>一時停止</h2><button id="resume">再開</button></div></div>`;
    this.mm = root.querySelector('#minimap canvas'); this.mmg = this.mm.getContext('2d');
    this.speedEl = root.querySelector('#speed b'); this.modeEl = root.querySelector('#mode');
    this.promptEl = root.querySelector('#prompt'); this.toastEl = root.querySelector('#toast'); this.fpsEl = root.querySelector('#fps');
    this.buildMapImage();
  }

  // 街の地図を 1 回だけ描いておく（1 px = 1 m）
  buildMapImage() {
    const pad = 120;
    const c = document.createElement('canvas'); c.width = CITY_W + pad * 2; c.height = CITY_D + pad * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#3d4249'; g.fillRect(0, 0, c.width, c.height);
    for (const b of this.city.blocks) {
      g.fillStyle = b.type === 'ring' ? '#1d2126' : '#8f949b';
      g.fillRect(b.x0 + pad, b.z0 + pad, b.x1 - b.x0, b.z1 - b.z0);
      g.fillStyle = b.type === 'plaza' ? '#5d7a5e' : b.type === 'parking' ? '#6b7078' : '#262a30';
      g.fillRect(b.lot.x0 + pad, b.lot.z0 + pad, b.lot.x1 - b.lot.x0, b.lot.z1 - b.lot.z0);
    }
    this.mapImg = c; this.mapPad = pad;
  }

  drawMinimap(px, pz, heading, cars) {
    const g = this.mmg, S = 360, scale = 1.6;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1d2126'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2); g.scale(scale, scale);
    g.drawImage(this.mapImg, -px - this.mapPad, -pz - this.mapPad);
    for (const c of cars) {
      if (c.mode === 'player') continue;
      g.fillStyle = c.mode === 'parked' ? '#c9c9c9' : '#f2c14e';
      g.fillRect(c.pos.x - px - 1.3, c.pos.z - pz - 1.3, 2.6, 2.6);
    }
    g.restore();
    // プレイヤーの矢印（地図は北が上で固定）
    g.save(); g.translate(S / 2, S / 2); g.rotate(-heading + Math.PI);
    g.fillStyle = '#ff4d3d'; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  update(s) {
    this.speedEl.textContent = Math.round(Math.abs(s.speed) * 2.237);
    this.root.querySelector('#speed').style.opacity = s.inCar ? 1 : 0.25;
    this.modeEl.textContent = s.inCar ? '運転中' : '徒歩';
    this.promptEl.textContent = s.prompt || '';
    this.promptEl.style.opacity = s.prompt ? 1 : 0;
  }
  toast(msg, ms = 2200) {
    this.toastEl.textContent = msg; this.toastEl.classList.add('on');
    clearTimeout(this._t); this._t = setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
}
