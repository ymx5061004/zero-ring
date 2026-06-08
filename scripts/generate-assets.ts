/**
 * 《零环》 original pixel-art generator.
 *
 * Produces all spritesheets for the game procedurally — every pixel is computed
 * here, no external/imported art. Run with Node (no extra deps required):
 *
 *     node scripts/generate-assets.ts
 *
 * Output: public/assets/generated/{heroes,monsters,tiles,items,effects}.png
 *         public/assets/generated/atlas.json   (frame index manifest)
 *
 * The file is written in "erasable" TypeScript so Node's built-in type stripping
 * runs it directly (no enums / namespaces / parameter-properties).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
function rgb(hex: number): RGBA {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255];
}
function rgba(hex: number, a: number): RGBA {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, a];
}
/** Shift brightness by a signed delta (keeps alpha). */
function shade(c: RGBA, d: number): RGBA {
  return [clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d), c[3]];
}

const OUTLINE: RGBA = rgb(0x15131c);
const EYE: RGBA = rgb(0x20161f);
const WHITE: RGBA = rgb(0xf4f0ea);

// Small deterministic RNG so regenerating yields identical bytes.
let RNG = 0x9e3779b9 >>> 0;
function rnd(): number {
  RNG = (RNG + 0x6d2b79f5) >>> 0;
  let t = RNG;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Pixel canvas
// ---------------------------------------------------------------------------

class Canvas {
  w: number;
  h: number;
  data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  /** Source-over a colour onto a pixel. */
  set(x: number, y: number, c: RGBA): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = c[3];
    if (a <= 0) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    const sa = a / 255;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) {
      this.data[i + 3] = 0;
      return;
    }
    this.data[i] = Math.round((c[0] * sa + this.data[i] * da * (1 - sa)) / oa);
    this.data[i + 1] = Math.round((c[1] * sa + this.data[i + 1] * da * (1 - sa)) / oa);
    this.data[i + 2] = Math.round((c[2] * sa + this.data[i + 2] * da * (1 - sa)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }
  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  clearPixel(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0;
  }
  /** Copy another canvas onto this one at an offset (overwrite, skip empty). */
  blit(src: Canvas, ox: number, oy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const si = (y * src.w + x) * 4;
        if (src.data[si + 3] === 0) continue;
        const di = ((oy + y) * this.w + (ox + x)) * 4;
        this.data[di] = src.data[si];
        this.data[di + 1] = src.data[si + 1];
        this.data[di + 2] = src.data[si + 2];
        this.data[di + 3] = src.data[si + 3];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives (operate in a frame's local 0..size coords)
// ---------------------------------------------------------------------------

function fill(c: Canvas, x: number, y: number, w: number, h: number, col: RGBA): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.set(x + i, y + j, col);
}
function hLine(c: Canvas, x: number, y: number, w: number, col: RGBA): void {
  for (let i = 0; i < w; i++) c.set(x + i, y, col);
}
function vLine(c: Canvas, x: number, y: number, h: number, col: RGBA): void {
  for (let j = 0; j < h; j++) c.set(x, y + j, col);
}
function rectLine(c: Canvas, x: number, y: number, w: number, h: number, col: RGBA): void {
  hLine(c, x, y, w, col);
  hLine(c, x, y + h - 1, w, col);
  vLine(c, x, y, h, col);
  vLine(c, x + w - 1, y, h, col);
}
function disc(c: Canvas, cx: number, cy: number, r: number, col: RGBA): void {
  const r2 = r * r;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) c.set(cx + x, cy + y, col);
}
function ringPx(c: Canvas, cx: number, cy: number, r: number, col: RGBA): void {
  const ro = r * r;
  const ri = (r - 1) * (r - 1);
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d <= ro && d > ri) c.set(cx + x, cy + y, col);
    }
}
function ellipse(c: Canvas, cx: number, cy: number, rx: number, ry: number, col: RGBA): void {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) c.set(cx + x, cy + y, col);
}
function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}
function triFill(
  c: Canvas,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  col: RGBA,
): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const w0 = edge(bx, by, cx, cy, x, y);
      const w1 = edge(cx, cy, ax, ay, x, y);
      const w2 = edge(ax, ay, bx, by, x, y);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) c.set(x, y, col);
    }
}
function lineThin(c: Canvas, x0: number, y0: number, x1: number, y1: number, col: RGBA): void {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1;
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    c.set(x0, y0, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** Add a 1px outline of `col` around every opaque cluster. */
function outline(c: Canvas, col: RGBA): void {
  const pts: number[] = [];
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      if (c.alphaAt(x, y) !== 0) continue;
      if (
        c.alphaAt(x - 1, y) > 0 ||
        c.alphaAt(x + 1, y) > 0 ||
        c.alphaAt(x, y - 1) > 0 ||
        c.alphaAt(x, y + 1) > 0
      ) {
        pts.push(x, y);
      }
    }
  for (let i = 0; i < pts.length; i += 2) c.set(pts[i], pts[i + 1], col);
}
/** Lighten the top edge / darken the bottom edge of a filled box for volume. */
function volumize(c: Canvas, x: number, y: number, w: number, h: number, light: RGBA, dark: RGBA): void {
  hLine(c, x, y, w, light);
  hLine(c, x, y + h - 1, w, dark);
  vLine(c, x + w - 1, y + 1, h - 2, dark);
}

// ---------------------------------------------------------------------------
// Heroes — a parametric front-facing humanoid (head, body, weapon/feature)
// ---------------------------------------------------------------------------

type HeroFeature = 'sword' | 'bow' | 'staff' | 'dagger' | 'mace' | 'axe' | 'fist' | 'lute' | 'flask';
type HeroHat = 'none' | 'hood' | 'wizardhat' | 'cap' | 'bald' | 'plume';

type HeroStyle = {
  key: string;
  name: string;
  skin: RGBA;
  hair: RGBA;
  cloth: RGBA;
  cloth2: RGBA;
  metal: RGBA | null;
  feature: HeroFeature;
  hat: HeroHat;
  shield: boolean;
};

function drawHeroLeg(c: Canvas, x: number, top: number, h: number, pant: RGBA, boot: RGBA): void {
  fill(c, x, top, 3, h, pant);
  fill(c, x, top + h, 3, 2, boot);
  vLine(c, x, top, h, shade(pant, 16));
}

type WeaponPose = 'rest' | 'raise' | 'strike';
type HeroPose = {
  bob: number; // vertical body offset (breathing / footfall)
  lean: number; // horizontal shift of the upper body (lunge / recoil)
  legs: 'stand' | 'a' | 'b' | 'together';
  arm: number; // -1 | 0 | 1 swing
  weapon: WeaponPose;
  hurt: boolean;
};

// 9 frames per hero: idle×2, walk×4, attack×2, hurt×1.
const HERO_POSES: HeroPose[] = [
  { bob: 0, lean: 0, legs: 'stand', arm: 0, weapon: 'rest', hurt: false }, // idle 0
  { bob: 1, lean: 0, legs: 'stand', arm: 0, weapon: 'rest', hurt: false }, // idle 1
  { bob: 0, lean: 0, legs: 'a', arm: 1, weapon: 'rest', hurt: false }, // walk 0 (contact L)
  { bob: 1, lean: 0, legs: 'together', arm: 0, weapon: 'rest', hurt: false }, // walk 1 (passing)
  { bob: 0, lean: 0, legs: 'b', arm: -1, weapon: 'rest', hurt: false }, // walk 2 (contact R)
  { bob: 1, lean: 0, legs: 'together', arm: 0, weapon: 'rest', hurt: false }, // walk 3 (passing)
  { bob: 0, lean: -1, legs: 'stand', arm: 0, weapon: 'raise', hurt: false }, // attack 0 (wind-up)
  { bob: 0, lean: 2, legs: 'a', arm: 1, weapon: 'strike', hurt: false }, // attack 1 (strike)
  { bob: 1, lean: -3, legs: 'b', arm: 0, weapon: 'rest', hurt: true }, // hurt (recoil)
];

function legsFor(c: Canvas, mode: HeroPose['legs'], pant: RGBA, boot: RGBA): void {
  switch (mode) {
    case 'stand': drawHeroLeg(c, 12, 22, 6, pant, boot); drawHeroLeg(c, 17, 22, 6, pant, boot); break;
    case 'a': drawHeroLeg(c, 11, 22, 6, pant, boot); drawHeroLeg(c, 18, 23, 5, pant, boot); break;
    case 'b': drawHeroLeg(c, 13, 23, 5, pant, boot); drawHeroLeg(c, 20, 22, 6, pant, boot); break;
    case 'together': drawHeroLeg(c, 13, 22, 6, pant, boot); drawHeroLeg(c, 16, 22, 6, pant, boot); break;
  }
}

function drawHero(c: Canvas, s: HeroStyle, pose: HeroPose): void {
  const oy = pose.bob;
  const lx = pose.lean;
  const pant = shade(s.cloth, -38);
  const boot = shade(s.cloth2, -28);

  // ---- legs (feet planted; not shifted by lean) ----
  legsFor(c, pose.legs, pant, boot);

  // ---- torso ----
  const cl = s.cloth;
  fill(c, 11 + lx, 14 + oy, 10, 8, cl);
  volumize(c, 11 + lx, 14 + oy, 10, 8, shade(cl, 20), shade(cl, -30));
  hLine(c, 11 + lx, 20 + oy, 10, s.cloth2);
  hLine(c, 11 + lx, 21 + oy, 10, shade(s.cloth2, -24));
  vLine(c, 15 + lx, 15 + oy, 5, shade(cl, -30));
  if (s.metal) {
    const m = s.metal;
    fill(c, 12 + lx, 14 + oy, 8, 5, m);
    volumize(c, 12 + lx, 14 + oy, 8, 5, shade(m, 26), shade(m, -34));
    fill(c, 10 + lx, 14 + oy, 2, 2, m);
    fill(c, 20 + lx, 14 + oy, 2, 2, m);
    c.set(16 + lx, 16 + oy, s.cloth2);
  }

  // ---- arms (right arm follows the weapon during an attack) ----
  const sleeve = shade(cl, -14);
  let lY = 14 + oy;
  let rY = 14 + oy;
  if (pose.arm === 1) { lY = 13 + oy; rY = 15 + oy; }
  else if (pose.arm === -1) { lY = 15 + oy; rY = 13 + oy; }
  let rArmX = 21 + lx;
  if (pose.weapon === 'raise') rY = 10 + oy;
  else if (pose.weapon === 'strike') { rY = 15 + oy; rArmX = 22 + lx; }
  fill(c, 9 + lx, lY, 2, 6, sleeve);
  fill(c, 9 + lx, lY + 6, 2, 2, s.skin);
  fill(c, rArmX, rY, 2, 6, sleeve);
  fill(c, rArmX, rY + 6, 2, 2, s.skin);

  // ---- head ----
  const hx = 12 + lx;
  const hy = 6 + oy;
  fill(c, hx, hy, 8, 7, s.skin);
  hLine(c, hx, hy, 8, shade(s.skin, 18));
  vLine(c, hx + 7, hy + 1, 6, shade(s.skin, -28));
  hLine(c, hx, hy + 6, 8, shade(s.skin, -16));
  if (pose.hurt) {
    hLine(c, hx + 1, hy + 3, 2, EYE); // squinted, pained eyes
    hLine(c, hx + 5, hy + 3, 2, EYE);
  } else {
    c.set(hx + 2, hy + 3, EYE);
    c.set(hx + 5, hy + 3, EYE);
  }

  // ---- hat / hair ----
  switch (s.hat) {
    case 'none': {
      const h = s.hair;
      fill(c, hx - 1, hy - 2, 10, 3, h);
      hLine(c, hx - 1, hy - 2, 10, shade(h, 20));
      vLine(c, hx - 1, hy, 2, h);
      vLine(c, hx + 8, hy, 2, h);
      break;
    }
    case 'cap': {
      fill(c, hx, hy - 1, 8, 2, s.hair);
      fill(c, hx - 1, hy - 3, 10, 2, s.cloth);
      hLine(c, hx - 1, hy - 3, 10, shade(s.cloth, 22));
      triFill(c, hx + 8, hy - 3, hx + 8, hy - 7, hx + 12, hy - 6, rgb(0xe04a5a));
      break;
    }
    case 'hood': {
      const cln = s.cloth;
      fill(c, hx - 2, hy - 2, 12, 4, cln);
      vLine(c, hx - 2, hy + 2, 5, cln);
      vLine(c, hx - 1, hy + 2, 5, cln);
      vLine(c, hx + 9, hy + 2, 5, cln);
      vLine(c, hx + 8, hy + 2, 5, cln);
      hLine(c, hx - 2, hy - 2, 12, shade(cln, 18));
      hLine(c, hx + 1, hy + 1, 6, shade(cln, -26));
      break;
    }
    case 'wizardhat': {
      fill(c, hx, hy - 1, 8, 1, s.hair);
      triFill(c, 16, hy - 10, hx - 2, hy - 2, hx + 10, hy - 2, s.cloth);
      lineThin(c, 16, hy - 10, hx - 2, hy - 2, shade(s.cloth, 22));
      hLine(c, hx - 3, hy - 2, 14, s.cloth2);
      hLine(c, hx - 3, hy - 1, 14, shade(s.cloth2, -24));
      c.set(16, hy - 6, rgb(0xe6d24a));
      break;
    }
    case 'bald': {
      hLine(c, hx + 1, hy - 1, 6, shade(s.skin, 14));
      c.set(hx + 2, hy - 1, shade(s.skin, -8));
      break;
    }
    case 'plume': {
      const m = s.metal ?? rgb(0x8a96a8);
      fill(c, hx - 1, hy - 3, 10, 5, m);
      hLine(c, hx - 1, hy - 3, 10, shade(m, 26));
      hLine(c, hx - 1, hy + 1, 10, shade(m, -30));
      vLine(c, 16, hy - 3, 4, shade(m, -30));
      fill(c, hx + 3, hy - 8, 2, 5, s.cloth2);
      hLine(c, hx + 3, hy - 8, 2, shade(s.cloth2, 24));
      break;
    }
  }

  // ---- shield (left arm) ----
  if (s.shield) {
    const sm = s.metal ?? rgb(0x8a96a8);
    disc(c, 8 + lx, 18, 4, s.cloth2);
    ringPx(c, 8 + lx, 18, 4, shade(s.cloth2, -28));
    disc(c, 8 + lx, 18, 1, sm);
  }

  // ---- feature / weapon (right side) ----
  drawHeroFeature(c, s, hy, pose.weapon, lx);

  outline(c, OUTLINE);
}

function drawHeroFeature(c: Canvas, s: HeroStyle, hy: number, weaponPose: WeaponPose, lx: number): void {
  const steel = rgb(0xb9c2cc);
  const steelD = shade(steel, -40);
  const wood = rgb(0x6e4a2a);
  // Hand offset: raised for the wind-up, thrust forward for the strike.
  let wx = lx;
  let wy = 0;
  if (weaponPose === 'raise') wy = -5;
  else if (weaponPose === 'strike') { wx = lx + 3; wy = 2; }
  switch (s.feature) {
    case 'sword':
      fill(c, 24 + wx, hy + wy, 2, 11, steel);
      vLine(c, 24 + wx, hy + wy, 11, shade(steel, 28));
      hLine(c, 22 + wx, hy + 11 + wy, 6, steelD);
      fill(c, 24 + wx, hy + 12 + wy, 2, 4, wood);
      c.set(25 + wx, hy + 16 + wy, rgb(0xd4a838));
      break;
    case 'bow': {
      const wl = shade(wood, 20);
      for (let y = hy - 1; y <= hy + 15; y++) {
        const t = (y - (hy - 1)) / 16;
        const off = Math.round(Math.sin(t * Math.PI) * 3);
        c.set(25 + off + wx, y + wy, wood);
      }
      vLine(c, 25 + wx, hy - 1 + wy, 17, rgb(0xcfc6b4));
      lineThin(c, 18 + wx, hy + 7 + wy, 25 + wx, hy + 7 + wy, wl);
      triFill(c, 25 + wx, hy + 6 + wy, 25 + wx, hy + 8 + wy, 27 + wx, hy + 7 + wy, steel);
      break;
    }
    case 'staff':
      vLine(c, 25 + wx, hy - 1 + wy, 21, wood);
      vLine(c, 24 + wx, hy + 2 + wy, 18, shade(wood, -22));
      disc(c, 25 + wx, hy - 3 + wy, 2, s.cloth2);
      disc(c, 25 + wx, hy - 3 + wy, 1, shade(s.cloth2, 40));
      break;
    case 'dagger':
      fill(c, 24 + wx, hy + 7 + wy, 2, 6, steel);
      vLine(c, 24 + wx, hy + 7 + wy, 6, shade(steel, 28));
      hLine(c, 23 + wx, hy + 13 + wy, 4, steelD);
      fill(c, 24 + wx, hy + 14 + wy, 2, 3, wood);
      break;
    case 'mace': {
      const m = rgb(0x9aa2ac);
      vLine(c, 25 + wx, hy + 6 + wy, 10, wood);
      disc(c, 25 + wx, hy + 4 + wy, 3, m);
      c.set(22 + wx, hy + 4 + wy, m);
      c.set(28 + wx, hy + 4 + wy, m);
      c.set(25 + wx, hy + 1 + wy, m);
      disc(c, 25 + wx, hy + 4 + wy, 1, shade(m, 30));
      break;
    }
    case 'axe': {
      const m = rgb(0x9aa2ac);
      vLine(c, 24 + wx, hy + wy, 22, wood);
      triFill(c, 25 + wx, hy + 1 + wy, 31 + wx, hy + 4 + wy, 25 + wx, hy + 9 + wy, m);
      lineThin(c, 31 + wx, hy + 4 + wy, 27 + wx, hy + 8 + wy, shade(m, 28));
      break;
    }
    case 'fist': {
      const wl = shade(wood, 22);
      lineThin(c, 7 + wx, 7 + wy, 26 + wx, 26 + wy, wood);
      lineThin(c, 7 + wx, 8 + wy, 25 + wx, 26 + wy, wl);
      break;
    }
    case 'lute': {
      const w = rgb(0x9a6a3a);
      ellipse(c, 12 + wx, 20 + wy, 4, 5, w);
      c.set(12 + wx, 18 + wy, rgb(0x2a1c12));
      lineThin(c, 14 + wx, 16 + wy, 23 + wx, 7 + wy, shade(w, -26));
      fill(c, 22 + wx, 6 + wy, 3, 3, w);
      lineThin(c, 13 + wx, 15 + wy, 23 + wx, 7 + wy, rgb(0xe8e0c8));
      break;
    }
    case 'flask': {
      const glass = rgba(0xc6e6e6, 170);
      const liq = rgb(0xc04a4a);
      fill(c, 23 + wx, hy + 6 + wy, 3, 5, glass);
      disc(c, 24 + wx, hy + 13 + wy, 3, glass);
      disc(c, 24 + wx, hy + 13 + wy, 2, liq);
      c.set(23 + wx, hy + 12 + wy, WHITE);
      fill(c, 23 + wx, hy + 4 + wy, 3, 2, wood);
      c.set(25 + wx, hy + 9 + wy, shade(liq, 40));
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Monsters — each takes (canvas, frame 0|1); outlined by the build loop
// ---------------------------------------------------------------------------

function drawSlime(c: Canvas, f: number): void {
  const g = rgb(0x4ea84e);
  const cy = f ? 23 : 21;
  const rx = f ? 11 : 9;
  const ry = f ? 7 : 9;
  ellipse(c, 16, cy, rx, ry, g);
  for (let x = -rx; x <= rx; x++) c.set(16 + x, cy + ry - 1, shade(g, -34));
  disc(c, 16 - Math.round(rx * 0.4), cy - Math.round(ry * 0.4), 2, shade(g, 30));
  c.set(13, cy - 2, WHITE);
  c.set(18, cy - 2, WHITE);
  c.set(14, cy - 2, EYE);
  c.set(19, cy - 2, EYE);
  hLine(c, 15, cy + 2, 3, shade(g, -34));
}

function drawBat(c: Canvas, f: number): void {
  const b = rgb(0x7a4ea0);
  ellipse(c, 16, 16, 3, 4, b);
  disc(c, 16, 13, 2, b);
  fill(c, 14, 11, 1, 2, b);
  fill(c, 18, 11, 1, 2, b);
  if (f === 0) {
    triFill(c, 13, 16, 4, 11, 6, 18, b);
    triFill(c, 19, 16, 28, 11, 26, 18, b);
  } else {
    triFill(c, 13, 16, 4, 20, 7, 15, b);
    triFill(c, 19, 16, 28, 20, 25, 15, b);
  }
  c.set(15, 13, rgb(0xe6d24a));
  c.set(18, 13, rgb(0xe6d24a));
  c.set(15, 16, WHITE);
  c.set(17, 16, WHITE);
}

function drawRat(c: Canvas, f: number): void {
  const g = rgb(0x8a7a6a);
  const gd = shade(g, -26);
  const pk = rgb(0xc88a86);
  ellipse(c, 15, 19, 6, 4, g);
  disc(c, 22, 18, 3, g);
  fill(c, 23, 15, 2, 2, g);
  c.set(24, 15, pk);
  const ty = f ? 20 : 18;
  lineThin(c, 9, 19, 4, ty, gd);
  lineThin(c, 4, ty, 2, ty - 2, gd);
  fill(c, 12, 22, 2, 2, gd);
  fill(c, 17, 22, 2, 2, gd);
  c.set(23, 17, EYE);
  c.set(25, 18, pk);
}

function drawSkeleton(c: Canvas, f: number): void {
  const b = rgb(0xdad2c0);
  const bd = shade(b, -28);
  disc(c, 16, 9, 3, b);
  c.set(14, 9, EYE);
  c.set(17, 9, EYE);
  hLine(c, 15, 12, 3, f ? bd : b);
  if (f) hLine(c, 15, 13, 3, bd);
  vLine(c, 16, 13, 8, b);
  for (let i = 0; i < 3; i++) hLine(c, 13, 14 + i * 2, 7, b);
  const ay = f ? 13 : 15;
  lineThin(c, 13, 14, 10, ay, b);
  lineThin(c, 19, 14, 22, 15, b);
  lineThin(c, 15, 21, 14, 27, b);
  lineThin(c, 17, 21, 18, 27, b);
  fill(c, 13, 27, 3, 1, b);
  fill(c, 17, 27, 3, 1, b);
}

function drawSpider(c: Canvas, f: number): void {
  const k = rgb(0x2e2a36);
  const red = rgb(0xc0402e);
  disc(c, 16, 18, 4, k);
  disc(c, 16, 13, 2, k);
  c.set(16, 17, shade(k, 26));
  for (let i = 0; i < 4; i++) {
    const yy = 15 + i * 2;
    const bend = f ? i % 2 : (i + 1) % 2;
    lineThin(c, 12, 16 + i, 8, yy - (bend ? 2 : 0), k);
    lineThin(c, 20, 16 + i, 24, yy - (bend ? 0 : 2), k);
  }
  c.set(15, 12, red);
  c.set(17, 12, red);
}

function drawImp(c: Canvas, f: number): void {
  const r = rgb(0xc0492e);
  const rd = shade(r, -28);
  const horn = rgb(0xf0e2c0);
  disc(c, 16, 11, 3, r);
  triFill(c, 13, 9, 12, 5, 15, 8, horn);
  triFill(c, 19, 9, 20, 5, 17, 8, horn);
  fill(c, 13, 14, 6, 6, r);
  volumize(c, 13, 14, 6, 6, shade(r, 22), rd);
  fill(c, 12, 15, 1, 4, r);
  fill(c, 19, 15, 1, 4, r);
  fill(c, 13, 20, 2, 3, rd);
  fill(c, 17, 20, 2, 3, rd);
  const ty = f ? 22 : 20;
  lineThin(c, 19, 19, 24, ty, rd);
  triFill(c, 24, ty - 1, 24, ty + 1, 26, ty, r);
  c.set(14, 11, rgb(0xf0d040));
  c.set(18, 11, rgb(0xf0d040));
}

function drawGhost(c: Canvas, f: number): void {
  const col = rgba(0xe6ecf8, 210);
  disc(c, 16, 12, 5, col);
  for (let i = 0; i < 11; i++) {
    const x = 11 + i;
    const extra = (i + (f ? 1 : 0)) % 2 === 0 ? 2 : 0;
    vLine(c, x, 12, 9 + extra, col);
  }
  fill(c, 14, 11, 2, 3, rgba(0x2a3450, 255));
  fill(c, 18, 11, 2, 3, rgba(0x2a3450, 255));
  hLine(c, 11, 12, 11, rgba(0xffffff, 150));
}

function drawEye(c: Canvas, f: number): void {
  const iris = rgb(0x3a8ad0);
  const red = rgb(0xc0402e);
  disc(c, 16, 16, 7, WHITE);
  lineThin(c, 16, 16, 11, 12, red);
  lineThin(c, 16, 16, 22, 20, red);
  const px = f ? 19 : 14;
  disc(c, px, 16, 3, iris);
  disc(c, px, 16, 2, rgb(0x16324f));
  disc(c, px, 16, 1, EYE);
  c.set(px - 1, 15, WHITE);
  for (let i = 0; i < 3; i++) lineThin(c, 12 + i * 4, 22, 11 + i * 4, 26, rgb(0x6a2a86));
}

function drawMushroom(c: Canvas, f: number): void {
  const cap = rgb(0xc0402e);
  const stem = rgb(0xe0d6b8);
  const spot = rgb(0xf0e6cc);
  const cy = f ? 11 : 12;
  ellipse(c, 16, cy, 8, 5, cap);
  fill(c, 8, cy, 17, 1, cap);
  hLine(c, 8, cy + 5, 17, shade(cap, -28));
  c.set(12, cy - 1, spot);
  c.set(19, cy, spot);
  c.set(16, cy - 2, spot);
  fill(c, 13, cy + 5, 6, 8, stem);
  volumize(c, 13, cy + 5, 6, 8, shade(stem, 18), shade(stem, -22));
  c.set(14, cy + 8, EYE);
  c.set(17, cy + 8, EYE);
  hLine(c, 14, cy + 10, 4, shade(stem, -30));
}

function drawSnake(c: Canvas, f: number): void {
  const g = rgb(0x4a9a5a);
  const bel = rgb(0xd8c86a);
  const pts: number[][] = [[10, 24], [14, 22], [18, 20], [20, 16], [18, 12], [14, 11]];
  for (const p of pts) disc(c, p[0], p[1], 3, g);
  for (const p of pts) c.set(p[0], p[1] + 2, bel);
  disc(c, 14, 11, 3, g);
  c.set(12, 10, EYE);
  c.set(16, 10, EYE);
  if (f) {
    lineThin(c, 14, 8, 14, 6, rgb(0xd03a4a));
    c.set(13, 5, rgb(0xd03a4a));
    c.set(15, 5, rgb(0xd03a4a));
  } else {
    c.set(14, 8, rgb(0xd03a4a));
  }
}

function drawBeetle(c: Canvas, f: number): void {
  const sh = rgb(0x3a6b4a);
  const leg = rgb(0x222a26);
  ellipse(c, 16, 17, 7, 8, sh);
  vLine(c, 16, 10, 15, shade(sh, -28));
  disc(c, 14, 13, 2, shade(sh, 26));
  disc(c, 16, 9, 3, shade(sh, -20));
  const a = f ? 1 : 0;
  lineThin(c, 15, 7, 13 - a, 3, leg);
  lineThin(c, 17, 7, 19 + a, 3, leg);
  for (let i = 0; i < 3; i++) {
    const yy = 13 + i * 4;
    lineThin(c, 10, yy, 6, yy + (f ? 2 : -1), leg);
    lineThin(c, 22, yy, 26, yy + (f ? -1 : 2), leg);
  }
  c.set(15, 9, rgb(0xd0c040));
  c.set(17, 9, rgb(0xd0c040));
}

function drawWraith(c: Canvas, f: number): void {
  const cl = rgb(0x33304a);
  const cld = shade(cl, -22);
  const glow = rgb(0x57d0c0);
  triFill(c, 16, 5, 7, 28, 25, 28, cl);
  fill(c, 10, 12, 12, 16, cl);
  triFill(c, 16, 8, 12, 16, 20, 16, cld);
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 3;
    const h = f ? (i % 2 ? 4 : 2) : i % 2 ? 2 : 4;
    vLine(c, x, 28 - h, h, cl);
  }
  const e = f ? glow : shade(glow, 30);
  c.set(14, 12, e);
  c.set(18, 12, e);
  lineThin(c, 10, 16, 6, 20 + (f ? 1 : 0), cl);
  lineThin(c, 22, 16, 26, 20 + (f ? 0 : 1), cl);
}

/** A 1-frame "hurt" sprite from a base frame: recoil down + a white flash. */
function makeHurt(src: Canvas): Canvas {
  const c = new Canvas(src.w, src.h);
  c.blit(src, 0, 1);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) if (c.alphaAt(x, y) > 0) c.set(x, y, rgba(0xffffff, 95));
  return c;
}

/** A horizontally jittered copy — used to make a "move" scuttle frame. */
function jitter(src: Canvas, dx: number): Canvas {
  const c = new Canvas(src.w, src.h);
  c.blit(src, dx, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Tiles — fill the whole 32×32 cell (no outline; they sit edge-to-edge)
// ---------------------------------------------------------------------------

function drawWall(c: Canvas): void {
  const base = rgb(0x47435a);
  const mortar = rgb(0x26242f);
  fill(c, 0, 0, 32, 32, base);
  for (let y = 0; y <= 32; y += 8) hLine(c, 0, y, 32, mortar);
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    const stag = row % 2 ? 4 : 0;
    for (let x = stag; x <= 32; x += 8) vLine(c, x, y + 1, 7, mortar);
  }
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    const stag = row % 2 ? 4 : 0;
    for (let x = stag - 8; x < 32; x += 8) {
      hLine(c, x + 1, y + 1, 7, shade(base, 14));
      hLine(c, x + 1, y + 6, 7, shade(base, -16));
    }
  }
  for (let i = 0; i < 16; i++) {
    c.set(Math.floor(rnd() * 32), Math.floor(rnd() * 32), shade(base, rnd() < 0.5 ? 18 : -18));
  }
  // Contact shadow along the very top edge (reads as depth between courses).
  hLine(c, 0, 0, 32, shade(base, -30));
  hLine(c, 0, 1, 32, shade(base, -14));
}

function drawFloor(c: Canvas): void {
  const base = rgb(0x2c2a38);
  const seam = shade(base, -18);
  const lite = shade(base, 12);
  fill(c, 0, 0, 32, 32, base);
  hLine(c, 0, 0, 32, seam);
  hLine(c, 0, 16, 32, seam);
  hLine(c, 0, 31, 32, seam);
  vLine(c, 0, 0, 32, seam);
  vLine(c, 16, 0, 32, seam);
  vLine(c, 31, 0, 32, seam);
  for (const s of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
    hLine(c, s[0] + 1, s[1] + 1, 14, lite);
    vLine(c, s[0] + 1, s[1] + 1, 14, lite);
    hLine(c, s[0] + 1, s[1] + 14, 14, seam);
    vLine(c, s[0] + 14, s[1] + 1, 14, seam);
  }
  for (let i = 0; i < 22; i++) {
    c.set(Math.floor(rnd() * 32), Math.floor(rnd() * 32), rnd() < 0.5 ? lite : seam);
  }
}

function drawDoor(c: Canvas): void {
  const stone = rgb(0x3a3748);
  const wood = rgb(0x7a4f2c);
  const iron = rgb(0x4a4a54);
  const gold = rgb(0xd0a838);
  fill(c, 0, 0, 32, 32, stone);
  fill(c, 5, 2, 22, 30, wood);
  for (let x = 5; x < 27; x += 7) {
    vLine(c, x, 2, 30, shade(wood, -26));
    vLine(c, x + 1, 2, 30, shade(wood, 18));
    for (let y = 4; y < 30; y += 5) c.set(x + 3, y, shade(wood, -26));
  }
  fill(c, 5, 8, 22, 2, iron);
  fill(c, 5, 22, 22, 2, iron);
  hLine(c, 5, 8, 22, shade(iron, 22));
  disc(c, 22, 17, 2, gold);
  c.set(22, 17, shade(gold, -30));
  rectLine(c, 0, 0, 32, 32, shade(stone, -20));
}

function drawStairs(c: Canvas): void {
  const base = rgb(0x3a3748);
  fill(c, 0, 0, 32, 32, shade(base, -30));
  for (let i = 0; i < 6; i++) {
    const y = 4 + i * 4;
    const x = 3 + i * 2;
    const w = 26 - i * 4;
    const col = shade(base, -i * 7 + 10);
    fill(c, x, y, w, 4, col);
    hLine(c, x, y, w, shade(col, 18));
    hLine(c, x, y + 3, w, shade(col, -22));
  }
  vLine(c, 2, 2, 30, shade(base, -10));
  vLine(c, 29, 2, 30, shade(base, -10));
}

function drawTrap(c: Canvas, f: number): void {
  drawFloor(c);
  const plate = rgb(0x35323f);
  fill(c, 6, 6, 20, 20, plate);
  rectLine(c, 6, 6, 20, 20, shade(plate, -24));
  hLine(c, 6, 6, 20, shade(plate, 16));
  if (!f) {
    for (const p of [[10, 10], [20, 10], [10, 20], [20, 20]]) c.set(p[0], p[1], rgb(0x16141c));
    c.set(16, 16, rgb(0x404a5a));
  } else {
    const m = rgb(0xb9c2cc);
    for (const p of [[10, 9], [20, 9], [10, 19], [20, 19], [16, 14]]) {
      triFill(c, p[0], p[1] + 5, p[0] - 2, p[1] + 5, p[0], p[1], m);
      triFill(c, p[0], p[1] + 5, p[0] + 2, p[1] + 5, p[0], p[1], shade(m, -26));
      c.set(p[0], p[1], rgb(0xd03a4a));
    }
  }
}

function drawChest(c: Canvas, f: number): void {
  const wood = rgb(0x7a4f2c);
  const iron = rgb(0x4a4a54);
  const gold = rgb(0xd0a838);
  fill(c, 5, 14, 22, 14, wood);
  volumize(c, 5, 14, 22, 14, shade(wood, 18), shade(wood, -26));
  fill(c, 5, 14, 2, 14, iron);
  fill(c, 25, 14, 2, 14, iron);
  fill(c, 15, 14, 2, 14, iron);
  if (!f) {
    fill(c, 5, 9, 22, 6, wood);
    triFill(c, 5, 10, 27, 10, 16, 5, wood);
    hLine(c, 5, 9, 22, iron);
    fill(c, 14, 12, 4, 4, gold);
    c.set(15, 14, shade(gold, -30));
  } else {
    fill(c, 4, 3, 24, 6, wood);
    hLine(c, 4, 9, 24, iron);
    fill(c, 7, 13, 18, 4, rgb(0x2a1d12));
    for (let i = 0; i < 5; i++) disc(c, 8 + i * 4, 15, 1, gold);
    fill(c, 9, 11, 14, 2, rgba(0xf0d24a, 120));
  }
}

function drawDark(c: Canvas): void {
  fill(c, 0, 0, 32, 32, rgba(0x05060a, 205));
  for (let i = 0; i < 60; i++) {
    c.set(Math.floor(rnd() * 32), Math.floor(rnd() * 32), rnd() < 0.5 ? rgba(0x0a0c12, 210) : rgba(0x000000, 215));
  }
}

function drawGoalFrame(c: Canvas, f: number): void {
  const col = f ? rgb(0xf0d878) : rgb(0xc8a45a);
  const len = f ? 8 : 6;
  const m = 2;
  hLine(c, m, m, len, col);
  vLine(c, m, m, len, col);
  hLine(c, 32 - m - len, m, len, col);
  vLine(c, 31 - m, m, len, col);
  hLine(c, m, 31 - m, len, col);
  vLine(c, m, 32 - m - len, len, col);
  hLine(c, 32 - m - len, 31 - m, len, col);
  vLine(c, 31 - m, 32 - m - len, len, col);
}

// ---------------------------------------------------------------------------
// Items — small centred icons (outlined by the build loop)
// ---------------------------------------------------------------------------

const STEEL = rgb(0xc2cad4);
const WOOD = rgb(0x6e4a2a);
const GOLD = rgb(0xd0a838);

function drawSword(c: Canvas): void {
  fill(c, 15, 5, 2, 15, STEEL);
  vLine(c, 15, 5, 15, shade(STEEL, 24));
  c.set(16, 4, STEEL);
  hLine(c, 11, 20, 10, GOLD);
  fill(c, 15, 21, 2, 6, WOOD);
  disc(c, 16, 28, 1, GOLD);
}
function drawAxe(c: Canvas): void {
  vLine(c, 16, 5, 23, WOOD);
  vLine(c, 15, 5, 23, shade(WOOD, 18));
  triFill(c, 17, 6, 28, 11, 17, 17, STEEL);
  triFill(c, 15, 6, 4, 11, 15, 17, shade(STEEL, -12));
  lineThin(c, 28, 11, 20, 16, shade(STEEL, 26));
}
function drawDagger(c: Canvas): void {
  fill(c, 15, 7, 2, 10, STEEL);
  vLine(c, 15, 7, 10, shade(STEEL, 24));
  c.set(16, 6, STEEL);
  hLine(c, 12, 17, 8, GOLD);
  fill(c, 15, 18, 2, 7, WOOD);
}
function drawBow(c: Canvas): void {
  for (let y = 5; y <= 27; y++) {
    const t = (y - 5) / 22;
    const off = Math.round(Math.sin(t * Math.PI) * 7);
    c.set(10 + off, y, WOOD);
    c.set(11 + off, y, shade(WOOD, 22));
  }
  vLine(c, 10, 5, 23, rgb(0xcfc6b4));
  lineThin(c, 9, 16, 24, 16, WOOD);
  triFill(c, 24, 14, 24, 18, 27, 16, STEEL);
  fill(c, 8, 15, 1, 3, rgb(0xc8b08a));
}
function drawStaff(c: Canvas): void {
  vLine(c, 16, 7, 22, WOOD);
  vLine(c, 15, 9, 18, shade(WOOD, 18));
  disc(c, 16, 7, 3, rgb(0x5fb0e0));
  disc(c, 16, 7, 1, WHITE);
  fill(c, 14, 11, 5, 2, GOLD);
}
function drawWand(c: Canvas): void {
  vLine(c, 15, 14, 12, rgb(0x5a4630));
  const star = rgb(0xf0d24a);
  disc(c, 15, 10, 1, star);
  for (const d of [[0, -3], [0, 3], [-3, 0], [3, 0]]) c.set(15 + d[0], 10 + d[1], star);
  for (const d of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) c.set(15 + d[0], 10 + d[1], shade(star, -20));
}
function drawShield(c: Canvas): void {
  const m = rgb(0x9aa4b0);
  disc(c, 16, 14, 8, m);
  triFill(c, 8, 17, 24, 17, 16, 28, m);
  ringPx(c, 16, 14, 8, GOLD);
  disc(c, 16, 14, 2, shade(m, 24));
  vLine(c, 16, 8, 16, shade(m, -18));
}
function drawHelmet(c: Canvas): void {
  const m = rgb(0x9aa4b0);
  disc(c, 16, 15, 7, m);
  fill(c, 9, 15, 15, 8, m);
  fill(c, 11, 16, 10, 3, rgb(0x16141c));
  ringPx(c, 16, 15, 7, shade(m, -26));
  fill(c, 15, 4, 2, 6, rgb(0xc0402e));
  hLine(c, 15, 4, 2, rgb(0xe06a5a));
}
function drawArmor(c: Canvas): void {
  const m = rgb(0x9aa4b0);
  fill(c, 9, 8, 14, 16, m);
  volumize(c, 9, 8, 14, 16, shade(m, 24), shade(m, -30));
  fill(c, 13, 6, 6, 3, m);
  disc(c, 9, 10, 2, m);
  disc(c, 22, 10, 2, m);
  hLine(c, 10, 16, 12, shade(m, -30));
  vLine(c, 16, 9, 14, shade(m, -30));
}
function drawBoots(c: Canvas): void {
  const lr = rgb(0x6e4a2a);
  for (const ox of [7, 17]) {
    fill(c, ox, 8, 6, 12, lr);
    fill(c, ox, 20, 8, 3, lr);
    fill(c, ox, 23, 8, 1, rgb(0x2a221a));
    volumize(c, ox, 8, 6, 12, shade(lr, 18), shade(lr, -24));
  }
}
function drawPotion(c: Canvas, liquid: RGBA): void {
  const glass = rgba(0xbfeaf0, 150);
  disc(c, 16, 19, 6, glass);
  fill(c, 12, 12, 8, 8, glass);
  fill(c, 14, 7, 4, 5, glass);
  disc(c, 16, 20, 5, liquid);
  fill(c, 13, 15, 6, 6, liquid);
  vLine(c, 13, 15, 6, shade(liquid, 30));
  c.set(13, 18, WHITE);
  fill(c, 14, 5, 4, 3, rgb(0x8a5a32));
  hLine(c, 13, 12, 6, shade(glass, -20));
}
function drawScroll(c: Canvas): void {
  const p = rgb(0xe8dcb0);
  fill(c, 8, 8, 16, 16, p);
  volumize(c, 8, 8, 16, 16, shade(p, 16), shade(p, -26));
  fill(c, 6, 8, 3, 16, shade(p, -14));
  fill(c, 23, 8, 3, 16, shade(p, -14));
  for (let y = 11; y < 22; y += 3) hLine(c, 11, y, 10, shade(p, -26));
  fill(c, 15, 6, 2, 20, rgb(0xc0402e));
}
function drawSpellbook(c: Canvas): void {
  const cov = rgb(0x5a3a86);
  fill(c, 8, 7, 16, 18, cov);
  volumize(c, 8, 7, 16, 18, shade(cov, 22), shade(cov, -26));
  fill(c, 22, 8, 2, 16, rgb(0xe8dcb0));
  disc(c, 16, 15, 3, GOLD);
  c.set(16, 15, shade(cov, -26));
  fill(c, 7, 14, 2, 4, GOLD);
}
function drawCoin(c: Canvas): void {
  const g = rgb(0xe0b438);
  disc(c, 16, 16, 7, g);
  ringPx(c, 16, 16, 7, shade(g, -34));
  disc(c, 13, 13, 2, shade(g, 26));
  ringPx(c, 16, 16, 3, shade(g, -34));
}
function drawCoinPile(c: Canvas): void {
  const g = rgb(0xe0b438);
  for (let i = 0; i < 3; i++) {
    ellipse(c, 16, 24 - i * 3, 8, 3, g);
    hLine(c, 8, 24 - i * 3 + 2, 16, shade(g, -34));
  }
  disc(c, 8, 22, 2, g);
  disc(c, 24, 23, 2, g);
}
function drawBread(c: Canvas): void {
  const b = rgb(0xc28a4a);
  ellipse(c, 16, 17, 9, 6, b);
  ellipse(c, 13, 14, 3, 2, shade(b, 20));
  for (const s of [[11, 14, 14, 11], [15, 15, 18, 12], [19, 16, 22, 13]]) lineThin(c, s[0], s[1], s[2], s[3], shade(b, -26));
  hLine(c, 8, 21, 16, shade(b, -26));
}
function drawMeat(c: Canvas): void {
  const m = rgb(0xb05a3a);
  disc(c, 14, 14, 6, m);
  disc(c, 12, 12, 2, shade(m, 24));
  const bone = rgb(0xe8e0cc);
  fill(c, 17, 18, 6, 2, bone);
  disc(c, 24, 19, 2, bone);
  disc(c, 23, 17, 1, bone);
}
function drawApple(c: Canvas): void {
  const r = rgb(0xc83a3a);
  disc(c, 16, 18, 7, r);
  c.set(16, 12, shade(r, -28));
  c.set(15, 12, shade(r, -28));
  disc(c, 13, 15, 2, shade(r, 30));
  vLine(c, 16, 9, 4, WOOD);
  triFill(c, 17, 10, 21, 8, 18, 12, rgb(0x4a9a4a));
}
function drawRing(c: Canvas): void {
  const g = rgb(0xe0b438);
  ringPx(c, 16, 19, 5, g);
  ringPx(c, 16, 19, 4, shade(g, -30));
  disc(c, 16, 11, 2, rgb(0x4aa0e0));
  c.set(15, 10, WHITE);
}
function drawAmulet(c: Canvas): void {
  lineThin(c, 9, 7, 16, 18, rgb(0xc8b048));
  lineThin(c, 23, 7, 16, 18, rgb(0xc8b048));
  disc(c, 16, 20, 4, GOLD);
  disc(c, 16, 20, 2, rgb(0x9a4ad0));
  c.set(15, 19, WHITE);
}
function drawGem(c: Canvas): void {
  const g = rgb(0x4ad0a0);
  triFill(c, 16, 6, 8, 14, 24, 14, shade(g, 40));
  triFill(c, 8, 14, 24, 14, 16, 26, g);
  lineThin(c, 16, 6, 16, 26, shade(g, -34));
  lineThin(c, 8, 14, 24, 14, shade(g, -34));
  c.set(13, 11, WHITE);
}
function drawKey(c: Canvas): void {
  const g = rgb(0xd0a838);
  ringPx(c, 13, 9, 4, g);
  vLine(c, 13, 12, 14, g);
  hLine(c, 13, 22, 4, g);
  hLine(c, 13, 25, 3, g);
  c.set(11, 7, shade(g, 30));
}

// ---------------------------------------------------------------------------
// Effects — short bright frames (no outline)
// ---------------------------------------------------------------------------

function clearDisc(c: Canvas, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) c.clearPixel(cx + x, cy + y);
}
function drawSlash(c: Canvas, f: number): void {
  const cols: RGBA[] = [rgb(0xbfeaff), WHITE, rgba(0x9fd8ff, 170)];
  const cx = [12, 16, 20][f];
  const cy = [18, 13, 19][f];
  const r = [8, 10, 8][f];
  disc(c, cx, cy, r, cols[f]);
  clearDisc(c, cx + 4, cy - 3, r);
  c.set(cx - r + 1, cy, cols[f]);
}
function drawSpark(c: Canvas, f: number): void {
  const col: RGBA = [rgb(0xfff0a0), rgb(0xffd24a), rgba(0xcf8a2a, 160)][f];
  const r = [2, 5, 7][f];
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lineThin(c, 16, 16, 16 + d[0] * r, 16 + d[1] * r, col);
  for (const d of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) lineThin(c, 16, 16, 16 + d[0] * (r - 2), 16 + d[1] * (r - 2), col);
  disc(c, 16, 16, f === 2 ? 1 : 2, WHITE);
}
function drawHeal(c: Canvas, f: number): void {
  const yy = 18 - f * 5;
  const col: RGBA = f === 2 ? rgba(0x6fe08a, 150) : rgb(0x6fe08a);
  fill(c, 15, yy - 3, 2, 7, col);
  fill(c, 13, yy - 1, 6, 2, col);
  c.set(10, yy + 2, col);
  c.set(22, yy, col);
  c.set(12, yy - 4, WHITE);
  c.set(20, yy + 3, WHITE);
}
function drawShock(c: Canvas, f: number): void {
  const r = [4, 8, 12][f];
  const col: RGBA = f === 2 ? rgba(0xbfd8ff, 140) : rgb(0xbfd8ff);
  ringPx(c, 16, 18, r, col);
  if (r > 5) ringPx(c, 16, 18, r - 3, rgba(0xffffff, 120));
}
function drawImpact(c: Canvas, f: number): void {
  const col: RGBA = [rgb(0xffe0a0), rgb(0xff9a3a), rgba(0xc0402e, 150)][f];
  const r = [3, 6, 8][f];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = r + (i % 2 ? 0 : 2);
    lineThin(c, 16, 16, 16 + Math.round(Math.cos(a) * rr), 16 + Math.round(Math.sin(a) * rr), col);
  }
  disc(c, 16, 16, f === 2 ? 1 : 2, f === 0 ? WHITE : rgb(0xffd24a));
}
function drawMagic(c: Canvas, f: number): void {
  const col: RGBA = [rgb(0xe6b8ff), rgb(0xb060e0), rgba(0x7a3ad0, 150)][f];
  const r = [3, 7, 10][f];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + f * 0.6;
    c.set(16 + Math.round(Math.cos(a) * r), 16 + Math.round(Math.sin(a) * r), col);
    c.set(16 + Math.round(Math.cos(a) * (r - 2)), 16 + Math.round(Math.sin(a) * (r - 2)), col);
  }
  ringPx(c, 16, 16, r, rgba(0xffffff, 110));
  disc(c, 16, 16, f === 2 ? 1 : 2, rgb(0xf2e6ff));
}

// ---------------------------------------------------------------------------
// PNG encoder (truecolour + alpha, filter 0) — pure Node, no dependencies
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = rgba[y * stride + i];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function buildSheet(frames: Canvas[], cols: number): Canvas {
  const rows = Math.ceil(frames.length / cols);
  const sheet = new Canvas(cols * 32, rows * 32);
  frames.forEach((f, i) => sheet.blit(f, (i % cols) * 32, Math.floor(i / cols) * 32));
  return sheet;
}

// ---------------------------------------------------------------------------
// Catalogue — KEEP IN SYNC with src/game/assets/atlas.ts consumers
// ---------------------------------------------------------------------------

const HERO_STYLES: HeroStyle[] = [
  { key: 'knight', name: '骑士', skin: rgb(0xd8a878), hair: rgb(0x5a3e26), cloth: rgb(0x3f6ea8), cloth2: rgb(0xb43048), metal: rgb(0x95a1b2), feature: 'sword', hat: 'plume', shield: true },
  { key: 'ranger', name: '游侠', skin: rgb(0xcaa070), hair: rgb(0x4a3420), cloth: rgb(0x3a7a46), cloth2: rgb(0x6e4a2a), metal: null, feature: 'bow', hat: 'hood', shield: false },
  { key: 'mage', name: '法师', skin: rgb(0xe6c4a0), hair: rgb(0x9a7a4a), cloth: rgb(0x5a3a86), cloth2: rgb(0xd0a838), metal: null, feature: 'staff', hat: 'wizardhat', shield: false },
  { key: 'rogue', name: '游荡者', skin: rgb(0xd6b48c), hair: rgb(0x3a2e26), cloth: rgb(0x3a4150), cloth2: rgb(0x242a34), metal: null, feature: 'dagger', hat: 'hood', shield: false },
  { key: 'cleric', name: '祭司', skin: rgb(0xd8a878), hair: rgb(0xb09a6a), cloth: rgb(0xe2dcc4), cloth2: rgb(0xd0a838), metal: null, feature: 'mace', hat: 'none', shield: false },
  { key: 'barbarian', name: '蛮战', skin: rgb(0xb0784a), hair: rgb(0xb84a28), cloth: rgb(0x7a5230), cloth2: rgb(0x3a2a1e), metal: null, feature: 'axe', hat: 'none', shield: false },
  { key: 'monk', name: '武僧', skin: rgb(0xd8a878), hair: rgb(0x3a2e26), cloth: rgb(0xd88a2a), cloth2: rgb(0x7a2e2a), metal: null, feature: 'fist', hat: 'bald', shield: false },
  { key: 'bard', name: '吟游者', skin: rgb(0xe6b890), hair: rgb(0x5a3e26), cloth: rgb(0x2a8a8a), cloth2: rgb(0xe0c040), metal: null, feature: 'lute', hat: 'cap', shield: false },
  { key: 'alchemist', name: '炼药师', skin: rgb(0xd8b48c), hair: rgb(0x5a4a3a), cloth: rgb(0x6a6e72), cloth2: rgb(0xb04a3a), metal: null, feature: 'flask', hat: 'hood', shield: false },
];

const MONSTERS = [
  { key: 'slime', name: '软泥', draw: drawSlime },
  { key: 'bat', name: '夜蝠', draw: drawBat },
  { key: 'rat', name: '巨鼠', draw: drawRat },
  { key: 'skeleton', name: '骷髅', draw: drawSkeleton },
  { key: 'spider', name: '蛛兽', draw: drawSpider },
  { key: 'imp', name: '小鬼', draw: drawImp },
  { key: 'ghost', name: '幽魂', draw: drawGhost },
  { key: 'gazer', name: '窥视者', draw: drawEye },
  { key: 'mushroom', name: '菌怪', draw: drawMushroom },
  { key: 'serpent', name: '毒蛇', draw: drawSnake },
  { key: 'beetle', name: '甲虫', draw: drawBeetle },
  { key: 'wraith', name: '阴影', draw: drawWraith },
];

const TILES = [
  { key: 'wall', frames: 1, draw: (c: Canvas, _f: number) => drawWall(c) },
  { key: 'floor', frames: 1, draw: (c: Canvas, _f: number) => drawFloor(c) },
  { key: 'door', frames: 1, draw: (c: Canvas, _f: number) => drawDoor(c) },
  { key: 'stairs', frames: 1, draw: (c: Canvas, _f: number) => drawStairs(c) },
  { key: 'trap', frames: 2, draw: (c: Canvas, f: number) => drawTrap(c, f) },
  { key: 'chest', frames: 2, draw: (c: Canvas, f: number) => drawChest(c, f) },
  { key: 'dark', frames: 1, draw: (c: Canvas, _f: number) => drawDark(c) },
  { key: 'goal', frames: 2, draw: (c: Canvas, f: number) => drawGoalFrame(c, f) },
];

const ITEMS = [
  { key: 'sword', name: '短剑', category: 'weapon', draw: drawSword },
  { key: 'axe', name: '战斧', category: 'weapon', draw: drawAxe },
  { key: 'dagger', name: '匕首', category: 'weapon', draw: drawDagger },
  { key: 'bow', name: '短弓', category: 'weapon', draw: drawBow },
  { key: 'staff', name: '法杖', category: 'weapon', draw: drawStaff },
  { key: 'wand', name: '魔杖', category: 'weapon', draw: drawWand },
  { key: 'shield', name: '圆盾', category: 'armor', draw: drawShield },
  { key: 'helmet', name: '头盔', category: 'armor', draw: drawHelmet },
  { key: 'armor', name: '胸甲', category: 'armor', draw: drawArmor },
  { key: 'boots', name: '皮靴', category: 'armor', draw: drawBoots },
  { key: 'potion_red', name: '赤色药剂', category: 'potion', draw: (c: Canvas) => drawPotion(c, rgb(0xd03a4a)) },
  { key: 'potion_blue', name: '碧色药剂', category: 'potion', draw: (c: Canvas) => drawPotion(c, rgb(0x3a7ad0)) },
  { key: 'potion_green', name: '翠色药剂', category: 'potion', draw: (c: Canvas) => drawPotion(c, rgb(0x4aa84e)) },
  { key: 'scroll', name: '卷轴', category: 'scroll', draw: drawScroll },
  { key: 'spellbook', name: '秘典', category: 'scroll', draw: drawSpellbook },
  { key: 'coin', name: '金币', category: 'gold', draw: drawCoin },
  { key: 'coin_pile', name: '钱堆', category: 'gold', draw: drawCoinPile },
  { key: 'bread', name: '面包', category: 'food', draw: drawBread },
  { key: 'meat', name: '烤肉', category: 'food', draw: drawMeat },
  { key: 'apple', name: '果实', category: 'food', draw: drawApple },
  { key: 'ring', name: '指环', category: 'accessory', draw: drawRing },
  { key: 'amulet', name: '护符', category: 'accessory', draw: drawAmulet },
  { key: 'gem', name: '宝石', category: 'accessory', draw: drawGem },
  { key: 'key', name: '钥匙', category: 'misc', draw: drawKey },
];

const EFFECTS = [
  { key: 'slash', fps: 14, draw: drawSlash },
  { key: 'spark', fps: 12, draw: drawSpark },
  { key: 'heal', fps: 8, draw: drawHeal },
  { key: 'shock', fps: 12, draw: drawShock },
  { key: 'impact', fps: 14, draw: drawImpact },
  { key: 'magic', fps: 13, draw: drawMagic },
];

// ---------------------------------------------------------------------------
// Assemble & write
// ---------------------------------------------------------------------------

function writeSheet(out: string, name: string, frames: Canvas[], cols: number, atlas: any): void {
  const sheet = buildSheet(frames, cols);
  writeFileSync(join(out, name + '.png'), encodePng(sheet.w, sheet.h, sheet.data));
  atlas.sheets[name] = { file: name + '.png', cols, count: frames.length, w: sheet.w, h: sheet.h };
}

/** The original "zero ring" app icon — concentric gold bands on a dark field. */
function drawIcon(size: number): Canvas {
  const c = new Canvas(size, size);
  const bg = rgb(0x0b0b10);
  const gold = rgb(0xc8a45a);
  const goldHi = rgb(0xe6c179);
  const dim = rgb(0x6e5a30);
  fill(c, 0, 0, size, size, bg);
  const cx = (size / 2) | 0;
  const cy = (size / 2) | 0;
  const R = size * 0.5;
  const band = (rOuter: number, rInner: number, col: RGBA): void => {
    disc(c, cx, cy, Math.round(rOuter), col);
    disc(c, cx, cy, Math.round(rInner), bg);
  };
  band(R * 0.64, R * 0.54, gold); // outer band (kept within the maskable safe zone)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rx = Math.round(cx + Math.cos(a) * R * 0.74);
    const ry = Math.round(cy + Math.sin(a) * R * 0.74);
    disc(c, rx, ry, Math.max(1, Math.round(size * 0.018)), goldHi);
  }
  band(R * 0.38, R * 0.3, goldHi); // inner band
  disc(c, cx, cy, Math.max(1, Math.round(size * 0.06)), dim);
  return c;
}

function main(): void {
  RNG = 0x9e3779b9 >>> 0;
  const out = resolve(process.cwd(), 'public', 'assets', 'generated');
  mkdirSync(out, { recursive: true });

  const atlas: any = { frameSize: 32, sheets: {}, heroes: [], monsters: [], tiles: [], items: [], effects: [] };

  const heroFrames: Canvas[] = [];
  for (const s of HERO_STYLES) {
    const base = heroFrames.length;
    for (const pose of HERO_POSES) {
      const c = new Canvas(32, 32);
      drawHero(c, s, pose);
      heroFrames.push(c);
    }
    atlas.heroes.push({
      key: s.key,
      name: s.name,
      idle: [base, base + 1],
      walk: [base + 2, base + 3, base + 4, base + 5],
      attack: [base + 6, base + 7],
      hurt: [base + 8],
    });
  }
  writeSheet(out, 'heroes', heroFrames, 9, atlas);

  const monFrames: Canvas[] = [];
  for (const m of MONSTERS) {
    const base = monFrames.length;
    const idle: Canvas[] = [];
    for (let f = 0; f < 2; f++) {
      const c = new Canvas(32, 32);
      m.draw(c, f);
      outline(c, OUTLINE);
      idle.push(c);
      monFrames.push(c);
    }
    // move = a 2-frame scuttle (jittered idle); hurt = recoil flash.
    monFrames.push(jitter(idle[0], 1));
    monFrames.push(jitter(idle[1], -1));
    monFrames.push(makeHurt(idle[0]));
    atlas.monsters.push({
      key: m.key,
      name: m.name,
      idle: [base, base + 1],
      move: [base + 2, base + 3],
      hurt: [base + 4],
    });
  }
  writeSheet(out, 'monsters', monFrames, 5, atlas);

  const tileFrames: Canvas[] = [];
  for (const t of TILES) {
    const fr: number[] = [];
    for (let f = 0; f < t.frames; f++) {
      const c = new Canvas(32, 32);
      t.draw(c, f);
      tileFrames.push(c);
      fr.push(tileFrames.length - 1);
    }
    atlas.tiles.push({ key: t.key, frames: fr });
  }
  writeSheet(out, 'tiles', tileFrames, 8, atlas);

  const itemFrames: Canvas[] = [];
  for (const it of ITEMS) {
    const c = new Canvas(32, 32);
    it.draw(c, 0);
    outline(c, OUTLINE);
    itemFrames.push(c);
    atlas.items.push({ key: it.key, name: it.name, category: it.category, frame: itemFrames.length - 1 });
  }
  writeSheet(out, 'items', itemFrames, 8, atlas);

  const fxFrames: Canvas[] = [];
  for (const e of EFFECTS) {
    const fr: number[] = [];
    for (let f = 0; f < 3; f++) {
      const c = new Canvas(32, 32);
      e.draw(c, f);
      fxFrames.push(c);
      fr.push(fxFrames.length - 1);
    }
    atlas.effects.push({ key: e.key, frames: fr, fps: e.fps });
  }
  writeSheet(out, 'effects', fxFrames, 3, atlas);

  writeFileSync(join(out, 'atlas.json'), JSON.stringify(atlas, null, 2));

  // PWA app icons — the same original ring emblem at install sizes.
  const iconDir = resolve(process.cwd(), 'public', 'icons');
  mkdirSync(iconDir, { recursive: true });
  for (const sz of [180, 192, 512]) {
    const icon = drawIcon(sz);
    writeFileSync(join(iconDir, `icon-${sz}.png`), encodePng(icon.w, icon.h, icon.data));
  }

  console.log('[零环] 生成原创像素素材 →', out);
  console.log('  icons/icon-{180,192,512}.png');
  for (const k of Object.keys(atlas.sheets)) {
    const s = atlas.sheets[k];
    console.log(`  ${k}.png  ${s.w}x${s.h}  (${s.count} 帧)`);
  }
}

main();
