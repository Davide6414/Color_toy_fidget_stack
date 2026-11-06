// Interfaccia del gioco ordina-colori.
import { zipSync } from 'fflate';
import { loadManifold, buildModel } from './geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS } from './params.js';
import { toBinarySTL } from './stl.js';
import { Viewer, createState } from './viewer.js';
import { Director } from './sequences.js';
import { Play } from './play.js';
import { isSolved, solve } from './game.js';
import { setSound, unlockAudio } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const num = (n, dec = 1) => n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const PLA = 1.24;
const STORE = 'ordina-colori:';

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(STORE + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
};

let wasm = null;
let model = null;
let params = loadParams();

function loadParams() {
  const saved = store.get('params', null);
  const p = { ...DEFAULT_PARAMS };
  if (saved && typeof saved === 'object') {
    for (const spec of PARAM_SPECS) {
      const v = Number(saved[spec.key]);
      if (Number.isFinite(v) && v >= spec.min && v <= spec.max) p[spec.key] = v;
    }
  }
  return p;
}
const isDefault = () => PARAM_SPECS.every((s) => params[s.key] === DEFAULT_PARAMS[s.key]);

// ------------------------------------------------------------------ oggetti
const viewer = new Viewer($('#viewport'), {
  onRodClick: (i) => { unlockAudio(); play.click(i); },
});
const play = new Play(viewer, { onChange: (e) => updateGameUI(e) });
const director = new Director(viewer, play, {
  onCaption: showCaption,
  onState: (name) => {
    document.querySelectorAll('.anim').forEach((b) => b.classList.toggle('playing', b.dataset.anim === name));
    viewer.setPlayEnabled(!name && play.open);
    syncToolbar();
    updateGameUI();
  },
});
play.rule = store.get('rule', 'ufficiale');
play.goal = store.get('goal', 'monocolore');

function showCaption(c) {
  const box = $('#caption');
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  $('#caption-step').textContent = c.step ? `Passo ${c.step} di ${c.total}` : 'Animazione';
  $('#caption-title').textContent = c.title;
  $('#caption-text').textContent = c.text;
}

// ------------------------------------------------------------------ partita
let solverWorker = null;
let solverSeq = 0;
const pending = new Map();
function getWorker() {
  if (solverWorker !== null) return solverWorker;
  try {
    solverWorker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
    solverWorker.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
    solverWorker.onerror = () => { solverWorker = false; };
  } catch { solverWorker = false; }
  return solverWorker;
}
function runSolver(state, opts, maxNodes = 200000) {
  const w = getWorker();
  if (!w) {
    const t0 = performance.now();
    const r = solve(state, opts, { maxNodes });
    return Promise.resolve({ ...r, ms: performance.now() - t0 });
  }
  const id = ++solverSeq;
  return new Promise((resolve) => { pending.set(id, resolve); w.postMessage({ id, state, opts, maxNodes }); });
}

let solveInfo = null;
async function analyse() {
  const key = JSON.stringify([play.colorState(), play.rule, play.goal]);
  if (solveInfo?.key === key) return solveInfo;
  $('#solver-note').textContent = 'Analisi della mescolata…';
  const r = await runSolver(play.colorState(), play.opts());
  solveInfo = { key, ...r };
  $('#solver-note').textContent = r.moves
    ? `Risolvibile: il risolutore ha trovato una soluzione in ${r.moves.length} mosse.`
    : 'Il risolutore non trova una soluzione con questa regola: prova la regola libera o agita di nuovo.';
  return solveInfo;
}

function updateGameUI(e = {}) {
  const st = play.colorState();
  const mono = st.rods.filter((r) => r.length && r.every((c) => c === r[0])).length;
  const empty = st.rods.filter((r) => !r.length).length;
  $('#sb-moves').textContent = play.moves;
  $('#hud-moves').textContent = `${play.moves} ${play.moves === 1 ? 'mossa' : 'mosse'}`;
  $('#sb-mono').textContent = `${mono + empty}/${st.rods.length}`;
  const solved = isSolved(st, { goal: play.goal });
  const sb = $('#sb-state');
  sb.textContent = solved ? 'Risolto' : play.open ? 'In gioco' : 'Chiusa';
  sb.classList.toggle('solved', solved);
  $('#hud-rule').textContent = play.rule === 'ufficiale' ? 'Regola ufficiale' : 'Regola libera';
  $('#hud-hint').textContent = play.selected >= 0 ? 'Tocca l\'asta di destinazione' : 'Tocca un\'asta per prendere l\'anello in cima';
  $('#hud').hidden = !play.open || director.running || viewer.mode === 'stampa';
  $('#btn-lid').textContent = play.open ? 'Chiudi il coperchio' : 'Apri il coperchio';
  const w = $('#win');
  w.hidden = !play.won || director.running;
  if (play.won) $('#win-text').textContent = `${play.moves} mosse · ${play.rule === 'ufficiale' ? 'regola ufficiale' : 'regola libera'}`;
  if (e.rejected) {
    const h = $('#hud');
    h.classList.remove('reject');
    void h.offsetWidth;
    h.classList.add('reject');
    $('#hud-hint').textContent = play.rule === 'ufficiale' ? 'Solo su un\'asta vuota o sullo stesso colore' : 'Asta piena: massimo 10 anelli';
  }
}

function newGameInstant() {
  director.stop();
  play.deal(Math.floor(Math.random() * 1e9));
  play.placeStacked();
  viewer.state.theta = 90;
  viewer.state.rodPull.fill(0);
  viewer.setPlayEnabled(true);
  solveInfo = null;
  updateGameUI();
  syncToolbar();
}

async function setLid(open) {
  if (director.running) director.stop();
  if (play.selected >= 0) await play.dropBack();
  await director.run(open ? 'apri' : 'chiudi');
}

async function hint() {
  if (!play.open || play.busy) return;
  const info = await analyse();
  if (!info.moves?.length) return;
  // la prima mossa della soluzione dallo stato attuale
  const [from, to] = info.moves[0];
  if (play.selected >= 0 && play.selected !== from) await play.dropBack();
  if (play.selected !== from) await play.click(from);
  viewer.setHover(to);
  setTimeout(() => viewer.setHover(-1), 900);
}

async function autoSolve() {
  if (!play.open || play.busy) return;
  if (play.selected >= 0) await play.dropBack();
  const info = await analyse();
  if (!info.moves) return;
  viewer.setPlayEnabled(false);
  for (const [from, to] of info.moves) {
    await play.animateMove(from, to, false, 2.2);
  }
  solveInfo = null;
  viewer.setPlayEnabled(true);
  updateGameUI();
}

// ------------------------------------------------------------------ STL
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const fileName = (f) => (isDefault() ? f : f.replace('.stl', '_custom.stl'));
function downloadPart(id) {
  const part = model.parts.find((p) => p.id === id);
  download(fileName(part.file), toBinarySTL(part.print, part.id), 'model/stl');
}
function downloadZip() {
  const files = {};
  for (const part of model.parts) files[fileName(part.file)] = toBinarySTL(part.print, part.id);
  files['parametri.json'] = new TextEncoder().encode(JSON.stringify({ parametri: params }, null, 2));
  download(isDefault() ? 'ordina-colori-stl.zip' : 'ordina-colori-stl-custom.zip', zipSync(files, { level: 6 }), 'application/zip');
}

// ------------------------------------------------------------------ pezzi
function renderParts() {
  const d = model.dims;
  const m = model.miniDims;
  const P = (id) => model.parts.find((p) => p.id === id);
  const g = (part) => (part.stats.volume / 1000) * PLA;
  const [miniX, miniY] = P('mini').stats.size;
  const cards = [
    {
      title: 'Scatola print in place', qty: '×1', swatch: `--sw:${P('scatola').color}`,
      meta: `Chiusa ${num(d.width)} × ${num(d.length)} × ${num(d.H)} mm · aperta ${num(d.openLength, 0)} mm`,
      text: 'Base con 6 binari a U e tacche, coperchio con la barra delle sedi, cerniera a nocche alternate, linguette di chiusura. Nel coperchio 6 linguette più piccole spingono un dentino in ogni sede: le aste scattano in posizione e non escono da sole. Ai lati della cerniera il fermo a scatto tiene il coperchio a 90°. Si stampa in un pezzo, aperta a 180°, senza pause.',
      stats: [`≈ ${num(g(P('scatola')), 0)} g pieno`, 'nessuna pausa', 'nessun supporto'],
      anim: 'cerniera', files: ['scatola'],
    },
    {
      title: 'Anelli', qty: `×${4 * d.p.capacity}`, swatchClass: 'rings',
      meta: `Ø ${num(d.p.ringD, 0)} × ${num(d.p.ringL, 0)} mm, foro Ø ${num(d.hole, 2)} · 4 colori × ${d.p.capacity}`,
      text: 'Più lunghi che larghi: è questo che li costringe a distendersi nei binari col foro in asse. Smusso esterno sui due bordi, invito sul foro.',
      stats: [`≈ ${num(g(P('anello')), 2)} g l'uno`, 'in piedi, foro verticale'],
      anim: 'binari', files: ['anelli', 'anello'],
    },
    {
      title: 'Aste', qty: '×6', swatch: `--sw:${P('aste').color}`,
      meta: `Esagono ${num(d.p.rodAF, 0)} mm tra le facce · lunghe ${num(d.rodLen, 0)} mm`,
      text: `Punta conica di ${num(d.p.rodTip, 0)} mm che entra per prima e si innesta per ${num(d.seatDepth, 0)} mm nella barra; a ${num(d.neck.fromTip, 1)} mm dalla punta una gola dove scatta il dentino della sede. Coda liscia che sporge ${num(d.p.rodTail, 0)} mm dalla parete per sfilarla.`,
      stats: [`≈ ${num(g(P('asta')), 1)} g l'una`, 'distese su una faccia'],
      anim: 'barra', files: ['aste', 'asta'],
    },
    {
      title: 'Fermo a scatto a 90°', qty: '×2', swatch: `--sw:${P('scatola').color}`,
      meta: 'Nella scatola, ai lati della cerniera: niente da comprare né da montare',
      text: `Nelle pareti laterali, sotto l'asse, un dentino su una linguetta flessibile. A 90° la guancia del coperchio ci batte contro; un rilievo sotto la guancia lo scavalca con un clic aprendo e chiudendo. Alla prima chiusura dopo la stampa le guance lo superano una volta sola.`,
      stats: [`per chiudere ≈ ${num(d.stopClickForce, 1)} N`, `linguetta ${num(d.stopClickStrain * 100, 2)}% a ogni scatto`],
      anim: 'fermo', files: [],
    },
    {
      title: 'Piatto di prova', qty: '×1', swatch: `--sw:${P('prova').color}`,
      meta: 'Da stampare prima della scatola',
      text: '3 anelli, spezzone d\'asta da 30 mm con la punta e la gola, ritaglio del coperchio vero con 2 sedi e i loro scatti, tratto di binario da 3 anelli con la tacca, nocca di cerniera print in place.',
      stats: ['per tarare i giochi e lo scatto'],
      anim: 'stampa', files: ['prova'],
    },
    {
      title: 'Stampa prova', qty: '×1', swatch: `--sw:${P('mini').color}`,
      meta: `Scatola mini ${num(m.width)} × ${num(m.length)} × ${num(m.H)} mm · un piatto ${num(miniX, 0)} × ${num(miniY, 0)} mm`,
      text: `La stessa scatola con ${m.n} binari da ${m.p.capacity} anelli, più un'asta da ${num(m.rodLen, 0)} mm e un anello. Anelli, aste, giochi, cerniera, linguette e fermi sono a misura vera: è il meccanismo completo in piccolo, da provare prima della scatola grande.`,
      stats: [`≈ ${num(g(P('mini')), 0)} g pieno`, 'nessuna pausa'],
      files: ['mini'],
    },
  ];
  const list = $('#part-list');
  list.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('article');
    el.className = 'card';
    const fileButtons = c.files.map((id) => {
      const part = P(id);
      return `<button class="btn" data-stl="${id}"><svg class="ico"><use href="#i-download"/></svg>${part.file}</button>`;
    }).join('');
    el.innerHTML = `
      <header>
        <span class="swatch ${c.swatchClass ?? ''}" style="${c.swatch ?? ''}"></span>
        <div><h3>${c.title} <span class="meta">${c.qty}</span></h3><p class="meta">${c.meta}</p></div>
      </header>
      <p>${c.text}</p>
      <ul class="stats">${c.stats.map((s) => `<li>${s}</li>`).join('')}</ul>
      <div class="actions">
        ${c.anim ? `<button class="btn" data-part-anim="${c.anim}"><svg class="ico"><use href="#i-play"/></svg>Funzionamento</button>` : ''}
        ${fileButtons}
      </div>`;
    list.append(el);
  }
  list.querySelectorAll('[data-stl]').forEach((b) => b.addEventListener('click', () => downloadPart(b.dataset.stl)));
  list.querySelectorAll('[data-part-anim]').forEach((b) => b.addEventListener('click', () => { unlockAudio(); director.run(b.dataset.partAnim); }));
}

// ------------------------------------------------------------------ parametri
function renderParams() {
  const list = $('#param-list');
  list.innerHTML = '';
  for (const spec of PARAM_SPECS) {
    const label = document.createElement('label');
    label.className = 'slider';
    const dec = spec.step < 0.05 ? 3 : spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0;
    const fmt = (v) => `${num(v, dec)}${spec.unit ? ` ${spec.unit}` : ''}`;
    label.innerHTML = `
      <span>${spec.label} <output>${fmt(params[spec.key])}</output></span>
      <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${params[spec.key]}">
      <small>${spec.help} Predefinito: ${fmt(DEFAULT_PARAMS[spec.key])}.</small>`;
    const input = label.querySelector('input');
    const out = label.querySelector('output');
    label.classList.toggle('changed', params[spec.key] !== DEFAULT_PARAMS[spec.key]);
    input.addEventListener('input', () => {
      params[spec.key] = Number(input.value);
      out.textContent = fmt(params[spec.key]);
      label.classList.toggle('changed', params[spec.key] !== DEFAULT_PARAMS[spec.key]);
      scheduleRebuild();
    });
    list.append(label);
  }
}

function renderDims() {
  const d = model.dims;
  const rows = [
    ['Foro anello', `Ø ${num(d.hole, 2)} mm (spigoli asta + 2 × ${num(d.p.slideClearance, 2)})`],
    ['Binario', `R ${num(d.chR, 1)} · largo ${num(d.chW, 1)} · profondo ${num(d.chDepth, 1)} mm`],
    ['Passo binari', `${num(d.pitch, 1)} mm (costola ${num(d.rib, 1)})`],
    ['Lunghezza binario', `${num(d.chLen, 0)} mm = ${d.p.capacity} × ${num(d.p.ringL, 0)} + 2`],
    ['Spazio sopra le costole', `${num(d.headroom, 1)} mm = (D + L) / 2`],
    ['Asta', `${num(d.rodLen, 0)} mm, ${num(d.rodAC, 2)} tra gli spigoli`],
    ['Sede nella barra', `${num(d.seatAF, 2)} tra le facce, ${num(d.seatAC, 2)} tra gli spigoli, profonda ${num(d.seatDepth, 0)}`],
    ['Tacche', `larghe ${num(d.notchW, 2)} mm, fondo a ${num(d.zAxis, 1)} mm`],
    ['Scatola chiusa', `${num(d.width, 1)} × ${num(d.length, 1)} × ${num(d.H, 1)} mm`],
    ['Scatola aperta (stampa)', `${num(d.width, 1)} × ${num(d.openLength, 1)} mm`],
    ['Asse cerniera', `y ${num(d.yHinge, 1)} · z ${num(d.zHinge, 1)} mm (metà altezza)`],
    ['Fermo a 90°', `dentino ${num(d.stop.depth, 1)} mm, scatto ${num(d.stop.bump, 1)} mm, per chiudere ≈ ${num(d.stopClickForce, 1)} N`],
    ['Flessione linguette', `${num(d.tongue.nub - d.p.hingeClearance, 2)} mm, ${num(d.tongueStrain * 100, 2)}%`],
    ['Archi nella gonna', `R ${num(d.archR, 1)} sopra ogni tacca: a 90° gli anelli escono dalla coda`],
    ['Scatto aste', `dentino ${num(d.p.rodDetent, 2)} mm, per sfilare ≈ ${num(d.detentPull, 1)} N, poi ${num(d.detentDrag, 2)} N`],
  ];
  $('#dims').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

let rebuildTimer = 0;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    director.stop();
    rebuild();
    store.set('params', params);
  }, 220);
}

function rebuild() {
  // 4 colori × capienza: con la capienza cambia anche il numero di anelli
  const nRings = 4 * params.capacity;
  const sameRings = viewer.state.rings.length === nRings;
  if (!sameRings) viewer.state.rings = createState(nRings).rings;
  const prev = sameRings && play.rods.length ? play.rods.map((r) => r.slice()) : null;
  model = buildModel(wasm, params);
  viewer.setModel(model);
  if (prev && prev.every((r) => r.length <= params.capacity)) {
    play.placeStacked();
  } else {
    play.deal(Math.floor(Math.random() * 1e9));
    play.placeStacked();
  }
  renderParts();
  renderDims();
  renderPrintGuide();
  updateGameUI();
}

// ------------------------------------------------------------------ guida di stampa
function renderPrintGuide() {
  const d = model.dims;
  const m = model.miniDims;
  const [miniX, miniY] = model.parts.find((p) => p.id === 'mini').stats.size;
  const checks = store.get('checklist', {});
  const miniItems = [
    ['mini-cerniera', 'Cerniera: si sblocca e il coperchio gira da chiuso a 180°.'],
    ['mini-chiusura', 'Chiusura: le linguette scattano e tengono chiuso mentre agiti.'],
    ['mini-asta', 'Asta: entra dalla tacca, attraversa l\'anello disteso nel binario e si innesta nella barra.'],
    ['mini-scatto', 'Scatto: in fondo alla sede l\'asta scatta, non esce capovolgendo la scatola chiusa e si sfila tirando la coda.'],
    ['mini-fermo', 'Fermo a 90°: alla prima chiusura scatta una volta; poi il coperchio si apre fino a 90° con un clic, non va oltre e resta aperto.'],
    ['mini-anello', 'Anello: a 90° scivola fino alla barra, esce dalla cima dell\'asta passando sotto la gonna; richiudendo torna disteso nel binario.'],
  ];
  const checklist = (list) => list.map(([k, t]) => `<li><label><input type="checkbox" data-check="${k}" ${checks[k] ? 'checked' : ''}><span>${t}</span></label></li>`).join('');
  const items = [
    ['anelli', '3 anelli: scorrono sullo spezzone d\'asta senza forzare e senza ballare.'],
    ['asta', 'Spezzone d\'asta da 30 mm: la punta entra negli anelli e nelle sedi.'],
    ['sedi', 'Ritaglio del coperchio: l\'asta entra a mano, resta dritta e scatta in fondo alla sede.'],
    ['scatto', 'Scatto: lo spezzone si sfila tirandolo con due dita ma non esce da solo capovolgendo il ritaglio. Troppo duro o troppo morbido: regola lo scatto aste.'],
    ['binario', 'Tratto di binario da 3 anelli: gli anelli si distendono, l\'asta passa dalla tacca.'],
    ['cerniera', 'Nocca di cerniera: si sblocca con una leggera torsione e ruota liberamente.'],
  ];
  $('#print-guide').innerHTML = `
    <h2>Cosa stampare (P1S, PLA)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Piatto</th><th>Orientamento</th><th>Note</th></tr></thead>
      <tbody>
        <tr><td>Scatola</td><td>Aperta a 180°: base col fondo giù, coperchio con la faccia esterna giù (${num(d.width, 0)} × ${num(d.openLength, 0)} mm)</td><td>Nessuna pausa</td></tr>
        <tr><td>Anelli</td><td>In piedi, foro verticale, ${d.p.capacity} per piatto</td><td>Un piatto per colore, oppure i ${4 * d.p.capacity} insieme con l'AMS</td></tr>
        <tr><td>Aste</td><td>Distese su una faccia dell'esagono</td><td>Strati lungo tutta la lunghezza</td></tr>
        <tr><td>Piatto di prova</td><td>Come la scatola</td><td>Prima della scatola, per tarare i giochi e lo scatto delle aste</td></tr>
        <tr><td>Stampa prova</td><td>Un piatto: scatola mini aperta a 180°, asta distesa, anello in piedi (${num(miniX, 0)} × ${num(miniY, 0)} mm)</td><td>Dopo il piatto di prova, per provare cerniera, chiusura e fermo a 90°</td></tr>
      </tbody>
    </table></div>
    <p>Gli STL sono già orientati. Nessun pezzo richiede supporti o brim.</p>

    <h2>Impostazioni in Bambu Studio</h2>
    <ul>
      <li>Ugello 0,4 mm, strato 0,2 mm, PLA. (PETG se vuoi linguette e cerniera più tenaci.)</li>
      <li>Scatola: 3 pareti, riempimento 15%. Anelli e aste: vengono pieni da soli.</li>
      <li><strong>Compensazione piede d'elefante attiva</strong> (0,1–0,15 mm): il primo strato non deve saldare nocche, linguette e coperchio alla base.</li>
      <li>Disattiva "pulizia" e "ironing" sulla scatola: le fessure della cerniera sono da ${num(d.p.hingeClearance, 1)} mm.</li>
    </ul>

    <h2>Dopo la stampa</h2>
    <ol>
      <li>Stacca il pezzo dal piatto e piega delicatamente il coperchio verso la base: la cerniera si sblocca al primo movimento. Passati i 90° senti due scatti più decisi ai lati della cerniera: le guance scavalcano i dentini del fermo, una volta sola. Da lì il coperchio si apre solo fino a 90°.</li>
      <li>Chiudi il coperchio: le linguette devono scattare ai due angoli anteriori.</li>
      <li>Con il coperchio aperto guarda sotto la barra: ogni pilastrino dello scatto ha un vano aperto. Passa una lama sottile (o uno spessimetro da 0,3) attorno al pilastrino per togliere eventuali fili.</li>
      <li>Infila le aste dalle tacche, punta per prima e appoggiate sul fondo della tacca, finché scattano in fondo alla barra. La prima volta lo scatto è più duro. Fatto: nessun altro montaggio.</li>
      <li>Non premere con oggetti a punta sulle 6 fessure a U vicino alla cerniera: sono le linguette dello scatto.</li>
    </ol>

    <h2>Piatto di prova</h2>
    <ul class="checklist">${checklist(items)}</ul>

    <h2>Stampa prova</h2>
    <p>La scatola mini ha ${m.n} binari da ${m.p.capacity} anelli e misura ${num(m.width, 1)} × ${num(m.length, 1)} mm, ma anelli, aste, giochi, cerniera, linguette e fermi sono quelli veri. Si stampa in un piatto con un'asta e un anello, senza pause. Non è in scala 1:2: l'asta diventerebbe un esagono da 2 mm e la cerniera uscirebbe saldata.</p>
    <ul class="checklist">${checklist(miniItems)}</ul>

    <h2>Se qualcosa non va</h2>
    <ul>
      <li><strong>Anelli duri sulle aste</strong>: aumenta il gioco anello ↔ asta (Parametri) e ristampa gli anelli.</li>
      <li><strong>Aste che non entrano o ballano nella barra</strong>: regola il gioco asta ↔ sede.</li>
      <li><strong>Cerniera saldata</strong>: aumenta il gioco cerniera a 0,35–0,4 mm e verifica il piede d'elefante.</li>
      <li><strong>Aste che escono da sole a scatola chiusa</strong>: alza lo scatto aste (0,6–0,7 mm). <strong>Troppo dure da sfilare</strong>: abbassalo, o porta la sporgenza della coda a 8 mm.</li>
      <li><strong>Il coperchio va oltre i 90°</strong>: la linguetta del fermo è saldata alla parete. Passa una lama nella fessura verticale dietro di lei, nella parete laterale vicino alla cerniera.</li>
      <li><strong>Aste che flettono</strong>: stampale in PETG.</li>
    </ul>`;
  $('#print-guide').querySelectorAll('[data-check]').forEach((cb) => cb.addEventListener('change', () => {
    const all = store.get('checklist', {});
    all[cb.dataset.check] = cb.checked;
    store.set('checklist', all);
  }));
}

// ------------------------------------------------------------------ toolbar
function syncToolbar() {
  const s = viewer.state;
  const open = s.theta > 45;
  document.querySelectorAll('[data-lid]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.lid === '90') === open)));
  $('#btn-section').setAttribute('aria-pressed', String(s.section !== null));
  $('#btn-xray').setAttribute('aria-pressed', String(s.xray));
  $('#btn-print').setAttribute('aria-pressed', String(viewer.mode === 'stampa'));
}

function selectTab(id) {
  document.querySelectorAll('.tabs [role="tab"]').forEach((t) => {
    const on = t.getAttribute('aria-controls') === id;
    t.setAttribute('aria-selected', String(on));
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
}

function bindUI() {
  document.querySelectorAll('.tabs [role="tab"]').forEach((t) => t.addEventListener('click', () => selectTab(t.getAttribute('aria-controls'))));
  document.querySelectorAll('[data-lid]').forEach((b) => b.addEventListener('click', () => { unlockAudio(); setLid(b.dataset.lid === '90'); }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (viewer.mode === 'stampa') { viewer.setMode('modello'); syncToolbar(); }
    viewer.flyTo(b.dataset.view, 800);
  }));
  $('#btn-section').addEventListener('click', () => {
    const s = viewer.state;
    s.section = s.section ? null : { axis: 'x', value: model.dims.chX[2] };
    syncToolbar();
  });
  $('#btn-xray').addEventListener('click', () => { viewer.state.xray = !viewer.state.xray; syncToolbar(); });
  $('#btn-print').addEventListener('click', () => {
    director.stop();
    const on = viewer.mode !== 'stampa';
    viewer.setMode(on ? 'stampa' : 'modello');
    viewer.flyTo(on ? 'stampa' : 'home', 900);
    syncToolbar();
    updateGameUI();
  });
  $('#btn-sound').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
    setSound(on);
    if (on) unlockAudio();
  });
  $('#btn-stop').addEventListener('click', () => director.stop());
  document.querySelectorAll('.anim').forEach((b) => b.addEventListener('click', () => { unlockAudio(); director.run(b.dataset.anim); }));
  const speed = $('#speed');
  speed.addEventListener('input', () => {
    director.speed = Number(speed.value);
    $('#speed-out').textContent = `${num(director.speed, director.speed % 1 ? 2 : 0)}×`;
  });

  $('#btn-new').addEventListener('click', () => { unlockAudio(); solveInfo = null; director.run('agita'); });
  $('#btn-win-new').addEventListener('click', () => { unlockAudio(); solveInfo = null; director.run('agita'); });
  $('#btn-quick').addEventListener('click', newGameInstant);
  $('#btn-undo').addEventListener('click', () => play.undo());
  $('#btn-hint').addEventListener('click', () => { unlockAudio(); hint(); });
  $('#btn-solve').addEventListener('click', () => { unlockAudio(); autoSolve(); });
  $('#btn-lid').addEventListener('click', () => { unlockAudio(); setLid(!play.open); });
  document.querySelectorAll('input[name="rule"]').forEach((r) => {
    r.checked = r.value === play.rule;
    r.addEventListener('change', () => { play.rule = r.value; store.set('rule', r.value); solveInfo = null; updateGameUI(); analyse(); });
  });
  document.querySelectorAll('input[name="goal"]').forEach((r) => {
    r.checked = r.value === play.goal;
    r.addEventListener('change', () => { play.goal = r.value; store.set('goal', r.value); play.won = false; play.checkWin(); solveInfo = null; updateGameUI(); analyse(); });
  });

  $('#btn-mini').addEventListener('click', () => downloadPart('mini'));
  $('#btn-zip-params').addEventListener('click', downloadZip);
  $('#btn-reset-params').addEventListener('click', () => { params = { ...DEFAULT_PARAMS }; renderParams(); scheduleRebuild(); });

  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') director.stop();
    if (e.key === 'z' || e.key === 'Z') play.undo();
    const n = Number(e.key);
    if (n >= 1 && n <= 6) { unlockAudio(); play.click(n - 1); }
  });
}

// ------------------------------------------------------------------ avvio
async function start() {
  bindUI();
  renderParams();
  try {
    wasm = await loadManifold();
    rebuild();
    // si parte con il coperchio aperto e una mescolata pronta
    viewer.state.theta = 90;
    play.placeStacked();
    viewer.applyView('gioco');
    viewer.setPlayEnabled(true);
    $('#loading').hidden = true;
    $('#btn-mini').disabled = false;
    syncToolbar();
    updateGameUI();
    analyse();
  } catch (err) {
    console.error(err);
    const box = $('#loading');
    box.classList.add('error');
    $('#loading-text').innerHTML = 'Non è stato possibile generare i modelli 3D in questo browser.<br>Gli STL pronti sono nel file <a href="stl/ordina-colori-stl.zip">ordina-colori-stl.zip</a>.';
  }
}

start();
// Accesso da console per chi vuole sperimentare.
window.ordinaColori = { viewer, play, director, get model() { return model; } };
