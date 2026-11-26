// ゲーム用素材の取得と軽量化（Poly Haven, CC0）。
// 使い方: american-city-open-world/ をカレントにして  node tools/build-game-assets.mjs
// - テクスチャ: 1k の diff / nor_gl / arm を取得 → MD5 照合 → JPEG 再圧縮して assets/game/tex/ へ
// - HDRI: 1k の .hdr（環境光用）と、トーンマップ済み JPG（背景の空用、4096 幅に縮小）
// - 小物: 1k glTF を取得 → MD5 照合 → 頂点結合・ポリゴン削減・テクスチャ 512px 化 → GLB
// 生データは assets/raw/polyhaven/（git 管理外）。結果は assets/game/manifest.json に記録。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const RAW = 'assets/raw/polyhaven';
const OUT = 'assets/game';
const API = 'https://api.polyhaven.com';

// 道路・歩道・縁石・外壁・屋上
export const TEXTURES = [
  'asphalt_02', 'concrete_pavement', 'brushed_concrete',
  'red_brick_03', 'factory_brick', 'painted_brick', 'beige_wall_001',
  'concrete_wall_008', 'grey_plaster_02', 'concrete_tile_facade', 'bitumen',
];
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';
// [アセット ID, 目標の三角形比率, 許容誤差（モデルの大きさに対する比）]
const PROPS = [
  ['street_lamp_01', 0.03, 0.02], ['fire_hydrant', 0.012, 0.05], ['metal_trash_can', 0.06, 0.03],
  ['utility_box_01', 0.3, 0.01], ['utility_box_02', 0.25, 0.01], ['concrete_road_barrier', 0.015, 0.02],
  ['modular_fire_escape', 0.5, 0.004], ['modular_street_seating', 0.12, 0.02], ['covered_car', 0.25, 0.02],
  ['planter_box_01', 0.1, 0.02], ['water_manhole_cover', 0.08, 0.05],
];

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
async function download(url, out, expectMd5) {
  if (fs.existsSync(out) && (!expectMd5 || md5(fs.readFileSync(out)) === expectMd5)) return fs.readFileSync(out);
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (expectMd5 && md5(buf) !== expectMd5) throw new Error('MD5 mismatch: ' + url);
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); return buf;
}

const manifest = { generated: new Date().toISOString().slice(0, 10), source: 'Poly Haven (https://polyhaven.com), CC0 1.0', textures: {}, hdri: {}, props: {} };

async function info(id) {
  const i = await getJSON(`${API}/info/${id}`);
  return { name: i.name, authors: Object.keys(i.authors || {}), url: `https://polyhaven.com/a/${id}` };
}

async function buildTextures() {
  fs.mkdirSync(`${OUT}/tex`, { recursive: true });
  for (const id of TEXTURES) {
    const f = await getJSON(`${API}/files/${id}`);
    const maps = { diff: f.Diffuse['1k'].jpg, nor: f.nor_gl['1k'].jpg, arm: f.arm['1k'].jpg };
    for (const [k, m] of Object.entries(maps)) {
      const buf = await download(m.url, `${RAW}/tex/${id}_${k}.jpg`, m.md5);
      await sharp(buf).jpeg({ quality: k === 'diff' ? 82 : 86, mozjpeg: true }).toFile(`${OUT}/tex/${id}_${k}.jpg`);
    }
    const meta = await getJSON(`${API}/info/${id}`);
    manifest.textures[id] = { ...(await info(id)), dimensions_mm: meta.dimensions };
    console.log('tex', id);
  }
}

async function buildHdri() {
  fs.rmSync(`${OUT}/sky`, { recursive: true, force: true });
  fs.mkdirSync(`${OUT}/sky`, { recursive: true });
  const f = await getJSON(`${API}/files/${HDRI}`);
  const h = f.hdri['1k'].hdr;
  const hb = await download(h.url, `${RAW}/hdri/${HDRI}_1k.hdr`, h.md5);
  fs.writeFileSync(`${OUT}/sky/${HDRI}_1k.hdr`, hb);
  const t = f.tonemapped;
  const tb = await download(t.url, `${RAW}/hdri/${HDRI}_tonemapped.jpg`, t.md5);
  await sharp(tb).resize(4096, 2048).jpeg({ quality: 84, mozjpeg: true }).toFile(`${OUT}/sky/${HDRI}_4k.jpg`);
  manifest.hdri[HDRI] = await info(HDRI);
  console.log('hdri', HDRI);
}

async function buildProps() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  fs.mkdirSync(`${OUT}/props`, { recursive: true });
  for (const [id, ratio, error = 0.002] of PROPS) {
    const f = await getJSON(`${API}/files/${id}`);
    const g = f.gltf['1k'].gltf;
    const dir = `${RAW}/props/${id}`;
    await download(g.url, `${dir}/${id}.gltf`, g.md5);
    for (const [rel, v] of Object.entries(g.include)) await download(v.url, `${dir}/${rel}`, v.md5);
    const doc = await io.read(`${dir}/${id}.gltf`);
    const count = () => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    const before = count();
    await doc.transform(
      dedup(), weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio, error }),
      resample(), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [512, 512], quality: 84 }),
    );
    // jpeg に変換するとアルファが消えるので、ARM/法線/色すべて jpeg で問題ないものだけを対象にしている
    await io.write(`${OUT}/props/${id}.glb`, doc);
    manifest.props[id] = { ...(await info(id)), triangles_before: Math.round(before), triangles_after: Math.round(count()) };
    console.log('prop', id, Math.round(before), '->', Math.round(count()));
  }
}

const only = process.argv[2];
if (!only || only === 'tex') await buildTextures();
if (!only || only === 'hdri') await buildHdri();
if (!only || only === 'props') await buildProps();
if (only) { const old = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8')); for (const k of ['textures', 'hdri', 'props']) if (!Object.keys(manifest[k]).length) manifest[k] = old[k]; }
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('done');
