/**
 * Original bestiary of 《零环》. Every name, stat and description is original to
 * this project. `spriteFrame` is the idle[0] frame index of the monster's sprite
 * design in monsters.png (see scripts/generate-assets.ts); the renderer resolves
 * its animations from that frame.
 */

export type AIType = 'melee' | 'ranged' | 'wander' | 'guard';

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
}

// Ordered roughly weakest → strongest; the dungeon draws a depth-scaled slice.
export const MONSTERS: readonly MonsterDef[] = [
  {
    id: 'lampmoth', name: '灯蛾尸', hp: 8, attack: 3, defense: 0, agility: 2,
    exp: 3, sightRange: 5, aiType: 'melee', spriteFrame: 5,
    description: '被环光烧焦的飞蛾残骸，仍盲目地朝一切光亮扑去。',
  },
  {
    id: 'bronzefang', name: '铜牙鼠', hp: 7, attack: 4, defense: 1, agility: 6,
    exp: 4, sightRange: 6, aiType: 'melee', spriteFrame: 10,
    description: '啃食铜器为生的窟鼠，牙齿泛着绿锈，咬合极快。',
  },
  {
    id: 'saltshade', name: '盐井幽影', hp: 10, attack: 4, defense: 1, agility: 8,
    exp: 6, sightRange: 7, aiType: 'wander', spriteFrame: 30,
    description: '盐井深处凝结的幽影，飘忽不定，极难被命中。',
  },
  {
    id: 'mirrorbeetle', name: '镜壳虫', hp: 16, attack: 4, defense: 6, agility: 2,
    exp: 7, sightRange: 5, aiType: 'melee', spriteFrame: 50,
    description: '背甲如镜的巨虫，能弹开大半攻击，行动却迟缓。',
  },
  {
    id: 'mossarcher', name: '苔藓弓手', hp: 11, attack: 6, defense: 2, agility: 5,
    exp: 8, sightRange: 8, aiType: 'ranged', spriteFrame: 40,
    description: '被苔藓寄生的猎手，以孢子为箭，远远便能袭来。',
  },
  {
    id: 'bonehound', name: '裂骨犬', hp: 14, attack: 7, defense: 2, agility: 7,
    exp: 9, sightRange: 7, aiType: 'melee', spriteFrame: 15,
    description: '由碎骨拼成的猎犬，扑咬迅猛，专攻落单者。',
  },
  {
    id: 'faceless', name: '无面巡逻者', hp: 18, attack: 6, defense: 4, agility: 5,
    exp: 11, sightRange: 8, aiType: 'melee', spriteFrame: 55,
    description: '披着旧斗篷的无面者，永远沿着同一条路反复巡逻。',
  },
  {
    id: 'whisperorb', name: '低语法球', hp: 13, attack: 8, defense: 2, agility: 4,
    exp: 12, sightRange: 9, aiType: 'ranged', spriteFrame: 35,
    description: '悬浮的独眼法球，以无声的低语撕裂远处的心神。',
  },
  {
    id: 'ironmask', name: '铁面傀儡', hp: 26, attack: 8, defense: 7, agility: 1,
    exp: 16, sightRange: 5, aiType: 'melee', spriteFrame: 25,
    description: '戴着铁面的古老傀儡，迟缓而坚不可摧，一击千钧。',
  },
  {
    id: 'ringwarden', name: '零环守卫', hp: 40, attack: 11, defense: 6, agility: 5,
    exp: 30, sightRange: 9, aiType: 'guard', spriteFrame: 45,
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
