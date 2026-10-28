// Animazioni del funzionamento: montaggio, scatto dei dischi, aggancio del
// cappuccio, trottola, miscela dei colori, smontaggio.
import { tween, wait, ease, Cancelled } from './anim.js';
import { DISCS } from './params.js';

const PEN_START = 60; // mm sotto la base da cui parte la penna
const ALL_VISIBLE = () => ({ base: true, 'disc-y': true, 'disc-m': true, 'disc-c': true, cap: true });

export class Animator {
  constructor(viewer, { onCaption, onState } = {}) {
    this.viewer = viewer;
    this.onCaption = onCaption ?? (() => {});
    this.onState = onState ?? (() => {});
    this.token = null;
    this.speed = 1;
    this.current = null;
  }

  get running() { return this.token !== null; }

  stop() {
    if (!this.token) return;
    this.token.cancelled = true;
    this.token = null;
    this.cleanup();
  }

  // Riporta i pezzi in una configurazione sensata dopo un'interruzione.
  cleanup() {
    const s = this.viewer.state;
    const step = this.viewer.dims.step;
    s.visible = ALL_VISIBLE();
    s.penZ = null;
    s.discLift = [0, 0, 0];
    s.capLift = 0;
    s.discAngle = s.discAngle.map((a) => Math.round(a / step) * step);
    this.current = null;
    this.onCaption(null);
    this.onState(null);
  }

  async play(name, ...args) {
    this.stop();
    const token = { cancelled: false };
    this.token = token;
    this.current = name;
    this.onState(name);
    const ctx = this.context(token);
    try {
      await SEQUENCES[name](ctx, ...args);
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    } finally {
      if (this.token === token) {
        this.token = null;
        this.current = null;
        this.onCaption(null);
        this.onState(null);
      }
    }
  }

  context(token) {
    const v = this.viewer;
    const ms = (x) => x / this.speed;
    return {
      s: v.state,
      d: v.dims,
      viewer: v,
      t: (target, to, dur, easing = ease.inOut, onUpdate = null) =>
        tween(target, to, ms(dur), { easing, token, onUpdate }),
      wait: (dur) => wait(ms(dur), token),
      view: (name, dur = 900) => v.flyTo(name, ms(dur), token),
      orbit: (deg, dur) => v.orbit(deg, ms(dur), token),
      caption: (step, total, title, text) => this.onCaption({ step, total, title, text }),
      section: (on) => v.setSection(on),
      only: (...ids) => {
        for (const k of Object.keys(v.state.visible)) v.state.visible[k] = ids.includes(k);
      },
      showAll: () => { v.state.visible = ALL_VISIBLE(); },
    };
  }
}

async function randomMix(ctx, moves) {
  const { s, d } = ctx;
  for (let k = 0; k < moves; k++) {
    const i = Math.floor(Math.random() * 3);
    const steps = (1 + Math.floor(Math.random() * 3)) * (Math.random() < 0.5 ? -1 : 1);
    const from = Math.round(s.discAngle[i] / d.step) * d.step;
    await ctx.t(s.discAngle, { [i]: from + steps * d.step }, 320 * Math.abs(steps));
    await ctx.wait(260);
  }
}

async function spinCap(ctx, turns = 5, dur = 4200) {
  await ctx.t(ctx.s, { capSpin: ctx.s.capSpin + turns * 360 }, dur, ease.out);
}

export const SEQUENCES = {
  async assembly(ctx) {
    const { s } = ctx;
    ctx.section(false);
    s.explode = 0;
    s.discLift = [70, 70, 70];
    s.capLift = 90;
    ctx.only('base');
    await ctx.view('assembly', 900);
    ctx.caption(1, 5, 'Base con mozzo',
      'La base bianca fa da sfondo ai colori. Il mozzo centrale ha 12 scanalature verticali: sono le 12 posizioni di scatto dei dischi.');
    await ctx.wait(2200);
    for (let i = 0; i < 3; i++) {
      const disc = DISCS[i];
      s.visible[disc.id] = true;
      s.discLift[i] = 34;
      ctx.caption(2 + i, 5, disc.name,
        'Allinea i due dentini interni con due scanalature opposte e abbassa il disco: scorre lungo il mozzo e si appoggia sull’anello distanziale.');
      await ctx.t(s.discLift, { [i]: 0 }, 1500, ease.out);
      await ctx.wait(450);
    }
    ctx.section(true);
    s.visible.cap = true;
    s.capLift = 26;
    ctx.caption(5, 5, 'Cappuccio a scatto',
      'Premi il cappuccio: le 4 alette del perno si chiudono nel foro stretto e si riaprono sotto il gradino conico. Clic! I dischi restano trattenuti ma liberi di ruotare.');
    await ctx.view('sectionHigh', 900);
    await ctx.t(s, { capLift: 0 }, 3000, ease.inOut);
    await ctx.wait(1000);
    ctx.section(false);
    ctx.caption(null, null, 'Montato!', 'Gira i dischi: dove le finestre si sovrappongono i filtri colorati si sommano e nascono nuovi colori.');
    await ctx.view('top', 1300);
    await randomMix(ctx, 6);
    await ctx.view('home', 1200);
  },

  async disc(ctx, i) {
    const { s, d } = ctx;
    const disc = DISCS[i];
    ctx.section(false);
    s.explode = 0;
    ctx.only('base', disc.id);
    ctx.caption(1, 3, `${disc.name}: bracci elastici`,
      'Nello spessore del disco ci sono due bracci curvi separati da una fessura. All’estremità di ciascuno c’è un dentino che entra in una scanalatura del mozzo.');
    await ctx.view('hub', 1100);
    await ctx.wait(1400);
    ctx.caption(2, 3, `${disc.name}: scatto ogni 30°`,
      'Girando, il dentino risale sul mozzo e il braccio si flette verso l’esterno (deformazione amplificata), poi ricade nella scanalatura successiva: clic.');
    for (let k = 0; k < 6; k++) {
      const from = Math.round(s.discAngle[i] / d.step) * d.step;
      await ctx.t(s.discAngle, { [i]: from + d.step }, 900);
      await ctx.wait(300);
    }
    ctx.showAll();
    s.visible.cap = false;
    ctx.caption(3, 3, `${disc.name}: finestre`,
      `Le finestre aperte (${disc.windows.count} da ${disc.windows.width}°) sono multipli di 30°: a ogni scatto i loro bordi coincidono con quelli degli altri dischi.`);
    await ctx.view('top', 1100);
    for (let k = 0; k < 4; k++) {
      const from = Math.round(s.discAngle[i] / d.step) * d.step;
      await ctx.t(s.discAngle, { [i]: from + d.step }, 600);
      await ctx.wait(350);
    }
    s.visible.cap = true;
    await ctx.view('home', 1000);
  },

  async base(ctx) {
    ctx.section(false);
    ctx.s.explode = 0;
    ctx.only('base');
    await ctx.view('home', 900);
    ctx.caption(1, 2, 'Base con mozzo scanalato',
      'Il mozzo è l’asse fisso della pila: 12 scanalature verticali danno 12 posizioni di scatto. L’anello in rilievo tiene il primo disco sollevato di qualche decimo.');
    await ctx.orbit(200, 4200);
    ctx.section(true);
    ctx.caption(2, 2, 'Foro con gradino conico',
      'Dentro il mozzo c’è un foro stretto che si allarga con un cono a 45°: lì sotto si aggancia il dente del cappuccio. Il foro sbuca sotto la base per poterlo smontare.');
    await ctx.view('section', 1000);
    await ctx.wait(3200);
    ctx.section(false);
    ctx.showAll();
    await ctx.view('home', 900);
  },

  async cap(ctx) {
    const { s } = ctx;
    ctx.showAll();
    s.explode = 0;
    ctx.section(true);
    await ctx.view('sectionHigh', 900);
    ctx.caption(1, 3, 'Perno a 4 alette',
      'Due tagli incrociati dividono il perno in 4 alette elastiche. In fondo c’è un dente conico: invito a 45° per entrare, ritorno a 45° per poterlo anche sfilare.');
    await ctx.t(s, { capLift: 24 }, 1300);
    await ctx.wait(500);
    ctx.caption(2, 3, 'Aggancio a scatto',
      'Nel foro stretto le alette si chiudono (deformazione amplificata ×3); superato il gradino si riaprono e il cappuccio resta agganciato.');
    await ctx.t(s, { capLift: 0 }, 3400);
    await ctx.wait(800);
    ctx.section(false);
    ctx.caption(3, 3, 'Trottola',
      'Il perno ha un gioco di un decimo nel foro: il cappuccio gira libero. Dagli un colpetto e lascialo girare.');
    await ctx.view('home', 900);
    await spinCap(ctx);
  },

  async spin(ctx) {
    ctx.caption(null, null, 'Trottola', 'Il cappuccio gira libero sul mozzo senza trascinare i dischi.');
    await spinCap(ctx, 6, 4500);
  },

  async mix(ctx) {
    ctx.showAll();
    ctx.section(false);
    ctx.s.explode = 0;
    await ctx.view('top', 1000);
    ctx.caption(null, null, 'Miscela sottrattiva',
      'Ciano + magenta = blu · magenta + giallo = rosso · ciano + giallo = verde · tutti e tre = quasi nero. Dove le finestre coincidono si vede il bianco della base.');
    await randomMix(ctx, 14);
  },

  async disassembly(ctx) {
    const { s, d } = ctx;
    ctx.showAll();
    s.explode = 0;
    s.capLift = 0;
    ctx.section(true);
    await ctx.view('sectionLow', 1000);
    ctx.caption(1, 3, 'Sgancia il cappuccio',
      'Infila una penna nel foro sotto la base e spingi: il ritorno a 45° del dente chiude le alette e il cappuccio esce.');
    const contact = d.hubTop + d.tipZ;
    s.penZ = -PEN_START;
    await ctx.t(s, { penZ: contact }, 1400, ease.out);
    await ctx.t(s, { penZ: contact + 15 }, 2400, ease.inOut, () => { s.capLift = s.penZ - contact; });
    await ctx.t(s, { penZ: -PEN_START }, 900, ease.in);
    s.penZ = null;
    ctx.section(false);
    ctx.caption(2, 3, 'Sfila i dischi', 'Senza cappuccio i dischi si sfilano dall’alto, uno alla volta.');
    await ctx.view('exploded', 1100);
    const lift0 = s.capLift;
    await ctx.t(s, { explode: 1 }, 2200, ease.inOut, (e) => { s.capLift = lift0 * (1 - e); });
    ctx.caption(3, 3, 'Pezzi separati', 'Puoi cambiare l’ordine dei dischi o stamparne di nuovi con altri motivi e colori.');
    await ctx.wait(2500);
  },
};
