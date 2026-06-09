import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';

/**
 * An HTML overlay that sits exactly on top of the Phaser canvas and shares its
 * 390×844 logical coordinate space. All interactive controls live here as DOM so
 * hit-testing is native (no canvas touch heuristics, never misaligned) and text
 * is always crisp.
 *
 * Two stacked layers:
 *  • `base`  — scene-level controls (menu buttons, the in-game action bar, the
 *              class-select cards).
 *  • `modal` — controls that belong to a canvas overlay drawn on top of a scene
 *              (inventory / settings / dialog). When such an overlay opens we hide
 *              the whole `base` layer (so its buttons don't paint over the panel)
 *              while the panel's own `modal` controls stay visible above it.
 *
 * Both layers are click-through (`pointer-events: none`); only the widgets inside
 * capture input, so taps on empty space still reach the game canvas underneath
 * (e.g. tap-to-move).
 */

export type UiLayerName = 'base' | 'modal';

let baseStage: HTMLDivElement | null = null;
let modalStage: HTMLDivElement | null = null;
let rootEl: HTMLElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;

/** Keep both logical stages glued to the (FIT-scaled, centred) canvas. */
function layout(): void {
  if (!baseStage || !modalStage || !rootEl || !canvasEl) return;
  const c = canvasEl.getBoundingClientRect();
  const r = rootEl.getBoundingClientRect();
  const scale = c.width / GAME_WIDTH; // uniform — FIT preserves the 390:844 aspect
  const transform = `translate(${c.left - r.left}px, ${c.top - r.top}px) scale(${scale})`;
  baseStage.style.transform = transform;
  modalStage.style.transform = transform;
}

function makeStage(z: number): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'ui-overlay';
  overlay.style.zIndex = String(z);
  const stage = document.createElement('div');
  stage.className = 'ui-stage';
  overlay.appendChild(stage);
  (rootEl as HTMLElement).appendChild(overlay);
  return stage;
}

function ensure(game: Phaser.Game): void {
  if (baseStage) return;
  canvasEl = game.canvas;
  rootEl = (game.canvas.parentElement as HTMLElement) ?? document.body;
  baseStage = makeStage(10);
  modalStage = makeStage(20);
  game.scale.on(Phaser.Scale.Events.RESIZE, layout);
  window.addEventListener('resize', layout);
  requestAnimationFrame(layout);
  window.setTimeout(layout, 250);
  layout();
}

/** The DOM node to append logical-space widgets to, for the given layer. */
export function uiStage(scene: Phaser.Scene, layer: UiLayerName = 'base'): HTMLDivElement {
  ensure(scene.game);
  return (layer === 'modal' ? modalStage : baseStage) as HTMLDivElement;
}

/** Force a re-glue (call after anything that may have moved/resized the canvas). */
export function refreshUiLayer(): void {
  layout();
}

// A canvas overlay (inventory / settings / dialog) sits *below* this DOM layer.
// While one is open we hide the whole base layer so its buttons don't paint over
// the panel; the panel's own controls live in the modal layer and stay visible.
let blockDepth = 0;

function applyBlock(): void {
  if (baseStage) baseStage.style.display = blockDepth > 0 ? 'none' : '';
}

/** Call when a canvas overlay opens; pair with {@link unblockUi}. */
export function blockUi(): void {
  blockDepth += 1;
  applyBlock();
}

/** Call when a canvas overlay closes. */
export function unblockUi(): void {
  blockDepth = Math.max(0, blockDepth - 1);
  applyBlock();
}
