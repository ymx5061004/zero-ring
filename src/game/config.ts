// Central design tokens and constants shared across scenes.
// Everything here is original to 《零环》.

/** Logical design resolution — a tall portrait canvas (iPhone-class aspect). */
export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

/** Scene registry keys. Kept in one place so transitions never use bare strings. */
export const SceneKeys = {
  Boot: 'BootScene',
  MainMenu: 'MainMenuScene',
  ClassSelect: 'ClassSelectScene',
  Game: 'GameScene',
  Death: 'DeathScene',
  Victory: 'VictoryScene',
  Showcase: 'SpriteShowcaseScene',
} as const;

/**
 * Muted, lamplit-dungeon palette. Values are stored as 0xRRGGBB numbers for use
 * with Phaser.Graphics; use `toCss()` when a CSS string is needed (e.g. text).
 */
export const Palette = {
  bg: 0x0b0b10,
  bgDeep: 0x07070b,
  panel: 0x15151e,
  panelLight: 0x1f1f2b,
  panelDown: 0x101019,
  border: 0x2c2c3c,
  borderBright: 0x44445a,

  accent: 0xc8a45a, // weathered gold — the ring motif
  accentBright: 0xe6c179,
  accentDim: 0x7a6638,

  danger: 0xc05a48,
  dangerDim: 0x6e2f26,
  success: 0x5fa06e,
  cool: 0x5f86a0,

  floor: 0x16161f,
  floorAlt: 0x111119,
  wall: 0x2a2a38,
  wallEdge: 0x3a3a4d,

  text: 0xe8e6df,
  textDim: 0x9a978d,
  textMuted: 0x5d5b54,

  white: 0xffffff,
  black: 0x000000,
} as const;

/** UI font stack with broad CJK coverage; no bundled font files required. */
export const FontFamily =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif';

/** Monospace stack for the dungeon glyph grid. */
export const MonoFamily =
  '"SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, "Noto Sans Mono CJK SC", monospace';

/** Convert a 0xRRGGBB number into a `#rrggbb` CSS string. */
export function toCss(color: number): string {
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
}
