// Genera gli STL (orientamento di stampa, parametri predefiniti) in /stl e
// l'archivio zip con tutti i pezzi. Uso: npm run build:stl
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { zipSync } from 'fflate';
import { loadManifold, buildModel } from '../js/geometry.js';
import { DEFAULT_PARAMS } from '../js/params.js';
import { toBinarySTL } from '../js/stl.js';

const outDir = new URL('../stl/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(new URL(f, outDir));

const model = buildModel(await loadManifold(), DEFAULT_PARAMS);
const d = model.dims;
const files = {};
for (const part of model.parts) {
  const data = toBinarySTL(part.print, part.id);
  files[part.file] = data;
  writeFileSync(new URL(part.file, outDir), data);
  const [x, y, z] = part.stats.size.map((v) => v.toFixed(1));
  console.log(`${part.file.padEnd(22)} ×${String(part.qty).padEnd(3)} ${x} × ${y} × ${z} mm  ${(part.stats.volume / 1000).toFixed(2)} cm³  ${part.stats.triangles} tri`);
}
const readme = `Ordina-colori - file di stampa (Bambu Lab P1S, PLA, ugello 0,4, strato 0,2)

scatola.stl          x1  aperta a 180°, print in place. PAUSA a Z = ${d.pauseZ.toFixed(1)} mm: 4 magneti ${6}x${3} mm.
anelli_x10.stl       x4  un piatto per colore (rosa, verde, giallo, blu). In piedi.
anello.stl           -   anello singolo, se preferisci disporli da te.
aste_x6.stl          x1  6 aste distese su una faccia.
asta.stl             -   asta singola.
piatto_di_prova.stl  x1  da stampare prima: anelli, spezzone d'asta, 2 sedi, binario, nocca.

Nessun supporto. Compensazione piede d'elefante attiva (0,1-0,15 mm).
Scatola chiusa ${d.width.toFixed(1)} x ${d.length.toFixed(1)} x ${d.H.toFixed(1)} mm.
Magneti: attaccali a coppie e segna la faccia libera; nella base segno verso l'esterno, nel coperchio segno verso l'interno.
`;
files['LEGGIMI.txt'] = new TextEncoder().encode(readme);
files['parametri.json'] = new TextEncoder().encode(JSON.stringify({ parametri: DEFAULT_PARAMS, pausaMagnetiZ: d.pauseZ }, null, 2));
writeFileSync(new URL('ordina-colori-stl.zip', outDir), zipSync(files, { level: 9, mtime: new Date('2026-01-01') }));
console.log('stl/ordina-colori-stl.zip');
