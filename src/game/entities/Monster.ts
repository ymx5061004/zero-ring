import { Entity } from './Entity';
import type { AIType, MonsterDef } from '../data/monsters';

/** A live monster instance: a positioned Entity plus its definition + AI traits. */
export class Monster extends Entity {
  readonly id: string;
  readonly name: string;
  readonly exp: number;
  readonly sightRange: number;
  readonly aiType: AIType;
  readonly spriteFrame: number;
  /** Set once its death has been handled, so it is dispatched only once. */
  dying = false;

  constructor(def: MonsterDef, x: number, y: number) {
    super({ hp: def.hp, maxHp: def.hp, attack: def.attack, defense: def.defense, agility: def.agility });
    this.id = def.id;
    this.name = def.name;
    this.exp = def.exp;
    this.sightRange = def.sightRange;
    this.aiType = def.aiType;
    this.spriteFrame = def.spriteFrame;
    this.x = x;
    this.y = y;
  }
}
