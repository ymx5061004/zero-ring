import type { ClassId } from '../data/classes';
import type { SerializedInstance } from '../systems/ItemInstance';
import type { EquipSlot } from '../systems/InventorySystem';
import type { SerializedStatus } from '../systems/StatusSystem';

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
  /** Live status effects on the player (0.3). Absent on pre-0.3 saves → none. */
  playerStatuses?: SerializedStatus[];
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
  chests: Array<{
    x: number;
    y: number;
    opened: boolean;
    locked: boolean;
    trapped: boolean;
    /** 0.3 chest-interaction fields; absent on pre-0.3 saves → sensible defaults. */
    trapDiscovered?: boolean;
    trapType?: string;
    lootGenerated?: boolean;
    altar?: boolean;
  }>;
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
    /** Live status effects on this monster (0.3). Absent on pre-0.3 saves → none. */
    statuses?: SerializedStatus[];
    /** Trait runtime state (0.3): stolen gold, exploder tells, guard anchor. */
    stolenGold?: number;
    warningShown?: boolean;
    lowHpWarned?: boolean;
    anchorX?: number;
    anchorY?: number;
  }>;
  items: Array<{ inst: SerializedInstance; x: number; y: number }>;
  merchant: { x: number; y: number; stock: Array<{ inst: SerializedInstance; price: number; sold: boolean }> } | null;
  skillUses: number;
  ringOathUsed: boolean;
}

/** Permanent, purchasable legacy upgrades (0.3 meta-progression). */
export interface MetaUpgrades {
  vigor: number;
  blade: number;
  purse: number;
  supplies: number;
  /**
   * Horizontal unlock (0.3 phase 9): 商路 — once bought (0→1) the merchant carries an
   * extra slot and stocks "exotic" wares. Unlocks *choice*, not raw strength.
   */
  tradeRoutes: number;
}

/** Aggregate, cross-run statistics — kept across runs (cleared saves don't touch it). */
export interface MetaStats {
  runs: number;
  victories: number;
  bestDepth: number;
  totalKills: number;
  /** 环之碎屑: meta currency earned each run, spent on legacy upgrades (0.3). */
  shards: number;
  /** Purchased permanent upgrade levels, applied at the start of every run. */
  upgrades: MetaUpgrades;
  /** 图鉴 (0.3 phase 9): monster ids the player has ever defeated (lore on re-encounter). */
  seen?: string[];
  /** Meta schema version, for forward migration. Absent on pre-phase-9 saves. */
  version?: number;
}
