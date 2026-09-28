'use strict';
// ============================================================
//  LUMEN — picture. Every frame is a pure function of time t,
//  so frames can be rendered in any order / in parallel.
//  Timeline: see ../story/storyboard.md
// ============================================================
const cv = document.getElementById('c');
const X = cv.getContext('2d');
const [G, gx] = makeCanvas(W / 2, H / 2); // emissive layer (half res) -> bloom
const [B1, b1] = makeCanvas(W / 4, H / 4);
const [B2, b2] = makeCanvas(W / 8, H / 8);
const [B3, b3] = makeCanvas(W / 16, H / 16);
const [F, fx] = makeCanvas(760, 760); // figure buffer (for light tinting)
const FO = [380, 560];
const [T1, t1] = makeCanvas(W, H); // scratch

const XC = 850; // the centre cross (world x)
const TS = 0.95; // traveller scale
const CY0 = -250;
const TX = XC + 250; // tomb
const A = {};
let CAM = { x: 0, y: 0, z: 1 };

// ------------------------------------------------------------ world shape
function ground(x) {
  return -360 * Math.exp(-Math.pow((x - XC) / 380, 2)) - 50 * Math.exp(-Math.pow((x - XC - 460) / 260, 2))
    + 9 * N1(x * 0.004, 1.3) + 4 * N1(x * 0.017, 4.1);
}
const farY = (x) => -30 - 300 * (0.5 + 0.5 * fbm(N4, x * 0.0011, 2.3, 5));
const midY = (x) => -10 - 170 * (0.5 + 0.5 * fbm(N3, x * 0.0016, 8.1, 4));
const slopeAt = (x) => Math.atan2(ground(x + 12) - ground(x - 12), 24);

// ------------------------------------------------------------ helpers
function setLayer(ctx, p, k = 1) {
  const z = lerp(1, CAM.z, p), cx = CAM.x * p, cy = CY0 + (CAM.y - CY0) * p;
  ctx.setTransform(z * k, 0, 0, z * k, (W / 2 - cx * z) * k, (H / 2 - cy * z) * k);
  return { z, cx, cy, xl: cx - W / 2 / z, xr: cx + W / 2 / z, yt: cy - H / 2 / z, yb: cy + H / 2 / z };
}
const ws = (x, y) => [(x - CAM.x) * CAM.z + W / 2, (y - CAM.y) * CAM.z + H / 2];
const screenG = () => gx.setTransform(0.5, 0, 0, 0.5, 0, 0);
const screenX = () => X.setTransform(1, 0, 0, 1, 0, 0);

function glowDot(ctx, x, y, r, c, a) {
  if (a <= 0.003 || r <= 0.5) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a)); g.addColorStop(0.25, rgba(c, a * 0.45)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function ring(ctx, x, y, r, w, c, a) {
  if (a <= 0.003 || r <= 0) return;
  ctx.strokeStyle = rgba(c, a); ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}
// light spikes in the shape of a (Latin) cross
function crossSpikes(ctx, x, y, L, a, c = [255, 246, 225], w = 3) {
  if (a <= 0.003) return;
  const sp = (dx, dy) => {
    const g = ctx.createLinearGradient(x, y, x + dx, y + dy);
    g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
    ctx.strokeStyle = g; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  };
  sp(0, -L * 0.8); sp(0, L * 1.35); sp(-L * 0.62, 0); sp(L * 0.62, 0);
}
function rays(ctx, x, y, n, len, rot, a, c = [255, 232, 185], wid = 0.05) {
  if (a <= 0.003) return;
  for (let i = 0; i < n; i++) {
    const an = rot + (i / n) * TAU + 0.3 * Math.sin(i * 12.9898);
    const l = len * (0.55 + 0.45 * hash(i * 3.7));
    const ww = wid * (0.5 + hash(i * 1.3));
    const g = ctx.createRadialGradient(x, y, 0, x, y, l);
    const ai = a * (0.4 + 0.6 * hash(i * 9.1));
    g.addColorStop(0, rgba(c, ai)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(an - ww) * l, y + Math.sin(an - ww) * l);
    ctx.lineTo(x + Math.cos(an + ww) * l, y + Math.sin(an + ww) * l); ctx.closePath(); ctx.fill();
  }
}

// ------------------------------------------------------------ assets
function tintSprite(src, top, bot) {
  const [c, x] = makeCanvas(src.width, src.height);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  const g = x.createLinearGradient(0, 0, 0, src.height);
  g.addColorStop(0, rgba(top)); g.addColorStop(1, rgba(bot));
  x.fillStyle = g; x.fillRect(0, 0, src.width, src.height);
  return c;
}
function buildPuffs() {
  const S = 256; A.puff = [];
  for (let v = 0; v < 4; v++) {
    const [c, x] = makeCanvas(S, S);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = (i - S / 2) / (S / 2), w = (j - S / 2) / (S / 2);
      const d = Math.sqrt(u * u + w * w * 1.9);
      const n = fbm(N2, i * 0.016 + v * 17.3, j * 0.016 + v * 5.1, 5);
      let a = smooth((1 - d + n * 0.75 + 0.08) * 1.5);
      a *= smooth((1 - d) * 3);
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0);
    A.puff.push(c);
  }
  const T = (a, b) => A.puff.map((p) => tintSprite(p, hex(a), hex(b)));
  A.pStorm = T('#394154', '#10131b');
  A.pLit = T('#cfd8ef', '#5c6682');
  A.pDawn = T('#fff1dc', '#c98f98');
  A.pWhite = T('#e2e6f0', '#8a90a6');
}
function buildNebula() {
  const w = 480, h = 270; const [c, x] = makeCanvas(w, h); const img = x.createImageData(w, h);
  const ramp = [[0, [3, 3, 12]], [0.3, [24, 16, 64]], [0.5, [72, 34, 118]], [0.68, [168, 70, 128]], [0.84, [240, 158, 112]], [1, [255, 236, 200]]];
  const col = (v) => { v = clamp(v); for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) return mix3(ramp[i - 1][1], ramp[i][1], (v - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0])); return ramp[ramp.length - 1][1]; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = ((i - w / 2) / h) * 1.6, v = ((j - h / 2) / h) * 1.6;
    const q = fbm(N1, u * 0.8 + 3.1, v * 0.8 + 1.7, 3);
    const d = fbm(N3, u + 0.45 * q, v + 0.45 * q, 6, 2.1, 0.55);
    const band = Math.exp(-Math.pow(v * 1.3 - u * 0.45 + 0.15 * q, 2) * 3.0);
    const core = Math.exp(-(u * u + v * v) * 1.4);
    const dens = clamp(0.5 + d * 0.9) * (0.25 + 0.75 * band) + 0.35 * core;
    const dust = smooth(clamp(fbm(N4, u * 2.2, v * 2.2, 4) * 2 + 0.2)) * band * 0.45; // dark lanes
    let c3 = col(dens * 0.95 - dust * 0.3);
    c3 = mix3(c3, [60, 120, 200], clamp(-q * 1.6) * 0.35 * band);
    const k = (j * w + i) * 4;
    img.data[k] = c3[0]; img.data[k + 1] = c3[1]; img.data[k + 2] = c3[2]; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const [c2, x2] = makeCanvas(960, 540);
  x2.filter = 'blur(1.5px)'; x2.drawImage(c, 0, 0, 960, 540);
  A.neb = c2;
}
function buildStars() {
  const r = rng(5); A.stars = [];
  for (let i = 0; i < 1700; i++) A.stars.push({ a: r() * TAU, d: 0.02 + Math.pow(r(), 0.6), z: r(), s: 0.6 + Math.pow(r(), 7) * 3.2, c: (r() * 3) | 0, x: r(), y: r(), tw: r() * TAU });
}
function buildGrain() {
  A.grain = [];
  for (let gi = 0; gi < 4; gi++) {
    const [c, x] = makeCanvas(256, 256); const img = x.createImageData(256, 256); const r = rng(100 + gi);
    for (let k = 0; k < img.data.length; k += 4) { const v = 128 + (r() + r() + r() - 1.5) * 110; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
    x.putImageData(img, 0, 0);
    A.grain.push(X.createPattern(c, 'repeat'));
  }
}
const TREES = [
  { x: -1260, s: 1.1, seed: 31 }, { x: -650, s: 1.3, seed: 3 }, { x: -390, s: 0.72, seed: 7 },
  { x: 300, s: 1.0, seed: 12 }, { x: 1480, s: 1.2, seed: 19 }, { x: 1980, s: 0.9, seed: 23 }, { x: 2560, s: 1.25, seed: 41 },
];
function buildTrees() {
  for (const tr of TREES) {
    const r = rng(tr.seed); const segs = [], tips = [];
    const br = (x, y, a, len, w, d) => {
      const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len;
      segs.push([x, y, x2, y2, w]);
      if (d === 0 || len < 7) { tips.push([x2, y2]); return; }
      const n = r() < 0.3 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const sp = 0.32 + r() * 0.38;
        const na = a + (n === 2 ? (i ? sp : -sp) : (i - 1) * sp) + (r() - 0.5) * 0.35 - a * 0.1;
        br(x2, y2, na, len * (0.66 + r() * 0.14), w * 0.64, d - 1);
      }
      if (d < 3) tips.push([x2, y2]);
    };
    br(0, 4, (r() - 0.5) * 0.25, 92, 15, 6);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
    x0 -= 12; y0 -= 12; x1 += 12; y1 += 12;
    const K = 1.8;
    const [c, x] = makeCanvas(Math.ceil((x1 - x0) * K), Math.ceil((y1 - y0) * K));
    x.setTransform(K, 0, 0, K, -x0 * K, -y0 * K); x.lineCap = 'round'; x.strokeStyle = '#fff';
    for (const s of segs) { x.lineWidth = s[4]; x.beginPath(); x.moveTo(s[0], s[1]); x.lineTo(s[2], s[3]); x.stroke(); }
    tr.bb = [x0, y0, x1 - x0, y1 - y0];
    tr.storm = tintSprite(c, [9, 10, 14], [6, 7, 10]);
    tr.dawn = tintSprite(c, [58, 44, 44], [30, 30, 26]);
    tr.tips = tips.map((p) => [p[0], p[1], r(), r(), r()]);
  }
}
function buildField() {
  const r = rng(77); A.grass = [];
  for (let x = -2700; x < 3700; x += 4.5 + r() * 4) A.grass.push({ x, h0: 5 + r() * 9, h1: 16 + r() * 30, l: (r() - 0.5) * 0.4, ph: r() * TAU, d: r() });
  A.flowers = [];
  const FC = [[252, 250, 242], [255, 206, 84], [214, 44, 66], [160, 118, 228], [255, 240, 248]];
  for (let i = 0; i < 360; i++) {
    const x = -2000 + r() * 5200;
    if (Math.abs(x - XC) < 60 || Math.abs(x - TX) < 90) continue;
    A.flowers.push({ x, h: 12 + r() * 26, c: FC[(r() * FC.length) | 0], s: 2.4 + r() * 3.4, d: r(), l: (r() - 0.5) * 0.3 });
  }
}
function buildCast() {
  const r = rng(99); A.bearers = [];
  const L = [], R = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const b = { dir: -side, x0: side < 0 ? -700 - r() * 480 : 2440 + r() * 480, sp: 95 + r() * 35, s: 0.7 + r() * 0.2, ph: r() * TAU, t0: 42.3 + r() * 1.2, i };
    (side < 0 ? L : R).push(b);
  }
  L.sort((a, b) => b.x0 - a.x0); R.sort((a, b) => a.x0 - b.x0);
  L.forEach((b, k) => { b.stop = 640 - k * 62; });
  R.forEach((b, k) => { b.stop = 1190 + k * 66; });
  A.bearers = L.concat(R);
  for (const b of A.bearers) {
    const edge = b.dir > 0 ? -640 : 2360;
    const tEnter = b.t0 + Math.max(0, (edge - b.x0) * b.dir) / b.sp;
    b.ti = clamp(tEnter + 0.35, 43.4, 48.5);
  }
  A.flock = [];
  for (let i = 0; i < 19; i++) A.flock.push({ y0: 200 + r() * 230, x0: -260 - r() * 700, sp: 520 + r() * 160, s: 0.45 + r() * 0.5, ph: r() * TAU });
  A.far = [];
  for (let i = 0; i < 26; i++) { const side = i % 2 ? 1 : -1; A.far.push({ x0: (side < 0 ? -900 : 1500) + (r() - 0.5) * 600, dir: -side, sp: 22 + r() * 18, t0: 43.5 + r() * 3 }); }
  A.clouds = [];
  for (let i = 0; i < 74; i++) A.clouds.push({ x0: r() * 4400, y: -1080 + r() * 720, s: 380 + r() * 420, v: (r() * 4) | 0, sp: 0.8 + r() * 0.5 });
}

// ------------------------------------------------------------ global state
const dawnAt = (t) => smooth(inv(38.2, 41.5, t));
const waveR = (t) => (t < 38.1 ? -1 : eout(inv(38.1, 42.2, t)) * 3600);
function arriveT(x) { // time at which the wave of new life reaches world x (inverse of waveR)
  const d = clamp(Math.abs(x - XC) / 3600);
  return 38.1 + (1 - Math.cbrt(1 - d)) * 4.1;
}
const STRIKES = [
  { t: 10.8, amp: 0.55, p: 0.25, x: 350, y0: -950, y1: -150, seed: 1 },
  { t: 12.9, amp: 0.22 },
  { t: 14.2, amp: 1.0, p: 1, x: 300, y0: -1300, y1: null, seed: 2 },
  { t: 33.6, amp: 0.25 },
  { t: 36.2, amp: 0.8, p: 0.25, x: -150, y0: -1050, y1: -190, seed: 3 },
  { t: 37.3, amp: 0.35 },
];
function lightning(t) {
  let s = 0;
  for (const k of STRIKES) s += k.amp * (hit(t, k.t, 0.1) + 0.7 * hit(t, k.t + 0.11, 0.07) + 0.5 * hit(t, k.t + 0.24, 0.12));
  return Math.min(1.4, s);
}
function rainAt(t) {
  if (t >= 38) return 0;
  return smooth(inv(8.0, 9.2, t)) * track1([[19, 1], [19.8, 0.55], [21.5, 0.55, 'l'], [22.5, 0.45], [29.5, 0.55], [30.5, 0.5], [35.5, 0.6, 'l'], [37.5, 1.0]], t);
}
const windAt = (t) => (t < 38 ? 1 + 0.9 * bump(t, 15.2, 15.7, 16.1, 16.6) + 0.5 * bump(t, 35.8, 36.6, 37.6, 38.0) : 0.12);
const blazeAt = (t) => hit(t, 38.0, 1.1, 0.25);

// ------------------------------------------------------------ the traveller
function travX(t) {
  if (t < 29.2) return track1([[9, -900], [15.5, -282, 'l'], [16.4, -262, 'io'], [17.0, -208, 'i2'], [17.7, -178, 'o']], t);
  return track1([[29.2, -178], [30.4, -150, 'i2'], [35.7, 782, 'l'], [36.1, 790, 'o']], t);
}
function travPose(t) {
  const x = travX(t);
  const q = { x };
  if (t < 29) {
    q.ph = (TAU * (t - 9.3)) / 1.1 + Math.PI / 2;
    q.w = (1 - smooth(inv(17.0, 17.7, t))) * (1 - 0.5 * bump(t, 15.45, 15.6, 16.2, 16.5));
  } else {
    q.ph = (TAU * (t - 30.0)) / 1.2 + Math.PI / 2;
    q.w = smooth(inv(29.8, 30.4, t)) * (1 - smooth(inv(35.5, 36.0, t)));
  }
  q.k = track1([[17.6, 0], [18.05, 1, 'i2'], [29.2, 1, 'l'], [29.9, 0, 'io'], [35.8, 0, 'l'], [36.3, 1, 'io'], [47.2, 1, 'l'], [47.9, 0, 'io']], t);
  q.b = track1([[17.6, 0], [18.1, 0.9], [19.4, 1.0], [20.6, 0.45], [25.3, 0.45, 'l'], [26.2, -0.15], [28.6, -0.05], [29.4, 0.05], [35.8, 0.05, 'l'], [36.4, 0.75], [37.8, 0.8, 'l'], [38.4, -0.35, 'o'], [46.9, -0.25], [47.8, 0.0], [51, -0.1]], t);
  q.pray = track1([[19.4, 0], [20.7, 1], [25.4, 1, 'l'], [26.3, 0]], t);
  q.placed = track1([[17.75, 0], [18.1, 1], [29.25, 1, 'l'], [29.7, 0], [35.95, 0, 'l'], [36.25, 1], [47.35, 1, 'l'], [47.9, 0]], t);
  q.hold = 1 - q.placed;
  q.tc = track1([[36.4, 0], [37.1, 1], [38.0, 1, 'l'], [39.2, 0]], t);
  q.r = track1([[48.0, 0], [49.3, 1]], t);
  q.lean = (t < 29 ? 0.1 : 0.05) - 0.3 * bump(t, 15.45, 15.65, 16.0, 16.5) + 0.06 * Math.sin(t * 1.7) * (t < 17.5 ? 1 : 0);
  q.slope = -slopeAt(x) * q.w;
  q.wind = windAt(t);
  q.s = TS; q.dir = 1;
  return q;
}

function rig(q, t) {
  const w = q.w, s = Math.sin(q.ph), c = Math.cos(q.ph);
  let thF = 0.42 * s * w, knF = -(0.1 + 0.8 * Math.pow(Math.max(0, c), 2)) * w;
  let thB = -0.42 * s * w, knB = -(0.1 + 0.8 * Math.pow(Math.max(0, -c), 2)) * w;
  thF = lerp(thF, 0.12, q.k); knF = lerp(knF, -1.62, q.k);
  thB = lerp(thB, -0.05, q.k); knB = lerp(knB, -1.56, q.k);
  const bp = Math.max(q.b, 0), bn = Math.max(-q.b, 0);
  const tor = 0.03 + 0.08 * w + q.lean + 0.45 * bp - 0.12 * bn + q.slope * 0.45;
  const hd = 0.1 + 0.55 * q.b;
  let aB = 0.08 - 0.4 * s * w, eB = 0.25 + 0.15 * w;
  let aF = lerp(0.14, 0.6, w), eF = lerp(0.3, 0.55, w);
  aF = lerp(0.08 + 0.4 * s * w, aF, q.hold); eF = lerp(0.25, eF, q.hold);
  aF = lerp(aF, 0.85, q.pray); eF = lerp(eF, 1.55, q.pray);
  aB = lerp(aB, 0.76, q.pray); eB = lerp(eB, 1.62, q.pray);
  aF = lerp(aF, 1.42, q.tc); eF = lerp(eF, 0.2, q.tc);
  aF = lerp(aF, 2.72, q.r); eF = lerp(eF, 0.06, q.r);
  aB = lerp(aB, lerp(aB, 0.3, q.r), 1);
  aF += tor * 0.35 * (1 - q.pray); aB += tor * 0.35 * (1 - q.pray);
  const TH = 50, SH = 48, TOR = 62, UA = 33, FA = 31;
  const leg = (th, kn) => { const kx = Math.sin(th) * TH, ky = Math.cos(th) * TH; return [kx, ky, kx + Math.sin(th + kn) * SH, ky + Math.cos(th + kn) * SH]; };
  const lf = leg(thF, knF), lb = leg(thB, knB);
  const low = Math.max(lf[1], lf[3], lb[1], lb[3]);
  const hip = [0, -low];
  const P = (v) => [hip[0] + v[0], hip[1] + v[1]];
  const R = { hip, tor, hd };
  R.kF = P([lf[0], lf[1]]); R.fF = P([lf[2], lf[3]]); R.kB = P([lb[0], lb[1]]); R.fB = P([lb[2], lb[3]]);
  const u = [Math.sin(tor), -Math.cos(tor)], f = [Math.cos(tor), Math.sin(tor)];
  R.u = u; R.f = f;
  R.neck = [hip[0] + u[0] * TOR, hip[1] + u[1] * TOR];
  R.sh = [hip[0] + u[0] * (TOR - 8) + f[0] * 2, hip[1] + u[1] * (TOR - 8) + f[1] * 2];
  const ha = tor + hd;
  R.head = [R.neck[0] + Math.sin(ha) * 14 + f[0] * 2, R.neck[1] - Math.cos(ha) * 14 + f[1] * 2];
  R.ha = ha;
  const arm = (a, e) => { const el = [R.sh[0] + Math.sin(a) * UA, R.sh[1] + Math.cos(a) * UA]; return [el, [el[0] + Math.sin(a + e) * FA, el[1] + Math.cos(a + e) * FA]]; };
  [R.eF, R.hF] = arm(aF, eF); [R.eB, R.hB] = arm(aB, eB);
  R.fl = q.wind * (0.6 + 0.4 * N3(t * 2.3 + q.x * 0.01, 0.7));
  R.k = q.k;
  return R;
}

function drawRig(ctx, R, col, t) {
  ctx.fillStyle = ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (a, b, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  // back limbs
  seg(R.hip, R.kB, 15); seg(R.kB, R.fB, 12); seg(R.fB, [R.fB[0] + 9, R.fB[1] - 1], 7);
  seg(R.sh, R.eB, 10); seg(R.eB, R.hB, 9);
  // cloak
  const { hip, neck, u, f, fl, k } = R;
  const hemY = Math.min(-1, hip[1] + 80);
  const P1 = [neck[0] - f[0] * 11 - u[0] * 2, neck[1] - f[1] * 11 - u[1] * 2];
  const P2 = [hip[0] - 17, hip[1] + 2];
  const backX = Math.min(hip[0] - 24 - fl * 16, lerp(hip[0] - 24, Math.min(R.fB[0], R.fF[0]) - 10, k));
  const P3 = [backX, hemY - fl * 5];
  const P4 = [Math.max(R.kF[0], R.kB[0], hip[0] + 10) + 10 - fl * 3, hemY - 2];
  const P5 = [hip[0] + f[0] * 15, hip[1] + f[1] * 15];
  const P6 = [neck[0] + f[0] * 10 - u[0] * 6, neck[1] + f[1] * 10 - u[1] * 6];
  const wv = Math.sin(t * 7.3) * fl * 3;
  ctx.beginPath(); ctx.moveTo(P1[0], P1[1]);
  ctx.quadraticCurveTo(P2[0] - 6, (P1[1] + P2[1]) / 2, P2[0], P2[1]);
  ctx.quadraticCurveTo(P2[0] - 8 - fl * 12, (P2[1] + P3[1]) / 2 + wv, P3[0], P3[1]);
  ctx.quadraticCurveTo((P3[0] + P4[0]) / 2, hemY + 5 + wv, P4[0], P4[1]);
  ctx.quadraticCurveTo(P5[0] + 6, (P5[1] + P4[1]) / 2, P5[0], P5[1]);
  ctx.quadraticCurveTo(P6[0] + 5, (P5[1] + P6[1]) / 2, P6[0], P6[1]);
  ctx.closePath(); ctx.fill();
  // front leg
  seg(R.hip, R.kF, 15); seg(R.kF, R.fF, 12); seg(R.fF, [R.fF[0] + 9, R.fF[1] - 1], 7);
  // hood
  const h = R.head, a = R.ha;
  const rot = (x, y) => [h[0] + x * Math.cos(a) - y * Math.sin(a), h[1] + x * Math.sin(a) + y * Math.cos(a)];
  ctx.beginPath(); ctx.arc(h[0], h[1], 14.5, 0, TAU); ctx.fill();
  const t1p = rot(-12, -9), t2p = rot(-24 - fl * 6, 6 + fl * 2), t3p = rot(-10, 14);
  ctx.beginPath(); ctx.moveTo(t1p[0], t1p[1]); ctx.quadraticCurveTo(t2p[0] + 4, t2p[1] - 10, t2p[0], t2p[1]); ctx.lineTo(t3p[0], t3p[1]); ctx.closePath(); ctx.fill();
  const fc = rot(10, 7);
  ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(fc[0], fc[1]); ctx.lineTo(P6[0], P6[1]); ctx.closePath(); ctx.fill();
  // front arm
  seg(R.sh, R.eF, 10.5); seg(R.eF, R.hF, 9.5);
  ctx.beginPath(); ctx.arc(R.hF[0], R.hF[1], 5, 0, TAU); ctx.fill();
}

function drawLantern(ctx, x, y, ang, L, sc) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(sc, sc);
  const dark = '#0d0b0a';
  ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 5, 4.5, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(4, 4); ctx.lineTo(10, 11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(mix3([26, 22, 20], [255, 206, 128], clamp(L)));
  ctx.fillRect(-8, 11, 16, 20);
  if (L > 0.02) {
    ctx.fillStyle = rgba([255, 252, 232], clamp(L));
    ctx.beginPath(); ctx.ellipse(0, 22, 2.6, 5.6, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = dark; ctx.fillRect(-9.5, 11, 2.4, 20); ctx.fillRect(7.1, 11, 2.4, 20);
  ctx.fillRect(-10.5, 30, 21, 5);
  ctx.restore();
}
function lanternLight(t) {
  const fl = 0.88 + 0.12 * N2(t * 6, 3.3);
  if (t < 17.0) return fl;
  if (t < 17.45) { const u = inv(17.0, 17.45, t); return (1 - u * u) * (N2(t * 45, 1.1) > -0.15 ? 1 : 0.15) * fl; }
  if (t < 25.0) return 0;
  return fl * (1 + 1.2 * hit(t, 25.0, 0.4, 0.06)) * (1 + 0.35 * smooth(inv(48, 49.5, t)));
}

// the traveller + lantern, rendered through a buffer so light can be painted onto him
function drawTraveller(t, info) {
  const q = travPose(t); const R = rig(q, t);
  const gy = ground(q.x);
  const s = q.s, z = CAM.z;
  // lantern position (world)
  const hand = [q.x + R.hF[0] * s, gy + R.hF[1] * s];
  const g1 = [-178 + 44 * s, 0], g2 = [790 - 40 * s, 0];
  const gp = t < 33 ? g1 : g2; gp[1] = ground(gp[0]) - 36 * s;
  const u = smooth(q.placed);
  const lx = lerp(hand[0], gp[0], u), ly = lerp(hand[1], gp[1], u);
  const swing = (0.3 * Math.sin(q.ph - 0.7) * q.w + 0.12 * q.wind * N1(t * 1.3, 2)) * (1 - u) * (1 - q.r);
  const L = lanternLight(t);
  info.lantern = [lx - Math.sin(swing) * 21 * s * 1.05, ly + Math.cos(swing) * 21 * s * 1.05, L];
  info.trav = q; info.travR = R; info.gy = gy;

  // figure into buffer
  fx.setTransform(1, 0, 0, 1, 0, 0); fx.globalCompositeOperation = 'source-over'; fx.clearRect(0, 0, F.width, F.height);
  fx.setTransform(z * s, 0, 0, z * s, FO[0], FO[1]);
  const dn = dawnAt(t);
  drawRig(fx, R, rgba(mix3([11, 12, 17], [26, 22, 26], dn)), t);
  fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.globalCompositeOperation = 'source-atop';
  const Lx = FO[0] + (info.lantern[0] - q.x) * z, Ly = FO[1] + (info.lantern[1] - gy) * z;
  if (L > 0.01) glowDot(fx, Lx, Ly, 150 * z * s, [255, 150, 70], 0.42 * Math.min(L, 1.4));
  const ray = rayAt(t);
  if (ray > 0) { const g = fx.createLinearGradient(0, FO[1] - 260 * z, 0, FO[1]); g.addColorStop(0, rgba([255, 236, 196], 0.22 * ray)); g.addColorStop(1, rgba([255, 236, 196], 0.03 * ray)); fx.fillStyle = g; fx.fillRect(0, 0, F.width, F.height); }
  const lf = info.lf;
  // faint cool ambient so the silhouette still reads in the dark
  fx.fillStyle = rgba([118, 132, 172], 0.1 * (1 - dn)); fx.fillRect(0, 0, F.width, F.height);
  if (lf > 0) { fx.fillStyle = rgba([150, 170, 215], 0.3 * lf); fx.fillRect(0, 0, F.width, F.height); }
  const bl = blazeAt(t);
  if (dn > 0 || bl > 0) {
    const g = fx.createLinearGradient(FO[0] + 120 * z, 0, FO[0] - 60 * z, 0);
    g.addColorStop(0, rgba([255, 214, 150], 0.45 * dn + 0.9 * bl)); g.addColorStop(1, rgba([255, 214, 150], 0.05 * dn));
    fx.fillStyle = g; fx.fillRect(0, 0, F.width, F.height);
  }
  fx.globalCompositeOperation = 'source-over';
  const [sx, sy] = ws(q.x, gy);
  screenX(); X.drawImage(F, sx - FO[0], sy - FO[1]);

  // lantern
  setLayer(X, 1);
  drawLantern(X, lx, ly, swing, L, s * 1.05);
  setLayer(gx, 1, 0.5);
  const [gxw, gyw] = info.lantern;
  if (L > 0.01) {
    glowDot(gx, gxw, gyw, 190 * Math.min(L, 2), [255, 160, 70], 0.5 * Math.min(L, 1.6));
    glowDot(gx, gxw, gyw, 26, [255, 236, 190], Math.min(1, L));
    gx.save(); gx.translate(gxw, ground(gxw) - 2); gx.scale(1, 0.18); glowDot(gx, 0, 0, 170, [255, 150, 70], 0.35 * Math.min(L, 1.2)); gx.restore();
  }
  const ember = t > 17.4 && t < 19.5 ? (1 - inv(17.4, 19.5, t)) : 0;
  if (ember > 0) glowDot(gx, gxw, gyw, 14, [255, 80, 30], 0.8 * ember);
}

// ------------------------------------------------------------ camera
function camAt(t) {
  const x = travX(t);
  const bl = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });
  let c = { x: x + 170 - 60 * smooth(inv(16.5, 19, t)), y: -250, z: 1.3 + 0.04 * inv(9, 19, t) };
  c = bl(c, { x: -178 + 50, y: -222, z: 1.72 }, eio(inv(19, 24.6, t)));
  c = bl(c, { x: 380, y: -345, z: 0.8 }, eio(inv(25.4, 28.8, t)));
  c = bl(c, { x: 745, y: -470, z: 1.05 }, eio(inv(29.2, 35.9, t)));
  c = bl(c, { x: 815, y: -520, z: 1.22 }, eio(inv(35.9, 38.0, t)));
  c = bl(c, { x: 850, y: -440, z: 0.62 }, eout(inv(38.0, 40.6, t)));
  c = bl(c, { x: 815, y: -440, z: 0.665 }, smooth(inv(40.6, 47, t)));
  c = bl(c, { x: 800, y: -480, z: 0.78 }, eio(inv(47, 50.8, t)));
  c = bl(c, { x: 800, y: -2050, z: 0.5 }, eio(inv(50.8, 55.6, t)));
  const sh = 16 * hit(t, 38.0, 0.5) + 6 * hit(t, 14.5, 0.3) + 4 * hit(t, 36.5, 0.5);
  c.x += (3 * N1(t * 0.35, 7.7) + sh * N2(t * 31, 1.1)) / c.z;
  c.y += (2.2 * N1(t * 0.31, 9.1) + sh * N2(t * 29, 5.3)) / c.z;
  return c;
}

// ------------------------------------------------------------ S1: creation
function drawCreation(t) {
  screenX(); X.globalCompositeOperation = 'source-over'; X.globalAlpha = 1;
  X.fillStyle = '#000'; X.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const tilt = eio(inv(5.4, 8.8, t));
  const fwd = eio(inv(3.4, 8.8, t));
  // nebula, revealed by the expanding light
  if (t > 3.2) {
    const Rn = Math.max(1, eout4(inv(3.2, 6.0, t)) * 1600);
    const z = 1.05 + fwd * 1.2, oy = -tilt * 330;
    t1.setTransform(1, 0, 0, 1, 0, 0); t1.globalCompositeOperation = 'source-over'; t1.clearRect(0, 0, W, H);
    t1.save(); t1.translate(cx, cy + oy); t1.rotate(0.035 * (t - 3.2)); t1.scale(z, z); t1.drawImage(A.neb, -W / 2 - 40, -H / 2 - 30, W + 80, H + 60); t1.restore();
    t1.globalCompositeOperation = 'destination-in';
    const g = t1.createRadialGradient(cx, cy, 0, cx, cy, Rn);
    g.addColorStop(0, '#000'); g.addColorStop(0.62, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    t1.fillStyle = g; t1.fillRect(0, 0, W, H); t1.globalCompositeOperation = 'source-over';
    X.globalAlpha = Math.min(1, 0.75 + 0.5 * hit(t, 3.2, 0.9));
    X.drawImage(T1, 0, 0); X.globalAlpha = 1;
  }
  // stars flung outward by the burst, then streaming past as we travel
  if (t > 3.18) {
    const pos = (s, tt) => {
      const b = eout5(inv(3.2, 6.4, tt)); const f = eio(inv(3.4, 8.8, tt)); const tl = eio(inv(5.4, 8.8, tt));
      const r = s.d * b * 1150 * (1 + f * (0.7 + 3.4 * s.z * s.z));
      return [cx + Math.cos(s.a) * r, cy + Math.sin(s.a) * r * 0.9 - tl * 560 * (0.35 + s.z * 0.65)];
    };
    const cols = [[255, 236, 205], [230, 238, 255], [190, 210, 255]];
    X.lineCap = 'round';
    for (let c = 0; c < 3; c++) for (let sb = 0; sb < 3; sb++) {
      X.beginPath();
      for (const s of A.stars) {
        if (s.c !== c) continue;
        const sz = s.s * (0.7 + fwd * 1.6 * s.z);
        if ((sz < 1.1 ? 0 : sz < 2.2 ? 1 : 2) !== sb) continue;
        const p1 = pos(s, t), p0 = pos(s, t - 0.045);
        if (p1[0] < -50 || p1[0] > W + 50 || p1[1] < -50 || p1[1] > H + 50) continue;
        X.moveTo(p0[0], p0[1]); X.lineTo(p1[0] + 0.01, p1[1]);
      }
      X.strokeStyle = rgba(cols[c], sb === 0 ? 0.55 : sb === 1 ? 0.8 : 1);
      X.lineWidth = sb === 0 ? 1.1 : sb === 1 ? 1.9 : 3.0;
      X.stroke();
    }
  }
  // planet
  const pu = inv(5.0, 8.9, t);
  const sunY = cy - tilt * 400;
  if (pu > 0) {
    const R = lerp(820, 4400, ein2(pu));
    const top = lerp(H + 60, -260, eio(pu));
    const pcx = cx + 70, pcy = top + R;
    X.save(); X.beginPath(); X.arc(pcx, pcy, R, 0, TAU); X.clip();
    const g = X.createLinearGradient(0, top, 0, top + 700); g.addColorStop(0, '#18223a'); g.addColorStop(1, '#04060b');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    const k = R / 820;
    for (let i = 0; i < 30; i++) {
      const px = pcx + (hash(i * 1.7) - 0.5) * 2.2 * R * 0.8 + (t - 5) * 30 * (hash(i) - 0.5);
      const py = top + (0.05 + hash(i * 2.9) * 0.5) * 520 * k;
      const sz = (160 + hash(i * 5.3) * 260) * k;
      X.globalAlpha = 0.55; X.drawImage(A.pStorm[i % 4], px - sz / 2, py - sz * 0.36, sz, sz * 0.72);
    }
    X.globalAlpha = 1; X.restore();
    screenG();
    gx.save(); gx.beginPath(); gx.arc(pcx, pcy, R, 0, TAU);
    gx.strokeStyle = rgba([110, 160, 255], 0.55); gx.lineWidth = 30 * Math.sqrt(k); gx.stroke();
    gx.strokeStyle = rgba([255, 214, 160], 0.7); gx.lineWidth = 6 * Math.sqrt(k); gx.stroke(); gx.restore();
  }
  // the first light
  screenG(); gx.globalCompositeOperation = 'lighter';
  const pre = smooth(inv(1.5, 1.62, t)) * (1 - smooth(inv(3.2, 3.26, t)));
  const grow = ein2(inv(1.5, 3.2, t));
  if (pre > 0) {
    const I = pre * (0.5 + 0.5 * grow) * (1 + 0.14 * Math.sin((t - 1.5) * 8) * grow);
    glowDot(gx, cx, cy, 20 + 150 * grow, [255, 240, 214], I);
    glowDot(gx, cx, cy, 8 + 30 * grow, [255, 255, 245], I);
    crossSpikes(gx, cx, cy, 60 + 520 * grow, I * 0.8, [255, 246, 225], 4);
    screenX(); X.fillStyle = rgba([255, 255, 250], pre); X.beginPath(); X.arc(cx, cy, 1.6 + 5 * grow, 0, TAU); X.fill();
    crossSpikes(X, cx, cy, 30 + 300 * grow, pre * 0.6, [255, 250, 235], 1.2);
    screenG();
  }
  if (t >= 3.2) {
    const u = inv(3.2, 4.9, t);
    ring(gx, cx, cy, eout(u) * 1800, (1 - u) * 60 + 6, [255, 226, 176], (1 - u) * 0.9);
    const u2 = inv(3.2, 6.2, t);
    ring(gx, cx, cy, eout(u2) * 1300, (1 - u2) * 120 + 10, [170, 150, 255], (1 - u2) * 0.35);
    const sI = 0.85 + 1.6 * hit(t, 3.2, 0.7);
    glowDot(gx, cx, sunY, 220 + 900 * hit(t, 3.2, 0.9), [255, 232, 196], Math.min(1, sI * 0.8));
    glowDot(gx, cx, sunY, 60, [255, 255, 246], 1);
    rays(gx, cx, sunY, 28, 1700, (t - 3.2) * 0.05, 0.06 * bump(t, 3.2, 3.5, 6.2, 8.4), [255, 232, 185], 0.03);
    crossSpikes(gx, cx, sunY, 700, 0.55 * (1 - smooth(inv(3.3, 7.5, t))), [255, 246, 225], 5);
    screenX(); X.fillStyle = '#fffdf6'; X.beginPath(); X.arc(cx, sunY, 11, 0, TAU); X.fill();
  }
  gx.globalCompositeOperation = 'source-over';
}

function drawDescent(t) {
  const cover = bump(t, 7.3, 8.3, 8.95, 9.9);
  if (cover <= 0) return;
  screenX(); X.globalCompositeOperation = 'source-over';
  const dark = smooth(inv(8.2, 9.0, t));
  const r = rng(404);
  for (let i = 0; i < 48; i++) {
    const x0 = r() * W, y0 = r(), sz = 520 + r() * 760, v = (r() * 4) | 0, sp = 0.9 + r() * 0.8;
    let y = y0 * 2.2 + 1.0 - (t - 7.3) * sp * 0.8;
    y = (((y % 2.2) + 2.2) % 2.2) - 0.6;
    const px = x0 - sz / 2, py = y * H - sz * 0.36;
    if (dark < 1) { X.globalAlpha = cover * (1 - dark); X.drawImage(A.pWhite[v], px, py, sz, sz); }
    if (dark > 0) { X.globalAlpha = cover * dark; X.drawImage(A.pStorm[v], px, py, sz, sz); }
  }
  const full = bump(t, 7.95, 8.45, 8.8, 9.4);
  X.globalAlpha = full; X.fillStyle = rgba(mix3([160, 166, 184], [26, 31, 42], dark)); X.fillRect(0, 0, W, H);
  X.globalAlpha = 1;
}

// ------------------------------------------------------------ the world (S2–S6)
function skyGrad(ctx, stops) {
  const g = ctx.createLinearGradient(0, -2700, 0, 180);
  for (const [o, c] of stops) g.addColorStop(o, rgba(c));
  return g;
}
function drawSky(t, dn, lf, Cs) {
  const L = setLayer(X, 0.3);
  const fl = [60, 70, 95];
  const st = [[0, [2, 3, 8]], [0.55, [8, 11, 20]], [0.8, mix3([20, 25, 37], fl, lf * 0.35)], [1, mix3([38, 45, 60], fl, lf * 0.6)]];
  const dw = [[0, [8, 14, 44]], [0.42, [36, 66, 138]], [0.7, [150, 128, 168]], [0.86, [246, 170, 118]], [1, [255, 228, 172]]];
  const rect = [L.xl - 20, L.yt - 20, L.xr - L.xl + 40, L.yb - L.yt + 40];
  if (dn < 1 || t < 40.3) { X.fillStyle = skyGrad(X, st); X.fillRect(...rect); }
  if (t >= 38.0) {
    if (t < 40.3) {
      const Rt = ein2(inv(38.0, 40.3, t)) * 2800 + 1;
      setLayer(t1, 0.3); t1.globalCompositeOperation = 'source-over'; t1.fillStyle = skyGrad(t1, dw); t1.fillRect(...rect);
      t1.setTransform(1, 0, 0, 1, 0, 0); t1.globalCompositeOperation = 'destination-in';
      const g = t1.createRadialGradient(Cs[0], Cs[1], 0, Cs[0], Cs[1], Rt);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      t1.fillStyle = g; t1.fillRect(0, 0, W, H); t1.globalCompositeOperation = 'source-over';
      screenX(); X.drawImage(T1, 0, 0);
    } else { X.fillStyle = skyGrad(X, dw); X.fillRect(...rect); }
  }
  // stars high above (seen again at the very end)
  const sa = smooth(inv(52.5, 56, t));
  if (sa > 0) {
    screenX(); X.fillStyle = '#fff';
    for (let i = 0; i < 420; i++) {
      const s = A.stars[i];
      const a = sa * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.3 + s.tw))) * (1 - s.y * 0.8);
      if (a < 0.03) continue;
      X.globalAlpha = a; X.fillRect(s.x * W, s.y * H * 0.8, s.s * 0.9, s.s * 0.9);
    }
    X.globalAlpha = 1;
  }
}
function drawSun(t, Cs) {
  if (t < 38.4) return null;
  const a = smooth(inv(38.4, 40.5, t)) * (1 - smooth(inv(54.5, 57.2, t)));
  if (a <= 0) return null;
  const rise = eout(inv(38.5, 52, t));
  const sx = Cs[0] + 20 * CAM.z, sy = Cs[1] + (330 - rise * 360) * CAM.z;
  screenX();
  const g = X.createRadialGradient(sx, sy, 0, sx, sy, 520 * CAM.z);
  g.addColorStop(0, rgba([255, 244, 214], 0.7 * a)); g.addColorStop(0.1, rgba([255, 226, 170], 0.35 * a)); g.addColorStop(1, 'rgba(255,200,140,0)');
  X.fillStyle = g; X.fillRect(0, 0, W, H);
  X.fillStyle = rgba([255, 252, 238], a); X.beginPath(); X.arc(sx, sy, 58 * CAM.z, 0, TAU); X.fill();
  screenG(); glowDot(gx, sx, sy, 600 * CAM.z, [255, 214, 150], 0.22 * a); glowDot(gx, sx, sy, 110 * CAM.z, [255, 250, 230], 0.55 * a);
  return [sx, sy, a];
}
function drawClouds(t, dn, lf, Cs) {
  const L = setLayer(X, 0.15);
  const open = eout(inv(38.0, 40.8, t));
  const clx = L.cx + (Cs[0] - W / 2) / L.z, cly = L.cy + (Cs[1] - H / 2) / L.z;
  for (const c of A.clouds) {
    let x = L.cx - 2200 + ((((c.x0 - 24 * c.sp * t - (L.cx - 2200)) % 4400) + 4400) % 4400);
    let y = c.y;
    if (open > 0) {
      const dx = x - clx, dy = y - cly, d = Math.hypot(dx, dy) + 1;
      const push = open * (900 + 900 * hash(c.x0));
      x += (dx / d) * push; y += (dy / d) * push * 0.8 - open * 120;
    }
    const s = c.s, hgt = s * 0.72;
    if (x + s / 2 < L.xl || x - s / 2 > L.xr || y + hgt / 2 < L.yt || y - hgt / 2 > L.yb) continue;
    const px = x - s / 2, py = y - hgt / 2;
    if (dn < 1) { X.globalAlpha = 0.96 * (1 - dn); X.drawImage(A.pStorm[c.v], px, py, s, hgt); }
    if (lf > 0.02 && dn < 1) { X.globalAlpha = Math.min(1, lf * 0.8) * (1 - dn); X.drawImage(A.pLit[c.v], px, py, s, hgt); }
    if (dn > 0) { X.globalAlpha = 0.85 * dn; X.drawImage(A.pDawn[c.v], px, py, s, hgt); }
  }
  X.globalAlpha = 1;
  // the vortex over the cross
  const vA = bump(t, 35.2, 36.6, 37.95, 38.7);
  if (vA > 0) {
    screenX();
    const ex = 1 + 6 * eout(inv(38.0, 39.2, t));
    for (let i = 0; i < 44; i++) {
      const r0 = (70 + i * 17) * CAM.z;
      const an = i * 2.39996 + (t - 35) * (0.35 + 55 / (r0 + 40));
      const r = r0 * ex;
      const x = Cs[0] + Math.cos(an) * r, y = Cs[1] + Math.sin(an) * r * 0.55;
      const s = (200 + i * 7) * CAM.z;
      X.save(); X.translate(x, y); X.rotate(an + Math.PI / 2);
      X.globalAlpha = vA * 0.92; X.drawImage(A.pStorm[i % 4], -s / 2, -s * 0.36, s, s * 0.72);
      if (lf > 0.02) { X.globalAlpha = vA * Math.min(1, lf); X.drawImage(A.pLit[i % 4], -s / 2, -s * 0.36, s, s * 0.72); }
      X.restore();
    }
    X.globalAlpha = 1;
    screenG(); glowDot(gx, Cs[0], Cs[1], 320 * CAM.z, [255, 214, 150], 0.55 * smooth(inv(36.4, 38, t)) * vA);
  }
}
function drawRidge(p, fy, col, haze) {
  const L = setLayer(X, p);
  X.beginPath(); X.moveTo(L.xl - 30, L.yb + 3000);
  const step = 9 / L.z;
  for (let x = L.xl - 30; x <= L.xr + 30; x += step) X.lineTo(x, fy(x));
  X.lineTo(L.xr + 30, L.yb + 3000); X.closePath();
  X.fillStyle = rgba(col); X.fill();
  if (haze) {
    const g = X.createLinearGradient(0, -260, 0, 60);
    g.addColorStop(0, rgba(haze[0], 0)); g.addColorStop(1, rgba(haze[0], haze[1]));
    X.fillStyle = g; X.fill();
  }
  return L;
}
function drawBolt(k, t) {
  if (!k.seed || t < k.t || t > k.t + 0.4) return;
  const a = clamp(hit(t, k.t, 0.1) + 0.8 * hit(t, k.t + 0.11, 0.07) + 0.6 * hit(t, k.t + 0.24, 0.12));
  const y1 = k.y1 === null ? ground(k.x) : k.y1;
  const r = rng(k.seed);
  const mk = (x0, y0, x1, y1b, it) => {
    let pts = [[x0, y0], [x1, y1b]]; let disp = Math.abs(y1b - y0) * 0.24;
    for (let n = 0; n < it; n++) {
      const np = [];
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; np.push(p, [(p[0] + q[0]) / 2 + (r() - 0.5) * disp, (p[1] + q[1]) / 2 + (r() - 0.5) * disp * 0.25]); }
      np.push(pts[pts.length - 1]); pts = np; disp *= 0.55;
    }
    return pts;
  };
  const main = mk(k.x + 160, k.y0, k.x, y1, 7);
  const paths = [main];
  for (let b = 0; b < 3; b++) { const p = main[(8 + r() * 70) | 0]; paths.push(mk(p[0], p[1], p[0] + (r() - 0.3) * 260, p[1] + 120 + r() * 200, 5)); }
  const draw = (ctx, w, c, al) => {
    ctx.strokeStyle = rgba(c, al); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    paths.forEach((pts, i) => { ctx.lineWidth = i ? w * 0.5 : w; ctx.beginPath(); pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
  };
  const L = setLayer(X, k.p); draw(X, 3.2 / L.z, [240, 244, 255], a);
  setLayer(gx, k.p, 0.5); draw(gx, 22 / L.z, [150, 175, 255], a * 0.8);
}

function drawCross(ctx, x, base, h, arm, th, tilt, col) {
  ctx.save(); ctx.translate(x, base); ctx.rotate(tilt); ctx.fillStyle = col;
  ctx.fillRect(-th / 2, -h, th, h + 30);
  ctx.fillRect(-arm / 2, -h + h * 0.24, arm, th * 0.9);
  ctx.restore();
}
function crossPath(ctx, x, base, h, arm, th) {
  ctx.beginPath();
  ctx.rect(x - th / 2, base - h, th, h);
  ctx.rect(x - arm / 2, base - h + h * 0.24, arm, th * 0.9);
}
const CH = 235, CA = 132, CT = 15;
const crossBase = () => ground(XC) + 4;
function drawHill(t, dn, info) {
  setLayer(X, 1);
  const woodC = rgba(mix3([6, 7, 10], [36, 29, 27], dn));
  const cb = crossBase();
  drawCross(X, XC - 138, ground(XC - 138) + 4, 180, 98, 12, -0.05, woodC);
  drawCross(X, XC + 138, ground(XC + 138) + 4, 180, 98, 12, 0.045, woodC);
  drawCross(X, XC, cb, CH, CA, CT, 0, woodC);
  // the centre cross made of light at the climax
  const bl = blazeAt(t);
  const warm = 0.35 * smooth(inv(39, 42, t));
  if (bl + warm > 0.01) { crossPath(X, XC, cb, CH, CA, CT); X.fillStyle = rgba([255, 248, 230], clamp(bl + warm)); X.fill(); }
  // the linen cloth (after the resurrection)
  const cu = eout(inv(47.0, 48.7, t));
  if (cu > 0) {
    const by = cb - CH + CH * 0.24 - 3, len = 96 * cu, fl = Math.sin(t * 2.1) * 4 * cu, sw = 34 * cu;
    X.beginPath();
    X.moveTo(XC - 60, by); X.lineTo(XC + 60, by);
    X.quadraticCurveTo(XC + 66 + fl, by + len * 0.5, XC + 62 + fl, by + len);
    X.lineTo(XC + 42 + fl * 0.6, by + len - 8);
    X.quadraticCurveTo(XC + 26, by + sw + 6, XC, by + sw + 12);
    X.quadraticCurveTo(XC - 26, by + sw + 6, XC - 42 + fl * 0.6, by + len - 8);
    X.lineTo(XC - 62 + fl, by + len);
    X.quadraticCurveTo(XC - 66 + fl, by + len * 0.5, XC - 60, by);
    X.closePath();
    const g = X.createLinearGradient(XC - 60, 0, XC + 60, 0);
    g.addColorStop(0, rgba([236, 228, 214], cu)); g.addColorStop(0.5, rgba([255, 252, 244], cu)); g.addColorStop(1, rgba([255, 236, 204], cu));
    X.fillStyle = g; X.fill();
  }
  // outline glow on the centre cross
  const gC = 0.45 * smooth(inv(27.7, 28.7, t)) + 0.55 * smooth(inv(33, 37.9, t)) + 0.8 * bl;
  setLayer(gx, 1, 0.5);
  if (gC > 0.01) {
    crossPath(gx, XC, cb, CH, CA, CT);
    gx.strokeStyle = rgba([255, 214, 140], clamp(gC * (t < 38 ? 0.8 : 0.5))); gx.lineWidth = 7 + 30 * bl; gx.stroke();
    gx.fillStyle = rgba([255, 244, 220], clamp(bl + warm * 0.7)); gx.fill();
  }
  if (cu > 0) glowDot(gx, XC, cb - CH + 80, 150, [255, 246, 226], 0.35 * cu);
  // the tomb
  const tg = ground(TX);
  X.fillStyle = rgba(mix3([9, 10, 14], [48, 42, 42], dn));
  X.beginPath(); X.moveTo(TX - 78, tg + 8);
  X.bezierCurveTo(TX - 76, tg - 50, TX - 52, tg - 86, TX - 6, tg - 94);
  X.bezierCurveTo(TX + 42, tg - 92, TX + 74, tg - 58, TX + 82, tg + 8); X.closePath(); X.fill();
  const tl = smooth(inv(38.7, 40.5, t)) * 0.4 + 0.6 * smooth(inv(44.6, 46.2, t));
  X.fillStyle = rgba(mix3([2, 2, 3], [255, 246, 220], tl));
  X.beginPath(); X.moveTo(TX - 22, tg + 2); X.lineTo(TX - 22, tg - 30); X.arc(TX, tg - 30, 22, Math.PI, 0); X.lineTo(TX + 22, tg + 2); X.closePath(); X.fill();
  const su = eio(inv(38.6, 40.2, t));
  const sxp = TX + 78 * su, syp = ground(sxp) - 33;
  X.save(); X.translate(sxp, syp); X.rotate((78 * su) / 33);
  X.fillStyle = rgba(mix3([20, 20, 24], [86, 78, 74], dn)); X.beginPath(); X.arc(0, 0, 34, 0, TAU); X.fill();
  X.strokeStyle = rgba(mix3([10, 10, 12], [54, 48, 46], dn)); X.lineWidth = 3; X.beginPath(); X.arc(0, 0, 24, 0.4, 2.2); X.stroke();
  X.restore();
  if (tl > 0.01) {
    glowDot(gx, TX, tg - 24, 220, [255, 236, 190], 0.6 * tl);
    gx.save(); gx.globalCompositeOperation = 'lighter';
    rays(gx, TX, tg - 20, 9, 520, -1.25, 0.18 * smooth(inv(44.6, 46.5, t)), [255, 240, 205], 0.07);
    gx.restore();
  }
  info.crossTop = [XC, cb - CH];
}
function drawGround(t, dn) {
  const L = setLayer(X, 1);
  const x0 = L.xl - 30, x1 = L.xr + 30, step = 7 / L.z;
  X.beginPath(); X.moveTo(x0, L.yb + 3000);
  for (let x = x0; x <= x1; x += step) X.lineTo(x, ground(x));
  X.lineTo(x1, L.yb + 3000); X.closePath();
  X.fillStyle = rgba([6, 7, 10]); X.fill();
  const r = waveR(t);
  if (r > 0) {
    const gcol = [30, 48, 30];
    const g = X.createLinearGradient(x0, 0, x1, 0);
    const pos = (x) => clamp((x - x0) / (x1 - x0));
    const e = 90;
    const pts = [[XC - r - e, 0], [XC - r, 1], [XC + r, 1], [XC + r + e, 0]];
    let lastO = -1;
    for (const [x, a] of pts) { const o = pos(x); if (o <= lastO) continue; g.addColorStop(o, rgba(gcol, a)); lastO = o; }
    X.fillStyle = g; X.fill();
    // rim light along the crest (backlit)
    X.beginPath();
    for (let x = x0; x <= x1; x += step) (x === x0 ? X.moveTo(x, ground(x)) : X.lineTo(x, ground(x)));
    X.strokeStyle = rgba([255, 214, 150], 0.5 * dn); X.lineWidth = 2.5 / L.z; X.stroke();
    // wave front of light
    setLayer(gx, 1, 0.5);
    const wa = 1 - smooth(inv(40.0, 42.3, t));
    for (const sd of [-1, 1]) { const xf = XC + sd * r; glowDot(gx, xf, ground(xf), 170, [255, 226, 160], 0.7 * wa); }
  }
  return L;
}
function drawTrees(t, dn, L) {
  for (const tr of TREES) {
    const [bx, by, bw, bh] = tr.bb;
    const gy = ground(tr.x);
    if (tr.x + (bx + bw) * tr.s < L.xl || tr.x + bx * tr.s > L.xr) continue;
    const ta = arriveT(tr.x);
    const g = smooth(inv(ta, ta + 0.8, t));
    X.globalAlpha = 1; X.drawImage(tr.storm, tr.x + bx * tr.s, gy + by * tr.s, bw * tr.s, bh * tr.s);
    if (g > 0) { X.globalAlpha = g; X.drawImage(tr.dawn, tr.x + bx * tr.s, gy + by * tr.s, bw * tr.s, bh * tr.s); }
    X.globalAlpha = 1;
    if (t > ta) {
      const cols = [[255, 240, 244], [255, 212, 226], [150, 196, 96]];
      for (let ci = 0; ci < 3; ci++) {
        X.beginPath();
        for (const p of tr.tips) {
          if ((p[2] < 0.45 ? 0 : p[2] < 0.8 ? 1 : 2) !== ci) continue;
          const b = eback(inv(ta + 0.15 + p[3] * 1.4, ta + 0.75 + p[3] * 1.4, t));
          if (b <= 0) continue;
          const rr = (2.4 + p[4] * 3.4) * tr.s * b * (ci === 2 ? 0.8 : 1);
          const px = tr.x + p[0] * tr.s + Math.sin(t * 1.4 + p[3] * 9) * 1.5, py = gy + p[1] * tr.s;
          X.moveTo(px + rr, py); X.arc(px, py, rr, 0, TAU);
        }
        X.fillStyle = rgba(cols[ci]); X.fill();
      }
    }
  }
}
function drawGrass(t, dn, L) {
  const wind = windAt(t);
  const bins = [[], [], [], [], []];
  for (const b of A.grass) {
    if (b.x < L.xl - 40 || b.x > L.xr + 40) continue;
    const ta = arriveT(b.x);
    const g = t > 38 ? eout(inv(ta, ta + 1.3 + b.d, t)) : 0;
    bins[Math.min(4, Math.round(g * 4))].push([b, g]);
  }
  const dry = [13, 15, 18], green = [34, 64, 34];
  for (let bi = 0; bi < 5; bi++) {
    if (!bins[bi].length) continue;
    X.beginPath();
    for (const [b, g] of bins[bi]) {
      const y = ground(b.x) + 3;
      const h = lerp(b.h0, b.h1, g);
      const lean = t < 38 ? -0.45 * wind * (0.65 + 0.35 * N1(b.x * 0.008 - t * 1.6, 0.3)) + b.l * 0.4 : b.l + 0.12 * Math.sin(t * 1.3 + b.x * 0.012);
      const tx = b.x + Math.sin(lean) * h, ty = y - Math.cos(lean) * h;
      X.moveTo(b.x - 1.6, y); X.quadraticCurveTo(b.x + Math.sin(lean) * h * 0.3, y - h * 0.55, tx, ty); X.lineTo(b.x + 1.6, y);
    }
    X.fillStyle = rgba(mix3(dry, green, bi / 4)); X.fill();
  }
  // golden tips (backlit)
  if (dn > 0.05) {
    X.beginPath();
    for (const [b, g] of bins[4]) {
      const y = ground(b.x) + 3, h = b.h1, lean = b.l + 0.12 * Math.sin(t * 1.3 + b.x * 0.012);
      X.moveTo(b.x + Math.sin(lean) * h * 0.72, y - Math.cos(lean) * h * 0.72); X.lineTo(b.x + Math.sin(lean) * h, y - Math.cos(lean) * h);
    }
    X.strokeStyle = rgba([255, 212, 130], 0.55 * dn); X.lineWidth = 1.4; X.stroke();
  }
  // flowers
  if (t > 38.3) {
    const byC = new Map();
    for (const f of A.flowers) {
      if (f.x < L.xl - 20 || f.x > L.xr + 20) continue;
      const ta = arriveT(f.x) + 0.5 + f.d * 1.2;
      const o = eback(inv(ta, ta + 0.7, t));
      if (o <= 0) continue;
      const y = ground(f.x) + 2, hh = f.h * eout(inv(ta - 0.3, ta + 0.5, t));
      const lean = f.l + 0.08 * Math.sin(t * 1.5 + f.x);
      const hx = f.x + Math.sin(lean) * hh, hy = y - Math.cos(lean) * hh;
      if (!byC.has(f.c)) byC.set(f.c, { stems: [], heads: [] });
      const e = byC.get(f.c); e.stems.push([f.x, y, hx, hy]); e.heads.push([hx, hy, f.s * o]);
    }
    X.beginPath();
    for (const e of byC.values()) for (const s of e.stems) { X.moveTo(s[0], s[1]); X.lineTo(s[2], s[3]); }
    X.strokeStyle = rgba([40, 70, 36]); X.lineWidth = 1.5; X.stroke();
    for (const [c, e] of byC) {
      X.beginPath(); for (const h of e.heads) { X.moveTo(h[0] + h[2], h[1]); X.arc(h[0], h[1], h[2], 0, TAU); }
      X.fillStyle = rgba(c); X.fill();
    }
  }
}
function bearerState(b, t) {
  const moving = t - b.t0;
  let x = b.x0 + b.dir * b.sp * Math.max(0, moving);
  const reached = b.dir > 0 ? x >= b.stop : x <= b.stop;
  let tStop = b.t0 + Math.abs(b.stop - b.x0) / b.sp;
  if (reached) x = b.stop;
  const w = 1 - smooth(inv(tStop - 0.3, tStop + 0.2, t));
  return { x, w, tStop };
}
function drawBearers(t, dn, info) {
  if (t < 42.3) return;
  info.lights = info.lights || [];
  const col = rgba([20, 22, 24]);
  for (const b of A.bearers) {
    const st = bearerState(b, t);
    const gy = ground(st.x);
    const [sx] = ws(st.x, gy);
    if (sx < -200 || sx > W + 200) continue;
    const q = { x: st.x, ph: (TAU * (t - b.t0)) / 1.15 + b.ph, w: st.w, k: 0, b: 0.05 - 0.2 * smooth(inv(49.3, 50.3, t)), pray: 0, hold: 1, tc: 0, r: smooth(inv(49.4 + b.i * 0.05, 50.4 + b.i * 0.05, t)), lean: 0.02, slope: -slopeAt(st.x) * b.dir * st.w, wind: 0.2 };
    const R = rig(q, t);
    X.save(); setLayer(X, 1); X.translate(st.x, gy + 2); X.scale(b.dir * b.s, b.s);
    drawRig(X, R, col, t);
    X.restore();
    const hand = [st.x + b.dir * R.hF[0] * b.s, gy + 2 + R.hF[1] * b.s];
    const L = smooth(inv(b.ti - 0.05, b.ti + 0.15, t)) * (0.9 + 0.1 * N2(t * 5, b.i)) * (1 + 1.5 * hit(t, b.ti, 0.3));
    const sw = 0.25 * Math.sin(q.ph - 0.7) * st.w * (1 - q.r);
    setLayer(X, 1); drawLantern(X, hand[0], hand[1], sw, L, b.s * 1.05);
    const lp = [hand[0] - Math.sin(sw) * 21 * b.s, hand[1] + Math.cos(sw) * 21 * b.s];
    setLayer(gx, 1, 0.5);
    if (L > 0.01) { glowDot(gx, lp[0], lp[1], 120 * Math.min(L, 2), [255, 170, 80], 0.5 * Math.min(L, 1.5)); glowDot(gx, lp[0], lp[1], 16, [255, 240, 200], Math.min(1, L)); }
    info.lights.push({ p: lp, ti: b.ti, i: b.i + 1 });
  }
}
function drawFarLights(t) {
  if (t < 43.5) return;
  setLayer(gx, 0.55, 0.5);
  const L = setLayer(X, 0.55);
  for (const f of A.far) {
    const a = smooth(inv(f.t0, f.t0 + 1, t));
    if (a <= 0) continue;
    const x = f.x0 + f.dir * f.sp * (t - f.t0), y = midY(x) - 5;
    if (x < L.xl || x > L.xr) continue;
    glowDot(gx, x, y, 26, [255, 184, 100], 0.55 * a);
    X.fillStyle = rgba([255, 236, 190], a); X.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
  }
}

// dove of light
function doveAt(t) {
  if (t < 21.6 || t > 28.45) return null;
  const tx = -178;
  const lt = [-178 + 44 * TS, ground(-178 + 44 * TS) - 36 * TS - 7];
  const cp = [XC, crossBase() - CH + CH * 0.24];
  let x, y, flap = 0.2, fold = 0, sc = 1, al = 1;
  const top = rayTop();
  const burst = (tf) => bump(t, tf - 0.06, tf, tf + 0.3, tf + 0.5);
  if (t < 24.0) {
    const u = eio2(inv(21.6, 24.0, t));
    x = lerp(top[0] + 60, tx + 20, u) + 30 * Math.sin(u * 5.5) * (1 - u); y = lerp(-900, -294, u);
    flap = 0.25 + 0.85 * (burst(22.3) + burst(23.1) + burst(23.9));
    al = smooth(inv(21.6, 22.2, t));
  } else if (t < 24.6) {
    const u = inv(24.0, 24.6, t); const a = -Math.PI / 2 + u * TAU;
    x = tx + 20 + Math.cos(a) * 115; y = -240 + Math.sin(a) * 54; flap = 0.7;
  } else if (t < 25.0) {
    const u = eio2(inv(24.6, 25.0, t));
    x = lerp(tx + 20, lt[0], u); y = lerp(-294, lt[1], u) - Math.sin(u * Math.PI) * 30; flap = 1;
  } else if (t < 26.0) {
    x = lt[0]; y = lt[1] - 2 * Math.abs(Math.sin((t - 25) * 5)) * bump(t, 25.1, 25.3, 25.6, 25.9); flap = 0; fold = 1;
  } else {
    const u = eio2(inv(26.0, 28.35, t));
    const c = [(lt[0] + cp[0]) / 2, -760];
    x = (1 - u) * (1 - u) * lt[0] + 2 * u * (1 - u) * c[0] + u * u * cp[0];
    y = (1 - u) * (1 - u) * lt[1] + 2 * u * (1 - u) * c[1] + u * u * cp[1];
    flap = 1 - 0.5 * u; fold = 0; sc = 1 - 0.4 * u; al = 1 - smooth(inv(27.95, 28.4, t));
  }
  return { x, y, flap, fold, sc, al };
}
function drawDoveShape(ctx, st, t, wingPhase, dir, col, a, big) {
  const { x, y, sc } = st;
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * sc * (big || 1), sc * (big || 1));
  ctx.fillStyle = rgba(col, a);
  const open = 1 - st.fold;
  const wy = lerp(-4, lerp(-36, 24, (1 - Math.sin(wingPhase)) / 2 * st.flap + (1 - st.flap) * 0.28), open);
  const wx = lerp(-22, -10, open);
  // far wing
  ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(4, -4); ctx.quadraticCurveTo(0, wy * 0.7 - 2, wx + 6, wy * 0.9); ctx.quadraticCurveTo(-8, wy * 0.4, -10, -1); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  // body, head, tail
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, -0.08, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(15, -5, 5.6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(19.5, -6); ctx.lineTo(25, -4.3); ctx.lineTo(19.5, -3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(-31, -7); ctx.lineTo(-32, 2); ctx.lineTo(-30, 5); ctx.lineTo(-12, 3); ctx.closePath(); ctx.fill();
  // near wing
  ctx.beginPath(); ctx.moveTo(4, -3); ctx.quadraticCurveTo(-2, wy * 0.6 - 4, wx, wy); ctx.quadraticCurveTo(-12, wy * 0.45, -12, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawDove(t) {
  const st = doveAt(t); if (!st) return;
  const prev = doveAt(t - 0.05) || st;
  const dir = st.x >= prev.x - 0.5 ? 1 : -1;
  const wp = t * TAU * 4.2;
  setLayer(X, 1); drawDoveShape(X, st, t, wp, dir, [255, 252, 240], st.al);
  setLayer(gx, 1, 0.5);
  gx.globalCompositeOperation = 'lighter';
  drawDoveShape(gx, st, t, wp, dir, [255, 236, 190], 0.35 * st.al, 1.1);
  glowDot(gx, st.x, st.y, 80, [255, 232, 180], 0.22 * st.al);
  for (let k = 1; k < 26; k++) {
    const p = doveAt(t - k * 0.035); if (!p) break;
    const jx = (hash(k * 3.1 + Math.floor(t * 30)) - 0.5) * 10, jy = (hash(k * 7.7 + Math.floor(t * 30)) - 0.5) * 10 + k * 0.8;
    glowDot(gx, p.x + jx, p.y + jy, 9, [255, 226, 160], 0.5 * (1 - k / 26) * st.al);
  }
  gx.globalCompositeOperation = 'source-over';
}
const rayAt = (t) => smooth(inv(21.5, 22.8, t)) * (1 - smooth(inv(27.8, 30.5, t)));
const rayTop = () => [-178 - 360, -1500];
function drawRay(t) {
  const a = rayAt(t); if (a <= 0) return;
  const top = rayTop(), bot = [-178 + 10, ground(-168) + 10];
  const dx = bot[0] - top[0], dy = bot[1] - top[1], dl = Math.hypot(dx, dy), nx = -dy / dl, ny = dx / dl;
  const poly = (ctx, w0, w1) => { ctx.beginPath(); ctx.moveTo(top[0] + nx * w0, top[1] + ny * w0); ctx.lineTo(bot[0] + nx * w1, bot[1] + ny * w1); ctx.lineTo(bot[0] - nx * w1, bot[1] - ny * w1); ctx.lineTo(top[0] - nx * w0, top[1] - ny * w0); ctx.closePath(); };
  for (const [ctx, k] of [[gx, 0.5]]) {
    setLayer(ctx, 1, k);
    ctx.filter = 'blur(10px)';
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(top[0], top[1], bot[0], bot[1]);
    const c = [255, 234, 186];
    g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.35, rgba(c, 0.03 * a)); g.addColorStop(1, rgba(c, 0.05 * a));
    ctx.fillStyle = g;
    for (let i = 0; i < 6; i++) { const f = 1 - i / 6; poly(ctx, 8 + 40 * f, 30 + 150 * f); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  }
  // motes in the beam
  setLayer(gx, 1, 0.5);
  for (let i = 0; i < 60; i++) {
    const v = (hash(i * 1.37) + t * 0.035 * (0.5 + hash(i))) % 1;
    const w = (hash(i * 4.1) - 0.5) * 2 * lerp(40, 160, v);
    const px = top[0] + dx * v + nx * w + Math.sin(t * 0.7 + i) * 6, py = top[1] + dy * v + ny * w;
    glowDot(gx, px, py, 5 + hash(i * 2.2) * 5, [255, 240, 200], 0.55 * a * (0.4 + 0.6 * Math.sin(t * 2 + i) ** 2));
  }
  glowDot(gx, bot[0], bot[1] - 60, 240, [255, 230, 180], 0.2 * a);
}
function drawFootprints(t) {
  if (t < 30 || t > 40) return;
  setLayer(gx, 1, 0.5);
  for (let k = 0; ; k++) {
    const tf = 30.0 + 0.6 * k; if (tf > 35.8) break; if (t < tf) break;
    const x = travX(tf) + (k % 2 ? 10 : -2);
    const a = 0.85 * Math.exp(-(t - tf) / 1.6);
    gx.save(); gx.translate(x, ground(x) + 1); gx.scale(1, 0.35); glowDot(gx, 0, 0, 34, [255, 214, 140], a); glowDot(gx, 0, 0, 10, [255, 250, 230], a); gx.restore();
  }
}
function drawRain(t) {
  const amt = rainAt(t); if (amt <= 0.01) return;
  screenX(); X.lineCap = 'round';
  const lf = lightning(t);
  const wind = windAt(t);
  const layers = [[520, 20, 1, 0.9, 0.16], [340, 32, 1.3, 1.2, 0.22], [120, 56, 2.2, 1.7, 0.26]];
  layers.forEach(([n, len, lw, sp, al], li) => {
    const vy = 1650 * sp, vx = -(360 + 260 * wind) * sp;
    const kx = vx / vy;
    X.beginPath();
    const cnt = Math.floor(n * amt);
    for (let i = 0; i < cnt; i++) {
      const x0 = hash(i * 7.13 + li * 101) * (W + 600), y0 = hash(i * 3.31 + li * 57) * (H + 120);
      const y = ((y0 + t * vy) % (H + 120)) - 60;
      const x = ((((x0 + t * vx + (y + 60) * 0) % (W + 600)) + W + 600) % (W + 600)) - 100;
      X.moveTo(x, y); X.lineTo(x - kx * len, y - len);
    }
    X.strokeStyle = rgba(mix3([150, 165, 195], [230, 236, 255], lf * 0.6), al * (0.7 + 0.3 * amt) * (1 + lf));
    X.lineWidth = lw; X.stroke();
  });
  // splashes on the ground
  X.beginPath();
  for (let i = 0; i < 110 * amt; i++) {
    const per = 0.35 + hash(i * 1.9) * 0.2;
    const ph = (t / per + hash(i * 5.5)) % 1;
    const cyc = Math.floor(t / per + hash(i * 5.5));
    const sx = hash(i * 8.3 + cyc * 1.7) * W;
    const wx = (sx - W / 2) / CAM.z + CAM.x;
    const sy = (ground(wx) - CAM.y) * CAM.z + H / 2 + 3;
    if (sy > H + 10 || sy < 0) continue;
    if (ph > 0.6) continue;
    const r = (1.5 + ph * 6) * CAM.z;
    X.moveTo(sx + r, sy); X.ellipse(sx, sy, r, r * 0.3, 0, 0, TAU);
  }
  X.strokeStyle = rgba([170, 185, 215], 0.14 * amt); X.lineWidth = 1; X.stroke();
}
function drawSparks(t, info) {
  if (!info.lights || !info.crossTop) return;
  setLayer(gx, 1, 0.5);
  const c0 = [info.crossTop[0], info.crossTop[1] + 40];
  gx.globalCompositeOperation = 'lighter';
  for (const L of info.lights) {
    const t0 = L.ti - 0.85;
    if (t < t0 || t > L.ti + 0.05) continue;
    const bez = (u) => { const cx = (c0[0] + L.p[0]) / 2, cy = Math.min(c0[1], L.p[1]) - 260; return [(1 - u) ** 2 * c0[0] + 2 * u * (1 - u) * cx + u * u * L.p[0], (1 - u) ** 2 * c0[1] + 2 * u * (1 - u) * cy + u * u * L.p[1]]; };
    const u = eio2(inv(t0, L.ti, t));
    for (let k = 0; k < 14; k++) {
      const p = bez(clamp(u - k * 0.02));
      glowDot(gx, p[0], p[1], k ? 14 : 30, [255, 222, 150], (k ? 0.5 * (1 - k / 14) : 1));
    }
  }
  gx.globalCompositeOperation = 'source-over';
}
function drawFlock(t) {
  if (t < 43.8 || t > 47.8) return;
  screenX();
  for (const d of A.flock) {
    const x = d.x0 + d.sp * (t - 43.8), y = d.y0 + 16 * Math.sin(t * 2 + d.ph);
    if (x < -80 || x > W + 80) continue;
    const st = { x, y, sc: d.s * CAM.z * 1.4, flap: 1, fold: 0 };
    drawDoveShape(X, st, t, t * TAU * 3.6 + d.ph, 1, [255, 250, 242], 0.95);
    screenG(); glowDot(gx, x, y, 34 * d.s, [255, 240, 210], 0.3); screenX();
  }
}
function drawRising(t, info) {
  if (t < 51.0 || t > 56.5 || !info.lightsAll) return;
  screenG(); gx.globalCompositeOperation = 'lighter';
  const T = [W / 2, H * 0.46];
  info.lightsAll.forEach((L, idx) => {
    const ts = 51.2 + (idx % 15) * 0.13;
    if (t < ts) return;
    const S = ws(L.p[0], L.p[1]);
    const c = [lerp(S[0], T[0], 0.25) + (hash(idx) - 0.5) * 500, S[1] - 520];
    const bez = (u) => [(1 - u) ** 2 * S[0] + 2 * u * (1 - u) * c[0] + u * u * T[0], (1 - u) ** 2 * S[1] + 2 * u * (1 - u) * c[1] + u * u * T[1]];
    const u = eio(inv(ts, ts + 3.1, t));
    const fade = 1 - smooth(inv(ts + 2.9, ts + 3.2, t));
    for (let k = 0; k < 16; k++) {
      const p = bez(clamp(u - k * 0.018));
      glowDot(gx, p[0], p[1], k ? 10 : 26, [255, 222, 150], fade * (k ? 0.5 * (1 - k / 16) : 1));
    }
  });
  gx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------ S6: the rose window
function roseWindow(ctx, cx, cy, R, rot, rev, alpha, glow) {
  if (alpha <= 0.003 || R < 1) return;
  const P = [[22, 50, 168], [158, 16, 38], [226, 152, 32], [22, 112, 70], [92, 36, 136], [36, 108, 204]];
  const lead = [22, 16, 12];
  const ringA = (i) => clamp(rev * 4 - i) * alpha; // ring i appears in turn
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  const lw = Math.max(1, R * 0.012);
  const cell = (path, col, a, bright = 1) => {
    if (a <= 0.003) return;
    ctx.fillStyle = rgba(glow ? scale3(col, 1.2) : mix3(col, [255, 255, 255], 0.06 * bright), a); path(); ctx.fill();
    if (!glow) { ctx.strokeStyle = rgba(lead, a); ctx.lineWidth = lw; ctx.stroke(); }
  };
  // background glass
  cell(() => { ctx.beginPath(); ctx.arc(0, 0, R * 0.96, 0, TAU); }, [12, 22, 74], ringA(0) * 0.95);
  // outer ring of roundels
  const a3 = ringA(3);
  for (let i = 0; i < 24; i++) { const an = (i / 24) * TAU; cell(() => { ctx.beginPath(); ctx.arc(Math.cos(an) * R * 0.89, Math.sin(an) * R * 0.89, R * 0.058, 0, TAU); }, i % 2 ? P[2] : P[3], a3); }
  // middle ring: 24 cells with quatrefoils
  const a2 = ringA(2);
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * TAU, a1 = ((i + 1) / 24) * TAU;
    cell(() => { ctx.beginPath(); ctx.arc(0, 0, R * 0.82, a0, a1); ctx.arc(0, 0, R * 0.53, a1, a0, true); ctx.closePath(); }, i % 2 ? P[1] : P[5], a2 * 0.85);
    const am = (a0 + a1) / 2, qx = Math.cos(am) * R * 0.675, qy = Math.sin(am) * R * 0.675;
    for (let k = 0; k < 4; k++) { const ak = am + (k * Math.PI) / 2; cell(() => { ctx.beginPath(); ctx.arc(qx + Math.cos(ak) * R * 0.035, qy + Math.sin(ak) * R * 0.035, R * 0.033, 0, TAU); }, P[2], a2); }
  }
  // inner ring: 12 petals
  const a1r = ringA(1);
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * TAU + Math.PI / 12;
    const px = Math.cos(an) * R * 0.37, py = Math.sin(an) * R * 0.37;
    cell(() => { ctx.beginPath(); ctx.ellipse(px, py, R * 0.15, R * 0.075, an, 0, TAU); }, i % 2 ? P[4] : P[1], a1r);
    const tx = Math.cos(an + Math.PI / 12) * R * 0.46, ty = Math.sin(an + Math.PI / 12) * R * 0.46;
    cell(() => { ctx.beginPath(); ctx.arc(tx, ty, R * 0.04, 0, TAU); }, P[2], a1r);
  }
  // centre medallion with the cross
  const a0r = ringA(0);
  cell(() => { ctx.beginPath(); ctx.arc(0, 0, R * 0.2, 0, TAU); }, P[0], a0r);
  ctx.rotate(-rot);
  const cw = R * 0.045, ch = R * 0.16;
  cell(() => { ctx.beginPath(); ctx.rect(-cw / 2, -ch * 0.8, cw, ch * 1.6); ctx.rect(-ch * 0.55, -ch * 0.38, ch * 1.1, cw); }, [255, 214, 110], a0r, 2);
  ctx.rotate(rot);
  // stone rim
  if (!glow) {
    ctx.strokeStyle = rgba([44, 34, 28], ringA(0)); ctx.lineWidth = R * 0.04; ctx.beginPath(); ctx.arc(0, 0, R * 0.985, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba([255, 214, 150], ringA(0) * 0.6); ctx.lineWidth = R * 0.006; ctx.beginPath(); ctx.arc(0, 0, R * 1.005, 0, TAU); ctx.stroke();
    for (const rr of [0.2, 0.53, 0.82]) { ctx.strokeStyle = rgba(lead, alpha); ctx.lineWidth = lw * 1.8; ctx.beginPath(); ctx.arc(0, 0, R * rr, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(an) * R * 0.2, Math.sin(an) * R * 0.2); ctx.lineTo(Math.cos(an) * R * 0.53, Math.sin(an) * R * 0.53); ctx.stroke(); }
  }
  ctx.restore();
}
function drawGlory(t) {
  if (t < 54.0) return;
  const cx = W / 2, cy = H * 0.46;
  const rev = inv(54.3, 56.4, t);
  const col = eio(inv(57.3, 58.35, t));
  const R = 410 * (1 - col) * (0.94 + 0.06 * eout(rev));
  const rot = (t - 54) * 0.06 + col * col * 5;
  const alpha = smooth(inv(54.2, 54.8, t)) * (1 - smooth(inv(58.1, 58.45, t)));
  // darkness returns around the window
  screenX();
  X.fillStyle = rgba([0, 0, 0], 0.88 * smooth(inv(57.2, 58.6, t))); X.fillRect(0, 0, W, H);
  // halo behind the glass
  screenG(); glowDot(gx, cx, cy, 800 * (1 - col * 0.9), [255, 226, 170], 0.18 * alpha);
  screenX(); roseWindow(X, cx, cy, R, rot, rev, alpha, false);
  screenG(); gx.globalCompositeOperation = 'lighter'; roseWindow(gx, cx, cy, R, rot, rev, alpha * 0.22, true); gx.globalCompositeOperation = 'source-over';
  rays(gx, cx, cy, 36, 1300 * (1 - col), rot * 0.5, 0.05 * alpha, [255, 230, 190], 0.025);
  ring(gx, cx, cy, eout(inv(57.0, 58.2, t)) * 1400, 30, [255, 230, 190], 0.5 * (1 - inv(57.0, 58.2, t)) * (t > 57 ? 1 : 0));
  // the single point of light again
  const pt = smooth(inv(58.1, 58.4, t)) * (1 - smooth(inv(59.2, 59.95, t)));
  if (pt > 0) {
    const tw = 1 + 0.9 * hit(t, 58.8, 0.35, 0.08);
    glowDot(gx, cx, cy, 80 * tw, [255, 240, 214], pt);
    glowDot(gx, cx, cy, 22 * tw, [255, 255, 245], pt);
    crossSpikes(gx, cx, cy, 260 * tw, 0.8 * pt, [255, 246, 225], 4);
    screenX(); X.fillStyle = rgba([255, 255, 250], pt); X.beginPath(); X.arc(cx, cy, 3 * tw, 0, TAU); X.fill();
    crossSpikes(X, cx, cy, 140 * tw, 0.6 * pt, [255, 250, 235], 1.2);
  }
  // flash as it folds into a point
  const fl = hit(t, 58.35, 0.25, 0.12);
  if (fl > 0.01) { screenG(); glowDot(gx, cx, cy, 700, [255, 244, 220], 0.8 * fl); }
}

// ------------------------------------------------------------ climax effects
function drawClimax(t, info) {
  const bl = blazeAt(t);
  if (bl < 0.004 || !info.crossTop) return;
  const cc = [XC, crossBase() - CH + CH * 0.3];
  const [sx, sy] = ws(cc[0], cc[1]);
  screenG(); gx.globalCompositeOperation = 'lighter';
  glowDot(gx, sx, sy, 1400 * bl, [255, 236, 200], 0.75 * bl);
  rays(gx, sx, sy, 22, 2800, (t - 38) * 0.04, 0.3 * bl, [255, 236, 196], 0.022);
  // pillar of light
  const pw = 34 * CAM.z * (0.4 + bl);
  const g = gx.createLinearGradient(0, sy, 0, 0);
  g.addColorStop(0, rgba([255, 246, 226], 0.9 * bl)); g.addColorStop(1, rgba([255, 246, 226], 0.1 * bl));
  gx.fillStyle = g; gx.fillRect(sx - pw / 2, -10, pw, sy + 10);
  gx.globalCompositeOperation = 'source-over';
  const u = inv(38.0, 39.7, t);
  if (u > 0 && u < 1) {
    ring(gx, sx, sy, eout(u) * 2400, 80 * (1 - u) + 8, [255, 230, 180], 0.9 * (1 - u));
    ring(gx, sx, sy, eout(inv(38.0, 40.6, t)) * 1800, 40, [200, 210, 255], 0.3 * (1 - inv(38, 40.6, t)));
  }
}

// ------------------------------------------------------------ frame
function composeGlow() {
  b1.clearRect(0, 0, B1.width, B1.height); b1.drawImage(G, 0, 0, B1.width, B1.height);
  b2.clearRect(0, 0, B2.width, B2.height); b2.filter = 'blur(2px)'; b2.drawImage(B1, 0, 0, B2.width, B2.height); b2.filter = 'none';
  b3.clearRect(0, 0, B3.width, B3.height); b3.filter = 'blur(2px)'; b3.drawImage(B2, 0, 0, B3.width, B3.height); b3.filter = 'none';
  screenX(); X.globalCompositeOperation = 'lighter';
  X.imageSmoothingQuality = 'high';
  X.globalAlpha = 0.7; X.drawImage(G, 0, 0, W, H);
  X.globalAlpha = 0.5; X.drawImage(B1, 0, 0, W, H);
  X.globalAlpha = 0.45; X.drawImage(B2, 0, 0, W, H);
  X.globalAlpha = 0.4; X.drawImage(B3, 0, 0, W, H);
  X.globalAlpha = 1; X.globalCompositeOperation = 'source-over';
}
function finish(t) {
  screenX(); X.globalCompositeOperation = 'source-over';
  // flashes
  const f1 = 0.95 * hit(t, 3.2, 0.35, 0.05), f2 = 0.8 * hit(t, 38.0, 0.5, 0.06), lf = 0.12 * lightning(t) * (t > 8.6 && t < 38 ? 1 : 0);
  const fw = Math.min(1, f1 + f2 + lf);
  if (fw > 0.003) { X.fillStyle = rgba(f2 > f1 ? [255, 248, 232] : [255, 255, 255], fw); X.fillRect(0, 0, W, H); }
  // grade: cool storm / warm dawn
  if (t > 8.6 && t < 42) { X.globalCompositeOperation = 'soft-light'; X.fillStyle = rgba([40, 70, 140], 0.35 * (1 - dawnAt(t))); X.fillRect(0, 0, W, H); }
  if (t > 38.5 && t < 56) { X.globalCompositeOperation = 'soft-light'; X.fillStyle = rgba([255, 190, 120], 0.25 * dawnAt(t) * (1 - smooth(inv(52, 56, t)))); X.fillRect(0, 0, W, H); }
  X.globalCompositeOperation = 'source-over';
  const g = X.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 1.08);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  X.fillStyle = g; X.fillRect(0, 0, W, H);
  // film grain
  const fi = Math.round(t * FPS);
  X.globalCompositeOperation = 'overlay'; X.globalAlpha = 0.07;
  X.setTransform(1, 0, 0, 1, (hash(fi) * 256) | 0, (hash(fi + 0.5) * 256) | 0);
  X.fillStyle = A.grain[fi % 4]; X.fillRect(-256, -256, W + 512, H + 512);
  screenX(); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over';
  const endFade = smooth(inv(59.5, 60, t));
  if (endFade > 0) { X.fillStyle = rgba([0, 0, 0], endFade); X.fillRect(0, 0, W, H); }
}

function renderFrame(t) {
  X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over';
  gx.setTransform(1, 0, 0, 1, 0, 0); gx.globalCompositeOperation = 'source-over'; gx.clearRect(0, 0, G.width, G.height);
  if (t < 8.6) {
    drawCreation(t);
  } else {
    CAM = camAt(t);
    const dn = dawnAt(t), lf = t < 38 ? lightning(t) : 0;
    const info = { lf };
    const Cs = ws(XC, -770);
    drawSky(t, dn, lf, Cs);
    drawSun(t, Cs);
    drawClouds(t, dn, lf, Cs);
    for (const k of STRIKES) if (k.p === 0.25) drawBolt(k, t);
    const d2 = smooth(inv(39.5, 42.5, t));
    drawRidge(0.25, farY, mix3(mix3([15, 19, 28], [48, 56, 76], lf * 0.5), [158, 132, 162], dn), [mix3([22, 27, 38], [236, 186, 150], dn), 0.8]);
    const Lm = drawRidge(0.55, midY, mix3(mix3([9, 11, 17], [26, 30, 42], lf * 0.4), mix3([74, 80, 92], [62, 88, 72], d2), dn), [mix3([14, 17, 25], [210, 160, 140], dn), 0.55]);
    drawFarLights(t);
    for (const k of STRIKES) if (k.p === 1) drawBolt(k, t);
    drawHill(t, dn, info);
    const L = drawGround(t, dn);
    drawTrees(t, dn, L);
    drawRay(t);
    drawFootprints(t);
    drawBearers(t, dn, info);
    drawTraveller(t, info);
    drawGrass(t, dn, setLayer(X, 1));
    drawDove(t);
    drawFlock(t);
    drawSparks(t, info);
    info.lightsAll = [{ p: [info.lantern[0], info.lantern[1]] }].concat(info.lights || []);
    drawRising(t, info);
    drawRain(t);
    drawClimax(t, info);
    drawGlory(t);
  }
  composeGlow();
  drawDescent(t);
  finish(t);
}

// ------------------------------------------------------------ boot
buildPuffs(); buildNebula(); buildStars(); buildGrain(); buildTrees(); buildField(); buildCast();
window.renderFrame = renderFrame;
window.FILM_READY = true;
if (location.hash === '#play') {
  const t0 = performance.now();
  const loop = () => { const t = ((performance.now() - t0) / 1000) % DUR; renderFrame(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
} else if (location.hash.startsWith('#t=')) {
  renderFrame(parseFloat(location.hash.slice(3)));
}
