/**
 * The playable archetypes of 《零环》. Every name, epithet, description, skill and
 * stat block here is original to this project — it only evokes the *feel* of
 * traditional fantasy roles.
 */

/** Stable identifiers for the playable classes. */
export type ClassId =
  | 'ring-knight'
  | 'ash-medic'
  | 'rift-thief'
  | 'starsalt-mage'
  | 'bonebell-priest'
  | 'brokenblade-ranger'
  | 'ironfist-monk'
  | 'copperlamp-wanderer'
  | 'chainbreaker';

export interface ClassSkill {
  name: string;
  /** One-line description of the signature ability. */
  description: string;
}

export interface CharClass {
  id: ClassId;
  name: string;
  /** Short flavour epithet shown under the name (UI). */
  title: string;
  description: string;

  // Core attributes.
  hp: number;
  attack: number;
  defense: number;
  agility: number;
  magic: number;

  /** Item keys (see scripts/generate-assets.ts → items sheet) carried at start. */
  startingItems: string[];
  /** Signature ability. */
  skill: ClassSkill;

  /**
   * Stable hero-design key in heroes.png (see scripts/generate-assets.ts). The
   * actual frame index is resolved from the atlas at runtime, so it never breaks
   * when the per-hero frame count changes.
   */
  hero: string;
  /** Accent colour for UI highlighting. */
  color: number;
}

export const CLASSES: readonly CharClass[] = [
  {
    id: 'ring-knight',
    name: '环骑士',
    title: '执环的誓约者',
    description: '以环为誓的重甲战士，正面承受一切伤害，是最难被击倒的探索者。',
    hp: 34,
    attack: 6,
    defense: 8,
    agility: 3,
    magic: 1,
    startingItems: ['sword', 'shield', 'bread'],
    skill: {
      name: '环誓',
      description: '每次探索一次，受到致命伤害时不会倒下，并回复少许生命。',
    },
    hero: 'knight',
    color: 0x4a78b0,
  },
  {
    id: 'ash-medic',
    name: '灰烬医师',
    title: '灰中拾命',
    description: '游走于灰烬与药剂之间的医者，以毒攻毒，亦能在绝境中续命。',
    hp: 22,
    attack: 4,
    defense: 4,
    agility: 5,
    magic: 7,
    startingItems: ['dagger', 'potion_red', 'potion_green'],
    skill: {
      name: '灰烬调和',
      description: '饮用药剂时额外回复生命，并能净化中毒与衰弱。',
    },
    hero: 'alchemist',
    color: 0xa8744e,
  },
  {
    id: 'rift-thief',
    name: '裂隙盗',
    title: '行于缝隙',
    description: '惯于在空间的裂隙间潜行，身手敏捷，几乎无法被困住。',
    hp: 20,
    attack: 6,
    defense: 3,
    agility: 9,
    magic: 2,
    startingItems: ['dagger', 'key', 'coin_pile'],
    skill: {
      name: '裂隙穿行',
      description: '每层可侧身穿过一格墙壁一次，避开守卫与死路。',
    },
    hero: 'rogue',
    color: 0x7a5ad0,
  },
  {
    id: 'starsalt-mage',
    name: '星盐法师',
    title: '以盐为咒',
    description: '研习星辰与盐之奥义，咒力惊人，但体魄孱弱，需谨慎前行。',
    hp: 16,
    attack: 3,
    defense: 2,
    agility: 4,
    magic: 9,
    startingItems: ['staff', 'scroll', 'potion_blue'],
    skill: {
      name: '盐爆',
      description: '消耗法力，引爆星盐对周围一圈敌人造成法术伤害。',
    },
    hero: 'mage',
    color: 0x4ab0c8,
  },
  {
    id: 'bonebell-priest',
    name: '骨钟祭司',
    title: '司钟的送魂人',
    description: '敲响骨钟以安抚亡魂，对不死之物尤为克制，亦能庇护自身。',
    hp: 26,
    attack: 5,
    defense: 5,
    agility: 3,
    magic: 7,
    startingItems: ['staff', 'amulet', 'potion_green'],
    skill: {
      name: '钟鸣',
      description: '敲响骨钟，驱散并削弱周围的亡灵，短暂提升自身防御。',
    },
    hero: 'cleric',
    color: 0xc0a050,
  },
  {
    id: 'brokenblade-ranger',
    name: '碎刃游侠',
    title: '断刃不弃',
    description: '刀刃虽碎仍不弃战，远近皆宜，进退自如的野外行者。',
    hp: 24,
    attack: 7,
    defense: 4,
    agility: 7,
    magic: 2,
    startingItems: ['bow', 'dagger', 'apple'],
    skill: {
      name: '碎刃投掷',
      description: '掷出碎裂的刀片，对一名远处敌人造成额外伤害。',
    },
    hero: 'ranger',
    color: 0x4a9a5a,
  },
  {
    id: 'ironfist-monk',
    name: '铁拳僧',
    title: '拳即戒律',
    description: '不持兵刃，以拳为戒，连击之下势如奔雷，越战越勇。',
    hp: 28,
    attack: 8,
    defense: 5,
    agility: 6,
    magic: 3,
    startingItems: ['boots', 'bread', 'gem'],
    skill: {
      name: '连击',
      description: '连续命中同一目标后，下一击必定造成重击。',
    },
    hero: 'monk',
    color: 0xd07a30,
  },
  {
    id: 'copperlamp-wanderer',
    name: '铜灯旅人',
    title: '提灯夜行',
    description: '提一盏铜灯走遍环窟，见多识广，各项均衡，无所不通。',
    hp: 25,
    attack: 5,
    defense: 5,
    agility: 5,
    magic: 4,
    startingItems: ['dagger', 'coin', 'scroll'],
    skill: {
      name: '灯火',
      description: '点亮铜灯照亮四周，吓退潜伏的暗影并照见隐藏之物。',
    },
    hero: 'bard',
    color: 0xb87a3a,
  },
  {
    id: 'chainbreaker',
    name: '断链狂徒',
    title: '挣脱锁链者',
    description: '挣脱镣铐的亡命之徒，挥斧蛮战、悍不畏死，受创越重，怒火越盛。',
    hp: 32,
    attack: 9,
    defense: 2,
    agility: 4,
    magic: 1,
    startingItems: ['axe', 'meat', 'potion_red'],
    skill: {
      name: '狂怒',
      description: '生命越低，攻击越凶；濒死时爆发出骇人的蛮力。',
    },
    hero: 'barbarian',
    color: 0xc2502e,
  },
] as const;

/** Look up a class definition by id; falls back to the first archetype. */
export function getClass(id: ClassId): CharClass {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[0];
}
