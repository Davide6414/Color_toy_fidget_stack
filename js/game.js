// Gioco ordina-colori: regole, mescolata e risolutore.
// Modulo ES senza dipendenze: lo usano il viewer (anche dentro un Worker) e gli script Node.
//
// Stato: { rods: number[][] }, rods[i] è la pila dell'asta i dal basso verso l'alto,
// con indici colore 0..colors-1. Si sposta un anello alla volta, dalla cima.
//   rule 'ufficiale': solo su asta vuota o sopra un anello dello stesso colore.
//   rule 'libera':    ovunque ci sia posto.
//   goal 'monocolore': ogni asta non vuota ha un solo colore.
//   goal 'completo':   in più ogni colore sta tutto su una sola asta.

export const DEFAULTS = { rods: 6, capacity: 10, colors: 4, perColor: 10 };

const RULES = new Set(['ufficiale', 'libera']);
const GOALS = new Set(['monocolore', 'completo']);

// ------------------------------------------------------------------ casualità
// PRNG piccolo e deterministico: stesso seme, stessa sequenza (browser e Node).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Agitata della scatola chiusa: gli anelli, in ordine casuale, cadono ciascuno in un binario
// con posto libero, scelto con probabilità proporzionale ai posti liberi. Se un'asta resta
// vuota si rimescola (con lo stesso generatore: il risultato resta deterministico col seme).
export function shake(rng = Math.random, opts = DEFAULTS) {
  const { rods: R, capacity, colors, perColor } = { ...DEFAULTS, ...opts };
  const total = colors * perColor;
  if (total > R * capacity) throw new Error(`shake: ${total} anelli non stanno in ${R} aste da ${capacity}`);
  const needAll = total >= R;
  for (let attempt = 0; attempt < 10000; attempt++) {
    const rings = [];
    for (let c = 0; c < colors; c++) for (let k = 0; k < perColor; k++) rings.push(c);
    for (let i = rings.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = rings[i]; rings[i] = rings[j]; rings[j] = t;
    }
    const rods = Array.from({ length: R }, () => []);
    let free = R * capacity;
    for (const c of rings) {
      let x = rng() * free;
      let r = 0;
      for (; r < R; r++) {
        const f = capacity - rods[r].length;
        if (x < f) break;
        x -= f;
      }
      if (r === R) { r = R - 1; while (rods[r].length >= capacity) r--; } // arrotondamenti
      rods[r].push(c);
      free--;
    }
    if (!needAll || rods.every((p) => p.length > 0)) return { rods };
  }
  throw new Error('shake: impossibile riempire tutte le aste');
}

// ------------------------------------------------------------------ regole
const top = (pile) => pile[pile.length - 1];

export function canMove(state, from, to, { capacity = DEFAULTS.capacity, rule = 'ufficiale' } = {}) {
  const rods = state && state.rods;
  if (!rods || from === to) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || to < 0 || from >= rods.length || to >= rods.length) return false;
  const a = rods[from], b = rods[to];
  if (a.length === 0 || b.length >= capacity) return false;
  if (rule === 'libera') return true;
  return b.length === 0 || top(b) === top(a);
}

export function applyMove(state, from, to) {
  const rods = state.rods;
  if (from === to || !rods[from] || !rods[to] || rods[from].length === 0) {
    throw new Error(`applyMove: mossa ${from}→${to} non valida`);
  }
  const next = rods.map((p) => p.slice());
  next[to].push(next[from].pop());
  return { ...state, rods: next };
}

function isMono(pile) {
  for (let i = 1; i < pile.length; i++) if (pile[i] !== pile[0]) return false;
  return true;
}

export function isSolved(state, { goal = 'monocolore' } = {}) {
  const rods = state.rods;
  for (const p of rods) if (!isMono(p)) return false;
  if (goal !== 'completo') return true;
  const seen = new Set();
  for (const p of rods) {
    if (p.length === 0) continue;
    if (seen.has(p[0])) return false;
    seen.add(p[0]);
  }
  return true;
}

export function legalMoves(state, opts = {}) {
  const out = [];
  const R = state.rods.length;
  for (let f = 0; f < R; f++) for (let t = 0; t < R; t++) if (canMove(state, f, t, opts)) out.push([f, t]);
  return out;
}

// Chiave esatta (l'ordine delle aste conta): utile per cache e confronti nel viewer.
export function stateKey(state) {
  return state.rods.map((p) => p.join(',')).join('|');
}

// Chiave canonica: le aste sono intercambiabili, quindi le pile si ordinano.
export function canonicalKey(state) {
  return state.rods.map((p) => p.join(',')).sort().join('|');
}

// ------------------------------------------------------------------ risolutore
// Rappresentazione interna: ogni pila è un intero in base B = colors + 1 con la cima nella
// cifra meno significativa (cifra = colore + 1, quindi niente zeri e lunghezza implicita).
// La ricerca è un best-first pesato (f = g + W·h) su "macro-mosse": si sposta il blocco
// in cima (anelli uguali consecutivi) quanto ci sta; ogni macro-mossa vale k mosse singole.
// Gli stati visitati si riconoscono per chiave canonica (pile ordinate) ma i nodi tengono
// le aste nell'ordine reale, così le mosse restituite usano gli indici veri.

function normalize(state, opts) {
  const capacity = opts.capacity ?? DEFAULTS.capacity;
  const rule = opts.rule ?? 'ufficiale';
  const goal = opts.goal ?? 'monocolore';
  if (!RULES.has(rule)) throw new Error(`regola sconosciuta: ${rule}`);
  if (!GOALS.has(goal)) throw new Error(`obiettivo sconosciuto: ${goal}`);
  const rods = state && state.rods;
  if (!Array.isArray(rods) || !rods.every(Array.isArray)) throw new Error('stato non valido: servono rods come array di pile');
  let maxColor = (opts.colors ?? 1) - 1;
  for (const p of rods) {
    if (p.length > capacity) throw new Error(`asta con ${p.length} anelli oltre la capacità ${capacity}`);
    for (const c of p) {
      if (!Number.isInteger(c) || c < 0) throw new Error(`colore non valido: ${c}`);
      if (c > maxColor) maxColor = c;
    }
  }
  const colors = maxColor + 1;
  const B = colors + 1;
  if (Math.pow(B, capacity) >= 2 ** 52) throw new Error('configurazione troppo grande per il risolutore');
  if (rods.length > 250) throw new Error('troppe aste');
  return { capacity, rule, goal, colors, B, R: rods.length };
}

function encodePile(pile, B) {
  let code = 0;
  for (const c of pile) code = code * B + c + 1;
  return code;
}

// Mosse di fusione per l'obiettivo 'completo' partendo da uno stato monocolore:
// per ogni colore diviso su più aste si versano le pile minori su quella maggiore.
function mergeMoves(rods, capacity) {
  const piles = rods.map((p) => p.length);
  const colorOf = rods.map((p) => (p.length ? p[0] : -1));
  const moves = [];
  const byColor = new Map();
  piles.forEach((n, i) => {
    if (!n) return;
    const c = colorOf[i];
    if (!byColor.has(c)) byColor.set(c, []);
    byColor.get(c).push(i);
  });
  for (const list of byColor.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => piles[b] - piles[a] || a - b);
    const dst = list[0];
    for (let j = 1; j < list.length; j++) {
      const src = list[j];
      if (piles[dst] + piles[src] > capacity) return null; // non entra: obiettivo impossibile
      for (let k = piles[src]; k > 0; k--) moves.push([src, dst]);
      piles[dst] += piles[src];
      piles[src] = 0;
    }
  }
  return moves;
}

// Binary heap su indici di nodo con priorità numerica (minimo in cima).
class Heap {
  constructor() { this.idx = new Int32Array(1024); this.pri = new Float64Array(1024); this.n = 0; }
  push(i, p) {
    if (this.n === this.idx.length) {
      const idx = new Int32Array(this.n * 2); idx.set(this.idx); this.idx = idx;
      const pri = new Float64Array(this.n * 2); pri.set(this.pri); this.pri = pri;
    }
    const { idx, pri } = this;
    let k = this.n++;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (pri[up] <= p) break;
      idx[k] = idx[up]; pri[k] = pri[up]; k = up;
    }
    idx[k] = i; pri[k] = p;
  }
  pop() {
    const { idx, pri } = this;
    const out = idx[0];
    const n = --this.n;
    if (n > 0) {
      const i = idx[n], p = pri[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        idx[k] = idx[c]; pri[k] = pri[c]; k = c;
      }
      idx[k] = i; pri[k] = p;
    }
    return out;
  }
}

// Una ricerca best-first pesata. Restituisce { moves, explored } (moves = null se fallisce).
function search(start, cfg, budget, W, maxStored) {
  const { R, B, capacity: cap, rule, goal, colors } = cfg;
  const free = rule === 'libera';
  const full = goal === 'completo';

  const pow = [1];
  const rep = [0];
  for (let k = 1; k <= cap; k++) { pow[k] = pow[k - 1] * B; rep[k] = rep[k - 1] * B + 1; }
  const maxCode = pow[cap];
  const chunks = Math.max(1, Math.ceil(Math.log2(maxCode + 1) / 16));

  // --- analisi di una pila: lunghezza, cima, blocco in cima, base, blocco alla base, segmenti
  let aLen = 0, aTop = 0, aTopRun = 0, aBot = 0, aBotRun = 0, aSeg = 0;
  function analyze(code) {
    aLen = 0; aSeg = 0; aTop = -1; aTopRun = 0; aBot = -1; aBotRun = 0;
    if (code === 0) return;
    let prev = -1, run = 0, first = true;
    while (code > 0) {
      const q = Math.floor(code / B);
      const d = code - q * B; // cifra = colore + 1
      code = q;
      if (aLen++ === 0) aTop = d - 1;
      if (d === prev) run++;
      else {
        if (first && prev !== -1) { aTopRun = run; first = false; }
        aSeg++; prev = d; run = 1;
      }
    }
    if (first) aTopRun = run;
    aBot = prev - 1; aBotRun = run;
  }

  // --- memoria dei nodi (array tipizzati che crescono)
  const CodeArray = maxCode < 2 ** 32 ? Uint32Array : Float64Array;
  let size = 1 << 12;
  let codes = new CodeArray(size * R);
  let parent = new Int32Array(size);
  let mFrom = new Uint8Array(size), mTo = new Uint8Array(size), mK = new Uint8Array(size);
  let gArr = new Int32Array(size);
  let n = 0;
  function grow() {
    const s2 = size * 2;
    const c2 = new CodeArray(s2 * R); c2.set(codes); codes = c2;
    const p2 = new Int32Array(s2); p2.set(parent); parent = p2;
    const f2 = new Uint8Array(s2); f2.set(mFrom); mFrom = f2;
    const t2 = new Uint8Array(s2); t2.set(mTo); mTo = t2;
    const k2 = new Uint8Array(s2); k2.set(mK); mK = k2;
    const g2 = new Int32Array(s2); g2.set(gArr); gArr = g2;
    size = s2;
  }

  // --- chiave canonica: codici ordinati, impacchettati in caratteri da 16 bit
  const sortBuf = new Float64Array(R);
  const charBuf = new Array(R * chunks);
  function keyOf(cur) {
    for (let i = 0; i < R; i++) {
      const v = cur[i];
      let j = i - 1;
      while (j >= 0 && sortBuf[j] > v) { sortBuf[j + 1] = sortBuf[j]; j--; }
      sortBuf[j + 1] = v;
    }
    let w = 0;
    for (let i = 0; i < R; i++) {
      let v = sortBuf[i];
      for (let c = 0; c < chunks; c++) {
        const lo = v % 65536;
        charBuf[w++] = lo;
        v = (v - lo) / 65536;
      }
    }
    return String.fromCharCode.apply(null, charBuf);
  }

  // --- euristica (non ammissibile: le soluzioni sono buone, non ottime)
  //  · anelli sopra il blocco di base di ogni asta: devono muoversi almeno una volta;
  //  · cambi di colore nelle pile (peso 1 con regola ufficiale, 0,5 con la libera);
  //  · 0,25 per ogni pila mista;
  //  · per 'completo': i blocchi di base di un colore che ha già un blocco di base più grande
  //    su un'altra asta (andranno versati lì).
  const hLen = new Int32Array(R), hBot = new Int32Array(R), hBotRun = new Int32Array(R), hSeg = new Int32Array(R);
  const colSum = new Int32Array(colors), colMax = new Int32Array(colors);
  const SEG_W = free ? 0.5 : 1;
  function heuristic() {
    let h = 0, mixed = 0;
    for (let i = 0; i < R; i++) {
      h += hLen[i] - hBotRun[i];
      if (hSeg[i] > 1) { h += SEG_W * (hSeg[i] - 1); mixed++; }
    }
    if (full) {
      colSum.fill(0); colMax.fill(0);
      for (let i = 0; i < R; i++) {
        if (hLen[i] === 0) continue;
        const c = hBot[i];
        colSum[c] += hBotRun[i];
        if (hBotRun[i] > colMax[c]) colMax[c] = hBotRun[i];
      }
      for (let c = 0; c < colors; c++) h += colSum[c] - colMax[c];
    }
    return h + 0.25 * mixed;
  }

  const visited = new Set();
  const heap = new Heap();
  const cur = new Float64Array(R);

  // nodo iniziale
  for (let i = 0; i < R; i++) codes[i] = encodePile(start[i], B);
  parent[0] = -1; gArr[0] = 0; n = 1;
  visited.add(keyOf(codes.subarray(0, R)));
  heap.push(0, 0);

  const pLen = new Int32Array(R), pTop = new Int32Array(R), pTopRun = new Int32Array(R);
  const pBot = new Int32Array(R), pBotRun = new Int32Array(R), pSeg = new Int32Array(R);

  let explored = 0;
  let goalNode = -1;

  outer:
  while (heap.n > 0 && explored < budget && n < maxStored) {
    const node = heap.pop();
    explored++;
    const base = node * R;
    for (let i = 0; i < R; i++) {
      const c = codes[base + i];
      cur[i] = c;
      analyze(c);
      pLen[i] = aLen; pTop[i] = aTop; pTopRun[i] = aTopRun;
      pBot[i] = aBot; pBotRun[i] = aBotRun; pSeg[i] = aSeg;
    }
    const g0 = gArr[node];
    const lastTo = node > 0 ? mTo[node] : -1;

    for (let f = 0; f < R; f++) {
      if (pLen[f] === 0) continue;
      // niente avanti/indietro e niente rilanci: il blocco appena posato su lastTo non riparte
      // subito (andare direttamente da lastFrom alla nuova meta costa meno o uguale)
      if (f === lastTo) continue;
      const color = pTop[f];
      const run = pTopRun[f];
      const fromMono = pSeg[f] === 1;
      let emptyDone = false;
      for (let t = 0; t < R; t++) {
        if (t === f) continue;
        const space = cap - pLen[t];
        if (space <= 0) continue;
        if (pLen[t] === 0) {
          // su asta vuota: inutile se la sorgente è già monocolore; tra più aste vuote ne basta una
          if (fromMono || emptyDone) continue;
          emptyDone = true;
        } else if (!free && pTop[t] !== color) continue;
        const k = run < space ? run : space;
        // nuovo stato
        const cf = cur[f], ct = cur[t];
        const nf = Math.floor(cf / pow[k]);
        const nt = ct * pow[k] + (color + 1) * rep[k];
        cur[f] = nf; cur[t] = nt;
        const key = keyOf(cur);
        if (visited.has(key)) { cur[f] = cf; cur[t] = ct; continue; }
        visited.add(key);
        if (n === size) grow();
        const ci = n++;
        const cb = ci * R;
        for (let i = 0; i < R; i++) codes[cb + i] = cur[i];
        parent[ci] = node; mFrom[ci] = f; mTo[ci] = t; mK[ci] = k;
        const g = g0 + k;
        gArr[ci] = g;
        // euristica del figlio
        let solvedMono = true;
        for (let i = 0; i < R; i++) {
          if (i === f || i === t) {
            analyze(cur[i]);
            hLen[i] = aLen; hBot[i] = aBot; hBotRun[i] = aBotRun; hSeg[i] = aSeg;
          } else {
            hLen[i] = pLen[i]; hBot[i] = pBot[i]; hBotRun[i] = pBotRun[i]; hSeg[i] = pSeg[i];
          }
          if (hSeg[i] > 1) solvedMono = false;
        }
        cur[f] = cf; cur[t] = ct;
        if (solvedMono) { goalNode = ci; break outer; }
        const h = heuristic();
        heap.push(ci, g + W * h);
      }
    }
  }

  if (goalNode < 0) return { moves: null, explored };
  const macro = [];
  for (let v = goalNode; v > 0; v = parent[v]) macro.push(v);
  macro.reverse();
  const moves = [];
  for (const v of macro) for (let k = 0; k < mK[v]; k++) moves.push([mFrom[v], mTo[v]]);
  return { moves, explored };
}

function decodeRods(rods, moves) {
  const out = rods.map((p) => p.slice());
  for (const [f, t] of moves) out[t].push(out[f].pop());
  return out;
}

// Accorcia una sequenza senza cambiarne lo stato finale: se un anello va da a a b e la prima
// mossa successiva che tocca a o b lo riprende da b, le due mosse diventano una (a → d)
// oppure si annullano (d = a). Nel frattempo a e b non cambiano, quindi la mossa resta legale.
function shorten(moves) {
  const ms = moves.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < ms.length && !changed; i++) {
      const a = ms[i][0], b = ms[i][1];
      for (let j = i + 1; j < ms.length; j++) {
        const c = ms[j][0], d = ms[j][1];
        if (c !== a && c !== b && d !== a && d !== b) continue;
        if (c === b) {
          if (d === a) ms.splice(j, 1);
          else ms[j] = [a, d];
          ms.splice(i, 1);
          changed = true;
        }
        break;
      }
    }
  }
  return ms;
}

function replay(state, moves, opts) {
  let cur = state;
  for (const [f, t] of moves) {
    if (!canMove(cur, f, t, opts)) return null;
    cur = applyMove(cur, f, t);
  }
  return cur;
}

// Pesi provati in ordine (prima i più accurati, poi i più avidi) con la quota di nodi che
// ciascuno può usare: con la regola ufficiale lo spazio degli stati è piccolo e W = 1 basta;
// con la regola libera i rami sono tanti e serve un po' di avidità.
const SCHEDULE = {
  ufficiale: [[1, 0.25], [2, 0.5], [5, 1]],
  libera: [[1.2, 0.04], [1.6, 0.15], [3, 1]],
};

export function solve(state, opts = {}, { maxNodes = 200000, weight } = {}) {
  const cfg = normalize(state, opts);
  const rods = state.rods.map((p) => p.slice());
  const start = { rods };
  const ruleOpts = { capacity: cfg.capacity, rule: cfg.rule };
  if (isSolved(start, { goal: cfg.goal })) return { moves: [], explored: 0 };

  let moves = null;
  let explored = 0;
  if (isSolved(start, { goal: 'monocolore' })) moves = [];
  else {
    const plan = weight != null ? [[weight, 1]] : SCHEDULE[cfg.rule];
    // tetto alla memoria: nodi generati (≈ 40 byte l'uno più la chiave nel Set)
    const maxStored = Math.max(10000, Math.min(1.5e6, maxNodes * 20));
    for (const [W, share] of plan) {
      const left = maxNodes - explored;
      if (left <= 0) break;
      const budget = share >= 1 ? left : Math.max(1, Math.floor(maxNodes * share));
      const res = search(rods, cfg, Math.min(left, budget), W, maxStored);
      explored += res.explored;
      if (res.moves) { moves = res.moves; break; }
    }
    if (!moves) return { moves: null, explored };
  }

  if (cfg.goal === 'completo') {
    const tail = mergeMoves(decodeRods(rods, moves), cfg.capacity);
    if (!tail) return { moves: null, explored };
    moves = moves.concat(tail);
  }
  const short = shorten(moves);
  if (short.length < moves.length) {
    const end = replay(start, short, ruleOpts);
    if (end && isSolved(end, { goal: cfg.goal })) moves = short;
  }
  return { moves, explored };
}

export function hint(state, opts = {}, searchOpts = {}) {
  const { moves } = solve(state, opts, searchOpts);
  return moves && moves.length ? moves[0] : null;
}
