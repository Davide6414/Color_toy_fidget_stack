// Geometria parametrica dei pezzi, costruita con manifold-3d (booleane CSG
// che garantiscono mesh chiuse e "manifold", quindi STL pronti per lo slicer).
// Funziona sia nel browser (import map) sia in Node (node_modules).

import Module from 'manifold-3d';
import { computeDims, DISCS, BASE_INFO, CAP_INFO } from './params.js';

const DEG = Math.PI / 180;

let wasmPromise = null;
export function loadManifold() {
  wasmPromise ??= Module().then((wasm) => { wasm.setup(); return wasm; });
  return wasmPromise;
}

const polar = (r, aDeg) => [r * Math.cos(aDeg * DEG), r * Math.sin(aDeg * DEG)];

// Settore di corona circolare (antiorario).
function sectorPoints(r0, r1, a0, a1, stepDeg = 1) {
  const n = Math.max(2, Math.ceil((a1 - a0) / stepDeg));
  const outer = [];
  const inner = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push(polar(r1, a));
    inner.push(polar(r0, a));
  }
  return [...outer, ...inner.reverse()];
}

// Costruisce tutti i solidi. Restituisce oggetti Manifold "vivi": chi chiama
// deve invocare dispose() quando ha finito (la memoria è nel heap WASM).
export function buildSolids(wasm, params) {
  const { Manifold, CrossSection } = wasm;
  const d = computeDims(params);
  const pool = [];
  const T = (o) => { pool.push(o); return o; };

  const circle = (r, [x, y] = [0, 0], seg = d.seg) =>
    T(T(CrossSection.circle(r, seg)).translate([x, y]));
  const annulus = (r0, r1) => T(circle(r1).subtract(circle(r0)));
  const poly = (pts) => T(new CrossSection([pts]));
  const extrude = (cs, h, z = 0) => T(T(Manifold.extrude(cs, h)).translate([0, 0, z]));
  const unionCS = (list) => T(CrossSection.union(list));

  // ---------------------------------------------------------------- Base
  const baseProfile = [
    [d.boreWideR, 0],
    [d.baseR - d.baseBottomChamfer, 0],
    [d.baseR, d.baseBottomChamfer],
    [d.baseR, d.baseH - d.baseTopChamfer],
    [d.baseR - d.baseTopChamfer, d.baseH],
    [d.ridgeR1, d.baseH],
    [d.ridgeR1, d.baseH + d.ridgeH],
    [d.ridgeR0, d.baseH + d.ridgeH],
    [d.ridgeR0, d.baseH],
    [d.hubR, d.baseH],
    [d.hubR, d.hubTop - d.hubChamfer],
    [d.hubR - d.hubChamfer, d.hubTop],
    [d.boreNarrowR + d.boreChamfer, d.hubTop],
    [d.boreNarrowR, d.hubTop - d.boreChamfer],
    [d.boreNarrowR, d.ledgeZ],
    [d.boreWideR, d.wideTopZ],
  ];
  const baseBody = T(Manifold.revolve([baseProfile], d.seg));
  const grooves2d = unionCS(
    Array.from({ length: d.positions }, (_, k) =>
      circle(d.grooveR, polar(d.hubR + d.grooveOffset, k * d.step), 32)),
  );
  const grooveZ0 = d.baseH + 0.2;
  const base = T(baseBody.subtract(extrude(grooves2d, d.hubTop + 1 - grooveZ0, grooveZ0)));

  // -------------------------------------------------------------- Dischi
  const nubOffset = (d.nubR + 0.35) / d.nubCenterR / DEG; // dentino ↔ taglio
  const cutAng = d.cutW / d.boreR / DEG;
  const armSplitBack = 12; // gradi vicino alla radice che restano col corpo

  const arms = [0, 180].map((aNub) => {
    const aFree = aNub - nubOffset;
    const pivotAngle = aFree + d.armSpan - armSplitBack;
    const pivot = [...polar((d.boreR + d.slotR0) / 2, pivotAngle), 0];
    const tip = polar(d.nubCenterR, aNub);
    return {
      aNub, aFree, pivot,
      lever: Math.hypot(tip[0] - pivot[0], tip[1] - pivot[1]),
    };
  });

  let inner2d = annulus(d.boreR, d.hubZoneR);
  for (const arm of arms) {
    const slotMid = (d.slotR0 + d.slotR1) / 2;
    const slot = poly(sectorPoints(d.slotR0, d.slotR1, arm.aFree - cutAng, arm.aFree + d.armSpan));
    const slotEnd = circle((d.slotR1 - d.slotR0) / 2, polar(slotMid, arm.aFree + d.armSpan), 32);
    const cut = poly(sectorPoints(d.boreR - 1, d.slotR1, arm.aFree - cutAng, arm.aFree, 0.25));
    inner2d = T(T(T(inner2d.subtract(slot)).subtract(slotEnd)).subtract(cut));
    inner2d = T(inner2d.add(circle(d.nubR, polar(d.nubCenterR, arm.aNub), 48)));
  }
  const discInner = extrude(inner2d, d.discT);

  const outerProfile = [
    [d.hubZoneR - 0.5, 0],
    [d.discR - 0.4, 0],
    [d.discR, 0.4],
    [d.discR, d.discT - 0.5],
    [d.discR - 0.5, d.discT],
    [d.rimR0, d.discT],
    [d.rimR0, d.filterT],
    [d.hubZoneR - 0.5, d.filterT],
  ];
  const discOuter = T(Manifold.revolve([outerProfile], d.seg));
  const ridge = extrude(annulus(d.ridgeR0, d.ridgeR1), d.ridgeH + 0.5, d.discT - 0.5);
  const grips2d = unionCS(
    Array.from({ length: d.gripCount }, (_, j) =>
      circle(d.gripR, polar(d.discR + d.gripR - d.gripDepth, (j + 0.5) * (360 / d.gripCount)), 32)),
  );
  const discBlank = T(T(T(discInner.add(discOuter)).add(ridge)).subtract(extrude(grips2d, d.discT + 2, -1)));

  const armRegion = extrude(
    unionCS(arms.map((arm) => poly(sectorPoints(
      d.hubR - d.nubDepth - 0.4, (d.slotR0 + d.slotR1) / 2,
      arm.aFree - cutAng / 2, arm.aFree + d.armSpan - armSplitBack, 0.5)))),
    d.discT + 2, -1,
  );

  const discs = DISCS.map((spec) => {
    const { count, width, start } = spec.windows;
    const windows2d = unionCS(
      Array.from({ length: count }, (_, j) => {
        const a = start + (j * 360) / count;
        const raw = poly(sectorPoints(d.windowR0, d.windowR1, a, a + width));
        return T(T(raw.offset(-d.windowFillet, 'Miter')).offset(d.windowFillet, 'Round', 2, 48));
      }),
    );
    const full = T(discBlank.subtract(extrude(windows2d, d.filterT + 2, -1)));
    const armSolids = T(full.intersect(armRegion)).decompose().map(T);
    const body = T(full.subtract(armRegion));
    return { spec, full, body, armSolids };
  });

  // ---------------------------------------------------------- Cappuccio
  const capProfile = [
    [d.pinInnerR, d.tipZ],
    [d.tipR, d.tipZ],
    [d.barbR, d.barbLowZ],
    [d.barbR, d.barbHighZ],
    [d.pinR, d.barbTopZ],
    [d.pinR, -d.pinFillet],
    [d.pinR + d.pinFillet, 0],
    [d.capR - 0.6, 0],
    [d.capR, 0.6],
    [d.capR, d.capH - 1.0],
    [d.capR - 1.0, d.capH],
    [0, d.capH],
    [0, 1.0],
    [d.pinInnerR, 1.0],
  ];
  let cap = T(Manifold.revolve([capProfile], d.seg));
  // Anello decorativo a V sulla faccia superiore
  const vRing = [[10.4, d.capH + 0.1], [11.0, d.capH - 0.5], [11.6, d.capH + 0.1]];
  cap = T(cap.subtract(T(Manifold.revolve([vRing], d.seg))));
  const knurls2d = unionCS(
    Array.from({ length: d.knurlCount }, (_, j) =>
      circle(d.knurlR, polar(d.capR + 0.35, (j * 360) / d.knurlCount), 24)),
  );
  cap = T(cap.subtract(extrude(knurls2d, d.capH + 2, -1)));
  // Due tagli incrociati → 4 alette elastiche
  const slotLen = 2 * (d.barbR + 1);
  const slotH = d.fingerRootZ - (d.tipZ - 1);
  const slotA = T(T(T(Manifold.cube([slotLen, d.slotW, slotH], true))
    .translate([0, 0, (d.fingerRootZ + d.tipZ - 1) / 2]))
    .add(T(T(T(Manifold.cylinder(slotLen, d.slotW / 2, d.slotW / 2, 24, true)).rotate([0, 90, 0]))
      .translate([0, 0, d.fingerRootZ]))));
  const slots = T(slotA.add(T(slotA.rotate([0, 0, 90]))));
  cap = T(cap.subtract(slots));

  const fingerRegion = T(T(Manifold.cylinder(d.fingerRootZ - d.tipZ + 1, d.barbR + 0.5, d.barbR + 0.5, 48))
    .translate([0, 0, d.tipZ - 1]));
  const fingerSolids = T(cap.intersect(fingerRegion)).decompose().map(T);
  const capBody = T(cap.subtract(fingerRegion));

  const fingerLever = d.fingerRootZ - (d.barbLowZ + d.barbHighZ) / 2;

  return {
    d,
    base,
    discs,
    arms,
    cap,
    capBody,
    fingerSolids,
    fingerLever,
    dispose() { for (const o of pool) o.delete(); pool.length = 0; },
  };
}

// Mesh "piatta" (posizioni + indici) da un Manifold, con trasformazione opzionale.
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

function stats(manifold) {
  const box = manifold.boundingBox();
  return {
    volume: manifold.volume(),
    triangles: manifold.numTri(),
    size: [0, 1, 2].map((i) => box.max[i] - box.min[i]),
    status: manifold.status(),
  };
}

// Pivot di un'aletta: alla radice, a metà spessore, sulla bisettrice.
function fingerPivot(solid, d) {
  const box = solid.boundingBox();
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const beta = Math.atan2(cy, cx);
  const rc = (d.pinR + d.pinInnerR) / 2;
  return { pivot: [rc * Math.cos(beta), rc * Math.sin(beta), d.fingerRootZ], beta };
}

// Modello completo pronto per il viewer e per l'esportazione.
// Ogni parte ha: mesh intera (coordinate locali), mesh in orientamento di
// stampa, pezzi separati per le animazioni (bracci, alette) e statistiche.
export function buildModel(wasm, params) {
  const s = buildSolids(wasm, params);
  const { d } = s;
  try {
    const parts = [];
    parts.push({
      ...BASE_INFO, kind: 'base', z: 0,
      full: meshData(s.base),
      print: meshData(s.base),
      pieces: [{ kind: 'body', mesh: meshData(s.base) }],
      stats: stats(s.base),
    });
    s.discs.forEach(({ spec, full, body, armSolids }, i) => {
      const pieces = [{ kind: 'body', mesh: meshData(body) }];
      for (const solid of armSolids) {
        // il braccio a 0° sta nel semipiano x > 0, quello a 180° in x < 0
        const box = solid.boundingBox();
        const arm = box.min[0] + box.max[0] >= 0 ? s.arms[0] : s.arms[1];
        pieces.push({ kind: 'arm', mesh: meshData(solid), pivot: arm.pivot, lever: arm.lever });
      }
      parts.push({
        ...spec, kind: 'disc', index: i, z: d.discZ[i],
        full: meshData(full), print: meshData(full), pieces, stats: stats(full),
      });
    });
    const capFlipped = s.cap.rotate([180, 0, 0]);
    const capPrint = capFlipped.translate([0, 0, d.capH]);
    capFlipped.delete();
    const capPieces = [{ kind: 'body', mesh: meshData(s.capBody) }];
    for (const solid of s.fingerSolids) {
      const { pivot, beta } = fingerPivot(solid, d);
      capPieces.push({ kind: 'finger', mesh: meshData(solid), pivot, beta, lever: s.fingerLever });
    }
    parts.push({
      ...CAP_INFO, kind: 'cap', z: d.hubTop,
      full: meshData(s.cap), print: meshData(capPrint), pieces: capPieces, stats: stats(s.cap),
    });
    capPrint.delete();
    return { dims: d, params: { ...params }, parts };
  } finally {
    s.dispose();
  }
}
