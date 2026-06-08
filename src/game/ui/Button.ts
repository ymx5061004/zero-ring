import Phaser from 'phaser';
import { FontFamily, Palette, toCss } from '../config';

export interface ButtonStyle {
  width: number;
  height: number;
  fontSize: number;
  radius: number;
  fill: number;
  fillHover: number;
  fillDown: number;
  border: number;
  borderHover: number;
  textColor: number;
  /** Fire on press and keep firing while held (for the movement pad). */
  repeat: boolean;
}

const DEFAULT_STYLE: ButtonStyle = {
  width: 260,
  height: 52,
  fontSize: 20,
  radius: 12,
  fill: Palette.panel,
  fillHover: Palette.panelLight,
  fillDown: Palette.panelDown,
  border: Palette.border,
  borderHover: Palette.accent,
  textColor: Palette.text,
  repeat: false,
};

/**
 * A self-contained, pointer-driven button drawn entirely with Phaser.Graphics —
 * no bitmap assets. Handles hover / press / disabled states and works for both
 * mouse and touch. Add it to a scene and it wires its own input.
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly cfg: ButtonStyle;
  private enabled = true;
  private hovered = false;
  private pressed = false;
  private scaleTween?: Phaser.Tweens.Tween;
  private repeatEvent?: Phaser.Time.TimerEvent;
  private readonly onTap: () => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onTap: () => void,
    style: Partial<ButtonStyle> = {},
  ) {
    super(scene, x, y);
    this.cfg = { ...DEFAULT_STYLE, ...style };
    this.onTap = onTap;

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: FontFamily,
        fontSize: `${this.cfg.fontSize}px`,
        color: toCss(this.cfg.textColor),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label]);

    const { width, height } = this.cfg;
    this.setSize(width, height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );

    if (this.cfg.repeat) {
      this.on('pointerover', () => this.setVisual({ hovered: true }));
      this.on('pointerdown', () => {
        this.setVisual({ pressed: true });
        if (this.enabled) {
          this.onTap();
          this.startRepeat();
        }
      });
      const release = (): void => {
        this.setVisual({ hovered: false, pressed: false });
        this.stopRepeat();
      };
      this.on('pointerup', release);
      this.on('pointerout', release);
      this.on('pointerupoutside', release);
    } else {
      this.on('pointerover', () => this.setVisual({ hovered: true }));
      this.on('pointerout', () => this.setVisual({ hovered: false, pressed: false }));
      this.on('pointerdown', () => this.setVisual({ pressed: true }));
      this.on('pointerupoutside', () => this.setVisual({ pressed: false }));
      this.on('pointerup', () => {
        const fire = this.enabled && this.pressed;
        this.setVisual({ pressed: false });
        if (fire) this.onTap();
      });
    }

    scene.add.existing(this);
    this.redraw();
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    if (this.input) this.input.enabled = enabled;
    if (!enabled) {
      this.hovered = false;
      this.pressed = false;
    }
    this.redraw();
    return this;
  }

  private setVisual(state: { hovered?: boolean; pressed?: boolean }): void {
    if (state.hovered !== undefined) this.hovered = state.hovered;
    if (state.pressed !== undefined) this.pressed = state.pressed;
    this.redraw();
  }

  private redraw(): void {
    const s = this.cfg;
    const hw = s.width / 2;
    const hh = s.height / 2;

    let fill = s.fill;
    let border = s.border;
    let textColor = s.textColor;
    let alpha = 1;

    if (!this.enabled) {
      fill = Palette.bgDeep;
      border = Palette.border;
      textColor = Palette.textMuted;
      alpha = 0.55;
    } else if (this.pressed) {
      fill = s.fillDown;
      border = s.borderHover;
    } else if (this.hovered) {
      fill = s.fillHover;
      border = s.borderHover;
    }

    this.bg.clear();
    this.bg.fillStyle(fill, 1);
    this.bg.fillRoundedRect(-hw, -hh, s.width, s.height, s.radius);
    this.bg.lineStyle(2, border, 1);
    this.bg.strokeRoundedRect(-hw, -hh, s.width, s.height, s.radius);

    this.label.setColor(toCss(textColor));
    this.setAlpha(alpha);
    this.animatePress();
  }

  /** Smoothly scale down on press and spring back on release. */
  private animatePress(): void {
    const target = this.enabled && this.pressed ? 0.93 : 1;
    if (Math.abs(this.scaleX - target) < 0.001) return;
    this.scaleTween?.stop();
    this.scaleTween = this.scene.tweens.add({
      targets: this,
      scaleX: target,
      scaleY: target,
      duration: 90,
      ease: target < 1 ? 'Quad.easeOut' : 'Back.easeOut',
    });
  }

  private startRepeat(): void {
    this.stopRepeat();
    this.repeatEvent = this.scene.time.addEvent({
      delay: 120,
      loop: true,
      callback: () => {
        if (this.enabled && this.pressed) this.onTap();
      },
    });
  }

  private stopRepeat(): void {
    this.repeatEvent?.remove();
    this.repeatEvent = undefined;
  }

  override destroy(fromScene?: boolean): void {
    this.stopRepeat();
    this.scaleTween?.stop();
    super.destroy(fromScene);
  }
}
