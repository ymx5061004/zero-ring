import type { Monster } from '../entities/Monster';
import type { Player } from '../entities/Player';
import type { RNG } from './RNG';
import { decideAction, type AIAction, type AIContext } from '../systems/AISystem';
import { resolveAttack, type AttackResult } from '../systems/CombatSystem';

export interface TurnEvent {
  monster: Monster;
  action: AIAction;
  /** Present when the action attacked the player. */
  combat?: AttackResult;
}

export interface TurnContext {
  player: Player;
  /** True if the tile blocks movement (wall / out of bounds). */
  isWall: (x: number, y: number) => boolean;
  rng: RNG;
}

const keyOf = (x: number, y: number): number => y * 4096 + x;

/**
 * Run one round of monster turns. Maintains a live occupancy set so monsters
 * never walk through walls (req. 6), never overlap each other or the player
 * (req. 7), and attack the player when adjacent. Returns an ordered list of
 * events for the scene to animate and log. Stops early if the player dies.
 */
export function runMonsterTurns(monsters: Monster[], ctx: TurnContext): TurnEvent[] {
  const occupied = new Set<number>();
  for (const m of monsters) if (!m.isDead) occupied.add(keyOf(m.x, m.y));
  occupied.add(keyOf(ctx.player.x, ctx.player.y)); // monsters route around the player

  const aiCtx: AIContext = {
    player: ctx.player,
    isWall: ctx.isWall,
    isOccupied: (x, y) => occupied.has(keyOf(x, y)),
    rng: ctx.rng,
  };

  const events: TurnEvent[] = [];
  for (const monster of monsters) {
    if (monster.isDead) continue;
    const action = decideAction(monster, aiCtx);

    if (action.type === 'move') {
      occupied.delete(keyOf(monster.x, monster.y));
      monster.x += action.dx;
      monster.y += action.dy;
      occupied.add(keyOf(monster.x, monster.y));
      events.push({ monster, action });
    } else if (action.type === 'attack') {
      const combat = resolveAttack(monster, ctx.player, ctx.rng);
      events.push({ monster, action, combat });
      if (ctx.player.isDead) break;
    } else {
      events.push({ monster, action });
    }
  }
  return events;
}
