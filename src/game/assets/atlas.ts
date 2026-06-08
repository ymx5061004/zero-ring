import Phaser from 'phaser';

/**
 * Loads and wires up the procedurally generated spritesheets (see
 * scripts/generate-assets.ts). The frame layout is described by the generated
 * `atlas.json` manifest, which is the single source of truth for frame indices.
 */

export const FRAME_SIZE = 32;
export const GENERATED_DIR = 'assets/generated';
export const ATLAS_KEY = 'sprite-atlas';
export const SHEET_KEYS = ['heroes', 'monsters', 'tiles', 'items', 'effects'] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export interface SheetInfo {
  file: string;
  cols: number;
  count: number;
  w: number;
  h: number;
}
export interface HeroEntry {
  key: string;
  name: string;
  idle: number[];
  walk: number[];
  attack: number[];
  hurt: number[];
}
export interface MonsterEntry {
  key: string;
  name: string;
  idle: number[];
  move: number[];
  hurt: number[];
}
export interface TileEntry {
  key: string;
  frames: number[];
}
export interface ItemEntry {
  key: string;
  name: string;
  category: string;
  frame: number;
}
export interface EffectEntry {
  key: string;
  frames: number[];
  fps: number;
}
export interface SpriteAtlas {
  frameSize: number;
  sheets: Record<SheetKey, SheetInfo>;
  heroes: HeroEntry[];
  monsters: MonsterEntry[];
  tiles: TileEntry[];
  items: ItemEntry[];
  effects: EffectEntry[];
}

// Animation key helpers — keep names globally unique in Phaser's anim manager.
export type HeroAnimKind = 'idle' | 'walk' | 'attack' | 'hurt';
export type MonsterAnimKind = 'idle' | 'move' | 'hurt';
export const heroAnim = (key: string, kind: HeroAnimKind): string => `hero:${key}:${kind}`;
export const monsterAnim = (key: string, kind: MonsterAnimKind = 'idle'): string => `monster:${key}:${kind}`;
export const effectAnim = (key: string): string => `fx:${key}`;

/** Queue all spritesheets + the manifest. Call from a scene's preload(). */
export function preloadSprites(scene: Phaser.Scene): void {
  for (const key of SHEET_KEYS) {
    scene.load.spritesheet(key, `${GENERATED_DIR}/${key}.png`, {
      frameWidth: FRAME_SIZE,
      frameHeight: FRAME_SIZE,
    });
  }
  scene.load.json(ATLAS_KEY, `${GENERATED_DIR}/atlas.json`);
}

/** True once every sheet texture has loaded. */
export function spritesReady(scene: Phaser.Scene): boolean {
  return SHEET_KEYS.every((k) => scene.textures.exists(k));
}

/** Crisp, non-blurred scaling for the pixel-art sheets (UI Graphics stay smooth). */
export function applyPixelFilter(scene: Phaser.Scene): void {
  for (const key of SHEET_KEYS) {
    if (scene.textures.exists(key)) {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

/** Read the parsed manifest from the JSON cache (null if it failed to load). */
export function getAtlas(scene: Phaser.Scene): SpriteAtlas | null {
  const data = scene.cache.json.get(ATLAS_KEY) as SpriteAtlas | undefined;
  return data ?? null;
}

/** Find the hero whose frames include the given heroes-sheet frame index. */
export function heroByFrame(atlas: SpriteAtlas, frame: number): HeroEntry | null {
  return (
    atlas.heroes.find(
      (h) =>
        h.idle.includes(frame) ||
        h.walk.includes(frame) ||
        h.attack.includes(frame) ||
        h.hurt.includes(frame),
    ) ?? null
  );
}

/** Find an item entry by key (e.g. 'sword', 'potion_red'). */
export function itemByKey(atlas: SpriteAtlas, key: string): ItemEntry | null {
  return atlas.items.find((it) => it.key === key) ?? null;
}

/** Find a tile entry by key (e.g. 'wall', 'floor', 'stairs'). */
export function tileByKey(atlas: SpriteAtlas, key: string): TileEntry | null {
  return atlas.tiles.find((t) => t.key === key) ?? null;
}

/** Find a monster entry by key (e.g. 'slime', 'bat'). */
export function monsterByKey(atlas: SpriteAtlas, key: string): MonsterEntry | null {
  return atlas.monsters.find((m) => m.key === key) ?? null;
}

/** Find the monster design whose frames include the given monsters-sheet frame. */
export function monsterByFrame(atlas: SpriteAtlas, frame: number): MonsterEntry | null {
  return (
    atlas.monsters.find(
      (m) => m.idle.includes(frame) || m.move.includes(frame) || m.hurt.includes(frame),
    ) ?? null
  );
}

/** Register idle/walk (heroes), idle (monsters) and one-shot (effects) animations. */
export function buildAnimations(scene: Phaser.Scene, atlas: SpriteAtlas): void {
  const anims = scene.anims;
  const make = (key: string, sheet: SheetKey, frames: number[], frameRate: number, repeat: number): void => {
    if (anims.exists(key) || !scene.textures.exists(sheet)) return;
    anims.create({
      key,
      frames: anims.generateFrameNumbers(sheet, { frames }),
      frameRate,
      repeat,
    });
  };

  for (const h of atlas.heroes) {
    make(heroAnim(h.key, 'idle'), 'heroes', h.idle, 2.5, -1);
    make(heroAnim(h.key, 'walk'), 'heroes', h.walk, 8, -1);
    make(heroAnim(h.key, 'attack'), 'heroes', h.attack, 12, 0);
    make(heroAnim(h.key, 'hurt'), 'heroes', h.hurt, 6, 0);
  }
  for (const m of atlas.monsters) {
    make(monsterAnim(m.key, 'idle'), 'monsters', m.idle, 2.8, -1);
    make(monsterAnim(m.key, 'move'), 'monsters', m.move, 6, -1);
    make(monsterAnim(m.key, 'hurt'), 'monsters', m.hurt, 6, 0);
  }
  for (const e of atlas.effects) {
    make(effectAnim(e.key), 'effects', e.frames, e.fps, 0);
  }
}
