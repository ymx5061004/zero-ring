import type { ClassId } from '../data/classes';

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
  level: number;
  exp: number;
  gold: number;
  /** Carried item ids and equipped item ids per slot. */
  bag: string[];
  equip: { weapon: string | null; armor: string | null; ring: string | null };
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
