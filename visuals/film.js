'use strict';
// ============================================================
//  LAST LIGHT — procedural 2D animated short (60 s, 1920x1080)
//  Everything is a pure function of time t -> frame (random access).
// ============================================================

// ---------------------------------------------------------------- canvases
const mainC = document.getElementById('c');
const M = mainC.getContext('2d');
const [glowC, G] = makeCanvas(W, H);
const [b1c, B1] = makeCanvas(W / 4, H / 4);
const [b2c, B2] = makeCanvas(W / 8, Math.round(H / 8));
const [b3c, B3] = makeCanvas(W / 16, Math.round(H / 16));
const [b4c, B4] = makeCanvas(W / 32, Math.round(H / 32));
const PIPW = 460, PIPOX = 230, PIPOY = 350;
const [pipC, PC] = makeCanvas(PIPW, PIPW);
const [fgC, FG] = makeCanvas(W / 2, H / 2);

// ---------------------------------------------------------------- constants
const SKY_P = 0.35, MTN_P = 0.42, FAR_P = 0.56, MID_P = 0.75, FG_P = 1.4;
const STAR_X = 172;                       // where the star lands / the tree grows
const PIP_R = 44;
const WINKS = [2.2, 2.9, 3.5, 4.0, 4.4, 4.8, 5.1, 5.4, 5.65, 5.9, 6.1, 6.3];
const GOLD_SKY = [-340, -560];
const C = {
  gold: [255, 206, 120], goldCore: [255, 244, 214], amber: [255, 158, 61], white: [255, 255, 255],
  pink: [255, 120, 185], magenta: [226, 84, 206], peach: [255, 184, 140], cyan: [120, 225, 255],
  teal: [70, 220, 190], violet: [160, 120, 255], blueW: [190, 210, 255], lightning: [200, 215, 255],
};

// ---------------------------------------------------------------- sprites
const SPR = {};
function glowSprite(col, hard = 0.0) {
  const key = col.join(',') + '|' + hard;
  if (SPR[key]) return SPR[key];
  const [c, x] = makeCanvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, rgba(mix3(col, [255, 255, 255], 0.6), 1));
  g.addColorStop(0.06 + hard * 0.15, rgba(col, 0.9));
  g.addColorStop(0.22 + hard * 0.1, rgba(col, 0.32));
  g.addColorStop(0.5, rgba(col, 0.08));
  g.addColorStop(1, rgba(col, 0));
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  SPR[key] = c; return c;
}
function streakSprite(col) {
  const key = 'streak' + col.join(',');
  if (SPR[key]) return SPR[key];
  const [c, x] = makeCanvas(512, 32);
  const g = x.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, 1)); g.addColorStop(1, rgba(col, 0));
  x.fillStyle = g;
  const v = x.createLinearGradient(0, 0, 0, 32);
  x.fillRect(0, 0, 512, 32);
  x.globalCompositeOperation = 'destination-in';
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, 512, 32);
  SPR[key] = c; return c;
}
function dot(ctx, sp, x, y, r, a) {
  if (a <= 0.004 || r <= 0.05) return;
  while (a > 0.004) { ctx.globalAlpha = Math.min(a, 1); ctx.drawImage(sp, x - r, y - r, 2 * r, 2 * r); a -= 1; }
}
function flare(ctx, x, y, len, thick, a, col, rot = 0) {
  if (a <= 0.004) return;
  const sp = streakSprite(col);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sp, -len, -thick, 2 * len, 2 * thick);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(sp, -len * 0.7, -thick, 1.4 * len, 2 * thick);
  ctx.restore();
}

// ---------------------------------------------------------------- camera
const CAMK = [
  [0, 0, -1500, 1.0],
  [7.4, 0, -1430, 1.0, 'l'],
  [9.1, 60, -250, 1.0, 'io'],
  [11.3, -110, -200, 1.28, 'o'],
  [14.6, 70, -182, 1.4],
  [18.2, 126, -150, 1.6],
  [20.3, 110, -178, 1.45],
  [22.3, 122, -150, 1.56],
  [30.2, 124, -146, 1.62, 'l'],
  [32.4, 128, -95, 2.0],
  [36.8, 130, -82, 2.2, 'l'],
  [46.0, 110, -390, 0.78, 'o4'],
  [50.0, 100, -420, 0.76, 'l'],
  [54.0, 70, -1480, 0.8, 'io'],
  [55.6, 66, -1530, 0.8, 'l'],
  [57.4, 40, -335, 0.98, 'io'],
  [60, 36, -328, 1.0, 'l'],
];
function camBase(t) { const [cx, cy, z] = track(CAMK, t); return { cx, cy, z, shx: 0, shy: 0 }; }
function shakeAmp(t) {
  let a = 0;
  a += 9 * (t > 8.9 ? Math.exp(-(t - 8.9) / 0.25) : 0);
  a += 4.5 * stormAmt(t);
  a += 14 * (t > 24.6 ? Math.exp(-(t - 24.6) / 0.5) : 0);
  a += 20 * (t > 27.9 ? Math.exp(-(t - 27.9) / 0.6) : 0);
  a += 22 * (t > 36.8 ? Math.exp(-(t - 36.8) / 0.45) : 0);
  return a;
}
function camAt(t) {
  const c = camBase(t);
  const a = shakeAmp(t);
  c.shx = a * N1(t * 11, 3.3); c.shy = a * N2(t * 11, 8.8);
  // subtle handheld float
  c.shx += 2.0 * N3(t * 0.35, 1.1); c.shy += 1.5 * N3(t * 0.3, 9.9);
  return c;
}
function layer(cam, p) {
  const zp = 1 + (cam.z - 1) * p;
  return { zp, ox: W / 2 - cam.cx * p * zp + cam.shx * p, oy: H / 2 - cam.cy * p * zp + cam.shy * p };
}
const toS = (L, x, y) => [L.ox + x * L.zp, L.oy + y * L.zp];
const setL = (ctx, L) => ctx.setTransform(L.zp, 0, 0, L.zp, L.ox, L.oy);

// ---------------------------------------------------------------- terrain
const mtnTop = (x) => -120 - 140 * Math.pow(1 - Math.abs(N4(x * 0.0011, 3.1)), 2.2) - 60 * fbm(N2, x * 0.003, 9.1, 3);
const farTop = (x) => -62 + 55 * fbm(N2, x * 0.0013, 0.37, 3) + 26 * Math.sin(x * 0.0009 + 1.2);
const midTop = (x) => -14 + 34 * fbm(N3, x * 0.0019, 2.1, 3) + 12 * Math.sin(x * 0.0021 + 0.3);
const gY = (x) => 32 + 10 * Math.sin(x * 0.0031 + 0.9) + 6 * Math.sin(x * 0.0093 + 2.3) + 5 * N1(x * 0.004, 7.7);

// ---------------------------------------------------------------- timeline helpers
function stormAmt(t) {
  if (t < 20 || t > 30.7) return 0;
  if (t < 22.4) return 0.55 * eio((t - 20) / 2.4) + 0.45 * ein2((t - 20) / 2.4);
  if (t < 30.0) return 1;
  return 1 - eio((t - 30.0) / 0.65);
}
function gust(t) { return 0.5 + 0.5 * fbm(N4, t * 0.9, 4.4, 3); }
function lightningFlash(t) {
  let f = 0;
  for (const [t0, k] of [[24.5, 0.8], [27.8, 1.1]]) {
    const d = t - t0; if (d < 0 || d > 0.6) continue;
    const pat = (d < 0.05 ? 1 : d < 0.09 ? 0.15 : d < 0.18 ? 0.85 : 0.85 * Math.exp(-(d - 0.18) / 0.12));
    f = Math.max(f, pat * k);
  }
  return f;
}
// warm/life front radius (world units, action plane)
function frontR(t) { if (t < 38.4) return 0; const u = clamp((t - 38.4) / 7.2); return 3800 * Math.pow(u, 1.35); }
const skyWarm = (t) => smooth(inv(39, 50, t));
const lifeAmt = (t) => smooth(inv(38.4, 44, t));

// star intensity (the fallen star)
function starI(t) {
  if (t < 8.9) return 1;
  let I;
  if (t < 20) {
    const hb = Math.pow(0.5 + 0.5 * Math.sin((t - 9) * TAU * 0.95), 6);
    I = 0.82 + 0.2 * hb + 1.8 * Math.exp(-(t - 8.9) / 0.35);
    I += 0.9 * (t > 15.5 ? Math.exp(-(t - 15.5) / 0.4) : 0);
    I += 0.25 * bump(t, 17.9, 18.6, 19.5, 20);
  } else if (t < 30.6) {
    const base = lerp(1.0, 0.22, smooth(inv(21.5, 30, t)));
    const fl = 0.65 + 0.35 * N2(t * 7, 3.7) - 0.25 * (gust(t) - 0.5) * stormAmt(t);
    I = base * clamp(fl, 0.25, 1.2);
    I *= 1 - 0.55 * smooth(inv(29.6, 30.6, t));
  } else if (t < 36.8) {
    I = 0.11;
    I += 0.05 * pulse(t, 31.0, 0.08, 0.35) + 0.03 * pulse(t, 32.1, 0.08, 0.35);
    I += 0.05 * bump(t, 34.3, 34.8, 35.0, 35.4);
    I += 0.22 * pulse(t, 35.3, 0.08, 0.3) + 0.42 * pulse(t, 36.0, 0.08, 0.3);
    I += 0.5 * ein2(inv(36.3, 36.8, t));
  } else {
    I = 1.3 + 6 * Math.exp(-(t - 36.8) / 0.3);
  }
  return I;
}

// ---------------------------------------------------------------- PIP (the creature)
const PIPX = [
  [0, -440], [11.45, -440], [12.0, -300, 'l'], [12.25, -300], [12.8, -170, 'l'], [13.05, -170], [13.6, -50, 'l'],
  [13.85, -50], [14.4, 62, 'l'], [15.3, 104, 'io'], [15.5, 112, 'o'], [15.7, 112], [16.1, 62, 'l'], [17.2, 62],
  [17.9, 120, 'io'], [36.85, 120], [37.6, -20, 'l'], [60, -20],
];
const HOPS = [
  [11.45, 12.0, 150], [12.25, 12.8, 72], [13.05, 13.6, 72], [13.85, 14.4, 60], [15.7, 16.1, 55],
  [16.25, 16.5, 28], [16.75, 17.0, 28], [36.85, 37.6, 90], [57.6, 57.95, 50],
];
const BLINKS = [11.33, 14.9, 17.35, 19.25, 23.9, 31.9, 38.25, 41.2, 47.6, 49.3, 56.2];
const LOOK = [
  [0, 1, 0], [11.3, 0.9, 0.1], [14.5, 1, 0.35], [15.4, 1, 0.55], [16.0, 0.4, 0.1], [17.3, 0.9, 0.4],
  [18.4, 0.55, 0.75], [20.3, 0.55, 0.75], [20.8, -1, -0.15, 'o'], [21.9, -1, -0.25], [22.4, 0.5, 0.6],
  [30.9, 0.5, 0.65], [31.6, 0.5, 0.85], [36.6, 0.6, 0.8], [37.3, 0.6, -0.1], [39.5, 0.7, -0.75],
  [46, 0.6, -0.85], [50.3, 0.3, -1], [56.0, -0.5, -1], [60, -0.5, -1],
];
function hopState(t) {
  let jump = 0, sx = 1, sy = 1, air = false;
  for (const [t0, t1, h] of HOPS) {
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0); jump = h * 4 * u * (1 - u); air = true;
      const st = 0.16 * Math.cos(u * Math.PI); sy *= 1 + st; sx *= 1 - st * 0.7;
    }
    const da = t0 - t; if (da > 0 && da < 0.2) { const a = Math.sin((1 - da / 0.2) * Math.PI * 0.5); sy *= 1 - 0.2 * a; sx *= 1 + 0.16 * a; }
    const dl = t - t1; if (dl > 0 && dl < 0.7) { const s = -0.2 * Math.exp(-dl * 8) * Math.cos(dl * 24); sy *= 1 + s; sx *= 1 - s * 0.8; }
  }
  return { jump, sx, sy, air };
}
function pipState(t) {
  const x0 = track1(PIPX, t);
  const hs = hopState(t);
  const ps = { x: x0, jump: hs.jump, sx: hs.sx, sy: hs.sy, lean: 0 };
  // hiding / peeking behind the rock
  let hide = 52;
  if (t > 11.0) hide = lerp(52, -22, eback(inv(11.0, 11.3, t)));
  if (t > 11.45) hide = lerp(-22, 0, inv(11.45, 11.6, t));
  if (t > 11.6) hide = 0;
  ps.hide = hide;
  // walking waddle
  if (t > 17.2 && t < 17.9) { const w = (t - 17.2) / 0.7; ps.jump += Math.abs(Math.sin(w * Math.PI * 4)) * 7; ps.lean += Math.sin(w * Math.PI * 4) * 0.08; }
  if (t > 14.4 && t < 15.3) { const w = (t - 14.4) / 0.9; ps.jump += Math.abs(Math.sin(w * Math.PI * 3)) * 3; }
  // poke lean
  ps.lean += 0.32 * bump(t, 15.25, 15.48, 15.55, 15.72);
  ps.lean -= 0.18 * bump(t, 15.7, 15.8, 15.95, 16.1);
  // pick up: bend
  const bend = bump(t, 17.85, 18.05, 18.2, 18.5); ps.sy *= 1 - 0.12 * bend; ps.sx *= 1 + 0.08 * bend; ps.lean += 0.15 * bend;
  // idle breathing
  ps.sy *= 1 + 0.018 * Math.sin(t * 2.6); ps.sx *= 1 - 0.01 * Math.sin(t * 2.6);
  // storm curl
  const curl = bump(t, 21.9, 22.7, 30.3, 31.4); ps.curl = curl;
  const S = stormAmt(t);
  ps.sy *= 1 - 0.2 * curl; ps.sx *= 1 + 0.16 * curl; ps.lean += 0.12 * curl + 0.05 * curl * (gust(t) - 0.5);
  ps.x += -7 * S * (gust(t) - 0.5) * (1 - curl * 0.5);
  // inhale/exhale
  ps.inflate = 1 + 0.17 * bump(t, 33.0, 34.0, 34.15, 35.0);
  ps.blow = bump(t, 34.15, 34.3, 34.9, 35.1);
  // ignition knock-back lean
  ps.lean -= 0.22 * bump(t, 36.8, 36.9, 37.3, 37.6);
  // sitting
  const sit = smooth(inv(37.6, 38.3, t)); ps.sit = sit;
  ps.sy *= 1 - 0.07 * sit; ps.sx *= 1 + 0.04 * sit;
  // eyes
  const [lx, ly] = track(LOOK, t); ps.lx = lx; ps.ly = ly;
  let open = 1; for (const b of BLINKS) { const d = Math.abs(t - b); if (d < 0.09) open = Math.min(open, d / 0.09); }
  ps.open = open;
  ps.wide = bump(t, 15.5, 15.55, 15.9, 16.3) + 0.8 * bump(t, 20.4, 20.6, 21.5, 21.9) + bump(t, 36.8, 36.85, 37.8, 38.6) + 0.35 * bump(t, 39, 40, 49, 50);
  ps.happy = bump(t, 16.25, 16.35, 17.1, 17.3) + bump(t, 18.6, 19.0, 19.9, 20.25) + bump(t, 57.55, 57.65, 60, 61);
  ps.squeeze = clamp(bump(t, 22.6, 22.9, 30.0, 30.5) - bump(t, 25.9, 26.05, 26.6, 26.75) - bump(t, 28.9, 29.0, 29.3, 29.4));
  ps.sad = bump(t, 30.8, 31.6, 32.9, 33.2);
  ps.closed = bump(t, 33.0, 33.2, 34.95, 35.15);
  ps.holding = smooth(inv(17.95, 18.4, t)) * (1 - smooth(inv(36.8, 36.95, t)));
  ps.droop = clamp(bump(t, 30.7, 31.8, 36.8, 37.3) + 0.35 * curl);
  ps.flower = smooth(inv(44.0, 45.0, t));
  ps.sproutWind = S * (0.7 + 0.6 * (gust(t) - 0.5)) + 0.25 * bump(t, 50, 50.6, 51.8, 52.6);
  ps.feetY = gY(ps.x) + ps.hide;
  return ps;
}
function heldPos(ps) { // world position of the star held in Pip's arms
  const R = PIP_R * ps.inflate, bh = R * ps.sy;
  const lx = R * ps.sx * lerp(0.58, 0.42, ps.curl), ly = -bh * lerp(0.46, 0.36, ps.curl);
  const c = Math.cos(ps.lean), s = Math.sin(ps.lean);
  return [ps.x + lx * c - ly * s, ps.feetY - ps.jump + lx * s + ly * c];
}

// ---------------------------------------------------------------- static generation
const R0 = rng(9001);
// background stars
const bgStars = [];
for (let i = 0; i < 1100; i++) {
  const r = R0; const m = Math.pow(r(), 2.8);
  const tints = [[255, 255, 255], [200, 215, 255], [255, 232, 205], [222, 205, 255], [205, 245, 255]];
  bgStars.push({
    x: (r() * 2 - 1) * 1750, y: -1500 + r() * 1850, size: 0.55 + m * 2.3, b: 0.3 + 0.7 * r(),
    tw: 1 + r() * 4, ph: r() * TAU, die: 1.5 + Math.pow(r(), 0.85) * 4.85, born: 52.2 + r() * 4.3,
    col: tints[(r() * tints.length) | 0],
  });
}
const winkStars = [[420, -820], [-620, -420], [210, -300], [-150, -900], [700, -560], [-820, -760], [520, -180],
  [-420, -250], [60, -620], [860, -880], [-700, -150], [330, -980]].map((p, i) => ({ x: p[0], y: p[1], tw: WINKS[i], size: 2.2 + hash(i) * 1.4 }));

// falling star path (action-plane world coords)
const FALL = (() => {
  const t0 = 7.5, cam = camBase(t0), Ls = layer(cam, SKY_P), L1 = layer(cam, 1);
  const [sx, sy] = toS(Ls, GOLD_SKY[0], GOLD_SKY[1]);
  const P0 = [(sx - L1.ox) / L1.zp, (sy - L1.oy) / L1.zp];
  const P2 = [STAR_X, gY(STAR_X) - 7];
  const P1 = [lerp(P0[0], P2[0], 0.95) + 120, lerp(P0[1], P2[1], 0.3)];
  return { P0, P1, P2 };
})();
const bez = (P0, P1, P2, s) => [(1 - s) * (1 - s) * P0[0] + 2 * (1 - s) * s * P1[0] + s * s * P2[0], (1 - s) * (1 - s) * P0[1] + 2 * (1 - s) * s * P1[1] + s * s * P2[1]];
const fallS = (t) => Math.pow(clamp((t - 7.5) / 1.4), 1.9);
const fallPos = (t) => bez(FALL.P0, FALL.P1, FALL.P2, fallS(t));
const fallSparks = []; for (let i = 0; i < 260; i++) {
  const r = R0; fallSparks.push({ t0: 7.5 + 1.4 * Math.pow(i / 260, 0.7), vx: (r() - 0.5) * 60, vy: (r() - 0.7) * 60, life: 0.5 + r() * 1.1, sz: 1 + r() * 2.5, col: r() < 0.3 ? C.white : r() < 0.6 ? C.gold : C.amber });
}
const impactSand = []; for (let i = 0; i < 140; i++) {
  const r = R0; const a = -Math.PI / 2 + (r() - 0.5) * 2.4; const sp = 120 + r() * 520;
  impactSand.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + r() * 1.0, sz: 1 + r() * 2.4, glow: r() < 0.35 });
}
// dead trees (segments relative to base)
function genDeadTree(seed, size) {
  const r = rng(seed), segs = [], tips = [];
  (function br(x, y, a, len, w, d) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    const mx = (x + x2) / 2 + (r() - 0.5) * len * 0.3, my = (y + y2) / 2 + (r() - 0.5) * len * 0.3;
    segs.push([x, y, mx, my, x2, y2, w]);
    if (d >= 5 || len < 6) { tips.push([x2, y2]); return; }
    const n = r() < 0.35 ? 3 : 2;
    for (let k = 0; k < n; k++) br(x2, y2, a + (k - (n - 1) / 2) * (0.5 + r() * 0.5) + (r() - 0.5) * 0.4, len * (0.62 + r() * 0.2), w * 0.62, d + 1);
  })(0, 0, -Math.PI / 2 + (r() - 0.5) * 0.3, size * 0.38, size * 0.07, 0);
  return { segs, tips };
}
const deadMid = [[-1180, 90, 5], [-560, 70, 6], [640, 110, 7], [1260, 80, 8], [-1750, 100, 9], [1850, 95, 10]].map(([x, s, sd]) => ({ x, tree: genDeadTree(sd, s) }));
const deadNear = [[-860, 210, 21], [900, 170, 22]].map(([x, s, sd]) => ({ x, tree: genDeadTree(sd, s) }));
// rock Pip hides behind
const ROCK = { x: -410, pts: [[-88, 8], [-80, -22], [-58, -46], [-20, -58], [18, -55], [52, -40], [76, -18], [86, 8]].map(([a, b]) => [a * 1.3, b * 1.3]) };
const specks = []; for (let i = 0; i < 1600; i++) { const r = R0; specks.push({ x: -2000 + r() * 4400, dy: 4 + Math.pow(r(), 1.2) * 330, s: 0.8 + r() * 1.6, a: 0.04 + r() * 0.1 }); }
const ripples = []; for (let i = 0; i < 90; i++) { const r = R0; ripples.push({ x: -1900 + r() * 4000, dy: 12 + Math.pow(r(), 1.3) * 300, len: 60 + r() * 260, c: (r() - 0.5) * 16 }); }

// the tree of light
const TREE = [];
const DURS = [1.0, 1.0, 1.0, 1.0, 0.8, 0.7, 0.62];
const timeAt = (al) => 1 - Math.cbrt(1 - clamp(al, 0, 0.9999));
(function genTree() {
  const r = rng(4242);
  const LEAFC = [[40, 150, 130], [30, 120, 120], [60, 170, 140], [34, 100, 110]];
  const BLOSC = [C.pink, C.magenta, C.peach, [255, 236, 200], C.pink, [255, 150, 210], C.cyan];
  function add(parent, along, rel, len, th, depth, t0) {
    const dur = DURS[depth];
    const b = { parent, along, rel, len, th, depth, t0, dur, bend: (r() - 0.5) * 0.4, kids: [], leaves: [], blos: [], ph: r() * TAU, id: TREE.length };
    TREE.push(b); if (parent) parent.kids.push(b);
    if (depth < 6) {
      const n = depth === 0 ? 3 : (r() < 0.5 ? 2 : 3);
      const spread = depth === 0 ? 0.95 : 0.55 + r() * 0.3;
      for (let k = 0; k < n; k++) {
        const main = k === Math.floor(n / 2);
        const al = depth === 0 ? [0.88, 1, 0.94][k] : (main ? 1 : 0.6 + r() * 0.38);
        const a = (k - (n - 1) / 2) * spread + (r() - 0.5) * 0.3;
        add(b, al, a, len * (0.74 + r() * 0.12) * (main ? 1 : 0.9), th * 0.6, depth + 1, t0 + dur * timeAt(al));
      }
    }
    if (depth >= 3) {
      const nl = [0, 0, 0, 5, 7, 8, 10][depth];
      for (let i = 0; i < nl; i++) {
        const a = 0.25 + r() * 0.75;
        b.leaves.push({ a, off: (r() - 0.5) * 44, ang: (r() - 0.5) * 3, sz: 7 + r() * 8, col: LEAFC[(r() * 4) | 0], t: t0 + dur * timeAt(a) + 0.15 + r() * 0.6 });
      }
    }
    if (depth >= 4) {
      const nb = [0, 0, 0, 0, 3, 4, 6][depth];
      for (let i = 0; i < nb; i++) {
        const a = 0.35 + r() * 0.65;
        const bl = { a, off: (r() - 0.5) * 40, sz: 4.5 + r() * 5.5, col: BLOSC[(r() * BLOSC.length) | 0], t: 43.0 + (depth - 4) * 0.55 + r() * 1.9, rot: r() * TAU, td: 1e9 };
        if (r() < 0.62) bl.td = 50.0 + Math.pow(r(), 0.9) * 3.4;
        b.blos.push(bl);
      }
    }
  }
  add(null, 0, 0, 205, 84, 0, 38.5);
})();
const treeGrowAll = (t) => smooth(inv(38.5, 45, t));
function treeSway(t, b) {
  const wind = 1 + 2.6 * bump(t, 49.8, 50.5, 51.8, 53);
  return (0.006 + 0.007 * b.depth) * Math.sin(t * 0.85 + b.ph + b.depth * 0.4) * wind + 0.012 * b.depth * bump(t, 49.8, 50.5, 51.8, 53);
}
// forward kinematics: fills b.P0,b.P1,b.P2,b.ang,b.g (in world coords of action plane)
function treeFK(t) {
  const base = [STAR_X, gY(STAR_X) + 4];
  for (const b of TREE) {
    let P, ang;
    if (!b.parent) { P = base; ang = -Math.PI / 2; } else {
      const p = b.parent; P = bez(p.P0, p.P1, p.P2, b.along);
      ang = p.ang + b.rel;
      ang = lerp(ang, -Math.PI / 2, 0.04 + 0.015 * b.depth); // phototropism
    }
    ang += treeSway(t, b);
    const L = b.len;
    const P2 = [P[0] + Math.cos(ang) * L, P[1] + Math.sin(ang) * L];
    const P1 = [(P[0] + P2[0]) / 2 - Math.sin(ang) * b.bend * L, (P[1] + P2[1]) / 2 + Math.cos(ang) * b.bend * L];
    b.P0 = P; b.P1 = P1; b.P2 = P2; b.ang = ang;
    b.g = t < b.t0 ? 0 : eout((t - b.t0) / b.dur);
  }
}
function attachPoint(b, a, off) {
  const p = bez(b.P0, b.P1, b.P2, a);
  return [p[0] - Math.sin(b.ang) * off, p[1] + Math.cos(b.ang) * off];
}
// petals that fly up and become stars
const PETALS = [];
let GOLD_PETAL = null;
(function genPetals() {
  treeFK(50.0);
  const r = rng(555);
  let top = null;
  for (const b of TREE) for (const bl of b.blos) {
    const p = attachPoint(b, bl.a, bl.off);
    if (!top || p[1] < top.p[1]) top = { p, bl };
    if (bl.td > 100) continue;
    const pe = { p0: p, td: bl.td, col: bl.col, sz: bl.sz * 0.55, vx: (r() - 0.5) * 520 + 70, vy: 90 + r() * 140, ay: 300 + r() * 380,
      A: 20 + r() * 50, w: 2 + r() * 3, ph: r() * TAU, dur: 2.0 + r() * 2.0, spin: (r() - 0.5) * 10 };
    pe.tc = pe.td + pe.dur;
    // sky coordinates where it becomes a star
    const c = camBase(pe.tc), L1 = layer(c, 1), Ls = layer(c, SKY_P);
    const [wx, wy] = petalPos(pe, pe.tc);
    const [sx, sy] = toS(L1, wx, wy);
    pe.sky = [(sx - Ls.ox) / Ls.zp, (sy - Ls.oy) / Ls.zp];
    pe.ssize = 0.8 + Math.pow(r(), 2) * 2.2; pe.tw = 1 + r() * 4; pe.tph = r() * TAU;
    PETALS.push(pe);
  }
  top.bl.td = 51.2;
  GOLD_PETAL = { p0: top.p, td: 51.2, tc: 54.8 };
})();
function petalPos(pe, t) {
  const u = t - pe.td;
  return [pe.p0[0] + pe.vx * u + pe.A * Math.sin(pe.w * u + pe.ph) * (0.4 + u * 0.5), pe.p0[1] - (pe.vy * u + 0.5 * pe.ay * u * u)];
}
// meadow
const GRASS = []; const FLOWERS = []; const MIDGRASS = []; const MIDFLOW = []; const FARSPECK = [];
(function genMeadow() {
  const r = rng(777);
  const rows = [[0, 2.6, 1.0], [30, 3.4, 1.25], [80, 4.2, 1.5], [150, 5.5, 1.9], [240, 7, 2.4]];
  for (const [dy, step, sc] of rows) {
    for (let x = -2000; x < 2400; x += step * (0.6 + r() * 0.8)) {
      GRASS.push({ x, dy: dy + r() * 30, h: (14 + r() * 30) * sc, lean: (r() - 0.5) * 0.5, c: (r() * 4) | 0, ph: r() * TAU, w: (1.3 + r() * 1.2) * sc * 0.8 });
    }
  }
  GRASS.sort((a, b) => a.dy - b.dy);
  const FC = [C.pink, C.magenta, C.peach, [255, 240, 200], C.cyan, C.violet, C.pink];
  for (let i = 0; i < 520; i++) { const dy = Math.pow(r(), 1.4) * 280; FLOWERS.push({ x: -2000 + r() * 4400, dy, s: (2.5 + r() * 3.5) * (1 + dy / 150), col: FC[(r() * FC.length) | 0], dl: r() * 1.2, ph: r() * TAU }); }
  for (let x = -2300; x < 2600; x += 3 + r() * 5) MIDGRASS.push({ x, h: 6 + r() * 12, lean: (r() - 0.5) * 0.6, c: (r() * 3) | 0 });
  for (let i = 0; i < 260; i++) MIDFLOW.push({ x: -2300 + r() * 4900, dy: r() * 40, col: FC[(r() * FC.length) | 0], s: 1.5 + r() * 2 });
  for (let i = 0; i < 220; i++) FARSPECK.push({ x: -2600 + r() * 5400, dy: r() * 50, col: FC[(r() * FC.length) | 0], s: 1 + r() * 1.6, ph: r() * TAU });
})();
const FIREFLIES = []; for (let i = 0; i < 90; i++) { const r = R0; FIREFLIES.push({ x: -900 + r() * 2200, y: -520 + r() * 540, ax: 30 + r() * 60, ay: 20 + r() * 40, fa: 0.3 + r() * 0.6, fb: 0.2 + r() * 0.5, ph: r() * TAU, t0: 43.5 + r() * 3.5, bl: 0.8 + r() * 1.6, col: r() < 0.7 ? [200, 255, 170] : [255, 220, 140] }); }
// storm particles
const STORMP = []; for (let i = 0; i < 2800; i++) { const r = R0; STORMP.push({ x0: r() * (W + 800), y0: r() * H, d: 0.3 + Math.pow(r(), 1.5) * 1.4, sd: r() * 100, g: r() }); }
const WINDTAB = (() => { const a = new Float32Array(60 * 120 + 2); let acc = 0; for (let i = 0; i < a.length; i++) { const t = i / 120; a[i] = acc; acc += (stormAmt(t) * (0.7 + 0.6 * gust(t)) + 0.02) / 120; } return a; })();
const windPos = (t) => { const f = clamp(t, 0, 60) * 120; const i = Math.floor(f); return lerp(WINDTAB[i], WINDTAB[Math.min(i + 1, WINDTAB.length - 1)], f - i); };
const PUFFS = []; for (let i = 0; i < 150; i++) {
  const r = R0; const ly = i < 55 ? 0 : i < 105 ? 1 : 2;
  const y = ly === 0 ? H * (0.3 + r() * 0.55) : ly === 1 ? H * (0.1 + r() * 0.95) : H * (r() * 1.1 - 0.05);
  const s = ly === 0 ? 300 + r() * 380 : ly === 1 ? 420 + r() * 520 : 650 + r() * 700;
  PUFFS.push({ ly, x0: r() * (W + 1600), y, s, v: (r() * 4) | 0, rot: r() * TAU, spin: (r() - 0.5) * 0.5 });
}
const WALL = []; for (let i = 0; i < 90; i++) { const r = R0; WALL.push({ o: Math.pow(r(), 0.8) * 3400, y: -60 - Math.pow(r(), 0.9) * 1000, s: 260 + r() * 520, v: (r() * 4) | 0, rot: r() * TAU, spin: (r() - 0.5) * 0.4 }); }
const DUST = []; for (let i = 0; i < 420; i++) { const r = R0; DUST.push({ x: r() * W, y: r() * H, d: 0.4 + r() * 1.2, ph: r() * TAU }); }
const MOTES = []; for (let i = 0; i < 70; i++) { const r = R0; MOTES.push({ t0: 34.2 + r() * 0.75, dur: 0.6 + r() * 0.5, sw: (r() - 0.5) * 30, ph: r() * TAU, sz: 1 + r() * 2 }); }
const BURST = []; for (let i = 0; i < 320; i++) { const r = R0; const a = r() * TAU; const sp = 200 + Math.pow(r(), 0.6) * 900; BURST.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, life: 0.8 + r() * 1.8, sz: 1 + r() * 3, col: r() < 0.5 ? C.gold : r() < 0.7 ? C.white : C.pink }); }
// roots
const ROOTS = [];
(function genRoots() {
  const r = rng(31337);
  function grow(x, y, a, d0, len, w, depth) {
    let px = x, py = y, dist = d0;
    const steps = Math.floor(len / 14);
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 0.55; a = clamp(a, 0.1, Math.PI - 0.1);
      const nx = px + Math.cos(a) * 14, ny = py + Math.sin(a) * 14 * 0.42;
      ROOTS.push({ x1: px, y1: py, x2: nx, y2: ny, d: dist, w: w * (1 - i / steps * 0.6) });
      px = nx; py = ny; dist += 14;
      if (depth < 3 && r() < 0.05) grow(px, py, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), dist, len * 0.5, w * 0.6, depth + 1);
    }
  }
  const y0 = gY(STAR_X) + 6;
  for (let k = 0; k < 9; k++) { const a = 0.15 + (k / 8) * (Math.PI - 0.3) + (r() - 0.5) * 0.15; grow(STAR_X, y0, a, 0, 800 + r() * 900, 4.5, 0); }
})();
// lightning bolts (far layer coords)
function genBolt(seed, x0, y0, x1, y1) {
  const r = rng(seed); let pts = [[x0, y0], [x1, y1]];
  for (let it = 0; it < 7; it++) {
    const np = []; const disp = Math.hypot(x1 - x0, y1 - y0) * 0.16 / Math.pow(1.75, it);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]; np.push(a);
      np.push([(a[0] + b[0]) / 2 + (r() - 0.5) * 2 * disp, (a[1] + b[1]) / 2 + (r() - 0.5) * disp * 0.4]);
    }
    np.push(pts[pts.length - 1]); pts = np;
  }
  const branches = [];
  for (let k = 0; k < 5; k++) {
    const i = Math.floor(pts.length * (0.15 + r() * 0.55)); const s = pts[i];
    let bp = [s]; let a = Math.PI / 2 + (r() - 0.5) * 1.6; let p = s;
    for (let j = 0; j < 14; j++) { a += (r() - 0.5) * 0.8; p = [p[0] + Math.cos(a) * 26, p[1] + Math.abs(Math.sin(a)) * 20]; bp.push(p); }
    branches.push(bp);
  }
  return { pts, branches };
}
const BOLTS = [{ t: 24.5, b: genBolt(71, -520, -1500, -380, -60), k: 0.8 }, { t: 27.8, b: genBolt(72, 380, -1500, 240, -50), k: 1.1 }];

// ---------------------------------------------------------------- textures
function genTextures() {
  // cold nebula (sky coords [-1750,1750] x [-1550,450])
  const nw = 700, nh = 400;
  const [nc, nx] = makeCanvas(nw, nh); const img = nx.createImageData(nw, nh);
  const [gc, gx] = makeCanvas(nw, nh); const gimg = gx.createImageData(nw, nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const x = -1750 + (i / nw) * 3500, y = -1550 + (j / nh) * 2000;
    const n1 = fbm(N1, x * 0.0011, y * 0.0011, 5), n2 = fbm(N2, x * 0.0032 + 5, y * 0.0032, 4);
    const w = clamp(n1 * 0.9 + 0.25 + n2 * 0.35);
    const dens = Math.pow(w, 2.4);
    const c = mix3([40, 52, 120], [40, 95, 125], n2 * 0.5 + 0.5);
    const k = (j * nw + i) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = dens * 150;
    // warm galaxy band
    const s = clamp((x + 1750) / 3500);
    const ly = lerp(-120, -1250, s) + 90 * Math.sin(s * 5);
    const d = (y - ly) / 1.25;
    const band = Math.exp(-Math.pow(d / 300, 2)), core = Math.exp(-Math.pow(d / 110, 2));
    const n3 = fbm(N3, x * 0.0022, y * 0.0022, 6) * 0.5 + 0.5;
    const dust = smooth(inv(0.1, 0.5, fbm(N4, x * 0.004, y * 0.004, 5) * 0.5 + 0.5));
    let br = band * (0.35 + 0.8 * n3) + core * 0.6 * n3;
    br *= 1 - 0.75 * dust * core;
    br = clamp(br);
    const col = s < 0.5 ? mix3([70, 210, 215], [150, 100, 240], s * 2) : mix3([150, 100, 240], [255, 120, 175], (s - 0.5) * 2);
    const cc = mix3(col, [255, 240, 230], core * n3 * 0.5);
    gimg.data[k] = cc[0]; gimg.data[k + 1] = cc[1]; gimg.data[k + 2] = cc[2]; gimg.data[k + 3] = br * 235;
  }
  nx.putImageData(img, 0, 0); gx.putImageData(gimg, 0, 0);
  // galaxy speckles
  const rr = rng(4); gx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2600; i++) {
    const s = rr(); const x = s * nw; const ly = (lerp(-120, -1250, s) + 90 * Math.sin(s * 5) + 1550) / 2000 * nh;
    const y = ly + (rr() + rr() + rr() - 1.5) * 55;
    gx.fillStyle = `rgba(255,255,255,${0.2 + rr() * 0.6})`; gx.fillRect(x, y, rr() < 0.9 ? 0.6 : 1.2, rr() < 0.9 ? 0.6 : 1.2);
  }
  // storm fog (mirror-tiled)
  const fw = 640, fh = 360; const [fc, fx] = makeCanvas(fw, fh); const fimg = fx.createImageData(fw, fh);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
    const n = fbm(N2, i / 110, j / 70, 6), n2 = fbm(N3, i / 60 + 3, j / 60, 3);
    const a = smooth(n * 0.95 + 0.5);
    const c = mix3([52, 40, 34], [128, 102, 82], clamp(n2 * 0.6 + 0.5));
    const k = (j * fw + i) * 4; fimg.data[k] = c[0]; fimg.data[k + 1] = c[1]; fimg.data[k + 2] = c[2]; fimg.data[k + 3] = a * 255;
  }
  fx.putImageData(fimg, 0, 0);
  // smoke puffs
  const puffs = [];
  for (let v = 0; v < 4; v++) {
    const [c, x] = makeCanvas(256, 256); const im = x.createImageData(256, 256); const nz = makeNoise(300 + v);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const dx = (i - 128) / 128, dy = (j - 128) / 128, rr = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(nz, i / 55, j / 55, 5);
      const a = smooth((1 - rr) * 1.5 + n * 0.7 - 0.25);
      const col = mix3([58, 45, 38], [150, 122, 98], clamp(0.45 - dy * 0.45 + n * 0.5));
      const k = (j * 256 + i) * 4; im.data[k] = col[0]; im.data[k + 1] = col[1]; im.data[k + 2] = col[2]; im.data[k + 3] = a * 235;
    }
    x.putImageData(im, 0, 0); puffs.push(c);
  }
  // grain
  const grains = [];
  for (let g = 0; g < 6; g++) {
    const [c, x] = makeCanvas(W / 2, H / 2); const im = x.createImageData(W / 2, H / 2); const r = rng(100 + g);
    for (let k = 0; k < im.data.length; k += 4) { const v = 128 + (r() + r() + r() - 1.5) * 90; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; }
    x.putImageData(im, 0, 0); grains.push(c);
  }
  return { neb: nc, gal: gc, fog: fc, grains, puffs };
}
const TEX = genTextures();

// ================================================================ DRAWING
function drawSky(t, cam) {
  const L = layer(cam, 0.5);
  const hy = L.oy, top = hy - 1600 * L.zp;
  const S = stormAmt(t), sw = skyWarm(t);
  const cold = [[3, 4, 11], [8, 12, 30], [24, 31, 58]];
  const storm = [[9, 7, 7], [26, 19, 17], [58, 43, 34]];
  const warm = [[5, 6, 26], [22, 17, 70], [120, 52, 112]];
  const dim = 1 - 0.35 * smooth(inv(2, 7, t)) * (1 - sw);
  const cols = [0, 1, 2].map((i) => scale3(mix3(mix3(cold[i], storm[i], S), warm[i], sw), dim));
  const g = M.createLinearGradient(0, top, 0, hy + 40 * L.zp);
  g.addColorStop(0, rgba(cols[0])); g.addColorStop(0.62, rgba(cols[1])); g.addColorStop(1, rgba(cols[2]));
  M.setTransform(1, 0, 0, 1, 0, 0); M.globalCompositeOperation = 'source-over'; M.globalAlpha = 1;
  M.fillStyle = g; M.fillRect(0, 0, W, H);
  // warm horizon bloom in finale
  if (sw > 0) {
    const hg = M.createRadialGradient(W / 2, hy, 0, W / 2, hy, 1100 * L.zp);
    hg.addColorStop(0, `rgba(255,140,170,${0.28 * sw})`); hg.addColorStop(1, 'rgba(255,140,170,0)');
    M.globalCompositeOperation = 'lighter'; M.fillStyle = hg; M.fillRect(0, 0, W, H); M.globalCompositeOperation = 'source-over';
  }
}
function drawSkyObjects(t, cam) {
  const L = layer(cam, SKY_P);
  // nebula
  setL(M, L);
  const nebA = (0.75 - 0.4 * smooth(inv(2, 7, t))) * (1 - stormAmt(t) * 0.8) * (1 - smooth(inv(46, 54, t)) * 0.5);
  if (nebA > 0.01) { M.globalAlpha = nebA; M.drawImage(TEX.neb, -1750, -1550, 3500, 2000); }
  const galA = smooth(inv(51.5, 56.5, t));
  if (galA > 0.01) { M.globalCompositeOperation = 'lighter'; M.globalAlpha = galA * 0.9; M.drawImage(TEX.gal, -1750, -1550, 3500, 2000); M.globalCompositeOperation = 'source-over'; }
  M.globalAlpha = 1; M.setTransform(1, 0, 0, 1, 0, 0);
  const storm = 1 - stormAmt(t);
  // background stars
  G.globalCompositeOperation = 'lighter';
  const sprW = glowSprite(C.blueW);
  for (const s of bgStars) {
    let a;
    if (t < s.born) a = s.b * (1 - smooth((t - s.die) / 0.45)); else a = s.b * smooth((t - s.born) / 1.2);
    a *= t < 1 ? 1 : 1;
    if (a < 0.01) continue;
    a *= 0.72 + 0.28 * Math.sin(t * s.tw + s.ph);
    a *= storm;
    const [x, y] = toS(L, s.x, s.y);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
    const sz = s.size * L.zp;
    M.fillStyle = rgba(s.col, clamp(a));
    if (sz < 1.3) M.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    else { M.beginPath(); M.arc(x, y, sz * 0.6, 0, TAU); M.fill(); dot(G, sprW, x, y, sz * 5, a * 0.35); }
  }
  // wink stars
  const sprG = glowSprite([230, 235, 255]);
  for (const s of winkStars) {
    const d = t - s.tw; if (d > 0.5) continue;
    let a = 1, sz = s.size;
    if (d > -0.07 && d <= 0) { const u = (d + 0.07) / 0.07; a = 1 + 1.4 * u; sz *= 1 + 0.5 * u; }
    else if (d > 0) { const u = d / 0.35; a = 2.4 * (1 - eout(u)); sz *= 1.5 * (1 - eout(u)) + 0.01; }
    else a = 0.85 + 0.15 * Math.sin(t * 3 + s.x);
    if (a <= 0.01) continue;
    const [x, y] = toS(L, s.x, s.y);
    M.fillStyle = rgba([240, 244, 255], clamp(a)); M.beginPath(); M.arc(x, y, sz * 0.5, 0, TAU); M.fill();
    dot(G, sprG, x, y, sz * 9, a * 0.6);
    if (d > -0.07) flare(G, x, y, 40 * a, 2, a * 0.5, [220, 230, 255]);
  }
  // the gold star (before it falls / after it returns)
  if (t < 7.5) {
    let [x, y] = toS(L, GOLD_SKY[0], GOLD_SKY[1]);
    const tr = bump(t, 6.3, 6.6, 7.4, 7.5);
    x += tr * 2.5 * N1(t * 40, 1); y += tr * 2.5 * N2(t * 40, 2);
    const a = (0.95 + 0.05 * Math.sin(t * 2.2)) * (1 + 0.25 * tr * N3(t * 30, 5));
    drawGoldStar(x, y, 1.0 * a, t);
  }
  if (t > GOLD_PETAL.tc) {
    const [x, y] = toS(L, GOLD_SKY[0], GOLD_SKY[1]);
    let a = 0.9 + 0.1 * Math.sin(t * 2.5) + 1.2 * pulse(t, GOLD_PETAL.tc, 0.05, 0.5);
    a += 1.1 * pulse(t, 56.8, 0.06, 0.35) + 1.1 * pulse(t, 57.4, 0.06, 0.35) + 1.4 * pulse(t, 58.5, 0.08, 0.7);
    drawGoldStar(x, y, a * smooth(inv(GOLD_PETAL.tc - 0.2, GOLD_PETAL.tc + 0.1, t)), t);
  }
  // petal-stars (reborn sky)
  for (const pe of PETALS) {
    if (t < pe.tc) continue;
    const [x, y] = toS(L, pe.sky[0], pe.sky[1]);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const fl = pulse(t, pe.tc, 0.02, 0.35);
    const a = (0.75 + 0.25 * Math.sin(t * pe.tw + pe.tph)) + 1.5 * fl;
    const sz = pe.ssize * L.zp * (1 + fl);
    const col = mix3(pe.col, [255, 255, 255], 0.55);
    M.fillStyle = rgba(col, clamp(a)); M.beginPath(); M.arc(x, y, sz * 0.55, 0, TAU); M.fill();
    dot(G, glowSprite(pe.col), x, y, sz * 7, a * 0.45);
  }
  G.globalAlpha = 1;
}
function drawGoldStar(x, y, a, t) {
  const spr = glowSprite(C.gold), core = glowSprite(C.goldCore, 1);
  dot(G, spr, x, y, 90 * a, 0.55 * a);
  dot(G, core, x, y, 16 * a, a);
  flare(G, x, y, 70 * a, 2.5, 0.55 * a, [255, 225, 170], 0.08);
  M.fillStyle = rgba([255, 250, 235], clamp(a)); M.beginPath(); M.arc(x, y, 3.2, 0, TAU); M.fill();
}
function drawLightning(t, cam) {
  const L = layer(cam, FAR_P);
  for (const B of BOLTS) {
    const d = t - B.t; if (d < 0 || d > 0.5) continue;
    const f = lightningFlash(t) / B.k;
    if (f < 0.02) continue;
    G.globalCompositeOperation = 'lighter';
    setL(G, L); G.lineJoin = 'round'; G.lineCap = 'round';
    for (const [w, al] of [[16, 0.12], [7, 0.35], [2.6, 1]]) {
      G.strokeStyle = rgba(C.lightning, al * f); G.lineWidth = w / L.zp;
      G.beginPath(); B.b.pts.forEach((p, i) => (i ? G.lineTo(p[0], p[1]) : G.moveTo(p[0], p[1])));
      for (const br of B.b.branches) { G.moveTo(br[0][0], br[0][1]); for (const p of br) G.lineTo(p[0], p[1]); }
      G.stroke();
    }
    G.setTransform(1, 0, 0, 1, 0, 0);
  }
}
function drawPuff(ctx, v, x, y, sz, rot, a) {
  if (a <= 0.004) return;
  const sp = TEX.puffs[v];
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sp, -sz / 2, -sz / 2, sz, sz); ctx.restore();
}
function drawStormWall(t, cam) {
  if (t < 19.5 || t > 23.6) return;
  const L = layer(cam, FAR_P);
  const u = eio(inv(19.6, 22.6, t));
  const front = lerp(-2200, 2800, u);
  const a = smooth(inv(19.5, 20.4, t)) * (1 - smooth(inv(22.5, 23.6, t)));
  setL(M, L);
  for (const p of WALL) {
    const x = front - p.o + 30 * Math.sin(t * 0.7 + p.rot);
    const edge = smooth(p.o / 500);
    drawPuff(M, p.v, x, p.y, p.s, p.rot + t * p.spin, a * (0.35 + 0.65 * edge) * 0.95);
  }
  M.globalAlpha = 1; M.setTransform(1, 0, 0, 1, 0, 0);
}

// ---- terrain layers
function groundPath(L, fn, step = 6) {
  const xmin = (-L.ox) / L.zp - 40, xmax = (W - L.ox) / L.zp + 40, bottom = (H - L.oy) / L.zp + 40;
  const p = new Path2D(); p.moveTo(xmin, bottom);
  const st = step / L.zp;
  for (let x = xmin; x <= xmax + st; x += st) p.lineTo(x, fn(x));
  p.lineTo(xmax + st, bottom); p.closePath();
  const edge = new Path2D(); let first = true;
  for (let x = xmin; x <= xmax + st; x += st) { if (first) { edge.moveTo(x, fn(x)); first = false; } else edge.lineTo(x, fn(x)); }
  return { fill: p, edge, xmin, xmax, bottom };
}
function palette(warm, t) {
  const S = stormAmt(t);
  if (!warm) {
    const c = {
      mtn: [32, 39, 68], mtnB: [22, 27, 50], far: [27, 34, 58], farB: [17, 21, 38], mid: [20, 25, 42], midB: [12, 15, 27], near: [17, 20, 34], nearB: [8, 9, 17],
      rim: [130, 150, 210], tree: [10, 11, 20],
    };
    if (S > 0) for (const k in c) c[k] = mix3(c[k], scale3([60, 44, 36], k.endsWith('B') ? 0.4 : 0.75), S * 0.75);
    return c;
  }
  const cold = palette(false, t), life = lifeAmt(t);
  const wp = {
    mtn: [70, 58, 122], mtnB: [44, 38, 92], far: [38, 62, 104], farB: [30, 30, 76], mid: [26, 70, 86], midB: [22, 30, 60], near: [22, 64, 66], nearB: [14, 18, 38],
    rim: [150, 255, 220], tree: [20, 40, 50],
  };
  for (const k in wp) wp[k] = mix3(cold[k], wp[k], 0.25 + 0.75 * life);
  return wp;
}
function drawWorld(t, cam, warm, st) {
  const P = palette(warm, t);
  const life = warm ? lifeAmt(t) : 0;
  // ---------- distant mountains
  let L = layer(cam, MTN_P); setL(M, L);
  let gp = groundPath(L, mtnTop, 8);
  let g = M.createLinearGradient(0, -330, 0, 60); g.addColorStop(0, rgba(P.mtn)); g.addColorStop(1, rgba(P.mtnB));
  M.fillStyle = g; M.fill(gp.fill);
  M.strokeStyle = rgba(P.rim, 0.1); M.lineWidth = 1.2 / L.zp; M.stroke(gp.edge);
  // haze in front of mountains
  { const hz = mix3(P.mtn, [255, 255, 255], 0.08); const hg = M.createLinearGradient(0, -140, 0, 20); hg.addColorStop(0, rgba(hz, 0)); hg.addColorStop(1, rgba(hz, 0.5)); M.fillStyle = hg; M.fillRect(gp.xmin, -140, gp.xmax - gp.xmin, 400); }
  // ---------- far dunes
  L = layer(cam, FAR_P); setL(M, L);
  gp = groundPath(L, farTop, 8);
  g = M.createLinearGradient(0, -120, 0, 120); g.addColorStop(0, rgba(P.far)); g.addColorStop(1, rgba(P.farB));
  M.fillStyle = g; M.fill(gp.fill);
  M.strokeStyle = rgba(P.rim, 0.13); M.lineWidth = 1.3 / L.zp; M.stroke(gp.edge);
  if (warm) {
    for (const s of FARSPECK) {
      if (s.x < gp.xmin || s.x > gp.xmax) continue;
      const [x, y] = toS(L, s.x, farTop(s.x) + 6 + s.dy);
      dot(G, glowSprite(s.col), x, y, s.s * 6 * L.zp, 0.5 * life * (0.7 + 0.3 * Math.sin(t * 2 + s.ph)));
    }
  }
  // ---------- mid dunes
  L = layer(cam, MID_P); setL(M, L);
  gp = groundPath(L, midTop, 7);
  g = M.createLinearGradient(0, -60, 0, 160); g.addColorStop(0, rgba(P.mid)); g.addColorStop(1, rgba(P.midB));
  M.fillStyle = g; M.fill(gp.fill);
  M.strokeStyle = rgba(P.rim, 0.16); M.lineWidth = 1.4 / L.zp; M.stroke(gp.edge);
  for (const d of deadMid) {
    if (d.x < gp.xmin - 200 || d.x > gp.xmax + 200) continue;
    drawDeadTree(M, d, midTop(d.x) + 5, P, warm, t, L, 0.8);
  }
  if (warm) {
    M.lineCap = 'round';
    const gc = [[50, 150, 120], [70, 180, 130], [40, 120, 110]];
    for (let c = 0; c < 3; c++) {
      M.strokeStyle = rgba(gc[c], 0.9); M.lineWidth = 1.6 / L.zp; M.beginPath();
      for (const b of MIDGRASS) {
        if (b.c !== c || b.x < gp.xmin || b.x > gp.xmax) continue;
        const y = midTop(b.x) + 2; const h = b.h * life;
        const sw = Math.sin(t * 1.6 + b.x * 0.02) * 0.2 + b.lean;
        M.moveTo(b.x, y); M.lineTo(b.x + Math.sin(sw) * h, y - Math.cos(sw) * h);
      }
      M.stroke();
    }
    for (const f of MIDFLOW) {
      if (f.x < gp.xmin || f.x > gp.xmax) continue;
      const [x, y] = toS(L, f.x, midTop(f.x) + 4 + f.dy);
      dot(G, glowSprite(f.col), x, y, f.s * 6 * L.zp, 0.6 * life);
    }
  }
  { const hz = mix3(P.far, [255, 255, 255], 0.05); const hg = M.createLinearGradient(0, -40, 0, 60); hg.addColorStop(0, rgba(hz, 0)); hg.addColorStop(1, rgba(hz, 0.35)); M.fillStyle = hg; M.fillRect(gp.xmin, -40, gp.xmax - gp.xmin, 300); }
  // ---------- near ground (action plane)
  L = layer(cam, 1); setL(M, L);
  gp = groundPath(L, gY, 5);
  g = M.createLinearGradient(0, 0, 0, 420); g.addColorStop(0, rgba(P.near)); g.addColorStop(1, rgba(P.nearB));
  M.fillStyle = g; M.fill(gp.fill);
  M.strokeStyle = rgba(P.rim, 0.2); M.lineWidth = 1.5 / L.zp; M.stroke(gp.edge);
  // sand ripples
  M.lineWidth = 1.2 / L.zp;
  M.strokeStyle = warm ? 'rgba(120,230,190,0.06)' : 'rgba(150,165,215,0.07)';
  M.beginPath();
  for (const r of ripples) {
    if (r.x + r.len < gp.xmin || r.x > gp.xmax) continue;
    const y = gY(r.x) + r.dy;
    M.moveTo(r.x, y); M.quadraticCurveTo(r.x + r.len / 2, y + r.c, r.x + r.len, y);
  }
  M.stroke();
  // sand specks
  M.fillStyle = warm ? 'rgba(140,230,200,0.10)' : 'rgba(170,180,225,0.12)';
  M.beginPath();
  for (const s of specks) { if (s.x < gp.xmin || s.x > gp.xmax) continue; M.rect(s.x, gY(s.x) + s.dy, s.s, s.s * 0.6); }
  M.fill();
  // near dead trees
  for (const d of deadNear) { if (d.x < gp.xmin - 300 || d.x > gp.xmax + 300) continue; drawDeadTree(M, d, gY(d.x) + 4, P, warm, t, L, 1); }
  // crater
  if (t > 8.9) {
    const cy = gY(STAR_X) + 2;
    M.fillStyle = warm ? 'rgba(10,30,30,0.6)' : 'rgba(5,6,12,0.7)';
    M.beginPath(); M.ellipse(STAR_X, cy, 34, 7, 0, 0, TAU); M.fill();
    M.strokeStyle = warm ? 'rgba(140,255,210,0.2)' : 'rgba(170,180,230,0.18)'; M.lineWidth = 1.5 / L.zp;
    M.beginPath(); M.ellipse(STAR_X, cy - 1.5, 38, 8, 0, Math.PI, TAU); M.stroke();
  }
  // meadow grass & flowers
  if (warm) drawMeadow(t, L, gp, life);
  M.setTransform(1, 0, 0, 1, 0, 0); M.globalAlpha = 1;
}
function drawDeadTree(ctx, d, baseY, P, warm, t, L, sc) {
  ctx.save(); ctx.translate(d.x, baseY);
  ctx.strokeStyle = rgba(P.tree); ctx.lineCap = 'round';
  for (const s of d.tree.segs) { ctx.lineWidth = Math.max(s[6], 0.8 / L.zp); ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.quadraticCurveTo(s[2], s[3], s[4], s[5]); ctx.stroke(); }
  if (warm) {
    const life = lifeAmt(t);
    for (let i = 0; i < d.tree.tips.length; i++) {
      const [x, y] = d.tree.tips[i];
      const k = eback(clamp(life * 1.6 - hash(i + d.x) * 0.6));
      if (k <= 0) continue;
      ctx.fillStyle = rgba(i % 3 ? [50, 150, 120] : [70, 180, 140], 0.95);
      ctx.beginPath(); ctx.arc(x, y, (4 + hash(i * 3.1) * 5) * k * sc * 1.4, 0, TAU); ctx.fill();
      if (i % 2 === 0) { const [sx, sy] = toS(L, d.x + x, baseY + y); dot(G, glowSprite(i % 4 ? C.pink : C.peach), sx, sy, 10 * L.zp * k, 0.6 * k); }
    }
  }
  ctx.restore();
}
function drawMeadow(t, L, gp, life) {
  const R = frontR(t);
  const GC = [[46, 150, 110], [70, 190, 130], [34, 120, 104], [90, 205, 150]];
  M.lineCap = 'round';
  const wind = 0.35 * bump(t, 49.8, 50.5, 51.8, 53);
  for (let c = 0; c < 4; c++) {
    M.strokeStyle = rgba(GC[c]);
    // batch by width buckets
    for (const wb of [0, 1]) {
      M.beginPath(); let wsum = 0, n = 0;
      for (const b of GRASS) {
        if (b.c !== c || (b.w > 2.2) !== !!wb) continue;
        if (b.x < gp.xmin - 30 || b.x > gp.xmax + 30) continue;
        const dist = Math.abs(b.x - STAR_X) + b.dy * 0.8;
        const gr = eback(clamp((R - dist) / 260));
        if (gr <= 0.02) continue;
        const y = gY(b.x) + b.dy; const h = b.h * gr;
        const sw = b.lean + 0.14 * Math.sin(t * 1.7 + b.x * 0.013 + b.ph) + wind;
        const tx = b.x + Math.sin(sw) * h, ty = y - Math.cos(sw) * h;
        M.moveTo(b.x, y); M.quadraticCurveTo(b.x + Math.sin(sw) * h * 0.3, y - h * 0.6, tx, ty);
        wsum += b.w; n++;
      }
      if (n) { M.lineWidth = (wsum / n); M.stroke(); }
    }
  }
  // flowers
  for (const f of FLOWERS) {
    if (f.x < gp.xmin - 20 || f.x > gp.xmax + 20) continue;
    const dist = Math.abs(f.x - STAR_X) + f.dy * 0.8;
    const k = eback(clamp((R - dist - 150) / 200 - f.dl));
    if (k <= 0.02) continue;
    const y = gY(f.x) + f.dy - f.s * 2.2 * k;
    const s = f.s * k;
    M.fillStyle = rgba(f.col, 0.95);
    for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + f.ph; M.beginPath(); M.arc(f.x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.55, 0, TAU); M.fill(); }
    M.fillStyle = 'rgba(255,245,210,0.95)'; M.beginPath(); M.arc(f.x, y, s * 0.35, 0, TAU); M.fill();
    const [sx, sy] = toS(L, f.x, y);
    dot(G, glowSprite(f.col), sx, sy, s * 5 * L.zp, 0.5 * k * (0.8 + 0.2 * Math.sin(t * 2 + f.ph)));
  }
}
function drawRock(t, cam, st) {
  const L = layer(cam, 1); setL(M, L);
  const by = gY(ROCK.x) + 6;
  M.beginPath();
  ROCK.pts.forEach((p, i) => { const x = ROCK.x + p[0], y = by + p[1]; i ? M.lineTo(x, y) : M.moveTo(x, y); });
  M.closePath();
  const P = palette(false, t), PW = palette(true, t);
  const wk = smooth((frontR(t) - Math.abs(ROCK.x - STAR_X)) / 250);
  const g = M.createLinearGradient(0, by - 75, 0, by + 10);
  g.addColorStop(0, rgba(mix3(scale3(P.near, 1.5), [40, 110, 95], wk))); g.addColorStop(1, rgba(mix3(P.nearB, PW.nearB, wk)));
  M.fillStyle = g; M.fill();
  // star rim light on the rock
  if (st.lightI > 0.05) {
    const [lx, ly] = st.lightW;
    const rg = M.createRadialGradient(lx, ly, 0, lx, ly, 700);
    rg.addColorStop(0, rgba(C.gold, 0.55 * Math.min(st.lightI, 1.5))); rg.addColorStop(1, rgba(C.gold, 0));
    M.strokeStyle = rg; M.lineWidth = 2 / L.zp; M.stroke();
  }
  if (wk > 0) {
    M.strokeStyle = rgba([90, 200, 150], 0.9 * wk); M.lineWidth = 5; M.lineCap = 'round'; M.beginPath();
    ROCK.pts.forEach((p, i) => { if (i === 0 || i === ROCK.pts.length - 1) return; const x = ROCK.x + p[0], y = by + p[1] + 2; M.moveTo(x, y); M.lineTo(x + 3, y - 8 * wk); });
    M.stroke();
    for (let i = 1; i < ROCK.pts.length - 1; i += 2) { const [sx, sy] = toS(L, ROCK.x + ROCK.pts[i][0], by + ROCK.pts[i][1] - 4); dot(G, glowSprite(i % 4 === 1 ? C.pink : C.peach), sx, sy, 12 * L.zp * wk, 0.8 * wk); }
  }
  M.setTransform(1, 0, 0, 1, 0, 0);
}
// ground lighting from a point light (star / tree)
function lightGround(cam, lx, ly, radius, col, a) {
  if (a < 0.005) return;
  const L = layer(cam, 1);
  const [sx, sy] = toS(L, lx, ly);
  const r = radius * L.zp;
  M.save(); M.globalCompositeOperation = 'lighter';
  M.translate(sx, sy); M.scale(1, 0.55);
  const g = M.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(0.3, rgba(col, a * 0.4)); g.addColorStop(1, rgba(col, 0));
  M.fillStyle = g; M.fillRect(-r, -r, 2 * r, 2 * r);
  M.restore();
}

// ---- the star object (small, fallen)
function drawSmallStar(x, y, I, t, L, into = null) {
  const s = L.zp;
  const core = glowSprite(C.goldCore, 1), halo = glowSprite(C.gold), wide = glowSprite(C.amber);
  const Ic = Math.min(I, 3);
  dot(G, wide, x, y, 200 * s * Math.sqrt(Ic), 0.12 * Ic);
  dot(G, halo, x, y, 70 * s * Math.sqrt(Ic), 0.7 * Ic);
  dot(G, core, x, y, 18 * s * Math.sqrt(Ic), Math.min(1.5, Ic * 1.2));
  if (I > 0.5) flare(G, x, y, 90 * s * Math.min(I, 2), 2.2 * s, 0.25 * Math.min(I, 2), [255, 220, 160], 0.1 + t * 0.05);
  // solid star shape
  const ctx = into || M;
  if (!into) { ctx.setTransform(1, 0, 0, 1, 0, 0); }
  const r = 7.5 * s * (0.8 + 0.2 * Math.min(I, 1.3));
  ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.4);
  ctx.fillStyle = rgba(mix3([255, 180, 90], [255, 250, 230], clamp(I)), clamp(0.35 + I));
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.48 : r; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---- Pip
function bodyPath(k, bw, bh) {
  k.beginPath();
  k.moveTo(0, -2 * bh);
  k.bezierCurveTo(0.6 * bw, -2 * bh, bw, -1.5 * bh, bw, -0.9 * bh);
  k.bezierCurveTo(bw, -0.3 * bh, 0.74 * bw, 0, 0, 0);
  k.bezierCurveTo(-0.74 * bw, 0, -bw, -0.3 * bh, -bw, -0.9 * bh);
  k.bezierCurveTo(-bw, -1.5 * bh, -0.6 * bw, -2 * bh, 0, -2 * bh);
  k.closePath();
}
function drawPip(t, cam, ps, st) {
  const L = layer(cam, 1); const s = L.zp;
  const k = PC; k.setTransform(1, 0, 0, 1, 0, 0); k.clearRect(0, 0, PIPW, PIPW);
  k.setTransform(s, 0, 0, s, PIPOX, PIPOY);
  k.rotate(ps.lean);
  const R = PIP_R * ps.inflate, bw = R * ps.sx, bh = R * ps.sy;
  const S = stormAmt(t);
  // light direction (local)
  const [lwx, lwy] = st.lightW; const lx = lwx - ps.x, ly = lwy - (ps.feetY - ps.jump);
  const ld = Math.hypot(lx, ly) + 1e-3; const lI = st.lightI * clamp(160 / (ld + 40), 0, 1.6);
  // feet
  const footDrop = ps.jump > 2 ? 4 : 0;
  k.fillStyle = '#b9ae9f';
  for (const sgn of [-1, 1]) { k.beginPath(); k.ellipse(sgn * 0.42 * bw, -1 + footDrop, 0.24 * R, 0.12 * R, 0, 0, TAU); k.fill(); }
  // body
  bodyPath(k, bw, bh);
  const bg = k.createLinearGradient(0, -2 * bh, 0, 0);
  bg.addColorStop(0, '#fbf5ea'); bg.addColorStop(0.6, '#ece2d3'); bg.addColorStop(1, '#c9bcab');
  k.fillStyle = bg; k.fill();
  k.save(); bodyPath(k, bw, bh); k.clip();
  // ambient tint
  const amb = mix3(mix3([60, 80, 150], [70, 52, 44], S), [150, 90, 150], lifeAmt(t));
  k.fillStyle = rgba(amb, 0.3 - 0.1 * lifeAmt(t)); k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R);
  // storm darkening
  if (S > 0) { k.fillStyle = `rgba(20,14,12,${0.3 * S})`; k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R); }
  // warm key light
  if (lI > 0.01) {
    const gx = lx / ld * R * 1.2, gy = -bh + ly / ld * R * 1.2;
    const lg = k.createRadialGradient(gx, gy, 0, gx, gy, R * 2.4);
    lg.addColorStop(0, rgba([255, 214, 150], Math.min(0.9, 0.75 * lI))); lg.addColorStop(0.55, rgba([255, 190, 120], Math.min(0.5, 0.3 * lI))); lg.addColorStop(1, 'rgba(255,190,120,0)');
    k.fillStyle = lg; k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R);
  }
  // tree/sky fill light in finale
  const life = lifeAmt(t);
  if (life > 0) {
    const tg = k.createLinearGradient(bw, -2 * bh, -bw, 0);
    tg.addColorStop(0, rgba([255, 170, 210], 0.35 * life)); tg.addColorStop(1, 'rgba(255,170,210,0)');
    k.fillStyle = tg; k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R);
  }
  // form shadow (away from light)
  const shx = -(lx / ld) * R * 0.9 * (lI > 0.05 ? 1 : 0.3), shy = -bh;
  const sg = k.createRadialGradient(-shx * 0.3, shy - 0.3 * bh, R * 0.4, -shx * 0.3, shy - 0.3 * bh, R * 1.35);
  sg.addColorStop(0, 'rgba(30,20,50,0)'); sg.addColorStop(1, 'rgba(30,20,50,0.4)');
  k.fillStyle = sg; k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R);
  k.restore();
  // rim light
  if (lI > 0.03) {
    const rg = k.createLinearGradient(-lx / ld * R, -bh - ly / ld * R, lx / ld * R, -bh + ly / ld * R);
    rg.addColorStop(0, 'rgba(255,220,160,0)'); rg.addColorStop(0.7, 'rgba(255,220,160,0)'); rg.addColorStop(1, rgba([255, 226, 170], Math.min(1, lI)));
    bodyPath(k, bw, bh); k.strokeStyle = rg; k.lineWidth = 2.2; k.stroke();
  }
  if (life > 0.1) { bodyPath(k, bw, bh); k.strokeStyle = rgba([255, 190, 225], 0.35 * life); k.lineWidth = 1.2; k.stroke(); }
  // ---- face
  const dir = 1;
  const lookX = ps.lx, lookY = ps.ly;
  const faceX = 0.12 * bw * dir + lookX * 0.2 * bw;
  const eyeY = -1.12 * bh + lookY * 0.13 * bh;
  const sep = 0.36 * bw * (1 - 0.15 * Math.abs(lookX));
  const wide = 1 + 0.22 * clamp(ps.wide);
  const erx = 0.17 * R * wide, ery = 0.24 * R * wide;
  // blush
  k.fillStyle = `rgba(255,120,140,${0.28 + 0.12 * ps.happy})`;
  for (const sg2 of [-1, 1]) { k.beginPath(); k.ellipse(faceX + sg2 * (sep + 0.12 * R), eyeY + 0.3 * R, 0.12 * R, 0.065 * R, 0, 0, TAU); k.fill(); }
  const open = ps.open * (1 - ps.closed) * (1 - 0.35 * ps.sad);
  const mode = ps.squeeze > 0.5 ? 'sq' : ps.happy > 0.5 ? 'happy' : (open < 0.18 ? 'closed' : 'open');
  k.lineCap = 'round'; k.lineJoin = 'round';
  for (const sgn of [-1, 1]) {
    const ex = faceX + sgn * sep, ey = eyeY;
    k.strokeStyle = '#231a2b'; k.fillStyle = '#1e1626'; k.lineWidth = 0.075 * R;
    if (mode === 'happy') {
      k.beginPath(); k.arc(ex, ey + 0.06 * R, 0.14 * R, Math.PI * 1.1, Math.PI * 1.9); k.stroke();
    } else if (mode === 'sq') {
      k.beginPath(); k.moveTo(ex - sgn * 0.14 * R, ey - 0.1 * R); k.lineTo(ex + sgn * 0.08 * R, ey); k.lineTo(ex - sgn * 0.14 * R, ey + 0.1 * R); k.stroke();
    } else if (mode === 'closed') {
      k.beginPath(); k.arc(ex, ey - 0.04 * R, 0.14 * R, Math.PI * 0.15, Math.PI * 0.85); k.stroke();
    } else {
      k.save();
      if (ps.sad > 0.05) { // droopy lids
        k.beginPath(); const lid = ey - ery + ery * 0.7 * ps.sad;
        k.moveTo(ex - erx * 1.5, lid - sgn * ery * 0.35 * ps.sad); k.lineTo(ex + erx * 1.5, lid + sgn * ery * 0.35 * ps.sad);
        k.lineTo(ex + erx * 1.5, ey + ery * 2); k.lineTo(ex - erx * 1.5, ey + ery * 2); k.closePath(); k.clip();
      }
      k.beginPath(); k.ellipse(ex, ey, erx, ery * open, 0, 0, TAU); k.fill();
      if (open > 0.4) {
        // highlights
        k.fillStyle = 'rgba(255,255,255,0.95)';
        k.beginPath(); k.arc(ex + 0.055 * R + lookX * 0.02 * R, ey - 0.085 * R * open, 0.068 * R, 0, TAU); k.fill();
        k.beginPath(); k.arc(ex - 0.05 * R, ey + 0.08 * R * open, 0.032 * R, 0, TAU); k.fill();
        // star reflection
        if (lI > 0.05) { k.fillStyle = rgba([255, 205, 120], Math.min(1, lI * 0.9)); k.beginPath(); k.arc(ex + clamp(lx / ld) * 0.07 * R, ey + 0.02 * R, 0.035 * R, 0, TAU); k.fill(); }
        if (life > 0.2) { k.fillStyle = rgba([255, 170, 220], 0.8 * life); k.beginPath(); k.arc(ex - 0.06 * R, ey - 0.03 * R, 0.03 * R, 0, TAU); k.fill(); }
      }
      k.restore();
      if (ps.sad > 0.05) {
        k.strokeStyle = `rgba(35,26,43,${0.8 * ps.sad})`; k.lineWidth = 0.05 * R;
        const lid = ey - ery + ery * 0.7 * ps.sad;
        k.beginPath(); k.moveTo(ex - erx * 1.1, lid - sgn * ery * 0.26 * ps.sad); k.lineTo(ex + erx * 1.1, lid + sgn * ery * 0.26 * ps.sad); k.stroke();
      }
    }
  }
  // mouth
  if (ps.blow > 0.05) {
    k.fillStyle = '#3a2233'; k.beginPath(); k.ellipse(faceX + 0.05 * R, eyeY + 0.4 * R, 0.06 * R * ps.blow, 0.075 * R * ps.blow, 0, 0, TAU); k.fill();
  } else if (ps.happy > 0.3 || ps.wide > 0.6) {
    k.strokeStyle = '#3a2233'; k.lineWidth = 0.05 * R;
    if (ps.wide > 0.6 && ps.happy < 0.3) { k.fillStyle = '#3a2233'; k.beginPath(); k.ellipse(faceX, eyeY + 0.42 * R, 0.05 * R, 0.07 * R, 0, 0, TAU); k.fill(); }
    else { k.beginPath(); k.arc(faceX, eyeY + 0.3 * R, 0.1 * R, Math.PI * 0.2, Math.PI * 0.8); k.stroke(); }
  }
  // sprout
  {
    const bx = 0.05 * bw, by = -2 * bh + 1.5;
    const wind = ps.sproutWind * (0.8 + 0.4 * Math.sin(t * 17));
    const ang = -Math.PI / 2 + 0.15 * Math.sin(t * 2.1) + ps.droop * 1.5 + wind * 0.9 - ps.lean * 0.5;
    const len = 0.5 * R;
    const tx = bx + Math.cos(ang) * len, ty = by + Math.sin(ang) * len;
    const cx = bx + Math.cos(ang - 0.4 * (1 - ps.droop)) * len * 0.5, cy = by + Math.sin(ang - 0.4) * len * 0.5 - 2;
    k.strokeStyle = '#5c9a55'; k.lineWidth = 0.06 * R; k.beginPath(); k.moveTo(bx, by); k.quadraticCurveTo(cx, cy, tx, ty); k.stroke();
    for (const side of [-1, 1]) {
      const la = ang + side * (0.75 + 0.2 * ps.droop) + wind * 0.3 * side;
      const ll = 0.34 * R;
      k.save(); k.translate(tx, ty); k.rotate(la);
      const lg = k.createLinearGradient(0, 0, ll, 0); lg.addColorStop(0, '#6fb86a'); lg.addColorStop(1, '#a8e19a');
      k.fillStyle = lg;
      k.beginPath(); k.moveTo(0, 0); k.quadraticCurveTo(ll * 0.5, -ll * 0.38, ll, 0); k.quadraticCurveTo(ll * 0.5, ll * 0.38, 0, 0); k.fill();
      k.restore();
    }
    if (ps.flower > 0) {
      const fs = 0.16 * R * eback(ps.flower);
      k.fillStyle = '#ff8fc4';
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + t * 0.3; k.beginPath(); k.arc(tx + Math.cos(a) * fs * 0.7, ty - 3 + Math.sin(a) * fs * 0.7, fs * 0.55, 0, TAU); k.fill(); }
      k.fillStyle = '#fff1c9'; k.beginPath(); k.arc(tx, ty - 3, fs * 0.4, 0, TAU); k.fill();
      st.pipFlower = [tx, ty - 3, fs];
    }
    st.sproutTip = [tx, ty];
  }
  // held star (between body and arms)
  let heldLocal = null;
  if (ps.holding > 0.02 && st.starHeld) {
    const R2 = R; const hx = R2 * ps.sx * lerp(0.58, 0.42, ps.curl), hy = -bh * lerp(0.46, 0.36, ps.curl);
    heldLocal = [hx, hy];
    const I = st.I;
    // warm glow on belly
    const gg = k.createRadialGradient(hx, hy, 0, hx, hy, R * 1.2);
    gg.addColorStop(0, rgba([255, 200, 120], Math.min(0.8, 0.6 * I))); gg.addColorStop(1, 'rgba(255,200,120,0)');
    k.save(); bodyPath(k, bw, bh); k.clip(); k.globalCompositeOperation = 'lighter'; k.fillStyle = gg; k.fillRect(-2 * R, -3 * R, 4 * R, 4 * R); k.restore();
    const r = 7.2 * (0.75 + 0.25 * Math.min(I, 1.3)) * (0.7 + 0.3 * smooth(I * 3));
    k.save(); k.translate(hx, hy); k.rotate(t * 0.4);
    k.fillStyle = rgba(mix3([255, 110, 50], [255, 250, 230], clamp(I)), clamp(0.6 + I));
    k.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.48 : r; i ? k.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : k.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    k.closePath(); k.fill(); k.restore();
  }
  // arms
  const hold = ps.holding;
  for (const sgn of [-1, 1]) {
    const restX = sgn * 0.95 * bw, restY = -0.75 * bh;
    const hx = heldLocal ? heldLocal[0] + sgn * 0.3 * R : restX, hy = heldLocal ? heldLocal[1] + 0.17 * R : restY;
    const ax = lerp(restX, hx, hold), ay = lerp(restY, hy, hold);
    const wave = sgn * 0.3 * Math.sin(t * 3) * ps.happy * (1 - hold);
    k.fillStyle = '#e9dfd0';
    k.save(); k.translate(ax, ay + wave * 5); k.rotate(sgn * 0.5 + wave);
    k.beginPath(); k.ellipse(0, 0, 0.19 * R, 0.12 * R, 0, 0, TAU); k.fill();
    k.fillStyle = rgba(amb, 0.35); k.fill();
    if (lI > 0.03) { k.fillStyle = rgba([255, 205, 140], Math.min(0.5, 0.4 * lI)); k.fill(); }
    k.restore();
  }
  // blit
  const [px, py] = toS(L, ps.x, ps.feetY - ps.jump);
  st.pipScreen = [px, py];
  st.pipLocal2Screen = (x, y) => { const c = Math.cos(ps.lean), s2 = Math.sin(ps.lean); return [px + (x * c - y * s2) * s, py + (x * s2 + y * c) * s]; };
  M.setTransform(1, 0, 0, 1, 0, 0); M.globalAlpha = 1;
  if (ps.hide > 0.5) {
    const gy = toS(L, ps.x, gY(ps.x) + 2)[1];
    M.save(); M.beginPath(); M.rect(0, 0, W, gy); M.clip(); M.drawImage(pipC, px - PIPOX, py - PIPOY); M.restore();
  } else M.drawImage(pipC, px - PIPOX, py - PIPOY);
  // flower glow
  if (ps.flower > 0 && st.pipFlower) { const [fx, fy] = st.pipLocal2Screen(st.pipFlower[0], st.pipFlower[1]); dot(G, glowSprite(C.pink), fx, fy, 22 * s * ps.flower, 0.8 * ps.flower); }
}
function drawPipShadow(cam, ps, st) {
  const L = layer(cam, 1);
  const [x, y] = toS(L, ps.x, gY(ps.x) + 2);
  const k = clamp(1 - ps.jump / 220);
  M.setTransform(1, 0, 0, 1, 0, 0);
  M.fillStyle = `rgba(4,4,10,${0.45 * k})`;
  M.beginPath(); M.ellipse(x - 4 * L.zp, y, PIP_R * 1.0 * L.zp * k * ps.sx, 6 * L.zp * k, 0, 0, TAU); M.fill();
}

// ---- tree drawing
function drawTree(t, cam, st) {
  if (t < 38.4) return;
  treeFK(t);
  const L = layer(cam, 1); setL(M, L);
  const thick = 0.3 + 0.7 * treeGrowAll(t);
  const accent = [39.5, 40.5, 41.5, 42.5].reduce((a, tt) => a + pulse(t, tt, 0.04, 0.35), 0);
  const glowK = 0.55 + 0.45 * lifeAmt(t) + 0.8 * accent;
  // branches
  const tips = [];
  const vein = [];
  for (const b of TREE) {
    if (b.g <= 0) continue;
    const n = 7; const left = [], right = [], cl = [];
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * b.g;
      const p = bez(b.P0, b.P1, b.P2, u);
      const d = [2 * (1 - u) * (b.P1[0] - b.P0[0]) + 2 * u * (b.P2[0] - b.P1[0]), 2 * (1 - u) * (b.P1[1] - b.P0[1]) + 2 * u * (b.P2[1] - b.P1[1])];
      const dl = Math.hypot(d[0], d[1]) || 1; const nx = -d[1] / dl, ny = d[0] / dl;
      let w = lerp(b.th, b.th * 0.64, u) * thick * 0.5;
      if (b.depth === 0) w *= 1 + 0.5 * Math.pow(1 - u, 4); // root flare
      w *= lerp(1, 0.35, Math.pow(i / n, 2) * (1 - b.g)); // growing tip taper
      left.push([p[0] + nx * w, p[1] + ny * w]); right.push([p[0] - nx * w, p[1] - ny * w]); cl.push(p);
    }
    M.beginPath(); M.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i <= n; i++) M.lineTo(left[i][0], left[i][1]);
    for (let i = n; i >= 0; i--) M.lineTo(right[i][0], right[i][1]);
    M.closePath();
    M.fillStyle = b.depth < 2 ? '#1d1838' : '#231c42'; M.fill();
    vein.push({ cl, w: b.th * thick * 0.13, depth: b.depth });
    if (b.g < 0.999) tips.push(cl[n]);
  }
  M.setTransform(1, 0, 0, 1, 0, 0);
  // glowing veins
  G.globalCompositeOperation = 'lighter'; setL(G, L); G.lineCap = 'round'; G.lineJoin = 'round';
  for (const v of vein) {
    G.strokeStyle = rgba(v.depth < 3 ? [255, 200, 130] : [140, 240, 255], Math.min(1, (v.depth < 3 ? 0.55 : 0.3) * glowK));
    G.lineWidth = Math.max(v.w, 0.9 / L.zp);
    G.beginPath(); v.cl.forEach((p, i) => (i ? G.lineTo(p[0], p[1]) : G.moveTo(p[0], p[1]))); G.stroke();
  }
  G.setTransform(1, 0, 0, 1, 0, 0);
  for (const p of tips) { const [x, y] = toS(L, p[0], p[1]); dot(G, glowSprite([255, 230, 170], 0.6), x, y, 16 * L.zp, 0.6); }
  // leaves
  setL(M, L);
  const LC = {};
  for (const b of TREE) for (const lf of b.leaves) {
    if (t < lf.t) continue;
    const k = eback(clamp((t - lf.t) / 0.5));
    const p = attachPoint(b, lf.a, lf.off * k);
    const key = lf.col.join(',');
    (LC[key] = LC[key] || { col: lf.col, list: [] }).list.push([p[0], p[1], lf.sz * k, b.ang + lf.ang + 0.1 * Math.sin(t * 1.3 + lf.a * 9)]);
  }
  for (const key in LC) {
    M.fillStyle = rgba(LC[key].col, 0.92); M.beginPath();
    for (const [x, y, s, a] of LC[key].list) { M.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s); M.ellipse(x, y, s, s * 0.45, a, 0, TAU); }
    M.fill();
  }
  // blossoms
  const bloomLight = [];
  for (const b of TREE) for (const bl of b.blos) {
    if (t < bl.t || t >= bl.td) continue;
    const k = eback(clamp((t - bl.t) / 0.45));
    const p = attachPoint(b, bl.a, bl.off);
    const s = bl.sz * k;
    M.fillStyle = rgba(bl.col, 0.95);
    M.beginPath();
    for (let q = 0; q < 5; q++) { const a = q / 5 * TAU + bl.rot + t * 0.2; M.moveTo(p[0] + Math.cos(a) * s * 0.55 + s * 0.5, p[1] + Math.sin(a) * s * 0.55); M.arc(p[0] + Math.cos(a) * s * 0.55, p[1] + Math.sin(a) * s * 0.55, s * 0.5, 0, TAU); }
    M.fill();
    M.fillStyle = 'rgba(255,248,220,0.95)'; M.beginPath(); M.arc(p[0], p[1], s * 0.3, 0, TAU); M.fill();
    bloomLight.push([p[0], p[1], s, bl.col, clamp((t - bl.t) / 0.3)]);
  }
  M.setTransform(1, 0, 0, 1, 0, 0);
  for (const [x, y, s, col, k] of bloomLight) { const [sx, sy] = toS(L, x, y); dot(G, glowSprite(col), sx, sy, s * 3.0 * L.zp, 0.05 * k); }
  st.bloomCount = bloomLight.length;
  if (bloomLight.length) {
    let mx = 0, my = 0; for (const b of bloomLight) { mx += b[0]; my += b[1]; } mx /= bloomLight.length; my /= bloomLight.length;
    const [cx, cy] = toS(L, mx, my); const k = Math.min(1, bloomLight.length / 900);
    dot(G, glowSprite([255, 120, 190]), cx, cy, 700 * L.zp, 0.1 * k);
  }
}
function drawRoots(t, cam) {
  if (t < 37.2 || t > 47) return;
  const L = layer(cam, 1);
  const R = 2000 * eout(inv(37.2, 40.2, t));
  const fade = 1 - smooth(inv(40.5, 47, t)) * 0.85;
  G.save(); setL(G, L); G.clip(groundPath(L, (x) => gY(x) + 4, 8).fill);
  G.globalCompositeOperation = 'lighter'; G.lineCap = 'round';
  G.beginPath();
  for (const r of ROOTS) { if (r.d > R) continue; G.moveTo(r.x1, r.y1); G.lineTo(r.x2, r.y2); }
  G.strokeStyle = rgba([255, 200, 120], 0.4 * fade); G.lineWidth = 2.0 / Math.sqrt(L.zp); G.stroke();
  G.beginPath();
  for (const r of ROOTS) { if (r.d > R || r.d < R - 160) continue; G.moveTo(r.x1, r.y1); G.lineTo(r.x2, r.y2); }
  G.strokeStyle = rgba([255, 250, 220], 0.9 * fade); G.lineWidth = 4 / Math.sqrt(L.zp); G.stroke();
  G.restore(); G.setTransform(1, 0, 0, 1, 0, 0);
}
function frontPath(t, cam, grow = 0) {
  const R = frontR(t) + grow; const L = layer(cam, 1);
  const [cx, cy] = toS(L, STAR_X, gY(STAR_X));
  const p = new Path2D();
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * TAU;
    const rr = R * L.zp * (1 + 0.1 * N3(Math.cos(th) * 1.6 + 7, Math.sin(th) * 1.6 + t * 0.2) + 0.04 * N2(Math.cos(th) * 6, Math.sin(th) * 6 + t));
    const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr * 0.42;
    i ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  p.closePath(); return p;
}
function drawFrontRing(t, cam) {
  const R = frontR(t); if (R <= 0 || R > 3700) return;
  const a = 0.9 * (1 - smooth(inv(2200, 3700, R))) * smooth(R / 120);
  const Lf = layer(cam, FAR_P);
  G.save(); setL(G, Lf); G.clip(groundPath(Lf, farTop, 10).fill); G.setTransform(1, 0, 0, 1, 0, 0);
  G.globalCompositeOperation = 'lighter'; G.lineJoin = 'round';
  const fp = frontPath(t, cam);
  G.strokeStyle = rgba([120, 255, 200], 0.05 * a); G.lineWidth = 50; G.stroke(fp);
  G.strokeStyle = rgba([150, 255, 215], 0.1 * a); G.lineWidth = 14; G.stroke(fp);
  G.strokeStyle = rgba([230, 255, 240], 0.3 * a); G.lineWidth = 2; G.stroke(fp);
  G.restore();
}
function warmClip(t, cam) { M.clip(frontPath(t, cam)); }

// ---- particles & fx
function drawFallingStar(t, cam) {
  if (t < 7.5 || t > 10.5) return;
  const L = layer(cam, 1);
  G.globalCompositeOperation = 'lighter';
  if (t < 8.9) {
    const s = fallS(t);
    // trail
    const n = 40;
    for (let i = n; i >= 0; i--) {
      const ss = s - (i / n) * 0.22 * Math.min(1, s * 4 + 0.2);
      if (ss < 0) continue;
      const p = bez(FALL.P0, FALL.P1, FALL.P2, ss);
      const [x, y] = toS(L, p[0], p[1]);
      const k = 1 - i / n;
      dot(G, glowSprite(k > 0.7 ? C.goldCore : C.amber), x, y, (6 + 26 * k) * (0.6 + s), 0.25 * k * k);
    }
    const p = fallPos(t); const [x, y] = toS(L, p[0], p[1]);
    const I = 1.2 + s * 1.4;
    drawSmallStar(x, y, I, t, L);
    dot(G, glowSprite(C.gold), x, y, 140 * (0.7 + s), 0.5);
  }
  // sparks
  for (const sp of fallSparks) {
    const d = t - sp.t0; if (d < 0 || d > sp.life) continue;
    const p = bez(FALL.P0, FALL.P1, FALL.P2, fallS(sp.t0));
    const x = p[0] + sp.vx * d, y = p[1] + sp.vy * d + 60 * d * d;
    const [sx, sy] = toS(L, x, y);
    const a = (1 - d / sp.life) * (0.6 + 0.4 * Math.sin(d * 40 + sp.t0 * 100));
    dot(G, glowSprite(sp.col, 0.5), sx, sy, sp.sz * 3.5, a);
  }
  // impact
  if (t >= 8.9) {
    const d = t - 8.9;
    const [x, y] = toS(L, FALL.P2[0], FALL.P2[1]);
    dot(G, glowSprite(C.gold), x, y, 700 * Math.exp(-d / 0.6), 0.9 * Math.exp(-d / 0.35));
    G.save(); G.translate(x, y + 6); G.scale(1, 0.25);
    const rr = 60 + 900 * eout(d / 1.0);
    G.strokeStyle = rgba([255, 220, 160], 0.6 * Math.exp(-d / 0.4)); G.lineWidth = 16; G.beginPath(); G.arc(0, 0, rr * L.zp, 0, TAU); G.stroke();
    G.restore();
    for (const s of impactSand) {
      if (d > s.life) continue;
      const wx = FALL.P2[0] + s.vx * d, wy = FALL.P2[1] + s.vy * d + 450 * d * d;
      if (wy > gY(wx) + 4) continue;
      const [sx, sy] = toS(L, wx, wy);
      const a = 1 - d / s.life;
      if (s.glow) dot(G, glowSprite(C.gold, 0.5), sx, sy, s.sz * 4 * L.zp, a);
      M.fillStyle = `rgba(210,190,160,${0.8 * a})`; M.fillRect(sx - s.sz / 2, sy - s.sz / 2, s.sz * L.zp, s.sz * L.zp);
    }
  }
}
function drawStorm(t, cam, st, layerIdx) {
  const S = stormAmt(t); if (S <= 0.001) return;
  const wp = windPos(t);
  M.setTransform(1, 0, 0, 1, 0, 0);
  const SPD = [700, 1300, 2300], ALP = [0.85, 0.4, 0.22];
  const drawLayer = (ly) => {
    for (const p of PUFFS) {
      if (p.ly !== ly) continue;
      const x = ((p.x0 + wp * SPD[ly]) % (W + 1600)) - 800;
      const y = p.y + 40 * Math.sin(t * 0.9 + p.rot) - (x - W / 2) * 0.05;
      drawPuff(M, p.v, x, y, p.s, p.rot + t * p.spin, ALP[ly] * S);
    }
    M.globalAlpha = 1;
  };
  if (layerIdx === 0) { drawLayer(0); return; }
  const L1 = layer(cam, 1);
  const flash = lightningFlash(t);
  drawLayer(1); drawLayer(2);
  // darken whole frame
  M.fillStyle = `rgba(12,8,8,${0.22 * S})`; M.fillRect(0, 0, W, H);
  // lit dust around the star — volumetric warm pocket
  if (st.starScreen) {
    const [sx, sy] = st.starScreen; const I = st.I;
    const g = M.createRadialGradient(sx, sy, 0, sx, sy, 420 * L1.zp * Math.sqrt(I + 0.05));
    g.addColorStop(0, rgba([255, 190, 110], 0.4 * S * Math.min(1, I))); g.addColorStop(1, 'rgba(255,190,110,0)');
    M.globalCompositeOperation = 'lighter'; M.fillStyle = g; M.fillRect(0, 0, W, H); M.globalCompositeOperation = 'source-over';
  }
  // particles
  const n = Math.floor(STORMP.length * 0.55 * clamp(S * 1.2));
  const groundSy = toS(L1, 0, gY(cam.cx))[1];
  const buckets = {};
  const [ssx, ssy] = st.starScreen || [-9999, -9999];
  for (let i = 0; i < n; i++) {
    const p = STORMP[i];
    const spd = 1700 * p.d;
    let x = ((p.x0 + wp * spd) % (W + 800)) - 400;
    let y = lerp(groundSy - 20 - p.g * 160 * p.d, p.y0, Math.pow(S, 0.8));
    y += 50 * p.d * N1(p.sd, t * 1.2) + (x - W / 2) * 0.06;
    const len = Math.min(95, 16 * p.d * (S * (0.7 + 0.6 * gust(t))) * 3.2) * (0.4 + p.g);
    const dd = Math.hypot(x - ssx, y - ssy);
    const lit = clamp(1 - dd / (380 * L1.zp)) * Math.min(1, st.I);
    const key = (p.d < 0.7 ? 0 : p.d < 1.1 ? 1 : 2) * 4 + Math.min(3, Math.floor(lit * 4));
    (buckets[key] = buckets[key] || []).push(x, y, len);
  }
  M.lineCap = 'round';
  for (const key in buckets) {
    const db = Math.floor(key / 4), lb = key % 4;
    const col = mix3([150, 120, 98], [255, 200, 130], lb / 3 + flash * 0.3);
    M.strokeStyle = rgba(mix3(col, [220, 230, 255], flash * 0.7), (0.08 + 0.09 * db + 0.16 * lb) * S);
    M.lineWidth = [1, 1.6, 2.6][db];
    M.beginPath();
    const arr = buckets[key];
    for (let i = 0; i < arr.length; i += 3) { M.moveTo(arr[i] - arr[i + 2], arr[i + 1] - arr[i + 2] * 0.06); M.lineTo(arr[i], arr[i + 1]); }
    M.stroke();
  }
}
function drawTumbleweed(t, cam) {
  if (t < 24.8 || t > 27.2) return;
  const L = layer(cam, 1); setL(M, L);
  const u = (t - 24.8) / 2.4;
  const x = lerp(-700, 1100, u), r = 24;
  const hop = Math.abs(Math.sin(u * Math.PI * 4.5)) * 40;
  const y = gY(x) - 4 - r - hop;
  M.save(); M.translate(x, y); M.rotate(x / r);
  M.strokeStyle = 'rgba(60,45,40,0.95)'; M.lineWidth = 1.6;
  const rr = rng(99);
  M.beginPath();
  for (let i = 0; i < 26; i++) { const a = rr() * TAU, b = a + 1 + rr() * 2; M.moveTo(Math.cos(a) * r * rr(), Math.sin(a) * r * rr()); M.quadraticCurveTo(Math.cos((a + b) / 2) * r * 1.2, Math.sin((a + b) / 2) * r * 1.2, Math.cos(b) * r * rr(), Math.sin(b) * r * rr()); }
  M.stroke(); M.restore(); M.setTransform(1, 0, 0, 1, 0, 0);
}
function drawDust(t, cam) {
  const a = bump(t, 30.1, 30.7, 33.5, 35.5); if (a <= 0) return;
  M.setTransform(1, 0, 0, 1, 0, 0);
  M.fillStyle = `rgba(190,170,150,${0.35 * a})`;
  for (const d of DUST) {
    const y = (d.y + (t - 30) * 30 * d.d) % H; const x = d.x + (t - 30) * 40 * d.d + 20 * Math.sin(t * 0.8 + d.ph);
    M.fillRect(x % W, y, d.d * 1.4, d.d * 1.4);
  }
}
function drawMotes(t, cam, st, ps) {
  if (t < 34.1 || t > 36.2 || !st.pipLocal2Screen) return;
  const R = PIP_R * ps.inflate;
  const mouth = st.pipLocal2Screen(0.12 * R * ps.sx + ps.lx * 0.2 * R + 0.05 * R, -1.12 * R * ps.sy + 0.4 * R);
  const tgt = st.starScreen || mouth;
  for (const m of MOTES) {
    const u = (t - m.t0) / m.dur; if (u < 0 || u > 1) continue;
    const e = eio2(u);
    const cx = (mouth[0] + tgt[0]) / 2 + m.sw * 2, cy = Math.min(mouth[1], tgt[1]) - 30 + m.sw;
    const x = (1 - e) * (1 - e) * mouth[0] + 2 * (1 - e) * e * cx + e * e * tgt[0] + 6 * Math.sin(u * 9 + m.ph);
    const y = (1 - e) * (1 - e) * mouth[1] + 2 * (1 - e) * e * cy + e * e * tgt[1];
    dot(G, glowSprite([255, 245, 220], 0.4), x, y, m.sz * 6, 0.9 * Math.sin(u * Math.PI));
  }
}
function drawIgnition(t, cam, st) {
  if (t < 36.5 || t > 40.5) return;
  const L = layer(cam, 1);
  const [sx, sy] = st.igniteScreen;
  const d = t - 36.8;
  G.globalCompositeOperation = 'lighter';
  if (d < 0) { dot(G, glowSprite(C.gold), sx, sy, 300 * (1 + d / 0.3), 0.4 * (1 + d / 0.3)); return; }
  // pillar of light
  const pa = Math.exp(-d / 0.45);
  const pw = (60 + 200 * Math.exp(-d / 0.25)) * L.zp;
  const pg = G.createLinearGradient(sx - pw, 0, sx + pw, 0);
  pg.addColorStop(0, 'rgba(255,220,160,0)'); pg.addColorStop(0.5, rgba([255, 240, 210], 0.85 * pa)); pg.addColorStop(1, 'rgba(255,220,160,0)');
  G.fillStyle = pg; G.fillRect(sx - pw, 0, 2 * pw, sy + 10);
  // shockwave rings on the ground
  for (const [dl, spd, wdt, col] of [[0, 3600, 40, [255, 235, 190]], [0.12, 2600, 22, [140, 255, 220]]]) {
    const dd = d - dl; if (dd < 0) continue;
    const r = spd * eout(dd / 1.5) * L.zp;
    const a = 1 - smooth(dd / 1.4);
    G.save(); G.translate(sx, sy); G.scale(1, 0.3);
    G.strokeStyle = rgba(col, 0.9 * a); G.lineWidth = wdt * L.zp * (1 - dd / 2);
    G.beginPath(); G.arc(0, 0, r, 0, TAU); G.stroke();
    G.restore();
    // spherical wave in the air
    G.strokeStyle = rgba(col, 0.25 * a); G.lineWidth = wdt * 0.5; G.beginPath(); G.arc(sx, sy, r * 0.8, Math.PI, TAU); G.stroke();
  }
  // anamorphic flare
  flare(G, sx, sy, 1400 * Math.exp(-d / 0.5), 10, 0.9 * Math.exp(-d / 0.45), [170, 200, 255]);
  // burst particles
  for (const p of BURST) {
    if (d > p.life) continue;
    const k = 1 - Math.exp(-d * 2.2);
    const x = sx + p.vx * k / 2.2 * L.zp, y = sy + (p.vy * k / 2.2 + 60 * d * d) * L.zp;
    dot(G, glowSprite(p.col, 0.5), x, y, p.sz * 4 * L.zp, (1 - d / p.life) * (0.6 + 0.4 * Math.sin(d * 30 + p.vx)));
  }
}
function drawFireflies(t, cam) {
  if (t < 43.5) return;
  const L = layer(cam, 1);
  for (const f of FIREFLIES) {
    if (t < f.t0) continue;
    const x = f.x + f.ax * Math.sin(t * f.fa + f.ph), y = f.y + f.ay * Math.sin(t * f.fb + f.ph * 2) - 20 * bump(t, 49.8, 50.5, 52, 54) * (t - 49.8);
    const [sx, sy] = toS(L, x, y);
    const a = smooth((t - f.t0) / 1.5) * (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * f.bl * 2 + f.ph), 3));
    dot(G, glowSprite(f.col, 0.5), sx, sy, 9 * L.zp + 3, a);
  }
}
function drawPetals(t, cam) {
  if (t < 50) return;
  const L = layer(cam, 1);
  for (const pe of PETALS) {
    if (t < pe.td || t >= pe.tc) continue;
    const [wx, wy] = petalPos(pe, t);
    const [x, y] = toS(L, wx, wy);
    if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
    const u = (t - pe.td) / pe.dur;
    const s = pe.sz * L.zp * (1 - 0.6 * u);
    const rot = pe.spin * (t - pe.td);
    M.fillStyle = rgba(pe.col, 0.9 * (1 - u * 0.5));
    M.beginPath(); M.ellipse(x, y, s, s * 0.5 * Math.abs(Math.cos(rot)) + 0.4, rot * 0.5, 0, TAU); M.fill();
    dot(G, glowSprite(pe.col), x, y, s * 6, 0.5 + 0.4 * u);
  }
  // the golden petal (screen-space guided to the old star's place)
  const gp = GOLD_PETAL;
  if (t >= gp.td && t < gp.tc + 0.1) {
    const u = clamp((t - gp.td) / (gp.tc - gp.td));
    const [x0, y0] = toS(L, gp.p0[0], gp.p0[1]);
    const Ls = layer(cam, SKY_P); const [x1, y1] = toS(Ls, GOLD_SKY[0], GOLD_SKY[1]);
    const e = eio2(u);
    const x = lerp(x0, x1, e) + 70 * Math.sin(u * 9) * (1 - e), y = lerp(y0, y1, e) + 20 * Math.cos(u * 7) * (1 - e);
    dot(G, glowSprite(C.gold), x, y, 60, 0.8);
    dot(G, glowSprite(C.goldCore, 1), x, y, 10, 1);
    for (let i = 1; i < 14; i++) { const uu = clamp(u - i * 0.012); const ee = eio2(uu); const xx = lerp(x0, x1, ee) + 70 * Math.sin(uu * 9) * (1 - ee), yy = lerp(y0, y1, ee) + 20 * Math.cos(uu * 7) * (1 - ee); dot(G, glowSprite(C.amber), xx, yy, 14 - i * 0.7, 0.4 * (1 - i / 14)); }
  }
}
function drawForeground(t, cam) {
  // soft-focus foreground rocks/grass (depth of field)
  const L = layer(cam, FG_P);
  const Lh = { zp: L.zp / 2, ox: L.ox / 2, oy: L.oy / 2 };
  FG.setTransform(1, 0, 0, 1, 0, 0); FG.clearRect(0, 0, W / 2, H / 2);
  const bottomW = (H - L.oy) / L.zp;
  if (bottomW < 60 || t < 40) return;
  setL(FG, Lh);
  const warm = t > 40;
  const life = lifeAmt(t);
  if (warm) {
    FG.strokeStyle = rgba([30, 90, 70], life); FG.lineWidth = 5; FG.lineCap = 'round';
    FG.beginPath();
    for (let i = 0; i < 40; i++) { const x = -900 + i * 14 + hash(i) * 10, y = 110 + hash(i * 7) * 30, h = (30 + hash(i * 3) * 50) * life; FG.moveTo(x, y); FG.quadraticCurveTo(x + 5, y - h * 0.6, x + 12 * Math.sin(t + i), y - h); }
    for (let i = 0; i < 40; i++) { const x = 760 + i * 14 + hash(i + 50) * 10, y = 130 + hash(i * 5) * 30, h = (30 + hash(i * 2) * 50) * life; FG.moveTo(x, y); FG.quadraticCurveTo(x + 5, y - h * 0.6, x + 12 * Math.sin(t + i), y - h); }
    FG.stroke();
  }
  FG.setTransform(1, 0, 0, 1, 0, 0);
  M.save(); M.filter = 'blur(7px)'; M.drawImage(fgC, 0, 0, W, H); M.restore();
}

// ---- post
function composite(t) {
  M.setTransform(1, 0, 0, 1, 0, 0); M.globalAlpha = 1; M.filter = 'none';
  G.globalAlpha = 1; G.globalCompositeOperation = 'source-over';
  // bloom chain
  B1.clearRect(0, 0, b1c.width, b1c.height); B1.filter = 'blur(2px)'; B1.drawImage(glowC, 0, 0, b1c.width, b1c.height); B1.filter = 'none';
  B2.clearRect(0, 0, b2c.width, b2c.height); B2.filter = 'blur(2px)'; B2.drawImage(b1c, 0, 0, b2c.width, b2c.height); B2.filter = 'none';
  B3.clearRect(0, 0, b3c.width, b3c.height); B3.filter = 'blur(2px)'; B3.drawImage(b2c, 0, 0, b3c.width, b3c.height); B3.filter = 'none';
  B4.clearRect(0, 0, b4c.width, b4c.height); B4.filter = 'blur(2px)'; B4.drawImage(b3c, 0, 0, b4c.width, b4c.height); B4.filter = 'none';
  M.globalCompositeOperation = 'lighter';
  M.drawImage(glowC, 0, 0);
  M.globalAlpha = 0.9; M.drawImage(b1c, 0, 0, W, H);
  M.globalAlpha = 0.75; M.drawImage(b2c, 0, 0, W, H);
  M.globalAlpha = 0.6; M.drawImage(b3c, 0, 0, W, H);
  M.globalAlpha = 0.5; M.drawImage(b4c, 0, 0, W, H);
  M.globalAlpha = 1; M.globalCompositeOperation = 'source-over';
}
function grade(t) {
  M.setTransform(1, 0, 0, 1, 0, 0);
  // global flashes
  const lf = lightningFlash(t);
  if (lf > 0) { M.globalCompositeOperation = 'lighter'; M.fillStyle = rgba([150, 165, 220], 0.45 * lf); M.fillRect(0, 0, W, H); }
  const ig = t > 36.8 ? Math.exp(-(t - 36.8) / 0.22) : 0;
  if (ig > 0.003) { M.globalCompositeOperation = 'lighter'; M.fillStyle = rgba([255, 236, 200], Math.min(0.85, 0.9 * ig)); M.fillRect(0, 0, W, H); }
  const im = t > 8.9 ? Math.exp(-(t - 8.9) / 0.22) : 0;
  if (im > 0.003) { M.globalCompositeOperation = 'lighter'; M.fillStyle = rgba([255, 210, 150], 0.35 * im); M.fillRect(0, 0, W, H); }
  M.globalCompositeOperation = 'source-over';
  // vignette
  const v = M.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,6,${0.62 + 0.15 * stormAmt(t)})`);
  M.fillStyle = v; M.fillRect(0, 0, W, H);
  // grain
  M.globalCompositeOperation = 'overlay'; M.globalAlpha = 0.045;
  const gi = Math.floor(t * FPS) % TEX.grains.length;
  M.drawImage(TEX.grains[gi], 0, 0, W, H);
  M.globalAlpha = 1; M.globalCompositeOperation = 'source-over';
  // fades
  let black = 1 - smooth(t / 2.2);
  black = Math.max(black, eio(inv(58.0, 59.4, t)));
  if (black > 0.001) { M.fillStyle = `rgba(0,0,0,${black})`; M.fillRect(0, 0, W, H); }
  // the last light: gold glint survives the fade
  if (t > 58.0) {
    const cam = camBase(t); const Ls = layer(cam, SKY_P);
    const [x, y] = toS(Ls, GOLD_SKY[0], GOLD_SKY[1]);
    const a = (0.5 + 1.2 * pulse(t, 58.5, 0.1, 0.5)) * (1 - smooth(inv(58.6, 59.9, t))) * smooth(inv(58.0, 58.6, t));
    M.globalCompositeOperation = 'lighter';
    dot(M, glowSprite(C.gold), x, y, 120, 0.6 * a);
    dot(M, glowSprite(C.goldCore, 1), x, y, 22, a);
    flare(M, x, y, 160 * a, 2.5, 0.6 * a, [255, 225, 170], 0.08);
    M.globalCompositeOperation = 'source-over'; M.globalAlpha = 1;
  }
}

// ================================================================ FRAME
function renderFrame(t) {
  const cam = camAt(t);
  const ps = pipState(t);
  const st = { I: starI(t), lightI: 0, lightW: [STAR_X, 0] };
  // star world position / held state
  let starW = null;
  if (t >= 8.9 && t < 17.95) starW = [STAR_X, gY(STAR_X) - 7];
  else if (t >= 17.95 && t < 36.85) {
    const hp = heldPos(ps); const u = smooth(inv(17.95, 18.4, t));
    starW = [lerp(STAR_X, hp[0], u), lerp(gY(STAR_X) - 7, hp[1], u)];
    st.starHeld = u > 0.98;
  } else if (t >= 36.85 && t < 38.3) {
    const hp = heldPos(pipState(36.85)); const u = eio(inv(36.85, 37.5, t));
    starW = [lerp(hp[0], STAR_X, u), lerp(hp[1], gY(STAR_X) - 8, u) - 30 * Math.sin(u * Math.PI)];
    starW[1] += 14 * eio(inv(37.5, 38.2, t));
  }
  const L1 = layer(cam, 1);
  if (starW) { st.starScreen = toS(L1, starW[0], starW[1]); st.lightW = starW; st.lightI = Math.min(st.I, 2.5); }
  if (t >= 7.5 && t < 8.9) { const p = fallPos(t); st.lightW = p; st.lightI = 0.8 * smooth(inv(8.0, 8.9, t)); }
  st.igniteScreen = t >= 36.5 ? toS(L1, ...(starW || [STAR_X, gY(STAR_X) - 8])) : [0, 0];
  if (t > 38.3) st.lightI = 0;

  G.setTransform(1, 0, 0, 1, 0, 0); G.globalAlpha = 1; G.globalCompositeOperation = 'source-over'; G.clearRect(0, 0, W, H);
  G.globalCompositeOperation = 'lighter';
  M.filter = 'none';

  drawSky(t, cam);
  drawSkyObjects(t, cam);
  drawLightning(t, cam);
  drawStormWall(t, cam);
  // world (cold) then living world spreading from the tree
  drawWorld(t, cam, false, st);
  const R = frontR(t);
  if (R > 0) { M.save(); warmClip(t, cam); drawWorld(t, cam, true, st); M.restore(); drawFrontRing(t, cam); }
  drawStorm(t, cam, st, 0);
  // lighting on the ground
  if (st.lightI > 0.01) lightGround(cam, st.lightW[0], st.lightW[1] + 20, 520 * Math.sqrt(st.lightI), [255, 190, 110], 0.22 * Math.min(st.lightI, 1.6));
  if (t > 39) {
    const tl = lifeAmt(t);
    lightGround(cam, STAR_X, gY(STAR_X), 1300, [255, 150, 200], 0.14 * tl);
    lightGround(cam, STAR_X, gY(STAR_X) - 10, 500, [255, 210, 150], 0.12 * tl);
  }
  drawRoots(t, cam);
  drawTree(t, cam, st);
  drawTumbleweed(t, cam);
  // Pip + star
  const rockFront = t < 11.7;
  if (!rockFront) drawRock(t, cam, st);
  drawPipShadow(cam, ps, st);
  if (starW && !st.starHeld) drawSmallStar(st.starScreen[0], st.starScreen[1], st.I, t, L1);
  drawPip(t, cam, ps, st);
  if (starW && st.starHeld) {
    // glow only (solid star drawn inside Pip's arms)
    const hp = heldPos(ps); const [x, y] = toS(L1, hp[0], hp[1]); st.starScreen = [x, y];
    const I = st.I, Ic = Math.min(I, 3);
    dot(G, glowSprite(C.amber), x, y, 200 * L1.zp * Math.sqrt(Ic), 0.1 * Ic);
    dot(G, glowSprite(C.gold), x, y, 45 * L1.zp * Math.sqrt(Ic), 0.45 * Ic);
    dot(G, glowSprite(C.goldCore, 1), x, y, 10 * L1.zp * Math.sqrt(Ic), Math.min(1.1, Ic));
  }
  if (rockFront) drawRock(t, cam, st);
  // ripple rings on poke
  if (t > 15.5 && t < 16.8) {
    const d = t - 15.5; const [x, y] = st.starScreen;
    for (let i = 0; i < 3; i++) { const dd = d - i * 0.14; if (dd < 0) continue; G.strokeStyle = rgba([255, 230, 170], 0.7 * (1 - dd / 1.1)); G.lineWidth = 3; G.beginPath(); G.arc(x, y, (20 + dd * 220) * L1.zp, 0, TAU); G.stroke(); }
  }
  drawFallingStar(t, cam);
  drawMotes(t, cam, st, ps);
  drawFireflies(t, cam);
  drawPetals(t, cam);
  drawIgnition(t, cam, st);
  drawStorm(t, cam, st, 1);
  drawDust(t, cam);
  drawForeground(t, cam);
  composite(t);
  grade(t);
}

window.renderFrame = renderFrame;
window.FILM_READY = true;
