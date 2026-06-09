import type { DamageType, Resistances, StatusInstance, StatusType } from '../systems/StatusSystem';

/** The stat block every combatant is constructed from. */
export interface EntityInit {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;
  resistances?: Resistances;
}

/**
 * Base class for combatants — the player and monsters. Holds the grid position
 * and core stats. Damage/accuracy maths live in CombatSystem; this only mutates
 * raw HP, so it stays pure and easy to test. Status effects (0.2) and resistances
 * live here so both the player and every monster share one code path.
 */
export abstract class Entity {
  x = 0;
  y = 0;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;

  /** Active status effects, ticked once per game turn (see StatusSystem). */
  statuses: StatusInstance[] = [];
  /** Damage-channel resistances (0..1); empty means no resistance. */
  resistances: Resistances;

  constructor(init: EntityInit) {
    this.hp = init.hp;
    this.maxHp = init.maxHp;
    this.attack = init.attack;
    this.defense = init.defense;
    this.agility = init.agility;
    this.resistances = init.resistances ?? {};
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  hasStatus(type: StatusType): boolean {
    return this.statuses.some((s) => s.type === type);
  }

  getStatus(type: StatusType): StatusInstance | undefined {
    return this.statuses.find((s) => s.type === type);
  }

  removeStatus(type: StatusType): void {
    this.statuses = this.statuses.filter((s) => s.type !== type);
  }

  resistanceTo(channel: DamageType): number {
    return this.resistances[channel] ?? 0;
  }

  /** Subtract already-resolved damage (clamped at 0). */
  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - Math.max(0, Math.floor(amount)));
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, Math.floor(amount)));
  }
}
