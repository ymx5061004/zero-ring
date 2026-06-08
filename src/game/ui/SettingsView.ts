import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { Button } from './Button';
import { Settings, type AnimSpeed } from '../core/Settings';

const PX = 30;
const PY = 200;
const PW = 330;
const PH = 440;

const SPEEDS: Array<[AnimSpeed, string]> = [
  ['slow', '慢'],
  ['normal', '正常'],
  ['fast', '快'],
];

/**
 * The settings overlay (a Phaser container — no new page). Toggles sound,
 * animation speed and gold auto-pickup; every change is saved immediately.
 */
export class SettingsView extends Phaser.GameObjects.Container {
  private readonly content: Phaser.GameObjects.Container;
  private readonly onClose: () => void;

  constructor(scene: Phaser.Scene, onClose: () => void) {
    super(scene, 0, 0);
    this.setDepth(1200);
    this.onClose = onClose;

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.78);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    dim.on('pointerup', () => this.close());
    this.add(dim);

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(PX, PY, PW, PH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(PX, PY, PW, PH, 16);
    this.add(panel);

    this.add(
      scene.add
        .text(GAME_WIDTH / 2, PY + 30, '设置', { fontFamily: FontFamily, fontSize: '22px', color: toCss(Palette.accent), fontStyle: 'bold' })
        .setOrigin(0.5),
    );
    this.add(new Button(scene, GAME_WIDTH / 2, PY + PH - 38, '关闭', () => this.close(), { width: 200, height: 46, fontSize: 18 }));

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
    this.rebuild();
  }

  private rebuild(): void {
    this.content.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.content.add(o);
    };
    const s = Settings.get();
    const label = (x: number, y: number, text: string): void => {
      add(this.scene.add.text(x, y, text, { fontFamily: FontFamily, fontSize: '15px', color: toCss(Palette.text) }).setOrigin(0, 0.5));
    };

    // Sound (state only — no audio ships yet).
    label(PX + 24, PY + 86, '音效');
    add(this.toggle(PX + PW - 80, PY + 86, s.sound, () => { Settings.set({ sound: !s.sound }); this.rebuild(); }));

    // Animation speed.
    label(PX + 24, PY + 140, '动画速度');
    SPEEDS.forEach(([key, name], i) => {
      add(this.segButton(PX + 82 + i * 78, PY + 182, name, s.animSpeed === key, () => { Settings.set({ animSpeed: key }); this.rebuild(); }));
    });

    // Auto-pickup gold.
    label(PX + 24, PY + 244, '自动拾取金币');
    add(this.toggle(PX + PW - 80, PY + 244, s.autoPickupGold, () => { Settings.set({ autoPickupGold: !s.autoPickupGold }); this.rebuild(); }));
  }

  private toggle(x: number, y: number, value: boolean, onTap: () => void): Button {
    return new Button(this.scene, x, y, value ? '开' : '关', onTap, {
      width: 64,
      height: 34,
      fontSize: 15,
      fill: value ? 0x2c4a36 : Palette.panelDown,
      fillHover: value ? 0x36603f : Palette.panelLight,
      border: value ? Palette.success : Palette.border,
      borderHover: value ? Palette.success : Palette.borderBright,
      textColor: value ? Palette.text : Palette.textDim,
    });
  }

  private segButton(x: number, y: number, name: string, selected: boolean, onTap: () => void): Button {
    return new Button(this.scene, x, y, name, onTap, {
      width: 70,
      height: 34,
      fontSize: 15,
      fill: selected ? Palette.accentDim : Palette.panelDown,
      fillHover: selected ? 0x8a7440 : Palette.panelLight,
      border: selected ? Palette.accent : Palette.border,
      borderHover: Palette.accent,
      textColor: selected ? Palette.text : Palette.textDim,
    });
  }

  private close(): void {
    this.onClose();
  }
}
