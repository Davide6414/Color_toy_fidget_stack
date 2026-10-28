// Genera gli STL (orientamento di stampa) con i parametri predefiniti in /stl
// e un archivio zip con tutti i pezzi. Uso: npm run build:stl
import { mkdirSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { loadManifold, buildModel } from '../js/geometry.js';
import { DEFAULT_PARAMS } from '../js/params.js';
import { toBinarySTL } from '../js/stl.js';

const outDir = new URL('../stl/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const model = buildModel(await loadManifold(), DEFAULT_PARAMS);
const files = {};
for (const part of model.parts) {
  const data = toBinarySTL(part.print, part.id);
  files[part.file] = data;
  writeFileSync(new URL(part.file, outDir), data);
  const [x, y, z] = part.stats.size.map((v) => v.toFixed(1));
  console.log(`${part.file.padEnd(24)} ${x}×${y}×${z} mm  ${(part.stats.volume / 1000).toFixed(2)} cm³  ${part.stats.triangles} tri`);
}
writeFileSync(new URL('color-fidget-stack-stl.zip', outDir), zipSync(files, { level: 9, mtime: new Date('2026-01-01') }));
console.log('stl/color-fidget-stack-stl.zip');
