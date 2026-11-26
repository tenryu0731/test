// Usage (作品フォルダで): python3 -m http.server 8765 &  →  node tools/shot.cjs out.png <all|k|y|p>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', e => console.log('err:', e.message));
  await p.goto('http://127.0.0.1:8765/tools/scale.html?v=' + (process.argv[3] || 'all'));
  await p.waitForFunction('window.DONE === true', null, { timeout: 120000 });
  await p.screenshot({ path: process.argv[2] });
  await b.close();
})();
