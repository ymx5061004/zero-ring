import type { Vec } from './Dungeon';

/**
 * Line-of-sight + ray helpers shared by ranged attacks (player and monsters) and
 * targeted skills. Uses a Bresenham line so a shot can never thread through a wall
 * or a closed door — the caller supplies a `blocks` predicate that is true for any
 * tile that stops a projectile / sight.
 */

/** Bresenham cells from (x0,y0) to (x1,y1) inclusive of both endpoints. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Vec[] {
  const cells: Vec[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  // Guard against pathological inputs.
  for (let guard = 0; guard < 512; guard++) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/**
 * True when nothing blocks sight strictly between the two tiles (the endpoints
 * themselves are not tested, so you can see/shoot the wall-adjacent target).
 */
export function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  blocks: (x: number, y: number) => boolean,
): boolean {
  const cells = lineCells(x0, y0, x1, y1);
  for (let i = 1; i < cells.length - 1; i++) {
    if (blocks(cells[i].x, cells[i].y)) return false;
  }
  return true;
}
