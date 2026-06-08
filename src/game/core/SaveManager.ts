import type { MetaStats, RunState } from './types';

/**
 * Thin, defensive wrapper around localStorage. Every access is guarded so the
 * game still runs in private-mode browsers where storage may throw.
 */
const RUN_KEY = 'zero-ring/run/v5';
const META_KEY = 'zero-ring/meta/v1';

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
    const data = SaveManager.read<RunState>(RUN_KEY);
    // Validate the few fields we rely on before trusting the blob.
    if (!data || typeof data.depth !== 'number' || typeof data.classId !== 'string') {
      return null;
    }
    return data;
  }

  static clearRun(): void {
    try {
      localStorage.removeItem(RUN_KEY);
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
