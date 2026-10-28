// Verifiche di progetto del gioco ordina-colori. Uso: npm test
// Controlla solidi chiusi, quote delle specifiche, esclusione delle posizioni
// sbagliate degli anelli, assieme senza compenetrazioni, rotazione del
// coperchio 0→180° con aste e anelli, scatto delle linguette, magneti del
// fermo a 90° e piatti di stampa.
import { loadManifold, buildSolids, buildPrintLayouts, openLid, rodInChannel, ringInChannel } from '../js/geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS, MAGNET } from '../js/params.js';

const wasm = await loadManifold();
const BED = 256;
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f2 = (v) => v.toFixed(2);

function shells(m) {
  const parts = m.decompose();
  const pos = parts.filter((x) => x.volume() > 0).length;
  const neg = parts.length - pos;
  for (const x of parts) x.delete();
  return { pos, neg };
}

function run(label, params, { full }) {
  console.log(`\n▶ ${label}`);
  const s = buildSolids(wasm, params);
  const { d, T } = s;
  const vol = (a, b) => T(a.intersect(b)).volume();
  try {
    // ----------------------------------------------------------- solidi
    for (const [name, m, cavities] of [['base', s.base, 2], ['coperchio', s.lid, 2], ['asta', s.rod, 0], ['anello', s.ring, 0]]) {
      const sh = shells(m);
      ok(m.status() === 'NoError' && sh.pos === 1 && sh.neg === cavities,
        `${name}: solido chiuso, 1 corpo${cavities ? ` + ${cavities} sedi magnete` : ''} (${(m.volume() / 1000).toFixed(1)} cm³)`);
    }

    // ----------------------------------------------------------- quote
    if (label.startsWith('Parametri')) {
      ok(near(d.hole, 5.2, 0.05), `foro anello Ø ${f2(d.hole)} (spec 5,2)`);
      ok(near(d.ringWall, 1.4, 0.05), `parete anello ${f2(d.ringWall)} (spec 1,4)`);
      ok(near(d.chW, 8.6, 1e-9) && near(d.chDepth, 6, 1e-9), `binario largo ${f2(d.chW)}, profondo ${f2(d.chDepth)} (spec 8,6 × 6)`);
      ok(near(d.pitch, 10.2, 1e-9) && near(d.chLen, 102, 1e-9), `passo ${f2(d.pitch)}, lunghezza binario ${f2(d.chLen)} (spec 10,2 / 102)`);
      ok(near(d.headroom, 9, 1e-9), `spazio sopra le costole ${f2(d.headroom)} (spec 9)`);
      ok(near(d.rodLen, 117, 1e-9), `asta lunga ${f2(d.rodLen)} (spec 117)`);
      ok(near(d.notchW, 4.9, 0.05) && near(d.seatAC, 4.9, 0.05), `tacche e sedi ${f2(d.seatAC)} tra gli spigoli (spec 4,9)`);
      ok(near(d.H, 20, 1e-9), `altezza scatola chiusa ${f2(d.H)} (spec 20)`);
      ok(d.openLength + 10 < BED, `scatola aperta ${d.openLength.toFixed(1)} mm (piatto ${BED})`);
    }

    // ----------------------------------------------------------- esclusione
    const D = params.ringD;
    const L = params.ringL;
    ok(L > d.chW, `anello di traverso escluso: ${L} > ${f2(d.chW)}`);
    ok(L > d.headroom, `anello in piedi sulle costole escluso: ${L} > ${f2(d.headroom)}`);
    ok(d.protrusion + D > d.headroom, `anello sopra un binario pieno escluso: ${d.protrusion + D} > ${f2(d.headroom)}`);
    ok(d.headroom > d.protrusion, `sopra un binario pieno resta spazio per passare (${f2(d.headroom - d.protrusion)} mm)`);
    ok(d.notchW < D, `nessun anello esce dalle tacche: ${f2(d.notchW)} < ${D}`);
    ok(d.seatAC < d.hole, `in verticale l'anello più basso appoggia sulla barra: sede ${f2(d.seatAC)} < foro ${f2(d.hole)}`);
    ok(d.hole > d.rodAC, `l'anello scorre sull'asta: foro ${f2(d.hole)} > spigoli ${f2(d.rodAC)}`);

    // ----------------------------------------------------------- assieme chiuso
    ok(vol(s.base, s.lid) < 1e-3, 'scatola chiusa: base e coperchio non si compenetrano');
    const rods = s.union(d.chX.map((_, i) => rodInChannel(s, i)));
    ok(vol(rods, s.base) < 1e-3, 'aste inserite: nessun contatto con base (tacche e binari)');
    ok(vol(rods, s.lid) < 1e-3, 'aste inserite: nessun contatto col coperchio (sedi e bordo delle tacche)');
    ok(near(-params.rodTail + d.rodLen, d.ySeatBottom, 1e-6), `la punta arriva in fondo alla sede (${f2(d.ySeatBottom)})`);
    const cap = params.capacity;
    for (const [what, at] of [['contro la barra', (k) => k * L], ['contro la parete frontale', (k) => d.chLen - (k + 1) * L]]) {
      const rings = s.union(d.chX.flatMap((_, i) => Array.from({ length: cap }, (_, k) => ringInChannel(s, i, at(k)))));
      ok(vol(rings, s.base) < 0.01 && vol(rings, s.lid) < 1e-3 && vol(rings, rods) < 1e-3,
        `${cap} anelli per binario ${what}: nessuna compenetrazione con base, coperchio e aste`);
    }

    // ----------------------------------------------------------- rotazione
    const steps = full ? [1, 2, 3, 5, 8, 12, 15, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180] : [5, 15, 45, 90, 135, 180];
    const sweep = steps.map((th) => [th, vol(s.base, openLid(s, s.lid, th))]);
    const bad = sweep.filter(([th, v]) => th >= 15 && v > 1e-3);
    ok(bad.length === 0, `coperchio da 15° a 180°: nessun urto con la base${bad.length ? ` (urti a ${bad.map(([t]) => t).join(', ')}°)` : ''}`);
    if (full) {
      const latch = sweep.filter(([th, v]) => th < 15 && v > 1e-3);
      ok(latch.length > 0 && latch.every(([th]) => th <= 8),
        `linguette: interferenza solo nei primi gradi di apertura (${latch.map(([t, v]) => `${t}°: ${v.toFixed(1)} mm³`).join(', ')})`);
      ok(d.tongueStrain < 0.01, `deformazione della linguetta ${(d.tongueStrain * 100).toFixed(2)}% (< 1%)`);
    }
    const ringsAtBar = s.union(d.chX.flatMap((_, i) => Array.from({ length: i < 4 ? 7 : 6 }, (_, k) => ringInChannel(s, i, k * L))));
    const ringsSpread = s.union(d.chX.flatMap((_, i) => Array.from({ length: i < 4 ? 7 : 6 }, (_, k) => ringInChannel(s, i, k * (L + 4)))));
    const loadA = s.union([rods, ringsAtBar]);
    const loadB = s.union([rods, ringsSpread]);
    const sweep90 = (full ? [2, 5, 10, 20, 30, 45, 60, 75, 90] : [10, 45, 90]).map((th) => {
      const lidT = openLid(s, s.lid, th);
      const a = openLid(s, loadA, th);
      const b = openLid(s, loadB, th);
      return [th, vol(a, s.base) + vol(b, s.base), vol(a, lidT) + vol(b, lidT)];
    });
    const bad90 = sweep90.filter(([, vb]) => vb > 0.01);
    ok(bad90.length === 0, `apertura 0→90° con aste e anelli infilati: nessun urto con la base${bad90.length ? ` (${bad90.map(([t, v]) => `${t}°: ${v.toFixed(2)}`).join(', ')})` : ''}`);

    // anelli scivolati sulla barra a 90°
    const stack = s.union(d.chX.flatMap((_, i) => Array.from({ length: cap }, (_, k) => ringInChannel(s, i, k * L))));
    const stack90 = openLid(s, stack, 90);
    const lid90 = openLid(s, s.lid, 90);
    ok(vol(stack90, s.base) < 1e-3 && vol(stack90, lid90) < 0.01, `a 90°: ${cap} anelli per asta impilati sulla barra senza urti`);
    const free = d.rodLen - d.seatDepth - cap * L;
    ok(free > 0, `a 90°: sopra ${cap} anelli restano ${f2(free)} mm di asta libera`);
    // a 90° la faccia interna del coperchio è (zLid - zHinge) dietro l'asse,
    // le aste (zHinge - zAxis) davanti
    const ringSurf = (d.zLid - d.zHinge) + (d.zHinge - d.zAxis) - D / 2;
    ok(ringSurf > 4, `a 90°: anelli a ${f2(ringSurf)} mm dal coperchio (spec ~6)`);

    // ----------------------------------------------------------- magneti
    const rot = (y, z, th) => {
      const a = (-th * Math.PI) / 180;
      const dy = y - d.yHinge;
      const dz = z - d.zHinge;
      return [d.yHinge + dy * Math.cos(a) - dz * Math.sin(a), d.zHinge + dy * Math.sin(a) + dz * Math.cos(a)];
    };
    const distAt = (th) => Math.hypot(...rot(d.magLid.y, d.magLid.z, th).map((v, k) => v - [d.magBase.y, d.magBase.z][k]));
    ok(distAt(90) < 1e-6, 'fermo a 90°: i magneti di coperchio e base si allineano');
    ok(distAt(0) > MAGNET.d + 1 && distAt(180) > MAGNET.d + 1,
      `magneti lontani a coperchio chiuso (${f2(distAt(0))} mm) e in stampa (${f2(distAt(180))} mm)`);
    const gapX = (d.magBaseX - d.slotW / 2) - (d.magLidX + d.slotW / 2);
    ok(gapX < 2, `distanza tra le facce dei magneti ${f2(gapX)} mm (pelli ${MAGNET.skin} + gioco ${params.hingeClearance})`);
    const lidSlotTopPrint = 2 * d.zHinge - (d.magLid.z - d.slotR);
    const baseSlotTop = d.magBase.z + d.slotR;
    ok(near(lidSlotTopPrint, d.pauseZ, 1e-6) && near(baseSlotTop, d.pauseZ, 1e-6),
      `una sola pausa: sedi di base e coperchio aperte a Z = ${f2(d.pauseZ)} mm`);

    // ----------------------------------------------------------- stampa
    const lay = buildPrintLayouts(s);
    ok(vol(s.base, lay.lidPrint) < 1e-3, 'stampa a 180°: base e coperchio separati (print in place)');
    for (const [name, m] of [['scatola', lay.box], ['anelli', lay.rings10], ['aste', lay.rods6], ['piatto di prova', lay.testPlate]]) {
      const b = m.boundingBox();
      const sx = b.max[0] - b.min[0];
      const sy = b.max[1] - b.min[1];
      ok(near(b.min[2], 0, 1e-6) && sx <= BED - 10 && sy <= BED - 10, `${name}: appoggiato sul piatto, ${sx.toFixed(1)} × ${sy.toFixed(1)} mm`);
    }
    ok(near(lay.lidPrint.boundingBox().min[2], 0, 1e-6), 'coperchio in stampa: faccia esterna sul piatto');

    // ----------------------------------------------------------- cerniera
    const gaps = d.knuckles.slice(1).map((k, i) => k.x0 - d.knuckles[i].x1);
    ok(gaps.every((gp) => near(gp, params.hingeClearance, 1e-6)) && near(d.knuckles[0].x0 + d.innerHalf, params.hingeClearance, 1e-6),
      `nocche alternate con gioco assiale ${params.hingeClearance} mm`);
    const knuckleWall = d.kR - (d.coneR + params.hingeClearance * Math.SQRT2);
    ok(knuckleWall >= 1.2, `parete delle nocche attorno al perno ${f2(knuckleWall)} mm (min 1,2)`);
    return d;
  } finally {
    s.dispose();
  }
}

const d0 = run('Parametri predefiniti', DEFAULT_PARAMS, { full: true });
const lo = { ...DEFAULT_PARAMS };
const hi = { ...DEFAULT_PARAMS };
for (const spec of PARAM_SPECS) {
  if (spec.key === 'segments') continue;
  lo[spec.key] = spec.min;
  hi[spec.key] = spec.max;
}
run('Cursori al minimo', { ...lo, segments: 32 }, { full: false });
run('Cursori al massimo', { ...hi, segments: 32 }, { full: false });

console.log(`\nScatola chiusa ${d0.width.toFixed(1)} × ${d0.length.toFixed(1)} × ${d0.H.toFixed(1)} mm (+ ${DEFAULT_PARAMS.rodTail} mm di code), aperta ${d0.openLength.toFixed(1)} mm. Pausa magneti a Z = ${d0.pauseZ.toFixed(2)} mm.`);
console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche superate');
process.exit(failures ? 1 : 0);
