#!/usr/bin/env python3
"""Final mix: music stem + SFX stem -> lumen/audio/mix.wav (48 kHz stereo, about -16 LUFS, <= -1 dBTP).

Run from the repo root after music.py and sfx.py:  python3 lumen/audio/mix.py
"""
import os

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pedalboard import Compressor, Limiter, Pedalboard
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48_000
N = 2_880_000
MUSIC_DB = 0.0
SFX_DB = -2.0
TARGET_LUFS = -16.0
CEILING_DBTP = -1.0


def load(name):
    x, sr = sf.read(os.path.join(HERE, "stems", name), dtype="float32", always_2d=True)
    assert sr == SR and x.shape == (N, 2), (name, sr, x.shape)
    return x


def gain_env(points):
    """piecewise-linear gain curve in dB from [(t, dB), ...]"""
    t = np.arange(N) / SR
    ts, ds = zip(*points)
    return (10 ** (np.interp(t, ts, ds) / 20)).astype(np.float32)[:, None]


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def main():
    music = load("music.wav") * 10 ** (MUSIC_DB / 20)
    sfx = load("sfx.wav") * 10 ** (SFX_DB / 20)
    # the music leads; duck it slightly under the close thunder, and the SFX under the two tutti hits
    music = music * gain_env([(0, 0), (14.3, 0), (14.5, -2.0), (15.6, 0), (60, 0)])
    sfx = sfx * gain_env([(0, 0), (3.1, 0), (3.2, -3.0), (5.0, 0), (37.8, 0), (38.0, -3.0), (40.5, -1.0), (60, 0)])
    mix = music + sfx
    board = Pedalboard([Compressor(threshold_db=-20, ratio=1.7, attack_ms=30, release_ms=300)])
    mix = board(mix.T.copy(), SR).T
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mix)
    mix = mix * 10 ** ((TARGET_LUFS - lufs) / 20)
    lim = Pedalboard([Limiter(threshold_db=CEILING_DBTP - 1.2, release_ms=120)])
    mix = lim(mix.T.copy(), SR).T
    tp = true_peak(mix)
    if tp > CEILING_DBTP:
        mix *= 10 ** ((CEILING_DBTP - 0.05 - tp) / 20)
    f = int(0.02 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    mix = mix[:N].astype(np.float32)
    sf.write(os.path.join(HERE, "mix.wav"), mix, SR, subtype="PCM_24")
    print(f"mix: {meter.integrated_loudness(mix):.2f} LUFS, true peak {true_peak(mix):.2f} dBTP, {len(mix) / SR:.3f} s")


if __name__ == "__main__":
    main()
