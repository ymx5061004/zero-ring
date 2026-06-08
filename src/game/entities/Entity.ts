/** The stat block every combatant is constructed from. */
export interface EntityInit {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;
}

/**
 * Base class for combatants — the player and monsters. Holds the grid position
 * and core stats. Damage/accuracy maths live in CombatSystem; this only mutates
 * raw HP, so it stays pure and easy to test.
 */
export abstract class Entity {
  x = 0;
  y = 0;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;

  constructor(init: EntityInit) {
    this.hp = init.hp;
    this.maxHp = init.maxHp;
    this.attack = init.attack;
    this.defense = init.defense;
    this.agility = init.agility;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** Subtract already-resolved damage (clamped at 0). */
  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - Math.max(0, Math.floor(amount)));
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, Math.floor(amount)));
  }
}
