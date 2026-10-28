// Risolutore in un Worker modulo, così la ricerca non blocca l'interfaccia:
//   const w = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ id, state, opts, maxNodes });
//   w.onmessage = (e) => { const { id, moves, explored, ms } = e.data; ... };
// moves è [[from, to], ...] oppure null (nessuna soluzione entro maxNodes o stato non valido;
// in quel caso c'è anche error con il messaggio).
import { solve } from './game.js';

self.addEventListener('message', (event) => {
  const { id, state, opts, maxNodes } = event.data || {};
  const t0 = performance.now();
  const reply = { id, moves: null, explored: 0, ms: 0 };
  try {
    const res = solve(state, opts || {}, maxNodes > 0 ? { maxNodes } : {});
    reply.moves = res.moves;
    reply.explored = res.explored;
  } catch (err) {
    reply.error = String((err && err.message) || err);
  }
  reply.ms = performance.now() - t0;
  self.postMessage(reply);
});
