import type { Entity } from '../entities/Entity';
import type { RNG } from '../core/RNG';

/**
 * Unified status-effect system for 《零环》 0.2. Both the player and monsters carry
 * a list of {@link StatusInstance}s that tick once per game turn. Classes, items,
 * traps and monster attacks all funnel through {@link applyStatus}; resistances
 * (毒/火/冰/精神) soften or negate incoming effects. Every name here is original.
 */

export type StatusType =
  | 'poisoned'
  | 'burning'
  | 'frozen'
  | 'confused'
  | 'feared'
  | 'slowed'
  | 'vulnerable'
  | 'regenerating'
  | 'blinded';

/** Damage / effect channels, used for resistances. */
export type DamageType = 'physical' | 'poison' | 'fire' | 'ice' | 'mind';

export interface StatusInstance {
  type: StatusType;
  /** Remaining turns (counts down each tick). */
  turns: number;
  /** Magnitude — damage-per-tick for poison/burn, heal for regen, etc. */
  power: number;
}

export interface StatusMeta {
  name: string;
  /** Short tag shown in the HUD status strip. */
  tag: string;
  /** Resistance channel that softens this effect (if any). */
  channel?: DamageType;
  /** Beneficial effect (rendered differently, never auto-cleansed). */
  good?: boolean;
  /** Holder forfeits its action this turn. */
  skipsTurn?: boolean;
  /** Holder moves erratically (confused) instead of acting normally. */
  erratic?: boolean;
  /** Holder tries to flee from its target. */
  flees?: boolean;
}

export const STATUS_META: Record<StatusType, StatusMeta> = {
  poisoned: { name: '中毒', tag: '毒', channel: 'poison' },
  burning: { name: '灼烧', tag: '燃', channel: 'fire' },
  frozen: { name: '冰封', tag: '冻', channel: 'ice', skipsTurn: true },
  confused: { name: '混乱', tag: '乱', channel: 'mind', erratic: true },
  feared: { name: '恐惧', tag: '惧', channel: 'mind', flees: true },
  slowed: { name: '迟缓', tag: '缓' },
  vulnerable: { name: '易伤', tag: '伤' },
  regenerating: { name: '回复', tag: '愈', good: true },
  blinded: { name: '目盲', tag: '盲' },
};

export type Resistances = Partial<Record<DamageType, number>>;

/** How much an entity resists a channel (0 = none, 1 = immune), clamped. */
export function resistanceOf(entity: Entity, channel?: DamageType): number {
  if (!channel) return 0;
  const r = entity.resistances[channel] ?? 0;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Apply (or refresh) a status on an entity, softened by its resistance. Returns
 * the effective number of turns applied (0 = fully resisted).
 */
export function applyStatus(
  entity: Entity,
  type: StatusType,
  turns: number,
  power: number,
  rng?: RNG,
): number {
  const meta = STATUS_META[type];
  const resist = resistanceOf(entity, meta.channel);
  if (resist >= 1) return 0;
  // Fully-immune save chance scales with resistance; otherwise scale the duration.
  if (resist > 0 && rng && rng.chance(resist * 0.5)) return 0;
  const effTurns = Math.max(1, Math.round(turns * (1 - resist * 0.5)));
  const effPower = Math.max(1, Math.round(power * (1 - resist * 0.5)));

  const existing = entity.statuses.find((s) => s.type === type);
  if (existing) {
    existing.turns = Math.max(existing.turns, effTurns);
    existing.power = Math.max(existing.power, effPower);
  } else {
    entity.statuses.push({ type, turns: effTurns, power: effPower });
  }
  return effTurns;
}

export interface StatusTickEvent {
  type: StatusType;
  message: string;
  /** Damage dealt this tick (0 if none). */
  damage: number;
  /** HP restored this tick (0 if none). */
  healed: number;
  /** The tick reduced the holder to 0 HP. */
  died: boolean;
}

/**
 * Advance every status on an entity by one turn: deal poison/burn damage, apply
 * regen, then expire finished effects. The caller animates / logs the events and
 * checks for death. `name` is the holder's display name for log lines.
 */
export function tickStatuses(entity: Entity, name: string): StatusTickEvent[] {
  const events: StatusTickEvent[] = [];
  for (const s of entity.statuses) {
    let damage = 0;
    let healed = 0;
    let message = '';
    if (s.type === 'poisoned') {
      damage = s.power;
      entity.takeDamage(damage);
      message = `${name}受到 ${damage} 点毒素侵蚀。`;
    } else if (s.type === 'burning') {
      damage = s.power;
      entity.takeDamage(damage);
      message = `${name}在火焰中灼烧，受到 ${damage} 点伤害。`;
    } else if (s.type === 'regenerating') {
      const before = entity.hp;
      entity.heal(s.power);
      healed = entity.hp - before;
      if (healed > 0) message = `${name}回复了 ${healed} 点生命。`;
    }
    s.turns -= 1;
    if (damage > 0 || healed > 0) {
      events.push({ type: s.type, message, damage, healed, died: entity.isDead });
    }
    if (entity.isDead) break;
  }
  // Drop expired effects.
  entity.statuses = entity.statuses.filter((s) => s.turns > 0);
  return events;
}

/** Remove all harmful effects (used by cleanse / cure abilities). */
export function cleanse(entity: Entity): StatusType[] {
  const removed: StatusType[] = [];
  entity.statuses = entity.statuses.filter((s) => {
    if (STATUS_META[s.type].good) return true;
    removed.push(s.type);
    return false;
  });
  return removed;
}

/** A compact "中毒3 易伤2" strip for the HUD (empty string when clean). */
export function statusStrip(entity: Entity): string {
  return entity.statuses.map((s) => `${STATUS_META[s.type].tag}${s.turns}`).join(' ');
}

/** Full status names + remaining turns for the character panel (e.g. "中毒 3 回合"). */
export function statusDetails(entity: Entity): string[] {
  return entity.statuses.map((s) => `${STATUS_META[s.type].name} ${s.turns} 回合`);
}

// --- persistence (0.3) ---------------------------------------------------

/**
 * Serialized form of a status for the save. `turns` is written as `duration`;
 * `source` is reserved for a future originator id (never required on load).
 */
export interface SerializedStatus {
  type: StatusType;
  duration: number;
  power?: number;
  source?: string;
}

/** Capture an entity's live statuses for the save (player + every monster). */
export function serializeStatuses(entity: Entity): SerializedStatus[] {
  return entity.statuses.map((s) => ({ type: s.type, duration: s.turns, power: s.power }));
}

/**
 * Rebuild a status list from a save. Tolerant by contract so a corrupt, partial or
 * future save can never crash a load: a missing list yields none, an unknown `type`
 * is skipped with a warning, expired (<=0 turn) entries are dropped, and a dangling
 * `source` is simply ignored.
 */
export function restoreStatuses(list?: SerializedStatus[] | null): StatusInstance[] {
  if (!Array.isArray(list)) return [];
  const out: StatusInstance[] = [];
  for (const s of list) {
    if (!s || !(s.type in STATUS_META)) {
      console.warn('[零环] 跳过未知状态：', s && (s as { type?: unknown }).type);
      continue;
    }
    const turns = Math.max(0, Math.floor(s.duration ?? 0));
    if (turns <= 0) continue;
    out.push({ type: s.type, turns, power: Math.max(1, Math.floor(s.power ?? 1)) });
  }
  return out;
}
