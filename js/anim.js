// Micro motore di interpolazione basato su requestAnimationFrame.

export const ease = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

export class Cancelled extends Error {
  constructor() { super('animazione interrotta'); }
}

// Interpola le proprietà numeriche di `target` verso i valori di `to`.
export function tween(target, to, ms, { easing = ease.inOut, token = null, onUpdate = null } = {}) {
  const from = {};
  for (const k of Object.keys(to)) from[k] = target[k];
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const frame = (now) => {
      if (token?.cancelled) { reject(new Cancelled()); return; }
      const t = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
      const e = easing(t);
      for (const k of Object.keys(to)) target[k] = from[k] + (to[k] - from[k]) * e;
      onUpdate?.(e);
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function wait(ms, token = null) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const frame = (now) => {
      if (token?.cancelled) { reject(new Cancelled()); return; }
      if (now - t0 >= ms) resolve(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
