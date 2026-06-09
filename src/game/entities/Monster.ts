import { Entity } from './Entity';
import type { AIType, MonsterDef, MonsterTag, MonsterTrait } from '../data/monsters';

/** A live monster instance: a positioned Entity plus its definition + AI traits. */
export class Monster extends Entity {
  readonly id: string;
  readonly name: string;
  readonly exp: number;
  readonly sightRange: number;
  readonly aiType: AIType;
  readonly spriteFrame: number;
  readonly tags: MonsterTag[];
  readonly traits: MonsterTrait[];
  readonly boss: boolean;
  /** Boss only: flips true once the second phase has been triggered. */
  phase2 = false;
  /** slowButStrong monsters act on alternating turns; this toggles each turn. */
  skipNext = false;
  /** A split-spawned child never splits again (prevents runaway division). */
  spawnedSplit = false;
  /** Set once its death has been handled, so it is dispatched only once. */
  dying = false;

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
    this.boss = def.boss ?? false;
    this.x = x;
    this.y = y;
  }

  hasTrait(trait: MonsterTrait): boolean {
    return this.traits.includes(trait);
  }
}
