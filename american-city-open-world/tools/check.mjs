// Usage: node check.mjs <file.glb|file.gltf> ...
// Validates with Khronos glTF-Validator and prints bounding box (meters), triangle count.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const out = [];
for (const f of process.argv.slice(2)) {
  const data = new Uint8Array(fs.readFileSync(f));
  const rep = await validator.validateBytes(data, {
    uri: path.basename(f),
    externalResourceFunction: (uri) => new Promise((res, rej) => {
      try { res(new Uint8Array(fs.readFileSync(path.join(path.dirname(f), decodeURIComponent(uri))))); } catch (e) { rej(e); }
    }),
  });
  const doc = await io.read(f);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const b = getBounds(scene);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  out.push({ file: path.basename(f), errors: rep.issues.numErrors, warnings: rep.issues.numWarnings,
    size_xyz_m: size, min: b.min.map(v => +v.toFixed(3)), triangles: Math.round(tris),
    materials: root.listMaterials().length, textures: root.listTextures().length });
}
console.log(JSON.stringify(out));
