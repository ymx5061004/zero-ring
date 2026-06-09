import Phaser from 'phaser';
import { FontFamily, GAME_HEIGHT, GAME_WIDTH, Palette, toCss } from '../config';
import { HtmlButton } from './HtmlButton';
import { blockUi, unblockUi } from './UiLayer';

/**
 * A centred modal dialog (dim backdrop + titled panel + body text + close button),
 * drawn with Graphics only. Used for the Help and About screens.
 *
 * The panel sizes itself to the (wrapped) body height so long Chinese copy never
 * overflows or collides with the button. If the body is taller than the screen
 * allows, the body region clips and can be dragged to scroll.
 */
export class Modal extends Phaser.GameObjects.Container {
  private closed = false;
  private closeBtn?: HtmlButton;
  private moveHandler?: (p: Phaser.Input.Pointer) => void;
  private upHandler?: () => void;

  constructor(scene: Phaser.Scene, title: string, body: string) {
    super(scene, 0, 0);
    this.setDepth(1000);
    // This canvas overlay sits below the DOM UI layer; block it so taps don't
    // fall through to the menu buttons behind the dim backdrop.
    blockUi();

    const cx = GAME_WIDTH / 2;
    const panelW = 332;
    const left = cx - panelW / 2;
    const padX = 26;
    const TITLE_BLOCK = 78; // panel top → body top (title + rule + gap)
    const BTN_BLOCK = 78; // body bottom → panel bottom (gap + 关闭 button + padding)

    // Build the body first so the panel can be sized to its wrapped height.
    const bodyText = scene.add
      .text(0, 0, body, {
        fontFamily: FontFamily,
        fontSize: '16px',
        color: toCss(Palette.textDim),
        align: 'left',
        lineSpacing: 9,
        wordWrap: { width: panelW - padX * 2 },
      })
      .setOrigin(0, 0);
    const bodyH = bodyText.height;

    // Grow the panel to fit the body, capped to the screen with a small margin;
    // a body taller than the cap scrolls within its (clipped) region.
    const maxPanelH = GAME_HEIGHT - 80;
    const maxBodyH = maxPanelH - TITLE_BLOCK - BTN_BLOCK;
    const viewH = Math.min(bodyH, maxBodyH);
    const panelH = TITLE_BLOCK + viewH + BTN_BLOCK;
    const top = Math.round((GAME_HEIGHT - panelH) / 2);
    const bodyTop = top + TITLE_BLOCK;

    // Dim, input-blocking backdrop — a tap *outside* the panel closes the modal.
    const dim = scene.add.graphics();
    dim.fillStyle(Palette.black, 0.74);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    // Taps on the panel — including its DOM 关闭 button — must NOT close here:
    // Phaser fires this canvas pointer-up before the DOM button's click, so closing
    // would tear the panel down first and the click would fall through to a menu
    // button revealed behind (e.g. 关于). Pointer x/y are in canvas-buffer pixels
    // (hi-DPI buffer = design×SUPERSAMPLE), so map back to design space first.
    dim.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const w = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const inPanel = w.x >= left && w.x <= left + panelW && w.y >= top && w.y <= top + panelH;
      if (!inPanel) this.close();
    });

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

    // Place + clip the body to its view region.
    bodyText.setPosition(left + padX, bodyTop);
    const maskG = scene.make.graphics();
    maskG.fillStyle(0xffffff);
    maskG.fillRect(left, bodyTop, panelW, viewH);
    bodyText.setMask(maskG.createGeometryMask());

    this.add([dim, panel, titleText, rule, bodyText]);

    // Drag to scroll only when the body is taller than its view (long help text).
    if (bodyH > viewH) {
      const minY = bodyTop + (viewH - bodyH);
      let dragging = false;
      let lastPy = 0;
      const ly = (p: Phaser.Input.Pointer): number => scene.cameras.main.getWorldPoint(p.x, p.y).y;
      const zone = scene.add.zone(cx, bodyTop + viewH / 2, panelW, viewH).setInteractive();
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragging = true;
        lastPy = ly(p);
      });
      this.moveHandler = (p: Phaser.Input.Pointer): void => {
        if (!dragging) return;
        const py = ly(p);
        bodyText.y = Phaser.Math.Clamp(bodyText.y + (py - lastPy), minY, bodyTop);
        lastPy = py;
      };
      this.upHandler = (): void => {
        dragging = false;
      };
      scene.input.on('pointermove', this.moveHandler);
      scene.input.on('pointerup', this.upHandler);
      scene.input.on('pointerupoutside', this.upHandler);
      this.add(zone); // above the body so it captures the drag
    }

    this.closeBtn = new HtmlButton(scene, cx, top + panelH - 35, '关闭', () => this.close(), {
      width: panelW - 56,
      height: 46,
      fontSize: 18,
      layer: 'modal',
    });

    scene.add.existing(this);

    // Gentle fade-in.
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.moveHandler) this.scene.input.off('pointermove', this.moveHandler);
    if (this.upHandler) {
      this.scene.input.off('pointerup', this.upHandler);
      this.scene.input.off('pointerupoutside', this.upHandler);
    }
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
