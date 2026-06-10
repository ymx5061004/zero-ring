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

/** Greedy step toward an arbitrary target tile: dominant axis first, then the other. */
function stepTo(monster: Monster, tx: number, ty: number, ctx: AIContext): AIAction {
  const sx = Math.sign(tx - monster.x);
  const sy = Math.sign(ty - monster.y);
  const adx = Math.abs(tx - monster.x);
  const ady = Math.abs(ty - monster.y);
  const order: Array<[number, number]> = adx >= ady ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [dx, dy] of order) {
    if ((dx !== 0 || dy !== 0) && canStep(monster, monster.x + dx, monster.y + dy, ctx)) {
      return { type: 'move', dx, dy };
    }
  }
  return { type: 'wait' };
}

/** Greedy step toward the player. */
function stepToward(monster: Monster, ctx: AIContext): AIAction {
  return stepTo(monster, ctx.player.x, ctx.player.y, ctx);
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
 * Decide a monster's action. Priority order (0.3, req. phase 3):
 *   1. frozen / can't-act — handled *before* this in TurnSystem (forfeits the turn).
 *   2. confused → stumble randomly.
 *   3. feared → flee.
 *   4. carrying stolen gold → flee with the loot.
 *   5. low-HP break (fleesWhenLowHp) → flee.
 *   6. adjacent → melee (distance-keepers back off first).
 *   7. ranged + line of sight → shoot.
 *   8. guardsTreasure → chase only within a leash of its anchor, else return to post.
 *   9. chase the player.
 *  10. wander / hold.
 */
export function decideAction(monster: Monster, ctx: AIContext): AIAction {
  // 2. Confusion: stumble around regardless of the player's position.
  if (monster.hasStatus('confused')) return wander(monster, ctx);

  const px = ctx.player.x;
  const py = ctx.player.y;
  const manh = Math.abs(px - monster.x) + Math.abs(py - monster.y);
  const cheb = Math.max(Math.abs(px - monster.x), Math.abs(py - monster.y));

  // 3/4/5. Flee instincts: fear, a satchel of stolen gold, or a low-HP break.
  const fleeing =
    monster.hasStatus('feared') ||
    monster.stolenGold > 0 ||
    (monster.hasTrait('fleesWhenLowHp') && monster.hp <= monster.maxHp * 0.3);
  if (fleeing) return stepAway(monster, ctx);

  // 6. Adjacent: melee — unless a distance-keeper would rather hold its range.
  if (manh === 1) {
    if (monster.hasTrait('keepsDistance')) {
      const away = stepAway(monster, ctx);
      if (away.type === 'move') return away;
    }
    return { type: 'attack', ranged: false };
  }

  const sensed = cheb <= monster.sightRange;

  // 7. Ranged attack: requires a clear line of sight (no shooting through walls).
  if (sensed && monster.aiType === 'ranged' && cheb <= RANGED_REACH && ctx.hasLos(monster.x, monster.y, px, py)) {
    if (monster.hasTrait('keepsDistance') && cheb <= 2) {
      const away = stepAway(monster, ctx);
      if (away.type === 'move') return away;
    }
    return { type: 'attack', ranged: true };
  }

  // 8. guardsTreasure (non-boss): chase only within a leash of its anchor; once it
  // strays too far — or loses sight of the player — it heads back to its post and
  // holds there. Bosses are excluded (they fight to the death, see TurnSystem/guard).
  if (
    monster.hasTrait('guardsTreasure') && !monster.boss &&
    monster.anchorX !== undefined && monster.anchorY !== undefined
  ) {
    const ax = monster.anchorX;
    const ay = monster.anchorY;
    const fromAnchor = Math.max(Math.abs(monster.x - ax), Math.abs(monster.y - ay));
    const LEASH = 7;
    const seesPlayer = sensed && ctx.hasLos(monster.x, monster.y, px, py);
    if (fromAnchor > LEASH || !seesPlayer) {
      return fromAnchor === 0 ? { type: 'wait' } : stepTo(monster, ax, ay, ctx);
    }
    // within leash and in sight → chase (fall through).
  }

  if (!sensed) {
    if (monster.aiType === 'guard') return { type: 'wait' };
    return ctx.rng.chance(0.6) ? wander(monster, ctx) : { type: 'wait' };
  }

  // 9. Distance-keepers back off when the player crowds them; otherwise chase.
  if (monster.hasTrait('keepsDistance') && cheb <= 2) {
    const away = stepAway(monster, ctx);
    if (away.type === 'move') return away;
  }

  return stepToward(monster, ctx);
}
