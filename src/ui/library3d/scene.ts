import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DeskLamp } from './lamp';
import { dustMaterial, wallMaterial, woodMaterial } from './shaders';
import { leatherTexture, pagesTexture, spineTextures } from './textures';

/**
 * Das Bücherregal als 3D-Szene. Die Szene kennt keine Projekte, nur Bücher mit Maßen in
 * CSS-Pixeln. Die Kamera ist so gestellt, dass die Ebene der Buchrücken (z = 0) genau dem
 * Pixelraster des Canvas entspricht; so liegen die unsichtbaren Knöpfe darüber, die Klick,
 * Tastatur und Screenreader übernehmen, ohne Umrechnung an der richtigen Stelle.
 */

export const U = 0.01; // Welt-Einheiten je CSS-Pixel
export const TOP_PAD = 46; // Platz über dem obersten Brett für herausgezogene Bücher
export const ROW_BOOKS = 260; // Höhe eines Fachs bis zum Brett
export const PLANK = 16;
export const ROW_GAP = 34;
export const ROW_H = ROW_BOOKS + PLANK + ROW_GAP;
const BOTTOM_PAD = 30;

const BOOK_DEPTH = 1.45;
const SHELF_DEPTH = 1.75;
const BOOK_FRONT = 0.1;

export interface BookSpec {
  id: string;
  name: string;
  color: string;
  deco: number;
  seed: number;
  w: number;
  h: number;
  /** linke Kante in px */
  x: number;
  row: number;
}

export interface ShelfSpec {
  width: number;
  rows: number;
  books: BookSpec[];
  /** Bücherstütze je Brett: x in px */
  bookends: number[];
  /** Platz für ein neues Buch: x in px und Brett */
  slot: { x: number; row: number; w: number; h: number } | null;
  /** Schreibtischlampe: Mitte in px und Brett */
  lamp: { x: number; row: number } | null;
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function shelfHeight(rows: number): number {
  return TOP_PAD + rows * ROW_H - ROW_GAP + BOTTOM_PAD;
}

/** Unterkante der Bücher (Oberkante des Bretts) in px von oben. */
function rowFloor(row: number): number {
  return TOP_PAD + row * ROW_H + ROW_BOOKS;
}

interface Pose {
  z: number;
  y: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
}

const REST: Pose = { z: 0, y: 0, rx: 0, ry: 0, rz: 0, s: 1 };

interface BookObj {
  spec: BookSpec;
  key: string;
  group: THREE.Group;
  mesh: THREE.Mesh;
  pose: Pose;
  vel: Pose;
  /** Zeitpunkt, ab dem das Buch ins Regal gleitet (Einflug) */
  enterAt: number;
  dispose: () => void;
}

const THEMES = {
  light: {
    wall: '#e9e3d6',
    woodLight: '#d2b48a',
    woodDark: '#9c7a4f',
    hemiSky: '#fff6e6',
    hemiGround: '#8a7656',
    hemi: 1.35,
    key: 2.4,
    keyColor: '#fff1dc',
    fill: 0.7,
    env: 0.45,
    dust: 0.16,
    exposure: 1.05,
  },
  dark: {
    wall: '#2a2622',
    woodLight: '#5a4634',
    woodDark: '#2c2119',
    hemiSky: '#6a6a80',
    hemiGround: '#1a140f',
    hemi: 0.2,
    key: 0.7,
    keyColor: '#b9c3e0',
    fill: 0.08,
    env: 0.16,
    dust: 0.6,
    exposure: 1.0,
  },
};

export class LibraryScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private pmrem: THREE.PMREMGenerator;
  private cabinet = new THREE.Group();
  private books = new Map<string, BookObj>();
  private leather = leatherTexture();
  private pages: THREE.CanvasTexture;
  private pagesMat: THREE.MeshStandardMaterial;
  private wood: ReturnType<typeof woodMaterial>;
  private woodV: ReturnType<typeof woodMaterial>;
  private wall: ReturnType<typeof wallMaterial>;
  private bookendMat = new THREE.MeshStandardMaterial({ color: '#3b3632', metalness: 0.85, roughness: 0.38 });
  private hemi = new THREE.HemisphereLight();
  private key = new THREE.SpotLight();
  private fill = new THREE.DirectionalLight();
  private dust: THREE.Points;
  private dustMat = dustMaterial();

  private spec: ShelfSpec = { width: 0, rows: 0, books: [], bookends: [], slot: null, lamp: null };
  private size = { w: 1, h: 1 };
  private dark = false;
  /** 0 = hell (Tageslicht), 1 = dunkel (nur die Lampe); läuft weich hinterher */
  private mix = 0;
  private themed = false;
  readonly lamp = new DeskLamp();
  private reduced = false;
  private hovered: string | null = null;
  private selected: string | null = null;
  private opening: string | null = null;
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private raf = 0;
  private last = 0;
  private time = 0;
  private start = performance.now();
  private disposed = false;

  /** Wird nach jedem Bild mit den Bildschirm-Rechtecken der Bücher aufgerufen. */
  onFrame: (rects: Map<string, ScreenRect>, slot: ScreenRect | null, lamp: ScreenRect | null) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.pages = pagesTexture(false); // Papier und Gold bleiben gleich, nur das Licht wechselt
    this.pagesMat = new THREE.MeshStandardMaterial({ map: this.pages, roughness: 0.92 });
    this.wood = woodMaterial(new THREE.Color(), new THREE.Color());
    this.woodV = woodMaterial(new THREE.Color(), new THREE.Color(), true);
    this.wall = wallMaterial(new THREE.Color());

    this.scene.add(this.cabinet, this.hemi, this.key, this.key.target, this.fill, this.lamp);
    this.lamp.visible = false;
    this.key.castShadow = true;
    this.key.angle = 0.95;
    this.key.penumbra = 0.85;
    this.key.decay = 0;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 6;
    this.fill.position.set(-6, 2, 9);

    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.applyTheme();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setReducedMotion(r: boolean) {
    this.dirty = true;
    this.reduced = r;
    this.dust.visible = !r;
  }

  setPointer(x: number, y: number) {
    // -1 … 1 über das Fenster; bewegt die Kamera ein wenig mit
    this.pointer.set(x, y);
  }

  setState(s: { hovered: string | null; selected: string | null; opening: string | null }) {
    this.dirty = true;
    this.hovered = s.hovered;
    this.selected = s.selected;
    this.opening = s.opening;
  }

  /** Hell oder dunkel. Beim ersten Aufruf sofort, danach schaltet die Lampe und der Raum folgt. */
  setTheme(dark: boolean) {
    const first = !this.themed;
    this.themed = true;
    if (dark === this.dark && !first) return;
    this.dark = dark;
    this.lamp.setOn(dark, this.time, first || this.reduced);
    if (first || this.reduced) this.mix = dark ? 1 : 0;
    this.dirty = true;
  }

  /** Klick auf den Knopf: sofort sichtbar drücken, bevor das Design umschaltet */
  pressLamp() {
    this.lamp.press(this.time);
    this.dirty = true;
  }

  /** Fonts sind geladen: Titel neu zeichnen, falls der Rücken mit der Ersatzschrift entstand. */
  redrawSpines() {
    this.dirty = true;
    for (const b of [...this.books.values()]) {
      const pose = b.pose;
      this.removeBook(b.spec.id);
      const nb = this.addBook(b.spec, false);
      nb.pose = pose;
    }
  }

  private dustKey = new THREE.Vector3();
  private dustLamp = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();

  /** Mischt helle und dunkle Lichtstimmung nach `this.mix`. */
  private applyTheme() {
    const L = THEMES.light;
    const D = THEMES.dark;
    const m = this.mix;
    const num = (a: number, b: number) => a + (b - a) * m;
    const col = (target: THREE.Color, a: string, b: string) => target.copy(this.c1.set(a)).lerp(this.c2.set(b), m);
    col(this.wall.userData.uniforms.uColor.value, L.wall, D.wall);
    for (const w of [this.wood, this.woodV]) {
      col(w.userData.uniforms.uLight.value, L.woodLight, D.woodLight);
      col(w.userData.uniforms.uDark.value, L.woodDark, D.woodDark);
    }
    col(this.hemi.color, L.hemiSky, D.hemiSky);
    col(this.hemi.groundColor, L.hemiGround, D.hemiGround);
    this.hemi.intensity = num(L.hemi, D.hemi);
    col(this.key.color, L.keyColor, D.keyColor);
    this.key.intensity = num(L.key, D.key);
    this.fill.intensity = num(L.fill, D.fill);
    this.scene.environmentIntensity = num(L.env, D.env);
    this.dustMat.uniforms.uOpacity!.value = num(L.dust, D.dust);
    this.dustMat.uniforms.uLight!.value.lerpVectors(this.dustKey, this.dustLamp, m);
    this.renderer.toneMappingExposure = num(L.exposure, D.exposure);
  }

  resize(w: number, h: number) {
    this.dirty = true;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dustMat.uniforms.uPixelRatio!.value = this.renderer.getPixelRatio();
  }

  setShelf(spec: ShelfSpec) {
    this.dirty = true;
    const old = this.spec;
    this.spec = spec;
    if (old.width !== spec.width || old.rows !== spec.rows) this.buildCabinet();
    this.lamp.visible = !!spec.lamp;
    if (spec.lamp) {
      this.lamp.position.set(spec.lamp.x * U, -rowFloor(spec.lamp.row) * U, BOOK_FRONT - SHELF_DEPTH * 0.45);
      this.lamp.scale.setScalar(1.25); // eine echte Bankerlampe ist gut eineinhalb Bücher hoch
    }

    const keep = new Set(spec.books.map((b) => b.id));
    for (const id of [...this.books.keys()]) if (!keep.has(id)) this.removeBook(id);
    const now = this.time;
    let i = 0;
    for (const b of spec.books) {
      const k = this.keyOf(b);
      const cur = this.books.get(b.id);
      if (cur && cur.key === k) {
        cur.spec = b;
        this.place(cur);
        continue;
      }
      const pose = cur?.pose;
      if (cur) this.removeBook(b.id);
      const fresh = !pose;
      const nb = this.addBook(b, fresh);
      if (pose) nb.pose = pose;
      else nb.enterAt = now + 0.12 + 0.05 * i++;
    }

    // Kamera: z = 0 entspricht genau dem Pixelraster
    const H = this.size.h * U;
    // etwas Abstand dazu, damit die vorderen Kanten der Seitenwände nicht aus dem Bild ragen
    const dist = (H / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.1;
    this.camDist = dist;

    // Licht: Lampe oben vorn, Kegel über das ganze Regal
    const cx = (spec.width * U) / 2;
    const cy = -(this.size.h * U) / 2;
    this.key.position.set(cx + 1.2, 1.5 + Math.max(3.5, H * 0.45), 4.2);
    this.key.target.position.set(cx, cy - H * 0.1, -SHELF_DEPTH);
    this.key.angle = Math.min(1.2, Math.atan2(Math.max(spec.width * U, H) * 0.62, 6.5));
    const sc = this.key.shadow.camera;
    sc.near = 1;
    sc.far = 30;
    sc.updateProjectionMatrix();

    // Staub nur im Inneren des Regals
    this.dust.position.set(0.3, -H + (BOTTOM_PAD + PLANK) * U, -SHELF_DEPTH);
    this.dust.scale.set(spec.width * U - 0.6, H - (TOP_PAD + BOTTOM_PAD + PLANK) * U, SHELF_DEPTH + 0.3);
    // Staub leuchtet unter der Lichtquelle: tagsüber unter der Deckenlampe, abends unter der Schreibtischlampe
    this.dustKey.copy(this.key.position).sub(this.dust.position).divide(this.dust.scale);
    this.lamp.updateWorldMatrix(true, true);
    this.lamp.spot.getWorldPosition(this.dustLamp).sub(this.dust.position).divide(this.dust.scale);
    this.applyTheme();
  }

  private camDist = 10;
  private frame = 0;
  /** erzwingt ein neues Bild, auch wenn sich nichts bewegt */
  private dirty = true;

  private keyOf(b: BookSpec) {
    return `${b.name}|${b.color}|${b.deco}|${b.w}|${b.h}`;
  }

  private buildCabinet() {
    for (const c of [...this.cabinet.children]) {
      this.cabinet.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const { width, rows } = this.spec;
    const W = width * U;
    const H = shelfHeight(rows) * U;
    const side = 0.16;
    const back = -SHELF_DEPTH - 0.02;

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, H + 0.4), this.wall);
    wall.position.set(W / 2, -H / 2 + 0.2, back);
    wall.receiveShadow = true;
    this.cabinet.add(wall);

    // Seitenwände und Deckel
    for (const x of [side / 2 - 0.02, W - side / 2 + 0.02]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(side, H, SHELF_DEPTH + 0.34), this.woodV);
      s.position.set(x, -H / 2, back + (SHELF_DEPTH + 0.34) / 2);
      s.castShadow = s.receiveShadow = true;
      this.cabinet.add(s);
    }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, side, SHELF_DEPTH + 0.36), this.wood);
    lid.position.set(W / 2, -side / 2, back + (SHELF_DEPTH + 0.36) / 2);
    lid.castShadow = lid.receiveShadow = true;
    this.cabinet.add(lid);

    // Bretter: Oberkante genau auf der Unterkante der Bücher, vorn mit einer Kante
    for (let r = 0; r < rows; r++) {
      const top = -rowFloor(r) * U;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(W - side * 2 + 0.04, PLANK * U, SHELF_DEPTH + 0.3), this.wood);
      plank.position.set(W / 2, top - (PLANK * U) / 2, back + (SHELF_DEPTH + 0.3) / 2);
      plank.castShadow = plank.receiveShadow = true;
      this.cabinet.add(plank);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W - side * 2 + 0.04, PLANK * U * 1.5, 0.05), this.wood);
      lip.position.set(W / 2, top - (PLANK * U * 1.5) / 2 + 0.01, back + SHELF_DEPTH + 0.3 + 0.025);
      lip.castShadow = lip.receiveShadow = true;
      this.cabinet.add(lip);
    }

    // Buchstützen aus dunklem Metall
    this.spec.bookends.forEach((x, r) => {
      const floor = -rowFloor(r) * U;
      const g = new THREE.Group();
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.95), this.bookendMat);
      upright.position.set(0.025, 0.6, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.95), this.bookendMat);
      foot.position.set(0.21, 0.015, 0);
      for (const m of [upright, foot]) {
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      g.position.set(x * U + 0.04, floor, BOOK_FRONT - BOOK_DEPTH / 2 - 0.05);
      this.cabinet.add(g);
    });
  }

  private addBook(spec: BookSpec, fresh: boolean): BookObj {
    const w = spec.w * U;
    const h = spec.h * U;
    const geo = new THREE.BoxGeometry(w, h, BOOK_DEPTH, 12, 1, 1);
    // Rücken wölben: Ecken der Vorderseite bleiben, die Mitte tritt hervor
    const p = geo.attributes.position as THREE.BufferAttribute;
    const bulge = Math.min(0.06, w * 0.12);
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (z > BOOK_DEPTH / 2 - 1e-4) {
        const t = (p.getX(i) / w) * 2;
        p.setZ(i, z + bulge * (1 - t * t));
      }
    }
    geo.computeVertexNormals();
    geo.translate(0, h / 2, -BOOK_DEPTH / 2);

    const { map, rm } = spineTextures({ name: spec.name, color: spec.color, deco: spec.deco, w: spec.w, h: spec.h, dark: false, seed: spec.seed });
    const bump = this.leather.clone();
    bump.repeat.set(spec.w / 60, spec.h / 60);
    bump.needsUpdate = true;
    const spine = new THREE.MeshStandardMaterial({ map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1, bumpMap: bump, bumpScale: 0.6 });
    const coverBump = this.leather.clone();
    coverBump.repeat.set(BOOK_DEPTH * 2, h * 2);
    coverBump.needsUpdate = true;
    const cover = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).multiplyScalar(0.92), roughness: 0.78, bumpMap: coverBump, bumpScale: 0.6 });
    // Reihenfolge der Flächen bei BoxGeometry: +x, -x, +y, -y, +z (Rücken), -z (Schnitt)
    const mesh = new THREE.Mesh(geo, [cover, cover, this.pagesMat, this.pagesMat, spine, this.pagesMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    this.scene.add(group);

    const obj: BookObj = {
      spec,
      key: this.keyOf(spec),
      group,
      mesh,
      pose: fresh && !this.reduced ? { ...REST, z: -1.25, rz: 0 } : { ...REST },
      vel: { ...REST, s: 0 },
      enterAt: 0,
      dispose: () => {
        geo.dispose();
        for (const t of [map, rm, bump, coverBump]) t.dispose();
        spine.dispose();
        cover.dispose();
      },
    };
    this.books.set(spec.id, obj);
    this.place(obj);
    return obj;
  }

  private removeBook(id: string) {
    const b = this.books.get(id);
    if (!b) return;
    this.scene.remove(b.group);
    b.dispose();
    this.books.delete(id);
  }

  /** Grundstellung im Regal: links unten an der Ecke des Fachs, vorn bündig. */
  private place(b: BookObj) {
    const { x, w, row } = b.spec;
    b.group.position.set((x + w / 2) * U, -rowFloor(row) * U, BOOK_FRONT);
  }

  private target(b: BookObj): Pose {
    const id = b.spec.id;
    if (this.time < b.enterAt) return { ...REST, z: -1.25 };
    if (this.opening === id) return { z: 2.1, y: 0.42, rx: 0.04, ry: -1.18, rz: 0, s: 1.08 };
    if (this.selected === id) return { z: 0.62, y: 0.12, rx: 0.02, ry: -0.1, rz: 0.01, s: 1 };
    if (this.hovered === id) return { z: 0.2, y: 0.06, rx: 0, ry: -0.03, rz: 0, s: 1 };
    if (this.opening) return { ...REST, z: -0.04 };
    return REST;
  }

  private loop(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.time = (now - this.start) / 1000;

    // Federn: kritisch gedämpft, kein Überschwingen beim Ablegen, leichtes beim Herausziehen
    const k = 170;
    const d = 2 * Math.sqrt(k) * 0.82;
    let moving = false;
    for (const b of this.books.values()) {
      const t = this.target(b);
      const p = b.pose;
      const v = b.vel;
      for (const f of ['z', 'y', 'rx', 'ry', 'rz', 's'] as const) {
        if (this.reduced) {
          p[f] = t[f];
          v[f] = 0;
          continue;
        }
        const a = k * (t[f] - p[f]) - d * v[f];
        v[f] += a * dt;
        p[f] += v[f] * dt;
        if (Math.abs(v[f]) > 1e-3 || Math.abs(t[f] - p[f]) > 1e-3) moving = true;
      }
      const g = b.group;
      g.position.z = BOOK_FRONT + p.z;
      g.position.y = -rowFloor(b.spec.row) * U + p.y;
      g.rotation.set(p.rx, p.ry, p.rz);
      g.scale.setScalar(p.s);
    }

    // Raumlicht folgt der Lampe: erst klickt der Schalter, dann dimmt bzw. hellt der Raum
    const want = this.dark ? 1 : 0;
    if (Math.abs(want - this.mix) > 1e-3) {
      this.mix += (want - this.mix) * (this.reduced ? 1 : 1 - Math.exp(-dt * 3.2));
      if (Math.abs(want - this.mix) <= 1e-3) this.mix = want;
      this.applyTheme();
      moving = true;
    }
    if (this.lamp.update(this.time, dt, this.reduced)) moving = true;

    // Kamera folgt der Maus ein wenig: das Regal bekommt Tiefe, ohne dass etwas wackelt
    const follow = this.reduced ? 1 : 1 - Math.exp(-dt * 3);
    const aim = this.reduced ? new THREE.Vector2() : this.pointer;
    if (this.pointerSmooth.distanceTo(aim) > 1e-3) moving = true;
    this.pointerSmooth.lerp(aim, follow);
    // Ruht alles, reicht ein Bild ab und zu für den Staub; das schont Akku und Lüfter
    this.frame++;
    if (!moving && !this.dirty && (!this.dust.visible || this.frame % 3)) return;
    this.dirty = false;
    const cx = (this.spec.width * U) / 2;
    const cy = -(this.size.h * U) / 2;
    this.camera.position.set(cx + this.pointerSmooth.x * 0.22, cy - this.pointerSmooth.y * 0.14, this.camDist);
    this.camera.lookAt(cx + this.pointerSmooth.x * 0.08, cy - this.pointerSmooth.y * 0.05, 0);

    this.dustMat.uniforms.uTime!.value = this.time;
    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.rects(), this.slotRect(), this.lamp.visible ? this.project(this.lamp.buttonBox(this.box)) : null);
  }

  private v = new THREE.Vector3();
  private box = new THREE.Box3();

  private project(box: THREE.Box3): ScreenRect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      const sx = ((this.v.x + 1) / 2) * this.size.w;
      const sy = ((1 - this.v.y) / 2) * this.size.h;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private rects(): Map<string, ScreenRect> {
    const out = new Map<string, ScreenRect>();
    for (const b of this.books.values()) {
      // nur die Vorderseite: so trifft der Knopf den Rücken, nicht die ganze Tiefe
      b.mesh.geometry.computeBoundingBox();
      this.box.copy(b.mesh.geometry.boundingBox!);
      this.box.min.z = this.box.max.z - 0.02;
      this.box.applyMatrix4(b.mesh.matrixWorld);
      out.set(b.spec.id, this.project(this.box));
    }
    return out;
  }

  private slotRect(): ScreenRect | null {
    const s = this.spec.slot;
    if (!s) return null;
    const floor = -rowFloor(s.row) * U;
    this.box.min.set(s.x * U, floor, BOOK_FRONT);
    this.box.max.set((s.x + s.w) * U, floor + s.h * U, BOOK_FRONT);
    return this.project(this.box);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const id of [...this.books.keys()]) this.removeBook(id);
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of [this.wood, this.woodV, this.wall, this.pagesMat, this.bookendMat, this.dustMat]) m.dispose();
    this.lamp.dispose();
    this.leather.dispose();
    this.pages.dispose();
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
