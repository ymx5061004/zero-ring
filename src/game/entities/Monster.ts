import { Entity } from './Entity';
import type { AIType, MonsterDef, MonsterTag, MonsterTrait } from '../data/monsters';

/** A live monster instance: a positioned Entity plus its definition + AI traits. */
export class Monster extends Entity {
  readonly id: string;
  /** Mutable so an elite can prefix its name (e.g. 精英·骷髅). */
  name: string;
  /** Mutable so an elite can grant extra experience. */
  exp: number;
  readonly sightRange: number;
  readonly aiType: AIType;
  readonly spriteFrame: number;
  readonly tags: MonsterTag[];
  readonly traits: MonsterTrait[];
  /** Status inflicted on a successful hit (0.3.1); resolved in presentMonsterAttack. */
  readonly onHit?: MonsterDef['onHit'];
  readonly boss: boolean;
  /** An elevated variant: tougher, hits harder, worth more, drops better (0.3). */
  elite = false;
  /** Boss only: flips true once the second phase has been triggered. */
  phase2 = false;
  /** slowButStrong monsters act on alternating turns; this toggles each turn. */
  skipNext = false;
  /** A split-spawned child never splits again (prevents runaway division). */
  spawnedSplit = false;
  /** Set once its death has been handled, so it is dispatched only once. */
  dying = false;

  // --- 0.3 trait runtime state (all optional / default, so old saves load) ---
  /** guardsTreasure: the post this monster defends (set at spawn). */
  anchorX?: number;
  anchorY?: number;
  /** stealsGold: coins lifted off the player, dropped back when it dies. */
  stolenGold = 0;
  /** explodesOnDeath: one-shot "danger" tells, so the threat is learnable. */
  warningShown = false;
  lowHpWarned = false;

  constructor(def: MonsterDef, x: number, y: number) {
    super({
      hp: def.hp,
      maxHp: def.hp,
      attack: def.attack,
      defense: def.defense,
      agility: def.agility,
      resistances: { ...(def.resist ?? {}) },
    });
    this.id = def.id;
    this.name = def.name;
    this.exp = def.exp;
    this.sightRange = def.sightRange;
    this.aiType = def.aiType;
    this.spriteFrame = def.spriteFrame;
    this.tags = def.tags ?? [];
    this.traits = def.traits ?? [];
    this.onHit = def.onHit;
    this.boss = def.boss ?? false;
    this.x = x;
    this.y = y;
  }

  hasTrait(trait: MonsterTrait): boolean {
    return this.traits.includes(trait);
  }

  /** Promote to an elite: tougher, harder-hitting and worth more experience. */
  makeElite(depth: number): void {
    this.elite = true;
    this.maxHp = Math.round(this.maxHp * 1.8);
    this.hp = this.maxHp;
    this.attack += Math.floor(depth / 2) + 1;
    this.exp = Math.round(this.exp * 2);
    this.name = `精英·${this.name}`;
  }
}
