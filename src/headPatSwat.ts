export const DEFAULT_HEAD_PAT_SWAT_CHANCE = 0.25;
export const SWAT_DURATION_MS = 780;
export const SWAT_COOLDOWN_MS = 3000;
export const SWAT_IMPACT_MS = SWAT_DURATION_MS * 0.52;

export function normalizeSwatChance(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_HEAD_PAT_SWAT_CHANCE;
}

// x/lift/reach are local to the 3D cat;
// the original body, markings, tail and materials continue rendering throughout.
const POSES = [
  { t: 0, x: 0.32, lift: 0, reach: 0, grip: 0.35 },
  { t: 0.22, x: 0.95, lift: 0.65, reach: 0.1, grip: 0.35 },
  { t: 0.38, x: 1.05, lift: 0.95, reach: 0.2, grip: 0.55 },
  { t: 0.52, x: 1.3, lift: 1.12, reach: 1.15, grip: 1 },
  { t: 0.65, x: 0.5, lift: 0.63, reach: 0.9, grip: 0.95 },
  { t: 0.72, x: 0.4, lift: 0.4, reach: 0.25, grip: 0.7 },
  { t: 1, x: 0.32, lift: 0, reach: 0, grip: 0.35 },
];

export class HeadPatSwat {
  public chance = DEFAULT_HEAD_PAT_SWAT_CHANCE;
  private startedAt = -Infinity;
  private rolledAt = -Infinity;
  private impactPending = false;
  private last: { x: number; y: number; at: number } | null = null;
  private direction: { x: number; y: number } | null = null;
  private travel = 0;
  private reverse = 0;
  private turns = 0;

  public resetGesture(): void {
    this.last = null;
    this.direction = null;
    this.travel = this.reverse = this.turns = 0;
  }

  public cancel(): void {
    this.startedAt = -Infinity;
    this.impactPending = false;
    this.resetGesture();
  }

  public isActive(now: number): boolean {
    return now >= this.startedAt && now - this.startedAt < SWAT_DURATION_MS;
  }

  /** Two deliberate 14px reversals; never roll on hover, jitter or every frame. */
  public move(
    x: number,
    y: number,
    now: number,
    eligible: boolean,
    random = Math.random,
  ): boolean {
    if (!eligible || this.isActive(now)) {
      this.resetGesture();
      return false;
    }
    if (this.last && now - this.last.at > 900) this.resetGesture();
    const prev = this.last;
    this.last = { x, y, at: now };
    if (!prev) return false;
    const dx = x - prev.x;
    const dy = y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1.5) {
      this.last = prev;
      return false;
    }
    if (dist >= 80) {
      this.resetGesture();
      return false;
    }
    if (!this.direction) this.direction = { x: dx / dist, y: dy / dist };
    const dot = (dx / dist) * this.direction.x + (dy / dist) * this.direction.y;
    if (dot >= 0.35) {
      this.travel += dist;
      this.reverse = Math.max(0, this.reverse - dist * 0.5);
      return false;
    }
    this.reverse += dist;
    if (this.travel < 14 || this.reverse < 14) return false;
    this.turns++;
    this.direction = { x: dx / dist, y: dy / dist };
    this.travel = this.reverse;
    this.reverse = 0;
    if (this.turns < 2) return false;
    this.turns = 0;
    if (now - this.rolledAt < SWAT_COOLDOWN_MS) return false;
    this.rolledAt = now; // Normal reactions also consume this roll's cooldown.
    if (random() >= normalizeSwatChance(this.chance)) return false;
    this.startedAt = now;
    this.impactPending = true;
    this.resetGesture();
    return true;
  }

  /** Consume once on the first frame reaching contact, including a skipped frame. */
  public takeImpact(now: number): boolean {
    if (!this.impactPending || now < this.startedAt + SWAT_IMPACT_MS) return false;
    this.impactPending = false;
    return this.isActive(now);
  }

  public pose(now: number) {
    if (!this.isActive(now)) return null;
    const t = (now - this.startedAt) / SWAT_DURATION_MS;
    let i = 0;
    while (i < POSES.length - 2 && t >= POSES[i + 1].t) i++;
    const a = POSES[i],
      b = POSES[i + 1];
    const u = (t - a.t) / (b.t - a.t);
    const smooth = u * u * (3 - 2 * u);
    const mix = (x: number, y: number) => x + (y - x) * smooth;
    return {
      x: mix(a.x, b.x),
      lift: mix(a.lift, b.lift),
      reach: mix(a.reach, b.reach),
      grip: mix(a.grip, b.grip),
      claws: Math.min(1, Math.max(0, (t - 0.40) / 0.08), Math.max(0, (0.72 - t) / 0.07)),
      weight: Math.min(1, t / 0.12, (1 - t) / 0.18),
      anger: Math.min(1, t / 0.08, (1 - t) / 0.22),
    };
  }
}
