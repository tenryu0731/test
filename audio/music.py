#!/usr/bin/env python3
"""
LAST LIGHT - procedural film score (60.000 s, 48 kHz, stereo, float32).

Everything is synthesised from scratch (additive / FM / subtractive synthesis,
modal membranes, algorithmic convolution reverb). Deterministic: fixed seeds.

Run from the project root:   python3 audio/music.py
Output:                       audio/stems/music.wav

Structure (key centre D):
  0.0 - 9.0   cold intro, D minor/modal: low drone, glass pads, a motif hint on
              celesta (A-D-E ... F), falling celesta cascade 7.5-8.9 (star falls)
  9.0 - 20.0  discovery, D dorian, 75 BPM grid anchored to Pip's hops
              (12.0/12.8/13.6/14.4 = motif A4-D5-E5-F5), G/D chord under the
              D6 star chime at 15.5, full motif A-D-E-F-E-D 16.8-19.2
  20.0 - 30.0 storm (own bus): drones, tremolo clusters, spiccato ostinato,
              synthesised taiko, accents at 24.5 and 27.8, riser, hard cut 30.0
  30.6 - 36.8 near silence: fragile low D + faint harmonic, reverse swell 35-36.8
  36.8        D major bloom (brass/strings/choir-pad/sub/shimmer)
  38.5 - 53.0 build, 120 BPM (bars on odd seconds, backbeats on the branch
              accents 39.5/40.5/41.5/42.5), D-Bm-G-A-F#m-G-Asus4-A, climax 53.0
  53.0 - 60.0 resolution, motif recapitulated in D major on celesta,
              twinkles 56.8/57.4, final bell chord 58.5, silence by 60.0
"""
import os
import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
N = 2_880_000                      # exactly 60.000 s
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "stems", "music.wav")
RNG = np.random.default_rng(31415)
TWO_PI = 2.0 * np.pi

# ----------------------------------------------------------------------------
# pitch helpers
# ----------------------------------------------------------------------------
_PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
       "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10,
       "B": 11}


def midi(name):
    if not isinstance(name, str):
        return float(name)
    name = name.strip()
    p = name[:2] if len(name) > 2 and name[1] in "#b" else name[:1]
    return 12 * (int(name[len(p):]) + 1) + _PC[p]


def hz(x):
    return 440.0 * 2.0 ** ((midi(x) - 69) / 12.0)


def tvec(n):
    return np.arange(n) / SR


def ns(sec):
    return max(1, int(round(sec * SR)))


# ----------------------------------------------------------------------------
# envelopes / panning
# ----------------------------------------------------------------------------
def env_asr(n, a, r, a_shape="cos"):
    """Attack a seconds, sustain, release r seconds ending exactly at 0."""
    e = np.ones(n)
    na = min(int(a * SR), n)
    nr = min(int(r * SR), n - na)
    if na > 0:
        x = np.arange(na) / na
        e[:na] = (0.5 - 0.5 * np.cos(np.pi * x)) if a_shape == "cos" else x ** 2
    if nr > 0:
        e[n - nr:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, nr + 1) / nr)
    else:
        e[-1] = 0.0
    return e


def curve(n, pts, t0=0.0):
    """Piecewise-linear automation over n samples; pts = [(abs_time, val)]."""
    ts, vs = zip(*pts)
    return np.interp(t0 + tvec(n), ts, vs)


def pan(mono, p):
    th = (p + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(th), mono * np.sin(th)])


def stereo(x):
    return x if x.ndim == 2 else np.stack([x, x]) * np.sqrt(0.5)


# ----------------------------------------------------------------------------
# filters
# ----------------------------------------------------------------------------
def _rbj(kind, fc, q, gain_db=0.0):
    fc = min(max(fc, 10.0), SR * 0.47)
    w = TWO_PI * fc / SR
    c, s = np.cos(w), np.sin(w)
    al = s / (2 * q)
    if kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "bp":                      # 0 dB peak
        b = [al, 0.0, -al]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "peak":
        A = 10 ** (gain_db / 40)
        b = [1 + al * A, -2 * c, 1 - al * A]
        a = [1 + al / A, -2 * c, 1 - al / A]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return b, a


def filt(x, kind, fc, q=0.707, stages=1, gain_db=0.0, block=256):
    """Biquad filter; fc may be a scalar or a per-sample array (time-varying,
    coefficients updated per block with carried state)."""
    y = np.asarray(x, dtype=np.float64)
    for _ in range(stages):
        if np.isscalar(fc):
            b, a = _rbj(kind, fc, q, gain_db)
            y = signal.lfilter(b, a, y, axis=-1)
            continue
        out = np.empty_like(y)
        n = y.shape[-1]
        zi = np.zeros(y.shape[:-1] + (2,))
        for i in range(0, n, block):
            j = min(n, i + block)
            b, a = _rbj(kind, float(fc[(i + j) // 2]), q, gain_db)
            out[..., i:j], zi = signal.lfilter(b, a, y[..., i:j], axis=-1, zi=zi)
        y = out
    return y


# ----------------------------------------------------------------------------
# oscillators
# ----------------------------------------------------------------------------
def saw(f):
    """PolyBLEP band-limited sawtooth; f is a per-sample frequency array."""
    dt = f / SR
    ph = (RNG.random() + np.cumsum(dt)) % 1.0
    y = 2.0 * ph - 1.0
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y


def ensemble(f0, n, voices=7, spread=16.0, vib_rate=5.3, vib_depth=7.0,
             vib_delay=0.35, drift=2.5, width=0.85):
    """Detuned unison saw ensemble -> stereo (2, n). f0 scalar or array."""
    t = tvec(n)
    f0 = np.broadcast_to(np.asarray(f0, dtype=np.float64), (n,))
    out = np.zeros((2, n))
    for v in range(voices):
        pos = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        cents = pos * spread / 2 + RNG.uniform(-1.5, 1.5)
        vd = vib_depth * np.clip((t - vib_delay) / 0.9, 0, 1) * RNG.uniform(0.7, 1.2)
        cents = cents + vd * np.sin(TWO_PI * vib_rate * RNG.uniform(0.9, 1.1) * t
                                    + RNG.uniform(0, TWO_PI))
        cents = cents + drift * np.sin(TWO_PI * RNG.uniform(0.07, 0.25) * t
                                       + RNG.uniform(0, TWO_PI))
        out += pan(saw(f0 * 2 ** (cents / 1200)), pos * width)
    return out / np.sqrt(voices)


# ----------------------------------------------------------------------------
# instruments
# ----------------------------------------------------------------------------
MALLETS = {
    # (ratio, amplitude, decay seconds @ ~520 Hz)
    "celesta": [(1.0, 1.0, 1.5), (2.0, 0.07, 0.9), (3.0, 0.025, 0.45),
                (4.08, 0.11, 0.30), (6.1, 0.035, 0.10), (9.4, 0.02, 0.04)],
    "musicbox": [(1.0, 1.0, 1.2), (2.0, 0.18, 0.7), (3.02, 0.05, 0.3),
                 (5.25, 0.10, 0.14), (8.6, 0.04, 0.05)],
    "glass": [(1.0, 1.0, 3.0), (2.76, 0.25, 1.1), (5.40, 0.10, 0.45),
              (8.93, 0.04, 0.15)],
    "bell": [(0.5, 0.35, 5.0), (1.0, 1.0, 4.2), (1.505, 0.18, 2.6),
             (2.0, 0.55, 2.6), (2.52, 0.16, 1.7), (3.0, 0.22, 1.3),
             (4.17, 0.10, 0.8), (5.43, 0.06, 0.5), (6.8, 0.03, 0.3)],
}


def mallet(note, vel=0.5, kind="celesta", max_len=6.0, damp_at=None):
    f = hz(note)
    parts = MALLETS[kind]
    scale = (523.0 / f) ** 0.35
    L = min(max_len, max(d for _, _, d in parts) * scale * 4.0)
    n = ns(L)
    t = tvec(n)
    x = np.zeros(n)
    for r, a, d in parts:
        fr = f * r
        if fr > 17000:
            continue
        amp = a * (vel ** 0.6 if r > 1.6 else 1.0)
        dd = d * scale
        x += amp * np.exp(-t / dd) * np.sin(TWO_PI * fr * t + RNG.uniform(0, TWO_PI))
        if kind == "bell":           # beating doublet for shimmer
            x += 0.5 * amp * np.exp(-t / dd) * np.sin(
                TWO_PI * (fr + RNG.uniform(0.6, 1.6)) * t + RNG.uniform(0, TWO_PI))
    x *= 1.0 - np.exp(-t / 0.0009)
    hn = min(n, ns(0.03))
    ham = RNG.standard_normal(hn) * np.exp(-tvec(hn) / 0.003)
    ham = filt(ham, "bp", min(f * 6, 9000), 0.9)
    x[:hn] += 0.05 * vel * ham
    if damp_at is not None and damp_at < L:
        k = ns(damp_at)
        dr = min(n - k, ns(0.25))
        x[k:k + dr] *= np.linspace(1, 0, dr)
        x[k + dr:] = 0
    x *= env_asr(n, 0.0, 0.05)
    return x * vel


def pluck(note, vel=0.5, bright=0.6, length=None, rel=0.08):
    """Harp-like additive pluck (exact tuning, frequency-dependent decay)."""
    f = hz(note)
    T1 = float(np.clip(2.6 * (220.0 / f) ** 0.45, 0.5, 4.5))
    L = length or min(5.0, T1 * 3.5)
    n = ns(L)
    t = tvec(n)
    x = np.zeros(n)
    k = 1
    while f * k < 14000 and k <= 30:
        a = abs(np.sin(np.pi * k * 0.14)) / k ** (1.9 - 0.6 * bright * vel)
        d = T1 / (1 + 0.45 * (k - 1)) ** 1.1
        x += a * np.exp(-t / d) * np.sin(TWO_PI * f * k * (1 + 0.0002 * k * k) * t
                                          + RNG.uniform(0, 0.3))
        k += 1
    x *= 1.0 - np.exp(-t / 0.0015)
    x *= env_asr(n, 0.0, rel)
    return x * vel / 1.2


def glass_pad(note, n, att, rel, bright=0.35, level=1.0):
    f = hz(note)
    t = tvec(n)
    out = np.zeros((2, n))
    for ch, c in enumerate((-4.0, 4.0)):
        fs = f * 2 ** ((c + RNG.uniform(-1, 1)) / 1200)
        idx = bright * (0.55 + 0.45 * np.sin(TWO_PI * RNG.uniform(0.08, 0.17) * t
                                               + RNG.uniform(0, TWO_PI)))
        car = np.sin(TWO_PI * fs * t + idx * np.sin(TWO_PI * 2 * fs * t))
        car += 0.12 * np.sin(TWO_PI * 3.0 * fs * t + RNG.uniform(0, TWO_PI))
        out[ch] = car
    am = 1 + 0.08 * np.sin(TWO_PI * RNG.uniform(0.15, 0.35) * t + RNG.uniform(0, TWO_PI))
    return out * env_asr(n, att, rel) * am * level * 0.5


def sine_tone(note, n, att, rel, level=1.0, harm=0.15, vib=0.0, vib_rate=4.5):
    f = hz(note)
    t = tvec(n)
    ph = TWO_PI * f * t
    if vib:
        ph = ph + (vib / 1200 * np.log(2)) * f / vib_rate * np.sin(TWO_PI * vib_rate * t)
    x = np.sin(ph) + harm * np.sin(2 * ph + 0.3)
    return x * env_asr(n, att, rel) * level


def strings(notes, n, att, rel, cutoff, level=1.0, voices=7, spread=16,
            vib=7.0, stages=2, trem=None):
    out = np.zeros((2, n))
    for nt in notes:
        f = hz(nt)
        x = ensemble(f, n, voices=voices, spread=spread, vib_depth=vib)
        if trem is not None:           # bowed tremolo
            rate = trem * RNG.uniform(0.9, 1.1)
            tt = tvec(n)
            x = x * (0.6 + 0.4 * np.abs(np.sin(np.pi * rate * tt + RNG.uniform(0, 3))) ** 0.7)
        out += x
    out = filt(out, "lp", cutoff, 0.65, stages=stages)
    out = filt(out, "hp", 45.0, 0.7)
    return out * env_asr(n, att, rel) * level / np.sqrt(len(notes))


FORMANTS_AH = [(800, 80, 1.0), (1150, 90, 0.5), (2900, 120, 0.035),
               (3900, 130, 0.1), (4950, 140, 0.004)]
FORMANTS_AH_LOW = [(650, 80, 1.0), (1080, 90, 0.5), (2650, 120, 0.45),
                   (2900, 130, 0.4), (3250, 140, 0.08)]


def choir(notes, n, att, rel, level=1.0):
    """Smooth formant-filtered 'ahh' pad (no articulation, sustained vowel)."""
    out = np.zeros((2, n))
    for nt in notes:
        f = hz(nt)
        src = ensemble(f, n, voices=6, spread=14, vib_rate=4.8, vib_depth=12,
                       vib_delay=0.2, drift=3)
        src += 0.02 * RNG.standard_normal((2, n))
        form = FORMANTS_AH if f > 330 else FORMANTS_AH_LOW
        y = np.zeros_like(src)
        for fc, bw, g in form:
            y += g * filt(src, "bp", fc, fc / bw)
        out += y
    out = filt(out, "lp", 5500, 0.7)
    return out * env_asr(n, att, rel) * level * 2.2 / np.sqrt(len(notes))


def brass(notes, n, att, rel, vel=1.0, level=1.0, decay_to=0.55, decay_t=1.2):
    t = tvec(n)
    out = np.zeros((2, n))
    for nt in notes:
        f = hz(nt)
        x = ensemble(f, n, voices=3, spread=9, vib_depth=4, vib_delay=0.5, drift=1.5)
        fe = 1 - np.exp(-t / (att * 0.8 + 1e-3))
        fe = fe * (decay_to + (1 - decay_to) * np.exp(-t / decay_t))
        fc = np.minimum(f * (1.2 + 7.0 * vel * fe), 7500)
        out += filt(x, "lp", fc, 0.8, stages=2)
    amp = env_asr(n, att, rel) * (decay_to + (1 - decay_to) * np.exp(-t / decay_t))
    return out * amp * level / np.sqrt(len(notes))


def membrane(f0, vel=1.0, decay=0.8, modes=None, bend=1.4, bend_t=0.03,
             noise=0.35, length=None, noise_fc=1400.0):
    modes = modes or [(1.0, 1.0, 1.0), (1.59, 0.45, 0.55), (2.14, 0.3, 0.4),
                      (2.30, 0.22, 0.35), (2.65, 0.15, 0.3)]
    L = length or decay * 4.5
    n = ns(L)
    t = tvec(n)
    fe = 1 + bend * np.exp(-t / bend_t)
    x = np.zeros(n)
    for r, a, dm in modes:
        ph = TWO_PI * np.cumsum(f0 * r * fe) / SR
        x += a * np.sin(ph) * np.exp(-t / (decay * dm))
    nb = RNG.standard_normal(n) * np.exp(-t / 0.014)
    x += noise * filt(nb, "lp", noise_fc, 0.7)
    x *= 1 - np.exp(-t / 0.0007)
    x *= env_asr(n, 0.0, 0.1)
    return x * vel


def taiko(vel=1.0, f0=55.0, decay=0.9):
    return membrane(f0 * RNG.uniform(0.98, 1.02), vel, decay, bend=1.2,
                    bend_t=0.025, noise=0.45)


def timpani(note="D2", vel=1.0, decay=2.4):
    modes = [(1.0, 1.0, 1.0), (1.5, 0.5, 0.8), (1.98, 0.3, 0.6),
             (2.44, 0.15, 0.4), (2.97, 0.08, 0.3)]
    return membrane(hz(note), vel, decay, modes=modes, bend=0.12, bend_t=0.05,
                    noise=0.3, noise_fc=900)


def boom(vel=1.0, f0=36.0, decay=1.6):
    return membrane(f0, vel, decay, modes=[(1.0, 1.0, 1.0), (2.0, 0.15, 0.5)],
                    bend=1.8, bend_t=0.05, noise=0.15, noise_fc=300)


def cymbal(length=4.0, decay=1.6, vel=1.0):
    n = ns(length)
    t = tvec(n)
    nz = RNG.standard_normal((2, n))
    x = filt(nz, "hp", 3500, 0.7) * 0.6 + filt(nz, "bp", 7000, 0.6) * 0.5
    ring = np.zeros((2, n))
    for _ in range(48):
        fr = RNG.uniform(2500, 13000)
        d = decay * RNG.uniform(0.3, 1.2)
        ring[RNG.integers(2)] += (0.06 * np.sin(TWO_PI * fr * t + RNG.uniform(0, TWO_PI))
                                  * np.exp(-t / d))
    x = (x + ring) * np.exp(-t / decay)
    x *= 1 - np.exp(-t / 0.002)
    return x * env_asr(n, 0.0, 0.1) * vel


def shaker(vel=0.5):
    n = ns(0.12)
    t = tvec(n)
    x = filt(RNG.standard_normal((2, n)), "hp", 6000, 0.7)
    e = (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.03)
    return x * e * vel * env_asr(n, 0, 0.02)


def noise_riser(n, f_from, f_to, q=2.0):
    fc = np.geomspace(f_from, f_to, n)
    x = filt(RNG.standard_normal((2, n)), "bp", fc, q)
    return x


# ----------------------------------------------------------------------------
# reverb (algorithmic impulse responses + FFT convolution)
# ----------------------------------------------------------------------------
def make_ir(t60, secs, seed, pre=0.018, damp=(1.35, 1.0, 0.8, 0.55, 0.3),
            er=10, bright=1.0):
    r = np.random.default_rng(seed)
    n = ns(secs)
    t = tvec(n)
    edges = [250, 1000, 4000, 9000]
    irs = []
    # the low band is shared by both channels -> mono-compatible, coherent lows
    low = signal.sosfilt(signal.butter(2, edges[0], "low", fs=SR, output="sos"),
                         r.standard_normal(n))
    for ch in range(2):
        nz = r.standard_normal(n)
        bands = [low]
        for lo, hi in zip(edges[:-1], edges[1:]):
            bands.append(signal.sosfilt(
                signal.butter(2, [lo, hi], "band", fs=SR, output="sos"), nz))
        bands.append(signal.sosfilt(
            signal.butter(2, edges[-1], "high", fs=SR, output="sos"), nz) * bright)
        ir = np.zeros(n)
        for b, d in zip(bands, damp):
            ir += b * np.exp(-6.9078 * t / (t60 * d))
        ir *= 1 - np.exp(-t / 0.02)
        for _ in range(er):
            k = int(r.uniform(0.004, 0.07) * SR)
            ir[k] += r.uniform(-1, 1) * 3.0 * np.exp(-k / SR / 0.05)
        ir *= env_asr(n, 0.0, 0.2)
        ir = np.concatenate([np.zeros(ns(pre + 0.004 * ch)), ir])[:n]
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(irs)


class Bus:
    def __init__(self, name, dyn=None):
        self.name = name
        self.dry = np.zeros((2, N))
        self.sends = {}
        self.dyn = dyn                 # 'conductor' dynamics: [(t, dB)] by onset

    def add(self, x, t0, gain=1.0, p=0.0, **sends):
        x = pan(x, p) if x.ndim == 1 else x
        if self.dyn:
            ts, ds = zip(*self.dyn)
            gain = gain * 10 ** (np.interp(t0, ts, ds) / 20)
        i0 = int(round(t0 * SR))
        s0 = 0
        if i0 < 0:
            s0, i0 = -i0, 0
        i1 = min(N, i0 + x.shape[1] - s0)
        if i1 <= i0:
            return
        seg = gain * x[:, s0:s0 + (i1 - i0)]
        self.dry[:, i0:i1] += seg * sends.pop("dry", 1.0)
        for k, v in sends.items():
            if k not in self.sends:
                self.sends[k] = np.zeros((2, N))
            self.sends[k][:, i0:i1] += v * seg

    def render(self, irs):
        out = self.dry.copy()
        for k, s in self.sends.items():
            nz = np.nonzero(np.any(s != 0, axis=0))[0]
            if len(nz) == 0:
                continue
            a = nz[0]
            ir = irs[k]
            for ch in range(2):
                w = signal.fftconvolve(s[ch, a:], ir[ch])[: N - a]
                out[ch, a:] += w
        return out


# ----------------------------------------------------------------------------
# small helpers for placing notes
# ----------------------------------------------------------------------------
def hum(t, amt=0.008):
    return t + RNG.uniform(-amt, amt)


def vh(v, amt=0.08):
    return v * RNG.uniform(1 - amt, 1 + amt)


def pitch_pan(note, lo=50, hi=96, width=0.6):
    return float(np.clip(((midi(note) - lo) / (hi - lo)) * 2 - 1, -1, 1)) * width


def chord_seq(bus, seq, fn, overlap=0.35, **send):
    """seq = [(t0, t1, notes, kwargs)] ; fn(notes, n, **kw) -> stereo."""
    for t0, t1, notes, kw in seq:
        n = ns(t1 - t0 + overlap)
        bus.add(fn(notes, n, **kw), t0, **send)


# ============================================================================
# SCORE
# ============================================================================
def compose():
    # section dynamics (dB, by note onset): quiet intro, loud bloom, build to 53
    main = Bus("main", dyn=[(0, -6), (8.5, -6), (9.0, -4.5), (20, -4.5), (30.2, -3),
                            (36.7, -3), (36.75, 5), (38.0, 5), (38.4, -3), (45, 0),
                            (52.9, 1.5), (53.0, 3), (53.5, 3), (53.6, -2.5), (60, -3)])
    storm = Bus("storm", dyn=[(20, -5), (22, -5), (27.8, -2), (30, 0)])

    # ---------------------------------------------------------------- 0 - 9 s
    # low drone: D1 sine + dark D2 saw ensemble
    n = ns(10.6)
    dr = stereo(sine_tone("D1", n, 3.0, 1.8, level=0.3, harm=0.4))
    x = ensemble(hz("D2"), n, voices=4, spread=10, vib_depth=0, drift=2)
    x = filt(x, "lp", curve(n, [(0, 160), (6, 220), (8.9, 420), (10.6, 300)]), 0.7, 2)
    dr += 0.55 * x * env_asr(n, 3.5, 1.8)
    main.add(dr, 0.0, gain=0.32, hall=0.25)

    # cold glass pads (low register, leaves room above for the star "tinks")
    for t0, t1, notes in [(0.2, 5.0, ["D3", "A3", "E4"]),
                          (4.3, 9.6, ["D3", "A3", "C4", "F4"])]:
        n = ns(t1 - t0)
        pad = sum(glass_pad(nt, n, 2.2, 1.6, bright=0.25) for nt in notes)
        pad = filt(pad, "lp", 1800, 0.7)
        main.add(pad, t0, gain=0.22, hall=0.5)

    # trembling last star 6.4-8.6: high glass tone with tremolo
    n = ns(2.4)
    tr = glass_pad("A5", n, 0.6, 0.9, bright=0.15)
    tr *= 0.75 + 0.25 * np.sin(TWO_PI * 7.0 * tvec(n))
    main.add(tr, 6.3, gain=0.07, hall=0.6)

    # motif hint (A - D - E ...), before the wink-outs begin
    for t, nt, v in [(0.62, "A4", 0.30), (1.12, "D5", 0.30), (1.62, "E5", 0.26)]:
        main.add(mallet(nt, v, "celesta"), hum(t), p=pitch_pan(nt), hall=0.55, big=0.15)
    # ... answered only when one star remains
    main.add(mallet("F5", 0.22, "celesta"), 6.62, p=0.1, hall=0.55, big=0.2)

    # the star falls 7.5 -> 8.9: accelerating descending celesta cascade,
    # panned upper-left -> lower-right with the arc
    casc = ["D7", "C7", "A6", "G6", "F6", "E6", "D6", "C6", "A5", "G5", "F5", "E5", "D5"]
    K = len(casc) - 1
    for k, nt in enumerate(casc):
        t = 7.5 + 1.32 * np.sqrt(k / K)
        v = 0.12 + 0.16 * (k / K)
        main.add(mallet(nt, v, "celesta", max_len=3.0), hum(t, 0.004),
                 p=-0.7 + 1.3 * k / K, hall=0.6, big=0.25)

    # impact support 8.9: soft low swell
    n = ns(3.2)
    sw = stereo(sine_tone("D2", n, 0.05, 2.6, level=0.5, harm=0.3))
    sw *= np.exp(-tvec(n) / 1.3)
    main.add(sw, 8.9, gain=0.4, hall=0.3)

    # --------------------------------------------------------------- 9 - 20 s
    # D dorian discovery; beat grid 0.8 s anchored to hops at 12.0..14.4
    warm = [
        (9.0, 13.6, ["D3", "A3", "C4", "E4", "F4"], dict(att=1.6, rel=0.6)),
        (13.6, 15.2, ["D3", "G3", "C4", "E4"], dict(att=0.5, rel=0.6)),
        (15.2, 16.8, ["D3", "G3", "B3", "D4"], dict(att=0.35, rel=0.6)),
        (16.8, 18.0, ["D3", "A3", "C4", "F4"], dict(att=0.4, rel=0.5)),
        (18.0, 18.8, ["Bb2", "F3", "A3", "D4"], dict(att=0.3, rel=0.45)),
        (18.8, 19.2, ["C3", "G3", "C4", "E4"], dict(att=0.2, rel=0.4)),
        (19.2, 20.4, ["D3", "A3", "D4", "F4"], dict(att=0.25, rel=1.0)),
    ]
    for t0, t1, notes, kw in warm:
        n = ns(t1 - t0 + kw["rel"] * 0.9)
        cutoff = 1250 if t0 < 15 else 1550
        s = strings(notes, n, kw["att"], kw["rel"], cutoff, voices=5, spread=12, vib=5)
        main.add(s, t0, gain=0.33, hall=0.55)
        g = sum(glass_pad(nt, n, kw["att"] + 0.2, kw["rel"], bright=0.2)
                for nt in notes[1:])
        main.add(g, t0, gain=0.11, hall=0.6)
    # continuing soft low D (pedal)
    n = ns(11.5)
    main.add(stereo(sine_tone("D2", n, 1.5, 1.5, level=0.15, harm=0.2)), 9.0, hall=0.2)

    # star pulse (sparse music-box twinkles)
    for t, nt, v in [(9.85, "D6", 0.16), (10.45, "A5", 0.14)]:
        main.add(mallet(nt, v, "musicbox"), t, p=0.25, hall=0.6, big=0.2)

    # motif statement 1 on Pip's hops (the star answers with the D6 chime)
    for t, nt, v, dmp in [(12.0, "A4", 0.42, 1.0), (12.8, "D5", 0.46, 1.0),
                          (13.6, "E5", 0.48, 1.0), (14.4, "F5", 0.52, 0.85)]:
        main.add(mallet(nt, vh(v), "celesta", damp_at=dmp), hum(t, 0.006), p=pitch_pan(nt),
                 hall=0.5, big=0.15)
        main.add(mallet(nt, vh(v) * 0.35, "musicbox"), hum(t + 0.004, 0.003),
                 p=-pitch_pan(nt), hall=0.5)
    # after the chime: soft echoes in D (star's answer), leave 15.5 clear
    for t, nt, v in [(16.05, "A5", 0.12), (16.45, "D6", 0.10)]:
        main.add(mallet(nt, v, "musicbox"), t, p=0.35, hall=0.65, big=0.25)

    # motif statement 2 (full): A D E F - E D, tender, with sweet harmony
    mel2 = [(16.8, "A4", 0.40), (17.2, "D5", 0.44), (17.6, "E5", 0.47),
            (18.0, "F5", 0.52), (18.8, "E5", 0.45), (19.2, "D5", 0.48)]
    for t, nt, v in mel2:
        main.add(mallet(nt, vh(v), "celesta"), hum(t, 0.006), p=pitch_pan(nt), hall=0.5, big=0.15)
    for t, nt, v in [(18.0, "D5", 0.22), (18.8, "C5", 0.2), (19.2, "A4", 0.2)]:
        main.add(mallet(nt, v, "musicbox"), hum(t + 0.01, 0.004), p=-0.3, hall=0.5)
    # harp bass plucks on the harmonic rhythm
    for t, nt, v in [(12.0, "D3", 0.35), (13.6, "D3", 0.3), (15.2, "G2", 0.33),
                     (16.8, "D3", 0.33), (18.0, "Bb2", 0.33), (18.8, "C3", 0.3),
                     (19.2, "D3", 0.33), (19.6, "A3", 0.2)]:
        main.add(pluck(nt, v, bright=0.3), hum(t, 0.006), p=-0.25, hall=0.4)

    # --------------------------------------------------------------- 20 - 30 s
    # storm bus (hard-gated at 30.0)
    n = ns(10.2)
    sd = stereo(sine_tone("D1", n, 2.0, 0.1, level=0.8, harm=0.35))
    x = ensemble(hz("D2"), n, voices=5, spread=18, vib_depth=0, drift=4)
    x += 0.7 * ensemble(hz("D1"), n, voices=3, spread=12, vib_depth=0, drift=3)
    x = filt(x, "lp", curve(n, [(20, 140), (22, 320), (27.8, 520), (30, 1100)], 20.0), 0.9, 2)
    sd += x * env_asr(n, 2.0, 0.1)
    sd *= curve(n, [(20, 0.0), (21.9, 0.55), (22.1, 0.8), (28, 1.0), (30, 1.35)], 20.0)
    storm.add(sd, 20.0, gain=0.55, room=0.25)

    # dissonant tremolo clusters
    n = ns(9.6)
    lowc = strings(["D2", "A2", "D3", "Eb3"], n, 1.8, 0.1,
                   curve(n, [(20.4, 500), (22, 900), (30, 2600)], 20.4), trem=11)
    lowc *= curve(n, [(20.4, 0.2), (22.0, 0.7), (27.8, 0.9), (30, 1.3)], 20.4)
    storm.add(lowc, 20.4, gain=0.40, room=0.35)
    n = ns(8.0)
    midc = strings(["A3", "Bb3", "D4", "Eb4", "E4"], n, 1.2, 0.1,
                   curve(n, [(22, 900), (26, 1800), (30, 4200)], 22.0), trem=13)
    midc *= curve(n, [(22, 0.35), (24.5, 0.55), (27.8, 0.8), (30, 1.4)], 22.0)
    storm.add(midc, 22.0, gain=0.30, room=0.4)
    # high cluster gliding upward (tension riser) 25.5 -> 30
    n = ns(4.5)
    tt = 25.5 + tvec(n)
    glide = np.interp(tt, [25.5, 27.8, 30.0], [0.0, 0.3, 3.0])
    hi = np.zeros((2, n))
    for nt in ["D5", "Eb5", "A5", "Bb5"]:
        hi += ensemble(hz(nt) * 2 ** (glide / 12), n, voices=5, spread=20, vib_depth=10)
    hi = filt(hi, "lp", 5000, 0.7, 2) * env_asr(n, 1.5, 0.05)
    hi *= curve(n, [(25.5, 0.2), (27.8, 0.45), (30, 1.2)], 25.5)
    storm.add(hi, 25.5, gain=0.12, room=0.5)

    # spiccato low-string ostinato
    patt = ["D2", "D2", "D3", "D2", "Eb2", "D2", "D3", "F2"]
    steps = [22.0 + 0.25 * i for i in range(23)] + [27.8 + 0.2 * i for i in range(11)]
    for i, t in enumerate(steps):
        nt = patt[i % len(patt)]
        acc = 1.0 if i % 4 == 0 else 0.7
        prog = np.interp(t, [22, 27.8, 30], [0.55, 0.75, 1.0])
        n = ns(0.3)
        s = brass([nt], n, 0.008, 0.12, vel=0.6 * acc, decay_to=0.2, decay_t=0.07)
        storm.add(s, hum(t, 0.005), gain=0.55 * acc * prog, room=0.25)

    # taiko: distant warning, pickup, then the storm pattern
    for t, v in [(20.4, 0.22), (21.2, 0.3), (21.55, 0.28), (21.75, 0.38), (21.9, 0.5)]:
        storm.add(taiko(v, 55), t, p=RNG.uniform(-0.2, 0.2), room=0.5)
    low_p = [1.0, 0, 0, 0.6, 0, 0.5, 0, 0]
    mid_p = [0, 0, 0.4, 0, 0.5, 0, 0.35, 0.55]
    for i in range(23):
        t = 22.0 + 0.25 * i
        if abs(t - 24.5) < 1e-6:
            continue
        lv, mv = low_p[i % 8], mid_p[i % 8]
        if lv:
            storm.add(taiko(vh(lv) * 0.8), hum(t, 0.006), p=-0.15, room=0.4)
        if mv:
            storm.add(taiko(vh(mv) * 0.6, 110, 0.35), hum(t, 0.006), p=0.3, room=0.4)
    for i in range(11):
        t = 27.8 + 0.2 * i
        if i == 0:
            continue
        storm.add(taiko(vh(0.55 + 0.04 * i)), hum(t, 0.005), p=-0.15, room=0.4)
        storm.add(taiko(vh(0.35 + 0.03 * i), 110, 0.3), hum(t + 0.1, 0.005), p=0.3, room=0.4)
    # final roll 29.0 -> 30.0 (crescendo)
    for i in range(20):
        t = 29.0 + 0.05 * i
        storm.add(taiko(0.18 + 0.03 * i, 146.8, 0.2), t, p=(-1) ** i * 0.35, room=0.4)
    # big hits: storm hits 22.0, lightning 24.5 & 27.8
    for t, v in [(22.0, 0.8), (24.5, 0.9), (27.8, 1.0)]:
        storm.add(taiko(v, 55, 1.2), t, room=0.45)
        storm.add(boom(v * 0.9, 34, 1.4), t, room=0.2)
        n = ns(2.2)
        stab = brass(["D3", "Ab3", "Eb4", "A4"], n, 0.02, 1.0, vel=0.9 * v,
                     decay_to=0.15, decay_t=0.45)
        storm.add(stab, t, gain=0.45 * v, room=0.5)
    # riser 27.8 -> 30
    n = ns(2.2)
    rs = noise_riser(n, 250, 5000, 3.0) * curve(n, [(27.8, 0.0), (29.0, 0.3), (30, 1.0)], 27.8)
    storm.add(rs, 27.8, gain=0.08, room=0.3)

    # --------------------------------------------------------------- 30.6 - 36.8
    n = ns(7.0)
    lt = stereo(sine_tone("D2", n, 1.2, 0.6, level=0.10, harm=0.18, vib=3, vib_rate=0.35))
    lt *= 1 + 0.12 * np.sin(TWO_PI * 0.4 * tvec(n))
    main.add(lt, 30.35, hall=0.35)
    n = ns(4.3)
    main.add(sine_tone("A5", n, 1.6, 1.4, level=0.012, harm=0.0, vib=6, vib_rate=4.8),
             32.2, p=0.3, hall=0.8, big=0.4)

    # reverse swell 35.0 -> 36.8: reversed cymbal + reversed reverb of a D pad
    rc = cymbal(2.4, 1.1, 0.5)[:, ::-1]
    rc *= np.linspace(0, 1, rc.shape[1]) ** 1.5
    main.add(rc, 36.8 - rc.shape[1] / SR, gain=0.35)
    n = ns(0.6)
    rp = sum(glass_pad(nt, n, 0.05, 0.3, bright=0.5) for nt in ["D4", "F#4", "A4", "D5"])
    rp = np.concatenate([rp, np.zeros((2, ns(3.5)))], axis=1)
    irr = make_ir(3.0, 3.5, 99)
    wet = np.stack([signal.fftconvolve(rp[c], irr[c])[: rp.shape[1]] for c in range(2)])
    wet = wet[:, ::-1]
    L = ns(1.8)
    wet = wet[:, -L:] * np.linspace(0, 1, L) ** 2
    wet *= env_asr(L, 0.0, 0.004)
    main.add(wet / (np.abs(wet).max() + 1e-9), 36.8 - L / SR, gain=0.22)

    # --------------------------------------------------------------- 36.8 bloom
    T = 36.8
    main.add(timpani("D2", 1.0, 2.5), T, gain=0.6, hall=0.3, big=0.2)
    main.add(boom(1.0, 36.7, 2.0), T, gain=0.5, hall=0.15)
    main.add(cymbal(4.5, 1.8, 0.8), T, gain=0.2, hall=0.25, big=0.15)
    n = ns(3.6)
    main.add(brass(["D3", "A3", "D4", "F#4", "A4"], n, 0.05, 1.2, vel=1.0,
                   decay_to=0.35, decay_t=1.1), T, gain=0.9, hall=0.35, big=0.35)
    n = ns(3.0)
    main.add(strings(["D2", "A2", "D3", "F#3", "A3", "D4", "F#4", "A4", "D5"], n, 0.12, 0.9,
                     curve(n, [(0, 7000), (1.5, 4000), (3, 2600)]), voices=7, spread=18),
             T, gain=0.9, hall=0.4, big=0.4)
    n = ns(3.2)
    main.add(choir(["D4", "F#4", "A4", "D5"], n, 0.3, 1.0), T, gain=0.55, hall=0.4, big=0.4)
    n = ns(2.8)
    main.add(stereo(sine_tone("D1", n, 0.03, 1.0, level=0.8, harm=0.3)), T)
    n = ns(3.0)
    sh = sum(sine_tone(nt, n, 0.15, 1.5, level=1.0, harm=0.0, vib=5) for nt in
             ["D6", "F#6", "A6", "D7"])
    main.add(stereo(sh), T, gain=0.08, dry=0.0, big=1.0)
    for t, nt in [(36.95, "D7"), (37.2, "A6"), (37.45, "F#7"), (37.8, "D7")]:
        main.add(mallet(nt, 0.18, "glass"), t, p=RNG.uniform(-0.6, 0.6), hall=0.5, big=0.5)

    # --------------------------------------------------------------- 38.5 - 53
    V = {
        "D": ["D3", "A3", "D4", "F#4", "A4"],
        "Bm": ["B2", "F#3", "B3", "D4", "F#4"],
        "G": ["G2", "D3", "B3", "D4", "G4"],
        "A": ["A2", "E3", "A3", "C#4", "E4"],
        "F#m": ["F#2", "C#3", "A3", "C#4", "F#4"],
        "Asus4": ["A2", "E3", "A3", "D4", "E4"],
    }
    BASS = {"D": "D2", "Bm": "B1", "G": "G1", "A": "A1", "F#m": "F#1", "Asus4": "A1"}
    ARP = {
        "D": ["D", "F#", "A"], "Bm": ["B", "D", "F#"], "G": ["G", "B", "D"],
        "A": ["A", "C#", "E"], "F#m": ["F#", "A", "C#"], "Asus4": ["A", "D", "E"],
    }
    prog = [(38.5, 41.0, "D"), (41.0, 43.0, "Bm"), (43.0, 45.0, "G"), (45.0, 47.0, "A"),
            (47.0, 49.0, "F#m"), (49.0, 51.0, "G"), (51.0, 52.0, "Asus4"), (52.0, 53.0, "A")]

    for t0, t1, ch in prog:
        k = np.interp(t0, [38.5, 53], [0.0, 1.0])
        rel = 0.45
        n = ns(t1 - t0 + rel * 0.9)
        att = 0.9 if t0 == 38.5 else 0.3
        cut = 1800 + 3600 * k
        s = strings(V[ch], n, att, rel, cut, voices=7, spread=16)
        main.add(s, t0, gain=0.45 + 0.4 * k, hall=0.45, big=0.15)
        # octave-up violins for lift in the second half
        if t0 >= 45.0:
            s2 = strings([nt[:-1] + str(int(nt[-1]) + 1) for nt in V[ch][2:]], n, att, rel,
                         cut + 1500, voices=7, spread=18)
            main.add(s2, t0, gain=0.16 + 0.25 * k, hall=0.5, big=0.25)
        # bass: celli/basses + sub
        b = strings([BASS[ch], midi(BASS[ch]) + 12], n, 0.12, rel, 900, voices=5, spread=10)
        main.add(b, t0, gain=0.30 + 0.22 * k, hall=0.3)
        main.add(stereo(sine_tone(BASS[ch], n, 0.08, rel, level=0.3 + 0.2 * k, harm=0.1)), t0)
        # choir pad from 43
        if t0 >= 43.0:
            cn = [nt for nt in V[ch][2:]]
            main.add(choir(cn, n, 0.5 if t0 == 43 else 0.3, rel), t0,
                     gain=0.18 + 0.35 * k, hall=0.5, big=0.35)

    # rising arpeggios (harp + celesta doubling)
    def arp_tones(ch, lo, hi):
        pcs = [_PC[p] for p in ARP[ch]]
        return [m for m in range(int(midi(lo)), int(midi(hi)) + 1) if m % 12 in pcs]

    for t0, t1, ch in prog:
        t = t0
        while t < t1 - 1e-6:
            bar_pos = t - t0
            fast = t >= 47.0
            step = 0.125 if fast else 0.25
            top = "A6" if t >= 51 else ("D6" if fast else "A5")
            tones = arp_tones(ch, "D4" if not fast else "A3", top)
            per = 16 if fast else 8
            i = int(round(bar_pos / step))
            if t >= 52.0:              # final run: keep rising to the climax
                i = int(round((t - 51.0) / step))
            nt = tones[i % len(tones)] if t < 51 else tones[min(i, len(tones) - 1)]
            k = np.interp(t, [38.5, 53], [0.0, 1.0])
            acc = 1.0 if i % 4 == 0 else 0.75
            v = vh((0.28 + 0.3 * k) * acc)
            main.add(pluck(nt, v, bright=0.5 + 0.4 * k, length=1.3, rel=0.5), hum(t, 0.006),
                     p=pitch_pan(nt, 55, 95, 0.7), hall=0.4, big=0.1)
            if fast and i % 2 == 0:
                main.add(mallet(nt + 12, v * 0.35, "celesta", max_len=2.0), hum(t, 0.005),
                         p=-pitch_pan(nt, 55, 95, 0.6), hall=0.5, big=0.2)
            t = round(t + step, 6)

    # percussion @120 BPM: bars start on odd seconds; backbeats on the branch accents
    for i in range(14):
        t = 39.0 + i
        k = np.interp(t, [39, 53], [0, 1])
        main.add(membrane(55, vh(0.55 + 0.35 * k), 0.38, bend=2.2, bend_t=0.02, noise=0.2),
                 hum(t, 0.004), hall=0.15)
    for i in range(14):
        t = 39.5 + i
        k = np.interp(t, [39, 53], [0, 1])
        strong = t <= 42.6
        main.add(taiko(vh(0.75 if strong else 0.45 + 0.2 * k), 110, 0.45), hum(t, 0.004),
                 p=0.1, hall=0.35)
        if strong:
            main.add(timpani("A2" if i % 2 else "D2", 0.55, 1.2), t, gain=0.6, hall=0.3)
            n = ns(0.5)
            st = strings([nt for nt in (V["D"] if t < 41 else V["Bm"])], n, 0.01, 0.35,
                         3500, voices=5)
            st *= np.exp(-tvec(n) / 0.09)
            main.add(st, t, gain=0.9, hall=0.45)
            main.add(mallet("D7" if t < 41 else "B6", 0.12, "glass"), t + 0.01,
                     p=RNG.uniform(-0.5, 0.5), hall=0.5, big=0.4)
        else:
            nz = filt(RNG.standard_normal((2, ns(0.25))), "bp", 1800, 0.8)
            nz *= np.exp(-tvec(ns(0.25)) / 0.05)
            main.add(nz, t, gain=0.05 + 0.08 * k, hall=0.4)
    t = 43.0
    while t < 53.0 - 1e-6:
        k = np.interp(t, [43, 53], [0, 1])
        on = abs((t * 4) % 2) < 1e-6
        main.add(shaker(vh(0.08 + 0.10 * k) * (1.0 if on else 0.6)), hum(t, 0.004),
                 p=0.35, hall=0.2)
        t = round(t + (0.125 if t >= 49 else 0.25), 6)
    for i in range(8):                  # taiko drive 49-52
        t = 49.0 + 0.5 * i + 0.25
        main.add(taiko(vh(0.35 + 0.05 * i), 73.4, 0.6), hum(t, 0.005), p=-0.2, hall=0.35)
    for i in range(16):                 # timpani roll into the climax
        t = 52.0 + 0.0625 * i
        main.add(timpani("A2", 0.12 + 0.03 * i, 0.9), t, p=(-1) ** i * 0.2, hall=0.35)
    rc = cymbal(1.6, 0.9, 0.45)[:, ::-1] * np.linspace(0, 1, ns(1.6)) ** 2
    main.add(rc, 53.0 - 1.6, gain=0.35, hall=0.2)

    # lead: motif in augmentation (D major colour), violins + horns
    lead = [(47.0, "A4", 0.5), (47.5, "D5", 0.5), (48.0, "E5", 0.5), (48.5, "F#5", 1.0),
            (49.5, "E5", 0.5), (50.0, "D5", 1.0), (51.0, "E5", 0.5), (51.5, "F#5", 0.5),
            (52.0, "A5", 0.5), (52.5, "C#6", 0.5)]
    for t, nt, d in lead:
        n = ns(d + 0.35)
        k = np.interp(t, [47, 53], [0, 1])
        v = strings([nt], n, 0.08, 0.3, 3800 + 2000 * k, voices=7, spread=12, vib=12, stages=1)
        main.add(v, t, gain=0.33 + 0.15 * k, hall=0.5, big=0.3)
        if t >= 49.0:
            h = brass([midi(nt) - 12], n, 0.07, 0.3, vel=0.5 + 0.3 * k, decay_to=0.8)
            main.add(h, t, gain=0.22 + 0.2 * k, hall=0.5, big=0.2)

    # --------------------------------------------------------------- 53 climax
    T = 53.0
    main.add(timpani("D2", 1.0, 2.2), T, gain=0.6, hall=0.3, big=0.2)
    main.add(taiko(1.0, 55, 1.3), T, gain=0.55, hall=0.3)
    main.add(boom(0.9, 36.7, 1.8), T, gain=0.35)
    main.add(cymbal(5.0, 2.0, 0.9), T, gain=0.2, hall=0.25, big=0.15)
    n = ns(3.4)
    main.add(brass(["D3", "A3", "D4", "F#4", "A4", "D5"], n, 0.04, 1.6, vel=1.0,
                   decay_to=0.3, decay_t=0.9), T, gain=0.85, hall=0.35, big=0.4)
    n = ns(2.6)
    main.add(strings(["D6"], n, 0.06, 1.2, 6500, voices=7, spread=12, vib=12, stages=1),
             T, gain=0.5, hall=0.5, big=0.5)
    n = ns(3.0)
    env = np.interp(tvec(n), [0, 0.8, 2.0, 3.0], [1.0, 0.55, 0.3, 0.3])
    s = strings(["D2", "A2", "D3", "F#3", "A3", "D4", "F#4", "A4", "D5", "F#5"], n, 0.05, 1.3,
                curve(n, [(0, 7500), (1.5, 3500), (3, 2200)]), voices=7, spread=18)
    main.add(s * env, T, gain=1.0, hall=0.45, big=0.3)
    n = ns(3.2)
    main.add(choir(["D4", "F#4", "A4", "D5", "F#5"], n, 0.15, 1.6) * np.interp(
        tvec(n), [0, 1.0, 3.2], [1.0, 0.5, 0.35]), T, gain=0.6, hall=0.4, big=0.3)
    n = ns(2.8)
    main.add(stereo(sine_tone("D1", n, 0.03, 1.4, level=0.8, harm=0.3)), T)
    n = ns(3.5)
    sh = sum(sine_tone(nt, n, 0.1, 2.0, level=1.0, harm=0.0, vib=5) for nt in
             ["D6", "F#6", "A6", "D7", "E7"])
    main.add(stereo(sh), T, gain=0.07, dry=0.0, big=1.0)

    # --------------------------------------------------------------- 53 - 60
    res = [(54.6, 56.3, ["D3", "G3", "B3", "D4"], dict(att=0.9, rel=0.6)),
           (56.0, 58.7, ["D3", "A3", "D4", "F#4"], dict(att=0.5, rel=0.8)),
           (58.5, 60.0, ["D3", "A3", "E4", "F#4"], dict(att=0.25, rel=1.1))]
    for t0, t1, notes, kw in res:
        n = ns(t1 - t0)
        main.add(strings(notes, n, kw["att"], kw["rel"], 1900, voices=6, spread=14, vib=6),
                 t0, gain=0.45, hall=0.55, big=0.2)
        main.add(choir(notes[1:], n, kw["att"] + 0.3, kw["rel"]), t0, gain=0.12,
                 hall=0.5, big=0.4)
    n = ns(5.4)
    main.add(stereo(sine_tone("D2", n, 0.8, 1.2, level=0.25, harm=0.15)), 54.4, hall=0.2)

    # motif recapitulation in D major on celesta (+ octave shimmer)
    recap = [(54.0, "A4", 0.40), (54.4, "D5", 0.44), (54.8, "E5", 0.46),
             (55.2, "F#5", 0.52), (56.0, "E5", 0.42), (56.4, "D5", 0.46)]
    for t, nt, v in recap:
        main.add(mallet(nt, vh(v), "celesta"), hum(t, 0.006), p=pitch_pan(nt), hall=0.55, big=0.25)
        main.add(mallet(midi(nt) + 12, vh(v) * 0.22, "musicbox"), hum(t + 0.005, 0.003),
                 p=-pitch_pan(nt), hall=0.55, big=0.25)
    for t, nt, v in [(55.2, "A4", 0.18), (56.4, "F#4", 0.16)]:
        main.add(mallet(nt, v, "celesta"), t + 0.01, p=-0.2, hall=0.5)
    # the star's twinkles
    for t, nt, v in [(56.8, "A5", 0.26), (57.4, "D6", 0.28)]:
        main.add(mallet(nt, v, "celesta"), t, p=0.3, hall=0.6, big=0.35)
        main.add(mallet(midi(nt) + 12, v * 0.3, "glass"), t, p=0.4, hall=0.6, big=0.35)
    # final bell chord 58.5
    T = 58.5
    for nt, v, p in [("D5", 0.40, 0.0), ("D4", 0.22, -0.2), ("A4", 0.12, 0.25), ("F#5", 0.10, -0.3)]:
        main.add(mallet(nt, v, "bell", max_len=1.6), T + RNG.uniform(0, 0.012), p=p,
                 hall=0.5, big=0.35)
    for nt, v in [("A5", 0.16), ("D6", 0.16), ("F#6", 0.1)]:
        main.add(mallet(nt, v, "celesta", max_len=1.5), T + RNG.uniform(0.005, 0.03),
                 p=RNG.uniform(-0.4, 0.4), hall=0.55, big=0.35)

    return main, storm


# ============================================================================
# mastering
# ============================================================================
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285],
       [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def lufs(x):
    y = signal.lfilter(*_K1, x, axis=-1)
    y = signal.lfilter(*_K2, y, axis=-1)
    blk, hop = ns(0.4), ns(0.1)
    ms = []
    for i in range(0, y.shape[1] - blk + 1, hop):
        ms.append(np.sum(np.mean(y[:, i:i + blk] ** 2, axis=1)))
    ms = np.array(ms)
    lk = -0.691 + 10 * np.log10(ms + 1e-20)
    g = ms[lk > -70]
    if len(g) == 0:
        return -120.0
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g = ms[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(np.mean(g))


def true_peak(x):
    return np.abs(signal.resample_poly(x, 4, 1, axis=1)).max()


def compressor(x, thresh_db, ratio=2.0, win=0.08, smooth=0.25):
    det = np.sqrt(np.maximum(signal.oaconvolve(np.mean(x ** 2, axis=0),
                                            np.ones(ns(win)) / ns(win), "same"), 0.0))
    lvl = 20 * np.log10(det + 1e-9)
    gr = np.minimum(0.0, (thresh_db - lvl) * (1 - 1 / ratio))
    # smooth the gain (zero-phase, so the compressor never lags a transient)
    w = signal.windows.hann(ns(smooth))
    gr = signal.oaconvolve(gr, w / w.sum(), "same")
    return x * 10 ** (gr / 20)


def limiter(x, ceiling_db=-1.3, look=0.004):
    up = np.abs(signal.resample_poly(x, 4, 1, axis=1)).max(axis=0)
    pk = up[: 4 * N].reshape(-1, 4).max(axis=1)
    c = 10 ** (ceiling_db / 20)
    g = np.minimum(1.0, c / np.maximum(pk, 1e-12))
    W = ns(look)
    g = minimum_filter1d(g, 2 * W + 1)
    g = uniform_filter1d(g, W + 1, mode="nearest")
    print(f"limiter: max gain reduction {-20 * np.log10(g.min()):.2f} dB, "
          f"active on {np.mean(g < 0.999) * 100:.2f}% of samples")
    act = np.nonzero(g < 0.97)[0] / SR
    if len(act):
        print("  limiting >0.3 dB around t =", sorted(set(np.round(act, 1)))[:40])
    return x * g


def master(main, storm):
    irs = {
        "hall": make_ir(3.1, 5.0, 11),
        "big": make_ir(6.5, 9.0, 22, pre=0.03, damp=(1.2, 1.0, 0.95, 0.8, 0.6), bright=1.3),
        "room": make_ir(2.0, 3.5, 33, damp=(1.5, 1.0, 0.7, 0.45, 0.25)),
    }
    m = main.render(irs)
    s = storm.render(irs)
    # hard, dramatic storm cut: 30.0 -> -20 dB in 45 ms, gone by 30.6
    t = tvec(N)
    g = np.ones(N)
    a, b = ns(30.0), ns(30.045)
    g[a:b] = 1 - 0.9 * (0.5 - 0.5 * np.cos(np.pi * np.arange(b - a) / (b - a)))
    c = ns(30.6)
    g[b:c] = 0.1 * (0.5 + 0.5 * np.cos(np.pi * np.arange(c - b) / (c - b)))
    g[c:] = 0.0
    s *= g
    x = m + s
    # subsonic / DC clean-up
    x = signal.sosfiltfilt(signal.butter(2, 22, "high", fs=SR, output="sos"), x, axis=1)
    # final fade: bell tail to digital silence before 60.0
    f0, f1 = ns(58.95), ns(59.9)
    fade = np.ones(N)
    fade[f0:f1] = (0.5 + 0.5 * np.cos(np.pi * np.arange(f1 - f0) / (f1 - f0))) ** 1.5
    fade[f1:] = 0.0
    x *= fade
    # glue compression + loudness target
    x *= 10 ** ((-16.0 - lufs(x)) / 20)
    x = compressor(x, -14.0, ratio=1.5)
    x *= 10 ** ((-18.0 - lufs(x)) / 20)
    x = limiter(x, -1.4)
    x = signal.lfilter([1, -1], [1, -0.9995], x, axis=1)      # DC blocker (~4 Hz)
    tp = true_peak(x)
    if tp > 10 ** (-1.05 / 20):
        x *= 10 ** (-1.05 / 20) / tp
    x[:, f1:] = 0.0
    x[:, :ns(0.005)] *= np.linspace(0, 1, ns(0.005))
    return x


def main_entry():
    main_bus, storm_bus = compose()
    x = master(main_bus, storm_bus)
    assert x.shape == (2, N)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wavfile.write(OUT, SR, x.T.astype(np.float32))
    print(f"wrote {OUT}: {x.shape[1]} samples, {x.shape[1] / SR:.3f} s")
    print(f"integrated loudness {lufs(x):.2f} LUFS, true peak "
          f"{20 * np.log10(true_peak(x)):.2f} dBTP, sample peak "
          f"{20 * np.log10(np.abs(x).max()):.2f} dBFS, DC {x.mean(axis=1)}")


if __name__ == "__main__":
    main_entry()
