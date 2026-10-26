import * as THREE from 'three';

/**
 * Eine klassische Bankerlampe: Messingfuß, gedrechselter Schaft, Schirm aus grünem Glas mit
 * opalweißer Innenseite. Vorn auf dem Fuß sitzt ein Druckknopf, der beim Einschalten
 * einrastet und beim Ausschalten wieder herausspringt. Eingeschaltet leuchtet der Schirm,
 * und zwei Lichter (ein Kegel nach unten, ein weiches Rundumlicht) beleuchten das Regal.
 *
 * Maße in Welt-Einheiten (1 = 100 CSS-Pixel), Ursprung in der Mitte unter dem Fuß.
 */

export const LAMP_WIDTH = 236; // px, die die Lampe im obersten Fach braucht

const SHADE_LEN = 1.0;
const SHADE_R = 0.27;
const SHADE_Y = 1.52;
const SHADE_Z = 0.12;
const SHADE_TILT = 0.28;
const ARC_FROM = -0.3;
const ARC_LEN = Math.PI + 0.6;

/** Knopfhöhe über dem Gehäuse: heraus, eingerastet, ganz gedrückt */
const BTN_OUT = 0.034;
const BTN_LATCHED = 0.014;
const BTN_DOWN = 0.002;

function brass(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#c9a25a', metalness: 1, roughness: 0.28, side: THREE.DoubleSide });
}

function lathe(profile: [number, number][], segments = 64): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export class DeskLamp extends THREE.Group {
  readonly spot = new THREE.SpotLight('#ffcf8f');
  readonly glow = new THREE.PointLight('#ffd9a0');
  private brassMat = brass();
  private glass = new THREE.MeshPhysicalMaterial({
    color: '#0e5b3d',
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    emissive: new THREE.Color('#14704a'),
    emissiveIntensity: 0,
    side: THREE.FrontSide,
  });
  private opal = new THREE.MeshStandardMaterial({
    color: '#efe6d2',
    roughness: 0.55,
    emissive: new THREE.Color('#ffdfa8'),
    emissiveIntensity: 0,
    side: THREE.BackSide,
  });
  private bulbMat = new THREE.MeshBasicMaterial({ color: '#5a5048' });
  private button: THREE.Mesh;
  private buttonMat = new THREE.MeshStandardMaterial({ color: '#ece4d2', roughness: 0.35 });
  private btnY = BTN_OUT;
  private btnVel = 0;
  private pressUntil = 0;
  private on = false;
  /** 0 … 1, wie hell die Lampe gerade brennt (mit Anglühen und kurzem Flackern) */
  level = 0;
  private switchedAt = -10;

  constructor() {
    super();
    const add = (m: THREE.Mesh, cast = true) => {
      m.castShadow = cast;
      m.receiveShadow = true;
      this.add(m);
      return m;
    };

    // Fuß: gestuft, leicht oval
    const base = add(
      new THREE.Mesh(
        lathe([
          [0, 0],
          [0.5, 0],
          [0.52, 0.018],
          [0.51, 0.045],
          [0.46, 0.06],
          [0.4, 0.085],
          [0.34, 0.1],
          [0.22, 0.12],
          [0.12, 0.15],
          [0.07, 0.19],
          [0, 0.2],
        ]),
        this.brassMat,
      ),
    );
    base.scale.set(1, 1, 0.66);

    // Schaft mit zwei Wülsten
    add(
      new THREE.Mesh(
        lathe(
          [
            [0, 0.18],
            [0.05, 0.19],
            [0.06, 0.23],
            [0.04, 0.27],
            [0.032, 0.32],
            [0.03, 0.78],
            [0.05, 0.81],
            [0.05, 0.85],
            [0.03, 0.88],
            [0.028, 1.3],
            [0.045, 1.33],
            [0.03, 1.37],
            [0, 1.38],
          ],
          32,
        ),
        this.brassMat,
      ),
    );

    // Bügel, der den Schirm an beiden Enden hält
    const yoke = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-SHADE_LEN / 2 + 0.02, SHADE_Y, SHADE_Z),
      new THREE.Vector3(-0.36, 1.4, 0.07),
      new THREE.Vector3(0, 1.35, 0),
      new THREE.Vector3(0.36, 1.4, 0.07),
      new THREE.Vector3(SHADE_LEN / 2 - 0.02, SHADE_Y, SHADE_Z),
    ]);
    add(new THREE.Mesh(new THREE.TubeGeometry(yoke, 64, 0.016, 10), this.brassMat), false);

    // Schirm: Halbzylinder aus Glas, innen opalweiß, Messingkappen an den Enden
    const shade = new THREE.Group();
    shade.position.set(0, SHADE_Y, SHADE_Z);
    shade.rotation.x = SHADE_TILT;
    this.add(shade);
    const shell = new THREE.CylinderGeometry(SHADE_R, SHADE_R, SHADE_LEN, 64, 1, true, ARC_FROM, ARC_LEN);
    shell.rotateZ(Math.PI / 2);
    const outer = new THREE.Mesh(shell, this.glass);
    const inner = new THREE.Mesh(shell, this.opal);
    for (const m of [outer, inner]) {
      m.receiveShadow = true;
      shade.add(m);
    }
    const capShape = new THREE.Shape();
    for (let i = 0; i <= 40; i++) {
      const t = ARC_FROM + (ARC_LEN * i) / 40;
      // Zylinder nach rotateZ(π/2): y = r·sin t, z = r·cos t
      const z = SHADE_R * Math.cos(t);
      const y = SHADE_R * Math.sin(t);
      if (i === 0) capShape.moveTo(z, y);
      else capShape.lineTo(z, y);
    }
    capShape.closePath();
    const capGeo = new THREE.ShapeGeometry(capShape, 24);
    capGeo.rotateY(-Math.PI / 2);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(capGeo, this.brassMat);
      cap.position.x = (sx * SHADE_LEN) / 2;
      shade.add(cap);
      // Wulst am Rand der Kappe
      const arc = Array.from({ length: 41 }, (_, i) => {
        const t = ARC_FROM + (ARC_LEN * i) / 40;
        return new THREE.Vector3((sx * SHADE_LEN) / 2, SHADE_R * Math.sin(t), SHADE_R * Math.cos(t));
      });
      const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 48, 0.012, 8), this.brassMat);
      shade.add(rim);
    }
    // Messingleiste an den Unterkanten des Glases
    for (const t of [ARC_FROM, ARC_FROM + ARC_LEN]) {
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, SHADE_LEN, 10), this.brassMat);
      edge.rotation.z = Math.PI / 2;
      edge.position.set(0, SHADE_R * Math.sin(t), SHADE_R * Math.cos(t));
      shade.add(edge);
    }

    // Glühbirne unter dem Schirm
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), this.bulbMat);
    bulb.scale.set(1.4, 1, 1);
    bulb.position.set(0, -0.04, 0);
    shade.add(bulb);

    // Druckknopf vorn rechts auf dem Fuß: Messinggehäuse, Knopf aus Elfenbein-Kunststoff
    const housing = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.05, 32), this.brassMat));
    housing.position.set(0.28, 0.095, 0.17);
    this.button = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 32), this.buttonMat));
    this.button.position.set(0.28, 0.12 + BTN_OUT, 0.17);

    // Licht: Kegel nach unten rechts zu den Büchern, dazu ein warmes Rundumlicht
    this.spot.position.set(0, SHADE_Y - 0.08, SHADE_Z + 0.04);
    this.spot.target.position.set(1.7, -0.5, 0.7);
    this.spot.angle = 1.2;
    this.spot.penumbra = 1;
    this.spot.decay = 1.1;
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0006;
    this.spot.shadow.normalBias = 0.03;
    this.spot.shadow.camera.near = 0.1;
    this.add(this.spot, this.spot.target);
    this.glow.position.set(0, SHADE_Y - 0.12, SHADE_Z + 0.15);
    this.glow.decay = 1.6;
    this.glow.distance = 9;
    this.add(this.glow);

    this.setLevel(0);
  }

  /** Bildschirmrechteck des Knopfs: als Box in Weltkoordinaten */
  buttonBox(out: THREE.Box3): THREE.Box3 {
    this.button.updateWorldMatrix(true, false);
    out.setFromObject(this.button);
    out.expandByScalar(0.06);
    return out;
  }

  /** Einschalten oder ausschalten; `time` in Sekunden der Szene. */
  setOn(on: boolean, time: number, instant: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.switchedAt = instant ? -10 : time;
    if (!instant) this.pressUntil = time + 0.09;
  }

  /** Knopf drücken ohne Umschalten (Feedback beim Klick, bevor das Design wechselt) */
  press(time: number) {
    this.pressUntil = time + 0.09;
  }

  /** Pro Bild: Knopf federn lassen, Helligkeit nachführen. Gibt zurück, ob sich etwas bewegt. */
  update(time: number, dt: number, reduced: boolean): boolean {
    const target = time < this.pressUntil ? BTN_DOWN : this.on ? BTN_LATCHED : BTN_OUT;
    if (reduced) {
      this.btnY = target;
      this.btnVel = 0;
    } else {
      // steife Feder: in kleinen Schritten rechnen, sonst schwingt sie bei wenigen Bildern pro Sekunde auf
      const k = 2600;
      const d = 2 * Math.sqrt(k) * 0.55;
      const steps = Math.ceil(dt / (1 / 480));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.btnVel += (k * (target - this.btnY) - d * this.btnVel) * h;
        this.btnY += this.btnVel * h;
      }
    }
    this.button.position.y = 0.12 + this.btnY;

    // Glühen: beim Einschalten kurz anglühen und flackern, beim Ausschalten rasch nachglimmen
    const since = time - this.switchedAt;
    let want = this.on ? 1 : 0;
    if (this.on && since < 0.35 && !reduced) {
      const warm = Math.min(1, since / 0.22);
      const flicker = since < 0.18 ? 0.55 + 0.45 * Math.abs(Math.sin(since * 90)) : 1;
      want = warm * flicker;
      this.level = want;
    } else {
      const rate = this.on ? 14 : 7;
      this.level += (want - this.level) * (reduced ? 1 : 1 - Math.exp(-dt * rate));
    }
    this.setLevel(this.level);
    return Math.abs(want - this.level) > 1e-3 || Math.abs(this.btnVel) > 1e-3 || Math.abs(target - this.btnY) > 1e-4;
  }

  private setLevel(l: number) {
    this.glass.emissiveIntensity = 0.7 * l;
    this.opal.emissiveIntensity = 1.6 * l;
    this.bulbMat.color.setRGB(0.35 + 0.65 * l * 4, 0.31 + 0.6 * l * 3.4, 0.28 + 0.4 * l * 2.2);
    this.spot.intensity = 9 * l;
    this.glow.intensity = 5 * l;
    this.spot.visible = this.glow.visible = l > 0.002;
  }

  dispose() {
    this.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of [this.brassMat, this.glass, this.opal, this.bulbMat, this.buttonMat]) m.dispose();
    this.spot.shadow.map?.dispose();
  }
}

let ctx: AudioContext | null = null;

/** Ein kurzes „Klack“ des Druckknopfs, synthetisch: Anschlag und Rasten, beim Lösen heller. */
export function clickSound(on: boolean) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + 0.005;
    const hit = (at: number, freq: number, gain: number, len: number) => {
      const buf = ctx!.createBuffer(1, Math.ceil(ctx!.sampleRate * len), ctx!.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.18));
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      const bp = ctx!.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 6;
      const g = ctx!.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g).connect(ctx!.destination);
      src.start(at);
    };
    if (on) {
      hit(t0, 2400, 0.5, 0.03);
      hit(t0 + 0.055, 1500, 0.35, 0.04);
    } else {
      hit(t0, 2000, 0.4, 0.03);
      hit(t0 + 0.04, 3100, 0.3, 0.025);
    }
  } catch {
    /* ohne Ton geht es auch */
  }
}
