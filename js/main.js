// Interfaccia del gioco ordina-colori.
import { zipSync } from 'fflate';
import { loadManifold, buildModel } from './geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS, MAGNET } from './params.js';
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
  files['parametri.json'] = new TextEncoder().encode(JSON.stringify({ parametri: params, pausaMagnetiZ: model.dims.pauseZ }, null, 2));
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
      text: 'Base con 6 binari a U e tacche, coperchio con la barra delle sedi, cerniera a nocche alternate, linguette di chiusura. Si stampa in un pezzo, aperta a 180°.',
      stats: [`≈ ${num(g(P('scatola')), 0)} g pieno`, `pausa a Z ${num(d.pauseZ, 1)} mm`, 'nessun supporto'],
      anim: 'cerniera', files: ['scatola'],
    },
    {
      title: 'Anelli', qty: '×40', swatchClass: 'rings',
      meta: `Ø ${num(d.p.ringD, 0)} × ${num(d.p.ringL, 0)} mm, foro Ø ${num(d.hole, 2)} · 4 colori × 10`,
      text: 'Più lunghi che larghi: è questo che li costringe a distendersi nei binari col foro in asse. Smusso esterno sui due bordi, invito sul foro.',
      stats: [`≈ ${num(g(P('anello')), 2)} g l'uno`, 'in piedi, foro verticale'],
      anim: 'binari', files: ['anelli', 'anello'],
    },
    {
      title: 'Aste', qty: '×6', swatch: `--sw:${P('aste').color}`,
      meta: `Esagono ${num(d.p.rodAF, 0)} mm tra le facce · lunghe ${num(d.rodLen, 0)} mm`,
      text: `Punta conica di ${num(d.p.rodTip, 0)} mm che entra per prima e si innesta per ${num(d.seatDepth, 0)} mm nella barra; coda liscia che sporge ${num(d.p.rodTail, 0)} mm dalla parete per sfilarla.`,
      stats: [`≈ ${num(g(P('asta')), 1)} g l'una`, 'distese su una faccia'],
      anim: 'barra', files: ['aste', 'asta'],
    },
    {
      title: 'Magneti al neodimio', qty: '×4', swatch: '--sw:#aeb4bd',
      meta: `Ø ${MAGNET.d} × ${MAGNET.h} mm (N35 o superiore), da acquistare`,
      text: 'Due nelle guance posteriori del coperchio e due nelle pareti laterali: tengono il coperchio aperto a 90°. Si infilano durante una sola pausa di stampa.',
      stats: ['unico montaggio', 'attenzione alla polarità'],
      anim: 'magneti', files: [],
    },
    {
      title: 'Piatto di prova', qty: '×1', swatch: `--sw:${P('prova').color}`,
      meta: 'Da stampare prima della scatola',
      text: '3 anelli, spezzone d\'asta da 30 mm con la punta, tratto di barra con 2 sedi, tratto di binario da 3 anelli con la tacca, nocca di cerniera print in place.',
      stats: ['per tarare i giochi'],
      anim: 'stampa', files: ['prova'],
    },
    {
      title: 'Stampa prova', qty: '×1', swatch: `--sw:${P('mini').color}`,
      meta: `Scatola mini ${num(m.width)} × ${num(m.length)} × ${num(m.H)} mm · un piatto ${num(miniX, 0)} × ${num(miniY, 0)} mm`,
      text: `La stessa scatola con ${m.n} binari da ${m.p.capacity} anelli, più un'asta da ${num(m.rodLen, 0)} mm e un anello. Anelli, aste, giochi, cerniera, linguette e magneti sono a misura vera: è il meccanismo completo in piccolo, da provare prima della scatola grande.`,
      stats: [`≈ ${num(g(P('mini')), 0)} g pieno`, `pausa a Z ${num(m.pauseZ, 1)} mm`, '4 magneti'],
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
    ['Pausa per i magneti', `Z = ${num(d.pauseZ, 2)} mm`],
    ['Flessione linguette', `${num(d.tongue.nub - d.p.hingeClearance, 2)} mm, ${num(d.tongueStrain * 100, 2)}%`],
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
    ['mini-magneti', 'Fermo a 90°: i magneti tengono il coperchio aperto con l\'asta in piedi.'],
    ['mini-anello', 'Anello: a 90° scivola fino alla barra; richiudendo torna disteso nel binario.'],
  ];
  const checklist = (list) => list.map(([k, t]) => `<li><label><input type="checkbox" data-check="${k}" ${checks[k] ? 'checked' : ''}><span>${t}</span></label></li>`).join('');
  const items = [
    ['anelli', '3 anelli: scorrono sullo spezzone d\'asta senza forzare e senza ballare.'],
    ['asta', 'Spezzone d\'asta da 30 mm: la punta entra negli anelli e nelle sedi.'],
    ['sedi', 'Tratto di barra con 2 sedi: l\'asta entra a mano e resta dritta.'],
    ['binario', 'Tratto di binario da 3 anelli: gli anelli si distendono, l\'asta passa dalla tacca.'],
    ['cerniera', 'Nocca di cerniera: si sblocca con una leggera torsione e ruota liberamente.'],
  ];
  $('#print-guide').innerHTML = `
    <h2>Cosa stampare (P1S, PLA)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Piatto</th><th>Orientamento</th><th>Note</th></tr></thead>
      <tbody>
        <tr><td>Scatola</td><td>Aperta a 180°: base col fondo giù, coperchio con la faccia esterna giù (${num(d.width, 0)} × ${num(d.openLength, 0)} mm)</td><td>Pausa a Z = ${num(d.pauseZ, 1)} mm per i 4 magneti</td></tr>
        <tr><td>Anelli</td><td>In piedi, foro verticale, 10 per piatto</td><td>Un piatto per colore, oppure i 40 insieme con l'AMS</td></tr>
        <tr><td>Aste</td><td>Distese su una faccia dell'esagono</td><td>Strati lungo tutta la lunghezza</td></tr>
        <tr><td>Piatto di prova</td><td>Come la scatola</td><td>Prima della scatola, per tarare i giochi</td></tr>
        <tr><td>Stampa prova</td><td>Un piatto: scatola mini aperta a 180°, asta distesa, anello in piedi (${num(miniX, 0)} × ${num(miniY, 0)} mm)</td><td>Dopo il piatto di prova. Pausa a Z = ${num(m.pauseZ, 1)} mm per 4 magneti</td></tr>
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

    <h2>La pausa per i magneti</h2>
    <div class="callout">Nel cursore degli strati di Bambu Studio, clic destro sullo strato che finisce a <strong>${num(d.pauseZ, 1)} mm</strong> → <em>Aggiungi pausa</em>. Alla pausa le 4 sedi sono aperte in alto: infila i magneti di taglio e riprendi la stampa.</div>
    <ol>
      <li>Prima della stampa attacca i magneti a coppie (uno su l'altro) e segna con un pennarello la faccia libera di ognuno.</li>
      <li>Nelle due sedi della <strong>base</strong> (pareti laterali, vicino alla cerniera) metti i magneti con il segno verso <strong>l'esterno</strong> della scatola.</li>
      <li>Nelle due sedi del <strong>coperchio</strong> (guance posteriori) metti gli altri con il segno verso <strong>l'interno</strong>: così le facce che si attraevano si ritrovano affacciate a 90°.</li>
      <li>Premi i magneti fino in fondo: non devono sporgere sopra il piano di stampa.</li>
    </ol>

    <h2>Dopo la stampa</h2>
    <ol>
      <li>Stacca il pezzo dal piatto e piega delicatamente il coperchio verso la base: la cerniera si sblocca al primo movimento.</li>
      <li>Chiudi il coperchio: le linguette devono scattare ai due angoli anteriori.</li>
      <li>Infila le aste dalle tacche, punta per prima, fino in fondo alla barra. Fatto: nessun altro montaggio.</li>
    </ol>

    <h2>Piatto di prova</h2>
    <ul class="checklist">${checklist(items)}</ul>

    <h2>Stampa prova</h2>
    <p>La scatola mini ha ${m.n} binari da ${m.p.capacity} anelli e misura ${num(m.width, 1)} × ${num(m.length, 1)} mm, ma anelli, aste, giochi, cerniera, linguette e magneti sono quelli veri. Si stampa in un piatto con un'asta e un anello, con la stessa pausa a ${num(m.pauseZ, 1)} mm. Non è in scala 1:2: l'asta diventerebbe un esagono da 2 mm e i magneti non entrerebbero nelle pareti.</p>
    <ul class="checklist">${checklist(miniItems)}</ul>

    <h2>Se qualcosa non va</h2>
    <ul>
      <li><strong>Anelli duri sulle aste</strong>: aumenta il gioco anello ↔ asta (Parametri) e ristampa gli anelli.</li>
      <li><strong>Aste che non entrano o ballano nella barra</strong>: regola il gioco asta ↔ sede.</li>
      <li><strong>Cerniera saldata</strong>: aumenta il gioco cerniera a 0,35–0,4 mm e verifica il piede d'elefante.</li>
      <li><strong>Aste difficili da sfilare</strong>: porta la sporgenza della coda a 8 mm.</li>
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

  $('#btn-zip').addEventListener('click', downloadZip);
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
    $('#btn-zip').disabled = false;
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
