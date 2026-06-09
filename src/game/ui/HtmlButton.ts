import Phaser from 'phaser';
import { uiStage, type UiLayerName } from './UiLayer';

// 'hit' is an invisible button that only captures taps — used to overlay native
// hit areas onto canvas-rendered controls (inventory cells, class cards, …).
export type HtmlButtonVariant = 'primary' | 'default' | 'ghost' | 'hit' | 'on';

export interface HtmlButtonOpts {
  width: number;
  height: number;
  fontSize?: number;
  variant?: HtmlButtonVariant;
  disabled?: boolean;
  /** Which overlay layer to live in. Defaults to 'base'. */
  layer?: UiLayerName;
}

/**
 * A real HTML `<button>` positioned in the game's 390×844 logical space (via the
 * UiLayer overlay). Native clicks — no canvas hit-testing — so it can never be
 * "off by a row", and its text is rendered by the browser, always crisp.
 *
 * Coordinates are given as the button *centre* (x, y), matching the Phaser
 * widgets it replaces, so call sites need no arithmetic changes.
 */
export class HtmlButton {
  readonly el: HTMLButtonElement;
  private readonly onTap: () => void;

  constructor(
    scene: Phaser.Scene,
    cx: number,
    cy: number,
    text: string,
    onTap: () => void,
    opts: HtmlButtonOpts,
  ) {
    this.onTap = onTap;
    const stage = uiStage(scene, opts.layer ?? 'base');

    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ui-btn ui-btn--${opts.variant ?? 'default'}`;
    b.textContent = text;
    b.style.left = `${cx - opts.width / 2}px`;
    b.style.top = `${cy - opts.height / 2}px`;
    b.style.width = `${opts.width}px`;
    b.style.height = `${opts.height}px`;
    if (opts.fontSize) b.style.fontSize = `${opts.fontSize}px`;
    b.disabled = opts.disabled ?? false;

    // `click` fires for both mouse and touch and only when press+release land on
    // the same element — exactly the forgiving "tap" semantics we want.
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (!b.disabled) this.onTap();
    });

    stage.appendChild(b);
    this.el = b;

    // Tie the DOM element's lifetime to the scene so it never outlives its scene.
    const dispose = (): void => this.destroy();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);
    scene.events.once(Phaser.Scenes.Events.DESTROY, dispose);
  }

  setText(text: string): this {
    this.el.textContent = text;
    return this;
  }

  /** Alias for {@link setText}, matching the old Phaser Button API. */
  setLabel(text: string): this {
    return this.setText(text);
  }

  setEnabled(enabled: boolean): this {
    this.el.disabled = !enabled;
    return this;
  }

  destroy(): void {
    this.el.remove();
  }
}
