// Suoni sintetizzati con Web Audio (nessun file audio).
let ctx = null;
let enabled = true;
const last = {};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound(on) { enabled = on; }
export function unlockAudio() { if (enabled) audio(); }

function ready(kind, minGap) {
  if (!enabled) return null;
  const a = audio();
  if (!a || a.state !== 'running') return null;
  if (a.currentTime - (last[kind] ?? -1) < minGap) return null;
  last[kind] = a.currentTime;
  return a;
}

function noiseBurst(a, t, { len, freq, q, gain, decay = 0.2 }) {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * len)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * decay));
  const src = a.createBufferSource();
  src.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(band).connect(g).connect(a.destination);
  src.start(t);
}

function tone(a, t, { f0, f1, len, gain, type = 'triangle' }) {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

// Anello che si appoggia su un altro anello o sulla barra.
export function tic(pitch = 0) {
  const a = ready('tic', 0.03);
  if (!a) return;
  const t = a.currentTime;
  noiseBurst(a, t, { len: 0.025, freq: 2600 + pitch * 180, q: 6, gain: 0.45 });
  tone(a, t, { f0: 1500 + pitch * 120, f1: 900, len: 0.04, gain: 0.08 });
}

// Magneti del fermo a 90° o linguette che scattano.
export function clack() {
  const a = ready('clack', 0.15);
  if (!a) return;
  const t = a.currentTime;
  noiseBurst(a, t, { len: 0.05, freq: 1200, q: 2, gain: 0.9 });
  tone(a, t, { f0: 420, f1: 180, len: 0.08, gain: 0.25, type: 'sine' });
}

// Anelli che sbattono nella scatola mentre si agita.
export function rattle() {
  const a = ready('rattle', 0.04);
  if (!a) return;
  const t = a.currentTime;
  for (let k = 0; k < 3; k++) {
    noiseBurst(a, t + Math.random() * 0.03, { len: 0.02, freq: 1800 + Math.random() * 2500, q: 4, gain: 0.25 });
  }
}

export function win() {
  const a = ready('win', 1);
  if (!a) return;
  const t = a.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.11, { f0: f, f1: f * 1.01, len: 0.22, gain: 0.12, type: 'sine' }));
}
