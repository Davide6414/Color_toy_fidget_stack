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
  rodDetent: 0.5,        // scatto delle aste: quanto il dentino nella sede flette sulla faccia dell'asta
  segments: 64,          // risoluzione dei cerchi
};

export const PARAM_SPECS = [
  { key: 'slideClearance', label: 'Gioco anello ↔ asta', min: 0.2, max: 0.45, step: 0.05, unit: 'mm',
    help: 'Radiale. Più alto se gli anelli scorrono duri sulle aste.' },
  { key: 'seatClearance', label: 'Gioco asta ↔ sede', min: 0.05, max: 0.25, step: 0.025, unit: 'mm',
    help: 'Per lato. Le aste devono entrare a mano ma restare in piedi.' },
  { key: 'hingeClearance', label: 'Gioco cerniera', min: 0.2, max: 0.5, step: 0.05, unit: 'mm',
    help: 'Se la cerniera esce saldata dalla stampa, aumentalo.' },
  { key: 'rodDetent', label: 'Scatto aste', min: 0.35, max: 0.7, step: 0.05, unit: 'mm',
    help: 'Quanto il dentino nella sede preme sull\'asta. Più alto se le aste escono da sole, più basso se si sfilano dure.' },
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
// aste, cerniera e fermi restano a misura vera: in scala 1:2 l'asta sarebbe
// un esagono da 2 mm e la cerniera uscirebbe saldata. Con meno di 3 binari le
// guance del coperchio finiscono sopra le nocche della base.
export const MINI = { channels: 3, capacity: 3 };

export const BOX_COLOR = '#9ed4ee';
export const ROD_COLOR = '#b9e2f5';
const COS30 = Math.cos(Math.PI / 6);

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
  d.sideT = 4.4;                                   // contiene la linguetta del fermo a 90°
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
  d.seatDepth = 12;                                // ~9,7 mm di esagono pieno oltre la punta: asta dritta a 90°
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

  // Archi nella gonna: a 90° gli anelli escono dalla coda dell'asta passando
  // sotto la gonna. Sopra la tacca resta una lunetta più bassa di un anello.
  d.archR = p.ringD / 2 + p.slideClearance + 0.5;
  d.archChamfer = 0.8;

  // Scatto delle aste. Un'asta in sede gira col coperchio a ogni apertura, quindi
  // lungo la coda (dove passano gli anelli) niente del coperchio può toccarla:
  // la presa è dentro la sede. Per ogni sede una linguetta nel piano del coperchio
  // (si flette in X, nel piano degli strati, come quelle di chiusura), un
  // pilastrino che scende nella barra e un dentino a 35° sulla faccia dell'asta,
  // che scatta in una gola esagonale vicino alla punta.
  const yTip = d.ySeatBottom - 5;
  d.detent = {
    w: 1.6, slot: 0.8, len: 20,                    // linguetta: larghezza in X, feritoie, lunghezza
    relief: 1.0,                                   // gioco sopra la barra: 5 strati interi, il ponte della barra parte su uno strato
    yRoot: yTip - 20, yTip,
    postY: [yTip - 4.6, yTip - 0.2], postZ0: d.zAxis - 1.3,   // pilastrino lungo in Y: meno sforzo tra gli strati
    nubY: yTip - 2,                                // centro del dentino, 0,3 mm oltre il centro della gola verso la punta
    clrIn: 0.5, clrOut: 1.0, clrY: 0.5,            // giochi del pilastrino nel vano (stampa); il vano si pulisce da sotto
    nubAng: 35, nubZ: [d.zAxis - 0.9, d.zAxis + 0.4], nubHalfTip: 0.23,
    nubTip: p.rodAF / 2 - p.seatClearance - p.rodDetent,   // punta del dentino dall'asse della sede
  };
  d.detentSide = d.chX.map((x) => (x <= 1e-9 ? 1 : -1)); // dentini verso il centro della scatola
  d.neck = { af: p.rodAF - 0.55, floor: 1.2, fromTip: 7.3, ang: 35 };
  d.notchLead = 0.5;                               // invito a 45° in cima alle tacche: la coda le trova chiudendo
  {
    // rigidezza al dentino: flessione e torsione della linguetta (carico all'altezza
    // del dentino), flessione del pilastrino
    const E = 3500;
    const G = 1300;
    const mu = 0.35;
    const t = d.detent;
    const zNub = (t.nubZ[0] + t.nubZ[1]) / 2;
    const postLen = t.postY[1] - t.postY[0];
    const Le = t.nubY - t.yRoot;
    const I = (d.lidT * t.w ** 3) / 12;
    const a = Math.max(d.lidT, t.w);
    const b = Math.min(d.lidT, t.w);
    const J = a * b ** 3 * (1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4)));
    const lever = d.zLid + d.lidT / 2 - zNub;
    const postL = d.zLid - zNub;
    const Ip = (postLen * t.w ** 3) / 12;
    d.detentLeff = Le;
    d.detentK = 1 / (Le ** 3 / (3 * E * I) + (lever ** 2 * Le) / (G * J) + postL ** 3 / (3 * E * Ip));
    const N = d.detentK * p.rodDetent;
    const phi = Math.atan(mu);
    const tanFlank = Math.tan((t.nubAng * Math.PI) / 180 + phi);
    d.detentPull = N * (tanFlank + mu);                                    // forza per sfilare l'asta
    d.detentDrag = 2 * mu * N;                                             // attrito finché il dentino è sulla faccia
    d.detentStrain = (N * 1.4 * Le * (t.w / 2)) / I / E;                   // alla radice, con N +40% di tolleranza
    // radice del pilastrino, attraverso gli strati: flessione in X (spinta) e in Y (tiro)
    d.detentPostStress = (N * postL * (t.w / 2)) / Ip + (N * tanFlank * postL * (postLen / 2)) / ((t.w * postLen ** 3) / 12);
  }

  // Guance posteriori del coperchio: la faccia inferiore passa per l'asse della
  // cerniera e a 90° batte sul dentino del fermo.
  d.cheekW = 5;
  d.cheekY = 7.6;                                  // sporgenza dietro l'asse
  d.cheekCut = 12.6;                               // smusso posteriore in alto: dy + dz ≤ cheekCut
  d.yRear = yH + d.cheekY;

  // Fermo a 90° a scatto, uno per lato. La pelle interna della parete laterale è
  // una linguetta (si flette in X, nel piano degli strati) con un dentino sotto
  // l'asse, nel percorso della guancia. Da 0° a 90° il dentino non tocca niente;
  // a 90° la faccia inferiore della guancia ci batte contro e la linguetta lavora
  // di punta: fermo rigido. Sotto la guancia un rilievo scatta sul dentino aprendo
  // e chiudendo, e tiene il coperchio a 90° nei due versi. La scatola si stampa
  // aperta a 180°: alla prima chiusura la guancia scavalca il dentino una volta
  // sola, poi non torna più oltre i 90°.
  d.stop = {
    r: [4.5, 7.0],              // dentino: distanza dall'asse
    ang: 18,                    // dentino: ampiezza in gradi, davanti al piano verticale dell'asse
    depth: 1.0,                 // quanto entra nel percorso della guancia
    beamT: 1.2, beamL: 16, beamGap: 1.4, endSlot: 0.6, floorGap: 0.4,
    tabClr: 0.3,                // gioco tra la punta del dentino e il supporto del rilievo
    bump: 0.4,                  // altezza del rilievo che scatta a 90°
    bumpClr: 0.5, bumpW: 12,    // gradi tra dentino e rilievo, larghezza del rilievo
    pocketClr: 0.3,             // gioco di stampa attorno al dentino a 180°
  };
  {
    const E = 3500;
    const mu = 0.35;
    const s = d.stop;
    const I = (d.H * s.beamT ** 3) / 12;
    d.stopK = (3 * E * I) / s.beamL ** 3;
    const rMid = (s.r[0] + s.r[1]) / 2;
    const ramp = Math.tan(Math.PI / 4 + Math.atan(mu));
    d.stopPassStrain = (1.5 * s.beamT * s.depth) / s.beamL ** 2;            // una volta sola, alla prima chiusura
    d.stopClickStrain = (1.5 * s.beamT * s.bump) / s.beamL ** 2;            // a ogni apertura e chiusura
    d.stopClickTorque = 2 * d.stopK * s.bump * ramp * rMid;                 // N·mm, due lati
    d.stopClickForce = d.stopClickTorque / (yH - d.frontT);                 // N, spingendo il bordo frontale del coperchio
  }

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
