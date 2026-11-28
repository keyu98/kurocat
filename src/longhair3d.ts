import * as THREE from 'three';
import type { CatSkinConfig } from './catSkins';
import { clamp, mergeStaticGeometries, smoothstep, TaperTube3D } from './keyboard3d';

const HEAD_Y = 0.125;
const HEAD_Z = 0.055;
const HEAD_XR = 0.675;
const HEAD_YR = 0.53;
const HEAD_ZR = 0.505;
const NOSE_Y = -0.102;
const HEAD_DROP = 0.025;
const HEAD_FORWARD = 0.025;
const HEAD_SCALE = new THREE.Vector3(0.79, 0.77, 0.94);
const TORSO_HEIGHT = 1.46;
const RUFF_BASE = 1.045;
const FACE_BASE = 1.371;

function tuft(y: number, root: number, tip: number, softness = 0.11): number {
  return smoothstep(tip - softness, tip, y) * (1 - smoothstep(tip, root, y));
}

function cheekWidth(latitude: number): number {
  const jowl = (latitude + 0.46) / 0.405;
  const lowerCheek = (latitude + 0.66) / 0.245;
  return 1
    + 0.205 * Math.exp(-jowl * jowl)
    + 0.275 * Math.exp(-lowerCheek * lowerCheek)
    + 0.067 * tuft(latitude, 0.13, -0.43, 0.19)
    + 0.058 * tuft(latitude, -0.22, -0.61, 0.17)
    + 0.048 * tuft(latitude, -0.46, -0.77, 0.15);
}

function faceRelief(x: number, y: number, depth: number): number {
  const left = (x + 0.092) / 0.108;
  const right = (x - 0.092) / 0.108;
  const vertical = (y + 0.158) / 0.087;
  const muzzle = 0.051 * (Math.exp(-left * left) + Math.exp(-right * right)) * Math.exp(-vertical * vertical);
  // Broader pads below the eyes give the developed jowls depth in profile.
  const cheekX = (Math.abs(x) - 0.47) / 0.183;
  const cheekY = (y + 0.145) / 0.151;
  const cheek = 0.087 * Math.exp(-cheekX * cheekX - cheekY * cheekY);
  const bridgeX = x / 0.31;
  const bridgeY = (y + 0.108) / 0.167;
  const snout = 0.027 * Math.exp(-bridgeX * bridgeX - bridgeY * bridgeY);
  const forehead = 0.031 * smoothstep(-0.010, 0.32, y);
  return (muzzle + cheek + snout - forehead) * smoothstep(0.10, 0.55, depth);
}

function ruffSpread(y: number): number {
  // Give the white fur below the cheeks a continuous width into the chest.
  return 0.074 * smoothstep(-0.526, -0.335, y) * (1 - smoothstep(-0.290, -0.144, y));
}

function faceZ(x: number, y: number): number {
  const v = (y - HEAD_Y) / HEAD_YR;
  const ring = Math.sqrt(Math.max(0, 1 - v * v));
  const width = HEAD_XR * cheekWidth(v) * ring + ruffSpread(y) / HEAD_SCALE.x;
  const u = x / Math.max(0.001, width);
  const depth = ring * Math.sqrt(Math.max(0, 1 - u * u));
  return HEAD_Z + HEAD_ZR * depth + faceRelief(x, y, depth);
}

function makeCoatGeometry(
  radiusAtHeight: (height: number) => number,
  depthRatio: number,
  headCenter: number,
): THREE.BufferGeometry {
  const rings = 86;
  const sides = 64;
  const crown = headCenter + HEAD_SCALE.y * (HEAD_Y + HEAD_YR);
  const position: number[] = [];
  const coatPosition: number[] = [];
  const facePosition: number[] = [];
  const neckDepth: number[] = [];
  const indices: number[] = [];
  const jointLength = FACE_BASE - RUFF_BASE;
  const derivativeStep = 0.008;

  const torsoRing = (height: number, aroundX: number, aroundZ: number, radius: number) => {
    const y = clamp(2 * height / TORSO_HEIGHT - 1, -1, 1);
    const ring = Math.sqrt(1 - y * y);
    const x = aroundX * ring;
    const z = aroundZ * ring;
    const spread = Math.abs(Math.atan2(aroundX, aroundZ));
    const tip = 0.15 + 0.27 * Math.sin(spread) + 0.10 * Math.cos(spread * 9.0 - 0.65);
    const ruff = tuft(y, 0.88, tip, 0.18) * smoothstep(-0.46, 0.42, z);
    const flank = tuft(y, 0.38, -0.14 + 0.075 * Math.cos(spread * 12.0), 0.14)
      * smoothstep(0.42, 0.9, Math.abs(x));
    const hipWidth = 0.965 + 0.035 * smoothstep(0.43, RUFF_BASE, height);
    const sideDepth = depthRatio * (1 - 0.068 * smoothstep(0.10, 0.90, -aroundZ));
    return {
      x: aroundX * radius * hipWidth * (1 + 0.12 * ruff + 0.04 * flank),
      z: aroundZ * radius * sideDepth + 0.075 * ruff - 0.035,
      coatX: x * (1.045 - 0.13 * y + 0.24 * ruff + 0.070 * flank),
      coatY: y,
      coatZ: z * (1 - 0.07 * y) + 0.21 * ruff,
    };
  };

  const faceRing = (height: number, aroundX: number, aroundZ: number) => {
    const y = (height - headCenter) / HEAD_SCALE.y;
    const latitude = clamp((y - HEAD_Y) / HEAD_YR, -1, 1);
    const ring = Math.sqrt(1 - latitude * latitude);
    const x = aroundX * ring * HEAD_XR * cheekWidth(latitude);
    const surfaceX = x + aroundX * ruffSpread(y) / HEAD_SCALE.x;
    const depth = aroundZ * ring;
    const nape = ring * smoothstep(0.10, 0.96, -aroundZ)
      * (0.040 + 0.084 * (1 - smoothstep(1.42, 1.75, height)));
    return {
      x: x * HEAD_SCALE.x,
      z: HEAD_FORWARD + (HEAD_Z + depth * HEAD_ZR + faceRelief(surfaceX, y, depth)) * HEAD_SCALE.z - nape,
    };
  };

  const ruffRadius = radiusAtHeight(RUFF_BASE);
  const priorRadius = radiusAtHeight(RUFF_BASE - derivativeStep);
  const directions = Array.from({ length: sides }, (_, side) => {
    const angle = 2 * Math.PI * side / sides;
    const x = Math.sin(angle);
    const z = Math.cos(angle);
    const a = torsoRing(RUFF_BASE, x, z, ruffRadius);
    const prior = torsoRing(RUFF_BASE - derivativeStep, x, z, priorRadius);
    const d = faceRing(FACE_BASE, x, z);
    const after = faceRing(FACE_BASE + derivativeStep, x, z);
    const tangentScale = jointLength / (3 * derivativeStep);
    return {
      x, z, a, d,
      b: { x: a.x + (a.x - prior.x) * tangentScale, z: a.z + (a.z - prior.z) * tangentScale },
      c: { x: d.x - (after.x - d.x) * tangentScale, z: d.z - (after.z - d.z) * tangentScale },
    };
  });

  // Sample open rings from the seated tabby profile into the longhair cheeks.
  // Every ring shares its vertices with the next, including the two end caps.
  for (let row = 0; row <= rings; row++) {
    const height = crown * (1 - Math.cos(Math.PI * row / rings)) * 0.5;
    const torsoRadius = radiusAtHeight(Math.min(height, TORSO_HEIGHT));
    const headY = (height - headCenter) / HEAD_SCALE.y;
    const t = clamp((height - RUFF_BASE) / jointLength, 0, 1);
    const s = 1 - t;
    const throatFade = Math.pow(1 - smoothstep(1.267, 1.409, height), 0.55);
    const throat = 0.139 * smoothstep(1.0, 1.245, height) * throatFade;
    const nape = 0.085 * smoothstep(1.126, 1.314, height) * (1 - smoothstep(1.327, 1.475, height));
    const pole = row === 0 || row === rings;
    for (let side = 0; side < (pole ? 1 : sides); side++) {
      const direction = directions[side];
      const torso = torsoRing(height, direction.x, direction.z, torsoRadius);
      let p: { x: number; z: number };
      if (height <= RUFF_BASE) {
        p = torso;
      } else if (height >= FACE_BASE) {
        p = faceRing(height, direction.x, direction.z);
      } else {
        // The cubic matches the flank and cheek tangents instead of folding at the join.
        const { a, b, c, d } = direction;
        const ruff = 0.043 * 28 * t * t * t * s * s;
        p = {
          x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x
            + ruff * direction.x,
          z: s * s * s * a.z + 3 * s * s * t * b.z + 3 * s * t * t * c.z + t * t * t * d.z,
        };
      }
      const x = p.x + direction.x * ruffSpread(headY);
      position.push(x, height, p.z);
      coatPosition.push(torso.coatX, torso.coatY, torso.coatZ);
      facePosition.push(x / HEAD_SCALE.x, headY, (p.z - HEAD_FORWARD) / HEAD_SCALE.z);
      const front = Math.max(0, direction.z);
      const back = Math.max(0, -direction.z);
      neckDepth.push(front * front * throat - back * back * nape);
    }
  }

  const crownIndex = position.length / 3 - 1;
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    indices.push(0, 1 + next, 1 + side);
    for (let row = 0; row < rings - 2; row++) {
      const lower = 1 + row * sides;
      const upper = lower + sides;
      indices.push(lower + side, lower + next, upper + side, lower + next, upper + next, upper + side);
    }
    indices.push(crownIndex - sides + side, crownIndex - sides + next, crownIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('coatPosition', new THREE.Float32BufferAttribute(coatPosition, 3));
  geometry.setAttribute('facePosition', new THREE.Float32BufferAttribute(facePosition, 3));
  geometry.setAttribute('neckDepth', new THREE.Float32BufferAttribute(neckDepth, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sculptMaterial(part: 'COAT' | 'EAR' | 'LIMB' | 'SOLID'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { [part]: 1 },
    uniforms: {
      uCream: { value: new THREE.Color() },
      uGinger: { value: new THREE.Color() },
      uMark: { value: new THREE.Color() },
      uRuff: { value: new THREE.Color() },
      ...(part === 'COAT' ? {
        uFlank: { value: new THREE.Color() },
        uTorsoPose: { value: new THREE.Matrix4() },
        uHeadPose: { value: new THREE.Matrix4() },
        uSquash: { value: 0 },
        uNeckBase: { value: RUFF_BASE },
        uNeckFill: { value: 0.12 },
      } : {}),
    },
    vertexShader: `
      #ifdef COAT
        attribute vec3 coatPosition;
        attribute vec3 facePosition;
        attribute float neckDepth;
        uniform mat4 uTorsoPose, uHeadPose;
        uniform float uSquash, uNeckBase, uNeckFill;
        varying vec3 vFace;
        varying float vHeadMix;
      #endif
      varying vec3 vLocation, vNormal, vView;
      varying vec2 vWorldXY;
      void main() {
        vec4 posed = vec4(position, 1.0);
        vec3 posedNormal = normal;
        #ifdef COAT
          vLocation = coatPosition;
          vFace = facePosition;
          vHeadMix = smoothstep(1.285, 1.403, position.y);
          float bend = smoothstep(uNeckBase, ${FACE_BASE}, position.y);
          vec4 torso = uTorsoPose * posed;
          torso.y *= 1.0 - uSquash * smoothstep(0.18, 1.98, position.y);
          posed = mix(torso, uHeadPose * posed, bend);
          posed.z += neckDepth * uNeckFill;
          posedNormal = mix(mat3(uTorsoPose) * normal, mat3(uHeadPose) * normal, bend);
        #else
          vLocation = position;
        #endif
        vWorldXY = (modelMatrix * posed).xy;
        vNormal = normalMatrix * posedNormal;
        vec4 mv = modelViewMatrix * posed;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uCream, uGinger, uMark, uRuff;
      #ifdef COAT
        uniform vec3 uFlank;
        varying vec3 vFace;
        varying float vHeadMix;
      #endif
      varying vec3 vLocation, vNormal, vView;
      varying vec2 vWorldXY;

      float oval(vec2 p, vec2 center, vec2 size) {
        return 1.0 - smoothstep(0.89, 1.05, length((p - center) / size));
      }

      float furLock(vec2 p, vec2 root, vec2 tip, float bend, float softWidth) {
        float t = clamp((p.y - root.y) / (tip.y - root.y), 0.0, 1.0);
        float sweep = mix(root.x, tip.x, t) + bend * sin(3.14159 * t);
        float taper = sin(3.14159 * t);
        return taper * (1.0 - smoothstep(0.0, softWidth * (0.2 + 0.8 * taper), abs(p.x - sweep)));
      }

      float falloff(float delta, float width) {
        float t = delta / width;
        return exp(-t * t);
      }

      void main() {
        vec3 color = uCream;
        #ifdef COAT
          vec3 p = vFace;
          // The orange cheeks sweep down outside each eye, leaving ivory beneath the lower lids.
          float x = abs(p.x + 0.008 * sin(13.0 * p.y));
          float front = smoothstep(0.11, 0.30, p.z);
          float faceEdge = -0.054 + 0.063 * falloff(x - 0.28, 0.160)
                                 - 0.048 * falloff(x - 0.640, 0.140);
          faceEdge += 0.009 * (sin(48.0 * p.x) + 0.48 * sin(89.0 * p.x));
          float napeEdge = -0.24 - 0.071 * falloff(p.x + 0.050, 0.21) + 0.058 * sin(10.0 * p.x);
          float gingerEdge = mix(napeEdge, faceEdge, smoothstep(-0.16, 0.23, p.z));
          float cap = smoothstep(-0.029, 0.023, p.y - gingerEdge);
          float bridgeX = p.x + 0.010 + 0.014 * sin(11.0 * p.y + 0.7);
          float bridgeWidth = mix(0.164, 0.084, smoothstep(-0.25, 0.016, p.y));
          bridgeWidth *= mix(1.0, 0.78, smoothstep(0.04, 0.24, p.y));
          float blazeTop = 0.165 + 0.071 * falloff(bridgeX + 0.032, 0.021)
                                 + 0.043 * falloff(bridgeX - 0.037, 0.022);
          float blaze = (1.0 - smoothstep(bridgeWidth - 0.012, bridgeWidth + 0.013, abs(bridgeX)))
                       * (1.0 - smoothstep(blazeTop - 0.019, blazeTop + 0.016, p.y)) * front;
          float ginger = cap * (1.0 - blaze);
          float jaw = (1.0 - ginger) * (1.0 - smoothstep(-0.25, -0.043, p.y));
          color = mix(mix(uRuff, uCream, 0.12 * (1.0 - jaw)), uGinger, ginger);
          float cheekGlow = falloff(x - 0.525, 0.185) * falloff(p.y + 0.082, 0.102);
          color += vec3(0.052, 0.031, 0.014) * cheekGlow * ginger * front;

          // Broken tabby strokes follow the forehead and curve out from the eye corners.
          vec2 sweep = vec2(x, p.y);
          float mHeight = 0.355 - 0.74 * abs(x - 0.108) - 0.26 * x * x + 0.009 * sin(29.0 * x);
          float brow = (1.0 - smoothstep(0.007, 0.036, abs(p.y - mHeight)))
                       * (1.0 - smoothstep(0.18, 0.245, x));
          float forelock = furLock(sweep, vec2(0.14, 0.370), vec2(0.116, 0.151), 0.032, 0.049);
          float temple = furLock(sweep, vec2(0.564, 0.233), vec2(0.429, 0.014), 0.033, 0.054);
          float cheek = furLock(sweep, vec2(0.616, 0.108), vec2(0.463, -0.145), 0.038, 0.053);
          float stripe = max(max(brow * 0.57, forelock * 0.62), max(temple * 0.56, cheek * 0.63));
          color = mix(color, uMark, stripe * ginger * front);

          // A small irregular orange patch sits beside the cat's left nostril.
          vec2 pad = vec2(p.x, p.y - 0.16 * (p.x - 0.111) + 0.008 * sin(95.0 * p.x));
          float spot = max(oval(pad, vec2(0.105, -0.134), vec2(0.051, 0.040)),
                           oval(pad, vec2(0.150, -0.149), vec2(0.044, 0.024)));
          spot = max(spot, oval(pad, vec2(0.141, -0.105), vec2(0.035, 0.016)));
          vec3 spotColor = mix(uGinger, uMark, 0.50 + 0.30 * falloff(pad.x - 0.09, 0.055));
          color = mix(color, spotColor, spot * front * 0.93);

          float wisps = max(furLock(sweep, vec2(0.12, 0.52), vec2(0.244, 0.347), -0.035, 0.039),
                            furLock(sweep, vec2(0.264, 0.48), vec2(0.380, 0.331), 0.028, 0.036));
          color += vec3(0.080, 0.041, 0.018) * wisps * ginger * front;
          vec3 faceColor = color;
          p = vLocation;
          color = uCream;

          // Both references share one coat: a narrow dorsal stripe, a shoulder
          // patch and a rear flank patch visible from the side. Rest coordinates
          // keep all markings attached during breathing, sleep and swats.
          float side = sign(p.x);
          float flow = p.y + 0.18 * abs(p.x);
          float locks = 0.024 * sin(19.0 * flow + side * 1.7)
                      + 0.013 * sin(43.0 * flow - side * 0.8);
          float fibers = sin(235.0 * p.x + 17.0 * p.y + 0.8 * sin(23.0 * p.y));
          float raggedEdge = locks * 1.5 + 0.018 * fibers;
          vec2 shoulder = vec2(p.x - 0.27 + 0.035 * sin(7.0 * p.y), (p.y - 0.50) * 0.92);
          float shoulderPatch = 1.0 - smoothstep(-0.10, 0.08,
            length(shoulder / vec2(0.52, 0.32)) - 1.0 + raggedEdge);
          vec2 rear = vec2(p.x - 0.44 + 0.04 * sin(6.0 * p.y),
                           p.y + 0.30 - 0.45 * (p.x - 0.44));
          float rearPatch = 1.0 - smoothstep(-0.10, 0.08,
            length(rear / vec2(0.36, 0.48)) - 1.0 + raggedEdge);
          float spine = 0.025 + 0.026 * sin(4.7 * p.y + 0.3) + 0.012 * sin(11.0 * p.y);
          float spineWidth = 0.205 + 0.025 * sin(8.0 * p.y - 0.6);
          float spinePatch = 1.0 - smoothstep(-0.08, 0.08,
            abs(p.x - spine) - spineWidth + raggedEdge);
          spinePatch *= smoothstep(-0.74, -0.66, p.y) * smoothstep(0.30, 0.52, -p.z);
          float shoulderCoat = shoulderPatch * smoothstep(-0.20, 0.10, -p.z);
          float rearCoat = rearPatch * smoothstep(0.02, 0.30, -p.z);
          float backPatch = max(max(shoulderCoat, rearCoat), spinePatch);
          color = mix(color, uFlank, backPatch * (1.0 - vHeadMix));

          // The broad ivory bib ends in a few rounded, downward locks.
          float bibEdge = -0.26 + 0.84 * abs(p.x) + 0.051 * cos(p.x * 23.0);
          float bib = smoothstep(bibEdge - 0.060, bibEdge + 0.08, p.y)
                    * smoothstep(0.33, 0.91, p.z);
          float underChin = smoothstep(0.37, 0.70, p.y) * smoothstep(-0.08, 0.39, p.z)
                           * (1.0 - smoothstep(0.47, 0.84, abs(p.x)));
          float throat = smoothstep(0.53, 0.81, p.y) * smoothstep(-0.15, 0.14, vFace.z);
          color = mix(color, uRuff, max(bib * 0.82, max(underChin, throat * 0.96)));
          vec2 lock = vec2(abs(p.x), p.y);
          float folds = max(furLock(lock, vec2(0.105, 0.54), vec2(0.252, -0.13), -0.073, 0.062),
                            furLock(lock, vec2(0.287, 0.61), vec2(0.480, 0.05), -0.043, 0.053));
          color *= 1.0 - 0.080 * folds * smoothstep(0.46, 0.87, p.z);
          color = mix(color, faceColor, vHeadMix);
        #elif defined(EAR)
          vec3 p = vLocation;
          float opening = max(0.013, 0.146 - 0.48 * (p.y - 0.065));
          float inner = (1.0 - smoothstep(opening - 0.009, opening + 0.012, abs(p.x)))
                        * smoothstep(0.027, 0.072, p.y)
                        * (1.0 - smoothstep(0.258, 0.30, p.y))
                        * smoothstep(0.025, 0.078, p.z);
          color = mix(color, uGinger, inner * 0.95);
          float tuftEdge = 0.125 + 0.012 * sin(90.0 * p.x);
          color = mix(color, uRuff, inner * (1.0 - smoothstep(tuftEdge - 0.013, tuftEdge + 0.010, p.y)) * 0.83);
        #endif

        // Broad studio key, warm bounce and a soft edge give the matte sculpt volume.
        vec3 normal = normalize(vNormal);
        float light = dot(normal, normalize(vec3(-0.56, 0.48, 0.55))) * 0.5 + 0.5;
        float edge = pow(1.0 - max(0.0, dot(normal, normalize(vView))), 2.0);
        float height = smoothstep(0.02, 0.82, vWorldXY.y);
        vec3 torsoLight = mix(vec3(0.94, 0.90, 0.85), vec3(1.0), height) * mix(0.974, 1.015, light);
        vec3 sculptLight = mix(vec3(0.67, 0.57, 0.49), vec3(1.065, 1.025, 0.985), light);
        vec3 rim = vec3(0.036, 0.026, 0.019) * edge * light;
        #if defined(COAT)
          // The folded chin and ruff share lighting as well as geometry.
          float sculpt = vHeadMix * (1.0 - jaw * 0.98);
          color = color * mix(torsoLight, sculptLight, sculpt) + rim * sculpt;
        #elif defined(LIMB)
          float shoulder = smoothstep(0.23, 0.63, vWorldXY.y)
                           * (1.0 - smoothstep(0.18, 0.46, abs(vWorldXY.x)));
          color = mix(color, uRuff, shoulder * 0.82) * torsoLight * (1.0 - edge * 0.032);
        #else
          color = color * sculptLight + rim;
        #endif
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function setCoatColors(mat: THREE.ShaderMaterial, cream: string, ginger = cream, mark = ginger, ruff = cream): void {
  mat.uniforms.uCream.value.set(cream);
  mat.uniforms.uGinger.value.set(ginger);
  mat.uniforms.uMark.value.set(mark);
  mat.uniforms.uRuff.value.set(ruff);
}

function makeFacePatch(cx: number, cy: number, rx: number, ry: number, tilt: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(2, 2, 20, 20);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * rx;
    const v = pos.getY(i) * ry;
    const x = cx + u * Math.cos(tilt) - v * Math.sin(tilt);
    const y = cy + u * Math.sin(tilt) + v * Math.cos(tilt);
    pos.setXYZ(i, x, y, faceZ(x, y) + 0.009);
  }
  return geometry;
}

function eyeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uOpen: { value: 1 },
      uAnger: { value: 0 },
      uSide: { value: 1 },
      uGaze: { value: new THREE.Vector2() },
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uPupil: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpen;
      uniform float uAnger, uSide;
      uniform vec2 uGaze;
      uniform vec3 uTop, uBottom, uPupil;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        vec3 color;
        float alpha;
        float open = max(0.22, uOpen);
        if (uOpen < 0.22) {
          float end = abs(uv.x) / 0.80;
          float arc = 1.0 - min(1.0, end * end);
          float edge = abs(uv.y + 0.17 * arc) - 0.061 * sqrt(arc);
          alpha = (1.0 - smoothstep(-0.017, 0.017, edge)) * (1.0 - smoothstep(0.96, 1.0, end));
          color = mix(uTop, uPupil, 0.70);
        } else {
          vec2 p = vec2(uv.x, uv.y / open);
          float r = length(p);
          float aa = max(0.012, fwidth(r) * 0.65);
          alpha = 1.0 - smoothstep(0.97 - aa, 0.97 + aa, r);
          vec3 amber = mix(uTop, uBottom, clamp(0.5 - p.y * 0.5, 0.0, 1.0));
          float lowerGlow = smoothstep(0.05, 0.82, -p.y) * (1.0 - smoothstep(0.65, 0.94, r));
          amber = mix(amber, min(amber * 1.20 + 0.04, vec3(1.0)), lowerGlow * 0.45);
          color = mix(amber, amber * 0.53, smoothstep(0.83, 0.98, r) * 0.55);
          float pupilR = length((p - uGaze) / vec2(mix(0.55, 0.28, uAnger), 0.67));
          float pupilAA = max(0.023, fwidth(pupilR) * 0.58);
          float pupil = (1.0 - smoothstep(1.0 - pupilAA, 1.0 + pupilAA, pupilR))
                        * (1.0 - smoothstep(0.90, 0.97, r));
          color = mix(color, uPupil, pupil);
          float glint = 1.0 - smoothstep(0.145, 0.190, length(p - vec2(-0.28, 0.32) - uGaze * 0.44));
          float reflection = 1.0 - smoothstep(0.058, 0.090, length(p - vec2(0.27, -0.30) - uGaze * 0.34));
          color = mix(color, vec3(1.0, 0.97, 0.87), max(glint, reflection * 0.94));
          // Slanted upper lids descend toward the nose. Fur shows through
          // above the lid, while a dark rim makes the scowl readable at pet size.
          float lid = mix(1.18, 0.16, uAnger) + uSide * p.x * 0.38 * uAnger;
          float lidDist = p.y - lid;
          alpha *= 1.0 - smoothstep(-aa, aa, lidDist);
          color = mix(color, uPupil, smoothstep(-0.10, -0.02, lidDist) * uAnger * 0.82);
        }
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Keep the interaction paw in the character's material system: ivory foreleg
// shading, low relief pads and small matte claw tips, without accessory gloss.
class LonghairSwatPaw3D {
  public readonly root = new THREE.Group();
  public readonly toes: THREE.Group[] = [];
  public readonly claws: THREE.Mesh[] = [];
  public readonly padMaterial = sculptMaterial('SOLID');
  private readonly clawMaterial = sculptMaterial('SOLID');

  constructor(public readonly furMaterial: THREE.ShaderMaterial) {
    const sphere = new THREE.SphereGeometry(1, 24, 16);
    const part = (material: THREE.Material, pos: number[], size: number[]) => {
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(size[0], size[1], size[2]);
      return mesh;
    };
    this.root.add(part(furMaterial, [0, -0.025, 0], [0.127, 0.118, 0.080]));

    // A shallow, three-lobed metacarpal pad follows the palm's curvature.
    const pad = new THREE.Shape();
    pad.moveTo(0, 0.028);
    pad.bezierCurveTo(-0.019, 0.044, -0.032, 0.019, -0.049, -0.003);
    pad.bezierCurveTo(-0.067, -0.030, -0.042, -0.046, -0.021, -0.034);
    pad.quadraticCurveTo(0, -0.044, 0.021, -0.034);
    pad.bezierCurveTo(0.042, -0.046, 0.067, -0.030, 0.049, -0.003);
    pad.bezierCurveTo(0.032, 0.019, 0.019, 0.044, 0, 0.028);
    const padGeo = new THREE.ExtrudeGeometry(pad, {
      depth: 0.002, bevelEnabled: true, bevelThickness: 0.003,
      bevelSize: 0.004, bevelSegments: 3, curveSegments: 10,
    });
    const pos = padGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i) - 0.016;
      pos.setZ(i, pos.getZ(i) - 0.03 * ((x / 0.127) ** 2 + (y / 0.118) ** 2));
    }
    padGeo.computeVertexNormals();
    const palmPad = new THREE.Mesh(padGeo, this.padMaterial);
    palmPad.position.set(0, -0.041, 0.079);
    this.root.add(palmPad);

    const clawCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.058, 0.075),
      new THREE.Vector3(0, 0.030, 0.154),
      new THREE.Vector3(0, -0.009, 0.128),
    );
    const claw = new TaperTube3D(10, 6, this.clawMaterial);
    claw.update((t, out) => clawCurve.getPoint(t, out), (t) => 0.0055 * (1 - t) + 0.0004);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.055;
      const edge = i === 0 || i === 3;
      const toe = new THREE.Group();
      toe.position.set(x, edge ? 0.041 : 0.054, 0.020);
      toe.add(
        part(furMaterial, [0, 0.035, 0.010], [0.041, 0.064, 0.046]),
        part(this.padMaterial, [0, 0.049, 0.053], [0.023, 0.026, 0.005]),
      );
      this.toes.push(toe);
      this.root.add(toe);
      const tip = new THREE.Mesh(claw.mesh.geometry, this.clawMaterial);
      tip.position.set(x, edge ? -0.011 : 0, 0);
      tip.visible = false;
      this.claws.push(tip);
      this.root.add(tip);
    }
    this.root.visible = false;
  }

  public setSkin(skin: CatSkinConfig): void {
    const pad = new THREE.Color(skin.noseColor ?? '#e9999b')
      .lerp(new THREE.Color(skin.pawOutlineColor ?? '#b59b82'), 0.22);
    setCoatColors(this.padMaterial, `#${pad.getHexString()}`);
    setCoatColors(this.clawMaterial, skin.earTuftColor ?? '#fff4df');
  }

  public pose(grip: number, claws: number): void {
    for (const toe of this.toes) toe.rotation.x = 0.65 + grip * 1.45;
    for (const claw of this.claws) {
      claw.visible = claws > 0.01;
      claw.scale.setScalar(claws);
    }
  }

  public contactPoint(out: THREE.Vector3): THREE.Vector3 {
    // Mean of the four curved claw tips at full extension.
    return this.root.localToWorld(out.set(0, -0.0145, 0.128));
  }
}

export class LonghairModel3D {
  public readonly body: THREE.Mesh;
  public readonly head = new THREE.Group();
  public readonly ears: THREE.Group[] = [];
  public readonly hitMeshes: THREE.Mesh[];
  public readonly tailMaterial = sculptMaterial('SOLID');
  public readonly limbMaterial = sculptMaterial('LIMB');
  public readonly swatPaw = new LonghairSwatPaw3D(this.limbMaterial);
  public readonly forelegs = [
    new TaperTube3D(28, 14, this.limbMaterial),
    new TaperTube3D(28, 14, this.limbMaterial),
  ];

  private readonly coat = sculptMaterial('COAT');
  private readonly headRestInverse: THREE.Matrix4;
  private readonly earCoat = sculptMaterial('EAR');
  private readonly eyes: THREE.ShaderMaterial[] = [];
  private readonly noseCoat = sculptMaterial('SOLID');

  constructor(
    radiusAtHeight: (height: number) => number,
    depthRatio: number,
    headPivot: number,
    earGeometry: THREE.BufferGeometry,
  ) {
    const headCenter = headPivot - HEAD_DROP;
    this.headRestInverse = new THREE.Matrix4()
      .makeScale(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z)
      .setPosition(0, headCenter, HEAD_FORWARD)
      .invert();
    this.body = new THREE.Mesh(makeCoatGeometry(radiusAtHeight, depthRatio, headCenter), this.coat);
    this.body.frustumCulled = false;

    // A small head-local mesh follows the visible face for pointer tests.
    const hitGeometry = new THREE.SphereGeometry(1, 20, 16);
    const hitPosition = hitGeometry.attributes.position;
    for (let i = 0; i < hitPosition.count; i++) {
      const latitude = hitPosition.getY(i);
      const y = HEAD_Y + latitude * HEAD_YR;
      const ring = Math.sqrt(Math.max(0.0001, 1 - latitude * latitude));
      const width = HEAD_XR * cheekWidth(latitude) + ruffSpread(y) / (HEAD_SCALE.x * ring);
      const x = hitPosition.getX(i) * width;
      const depth = hitPosition.getZ(i);
      hitPosition.setXYZ(i, x, y, HEAD_Z + depth * HEAD_ZR + faceRelief(x, y, depth));
    }
    const headHit = new THREE.Mesh(hitGeometry);
    headHit.visible = false;
    this.head.add(headHit);
    this.hitMeshes = [headHit];

    const noseShape = new THREE.Shape();
    noseShape.moveTo(-0.040, 0.012);
    noseShape.quadraticCurveTo(0, 0.025, 0.040, 0.012);
    noseShape.quadraticCurveTo(0.046, 0.003, 0.012, -0.023);
    noseShape.quadraticCurveTo(0, -0.031, -0.012, -0.023);
    noseShape.quadraticCurveTo(-0.046, 0.003, -0.040, 0.012);
    const noseGeo = new THREE.ExtrudeGeometry(noseShape, {
      depth: 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3,
      curveSegments: 8, steps: 1,
    });
    const nose = new THREE.Mesh(noseGeo, this.noseCoat);
    nose.position.set(0, NOSE_Y, faceZ(0, NOSE_Y) + 0.008);
    this.head.add(nose);

    const mouthMat = new THREE.MeshBasicMaterial({ color: '#986347' });
    const whiskerMat = new THREE.MeshBasicMaterial({ color: '#fff4df' });
    const mouthGeos: { geo: THREE.BufferGeometry }[] = [];
    const whiskerGeos: { geo: THREE.BufferGeometry }[] = [];
    for (const side of [-1, 1] as const) {
      const ear = new THREE.Group();
      // Share the tabby's tapered ear shell, with Facai's own pink and ivory coat.
      const shell = new THREE.Mesh(earGeometry, this.earCoat);
      shell.scale.set(1, 1.09, 0.64);
      ear.rotation.y = side * 0.10;
      ear.add(shell);
      this.ears.push(ear);
      this.hitMeshes.push(shell);

      const eyeMat = eyeMaterial();
      const eye = new THREE.Mesh(makeFacePatch(side * 0.252, 0.101, 0.169, 0.192, side * 0.045), eyeMat);
      this.eyes.push(eyeMat);
      this.head.add(eye);

      const mouth = new TaperTube3D(12, 5, mouthMat);
      mouth.update((t, out) => {
        const x = side * t * 0.065;
        const y = NOSE_Y - 0.031 - t * 0.014 - Math.sin(Math.PI * t) * 0.024;
        out.set(x, y, faceZ(x, y) + 0.005);
      }, (t) => 0.0048 - t * 0.0018);
      mouthGeos.push({ geo: mouth.mesh.geometry });

      for (let i = 0; i < 3; i++) {
        const x0 = side * (0.215 + i * 0.019);
        const y0 = -0.139 - i * 0.032;
        const z0 = faceZ(x0, y0) + 0.008;
        const path = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(x0, y0, z0),
          new THREE.Vector3(side * 0.44, y0 + 0.035 - i * 0.013, z0 - 0.051),
          new THREE.Vector3(side * (0.677 - i * 0.018), y0 + 0.022 - i * 0.031, 0.27),
        );
        const whisker = new TaperTube3D(16, 5, whiskerMat);
        whisker.update((t, out) => {
          path.getPoint(t, out);
          out.z = Math.max(out.z, faceZ(out.x, out.y) + 0.009);
        }, (t) => 0.0062 * (1 - t * 0.81));
        whiskerGeos.push({ geo: whisker.mesh.geometry });
      }
    }

    this.head.add(new THREE.Mesh(mergeStaticGeometries(mouthGeos), mouthMat));
    this.head.add(new THREE.Mesh(mergeStaticGeometries(whiskerGeos), whiskerMat));
    for (const { geo } of [...mouthGeos, ...whiskerGeos]) geo.dispose();
  }

  public setSkin(skin: CatSkinConfig): void {
    const ginger = skin.maskColor ?? '#d99150';
    const mark = skin.stripeColor ?? '#ae6336';
    const ruff = skin.bellyBibColor ?? '#fffaf0';
    setCoatColors(this.coat, skin.furColor, ginger, mark, ruff);
    this.coat.uniforms.uFlank.value.set(skin.flankColor ?? ginger);
    setCoatColors(this.limbMaterial, skin.furColor);
    this.limbMaterial.uniforms.uRuff.value.set(ruff);
    this.swatPaw.setSkin(skin);
    const innerEar = skin.earInnerColor ?? '#edb19d';
    setCoatColors(this.earCoat, skin.earOuterColor ?? ginger, innerEar, innerEar, skin.earTuftColor ?? skin.furColor);
    setCoatColors(this.noseCoat, skin.noseColor ?? '#df8781');
    setCoatColors(this.tailMaterial, skin.tailColor ?? ginger);
    for (const eye of this.eyes) {
      eye.uniforms.uTop.value.set(skin.eyeColorTop);
      eye.uniforms.uBottom.value.set(skin.eyeColorBottom ?? '#eec268');
      eye.uniforms.uPupil.value.set(skin.pupilColor ?? '#241910');
    }
  }

  public deform(
    headMount: THREE.Group,
    bend: { x: number; z: number; squash: number; bellySwell: number },
    sleep: number,
  ): void {
    headMount.position.y -= HEAD_DROP;
    headMount.position.z += HEAD_FORWARD + sleep * 0.024;
    headMount.scale.copy(HEAD_SCALE);
    headMount.updateMatrix();

    const torso = this.coat.uniforms.uTorsoPose.value as THREE.Matrix4;
    torso.makeScale(1 + bend.bellySwell * 0.45, 1, 1);
    torso.setPosition(bend.x * 0.20, 0, bend.z * 0.20);
    const head = this.coat.uniforms.uHeadPose.value as THREE.Matrix4;
    head.multiplyMatrices(headMount.matrix, this.headRestInverse);
    this.coat.uniforms.uSquash.value = bend.squash;
    // Distribute a deep nod down the upper body so the throat and nape do not fold.
    const nod = smoothstep(0.035, 0.16, Math.abs(headMount.rotation.x));
    this.coat.uniforms.uNeckBase.value = RUFF_BASE - 0.31 * Math.max(sleep, nod * 0.78);
    this.coat.uniforms.uNeckFill.value = 0.12 + 0.88 * Math.max(sleep, nod * 0.36);
  }

  public pose(open: number, gazeX: number, gazeY: number, anger = 0): void {
    for (const [index, eye] of this.eyes.entries()) {
      eye.uniforms.uOpen.value = open;
      eye.uniforms.uAnger.value = anger;
      eye.uniforms.uSide.value = index === 0 ? -1 : 1;
      eye.uniforms.uGaze.value.set(gazeX * 0.14, gazeY * 0.12);
    }
  }
}
