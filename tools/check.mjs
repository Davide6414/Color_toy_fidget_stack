// Verifiche di progetto del gioco ordina-colori. Uso: npm test
// Controlla solidi chiusi, quote delle specifiche, esclusione delle posizioni
// sbagliate degli anelli, assieme senza compenetrazioni, rotazione del
// coperchio 0→180° con aste e anelli, scatto delle linguette, fermo a scatto a
// 90°, scatto delle aste e piatti di stampa.
import { loadManifold, buildSolids, buildPrintLayouts, buildMiniPlate, openLid, rodInChannel, ringInChannel } from '../js/geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS, MINI } from '../js/params.js';

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
    for (const [name, m] of [['base', s.base], ['coperchio', s.lid], ['asta', s.rod], ['anello', s.ring]]) {
      const sh = shells(m);
      ok(m.status() === 'NoError' && sh.pos === 1 && sh.neg === 0, `${name}: solido chiuso, 1 corpo senza cavità (${(m.volume() / 1000).toFixed(1)} cm³)`);
    }

    // ----------------------------------------------------------- quote
    if (label.startsWith('Parametri')) {
      ok(near(d.hole, 5.2, 0.05), `foro anello Ø ${f2(d.hole)} (spec 5,2)`);
      ok(near(d.ringWall, 1.4, 0.05), `parete anello ${f2(d.ringWall)} (spec 1,4)`);
      ok(near(d.chW, 8.6, 1e-9) && near(d.chDepth, 6, 1e-9), `binario largo ${f2(d.chW)}, profondo ${f2(d.chDepth)} (spec 8,6 × 6)`);
      ok(near(d.pitch, 10.2, 1e-9) && near(d.chLen, 102, 1e-9), `passo ${f2(d.pitch)}, lunghezza binario ${f2(d.chLen)} (spec 10,2 / 102)`);
      ok(near(d.headroom, 9, 1e-9), `spazio sopra le costole ${f2(d.headroom)} (spec 9)`);
      ok(near(d.rodLen, 121, 1e-9), `asta lunga ${f2(d.rodLen)} (spec 121, sede da 12)`);
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
    ok(vol(rods, T(s.lid.subtract(s.detentNubs))) < 1e-3, 'aste inserite: col coperchio le toccano solo i dentini dello scatto');
    ok(near(-params.rodTail + d.rodLen, d.ySeatBottom, 1e-6), `la punta arriva in fondo alla sede (${f2(d.ySeatBottom)})`);

    // ----------------------------------------------------------- gonna e anelli a 90°
    // Nel sistema del coperchio l'asta in sede è ferma a ogni apertura: a 90° un
    // anello che esce dalla coda attraversa la gonna, spostato quanto gli permette il foro.
    const front = T(s.lid.intersect(s.box(-d.outerHalf - 1, d.outerHalf + 1, -30, 25, -5, d.H + 1)));
    const eF = Math.sqrt((d.hole / 2) ** 2 - (d.rodAC / 4) ** 2) - params.rodAF / 2;
    const eV = d.hole / 2 - d.rodAC / 2;
    const offs = [[0, 0], [eF, 0], [-eF, 0], [0, eV], [0, -eV], [0.7 * eF, 0.7 * eV], [-0.7 * eF, 0.7 * eV]];
    let worstRing = 0;
    for (let i = 0; i < d.n; i++) {
      for (let fb = d.chLen - 16; fb <= d.chLen + 16; fb += full ? 1 : 4) {
        for (const [ox, oz] of offs) worstRing = Math.max(worstRing, vol(T(ringInChannel(s, i, fb).translate([ox, 0, oz])), front));
      }
    }
    ok(worstRing < 1e-3, `a 90°: gli anelli escono dalla coda dell'asta passando sotto la gonna (max ${worstRing.toFixed(4)} mm³, gioco ${f2(eF)}/${f2(eV)})`);
    const lip = vol(s.lid, s.box(-d.outerHalf, d.outerHalf, 0, d.frontT, d.frontTop, d.frontTop + 0.05)) / 0.05;
    ok(lip > 3, `la gonna appoggia ancora sulla parete frontale tra gli archi (${lip.toFixed(1)} mm²)`);
    const crescent = d.zAxis + d.archR - d.frontTop;
    ok(crescent < D - 1, `sopra ogni tacca una lunetta alta ${f2(crescent)} mm: nessun anello esce (Ø ${D})`);

    // ----------------------------------------------------------- scatto delle aste
    // Flessione del dentino (bisezione) con l'asta spinta contro la faccia opposta
    // e appoggiata nella V in basso, a varie distanze dalla posizione in sede.
    const nubDefl = (i, pull) => {
      const sg = d.detentSide[i];
      const rod = T(s.rod.translate([d.chX[i] - sg * params.seatClearance, -params.rodTail - pull, d.zAxis - (d.seatAC - d.rodAC) / 2]));
      const nub = T(s.union(s.detentMoving.slice(3 * i, 3 * i + 2)).intersect(s.box(-40, 40, d.yBarFront - 1, d.ySeatBottom + 1, 0, d.zAxis + 2.3)));
      if (vol(rod, nub) < 1e-6) return 0;
      let lo = 0;
      let hi = 1.5;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (vol(rod, T(nub.translate([sg * m, 0, 0]))) > 1e-6) lo = m; else hi = m;
      }
      return hi;
    };
    const defl = [0, 0.3, 1, 3, 10].map((pull) => nubDefl(0, pull));
    ok(defl[0] < params.rodDetent - 0.1 && defl[3] > params.rodDetent - 0.03 && defl[3] < params.rodDetent + 0.03 && defl[4] === 0,
      `scatto: dentino flesso ${defl.map((v, k) => `${f2(v)} a ${[0, 0.3, 1, 3, 10][k]} mm`).join(', ')} (in sede, sulla gola, sulla faccia, libera)`);
    ok(defl[2] > defl[0] + 0.1, 'scatto: per sfilare l\'asta il dentino deve risalire il fianco della gola');
    const rodWeight = s.rod.volume() * 1.24e-3 * 9.81e-3;
    ok(d.detentPull > 10 * rodWeight && d.detentPull < 1.5,
      `scatto: per sfilare l'asta ≈ ${d.detentPull.toFixed(2)} N (${(d.detentPull / rodWeight).toFixed(0)} volte il peso), poi ${d.detentDrag.toFixed(2)} N di attrito`);
    ok(d.detentStrain < 0.01, `scatto: deformazione della linguetta ${(d.detentStrain * 100).toFixed(2)}% (< 1%, forza +40%)`);
    const neckIn = d.seatDepth - d.neck.fromTip;
    ok(neckIn >= 4 && (d.neck.af / params.rodAF) ** 2 >= 0.6,
      `gola dell'asta ${f2(neckIn)} mm dentro la sede, sezione ${((d.neck.af / params.rodAF) ** 2 * 100).toFixed(0)}% dell'esagono`);
    // giochi di stampa di linguetta, pilastrino e dentino rispetto al resto del coperchio
    const restCut = s.union(d.chX.flatMap((xc, i) => {
      const sg = d.detentSide[i];
      const x0 = xc + sg * (d.seatAF / 2);
      const x1 = x0 + sg * d.detent.w;
      return [s.box(Math.min(x0, x1) - 0.01, Math.max(x0, x1) + 0.01, d.detent.yRoot + 0.5, d.detent.yTip + 0.01, d.zLid - 0.01, d.H + 0.01),
        ...s.detentMoving.slice(3 * i, 3 * i + 2)];
    }));
    const rest = T(s.lid.subtract(restCut));
    const shiftEach = (pick, amt) => s.union(d.chX.flatMap((_, i) => pick(i).map((m) => T(m.translate([d.detentSide[i] * amt, 0, 0])))));
    const all3 = (i) => s.detentMoving.slice(3 * i, 3 * i + 3);
    const postNub = (i) => s.detentMoving.slice(3 * i, 3 * i + 2);
    const tongue = (i) => [s.detentMoving[3 * i + 2]];
    const moving = s.union(s.detentMoving);
    const detentGaps = [
      ['Y +0,29', T(moving.translate([0, 0.29, 0]))], ['Y −0,29', T(moving.translate([0, -0.29, 0]))],
      ['Z +0,29', T(moving.translate([0, 0, 0.29]))], ['Z −0,29', T(moving.translate([0, 0, -0.29]))],
      ['verso la sede 0,35', shiftEach(all3, -0.35)], ['pilastrino fuori 0,95', shiftEach(postNub, 0.95)],
      ['linguetta ±0,75', s.union([shiftEach(tongue, 0.75), shiftEach(tongue, -0.75)])],
    ].map(([k, m]) => [k, vol(m, rest)]);
    ok(detentGaps.every(([, v]) => v < 1e-3), `scatto: parti mobili staccate dal coperchio in stampa (${detentGaps.filter(([, v]) => v >= 1e-3).map(([k]) => k).join(', ') || 'giochi ok'})`);
    ok(defl[0] >= 0.05, `scatto: in sede il dentino preme già sull'asta (${f2(defl[0])} mm) e la tiene contro la faccia opposta`);
    const dt = d.detent;
    const layers = (d.lidT + dt.relief) / 0.2;
    ok(dt.relief >= 0.8 && Math.abs(layers - Math.round(layers)) < 1e-6,
      `scatto: ${f2(dt.relief)} mm sopra la barra, il ponte della barra parte su uno strato intero (${Math.round(layers)})`);
    const tongues = s.union(d.chX.flatMap((_, i) => tongue(i)));
    ok(vol(T(tongues.translate([0, 0, -(dt.relief - 0.1)])), rest) < 1e-3, 'scatto: anche se il ponte cala di 0,9 mm le linguette restano libere');
    // premendo il coperchio sopra una linguetta: dove si ferma e quanto si deforma
    let lo = 0;
    let hi = 2;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (vol(T(moving.translate([0, 0, -m])), rest) > 1e-4) hi = m; else lo = m;
    }
    const pressStrain = (3 * hi * (d.lidT / 2)) / d.detentLeff ** 2;
    // sovraccarico raro (un polpastrello non entra in 3,2 mm): sotto lo snervamento del PLA, 2,5-3%
    ok(pressStrain < 0.02, `scatto: premendo sopra una linguetta si ferma dopo ${f2(hi)} mm (${(pressStrain * 100).toFixed(2)}% < 2%, sovraccarico raro)`);
    ok(d.detentPostStress < 6, `scatto: radice del pilastrino, attraverso gli strati, ${d.detentPostStress.toFixed(1)} MPa (< 6)`);
    const access = d.chX.reduce((sum, xc, i) => {
      const sg = d.detentSide[i];
      const xa = xc + sg * (d.seatAF / 2 - dt.clrIn);
      const xb = xc + sg * (d.seatAF / 2 + dt.w + dt.clrOut);
      return sum + vol(s.lid, s.box(Math.min(xa, xb) + 0.05, Math.max(xa, xb) - 0.05, dt.postY[0] - dt.clrY + 0.05, dt.postY[1] + dt.clrY - 0.05, d.zBarBottom - 0.5, dt.postZ0 - 0.05));
    }, 0);
    ok(access < 1e-3, 'scatto: il vano di ogni pilastrino è aperto sotto la barra, si pulisce da lì');
    const lt = d.tongue;
    const latch = [[d.lidHalf - lt.b - lt.slot, d.lidHalf + 1], [-d.lidHalf - 1, -(d.lidHalf - lt.b - lt.slot)]];
    const yOverlap = dt.yRoot < lt.y1 && dt.yTip + dt.slot > lt.y0 - lt.slot;
    let latchGap = Infinity;
    if (yOverlap) {
      d.chX.forEach((xc, i) => {
        const sg = d.detentSide[i];
        const a = [xc + sg * (d.seatAF / 2 - dt.slot), xc + sg * (d.seatAF / 2 + dt.w + dt.slot)];
        for (const [b0, b1] of latch) latchGap = Math.min(latchGap, Math.max(b0 - Math.max(...a), Math.min(...a) - b1));
      });
    }
    ok(latchGap >= 1.5, yOverlap ? `scatto: feritoie a ${f2(latchGap)} mm da quelle delle linguette di chiusura` : 'scatto: feritoie lontane dalle linguette di chiusura');
    const cap = params.capacity;
    for (const [what, at] of [['contro la barra', (k) => k * L], ['contro la parete frontale', (k) => d.chLen - (k + 1) * L]]) {
      const rings = s.union(d.chX.flatMap((_, i) => Array.from({ length: cap }, (_, k) => ringInChannel(s, i, at(k)))));
      ok(vol(rings, s.base) < 0.01 && vol(rings, s.lid) < 1e-3 && vol(rings, rods) < 1e-3,
        `${cap} anelli per binario ${what}: nessuna compenetrazione con base, coperchio e aste`);
    }

    // ----------------------------------------------------------- rotazione
    const steps = full ? [1, 2, 3, 5, 8, 12, 15, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180] : [5, 15, 45, 90, 135, 180];
    // i dentini del fermo li toccano apposta: si controllano a parte
    const baseNoNub = T(s.base.subtract(s.stopNubs));
    const sweep = steps.map((th) => [th, vol(baseNoNub, openLid(s, s.lid, th))]);
    const bad = sweep.filter(([th, v]) => th >= 15 && v > 1e-3);
    ok(bad.length === 0, `coperchio da 15° a 180°: nessun urto con la base, dentini del fermo a parte${bad.length ? ` (urti a ${bad.map(([t]) => t).join(', ')}°)` : ''}`);
    if (full) {
      const latch = sweep.filter(([th, v]) => th < 15 && v > 1e-3);
      ok(latch.length > 0 && latch.every(([th]) => th <= 8),
        `linguette: interferenza solo nei primi gradi di apertura (${latch.map(([t, v]) => `${t}°: ${v.toFixed(1)} mm³`).join(', ')})`);
      ok(d.tongueStrain < 0.01, `deformazione della linguetta ${(d.tongueStrain * 100).toFixed(2)}% (< 1%)`);
    }
    ok(d.tongue.y1 + 2 <= d.yBarFront, `linguette libere davanti alla barra (finiscono a ${f2(d.tongue.y1)}, barra a ${f2(d.yBarFront)})`);
    // 4 colori × capienza distribuiti sulle aste (40 su 6: 7, 7, 7, 7, 6, 6)
    const perRod = (i) => Math.min(cap, Math.floor((4 * cap) / d.n) + (i < (4 * cap) % d.n ? 1 : 0));
    // distanziati di 4 mm, o meno se il binario è corto: davanti restano i 2 mm
    // di gioco del binario (in apertura la parte sotto l'asse avanza un poco)
    const spread = (n) => (n > 1 ? Math.max(0, Math.min(4, (d.chLen - 2 - n * L) / (n - 1))) : 0);
    const ringsAtBar = s.union(d.chX.flatMap((_, i) => Array.from({ length: perRod(i) }, (_, k) => ringInChannel(s, i, k * L))));
    const ringsSpread = s.union(d.chX.flatMap((_, i) => Array.from({ length: perRod(i) }, (_, k) => ringInChannel(s, i, k * (L + spread(perRod(i)))))));
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

    // ----------------------------------------------------------- fermo a 90°
    // Flessione della linguetta perché il dentino lasci passare il coperchio
    // all'apertura th (bisezione: i due dentini spostati verso l'esterno).
    const st = d.stop;
    const half = (m, side) => T(m.intersect(s.box(side > 0 ? 0 : -200, side > 0 ? 200 : 0, -50, 400, -50, 50)));
    const nubR = half(s.stopNubs, 1);
    const nubL = half(s.stopNubs, -1);
    const stopDefl = (th, lidM = s.lid) => {
      const lidT = openLid(s, lidM, th);
      if (vol(s.stopNubs, lidT) < 1e-4) return 0;
      let a = 0;
      let b = 2.5;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        if (vol(s.union([T(nubR.translate([m, 0, 0])), T(nubL.translate([-m, 0, 0]))]), lidT) > 1e-4) a = m; else b = m;
      }
      return b;
    };
    const lidNoBump = T(s.lid.subtract(s.stopBumps));
    const useSteps = full ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 88, 89, 89.5, 90] : [0, 30, 60, 85, 90];
    ok(useSteps.every((th) => vol(s.stopNubs, openLid(s, lidNoBump, th)) < 1e-4), 'fermo: da 0° a 90° il dentino tocca solo il rilievo dello scatto');
    const clicks = useSteps.map((th) => stopDefl(th));
    const clickMax = Math.max(...clicks);
    ok(near(clickMax, st.bump, 0.03) && stopDefl(90) < 0.02,
      `fermo: scatto prima dei 90° (linguetta flessa ${f2(clickMax)} mm sul rilievo, libera a 90°)`);
    let play = 0;
    for (const dth of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
      if (stopDefl(90 - dth) > 0.02) break;
      play = dth;
    }
    ok(play <= 1.5, `fermo: a 90° il coperchio si richiude al massimo di ${play}° prima di toccare il rilievo`);
    ok(vol(s.stopNubs, openLid(s, s.lid, 90.5)) > 0.01, 'fermo: oltre i 90° la faccia della guancia batte sul dentino');
    const passSteps = full ? [91, 100, 120, 140, 160, 170, 175] : [91, 135, 170];
    const passMax = Math.max(...passSteps.map((th) => stopDefl(th)));
    ok(passMax <= st.depth + 0.05 && passMax < st.beamGap - 0.2,
      `fermo: alla prima chiusura dopo la stampa la linguetta si flette di ${f2(passMax)} mm, una volta sola (vano ${f2(st.beamGap)})`);
    const lid180 = openLid(s, s.lid, 180);
    const nubGap = [[0.29, 0, 0], [-0.29, 0, 0], [0, 0.29, 0], [0, -0.29, 0], [0, 0, 0.29], [0, 0, -0.29]]
      .every((v) => vol(T(s.stopNubs.translate(v)), lid180) < 1e-4);
    ok(nubGap, 'fermo: in stampa a 180° il dentino ha almeno 0,29 mm di gioco dal coperchio');
    const baseRest = T(s.base.subtract(s.union([s.stopBeams, s.stopNubs])));
    const beamShift = ([dx, dy, dz]) => s.union([T(half(s.stopBeams, 1).translate([dx, dy, dz])), T(half(s.stopBeams, -1).translate([-dx, dy, dz]))]);
    const beamFree = [[0.29, 0, 0], [st.depth + 0.1, 0, 0], [-0.29, 0, 0], [0, 0.29, 0], [0, 0, -0.29]].every((v) => vol(beamShift(v), baseRest) < 1e-3);
    ok(beamFree, 'fermo: linguette staccate da fondo e parete, con il vano per flettersi');
    ok(d.stopPassStrain < 0.015 && d.stopClickStrain < 0.005,
      `fermo: deformazione ${(d.stopPassStrain * 100).toFixed(2)}% al primo passaggio, ${(d.stopClickStrain * 100).toFixed(2)}% a ogni scatto`);
    ok(d.stopClickForce > 0.2 && d.stopClickForce < 1.5,
      `fermo: per chiudere da 90° servono ≈ ${d.stopClickForce.toFixed(2)} N sul bordo del coperchio (${d.stopClickTorque.toFixed(0)} N·mm)`);

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
    // base, coperchio, asta e anello staccati
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
console.log(`Scatola chiusa ${d0.width.toFixed(1)} × ${d0.length.toFixed(1)} × ${d0.H.toFixed(1)} mm (+ ${DEFAULT_PARAMS.rodTail} mm di code), aperta ${d0.openLength.toFixed(1)} mm, nessuna pausa.`);
console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche superate');
process.exit(failures ? 1 : 0);
