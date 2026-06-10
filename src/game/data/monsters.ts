/**
 * Original bestiary of 《零环》. Every name, stat and description is original to
 * this project. `spriteFrame` is the idle[0] frame index of the monster's sprite
 * design in monsters.png (see scripts/generate-assets.ts); the renderer resolves
 * its animations from that frame.
 */

import type { Resistances, StatusType } from '../systems/StatusSystem';

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
  /** A status this monster inflicts on a successful hit (0.3.1 — status-attacker variety). */
  onHit?: { status: StatusType; turns: number; power: number; chance?: number };
  /** Earliest floor this monster may spawn on (0.3.1; default 1). Drives spawnPool. */
  minDepth?: number;
  /** The final-floor boss has a one-time second phase below 50% HP. */
  boss?: boolean;
}

// Each carries a `minDepth` (the floor it starts appearing on); spawnPool draws every
// non-boss monster whose minDepth ≤ the current depth. Only gold-thieves keep
// `fleesWhenLowHp` — every other aggressor commits to the fight (0.3.1).
export const MONSTERS: readonly MonsterDef[] = [
  // --- floor 1 pool ---------------------------------------------------
  {
    id: 'lampmoth', name: '灯蛾尸', hp: 8, attack: 3, defense: 0, agility: 2,
    exp: 3, sightRange: 5, aiType: 'melee', spriteFrame: 5, minDepth: 1,
    tags: ['undead'], traits: ['explodesOnDeath'], resist: { poison: 0.5 },
    description: '被环光烧焦的飞蛾残骸，仍盲目地朝一切光亮扑去，死时迸发余烬。',
  },
  {
    id: 'bronzefang', name: '铜牙鼠', hp: 7, attack: 4, defense: 1, agility: 6,
    exp: 4, sightRange: 6, aiType: 'melee', spriteFrame: 10, minDepth: 1,
    tags: ['beast'], traits: ['stealsGold', 'fleesWhenLowHp'],
    description: '啃食铜器为生的窟鼠，会叼走金币，得手或负伤便仓皇逃窜。',
  },
  {
    id: 'saltshade', name: '盐井幽影', hp: 10, attack: 4, defense: 1, agility: 8,
    exp: 6, sightRange: 7, aiType: 'wander', spriteFrame: 30, minDepth: 1,
    tags: ['undead', 'shadow'], traits: ['phasesThroughWalls'], resist: { poison: 0.6 },
    description: '盐井深处凝结的幽影，可穿墙而行，飘忽难测。',
  },
  {
    id: 'mirrorbeetle', name: '镜壳虫', hp: 16, attack: 4, defense: 6, agility: 2,
    exp: 7, sightRange: 5, aiType: 'melee', spriteFrame: 50, minDepth: 1,
    tags: ['beast'], traits: ['slowButStrong'],
    description: '背甲如镜的巨虫，能弹开大半攻击，每隔一回合才动，却势大力沉。',
  },
  {
    id: 'mossarcher', name: '吐丝毒蛛', hp: 11, attack: 6, defense: 2, agility: 5,
    exp: 8, sightRange: 8, aiType: 'ranged', spriteFrame: 20, minDepth: 1,
    tags: ['beast'], traits: ['keepsDistance', 'poisonAttack'], resist: { poison: 0.5 },
    description: '蛰伏窟壁的毒蛛，远远吐出黏稠毒丝，得手便迅速退开，与你保持距离。',
  },
  {
    id: 'cavejackal', name: '环窟豺', hp: 10, attack: 5, defense: 1, agility: 7,
    exp: 5, sightRange: 7, aiType: 'melee', spriteFrame: 10, minDepth: 1,
    tags: ['beast'],
    description: '成群游猎的瘦豺，一旦盯上猎物便死咬不放，绝不回头。',
  },
  {
    id: 'shriekbat', name: '尖啸蝠', hp: 6, attack: 3, defense: 0, agility: 9,
    exp: 5, sightRange: 7, aiType: 'melee', spriteFrame: 5, minDepth: 1,
    tags: ['beast'], onHit: { status: 'feared', turns: 2, power: 1, chance: 0.3 },
    description: '振翅如刃的窟蝠，俯冲时发出令人胆寒的尖啸。',
  },
  // --- floor 2+ -------------------------------------------------------
  {
    id: 'bonehound', name: '裂骨犬', hp: 14, attack: 7, defense: 2, agility: 7,
    exp: 9, sightRange: 7, aiType: 'melee', spriteFrame: 15, minDepth: 2,
    tags: ['undead'], traits: ['splitsOnDeath'], resist: { poison: 0.5 },
    description: '由碎骨拼成的猎犬，扑咬迅猛，碎裂时会再拼成两头更小的骨兽。',
  },
  {
    id: 'frostslug', name: '霜噬蛞蝓', hp: 15, attack: 5, defense: 3, agility: 1,
    exp: 8, sightRange: 5, aiType: 'melee', spriteFrame: 0, minDepth: 2,
    tags: ['beast'], traits: ['slowButStrong'], onHit: { status: 'frozen', turns: 1, power: 1, chance: 0.3 },
    resist: { ice: 0.6 },
    description: '通体覆霜的巨蛞蝓，爬过之处结冰，触之刺骨。',
  },
  {
    id: 'miasmacap', name: '迷瘴菌伞', hp: 13, attack: 4, defense: 2, agility: 3,
    exp: 8, sightRange: 5, aiType: 'wander', spriteFrame: 40, minDepth: 2,
    tags: ['plant'], onHit: { status: 'confused', turns: 2, power: 1, chance: 0.4 }, resist: { poison: 0.5 },
    description: '菌盖喷吐致幻孢子的行走菌伞，靠近便令人神思恍惚。',
  },
  {
    id: 'snarevine', name: '缚根藤怪', hp: 18, attack: 5, defense: 3, agility: 2,
    exp: 9, sightRange: 6, aiType: 'melee', spriteFrame: 20, minDepth: 2,
    tags: ['plant'], onHit: { status: 'slowed', turns: 2, power: 1, chance: 0.45 },
    description: '盘踞通道的藤蔓活物，根须如鞭，缠住猎物的脚步。',
  },
  // --- floor 3+ -------------------------------------------------------
  {
    id: 'faceless', name: '无面巡逻者', hp: 18, attack: 6, defense: 4, agility: 5,
    exp: 11, sightRange: 8, aiType: 'melee', spriteFrame: 55, minDepth: 3,
    traits: ['opensDoors'],
    description: '披着旧斗篷的无面者，沿固定路线巡逻，会推开沿途的门。',
  },
  {
    id: 'moltenlizard', name: '熔皮蜥', hp: 17, attack: 6, defense: 3, agility: 5,
    exp: 11, sightRange: 6, aiType: 'melee', spriteFrame: 45, minDepth: 3,
    tags: ['beast'], onHit: { status: 'burning', turns: 3, power: 2, chance: 0.4 }, resist: { fire: 0.6 },
    description: '鳞下流淌岩浆的窟蜥，撕咬带火，灼人皮肉。',
  },
  {
    id: 'rustbeetle', name: '锈蚀甲虫', hp: 20, attack: 5, defense: 4, agility: 3,
    exp: 12, sightRange: 5, aiType: 'melee', spriteFrame: 50, minDepth: 3,
    tags: ['beast'], onHit: { status: 'vulnerable', turns: 2, power: 1, chance: 0.45 },
    description: '分泌酸液的甲虫，啃咬腐蚀护甲，令伤口更易撕裂。',
  },
  {
    id: 'voideye', name: '虚空独眼', hp: 15, attack: 7, defense: 2, agility: 4,
    exp: 13, sightRange: 9, aiType: 'ranged', spriteFrame: 35, minDepth: 3,
    tags: ['shadow'], traits: ['keepsDistance'], onHit: { status: 'confused', turns: 2, power: 1, chance: 0.35 },
    resist: { mind: 0.5 },
    description: '悬于暗处的独眼，凝视之间将混乱灌入心神，并与你保持距离。',
  },
  // --- floor 4+ -------------------------------------------------------
  {
    id: 'whisperorb', name: '低语法球', hp: 13, attack: 8, defense: 2, agility: 4,
    exp: 12, sightRange: 9, aiType: 'ranged', spriteFrame: 35, minDepth: 4,
    tags: ['shadow'], traits: ['keepsDistance'], resist: { mind: 0.4 },
    description: '悬浮的独眼法球，以无声低语撕裂远处心神，始终与你拉开距离。',
  },
  {
    id: 'saltcolossus', name: '盐晶巨像', hp: 32, attack: 9, defense: 6, agility: 1,
    exp: 18, sightRange: 5, aiType: 'melee', spriteFrame: 25, minDepth: 4,
    tags: ['construct'], traits: ['slowButStrong'], resist: { mind: 0.6, poison: 0.5 },
    description: '盐晶凝成的沉重巨像，步伐迟缓却一击碎骨，悍然直进。',
  },
  {
    id: 'gloomwraith', name: '噬魂游影', hp: 20, attack: 7, defense: 3, agility: 7,
    exp: 16, sightRange: 8, aiType: 'wander', spriteFrame: 55, minDepth: 4,
    tags: ['undead', 'shadow'], traits: ['phasesThroughWalls'], onHit: { status: 'feared', turns: 2, power: 1, chance: 0.3 },
    resist: { poison: 0.5, mind: 0.5 },
    description: '穿墙游弋的怨影，掠过时低语夺人胆魄。',
  },
  // --- floor 5 --------------------------------------------------------
  {
    id: 'ironmask', name: '铁面傀儡', hp: 26, attack: 8, defense: 7, agility: 1,
    exp: 16, sightRange: 5, aiType: 'melee', spriteFrame: 25, minDepth: 5,
    tags: ['construct'], traits: ['slowButStrong', 'guardsTreasure'], resist: { mind: 0.8, poison: 0.5 },
    description: '戴着铁面的古老傀儡，迟缓而坚不可摧，常驻守宝藏，一击千钧。',
  },
  {
    id: 'ringwarden', name: '零环守卫', hp: 40, attack: 11, defense: 6, agility: 5,
    exp: 30, sightRange: 9, aiType: 'guard', spriteFrame: 45, minDepth: 5,
    tags: ['construct'], traits: ['guardsTreasure'], resist: { mind: 0.7, poison: 0.5 }, boss: true,
    description: '守护零环的远古造物，静伏于深处，唯有靠近才会苏醒。',
  },
];

const BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

export function getMonster(id: string): MonsterDef {
  return BY_ID.get(id) ?? MONSTERS[0];
}

/** Monster ids the dungeon may spawn at a given depth: every non-boss whose minDepth ≤ depth. */
export function spawnPool(depth: number): string[] {
  return MONSTERS.filter((m) => !m.boss && (m.minDepth ?? 1) <= depth).map((m) => m.id);
}

const TRAIT_LORE: Record<MonsterTrait, string> = {
  fleesWhenLowHp: '残血逃窜',
  keepsDistance: '拉开距离',
  poisonAttack: '毒袭',
  opensDoors: '会开门',
  phasesThroughWalls: '穿墙',
  guardsTreasure: '守宝',
  stealsGold: '偷金',
  splitsOnDeath: '死亡分裂',
  explodesOnDeath: '死亡爆裂',
  slowButStrong: '迟缓重击',
};
const RESIST_LORE: Record<string, string> = { poison: '抗毒', fire: '抗火', ice: '抗冰', mind: '抗心', physical: '抗击' };
const ONHIT_LORE: Partial<Record<StatusType, string>> = {
  frozen: '冰击', confused: '惑击', feared: '啸击', burning: '灼击', slowed: '缚击', vulnerable: '蚀击', poisoned: '毒击',
};

/**
 * A short 图鉴 hint built from a monster's traits + notable resistances + on-hit
 * status (phase 9 / 0.3.1). Shown when inspecting a kind already defeated once.
 */
export function monsterLore(def: MonsterDef): string {
  const bits: string[] = [];
  for (const t of def.traits ?? []) if (TRAIT_LORE[t]) bits.push(TRAIT_LORE[t]);
  if (def.onHit && ONHIT_LORE[def.onHit.status]) bits.push(ONHIT_LORE[def.onHit.status]!);
  for (const [k, v] of Object.entries(def.resist ?? {})) if ((v ?? 0) >= 0.5 && RESIST_LORE[k]) bits.push(RESIST_LORE[k]);
  return bits.length ? bits.join('·') : '无显著特性';
}
