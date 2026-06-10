import type { RNG } from '../core/RNG';
import { spawnPool } from '../data/monsters';
import { rollFloorItem } from '../systems/LootSystem';
import { applyRoomTemplates, type SpecialRoom, type TemplateContext } from './RoomTemplates';

/** Logical tile kinds. Values double as a stable id; rendering maps them to art. */
export enum TileType {
  Wall,
  Floor,
  Door, // an open doorway (passable, see-through)
  StairsDown,
  Trap, // a *revealed* trap marker (hidden traps live in DungeonMap.traps)
  Chest,
  ChestOpen,
  DoorClosed, // closed door: blocks movement + sight until opened (0.2)
  DoorLocked, // locked door: needs a key or a kick (0.2)
}

/** Maps each tile to a key in the generated `tiles` spritesheet (see atlas). */
export const TILE_SPRITE_KEY: Record<TileType, string> = {
  [TileType.Wall]: 'wall',
  [TileType.Floor]: 'floor',
  [TileType.Door]: 'door',
  [TileType.StairsDown]: 'stairs',
  [TileType.Trap]: 'trap',
  [TileType.Chest]: 'chest',
  [TileType.ChestOpen]: 'chest',
  [TileType.DoorClosed]: 'door',
  [TileType.DoorLocked]: 'door',
};

/** Closed and locked doors block movement; open doors and floors do not. */
export function isWalkable(type: TileType): boolean {
  return type !== TileType.Wall && type !== TileType.DoorClosed && type !== TileType.DoorLocked;
}

/** Walls and shut doors stop sight and projectiles. */
export function blocksSight(type: TileType): boolean {
  return type === TileType.Wall || type === TileType.DoorClosed || type === TileType.DoorLocked;
}

export function isClosedDoor(type: TileType): boolean {
  return type === TileType.DoorClosed || type === TileType.DoorLocked;
}

/** The kinds of trap a floor can hide (req. phase 7). */
export type TrapKind = 'spike' | 'poison' | 'teleport' | 'snare';

export interface TrapInstance {
  x: number;
  y: number;
  kind: TrapKind;
  /** Hidden traps are invisible until searched, illuminated, or triggered. */
  hidden: boolean;
}

/** A lockable / trappable chest, decoupled from the tile grid (req. phase 7 / 0.3). */
export interface ChestInstance {
  x: number;
  y: number;
  opened: boolean;
  locked: boolean;
  /** Hides a trap until it is sprung or disarmed. */
  trapped: boolean;
  /** Set once 检查 / 灯火 has revealed whether (and what) this chest is trapped (0.3). */
  trapDiscovered?: boolean;
  /** Which trap it springs — rolled at generation so 检查 can name it (0.3). */
  trapType?: TrapKind;
  /** Guards against producing loot twice (0.3). */
  lootGenerated?: boolean;
  /** A 石龛 altar (phase 6) — bumping it opens a bless/curse gamble, not the loot menu. */
  altar?: boolean;
}

export interface Vec {
  x: number;
  y: number;
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** A monster or item sitting on a floor tile (key references the sprite atlas). */
export interface MapEntity {
  x: number;
  y: number;
  key: string;
}

export interface DungeonMap {
  width: number;
  height: number;
  /** Row-major grid: tiles[y][x]. */
  tiles: TileType[][];
  rooms: Room[];
  /** Player start (centre of the first room). */
  spawn: Vec;
  /** Down-stairs location (centre of a far room). */
  stairsDown: Vec;
  /** Fog-of-war state, parallel to `tiles`. `visible` is recomputed each turn. */
  explored: boolean[][];
  visible: boolean[][];
  monsters: MapEntity[];
  items: MapEntity[];
  /** Hidden / revealed traps, decoupled from the tile grid (0.2). */
  traps: TrapInstance[];
  /** Interactive chests with lock / trap state (0.2). */
  chests: ChestInstance[];
  /** Themed special rooms (phase 6) — used for one-time ambiance logs on entry. */
  specialRooms?: SpecialRoom[];
  /** Where the merchant-vault template wants the merchant (else the scene picks). */
  merchantHint?: Vec;
  /** The merchant-vault flag — richer, pricier stock (phase 6). */
  merchantVault?: boolean;
}


export const MAP_W = 40;
export const MAP_H = 40;

/** The run spans this many floors; the final floor holds the boss. */
export const MAX_DEPTH = 5;

const MIN_ROOMS = 8;
const MAX_ROOMS = 12;

/**
 * Generate a floor with randomly placed, non-overlapping rooms joined by
 * L-shaped corridors. The chain of corridors guarantees every room is reachable.
 * Doors are punched where corridors meet a room wall; the player spawns in the
 * first room and the down-stairs sit in the room farthest from it.
 */
export function generateDungeon(depth: number, rng: RNG): DungeonMap {
  const width = MAP_W;
  const height = MAP_H;
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = new Array(width).fill(TileType.Wall);
    tiles.push(row);
  }

  const rooms: Room[] = [];
  const target = rng.range(MIN_ROOMS, MAX_ROOMS);
  let attempts = 0;
  while (rooms.length < target && attempts < 400) {
    attempts++;
    const w = rng.range(5, 9);
    const h = rng.range(4, 7);
    const x = rng.range(1, width - w - 1);
    const y = rng.range(1, height - h - 1);
    const room: Room = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
    if (rooms.some((r) => overlaps(room, r))) continue;
    rooms.push(room);
    carveRect(tiles, x, y, w, h);
  }

  // Connect each room to the previous one — a chain spanning all rooms.
  for (let i = 1; i < rooms.length; i++) {
    connect(tiles, rooms[i - 1], rooms[i], rng);
  }

  // Punch doors where corridors pierce a room's wall ring.
  for (const r of rooms) placeDoors(tiles, r, rng);

  // Spawn in the first room; stairs in the room farthest from spawn.
  const spawn: Vec = { x: rooms[0].cx, y: rooms[0].cy };
  let far = rooms[0];
  let bestD = -1;
  for (const r of rooms) {
    const d = (r.cx - spawn.x) ** 2 + (r.cy - spawn.y) ** 2;
    if (d > bestD) {
      bestD = d;
      far = r;
    }
  }
  const stairsDown: Vec = { x: far.cx, y: far.cy };
  tiles[stairsDown.y][stairsDown.x] = TileType.StairsDown;
  const stairsRoomIndex = rooms.indexOf(far);

  // Object lists start empty so special-room templates can seed themed content
  // first; the usual loot then scatters over the rooms templates did NOT claim.
  const traps: TrapInstance[] = [];
  const chests: ChestInstance[] = [];
  const monsters: MapEntity[] = [];
  const items: MapEntity[] = [];

  const ctx: TemplateContext = {
    tiles, traps, chests, monsters, items,
    spawn, stairs: stairsDown, depth, rng, width, height,
  };
  const { claimed, specialRooms } = applyRoomTemplates(rooms, stairsRoomIndex, ctx);

  // Open floor cells in *unclaimed* rooms (never spawn / stairs) take the scatter.
  const open: Vec[] = [];
  for (const r of rooms) {
    if (claimed.has(r)) continue;
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        if (tiles[yy][xx] !== TileType.Floor) continue;
        if (xx === spawn.x && yy === spawn.y) continue;
        open.push({ x: xx, y: yy });
      }
    }
  }
  rng.shuffle(open);
  let cursor = 0;
  // Hidden traps live in their own list; the tile underneath stays floor so the
  // trap is invisible until searched / triggered (req. phase 7).
  const trapKinds: TrapKind[] = ['spike', 'poison', 'teleport', 'snare'];
  const trapCount = rng.range(4, 7);
  for (let i = 0; i < trapCount && cursor < open.length; i++, cursor++) {
    traps.push({ x: open[cursor].x, y: open[cursor].y, kind: rng.pick(trapKinds), hidden: true });
  }
  const chestCount = rng.range(3, 5);
  for (let i = 0; i < chestCount && cursor < open.length; i++, cursor++) {
    const c = open[cursor];
    tiles[c.y][c.x] = TileType.Chest;
    const trapped = rng.chance(0.3);
    chests.push({
      x: c.x,
      y: c.y,
      opened: false,
      locked: rng.chance(0.3),
      trapped,
      // The kind is rolled now so 检查 can reveal it deterministically per seed.
      trapType: trapped ? rng.pick(['spike', 'poison', 'snare', 'teleport'] as TrapKind[]) : undefined,
    });
  }

  // Remaining open floor cells host monsters and item pickups.
  const pool = spawnPool(depth);
  const monsterCount = rng.range(6, 10);
  for (let i = 0; i < monsterCount && cursor < open.length; i++, cursor++) {
    monsters.push({ x: open[cursor].x, y: open[cursor].y, key: rng.pick(pool) });
  }
  const itemCount = rng.range(5, 8);
  for (let i = 0; i < itemCount && cursor < open.length; i++, cursor++) {
    items.push({ x: open[cursor].x, y: open[cursor].y, key: rollFloorItem(depth, rng) });
  }

  // Safety: the stairs must stay reachable (doors count as passable — the player can
  // open / kick them). Templates never carve walls, so this always holds; it guards
  // against a future template accidentally sealing the floor.
  if (!stairsReachable(tiles, spawn, stairsDown, width, height)) {
    console.warn('[零环] 特殊房间可能影响了连通性（已忽略）。');
  }

  // Fog-of-war state, all hidden until explored.
  const explored: boolean[][] = [];
  const visible: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    explored.push(new Array(width).fill(false));
    visible.push(new Array(width).fill(false));
  }

  return {
    width, height, tiles, rooms, spawn, stairsDown, explored, visible,
    monsters, items, traps, chests,
    specialRooms, merchantHint: ctx.merchantHint, merchantVault: ctx.merchantVault,
  };
}

/** Flood-fill reachability over non-wall tiles (doors / chests count as passable). */
function stairsReachable(tiles: TileType[][], from: Vec, to: Vec, width: number, height: number): boolean {
  const seen = new Set<number>([from.y * width + from.x]);
  const queue: Vec[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur.x === to.x && cur.y === to.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const k = ny * width + nx;
      if (seen.has(k) || tiles[ny][nx] === TileType.Wall) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

function overlaps(a: Room, b: Room): boolean {
  // Expand by one tile so rooms never touch (keeps wall separators + doorways).
  return (
    a.x <= b.x + b.w &&
    a.x + a.w >= b.x - 1 &&
    a.y <= b.y + b.h &&
    a.y + a.h >= b.y - 1
  );
}

function carveRect(tiles: TileType[][], x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) tiles[j][i] = TileType.Floor;
  }
}

function connect(tiles: TileType[][], a: Room, b: Room, rng: RNG): void {
  if (rng.chance(0.5)) {
    carveH(tiles, a.cy, a.cx, b.cx);
    carveV(tiles, b.cx, a.cy, b.cy);
  } else {
    carveV(tiles, a.cx, a.cy, b.cy);
    carveH(tiles, b.cy, a.cx, b.cx);
  }
}

function carveH(tiles: TileType[][], y: number, x1: number, x2: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    if (tiles[y][x] === TileType.Wall) tiles[y][x] = TileType.Floor;
  }
}

function carveV(tiles: TileType[][], x: number, y1: number, y2: number): void {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    if (tiles[y][x] === TileType.Wall) tiles[y][x] = TileType.Floor;
  }
}

/**
 * Punch doors where a corridor genuinely *pierces* a room's wall ring — a single
 * one-tile gap with the wall continuing on both sides. Cells where a corridor
 * merely runs alongside the wall (gap has floor neighbours) are left as open
 * floor, which avoids long meaningless runs of doors (0.2 fix). Most doors start
 * closed, a few locked, the rest already open.
 */
function placeDoors(tiles: TileType[][], r: Room, rng: RNG): void {
  const h = tiles.length;
  const w = tiles[0].length;
  const isWall = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && tiles[y][x] === TileType.Wall;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const onVert = x === r.x - 1 || x === r.x + r.w;
      const onHorz = y === r.y - 1 || y === r.y + r.h;
      // Only true edge cells, never the four corners.
      if (onVert === onHorz) continue;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (tiles[y][x] !== TileType.Floor) continue;
      // A real doorway is a one-tile gap: the wall must continue to either side
      // (above/below for a vertical wall, left/right for a horizontal one).
      const isGap = onVert ? isWall(x, y - 1) && isWall(x, y + 1) : isWall(x - 1, y) && isWall(x + 1, y);
      if (!isGap) continue;
      // Doors start shut (you open them as you explore); a few are locked.
      tiles[y][x] = rng.chance(0.12) ? TileType.DoorLocked : TileType.DoorClosed;
    }
  }
}
