import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';

/**
 * A simple centred modal dialog (dim backdrop + titled panel + body text +
 * close button), drawn with Graphics only. Used for the Help and About screens.
 * Tapping the backdrop or the 关闭 button dismisses it.
 */
export class Modal extends Phaser.GameObjects.Container {
  private closed = false;
  private closeBtn?: HtmlButton;

  constructor(scene: Phaser.Scene, title: string, body: string) {
    super(scene, 0, 0);
    this.setDepth(1000);
    // This canvas overlay sits below the DOM UI layer; block it so taps don't
    // fall through to the menu buttons behind the dim backdrop.
    blockUi();

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const panelW = 332;
    const panelH = 540;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    // Dim, input-blocking backdrop. A tap on it closes the modal.
    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.74);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    dim.on('pointerup', () => this.close());

    const panel = scene.add.graphics();
    panel.fillStyle(Palette.panel, 1);
    panel.fillRoundedRect(left, top, panelW, panelH, 16);
    panel.lineStyle(2, Palette.border, 1);
    panel.strokeRoundedRect(left, top, panelW, panelH, 16);

    const titleText = scene.add
      .text(cx, top + 34, title, {
        fontFamily: FontFamily,
        fontSize: '24px',
        color: toCss(Palette.accent),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const rule = scene.add.graphics();
    rule.lineStyle(1, Palette.accentDim, 1);
    rule.lineBetween(left + 28, top + 62, left + panelW - 28, top + 62);

    const bodyText = scene.add
      .text(left + 26, top + 82, body, {
        fontFamily: FontFamily,
        fontSize: '16px',
        color: toCss(Palette.textDim),
        align: 'left',
        lineSpacing: 9,
        wordWrap: { width: panelW - 52 },
      })
      .setOrigin(0, 0);

    this.closeBtn = new HtmlButton(scene, cx, top + panelH - 38, '关闭', () => this.close(), {
      width: panelW - 56,
      height: 46,
      fontSize: 18,
      layer: 'modal',
    });

    this.add([dim, panel, titleText, rule, bodyText]);
    scene.add.existing(this);

    // Gentle fade-in.
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeBtn?.destroy();
    unblockUi();
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 120,
      onComplete: () => this.destroy(),
    });
  }
}
