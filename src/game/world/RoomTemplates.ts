import type { RNG } from '../core/RNG';
import { rollFloorItem } from '../systems/LootSystem';
import { spawnPool } from '../data/monsters';
import {
  TileType,
  type ChestInstance,
  type MapEntity,
  type Room,
  type TrapInstance,
  type TrapKind,
  type Vec,
} from './Dungeon';

/**
 * Lightweight special-room templates (0.3 phase 6). After the normal floor is
 * generated, a couple of (non-spawn, non-stairs) rooms are "claimed" and themed by
 * a template — a deliberate *combination of existing systems* (chests, traps,
 * monster traits, doors, the merchant) rather than bespoke logic. Templates only
 * add objects on existing floor and may shut/lock a room's doors; they never carve
 * walls or touch the spawn / stairs room, so the floor stays connected (the player
 * can open or kick any door). A template that can't fit returns false and is skipped.
 */

/** Everything a template may read / mutate while theming a room. */
export interface TemplateContext {
  tiles: TileType[][];
  traps: TrapInstance[];
  chests: ChestInstance[];
  monsters: MapEntity[];
  items: MapEntity[];
  spawn: Vec;
  stairs: Vec;
  depth: number;
  rng: RNG;
  width: number;
  height: number;
  /** Set by the merchant-vault template; the scene places the merchant here. */
  merchantHint?: Vec;
  /** Set by the merchant-vault template; the scene stocks pricier, better wares. */
  merchantVault?: boolean;
}

export interface RoomTemplate {
  id: string;
  name: string;
  minFloor?: number;
  maxFloor?: number;
  weight: number;
  /** One atmosphere line logged once on entry — a hint, never the full layout. */
  ambiance: string;
  /** Theme the room; return false if it can't be applied (caller then skips it). */
  apply(room: Room, ctx: TemplateContext): boolean;
}

export interface SpecialRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  ambiance: string;
}

// --- helpers -------------------------------------------------------------

const cheb = (a: Vec, b: Vec): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function occupied(x: number, y: number, ctx: TemplateContext): boolean {
  return (
    ctx.chests.some((c) => c.x === x && c.y === y) ||
    ctx.monsters.some((m) => m.x === x && m.y === y) ||
    ctx.items.some((i) => i.x === x && i.y === y) ||
    ctx.traps.some((t) => t.x === x && t.y === y)
  );
}

/** Free, unclaimed floor cells inside a room (shuffled), excluding spawn / stairs. */
function freeCells(room: Room, ctx: TemplateContext): Vec[] {
  const out: Vec[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (ctx.tiles[y][x] !== TileType.Floor) continue;
      if (x === ctx.spawn.x && y === ctx.spawn.y) continue;
      if (x === ctx.stairs.x && y === ctx.stairs.y) continue;
      if (occupied(x, y, ctx)) continue;
      out.push({ x, y });
    }
  }
  ctx.rng.shuffle(out);
  return out;
}

function placeChest(c: Vec, ctx: TemplateContext, opts: Partial<ChestInstance>): void {
  ctx.tiles[c.y][c.x] = TileType.Chest;
  ctx.chests.push({ x: c.x, y: c.y, opened: false, locked: false, trapped: false, ...opts });
}

/** Shut (and maybe lock) every doorway in a room's wall ring. */
function shutRoomDoors(room: Room, ctx: TemplateContext, lockProb: number): void {
  const { tiles, width, height } = ctx;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const onVert = x === room.x - 1 || x === room.x + room.w;
      const onHorz = y === room.y - 1 || y === room.y + room.h;
      if (onVert === onHorz) continue; // edge cells only, never corners
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const t = tiles[y][x];
      if (t === TileType.Door || t === TileType.DoorClosed || t === TileType.DoorLocked) {
        tiles[y][x] = ctx.rng.chance(lockProb) ? TileType.DoorLocked : TileType.DoorClosed;
      }
    }
  }
}

function farthestFromSpawn(cells: Vec[], spawn: Vec): Vec {
  return cells.reduce((best, c) =>
    (c.x - spawn.x) ** 2 + (c.y - spawn.y) ** 2 > (best.x - spawn.x) ** 2 + (best.y - spawn.y) ** 2 ? c : best,
  cells[0]);
}

// --- the six templates ---------------------------------------------------

export const TEMPLATES: readonly RoomTemplate[] = [
  {
    id: 'lockbox',
    name: '锁箱房',
    minFloor: 2,
    weight: 10,
    ambiance: '空气里有铁锈和旧锁的味道。',
    apply(room, ctx) {
      const cells = freeCells(room, ctx);
      if (cells.length < 2) return false;
      const spot = cells[0];
      const trapped = ctx.rng.chance(0.6);
      placeChest(spot, ctx, {
        locked: ctx.rng.chance(0.8),
        trapped,
        trapType: trapped ? ctx.rng.pick(['spike', 'poison', 'snare', 'teleport'] as TrapKind[]) : undefined,
      });
      // A treasure-guard posts up next to the chest (buildMonsters anchors it there).
      const guardSpots = cells.slice(1).filter((p) => cheb(p, spot) <= 2);
      const g = guardSpots[0] ?? cells[1];
      if (g) ctx.monsters.push({ x: g.x, y: g.y, key: 'ironmask' });
      shutRoomDoors(room, ctx, 0.5);
      return true;
    },
  },
  {
    id: 'trapcorridor',
    name: '陷阱回廊',
    minFloor: 1,
    weight: 10,
    ambiance: '地面石缝排列得过于整齐。',
    apply(room, ctx) {
      const cells = freeCells(room, ctx);
      if (cells.length < 4) return false;
      // Reward at the far end; a band of hidden traps guards the approach.
      const reward = farthestFromSpawn(cells, ctx.spawn);
      ctx.items.push({ x: reward.x, y: reward.y, key: rollFloorItem(ctx.depth, ctx.rng) });
      const rest = cells.filter((c) => c !== reward);
      const trapN = Math.min(rest.length, ctx.rng.range(2, 4));
      const trapped = new Set<Vec>();
      for (let i = 0; i < trapN; i++) {
        const t = rest[i];
        trapped.add(t);
        ctx.traps.push({ x: t.x, y: t.y, kind: ctx.rng.pick(['spike', 'poison', 'snare'] as TrapKind[]), hidden: true });
      }
      const free = rest.filter((c) => !trapped.has(c));
      if (free.length) {
        ctx.monsters.push({ x: free[0].x, y: free[0].y, key: ctx.depth >= 3 ? 'whisperorb' : 'mossarcher' });
      }
      return true;
    },
  },
  {
    id: 'saltwell',
    name: '盐井房',
    minFloor: 2,
    weight: 8,
    ambiance: '盐霜在墙根聚成细小的环。',
    apply(room, ctx) {
      const cells = freeCells(room, ctx);
      if (cells.length < 4) return false;
      const trapN = Math.min(cells.length - 2, ctx.rng.range(3, 5));
      for (let i = 0; i < trapN; i++) {
        ctx.traps.push({ x: cells[i].x, y: cells[i].y, kind: ctx.rng.chance(0.6) ? 'poison' : 'snare', hidden: true });
      }
      const m = cells[trapN];
      if (m) ctx.monsters.push({ x: m.x, y: m.y, key: ctx.rng.chance(0.5) ? 'saltshade' : 'bonehound' });
      const bait = cells[trapN + 1];
      if (bait) ctx.items.push({ x: bait.x, y: bait.y, key: ctx.rng.chance(0.5) ? 'azure_potion' : 'heal_potion' });
      return true;
    },
  },
  {
    id: 'lampnest',
    name: '余烬巢',
    minFloor: 2,
    weight: 8,
    ambiance: '空气里浮着不安分的余烬微光。',
    apply(room, ctx) {
      const cells = freeCells(room, ctx);
      if (cells.length < 3) return false;
      const moths = Math.min(cells.length - 1, ctx.rng.range(1, 3));
      for (let i = 0; i < moths; i++) ctx.monsters.push({ x: cells[i].x, y: cells[i].y, key: 'lampmoth' });
      // Something to catch the blast: a co-located foe or a chest you can chain-pop.
      const extra = cells[moths];
      if (extra) {
        if (ctx.rng.chance(0.5)) ctx.monsters.push({ x: extra.x, y: extra.y, key: ctx.rng.pick(spawnPool(ctx.depth)) });
        else placeChest(extra, ctx, {});
      }
      return true;
    },
  },
  {
    id: 'altar',
    name: '石龛房',
    minFloor: 1,
    weight: 6,
    ambiance: '房间中央立着一方古旧的石龛，隐隐渗出微光。',
    apply(room, ctx) {
      const cells = freeCells(room, ctx);
      if (!cells.length) return false;
      // Prefer the room centre; fall back to any free cell.
      const centre = cells.find((c) => c.x === room.cx && c.y === room.cy) ?? cells[0];
      placeChest(centre, ctx, { altar: true });
      return true;
    },
  },
  {
    id: 'merchantvault',
    name: '商人密室',
    minFloor: 2,
    maxFloor: 4,
    weight: 6,
    ambiance: '门后透出微光，似乎有人在此囤积奇货。',
    apply(room, ctx) {
      if (ctx.merchantHint) return false; // at most one vault per floor
      const cx = room.cx;
      const cy = room.cy;
      if (ctx.tiles[cy][cx] !== TileType.Floor || occupied(cx, cy, ctx)) return false;
      ctx.merchantHint = { x: cx, y: cy };
      ctx.merchantVault = true;
      shutRoomDoors(room, ctx, 1); // a true 密室 — locked
      return true;
    },
  },
] as const;

function tooCloseToSpawn(room: Room, spawn: Vec): boolean {
  return Math.abs(room.cx - spawn.x) + Math.abs(room.cy - spawn.y) < 14;
}

function weightedPick(list: RoomTemplate[], rng: RNG): RoomTemplate | null {
  if (!list.length) return null;
  let total = 0;
  for (const t of list) total += t.weight;
  let r = rng.next() * total;
  for (const t of list) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return list[list.length - 1];
}

/**
 * Claim 0–2 eligible rooms and theme them. Returns the claimed rooms (so the caller
 * skips them when scattering the usual loot) and the entered-ambiance list. Never
 * touches the spawn room or the stairs room. Any template error is swallowed.
 */
export function applyRoomTemplates(
  rooms: Room[],
  stairsRoomIndex: number,
  ctx: TemplateContext,
): { claimed: Set<Room>; specialRooms: SpecialRoom[] } {
  const claimed = new Set<Room>();
  const specialRooms: SpecialRoom[] = [];
  const eligible = rooms.filter((_, i) => i !== 0 && i !== stairsRoomIndex);
  ctx.rng.shuffle(eligible);

  const want = ctx.rng.chance(0.85) ? ctx.rng.range(1, 2) : 0;
  let placed = 0;
  for (const room of eligible) {
    if (placed >= want) break;
    const cands = TEMPLATES.filter(
      (t) =>
        ctx.depth >= (t.minFloor ?? 1) &&
        ctx.depth <= (t.maxFloor ?? 99) &&
        // The 余烬巢 must not sit on the player's doorstep (req. balance).
        !(t.id === 'lampnest' && tooCloseToSpawn(room, ctx.spawn)),
    );
    const tmpl = weightedPick([...cands], ctx.rng);
    if (!tmpl) continue;
    try {
      if (tmpl.apply(room, ctx)) {
        claimed.add(room);
        specialRooms.push({ x: room.x, y: room.y, w: room.w, h: room.h, ambiance: tmpl.ambiance });
        placed++;
      }
    } catch {
      // A template that throws is simply skipped — generation never crashes.
    }
  }
  return { claimed, specialRooms };
}
