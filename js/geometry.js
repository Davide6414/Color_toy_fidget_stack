// Geometria parametrica del gioco ordina-colori, costruita con manifold-3d:
// booleane CSG esatte con mesh sempre chiuse (manifold), quindi STL pronti per
// Bambu Studio. Gira nel browser (import map) e in Node (node_modules).
import Module from 'manifold-3d';
import { computeDims, MINI, COLORS, BOX_COLOR, ROD_COLOR } from './params.js';

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
  // tronco di cono lungo +Y (y1 > y0)
  const coneY = (y0, y1, x, z, r0, r1) =>
    T(T(T(Manifold.cylinder(y1 - y0, r0, r1, seg)).rotate([-90, 0, 0])).translate([x, y0, z]));
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

  // Fermo a 90° (vedi params.js). Punti in coordinate polari attorno all'asse
  // della cerniera, nel piano YZ: angolo 0 = dietro l'asse, -90 = sotto.
  const st = d.stop;
  const deg = 180 / Math.PI;
  const pol = (r, a) => [yH + r * Math.cos(a / deg), zH + r * Math.sin(a / deg)];
  const pol3 = (r, a, x) => [x, ...pol(r, a)];
  const xTip = LH - st.depth;                      // punta del dentino, dentro il percorso della guancia

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

  // Linguetta del fermo: la pelle interna della parete, libera dietro, in fondo
  // e sotto (staccata dal fondo); in punta il dentino sotto l'asse della cerniera,
  // con la faccia di battuta sul piano verticale dell'asse.
  const beamEnd = yH + 0.3;
  const stopSlots = union([
    box(IH + st.beamT, IH + st.beamT + st.beamGap, yH - st.beamL, beamEnd + st.endSlot, -1, d.H + 1),
    box(IH - 0.01, IH + st.beamT + 0.01, beamEnd, beamEnd + st.endSlot, -1, d.H + 1),
  ]);
  const stopNub = extX(poly([pol(st.r[0], -90 - st.ang), pol(st.r[1], -90 - st.ang), pol(st.r[1], -90), pol(st.r[0], -90)]), xTip, IH + 0.5);
  const stopBeam = box(IH, IH + st.beamT, yH - st.beamL + 1, beamEnd, 0, d.H);

  let sideRight = extX(sideCS, IH, OH);
  sideRight = T(sideRight.subtract(extY(camTri(1), -1, d.yRear + 1)));
  sideRight = T(sideRight.subtract(dimpleRight));
  sideRight = T(T(sideRight.subtract(stopSlots)).add(stopNub));
  const sideLeft = mirrorX(sideRight);

  const floorFree = box(IH - st.floorGap, IH + st.beamT + 0.01, yH - st.beamL + 0.5, beamEnd + st.endSlot, -1, d.floor + 1);
  const floor = T(box(-IH - 0.5, IH + 0.5, 0, yH - 0.15, 0, d.floor).subtract(union([
    box(LH - d.cheekW - g, IH + 0.01, yH - d.cheekY - g, yH + 1, -1, d.floor + 1),
    box(-IH - 0.01, -LH + d.cheekW + g, yH - d.cheekY - g, yH + 1, -1, d.floor + 1),
    floorFree, mirrorX(floorFree),
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
  // tacca: fondo concentrico all'asse e invito a 45° in cima, che raccoglie la
  // coda dell'asta quando il coperchio si chiude
  const notchAt = (x) => {
    const w = d.notchW / 2;
    const nl = d.notchLead;
    return [
      circ(w, x, d.zAxis, 48),
      rect(x - w, x + w, d.zAxis, d.frontTop + 1),
      poly([[x - w, d.frontTop - nl], [x + w, d.frontTop - nl], [x + w + nl + 1, d.frontTop + 1], [x - w - nl - 1, d.frontTop + 1]]),
    ];
  };
  const notchCS = union2(d.chX.flatMap(notchAt));
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

  // Guance posteriori del coperchio (dietro-sopra l'asse): a 90° la loro faccia
  // inferiore batte sul dentino del fermo.
  const topDz = d.H - zH;
  const cut = d.cheekCut;
  const cheekPts = [[yH - 0.5, zH], [yH + d.cheekY, zH]];
  if (cut - d.cheekY < topDz) {
    cheekPts.push([yH + d.cheekY, zH + cut - d.cheekY], [yH + cut - topDz, d.H]);
  } else {
    cheekPts.push([yH + d.cheekY, d.H]);
  }
  cheekPts.push([yH - 0.5, d.H]);
  const cheekRight = extX(poly(cheekPts), LH - d.cheekW, LH);
  // Sotto la guancia, rientrato rispetto alla punta del dentino, il supporto del
  // rilievo che scatta a 90°; il rilievo ha fianchi a 45° nel verso di rotazione.
  const xTab = xTip - st.tabClr;
  const xBump = xTip + st.bump;
  const stopTab = extX(poly([pol(3.2, 0), pol(st.r[1] + 0.6, 0), pol(st.r[1] + 0.6, -45), pol(3.2, -45)]), LH - d.cheekW, xTab);
  const a1 = -(st.ang + st.bumpClr);              // inizio del rilievo all'altezza della punta del dentino
  const a2 = a1 - st.bumpW;
  const bumpPts = [st.r[0] - 0.3, st.r[1] + 0.3].flatMap((r) => [
    pol3(r, a1 + (st.tabClr / r) * deg, xTab - 0.01), pol3(r, a1 - (st.bump / r) * deg, xBump),
    pol3(r, a2 + (st.bump / r) * deg, xBump), pol3(r, a2 - ((st.bump + st.tabClr) / r) * deg, xTab - 0.01),
  ]);
  const stopBump = hull(bumpPts);
  lidParts.push(cheekRight, mirrorX(cheekRight), stopTab, mirrorX(stopTab), stopBump, mirrorX(stopBump));
  // Tasca dove sta il dentino nella stampa a 180°, con lo scivolo che alla prima
  // chiusura spinge di lato la linguetta.
  const pa = (st.pocketClr / st.r[0]) * deg;
  const lo = 90 - st.ang - pa;
  const hi = 90 + pa;
  const xIn = xTip - st.pocketClr;
  // fuori 0,2 in più: la tasca è un poliedro e sulle corde perde gioco
  const pocketPts = [st.r[0] - st.pocketClr, st.r[1] + st.pocketClr + 0.2].flatMap((r) => [
    pol3(r, hi, xIn), pol3(r, hi, LH + 0.5), pol3(r, lo, xIn), pol3(r, lo, LH + 0.5),
    pol3(r, lo - ((LH - xIn) / r) * deg, LH + 0.01), pol3(r, lo - ((LH - xIn) / r) * deg, LH + 0.5),
  ]);
  const stopPocket = hull(pocketPts);

  // Linguette elastiche della chiusura frontale (nel piano del coperchio).
  const tongueSlots = union([
    box(LH - t.b - t.slot, LH - t.b, t.y0 - t.slot, t.y1, d.zLid - 0.01, d.H + 1),
    box(LH - t.b - t.slot, LH + 1, t.y0 - t.slot, t.y0, d.zLid - 0.01, d.H + 1),
  ]);
  const nubRight = hull([...rectPts(LH - 0.01, -0.01), ...rectPts(LH + t.nub, t.nub)]);
  lidParts.push(nubRight, mirrorX(nubRight));

  // Incavo per il pollice sul bordo frontale.
  const thumb = coneX(-10, 10, -1.5, d.H + 1.5, 4, 4);

  // Archi nella gonna sopra ogni tacca, smussati sulle due facce: a 90° la gonna
  // sta in cima alle aste e gli anelli devono passarci sotto per uscire.
  const ac = d.archChamfer;
  const arches = d.chX.flatMap((x) => [
    coneY(-1, d.frontT + 1, x, d.zAxis, d.archR, d.archR),
    coneY(-0.01, ac, x, d.zAxis, d.archR + ac + 0.01, d.archR),
    coneY(d.frontT - ac, d.frontT + 0.01, x, d.zAxis, d.archR, d.archR + ac + 0.01),
  ]);

  // Scatto delle aste nella sede (vedi params.js): linguetta nel piano del
  // coperchio, pilastrino nel vano della barra, dentino sulla faccia dell'asta.
  const dt = d.detent;
  const detentCuts = [];
  const detentParts = [];
  const detentMoving = [];
  d.chX.forEach((xc, i) => {
    const sg = d.detentSide[i];
    const xIn = xc + sg * (d.seatAF / 2);           // piano della faccia della sede
    const xOut = xIn + sg * dt.w;
    const bx = (x0, x1, y0, y1, z0, z1) => box(Math.min(x0, x1), Math.max(x0, x1), y0, y1, z0, z1);
    const [py0, py1] = dt.postY;
    const s0 = xIn - sg * dt.slot;
    const s1 = xOut + sg * dt.slot;
    detentCuts.push(
      bx(s0, xIn, dt.yRoot, dt.yTip + dt.slot, d.zLid - dt.relief, d.H + 1),
      bx(xOut, s1, dt.yRoot, dt.yTip + dt.slot, d.zLid - dt.relief, d.H + 1),
      bx(s0, s1, dt.yTip, dt.yTip + dt.slot, d.zLid - dt.relief, d.H + 1),
      // gioco tra la linguetta e la barra
      bx(s0, s1, d.yBarFront - 0.1, dt.yTip + dt.slot, d.zLid - dt.relief, d.zLid + 0.01),
      // vano del pilastrino: aperto verso la sede in alto e sotto la barra in basso
      bx(xIn - sg * dt.clrIn, xOut + sg * dt.clrOut, py0 - dt.clrY, py1 + dt.clrY, dt.postZ0 - 0.3, d.zLid + 0.01),
      bx(xIn - sg * dt.clrIn, xOut + sg * dt.clrOut, py0 - dt.clrY, py1 + dt.clrY, d.zBarBottom - 1, dt.postZ0 - 0.3 + 0.01),
    );
    const post = bx(xIn, xOut, py0, py1, dt.postZ0, d.zLid + 0.01);
    // dentino: prisma verticale con profilo a trapezio nel piano XY (fianchi a 35°);
    // la punta resta più stretta del fondo della gola qualunque sia la sporgenza
    const reach = d.seatAF / 2 - dt.nubTip;
    const yc = dt.nubY;
    const half1 = dt.nubHalfTip;
    const half0 = Math.min(Math.min(yc - py0, py1 - yc) - 0.2, half1 + reach / Math.tan((dt.nubAng * Math.PI) / 180));
    const nubPts = [];
    for (const z of dt.nubZ) {
      nubPts.push([xIn + sg * 0.01, yc - half0, z], [xIn + sg * 0.01, yc + half0, z],
        [xIn - sg * reach, yc - half1, z], [xIn - sg * reach, yc + half1, z]);
    }
    // smusso a 45° sopra il dentino: in stampa è il lato sotto, niente sbalzo piatto
    const zc = dt.nubZ[1] + reach;
    nubPts.push([xIn + sg * 0.01, yc - Math.max(0.05, half0 - reach), zc], [xIn + sg * 0.01, yc + Math.max(0.05, half0 - reach), zc]);
    const nub = hull(nubPts);
    detentParts.push(post, nub);
    detentMoving.push(post, nub, bx(xIn, xOut, dt.yRoot + 1, dt.yTip, d.zLid, d.H));
  });

  let lid = union(lidParts);
  lid = T(lid.subtract(union([...sockets, tongueSlots, mirrorX(tongueSlots), thumb, ...arches, ...detentCuts, stopPocket, mirrorX(stopPocket)])));
  lid = T(lid.add(union(detentParts)));
  const detentNubs = union(detentParts.filter((_, k) => k % 2 === 1));

  // ============================================================ ASTE E ANELLI
  const rodAlongZ = (len) => {
    const r = d.rodAC / 2;
    const prism = T(Manifold.extrude(hexCS(r, 0, 0), len));
    const taper = T(Manifold.revolve([[
      [0, -0.01], [r - 0.4, -0.01], [r + 0.05, 0.45], [r + 0.05, len - p.rodTip], [0.9, len + 0.01], [0, len + 0.01],
    ]], 48));
    // gola esagonale dove scatta il dentino, con fianchi a 35°
    const nk = d.neck;
    const rN = nk.af / Math.sqrt(3);
    const flank = (p.rodAF - nk.af) / 2 / Math.tan((nk.ang * Math.PI) / 180);
    const za = len - nk.fromTip - nk.floor / 2;
    const zb = za + nk.floor;
    const slab = (rr, z) => T(T(Manifold.extrude(hexCS(rr, 0, 0), 0.001)).translate([0, 0, z]));
    const core = union([
      hull([slab(r + 0.01, za - flank), slab(rN, za)]),
      T(T(Manifold.extrude(hexCS(rN, 0, 0), nk.floor)).translate([0, 0, za])),
      hull([slab(rN, zb), slab(r + 0.01, zb + flank)]),
    ]);
    const neck = T(box(-r - 1, r + 1, -r - 1, r + 1, za - flank, zb + flank).subtract(core));
    return T(T(prism.intersect(taper)).subtract(neck));
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

  return {
    d, base, lid, rod, rodZ, ring, ringZ, rodAlongZ, detentNubs, detentMoving, notchAt,
    stopNubs: union([stopNub, mirrorX(stopNub)]), stopBumps: union([stopBump, mirrorX(stopBump)]),
    stopBeams: union([stopBeam, mirrorX(stopBeam)]),
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
  const { d, T, box, union, extX, extY, coneX, union2, circ, rect } = s;
  const { Manifold } = s.wasm;
  const p = d.p;
  const parts = [];

  // 3 anelli
  for (let k = 0; k < 3; k++) parts.push(T(s.ringZ.translate([k * (p.ringD + 4), 0, 0])));

  // spezzone d'asta da 30 mm con la punta
  const rod30 = T(T(T(s.rodAlongZ(30).rotate([0, 90, 0])).translate([0, 0, p.rodAF / 2])).translate([0, 14, 0]));
  parts.push(rod30);

  // ritaglio del coperchio vero con 2 sedi e i loro scatti (linguetta, pilastrino,
  // dentino), a faccia in giù come nella stampa della scatola
  const dt = d.detent;
  const sg1 = d.detentSide[1];
  const cx0 = d.chX[0] - d.seatAC / 2 - 1.5;
  const cx1 = d.chX[1] + sg1 * (d.seatAF / 2 + dt.w + dt.slot) + 0.8;
  let coupon = T(s.lid.intersect(box(Math.min(cx0, cx1), Math.max(cx0, cx1), dt.yRoot - 5, d.yBarBack - 0.2, -1, d.H + 1)));
  coupon = T(coupon.rotate([180, 0, 0]));
  const cb = coupon.boundingBox();
  parts.push(T(coupon.translate([40 - cb.min[0], -cb.min[1], -cb.min[2]])));

  // tratto di binario da 3 anelli, con la tacca frontale
  const chLen = 3 * p.ringL + 2;
  const halfW = d.chR + d.rib;
  let ch = union([box(-halfW, halfW, 0, d.frontT + chLen, 0, d.ribTop), box(-halfW, halfW, 0, d.frontT, 0, d.frontTop)]);
  const groove = union2([circ(d.chR, 0, d.floor + d.chR), rect(-d.chR, d.chR, d.floor + d.chR, d.ribTop + 1)]);
  ch = T(ch.subtract(extY(groove, d.frontT, d.frontT + chLen + 1)));
  ch = T(ch.subtract(extY(union2(s.notchAt(0)), -1, d.frontT + 0.01)));
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
      },
      stats: { base: stats(s.base), lid: stats(s.lid), rod: stats(s.rod), ring: stats(s.ring) },
      parts,
    };
  } finally {
    s.dispose();
    sm.dispose();
  }
}
