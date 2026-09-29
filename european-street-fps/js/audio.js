// All game sounds, synthesised at runtime with Web Audio (no sample files).
// Signal chain: voice → (panner) → master bus → compressor → destination,
// plus an outdoor slap-back send (two short filtered delays, like sound bouncing off
// the stone façades of a narrow street).

const MAX_VOICES = 12;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.voices = [];
  }

  /** Create / resume the AudioContext. Call from a user gesture. Never throws. */
  resume() {
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        this.ctx = new AC();
        this._build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  setMuted(v) {
    this.muted = !!v;
    if (this.master && this.ctx) {
      try { this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02); } catch { /* ignore */ }
    }
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.setMuted(this.muted); }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18;
    this.master.connect(comp).connect(c.destination);

    // Slap-back / street echo send.
    this.fx = c.createGain(); this.fx.gain.value = 1;
    const mk = (time, gain, freq) => {
      const d = c.createDelay(1); d.delayTime.value = time;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      this.fx.connect(d).connect(f).connect(g).connect(this.master);
      return g;
    };
    mk(0.085, 0.28, 2600);
    mk(0.19, 0.16, 1600);
    mk(0.34, 0.07, 1000);

    // Noise buffers (generated once).
    const len = c.sampleRate * 1.5;
    this.white = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // A soft-clip curve for gunshot grit.
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.curve[i] = Math.tanh(x * 2.5); }
  }

  /** play(name, { volume, pan, rate }) — no-op before resume() or without Web Audio. */
  play(name, { volume = 1, pan = 0, rate = 1 } = {}) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.muted) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    try {
      const now = c.currentTime;
      // Voice management: drop finished voices, steal the oldest if over the limit.
      this.voices = this.voices.filter((v) => v.end > now);
      while (this.voices.length >= MAX_VOICES) this._kill(this.voices.shift());
      const out = c.createGain();
      out.gain.value = Math.max(0, volume);
      let node = out;
      if (c.createStereoPanner && pan) {
        const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
        out.connect(p); node = p;
      }
      node.connect(this.master);
      const voice = { out, sources: [], end: now + 0.1, fxSend: null };
      const api = new VoiceAPI(this, voice, now, rate);
      fn(api);
      this.voices.push(voice);
    } catch { /* never let audio break the game */ }
  }

  _kill(v) {
    try {
      const t = this.ctx.currentTime;
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(0, t, 0.01);
      v.sources.forEach((s) => { try { s.stop(t + 0.05); } catch { /* already stopped */ } });
    } catch { /* ignore */ }
  }
}

/** Small helper toolkit handed to each sound recipe. Times are relative to the voice start. */
class VoiceAPI {
  constructor(audio, voice, t0, rate) {
    this.a = audio; this.c = audio.ctx; this.v = voice; this.t0 = t0; this.rate = rate;
  }
  _track(src, end) { this.v.sources.push(src); this.v.end = Math.max(this.v.end, this.t0 + end + 0.05); }
  send(amount) { // route this voice into the street echo
    if (!this.v.fxSend) { this.v.fxSend = this.c.createGain(); this.v.out.connect(this.v.fxSend).connect(this.a.fx); }
    this.v.fxSend.gain.value = amount;
  }
  /** Envelope gain node: attack a, hold peak, exponential decay d. */
  env(at, peak, a, d, dest = this.v.out) {
    const g = this.c.createGain(), t = this.t0 + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
    g.gain.setTargetAtTime(0.0001, t + a, Math.max(0.001, d / 4));
    g.connect(dest);
    return g;
  }
  filter(type, freq, q = 0.7, dest) {
    const f = this.c.createBiquadFilter(); f.type = type; f.frequency.value = freq * this.rate; f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }
  /** Noise burst through a filter chain. */
  noise(at, dur, { type = 'bandpass', freq = 1000, q = 0.8, gain = 1, a = 0.001, brown = false, sweepTo = 0, dest } = {}) {
    dur /= this.rate;
    const src = this.c.createBufferSource();
    src.buffer = brown ? this.a.brown : this.a.white;
    src.playbackRate.value = this.rate;
    const e = this.env(at, gain, a, dur, dest);
    const f = this.filter(type, freq, q, e);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo * this.rate, this.t0 + at + dur);
    src.connect(f);
    const off = Math.random() * 0.8;
    src.start(this.t0 + at, off, dur * 1.6 + 0.05);
    this._track(src, at + dur * 1.6);
    return f;
  }
  /** Oscillator with pitch glide. */
  tone(at, dur, { type = 'sine', f0 = 440, f1 = 0, gain = 0.5, a = 0.002, glide = 0, dest, filt } = {}) {
    dur /= this.rate;
    const o = this.c.createOscillator(); o.type = type;
    const t = this.t0 + at;
    o.frequency.setValueAtTime(f0 * this.rate, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.rate), t + (glide || dur));
    const e = this.env(at, gain, a, dur, dest);
    if (filt) { const f = this.filter(filt[0], filt[1], filt[2] || 0.7, e); o.connect(f); } else o.connect(e);
    o.start(t); o.stop(t + dur * 1.5 + 0.05);
    this._track(o, at + dur * 1.5);
    return o;
  }
  shaper(dest) { const s = this.c.createWaveShaper(); s.curve = this.a.curve; s.connect(dest); return s; }
  gain(v, dest = this.v.out) { const g = this.c.createGain(); g.gain.value = v; g.connect(dest); return g; }
}

const r = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ recipes
const SOUNDS = {
  // Layered carbine shot: sharp crack, mid-range body, low thump, mechanical tail, street slap-back.
  shot(s) {
    s.send(0.55);
    const grit = s.shaper(s.gain(0.7));
    s.noise(0, 0.012, { type: 'highpass', freq: 2500, gain: 1.0, dest: grit });            // crack
    s.noise(0, 0.09, { type: 'bandpass', freq: r(1100, 1400), q: 0.6, gain: 1.3, dest: grit }); // body
    s.noise(0.002, 0.22, { type: 'lowpass', freq: 700, gain: 0.8, brown: true });            // blast
    s.tone(0, 0.11, { f0: 150, f1: 42, gain: 0.9, glide: 0.09 });                            // thump
    s.noise(0.03, 0.35, { type: 'lowpass', freq: 420, gain: 0.35, brown: true, a: 0.02 });   // rumble tail
    s.noise(0.045, 0.02, { type: 'bandpass', freq: 3200, q: 3, gain: 0.12 });                // bolt clack
  },
  empty(s) {
    s.noise(0, 0.006, { type: 'bandpass', freq: 3600, q: 2, gain: 0.7 });
    s.tone(0, 0.035, { type: 'triangle', f0: 2300, gain: 0.12 });
    s.noise(0.028, 0.008, { type: 'bandpass', freq: 2400, q: 2, gain: 0.45 });
  },
  // Timed to the reload animation: release, mag out, (drop), insert, bolt release / slap.
  reload(s) {
    s.noise(0.15, 0.01, { type: 'bandpass', freq: 3000, q: 2, gain: 0.5 });
    s.noise(0.2, 0.12, { type: 'bandpass', freq: 1800, q: 1.2, gain: 0.25, sweepTo: 900, a: 0.02 });
    s.noise(0.62, 0.05, { type: 'lowpass', freq: 600, gain: 0.25 });                // mag hits the stones below
    s.noise(0.66, 0.02, { type: 'bandpass', freq: 2200, q: 2, gain: 0.15 });
    s.noise(0.8, 0.1, { type: 'bandpass', freq: 1500, q: 1, gain: 0.15, a: 0.02 }); // cloth / pouch
    s.noise(0.97, 0.018, { type: 'bandpass', freq: 2100, q: 1.5, gain: 0.8 });     // insert clack
    s.tone(0.97, 0.05, { type: 'triangle', f0: 620, f1: 400, gain: 0.25 });
    s.noise(1.12, 0.02, { type: 'bandpass', freq: 2600, q: 1.5, gain: 0.75 });     // bolt release
    s.tone(1.12, 0.06, { type: 'triangle', f0: 900, f1: 500, gain: 0.2 });
    s.noise(1.13, 0.06, { type: 'lowpass', freq: 900, gain: 0.3 });
  },
  // Bullet on robot: metallic ping (inharmonic partials) + plastic tick.
  hitRobot(s) {
    const f = r(0.92, 1.1);
    for (const [fr, g] of [[1250, 0.22], [2930, 0.14], [4410, 0.08]]) s.tone(0, r(0.12, 0.2), { f0: fr * f, gain: g });
    s.noise(0, 0.02, { type: 'bandpass', freq: 3500, q: 1.2, gain: 0.6 });
    s.noise(0.004, 0.05, { type: 'bandpass', freq: 800, q: 1.5, gain: 0.35 });
  },
  // Bullet on stone: dusty crack, grit, occasional ricochet whine.
  hitWorld(s) {
    s.send(0.2);
    s.noise(0, 0.03, { type: 'bandpass', freq: r(1800, 2600), q: 0.9, gain: 0.7 });
    s.noise(0.003, 0.12, { type: 'lowpass', freq: 900, gain: 0.35, brown: true });
    s.noise(0.02, 0.15, { type: 'highpass', freq: 4000, gain: 0.12, a: 0.01 });
    if (Math.random() < 0.3) s.tone(0.01, 0.28, { f0: r(3200, 4200), f1: r(1300, 1800), gain: 0.07, glide: 0.28 });
  },
  // Training-robot shot: thinner, higher crack with an electronic tick (clearly not the player's).
  robotShot(s) {
    s.send(0.45);
    s.noise(0, 0.01, { type: 'highpass', freq: 3000, gain: 0.8 });
    s.noise(0, 0.07, { type: 'bandpass', freq: 1900, q: 0.9, gain: 0.8 });
    s.tone(0, 0.06, { type: 'square', f0: 1400, f1: 600, gain: 0.07, filt: ['lowpass', 3000] });
    s.tone(0, 0.07, { f0: 220, f1: 70, gain: 0.35 });
  },
  // Robot hit: electric crackle + a strained servo whine.
  robotHurt(s) {
    for (let i = 0; i < 5; i++) s.noise(i * r(0.015, 0.03), 0.012, { type: 'bandpass', freq: r(2500, 5000), q: 3, gain: r(0.2, 0.4) });
    s.tone(0.01, 0.22, { type: 'sawtooth', f0: r(520, 620), f1: r(880, 1000), gain: 0.08, glide: 0.12, filt: ['bandpass', 1400, 1.5] });
  },
  // Power-down: falling tone through a closing filter, crackle, then a heavy clunk.
  robotDie(s) {
    s.send(0.3);
    s.tone(0, 1.1, { type: 'sawtooth', f0: 420, f1: 38, gain: 0.16, glide: 1.0, filt: ['lowpass', 1600, 2] });
    s.tone(0, 0.9, { type: 'square', f0: 210, f1: 30, gain: 0.05, glide: 0.85, filt: ['lowpass', 900] });
    for (let i = 0; i < 7; i++) s.noise(r(0, 0.6), 0.015, { type: 'bandpass', freq: r(2000, 5000), q: 3, gain: r(0.1, 0.3) });
    s.noise(0.95, 0.12, { type: 'lowpass', freq: 500, gain: 0.7, brown: true });
    s.tone(0.95, 0.15, { f0: 110, f1: 45, gain: 0.5 });
    s.noise(1.0, 0.05, { type: 'bandpass', freq: 1400, q: 1.5, gain: 0.3 });
  },
  // Alert: servo turning + two rising electronic chirps.
  robotAlert(s) {
    s.tone(0, 0.18, { type: 'sawtooth', f0: 300, f1: 480, gain: 0.05, glide: 0.18, filt: ['bandpass', 900, 2] });
    s.tone(0.08, 0.07, { type: 'square', f0: 1100, f1: 1650, gain: 0.08, glide: 0.05, filt: ['lowpass', 4000] });
    s.tone(0.17, 0.09, { type: 'square', f0: 1400, f1: 2100, gain: 0.08, glide: 0.06, filt: ['lowpass', 4000] });
  },
  // Extra (not in the contract list): short servo whine, e.g. for robot movement.
  servo(s) {
    s.tone(0, 0.25, { type: 'sawtooth', f0: r(380, 460), f1: r(560, 700), gain: 0.05, glide: 0.2, filt: ['bandpass', 1100, 2] });
  },
  playerHurt(s) {
    s.tone(0, 0.16, { f0: 110, f1: 50, gain: 0.8 });
    s.noise(0, 0.1, { type: 'lowpass', freq: 500, gain: 0.6, brown: true });
    s.noise(0, 0.03, { type: 'bandpass', freq: 1500, q: 1, gain: 0.4 });
    s.tone(0.02, 0.35, { f0: 3100, gain: 0.025, a: 0.03 });                     // faint ringing
  },
  // Boot on stone paving: gritty scuff + dull heel knock.
  step(s) {
    s.noise(0, 0.035, { type: 'bandpass', freq: r(500, 800), q: 1.1, gain: 0.8 });
    s.tone(0, 0.05, { f0: r(70, 90), f1: 50, gain: 0.35 });
    s.noise(0.012, 0.05, { type: 'highpass', freq: r(3000, 4500), gain: 0.12, a: 0.005 });
  },
  win(s) {
    s.send(0.3);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      s.tone(i * 0.13, 0.9, { type: 'triangle', f0: f, gain: 0.16, a: 0.01 });
      s.tone(i * 0.13, 0.6, { f0: f * 2, gain: 0.04, a: 0.01 });
    });
  },
  lose(s) {
    s.send(0.3);
    [392, 349.23, 311.13, 261.63].forEach((f, i) => s.tone(i * 0.22, 0.9, { type: 'triangle', f0: f, gain: 0.15, a: 0.02, filt: ['lowpass', 1800] }));
  },
  uiClick(s) {
    s.tone(0, 0.03, { f0: 1500, gain: 0.18 });
    s.noise(0, 0.008, { type: 'bandpass', freq: 3000, q: 1, gain: 0.2 });
  },
};
