// 音: Web Audio で合成（エンジン、タイヤのスキール、衝突、街の環境音、ホーン）。音声ファイルは使わない。
export class Audio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.7; this.master.connect(C.destination);
    const noiseBuf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate);
    const d = noiseBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.noiseBuf = noiseBuf;
    const noise = () => { const s = C.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // エンジン: のこぎり波 2 本 + 低域通過
    this.engGain = C.createGain(); this.engGain.gain.value = 0;
    this.engFilter = C.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 3;
    this.o1 = C.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = C.createOscillator(); this.o2.type = 'square';
    const g2 = C.createGain(); g2.gain.value = 0.35;
    this.o1.connect(this.engFilter); this.o2.connect(g2); g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.o1.start(); this.o2.start();
    // スキール
    this.skidGain = C.createGain(); this.skidGain.gain.value = 0;
    const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 6;
    noise().connect(bp); bp.connect(this.skidGain); this.skidGain.connect(this.master);
    // 街の環境音（遠くの車の走行音のようなこもったノイズ）
    const amb = C.createGain(); amb.gain.value = 0.18;
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    noise().connect(lp); lp.connect(amb); amb.connect(this.master);
    this.ambLfo = C.createOscillator(); this.ambLfo.frequency.value = 0.07; const lfoG = C.createGain(); lfoG.gain.value = 0.06;
    this.ambLfo.connect(lfoG); lfoG.connect(amb.gain); this.ambLfo.start();
    this.nextHonk = C.currentTime + 6;
  }
  update(dt, s) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const inCar = s.inCar;
    const rpm = inCar ? 0.18 + Math.min(1, Math.abs(s.speed) / 28) * 0.7 + s.throttle * 0.12 : 0;
    const gear = inCar ? (Math.abs(s.speed) % 9) / 9 : 0; void gear;
    this.o1.frequency.setTargetAtTime(38 + rpm * 120, t, 0.05);
    this.o2.frequency.setTargetAtTime(19 + rpm * 60, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 1400 + s.throttle * 300, t, 0.08);
    this.engGain.gain.setTargetAtTime(inCar ? 0.07 + rpm * 0.08 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(inCar ? Math.min(0.25, s.skid * 0.22) : 0, t, 0.05);
    // 遠くのクラクション
    if (t > this.nextHonk) { this.honk(0.04 + Math.random() * 0.04, 300 + Math.random() * 120, 0.25 + Math.random() * 0.3); this.nextHonk = t + 8 + Math.random() * 18; }
  }
  honk(vol = 0.18, f = 415, dur = 0.45) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const g = C.createGain(); g.gain.value = 0; g.connect(this.master);
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g);
    for (const ff of [f, f * 1.26]) { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = ff; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }
    g.gain.setTargetAtTime(vol, t, 0.01); g.gain.setTargetAtTime(0, t + dur, 0.03);
  }
  crash(strength) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const s = C.createBufferSource(); s.buffer = this.noiseBuf;
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + strength * 120;
    const g = C.createGain(); g.gain.value = Math.min(0.9, 0.15 + strength * 0.06);
    s.connect(lp); lp.connect(g); g.connect(this.master);
    g.gain.setTargetAtTime(0, t + 0.05, 0.12); s.start(t); s.stop(t + 0.8);
  }
}
