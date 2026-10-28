// Verifiche di progetto: solidi validi, nessuna compenetrazione nell'assieme,
// e i meccanismi fanno davvero presa (dentino e aggancio interferiscono quando
// devono). Uso: npm test
import { loadManifold, buildSolids } from '../js/geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS } from '../js/params.js';
import { makeDetent, fingerDeflection } from '../js/mechanics.js';

const wasm = await loadManifold();
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const EPS = 0.01; // mm³

function checkParams(label, params) {
  console.log(`\n▶ ${label}`);
  const s = buildSolids(wasm, params);
  const { d } = s;
  const pool = [];
  const T = (o) => { pool.push(o); return o; };
  try {
    const named = [
      ['base', s.base],
      ...s.discs.map((x) => [x.spec.id, x.full]),
      ['cap', s.cap],
    ];
    for (const [name, m] of named) {
      ok(m.status() === 'NoError' && m.volume() > 0 && m.decompose().length === 1,
        `${name}: solido valido, un solo corpo, volume ${(m.volume() / 1000).toFixed(2)} cm³`);
    }
    for (const x of s.discs) ok(x.armSolids.length === 2, `${x.spec.id}: 2 bracci elastici separabili`);
    ok(s.fingerSolids.length === 4, 'cappuccio: 4 alette elastiche');

    // Assieme montato
    const placed = [
      ['base', s.base],
      ...s.discs.map((x, i) => [x.spec.id, T(x.full.translate([0, 0, d.discZ[i]]))]),
      ['cap', T(s.cap.translate([0, 0, d.hubTop]))],
    ];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const v = T(placed[i][1].intersect(placed[j][1])).volume();
        ok(v < EPS, `nessuna compenetrazione ${placed[i][0]} ↔ ${placed[j][0]} (${v.toFixed(4)} mm³)`);
      }
    }

    // Il dentino deve interferire col mozzo se il disco è a metà scatto…
    const half = T(T(s.discs[0].full.rotate([0, 0, d.step / 2])).translate([0, 0, d.discZ[0]]));
    const vHalf = T(half.intersect(s.base)).volume();
    ok(vHalf > 0.05, `a metà scatto il dentino preme sul mozzo (${vHalf.toFixed(3)} mm³ da flettere)`);
    // …e la deflessione richiesta deve stare nella fessura del braccio.
    const detent = makeDetent(d);
    const maxDefl = detent(d.step / 2);
    ok(Math.abs(maxDefl - d.nubDepth) < 0.03, `deflessione massima del braccio ${maxDefl.toFixed(2)} mm ≈ profondità dentino`);
    ok(maxDefl < d.slotR1 - d.slotR0, `la fessura (${(d.slotR1 - d.slotR0).toFixed(2)} mm) lascia flettere il braccio`);

    // L'aggancio deve interferire col foro stretto mentre il cappuccio entra.
    const lift = (d.hubTop - d.boreChamfer - d.ledgeZ) / 2;
    const capUp = T(s.cap.translate([0, 0, d.hubTop + lift]));
    const vSnap = T(capUp.intersect(s.base)).volume();
    ok(vSnap > 0.05, `inserendo il cappuccio le alette devono flettere (${vSnap.toFixed(3)} mm³)`);
    ok(Math.abs(fingerDeflection(d, lift) - params.barbInterference) < 1e-6, 'deflessione alette = sottosquadro');
    ok(fingerDeflection(d, 0) === 0, 'montato: alette a riposo');
    ok(params.barbInterference * Math.SQRT2 < d.slotW, 'i tagli lasciano chiudere le alette');
    ok(d.tipZ + d.hubTop > 0.5, 'la punta del perno resta dentro la base');
  } finally {
    for (const o of pool) o.delete();
    s.dispose();
  }
}

checkParams('Parametri predefiniti', DEFAULT_PARAMS);
// Estremi dei cursori: il modello deve restare valido in tutto il range.
const lo = { ...DEFAULT_PARAMS };
const hi = { ...DEFAULT_PARAMS };
for (const p of PARAM_SPECS) {
  if (p.key === 'segments') continue;
  lo[p.key] = p.min;
  hi[p.key] = p.max;
}
checkParams('Cursori al minimo', { ...lo, segments: 64 });
checkParams('Cursori al massimo', { ...hi, segments: 64 });

console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche superate');
process.exit(failures ? 1 : 0);
