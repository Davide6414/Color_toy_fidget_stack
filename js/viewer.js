// Scena three.js: pezzi, materiali, sezione, esploso, trascinamento dei dischi
// e cinematica dei meccanismi elastici applicata a ogni fotogramma.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeDetent, fingerDeflection } from './mechanics.js';
import { tween, ease } from './anim.js';

const DEG = Math.PI / 180;
export const EXPLODE_STEP = 16; // mm tra un livello e l'altro nell'esploso
const PEN_LENGTH = 70;

const SECTION_COLORS = { base: '#e4572e', cap: '#8f99ab' };

// Inquadrature in coordinate mondo (Y in alto, mm).
const VIEWS = {
  home: { pos: [58, 62, 84], target: [0, 8, 0] },
  top: { pos: [0, 150, 1], target: [0, 10, 0] },
  hub: { pos: [0, 86, 16], target: [0, 12, 0] },
  section: { pos: [24, 34, 104], target: [0, 9, 0] },
  sectionHigh: { pos: [26, 46, 136], target: [0, 18, 0] },
  sectionLow: { pos: [18, -14, 120], target: [0, 2, 0] },
  assembly: { pos: [100, 100, 140], target: [0, 26, 0] },
  exploded: { pos: [122, 112, 172], target: [0, 41, 0] },
};

export function createState() {
  return {
    explode: 0,
    discAngle: [0, 30, 0],
    discLift: [0, 0, 0],
    capLift: 0,
    capSpin: 0,
    penZ: null,
    visible: { base: true, 'disc-y': true, 'disc-m': true, 'disc-c': true, cap: true },
    exaggerate: 3,
    section: false,
  };
}

function bufferGeometry({ positions, indices }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

// Spigoli vivi per il contorno tecnico. A differenza di EdgesGeometry ignora i
// triangoli "ago" (area quasi nulla) che le booleane lasciano sulle facce
// piane: la loro normale è inaffidabile e produrrebbe linee spurie.
function featureEdges({ positions: p, indices: ix }, thresholdDeg) {
  const nTri = ix.length / 3;
  const nVert = p.length / 3;
  const normals = new Float64Array(nTri * 3);
  const needle = new Uint8Array(nTri);
  const longest = new Float64Array(nTri);
  const key = (a, b) => (a < b ? a * nVert + b : b * nVert + a);
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = [ix[3 * t] * 3, ix[3 * t + 1] * 3, ix[3 * t + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const e = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => {
      const pi = ix[3 * t + i] * 3, pj = ix[3 * t + j] * 3;
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
  // Gli "aghi" ereditano la normale dai vicini attraverso i lati corti
  // (il lato lungo può essere proprio uno spigolo vivo).
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grad.addColorStop(0, 'rgba(40,32,20,0.32)');
  grad.addColorStop(0.55, 'rgba(40,32,20,0.12)');
  grad.addColorStop(1, 'rgba(40,32,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Viewer {
  constructor(container, { onDetentClick, onSnap, onUserRotate } = {}) {
    this.container = container;
    this.state = createState();
    this.onDetentClick = onDetentClick;
    this.onSnap = onSnap;
    this.onUserRotate = onUserRotate;
    this.parts = new Map();
    this.prevGroove = [null, null, null];
    this.prevFinger = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.domElement.className = 'gl';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels';
    container.appendChild(this.labelRenderer.domElement);

    const scene = new THREE.Scene();
    // Sfondo chiaro e opaco: i dischi usano la miscelazione moltiplicativa
    // (come filtri colorati) e hanno bisogno di qualcosa da "filtrare".
    scene.background = new THREE.Color('#e8e6e1');
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 4000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 600;

    scene.add(new THREE.HemisphereLight('#ffffff', '#b8b2a6', 2.1));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(50, 120, 70);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.7);
    fill.position.set(-80, 40, -60);
    scene.add(fill);

    // Il modello CAD ha Z in alto: lo ruotiamo per avere Y in alto in three.js.
    this.root = new THREE.Group();
    this.root.rotation.x = -Math.PI / 2;
    scene.add(this.root);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(52, 64),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.position.z = -0.05;
    shadow.renderOrder = -1;
    this.root.add(shadow);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
    this.clipPlanes = [this.clipPlane];

    this.pen = this.buildPen();
    this.root.add(this.pen);

    this.raycaster = new THREE.Raycaster();
    this.pickables = [];
    this.drag = null;
    this.bindPointer();

    this.applyView(VIEWS.home);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ modello
  setModel(model) {
    for (const p of this.parts.values()) {
      this.root.remove(p.group);
      p.group.traverse((o) => { o.geometry?.dispose(); });
      for (const m of Object.values(p.mats)) m.dispose();
      this.root.remove(p.label);
      p.label.element.remove();
    }
    this.parts.clear();
    this.pickables = [];
    this.model = model;
    this.dims = model.dims;
    this.detent = makeDetent(model.dims);
    for (const part of model.parts) this.addPart(part);
    this.prevGroove = [null, null, null];
  }

  materialsFor(part) {
    const clippingPlanes = this.clipPlanes;
    if (part.kind === 'disc') {
      const common = {
        color: part.color, transparent: true, depthWrite: false,
        blending: THREE.MultiplyBlending, premultipliedAlpha: true, clippingPlanes,
      };
      return {
        front: new THREE.MeshStandardMaterial({ ...common, roughness: 0.2, metalness: 0 }),
        back: new THREE.MeshBasicMaterial({ ...common, side: THREE.BackSide }),
        edges: new THREE.LineBasicMaterial({ color: '#1c1e24', transparent: true, opacity: 0.3, clippingPlanes }),
      };
    }
    return {
      front: new THREE.MeshStandardMaterial({
        color: part.color, roughness: part.kind === 'cap' ? 0.42 : 0.62, metalness: 0, clippingPlanes,
      }),
      back: new THREE.MeshBasicMaterial({ color: SECTION_COLORS[part.kind], side: THREE.BackSide, clippingPlanes }),
      edges: new THREE.LineBasicMaterial({
        color: part.kind === 'cap' ? '#000000' : '#5d5850', transparent: true,
        opacity: part.kind === 'cap' ? 0.55 : 0.35, clippingPlanes,
      }),
    };
  }

  makePieceObject(mesh, mats, part) {
    const geo = bufferGeometry(mesh);
    const shaded = toCreasedNormals(geo, 32 * DEG);
    const group = new THREE.Group();
    const front = new THREE.Mesh(shaded, mats.front);
    const back = new THREE.Mesh(shaded, mats.back);
    back.visible = false; // facce interne: servono solo a "riempire" la sezione
    const edges = new THREE.LineSegments(featureEdges(mesh, 24), mats.edges);
    geo.dispose();
    group.add(back, front, edges);
    return { group, front, back };
  }

  addPart(part) {
    const mats = this.materialsFor(part);
    const group = new THREE.Group();
    group.name = part.id;
    const entry = { part, group, arms: [], fingers: [], backs: [], mats };
    for (const piece of part.pieces) {
      const obj = this.makePieceObject(piece.mesh, mats, part);
      entry.backs.push(obj.back);
      if (piece.kind === 'body') {
        group.add(obj.group);
      } else {
        // Ruotiamo i pezzi elastici attorno alla loro radice per mostrarne la flessione.
        const pivot = new THREE.Group();
        pivot.position.set(...piece.pivot);
        obj.group.position.set(-piece.pivot[0], -piece.pivot[1], -piece.pivot[2]);
        pivot.add(obj.group);
        group.add(pivot);
        if (piece.kind === 'arm') entry.arms.push({ pivot, lever: piece.lever });
        if (piece.kind === 'finger') {
          const axis = new THREE.Vector3(-Math.sin(piece.beta), Math.cos(piece.beta), 0);
          entry.fingers.push({ pivot, axis, lever: piece.lever });
        }
      }
      if (part.kind === 'disc') {
        obj.front.userData.discIndex = part.index;
        this.pickables.push(obj.front);
      }
    }
    const el = document.createElement('div');
    el.className = 'part-label';
    el.innerHTML = `<span class="dot" style="background:${part.color}"></span>${part.name}`;
    entry.label = new CSS2DObject(el);
    this.root.add(entry.label);
    this.root.add(group);
    this.parts.set(part.id, entry);
  }

  buildPen() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, PEN_LENGTH - 6, 32).rotateX(Math.PI / 2).translate(0, 0, -(PEN_LENGTH - 6) / 2 - 6),
      new THREE.MeshStandardMaterial({ color: '#3567a8', roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: this.clipPlanes }),
    );
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 3.6, 6, 32).rotateX(Math.PI / 2).translate(0, 0, -3),
      new THREE.MeshStandardMaterial({ color: '#d9dde3', roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide, clippingPlanes: this.clipPlanes }),
    );
    group.add(body, tip);
    group.visible = false;
    return group;
  }

  // ------------------------------------------------------------ stato
  discZ(i) {
    const s = this.state;
    return this.dims.discZ[i] + EXPLODE_STEP * s.explode * (i + 1) + s.discLift[i];
  }

  capZ() {
    const s = this.state;
    return this.dims.hubTop + EXPLODE_STEP * s.explode * 4.2 + s.capLift;
  }

  applyState() {
    const s = this.state;
    const d = this.dims;
    if (!d) return;
    for (const [id, entry] of this.parts) {
      const { part, group } = entry;
      group.visible = s.visible[id] !== false;
      let z = 0;
      if (part.kind === 'disc') {
        const i = part.index;
        z = this.discZ(i);
        const angle = s.discAngle[i];
        group.rotation.z = angle * DEG;
        const onHub = z < d.hubTop && z + d.discT > d.baseH;
        const defl = onHub ? this.detent(angle) : 0;
        for (const arm of entry.arms) arm.pivot.rotation.z = (defl / arm.lever) * s.exaggerate;
        const groove = onHub ? Math.round(angle / d.step) : null;
        if (groove !== null && this.prevGroove[i] !== null && groove !== this.prevGroove[i] && group.visible) {
          this.onDetentClick?.(i);
        }
        this.prevGroove[i] = groove;
      } else if (part.kind === 'cap') {
        z = this.capZ();
        group.rotation.z = s.capSpin * DEG;
        const defl = fingerDeflection(d, z - d.hubTop);
        for (const f of entry.fingers) f.pivot.quaternion.setFromAxisAngle(f.axis, (defl / f.lever) * s.exaggerate);
        if (this.prevFinger > 0.02 && defl === 0 && group.visible) this.onSnap?.();
        this.prevFinger = defl;
      }
      group.position.z = z;
      for (const b of entry.backs) b.visible = s.section;
      const r = part.kind === 'base' ? d.baseR : part.kind === 'cap' ? d.capR : d.discR;
      entry.label.position.set(r + 4, 0, z + (part.kind === 'base' ? d.baseH / 2 : 1.5));
      entry.label.visible = group.visible && s.explode > 0.35;
    }
    this.pen.visible = s.penZ !== null;
    if (s.penZ !== null) this.pen.position.z = s.penZ;
  }

  updateClip() {
    if (!this.state.section) { this.clipPlane.constant = 1e6; return; }
    // Piano di sezione verticale passante per l'asse, sempre rivolto alla camera.
    const v = this.camera.position.clone().sub(this.controls.target);
    v.y = 0;
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
    v.normalize().negate();
    this.clipPlane.normal.copy(v);
    this.clipPlane.constant = 0;
  }

  frame() {
    this.controls.update();
    this.applyState();
    this.updateClip();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ camera
  viewFor(name) {
    const v = typeof name === 'string' ? VIEWS[name] : name;
    const target = new THREE.Vector3(...v.target);
    const dir = new THREE.Vector3(...v.pos).sub(target);
    // Su schermi stretti (telefono in verticale) allontaniamo la camera.
    const aspect = this.camera.aspect || 1;
    if (aspect < 1.25) dir.multiplyScalar(1.25 / aspect);
    return { pos: target.clone().add(dir), target };
  }

  applyView(v) {
    const { pos, target } = this.viewFor(v);
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  // Volo della camera; `token` permette di interrompere.
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

  // Giro della camera attorno all'asse verticale.
  orbit(deg, ms, token = null) {
    const target = this.controls.target.clone();
    const off = this.camera.position.clone().sub(target);
    return tween({}, {}, ms, {
      easing: ease.inOut, token,
      onUpdate: (e) => {
        const o = off.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg * DEG * e);
        this.camera.position.copy(target).add(o);
      },
    });
  }

  // ------------------------------------------------------------ input
  pickDisc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const visible = this.pickables.filter((m) => {
      let o = m;
      while (o) { if (!o.visible) return false; o = o.parent; }
      return true;
    });
    const hit = this.raycaster.intersectObjects(visible, false)[0];
    return hit ? hit.object.userData.discIndex : -1;
  }

  // Angolo (gradi) del puntatore sul piano del disco i, in coordinate del modello.
  pointerAngle(event, i) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray.clone().applyMatrix4(this.root.matrixWorld.clone().invert());
    if (Math.abs(ray.direction.z) < 0.25) return null; // vista troppo radente
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(this.discZ(i) + this.dims.discT / 2));
    const p = ray.intersectPlane(plane, new THREE.Vector3());
    return p ? Math.atan2(p.y, p.x) / DEG : null;
  }

  bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.dims || e.button !== 0) return;
      const i = this.pickDisc(e);
      if (i < 0) return;
      this.onUserRotate?.(i);
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      const a = this.pointerAngle(e, i);
      this.drag = { i, last: a, lastX: e.clientX, raw: this.state.discAngle[i], id: e.pointerId };
      this.container.classList.add('dragging');
    }, { capture: true }); // prima di OrbitControls, così la camera resta ferma
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        if (this.dims && e.pointerType === 'mouse') this.container.classList.toggle('can-drag', this.pickDisc(e) >= 0);
        return;
      }
      const g = this.drag;
      const a = this.pointerAngle(e, g.i);
      let delta;
      if (a === null || g.last === null) {
        delta = (e.clientX - g.lastX) * 0.6;
      } else {
        delta = ((a - g.last + 540) % 360) - 180;
      }
      g.last = a;
      g.lastX = e.clientX;
      g.raw += delta;
      this.state.discAngle[g.i] = this.detentFeel(g.raw);
    });
    const end = () => {
      if (!this.drag) return;
      const { i } = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      this.container.classList.remove('dragging');
      const step = this.dims.step;
      const target = Math.round(this.state.discAngle[i] / step) * step;
      tween(this.state.discAngle, { [i]: target }, 140, { easing: ease.out });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Sensazione di scatto durante il trascinamento: il disco "resta" nella
  // scanalatura e poi salta alla successiva.
  detentFeel(raw) {
    const step = this.dims.step;
    const f = raw / step;
    const n = Math.round(f);
    const r = f - n;
    return (n + (Math.sign(r) * Math.abs(2 * r) ** 2.4) / 2) * step;
  }

  // Ruota un disco di `steps` scatti con una breve animazione.
  rotateDisc(i, steps, ms = 200) {
    const step = this.dims.step;
    const from = Math.round(this.state.discAngle[i] / step) * step;
    return tween(this.state.discAngle, { [i]: from + steps * step }, ms * Math.abs(steps), { easing: ease.inOut });
  }

  setSection(on) {
    this.state.section = on;
  }
}
