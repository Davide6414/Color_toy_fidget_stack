// Parametri del progetto Color Fidget Stack.
// Unità: millimetri e gradi. Questo modulo non dipende da three.js né dal DOM,
// così può essere usato sia nel browser sia negli script Node (tools/).

export const POSITIONS = 12; // scatti per giro (30° l'uno)

// Valori regolabili dal pannello "Parametri" (e usati per gli STL in /stl).
export const DEFAULT_PARAMS = {
  clearance: 0.3,        // gioco radiale foro disco ↔ mozzo
  pinClearance: 0.1,     // gioco radiale perno cappuccio ↔ foro mozzo
  barbInterference: 0.35, // quanto il dente di aggancio sporge oltre il foro
  nubDepth: 0.5,         // quanto il dentino del braccio entra nella scanalatura
  filterThickness: 1.2,  // spessore della zona colorata (finestre)
  axialGap: 0.4,         // altezza degli anelli distanziali tra i dischi
  segments: 128,         // risoluzione dei cerchi
};

export const PARAM_SPECS = [
  { key: 'clearance', label: 'Gioco disco ↔ mozzo', min: 0.15, max: 0.5, step: 0.05, unit: 'mm',
    help: 'Aumenta se i dischi ruotano duri, diminuisci se ballano.' },
  { key: 'nubDepth', label: 'Profondità dentino (scatto)', min: 0.3, max: 0.6, step: 0.05, unit: 'mm',
    help: 'Più profondo = scatto più deciso e più duro.' },
  { key: 'pinClearance', label: 'Gioco perno ↔ foro', min: 0.05, max: 0.3, step: 0.05, unit: 'mm',
    help: 'Gioco del perno del cappuccio: più alto = gira più libero.' },
  { key: 'barbInterference', label: 'Sottosquadro aggancio', min: 0.2, max: 0.5, step: 0.05, unit: 'mm',
    help: 'Più alto = il cappuccio tiene di più ma si inserisce più duro.' },
  { key: 'filterThickness', label: 'Spessore filtro colore', min: 0.6, max: 2.0, step: 0.1, unit: 'mm',
    help: 'Più sottile = colori più chiari e luminosi.' },
  { key: 'axialGap', label: 'Distanziale tra dischi', min: 0.2, max: 0.8, step: 0.1, unit: 'mm',
    help: 'Spazio verticale tra un disco e l\'altro.' },
  { key: 'segments', label: 'Risoluzione cerchi', min: 64, max: 256, step: 32, unit: 'seg',
    help: 'Numero di lati dei cerchi negli STL.' },
];

// I tre dischi, dal basso verso l'alto. Le finestre sono settori aperti
// (in gradi, multipli di 30° così i bordi coincidono a ogni scatto).
export const DISCS = [
  { id: 'disc-y', name: 'Disco giallo', short: 'Giallo', color: '#ffd23f',
    filament: 'PETG/PLA traslucido giallo', file: '02_disco_giallo.stl',
    windows: { count: 6, width: 30, start: 0 } },
  { id: 'disc-m', name: 'Disco magenta', short: 'Magenta', color: '#f0479f',
    filament: 'PETG/PLA traslucido magenta', file: '03_disco_magenta.stl',
    windows: { count: 2, width: 90, start: 0 } },
  { id: 'disc-c', name: 'Disco ciano', short: 'Ciano', color: '#2cc3ee',
    filament: 'PETG/PLA traslucido ciano', file: '04_disco_ciano.stl',
    windows: { count: 3, width: 60, start: 0 } },
];

export const BASE_INFO = {
  id: 'base', name: 'Base con mozzo', color: '#f3f1ec',
  filament: 'PLA/PETG bianco opaco', file: '01_base.stl',
};

export const CAP_INFO = {
  id: 'cap', name: 'Cappuccio a scatto', color: '#2d3036',
  filament: 'PETG (consigliato) o PLA, colore a scelta', file: '05_cappuccio.stl',
};

// Tutte le quote derivate. Cambiando un parametro cambiano solo le quote
// che ne dipendono: l'assieme resta sempre coerente.
export function computeDims(p) {
  const d = {
    seg: p.segments,
    positions: POSITIONS,
    step: 360 / POSITIONS,

    // Base
    baseR: 30, baseH: 6, baseTopChamfer: 1.0, baseBottomChamfer: 0.6,

    // Mozzo scanalato (fa parte della base)
    hubR: 8, hubChamfer: 0.5, grooveR: 1.0, grooveOffset: 0.3,

    // Anelli distanziali su base e dischi
    ridgeR0: 11.5, ridgeR1: 12.7, ridgeH: p.axialGap,

    // Dischi colorati
    discCount: DISCS.length, discR: 28, discT: 3.0, hubZoneR: 15, rimR0: 25.5,
    filterT: p.filterThickness, windowR0: 16, windowR1: 24.5, windowFillet: 1.5,
    gripCount: 24, gripR: 1.2, gripDepth: 0.7,

    // Bracci elastici con dentino (nel piano del disco)
    armSpan: 70, armWidth: 1.5, cutW: 0.8, nubR: 0.9, nubDepth: p.nubDepth,

    // Cappuccio con perno a 4 alette
    capR: 15, capH: 6, capGap: 0.3, knurlCount: 30, knurlR: 0.8,
    pinR: 4.0, pinInnerR: 2.2, pinFillet: 0.3, slotW: 1.2,
    fingerL: 12, fingerRootZ: -1.5, boreChamfer: 0.4,
  };

  d.boreR = d.hubR + p.clearance;
  d.pitch = d.discT + d.ridgeH;
  d.discZ = Array.from({ length: d.discCount }, (_, i) => d.baseH + d.ridgeH + i * d.pitch);
  d.hubTop = d.baseH + d.ridgeH + d.discCount * d.pitch + d.capGap;

  d.slotR0 = d.boreR + d.armWidth;
  d.slotR1 = d.slotR0 + Math.max(0.8, d.nubDepth + 0.3);
  d.nubCenterR = d.hubR - d.nubDepth + d.nubR;

  // Aggancio: profilo del dente (quote locali del cappuccio, z=0 = faccia inferiore)
  d.boreNarrowR = d.pinR + p.pinClearance;
  d.barbR = d.boreNarrowR + p.barbInterference;
  d.boreWideR = Math.max(5.0, d.barbR + 0.3);
  d.tipR = d.pinR - 0.6;
  d.tipZ = d.fingerRootZ - d.fingerL;
  d.barbLowZ = d.tipZ + (d.barbR - d.tipR);      // fine dell'invito a 45°
  d.barbHighZ = d.barbLowZ + 0.55;
  d.barbTopZ = d.barbHighZ + (d.barbR - d.pinR); // ritorno a 45°

  // Gradino conico nel foro della base (quote di assieme)
  d.ledgeZ = d.hubTop + d.barbTopZ;
  d.wideTopZ = d.ledgeZ - (d.boreWideR - d.boreNarrowR);

  d.totalH = d.hubTop + d.capH;
  return d;
}
