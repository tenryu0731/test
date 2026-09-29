// `?debug` overlay for render.js: FPS, CPU frame time (avg / worst), GPU time of the world / post /
// viewmodel passes (EXT_disjoint_timer_query_webgl2 when the browser exposes it), draw calls,
// triangles, shadow updates, pixel ratio and quality. Updated twice a second; no per-frame allocation.
export function createDebugOverlay(renderer) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:50;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;' +
    'color:#e8f0e0;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:4px;white-space:pre';
  document.body.appendChild(el);

  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const SECTIONS = ['world', 'post', 'view'];
  const gpu = { world: 0, post: 0, view: 0 }, gpuAcc = { world: 0, post: 0, view: 0 }, gpuN = { world: 0, post: 0, view: 0 };
  const pending = [];
  let active = null;
  function begin(name) {
    if (!ext || active) return;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    active = { q, name };
  }
  function end() {
    if (!active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(active);
    active = null;
  }
  function poll() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, name } = pending.shift();
      if (!disjoint) { gpuAcc[name] += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gpuN[name]++; }
      gl.deleteQuery(q);
    }
    if (pending.length > 30) { for (const p of pending) gl.deleteQuery(p.q); pending.length = 0; }
  }

  let frames = 0, acc = 0, worst = 0, cpuAcc = 0, last = performance.now(), shown = last;
  let calls = 0, tris = 0;
  function frame(cpuMs, info, extra) {
    const now = performance.now();
    const dt = now - last; last = now;
    frames++; acc += dt; worst = Math.max(worst, dt); cpuAcc += cpuMs;
    calls = info.render.calls; tris = info.render.triangles;
    poll();
    if (now - shown < 500) return;
    for (const s of SECTIONS) { if (gpuN[s]) gpu[s] = gpuAcc[s] / gpuN[s]; gpuAcc[s] = 0; gpuN[s] = 0; }
    const fps = (frames * 1000) / acc;
    el.textContent =
      `${fps.toFixed(0)} fps  ${(acc / frames).toFixed(1)} ms (max ${worst.toFixed(1)})\n` +
      `cpu render ${(cpuAcc / frames).toFixed(2)} ms\n` +
      (ext ? `gpu world ${gpu.world.toFixed(2)}  post ${gpu.post.toFixed(2)}  view ${gpu.view.toFixed(2)} ms\n` : 'gpu timer n/a\n') +
      `calls ${calls}  tris ${(tris / 1000).toFixed(0)}k\n` + extra();
    frames = 0; acc = 0; worst = 0; cpuAcc = 0; shown = now;
  }
  return { begin, end, frame, element: el, hasGpuTimer: !!ext };
}
