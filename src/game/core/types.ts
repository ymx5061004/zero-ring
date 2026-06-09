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
  /**
   * Seed of the current floor's RNG. Persisting it makes resume regenerate the
   * *same* layout instead of a fresh one. Optional so pre-existing saves still load.
   */
  floorSeed?: number;
  /**
   * Full snapshot of the current floor (0.3) so 继续游戏 resumes the exact spot —
   * same explored fog, monster HP/positions, picked-up items, opened doors/chests
   * and merchant stock. Absent on old saves (then the floor regenerates from seed).
   */
  floor?: SerializedFloor;
  /** Epoch millis when the run began (stamped by the scene, not in scripts). */
  createdAt: number;
}

/** A complete, restorable snapshot of one dungeon floor (see RunState.floor). */
export interface SerializedFloor {
  px: number;
  py: number;
  /** TileType grid (row-major) — captures door/chest tile changes too. */
  tiles: number[][];
  /** Fog-of-war, as 0/1 per tile (compact). */
  explored: number[][];
  spawn: { x: number; y: number };
  stairs: { x: number; y: number };
  traps: Array<{ x: number; y: number; kind: string; hidden: boolean }>;
  chests: Array<{ x: number; y: number; opened: boolean; locked: boolean; trapped: boolean }>;
  monsters: Array<{
    key: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    attack: number;
    exp: number;
    elite: boolean;
    name: string;
    skipNext: boolean;
    phase2: boolean;
    spawnedSplit: boolean;
  }>;
  items: Array<{ inst: SerializedInstance; x: number; y: number }>;
  merchant: { x: number; y: number; stock: Array<{ inst: SerializedInstance; price: number; sold: boolean }> } | null;
  skillUses: number;
  ringOathUsed: boolean;
}

/** Aggregate, cross-run statistics — kept across runs (cleared saves don't touch it). */
export interface MetaStats {
  runs: number;
  victories: number;
  bestDepth: number;
  totalKills: number;
}
