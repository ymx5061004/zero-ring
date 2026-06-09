import type { Monster } from '../entities/Monster';
import type { Player } from '../entities/Player';
import type { RNG } from './RNG';
import { decideAction, type AIAction, type AIContext } from '../systems/AISystem';
import { resolveAttack, type AttackResult } from '../systems/CombatSystem';
import { applyStatus } from '../systems/StatusSystem';
import { hasLineOfSight } from '../world/Los';

export interface TurnEvent {
  monster: Monster;
  action: AIAction;
  /** Present when the action attacked the player. */
  combat?: AttackResult;
}

export interface TurnContext {
  player: Player;
  inBounds: (x: number, y: number) => boolean;
  /** True if the tile is a solid wall. */
  isWallTile: (x: number, y: number) => boolean;
  /** True if the tile is a shut (closed / locked) door. */
  isClosedDoor: (x: number, y: number) => boolean;
  /** True if the tile stops sight / shots (wall or shut door, or out of bounds). */
  blocksSight: (x: number, y: number) => boolean;
  /** Open a door a door-opening monster just stepped onto. */
  openDoor: (x: number, y: number) => void;
  rng: RNG;
}

const keyOf = (x: number, y: number): number => y * 4096 + x;

/**
 * Run one round of monster turns. Maintains a live occupancy set so monsters
 * never overlap each other or the player, attack when adjacent, and (0.2) honour
 * status effects: frozen / slowed / slow-but-strong skip their turn on the right
 * cadence, poison-attackers envenom the player, and door-openers open doors they
 * pass through. Returns an ordered event list for the scene to animate.
 */
export function runMonsterTurns(monsters: Monster[], ctx: TurnContext): TurnEvent[] {
  const occupied = new Set<number>();
  for (const m of monsters) if (!m.isDead) occupied.add(keyOf(m.x, m.y));
  occupied.add(keyOf(ctx.player.x, ctx.player.y)); // monsters route around the player

  const aiCtx: AIContext = {
    player: ctx.player,
    inBounds: ctx.inBounds,
    isWallTile: ctx.isWallTile,
    isClosedDoor: ctx.isClosedDoor,
    isOccupied: (x, y) => occupied.has(keyOf(x, y)),
    hasLos: (x0, y0, x1, y1) => hasLineOfSight(x0, y0, x1, y1, ctx.blocksSight),
    rng: ctx.rng,
  };

  const events: TurnEvent[] = [];
  for (const monster of monsters) {
    if (monster.isDead) continue;

    // Frozen monsters forfeit the turn; slowed / slow-but-strong act at half pace.
    if (monster.hasStatus('frozen')) {
      events.push({ monster, action: { type: 'wait' } });
      continue;
    }
    const halfSpeed = monster.hasTrait('slowButStrong') || monster.hasStatus('slowed');
    if (halfSpeed) {
      monster.skipNext = !monster.skipNext;
      if (!monster.skipNext) {
        events.push({ monster, action: { type: 'wait' } });
        continue;
      }
    } else {
      monster.skipNext = false;
    }

    const action = decideAction(monster, aiCtx);

    if (action.type === 'move') {
      occupied.delete(keyOf(monster.x, monster.y));
      monster.x += action.dx;
      monster.y += action.dy;
      occupied.add(keyOf(monster.x, monster.y));
      if (monster.hasTrait('opensDoors') && ctx.isClosedDoor(monster.x, monster.y)) {
        ctx.openDoor(monster.x, monster.y);
      }
      events.push({ monster, action });
    } else if (action.type === 'attack') {
      const combat = resolveAttack(monster, ctx.player, ctx.rng);
      if (combat.hit) {
        // slow-but-strong blows land heavier; poison-attackers envenom.
        if (monster.hasTrait('slowButStrong')) {
          const extra = Math.ceil(combat.damage * 0.5);
          ctx.player.takeDamage(extra);
          combat.damage += extra;
          combat.killed = ctx.player.isDead;
        }
        if (monster.hasTrait('poisonAttack')) {
          applyStatus(ctx.player, 'poisoned', 3, 2, ctx.rng);
        }
      }
      events.push({ monster, action, combat });
      if (ctx.player.isDead) break;
    } else {
      events.push({ monster, action });
    }
  }
  return events;
}
