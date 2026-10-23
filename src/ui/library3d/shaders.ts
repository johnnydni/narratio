import * as THREE from 'three';

/**
 * Eigene Shader für das Regal. Holz und Wand bauen auf den physikalischen Materialien von
 * three.js auf (Licht, Schatten, Umgebung bleiben erhalten) und ersetzen nur die Farbe durch
 * prozedurale Maserung bzw. Putz. Der Staub im Lichtkegel ist ein eigenes Punkt-Material.
 */

const NOISE = /* glsl */ `
float n_hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = n_hash(i), b = n_hash(i + vec2(1.0, 0.0)), c = n_hash(i + vec2(0.0, 1.0)), d = n_hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float n_fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { v += amp * n_noise(p); p = p * 2.03 + 17.1; amp *= 0.5; }
  return v;
}
`;

export interface WoodUniforms {
  uLight: { value: THREE.Color };
  uDark: { value: THREE.Color };
}

function withWorldPos(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE}`);
}

/**
 * Holz mit Maserung längs der x-Achse (Bretter) bzw. y-Achse (Seitenwände, `vertical`).
 * Jahresringe, feine Poren und ein leichter Glanzunterschied zwischen Früh- und Spätholz.
 */
export function woodMaterial(light: THREE.Color, dark: THREE.Color, vertical = false): THREE.MeshStandardMaterial & { userData: { uniforms: WoodUniforms } } {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  const uniforms: WoodUniforms = { uLight: { value: light.clone() }, uDark: { value: dark.clone() } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    withWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLight;\nuniform vec3 uDark;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wp = ${vertical ? 'vWPos.yxz' : 'vWPos'};
        float warp = n_fbm(vec2(wp.x * 0.45, wp.y * 6.0 + wp.z * 1.5));
        float rings = sin(wp.y * 42.0 + wp.z * 7.0 + warp * 9.0) * 0.5 + 0.5;
        rings = smoothstep(0.15, 0.95, rings);
        float pores = n_noise(vec2(wp.x * 3.0, wp.y * 160.0 + wp.z * 40.0));
        float knot = smoothstep(0.78, 0.95, n_fbm(vec2(wp.x * 0.9, wp.y * 2.0 + 3.0)));
        vec3 wood = mix(uDark, uLight, rings * 0.55 + warp * 0.45);
        wood *= 0.9 + 0.18 * pores;
        wood = mix(wood, uDark * 0.7, knot * 0.6);
        diffuseColor.rgb *= wood;
        float latewood = rings;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.48, 0.7, latewood);');
  };
  m.customProgramCacheKey = () => (vertical ? 'wood-v' : 'wood-h');
  return m as THREE.MeshStandardMaterial & { userData: { uniforms: WoodUniforms } };
}

export interface WallUniforms {
  uColor: { value: THREE.Color };
}

/** Rückwand: matter Putz mit feiner Körnung und schwachen Stoffstreifen, zu den Ecken hin dunkler. */
export function wallMaterial(color: THREE.Color): THREE.MeshStandardMaterial & { userData: { uniforms: WallUniforms } } {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const uniforms: WallUniforms = { uColor: { value: color.clone() } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    withWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uColor;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grain = n_fbm(vWPos.xy * 9.0);
        float fine = n_noise(vWPos.xy * 140.0);
        float stripes = 0.5 + 0.5 * sin(vWPos.x * 26.0);
        vec3 wall = uColor * (0.93 + 0.08 * grain + 0.03 * fine + 0.015 * stripes);
        diffuseColor.rgb *= wall;`,
      );
  };
  m.customProgramCacheKey = () => 'wall';
  return m as THREE.MeshStandardMaterial & { userData: { uniforms: WallUniforms } };
}

/** Staubteilchen, die langsam durch den Lichtkegel treiben. Nur im Licht sichtbar. */
export function dustMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.5 },
      uPixelRatio: { value: 1 },
      uLight: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color('#ffe2b0') },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform vec3 uLight;
      attribute float aSeed;
      varying float vLit;
      varying float vSeed;
      void main() {
        vec3 p = position;
        float t = uTime * (0.04 + aSeed * 0.05);
        p.x += sin(t * 3.0 + aSeed * 40.0) * 0.35;
        p.y += sin(t * 2.0 + aSeed * 13.0) * 0.25 - mod(uTime * 0.02 * (0.5 + aSeed), 1.0) * 0.6;
        p.z += cos(t * 2.5 + aSeed * 23.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Helligkeit: im Kegel unter der Lampe hell, außerhalb fast unsichtbar
        vec3 toP = p - uLight;
        float axis = normalize(toP).y;
        vLit = smoothstep(-0.55, -0.92, axis);
        vSeed = aSeed;
        gl_PointSize = (2.0 + aSeed * 3.5) * uPixelRatio * (8.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uTime;
      uniform vec3 uColor;
      varying float vLit;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        float twinkle = 0.6 + 0.4 * sin(uTime * (0.6 + vSeed) + vSeed * 50.0);
        gl_FragColor = vec4(uColor, a * vLit * twinkle * uOpacity);
      }
    `,
  });
}
