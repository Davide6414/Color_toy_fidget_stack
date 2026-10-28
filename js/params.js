// Gioco ordina-colori: parametri primari e quote derivate.
// Unità: millimetri. Sistema di riferimento CAD: X larghezza (centrata),
// Y dalla faccia frontale (Y = 0) verso la cerniera, Z in alto (Z = 0 piano).
// Modulo senza dipendenze: lo usano il browser e gli script Node in tools/.

export const DEFAULT_PARAMS = {
  ringD: 8,              // diametro esterno anello
  ringL: 10,             // lunghezza anello
  ringChamfer: 0.6,      // smusso esterno sui due bordi
  holeChamfer: 0.3,      // invito sul foro (aiuta la punta dell'asta)
  rodAF: 4,              // esagono dell'asta, misura tra le facce
  slideClearance: 0.3,   // gioco radiale anello–asta
  seatClearance: 0.125,  // gioco per lato asta–sede nella barra
  hingeClearance: 0.3,   // gioco della cerniera print in place
  channels: 6,           // numero di binari (= aste)
  capacity: 10,          // anelli per asta
  rodTail: 5,            // sporgenza della coda dalla parete frontale
  rodTip: 3,             // lunghezza della punta conica
  segments: 64,          // risoluzione dei cerchi
};

export const PARAM_SPECS = [
  { key: 'slideClearance', label: 'Gioco anello ↔ asta', min: 0.2, max: 0.45, step: 0.05, unit: 'mm',
    help: 'Radiale. Più alto se gli anelli scorrono duri sulle aste.' },
  { key: 'seatClearance', label: 'Gioco asta ↔ sede', min: 0.05, max: 0.25, step: 0.025, unit: 'mm',
    help: 'Per lato. Le aste devono entrare a mano ma restare in piedi.' },
  { key: 'hingeClearance', label: 'Gioco cerniera', min: 0.2, max: 0.5, step: 0.05, unit: 'mm',
    help: 'Se la cerniera esce saldata dalla stampa, aumentalo.' },
  { key: 'rodTail', label: 'Sporgenza coda asta', min: 4, max: 10, step: 1, unit: 'mm',
    help: 'Presa per sfilare le aste. Allunga anche le aste.' },
  { key: 'ringChamfer', label: 'Smusso anelli', min: 0.3, max: 0.8, step: 0.1, unit: 'mm',
    help: 'Assorbe lo schiacciamento del primo strato.' },
  { key: 'capacity', label: 'Anelli per asta', min: 6, max: 10, step: 1, unit: '',
    help: 'Cambia lunghezza di scatola, binari e aste. Oltre 10 la scatola aperta non sta sul piatto della P1S.' },
  { key: 'segments', label: 'Risoluzione cerchi', min: 32, max: 128, step: 16, unit: 'seg',
    help: 'Lati dei cerchi negli STL.' },
];

// Colori come nelle foto del Color Stack originale.
export const COLORS = [
  { id: 'rosa', name: 'Rosa', hex: '#ef4f95' },
  { id: 'verde', name: 'Verde', hex: '#86d03b' },
  { id: 'giallo', name: 'Giallo', hex: '#f8d12d' },
  { id: 'blu', name: 'Blu', hex: '#3b8fe3' },
];

// Stampa prova: la stessa scatola con 3 binari da 3 anelli. Giochi, anelli,
// aste, cerniera e magneti restano a misura vera: in scala 1:2 l'asta sarebbe
// un esagono da 2 mm e i 6 × 3 mm non entrerebbero nelle pareti. Con meno di 3
// binari le guance dei magneti finiscono sopra le nocche della base.
export const MINI = { channels: 3, capacity: 3 };

export const BOX_COLOR = '#9ed4ee';
export const ROD_COLOR = '#b9e2f5';
export const MAGNET = { d: 6, h: 3, clearance: 0.1, skin: 0.6 };
export const LAYER = 0.2;

const COS30 = Math.cos(Math.PI / 6);
const ceilTo = (v, step) => Math.ceil(Math.round((v / step) * 1e6) / 1e6) * step;

export function computeDims(p) {
  const d = { p: { ...p }, seg: p.segments };

  // Anelli e aste
  d.rodAC = p.rodAF / COS30;                       // 4,62 tra gli spigoli
  d.hole = d.rodAC + 2 * p.slideClearance;         // foro anello = spigoli + 2 × gioco
  d.ringWall = (p.ringD - d.hole) / 2;
  // i due smussi non devono mangiarsi la parete dell'anello
  d.ringChamfer = Math.min(p.ringChamfer, d.ringWall - 0.5);
  d.holeChamfer = Math.max(0, Math.min(p.holeChamfer, d.ringWall - d.ringChamfer - 0.3));

  // Binari
  d.chR = p.ringD / 2 + 0.3;                       // raggio binario = D/2 + 0,3
  d.chW = 2 * d.chR;
  d.rib = 1.6;
  d.pitch = d.chW + d.rib;
  d.floor = 1.2;
  d.protrusion = 2;                                // l'anello sporge 2 mm sopra il bordo
  d.chDepth = p.ringD - d.protrusion;
  d.headroom = (p.ringD + p.ringL) / 2;            // spazio sopra le costole
  d.chLen = p.capacity * p.ringL + 2;              // lunghezza binario
  d.n = p.channels;
  d.chX = Array.from({ length: d.n }, (_, i) => (i - (d.n - 1) / 2) * d.pitch);

  // Pareti
  d.frontT = 2;
  d.sideT = 4.4;                                   // contiene i magneti del fermo a 90°
  d.lidT = 3.8;
  d.innerHalf = (d.n * d.chW + (d.n - 1) * d.rib) / 2;
  d.lidHalf = d.innerHalf - p.hingeClearance;      // il coperchio sta tra le pareti laterali
  d.outerHalf = d.innerHalf + d.sideT;

  // Quote verticali
  d.ribTop = d.floor + d.chDepth;
  d.zAxis = d.floor + p.ringD / 2;                 // asse di anelli, aste, tacche e sedi
  d.zLid = d.ribTop + d.headroom;                  // faccia interna del coperchio
  d.H = d.zLid + d.lidT;
  d.zHinge = d.H / 2;                              // a metà altezza: stampa aperta a 180° in piano

  // Sedi, tacche, barra
  d.seatAF = p.rodAF + 2 * p.seatClearance;
  d.seatAC = d.seatAF / COS30;                     // ≈ 4,9 tra gli spigoli
  d.seatDepth = 8;
  d.notchW = d.seatAC;
  d.frontTop = d.zAxis + d.notchW / 2;             // il bordo del coperchio chiude le tacche
  d.yBarFront = d.frontT + d.chLen;
  d.ySeatBottom = d.yBarFront + d.seatDepth;
  d.barBackWall = 1.6;
  d.yBarBack = d.ySeatBottom + d.barBackWall;
  d.zBarBottom = d.floor + p.hingeClearance;
  d.barChamfer = 1.0;

  // Cerniera: nocche alternate coperchio/base dietro la barra
  d.coneR = 1.8;
  d.kR = Math.max(3.5, d.coneR + p.hingeClearance * Math.SQRT2 + 1.25);
  d.yHinge = d.yBarBack + d.kR + p.hingeClearance;
  const g = p.hingeClearance;
  const segW = (2 * d.innerHalf - 6 * g) / 5;
  d.knuckles = ['L', 'B', 'L', 'B', 'L'].map((kind, i) => {
    const x0 = -d.innerHalf + g + i * (segW + g);
    return { kind, x0, x1: x0 + segW };
  });

  // Fine dei binari: lo spigolo inferiore della barra ruota attorno all'asse
  // e deve passare sopra la testa delle costole.
  const yH = d.yHinge;
  const zH = d.zHinge;
  const rho = Math.max(
    Math.hypot(yH - d.yBarFront, zH - (d.zBarBottom + d.barChamfer)),
    Math.hypot(yH - (d.yBarFront + d.barChamfer), zH - d.zBarBottom),
  );
  d.yChEnd = yH - Math.sqrt((rho + 0.4) ** 2 - (zH - d.ribTop) ** 2);

  // Aste
  d.rodLen = p.rodTail + d.frontT + d.chLen + d.seatDepth;

  // Fermo a 90°: magneti con asse X. Coperchio dietro-sopra l'asse, base
  // dietro-sotto: a 90° coincidono. Le due sedi finiscono alla stessa quota di
  // stampa, quindi basta una pausa.
  const slotR = MAGNET.d / 2 + MAGNET.clearance;
  d.slotR = slotR;
  d.slotW = MAGNET.h + 2 * MAGNET.clearance;
  d.pauseZ = ceilTo(zH - 3.7 + slotR, LAYER);
  d.magA = zH + slotR - d.pauseZ;                  // distanza dall'asse lungo Y e Z
  d.magLid = { y: yH + d.magA, z: zH + d.magA };  // posizione a coperchio chiuso
  d.magBase = { y: yH + d.magA, z: zH - d.magA };
  d.magBaseX = d.innerHalf + MAGNET.skin + d.slotW / 2;
  d.magLidX = d.lidHalf - MAGNET.skin - d.slotW / 2;
  d.cheekW = 5;
  d.cheekY = 7.6;                                  // sporgenza dietro l'asse
  d.cheekCut = 2 * d.magA + (slotR + MAGNET.skin) * Math.SQRT2;
  d.yRear = yH + d.cheekY;

  // Chiusura frontale: linguette elastiche nel piano del coperchio
  d.tongue = { b: 2.5, slot: 0.8, y0: 3.0, y1: 24.0, nub: 0.8, nubY: [4.0, 8.0], nubZ: [d.zLid + 0.4, d.zLid + 2.6] };
  d.tongueStrain = (1.5 * d.tongue.b * (d.tongue.nub - p.hingeClearance)) / (d.tongue.y1 - 6) ** 2;
  d.camChamfer = 0.6;

  // Ingombri
  d.length = d.yRear;
  d.width = 2 * d.outerHalf;
  d.openLength = 2 * yH;
  return d;
}
