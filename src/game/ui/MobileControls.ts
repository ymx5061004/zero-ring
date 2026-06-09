import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton, type HtmlButtonVariant } from './HtmlButton';

export interface MobileControlsHandlers {
  onSkill: () => void;
  onSearch: () => void;
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

    const actions: Array<[string, () => void, HtmlButtonVariant?]> = [
      ['技能', handlers.onSkill, 'primary'],
      ['搜索', handlers.onSearch],
      ['等待', handlers.onWait],
      ['背包', handlers.onInventory],
      ['角色', handlers.onCharacter],
      ['日志', handlers.onLog],
      ['下楼', handlers.onDescend],
    ];
    // Width scales to the count so the row always fits the portrait canvas.
    const gap = 4;
    const margin = 6;
    const aw = Math.floor((GAME_WIDTH - margin * 2 - (actions.length - 1) * gap) / actions.length);
    const totalW = actions.length * aw + (actions.length - 1) * gap;
    let ax = (GAME_WIDTH - totalW) / 2 + aw / 2;
    for (const [label, cb, variant] of actions) {
      // Real DOM buttons (base layer) — native taps, no canvas hit-testing.
      new HtmlButton(scene, ax, CONTROLS_TOP + 58, label, cb, { width: aw, height: 46, fontSize: 15, variant });
      ax += aw + gap;
    }

    scene.add.existing(this);
  }
}
