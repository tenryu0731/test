#!/usr/bin/env python3
"""
LAST LIGHT -- procedural SFX / Foley / ambience stem (everything that is not music).

Run from the repo root:   python3 audio/sfx.py
Output:                   audio/stems/sfx.wav  (48 kHz, stereo, 32-bit float,
                          exactly 2,880,000 samples, true peak <= -1 dBFS)

Everything is synthesised from scratch (filtered / spectrally shaped noise,
modal synthesis for glass and bells, FM blips, stick-slip friction models for
wood creaks, granular sparkle clouds, synthetic convolution reverbs).  All
randomness comes from fixed seeds, so every run is bit-identical.

Only numpy + scipy are required.
"""
import os

import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48_000
N = 2_880_000                     # exactly 60.000 s
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "stems", "sfx.wav")
TWO_PI = 2.0 * np.pi
TARGET_LUFS = -20.0
CEILING_DBTP = -1.3               # a little headroom under the -1 dBTP spec

# per-scene level trims (dB) -- the balance between scenes lives here
SCENE_TRIM = dict(night=2.0, fall=1.0, wind=-5.0, desert=5.0, storm=-5.0, silence=2.0,
                  ignition=-1.0, growth=6.0, finale=3.0)

# D-major pentatonic / D-minor note tables (Hz) used by pitched sparkles
D_MAJ_PENT = np.array([587.33, 659.26, 739.99, 880.00, 987.77])          # D5 E5 F#5 A5 B5
D_MINOR_DESC = [2349.32, 2093.00, 1864.66, 1760.00, 1567.98, 1396.91,
                1318.51, 1174.66, 1046.50, 932.33, 880.00, 783.99]       # D7 .. G5


# ----------------------------------------------------------------------------
# basic helpers
# ----------------------------------------------------------------------------
def R(seed):
    return np.random.default_rng(seed)


def dbl(d):
    return 10.0 ** (d / 20.0)


def ns(sec):
    return int(round(sec * SR))


def tv(n):
    return np.arange(n) / SR


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _butter(x, kind, f, order=2):
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def lp(x, f, o=2):
    return _butter(x, "lowpass", f, o)


def hp(x, f, o=2):
    return _butter(x, "highpass", f, o)


def bp(x, lo, hi, o=2):
    return _butter(x, "bandpass", [lo, hi], o)


def fades(x, fin=0.002, fout=0.01):
    """Raised-cosine fade in/out (first and last sample become exactly 0)."""
    x = np.array(x, dtype=float, copy=True)
    n = x.shape[-1]
    a = min(ns(fin), n // 2)
    b = min(ns(fout), n // 2)
    if a > 0:
        x[..., :a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        x[..., n - b:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
    return x


def env_ad(n, att, tau, rel=0.02):
    """Raised-cosine attack, exponential decay, smooth release to zero."""
    t = tv(n)
    e = np.exp(-np.maximum(t - att, 0.0) / tau)
    a = ns(att)
    if a > 0:
        e[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    return fades(e, 0.0, rel)


def pan_gains(p):
    th = (np.clip(p, -1.0, 1.0) + 1.0) * np.pi / 4.0
    return np.cos(th), np.sin(th)


_CTRL = {}


def ctrl(t, cutoff, seed, rate=None):
    """Smooth random control signal (unit std) evaluated at times t.  It lives on
    a fixed -10..70 s grid, so every caller using the same (cutoff, seed) sees
    the same curve (e.g. the storm gusts drive wind, grit, flicker and crackles)."""
    if rate is None:
        rate = max(8.0 * cutoff, 20.0)
    key = (cutoff, seed, rate)
    if key not in _CTRL:
        m = int(80.0 * rate)
        w = R(seed).standard_normal(m)
        sos = signal.butter(2, cutoff, fs=rate, output="sos")
        w = signal.sosfiltfilt(sos, w)
        _CTRL[key] = w / (w.std() + 1e-12)
    w = _CTRL[key]
    return np.interp(t, -10.0 + np.arange(len(w)) / rate, w)


def glog(F, fc, bw_oct):
    """Gaussian band in log-frequency."""
    return np.exp(-0.5 * (np.log2(F / fc) / bw_oct) ** 2)


def lpf(F, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (F / fc) ** (2 * order))


def hpf(F, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (fc / F) ** (2 * order))


NPER = 2048


def shaped_noise(t0, t1, magfn, seed, nper=NPER):
    """White noise re-shaped in the STFT domain: magfn(F[:,None], T[None,:])
    returns the (time-varying) magnitude response; T is absolute time."""
    n = ns(t1 - t0)
    x = R(seed).standard_normal(n)
    nov = nper * 3 // 4
    f, tt, Z = signal.stft(x, fs=SR, window="hann", nperseg=nper, noverlap=nov)
    F = np.maximum(f, 1.0)[:, None]
    T = (tt + t0)[None, :]
    M = magfn(F, T)
    _, y = signal.istft(Z * M, fs=SR, window="hann", nperseg=nper, noverlap=nov)
    y = y[:n]
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    return y


def shaped_noise_st(t0, t1, magfn, seed, nper=NPER):
    """Stereo (decorrelated) version; magfn(F, T, ch)."""
    return np.vstack([shaped_noise(t0, t1, lambda F, T, c=c: magfn(F, T, c), seed + 17 * c, nper)
                      for c in range(2)])


# ----------------------------------------------------------------------------
# mixer with two reverb sends
# ----------------------------------------------------------------------------
class Mix:
    def __init__(self):
        # groups: "main", and "storm" (whose whole stem incl. reverb tails is
        # slammed shut at 30.0-30.6 s)
        self.b = {g: {k: np.zeros((2, N)) for k in ("dry", "room", "hall")} for g in ("main", "storm")}
        self.offset = 0.0          # per-scene trim (dB), set by each scene builder
        self.group = "main"

    def add(self, sig, t, pan=0.0, gain_db=0.0, room=0.0, hall=0.0, dry=1.0, anchor=0.0, group=None):
        """Place `sig` so that its time `anchor` (s) lands at absolute time t."""
        sig = np.asarray(sig, dtype=float)
        n = sig.shape[-1]
        pan = np.asarray(pan, dtype=float)
        if sig.ndim == 1:
            gl, gr = pan_gains(pan)
            st = np.vstack([sig * gl, sig * gr])
        else:
            p = np.clip(pan, -1.0, 1.0)
            st = np.vstack([sig[0] * np.minimum(1.0, 1.0 - p), sig[1] * np.minimum(1.0, 1.0 + p)])
        st *= dbl(gain_db + self.offset)
        i0 = ns(t - anchor)
        a, b = max(i0, 0), min(i0 + n, N)
        if b <= a:
            return
        seg = st[:, a - i0:b - i0]
        bus = self.b[group or self.group]
        if dry:
            bus["dry"][:, a:b] += seg * dry
        if room:
            bus["room"][:, a:b] += seg * room
        if hall:
            bus["hall"][:, a:b] += seg * hall


def make_ir(dur, rts, predelay, taps, seed, build=0.012):
    """Synthetic stereo IR: 3-band exponentially decaying noise tail + early
    reflections.  rts = (RT60 low, mid, high)."""
    r = R(seed)
    n = ns(dur)
    t = tv(n)
    ir = np.zeros((2, n))
    for ch in range(2):
        w = r.standard_normal(n)
        lo, mid, hi = lp(w, 350, 2), bp(w, 350, 3500, 2), hp(w, 3500, 2)
        tail = (lo * np.exp(-6.91 * t / rts[0]) + mid * np.exp(-6.91 * t / rts[1])
                + hi * np.exp(-6.91 * t / rts[2]))
        pd = ns(predelay)
        tail = np.concatenate([np.zeros(pd), tail[: n - pd]])
        tail *= 1.0 - np.exp(-np.maximum(t - predelay, 0.0) / build)
        er = np.zeros(n)
        for td, g in taps:
            i = ns(td + r.uniform(-0.003, 0.003))
            if i < n:
                er[i] += g * r.choice([-1.0, 1.0]) * r.uniform(0.7, 1.0)
        er = lp(er, 5000, 2)
        ir[ch] = tail * 0.35 + er * 1.6
        ir[ch] = fades(ir[ch], 0.0, 0.2)
    ir /= np.sqrt(np.sum(ir ** 2) / 2.0)
    return ir


def convolve_bus(x, ir):
    xl = 0.8 * x[0] + 0.2 * x[1]
    xr = 0.8 * x[1] + 0.2 * x[0]
    yl = signal.oaconvolve(xl, ir[0])[:N]
    yr = signal.oaconvolve(xr, ir[1])[:N]
    return np.vstack([yl, yr])


# ----------------------------------------------------------------------------
# sound "instruments"
# ----------------------------------------------------------------------------
def glass(f0, seed, decay=0.8, bright=1.0, dur=None, tap=0.25, detune=0.0012):
    """Modal glass 'tink' (free glass modes) with detuned pairs for shimmer."""
    r = R(seed)
    ratios = np.array([1.0, 2.32, 4.25, 6.63, 9.38])
    amps = np.array([1.0, 0.45, 0.26, 0.13, 0.06]) * bright ** np.arange(5)
    dur = dur or decay * 5.0
    n = ns(dur)
    t = tv(n)
    y = np.zeros(n)
    for rt, a in zip(ratios, amps):
        f = f0 * rt * (1 + r.uniform(-0.002, 0.002))
        if f > 18500:
            continue
        tau = decay / rt ** 0.8
        ph = r.uniform(0, TWO_PI)          # pair starts in phase -> crisp attack, then shimmers
        dd = detune * r.uniform(0.3, 1.0)
        for d, w in ((-1.0, 0.7), (1.0, 0.3)):
            y += w * a * np.exp(-t / tau) * np.sin(TWO_PI * f * (1 + d * dd) * t + ph)
    m = ns(0.004)
    y[:m] += tap * hp(r.standard_normal(m), 3000) * np.hanning(m)
    return fades(y, 0.0015, min(0.08, dur / 4))


def crystal_bell(f0, seed, decay=3.0, dur=None, ripple=1.0, bright=1.0):
    """Crystalline bell: harmonic core + free-bar (glockenspiel) inharmonics,
    every mode a slowly beating detuned pair -> shimmering ripple."""
    r = R(seed)
    parts = [(0.5, 0.16, 1.2), (1.0, 1.0, 1.0), (2.0, 0.34, 0.55), (2.76, 0.24, 0.36),
             (3.0, 0.10, 0.40), (4.07, 0.12, 0.24), (5.40, 0.09, 0.17), (6.80, 0.05, 0.12),
             (8.93, 0.035, 0.08)]
    dur = dur or decay * 1.8
    n = ns(dur)
    t = tv(n)
    y = np.zeros(n)
    for k, (rt, a, dk) in enumerate(parts):
        f = f0 * rt
        if f > 18500:
            continue
        a = a * (bright ** min(k, 4) if k > 1 else 1.0)
        tau = decay * dk
        beat = ripple * r.uniform(0.7, 2.6)
        ph = r.uniform(0, TWO_PI)
        for d, w in ((-0.5, 0.72), (0.5, 0.28)):
            y += w * a * np.exp(-t / tau) * np.sin(TWO_PI * (f + d * beat) * t + ph)
    m = ns(0.003)
    y[:m] += 0.3 * hp(r.standard_normal(m), 4000) * np.hanning(m)
    return fades(y, 0.001, min(0.3, dur / 4))


def ping(f, tau, att=0.002, glide=0.0, dur=None, harm=0.0, vib=0.0, seed=0):
    """Tiny sine grain with optional glide (octaves over its duration)."""
    dur = dur or min(tau * 6.0 + att, 3.0)
    n = max(ns(dur), 16)
    t = tv(n)
    fr = f * 2.0 ** (glide * t / dur)
    if vib:
        fr = fr * (1 + vib * np.sin(TWO_PI * 7.0 * t + seed))
    ph = TWO_PI * np.cumsum(fr) / SR + (seed * 1.618) % TWO_PI
    y = np.sin(ph) + harm * np.sin(2 * ph)
    return y * env_ad(n, att, tau, rel=min(0.02, dur / 4))


def thump(f0, f1, tau_f, tau, dur, att=0.008, drive=1.5):
    """Pitch-dropping sine thump with gentle saturation (for small speakers)."""
    n = ns(dur)
    t = tv(n)
    fr = f1 + (f0 - f1) * np.exp(-t / tau_f)
    y = np.sin(TWO_PI * np.cumsum(fr) / SR) * env_ad(n, att, tau, rel=0.05)
    return np.tanh(drive * y) / np.tanh(drive)


def noise_burst(dur, att, tau, lo, hi, seed, order=2):
    n = ns(dur)
    x = R(seed).standard_normal(n)
    if lo and hi:
        x = bp(x, lo, hi, order)
    elif hi:
        x = lp(x, hi, order)
    elif lo:
        x = hp(x, lo, order)
    return x * env_ad(n, att, tau, rel=min(0.02, dur / 4))


def pip_chirp(f_start, f_end, dur, bend=0.03, seed=0, fm=0.5, harm=0.12, tail=0.0, vib=0.0):
    """Pip's non-verbal voice: a pure, rounded FM blip with a quick upward pitch
    bend (whistle/toy-like -- no formants, so it never reads as a syllable)."""
    n = ns(dur)
    t = tv(n)
    fr = f_end + (f_start - f_end) * np.exp(-t / bend)
    if tail:
        fr *= 2.0 ** (tail * smoothstep((t - 0.6 * dur) / (0.4 * dur)))
    if vib:
        fr *= 1 + vib * np.sin(TWO_PI * 9.0 * t) * smoothstep(t / dur * 2)
    ph = TWO_PI * np.cumsum(fr) / SR
    mod = fm * np.exp(-t / 0.05) * np.sin(2.0 * ph)
    y = np.sin(ph + mod) + harm * np.sin(2.0 * ph + 0.5 * mod)
    a = ns(0.008)
    e = 1.0 - 0.4 * (t / dur)                      # rounded, slightly decaying body
    e[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    rel = ns(dur * 0.5)
    e[n - rel:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(rel) + 1) / rel)
    return lp(y * e, 7000, 2)


def sand_pat(seed, size=1.0):
    """Soft landing on sand: short filtered noise + granular trickle + tiny thump."""
    r = R(seed)
    n = ns(0.35)
    body = noise_burst(0.35, 0.003, 0.018 * size, 350, 4500, seed)
    # grains of sand settling
    imp = np.zeros(n)
    k = int(40 * size)
    idx = (ns(0.004) + (r.exponential(0.035, k) * SR)).astype(int)
    idx = idx[idx < n]
    imp[idx] = r.uniform(0.2, 1.0, len(idx)) * np.exp(-idx / SR / 0.06)
    grains = bp(imp, 2500, 9000, 2)
    th = thump(140, 80, 0.02, 0.035, 0.2, att=0.003, drive=1.2)
    th = np.pad(th, (0, n - len(th)))
    y = 0.8 * body + 0.9 * grains + 0.5 * size * th
    return fades(y, 0.001, 0.05)


def whoosh(dur, peak, f_lo, f_hi, seed, bw=0.8, curve=None):
    """Short air whoosh: band sweeps f_lo -> f_hi -> f_lo with swell peaking at `peak`."""
    def mag(F, T):
        x = T / dur
        pk = peak / dur
        env = np.where(x < pk, smoothstep(x / pk) ** 1.5, np.exp(-(x - pk) / (0.35 * (1 - pk))))
        fc = f_lo * (f_hi / f_lo) ** np.where(x < pk, x / pk, 1 - (x - pk) / (1 - pk) * 0.8)
        return env * glog(F, fc, bw)
    y = shaped_noise(0.0, dur, mag, seed, nper=1024)
    return fades(y, 0.005, 0.03)


def creak(dur, f_a, f_b, seed, body=None, rough=0.25, swell=True):
    """Stick-slip friction model: a jittery pulse train (rate f_a->f_b) exciting
    a small bank of damped wooden body modes."""
    r = R(seed)
    n = ns(dur)
    t = tv(n)
    fr = f_a * (f_b / f_a) ** (t / dur)
    fr *= 1 + rough * ctrl(t, 6.0, seed + 1, rate=200.0) * 0.5
    fr = np.maximum(fr, 5.0)
    ph = np.cumsum(fr) / SR
    idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    imp = np.zeros(n)
    imp[idx] = r.uniform(0.4, 1.0, len(idx))
    if body is None:
        body = np.array([190, 430, 760, 1250, 2100, 3300]) * r.uniform(0.85, 1.2)
    ir_n = ns(0.08)
    ti = tv(ir_n)
    ir = np.zeros(ir_n)
    for k, bf in enumerate(body):
        ir += (0.85 ** k) * np.exp(-ti / r.uniform(0.012, 0.035)) * np.sin(TWO_PI * bf * ti + r.uniform(0, 1))
    imp = lp(imp, 4500, 2)             # soften each slip so the train never 'clicks'
    y = signal.oaconvolve(imp, ir)[:n]
    if swell:
        y *= np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7
    y = hp(y, 90, 2)
    return fades(y, 0.01, 0.05)


def twig_snap(seed):
    """Crisp twig/branch snap: a few micro-fractures + short woody ring + low body."""
    r = R(seed)
    n = ns(0.25)
    y = np.zeros(n)
    tt = 0.0
    for k in range(r.integers(4, 7)):
        m = ns(r.uniform(0.0008, 0.003))
        c = r.standard_normal(m) * np.hanning(m) * r.uniform(0.5, 1.0) * (0.75 ** k)
        i = ns(tt)
        y[i:i + m] += c
        tt += r.uniform(0.002, 0.009)
    y = bp(y, 1200, 11000, 2) * 2.2
    ti = tv(n)
    ring = np.zeros(n)
    for bf in (1150, 1900, 2950, 4200):
        ring += np.exp(-ti / r.uniform(0.01, 0.025)) * np.sin(TWO_PI * bf * r.uniform(0.9, 1.1) * ti)
    y += 0.35 * ring * r.uniform(0.6, 1.0)
    th = thump(180, 110, 0.02, 0.03, 0.15, att=0.002)
    y[:len(th)] += 0.35 * th
    return fades(y, 0.0003, 0.05)


def heartbeat(strength, seed):
    """Soft low lub-dub (with gentle harmonics so it reads on small speakers)."""
    n = ns(0.9)
    y = np.zeros(n)
    lub = thump(64, 42, 0.05, 0.085, 0.5, att=0.012, drive=1.8)
    dub = thump(78, 50, 0.04, 0.065, 0.4, att=0.010, drive=1.8)
    y[:len(lub)] += lub
    i = ns(0.23)
    y[i:i + len(dub)] += 0.62 * dub
    nz = noise_burst(0.12, 0.008, 0.03, 0, 260, seed)
    y[:len(nz)] += 0.25 * nz
    return fades(y * strength, 0.001, 0.1)


# ----------------------------------------------------------------------------
# scene builders
# ----------------------------------------------------------------------------
def scene_night(m):
    """0-9.5 s: cold airy night + faint high 'space' shimmer + 12 star wink-outs."""
    m.offset = SCENE_TRIM["night"]
    def mag(F, T, ch):
        env = smoothstep(T / 2.2) * (1.0 - smoothstep((T - 8.9) / 1.2))
        mod = 0.75 + 0.25 * np.sin(TWO_PI * 0.09 * T + 1.3 * ch)
        return env * mod * (glog(F, 6000, 1.1) + 0.5 * glog(F, 300, 1.0) * lpf(F, 800, 2))
    air = shaped_noise_st(0.0, 10.2, mag, 101)
    m.add(air, 0.0, gain_db=-49, hall=0.2)

    # faint shimmer: very high, slowly breathing partials (D / A family)
    n = ns(10.2)
    t = tv(n)
    sh = np.zeros((2, n))
    env = smoothstep(t / 2.5) * (1 - smoothstep((t - 8.6) / 1.3))
    for k, f in enumerate([4698.6, 7040.0, 9397.3, 11839.8, 5587.7]):
        am = np.clip(0.5 + 0.5 * ctrl(t, 0.25, 110 + k), 0, 1) ** 2
        s = np.sin(TWO_PI * f * t + k) * am * env * (0.8 ** k)
        gl, gr = pan_gains(-0.7 + 0.35 * k)
        sh[0] += s * gl
        sh[1] += s * gr
    m.add(sh, 0.0, gain_db=-66, hall=0.5)

    r = R(120)
    times = [2.2, 2.9, 3.5, 4.0, 4.4, 4.8, 5.1, 5.4, 5.65, 5.9, 6.1, 6.3]
    for k, (tk, f) in enumerate(zip(times, D_MINOR_DESC)):
        pan = r.uniform(-0.75, 0.75)
        g = glass(f, 130 + k, decay=0.55, bright=0.9, tap=0.15, detune=0.0006)
        m.add(g, tk, pan=pan, gain_db=-35 + 0.25 * k, room=0.1, hall=0.45)


def scene_fall(m):
    """6.5-7.5 tremble, 7.5-8.9 falling star, 8.9 impact."""
    m.offset = SCENE_TRIM["fall"]
    # --- trembling shimmer on the last star (upper-left) ---
    t0, t1 = 6.45, 7.62
    n = ns(t1 - t0)
    t = tv(n)
    rate = 8.0 + 6.0 * (t / (t1 - t0))
    trem = 0.55 + 0.45 * np.sin(TWO_PI * np.cumsum(rate) / SR)
    vib = 1 + 0.004 * np.sin(TWO_PI * 5.5 * t)
    y = np.zeros(n)
    for rt, a in [(1.0, 1.0), (2.0, 0.4), (2.76, 0.3), (4.07, 0.15), (5.4, 0.08)]:
        y += a * np.sin(TWO_PI * np.cumsum(1174.66 * rt * vib * (1 + 0.0007 * rt)) / SR)
    env = smoothstep((t - 0.0) / 0.5) * (0.6 + 0.4 * t / (t1 - t0))
    env *= 1 - smoothstep((t - (t1 - t0 - 0.12)) / 0.12)
    y = fades(y * trem * env, 0.01, 0.02)
    m.add(y, t0, pan=-0.4, gain_db=-36, room=0.1, hall=0.5)

    # --- detach tick ---
    m.add(glass(2349.32, 201, decay=0.4, tap=0.3), 7.5, pan=-0.5, gain_db=-34, hall=0.4)

    # --- falling: rising shimmer + doppler whoosh, panned left -> right ---
    fs, fe = 7.5, 8.9
    n = ns(fe - fs + 0.02)
    t = tv(n)
    x = np.clip(t / (fe - fs), 0, 1)
    pan_path = -0.55 + 0.95 * x ** 1.4
    base = 1174.66 * 2.0 ** (1.1 * x ** 1.3)
    y = np.zeros(n)
    for k, (rt, a) in enumerate([(1.0, 1.0), (2.0, 0.5), (2.76, 0.35), (4.07, 0.2), (5.4, 0.12)]):
        y += a * np.sin(TWO_PI * np.cumsum(base * rt * (1 + 0.003 * np.sin(TWO_PI * 19 * t + k))) / SR)
    trem = 0.75 + 0.25 * np.sin(TWO_PI * 17 * t)
    env = (0.25 + 0.75 * x ** 1.5) * (1 - smoothstep((t - (fe - fs - 0.04)) / 0.04))
    y = fades(y * trem * env, 0.02, 0.005)
    m.add(y, fs, pan=pan_path, gain_db=-34, room=0.1, hall=0.45)

    def wmag(F, T):
        x = np.clip((T - fs) / (fe - fs), 0, 1)
        # doppler-ish: band climbs while approaching, drops after passing (~x=0.65)
        fc = np.where(x < 0.65, 900 * (3800 / 900) ** (x / 0.65),
                      3800 * (1300 / 3800) ** ((x - 0.65) / 0.35))
        env = (0.1 + 0.9 * smoothstep(x / 0.7)) * (1 - 0.35 * smoothstep((x - 0.8) / 0.2))
        env *= 1 - smoothstep((T - fe + 0.01) / 0.03)
        return env * glog(F, fc, 0.9)
    wh = shaped_noise(fs - 0.05, fe + 0.05, wmag, 210, nper=1024)
    n = len(wh)
    pan_w = -0.6 + 1.05 * np.clip((tv(n) - 0.05) / (fe - fs), 0, 1) ** 1.4
    m.add(fades(wh, 0.02, 0.02), fs - 0.05, pan=pan_w, gain_db=-17, room=0.15, hall=0.2)

    # sparkle crackles trailing the star
    r = R(220)
    for k in range(95):
        u = r.uniform(0, 1) ** 0.7
        tk = fs + 0.05 + u * (fe - fs + 0.35)
        lag = r.uniform(0.05, 0.25)
        xp = np.clip((tk - lag - fs) / (fe - fs), 0, 1)
        pan = -0.55 + 0.95 * xp ** 1.4 + r.uniform(-0.12, 0.12)
        fade = 1.0 if tk < fe else np.exp(-(tk - fe) / 0.12)
        if r.uniform() < 0.6:
            s = ping(r.uniform(3000, 10000), r.uniform(0.006, 0.03), att=0.0008, seed=k)
        else:
            s = noise_burst(0.01, 0.0003, 0.0015, 3500, 14000, 230 + k)
        m.add(s, tk, pan=pan, gain_db=-40 + 10 * np.log10(fade + 1e-3) * 0.5 + r.uniform(-6, 0),
              hall=0.3)

    # --- impact 8.9 (behind a dune, lower-right) ---
    ti = 8.9
    th = thump(78, 36, 0.10, 0.42, 1.8, att=0.014, drive=1.6)
    body = noise_burst(1.2, 0.012, 0.22, 0, 170, 240, order=2)
    m.add(th + 0.6 * np.pad(body, (0, len(th) - len(body))), ti, pan=0.3, gain_db=-12,
          room=0.35, anchor=0.014)
    m.add(crystal_bell(587.33, 241, decay=2.6, ripple=1.2), ti, pan=0.35, gain_db=-29, room=0.1,
          hall=0.7, anchor=0.001)
    m.add(glass(1760.0, 242, decay=1.2, bright=0.8), ti + 0.01, pan=0.4, gain_db=-33, hall=0.7)

    # sand spray hiss (granular, decaying)
    def smag(F, T, ch):
        x = T - ti
        env = smoothstep(x / 0.03) * np.exp(-np.maximum(x - 0.03, 0) / 0.38)
        return env * hpf(F, 2200, 2) * lpf(F, 11000, 1)
    spray = shaped_noise_st(ti - 0.05, ti + 1.9, smag, 243, nper=512)
    gm = 0.55 + 0.45 * np.clip(ctrl(tv(spray.shape[1]), 25.0, 244, rate=400.0), -1, 1)
    m.add(fades(spray * gm, 0.01, 0.1), ti - 0.05, pan=0.35, gain_db=-24, room=0.3)


def global_wind(m):
    """Desert wind (9-37 s), storm (20-30.6 s) with a door-slam cut-off,
    and the lush evening breeze (39-60 s) -- one continuous STFT-shaped layer."""
    m.offset = SCENE_TRIM["wind"]
    def curves(T, ch):
        gs = ctrl(T, 0.33, 900)
        gi = ctrl(T, 0.9, 901 + ch)
        gf = ctrl(T, 2.5, 905 + ch)
        g = np.clip(0.48 + 0.3 * gs + 0.3 * gi + 0.12 * gf, 0.0, 1.0)
        g = np.maximum(g, 0.95 * smoothstep((T - 29.1) / 0.8))      # final peak gust into 30.0
        amb = smoothstep((T - 8.95) / 1.6)
        amb = np.where(T < 30.0, amb, 0.32 * smoothstep((T - 31.3) / 2.5))
        amb = amb * (1.0 - smoothstep((T - 37.0) / 2.5))
        s = np.zeros_like(T)
        s = np.where((T >= 20.0) & (T < 22.0), 0.42 * np.clip((T - 20.0) / 2.0, 0, 1) ** 1.8, s)
        s = np.where(T >= 22.0, 0.42 + 0.38 * smoothstep((T - 21.98) / 0.2)
                     + 0.2 * smoothstep((T - 22.3) / 7.6) + 0.2 * smoothstep((T - 29.2) / 0.75), s)
        lush = smoothstep((T - 39.0) / 6.0) * (1.0 - smoothstep((T - 58.0) / 1.9))
        return g, gs, amb, s, lush

    def mag(F, T, ch):
        g, gs, amb, s, lush = curves(T, ch)
        # ambient desert wind
        fca = 430.0 * 2.0 ** (0.3 * gs)
        amb_m = 2.2 * amb * (0.05 * (0.45 + 0.9 * g) * glog(F, fca, 1.2)
                             + 0.012 * (0.3 + g ** 2) * hpf(F, 3000, 2) * lpf(F, 11000, 1))
        # storm
        fcs = 240.0 + 850.0 * s * g
        body = s * (0.3 + 0.7 * g) * glog(F, fcs, 1.1 + 0.3 * s)
        low = s ** 1.2 * (0.3 + 0.7 * g) * lpf(F, 110, 2) * hpf(F, 26, 2) * 1.3
        hiss = s * (0.05 + 0.4 * g ** 2) * hpf(F, 2600, 2) * lpf(F, 12000, 1)
        fw = 360.0 * (1.0 + 1.1 * g)
        whistle = 0.32 * s ** 1.5 * g ** 2.5 * (glog(F, fw, 0.05) + 0.45 * glog(F, fw * 1.49, 0.04))
        storm = body + low + hiss + whistle
        # door-slam cut-off 30.0 -> 30.6 : fast fall + closing low-pass
        x = np.clip((T - 30.0) / 0.6, 0.0, 1.0)
        fcut = 140.0 + 9000.0 * (1.0 - x) ** 2.5
        cut = np.where(T < 30.0, 1.0, (1.0 - x) ** 3 * lpf(F, fcut, 2))
        storm = storm * cut
        # lush breeze (warm, gentle) + leaf rustle
        lf = ctrl(T, 3.0, 950 + ch)
        lush_m = 6.0 * lush * (0.024 * (0.5 + 0.8 * g) * glog(F, 650, 1.1) * lpf(F, 2500, 2)
                               + 0.008 * np.clip(0.4 + 0.5 * lf, 0, 1.5) * glog(F, 4500, 0.7))
        return amb_m + lush_m, storm

    w = shaped_noise_st(0.0, 60.0, lambda F, T, ch: mag(F, T, ch)[0], 910)
    m.add(w, 0.0, gain_db=-6, room=0.15)
    ws = shaped_noise_st(19.0, 31.0, lambda F, T, ch: mag(F, T, ch)[1], 930)
    m.add(fades(ws, 0.05, 0.05), 19.0, gain_db=-6, room=0.15, group="storm")

    # sand grit (granular ticks) driven by the same curves, sample-rate
    t = tv(N)
    for ch in range(2):
        r = R(960 + ch)
        g, gs, amb, s, lush = curves(t, ch)
        x = np.clip((t - 30.0) / 0.6, 0, 1)
        cutg = np.where(t < 30.0, 1.0, (1.0 - x) ** 4)
        for grp, rate, lvl in (("main", 150.0 * amb, 0.09 * amb),
                               ("storm", s * (900.0 + 5000.0 * g ** 2), s * (0.25 + 0.75 * g) * cutg)):
            hit = r.uniform(size=N) < rate / SR
            amp = r.exponential(1.0, N) * hit * lvl
            mono = np.zeros((2, N))
            mono[ch] = bp(amp, 2500, 10000, 2)
            m.add(mono, 0.0, gain_db=-17, room=0.1, group=grp)


def scene_desert(m):
    """Pip's entrance, hops, the chime, surprise & happy bounces, star glow."""
    m.offset = SCENE_TRIM["desert"]
    # 10.95: sand shuffle as Pip pops up behind the rock
    m.add(noise_burst(0.2, 0.02, 0.05, 800, 6000, 300), 10.92, pan=-0.25, gain_db=-40, room=0.3)
    # 11.0 'boop'
    m.add(pip_chirp(430, 760, 0.2, bend=0.035, seed=1, fm=0.7, harm=0.1, vib=0.01),
          11.0, pan=-0.25, gain_db=-22, room=0.25, hall=0.08, anchor=0.01)

    # 4 hops: take-off scuff + little whoosh, then soft sand pat on landing
    lands = [12.0, 12.8, 13.6, 14.4]
    pans = [-0.3, -0.2, -0.1, 0.0]
    prev_pan = -0.33
    for k, (tl, p) in enumerate(zip(lands, pans)):
        to = tl - 0.42
        m.add(noise_burst(0.12, 0.004, 0.02, 1500, 7000, 310 + k), to, pan=prev_pan, gain_db=-42, room=0.25)
        wh = whoosh(0.4, 0.22, 700, 2600, 320 + k, bw=0.7)
        n = len(wh)
        m.add(wh, to + 0.01, pan=np.linspace(prev_pan, p, n), gain_db=-35, room=0.2)
        m.add(sand_pat(330 + k, size=1.0), tl, pan=p, gain_db=-27, room=0.3, anchor=0.003)
        prev_pan = p

    # 15.5 poke -> the star CHIMES on D6 with a shimmering ripple
    m.add(glass(3520, 340, decay=0.08, tap=0.8, bright=0.5), 15.49, pan=0.05, gain_db=-36, room=0.2)
    bell = crystal_bell(1174.66, 341, decay=2.3, ripple=1.6, bright=1.05)
    m.add(bell, 15.5, pan=0.05, gain_db=-23, room=0.15, hall=0.65, anchor=0.001)
    r = R(342)
    for k in range(18):   # light ripple: sparkles spiralling out/up from the star
        tk = 15.55 + k * 0.045 + r.uniform(0, 0.02)
        f = D_MAJ_PENT[k % 5] * 4 * (1 + (k // 5) * 1.0)
        f = min(f, 9000)
        m.add(ping(f, 0.09, att=0.004, glide=0.1, seed=k), tk, pan=0.05 + 0.5 * np.sin(k * 1.3) * k / 18,
              gain_db=-45 + 0.2 * k * 0 - (k / 18) * 4, hall=0.6)

    # 15.7 surprised squeak + scuffle jump back
    m.add(pip_chirp(950, 2050, 0.13, bend=0.018, seed=2, fm=0.35, harm=0.08, tail=0.15),
          15.7, pan=-0.05, gain_db=-22, room=0.25, hall=0.08, anchor=0.008)
    m.add(noise_burst(0.1, 0.003, 0.02, 900, 7000, 350), 15.73, pan=-0.05, gain_db=-36, room=0.2)
    m.add(noise_burst(0.1, 0.003, 0.015, 900, 7000, 351), 15.80, pan=-0.1, gain_db=-39, room=0.2)
    m.add(whoosh(0.3, 0.14, 800, 2800, 352), 15.74, pan=np.linspace(-0.05, -0.18, ns(0.3)),
          gain_db=-35, room=0.2)
    m.add(sand_pat(353, size=0.8), 16.05, pan=-0.18, gain_db=-29, room=0.3, anchor=0.003)

    # happy bounces 16.5, 17.0
    m.add(pip_chirp(640, 1000, 0.13, bend=0.025, seed=3, fm=0.5), 16.5, pan=-0.15, gain_db=-24,
          room=0.25, hall=0.08, anchor=0.008)
    m.add(sand_pat(360, size=0.55), 16.5, pan=-0.15, gain_db=-34, room=0.3, anchor=0.003)
    m.add(pip_chirp(720, 1180, 0.14, bend=0.022, seed=4, fm=0.5, tail=0.1), 17.0, pan=-0.12,
          gain_db=-24, room=0.25, hall=0.08, anchor=0.008)
    m.add(sand_pat(361, size=0.55), 17.0, pan=-0.12, gain_db=-34, room=0.3, anchor=0.003)


def scene_glow_and_storm(m):
    """17.5-30: warm hum of the star (flickering in the storm), storm hit,
    lightning/thunder, star crackles, 30.0 slam."""
    m.offset = SCENE_TRIM["storm"]
    m.group = "storm"
    # --- star hum / glow ---
    t0, t1 = 17.4, 30.7
    n = ns(t1 - t0)
    t = tv(n)
    T = t + t0
    a = smoothstep((T - 17.5) / 0.9)
    a *= np.where(T < 20.0, 1.0, 1.0 - 0.25 * smoothstep((T - 20.0) / 2.0))
    gust = np.clip(0.48 + 0.3 * ctrl(T, 0.33, 900) + 0.3 * ctrl(T, 0.9, 901), 0, 1)
    flick = np.clip(0.55 + 0.6 * ctrl(T, 9.0, 402, rate=200.0), 0.05, 1.0)
    storm_on = smoothstep((T - 21.8) / 0.4)
    a *= 1.0 - storm_on * (1.0 - flick * (1.0 - 0.55 * gust))
    a *= 1.0 - 0.8 * smoothstep((T - 27.0) / 3.0)          # dying
    a *= 1.0 - smoothstep((T - 30.0) / 0.35)
    breath = 0.8 + 0.2 * np.sin(TWO_PI * 0.75 * t)
    y = np.zeros(n)
    for f, amp in [(146.83, 0.45), (293.66, 1.0), (440.0, 0.45), (587.33, 0.22), (880.0, 0.08)]:
        for d in (-0.35, 0.35):
            y += 0.5 * amp * np.sin(TWO_PI * (f + d) * t + f)
    y = fades(y * a * breath, 0.05, 0.05)
    m.add(y, t0, pan=0.0, gain_db=-26, room=0.2, hall=0.3)

    # --- 20.0 first sand streamers (light whoosh) and 22.0 storm wall hit ---
    m.add(whoosh(2.2, 1.3, 300, 1600, 405, bw=1.0), 20.0, pan=np.linspace(-0.6, 0.3, ns(2.2)),
          gain_db=-21, room=0.2)

    def hitmag(F, T, ch):
        x = T - 22.0
        env = np.where(x < 0, smoothstep((x + 0.5) / 0.5) ** 3, np.exp(-x / 0.9))
        return env * (glog(F, 700, 1.4) + 0.6 * hpf(F, 3000, 2) * lpf(F, 12000, 1)
                      + 0.8 * lpf(F, 90, 2) * hpf(F, 25, 2))
    hit = shaped_noise_st(21.5, 25.0, hitmag, 410)
    m.add(fades(hit, 0.02, 0.2), 21.5, gain_db=-7, room=0.25)
    m.add(thump(55, 34, 0.1, 0.35, 1.2, att=0.02), 22.0, gain_db=-13, room=0.2, anchor=0.02)

    # --- lightning / thunder ---
    def thunder(seed, size, pan):
        r = R(seed)
        dur = 2.6 + 1.3 * size
        n = ns(dur)
        tt = tv(n)
        out = np.zeros((2, n))
        # multi-fracture crack (tearing)
        tk = 0.0
        for k in range(int(5 + 5 * size)):
            L = ns(0.12)
            b = R(seed + 100 + k).standard_normal(L)
            b = bp(b, 250, 9500, 2) * env_ad(L, 0.0006, r.uniform(0.006, 0.03), rel=0.01)
            amp = r.uniform(0.5, 1.0) * (0.8 ** k) * (1.0 if k else 1.4)
            gl, gr = pan_gains(np.clip(pan + r.uniform(-0.25, 0.25), -1, 1))
            i = ns(tk)
            if i + L < n:
                out[0, i:i + L] += amp * gl * b
                out[1, i:i + L] += amp * gr * b
            tk += r.uniform(0.004, 0.03)
        # crackle tail
        rate = 3000.0 * np.exp(-tt / (0.12 * size))
        for ch in range(2):
            rr = R(seed + 50 + ch)
            imp = (rr.uniform(size=n) < rate / SR) * rr.exponential(1.0, n) * np.exp(-tt / 0.25)
            out[ch] += 0.8 * bp(imp, 900, 7000, 2)
        # initial boom + rolling rumble
        for ch in range(2):
            rr = R(seed + 60 + ch)
            w = rr.standard_normal(n)
            brown = np.cumsum(w)
            brown = hp(brown, 20, 2)
            brown /= np.max(np.abs(brown)) + 1e-9
            rum = lp(brown, 200, 2) * 4.0
            midr = bp(w, 80, 700, 2) * 0.25
            rolls = np.zeros(n)
            for j in range(int(5 + 3 * size)):
                c = rr.uniform(0.05, dur * 0.7)
                wdt = rr.uniform(0.12, 0.45)
                rolls += rr.uniform(0.4, 1.0) * np.exp(-0.5 * ((tt - c) / wdt) ** 2)
            renv = (0.6 * np.exp(-tt / 0.25) + rolls * 0.7) * np.exp(-tt / (0.9 * size))
            renv *= smoothstep(tt / 0.03)
            out[ch] += (rum + midr) * renv * 1.3
        # gentle saturation: tames the crack's crest factor like air/mic overload
        c = 0.6 * np.max(np.abs(out))
        out = np.tanh(out / c) * c
        return fades(out, 0.0005, 0.3)

    th1 = thunder(420, 1.0, -0.3)
    m.add(th1, 24.6, pan=-0.15, gain_db=-9, room=0.35, hall=0.35)
    th2 = thunder(440, 1.6, 0.25)
    # thunder #2 is cut by the storm passing at 30.0
    n2 = th2.shape[1]
    T2 = 27.9 + tv(n2)
    x = np.clip((T2 - 30.0) / 0.6, 0, 1)
    th2 = th2 * np.where(T2 < 30.0, 1.0, (1.0 - x) ** 4)
    th2 = fades(th2, 0.0005, 0.01)
    m.add(th2, 27.9, pan=0.1, gain_db=-6.5, room=0.35, hall=0.35)

    # --- star crackle-flicker: clusters of tiny glassy/electric crackles ---
    r = R(450)
    tk = 22.1
    while tk < 29.9:
        g = float(np.clip(0.48 + 0.3 * ctrl(tk, 0.33, 900) + 0.3 * ctrl(tk, 0.9, 901), 0, 1))
        dens = 2.0 + 5.0 * g
        for j in range(r.integers(3, 8)):
            tj = tk + r.uniform(0, 0.12)
            if r.uniform() < 0.55:
                s = ping(r.uniform(1800, 6000), r.uniform(0.005, 0.025), att=0.0006, seed=int(tj * 1000))
            else:
                s = noise_burst(0.012, 0.0003, 0.002, 1800, 9000, int(tj * 1000))
            m.add(s, tj, pan=r.uniform(-0.15, 0.15), gain_db=-24 + r.uniform(-8, 0), room=0.1)
        tk += r.exponential(1.0 / dens)

    # --- 30.0 the storm slams shut: soft low pressure 'whumpf' ---
    m.add(thump(52, 34, 0.05, 0.1, 0.45, att=0.01), 30.02, gain_db=-21, room=0.2, anchor=0.01,
          group="main")
    m.group = "main"


def scene_silence_breath(m):
    """30.6-36.8: dust trickle, fading heartbeats, inhale, blow, motes, swell."""
    m.offset = SCENE_TRIM["silence"]
    r = R(500)
    # settling dust trickle: sparse tiny grains, thinning out
    for k in range(70):
        tk = 30.35 + r.exponential(0.9)
        if tk > 34.0:
            continue
        g = -44 - 8 * (tk - 30.4) / 3.0 + r.uniform(-6, 0)
        s = noise_burst(0.02, 0.0005, r.uniform(0.001, 0.004), 2500, 11000, 510 + k)
        m.add(s, tk, pan=r.uniform(-0.8, 0.8), gain_db=g, room=0.3)
    # very faint air
    def amag(F, T):
        return smoothstep((T - 30.3) / 1.0) * (1 - smoothstep((T - 36.2) / 0.6)) * glog(F, 1800, 1.4)
    air = shaped_noise(30.2, 37.0, amag, 520)
    m.add(air, 30.2, gain_db=-60, room=0.3)

    # heartbeats (weakening)
    m.add(heartbeat(1.0, 530), 31.0, gain_db=-17, room=0.2, anchor=0.012)
    m.add(heartbeat(0.55, 531), 32.1, gain_db=-17, room=0.2, anchor=0.012)

    # 33.0-34.0 big INHALE: breathy noise, rising (small-creature) formant
    def imag(F, T):
        x = (T - 33.0) / 1.0
        env = smoothstep(x / 0.8) ** 1.3 * (1.0 - smoothstep((x - 0.88) / 0.12))
        fc = 1100.0 * 2.0 ** (1.25 * np.clip(x, 0, 1))
        return env * (glog(F, fc, 0.45) + 0.35 * glog(F, fc * 2.4, 0.45)
                      + 0.12 * hpf(F, 4500, 2) * lpf(F, 11000, 1))
    inh = shaped_noise(32.95, 34.05, imag, 540)
    turb = 1 + 0.15 * ctrl(tv(len(inh)), 14.0, 541, rate=200.0)
    m.add(fades(inh * turb, 0.02, 0.03), 32.95, pan=-0.1, gain_db=-16, room=0.3, hall=0.05)

    # 34.2-35.0 gentle BLOW
    def bmag(F, T):
        x = (T - 34.2) / 0.8
        env = smoothstep(x / 0.12) * (1.0 - smoothstep((x - 0.6) / 0.4))
        return env * (glog(F, 1000, 0.9) + 0.45 * hpf(F, 2500, 2) * lpf(F, 7000, 2))
    bl = shaped_noise(34.15, 35.05, bmag, 550)
    turb = 1 + 0.25 * ctrl(tv(len(bl)), 18.0, 551, rate=300.0)
    m.add(fades(bl * turb, 0.02, 0.03), 34.15, pan=np.linspace(-0.1, 0.0, len(bl)),
          gain_db=-19, room=0.3, hall=0.05)
    m.add(noise_burst(0.2, 0.02, 0.05, 150, 700, 552), 34.2, pan=-0.05, gain_db=-34, room=0.2)

    # glowing motes carried by the breath
    for k in range(16):
        tk = 34.32 + k * 0.07 + r.uniform(0, 0.05)
        f = D_MAJ_PENT[r.integers(0, 5)] * 8 * r.choice([1.0, 1.5])
        m.add(ping(min(f, 11000), 0.12, att=0.012, seed=560 + k), tk,
              pan=-0.1 + 0.25 * k / 16 + r.uniform(-0.25, 0.25), gain_db=-45 + r.uniform(-4, 0),
              hall=0.6)

    # heartbeats from the ember: weak 35.3, stronger 36.0
    m.add(heartbeat(0.7, 570), 35.3, gain_db=-17, room=0.2, anchor=0.012)
    m.add(heartbeat(1.25, 571), 36.0, gain_db=-16, room=0.2, anchor=0.012)

    # reverse swell 35.0 -> 36.8 (reversed glassy/cymbal bloom) cut exactly at 36.8
    L = ns(1.8)
    t = tv(L)
    rr = R(580)
    cym = hp(rr.standard_normal(L), 3500, 2) * np.exp(-t / 0.45)
    metal = np.zeros(L)
    for k in range(18):   # inharmonic metallic partials
        f = 2000 * 2 ** rr.uniform(0, 2.5)
        metal += np.sin(TWO_PI * f * t + rr.uniform(0, 6)) * np.exp(-t / rr.uniform(0.2, 0.7)) / 6
    gl = np.zeros(L)
    for f in (1174.66, 1760.0, 2349.32, 2959.96, 3520.0):
        gl += np.sin(TWO_PI * f * t) * np.exp(-t / 0.6) * 0.25
    fwd = 0.7 * cym + 0.5 * metal + gl
    fwd = np.vstack([fwd, np.roll(fwd, 37) * 0.9 + 0.1 * fwd])
    # smear with a short bright reverb before reversing
    ir = make_ir(1.2, (1.0, 1.1, 0.9), 0.01, [], 581)
    wet = np.vstack([signal.oaconvolve(fwd[c], ir[c])[:L] for c in range(2)])
    sw = 0.5 * fwd + 1.2 * wet
    sw = sw[:, ::-1]
    sw *= smoothstep(t / 1.1)[None, :] ** 1.5
    sw /= np.max(np.abs(sw))
    sw = fades(sw, 0.05, 0.003)
    m.add(sw, 36.8 - 1.8, gain_db=-14, room=0.05)


def scene_ignition(m):
    """36.8 ignition boom + shockwave + glitter, 37-38.5 sinking & roots."""
    m.offset = SCENE_TRIM["ignition"]
    ti = 36.8
    # sub drop / boom
    sub = thump(95, 33, 0.3, 0.9, 3.2, att=0.006, drive=2.2)
    boom = noise_burst(2.5, 0.004, 0.35, 0, 160, 600, order=2)
    boom = np.pad(boom, (0, len(sub) - len(boom)))
    m.add(sub + 0.8 * boom, ti, gain_db=-4.5, room=0.3, hall=0.2, anchor=0.006)

    # bright shockwave whoosh sweeping outward with stereo widening
    def smag(F, T, ch):
        x = T - ti
        env = np.where(x < 0, smoothstep((x + 0.06) / 0.06), np.exp(-x / 0.55))
        fc = 7000.0 * (900.0 / 7000.0) ** np.clip(x / 1.8, 0, 1)
        return env * (glog(F, fc, 1.0) + 0.25 * hpf(F, 6000, 2) * lpf(F, 13000, 2)
                      * np.exp(-np.maximum(x, 0) / 0.15))
    t0 = ti - 0.08
    wide = shaped_noise_st(t0, ti + 3.0, smag, 610)
    mid = shaped_noise(t0, ti + 3.0, lambda F, T: smag(F, T, 0), 615)
    n = wide.shape[1]
    w = smoothstep((tv(n) - 0.08) / 0.7)[None, :]
    sw = (1 - w) * np.vstack([mid, mid]) + w * wide * 1.15
    m.add(fades(sw, 0.01, 0.2), t0, gain_db=-8, room=0.2, hall=0.4)

    # glitter burst: many sparkles, spreading wider as the ring expands
    r = R(620)
    for k in range(420):
        dt = r.exponential(0.55)
        if dt > 3.2:
            continue
        spread = 0.15 + 0.85 * smoothstep(dt / 1.0)
        f = r.uniform(2500, 11500)
        s = ping(f, r.uniform(0.01, 0.07), att=0.001, glide=r.uniform(-0.2, 0.3), seed=k)
        m.add(s, ti + 0.005 + dt, pan=r.uniform(-spread, spread),
              gain_db=-30 - 6 * dt + r.uniform(-8, 0), hall=0.45)

    # 37.0-38.5 star sinks into the sand + glowing roots spreading underground
    m.add(noise_burst(1.3, 0.25, 0.45, 150, 1800, 630), 37.0, gain_db=-30, room=0.3)

    def rmag(F, T, ch):
        x = (T - 37.0) / 1.5
        env = smoothstep(x / 0.3) * (1 - smoothstep((x - 0.8) / 0.4))
        return env * (lpf(F, 140, 2) * hpf(F, 28, 2) * 1.5 + 0.2 * glog(F, 300, 0.8))
    rum = shaped_noise_st(36.9, 39.2, rmag, 640)
    am = 0.7 + 0.3 * np.sin(TWO_PI * 3.3 * tv(rum.shape[1]))
    m.add(fades(rum * am, 0.02, 0.1), 36.9, gain_db=-16, room=0.2)
    for k in range(80):
        dt = r.uniform(0, 1.6)
        tk = 37.0 + dt
        spread = 0.1 + 0.8 * dt / 1.6
        side = r.choice([-1, 1])
        pan = side * r.uniform(0.2, 1.0) * spread
        if r.uniform() < 0.6:
            s = lp(ping(r.uniform(900, 3500), r.uniform(0.02, 0.1), att=0.003, seed=700 + k), 4000)
        else:
            s = noise_burst(0.02, 0.0005, 0.003, 700, 4000, 700 + k)
        m.add(s, tk, pan=pan, gain_db=-36 + r.uniform(-6, 0), room=0.3, hall=0.2)


def scene_growth(m):
    """38.5-46 tree growth: creaks, stretches, rising magic, branch splits,
    flower pops; fireflies & insects until the end."""
    m.offset = SCENE_TRIM["growth"]
    r = R(800)
    # trunk rising: long low stretch + a few creaks rising in tension
    m.add(noise_burst(0.8, 0.05, 0.25, 100, 1400, 801), 38.5, gain_db=-30, room=0.3)
    m.add(thump(90, 55, 0.05, 0.12, 0.5, att=0.01), 38.52, gain_db=-22, room=0.3, anchor=0.01)
    m.add(creak(1.6, 18, 42, 802, body=np.array([120, 260, 470, 820, 1300]), rough=0.3),
          38.55, pan=0.0, gain_db=-22, room=0.35)
    k = 0
    tk = 39.0
    while tk < 45.6:
        x = (tk - 38.5) / 7.5
        dur = r.uniform(0.35, 1.2)
        fa = r.uniform(25, 45) * (1 + x)
        fb = fa * r.uniform(1.2, 2.2) if r.uniform() < 0.7 else fa * r.uniform(0.6, 0.9)
        m.add(creak(dur, fa, fb, 810 + k, rough=0.3), tk,
              pan=r.uniform(-0.35 - 0.3 * x, 0.35 + 0.3 * x), gain_db=-27 + r.uniform(-5, 0) - 3 * x,
              room=0.35, hall=0.05)
        tk += r.uniform(0.35, 0.8)
        k += 1

    # rising magical shimmer (noise riser + pentatonic grains)
    def smag(F, T, ch):
        x = np.clip((T - 38.5) / 7.5, 0, 1)
        env = smoothstep((T - 38.5) / 1.0) * (1 - smoothstep((T - 46.0) / 1.5))
        am = 0.7 + 0.3 * np.sin(TWO_PI * (4.0 + 3 * x) * T + ch)
        fc = 1500.0 * 2.0 ** (2.3 * x)
        return env * am * glog(F, fc, 0.6)
    riser = shaped_noise_st(38.4, 47.6, smag, 830)
    m.add(riser, 38.4, gain_db=-34, hall=0.5)
    tk = 38.6
    while tk < 46.0:
        x = (tk - 38.5) / 7.5
        oct_ = 2 ** r.integers(1, 3 + int(1.5 * x))
        f = D_MAJ_PENT[r.integers(0, 5)] * oct_
        f = min(f, 10000)
        m.add(ping(f, r.uniform(0.06, 0.2), att=0.004, glide=0.08, seed=840 + int(tk * 100)), tk,
              pan=r.uniform(-0.3 - 0.5 * x, 0.3 + 0.5 * x), gain_db=-40 + r.uniform(-6, 0) + 3 * x,
              hall=0.55)
        tk += r.exponential(1.0 / (10 + 22 * x))

    # branch-split accents: crisp twig snap + ascending chime
    for k, (tb, p, f) in enumerate(zip([39.5, 40.5, 41.5, 42.5], [-0.35, 0.35, -0.55, 0.55],
                                       [1174.66, 1479.98, 1760.0, 2349.32])):
        m.add(twig_snap(850 + k), tb, pan=p, gain_db=-19, room=0.35, anchor=0.0005)
        m.add(creak(0.25, 60, 110, 855 + k, rough=0.4), tb + 0.01, pan=p, gain_db=-28, room=0.3)
        m.add(glass(f, 860 + k, decay=1.1, bright=0.85, tap=0.1), tb + 0.005, pan=p * 0.8,
              gain_db=-27, room=0.1, hall=0.6)

    # flowers bloom 43.0-46.0: sparkly pops spreading wider in stereo
    for k in range(120):
        u = r.uniform(0, 1) ** 0.85
        tk = 43.0 + 3.0 * u
        spread = 0.25 + 0.75 * u
        f0 = r.uniform(500, 1400)
        pop = ping(f0, 0.018, att=0.0015, glide=1.3, dur=0.06, seed=900 + k)
        sp = ping(r.uniform(4000, 10000), r.uniform(0.03, 0.1), att=0.002, seed=950 + k)
        y = np.zeros(max(len(pop), len(sp) + ns(0.008)))
        y[:len(pop)] += pop
        y[ns(0.008):ns(0.008) + len(sp)] += 0.45 * sp
        m.add(y, tk, pan=r.uniform(-spread, spread), gain_db=-33 + r.uniform(-6, 0), room=0.15, hall=0.4)

    # fireflies: faint high twinkles 43.5-59
    tk = 43.5
    while tk < 59.0:
        f = r.uniform(5500, 10000)
        m.add(ping(f, r.uniform(0.08, 0.2), att=0.015, vib=0.004, seed=int(tk * 97)), tk,
              pan=r.uniform(-0.9, 0.9), gain_db=-51 + r.uniform(-5, 0), hall=0.5)
        tk += r.exponential(0.45)

    # night insects shimmer (pulsed high tones, not bird-song): 44.5-60
    n = ns(60.0 - 44.0)
    t = tv(n)
    T = t + 44.0
    env = smoothstep((T - 44.5) / 3.0) * (1 - smoothstep((T - 57.8) / 2.0))
    ins = np.zeros((2, n))
    for v, (fc, pan, rate, per) in enumerate([(4300, -0.7, 34, 0.55), (4800, 0.6, 29, 0.71),
                                             (5200, -0.25, 38, 0.47), (3900, 0.85, 31, 0.9),
                                             (4550, 0.2, 36, 0.63)]):
        rr = R(980 + v)
        pulse = np.maximum(0, np.sin(np.pi * rate * t)) ** 6                      # syllable pulses
        chirp = (np.mod(t + rr.uniform(0, per), per) < 4.0 / rate).astype(float)  # 4 pulses/chirp
        chirp = uniform_filter1d(chirp, ns(0.01))
        slow = np.clip(0.6 + 0.5 * ctrl(T, 0.15, 990 + v), 0, 1)
        s = np.sin(TWO_PI * fc * t * (1 + 0.002 * np.sin(TWO_PI * 0.2 * t))) * pulse * chirp * slow * env
        gl, gr = pan_gains(pan)
        ins[0] += s * gl
        ins[1] += s * gr
    m.add(fades(ins, 0.05, 0.05), 44.0, gain_db=-40, room=0.3, hall=0.2)


def scene_finale(m):
    """50.0 warm wind lifting petals, 50-56 rising sparkles, 52-56 new stars,
    56.8/57.4 gold star twinkles, 57.6 Pip bounce."""
    m.offset = SCENE_TRIM["finale"]
    r = R(1100)

    def wmag(F, T, ch):
        x = T - 50.0
        env = np.where(x < 0.45, smoothstep((x + 0.5) / 0.95), np.exp(-(x - 0.45) / 1.3))
        fc = np.where(x < 0.5, 350 * (1700 / 350) ** np.clip((x + 0.5) / 1.0, 0, 1),
                      1700 * (800 / 1700) ** np.clip((x - 0.5) / 3.0, 0, 1))
        return env * glog(F, fc, 1.0) * lpf(F, 6000, 2)
    ww = shaped_noise_st(49.5, 54.5, wmag, 1110)
    n = ww.shape[1]
    m.add(fades(ww, 0.05, 0.3), 49.5, pan=np.linspace(-0.3, 0.3, n), gain_db=-18, room=0.2, hall=0.15)

    # petals lifting: soft flutter micro-rustles
    for k in range(140):
        tk = 50.05 + r.exponential(1.0)
        if tk > 54.0:
            continue
        s = noise_burst(0.03, 0.003, r.uniform(0.004, 0.012), 1500, 6500, 1120 + k)
        m.add(s, tk, pan=r.uniform(-0.8, 0.8), gain_db=-46 + r.uniform(-6, 0), room=0.2)

    # rising sparkles (pitch-gliding up, pitch centre rising), densest near 53
    tk = 50.0
    while tk < 56.0:
        x = (tk - 50.0) / 6.0
        dens = 6 + 30 * np.exp(-0.5 * ((tk - 53.0) / 1.4) ** 2)
        f = 1400 * 2 ** (2.0 * x + r.uniform(-0.4, 0.4))
        m.add(ping(min(f, 11000), r.uniform(0.08, 0.2), att=0.006, glide=0.5, seed=int(tk * 331)), tk,
              pan=r.uniform(-0.85, 0.85), gain_db=-40 + r.uniform(-6, 0), hall=0.55)
        tk += r.exponential(1.0 / dens)

    # 52-56 new stars appearing: soft twinkle cascade (pentatonic glass)
    tk = 52.0
    while tk < 56.0:
        dens = 4 + 14 * np.exp(-0.5 * ((tk - 53.5) / 1.1) ** 2)
        f = D_MAJ_PENT[r.integers(0, 5)] * 2 ** r.integers(1, 4)
        m.add(glass(f, int(tk * 1000), decay=0.6, bright=0.8, tap=0.08, detune=0.001), tk,
              pan=r.uniform(-0.9, 0.9), gain_db=-38 + r.uniform(-5, 0), hall=0.7)
        tk += r.exponential(1.0 / dens)

    # the gold star answers Pip: two soft bell twinkles
    m.add(crystal_bell(1760.0, 1150, decay=1.6, ripple=1.4, bright=0.9), 56.8, pan=0.2,
          gain_db=-27, hall=0.7, anchor=0.001)
    m.add(crystal_bell(2349.32, 1151, decay=1.5, ripple=1.4, bright=0.9), 57.4, pan=0.2,
          gain_db=-28, hall=0.7, anchor=0.001)
    # 57.6 Pip happy bounce (on grass now: soft rustle instead of sand)
    m.add(pip_chirp(660, 1120, 0.16, bend=0.025, seed=5, fm=0.5, tail=0.12, vib=0.01), 57.6,
          pan=-0.1, gain_db=-27, room=0.25, hall=0.1, anchor=0.008)
    m.add(noise_burst(0.12, 0.004, 0.02, 600, 5000, 1160), 57.6, pan=-0.1, gain_db=-40, room=0.3)


# ----------------------------------------------------------------------------
# loudness / peak utilities (ITU-R BS.1770-4)
# ----------------------------------------------------------------------------
def k_weight(x):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=-1), axis=-1)


def integrated_lufs(x):
    y = k_weight(x)
    blk, hop = ns(0.4), ns(0.1)
    p = np.sum(y ** 2, axis=0)
    c = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, y.shape[1] - blk + 1, hop)
    z = (c[starts + blk] - c[starts]) / blk
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z1 = z[lk > -70]
    if len(z1) == 0:
        return -np.inf
    rel = -0.691 + 10 * np.log10(np.mean(z1)) - 10
    z2 = z[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(np.mean(z2))


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return max(np.max(np.abs(up)), np.max(np.abs(x)))


def limiter(x, ceiling_db, look=0.004):
    ceil = dbl(ceiling_db)
    up = signal.resample_poly(x, 4, 1, axis=-1)
    pk = np.max(np.abs(up), axis=0)[: x.shape[1] * 4].reshape(-1, 4).max(axis=1)
    pk = np.maximum(pk, np.max(np.abs(x), axis=0))
    req = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    L = ns(look)
    g = minimum_filter1d(req, size=2 * L + 1, mode="nearest")
    g = uniform_filter1d(g, size=L + 1, mode="nearest")
    # slower release smoothing on top (never raises gain above g)
    L2 = ns(0.03)
    g2 = uniform_filter1d(minimum_filter1d(req, size=2 * L2 + 1, mode="nearest"), L2 + 1, mode="nearest")
    g = np.minimum(g, 0.5 * (g + g2))   # both bounds are <= req, so is their mean
    limiter.gain = g
    return x * g[None, :], float(np.min(g))


# ----------------------------------------------------------------------------
def render():
    m = Mix()
    scene_night(m)
    scene_fall(m)
    global_wind(m)
    scene_desert(m)
    scene_glow_and_storm(m)
    scene_silence_breath(m)
    scene_ignition(m)
    scene_growth(m)
    scene_finale(m)

    ir_room = make_ir(1.6, (0.9, 0.75, 0.45), 0.004,
                      [(0.006, 0.8), (0.021, 0.35), (0.047, 0.3), (0.083, 0.22), (0.121, 0.18),
                       (0.17, 0.12), (0.23, 0.08)], 7001, build=0.02)
    ir_hall = make_ir(5.0, (3.2, 3.6, 2.4), 0.028,
                      [(0.031, 0.25), (0.057, 0.2), (0.089, 0.15)], 7002, build=0.05)
    t = tv(N)
    stems = {}
    for grp, b in m.b.items():
        stems[grp] = (b["dry"] + dbl(-9) * convolve_bus(b["room"], ir_room)
                      + dbl(-7) * convolve_bus(b["hall"], ir_hall))
    # the storm passes: its whole stem (tails included) slams shut 30.0 -> 30.6
    x = np.clip((t - 30.0) / 0.6, 0.0, 1.0)
    stems["storm"] *= np.where(t < 30.0, 1.0, (1.0 - x) ** 3)[None, :]
    mix = stems["main"] + stems["storm"]

    # clean up: DC / sub-sonic removal
    mix = signal.sosfiltfilt(signal.butter(2, 18, "highpass", fs=SR, output="sos"), mix, axis=-1)
    mix -= mix.mean(axis=1, keepdims=True)

    # final fade (ambience out 58.0 -> 60.0, digital silence at the end)
    fade = 1.0 - smoothstep((t - 58.2) / 1.7)
    fade[t >= 59.9] = 0.0
    mix *= fade[None, :]
    mix[:, :2] = 0.0

    # loudness normalise + true-peak limit (iterate so both targets hold)
    gain = TARGET_LUFS - integrated_lufs(mix)
    for _ in range(8):
        lim, gmin = limiter(mix * dbl(gain), CEILING_DBTP)
        cur = integrated_lufs(lim)
        if abs(cur - TARGET_LUFS) < 0.02:
            break
        gain += TARGET_LUFS - cur
    out = lim
    tp = true_peak(out)
    if tp > dbl(CEILING_DBTP):
        out *= dbl(CEILING_DBTP) / tp
    out[:, t >= 59.9] = 0.0
    out = out.astype(np.float32)
    assert out.shape == (2, N)
    assert np.all(np.isfinite(out))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wavfile.write(OUT, SR, out.T.copy())

    o64 = out.astype(np.float64)
    print(f"wrote {OUT}")
    print(f"  samples          : {out.shape[1]} ({out.shape[1] / SR:.3f} s) @ {SR} Hz, 2ch float32")
    print(f"  integrated       : {integrated_lufs(o64):.2f} LUFS")
    print(f"  sample peak      : {20 * np.log10(np.max(np.abs(o64))):.2f} dBFS")
    print(f"  true peak (4x)   : {20 * np.log10(true_peak(o64)):.2f} dBTP")
    print(f"  limiter max GR   : {-20 * np.log10(gmin):.2f} dB   (norm gain {gain:+.2f} dB)")
    gr = -20 * np.log10(limiter.gain)
    busy = [f"{k / 2:.1f}s:{gr[ns(k / 2):ns(k / 2 + 0.5)].max():.1f}" for k in range(120)
            if gr[ns(k / 2):ns(k / 2 + 0.5)].max() > 0.5]
    print(f"  limiting (>0.5dB): {' '.join(busy) if busy else 'none'}")
    print(f"  max |dx|         : {np.max(np.abs(np.diff(o64, axis=1))):.4f}")
    print(f"  DC offset        : {o64.mean(axis=1)}")
    return out


if __name__ == "__main__":
    render()
