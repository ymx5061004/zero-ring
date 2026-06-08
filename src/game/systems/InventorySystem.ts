import type { Player } from '../entities/Player';
import { equipSlotOf, getItem, type ItemDef, type ScrollAction } from '../data/items';

export type EquipSlot = 'weapon' | 'armor' | 'ring';

export interface UseOutcome {
  ok: boolean;
  message: string;
  /** Set when a scroll was read — the scene resolves the world effect. */
  scroll?: ScrollAction;
}

/**
 * The player's carried items, equipped gear and gold. Equipping mutates the
 * player's effective stats directly (delta on equip / unequip), which is what
 * combat reads — so persistence stores those effective stats plus the item ids.
 */
export class InventorySystem {
  readonly capacity = 20;
  items: ItemDef[] = [];
  equipped: { weapon: ItemDef | null; armor: ItemDef | null; ring: ItemDef | null } = {
    weapon: null,
    armor: null,
    ring: null,
  };
  gold = 0;

  private readonly player: Player;

  constructor(player: Player) {
    this.player = player;
  }

  isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  /** Add a (non-gold) item to the bag. Returns false if there's no room. */
  add(item: ItemDef): boolean {
    if (this.isFull()) return false;
    this.items.push(item);
    return true;
  }

  addGold(amount: number): void {
    this.gold += Math.max(0, Math.floor(amount));
  }

  remove(item: ItemDef): void {
    const i = this.items.indexOf(item);
    if (i !== -1) this.items.splice(i, 1);
  }

  // --- equipment ---------------------------------------------------------

  /** Equip a bag item, swapping any current piece back into the bag. */
  equip(item: ItemDef): string {
    const slot = equipSlotOf(item.type);
    if (!slot) return '';
    this.remove(item);
    const current = this.equipped[slot];
    if (current) {
      this.applyEquip(current, -1);
      this.items.push(current);
    }
    this.equipped[slot] = item;
    this.applyEquip(item, +1);
    return `你装备了${item.name}。`;
  }

  /** Unequip a slot, returning the piece to the bag (if there's room). */
  unequip(slot: EquipSlot): string {
    const current = this.equipped[slot];
    if (!current) return '';
    if (this.isFull()) return '背包已满，无法卸下装备。';
    this.applyEquip(current, -1);
    this.equipped[slot] = null;
    this.items.push(current);
    return `你卸下了${current.name}。`;
  }

  private applyEquip(item: ItemDef, sign: number): void {
    const e = item.effects.equip;
    if (!e) return;
    const p = this.player;
    if (e.attack) p.attack += sign * e.attack;
    if (e.defense) p.defense += sign * e.defense;
    if (e.agility) p.agility += sign * e.agility;
    if (e.magic) p.magic += sign * e.magic;
    if (e.maxHp) {
      p.maxHp = Math.max(1, p.maxHp + sign * e.maxHp);
      if (p.hp > p.maxHp) p.hp = p.maxHp;
    }
  }

  // --- consumables -------------------------------------------------------

  /** Use a consumable; applies heal/boost or hands a scroll action to the scene. */
  use(item: ItemDef): UseOutcome {
    const e = item.effects;
    const p = this.player;

    if (e.scroll) {
      this.remove(item);
      return { ok: true, message: `你诵读了${item.name}。`, scroll: e.scroll };
    }

    const parts: string[] = [];
    if (e.heal) {
      const before = p.hp;
      p.heal(e.heal);
      const got = p.hp - before;
      parts.push(got > 0 ? `恢复 ${got} 点生命` : '生命已满');
    }
    if (e.boost) {
      if (e.boost.maxHp) p.maxHp += e.boost.maxHp;
      if (e.boost.attack) p.attack += e.boost.attack;
      if (e.boost.defense) p.defense += e.boost.defense;
      parts.push('体魄得到永久强化');
    }
    this.remove(item);
    const detail = parts.length ? `，${parts.join('、')}` : '';
    return { ok: true, message: `你使用了${item.name}${detail}。` };
  }

  // --- persistence -------------------------------------------------------

  serialize(): { gold: number; bag: string[]; equip: { weapon: string | null; armor: string | null; ring: string | null } } {
    return {
      gold: this.gold,
      bag: this.items.map((i) => i.id),
      equip: {
        weapon: this.equipped.weapon?.id ?? null,
        armor: this.equipped.armor?.id ?? null,
        ring: this.equipped.ring?.id ?? null,
      },
    };
  }

  /**
   * Restore from saved ids WITHOUT re-applying equip bonuses — the player's saved
   * stats already include them.
   */
  restore(gold: number, bag: string[], equip: { weapon: string | null; armor: string | null; ring: string | null }): void {
    this.gold = gold;
    this.items = bag.map(getItem);
    this.equipped.weapon = equip.weapon ? getItem(equip.weapon) : null;
    this.equipped.armor = equip.armor ? getItem(equip.armor) : null;
    this.equipped.ring = equip.ring ? getItem(equip.ring) : null;
  }
}
