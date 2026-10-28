// Test della logica di gioco (js/game.js) e del worker del risolutore.
// Uso: node tools/test-game.mjs [mescolate]   (predefinito 200 per combinazione regola × obiettivo)
// Esce con codice 1 se una verifica fallisce.
import { Worker } from 'node:worker_threads';
import {
  DEFAULTS, mulberry32, shake, canMove, applyMove, isSolved, legalMoves, solve, hint, stateKey, canonicalKey,
} from '../js/game.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const fill = (c, n) => Array(n).fill(c);
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const N = Math.max(1, Number(process.argv[2]) || 200);
const CAP = DEFAULTS.capacity;

// Applica le mosse controllando ognuna con canMove; restituisce lo stato finale o null.
function replay(state, moves, opts) {
  let cur = state;
  for (const [f, t] of moves) {
    if (!canMove(cur, f, t, opts)) return null;
    cur = applyMove(cur, f, t);
  }
  return cur;
}

// ------------------------------------------------------------------ canMove
console.log('\n▶ Regole (canMove)');
{
  const s = { rods: [[0, 1], [1], [], [2, 2, 2], [0], [3]] };
  const U = { capacity: 3, rule: 'ufficiale' };
  const L = { capacity: 3, rule: 'libera' };
  ok(!canMove(s, 0, 0, U) && !canMove(s, 0, 0, L), 'da un\'asta su se stessa: no');
  ok(!canMove(s, 2, 0, U) && !canMove(s, 2, 0, L), 'da asta vuota: no');
  ok(!canMove(s, 1, 3, U) && !canMove(s, 1, 3, L), 'su asta piena (capacità 3): no');
  ok(canMove(s, 1, 3, { capacity: 4, rule: 'libera' }), 'stessa asta con capacità 4 in regola libera: sì');
  ok(!canMove(s, 4, 3, { capacity: 4, rule: 'ufficiale' }), 'ufficiale, capacità 4, colore diverso: no');
  ok(canMove(s, 0, 1, U), 'ufficiale: sopra un anello dello stesso colore: sì');
  ok(canMove(s, 0, 2, U) && canMove(s, 5, 2, U), 'ufficiale: su asta vuota: sì');
  ok(!canMove(s, 0, 4, U) && !canMove(s, 4, 5, U), 'ufficiale: sopra un colore diverso: no');
  ok(canMove(s, 0, 4, L) && canMove(s, 4, 5, L), 'libera: sopra un colore diverso: sì');
  ok(!canMove(s, -1, 2, L) && !canMove(s, 0, 6, L) && !canMove(s, 0.5, 2, L), 'indici fuori campo o non interi: no');
  ok(canMove({ rods: [[0], fill(0, 9)] }, 0, 1, {}) && !canMove({ rods: [[0], fill(0, 10)] }, 0, 1, {}),
    `opzioni predefinite: capacità ${CAP}, regola ufficiale`);
  ok(canMove({ rods: [[0], [1]] }, 0, 1, { rule: 'libera' }) && !canMove({ rods: [[0], [1]] }, 0, 1),
    'regola predefinita = ufficiale');
  const lm = legalMoves(s, U);
  const brute = [];
  for (let f = 0; f < 6; f++) for (let t = 0; t < 6; t++) if (canMove(s, f, t, U)) brute.push([f, t]);
  ok(deepEqual(lm, brute) && lm.length === 7, `legalMoves coerente con canMove (${lm.length} mosse ufficiali)`);
  ok(legalMoves(s, L).length === 21, `legalMoves in regola libera: ${legalMoves(s, L).length} mosse`);
}

// ------------------------------------------------------------------ applyMove
console.log('\n▶ applyMove immutabile');
{
  const s = { rods: [[0, 1, 2], [3], []], extra: 'x' };
  const before = JSON.stringify(s);
  const rodsRef = s.rods, r0 = s.rods[0];
  const t = applyMove(s, 0, 2);
  ok(JSON.stringify(s) === before && s.rods === rodsRef && s.rods[0] === r0, 'lo stato di partenza non cambia');
  ok(deepEqual(t.rods, [[0, 1], [3], [2]]), 'l\'anello in cima passa sulla cima della destinazione');
  ok(t.rods !== s.rods && t.rods.every((p, i) => p !== s.rods[i]), 'nuove pile, nessun array condiviso');
  ok(t.extra === 'x', 'gli altri campi dello stato restano');
  let threw = false;
  try { applyMove(s, 2, 0); } catch { threw = true; }
  ok(threw, 'da asta vuota: errore');
}

// ------------------------------------------------------------------ shake
console.log('\n▶ Mescolata (shake)');
{
  let good = true, empty = 0, overCap = 0;
  const patterns = new Map();
  for (let seed = 1; seed <= 1000; seed++) {
    const { rods } = shake(mulberry32(seed));
    const counts = [0, 0, 0, 0];
    for (const p of rods) for (const c of p) counts[c]++;
    if (rods.length !== 6 || counts.some((c) => c !== 10)) good = false;
    if (rods.some((p) => p.length === 0)) empty++;
    if (rods.some((p) => p.length > CAP)) overCap++;
    const key = rods.map((p) => p.length).sort((a, b) => b - a).join('-');
    patterns.set(key, (patterns.get(key) || 0) + 1);
  }
  ok(good, '1000 mescolate: 6 aste, 40 anelli, 10 per colore');
  ok(empty === 0, 'nessuna asta vuota');
  ok(overCap === 0, `capacità ${CAP} rispettata`);
  const top3 = [...patterns].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v / 10}%)`).join(', ');
  const maxLen = Math.max(...[...patterns.keys()].map((k) => Number(k.split('-')[0])));
  ok(patterns.has('7-7-7-7-6-6') && maxLen <= CAP,
    `distribuzioni più frequenti: ${top3}; 7-7-7-7-6-6 ${(patterns.get('7-7-7-7-6-6') || 0) / 10}%, pila più alta ${maxLen}`);
  ok(deepEqual(shake(mulberry32(42)), shake(mulberry32(42))), 'deterministica: stesso seme, stessa mescolata');
  ok(!deepEqual(shake(mulberry32(1)), shake(mulberry32(2))), 'semi diversi, mescolate diverse');
  const r = mulberry32(7);
  const xs = Array.from({ length: 10000 }, r);
  ok(xs.every((x) => x >= 0 && x < 1) && Math.abs(xs.reduce((a, b) => a + b) / xs.length - 0.5) < 0.02,
    'mulberry32 in [0, 1), media ≈ 0,5');
  const small = shake(mulberry32(3), { rods: 6, capacity: 6, colors: 4, perColor: 6 });
  ok(small.rods.flat().length === 24 && small.rods.every((p) => p.length > 0 && p.length <= 6),
    'opzioni ridotte (capacità 6, 6 per colore): rispettate');
}

// ------------------------------------------------------------------ isSolved
console.log('\n▶ Obiettivi (isSolved)');
{
  const complete = { rods: [fill(2, 10), [], fill(0, 10), fill(3, 10), [], fill(1, 10)] };
  const split = { rods: [fill(0, 4), fill(0, 6), fill(1, 10), fill(2, 10), fill(3, 10), []] };
  const mixed = { rods: [[0, 0, 1], fill(0, 7), fill(1, 9), fill(2, 10), fill(3, 10), []] };
  const shaken = shake(mulberry32(5));
  ok(isSolved(complete, { goal: 'monocolore' }) && isSolved(complete, { goal: 'completo' }),
    '4 aste piene e 2 vuote: risolto per entrambi gli obiettivi');
  ok(isSolved(split, { goal: 'monocolore' }) && !isSolved(split, { goal: 'completo' }),
    'un colore diviso su due aste: monocolore sì, completo no');
  ok(!isSolved(mixed, { goal: 'monocolore' }) && !isSolved(mixed, { goal: 'completo' }), 'una pila mista: nessuno dei due');
  ok(!isSolved(shaken, { goal: 'monocolore' }), 'una mescolata non è risolta');
  ok(isSolved(split, {}) && isSolved(split), 'obiettivo predefinito = monocolore');
  ok(stateKey(complete) !== stateKey({ rods: [...complete.rods].reverse() }) &&
    canonicalKey(complete) === canonicalKey({ rods: [...complete.rods].reverse() }),
    'stateKey dipende dall\'ordine delle aste, canonicalKey no');
  for (const goal of ['monocolore', 'completo']) {
    const r = solve(complete, { capacity: CAP, rule: 'ufficiale', goal });
    ok(deepEqual(r.moves, []) && hint(complete, { goal }) === null, `${goal}: stato risolto → 0 mosse, nessun suggerimento`);
  }
  const r = solve(split, { capacity: CAP, rule: 'ufficiale', goal: 'completo' });
  const end = r.moves && replay(split, r.moves, { capacity: CAP, rule: 'ufficiale' });
  ok(r.moves && r.moves.length === 4 && end && isSolved(end, { goal: 'completo' }),
    `da monocolore a completo: si versano i 4 anelli della pila minore (${r.moves && r.moves.length} mosse)`);
}

// ------------------------------------------------------------------ casi limite del risolutore
console.log('\n▶ Risolutore: casi limite');
{
  const stuck = { rods: [[0, 1], [1, 0]] };
  const r = solve(stuck, { capacity: 2, rule: 'ufficiale', goal: 'monocolore' });
  ok(r.moves === null && hint(stuck, { capacity: 2, rule: 'ufficiale' }) === null, 'nessuna mossa possibile → null');
  const tooMany = { rods: [fill(0, 6), [0, 0, 0, 0, 0, 1], [1], []] };
  const r2 = solve(tooMany, { capacity: 6, rule: 'libera', goal: 'completo' });
  ok(r2.moves === null, '11 anelli di un colore con capacità 6: completo impossibile → null');
  const s = shake(mulberry32(11));
  const opts = { capacity: CAP, rule: 'libera', goal: 'monocolore' };
  const limited = solve(s, opts, { maxNodes: 3 });
  ok(limited.explored <= 3, `maxNodes rispettato (${limited.explored} nodi esplorati con limite 3)`);
  const h = hint(s, opts);
  const full = solve(s, opts);
  ok(h && deepEqual(h, full.moves[0]) && canMove(s, h[0], h[1], opts), `hint = prima mossa di solve (${h && h.join('→')})`);
  let threw = false;
  try { solve(s, { rule: 'boh' }); } catch { threw = true; }
  ok(threw, 'regola sconosciuta: errore');
  // stati a metà partita (passeggiata casuale di 40 mosse legali)
  for (const rule of ['libera', 'ufficiale']) {
    let solved = 0, valid = true;
    for (let k = 1; k <= 50; k++) {
      const rng = mulberry32(5000 + k);
      let st = shake(rng);
      const o = { capacity: CAP, rule, goal: 'monocolore' };
      for (let i = 0; i < 40; i++) {
        const lm = legalMoves(st, o);
        if (!lm.length) break;
        const [f, t] = lm[Math.floor(rng() * lm.length)];
        st = applyMove(st, f, t);
      }
      const res = solve(st, o);
      if (res.moves) {
        const end = replay(st, res.moves, o);
        if (!end || !isSolved(end, o)) valid = false;
        solved++;
      }
    }
    ok(valid && solved >= (rule === 'libera' ? 50 : 45), `${rule}: 50 posizioni a metà partita, risolte ${solved}, tutte verificate`);
  }
}

// ------------------------------------------------------------------ statistiche
console.log(`\n▶ Statistiche su ${N} mescolate per combinazione (maxNodes 200000)`);
const rows = [];
for (const rule of ['libera', 'ufficiale']) {
  for (const goal of ['monocolore', 'completo']) {
    const opts = { capacity: CAP, rule, goal };
    let solved = 0, invalid = 0, moves = 0, maxMoves = 0, ms = 0, maxMs = 0, explored = 0;
    for (let seed = 1; seed <= N; seed++) {
      const st = shake(mulberry32(seed));
      const t0 = performance.now();
      const res = solve(st, opts, { maxNodes: 200000 });
      const dt = performance.now() - t0;
      ms += dt; maxMs = Math.max(maxMs, dt); explored += res.explored;
      if (!res.moves) continue;
      const end = replay(st, res.moves, opts);
      if (!end || !isSolved(end, opts)) { invalid++; continue; }
      solved++; moves += res.moves.length; maxMoves = Math.max(maxMoves, res.moves.length);
    }
    const row = {
      rule, goal, solved, pct: (100 * solved) / N, avgMoves: solved ? moves / solved : NaN, maxMoves,
      avgMs: ms / N, maxMs, avgExplored: explored / N, invalid,
    };
    rows.push(row);
    console.log(`  ${rule.padEnd(9)} ${goal.padEnd(10)} risolte ${String(solved).padStart(3)}/${N} (${row.pct.toFixed(1)}%)` +
      `  mosse medie ${row.avgMoves.toFixed(1)} (max ${maxMoves})  tempo medio ${row.avgMs.toFixed(1)} ms (max ${maxMs.toFixed(0)})` +
      `  nodi medi ${row.avgExplored.toFixed(0)}`);
  }
}
for (const r of rows) {
  const tag = `${r.rule}/${r.goal}`;
  ok(r.invalid === 0, `${tag}: tutte le soluzioni ri-verificate con canMove e isSolved`);
  if (r.rule === 'libera') ok(r.solved === N, `${tag}: risolte tutte`);
  else ok(r.pct >= (r.goal === 'monocolore' ? 90 : 80), `${tag}: risolte ${r.pct.toFixed(1)}%`);
  ok(r.avgMs < 1500, `${tag}: tempo medio ${r.avgMs.toFixed(1)} ms < 1500 ms`);
  ok(r.avgMoves < 150, `${tag}: mosse medie ${r.avgMoves.toFixed(1)} < 150`);
}

// ------------------------------------------------------------------ worker
// In Node non c'è il Worker del browser: un piccolo adattatore su worker_threads fornisce
// self.addEventListener / self.postMessage e poi importa js/solver-worker.js così com'è.
console.log('\n▶ Worker del risolutore');
{
  const workerUrl = new URL('../js/solver-worker.js', import.meta.url).href;
  const shim = `
    const { parentPort } = require('node:worker_threads');
    const listeners = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (m) => parentPort.postMessage(m);
    globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
    parentPort.on('message', (data) => { for (const fn of listeners) fn({ data }); });
    import(${JSON.stringify(workerUrl)}).then(() => parentPort.postMessage({ ready: true }));
  `;
  const w = new Worker(shim, { eval: true });
  const replies = new Map();
  const ready = new Promise((resolve) => w.on('message', (m) => {
    if (m.ready) resolve();
    else replies.get(m.id)?.(m);
  }));
  const ask = (msg) => new Promise((resolve) => { replies.set(msg.id, resolve); w.postMessage(msg); });
  try {
    await ready;
    const st = shake(mulberry32(99));
    const opts = { capacity: CAP, rule: 'ufficiale', goal: 'monocolore' };
    const [a, b, c] = await Promise.all([
      ask({ id: 1, state: st, opts, maxNodes: 200000 }),
      ask({ id: 'due', state: st, opts: { ...opts, rule: 'libera' } }),
      ask({ id: 3, state: { rods: 'rotto' }, opts }),
    ]);
    const end = a.moves && replay(st, a.moves, opts);
    ok(a.id === 1 && end && isSolved(end, opts) && a.explored > 0 && a.ms >= 0,
      `risposta { id, moves, explored, ms }: ${a.moves && a.moves.length} mosse, ${a.explored} nodi, ${a.ms.toFixed(1)} ms`);
    ok(b.id === 'due' && Array.isArray(b.moves), 'id restituito tale e quale, maxNodes facoltativo');
    ok(c.id === 3 && c.moves === null && typeof c.error === 'string', `stato non valido → moves null con errore ("${c.error}")`);
  } finally {
    await w.terminate();
  }
}

console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche superate');
process.exit(failures ? 1 : 0);
