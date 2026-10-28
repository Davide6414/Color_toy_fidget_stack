// Interfaccia: carica la geometria, collega pannelli, pulsanti e tastiera.
import { zipSync } from 'fflate';
import { loadManifold, buildModel } from './geometry.js';
import { DEFAULT_PARAMS, PARAM_SPECS, DISCS } from './params.js';
import { toBinarySTL } from './stl.js';
import { Viewer } from './viewer.js';
import { Animator } from './sequences.js';
import { tween, ease } from './anim.js';
import { click, setSound, unlockAudio } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const num = (n, dec = 1) => n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const PLA_DENSITY = 1.24; // g/cm³
const STORAGE_KEY = 'color-fidget-stack:params';

const DESCRIPTIONS = {
  base: 'Il pezzo fisso. Il mozzo centrale con 12 scanalature fa da asse e da "cremagliera" per gli scatti; il foro passante con gradino conico trattiene il cappuccio. Il bianco fa da fondo e accende i colori.',
  disc: (spec) => `Filtro colorato con ${spec.windows.count} finestre aperte da ${spec.windows.width}°. Due bracci elastici con dentino scattano nelle scanalature del mozzo ogni 30°. Anello distanziale sopra e zigrinatura sul bordo per la presa.`,
  cap: 'Tiene insieme la pila. Il perno a 4 alette elastiche si aggancia a scatto sotto il gradino del mozzo, poi gira libero come una trottola. Si sgancia spingendo dal basso con una penna.',
};

let wasm = null;
let model = null;
let params = loadParams();

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const p = { ...DEFAULT_PARAMS };
      for (const spec of PARAM_SPECS) {
        const v = Number(saved[spec.key]);
        if (Number.isFinite(v) && v >= spec.min && v <= spec.max) p[spec.key] = v;
      }
      return p;
    }
  } catch { /* storage non disponibile */ }
  return { ...DEFAULT_PARAMS };
}

function saveParams() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* ignora */ }
}

const isDefault = () => PARAM_SPECS.every((s) => params[s.key] === DEFAULT_PARAMS[s.key]);

// ------------------------------------------------------------------ viewer
const viewer = new Viewer($('#viewport'), {
  onDetentClick: (i) => click('disc', i),
  onSnap: () => click('snap'),
  onUserRotate: () => { animator.stop(); hideHint(); },
});

const animator = new Animator(viewer, {
  onCaption: showCaption,
  onState: (name) => {
    document.querySelectorAll('.anim').forEach((b) => b.classList.toggle('playing', b.dataset.anim === name));
    if (!name) syncToolbar();
  },
});

function showCaption(c) {
  const box = $('#caption');
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  $('#caption-step').textContent = c.step ? `Passo ${c.step} di ${c.total}` : 'Animazione';
  $('#caption-title').textContent = c.title;
  $('#caption-text').textContent = c.text;
}

function syncToolbar() {
  const s = viewer.state;
  const exploded = s.explode > 0.5;
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', String((b.dataset.view === 'exploded') === exploded)));
  $('#btn-section').setAttribute('aria-pressed', String(s.section));
  const isolated = Object.values(s.visible).some((v) => !v);
  document.querySelectorAll('[data-act="isolate"]').forEach((b) => {
    const on = isolated && s.visible[b.dataset.part] && Object.values(s.visible).filter(Boolean).length === 1;
    b.setAttribute('aria-pressed', String(on));
    b.closest('.card').classList.toggle('active', on);
  });
}

function hideHint() { $('#hint').classList.add('gone'); }

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

function partFileName(part) {
  return isDefault() ? part.file : part.file.replace('.stl', '_custom.stl');
}

function downloadPart(part) {
  download(partFileName(part), toBinarySTL(part.print, part.id), 'model/stl');
}

function downloadZip() {
  const files = {};
  for (const part of model.parts) files[partFileName(part)] = toBinarySTL(part.print, part.id);
  files['parametri.json'] = new TextEncoder().encode(JSON.stringify(params, null, 2));
  const name = isDefault() ? 'color-fidget-stack-stl.zip' : 'color-fidget-stack-stl-custom.zip';
  download(name, zipSync(files, { level: 6 }), 'application/zip');
}

// ------------------------------------------------------------------ Parti
function renderParts() {
  const list = $('#part-list');
  list.innerHTML = '';
  for (const part of model.parts) {
    const [x, y, z] = part.stats.size;
    const grams = (part.stats.volume / 1000) * PLA_DENSITY;
    const desc = part.kind === 'disc' ? DESCRIPTIONS.disc(part) : DESCRIPTIONS[part.kind];
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <header>
        <span class="swatch" style="--sw:${part.color}"></span>
        <div><h3>${part.name}</h3><p class="meta">${part.filament} · ×1</p></div>
      </header>
      <p>${desc}</p>
      <ul class="stats">
        <li>${num(x)} × ${num(y)} × ${num(z)} mm</li>
        <li>${num(part.stats.volume / 1000, 2)} cm³</li>
        <li>≈ ${num(grams, 0)} g pieno</li>
        <li>${part.stats.triangles.toLocaleString('it-IT')} triangoli</li>
      </ul>
      <div class="actions">
        <button class="btn" data-act="anim"><svg class="ico"><use href="#i-play"/></svg>Funzionamento</button>
        <button class="btn" data-act="isolate" data-part="${part.id}" aria-pressed="false">Isola</button>
        <button class="btn" data-act="stl"><svg class="ico"><use href="#i-download"/></svg>STL</button>
      </div>`;
    card.querySelector('[data-act="anim"]').addEventListener('click', () => {
      unlockAudio();
      if (part.kind === 'disc') animator.play('disc', part.index);
      else animator.play(part.kind);
    });
    card.querySelector('[data-act="isolate"]').addEventListener('click', (e) => {
      animator.stop();
      const s = viewer.state;
      const pressed = e.currentTarget.getAttribute('aria-pressed') === 'true';
      for (const k of Object.keys(s.visible)) s.visible[k] = pressed || k === part.id;
      syncToolbar();
    });
    card.querySelector('[data-act="stl"]').addEventListener('click', () => downloadPart(part));
    list.append(card);
  }
  syncToolbar();
}

// ------------------------------------------------------------------ Legenda
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function renderLegend() {
  const white = [0.96, 0.95, 0.93];
  const [y, m, c] = DISCS.map((dsc) => hexToRgb(dsc.color));
  const mul = (...cols) => cols.reduce((a, b) => a.map((v, i) => v * b[i]), white);
  const css = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
  const items = [
    ['Bianco', 'nessuno', mul()],
    ['Giallo', 'G', mul(y)],
    ['Magenta', 'M', mul(m)],
    ['Ciano', 'C', mul(c)],
    ['Rosso', 'M+G', mul(m, y)],
    ['Verde', 'C+G', mul(c, y)],
    ['Blu', 'C+M', mul(c, m)],
    ['Nero', 'C+M+G', mul(c, m, y)],
  ];
  $('#legend').innerHTML = items
    .map(([name, mix, rgb]) => `<span class="sw" title="${mix}"><i style="background:${css(rgb)}"></i>${name} <small>${mix}</small></span>`)
    .join('');
}

// ------------------------------------------------------------------ Parametri
function renderParams() {
  const list = $('#param-list');
  list.innerHTML = '';
  for (const spec of PARAM_SPECS) {
    const label = document.createElement('label');
    label.className = 'slider';
    const dec = spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0;
    const fmt = (v) => `${num(v, dec)} ${spec.unit}`;
    label.innerHTML = `
      <span>${spec.label} <output>${fmt(params[spec.key])}</output></span>
      <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${params[spec.key]}">
      <small>${spec.help} Predefinito: ${fmt(DEFAULT_PARAMS[spec.key])}.</small>`;
    const input = label.querySelector('input');
    const out = label.querySelector('output');
    label.classList.toggle('changed', params[spec.key] !== DEFAULT_PARAMS[spec.key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      params[spec.key] = v;
      out.textContent = fmt(v);
      label.classList.toggle('changed', v !== DEFAULT_PARAMS[spec.key]);
      scheduleRebuild();
    });
    list.append(label);
  }
}

function renderDims() {
  const d = model.dims;
  const rows = [
    ['Diametro base', `${num(d.baseR * 2)} mm`],
    ['Diametro dischi', `${num(d.discR * 2)} mm`],
    ['Altezza montato', `${num(d.totalH)} mm`],
    ['Posizioni per disco', `${d.positions} × ${d.step}°`],
    ['Combinazioni dei 3 dischi', (d.positions ** 3).toLocaleString('it-IT')],
    ['Flessione braccio del disco', `${num(d.nubDepth, 2)} mm`],
    ['Flessione alette cappuccio', `${num(d.barbR - d.boreNarrowR, 2)} mm`],
    ['Foro disco / mozzo', `Ø ${num(d.boreR * 2, 2)} / Ø ${num(d.hubR * 2, 2)} mm`],
    ['Perno / foro mozzo', `Ø ${num(d.pinR * 2, 2)} / Ø ${num(d.boreNarrowR * 2, 2)} mm`],
  ];
  $('#dims').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

let rebuildTimer = 0;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    animator.stop();
    rebuild();
    saveParams();
  }, 180);
}

function rebuild() {
  model = buildModel(wasm, params);
  viewer.setModel(model);
  renderParts();
  renderDims();
}

// ------------------------------------------------------------------ Gioca
function renderDiscControls() {
  const box = $('#disc-controls');
  box.innerHTML = '';
  [...DISCS.keys()].reverse().forEach((i) => {
    const spec = DISCS[i];
    const row = document.createElement('div');
    row.className = 'disc-row';
    row.innerHTML = `
      <i class="dot" style="background:${spec.color}"></i>
      <span>${spec.name}<kbd>${i + 1}</kbd></span>
      <button aria-label="Ruota ${spec.name} in senso antiorario"><svg class="ico"><use href="#i-left"/></svg></button>
      <button aria-label="Ruota ${spec.name} in senso orario"><svg class="ico"><use href="#i-right"/></svg></button>`;
    const [ccw, cw] = row.querySelectorAll('button');
    ccw.addEventListener('click', () => turnDisc(i, 1));
    cw.addEventListener('click', () => turnDisc(i, -1));
    box.append(row);
  });
}

function turnDisc(i, steps) {
  unlockAudio();
  animator.stop();
  hideHint();
  viewer.rotateDisc(i, steps, 220);
}

function spinCap() {
  unlockAudio();
  if (animator.current !== 'spin') animator.play('spin');
}

// ------------------------------------------------------------------ Tab e toolbar
function selectTab(id) {
  document.querySelectorAll('.tabs [role="tab"]').forEach((t) => {
    const on = t.getAttribute('aria-controls') === id;
    t.setAttribute('aria-selected', String(on));
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
}

function setExploded(on) {
  animator.stop();
  const s = viewer.state;
  tween(s, { explode: on ? 1 : 0 }, 900, { easing: ease.inOut });
  viewer.flyTo(on ? 'exploded' : 'home', 900);
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', String((b.dataset.view === 'exploded') === on)));
}

function bindUI() {
  document.querySelectorAll('.tabs [role="tab"]').forEach((t) =>
    t.addEventListener('click', () => selectTab(t.getAttribute('aria-controls'))));

  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => setExploded(b.dataset.view === 'exploded')));

  $('#btn-section').addEventListener('click', () => {
    viewer.setSection(!viewer.state.section);
    syncToolbar();
  });
  $('#btn-top').addEventListener('click', () => { animator.stop(); viewer.flyTo('top', 900); });
  $('#btn-home').addEventListener('click', () => {
    animator.stop();
    viewer.flyTo(viewer.state.explode > 0.5 ? 'exploded' : 'home', 900);
  });
  $('#btn-sound').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
    setSound(on);
    if (on) unlockAudio();
  });
  $('#btn-stop').addEventListener('click', () => animator.stop());

  document.querySelectorAll('.anim').forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    const arg = b.dataset.arg !== undefined ? Number(b.dataset.arg) : undefined;
    animator.play(b.dataset.anim, arg);
  }));

  $('#btn-spin').addEventListener('click', spinCap);
  $('#btn-shuffle').addEventListener('click', () => { unlockAudio(); animator.play('mix'); });

  const speed = $('#speed');
  speed.addEventListener('input', () => {
    animator.speed = Number(speed.value);
    $('#speed-out').textContent = `${num(animator.speed, animator.speed % 1 ? 2 : 0)}×`;
  });
  const exa = $('#exaggerate');
  exa.addEventListener('input', () => {
    viewer.state.exaggerate = Number(exa.value);
    $('#exa-out').textContent = `×${exa.value}`;
  });

  $('#btn-zip').addEventListener('click', downloadZip);
  $('#btn-zip-params').addEventListener('click', downloadZip);
  $('#btn-reset-params').addEventListener('click', () => {
    params = { ...DEFAULT_PARAMS };
    renderParams();
    scheduleRebuild();
  });

  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['1', '2', '3'].includes(e.key) || ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      const i = Number(e.code.slice(-1) || e.key) - 1;
      turnDisc(i, e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (e.key === ' ' && !e.target.closest('button')) {
      spinCap();
      e.preventDefault();
    } else if (e.key === 'e' || e.key === 'E') {
      setExploded(viewer.state.explode < 0.5);
    } else if (e.key === 's' || e.key === 'S') {
      viewer.setSection(!viewer.state.section);
      syncToolbar();
    } else if (e.key === 'Escape') {
      animator.stop();
    }
  });
}

// ------------------------------------------------------------------ avvio
async function start() {
  bindUI();
  renderLegend();
  renderDiscControls();
  renderParams();
  try {
    wasm = await loadManifold();
    rebuild();
    $('#loading').hidden = true;
    $('#btn-zip').disabled = false;
  } catch (err) {
    console.error(err);
    const box = $('#loading');
    box.classList.add('error');
    $('#loading-text').innerHTML = 'Non è stato possibile generare i modelli 3D in questo browser.<br>' +
      'Puoi comunque scaricare gli STL pronti: <a href="stl/color-fidget-stack-stl.zip">color-fidget-stack-stl.zip</a>.';
  }
}

start();

// Accesso da console per chi vuole sperimentare (es. colorFidget.viewer.state).
window.colorFidget = { viewer, animator, get model() { return model; } };
