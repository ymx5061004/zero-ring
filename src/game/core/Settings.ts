/**
 * Player-facing settings, persisted to localStorage. A tiny cached singleton so
 * any scene can read the current values cheaply.
 */
export type AnimSpeed = 'slow' | 'normal' | 'fast';

export interface GameSettings {
  /** Sound master toggle. No audio ships yet — this only stores the preference. */
  sound: boolean;
  animSpeed: AnimSpeed;
  autoPickupGold: boolean;
}

const KEY = 'zero-ring/settings/v1';
const DEFAULTS: GameSettings = { sound: true, animSpeed: 'normal', autoPickupGold: true };

function read(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

let current: GameSettings = read();

export const Settings = {
  get(): GameSettings {
    return current;
  },

  set(patch: Partial<GameSettings>): GameSettings {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* ignore */
    }
    return current;
  },

  /** Duration multiplier derived from the animation-speed setting. */
  animScale(): number {
    return current.animSpeed === 'slow' ? 1.6 : current.animSpeed === 'fast' ? 0.55 : 1;
  },
};
