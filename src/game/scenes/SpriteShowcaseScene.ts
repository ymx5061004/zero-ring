import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, SceneKeys, toCss } from '../config';
import { HtmlButton } from '../ui/HtmlButton';
import {
  effectAnim,
  getAtlas,
  heroAnim,
  monsterAnim,
  spritesReady,
  type SpriteAtlas,
} from '../assets/atlas';

const HEADER_H = 88;

/**
 * A scrollable gallery of every generated sprite — heroes (walking), monsters
 * (idle), tiles, items and effects. Used to confirm the procedural art loads and
 * renders, and as a handy reference while building the game.
 */
export class SpriteShowcaseScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Showcase);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Palette.bg);
    this.buildHeader();

    const atlas = getAtlas(this);
    if (!atlas || !spritesReady(this)) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '素材尚未生成\n请运行  npm run gen:assets', {
          fontFamily: FontFamily,
          fontSize: '16px',
          color: toCss(Palette.textDim),
          align: 'center',
          lineSpacing: 8,
        })
        .setOrigin(0.5);
      return;
    }

    const content = this.add.container(0, HEADER_H);
    const bottom = this.buildContent(content, atlas);

    // Clip the gallery to the area below the header.
    const viewH = GAME_HEIGHT - HEADER_H;
    const maskG = this.make.graphics(); // not added to the display list
    maskG.fillStyle(0xffffff);
    maskG.fillRect(0, HEADER_H, GAME_WIDTH, viewH);
    content.setMask(maskG.createGeometryMask());

    this.enableScroll(content, bottom, viewH);
  }

  private buildHeader(): void {
    const g = this.add.graphics();
    g.fillStyle(Palette.bg, 1);
    g.fillRect(0, 0, GAME_WIDTH, HEADER_H);
    g.lineStyle(1, Palette.border, 1);
    g.lineBetween(0, HEADER_H, GAME_WIDTH, HEADER_H);

    this.add
      .text(GAME_WIDTH / 2, 34, '素材图鉴', {
        fontFamily: FontFamily,
        fontSize: '24px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_WIDTH / 2, 62, '全部由代码实时生成 · 上下拖动查看', {
        fontFamily: FontFamily,
        fontSize: '12px',
        color: toCss(Palette.textDim),
      })
      .setOrigin(0.5);

    new HtmlButton(this, 48, 34, '返回', () => this.scene.start(SceneKeys.MainMenu), {
      width: 72,
      height: 36,
      fontSize: 15,
      variant: 'ghost',
    });
  }

  /** Lay out every section into `content`; returns the total content height. */
  private buildContent(content: Phaser.GameObjects.Container, atlas: SpriteAtlas): number {
    let y = 14;

    y = this.section(content, y, '英雄  HEROES');
    const heroCols = Math.min(atlas.heroes.length, 5);
    const heroCw = GAME_WIDTH / heroCols;
    atlas.heroes.forEach((h, i) => {
      const col = i % heroCols;
      const row = Math.floor(i / heroCols);
      const x = heroCw * (col + 0.5);
      const yy = y + 26 + row * 60;
      const spr = this.add.sprite(x, yy, 'heroes', h.walk[0]).setScale(1.5);
      spr.play(heroAnim(h.key, 'walk'));
      content.add(spr);
      content.add(this.label(x, yy + 24, h.name));
    });
    y += Math.ceil(atlas.heroes.length / heroCols) * 60 + 14;

    y = this.section(content, y, '怪物  MONSTERS');
    atlas.monsters.forEach((m, i) => {
      const cw = GAME_WIDTH / 6;
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = cw * (col + 0.5);
      const yy = y + 26 + row * 62;
      const spr = this.add.sprite(x, yy, 'monsters', m.idle[0]).setScale(1.5);
      spr.play(monsterAnim(m.key));
      content.add(spr);
      content.add(this.label(x, yy + 22, m.name));
    });
    y += Math.ceil(atlas.monsters.length / 6) * 62 + 12;

    y = this.section(content, y, '地块  TILES');
    const tileFrames = atlas.tiles.flatMap((t) => t.frames);
    tileFrames.forEach((fr, i) => {
      const cw = GAME_WIDTH / 8;
      const x = cw * ((i % 8) + 0.5);
      const yy = y + 22 + Math.floor(i / 8) * 44;
      content.add(this.add.image(x, yy, 'tiles', fr).setScale(1.4));
    });
    y += Math.ceil(tileFrames.length / 8) * 44 + 12;

    y = this.section(content, y, '物品  ITEMS');
    atlas.items.forEach((it, i) => {
      const cw = GAME_WIDTH / 8;
      const x = cw * ((i % 8) + 0.5);
      const yy = y + 20 + Math.floor(i / 8) * 40;
      content.add(this.add.image(x, yy, 'items', it.frame).setScale(1.2));
    });
    y += Math.ceil(atlas.items.length / 8) * 40 + 12;

    y = this.section(content, y, '特效  EFFECTS');
    atlas.effects.forEach((e, i) => {
      const cw = GAME_WIDTH / atlas.effects.length;
      const x = cw * (i + 0.5);
      const spr = this.add.sprite(x, y + 26, 'effects', e.frames[0]).setScale(1.6);
      spr.play({ key: effectAnim(e.key), repeat: -1 });
      content.add(spr);
      content.add(this.label(x, y + 50, e.key));
    });
    y += 74;

    return y + 16;
  }

  private section(content: Phaser.GameObjects.Container, y: number, title: string): number {
    content.add(
      this.add.text(18, y, title, {
        fontFamily: FontFamily,
        fontSize: '15px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      }),
    );
    const g = this.add.graphics();
    g.lineStyle(1, Palette.border, 1);
    g.lineBetween(18, y + 22, GAME_WIDTH - 18, y + 22);
    content.add(g);
    return y + 34;
  }

  private label(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, { fontFamily: FontFamily, fontSize: '10px', color: toCss(Palette.textMuted) })
      .setOrigin(0.5, 0);
  }

  private enableScroll(content: Phaser.GameObjects.Container, bottom: number, viewH: number): void {
    const minY = HEADER_H - Math.max(0, bottom - viewH);
    if (minY >= HEADER_H) return; // everything fits — no scrolling needed

    const clampY = (v: number): number => Phaser.Math.Clamp(v, minY, HEADER_H);
    let dragging = false;
    let lastPy = 0;

    // Pointer y is in canvas-buffer pixels (hi-DPI buffer = design×SUPERSAMPLE), but
    // content.y is in design space — so map back through the camera, else the drag
    // delta is SUPERSAMPLE× too large and the list scrolls far too fast.
    const logicalY = (p: Phaser.Input.Pointer): number => this.cameras.main.getWorldPoint(p.x, p.y).y;
    const zone = this.add.zone(0, HEADER_H, GAME_WIDTH, viewH).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true;
      lastPy = logicalY(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const py = logicalY(p);
      content.y = clampY(content.y + (py - lastPy));
      lastPy = py;
    });
    this.input.on('pointerup', () => (dragging = false));
    this.input.on('pointerupoutside', () => (dragging = false));
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      content.y = clampY(content.y - dy * 0.5);
    });
  }
}
