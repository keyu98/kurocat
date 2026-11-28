import * as THREE from 'three';
import { smoothstep } from './keyboard3d';

const SCRATCH_LIFETIME = 1.65;

function drawClawScratches(canvas: HTMLCanvasElement, progress: number, side: -1 | 1): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 256, progress * 256);
  ctx.clip();
  if (side < 0) {
    ctx.translate(256, 0);
    ctx.scale(-1, 1);
  }
  // Three tapered cuts, drawn from top-right to bottom-left with the wrist
  // flick. Warm grooves and a fine ivory edge read on light or dark desktops.
  for (const offset of [-46, 0, 46]) {
    const sx = 162 + offset, sy = 23 + Math.abs(offset) * 0.2;
    const ex = sx - 82, ey = 232 - Math.abs(offset) * 0.15;
    const points = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, s = 1 - t;
      const x = s ** 3 * sx + 3 * s * s * t * (sx + 5) + 3 * s * t * t * (sx - 45) + t ** 3 * ex;
      const y = s ** 3 * sy + 3 * s * s * t * (sy + 55) + 3 * s * t * t * (ey - 45) + t ** 3 * ey;
      const dx = 3 * s * s * 5 - 300 * s * t + 3 * t * t * (ex - sx + 45);
      const dy = 3 * s * s * 55 + 6 * s * t * (ey - sy - 100) + 3 * t * t * 45;
      const length = Math.hypot(dx, dy);
      points.push({ x, y, nx: -dy / length, ny: dx / length, width: 0.15 + 4.0 * Math.sin(Math.PI * t) ** 0.8 });
    }
    ctx.fillStyle = '#a87656';
    ctx.shadowColor = '#59483b55';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p.x + p.nx * p.width, y = p.y + p.ny * p.width;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      ctx.lineTo(p.x - p.nx * p.width, p.y - p.ny * p.width);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff0d5';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p.x + p.nx * p.width * 0.85, y = p.y + p.ny * p.width * 0.85;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function makeScratchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Scratches stay on the glass as the paw retracts or the cat rotates. */
export class ScreenClawScratches3D {
  public readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeScratchTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  private readonly anchor = new THREE.Vector3();
  private startedAt = -Infinity;
  private revealed = -1;
  private side: -1 | 1 = 1;

  constructor(camera: THREE.PerspectiveCamera) {
    this.sprite.visible = false;
    this.sprite.renderOrder = 1000;
    camera.add(this.sprite);
  }

  public clear(): void {
    this.startedAt = -Infinity;
    this.sprite.visible = false;
  }

  public strike(worldPoint: THREE.Vector3, camera: THREE.PerspectiveCamera, now: number, side: -1 | 1): void {
    camera.updateMatrixWorld();
    this.anchor.copy(worldPoint).project(camera);
    // Mirror both the trail and its anchor for the selected paw.
    this.side = side;
    this.anchor.x -= side * 0.06 / camera.aspect;
    this.anchor.y -= 0.17;
    this.startedAt = now;
    this.revealed = -1;
    this.update(now, camera);
  }

  public update(now: number, camera: THREE.PerspectiveCamera): void {
    const age = now - this.startedAt;
    this.sprite.visible = age >= 0 && age < SCRATCH_LIFETIME;
    if (!this.sprite.visible) return;
    // z=-1 is beyond the camera near plane. Position and size use the same
    // projection, keeping the cuts fixed through orbit/resize and above fur.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.sprite.position.set(this.anchor.x * halfHeight * camera.aspect, this.anchor.y * halfHeight, -1);
    this.sprite.scale.setScalar(halfHeight * 0.45);
    const reveal = smoothstep(0, 0.13, age);
    if (reveal !== this.revealed) {
      const texture = this.sprite.material.map!;
      drawClawScratches(texture.image as HTMLCanvasElement, reveal, this.side);
      texture.needsUpdate = true;
      this.revealed = reveal;
    }
    this.sprite.material.opacity = 0.92 * smoothstep(0, 0.035, age) * (1 - smoothstep(0.65, SCRATCH_LIFETIME, age));
  }
}
