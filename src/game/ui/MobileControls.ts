import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { Button } from './Button';

export interface MobileControlsHandlers {
  onWait: () => void;
  onInventory: () => void;
  onCharacter: () => void;
  onLog: () => void;
  onDescend: () => void;
}

/** Top of the control bar; the dungeon viewport (and tap-to-move) sits above it. */
export const CONTROLS_TOP = 740;

/**
 * The bottom touch console: a single row of action buttons (wait / inventory /
 * character / log / descend). Movement is by tapping the map, so there is no
 * directional pad. Buttons are sized for thumbs and drawn with the shared widget.
 */
export class MobileControls extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, handlers: MobileControlsHandlers) {
    super(scene, 0, 0);
    this.setDepth(20);

    const bg = scene.add.graphics();
    bg.fillStyle(Palette.bgDeep, 0.96);
    bg.fillRect(0, CONTROLS_TOP, GAME_WIDTH, GAME_HEIGHT - CONTROLS_TOP);
    bg.lineStyle(1, Palette.border, 1);
    bg.lineBetween(0, CONTROLS_TOP, GAME_WIDTH, CONTROLS_TOP);
    this.add(bg);

    this.add(
      scene.add
        .text(GAME_WIDTH / 2, CONTROLS_TOP + 18, '点按地图移动　·　长按查看格子', {
          fontFamily: FontFamily,
          fontSize: '12px',
          color: toCss(Palette.textMuted),
        })
        .setOrigin(0.5),
    );

    const actions: Array<[string, () => void]> = [
      ['等待', handlers.onWait],
      ['背包', handlers.onInventory],
      ['角色', handlers.onCharacter],
      ['日志', handlers.onLog],
      ['下楼', handlers.onDescend],
    ];
    const aw = 70;
    const gap = 6;
    const totalW = actions.length * aw + (actions.length - 1) * gap;
    let ax = (GAME_WIDTH - totalW) / 2 + aw / 2;
    for (const [label, cb] of actions) {
      this.add(new Button(scene, ax, CONTROLS_TOP + 58, label, cb, { width: aw, height: 46, fontSize: 16 }));
      ax += aw + gap;
    }

    scene.add.existing(this);
  }
}
