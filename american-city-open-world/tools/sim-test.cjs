// 挙動の自動テスト（描画せずにシミュレーションだけ進める）
// 作品フォルダで python3 -m http.server 8780 を起動してから: node tools/sim-test.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8780/?q=low&autostart');
  await p.waitForFunction(() => window.__game && !document.getElementById('boot'), null, { timeout: 120000 });
  const r = await p.evaluate(() => {
    const g = window.__game, out = {}, car = () => g.player.car;
    const inside = (x, z) => g.all.length && window.__game.scene && false;
    const start = { x: car().pos.x, z: car().pos.z };
    g.simulate(6, { throttle: 1 });
    out.accel6s = { speed_mps: +car().speed.toFixed(1), dist: +Math.hypot(car().pos.x - start.x, car().pos.z - start.z).toFixed(1) };
    g.simulate(3, { throttle: -1 });
    out.brake3s = +car().speed.toFixed(2);
    // 右折して建物に突っ込む
    g.simulate(2, { throttle: 1, steer: 1 }); g.simulate(4, { throttle: 1 });
    out.afterWall = { x: +car().pos.x.toFixed(1), z: +car().pos.z.toFixed(1), speed: +car().speed.toFixed(1) };
    g.simulate(3, { throttle: -1 }); g.simulate(1);
    // 交通を 3 分進める
    const t0 = { ...g.traffic.stats };
    g.simulate(180, {}, 1 / 30);
    const ai = g.traffic.cars.filter((v) => v.mode === 'ai' && v.ai.active);
    out.traffic = { active: ai.length, moving: ai.filter((v) => v.ai.v > 1).length, turns: g.traffic.stats.turns - t0.turns, redRuns: g.traffic.stats.redRuns - t0.redRuns, respawns: g.traffic.stats.respawns - t0.respawns,
      maxDisp: +Math.max(...ai.map((v) => Math.hypot(v.ai.disp[0], v.ai.disp[1]))).toFixed(2) };
    // 降りる → 歩く → 近くの車に乗る
    g.simulate(0.1, { pressedOnce: ['enter'] });
    out.onFootAfterExit = g.player.onFoot;
    const p0 = { x: g.player.x, z: g.player.z };
    g.simulate(1.5, { moveY: 1 });
    out.walked = +Math.hypot(g.player.x - p0.x, g.player.z - p0.z).toFixed(2);
    g.simulate(1.5, { moveY: -1 });
    g.simulate(0.1, { pressedOnce: ['enter'] });
    out.reEntered = !g.player.onFoot;
    // AI の車を奪う: 降りて、走っている AI 車の横に移動して乗る
    const prevCar = g.player.car;
    g.simulate(0.1, { pressedOnce: ['enter'] });
    out.exit2 = g.player.onFoot;
    const target = g.traffic.cars.find((v) => v.mode === 'ai' && v.ai.active);
    g.player.x = target.pos.x + 2.2 * Math.cos(target.heading); g.player.z = target.pos.z - 2.2 * Math.sin(target.heading);
    g.simulate(0.05, { pressedOnce: ['enter'] });
    out.hijacked = !g.player.onFoot && g.player.car !== prevCar && !!g.player.car.ai && g.player.car.mode === 'player';
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('errors:', errs.filter((e) => !e.includes('GPU stall')).slice(0, 10));
  await b.close();
})();
