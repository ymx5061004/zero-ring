import type { Monster } from '../entities/Monster';
import type { RNG } from '../core/RNG';

export type AIAction =
  | { type: 'attack'; ranged: boolean }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' };

export interface AIContext {
  player: { x: number; y: number };
  /** True if the tile blocks movement (a wall or out of bounds). */
  isWall: (x: number, y: number) => boolean;
  /** True if another creature occupies the tile. */
  isOccupied: (x: number, y: number) => boolean;
  rng: RNG;
}

const STEP = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const RANGED_REACH = 4;

function canStep(x: number, y: number, ctx: AIContext): boolean {
  return !ctx.isWall(x, y) && !ctx.isOccupied(x, y);
}

/** Greedy step toward the player: try the dominant axis, then the other. */
function stepToward(monster: Monster, ctx: AIContext): AIAction {
  const sx = Math.sign(ctx.player.x - monster.x);
  const sy = Math.sign(ctx.player.y - monster.y);
  const adx = Math.abs(ctx.player.x - monster.x);
  const ady = Math.abs(ctx.player.y - monster.y);
  const order: Array<[number, number]> = adx >= ady ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [dx, dy] of order) {
    if ((dx !== 0 || dy !== 0) && canStep(monster.x + dx, monster.y + dy, ctx)) {
      return { type: 'move', dx, dy };
    }
  }
  return { type: 'wait' };
}

function wander(monster: Monster, ctx: AIContext): AIAction {
  for (const [dx, dy] of ctx.rng.shuffle([...STEP])) {
    if (canStep(monster.x + dx, monster.y + dy, ctx)) return { type: 'move', dx, dy };
  }
  return { type: 'wait' };
}

/**
 * Decide a monster's action for the turn:
 *  - adjacent to the player → attack,
 *  - ranged attacker with a clear short distance → ranged attack,
 *  - player sensed and roughly reachable → step toward,
 *  - otherwise wander (or hold, for 'guard' until the player draws near).
 */
export function decideAction(monster: Monster, ctx: AIContext): AIAction {
  const dist = Math.abs(ctx.player.x - monster.x) + Math.abs(ctx.player.y - monster.y);

  if (dist === 1) return { type: 'attack', ranged: false };

  const sensed = dist <= monster.sightRange;
  if (monster.aiType === 'ranged' && sensed && dist <= RANGED_REACH) {
    return { type: 'attack', ranged: true };
  }
  if (sensed) return stepToward(monster, ctx);

  // Guards stay put until the player is sensed; others mill about.
  if (monster.aiType === 'guard') return { type: 'wait' };
  return ctx.rng.chance(0.6) ? wander(monster, ctx) : { type: 'wait' };
}
