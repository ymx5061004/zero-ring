/**
 * Original bestiary of 《零环》. Every name, stat and description is original to
 * this project. `spriteFrame` is the idle[0] frame index of the monster's sprite
 * design in monsters.png (see scripts/generate-assets.ts); the renderer resolves
 * its animations from that frame.
 */

import type { Resistances } from '../systems/StatusSystem';

export type AIType = 'melee' | 'ranged' | 'wander' | 'guard';

/** Lore tags used by class skills (e.g. 钟鸣 fears undead, 灯火 fears shadows). */
export type MonsterTag = 'undead' | 'shadow' | 'construct' | 'beast' | 'plant';

/** Behavioural / on-death traits driving differentiated AI (req. phase 6). */
export type MonsterTrait =
  | 'fleesWhenLowHp'
  | 'keepsDistance'
  | 'poisonAttack'
  | 'opensDoors'
  | 'phasesThroughWalls'
  | 'guardsTreasure'
  | 'stealsGold'
  | 'splitsOnDeath'
  | 'explodesOnDeath'
  | 'slowButStrong';

export interface MonsterDef {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  agility: number;
  exp: number;
  sightRange: number;
  aiType: AIType;
  spriteFrame: number;
  description: string;
  tags?: MonsterTag[];
  traits?: MonsterTrait[];
  resist?: Resistances;
  /** The final-floor boss has a one-time second phase below 50% HP. */
  boss?: boolean;
}

// Ordered roughly weakest → strongest; the dungeon draws a depth-scaled slice.
export const MONSTERS: readonly MonsterDef[] = [
  {
    id: 'lampmoth', name: '灯蛾尸', hp: 8, attack: 3, defense: 0, agility: 2,
    exp: 3, sightRange: 5, aiType: 'melee', spriteFrame: 5,
    tags: ['undead'], traits: ['explodesOnDeath'], resist: { poison: 0.5 },
    description: '被环光烧焦的飞蛾残骸，仍盲目地朝一切光亮扑去，死时迸发余烬。',
  },
  {
    id: 'bronzefang', name: '铜牙鼠', hp: 7, attack: 4, defense: 1, agility: 6,
    exp: 4, sightRange: 6, aiType: 'melee', spriteFrame: 10,
    tags: ['beast'], traits: ['stealsGold', 'fleesWhenLowHp'],
    description: '啃食铜器为生的窟鼠，会叼走金币，得手或负伤便仓皇逃窜。',
  },
  {
    id: 'saltshade', name: '盐井幽影', hp: 10, attack: 4, defense: 1, agility: 8,
    exp: 6, sightRange: 7, aiType: 'wander', spriteFrame: 30,
    tags: ['undead', 'shadow'], traits: ['phasesThroughWalls'], resist: { poison: 0.6 },
    description: '盐井深处凝结的幽影，可穿墙而行，飘忽难测。',
  },
  {
    id: 'mirrorbeetle', name: '镜壳虫', hp: 16, attack: 4, defense: 6, agility: 2,
    exp: 7, sightRange: 5, aiType: 'melee', spriteFrame: 50,
    tags: ['beast'], traits: ['slowButStrong'],
    description: '背甲如镜的巨虫，能弹开大半攻击，每隔一回合才动，却势大力沉。',
  },
  {
    // Was a mushroom-sprited "moss archer" — a fungus shooting from range read as
    // odd, so it is now a venom-spitting cave spider (spider sprite, frame 20),
    // for which keeping its distance and spitting venom is intuitive. Ranged +
    // poison behaviour is unchanged; id kept stable for saves.
    id: 'mossarcher', name: '吐丝毒蛛', hp: 11, attack: 6, defense: 2, agility: 5,
    exp: 8, sightRange: 8, aiType: 'ranged', spriteFrame: 20,
    tags: ['beast'], traits: ['keepsDistance', 'poisonAttack'], resist: { poison: 0.5 },
    description: '蛰伏窟壁的毒蛛，远远吐出黏稠毒丝，得手便迅速退开，与你保持距离。',
  },
  {
    id: 'bonehound', name: '裂骨犬', hp: 14, attack: 7, defense: 2, agility: 7,
    exp: 9, sightRange: 7, aiType: 'melee', spriteFrame: 15,
    tags: ['undead'], traits: ['fleesWhenLowHp', 'splitsOnDeath'], resist: { poison: 0.5 },
    description: '由碎骨拼成的猎犬，扑咬迅猛，碎裂时会再拼成两头更小的骨兽。',
  },
  {
    id: 'faceless', name: '无面巡逻者', hp: 18, attack: 6, defense: 4, agility: 5,
    exp: 11, sightRange: 8, aiType: 'melee', spriteFrame: 55,
    traits: ['opensDoors'],
    description: '披着旧斗篷的无面者，沿固定路线巡逻，会推开沿途的门。',
  },
  {
    id: 'whisperorb', name: '低语法球', hp: 13, attack: 8, defense: 2, agility: 4,
    exp: 12, sightRange: 9, aiType: 'ranged', spriteFrame: 35,
    tags: ['shadow'], traits: ['keepsDistance'], resist: { mind: 0.4 },
    description: '悬浮的独眼法球，以无声低语撕裂远处心神，始终与你拉开距离。',
  },
  {
    id: 'ironmask', name: '铁面傀儡', hp: 26, attack: 8, defense: 7, agility: 1,
    exp: 16, sightRange: 5, aiType: 'melee', spriteFrame: 25,
    tags: ['construct'], traits: ['slowButStrong', 'guardsTreasure'], resist: { mind: 0.8, poison: 0.5 },
    description: '戴着铁面的古老傀儡，迟缓而坚不可摧，常驻守宝藏，一击千钧。',
  },
  {
    id: 'ringwarden', name: '零环守卫', hp: 40, attack: 11, defense: 6, agility: 5,
    exp: 30, sightRange: 9, aiType: 'guard', spriteFrame: 45,
    tags: ['construct'], traits: ['guardsTreasure'], resist: { mind: 0.7, poison: 0.5 }, boss: true,
    description: '守护零环的远古造物，静伏于深处，唯有靠近才会苏醒。',
  },
];

const BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

export function getMonster(id: string): MonsterDef {
  return BY_ID.get(id) ?? MONSTERS[0];
}

/** Monster ids the dungeon may spawn at a given depth (deeper → tougher pool). */
export function spawnPool(depth: number): string[] {
  const size = Math.min(MONSTERS.length, 4 + depth);
  return MONSTERS.slice(0, size).map((m) => m.id);
}
