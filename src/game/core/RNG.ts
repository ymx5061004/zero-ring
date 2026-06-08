/**
 * Deterministic pseudo-random generator (mulberry32). Seeding the same value
 * always produces the same sequence, which keeps dungeon generation reproducible
 * and testable. Used everywhere the game needs randomness with a known seed.
 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    // Coerce to a non-zero 32-bit unsigned integer.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, maxInclusive]. */
  range(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}
