// usage: node render/preview.js outdir t1 t2 ...   -> writes JPEG stills
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [out, ...ts] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('console', (m) => console.log('[page]', m.text()));
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto('file://' + path.resolve(__dirname, '../visuals/index.html'));
  await p.waitForFunction(() => window.FILM_READY === true, null, { timeout: 60000 });
  for (const t of ts) {
    const t0 = Date.now();
    const data = await p.evaluate((t) => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.9); }, parseFloat(t));
    fs.writeFileSync(path.join(out, `f_${parseFloat(t).toFixed(2)}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('t=' + t, (Date.now() - t0) + 'ms');
  }
  await b.close();
})();
