// Animazioni d'uso del gioco ordina-colori e del funzionamento di ogni parte.
import * as THREE from 'three';
import { tween, wait, ease, Cancelled } from './anim.js';
import { clack, rattle, tic } from './audio.js';

const DEG = Math.PI / 180;

export class Director {
  constructor(viewer, play, { onCaption, onState } = {}) {
    this.viewer = viewer;
    this.play = play;
    this.onCaption = onCaption ?? (() => {});
    this.onState = onState ?? (() => {});
    this.token = null;
    this.current = null;
    this.speed = 1;
    this.saved = null;
  }

  get running() { return this.token !== null; }

  stop() {
    if (!this.token) return;
    this.token.cancelled = true;
    this.token = null;
    this.finish(true);
  }

  // Le animazioni dimostrative dei singoli pezzi non devono rovinare la partita:
  // salvano lo stato e lo ripristinano alla fine.
  snapshot() {
    const s = this.viewer.state;
    this.saved = {
      theta: s.theta, rodPull: s.rodPull.slice(), rodsVisible: s.rodsVisible, xray: s.xray, section: s.section,
      rings: s.rings.map((r) => ({ frame: r.frame, x: r.x, u: r.u, roll: r.roll, lift: r.lift, hidden: r.hidden, pos: r.pos.clone(), quat: r.quat.clone() })),
    };
  }

  restore() {
    if (!this.saved) return;
    const s = this.viewer.state;
    const v = this.saved;
    Object.assign(s, { theta: v.theta, rodPull: v.rodPull, rodsVisible: v.rodsVisible, xray: v.xray, section: v.section, shake: [0, 0, 0, 0], magnetGlow: 0 });
    s.rings.forEach((r, i) => {
      const o = v.rings[i];
      Object.assign(r, { frame: o.frame, x: o.x, u: o.u, roll: o.roll, lift: o.lift, hidden: o.hidden });
      r.pos.copy(o.pos);
      r.quat.copy(o.quat);
    });
    this.saved = null;
  }

  finish(cancelled) {
    const s = this.viewer.state;
    s.shake = [0, 0, 0, 0];
    s.magnetGlow = 0;
    if (this.saved) this.restore();
    else if (cancelled) this.settle();
    this.current = null;
    this.onCaption(null);
    this.onState(null);
  }

  // Dopo un'interruzione rimette tutto in uno stato coerente.
  settle() {
    const s = this.viewer.state;
    s.rodPull = s.rodPull.map(() => 0);
    s.rodsVisible = true;
    s.theta = s.theta > 45 ? 90 : 0;
    s.section = null;
    this.play.placeStacked();
  }

  async run(name, ...args) {
    this.stop();
    const token = { cancelled: false };
    this.token = token;
    this.current = name;
    this.onState(name);
    try {
      await SEQUENCES[name](this.ctx(token), ...args);
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    } finally {
      if (this.token === token) {
        this.token = null;
        this.finish(false);
      }
    }
  }

  ctx(token) {
    const v = this.viewer;
    const ms = (x) => x / this.speed;
    return {
      v, s: v.state, d: v.dims, play: this.play, speed: () => this.speed,
      t: (target, to, dur, easing = ease.inOut, onUpdate = null) => tween(target, to, ms(dur), { easing, token, onUpdate }),
      wait: (dur) => wait(ms(dur), token),
      view: (name, dur = 900) => v.flyTo(name, ms(dur), token),
      caption: (step, total, title, text) => this.onCaption({ step, total, title, text }),
      snapshot: () => this.snapshot(),
      token,
    };
  }
}

// ------------------------------------------------------------------ passi
async function openLid(c, to = 90, dur = 1800) {
  const { s } = c;
  let clicked = false;
  await c.t(s, { theta: to }, dur, ease.inOut, () => {
    if (!clicked && s.theta > 86 && to >= 90) { clicked = true; clack(); }
  });
}

async function pullRods(c, out = true) {
  const { s, d } = c;
  const far = d.rodLen + 10;
  await Promise.all(s.rodPull.map((_, i) => c.wait(i * 140).then(() =>
    c.t(s.rodPull, { [i]: out ? far : 0 }, 1100, out ? ease.inOut : ease.out))));
}

// Agitata: la scatola oscilla, gli anelli volano dentro e poi si distendono
// nei binari secondo una nuova distribuzione casuale.
async function shakeBox(c, seed) {
  const { s, d, play } = c;
  const deal = play.deal(seed);
  const rng = deal.rng;
  const R = s.rings;
  const lp = new THREE.Vector3();
  const lq = new THREE.Quaternion();
  // da posa su binario/asta a posa libera
  for (const r of R) {
    if (r.frame !== 'free') {
      c.v.ringLidPose(r, lp, lq);
      c.v.lidToBox(lp, lq, r.pos, r.quat);
      r.frame = 'free';
    }
  }
  const box = { x: d.innerHalf - 5, y0: d.frontT + 7, y1: d.yChEnd - 7, z0: d.zAxis + 1, z1: d.zLid - 4.5 };
  const randomPose = () => ({
    pos: new THREE.Vector3((rng() * 2 - 1) * box.x, box.y0 + rng() * (box.y1 - box.y0), box.z0 + rng() * (box.z1 - box.z0)),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28)),
  });
  const moveAll = (targets, dur, easing) => {
    const from = R.map((r) => ({ pos: r.pos.clone(), quat: r.quat.clone() }));
    return c.t({}, {}, dur, easing, (e) => {
      R.forEach((r, i) => {
        r.pos.lerpVectors(from[i].pos, targets[i].pos, e);
        r.quat.slerpQuaternions(from[i].quat, targets[i].quat, e);
      });
    });
  };
  const amp = { a: 0 };
  let time = 0;
  const shaker = c.t(amp, { a: 1 }, 300).then(() => null);
  const jitter = () => {
    time += 1;
    s.shake = [Math.sin(time * 1.7) * 6 * amp.a, Math.sin(time * 2.3) * 9 * amp.a, Math.abs(Math.sin(time * 1.1)) * 5 * amp.a, Math.sin(time * 1.9) * 0.05 * amp.a];
  };
  await shaker;
  for (let k = 0; k < 9; k++) {
    rattle();
    await Promise.all([moveAll(R.map(randomPose), 170, ease.inOut), c.t({}, {}, 170, ease.linear, jitter)]);
  }
  // assestamento: ogni anello si distende nel suo binario, foro in asse
  const finals = [];
  deal.rods.forEach((stack, i) => stack.forEach((id, k) => {
    const r = R[id];
    const target = { frame: 'lid', x: d.chX[i], u: deal.channelU[i][k], roll: rng() * 6.28 };
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    c.v.ringLidPose(target, pos, quat);
    finals[id] = { pos, quat, target };
  }));
  const settle = c.t(amp, { a: 0 }, 700, ease.out, jitter);
  const lifted = finals.map((f) => ({ pos: f.pos.clone().add(new THREE.Vector3(0, 0, 5)), quat: f.quat }));
  await moveAll(lifted, 420, ease.out);
  await Promise.all([moveAll(finals, 380, ease.in), settle]);
  s.shake = [0, 0, 0, 0];
  R.forEach((r, i) => Object.assign(r, finals[i].target));
  for (let k = 0; k < 6; k++) setTimeout(() => tic(k), k * 40);
  return deal.rods.map((r) => r.length);
}

export const SEQUENCES = {
  // Flusso completo dalle specifiche: 6 passi.
  async partita(c, seed = Math.floor(Math.random() * 1e9)) {
    const { s, play } = c;
    play.selected = -1;
    c.v.setSelected(-1);
    s.section = null;
    if (s.theta > 1) {
      c.caption(0, 6, 'Chiudi il coperchio', 'Si parte a scatola chiusa: le aste tornano nei binari con gli anelli infilati.');
      await c.view('home', 900);
      await openLid(c, 0, 1500);
    }
    await c.view('chiusa', 900);
    c.caption(1, 6, 'Sfila le aste', 'A scatola chiusa si sfilano le 6 aste dalle tacche della parete frontale: gli anelli restano liberi dentro la scatola.');
    s.xray = true;
    await pullRods(c, true);
    s.rodsVisible = false;
    await c.view('alto', 1000);
    c.caption(2, 6, 'Agita la scatola', 'Gli anelli sono più lunghi che larghi (10 contro 8 mm): possono fermarsi solo distesi lungo i 6 binari, con il foro già in asse.');
    const counts = await shakeBox(c, seed);
    c.caption(2, 6, 'Agita la scatola', `Distribuzione di questa agitata: ${counts.join('-')}. Nessuna asta resta vuota.`);
    await c.wait(1400);
    await c.view('chiusa', 900);
    s.rodsVisible = true;
    c.caption(3, 6, 'Reinfila le aste', 'Sempre a scatola chiusa: ogni asta passa dalla sua tacca, attraversa gli anelli del binario e si innesta nella barra in fondo.');
    await pullRods(c, false);
    s.xray = false;
    await c.wait(300);
    c.caption(4, 6, 'Apri il coperchio a 90°', 'La barra è solidale al coperchio: le aste si alzano in verticale, i magneti tengono il coperchio aperto e gli anelli scivolano fino alla barra.');
    await c.view('home', 800);
    await openLid(c, 90, 2200);
    await play.slideDown(c.token, c.speed());
    await c.view('gioco', 1000);
    c.caption(5, 6, 'Gioca', 'Sposta un anello alla volta dalla cima di un\'asta a un\'altra: su un\'asta vuota o sopra lo stesso colore, al massimo 10 per asta. Vinci quando ogni asta ha un solo colore.');
    await c.wait(2600);
    c.caption(6, 6, 'Per chiudere', 'Anche a partita in corso basta abbassare il coperchio: le aste tornano nei binari con gli anelli infilati. Ora tocca a te!');
    await c.wait(2600);
  },

  async chiudi(c) {
    const { s } = c;
    s.section = null;
    c.caption(null, null, 'Chiudi', 'Le aste tornano orizzontali nei binari con gli anelli infilati: la partita resta com\'è.');
    await c.view('home', 800);
    await openLid(c, 0, 1800);
    clack();
  },

  async apri(c) {
    const { s, play } = c;
    s.section = null;
    c.caption(null, null, 'Apri', 'Il coperchio si ferma a 90° grazie ai magneti; gli anelli scivolano fino alla barra.');
    await c.view('home', 600);
    await openLid(c, 90, 1800);
    await play.slideDown(c.token, c.speed());
    await c.view('gioco', 900);
  },

  async agita(c, seed = Math.floor(Math.random() * 1e9)) {
    // nuova partita veloce: stessi passi, meno spiegazioni
    const { s, play } = c;
    s.section = null;
    if (s.theta > 1) await openLid(c, 0, 1100);
    await c.view('chiusa', 600);
    s.xray = true;
    await pullRods(c, true);
    s.rodsVisible = false;
    c.caption(null, null, 'Agita', 'Gli anelli si ridistribuiscono a caso nei binari.');
    await shakeBox(c, seed);
    s.rodsVisible = true;
    await pullRods(c, false);
    s.xray = false;
    await openLid(c, 90, 1500);
    await play.slideDown(c.token, c.speed());
    await c.view('gioco', 800);
  },

  // ---------------------------------------------------- funzionamento dei pezzi
  async binari(c) {
    const { s, d } = c;
    c.snapshot();
    s.theta = 0;
    s.xray = true;
    s.rodsVisible = false;
    s.section = null;
    // tutti gli anelli fuori scena tranne quattro dimostrativi
    s.rings.forEach((r) => { r.hidden = true; });
    const L = d.p.ringL;
    const demo = s.rings.slice(0, 4);
    const fullCh = 0;
    s.rings.slice(4, 4 + d.p.capacity).forEach((r, k) => Object.assign(r, { hidden: false, frame: 'lid', x: d.chX[fullCh], u: k * L, roll: k }));
    const qAxisY = new THREE.Quaternion();
    const qAxisX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const qAxisZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const ymid = d.yBarFront - 46;
    const free = (r, x, y, z, q) => { Object.assign(r, { hidden: false, frame: 'free' }); r.pos.set(x, y, z); r.quat.copy(q); };
    free(demo[0], d.chX[2], ymid, d.zAxis + 9, qAxisY);
    free(demo[1], (d.chX[3] + d.chX[4]) / 2, ymid - 20, d.zAxis + 9, qAxisX);
    free(demo[2], d.chX[5], ymid + 20, d.floor + d.p.ringL / 2 + 2, qAxisZ);
    free(demo[3], d.chX[fullCh], ymid - 30, d.ribTop + d.protrusion + 4, qAxisY);
    await c.view('altoBinari', 900);
    const P = (r) => r.pos;
    c.caption(1, 4, 'Disteso: entra', `Il binario è largo ${d.chW.toFixed(1)} mm: un anello disteso (Ø ${d.p.ringD}) ci cade dentro e si ferma col foro già in asse.`);
    await c.t(P(demo[0]), { z: d.zAxis }, 600, ease.in);
    tic(1);
    await c.wait(700);
    c.caption(2, 4, 'Di traverso: non entra', `Di traverso l'anello è lungo ${d.p.ringL} mm, più della larghezza del binario: resta in bilico sulle costole e alla scossa successiva gira e cade dentro.`);
    await c.t(P(demo[1]), { z: d.ribTop + d.p.ringD / 2 }, 500, ease.in);
    tic(2);
    await c.wait(500);
    const q1 = demo[1].quat.clone();
    await c.t({}, {}, 700, ease.inOut, (e) => { demo[1].quat.slerpQuaternions(q1, qAxisY, e); demo[1].pos.x = (d.chX[3] + d.chX[4]) / 2 + (d.chX[4] - (d.chX[3] + d.chX[4]) / 2) * e; });
    await c.t(P(demo[1]), { z: d.zAxis }, 300, ease.in);
    tic(3);
    await c.wait(500);
    c.caption(3, 4, 'In piedi: si ribalta', 'Un anello in piedi non trova un appoggio piano sul fondo curvo del binario: alla prima scossa si ribalta e si distende.');
    const q2 = demo[2].quat.clone();
    const y2 = demo[2].pos.y;
    await c.wait(500);
    await c.t({}, {}, 650, ease.in, (e) => {
      demo[2].quat.slerpQuaternions(q2, qAxisY, e);
      demo[2].pos.z = d.floor + d.p.ringL / 2 + 2 + (d.zAxis - (d.floor + d.p.ringL / 2 + 2)) * e;
      demo[2].pos.y = y2 - 4 * e;
    });
    tic(4);
    await c.wait(600);
    c.caption(4, 4, 'Sopra un binario pieno: non ci sta', `Gli anelli nel binario sporgono ${d.protrusion} mm: un altro anello disteso sopra ne richiederebbe ${d.protrusion + d.p.ringD}, ma sotto il coperchio ci sono solo ${d.headroom.toFixed(0)} mm. Scivola nel binario libero accanto.`);
    await c.t(P(demo[3]), { z: d.zLid - d.p.ringD / 2 - 0.2 }, 400, ease.in);
    await c.t(P(demo[3]), { x: d.chX[1] }, 650, ease.inOut);
    await c.t(P(demo[3]), { z: d.zAxis }, 350, ease.in);
    tic(1);
    await c.wait(1800);
  },

  async tacche(c) {
    const { s, d } = c;
    c.snapshot();
    s.xray = false;
    s.rodsVisible = true;
    s.section = { axis: 'x', value: d.chX[3] };
    s.theta = 0;
    await c.view('sezioneFronte', 900);
    c.caption(1, 2, 'Foro di guida', `La tacca è larga ${d.notchW.toFixed(1)} mm con il fondo concentrico all'asse del binario. A scatola chiusa il bordo del coperchio la chiude in alto: diventa un foro che guida l'asta.`);
    await c.wait(2400);
    c.caption(2, 2, 'La coda esce dall\'alto', 'Aprendo, la coda dell\'asta si solleva dalla tacca aperta in alto. Con meno di 5 mm di larghezza nessun anello può uscirne.');
    await openLid(c, 32, 1800);
    await c.wait(900);
    await openLid(c, 0, 1300);
    await c.wait(500);
  },

  async cerniera(c) {
    const { s, d } = c;
    c.snapshot();
    s.xray = false;
    s.section = { axis: 'x', value: d.chX[2] };
    s.theta = 0;
    await c.view('sezioneCerniera', 900);
    c.caption(1, 3, 'Asse a metà altezza', `L'asse è a ${d.zHinge.toFixed(0)} mm, metà dell'altezza: così la scatola si stampa aperta a 180° con base e coperchio entrambi appoggiati sul piatto.`);
    await c.wait(2200);
    c.caption(2, 3, 'Stampata in un pezzo', `Nocche alternate di base e coperchio con perni conici a 45° e gioco di ${d.p.hingeClearance} mm: escono dalla stampa già montate e ruotano subito.`);
    await openLid(c, 180, 2600);
    await c.wait(900);
    c.caption(3, 3, 'Sempre davanti all\'asse', 'La barra ruota restando davanti alla cerniera e non tocca mai la base. Le aste si sfilano e si infilano: il loro giunto è separato dalla cerniera.');
    await openLid(c, 90, 1800);
    await c.wait(700);
    await openLid(c, 0, 1600);
  },

  async barra(c) {
    const { s, d } = c;
    c.snapshot();
    s.xray = false;
    s.theta = 0;
    s.section = { axis: 'x', value: d.chX[2] };
    s.rodPull = s.rodPull.map((_, i) => (i === 2 ? 26 : 0));
    await c.view('barra', 900);
    c.caption(1, 3, 'Sede esagonale', `Ogni asta si innesta per ${d.seatDepth} mm in una sede esagonale con ${d.p.seatClearance} mm di gioco per lato: entra a mano e resta dritta.`);
    await c.t(s.rodPull, { 2: 0 }, 1500, ease.out);
    tic(1);
    await c.wait(600);
    c.caption(2, 3, 'In verticale', 'Aprendo il coperchio la barra porta le aste in verticale.');
    await openLid(c, 90, 1800);
    c.caption(3, 3, 'L\'anello appoggia sulla barra', `La sede misura ${d.seatAC.toFixed(1)} mm tra gli spigoli, meno del foro dell'anello (${d.hole.toFixed(1)} mm): l'anello più basso appoggia tutto sul piano della barra.`);
    await c.play.slideDown(c.token, c.speed());
    await c.view('gioco', 1200);
    await c.wait(1500);
  },

  async magneti(c) {
    const { s, d } = c;
    c.snapshot();
    s.theta = 0;
    s.xray = true;
    s.section = null;
    s.magnetGlow = 0.15;
    await c.view('magneti', 900);
    c.caption(1, 3, 'Quattro magneti, una pausa', `Due magneti nelle guance del coperchio e due nelle pareti laterali, tutti con l'asse orizzontale. Le loro sedi finiscono alla stessa quota (${d.pauseZ.toFixed(1)} mm): basta una pausa di stampa.`);
    await c.wait(2200);
    c.caption(2, 3, 'Si allineano a 90°', 'Aprendo, i magneti del coperchio scorrono accanto a quelli della base e a 90° si trovano faccia a faccia: il coperchio resta aperto da solo.');
    await c.t(s, { theta: 90 }, 2400, ease.inOut, () => { s.magnetGlow = 0.15 + 0.85 * Math.max(0, 1 - Math.abs(s.theta - 90) / 25); });
    clack();
    await c.wait(800);
    c.caption(3, 3, 'Nessuna battuta rigida', 'Il fermo è magnetico: oltre i 90° il coperchio è libero di arrivare a 180°, la posizione in cui si stampa.');
    await c.t(s, { theta: 125 }, 900, ease.inOut, () => { s.magnetGlow = 0.15 + 0.85 * Math.max(0, 1 - Math.abs(s.theta - 90) / 25); });
    await c.t(s, { theta: 90 }, 700, ease.out, () => { s.magnetGlow = 0.15 + 0.85 * Math.max(0, 1 - Math.abs(s.theta - 90) / 25); });
    clack();
    await c.wait(900);
  },

  async chiusura(c) {
    const { s, d } = c;
    c.snapshot();
    s.xray = false;
    s.theta = 6;
    s.section = { axis: 'y', value: (d.tongue.nubY[0] + d.tongue.nubY[1]) / 2 };
    await c.view('angolo', 900);
    c.caption(1, 2, 'Linguette a scatto', 'Ai due angoli anteriori il coperchio ha una linguetta elastica ricavata nel suo stesso piano, con un dentino a 45°. Chiudendo, lo smusso della parete la spinge verso l\'interno...');
    await c.wait(1200);
    await c.t(s, { theta: 0 }, 900, ease.in);
    clack();
    c.caption(2, 2, '...e scatta', `...poi il dentino entra nella sua sede: il coperchio resta chiuso mentre si agita la scatola. La linguetta si flette di ${(d.tongue.nub - d.p.hingeClearance).toFixed(1)} mm (deformazione ${(d.tongueStrain * 100).toFixed(1)}%), nel piano degli strati.`);
    await c.wait(2400);
  },

  async stampa(c) {
    c.snapshot();
    c.v.setMode('stampa');
    try {
      await c.view('stampa', 1000);
      c.caption(1, 1, 'Quattro piatti, nessun supporto', 'Scatola aperta a 180° (pausa per i magneti), 40 anelli in piedi (un piatto per colore senza AMS), 6 aste distese su una faccia, e il piatto di prova per tarare i giochi.');
      await c.wait(5000);
    } finally {
      c.v.setMode('modello');
    }
  },
};
