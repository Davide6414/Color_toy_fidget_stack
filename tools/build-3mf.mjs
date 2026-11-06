// Progetto Bambu Studio con tutti i piatti pronti: scatola, aste e un piatto di anelli per colore.
// Uso: npm run build:3mf  (serve Bambu Studio installato; percorso in BAMBU_STUDIO se non è quello predefinito)
//
// 1. fa generare a Bambu Studio (riga di comando) le impostazioni di progetto con i profili di sistema
//    P1S 0.4, 0.20mm Standard e Bambu PLA Basic (catene "inherits" risolte qui: la CLI non lo fa),
//    poi le ritocca: colori, niente brim, piatto PEI ruvido;
// 2. scrive un 3MF nel formato di Bambu Studio con un oggetto per piatto e quelle impostazioni;
// 3. lo fa riaprire e salvare a Bambu Studio, che aggiunge le anteprime, e controlla piatti e filamenti.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { loadManifold, buildModel } from '../js/geometry.js';
import { DEFAULT_PARAMS, COLORS, BOX_COLOR } from '../js/params.js';
import { toBinarySTL } from '../js/stl.js';

const STUDIO = process.env.BAMBU_STUDIO || 'C:/Program Files/Bambu Studio/bambu-studio.exe';
const PROFILES = join(STUDIO, '../resources/profiles/BBL');
const PRESETS = {
  machine: 'Bambu Lab P1S 0.4 nozzle',
  process: '0.20mm Standard @BBL X1C',
  filament: 'Bambu PLA Basic @BBL P1S 0.4 nozzle',
};
const BED = 256;
const STRIDE = BED * 1.2;                   // passo tra i piatti nella vista di Bambu Studio
const OVERRIDES = { brim_type: 'no_brim', curr_bed_type: 'Textured PEI Plate' };

// Filamento 1 per scatola e aste, poi un filamento per colore di anelli.
const FILAMENT_COLORS = [BOX_COLOR, ...COLORS.map((c) => c.hex)].map((h) => h.toUpperCase());
const PLATES = [
  { name: 'Scatola (print in place)', part: 'scatola', object: 'scatola', filament: 1 },
  { name: 'Aste x6', part: 'aste', object: 'aste_x6', filament: 1 },
  ...COLORS.map((c, k) => ({ name: `Anelli ${c.name.toLowerCase()} x10`, part: 'anelli', object: `anelli_${c.id}`, filament: k + 2 })),
];

if (!existsSync(STUDIO)) {
  console.error(`Bambu Studio non trovato in ${STUDIO}: imposta BAMBU_STUDIO.`);
  process.exit(1);
}

const model = buildModel(await loadManifold(), DEFAULT_PARAMS);
const parts = Object.fromEntries(model.parts.map((p) => [p.id, p]));

const num = (v) => String(Math.round(v * 1e5) / 1e5);
const uuid = (kind, i) => `${kind}${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Mesh centrata sull'origine (come la salva Bambu Studio), più la mezza altezza per l'item.
function meshXml({ positions, indices }) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const v = [];
  for (let i = 0; i < positions.length; i += 3) {
    v.push(`     <vertex x="${num(positions[i] - c[0])}" y="${num(positions[i + 1] - c[1])}" z="${num(positions[i + 2] - c[2])}"/>`);
  }
  const t = [];
  for (let i = 0; i < indices.length; i += 3) t.push(`     <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
  return { xml: `    <vertices>\n${v.join('\n')}\n    </vertices>\n    <triangles>\n${t.join('\n')}\n    </triangles>`,
    halfZ: (hi[2] - lo[2]) / 2, size: hi.map((h, k) => h - lo[k]), tris: indices.length / 3 };
}

const cols = (() => { const v = Math.sqrt(PLATES.length); const r = Math.round(v); return v > r ? r + 1 : r; })();
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
const files = {};
const objects = [];
const items = [];
const rels = [];
const config = [];
const plates = [];
PLATES.forEach((pl, i) => {
  const meshId = 2 * i + 1;
  const objId = 2 * i + 2;
  const m = meshXml(parts[pl.part].print);
  for (const s of m.size.slice(0, 2)) if (s > BED - 10) throw new Error(`${pl.object} non sta nel piatto`);
  const path = `/3D/Objects/${pl.object}_${meshId}.model`;
  files[path.slice(1)] = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="${meshId}" p:UUID="${uuid('0001', meshId)}" type="model">
   <mesh>
${m.xml}
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`;
  rels.push(` <Relationship Target="${path}" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`);
  objects.push(`  <object id="${objId}" p:UUID="${uuid('0000', objId)}" type="model">
   <components>
    <component p:path="${path}" objectid="${meshId}" p:UUID="${uuid('0002', meshId)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`);
  const x = (i % cols) * STRIDE + BED / 2;
  const y = -Math.floor(i / cols) * STRIDE + BED / 2;
  items.push(`  <item objectid="${objId}" p:UUID="${uuid('0003', objId)}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} ${num(m.halfZ)}" printable="1"/>`);
  config.push(`  <object id="${objId}">
    <metadata key="name" value="${esc(pl.object)}"/>
    <metadata key="extruder" value="${pl.filament}"/>
    <part id="${meshId}" subtype="normal_part">
      <metadata key="name" value="${esc(pl.object)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <mesh_stat face_count="${m.tris}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>`);
  plates.push(`  <plate>
    <metadata key="plater_id" value="${i + 1}"/>
    <metadata key="plater_name" value="${esc(pl.name)}"/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${100 + i}"/>
    </model_instance>
  </plate>`);
  console.log(`piatto ${i + 1}  ${pl.name.padEnd(26)} filamento ${pl.filament}  ${m.size.map((s) => s.toFixed(1)).join(' × ')} mm`);
});

files['3D/3dmodel.model'] = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-02.06.00.51</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Ordina-colori</metadata>
 <resources>
${objects.join('\n')}
 </resources>
 <build p:UUID="${uuid('0004', 1)}">
${items.join('\n')}
 </build>
</model>
`;
files['3D/_rels/3dmodel.model.rels'] = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.join('\n')}
</Relationships>
`;
files['Metadata/model_settings.config'] = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${config.join('\n')}
${plates.join('\n')}
  <assemble>
  </assemble>
</config>
`;
files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`;
files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

// Profili di sistema con la catena "inherits" risolta.
const index = {};
for (const kind of ['machine', 'process', 'filament']) {
  for (const f of readdirSync(join(PROFILES, kind))) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(join(PROFILES, kind, f), 'utf8'));
      if (j.name) index[`${kind}/${j.name}`] = j;
    } catch { /* file di supporto non JSON */ }
  }
}
const flatten = (kind, name) => {
  const { inherits, ...own } = index[`${kind}/${name}`] ?? {};
  if (!own.name) throw new Error(`profilo ${kind} "${name}" non trovato`);
  return { ...(inherits ? flatten(kind, inherits) : {}), ...own };
};

const work = mkdtempSync(join(tmpdir(), 'ordina-3mf-'));
const studio = (...args) => {
  execFileSync(STUDIO, ['--debug', '1', '--outputdir', work, ...args], { stdio: 'pipe' });
  const result = JSON.parse(readFileSync(join(work, 'result.json'), 'utf8'));
  if (result.return_code !== 0) throw new Error(`Bambu Studio: ${result.error_string}`);
};
try {
  // La CLI non apre un 3MF di Bambu senza impostazioni di progetto: le fa prima su un'asta sola.
  const profile = {};
  for (const [kind, name] of Object.entries(PRESETS)) {
    profile[kind] = join(work, `${kind}.json`);
    const { instantiation, ...p } = flatten(kind, name);
    writeFileSync(profile[kind], JSON.stringify({ ...p, name, from: 'system' }));
  }
  writeFileSync(join(work, 'asta.stl'), toBinarySTL(parts.asta.print, 'asta'));
  studio('--load-settings', `${profile.machine};${profile.process}`,
    '--load-filaments', FILAMENT_COLORS.map(() => profile.filament).join(';'),
    '--export-3mf', 'impostazioni.3mf', join(work, 'asta.stl'));
  const settings = JSON.parse(strFromU8(unzipSync(readFileSync(join(work, 'impostazioni.3mf')))['Metadata/project_settings.config']));
  const n = FILAMENT_COLORS.length;
  if (settings.filament_settings_id?.length !== n) throw new Error('numero di filamenti inatteso nel progetto');
  if (settings.printable_area?.[2] !== `${BED}x${BED}`) throw new Error(`piatto inatteso: ${settings.printable_area}`);
  // La CLI lascia la matrice degli spurghi a 4 × 4: con 5 filamenti il taglio si ferma.
  const flush = settings.flush_volumes_matrix.find((v) => v !== '0') ?? '280';
  Object.assign(settings, OVERRIDES, {
    filament_colour: FILAMENT_COLORS,
    flush_volumes_matrix: Array.from({ length: n * n }, (_, k) => (k % (n + 1) === 0 ? '0' : flush)),
    flush_volumes_vector: Array(2 * n).fill(settings.flush_volumes_vector[0] ?? '140'),
  });
  files['Metadata/project_settings.config'] = JSON.stringify(settings, null, 4);

  // Bambu Studio riapre i piatti e li salva nel suo formato, con le anteprime.
  writeFileSync(join(work, 'piatti.3mf'), zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  studio('--export-3mf', 'progetto.3mf', join(work, 'piatti.3mf'));
  const zip = unzipSync(readFileSync(join(work, 'progetto.3mf')));
  const saved = JSON.parse(strFromU8(zip['Metadata/project_settings.config']));
  for (const [k, v] of Object.entries({ ...OVERRIDES, filament_colour: FILAMENT_COLORS })) {
    if (JSON.stringify(saved[k]) !== JSON.stringify(v)) throw new Error(`impostazione ${k} persa: ${saved[k]}`);
  }
  const ms = strFromU8(zip['Metadata/model_settings.config']);
  const names = [...ms.matchAll(/key="plater_name" value="([^"]*)"/g)].map((r) => r[1]);
  if (names.join('|') !== PLATES.map((p) => esc(p.name)).join('|')) throw new Error(`piatti esportati: ${names.join(', ')}`);
  for (const pl of PLATES) {
    const ext = ms.match(new RegExp(`key="name" value="${pl.object}"/>\\s*<metadata key="extruder" value="(\\d+)"`))?.[1];
    if (Number(ext) !== pl.filament) throw new Error(`${pl.object}: filamento ${ext} invece di ${pl.filament}`);
  }
  const out = new URL('../stl/ordina-colori-bambu.3mf', import.meta.url);
  writeFileSync(out, zipSync(zip, { level: 6, mtime: new Date('2026-01-01') }));
  console.log(`stl/ordina-colori-bambu.3mf  ${PLATES.length} piatti, ${PRESETS.machine}, ${PRESETS.process}, ${n} × ${PRESETS.filament}`);
  rmSync(work, { recursive: true, force: true });
} catch (e) {
  console.error(`File intermedi lasciati in ${work}`);
  throw e;
}
