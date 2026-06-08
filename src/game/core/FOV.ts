/**
 * Field of view via recursive shadowcasting (the classic roguelike algorithm).
 *
 * It visits only the cells within `radius` — roughly πr² ≈ 200 cells for r=8 —
 * so it is cheap enough to recompute every step on mobile. Walls (anything for
 * which `blocksSight` is true) cast shadows that hide the cells behind them.
 *
 * The module is deliberately decoupled from the dungeon: callers provide a tiny
 * `FOVMap` adapter and a `markVisible` callback.
 */

export interface FOVMap {
  width: number;
  height: number;
  /** True if the tile at (x, y) stops sight (a wall, or out of bounds). */
  blocksSight(x: number, y: number): boolean;
}

// Per-octant coordinate-transform multipliers (xx, xy, yx, yy).
const MULT_XX = [1, 0, 0, -1, -1, 0, 0, 1];
const MULT_XY = [0, 1, -1, 0, 0, -1, 1, 0];
const MULT_YX = [0, 1, 1, 0, 0, -1, -1, 0];
const MULT_YY = [1, 0, 0, 1, -1, 0, 0, -1];

/** Compute visible cells from (originX, originY); each is reported via markVisible. */
export function computeFOV(
  map: FOVMap,
  originX: number,
  originY: number,
  radius: number,
  markVisible: (x: number, y: number) => void,
): void {
  markVisible(originX, originY);
  for (let octant = 0; octant < 8; octant++) {
    castLight(
      map,
      originX,
      originY,
      1,
      1.0,
      0.0,
      radius,
      MULT_XX[octant],
      MULT_XY[octant],
      MULT_YX[octant],
      MULT_YY[octant],
      markVisible,
    );
  }
}

function castLight(
  map: FOVMap,
  cx: number,
  cy: number,
  row: number,
  startSlope: number,
  endSlope: number,
  radius: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  markVisible: (x: number, y: number) => void,
): void {
  if (startSlope < endSlope) return;
  const radius2 = radius * radius;
  let nextStart = startSlope;

  for (let i = row; i <= radius; i++) {
    let dx = -i - 1;
    const dy = -i;
    let blocked = false;

    while (dx <= 0) {
      dx += 1;
      const mapX = cx + dx * xx + dy * xy;
      const mapY = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);

      if (startSlope < rSlope) continue;
      if (endSlope > lSlope) break;

      if (dx * dx + dy * dy < radius2) markVisible(mapX, mapY);

      if (blocked) {
        if (map.blocksSight(mapX, mapY)) {
          nextStart = rSlope;
          continue;
        }
        blocked = false;
        startSlope = nextStart;
      } else if (map.blocksSight(mapX, mapY) && i < radius) {
        // A blocking tile in open light starts a recursive child scan.
        blocked = true;
        castLight(map, cx, cy, i + 1, startSlope, lSlope, radius, xx, xy, yx, yy, markVisible);
        nextStart = rSlope;
      }
    }

    if (blocked) break;
  }
}
