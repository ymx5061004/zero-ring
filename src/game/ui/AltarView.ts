import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';

export interface AltarHandlers {
  onPray: () => void;
  onLeave: () => void;
}

/**
 * The 石龛 altar menu (0.3 phase 6) — a minimal bless/curse gamble. Bumping the altar
 * opens this (free); 祝祷 commits a turn and randomly blesses or curses a piece of
 * gear (with a slim chance of an ill omen); 离开 / tap-outside is free. Mirrors the
 * ChestView overlay pattern (dim + panel + DOM buttons).
 */
export class AltarView extends Phaser.GameObjects.Container {
  private closed = false;
  private btns: HtmlButton[] = [];

  constructor(scene: Phaser.Scene, handlers: AltarHandlers) {
    super(scene, 0, 0);
    this.setDepth(1100);
    blockUi();

    const panelW = 290;
    const panelH = 220;
    const left = Math.round((GAME_WIDTH - panelW) / 2);
    const top = Math.round((GAME_HEIGHT - panelH) / 2);

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= left && w.x <= left + panelW && w.y >= top && w.y <= top + panelH;
      if (!inPanel) this.finish(handlers.onLeave);
    });

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(left, top, panelW, panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(left, top, panelW, panelH, 16);

    const title = scene.add
      .text(GAME_WIDTH / 2, top + 32, '石龛', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
      .setOrigin(0.5);
    const sub = scene.add
      .text(GAME_WIDTH / 2, top + 64, '献上祝祷——或得庇佑，或染厄运。', { fontFamily: FontFamily, fontSize: '13px', color: toCss(Palette.textDim), wordWrap: { width: panelW - 40 }, align: 'center' })
      .setOrigin(0.5);

    this.add([dim, panel, title, sub]);

    const cx = GAME_WIDTH / 2;
    this.btns.push(
      new HtmlButton(scene, cx, top + 116, '祝祷', () => this.finish(handlers.onPray), { width: 200, height: 48, fontSize: 17, variant: 'primary', layer: 'modal' }),
      new HtmlButton(scene, cx, top + 170, '离开', () => this.finish(handlers.onLeave), { width: 200, height: 44, fontSize: 16, variant: 'ghost', layer: 'modal' }),
    );

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 110 });
  }

  private finish(handler: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.btns.forEach((b) => b.destroy());
    this.btns = [];
    unblockUi();
    this.destroy();
    handler();
  }

  override destroy(fromScene?: boolean): void {
    if (!this.closed) {
      this.closed = true;
      this.btns.forEach((b) => b.destroy());
      this.btns = [];
      unblockUi();
    }
    super.destroy(fromScene);
  }
}
