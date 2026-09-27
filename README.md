# LAST LIGHT

A 60-second wordless 2D animated short. Every frame, note and sound is generated from code;
there are no image, video or audio assets.

![Last Light](output/poster.jpg)

**Watch:** [`output/last_light.mp4`](output/last_light.mp4) (1920×1080, 30 fps, H.264 + AAC stereo)

## Story
The stars are going out one by one. The last one falls into a grey, dead desert.
A small round creature, Pip, finds it, shields it through a sandstorm, and breathes on it when it is about to go out.
The star becomes a seed. A tree of light grows from it, the desert turns into a meadow,
and the tree's blossoms rise into the sky and become new stars. At the end the first star comes back and twinkles at Pip.

Scene timings are in [`story/storyboard.md`](story/storyboard.md). The picture and all audio were built to the same timeline.

## How it is made
| Part | File | Technique |
|---|---|---|
| Picture | `visuals/film.js`, `visuals/lib.js` | HTML5 Canvas 2D. Each frame is a pure function of time t (random access, so rendering can run in parallel). Parallax camera over 6 depth layers, simplex/fBm noise textures (nebula, galaxy band, smoke), a separate emissive layer with a 4-level bloom, procedural L-system tree growth with forward kinematics, analytic particle systems (about 10k particles), squash-and-stretch character rig, clipped "life-front" colour transition, film grain and vignette |
| Render | `render/render.js` | Headless Chromium (Playwright), 4 parallel pages → JPEG → ffmpeg/libx264 |
| Music | `audio/music.py` | Synthesised score with numpy/scipy (additive, FM, subtractive and physical-model synthesis, reverb) |
| Sound effects | `audio/sfx.py` | Procedural Foley and ambience (modal glass/bell synthesis, filtered noise, granular sparkles, synthetic convolution reverb) |
| Mix | `audio/mix.py` | Stem sum, light bus compression, loudness normalisation to about -14 LUFS, true-peak limit at -1 dBTP |

## Rebuild
```bash
pip install numpy scipy soundfile pyloudnorm pedalboard imageio-ffmpeg   # ffmpeg with libx264 must be on PATH
python3 audio/music.py && python3 audio/sfx.py && python3 audio/mix.py
node render/render.js output/video_silent.mp4 4 30                       # needs playwright + chromium
ffmpeg -i output/video_silent.mp4 -i audio/mix.wav -c:v copy -c:a aac -b:a 256k -shortest output/last_light.mp4
```
Preview single frames: `node render/preview.js /tmp/out 12.5 37 57`
