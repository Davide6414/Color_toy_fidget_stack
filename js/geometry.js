// Geometria parametrica del gioco ordina-colori, costruita con manifold-3d:
// booleane CSG esatte con mesh sempre chiuse (manifold), quindi STL pronti per
// Bambu Studio. Gira nel browser (import map) e in Node (node_modules).
import Module from 'manifold-3d';
import { computeDims, MAGNET, MINI, COLORS, BOX_COLOR, ROD_COLOR } from './params.js';

let wasmPromise = null;
export function loadManifold() {
  wasmPromise ??= Module().then((wasm) => { wasm.setup(); return wasm; });
  return wasmPromise;
}

const signedArea = (pts) => pts.reduce((a, [x, y], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return a + x * y2 - x2 * y;
}, 0) / 2;

// Costruisce tutti i solidi in coordinate di assieme (scatola chiusa).
// Restituisce oggetti Manifold vivi: chi chiama deve invocare dispose().
export function buildSolids(wasm, params) {
  const { Manifold, CrossSection } = wasm;
  const d = computeDims(params);
  const p = params;
  const pool = [];
  const T = (o) => { pool.push(o); return o; };
  const seg = d.seg;

  // --- primitive ------------------------------------------------------------
  const box = (x0, x1, y0, y1, z0, z1) =>
    T(T(Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
  const MX = (x0, y = 0, z = 0) => [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, y, z, 1];
  const MY = (y1) => [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, y1, 0, 1];
  const poly = (pts) => T(new CrossSection([signedArea(pts) < 0 ? [...pts].reverse() : pts]));
  const union2 = (list) => T(CrossSection.union(list));
  const circ = (r, u, v, s = seg) => T(T(CrossSection.circle(r, s)).translate([u, v]));
  const rect = (u0, u1, v0, v1) => T(T(CrossSection.square([u1 - u0, v1 - v0])).translate([u0, v0]));
  // profilo (u = Y, v = Z) estruso lungo +X tra x0 e x1
  const extX = (cs, x0, x1) => T(T(Manifold.extrude(cs, x1 - x0)).transform(MX(x0)));
  // profilo (u = X, v = Z) estruso lungo Y tra y0 e y1
  const extY = (cs, y0, y1) => T(T(Manifold.extrude(cs, y1 - y0)).transform(MY(y1)));
  // tronco di cono lungo X: raggio r0 in x0, r1 in x1 (x1 può essere < x0)
  const coneX = (x0, x1, y, z, r0, r1) => {
    const h = Math.abs(x1 - x0);
    const c = T(T(Manifold.cylinder(h, r0, r1, 48)).transform(MX(0)));
    return x1 >= x0 ? T(c.translate([x0, y, z])) : T(T(c.rotate([0, 0, 180])).translate([x0, y, z]));
  };
  const hull = (pts) => T(Manifold.hull(pts));
  const union = (list) => T(Manifold.union(list));
  const mirrorX = (m) => T(m.mirror([1, 0, 0]));
  const hexCS = (r, u, v) => poly(Array.from({ length: 6 }, (_, k) => {
    const a = ((90 + 60 * k) * Math.PI) / 180;
    return [u + r * Math.cos(a), v + r * Math.sin(a)];
  }));

  const IH = d.innerHalf;
  const OH = d.outerHalf;
  const LH = d.lidHalf;
  const yH = d.yHinge;
  const zH = d.zHinge;
  const g = p.hingeClearance;
  const skin = MAGNET.skin;

  // Sede del magnete: disco con asse X, sezione a "D" aperta in alto rispetto
  // alla stampa (si infila dall'alto durante la pausa e viene ricoperta).
  const magnetSlotCS = (y, z, openUp) => union2([
    circ(d.slotR, y, z, 48),
    openUp ? rect(y - d.slotR, y + d.slotR, z, z + d.slotR) : rect(y - d.slotR, y + d.slotR, z - d.slotR, z),
  ]);

  // ============================================================ BASE
  const sideCS = union2([
    rect(0, d.yRear - 4, 0, d.H),
    T(rect(4, d.yRear - 4, 4, d.H - 4).offset(4, 'Round', 2, 48)),
  ]);
  const camTri = (side) => {
    const c = d.camChamfer;
    const s = side;
    return poly([[s * (IH - 0.5), d.H - c - 0.5], [s * (IH + c + 0.5), d.H + 0.5], [s * (IH - 0.5), d.H + 0.5]]);
  };
  const t = d.tongue;
  // Dentino della linguetta: tronco di piramide a 45° sul fianco del coperchio.
  // Alla quota X la sezione è rientrata di (X - LH); la sede nella parete è lo
  // stesso solido scostato di 0,15 mm.
  const rectPts = (x, inset) => {
    const [y0, y1] = t.nubY;
    const [z0, z1] = t.nubZ;
    return [[x, y0 + inset, z0 + inset], [x, y1 - inset, z0 + inset], [x, y0 + inset, z1 - inset], [x, y1 - inset, z1 - inset]];
  };
  const nubClr = 0.15;
  const dimpleRight = hull([
    ...rectPts(IH - 0.2, IH - 0.2 - LH - nubClr * Math.SQRT2),
    ...rectPts(LH + t.nub + nubClr, t.nub + nubClr - nubClr * Math.SQRT2),
  ]);

  let sideRight = extX(sideCS, IH, OH);
  sideRight = T(sideRight.subtract(extY(camTri(1), -1, d.yRear + 1)));
  sideRight = T(sideRight.subtract(dimpleRight));
  sideRight = T(sideRight.subtract(extX(magnetSlotCS(d.magBase.y, d.magBase.z, true),
    d.magBaseX - d.slotW / 2, d.magBaseX + d.slotW / 2)));
  const sideLeft = mirrorX(sideRight);

  const floor = T(box(-IH - 0.5, IH + 0.5, 0, yH - 0.15, 0, d.floor).subtract(union([
    box(LH - d.cheekW - g, IH + 0.01, yH - d.cheekY - g, yH + 1, -1, d.floor + 1),
    box(-IH - 0.01, -LH + d.cheekW + g, yH - d.cheekY - g, yH + 1, -1, d.floor + 1),
  ])));

  let channels = union([
    box(-IH - 0.5, IH + 0.5, 0, d.yChEnd, 0, d.ribTop),
    box(-IH - 0.5, IH + 0.5, 0, d.frontT, 0, d.frontTop),
  ]);
  const grooveCS = union2(d.chX.flatMap((x) => [
    circ(d.chR, x, d.floor + d.chR),
    rect(x - d.chR, x + d.chR, d.floor + d.chR, d.ribTop + 1),
  ]));
  channels = T(channels.subtract(extY(grooveCS, d.frontT, d.yChEnd + 1)));
  const notchCS = union2(d.chX.flatMap((x) => [
    circ(d.notchW / 2, x, d.zAxis, 48),
    rect(x - d.notchW / 2, x + d.notchW / 2, d.zAxis, d.frontTop + 1),
  ]));
  channels = T(channels.subtract(extY(notchCS, -1, d.frontT + 0.01)));

  // Nocche della base: cilindro + nervatura fino al fondo; il quarto
  // posteriore-inferiore è smussato a 45° per stamparlo senza supporti.
  const baseKnuckleCS = union2([
    T(circ(d.kR, yH, zH).subtract(poly([
      [yH - 0.15, zH - d.kR], [yH + d.kR - 0.15, zH], [yH + 12, zH], [yH + 12, zH - 12], [yH - 0.15, zH - 12],
    ]))),
    rect(yH - d.kR, yH - 0.15, 0, zH),
  ]);
  const knuckleSolids = [];
  d.knuckles.forEach((k, i) => {
    if (k.kind !== 'B') return;
    knuckleSolids.push(extX(baseKnuckleCS, k.x0, k.x1));
    // perni conici verso le nocche del coperchio a destra e a sinistra
    if (d.knuckles[i + 1]?.kind === 'L') knuckleSolids.push(coneX(k.x1 - 0.2, k.x1 + d.coneR, yH, zH, d.coneR + 0.2, 0));
    if (d.knuckles[i - 1]?.kind === 'L') knuckleSolids.push(coneX(k.x0 + 0.2, k.x0 - d.coneR, yH, zH, d.coneR + 0.2, 0));
  });

  const base = union([floor, channels, sideRight, sideLeft, ...knuckleSolids]);

  // ============================================================ COPERCHIO
  const plate = box(-LH, LH, 0, yH - 0.15, d.zLid, d.H);
  const skirt = box(-LH, LH, 0, d.frontT, d.frontTop, d.zLid + 0.1);
  let bar = box(-LH, LH, d.yBarFront, d.yBarBack, d.zBarBottom, d.zLid + 0.1);
  const bc = d.barChamfer;
  bar = T(bar.subtract(extX(poly([
    [d.yBarFront - 0.5, d.zBarBottom + bc + 0.5], [d.yBarFront - 0.5, d.zBarBottom - 0.5], [d.yBarFront + bc + 0.5, d.zBarBottom - 0.5],
  ]), -LH - 1, LH + 1)));
  const seatsCS = union2(d.chX.map((x) => hexCS(d.seatAC / 2, x, d.zAxis)));
  bar = T(bar.subtract(extY(seatsCS, d.yBarFront - 1, d.ySeatBottom)));

  const lidKnuckleCS = union2([
    circ(d.kR, yH, zH),
    rect(d.yBarBack - 0.1, yH + d.kR, zH, d.zLid + 0.5),
  ]);
  const lidParts = [plate, skirt, bar];
  const socketR = d.coneR + g * Math.SQRT2;
  const sockets = [];
  d.knuckles.forEach((k, i) => {
    if (k.kind !== 'L') return;
    lidParts.push(extX(lidKnuckleCS, k.x0, k.x1));
    const left = d.knuckles[i - 1];
    const right = d.knuckles[i + 1];
    if (left?.kind === 'B') sockets.push(coneX(left.x1 - 0.5, left.x1 + socketR, yH, zH, socketR + 0.5, 0));
    if (right?.kind === 'B') sockets.push(coneX(right.x0 + 0.5, right.x0 - socketR, yH, zH, socketR + 0.5, 0));
  });

  // Guance posteriori con i magneti del coperchio (dietro-sopra l'asse).
  const topDz = d.H - zH;
  const cut = d.cheekCut;
  const cheekPts = [[yH - 0.5, zH], [yH + d.cheekY, zH]];
  if (cut - d.cheekY < topDz) {
    cheekPts.push([yH + d.cheekY, zH + cut - d.cheekY], [yH + cut - topDz, d.H]);
  } else {
    cheekPts.push([yH + d.cheekY, d.H]);
  }
  cheekPts.push([yH - 0.5, d.H]);
  const cheekRight = T(extX(poly(cheekPts), LH - d.cheekW, LH).subtract(extX(
    magnetSlotCS(d.magLid.y, d.magLid.z, false), d.magLidX - d.slotW / 2, d.magLidX + d.slotW / 2)));
  lidParts.push(cheekRight, mirrorX(cheekRight));

  // Linguette elastiche della chiusura frontale (nel piano del coperchio).
  const tongueSlots = union([
    box(LH - t.b - t.slot, LH - t.b, t.y0 - t.slot, t.y1, d.zLid - 0.01, d.H + 1),
    box(LH - t.b - t.slot, LH + 1, t.y0 - t.slot, t.y0, d.zLid - 0.01, d.H + 1),
  ]);
  const nubRight = hull([...rectPts(LH - 0.01, -0.01), ...rectPts(LH + t.nub, t.nub)]);
  lidParts.push(nubRight, mirrorX(nubRight));

  // Incavo per il pollice sul bordo frontale.
  const thumb = coneX(-10, 10, -1.5, d.H + 1.5, 4, 4);

  let lid = union(lidParts);
  lid = T(lid.subtract(union([...sockets, tongueSlots, mirrorX(tongueSlots), thumb])));

  // ============================================================ ASTE E ANELLI
  const rodAlongZ = (len) => {
    const r = d.rodAC / 2;
    const prism = T(Manifold.extrude(hexCS(r, 0, 0), len));
    const taper = T(Manifold.revolve([[
      [0, -0.01], [r - 0.4, -0.01], [r + 0.05, 0.45], [r + 0.05, len - p.rodTip], [0.9, len + 0.01], [0, len + 0.01],
    ]], 48));
    return T(prism.intersect(taper));
  };
  const rodZ = rodAlongZ(d.rodLen);
  // in assieme: asse lungo +Y, coda in Y = 0, un vertice in alto (come le sedi)
  const rod = T(rodZ.rotate([-90, 0, 0]));

  const rh = d.hole / 2;
  const R = p.ringD / 2;
  const c = d.ringChamfer;
  const hc = d.holeChamfer;
  const ringZ = T(Manifold.revolve([[
    [rh + hc, 0], [R - c, 0], [R, c], [R, p.ringL - c], [R - c, p.ringL], [rh + hc, p.ringL], [rh, p.ringL - hc], [rh, hc],
  ]], seg));
  // in assieme: asse lungo Y, centrato nell'origine
  const ring = T(T(ringZ.translate([0, 0, -p.ringL / 2])).rotate([-90, 0, 0]));

  const magnet = coneX(-MAGNET.h / 2, MAGNET.h / 2, 0, 0, MAGNET.d / 2, MAGNET.d / 2);

  return {
    d, base, lid, rod, rodZ, ring, ringZ, magnet, rodAlongZ,
    T, box, union, extX, extY, coneX, circ, rect, poly, union2, hexCS,
    baseKnuckleCS, lidKnuckleCS, wasm,
    dispose() { for (const o of pool) o.delete(); pool.length = 0; },
  };
}

// ---------------------------------------------------------------- utilità

// Rotazione del coperchio attorno all'asse della cerniera. theta = apertura
// in gradi (0 chiuso, 90 aste verticali, 180 posizione di stampa).
export function openLid(s, m, theta) {
  const { yHinge: yH, zHinge: zH } = s.d;
  return s.T(s.T(s.T(m.translate([0, -yH, -zH])).rotate([-theta, 0, 0])).translate([0, yH, zH]));
}

// Asta inserita nel binario i (scatola chiusa).
export function rodInChannel(s, i, pullOut = 0) {
  const d = s.d;
  return s.T(s.rod.translate([d.chX[i], -d.p.rodTail - pullOut, d.zAxis]));
}

// Anello disteso nel binario i, con il bordo posteriore a `fromBar` mm dalla barra.
export function ringInChannel(s, i, fromBar) {
  const d = s.d;
  return s.T(s.ring.translate([d.chX[i], d.yBarFront - fromBar - d.p.ringL / 2, d.zAxis]));
}

function bboxSize(m) {
  const b = m.boundingBox();
  return [0, 1, 2].map((k) => b.max[k] - b.min[k]);
}

export function meshData(manifold) {
  const mesh = manifold.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const n = vp.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = vp[i * np];
    positions[i * 3 + 1] = vp[i * np + 1];
    positions[i * 3 + 2] = vp[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

function stats(m) {
  return { volume: m.volume(), triangles: m.numTri(), size: bboxSize(m), status: m.status() };
}

// Piatti di stampa (orientamento di stampa, Z = 0 sul piatto).
export function buildPrintLayouts(s) {
  const { d, T } = s;
  const { Manifold } = s.wasm;
  const p = d.p;

  // Scatola: aperta a 180°, base e coperchio appoggiati sul piatto.
  const lidPrint = openLid(s, s.lid, 180);
  const box = T(Manifold.compose([s.base, lidPrint]));

  // Anelli: in piedi, 10 per piatto (uno per colore senza AMS).
  const gap = p.ringD + 4;
  const rings10 = T(Manifold.compose(Array.from({ length: 10 }, (_, k) =>
    T(s.ringZ.translate([(k % 5) * gap, Math.floor(k / 5) * gap, 0])))));

  // Aste: distese su una faccia dell'esagono.
  const rodFlat = T(T(s.rodZ.rotate([0, 90, 0])).translate([0, 0, p.rodAF / 2]));
  const rods6 = T(Manifold.compose(Array.from({ length: 6 }, (_, k) => T(rodFlat.translate([0, k * 8, 0])))));

  return { box, lidPrint, rings10, ring: s.ringZ, rod: rodFlat, rods6, testPlate: buildTestPlate(s) };
}

// Piatto di prova: 3 anelli, spezzone d'asta, tratto di barra con 2 sedi,
// tratto di binario da 3 anelli con tacca, nocca di cerniera print in place.
function buildTestPlate(s) {
  const { d, T, box, union, extX, extY, coneX, hexCS, union2, circ, rect } = s;
  const { Manifold } = s.wasm;
  const p = d.p;
  const parts = [];

  // 3 anelli
  for (let k = 0; k < 3; k++) parts.push(T(s.ringZ.translate([k * (p.ringD + 4), 0, 0])));

  // spezzone d'asta da 30 mm con la punta
  const rod30 = T(T(T(s.rodAlongZ(30).rotate([0, 90, 0])).translate([0, 0, p.rodAF / 2])).translate([0, 14, 0]));
  parts.push(rod30);

  // tratto di barra con 2 sedi, orientato come nella stampa del coperchio
  const barW = 2 * d.pitch + 2;
  const barH = d.zLid - d.zBarBottom;
  const seatZ = d.lidT + (d.zLid - d.zAxis);
  let bar = box(0, barW, 0, d.seatDepth + d.barBackWall, 0, d.lidT + barH);
  const seats = union2([hexCS(d.seatAC / 2, 1 + d.pitch / 2, seatZ), hexCS(d.seatAC / 2, 1 + 1.5 * d.pitch, seatZ)]);
  bar = T(bar.subtract(extY(seats, -1, d.seatDepth)));
  parts.push(T(bar.translate([40, 0, 0])));

  // tratto di binario da 3 anelli, con la tacca frontale
  const chLen = 3 * p.ringL + 2;
  const halfW = d.chR + d.rib;
  let ch = union([box(-halfW, halfW, 0, d.frontT + chLen, 0, d.ribTop), box(-halfW, halfW, 0, d.frontT, 0, d.frontTop)]);
  const groove = union2([circ(d.chR, 0, d.floor + d.chR), rect(-d.chR, d.chR, d.floor + d.chR, d.ribTop + 1)]);
  ch = T(ch.subtract(extY(groove, d.frontT, d.frontT + chLen + 1)));
  const notch = union2([circ(d.notchW / 2, 0, d.zAxis, 48), rect(-d.notchW / 2, d.notchW / 2, d.zAxis, d.frontTop + 1)]);
  ch = T(ch.subtract(extY(notch, -1, d.frontT + 0.01)));
  parts.push(T(ch.translate([80, 0, 0])));

  // nocca di cerniera print in place: L | B | L, stessa sezione della scatola
  const yH = d.yHinge;
  const zH = d.zHinge;
  const g = p.hingeClearance;
  const bw = 4.5;
  const lw = 5;
  const baseMini = union([
    box(-bw - g - lw, bw + g + lw, yH - 14, yH - 0.15, 0, d.floor),
    extX(s.baseKnuckleCS, -bw, bw),
    coneX(bw - 0.2, bw + d.coneR, yH, zH, d.coneR + 0.2, 0),
    coneX(-bw + 0.2, -bw - d.coneR, yH, zH, d.coneR + 0.2, 0),
  ]);
  const socketR = d.coneR + g * Math.SQRT2;
  let lidMini = union([
    box(-bw - g - lw, bw + g + lw, yH - 14, yH - 0.15, d.zLid, d.H),
    extX(s.lidKnuckleCS, -bw - g - lw, -bw - g),
    extX(s.lidKnuckleCS, bw + g, bw + g + lw),
  ]);
  lidMini = T(lidMini.subtract(union([
    coneX(bw - 0.5, bw + socketR, yH, zH, socketR + 0.5, 0),
    coneX(-bw + 0.5, -bw - socketR, yH, zH, socketR + 0.5, 0),
  ])));
  // il "coperchio" di prova finisce prima della barra: ne teniamo solo il pezzo vicino alla cerniera
  const lidMiniPrint = openLid(s, lidMini, 180);
  const hingeTest = T(Manifold.compose([baseMini, lidMiniPrint]));
  parts.push(T(hingeTest.translate([140, -yH + 14, 0])));

  return T(Manifold.compose(parts));
}

// Stampa prova in un solo piatto: scatola mini aperta a 180°, accanto un'asta
// distesa e un anello in piedi. `s` sono i solidi costruiti con i parametri MINI.
export function buildMiniPlate(s) {
  const { d, T } = s;
  const { Manifold } = s.wasm;
  const box = T(Manifold.compose([s.base, openLid(s, s.lid, 180)]));
  const bb = box.boundingBox();
  const gap = 5;

  // distesa su una faccia come nel piatto delle aste, poi girata lungo Y
  const rodFlat = T(T(T(s.rodZ.rotate([0, 90, 0])).translate([0, 0, d.p.rodAF / 2])).rotate([0, 0, 90]));
  const rb = rodFlat.boundingBox();
  const rod = T(rodFlat.translate([bb.max[0] + gap - rb.min[0], bb.min[1] + gap - rb.min[1], 0]));
  const rodBox = rod.boundingBox();
  const xRod = (rodBox.min[0] + rodBox.max[0]) / 2;
  const ring = T(s.ringZ.translate([xRod, rodBox.max[1] + gap + d.p.ringD / 2, 0]));

  return T(Manifold.compose([box, rod, ring]));
}

// Modello per il viewer e per l'esportazione.
export function buildModel(wasm, params) {
  const s = buildSolids(wasm, params);
  const sm = buildSolids(wasm, { ...params, ...MINI });
  try {
    const layouts = buildPrintLayouts(s);
    const mini = buildMiniPlate(sm);
    const parts = [
      { id: 'scatola', name: 'Scatola print in place', color: BOX_COLOR, file: 'scatola.stl', qty: 1,
        print: meshData(layouts.box), stats: stats(layouts.box),
        note: 'Base, coperchio, barra e cerniera in un unico pezzo, aperto a 180°.' },
      { id: 'anelli', name: 'Anelli (piatto da 10)', color: COLORS[0].hex, file: 'anelli_x10.stl', qty: 4,
        print: meshData(layouts.rings10), stats: stats(layouts.rings10),
        note: 'Un piatto per colore: 4 piatti da 10 (o tutti insieme con l\'AMS).' },
      { id: 'anello', name: 'Anello singolo', color: COLORS[2].hex, file: 'anello.stl', qty: 40,
        print: meshData(layouts.ring), stats: stats(layouts.ring), note: 'In piedi, foro verticale.' },
      { id: 'aste', name: 'Aste (piatto da 6)', color: ROD_COLOR, file: 'aste_x6.stl', qty: 1,
        print: meshData(layouts.rods6), stats: stats(layouts.rods6), note: 'Distese su una faccia dell\'esagono.' },
      { id: 'asta', name: 'Asta singola', color: ROD_COLOR, file: 'asta.stl', qty: 6,
        print: meshData(layouts.rod), stats: stats(layouts.rod), note: 'Distesa su una faccia.' },
      { id: 'prova', name: 'Piatto di prova', color: '#c9c3b8', file: 'piatto_di_prova.stl', qty: 1,
        print: meshData(layouts.testPlate), stats: stats(layouts.testPlate),
        note: '3 anelli, spezzone d\'asta, 2 sedi, binario da 3, nocca di cerniera.' },
      { id: 'mini', name: 'Stampa prova', color: BOX_COLOR, file: 'stampa_prova.stl', qty: 1,
        print: meshData(mini), stats: stats(mini),
        note: 'Scatola mini da 3 binari × 3 anelli, un\'asta e un anello, tutto in un piatto.' },
    ];
    return {
      dims: s.d,
      miniDims: sm.d,
      params: { ...params },
      meshes: {
        base: meshData(s.base),
        lid: meshData(s.lid),
        rod: meshData(s.rod),
        ring: meshData(s.ring),
        magnet: meshData(s.magnet),
      },
      stats: { base: stats(s.base), lid: stats(s.lid), rod: stats(s.rod), ring: stats(s.ring) },
      parts,
    };
  } finally {
    s.dispose();
    sm.dispose();
  }
}
