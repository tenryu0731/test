// Full render: node render/render.js out.mp4 [workers] [fps]
// Renders frames in parallel Chromium pages (each frame is a pure function of t) and pipes JPEGs to ffmpeg.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'lumen/output/video_silent.mp4';
  const WORKERS = parseInt(process.argv[3] || '4', 10);
  const FPS = parseInt(process.argv[4] || '30', 10);
  const N = 60 * FPS;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-tune', 'film', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const browser = await chromium.launch();
  const pages = [];
  for (let w = 0; w < WORKERS; w++) {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await p.goto('file://' + path.resolve(__dirname, '../visuals/index.html'));
    await p.waitForFunction(() => window.FILM_READY === true, null, { timeout: 120000 });
    pages.push(p);
  }
  const results = new Map(); let next = 0, written = 0; const t0 = Date.now();
  const flush = async () => {
    while (results.has(written)) {
      const buf = results.get(written); results.delete(written);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      written++;
      if (written % 60 === 0) console.log(`frame ${written}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  };
  await Promise.all(pages.map(async (p) => {
    while (true) {
      const i = next++; if (i >= N) break;
      // keep memory bounded: don't run too far ahead of the writer
      while (i - written > WORKERS * 8) await new Promise((r) => setTimeout(r, 5));
      const data = await p.evaluate((t) => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.96); }, i / FPS);
      results.set(i, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
      await flush();
    }
  }));
  await flush();
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
})();
