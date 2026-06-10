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

/**
 * Weighted pick honouring rarity, a depth-scaled rare boost, each item's optional
 * `dropWeight` (0.3 — lets negative/double-edged items spawn but stay a minority),
 * and `minDepth` (so directly-harmful items never appear on the very first floor).
 */
function pickWeighted(pool: readonly ItemDef[], rng: RNG, rareBoost: number, depth: number): ItemDef {
  const avail = pool.filter((it) => (it.minDepth ?? 1) <= depth);
  const usable = avail.length ? avail : pool;
  let total = 0;
  const weights = usable.map((it) => {
    const w = RARITY_WEIGHT[it.rarity] * (it.rarity === 'common' ? 1 : rareBoost) * (it.dropWeight ?? 1);
    total += w;
    return w;
  });
  let roll = rng.next() * total;
  for (let i = 0; i < usable.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return usable[i];
  }
  return usable[usable.length - 1];
}

const NON_GOLD = ITEMS.filter((it) => it.type !== 'gold');
/** The merchant deals in honest goods — no status potions / lure / dimlight wares. */
const SHOP_POOL = NON_GOLD.filter(
  (it) => !it.effects.potion && it.effects.scroll !== 'lure' && it.effects.scroll !== 'dimlight',
);

/** An item id to scatter on the floor (mostly consumables and the odd gear). */
export function rollFloorItem(depth: number, rng: RNG): string {
  // Floors lean toward consumables + gold; gear and rares grow with depth.
  if (rng.chance(0.3)) return rng.chance(0.7) ? 'coin' : 'coin_pile';
  return pickWeighted(NON_GOLD, rng, 1 + depth * 0.15, depth).id;
}

/**
 * What a slain monster drops: an item id, or null for nothing. Tougher floors
 * drop a little more often and a little better.
 */
export function rollMonsterDrop(depth: number, rng: RNG): string | null {
  if (!rng.chance(0.34)) return null;
  if (rng.chance(0.5)) return rng.chance(0.8) ? 'coin' : 'coin_pile';
  return pickWeighted(NON_GOLD, rng, 1 + depth * 0.2, depth).id;
}

/**
 * The merchant's wares — `count` distinct item ids (no gold), weighted by depth.
 * With `exotic` (the 商路 meta unlock) the pool widens to include the otherwise-barred
 * status / double-edged goods — pure *buying choice*, not raw strength.
 */
export function rollShopStock(depth: number, rng: RNG, count: number, exotic = false): string[] {
  const pool = exotic ? NON_GOLD : SHOP_POOL;
  const stock: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (stock.length < count && guard++ < 200) {
    const it = pickWeighted(pool, rng, 1.6 + depth * 0.15, depth);
    if (used.has(it.id)) continue;
    used.add(it.id);
    stock.push(it.id);
  }
  return stock;
}

/** A chest's contents (1–3 items), weighted toward better loot. */
export function rollChestLoot(depth: number, rng: RNG): string[] {
  const count = rng.range(1, 3);
  const loot: string[] = [];
  for (let i = 0; i < count; i++) {
    loot.push(rng.chance(0.25) ? 'coin_pile' : pickWeighted(NON_GOLD, rng, 2.4 + depth * 0.2, depth).id);
  }
  return loot;
}
