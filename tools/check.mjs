// Verifiche di progetto del gioco ordina-colori. Uso: npm test
// Solidi chiusi, quote delle specifiche, esclusione delle posizioni sbagliate
// degli anelli, assieme senza compenetrazioni, rotazione del coperchio 0→180°
// con aste e anelli, anelli che si sfilano a 90°, nervature delle sedi,
// scatto delle linguette, magneti del fermo a 90°, sbalzi e piatti di stampa.
import { loadManifold, buildSolids, buildPrintLayouts, buildMiniPlate, openLid, rodInChannel, ringInChannel } from '../js/geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS, MAGNET, MINI } from '../js/params.js';

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
  const vols = parts.map((x) => x.volume());
  for (const x of parts) x.delete();
  return { pos: vols.filter((v) => v > 0).length, cavities: vols.filter((v) => v < 0).map((v) => -v) };
}

// Area delle facce rivolte verso il piatto (normale z < -0.9) sopra il primo
// strato, escluse quelle alla quota della pausa (tetti delle sedi dei magneti).
function flatDownArea(m, skipZ) {
  const me = m.getMesh();
  const np = me.numProp;
  const vp = me.vertProperties;
  const tv = me.triVerts;
  let area = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const P = [0, 1, 2].map((k) => [vp[tv[t + k] * np], vp[tv[t + k] * np + 1], vp[tv[t + k] * np + 2]]);
    const u = P[1].map((v, i) => v - P[0][i]);
    const w = P[2].map((v, i) => v - P[0][i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    const zc = (P[0][2] + P[1][2] + P[2][2]) / 3;
    if (n[2] / len < -0.9 && zc > 0.05 && !skipZ.some((z) => Math.abs(zc - z) < 0.02)) area += len / 2;
  }
  return area;
}

// Anelli distribuiti il più possibile uniformi sui binari (4 colori × capienza).
function spread(total, n) {
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
}

function run(label, params, { full }) {
  console.log(`\n▶ ${label}`);
  const s = buildSolids(wasm, params);
  const { d, T } = s;
  const vol = (a, b) => T(a.intersect(b)).volume();
  const cap = params.capacity;
  const D = params.ringD;
  const L = params.ringL;
  try {
    // ----------------------------------------------------------- solidi
    const slotVol = (Math.PI * d.slotR ** 2 / 2 + 2 * d.slotR ** 2) * d.slotW;
    for (const [name, m, cav] of [['base', s.base, 2], ['coperchio', s.lid, 2], ['asta', s.rod, 0], ['anello', s.ring, 0]]) {
      const sh = shells(m);
      const cavOk = sh.cavities.length === cav && sh.cavities.every((v) => near(v, slotVol, 0.5));
      ok(m.status() === 'NoError' && sh.pos === 1 && cavOk,
        `${name}: solido chiuso, 1 corpo${cav ? `, ${cav} sedi magnete da ${slotVol.toFixed(1)} mm³ (${sh.cavities.map((v) => v.toFixed(1)).join(', ')})` : ''}`);
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
    ok(L > d.chW, `anello di traverso escluso: ${L} > ${f2(d.chW)}`);
    ok(L > d.headroom, `anello in piedi sulle costole escluso: ${L} > ${f2(d.headroom)}`);
    ok(d.protrusion + D > d.headroom, `anello disteso sopra un binario pieno escluso: ${d.protrusion + D} > ${f2(d.headroom)}`);
    ok(d.headroom > d.protrusion, `gli anelli nel binario stanno sotto il coperchio con ${f2(d.headroom - d.protrusion)} mm d'aria`);
    ok(d.notchW < D, `nessun anello esce dalle tacche: ${f2(d.notchW)} < ${D}`);
    const rIn = d.hole / 2 + d.holeChamfer;
    const rOut = D / 2 - d.ringChamfer;
    ok(rIn > d.seatAC / 2 && rOut > d.seatAC / 2 + 0.5,
      `in verticale l'anello più basso appoggia sulla barra: corona piana r ${f2(rIn)}–${f2(rOut)} fuori dalla sede (r ${f2(d.seatAC / 2)})`);
    ok(d.hole > d.rodAC, `l'anello scorre sull'asta: foro ${f2(d.hole)} > spigoli ${f2(d.rodAC)}`);

    // ----------------------------------------------------------- assieme chiuso
    ok(vol(s.base, s.lid) < 1e-3, 'scatola chiusa: base e coperchio non si compenetrano');
    const rods = s.union(d.chX.map((_, i) => rodInChannel(s, i)));
    ok(vol(rods, s.base) < 1e-3, 'aste inserite: nessun contatto con la base (tacche e binari)');
    const vRib = vol(rods, s.lid);
    if (params.ribInterference > 0) {
      const box = T(rods.intersect(s.lid)).boundingBox();
      ok(vRib > 0 && vRib < 12 && box.min[1] >= d.yBarFront,
        `aste inserite: interferenza voluta solo sulle nervature delle sedi (${vRib.toFixed(2)} mm³, da y ${f2(box.min[1])})`);
    } else {
      ok(vRib < 1e-3, 'aste inserite: nessun contatto col coperchio');
    }
    ok(near(-params.rodTail + d.rodLen, d.ySeatBottom, 1e-6), `la punta arriva in fondo alla sede (${f2(d.ySeatBottom)})`);
    for (const [what, at] of [['contro la barra', (k) => k * L], ['contro la parete frontale', (k) => d.chLen - (k + 1) * L]]) {
      const rings = s.union(d.chX.flatMap((_, i) => Array.from({ length: cap }, (_, k) => ringInChannel(s, i, at(k)))));
      ok(vol(rings, s.base) < 0.01 && vol(rings, s.lid) < 1e-3 && vol(rings, rods) < 1e-3,
        `${cap} anelli per binario ${what}: nessuna compenetrazione con base, coperchio e aste`);
    }

    // ----------------------------------------------------------- rotazione
    const steps = full ? [1, 2, 3, 5, 8, 12, 15, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180] : [2, 5, 15, 45, 90, 135, 180];
    const sweep = steps.map((th) => [th, vol(s.base, openLid(s, s.lid, th))]);
    const bad = sweep.filter(([th, v]) => th >= 15 && v > 1e-3);
    ok(bad.length === 0, `coperchio da 15° a 180°: nessun urto con la base${bad.length ? ` (urti a ${bad.map(([t]) => t).join(', ')}°)` : ''}`);
    if (full) {
      const latch = sweep.filter(([th, v]) => th < 15 && v > 1e-3);
      ok(latch.length > 0 && latch.every(([th]) => th <= 8),
        `linguette: interferenza solo nei primi gradi di apertura (${latch.map(([t, v]) => `${t}°: ${v.toFixed(1)} mm³`).join(', ')})`);
      ok(d.tongueStrain < 0.01, `deformazione della linguetta ${(d.tongueStrain * 100).toFixed(2)}% (< 1%)`);
    }
    ok(d.tongue.y1 + 2 <= d.yBarFront, `linguette libere davanti alla barra (finiscono a ${f2(d.tongue.y1)}, barra a ${f2(d.yBarFront)})`);
    // 4 colori × capienza sui binari; la stampa prova (3 × 3) ha meno posti
    // che anelli, quindi ogni binario si riempie al massimo fino alla capienza
    const counts = spread(Math.min(4 * cap, d.n * cap), d.n);
    ok(counts.every((c) => c <= cap), `${counts.reduce((a, b) => a + b, 0)} anelli distribuiti ${counts.join('-')}`);
    const ringsAtBar = s.union(d.chX.flatMap((_, i) => Array.from({ length: counts[i] }, (_, k) => ringInChannel(s, i, k * L))));
    const gapSpread = (d.chLen - Math.max(...counts) * L) / Math.max(...counts);
    const ringsSpread = s.union(d.chX.flatMap((_, i) => Array.from({ length: counts[i] }, (_, k) => ringInChannel(s, i, k * (L + gapSpread)))));
    const loadA = s.union([rods, ringsAtBar]);
    const loadB = s.union([rods, ringsSpread]);
    const sweep90 = (full ? [0, 1, 2, 5, 10, 20, 30, 45, 60, 75, 90] : [0, 2, 5, 10, 45, 90]).map((th) => {
      const a = openLid(s, loadA, th);
      const b = openLid(s, loadB, th);
      return [th, vol(a, s.base) + vol(b, s.base)];
    });
    const bad90 = sweep90.filter(([, v]) => v > 0.01);
    ok(bad90.length === 0, `apertura 0→90° con aste e anelli infilati: nessun urto con la base${bad90.length ? ` (${bad90.map(([t, v]) => `${t}°: ${v.toFixed(2)}`).join(', ')})` : ''}`);

    // ----------------------------------------------------------- a 90°
    const stack = s.union(d.chX.flatMap((_, i) => Array.from({ length: cap }, (_, k) => ringInChannel(s, i, k * L))));
    const stack90 = openLid(s, stack, 90);
    const lid90 = openLid(s, s.lid, 90);
    ok(vol(stack90, s.base) < 1e-3 && vol(stack90, lid90) < 0.01, `a 90°: ${cap} anelli per asta impilati sulla barra senza urti`);
    const free = d.rodLen - d.seatDepth - cap * L;
    ok(free > 0, `a 90°: sopra ${cap} anelli restano ${f2(free)} mm di asta libera`);
    // un anello deve potersi sfilare dalla cima fino a oltre la punta (aste e
    // coperchio ruotano insieme: basta verificarlo nel riferimento chiuso)
    const top = d.rodLen - d.seatDepth;
    let blocked = [];
    for (let i = 0; i < d.n; i++) {
      for (let u = (cap - 1) * L; u <= top + 1; u += 1) {
        if (vol(ringInChannel(s, i, u), s.lid) > 1e-3) { blocked.push(`asta ${i + 1} a ${u} mm`); break; }
      }
    }
    ok(blocked.length === 0, `a 90°: ogni anello si sfila dalla cima dell'asta senza toccare il coperchio${blocked.length ? ` (bloccato: ${blocked.join(', ')})` : ''}`);
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
    ok(distAt(0) > MAGNET.d + 2 && distAt(180) > MAGNET.d + 2,
      `magneti lontani a coperchio chiuso (${f2(distAt(0))} mm) e in stampa (${f2(distAt(180))} mm)`);
    ok(d.magRadius >= 8, `magneti a ${f2(d.magRadius)} mm dall'asse (≥ 8: la coppia di tenuta cresce col quadrato della distanza)`);
    const magnetAt = (x, y, z) => T(s.magnet.translate([x, y, z]));
    const magBase = s.union([-1, 1].map((sd) => magnetAt(sd * d.magBaseX, d.magBase.y, d.magBase.z)));
    const magLid = s.union([-1, 1].map((sd) => magnetAt(sd * d.magLidX, d.magLid.y, d.magLid.z)));
    ok(vol(magBase, s.base) < 1e-3 && vol(magLid, s.lid) < 1e-3, 'i 4 magneti entrano nelle loro sedi senza interferenze');
    const gapX = (d.magBaseX - d.slotW / 2) - (d.magLidX + d.slotW / 2);
    ok(gapX < 2, `distanza tra le facce dei magneti ${f2(gapX)} mm (pelli ${MAGNET.skin} + gioco ${params.hingeClearance})`);
    const lidSlotTopPrint = 2 * d.zHinge - (d.magLid.z - d.slotR);
    const baseSlotTop = d.magBase.z + d.slotR;
    ok(near(lidSlotTopPrint, d.pauseZ, 1e-6) && near(baseSlotTop, d.pauseZ, 1e-6) && d.magBase.z - d.slotR >= MAGNET.skin - 1e-6,
      `una sola pausa: sedi di base e coperchio aperte a Z = ${f2(d.pauseZ)} mm`);

    // ----------------------------------------------------------- stampa
    const lay = buildPrintLayouts(s);
    ok(vol(s.base, lay.lidPrint) < 1e-3, 'stampa a 180°: base e coperchio separati (print in place)');
    for (const [name, m] of [['scatola', lay.box], ['anelli', lay.ringsPlate], ['aste', lay.rods6], ['piatto di prova', lay.testPlate]]) {
      const b = m.boundingBox();
      const sx = b.max[0] - b.min[0];
      const sy = b.max[1] - b.min[1];
      ok(near(b.min[2], 0, 1e-6) && sx <= BED - 10 && sy <= BED - 10, `${name}: appoggiato sul piatto, ${sx.toFixed(1)} × ${sy.toFixed(1)} mm`);
    }
    ok(near(lay.lidPrint.boundingBox().min[2], 0, 1e-6), 'coperchio in stampa: faccia esterna sul piatto');
    const flat = flatDownArea(lay.box, [d.pauseZ]);
    ok(flat < 1, `scatola in stampa: nessuno sbalzo orizzontale (${flat.toFixed(2)} mm² di facce verso il piatto, esclusi i tetti delle sedi magnete)`);
    const flatTest = flatDownArea(lay.testPlate, []);
    ok(flatTest < 1, `piatto di prova: nessuno sbalzo orizzontale (${flatTest.toFixed(2)} mm²)`);

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
run('Gioco anello minimo, sede massima', { ...DEFAULT_PARAMS, slideClearance: 0.2, seatClearance: 0.25, ribInterference: 0.2, segments: 32 }, { full: false });
run('Cerniera massima, capienza minima', { ...DEFAULT_PARAMS, hingeClearance: 0.5, capacity: 6, segments: 32 }, { full: false });
run('Senza nervature, coda lunga', { ...DEFAULT_PARAMS, ribInterference: 0, rodTail: 10, segments: 32 }, { full: false });
const dm = run(`Stampa prova (${MINI.channels} binari × ${MINI.capacity} anelli)`, { ...DEFAULT_PARAMS, ...MINI }, { full: true });
run('Stampa prova, cursori al minimo', { ...lo, ...MINI, segments: 32 }, { full: false });
run('Stampa prova, cursori al massimo', { ...hi, ...MINI, segments: 32 }, { full: false });

console.log('\n▶ Piatto della stampa prova');
{
  const s = buildSolids(wasm, { ...DEFAULT_PARAMS, ...MINI });
  try {
    const plate = buildMiniPlate(s);
    const b = plate.boundingBox();
    const sx = b.max[0] - b.min[0];
    const sy = b.max[1] - b.min[1];
    ok(near(b.min[2], 0, 1e-6) && sx <= BED - 10 && sy <= BED - 10, `un solo piatto: ${sx.toFixed(1)} × ${sy.toFixed(1)} mm`);
    // base, coperchio, asta e anello staccati; le sedi dei magneti sono gusci negativi
    const parts = plate.decompose();
    const bodies = parts.map((x) => x.volume()).filter((v) => v > 0).sort((x, y) => y - x);
    for (const x of parts) x.delete();
    ok(bodies.length === 4 && near(bodies[2], s.rod.volume(), 1e-3) && near(bodies[3], s.ring.volume(), 1e-3),
      `scatola, asta e anello separati sul piatto (${bodies.length} corpi)`);
  } finally {
    s.dispose();
  }
}

console.log(`\nStampa prova: scatola chiusa ${dm.width.toFixed(1)} × ${dm.length.toFixed(1)} × ${dm.H.toFixed(1)} mm, aperta ${dm.openLength.toFixed(1)} mm, asta da ${dm.rodLen.toFixed(0)} mm.`);
console.log(`Scatola chiusa ${d0.width.toFixed(1)} × ${d0.length.toFixed(1)} × ${d0.H.toFixed(1)} mm (+ ${DEFAULT_PARAMS.rodTail} mm di code), aperta ${d0.openLength.toFixed(1)} mm. Pausa magneti a Z = ${d0.pauseZ.toFixed(2)} mm.`);
console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche superate');
process.exit(failures ? 1 : 0);
