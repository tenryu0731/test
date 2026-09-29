#!/usr/bin/env python3
"""
LUMEN -- procedural sound-effects / ambience stem (no music).

Run from the repo root:   python3 lumen/audio/sfx.py
Output:                   lumen/audio/stems/sfx.wav
                          48 kHz, stereo, float32, exactly 2,880,000 samples, peak < -1 dBFS

Everything is synthesised: spectrally shaped noise (STFT masks for time-varying
filters), Poisson impulse trains convolved with drop kernels (rain), modal
synthesis (bells, chimes, metal clinks), FM/sine sweeps (birdsong), granular
sparkle clouds and two synthetic stereo convolution reverbs (outdoor "air" and a
large "hall").  All randomness uses fixed seeds, so the render is deterministic.

Cue sheet: lumen/story/storyboard.md
"""
import os
import time

import numpy as np
from scipy import signal
from scipy.interpolate import CubicSpline

try:
    import soundfile as sf
except ImportError:  # pragma: no cover
    sf = None
    from scipy.io import wavfile

SR = 48_000
N = 2_880_000                       # exactly 60.000 s
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "stems", "sfx.wav")
PEAK_DB = -1.5                      # final safety ceiling (spec: below -1 dBFS)
TWO_PI = 2.0 * np.pi

D_PENT6 = np.array([1174.66, 1318.51, 1479.98, 1760.00, 1975.53])     # D6 E6 F#6 A6 B6
D_TRIAD = np.array([1174.66, 1479.98, 1760.00])                       # D6 F#6 A6


# --------------------------------------------------------------------------- helpers
def R(seed):
    return np.random.default_rng(seed)


def db(d):
    return 10.0 ** (d / 20.0)


def S(t):
    return int(round(t * SR))


def tv(n):
    return np.arange(n) / SR


def _sos(kind, f, order):
    return signal.butter(order, f, kind, fs=SR, output="sos")


def lp(x, f, o=2):
    return signal.sosfilt(_sos("lowpass", min(f, SR * 0.45), o), x)


def hp(x, f, o=2):
    return signal.sosfilt(_sos("highpass", f, o), x)


def bp(x, lo, hi, o=2):
    return signal.sosfilt(_sos("bandpass", [lo, min(hi, SR * 0.45)], o), x)


def norm_peak(x, d):
    p = np.max(np.abs(x))
    return x * (db(d) / p) if p > 0 else x


def norm_rms(x, d):
    r = np.sqrt(np.mean(x ** 2))
    return x * (db(d) / r) if r > 0 else x


def envp(t, pts):
    ts, vs = zip(*pts)
    return np.interp(t, ts, vs)


def ad(n, att, tau):
    t = tv(n)
    a = np.clip(t / max(att, 1e-5), 0, 1)
    return np.sin(0.5 * np.pi * a) ** 2 * np.exp(-np.maximum(t - att, 0) / tau)


def edge_fade(x, fin=0.002, fout=0.01):
    x = x.copy()
    n = x.shape[-1]
    a, b = min(S(fin), n // 2), min(S(fout), n // 2)
    if a:
        x[..., :a] *= np.linspace(0, 1, a)
    if b:
        x[..., -b:] *= np.linspace(1, 0, b)
    return x


def colored(n, rng, alpha=1.0):
    """Noise with power spectrum ~ 1/f^alpha, unit std."""
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X *= f ** (-alpha / 2.0)
    x = np.fft.irfft(X, n)
    return x / np.std(x)


def smooth_rand(n, rate, rng):
    """Smooth random control signal (unit-ish std) with ~rate Hz bandwidth."""
    k = int(n / SR * rate) + 4
    xs = np.arange(k) / rate
    return CubicSpline(xs, rng.standard_normal(k))(tv(n))


def poisson_times(rate, t0, t1, rng):
    cnt = rng.poisson(rate * (t1 - t0))
    return np.sort(rng.uniform(t0, t1, cnt))


# ---- STFT time-varying filtering -----------------------------------------
NPS, NOV = 2048, 1536


def spectral(x, maskfn):
    """Apply a time-varying magnitude mask M(f, t) (t in s from signal start)."""
    f, t, Z = signal.stft(x, fs=SR, nperseg=NPS, noverlap=NOV)
    M = maskfn(f[:, None], t[None, :])
    _, y = signal.istft(Z * M, fs=SR, nperseg=NPS, noverlap=NOV)
    n = x.shape[-1]
    if y.shape[-1] < n:
        y = np.pad(y, [(0, 0)] * (y.ndim - 1) + [(0, n - y.shape[-1])])
    return y[..., :n]


def m_lp(f, fc, o=4):
    return 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * o))


def m_hp(f, fc, o=4):
    return 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1.0)) ** (2 * o))


def m_band(f, fc, sig_oct):
    return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / sig_oct) ** 2)


# ---- mixer ---------------------------------------------------------------
class Mix:
    def __init__(self):
        self.dry = np.zeros((2, N))
        self.air = np.zeros((2, N))     # outdoor / near reverb send
        self.hall = np.zeros((2, N))    # large, long reverb send

    def add(self, sig, t, pan=0.0, gain=1.0, dry=1.0, air=0.0, hall=0.0):
        sig = np.asarray(sig, dtype=float)
        if sig.ndim == 1:
            th = (np.clip(pan, -1, 1) + 1.0) * np.pi / 4.0
            st = np.vstack([sig * np.cos(th), sig * np.sin(th)]) * np.sqrt(2.0)
        else:
            p = float(np.clip(pan, -1, 1))
            st = sig * np.array([[min(1.0, 1.0 - p)], [min(1.0, 1.0 + p)]])
        i0 = S(t)
        a, b = max(i0, 0), min(i0 + st.shape[1], N)
        if b <= a:
            return
        seg = st[:, a - i0:b - i0] * gain
        for bus, g in ((self.dry, dry), (self.air, air), (self.hall, hall)):
            if g:
                bus[:, a:b] += g * seg


def make_ir(dur, rts, predelay, seed, n_er=12):
    """Stereo synthetic IR: 4-band exponentially decaying noise + early reflections."""
    rng = R(seed)
    n = S(dur)
    t = tv(n)
    bands = [("lowpass", 250), ("bandpass", [250, 1000]), ("bandpass", [1000, 4000]),
             ("highpass", 4000)]
    irs = []
    for ch in range(2):
        x = rng.standard_normal(n)
        out = np.zeros(n)
        for (kind, f), rt in zip(bands, rts):
            out += signal.sosfilt(_sos(kind, f, 2), x) * np.exp(-6.91 * t / rt)
        out *= 1.0 - np.exp(-t / 0.025)
        out = lp(out, 11000)
        out /= np.sqrt(np.sum(out ** 2))
        er = np.zeros(n)
        for _ in range(n_er):
            tk = rng.uniform(0.006, 0.09)
            er[S(tk)] += rng.choice([-1, 1]) * 0.35 * np.exp(-tk / 0.05)
        out += lp(er, 6000)
        irs.append(np.concatenate([np.zeros(S(predelay)), out]))
    return irs


def reverb(bus, irs, cross=0.35):
    L = signal.oaconvolve(bus[0] + cross * bus[1], irs[0])[:N]
    Rr = signal.oaconvolve(bus[1] + cross * bus[0], irs[1])[:N]
    return np.vstack([L, Rr])


# ---- building blocks -----------------------------------------------------
def sine_sweep(f, n):
    return np.sin(TWO_PI * np.cumsum(f) / SR)


def modal(freqs, amps, decays, dur, att=0.002, seed=0, detune=0.0):
    rng = R(seed)
    n = S(dur)
    t = tv(n)
    y = np.zeros(n)
    for f, a, d in zip(freqs, amps, decays):
        if f > SR * 0.45:
            continue
        ph = rng.uniform(0, TWO_PI)
        y += a * np.sin(TWO_PI * f * t + ph) * np.exp(-t / d)
        if detune:
            f2 = f + rng.uniform(0.3, 1.0) * detune * rng.choice([-1, 1])
            y += 0.6 * a * np.sin(TWO_PI * f2 * t + ph + 1.0) * np.exp(-t / (d * 0.9))
    a = np.clip(t / att, 0, 1)
    return y * np.sin(0.5 * np.pi * a) ** 2


def burst(dur, att, tau, lo, hi, rng, o=2):
    n = S(dur)
    return edge_fade(bp(rng.standard_normal(n), lo, hi, o) * ad(n, att, tau), 0, 0.005)


def grain_cloud(times, freqs, durs, amps, pans, total, t0, rng, glide=None):
    """Stereo buffer (from t0, length total s) of sine grains."""
    buf = np.zeros((2, S(total)))
    for i, (tg, f, d, a, p) in enumerate(zip(times, freqs, durs, amps, pans)):
        n = S(d)
        t = tv(n)
        if glide is not None:
            fc = f * (1 + glide[i] * t / d)
            x = np.sin(TWO_PI * np.cumsum(fc) / SR + rng.uniform(0, TWO_PI))
        else:
            x = np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI))
        x += 0.25 * np.sin(TWO_PI * 2.003 * f * t) if f < 5000 else 0.0
        x *= ad(n, min(0.004, d / 4), d / 3.5) * a
        i0 = S(tg - t0)
        if i0 < 0 or i0 + n > buf.shape[1]:
            continue
        th = (np.clip(p, -1, 1) + 1) * np.pi / 4
        buf[0, i0:i0 + n] += x * np.cos(th)
        buf[1, i0:i0 + n] += x * np.sin(th)
    return buf


def shockwave(dur, f_hi, f_lo, tau_f, tau, seed, widen=1.0):
    """Broadband air blast: log-band noise whose centre falls f_hi -> f_lo, widening in stereo."""
    rng = R(seed)
    n = S(dur)
    base = colored(n, rng, 0.6)
    sides = np.vstack([colored(n, rng, 0.6), colored(n, rng, 0.6)])

    def mask(f, t):
        fc = f_lo * (f_hi / f_lo) ** np.exp(-t / tau_f)
        return m_band(f, fc, 1.3) + 0.25 * m_lp(f, 180, 2)

    base = spectral(base, mask)
    sides = spectral(sides, mask)
    t = tv(n)
    w = np.clip(0.1 + widen * t / 0.8, 0, 1)
    st = np.sqrt(1 - w) * base + np.sqrt(w) * sides
    e = ad(n, 0.006, tau) * 0.7 + ad(n, 0.02, tau * 3) * 0.3
    return edge_fade(st * e, 0.0005, 0.05)


def sub_boom(dur, f0, f1, tau_f, tau, seed, drive=1.6):
    rng = R(seed)
    n = S(dur)
    t = tv(n)
    f = f1 + (f0 - f1) * np.exp(-t / tau_f)
    x = sine_sweep(f, n) * ad(n, 0.004, tau)
    th = lp(rng.standard_normal(n), 140, 4) * ad(n, 0.002, 0.12)
    x = x + 0.6 * th / np.max(np.abs(th))
    x = np.tanh(drive * x) / np.tanh(drive)
    return edge_fade(x, 0.0005, 0.05)


# --------------------------------------------------------------------------- scenes
def creation(m):
    """3.2 cosmic boom + shockwave + shimmer tail 3.2-6.5."""
    t0 = 3.2
    m.add(norm_peak(sub_boom(4.5, 70, 27, 0.35, 1.4, 11), -6.5), t0, 0, dry=1, air=0.05, hall=0.06)
    sw = norm_peak(shockwave(3.5, 9000, 250, 0.45, 0.55, 12), -11)
    m.add(sw, t0, 0, dry=1, hall=0.35)

    rng = R(13)
    k = 750
    times = t0 + 0.02 + rng.exponential(1.0, k * 3)
    times = np.sort(times[times < 6.4][:k])
    pool = np.concatenate([D_TRIAD, D_TRIAD * 2, D_TRIAD * 4])
    freqs = rng.choice(pool, len(times)) * 2 ** (rng.uniform(-8, 8, len(times)) / 1200)
    durs = rng.uniform(0.04, 0.25, len(times))
    amps = rng.uniform(0.25, 1, len(times)) * np.exp(-(times - t0) / 1.6) / np.sqrt(freqs / 1500)
    spread = np.clip(0.12 + (times - t0) / 1.8, 0, 1)
    pans = rng.choice([-1, 1], len(times)) * rng.uniform(0.3, 1, len(times)) * spread
    cloud = grain_cloud(times, freqs, durs, amps, pans, 4.0, t0, rng)
    # airy noise tail under the grains
    n = cloud.shape[1]
    air = np.vstack([hp(rng.standard_normal(n), 5500, 4), hp(rng.standard_normal(n), 5500, 4)])
    air = lp(air, 14000) * ad(n, 0.05, 1.2)
    cloud = norm_peak(cloud, -17) + norm_rms(air, -44)
    m.add(edge_fade(cloud, 0, 0.3), t0, 0, dry=0.6, hall=0.9)


def dive(m):
    """7.0-9.0 descending whoosh through clouds."""
    rng = R(21)
    t0, dur = 6.8, 2.8
    n = S(dur)
    x = np.vstack([colored(n, rng, 1.0), colored(n, rng, 1.0)])

    def mask(f, t):
        u = np.clip((t - 0.2) / 2.0, 0, 1)
        fc = 4500 * (160 / 4500) ** u
        return m_band(f, fc, 1.2) + 0.35 * m_lp(f, 140, 3)

    x = spectral(x, mask)
    e = envp(tv(n), [(0, 0), (0.2, 0.05), (1.2, 0.5), (1.9, 1.0), (2.3, 0.45), (2.8, 0)]) ** 1.5
    m.add(norm_peak(x * e, -10), t0, 0, dry=1, air=0.15)


def wind_storm(m):
    """7.0-38.0 wind bed with slow gusts; swell 15.2-16.5 and 36.5; cut at 38.0."""
    t0, t1 = 7.0, 38.0
    n = S(t1 - t0)
    rng = R(31)
    g_common = smooth_rand(n, 0.35, rng)
    lvl_pts = [(7.0, 0), (8.5, 0.55), (9.2, 0.8), (15.2, 0.8), (15.85, 2.1), (16.5, 1.0),
               (17.5, 0.75), (19.0, 0.6), (19.6, 0.3), (21.5, 0.3), (23.0, 0.55),
               (30.0, 0.55), (35.8, 0.65), (36.7, 1.5), (37.3, 1.1), (38.0, 1.2)]
    swell_pts = [(7, 0), (15.2, 0), (15.85, 1), (16.5, 0), (36.0, 0), (36.8, 0.8), (38, 0.5)]
    out = []
    for ch in range(2):
        g = np.tanh(0.8 * g_common + 0.5 * smooth_rand(n, 0.5, rng))
        g = 0.5 + 0.5 * g
        noise = colored(n, rng, 1.2)
        tf = np.arange(0, n / SR + 0.1, 0.01)
        gf = np.interp(tf, tv(n)[::480], g[::480])

        def mask(f, t, gf=gf, tf=tf):
            gg = np.interp(t, tf, gf)
            sw = envp(t + t0, swell_pts)
            lv = envp(t + t0, lvl_pts) * (0.45 + 0.55 * gg)
            fc = 230 + 650 * gg + 500 * sw
            return lv * (m_band(f, fc, 1.1) + 0.35 * m_band(f, fc * 1.7, 0.12)
                         + 0.5 * m_lp(f, 160, 3))

        out.append(spectral(noise, mask))
    w = np.vstack(out)
    cut = np.ones(n)
    cut[S(38.0 - t0) - S(0.03):] = np.linspace(1, 0, S(0.03))
    w = norm_rms(w * cut, -35)
    m.add(w, t0, 0, dry=1, air=0.12)


def rain(m):
    """8.0-38.0 rain: hiss layer, patter layer, wash, puddle drips; muffled during prayer."""
    t0, t1 = 7.9, 38.0
    dur = t1 - t0
    n = S(dur)
    rng = R(41)
    layers = []
    for ch in range(2):
        # dense fine drops
        dense = np.zeros(n)
        kernels = []
        for lo, hi, tau in ((2000, 9000, 0.002), (1200, 5000, 0.003), (3500, 13000, 0.0015)):
            k = S(0.012)
            kernels.append(bp(rng.standard_normal(k), lo, hi, 2) * np.exp(-tv(k) / tau))
        for kern in kernels:
            imp = np.zeros(n)
            idx = rng.integers(0, n, int(1300 * dur))
            np.add.at(imp, idx, np.minimum(rng.pareto(2.5, len(idx)), 3.0) + 0.2)
            dense += signal.oaconvolve(imp, kern)[:n]
        # heavier patter on ground/leaves
        pat = np.zeros(n)
        for lo, hi, tau in ((500, 2500, 0.008), (800, 3500, 0.006)):
            k = S(0.04)
            kern = bp(rng.standard_normal(k), lo, hi, 2) * np.exp(-tv(k) / tau)
            imp = np.zeros(n)
            idx = rng.integers(0, n, int(120 * dur))
            np.add.at(imp, idx, np.minimum(rng.pareto(2.0, len(idx)), 3.5) + 0.3)
            pat += signal.oaconvolve(imp, kern)[:n]
        wash = bp(colored(n, rng, 1.0), 180, 2500, 2)
        layers.append(norm_rms(dense, 0) + 0.55 * norm_rms(pat, 0) + 0.4 * norm_rms(wash, 0))
    rain_st = np.vstack(layers)

    # puddle drips / plinks (Minnaert-like rising bubble chirps) + tiny splashes
    drips = np.zeros((2, n))
    for tg in poisson_times(7.0, 0.1, dur - 0.2, rng):
        p = rng.uniform(-0.9, 0.9)
        a = rng.uniform(0.2, 1.0) ** 2
        k = S(0.06)
        t = tv(k)
        x = 0.6 * bp(rng.standard_normal(k), 1500, 9000) * np.exp(-t / 0.006)
        if rng.random() < 0.45:
            f0 = rng.uniform(900, 2600)
            f = f0 * (1 + 0.35 * (1 - np.exp(-t / 0.012)))
            x += sine_sweep(f, k) * np.exp(-t / rng.uniform(0.008, 0.02)) * (np.clip(t / 0.001, 0, 1))
        i0 = S(tg)
        th = (p + 1) * np.pi / 4
        drips[0, i0:i0 + k] += a * x * np.cos(th)
        drips[1, i0:i0 + k] += a * x * np.sin(th)
    rain_st = rain_st + 1.4 * norm_rms(drips, 0) * 0.35

    lvl = [(7.9, 0), (8.0, 0), (9.6, 1.0), (19.0, 1.0), (19.4, 0.42), (21.5, 0.42),
           (23.0, 0.85), (30.0, 0.85), (31.2, 0.6), (35.8, 0.6), (38.0, 1.15)]
    fcp = [(7.9, 18000), (19.0, 18000), (19.5, 800), (21.5, 800), (23.0, 16000), (38, 16000)]

    def mask(f, t):
        tt = t + t0
        fc = np.exp(envp(tt, [(a, np.log(b)) for a, b in fcp]))
        return envp(tt, lvl) * m_lp(f, fc, 3) * m_hp(f, 150, 2)

    rain_st = spectral(rain_st, mask)
    rain_st[:, -S(0.025):] *= np.linspace(1, 0, S(0.025))
    rain_st = norm_rms(rain_st, -33)
    m.add(rain_st, t0, 0, dry=1, air=0.15)


def mud_step(rng):
    n = S(0.45)
    t = tv(n)
    heel = lp(rng.standard_normal(n), 230, 4) * ad(n, 0.002, 0.03)
    heel = heel / np.max(np.abs(heel)) + 0.5 * np.sin(TWO_PI * 65 * t) * ad(n, 0.003, 0.04)
    sq = np.zeros(n)
    o = S(0.025)
    k = n - o
    am = np.maximum(smooth_rand(k, 60, rng), 0) ** 1.5
    sq[o:] = bp(rng.standard_normal(k), 350, 1800, 2) * am * ad(k, 0.02, 0.06)
    for _ in range(rng.integers(2, 4)):
        s = S(rng.uniform(0.03, 0.15))
        kk = S(0.06)
        tt = tv(kk)
        f = rng.uniform(280, 420) * (1 + 1.2 * tt / 0.06)
        sq[s:s + kk] += 0.35 * sine_sweep(f, kk) * ad(kk, 0.003, 0.018)
    toe = np.zeros(n)
    s = S(rng.uniform(0.085, 0.12))
    toe[s:] = 0.45 * heel[:n - s]
    spl = 0.25 * hp(rng.standard_normal(n), 2500) * ad(n, 0.001, 0.012)
    x = heel + 0.9 * sq / (np.max(np.abs(sq)) + 1e-9) + toe + spl
    return edge_fade(x, 0.0005, 0.03)


def stone_step(rng):
    n = S(0.3)
    t = tv(n)
    click = bp(rng.standard_normal(n), 900, 5500, 2) * ad(n, 0.0005, 0.006)
    body = lp(rng.standard_normal(n), 320, 4) * ad(n, 0.001, 0.02)
    body /= np.max(np.abs(body))
    grit = np.zeros(n)
    idx = rng.integers(0, S(0.06), 25)
    grit[idx] = rng.uniform(-1, 1, 25)
    grit = hp(grit, 3000) * 0.5
    x = click / np.max(np.abs(click)) + 0.8 * body + grit
    s = S(rng.uniform(0.06, 0.09))
    x[s:] += 0.45 * x[:n - s].copy()
    x += 0.2 * hp(rng.standard_normal(n), 2500) * ad(n, 0.001, 0.015)
    return edge_fade(x, 0.0002, 0.03)


def creak(rng, dur):
    n = S(dur)
    t = tv(n)
    f0 = rng.uniform(1300, 2100)
    f = f0 * (1 + 0.06 * smooth_rand(n, 8, rng) + 0.08 * np.sin(np.pi * t / dur))
    osc = np.tanh(2.5 * sine_sweep(f, n))
    r = rng.uniform(25, 45)
    gate = (0.5 + 0.5 * np.sin(TWO_PI * r * t + 2 * smooth_rand(n, 10, rng))) ** 6
    x = bp(osc * gate, 900, 7000) * np.sin(np.pi * t / dur) ** 2
    return x


def walker_pan1(t):
    return -0.65 + 1.3 * np.clip((t - 9.0) / 8.0, 0, 1)


def footsteps(m):
    rng = R(51)
    # walk 1 on mud: 9.3 .. 17.0 every 0.55 s
    times = np.arange(9.3, 17.0 + 1e-6, 0.55)
    for i, tt in enumerate(times):
        x = norm_peak(mud_step(rng), -17 + rng.uniform(-1.5, 1.5))
        m.add(x, tt + rng.uniform(-0.01, 0.01), walker_pan1(tt), dry=1, air=0.12)
        if i % 3 == 1 or rng.random() < 0.2:
            c = norm_peak(creak(rng, rng.uniform(0.14, 0.3)), -33 + rng.uniform(-3, 2))
            m.add(c, tt + rng.uniform(0.1, 0.22), walker_pan1(tt) + 0.05, dry=1, air=0.2)
    # walk 2 toward the hill: 30.0 .. 35.8 every 0.6 s, mud -> stone
    times = np.arange(30.0, 35.8 + 1e-6, 0.6)
    for i, tt in enumerate(times):
        pan = 0.15 - 0.2 * (tt - 30.0) / 6.0
        stone = (tt - 30.0) / 5.4          # blend towards stone
        if stone < 0.55:
            x = norm_peak(mud_step(rng), -17 + rng.uniform(-1.5, 1.5))
        else:
            x = norm_peak(stone_step(rng), -18 + rng.uniform(-1.5, 1.5))
        m.add(x, tt + rng.uniform(-0.01, 0.01), pan, dry=1, air=0.14)
        if i % 4 == 2:
            c = norm_peak(creak(rng, rng.uniform(0.14, 0.26)), -34)
            m.add(c, tt + 0.15, pan + 0.05, dry=1, air=0.2)


def rumble(dur, fc, rate, env_pts, rng, crack_fc=None):
    n = S(dur)
    x = np.vstack([colored(n, rng, 1.8), colored(n, rng, 1.8)])
    if crack_fc is None:
        x = lp(x, fc, 4)
    else:
        def mask(f, t):
            c = fc + (crack_fc - fc) * np.exp(-t / 0.7)
            return m_lp(f, c, 3)
        x = spectral(x, mask)
    roll = np.maximum(smooth_rand(n, rate, rng) + 0.4, 0.05) ** 1.6
    roll2 = np.maximum(smooth_rand(n, rate * 0.5, rng) + 0.6, 0.1)
    e = envp(tv(n), env_pts) * roll * roll2
    return edge_fade(x * e, 0.005, 0.2)


def crack(rng):
    n = S(0.8)
    t = tv(n)
    imp = np.zeros(n)
    k = 90
    ts = np.minimum(rng.exponential(0.07, k), 0.6)
    np.add.at(imp, (ts * SR).astype(int), rng.choice([-1, 1], k) * np.exp(-ts / 0.15) * rng.uniform(0.3, 1, k))
    ker = hp(rng.standard_normal(S(0.004)), 400) * np.exp(-tv(S(0.004)) / 0.001)
    x = signal.oaconvolve(imp, ker)[:n]
    x = x / np.max(np.abs(x))
    x += 0.8 * bp(rng.standard_normal(n), 250, 7000) * ad(n, 0.0008, 0.09)
    x += 0.6 * lp(rng.standard_normal(n), 200, 4) * ad(n, 0.002, 0.2) * 6
    return edge_fade(x, 0.0002, 0.1)


def thunder(m):
    rng = R(61)
    # 11.5 distant rumble
    r = rumble(6.5, 230, 2.5, [(0, 0), (0.6, 0.8), (1.4, 1.0), (2.5, 0.7), (3.6, 0.45), (6.5, 0)], rng)
    m.add(norm_peak(r, -14), 11.5, -0.35, dry=0.8, air=0.35, hall=0.15)
    # 14.5 close crack + roll
    c = norm_peak(crack(rng), -5.0)
    m.add(c, 14.5, 0.15, dry=1, air=0.3, hall=0.1)
    r = rumble(8.0, 260, 3.0, [(0, 0), (0.05, 1.0), (0.6, 0.85), (1.6, 0.9), (3.0, 0.5), (5.0, 0.25), (8.0, 0)],
               rng, crack_fc=1600)
    m.add(norm_peak(r, -8.5), 14.52, 0.15, dry=1, air=0.3, hall=0.15)
    m.add(norm_peak(sub_boom(3.0, 55, 30, 0.3, 0.8, 62), -11), 14.5, 0.1, dry=1, air=0.1)
    # 36.5 thunder roll (vortex), swallowed by the 38.0 cut
    r = rumble(1.62, 420, 3.5, [(0, 0), (0.4, 0.8), (1.0, 1.0), (1.5, 1.1), (1.62, 1.1)], rng)
    r[:, -S(0.03):] *= np.linspace(1, 0, S(0.03))
    m.add(norm_peak(r, -10), 36.38, 0.0, dry=1, air=0.35, hall=0.15)


def flame_sputter(m):
    rng = R(71)
    n = S(0.6)
    t = tv(n)
    fl = lp(rng.standard_normal(n), 700) + 0.7 * bp(rng.standard_normal(n), 90, 350)
    gate = np.clip(smooth_rand(n, 22, rng) * 1.5 + 0.2, 0, 1) ** 2
    e = envp(t, [(0, 0.8), (0.1, 1.0), (0.25, 0.7), (0.38, 0.4), (0.42, 0.0), (0.6, 0)])
    x = fl * gate * e
    x = x / np.max(np.abs(x))
    for tp in rng.uniform(0.02, 0.36, 6):
        k = S(0.02)
        s = S(tp)
        x[s:s + k] += rng.uniform(0.4, 0.9) * bp(rng.standard_normal(k), 1500, 6500) * ad(k, 0.0003, 0.003) * 3
    # final puff as it dies
    k = S(0.2)
    s = S(0.37)
    x[s:s + k] += 0.9 * bp(rng.standard_normal(k), 150, 900) * ad(k, 0.012, 0.06)
    m.add(norm_peak(edge_fade(x, 0.01, 0.05), -21), 16.98, 0.62, dry=1, air=0.15)


def knee_mud(m):
    rng = R(81)
    n = S(0.6)
    t = tv(n)
    th = np.sin(TWO_PI * 52 * t) * ad(n, 0.004, 0.09) + lp(rng.standard_normal(n), 180, 4) * ad(n, 0.003, 0.06) * 8
    st = mud_step(rng)
    x = norm_peak(th, 0) + 0.6 * norm_peak(np.pad(st, (0, n - len(st))), 0)
    cl = bp(rng.standard_normal(n), 1200, 6000) * np.maximum(smooth_rand(n, 40, rng), 0) * ad(n, 0.03, 0.12)
    x += 0.2 * norm_peak(cl, 0)
    m.add(norm_peak(x, -13), 17.99, 0.5, dry=1, air=0.15)


def cloth(rng, dur, peak_t):
    n = S(dur)
    x = bp(rng.standard_normal(n), 1200, 7000) + 0.5 * bp(rng.standard_normal(n), 300, 1200)
    mod = np.zeros(n)
    for tg in rng.normal(peak_t, dur / 4, 45):
        k = S(rng.uniform(0.02, 0.09))
        s = S(np.clip(tg, 0, dur - 0.1))
        mod[s:s + k] += rng.uniform(0.2, 1) * np.hanning(k)
    return edge_fade(x * lp(mod, 60), 0.01, 0.05)


def prayer_ray(m):
    """21.5 soft airy shimmer as a ray breaks through."""
    rng = R(91)
    t0, dur = 21.2, 6.0
    n = S(dur)
    x = np.vstack([rng.standard_normal(n), rng.standard_normal(n)])

    def mask(f, t):
        return m_band(f, 7500 + 400 * t, 0.7)

    x = spectral(x, mask)
    e = envp(tv(n), [(0, 0), (0.3, 0.05), (1.3, 1.0), (3.5, 0.75), (6.0, 0)]) ** 1.5
    x = norm_rms(x * e, -42)
    times = np.sort(rng.uniform(21.5, 26.0, 110))
    freqs = rng.choice(np.concatenate([D_TRIAD * 2, D_TRIAD * 4]), len(times))
    amps = rng.uniform(0.2, 1, len(times)) * np.interp(times, [21.5, 22.5, 26], [0.3, 1, 0.2])
    cloud = grain_cloud(times, freqs, rng.uniform(0.08, 0.35, len(times)), amps,
                        rng.uniform(-0.7, 0.7, len(times)), dur, t0, rng)
    m.add(x + norm_peak(cloud, -30), t0, 0, dry=0.5, hall=0.9)


def flap(rng, strength=1.0):
    n = S(0.13)
    x = bp(rng.standard_normal(n), 500, 4500, 2)
    x *= 1 + 0.7 * smooth_rand(n, 300, rng)
    x = x * ad(n, 0.018, 0.045)
    x += 0.5 * bp(rng.standard_normal(n), 120, 450) * ad(n, 0.015, 0.03) * 1.5
    return edge_fade(x * strength, 0.001, 0.01)


def dove(m):
    rng = R(101)
    plan = [(22.3, -0.6, -0.3), (23.1, 0.2, 0.6), (23.9, 0.6, 0.25), (24.6, -0.25, 0.05)]
    for t0, p0, p1 in plan:
        nfl = rng.integers(4, 7)
        for k in range(nfl):
            tf = t0 + k * (1 / rng.uniform(8.5, 10.5))
            p = p0 + (p1 - p0) * k / (nfl - 1)
            m.add(norm_peak(flap(rng), -22 - 1.2 * k + rng.uniform(-1, 1)), tf, p, dry=1, air=0.2, hall=0.3)
        ts = t0 + rng.uniform(0, 0.6, 10)
        cl = grain_cloud(ts, rng.uniform(4000, 9000, 10), rng.uniform(0.05, 0.2, 10),
                         rng.uniform(0.3, 1, 10), p0 + (p1 - p0) * rng.random(10), 1.2, t0, rng)
        m.add(norm_peak(cl, -32), t0, 0, dry=0.6, hall=0.8)


def rekindle(m):
    """25.0 ignition whoomp + chime, then soft flame crackle to 38."""
    rng = R(111)
    t0 = 24.97
    n = S(1.4)
    x = rng.standard_normal(n)

    def mask(f, t):
        fc = np.where(t < 0.2, 150 * (2600 / 150) ** np.clip(t / 0.2, 0, 1),
                      2600 * (600 / 2600) ** np.clip((t - 0.2) / 0.6, 0, 1))
        return m_lp(f, fc, 2) * m_hp(f, 60, 2)

    x = spectral(x, mask)
    t = tv(n)
    e = envp(t, [(0, 0), (0.12, 1.0), (1.4, 1.0)]) ** 2 * np.exp(-np.maximum(t - 0.12, 0) / 0.28)
    x = norm_peak(x * e, 0)
    low = sine_sweep(60 + 40 * np.clip(t / 0.15, 0, 1), n) * ad(n, 0.03, 0.15)
    wh = norm_peak(x + 0.6 * low, -12)
    m.add(wh, t0, 0.1, dry=1, air=0.3, hall=0.2)
    ch = modal(1174.66 * np.array([1, 2.756, 5.404]), [1, 0.3, 0.1], [1.6, 0.7, 0.3], 3.0, att=0.004, seed=112)
    m.add(norm_peak(ch, -25), 25.03, 0.1, dry=0.5, hall=0.8)

    # soft flame crackle bed 25.25 -> 38.6
    t1, t2 = 25.25, 38.6
    n = S(t2 - t1)
    roar = lp(colored(n, rng, 2.0), 450) * (0.75 + 0.25 * np.tanh(smooth_rand(n, 6, rng)))
    roar = norm_rms(roar, -48)
    cr = np.zeros(n)
    for tg in poisson_times(5.0, 0.05, t2 - t1 - 0.1, rng):
        a = rng.lognormal(-1.2, 0.6)
        for j in range(rng.integers(1, 4)):
            k = S(0.008)
            s = S(tg + j * rng.uniform(0.006, 0.03))
            if s + k < n:
                cr[s:s + k] += a * bp(rng.standard_normal(k), 1500, 7500) * ad(k, 0.0002, 0.0018) * rng.uniform(0.4, 1)
    cr = norm_peak(cr, -31)
    tt = tv(n) + t1
    fade = envp(tt, [(25.25, 0), (26.0, 1), (38.0, 1), (38.6, 0)])
    pan = np.interp(tt, [25, 30, 35.4, 36.2], [0.1, 0.15, -0.05, 0.0])
    m.add((roar + cr) * fade, t1, pan, dry=1, air=0.12)


def rise_and_kneel(m):
    rng = R(121)
    # 29.0-30.0 cloth rustle as he rises
    m.add(norm_peak(cloth(rng, 1.15, 0.45), -22), 28.95, 0.1, dry=1, air=0.15)
    # 36.0 knee on stone
    n = S(0.4)
    t = tv(n)
    th = lp(rng.standard_normal(n), 300, 4) * ad(n, 0.002, 0.03) * 6 + np.sin(TWO_PI * 80 * t) * ad(n, 0.003, 0.05)
    th = norm_peak(th, 0) + 0.35 * norm_peak(hp(rng.standard_normal(n), 2500) * ad(n, 0.0005, 0.01), 0)
    th += 0.3 * norm_peak(np.pad(cloth(rng, 0.3, 0.1), (0, n - S(0.3))), 0)
    m.add(norm_peak(th, -15), 36.0, -0.02, dry=1, air=0.2)
    # lantern set down: small metal clink + rebound
    base = rng.uniform(1600, 1750)
    ratios = np.array([1, 1.64, 2.73, 3.91, 5.2])
    for tt, lvl in ((36.28, -20), (36.335, -29)):
        c = modal(base * ratios, [1, 0.7, 0.5, 0.3, 0.2], [0.35, 0.25, 0.17, 0.11, 0.07], 1.0, att=0.0005,
                  seed=int(tt * 100), detune=3)
        c += 0.5 * hp(rng.standard_normal(len(c)), 3000) * ad(len(c), 0.0002, 0.002)
        c += 0.8 * lp(rng.standard_normal(len(c)), 250, 4) * ad(len(c), 0.001, 0.015) * 4
        m.add(norm_peak(c, lvl), tt, 0.05, dry=1, air=0.25, hall=0.1)


def climax(m):
    """38.0 massive light burst: sub impact + bright airy swell + shockwave."""
    rng = R(131)
    t0 = 38.0
    m.add(norm_peak(sub_boom(5.0, 80, 26, 0.45, 1.4, 132, drive=1.8), -6.0), t0, 0, dry=1, air=0.05, hall=0.06)
    sw = norm_peak(shockwave(4.5, 11000, 200, 0.55, 0.8, 133, widen=1.4), -10.5)
    m.add(sw, t0, 0, dry=1, hall=0.4)
    n = S(7.0)
    air = np.vstack([rng.standard_normal(n), rng.standard_normal(n)])
    air = spectral(air, lambda f, t: m_hp(f, 2500, 2) * m_lp(f, 15000, 2) * (1 + m_band(f, 7000 + 600 * t, 0.6)))
    t = tv(n)
    e = (1 - np.exp(-t / 0.04)) * (0.75 * np.exp(-t / 0.8) + 0.25 * np.exp(-t / 2.2))
    m.add(norm_peak(air * e, -15), t0, 0, dry=0.8, hall=0.6)
    times = np.sort(t0 + rng.exponential(1.2, 500))
    times = times[times < 43]
    freqs = rng.choice(np.concatenate([D_TRIAD, D_TRIAD * 2, D_TRIAD * 4]), len(times))
    amps = np.exp(-(times - t0) / 1.5) * rng.uniform(0.3, 1, len(times))
    pans = rng.uniform(-1, 1, len(times)) * np.clip(0.2 + (times - t0) / 1.5, 0, 1)
    cl = grain_cloud(times, freqs, rng.uniform(0.05, 0.3, len(times)), amps, pans, 5.5, t0, rng)
    m.add(norm_peak(cl, -21), t0, 0, dry=0.6, hall=0.8)


def dawn_breeze(m):
    rng = R(141)
    t0, t1 = 38.4, 60.0
    n = S(t1 - t0)
    out = []
    for ch in range(2):
        g = 0.5 + 0.5 * np.tanh(smooth_rand(n, 0.3, rng))
        gf_t = tv(n)[::480]
        gf = g[::480]
        x = colored(n, rng, 1.0)

        def mask(f, t, gf=gf, gf_t=gf_t):
            gg = np.interp(t, gf_t, gf)
            return (0.5 + 0.5 * gg) * (m_band(f, 420 + 300 * gg, 1.1) + 0.3 * m_hp(f, 3500, 2) * gg)

        out.append(spectral(x, mask))
    b = np.vstack(out)
    e = envp(tv(n) + t0, [(38.4, 0), (41.5, 1), (55, 1), (59.6, 0)])
    m.add(norm_rms(b, -40) * e, t0, 0, dry=1, air=0.1)


def bloom_chimes(m):
    rng = R(151)
    notes = np.concatenate([D_PENT6, [2349.32]])
    times = np.sort(39.0 + 4.0 * rng.random(15) ** 1.3)
    for tt in times:
        f = rng.choice(notes)
        c = modal(f * np.array([1, 2.756, 5.404]), [1, 0.3, 0.08], [2.5, 1.0, 0.4], 4.0, att=0.02,
                  seed=int(tt * 1000), detune=1.5)
        m.add(norm_peak(c, -26 + rng.uniform(-3, 2)), tt, rng.uniform(-0.8, 0.8), dry=0.5, hall=0.8)


def lantern_ignitions(m):
    rng = R(161)
    times = np.sort(rng.uniform(43.5, 46.5, 24))
    notes = np.array([2349.32, 2637.02, 2959.96, 3520.0, 3951.07])
    for i, tt in enumerate(times):
        d = rng.uniform(0, 1)
        pan = rng.choice([-1, 1]) * rng.uniform(0.35, 0.95) * (1 - 0.4 * i / len(times))
        n = S(0.25)
        x = rng.standard_normal(n)
        x = spectral(x, lambda f, t: m_lp(f, 300 * (3500 / 300) ** np.clip(t / 0.08, 0, 1), 2))
        x = norm_peak(x * ad(n, 0.03, 0.06), 0) * 0.5
        c = modal(rng.choice(notes) * np.array([1, 2.76]), [1, 0.25], [0.9, 0.3], 2.0, att=0.002,
                  seed=1000 + i, detune=2)
        c[:n] += x
        c = lp(c, 13000 * (1 - d) + 2500)
        m.add(norm_peak(c, -23 - 11 * d), tt, pan, dry=1 - 0.5 * d, air=0.2, hall=0.5 + 0.4 * d)


def dove_flock(m):
    rng = R(171)
    for b in range(14):
        ts = 43.9 + rng.uniform(0, 0.45)
        dur = rng.uniform(1.7, 2.1)
        rate = rng.uniform(7.5, 10)
        off = rng.uniform(-0.3, 0.3)
        dist = rng.uniform(0.3, 1.0)
        tt = ts
        while tt < ts + dur:
            u = (tt - ts) / dur
            prox = np.exp(-((tt - 45.0) / 0.6) ** 2)
            pan = np.clip(-1 + 2 * u + off, -1, 1)
            lvl = -26 - 8 * dist + 7 * prox + rng.uniform(-1.5, 1.5)
            m.add(norm_peak(flap(rng), lvl), tt, pan, dry=1, air=0.15, hall=0.2)
            tt += 1 / rate * rng.uniform(0.9, 1.1)
            if rng.random() < 0.08:
                tt += rng.uniform(0.15, 0.3)          # short glide
    t0, dur = 43.8, 2.6
    n = S(dur)
    x = colored(n, rng, 0.8)

    def mask(f, t):
        prox = np.exp(-((t + t0 - 45.0) / 0.5) ** 2)
        return m_band(f, 700 + 1600 * prox, 1.0)

    x = spectral(x, mask)
    t = tv(n) + t0
    e = np.exp(-((t - 45.0) / 0.55) ** 2)
    pan = np.clip((t - 45.0) / 1.0, -0.95, 0.95)
    m.add(norm_peak(edge_fade(x * e, 0.01, 0.05), -19), t0, pan, dry=1, air=0.2)


def church_bell(f_prime, seed, dur=10.0):
    rng = R(seed)
    ratios = np.array([0.5, 1.0, 1.19, 1.5, 2.0, 2.5, 2.66, 3.0, 4.0, 5.2, 6.3])
    amps = np.array([0.5, 0.35, 0.45, 0.2, 0.6, 0.25, 0.15, 0.2, 0.12, 0.08, 0.05])
    decs = np.array([7.0, 4.5, 3.5, 2.8, 3.0, 1.8, 1.5, 1.2, 0.9, 0.6, 0.4])
    freqs = f_prime * ratios * (1 + rng.uniform(-0.004, 0.004, len(ratios)))
    x = modal(freqs, amps, decs, dur, att=0.001, seed=seed, detune=1.0)
    n = len(x)
    x += 0.25 * bp(rng.standard_normal(n), 900, 4000) * ad(n, 0.0003, 0.005) * 3
    return x


def bells(m):
    tolls = [(45.0, 293.66), (46.3, 220.0), (47.6, 293.66), (48.9, 220.0), (50.2, 293.66),
             (51.5, 220.0), (52.8, 293.66), (54.1, 220.0)]
    for i, (tt, f) in enumerate(tolls):
        b = church_bell(f, 200 + i)
        b = lp(b, 2400, 2)
        lvl = -27 + (1.5 if f < 250 else 0)
        m.add(norm_peak(b, lvl), tt, 0.35 if f > 250 else 0.25, dry=0.3, air=0.3, hall=1.0)


def sparkles_rise(m):
    rng = R(181)
    t0 = 51.0
    k = 480
    times = np.sort(t0 + 4.0 * rng.random(k) ** 0.6)
    f0 = 1800 * 2 ** (1.6 * (times - t0) / 4.0) * rng.uniform(0.9, 1.12, k)
    amps = rng.uniform(0.3, 1, k) * np.interp(times, [51, 52, 54.5, 55], [0.2, 0.6, 1.0, 0.8])
    cl = grain_cloud(times, f0, rng.uniform(0.12, 0.4, k), amps, rng.uniform(-0.9, 0.9, k), 6.5, t0, rng,
                     glide=rng.uniform(0.15, 0.4, k))
    n = cl.shape[1]
    air = np.vstack([rng.standard_normal(n), rng.standard_normal(n)])
    air = spectral(air, lambda f, t: m_band(f, 5000 * 2 ** (t / 4), 0.6))
    air *= envp(tv(n), [(0, 0), (4.0, 1), (6.0, 0), (6.5, 0)])
    m.add(norm_peak(cl, -21) + norm_rms(air, -44), t0, 0, dry=0.6, hall=0.85)


# ---- birdsong -----------------------------------------------------------
def syl(f):
    n = len(f)
    ph = TWO_PI * np.cumsum(f) / SR
    u = np.linspace(0, 1, n)
    return (np.sin(ph) + 0.1 * np.sin(2 * ph)) * np.sin(np.pi * u) ** 1.5


def song_template(species, rng):
    """Return a list of (offset, freq-contour-fn params) describing one phrase."""
    parts = []
    if species == "warbler":
        t = 0.0
        for _ in range(rng.integers(6, 11)):
            d = rng.uniform(0.035, 0.09)
            fs = rng.uniform(2600, 5500)
            fe = fs * rng.uniform(0.6, 1.5)
            bump = rng.uniform(-800, 800)
            parts.append((t, d, fs, fe, bump, 0.0))
            t += d + rng.uniform(0.015, 0.05)
    elif species == "whistle":
        t = 0.0
        base = rng.uniform(3000, 4000)
        for j in range(rng.integers(2, 4)):
            d = rng.uniform(0.22, 0.38)
            fs = base * (1.0 if j == 0 else rng.uniform(0.8, 0.9))
            parts.append((t, d, fs, fs * 0.96, 0.0, 0.012))
            t += d + rng.uniform(0.08, 0.14)
    elif species == "trill":
        fs = rng.uniform(5200, 6500)
        per = 1 / rng.uniform(15, 20)
        for j in range(rng.integers(14, 24)):
            parts.append((j * per, per * 0.6, fs, fs * 0.72, 0.0, 0.0))
    elif species == "chip":
        for j in range(rng.integers(1, 4)):
            parts.append((j * rng.uniform(0.12, 0.2), 0.018, 7200, 5400, 0.0, 0.0))
    elif species == "cascade":
        t = 0.0
        f = rng.uniform(4800, 5400)
        for j in range(rng.integers(8, 13)):
            d = 0.05 - 0.002 * j
            parts.append((t, d, f, f * 0.93, 300.0, 0.0))
            f *= 0.955
            t += d + 0.03
    return parts


def render_phrase(parts, rng, jitter=0.03):
    end = max(p[0] + p[1] for p in parts) + 0.05
    buf = np.zeros(S(end))
    for off, d, fs, fe, bump, vib in parts:
        k = max(S(d * rng.uniform(0.95, 1.05)), 16)
        u = np.linspace(0, 1, k)
        sc = 1 + rng.uniform(-jitter, jitter)
        f = (fs + (fe - fs) * u + bump * np.sin(np.pi * u)) * sc
        if vib:
            f *= 1 + vib * np.sin(TWO_PI * 6.5 * u * d)
        s = S(off)
        buf[s:s + k] += syl(f)[:len(buf) - s] * rng.uniform(0.75, 1.0)
    return buf


def birdsong(m):
    rng = R(191)
    birds = [("warbler", -0.6, 0.25), ("whistle", 0.5, 0.55), ("trill", 0.8, 0.7), ("chip", -0.2, 0.15),
             ("warbler", 0.3, 0.8), ("whistle", -0.8, 0.9), ("cascade", 0.1, 0.5), ("chip", 0.65, 0.45)]
    t0, t1 = 40.0, 60.0
    n = S(t1 - t0)
    for i, (sp, pan, dist) in enumerate(birds):
        brng = R(300 + i)
        tmpl = song_template(sp, brng)
        track = np.zeros(n)
        t = brng.uniform(0.2, 3.0) + (0.8 if dist > 0.6 else 0)
        gaps = {"chip": (0.8, 3.0), "trill": (3.0, 6.0)}.get(sp, (1.8, 4.5))
        while t < t1 - t0 - 1.0:
            ph = render_phrase(tmpl, brng)
            s = S(t)
            e = min(s + len(ph), n)
            track[s:e] += ph[:e - s] * brng.uniform(0.7, 1.0)
            t += len(ph) / SR + brng.uniform(*gaps)
            if brng.random() < 0.15:
                tmpl = song_template(sp, brng)          # occasional new song type
        track = lp(track, 12000 - 8500 * dist, 2)
        track = hp(track, 1500)
        env = envp(tv(n) + t0, [(40, 0), (43, 1), (55.5, 1), (59.5, 0)])
        m.add(norm_peak(track, -24 - 14 * dist) * env, t0, pan, dry=1 - 0.4 * dist, air=0.2 + 0.4 * dist,
              hall=0.1)


# --------------------------------------------------------------------------- render
def render():
    t_start = time.time()
    m = Mix()
    for fn in (creation, dive, wind_storm, rain, footsteps, thunder, flame_sputter, knee_mud,
               prayer_ray, dove, rekindle, rise_and_kneel, climax, dawn_breeze, bloom_chimes,
               lantern_ignitions, dove_flock, bells, sparkles_rise, birdsong):
        t = time.time()
        fn(m)
        print(f"  {fn.__name__:<18s} {time.time() - t:6.1f} s", flush=True)

    t = time.time()
    air_ir = make_ir(2.4, [1.6, 1.3, 0.9, 0.5], 0.015, 901)
    hall_ir = make_ir(7.0, [5.5, 4.5, 3.2, 1.8], 0.03, 902)
    out = m.dry + 0.5 * reverb(m.air, air_ir) + 0.45 * reverb(m.hall, hall_ir)
    print(f"  {'reverb':<18s} {time.time() - t:6.1f} s", flush=True)

    out = hp(out, 22, 2)
    tt = tv(N)
    fade = np.ones(N)
    k = tt >= 55.5
    fade[k] = 0.5 + 0.5 * np.cos(np.pi * np.clip((tt[k] - 55.5) / 4.3, 0, 1))
    out *= fade
    out[:, -S(0.05):] = 0.0
    out[:, :S(3.19)] = 0.0              # nothing before the 3.2 hit (tiny pre-ring guard)

    peak = np.max(np.abs(out))
    print(f"  pre-ceiling peak {20*np.log10(peak):.2f} dBFS at {np.argmax(np.max(np.abs(out),0))/SR:.3f} s")
    if peak > db(PEAK_DB):
        out *= db(PEAK_DB) / peak
    out = out.astype(np.float32)
    assert out.shape == (2, N)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if sf is not None:
        sf.write(OUT, out.T, SR, subtype="FLOAT")
    else:
        wavfile.write(OUT, SR, out.T)
    pk = 20 * np.log10(np.max(np.abs(out)) + 1e-12)
    print(f"wrote {OUT}  ({N} samples, {N / SR:.3f} s, peak {pk:.2f} dBFS, "
          f"render {time.time() - t_start:.1f} s)")
    rms = [20 * np.log10(np.sqrt(np.mean(out[:, i * SR:(i + 1) * SR].astype(float) ** 2)) + 1e-12)
           for i in range(60)]
    print("RMS dBFS per second:")
    for i in range(0, 60, 10):
        print("  " + " ".join(f"{i + j:2d}:{rms[i + j]:6.1f}" for j in range(10)))


if __name__ == "__main__":
    render()
