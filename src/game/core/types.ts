import type { ClassId } from '../data/classes';
import type { SerializedInstance } from '../systems/ItemInstance';
import type { EquipSlot } from '../systems/InventorySystem';

/**
 * The persistent state of a single in-progress descent. This is the exact shape
 * written to localStorage so that "继续游戏" can resume a run.
 */
export interface RunState {
  classId: ClassId;
  depth: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  agility: number;
  magic: number;
  /** Current / max mana (0.2). Optional so pre-0.2 saves still load. */
  mana?: number;
  maxMana?: number;
  level: number;
  exp: number;
  gold: number;
  /** Carried + equipped item instances (0.2). */
  bag: SerializedInstance[];
  /** Equipped pieces per paper-doll slot (0.2 expands this to 11 slots). */
  equip: Partial<Record<EquipSlot, SerializedInstance | null>>;
  /** Per-run identification table (potion/scroll aliases + revealed kinds). */
  ident?: { aliases: Array<[string, string]>; known: string[] };
  turn: number;
  kills: number;
  /** Epoch millis when the run began (stamped by the scene, not in scripts). */
  createdAt: number;
}

/** Aggregate, cross-run statistics — kept across runs (cleared saves don't touch it). */
export interface MetaStats {
  runs: number;
  victories: number;
  bestDepth: number;
  totalKills: number;
}
