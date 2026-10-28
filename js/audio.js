// Suoni di "clic" sintetizzati con Web Audio (nessun file audio).
let ctx = null;
let enabled = true;
let lastAt = 0;

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
export function soundEnabled() { return enabled; }
export function unlockAudio() { if (enabled) audio(); }

// kind: 'disc' (scatto del disco, index 0..2) oppure 'snap' (aggancio cappuccio)
export function click(kind = 'disc', index = 0) {
  if (!enabled) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  const t = a.currentTime;
  if (t - lastAt < 0.025) return; // evita raffiche quando si gira velocemente
  lastAt = t;
  const snap = kind === 'snap';
  const len = snap ? 0.05 : 0.03;

  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.18));
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = snap ? 1700 : 3000 + index * 550;
  band.Q.value = snap ? 2.5 : 5;
  const ng = a.createGain();
  ng.gain.value = snap ? 0.9 : 0.55;
  noise.connect(band).connect(ng).connect(a.destination);
  noise.start(t);

  const osc = a.createOscillator();
  osc.type = 'triangle';
  const f0 = snap ? 950 : 1900 + index * 260;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.04);
  const og = a.createGain();
  og.gain.setValueAtTime(snap ? 0.25 : 0.12, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(og).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}
