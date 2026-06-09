import type { Entity } from '../entities/Entity';
import type { RNG } from '../core/RNG';

export interface AttackResult {
  /** The blow connected (not dodged). */
  hit: boolean;
  /** The defender evaded entirely. */
  dodged: boolean;
  /** A critical hit (extra damage). */
  crit: boolean;
  /** Damage actually dealt (0 on a dodge). */
  damage: number;
  /** The defender's HP reached 0. */
  killed: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Resolve one attack. Models four things the brief asks for:
 *  - evasion (dodge): scales with the defender's agility advantage,
 *  - critical hits: scale with the attacker's agility,
 *  - defence mitigation: halves the defender's defence off the damage,
 *  - a small damage spread so blows aren't identical.
 * Mutates the defender's HP via Entity.takeDamage.
 */
export function resolveAttack(attacker: Entity, defender: Entity, rng: RNG): AttackResult {
  const evade = clamp(0.05 + (defender.agility - attacker.agility) * 0.035, 0.02, 0.6);
  if (rng.chance(evade)) {
    return { hit: false, dodged: true, crit: false, damage: 0, killed: false };
  }

  const critChance = clamp(0.05 + attacker.agility * 0.012, 0.05, 0.4);
  const crit = rng.chance(critChance);

  const base = Math.max(1, attacker.attack - Math.floor(defender.defense / 2));
  const spread = rng.range(-1, 1);
  let damage = Math.max(1, base + spread);
  if (crit) damage = Math.round(damage * 1.7);
  // 易伤（vulnerable）defenders take noticeably more damage (0.2).
  if (defender.hasStatus('vulnerable')) damage = Math.round(damage * 1.3);

  defender.takeDamage(damage);
  return { hit: true, dodged: false, crit, damage, killed: defender.isDead };
}
