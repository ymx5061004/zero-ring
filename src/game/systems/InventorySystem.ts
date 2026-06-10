import type { Player } from '../entities/Player';
import { equipSlotOf, getAffix, getItem, type AffixRule, type GearSlot, type PotionAction, type ScrollAction } from '../data/items';
import {
  deserializeInstance,
  displayName,
  equipBonus,
  Identifier,
  isConsumable,
  serializeInstance,
  type Beatitude,
  type ItemInstance,
  type SerializedInstance,
} from './ItemInstance';

/** The eleven paper-doll slots (0.2). 'ring' gear fits ring1 or ring2. */
export const EQUIP_SLOTS = [
  'mainhand',
  'offhand',
  'head',
  'shoulders',
  'body',
  'belt',
  'gloves',
  'feet',
  'amulet',
  'ring1',
  'ring2',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Short original Chinese labels for each slot (UI). */
export const SLOT_LABEL: Record<EquipSlot, string> = {
  mainhand: '主手',
  offhand: '副手',
  head: '头部',
  shoulders: '肩甲',
  body: '身体',
  belt: '腰带',
  gloves: '手套',
  feet: '足部',
  amulet: '护符',
  ring1: '戒指一',
  ring2: '戒指二',
};

type EquippedMap = Record<EquipSlot, ItemInstance | null>;

function emptyEquipped(): EquippedMap {
  return {
    mainhand: null,
    offhand: null,
    head: null,
    shoulders: null,
    body: null,
    belt: null,
    gloves: null,
    feet: null,
    amulet: null,
    ring1: null,
    ring2: null,
  };
}

export interface UseOutcome {
  ok: boolean;
  message: string;
  /** Set when a scroll was read — the scene resolves the world effect. */
  scroll?: ScrollAction;
  /** Set when a status/double-edged potion was quaffed — the scene resolves it (0.3). */
  potion?: PotionAction;
  /** The blessing/curse of the consumed item (scales the scene-side effect). */
  beatitude?: Beatitude;
  /** The item's true name, set only when this use just revealed a previously-unknown kind. */
  revealName?: string;
}

export interface GearOutcome {
  ok: boolean;
  message: string;
  /** Set when 赦链 forced a cursed piece off — the scene exacts the price (phase 7). */
  unchainCost?: boolean;
}

export interface SerializedInventory {
  gold: number;
  bag: SerializedInstance[];
  equip: Partial<Record<EquipSlot, SerializedInstance | null>>;
}

/**
 * The player's carried item *instances*, equipped gear and gold (0.2, req. phase
 * 4). Equipping mutates the player's effective stats directly (base bonuses plus
 * enchantment), which is what combat reads — so persistence stores those effective
 * stats plus the serialized instances. Curse / blessing and identification are
 * honoured here and surfaced through the per-run {@link Identifier}.
 */
export class InventorySystem {
  readonly capacity = 20;
  items: ItemInstance[] = [];
  equipped: EquippedMap = emptyEquipped();
  gold = 0;
  readonly ident: Identifier;

  private readonly player: Player;

  constructor(player: Player, ident: Identifier) {
    this.player = player;
    this.ident = ident;
  }

  isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  name(inst: ItemInstance): string {
    return displayName(inst, this.ident);
  }

  /** Add an instance, stacking identical consumables. Returns false if full. */
  add(inst: ItemInstance): boolean {
    const def = getItem(inst.defId);
    if (isConsumable(def.type)) {
      const stack = this.items.find((i) => i.defId === inst.defId && i.beatitude === inst.beatitude);
      if (stack) {
        stack.quantity += inst.quantity;
        return true;
      }
    }
    if (this.isFull()) return false;
    this.items.push(inst);
    return true;
  }

  addGold(amount: number): void {
    this.gold += Math.max(0, Math.floor(amount));
  }

  remove(inst: ItemInstance): void {
    const i = this.items.indexOf(inst);
    if (i !== -1) this.items.splice(i, 1);
  }

  /** Decrement a stack by one, removing the instance when it empties. */
  private consumeOne(inst: ItemInstance): void {
    if (inst.quantity > 1) inst.quantity -= 1;
    else this.remove(inst);
  }

  // --- equipment ---------------------------------------------------------

  /** Resolve a gear slot to a concrete equip slot (rings pick a free finger). */
  private resolveSlot(gear: GearSlot): EquipSlot {
    if (gear === 'ring') {
      if (!this.equipped.ring1) return 'ring1';
      if (!this.equipped.ring2) return 'ring2';
      return 'ring1';
    }
    return gear;
  }

  /** Equip a bag instance, swapping any current piece back into the bag. */
  equip(inst: ItemInstance): GearOutcome {
    const gear = equipSlotOf(getItem(inst.defId));
    if (!gear) return { ok: false, message: '' };
    const slot = this.resolveSlot(gear);
    const current = this.equipped[slot];
    if (current && current.beatitude === 'cursed') {
      current.identified = true;
      return { ok: false, message: `${this.name(current)}被诅咒，无法更换。` };
    }
    this.remove(inst);
    if (current) {
      this.applyEquip(current, -1);
      this.items.push(current);
    }
    this.equipped[slot] = inst;
    inst.identified = true; // wearing it reveals its blessing / curse
    this.applyEquip(inst, +1);
    const warn = inst.beatitude === 'cursed' ? '……一阵寒意缠身——它被诅咒了！' : '';
    return { ok: true, message: `你装备了${this.name(inst)}。${warn}` };
  }

  /** Unequip a slot, returning the piece to the bag. Cursed gear refuses — unless
   *  the hero wears 赦链, which forces it off at a price (signalled via unchainCost). */
  unequip(slot: EquipSlot): GearOutcome {
    const current = this.equipped[slot];
    if (!current) return { ok: false, message: '' };
    const forcedOffCurse = current.beatitude === 'cursed';
    if (forcedOffCurse) {
      current.identified = true;
      if (!this.hasRule('unchain')) {
        return { ok: false, message: `${this.name(current)}被诅咒，无法卸下（需解缚卷轴或赦链）。` };
      }
    }
    if (this.isFull()) return { ok: false, message: '背包已满，无法卸下装备。' };
    this.applyEquip(current, -1);
    this.equipped[slot] = null;
    this.items.push(current);
    if (forcedOffCurse) {
      return { ok: true, message: `你借赦链之力，强行卸下了${this.name(current)}。`, unchainCost: true };
    }
    return { ok: true, message: `你卸下了${this.name(current)}。` };
  }

  // --- rule affixes (0.3 phase 7) ----------------------------------------

  /** Every rule effect granted by currently-equipped gear (pieces stack). */
  ruleAffixes(): Array<{ rule: AffixRule; params: Record<string, number>; name: string }> {
    const out: Array<{ rule: AffixRule; params: Record<string, number>; name: string }> = [];
    for (const slot of EQUIP_SLOTS) {
      const inst = this.equipped[slot];
      if (!inst) continue;
      for (const key of inst.affixes ?? []) {
        const a = getAffix(key);
        if (a?.rule) out.push({ rule: a.rule, params: a.params ?? {}, name: a.name });
      }
    }
    return out;
  }

  /** Whether any equipped gear grants the given rule effect. */
  hasRule(rule: AffixRule): boolean {
    return this.ruleAffixes().some((r) => r.rule === rule);
  }

  /** The strongest value of a rule's numeric param across equipped gear (or `dflt`). */
  ruleParam(rule: AffixRule, key: string, dflt = 0): number {
    let best = dflt;
    let found = false;
    for (const r of this.ruleAffixes()) {
      if (r.rule !== rule) continue;
      const v = r.params[key] ?? dflt;
      best = found ? Math.max(best, v) : v;
      found = true;
    }
    return best;
  }

  private applyEquip(inst: ItemInstance, sign: number): void {
    // equipBonus folds in base bonuses, affixes and enchantment as one block.
    const b = equipBonus(inst);
    const p = this.player;
    if (b.attack) p.attack += sign * b.attack;
    if (b.defense) p.defense += sign * b.defense;
    if (b.agility) p.agility += sign * b.agility;
    if (b.magic) p.magic += sign * b.magic;
    if (b.maxHp) {
      p.maxHp = Math.max(1, p.maxHp + sign * b.maxHp);
      if (p.hp > p.maxHp) p.hp = p.maxHp;
    }
  }

  // --- consumables -------------------------------------------------------

  /**
   * Use a consumable. Scroll- and potion-action items hand the effect to the scene
   * (which logs it) and report the now-known name via `revealName`, so the scene can
   * print the effect *first* and the identity *after* (0.3 unknown-item UX). Plain
   * heal/boost potions resolve their effect inline as before.
   */
  use(inst: ItemInstance): UseOutcome {
    const def = getItem(inst.defId);
    const p = this.player;
    const wasUnknown = (def.type === 'potion' || def.type === 'scroll') && !this.ident.isIdentified(inst.defId);
    if (def.type === 'potion' || def.type === 'scroll') this.ident.identify(inst.defId);
    inst.identified = true;
    const revealName = wasUnknown ? def.name : undefined;

    if (def.effects.scroll) {
      this.consumeOne(inst);
      const message = wasUnknown ? '你展开一卷来历不明的卷轴，低声诵读。' : `你诵读了${def.name}。`;
      return { ok: true, message, scroll: def.effects.scroll, beatitude: inst.beatitude, revealName };
    }
    if (def.effects.potion) {
      this.consumeOne(inst);
      const message = wasUnknown ? '你饮下一份来历不明的药剂。' : `你饮下了${def.name}。`;
      return { ok: true, message, potion: def.effects.potion, beatitude: inst.beatitude, revealName };
    }

    const parts: string[] = [];
    if (def.effects.heal) {
      let heal = def.effects.heal;
      if (inst.beatitude === 'blessed') heal = Math.round(heal * 1.5);
      else if (inst.beatitude === 'cursed') heal = Math.round(heal * 0.5);
      // 灰烬医师 route: the medic wrings more from every restorative — applied AFTER the
      // beatitude scale, so a cursed potion is still worse than an uncursed one (phase 8).
      if (p.classId === 'ash-medic') heal = Math.round(heal * 1.3);
      // 血契: while clinging to life, all healing is halved (phase 7).
      if (this.hasRule('bloodpact') && p.hp <= p.maxHp * 0.25) heal = Math.round(heal * 0.5);
      const before = p.hp;
      p.heal(heal);
      const got = p.hp - before;
      parts.push(got > 0 ? `恢复 ${got} 点生命` : '生命已满');
    }
    if (def.effects.boost) {
      const scale = inst.beatitude === 'blessed' ? 1.5 : inst.beatitude === 'cursed' ? 0.5 : 1;
      if (def.effects.boost.maxHp) p.maxHp += Math.max(1, Math.round(def.effects.boost.maxHp * scale));
      if (def.effects.boost.attack) p.attack += def.effects.boost.attack;
      if (def.effects.boost.defense) p.defense += def.effects.boost.defense;
      parts.push('体魄得到永久强化');
    }
    this.consumeOne(inst);
    const detail = parts.length ? `，${parts.join('、')}` : '';
    const lead = wasUnknown ? '你饮下一份来历不明的药剂' : `你使用了${def.name}`;
    return { ok: true, message: `${lead}${detail}。`, beatitude: inst.beatitude, revealName };
  }

  /** All instances in play (bag + equipped). */
  allInstances(): ItemInstance[] {
    const eq = EQUIP_SLOTS.map((s) => this.equipped[s]).filter((i): i is ItemInstance => i !== null);
    return [...this.items, ...eq];
  }

  /** 鉴物卷轴: identify every carried item; returns how many were newly revealed. */
  identifyAllCarried(): number {
    let count = 0;
    for (const inst of this.allInstances()) {
      const def = getItem(inst.defId);
      const unknown =
        ((def.type === 'potion' || def.type === 'scroll') && !this.ident.isIdentified(inst.defId)) ||
        !inst.identified;
      if (unknown) count++;
      this.ident.identify(inst.defId);
      inst.identified = true;
    }
    return count;
  }

  /** Whether a carried instance still holds a secret (alias not learned, or beatitude hidden). */
  private isUnknown(inst: ItemInstance): boolean {
    const def = getItem(inst.defId);
    if ((def.type === 'potion' || def.type === 'scroll') && !this.ident.isIdentified(inst.defId)) return true;
    return !inst.identified;
  }

  /**
   * 鉴物卷轴 (0.3 rebalance): identify up to `n` still-unknown carried items, in bag
   * order (equipped last). Returns the revealed display names. No longer reveals the
   * whole bag at once — uncursed reveals one, blessed three.
   */
  identifyFirst(n: number): string[] {
    const names: string[] = [];
    for (const inst of this.allInstances()) {
      if (names.length >= n) break;
      if (!this.isUnknown(inst)) continue;
      this.ident.identify(inst.defId);
      inst.identified = true;
      names.push(this.name(inst));
    }
    return names;
  }

  /** 解缚卷轴 (blessed): lift curses from ALL equipped gear so it can be removed. */
  uncurseEquipped(): number {
    let count = 0;
    for (const slot of EQUIP_SLOTS) {
      const cur = this.equipped[slot];
      if (cur && cur.beatitude === 'cursed') {
        cur.beatitude = 'uncursed';
        cur.identified = true;
        count++;
      }
    }
    return count;
  }

  /** 解缚卷轴 (uncursed): lift the curse from the FIRST cursed piece. Returns its name. */
  uncurseFirst(): string | null {
    for (const slot of EQUIP_SLOTS) {
      const cur = this.equipped[slot];
      if (cur && cur.beatitude === 'cursed') {
        cur.beatitude = 'uncursed';
        cur.identified = true;
        return this.name(cur);
      }
    }
    return null;
  }

  /** Backfire: curse a random non-cursed equipped piece (so it can't be removed). */
  curseRandomEquipped(): string | null {
    const victims = EQUIP_SLOTS.map((s) => this.equipped[s]).filter(
      (i): i is ItemInstance => i !== null && i.beatitude !== 'cursed',
    );
    if (!victims.length) return null;
    const v = victims[Math.floor(Math.random() * victims.length)];
    v.beatitude = 'cursed';
    v.identified = true;
    return this.name(v);
  }

  // --- persistence -------------------------------------------------------

  serialize(): SerializedInventory {
    const equip: Partial<Record<EquipSlot, SerializedInstance | null>> = {};
    for (const slot of EQUIP_SLOTS) {
      const cur = this.equipped[slot];
      equip[slot] = cur ? serializeInstance(cur) : null;
    }
    return { gold: this.gold, bag: this.items.map(serializeInstance), equip };
  }

  /**
   * Restore from saved instances WITHOUT re-applying equip bonuses — the player's
   * saved stats already include them.
   */
  restore(gold: number, bag: SerializedInstance[], equip: SerializedInventory['equip']): void {
    this.gold = gold;
    this.items = bag.map(deserializeInstance);
    this.equipped = emptyEquipped();
    for (const slot of EQUIP_SLOTS) {
      const s = equip[slot];
      this.equipped[slot] = s ? deserializeInstance(s) : null;
    }
  }
}
