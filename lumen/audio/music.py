#!/usr/bin/env python3
"""
LUMEN - original sacred film score (60.000 s, 48 kHz, stereo, float32).

Everything is synthesised from code: formant-synthesis choir (ensemble of
detuned voices per part, vibrato, jitter, breath), additive pipe organ with
chiff, detuned-saw string ensemble, modal timpani / bells / glass, noise
cymbals, and a synthetic stereo cathedral convolution reverb. Deterministic.

Run from the repo root:   python3 lumen/audio/music.py
Output:                   lumen/audio/stems/music.wav

Form (key centre D; minor -> Picardy D major; plagal Amen):
  0.0- 1.5  sub drone D1/A1 fades in            1.5  glass ping D6
  1.5- 3.2  choir "ah" + reverse-cymbal swell, hard cut at 3.2
  3.2       tutti hit "Let there be light": choir open fifths D (no third),
            timpani, boom, crash, organ; shimmer + string pad tail to 7.0
  7.0- 9.0  descending, darkening chords (D5 - Gm/Bb - Gm) -> D minor
  9.0-17.0  D minor: cello ostinato, low choir "oo", heartbeat drum 60 bpm
            (i - VI - iv - V), thinning at 17, one low D from 18.0
 19.0-21.5  near silence: the held low D
 21.5-29.0  high choir halo (F major), solo voice hymn melody over soft
            flute organ from 22.0, half cadence on A at 29
 27.0-38.0  build; 30-38 processional at 60 bpm, lament bass
            i - v6 - iv6 - V - i - VI - iv6 - V, crescendo 33->38 + timp roll
 38.0       CLIMAX: tutti D MAJOR (Picardy), crash, huge reverb
 39.0-51.0  original 4-part chorale in D major (70 bpm), two 7-beat phrases
            (half cadence 45, authentic cadence 49.3), church bells from 45
 51.0-55.5  glorious swell I - vi7 - ii7;  55.5 IV (G) -> 57.0 I (D) "Amen"
            deep bell 57.0, high ping D6 58.8, fade to silence at 60.0
"""
import os
import time
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
N = 2_880_000                       # exactly 60.000 s
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "stems", "music.wav")
TWO_PI = 2.0 * np.pi

# --------------------------------------------------------------------------
# pitch helpers
# --------------------------------------------------------------------------
_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def M(name):
    """'F#4' / 'Bb2' -> MIDI number."""
    if not isinstance(name, str):
        return float(name)
    p = _PC[name[0]]
    i = 1
    while name[i] in "#b":
        p += 1 if name[i] == "#" else -1
        i += 1
    return 12 * (int(name[i:]) + 1) + p


def hz(m):
    return 440.0 * 2.0 ** ((M(m) - 69.0) / 12.0)


def ms(names):
    return [M(x) for x in names.split()]


# --------------------------------------------------------------------------
# generic helpers
# --------------------------------------------------------------------------
def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def note_env(dur, a, r, p=None):
    """Attack a (smoothstep or power p), sustain to dur, smooth release r."""
    n = max(1, int((dur + r) * SR))
    t = np.arange(n) / SR
    x = np.clip(t / max(a, 1e-4), 0.0, 1.0)
    att = x ** p if p else smoothstep(x)
    rel = np.clip((t - dur) / max(r, 1e-4), 0.0, 1.0)
    return att * (0.5 + 0.5 * np.cos(np.pi * rel))


def snoise(rng, n, rate):
    """Smooth random signal ~N(0,1), changing about `rate` times per second."""
    k = max(4, int(n / SR * rate) + 4)
    pts = rng.standard_normal(k)
    x = np.linspace(0, k - 3, n)
    i = np.floor(x).astype(int)
    fr = x - i
    fr = fr * fr * (3 - 2 * fr)
    return pts[i] * (1 - fr) + pts[i + 1] * fr


def saw_blep(f, ph0=0.0):
    """Band-limited (polyBLEP) sawtooth for a frequency array."""
    dt = f / SR
    ph = np.cumsum(dt) + ph0
    ph -= np.floor(ph)
    y = 2.0 * ph - 1.0
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1.0
    m = ph > 1.0 - dt
    x = (ph[m] - 1.0) / dt[m]
    y[m] -= x * x + x + x + 1.0
    return y


def pan_gains(p):
    th = (np.clip(p, -1, 1) + 1.0) * np.pi / 4.0
    return np.cos(th) * 1.4142, np.sin(th) * 1.4142


def butter(kind, fc, order=2):
    return signal.butter(order, fc, btype=kind, fs=SR, output="sos")


def filt(sos, x):
    return signal.sosfilt(sos, x, axis=-1)


def onepole_lp(x, fc):
    a = np.exp(-TWO_PI * fc / SR)
    return signal.lfilter([1 - a], [1, -a], x, axis=-1)


# --------------------------------------------------------------------------
# mixer with two reverb sends
# --------------------------------------------------------------------------
class Mix:
    def __init__(self):
        self.dry = np.zeros((2, N))
        self.hall = np.zeros((2, N))
        self.cath = np.zeros((2, N))

    def add(self, t0, x, gain=1.0, pan=0.0, hall=0.25, cath=0.0, dry=1.0):
        x = np.asarray(x, dtype=np.float64)
        if x.ndim == 1:
            gl, gr = pan_gains(pan)
            x = np.vstack([x * gl, x * gr])
        i0 = int(round(t0 * SR))
        s0 = 0
        if i0 < 0:
            s0, i0 = -i0, 0
        n = min(x.shape[1] - s0, N - i0)
        if n <= 0:
            return
        seg = x[:, s0:s0 + n] * gain
        if dry:
            self.dry[:, i0:i0 + n] += seg * dry
        if hall:
            self.hall[:, i0:i0 + n] += seg * hall
        if cath:
            self.cath[:, i0:i0 + n] += seg * cath


# --------------------------------------------------------------------------
# CHOIR - source/filter formant synthesis, ensemble of voices per line
# --------------------------------------------------------------------------
VOW = {
    "S": {"a": ([800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]),
          "o": ([450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]),
          "u": ([325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200])},
    "A": {"a": ([800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]),
          "o": ([450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]),
          "u": ([325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200])},
    "T": {"a": ([650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]),
          "o": ([400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]),
          "u": ([350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120])},
    "B": {"a": ([600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]),
          "o": ([400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]),
          "u": ([350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120])},
}


def voice_type(m):
    return "B" if m < 52 else "T" if m < 58 else "A" if m < 66 else "S"


def formant_bank(x, vt, vowel, bw_scale=1.5):
    F, A, B = VOW[vt][vowel]
    y = np.zeros_like(x)
    for f, a, bw in zip(F, A, B):
        w0 = TWO_PI * f / SR
        alpha = np.sin(w0) / (2.0 * f / (bw * bw_scale))
        b = np.array([alpha, 0.0, -alpha]) / (1 + alpha)
        aa = np.array([1.0 + alpha, -2 * np.cos(w0), 1 - alpha]) / (1 + alpha)
        y += 10 ** (a / 20.0) * signal.lfilter(b, aa, x, axis=-1)
    return y


def choir_line(notes, vowel="a", vt=None, nv=7, attack=0.35, release=0.7,
               vib=16.0, detune=6.0, spread=0.6, pan=0.0, breath=0.05,
               seed=0, glide=0.07, timing=0.025, p=None, vib_delay=0.2):
    """notes: [(t0, t1, midi, vel)] sung legato by one choir section (one
    pitch at a time).  Returns (start_time, stereo array) normalised to peak 1."""
    notes = sorted(((a, b, M(m), v) for a, b, m, v in notes), key=lambda z: z[0])
    if vt is None:
        vt = voice_type(np.mean([z[2] for z in notes]))
    T0 = notes[0][0] - timing - 0.01
    T1 = max(z[1] for z in notes) + release + timing + 0.05
    n = int((T1 - T0) * SR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    pans = np.linspace(-spread, spread, nv) + pan if nv > 1 else np.array([pan])
    rng0 = np.random.default_rng(seed)
    rng0.shuffle(pans)
    for v in range(nv):
        rng = np.random.default_rng(seed * 7919 + v * 104729 + 11)
        offs = rng.uniform(-timing, timing, len(notes))
        tgt = np.empty(n)
        ons = np.empty(n)
        starts = [max(0, int((z[0] + o - T0) * SR)) for z, o in zip(notes, offs)]
        tgt[:starts[0]] = notes[0][2]
        ons[:starts[0]] = starts[0] / SR
        for i, z in enumerate(notes):
            e = starts[i + 1] if i + 1 < len(notes) else n
            tgt[starts[i]:e] = z[2]
            ons[starts[i]:e] = starts[i] / SR
        al = 1.0 - np.exp(-1.0 / (glide * SR))
        mid = signal.lfilter([al], [1, al - 1], tgt, zi=[(1 - al) * tgt[0]])[0]
        # vibrato: rate & depth wander, fades in after each onset
        rate = rng.uniform(4.9, 5.9) + 0.35 * snoise(rng, n, 0.8)
        vph = TWO_PI * np.cumsum(rate) / SR + rng.uniform(0, TWO_PI)
        vdep = vib * (0.75 + 0.25 * snoise(rng, n, 0.5))
        von = 0.25 + 0.75 * smoothstep((t - ons - vib_delay) / 0.5)
        cents = (vdep * von * np.sin(vph)
                 + 2.5 * snoise(rng, n, 30)                   # jitter
                 + rng.normal(0, detune) + 3.0 * snoise(rng, n, 0.3))
        f = 440.0 * 2.0 ** ((mid - 69.0) / 12.0 + cents / 1200.0)
        src = saw_blep(f, rng.uniform())
        env = np.zeros(n)
        for (a0, a1, m, vel), o in zip(notes, offs):
            e = note_env(a1 - a0, attack * rng.uniform(0.8, 1.25), release * rng.uniform(0.85, 1.15), p)
            i0 = int((a0 + o - T0) * SR)
            k = min(len(e), n - i0)
            env[i0:i0 + k] += vel * e[:k]
        env *= 1.0 + 0.06 * snoise(rng, n, 7)
        sig = (src + breath * rng.standard_normal(n)) * env
        gl, gr = pan_gains(pans[v])
        L += sig * gl
        R += sig * gr
    x = np.vstack([L, R])
    x = 0.5 * x + 0.5 * onepole_lp(x, 1400.0)       # glottal tilt
    y = formant_bank(x, vt, vowel)
    y = filt(butter("high", 70), y)
    return T0, y / (np.abs(y).max() + 1e-12)


# --------------------------------------------------------------------------
# STRINGS - detuned saw ensemble, lowpassed, vibrato
# --------------------------------------------------------------------------
def string_note(m, dur, vel=1.0, nv=6, attack=0.3, release=0.6, bright=1.0,
                vib=9.0, detune=8.0, spread=0.5, seed=0, p=None):
    f0 = hz(m)
    n = int((dur + release) * SR)
    rng = np.random.default_rng(seed)
    L = np.zeros(n)
    R = np.zeros(n)
    for v in range(nv):
        rate = rng.uniform(4.8, 6.2)
        cents = (rng.normal(0, detune)
                 + vib * np.sin(TWO_PI * rate * np.arange(n) / SR + rng.uniform(0, TWO_PI))
                 + 2.0 * snoise(rng, n, 20))
        s = saw_blep(f0 * 2 ** (cents / 1200.0), rng.uniform())
        gl, gr = pan_gains(spread * (2 * v / max(1, nv - 1) - 1))
        L += s * gl
        R += s * gr
    x = np.vstack([L, R]) / np.sqrt(nv)
    fc = float(np.clip(f0 * 5 * bright + 900 * vel * bright, 250, 9000))
    x = filt(butter("low", fc), x)
    x = filt(butter("low", min(fc * 2.2, 16000), 1), x)
    x = filt(butter("high", 35), x)
    return x * note_env(dur, attack, release, p) * vel


def strings(mix, notes, gain, hall=0.35, cath=0.0, **kw):
    """notes: [(t0, t1, midi, vel)]"""
    for k, (a, b, m, v) in enumerate(notes):
        seed = int(a * 1000) * 131 + int(M(m)) * 7 + k
        x = string_note(m, b - a, v, seed=seed, **kw)
        mix.add(a, x, gain, hall=hall, cath=cath)


# --------------------------------------------------------------------------
# ORGAN - additive pipe ranks with chiff
# --------------------------------------------------------------------------
PRINC = [1.0, 0.5, 0.32, 0.18, 0.12, 0.07, 0.045, 0.03, 0.02]
FLUTE = [1.0, 0.06, 0.12, 0.02, 0.02]
REED = [1.0, 0.8, 0.7, 0.55, 0.45, 0.35, 0.28, 0.2, 0.15, 0.1, 0.07]
STOPS = {  # name: (footage ratio, spectrum, pan)
    "P16": (0.5, PRINC, 0.0), "B16": (0.5, FLUTE, 0.0), "P8": (1.0, PRINC, -0.15),
    "F8": (1.0, FLUTE, 0.2), "P4": (2.0, PRINC, 0.25), "F4": (2.0, FLUTE, -0.25),
    "P2": (4.0, PRINC, -0.3), "M1": (6.0, PRINC[:4], 0.35), "M2": (8.0, PRINC[:4], -0.35),
    "M3": (12.0, PRINC[:3], 0.3), "T8": (1.0, REED, 0.1), "T16": (0.5, REED, -0.05),
}


def organ_note(m, dur, stops, vel=1.0, seed=0, release=0.15):
    f0 = hz(m)
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    L = np.zeros(n)
    R = np.zeros(n)
    env_slow = note_env(dur, 0.07, release)
    env_fast = note_env(dur, 0.025, release)
    wob = 1.0 + 0.004 * snoise(rng, n, 3)
    for name, lvl in stops.items():
        ratio, spec, pn = STOPS[name]
        fr = f0 * ratio * 2 ** (rng.normal(0, 1.2) / 1200)
        mono = np.zeros(n)
        for k, a in enumerate(spec, start=1):
            f = fr * k
            if f > 11000:
                break
            e = env_slow if k <= 2 else env_fast
            mono += a * np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI)) * e
        # chiff: short band-limited noise burst near the 3rd-5th harmonic
        cf = min(fr * rng.uniform(3, 5), 9000)
        nb = int(0.12 * SR)
        ch = rng.standard_normal(nb)
        ch = filt(signal.butter(2, [cf * 0.8, min(cf * 1.25, 20000)], "band", fs=SR, output="sos"), ch)
        ch *= np.exp(-np.arange(nb) / (0.025 * SR)) * (1 - np.exp(-np.arange(nb) / (0.004 * SR)))
        mono[:nb] += 0.35 * ch * (1.5 if ratio >= 2 else 1.0)
        gl, gr = pan_gains(pn)
        L += mono * lvl * gl
        R += mono * lvl * gr
    return np.vstack([L, R]) * wob * vel * 0.12


def organ(mix, chords, stops, gain, pedal=None, hall=0.5, cath=0.0, seed=0, gap=0.04):
    """chords: [(t0, t1, [midis], vel)]; notes repeated in the next chord are re-struck
    with a tiny gap (organ articulation); pedal: stops dict for the lowest note."""
    for ci, (a, b, ps, v) in enumerate(chords):
        ps = [M(x) for x in ps]
        for k, m in enumerate(ps):
            st = pedal if (pedal is not None and k == 0) else stops
            if pedal is not None and k == 0:
                x = organ_note(m - 12, b - a - gap, pedal, v, seed + ci * 31 + k)
                mix.add(a, x, gain, hall=hall, cath=cath)
            x = organ_note(m, b - a - gap, stops, v, seed + ci * 31 + k + 7)
            mix.add(a, x, gain, hall=hall, cath=cath)


# --------------------------------------------------------------------------
# PERCUSSION & BELLS
# --------------------------------------------------------------------------
def timpani(m, vel=1.0, dur=3.5, seed=0):
    f0 = hz(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ratios = [1.0, 1.504, 1.742, 2.0, 2.245, 2.494, 2.8, 3.0]
    amps = [1.0, 0.55, 0.32, 0.3, 0.17, 0.12, 0.07, 0.05]
    decs = [2.4, 1.5, 1.0, 0.9, 0.65, 0.5, 0.4, 0.3]
    glide = 1.0 + 0.035 * vel * np.exp(-t / 0.07)
    y = np.zeros(n)
    for r, a, d in zip(ratios, amps, decs):
        ph = TWO_PI * np.cumsum(f0 * r * glide) / SR + rng.uniform(0, TWO_PI)
        y += a * (vel ** (0.6 * (r - 1))) * np.sin(ph) * np.exp(-t / d)
    thump = np.sin(TWO_PI * np.cumsum(f0 * 0.62 * glide) / SR) * np.exp(-t / 0.12)
    y += 0.8 * thump
    nz = filt(butter("low", 900 + 2500 * vel), rng.standard_normal(n)) * np.exp(-t / 0.012)
    y += 0.6 * vel * nz
    y *= 1 - np.exp(-t / 0.0015)
    return 0.35 * vel * y


def timp_roll(mix, m, t0, t1, v0, v1, gain, seed=0, rate=15.0, pan=0.0, hall=0.3, cath=0.2, cut=True):
    rng = np.random.default_rng(seed)
    t = t0
    k = 0
    buf = np.zeros(int((t1 - t0 + 1.5) * SR))
    while t < t1 - 0.02:
        x = (t - t0) / (t1 - t0)
        v = (v0 + (v1 - v0) * x ** 1.6) * (1.0 + (0.08 if k % 2 else -0.05)) * rng.uniform(0.9, 1.1)
        h = timpani(m, v, 1.5, seed + k)
        i = int((t - t0) * SR)
        buf[i:i + len(h)] += h[:len(buf) - i]
        t += (1.0 / rate) * rng.uniform(0.85, 1.15)
        k += 1
    if cut:
        c = int((t1 - t0) * SR)
        buf[c:] = 0.0
        buf[c - 96:c] *= np.linspace(1, 0, 96)
    mix.add(t0, buf, gain, pan=pan, hall=hall, cath=cath)


def boom(dur=5.0, seed=0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    f = 29 + 38 * np.exp(-t / 0.22)
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 1.6)
    y += 0.6 * filt(butter("low", 180), rng.standard_normal(n)) * np.exp(-t / 0.08)
    y *= 1 - np.exp(-t / 0.003)
    return np.tanh(1.8 * y) / np.tanh(1.8)


def cymbal(dur=6.0, decay=1.8, seed=0, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    out = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        hi = filt(butter("high", 2800), nz)
        mid = filt(signal.butter(2, [900, 4500], "band", fs=SR, output="sos"), nz)
        y = (hi * np.exp(-t / decay) + 0.5 * mid * np.exp(-t / (decay * 0.45)))
        met = np.zeros(n)
        for f in np.exp(rng.uniform(np.log(500), np.log(9000), 50)):
            met += np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI)) * np.exp(-t / rng.uniform(0.6, 2.2) / decay * 1.8) / np.sqrt(f / 500)
        y += 0.05 * met
        y = filt(butter("low", 9000 * bright), y)
        y *= 1 - np.exp(-t / 0.002)
        out.append(y)
    x = np.vstack(out)
    return x / np.abs(x).max()


def reverse_swell(dur, seed=0, power=3.0):
    """Reverse-cymbal-like rising noise, bright at the end, hard stop."""
    n = int(dur * SR)
    x01 = np.arange(n) / n
    rng = np.random.default_rng(seed)
    out = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        dark = filt(signal.butter(2, [600, 3000], "band", fs=SR, output="sos"), nz)
        bright = filt(butter("high", 3500), nz)
        met = np.zeros(n)
        tt = np.arange(n) / SR
        for f in np.exp(rng.uniform(np.log(1500), np.log(8000), 30)):
            met += np.sin(TWO_PI * f * tt + rng.uniform(0, TWO_PI))
        e = x01 ** power
        y = (dark * (1 - x01) + bright * x01 * 1.3 + 0.02 * met * x01) * e
        y[-64:] *= np.linspace(1, 0, 64)
        out.append(y)
    x = np.vstack(out)
    return x / np.abs(x).max()


BELL_R = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166]
BELL_A = [0.55, 0.8, 0.7, 0.35, 1.0, 0.3, 0.35, 0.22, 0.15]
BELL_T = [1.0, 0.65, 0.5, 0.4, 0.36, 0.25, 0.23, 0.18, 0.12]


def bell(m, vel=1.0, dur=9.0, size=10.0, seed=0, bright=1.0):
    f0 = hz(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    y = np.zeros(n)
    for r, a, d in zip(BELL_R, BELL_A, BELL_T):
        f = f0 * r
        if f > 15000:
            continue
        tau = size * d
        for s in (-1, 1):                       # doublets -> slow warble
            ff = f * (1 + s * rng.uniform(0.0004, 0.0015))
            y += 0.5 * a * (bright ** (r - 1)) * np.sin(TWO_PI * ff * t + rng.uniform(0, TWO_PI)) * np.exp(-t / tau)
    nz = filt(butter("high", 1500), rng.standard_normal(n)) * np.exp(-t / 0.01)
    y += 0.25 * nz
    y *= 1 - np.exp(-t / 0.001)
    return 0.3 * vel * y


def glass(m, vel=1.0, dur=4.0, seed=0):
    f0 = hz(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    y = np.zeros(n)
    for r, a, d in zip([1, 2.756, 5.404, 8.933], [1.0, 0.3, 0.12, 0.05], [2.6, 0.9, 0.35, 0.15]):
        if f0 * r < 18000:
            y += a * np.sin(TWO_PI * f0 * r * t + rng.uniform(0, TWO_PI)) * np.exp(-t / d)
    y += 0.03 * np.sin(TWO_PI * f0 * 1.0015 * t) * np.exp(-t / 2.6)
    y *= 1 - np.exp(-t / 0.0008)
    return 0.4 * vel * y


def shimmer(dur, pitches, seed=0, twinkle=4.0):
    """High sine cluster with random twinkling amplitude (light / heaven)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    L = np.zeros(n)
    R = np.zeros(n)
    for m in pitches:
        for k in range(3):
            f = hz(m) * 2 ** (rng.normal(0, 4) / 1200)
            am = np.clip(0.5 + 0.6 * snoise(rng, n, twinkle), 0, None) ** 2
            s = np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI)) * am
            gl, gr = pan_gains(rng.uniform(-0.9, 0.9))
            L += s * gl
            R += s * gr
    x = np.vstack([L, R])
    return x / np.abs(x).max()


def heartbeat(vel=1.0, seed=0):
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)

    def hit(f1, f2, dec, ts):
        tt = np.clip(t - ts, 0, None)
        on = (t >= ts).astype(float)
        f = f2 + (f1 - f2) * np.exp(-tt / 0.03)
        y = np.sin(TWO_PI * np.cumsum(f * on) / SR) * np.exp(-tt / dec) * on
        y *= 1 - np.exp(-tt / 0.004)
        return y
    y = hit(62, 44, 0.16, 0.0) + 0.65 * hit(70, 50, 0.12, 0.29)
    y += 0.15 * filt(butter("low", 300), rng.standard_normal(n)) * np.exp(-t / 0.02)
    return np.tanh(1.6 * y) * vel


def bass_drum(vel=1.0, seed=0):
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    f = 48 + 40 * np.exp(-t / 0.05)
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    y += 0.3 * np.sin(TWO_PI * np.cumsum(f * 1.58) / SR) * np.exp(-t / 0.25)
    sk = filt(signal.butter(2, [90, 700], "band", fs=SR, output="sos"), rng.standard_normal(n))
    y += 0.5 * vel * sk * np.exp(-t / 0.06)
    y *= 1 - np.exp(-t / 0.002)
    return np.tanh(1.4 * y) * vel


# --------------------------------------------------------------------------
# REVERB - synthetic stereo cathedral impulse responses
# --------------------------------------------------------------------------
def make_ir(rts, length, seed, predelay=0.035, build=0.05):
    n = int(length * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    bands = [butter("low", 250), signal.butter(2, [250, 1200], "band", fs=SR, output="sos"),
             signal.butter(2, [1200, 4500], "band", fs=SR, output="sos"), butter("high", 4500)]
    irs = []
    for ch in range(2):
        nz = rng.standard_normal(n)
        ir = np.zeros(n)
        for sos, rt in zip(bands, rts):
            ir += filt(sos, nz) * np.exp(-6.9078 * t / rt)
        ir *= 1 - np.exp(-t / build)
        for _ in range(14):                                    # early reflections
            d = rng.uniform(0.008, 0.09)
            ir[int(d * SR)] += rng.choice([-1, 1]) * rng.uniform(0.5, 1.5) * np.exp(-d / 0.05) * 3
        pd = int(predelay * SR)
        ir = np.concatenate([np.zeros(pd), ir[:n - pd]])
        irs.append(ir)
    irs = np.array(irs)
    return irs / np.sqrt((irs ** 2).sum(axis=1).mean())


def convolve_bus(bus, ir):
    out = np.zeros_like(bus)
    for ch in range(2):
        out[ch] = signal.fftconvolve(bus[ch], ir[ch])[:N]
    return filt(butter("high", 90), out)


# --------------------------------------------------------------------------
# voice-leading check (chorale integrity: no parallel 5ths / 8ves)
# --------------------------------------------------------------------------
def check_parallels(chords, label):
    bad = []
    for i in range(len(chords) - 1):
        a = [M(x) for x in chords[i].split()]
        b = [M(x) for x in chords[i + 1].split()]
        for p in range(4):
            for q in range(p + 1, 4):
                i1, i2 = (a[q] - a[p]) % 12, (b[q] - b[p]) % 12
                moved = a[p] != b[p] and a[q] != b[q]
                if moved and i1 == i2 and i1 in (0, 7):
                    bad.append((label, i, p, q, "8ve" if i1 == 0 else "5th"))
    return bad


# --------------------------------------------------------------------------
# THE SCORE
# --------------------------------------------------------------------------
BEAT = 6.0 / 7.0                                     # 70 bpm chorale
PROC = [  # 30-38 processional, lament bass, 1 chord per beat
    (30.0, "D3 A3 F4 A4"), (31.0, "C3 A3 E4 A4"), (32.0, "Bb2 D4 G4 Bb4"), (33.0, "A2 E4 A4 C#5"),
    (34.0, "D3 F4 A4 D5"), (35.0, "Bb2 F4 Bb4 D5"), (36.0, "G2 E4 Bb4 D5"), (37.0, "A2 E4 A4 C#5"),
]
CLIMAX = "D3 F#4 A4 D5"
P1 = ["D3 A3 D4 F#4", "C#3 A3 E4 A4", "B2 F#3 D4 D5", "A2 A3 E4 C#5", "G2 D4 G4 B4", "A2 C#4 E4 A4"]
P2 = ["D3 D4 F#4 A4", "B2 D4 F#4 D5", "C#3 A3 A4 E5", "D3 D4 A4 F#5", "A2 C#4 G4 E5", "D3 D4 F#4 D5"]
DUR7 = [1, 1, 1, 1, 1, 2]
CODA = [(51.0, "D3 A3 F#4 D5"), (52.333, "B2 D4 A4 F#5"), (53.667, "E3 D4 B4 G5"),
        (55.5, "G2 D4 B4 G5"), (57.0, "D3 D4 A4 F#5")]


def hymn_chords():
    out = []
    for start, phrase in ((39.0, P1), (45.0, P2)):
        t = start
        for ch, d in zip(phrase, DUR7):
            out.append((t, t + d * BEAT, ch.split()))
            t += d * BEAT
    return out


def satb_lines(chords, vel=1.0, vels=None):
    """chords [(t0,t1,[B,T,A,S])] -> 4 note lists"""
    lines = [[], [], [], []]
    for k, (a, b, ps) in enumerate(chords):
        v = vels[k] if vels is not None else vel
        for i in range(4):
            lines[i].append((a, b, ps[i], v))
    return lines


def render():
    mix = Mix()
    t_start = time.time()

    # ---------------- 0.0 - 7.0  CREATION ----------------------------------
    n = int(7.6 * SR)
    t = np.arange(n) / SR
    drone = (np.sin(TWO_PI * hz("D1") * t) + 0.8 * np.sin(TWO_PI * hz("A1") * t + 1.0)
             + 0.35 * np.sin(TWO_PI * hz("D2") * 1.0008 * t) + 0.12 * np.sin(TWO_PI * hz("A2") * t))
    denv = smoothstep(t / 1.8) ** 2.0 * (0.5 + 0.5 * smoothstep((t - 1.0) / 2.2))
    denv *= 1 - smoothstep((t - 4.0) / 3.5)
    mix.add(0.0, drone * denv, 0.075, hall=0.05)

    mix.add(1.5, glass("D6", 1.0, 4.0, 1), 0.34, pan=0.0, hall=0.9, cath=0.5)

    # swell 1.5 -> 3.2 (cut)
    for k, m in enumerate(ms("D3 A3 D4 A4 D5")):
        s, y = choir_line([(1.5, 3.2, m, 1.0)], "a", nv=6, attack=1.7, release=0.008, p=2.6,
                          timing=0.0, seed=100 + k, vib=12)
        mix.add(s, y, 0.13, hall=0.12)
    mix.add(1.2, reverse_swell(2.0, 3, 3.2), 0.20, hall=0.08)
    timp_roll(mix, "D2", 2.3, 3.19, 0.15, 0.7, 0.45, seed=5, hall=0.05, cath=0.05)

    # 3.2 tutti hit: open fifths on D (no third)
    hit = [("D2", "B"), ("A2", "B"), ("D3", "T"), ("A3", "T"), ("D4", "A"), ("A4", "A"), ("D5", "S"), ("A5", "S")]
    for k, (m, vt) in enumerate(hit):
        s, y = choir_line([(3.2, 4.3, m, 1.0)], "a", vt=vt, nv=7, attack=0.05, release=2.6,
                          seed=200 + k, vib=14, timing=0.012)
        mix.add(s, y, 0.30, hall=0.5, cath=0.5)
    mix.add(3.2, timpani("D2", 1.0, 4.0, 11), 0.9, hall=0.2, cath=0.4)
    mix.add(3.2, timpani("A2", 0.8, 4.0, 12), 0.5, pan=0.2, hall=0.2, cath=0.4)
    mix.add(3.2, boom(5.0, 13), 0.55, hall=0.0, cath=0.15)
    mix.add(3.2, cymbal(6.0, 2.2, 14), 0.20, hall=0.3, cath=0.5)
    organ(mix, [(3.2, 4.4, ms("D2 A2 D3 A3 D4 A4"), 1.0)],
          {"P8": 1, "P4": 0.7, "P2": 0.5, "M1": 0.3, "M2": 0.25}, 0.35,
          pedal={"P16": 1, "B16": 0.8, "T16": 0.3}, hall=0.4, cath=0.6)
    # shimmer + string pad tail
    sh = shimmer(4.6, ms("D6 A6 D7 E7 A7"), 21, 5.0)
    sh *= note_env(3.6, 0.05, 1.0, 0.5)[:sh.shape[1]] * np.exp(-np.arange(sh.shape[1]) / SR / 2.2)
    mix.add(3.2, sh, 0.09, hall=0.9, cath=0.4)
    pad = [(3.35, 7.2, m, 0.55) for m in ms("D3 A3 D4 A4 E5")]
    strings(mix, pad, 0.10, attack=1.1, release=0.6, hall=0.5, bright=0.8)

    # ---------------- 7.0 - 9.0  DESCENT / DARKENING -----------------------
    desc = [(7.0, "D3 A3 D4 A4"), (7.667, "Bb2 Bb3 D4 G4"), (8.333, "G2 Bb3 D4 F4")]
    for i, (a, ch) in enumerate(desc):
        b = desc[i + 1][0] if i + 1 < len(desc) else 9.2
        br = 0.8 - 0.2 * i
        strings(mix, [(a, b + 0.15, m, 0.6 - 0.07 * i) for m in ms(ch)], 0.10,
                attack=0.35, release=0.5, hall=0.5, bright=br)
    # low choir "oo" lines 7.0 - 17.0
    lowB = [(7.0, 7.667, "D3", .7), (7.667, 8.333, "Bb2", .75), (8.333, 9.0, "G2", .8), (9.0, 15.0, "D3", .9), (15.0, 17.1, "C#3", .85)]
    lowT = [(7.0, 7.667, "A3", .7), (7.667, 9.0, "Bb3", .75), (9.0, 13.0, "F3", .85), (13.0, 15.0, "G3", .85), (15.0, 17.1, "E3", .85)]
    lowA = [(7.0, 9.0, "D4", .6), (9.0, 11.0, "A3", .8), (11.0, 15.0, "Bb3", .8), (15.0, 17.1, "A3", .8)]
    for k, (ln, vt) in enumerate(((lowB, "B"), (lowT, "T"), (lowA, "A"))):
        s, y = choir_line(ln, "u", vt=vt, nv=7, attack=0.8, release=1.3, seed=300 + k, vib=12)
        # fade the section out 16.6 -> 18.2
        tt = s + np.arange(y.shape[1]) / SR
        y *= 1 - 0.85 * smoothstep((tt - 16.4) / 1.6)
        mix.add(s, y, 0.075, pan=(-0.3, 0.3, 0.0)[k], hall=0.55)

    # ---------------- 9.0 - 17.0  D MINOR STORM ----------------------------
    bassline = [(9.0, 11.0, "D2"), (11.0, 13.0, "Bb1"), (13.0, 15.0, "G1"), (15.0, 17.0, "A1")]
    strings(mix, [(a, b + 0.1, m, 0.7) for a, b, m in bassline], 0.09, attack=0.4, release=0.4,
            hall=0.3, bright=0.9, nv=5)
    osti = {9.0: "D3 A2 F3 A2 D3 A2 E3 A2", 11.0: "Bb2 F2 D3 F2 Bb2 F2 C3 F2",
            13.0: "G2 D2 Bb2 D2 G2 D2 A2 D2", 15.0: "A2 E2 C#3 E2 A2 E2 G2 E2"}
    for a, pat in osti.items():
        for j, m in enumerate(ms(pat)):
            tt = a + 0.25 * j
            acc = 1.0 if j % 4 == 0 else 0.72 if j % 2 == 0 else 0.6
            dyn = 0.75 + 0.25 * np.sin(np.pi * (tt - 9.0) / 8.0)
            fade = 1.0 - 0.6 * smoothstep((tt - 16.0) / 1.0)
            x = string_note(m, 0.12, acc * dyn * fade, nv=4, attack=0.012, release=0.2,
                            bright=1.3, vib=4, seed=int(tt * 100))
            mix.add(tt, x, 0.20, pan=-0.25, hall=0.35)
    for b in range(9, 17):
        v = 0.85 if b < 16 else 0.5
        mix.add(float(b), heartbeat(v, b), 0.30, hall=0.12)

    # 17 - 22.5: one low sustained D (the held note)
    strings(mix, [(17.0, 22.4, "D2", 0.55)], 0.085, attack=1.0, release=1.4, hall=0.35, bright=0.6, nv=5)
    strings(mix, [(17.0, 18.0, "D3", 0.35)], 0.08, attack=0.6, release=0.8, hall=0.35, bright=0.6)

    # ---------------- 21.5 - 29.0  PRAYER, LIGHT, SOLO -------------------------
    halo = [(21.5, 25.0, "F5 A5 C6", 0.9), (25.0, 26.5, "F5 Bb5 D6", 1.0), (26.5, 27.0, "E5 G5 C6", 0.8),
            (27.0, 28.0, "D5 G5 Bb5", 0.8), (28.0, 28.5, "E5 A5 C6", 0.8), (28.5, 29.0, "D5 G5 Bb5", 0.8),
            (29.0, 30.0, "E5 A5 C#6", 0.85)]
    for i in range(3):
        ln = [(a, b, ch.split()[i], v) for a, b, ch, v in halo]
        s, y = choir_line(ln, "a", vt="S", nv=7, attack=0.6, release=0.9, seed=400 + i, vib=14, breath=0.08)
        tt = s + np.arange(y.shape[1]) / SR
        y *= (0.45 + 0.55 * np.exp(-np.clip(tt - 21.9, 0, None) / 0.8)) * (1 - 0.6 * smoothstep((tt - 29.2) / 0.8))
        mix.add(s, y, 0.06, pan=(-0.4, 0.4, 0.0)[i], hall=0.9, cath=0.3)
    sh = shimmer(8.5, ms("F6 A6 C7 F7"), 22, 6.0) * note_env(7.0, 0.8, 1.5)[:int(8.5 * SR)]
    mix.add(21.5, sh, 0.03, hall=0.9, cath=0.3)

    # soft flute organ harmony
    pr = [(22.0, 23.0, "F2 F3 A3 C4"), (23.0, 24.0, "D2 F3 A3 D4"), (24.0, 25.0, "C2 F3 A3 C4"),
          (25.0, 26.5, "Bb1 F3 Bb3 D4"), (26.5, 27.0, "C2 G3 C4 E4"), (27.0, 28.0, "G1 G3 Bb3 D4"),
          (28.0, 28.5, "A1 A3 C4 E4"), (28.5, 29.0, "Bb1 G3 Bb3 D4"), (29.0, 30.0, "A1 A3 C#4 E4")]
    pv = [0.55, 0.55, 0.6, 0.65, 0.65, 0.7, 0.75, 0.8, 0.85]
    organ(mix, [(a, b + 0.03, ch.split(), v) for (a, b, ch), v in zip(pr, pv)],
          {"F8": 1.0, "F4": 0.35}, 0.30, pedal={"B16": 1.0}, hall=0.6, gap=0.0, seed=500)

    # solo voice melody (original)
    mel = [(22.0, 1.0, "C5"), (23.0, 0.5, "A4"), (23.5, 0.5, "Bb4"), (24.0, 0.75, "C5"), (24.75, 0.25, "D5"),
           (25.0, 1.5, "F5"), (26.5, 0.5, "E5"), (27.0, 1.0, "D5"), (28.0, 0.5, "C5"), (28.5, 0.5, "Bb4"),
           (29.0, 1.0, "A4")]
    mv = [0.8, 0.75, 0.75, 0.85, 0.8, 1.0, 0.85, 0.9, 0.85, 0.85, 0.8]
    solo = [(a, a + d, m, v) for (a, d, m), v in zip(mel, mv)]
    s, y = choir_line(solo, "o", vt="A", nv=1, attack=0.12, release=0.45, vib=32, detune=0,
                      breath=0.10, seed=600, glide=0.05, timing=0.0, vib_delay=0.25, spread=0)
    mix.add(s, y, 0.16, pan=0.05, hall=0.6, cath=0.15)
    s, y = choir_line(solo, "o", vt="A", nv=2, attack=0.15, release=0.45, vib=20, detune=4,
                      breath=0.05, seed=601, glide=0.05, timing=0.0, spread=0.3)
    mix.add(s, y, 0.05, hall=0.6)
    # cello doubles an octave lower from the rekindling (25.0)
    strings(mix, [(a, a + d + 0.05, M(m) - 12, 0.45 + 0.1 * (a > 27)) for a, d, m in mel[5:]], 0.08,
            attack=0.18, release=0.35, hall=0.5, bright=0.9, nv=4)
    # 27.0 build: strings enter pp on the organ chords
    strings(mix, [(27.0, 28.0, m, 0.25) for m in ms("G2 D3 Bb3")] +
            [(28.0, 28.5, m, 0.3) for m in ms("A2 E3 C4")] +
            [(28.5, 29.0, m, 0.33) for m in ms("Bb2 D3 Bb3")] +
            [(29.0, 30.1, m, 0.4) for m in ms("A2 E3 C#4")], 0.12, attack=0.4, release=0.4, hall=0.5, bright=0.8)
    mix.add(28.9, bass_drum(0.35, 1), 0.3, hall=0.3)

    # ---------------- 30 - 38  PROCESSIONAL -------------------------------
    pchords = []
    for i, (a, ch) in enumerate(PROC):
        b = PROC[i + 1][0] if i + 1 < len(PROC) else 38.0
        pchords.append((a, b, ch.split()))
    pvel = [0.45, 0.47, 0.5, 0.55, 0.62, 0.72, 0.85, 1.0]
    lines = satb_lines(pchords, vels=pvel)
    for i, ln in enumerate(lines):
        first = [z for z in ln if z[0] < 34.0]
        second = [z for z in ln if z[0] >= 34.0]
        for k, (part, vw) in enumerate(((first, "o"), (second, "a"))):
            s, y = choir_line(part, vw, vt="BTAS"[i], nv=7, attack=0.25, release=0.5,
                              seed=700 + 10 * i + k, vib=15)
            # re-apply relative dynamics between the halves (normalised separately)
            mix.add(s, y, 0.13 * max(v for *_, v in part), pan=(-0.3, 0.3, -0.15, 0.15)[i], hall=0.5, cath=0.2)
    for i, (a, b, ch) in enumerate(pchords):
        st = {"P8": 1.0, "F8": 0.5, "P4": 0.6}
        if a >= 33:
            st["P2"] = 0.5
        if a >= 35:
            st.update({"M1": 0.35, "M2": 0.3})
        if a >= 36:
            st["T8"] = 0.25
        organ(mix, [(a, b, ch, pvel[i])], st, 0.30, pedal={"P16": 1.0, "B16": 0.8},
              hall=0.5, cath=0.2, seed=800 + i)
        strings(mix, [(a, b + 0.05, m, pvel[i]) for m in ch], 0.075, attack=0.12, release=0.3,
                hall=0.4, bright=1.0)
        strings(mix, [(a, b + 0.05, M(ch[3]) + 12, pvel[i] * 0.8)], 0.06 if a >= 34 else 0.0,
                attack=0.15, release=0.3, hall=0.5, bright=1.1)
        # cellos/basses pulse eighths on the bass note
        for j in range(2):
            tt = a + 0.5 * j
            x = string_note(M(ch[0]) - 12, 0.3, pvel[i] * (1.0 if j == 0 else 0.75), nv=4,
                            attack=0.02, release=0.2, bright=1.2, vib=3, seed=int(tt * 97))
            mix.add(tt, x, 0.16, pan=-0.2, hall=0.35)
    for b in range(30, 38):
        v = 0.5 + 0.5 * smoothstep((b - 32.5) / 5.0)
        mix.add(float(b), bass_drum(v, b), 0.32, hall=0.3, cath=0.15)
        mix.add(b + 0.5, bass_drum(v * 0.45, b + 50), 0.3 if b >= 34 else 0.0, hall=0.3)
    timp_roll(mix, "A2", 33.0, 37.98, 0.1, 0.85, 0.36, seed=900, hall=0.25, cath=0.25)
    mix.add(36.4, reverse_swell(1.6, 901, 3.0), 0.22, hall=0.1)

    # ---------------- 38.0  CLIMAX - D MAJOR (Picardy) ----------------------
    big = ms("D2 D3 A3 D4 F#4 A4 D5 F#5 A5")
    for k, m in enumerate(big):
        s, y = choir_line([(38.0, 39.1, m, 1.0)], "a", nv=8, attack=0.06, release=1.6,
                          seed=1000 + k, vib=16, timing=0.012)
        mix.add(s, y, 0.46, pan=np.linspace(-0.5, 0.5, len(big))[k], hall=0.5, cath=0.7)
    organ(mix, [(38.0, 39.1, ms("D2 A2 D3 F#3 A3 D4 F#4 A4 D5"), 1.0)],
          {"P8": 1, "P4": 0.8, "P2": 0.6, "M1": 0.45, "M2": 0.4, "M3": 0.25, "T8": 0.5},
          0.42, pedal={"P16": 1.0, "B16": 1.0, "T16": 0.6}, hall=0.4, cath=0.7, seed=1100, gap=0.0)
    strings(mix, [(38.0, 39.2, m, 1.0) for m in ms("D2 D3 A3 F#4 D5 F#5 A5")], 0.10, attack=0.03,
            release=1.0, hall=0.4, cath=0.5, bright=1.2)
    mix.add(38.0, timpani("D2", 1.0, 4.5, 1201), 1.0, hall=0.2, cath=0.5)
    mix.add(38.0, timpani("A2", 0.9, 4.5, 1202), 0.55, pan=0.25, hall=0.2, cath=0.5)
    mix.add(38.0, boom(5.0, 1203), 0.5, cath=0.2, hall=0.0)
    mix.add(38.0, cymbal(7.0, 2.6, 1204), 0.30, hall=0.3, cath=0.7)
    sh = shimmer(6.0, ms("D6 F#6 A6 D7 A7"), 1205, 5.0) * np.exp(-np.arange(int(6 * SR)) / SR / 2.0)
    mix.add(38.0, sh, 0.06, hall=0.8, cath=0.6)

    # ---------------- 39 - 51  CHORALE in D major ---------------------------
    hc = hymn_chords()
    hv = [0.95, 0.9, 0.92, 0.92, 0.9, 0.88, 0.85, 0.88, 0.9, 1.0, 0.95, 0.95]
    coda = [(a, CODA[i + 1][0] if i + 1 < len(CODA) else 59.0, ch.split()) for i, (a, ch) in enumerate(CODA)]
    cv = [0.9, 0.95, 1.0, 1.0, 1.0]
    allc = hc + coda
    allv = hv + cv
    lines = satb_lines(allc, vels=allv)
    for i, ln in enumerate(lines):
        # sustain the final chord longer with release
        s, y = choir_line(ln, "a", vt="BTAS"[i], nv=8, attack=0.12, release=1.2, seed=1300 + i,
                          vib=15, timing=0.02, glide=0.06)
        tt = s + np.arange(y.shape[1]) / SR
        # swell 51 -> 55.5, gentle decay of final chord 57 -> 59.5
        y *= (0.85 + 0.35 * smoothstep((tt - 51.0) / 4.0)) * (1 - 0.95 * smoothstep((tt - 57.3) / 2.3))
        mix.add(s, y, 0.21, pan=(-0.3, 0.3, -0.12, 0.12)[i], hall=0.5, cath=0.35)
    # descant sopranos double the top line an octave above from 47 (glory)
    desc_line = [(a, b, M(ps[3]) + 12, v) for (a, b, ps), v in zip(allc, allv) if a >= 47.5 and a < 57.5]
    s, y = choir_line(desc_line, "a", vt="S", nv=6, attack=0.4, release=1.0, seed=1350, vib=14)
    tt = s + np.arange(y.shape[1]) / SR
    y *= smoothstep((tt - 47.5) / 2.0) * (1 - smoothstep((tt - 57.3) / 2.0))
    mix.add(s, y, 0.045, hall=0.8, cath=0.4)
    # organ doubling
    for i, ((a, b, ch), v) in enumerate(zip(allc, allv)):
        st = {"P8": 1.0, "P4": 0.7, "F8": 0.4, "P2": 0.4, "M1": 0.25, "M2": 0.2}
        if a >= 51:
            st.update({"P2": 0.55, "M1": 0.35, "M2": 0.3, "M3": 0.2, "T8": 0.25})
        bb = b if a < 57 else 58.6
        organ(mix, [(a, bb, ch, v)], st, 0.32, pedal={"P16": 1.0, "B16": 0.8, "P8": 0.4},
              hall=0.55, cath=0.35, seed=1400 + i, gap=0.05)
    # strings: violins double soprano, lower strings bass
    for i, ((a, b, ch), v) in enumerate(zip(allc, allv)):
        bb = b if a < 57 else 58.8
        strings(mix, [(a, bb + 0.05, M(ch[3]), 0.6 * v), (a, bb + 0.05, M(ch[2]), 0.5 * v),
                      (a, bb + 0.05, M(ch[0]) - 12, 0.5 * v)], 0.06, attack=0.12,
                release=0.7 if a >= 57 else 0.3, hall=0.5, cath=0.2, bright=1.0)
    # timpani on phrase starts / cadences
    for tt, m, v in ((39.0, "D2", 0.55), (45.0, "D2", 0.6), (44.143, "A2", 0.45), (49.286, "D2", 0.6),
                     (51.0, "D2", 0.5), (55.5, "G2", 0.6), (57.0, "D2", 0.65)):
        mix.add(tt, timpani(m, v, 3.5, int(tt * 10)), 0.8, hall=0.25, cath=0.4)
    timp_roll(mix, "D2", 53.67, 55.48, 0.1, 0.65, 0.5, seed=1500, hall=0.3, cath=0.3)
    mix.add(53.9, reverse_swell(1.6, 1501, 2.5), 0.09, hall=0.4, cath=0.3)
    mix.add(55.5, cymbal(6.0, 2.4, 1502, 0.8), 0.12, hall=0.4, cath=0.6)

    # church bells from 45.0: distant peal (rounds) on D5 B4 A4 F#4 E4 D4
    peal = ms("D5 B4 A4 F#4 E4 D4")
    tt = 45.0
    k = 0
    near = bell("D4", 1.0, 10.0, 9.0, 1600, 0.9)
    mix.add(45.0, near, 0.22, pan=0.1, hall=0.5, cath=0.6)
    while tt < 55.0:
        m = peal[k % 6]
        b = bell(m, 0.8 + 0.2 * np.random.default_rng(k).uniform(), 7.0, 6.0, 1610 + k, 0.8)
        b = filt(butter("low", 3200), b)
        dist = 0.55 * smoothstep((tt - 45.0) / 1.5) * (1 - 0.6 * smoothstep((tt - 53.5) / 1.5))
        mix.add(tt, b, 0.16 * dist, pan=0.45 - 0.18 * (k % 6), hall=0.6, cath=0.5, dry=0.5)
        tt += 0.46
        k += 1
        if k % 6 == 0 and (k // 6) % 2 == 0:
            tt += 0.46                      # handstroke gap
    # 57.0 deep bell + 58.8 final ping
    mix.add(57.0, bell("D3", 1.0, 3.0, 7.0, 1700, 0.7), 0.55, hall=0.4, cath=0.5)
    mix.add(58.8, glass("D6", 1.0, 1.2, 1701), 0.55, hall=0.6, cath=0.3)

    print(f"  synthesis: {time.time() - t_start:.1f}s")
    return mix


def master(mix):
    t0 = time.time()
    hall_ir = make_ir([5.8, 5.2, 4.2, 2.8], 7.5, 42, 0.03)
    cath_ir = make_ir([8.5, 7.5, 6.0, 3.8], 10.0, 43, 0.05, 0.09)
    wet = 0.42 * convolve_bus(mix.hall, hall_ir) + 0.40 * convolve_bus(mix.cath, cath_ir)
    x = mix.dry + wet
    print(f"  reverb: {time.time() - t0:.1f}s")
    # gentle glue compression (RMS detector, slow)
    lvl = np.sqrt(onepole_lp((x ** 2).mean(axis=0), 1 / (2 * np.pi * 0.08)) + 1e-12)
    db = 20 * np.log10(lvl)
    thr = db.max() - 12.0
    gr = np.where(db > thr, (thr - db) * (1 - 1 / 2.2), 0.0)
    gr = onepole_lp(gr, 1 / (2 * np.pi * 0.15))
    x *= 10 ** (gr / 20)
    x = filt(butter("high", 22), x)
    # tone: tame the sub build-up (timpani/pedal/boom), add a little air
    x = x - (1 - 10 ** (-4.0 / 20)) * filt(butter("low", 85), x)
    x = x + (10 ** (3.0 / 20) - 1) * filt(butter("high", 3800), x)
    # final fade to complete silence at 60.0 and a clean start
    t = np.arange(N) / SR
    fade = 1.0 - smoothstep((t - 58.3) / 1.65)
    fade *= smoothstep(t / 0.05)
    x *= fade
    x *= 10 ** (-1.5 / 20) / np.abs(x).max()
    x[:, -int(0.02 * SR):] = 0.0
    return x.astype(np.float32)


def main():
    t0 = time.time()
    bad = check_parallels([c for _, c in PROC] + [CLIMAX], "proc") + \
        check_parallels(P1 + P2, "hymn") + check_parallels([P2[-1]] + [c for _, c in CODA], "coda")
    print("voice leading:", "clean (no parallel 5ths/8ves)" if not bad else bad)
    mix = render()
    x = master(mix)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wavfile.write(OUT, SR, x.T.copy())
    peak = 20 * np.log10(np.abs(x).max() + 1e-12)
    print(f"peak at {np.abs(x).max(axis=0).argmax() / SR:.2f}s")
    print(f"wrote {OUT}: {x.shape[1]} samples, {SR} Hz, stereo float32, peak {peak:.2f} dBFS, "
          f"{time.time() - t0:.1f}s")
    rms = [20 * np.log10(np.sqrt((x[:, i * SR:(i + 1) * SR].astype(np.float64) ** 2).mean()) + 1e-12)
           for i in range(60)]
    print("RMS dBFS per second:")
    for i in range(0, 60, 10):
        print("  " + " ".join(f"{i + j:2d}:{rms[i + j]:6.1f}" for j in range(10)))


if __name__ == "__main__":
    main()
