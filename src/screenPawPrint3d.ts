import * as THREE from 'three';
import { smoothstep } from './keyboard3d';

const PRINT_LIFETIME = 1.65;

function makePawPrintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e28398';
  ctx.shadowColor = '#d95f8266';
  ctx.shadowBlur = 5;
  // A pressed, slightly squashed paw pad, with four separate toe impressions.
  ctx.beginPath();
  ctx.moveTo(128, 129);
  ctx.bezierCurveTo(107, 126, 98, 147, 83, 165);
  ctx.bezierCurveTo(61, 193, 84, 215, 108, 203);
  ctx.quadraticCurveTo(128, 194, 148, 203);
  ctx.bezierCurveTo(172, 215, 195, 193, 173, 165);
  ctx.bezierCurveTo(158, 147, 149, 126, 128, 129);
  ctx.fill();
  for (const [x, y, rotation] of [[62, 113, -0.5], [103, 79, -0.15], [151, 79, 0.15], [192, 113, 0.5]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 20, 28, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Camera-space ink: stays on the glass as the paw retracts or the cat rotates. */
export class ScreenPawPrint3D {
  public readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makePawPrintTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    rotation: -0.18,
  }));
  private readonly anchor = new THREE.Vector3();
  private stampedAt = -Infinity;

  constructor(camera: THREE.PerspectiveCamera) {
    this.sprite.visible = false;
    this.sprite.renderOrder = 1000;
    camera.add(this.sprite);
  }

  public clear(): void {
    this.stampedAt = -Infinity;
    this.sprite.visible = false;
  }

  public stamp(worldPoint: THREE.Vector3, camera: THREE.PerspectiveCamera, now: number): void {
    camera.updateMatrixWorld();
    this.anchor.copy(worldPoint).project(camera);
    this.stampedAt = now;
    this.update(now, camera);
  }

  public update(now: number, camera: THREE.PerspectiveCamera): void {
    const age = now - this.stampedAt;
    this.sprite.visible = age >= 0 && age < PRINT_LIFETIME;
    if (!this.sprite.visible) return;
    // z=-1 is beyond the camera near plane. Position and size use the same
    // projection, keeping the imprint fixed through orbit/resize and above fur.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.sprite.position.set(this.anchor.x * halfHeight * camera.aspect, this.anchor.y * halfHeight, -1);
    const settle = 1 + 0.12 * (1 - smoothstep(0, 0.16, age));
    this.sprite.scale.setScalar(halfHeight * 0.34 * settle);
    // Let the fist land before the ink appears over it.
    this.sprite.material.opacity = 0.88 * smoothstep(0, 0.08, age) * (1 - smoothstep(0.65, PRINT_LIFETIME, age));
  }
}
