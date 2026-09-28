// Preview single frames: node lumen/render/preview.js outDir t1 t2 ...  (writes JPEGs, prints ms per frame)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  const ts = process.argv.slice(3).map(Number);
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', (e) => console.error('[pageerror]', e.message));
  p.on('console', (m) => console.log('[console]', m.text()));
  const t0 = Date.now();
  await p.goto('file://' + path.resolve(__dirname, '../visuals/index.html'));
  await p.waitForFunction(() => window.FILM_READY === true, null, { timeout: 120000 });
  console.log('ready in', Date.now() - t0, 'ms');
  for (const t of ts) {
    const s = Date.now();
    const data = await p.evaluate((t) => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.9); }, t);
    fs.writeFileSync(path.join(out, `f_${t.toFixed(2).padStart(5, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('t=', t, Date.now() - s, 'ms');
  }
  await browser.close();
})();
