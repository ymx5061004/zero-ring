import type { CharClass, ClassId } from '../data/classes';
import { getClass } from '../data/classes';
import type { RunState } from '../core/types';
import { Entity } from './Entity';

/** The outcome of a single level-up, for logging and feedback. */
export interface LevelUp {
  level: number;
  maxHpGain: number;
  stat: 'attack' | 'defense';
  healed: number;
}

/**
 * The hero: a positioned Entity with a class, magic, and a simple level/exp
 * progression. Position (x, y) is inherited from Entity and owned by the scene.
 */
export class Player extends Entity {
  readonly classId: ClassId;
  magic: number;
  level: number;
  exp: number;
  expToNext: number;
  /** Mana powers active skills and ranged spells; regenerates slowly with steps. */
  mana: number;
  maxMana: number;
  /** Internal counter so mana regenerates every few turns rather than each step. */
  private manaTick = 0;

  private constructor(init: {
    classId: ClassId;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    agility: number;
    magic: number;
    mana: number;
    maxMana: number;
    level: number;
    exp: number;
  }) {
    super({
      hp: init.hp,
      maxHp: init.maxHp,
      attack: init.attack,
      defense: init.defense,
      agility: init.agility,
      resistances: { ...(getClass(init.classId).resist ?? {}) },
    });
    this.classId = init.classId;
    this.magic = init.magic;
    this.mana = init.mana;
    this.maxMana = init.maxMana;
    this.level = init.level;
    this.exp = init.exp;
    this.expToNext = Player.expForLevel(init.level);
  }

  /** Create a fresh, full-health level-1 hero from a class definition. */
  static fromClass(cls: CharClass): Player {
    return new Player({
      classId: cls.id,
      hp: cls.hp,
      maxHp: cls.hp,
      attack: cls.attack,
      defense: cls.defense,
      agility: cls.agility,
      magic: cls.magic,
      mana: cls.mana,
      maxMana: cls.mana,
      level: 1,
      exp: 0,
    });
  }

  /** Restore a hero from a saved run (defaults mana for pre-0.2 saves). */
  static fromRun(run: RunState): Player {
    const cls = getClass(run.classId);
    return new Player({
      classId: run.classId,
      hp: run.hp,
      maxHp: run.maxHp,
      attack: run.attack,
      defense: run.defense,
      agility: run.agility,
      magic: run.magic,
      mana: run.mana ?? cls.mana,
      maxMana: run.maxMana ?? cls.mana,
      level: run.level,
      exp: run.exp,
    });
  }

  /** Spend mana for a skill; returns false (and spends nothing) if short. */
  spendMana(amount: number): boolean {
    if (this.mana < amount) return false;
    this.mana = Math.max(0, this.mana - amount);
    return true;
  }

  /** Restore mana, clamped to the maximum. */
  restoreMana(amount: number): void {
    this.mana = Math.min(this.maxMana, this.mana + Math.max(0, amount));
  }

  /** Called once per game turn: trickle mana back (every 3rd turn). */
  regenMana(): void {
    if (this.maxMana <= 0 || this.mana >= this.maxMana) return;
    if (++this.manaTick >= 3) {
      this.manaTick = 0;
      this.mana = Math.min(this.maxMana, this.mana + 1);
    }
  }

  get def(): CharClass {
    return getClass(this.classId);
  }

  /** Experience needed to advance from `level` to the next. */
  static expForLevel(level: number): number {
    return 12 + level * 8;
  }

  /**
   * Add experience; may trigger one or more level-ups. Each level-up raises max
   * HP and either attack or defence, and restores part of the player's health.
   * Returns the final level-up result, or null if none occurred.
   */
  gainExp(amount: number): LevelUp | null {
    this.exp += Math.max(0, Math.floor(amount));
    let result: LevelUp | null = null;
    while (this.exp >= this.expToNext) {
      this.exp -= this.expToNext;
      this.level += 1;
      const maxHpGain = 4 + Math.floor(this.level / 2);
      this.maxHp += maxHpGain;
      const stat: 'attack' | 'defense' = this.level % 2 === 0 ? 'attack' : 'defense';
      if (stat === 'attack') this.attack += 1;
      else this.defense += 1;
      const healed = Math.floor(this.maxHp * 0.4);
      this.heal(healed);
      this.expToNext = Player.expForLevel(this.level);
      result = { level: this.level, maxHpGain, stat, healed };
    }
    return result;
  }
}
