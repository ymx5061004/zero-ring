import type { RNG } from '../core/RNG';
import { AFFIXES, getAffix, getItem, ITEMS, type ItemDef, type ItemType, type StatKey } from '../data/items';

/**
 * Item *instances* (0.2, req. phase 4). The static {@link ItemDef} describes a
 * kind of item; an ItemInstance is one concrete copy carried in the world, with
 * its own identification, blessing/curse (beatitude), enchantment and stack size.
 * Every alias name generated below is original to 《零环》.
 */

export type Beatitude = 'blessed' | 'uncursed' | 'cursed';

export interface ItemInstance {
  /** Unique within a run (used for selection / save round-trips). */
  uid: number;
  defId: string;
  quantity: number;
  /** Gear: beatitude is known. Potions/scrolls use the run Identifier instead. */
  identified: boolean;
  beatitude: Beatitude;
  /** +N / −N applied to a weapon's attack or armour's defence. */
  enchantment: number;
  /** Rolled affix keys (gear only) granting extra equip-stat bonuses (0.3). */
  affixes?: string[];
  /** Optional limited uses (wands/charged items). */
  charges?: number;
}

/** Serialized form persisted in the save (compact, stable). */
export interface SerializedInstance {
  uid: number;
  defId: string;
  quantity: number;
  identified: boolean;
  beatitude: Beatitude;
  enchantment: number;
  affixes?: string[];
  charges?: number;
}

const GEAR: ItemType[] = ['weapon', 'armor', 'ring'];
export function isGear(type: ItemType): boolean {
  return GEAR.includes(type);
}
export function isConsumable(type: ItemType): boolean {
  return type === 'potion' || type === 'scroll' || type === 'food';
}

let uidCounter = 1;
/** After loading a save, keep new uids above everything already in play. */
export function bumpUid(above: number): void {
  if (above >= uidCounter) uidCounter = above + 1;
}
function nextUid(): number {
  return uidCounter++;
}

/** A plain, known, unenchanted copy (starting kit, fixed drops, shop wares). */
export function plainInstance(defId: string, quantity = 1): ItemInstance {
  return { uid: nextUid(), defId, quantity, identified: true, beatitude: 'uncursed', enchantment: 0, affixes: [] };
}

/** Roll 0–2 distinct affixes for a gear piece; deeper + rarer rolls more/better. */
function rollAffixes(def: ItemDef, rng: RNG, depth: number): string[] {
  const pool = AFFIXES.filter((a) => a.on.includes(def.type));
  if (!pool.length) return [];
  const rarityBonus = { common: 0, uncommon: 0.12, rare: 0.25, epic: 0.42 }[def.rarity];
  let chance = 0.28 + depth * 0.04 + rarityBonus;
  const keys: string[] = [];
  for (let n = 0; n < 2; n++) {
    if (rng.next() >= chance) break;
    const avail = pool.filter((a) => !keys.includes(a.key));
    if (!avail.length) break;
    // Weighted pick — rule affixes carry weight < 1 so they stay a minority (phase 7).
    const total = avail.reduce((s, a) => s + (a.weight ?? 1), 0);
    let r = rng.next() * total;
    let chosen = avail[avail.length - 1];
    for (const a of avail) {
      r -= a.weight ?? 1;
      if (r <= 0) {
        chosen = a;
        break;
      }
    }
    keys.push(chosen.key);
    chance *= 0.45; // a second affix is much rarer
  }
  return keys;
}

/**
 * A randomly-rolled copy for loot: gear may be blessed / cursed / enchanted, roll
 * affixes (more/better with depth), and starts with its beatitude unknown; potions
 * & scrolls roll a beatitude but their very identity is unknown until used/identified.
 */
export function rollInstance(defId: string, rng: RNG, depth = 1): ItemInstance {
  const def = getItem(defId);
  const inst = plainInstance(defId);
  if (isGear(def.type)) {
    const r = rng.next();
    if (r < 0.15) {
      inst.beatitude = 'cursed';
      inst.enchantment = -rng.range(1, 2);
    } else if (r < 0.37) {
      inst.beatitude = 'blessed';
      inst.enchantment = rng.range(1, 3);
    } else {
      inst.beatitude = 'uncursed';
      inst.enchantment = rng.chance(0.35) ? 1 : 0;
    }
    inst.affixes = rollAffixes(def, rng, depth);
    inst.identified = false; // beatitude hidden until identified / equipped
  } else if (def.type === 'potion' || def.type === 'scroll') {
    const r = rng.next();
    inst.beatitude = r < 0.12 ? 'cursed' : r < 0.32 ? 'blessed' : 'uncursed';
    inst.identified = false; // identity hidden until used / identified
  }
  return inst;
}

export function serializeInstance(inst: ItemInstance): SerializedInstance {
  return { ...inst, affixes: inst.affixes ? [...inst.affixes] : undefined };
}
export function deserializeInstance(s: SerializedInstance): ItemInstance {
  bumpUid(s.uid);
  return {
    uid: s.uid,
    defId: s.defId,
    quantity: s.quantity ?? 1,
    identified: s.identified ?? true,
    beatitude: s.beatitude ?? 'uncursed',
    enchantment: s.enchantment ?? 0,
    affixes: s.affixes ?? [],
    charges: s.charges,
  };
}

export type StatBlock = Record<StatKey, number>;

/** The resolved {@link Affix} objects on an instance (ignores unknown keys). */
export function affixesOf(inst: ItemInstance): { key: string; name: string }[] {
  return (inst.affixes ?? []).map(getAffix).filter((a): a is NonNullable<typeof a> => !!a);
}

/**
 * Total equip-stat bonus a gear instance grants: base def bonuses + affixes +
 * enchantment (routed to the piece's primary stat). Single source of truth shared
 * by stat application and the UI summary.
 */
export function equipBonus(inst: ItemInstance): StatBlock {
  const def = getItem(inst.defId);
  const b: StatBlock = { attack: 0, defense: 0, agility: 0, magic: 0, maxHp: 0 };
  const e = def.effects.equip;
  if (e) {
    if (e.attack) b.attack += e.attack;
    if (e.defense) b.defense += e.defense;
    if (e.agility) b.agility += e.agility;
    if (e.magic) b.magic += e.magic;
    if (e.maxHp) b.maxHp += e.maxHp;
  }
  for (const key of inst.affixes ?? []) {
    const affix = getAffix(key);
    if (!affix?.bonus) continue;
    for (const [k, v] of Object.entries(affix.bonus)) b[k as StatKey] += v ?? 0;
  }
  if (inst.enchantment) {
    if (def.type === 'weapon') b.attack += inst.enchantment;
    else if (def.type === 'armor') b.defense += inst.enchantment;
    else if (e?.defense && !e.attack) b.defense += inst.enchantment;
    else b.attack += inst.enchantment;
  }
  return b;
}

// --- per-run identification (potions & scrolls) -------------------------

// Original, evocative alias names — what an unidentified item looks like.
const POTION_ALIASES = [
  '浑浊的药剂', '淡蓝的药剂', '刺鼻的药剂', '冒泡的药剂', '黏稠的药剂',
  '微光的药剂', '暗红的药剂', '苦涩的药剂', '清亮的药剂', '油状的药剂',
];
const SCROLL_ALIASES = [
  '刻着「环」的卷轴', '写满乱码的卷轴', '泛黄的卷轴', '焦边的卷轴', '盖着银印的卷轴',
  '血字的卷轴', '近乎空白的卷轴', '缠着细线的卷轴', '点缀星砂的卷轴', '灰底的卷轴',
];

/**
 * Per-run identification table. Each run shuffles a fixed alias onto every potion
 * and scroll kind; using or identifying a kind reveals its true name for the rest
 * of the run.
 */
export class Identifier {
  private alias = new Map<string, string>();
  private known = new Set<string>();

  constructor(rng?: RNG) {
    if (rng) this.assign(rng);
  }

  private assign(rng: RNG): void {
    const potions = rng.shuffle([...POTION_ALIASES]);
    const scrolls = rng.shuffle([...SCROLL_ALIASES]);
    let pi = 0;
    let si = 0;
    // Stable order over the catalogue keeps the mapping deterministic per seed.
    for (const def of ITEMS) {
      if (def.type === 'potion') this.alias.set(def.id, potions[pi++ % potions.length]);
      else if (def.type === 'scroll') this.alias.set(def.id, scrolls[si++ % scrolls.length]);
    }
  }

  isIdentified(defId: string): boolean {
    return this.known.has(defId);
  }
  identify(defId: string): void {
    this.known.add(defId);
  }
  identifyAll(defIds: string[]): void {
    for (const id of defIds) this.known.add(id);
  }
  aliasOf(defId: string): string {
    return this.alias.get(defId) ?? getItem(defId).name;
  }

  serialize(): { aliases: Array<[string, string]>; known: string[] } {
    return { aliases: [...this.alias.entries()], known: [...this.known] };
  }
  restore(data?: { aliases?: Array<[string, string]>; known?: string[] }): void {
    if (!data) return;
    if (data.aliases) this.alias = new Map(data.aliases);
    if (data.known) this.known = new Set(data.known);
  }
}

/** The player-facing name for an instance, honouring identification & enchantment. */
export function displayName(inst: ItemInstance, ident: Identifier): string {
  const def = getItem(inst.defId);
  if ((def.type === 'potion' || def.type === 'scroll') && !ident.isIdentified(inst.defId)) {
    const q = inst.quantity > 1 ? ` ×${inst.quantity}` : '';
    return ident.aliasOf(inst.defId) + q;
  }
  let name = def.name;
  if (isGear(def.type)) {
    const affixNames = affixesOf(inst).map((a) => a.name);
    if (affixNames.length) name = `${affixNames.join('·')} ${name}`;
    if (inst.enchantment) name = `${inst.enchantment > 0 ? '+' : ''}${inst.enchantment} ${name}`;
    if (inst.identified && inst.beatitude !== 'uncursed') {
      name = (inst.beatitude === 'blessed' ? '【祝福】' : '【诅咒】') + name;
    }
  }
  if (inst.quantity > 1 && !isGear(def.type)) name += ` ×${inst.quantity}`;
  return name;
}
