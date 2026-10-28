// Partita: collega la logica (game.js) agli anelli 3D del viewer.
// rods[i] = id degli anelli sull'asta i, dal basso (vicino alla barra) in alto.
import { shake, canMove, applyMove, isSolved, mulberry32 } from './game.js';
import { tween, ease, wait } from './anim.js';
import { tic, win } from './audio.js';

export class Play {
  constructor(viewer, { onChange } = {}) {
    this.viewer = viewer;
    this.onChange = onChange ?? (() => {});
    this.rule = 'ufficiale';
    this.goal = 'monocolore';
    this.rods = [];
    this.history = [];
    this.moves = 0;
    this.selected = -1;
    this.busy = false;
    this.won = false;
    this.seed = 1;
  }

  get d() { return this.viewer.dims; }
  get capacity() { return this.d.p.capacity; }
  get rings() { return this.viewer.state.rings; }
  opts() { return { capacity: this.capacity, rule: this.rule, goal: this.goal }; }
  colorState() { return { rods: this.rods.map((r) => r.map((id) => this.rings[id].color)) }; }

  // Distribuzione casuale come dopo un'agitata (anelli ancora nei binari).
  deal(seed) {
    this.seed = seed;
    const rng = mulberry32(seed);
    const colors = shake(rng, { rods: this.d.n, capacity: this.capacity, colors: 4, perColor: this.rings.length / 4 }).rods;
    const pool = [0, 1, 2, 3].map((c) => this.rings.map((r, i) => (r.color === c ? i : -1)).filter((i) => i >= 0));
    this.rods = colors.map((stack) => stack.map((c) => pool[c].pop()));
    this.history = [];
    this.moves = 0;
    this.selected = -1;
    this.won = false;
    // posizioni lungo i binari: anelli sparsi con spazi casuali
    const L = this.d.p.ringL;
    this.channelU = this.rods.map((stack) => {
      const spare = this.d.chLen - stack.length * L;
      const cuts = stack.map(() => rng() * spare).sort((a, b) => a - b);
      return stack.map((_, k) => k * L + cuts[k]);
    });
    return { rods: this.rods.map((r) => r.slice()), channelU: this.channelU, rng };
  }

  // Mette gli anelli nei binari (dopo l'agitata) o impilati sulle aste.
  placeInChannels() {
    this.rods.forEach((stack, i) => stack.forEach((id, k) => {
      Object.assign(this.rings[id], { frame: 'lid', x: this.d.chX[i], u: this.channelU[i][k], lift: 0 });
    }));
  }

  placeStacked() {
    const L = this.d.p.ringL;
    this.rods.forEach((stack, i) => stack.forEach((id, k) => {
      Object.assign(this.rings[id], { frame: 'lid', x: this.d.chX[i], u: k * L, lift: 0 });
    }));
  }

  // Anelli che scivolano fino alla barra quando le aste diventano verticali.
  async slideDown(token, speed = 1) {
    const L = this.d.p.ringL;
    const jobs = [];
    this.rods.forEach((stack, i) => stack.forEach((id, k) => {
      const r = this.rings[id];
      const target = k * L;
      const dist = r.u - target;
      if (dist < 0.01) return;
      const ms = (180 + Math.sqrt(dist) * 70) / speed;
      jobs.push(wait((k * 45 + i * 25) / speed, token)
        .then(() => tween(r, { u: target }, ms, { easing: ease.in, token }))
        .then(() => tic(k)));
    }));
    await Promise.all(jobs);
  }

  get open() { return this.viewer.state.theta > 80; }

  // Clic su un'asta: solleva l'anello in cima, oppure lo appoggia.
  async click(i) {
    if (this.busy || !this.open || this.won) return;
    if (this.selected < 0) {
      if (!this.rods[i].length) return;
      this.selected = i;
      this.viewer.setSelected(i);
      const id = this.rods[i][this.rods[i].length - 1];
      this.busy = true;
      await tween(this.rings[id], { lift: 1 }, 140, { easing: ease.out });
      this.rings[id].u = this.liftedU(i);
      this.busy = false;
      this.onChange();
      return;
    }
    const from = this.selected;
    if (i === from) {
      await this.dropBack();
      return;
    }
    const state = this.colorState();
    if (!canMove(state, from, i, this.opts())) {
      await this.reject(from);
      return;
    }
    await this.animateMove(from, i, true);
  }

  liftedU(i) {
    // l'anello in cima sale di 12 mm, ma sempre sopra la punta dell'asta se serve spostarlo
    return Math.max(this.rods[i].length * this.d.p.ringL + 2, 0);
  }

  async dropBack() {
    const from = this.selected;
    const id = this.rods[from][this.rods[from].length - 1];
    this.busy = true;
    await tween(this.rings[id], { u: (this.rods[from].length - 1) * this.d.p.ringL, lift: 0 }, 160, { easing: ease.in });
    tic(1);
    this.busy = false;
    this.selected = -1;
    this.viewer.setSelected(-1);
    this.onChange();
  }

  async reject(from) {
    const id = this.rods[from][this.rods[from].length - 1];
    const r = this.rings[id];
    this.busy = true;
    const x0 = r.x;
    for (const dx of [1.2, -1.2, 0.8, -0.6, 0]) await tween(r, { x: x0 + dx }, 50, { easing: ease.inOut });
    this.busy = false;
    this.onChange({ rejected: true });
  }

  // Animazione di una mossa: su fino sopra la punta, di lato, giù.
  async animateMove(from, to, alreadyLifted = false, speed = 1, token = null) {
    const d = this.d;
    const L = d.p.ringL;
    const id = this.rods[from][this.rods[from].length - 1];
    const r = this.rings[id];
    const top = d.rodLen - d.seatDepth + 3;
    this.busy = true;
    if (!alreadyLifted) await tween(r, { lift: 1 }, 100 / speed, { easing: ease.out, token });
    await tween(r, { u: top }, (140 + (top - r.u) * 2.2) / speed, { easing: ease.inOut, token });
    await tween(r, { x: d.chX[to] }, (160 + Math.abs(d.chX[to] - r.x) * 4) / speed, { easing: ease.inOut, token });
    this.history.push([from, to]);
    this.rods[to].push(this.rods[from].pop());
    const target = (this.rods[to].length - 1) * L;
    await tween(r, { u: target }, (150 + (top - target) * 2.4) / speed, { easing: ease.in, token });
    r.lift = 0;
    tic(this.rods[to].length);
    this.moves++;
    this.selected = -1;
    this.viewer.setSelected(-1);
    this.busy = false;
    this.checkWin();
    this.onChange();
  }

  async undo() {
    if (this.busy || !this.history.length || !this.open) return;
    if (this.selected >= 0) await this.dropBack();
    const [from, to] = this.history.pop();
    await this.animateMove(to, from);
    this.history.pop();
    this.moves = Math.max(0, this.moves - 2);
    this.won = false;
    this.onChange();
  }

  checkWin() {
    if (isSolved(this.colorState(), { goal: this.goal })) {
      this.won = true;
      win();
    }
  }

  // Sposta istantaneamente gli anelli secondo lo stato corrente (dopo cambi di modello).
  sync() {
    if (this.open || this.viewer.state.theta < 1) this.placeStacked();
  }
}

