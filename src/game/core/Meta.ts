import type { MetaUpgrades } from './types';

/** The current meta schema version (bumped when upgrade shapes change). */
export const META_VERSION = 2;

/** A permanent, purchasable legacy upgrade (0.3 meta-progression). */
export interface UpgradeDef {
  key: keyof MetaUpgrades;
  name: string;
  desc: string;
  max: number;
  /** Base shard cost; the cost to reach the next level is base × (level + 1). */
  base: number;
  /**
   * 'stat' = a vertical numeric bonus (kept conservative, disabled in 纯净模式);
   * 'unlock' = a horizontal unlock that grants *choice*, not raw power.
   */
  kind: 'stat' | 'unlock';
  /** Per-level magnitude of a stat upgrade (read by metaStatBonus; 0 for unlocks). */
  perLevel?: number;
}

/**
 * Phase 9 rebalance — vertical growth is deliberately *small* so it never flattens
 * the in-run decisions (esp. 利刃/attack, which compresses early fights the most):
 *   - 体魄: +4→+3 / lvl, cap 5→4   (max +12 HP, was +20)
 *   - 利刃: +1 / lvl, cap 5→3       (max +3 attack, was +5)
 *   - 行囊 / 备药: unchanged (gold is gated by shop prices; potions are one-shot)
 * Over-cap levels from older saves are NOT deleted — they simply apply the capped
 * amount and show as 已满 (see metaStatBonus + LegacyView clamp).
 */
export const UPGRADES: readonly UpgradeDef[] = [
  { key: 'vigor', name: '体魄', desc: '起始生命上限 +3 / 级', max: 4, base: 12, kind: 'stat', perLevel: 3 },
  { key: 'blade', name: '利刃', desc: '起始攻击 +1 / 级', max: 3, base: 20, kind: 'stat', perLevel: 1 },
  { key: 'purse', name: '行囊', desc: '起始金币 +15 / 级', max: 5, base: 10, kind: 'stat', perLevel: 15 },
  { key: 'supplies', name: '备药', desc: '额外起始治疗药剂 +1 / 级', max: 3, base: 20, kind: 'stat', perLevel: 1 },
  { key: 'tradeRoutes', name: '商路', desc: '解锁新选择：商人多一格货位并进货奇货', max: 1, base: 30, kind: 'unlock' },
];

/**
 * The start-of-run stat bonus from the *vertical* upgrades, each clamped to its
 * (possibly lowered) cap so an over-bought older save can't exceed the new ceiling.
 * Horizontal unlocks (tradeRoutes) are NOT here — they grant choice, applied elsewhere.
 */
export function metaStatBonus(up: MetaUpgrades): { maxHp: number; attack: number; gold: number; potions: number } {
  const amount = (key: keyof MetaUpgrades): number => {
    const def = UPGRADES.find((u) => u.key === key);
    if (!def || def.kind !== 'stat') return 0;
    return Math.min(up[key] ?? 0, def.max) * (def.perLevel ?? 0);
  };
  return { maxHp: amount('vigor'), attack: amount('blade'), gold: amount('purse'), potions: amount('supplies') };
}

/** Shard cost to raise an upgrade from `level` to `level + 1`. */
export function upgradeCost(base: number, level: number): number {
  return base * (level + 1);
}

/** 环之碎屑 awarded for a finished run — deeper, deadlier and victorious runs pay more. */
export function shardsForRun(depth: number, kills: number, victory: boolean): number {
  return depth * 2 + kills + (victory ? 20 : 0);
}

/*
 * TODO (phase 9 follow-ups — designed, not yet built; all horizontal):
 *  - 遗物三选一 (relics): on a new run, pick 1 of 3 unlocked relics that *change play*
 *    (reuse the rule-affix hook layer — e.g. a relic that grants `echo`/`breakstep`).
 *    Minimal first cut: auto-grant one random unlocked relic; add the 3-choice UI later.
 *  - 房间图纸 (room blueprints): a meta unlock that raises special-room frequency /
 *    adds a 3rd template roll per floor (thread a flag into applyRoomTemplates).
 *  - 挑战符记 (challenge mode): an unlockable run modifier (more monsters / fewer
 *    items / more traps) that disables vertical meta and pays bonus 碎屑 on finish.
 */
