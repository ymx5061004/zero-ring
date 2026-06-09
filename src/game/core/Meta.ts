import type { MetaUpgrades } from './types';

/** A permanent, purchasable legacy upgrade (0.3 meta-progression). */
export interface UpgradeDef {
  key: keyof MetaUpgrades;
  name: string;
  desc: string;
  max: number;
  /** Base shard cost; the cost to reach the next level is base × (level + 1). */
  base: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { key: 'vigor', name: '体魄', desc: '起始生命上限 +4 / 级', max: 5, base: 12 },
  { key: 'blade', name: '利刃', desc: '起始攻击 +1 / 级', max: 5, base: 18 },
  { key: 'purse', name: '行囊', desc: '起始金币 +15 / 级', max: 5, base: 10 },
  { key: 'supplies', name: '备药', desc: '额外起始治疗药剂 +1 / 级', max: 3, base: 20 },
];

/** Shard cost to raise an upgrade from `level` to `level + 1`. */
export function upgradeCost(base: number, level: number): number {
  return base * (level + 1);
}

/** 环之碎屑 awarded for a finished run — deeper, deadlier and victorious runs pay more. */
export function shardsForRun(depth: number, kills: number, victory: boolean): number {
  return depth * 2 + kills + (victory ? 20 : 0);
}
