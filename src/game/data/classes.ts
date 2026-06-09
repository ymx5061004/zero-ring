/**
 * The playable archetypes of 《零环》. Every name, epithet, description, skill and
 * stat block here is original to this project — it only evokes the *feel* of
 * traditional fantasy roles.
 */

import type { Resistances } from '../systems/StatusSystem';

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

/** Passive skills hook into combat / turns; active skills are fired from a button. */
export type SkillKind = 'active' | 'passive';

export interface ClassSkill {
  name: string;
  /** One-line description of the signature ability. */
  description: string;
  kind: SkillKind;
  /** Mana spent each time an active skill fires. */
  manaCost?: number;
  /** Per-floor charge limit for an active skill (refreshes each descent). */
  usesPerFloor?: number;
  /** The active skill asks the player to pick a direction first. */
  needsDirection?: boolean;
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
  /** Max mana — fuels active skills and ranged spells (0 = mundane class). */
  mana: number;
  /** Innate damage-channel resistances. */
  resist?: Resistances;

  /** Item ids (see src/game/data/items.ts) carried at start of a new run. */
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
    mana: 0,
    startingItems: ['ringsteel_sword', 'guard_shield', 'bread'],
    skill: {
      name: '环誓',
      description: '每层一次，受到致命伤害时不会倒下并回血，但随后三回合陷入易伤。',
      kind: 'passive',
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
    mana: 10,
    resist: { poison: 0.5 },
    startingItems: ['rusty_dagger', 'heal_potion', 'moss_potion'],
    skill: {
      name: '灰烬急救',
      description: '消耗法力施行急救，回复生命并净化中毒、灼烧与衰弱。',
      kind: 'active',
      manaCost: 4,
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
    mana: 0,
    startingItems: ['rusty_dagger', 'swift_boots', 'coin_pile'],
    skill: {
      name: '裂隙穿行',
      description: '每层数次，朝选定方向侧身穿过一格墙壁，避开守卫与死路。',
      kind: 'active',
      usesPerFloor: 3,
      needsDirection: true,
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
    mana: 16,
    resist: { fire: 0.25, ice: 0.25 },
    startingItems: ['starsalt_staff', 'azure_potion', 'light_scroll'],
    skill: {
      name: '盐爆',
      description: '消耗法力引爆星盐，对周身一圈敌人造成法术伤害并令其迟缓。',
      kind: 'active',
      manaCost: 6,
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
    mana: 12,
    resist: { mind: 0.4 },
    startingItems: ['whisper_wand', 'amulet_ward', 'moss_potion'],
    skill: {
      name: '钟鸣',
      description: '消耗法力敲响骨钟：令亡灵恐惧，使其余敌人迟缓。',
      kind: 'active',
      manaCost: 5,
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
    mana: 0,
    startingItems: ['hunter_bow', 'rusty_dagger', 'cave_fruit'],
    skill: {
      name: '碎刃投掷',
      description: '每层数次，朝选定方向掷出碎刃，命中直线上第一名敌人造成重创。',
      kind: 'active',
      usesPerFloor: 4,
      needsDirection: true,
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
    mana: 0,
    startingItems: ['swift_boots', 'jerky', 'ring_might'],
    skill: {
      name: '连击',
      description: '连续命中同一目标层层叠加连击，伤害随之攀升，转换目标则归零。',
      kind: 'passive',
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
    mana: 0,
    startingItems: ['rusty_dagger', 'light_scroll', 'coin'],
    skill: {
      name: '灯火',
      description: '每层数次点亮铜灯，照亮四周并照见大范围内的隐藏陷阱与暗门。',
      kind: 'active',
      usesPerFloor: 3,
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
    mana: 0,
    startingItems: ['riftstone_axe', 'jerky', 'heal_potion'],
    skill: {
      name: '狂怒',
      description: '生命越低近战越凶；半血以下伤害大增，濒死时爆发骇人的蛮力。',
      kind: 'passive',
    },
    hero: 'barbarian',
    color: 0xc2502e,
  },
] as const;

/** Look up a class definition by id; falls back to the first archetype. */
export function getClass(id: ClassId): CharClass {
  return CLASSES.find((c) => c.id === id) ?? CLASSES[0];
}
