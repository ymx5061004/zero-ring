/**
 * Original item catalogue for 《零环》. Every id/name/description/value is original.
 * `spriteFrame` indexes the generated items.png sheet (see scripts/generate-assets.ts):
 *   0 sword · 1 axe · 2 dagger · 3 bow · 4 staff · 5 wand · 6 shield · 7 helmet
 *   8 armor · 9 boots · 10 potion_red · 11 potion_blue · 12 potion_green
 *   13 scroll · 14 spellbook · 15 coin · 16 coin_pile · 17 bread · 18 meat
 *   19 apple · 20 ring · 21 amulet · 22 gem · 23 key · 24 pauldrons · 25 belt · 26 gloves
 */

export type ItemType = 'weapon' | 'armor' | 'potion' | 'scroll' | 'food' | 'ring' | 'gold';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type ScrollAction = 'reveal' | 'smite' | 'blink' | 'vigor' | 'identify' | 'uncurse';

/**
 * The paper-doll slot a piece of gear occupies (0.2). 'ring' fits either of the
 * two ring slots. Decoupled from {@link ItemType} so several "armor" pieces can
 * occupy distinct slots (head / shoulders / body / belt / gloves / feet / offhand).
 */
export type GearSlot =
  | 'mainhand'
  | 'offhand'
  | 'head'
  | 'shoulders'
  | 'body'
  | 'belt'
  | 'gloves'
  | 'feet'
  | 'amulet'
  | 'ring';

export interface ItemEffects {
  /** Stat bonuses applied while the item is equipped (weapon / armor / ring). */
  equip?: { attack?: number; defense?: number; agility?: number; magic?: number; maxHp?: number };
  /** Instant HP restored on use (potion / food). */
  heal?: number;
  /** Permanent boost on use (rare consumables). */
  boost?: { maxHp?: number; attack?: number; defense?: number };
  /** Scroll action resolved by the scene. */
  scroll?: ScrollAction;
  /** Coins granted (gold type). */
  gold?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  description: string;
  rarity: Rarity;
  spriteFrame: number;
  effects: ItemEffects;
  /** Which paper-doll slot this gear occupies (0.2); absent for consumables / gold. */
  gearSlot?: GearSlot;
  /** A ranged weapon can strike at a distance with line of sight (0.2). */
  ranged?: boolean;
  /** Maximum range (tiles) for a ranged weapon. */
  range?: number;
}

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x9a978d,
  uncommon: 0x5fa06e,
  rare: 0x5f86a0,
  epic: 0xb07ad0,
};

export const RARITY_NAME: Record<Rarity, string> = {
  common: '普通',
  uncommon: '精良',
  rare: '稀有',
  epic: '史诗',
};

export const TYPE_NAME: Record<ItemType, string> = {
  weapon: '武器',
  armor: '防具',
  potion: '药剂',
  scroll: '卷轴',
  food: '食物',
  ring: '饰品',
  gold: '金币',
};

/** Base gold value by rarity; the merchant scales it with depth. */
const RARITY_PRICE: Record<Rarity, number> = { common: 10, uncommon: 26, rare: 60, epic: 130 };

/** What the merchant charges for an item at a given depth (consumables are cheaper). */
export function itemPrice(def: ItemDef, depth: number): number {
  const consumable = def.type === 'potion' || def.type === 'scroll' || def.type === 'food';
  const base = RARITY_PRICE[def.rarity] * (consumable ? 0.7 : 1);
  return Math.max(3, Math.round(base * (1 + depth * 0.12)));
}

/** A named random modifier that gear can roll, granting equip-stat bonuses (0.3). */
export type StatKey = 'attack' | 'defense' | 'agility' | 'magic' | 'maxHp';

export interface Affix {
  key: string;
  /** Short fragment shown before the item name (e.g. 锋锐). */
  name: string;
  bonus: Partial<Record<StatKey, number>>;
  /** Gear types this affix may roll on. */
  on: ItemType[];
}

export const AFFIXES: readonly Affix[] = [
  { key: 'keen', name: '锋锐', bonus: { attack: 2 }, on: ['weapon'] },
  { key: 'mighty', name: '巨力', bonus: { attack: 3 }, on: ['weapon'] },
  { key: 'bloodthirsty', name: '嗜血', bonus: { attack: 1, maxHp: 3 }, on: ['weapon'] },
  { key: 'swift', name: '迅捷', bonus: { agility: 2 }, on: ['weapon', 'ring'] },
  { key: 'starlit', name: '星辉', bonus: { magic: 3 }, on: ['weapon', 'ring'] },
  { key: 'deft', name: '灵巧', bonus: { agility: 1, attack: 1 }, on: ['weapon', 'ring'] },
  { key: 'bulwark', name: '坚壁', bonus: { defense: 2 }, on: ['armor'] },
  { key: 'heavy', name: '厚重', bonus: { defense: 1, maxHp: 5 }, on: ['armor'] },
  { key: 'guardian', name: '守护', bonus: { defense: 3 }, on: ['armor'] },
  { key: 'nimble', name: '轻灵', bonus: { agility: 2 }, on: ['armor'] },
  { key: 'hale', name: '强健', bonus: { maxHp: 8 }, on: ['weapon', 'armor', 'ring'] },
  { key: 'sage', name: '贤者', bonus: { magic: 2, maxHp: 3 }, on: ['weapon', 'ring'] },
];

const AFFIX_BY_KEY = new Map(AFFIXES.map((a) => [a.key, a]));
export function getAffix(key: string): Affix | undefined {
  return AFFIX_BY_KEY.get(key);
}

export const STAT_LABEL_CN: Record<StatKey, string> = {
  attack: '攻击',
  defense: '防御',
  agility: '敏捷',
  magic: '法术',
  maxHp: '生命',
};

export const ITEMS: readonly ItemDef[] = [
  // --- weapons (mainhand) ---------------------------------------------
  { id: 'rusty_dagger', name: '锈蚀匕首', type: 'weapon', gearSlot: 'mainhand', rarity: 'common', spriteFrame: 2, description: '一柄布满锈斑的旧匕首，轻巧而不起眼。', effects: { equip: { attack: 2, agility: 1 } } },
  { id: 'ringsteel_sword', name: '环钢长剑', type: 'weapon', gearSlot: 'mainhand', rarity: 'uncommon', spriteFrame: 0, description: '以环钢锻成的长剑，剑身泛着冷冽的微光。', effects: { equip: { attack: 4 } } },
  { id: 'riftstone_axe', name: '裂石战斧', type: 'weapon', gearSlot: 'mainhand', rarity: 'uncommon', spriteFrame: 1, description: '沉重的战斧，挥动迟缓，却能劈开顽石。', effects: { equip: { attack: 5, agility: -1 } } },
  { id: 'hunter_bow', name: '猎手短弓', type: 'weapon', gearSlot: 'mainhand', rarity: 'uncommon', spriteFrame: 3, description: '猎手惯用的短弓，出手轻快利落，可远程射击。', effects: { equip: { attack: 3, agility: 2 } }, ranged: true, range: 5 },
  { id: 'starsalt_staff', name: '星盐法杖', type: 'weapon', gearSlot: 'mainhand', rarity: 'rare', spriteFrame: 4, description: '杖首凝着一粒星盐，引动咒力，可远程激发盐弹。', effects: { equip: { attack: 3, magic: 3 } }, ranged: true, range: 4 },
  { id: 'whisper_wand', name: '低语魔杖', type: 'weapon', gearSlot: 'mainhand', rarity: 'rare', spriteFrame: 5, description: '凑近能听见细微低语的魔杖，可远程放出低语。', effects: { equip: { attack: 2, magic: 4 } }, ranged: true, range: 4 },

  // --- armor (head / shoulders / body / belt / gloves / feet / offhand) -
  { id: 'leather_armor', name: '旅人皮甲', type: 'armor', gearSlot: 'body', rarity: 'common', spriteFrame: 8, description: '常见的硬化皮甲，聊胜于无。', effects: { equip: { defense: 2 } } },
  { id: 'guard_shield', name: '守誓圆盾', type: 'armor', gearSlot: 'offhand', rarity: 'uncommon', spriteFrame: 6, description: '边缘磨损的圆盾，挡下过无数次袭击。', effects: { equip: { defense: 3 } } },
  { id: 'iron_helm', name: '铁面盔', type: 'armor', gearSlot: 'head', rarity: 'uncommon', spriteFrame: 7, description: '厚重的铁盔，护住要害。', effects: { equip: { defense: 2, maxHp: 3 } } },
  { id: 'swift_boots', name: '疾行皮靴', type: 'armor', gearSlot: 'feet', rarity: 'uncommon', spriteFrame: 9, description: '轻便的皮靴，让脚步更为迅捷。', effects: { equip: { defense: 1, agility: 3 } } },
  { id: 'ring_plate', name: '环纹胸甲', type: 'armor', gearSlot: 'body', rarity: 'rare', spriteFrame: 8, description: '錾刻环纹的胸甲，坚固而沉静。', effects: { equip: { defense: 5, maxHp: 5 } } },
  { id: 'oak_pauldrons', name: '橡纹护肩', type: 'armor', gearSlot: 'shoulders', rarity: 'common', spriteFrame: 24, description: '包着橡木衬里的护肩，挡风遮雨。', effects: { equip: { defense: 1 } } },
  { id: 'ringmail_pauldrons', name: '环甲护肩', type: 'armor', gearSlot: 'shoulders', rarity: 'uncommon', spriteFrame: 24, description: '缀着环甲的护肩，分担来袭之力。', effects: { equip: { defense: 2, maxHp: 2 } } },
  { id: 'hide_belt', name: '硬革腰带', type: 'armor', gearSlot: 'belt', rarity: 'common', spriteFrame: 25, description: '一条结实的硬革腰带。', effects: { equip: { defense: 1 } } },
  { id: 'vigor_belt', name: '强韧腰带', type: 'armor', gearSlot: 'belt', rarity: 'uncommon', spriteFrame: 25, description: '束紧时令人精神一振的腰带。', effects: { equip: { maxHp: 6 } } },
  { id: 'worn_gloves', name: '旧皮手套', type: 'armor', gearSlot: 'gloves', rarity: 'common', spriteFrame: 26, description: '磨得发亮的旧皮手套。', effects: { equip: { agility: 1 } } },
  { id: 'gripfast_gloves', name: '巧匠手套', type: 'armor', gearSlot: 'gloves', rarity: 'uncommon', spriteFrame: 26, description: '贴合手形的巧匠手套，握持更稳。', effects: { equip: { attack: 1, agility: 2 } } },

  // --- potions ---------------------------------------------------------
  { id: 'heal_potion', name: '治愈药剂', type: 'potion', rarity: 'common', spriteFrame: 10, description: '常见的红色药剂，饮下可愈合伤口。', effects: { heal: 14 } },
  { id: 'azure_potion', name: '碧泉药剂', type: 'potion', rarity: 'uncommon', spriteFrame: 11, description: '清冽的蓝色药剂，疗效更佳。', effects: { heal: 22 } },
  { id: 'moss_potion', name: '翠藓药剂', type: 'potion', rarity: 'common', spriteFrame: 12, description: '苦涩的绿色药剂，缓缓回血。', effects: { heal: 9 } },
  { id: 'vigor_potion', name: '强健药剂', type: 'potion', rarity: 'rare', spriteFrame: 11, description: '罕见的灵药，永久强健体魄并回满生命。', effects: { heal: 999, boost: { maxHp: 6 } } },

  // --- scrolls ---------------------------------------------------------
  { id: 'light_scroll', name: '照明卷轴', type: 'scroll', rarity: 'common', spriteFrame: 13, description: '诵读后照亮整层环窟。', effects: { scroll: 'reveal' } },
  { id: 'smite_scroll', name: '灼击卷轴', type: 'scroll', rarity: 'uncommon', spriteFrame: 13, description: '降下灼光，灼伤视野内的所有敌人。', effects: { scroll: 'smite' } },
  { id: 'blink_scroll', name: '闪步卷轴', type: 'scroll', rarity: 'uncommon', spriteFrame: 13, description: '瞬间挪移到附近，脱离险境。', effects: { scroll: 'blink' } },
  { id: 'tome_vigor', name: '秘典残页', type: 'scroll', rarity: 'rare', spriteFrame: 14, description: '残破的秘典，诵读可回满生命。', effects: { scroll: 'vigor' } },
  { id: 'discern_scroll', name: '鉴物卷轴', type: 'scroll', rarity: 'uncommon', spriteFrame: 13, description: '诵读后看清随身所有物品的真名与祝咒。', effects: { scroll: 'identify' } },
  { id: 'unbind_scroll', name: '解缚卷轴', type: 'scroll', rarity: 'uncommon', spriteFrame: 13, description: '诵读后解除身上装备的诅咒，使其得以卸下。', effects: { scroll: 'uncurse' } },

  // --- food ------------------------------------------------------------
  { id: 'bread', name: '干面包', type: 'food', rarity: 'common', spriteFrame: 17, description: '硬邦邦的干面包，垫垫肚子。', effects: { heal: 5 } },
  { id: 'jerky', name: '风干肉', type: 'food', rarity: 'common', spriteFrame: 18, description: '耐放的风干肉，恢复些许体力。', effects: { heal: 9 } },
  { id: 'cave_fruit', name: '环窟果', type: 'food', rarity: 'common', spriteFrame: 19, description: '在阴湿处生长的野果，微微回血。', effects: { heal: 4 } },

  // --- rings / accessories (ring ×2 / amulet) -------------------------
  { id: 'ring_might', name: '蛮力指环', type: 'ring', gearSlot: 'ring', rarity: 'uncommon', spriteFrame: 20, description: '佩戴后臂力倍增。', effects: { equip: { attack: 2 } } },
  { id: 'ring_ward', name: '守护指环', type: 'ring', gearSlot: 'ring', rarity: 'uncommon', spriteFrame: 20, description: '泛着微光的指环，护佑佩戴者。', effects: { equip: { defense: 2 } } },
  { id: 'ring_swift', name: '疾风指环', type: 'ring', gearSlot: 'ring', rarity: 'uncommon', spriteFrame: 20, description: '佩戴后身形如风。', effects: { equip: { agility: 3 } } },
  { id: 'amulet_ward', name: '环力护符', type: 'ring', gearSlot: 'amulet', rarity: 'rare', spriteFrame: 21, description: '蕴含环力的护符，强化心神与体魄。', effects: { equip: { magic: 3, maxHp: 5 } } },
  { id: 'vitality_gem', name: '生命宝石', type: 'ring', gearSlot: 'amulet', rarity: 'rare', spriteFrame: 22, description: '温热的宝石，显著增益生命上限。', effects: { equip: { maxHp: 10 } } },

  // --- gold ------------------------------------------------------------
  { id: 'coin', name: '金币', type: 'gold', rarity: 'common', spriteFrame: 15, description: '一枚环窟通用的金币。', effects: { gold: 8 } },
  { id: 'coin_pile', name: '钱袋', type: 'gold', rarity: 'uncommon', spriteFrame: 16, description: '鼓鼓的一袋金币。', effects: { gold: 22 } },
];

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

export function getItem(id: string): ItemDef {
  return BY_ID.get(id) ?? ITEMS[0];
}

/** The paper-doll slot a piece of gear occupies, or null for consumables / gold. */
export function equipSlotOf(def: ItemDef): GearSlot | null {
  return def.gearSlot ?? null;
}

export const ALL_ITEM_IDS = ITEMS.map((it) => it.id);
