import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';
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
  private closed = false;
  private closeBtn?: HtmlButton;
  /** DOM toggle/segment buttons, recreated on each rebuild(). */
  private dynBtns: HtmlButton[] = [];

  constructor(scene: Phaser.Scene, onClose: () => void) {
    super(scene, 0, 0);
    this.setDepth(1200);
    this.onClose = onClose;
    // Canvas overlay below the DOM UI layer — block it so menu buttons behind the
    // backdrop aren't clickable while settings are open.
    blockUi();

    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.78);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    // Only a tap *outside* the panel dismisses it. Taps on the panel / its DOM
    // controls must not close it: Phaser fires this canvas pointer-up (from the
    // window-level listener) *before* the DOM button's click, so closing here
    // would tear the panel down before a toggle could register (the click would
    // then land on a removed element and never fire).
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // Pointer x/y are in canvas-buffer pixels (hi-DPI buffer = design×SUPERSAMPLE);
      // map back to the 390×844 design space before testing the panel rect, or every
      // tap reads as "outside" and closes the panel before a toggle can register.
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= PX && w.x <= PX + PW && w.y >= PY && w.y <= PY + PH;
      if (!inPanel) this.close();
    });
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
    this.closeBtn = new HtmlButton(scene, GAME_WIDTH / 2, PY + PH - 38, '关闭', () => this.close(), {
      width: 200,
      height: 46,
      fontSize: 18,
      layer: 'modal',
    });

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    scene.add.existing(this);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
    this.rebuild();
  }

  private rebuild(): void {
    this.content.removeAll(true);
    // Tear down the previous round of DOM toggles before recreating them.
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.content.add(o);
    };
    const s = Settings.get();
    const label = (x: number, y: number, text: string): void => {
      add(this.scene.add.text(x, y, text, { fontFamily: FontFamily, fontSize: '15px', color: toCss(Palette.text) }).setOrigin(0, 0.5));
    };

    // Sound (state only — no audio ships yet).
    label(PX + 24, PY + 86, '音效');
    this.toggle(PX + PW - 80, PY + 86, s.sound, () => { Settings.set({ sound: !s.sound }); this.rebuild(); });

    // Animation speed.
    label(PX + 24, PY + 140, '动画速度');
    SPEEDS.forEach(([key, name], i) => {
      this.segButton(PX + 82 + i * 78, PY + 182, name, s.animSpeed === key, () => { Settings.set({ animSpeed: key }); this.rebuild(); });
    });

    // Auto-pickup gold.
    label(PX + 24, PY + 244, '自动拾取金币');
    this.toggle(PX + PW - 80, PY + 244, s.autoPickupGold, () => { Settings.set({ autoPickupGold: !s.autoPickupGold }); this.rebuild(); });
  }

  private toggle(x: number, y: number, value: boolean, onTap: () => void): void {
    this.dynBtns.push(
      new HtmlButton(this.scene, x, y, value ? '开' : '关', onTap, {
        width: 64,
        height: 34,
        fontSize: 15,
        variant: value ? 'on' : 'default',
        layer: 'modal',
      }),
    );
  }

  private segButton(x: number, y: number, name: string, selected: boolean, onTap: () => void): void {
    this.dynBtns.push(
      new HtmlButton(this.scene, x, y, name, onTap, {
        width: 70,
        height: 34,
        fontSize: 15,
        variant: selected ? 'primary' : 'default',
        layer: 'modal',
      }),
    );
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeBtn?.destroy();
    this.dynBtns.forEach((b) => b.destroy());
    this.dynBtns = [];
    unblockUi();
    this.onClose();
  }
}
