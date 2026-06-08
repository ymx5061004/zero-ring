import type { RNG } from '../core/RNG';
import { ITEMS, type ItemDef, type Rarity } from '../data/items';

/**
 * Decides what loot appears: items scattered on the floor, drops from slain
 * monsters, and the contents of chests. Pure functions of (depth, rng) so the
 * results are deterministic for a given seed.
 */

const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 10,
  uncommon: 5,
  rare: 2,
  epic: 1,
};

function pickWeighted(pool: readonly ItemDef[], rng: RNG, rareBoost: number): ItemDef {
  let total = 0;
  const weights = pool.map((it) => {
    const w = RARITY_WEIGHT[it.rarity] * (it.rarity === 'common' ? 1 : rareBoost);
    total += w;
    return w;
  });
  let roll = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

const NON_GOLD = ITEMS.filter((it) => it.type !== 'gold');

/** An item id to scatter on the floor (mostly consumables and the odd gear). */
export function rollFloorItem(depth: number, rng: RNG): string {
  // Floors lean toward consumables + gold; gear and rares grow with depth.
  if (rng.chance(0.3)) return rng.chance(0.7) ? 'coin' : 'coin_pile';
  return pickWeighted(NON_GOLD, rng, 1 + depth * 0.15).id;
}

/**
 * What a slain monster drops: an item id, or null for nothing. Tougher floors
 * drop a little more often and a little better.
 */
export function rollMonsterDrop(depth: number, rng: RNG): string | null {
  if (!rng.chance(0.34)) return null;
  if (rng.chance(0.5)) return rng.chance(0.8) ? 'coin' : 'coin_pile';
  return pickWeighted(NON_GOLD, rng, 1 + depth * 0.2).id;
}

/** A chest's contents (1–3 items), weighted toward better loot. */
export function rollChestLoot(depth: number, rng: RNG): string[] {
  const count = rng.range(1, 3);
  const loot: string[] = [];
  for (let i = 0; i < count; i++) {
    loot.push(rng.chance(0.25) ? 'coin_pile' : pickWeighted(NON_GOLD, rng, 2.4 + depth * 0.2).id);
  }
  return loot;
}
