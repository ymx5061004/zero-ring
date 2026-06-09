import type { SerializedInstance } from '../systems/ItemInstance';
import { EQUIP_SLOTS, type EquipSlot } from '../systems/InventorySystem';
import { getItem } from '../data/items';
import type { MetaStats, RunState } from './types';

/**
 * Thin, defensive wrapper around localStorage. Every access is guarded so the
 * game still runs in private-mode browsers where storage may throw.
 */
const RUN_KEY = 'zero-ring/run/v7';
/** Older run schemas, read once and migrated forward (req. save compatibility). */
const LEGACY_RUN_KEYS = ['zero-ring/run/v6', 'zero-ring/run/v5'];
const META_KEY = 'zero-ring/meta/v1';

let migrateUid = 1;

/** Wrap a bare item id (pre-0.2 save) as a plain, identified instance. */
function legacyInstance(defId: string): SerializedInstance {
  return { uid: migrateUid++, defId, quantity: 1, identified: true, beatitude: 'uncursed', enchantment: 0 };
}

function toInstance(value: unknown): SerializedInstance | null {
  if (!value) return null;
  if (typeof value === 'string') return legacyInstance(value);
  const v = value as Partial<SerializedInstance>;
  return {
    uid: v.uid ?? migrateUid++,
    defId: String(v.defId),
    quantity: v.quantity ?? 1,
    identified: v.identified ?? true,
    beatitude: v.beatitude ?? 'uncursed',
    enchantment: v.enchantment ?? 0,
    charges: v.charges,
  };
}

/**
 * Normalize a stored equip block into the 0.2 eleven-slot map. New-shape saves
 * (mainhand/body/…) copy through; the old three-slot shape (weapon/armor/ring)
 * is routed — the lone "armor" piece lands in its real slot (head/body/feet/…).
 */
function migrateEquip(eq: Record<string, unknown>): Partial<Record<EquipSlot, SerializedInstance | null>> {
  const out: Partial<Record<EquipSlot, SerializedInstance | null>> = {};
  for (const s of EQUIP_SLOTS) out[s] = toInstance(eq[s]);
  const hasNew = EQUIP_SLOTS.some((s) => eq[s]);
  if (!hasNew && (eq.weapon || eq.armor || eq.ring)) {
    out.mainhand = toInstance(eq.weapon);
    out.ring1 = toInstance(eq.ring);
    const armor = toInstance(eq.armor);
    if (armor) {
      const gs = getItem(armor.defId).gearSlot;
      out[gs && gs !== 'ring' ? gs : 'body'] = armor;
    }
  }
  return out;
}

/** Normalize any stored run (v5 string-bags, v6 / v7 instances) into a RunState. */
function migrateRun(d: Record<string, unknown>): RunState {
  const rawBag = Array.isArray(d.bag) ? (d.bag as unknown[]) : [];
  d.bag = rawBag.map(toInstance).filter((i): i is SerializedInstance => i !== null);
  d.equip = migrateEquip((d.equip as Record<string, unknown>) ?? {});
  return d as unknown as RunState;
}

const DEFAULT_META: MetaStats = { runs: 0, victories: 0, bestDepth: 0, totalKills: 0 };

export class SaveManager {
  /** True when a resumable run is stored. */
  static hasRun(): boolean {
    return SaveManager.loadRun() !== null;
  }

  static saveRun(state: RunState): void {
    SaveManager.write(RUN_KEY, state);
  }

  static loadRun(): RunState | null {
    let data = SaveManager.read<Record<string, unknown>>(RUN_KEY);
    if (!data) {
      for (const key of LEGACY_RUN_KEYS) {
        data = SaveManager.read<Record<string, unknown>>(key);
        if (data) break;
      }
    }
    // Validate the few fields we rely on before trusting the blob.
    if (!data || typeof data.depth !== 'number' || typeof data.classId !== 'string') {
      return null;
    }
    return migrateRun(data);
  }

  static clearRun(): void {
    try {
      localStorage.removeItem(RUN_KEY);
      for (const key of LEGACY_RUN_KEYS) localStorage.removeItem(key);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }

  static getMeta(): MetaStats {
    const stored = SaveManager.read<Partial<MetaStats>>(META_KEY);
    return { ...DEFAULT_META, ...(stored ?? {}) };
  }

  /** Record a finished run's outcome; this meta survives clearing the run save. */
  static recordOutcome(depthReached: number, victory: boolean, kills: number): MetaStats {
    const meta = SaveManager.getMeta();
    const next: MetaStats = {
      runs: meta.runs + 1,
      victories: meta.victories + (victory ? 1 : 0),
      bestDepth: Math.max(meta.bestDepth, depthReached),
      totalKills: meta.totalKills + kills,
    };
    SaveManager.write(META_KEY, next);
    return next;
  }

  // --- low-level helpers -------------------------------------------------

  private static write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[零环] 无法写入存档：', err);
    }
  }

  private static read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      console.warn('[零环] 无法读取存档：', err);
      return null;
    }
  }
}
