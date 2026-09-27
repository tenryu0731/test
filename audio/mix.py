#!/usr/bin/env python3
"""Final mix: music stem + SFX stem -> audio/mix.wav (48 kHz stereo, -16 LUFS, <= -1 dBTP).

Run from the repo root after music.py and sfx.py:  python3 audio/mix.py
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
SFX_DB = 0.0
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
    # gentle music ducking under the busiest SFX moments (storm, ignition)
    music = music * gain_env([(0, 0), (21.5, 0), (22.5, -2.5), (29.8, -2.5), (30.2, 0), (36.6, 0), (36.8, -1.5), (38.0, 0), (60, 0)])
    mix = music + sfx
    board = Pedalboard([Compressor(threshold_db=-20, ratio=1.8, attack_ms=25, release_ms=250)])
    mix = board(mix.T.copy(), SR).T
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mix)
    mix = mix * 10 ** ((TARGET_LUFS - lufs) / 20)
    lim = Pedalboard([Limiter(threshold_db=CEILING_DBTP - 1.2, release_ms=120)])
    mix = lim(mix.T.copy(), SR).T
    # final safety: scale so the 4x-oversampled true peak sits under the ceiling
    tp = true_peak(mix)
    if tp > CEILING_DBTP:
        mix *= 10 ** ((CEILING_DBTP - 0.05 - tp) / 20)
    # 20 ms fade at both ends, exact length
    f = int(0.02 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    mix = mix[:N].astype(np.float32)
    sf.write(os.path.join(HERE, "mix.wav"), mix, SR, subtype="PCM_24")
    print(f"mix: {meter.integrated_loudness(mix):.2f} LUFS, true peak {true_peak(mix):.2f} dBTP, {len(mix) / SR:.3f} s")


if __name__ == "__main__":
    main()
