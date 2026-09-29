// STUB — replaced by the weapon agent.
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; }
  resume() {
    try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); } catch { /* no audio */ }
  }
  play() {}
  setMuted(v) { this.muted = v; }
}
