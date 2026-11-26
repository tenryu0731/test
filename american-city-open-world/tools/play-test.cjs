// 動作確認: node tools/play-test.cjs <outdir> [quality]
// 作品フォルダで python3 -m http.server 8780 を起動しておく
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.', q = process.argv[3] || 'medium';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.setDefaultTimeout(240000);
  const logs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await p.goto(`http://127.0.0.1:8780/?q=${q}&autostart&fps`);
  await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 300000 });
  console.log('boot ms', Date.now() - t0);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/t1-start.png' });
  await p.keyboard.down('KeyW'); await p.waitForTimeout(12000); await p.keyboard.up('KeyW');
  await p.screenshot({ path: out + '/t2-drive.png' });
  const st = await p.evaluate(() => { const g = window.__game; const c = g.player.car; return { x: c.pos.x, z: c.pos.z, speed: c.speed, ai: g.traffic.cars.filter(v => v.ai.active).length }; });
  console.log('state', JSON.stringify(st));
  await p.keyboard.press('KeyC'); await p.waitForTimeout(800); await p.screenshot({ path: out + '/t3-hood.png' }); await p.keyboard.press('KeyC');
  await p.keyboard.down('KeyS'); await p.waitForTimeout(2500); await p.keyboard.up('KeyS');
  await p.keyboard.press('KeyF'); await p.waitForTimeout(1200);
  await p.screenshot({ path: out + '/t4-foot.png' });
  console.log('onFoot', await p.evaluate(() => window.__game.player.onFoot));
  console.log(logs.slice(0, 20).join('\n'));
  await b.close();
})();
