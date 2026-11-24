/** Procedural fur geometry. All points follow the engine's continuous spine/springs. */
export const LONGHAIR_CAT_ID = 'orange-white-longhair';

// These companions use the Canvas engine even when the saved preference is 3D.
export function usesCanvasCat(id: string | undefined): boolean {
  return id === LONGHAIR_CAT_ID || id === 'dafeiyu';
}

interface Point { x: number; y: number }

export const LONGHAIR_BODY_SLICES = [
  { t: 0.12, hw: 50 }, { t: 0.21, hw: 64 }, { t: 0.30, hw: 70 },
  { t: 0.38, hw: 59 }, { t: 0.47, hw: 74 }, { t: 0.57, hw: 79 },
  { t: 0.68, hw: 76 }, { t: 0.79, hw: 75 }, { t: 0.90, hw: 67 },
  { t: 0.98, hw: 48 },
];

/** Short overlapping tufts on a stable contour; no per-frame random noise. */
export function furryEdge(ctx: CanvasRenderingContext2D, from: Point, to: Point, side: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const count = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 9));
  for (let i = 0; i < count; i++) {
    const u = (i + 0.48) / count;
    const v = (i + 1) / count;
    const tuft = (3.5 + Math.sin(i * 2.4) * 1.4) * side;
    ctx.quadraticCurveTo(from.x + dx * u + tuft, from.y + dy * u - 2,
      from.x + dx * v, from.y + dy * v);
  }
}

let ruffCache: HTMLCanvasElement | null = null;

function createRuff(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.translate(96, 44);
  ctx.beginPath();
  ctx.moveTo(-55, -22);
  ctx.quadraticCurveTo(0, -45, 55, -22);
  const edge = [
    [68, -15], [61, -12], [77, 1], [67, 0], [81, 18], [67, 13],
    [71, 31], [57, 25], [58, 45], [44, 36], [40, 57], [28, 46],
    [20, 66], [11, 53], [0, 72], [-11, 53], [-20, 66], [-28, 46],
    [-40, 57], [-44, 36], [-58, 45], [-57, 25], [-71, 31],
    [-67, 13], [-81, 18], [-67, 0], [-77, 1], [-61, -12], [-68, -15],
  ];
  for (let i = 0; i < edge.length; i++) {
    const [x, y] = edge[i];
    const next = i + 1 < edge.length ? edge[i + 1] : [-55, -22];
    ctx.quadraticCurveTo(x, y, (x + next[0]) / 2, (y + next[1]) / 2);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(-12, -16, 8, 0, 12, 94);
  grad.addColorStop(0, '#fffdf7');
  grad.addColorStop(0.6, '#f9f4ea');
  grad.addColorStop(1, '#ded4c3');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(172, 145, 118, 0.25)';
  ctx.lineWidth = 0.65;
  ctx.stroke();
  ctx.clip();
  // Fine directional undercoat is drawn once, then moved continuously with the spine.
  // A fixed seed prevents the fur from flickering or boiling between frames.
  let seed = 154;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = (random() - 0.5) * 154;
    const y = random() * 105 - 31;
    const length = 5 + random() * 17;
    const fan = x * 0.12 * (1 - Math.min(1, (y + 30) / 120));
    ctx.lineWidth = 0.3 + random() * 0.55;
    ctx.strokeStyle = i % 3 ? 'rgba(255, 254, 248, 0.64)' : 'rgba(181, 156, 124, 0.17)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + fan * 0.65, y + length * 0.65, x + fan, y + length);
    ctx.stroke();
  }
  return canvas;
}

export function drawLonghairRuff(ctx: CanvasRenderingContext2D, center: Point): void {
  ruffCache ??= createRuff();
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.drawImage(ruffCache, center.x - 96, center.y - 44, 192, 128);
  ctx.restore();
}

export function drawLonghairFaceFur(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.7;
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const x = 38 + (i % 4) * 7;
      const y = 7 + Math.floor(i / 4) * 5;
      ctx.strokeStyle = i % 3 ? 'rgba(255, 245, 224, 0.64)' : 'rgba(166, 112, 58, 0.22)';
      ctx.beginPath();
      ctx.moveTo(sign * x, y);
      ctx.quadraticCurveTo(sign * (x + 7), y + 1, sign * (x + 11), y + 5);
      ctx.stroke();
    }
    ctx.strokeStyle = '#fffaf1';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(sign * (5 + i * 0.45), -34 + i * 3);
      ctx.quadraticCurveTo(sign * (9 + i * 0.6), -30 + i * 3, sign * (10 + i * 0.7), -28 + i * 3);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A tapered squirrel-tail silhouette follows the same cubic as keyboard tail taps. */
export function drawLonghairTail(
  ctx: CanvasRenderingContext2D, p0: Point, p1: Point, p2: Point, p3: Point,
  baseColor: string, tipColor: string,
): void {
  const edges: Point[][] = [[], []];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const m = 1 - t;
    const x = m ** 3 * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t ** 3 * p3.x;
    const y = m ** 3 * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t ** 3 * p3.y;
    const tx = 3 * m * m * (p1.x - p0.x) + 6 * m * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const ty = 3 * m * m * (p1.y - p0.y) + 6 * m * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    const len = Math.max(0.001, Math.hypot(tx, ty));
    const radius = (8 * m + 23 * Math.sin(Math.PI * t) ** 0.65) + Math.sin(i * 2.4) * 1.6;
    for (let side = 0; side < 2; side++) {
      const sign = side ? -1 : 1;
      edges[side].push({ x: x - ty / len * radius * sign, y: y + tx / len * radius * sign });
    }
  }
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  const contour = [...edges[0], ...edges[1].reverse()];
  ctx.moveTo(contour[0].x, contour[0].y);
  for (const p of contour) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  const grad = ctx.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
  grad.addColorStop(0, baseColor);
  grad.addColorStop(1, tipColor);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#b57b4c';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 224, 177, 0.45)';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y + i * 4);
    ctx.bezierCurveTo(p1.x, p1.y + i * 5, p2.x + i * 3, p2.y, p3.x, p3.y);
    ctx.stroke();
  }
  ctx.restore();
}
