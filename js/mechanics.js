// Cinematica dei meccanismi elastici, calcolata dalla stessa geometria degli STL.
// - dentino del disco: di quanto deve uscire il braccio mentre il disco ruota
// - alette del cappuccio: di quanto si chiudono mentre il perno entra nel foro

const DEG = Math.PI / 180;

// Profilo di scatto: deflessione radiale del dentino (mm) in funzione
// dell'angolo del disco relativo alla scanalatura più vicina.
export function makeDetent(d) {
  // Contorno del mozzo vicino a una scanalatura: cerchio r=hubR meno le scanalature.
  const grooves = [-1, 0, 1].map((k) => {
    const a = k * d.step * DEG;
    const r = d.hubR + d.grooveOffset;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const inGroove = (x, y) => grooves.some(([gx, gy]) => Math.hypot(x - gx, y - gy) < d.grooveR);
  const boundary = [];
  const span = d.step * 1.5;
  for (let i = 0; i <= 1200; i++) {
    const a = (-span + (2 * span * i) / 1200) * DEG;
    const x = d.hubR * Math.cos(a);
    const y = d.hubR * Math.sin(a);
    if (!inGroove(x, y)) boundary.push([x, y]);
  }
  for (const [gx, gy] of grooves) {
    for (let i = 0; i < 360; i++) {
      const a = i * DEG;
      const x = gx + d.grooveR * Math.cos(a);
      const y = gy + d.grooveR * Math.sin(a);
      if (Math.hypot(x, y) <= d.hubR) boundary.push([x, y]);
    }
  }
  const clearanceAt = (rho, psi) => {
    const cx = rho * Math.cos(psi * DEG);
    const cy = rho * Math.sin(psi * DEG);
    let min = Infinity;
    for (const [x, y] of boundary) min = Math.min(min, Math.hypot(x - cx, y - cy));
    return min;
  };

  const rest = d.nubCenterR;
  const samples = 48;
  const table = [];
  for (let i = 0; i <= samples; i++) {
    const psi = (d.step / 2) * (i / samples);
    let lo = rest;
    let hi = d.hubR + d.nubR + 0.05;
    if (clearanceAt(lo, psi) >= d.nubR) { table.push(0); continue; }
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (clearanceAt(mid, psi) >= d.nubR) hi = mid; else lo = mid;
    }
    table.push(hi - rest);
  }

  return (angleDeg) => {
    let psi = angleDeg % d.step;
    if (psi < 0) psi += d.step;
    if (psi > d.step / 2) psi = d.step - psi;
    const f = (psi / (d.step / 2)) * samples;
    const i = Math.min(samples - 1, Math.floor(f));
    const t = f - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  };
}

// Raggio del foro del mozzo alla quota z (assieme). Infinity sopra il mozzo.
export function boreRadiusAt(d, z) {
  if (z > d.hubTop) return Infinity;
  if (z > d.hubTop - d.boreChamfer) return d.boreNarrowR + (z - (d.hubTop - d.boreChamfer));
  if (z >= d.ledgeZ) return d.boreNarrowR;
  if (z >= d.wideTopZ) return d.boreNarrowR + (d.ledgeZ - z);
  return d.boreWideR;
}

// Raggio del perno del cappuccio alla quota locale zc (0 = faccia inferiore).
function pinRadiusAt(d, zc) {
  if (zc < d.tipZ) return 0;
  if (zc < d.barbLowZ) return d.tipR + (zc - d.tipZ);
  if (zc < d.barbHighZ) return d.barbR;
  if (zc < d.barbTopZ) return d.barbR - (zc - d.barbHighZ);
  return d.pinR;
}

// Chiusura radiale delle alette (mm) con il cappuccio sollevato di `lift` mm
// rispetto alla posizione montata.
export function fingerDeflection(d, lift) {
  let max = 0;
  const n = 80;
  for (let i = 0; i <= n; i++) {
    const zc = d.tipZ + ((d.barbTopZ - d.tipZ) * i) / n;
    const over = pinRadiusAt(d, zc) - boreRadiusAt(d, d.hubTop + lift + zc);
    if (over > max) max = over;
  }
  return max;
}
