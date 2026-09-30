// Ordinary town fabric: houses, shops and palazzi on the plan's lots, and the tower houses.
import { LOD } from './city-geo.js';
import { makeFace, fx, fz, tintFrom, mulTint } from './city-kit.js';
import { GROUND_KINDS, GW, WALK, COURT } from './city-plan.js';

export function createBuilders(ctx) {
  const { geo, M, R, grid, collide, decals, kit } = ctx;
  const { T, TPL, FAC, rr, pick, setLod, front, lbox, facadeWall, windowFill, doorFill, shopFill, biforaOps, biforaDress, balcony, roof, chimney, merlons, archRing, archCurve, pyramid } = kit;
  const plasterTints = M.plasterColours.map((c) => tintFrom(c, M.plasterNeutral));
  const shutterTints = M.shutterColours.map((c) => tintFrom(c, M.shutterNeutral));
  const kindAt = (x, z) => { const i = grid.ix(x), j = grid.iz(z); return GROUND_KINDS[grid.k[j * GW + i]]; };

  // Probes a lot's four faces: how much of each looks onto public space / private courts.
  function faceInfo(r) {
    const out = {};
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = makeFace(r, dir);
      let walk = 0, court = 0, k = 0;
      const kinds = {};
      for (let t = 0.25; t < f.W; t += 0.5) {
        k++;
        const x = fx(f, t, 0.6), z = fz(f, t, 0.6), v = grid.get(x, z);
        if (v === WALK) { walk++; const kk = kindAt(x, z); kinds[kk] = (kinds[kk] || 0) + 1; } else if (v === COURT) court++;
      }
      let kind = null, best = 0;
      for (const kk in kinds) if (kinds[kk] > best) { best = kinds[kk]; kind = kk; }
      out[dir] = { f, walk, court, frac: k ? walk / k : 0, cfrac: k ? court / k : 0, kind };
    }
    return out;
  }
  const walkOut = (f, t, d = 0.6) => grid.isWalk(fx(f, t, d), fz(f, t, d));
  const canPot = (f, t) => walkOut(f, t, 3.4);

  // Contact shadow strips along the street-side base of a façade (merged runs).
  function contact(f, t0, t1) {
    let run = -1;
    for (let t = t0; t <= t1 + 1e-6; t += 0.5) {
      const ok = t < t1 - 0.01 && walkOut(f, Math.min(t + 0.25, t1 - 0.01), 0.3);
      if (ok && run < 0) run = t;
      else if (!ok && run >= 0) { decals.strip(f, run, Math.min(t, t1)); run = -1; }
    }
  }

  // ---------------------------------------------------------------- styles
  function makeStyle(l, info, force) {
    const kinds = ['N', 'S', 'W', 'E'].map((d) => info[d].walk >= 3 ? info[d].kind : null);
    const onSquare = kinds.some((k) => k === 'sqH' || k === 'sqP' || k === 'sq');
    const onMain = onSquare || kinds.some((k) => k === 'main');
    const onAlley = !onMain && !kinds.some((k) => k === 'st') && kinds.some((k) => k === 'al' || k === 'orch' || k === 'gar');
    const front = Math.max(l.x1 - l.x0, l.z1 - l.z0);
    let type = force?.type;
    if (!type) {
      const r = R();
      if (onMain && front >= 11 && r < 0.7) type = 'palazzo';
      else if (onMain) type = r < 0.35 ? 'mista' : r < 0.75 ? 'casa' : r < 0.88 ? 'pietra' : 'palazzo';
      else if (onAlley) type = r < 0.45 ? 'casa' : r < 0.75 ? 'pietra' : 'rustica';
      else type = r < 0.5 ? 'casa' : r < 0.72 ? 'mista' : r < 0.92 ? 'pietra' : 'palazzo';
    }
    const S = { type, uvOff: [R() * 5, R() * 5], pots: 0.16, lantern: R() < 0.2, awnings: onMain, canPot, noPots: false };
    const stoneTint = () => { const k = rr(0.9, 1.06); return [k * rr(0.98, 1.04), k, k * rr(0.94, 1.0)]; };
    let storeys;
    if (type === 'palazzo') {
      storeys = 3 + (R() < 0.45 ? 1 : 0);
      S.G = rr(4.8, 5.4); S.F = rr(4.0, 4.4);
      const brick = R() < 0.55;
      S.upper = brick ? T.brick : pick([T.stone, T.stone, T.stoneDark]);
      S.upperTint = brick ? mulTint([1, rr(0.92, 1.02), rr(0.88, 1)], rr(0.92, 1.08)) : stoneTint();
      S.groundMat = R() < 0.7 ? pick([T.stone, T.stoneDark]) : S.upper;
      S.groundTint = S.groundMat === S.upper ? S.upperTint : stoneTint();
      S.framed = true; S.shutters = false; S.banded = true; S.eave = R() < 0.3 ? 'crenel' : 'cornice';
      S.winKind = R() < 0.75 ? 'bifora' : 'arch'; S.archShape = brick ? (R() < 0.6 ? 'pointed' : 'round') : 'round';
      S.bench = R() < 0.6; S.pots = 0.05;
    } else if (type === 'mista') {
      storeys = onMain ? 3 + (R() < 0.35 ? 1 : 0) : 2 + (R() < 0.6 ? 1 : 0);
      S.G = rr(3.9, 4.4); S.F = rr(3.2, 3.5);
      S.groundMat = pick([T.stone, T.stone, T.stoneDark]); S.groundTint = stoneTint();
      const brick = R() < 0.5;
      S.upper = brick ? T.brick : T.plaster;
      S.upperTint = brick ? mulTint([1, rr(0.92, 1.02), rr(0.9, 1)], rr(0.9, 1.06)) : mulTint(pick(plasterTints), rr(0.95, 1.05));
      S.framed = brick || R() < 0.5; S.shutters = !brick || R() < 0.4; S.banded = R() < 0.6; S.eave = R() < 0.55 ? 'rafters' : 'cornice';
      S.winKind = brick && R() < 0.6 ? 'seg' : 'rect';
    } else if (type === 'pietra') {
      storeys = 2 + (R() < 0.55 ? 1 : 0);
      S.G = rr(3.6, 4.1); S.F = rr(3.1, 3.4);
      S.upper = S.groundMat = R() < 0.7 ? T.stone : T.stoneDark; S.upperTint = S.groundTint = stoneTint();
      S.framed = R() < 0.4; S.shutters = R() < 0.45; S.banded = false; S.eave = 'rafters';
      S.winKind = R() < 0.5 ? 'arch' : 'rect'; S.archShape = R() < 0.7 ? 'round' : 'seg'; S.putlogs = true;
    } else if (type === 'rustica') {
      storeys = 2;
      S.G = rr(3.3, 3.7); S.F = rr(3.0, 3.2);
      S.upper = S.groundMat = T.plaster; S.upperTint = S.groundTint = mulTint(pick(plasterTints), rr(0.9, 1.0));
      S.framed = false; S.shutters = R() < 0.7; S.banded = false; S.eave = 'rafters'; S.winKind = 'rect'; S.small = true;
      S.plinth = R() < 0.5 ? T.stone : null; S.plinthH = rr(0.4, 0.8);
    } else { // casa
      storeys = onMain ? 3 + (R() < 0.35 ? 1 : 0) : 2 + (R() < 0.65 ? 1 : 0) + (R() < 0.08 ? 1 : 0);
      S.G = rr(3.8, 4.2); S.F = rr(3.15, 3.4);
      S.upper = S.groundMat = T.plaster; S.upperTint = S.groundTint = mulTint(pick(plasterTints), rr(0.95, 1.05));
      S.plinth = R() < 0.6 ? T.stone : T.trim; S.plinthH = rr(0.45, 0.9);
      S.framed = R() < 0.45; S.shutters = R() < 0.88; S.banded = R() < 0.4; S.eave = R() < 0.5 ? 'rafters' : 'cornice';
      S.winKind = 'rect'; S.balconies = R() < 0.4;
    }
    if (force?.storeys) storeys = force.storeys;
    if (force?.G) S.G = force.G;
    S.storeys = storeys;
    S.H = S.G + (storeys - 1) * S.F + 0.55 + rr(-0.15, 0.2);
    S.wall = S.upper; S.tint = S.upperTint;
    S.wallFor = (bi) => (bi === 0 ? S.groundMat : S.upper);
    S.tintFor = (bi) => (bi === 0 ? S.groundTint : S.upperTint);
    S.trimTint = mulTint([0.95, 0.91, 0.83], rr(0.88, 1.02));
    S.shutterTint = pick(shutterTints);
    S.frameTint = pick([0.9, 0.7, [0.75, 0.85, 0.75], [1.1, 1.05, 0.95]]);
    S.ww = S.small ? rr(0.75, 0.9) : rr(0.95, 1.15); S.wh = S.small ? rr(1.1, 1.35) : rr(1.55, 1.8);
    S.bay = type === 'palazzo' ? rr(3.4, 4.2) : rr(2.7, 3.4);
    S.archDoor = type !== 'casa' || R() < 0.4;
    S.shop = onMain && type !== 'palazzo' ? 0.75 : type === 'mista' ? 0.45 : 0.08;
    S.pitch = rr(0.3, 0.4);
    { const k = rr(0.8, 1.08), g = R() < 0.25 ? rr(0.95, 1.08) : rr(0.86, 0.98); S.roofTint = [k, k * g, k * g * rr(0.9, 1.02)]; }
    S.fanlight = R() < 0.5;
    if (force?.S) {
      Object.assign(S, force.S);
      S.H = S.G + (S.storeys - 1) * S.F + 0.55;
      S.wall = S.upper; S.tint = S.upperTint;
    }
    return S;
  }

  function storeyY(S, s) { return s === 0 ? 0 : S.G + (s - 1) * S.F; }

  function lotBands(f, S, court) {
    const W = f.W, nb = Math.max(1, Math.floor((W - 0.6) / S.bay)), bw = W / nb, bands = [];
    const bays = [];
    for (let i = 0; i < nb; i++) { const tc = (i + 0.5) * bw; if (W > 2.4 && (court || walkOut(f, tc))) bays.push(tc); }
    const doorBay = court || !bays.length ? -1 : Math.floor(R() * bays.length);
    const balcBay = Math.floor(R() * Math.max(1, bays.length));
    for (let s = 0; s < S.storeys; s++) {
      const y0 = storeyY(S, s), y1 = s === S.storeys - 1 ? S.H : storeyY(S, s + 1);
      const ops = [];
      bays.forEach((tc, i) => {
        if (s === 0) {
          if (court) { if (R() < 0.5) ops.push({ kind: 'win', t0: tc - 0.45, t1: tc + 0.45, y0: 1.2, y1: 2.5, shape: 'rect' }); return; }
          if (i === doorBay) {
            const big = S.type === 'palazzo', w = big ? 1.9 : 1.25;
            const spring = big ? Math.min(3.1, S.G - 1.5) : 2.3;
            ops.push(S.archDoor ? { kind: 'door', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: spring, shape: big && S.archShape === 'pointed' ? 'pointed' : 'round', ring: big ? 0.34 : 0.22 } : { kind: 'door', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: 2.55, shape: 'rect' });
          } else if (R() < S.shop) {
            const w = Math.min(2.5, bw - 0.9);
            ops.push({ kind: 'shop', t0: tc - w / 2, t1: tc + w / 2, y0: 0, y1: Math.min(2.4, S.G - 0.45 - w / 2), shape: S.type === 'casa' && R() < 0.4 ? 'seg' : 'round', wooden: R() < 0.25 });
          } else if (R() < 0.75) ops.push({ kind: 'gwin', t0: tc - 0.42, t1: tc + 0.42, y0: 1.55, y1: 2.6, shape: 'rect' });
        } else {
          const F = y1 - y0, sill = y0 + (S.type === 'palazzo' ? 1.0 : 0.95);
          if (court && R() < 0.5) return;
          if (!court && S.balconies && s === 1 && (i === balcBay || R() < 0.2)) {
            ops.push({ kind: 'balc', t0: tc - S.ww / 2, t1: tc + S.ww / 2, y0: y0 + 0.02, y1: Math.min(sill + S.wh, y1 - 0.45), shape: 'rect' });
            return;
          }
          if (!court && S.winKind === 'bifora' && s <= 2) {
            const w = 1.5, pointed = S.archShape === 'pointed', rise = pointed ? 0.74 * (w + 0.04) : (w + 0.04) / 2;
            const spring = Math.min(y1 - 0.4 - rise, sill + 2.3);
            const lw = (w - 0.2) / 2;
            if (spring - sill > 1.1) { ops.push(...biforaOps(tc, sill, w, spring - sill + lw / 2, pointed ? 'pointed' : 'round')); return; }
          }
          if (S.winKind === 'arch' || S.winKind === 'bifora') {
            const w = S.ww * 0.95, top = Math.min(sill + S.wh, y1 - 0.35);
            ops.push({ kind: 'win', t0: tc - w / 2, t1: tc + w / 2, y0: sill, y1: top - (S.archShape === 'seg' ? w / 5 : w / 2), shape: S.archShape || 'round' });
          } else if (S.winKind === 'seg') {
            const w = S.ww, top = Math.min(sill + S.wh, y1 - 0.35);
            ops.push({ kind: 'win', t0: tc - w / 2, t1: tc + w / 2, y0: sill, y1: top - w / 5, shape: 'seg' });
          } else {
            const w = S.ww;
            ops.push({ kind: 'win', t0: tc - w / 2, t1: tc + w / 2, y0: sill, y1: Math.min(sill + S.wh, y1 - 0.4), shape: 'rect' });
          }
          void F;
        }
      });
      bands.push({ y0, y1, ops });
    }
    return bands;
  }

  // ---------------------------------------------------------------- one building
  function building(r, S, info, opt = {}) {
    const [x0, x1, z0, z1] = r;
    const isFac = (d) => info[d].walk >= 3 && !opt.blind?.includes(d);
    const isCourt = (d) => !isFac(d) && info[d].cfrac > 0.5 && !opt.blind?.includes(d);
    const facade = (d) => isFac(d) || isCourt(d);
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    const bx0 = x0 + (facade('W') ? FAC : 0), bx1 = x1 - (facade('E') ? FAC : 0);
    const bz0 = z0 + (facade('N') ? FAC : 0), bz1 = z1 - (facade('S') ? FAC : 0);
    // Body: skip the faces hidden behind façade slabs and the top (under the roof).
    const skip = 4 | (facade('E') ? 1 : 0) | (facade('W') ? 2 : 0) | (facade('S') ? 16 : 0) | (facade('N') ? 32 : 0);
    let prev = setLod(LOD.BASE);
    const y0 = opt.y0 ?? 0;
    geo.box(S.wall, bx0, y0, bz0, bx1, S.H, bz1, { tint: S.tint, uvOff: S.uvOff, top: S.H, skip });
    // Close the ends of each façade slab on party-wall sides: the slab stands FAC in front of the
    // body, and without a cap the gap shows light through the building wherever the neighbour is lower.
    // Box face bits: 1 +x, 2 -x, 4 top, 8 bottom, 16 +z, 32 -z; only the outward side face is kept.
    // Corners where two façades meet: the N/S slab runs the full width but the W/E slab starts FAC
    // in from the corner (ts/te below), so the corner square needs its W/E face or it is an open
    // slot through which the inside of the building shows.
    for (const e of ['W', 'E']) for (const d of ['N', 'S']) {
      if (!facade(e) || !facade(d)) continue;
      const px = e === 'W' ? [x0, x0 + FAC] : [x1 - FAC, x1], pz = d === 'N' ? [z0, z0 + FAC] : [z1 - FAC, z1];
      geo.box(S.wall, px[0], y0, pz[0], px[1], S.H, pz[1], { tint: S.tint, uvOff: S.uvOff, top: S.H, skip: 63 & ~(e === 'W' ? 2 : 1) });
    }
    for (const [d, ends] of [['N', ['W', 'E']], ['S', ['W', 'E']], ['W', ['N', 'S']], ['E', ['N', 'S']]]) {
      if (!facade(d)) continue;
      for (const e of ends) {
        if (facade(e)) continue;
        const px = d === 'W' ? [x0, x0 + FAC] : d === 'E' ? [x1 - FAC, x1] : e === 'W' ? [x0, x0 + FAC] : [x1 - FAC, x1];
        const pz = d === 'N' ? [z0, z0 + FAC] : d === 'S' ? [z1 - FAC, z1] : e === 'N' ? [z0, z0 + FAC] : [z1 - FAC, z1];
        const keep = { E: 1, W: 2, S: 16, N: 32 }[e];
        geo.box(S.wall, px[0], y0, pz[0], px[1], S.H, pz[1], { tint: S.tint, uvOff: S.uvOff, top: S.H, skip: 63 & ~keep });
      }
    }
    setLod(LOD.FAR);
    geo.box(S.wall, x0, y0, z0, x1, S.H, z1, { tint: S.tint, uvOff: S.uvOff, gao: false, skip: 4 });
    setLod(LOD.BASE);
    if (!opt.noCollide) collide(x0, y0, z0, x1, S.H + (S.eave === 'crenel' ? 1.2 : 0), z1);

    for (const dir of ['N', 'S', 'W', 'E']) {
      if (!facade(dir)) continue;
      const court = !isFac(dir), f = info[dir].f;
      const prevD = { N: 'E', S: 'W', W: 'N', E: 'S' }[dir], nextD = { N: 'W', S: 'E', W: 'S', E: 'N' }[dir];
      const ts = (dir === 'W' || dir === 'E') && facade(prevD) ? FAC : 0;
      const te = (dir === 'W' || dir === 'E') && facade(nextD) ? f.W - FAC : f.W;
      const bands = opt.bands ? opt.bands(f, dir, court) : lotBands(f, S, court);
      facadeWall(f, bands, S, ts, te);
      for (const band of bands) for (const op of band.ops) {
        if (op.kind === 'door') doorFill(f, op, S);
        else if (op.kind === 'shop') shopFill(f, op, S);
        else if (op.kind === 'bif') { windowFill(f, op, { ...S, shutters: false, pots: 0 }); biforaDress(f, op, S); }
        else if (op.kind === 'none') continue;
        else { windowFill(f, op, court ? { ...S, court: true } : S); if (op.kind === 'balc') balcony(f, op, S); }
      }
      // String courses and the ground-floor/upper-floor material change.
      setLod(LOD.BASE);
      const so = { gao: false, tint: S.trimTint, open: 'b' };
      if (S.banded || S.groundMat !== S.upper) for (let s = 1; s < S.storeys; s++) {
        if (!S.banded && s > 1) break;
        const y = storeyY(S, s);
        if (bands[s]?.ops.some((op) => op.kind === 'balc')) continue;
        lbox(f, T.trim, 0, f.W, y - 0.14, y + 0.04, 0, 0.08, { ...so, open: 'blr' });
      }
      // Eaves.
      const H = S.H;
      if (S.eave === 'cornice') {
        lbox(f, T.trim, 0, f.W, H - 0.72, H - 0.58, 0, 0.1, { ...so, ao: 0.95, open: 'blrt' });
        lbox(f, T.trim, 0, f.W, H - 0.58, H - 0.44, 0, 0.21, { ...so, ao: 0.9, open: 'blrt' });
        lbox(f, T.trim, 0, f.W, H - 0.44, H - 0.3, 0, 0.32, { ...so, ao: 0.85, open: 'blr' });
      } else if (S.eave === 'crenel') {
        // Brick corbel table under a crenellated parapet (Guelph merlons).
        for (let t = 0.35; t < f.W - 0.2; t += 0.9) lbox(f, S.upper, t - 0.14, t + 0.14, H - 0.55, H - 0.1, 0, 0.22, { gao: false, tint: S.upperTint, ao: 0.85, open: 'b' });
        lbox(f, S.upper, 0, f.W, H - 0.1, H + 0.35, -0.1, 0.25, { gao: false, tint: S.upperTint, open: 'b' });
        merlons(f, H + 0.35, 0.9, -0.1, 0.25, S.upper, { tint: S.upperTint }, 1.25, 0.7);
        setLod(LOD.FAR); lbox(f, S.upper, 0, f.W, H - 0.1, H + 1.1, -0.1, 0.25, { gao: false, tint: S.upperTint, open: 'b' }); setLod(LOD.BASE);
      } else {
        setLod(LOD.DETAIL);
        for (let t = 0.3; t < f.W - 0.1; t += 0.8) lbox(f, T.wood, t - 0.05, t + 0.05, H - 0.5, H - 0.3, 0, 0.4, { ao: 0.75, gao: false, open: 'bt' });
        setLod(LOD.BASE);
      }
      if (S.bench && !court) { // stone bench along the palazzo base (panca di via)
        let a = -1;
        for (let t = 0.4; t <= f.W - 0.4 + 1e-6; t += 0.5) {
          const free = t < f.W - 0.41 && walkOut(f, t, 0.5) && !bands[0].ops.some((op) => t > op.t0 - 0.45 && t < op.t1 + 0.45);
          if (free && a < 0) a = t;
          else if (!free && a >= 0) {
            if (t - a > 1.5) { lbox(f, T.trim, a, t, 0, 0.45, 0, 0.42, { tint: S.trimTint, open: 'b' }); const xa = fx(f, a, 0), xb = fx(f, t, 0.42), za = fz(f, a, 0), zb = fz(f, t, 0.42); collide(Math.min(xa, xb), 0, Math.min(za, zb), Math.max(xa, xb), 0.45, Math.max(za, zb)); }
            a = -1;
          }
        }
      }
      setLod(LOD.DETAIL);
      if (!court && R() < 0.4) { // drainpipe
        const t = R() < 0.5 ? 0.2 : f.W - 0.2;
        geo.proto(T.iron, TPL.cyl6, fx(f, t, 0.09), 0, fz(f, t, 0.09), 0.05, H - 0.25, 0.05, 0, { gao: false });
      }
      if (S.putlogs) for (let py = S.G + 0.6; py < H - 1; py += 1.6) for (let t = 0.8; t < f.W - 0.5; t += 1.7) if (R() < 0.45) front(f, T.iron, t - 0.09, t + 0.09, py, py + 0.18, 0.005, { gao: false, ao: 0.4 });
      setLod(LOD.BASE);
      if (!court) contact(f, 0, f.W);
    }
    // Roof.
    if (!opt.noRoof) {
      const pitch = S.eave === 'crenel' ? 0.18 : S.pitch;
      // Terraced roofs: the ridge runs along the street front, eaves overhang only over streets and
      // courts, and the ends are hipped where the building is exposed and gabled on party walls.
      const ns = facade('N') || facade('S'), we = facade('W') || facade('E');
      let axis = ns && !we ? 'x' : we && !ns ? 'z' : (x1 - x0 >= z1 - z0 ? 'x' : 'z');
      if (axis === 'x' && z1 - z0 > 1.6 * (x1 - x0)) axis = 'z';        // deep narrow lot: ridge front to back
      else if (axis === 'z' && x1 - x0 > 1.6 * (z1 - z0)) axis = 'x';
      const eov = S.eave === 'crenel' ? 0 : 0.42;
      const sides = { N: facade('N') ? eov : 0, S: facade('S') ? eov : 0, W: facade('W') ? eov : 0, E: facade('E') ? eov : 0 };
      const ends = axis === 'x' ? { A0: facade('W') ? 'hip' : 'gable', A1: facade('E') ? 'hip' : 'gable' } : { A0: facade('N') ? 'hip' : 'gable', A1: facade('S') ? 'hip' : 'gable' };
      const Hr = roof(x0, x1, z0, z1, S.H - (S.eave === 'crenel' ? 0.3 : 0), { pitch, wall: S.wall, tint: S.tint, uvOff: S.uvOff, roofTint: S.roofTint }, eov, { axis, sides, ends, ...(opt.roof || {}) });
      if (R() < 0.3 && S.eave !== 'crenel') {
        const cx = rr(x0 + 1, x1 - 1), cz = rr(z0 + 1, z1 - 1);
        chimney(cx, cz, S.H - 0.5, Hr + 0.4 + R() * 0.6, S);
      }
    }
    if (S.eave === 'crenel') {
      // Parapets on the blind sides as well so the crenellation reads all round.
      for (const dir of ['N', 'S', 'W', 'E']) if (!facade(dir)) {
        const f = info[dir].f;
        lbox(f, S.upper, 0, f.W, S.H - 0.1, S.H + 1.25, -0.25, 0, { gao: false, tint: S.upperTint, open: 'bu' });
      }
    }
    geo.unlock();
    setLod(prev);
  }

  function buildLot(l) {
    const r = [l.x0, l.x1, l.z0, l.z1];
    const info = faceInfo(r);
    const S = makeStyle(l, info, l.force);
    building(r, S, info, l.opt || {});
    return S;
  }

  // ---------------------------------------------------------------- tower houses
  const towerTops = [];
  function buildTower(t) {
    const [x0, x1, z0, z1] = t.r, H = t.h;
    const mat = t.dark ? T.stoneDark : T.stone;
    const k = rr(0.92, 1.05), tint = [k * rr(0.99, 1.03), k, k * rr(0.95, 1)];
    const S = {
      type: 'tower', wall: mat, tint, uvOff: [R() * 3, R() * 3], H, framed: true, shutters: false, pots: 0,
      wallFor: () => mat, tintFor: () => tint, trimTint: mulTint([1, 0.97, 0.92], rr(0.85, 1)), canPot: () => false, noPots: true, archShape: 'round', fanlight: false, lantern: false,
    };
    const info = faceInfo(t.r);
    geo.lock((x0 + x1) / 2, (z0 + z1) / 2);
    let prev = setLod(LOD.BASE);
    geo.box(mat, x0 + FAC, 0, z0 + FAC, x1 - FAC, H, z1 - FAC, { tint, uvOff: S.uvOff, skip: 1 | 2 | 16 | 32 | 4 });
    // Corner posts: the W/E slabs stop FAC short of each corner (ts/te below); close those squares.
    for (const [cx, keep] of [[x0, 2], [x1 - FAC, 1]]) for (const cz of [z0, z1 - FAC]) {
      geo.box(mat, cx, 0, cz, cx + FAC, H, cz + FAC, { tint, uvOff: S.uvOff, skip: 63 & ~keep });
    }
    setLod(LOD.FAR);
    geo.box(mat, x0, 0, z0, x1, H + (t.top === 'parapet' ? 1.0 : 0), z1, { tint, gao: false });
    setLod(LOD.BASE);
    collide(x0, 0, z0, x1, H, z1);
    const doorDir = t.door || ['S', 'N', 'E', 'W'].find((d) => info[d].walk >= 3);
    for (const dir of ['N', 'S', 'W', 'E']) {
      const f = info[dir].f, street = info[dir].walk >= 3;
      const bands = [];
      const tc = f.W / 2;
      bands.push({ y0: 0, y1: 5.2, ops: dir === doorDir ? [{ kind: 'door', t0: tc - 0.7, t1: tc + 0.7, y0: 0, y1: 2.5, shape: 'round', ring: 0.3 }] : [] });
      let y = 5.2, n = 0;
      while (y + 5.6 < H - 3) {
        const ops = [];
        if (y > 8 && (street || y > 14) && R() < 0.65) {
          const c = f.W * (n % 2 ? 0.34 : 0.66), w = rr(0.7, 0.85);
          ops.push({ kind: 'win', t0: c - w / 2, t1: c + w / 2, y0: y + 1.7, y1: y + 3.1, shape: R() < 0.3 ? 'pointed' : 'round' });
        } else if (y > 8 && R() < 0.35) {
          ops.push({ kind: 'slit', t0: tc - 0.14, t1: tc + 0.14, y0: y + 1.6, y1: y + 3.2, shape: 'rect' });
        }
        bands.push({ y0: y, y1: y + 5.6, ops });
        y += 5.6; n++;
      }
      bands.push({ y0: y, y1: H, ops: [] });
      const ts = dir === 'W' || dir === 'E' ? FAC : 0, te = dir === 'W' || dir === 'E' ? f.W - FAC : f.W;
      facadeWall(f, bands, S, ts, te);
      for (const b of bands) for (const op of b.ops) {
        if (op.kind === 'door') doorFill(f, op, S);
        else if (op.kind === 'slit') { setLod(LOD.BASE); front(f, T.glass, op.t0, op.t1, op.y0, op.y1, -FAC + 0.05, { gao: false, tint: 0.5 }); }
        else {
          setLod(LOD.BASE);
          kit.glassPane(f, op, -FAC + 0.05);
          archRing(f, T.trim, op.curve, 0.18, -0.02, 0.04, { tint: S.trimTint });
          lbox(f, T.trim, op.t0 - 0.08, op.t1 + 0.08, op.y0 - 0.08, op.y0, -FAC, 0.06, { gao: false, tint: S.trimTint, open: 'b' });
          setLod(LOD.FAR); front(f, T.glass, op.t0, op.t1, op.y0, kit.opTop(op), 0.02, { gao: false, tint: 0.7 });
        }
      }
      setLod(LOD.DETAIL);
      // Putlog holes (buche pontaie) in rows, a signature of the towers.
      for (let py = 6.2; py < H - 3; py += 2.8) for (let tt = 0.9; tt < f.W - 0.6; tt += 1.6) if (R() < 0.5) front(f, T.iron, tt - 0.09, tt + 0.09, py, py + 0.18, 0.005, { gao: false, ao: 0.35 });
      setLod(LOD.BASE);
      if (street) contact(f, 0, f.W);
    }
    towerTop(t, S, mat, tint);
    geo.unlock();
    setLod(prev);
  }

  function towerTop(t, S, mat, tint) {
    const [x0, x1, z0, z1] = t.r, H = t.h, trim = T.trim;
    const o = { tint, gao: false };
    // Flat terrace (walkable for viewpoints).
    geo.box(mat, x0 + 0.3, H - 0.2, z0 + 0.3, x1 - 0.3, H, z1 - 0.3, { ...o, skip: 8 | 1 | 2 | 16 | 32 });
    // Lid over the gap between the façade slabs and the core (open from above otherwise).
    for (const [a, b, c, d] of [[x0, x1, z0, z0 + FAC], [x0, x1, z1 - FAC, z1], [x0, x0 + FAC, z0 + FAC, z1 - FAC], [x1 - FAC, x1, z0 + FAC, z1 - FAC]]) {
      geo.box(mat, a, H - 0.05, c, b, H, d, { ...o, skip: 63 & ~4 });
    }
    if (t.top === 'parapet' || t.top === 'flat') {
      const big = t.top === 'parapet';
      if (big) {
        geo.box(trim, x0 - 0.15, H - 0.6, z0 - 0.15, x1 + 0.15, H - 0.35, z1 + 0.15, { gao: false, tint: S.trimTint });
        for (let x = x0 + 0.4; x < x1 - 0.2; x += 1.1) {
          geo.box(trim, x - 0.15, H - 0.95, z0 - 0.15, x + 0.15, H - 0.6, z0 + 0.05, { gao: false, ao: 0.85, skip: 16 });
          geo.box(trim, x - 0.15, H - 0.95, z1 - 0.05, x + 0.15, H - 0.6, z1 + 0.15, { gao: false, ao: 0.85, skip: 32 });
        }
        for (let z = z0 + 0.4; z < z1 - 0.2; z += 1.1) {
          geo.box(trim, x0 - 0.15, H - 0.95, z - 0.15, x0 + 0.05, H - 0.6, z + 0.15, { gao: false, ao: 0.85, skip: 1 });
          geo.box(trim, x1 - 0.05, H - 0.95, z - 0.15, x1 + 0.15, H - 0.6, z + 0.15, { gao: false, ao: 0.85, skip: 2 });
        }
      }
      const e = big ? 0.2 : 0, ph = big ? 1.05 : 0.9;
      geo.box(mat, x0 - e, H - 0.35, z0 - e, x1 + e, H + ph, z0 + 0.3, o);
      geo.box(mat, x0 - e, H - 0.35, z1 - 0.3, x1 + e, H + ph, z1 + e, o);
      geo.box(mat, x0 - e, H - 0.35, z0 + 0.3, x0 + 0.3, H + ph, z1 - 0.3, o);
      geo.box(mat, x1 - 0.3, H - 0.35, z0 + 0.3, x1 + e, H + ph, z1 - 0.3, o);
      // Coping stones along the parapet walls (not a lid: the terrace stays open to the sky).
      const co = { gao: false, tint: S.trimTint }, cy0 = H + ph, cy1 = H + ph + 0.08, g = 0.04;
      geo.box(trim, x0 - e - g, cy0, z0 - e - g, x1 + e + g, cy1, z0 + 0.34, co);
      geo.box(trim, x0 - e - g, cy0, z1 - 0.34, x1 + e + g, cy1, z1 + e + g, co);
      geo.box(trim, x0 - e - g, cy0, z0 + 0.34, x0 + 0.34, cy1, z1 - 0.34, co);
      geo.box(trim, x1 - 0.34, cy0, z0 + 0.34, x1 + e + g, cy1, z1 - 0.34, co);
      towerTops.push({ t, top: H, rim: H + ph });
    } else if (t.top === 'roof' || t.top === 'belfry') {
      // Open loggia / belfry at the top under a low pyramid roof.
      const p = 1.0, hb = t.top === 'belfry' ? 3.6 : 2.6;
      for (const [px, pz] of [[x0, z0], [x1 - p, z0], [x0, z1 - p], [x1 - p, z1 - p]]) geo.box(mat, px, H, pz, px + p, H + hb, pz + p, o);
      for (const dir of ['N', 'S', 'W', 'E']) {
        const f = makeFace(t.r, dir);
        const c = archCurve(p, f.W - p, H + hb - (f.W - 2 * p) / 2 - 0.2, 'round');
        kit.spandrel(f, mat, c, H + hb, 0, o); kit.spandrel(f, mat, c, H + hb, -0.5, o, -1);
        kit.intrados(f, mat, c, -0.5, 0, { ...o, ao: 0.8 });
        lbox(f, trim, p, f.W - p, H - 0.02, H + 0.9, 0, 0.12, { gao: false, tint: S.trimTint, open: 'b' });
      }
      geo.box(trim, x0 - 0.2, H + hb, z0 - 0.2, x1 + 0.2, H + hb + 0.3, z1 + 0.2, { gao: false, tint: S.trimTint });
      pyramid(x0, x1, z0, z1, H + hb + 0.3, t.top === 'belfry' ? 3.2 : 2.0, 0.45);
      if (t.top === 'belfry') {
        const bell = TPL.cone8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        geo.proto(T.metal, bell, cx, H + hb - 1.6, cz, 0.55, 1.0, 0.55, 0, { gao: false, tint: [0.75, 0.6, 0.4] });
      }
      setLod(LOD.FAR); pyramid(x0, x1, z0, z1, H + hb + 0.3, t.top === 'belfry' ? 3.2 : 2.0, 0.45); geo.box(mat, x0, H, z0, x1, H + hb + 0.3, z1, { tint, gao: false }); setLod(LOD.BASE);
    } else { // ruin: broken, uneven parapet
      for (const dir of ['N', 'S', 'W', 'E']) {
        const f = makeFace(t.r, dir);
        for (let tt = 0; tt < f.W - 0.01; tt += 0.7) {
          const h = Math.max(0, rr(-0.6, 1.8));
          if (h > 0.1) lbox(f, mat, tt, Math.min(f.W, tt + 0.7), H, H + h, -0.45, 0, { ...o, open: 'u' });
        }
      }
      if (R() < 0.7) { geo.proto(T.plant, TPL.blob0, x0 + 1.2, H + 0.4, z1 - 1.3, 0.8, 0.5, 0.7, 1, { gao: false }); }
    }
  }

  return { buildLot, building, makeStyle, faceInfo, buildTower, towerTops, contact, lotBands, plasterTints, shutterTints };
}
