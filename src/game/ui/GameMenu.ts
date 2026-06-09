import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';

export interface GameMenuHandlers {
  onResume: () => void;
  onMap: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

/**
 * The in-game pause menu opened by the HUD 「菜单」 button. Previously that button
 * jumped straight back to the main menu (jarring, easy to hit by accident); now it
 * opens this overlay so 返回主菜单 is a deliberate choice and 地图 / 设置 are reachable
 * mid-run. Picking any option (or tapping outside → 继续) dismisses the menu first.
 */
export class GameMenu extends Phaser.GameObjects.Container {
  private closed = false;
  private btns: HtmlButton[] = [];

  constructor(scene: Phaser.Scene, handlers: GameMenuHandlers) {
    super(scene, 0, 0);
    this.setDepth(1100);
    blockUi();

    const panelW = 280;
    const panelH = 348;
    const left = Math.round((GAME_WIDTH - panelW) / 2);
    const top = Math.round((GAME_HEIGHT - panelH) / 2);

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.8);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    // A tap outside the panel just resumes (pointer x/y are buffer pixels → map back).
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= left && w.x <= left + panelW && w.y >= top && w.y <= top + panelH;
      if (!inPanel) this.finish(handlers.onResume);
    });

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(left, top, panelW, panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(left, top, panelW, panelH, 16);

    const title = scene.add
      .text(GAME_WIDTH / 2, top + 34, '菜单', {
        fontFamily: FontFamily,
        fontSize: '22px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add([dim, panel, title]);

    const cx = GAME_WIDTH / 2;
    let by = top + 86;
    const item = (label: string, handler: () => void, variant?: 'primary' | 'ghost'): void => {
      this.btns.push(
        new HtmlButton(scene, cx, by, label, () => this.finish(handler), {
          width: 200,
          height: 48,
          fontSize: 17,
          variant,
          layer: 'modal',
        }),
      );
      by += 58;
    };
    item('继续游戏', handlers.onResume, 'primary');
    item('地图', handlers.onMap);
    item('设置', handlers.onSettings);
    item('返回主菜单', handlers.onQuit, 'ghost');

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 120 });
  }

  /** Tear down the menu, then run the chosen action (so overlays never stack). */
  private finish(handler: () => void): void {
    if (this.closed) return;
    this.closed = true;
    this.btns.forEach((b) => b.destroy());
    this.btns = [];
    unblockUi();
    this.destroy();
    handler();
  }
}
