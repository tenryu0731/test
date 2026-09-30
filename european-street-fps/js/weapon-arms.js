// First-person arms: one skinned mesh pair (glove + sleeve) per arm, sharing a 19-bone skeleton
// (upper arm, forearm, wrist, hand, 3 x 4 finger phalanges, thumb metacarpal/proximal/distal).
// The bind pose is authored procedurally as smooth lofted tubes with blended joint weights and
// rigid "knuckle" spheres so bent joints stay round (no stacked capsules). Finger poses are
// solved once at start-up against signed distance fields of the gun parts (auto-grasp: every
// joint closes until its phalanx touches the surface), then blended per frame. The forearm is
// placed by a wrist-limited IK toward an elbow hint so the wrist never breaks.
import * as THREE from 'three';

const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- dimensions (right hand, metres)
// Hand space (bind pose): wrist at the origin, fingers along -z, back of the hand +y, thumb on -x.
export const FINGERS = [
  { x: -0.0268, y: -0.0008, z: -0.0895, len: [0.0445, 0.0265, 0.0225], r: [0.0103, 0.0094, 0.0086] }, // index
  { x: -0.0088, y: 0.0012, z: -0.0945, len: [0.0485, 0.0300, 0.0235], r: [0.0105, 0.0096, 0.0087] },  // middle
  { x: 0.0092, y: 0.0004, z: -0.0905, len: [0.0455, 0.0285, 0.0225], r: [0.0100, 0.0091, 0.0083] },   // ring
  { x: 0.0258, y: -0.0032, z: -0.0800, len: [0.0365, 0.0225, 0.0200], r: [0.0090, 0.0082, 0.0076] },  // little
];
export const THUMB = {
  base: new THREE.Vector3(-0.0215, -0.0085, -0.017),
  dir: new THREE.Vector3(-0.52, -0.30, -0.80).normalize(),   // relaxed thumb direction
  pad: new THREE.Vector3(0.62, -0.78, 0.05),                  // where the thumb pad faces
  len: [0.047, 0.034, 0.0285], r: [0.0150, 0.0117, 0.0105],
};
export const FORE_LEN = 0.262, UPPER_LEN = 0.29;
const SHOULDER_Z = FORE_LEN + UPPER_LEN;
// Palm centre on the palmar surface (for placing hands on surfaces).
export const PALM_C = new THREE.Vector3(0.0, -0.0145, -0.052);

// Bones: 0 upper, 1 fore (elbow), 2 fore2 (wrist, forearm-aligned), 3 hand, 4..15 fingers (3 each), 16..18 thumb.
export const B = { upper: 0, fore: 1, fore2: 2, hand: 3, finger: (i, k) => 4 + i * 3 + k, thumb: (k) => 16 + k };
const NB = 19;

const TH_BIND = (() => { // thumb bind rotation: local -z along the thumb, local -y toward the pad
  const z = THUMB.dir.clone().negate();
  const y = THUMB.pad.clone().negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
})();

// ---------------------------------------------------------------- colours (sRGB)
const COL = {
  fabric: new THREE.Color(0x4a4a40), leather: new THREE.Color(0x302e2a), seam: new THREE.Color(0x262521),
  pad: new THREE.Color(0x383833), cuff: new THREE.Color(0x3e372e), strap: new THREE.Color(0x2c2823),
  sleeve: new THREE.Color(0xeeeeee), sleeveHem: new THREE.Color(0xc8c8c8),
  watchCase: new THREE.Color(0x1d1e1f), watchFace: new THREE.Color(0x3a403a), watchStrap: new THREE.Color(0x252523), watchLcd: new THREE.Color(0x626b5f),
};
const _c = new THREE.Color();

// ---------------------------------------------------------------- skinned geometry builder
class SkinBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.si = []; this.sw = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  _w(w) {
    const s = w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    let t = 0; for (const e of s) t += e[1];
    for (let i = 0; i < 4; i++) { const e = s[i]; this.si.push(e ? e[0] : 0); this.sw.push(e ? e[1] / t : 0); }
  }
  /**
   * Tube through `rings` ({ c, X, Y, fn(θ) -> [rx, ry] (or radius), w }), `seg` sides.
   * Normals come from central differences on the (wrapped) grid, so there is no seam.
   * color(ringIndex, θ, point, normal) -> THREE.Color.
   */
  tube(rings, seg, color, { uScale = 1, vScale = 30, capStart = false, capEnd = false } = {}) {
    const n = rings.length, P = [];
    for (const r of rings) {
      const row = [];
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * PI * 2;
        if (r.pt) { const [x, y] = r.pt(th); row.push(r.c.clone().addScaledVector(r.X, x).addScaledVector(r.Y, y)); continue; }
        let rx, ry; const f = r.fn(th); if (Array.isArray(f)) { rx = f[0]; ry = f[1]; } else rx = ry = f;
        row.push(r.c.clone().addScaledVector(r.X, Math.cos(th) * rx).addScaledVector(r.Y, Math.sin(th) * ry));
      }
      P.push(row);
    }
    const base = this.count;
    let vAcc = 0;
    const du = new THREE.Vector3(), dv = new THREE.Vector3(), nn = new THREE.Vector3(), ax = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (i > 0) vAcc += rings[i].c.distanceTo(rings[i - 1].c);
      const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
      ax.copy(rings[inx].c).sub(rings[ip].c).normalize();
      for (let j = 0; j <= seg; j++) {
        const jj = j % seg, p = P[i][jj];
        du.copy(P[i][(jj + 1) % seg]).sub(P[i][(jj + seg - 1) % seg]);
        dv.copy(P[inx][jj]).sub(P[ip][jj]);
        nn.crossVectors(dv, du);
        const radial = p.clone().sub(rings[i].c);
        if (du.lengthSq() < 1e-14) nn.copy(ax).multiplyScalar(i === 0 ? -1 : 1); // pole
        else { if (nn.dot(radial) < 0) nn.negate(); }
        nn.normalize();
        const th = (jj / seg) * PI * 2;
        const c = color(i, th, p, nn);
        this.pos.push(p.x, p.y, p.z); this.nrm.push(nn.x, nn.y, nn.z); this.col.push(c.r, c.g, c.b);
        this.uv.push((j / seg) * uScale, vAcc * vScale);
        this._w(rings[i].w);
      }
    }
    const row = seg + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * row + j, b = a + 1, c = a + row, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
    const cap = (i, flip) => {
      const ctr = this.count, r = rings[i];
      const nrm = rings[Math.min(n - 1, i + 1)].c.clone().sub(rings[Math.max(0, i - 1)].c).normalize().multiplyScalar(flip ? -1 : 1);
      const c = color(i, 0, r.c, nrm);
      this.pos.push(r.c.x, r.c.y, r.c.z); this.nrm.push(nrm.x, nrm.y, nrm.z); this.col.push(c.r, c.g, c.b); this.uv.push(0, 0); this._w(r.w);
      for (let j = 0; j < seg; j++) { const a = base + i * row + j, b = a + 1; if (flip) this.idx.push(ctr, b, a); else this.idx.push(ctr, a, b); }
    };
    if (capStart) cap(0, true);
    if (capEnd) cap(n - 1, false);
  }
  /** Any BufferGeometry with one colour and rigid weights. */
  geometry(geo, m, color, w) {
    const g = geo.index ? geo : geo; g.applyMatrix4(m);
    const base = this.count, p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i)); this.nrm.push(nr.getX(i), nr.getY(i), nr.getZ(i));
      this.col.push(color.r, color.g, color.b); this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); this._w(w);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }
  build(mirror) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos), nrm = new Float32Array(this.nrm);
    if (mirror) { for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; } }
    const idx = this.idx.slice();
    if (mirror) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);

// ---------------------------------------------------------------- palm shape
/** Palm half-extents at t (0 wrist .. 1 knuckles) and x: returns [dorsalY, palmarY(negative)]. */
function palmHalf(t) {
  const a = 0.0305 + 0.0105 * smooth(-0.05, 0.72, t) - 0.0015 * smooth(0.9, 1.0, t);
  const bd = 0.0122 - 0.0012 * t;
  const bp = 0.0150 + 0.0012 * smooth(0.0, 0.25, t) - 0.0038 * smooth(0.35, 1.0, t);
  return { a, bd, bp };
}

function palmRings() {
  const L = 0.0862, rings = [], E = 2.7;
  const ts = [-0.2, -0.12, -0.04, 0.04, 0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.84, 0.92, 0.98, 1.03, 1.065, 1.085];
  for (const t0 of ts) {
    const t = Math.min(t0, 1);
    const shrink = t0 > 1 ? Math.sqrt(Math.max(0.02, 1 - ((t0 - 1) / 0.09) ** 2)) : 1;
    const { a, bd } = palmHalf(t);
    const z = -L * t0;
    const w = z > -0.004 ? [[B.hand, 1 - smooth(-0.004, 0.016, z)], [B.fore2, smooth(-0.004, 0.016, z)]] : [[B.hand, 1]];
    rings.push({
      c: V(0, 0, z), X: AX, Y: AY, w, t,
      pt: (th) => { // rounded-rectangle section: domed back, padded palm
        const cs = Math.cos(th), sn = Math.sin(th);
        const px = Math.sign(cs) * Math.abs(cs) ** (2 / E), py = Math.sign(sn) * Math.abs(sn) ** (2 / E);
        const x = a * px;
        const y = sn >= 0 ? bd * (1 - 0.16 * px * px) * py : palmPalmarMag(x, t) * py;
        return [x * shrink, y * shrink];
      },
    });
  }
  return rings;
}
function palmPalmarMag(x, t) {
  const { a, bp } = palmHalf(t);
  const u = clamp(x / a, -1, 1);
  const thenar = 0.0042 * Math.exp(-(((u + 0.52) / 0.36) ** 2)) * (1 - smooth(0.45, 0.8, t)) * smooth(-0.1, 0.12, t);
  const hypo = 0.0032 * Math.exp(-(((u - 0.62) / 0.3) ** 2)) * (1 - smooth(0.55, 0.85, t));
  const hollow = 0.0024 * Math.exp(-((u / 0.42) ** 2)) * smooth(0.25, 0.45, t) * (1 - smooth(0.75, 0.92, t));
  const pads = 0.0016 * smooth(0.78, 0.95, t);
  return bp + thenar + hypo - hollow + pads;
}
/** Palmar surface height (negative y) of the palm at x, t. */
export function palmPalmarY(x, t) {
  const { a } = palmHalf(t);
  const u = Math.min(1, Math.abs(x / a));
  return -palmPalmarMag(x, t) * (1 - u ** 2.7) ** (1 / 2.7);
}

// ---------------------------------------------------------------- hand + arm geometry
function gloveColor(kind) {
  // kind: finger/thumb/palm; returns fn(ringIndex, θ, p, n)
  return (i, th, p, n) => {
    const sn = Math.sin(th);
    const palmar = smooth(-0.15, -0.45, sn);
    _c.copy(COL.fabric).lerp(COL.leather, palmar);
    if (kind !== 'palm') { const seam = 1 - smooth(0.06, 0.16, Math.abs(sn)); _c.lerp(COL.seam, seam * 0.7); }
    else { const seam = (1 - smooth(0.05, 0.13, Math.abs(sn + 0.28))) * 0.6; _c.lerp(COL.seam, seam); }
    return _c;
  };
}

function digitRings(len, rad, seg0, bones, opts = {}) {
  // Tube along -z from s0 (< 0, inside the palm) to the tip; joints at 0, l0, l0+l1.
  const [l0, l1, l2] = len, s1 = l0, s2 = l0 + l1, tip = s2 + l2;
  const [r0, r1, r2] = rad, rTip = r2 * 0.94;
  const rAt = (s) => s < s1 ? r0 + (r1 - r0) * (s / s1) : s < s2 ? r1 + (r2 - r1) * ((s - s1) / l1) : r2 + (rTip - r2) * ((s - s2) / (l2 - rTip));
  const S = [];
  const start = opts.start ?? -0.016;
  for (let s = start; s < -0.004; s += 0.006) S.push(s);
  const add = (a, b, step) => { for (let s = a; s < b - 1e-6; s += step) S.push(s); };
  add(-0.004, 0.006, 0.0033); add(0.006, s1 - 0.005, (s1 - 0.011) / 3); add(s1 - 0.005, s1 + 0.006, 0.0037);
  add(s1 + 0.006, s2 - 0.004, (l1 - 0.01) / 2); add(s2 - 0.004, s2 + 0.005, 0.003); add(s2 + 0.005, tip - rTip, (l2 - rTip - 0.005) / 2);
  for (let k = 0; k <= 4; k++) S.push(tip - rTip + rTip * Math.sin((k / 4) * PI / 2));
  const bw = [opts.blend0 ?? 0.0045, 0.0034, 0.003];
  const joints = [0, s1, s2];
  return S.map((s) => {
    let r = s < tip - rTip ? rAt(Math.max(0, s)) : rTip * Math.sqrt(Math.max(0, 1 - ((s - (tip - rTip)) / rTip) ** 2));
    if (s < 0) r = r0 * (opts.baseSwell ? 1 + opts.baseSwell * smooth(0, start, s) : 1);
    // weights: parent before the joint, child after, blended over ±bw
    let w = [[bones[0], 1]];
    for (let j = 0; j < 3; j++) {
      const k = smooth(joints[j] - bw[j], joints[j] + bw[j], s);
      if (k <= 0) break;
      w = k >= 1 ? [[bones[j + 1], 1]] : [[bones[j], 1 - k], [bones[j + 1], k]];
    }
    // local segment phase for pads/creases
    const seg = s < s1 ? s / s1 : s < s2 ? (s - s1) / l1 : (s - s2) / l2;
    const nearJ = Math.min(Math.abs(s - s1), Math.abs(s - s2));
    const crease = s > 0.004 ? 1 - 0.1 * Math.exp(-((nearJ / 0.0035) ** 2)) : 1;
    const padB = s > 0 && s < tip - rTip * 0.5 ? 1 + 0.09 * Math.sin(clamp(seg, 0, 1) * PI) ** 1.5 : 1;
    const knuckle = s > 0.004 ? 1 + 0.07 * Math.exp(-((nearJ / 0.004) ** 2)) : 1;
    return {
      c: V(0, 0, -s), X: AX, Y: AY, w, s,
      fn: (th) => { const sn = Math.sin(th); return sn >= 0 ? [r * 1.07, r * 0.93 * knuckle] : [r * 1.07, r * 0.88 * crease * padB]; },
    };
  });
}

function buildHand(b, { watch }) {
  const gc = gloveColor('finger');
  // palm
  b.tube(palmRings(), 22, gloveColor('palm'), { uScale: 4, vScale: 40, capEnd: true });
  // fingers
  const sph = (c, r, w, col, seg = 9) => {
    const rings = [];
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * PI; rings.push({ c: c.clone().add(V(0, 0, -Math.cos(a) * r)), X: AX, Y: AY, w, fn: () => Math.max(1e-5, Math.sin(a) * r) }); }
    b.tube(rings, seg, () => col, { vScale: 60 });
  };
  FINGERS.forEach((f, i) => {
    const bones = [B.hand, B.finger(i, 0), B.finger(i, 1), B.finger(i, 2)];
    const rings = digitRings(f.len, f.r, 10, bones, { start: -0.018 });
    const at = V(f.x, f.y, f.z);
    for (const r of rings) r.c.add(at);
    b.tube(rings, 10, (ri, th, p, n) => {
      const col = gc(ri, th, p, n);
      const s = rings[ri].s, tipZone = smooth(f.len[0] + f.len[1] + f.len[2] - 0.013, f.len[0] + f.len[1] + f.len[2] - 0.009, s);
      return col.lerp(COL.leather, tipZone * 0.85);
    }, { uScale: 2, vScale: 40 });
    // round knuckles (rigid to the child bone, so they rotate about their own centre)
    sph(at.clone().add(V(0, 0.0012, 0)), f.r[0] * 0.98, [[bones[1], 1]], COL.fabric);
    sph(at.clone().add(V(0, 0.0006, -f.len[0])), f.r[1] * 0.97, [[bones[2], 1]], COL.fabric, 8);
    sph(at.clone().add(V(0, 0.0004, -f.len[0] - f.len[1])), f.r[2] * 0.96, [[bones[3], 1]], COL.fabric, 8);
    // padded strip on the proximal phalanx (back of the finger)
    const pr = [];
    const L = f.len[0] * 0.62, z0 = f.z - f.len[0] * 0.22;
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, a = u * PI;
      pr.push({ c: V(f.x, f.y + f.r[0] * 0.86 + 0.0004, z0 - u * L), X: AX, Y: AY, w: [[bones[1], 1]], fn: () => [Math.max(1e-5, Math.sin(a) ** 0.5) * f.r[0] * 0.95, Math.max(1e-5, Math.sin(a) ** 0.5) * 0.0016] });
    }
    b.tube(pr, 8, () => COL.pad, { vScale: 60 });
  });
  // thumb
  {
    const bones = [B.hand, B.thumb(0), B.thumb(1), B.thumb(2)];
    const rings = digitRings(THUMB.len, THUMB.r, 12, bones, { start: -0.02, blend0: 0.014, baseSwell: 0.12 });
    const m = new THREE.Matrix4().compose(THUMB.base, TH_BIND, V(1, 1, 1));
    const X = AX.clone().applyQuaternion(TH_BIND), Y = AY.clone().applyQuaternion(TH_BIND);
    for (const r of rings) { r.c.applyMatrix4(m); r.X = X; r.Y = Y; }
    const tl = THUMB.len[0] + THUMB.len[1] + THUMB.len[2];
    b.tube(rings, 12, (ri, th, p, n) => gc(ri, th, p, n).lerp(COL.leather, smooth(tl - 0.013, tl - 0.009, rings[ri].s) * 0.85), { uScale: 2, vScale: 40 });
    const j1 = V(0, 0.0008, -THUMB.len[0]).applyMatrix4(m), j2 = V(0, 0.0005, -THUMB.len[0] - THUMB.len[1]).applyMatrix4(m);
    const sphT = (c, r, w) => {
      const rr = [];
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * PI; rr.push({ c: c.clone().addScaledVector(AZ.clone().applyQuaternion(TH_BIND), -Math.cos(a) * r), X, Y, w, fn: () => Math.max(1e-5, Math.sin(a) * r) }); }
      b.tube(rr, 9, () => COL.fabric, { vScale: 60 });
    };
    sphT(j1, THUMB.r[1] * 0.99, [[B.thumb(1), 1]]);
    sphT(j2, THUMB.r[2] * 0.97, [[B.thumb(2), 1]]);
  }
  // gauntlet cuff + velcro strap
  {
    const zs = [0.001, 0.006, 0.014, 0.03, 0.05, 0.062, 0.068, 0.071];
    const rx = [0.0272, 0.0335, 0.0352, 0.0356, 0.0362, 0.0368, 0.0372, 0.031], ry = [0.0105, 0.0232, 0.0262, 0.0268, 0.0274, 0.0279, 0.0282, 0.022];
    const rings = zs.map((z, i) => ({ c: V(0, -0.0012, z), X: AX, Y: AY, w: z < 0.018 ? [[B.hand, 1 - smooth(-0.004, 0.018, z)], [B.fore2, smooth(-0.004, 0.018, z)]] : [[B.fore2, 1]], fn: () => [rx[i], ry[i]] }));
    b.tube(rings, 20, (i) => (i >= 5 ? _c.copy(COL.cuff).multiplyScalar(0.8) : COL.cuff), { uScale: 4, vScale: 40, capStart: true });
    const sr = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, a = u * PI;
      sr.push({ c: V(-0.001, 0.0272, 0.018 + u * 0.036), X: AX, Y: AY, w: [[B.fore2, 1]], fn: () => [Math.max(1e-5, Math.sin(a) ** 0.25) * 0.017, Math.max(1e-5, Math.sin(a) ** 0.25) * 0.003] });
    }
    b.tube(sr, 10, () => COL.strap, { vScale: 60 });
  }
  if (watch) {
    // Worn on the inside of the wrist, over the sleeve cuff.
    const z = 0.043, w = [[B.fore2, 1]];
    const rs = [];
    for (let k = 0; k <= 3; k++) rs.push({ c: V(0, -0.001, z - 0.0095 + k * 0.0063), X: AX, Y: AY, w, fn: () => [0.0376 + (k % 3 ? 0.0009 : 0), 0.0286 + (k % 3 ? 0.0009 : 0)] });
    b.tube(rs, 22, () => COL.watchStrap, { vScale: 60 });
    const caseG = new THREE.CylinderGeometry(0.0145, 0.0152, 0.0075, 18, 1);
    b.geometry(caseG, new THREE.Matrix4().compose(V(0, -0.0318, z), new THREE.Quaternion(), V(1, 1, 1.05)), COL.watchCase, w);
    const face = new THREE.CylinderGeometry(0.0115, 0.0115, 0.001, 18, 1);
    b.geometry(face, new THREE.Matrix4().makeTranslation(0, -0.0358, z), COL.watchFace, w);
    const lcd = new THREE.BoxGeometry(0.012, 0.0008, 0.0055);
    b.geometry(lcd, new THREE.Matrix4().makeTranslation(0, -0.0364, z + 0.0012), COL.watchLcd, w);
    for (const sx of [-1, 1]) {
      const btn = new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 8, 1); btn.rotateZ(PI / 2);
      b.geometry(btn, new THREE.Matrix4().makeTranslation(sx * 0.0162, -0.032, z - 0.003), COL.watchCase, w);
    }
  }
}

function buildSleeve(b) {
  // Loose combat-shirt sleeve with a hemmed cuff, compression folds near the wrist and at the elbow.
  const zs = [];
  for (let z = 0.062; z < 0.09; z += 0.0055) zs.push(z);
  for (let z = 0.09; z < 0.18; z += 0.0085) zs.push(z);
  for (let z = 0.18; z < 0.33; z += 0.015) zs.push(z);
  zs.push(0.36, 0.42, 0.49, SHOULDER_Z + 0.02);
  const radius = (z) => {
    const rx = z < 0.075 ? 0.0405 : z < 0.3 ? 0.0435 + 0.013 * smooth(0.075, 0.3, z) : 0.0565 + 0.008 * smooth(0.3, 0.55, z);
    const ry = z < 0.075 ? 0.0322 : z < 0.3 ? 0.0365 + 0.016 * smooth(0.075, 0.3, z) : 0.0525 + 0.009 * smooth(0.3, 0.55, z);
    return [rx, ry];
  };
  const fold = (z, th) => {
    const near = smooth(0.075, 0.095, z) * (1 - smooth(0.15, 0.2, z));
    const rings = 0.055 * Math.sin(z * 118 + 1.1 * Math.sin(th * 2 + z * 30)) * near;
    const diag = 0.028 * Math.sin(th * 3 + z * 26) * Math.sin(z * 13 + 0.6) * smooth(0.06, 0.12, z) * (1 - smooth(0.3, 0.4, z));
    const elbow = 0.045 * Math.sin(z * 90 + th) * Math.exp(-(((z - 0.262) / 0.03) ** 2)) * smooth(-0.3, 0.4, -Math.sin(th));
    const hem = 0.03 * Math.exp(-(((z - 0.066) / 0.004) ** 2));
    return rings + diag + elbow + hem + 0.012 * Math.sin(th * 5 - z * 40);
  };
  const rings = zs.map((z) => {
    const w = z < 0.27 ? [[B.fore2, 1 - smooth(0.05, 0.25, z)], [B.fore, smooth(0.05, 0.25, z)]] : [[B.fore, 1]];
    if (z > 0.23) { const k = smooth(0.235, 0.3, z); w.length = 0; w.push([B.fore, 1 - k], [B.upper, k]); }
    const [rx, ry] = radius(z);
    return { c: V(0, 0.001, z), X: AX, Y: AY, w, z, fn: (th) => { const f = 1 + fold(z, th); return [rx * f, ry * f]; } };
  });
  // Turn the first ring inward so the hem has thickness.
  const r0 = rings[0], inner = { ...r0, c: r0.c.clone().add(V(0, -0.001, 0.007)), fn: () => [0.0376, 0.0287] };
  rings.unshift(inner);
  b.tube(rings, 24, (i, th) => {
    const z = rings[i].z ?? 0.04;
    const f = i === 0 ? -0.1 : fold(z, th);
    const ao = clamp(0.84 + f * 5, 0.62, 1.06);
    _c.copy(z < 0.075 ? COL.sleeveHem : COL.sleeve).multiplyScalar(ao * 0.9);
    return _c;
  }, { uScale: 3, vScale: 9 });
  // velcro tab on the cuff (outer side)
  const tr = [];
  for (let k = 0; k <= 5; k++) { const u = k / 5, a = u * PI; tr.push({ c: V(0.0445, 0.004, 0.066 + u * 0.03), X: AY, Y: AX, w: [[B.fore2, 1]], fn: () => [Math.max(1e-5, Math.sin(a) ** 0.3) * 0.0105, Math.max(1e-5, Math.sin(a) ** 0.3) * 0.0022] }); }
  b.tube(tr, 8, () => _c.copy(COL.sleeve).multiplyScalar(0.72), { vScale: 20 });
}

// ---------------------------------------------------------------- pose maths
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _eu = new THREE.Euler();
/** Right-hand pose -> 15 local quaternions (fingers 0..11, thumb 12..14). */
export function poseQuats(pose, mirror = false) {
  const out = [];
  pose.fingers.forEach(([abd, f1, f2, f3]) => {
    out.push(new THREE.Quaternion().setFromAxisAngle(AY, abd).multiply(_qa.setFromAxisAngle(AX, -f1)));
    out.push(new THREE.Quaternion().setFromAxisAngle(AX, -f2));
    out.push(new THREE.Quaternion().setFromAxisAngle(AX, -f3));
  });
  const t = pose.thumb; // [flex, abd, twist, mcp, ip]
  out.push(TH_BIND.clone().multiply(_qa.setFromEuler(_eu.set(-t[0], t[1], t[2], 'YXZ'))));
  out.push(new THREE.Quaternion().setFromAxisAngle(AX, -t[3]));
  out.push(new THREE.Quaternion().setFromAxisAngle(AX, -t[4]));
  if (mirror) for (const q of out) { q.y = -q.y; q.z = -q.z; }
  return out;
}

/** Joint positions (hand space) of a digit: base, q0..q2 local rotations, lengths. */
function digitJoints(base, q0, q1, q2, len, out) {
  const q = _qb.copy(q0);
  out[0].copy(base);
  out[1].set(0, 0, -len[0]).applyQuaternion(q).add(out[0]);
  q.multiply(q1);
  out[2].set(0, 0, -len[1]).applyQuaternion(q).add(out[1]);
  q.multiply(q2);
  out[3].set(0, 0, -len[2]).applyQuaternion(q).add(out[2]);
  return out;
}

/**
 * Auto-grasp: close each joint of a digit (at speeds `vel`) until its phalanx touches the surface
 * (`sdf` in object space; `H` hand-space -> object-space matrix). Joints proximal to a touching
 * phalanx stop, distal joints keep closing (like a real hand wrapping around a handle).
 */
export function grasp(H, sdf, digit, angles, { vel = [1, 1.15, 0.9], max = [1.6, 1.85, 1.3], squeeze = 0.9, thumb = false } = {}) {
  const f = digit, a = angles.slice();
  const J = [V(), V(), V(), V()], tmp = V();
  const base = thumb ? THUMB.base : V(f.x, f.y, f.z);
  const lens = thumb ? THUMB.len : f.len, rads = thumb ? THUMB.r : f.r;
  const idx = thumb ? [3, 4] : [1, 2, 3]; // indices in `a` of the closing joints (thumb: mcp, ip + flex at 0)
  const flexIdx = thumb ? [0, 3, 4] : [1, 2, 3];
  const q0 = V(), q = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  const fk = () => {
    if (thumb) {
      q[0].copy(TH_BIND).multiply(_qa.setFromEuler(_eu.set(-a[0], a[1], a[2], 'YXZ')));
      q[1].setFromAxisAngle(AX, -a[3]); q[2].setFromAxisAngle(AX, -a[4]);
    } else {
      q[0].setFromAxisAngle(AY, a[0]).multiply(_qa.setFromAxisAngle(AX, -a[1]));
      q[1].setFromAxisAngle(AX, -a[2]); q[2].setFromAxisAngle(AX, -a[3]);
    }
    digitJoints(base, q[0], q[1], q[2], lens, J);
  };
  const hits = (k) => {
    const n = 6;
    for (let s = k === 0 ? 2 : 0; s <= n; s++) {
      tmp.lerpVectors(J[k], J[k + 1], s / n).applyMatrix4(H);
      if (sdf(tmp) < rads[k] * squeeze) return true;
    }
    return false;
  };
  void q0; void idx;
  const active = [true, true, true];
  for (let it = 0; it < 500 && active.some(Boolean); it++) {
    const prev = a.slice();
    for (let j = 0; j < 3; j++) if (active[j]) { a[flexIdx[j]] += vel[j] * 0.012; if (a[flexIdx[j]] >= max[j]) { a[flexIdx[j]] = max[j]; active[j] = false; } }
    fk();
    for (let k = 0; k < 3; k++) {
      if (hits(k)) { for (let j = 0; j <= k; j++) { a[flexIdx[j]] = prev[flexIdx[j]]; active[j] = false; } fk(); }
    }
  }
  return a;
}

/**
 * Small numeric optimiser (coordinate descent) for targeted digit poses. digitIndex 0..3 = finger
 * (x = [abd, f1, f2, f3]); -1 = thumb (x = [cmcFlex, cmcAbd, twist, mcp, ip]).
 * cost(W joints in object space, pad point, radii, x).
 */
export function solveDigit(H, digitIndex, init, cost, { steps = 60, limits } = {}) {
  const thumb = digitIndex < 0, f = thumb ? null : FINGERS[digitIndex];
  const base = thumb ? THUMB.base : V(f.x, f.y, f.z), lens = thumb ? THUMB.len : f.len, rads = thumb ? THUMB.r : f.r;
  const J = [V(), V(), V(), V()], a = init.slice(), n = a.length;
  const q = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  const evalA = (x) => {
    if (thumb) {
      q[0].copy(TH_BIND).multiply(_qa.setFromEuler(_eu.set(-x[0], x[1], x[2], 'YXZ')));
      q[1].setFromAxisAngle(AX, -x[3]); q[2].setFromAxisAngle(AX, -x[4]);
    } else {
      q[0].setFromAxisAngle(AY, x[0]).multiply(_qa.setFromAxisAngle(AX, -x[1]));
      q[1].setFromAxisAngle(AX, -x[2]); q[2].setFromAxisAngle(AX, -x[3]);
    }
    digitJoints(base, q[0], q[1], q[2], lens, J);
    const W = J.map((p) => p.clone().applyMatrix4(H));
    const padDir = V(0, -1, 0).applyQuaternion(q[0].clone().multiply(q[1]).multiply(q[2])).transformDirection(H);
    const pad = W[2].clone().lerp(W[3], 0.55).addScaledVector(padDir, rads[2] * 0.85);
    return cost(W, pad, rads, x);
  };
  let best = evalA(a), step = 0.25;
  for (let it = 0; it < steps; it++) {
    let improved = false;
    for (let k = 0; k < n; k++) for (const sgn of [1, -1]) {
      const x = a.slice(); x[k] += sgn * step;
      if (limits) x[k] = clamp(x[k], limits[k][0], limits[k][1]);
      const c = evalA(x);
      if (c < best) { best = c; a.splice(0, n, ...x); improved = true; }
    }
    if (!improved) step *= 0.6;
    if (step < 0.002) break;
  }
  return { angles: a, cost: best, joints: J.map((p) => p.clone().applyMatrix4(H)) };
}

// ---------------------------------------------------------------- signed distance helpers
export function sdPolygon(px, py, pts) {
  let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2, s = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    const ex = xj - xi, ey = yj - yi, wx = px - xi, wy = py - yi;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * h, by = wy - ey * h;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= yi, c2 = py < yj, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
export function sdBox(p, c, h, r = 0) {
  const qx = Math.abs(p.x - c[0]) - h[0] + r, qy = Math.abs(p.y - c[1]) - h[1] + r, qz = Math.abs(p.z - c[2]) - h[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** Extruded 2D profile ([z, y] points) of half-width hw along x, rounded by r. */
export function sdProfile(p, pts, hw, r) {
  const d2 = sdPolygon(p.z, p.y, pts), dx = Math.abs(p.x) - hw + r;
  return Math.hypot(Math.max(d2, 0), Math.max(dx, 0)) + Math.min(Math.max(d2, dx), 0) - r;
}

// ---------------------------------------------------------------- the arm rig
const _m = new THREE.Matrix4(), _v = V(), _w = V(), _x = V(), _y = V(), _z = V(), _e2 = V();
const _q = new THREE.Quaternion(), _hq = new THREE.Quaternion();

export class Arm {
  /** side: 1 right, -1 left. mats: { glove, sleeve }. */
  constructor(side, mats, { watch = false } = {}) {
    this.side = side;
    const gb = new SkinBuilder(), sb = new SkinBuilder();
    buildHand(gb, { watch });
    buildSleeve(sb);
    const mirror = side < 0;
    this.gloveGeo = gb.build(mirror);
    this.sleeveGeo = sb.build(mirror);
    // bones (flat arm chain; fingers hierarchical under the hand)
    const bones = [];
    for (let i = 0; i < NB; i++) bones.push(new THREE.Bone());
    this.bones = bones;
    const sx = side;
    bones[B.upper].position.set(0, 0, SHOULDER_Z);
    bones[B.fore].position.set(0, 0, FORE_LEN);
    bones[B.fore2].position.set(0, 0, 0);
    bones[B.hand].position.set(0, 0, 0);
    this.root = new THREE.Group();
    for (const k of [B.upper, B.fore, B.fore2, B.hand]) this.root.add(bones[k]);
    FINGERS.forEach((f, i) => {
      const b0 = bones[B.finger(i, 0)], b1 = bones[B.finger(i, 1)], b2 = bones[B.finger(i, 2)];
      b0.position.set(sx * f.x, f.y, f.z); b1.position.set(0, 0, -f.len[0]); b2.position.set(0, 0, -f.len[1]);
      bones[B.hand].add(b0); b0.add(b1); b1.add(b2);
    });
    {
      const t0 = bones[B.thumb(0)], t1 = bones[B.thumb(1)], t2 = bones[B.thumb(2)];
      t0.position.set(sx * THUMB.base.x, THUMB.base.y, THUMB.base.z); t1.position.set(0, 0, -THUMB.len[0]); t2.position.set(0, 0, -THUMB.len[1]);
      t0.quaternion.copy(TH_BIND); if (mirror) { t0.quaternion.y *= -1; t0.quaternion.z *= -1; }
      bones[B.hand].add(t0); t0.add(t1); t1.add(t2);
    }
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.glove = new THREE.SkinnedMesh(this.gloveGeo, mats.glove);
    this.sleeve = new THREE.SkinnedMesh(this.sleeveGeo, mats.sleeve);
    for (const m of [this.glove, this.sleeve]) { m.frustumCulled = false; m.bind(this.skeleton, new THREE.Matrix4()); }
    this.glove.add(this.root);
    this.meshes = [this.glove, this.sleeve];
    this.upperLen = UPPER_LEN;
  }

  /** Blend local finger rotations: a, b arrays of 15 quaternions, k in 0..1. */
  setFingers(a, b = null, k = 0) {
    const bs = this.bones;
    for (let i = 0; i < 15; i++) {
      const bone = i < 12 ? bs[4 + i] : bs[16 + i - 12];
      if (b && k > 0) bone.quaternion.slerpQuaternions(a[i], b[i], k); else bone.quaternion.copy(a[i]);
    }
  }

  /**
   * Place the arm: `hand` = hand-space -> view-space matrix, `shoulder` and `elbowHint` in view space.
   * The forearm points from the wrist toward the hint, limited to a plausible wrist bend.
   */
  update(hand, shoulder, elbowHint, { flex = [-0.5, 0.55], dev = [-0.42, 0.42] } = {}) {
    const bs = this.bones, s = this.side;
    const wrist = _w.setFromMatrixPosition(hand);
    _hq.setFromRotationMatrix(_m.extractRotation(hand));
    // forearm direction in hand space, clamped to the wrist's range
    const d = _v.copy(elbowHint).sub(wrist).normalize().applyQuaternion(_q.copy(_hq).invert());
    let pitch = Math.atan2(d.y, d.z), yaw = Math.atan2(d.x * s, Math.hypot(d.y, d.z));
    pitch = clamp(pitch, flex[0], flex[1]); yaw = clamp(yaw, dev[0], dev[1]);
    d.set(s * Math.sin(yaw), Math.cos(yaw) * Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(_hq);
    const elbow = _e2.copy(wrist).addScaledVector(d, FORE_LEN);
    // forearm frame: +z toward the elbow, y = back of the hand projected
    _z.copy(d);
    _y.set(0, 1, 0).applyQuaternion(_hq); _y.addScaledVector(_z, -_y.dot(_z)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    bs[B.fore2].position.copy(wrist); bs[B.fore2].quaternion.copy(_q);
    bs[B.fore].position.copy(elbow); bs[B.fore].quaternion.copy(_q);
    bs[B.hand].position.copy(wrist); bs[B.hand].quaternion.copy(_hq);
    // upper arm: elbow -> shoulder, stretched to fit (it is mostly off-screen)
    _z.copy(shoulder).sub(elbow); const L = _z.length(); _z.divideScalar(L);
    _y.addScaledVector(_z, -_y.dot(_z)); if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0); _y.normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    bs[B.upper].quaternion.setFromRotationMatrix(_m);
    bs[B.upper].position.copy(shoulder);
    bs[B.upper].scale.set(1, 1, L / UPPER_LEN);
    this.elbow = elbow;
  }
}

/** Hand placement (hand space -> object space) from the palm normal, the knuckle line toward the little finger and the palm contact point. */
export function handFrame(side, palmN, ulnar, contact) {
  const Y = palmN.clone().normalize().negate();
  const X = ulnar.clone().multiplyScalar(side).addScaledVector(Y, -ulnar.clone().multiplyScalar(side).dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  const pc = PALM_C.clone().setX(PALM_C.x * side).applyMatrix4(m);
  m.setPosition(contact.clone().sub(pc));
  return m;
}

/** Palmar sample points (hand space) used to seat a palm on a surface. */
export function palmSamples(side) {
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let k = 0; k <= 4; k++) {
    const t = 0.15 + i * 0.18, u = -0.8 + k * 0.4;
    const { a } = palmHalf(t), x = u * a;
    pts.push(new THREE.Vector3(x * side, palmPalmarY(x, t), -0.0862 * t));
  }
  return pts;
}

/** Move a hand along its palm normal until the palm just touches the surface. */
export function seatPalm(H, side, sdf, gap = 0.0006) {
  const pts = palmSamples(side), n = new THREE.Vector3(0, -1, 0).transformDirection(H), p = new THREE.Vector3();
  let minD = Infinity;
  for (const q of pts) { p.copy(q).applyMatrix4(H); minD = Math.min(minD, sdf(p)); }
  const shift = minD - gap; // move along the palm normal by `shift`
  H.elements[12] += n.x * shift; H.elements[13] += n.y * shift; H.elements[14] += n.z * shift;
  return shift;
}

export function mirrorMatrix(m) { // conjugate by the x mirror (right-hand solve for a left hand)
  const M = new THREE.Matrix4().makeScale(-1, 1, 1);
  return new THREE.Matrix4().multiplyMatrices(M, m).multiply(M);
}
