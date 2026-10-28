// Scena three.js del gioco ordina-colori: scatola con coperchio incernierato,
// 6 aste, 40 anelli e magneti. Lo stato cinematico (apertura, aste sfilate,
// posizione di ogni anello) viene applicato a ogni fotogramma.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, BOX_COLOR, ROD_COLOR } from './params.js';
import { tween, ease } from './anim.js';

const DEG = Math.PI / 180;

// Inquadrature in coordinate mondo (Y in alto; il modello CAD ha Y verso la
// cerniera, che nel mondo diventa -Z).
export const VIEWS = {
  home: { pos: [210, 182, 150], target: [0, 50, -66] },
  chiusa: { pos: [104, 92, 102], target: [0, 4, -58] },
  gioco: { pos: [0, 136, 206], target: [0, 70, -104] },
  giocoAlto: { pos: [0, 230, 30], target: [0, 60, -104] },
  alto: { pos: [0, 300, -30], target: [0, 0, -64] },
  sezione: { pos: [190, 44, -50], target: [0, 10, -62] },
  sezioneFronte: { pos: [66, 20, 30], target: [2, 6, -6] },
  altoBinari: { pos: [0, 175, -18], target: [0, 0, -54] },
  sezioneCerniera: { pos: [120, 30, -104], target: [0, 10, -114] },
  barra: { pos: [150, 80, -40], target: [0, 26, -106] },
  magneti: { pos: [118, 64, -188], target: [24, 14, -118] },
  angolo: { pos: [58, 34, 44], target: [27, 16, -6] },
  stampa: { pos: [0, 1020, 600], target: [0, 0, 16] },
};

function bufferGeometry({ positions, indices }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

// Spigoli vivi per il contorno, ignorando i triangoli "ago" lasciati dalle
// booleane sulle facce piane (la loro normale è inaffidabile).
function featureEdges({ positions: p, indices: ix }, thresholdDeg) {
  const nTri = ix.length / 3;
  const nVert = p.length / 3;
  const normals = new Float64Array(nTri * 3);
  const needle = new Uint8Array(nTri);
  const longest = new Float64Array(nTri);
  const key = (a, b) => (a < b ? a * nVert + b : b * nVert + a);
  for (let t = 0; t < nTri; t++) {
    const a = ix[3 * t] * 3;
    const b = ix[3 * t + 1] * 3;
    const c = ix[3 * t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const e = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => {
      const pi = ix[3 * t + i] * 3;
      const pj = ix[3 * t + j] * 3;
      return (p[pi] - p[pj]) ** 2 + (p[pi + 1] - p[pj + 1]) ** 2 + (p[pi + 2] - p[pj + 2]) ** 2;
    });
    const m = Math.max(...e);
    const k = e.indexOf(m);
    longest[t] = key(ix[3 * t + k], ix[3 * t + ((k + 1) % 3)]);
    if (len < 1e-4 * m) { needle[t] = 1; continue; }
    normals[3 * t] = nx / len; normals[3 * t + 1] = ny / len; normals[3 * t + 2] = nz / len;
  }
  const edges = new Map();
  for (let t = 0; t < nTri; t++) {
    for (let i = 0; i < 3; i++) {
      const k = key(ix[3 * t + i], ix[3 * t + ((i + 1) % 3)]);
      const faces = edges.get(k);
      if (faces) faces.push(t); else edges.set(k, [t]);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [k, faces] of edges) {
        if (faces.length !== 2) continue;
        for (const [f, g] of [[faces[0], faces[1]], [faces[1], faces[0]]]) {
          if (needle[f] !== 1 || needle[g] === 1 || (pass === 0 && longest[f] === k)) continue;
          normals.copyWithin(3 * f, 3 * g, 3 * g + 3);
          needle[f] = 2;
          changed = true;
        }
      }
    }
  }
  const cos = Math.cos(thresholdDeg * DEG);
  const out = [];
  for (const [k, faces] of edges) {
    if (faces.length === 2) {
      const [f, g] = faces;
      if (needle[f] === 1 || needle[g] === 1) continue;
      const dot = normals[3 * f] * normals[3 * g] + normals[3 * f + 1] * normals[3 * g + 1] + normals[3 * f + 2] * normals[3 * g + 2];
      if (dot > cos) continue;
    }
    const a = Math.floor(k / nVert) * 3;
    const b = (k % nVert) * 3;
    out.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return geo;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, 'rgba(30,40,50,0.28)');
  grad.addColorStop(0.6, 'rgba(30,40,50,0.1)');
  grad.addColorStop(1, 'rgba(30,40,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createState(nRings = 40, perColor = nRings / 4) {
  return {
    theta: 0,                 // apertura coperchio, gradi
    rodPull: Array(6).fill(0),// mm di asta sfilata in avanti
    rodsVisible: true,
    shake: [0, 0, 0, 0],      // traslazione x,y,z e rotazione della scatola durante l'agitata
    xray: false,
    section: null,            // { axis: 'x' | 'y', value } piano di sezione (CAD), oppure null
    magnetGlow: 0,
    rings: Array.from({ length: nRings }, (_, i) => ({
      color: Math.floor(i / perColor),
      frame: 'lid',           // 'lid' (sulle aste o nei binari) o 'free' (in volo)
      x: 0, u: 0, roll: 0,    // posizione: x del binario/asta, u = distanza dalla barra
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
      lift: 0,                // sollevamento visivo (anello in mano)
      hidden: false,
    })),
  };
}

export class Viewer {
  constructor(container, { onRodClick, onHover } = {}) {
    this.container = container;
    this.onRodClick = onRodClick;
    this.onHover = onHover;
    this.state = createState();
    this.mode = 'modello';

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'gl';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef3f6');
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 2, 6000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 1400;

    scene.add(new THREE.HemisphereLight('#ffffff', '#b6c2cc', 1.9));
    const key = new THREE.DirectionalLight('#ffffff', 2.3);
    key.position.set(80, 160, 120);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.8);
    fill.position.set(-120, 60, -80);
    scene.add(fill);

    // Radice in coordinate CAD (Z in alto) ruotata per avere Y in alto.
    this.root = new THREE.Group();
    this.root.rotation.x = -Math.PI / 2;
    scene.add(this.root);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 300),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.position.set(0, 62, -0.05);
    this.root.add(shadow);
    this.shadow = shadow;

    this.boxGroup = new THREE.Group();
    this.root.add(this.boxGroup);
    this.lidPivot = new THREE.Group();
    this.lidGroup = new THREE.Group();
    this.lidPivot.add(this.lidGroup);
    this.boxGroup.add(this.lidPivot);
    this.printGroup = new THREE.Group();
    this.printGroup.visible = false;
    this.root.add(this.printGroup);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6);
    this.clipPlanes = [this.clipPlane];

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hitTargets = [];
    this.hovered = -1;
    this.selected = -1;
    this.playEnabled = false;
    this.bindPointer();

    this.applyView(VIEWS.home);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ materiali
  material(color, { roughness = 0.5, metalness = 0, section = '#ef6a4c', xray = false } = {}) {
    const clippingPlanes = this.clipPlanes;
    return {
      front: new THREE.MeshStandardMaterial({ color, roughness, metalness, clippingPlanes, transparent: xray, opacity: 1 }),
      back: new THREE.MeshBasicMaterial({ color: section, side: THREE.BackSide, clippingPlanes }),
      edges: new THREE.LineBasicMaterial({ color: '#253545', transparent: true, opacity: 0.28, clippingPlanes }),
    };
  }

  makeObject(mesh, mats, { edges = true, crease = 32 } = {}) {
    const geo = bufferGeometry(mesh);
    const shaded = toCreasedNormals(geo, crease * DEG);
    const group = new THREE.Group();
    const front = new THREE.Mesh(shaded, mats.front);
    const back = new THREE.Mesh(shaded, mats.back);
    back.visible = false;
    group.add(back, front);
    if (edges) group.add(new THREE.LineSegments(featureEdges(mesh, 26), mats.edges));
    geo.dispose();
    group.userData.back = back;
    group.userData.front = front;
    return group;
  }

  disposeGroup(g) {
    g.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) for (const m of [].concat(o.material)) m.dispose();
    });
  }

  // ------------------------------------------------------------ modello
  setModel(model) {
    const d = model.dims;
    this.model = model;
    this.dims = d;
    for (const g of [this.boxGroup, this.lidGroup, this.printGroup]) {
      for (const child of [...g.children]) {
        if (child === this.lidPivot) continue;
        g.remove(child);
        this.disposeGroup(child);
      }
    }
    const m = model.meshes;
    this.mats = {
      base: this.material(BOX_COLOR, { roughness: 0.55 }),
      lid: this.material(BOX_COLOR, { roughness: 0.55, xray: true }),
      rod: this.material(ROD_COLOR, { roughness: 0.42, section: '#5fa8d3' }),
      magnet: this.material('#aeb4bd', { roughness: 0.28, metalness: 0.85, section: '#6b7380' }),
      rings: COLORS.map((c) => this.material(c.hex, { roughness: 0.38, section: c.hex })),
    };
    this.mats.magnet.front.emissive = new THREE.Color('#ff7a1a');
    this.mats.magnet.front.emissiveIntensity = 0;

    this.baseObj = this.makeObject(m.base, this.mats.base);
    this.boxGroup.add(this.baseObj);
    this.lidObj = this.makeObject(m.lid, this.mats.lid);
    this.lidGroup.add(this.lidObj);
    this.lidPivot.position.set(0, d.yHinge, d.zHinge);
    this.lidGroup.position.set(0, -d.yHinge, -d.zHinge);

    // magneti: 2 nella base, 2 nel coperchio
    this.magnets = [];
    for (const side of [-1, 1]) {
      const mb = this.makeObject(m.magnet, this.mats.magnet, { edges: false });
      mb.position.set(side * d.magBaseX, d.magBase.y, d.magBase.z);
      this.boxGroup.add(mb);
      const ml = this.makeObject(m.magnet, this.mats.magnet, { edges: false });
      ml.position.set(side * d.magLidX, d.magLid.y, d.magLid.z);
      this.lidGroup.add(ml);
      this.magnets.push(mb, ml);
    }

    // aste nel riferimento del coperchio
    this.rods = d.chX.map((x, i) => {
      const obj = this.makeObject(m.rod, this.mats.rod, { crease: 40 });
      obj.userData.x = x;
      this.lidGroup.add(obj);
      return obj;
    });
    // bersagli invisibili per cliccare le aste a coperchio aperto
    this.hitTargets = d.chX.map((x, i) => {
      const len = d.rodLen - d.seatDepth + 14;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, len, 16),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
      );
      mesh.position.set(x, d.yBarFront - len / 2, d.zAxis);
      mesh.userData.rod = i;
      this.lidGroup.add(mesh);
      return mesh;
    });

    // 40 anelli nel riferimento della scatola
    this.ringObjs = this.state.rings.map((r) => {
      const obj = this.makeObject(m.ring, this.mats.rings[r.color], { crease: 40 });
      this.boxGroup.add(obj);
      return obj;
    });

    this.buildPrintBeds(model);
    this.applyState();
  }

  buildPrintBeds(model) {
    const bed = 256;
    const beds = [
      { label: 'Scatola', parts: [{ id: 'scatola', color: BOX_COLOR }] },
      { label: 'Anelli', parts: COLORS.map((c, k) => ({ id: 'anelli', color: c.hex, dx: 0, dy: k * 26 })) },
      { label: 'Aste', parts: [{ id: 'aste', color: ROD_COLOR }] },
      { label: 'Piatto di prova', parts: [{ id: 'prova', color: '#c9d6de' }] },
    ];
    const plateMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 });
    const gridMat = new THREE.LineBasicMaterial({ color: '#4a525d' });
    beds.forEach((b, i) => {
      const g = new THREE.Group();
      g.position.set(((i % 2) - 0.5) * (bed + 30), (0.5 - Math.floor(i / 2)) * (bed + 30), 0);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(bed, bed, 2), plateMat);
      plate.position.z = -1;
      g.add(plate);
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const v = -bed / 2 + (k * bed) / 8;
        pts.push(v, -bed / 2, 0.05, v, bed / 2, 0.05, -bed / 2, v, 0.05, bed / 2, v, 0.05);
      }
      const grid = new THREE.BufferGeometry();
      grid.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(grid, gridMat));
      const placed = [];
      for (const part of b.parts) {
        const src = model.parts.find((p) => p.id === part.id);
        const obj = this.makeObject(src.print, this.material(part.color, { roughness: 0.5 }));
        obj.userData.dy = part.dy ?? 0;
        placed.push(obj);
        g.add(obj);
      }
      // centra il contenuto sul piatto
      const box = new THREE.Box3();
      placed.forEach((o) => { o.position.y = o.userData.dy; o.updateMatrixWorld(true); box.expandByObject(o); });
      const c = box.getCenter(new THREE.Vector3());
      placed.forEach((o) => { o.position.x -= c.x; o.position.y -= c.y; });
      g.add(this.textSprite(b.label, [0, bed / 2 + 14, 1]));
      this.printGroup.add(g);
    });
  }

  // Etichetta di testo sempre rivolta alla camera.
  textSprite(text, [x, y, z]) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = '600 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 48;
    c.width = w;
    c.height = 96;
    ctx.font = font;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 96, 48);
    ctx.fill();
    ctx.fillStyle = '#17202a';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 24, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const h = 16;
    sprite.scale.set((h * w) / 96, h, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 10;
    return sprite;
  }

  // ------------------------------------------------------------ stato
  // Trasforma una posa nel riferimento del coperchio in quello della scatola.
  lidToBox(pos, quat, outPos, outQuat) {
    const d = this.dims;
    const a = -this.state.theta * DEG;
    const dy = pos.y - d.yHinge;
    const dz = pos.z - d.zHinge;
    outPos.set(pos.x, d.yHinge + dy * Math.cos(a) - dz * Math.sin(a), d.zHinge + dy * Math.sin(a) + dz * Math.cos(a));
    this._q ??= new THREE.Quaternion();
    this._q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    outQuat.copy(this._q).multiply(quat);
  }

  // Posa di un anello sull'asta/binario: x del binario, u = distanza del suo
  // bordo posteriore dalla faccia della barra.
  ringLidPose(r, pos, quat) {
    const d = this.dims;
    pos.set(r.x, d.yBarFront - r.u - d.p.ringL / 2, d.zAxis);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.roll);
  }

  applyState() {
    const d = this.dims;
    if (!d) return;
    const s = this.state;
    this.lidPivot.rotation.x = -s.theta * DEG;
    const [sx, sy, sz, sr] = s.shake;
    this.boxGroup.position.set(sx, sy, sz);
    this.boxGroup.rotation.set(sr * 0.6, sr, sr * 0.3);
    this.rods.forEach((obj, i) => {
      obj.visible = s.rodsVisible;
      obj.position.set(obj.userData.x, -d.p.rodTail - s.rodPull[i], d.zAxis);
    });
    const lp = new THREE.Vector3();
    const lq = new THREE.Quaternion();
    s.rings.forEach((r, i) => {
      const obj = this.ringObjs[i];
      obj.visible = !r.hidden;
      if (r.frame === 'free') {
        obj.position.copy(r.pos);
        obj.quaternion.copy(r.quat);
      } else {
        this.ringLidPose(r, lp, lq);
        this.lidToBox(lp, lq, obj.position, obj.quaternion);
      }
    });
    this.mats.lid.front.opacity = s.xray ? 0.2 : 1;
    this.mats.lid.front.depthWrite = !s.xray;
    this.mats.magnet.front.emissiveIntensity = s.magnetGlow;
    for (const mg of this.magnets) mg.visible = s.xray || s.section !== null || s.magnetGlow > 0;
    const sec = s.section;
    const sectionOn = sec !== null;
    if (sec?.axis === 'y') {
      // CAD y → mondo -z: si tiene la parte con y ≥ valore
      this.clipPlane.normal.set(0, 0, -1);
      this.clipPlane.constant = -sec.value;
    } else {
      this.clipPlane.normal.set(-1, 0, 0);
      this.clipPlane.constant = sectionOn ? sec.value : 1e6;
    }
    this.root.traverse((o) => { if (o.userData.back) o.userData.back.visible = sectionOn; });
  }

  frame() {
    this.controls.update();
    this.applyState();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ camera
  viewFor(name) {
    const v = typeof name === 'string' ? VIEWS[name] : name;
    const target = new THREE.Vector3(...v.target);
    const dir = new THREE.Vector3(...v.pos).sub(target);
    const aspect = this.camera.aspect || 1;
    if (aspect < 1.3) dir.multiplyScalar((1.3 / aspect) ** 0.6);
    return { pos: target.clone().add(dir), target };
  }

  applyView(v) {
    const { pos, target } = this.viewFor(v);
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  flyTo(name, ms = 900, token = null) {
    const { pos, target } = this.viewFor(name);
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    return tween({}, {}, ms, {
      easing: ease.inOut, token,
      onUpdate: (e) => {
        this.camera.position.lerpVectors(p0, pos, e);
        this.controls.target.lerpVectors(t0, target, e);
      },
    });
  }

  setMode(mode) {
    this.mode = mode;
    const print = mode === 'stampa';
    this.printGroup.visible = print;
    this.boxGroup.visible = !print;
    this.shadow.visible = !print;
  }

  // ------------------------------------------------------------ gioco
  setPlayEnabled(on) {
    this.playEnabled = on;
    if (!on) this.setHover(-1);
    this.container.classList.toggle('playing', on);
  }

  setHover(i) {
    if (this.hovered === i) return;
    this.hovered = i;
    this.hitTargets.forEach((t, k) => { t.material.opacity = k === i ? 0.12 : k === this.selected ? 0.08 : 0; });
    this.onHover?.(i);
  }

  setSelected(i) {
    this.selected = i;
    this.hitTargets.forEach((t, k) => { t.material.opacity = k === this.hovered ? 0.12 : k === i ? 0.08 : 0; });
  }

  pickRod(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0];
    return hit ? hit.object.userData.rod : -1;
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || !this.playEnabled) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return; // era una rotazione della camera
      const i = this.pickRod(e);
      if (i >= 0) this.onRodClick?.(i);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.playEnabled || e.pointerType !== 'mouse') return;
      this.setHover(this.pickRod(e));
    });
    el.addEventListener('pointerleave', () => this.setHover(-1));
  }
}
