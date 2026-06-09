import type { Monster } from '../entities/Monster';
import type { RNG } from '../core/RNG';

export type AIAction =
  | { type: 'attack'; ranged: boolean }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' };

export interface AIContext {
  player: { x: number; y: number };
  /** In-bounds test for the map. */
  inBounds: (x: number, y: number) => boolean;
  /** True if the tile is a solid wall (in bounds). */
  isWallTile: (x: number, y: number) => boolean;
  /** True if the tile is a shut (closed / locked) door. */
  isClosedDoor: (x: number, y: number) => boolean;
  /** True if another creature occupies the tile. */
  isOccupied: (x: number, y: number) => boolean;
  /** Clear line of sight between two tiles (walls / shut doors block). */
  hasLos: (x0: number, y0: number, x1: number, y1: number) => boolean;
  rng: RNG;
}

const STEP = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const RANGED_REACH = 4;

/** Whether a monster may enter (x, y), honouring its phasing / door traits. */
function canStep(monster: Monster, x: number, y: number, ctx: AIContext): boolean {
  if (!ctx.inBounds(x, y) || ctx.isOccupied(x, y)) return false;
  if (ctx.isWallTile(x, y)) return monster.hasTrait('phasesThroughWalls');
  if (ctx.isClosedDoor(x, y)) return monster.hasTrait('opensDoors');
  return true;
}

/** Greedy step toward the player: try the dominant axis, then the other. */
function stepToward(monster: Monster, ctx: AIContext): AIAction {
  const sx = Math.sign(ctx.player.x - monster.x);
  const sy = Math.sign(ctx.player.y - monster.y);
  const adx = Math.abs(ctx.player.x - monster.x);
  const ady = Math.abs(ctx.player.y - monster.y);
  const order: Array<[number, number]> = adx >= ady ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [dx, dy] of order) {
    if ((dx !== 0 || dy !== 0) && canStep(monster, monster.x + dx, monster.y + dy, ctx)) {
      return { type: 'move', dx, dy };
    }
  }
  return { type: 'wait' };
}

/** Greedy step directly away from the player (fleeing / keeping distance). */
function stepAway(monster: Monster, ctx: AIContext): AIAction {
  const sx = -Math.sign(ctx.player.x - monster.x);
  const sy = -Math.sign(ctx.player.y - monster.y);
  const adx = Math.abs(ctx.player.x - monster.x);
  const ady = Math.abs(ctx.player.y - monster.y);
  const order: Array<[number, number]> = adx >= ady ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [dx, dy] of order) {
    if ((dx !== 0 || dy !== 0) && canStep(monster, monster.x + dx, monster.y + dy, ctx)) {
      return { type: 'move', dx, dy };
    }
  }
  return wander(monster, ctx);
}

function wander(monster: Monster, ctx: AIContext): AIAction {
  for (const [dx, dy] of ctx.rng.shuffle([...STEP])) {
    if (canStep(monster, monster.x + dx, monster.y + dy, ctx)) return { type: 'move', dx, dy };
  }
  return { type: 'wait' };
}

/**
 * Decide a monster's action. On top of the 0.1 chase logic this adds (req. phase
 * 6): confusion (erratic), fear / low-HP fleeing, distance-keeping, and a true
 * line-of-sight requirement for ranged attacks (no shooting through walls).
 */
export function decideAction(monster: Monster, ctx: AIContext): AIAction {
  // Confusion: stumble around regardless of the player's position.
  if (monster.hasStatus('confused')) return wander(monster, ctx);

  const px = ctx.player.x;
  const py = ctx.player.y;
  const manh = Math.abs(px - monster.x) + Math.abs(py - monster.y);
  const cheb = Math.max(Math.abs(px - monster.x), Math.abs(py - monster.y));

  // Fear or a low-HP flee instinct sends the monster running.
  const fleeing =
    monster.hasStatus('feared') ||
    (monster.hasTrait('fleesWhenLowHp') && monster.hp <= monster.maxHp * 0.3);
  if (fleeing) return stepAway(monster, ctx);

  // Adjacent: melee — unless it would rather hold its range.
  if (manh === 1) {
    if (monster.hasTrait('keepsDistance')) {
      const away = stepAway(monster, ctx);
      if (away.type === 'move') return away;
    }
    return { type: 'attack', ranged: false };
  }

  const sensed = cheb <= monster.sightRange;
  if (!sensed) {
    if (monster.aiType === 'guard') return { type: 'wait' };
    return ctx.rng.chance(0.6) ? wander(monster, ctx) : { type: 'wait' };
  }

  // Ranged attack: requires a clear line of sight (req. phase 3 / 6).
  if (monster.aiType === 'ranged' && cheb <= RANGED_REACH && ctx.hasLos(monster.x, monster.y, px, py)) {
    if (monster.hasTrait('keepsDistance') && cheb <= 2) {
      const away = stepAway(monster, ctx);
      if (away.type === 'move') return away;
    }
    return { type: 'attack', ranged: true };
  }

  // Distance-keepers back off when the player crowds them.
  if (monster.hasTrait('keepsDistance') && cheb <= 2) {
    const away = stepAway(monster, ctx);
    if (away.type === 'move') return away;
  }

  return stepToward(monster, ctx);
}
