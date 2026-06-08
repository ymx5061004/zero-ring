import type { RNG } from '../core/RNG';
import { spawnPool } from '../data/monsters';
import { rollFloorItem } from '../systems/LootSystem';

/** Logical tile kinds. Values double as a stable id; rendering maps them to art. */
export enum TileType {
  Wall,
  Floor,
  Door,
  StairsDown,
  Trap,
  Chest,
  ChestOpen,
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
};

/** Only walls block movement; doors and everything else can be entered. */
export function isWalkable(type: TileType): boolean {
  return type !== TileType.Wall;
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
  for (const r of rooms) placeDoors(tiles, r);

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

  // Scatter traps and chests on open floor (never on spawn or stairs).
  const open: Vec[] = [];
  for (const r of rooms) {
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
  const trapCount = rng.range(4, 7);
  const chestCount = rng.range(3, 5);
  for (let i = 0; i < trapCount && cursor < open.length; i++, cursor++) {
    tiles[open[cursor].y][open[cursor].x] = TileType.Trap;
  }
  for (let i = 0; i < chestCount && cursor < open.length; i++, cursor++) {
    tiles[open[cursor].y][open[cursor].x] = TileType.Chest;
  }

  // Remaining open floor cells host (decorative) monsters and item pickups.
  const monsters: MapEntity[] = [];
  const items: MapEntity[] = [];
  const pool = spawnPool(depth);
  const monsterCount = rng.range(6, 10);
  for (let i = 0; i < monsterCount && cursor < open.length; i++, cursor++) {
    monsters.push({ x: open[cursor].x, y: open[cursor].y, key: rng.pick(pool) });
  }
  const itemCount = rng.range(5, 8);
  for (let i = 0; i < itemCount && cursor < open.length; i++, cursor++) {
    items.push({ x: open[cursor].x, y: open[cursor].y, key: rollFloorItem(depth, rng) });
  }

  // Fog-of-war state, all hidden until explored.
  const explored: boolean[][] = [];
  const visible: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    explored.push(new Array(width).fill(false));
    visible.push(new Array(width).fill(false));
  }

  return { width, height, tiles, rooms, spawn, stairsDown, explored, visible, monsters, items };
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

/** Any corridor-carved floor cell on the room's surrounding ring becomes a door. */
function placeDoors(tiles: TileType[][], r: Room): void {
  const h = tiles.length;
  const w = tiles[0].length;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const onBorder = x === r.x - 1 || x === r.x + r.w || y === r.y - 1 || y === r.y + r.h;
      if (!onBorder || x < 0 || y < 0 || x >= w || y >= h) continue;
      if (tiles[y][x] === TileType.Floor) tiles[y][x] = TileType.Door;
    }
  }
}
